import crypto from 'node:crypto';
import { db } from './db.js';

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

export function createSession(userId: string, schoolId?: string | null, ip?: string, userAgent?: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const sessionId = 'ses_' + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  db.prepare(`
    INSERT INTO sessions (id, token, user_id, school_id, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, token, userId, schoolId || null, ip || null, userAgent || null, expiresAt);

  return token;
}

export function validateSession(token: string): { user: UserRecord; schoolId: string | null; roles: UserRoleRecord[] } | null {
  if (!token) return null;

  const session = db.prepare(`
    SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')
  `).get(token) as { id: string; user_id: string; school_id: string | null } | undefined;

  if (!session) return null;

  const user = db.prepare(`
    SELECT * FROM users WHERE id = ? AND is_active = 1
  `).get(session.user_id) as UserRecord | undefined;

  if (!user) return null;

  // Retrieve user roles joined with school details
  const roles = db.prepare(`
    SELECT ur.*, r.name as role_name, r.display_name as role_display_name, r.scope as role_scope,
           s.name as school_name, s.status as school_status
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    LEFT JOIN schools s ON ur.school_id = s.id
    WHERE ur.user_id = ?
  `).all(user.id) as unknown as UserRoleRecord[];

  return {
    user,
    schoolId: session.school_id,
    roles,
  };
}

export function destroySession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
