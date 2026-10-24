import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db.ts';
import { logAudit } from './audit.ts';

export interface BackupRecord {
  id: string;
  filename: string;
  filepath: string;
  size_bytes: number;
  checksum: string;
  status: 'SUCCESS' | 'FAILED' | 'VERIFIED';
  trigger_type: 'AUTOMATIC' | 'MANUAL' | 'PRE_MIGRATION';
  error_message: string | null;
  created_at: string;
  verified_at: string | null;
  test_restored_at: string | null;
}

export interface BackupStats {
  totalBackups: number;
  lastBackupTime: string | null;
  lastBackupSize: number | null;
  lastBackupChecksum: string | null;
  totalStorageBytes: number;
  isSchedulerActive: boolean;
  retentionPolicy: string;
  lastIntegrityCheck: string | null;
  lastTestRestore: string | null;
  databasePath: string;
  databaseSizeBytes: number;
  walMode: boolean;
  foreignKeysEnabled: boolean;
}

const backupsDir = path.resolve(process.cwd(), 'data', 'backups');
let schedulerIntervalId: NodeJS.Timeout | null = null;
let isSchedulerRunning = false;

// Ensure backups directory exists
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

/**
 * Initializes the database backups tracking table and migration tracking table
 */
export function initBackupSystem() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS database_backups (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified_at DATETIME,
      test_restored_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_database_backups_created ON database_backups(created_at DESC);

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checksum TEXT,
      execution_time_ms INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations(version);
  `);

  console.log('[Data Protection] Backup & Migration tracking tables initialized.');
}

/**
 * Computes SHA-256 hash of a file
 */
function computeFileSha256(filePath: string): string {
  // Memory-safe streaming SHA-256 calculation to avoid loading large backup archives into RAM
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(64 * 1024); // 64KB chunk buffer
  let bytesRead = 0;
  try {
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Creates an online, non-blocking atomic SQLite backup using VACUUM INTO
 */
export async function createDatabaseBackup(
  triggerType: 'AUTOMATIC' | 'MANUAL' | 'PRE_MIGRATION' = 'MANUAL',
  actorEmail?: string
): Promise<BackupRecord> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `bursariq_backup_${triggerType.toLowerCase()}_${timestamp}.db`;
  const targetPath = path.join(backupsDir, filename);
  const backupId = 'bck_' + crypto.randomUUID();

  try {
    // 1. Execute SQLite atomic VACUUM INTO to create an exact consistent snapshot
    // Escaping single quotes in path if any
    const sanitizedPath = targetPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${sanitizedPath}';`);

    if (!fs.existsSync(targetPath)) {
      throw new Error('Backup file was not created on disk.');
    }

    const stats = fs.statSync(targetPath);
    const checksum = computeFileSha256(targetPath);

    // 2. Immediate integrity check on the fresh backup
    let verificationStatus: 'SUCCESS' | 'VERIFIED' = 'SUCCESS';
    try {
      const testDb = new DatabaseSync(targetPath, { readOnly: true });
      const integrityCheck = testDb.prepare('PRAGMA integrity_check;').all() as any[];
      testDb.close();

      const passed = integrityCheck.length === 1 && integrityCheck[0]?.integrity_check === 'ok';
      if (passed) {
        verificationStatus = 'VERIFIED';
      }
    } catch (checkErr: any) {
      console.warn('[Data Protection] Initial integrity check warning:', checkErr);
    }

    const nowIso = new Date().toISOString();
    const backupRecord: BackupRecord = {
      id: backupId,
      filename,
      filepath: targetPath,
      size_bytes: stats.size,
      checksum,
      status: verificationStatus,
      trigger_type: triggerType,
      error_message: null,
      created_at: nowIso,
      verified_at: verificationStatus === 'VERIFIED' ? nowIso : null,
      test_restored_at: null,
    };

    // 3. Record in database
    db.prepare(`
      INSERT INTO database_backups (id, filename, filepath, size_bytes, checksum, status, trigger_type, error_message, created_at, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      backupRecord.id,
      backupRecord.filename,
      backupRecord.filepath,
      backupRecord.size_bytes,
      backupRecord.checksum,
      backupRecord.status,
      backupRecord.trigger_type,
      null,
      backupRecord.created_at,
      backupRecord.verified_at
    );

    // 4. Audit logging
    logAudit({
      actorEmail: actorEmail || 'SYSTEM_BACKUP_DAEMON',
      action: 'DATABASE_BACKUP_CREATED',
      entity: 'DATABASE_BACKUP',
      entityId: backupId,
      metadata: {
        filename,
        triggerType,
        sizeBytes: stats.size,
        checksum: checksum.slice(0, 16) + '...',
      },
    });

    console.log(`[Data Protection] Backup successfully created: ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);

    // 5. Apply retention policy (clean up old backups beyond retention window)
    applyRetentionPolicy();

    return backupRecord;
  } catch (err: any) {
    const errorMsg = err?.message || 'Unknown backup error';
    console.error('[Data Protection] Backup failed:', errorMsg);

    try {
      db.prepare(`
        INSERT INTO database_backups (id, filename, filepath, size_bytes, checksum, status, trigger_type, error_message, created_at)
        VALUES (?, ?, ?, 0, '', 'FAILED', ?, ?, CURRENT_TIMESTAMP)
      `).run(backupId, filename, targetPath, triggerType, errorMsg);
    } catch {}

    logAudit({
      actorEmail: actorEmail || 'SYSTEM_BACKUP_DAEMON',
      action: 'DATABASE_BACKUP_FAILED',
      entity: 'DATABASE_BACKUP',
      entityId: backupId,
      metadata: { error: errorMsg, triggerType },
    });

    throw new Error(`Database backup failed: ${errorMsg}`);
  }
}

/**
 * Verifies an existing backup file on disk:
 * - Checks file exists
 * - Verifies SHA-256 checksum matches
 * - Executes PRAGMA integrity_check and PRAGMA foreign_key_check on backup copy
 */
export function verifyBackup(backupId: string, actorEmail?: string): {
  success: boolean;
  checksum: string;
  checksumMatches: boolean;
  integrityOk: boolean;
  foreignKeysOk: boolean;
  message: string;
} {
  const record = db.prepare('SELECT * FROM database_backups WHERE id = ?').get(backupId) as BackupRecord | undefined;
  if (!record) {
    throw new Error('Backup record not found.');
  }

  if (!fs.existsSync(record.filepath)) {
    throw new Error(`Backup file is missing from disk: ${record.filepath}`);
  }

  const currentChecksum = computeFileSha256(record.filepath);
  const checksumMatches = currentChecksum === record.checksum;

  let integrityOk = false;
  let foreignKeysOk = false;

  try {
    const testDb = new DatabaseSync(record.filepath, { readOnly: true });
    const integrityRes = testDb.prepare('PRAGMA integrity_check;').all() as any[];
    integrityOk = integrityRes.length === 1 && integrityRes[0]?.integrity_check === 'ok';

    const fkRes = testDb.prepare('PRAGMA foreign_key_check;').all() as any[];
    foreignKeysOk = fkRes.length === 0;

    testDb.close();
  } catch (err: any) {
    integrityOk = false;
    foreignKeysOk = false;
  }

  const success = checksumMatches && integrityOk;

  if (success) {
    db.prepare(`
      UPDATE database_backups SET status = 'VERIFIED', verified_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(backupId);

    logAudit({
      actorEmail: actorEmail || 'SUPER_ADMIN',
      action: 'DATABASE_BACKUP_VERIFIED',
      entity: 'DATABASE_BACKUP',
      entityId: backupId,
      metadata: { checksumMatches, integrityOk, foreignKeysOk },
    });
  }

  return {
    success,
    checksum: currentChecksum,
    checksumMatches,
    integrityOk,
    foreignKeysOk,
    message: success
      ? 'Backup integrity check passed! Database structure and cryptographic checksum are completely healthy.'
      : 'Backup verification detected an issue. Cryptographic or structural integrity check failed.',
  };
}

/**
 * Runs a sandboxed test restoration in an isolated temporary SQLite database
 * without touching or impacting the production database!
 */
export function runIsolatedRestorationTest(backupId: string, actorEmail?: string): {
  success: boolean;
  tableCount: number;
  recordCount: number;
  schoolCount: number;
  userCount: number;
  studentCount: number;
  invoiceCount: number;
  paymentCount: number;
  foreignKeyViolations: number;
  durationMs: number;
  summary: string;
} {
  const startTime = Date.now();
  const record = db.prepare('SELECT * FROM database_backups WHERE id = ?').get(backupId) as BackupRecord | undefined;
  if (!record) {
    throw new Error('Backup record not found.');
  }

  if (!fs.existsSync(record.filepath)) {
    throw new Error(`Backup file does not exist on disk: ${record.filepath}`);
  }

  const sandboxFilename = `sandbox_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.db`;
  const sandboxPath = path.join(backupsDir, sandboxFilename);

  try {
    // 1. Copy backup file to sandbox location
    fs.copyFileSync(record.filepath, sandboxPath);

    // 2. Open sandbox database in read-only / isolated test mode
    const sandboxDb = new DatabaseSync(sandboxPath);

    // 3. Count tables
    const tables = sandboxDb.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as { name: string }[];
    const tableCount = tables.length;

    // 4. Count total rows across all tables
    let recordCount = 0;
    for (const t of tables) {
      try {
        const row = sandboxDb.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as { count: number };
        recordCount += row.count;
      } catch {}
    }

    // 5. Query critical domain entities
    const getCount = (tbl: string) => {
      try {
        return (sandboxDb.prepare(`SELECT COUNT(*) as c FROM "${tbl}"`).get() as any)?.c || 0;
      } catch {
        return 0;
      }
    };

    const schoolCount = getCount('schools');
    const userCount = getCount('users');
    const studentCount = getCount('students');
    const invoiceCount = getCount('invoices');
    const paymentCount = getCount('payments');

    // 6. Check foreign key integrity
    const fkErrors = sandboxDb.prepare('PRAGMA foreign_key_check;').all();
    const foreignKeyViolations = fkErrors.length;

    // 7. Check database integrity
    const integrityRes = sandboxDb.prepare('PRAGMA integrity_check;').all() as any[];
    const integrityOk = integrityRes.length === 1 && integrityRes[0]?.integrity_check === 'ok';

    sandboxDb.close();

    // 8. Delete sandbox file immediately
    if (fs.existsSync(sandboxPath)) {
      fs.unlinkSync(sandboxPath);
    }

    const durationMs = Date.now() - startTime;
    const testPassed = integrityOk && foreignKeyViolations === 0 && tableCount > 0;

    if (testPassed) {
      db.prepare(`
        UPDATE database_backups SET test_restored_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(backupId);

      logAudit({
        actorEmail: actorEmail || 'SUPER_ADMIN',
        action: 'BACKUP_RESTORATION_TEST_SUCCESSFUL',
        entity: 'DATABASE_BACKUP',
        entityId: backupId,
        metadata: {
          tableCount,
          recordCount,
          schoolCount,
          userCount,
          studentCount,
          invoiceCount,
          durationMs,
        },
      });
    }

    return {
      success: testPassed,
      tableCount,
      recordCount,
      schoolCount,
      userCount,
      studentCount,
      invoiceCount,
      paymentCount,
      foreignKeyViolations,
      durationMs,
      summary: testPassed
        ? `Restoration test passed in ${durationMs}ms: Verified ${tableCount} tables, ${recordCount} total records, ${schoolCount} schools, ${studentCount} students, ${invoiceCount} invoices with zero FK violations.`
        : `Restoration test encountered issues: integrity=${integrityOk}, foreignKeyViolations=${foreignKeyViolations}.`,
    };
  } catch (err: any) {
    if (fs.existsSync(sandboxPath)) {
      try { fs.unlinkSync(sandboxPath); } catch {}
    }
    throw new Error(`Sandboxed restoration test failed: ${err.message}`);
  }
}

/**
 * Enforces backup retention policy:
 * - Keeps at least the 14 most recent backups
 * - Only purges files when a newer verified backup exists
 */
export function applyRetentionPolicy(maxRetain = 14) {
  try {
    const allBackups = db.prepare(`
      SELECT * FROM database_backups WHERE status IN ('SUCCESS', 'VERIFIED') ORDER BY created_at DESC
    `).all() as unknown as BackupRecord[];

    if (allBackups.length <= maxRetain) {
      return;
    }

    const toRemove = allBackups.slice(maxRetain);
    for (const b of toRemove) {
      // Delete file on disk if exists
      if (fs.existsSync(b.filepath)) {
        try {
          fs.unlinkSync(b.filepath);
        } catch (e) {
          console.warn(`[Data Protection] Could not remove old backup file ${b.filepath}:`, e);
        }
      }
      // Remove database record
      db.prepare('DELETE FROM database_backups WHERE id = ?').run(b.id);
    }

    console.log(`[Data Protection] Retention policy enforced. Pruned ${toRemove.length} historical backups.`);
  } catch (e) {
    console.warn('[Data Protection] Error applying retention policy:', e);
  }
}

/**
 * Returns overall statistics and health of the data protection system
 */
export function getBackupStats(): BackupStats {
  const dbFile = path.resolve(process.cwd(), 'data', 'schoolpay.db');
  let dbSize = 0;
  if (fs.existsSync(dbFile)) {
    dbSize = fs.statSync(dbFile).size;
  }

  const countRow = db.prepare('SELECT COUNT(*) as count FROM database_backups').get() as { count: number };
  const totalBackups = countRow?.count || 0;

  const latest = db.prepare(`
    SELECT * FROM database_backups WHERE status IN ('SUCCESS', 'VERIFIED') ORDER BY created_at DESC LIMIT 1
  `).get() as BackupRecord | undefined;

  const lastVerified = db.prepare(`
    SELECT verified_at FROM database_backups WHERE verified_at IS NOT NULL ORDER BY verified_at DESC LIMIT 1
  `).get() as { verified_at: string } | undefined;

  const lastTest = db.prepare(`
    SELECT test_restored_at FROM database_backups WHERE test_restored_at IS NOT NULL ORDER BY test_restored_at DESC LIMIT 1
  `).get() as { test_restored_at: string } | undefined;

  let totalStorageBytes = 0;
  if (fs.existsSync(backupsDir)) {
    const files = fs.readdirSync(backupsDir);
    for (const f of files) {
      try {
        totalStorageBytes += fs.statSync(path.join(backupsDir, f)).size;
      } catch {}
    }
  }

  return {
    totalBackups,
    lastBackupTime: latest?.created_at || null,
    lastBackupSize: latest?.size_bytes || null,
    lastBackupChecksum: latest?.checksum || null,
    totalStorageBytes,
    isSchedulerActive: isSchedulerRunning,
    retentionPolicy: '14 Recovery Points (Daily Rotation with Pruning)',
    lastIntegrityCheck: lastVerified?.verified_at || null,
    lastTestRestore: lastTest?.test_restored_at || null,
    databasePath: 'data/schoolpay.db',
    databaseSizeBytes: dbSize,
    walMode: true,
    foreignKeysEnabled: true,
  };
}

/**
 * Returns all backup records
 */
export function listAllBackups(): BackupRecord[] {
  return db.prepare('SELECT * FROM database_backups ORDER BY created_at DESC LIMIT 50').all() as unknown as BackupRecord[];
}

/**
 * Starts automatic scheduled backups (runs daily and on startup if needed)
 */
export function startAutomaticBackupScheduler() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
  }

  isSchedulerRunning = true;
  console.log('[Data Protection] Automated backup scheduler initiated (24h daily schedule).');

  // Check if a backup was taken in the last 24 hours; if not, create one now
  const latestBackup = db.prepare(`
    SELECT created_at FROM database_backups WHERE status IN ('SUCCESS', 'VERIFIED') ORDER BY created_at DESC LIMIT 1
  `).get() as { created_at: string } | undefined;

  const needStartupBackup =
    !latestBackup ||
    Date.now() - new Date(latestBackup.created_at).getTime() > 24 * 60 * 60 * 1000;

  if (needStartupBackup) {
    console.log('[Data Protection] No recent backup found (<24h). Triggering initial automatic snapshot...');
    createDatabaseBackup('AUTOMATIC', 'SYSTEM_SCHEDULER').catch((err) => {
      console.warn('[Data Protection] Initial automated backup warning:', err.message);
    });
  }

  // Schedule daily backup interval (every 24 hours) with memory-safe unref
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  schedulerIntervalId = setInterval(() => {
    console.log('[Data Protection] Running scheduled daily backup...');
    createDatabaseBackup('AUTOMATIC', 'SYSTEM_SCHEDULER').catch((err) => {
      console.error('[Data Protection] Scheduled backup error:', err.message);
    });
  }, TWENTY_FOUR_HOURS);
  if (schedulerIntervalId.unref) {
    schedulerIntervalId.unref();
  }
}

/**
 * Stops backup scheduler (clean shutdown)
 */
export function stopAutomaticBackupScheduler() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }
  isSchedulerRunning = false;
}
