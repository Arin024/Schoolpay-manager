/**
 * BURSARIQ - POSTGRESQL ASYNC AUTHENTICATION & SESSION SERVICE
 *
 * Implements asynchronous, PostgreSQL-native authentication, session creation,
 * session validation, tenant resolution, and impersonation.
 *
 * Replaces synchronous SQLite sessions in server/auth.ts and server/tenantMiddleware.ts
 * when connected to PostgreSQL (pg.Pool).
 */

import crypto from 'node:crypto';
import pg from 'pg';
import { getPgPool, cacheDb, markPgConnected, isTransientPgError } from './db.ts';
import type { UserRecord, UserRoleRecord } from './auth.ts';

async function execPg(
  runner: pg.Pool | pg.PoolClient,
  sql: string,
  params: any[] = []
): Promise<pg.QueryResult<any>> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await runner.query(sql, params);
      markPgConnected();
      return res;
    } catch (err: any) {
      if (attempt === 1 && !('release' in runner) && isTransientPgError(err)) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      throw err;
    }
  }
  throw new Error('PostgreSQL session query retry exhausted');
}

export interface SessionData {
  user: UserRecord;
  schoolId: string | null;
  roles: UserRoleRecord[];
  impersonatedBy: string | null;
}

/**
 * Creates a new session in PostgreSQL
 */
export async function createSessionPg(
  userId: string,
  schoolId?: string | null,
  ip?: string,
  userAgent?: string,
  poolClient?: pg.PoolClient
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const sessionId = 'ses_' + crypto.randomUUID();
  const pool = poolClient || getPgPool();

  if (!pool) {
    throw new Error('PostgreSQL pool not available for createSessionPg');
  }

  await pool.query(
    `INSERT INTO sessions (id, token, user_id, school_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '7 days')`,
    [sessionId, token, userId, schoolId || null, ip || null, userAgent || null]
  );
  markPgConnected();

  return token;
}

/**
 * Creates an impersonation session in PostgreSQL
 */
export async function createImpersonationSessionPg(
  targetUserId: string,
  targetSchoolId: string,
  superAdminId: string,
  ip?: string,
  userAgent?: string,
  poolClient?: pg.PoolClient
): Promise<string> {
  const token = 'imp_' + crypto.randomBytes(32).toString('hex');
  const sessionId = 'ses_imp_' + crypto.randomUUID();
  const pool = poolClient || getPgPool();

  if (!pool) {
    throw new Error('PostgreSQL pool not available for createImpersonationSessionPg');
  }

  await pool.query(
    `INSERT INTO sessions (id, token, user_id, school_id, impersonated_by, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP + INTERVAL '2 hours')`,
    [sessionId, token, targetUserId, targetSchoolId, superAdminId, ip || null, userAgent || null]
  );
  markPgConnected();

  return token;
}

/**
 * Validates a session token asynchronously against PostgreSQL
 */
export async function validateSessionPg(
  token: string,
  poolClient?: pg.PoolClient
): Promise<SessionData | null> {
  if (!token || token.trim() === '') return null;
  const pool = poolClient || getPgPool();

  if (!pool) return null;

  // 1. Query active session (with automatic retry on idle Neon socket reset)
  const sessionRes = await execPg(
    pool,
    `SELECT * FROM sessions 
     WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP`,
    [token]
  );

  if (sessionRes.rows.length === 0) return null;
  const session = sessionRes.rows[0];

  // 2. Query user
  const userRes = await execPg(
    pool,
    `SELECT * FROM users WHERE id = $1 AND is_active = 1`,
    [session.user_id]
  );

  if (userRes.rows.length === 0) return null;
  const user: UserRecord = userRes.rows[0];

  // 3. Query user roles with school details
  const rolesRes = await execPg(
    pool,
    `SELECT ur.*, r.name as role_name, r.display_name as role_display_name, r.scope as role_scope,
            s.name as school_name, s.status as school_status
     FROM user_roles ur
     JOIN roles r ON ur.role_id = r.id
     LEFT JOIN schools s ON ur.school_id = s.id
     WHERE ur.user_id = $1
     ORDER BY ur.is_primary DESC, ur.created_at ASC`,
    [user.id]
  );
  const roles: UserRoleRecord[] = rolesRes.rows;

  // 4. Derive active school tenant context
  let resolvedSchoolId = session.school_id;
  if (!resolvedSchoolId && user.is_platform_admin !== 1 && roles.length > 0) {
    const primarySchoolRole = roles.find((r) => r.school_id !== null);
    if (primarySchoolRole && primarySchoolRole.school_id) {
      resolvedSchoolId = primarySchoolRole.school_id;
      pool
        .query('UPDATE sessions SET school_id = $1 WHERE id = $2', [resolvedSchoolId, session.id])
        .catch(() => {});
    }
  }

  // 5. Sliding session extension (bump back to 7 days if < 5 days remaining)
  pool
    .query(
      `UPDATE sessions 
       SET expires_at = CURRENT_TIMESTAMP + INTERVAL '7 days'
       WHERE id = $1 AND expires_at < CURRENT_TIMESTAMP + INTERVAL '5 days'`,
      [session.id]
    )
    .catch(() => {});

  // 6. Non-destructive local SQLite cache sync (NEVER use INSERT OR REPLACE on schools/users as that fires ON DELETE CASCADE!)
  try {
    cacheDb.prepare(`
      INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        password_hash = excluded.password_hash,
        salt = excluded.salt,
        full_name = excluded.full_name,
        phone = excluded.phone,
        is_platform_admin = excluded.is_platform_admin,
        is_active = excluded.is_active
    `).run(
      user.id,
      user.email,
      user.password_hash,
      user.salt,
      user.full_name,
      user.phone || null,
      user.is_platform_admin,
      user.is_active,
      user.created_at ? new Date(user.created_at).toISOString() : new Date().toISOString()
    );

    if (resolvedSchoolId) {
      const schRes = await pool.query('SELECT * FROM schools WHERE id = $1', [resolvedSchoolId]);
      if (schRes.rows.length > 0) {
        const s = schRes.rows[0];
        cacheDb.prepare(`
          INSERT INTO schools (id, name, slug, type, status, address, state, lga, phone, email, current_plan_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            status = excluded.status,
            address = excluded.address,
            state = excluded.state,
            lga = excluded.lga,
            phone = excluded.phone,
            email = excluded.email,
            current_plan_id = COALESCE(excluded.current_plan_id, schools.current_plan_id)
        `).run(
          s.id,
          s.name,
          s.slug,
          s.type || 'MIXED',
          s.status || 'TRIAL',
          s.address || '',
          s.state || '',
          s.lga || '',
          s.phone || '',
          s.email || '',
          s.current_plan_id || null
        );
      }

      const setRes = await pool.query('SELECT * FROM school_settings WHERE school_id = $1', [resolvedSchoolId]);
      if (setRes.rows.length > 0) {
        const st = setRes.rows[0];
        cacheDb.prepare(`
          INSERT INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(school_id) DO UPDATE SET
            current_academic_session = COALESCE(excluded.current_academic_session, school_settings.current_academic_session),
            current_term = COALESCE(excluded.current_term, school_settings.current_term)
        `).run(
          st.id,
          st.school_id,
          st.currency || 'NGN',
          st.currency_symbol || '₦',
          st.current_academic_session || '2024/2025',
          st.current_term || '1st Term',
          st.payment_notification_email || null
        );
      }
    }

    for (const r of roles) {
      try {
        cacheDb.prepare(`
          INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, school_id, role_id) DO UPDATE SET
            is_primary = excluded.is_primary
        `).run(r.id, r.user_id, r.school_id || null, r.role_id, r.is_primary ? 1 : 0);
      } catch {}
    }

    cacheDb.prepare(`
      INSERT INTO sessions (id, token, user_id, school_id, impersonated_by, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        token = excluded.token,
        school_id = excluded.school_id,
        expires_at = excluded.expires_at
    `).run(
      session.id,
      session.token,
      session.user_id,
      resolvedSchoolId || null,
      session.impersonated_by || null,
      session.ip_address || null,
      session.user_agent || null,
      session.expires_at ? new Date(session.expires_at).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString()
    );
  } catch (syncErr) {
    // Non-blocking cache sync
  }

  return {
    user,
    schoolId: resolvedSchoolId,
    roles,
    impersonatedBy: session.impersonated_by || null,
  };
}

/**
 * Destroys a session in PostgreSQL
 */
export async function destroySessionPg(
  token: string,
  poolClient?: pg.PoolClient
): Promise<void> {
  const pool = poolClient || getPgPool();
  if (!pool) return;

  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}
