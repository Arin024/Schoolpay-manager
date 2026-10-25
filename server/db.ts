import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { translateSqlForPostgres } from './dbAdapter.ts';
import { MIGRATION_ORDER } from './postgresMigration.ts';
import { initBackupSystem, startAutomaticBackupScheduler } from './backupService.ts';
import { runSafeMigrations } from './migrationService.ts';
import { ensureNeonEnvironment } from './neonEnvResolver.ts';

// Ensure data directory exists
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'schoolpay.db');
const rawDb = new DatabaseSync(dbPath);

// Enable WAL mode, foreign keys, and strict memory limits for SQLite in low-memory environments
rawDb.exec('PRAGMA journal_mode = WAL;');
rawDb.exec('PRAGMA foreign_keys = ON;');
rawDb.exec('PRAGMA cache_size = -2000;'); // Cap SQLite page cache to ~2MB RAM (negative = KiB)
rawDb.exec('PRAGMA mmap_size = 0;');       // Disable memory-mapped I/O to avoid virtual memory exhaustion
rawDb.exec('PRAGMA temp_store = MEMORY;'); // Store temporary tables in tight memory
rawDb.exec('PRAGMA wal_autocheckpoint = 100;'); // Checkpoint WAL frequently (every 100 pages ~400KB) to prevent WAL file bloat

// Neon PostgreSQL State & Pool
let pgPool: pg.Pool | null = null;
let pgConnected = false;
let pgStatusInfo: any = null;
let pgEndpointHostPrefix = 'NONE';

export function getPgPool(): pg.Pool | null {
  return pgPool;
}

export function isPgConnected(): boolean {
  return pgConnected;
}

export function markPgConnected(): void {
  if (!pgConnected) {
    pgConnected = true;
    pgStatusInfo = {
      ...(pgStatusInfo || {}),
      status: 'CONNECTED',
      reconnectedAt: new Date().toISOString(),
    };
  }
}

export function getPgEndpointHostPrefix(): string {
  return pgEndpointHostPrefix;
}

export function isTransientPgError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    msg.includes('connection terminated') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('client has encountered a connection error') ||
    msg.includes('terminating connection') ||
    code === '57P01' ||
    code === '08006' ||
    code === '08003' ||
    code === '08001' ||
    code === 'ECONNRESET'
  );
}

/**
 * Executes a parameterized PostgreSQL query ($1, $2, ...) with automatic 1x retry
 * if Neon Serverless closed an idle pooled socket during scale-to-zero.
 */
export async function queryPg(sql: string, params: any[] = []): Promise<pg.QueryResult<any>> {
  if (!pgPool) {
    throw new Error('Neon PostgreSQL pool is not configured');
  }
  const cleanParams = params.map((p) => (p === undefined ? null : p));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await pgPool.query(sql, cleanParams);
      markPgConnected();
      return res;
    } catch (err: any) {
      if (attempt === 1 && isTransientPgError(err)) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      throw err;
    }
  }
  throw new Error('PostgreSQL query retry exhausted');
}

export async function ensurePgConnected(): Promise<boolean> {
  if (pgConnected && pgPool) return true;
  if (!pgPool) return false;
  try {
    await queryPg('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function getPgStatus(): any {
  return pgStatusInfo;
}

/**
 * Direct local SQLite cache handle (does NOT trigger write-through back to PostgreSQL).
 * Always use cacheDb with ON CONFLICT(...) DO UPDATE (never INSERT OR REPLACE on parent tables)
 * when syncing authoritative rows from Neon PostgreSQL into the local SQLite read cache.
 */
export const cacheDb = rawDb;

// Proxied db instance with safe, lightweight write-through replication to Neon PostgreSQL
let isInitialSeedingInProgress = false;

export function setInitialSeedingState(inProgress: boolean) {
  isInitialSeedingInProgress = inProgress;
}

export const db = {
  exec(sql: string) {
    rawDb.exec(sql);
    if (!isInitialSeedingInProgress && pgPool) {
      const trimmed = sql.trim().toUpperCase();
      if (
        trimmed.startsWith('INSERT') ||
        trimmed.startsWith('UPDATE') ||
        trimmed.startsWith('DELETE')
      ) {
        const pgSql = translateSqlForPostgres(sql);
        pgPool
          .query(pgSql)
          .then(() => markPgConnected())
          .catch((err) => {
            console.warn('[PG Write-Through exec Notice]', err?.message);
          });
      }
    }
  },

  prepare(sql: string) {
    const rawStmt = rawDb.prepare(sql);
    return {
      run(...params: any[]) {
        const res = rawStmt.run(...params);
        if (!isInitialSeedingInProgress && pgPool) {
          const trimmed = sql.trim().toUpperCase();
          if (
            trimmed.startsWith('INSERT') ||
            trimmed.startsWith('UPDATE') ||
            trimmed.startsWith('DELETE')
          ) {
            const pgSql = translateSqlForPostgres(sql);
            const pgParams = params.map((p) => (p === undefined ? null : p));
            pgPool
              .query(pgSql, pgParams)
              .then(() => markPgConnected())
              .catch((err) => {
                console.warn('[PG Write-Through run Notice]', err?.message);
              });
          }
        }
        return res;
      },
      get(...params: any[]) {
        return rawStmt.get(...params);
      },
      all(...params: any[]) {
        return rawStmt.all(...params);
      },
    };
  },
};

/**
 * Executes a query directly on Neon PostgreSQL as the authoritative store
 */
export async function queryNeonDirectly(sql: string, params: any[] = []): Promise<any[]> {
  if (!pgPool) {
    throw new Error('Neon PostgreSQL is not configured');
  }
  const pgSql = translateSqlForPostgres(sql);
  const res = await queryPg(pgSql, params);
  return res.rows;
}

/**
 * Executes a function within a strict, atomic PostgreSQL transaction boundary.
 * Automatically executes BEGIN, COMMIT on success, or ROLLBACK on error.
 */
export async function executePgTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (!pgPool) {
    throw new Error('Durable Neon PostgreSQL database connection is unavailable.');
  }
  if (!pgConnected) {
    const ok = await ensurePgConnected();
    if (!ok) {
      throw new Error('Durable Neon PostgreSQL database connection is unavailable.');
    }
  }
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    markPgConnected();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reconciles local engine state on demand from authoritative Neon PostgreSQL
 */
export async function reconcileCacheFromNeon(): Promise<{ success: boolean; tableCount: number; message: string }> {
  if (!pgPool || !(await ensurePgConnected())) {
    return { success: false, tableCount: 0, message: 'Neon PostgreSQL is not connected' };
  }
  await hydrateSqliteFromPostgres();
  return { success: true, tableCount: MIGRATION_ORDER.length, message: 'Local cache reconciled from Neon PostgreSQL' };
}

export async function initDatabase() {
  // 1. Initialize data protection & backup tracking tables
  initBackupSystem();

  // 2. CRITICAL FIX: Ensure schema.sql executes FIRST so all 44 tables exist in SQLite before hydration
  const schemaPath = path.resolve(process.cwd(), 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    rawDb.exec(schemaSql);
  }

  // 3. Run dynamic schema column migrations to ensure all columns and nullable constraints exist
  setInitialSeedingState(true);
  try {
    migrateStep2Columns();
    migrateStep4Columns();
    migrateStep5Columns();
    migrateRecoveryColumns();
    migrateNullableDirectoryColumnsSqlite();
  } finally {
    setInitialSeedingState(false);
  }

  // 4. Ensure Neon configuration is resolved and available
  await ensureNeonEnvironment();

  // 5. Initialize and verify Neon PostgreSQL if DATABASE_URL is configured
  let rawEnvUrl = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || '').trim();
  if ((rawEnvUrl.startsWith('"') && rawEnvUrl.endsWith('"')) || (rawEnvUrl.startsWith("'") && rawEnvUrl.endsWith("'"))) {
    rawEnvUrl = rawEnvUrl.slice(1, -1).trim();
  }
  if (rawEnvUrl.includes('DATABASE_URL=')) {
    const parts = rawEnvUrl.split('DATABASE_URL=');
    rawEnvUrl = parts[parts.length - 1].trim();
  }
  const urlLines = rawEnvUrl.split('\n').map(l => l.trim());
  const pgLine = urlLines.find(l => l.startsWith('postgres://') || l.startsWith('postgresql://') || l.includes('DATABASE_URL='));
  if (pgLine) {
    rawEnvUrl = pgLine.replace('DATABASE_URL=', '').replace(/^["']|["']$/g, '').trim();
  }
  const databaseUrl = rawEnvUrl;
  if (databaseUrl) {
    try {
      const parsedHost = new URL(databaseUrl).hostname;
      pgEndpointHostPrefix = parsedHost.split('.')[0] || parsedHost.slice(0, 18);
    } catch {
      pgEndpointHostPrefix = 'CONFIGURED';
    }

    pgPool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: true },
      max: 5,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 30000, // Generous 30s timeout for Neon serverless cold wake-up
      statement_timeout: 30000,
      keepAlive: true,
      maxUses: 500,
    });

    // CRITICAL: Prevent idle Neon socket closures from crashing the Node.js process
    pgPool.on('error', (poolErr: any) => {
      console.warn('[Neon PostgreSQL Idle Client Notice]', poolErr?.message);
    });

    let lastErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const client = await pgPool.connect();
        try {
          const testRes = await client.query(
            'SELECT current_database() AS database_name, current_user AS database_user, version() AS postgres_version, NOW() AS database_time;'
          );
          pgConnected = true;
          pgStatusInfo = {
            databaseName: testRes.rows[0].database_name,
            databaseUser: testRes.rows[0].database_user,
            endpoint: pgEndpointHostPrefix,
            connectedAt: testRes.rows[0].database_time,
            status: 'CONNECTED',
          };
          console.log(`[Neon PostgreSQL] Connected successfully to database "${pgStatusInfo.databaseName}" on ${pgEndpointHostPrefix} (attempt ${attempt})`);

          // Ensure optional directory and academic date columns are nullable in authoritative Neon PostgreSQL
          const alterStatements = [
            'ALTER TABLE parents ALTER COLUMN phone DROP NOT NULL',
            'ALTER TABLE students ALTER COLUMN admission_number DROP NOT NULL',
            'ALTER TABLE students ALTER COLUMN gender DROP NOT NULL',
            'ALTER TABLE staff ALTER COLUMN staff_number DROP NOT NULL',
            'ALTER TABLE staff ALTER COLUMN email DROP NOT NULL',
            'ALTER TABLE staff ALTER COLUMN phone DROP NOT NULL',
            'ALTER TABLE staff ALTER COLUMN job_title DROP NOT NULL',
            'ALTER TABLE academic_sessions ALTER COLUMN start_date DROP NOT NULL',
            'ALTER TABLE academic_sessions ALTER COLUMN end_date DROP NOT NULL',
            'ALTER TABLE terms ALTER COLUMN start_date DROP NOT NULL',
            'ALTER TABLE terms ALTER COLUMN end_date DROP NOT NULL',
          ];
          for (const stmt of alterStatements) {
            try {
              await client.query(stmt);
            } catch {
              // Column may already be nullable
            }
          }
        } finally {
          client.release();
        }
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        console.warn(`[Neon PostgreSQL Connect Attempt ${attempt}/3 Notice]`, err?.message);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    }

    if (pgConnected) {
      // 6. Hydrate local state from authoritative Neon PostgreSQL NOW that tables and columns exist!
      await hydrateSqliteFromPostgres();
    } else if (lastErr) {
      pgStatusInfo = { status: 'DISCONNECTED', endpoint: pgEndpointHostPrefix, error: lastErr.message };
    }
  }

  // 7. Execute safe version-controlled migrations & idempotent base seeds WITHOUT echoing demo seeds to PG
  setInitialSeedingState(true);
  try {
    try {
      await runSafeMigrations();
    } catch (err) {
      console.error('[Migration Error]', err);
    }

    // 8. Ensure base schools, users, and roles exist (idempotent, never overwrite existing user data)
    seedInitialData();

    // 9. Ensure Step 2 modules (academic sessions, terms, classes, arms, staff, parents, students) are seeded
    seedStep2SchoolManagement();

    // 10. Ensure Step 3 financial modules (categories, structures, invoices, payments, discounts) are seeded
    seedStep3FinancialManagement();

    // 11. Ensure Step 4 payment modules (receipts, notifications, pending demo payments) are seeded
    seedStep4PaymentsAndReceipts();

    // 12. Ensure Step 5 Platform Super Admin SaaS modules (plans, subscriptions, revenue, partners) are seeded
    seedStep5PlatformSubscriptions();
  } finally {
    setInitialSeedingState(false);
  }

  // 13. Start automated daily backup scheduler
  startAutomaticBackupScheduler();
}

async function hydrateSqliteFromPostgres() {
  if (!pgPool) return;

  const client = await pgPool.connect();
  try {
    const countCheck = await client.query('SELECT count(*) as count FROM schools');
    const schoolCount = parseInt(countCheck.rows[0].count, 10);

    if (schoolCount > 0) {
      console.log(`[Hydration] Synchronizing ${schoolCount} authoritative school tenants from Neon PostgreSQL to local engine...`);
      rawDb.exec('PRAGMA foreign_keys = OFF;');

      for (const table of MIGRATION_ORDER) {
        try {
          // Memory-safe batch hydration: process in pages of 500 to keep heap allocations minimal
          const BATCH_SIZE = 500;
          let offset = 0;
          let hasMore = true;

          while (hasMore) {
            const res = await client.query(`SELECT * FROM "${table}" ORDER BY 1 LIMIT ${BATCH_SIZE} OFFSET ${offset}`);
            if (res.rows.length === 0) {
              hasMore = false;
              break;
            }

            const sqCols = (rawDb.prepare(`PRAGMA table_info("${table}")`).all() as any[]).map((c) => c.name);
            const pgCols = Object.keys(res.rows[0]);
            const commonCols = pgCols.filter((c) => sqCols.includes(c));

            if (commonCols.length > 0) {
              const colList = commonCols.map((c) => `"${c}"`).join(', ');
              const placeholders = commonCols.map(() => '?').join(', ');
              const insertStmt = rawDb.prepare(`INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${placeholders})`);

              // Wrap batch in an internal SQLite transaction for 100x faster execution and zero lock contention
              rawDb.exec('BEGIN TRANSACTION;');
              for (const row of res.rows) {
                const vals = commonCols.map((c) => {
                  let val = row[c];
                  if (val instanceof Date) return val.toISOString();
                  if (typeof val === 'object' && val !== null) return JSON.stringify(val);
                  if (val === undefined) return null;
                  return val;
                });
                insertStmt.run(...vals);
              }
              rawDb.exec('COMMIT;');
            }

            if (res.rows.length < BATCH_SIZE) {
              hasMore = false;
            } else {
              offset += BATCH_SIZE;
            }
          }
        } catch (e: any) {
          // Table might not exist yet or be empty
        }
      }

      rawDb.exec('PRAGMA foreign_keys = ON;');
      console.log('[Hydration] Neon PostgreSQL authoritative synchronization complete!');
    }
  } catch (err: any) {
    console.warn('[Hydration Warning]', err.message);
  } finally {
    try {
      rawDb.exec('PRAGMA foreign_keys = ON;');
    } catch {}
    client.release();
  }
}

function migrateNullableDirectoryColumnsSqlite() {
  // Rebuild SQLite students, parents, or staff tables in-place ONLY if legacy NOT NULL constraints exist on optional columns
  try {
    const stuInfo = rawDb.prepare('PRAGMA table_info(students)').all() as any[];
    const admCol = stuInfo.find((c) => c.name === 'admission_number');
    if (admCol && admCol.notnull === 1) {
      rawDb.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE students_mig (
          id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
          admission_number TEXT,
          first_name TEXT NOT NULL,
          middle_name TEXT,
          last_name TEXT NOT NULL,
          full_name TEXT NOT NULL,
          gender TEXT,
          date_of_birth TEXT,
          phone TEXT,
          email TEXT,
          address TEXT,
          state TEXT,
          nationality TEXT DEFAULT 'Nigerian',
          admission_date TEXT,
          student_status TEXT DEFAULT 'ACTIVE',
          status TEXT DEFAULT 'ACTIVE',
          class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
          class_arm_id TEXT,
          class_name TEXT,
          class_arm_name TEXT,
          academic_session_id TEXT,
          profile_photo_url TEXT,
          emergency_contact TEXT,
          medical_notes TEXT,
          is_deleted INTEGER DEFAULT 0,
          deleted_at DATETIME,
          deleted_by TEXT,
          deletion_reason TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (school_id, admission_number)
        );
      `);
      const existingCols = stuInfo.map((c) => c.name);
      const targetCols = (rawDb.prepare('PRAGMA table_info(students_mig)').all() as any[]).map((c) => c.name);
      const shared = existingCols.filter((c) => targetCols.includes(c)).map((c) => `"${c}"`).join(', ');
      rawDb.exec(`INSERT INTO students_mig (${shared}) SELECT ${shared} FROM students;`);
      rawDb.exec('DROP TABLE students; ALTER TABLE students_mig RENAME TO students; PRAGMA foreign_keys = ON;');
    }
  } catch (e: any) {
    try { rawDb.exec('PRAGMA foreign_keys = ON;'); } catch {}
    console.warn('[SQLite Students Nullable Migration Notice]', e?.message);
  }

  try {
    const parInfo = rawDb.prepare('PRAGMA table_info(parents)').all() as any[];
    const phoneCol = parInfo.find((c) => c.name === 'phone');
    if (phoneCol && phoneCol.notnull === 1) {
      rawDb.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE parents_mig (
          id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          address TEXT,
          occupation TEXT,
          relationship TEXT DEFAULT 'Parent',
          emergency_contact TEXT,
          is_deleted INTEGER DEFAULT 0,
          deleted_at DATETIME,
          deleted_by TEXT,
          deletion_reason TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      const existingCols = parInfo.map((c) => c.name);
      const targetCols = (rawDb.prepare('PRAGMA table_info(parents_mig)').all() as any[]).map((c) => c.name);
      const shared = existingCols.filter((c) => targetCols.includes(c)).map((c) => `"${c}"`).join(', ');
      rawDb.exec(`INSERT INTO parents_mig (${shared}) SELECT ${shared} FROM parents;`);
      rawDb.exec('DROP TABLE parents; ALTER TABLE parents_mig RENAME TO parents; PRAGMA foreign_keys = ON;');
    }
  } catch (e: any) {
    try { rawDb.exec('PRAGMA foreign_keys = ON;'); } catch {}
    console.warn('[SQLite Parents Nullable Migration Notice]', e?.message);
  }

  try {
    const stfInfo = rawDb.prepare('PRAGMA table_info(staff)').all() as any[];
    const stfNumCol = stfInfo.find((c) => c.name === 'staff_number');
    const emailCol = stfInfo.find((c) => c.name === 'email');
    const phoneCol = stfInfo.find((c) => c.name === 'phone');
    if ((stfNumCol && stfNumCol.notnull === 1) || (emailCol && emailCol.notnull === 1) || (phoneCol && phoneCol.notnull === 1)) {
      rawDb.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE staff_mig (
          id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          staff_number TEXT,
          first_name TEXT NOT NULL,
          middle_name TEXT,
          last_name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          gender TEXT,
          address TEXT,
          job_title TEXT DEFAULT 'Staff Member',
          department TEXT,
          employment_status TEXT DEFAULT 'ACTIVE',
          date_joined TEXT,
          profile_photo_url TEXT,
          is_deleted INTEGER DEFAULT 0,
          deleted_at DATETIME,
          deleted_by TEXT,
          deletion_reason TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (school_id, staff_number)
        );
      `);
      const existingCols = stfInfo.map((c) => c.name);
      const targetCols = (rawDb.prepare('PRAGMA table_info(staff_mig)').all() as any[]).map((c) => c.name);
      const shared = existingCols.filter((c) => targetCols.includes(c)).map((c) => `"${c}"`).join(', ');
      rawDb.exec(`INSERT INTO staff_mig (${shared}) SELECT ${shared} FROM staff;`);
      rawDb.exec('DROP TABLE staff; ALTER TABLE staff_mig RENAME TO staff; PRAGMA foreign_keys = ON;');
    }
  } catch (e: any) {
    try { rawDb.exec('PRAGMA foreign_keys = ON;'); } catch {}
    console.warn('[SQLite Staff Nullable Migration Notice]', e?.message);
  }
}

function migrateStep2Columns() {
  // Ensure students table has all required enterprise fields if it exists
  const studentTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get();
  if (studentTableExists) {
    const studentCols = db.prepare('PRAGMA table_info(students)').all().map((c: any) => c.name);
    const requiredStudentCols: Record<string, string> = {
      first_name: "TEXT DEFAULT ''",
      middle_name: "TEXT DEFAULT ''",
      last_name: "TEXT DEFAULT ''",
      date_of_birth: "TEXT",
      phone: "TEXT",
      email: "TEXT",
      address: "TEXT",
      state: "TEXT",
      nationality: "TEXT DEFAULT 'Nigerian'",
      admission_date: "TEXT",
      student_status: "TEXT DEFAULT 'ACTIVE'",
      class_arm_id: "TEXT",
      class_arm_name: "TEXT",
      academic_session_id: "TEXT",
      profile_photo_url: "TEXT",
      emergency_contact: "TEXT",
      medical_notes: "TEXT",
      updated_at: "DATETIME DEFAULT CURRENT_TIMESTAMP",
    };

    for (const [col, colType] of Object.entries(requiredStudentCols)) {
      if (!studentCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE students ADD COLUMN ${col} ${colType};`);
        } catch (e) {
          // column may already exist
        }
      }
    }

    // Sync status and names for legacy rows
    try {
      db.exec(`
        UPDATE students 
        SET student_status = status 
        WHERE (student_status IS NULL OR student_status = '') AND status IS NOT NULL;
      `);
    } catch (e) {}
  }

  // Ensure classes table has description and academic_session_id
  const classTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='classes'").get();
  if (classTableExists) {
    const classCols = db.prepare('PRAGMA table_info(classes)').all().map((c: any) => c.name);
    if (!classCols.includes('description')) {
      try { db.exec('ALTER TABLE classes ADD COLUMN description TEXT;'); } catch (e) {}
    }
    if (!classCols.includes('academic_session_id')) {
      try { db.exec('ALTER TABLE classes ADD COLUMN academic_session_id TEXT;'); } catch (e) {}
    }
    if (!classCols.includes('updated_at')) {
      try { db.exec('ALTER TABLE classes ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;'); } catch (e) {}
    }
  }
}

function migrateStep4Columns() {

  // Ensure payments table has reconciliation columns
  const payCols2 = db.prepare('PRAGMA table_info(payments)').all().map((c: any) => c.name);
  if (!payCols2.includes('reconciliation_status')) {
    try { db.exec("ALTER TABLE payments ADD COLUMN reconciliation_status TEXT DEFAULT 'UNRECONCILED';"); } catch (e) {}
  }
  if (!payCols2.includes('reconciled_at')) {
    try { db.exec("ALTER TABLE payments ADD COLUMN reconciled_at DATETIME;"); } catch (e) {}
  }
  if (!payCols2.includes('reconciled_by')) {
    try { db.exec("ALTER TABLE payments ADD COLUMN reconciled_by TEXT;"); } catch (e) {}
  }
  if (!payCols2.includes('reconciliation_notes')) {
    try { db.exec("ALTER TABLE payments ADD COLUMN reconciliation_notes TEXT;"); } catch (e) {}
  }


  // Ensure bank_statement_entries has reconciliation columns
  const bankCols = db.prepare('PRAGMA table_info(bank_statement_entries)').all().map((c: any) => c.name);
  const requiredBankCols: Record<string, string> = {
    amount_kobo: 'INTEGER',
    entry_type: "TEXT DEFAULT 'CREDIT'",
    channel: 'TEXT',
    payer_name: 'TEXT',
    matched_payment_id: 'TEXT',
    match_status: "TEXT DEFAULT 'UNMATCHED'",
    imported_at: 'DATETIME DEFAULT CURRENT_TIMESTAMP',
    imported_by: 'TEXT'
  };
  for (const [col, colType] of Object.entries(requiredBankCols)) {
    if (!bankCols.includes(col)) {
      try { db.exec(`ALTER TABLE bank_statement_entries ADD COLUMN ${col} ${colType};`); } catch (e) {}
    }
  }


  // Ensure bank_statement_entries table exists in SQLite
  const bankEntriesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bank_statement_entries'").get();
  if (!bankEntriesExists) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bank_statement_entries (
          id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
          transaction_date TEXT NOT NULL,
          value_date TEXT,
          description TEXT NOT NULL,
          reference TEXT,
          amount INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_bank_entries_school ON bank_statement_entries(school_id);
      `);
    } catch (e) {}
  }


  // Ensure payments table check constraint permits REVERSED in SQLite
  try {
    const payTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get() as { sql: string } | undefined;
    if (payTableSql && !payTableSql.sql.includes('REVERSED')) {
      // Recreate table with updated constraint while preserving all data
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE payments_new (
          id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          payment_reference TEXT NOT NULL,
          amount INTEGER NOT NULL,
          currency TEXT DEFAULT 'NGN',
          payment_method TEXT NOT NULL CHECK(payment_method IN ('BANK_TRANSFER', 'POS', 'CASH', 'ONLINE', 'CHEQUE', 'OTHER')),
          provider TEXT DEFAULT 'MANUAL',
          provider_reference TEXT,
          internal_reference TEXT,
          status TEXT DEFAULT 'SUCCESS' CHECK(status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED', 'REVERSED', 'CONFIRMED')),
          payment_date TEXT NOT NULL,
          paid_at TEXT,
          verified_at TEXT,
          verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          notes TEXT,
          metadata TEXT,
          received_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          is_reversed INTEGER DEFAULT 0,
          reversed_at DATETIME,
          reversed_by TEXT,
          reversal_reason TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (school_id, payment_reference)
        );
        INSERT INTO payments_new SELECT 
          id, school_id, invoice_id, student_id, payment_reference, amount, currency,
          payment_method, provider, provider_reference, internal_reference, status,
          payment_date, paid_at, verified_at, verified_by, notes, metadata, received_by,
          COALESCE(is_reversed, 0), reversed_at, reversed_by, reversal_reason,
          created_at, updated_at
        FROM payments;
        DROP TABLE payments;
        ALTER TABLE payments_new RENAME TO payments;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch (e) {}


  // Ensure payments table has reversal columns
  const payCols = db.prepare('PRAGMA table_info(payments)').all().map((c: any) => c.name);
  if (!payCols.includes('is_reversed')) {
    try { db.exec('ALTER TABLE payments ADD COLUMN is_reversed INTEGER DEFAULT 0;'); } catch (e) {}
  }
  if (!payCols.includes('reversed_at')) {
    try { db.exec('ALTER TABLE payments ADD COLUMN reversed_at DATETIME;'); } catch (e) {}
  }
  if (!payCols.includes('reversed_by')) {
    try { db.exec('ALTER TABLE payments ADD COLUMN reversed_by TEXT;'); } catch (e) {}
  }
  if (!payCols.includes('reversal_reason')) {
    try { db.exec('ALTER TABLE payments ADD COLUMN reversal_reason TEXT;'); } catch (e) {}
  }


  // Ensure payment_reversals table exists in SQLite
  const reversalsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_reversals'").get();
  if (!reversalsTableExists) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_reversals (
          id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
          payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
          invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
          student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
          amount_kobo INTEGER NOT NULL,
          reversal_type TEXT DEFAULT 'FULL_REVERSAL',
          reason TEXT NOT NULL,
          initiated_by TEXT NOT NULL,
          approved_by TEXT,
          status TEXT DEFAULT 'APPROVED',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_payment_reversals_school ON payment_reversals(school_id);
      `);
    } catch (e) {}
  }


  // Ensure invoices table has fee_structure_id and discount_amount columns
  const invoicesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'").get();
  if (invoicesTableExists) {
    const invCols = db.prepare('PRAGMA table_info(invoices)').all().map((c: any) => c.name);
    if (!invCols.includes('fee_structure_id')) {
      try { db.exec('ALTER TABLE invoices ADD COLUMN fee_structure_id TEXT REFERENCES fee_structures(id) ON DELETE SET NULL;'); } catch (e) {}
    }
    if (!invCols.includes('discount_amount')) {
      try { db.exec('ALTER TABLE invoices ADD COLUMN discount_amount INTEGER DEFAULT 0;'); } catch (e) {}
    }
  }

  // 1. Ensure payments table has all Step 4 fields
  const paymentsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payments'").get();
  if (paymentsTableExists) {
    const paymentCols = db.prepare('PRAGMA table_info(payments)').all().map((c: any) => c.name);
    const requiredPaymentCols: Record<string, string> = {
      currency: "TEXT DEFAULT 'NGN'",
      provider: "TEXT DEFAULT 'MANUAL'",
      provider_reference: 'TEXT',
      internal_reference: 'TEXT',
      status: "TEXT DEFAULT 'SUCCESS'",
      paid_at: 'TEXT',
      verified_at: 'TEXT',
      verified_by: 'TEXT',
      metadata: 'TEXT',
      updated_at: 'DATETIME',
    };

    for (const [col, colType] of Object.entries(requiredPaymentCols)) {
      if (!paymentCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE payments ADD COLUMN ${col} ${colType};`);
        } catch (e) {
          console.warn(`[DB Migration] Could not add ${col} to payments:`, (e as any)?.message);
        }
      }
    }

    // Reconcile legacy payment references and status
    try {
      db.exec(`
        UPDATE payments
        SET internal_reference = payment_reference
        WHERE internal_reference IS NULL OR internal_reference = '';
      `);
      db.exec(`
        UPDATE payments
        SET paid_at = payment_date
        WHERE paid_at IS NULL OR paid_at = '';
      `);
      db.exec(`
        UPDATE payments
        SET status = 'SUCCESS'
        WHERE status IS NULL OR status = '';
      `);
      db.exec(`
        UPDATE payments
        SET provider = 'MANUAL'
        WHERE provider IS NULL OR provider = '';
      `);
    } catch (e) {}
  }

  // 2. Ensure school_settings table has gateway config fields
  const settingsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='school_settings'").get();
  if (settingsTableExists) {
    const settingsCols = db.prepare('PRAGMA table_info(school_settings)').all().map((c: any) => c.name);
    const requiredSettingsCols: Record<string, string> = {
      paystack_public_key: 'TEXT',
      paystack_secret_key: 'TEXT',
      paystack_enabled: 'INTEGER DEFAULT 0',
      flutterwave_public_key: 'TEXT',
      flutterwave_secret_key: 'TEXT',
      flutterwave_enabled: 'INTEGER DEFAULT 0',
      bachs_api_key: 'TEXT',
      bachs_webhook_secret: 'TEXT',
      bachs_enabled: 'INTEGER DEFAULT 1',
      webhook_secret: 'TEXT',
    };

    for (const [col, colType] of Object.entries(requiredSettingsCols)) {
      if (!settingsCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE school_settings ADD COLUMN ${col} ${colType};`);
        } catch (e) {}
      }
    }
  }

  // 3. Ensure webhook_events table includes PENDING in status check
  const webhookTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='webhook_events'").get() as { sql: string } | undefined;
  if (webhookTable && !webhookTable.sql.includes('PENDING')) {
    try {
      db.exec(`
        DROP TABLE IF EXISTS webhook_events;
        CREATE TABLE webhook_events (
          id TEXT PRIMARY KEY,
          school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          event_type TEXT NOT NULL,
          idempotency_key TEXT UNIQUE,
          provider_reference TEXT,
          payload TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('PROCESSED', 'FAILED', 'IGNORED', 'DUPLICATE', 'PENDING')),
          processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) {}
  }
}

function migrateStep5Columns() {
  // 1. Ensure sessions table has impersonated_by column
  const sessionsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (sessionsTableExists) {
    const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map((c: any) => c.name);
    if (!sessionCols.includes('impersonated_by')) {
      try {
        db.exec('ALTER TABLE sessions ADD COLUMN impersonated_by TEXT;');
      } catch (e) {}
    }
  }

  // 2. Ensure schools table has current_plan_id and subscription_end_date
  const schoolsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schools'").get();
  if (schoolsTableExists) {
    const schoolCols = db.prepare('PRAGMA table_info(schools)').all().map((c: any) => c.name);
    if (!schoolCols.includes('current_plan_id')) {
      try {
        db.exec('ALTER TABLE schools ADD COLUMN current_plan_id TEXT;');
      } catch (e) {}
    }
    if (!schoolCols.includes('subscription_end_date')) {
      try {
        db.exec('ALTER TABLE schools ADD COLUMN subscription_end_date DATE;');
      } catch (e) {}
    }
  }

  // 3. Ensure subscription_plans columns for dynamic pricing
  const plansTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subscription_plans'").get();
  if (plansTableExists) {
    const planCols = db.prepare('PRAGMA table_info(subscription_plans)').all().map((c: any) => c.name);
    const planRequired: Record<string, string> = {
      currency: "TEXT NOT NULL DEFAULT 'NGN'",
      billing_interval_count: 'INTEGER NOT NULL DEFAULT 1',
      trial_days: 'INTEGER NOT NULL DEFAULT 30',
      maximum_students: 'INTEGER NOT NULL DEFAULT 200',
      maximum_staff: 'INTEGER NOT NULL DEFAULT 25',
      maximum_admin_users: 'INTEGER NOT NULL DEFAULT 5',
      feature_limits: 'TEXT',
    };
    for (const [col, def] of Object.entries(planRequired)) {
      if (!planCols.includes(col)) {
        try { db.exec(`ALTER TABLE subscription_plans ADD COLUMN ${col} ${def};`); } catch (e) {}
      }
    }
  }

  // 4. Ensure school_subscriptions columns for custom/negotiated pricing
  const subsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='school_subscriptions'").get();
  if (subsTableExists) {
    const subCols = db.prepare('PRAGMA table_info(school_subscriptions)').all().map((c: any) => c.name);
    const subRequired: Record<string, string> = {
      standard_plan_price: 'INTEGER NOT NULL DEFAULT 0',
      negotiated_price: 'INTEGER',
      discount_amount: 'INTEGER NOT NULL DEFAULT 0',
      discount_reason: 'TEXT',
      final_amount: 'INTEGER NOT NULL DEFAULT 0',
      currency: "TEXT NOT NULL DEFAULT 'NGN'",
      expiry_date: 'DATE',
      renewal_date: 'DATE',
      grace_period_days: 'INTEGER NOT NULL DEFAULT 7',
    };
    for (const [col, def] of Object.entries(subRequired)) {
      if (!subCols.includes(col)) {
        try { db.exec(`ALTER TABLE school_subscriptions ADD COLUMN ${col} ${def};`); } catch (e) {}
      }
    }

    // Backfill final_amount if missing
    try {
      db.exec(`
        UPDATE school_subscriptions
        SET final_amount = COALESCE(amount_paid, 0),
            standard_plan_price = COALESCE(amount_paid, 0),
            expiry_date = end_date,
            renewal_date = end_date
        WHERE final_amount = 0 AND amount_paid > 0;
      `);
    } catch (e) {}
  }

  // 5. Ensure platform_payments columns (invoice_id, provider_transaction_id)
  const ppTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_payments'").get();
  if (ppTableExists) {
    const ppCols = db.prepare('PRAGMA table_info(platform_payments)').all().map((c: any) => c.name);
    const ppRequired: Record<string, string> = {
      invoice_id: 'TEXT',
      provider_transaction_id: 'TEXT',
      metadata: 'TEXT',
      updated_at: 'DATETIME',
    };
    for (const [col, def] of Object.entries(ppRequired)) {
      if (!ppCols.includes(col)) {
        try { db.exec(`ALTER TABLE platform_payments ADD COLUMN ${col} ${def};`); } catch (e) {}
      }
    }
  }

  // 6. Ensure newly introduced tables exist
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscription_discounts (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE,
        name TEXT NOT NULL,
        discount_type TEXT NOT NULL CHECK(discount_type IN ('PERCENTAGE', 'FIXED')),
        discount_value INTEGER NOT NULL,
        school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
        plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
        active INTEGER NOT NULL DEFAULT 1,
        expires_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS platform_invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        subscription_id TEXT NOT NULL REFERENCES school_subscriptions(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
        billing_period TEXT,
        standard_price INTEGER NOT NULL,
        discount INTEGER NOT NULL DEFAULT 0,
        negotiated_price INTEGER,
        final_amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'NGN',
        payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(payment_status IN ('PAID', 'PENDING', 'OVERDUE', 'CANCELLED')),
        issue_date DATE NOT NULL,
        due_date DATE NOT NULL,
        paid_at DATETIME,
        payment_method TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS platform_settings (
        id TEXT PRIMARY KEY,
        default_currency TEXT NOT NULL DEFAULT 'NGN',
        default_grace_period_days INTEGER NOT NULL DEFAULT 7,
        default_trial_days INTEGER NOT NULL DEFAULT 30,
        bachs_enabled INTEGER NOT NULL DEFAULT 1,
        bank_transfer_enabled INTEGER NOT NULL DEFAULT 1,
        invoice_payments_enabled INTEGER NOT NULL DEFAULT 1,
        platform_bank_name TEXT DEFAULT 'Zenith Bank',
        platform_account_name TEXT DEFAULT 'Nwajiaku Arinze Christian',
        platform_account_number TEXT DEFAULT '2208744650',
        opay_account_name TEXT DEFAULT 'Nwajiaku Arinzechukwu Christian',
        opay_account_number TEXT DEFAULT '8160754659',
        platform_contact_email TEXT DEFAULT 'support@bursariq.com.ng',
        platform_contact_phone TEXT DEFAULT '08160754659',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT OR IGNORE INTO platform_settings (
        id, default_currency, default_grace_period_days, default_trial_days,
        bachs_enabled, bank_transfer_enabled, invoice_payments_enabled,
        platform_bank_name, platform_account_name, platform_account_number,
        platform_contact_email, platform_contact_phone
      ) VALUES (
        'platform_global_settings', 'NGN', 7, 30,
        1, 1, 1,
        'Zenith Bank', 'Nwajiaku Arinze Christian', '2208744650',
        'support@bursariq.com.ng', '08160754659'
      );
      UPDATE platform_settings SET
        platform_bank_name = 'Zenith Bank',
        platform_account_name = 'Nwajiaku Arinze Christian',
        platform_account_number = '2208744650',
        opay_account_name = 'Nwajiaku Arinzechukwu Christian',
        opay_account_number = '8160754659',
        platform_contact_email = 'support@bursariq.com.ng',
        platform_contact_phone = '08160754659';
    `);
  } catch (e) {
    console.warn('[DB Migration] Table creation warning:', (e as any)?.message);
  }
}

function migrateRecoveryColumns() {
  // 1. Ensure users table has recovery and security question fields
  const usersTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (usersTableExists) {
    const userCols = db.prepare('PRAGMA table_info(users)').all().map((c: any) => c.name);
    const requiredUserCols: Record<string, string> = {
      recovery_email: 'TEXT',
      recovery_phone: 'TEXT',
      security_question_1: 'TEXT',
      security_answer_hash_1: 'TEXT',
      security_answer_salt_1: 'TEXT',
      security_question_2: 'TEXT',
      security_answer_hash_2: 'TEXT',
      security_answer_salt_2: 'TEXT',
      recovery_attempts: 'INTEGER DEFAULT 0',
      recovery_locked_until: 'DATETIME',
    };

    for (const [col, colType] of Object.entries(requiredUserCols)) {
      if (!userCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE users ADD COLUMN ${col} ${colType};`);
        } catch (e) {}
      }
    }
  }

  // 2. Ensure user_recovery_codes table exists for single-use emergency backup recovery codes
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_recovery_codes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_user_recovery_codes_user ON user_recovery_codes(user_id);
    `);
  } catch (e) {}

  // 3. Ensure recovery_challenges table exists for stateful verification flows
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS recovery_challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        identifier TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        expires_at DATETIME NOT NULL,
        verified_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_recovery_challenges_user ON recovery_challenges(user_id);
    `);
  } catch (e) {}

  // 4. Ensure password_resets table has user_id, recovery_method, verified_at, and ip_address
  const prTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='password_resets'").get();
  if (prTableExists) {
    const prCols = db.prepare('PRAGMA table_info(password_resets)').all().map((c: any) => c.name);
    const requiredPrCols: Record<string, string> = {
      user_id: 'TEXT',
      recovery_method: "TEXT DEFAULT 'EMAIL_LINK'",
      verified_at: 'DATETIME',
      ip_address: 'TEXT',
    };
    for (const [col, colType] of Object.entries(requiredPrCols)) {
      if (!prCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE password_resets ADD COLUMN ${col} ${colType};`);
        } catch (e) {}
      }
    }
  }
}

function seedStep2SchoolManagement() {
  const schoolAId = 'sch_lagos_premier_01';
  const schoolBId = 'sch_abuja_horizon_02';

  // 1. Academic Sessions & Terms for School A
  db.prepare(`
    INSERT OR IGNORE INTO academic_sessions (id, school_id, name, start_date, end_date, status) VALUES
    ('ses_a_2024', ?, '2024/2025', '2024-09-09', '2025-07-25', 'ACTIVE'),
    ('ses_a_2025', ?, '2025/2026', '2025-09-08', '2026-07-24', 'UPCOMING')
  `).run(schoolAId, schoolAId);

  db.prepare(`
    INSERT OR IGNORE INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status) VALUES
    ('trm_a_1', ?, 'ses_a_2024', '1st Term', '2024-09-09', '2024-12-13', 'ACTIVE'),
    ('trm_a_2', ?, 'ses_a_2024', '2nd Term', '2025-01-06', '2025-04-11', 'UPCOMING'),
    ('trm_a_3', ?, 'ses_a_2024', '3rd Term', '2025-04-28', '2025-07-25', 'UPCOMING')
  `).run(schoolAId, schoolAId, schoolAId);

  // 2. Classes for School A
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level, description, academic_session_id) VALUES
    ('cls_a_ss2', ?, 'SSS 2', 'Senior Secondary', 'Senior Secondary School Level 2', 'ses_a_2024'),
    ('cls_a_ss1', ?, 'SSS 1', 'Senior Secondary', 'Senior Secondary School Level 1', 'ses_a_2024'),
    ('cls_a_jss1', ?, 'JSS 1', 'Junior Secondary', 'Junior Secondary School Level 1', 'ses_a_2024')
  `).run(schoolAId, schoolAId, schoolAId);

  // 3. Staff for School A
  db.prepare(`
    INSERT OR IGNORE INTO staff (id, school_id, staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined) VALUES
    ('stf_a_01', ?, 'LPC/STF/001', 'Emmanuel', 'Chukwuma', 'Okafor', 'principal@lagospremier.edu.ng', '+2348021112233', 'Male', 'Principal / Academic Director', 'Administration', 'ACTIVE', '2021-08-15'),
    ('stf_a_02', ?, 'LPC/STF/002', 'Titilayo', 'Bolanle', 'Adeleke', 'maths.adeleke@lagospremier.edu.ng', '+2348034445566', 'Female', 'Senior Mathematics Teacher', 'Sciences', 'ACTIVE', '2022-01-10'),
    ('stf_a_03', ?, 'LPC/STF/003', 'Babatunde', 'Segun', 'Ogundipe', 'bursar@lagospremier.edu.ng', '+2348057778899', 'Male', 'School Bursar & Accountant', 'Bursary', 'ACTIVE', '2020-09-01')
  `).run(schoolAId, schoolAId, schoolAId);

  // 4. Class Arms for School A
  db.prepare(`
    INSERT OR IGNORE INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id) VALUES
    ('arm_a_ss2_gold', ?, 'cls_a_ss2', 'Gold', 40, 'stf_a_02'),
    ('arm_a_ss2_silver', ?, 'cls_a_ss2', 'Silver', 40, NULL),
    ('arm_a_ss1_sci', ?, 'cls_a_ss1', 'Science', 35, 'stf_a_02')
  `).run(schoolAId, schoolAId, schoolAId);

  // 5. Parents for School A
  db.prepare(`
    INSERT OR IGNORE INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact) VALUES
    ('par_a_01', ?, 'Olawale', 'Adebayo', '+2348031110001', 'adebayo.parent@gmail.com', '12 Admiralty Way, Lekki Phase 1, Lagos', 'Civil Engineer', 'Father', '+2348031110001'),
    ('par_a_02', ?, 'Ngozi', 'Okonkwo', '+2348031110002', 'chioma.parent@gmail.com', '45 Glover Road, Ikoyi, Lagos', 'Chartered Accountant', 'Mother', '+2348031110002')
  `).run(schoolAId, schoolAId);

  // 6. Students for School A (Full enterprise schema)
  db.prepare(`
    INSERT OR IGNORE INTO students (
      id, school_id, admission_number, first_name, middle_name, last_name, full_name, gender,
      date_of_birth, phone, email, address, state, nationality, admission_date, student_status,
      class_id, class_arm_id, class_name, class_arm_name, academic_session_id, emergency_contact
    ) VALUES
    (
      'stu_a1_01', ?, 'LPC/2024/001', 'Adebayo', 'Femi', 'Olawale', 'Adebayo Olawale', 'Male',
      '2008-05-14', '+2348031110001', 'adebayo.olawale@student.lpc.edu.ng', '12 Admiralty Way, Lekki', 'Lagos', 'Nigerian',
      '2022-09-12', 'ACTIVE', 'cls_a_ss2', 'arm_a_ss2_gold', 'SSS 2', 'Gold', 'ses_a_2024', 'Mr. Olawale (+2348031110001)'
    ),
    (
      'stu_a2_02', ?, 'LPC/2024/002', 'Chioma', 'Grace', 'Okonkwo', 'Chioma Okonkwo', 'Female',
      '2009-08-22', '+2348031110002', 'chioma.okonkwo@student.lpc.edu.ng', '45 Glover Road, Ikoyi', 'Anambra', 'Nigerian',
      '2023-09-11', 'ACTIVE', 'cls_a_ss1', 'arm_a_ss1_sci', 'SSS 1', 'Science', 'ses_a_2024', 'Mrs. Ngozi (+2348031110002)'
    )
  `).run(schoolAId, schoolAId);

  // Reconcile pre-existing School A student rows from Step 1
  db.prepare(`
    UPDATE students SET
      first_name = 'Adebayo', last_name = 'Olawale', middle_name = 'Femi',
      class_id = 'cls_a_ss2', class_arm_id = 'arm_a_ss2_gold', class_name = 'SSS 2', class_arm_name = 'Gold',
      academic_session_id = 'ses_a_2024', student_status = 'ACTIVE'
    WHERE id = 'stu_a1_01';
  `).run();

  db.prepare(`
    UPDATE students SET
      first_name = 'Chioma', last_name = 'Okonkwo', middle_name = 'Grace',
      class_id = 'cls_a_ss1', class_arm_id = 'arm_a_ss1_sci', class_name = 'SSS 1', class_arm_name = 'Science',
      academic_session_id = 'ses_a_2024', student_status = 'ACTIVE'
    WHERE id = 'stu_a2_02';
  `).run();

  // 7. Parent-Student Links for School A
  db.prepare(`
    INSERT OR IGNORE INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact) VALUES
    ('ps_a_01', ?, 'par_a_01', 'stu_a1_01', 'Father', 1),
    ('ps_a_02', ?, 'par_a_02', 'stu_a2_02', 'Mother', 1)
  `).run(schoolAId, schoolAId);

  // 8. Academic Sessions & Terms for School B
  db.prepare(`
    INSERT OR IGNORE INTO academic_sessions (id, school_id, name, start_date, end_date, status) VALUES
    ('ses_b_2024', ?, '2024/2025', '2024-09-16', '2025-07-18', 'ACTIVE')
  `).run(schoolBId);

  db.prepare(`
    INSERT OR IGNORE INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status) VALUES
    ('trm_b_1', ?, 'ses_b_2024', '1st Term', '2024-09-16', '2024-12-18', 'ACTIVE')
  `).run(schoolBId);

  // 9. Classes for School B
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level, description, academic_session_id) VALUES
    ('cls_b_jss3', ?, 'JSS 3', 'Junior Secondary', 'Junior Secondary School Level 3', 'ses_b_2024'),
    ('cls_b_jss2', ?, 'JSS 2', 'Junior Secondary', 'Junior Secondary School Level 2', 'ses_b_2024')
  `).run(schoolBId, schoolBId);

  // 10. Staff for School B
  db.prepare(`
    INSERT OR IGNORE INTO staff (id, school_id, staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined) VALUES
    ('stf_b_01', ?, 'AHA/STF/001', 'Usman', 'Aliyu', 'Danjuma', 'viceprincipal@abujahorizon.sch.ng', '+2348065551122', 'Male', 'Vice Principal (Academics)', 'Administration', 'ACTIVE', '2021-10-01'),
    ('stf_b_02', ?, 'AHA/STF/002', 'Grace', 'Onyinye', 'Danladi', 'grace.danladi@abujahorizon.sch.ng', '+2348078889900', 'Female', 'English & Literature Educator', 'Arts', 'ACTIVE', '2022-03-15')
  `).run(schoolBId, schoolBId);

  // 11. Class Arms for School B
  db.prepare(`
    INSERT OR IGNORE INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id) VALUES
    ('arm_b_jss3_em', ?, 'cls_b_jss3', 'Emerald', 35, 'stf_b_01'),
    ('arm_b_jss2_dia', ?, 'cls_b_jss2', 'Diamond', 35, 'stf_b_02')
  `).run(schoolBId, schoolBId);

  // 12. Parents for School B
  db.prepare(`
    INSERT OR IGNORE INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact) VALUES
    ('par_b_01', ?, 'Amina', 'Bello', '+2348098887701', 'amina.bello@horizon.sch.ng', 'Plot 402 Shehu Shagari Way, Maitama, Abuja', 'Medical Practitioner', 'Mother', '+2348098887701'),
    ('par_b_02', ?, 'Paul', 'Eze', '+2348098887702', 'eze.paul@yahoo.com', '15 Gana Street, Maitama, Abuja', 'Petroleum Engineer', 'Father', '+2348098887702')
  `).run(schoolBId, schoolBId);

  // 13. Students for School B (Full enterprise schema)
  db.prepare(`
    INSERT OR IGNORE INTO students (
      id, school_id, admission_number, first_name, middle_name, last_name, full_name, gender,
      date_of_birth, phone, email, address, state, nationality, admission_date, student_status,
      class_id, class_arm_id, class_name, class_arm_name, academic_session_id, emergency_contact
    ) VALUES
    (
      'stu_b1_01', ?, 'AHA/2024/101', 'Zainab', 'Fatima', 'Bello', 'Zainab Bello', 'Female',
      '2010-02-18', '+2348098887701', 'zainab.bello@student.horizon.sch.ng', 'Maitama, Abuja', 'FCT - Abuja', 'Nigerian',
      '2022-09-18', 'ACTIVE', 'cls_b_jss3', 'arm_b_jss3_em', 'JSS 3', 'Emerald', 'ses_b_2024', 'Dr. Amina (+2348098887701)'
    ),
    (
      'stu_b2_02', ?, 'AHA/2024/102', 'Emeka', 'Chinedu', 'Eze', 'Emeka Eze', 'Male',
      '2011-09-05', '+2348098887702', 'emeka.eze@student.horizon.sch.ng', 'Maitama, Abuja', 'Enugu', 'Nigerian',
      '2023-09-15', 'ACTIVE', 'cls_b_jss2', 'arm_b_jss2_dia', 'JSS 2', 'Diamond', 'ses_b_2024', 'Engr. Paul (+2348098887702)'
    )
  `).run(schoolBId, schoolBId);

  // Reconcile pre-existing School B student rows from Step 1
  db.prepare(`
    UPDATE students SET
      first_name = 'Zainab', last_name = 'Bello', middle_name = 'Fatima',
      class_id = 'cls_b_jss3', class_arm_id = 'arm_b_jss3_em', class_name = 'JSS 3', class_arm_name = 'Emerald',
      academic_session_id = 'ses_b_2024', student_status = 'ACTIVE'
    WHERE id = 'stu_b1_01';
  `).run();

  db.prepare(`
    UPDATE students SET
      first_name = 'Emeka', last_name = 'Eze', middle_name = 'Chinedu',
      class_id = 'cls_b_jss2', class_arm_id = 'arm_b_jss2_dia', class_name = 'JSS 2', class_arm_name = 'Diamond',
      academic_session_id = 'ses_b_2024', student_status = 'ACTIVE'
    WHERE id = 'stu_b2_02';
  `).run();

  // 14. Parent-Student Links for School B
  db.prepare(`
    INSERT OR IGNORE INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact) VALUES
    ('ps_b_01', ?, 'par_b_01', 'stu_b1_01', 'Mother', 1),
    ('ps_b_02', ?, 'par_b_02', 'stu_b2_02', 'Father', 1)
  `).run(schoolBId, schoolBId);
}

function hashPasswordHelper(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function seedInitialData() {
  console.log('[Database] Seeding initial Super Admin and demo Nigerian school tenants...');

  // 1. Seed Super Admin (Platform level, no school_id)
  const superAdminId = 'usr_super_admin_01';
  const saSalt = crypto.randomBytes(16).toString('hex');
  const saHash = hashPasswordHelper('SuperAdmin@2025!', saSalt);

  // Ensure previous superadmin email is migrated cleanly to SchoolPay28@gmail.com
  db.prepare(`DELETE FROM users WHERE email = 'superadmin@schoolpay.ng' AND id != ?;`).run(superAdminId);

  // Check if superadmin already exists; NEVER overwrite an existing user's password or profile
  const existingSa = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(superAdminId) as any;
  if (!existingSa) {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1)
    `).run(superAdminId, 'SchoolPay28@gmail.com', saHash, saSalt, 'Platform Super Admin & Support', '08160754659');
  }

  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, NULL, 'role_super_admin', 1)
  `).run('ur_sa_01', superAdminId);

  // 2. Demo School A: Lagos Premier College (Ikeja, Lagos)
  const schoolAId = 'sch_lagos_premier_01';
  db.prepare(`
    INSERT OR IGNORE INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolAId,
    'Lagos Premier College',
    'lagos-premier-college',
    'Secondary',
    'ACTIVE',
    '14 Allen Avenue, Ikeja',
    'Lagos',
    'Ikeja',
    '+2348021112233',
    'info@lagospremier.edu.ng',
    'https://lagospremier.edu.ng'
  );

  db.prepare(`
    INSERT OR IGNORE INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email, payment_notification_sms, portal_subdomain)
    VALUES (?, ?, 'NGN', '₦', '2024/2025', '1st Term', 'bursary@lagospremier.edu.ng', 1, 'lagospremier')
  `).run('set_lagos_01', schoolAId);

  // Owner for School A
  const ownerAId = 'usr_owner_lagos_01';
  const ownerASalt = crypto.randomBytes(16).toString('hex');
  const ownerAHash = hashPasswordHelper('OwnerLagos@2025!', ownerASalt);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(ownerAId, 'proprietor@lagospremier.edu.ng', ownerAHash, ownerASalt, 'Chief Mrs. Folashade Adeleke', '+2348031234567');

  // Pre-seed verified security questions and backup code for ownerAId only if not yet set
  const existingOwner = db.prepare('SELECT security_question_1 FROM users WHERE id = ?').get(ownerAId) as any;
  if (existingOwner && !existingOwner.security_question_1) {
    const q1Salt = crypto.randomBytes(16).toString('hex');
    const q1Hash = hashPasswordHelper('lagos primary school', q1Salt);
    const q2Salt = crypto.randomBytes(16).toString('hex');
    const q2Hash = hashPasswordHelper('ikeja', q2Salt);
    db.prepare(`
      UPDATE users SET
        security_question_1 = 'What primary school did you attend?',
        security_answer_hash_1 = ?,
        security_answer_salt_1 = ?,
        security_question_2 = 'In what city or town were you born?',
        security_answer_hash_2 = ?,
        security_answer_salt_2 = ?,
        recovery_email = 'proprietor.backup@lagospremier.edu.ng',
        recovery_phone = '+2348031234567'
      WHERE id = ?;
    `).run(q1Hash, q1Salt, q2Hash, q2Salt, ownerAId);
  }

  // Pre-seed emergency backup code (BK-2026-BURS) for ownerAId with independent salt
  const codeSalt = crypto.randomBytes(16).toString('hex');
  const codeHash = hashPasswordHelper('BK-2026-BURS', codeSalt);
  const storedCode = `${codeSalt}:${codeHash}`;
  db.prepare(`
    INSERT INTO user_recovery_codes (id, user_id, code_hash)
    VALUES ('rc_owner_01', ?, ?)
    ON CONFLICT(id) DO UPDATE SET code_hash = excluded.code_hash, used_at = NULL;
  `).run(ownerAId, storedCode);

  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, ?, 'role_school_owner', 1)
  `).run('ur_lagos_owner_01', ownerAId, schoolAId);

  // Bursar for School A
  const bursarAId = 'usr_bursar_lagos_01';
  const bursarASalt = crypto.randomBytes(16).toString('hex');
  const bursarAHash = hashPasswordHelper('BursarLagos@2025!', bursarASalt);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(bursarAId, 'bursar@lagospremier.edu.ng', bursarAHash, bursarASalt, 'Mr. Babatunde Ogundipe (Bursar)', '+2348057778899');

  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, ?, 'role_bursar', 1)
  `).run('ur_lagos_bursar_01', bursarAId, schoolAId);

  // Seed School A Classes, Students, and Fees
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level) VALUES
    ('cls_a1', ?, 'SS 2 Gold', 'Senior Secondary 2'),
    ('cls_a2', ?, 'SS 1 Silver', 'Senior Secondary 1')
  `).run(schoolAId, schoolAId);

  db.prepare(`
    INSERT OR IGNORE INTO students (id, school_id, admission_number, first_name, last_name, full_name, gender, class_name, student_status) VALUES
    ('stu_a1_01', ?, 'LPC/2024/001', 'Adebayo', 'Olawale', 'Adebayo Olawale', 'Male', 'SS 2 Gold', 'ACTIVE'),
    ('stu_a2_02', ?, 'LPC/2024/002', 'Chioma', 'Okonkwo', 'Chioma Okonkwo', 'Female', 'SS 1 Silver', 'ACTIVE')
  `).run(schoolAId, schoolAId);

  db.prepare(`
    INSERT OR IGNORE INTO fees (id, school_id, name, amount, session, term, description) VALUES
    ('fee_a1', ?, 'Tuition & Academic Levy - 1st Term', 185000, '2024/2025', '1st Term', 'Termly standard tuition fee')
  `).run(schoolAId);

  // 3. Demo School B: Abuja Horizon Academy (Maitama, FCT)
  const schoolBId = 'sch_abuja_horizon_02';
  db.prepare(`
    INSERT OR IGNORE INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolBId,
    'Abuja Horizon Academy',
    'abuja-horizon-academy',
    'Comprehensive / K-12',
    'TRIAL',
    'Plot 402 Shehu Shagari Way, Maitama',
    'FCT - Abuja',
    'Abuja Municipal (AMAC)',
    '+2348064445566',
    'admin@abujahorizon.sch.ng',
    'https://abujahorizon.sch.ng'
  );

  db.prepare(`
    INSERT OR IGNORE INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email, payment_notification_sms, portal_subdomain)
    VALUES (?, ?, 'NGN', '₦', '2024/2025', '1st Term', 'accounts@abujahorizon.sch.ng', 0, 'abujahorizon')
  `).run('set_abuja_01', schoolBId);

  // Owner for School B
  const ownerBId = 'usr_owner_abuja_02';
  const ownerBSalt = crypto.randomBytes(16).toString('hex');
  const ownerBHash = hashPasswordHelper('OwnerAbuja@2025!', ownerBSalt);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(ownerBId, 'proprietor@abujahorizon.sch.ng', ownerBHash, ownerBSalt, 'Dr. Amina Bello', '+2348098887766');

  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, ?, 'role_school_owner', 1)
  `).run('ur_abuja_owner_01', ownerBId, schoolBId);

  // Seed School B Classes, Students, and Fees
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level) VALUES
    ('cls_b1', ?, 'JSS 3 Emerald', 'Junior Secondary 3'),
    ('cls_b2', ?, 'JSS 2 Diamond', 'Junior Secondary 2')
  `).run(schoolBId, schoolBId);

  db.prepare(`
    INSERT OR IGNORE INTO students (id, school_id, admission_number, first_name, last_name, full_name, gender, class_name, student_status) VALUES
    ('stu_b1_01', ?, 'AHA/2024/101', 'Zainab', 'Bello', 'Zainab Bello', 'Female', 'JSS 3 Emerald', 'ACTIVE'),
    ('stu_b2_02', ?, 'AHA/2024/102', 'Emeka', 'Eze', 'Emeka Eze', 'Male', 'JSS 2 Diamond', 'ACTIVE')
  `).run(schoolBId, schoolBId);

  db.prepare(`
    INSERT OR IGNORE INTO fees (id, school_id, name, amount, session, term, description) VALUES
    ('fee_b1', ?, 'Comprehensive Tuition - Term 1', 240000, '2024/2025', '1st Term', 'Full composite tuition package')
  `).run(schoolBId);

  // Add initial audit logs
  db.prepare(`
    INSERT OR IGNORE INTO audit_logs (id, actor_id, actor_email, school_id, action, entity, entity_id, ip_address, metadata)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    superAdminId,
    'superadmin@schoolpay.ng',
    null,
    'SYSTEM_BOOTSTRAP',
    'SYSTEM',
    'PLATFORM',
    '127.0.0.1',
    JSON.stringify({ note: 'Initial system seeding completed with multi-tenant isolation' })
  );

  console.log('[Database] Seeding finished successfully.');
}

function seedStep3FinancialManagement() {
  const schoolAId = 'sch_lagos_premier_01';
  const schoolBId = 'sch_abuja_horizon_02';

  // 1. Fee Categories for School A
  const categoriesA = [
    { id: 'cat_a_tui', name: 'Tuition Fee', desc: 'Core academic instruction and termly tuition' },
    { id: 'cat_a_reg', name: 'Registration Fee', desc: 'Annual or admission enrollment fee' },
    { id: 'cat_a_exm', name: 'Examination Fee', desc: 'Termly assessments, mock & external examinations' },
    { id: 'cat_a_txt', name: 'Textbooks & Workbooks', desc: 'Curriculum-mandated books and learning materials' },
    { id: 'cat_a_uni', name: 'School Uniform', desc: 'Official uniforms, sports jerseys and accessories' },
    { id: 'cat_a_trn', name: 'School Bus Transportation', desc: 'Daily pickup and drop-off transport routes' },
    { id: 'cat_a_fed', name: 'School Lunch / Feeding', desc: 'Termly nutritious lunch and cafeteria meal plan' },
    { id: 'cat_a_brd', name: 'Boarding & Hostel Levy', desc: 'Hostel accommodation, laundry and boarding amenities' },
    { id: 'cat_a_dev', name: 'Development Levy', desc: 'Infrastructure, lab equipment and facility enhancements' },
    { id: 'cat_a_med', name: 'Medical & Health Insurance', desc: 'School clinic access and emergency health coverage' },
    { id: 'cat_a_ict', name: 'ICT & STEM Robotics Lab', desc: 'Computer lab, internet and robotics programming license' },
    { id: 'cat_a_oth', name: 'Other Sundry Fees', desc: 'Extracurricular club levies and special events' },
  ];

  for (const cat of categoriesA) {
    db.prepare(`
      INSERT OR IGNORE INTO fee_categories (id, school_id, name, description, status)
      VALUES (?, ?, ?, ?, 'ACTIVE')
    `).run(cat.id, schoolAId, cat.name, cat.desc);
  }

  // 2. Fee Categories for School B
  const categoriesB = [
    { id: 'cat_b_tui', name: 'Tuition Fee', desc: 'Academic instruction levy' },
    { id: 'cat_b_reg', name: 'Registration Fee', desc: 'Enrollment processing fee' },
    { id: 'cat_b_exm', name: 'Examination Fee', desc: 'Internal & external assessments' },
    { id: 'cat_b_ict', name: 'ICT & Digital Learning', desc: 'Digital portals and tablet learning' },
    { id: 'cat_b_dev', name: 'Campus Development Levy', desc: 'Campus facilities' },
  ];

  for (const cat of categoriesB) {
    db.prepare(`
      INSERT OR IGNORE INTO fee_categories (id, school_id, name, description, status)
      VALUES (?, ?, ?, ?, 'ACTIVE')
    `).run(cat.id, schoolBId, cat.name, cat.desc);
  }

  // 3. Fee Structure for School A (SSS 2 - Term 1)
  db.prepare(`
    INSERT OR IGNORE INTO fee_structures (id, school_id, class_id, academic_session_id, term_id, name, description, status)
    VALUES ('fs_a_ss2_t1', ?, 'cls_a_ss2', 'ses_a_2024', 'trm_a_1', 'SSS 2 Standard Composite Fees 2024/2025 Term 1', 'Termly fee package for Senior Secondary 2', 'ACTIVE')
  `).run(schoolAId);

  // Fee Structure Items for School A (Amounts in kobo: 1 NGN = 100 kobo)
  // Tuition: 120,000 NGN = 12,000,000 kobo
  // Exam: 15,000 NGN = 1,500,000 kobo
  // ICT: 25,000 NGN = 2,500,000 kobo
  // Dev: 15,000 NGN = 1,500,000 kobo
  // Uniform: 10,000 NGN = 1,000,000 kobo (Optional)
  const fsItemsA = [
    { id: 'fsi_a_1', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_tui', amount: 12000000, comp: 1, desc: 'Term 1 Tuition' },
    { id: 'fsi_a_2', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_exm', amount: 1500000, comp: 1, desc: 'Continuous Assessment & Term Examination' },
    { id: 'fsi_a_3', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_ict', amount: 2500000, comp: 1, desc: 'Computer & Coding Lab Access' },
    { id: 'fsi_a_4', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_dev', amount: 1500000, comp: 1, desc: 'School Infrastructure Levy' },
    { id: 'fsi_a_5', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_uni', amount: 1000000, comp: 0, desc: 'Optional Replacement Uniform set' },
  ];

  for (const item of fsItemsA) {
    db.prepare(`
      INSERT OR IGNORE INTO fee_structure_items (id, school_id, fee_structure_id, fee_category_id, amount, compulsory, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, schoolAId, item.fs_id, item.cat_id, item.amount, item.comp, item.desc);
  }

  // 4. Initial Invoices for School A
  // Invoice 1: INV-2024-001 for Adebayo Olawale (stu_a1_01)
  // Subtotal: 175,000 NGN (17,500,000 kobo)
  // Discount: 25,000 NGN (2,500,000 kobo) Academic Merit Scholarship
  // Total: 150,000 NGN (15,000,000 kobo)
  // Paid: 100,000 NGN (10,000,000 kobo)
  // Balance: 50,000 NGN (5,000,000 kobo)
  // Status: PARTIALLY_PAID
  db.prepare(`
    INSERT OR IGNORE INTO invoices (
      id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
      issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
    ) VALUES (
      'inv_a_001', ?, 'stu_a1_01', 'INV-2024-001', 'ses_a_2024', 'trm_a_1', 'cls_a_ss2',
      '2024-09-09', '2024-10-15', 17500000, 2500000, 15000000, 10000000, 5000000, 'PARTIALLY_PAID',
      'Standard termly invoice for Adebayo Olawale (SSS 2 Gold)'
    )
  `).run(schoolAId);

  // Line Items for Invoice 1
  const inv1Items = [
    { id: 'ii_a_1', inv_id: 'inv_a_001', cat_id: 'cat_a_tui', desc: 'SSS 2 Tuition Fee', qty: 1, unit: 12000000, tot: 12000000 },
    { id: 'ii_a_2', inv_id: 'inv_a_001', cat_id: 'cat_a_exm', desc: 'Examinations & Term Assessment', qty: 1, unit: 1500000, tot: 1500000 },
    { id: 'ii_a_3', inv_id: 'inv_a_001', cat_id: 'cat_a_ict', desc: 'ICT and STEM Laboratory', qty: 1, unit: 2500000, tot: 2500000 },
    { id: 'ii_a_4', inv_id: 'inv_a_001', cat_id: 'cat_a_dev', desc: 'School Development Levy', qty: 1, unit: 1500000, tot: 1500000 },
  ];
  for (const it of inv1Items) {
    db.prepare(`
      INSERT OR IGNORE INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(it.id, schoolAId, it.inv_id, it.cat_id, it.desc, it.qty, it.unit, it.tot);
  }

  // Discount for Invoice 1
  db.prepare(`
    INSERT OR IGNORE INTO invoice_discounts (id, school_id, invoice_id, type, amount, reason, authorized_by)
    VALUES ('disc_a_1', ?, 'inv_a_001', 'SCHOLARSHIP', 2500000, 'Academic Merit Scholarship Award (Top 3 in JSS3 WAEC)', 'usr_owner_lagos_01')
  `).run(schoolAId);

  // Payments for Invoice 1
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, school_id, invoice_id, student_id, payment_reference, amount, payment_method, payment_date, notes, received_by)
    VALUES
    ('pay_a_1', ?, 'inv_a_001', 'stu_a1_01', 'PAY-LPC-2024-001', 5000000, 'BANK_TRANSFER', '2024-09-15', 'First installment via GTBank transfer', 'usr_bursar_lagos_01'),
    ('pay_a_2', ?, 'inv_a_001', 'stu_a1_01', 'PAY-LPC-2024-002', 5000000, 'POS', '2024-10-02', 'Second installment card payment at Bursary', 'usr_bursar_lagos_01')
  `).run(schoolAId, schoolAId);

  // Invoice 2: INV-2024-002 for Chioma Okonkwo (stu_a2_02)
  // Total: 160,000 NGN (16,000,000 kobo)
  // Fully Paid (160,000 NGN)
  // Balance: 0
  // Status: PAID
  db.prepare(`
    INSERT OR IGNORE INTO invoices (
      id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
      issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
    ) VALUES (
      'inv_a_002', ?, 'stu_a2_02', 'INV-2024-002', 'ses_a_2024', 'trm_a_1', 'cls_a_ss1',
      '2024-09-09', '2024-10-15', 16000000, 0, 16000000, 16000000, 0, 'PAID',
      'Full payment confirmed for Chioma Okonkwo (SSS 1 Science)'
    )
  `).run(schoolAId);

  const inv2Items = [
    { id: 'ii_a_5', inv_id: 'inv_a_002', cat_id: 'cat_a_tui', desc: 'SSS 1 Tuition Fee', qty: 1, unit: 11000000, tot: 11000000 },
    { id: 'ii_a_6', inv_id: 'inv_a_002', cat_id: 'cat_a_exm', desc: 'Term 1 Examinations', qty: 1, unit: 1500000, tot: 1500000 },
    { id: 'ii_a_7', inv_id: 'inv_a_002', cat_id: 'cat_a_ict', desc: 'ICT and Laboratory fee', qty: 1, unit: 2000000, tot: 2000000 },
    { id: 'ii_a_8', inv_id: 'inv_a_002', cat_id: 'cat_a_dev', desc: 'Campus Development Levy', qty: 1, unit: 1500000, tot: 1500000 },
  ];
  for (const it of inv2Items) {
    db.prepare(`
      INSERT OR IGNORE INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(it.id, schoolAId, it.inv_id, it.cat_id, it.desc, it.qty, it.unit, it.tot);
  }

  db.prepare(`
    INSERT OR IGNORE INTO payments (id, school_id, invoice_id, student_id, payment_reference, amount, payment_method, payment_date, notes, received_by)
    VALUES ('pay_a_3', ?, 'inv_a_002', 'stu_a2_02', 'PAY-LPC-2024-003', 16000000, 'ONLINE', '2024-09-12', 'Direct online payment receipt via portal', 'usr_bursar_lagos_01')
  `).run(schoolAId);

  // 5. Invoice for School B (Strictly isolated to sch_abuja_horizon_02)
  db.prepare(`
    INSERT OR IGNORE INTO invoices (
      id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
      issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
    ) VALUES (
      'inv_b_001', ?, 'stu_b1_01', 'INV-AHA-2024-101', 'ses_b_2024', 'trm_b_1', 'cls_b_jss3',
      '2024-09-16', '2024-10-31', 24000000, 0, 24000000, 0, 24000000, 'ISSUED',
      'Comprehensive termly bill for Zainab Bello (JSS 3 Emerald)'
    )
  `).run(schoolBId);

  db.prepare(`
    INSERT OR IGNORE INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
    VALUES
    ('ii_b_1', ?, 'inv_b_001', 'cat_b_tui', 'JSS 3 Academic Tuition', 1, 18000000, 18000000),
    ('ii_b_2', ?, 'inv_b_001', 'cat_b_exm', 'Junior WAEC & Mock Levy', 1, 3000000, 3000000),
    ('ii_b_3', ?, 'inv_b_001', 'cat_b_ict', 'Digital Tablet Platform', 1, 3000000, 3000000)
  `).run(schoolBId, schoolBId, schoolBId);

  console.log('[Database] Step 3 Financial Management seeded successfully.');
}

function seedStep4PaymentsAndReceipts() {
  const schoolAId = 'sch_lagos_premier_01';
  const schoolBId = 'sch_abuja_horizon_02';

  // 1. Receipts for School A existing payments
  // pay_a_1: 50,000 NGN (5,000,000 kobo), previous balance: 150,000 NGN, current balance: 100,000 NGN
  db.prepare(`
    INSERT OR IGNORE INTO receipts (
      id, school_id, receipt_number, payment_id, invoice_id, student_id,
      amount, previous_balance, current_balance, issue_date, issued_by, notes
    ) VALUES (
      'rcp_a_001', ?, 'RCP-LPC-2024-0001', 'pay_a_1', 'inv_a_001', 'stu_a1_01',
      5000000, 15000000, 10000000, '2024-09-15', 'usr_bursar_lagos_01', 'Official receipt for first installment bank transfer'
    )
  `).run(schoolAId);

  // pay_a_2: 50,000 NGN (5,000,000 kobo), previous balance: 100,000 NGN, current balance: 50,000 NGN
  db.prepare(`
    INSERT OR IGNORE INTO receipts (
      id, school_id, receipt_number, payment_id, invoice_id, student_id,
      amount, previous_balance, current_balance, issue_date, issued_by, notes
    ) VALUES (
      'rcp_a_002', ?, 'RCP-LPC-2024-0002', 'pay_a_2', 'inv_a_001', 'stu_a1_01',
      5000000, 10000000, 5000000, '2024-10-02', 'usr_bursar_lagos_01', 'Official receipt for second installment POS terminal payment'
    )
  `).run(schoolAId);

  // pay_a_3: 160,000 NGN (16,000,000 kobo), previous balance: 160,000 NGN, current balance: 0 NGN
  db.prepare(`
    INSERT OR IGNORE INTO receipts (
      id, school_id, receipt_number, payment_id, invoice_id, student_id,
      amount, previous_balance, current_balance, issue_date, issued_by, notes
    ) VALUES (
      'rcp_a_003', ?, 'RCP-LPC-2024-0003', 'pay_a_3', 'inv_a_002', 'stu_a2_02',
      16000000, 16000000, 0, '2024-09-12', 'usr_bursar_lagos_01', 'Official receipt for full term payment via online portal'
    )
  `).run(schoolAId);

  // 2. Demo PENDING payment for School A to demonstrate Bursar manual verification workflow
  // Adebayo Olawale (stu_a1_01) submitted bank transfer slip of ₦25,000 (2,500,000 kobo)
  db.prepare(`
    INSERT OR IGNORE INTO payments (
      id, school_id, invoice_id, student_id, payment_reference, internal_reference,
      amount, currency, payment_method, provider, provider_reference, status,
      payment_date, paid_at, notes, received_by
    ) VALUES (
      'pay_a_pending_01', ?, 'inv_a_001', 'stu_a1_01', 'PAY-LPC-2024-0004-PEND', 'PAY-LPC-2024-0004-PEND',
      2500000, 'NGN', 'BANK_TRANSFER', 'MANUAL', 'GTB-TRF-REF-998124', 'PENDING',
      '2024-10-10', '2024-10-10 14:20:00', 'Direct bank transfer teller submitted by guardian. Awaiting Bursar bank reconciliation.', 'usr_bursar_lagos_01'
    )
  `).run(schoolAId);

  // 3. Demo In-App Notifications for School A
  db.prepare(`
    INSERT OR IGNORE INTO notifications (id, school_id, user_id, type, title, message, data) VALUES
    (
      'notif_a_01', ?, 'usr_bursar_lagos_01', 'PAYMENT_RECEIVED',
      'New Payment Recorded: ₦50,000.00',
      'Payment PAY-LPC-2024-0002 recorded via POS for Adebayo Olawale (SSS 2 Gold). Receipt RCP-LPC-2024-0002 issued.',
      '{"invoiceId":"inv_a_001","paymentId":"pay_a_2","studentId":"stu_a1_01","amountKobo":5000000}'
    ),
    (
      'notif_a_02', ?, 'usr_bursar_lagos_01', 'PAYMENT_VERIFIED',
      'Online Payment Confirmed: ₦160,000.00',
      'Chioma Okonkwo (SSS 1 Science) settled Invoice INV-2024-002 in full via online checkout. Receipt RCP-LPC-2024-0003 generated.',
      '{"invoiceId":"inv_a_002","paymentId":"pay_a_3","studentId":"stu_a2_02","amountKobo":16000000}'
    ),
    (
      'notif_a_03', ?, 'usr_bursar_lagos_01', 'INVOICE_CREATED',
      'Term 1 Invoices Dispatched',
      'Term 1 fee billing schedule published for 2024/2025 Academic Session across SSS classes.',
      '{"sessionId":"ses_a_2024","termId":"trm_a_1"}'
    )
  `).run(schoolAId, schoolAId, schoolAId);

  // Demo In-App Notifications for School B (Tenancy Isolated)
  db.prepare(`
    INSERT OR IGNORE INTO notifications (id, school_id, user_id, type, title, message, data) VALUES
    (
      'notif_b_01', ?, 'usr_owner_abuja_02', 'INVOICE_CREATED',
      'Term 1 Invoice Issued: Zainab Bello',
      'Invoice INV-AHA-2024-101 generated for Zainab Bello (JSS 3 Emerald) totaling ₦240,000.00.',
      '{"invoiceId":"inv_b_001","studentId":"stu_b1_01","amountKobo":24000000}'
    )
  `).run(schoolBId);

  console.log('[Database] Step 4 Payments, Receipts, and Notifications seeded successfully.');
}

function seedStep5PlatformSubscriptions() {
  const schoolAId = 'sch_lagos_premier_01';
  const schoolBId = 'sch_abuja_horizon_02';

  // 1. Seed Subscription Plans
  const plans = [
    {
      id: 'plan_trial',
      name: 'TRIAL',
      display_name: 'Free 30-Day Trial',
      description: 'Full evaluation environment for new schools joining BursarIQ.',
      price: 0,
      billing_interval: 'TERM',
      student_limit: 50,
      staff_limit: 10,
      storage_limit_mb: 250,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: false,
        reports: true,
        parent_portal: false,
        notifications: false,
        exports: false,
        advanced_analytics: false,
        api_access: false,
        custom_branding: false,
      }),
      active: 1,
    },
    {
      id: 'plan_basic',
      name: 'BASIC',
      display_name: 'Basic Tier',
      description: 'Essential billing, invoicing, and student management for growing primary schools.',
      price: 2500000, // ₦25,000 / term
      billing_interval: 'TERM',
      student_limit: 200,
      staff_limit: 20,
      storage_limit_mb: 1000,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: false,
        reports: true,
        parent_portal: false,
        notifications: true,
        exports: true,
        advanced_analytics: false,
        api_access: false,
        custom_branding: false,
      }),
      active: 1,
    },
    {
      id: 'plan_standard',
      name: 'STANDARD',
      display_name: 'Standard Tier',
      description: 'Comprehensive financial suite with online payment gateway integration and parent portal.',
      price: 6000000, // ₦60,000 / term
      billing_interval: 'TERM',
      student_limit: 500,
      staff_limit: 50,
      storage_limit_mb: 5000,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: true,
        reports: true,
        parent_portal: true,
        notifications: true,
        exports: true,
        advanced_analytics: false,
        api_access: false,
        custom_branding: false,
      }),
      active: 1,
    },
    {
      id: 'plan_premium',
      name: 'PREMIUM',
      display_name: 'Premium Tier',
      description: 'High-capacity platform with multi-campus features, custom branding, and advanced analytics.',
      price: 12000000, // ₦120,000 / term
      billing_interval: 'TERM',
      student_limit: 1500,
      staff_limit: 120,
      storage_limit_mb: 20000,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: true,
        reports: true,
        parent_portal: true,
        notifications: true,
        exports: true,
        advanced_analytics: true,
        api_access: false,
        custom_branding: true,
      }),
      active: 1,
    },
    {
      id: 'plan_enterprise',
      name: 'ENTERPRISE',
      display_name: 'Enterprise Tier',
      description: 'Unlimited scale for educational groups, mission schools, and multi-branch networks.',
      price: 25000000, // ₦250,000 / annual
      billing_interval: 'ANNUAL',
      student_limit: 10000,
      staff_limit: 500,
      storage_limit_mb: 100000,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: true,
        reports: true,
        parent_portal: true,
        notifications: true,
        exports: true,
        advanced_analytics: true,
        api_access: true,
        custom_branding: true,
      }),
      active: 1,
    },
  ];

  for (const p of plans) {
    db.prepare(`
      INSERT INTO subscription_plans (
        id, name, display_name, description, price, billing_interval,
        student_limit, staff_limit, storage_limit_mb, feature_flags, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        price = excluded.price,
        student_limit = excluded.student_limit,
        staff_limit = excluded.staff_limit,
        storage_limit_mb = excluded.storage_limit_mb,
        feature_flags = excluded.feature_flags,
        active = excluded.active
    `).run(
      p.id, p.name, p.display_name, p.description, p.price, p.billing_interval,
      p.student_limit, p.staff_limit, p.storage_limit_mb, p.feature_flags, p.active
    );
  }

  // 2. Additional Showcase Schools for complete SaaS visibility
  const showcaseSchools = [
    {
      id: 'sch_ibadan_model_03',
      name: 'Ibadan Model Academy',
      slug: 'ibadan-model',
      type: 'Comprehensive / K-12',
      status: 'TRIAL',
      state: 'Oyo',
      lga: 'Ibadan North',
      phone: '+234 802 345 6789',
      email: 'admin@ibadanmodel.sch.ng',
      plan_id: 'plan_trial',
      sub_status: 'TRIAL',
    },
    {
      id: 'sch_kano_heritage_04',
      name: 'Kano Heritage College',
      slug: 'kano-heritage',
      type: 'Secondary',
      status: 'SUSPENDED',
      state: 'Kano',
      lga: 'Nassarawa',
      phone: '+234 806 789 0123',
      email: 'info@kanoheritage.edu.ng',
      plan_id: 'plan_basic',
      sub_status: 'SUSPENDED',
    },
    {
      id: 'sch_enugu_grace_05',
      name: 'Enugu Grace High School',
      slug: 'enugu-grace',
      type: 'Secondary',
      status: 'EXPIRED',
      state: 'Enugu',
      lga: 'Enugu North',
      phone: '+234 803 456 7890',
      email: 'office@enugugrace.sch.ng',
      plan_id: 'plan_standard',
      sub_status: 'EXPIRED',
    },
  ];

  for (const s of showcaseSchools) {
    db.prepare(`
      INSERT OR IGNORE INTO schools (id, name, slug, type, status, state, lga, phone, email, current_plan_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(s.id, s.name, s.slug, s.type, s.status, s.state, s.lga, s.phone, s.email, s.plan_id);

    db.prepare(`
      INSERT OR IGNORE INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term)
      VALUES (?, ?, 'NGN', '₦', '2024/2025', '1st Term')
    `).run(`set_${s.id}`, s.id);
  }

  // 3. Seed Subscriptions for Demo Schools (INSERT OR IGNORE so real/edited subscriptions are never replaced)
  const subscriptions = [
    {
      id: 'sub_lagos_01',
      school_id: schoolAId,
      plan_id: 'plan_standard',
      status: 'ACTIVE',
      start_date: '2024-09-01',
      end_date: '2025-08-31',
      amount_paid: 6000000, // ₦60,000
      provider: 'BANK_TRANSFER',
      notes: 'Term 1 standard subscription renewal confirmed.',
    },
    {
      id: 'sub_abuja_02',
      school_id: schoolBId,
      plan_id: 'plan_premium',
      status: 'ACTIVE',
      start_date: '2024-09-01',
      end_date: '2025-08-31',
      amount_paid: 12000000, // ₦120,000
      provider: 'PAYSTACK',
      provider_reference: 'PSTK_SUB_ABUJA_2024',
      notes: 'Premium enterprise subscription with online gateway activated.',
    },
    {
      id: 'sub_ibadan_03',
      school_id: 'sch_ibadan_model_03',
      plan_id: 'plan_trial',
      status: 'TRIAL',
      start_date: '2026-09-20',
      end_date: '2026-10-20',
      trial_end_date: '2026-10-20',
      amount_paid: 0,
      provider: 'MANUAL',
      notes: 'New trial evaluation period.',
    },
    {
      id: 'sub_kano_04',
      school_id: 'sch_kano_heritage_04',
      plan_id: 'plan_basic',
      status: 'SUSPENDED',
      start_date: '2024-09-01',
      end_date: '2024-12-31',
      amount_paid: 2500000,
      provider: 'BANK_TRANSFER',
      notes: 'Account suspended by platform admin pending compliance documentation.',
    },
    {
      id: 'sub_enugu_05',
      school_id: 'sch_enugu_grace_05',
      plan_id: 'plan_standard',
      status: 'EXPIRED',
      start_date: '2024-01-10',
      end_date: '2024-07-31',
      amount_paid: 6000000,
      provider: 'MANUAL',
      notes: 'Subscription expired. Preserved data intact in grace period.',
    },
  ];

  for (const sub of subscriptions) {
    const schoolExists = db.prepare('SELECT id FROM schools WHERE id = ?').get(sub.school_id);
    if (!schoolExists) continue;
    db.prepare(`
      INSERT OR IGNORE INTO school_subscriptions (
        id, school_id, plan_id, status, start_date, end_date, trial_end_date, amount_paid, provider, provider_reference, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sub.id, sub.school_id, sub.plan_id, sub.status, sub.start_date, sub.end_date,
      sub.trial_end_date || null, sub.amount_paid, sub.provider, sub.provider_reference || null, sub.notes
    );
  }

  // 4. Seed Platform SaaS Subscription Revenue Payments
  const platformPayments = [
    {
      id: 'ppay_lagos_01',
      school_id: schoolAId,
      subscription_id: 'sub_lagos_01',
      plan_id: 'plan_standard',
      amount: 6000000,
      payment_method: 'BANK_TRANSFER',
      provider: 'MANUAL',
      internal_reference: 'PLT-PAY-LPC-2024-01',
      status: 'SUCCESS',
      paid_at: '2024-09-02 11:30:00',
      notes: 'Lagos Premier College Term 1 SaaS fee settlement.',
    },
    {
      id: 'ppay_abuja_02',
      school_id: schoolBId,
      subscription_id: 'sub_abuja_02',
      plan_id: 'plan_premium',
      amount: 12000000,
      payment_method: 'PAYSTACK',
      provider: 'PAYSTACK',
      provider_reference: 'pstk_ref_aha_2024_01',
      internal_reference: 'PLT-PAY-AHA-2024-01',
      status: 'SUCCESS',
      paid_at: '2024-09-03 14:15:00',
      notes: 'Abuja Horizon Academy Premium SaaS subscription payment via Paystack.',
    },
    {
      id: 'ppay_kano_03',
      school_id: 'sch_kano_heritage_04',
      subscription_id: 'sub_kano_04',
      plan_id: 'plan_basic',
      amount: 2500000,
      payment_method: 'BANK_TRANSFER',
      provider: 'MANUAL',
      internal_reference: 'PLT-PAY-KHC-2024-01',
      status: 'SUCCESS',
      paid_at: '2024-09-05 09:45:00',
      notes: 'Kano Heritage College Basic Plan fee.',
    },
  ];

  for (const pp of platformPayments) {
    const subExists = db.prepare('SELECT id FROM school_subscriptions WHERE id = ?').get(pp.subscription_id);
    if (!subExists) continue;
    db.prepare(`
      INSERT OR IGNORE INTO platform_payments (
        id, school_id, subscription_id, plan_id, amount, currency, payment_method, provider,
        provider_reference, internal_reference, status, paid_at, notes
      ) VALUES (?, ?, ?, ?, ?, 'NGN', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pp.id, pp.school_id, pp.subscription_id, pp.plan_id, pp.amount,
      pp.payment_method, pp.provider, pp.provider_reference || null,
      pp.internal_reference, pp.status, pp.paid_at, pp.notes
    );
  }

  // 5. Seed Partners
  const partners = [
    {
      id: 'ptn_access_01',
      name: 'Access Bank EdTech Alliance',
      email: 'partnerships@accessbankplc.com',
      phone: '+234 1 271 2005',
      company: 'Access Bank Plc',
      partner_type: 'BANK',
      commission_rate: 15.0,
      referral_code: 'ACCESS-EDU',
      status: 'ACTIVE',
      notes: 'Nationwide institutional banking partner integrating digital collections for partner schools.',
    },
    {
      id: 'ptn_zenith_02',
      name: 'Zenith EduConnect',
      email: 'edutech@zenithbank.com',
      phone: '+234 1 278 7000',
      company: 'Zenith Bank Plc',
      partner_type: 'BANK',
      commission_rate: 12.5,
      referral_code: 'ZENITH-SCH',
      status: 'ACTIVE',
      notes: 'Automated settlement partner in Lagos, Abuja and Port Harcourt educational zones.',
    },
    {
      id: 'ptn_reseller_03',
      name: 'Nigerian Schools Direct Ltd',
      email: 'contact@nigerianschoolsdirect.ng',
      phone: '+234 803 123 4567',
      company: 'Nigerian Schools Direct Ltd',
      partner_type: 'RESELLER',
      commission_rate: 20.0,
      referral_code: 'NSD-PARTNER',
      status: 'ACTIVE',
      notes: 'Regional educational consultancy and school onboarding agency in South-West Nigeria.',
    },
  ];

  for (const p of partners) {
    db.prepare(`
      INSERT OR IGNORE INTO partners (
        id, name, email, phone, company, partner_type, commission_rate, referral_code, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      p.id, p.name, p.email, p.phone, p.company, p.partner_type,
      p.commission_rate, p.referral_code, p.status, p.notes
    );
  }

  // 6. Seed Commissions
  const commissions = [
    {
      id: 'com_01',
      partner_id: 'ptn_access_01',
      school_id: schoolAId,
      platform_payment_id: 'ppay_lagos_01',
      amount: 900000,
      rate_percent: 15.0,
      status: 'PAID',
      notes: 'Settled commission for Lagos Premier College Term 1 onboarding.',
      paid_at: '2024-09-10',
    },
    {
      id: 'com_02',
      partner_id: 'ptn_zenith_02',
      school_id: schoolBId,
      platform_payment_id: 'ppay_abuja_02',
      amount: 1500000,
      rate_percent: 12.5,
      status: 'PENDING',
      notes: 'Pending payout for Abuja Horizon Academy Premium Plan commission.',
      paid_at: null,
    },
  ];

  for (const c of commissions) {
    const payExists = db.prepare('SELECT id FROM platform_payments WHERE id = ?').get(c.platform_payment_id);
    if (!payExists) continue;
    db.prepare(`
      INSERT OR IGNORE INTO commissions (
        id, partner_id, school_id, platform_payment_id, amount, rate_percent, status, notes, paid_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(c.id, c.partner_id, c.school_id, c.platform_payment_id, c.amount, c.rate_percent, c.status, c.notes, c.paid_at);
  }

  console.log('[Database] Step 5 Platform Super Admin, Subscriptions & SaaS seeded successfully.');
}


// Periodic lightweight memory hygiene (checkpoint WAL & release unneeded native pages)
const sqliteCleaner = setInterval(() => {
  try {
    rawDb.exec('PRAGMA wal_checkpoint(PASSIVE);');
  } catch (e) {}
}, 30 * 60 * 1000);
if (sqliteCleaner.unref) sqliteCleaner.unref();
