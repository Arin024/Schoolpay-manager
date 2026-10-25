import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, cacheDb, queryPg, getPgPool, isPgConnected, ensurePgConnected } from './db.ts';
import { requireAuth, requireSuperAdmin, type AuthenticatedRequest } from './tenantMiddleware.ts';
import { logAudit } from './audit.ts';
import { toKobo, toNaira } from './financeUtils.ts';
import { createImpersonationSession, destroySession, hashPassword, generateSalt } from './auth.ts';
import { SCHOOL_STATUSES } from '../src/constants/index.ts';

export const adminRouter = Router();

// ==============================================================================
// 1. GLOBAL PLATFORM DASHBOARD METRICS (SUPER ADMIN ONLY)
// ==============================================================================

adminRouter.get('/stats', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  // 1. School Status Counts
  const totalSchools = (db.prepare('SELECT COUNT(*) as c FROM schools').get() as any).c;
  const activeSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'ACTIVE'").get() as any).c;
  const trialSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'TRIAL'").get() as any).c;
  const graceSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'GRACE_PERIOD'").get() as any).c;
  const suspendedSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'SUSPENDED'").get() as any).c;
  const expiredSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'EXPIRED'").get() as any).c;
  const cancelledSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'CANCELLED'").get() as any).c;

  // 2. Global Entity Counts
  const totalStudents = (db.prepare('SELECT COUNT(*) as c FROM students').get() as any).c;
  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const totalStaff = (db.prepare('SELECT COUNT(*) as c FROM staff').get() as any).c;
  const totalInvoices = (db.prepare('SELECT COUNT(*) as c FROM invoices').get() as any).c;
  const totalPayments = (db.prepare('SELECT COUNT(*) as c FROM payments').get() as any).c;

  // 3. Platform SaaS Subscription Revenue (Fees paid BY schools TO platform)
  const platformRevenueRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo, COUNT(*) as count
    FROM platform_payments
    WHERE status = 'SUCCESS'
  `).get() as any;
  const platformRevenueKobo = Number(platformRevenueRow.total_kobo);

  // 4. School-Collected Money (Fees collected BY schools FROM parents - distinct from platform SaaS revenue!)
  const schoolRevenueRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo, COUNT(*) as count
    FROM payments
    WHERE status = 'SUCCESS'
  `).get() as any;
  const schoolCollectedRevenueKobo = Number(schoolRevenueRow.total_kobo);

  // 5. Subscription Metrics
  const activeSubscriptions = (db.prepare("SELECT COUNT(*) as c FROM school_subscriptions WHERE status = 'ACTIVE'").get() as any).c;
  const expiringSubscriptions = (db.prepare(`
    SELECT COUNT(*) as c FROM school_subscriptions
    WHERE status = 'ACTIVE' AND date(end_date) <= date('now', '+30 days')
  `).get() as any).c;

  // 6. Partners & Commissions
  const totalPartners = (db.prepare('SELECT COUNT(*) as c FROM partners WHERE status = \'ACTIVE\'').get() as any).c;
  const commissionRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo
    FROM commissions
    WHERE status IN ('APPROVED', 'PAID')
  `).get() as any;
  const totalCommissionsKobo = Number(commissionRow.total_kobo);

  // 7. Recent Platform Audit Activity
  const recentActivity = db.prepare(`
    SELECT al.*, s.name as school_name
    FROM audit_logs al
    LEFT JOIN schools s ON al.school_id = s.id
    ORDER BY al.created_at DESC
    LIMIT 10
  `).all();

  return res.json({
    success: true,
    stats: {
      totalSchools,
      activeSchools,
      trialSchools,
      graceSchools,
      suspendedSchools,
      expiredSchools,
      cancelledSchools,
      totalStudents,
      totalUsers,
      totalStaff,
      totalInvoices,
      totalPayments,
      platformRevenueKobo,
      platformRevenueNaira: toNaira(platformRevenueKobo),
      schoolCollectedRevenueKobo,
      schoolCollectedRevenueNaira: toNaira(schoolCollectedRevenueKobo),
      activeSubscriptions,
      expiringSubscriptions,
      totalPartners,
      totalCommissionsKobo,
      totalCommissionsNaira: toNaira(totalCommissionsKobo),
      recentActivity,
    },
  });
});

// ==============================================================================
// 2. SCHOOL DIRECTORY & GLOBAL SEARCH (SUPER ADMIN ONLY)
// ==============================================================================

adminRouter.get('/schools', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  // Ensure newly registered schools from Neon PostgreSQL are fully reconciled in local engine FIRST
  try {
    const { getPgPool, isPgConnected, reconcileCacheFromNeon, db: syncDb } = await import('./db.ts');
    const pool = getPgPool();
    if (pool && isPgConnected()) {
      const countRes = await pool.query('SELECT count(*) as count FROM schools');
      const pgCount = parseInt(countRes.rows[0].count, 10);
      const localCount = (syncDb.prepare('SELECT count(*) as count FROM schools').get() as any)?.count || 0;
      if (pgCount !== localCount) {
        await reconcileCacheFromNeon();
      }
    }
  } catch (e) {}

  const { search, status, plan_id, state } = req.query;

  let query = `
    SELECT s.*,
           p.display_name as plan_display_name,
           p.name as plan_name,
           sub.status as subscription_status,
           sub.end_date as subscription_end_date,
           (SELECT COUNT(*) FROM students stu WHERE stu.school_id = s.id) as total_students,
           (SELECT COUNT(*) FROM staff st WHERE st.school_id = s.id) as total_staff,
           (SELECT COUNT(*) FROM user_roles ur WHERE ur.school_id = s.id) as total_users,
           (SELECT u.full_name FROM user_roles ur JOIN users u ON ur.user_id = u.id WHERE ur.school_id = s.id AND ur.role_id = 'role_school_owner' LIMIT 1) as owner_name,
           (SELECT u.email FROM user_roles ur JOIN users u ON ur.user_id = u.id WHERE ur.school_id = s.id AND ur.role_id = 'role_school_owner' LIMIT 1) as owner_email,
           (SELECT COALESCE(SUM(inv.total), 0) FROM invoices inv WHERE inv.school_id = s.id) as total_invoiced,
           (SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay WHERE pay.school_id = s.id AND pay.status = 'SUCCESS') as total_collected
    FROM schools s
    LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
    LEFT JOIN school_subscriptions sub ON sub.id = (
      SELECT id FROM school_subscriptions 
      WHERE school_id = s.id AND status = 'ACTIVE' 
      ORDER BY end_date DESC, created_at DESC 
      LIMIT 1
    )
    WHERE 1=1
  `;
  const params: any[] = [];

  if (search && typeof search === 'string' && search.trim() !== '') {
    const term = `%${search.trim().toLowerCase()}%`;
    query += ` AND (LOWER(s.name) LIKE ? OR LOWER(s.email) LIKE ? OR LOWER(s.phone) LIKE ? OR LOWER(s.slug) LIKE ? OR LOWER(s.id) LIKE ?)`;
    params.push(term, term, term, term, term);
  }

  if (status && status !== 'ALL') {
    query += ` AND s.status = ?`;
    params.push(status);
  }

  if (plan_id && plan_id !== 'ALL') {
    query += ` AND s.current_plan_id = ?`;
    params.push(plan_id);
  }

  if (state && state !== 'ALL') {
    query += ` AND s.state = ?`;
    params.push(state);
  }

  query += ` ORDER BY s.created_at DESC`;



  const rows = db.prepare(query).all(...params) as any[];

  return res.json({
    success: true,
    schools: rows.map((s) => ({
      ...s,
      total_invoiced_naira: toNaira(s.total_invoiced || 0),
      total_collected_naira: toNaira(s.total_collected || 0),
      outstanding_naira: toNaira(Math.max(0, (s.total_invoiced || 0) - (s.total_collected || 0))),
    })),
  });
});

// POST /admin/schools (Create a new school tenant with owner)
adminRouter.post('/schools', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  const {
    name,
    slug,
    type,
    state,
    lga,
    phone,
    email,
    address,
    status = 'TRIAL',
    plan_id = 'plan_trial',
    owner_name,
    owner_email,
    owner_phone,
    owner_password = 'Password123!',
  } = req.body;

  if (!name || !email || !state || !lga || !phone) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Name, email, state, LGA, and phone are required.' });
  }

  const cleanSlug = (slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')).slice(0, 32);
  const schoolId = `sch_${cleanSlug.replace(/-/g, '_')}_${Date.now().toString().slice(-4)}`;

  // Check uniqueness
  const existingEmail = db.prepare('SELECT id FROM schools WHERE email = ?').get(email);
  if (existingEmail) {
    return res.status(400).json({ error: 'EMAIL_EXISTS', message: 'School email is already registered.' });
  }

  try {
    // 1. Insert School
    db.prepare(`
      INSERT INTO schools (id, name, slug, type, status, state, lga, phone, email, address, current_plan_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(schoolId, name, cleanSlug, type || 'Comprehensive / K-12', status, state, lga, phone, email, address || null, plan_id);

    // 2. Insert School Settings
    db.prepare(`
      INSERT INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term)
      VALUES (?, ?, 'NGN', '₦', '2024/2025', '1st Term')
    `).run(`set_${schoolId}`, schoolId);

    // 3. Create initial Subscription
    const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;
    const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO school_subscriptions (id, school_id, plan_id, status, start_date, end_date, trial_end_date, amount_paid, notes)
      VALUES (?, ?, ?, ?, date('now'), ?, ?, 0, 'Initial tenant setup subscription')
    `).run(subId, schoolId, plan_id, status === 'ACTIVE' ? 'ACTIVE' : 'TRIAL', subEnd, subEnd);

    // 4. Create Owner User if provided
    let createdUserId = '';
    if (owner_email) {
      let existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(owner_email) as any;
      if (!existingUser) {
        createdUserId = `usr_owner_${Date.now()}`;
        const salt = generateSalt();
        const pwdHash = hashPassword(owner_password, salt);
        db.prepare(`
          INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 0, 1)
        `).run(createdUserId, owner_email, pwdHash, salt, owner_name || `${name} Proprietor`, owner_phone || phone);
      } else {
        createdUserId = existingUser.id;
      }

      // Assign role_school_owner
      const urId = `ur_${crypto.randomBytes(6).toString('hex')}`;
      db.prepare(`
        INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
        VALUES (?, ?, ?, 'role_school_owner', 1)
      `).run(urId, createdUserId, schoolId);
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'SCHOOL_CREATED',
      entity: 'SCHOOL',
      entityId: schoolId,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { name, slug: cleanSlug, plan_id, owner_email },
    });

        // Direct synchronous durability write to Neon PostgreSQL
    try {
      const { getPgPool, isPgConnected } = await import('./db.ts');
      const pool = getPgPool();
      if (pool && isPgConnected()) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO schools (id, name, slug, type, status, state, lga, phone, email, address, current_plan_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
            [schoolId, name, cleanSlug, type || 'Comprehensive / K-12', status, state, lga, phone, email, address || null, plan_id]
          );
          await client.query(
            `INSERT INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term)
             VALUES ($1, $2, 'NGN', '₦', '2024/2025', '1st Term')
             ON CONFLICT (id) DO NOTHING`,
            [`set_${schoolId}`, schoolId]
          );
          await client.query(
            `INSERT INTO school_subscriptions (id, school_id, plan_id, status, start_date, end_date, trial_end_date, amount_paid, notes)
             VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, 0, 'Initial tenant setup subscription')
             ON CONFLICT (id) DO NOTHING`,
            [subId, schoolId, plan_id, status === 'ACTIVE' ? 'ACTIVE' : 'TRIAL', subEnd, subEnd]
          );
          if (createdUserId) {
            const ownerSalt = generateSalt();
            const ownerHash = hashPassword(owner_password, ownerSalt);
            await client.query(
              `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
               VALUES ($1, $2, $3, $4, $5, $6, 0, 1)
               ON CONFLICT (id) DO NOTHING`,
              [createdUserId, owner_email, ownerHash, ownerSalt, owner_name || `${name} Proprietor`, owner_phone || phone]
            );
            await client.query(
              `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
               VALUES ($1, $2, $3, 'role_school_owner', 1)
               ON CONFLICT (id) DO NOTHING`,
              [`ur_${crypto.randomBytes(6).toString('hex')}`, createdUserId, schoolId]
            );
          }
          await client.query('COMMIT');
        } catch (pgErr) {
          await client.query('ROLLBACK');
          console.error('[Admin School Creation PostgreSQL Error]', pgErr);
          throw new Error('PostgreSQL persistence failed: ' + (pgErr as any)?.message);
        } finally {
          client.release();
        }
      }
    } catch (e: any) {
      console.warn('[Admin School Creation Replication Warning]', e.message);
    }

    const created = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
    return res.status(201).json({
      success: true,
      message: 'School tenant successfully created.',
      school: created,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'CREATE_FAILED', message: err.message || 'Failed to create school' });
  }
});

// GET /admin/schools/:schoolId (Deep dive into school details, usage, subscription history)
adminRouter.get('/schools/:schoolId', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { schoolId } = req.params;
  const school = db.prepare(`
    SELECT s.*, p.display_name as plan_display_name, p.name as plan_name, p.feature_flags as plan_feature_flags
    FROM schools s
    LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
    WHERE s.id = ?
  `).get(schoolId) as any;

  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'School not found' });
  }

  const settings = db.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId);

  // Users & Staff
  const users = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.phone, u.created_at, r.name as role_name, r.display_name as role_display_name
    FROM user_roles ur
    JOIN users u ON ur.user_id = u.id
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.school_id = ?
  `).all(schoolId);

  // Usage Statistics
  const studentCount = (db.prepare('SELECT COUNT(*) as c FROM students WHERE school_id = ?').get(schoolId) as any).c;
  const staffCount = (db.prepare('SELECT COUNT(*) as c FROM staff WHERE school_id = ?').get(schoolId) as any).c;
  const classCount = (db.prepare('SELECT COUNT(*) as c FROM classes WHERE school_id = ?').get(schoolId) as any).c;
  const invoiceCount = (db.prepare('SELECT COUNT(*) as c FROM invoices WHERE school_id = ?').get(schoolId) as any).c;

  const financialRow = db.prepare(`
    SELECT 
      COALESCE(SUM(total), 0) as total_invoiced,
      COALESCE(SUM(amount_paid), 0) as total_collected,
      COALESCE(SUM(balance), 0) as outstanding
    FROM invoices
    WHERE school_id = ? AND status != 'CANCELLED'
  `).get(schoolId) as any;

  // Subscription History
  const subscriptions = db.prepare(`
    SELECT sub.*, p.display_name as plan_display_name, p.price as plan_price
    FROM school_subscriptions sub
    JOIN subscription_plans p ON sub.plan_id = p.id
    WHERE sub.school_id = ?
    ORDER BY sub.created_at DESC
  `).all(schoolId);

  // Audit Logs
  const recentLogs = db.prepare(`
    SELECT * FROM audit_logs WHERE school_id = ? ORDER BY created_at DESC LIMIT 25
  `).all(schoolId);

  return res.json({
    success: true,
    school,
    settings,
    users,
    usage: {
      students: studentCount,
      staff: staffCount,
      classes: classCount,
      invoices: invoiceCount,
      totalInvoicedNaira: toNaira(Number(financialRow.total_invoiced)),
      totalCollectedNaira: toNaira(Number(financialRow.total_collected)),
      outstandingNaira: toNaira(Number(financialRow.outstanding)),
    },
    subscriptions,
    recentLogs,
  });
});

// PATCH /admin/schools/:schoolId (Edit school profile)
adminRouter.patch('/schools/:schoolId', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { schoolId } = req.params;
  const { name, phone, email, state, lga, address, type, website, logo_url } = req.body;

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'School not found' });
  }

  try {
    db.prepare(`
      UPDATE schools SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        state = COALESCE(?, state),
        lga = COALESCE(?, lga),
        address = COALESCE(?, address),
        type = COALESCE(?, type),
        website = COALESCE(?, website),
        logo_url = COALESCE(?, logo_url),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, phone, email, state, lga, address, type, website, logo_url, schoolId);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'UPDATE_SCHOOL_PROFILE',
      entity: 'SCHOOL',
      entityId: schoolId,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { changes: req.body },
    });

    const updated = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
    return res.json({ success: true, message: 'School profile updated successfully.', school: updated });
  } catch (err: any) {
    return res.status(500).json({ error: 'UPDATE_FAILED', message: err.message });
  }
});

// PATCH /admin/schools/:schoolId/status (Update school status: TRIAL, ACTIVE, SUSPENDED, EXPIRED, CANCELLED)
adminRouter.patch('/schools/:schoolId/status', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { schoolId } = req.params;
  const { status, reason } = req.body;

  if (!status || !SCHOOL_STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'INVALID_STATUS',
      message: `Status must be one of: ${SCHOOL_STATUSES.join(', ')}`,
    });
  }

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'School not found' });
  }

  const previousStatus = school.status;
  db.prepare(`
    UPDATE schools SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, schoolId);

  // If status is SUSPENDED or EXPIRED, also update active subscriptions to reflect state
  if (['SUSPENDED', 'EXPIRED', 'CANCELLED'].includes(status)) {
    db.prepare(`
      UPDATE school_subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE school_id = ? AND status = 'ACTIVE'
    `).run(status, schoolId);
  }

  const actionName = status === 'SUSPENDED' ? 'SCHOOL_SUSPENDED' : (status === 'ACTIVE' ? 'SCHOOL_ACTIVATED' : 'UPDATE_SCHOOL_STATUS');

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    schoolId,
    action: actionName,
    entity: 'SCHOOL',
    entityId: schoolId,
    ipAddress: req.ip || '127.0.0.1',
    metadata: { previousStatus, newStatus: status, reason: reason || 'Platform administrator action' },
  });

  return res.json({
    success: true,
    message: `School status updated to ${status}. School data preserved safely.`,
    schoolId,
    status,
  });
});

// POST /admin/schools/:schoolId/subscription (Assign or renew school subscription plan)
// DELETE /admin/schools/:schoolId (Permanent purge of school account, users, and all associated tenant data)
adminRouter.delete('/schools/:schoolId', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  const { schoolId } = req.params;
  const { confirmationName, mode = 'PURGE' } = req.body || {};

  // Find school authoritatively from Neon PG first, fallback to SQLite
  let school: any = null;
  const pgSchool = await queryPg('SELECT * FROM schools WHERE id = $1', [schoolId]);
  if (pgSchool && pgSchool.rows.length > 0) {
    school = pgSchool.rows[0];
  } else {
    school = cacheDb.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
  }

  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'School not found' });
  }

  // Safety confirmation check if confirmationName is provided
  if (confirmationName && confirmationName.trim().toLowerCase().replace(/\s+/g, ' ') !== school.name.trim().toLowerCase().replace(/\s+/g, ' ')) {
    return res.status(400).json({
      error: 'CONFIRMATION_MISMATCH',
      message: `To delete this school, please confirm by typing its exact name "${school.name}".`,
    });
  }

  // ============================================================================
  // MODE 1: ARCHIVE / DEACTIVATE (Safe, non-destructive status update)
  // ============================================================================
  if (mode === 'ARCHIVE') {
    try {
      await queryPg("UPDATE schools SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [schoolId]);
      await queryPg("UPDATE school_subscriptions SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE school_id = $1 AND status = 'ACTIVE'", [schoolId]);

      cacheDb.prepare("UPDATE schools SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(schoolId);
      cacheDb.prepare("UPDATE school_subscriptions SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);

      // Invalidate active sessions for users belonging to this school
      await queryPg("DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM user_roles WHERE school_id = $1)", [schoolId]);
      try {
        cacheDb.prepare("DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM user_roles WHERE school_id = ?)").run(schoolId);
      } catch {}

      logAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        schoolId,
        action: 'SCHOOL_ARCHIVED',
        entity: 'SCHOOL',
        entityId: schoolId,
        ipAddress: req.ip || '127.0.0.1',
        metadata: { schoolName: school.name, archivedBy: req.user!.email },
      });

      return res.json({
        success: true,
        mode: 'ARCHIVE',
        message: `School "${school.name}" has been safely archived and deactivated. All academic and financial records remain preserved.`,
        schoolId,
      });
    } catch (err: any) {
      console.error('[Archive School Error]', err);
      return res.status(500).json({ error: 'ARCHIVE_FAILED', message: err.message });
    }
  }

  // ============================================================================
  // MODE 2: PURGE / PERMANENT DELETION (FK-safe authoritative database cleanup)
  // ============================================================================
  try {
    const pool = getPgPool();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Break FK dependency in audit_logs before school row is removed
        await client.query('UPDATE audit_logs SET school_id = NULL WHERE school_id = $1', [schoolId]);

        // 2. Identify users attached to this school
        const usersRes = await client.query('SELECT user_id FROM user_roles WHERE school_id = $1', [schoolId]);
        const userIds = usersRes.rows.map((r: any) => r.user_id);

        // 3. Child tables to delete safely using indexed numeric savepoints
        const tenantTables = [
          'receipts',
          'payments',
          'payment_receipts',
          'invoice_items',
          'invoices',
          'discount_assignments',
          'discounts',
          'fee_structure_items',
          'fee_structures',
          'fee_categories',
          'parent_students',
          'parents',
          'student_enrollments',
          'students',
          'class_arms',
          'classes',
          'staff',
          'terms',
          'academic_sessions',
          'school_bank_accounts',
          'school_payment_configs',
          'school_subscriptions',
          'school_settings',
          'recycle_bin',
          'notifications',
        ];

        for (let i = 0; i < tenantTables.length; i++) {
          const tbl = tenantTables[i];
          try {
            await client.query(`SAVEPOINT sp_tbl_${i}`);
            await client.query(`DELETE FROM ${tbl} WHERE school_id = $1`, [schoolId]);
            await client.query(`RELEASE SAVEPOINT sp_tbl_${i}`);
          } catch (tblErr) {
            await client.query(`ROLLBACK TO SAVEPOINT sp_tbl_${i}`);
          }
        }

        // 4. Remove school user_roles
        await client.query('DELETE FROM user_roles WHERE school_id = $1', [schoolId]);

        // 5. Clean up orphan users (users with no other school role and not platform admin)
        for (let j = 0; j < userIds.length; j++) {
          const uid = userIds[j];
          try {
            await client.query(`SAVEPOINT sp_usr_${j}`);
            const otherRoles = await client.query('SELECT id FROM user_roles WHERE user_id = $1', [uid]);
            if (otherRoles.rows.length === 0) {
              await client.query('UPDATE audit_logs SET actor_id = NULL WHERE actor_id = $1', [uid]);
              await client.query('DELETE FROM password_resets WHERE user_id = $1', [uid]);
              await client.query('DELETE FROM sessions WHERE user_id = $1', [uid]);
              await client.query('DELETE FROM users WHERE id = $1 AND is_platform_admin = 0', [uid]);
            }
            await client.query(`RELEASE SAVEPOINT sp_usr_${j}`);
          } catch (uErr) {
            await client.query(`ROLLBACK TO SAVEPOINT sp_usr_${j}`);
          }
        }

        // 6. Delete the school record itself
        await client.query('DELETE FROM schools WHERE id = $1', [schoolId]);

        await client.query('COMMIT');
      } catch (pgErr) {
        await client.query('ROLLBACK');
        console.error('[Admin Purge School PostgreSQL Error]', pgErr);
        throw pgErr;
      } finally {
        client.release();
      }
    }

    // Mirror cleanup in local SQLite cacheDb
    try {
      cacheDb.exec('BEGIN TRANSACTION;');

      const localUsers = cacheDb.prepare('SELECT user_id FROM user_roles WHERE school_id = ?').all(schoolId) as any[];

      const localTables = [
        'payment_receipts',
        'payments',
        'invoice_items',
        'invoices',
        'discount_assignments',
        'discounts',
        'fee_structure_items',
        'fee_structures',
        'fee_categories',
        'parent_students',
        'parents',
        'student_enrollments',
        'students',
        'class_arms',
        'classes',
        'staff',
        'terms',
        'academic_sessions',
        'school_bank_accounts',
        'school_payment_configs',
        'school_subscriptions',
        'school_settings',
        'recycle_bin',
        'notifications',
      ];

      for (const tbl of localTables) {
        try {
          cacheDb.prepare(`DELETE FROM ${tbl} WHERE school_id = ?`).run(schoolId);
        } catch {}
      }

      cacheDb.prepare('DELETE FROM user_roles WHERE school_id = ?').run(schoolId);

      for (const u of localUsers) {
        try {
          const remaining = cacheDb.prepare('SELECT id FROM user_roles WHERE user_id = ?').all(u.user_id);
          if (remaining.length === 0) {
            cacheDb.prepare('DELETE FROM password_resets WHERE user_id = ?').run(u.user_id);
            cacheDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.user_id);
            cacheDb.prepare('DELETE FROM users WHERE id = ? AND is_platform_admin = 0').run(u.user_id);
          }
        } catch {}
      }

      cacheDb.prepare('DELETE FROM schools WHERE id = ?').run(schoolId);
      cacheDb.exec('COMMIT;');
    } catch (sqliteErr) {
      try { cacheDb.exec('ROLLBACK;'); } catch {}
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId: null, // explicit null prevents FK violation against purged school
      action: 'SCHOOL_DELETED_PERMANENTLY',
      entity: 'SCHOOL',
      entityId: schoolId,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { schoolName: school.name, deletedBy: req.user!.email, mode: 'PURGE' },
    });

    return res.json({
      success: true,
      mode: 'PURGE',
      message: `School "${school.name}" and all associated data were permanently purged.`,
      schoolId,
    });
  } catch (err: any) {
    console.error('[Delete School Error]', err);
    return res.status(500).json({
      error: 'DELETE_FAILED',
      message: 'Failed to delete school: ' + (err?.message || 'Database error'),
    });
  }
});

// DELETE /admin/users/:userId (Permanent purge of an individual user account)
adminRouter.delete('/users/:userId', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
  const { userId } = req.params;

  if (userId === req.user!.id) {
    return res.status(400).json({
      error: 'CANNOT_DELETE_SELF',
      message: 'You cannot delete your own logged-in Super Admin account.',
    });
  }

  let user: any = null;
  const pgUser = await queryPg('SELECT * FROM users WHERE id = $1', [userId]);
  if (pgUser && pgUser.rows.length > 0) {
    user = pgUser.rows[0];
  } else {
    user = cacheDb.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
  }

  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'User account not found' });
  }

  if (user.is_platform_admin === 1 && req.user!.email !== 'SchoolPay28@gmail.com') {
    return res.status(403).json({
      error: 'PROTECTED_ADMIN',
      message: 'Only the Primary Platform Super Admin can delete other platform admin accounts.',
    });
  }

  try {
    // 1. Delete authoritatively from Neon PostgreSQL
    const pool = getPgPool();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE audit_logs SET actor_id = NULL WHERE actor_id = $1', [userId]);
        await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    // 2. Delete from local SQLite cacheDb
    try {
      cacheDb.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
      cacheDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      cacheDb.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
      cacheDb.prepare('DELETE FROM users WHERE id = ?').run(userId);
    } catch {}

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId: null,
      action: 'USER_DELETED_PERMANENTLY',
      entity: 'USER',
      entityId: userId,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { deletedUserEmail: user.email, deletedUserName: user.full_name },
    });

    return res.json({
      success: true,
      message: `User account "${user.full_name}" (${user.email}) was permanently deleted.`,
      userId,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'DELETE_FAILED',
      message: 'Failed to delete user account: ' + err.message,
    });
  }
});

adminRouter.post('/schools/:schoolId/subscription', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { schoolId } = req.params;
  const { plan_id, duration_months = 4, amount_paid_naira, provider = 'MANUAL', notes } = req.body;

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'School not found' });
  }

  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(plan_id) as any;
  if (!plan) {
    return res.status(404).json({ error: 'PLAN_NOT_FOUND', message: 'Subscription plan not found' });
  }

  const amountKobo = amount_paid_naira !== undefined ? toKobo(Number(amount_paid_naira)) : plan.price;
  const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;
  const startDate = new Date().toISOString().slice(0, 10);
  const endDateObj = new Date();
  endDateObj.setMonth(endDateObj.getMonth() + Number(duration_months));
  const endDate = endDateObj.toISOString().slice(0, 10);

  // Mark existing active subscriptions as EXPIRED
  db.prepare(`
    UPDATE school_subscriptions SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
    WHERE school_id = ? AND status = 'ACTIVE'
  `).run(schoolId);

  // Insert new subscription record
  db.prepare(`
    INSERT INTO school_subscriptions (
      id, school_id, plan_id, status, start_date, end_date, amount_paid, provider, notes, created_at
    ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(subId, schoolId, plan.id, startDate, endDate, amountKobo, provider, notes || `Assigned ${plan.display_name} by platform administrator`);

  // Update school's current plan and ensure status is ACTIVE
  db.prepare(`
    UPDATE schools SET current_plan_id = ?, subscription_end_date = ?, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(plan.id, endDate, schoolId);

  // If payment made, record in platform_payments
  if (amountKobo > 0) {
    const platPayId = `ppay_${crypto.randomBytes(6).toString('hex')}`;
    const intRef = `PLT-${school.slug.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
    db.prepare(`
      INSERT INTO platform_payments (
        id, school_id, subscription_id, plan_id, amount, currency, payment_method, provider,
        internal_reference, status, notes
      ) VALUES (?, ?, ?, ?, ?, 'NGN', ?, ?, ?, 'SUCCESS', ?)
    `).run(platPayId, schoolId, subId, plan.id, amountKobo, provider, provider, intRef, `Subscription payment for ${plan.display_name}`);
  }

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    schoolId,
    action: 'SUBSCRIPTION_CHANGED',
    entity: 'SUBSCRIPTION',
    entityId: subId,
    ipAddress: req.ip || '127.0.0.1',
    metadata: { plan_id: plan.id, plan_name: plan.name, amountKobo, endDate },
  });

  return res.json({
    success: true,
    message: `Subscription plan ${plan.display_name} successfully activated for ${school.name}.`,
    subscriptionId: subId,
    endDate,
  });
});

// ==============================================================================
// 3. SUBSCRIPTION PLANS (SUPER ADMIN ONLY)
// ==============================================================================

adminRouter.get('/plans', requireAuth, requireSuperAdmin, (_req: AuthenticatedRequest, res) => {
  const plans = db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM schools s WHERE s.current_plan_id = p.id) as subscriber_count
    FROM subscription_plans p
    ORDER BY p.price ASC
  `).all() as any[];

  return res.json({
    success: true,
    plans: plans.map((p) => ({
      ...p,
      price_naira: toNaira(p.price),
      feature_flags: typeof p.feature_flags === 'string' ? JSON.parse(p.feature_flags || '{}') : p.feature_flags,
    })),
  });
});

adminRouter.post('/plans', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { name, display_name, description, price_naira, billing_interval = 'TERM', student_limit, staff_limit, storage_limit_mb, feature_flags } = req.body;

  if (!name || !display_name) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Plan name and display name are required' });
  }

  const id = `plan_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const priceKobo = toKobo(Number(price_naira) || 0);
  const flagsJson = JSON.stringify(feature_flags || {});

  try {
    db.prepare(`
      INSERT INTO subscription_plans (
        id, name, display_name, description, price, billing_interval,
        student_limit, staff_limit, storage_limit_mb, feature_flags, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id, name.toUpperCase(), display_name, description || null, priceKobo, billing_interval,
      Number(student_limit) || 200, Number(staff_limit) || 25, Number(storage_limit_mb) || 1000, flagsJson
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'PLAN_CREATED',
      entity: 'SUBSCRIPTION_PLAN',
      entityId: id,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { name, priceKobo },
    });

    return res.status(201).json({ success: true, message: 'Plan created successfully.', planId: id });
  } catch (err: any) {
    return res.status(500).json({ error: 'CREATE_PLAN_FAILED', message: err.message });
  }
});

adminRouter.patch('/plans/:id', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { display_name, description, price_naira, student_limit, staff_limit, storage_limit_mb, feature_flags, active } = req.body;

  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id);
  if (!plan) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Plan not found' });
  }

  const priceKobo = price_naira !== undefined ? toKobo(Number(price_naira)) : undefined;
  const flagsJson = feature_flags !== undefined ? JSON.stringify(feature_flags) : undefined;

  db.prepare(`
    UPDATE subscription_plans SET
      display_name = COALESCE(?, display_name),
      description = COALESCE(?, description),
      price = COALESCE(?, price),
      student_limit = COALESCE(?, student_limit),
      staff_limit = COALESCE(?, staff_limit),
      storage_limit_mb = COALESCE(?, storage_limit_mb),
      feature_flags = COALESCE(?, feature_flags),
      active = COALESCE(?, active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    display_name ?? null,
    description ?? null,
    priceKobo ?? null,
    student_limit !== undefined ? Number(student_limit) : null,
    staff_limit !== undefined ? Number(staff_limit) : null,
    storage_limit_mb !== undefined ? Number(storage_limit_mb) : null,
    flagsJson ?? null,
    active !== undefined ? (active ? 1 : 0) : null,
    id
  );

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'PLAN_UPDATED',
    entity: 'SUBSCRIPTION_PLAN',
    entityId: id,
    ipAddress: req.ip || '127.0.0.1',
    metadata: { changes: req.body },
  });

  return res.json({ success: true, message: 'Plan updated successfully.' });
});

// ==============================================================================
// 4. SUBSCRIPTIONS MANAGEMENT (SUPER ADMIN ONLY)
// ==============================================================================

adminRouter.get('/subscriptions', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { status, plan_id, expiring_soon } = req.query;

  let query = `
    SELECT sub.*,
           s.name as school_name,
           s.slug as school_slug,
           p.name as plan_name,
           p.display_name as plan_display_name,
           p.billing_interval
    FROM school_subscriptions sub
    JOIN schools s ON sub.school_id = s.id
    JOIN subscription_plans p ON sub.plan_id = p.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status && status !== 'ALL') {
    query += ` AND sub.status = ?`;
    params.push(status);
  }

  if (plan_id && plan_id !== 'ALL') {
    query += ` AND sub.plan_id = ?`;
    params.push(plan_id);
  }

  if (expiring_soon === 'true') {
    query += ` AND sub.status = 'ACTIVE' AND date(sub.end_date) <= date('now', '+30 days')`;
  }

  query += ` ORDER BY sub.created_at DESC`;

  const rows = db.prepare(query).all(...params) as any[];

  return res.json({
    success: true,
    subscriptions: rows.map((r) => ({
      ...r,
      amount_paid_naira: toNaira(r.amount_paid),
    })),
  });
});

// ==============================================================================
// 5. PLATFORM SAAS REVENUE (SUPER ADMIN ONLY)
// ==============================================================================

adminRouter.get('/revenue', requireAuth, requireSuperAdmin, (_req: AuthenticatedRequest, res) => {
  // 1. Total SaaS Subscription Revenue
  const totalSaaSRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo, COUNT(*) as count
    FROM platform_payments WHERE status = 'SUCCESS'
  `).get() as any;
  const platformRevenueKobo = Number(totalSaaSRow.total_kobo);

  // 2. School-collected money (fees paid by parents to individual school tenants)
  const schoolTotalRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo, COUNT(*) as count
    FROM payments WHERE status = 'SUCCESS'
  `).get() as any;
  const schoolCollectedRevenueKobo = Number(schoolTotalRow.total_kobo);

  // 3. Platform Payments Status counts
  const successfulCount = (db.prepare("SELECT COUNT(*) as c FROM platform_payments WHERE status = 'SUCCESS'").get() as any).c;
  const failedCount = (db.prepare("SELECT COUNT(*) as c FROM platform_payments WHERE status = 'FAILED'").get() as any).c;
  const refundedCount = (db.prepare("SELECT COUNT(*) as c FROM platform_payments WHERE status = 'REFUNDED'").get() as any).c;

  // 4. Revenue by Plan
  const revenueByPlan = db.prepare(`
    SELECT p.id as plan_id, p.display_name, COALESCE(SUM(pp.amount), 0) as total_kobo, COUNT(pp.id) as payment_count
    FROM subscription_plans p
    LEFT JOIN platform_payments pp ON p.id = pp.plan_id AND pp.status = 'SUCCESS'
    GROUP BY p.id
    ORDER BY total_kobo DESC
  `).all() as any[];

  // 5. Recent Platform Payment Transactions
  const transactions = db.prepare(`
    SELECT pp.*, s.name as school_name, p.display_name as plan_display_name
    FROM platform_payments pp
    JOIN schools s ON pp.school_id = s.id
    LEFT JOIN subscription_plans p ON pp.plan_id = p.id
    ORDER BY pp.paid_at DESC
    LIMIT 50
  `).all() as any[];

  return res.json({
    success: true,
    revenue: {
      platformRevenueKobo,
      platformRevenueNaira: toNaira(platformRevenueKobo),
      schoolCollectedRevenueKobo,
      schoolCollectedRevenueNaira: toNaira(schoolCollectedRevenueKobo),
      successfulCount,
      failedCount,
      refundedCount,
      revenueByPlan: revenueByPlan.map((r) => ({
        ...r,
        total_naira: toNaira(r.total_kobo),
      })),
      transactions: transactions.map((t) => ({
        ...t,
        amount_naira: toNaira(t.amount),
      })),
    },
  });
});

// ==============================================================================
// 6. PARTNERS & COMMISSIONS (SUPER ADMIN ONLY)
// ==============================================================================

adminRouter.get('/partners', requireAuth, requireSuperAdmin, (_req: AuthenticatedRequest, res) => {
  const partners = db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM commissions c WHERE c.partner_id = p.id) as commission_count,
           (SELECT COALESCE(SUM(amount), 0) FROM commissions c WHERE c.partner_id = p.id AND c.status = 'PAID') as paid_commissions_kobo,
           (SELECT COALESCE(SUM(amount), 0) FROM commissions c WHERE c.partner_id = p.id AND c.status = 'PENDING') as pending_commissions_kobo
    FROM partners p
    ORDER BY p.created_at DESC
  `).all() as any[];

  return res.json({
    success: true,
    partners: partners.map((p) => ({
      ...p,
      paid_commissions_naira: toNaira(p.paid_commissions_kobo),
      pending_commissions_naira: toNaira(p.pending_commissions_kobo),
    })),
  });
});

adminRouter.post('/partners', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { name, email, phone, company, partner_type = 'REFERRAL', commission_rate = 10.0, referral_code, notes } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Partner name and email are required' });
  }

  const id = `ptn_${crypto.randomBytes(6).toString('hex')}`;
  const code = referral_code || `${name.slice(0, 4).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  try {
    db.prepare(`
      INSERT INTO partners (id, name, email, phone, company, partner_type, commission_rate, referral_code, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    `).run(id, name, email, phone || null, company || null, partner_type, Number(commission_rate), code, notes || null);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'PARTNER_CREATED',
      entity: 'PARTNER',
      entityId: id,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { name, email, referral_code: code },
    });

    return res.status(201).json({ success: true, message: 'Partner added successfully.', partnerId: id });
  } catch (err: any) {
    return res.status(500).json({ error: 'CREATE_PARTNER_FAILED', message: err.message });
  }
});

adminRouter.get('/commissions', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { status, partner_id } = req.query;

  let query = `
    SELECT c.*,
           p.name as partner_name,
           p.company as partner_company,
           s.name as school_name
    FROM commissions c
    JOIN partners p ON c.partner_id = p.id
    LEFT JOIN schools s ON c.school_id = s.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status && status !== 'ALL') {
    query += ` AND c.status = ?`;
    params.push(status);
  }

  if (partner_id && partner_id !== 'ALL') {
    query += ` AND c.partner_id = ?`;
    params.push(partner_id);
  }

  query += ` ORDER BY c.created_at DESC`;

  const rows = db.prepare(query).all(...params) as any[];

  return res.json({
    success: true,
    commissions: rows.map((c) => ({
      ...c,
      amount_naira: toNaira(c.amount),
    })),
  });
});

adminRouter.patch('/commissions/:id/status', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  if (!status || !['PENDING', 'APPROVED', 'PAID', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ error: 'INVALID_STATUS', message: 'Status must be PENDING, APPROVED, PAID, or CANCELLED' });
  }

  const commission = db.prepare('SELECT * FROM commissions WHERE id = ?').get(id) as any;
  if (!commission) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Commission not found' });
  }

  const paidAt = status === 'PAID' ? new Date().toISOString().slice(0, 10) : (commission.paid_at || null);

  db.prepare(`
    UPDATE commissions SET status = ?, notes = COALESCE(?, notes), paid_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, notes || null, paidAt, id);

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'COMMISSION_STATUS_UPDATED',
    entity: 'COMMISSION',
    entityId: id,
    ipAddress: req.ip || '127.0.0.1',
    metadata: { previousStatus: commission.status, newStatus: status },
  });

  return res.json({ success: true, message: `Commission marked as ${status}.` });
});

// ==============================================================================
// 7. PLATFORM USERS & AUDIT LOGS (SUPER ADMIN ONLY)
// ==============================================================================

adminRouter.get('/users', requireAuth, requireSuperAdmin, async (_req: AuthenticatedRequest, res) => {
  try {
    let users: any[] = [];
    const pgUsers = await queryPg(`
      SELECT u.id, u.email, u.full_name, u.phone, u.is_platform_admin, u.is_active, u.created_at,
             COUNT(ur.school_id) as assigned_schools
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      GROUP BY u.id, u.email, u.full_name, u.phone, u.is_platform_admin, u.is_active, u.created_at
      ORDER BY u.is_platform_admin DESC, u.created_at DESC
    `);

    if (pgUsers) {
      users = pgUsers.rows;
      for (const u of users) {
        cacheDb.prepare(`
          INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
          VALUES (?, ?, '', '', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            full_name = excluded.full_name,
            phone = excluded.phone,
            is_platform_admin = excluded.is_platform_admin,
            is_active = excluded.is_active
        `).run(
          u.id,
          u.email,
          u.full_name,
          u.phone || null,
          u.is_platform_admin ? 1 : 0,
          u.is_active ? 1 : 0,
          u.created_at || new Date().toISOString()
        );
      }
    } else {
      users = cacheDb.prepare(`
        SELECT u.id, u.email, u.full_name, u.phone, u.is_platform_admin, u.is_active, u.created_at,
               COUNT(ur.school_id) as assigned_schools
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        GROUP BY u.id
        ORDER BY u.is_platform_admin DESC, u.created_at DESC
      `).all();
    }

    return res.json({ success: true, users });
  } catch (err: any) {
    return res.status(500).json({ error: 'FETCH_FAILED', message: err.message });
  }
});

adminRouter.get('/audit-logs', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { action, school_id, limit = '100' } = req.query;

  let query = `
    SELECT al.*, s.name as school_name
    FROM audit_logs al
    LEFT JOIN schools s ON al.school_id = s.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (action && typeof action === 'string' && action !== 'ALL') {
    query += ` AND al.action = ?`;
    params.push(action);
  }

  if (school_id && typeof school_id === 'string' && school_id !== 'ALL') {
    query += ` AND al.school_id = ?`;
    params.push(school_id);
  }

  query += ` ORDER BY al.created_at DESC LIMIT ?`;
  params.push(Math.min(parseInt(limit as string, 10) || 100, 500));

  const logs = db.prepare(query).all(...params);

  return res.json({ success: true, logs });
});

// ==============================================================================
// 8. SCHOOL SUPPORT IMPERSONATION (SUPER ADMIN ONLY - EXPLICIT & AUDITED)
// ==============================================================================

adminRouter.post('/impersonate', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { schoolId, userId } = req.body;

  if (!schoolId) {
    return res.status(400).json({ error: 'MISSING_PARAM', message: 'schoolId is required for support impersonation' });
  }

  const school = db.prepare('SELECT id, name, slug, status FROM schools WHERE id = ?').get(schoolId) as any;
  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Target school not found' });
  }

  // Find target user: specified user or primary owner/bursar of the school
  let targetUser: any;
  if (userId) {
    targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  } else {
    // Find school owner or administrator
    targetUser = db.prepare(`
      SELECT u.* FROM user_roles ur
      JOIN users u ON ur.user_id = u.id
      WHERE ur.school_id = ? AND ur.role_id IN ('role_school_owner', 'role_school_admin', 'role_bursar')
      ORDER BY ur.role_id ASC
      LIMIT 1
    `).get(schoolId);
  }

  if (!targetUser) {
    return res.status(404).json({ error: 'NO_TARGET_USER', message: 'No authorized staff or owner user found in target school to impersonate.' });
  }

  const superAdminId = req.user!.id;
  const clientIp = req.ip || '127.0.0.1';
  const userAgent = (req.headers['user-agent'] as string) || '';

  // Create explicit short-lived (2 hour) impersonation session token
  const impersonationToken = createImpersonationSession(targetUser.id, schoolId, superAdminId, clientIp, userAgent);

  // Mandatory Audit Log
  logAudit({
    actorId: superAdminId,
    actorEmail: req.user!.email,
    schoolId,
    action: 'IMPERSONATION_STARTED',
    entity: 'SUPPORT_SESSION',
    entityId: targetUser.id,
    ipAddress: clientIp,
    metadata: {
      targetUserId: targetUser.id,
      targetUserEmail: targetUser.email,
      targetSchoolName: school.name,
      reason: req.body.reason || 'Customer support investigation',
    },
  });

  return res.json({
    success: true,
    message: `Support impersonation session initiated for ${school.name}.`,
    impersonationToken,
    targetUser: {
      id: targetUser.id,
      email: targetUser.email,
      full_name: targetUser.full_name,
    },
    targetSchool: school,
  });
});

// ==============================================================================
// 9. DYNAMIC SAAS PLANS ADVANCED ACTIONS (DUPLICATE, ARCHIVE)
// ==============================================================================

// POST /admin/plans/:id/duplicate (Duplicate plan with custom suffix)
adminRouter.post('/plans/:id/duplicate', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const original = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id) as any;
  if (!original) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Original plan not found' });
  }

  const newId = `plan_${original.name.toLowerCase()}_copy_${Date.now().toString().slice(-4)}`;
  const newName = `${original.name}_COPY`;
  const newDisplayName = `${original.display_name} (Copy)`;

  try {
    db.prepare(`
      INSERT INTO subscription_plans (
        id, name, display_name, description, price, billing_interval,
        billing_interval_count, currency, trial_days, student_limit, staff_limit,
        maximum_students, maximum_staff, maximum_admin_users, storage_limit_mb,
        feature_flags, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      newId, newName, newDisplayName, original.description, original.price, original.billing_interval,
      original.billing_interval_count || 1, original.currency || 'NGN', original.trial_days || 30,
      original.student_limit, original.staff_limit, original.maximum_students || original.student_limit,
      original.maximum_staff || original.staff_limit, original.maximum_admin_users || 5,
      original.storage_limit_mb, original.feature_flags,
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'PLAN_DUPLICATED',
      entity: 'SUBSCRIPTION_PLAN',
      entityId: newId,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { originalPlanId: id, newPlanId: newId },
    });

    return res.status(201).json({ success: true, message: `Plan duplicated as "${newDisplayName}".`, planId: newId });
  } catch (err: any) {
    return res.status(500).json({ error: 'DUPLICATE_FAILED', message: err.message });
  }
});

// POST /admin/plans/:id/archive (Deactivate / Archive plan)
adminRouter.post('/plans/:id/archive', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id) as any;
  if (!plan) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Plan not found' });
  }

  db.prepare('UPDATE subscription_plans SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'PLAN_ARCHIVED',
    entity: 'SUBSCRIPTION_PLAN',
    entityId: id,
    ipAddress: req.ip || '127.0.0.1',
  });

  return res.json({ success: true, message: `Plan "${plan.display_name}" archived.` });
});

// ==============================================================================
// 10. CUSTOM NEGOTIATED SCHOOL PRICING & SUBSCRIPTION OVERRIDE (Section 3 & 4)
// ==============================================================================

adminRouter.post('/schools/:schoolId/custom-subscription', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { schoolId } = req.params;
  const {
    plan_id,
    negotiated_price_naira,
    discount_amount_naira,
    discount_reason,
    final_amount_naira,
    billing_interval = 'ANNUAL',
    duration_months = 12,
    status = 'ACTIVE',
    notes,
  } = req.body;

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Target school not found' });
  }

  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(plan_id) as any;
  if (!plan) {
    return res.status(404).json({ error: 'PLAN_NOT_FOUND', message: 'Subscription plan not found' });
  }

  const standardPriceKobo = plan.price;
  let negotiatedKobo = negotiated_price_naira !== undefined && negotiated_price_naira !== null ? toKobo(Number(negotiated_price_naira)) : null;
  let discountKobo = discount_amount_naira !== undefined ? toKobo(Number(discount_amount_naira)) : 0;
  
  // Authoritative calculation of final_amount
  let finalKobo: number;
  if (final_amount_naira !== undefined && final_amount_naira !== null) {
    finalKobo = toKobo(Number(final_amount_naira));
  } else if (negotiatedKobo !== null) {
    finalKobo = Math.max(0, negotiatedKobo - discountKobo);
  } else {
    finalKobo = Math.max(0, standardPriceKobo - discountKobo);
  }

  const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;
  const startDate = new Date().toISOString().slice(0, 10);
  const endDateObj = new Date();
  endDateObj.setMonth(endDateObj.getMonth() + Number(duration_months));
  const endDate = endDateObj.toISOString().slice(0, 10);

  // Expire any existing active subscriptions for this school
  db.prepare("UPDATE school_subscriptions SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);

  // Insert authoritative subscription record
  db.prepare(`
    INSERT INTO school_subscriptions (
      id, school_id, plan_id, status, start_date, end_date, standard_plan_price,
      negotiated_price, discount_amount, discount_reason, final_amount, amount_paid,
      currency, expiry_date, renewal_date, provider, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NGN', ?, ?, 'SUPER_ADMIN_CUSTOM', ?, CURRENT_TIMESTAMP)
  `).run(
    subId, schoolId, plan.id, status, startDate, endDate, standardPriceKobo,
    negotiatedKobo, discountKobo, discount_reason || null, finalKobo, finalKobo,
    endDate, endDate, notes || `Custom negotiated pricing set by Super Admin (Final: ₦${toNaira(finalKobo).toLocaleString()})`
  );

  // Update school tenant status and plan pointer
  db.prepare(`
    UPDATE schools SET
      status = ?,
      current_plan_id = ?,
      subscription_end_date = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, plan.id, endDate, schoolId);

  // Generate SaaS invoice for this cycle
  const invNumber = `INV-PLT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  const invoiceId = `pinv_${crypto.randomBytes(6).toString('hex')}`;
  db.prepare(`
    INSERT INTO platform_invoices (
      id, invoice_number, school_id, subscription_id, plan_id, billing_period,
      standard_price, discount, negotiated_price, final_amount, currency,
      payment_status, issue_date, due_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NGN', 'PENDING', ?, ?, ?)
  `).run(
    invoiceId, invNumber, schoolId, subId, plan.id, `${startDate} to ${endDate}`,
    standardPriceKobo, discountKobo, negotiatedKobo, finalKobo,
    startDate, startDate, `Invoice for customized subscription: ${plan.display_name}`
  );

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    schoolId,
    action: 'CUSTOM_PRICING_ASSIGNED',
    entity: 'SCHOOL_SUBSCRIPTION',
    entityId: subId,
    ipAddress: req.ip || '127.0.0.1',
    metadata: {
      planId: plan.id,
      standardPriceKobo,
      negotiatedKobo,
      discountKobo,
      finalKobo,
      durationMonths: duration_months,
    },
  });

  return res.status(201).json({
    success: true,
    message: `Custom subscription successfully created for ${school.name}. Final charge amount: ₦${toNaira(finalKobo).toLocaleString()}.`,
    subscriptionId: subId,
    invoiceId,
    finalAmountNaira: toNaira(finalKobo),
    endDate,
  });
});

// ==============================================================================
// 11. SUBSCRIPTION DISCOUNTS MANAGEMENT (Section 4)
// ==============================================================================

adminRouter.get('/discounts', requireAuth, requireSuperAdmin, (_req: AuthenticatedRequest, res) => {
  const discounts = db.prepare(`
    SELECT sd.*, s.name as school_name, p.display_name as plan_display_name
    FROM subscription_discounts sd
    LEFT JOIN schools s ON sd.school_id = s.id
    LEFT JOIN subscription_plans p ON sd.plan_id = p.id
    ORDER BY sd.created_at DESC
  `).all() as any[];

  return res.json({
    success: true,
    discounts: discounts.map((d) => ({
      ...d,
      discount_value_display: d.discount_type === 'PERCENTAGE' ? `${d.discount_value}%` : `₦${toNaira(d.discount_value).toLocaleString()}`,
    })),
  });
});

adminRouter.post('/discounts', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { code, name, discount_type, discount_value, school_id, plan_id, expires_at, notes } = req.body;

  if (!name || !discount_type || discount_value === undefined) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Name, discount_type, and discount_value are required' });
  }

  const id = `disc_${crypto.randomBytes(6).toString('hex')}`;
  const promoCode = code ? code.toUpperCase().trim() : `PROMO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const valueInt = discount_type === 'FIXED' ? toKobo(Number(discount_value)) : Number(discount_value);

  try {
    db.prepare(`
      INSERT INTO subscription_discounts (
        id, code, name, discount_type, discount_value, school_id, plan_id, active, expires_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, promoCode, name, discount_type, valueInt, school_id || null, plan_id || null, expires_at || null, notes || null);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'DISCOUNT_CREATED',
      entity: 'SUBSCRIPTION_DISCOUNT',
      entityId: id,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { code: promoCode, discount_type, discount_value: valueInt },
    });

    return res.status(201).json({ success: true, message: 'Discount promotion created.', discountId: id, code: promoCode });
  } catch (err: any) {
    return res.status(500).json({ error: 'CREATE_DISCOUNT_FAILED', message: err.message });
  }
});

adminRouter.delete('/discounts/:id', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM subscription_discounts WHERE id = ?').run(id);
  return res.json({ success: true, message: 'Discount deleted.' });
});

// ==============================================================================
// 12. PLATFORM SETTINGS & BANK ACCOUNT (Section 7, 9)
// ==============================================================================

adminRouter.get('/settings', requireAuth, requireSuperAdmin, (_req: AuthenticatedRequest, res) => {
  const settings = db.prepare('SELECT * FROM platform_settings WHERE id = ?').get('platform_global_settings');
  return res.json({ success: true, settings });
});

adminRouter.patch('/settings', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const {
    default_currency,
    default_grace_period_days,
    default_trial_days,
    bachs_enabled,
    bank_transfer_enabled,
    invoice_payments_enabled,
    platform_bank_name,
    platform_account_name,
    platform_account_number,
    platform_contact_email,
    platform_contact_phone,
    opay_account_name,
    opay_account_number,
  } = req.body;

  db.prepare(`
    UPDATE platform_settings SET
      default_currency = COALESCE(?, default_currency),
      default_grace_period_days = COALESCE(?, default_grace_period_days),
      default_trial_days = COALESCE(?, default_trial_days),
      bachs_enabled = COALESCE(?, bachs_enabled),
      bank_transfer_enabled = COALESCE(?, bank_transfer_enabled),
      invoice_payments_enabled = COALESCE(?, invoice_payments_enabled),
      platform_bank_name = COALESCE(?, platform_bank_name),
      platform_account_name = COALESCE(?, platform_account_name),
      platform_account_number = COALESCE(?, platform_account_number),
      platform_contact_email = COALESCE(?, platform_contact_email),
      platform_contact_phone = COALESCE(?, platform_contact_phone),
      opay_account_name = COALESCE(?, opay_account_name),
      opay_account_number = COALESCE(?, opay_account_number),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 'platform_global_settings'
  `).run(
    default_currency, default_grace_period_days, default_trial_days,
    bachs_enabled, bank_transfer_enabled, invoice_payments_enabled,
    platform_bank_name, platform_account_name, platform_account_number,
    platform_contact_email, platform_contact_phone,
    opay_account_name, opay_account_number
  );

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'PLATFORM_SETTINGS_UPDATED',
    entity: 'PLATFORM_SETTINGS',
    entityId: 'platform_global_settings',
    ipAddress: req.ip || '127.0.0.1',
    metadata: req.body,
  });

  return res.json({ success: true, message: 'Platform settings updated successfully.' });
});

// ==============================================================================
// 13. SAAS PAYMENTS & MANUAL BANK TRANSFER APPROVALS (Section 7)
// ==============================================================================

adminRouter.get('/platform-payments', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { status, payment_method, school_id } = req.query;

  let query = `
    SELECT pp.*, s.name as school_name, s.slug as school_slug, p.display_name as plan_display_name,
           p.billing_interval
    FROM platform_payments pp
    JOIN schools s ON pp.school_id = s.id
    LEFT JOIN subscription_plans p ON pp.plan_id = p.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status && status !== 'ALL') {
    query += ` AND pp.status = ?`;
    params.push(status);
  }

  if (payment_method && payment_method !== 'ALL') {
    query += ` AND pp.payment_method = ?`;
    params.push(payment_method);
  }

  if (school_id && school_id !== 'ALL') {
    query += ` AND pp.school_id = ?`;
    params.push(school_id);
  }

  query += ` ORDER BY pp.created_at DESC`;

  const rows = db.prepare(query).all(...params) as any[];

  return res.json({
    success: true,
    payments: rows.map((r) => ({
      ...r,
      amount_naira: toNaira(r.amount),
    })),
  });
});

// POST /admin/platform-payments/:id/approve (Approve manual bank transfer)
adminRouter.post('/platform-payments/:id/approve', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  const payment = db.prepare('SELECT * FROM platform_payments WHERE id = ?').get(id) as any;
  if (!payment) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Platform payment record not found' });
  }

  if (payment.status === 'SUCCESS') {
    return res.status(400).json({ error: 'ALREADY_APPROVED', message: 'This payment has already been approved' });
  }

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(payment.school_id) as any;
  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(payment.plan_id) as any;

  const nowIso = new Date().toISOString();
  const todayStr = nowIso.slice(0, 10);

  // Calculate new subscription end date
  const interval = (plan?.billing_interval || 'ANNUAL').toUpperCase();
  const count = plan?.billing_interval_count || 1;
  const endDateObj = new Date();

  if (interval === 'MONTHLY') endDateObj.setMonth(endDateObj.getMonth() + (1 * count));
  else if (interval === 'QUARTERLY') endDateObj.setMonth(endDateObj.getMonth() + (3 * count));
  else if (interval === 'SEMI_ANNUAL') endDateObj.setMonth(endDateObj.getMonth() + (6 * count));
  else if (interval === 'ANNUAL') endDateObj.setFullYear(endDateObj.getFullYear() + (1 * count));
  else endDateObj.setMonth(endDateObj.getMonth() + (4 * count));
  const newEndDateStr = endDateObj.toISOString().slice(0, 10);

  // 1. Mark payment SUCCESS
  db.prepare(`
    UPDATE platform_payments SET
      status = 'SUCCESS',
      paid_at = ?,
      notes = COALESCE(?, notes),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nowIso, notes || 'Approved by Super Admin', id);

  // 2. Activate school subscription
  if (payment.subscription_id) {
    db.prepare(`
      UPDATE school_subscriptions SET
        status = 'ACTIVE',
        amount_paid = ?,
        end_date = ?,
        expiry_date = ?,
        renewal_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(payment.amount, newEndDateStr, newEndDateStr, newEndDateStr, payment.subscription_id);
  } else {
    const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;
    db.prepare(`
      INSERT INTO school_subscriptions (
        id, school_id, plan_id, status, start_date, end_date, amount_paid,
        standard_plan_price, final_amount, currency, expiry_date, renewal_date, provider, notes
      ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, 'NGN', ?, ?, 'BANK_TRANSFER', 'Approved by Super Admin')
    `).run(
      subId, payment.school_id, payment.plan_id, todayStr, newEndDateStr,
      payment.amount, plan.price, payment.amount, newEndDateStr, newEndDateStr
    );
  }

  // 3. Update school status to ACTIVE
  db.prepare(`
    UPDATE schools SET
      status = 'ACTIVE',
      current_plan_id = ?,
      subscription_end_date = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(payment.plan_id, newEndDateStr, payment.school_id);

  // 4. Mark associated platform invoice as PAID
  db.prepare(`
    UPDATE platform_invoices SET
      payment_status = 'PAID',
      paid_at = ?,
      payment_method = 'BANK_TRANSFER',
      updated_at = CURRENT_TIMESTAMP
    WHERE school_id = ? AND payment_status = 'PENDING'
  `).run(nowIso, payment.school_id);

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    schoolId: payment.school_id,
    action: 'MANUAL_PAYMENT_APPROVED',
    entity: 'PLATFORM_PAYMENT',
    entityId: id,
    ipAddress: req.ip || '127.0.0.1',
    metadata: {
      amountKobo: payment.amount,
      planId: payment.plan_id,
      schoolName: school?.name,
      newEndDate: newEndDateStr,
    },
  });

  return res.json({
    success: true,
    message: `Payment of ₦${toNaira(payment.amount).toLocaleString()} approved. School ${school?.name} is now ACTIVE until ${newEndDateStr}.`,
    newEndDate: newEndDateStr,
  });
});

// POST /admin/platform-payments/:id/reject (Reject manual bank transfer)
adminRouter.post('/platform-payments/:id/reject', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const payment = db.prepare('SELECT * FROM platform_payments WHERE id = ?').get(id) as any;
  if (!payment) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Platform payment record not found' });
  }

  db.prepare(`
    UPDATE platform_payments SET
      status = 'FAILED',
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(reason ? `Rejected by Super Admin: ${reason}` : 'Rejected by Super Admin', id);

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    schoolId: payment.school_id,
    action: 'MANUAL_PAYMENT_REJECTED',
    entity: 'PLATFORM_PAYMENT',
    entityId: id,
    ipAddress: req.ip || '127.0.0.1',
    metadata: { reason },
  });

  return res.json({ success: true, message: 'Payment marked as rejected.' });
});

// ==============================================================================
// 14. PLATFORM SAAS INVOICES (Section 8)
// ==============================================================================

adminRouter.get('/platform-invoices', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { status, school_id } = req.query;

  let query = `
    SELECT pi.*, s.name as school_name, s.slug as school_slug, p.display_name as plan_display_name
    FROM platform_invoices pi
    JOIN schools s ON pi.school_id = s.id
    LEFT JOIN subscription_plans p ON pi.plan_id = p.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status && status !== 'ALL') {
    query += ` AND pi.payment_status = ?`;
    params.push(status);
  }

  if (school_id && school_id !== 'ALL') {
    query += ` AND pi.school_id = ?`;
    params.push(school_id);
  }

  query += ` ORDER BY pi.issue_date DESC`;

  const rows = db.prepare(query).all(...params) as any[];

  return res.json({
    success: true,
    invoices: rows.map((r) => ({
      ...r,
      standard_price_naira: toNaira(r.standard_price),
      discount_naira: toNaira(r.discount),
      final_amount_naira: toNaira(r.final_amount),
    })),
  });
});

// ==============================================================================
// 15. PLATFORM USAGE MONITORING & CAPACITY (Section 14)
// ==============================================================================
adminRouter.get('/usage', requireAuth, requireSuperAdmin, (_req: AuthenticatedRequest, res) => {
  try {
    // 1. Database file size & metrics
    const dataDir = path.resolve(process.cwd(), 'data');
    const dbPath = path.join(dataDir, 'schoolpay.db');
    let dbFileSizeBytes = 0;
    try {
      if (fs.existsSync(dbPath)) {
        dbFileSizeBytes = fs.statSync(dbPath).size;
      }
    } catch {
      dbFileSizeBytes = 0;
    }

    const freeTierLimitBytes = 5 * 1024 * 1024 * 1024; // 5 GB Cloudflare D1 / SQLite default
    const dbUsagePercent = Number(((dbFileSizeBytes / freeTierLimitBytes) * 100).toFixed(4));

    // 2. Aggregate entity counts
    const totalSchools = (db.prepare('SELECT COUNT(*) as c FROM schools').get() as any)?.c || 0;
    const activeSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'ACTIVE'").get() as any)?.c || 0;
    const trialSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'TRIAL'").get() as any)?.c || 0;
    const suspendedSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'SUSPENDED'").get() as any)?.c || 0;
    const totalStudents = (db.prepare('SELECT COUNT(*) as c FROM students').get() as any)?.c || 0;
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any)?.c || 0;
    const totalStaff = (db.prepare('SELECT COUNT(*) as c FROM staff').get() as any)?.c || 0;
    const totalInvoices = (db.prepare('SELECT COUNT(*) as c FROM invoices').get() as any)?.c || 0;
    const totalPayments = (db.prepare('SELECT COUNT(*) as c FROM payments').get() as any)?.c || 0;
    const totalReceipts = (db.prepare('SELECT COUNT(*) as c FROM receipts').get() as any)?.c || 0;

    // 3. Webhook events & failures
    const totalWebhookEvents = (db.prepare('SELECT COUNT(*) as c FROM webhook_events').get() as any)?.c || 0;
    const failedWebhookEvents = (db.prepare("SELECT COUNT(*) as c FROM webhook_events WHERE status IN ('FAILED', 'REJECTED')").get() as any)?.c || 0;
    const successfulWebhookEvents = (db.prepare("SELECT COUNT(*) as c FROM webhook_events WHERE status = 'PROCESSED'").get() as any)?.c || 0;

    // 4. Security & Audit alerts
    const totalSecurityViolations = (db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE action LIKE '%VIOLATION%' OR action LIKE '%IDOR%' OR action LIKE '%REJECTED%'").get() as any)?.c || 0;
    const recentViolations = db.prepare(`
      SELECT al.*, s.name as school_name
      FROM audit_logs al
      LEFT JOIN schools s ON al.school_id = s.id
      WHERE al.action LIKE '%VIOLATION%' OR al.action LIKE '%IDOR%' OR al.action LIKE '%REJECTED%'
      ORDER BY al.created_at DESC
      LIMIT 5
    `).all() as any[];

    // 5. School tenant usage breakdown
    const schoolUsage = db.prepare(`
      SELECT s.id, s.name, s.slug, s.status, s.state,
             p.display_name as plan_name,
             (SELECT COUNT(*) FROM students stu WHERE stu.school_id = s.id) as student_count,
             (SELECT COUNT(*) FROM user_roles ur WHERE ur.school_id = s.id) as user_count,
             (SELECT COUNT(*) FROM invoices inv WHERE inv.school_id = s.id) as invoice_count,
             (SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay WHERE pay.school_id = s.id AND pay.status = 'SUCCESS') as total_collected_kobo
      FROM schools s
      LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
      ORDER BY student_count DESC, s.created_at DESC
      LIMIT 50
    `).all() as any[];

    // 6. Cloudflare D1 environment status
    const cfD1Configured = Boolean(process.env.CLOUDFLARE_D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN);

    return res.json({
      success: true,
      usage: {
        database: {
          engine: 'SQLite WAL Mode / Cloudflare D1 Compatible',
          fileSizeBytes: dbFileSizeBytes,
          fileSizeFormatted: `${(dbFileSizeBytes / (1024 * 1024)).toFixed(2)} MB`,
          freeTierLimitBytes,
          freeTierLimitFormatted: '5.00 GB',
          usagePercent: dbUsagePercent,
          warningThresholdPercent: 80,
          status: dbUsagePercent > 80 ? 'WARNING' : 'HEALTHY',
          cloudflareD1: {
            configured: cfD1Configured,
            databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID || null,
            liveAnalyticsAvailable: cfD1Configured,
            setupNotice: cfD1Configured
              ? 'Connected to Cloudflare D1 edge database.'
              : 'Running on local persistent SQLite WAL database. For remote Cloudflare D1 edge metrics, define CLOUDFLARE_API_TOKEN and CLOUDFLARE_D1_DATABASE_ID in production environment variables.',
          },
        },
        entities: {
          totalSchools,
          activeSchools,
          trialSchools,
          suspendedSchools,
          totalStudents,
          totalUsers,
          totalStaff,
          totalInvoices,
          totalPayments,
          totalReceipts,
        },
        webhooks: {
          totalEvents: totalWebhookEvents,
          successfulEvents: successfulWebhookEvents,
          failedEvents: failedWebhookEvents,
          healthRatePercent: totalWebhookEvents > 0
            ? Number(((successfulWebhookEvents / totalWebhookEvents) * 100).toFixed(1))
            : 100,
        },
        security: {
          totalViolations: totalSecurityViolations,
          recentViolations,
        },
        schoolsBreakdown: schoolUsage.map((s) => ({
          ...s,
          total_collected_naira: toNaira(s.total_collected_kobo),
        })),
        infrastructureNotes: [
          'Architecture uses parameterized queries and strictly isolated school_id indexes for sub-millisecond query execution.',
          'Database storage capacity is bounded by Cloudflare D1 5 GB free tier limit before requiring paid Workers scale plans.',
          'Tenant isolation is enforced server-side on every request via cryptographic session tokens.',
        ],
      },
    });
  } catch (error: any) {
    console.error('[Usage Metrics Error]', error);
    return res.status(500).json({
      error: 'USAGE_METRICS_ERROR',
      message: 'Failed to retrieve platform usage metrics: ' + (error?.message || 'Unknown error'),
    });
  }
});

