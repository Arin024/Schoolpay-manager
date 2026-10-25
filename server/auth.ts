import crypto from 'node:crypto';
import { db, cacheDb, getPgPool, markPgConnected } from './db.ts';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  full_name: string;
  phone: string | null;
  is_platform_admin: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  school_id: string | null;
  role_id: string;
  role_name: string;
  role_display_name: string;
  role_scope: string;
  is_primary: number;
  school_name?: string | null;
  school_status?: string | null;
}

export function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const computed = hashPassword(password, salt);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function createSessionAsync(userId: string, schoolId?: string | null, ip?: string, userAgent?: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const sessionId = 'ses_' + crypto.randomUUID();

  // 1. Authoritative Neon PostgreSQL Persistence First (MANDATORY when pool configured)
  const pool = getPgPool();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO sessions (id, token, user_id, school_id, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '7 days')
         ON CONFLICT (id) DO UPDATE SET
           token = EXCLUDED.token,
           school_id = EXCLUDED.school_id,
           expires_at = EXCLUDED.expires_at`,
        [sessionId, token, userId, schoolId || null, ip || null, userAgent || null]
      );
      markPgConnected();
    } finally {
      client.release();
    }
  } else if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
    throw new Error('Database pool unavailable for session creation');
  }

  // 2. Local SQLite read-cache write (using cacheDb so we don't duplicate PG insert)
  try {
    let validSchoolId: string | null = null;
    if (schoolId) {
      try {
        const row = cacheDb.prepare('SELECT id FROM schools WHERE id = ?').get(schoolId);
        if (row) validSchoolId = schoolId;
      } catch {}
    }
    cacheDb.prepare(`
      INSERT INTO sessions (id, token, user_id, school_id, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 days'))
      ON CONFLICT(id) DO UPDATE SET
        token = excluded.token,
        school_id = excluded.school_id,
        expires_at = excluded.expires_at
    `).run(sessionId, token, userId, validSchoolId, ip || null, userAgent || null);
  } catch {}

  return token;
}

export function createSession(userId: string, schoolId?: string | null, ip?: string, userAgent?: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const sessionId = 'ses_' + crypto.randomUUID();

  let validSchoolId: string | null = null;
  if (schoolId) {
    try {
      const row = cacheDb.prepare('SELECT id FROM schools WHERE id = ?').get(schoolId);
      if (row) validSchoolId = schoolId;
    } catch {}
  }

  try {
    cacheDb.prepare(`
      INSERT INTO sessions (id, token, user_id, school_id, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 days'))
      ON CONFLICT(id) DO UPDATE SET
        token = excluded.token,
        school_id = excluded.school_id,
        expires_at = excluded.expires_at
    `).run(sessionId, token, userId, validSchoolId, ip || null, userAgent || null);
  } catch {}

  // Replicate to Neon PostgreSQL immediately
  try {
    const pool = getPgPool();
    if (pool) {
      pool.query(
        `INSERT INTO sessions (id, token, user_id, school_id, ip_address, user_agent, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '7 days')
          ON CONFLICT (id) DO UPDATE SET
            token = EXCLUDED.token,
            school_id = EXCLUDED.school_id,
            expires_at = EXCLUDED.expires_at`,
        [sessionId, token, userId, schoolId || null, ip || null, userAgent || null]
      ).then(() => markPgConnected()).catch((err: any) => {
        console.error('[PostgreSQL Session Replication Error]', err.message);
      });
    }
  } catch (err: any) {
    console.error('[PostgreSQL Session Replication Notice]', err.message);
  }

  return token;
}

export function createImpersonationSession(
  targetUserId: string,
  targetSchoolId: string,
  superAdminId: string,
  ip?: string,
  userAgent?: string
): string {
  const token = 'imp_' + crypto.randomBytes(32).toString('hex');
  const sessionId = 'ses_imp_' + crypto.randomUUID();

  try {
    cacheDb.prepare(`
      INSERT INTO sessions (id, token, user_id, school_id, impersonated_by, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+2 hours'))
    `).run(sessionId, token, targetUserId, targetSchoolId, superAdminId, ip || null, userAgent || null);
  } catch {}

  try {
    const pool = getPgPool();
    if (pool) {
      pool.query(
        `INSERT INTO sessions (id, token, user_id, school_id, impersonated_by, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP + INTERVAL '2 hours')
         ON CONFLICT (id) DO NOTHING`,
        [sessionId, token, targetUserId, targetSchoolId, superAdminId, ip || null, userAgent || null]
      ).then(() => markPgConnected()).catch(() => {});
    }
  } catch {}

  return token;
}

export async function validateSessionAsync(token: string): Promise<{
  user: UserRecord;
  schoolId: string | null;
  roles: UserRoleRecord[];
  impersonatedBy: string | null;
} | null> {
  if (!token) return null;

  // 1. Authoritative Neon PostgreSQL check first whenever pool exists
  try {
    const pool = getPgPool();
    if (pool) {
      const { validateSessionPg } = await import('./postgresAuthService.ts');
      const pgData = await validateSessionPg(token);
      if (pgData) {
        return {
          user: pgData.user,
          schoolId: pgData.schoolId,
          roles: pgData.roles as any,
          impersonatedBy: pgData.impersonatedBy,
        };
      }
    }
  } catch (err: any) {
    console.warn('[validateSessionAsync PG warning]', err?.message);
  }

  // 2. Synchronous local cache fallback (only when PG is not configured)
  if (!getPgPool()) {
    return validateSession(token);
  }
  return null;
}

export function validateSession(token: string): {
  user: UserRecord;
  schoolId: string | null;
  roles: UserRoleRecord[];
  impersonatedBy: string | null;
} | null {
  if (!token) return null;

  const session = db.prepare(`
    SELECT * FROM sessions 
    WHERE token = ? AND datetime(expires_at) > datetime('now')
  `).get(token) as { id: string; user_id: string; school_id: string | null; impersonated_by?: string | null } | undefined;

  if (!session) return null;

  const user = db.prepare(`
    SELECT * FROM users WHERE id = ? AND is_active = 1
  `).get(session.user_id) as UserRecord | undefined;

  if (!user) return null;

  const roles = db.prepare(`
    SELECT ur.*, r.name as role_name, r.display_name as role_display_name, r.scope as role_scope,
           s.name as school_name, s.status as school_status
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    LEFT JOIN schools s ON ur.school_id = s.id
    WHERE ur.user_id = ?
    ORDER BY ur.is_primary DESC, ur.created_at ASC
  `).all(user.id) as unknown as UserRoleRecord[];

  let resolvedSchoolId = session.school_id;
  if (!resolvedSchoolId && user.is_platform_admin !== 1 && roles.length > 0) {
    const primarySchoolRole = roles.find((r) => r.school_id !== null);
    if (primarySchoolRole && primarySchoolRole.school_id) {
      resolvedSchoolId = primarySchoolRole.school_id;
      try {
        cacheDb.prepare('UPDATE sessions SET school_id = ? WHERE id = ?').run(resolvedSchoolId, session.id);
      } catch {}
    }
  }

  try {
    cacheDb.prepare(`
      UPDATE sessions 
      SET expires_at = datetime('now', '+7 days')
      WHERE id = ? AND datetime(expires_at) < datetime('now', '+5 days')
    `).run(session.id);
  } catch {}

  return {
    user,
    schoolId: resolvedSchoolId,
    roles,
    impersonatedBy: session.impersonated_by || null,
  };
}

export async function destroySessionAsync(token: string): Promise<void> {
  try {
    cacheDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  } catch {}
  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
      markPgConnected();
    } catch (err: any) {
      console.error('[PostgreSQL destroySessionAsync Warning]', err?.message);
    }
  }
}

export function destroySession(token: string) {
  try {
    cacheDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  } catch {}
  try {
    const pool = getPgPool();
    if (pool) {
      pool.query('DELETE FROM sessions WHERE token = $1', [token]).then(() => markPgConnected()).catch((err) => {
        console.error('[PostgreSQL destroySession Warning]', err.message);
      });
    }
  } catch {}
}

