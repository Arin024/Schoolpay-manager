import { db } from './db.ts';
import { createDatabaseBackup } from './backupService.ts';
import { logAudit } from './audit.ts';

export interface MigrationRecord {
  id: string;
  version: number;
  name: string;
  applied_at: string;
  checksum: string | null;
  execution_time_ms: number;
}

export interface TableInventoryItem {
  tableName: string;
  rowCount: number;
  hasSoftDelete: boolean;
  hasTenantIsolation: boolean;
  isFinancialLedger: boolean;
  protectionTier: 'CRITICAL_FINANCIAL' | 'CORE_TENANT' | 'SYSTEM_SECURITY';
}

function ensureSoftDeleteColumnsIdempotent() {
  const tablesToProtect = [
    'students',
    'staff',
    'classes',
    'class_arms',
    'parents',
    'fee_categories',
    'invoices',
  ];

  for (const table of tablesToProtect) {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!tableExists) continue;

    const cols = (db.prepare(`PRAGMA table_info("${table}")`).all() as any[]).map((c) => c.name);

    if (!cols.includes('is_deleted')) {
      try {
        db.exec(`ALTER TABLE "${table}" ADD COLUMN is_deleted INTEGER DEFAULT 0;`);
      } catch (e) {}
    }
    if (!cols.includes('deleted_at')) {
      try {
        db.exec(`ALTER TABLE "${table}" ADD COLUMN deleted_at DATETIME;`);
      } catch (e) {}
    }
    if (!cols.includes('deleted_by')) {
      try {
        db.exec(`ALTER TABLE "${table}" ADD COLUMN deleted_by TEXT;`);
      } catch (e) {}
    }
    if (!cols.includes('deletion_reason')) {
      try {
        db.exec(`ALTER TABLE "${table}" ADD COLUMN deletion_reason TEXT;`);
      } catch (e) {}
    }
  }

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_students_active ON students(school_id, is_deleted);
      CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(school_id, is_deleted);
      CREATE INDEX IF NOT EXISTS idx_classes_active ON classes(school_id, is_deleted);
      CREATE INDEX IF NOT EXISTS idx_invoices_active ON invoices(school_id, is_deleted);
    `);
  } catch (e) {}
}

/**
 * Migration 1: Soft-Deletion Columns & Multi-Tenant Data Protection
 */
function applyMigration001SoftDeletion(): boolean {
  console.log('[Migration] Applying Migration 001: Soft Deletion & Data Protection columns...');
  ensureSoftDeleteColumnsIdempotent();
  return true;
}

/**
 * Migration 2: Payment Reversals, Refunds & Bank Reconciliation
 */
function applyMigration002ReconciliationAndReversals(): boolean {
  console.log('[Migration] Applying Migration 002: Reversals, Refunds & Payment Reconciliation...');

  const paymentCols = (db.prepare('PRAGMA table_info("payments")').all() as any[]).map((c) => c.name);
  const colsToAdd: [string, string][] = [
    ['is_reversed', 'INTEGER DEFAULT 0'],
    ['reversed_at', 'DATETIME'],
    ['reversed_by', 'TEXT'],
    ['reversal_reason', 'TEXT'],
    ['is_refunded', 'INTEGER DEFAULT 0'],
    ['refunded_at', 'DATETIME'],
    ['refunded_by', 'TEXT'],
    ['refund_reason', 'TEXT'],
    ['refund_amount', 'INTEGER DEFAULT 0'],
    ['reconciliation_status', "TEXT DEFAULT 'UNMATCHED'"],
    ['reconciled_at', 'DATETIME'],
    ['reconciled_by', 'TEXT'],
    ['reconciliation_notes', 'TEXT'],
  ];

  for (const [colName, colDef] of colsToAdd) {
    if (!paymentCols.includes(colName)) {
      try {
        db.exec(`ALTER TABLE payments ADD COLUMN "${colName}" ${colDef};`);
      } catch (e) {}
    }
  }

  // Create payment_reversals and bank_statement_entries tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_reversals (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      amount_kobo INTEGER NOT NULL,
      reversal_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      approved_by TEXT,
      status TEXT NOT NULL DEFAULT 'APPROVED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_reversals_school ON payment_reversals(school_id);
    CREATE INDEX IF NOT EXISTS idx_reversals_payment ON payment_reversals(payment_id);

    CREATE TABLE IF NOT EXISTS bank_statement_entries (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      value_date TEXT,
      reference TEXT NOT NULL,
      description TEXT,
      amount_kobo INTEGER NOT NULL,
      entry_type TEXT NOT NULL DEFAULT 'CREDIT',
      channel TEXT DEFAULT 'TRANSFER',
      payer_name TEXT,
      matched_payment_id TEXT,
      match_status TEXT DEFAULT 'UNMATCHED',
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      imported_by TEXT,
      reconciled_at DATETIME,
      reconciled_by TEXT,
      reconciliation_decision TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bank_stmt_school ON bank_statement_entries(school_id, match_status);
    CREATE INDEX IF NOT EXISTS idx_bank_stmt_ref ON bank_statement_entries(reference);
  `);

  return true;
}

/**
 * Migration 3: Performance Management, Report Cards, Attendance, Behaviour & Portal Accounts
 */
function applyMigration003PerformanceAndPortals(): boolean {
  console.log('[Migration] Applying Migration 003: Performance Management & Portals...');

  try {
    db.exec(`
      INSERT OR IGNORE INTO roles (id, name, display_name, description, scope)
      VALUES ('role_student', 'STUDENT', 'Student / Learner', 'Student portal read-only access to published results, attendance, and report cards', 'SCHOOL');
    `);
  } catch {}

  const stuCols = (db.prepare('PRAGMA table_info("students")').all() as any[]).map((c) => c.name);
  if (!stuCols.includes('user_id')) {
    try { db.exec('ALTER TABLE students ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;'); } catch {}
  }

  const psCols = (db.prepare('PRAGMA table_info("parent_students")').all() as any[]).map((c) => c.name);
  if (!psCols.includes('verified_by')) {
    try { db.exec('ALTER TABLE parent_students ADD COLUMN verified_by TEXT;'); } catch {}
  }
  if (!psCols.includes('verified_at')) {
    try { db.exec('ALTER TABLE parent_students ADD COLUMN verified_at DATETIME;'); } catch {}
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);
    CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school_id, is_deleted);
    CREATE INDEX IF NOT EXISTS idx_examinations_school_status ON examinations(school_id, status, is_deleted);
    CREATE INDEX IF NOT EXISTS idx_scores_school_exam ON student_scores(school_id, examination_id);
    CREATE INDEX IF NOT EXISTS idx_scores_student_status ON student_scores(school_id, student_id, status);
    CREATE INDEX IF NOT EXISTS idx_score_corrections_school ON score_correction_logs(school_id, examination_id);
    CREATE INDEX IF NOT EXISTS idx_report_cards_school_student ON report_cards(school_id, student_id, status);
    CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance_records(school_id, attendance_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_student_pub ON attendance_records(school_id, student_id, is_published);
    CREATE INDEX IF NOT EXISTS idx_behaviour_school_student ON behaviour_records(school_id, student_id, is_deleted);
    CREATE INDEX IF NOT EXISTS idx_teacher_remarks_school_student ON teacher_remarks(school_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_announcements_school ON school_announcements(school_id, is_published, is_deleted);
  `);

  return true;
}

/**
 * Migration 4: Full-Session Cumulative Report Cards (Additive Only)
 */
function applyMigration004SessionReportCards(): boolean {
  console.log('[Migration] Applying Migration 004: Session Report Cards...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_report_cards (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
      academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED')),
      total_score REAL DEFAULT 0,
      average_score REAL DEFAULT 0,
      subjects_count INTEGER DEFAULT 0,
      terms_count INTEGER DEFAULT 0,
      class_position INTEGER,
      class_size INTEGER,
      promotion_status TEXT DEFAULT 'PENDING',
      term_averages_json TEXT,
      attendance_summary_json TEXT,
      behaviour_summary_json TEXT,
      teacher_remark TEXT,
      principal_remark TEXT,
      snapshot_json TEXT,
      verification_code TEXT,
      approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      approved_at DATETIME,
      published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      published_at DATETIME,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (school_id, student_id, academic_session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_report_cards_school_student ON session_report_cards(school_id, student_id, status);
  `);
  return true;
}

/**
 * Runs safe, version-controlled incremental schema migrations
 */
export async function runSafeMigrations() {
  // Always idempotently verify soft-delete columns on SQLite tables in case schema.sql recreated a clean table
  ensureSoftDeleteColumnsIdempotent();

  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checksum TEXT,
      execution_time_ms INTEGER DEFAULT 0
    );
  `);

  const appliedVersions = (
    db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  ).map((r) => r.version);

  const migrations: {
    version: number;
    name: string;
    apply: () => boolean;
  }[] = [
    {
      version: 1,
      name: 'add_soft_deletion_and_recycle_bin_guards',
      apply: applyMigration001SoftDeletion,
    },
    {
      version: 2,
      name: 'add_payment_reversals_refunds_and_reconciliation_workspace',
      apply: applyMigration002ReconciliationAndReversals,
    },
    {
      version: 3,
      name: 'add_performance_report_cards_attendance_behaviour_and_portals',
      apply: applyMigration003PerformanceAndPortals,
    },
    {
      version: 4,
      name: 'add_session_report_cards',
      apply: applyMigration004SessionReportCards,
    },
  ];

  for (const m of migrations) {
    if (appliedVersions.includes(m.version)) {
      continue;
    }

    console.log(`[Migration] Starting Version ${m.version}: ${m.name}`);
    const startMs = Date.now();

    // Take an automated safety snapshot before applying risky schema changes
    try {
      await createDatabaseBackup('PRE_MIGRATION', 'MIGRATION_ENGINE');
    } catch (bckErr: any) {
      console.warn('[Migration] Pre-migration backup warning:', bckErr.message);
    }

    // Apply migration
    db.exec('BEGIN TRANSACTION;');
    try {
      m.apply();

      const durationMs = Date.now() - startMs;
      db.prepare(`
        INSERT INTO schema_migrations (id, version, name, execution_time_ms)
        VALUES (?, ?, ?, ?)
      `).run(`mig_${m.version}`, m.version, m.name, durationMs);

      db.exec('COMMIT;');

      logAudit({
        actorEmail: 'SYSTEM_MIGRATION_ENGINE',
        action: 'SCHEMA_MIGRATION_APPLIED',
        entity: 'DATABASE_SCHEMA',
        entityId: `v${m.version}`,
        metadata: { version: m.version, name: m.name, durationMs },
      });

      console.log(`[Migration] Version ${m.version} (${m.name}) successfully applied in ${durationMs}ms.`);
    } catch (err: any) {
      db.exec('ROLLBACK;');
      console.error(`[Migration] Version ${m.version} failed:`, err);
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${err.message}`);
    }
  }
}

/**
 * Retrieves all applied migration records
 */
export function getAppliedMigrations(): MigrationRecord[] {
  return db.prepare('SELECT * FROM schema_migrations ORDER BY version ASC').all() as unknown as MigrationRecord[];
}

/**
 * Inventories all tables in SQLite database with record counts and protection tiers
 */
export function getDatabaseInventory(): TableInventoryItem[] {
  const tableRows = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC
  `).all() as { name: string }[];

  const financialTables = new Set([
    'payments',
    'payment_reversals',
    'bank_statement_entries',
    'receipts',
    'invoices',
    'invoice_items',
    'fee_structures',
    'fee_structure_items',
    'fee_categories',
    'platform_payments',
    'platform_invoices',
    'commissions',
  ]);

  const securityTables = new Set([
    'users',
    'user_roles',
    'user_recovery_codes',
    'recovery_challenges',
    'password_resets',
    'sessions',
    'audit_logs',
    'permissions',
    'roles',
    'database_backups',
    'schema_migrations',
  ]);

  const inventory: TableInventoryItem[] = [];

  for (const t of tableRows) {
    const tableName = t.name;
    let rowCount = 0;
    try {
      const res = db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get() as { c: number };
      rowCount = res.c;
    } catch {}

    const cols = (db.prepare(`PRAGMA table_info("${tableName}")`).all() as any[]).map((c) => c.name);
    const hasSoftDelete = cols.includes('is_deleted');
    const hasTenantIsolation = cols.includes('school_id');
    const isFinancialLedger = financialTables.has(tableName);

    let protectionTier: 'CRITICAL_FINANCIAL' | 'CORE_TENANT' | 'SYSTEM_SECURITY' = 'CORE_TENANT';
    if (isFinancialLedger) {
      protectionTier = 'CRITICAL_FINANCIAL';
    } else if (securityTables.has(tableName)) {
      protectionTier = 'SYSTEM_SECURITY';
    }

    inventory.push({
      tableName,
      rowCount,
      hasSoftDelete,
      hasTenantIsolation,
      isFinancialLedger,
      protectionTier,
    });
  }

  return inventory;
}
