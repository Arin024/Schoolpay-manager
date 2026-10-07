import type { Request, Response, NextFunction } from 'express';
import { validateSession, UserRecord, UserRoleRecord } from './auth.js';
import { db } from './db.js';
import { logAudit } from './audit.js';

export interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  roles?: UserRoleRecord[];
  activeSchoolId?: string | null;
  activeRole?: UserRoleRecord;
  targetSchoolId?: string;
}

// 1. Authentication Middleware - extracts session token from Authorization header or cookie
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

  const sessionData = validateSession(token);
  if (!sessionData) {
    return res.status(401).json({
      error: 'INVALID_SESSION',
      message: 'Your session has expired or is invalid. Please sign in again.',
    });
  }

  req.user = sessionData.user;
  req.roles = sessionData.roles;
  req.activeSchoolId = sessionData.schoolId;

  next();
}

// 2. Strict Multi-Tenant Isolation Middleware (Tenant Guard & IDOR Blocker)
export function requireTenant(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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

    const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(requestedSchoolId) as { id: string; status: string; name: string } | undefined;
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

  // Check school status
  const school = db.prepare('SELECT id, status, name FROM schools WHERE id = ?').get(req.targetSchoolId) as { id: string; status: string; name: string } | undefined;
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
