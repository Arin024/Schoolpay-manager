import { recordPaymentPg, reversePaymentPg } from './postgresFinancialService.ts';
import { getPgPool, isPgConnected } from './db.ts';
import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from './db.ts';
import { requireAuth, requireTenant, requireRole, type AuthenticatedRequest } from './tenantMiddleware.ts';
import { logAudit } from './audit.ts';
import { toKobo, toNaira, determineInvoiceStatus } from './financeUtils.ts';
import { paymentService, generateInternalPaymentReference, generateReceiptNumber, type GatewayProvider, type PaymentMethod } from './paymentService.ts';
import { notificationService } from './notificationService.ts';

export const paymentRouter = Router();

const FINANCIAL_ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR'];

/**
 * Helper to generate official receipt for a successful payment
 */
export function issueOfficialReceipt(params: {
  schoolId: string;
  paymentId: string;
  invoiceId: string;
  studentId: string;
  amountKobo: number;
  previousBalanceKobo: number;
  currentBalanceKobo: number;
  issuedBy?: string | null;
  notes?: string | null;
}): { receiptId: string; receiptNumber: string } {
  const schoolRow = db.prepare('SELECT slug FROM schools WHERE id = ?').get(params.schoolId) as { slug: string } | undefined;
  const slug = schoolRow?.slug || 'SCH';

  const countRow = db.prepare('SELECT COUNT(*) as c FROM receipts WHERE school_id = ?').get(params.schoolId) as { c: number };
  // Ensure receipt sequence is monotonically unique even if prior receipts were deleted or seeded non-consecutively
  let seq = countRow.c + 1;
  let receiptNumber = generateReceiptNumber(slug, seq);
  while (db.prepare('SELECT id FROM receipts WHERE school_id = ? AND receipt_number = ?').get(params.schoolId, receiptNumber)) {
    seq++;
    receiptNumber = generateReceiptNumber(slug, seq);
  }
  const receiptId = `rcp_${crypto.randomBytes(8).toString('hex')}`;

  const issueDate = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO receipts (
      id, school_id, receipt_number, payment_id, invoice_id, student_id,
      amount, previous_balance, current_balance, issue_date, issued_by, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    receiptId,
    params.schoolId,
    receiptNumber,
    params.paymentId,
    params.invoiceId,
    params.studentId,
    params.amountKobo,
    params.previousBalanceKobo,
    params.currentBalanceKobo,
    issueDate,
    params.issuedBy || null,
    params.notes || null
  );

  // Authoritative synchronous write to Neon PostgreSQL
  try {
    const pool = getPgPool();
    if (pool && isPgConnected()) {
      pool.query(
        `INSERT INTO receipts (
          id, school_id, receipt_number, payment_id, invoice_id, student_id,
          amount, previous_balance, current_balance, issue_date, issued_by, notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING`,
        [
          receiptId, params.schoolId, receiptNumber, params.paymentId, params.invoiceId,
          params.studentId, params.amountKobo, params.previousBalanceKobo, params.currentBalanceKobo,
          issueDate, params.issuedBy || null, params.notes || null
        ]
      ).catch((err: any) => {
        console.error('[Receipt Neon PG Replication Error]', err.message);
      });
    }
  } catch (err: any) {
    console.warn('[Receipt Neon PG Replication Notice]', err?.message);
  }

  return { receiptId, receiptNumber };
}

// ==============================================================================
// 1. PAYMENTS HISTORY & RECORDING
// ==============================================================================

// GET /api/v1/school/payments (Filtered payments query)
paymentRouter.get(
  '/payments',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      student_id,
      class_id,
      payment_method,
      status,
      invoice_id,
      start_date,
      end_date,
      min_amount,
      max_amount,
      search,
      limit = '50',
      offset = '0',
    } = req.query;

    let sql = `
      SELECT p.*,
             inv.invoice_number,
             inv.total as invoice_total,
             inv.balance as invoice_balance,
             s.full_name as student_name,
             s.admission_number,
             s.class_name,
             c.name as class_display_name,
             u.full_name as receiver_name,
             v.full_name as verifier_name,
             r.receipt_number,
             r.id as receipt_id
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN users u ON p.received_by = u.id
      LEFT JOIN users v ON p.verified_by = v.id
      LEFT JOIN receipts r ON p.id = r.payment_id
      WHERE p.school_id = ?
    `;
    const params: any[] = [schoolId];

    if (student_id) {
      sql += ` AND p.student_id = ?`;
      params.push(student_id);
    }
    if (class_id) {
      sql += ` AND s.class_id = ?`;
      params.push(class_id);
    }
    if (payment_method) {
      sql += ` AND p.payment_method = ?`;
      params.push(payment_method);
    }
    if (status) {
      sql += ` AND p.status = ?`;
      params.push(status);
    }
    if (invoice_id) {
      sql += ` AND p.invoice_id = ?`;
      params.push(invoice_id);
    }
    if (start_date) {
      sql += ` AND p.payment_date >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      sql += ` AND p.payment_date <= ?`;
      params.push(end_date);
    }
    if (min_amount) {
      const minKobo = toKobo(Number(min_amount));
      sql += ` AND p.amount >= ?`;
      params.push(minKobo);
    }
    if (max_amount) {
      const maxKobo = toKobo(Number(max_amount));
      sql += ` AND p.amount <= ?`;
      params.push(maxKobo);
    }
    if (search && typeof search === 'string' && search.trim()) {
      sql += ` AND (p.payment_reference LIKE ? OR p.internal_reference LIKE ? OR s.full_name LIKE ? OR s.admission_number LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
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
        invoice_total_naira: toNaira(p.invoice_total),
        invoice_balance_naira: toNaira(p.invoice_balance),
      })),
    });
  }
);

// GET /api/v1/school/payments/:id (Single payment details)
paymentRouter.get(
  '/payments/:id',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const payment = db.prepare(`
      SELECT p.*,
             inv.invoice_number,
             inv.total as invoice_total,
             inv.balance as invoice_balance,
             s.full_name as student_name,
             s.admission_number,
             s.class_name,
             c.name as class_display_name,
             u.full_name as receiver_name,
             v.full_name as verifier_name,
             r.id as receipt_id,
             r.receipt_number,
             r.previous_balance,
             r.current_balance
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN users u ON p.received_by = u.id
      LEFT JOIN users v ON p.verified_by = v.id
      LEFT JOIN receipts r ON p.id = r.payment_id
      WHERE p.id = ? AND p.school_id = ?
    `).get(id, schoolId) as any;

    if (!payment) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Payment record not found.' });
    }

    return res.json({
      success: true,
      payment: {
        ...payment,
        amount_naira: toNaira(payment.amount),
        invoice_total_naira: toNaira(payment.invoice_total),
        invoice_balance_naira: toNaira(payment.invoice_balance),
        previous_balance_naira: payment.previous_balance !== null ? toNaira(payment.previous_balance) : undefined,
        current_balance_naira: payment.current_balance !== null ? toNaira(payment.current_balance) : undefined,
      },
    });
  }
);

// POST /api/v1/school/invoices/:id/payments (Record payment against invoice)
paymentRouter.post(
  '/invoices/:id/payments',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: invoiceId } = req.params;
    const {
      amount,
      amount_kobo,
      payment_method,
      provider = 'MANUAL',
      provider_reference,
      payment_date = new Date().toISOString().slice(0, 10),
      notes,
      is_pending = false, // If true, logged as PENDING awaiting bank reconciliation
    } = req.body;

    const validMethods: PaymentMethod[] = ['BANK_TRANSFER', 'POS', 'CASH', 'ONLINE', 'CHEQUE', 'OTHER'];
    if (!payment_method || !validMethods.includes(payment_method)) {
      return res.status(400).json({ error: 'INVALID_PAYMENT_METHOD', message: `Payment method must be one of: ${validMethods.join(', ')}` });
    }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(invoiceId, schoolId) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Invoice not found in your school.' });
    }

    if (invoice.status === 'CANCELLED') {
      return res.status(400).json({ error: 'INVOICE_CANCELLED', message: 'Cannot record payment for a CANCELLED invoice.' });
    }
    if (invoice.status === 'PAID' && invoice.balance <= 0) {
      return res.status(400).json({ error: 'ALREADY_PAID', message: 'Invoice is already fully settled.' });
    }

    // Convert amount deterministically to integer minor unit (kobo)
    const payKobo = amount_kobo !== undefined ? Math.round(Number(amount_kobo)) : toKobo(amount || 0);

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

    const schoolRow = db.prepare('SELECT slug FROM schools WHERE id = ?').get(schoolId) as { slug: string } | undefined;
    const slug = schoolRow?.slug || 'SCH';
    const countRow = db.prepare('SELECT COUNT(*) as c FROM payments WHERE school_id = ?').get(schoolId) as { c: number };
    const internalRef = generateInternalPaymentReference(slug, countRow.c + 1);
    const paymentRef = internalRef;
    const paymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;

    const initialStatus = is_pending ? 'PENDING' : 'SUCCESS';
    const paidAt = new Date().toISOString();
    const verifiedAt = is_pending ? null : paidAt;
    const verifiedBy = is_pending ? null : req.user?.id || null;

    let newAmountPaidKobo = invoice.amount_paid;
    let newBalanceKobo = invoice.balance;
    let newStatus = invoice.status;
    let receiptData: { receiptId: string; receiptNumber: string } | null = null;

    
    // Feature Flag: Controlled routing to PostgreSQL-native financial service
    if (process.env.FEATURE_POSTGRES_FINANCIAL_SERVICE === 'true' && isPgConnected()) {
      const pgResult = await recordPaymentPg({
        schoolId,
        invoiceId,
        amountKobo: payKobo,
        paymentMethod: payment_method,
        paymentReference: paymentRef,
        internalReference: internalRef,
        provider,
        providerReference: provider_reference || null,
        paymentDate: payment_date,
        notes: notes || null,
        receivedByUserId: req.user!.id,
        isPending: is_pending,
      });

      if (!pgResult.success || !pgResult.data) {
        return res.status(pgResult.code === 'OVERPAYMENT_NOT_ALLOWED' ? 400 : 500).json({
          error: pgResult.code || 'PAYMENT_FAILED',
          message: pgResult.error,
        });
      }

      logAudit({
        actorId: req.user?.id,
        actorEmail: req.user?.email,
        schoolId,
        action: 'RECORD_PAYMENT_PG',
        entity: 'PAYMENT',
        entityId: pgResult.data.payment.id,
        metadata: { amountKobo: payKobo, invoiceId, paymentMethod: payment_method },
      });

      return res.status(201).json({
        success: true,
        message: 'Payment recorded successfully via PostgreSQL financial engine',
        payment: pgResult.data.payment,
        invoice: pgResult.data.invoice,
        receipt: pgResult.data.receipt,
      });
    }

    // Atomic transaction for payment recording and ledger balance update
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO payments (
          id, school_id, invoice_id, student_id, payment_reference, internal_reference,
          amount, currency, payment_method, provider, provider_reference, status,
          payment_date, paid_at, verified_at, verified_by, notes, received_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NGN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        paymentId,
        schoolId,
        invoiceId,
        invoice.student_id,
        paymentRef,
        internalRef,
        payKobo,
        payment_method,
        provider,
        provider_reference || null,
        initialStatus,
        payment_date,
        paidAt,
        verifiedAt,
        verifiedBy,
        notes || null,
        req.user?.id || null
      );

      // Only update invoice balance if payment is SUCCESS
      if (initialStatus === 'SUCCESS') {
        newAmountPaidKobo = invoice.amount_paid + payKobo;
        newBalanceKobo = Math.max(0, invoice.total - newAmountPaidKobo);
        newStatus = determineInvoiceStatus(invoice.total, newAmountPaidKobo, invoice.due_date, invoice.status);

        db.prepare(`
          UPDATE invoices SET
            amount_paid = ?,
            balance = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND school_id = ?
        `).run(newAmountPaidKobo, newBalanceKobo, newStatus, invoiceId, schoolId);
      }
      db.exec('COMMIT;');
    } catch (txnErr: any) {
      db.exec('ROLLBACK;');
      return res.status(500).json({ error: 'PAYMENT_TRANSACTION_FAILED', message: txnErr.message });
    }

    // Authoritative synchronous replication to Neon PostgreSQL
    const pool = getPgPool();
    if (pool && isPgConnected()) {
      try {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO payments (
              id, school_id, invoice_id, student_id, payment_reference, internal_reference,
              amount, currency, payment_method, provider, provider_reference, status,
              payment_date, paid_at, verified_at, verified_by, notes, received_by, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'NGN', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO UPDATE SET
              status = EXCLUDED.status,
              verified_at = EXCLUDED.verified_at,
              verified_by = EXCLUDED.verified_by,
              updated_at = CURRENT_TIMESTAMP`,
            [
              paymentId, schoolId, invoiceId, invoice.student_id, paymentRef, internalRef,
              payKobo, payment_method, provider, provider_reference || null, initialStatus,
              payment_date, paidAt, verifiedAt, verifiedBy, notes || null, req.user?.id || null
            ]
          );

          if (initialStatus === 'SUCCESS') {
            await client.query(
              `UPDATE invoices SET
                amount_paid = $1,
                balance = $2,
                status = $3,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = $4 AND school_id = $5`,
              [newAmountPaidKobo, newBalanceKobo, newStatus, invoiceId, schoolId]
            );
          }
          await client.query('COMMIT');
        } catch (pgTxnErr: any) {
          await client.query('ROLLBACK');
          console.error('[Payment Neon PG Transaction Error]', pgTxnErr.message);
        } finally {
          client.release();
        }
      } catch (poolErr: any) {
        console.error('[Payment Neon PG Connection Error]', poolErr.message);
      }
    }
    if (initialStatus === 'SUCCESS') {

      // Issue Official Receipt
      receiptData = issueOfficialReceipt({
        schoolId,
        paymentId,
        invoiceId,
        studentId: invoice.student_id,
        amountKobo: payKobo,
        previousBalanceKobo: invoice.balance,
        currentBalanceKobo: newBalanceKobo,
        issuedBy: req.user?.id,
        notes,
      });

      // Dispatch Notifications
      notificationService.notifySchoolAdmins(
        schoolId,
        'PAYMENT_RECEIVED',
        `Payment Received: ₦${toNaira(payKobo).toLocaleString()}`,
        `Payment ${internalRef} recorded against Invoice #${invoice.invoice_number}. Receipt #${receiptData.receiptNumber} issued.`,
        { invoiceId, paymentId, receiptId: receiptData.receiptId, amountKobo: payKobo }
      );

      notificationService.notifyParentsOfStudent(
        schoolId,
        invoice.student_id,
        'RECEIPT_AVAILABLE',
        `Payment Receipt Ready: ₦${toNaira(payKobo).toLocaleString()}`,
        `Your payment of ₦${toNaira(payKobo).toLocaleString()} has been received and confirmed. Receipt #${receiptData.receiptNumber} is now available.`,
        { invoiceId, paymentId, receiptId: receiptData.receiptId, amountKobo: payKobo }
      );
    } else {
      // Pending payment notification
      notificationService.notifySchoolAdmins(
        schoolId,
        'PAYMENT_RECEIVED',
        `Pending Payment Logged: ₦${toNaira(payKobo).toLocaleString()}`,
        `Manual payment ${internalRef} logged as PENDING verification. Requires Bursar review.`,
        { invoiceId, paymentId, amountKobo: payKobo }
      );
    }

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: is_pending ? 'RECORD_PENDING_PAYMENT' : 'RECORD_PAYMENT',
      entity: 'PAYMENT',
      entityId: paymentId,
      ipAddress: req.ip,
      metadata: { invoiceId, internalRef, amountKobo: payKobo, status: initialStatus, newBalanceKobo },
    });

    return res.status(201).json({
      success: true,
      message: is_pending ? 'Payment logged as PENDING verification.' : 'Payment confirmed and receipt issued.',
      invoice_balance: newBalanceKobo,
      invoice_status: newStatus,
      payment: {
        id: paymentId,
        payment_reference: paymentRef,
        internal_reference: internalRef,
        amount: payKobo,
        amount_naira: toNaira(payKobo),
        payment_method,
        status: initialStatus,
        payment_date,
        receipt: receiptData,
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

// POST /api/v1/school/payments/:id/verify (Bursar verifies PENDING payment)
paymentRouter.post(
  '/payments/:id/verify',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND school_id = ?').get(id, schoolId) as any;
    if (!payment) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Payment record not found.' });
    }

    if (payment.status === 'SUCCESS') {
      return res.status(400).json({ error: 'ALREADY_VERIFIED', message: 'Payment has already been verified.' });
    }
    if (payment.status === 'CANCELLED' || payment.status === 'FAILED') {
      return res.status(400).json({ error: 'INVALID_STATUS', message: `Cannot verify a ${payment.status} payment.` });
    }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(payment.invoice_id, schoolId) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Associated invoice not found.' });
    }

    // Overpayment check
    if (payment.amount > invoice.balance) {
      return res.status(400).json({
        error: 'OVERPAYMENT_NOT_ALLOWED',
        message: `Verified payment amount (₦${toNaira(payment.amount).toLocaleString()}) exceeds invoice balance (₦${toNaira(invoice.balance).toLocaleString()}).`,
      });
    }

    const newAmountPaidKobo = invoice.amount_paid + payment.amount;
    const newBalanceKobo = Math.max(0, invoice.total - newAmountPaidKobo);
    const newStatus = determineInvoiceStatus(invoice.total, newAmountPaidKobo, invoice.due_date, invoice.status);
    const verifiedAt = new Date().toISOString();

    // Update payment
    db.prepare(`
      UPDATE payments SET
        status = 'SUCCESS',
        verified_at = ?,
        verified_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(verifiedAt, req.user?.id || null, id, schoolId);

    // Update invoice
    db.prepare(`
      UPDATE invoices SET
        amount_paid = ?,
        balance = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(newAmountPaidKobo, newBalanceKobo, newStatus, invoice.id, schoolId);

    // Issue Official Receipt
    const receiptData = issueOfficialReceipt({
      schoolId,
      paymentId: payment.id,
      invoiceId: invoice.id,
      studentId: payment.student_id,
      amountKobo: payment.amount,
      previousBalanceKobo: invoice.balance,
      currentBalanceKobo: newBalanceKobo,
      issuedBy: req.user?.id,
      notes: `Verified by Bursar: ${req.user?.full_name || req.user?.email}`,
    });

    // Notify parents and admins
    notificationService.notifyParentsOfStudent(
      schoolId,
      payment.student_id,
      'PAYMENT_VERIFIED',
      `Payment Confirmed: ₦${toNaira(payment.amount).toLocaleString()}`,
      `Your payment ${payment.internal_reference || payment.payment_reference} has been verified by the Bursary. Official Receipt #${receiptData.receiptNumber} is ready.`,
      { paymentId: payment.id, receiptId: receiptData.receiptId, amountKobo: payment.amount }
    );

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'VERIFY_PAYMENT',
      entity: 'PAYMENT',
      entityId: id,
      ipAddress: req.ip,
      metadata: { invoiceId: invoice.id, paymentRef: payment.internal_reference, amountKobo: payment.amount, receiptNumber: receiptData.receiptNumber },
    });

    return res.json({
      success: true,
      message: 'Payment verified successfully and official receipt issued.',
      payment: {
        ...payment,
        status: 'SUCCESS',
        verified_at: verifiedAt,
        receipt: receiptData,
      },
      invoice: {
        id: invoice.id,
        total: invoice.total,
        amount_paid: newAmountPaidKobo,
        balance: newBalanceKobo,
        status: newStatus,
        total_naira: toNaira(invoice.total),
        balance_naira: toNaira(newBalanceKobo),
      },
    });
  }
);

// POST /api/v1/school/payments/:id/cancel (Bursar rejects or cancels payment)
paymentRouter.post(
  '/payments/:id/cancel',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const { reason } = req.body;

    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND school_id = ?').get(id, schoolId) as any;
    if (!payment) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Payment record not found.' });
    }

    if (payment.status === 'CANCELLED') {
      return res.status(400).json({ error: 'ALREADY_CANCELLED', message: 'Payment is already cancelled.' });
    }

    const wasSuccess = payment.status === 'SUCCESS';

    // If it was already SUCCESS, we must roll back invoice balance
    if (wasSuccess) {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(payment.invoice_id, schoolId) as any;
      if (invoice) {
        const rollbackPaidKobo = Math.max(0, invoice.amount_paid - payment.amount);
        const rollbackBalanceKobo = invoice.total - rollbackPaidKobo;
        const rollbackStatus = determineInvoiceStatus(invoice.total, rollbackPaidKobo, invoice.due_date, invoice.status);

        db.prepare(`
          UPDATE invoices SET
            amount_paid = ?,
            balance = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND school_id = ?
        `).run(rollbackPaidKobo, rollbackBalanceKobo, rollbackStatus, invoice.id, schoolId);
      }
    }

    db.prepare(`
      UPDATE payments SET
        status = 'CANCELLED',
        notes = COALESCE(notes || ' | ', '') || ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(`[Cancelled: ${reason || 'Bursar cancellation'}]`, id, schoolId);

    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: 'CANCEL_PAYMENT',
      entity: 'PAYMENT',
      entityId: id,
      ipAddress: req.ip,
      metadata: { reason, wasSuccess, amountKobo: payment.amount },
    });

    return res.json({
      success: true,
      message: 'Payment cancelled successfully.',
      paymentId: id,
    });
  }
);

// ==============================================================================
// 2. RECEIPTS
// ==============================================================================

// GET /api/v1/school/receipts (List receipts)
paymentRouter.get(
  '/receipts',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { student_id, search, limit = '50', offset = '0' } = req.query;

    let sql = `
      SELECT r.*,
             p.payment_reference,
             p.payment_method,
             p.paid_at,
             inv.invoice_number,
             s.full_name as student_name,
             s.admission_number,
             s.class_name,
             u.full_name as issuer_name
      FROM receipts r
      JOIN payments p ON r.payment_id = p.id
      JOIN invoices inv ON r.invoice_id = inv.id
      JOIN students s ON r.student_id = s.id
      LEFT JOIN users u ON r.issued_by = u.id
      WHERE r.school_id = ?
    `;
    const params: any[] = [schoolId];

    if (student_id) {
      sql += ` AND r.student_id = ?`;
      params.push(student_id);
    }
    if (search && typeof search === 'string' && search.trim()) {
      sql += ` AND (r.receipt_number LIKE ? OR p.payment_reference LIKE ? OR s.full_name LIKE ? OR s.admission_number LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    sql += ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit as string, 10) || 50, parseInt(offset as string, 10) || 0);

    const receipts = db.prepare(sql).all(...params) as any[];

    return res.json({
      success: true,
      count: receipts.length,
      receipts: receipts.map((r) => ({
        ...r,
        amount_naira: toNaira(r.amount),
        previous_balance_naira: toNaira(r.previous_balance),
        current_balance_naira: toNaira(r.current_balance),
      })),
    });
  }
);

// GET /api/v1/school/receipts/:id (Full printable receipt detail)
paymentRouter.get(
  '/receipts/:id',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const receipt = db.prepare(`
      SELECT r.*,
             p.payment_reference,
             p.internal_reference,
             p.payment_method,
             p.provider,
             p.status as payment_status,
             p.paid_at,
             inv.invoice_number,
             inv.issue_date as invoice_issue_date,
             inv.total as invoice_total,
             s.full_name as student_name,
             s.first_name,
             s.last_name,
             s.admission_number,
             s.class_name,
             s.class_arm_name,
             c.name as class_display_name,
             u.full_name as issuer_name,
             u.email as issuer_email,
             sch.name as school_name,
             sch.slug as school_slug,
             sch.type as school_type,
             sch.address as school_address,
             sch.state as school_state,
             sch.lga as school_lga,
             sch.phone as school_phone,
             sch.email as school_email,
             sch.website as school_website,
             sch.logo_url as school_logo_url
      FROM receipts r
      JOIN payments p ON r.payment_id = p.id
      JOIN invoices inv ON r.invoice_id = inv.id
      JOIN students s ON r.student_id = s.id
      JOIN schools sch ON r.school_id = sch.id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN users u ON r.issued_by = u.id
      WHERE r.id = ? AND r.school_id = ?
    `).get(id, schoolId) as any;

    if (!receipt) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Receipt not found.' });
    }

    return res.json({
      success: true,
      receipt: {
        ...receipt,
        amount_naira: toNaira(receipt.amount),
        previous_balance_naira: toNaira(receipt.previous_balance),
        current_balance_naira: toNaira(receipt.current_balance),
        invoice_total_naira: toNaira(receipt.invoice_total),
      },
    });
  }
);

// GET /api/v1/school/payments/:paymentId/receipt
paymentRouter.get(
  '/payments/:paymentId/receipt',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { paymentId } = req.params;

    const receipt = db.prepare(`SELECT id FROM receipts WHERE payment_id = ? AND school_id = ?`).get(paymentId, schoolId) as { id: string } | undefined;
    if (!receipt) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Receipt not found for this payment.' });
    }

    return res.redirect(`/api/v1/school/receipts/${receipt.id}`);
  }
);

// ==============================================================================
// 3. ONLINE GATEWAYS & CHECKOUT
// ==============================================================================

// GET /api/v1/school/gateways/status
paymentRouter.get(
  '/gateways/status',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const providers = paymentService.getAllProviders(schoolId);
    return res.json({ success: true, providers });
  }
);

// POST /api/v1/school/invoices/:id/checkout (Initialize online checkout)
paymentRouter.post(
  '/invoices/:id/checkout',
  requireAuth,
  requireTenant,
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: invoiceId } = req.params;
    const { provider = 'TEST_SANDBOX', amount_kobo, email, callback_url } = req.body;

    const invoice = db.prepare(`
      SELECT inv.*, s.full_name as student_name, s.email as student_email
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      WHERE inv.id = ? AND inv.school_id = ?
    `).get(invoiceId, schoolId) as any;

    if (!invoice) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Invoice not found.' });
    }

    if (invoice.balance <= 0) {
      return res.status(400).json({ error: 'ALREADY_PAID', message: 'Invoice is already settled in full.' });
    }

    const payKobo = amount_kobo ? Math.round(Number(amount_kobo)) : invoice.balance;

    if (payKobo <= 0 || payKobo > invoice.balance) {
      return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Checkout amount exceeds outstanding balance.' });
    }

    const payerEmail = email || req.user?.email || invoice.student_email || 'guardian@student.sch.ng';

    try {
      const selectedProvider = paymentService.getProvider(provider as GatewayProvider);
      const initResult = await selectedProvider.initializePayment({
        schoolId,
        studentId: invoice.student_id,
        invoiceId,
        amountKobo: payKobo,
        email: payerEmail,
        studentName: invoice.student_name,
        invoiceNumber: invoice.invoice_number,
        callbackUrl: callback_url,
      });

      return res.json({
        ...initResult,
        amountKobo: payKobo,
        amountNaira: toNaira(payKobo),
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'GATEWAY_ERROR', message: err.message || 'Payment gateway initialization failed' });
    }
  }
);

// POST /api/v1/school/payments/verify-online (Server-side verification of online transaction)
paymentRouter.post(
  '/payments/verify-online',
  requireAuth,
  requireTenant,
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { provider = 'TEST_SANDBOX', reference, invoice_id, amount_kobo } = req.body;

    if (!reference) {
      return res.status(400).json({ error: 'MISSING_REFERENCE', message: 'Payment reference is required.' });
    }

    // Check idempotency: has this reference already been processed?
    const existingPayment = db.prepare('SELECT * FROM payments WHERE provider_reference = ? OR payment_reference = ?').get(reference, reference) as any;
    if (existingPayment) {
      return res.json({
        success: true,
        alreadyProcessed: true,
        message: 'Payment has already been confirmed and processed.',
        payment: existingPayment,
      });
    }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(invoice_id, schoolId) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Invoice not found.' });
    }

    try {
      const gateway = paymentService.getProvider(provider as GatewayProvider);
      const verification = await gateway.verifyPayment(reference, schoolId);

      if (!verification.success || verification.status !== 'SUCCESS') {
        return res.status(400).json({
          success: false,
          error: 'VERIFICATION_FAILED',
          message: verification.message || 'Payment gateway could not verify transaction.',
        });
      }

      // Minor unit kobo validation
      const confirmedKobo = verification.amountKobo > 0 ? verification.amountKobo : (amount_kobo ? Math.round(Number(amount_kobo)) : invoice.balance);

      if (confirmedKobo > invoice.balance) {
        return res.status(400).json({
          error: 'OVERPAYMENT_NOT_ALLOWED',
          message: 'Confirmed gateway amount exceeds invoice balance.',
        });
      }

      const schoolRow = db.prepare('SELECT slug FROM schools WHERE id = ?').get(schoolId) as { slug: string } | undefined;
      const slug = schoolRow?.slug || 'SCH';
      const countRow = db.prepare('SELECT COUNT(*) as c FROM payments WHERE school_id = ?').get(schoolId) as { c: number };
      const internalRef = generateInternalPaymentReference(slug, countRow.c + 1);
      const paymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;
      const now = new Date().toISOString();

      // Record successful payment
      db.prepare(`
        INSERT INTO payments (
          id, school_id, invoice_id, student_id, payment_reference, internal_reference,
          amount, currency, payment_method, provider, provider_reference, status,
          payment_date, paid_at, verified_at, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NGN', 'ONLINE', ?, ?, 'SUCCESS', ?, ?, ?, 'Online gateway verified payment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        paymentId,
        schoolId,
        invoice.id,
        invoice.student_id,
        internalRef,
        internalRef,
        confirmedKobo,
        provider,
        reference,
        now.slice(0, 10),
        now,
        now
      );

      // Update invoice
      const newAmountPaid = invoice.amount_paid + confirmedKobo;
      const newBalance = Math.max(0, invoice.total - newAmountPaid);
      const newStatus = determineInvoiceStatus(invoice.total, newAmountPaid, invoice.due_date, invoice.status);

      db.prepare(`
        UPDATE invoices SET
          amount_paid = ?,
          balance = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?
      `).run(newAmountPaid, newBalance, newStatus, invoice.id, schoolId);

      // Issue Receipt
      const receiptData = issueOfficialReceipt({
        schoolId,
        paymentId,
        invoiceId: invoice.id,
        studentId: invoice.student_id,
        amountKobo: confirmedKobo,
        previousBalanceKobo: invoice.balance,
        currentBalanceKobo: newBalance,
        notes: `Online Checkout via ${provider}`,
      });

      // Dispatch Notifications
      notificationService.notifySchoolAdmins(
        schoolId,
        'PAYMENT_VERIFIED',
        `Online Payment Verified: ₦${toNaira(confirmedKobo).toLocaleString()}`,
        `Payment ${reference} verified successfully via ${provider}. Receipt #${receiptData.receiptNumber} issued.`,
        { invoiceId: invoice.id, paymentId, receiptId: receiptData.receiptId, amountKobo: confirmedKobo }
      );

      notificationService.notifyParentsOfStudent(
        schoolId,
        invoice.student_id,
        'RECEIPT_AVAILABLE',
        `Payment Successful: ₦${toNaira(confirmedKobo).toLocaleString()}`,
        `Online payment for Invoice #${invoice.invoice_number} was confirmed. Receipt #${receiptData.receiptNumber} is ready.`,
        { invoiceId: invoice.id, paymentId, receiptId: receiptData.receiptId, amountKobo: confirmedKobo }
      );

      logAudit({
        actorId: req.user?.id,
        actorEmail: req.user?.email,
        schoolId,
        action: 'VERIFY_ONLINE_PAYMENT',
        entity: 'PAYMENT',
        entityId: paymentId,
        ipAddress: req.ip,
        metadata: { provider, reference, internalRef, amountKobo: confirmedKobo, receiptNumber: receiptData.receiptNumber },
      });

      return res.json({
        success: true,
        message: 'Online payment verified and receipt generated.',
        payment: {
          id: paymentId,
          reference,
          internal_reference: internalRef,
          amount_naira: toNaira(confirmedKobo),
          status: 'SUCCESS',
          receipt: receiptData,
        },
        invoice: {
          id: invoice.id,
          total_naira: toNaira(invoice.total),
          amount_paid_naira: toNaira(newAmountPaid),
          balance_naira: toNaira(newBalance),
          status: newStatus,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'VERIFICATION_ERROR', message: err.message || 'Payment verification failed' });
    }
  }
);

// ==============================================================================
// 4. IN-APP NOTIFICATIONS
// ==============================================================================

// GET /api/v1/school/notifications
paymentRouter.get(
  '/notifications',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const userId = req.user?.id;

    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE school_id = ? AND (user_id IS NULL OR user_id = ?)
      ORDER BY created_at DESC
      LIMIT 50
    `).all(schoolId, userId || '') as any[];

    const unreadCountRow = db.prepare(`
      SELECT COUNT(*) as unread
      FROM notifications
      WHERE school_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL
    `).get(schoolId, userId || '') as { unread: number };

    return res.json({
      success: true,
      unreadCount: unreadCountRow.unread || 0,
      notifications: notifications.map((n) => ({
        ...n,
        data: n.data ? JSON.parse(n.data) : null,
      })),
    });
  }
);

// PATCH /api/v1/school/notifications/:id/read
paymentRouter.patch(
  '/notifications/:id/read',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    db.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(id, schoolId);

    return res.json({ success: true, message: 'Notification marked as read.' });
  }
);

// POST /api/v1/school/notifications/mark-all-read
paymentRouter.post(
  '/notifications/mark-all-read',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const userId = req.user?.id;

    db.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE school_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL
    `).run(schoolId, userId || '');

    return res.json({ success: true, message: 'All notifications marked as read.' });
  }
);

// ==============================================================================
// 5. DETAILED FINANCIAL REPORTS & CSV EXPORT
// ==============================================================================

// GET /api/v1/school/finance/reports/daily
paymentRouter.get(
  '/finance/reports/daily',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const days = Math.min(parseInt((req.query.days as string) || '14', 10), 90);

    const rows = db.prepare(`
      SELECT p.payment_date,
             COUNT(p.id) as transaction_count,
             COALESCE(SUM(p.amount), 0) as total_collected
      FROM payments p
      WHERE p.school_id = ? AND p.status = 'SUCCESS'
      GROUP BY p.payment_date
      ORDER BY p.payment_date DESC
      LIMIT ?
    `).all(schoolId, days) as any[];

    return res.json({
      success: true,
      daily: rows.map((r) => ({
        date: r.payment_date,
        count: r.transaction_count,
        total_kobo: r.total_collected,
        total_naira: toNaira(r.total_collected),
      })),
    });
  }
);

// GET /api/v1/school/finance/reports/monthly
paymentRouter.get(
  '/finance/reports/monthly',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;

    const rows = db.prepare(`
      SELECT strftime('%Y-%m', p.payment_date) as month,
             COUNT(p.id) as transaction_count,
             COALESCE(SUM(p.amount), 0) as total_collected
      FROM payments p
      WHERE p.school_id = ? AND p.status = 'SUCCESS'
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `).all(schoolId) as any[];

    return res.json({
      success: true,
      monthly: rows.map((r) => ({
        month: r.month,
        count: r.transaction_count,
        total_kobo: r.total_collected,
        total_naira: toNaira(r.total_collected),
      })),
    });
  }
);

// GET /api/v1/school/finance/reports/defaulters (Outstanding balances)
paymentRouter.get(
  '/finance/reports/defaulters',
  requireAuth,
  requireTenant,
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { class_id, min_balance } = req.query;

    let sql = `
      SELECT s.id as student_id,
             s.admission_number,
             s.full_name as student_name,
             c.name as class_name,
             COALESCE(TRIM(p.first_name || ' ' || p.last_name), 'Parent/Guardian') as parent_name,
             COALESCE(p.phone, '') as parent_phone,
             COALESCE(p.email, '') as parent_email,
             COALESCE(SUM(inv.total), 0) as total_billed,
             COALESCE(SUM(inv.amount_paid), 0) as total_paid,
             COALESCE(SUM(inv.balance), 0) as outstanding_balance,
             COUNT(inv.id) as unpaid_invoices_count,
             MIN(inv.due_date) as earliest_due_date,
             MAX(inv.id) as latest_invoice_id
      FROM students s
      JOIN invoices inv ON s.id = inv.student_id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN parent_students ps ON s.id = ps.student_id AND ps.is_primary_contact = 1
      LEFT JOIN parents p ON ps.parent_id = p.id
      WHERE s.school_id = ? AND inv.balance > 0 AND inv.status != 'CANCELLED'
    `;
    const params: any[] = [schoolId];

    if (class_id) {
      sql += ` AND s.class_id = ?`;
      params.push(class_id);
    }

    sql += ` GROUP BY s.id HAVING outstanding_balance > 0`;

    if (min_balance) {
      const minKobo = toKobo(Number(min_balance));
      sql += ` AND outstanding_balance >= ?`;
      params.push(minKobo);
    }

    sql += ` ORDER BY outstanding_balance DESC LIMIT 100`;

    const defaulters = db.prepare(sql).all(...params) as any[];

    return res.json({
      success: true,
      count: defaulters.length,
      defaulters: defaulters.map((d) => ({
        ...d,
        total_billed_naira: toNaira(d.total_billed),
        total_paid_naira: toNaira(d.total_paid),
        outstanding_balance_naira: toNaira(d.outstanding_balance),
      })),
    });
  }
);

// POST /api/v1/school/finance/defaulters/send-reminder
// Send instant Fee Reminder Notice to Parent via SMS, Email, and generate 1-click WhatsApp message
paymentRouter.post(
  '/finance/defaulters/send-reminder',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { studentId, channel = 'ALL', customNote } = req.body;

    if (!studentId) {
      return res.status(400).json({ error: 'MISSING_PARAM', message: 'studentId is required' });
    }

    const school = db.prepare('SELECT name, phone, email, currency_symbol FROM schools s LEFT JOIN school_settings set ON s.id = set.school_id WHERE s.id = ?').get(schoolId) as any;
    const student = db.prepare(`
      SELECT s.id, s.full_name as student_name, s.admission_number, c.name as class_name,
             COALESCE(TRIM(p.first_name || ' ' || p.last_name), 'Parent/Guardian') as parent_name, p.phone as parent_phone, p.email as parent_email,
             COALESCE(SUM(inv.balance), 0) as balance_kobo
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN parent_students ps ON s.id = ps.student_id AND ps.is_primary_contact = 1
      LEFT JOIN parents p ON ps.parent_id = p.id
      JOIN invoices inv ON s.id = inv.student_id AND inv.balance > 0 AND inv.status != 'CANCELLED'
      WHERE s.id = ? AND s.school_id = ?
      GROUP BY s.id
    `).get(studentId, schoolId) as any;

    if (!student) {
      return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student has no active outstanding balance or was not found.' });
    }

    const outstandingNaira = toNaira(student.balance_kobo);
    const parentName = student.parent_name || 'Parent / Guardian';
    const schoolName = school?.name || 'Our School';
    const currSym = school?.currency_symbol || '₦';

    // Construct professional Nigerian school payment reminder text
    const messageText = `Dear ${parentName}, this is a gentle reminder from ${schoolName} that your ward ${student.student_name} (${student.admission_number}, ${student.class_name || ''}) has an outstanding school fee balance of ${currSym}${outstandingNaira.toLocaleString()}. ${customNote ? customNote + ' ' : ''}Kindly make payment to ensure uninterrupted academic participation. Thank you for your continued partnership.`;

    // Generate Direct WhatsApp URL for the bursar/admin
    let cleanPhone = (student.parent_phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
      cleanPhone = '234' + cleanPhone.slice(1);
    }
    const whatsappUrl = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`
      : `https://wa.me/?text=${encodeURIComponent(messageText)}`;

    // Dispatch via in-app notification system
    try {
      notificationService.notify({
        schoolId,
        title: `Fee Reminder Dispatched: ${student.student_name}`,
        message: `Outstanding reminder for ${currSym}${outstandingNaira.toLocaleString()} dispatched for ${parentName}.`,
        type: 'FEE_REMINDER' as any,
        data: { studentId, parentPhone: student.parent_phone, parentEmail: student.parent_email, outstandingNaira },
      });
    } catch (e) {}

    // Audit log
    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'FEE_REMINDER_SENT',
      entity: 'INVOICE',
      entityId: studentId,
      ipAddress: req.ip || '127.0.0.1',
      metadata: {
        studentName: student.student_name,
        parentName,
        outstandingNaira,
        channel,
      },
    });

    return res.json({
      success: true,
      message: `Fee reminder prepared and dispatched for ${student.student_name}.`,
      recipient: {
        parentName,
        parentPhone: student.parent_phone || 'Not registered',
        parentEmail: student.parent_email || 'Not registered',
      },
      messageText,
      whatsappUrl,
      outstandingNaira,
    });
  }
);

// GET /api/v1/school/finance/reports/export/payments-csv
paymentRouter.get(
  '/finance/reports/export/payments-csv',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const payments = db.prepare(`
      SELECT p.payment_reference,
             p.internal_reference,
             p.payment_date,
             s.admission_number,
             s.full_name as student_name,
             inv.invoice_number,
             p.amount as amount_kobo,
             p.payment_method,
             p.status,
             p.notes
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      WHERE p.school_id = ?
      ORDER BY p.payment_date DESC
    `).all(schoolId) as any[];

    const header = 'Payment Reference,Internal Ref,Date,Admission Number,Student Name,Invoice Number,Amount (NGN),Method,Status,Notes\n';
    const rows = payments
      .map((p) => {
        const naira = (p.amount_kobo / 100).toFixed(2);
        const safeName = `"${(p.student_name || '').replace(/"/g, '""')}"`;
        const safeNotes = `"${(p.notes || '').replace(/"/g, '""')}"`;
        return `${p.payment_reference},${p.internal_reference || ''},${p.payment_date},${p.admission_number},${safeName},${p.invoice_number},${naira},${p.payment_method},${p.status},${safeNotes}`;
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="school_payments_${Date.now()}.csv"`);
    return res.send(header + rows);
  }
);

// GET /api/v1/school/finance/reports/export/invoices-csv
paymentRouter.get(
  '/finance/reports/export/invoices-csv',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const invoices = db.prepare(`
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
      ORDER BY inv.issue_date DESC
    `).all(schoolId) as any[];

    const header = 'Invoice Number,Admission Number,Student Name,Class,Issue Date,Due Date,Subtotal (NGN),Discount (NGN),Total (NGN),Paid (NGN),Balance (NGN),Status,Notes\n';
    const rows = invoices
      .map((i) => {
        const safeName = `"${(i.student_name || '').replace(/"/g, '""')}"`;
        const safeNotes = `"${(i.notes || '').replace(/"/g, '""')}"`;
        return `${i.invoice_number},${i.admission_number},${safeName},"${i.class_name || ''}",${i.issue_date},${i.due_date},${(i.subtotal/100).toFixed(2)},${(i.discount/100).toFixed(2)},${(i.total/100).toFixed(2)},${(i.amount_paid/100).toFixed(2)},${(i.balance/100).toFixed(2)},${i.status},${safeNotes}`;
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="school_invoices_${Date.now()}.csv"`);
    return res.send(header + rows);
  }
);

// GET /api/v1/school/finance/reports/export/defaulters-csv
paymentRouter.get(
  '/finance/reports/export/defaulters-csv',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const defaulters = db.prepare(`
      SELECT s.admission_number,
             s.full_name as student_name,
             c.name as class_name,
             COALESCE(SUM(inv.total), 0) as total_billed,
             COALESCE(SUM(inv.amount_paid), 0) as total_paid,
             COALESCE(SUM(inv.balance), 0) as outstanding_balance,
             COUNT(inv.id) as unpaid_invoices_count
      FROM students s
      JOIN invoices inv ON s.id = inv.student_id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.school_id = ? AND inv.balance > 0 AND inv.status != 'CANCELLED'
      GROUP BY s.id
      ORDER BY outstanding_balance DESC
    `).all(schoolId) as any[];

    const header = 'Admission Number,Student Name,Class,Total Billed (NGN),Total Paid (NGN),Outstanding Balance (NGN),Unpaid Invoices Count\n';
    const rows = defaulters
      .map((d) => {
        const safeName = `"${(d.student_name || '').replace(/"/g, '""')}"`;
        return `${d.admission_number},${safeName},"${d.class_name || ''}",${(d.total_billed/100).toFixed(2)},${(d.total_paid/100).toFixed(2)},${(d.outstanding_balance/100).toFixed(2)},${d.unpaid_invoices_count}`;
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="school_defaulters_${Date.now()}.csv"`);
    return res.send(header + rows);
  }
);

// ==============================================================================
// 7. PAYMENT REVERSALS & REFUNDS (Phase 10)
// ==============================================================================

// POST /api/v1/school/payments/:id/reverse (Reverse confirmed payment with audit trail)
paymentRouter.post(
  '/payments/:id/reverse',
  requireAuth,
  requireTenant,
  requireRole(['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: paymentId } = req.params;
    const { reason, notes } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      return res.status(400).json({
        error: 'REASON_REQUIRED',
        message: 'A detailed mandatory reason (minimum 3 characters) is required to reverse a confirmed payment.',
      });
    }

    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND school_id = ?').get(paymentId, schoolId) as any;
    if (!payment) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Payment record not found.' });
    }

    if (payment.status === 'REVERSED' || payment.is_reversed === 1) {
      return res.status(400).json({ error: 'ALREADY_REVERSED', message: 'This payment has already been reversed.' });
    }

    if (payment.status !== 'CONFIRMED' && payment.status !== 'SUCCESS') {
      return res.status(400).json({
        error: 'INVALID_STATUS',
        message: `Cannot reverse payment with status "${payment.status}". Only confirmed payments can be reversed.`,
      });
    }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(payment.invoice_id, schoolId) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'INVOICE_NOT_FOUND', message: 'Associated invoice not found.' });
    }

    const reversalAmount = payment.amount;
    const newAmountPaid = Math.max(0, invoice.amount_paid - reversalAmount);
    const newBalance = Math.min(invoice.total, invoice.total - newAmountPaid);
    const newStatus = determineInvoiceStatus(invoice.total, newAmountPaid, invoice.due_date, invoice.status);

    const reversalId = `rev_${crypto.randomBytes(8).toString('hex')}`;

    
    // Feature Flag: Controlled routing to PostgreSQL-native financial service
    if (process.env.FEATURE_POSTGRES_FINANCIAL_SERVICE === 'true' && isPgConnected()) {
      const pgRevResult = await reversePaymentPg({
        schoolId,
        paymentId,
        reason: reason.trim(),
        reversedByUserId: req.user!.id,
        reversedByUserEmail: req.user!.email,
      });

      if (!pgRevResult.success || !pgRevResult.data) {
        return res.status(pgRevResult.code === 'ALREADY_REVERSED' ? 400 : 500).json({
          error: pgRevResult.code || 'REVERSAL_FAILED',
          message: pgRevResult.error,
        });
      }

      logAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        schoolId,
        action: 'PAYMENT_REVERSED_PG',
        entity: 'PAYMENT',
        entityId: paymentId,
        metadata: { reversalAmount, reason: reason.trim() },
      });

      return res.json({
        success: true,
        message: 'Payment reversed successfully via PostgreSQL financial engine.',
        reversal: pgRevResult.data.reversal,
        payment: pgRevResult.data.payment,
        invoice: pgRevResult.data.invoice,
      });
    }

    // Execute atomic reversal
    db.exec('BEGIN TRANSACTION;');
    try {
      // 1. Mark payment record as REVERSED (preserves original event, never deletes)
      db.prepare(`
        UPDATE payments SET
          status = 'REVERSED',
          is_reversed = 1,
          reversed_at = CURRENT_TIMESTAMP,
          reversed_by = ?,
          reversal_reason = ?,
          notes = COALESCE(notes, '') || ' | REVERSED: ' || ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?
      `).run(req.user!.email, reason.trim(), reason.trim(), paymentId, schoolId);

      // 2. Insert audit log record into payment_reversals table
      db.prepare(`
        INSERT INTO payment_reversals (
          id, school_id, payment_id, invoice_id, student_id, amount_kobo,
          reversal_type, reason, initiated_by, approved_by, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'FULL_REVERSAL', ?, ?, ?, 'APPROVED', CURRENT_TIMESTAMP)
      `).run(
        reversalId,
        schoolId,
        paymentId,
        invoice.id,
        payment.student_id,
        reversalAmount,
        reason.trim(),
        req.user!.email,
        req.user!.email
      );

      // 3. Update invoice balance and status
      db.prepare(`
        UPDATE invoices SET
          amount_paid = ?,
          balance = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?
      `).run(newAmountPaid, newBalance, newStatus, invoice.id, schoolId);

      db.exec('COMMIT;');
    } catch (err: any) {
      db.exec('ROLLBACK;');
      console.error("[REVERSAL_ERROR_DETAIL]:", err); return res.status(500).json({ error: 'REVERSAL_FAILED', message: err.message });
    }

    // 4. Audit logging
    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'PAYMENT_REVERSED',
      entity: 'PAYMENT',
      entityId: paymentId,
      ipAddress: req.ip,
      metadata: {
        reversalId,
        amountKobo: reversalAmount,
        amountNaira: toNaira(reversalAmount),
        reason: reason.trim(),
        oldInvoiceBalance: invoice.balance,
        newInvoiceBalance: newBalance,
      },
    });

    return res.json({
      success: true,
      message: `Payment #${payment.payment_reference} for ₦${toNaira(reversalAmount).toLocaleString()} reversed successfully. Invoice balance restored to ₦${toNaira(newBalance).toLocaleString()}.`,
      reversalId,
      newInvoiceBalance: newBalance,
      newInvoiceStatus: newStatus,
    });
  }
);

// POST /api/v1/school/payments/:id/refund (Process partial or full refund)
paymentRouter.post(
  '/payments/:id/refund',
  requireAuth,
  requireTenant,
  requireRole(['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: paymentId } = req.params;
    const { amount, amount_kobo, reason, refund_method = 'BANK_TRANSFER' } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      return res.status(400).json({
        error: 'REASON_REQUIRED',
        message: 'A mandatory reason is required to process a refund.',
      });
    }

    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND school_id = ?').get(paymentId, schoolId) as any;
    if (!payment) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Payment record not found.' });
    }

    if (payment.status === 'REVERSED') {
      return res.status(400).json({ error: 'PAYMENT_REVERSED', message: 'Cannot refund a reversed payment.' });
    }

    const refundKobo = amount_kobo !== undefined ? Math.round(Number(amount_kobo)) : (amount !== undefined ? toKobo(amount) : payment.amount);
    if (refundKobo <= 0 || refundKobo > payment.amount) {
      return res.status(400).json({
        error: 'INVALID_AMOUNT',
        message: `Refund amount must be between ₦1 and payment total ₦${toNaira(payment.amount).toLocaleString()}.`,
      });
    }

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(payment.invoice_id, schoolId) as any;
    if (!invoice) {
      return res.status(404).json({ error: 'INVOICE_NOT_FOUND', message: 'Associated invoice not found.' });
    }

    const newAmountPaid = Math.max(0, invoice.amount_paid - refundKobo);
    const newBalance = Math.min(invoice.total, invoice.total - newAmountPaid);
    const newStatus = determineInvoiceStatus(invoice.total, newAmountPaid, invoice.due_date, invoice.status);
    const isFullRefund = refundKobo >= payment.amount;

    const refundId = `ref_${crypto.randomBytes(8).toString('hex')}`;

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        UPDATE payments SET
          status = CASE WHEN ? = 1 THEN 'REFUNDED' ELSE status END,
          is_refunded = 1,
          refunded_at = CURRENT_TIMESTAMP,
          refunded_by = ?,
          refund_reason = ?,
          refund_amount = COALESCE(refund_amount, 0) + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?
      `).run(isFullRefund ? 1 : 0, req.user!.email, reason.trim(), refundKobo, paymentId, schoolId);

      db.prepare(`
        INSERT INTO payment_reversals (
          id, school_id, payment_id, invoice_id, student_id, amount_kobo,
          reversal_type, reason, initiated_by, approved_by, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'REFUND', ?, ?, ?, 'APPROVED', CURRENT_TIMESTAMP)
      `).run(
        refundId,
        schoolId,
        paymentId,
        invoice.id,
        payment.student_id,
        refundKobo,
        reason.trim(),
        req.user!.email,
        req.user!.email
      );

      db.prepare(`
        UPDATE invoices SET
          amount_paid = ?,
          balance = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?
      `).run(newAmountPaid, newBalance, newStatus, invoice.id, schoolId);

      db.exec('COMMIT;');
    } catch (err: any) {
      db.exec('ROLLBACK;');
      return res.status(500).json({ error: 'REFUND_FAILED', message: err.message });
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'PAYMENT_REFUNDED',
      entity: 'PAYMENT',
      entityId: paymentId,
      metadata: { refundId, refundKobo, reason: reason.trim(), refund_method },
    });

    return res.json({
      success: true,
      message: `Refund of ₦${toNaira(refundKobo).toLocaleString()} processed successfully. Invoice balance updated to ₦${toNaira(newBalance).toLocaleString()}.`,
      refundId,
      refundKobo,
      newInvoiceBalance: newBalance,
    });
  }
);

// ==============================================================================
// 8. PAYMENT RECONCILIATION WORKSPACE (Phase 6)
// ==============================================================================

// GET /api/v1/school/finance/reconciliation (Reconciliation workspace overview)
paymentRouter.get(
  '/finance/reconciliation',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { status = 'ALL', date_from, date_to } = req.query as Record<string, string>;

    try {
      // 1. Reconciliation summary calculations
      const totalPaymentsCount = (db.prepare('SELECT COUNT(*) as c FROM payments WHERE school_id = ?').get(schoolId) as any)?.c || 0;
      const totalPaymentsKobo = (db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE school_id = ? AND status IN ('CONFIRMED', 'SUCCESS')").get(schoolId) as any)?.s || 0;
      
      const matchedCount = (db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ? AND reconciliation_status = 'MATCHED'").get(schoolId) as any)?.c || 0;
      const matchedKobo = (db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE school_id = ? AND reconciliation_status = 'MATCHED'").get(schoolId) as any)?.s || 0;

      const unmatchedCount = (db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ? AND (reconciliation_status IS NULL OR reconciliation_status = 'UNMATCHED') AND status IN ('CONFIRMED', 'SUCCESS')").get(schoolId) as any)?.c || 0;
      const unmatchedKobo = (db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM payments WHERE school_id = ? AND (reconciliation_status IS NULL OR reconciliation_status = 'UNMATCHED') AND status IN ('CONFIRMED', 'SUCCESS')").get(schoolId) as any)?.s || 0;

      const statementEntriesCount = (db.prepare('SELECT COUNT(*) as c FROM bank_statement_entries WHERE school_id = ?').get(schoolId) as any)?.c || 0;
      const statementCreditKobo = (db.prepare("SELECT COALESCE(SUM(amount_kobo), 0) as s FROM bank_statement_entries WHERE school_id = ? AND entry_type = 'CREDIT'").get(schoolId) as any)?.s || 0;

      // 2. Query payments for table
      let paymentsSql = `
        SELECT p.*,
               inv.invoice_number,
               s.full_name as student_name,
               s.admission_number,
               c.name as class_name,
               r.receipt_number
        FROM payments p
        JOIN invoices inv ON p.invoice_id = inv.id
        JOIN students s ON p.student_id = s.id
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN receipts r ON p.id = r.payment_id
        WHERE p.school_id = ?
      `;
      const params: any[] = [schoolId];

      if (status && status !== 'ALL') {
        paymentsSql += ` AND p.reconciliation_status = ?`;
        params.push(status);
      }
      if (date_from) {
        paymentsSql += ` AND p.payment_date >= ?`;
        params.push(date_from);
      }
      if (date_to) {
        paymentsSql += ` AND p.payment_date <= ?`;
        params.push(date_to);
      }

      paymentsSql += ` ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 100`;
      const payments = db.prepare(paymentsSql).all(...params) as any[];

      // 3. Bank statement entries
      const statementEntries = db.prepare(`
        SELECT * FROM bank_statement_entries WHERE school_id = ? ORDER BY transaction_date DESC LIMIT 50
      `).all(schoolId) as any[];

      return res.json({
        success: true,
        summary: {
          totalPaymentsCount,
          totalPaymentsKobo,
          totalPaymentsNaira: toNaira(totalPaymentsKobo),
          matchedCount,
          matchedKobo,
          matchedNaira: toNaira(matchedKobo),
          unmatchedCount,
          unmatchedKobo,
          unmatchedNaira: toNaira(unmatchedKobo),
          reconciledPercent: totalPaymentsCount > 0 ? Math.round((matchedCount / totalPaymentsCount) * 100) : 0,
          statementEntriesCount,
          statementCreditKobo,
          statementCreditNaira: toNaira(statementCreditKobo),
        },
        payments: payments.map((p) => ({
          ...p,
          amount_naira: toNaira(p.amount),
          reconciliation_status: p.reconciliation_status || 'UNMATCHED',
        })),
        statementEntries: statementEntries.map((e) => ({
          ...e,
          amount_naira: toNaira(e.amount_kobo),
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'RECONCILIATION_ERROR', message: err.message });
    }
  }
);

// POST /api/v1/school/finance/reconciliation/match (Confirm match or decision)
paymentRouter.post(
  '/finance/reconciliation/match',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { payment_id, statement_entry_id, status = 'MATCHED', notes } = req.body;

    if (!payment_id) {
      return res.status(400).json({ error: 'MISSING_PAYMENT_ID', message: 'Payment ID is required.' });
    }

    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND school_id = ?').get(payment_id, schoolId) as any;
    if (!payment) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Payment not found.' });
    }

    db.prepare(`
      UPDATE payments SET
        reconciliation_status = ?,
        reconciled_at = CURRENT_TIMESTAMP,
        reconciled_by = ?,
        reconciliation_notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(status, req.user!.email, notes || null, payment_id, schoolId);

    if (statement_entry_id) {
      db.prepare(`
        UPDATE bank_statement_entries SET
          matched_payment_id = ?,
          match_status = ?,
          reconciled_at = CURRENT_TIMESTAMP,
          reconciled_by = ?,
          reconciliation_decision = ?
        WHERE id = ? AND school_id = ?
      `).run(payment_id, status, req.user!.email, notes || 'Matched with BursarIQ payment ledger', statement_entry_id, schoolId);
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'PAYMENT_RECONCILED',
      entity: 'PAYMENT',
      entityId: payment_id,
      metadata: { status, statement_entry_id, notes },
    });

    return res.json({
      success: true,
      message: `Payment reconciliation status updated to ${status}.`,
    });
  }
);

// POST /api/v1/school/finance/reconciliation/import-statement (Import bank statement records)
paymentRouter.post(
  '/finance/reconciliation/import-statement',
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'NO_ENTRIES', message: 'An array of bank statement entries is required.' });
    }

    let importedCount = 0;
    let autoMatchedCount = 0;

    const insertStmt = db.prepare(`
      INSERT INTO bank_statement_entries (
        id, school_id, transaction_date, value_date, reference, description,
        amount, amount_kobo, entry_type, channel, payer_name, matched_payment_id,
        match_status, imported_at, imported_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `);

    db.exec('BEGIN TRANSACTION;');
    try {
      for (const entry of entries) {
        const id = `bse_${crypto.randomBytes(8).toString('hex')}`;
        const amtKobo = entry.amount_kobo !== undefined ? Math.round(Number(entry.amount_kobo)) : toKobo(entry.amount || 0);
        const ref = (entry.reference || '').trim();
        const txDate = entry.transaction_date || new Date().toISOString().slice(0, 10);

        // Attempt automatic match against payment reference or provider reference
        let matchedPaymentId: string | null = null;
        let matchStatus = 'UNMATCHED';

        if (ref) {
          const match = db.prepare(`
            SELECT id FROM payments
            WHERE school_id = ? AND (payment_reference = ? OR provider_reference = ? OR internal_reference = ?)
          `).get(schoolId, ref, ref, ref) as any;

          if (match) {
            matchedPaymentId = match.id;
            matchStatus = 'MATCHED';
            autoMatchedCount++;

            // Update payment record as well
            db.prepare(`
              UPDATE payments SET
                reconciliation_status = 'MATCHED',
                reconciled_at = CURRENT_TIMESTAMP,
                reconciled_by = 'AUTO_BANK_STATEMENT_RECONCILER',
                reconciliation_notes = 'Auto-matched on reference: ' || ?
              WHERE id = ? AND school_id = ?
            `).run(ref, match.id, schoolId);
          }
        }

        insertStmt.run(
          id,
          schoolId,
          txDate,
          entry.value_date || txDate,
          ref,
          entry.description || null,
          amtKobo,
          amtKobo,
          entry.entry_type || 'CREDIT',
          entry.channel || 'TRANSFER',
          entry.payer_name || null,
          matchedPaymentId,
          matchStatus,
          req.user!.email
        );
        importedCount++;
      }
      db.exec('COMMIT;');
    } catch (err: any) {
      db.exec('ROLLBACK;');
      console.error("[IMPORT_STATEMENT_ERR]:", err); return res.status(500).json({ error: 'IMPORT_FAILED', message: err.message });
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'BANK_STATEMENT_IMPORTED',
      entity: 'RECONCILIATION',
      metadata: { importedCount, autoMatchedCount },
    });

    return res.json({
      success: true,
      message: `Imported ${importedCount} bank statement records (${autoMatchedCount} automatically matched with payments).`,
      importedCount,
      autoMatchedCount,
      unmatchedCount: importedCount - autoMatchedCount,
    });
  }
);

// GET /api/v1/school/data-export/archive (Phase 9: Complete School Data Archive)
paymentRouter.get(
  '/data-export/archive',
  requireAuth,
  requireTenant,
  requireRole(['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;

    try {
      const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
      const academicSessions = db.prepare('SELECT * FROM academic_sessions WHERE school_id = ?').all(schoolId);
      const classes = db.prepare('SELECT * FROM classes WHERE school_id = ?').all(schoolId);
      const classArms = db.prepare('SELECT * FROM class_arms WHERE school_id = ?').all(schoolId);
      const staff = db.prepare('SELECT * FROM staff WHERE school_id = ?').all(schoolId);
      const students = db.prepare('SELECT * FROM students WHERE school_id = ?').all(schoolId);
      const parents = db.prepare('SELECT * FROM parents WHERE school_id = ?').all(schoolId);
      const feeCategories = db.prepare('SELECT * FROM fee_categories WHERE school_id = ?').all(schoolId);
      const feeStructures = db.prepare('SELECT * FROM fee_structures WHERE school_id = ?').all(schoolId);
      const feeStructureItems = db.prepare('SELECT * FROM fee_structure_items WHERE school_id = ?').all(schoolId);
      const invoices = db.prepare('SELECT * FROM invoices WHERE school_id = ?').all(schoolId);
      const invoiceItems = db.prepare('SELECT * FROM invoice_items WHERE school_id = ?').all(schoolId);
      const payments = db.prepare('SELECT * FROM payments WHERE school_id = ?').all(schoolId);
      const receipts = db.prepare('SELECT * FROM receipts WHERE school_id = ?').all(schoolId);
      const reversals = db.prepare('SELECT * FROM payment_reversals WHERE school_id = ?').all(schoolId);
      const bankEntries = db.prepare('SELECT * FROM bank_statement_entries WHERE school_id = ?').all(schoolId);
      const auditLogs = db.prepare('SELECT * FROM audit_logs WHERE school_id = ? ORDER BY created_at DESC LIMIT 500').all(schoolId);

      const manifest = {
        exportedAt: new Date().toISOString(),
        exportedBy: req.user!.email,
        schoolId,
        formatVersion: '1.0.0',
        entityCounts: {
          academicSessions: academicSessions.length,
          classes: classes.length,
          classArms: classArms.length,
          staff: staff.length,
          students: students.length,
          parents: parents.length,
          feeCategories: feeCategories.length,
          feeStructures: feeStructures.length,
          invoices: invoices.length,
          payments: payments.length,
          receipts: receipts.length,
          reversals: reversals.length,
          bankEntries: bankEntries.length,
          auditLogs: auditLogs.length,
        },
      };

      logAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        schoolId,
        action: 'COMPLETE_SCHOOL_DATA_ARCHIVE_EXPORTED',
        entity: 'SCHOOL_DATA_EXPORT',
        metadata: manifest.entityCounts,
      });

      return res.json({
        success: true,
        manifest,
        archive: {
          school,
          academicSessions,
          classes,
          classArms,
          staff,
          students,
          parents,
          feeCategories,
          feeStructures,
          feeStructureItems,
          invoices,
          invoiceItems,
          payments,
          receipts,
          reversals,
          bankEntries,
          auditLogs,
        },
      });
    } catch (err: any) {
      console.error("[ARCHIVE_EXPORT_ERR]:", err); return res.status(500).json({ error: 'ARCHIVE_EXPORT_FAILED', message: err.message });
    }
  }
);

