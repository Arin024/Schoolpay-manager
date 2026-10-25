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
import { getPgPool } from './db.ts';
import type { UserRecord, UserRoleRecord } from './auth.ts';

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

  // 1. Query active session
  const sessionRes = await pool.query(
    `SELECT * FROM sessions 
     WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP`,
    [token]
  );

  if (sessionRes.rows.length === 0) return null;
  const session = sessionRes.rows[0];

  // 2. Query user
  const userRes = await pool.query(
    `SELECT * FROM users WHERE id = $1 AND is_active = 1`,
    [session.user_id]
  );

  if (userRes.rows.length === 0) return null;
  const user: UserRecord = userRes.rows[0];

  // 3. Query user roles with school details
  const rolesRes = await pool.query(
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

    // Seamless Cache Sync: Populate local SQLite cache with this valid PostgreSQL session & user data
  try {
    const { db } = await import('./db.ts');
    db.prepare(`
      INSERT OR REPLACE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.email,
      user.password_hash,
      user.salt,
      user.full_name,
      user.phone,
      user.is_platform_admin,
      user.is_active,
      user.created_at ? new Date(user.created_at).toISOString() : new Date().toISOString()
    );

    if (resolvedSchoolId) {
      const schRes = await pool.query('SELECT * FROM schools WHERE id = $1', [resolvedSchoolId]);
      if (schRes.rows.length > 0) {
        const s = schRes.rows[0];
        db.prepare(`
          INSERT OR REPLACE INTO schools (id, name, slug, type, status, address, state, lga, phone, email, current_plan_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(s.id, s.name, s.slug, s.type, s.status, s.address || '', s.state || '', s.lga || '', s.phone || '', s.email || '', s.current_plan_id || null);
      }
    }
    // Also sync user_roles to local cache so fallback queries find them
    for (const r of roles) {
      try {
        db.prepare(`
          INSERT OR REPLACE INTO user_roles (id, user_id, school_id, role_id, is_primary)
          VALUES (?, ?, ?, ?, ?)
        `).run(r.id, r.user_id, r.school_id, r.role_id, r.is_primary ? 1 : 0);
      } catch {}
    }

    db.prepare(`
      INSERT OR REPLACE INTO sessions (id, token, user_id, school_id, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.token,
      session.user_id,
      session.school_id || null,
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
