import express from 'express';
import crypto from 'node:crypto';
import { db } from './db.js';
import {
  hashPassword,
  generateSalt,
  verifyPassword,
  createSession,
  destroySession,
  UserRecord,
} from './auth.js';
import {
  requireAuth,
  requireTenant,
  requireSuperAdmin,
  requireRole,
  AuthenticatedRequest,
} from './tenantMiddleware.js';
import { logAudit } from './audit.js';
import { NIGERIAN_STATES, SCHOOL_TYPES, SCHOOL_STATUSES } from '../src/constants/index.js';
import { financeRouter } from './financeRoutes.js';

export const apiRouter = express.Router();

// Mount Step 3 Financial Management module
apiRouter.use('/v1/school', financeRouter);


// Helper to create URL slug from school name
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

// ==============================================================================
// 1. PUBLIC AUTHENTICATION & SCHOOL REGISTRATION
// ==============================================================================

// POST /api/v1/auth/register-school
apiRouter.post('/v1/auth/register-school', (req, res) => {
  const {
    schoolName,
    schoolType,
    state,
    lga,
    address,
    phone,
    email: schoolEmail,
    ownerName,
    ownerEmail,
    password,
  } = req.body;

  // 1. Input Validation
  if (!schoolName || !schoolType || !state || !lga || !phone || !schoolEmail || !ownerName || !ownerEmail || !password) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'All fields marked with an asterisk are required for school registration.',
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: 'WEAK_PASSWORD',
      message: 'Password must be at least 8 characters long for bank-grade security.',
    });
  }

  // Check email formats
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(schoolEmail) || !emailRegex.test(ownerEmail)) {
    return res.status(400).json({
      error: 'INVALID_EMAIL',
      message: 'Please provide valid email addresses for school contact and proprietor.',
    });
  }

  // Check if school email or owner email already exists
  const existingSchool = db.prepare('SELECT id FROM schools WHERE email = ?').get(schoolEmail.toLowerCase());
  if (existingSchool) {
    return res.status(409).json({
      error: 'SCHOOL_EXISTS',
      message: 'A school with this official email address is already registered.',
    });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail.toLowerCase());
  if (existingUser) {
    return res.status(409).json({
      error: 'USER_EXISTS',
      message: 'A user account with this proprietor email address already exists. Please log in or use another email.',
    });
  }

  const schoolId = 'sch_' + crypto.randomUUID().slice(0, 8);
  const userId = 'usr_' + crypto.randomUUID().slice(0, 8);
  const settingsId = 'set_' + crypto.randomUUID().slice(0, 8);
  const userRoleId = 'ur_' + crypto.randomUUID().slice(0, 8);

  const baseSlug = slugify(schoolName);
  const slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;

  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);

  try {
    // Atomic registration
    db.exec('BEGIN TRANSACTION;');

    // 1. Insert School (Tenant)
    db.prepare(`
      INSERT INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website)
      VALUES (?, ?, ?, ?, 'TRIAL', ?, ?, ?, ?, ?, ?)
    `).run(
      schoolId,
      schoolName.trim(),
      slug,
      schoolType,
      address || '',
      state,
      lga,
      phone,
      schoolEmail.toLowerCase(),
      req.body.website || null
    );

    // 2. Initialize School Settings
    db.prepare(`
      INSERT INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email, payment_notification_sms, portal_subdomain)
      VALUES (?, ?, 'NGN', '₦', '2024/2025', '1st Term', ?, 0, ?)
    `).run(settingsId, schoolId, schoolEmail.toLowerCase(), baseSlug);

    // 3. Insert School Owner User
    db.prepare(`
      INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1)
    `).run(
      userId,
      ownerEmail.toLowerCase(),
      passwordHash,
      salt,
      ownerName.trim(),
      phone
    );

    // 4. Link Owner to School with SCHOOL_OWNER role
    db.prepare(`
      INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
      VALUES (?, ?, ?, 'role_school_owner', 1)
    `).run(userRoleId, userId, schoolId);

    db.exec('COMMIT;');

    // Create session
    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    const token = createSession(userId, schoolId, clientIp, req.headers['user-agent']);

    // Record Audit Log
    logAudit({
      actorId: userId,
      actorEmail: ownerEmail.toLowerCase(),
      schoolId,
      action: 'REGISTER_SCHOOL',
      entity: 'SCHOOL',
      entityId: schoolId,
      ipAddress: clientIp,
      metadata: { schoolName, schoolType, state, lga },
    });

    return res.status(201).json({
      success: true,
      message: 'School tenant and proprietor account registered successfully!',
      token,
      user: {
        id: userId,
        email: ownerEmail.toLowerCase(),
        full_name: ownerName.trim(),
        is_platform_admin: 0,
      },
      school: {
        id: schoolId,
        name: schoolName.trim(),
        slug,
        type: schoolType,
        status: 'TRIAL',
        state,
        lga,
        phone,
        email: schoolEmail.toLowerCase(),
      },
      activeRole: {
        role_name: 'SCHOOL_OWNER',
        role_display_name: 'School Proprietor / Owner',
        scope: 'SCHOOL',
      },
    });
  } catch (error: any) {
    db.exec('ROLLBACK;');
    console.error('[Registration Error]', error);
    return res.status(500).json({
      error: 'REGISTRATION_FAILED',
      message: 'Failed to complete registration: ' + (error?.message || 'Database error'),
    });
  }
});

// POST /api/v1/auth/login
apiRouter.post('/v1/auth/login', (req, res) => {
  const { email, password, schoolId } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'MISSING_CREDENTIALS', message: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase()) as UserRecord | undefined;
  if (!user) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email address or password.' });
  }

  const isValid = verifyPassword(password, user.password_hash, user.salt);
  if (!isValid) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email address or password.' });
  }

  // Fetch all user roles and schools
  const roles = db.prepare(`
    SELECT ur.*, r.name as role_name, r.display_name as role_display_name, r.scope as role_scope,
           s.name as school_name, s.status as school_status, s.slug as school_slug
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    LEFT JOIN schools s ON ur.school_id = s.id
    WHERE ur.user_id = ?
  `).all(user.id) as any[];

  // Determine active school tenant context
  let activeSchoolId: string | null = null;
  let activeRole = roles[0] || null;

  if (user.is_platform_admin === 1) {
    // Super admin default context is platform-level
    activeSchoolId = null;
  } else if (schoolId) {
    // Verify user belongs to this specified school
    const matched = roles.find((r) => r.school_id === schoolId);
    if (!matched) {
      return res.status(403).json({ error: 'TENANT_UNAUTHORIZED', message: 'You do not belong to this school.' });
    }
    activeSchoolId = schoolId;
    activeRole = matched;
  } else {
    // Default to the first available school
    const firstSchoolRole = roles.find((r) => r.school_id !== null);
    if (firstSchoolRole) {
      activeSchoolId = firstSchoolRole.school_id;
      activeRole = firstSchoolRole;
    }
  }

  const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
  const token = createSession(user.id, activeSchoolId, clientIp, req.headers['user-agent']);

  // Audit log login
  logAudit({
    actorId: user.id,
    actorEmail: user.email,
    schoolId: activeSchoolId,
    action: 'LOGIN',
    entity: 'AUTH_SESSION',
    ipAddress: clientIp,
    metadata: {
      isSuperAdmin: user.is_platform_admin === 1,
      role: activeRole?.role_name || 'UNKNOWN',
    },
  });

  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      is_platform_admin: user.is_platform_admin,
    },
    activeSchoolId,
    activeRole,
    roles,
  });
});

// POST /api/v1/auth/logout
apiRouter.post('/v1/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.headers['x-session-token'] as string);

  if (token) {
    destroySession(token);
  }

  if (req.user) {
    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId: req.activeSchoolId,
      action: 'LOGOUT',
      entity: 'AUTH_SESSION',
      ipAddress: clientIp,
    });
  }

  return res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/v1/auth/me
apiRouter.get('/v1/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const roles = req.roles!;

  let activeSchool = null;
  let activeSettings = null;

  if (req.activeSchoolId) {
    activeSchool = db.prepare('SELECT * FROM schools WHERE id = ?').get(req.activeSchoolId);
    activeSettings = db.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(req.activeSchoolId);
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      is_platform_admin: user.is_platform_admin,
    },
    roles,
    activeSchoolId: req.activeSchoolId,
    activeSchool,
    activeSettings,
  });
});

// POST /api/v1/auth/forgot-password
apiRouter.post('/v1/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'MISSING_EMAIL', message: 'Email address is required' });
  }

  const user = db.prepare('SELECT id, email, full_name FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase()) as any;
  if (!user) {
    // For security, don't leak user existence
    return res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been dispatched.',
    });
  }

  const resetToken = 'rst_' + crypto.randomBytes(24).toString('hex');
  const resetId = 'pr_' + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare(`
    INSERT INTO password_resets (id, email, token, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(resetId, user.email, resetToken, expiresAt);

  logAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'PASSWORD_RESET_REQUESTED',
    entity: 'USER_CREDENTIALS',
    entityId: user.id,
    ipAddress: req.ip || '127.0.0.1',
  });

  return res.json({
    success: true,
    message: 'Password reset token generated successfully. In production, this is sent to the registered email address.',
    debugToken: resetToken, // Provided in development for instantaneous testing
  });
});

// POST /api/v1/auth/reset-password
apiRouter.post('/v1/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Reset token and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters long.' });
  }

  const resetRecord = db.prepare(`
    SELECT * FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(token) as any;

  if (!resetRecord) {
    return res.status(400).json({
      error: 'INVALID_TOKEN',
      message: 'This reset token is invalid or has expired. Please request a new link.',
    });
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(newPassword, salt);

  db.exec('BEGIN TRANSACTION;');
  db.prepare(`
    UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?
  `).run(passwordHash, salt, resetRecord.email);

  db.prepare(`
    UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(resetRecord.id);

  // Invalidate all existing sessions for this user for security
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(resetRecord.email) as any;
  if (user) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  }

  db.exec('COMMIT;');

  logAudit({
    actorEmail: resetRecord.email,
    action: 'PASSWORD_RESET_COMPLETED',
    entity: 'USER_CREDENTIALS',
    ipAddress: req.ip || '127.0.0.1',
  });

  return res.json({
    success: true,
    message: 'Your password has been successfully reset. Please sign in with your new password.',
  });
});

// ==============================================================================
// 2. TENANT-PROTECTED SCHOOL MANAGEMENT ROUTES
// ==============================================================================

// GET /api/v1/school/profile
apiRouter.get('/v1/school/profile', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
  const settings = db.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId);

  return res.json({ success: true, school, settings });
});

// PUT /api/v1/school/profile
apiRouter.put(
  '/v1/school/profile',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { name, address, state, lga, phone, email, website, type } = req.body;

    if (!name || !phone || !email || !state || !lga) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Name, phone, email, state, and LGA are required.' });
    }

    // Check email uniqueness if changed
    const existing = db.prepare('SELECT id FROM schools WHERE email = ? AND id != ?').get(email.toLowerCase(), schoolId);
    if (existing) {
      return res.status(409).json({ error: 'EMAIL_IN_USE', message: 'This email is already registered to another school.' });
    }

    db.prepare(`
      UPDATE schools
      SET name = ?, address = ?, state = ?, lga = ?, phone = ?, email = ?, website = ?, type = COALESCE(?, type), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name.trim(), address || '', state, lga, phone, email.toLowerCase(), website || null, type || null, schoolId);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'UPDATE_SCHOOL_PROFILE',
      entity: 'SCHOOL',
      entityId: schoolId,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { name, state, lga, phone },
    });

    const updated = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
    return res.json({ success: true, message: 'School profile updated successfully', school: updated });
  }
);

// GET /api/v1/school/settings
apiRouter.get('/v1/school/settings', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const settings = db.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId);
  return res.json({ success: true, settings });
});

// PUT /api/v1/school/settings
apiRouter.put(
  '/v1/school/settings',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      current_academic_session,
      current_term,
      payment_notification_email,
      payment_notification_sms,
      allow_partial_payments,
    } = req.body;

    db.prepare(`
      UPDATE school_settings
      SET current_academic_session = ?,
          current_term = ?,
          payment_notification_email = ?,
          payment_notification_sms = ?,
          allow_partial_payments = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE school_id = ?
    `).run(
      current_academic_session || '2024/2025',
      current_term || '1st Term',
      payment_notification_email || null,
      payment_notification_sms ? 1 : 0,
      allow_partial_payments !== undefined ? (allow_partial_payments ? 1 : 0) : 1,
      schoolId
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'UPDATE_SCHOOL_SETTINGS',
      entity: 'SCHOOL_SETTINGS',
      entityId: schoolId,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { current_academic_session, current_term },
    });

    const settings = db.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId);
    return res.json({ success: true, message: 'School settings saved', settings });
  }
);

// ==============================================================================
// 2. TENANT-PROTECTED SCHOOL MANAGEMENT ROUTES (STEP 2)
// ==============================================================================

// GET /api/v1/school/stats (Tenant-scoped operational & demographic statistics)
apiRouter.get('/v1/school/stats', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;

  const totalStudents = (db.prepare('SELECT COUNT(*) as c FROM students WHERE school_id = ?').get(schoolId) as any)?.c || 0;
  const activeStudents = (db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ? AND (student_status = 'ACTIVE' OR status = 'ACTIVE')").get(schoolId) as any)?.c || 0;
  const totalClasses = (db.prepare('SELECT COUNT(*) as c FROM classes WHERE school_id = ?').get(schoolId) as any)?.c || 0;
  const totalStaff = (db.prepare('SELECT COUNT(*) as c FROM staff WHERE school_id = ?').get(schoolId) as any)?.c || 0;
  const totalParents = (db.prepare('SELECT COUNT(*) as c FROM parents WHERE school_id = ?').get(schoolId) as any)?.c || 0;

  const activeSessionRow = db.prepare("SELECT name FROM academic_sessions WHERE school_id = ? AND status = 'ACTIVE' LIMIT 1").get(schoolId) as any;
  const activeTermRow = db.prepare("SELECT name FROM terms WHERE school_id = ? AND status = 'ACTIVE' LIMIT 1").get(schoolId) as any;

  const settings = db.prepare('SELECT current_academic_session, current_term FROM school_settings WHERE school_id = ?').get(schoolId) as any;

  const recentStudents = db.prepare(`
    SELECT id, admission_number, full_name, class_name, student_status, created_at
    FROM students
    WHERE school_id = ?
    ORDER BY created_at DESC
    LIMIT 5
  `).all(schoolId);

  return res.json({
    success: true,
    stats: {
      totalStudents,
      activeStudents,
      totalClasses,
      totalStaff,
      totalParents,
      currentAcademicSession: activeSessionRow?.name || settings?.current_academic_session || '2024/2025',
      currentTerm: activeTermRow?.name || settings?.current_term || '1st Term',
      recentStudents,
    },
  });
});

// GET /api/v1/school/students (Search, filter, paginate tenant students)
apiRouter.get('/v1/school/students', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const {
    search,
    class_id,
    class_arm_id,
    gender,
    status,
    academic_session_id,
    page = '1',
    limit = '50',
    sort = 'name_asc',
  } = req.query as Record<string, string>;

  let sql = 'SELECT * FROM students WHERE school_id = ?';
  const params: any[] = [schoolId];

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    sql += ' AND (full_name LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR admission_number LIKE ? OR phone LIKE ? OR email LIKE ?)';
    params.push(s, s, s, s, s, s);
  }

  if (class_id) {
    sql += ' AND class_id = ?';
    params.push(class_id);
  }

  if (class_arm_id) {
    sql += ' AND class_arm_id = ?';
    params.push(class_arm_id);
  }

  if (gender) {
    sql += ' AND gender = ?';
    params.push(gender);
  }

  if (status) {
    sql += ' AND (student_status = ? OR status = ?)';
    params.push(status, status);
  }

  if (academic_session_id) {
    sql += ' AND academic_session_id = ?';
    params.push(academic_session_id);
  }

  // Count total matching
  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as c');
  const total = (db.prepare(countSql).get(...params) as any)?.c || 0;

  // Sorting
  if (sort === 'name_desc') {
    sql += ' ORDER BY full_name DESC';
  } else if (sort === 'admission_asc') {
    sql += ' ORDER BY admission_number ASC';
  } else if (sort === 'admission_desc') {
    sql += ' ORDER BY admission_number DESC';
  } else if (sort === 'date_desc') {
    sql += ' ORDER BY created_at DESC';
  } else {
    sql += ' ORDER BY full_name ASC';
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  sql += ' LIMIT ? OFFSET ?';
  params.push(limitNum, offset);

  const students = db.prepare(sql).all(...params);

  return res.json({
    success: true,
    count: total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum) || 1,
    students,
  });
});

// GET /api/v1/school/students/:id (Detailed student profile with parent contacts)
apiRouter.get('/v1/school/students/:id', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const { id } = req.params;

  // Strict query: MUST match both id AND school_id
  const student = db.prepare(`
    SELECT * FROM students WHERE id = ? AND school_id = ?
  `).get(id, schoolId) as any;

  if (!student) {
    // Check if record exists in another school to detect and log cross-tenant probe
    const crossSchoolCheck = db.prepare('SELECT school_id FROM students WHERE id = ?').get(id) as { school_id: string } | undefined;
    if (crossSchoolCheck && crossSchoolCheck.school_id !== schoolId) {
      const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
      logAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        schoolId,
        action: 'CROSS_TENANT_STUDENT_ACCESS_REJECTED',
        entity: 'STUDENT',
        entityId: id,
        ipAddress: clientIp,
        metadata: {
          attemptedId: id,
          requesterSchool: schoolId,
          targetSchool: crossSchoolCheck.school_id,
        },
      });

      return res.status(403).json({
        error: 'CROSS_TENANT_ACCESS_DENIED',
        message: 'Security Violation: This student record belongs to a different school tenant.',
        code: 'IDOR_PREVENTED',
      });
    }

    return res.status(404).json({ error: 'NOT_FOUND', message: 'Student record not found in your school.' });
  }

  // Fetch linked parents for this student
  const parents = db.prepare(`
    SELECT p.id, p.id as parent_id, p.first_name, p.last_name, (p.first_name || ' ' || p.last_name) as full_name,
           p.phone, p.email, p.occupation, p.address, ps.relationship_type, ps.is_primary_contact
    FROM parent_students ps
    JOIN parents p ON ps.parent_id = p.id
    WHERE ps.student_id = ? AND ps.school_id = ?
  `).all(id, schoolId);

  return res.json({
    success: true,
    student: {
      ...student,
      parents,
    },
  });
});

// POST /api/v1/school/students (Enroll single student)
apiRouter.post(
  '/v1/school/students',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const body = req.body || {};

    const {
      admission_number,
      first_name,
      middle_name = '',
      last_name,
      gender,
      date_of_birth,
      phone,
      email,
      address,
      state,
      nationality = 'Nigerian',
      admission_date = new Date().toISOString().slice(0, 10),
      student_status = 'ACTIVE',
      class_id,
      class_arm_id,
      class_name,
      class_arm_name,
      academic_session_id,
      profile_photo_url,
      emergency_contact,
      medical_notes,
    } = body;

    if (!admission_number || !first_name || !last_name) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'Admission number, first name, and last name are required.',
      });
    }

    // Check duplicate admission number in THIS school
    const existing = db.prepare('SELECT id FROM students WHERE school_id = ? AND admission_number = ?').get(schoolId, admission_number.trim());
    if (existing) {
      return res.status(409).json({
        error: 'DUPLICATE_ADMISSION_NUMBER',
        message: `Admission number "${admission_number}" already exists in your school.`,
      });
    }

    const id = 'stu_' + crypto.randomUUID().slice(0, 10);
    const fullName = `${first_name.trim()} ${middle_name ? middle_name.trim() + ' ' : ''}${last_name.trim()}`.trim();

    db.prepare(`
      INSERT INTO students (
        id, school_id, admission_number, first_name, middle_name, last_name, full_name, gender,
        date_of_birth, phone, email, address, state, nationality, admission_date, student_status,
        class_id, class_arm_id, class_name, class_arm_name, academic_session_id, profile_photo_url,
        emergency_contact, medical_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      schoolId,
      admission_number.trim(),
      first_name.trim(),
      middle_name.trim(),
      last_name.trim(),
      fullName,
      gender || null,
      date_of_birth || null,
      phone || null,
      email ? email.toLowerCase().trim() : null,
      address || null,
      state || null,
      nationality || 'Nigerian',
      admission_date,
      student_status,
      class_id || null,
      class_arm_id || null,
      class_name || null,
      class_arm_name || null,
      academic_session_id || null,
      profile_photo_url || null,
      emergency_contact || null,
      medical_notes || null
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'ENROLL_STUDENT',
      entity: 'STUDENT',
      entityId: id,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { admission_number, full_name: fullName, class_name },
    });

    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Student enrolled successfully', student });
  }
);

// PUT /api/v1/school/students/:id (Update student)
apiRouter.put(
  '/v1/school/students/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    // Check ownership
    const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found.' });
    }
    if (existing.school_id !== schoolId) {
      return res.status(403).json({
        error: 'CROSS_TENANT_ACCESS_DENIED',
        message: 'Security Violation: Cannot modify student of another school.',
      });
    }

    const b = req.body || {};
    const firstName = b.first_name !== undefined ? b.first_name.trim() : existing.first_name;
    const middleName = b.middle_name !== undefined ? b.middle_name.trim() : existing.middle_name;
    const lastName = b.last_name !== undefined ? b.last_name.trim() : existing.last_name;
    const fullName = `${firstName} ${middleName ? middleName + ' ' : ''}${lastName}`.trim();

    // Check admission number uniqueness if changed
    if (b.admission_number && b.admission_number.trim() !== existing.admission_number) {
      const duplicate = db.prepare('SELECT id FROM students WHERE school_id = ? AND admission_number = ? AND id != ?').get(schoolId, b.admission_number.trim(), id);
      if (duplicate) {
        return res.status(409).json({ error: 'DUPLICATE_ADMISSION_NUMBER', message: 'Admission number already in use.' });
      }
    }

    db.prepare(`
      UPDATE students SET
        admission_number = COALESCE(?, admission_number),
        first_name = ?,
        middle_name = ?,
        last_name = ?,
        full_name = ?,
        gender = COALESCE(?, gender),
        date_of_birth = COALESCE(?, date_of_birth),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        state = COALESCE(?, state),
        nationality = COALESCE(?, nationality),
        student_status = COALESCE(?, student_status),
        class_id = COALESCE(?, class_id),
        class_arm_id = COALESCE(?, class_arm_id),
        class_name = COALESCE(?, class_name),
        class_arm_name = COALESCE(?, class_arm_name),
        academic_session_id = COALESCE(?, academic_session_id),
        emergency_contact = COALESCE(?, emergency_contact),
        medical_notes = COALESCE(?, medical_notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(
      b.admission_number?.trim() || null,
      firstName,
      middleName || '',
      lastName,
      fullName,
      b.gender || null,
      b.date_of_birth || null,
      b.phone || null,
      b.email ? b.email.toLowerCase().trim() : null,
      b.address || null,
      b.state || null,
      b.nationality || null,
      b.student_status || null,
      b.class_id || null,
      b.class_arm_id || null,
      b.class_name || null,
      b.class_arm_name || null,
      b.academic_session_id || null,
      b.emergency_contact || null,
      b.medical_notes || null,
      id,
      schoolId
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'UPDATE_STUDENT',
      entity: 'STUDENT',
      entityId: id,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { full_name: fullName },
    });

    const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    return res.json({ success: true, message: 'Student updated successfully', student: updated });
  }
);

// DELETE /api/v1/school/students/:id (Archive or remove student)
apiRouter.delete(
  '/v1/school/students/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found.' });
    }
    if (existing.school_id !== schoolId) {
      return res.status(403).json({
        error: 'CROSS_TENANT_ACCESS_DENIED',
        message: 'Security Violation: Cannot delete student of another school.',
      });
    }

    db.prepare('DELETE FROM parent_students WHERE student_id = ? AND school_id = ?').run(id, schoolId);
    db.prepare('DELETE FROM students WHERE id = ? AND school_id = ?').run(id, schoolId);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'DELETE_STUDENT',
      entity: 'STUDENT',
      entityId: id,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { admission_number: existing.admission_number, full_name: existing.full_name },
    });

    return res.json({ success: true, message: 'Student record deleted successfully' });
  }
);

// POST /api/v1/school/students/import (Bulk CSV Import with duplicate detection)
apiRouter.post(
  '/v1/school/students/import',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { students: rawRows } = req.body;

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'No student records provided for import.' });
    }

    let importedCount = 0;
    let failedCount = 0;
    const errors: { row: number; admission_number?: string; error: string }[] = [];

    // Get existing admission numbers for this school
    const existingAdmissions = new Set(
      (db.prepare('SELECT admission_number FROM students WHERE school_id = ?').all(schoolId) as any[]).map((r) => r.admission_number)
    );

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const adm = (row.admission_number || row['Admission No'] || row['Admission Number'] || '').toString().trim();
      const fn = (row.first_name || row['First Name'] || '').toString().trim();
      const ln = (row.last_name || row['Last Name'] || '').toString().trim();
      const mn = (row.middle_name || row['Middle Name'] || '').toString().trim();
      const gender = (row.gender || row['Gender'] || 'Male').toString().trim();
      const className = (row.class_name || row['Class'] || '').toString().trim();
      const armName = (row.class_arm_name || row['Arm'] || row['Stream'] || '').toString().trim();
      const phone = (row.phone || row['Phone'] || '').toString().trim();
      const email = (row.email || row['Email'] || '').toString().trim();

      if (!adm || !fn || !ln) {
        failedCount++;
        errors.push({ row: i + 1, admission_number: adm, error: 'Missing required admission number, first name, or last name' });
        continue;
      }

      if (existingAdmissions.has(adm)) {
        failedCount++;
        errors.push({ row: i + 1, admission_number: adm, error: `Admission number "${adm}" already exists in this school` });
        continue;
      }

      try {
        const id = 'stu_' + crypto.randomUUID().slice(0, 10);
        const fullName = `${fn} ${mn ? mn + ' ' : ''}${ln}`.trim();

        db.prepare(`
          INSERT INTO students (
            id, school_id, admission_number, first_name, middle_name, last_name, full_name,
            gender, phone, email, class_name, class_arm_name, student_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
        `).run(
          id,
          schoolId,
          adm,
          fn,
          mn,
          ln,
          fullName,
          gender,
          phone || null,
          email ? email.toLowerCase() : null,
          className || null,
          armName || null
        );

        existingAdmissions.add(adm);
        importedCount++;
      } catch (err: any) {
        failedCount++;
        errors.push({ row: i + 1, admission_number: adm, error: err?.message || 'Database insert failed' });
      }
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'BULK_IMPORT_STUDENTS',
      entity: 'STUDENTS',
      ipAddress: req.ip || '127.0.0.1',
      metadata: { importedCount, failedCount, totalRows: rawRows.length },
    });

    return res.json({
      success: true,
      importedCount,
      failedCount,
      errors,
      message: `Successfully imported ${importedCount} student(s). ${failedCount} record(s) failed or were duplicates.`,
    });
  }
);

// GET /api/v1/school/students/export (Tenant-scoped student data export)
apiRouter.get(
  '/v1/school/students/export',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const students = db.prepare(`
      SELECT admission_number, first_name, middle_name, last_name, full_name, gender,
             date_of_birth, phone, email, class_name, class_arm_name, student_status,
             state, admission_date, emergency_contact, created_at
      FROM students
      WHERE school_id = ?
      ORDER BY admission_number ASC
    `).all(schoolId) as any[];

    // Build standard CSV
    const headers = [
      'Admission Number', 'First Name', 'Middle Name', 'Last Name', 'Full Name', 'Gender',
      'Date of Birth', 'Phone', 'Email', 'Class', 'Arm', 'Status', 'State', 'Admission Date', 'Emergency Contact'
    ];

    const csvRows = [headers.join(',')];
    for (const s of students) {
      const row = [
        `"${s.admission_number || ''}"`,
        `"${s.first_name || ''}"`,
        `"${s.middle_name || ''}"`,
        `"${s.last_name || ''}"`,
        `"${s.full_name || ''}"`,
        `"${s.gender || ''}"`,
        `"${s.date_of_birth || ''}"`,
        `"${s.phone || ''}"`,
        `"${s.email || ''}"`,
        `"${s.class_name || ''}"`,
        `"${s.class_arm_name || ''}"`,
        `"${s.student_status || ''}"`,
        `"${s.state || ''}"`,
        `"${s.admission_date || ''}"`,
        `"${s.emergency_contact || ''}"`,
      ];
      csvRows.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=students_${schoolId}.csv`);
    return res.send(csvRows.join('\n'));
  }
);

// ==============================================================================
// PARENTS & GUARDIANS ENDPOINTS
// ==============================================================================

// GET /api/v1/school/parents
apiRouter.get('/v1/school/parents', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const parents = db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM parent_students ps WHERE ps.parent_id = p.id) as total_children
    FROM parents p
    WHERE p.school_id = ?
    ORDER BY p.last_name ASC, p.first_name ASC
  `).all(schoolId) as any[];

  // Join children
  const parentsWithChildren = parents.map((p) => {
    const children = db.prepare(`
      SELECT s.id as student_id, s.admission_number, s.full_name, s.class_name, ps.relationship_type, ps.is_primary_contact
      FROM parent_students ps
      JOIN students s ON ps.student_id = s.id
      WHERE ps.parent_id = ? AND ps.school_id = ?
    `).all(p.id, schoolId);
    return { ...p, children };
  });

  return res.json({ success: true, count: parentsWithChildren.length, parents: parentsWithChildren });
});

// POST /api/v1/school/parents
apiRouter.post(
  '/v1/school/parents',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { first_name, last_name, phone, email, address, occupation, relationship, emergency_contact, student_ids } = req.body;

    if (!first_name || !last_name || !phone) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'First name, last name, and phone are required.' });
    }

    const id = 'par_' + crypto.randomUUID().slice(0, 10);
    db.prepare(`
      INSERT INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      schoolId,
      first_name.trim(),
      last_name.trim(),
      phone.trim(),
      email ? email.toLowerCase().trim() : null,
      address || null,
      occupation || null,
      relationship || 'Parent',
      emergency_contact || null
    );

    // Link students if provided
    if (Array.isArray(student_ids)) {
      for (const sid of student_ids) {
        // Verify student belongs to THIS school
        const student = db.prepare('SELECT id FROM students WHERE id = ? AND school_id = ?').get(sid, schoolId);
        if (student) {
          db.prepare(`
            INSERT OR IGNORE INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact)
            VALUES (?, ?, ?, ?, ?, 1)
          `).run('ps_' + crypto.randomUUID().slice(0, 10), schoolId, id, sid, relationship || 'Parent');
        }
      }
    }

    const parent = db.prepare('SELECT * FROM parents WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Parent record created successfully', parent });
  }
);

// PUT /api/v1/school/parents/:id
apiRouter.put(
  '/v1/school/parents/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM parents WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Parent not found.' });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot edit parent of another school.' });
    }

    const b = req.body || {};
    db.prepare(`
      UPDATE parents SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        occupation = COALESCE(?, occupation),
        relationship = COALESCE(?, relationship),
        emergency_contact = COALESCE(?, emergency_contact),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(
      b.first_name?.trim() || null,
      b.last_name?.trim() || null,
      b.phone?.trim() || null,
      b.email ? b.email.toLowerCase().trim() : null,
      b.address || null,
      b.occupation || null,
      b.relationship || null,
      b.emergency_contact || null,
      id,
      schoolId
    );

    const updated = db.prepare('SELECT * FROM parents WHERE id = ?').get(id);
    return res.json({ success: true, message: 'Parent updated successfully', parent: updated });
  }
);

// DELETE /api/v1/school/parents/:id
apiRouter.delete(
  '/v1/school/parents/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM parents WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Parent not found.' });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot delete parent of another school.' });
    }

    db.prepare('DELETE FROM parent_students WHERE parent_id = ? AND school_id = ?').run(id, schoolId);
    db.prepare('DELETE FROM parents WHERE id = ? AND school_id = ?').run(id, schoolId);

    return res.json({ success: true, message: 'Parent record deleted successfully' });
  }
);

// ==============================================================================
// CLASSES & CLASS ARMS ENDPOINTS
// ==============================================================================

// GET /api/v1/school/classes (Returns classes with arms and student totals)
apiRouter.get('/v1/school/classes', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const classes = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as total_students
    FROM classes c
    WHERE c.school_id = ?
    ORDER BY c.name ASC
  `).all(schoolId) as any[];

  const classesWithArms = classes.map((cls) => {
    const arms = db.prepare(`
      SELECT ca.*,
             (SELECT COUNT(*) FROM students s WHERE s.class_arm_id = ca.id) as total_students,
             (SELECT (first_name || ' ' || last_name) FROM staff st WHERE st.id = ca.class_teacher_id) as class_teacher_name
      FROM class_arms ca
      WHERE ca.class_id = ? AND ca.school_id = ?
      ORDER BY ca.name ASC
    `).all(cls.id, schoolId);
    return { ...cls, arms };
  });

  return res.json({ success: true, count: classesWithArms.length, classes: classesWithArms });
});

// POST /api/v1/school/classes
apiRouter.post(
  '/v1/school/classes',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { name, level, description, academic_session_id } = req.body;

    if (!name || !level) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Class name and level are required.' });
    }

    const id = 'cls_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO classes (id, school_id, name, level, description, academic_session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, schoolId, name.trim(), level.trim(), description || null, academic_session_id || null);

    const created = db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Class created successfully', class: created });
  }
);

// POST /api/v1/school/classes/:id/arms (Create class arm)
apiRouter.post(
  '/v1/school/classes/:id/arms',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: classId } = req.params;
    const { name, capacity = 40, class_teacher_id } = req.body;

    // Verify class belongs to this school
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND school_id = ?').get(classId, schoolId);
    if (!cls) {
      return res.status(404).json({ error: 'CLASS_NOT_FOUND', message: 'Class not found in this school.' });
    }

    if (!name) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Arm name is required (e.g. Gold, A, Science).' });
    }

    const armId = 'arm_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(armId, schoolId, classId, name.trim(), parseInt(capacity, 10) || 40, class_teacher_id || null);

    const arm = db.prepare('SELECT * FROM class_arms WHERE id = ?').get(armId);
    return res.status(201).json({ success: true, message: 'Class arm created successfully', arm });
  }
);

// DELETE /api/v1/school/classes/:id
apiRouter.delete(
  '/v1/school/classes/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const cls = db.prepare('SELECT id, school_id FROM classes WHERE id = ?').get(id) as any;
    if (!cls) return res.status(404).json({ error: 'NOT_FOUND', message: 'Class not found.' });
    if (cls.school_id !== schoolId) {
      return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot delete class of another school.' });
    }

    db.prepare('DELETE FROM class_arms WHERE class_id = ? AND school_id = ?').run(id, schoolId);
    db.prepare('DELETE FROM classes WHERE id = ? AND school_id = ?').run(id, schoolId);

    return res.json({ success: true, message: 'Class deleted successfully' });
  }
);

// ==============================================================================
// STAFF MANAGEMENT ENDPOINTS
// ==============================================================================

// GET /api/v1/school/staff
apiRouter.get('/v1/school/staff', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const staff = db.prepare(`
    SELECT * FROM staff WHERE school_id = ? ORDER BY staff_number ASC
  `).all(schoolId);

  return res.json({ success: true, count: staff.length, staff });
});

// POST /api/v1/school/staff
apiRouter.post(
  '/v1/school/staff',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      staff_number,
      first_name,
      middle_name = '',
      last_name,
      email,
      phone,
      gender,
      address,
      job_title,
      department,
      employment_status = 'ACTIVE',
      date_joined = new Date().toISOString().slice(0, 10),
    } = req.body;

    if (!staff_number || !first_name || !last_name || !email || !phone || !job_title) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'Staff number, name, email, phone, and job title are required.',
      });
    }

    // Check staff number uniqueness in this school
    const existing = db.prepare('SELECT id FROM staff WHERE school_id = ? AND staff_number = ?').get(schoolId, staff_number.trim());
    if (existing) {
      return res.status(409).json({ error: 'DUPLICATE_STAFF_NUMBER', message: 'Staff number already exists in your school.' });
    }

    const id = 'stf_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO staff (
        id, school_id, staff_number, first_name, middle_name, last_name, email, phone,
        gender, address, job_title, department, employment_status, date_joined
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      schoolId,
      staff_number.trim(),
      first_name.trim(),
      middle_name.trim(),
      last_name.trim(),
      email.toLowerCase().trim(),
      phone.trim(),
      gender || null,
      address || null,
      job_title.trim(),
      department || null,
      employment_status,
      date_joined
    );

    const created = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Staff member added successfully', staff: created });
  }
);

// PUT /api/v1/school/staff/:id
apiRouter.put(
  '/v1/school/staff/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Staff member not found.' });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot edit staff of another school.' });
    }

    const b = req.body || {};
    db.prepare(`
      UPDATE staff SET
        staff_number = COALESCE(?, staff_number),
        first_name = COALESCE(?, first_name),
        middle_name = COALESCE(?, middle_name),
        last_name = COALESCE(?, last_name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        gender = COALESCE(?, gender),
        job_title = COALESCE(?, job_title),
        department = COALESCE(?, department),
        employment_status = COALESCE(?, employment_status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(
      b.staff_number?.trim() || null,
      b.first_name?.trim() || null,
      b.middle_name?.trim() || null,
      b.last_name?.trim() || null,
      b.email ? b.email.toLowerCase().trim() : null,
      b.phone?.trim() || null,
      b.gender || null,
      b.job_title?.trim() || null,
      b.department || null,
      b.employment_status || null,
      id,
      schoolId
    );

    const updated = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    return res.json({ success: true, message: 'Staff updated successfully', staff: updated });
  }
);

// DELETE /api/v1/school/staff/:id
apiRouter.delete(
  '/v1/school/staff/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Staff not found.' });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot delete staff of another school.' });
    }

    db.prepare('DELETE FROM staff WHERE id = ? AND school_id = ?').run(id, schoolId);
    return res.json({ success: true, message: 'Staff record deleted successfully' });
  }
);

// ==============================================================================
// ACADEMIC SESSIONS & TERMS ENDPOINTS
// ==============================================================================

// GET /api/v1/school/academic-sessions
apiRouter.get('/v1/school/academic-sessions', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const sessions = db.prepare(`
    SELECT * FROM academic_sessions WHERE school_id = ? ORDER BY name DESC
  `).all(schoolId) as any[];

  const sessionsWithTerms = sessions.map((s) => {
    const terms = db.prepare(`
      SELECT * FROM terms WHERE academic_session_id = ? AND school_id = ? ORDER BY name ASC
    `).all(s.id, schoolId);
    return { ...s, terms };
  });

  return res.json({ success: true, sessions: sessionsWithTerms });
});

// POST /api/v1/school/academic-sessions
apiRouter.post(
  '/v1/school/academic-sessions',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { name, start_date, end_date, status = 'UPCOMING' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Session name is required (e.g. 2025/2026).' });
    }

    if (status === 'ACTIVE') {
      // Deactivate other sessions for this school to enforce single active session rule
      db.prepare("UPDATE academic_sessions SET status = 'COMPLETED' WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);
    }

    const id = 'ses_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, schoolId, name.trim(), start_date || null, end_date || null, status);

    const session = db.prepare('SELECT * FROM academic_sessions WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Academic session created successfully', session });
  }
);

// POST /api/v1/school/academic-sessions/:id/terms
apiRouter.post(
  '/v1/school/academic-sessions/:id/terms',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: sessionId } = req.params;
    const { name, start_date, end_date, status = 'UPCOMING' } = req.body;

    const session = db.prepare('SELECT id FROM academic_sessions WHERE id = ? AND school_id = ?').get(sessionId, schoolId);
    if (!session) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'Academic session not found in your school.' });
    }

    if (!name) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Term name is required (e.g. 1st Term).' });
    }

    if (status === 'ACTIVE') {
      db.prepare("UPDATE terms SET status = 'COMPLETED' WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);
    }

    const termId = 'trm_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(termId, schoolId, sessionId, name.trim(), start_date || null, end_date || null, status);

    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(termId);
    return res.status(201).json({ success: true, message: 'Term created successfully', term });
  }
);

// GET /api/v1/school/fees (Strictly tenant-scoped fees)
apiRouter.get('/v1/school/fees', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const fees = db.prepare('SELECT * FROM fees WHERE school_id = ? ORDER BY name ASC').all(schoolId);
  return res.json({ success: true, count: fees.length, fees });
});

// GET /api/v1/school/users (Users belonging to THIS tenant only)
apiRouter.get('/v1/school/users', requireAuth, requireTenant, (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const users = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.created_at,
           r.name as role_name, r.display_name as role_display_name
    FROM user_roles ur
    JOIN users u ON ur.user_id = u.id
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.school_id = ?
    ORDER BY u.created_at ASC
  `).all(schoolId);

  return res.json({ success: true, users });
});

// GET /api/v1/school/audit-logs (Audit trail for this school tenant only)
apiRouter.get(
  '/v1/school/audit-logs',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const logs = db.prepare(`
      SELECT * FROM audit_logs
      WHERE school_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(schoolId);

    return res.json({ success: true, logs });
  }
);

// ==============================================================================
// 3. SUPER ADMIN PLATFORM ROUTES (PLATFORM LEVEL ONLY)
// ==============================================================================

// GET /api/v1/admin/stats (Platform-wide ecosystem aggregates for Super Admin only)
apiRouter.get('/v1/admin/stats', requireAuth, requireSuperAdmin, (req, res) => {
  const totalSchools = (db.prepare('SELECT COUNT(*) as c FROM schools').get() as any).c;
  const activeSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'ACTIVE'").get() as any).c;
  const trialSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'TRIAL'").get() as any).c;
  const suspendedSchools = (db.prepare("SELECT COUNT(*) as c FROM schools WHERE status IN ('SUSPENDED', 'EXPIRED', 'CANCELLED')").get() as any).c;
  const totalStudents = (db.prepare('SELECT COUNT(*) as c FROM students').get() as any).c;
  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const totalClasses = (db.prepare('SELECT COUNT(*) as c FROM classes').get() as any).c;

  return res.json({
    success: true,
    stats: {
      totalSchools,
      activeSchools,
      trialSchools,
      suspendedSchools,
      totalStudents,
      totalUsers,
      totalClasses,
    },
  });
});

// GET /api/v1/admin/schools
apiRouter.get('/v1/admin/schools', requireAuth, requireSuperAdmin, (req, res) => {
  const schools = db.prepare(`
    SELECT s.*,
           (SELECT COUNT(*) FROM user_roles ur WHERE ur.school_id = s.id) as total_users,
           (SELECT u.full_name FROM user_roles ur JOIN users u ON ur.user_id = u.id WHERE ur.school_id = s.id AND ur.role_id = 'role_school_owner' LIMIT 1) as owner_name,
           (SELECT u.email FROM user_roles ur JOIN users u ON ur.user_id = u.id WHERE ur.school_id = s.id AND ur.role_id = 'role_school_owner' LIMIT 1) as owner_email
    FROM schools s
    ORDER BY s.created_at DESC
  `).all();

  return res.json({ success: true, schools });
});

// GET /api/v1/admin/schools/:schoolId
apiRouter.get('/v1/admin/schools/:schoolId', requireAuth, requireSuperAdmin, (req, res) => {
  const { schoolId } = req.params;
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);

  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'School not found' });
  }

  const settings = db.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId);
  const users = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.phone, u.created_at, r.name as role_name, r.display_name as role_display_name
    FROM user_roles ur
    JOIN users u ON ur.user_id = u.id
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.school_id = ?
  `).all(schoolId);

  const recentLogs = db.prepare(`
    SELECT * FROM audit_logs WHERE school_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(schoolId);

  return res.json({ success: true, school, settings, users, recentLogs });
});

// PATCH /api/v1/admin/schools/:schoolId/status
apiRouter.patch('/v1/admin/schools/:schoolId/status', requireAuth, requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { schoolId } = req.params;
  const { status, reason } = req.body;

  if (!status || !SCHOOL_STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'INVALID_STATUS',
      message: `Status must be one of: ${SCHOOL_STATUSES.join(', ')}`,
    });
  }

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId) as any;
  if (!school) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'School not found' });
  }

  const previousStatus = school.status;
  db.prepare(`
    UPDATE schools SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, schoolId);

  logAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    schoolId,
    action: 'UPDATE_SCHOOL_STATUS',
    entity: 'SCHOOL',
    entityId: schoolId,
    ipAddress: req.ip || '127.0.0.1',
    metadata: { previousStatus, newStatus: status, reason: reason || 'Platform administrator action' },
  });

  return res.json({
    success: true,
    message: `School status updated to ${status}. School data preserved safely.`,
    schoolId,
    status,
  });
});

// GET /api/v1/admin/audit-logs
apiRouter.get('/v1/admin/audit-logs', requireAuth, requireSuperAdmin, (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) || '150', 10), 500);
  const logs = db.prepare(`
    SELECT al.*, s.name as school_name
    FROM audit_logs al
    LEFT JOIN schools s ON al.school_id = s.id
    ORDER BY al.created_at DESC
    LIMIT ?
  `).all(limit);

  return res.json({ success: true, logs });
});

// ==============================================================================
// 4. INTERACTIVE VERIFICATION / IDOR ATTACK SIMULATOR (PROVES TENANT ISOLATION)
// ==============================================================================

// POST /api/v1/test/simulate-idor
// This endpoint allows auditors and developers to simulate a malicious cross-tenant request
apiRouter.post('/v1/test/simulate-idor', requireAuth, (req: AuthenticatedRequest, res) => {
  const { foreignSchoolId } = req.body;

  if (!foreignSchoolId) {
    return res.status(400).json({ error: 'MISSING_PARAM', message: 'foreignSchoolId is required to test isolation' });
  }

  // Attempting to access foreignSchoolId with the current user's session
  req.params.schoolId = foreignSchoolId;

  // Run the tenant guard manually to capture result
  requireTenant(req, res, () => {
    // If execution reached here, it means the user was authorized (e.g. Super Admin or user actually owns it)
    return res.json({
      accessGranted: true,
      message: 'Access permitted because you are either a Super Admin or legitimately belong to this school.',
      schoolId: foreignSchoolId,
    });
  });
});
