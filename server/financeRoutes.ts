import express from 'express';
import crypto from 'node:crypto';
import { db } from './db.js';
import {
  requireAuth,
  requireTenant,
  requireRole,
  AuthenticatedRequest,
} from './tenantMiddleware.js';
import { logAudit } from './audit.js';
import {
  toKobo,
  toNaira,
  calculateItemsSubtotalKobo,
  calculateDiscountKobo,
  determineInvoiceStatus,
  generateInvoiceNumber,
  generatePaymentReference,
} from './financeUtils.js';

export const financeRouter = express.Router();

// Allowed financial management roles
const FINANCIAL_ADMIN_ROLES = ['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR'];

// ==============================================================================
// 1. FEE CATEGORIES
// ==============================================================================

// GET /api/v1/school/fee-categories
financeRouter.get(
  '/fee-categories',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const categories = db
      .prepare(
        `SELECT * FROM fee_categories WHERE school_id = ? ORDER BY name ASC`
      )
      .all(schoolId);

    return res.json({ success: true, count: categories.length, categories });
  }
);

// POST /api/v1/school/fee-categories
financeRouter.post(
  '/fee-categories',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { name, description, status = 'ACTIVE' } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'MISSING_NAME', message: 'Category name is required.' });
    }

    const trimmedName = name.trim();

    // Check duplicate name within school
    const existing = db
      .prepare(`SELECT id FROM fee_categories WHERE school_id = ? AND LOWER(name) = LOWER(?)`)
      .get(schoolId, trimmedName);

    if (existing) {
      return res.status(409).json({
        error: 'DUPLICATE_CATEGORY',
        message: `A fee category with name "${trimmedName}" already exists for this school.`,
      });
    }

    const id = `cat_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare(`
      INSERT INTO fee_categories (id, school_id, name, description, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, schoolId, trimmedName, description || null, status);

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'CREATE_FEE_CATEGORY',
      entity: 'FEE_CATEGORY',
      entityId: id,
      ipAddress: req.ip,
      metadata: { name: trimmedName, status },
    });

    const created = db.prepare(`SELECT * FROM fee_categories WHERE id = ? AND school_id = ?`).get(id, schoolId);
    return res.status(201).json({ success: true, category: created });
  }
);

// PUT /api/v1/school/fee-categories/:id
financeRouter.put(
  '/fee-categories/:id',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const { name, description, status } = req.body;

    const cat = db.prepare(`SELECT * FROM fee_categories WHERE id = ? AND school_id = ?`).get(id, schoolId) as any;
    if (!cat) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Fee category not found in your school.' });
    }

    if (name && name.trim()) {
      const trimmed = name.trim();
      const duplicate = db
        .prepare(`SELECT id FROM fee_categories WHERE school_id = ? AND LOWER(name) = LOWER(?) AND id != ?`)
        .get(schoolId, trimmed, id);
      if (duplicate) {
        return res.status(409).json({ error: 'DUPLICATE_CATEGORY', message: `Fee category "${trimmed}" already exists.` });
      }
    }

    db.prepare(`
      UPDATE fee_categories SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(name?.trim() || null, description !== undefined ? description : null, status || null, id, schoolId);

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'UPDATE_FEE_CATEGORY',
      entity: 'FEE_CATEGORY',
      entityId: id,
      ipAddress: req.ip,
      metadata: { name, status },
    });

    const updated = db.prepare(`SELECT * FROM fee_categories WHERE id = ? AND school_id = ?`).get(id, schoolId);
    return res.json({ success: true, category: updated });
  }
);

// DELETE /api/v1/school/fee-categories/:id
financeRouter.delete(
  '/fee-categories/:id',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const cat = db.prepare(`SELECT * FROM fee_categories WHERE id = ? AND school_id = ?`).get(id, schoolId);
    if (!cat) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Fee category not found in your school.' });
    }

    // Check if category is used in active fee structures or invoices
    const usedInFs = db.prepare(`SELECT COUNT(*) as c FROM fee_structure_items WHERE fee_category_id = ? AND school_id = ?`).get(id, schoolId) as { c: number };
    const usedInInv = db.prepare(`SELECT COUNT(*) as c FROM invoice_items WHERE fee_category_id = ? AND school_id = ?`).get(id, schoolId) as { c: number };

    if (usedInFs.c > 0 || usedInInv.c > 0) {
      // Soft-delete / deactivate instead to protect historical financial integrity
      db.prepare(`UPDATE fee_categories SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`).run(id, schoolId);
      return res.json({
        success: true,
        message: 'Fee category is referenced in fee structures or invoices. Deactivated to preserve financial audit trail.',
      });
    }

    db.prepare(`DELETE FROM fee_categories WHERE id = ? AND school_id = ?`).run(id, schoolId);

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'DELETE_FEE_CATEGORY',
      entity: 'FEE_CATEGORY',
      entityId: id,
      ipAddress: req.ip,
    });

    return res.json({ success: true, message: 'Fee category deleted.' });
  }
);

// ==============================================================================
// 2. FEE STRUCTURES & TEMPLATES
// ==============================================================================

// GET /api/v1/school/fee-structures
financeRouter.get(
  '/fee-structures',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { class_id, session_id, term_id } = req.query;

    let sql = `
      SELECT fs.*,
             c.name as class_name,
             s.name as session_name,
             t.name as term_name
      FROM fee_structures fs
      LEFT JOIN classes c ON fs.class_id = c.id
      LEFT JOIN academic_sessions s ON fs.academic_session_id = s.id
      LEFT JOIN terms t ON fs.term_id = t.id
      WHERE fs.school_id = ?
    `;
    const params: any[] = [schoolId];

    if (class_id) {
      sql += ` AND fs.class_id = ?`;
      params.push(class_id);
    }
    if (session_id) {
      sql += ` AND fs.academic_session_id = ?`;
      params.push(session_id);
    }
    if (term_id) {
      sql += ` AND fs.term_id = ?`;
      params.push(term_id);
    }

    sql += ` ORDER BY fs.created_at DESC`;

    const structures = db.prepare(sql).all(...params) as any[];

    // Fetch items for each structure
    const fullStructures = structures.map((fs) => {
      const items = db.prepare(`
        SELECT fsi.*, fc.name as category_name
        FROM fee_structure_items fsi
        LEFT JOIN fee_categories fc ON fsi.fee_category_id = fc.id
        WHERE fsi.fee_structure_id = ? AND fsi.school_id = ?
        ORDER BY fsi.compulsory DESC, fc.name ASC
      `).all(fs.id, schoolId) as any[];

      const totalKobo = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      return {
        ...fs,
        items,
        total_amount: totalKobo,
        total_naira: toNaira(totalKobo),
      };
    });

    return res.json({ success: true, count: fullStructures.length, feeStructures: fullStructures });
  }
);

// POST /api/v1/school/fee-structures
financeRouter.post(
  '/fee-structures',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      name,
      description,
      class_id,
      academic_session_id,
      term_id,
      items, // array of { fee_category_id, amount (in kobo or naira), compulsory, due_date, description }
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'MISSING_NAME', message: 'Fee structure name is required.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'MISSING_ITEMS', message: 'At least one fee line item is required.' });
    }

    // Verify class, session, term belong to this school if provided
    if (class_id) {
      const cls = db.prepare(`SELECT id FROM classes WHERE id = ? AND school_id = ?`).get(class_id, schoolId);
      if (!cls) return res.status(400).json({ error: 'INVALID_CLASS', message: 'Selected class does not exist in your school.' });
    }
    if (academic_session_id) {
      const ses = db.prepare(`SELECT id FROM academic_sessions WHERE id = ? AND school_id = ?`).get(academic_session_id, schoolId);
      if (!ses) return res.status(400).json({ error: 'INVALID_SESSION', message: 'Selected session does not exist in your school.' });
    }
    if (term_id) {
      const trm = db.prepare(`SELECT id FROM terms WHERE id = ? AND school_id = ?`).get(term_id, schoolId);
      if (!trm) return res.status(400).json({ error: 'INVALID_TERM', message: 'Selected term does not exist in your school.' });
    }

    const structureId = `fs_${crypto.randomBytes(8).toString('hex')}`;

    db.prepare(`
      INSERT INTO fee_structures (id, school_id, class_id, academic_session_id, term_id, name, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      structureId,
      schoolId,
      class_id || null,
      academic_session_id || null,
      term_id || null,
      name.trim(),
      description || null
    );

    // Insert items with deterministic kobo conversion
    let totalKobo = 0;
    const insertItemStmt = db.prepare(`
      INSERT INTO fee_structure_items (id, school_id, fee_structure_id, fee_category_id, amount, compulsory, due_date, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const it of items) {
      const itemId = `fsi_${crypto.randomBytes(8).toString('hex')}`;
      // Allow amount either in integer kobo or naira
      const koboVal = it.amount_kobo !== undefined ? Math.round(Number(it.amount_kobo)) : toKobo(it.amount || 0);
      const isCompulsory = it.compulsory === false ? 0 : 1;
      insertItemStmt.run(
        itemId,
        schoolId,
        structureId,
        it.fee_category_id,
        koboVal,
        isCompulsory,
        it.due_date || null,
        it.description || null
      );
      totalKobo += koboVal;
    }

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'CREATE_FEE_STRUCTURE',
      entity: 'FEE_STRUCTURE',
      entityId: structureId,
      ipAddress: req.ip,
      metadata: { name: name.trim(), totalKobo, itemCount: items.length },
    });

    const createdItems = db.prepare(`
      SELECT fsi.*, fc.name as category_name
      FROM fee_structure_items fsi
      LEFT JOIN fee_categories fc ON fsi.fee_category_id = fc.id
      WHERE fsi.fee_structure_id = ? AND fsi.school_id = ?
    `).all(structureId, schoolId);

    const created = db.prepare(`SELECT * FROM fee_structures WHERE id = ? AND school_id = ?`).get(structureId, schoolId);

    return res.status(201).json({
      success: true,
      feeStructure: {
        ...created,
        items: createdItems,
        total_amount: totalKobo,
        total_naira: toNaira(totalKobo),
      },
    });
  }
);

// DELETE /api/v1/school/fee-structures/:id
financeRouter.delete(
  '/fee-structures/:id',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const fs = db.prepare(`SELECT * FROM fee_structures WHERE id = ? AND school_id = ?`).get(id, schoolId);
    if (!fs) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Fee structure not found.' });
    }

    db.prepare(`DELETE FROM fee_structure_items WHERE fee_structure_id = ? AND school_id = ?`).run(id, schoolId);
    db.prepare(`DELETE FROM fee_structures WHERE id = ? AND school_id = ?`).run(id, schoolId);

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'DELETE_FEE_STRUCTURE',
      entity: 'FEE_STRUCTURE',
      entityId: id,
      ipAddress: req.ip,
    });

    return res.json({ success: true, message: 'Fee structure deleted.' });
  }
);

// ==============================================================================
// 3. STUDENT INVOICES
// ==============================================================================

// GET /api/v1/school/invoices
financeRouter.get(
  '/invoices',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      student_id,
      class_id,
      academic_session_id,
      term_id,
      status,
      search,
      start_date,
      end_date,
      limit = '50',
      offset = '0',
    } = req.query;

    let sql = `
      SELECT inv.*,
             s.full_name as student_name,
             s.first_name,
             s.last_name,
             s.admission_number,
             s.class_name,
             c.name as current_class_name,
             ses.name as session_name,
             t.name as term_name
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      LEFT JOIN classes c ON inv.class_id = c.id
      LEFT JOIN academic_sessions ses ON inv.academic_session_id = ses.id
      LEFT JOIN terms t ON inv.term_id = t.id
      WHERE inv.school_id = ?
    `;
    const params: any[] = [schoolId];

    if (student_id) {
      sql += ` AND inv.student_id = ?`;
      params.push(student_id);
    }
    if (class_id) {
      sql += ` AND (inv.class_id = ? OR s.class_id = ?)`;
      params.push(class_id, class_id);
    }
    if (academic_session_id) {
      sql += ` AND inv.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      sql += ` AND inv.term_id = ?`;
      params.push(term_id);
    }
    if (status) {
      sql += ` AND inv.status = ?`;
      params.push(status);
    }
    if (search && typeof search === 'string' && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      sql += ` AND (LOWER(inv.invoice_number) LIKE ? OR LOWER(s.full_name) LIKE ? OR LOWER(s.admission_number) LIKE ?)`;
      params.push(term, term, term);
    }
    if (start_date) {
      sql += ` AND inv.issue_date >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      sql += ` AND inv.issue_date <= ?`;
      params.push(end_date);
    }

    // Get total count
    const countSql = sql.replace(/SELECT inv\.\*.*?FROM invoices inv/s, 'SELECT COUNT(*) as total FROM invoices inv');
    const totalRow = db.prepare(countSql).get(...params) as { total: number };

    sql += ` ORDER BY inv.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit as string, 10) || 50, parseInt(offset as string, 10) || 0);

    const invoices = db.prepare(sql).all(...params) as any[];

    // Add naira helper representations and verify dynamic overdue status
    const mapped = invoices.map((inv) => {
      const dynamicStatus = determineInvoiceStatus(inv.total, inv.amount_paid, inv.due_date, inv.status);
      if (dynamicStatus !== inv.status && inv.status !== 'CANCELLED' && inv.status !== 'PAID') {
        db.prepare(`UPDATE invoices SET status = ? WHERE id = ?`).run(dynamicStatus, inv.id);
        inv.status = dynamicStatus;
      }
      return {
        ...inv,
        subtotal_naira: toNaira(inv.subtotal),
        discount_naira: toNaira(inv.discount),
        total_naira: toNaira(inv.total),
        amount_paid_naira: toNaira(inv.amount_paid),
        balance_naira: toNaira(inv.balance),
      };
    });

    return res.json({
      success: true,
      total: totalRow?.total || 0,
      count: mapped.length,
      invoices: mapped,
    });
  }
);

// GET /api/v1/school/invoices/:id
financeRouter.get(
  '/invoices/:id',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const invoice = db.prepare(`
      SELECT inv.*,
             s.full_name as student_name,
             s.first_name,
             s.last_name,
             s.admission_number,
             s.class_name,
             s.gender as student_gender,
             c.name as class_official_name,
             ses.name as session_name,
             t.name as term_name,
             sch.name as school_name,
             sch.address as school_address,
             sch.phone as school_phone,
             sch.email as school_email,
             sch.website as school_website,
             sch.logo_url as school_logo_url
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      JOIN schools sch ON inv.school_id = sch.id
      LEFT JOIN classes c ON inv.class_id = c.id
      LEFT JOIN academic_sessions ses ON inv.academic_session_id = ses.id
      LEFT JOIN terms t ON inv.term_id = t.id
      WHERE inv.id = ? AND inv.school_id = ?
    `).get(id, schoolId) as any;

    if (!invoice) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Invoice not found in your school.' });
    }

    // Line items
    const items = db.prepare(`
      SELECT ii.*, fc.name as category_name
      FROM invoice_items ii
      LEFT JOIN fee_categories fc ON ii.fee_category_id = fc.id
      WHERE ii.invoice_id = ? AND ii.school_id = ?
      ORDER BY ii.created_at ASC
    `).all(id, schoolId) as any[];

    // Discounts
    const discounts = db.prepare(`
      SELECT id.*, u.full_name as authorizer_name
      FROM invoice_discounts id
      LEFT JOIN users u ON id.authorized_by = u.id
      WHERE id.invoice_id = ? AND id.school_id = ?
      ORDER BY id.created_at ASC
    `).all(id, schoolId) as any[];

    // Payments
    const payments = db.prepare(`
      SELECT p.*, u.full_name as receiver_name
      FROM payments p
      LEFT JOIN users u ON p.received_by = u.id
      WHERE p.invoice_id = ? AND p.school_id = ?
      ORDER BY p.payment_date DESC, p.created_at DESC
    `).all(id, schoolId) as any[];

    return res.json({
      success: true,
      invoice: {
        ...invoice,
        subtotal_naira: toNaira(invoice.subtotal),
        discount_naira: toNaira(invoice.discount),
        total_naira: toNaira(invoice.total),
        amount_paid_naira: toNaira(invoice.amount_paid),
        balance_naira: toNaira(invoice.balance),
        items: items.map((it) => ({
          ...it,
          unit_amount_naira: toNaira(it.unit_amount),
          total_amount_naira: toNaira(it.total_amount),
        })),
        discounts: discounts.map((d) => ({
          ...d,
          amount_naira: toNaira(d.amount),
        })),
        payments: payments.map((p) => ({
          ...p,
          amount_naira: toNaira(p.amount),
        })),
      },
    });
  }
);

// POST /api/v1/school/invoices (Create single student invoice)
financeRouter.post(
  '/invoices',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      student_id,
      academic_session_id,
      term_id,
      class_id,
      issue_date = new Date().toISOString().slice(0, 10),
      due_date,
      notes,
      items, // array of { fee_category_id, description, quantity, unit_amount (in kobo or naira) }
      discounts, // optional array of { type, amount, percentage, reason }
      status = 'ISSUED',
    } = req.body;

    if (!student_id) {
      return res.status(400).json({ error: 'MISSING_STUDENT', message: 'Student ID is required.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'MISSING_ITEMS', message: 'Invoice must contain at least one line item.' });
    }
    if (!due_date) {
      return res.status(400).json({ error: 'MISSING_DUE_DATE', message: 'Payment due date is required.' });
    }

    // Verify student belongs to this school
    const student = db.prepare(`SELECT * FROM students WHERE id = ? AND school_id = ?`).get(student_id, schoolId) as any;
    if (!student) {
      return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student not found in your school.' });
    }

    // Server-side deterministic calculation of subtotal in integer Kobo
    const calculatedItems = items.map((it) => {
      const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
      const unitKobo = it.unit_amount_kobo !== undefined ? Math.round(Number(it.unit_amount_kobo)) : toKobo(it.unit_amount || 0);
      const totalKobo = unitKobo * qty;
      return {
        id: `ii_${crypto.randomBytes(8).toString('hex')}`,
        fee_category_id: it.fee_category_id || null,
        description: (it.description || 'Fee Item').trim(),
        quantity: qty,
        unit_amount: unitKobo,
        total_amount: totalKobo,
      };
    });

    const subtotalKobo = calculatedItems.reduce((acc, it) => acc + it.total_amount, 0);

    // Calculate discounts
    let totalDiscountKobo = 0;
    const discountRecords: any[] = [];
    if (Array.isArray(discounts)) {
      for (const d of discounts) {
        let discAmountKobo = 0;
        if (d.type === 'PERCENTAGE' && typeof d.percentage === 'number') {
          const clamped = Math.min(100, Math.max(0, d.percentage));
          discAmountKobo = Math.round((subtotalKobo * clamped) / 100);
        } else {
          discAmountKobo = d.amount_kobo !== undefined ? Math.round(Number(d.amount_kobo)) : toKobo(d.amount || 0);
        }
        if (discAmountKobo > 0) {
          totalDiscountKobo += discAmountKobo;
          discountRecords.push({
            id: `disc_${crypto.randomBytes(8).toString('hex')}`,
            type: d.type || 'FIXED',
            amount: discAmountKobo,
            percentage: d.percentage || null,
            reason: (d.reason || 'Fee discount').trim(),
          });
        }
      }
    }
    totalDiscountKobo = Math.min(subtotalKobo, totalDiscountKobo);

    const totalKobo = Math.max(0, subtotalKobo - totalDiscountKobo);
    const amountPaidKobo = 0;
    const balanceKobo = totalKobo;
    const computedStatus = determineInvoiceStatus(totalKobo, amountPaidKobo, due_date, status);

    // Generate unique school-scoped invoice number
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE school_id = ?`).get(schoolId) as { c: number };
    const invoiceNumber = generateInvoiceNumber(student.admission_number || 'INV', countRow.c + 1);
    const invoiceId = `inv_${crypto.randomBytes(8).toString('hex')}`;

    db.prepare(`
      INSERT INTO invoices (
        id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
        issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceId,
      schoolId,
      student_id,
      invoiceNumber,
      academic_session_id || student.academic_session_id || null,
      term_id || null,
      class_id || student.class_id || null,
      issue_date,
      due_date,
      subtotalKobo,
      totalDiscountKobo,
      totalKobo,
      amountPaidKobo,
      balanceKobo,
      computedStatus,
      notes || null
    );

    // Insert line items
    const insertItemStmt = db.prepare(`
      INSERT INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of calculatedItems) {
      insertItemStmt.run(it.id, schoolId, invoiceId, it.fee_category_id, it.description, it.quantity, it.unit_amount, it.total_amount);
    }

    // Insert discounts
    const insertDiscStmt = db.prepare(`
      INSERT INTO invoice_discounts (id, school_id, invoice_id, type, amount, percentage, reason, authorized_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of discountRecords) {
      insertDiscStmt.run(d.id, schoolId, invoiceId, d.type, d.amount, d.percentage, d.reason, req.user?.id || null);
    }

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'CREATE_INVOICE',
      entity: 'INVOICE',
      entityId: invoiceId,
      ipAddress: req.ip,
      metadata: { invoiceNumber, studentId: student_id, totalKobo, subtotalKobo, totalDiscountKobo },
    });

    const created = db.prepare(`SELECT * FROM invoices WHERE id = ? AND school_id = ?`).get(invoiceId, schoolId);

    return res.status(201).json({
      success: true,
      invoice: {
        ...created,
        subtotal_naira: toNaira(subtotalKobo),
        discount_naira: toNaira(totalDiscountKobo),
        total_naira: toNaira(totalKobo),
        amount_paid_naira: 0,
        balance_naira: toNaira(balanceKobo),
        items: calculatedItems,
        discounts: discountRecords,
      },
    });
  }
);

// POST /api/v1/school/invoices/generate-bulk (Generate invoices from fee structure for all students in class)
financeRouter.post(
  '/invoices/generate-bulk',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      fee_structure_id,
      class_id,
      academic_session_id,
      term_id,
      due_date,
      issue_date = new Date().toISOString().slice(0, 10),
      notes,
    } = req.body;

    if (!fee_structure_id) {
      return res.status(400).json({ error: 'MISSING_STRUCTURE', message: 'Fee structure ID is required.' });
    }
    if (!class_id) {
      return res.status(400).json({ error: 'MISSING_CLASS', message: 'Target class ID is required.' });
    }
    if (!due_date) {
      return res.status(400).json({ error: 'MISSING_DUE_DATE', message: 'Due date is required.' });
    }

    // Load fee structure and items
    const fs = db.prepare(`SELECT * FROM fee_structures WHERE id = ? AND school_id = ?`).get(fee_structure_id, schoolId) as any;
    if (!fs) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Fee structure not found in your school.' });
    }

    const fsItems = db.prepare(`
      SELECT fsi.*, fc.name as category_name
      FROM fee_structure_items fsi
      LEFT JOIN fee_categories fc ON fsi.fee_category_id = fc.id
      WHERE fsi.fee_structure_id = ? AND fsi.school_id = ?
    `).all(fee_structure_id, schoolId) as any[];

    if (fsItems.length === 0) {
      return res.status(400).json({ error: 'NO_ITEMS', message: 'Fee structure has no line items.' });
    }

    // Find all active students in class
    const students = db.prepare(`
      SELECT * FROM students
      WHERE school_id = ? AND class_id = ? AND student_status = 'ACTIVE'
    `).all(schoolId, class_id) as any[];

    if (students.length === 0) {
      return res.status(400).json({ error: 'NO_STUDENTS', message: 'No active students found in the selected class.' });
    }

    const subtotalKobo = fsItems.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
    const totalKobo = subtotalKobo;

    const countRow = db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE school_id = ?`).get(schoolId) as { c: number };
    let currentSeq = countRow.c;

    const generatedInvoices: any[] = [];
    const insertInvStmt = db.prepare(`
      INSERT INTO invoices (
        id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
        issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertItemStmt = db.prepare(`
      INSERT INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const student of students) {
      currentSeq += 1;
      const invNum = generateInvoiceNumber(student.admission_number || 'INV', currentSeq);
      const invId = `inv_${crypto.randomBytes(8).toString('hex')}`;
      const status = determineInvoiceStatus(totalKobo, 0, due_date, 'ISSUED');

      insertInvStmt.run(
        invId,
        schoolId,
        student.id,
        invNum,
        academic_session_id || fs.academic_session_id || null,
        term_id || fs.term_id || null,
        class_id,
        issue_date,
        due_date,
        subtotalKobo,
        0,
        totalKobo,
        0,
        totalKobo,
        status,
        notes || `Generated from ${fs.name}`
      );

      for (const it of fsItems) {
        const itemId = `ii_${crypto.randomBytes(8).toString('hex')}`;
        insertItemStmt.run(
          itemId,
          schoolId,
          invId,
          it.fee_category_id,
          it.description || it.category_name || 'Fee item',
          1,
          it.amount,
          it.amount
        );
      }

      generatedInvoices.push({ invoiceId: invId, invoiceNumber: invNum, studentName: student.full_name });
    }

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'BULK_GENERATE_INVOICES',
      entity: 'INVOICE',
      entityId: fee_structure_id,
      ipAddress: req.ip,
      metadata: { classId: class_id, count: generatedInvoices.length, subtotalKobo },
    });

    return res.status(201).json({
      success: true,
      message: `Successfully generated ${generatedInvoices.length} invoices.`,
      count: generatedInvoices.length,
      invoices: generatedInvoices,
    });
  }
);

// POST /api/v1/school/invoices/:id/cancel
financeRouter.post(
  '/invoices/:id/cancel',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const { reason } = req.body;

    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ? AND school_id = ?`).get(id, schoolId) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Invoice not found.' });
    }

    if (invoice.amount_paid > 0) {
      return res.status(400).json({
        error: 'CANNOT_CANCEL_PAID',
        message: 'Cannot cancel invoice with confirmed payments. Reverse or refund payments first.',
      });
    }

    db.prepare(`UPDATE invoices SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`).run(id, schoolId);

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'CANCEL_INVOICE',
      entity: 'INVOICE',
      entityId: id,
      ipAddress: req.ip,
      metadata: { reason },
    });

    return res.json({ success: true, message: 'Invoice marked as CANCELLED.' });
  }
);

// ==============================================================================
// 4. DISCOUNTS / SCHOLARSHIPS / WAIVERS
// ==============================================================================

// POST /api/v1/school/invoices/:id/discounts
financeRouter.post(
  '/invoices/:id/discounts',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: invoiceId } = req.params;
    const { type, amount, percentage, reason } = req.body;

    if (!type || !['FIXED', 'PERCENTAGE', 'SCHOLARSHIP', 'WAIVER'].includes(type)) {
      return res.status(400).json({ error: 'INVALID_TYPE', message: 'Type must be FIXED, PERCENTAGE, SCHOLARSHIP, or WAIVER.' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'MISSING_REASON', message: 'Audit reason is required for fee adjustments.' });
    }

    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ? AND school_id = ?`).get(invoiceId, schoolId) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Invoice not found.' });
    }
    if (invoice.status === 'CANCELLED' || invoice.status === 'PAID') {
      return res.status(400).json({ error: 'INVALID_STATE', message: 'Cannot add discounts to a PAID or CANCELLED invoice.' });
    }

    // Deterministic calculation in Kobo
    let discountAmountKobo = 0;
    if (type === 'PERCENTAGE') {
      const pct = Math.min(100, Math.max(0, Number(percentage) || 0));
      discountAmountKobo = Math.round((invoice.subtotal * pct) / 100);
    } else {
      discountAmountKobo = toKobo(amount || 0);
    }

    if (discountAmountKobo <= 0) {
      return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Discount amount must be greater than zero.' });
    }

    // Check if new discount exceeds remaining un-discounted subtotal
    const newTotalDiscountKobo = invoice.discount + discountAmountKobo;
    if (newTotalDiscountKobo > invoice.subtotal) {
      return res.status(400).json({
        error: 'EXCEEDS_SUBTOTAL',
        message: 'Cumulative discount cannot exceed invoice subtotal.',
      });
    }

    const newTotalKobo = Math.max(0, invoice.subtotal - newTotalDiscountKobo);
    const newBalanceKobo = Math.max(0, newTotalKobo - invoice.amount_paid);
    const newStatus = determineInvoiceStatus(newTotalKobo, invoice.amount_paid, invoice.due_date, invoice.status);

    const discountId = `disc_${crypto.randomBytes(8).toString('hex')}`;
    db.prepare(`
      INSERT INTO invoice_discounts (id, school_id, invoice_id, type, amount, percentage, reason, authorized_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      discountId,
      schoolId,
      invoiceId,
      type,
      discountAmountKobo,
      percentage || null,
      reason.trim(),
      req.user?.id || null
    );

    db.prepare(`
      UPDATE invoices SET
        discount = ?,
        total = ?,
        balance = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(newTotalDiscountKobo, newTotalKobo, newBalanceKobo, newStatus, invoiceId, schoolId);

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'APPLY_INVOICE_DISCOUNT',
      entity: 'INVOICE_DISCOUNT',
      entityId: discountId,
      ipAddress: req.ip,
      metadata: { invoiceId, type, discountAmountKobo, reason: reason.trim() },
    });

    return res.status(201).json({
      success: true,
      message: `${type} discount applied successfully.`,
      discount: {
        id: discountId,
        type,
        amount: discountAmountKobo,
        amount_naira: toNaira(discountAmountKobo),
        reason,
      },
      invoice: {
        id: invoiceId,
        subtotal: invoice.subtotal,
        discount: newTotalDiscountKobo,
        total: newTotalKobo,
        amount_paid: invoice.amount_paid,
        balance: newBalanceKobo,
        status: newStatus,
        total_naira: toNaira(newTotalKobo),
        balance_naira: toNaira(newBalanceKobo),
      },
    });
  }
);

// ==============================================================================
// 5. PAYMENTS & RECEIPTING
// ==============================================================================

// GET /api/v1/school/payments
financeRouter.get(
  '/payments',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { student_id, payment_method, start_date, end_date, limit = '50', offset = '0' } = req.query;

    let sql = `
      SELECT p.*,
             inv.invoice_number,
             s.full_name as student_name,
             s.admission_number,
             s.class_name,
             u.full_name as receiver_name
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      LEFT JOIN users u ON p.received_by = u.id
      WHERE p.school_id = ?
    `;
    const params: any[] = [schoolId];

    if (student_id) {
      sql += ` AND p.student_id = ?`;
      params.push(student_id);
    }
    if (payment_method) {
      sql += ` AND p.payment_method = ?`;
      params.push(payment_method);
    }
    if (start_date) {
      sql += ` AND p.payment_date >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      sql += ` AND p.payment_date <= ?`;
      params.push(end_date);
    }

    sql += ` ORDER BY p.payment_date DESC, p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit as string, 10) || 50, parseInt(offset as string, 10) || 0);

    const payments = db.prepare(sql).all(...params) as any[];

    return res.json({
      success: true,
      count: payments.length,
      payments: payments.map((p) => ({
        ...p,
        amount_naira: toNaira(p.amount),
      })),
    });
  }
);

// POST /api/v1/school/invoices/:id/payments (Record payment against invoice)
financeRouter.post(
  '/invoices/:id/payments',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: invoiceId } = req.params;
    const {
      amount, // in naira or kobo
      payment_method, // BANK_TRANSFER, POS, CASH, ONLINE, CHEQUE
      payment_date = new Date().toISOString().slice(0, 10),
      notes,
    } = req.body;

    const validMethods = ['BANK_TRANSFER', 'POS', 'CASH', 'ONLINE', 'CHEQUE'];
    if (!payment_method || !validMethods.includes(payment_method)) {
      return res.status(400).json({ error: 'INVALID_PAYMENT_METHOD', message: `Payment method must be one of: ${validMethods.join(', ')}` });
    }

    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ? AND school_id = ?`).get(invoiceId, schoolId) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Invoice not found in your school.' });
    }

    if (invoice.status === 'CANCELLED') {
      return res.status(400).json({ error: 'INVOICE_CANCELLED', message: 'Cannot record payment for a CANCELLED invoice.' });
    }
    if (invoice.status === 'PAID' && invoice.balance <= 0) {
      return res.status(400).json({ error: 'ALREADY_PAID', message: 'Invoice is already fully settled.' });
    }

    // Convert amount deterministically to integer kobo
    const payKobo = req.body.amount_kobo !== undefined ? Math.round(Number(req.body.amount_kobo)) : toKobo(amount || 0);

    if (payKobo <= 0) {
      return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Payment amount must be greater than zero.' });
    }

    // Prevent overpayment
    if (payKobo > invoice.balance) {
      return res.status(400).json({
        error: 'OVERPAYMENT_NOT_ALLOWED',
        message: `Payment amount (₦${toNaira(payKobo).toLocaleString()}) exceeds outstanding balance (₦${toNaira(invoice.balance).toLocaleString()}).`,
      });
    }

    const newAmountPaidKobo = invoice.amount_paid + payKobo;
    const newBalanceKobo = Math.max(0, invoice.total - newAmountPaidKobo);
    const newStatus = determineInvoiceStatus(invoice.total, newAmountPaidKobo, invoice.due_date, invoice.status);

    const countRow = db.prepare(`SELECT COUNT(*) as c FROM payments WHERE school_id = ?`).get(schoolId) as { c: number };
    const paymentRef = generatePaymentReference('PAY', countRow.c + 1);
    const paymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;

    db.prepare(`
      INSERT INTO payments (id, school_id, invoice_id, student_id, payment_reference, amount, payment_method, payment_date, notes, received_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      schoolId,
      invoiceId,
      invoice.student_id,
      paymentRef,
      payKobo,
      payment_method,
      payment_date,
      notes || null,
      req.user?.id || null
    );

    db.prepare(`
      UPDATE invoices SET
        amount_paid = ?,
        balance = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(newAmountPaidKobo, newBalanceKobo, newStatus, invoiceId, schoolId);

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'RECORD_PAYMENT',
      entity: 'PAYMENT',
      entityId: paymentId,
      ipAddress: req.ip,
      metadata: { invoiceId, paymentRef, amountKobo: payKobo, newBalanceKobo, newStatus },
    });

    return res.status(201).json({
      success: true,
      message: 'Payment recorded successfully.',
      payment: {
        id: paymentId,
        payment_reference: paymentRef,
        amount: payKobo,
        amount_naira: toNaira(payKobo),
        payment_method,
        payment_date,
      },
      invoice: {
        id: invoiceId,
        total: invoice.total,
        amount_paid: newAmountPaidKobo,
        balance: newBalanceKobo,
        status: newStatus,
        total_naira: toNaira(invoice.total),
        amount_paid_naira: toNaira(newAmountPaidKobo),
        balance_naira: toNaira(newBalanceKobo),
      },
    });
  }
);

// ==============================================================================
// 6. FINANCIAL DASHBOARD & METRICS
// ==============================================================================

// GET /api/v1/school/finance/dashboard
financeRouter.get(
  '/finance/dashboard',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;

    // Total Invoiced (sum of active/issued invoices)
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(amount_paid), 0) as total_collected,
        COALESCE(SUM(balance), 0) as outstanding_fees,
        COUNT(*) as total_invoices,
        SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN status = 'PARTIALLY_PAID' THEN 1 ELSE 0 END) as partially_paid_count,
        SUM(CASE WHEN status = 'ISSUED' THEN 1 ELSE 0 END) as unpaid_count,
        SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END) as overdue_count,
        SUM(CASE WHEN status = 'OVERDUE' THEN balance ELSE 0 END) as overdue_amount
      FROM invoices
      WHERE school_id = ? AND status != 'CANCELLED'
    `).get(schoolId) as any;

    const totalInvoicedKobo = Number(totals.total_invoiced) || 0;
    const totalCollectedKobo = Number(totals.total_collected) || 0;
    const outstandingKobo = Number(totals.outstanding_fees) || 0;
    const overdueKobo = Number(totals.overdue_amount) || 0;

    const collectionRate = totalInvoicedKobo > 0
      ? Math.round((totalCollectedKobo / totalInvoicedKobo) * 1000) / 10
      : 0;

    // Recent Invoices
    const recentInvoices = db.prepare(`
      SELECT inv.*, s.full_name as student_name, s.admission_number, s.class_name
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      WHERE inv.school_id = ?
      ORDER BY inv.created_at DESC
      LIMIT 5
    `).all(schoolId) as any[];

    // Recent Payments
    const recentPayments = db.prepare(`
      SELECT p.*, inv.invoice_number, s.full_name as student_name, s.admission_number
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      WHERE p.school_id = ?
      ORDER BY p.payment_date DESC, p.created_at DESC
      LIMIT 5
    `).all(schoolId) as any[];

    return res.json({
      success: true,
      stats: {
        totalInvoicedKobo,
        totalInvoicedNaira: toNaira(totalInvoicedKobo),
        totalCollectedKobo,
        totalCollectedNaira: toNaira(totalCollectedKobo),
        outstandingKobo,
        outstandingNaira: toNaira(outstandingKobo),
        overdueKobo,
        overdueNaira: toNaira(overdueKobo),
        paidCount: Number(totals.paid_count) || 0,
        partiallyPaidCount: Number(totals.partially_paid_count) || 0,
        unpaidCount: Number(totals.unpaid_count) || 0,
        overdueCount: Number(totals.overdue_count) || 0,
        totalInvoices: Number(totals.total_invoices) || 0,
        collectionRate,
        recentInvoices: recentInvoices.map((inv) => ({
          ...inv,
          total_naira: toNaira(inv.total),
          balance_naira: toNaira(inv.balance),
          amount_paid_naira: toNaira(inv.amount_paid),
        })),
        recentPayments: recentPayments.map((p) => ({
          ...p,
          amount_naira: toNaira(p.amount),
        })),
      },
    });
  }
);

// ==============================================================================
// 7. FINANCIAL REPORTS & CSV EXPORT
// ==============================================================================

// GET /api/v1/school/finance/reports/summary
financeRouter.get(
  '/finance/reports/summary',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { academic_session_id, term_id } = req.query;

    let sqlWhere = `WHERE inv.school_id = ? AND inv.status != 'CANCELLED'`;
    const params: any[] = [schoolId];

    if (academic_session_id) {
      sqlWhere += ` AND inv.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      sqlWhere += ` AND inv.term_id = ?`;
      params.push(term_id);
    }

    // Revenue by class
    const classRevenue = db.prepare(`
      SELECT COALESCE(c.name, 'Unassigned') as class_name,
             COUNT(inv.id) as invoice_count,
             COALESCE(SUM(inv.total), 0) as total_billed,
             COALESCE(SUM(inv.amount_paid), 0) as total_paid,
             COALESCE(SUM(inv.balance), 0) as total_balance
      FROM invoices inv
      LEFT JOIN classes c ON inv.class_id = c.id
      ${sqlWhere}
      GROUP BY c.name
      ORDER BY total_billed DESC
    `).all(...params) as any[];

    // Revenue by category (from invoice line items)
    const categoryRevenue = db.prepare(`
      SELECT COALESCE(fc.name, 'Other') as category_name,
             COUNT(ii.id) as item_count,
             COALESCE(SUM(ii.total_amount), 0) as total_billed
      FROM invoice_items ii
      JOIN invoices inv ON ii.invoice_id = inv.id
      LEFT JOIN fee_categories fc ON ii.fee_category_id = fc.id
      ${sqlWhere}
      GROUP BY fc.name
      ORDER BY total_billed DESC
    `).all(...params) as any[];

    // Payment methods breakdown
    const paymentMethods = db.prepare(`
      SELECT p.payment_method,
             COUNT(p.id) as payment_count,
             COALESCE(SUM(p.amount), 0) as total_amount
      FROM payments p
      WHERE p.school_id = ?
      GROUP BY p.payment_method
      ORDER BY total_amount DESC
    `).all(schoolId) as any[];

    return res.json({
      success: true,
      classRevenue: classRevenue.map((c) => ({
        ...c,
        total_billed_naira: toNaira(c.total_billed),
        total_paid_naira: toNaira(c.total_paid),
        total_balance_naira: toNaira(c.total_balance),
      })),
      categoryRevenue: categoryRevenue.map((cat) => ({
        ...cat,
        total_billed_naira: toNaira(cat.total_billed),
      })),
      paymentMethods: paymentMethods.map((pm) => ({
        ...pm,
        total_amount_naira: toNaira(pm.total_amount),
      })),
    });
  }
);

// GET /api/v1/school/finance/reports/export-csv
financeRouter.get(
  '/finance/reports/export-csv',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { type = 'invoices', status, academic_session_id } = req.query;

    if (type === 'payments') {
      const payments = db.prepare(`
        SELECT p.payment_reference,
               p.payment_date,
               s.admission_number,
               s.full_name as student_name,
               inv.invoice_number,
               p.amount as amount_kobo,
               p.payment_method,
               p.notes
        FROM payments p
        JOIN invoices inv ON p.invoice_id = inv.id
        JOIN students s ON p.student_id = s.id
        WHERE p.school_id = ?
        ORDER BY p.payment_date DESC
      `).all(schoolId) as any[];

      const header = 'Payment Reference,Date,Admission Number,Student Name,Invoice Number,Amount (NGN),Payment Method,Notes\n';
      const rows = payments
        .map((p) => {
          const naira = (p.amount_kobo / 100).toFixed(2);
          const safeName = `"${(p.student_name || '').replace(/"/g, '""')}"`;
          const safeNotes = `"${(p.notes || '').replace(/"/g, '""')}"`;
          return `${p.payment_reference},${p.payment_date},${p.admission_number},${safeName},${p.invoice_number},${naira},${p.payment_method},${safeNotes}`;
        })
        .join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="school_payments_${Date.now()}.csv"`);
      return res.send(header + rows);
    }

    // Default: Export Invoices
    let sql = `
      SELECT inv.invoice_number,
             s.admission_number,
             s.full_name as student_name,
             c.name as class_name,
             inv.issue_date,
             inv.due_date,
             inv.subtotal,
             inv.discount,
             inv.total,
             inv.amount_paid,
             inv.balance,
             inv.status,
             inv.notes
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      LEFT JOIN classes c ON inv.class_id = c.id
      WHERE inv.school_id = ?
    `;
    const params: any[] = [schoolId];

    if (status) {
      sql += ` AND inv.status = ?`;
      params.push(status);
    }
    if (academic_session_id) {
      sql += ` AND inv.academic_session_id = ?`;
      params.push(academic_session_id);
    }

    sql += ` ORDER BY inv.created_at DESC`;
    const invoices = db.prepare(sql).all(...params) as any[];

    const header = 'Invoice Number,Admission Number,Student Name,Class,Issue Date,Due Date,Subtotal (NGN),Discount (NGN),Total (NGN),Amount Paid (NGN),Balance (NGN),Status,Notes\n';
    const rows = invoices
      .map((inv) => {
        const subtotal = (inv.subtotal / 100).toFixed(2);
        const discount = (inv.discount / 100).toFixed(2);
        const total = (inv.total / 100).toFixed(2);
        const paid = (inv.amount_paid / 100).toFixed(2);
        const balance = (inv.balance / 100).toFixed(2);
        const safeName = `"${(inv.student_name || '').replace(/"/g, '""')}"`;
        const safeClass = `"${(inv.class_name || '').replace(/"/g, '""')}"`;
        const safeNotes = `"${(inv.notes || '').replace(/"/g, '""')}"`;
        return `${inv.invoice_number},${inv.admission_number},${safeName},${safeClass},${inv.issue_date},${inv.due_date},${subtotal},${discount},${total},${paid},${balance},${inv.status},${safeNotes}`;
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="school_invoices_${Date.now()}.csv"`);
    return res.send(header + rows);
  }
);

// GET /api/v1/school/students/:id/finance (Student financial profile: balances, invoices, payments)
financeRouter.get(
  '/students/:id/finance',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: studentId } = req.params;

    const student = db.prepare(`SELECT * FROM students WHERE id = ? AND school_id = ?`).get(studentId, schoolId) as any;
    if (!student) {
      return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student not found in your school.' });
    }

    // Deterministic student balance calculation
    const balanceRow = db.prepare(`
      SELECT
        COALESCE(SUM(total), 0) as total_billed,
        COALESCE(SUM(discount), 0) as total_discount,
        COALESCE(SUM(amount_paid), 0) as total_paid,
        COALESCE(SUM(balance), 0) as outstanding_balance,
        COUNT(*) as total_invoices
      FROM invoices
      WHERE student_id = ? AND school_id = ? AND status != 'CANCELLED'
    `).get(studentId, schoolId) as any;

    const invoices = db.prepare(`
      SELECT * FROM invoices
      WHERE student_id = ? AND school_id = ?
      ORDER BY created_at DESC
    `).all(studentId, schoolId) as any[];

    const payments = db.prepare(`
      SELECT p.*, inv.invoice_number
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      WHERE p.student_id = ? AND p.school_id = ?
      ORDER BY p.payment_date DESC, p.created_at DESC
    `).all(studentId, schoolId) as any[];

    return res.json({
      success: true,
      student: {
        id: student.id,
        fullName: student.full_name,
        admissionNumber: student.admission_number,
        className: student.class_name,
      },
      summary: {
        totalBilledKobo: Number(balanceRow.total_billed) || 0,
        totalBilledNaira: toNaira(Number(balanceRow.total_billed) || 0),
        totalDiscountKobo: Number(balanceRow.total_discount) || 0,
        totalDiscountNaira: toNaira(Number(balanceRow.total_discount) || 0),
        totalPaidKobo: Number(balanceRow.total_paid) || 0,
        totalPaidNaira: toNaira(Number(balanceRow.total_paid) || 0),
        outstandingBalanceKobo: Number(balanceRow.outstanding_balance) || 0,
        outstandingBalanceNaira: toNaira(Number(balanceRow.outstanding_balance) || 0),
        invoiceCount: Number(balanceRow.total_invoices) || 0,
      },
      invoices: invoices.map((inv) => ({
        ...inv,
        total_naira: toNaira(inv.total),
        amount_paid_naira: toNaira(inv.amount_paid),
        balance_naira: toNaira(inv.balance),
      })),
      payments: payments.map((p) => ({
        ...p,
        amount_naira: toNaira(p.amount),
      })),
    });
  }
);
