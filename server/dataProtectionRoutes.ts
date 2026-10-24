import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.ts';
import {
  requireAuth,
  requireTenant,
  requireSuperAdmin,
  requireRole,
  type AuthenticatedRequest,
} from './tenantMiddleware.ts';
import {
  createDatabaseBackup,
  verifyBackup,
  runIsolatedRestorationTest,
  getBackupStats,
  listAllBackups,
} from './backupService.ts';
import {
  getAppliedMigrations,
  getDatabaseInventory,
} from './migrationService.ts';
import { logAudit } from './audit.ts';
import { isCloudStorageConfigured } from './cloudStorageBackup.ts';

export const dataProtectionRouter = express.Router();

// ==============================================================================
// 1. PLATFORM SUPER_ADMIN DATA PROTECTION & BACKUP MANAGEMENT
// ==============================================================================

// GET /api/v1/admin/data-protection/status
dataProtectionRouter.get(
  '/admin/data-protection/status',
  requireAuth,
  requireSuperAdmin,
  (_req: AuthenticatedRequest, res) => {
    try {
      const stats = getBackupStats();
      const inventory = getDatabaseInventory();
      const totalProtectedRows = inventory.reduce((acc, t) => acc + t.rowCount, 0);

      return res.json({
        success: true,
        stats,
        totalTables: inventory.length,
        totalProtectedRows,
        cloudStorage: {
          configured: isCloudStorageConfigured(),
          destination: process.env.GCS_BACKUP_BUCKET ? `gs://${process.env.GCS_BACKUP_BUCKET}` : 'NOT_CONFIGURED',
          provider: process.env.GCS_BACKUP_BUCKET ? 'GOOGLE_CLOUD_STORAGE' : 'LOCAL_CONTAINER_ONLY',
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'STATS_ERROR', message: err.message });
    }
  }
);

// GET /api/v1/admin/data-protection/backups
dataProtectionRouter.get(
  '/admin/data-protection/backups',
  requireAuth,
  requireSuperAdmin,
  (_req: AuthenticatedRequest, res) => {
    try {
      const backups = listAllBackups();
      return res.json({ success: true, backups });
    } catch (err: any) {
      return res.status(500).json({ error: 'BACKUPS_ERROR', message: err.message });
    }
  }
);

// POST /api/v1/admin/data-protection/backups/create (Manual Backup)
dataProtectionRouter.post(
  '/admin/data-protection/backups/create',
  requireAuth,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const backup = await createDatabaseBackup('MANUAL', req.user!.email);
      return res.json({
        success: true,
        backup,
        message: `Database backup created successfully: ${backup.filename} (${(backup.size_bytes / 1024).toFixed(1)} KB)`,
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'BACKUP_FAILED', message: err.message });
    }
  }
);

// POST /api/v1/admin/data-protection/backups/:id/verify
dataProtectionRouter.post(
  '/admin/data-protection/backups/:id/verify',
  requireAuth,
  requireSuperAdmin,
  (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const result = verifyBackup(id, req.user!.email);
      return res.json({ ...result });
    } catch (err: any) {
      return res.status(500).json({ error: 'VERIFY_FAILED', message: err.message });
    }
  }
);

// POST /api/v1/admin/data-protection/backups/:id/test-restore (Sandboxed Restore Test)
dataProtectionRouter.post(
  '/admin/data-protection/backups/:id/test-restore',
  requireAuth,
  requireSuperAdmin,
  (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const result = runIsolatedRestorationTest(id, req.user!.email);
      return res.json({ ...result });
    } catch (err: any) {
      return res.status(500).json({ error: 'TEST_RESTORE_FAILED', message: err.message });
    }
  }
);

// POST /api/v1/admin/data-protection/backups/:id/restore (Controlled Production Restoration with Pre-Flight Check)
dataProtectionRouter.post(
  '/admin/data-protection/backups/:id/restore',
  requireAuth,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const { confirmation } = req.body;

      if (confirmation !== 'CONFIRM_RESTORE_OVERWRITE') {
        return res.status(400).json({
          error: 'CONFIRMATION_REQUIRED',
          message: 'Explicit safety confirmation string "CONFIRM_RESTORE_OVERWRITE" is required to restore database state.',
        });
      }

      const backup = db.prepare('SELECT * FROM database_backups WHERE id = ?').get(id) as any;
      if (!backup || !fs.existsSync(backup.filepath)) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Backup file not found on disk.' });
      }

      // Step 1: Run isolated restoration test first to verify backup is healthy before touching live DB
      const testResult = runIsolatedRestorationTest(id, req.user!.email);
      if (!testResult.success) {
        return res.status(400).json({
          error: 'RESTORE_ABORTED',
          message: 'Backup failed health pre-flight check and cannot be restored. Live production data was not modified.',
          testResult,
        });
      }

      // Step 2: Create a safety backup of CURRENT live state before applying restore
      const preSafetyBackup = await createDatabaseBackup('PRE_MIGRATION', 'PRE_RESTORATION_SAFETY_SNAPSHOT');

      // Step 3: Replace live DB file safely
      const dbPath = path.resolve(process.cwd(), 'data', 'schoolpay.db');
      fs.copyFileSync(backup.filepath, dbPath);

      logAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'DATABASE_RESTORE_APPLIED',
        entity: 'DATABASE_BACKUP',
        entityId: id,
        metadata: {
          restoredFrom: backup.filename,
          preSafetyBackupId: preSafetyBackup.id,
          verifiedTables: testResult.tableCount,
          verifiedRecords: testResult.recordCount,
        },
      });

      return res.json({
        success: true,
        message: `Database successfully restored from backup snapshot ${backup.filename}. Pre-restore safety snapshot ${preSafetyBackup.filename} was preserved.`,
        restoredBackup: backup.filename,
        preSafetyBackupId: preSafetyBackup.id,
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'RESTORE_FAILED', message: err.message });
    }
  }
);

// GET /api/v1/admin/data-protection/backups/:id/download (Secure Authenticated Download)
dataProtectionRouter.get(
  '/admin/data-protection/backups/:id/download',
  requireAuth,
  requireSuperAdmin,
  (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const backup = db.prepare('SELECT * FROM database_backups WHERE id = ?').get(id) as any;

    if (!backup || !fs.existsSync(backup.filepath)) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Backup file not found on disk.' });
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'DATABASE_BACKUP_DOWNLOADED',
      entity: 'DATABASE_BACKUP',
      entityId: id,
      metadata: { filename: backup.filename, size: backup.size_bytes },
    });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    const stream = fs.createReadStream(backup.filepath);
    return stream.pipe(res);
  }
);

// GET /api/v1/admin/data-protection/inventory (Table Breakdown)
dataProtectionRouter.get(
  '/admin/data-protection/inventory',
  requireAuth,
  requireSuperAdmin,
  (_req: AuthenticatedRequest, res) => {
    try {
      const inventory = getDatabaseInventory();
      return res.json({ success: true, inventory });
    } catch (err: any) {
      return res.status(500).json({ error: 'INVENTORY_ERROR', message: err.message });
    }
  }
);

// GET /api/v1/admin/data-protection/migrations (Applied Migrations Log)
dataProtectionRouter.get(
  '/admin/data-protection/migrations',
  requireAuth,
  requireSuperAdmin,
  (_req: AuthenticatedRequest, res) => {
    try {
      const migrations = getAppliedMigrations();
      return res.json({ success: true, migrations });
    } catch (err: any) {
      return res.status(500).json({ error: 'MIGRATIONS_ERROR', message: err.message });
    }
  }
);

// ==============================================================================
// 2. SCHOOL TENANT RECYCLE BIN & CONTROLLED RECORD RESTORATION
// ==============================================================================

// GET /api/v1/school/recycle-bin (List all soft-deleted records for active school)
dataProtectionRouter.get(
  '/school/recycle-bin',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.activeSchoolId!;

    try {
      // 1. Soft-deleted students
      const students = db.prepare(`
        SELECT id, admission_number, first_name, last_name, full_name, class_name, deleted_at, deleted_by, deletion_reason
        FROM students
        WHERE school_id = ? AND is_deleted = 1
        ORDER BY deleted_at DESC
      `).all(schoolId) as any[];

      // 2. Soft-deleted staff
      const staff = db.prepare(`
        SELECT id, staff_number, first_name, last_name, email, job_title, phone, deleted_at, deleted_by, deletion_reason
        FROM staff
        WHERE school_id = ? AND is_deleted = 1
        ORDER BY deleted_at DESC
      `).all(schoolId) as any[];

      // 3. Soft-deleted classes
      const classes = db.prepare(`
        SELECT id, name, level, deleted_at, deleted_by, deletion_reason
        FROM classes
        WHERE school_id = ? AND is_deleted = 1
        ORDER BY deleted_at DESC
      `).all(schoolId) as any[];

      // 4. Soft-deleted parents
      const parents = db.prepare(`
        SELECT id, first_name, last_name, phone, email, deleted_at, deleted_by, deletion_reason
        FROM parents
        WHERE school_id = ? AND is_deleted = 1
        ORDER BY deleted_at DESC
      `).all(schoolId) as any[];

      return res.json({
        success: true,
        recycleBin: {
          students: students.map((s) => ({ ...s, entityType: 'student', displayName: `${s.full_name} (${s.admission_number})` })),
          staff: staff.map((st) => ({ ...st, entityType: 'staff', displayName: `${st.first_name} ${st.last_name} (${st.job_title || st.staff_number})` })),
          classes: classes.map((c) => ({ ...c, entityType: 'class', displayName: `${c.name} (${c.level || 'Class'})` })),
          parents: parents.map((p) => ({ ...p, entityType: 'parent', displayName: `${p.first_name} ${p.last_name} (${p.phone || p.email || 'Parent'})` })),
        },
        counts: {
          students: students.length,
          staff: staff.length,
          classes: classes.length,
          parents: parents.length,
          total: students.length + staff.length + classes.length + parents.length,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'RECYCLE_BIN_ERROR', message: err.message });
    }
  }
);

// POST /api/v1/school/recycle-bin/restore (Restore soft-deleted record)
dataProtectionRouter.post(
  '/school/recycle-bin/restore',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.activeSchoolId!;
    const { entityType, entityId } = req.body;

    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'MISSING_PARAMS', message: 'Entity type and ID are required.' });
    }

    const tableMap: Record<string, string> = {
      student: 'students',
      staff: 'staff',
      class: 'classes',
      parent: 'parents',
    };

    const tableName = tableMap[entityType];
    if (!tableName) {
      return res.status(400).json({ error: 'INVALID_TYPE', message: 'Unsupported entity type for restoration.' });
    }

    // Verify record exists and belongs to this school tenant
    const record = db.prepare(`SELECT * FROM "${tableName}" WHERE id = ? AND school_id = ?`).get(entityId, schoolId) as any;
    if (!record) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Record not found in your school.' });
    }

    if (record.is_deleted !== 1) {
      return res.status(400).json({ error: 'NOT_DELETED', message: 'This record is already active.' });
    }

    // Integrity check for students: verify class exists if student had one assigned
    if (entityType === 'student' && record.class_name) {
      const activeClass = db.prepare(`
        SELECT id FROM classes WHERE school_id = ? AND name = ? AND (is_deleted = 0 OR is_deleted IS NULL)
      `).get(schoolId, record.class_name);
      if (!activeClass) {
        // If class was deleted, reset class assignment to unassigned to avoid foreign key corruption
        db.prepare(`UPDATE students SET class_name = 'Unassigned', class_arm_name = '' WHERE id = ?`).run(entityId);
      }
    }

    // Perform restoration
    db.prepare(`
      UPDATE "${tableName}"
      SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(entityId, schoolId);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'RECORD_RESTORED',
      entity: entityType.toUpperCase(),
      entityId,
      metadata: { tableName, restoredBy: req.user!.email },
    });

    return res.json({
      success: true,
      message: `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} record restored successfully.`,
    });
  }
);

// POST /api/v1/school/recycle-bin/purge (Controlled permanent deletion - School Owner Only)
dataProtectionRouter.post(
  '/school/recycle-bin/purge',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.activeSchoolId!;
    const { entityType, entityId, confirmation } = req.body;

    if (confirmation !== 'CONFIRM_PERMANENT_PURGE') {
      return res.status(400).json({
        error: 'CONFIRMATION_REQUIRED',
        message: 'Explicit confirmation string "CONFIRM_PERMANENT_PURGE" is required for irreversible deletion.',
      });
    }

    const tableMap: Record<string, string> = {
      student: 'students',
      staff: 'staff',
      class: 'classes',
      parent: 'parents',
    };

    const tableName = tableMap[entityType];
    if (!tableName) {
      return res.status(400).json({ error: 'INVALID_TYPE', message: 'Invalid entity type.' });
    }

    // Verify record exists and is in recycle bin
    const record = db.prepare(`SELECT * FROM "${tableName}" WHERE id = ? AND school_id = ?`).get(entityId, schoolId) as any;
    if (!record || record.is_deleted !== 1) {
      return res.status(400).json({ error: 'INVALID_TARGET', message: 'Only items currently in the Recycle Bin can be purged.' });
    }

    // STRICT FINANCIAL GUARD (Requirement 5.E):
    // If student has ANY recorded payments or invoices, permanent deletion is strictly blocked!
    if (entityType === 'student') {
      const paymentCount = (
        db.prepare('SELECT COUNT(*) as c FROM payments WHERE student_id = ? AND school_id = ?').get(entityId, schoolId) as any
      )?.c || 0;
      const invoiceCount = (
        db.prepare('SELECT COUNT(*) as c FROM invoices WHERE student_id = ? AND school_id = ?').get(entityId, schoolId) as any
      )?.c || 0;

      if (paymentCount > 0 || invoiceCount > 0) {
        return res.status(403).json({
          error: 'FINANCIAL_RECORD_PROTECTED',
          message: `Cannot permanently delete this student: ${paymentCount} payment(s) and ${invoiceCount} invoice(s) exist in the school ledger. Financial accounting records are immutable.`,
        });
      }
    }

    // Purge record
    db.prepare(`DELETE FROM "${tableName}" WHERE id = ? AND school_id = ?`).run(entityId, schoolId);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'RECORD_PERMANENTLY_PURGED',
      entity: entityType.toUpperCase(),
      entityId,
      metadata: { tableName, purgedBy: req.user!.email },
    });

    return res.json({
      success: true,
      message: `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} record permanently purged from database.`,
    });
  }
);
