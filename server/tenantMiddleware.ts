import type { Request, Response, NextFunction } from 'express';
import { validateSession, type UserRecord, type UserRoleRecord } from './auth.ts';
import { db } from './db.ts';
import { logAudit } from './audit.ts';

export interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  roles?: UserRoleRecord[];
  activeSchoolId?: string | null;
  activeRole?: UserRoleRecord;
  targetSchoolId?: string;
  impersonatedBy?: string | null;
}

// 1. Authentication Middleware - extracts session token from Authorization header or cookie
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers['x-session-token']) {
    token = req.headers['x-session-token'] as string;
  }

  if (!token) {
    return res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Access denied. Valid authentication session required.',
    });
  }

  // 1. Check PostgreSQL first if pool or test connection is active
  let pgChecked = false;
  let pgErrored = false;
  try {
    const { getPgPool } = await import('./db.ts');
    const { validateSessionPg } = await import('./postgresAuthService.ts');
    const pool = getPgPool();

    if (pool) {
      const sessionDataPg = await validateSessionPg(token);
      pgChecked = true;
      if (sessionDataPg) {
        req.user = sessionDataPg.user as any;
        req.roles = sessionDataPg.roles as any;
        req.activeSchoolId = sessionDataPg.schoolId;
        req.impersonatedBy = sessionDataPg.impersonatedBy;
        return next();
      }
    } else if (process.env.TEST_POSTGRES_URL) {
      const pg = await import('pg');
      const poolToClose = new pg.default.Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
        ssl: process.env.TEST_POSTGRES_URL.includes('localhost') ? false : { rejectUnauthorized: true },
        max: 2,
      });
      const pgClient = await poolToClose.connect();
      try {
        const sessionDataPg = await validateSessionPg(token, pgClient);
        pgChecked = true;
        if (sessionDataPg) {
          req.user = sessionDataPg.user as any;
          req.roles = sessionDataPg.roles as any;
          req.activeSchoolId = sessionDataPg.schoolId;
          req.impersonatedBy = sessionDataPg.impersonatedBy;
          return next();
        }
      } finally {
        pgClient.release();
        await poolToClose.end();
      }
    }
  } catch (err: any) {
    pgErrored = true;
    console.warn('[requireAuth PG Transient Notice]', err?.message);
  }

  // If PG successfully checked and confirmed the token does NOT exist or is expired, reject immediately
  if (pgChecked) {
    return res.status(401).json({
      error: 'INVALID_SESSION',
      message: 'Your session has expired or is invalid. Please sign in again.',
    });
  }

  // 2. Fall back to local SQLite session validation
  const sessionData = validateSession(token);
  if (!sessionData) {
    // CRITICAL: If PG had a transient connectivity failure and local cache is cold, return 503 (NOT 401!)
    // so the browser retains its valid session token instead of wiping localStorage.
    if (pgErrored) {
      return res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        message: 'Cloud database is waking up. Please retry in a moment.',
      });
    }
    return res.status(401).json({
      error: 'INVALID_SESSION',
      message: 'Your session has expired or is invalid. Please sign in again.',
    });
  }

  req.user = sessionData.user;
  req.roles = sessionData.roles;
  req.activeSchoolId = sessionData.schoolId;
  req.impersonatedBy = sessionData.impersonatedBy;

  next();
}

// 2. Strict Multi-Tenant Isolation Middleware (Tenant Guard & IDOR Blocker)
export async function requireTenant(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || !req.roles) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication required' });
  }

  // Super Admins operate at platform level and can view specified school tenants
  if (req.user.is_platform_admin === 1) {
    const requestedSchoolId =
      (req.params.schoolId as string) ||
      (req.headers['x-school-id'] as string) ||
      (req.query.school_id as string) ||
      req.activeSchoolId;

    if (!requestedSchoolId) {
      return res.status(400).json({ error: 'MISSING_TENANT_ID', message: 'Super admin must specify target school_id' });
    }

    let school: { id: string; status: string; name: string } | undefined;
    try {
      const { getPgPool, cacheDb, markPgConnected } = await import('./db.ts');
      const pool = getPgPool();
      if (pool) {
        const pgRes = await pool.query('SELECT * FROM schools WHERE id = $1', [requestedSchoolId]);
        markPgConnected();
        if (pgRes.rows.length > 0) {
          const s = pgRes.rows[0];
          school = s as any;
          try {
            cacheDb.prepare(`
              INSERT INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website, current_plan_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                status = excluded.status,
                address = excluded.address,
                state = excluded.state,
                lga = excluded.lga,
                phone = excluded.phone,
                email = excluded.email,
                website = excluded.website
            `).run(s.id, s.name, s.slug, s.type || 'MIXED', s.status || 'TRIAL', s.address || '', s.state || '', s.lga || '', s.phone || '', s.email || '', s.website || null, s.current_plan_id || null);
          } catch {}
        }
      }
    } catch {}
    if (!school) {
      school = db.prepare('SELECT * FROM schools WHERE id = ?').get(requestedSchoolId) as { id: string; status: string; name: string } | undefined;
    }
    if (!school) {
      return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'School tenant does not exist' });
    }
    req.targetSchoolId = requestedSchoolId;
    return next();
  }

  // FOR ALL NORMAL SCHOOL USERS:
  // The tenant is derived authoritatively from the verified session in the database.
  // NEVER trust client-supplied school_id.
  if (!req.activeSchoolId) {
    return res.status(403).json({
      error: 'NO_ACTIVE_TENANT',
      message: 'Your authenticated account is not associated with an active school tenant.',
    });
  }

  // Check if client tried to inject a different school_id in headers, query, or params
  const clientSpecifiedSchoolId =
    (req.headers['x-school-id'] as string) ||
    (req.params.schoolId as string) ||
    (req.query.school_id as string) ||
    (req.body && req.body.school_id as string);

  if (clientSpecifiedSchoolId && clientSpecifiedSchoolId !== req.activeSchoolId) {
    // IDOR ATTEMPT: User belongs to School A, but supplied School B's ID in request
    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId: req.activeSchoolId,
      action: 'IDOR_SECURITY_VIOLATION',
      entity: 'TENANT_BOUNDARY',
      entityId: clientSpecifiedSchoolId,
      ipAddress: clientIp,
      metadata: {
        severity: 'CRITICAL',
        attemptedEndpoint: req.originalUrl,
        userAuthorizedSchool: req.activeSchoolId,
        injectedTargetSchool: clientSpecifiedSchoolId,
      },
    });

    console.warn(`[SECURITY ALERT - IDOR PREVENTED] User ${req.user.email} (School: ${req.activeSchoolId}) attempted to access foreign tenant ${clientSpecifiedSchoolId}`);

    return res.status(403).json({
      error: 'CROSS_TENANT_ACCESS_DENIED',
      message: 'Unauthorized: Cross-tenant access is strictly prohibited. You cannot access another school\'s records.',
      code: 'IDOR_PREVENTED',
    });
  }

  // Authoritative target is always the authenticated school
  req.targetSchoolId = req.activeSchoolId;

  // Verify user has role in this school
  const matchedRole = req.roles.find((r) => r.school_id === req.activeSchoolId);
  if (!matchedRole) {
    return res.status(403).json({
      error: 'TENANT_ACCESS_DENIED',
      message: 'User does not possess an active role in this school tenant.',
    });
  }
  req.activeRole = matchedRole;

  // Check school status (Authoritative Neon PostgreSQL first, local cache fallback)
  let school: { id: string; status: string; name: string } | undefined;
  try {
    const { getPgPool, cacheDb, markPgConnected } = await import('./db.ts');
    const pool = getPgPool();
    if (pool) {
      const pgRes = await pool.query('SELECT * FROM schools WHERE id = $1', [req.targetSchoolId]);
      markPgConnected();
      if (pgRes.rows.length > 0) {
        const s = pgRes.rows[0];
        school = s as any;
        try {
          cacheDb.prepare(`
            INSERT INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website, current_plan_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              status = excluded.status,
              address = excluded.address,
              state = excluded.state,
              lga = excluded.lga,
              phone = excluded.phone,
              email = excluded.email,
              website = excluded.website
          `).run(s.id, s.name, s.slug, s.type || 'MIXED', s.status || 'TRIAL', s.address || '', s.state || '', s.lga || '', s.phone || '', s.email || '', s.website || null, s.current_plan_id || null);
        } catch {}
      }
    }
  } catch {}
  if (!school) {
    school = db.prepare('SELECT id, status, name FROM schools WHERE id = ?').get(req.targetSchoolId) as { id: string; status: string; name: string } | undefined;
  }
  if (!school) {
    return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'School tenant not found' });
  }

  if (['SUSPENDED', 'CANCELLED', 'EXPIRED'].includes(school.status) && req.method !== 'GET') {
    return res.status(403).json({
      error: 'SCHOOL_LOCKED',
      message: `School account is currently ${school.status}. Modifications are restricted. Contact platform administration.`,
      status: school.status,
    });
  }

  next();
}

// 3. Platform Super Admin Guard
export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication required' });
  }

  if (req.user.is_platform_admin !== 1) {
    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: 'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT',
      entity: 'SUPER_ADMIN_PORTAL',
      ipAddress: clientIp,
      metadata: { endpoint: req.originalUrl },
    });

    return res.status(403).json({
      error: 'FORBIDDEN_SUPER_ADMIN_ONLY',
      message: 'Access restricted to Platform Super Administrators only.',
    });
  }

  next();
}

// 4. Role Requirement Guard
export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication required' });
    }

    if (req.user.is_platform_admin === 1) {
      return next(); // Super Admin bypasses role restriction
    }

    const currentRole = req.activeRole?.role_name;
    if (!currentRole || !allowedRoles.includes(currentRole)) {
      return res.status(403).json({
        error: 'INSUFFICIENT_ROLE_PERMISSIONS',
        message: `Action requires one of the following roles: ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
}
