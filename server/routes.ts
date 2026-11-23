import { superAdminBackupRouter } from './superAdminExportDownload.ts';
import { cloudSchedulerRouter } from './cloudSchedulerEndpoint.ts';
import express from 'express';
import crypto from 'node:crypto';
import {
  db,
  cacheDb,
  getPgPool,
  isPgConnected,
  getPgStatus,
  queryPg,
  ensurePgConnected,
  getPgEndpointHostPrefix,
  markPgConnected,
  normalizeSubdomainSlug,
} from './db.ts';
import {
  hashPassword,
  generateSalt,
  verifyPassword,
  createSession,
  createSessionAsync,
  destroySession,
  destroySessionAsync,
  type UserRecord,
} from './auth.ts';
import {
  requireAuth,
  requireTenant,
  requireSuperAdmin,
  requireRole,
  type AuthenticatedRequest,
} from './tenantMiddleware.ts';
import { logAudit } from './audit.ts';
import { NIGERIAN_STATES, SCHOOL_TYPES, SCHOOL_STATUSES } from '../src/constants/index.ts';
import { financeRouter } from './financeRoutes.ts';
import { paymentRouter } from './paymentRoutes.ts';
import { adminRouter } from './adminRoutes.ts';
import { schoolBillingRouter } from './schoolBillingRoutes.ts';
import { recoveryRouter } from './recoveryRoutes.ts';
import { dataProtectionRouter } from './dataProtectionRoutes.ts';
import { performanceRouter } from './performanceRoutes.ts';
import { portalRouter } from './portalRoutes.ts';
import { publicPortalRouter, normalizePhoneDigits } from './publicPortalRoutes.ts';
import { publicWebsiteRouter, schoolWebsiteRouter } from './schoolWebsiteRoutes.ts';
import { staffWorkspaceRouter } from './staffWorkspaceRoutes.ts';
import { cbtRouter } from './cbtRoutes.ts';
import {
  getCurrentNigerianCalendar,
  generateNextAdmissionNumber,
  createBatchAdmissionAllocator,
  assignMissingAdmissionNumbersForSchool,
} from './admissionNumberService.ts';
import {
  generateNextStaffCode,
  assignMissingStaffCodesForSchool,
} from './staffCodeService.ts';
import {
  ADMIN_ONLY_ROLES,
  DIRECTORY_READ_ROLES,
  ACADEMIC_READ_ROLES,
  canAccessStudent,
} from './accessControl.ts';
import { handlePaymentWebhook, handleBachsWebhook, handleBachsDemoCheckout, handleBachsDemoCheckoutComplete } from './webhookHandler.ts';
import { sanitizeCsvCell, safeClientError } from './securityUtils.ts';
import {
  resolveInstitutionProfile,
  NUC_5_POINT_SCALE,
  NBTE_4_POINT_SCALE,
} from '../src/utils/institutionMode.ts';

export const apiRouter = express.Router();

for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all'] as const) {
  const orig = (apiRouter as any)[method].bind(apiRouter);
  (apiRouter as any)[method] = (path: any, ...handlers: any[]) =>
    orig(
      path,
      ...handlers.map((fn) =>
        typeof fn === 'function' && fn.length < 4
          ? (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next)
          : fn
      )
    );
}

// Public Health Check Endpoint (No Auth Required)
apiRouter.get('/health', async (_req, res) => {
  if (getPgPool() && !isPgConnected()) {
    try {
      await ensurePgConnected();
    } catch {}
  }
  const rawPgStatus = getPgStatus() as Record<string, any>;
  const { databaseUser: _u, databaseName: _n, ...safePgStatus } = rawPgStatus || {};
  return res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: {
      provider: isPgConnected() ? 'Neon PostgreSQL' : 'Local SQLite',
      connected: isPgConnected(),
      pgStatus: safePgStatus,
      hasEnvUrl: Boolean(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL),
      neonEndpoint: getPgEndpointHostPrefix(),
    },
    neonConnected: isPgConnected(),
    neonEndpoint: getPgEndpointHostPrefix(),
    service: 'BursarIQ Backend Engine',
    commit: process.env.RENDER_GIT_COMMIT || 'local',
  });
});

// Mount Data Protection, Automated Backups, and School Tenant Recycle Bin
apiRouter.use('/v1', superAdminBackupRouter);
apiRouter.use('/', superAdminBackupRouter);
apiRouter.use('/v1', cloudSchedulerRouter);
apiRouter.use('/', cloudSchedulerRouter);
apiRouter.use('/v1', dataProtectionRouter);
apiRouter.use('/', dataProtectionRouter);

// Mount Comprehensive Account Recovery & Security Router
apiRouter.use('/v1/auth', recoveryRouter);
apiRouter.use('/auth', recoveryRouter);

// Dedicated Bachs.io Webhook Endpoint: POST /api/webhooks/bachs
apiRouter.post('/webhooks/bachs', handleBachsWebhook);

// Mount Step 5 Platform Super Admin module on both /v1/admin and /admin
apiRouter.use('/v1/admin', adminRouter);
apiRouter.use('/admin', adminRouter);

// Mount SaaS School Billing & Subscription module
apiRouter.use('/v1/school/billing', schoolBillingRouter);

// Mount Step 4 Payments, Receipts & Notifications module
apiRouter.use('/v1/school', paymentRouter);

// Mount Step 3 Financial Management module
apiRouter.use('/v1/school', financeRouter);

// Mount Performance, Attendance, Behaviour, Report Cards & Announcements module
apiRouter.use('/v1/school', performanceRouter);

// Mount Parent & Student Read-Only Portals
apiRouter.use('/v1/portal', portalRouter);

// Mount Unauthenticated Public School Portal Directory, Verification & Self-Activation
apiRouter.use('/v1/public', publicPortalRouter);
apiRouter.use('/v1/public', publicWebsiteRouter);

// Mount School Website CMS & Timetable Manager
apiRouter.use('/v1/school/website', schoolWebsiteRouter);

// Mount Dedicated Staff-Only Workspace (Lesson Notes, Confidential Notices, Requests)
apiRouter.use('/v1/staff-workspace', staffWorkspaceRouter);

// Mount Computer-Based Testing (CBT) Examination Engine (Admin, Staff, Student, Parent)
apiRouter.use('/v1/cbt', cbtRouter);

// Public Webhook receiver for payment gateways (Bachs, Paystack, Flutterwave, Sandbox)
apiRouter.post('/v1/webhooks/payments/:provider', handlePaymentWebhook);
apiRouter.post('/v1/webhooks/platform-payments/:provider', handlePaymentWebhook);

// Bachs Demo Checkout Simulator Endpoints
apiRouter.get('/v1/webhooks/bachs-demo-checkout', handleBachsDemoCheckout);
apiRouter.post('/v1/webhooks/bachs-demo-checkout/complete', express.urlencoded({ extended: true }), handleBachsDemoCheckoutComplete);


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

// POST /api/v1/auth/register-school and /api/v1/auth/register
apiRouter.post(['/v1/auth/register-school', '/v1/auth/register'], async (req, res) => {
  const {
    schoolName,
    schoolType = 'MIXED',
    state,
    lga = 'Default LGA',
    address = 'Nigeria',
    phone,
    email: schoolEmail,
    ownerName,
    ownerEmail,
    password,
    question1,
    answer1,
    question2,
    answer2,
    recoveryEmail,
    recoveryPhone,
    institutionCategory,
    academicCycleType,
    cycleLabels,
    gradingMode,
    terminology,
  } = req.body;

  // 1. Input Validation
  if (!schoolName || !state || !phone || !schoolEmail || !ownerName || !ownerEmail || !password) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'All fields marked with an asterisk are required for school registration.',
    });
  }

  // Bank-grade validation: Security questions are required for disaster recovery and account protection
  if (!question1 || !answer1 || !question2 || !answer2) {
    return res.status(400).json({
      error: 'MISSING_SECURITY_QUESTIONS',
      message: 'Two distinct security questions and answers are required to secure your school account.',
    });
  }

  if (question1.trim().toLowerCase() === question2.trim().toLowerCase()) {
    return res.status(400).json({
      error: 'DUPLICATE_SECURITY_QUESTIONS',
      message: 'Please choose two different security questions for your account recovery.',
    });
  }

  if (answer1.trim().length < 2 || answer2.trim().length < 2) {
    return res.status(400).json({
      error: 'INVALID_SECURITY_ANSWERS',
      message: 'Security answers must be at least 2 characters each.',
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

  // Check if school email or owner email already exists in authoritative Neon PostgreSQL (MANDATORY)
  const pool = getPgPool();
  if (pool) {
    if (!isPgConnected()) {
      try {
        await ensurePgConnected();
      } catch {}
    }
    try {
      const checkSchool = await queryPg('SELECT id FROM schools WHERE LOWER(email) = $1', [schoolEmail.toLowerCase()]);
      if (checkSchool.rows.length > 0) {
        return res.status(409).json({
          error: 'SCHOOL_EXISTS',
          message: 'A school with this official email address is already registered.',
        });
      }
      const checkUser = await queryPg('SELECT id FROM users WHERE LOWER(email) = $1', [ownerEmail.toLowerCase()]);
      if (checkUser.rows.length > 0) {
        return res.status(409).json({
          error: 'USER_EXISTS',
          message: 'A user account with this proprietor email address already exists. Please log in or use another email.',
        });
      }
    } catch (e: any) {
      console.error('[Registration Pre-Check Error]', e.message);
      return res.status(503).json({
        error: 'DATABASE_ERROR',
        message: 'Unable to verify email availability with the authoritative cloud database: ' + (e?.message || 'Database error'),
      });
    }
  } else if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL) {
    return res.status(503).json({
      error: 'DATABASE_UNAVAILABLE',
      message: 'Authoritative database service is currently initializing. Please retry in a moment.',
    });
  }

  const schoolId = 'sch_' + crypto.randomUUID().slice(0, 8);
  const userId = 'usr_' + crypto.randomUUID().slice(0, 8);
  const settingsId = 'set_' + crypto.randomUUID().slice(0, 8);
  const userRoleId = 'ur_' + crypto.randomUUID().slice(0, 8);

  const baseSlug = slugify(schoolName);
  const slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;

  // Guarantee globally unique portal_subdomain for the new school's website
  let portalSubdomain = normalizeSubdomainSlug(baseSlug);
  const reservedSubs = new Set(['www', 'app', 'api', 'admin', 'superadmin', 'mail', 'smtp', 'portal', 'bursariq']);
  if (reservedSubs.has(portalSubdomain) || portalSubdomain.length < 3) {
    portalSubdomain = `${portalSubdomain}-sch`;
  }
  try {
    let suffix = 2;
    while (true) {
      let exists = false;
      if (pool) {
        const subCheck = await queryPg(
          'SELECT school_id FROM school_settings WHERE LOWER(portal_subdomain) = LOWER($1) LIMIT 1',
          [portalSubdomain]
        );
        exists = subCheck.rows.length > 0;
      } else {
        exists = Boolean(
          cacheDb
            .prepare('SELECT school_id FROM school_settings WHERE LOWER(portal_subdomain) = LOWER(?) LIMIT 1')
            .get(portalSubdomain)
        );
      }
      if (!exists && !reservedSubs.has(portalSubdomain)) break;
      portalSubdomain = `${normalizeSubdomainSlug(baseSlug).slice(0, 35)}-${suffix}`;
      suffix++;
    }
  } catch {}

  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);

  // Bank-grade independent cryptographic hashing for security answers
  const normalizeAns = (a: string) => (a || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const salt1 = generateSalt();
  const answerHash1 = hashPassword(normalizeAns(answer1), salt1);
  const salt2 = generateSalt();
  const answerHash2 = hashPassword(normalizeAns(answer2), salt2);

  const subId = `sub_${crypto.randomBytes(6).toString('hex')}`;
  const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const instProfile = resolveInstitutionProfile(
    { type: schoolType },
    {
      institution_category: institutionCategory || undefined,
      academic_cycle_type: academicCycleType || undefined,
      cycle_labels_json: Array.isArray(cycleLabels) ? JSON.stringify(cycleLabels) : typeof cycleLabels === 'string' ? cycleLabels : undefined,
      grading_mode: gradingMode || undefined,
      terminology_json: terminology ? (typeof terminology === 'string' ? terminology : JSON.stringify(terminology)) : undefined,
    }
  );
  const nigeriaCal = getCurrentNigerianCalendar();
  const initialActivePeriod = instProfile.isTertiary
    ? (instProfile.cycleLabels[0] || '1st Semester')
    : instProfile.cycleType === 'SEMESTER'
      ? (instProfile.cycleLabels[0] || '1st Semester')
      : instProfile.cycleType === 'TRIMESTER'
        ? (instProfile.cycleLabels[0] || '1st Trimester')
        : nigeriaCal.termShort;
  const cycleLabelsJson = JSON.stringify(instProfile.cycleLabels);
  const terminologyJson = JSON.stringify(instProfile.labels);
  const defaultHeroSubtitle = instProfile.isTertiary
    ? `Advancing higher education, applied research, and professional excellence in ${lga ? `${lga}, ` : ''}${state}.`
    : `Preparing confident, disciplined, and academically distinguished learners in ${lga ? `${lga}, ` : ''}${state}.`;
  const defaultAboutBody = instProfile.isTertiary
    ? `${schoolName.trim()} delivers accredited academic programmes, structured semester assessments, digital course management, and transparent bursary operations.`
    : `${schoolName.trim()} is committed to strong academic standards, moral character, structured continuous assessment, and transparent family partnerships.`;
  const defaultVision = instProfile.isTertiary
    ? `To produce globally competitive graduates, researchers, and professionals equipped for leadership and societal impact.`
    : `To raise globally competitive, morally grounded students equipped for lifelong excellence.`;
  const defaultMission = instProfile.isTertiary
    ? `To deliver rigorous higher education supported by dedicated faculty, modern CBT assessment, and transparent digital academic transcripts.`
    : `To deliver structured NERDC-aligned instruction supported by dedicated staff and transparent digital school records.`;
  const defaultAdmissionsSummary = instProfile.isTertiary
    ? `Admissions are open across eligible departments and programmes. Prospective applicants can submit an inquiry below or contact the Admissions Registry.`
    : `Admissions are open across eligible classes. Submit an inquiry below or visit our Admissions Office.`;

  // STEP 1: Authoritative Neon PostgreSQL Persistence First
  if (pool) {
    let pgClient: any = null;
    try {
      pgClient = await pool.connect();
    } catch (connErr: any) {
      console.error('[Registration Neon PG Connection Failed]', connErr?.message);
      return res.status(503).json({
        error: 'DATABASE_CONNECT_FAILED',
        message: 'Could not connect to the authoritative cloud database. Registration aborted to protect your account from loss.',
      });
    }

    try {
      await pgClient.query('BEGIN');

      // 1. Schools (Tenant)
      await pgClient.query(
        `INSERT INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website, current_plan_id)
          VALUES ($1, $2, $3, $4, 'TRIAL', $5, $6, $7, $8, $9, $10, 'plan_trial')
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, current_plan_id = 'plan_trial'`,
        [schoolId, schoolName.trim(), slug, schoolType, address || '', state, lga, phone, schoolEmail.toLowerCase(), req.body.website || null]
      );

      // 2. School Settings (with active Nigerian academic session, term/semester & institution profile)
      await pgClient.query(
        `INSERT INTO school_settings (
            id, school_id, currency, currency_symbol, current_academic_session, current_term,
            payment_notification_email, payment_notification_sms, portal_subdomain,
            institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json
          )
          VALUES ($1, $2, 'NGN', '₦', $3, $4, $5, 0, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO NOTHING`,
        [
          settingsId,
          schoolId,
          nigeriaCal.sessionName,
          initialActivePeriod,
          schoolEmail.toLowerCase(),
          portalSubdomain,
          instProfile.category,
          instProfile.cycleType,
          cycleLabelsJson,
          instProfile.gradingMode,
          terminologyJson,
        ]
      );

      // 2b. Default Branded School Website Profile
      await pgClient.query(
        `INSERT INTO school_website_profiles (
           id, school_id, tagline, hero_title, hero_subtitle, theme_accent,
           about_title, about_body, vision, mission, core_values,
           admissions_open, admissions_summary, is_published
         ) VALUES ($1, $2, $3, $4, $5, 'emerald', $6, $7, $8, $9, $10, 1, $11, 1)
         ON CONFLICT (school_id) DO NOTHING`,
        [
          `web_${schoolId}`,
          schoolId,
          `Excellence in Nigerian ${schoolType} Education`,
          `Welcome to ${schoolName.trim()}`,
          defaultHeroSubtitle,
          `About ${schoolName.trim()}`,
          defaultAboutBody,
          defaultVision,
          defaultMission,
          `Integrity · Academic Rigour · Discipline · Innovation · Community`,
          defaultAdmissionsSummary,
        ]
      );

      // 3. User & Owner Profile
      await pgClient.query(
        `INSERT INTO users (
          id, email, password_hash, salt, full_name, phone,
          security_question_1, security_answer_hash_1, security_answer_salt_1,
          security_question_2, security_answer_hash_2, security_answer_salt_2,
          recovery_email, recovery_phone,
          is_platform_admin, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0, 1)
        ON CONFLICT (id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          security_question_1 = EXCLUDED.security_question_1,
          security_answer_hash_1 = EXCLUDED.security_answer_hash_1,
          security_answer_salt_1 = EXCLUDED.security_answer_salt_1,
          security_question_2 = EXCLUDED.security_question_2,
          security_answer_hash_2 = EXCLUDED.security_answer_hash_2,
          security_answer_salt_2 = EXCLUDED.security_answer_salt_2,
          recovery_email = EXCLUDED.recovery_email,
          recovery_phone = EXCLUDED.recovery_phone,
          is_active = 1`,
        [
          userId,
          ownerEmail.toLowerCase(),
          passwordHash,
          salt,
          ownerName.trim(),
          phone,
          question1.trim(),
          answerHash1,
          salt1,
          question2.trim(),
          answerHash2,
          salt2,
          recoveryEmail?.trim().toLowerCase() || null,
          recoveryPhone?.trim() || null,
        ]
      );

      // 4. User Roles
      await pgClient.query(
        `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
          VALUES ($1, $2, $3, 'role_school_owner', 1)
          ON CONFLICT (user_id, school_id, role_id) DO UPDATE SET is_primary = 1`,
        [userRoleId, userId, schoolId]
      );

      // 5. School Subscriptions (with both amount_paid_kobo and amount_paid)
      await pgClient.query(
        `INSERT INTO school_subscriptions (id, school_id, plan_id, status, start_date, end_date, trial_end_date, amount_paid_kobo, amount_paid, notes)
          VALUES ($1, $2, 'plan_trial', 'TRIAL', CURRENT_DATE, $3, $4, 0, 0, 'Self-registered school trial')
          ON CONFLICT (id) DO NOTHING`,
        [subId, schoolId, subEnd, subEnd]
      );

      // 5b. Seed Tertiary-appropriate academic grading scale & CA/Exam split (after users row exists for updated_by FK)
      if (instProfile.isTertiary) {
        const tertiaryScale = (instProfile.gradingMode === 'GPA_4' ? NBTE_4_POINT_SCALE : NUC_5_POINT_SCALE).map((b) => ({
          grade: b.grade,
          min: b.min,
          max: b.max,
          remark: b.remark,
        }));
        await pgClient.query(
          `INSERT INTO school_academic_settings (
             id, school_id, ca_max_score, exam_max_score, grading_scale_json,
             missing_score_policy, show_class_position, students_can_view_fees, teachers_can_view_fees,
             require_review_before_approve, updated_by, created_at, updated_at
           ) VALUES ($1, $2, 30, 70, $3, 'EXCLUDE', 0, 1, 0, 0, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (school_id) DO NOTHING`,
          [`acad_set_${schoolId}`, schoolId, JSON.stringify(tertiaryScale), userId]
        );
      }

      // Verify all records committed
      const vSch = await pgClient.query('SELECT id FROM schools WHERE id = $1', [schoolId]);
      const vUsr = await pgClient.query('SELECT id FROM users WHERE id = $1', [userId]);
      if (vSch.rows.length === 0 || vUsr.rows.length === 0) {
        throw new Error('Verification of newly inserted school records in cloud database failed');
      }

      await pgClient.query('COMMIT');
      markPgConnected();
    } catch (pgErr: any) {
      try {
        await pgClient.query('ROLLBACK');
      } catch {}
      console.error('[Registration PG Error - Critical]', pgErr);
      return res.status(500).json({
        error: 'REGISTRATION_TRANSACTION_FAILED',
        message: 'Failed to persist school account in authoritative database: ' + (pgErr?.message || 'Database transaction error'),
      });
    } finally {
      if (pgClient) pgClient.release();
    }
  }

  // STEP 2: Replicate into local SQLite read-cache safely (ON CONFLICT DO UPDATE)
  try {
    cacheDb.prepare(`
      INSERT INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website, current_plan_id)
      VALUES (?, ?, ?, ?, 'TRIAL', ?, ?, ?, ?, ?, ?, 'plan_trial')
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        slug = excluded.slug,
        type = excluded.type,
        status = excluded.status,
        address = excluded.address,
        state = excluded.state,
        lga = excluded.lga,
        phone = excluded.phone,
        email = excluded.email,
        website = excluded.website,
        current_plan_id = excluded.current_plan_id
    `).run(
      schoolId, schoolName.trim(), slug, schoolType, address || '', state, lga, phone, schoolEmail.toLowerCase(), req.body.website || null
    );
    cacheDb.prepare(`
      INSERT INTO school_settings (
        id, school_id, currency, currency_symbol, current_academic_session, current_term,
        payment_notification_email, payment_notification_sms, portal_subdomain,
        institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json
      )
      VALUES (?, ?, 'NGN', '₦', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        currency = excluded.currency,
        currency_symbol = excluded.currency_symbol,
        current_academic_session = excluded.current_academic_session,
        current_term = excluded.current_term,
        payment_notification_email = excluded.payment_notification_email,
        portal_subdomain = excluded.portal_subdomain,
        institution_category = excluded.institution_category,
        academic_cycle_type = excluded.academic_cycle_type,
        cycle_labels_json = excluded.cycle_labels_json,
        grading_mode = excluded.grading_mode,
        terminology_json = excluded.terminology_json
    `).run(
      settingsId,
      schoolId,
      nigeriaCal.sessionName,
      initialActivePeriod,
      schoolEmail.toLowerCase(),
      portalSubdomain,
      instProfile.category,
      instProfile.cycleType,
      cycleLabelsJson,
      instProfile.gradingMode,
      terminologyJson
    );
    cacheDb.prepare(`
      INSERT OR IGNORE INTO school_website_profiles (
        id, school_id, tagline, hero_title, hero_subtitle, theme_accent,
        about_title, about_body, vision, mission, core_values,
        admissions_open, admissions_summary, is_published
      ) VALUES (?, ?, ?, ?, ?, 'emerald', ?, ?, ?, ?, ?, 1, ?, 1)
    `).run(
      `web_${schoolId}`,
      schoolId,
      `Excellence in Nigerian ${schoolType} Education`,
      `Welcome to ${schoolName.trim()}`,
      defaultHeroSubtitle,
      `About ${schoolName.trim()}`,
      defaultAboutBody,
      defaultVision,
      defaultMission,
      `Integrity · Academic Rigour · Discipline · Innovation · Community`,
      defaultAdmissionsSummary
    );
    cacheDb.prepare(`
      INSERT INTO users (
        id, email, password_hash, salt, full_name, phone,
        security_question_1, security_answer_hash_1, security_answer_salt_1,
        security_question_2, security_answer_hash_2, security_answer_salt_2,
        recovery_email, recovery_phone,
        is_platform_admin, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        password_hash = excluded.password_hash,
        salt = excluded.salt,
        full_name = excluded.full_name,
        phone = excluded.phone,
        security_question_1 = excluded.security_question_1,
        security_answer_hash_1 = excluded.security_answer_hash_1,
        security_answer_salt_1 = excluded.security_answer_salt_1,
        security_question_2 = excluded.security_question_2,
        security_answer_hash_2 = excluded.security_answer_hash_2,
        security_answer_salt_2 = excluded.security_answer_salt_2,
        recovery_email = excluded.recovery_email,
        recovery_phone = excluded.recovery_phone,
        is_platform_admin = excluded.is_platform_admin,
        is_active = excluded.is_active
    `).run(
      userId, ownerEmail.toLowerCase(), passwordHash, salt, ownerName.trim(), phone,
      question1.trim(), answerHash1, salt1, question2.trim(), answerHash2, salt2,
      recoveryEmail?.trim().toLowerCase() || null, recoveryPhone?.trim() || null
    );
    cacheDb.prepare(`
      INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
      VALUES (?, ?, ?, 'role_school_owner', 1)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        school_id = excluded.school_id,
        role_id = excluded.role_id,
        is_primary = excluded.is_primary
    `).run(userRoleId, userId, schoolId);
    cacheDb.prepare(`
      INSERT INTO school_subscriptions (id, school_id, plan_id, status, start_date, end_date, trial_end_date, amount_paid, notes)
      VALUES (?, ?, 'plan_trial', 'TRIAL', date('now'), ?, ?, 0, 'Self-registered school trial')
      ON CONFLICT(id) DO UPDATE SET
        school_id = excluded.school_id,
        plan_id = excluded.plan_id,
        status = excluded.status,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        trial_end_date = excluded.trial_end_date,
        amount_paid = excluded.amount_paid
    `).run(subId, schoolId, subEnd, subEnd);
    if (instProfile.isTertiary) {
      const tertiaryScale = (instProfile.gradingMode === 'GPA_4' ? NBTE_4_POINT_SCALE : NUC_5_POINT_SCALE).map((b) => ({
        grade: b.grade,
        min: b.min,
        max: b.max,
        remark: b.remark,
      }));
      cacheDb.prepare(`
        INSERT OR IGNORE INTO school_academic_settings (
          id, school_id, ca_max_score, exam_max_score, grading_scale_json,
          missing_score_policy, show_class_position, students_can_view_fees, teachers_can_view_fees,
          require_review_before_approve, updated_by, created_at, updated_at
        ) VALUES (?, ?, 30, 70, ?, 'EXCLUDE', 0, 1, 0, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(`acad_set_${schoolId}`, schoolId, JSON.stringify(tertiaryScale), userId);
    }
  } catch (sqErr) {
    console.warn('[Registration Local Cache Notice]', sqErr);
  }

  // STEP 3: Create Session Awaited in Neon PG
  const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
  let token: string;
  try {
    token = await createSessionAsync(userId, schoolId, clientIp, req.headers['user-agent']);
  } catch (sessErr: any) {
    console.error('[Registration Session Creation Error]', sessErr?.message);
    return res.status(503).json({
      error: 'SESSION_PERSISTENCE_FAILED',
      message: 'School registered, but session creation failed against database. Please log in.',
    });
  }

  // STEP 4: Record Audit Log
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

  const schoolRecord = {
    id: schoolId,
    name: schoolName.trim(),
    slug,
    type: schoolType,
    status: 'TRIAL',
    address: address || '',
    state,
    lga,
    phone,
    email: schoolEmail.toLowerCase(),
    current_plan_id: 'plan_trial'
  };

  const settingsRecord = {
    id: settingsId,
    school_id: schoolId,
    currency: 'NGN',
    currency_symbol: '₦',
    current_academic_session: nigeriaCal.sessionName,
    current_term: initialActivePeriod,
    payment_notification_email: schoolEmail.toLowerCase(),
    payment_notification_sms: 0,
    portal_subdomain: portalSubdomain,
    allow_partial_payments: 1,
    institution_category: instProfile.category,
    academic_cycle_type: instProfile.cycleType,
    cycle_labels_json: cycleLabelsJson,
    grading_mode: instProfile.gradingMode,
    terminology_json: terminologyJson,
  };

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
    school: schoolRecord,
    settings: settingsRecord,
    activeSchoolId: schoolId,
    activeRole: {
      role_name: 'SCHOOL_OWNER',
      role_display_name: 'School Proprietor / Owner',
      scope: 'SCHOOL',
    },
  });
});

// POST /api/v1/auth/login
apiRouter.post('/v1/auth/login', async (req, res) => {
  const { email, identifier, password, schoolId, schoolSlug } = req.body || {};
  const rawIdentifier = String(identifier || email || '').trim();

  if (!rawIdentifier || !password) {
    return res.status(400).json({ error: 'MISSING_CREDENTIALS', message: 'Email, phone, or admission number and password are required.' });
  }

  const normalizedEmail = rawIdentifier.toLowerCase();
  const isEmailInput = rawIdentifier.includes('@');
  const pgPool = getPgPool();

  // Resolve optional target school ID if schoolSlug or schoolId provided
  let targetSchoolId: string | null = schoolId ? String(schoolId).trim() : null;
  if (!targetSchoolId && schoolSlug) {
    const cleanSlug = String(schoolSlug).trim();
    if (pgPool) {
      try {
        const sRow = (
          await queryPg(
            `SELECT id FROM schools WHERE LOWER(slug) = LOWER($1) AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
            [cleanSlug]
          )
        ).rows[0];
        if (sRow) targetSchoolId = sRow.id;
      } catch {}
    }
    if (!targetSchoolId) {
      const sqS = cacheDb
        .prepare(`SELECT id FROM schools WHERE LOWER(slug) = LOWER(?) AND UPPER(COALESCE(status, 'TRIAL')) != 'CANCELLED' LIMIT 1`)
        .get(cleanSlug) as any;
      if (sqS) targetSchoolId = sqS.id;
    }
    if (!targetSchoolId) {
      return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'Selected school portal was not found.' });
    }
  }

  // 1. Direct Authoritative Neon PostgreSQL lookup first whenever pool is configured
  let user: UserRecord | undefined = undefined;
  let pgLookupFailed = false;
  let studentNotActivated = false;
  let parentNotActivated = false;

  if (pgPool) {
    try {
      if (isEmailInput) {
        // 1a. Direct user email match
        const pgUserRes = await queryPg(
          'SELECT * FROM users WHERE LOWER(email) = $1 AND is_active = 1 LIMIT 1',
          [normalizedEmail]
        );
        if (pgUserRes.rows.length > 0) {
          user = pgUserRes.rows[0] as any;
        } else {
          // 1b. Check if email matches official school email (resolve to primary school owner)
          const schoolOwnerRes = await queryPg(
            `SELECT u.* FROM schools s
             JOIN user_roles ur ON ur.school_id = s.id AND ur.role_id = 'role_school_owner'
             JOIN users u ON u.id = ur.user_id
             WHERE LOWER(s.email) = $1 AND u.is_active = 1
             ORDER BY ur.is_primary DESC, ur.created_at ASC
             LIMIT 1`,
            [normalizedEmail]
          );
          if (schoolOwnerRes.rows.length > 0) {
            user = schoolOwnerRes.rows[0] as any;
          } else if (normalizedEmail === 'superadmin@schoolpay.ng' || normalizedEmail === 'schoolpay28@gmail.com') {
            const saRes = await queryPg(
              "SELECT * FROM users WHERE (LOWER(email) = 'schoolpay28@gmail.com' OR LOWER(email) = 'superadmin@schoolpay.ng') AND is_active = 1 LIMIT 1"
            );
            if (saRes.rows.length > 0) user = saRes.rows[0] as any;
          }
        }
      } else {
        // 1c. Non-email identifier: Check Student Admission Number (within targetSchoolId if provided)
        if (targetSchoolId) {
          const stuRes = await queryPg(
            `SELECT s.id, s.user_id FROM students s
             WHERE s.school_id = $1
               AND LOWER(TRIM(s.admission_number)) = $2
               AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
             LIMIT 1`,
            [targetSchoolId, normalizedEmail]
          );
          if (stuRes.rows.length > 0) {
            const matchedStu = stuRes.rows[0];
            if (!matchedStu.user_id) {
              studentNotActivated = true;
            } else {
              const uRes = await queryPg(
                'SELECT * FROM users WHERE id = $1 AND is_active = 1 LIMIT 1',
                [matchedStu.user_id]
              );
              if (uRes.rows[0]) user = uRes.rows[0] as any;
            }
          }
        }

        // 1d. Phone-number login fallback (strictly checks normalized 10 digits on users AND linked parents)
        const identDigits = normalizePhoneDigits(rawIdentifier);
        if (!user && !studentNotActivated && identDigits.length >= 7) {
          const tail7 = identDigits.slice(-7);
          const candidateSql = targetSchoolId
            ? `SELECT DISTINCT u.* FROM users u
               JOIN user_roles ur ON ur.user_id = u.id
               WHERE ur.school_id = $1 AND u.is_active = 1 AND u.phone IS NOT NULL AND u.phone LIKE $2`
            : `SELECT DISTINCT u.* FROM users u
               WHERE u.is_active = 1 AND u.phone IS NOT NULL AND u.phone LIKE $1`;
          const candidateRows = (
            await queryPg(candidateSql, targetSchoolId ? [targetSchoolId, `%${tail7}%`] : [`%${tail7}%`])
          ).rows;
          let exactMatches = candidateRows.filter((u: any) => normalizePhoneDigits(u.phone) === identDigits);
          if (exactMatches.length === 0) {
            const pSql = targetSchoolId
              ? `SELECT DISTINCT u.*, p.phone AS parent_phone, p.alternate_phone AS parent_alt_phone, p.user_id AS linked_user_id
                 FROM parents p
                 LEFT JOIN users u ON u.id = p.user_id AND u.is_active = 1
                 WHERE p.school_id = $1 AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
                   AND (COALESCE(p.phone, '') LIKE $2 OR COALESCE(p.alternate_phone, '') LIKE $2)`
              : `SELECT DISTINCT u.*, p.phone AS parent_phone, p.alternate_phone AS parent_alt_phone, p.user_id AS linked_user_id
                 FROM parents p
                 LEFT JOIN users u ON u.id = p.user_id AND u.is_active = 1
                 WHERE (p.is_deleted = 0 OR p.is_deleted IS NULL)
                   AND (COALESCE(p.phone, '') LIKE $1 OR COALESCE(p.alternate_phone, '') LIKE $1)`;
            const pRows = (await queryPg(pSql, targetSchoolId ? [targetSchoolId, `%${tail7}%`] : [`%${tail7}%`])).rows;
            const matchedParents = pRows.filter(
              (pr: any) =>
                normalizePhoneDigits(pr.parent_phone) === identDigits ||
                normalizePhoneDigits(pr.parent_alt_phone) === identDigits
            );
            const activeUsersMap = new Map<string, any>();
            for (const pr of matchedParents) {
              if (pr.id) activeUsersMap.set(pr.id, pr);
            }
            if (activeUsersMap.size > 0) {
              exactMatches = Array.from(activeUsersMap.values());
            } else if (matchedParents.some((pr: any) => !pr.linked_user_id)) {
              parentNotActivated = true;
            }
          }
          if (exactMatches.length > 1) {
            return res.status(400).json({
              error: 'AMBIGUOUS_PHONE',
              message: 'Multiple accounts share this phone number. Please sign in with your email address or admission number.',
            });
          }
          if (exactMatches.length === 1) {
            user = exactMatches[0] as any;
          }
        }
      }

      // Sync user safely into cacheDb using ON CONFLICT DO UPDATE (never INSERT OR REPLACE)
      if (user) {
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
            user.phone,
            user.is_platform_admin,
            user.is_active,
            user.created_at || new Date().toISOString()
          );
        } catch {}
      }
    } catch (pgErr: any) {
      console.warn('[PostgreSQL Login Query Notice]', pgErr?.message);
      pgLookupFailed = true;
    }
  }

  // 2. Secondary fallback lookup: Local SQLite cache
  if (!user && !studentNotActivated) {
    if (isEmailInput) {
      user = cacheDb.prepare('SELECT * FROM users WHERE LOWER(email) = ? AND is_active = 1').get(normalizedEmail) as UserRecord | undefined;
      if (!user) {
        // Check if official school email in local cache
        const localSchoolOwner = cacheDb.prepare(`
          SELECT u.* FROM schools s
          JOIN user_roles ur ON ur.school_id = s.id AND ur.role_id = 'role_school_owner'
          JOIN users u ON u.id = ur.user_id
          WHERE LOWER(s.email) = ? AND u.is_active = 1
          ORDER BY ur.is_primary DESC
          LIMIT 1
        `).get(normalizedEmail) as UserRecord | undefined;
        if (localSchoolOwner) user = localSchoolOwner;
      }
      if (!user && (normalizedEmail === 'superadmin@schoolpay.ng' || normalizedEmail === 'schoolpay28@gmail.com')) {
        user = cacheDb.prepare("SELECT * FROM users WHERE (LOWER(email) = 'schoolpay28@gmail.com' OR LOWER(email) = 'superadmin@schoolpay.ng') AND is_active = 1").get() as UserRecord | undefined;
      }
    } else {
      if (targetSchoolId) {
        const sqStu = cacheDb
          .prepare(
            `SELECT id, user_id FROM students
             WHERE school_id = ?
               AND LOWER(TRIM(admission_number)) = ?
               AND (is_deleted = 0 OR is_deleted IS NULL)
             LIMIT 1`
          )
          .get(targetSchoolId, normalizedEmail) as any;
        if (sqStu) {
          if (!sqStu.user_id) {
            studentNotActivated = true;
          } else {
            user = cacheDb.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1 LIMIT 1').get(sqStu.user_id) as UserRecord | undefined;
          }
        }
      }

      const identDigits = normalizePhoneDigits(rawIdentifier);
      if (!user && !studentNotActivated && identDigits.length >= 7) {
        const tail7 = identDigits.slice(-7);
        const sqCandidates = (
          targetSchoolId
            ? cacheDb
                .prepare(
                  `SELECT DISTINCT u.* FROM users u
                   JOIN user_roles ur ON ur.user_id = u.id
                   WHERE ur.school_id = ? AND u.is_active = 1 AND u.phone IS NOT NULL AND u.phone LIKE ?`
                )
                .all(targetSchoolId, `%${tail7}%`)
            : cacheDb
                .prepare(
                  `SELECT DISTINCT u.* FROM users u
                   WHERE u.is_active = 1 AND u.phone IS NOT NULL AND u.phone LIKE ?`
                )
                .all(`%${tail7}%`)
        ) as any[];
        let exactMatches = sqCandidates.filter((u) => normalizePhoneDigits(u.phone) === identDigits);
        if (exactMatches.length === 0) {
          const sqPRows = (
            targetSchoolId
              ? cacheDb
                  .prepare(
                    `SELECT DISTINCT u.*, p.phone AS parent_phone, p.user_id AS linked_user_id
                     FROM parents p
                     LEFT JOIN users u ON u.id = p.user_id AND u.is_active = 1
                     WHERE p.school_id = ? AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
                       AND COALESCE(p.phone, '') LIKE ?`
                  )
                  .all(targetSchoolId, `%${tail7}%`)
              : cacheDb
                  .prepare(
                    `SELECT DISTINCT u.*, p.phone AS parent_phone, p.user_id AS linked_user_id
                     FROM parents p
                     LEFT JOIN users u ON u.id = p.user_id AND u.is_active = 1
                     WHERE (p.is_deleted = 0 OR p.is_deleted IS NULL)
                       AND COALESCE(p.phone, '') LIKE ?`
                  )
                  .all(`%${tail7}%`)
          ) as any[];
          const matchedParents = sqPRows.filter((pr) => normalizePhoneDigits(pr.parent_phone) === identDigits);
          const activeMap = new Map<string, any>();
          for (const pr of matchedParents) {
            if (pr.id) activeMap.set(pr.id, pr);
          }
          if (activeMap.size > 0) {
            exactMatches = Array.from(activeMap.values());
          } else if (matchedParents.some((pr) => !pr.linked_user_id)) {
            parentNotActivated = true;
          }
        }
        if (exactMatches.length > 1) {
          return res.status(400).json({
            error: 'AMBIGUOUS_PHONE',
            message: 'Multiple accounts share this phone number. Please sign in with your email address or admission number.',
          });
        }
        if (exactMatches.length === 1) {
          user = exactMatches[0] as UserRecord;
        }
      }
    }
  }

  if (studentNotActivated) {
    return res.status(401).json({
      error: 'PORTAL_NOT_ACTIVATED',
      message: 'This student portal login has not been activated yet. Switch to "Activate Access" using your school details or ask your school admin.',
    });
  }

  if (parentNotActivated) {
    return res.status(401).json({
      error: 'PORTAL_NOT_ACTIVATED',
      message: 'Your parent portal access has not been activated yet. Click "Activate Access" and pick "I am a Parent" to set your personal password.',
    });
  }

  if (!user) {
    if (pgLookupFailed) {
      return res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        message: 'Authoritative database connection is recovering. Please retry in a few moments.',
      });
    }
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid login credentials or password.' });
  }

  const isValid = verifyPassword(password, user.password_hash, user.salt);
  if (!isValid) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid login credentials or password.' });
  }

  // Fetch all user roles and schools (authoritative from Neon PostgreSQL if configured)
  let roles: any[] = [];
  if (pgPool) {
    try {
      const pgRolesRes = await queryPg(
        `SELECT ur.*, r.name as role_name, r.display_name as role_display_name, r.scope as role_scope,
                s.name as school_name, s.status as school_status, s.slug as school_slug
         FROM user_roles ur
         JOIN roles r ON ur.role_id = r.id
         LEFT JOIN schools s ON ur.school_id = s.id
         WHERE ur.user_id = $1
         ORDER BY ur.is_primary DESC, ur.created_at ASC`,
        [user.id]
      );
      if (pgRolesRes.rows.length > 0) {
        roles = pgRolesRes.rows;
        // Keep SQLite cache in sync safely
        for (const r of roles) {
          try {
            if (r.school_id && r.school_name) {
              cacheDb.prepare(`
                INSERT INTO schools (id, name, slug, status)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  slug = excluded.slug,
                  status = excluded.status
              `).run(r.school_id, r.school_name, r.school_slug || 'school', r.school_status || 'TRIAL');
            }
            cacheDb.prepare(`
              INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                user_id = excluded.user_id,
                school_id = excluded.school_id,
                role_id = excluded.role_id,
                is_primary = excluded.is_primary
            `).run(r.id, r.user_id, r.school_id, r.role_id, r.is_primary ? 1 : 0);
          } catch {}
        }
      }
    } catch (e: any) {
      console.warn('[PostgreSQL Login Roles Notice]', e.message);
    }
  }

  // Fallback to SQLite cache if roles not loaded from PG
  if (roles.length === 0) {
    roles = cacheDb.prepare(`
      SELECT ur.*, r.name as role_name, r.display_name as role_display_name, r.scope as role_scope,
             s.name as school_name, s.status as school_status, s.slug as school_slug
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      LEFT JOIN schools s ON ur.school_id = s.id
      WHERE ur.user_id = ?
      ORDER BY ur.is_primary DESC, ur.created_at ASC
    `).all(user.id) as any[];
  }

  // Determine active school tenant context
  let activeSchoolId: string | null = null;
  let activeRole = roles[0] || null;

  if (user.is_platform_admin === 1) {
    // Super admin default context is platform-level
    activeSchoolId = null;
  } else if (targetSchoolId) {
    // Verify user belongs to this specified school
    const matched = roles.find((r) => r.school_id === targetSchoolId);
    if (!matched) {
      return res.status(403).json({ error: 'TENANT_UNAUTHORIZED', message: 'You do not belong to this school.' });
    }
    activeSchoolId = targetSchoolId;
    activeRole = matched;
  } else {
    // Default to the first primary/available school
    const firstSchoolRole = roles.find((r) => r.school_id !== null);
    if (firstSchoolRole) {
      activeSchoolId = firstSchoolRole.school_id;
      activeRole = firstSchoolRole;
    }
  }

  const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
  let token: string;
  try {
    token = await createSessionAsync(user.id, activeSchoolId, clientIp, req.headers['user-agent']);
  } catch (sessErr: any) {
    console.error('[Login Session Creation Error]', sessErr?.message);
    return res.status(503).json({
      error: 'SESSION_CREATE_FAILED',
      message: 'Failed to create authenticated session in database. Please try again in a moment.',
    });
  }

  // Pre-load active school and settings authoritatively from Neon PostgreSQL
  let activeSchool = null;
  let activeSettings = null;
  if (activeSchoolId) {
    if (pgPool) {
      try {
        const schRes = await queryPg('SELECT * FROM schools WHERE id = $1', [activeSchoolId]);
        if (schRes.rows.length > 0) activeSchool = schRes.rows[0];
        const setRes = await queryPg('SELECT * FROM school_settings WHERE school_id = $1', [activeSchoolId]);
        if (setRes.rows.length > 0) activeSettings = setRes.rows[0];
      } catch (err: any) {
        console.warn('[Login School Hydration PG Notice]', err?.message);
      }
    }
    if (!activeSchool) {
      activeSchool = cacheDb.prepare('SELECT * FROM schools WHERE id = ?').get(activeSchoolId) || null;
    }
    if (!activeSettings) {
      activeSettings = cacheDb.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(activeSchoolId) || null;
    }
  }

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
    activeSchool,
    activeSettings,
    roles,
  });
});

// POST /api/v1/auth/logout
apiRouter.post('/v1/auth/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : (req.headers['x-session-token'] as string);

  if (token) {
    await destroySessionAsync(token);
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

// POST /api/v1/auth/exit-impersonation
apiRouter.post('/v1/auth/exit-impersonation', requireAuth, async (req: AuthenticatedRequest, res) => {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers['x-session-token']) {
    token = req.headers['x-session-token'] as string;
  }

  if (token) {
    await destroySessionAsync(token);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId: req.activeSchoolId,
      action: 'IMPERSONATION_ENDED',
      entity: 'SUPPORT_SESSION',
      ipAddress: req.ip || '127.0.0.1',
      metadata: { impersonatedBy: req.impersonatedBy },
    });
  }

  return res.json({ success: true, message: 'Support impersonation session safely terminated.' });
});

// GET /api/v1/auth/me
apiRouter.get('/v1/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const roles = req.roles!;

  let effectiveSchoolId = req.activeSchoolId;
  if (!effectiveSchoolId && user.is_platform_admin !== 1 && roles.length > 0) {
    const primary = roles.find((r) => r.is_primary === 1 && r.school_id) || roles.find((r) => r.school_id);
    if (primary && primary.school_id) {
      effectiveSchoolId = primary.school_id;
    }
  }

  let activeSchool: any = null;
  let activeSettings: any = null;

  if (effectiveSchoolId) {
    const pool = getPgPool();
    if (pool) {
      try {
        const schRes = await queryPg('SELECT * FROM schools WHERE id = $1', [effectiveSchoolId]);
        if (schRes.rows.length > 0) {
          activeSchool = schRes.rows[0];
          // Sync into cacheDb
          try {
            cacheDb.prepare(`
              INSERT INTO schools (id, name, slug, status, type, address, state, lga, phone, email, website, current_plan_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                slug = excluded.slug,
                status = excluded.status,
                current_plan_id = excluded.current_plan_id
            `).run(
              activeSchool.id, activeSchool.name, activeSchool.slug, activeSchool.status,
              activeSchool.type || 'MIXED', activeSchool.address || '', activeSchool.state || '',
              activeSchool.lga || '', activeSchool.phone || '', activeSchool.email || '',
              activeSchool.website || null, activeSchool.current_plan_id || 'plan_trial'
            );
          } catch {}
        }
        const setRes = await queryPg('SELECT * FROM school_settings WHERE school_id = $1', [effectiveSchoolId]);
        if (setRes.rows.length > 0) {
          activeSettings = setRes.rows[0];
          try {
            cacheDb.prepare(`
              INSERT INTO school_settings (
                id, school_id, currency, currency_symbol, current_academic_session, current_term,
                portal_subdomain, institution_category, academic_cycle_type,
                cycle_labels_json, grading_mode, terminology_json
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                current_academic_session = excluded.current_academic_session,
                current_term = excluded.current_term,
                portal_subdomain = COALESCE(excluded.portal_subdomain, school_settings.portal_subdomain),
                institution_category = COALESCE(excluded.institution_category, school_settings.institution_category),
                academic_cycle_type = COALESCE(excluded.academic_cycle_type, school_settings.academic_cycle_type),
                cycle_labels_json = COALESCE(excluded.cycle_labels_json, school_settings.cycle_labels_json),
                grading_mode = COALESCE(excluded.grading_mode, school_settings.grading_mode),
                terminology_json = COALESCE(excluded.terminology_json, school_settings.terminology_json)
            `).run(
              activeSettings.id,
              activeSettings.school_id,
              activeSettings.currency || 'NGN',
              activeSettings.currency_symbol || '₦',
              activeSettings.current_academic_session || '2024/2025',
              activeSettings.current_term || '1st Term',
              activeSettings.portal_subdomain || null,
              activeSettings.institution_category || 'K12',
              activeSettings.academic_cycle_type || 'TERM',
              activeSettings.cycle_labels_json || null,
              activeSettings.grading_mode || 'PERCENTAGE',
              activeSettings.terminology_json || null
            );
          } catch {}
        }
      } catch (err: any) {
        console.warn('[/v1/auth/me Neon PG notice]', err?.message);
      }
    }
    if (!activeSchool) {
      activeSchool = cacheDb.prepare('SELECT * FROM schools WHERE id = ?').get(effectiveSchoolId);
    }
    if (!activeSettings) {
      activeSettings = cacheDb.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(effectiveSchoolId);
    }
  }

  const resolvedActiveRole =
    user.is_platform_admin === 1 && !effectiveSchoolId
      ? null
      : roles.find((r) => r.school_id === effectiveSchoolId) || roles[0] || null;

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      is_platform_admin: user.is_platform_admin,
    },
    roles,
    activeRole: resolvedActiveRole,
    activeSchoolId: effectiveSchoolId,
    activeSchool,
    activeSettings,
    impersonatedBy: req.impersonatedBy || null,
  });
});

// POST /api/v1/auth/switch-school (Switch active tenant session for multi-school users)
apiRouter.post('/v1/auth/switch-school', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const roles = req.roles || [];
  const { school_id } = req.body || {};

  if (!school_id || typeof school_id !== 'string') {
    return res.status(400).json({ error: 'MISSING_SCHOOL_ID', message: 'Target school_id is required.' });
  }

  const matchedRole = roles.find((r) => r.school_id === school_id);
  if (user.is_platform_admin !== 1 && !matchedRole) {
    return res.status(403).json({
      error: 'SCHOOL_ACCESS_DENIED',
      message: 'You do not hold an active role in the requested school.',
    });
  }

  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers['x-session-token']) {
    token = req.headers['x-session-token'] as string;
  }

  const pool = getPgPool();
  if (pool && token) {
    try {
      await queryPg('UPDATE sessions SET school_id = $1 WHERE token = $2 AND user_id = $3', [school_id, token, user.id]);
    } catch (e: any) {
      console.warn('[switch-school PG Notice]', e?.message);
    }
  }
  if (token) {
    try {
      cacheDb.prepare('UPDATE sessions SET school_id = ? WHERE token = ? AND user_id = ?').run(school_id, token, user.id);
    } catch {}
  }

  let activeSchool: any = null;
  let activeSettings: any = null;
  if (pool) {
    try {
      const schRes = await queryPg('SELECT * FROM schools WHERE id = $1', [school_id]);
      activeSchool = schRes.rows[0] || null;
      const setRes = await queryPg('SELECT * FROM school_settings WHERE school_id = $1', [school_id]);
      activeSettings = setRes.rows[0] || null;
    } catch {}
  }
  if (!activeSchool) {
    activeSchool = cacheDb.prepare('SELECT * FROM schools WHERE id = ?').get(school_id);
  }
  if (!activeSettings) {
    activeSettings = cacheDb.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(school_id);
  }

  return res.json({
    success: true,
    activeSchoolId: school_id,
    activeRole: matchedRole || null,
    activeSchool,
    activeSettings,
  });
});

// POST /api/v1/auth/exit-school (Clear active school workspace for Platform Super Admin returning to console)
apiRouter.post('/v1/auth/exit-school', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.is_platform_admin !== 1) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Only Platform Super Admins can exit school scope to the Platform Console.',
    });
  }

  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers['x-session-token']) {
    token = req.headers['x-session-token'] as string;
  }

  const pool = getPgPool();
  if (pool && token) {
    try {
      await queryPg('UPDATE sessions SET school_id = NULL WHERE token = $1 AND user_id = $2', [token, user.id]);
    } catch (e: any) {
      console.warn('[exit-school PG Notice]', e?.message);
    }
  }
  if (token) {
    try {
      cacheDb.prepare('UPDATE sessions SET school_id = NULL WHERE token = ? AND user_id = ?').run(token, user.id);
    } catch {}
  }

  return res.json({
    success: true,
    activeSchoolId: null,
    activeRole: null,
    activeSchool: null,
    activeSettings: null,
  });
});

// POST /api/v1/auth/forgot-password
apiRouter.post('/v1/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'MISSING_EMAIL', message: 'Email address is required' });
  }

  const normalizedEmail = (email || '').trim().toLowerCase();
  let user: any = null;

  const pool = getPgPool();
  if (pool) {
    try {
      const uRes = await queryPg('SELECT id, email, full_name FROM users WHERE LOWER(email) = $1 AND is_active = 1', [normalizedEmail]);
      if (uRes.rows.length > 0) {
        user = uRes.rows[0];
      } else {
        const schRes = await queryPg(
          `SELECT u.id, u.email, u.full_name FROM schools s
           JOIN user_roles ur ON ur.school_id = s.id AND ur.role_id = 'role_school_owner'
           JOIN users u ON u.id = ur.user_id
           WHERE LOWER(s.email) = $1 AND u.is_active = 1
           ORDER BY ur.is_primary DESC LIMIT 1`,
          [normalizedEmail]
        );
        if (schRes.rows.length > 0) user = schRes.rows[0];
      }
    } catch (e: any) {
      console.warn('[Forgot Password PG Notice]', e.message);
    }
  }

  if (!user) {
    user = cacheDb.prepare('SELECT id, email, full_name FROM users WHERE LOWER(email) = ? AND is_active = 1').get(normalizedEmail) as any;
  }

  const genericForgotMsg =
    'If an account exists with this email, recovery instructions have been processed. If outbound email is unavailable, please use Security Questions, Backup Codes, or your School Administrator.';

  if (!user) {
    // For security, don't leak user existence
    return res.json({
      success: true,
      emailDelivered: false,
      message: genericForgotMsg,
    });
  }

  const hasEmailRelay = Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
  if (hasEmailRelay) {
    const resetToken = 'rst_' + crypto.randomBytes(24).toString('hex');
    const resetId = 'pr_' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    if (pool) {
      try {
        await queryPg(
          `INSERT INTO password_resets (id, user_id, email, token, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [resetId, user.id, user.email, resetToken, expiresAt]
        );
      } catch (pgErr: any) {
        console.warn('[PG password_resets insert notice]', pgErr.message);
      }
    }

    try {
      cacheDb.prepare(`
        INSERT INTO password_resets (id, user_id, email, token, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(resetId, user.id, user.email, resetToken, expiresAt);
    } catch {}
  }

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
    emailDelivered: hasEmailRelay,
    message: genericForgotMsg,
  });
});

// POST /api/v1/auth/reset-password
apiRouter.post('/v1/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Reset token and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters long.' });
  }

  let resetRecord: any = null;
  const pool = getPgPool();
  if (pool) {
    try {
      const resPg = await queryPg(
        'SELECT * FROM password_resets WHERE token = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP',
        [token]
      );
      if (resPg.rows.length > 0) resetRecord = resPg.rows[0];
    } catch (e: any) {
      console.warn('[Reset Password PG Notice]', e.message);
    }
  }

  if (!resetRecord) {
    resetRecord = cacheDb.prepare(`
      SELECT * FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
    `).get(token) as any;
  }

  if (!resetRecord) {
    return res.status(400).json({
      error: 'INVALID_TOKEN',
      message: 'This reset token is invalid or has expired. Please request a new link.',
    });
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(newPassword, salt);

  // Authoritative update in Neon PG first
  if (pool) {
    try {
      await queryPg(
        'UPDATE users SET password_hash = $1, salt = $2, updated_at = CURRENT_TIMESTAMP WHERE email = $3',
        [passwordHash, salt, resetRecord.email]
      );
      await queryPg(
        'UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = $1',
        [resetRecord.id]
      );
      if (resetRecord.user_id) {
        await queryPg('DELETE FROM sessions WHERE user_id = $1', [resetRecord.user_id]);
      }
    } catch (pgErr: any) {
      console.error('[Reset Password PG Error]', pgErr.message);
      return res.status(500).json({ error: 'DATABASE_ERROR', message: 'Failed to update credentials in cloud database.' });
    }
  }

  // Sync cacheDb
  try {
    cacheDb.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?')
      .run(passwordHash, salt, resetRecord.email);
    cacheDb.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(resetRecord.id);
    const u = cacheDb.prepare('SELECT id FROM users WHERE email = ?').get(resetRecord.email) as any;
    if (u) {
      cacheDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    }
  } catch {}

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
apiRouter.get('/v1/school/profile', requireAuth, requireTenant, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  let school: any = null;
  let settings: any = null;

  const pool = getPgPool();
  if (pool) {
    try {
      const schRes = await queryPg('SELECT * FROM schools WHERE id = $1', [schoolId]);
      if (schRes.rows.length > 0) school = schRes.rows[0];
      const setRes = await queryPg('SELECT * FROM school_settings WHERE school_id = $1', [schoolId]);
      if (setRes.rows.length > 0) settings = setRes.rows[0];
    } catch (e: any) {
      console.warn('[GET /v1/school/profile PG Notice]', e.message);
    }
  }

  if (!school) {
    school = cacheDb.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
  }
  if (!settings) {
    settings = cacheDb.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId);
  }

  return res.json({ success: true, school, settings });
});

// PUT /api/v1/school/profile
apiRouter.put(
  '/v1/school/profile',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { name, address, state, lga, phone, email, website, type } = req.body;

    if (!name || !phone || !email || !state || !lga) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Name, phone, email, state, and LGA are required.' });
    }

    const pool = getPgPool();
    if (pool) {
      const dup = await queryPg('SELECT id FROM schools WHERE LOWER(email) = $1 AND id != $2', [email.toLowerCase(), schoolId]);
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'EMAIL_IN_USE', message: 'This email is already registered to another school.' });
      }
      await queryPg(
        `UPDATE schools
         SET name = $1, address = $2, state = $3, lga = $4, phone = $5, email = $6, website = $7, type = COALESCE($8, type), updated_at = CURRENT_TIMESTAMP
         WHERE id = $9`,
        [name.trim(), address || '', state, lga, phone, email.toLowerCase(), website || null, type || null, schoolId]
      );
    }

    cacheDb.prepare(`
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

    let updated: any = null;
    if (pool) {
      const uRes = await queryPg('SELECT * FROM schools WHERE id = $1', [schoolId]);
      if (uRes.rows.length > 0) updated = uRes.rows[0];
    }
    if (!updated) {
      updated = cacheDb.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
    }
    return res.json({ success: true, message: 'School profile updated successfully', school: updated });
  }
);

// GET /api/v1/school/settings
apiRouter.get('/v1/school/settings', requireAuth, requireTenant, requireRole(ACADEMIC_READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  let settings: any = null;
  const pool = getPgPool();
  if (pool) {
    try {
      const setRes = await queryPg('SELECT * FROM school_settings WHERE school_id = $1', [schoolId]);
      if (setRes.rows.length > 0) settings = setRes.rows[0];
    } catch {}
  }
  if (!settings) {
    settings = cacheDb.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId);
  }
  return res.json({ success: true, settings });
});

// PUT /api/v1/school/settings
apiRouter.put(
  '/v1/school/settings',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      current_academic_session,
      current_term,
      payment_notification_email,
      payment_notification_sms,
      allow_partial_payments,
      institution_category,
      academic_cycle_type,
      cycle_labels_json,
      cycle_labels,
      grading_mode,
      terminology_json,
      terminology,
    } = req.body;

    const cleanCategory =
      institution_category === 'TERTIARY' || institution_category === 'K12'
        ? institution_category
        : null;
    const cleanCycleType =
      academic_cycle_type === 'SEMESTER' || academic_cycle_type === 'TRIMESTER' || academic_cycle_type === 'TERM'
        ? academic_cycle_type
        : null;
    const cleanGradingMode =
      grading_mode === 'GPA_5' || grading_mode === 'GPA_4' || grading_mode === 'PERCENTAGE'
        ? grading_mode
        : null;
    const serializedCycleLabels = Array.isArray(cycle_labels)
      ? JSON.stringify(cycle_labels.map((s: any) => String(s || '').trim()).filter(Boolean))
      : typeof cycle_labels_json === 'string' && cycle_labels_json.trim()
        ? cycle_labels_json.trim()
        : null;
    const serializedTerminology =
      terminology && typeof terminology === 'object'
        ? JSON.stringify(terminology)
        : typeof terminology_json === 'string' && terminology_json.trim()
          ? terminology_json.trim()
          : null;

    const pool = getPgPool();
    if (pool) {
      await queryPg(
        `UPDATE school_settings
         SET current_academic_session = $1,
             current_term = $2,
             payment_notification_email = $3,
             payment_notification_sms = $4,
             allow_partial_payments = $5,
             institution_category = COALESCE($6, institution_category),
             academic_cycle_type = COALESCE($7, academic_cycle_type),
             cycle_labels_json = COALESCE($8, cycle_labels_json),
             grading_mode = COALESCE($9, grading_mode),
             terminology_json = COALESCE($10, terminology_json),
             updated_at = CURRENT_TIMESTAMP
         WHERE school_id = $11`,
        [
          current_academic_session || '2024/2025',
          current_term || '1st Term',
          payment_notification_email || null,
          payment_notification_sms ? 1 : 0,
          allow_partial_payments !== undefined ? (allow_partial_payments ? 1 : 0) : 1,
          cleanCategory,
          cleanCycleType,
          serializedCycleLabels,
          cleanGradingMode,
          serializedTerminology,
          schoolId,
        ]
      );
    }

    cacheDb.prepare(`
      UPDATE school_settings
      SET current_academic_session = ?,
          current_term = ?,
          payment_notification_email = ?,
          payment_notification_sms = ?,
          allow_partial_payments = ?,
          institution_category = COALESCE(?, institution_category),
          academic_cycle_type = COALESCE(?, academic_cycle_type),
          cycle_labels_json = COALESCE(?, cycle_labels_json),
          grading_mode = COALESCE(?, grading_mode),
          terminology_json = COALESCE(?, terminology_json),
          updated_at = CURRENT_TIMESTAMP
      WHERE school_id = ?
    `).run(
      current_academic_session || '2024/2025',
      current_term || '1st Term',
      payment_notification_email || null,
      payment_notification_sms ? 1 : 0,
      allow_partial_payments !== undefined ? (allow_partial_payments ? 1 : 0) : 1,
      cleanCategory,
      cleanCycleType,
      serializedCycleLabels,
      cleanGradingMode,
      serializedTerminology,
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
      metadata: {
        current_academic_session,
        current_term,
        institution_category: cleanCategory,
        academic_cycle_type: cleanCycleType,
        grading_mode: cleanGradingMode,
      },
    });

    let settings: any = null;
    if (pool) {
      const sRes = await queryPg('SELECT * FROM school_settings WHERE school_id = $1', [schoolId]);
      if (sRes.rows.length > 0) settings = sRes.rows[0];
    }
    if (!settings) {
      settings = cacheDb.prepare('SELECT * FROM school_settings WHERE school_id = ?').get(schoolId);
    }
    return res.json({ success: true, message: 'Institution settings saved successfully', settings });
  }
);

// GET /api/v1/school/stats (Tenant-scoped operational & demographic statistics)
apiRouter.get('/v1/school/stats', requireAuth, requireTenant, requireRole(DIRECTORY_READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const pool = getPgPool();

  if (pool) {
    try {
      const totStu = (await queryPg('SELECT COUNT(*) as c FROM students WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)', [schoolId])).rows[0]?.c || 0;
      const actStu = (await queryPg("SELECT COUNT(*) as c FROM students WHERE school_id = $1 AND student_status = 'ACTIVE' AND (is_deleted = 0 OR is_deleted IS NULL)", [schoolId])).rows[0]?.c || 0;
      const totCls = (await queryPg('SELECT COUNT(*) as c FROM classes WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)', [schoolId])).rows[0]?.c || 0;
      const totStf = (await queryPg('SELECT COUNT(*) as c FROM staff WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)', [schoolId])).rows[0]?.c || 0;
      const totPar = (await queryPg('SELECT COUNT(*) as c FROM parents WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)', [schoolId])).rows[0]?.c || 0;

      const actSes = (await queryPg("SELECT name FROM academic_sessions WHERE school_id = $1 AND status = 'ACTIVE' LIMIT 1", [schoolId])).rows[0];
      const actTrm = (await queryPg("SELECT name FROM terms WHERE school_id = $1 AND status = 'ACTIVE' LIMIT 1", [schoolId])).rows[0];
      const setRow = (await queryPg('SELECT current_academic_session, current_term FROM school_settings WHERE school_id = $1', [schoolId])).rows[0];

      const recStu = (await queryPg(`
        SELECT id, admission_number, full_name, class_name, student_status, created_at
        FROM students
        WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
        ORDER BY created_at DESC
        LIMIT 5
      `, [schoolId])).rows;

      return res.json({
        success: true,
        stats: {
          totalStudents: Number(totStu),
          activeStudents: Number(actStu),
          totalClasses: Number(totCls),
          totalStaff: Number(totStf),
          totalParents: Number(totPar),
          currentAcademicSession: actSes?.name || setRow?.current_academic_session || '2024/2025',
          currentTerm: actTrm?.name || setRow?.current_term || '1st Term',
          recentStudents: recStu,
        },
      });
    } catch (e: any) {
      console.warn('[Stats PG Notice]', e.message);
    }
  }

  // Fallback to SQLite cache
  const totalStudents = (cacheDb.prepare('SELECT COUNT(*) as c FROM students WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(schoolId) as any)?.c || 0;
  const activeStudents = (cacheDb.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ? AND student_status = 'ACTIVE' AND (is_deleted = 0 OR is_deleted IS NULL)").get(schoolId) as any)?.c || 0;
  const totalClasses = (cacheDb.prepare('SELECT COUNT(*) as c FROM classes WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(schoolId) as any)?.c || 0;
  const totalStaff = (cacheDb.prepare('SELECT COUNT(*) as c FROM staff WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(schoolId) as any)?.c || 0;
  const totalParents = (cacheDb.prepare('SELECT COUNT(*) as c FROM parents WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(schoolId) as any)?.c || 0;

  const activeSessionRow = cacheDb.prepare("SELECT name FROM academic_sessions WHERE school_id = ? AND status = 'ACTIVE' LIMIT 1").get(schoolId) as any;
  const activeTermRow = cacheDb.prepare("SELECT name FROM terms WHERE school_id = ? AND status = 'ACTIVE' LIMIT 1").get(schoolId) as any;
  const settings = cacheDb.prepare('SELECT current_academic_session, current_term FROM school_settings WHERE school_id = ?').get(schoolId) as any;

  const recentStudents = cacheDb.prepare(`
    SELECT id, admission_number, full_name, class_name, student_status, created_at
    FROM students
    WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
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
apiRouter.get('/v1/school/students', requireAuth, requireTenant, requireRole(DIRECTORY_READ_ROLES), async (req: AuthenticatedRequest, res) => {
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

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const pool = getPgPool();
  if (pool) {
    try {
      let whereClause = 'school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)';
      const params: any[] = [schoolId];
      let pIdx = 2;

      if (search && search.trim()) {
        const s = `%${search.trim().toLowerCase()}%`;
        whereClause += ` AND (LOWER(full_name) LIKE $${pIdx} OR LOWER(first_name) LIKE $${pIdx} OR LOWER(last_name) LIKE $${pIdx} OR LOWER(COALESCE(admission_number, '')) LIKE $${pIdx} OR LOWER(COALESCE(phone, '')) LIKE $${pIdx} OR LOWER(COALESCE(email, '')) LIKE $${pIdx})`;
        params.push(s);
        pIdx++;
      }

      if (class_id) {
        whereClause += ` AND class_id = $${pIdx}`;
        params.push(class_id);
        pIdx++;
      }

      if (class_arm_id) {
        whereClause += ` AND class_arm_id = $${pIdx}`;
        params.push(class_arm_id);
        pIdx++;
      }

      if (gender) {
        whereClause += ` AND gender = $${pIdx}`;
        params.push(gender);
        pIdx++;
      }

      if (status) {
        whereClause += ` AND student_status = $${pIdx}`;
        params.push(status);
        pIdx++;
      }

      if (academic_session_id) {
        whereClause += ` AND academic_session_id = $${pIdx}`;
        params.push(academic_session_id);
        pIdx++;
      }

      const countRes = await queryPg(`SELECT COUNT(*) as c FROM students WHERE ${whereClause}`, params);
      const total = Number(countRes.rows[0]?.c || 0);

      let orderClause = 'ORDER BY full_name ASC';
      if (sort === 'name_desc') orderClause = 'ORDER BY full_name DESC';
      else if (sort === 'admission_asc') orderClause = 'ORDER BY admission_number ASC NULLS LAST';
      else if (sort === 'admission_desc') orderClause = 'ORDER BY admission_number DESC NULLS LAST';
      else if (sort === 'date_desc') orderClause = 'ORDER BY created_at DESC';

      const dataSql = `SELECT * FROM students WHERE ${whereClause} ${orderClause} LIMIT $${pIdx} OFFSET $${pIdx + 1}`;
      const dataRes = await queryPg(dataSql, [...params, limitNum, offset]);

      return res.json({
        success: true,
        count: total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        students: dataRes.rows,
      });
    } catch (e: any) {
      console.warn('[Students GET PG Notice]', e.message);
    }
  }

  // Fallback to SQLite cache
  let sql = 'SELECT * FROM students WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)';
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
    sql += ' AND student_status = ?';
    params.push(status);
  }

  if (academic_session_id) {
    sql += ' AND academic_session_id = ?';
    params.push(academic_session_id);
  }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as c');
  const total = (cacheDb.prepare(countSql).get(...params) as any)?.c || 0;

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

  sql += ' LIMIT ? OFFSET ?';
  params.push(limitNum, offset);

  const students = cacheDb.prepare(sql).all(...params);

  return res.json({
    success: true,
    count: total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum) || 1,
    students,
  });
});

// GET /api/v1/school/students/:id (Detailed student profile with parent contacts)
apiRouter.get('/v1/school/students/:id', requireAuth, requireTenant, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const { id } = req.params;

  if (!(await canAccessStudent(req, id))) {
    return res.status(403).json({
      error: 'UNAUTHORIZED_STUDENT_ACCESS',
      message: 'You are not authorized to view this student profile.',
    });
  }

  let student: any = null;
  let parents: any[] = [];
  const pool = getPgPool();

  if (pool) {
    try {
      const stuRes = await queryPg('SELECT * FROM students WHERE id = $1 AND school_id = $2', [id, schoolId]);
      if (stuRes.rows.length > 0) {
        student = stuRes.rows[0];
        const parRes = await queryPg(
          `SELECT p.id, p.id as parent_id, p.first_name, p.last_name, (p.first_name || ' ' || p.last_name) as full_name,
                  p.phone, p.email, p.occupation, p.address, ps.relationship_type, ps.is_primary_contact
           FROM parent_students ps
           JOIN parents p ON ps.parent_id = p.id
           WHERE ps.student_id = $1 AND ps.school_id = $2`,
          [id, schoolId]
        );
        parents = parRes.rows;
      }
    } catch (e: any) {
      console.warn('[Student GET:id PG Notice]', e.message);
    }
  }

  if (!student) {
    student = cacheDb.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(id, schoolId) as any;
    if (student) {
      parents = cacheDb.prepare(`
        SELECT p.id, p.id as parent_id, p.first_name, p.last_name, (p.first_name || ' ' || p.last_name) as full_name,
               p.phone, p.email, p.occupation, p.address, ps.relationship_type, ps.is_primary_contact
        FROM parent_students ps
        JOIN parents p ON ps.parent_id = p.id
        WHERE ps.student_id = ? AND ps.school_id = ?
      `).all(id, schoolId);
    }
  }

  if (!student) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Student record not found in your school.' });
  }

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
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
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

    const fn = (first_name || '').toString().trim();
    const ln = (last_name || '').toString().trim();
    const mn = (middle_name || '').toString().trim();

    if (!fn || !ln) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'First name and last name are required.',
      });
    }

    const suppliedAdm = admission_number ? String(admission_number).trim() : '';
    const autoGeneratedAdmissionNumber = !suppliedAdm;
    const cleanAdm = suppliedAdm || (await generateNextAdmissionNumber(schoolId));
    const cleanGender = gender ? (String(gender).toLowerCase().startsWith('f') ? 'Female' : 'Male') : null;
    const pool = getPgPool();

    // Check duplicate admission number if explicitly supplied
    if (suppliedAdm) {
      if (pool) {
        const dup = await queryPg('SELECT id FROM students WHERE school_id = $1 AND LOWER(admission_number) = $2', [schoolId, cleanAdm.toLowerCase()]);
        if (dup.rows.length > 0) {
          return res.status(409).json({
            error: 'DUPLICATE_ADMISSION_NUMBER',
            message: `Admission number "${cleanAdm}" already exists in your school.`,
          });
        }
      } else {
        const dup = cacheDb.prepare('SELECT id FROM students WHERE school_id = ? AND LOWER(admission_number) = ?').get(schoolId, cleanAdm.toLowerCase());
        if (dup) {
          return res.status(409).json({
            error: 'DUPLICATE_ADMISSION_NUMBER',
            message: `Admission number "${cleanAdm}" already exists in your school.`,
          });
        }
      }
    }

    const id = 'stu_' + crypto.randomUUID().slice(0, 10);
    const fullName = `${fn} ${mn ? mn + ' ' : ''}${ln}`.trim();

    // 1. Authoritative Neon PostgreSQL Persistence First
    if (pool) {
      try {
        await queryPg(
          `INSERT INTO students (
            id, school_id, admission_number, first_name, middle_name, last_name, full_name, gender,
            date_of_birth, phone, email, address, state, nationality, admission_date, student_status,
            class_id, class_arm_id, class_name, class_arm_name, academic_session_id, profile_photo_url,
            emergency_contact, medical_notes, is_deleted
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, 0)
          ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            student_status = EXCLUDED.student_status`,
          [
            id, schoolId, cleanAdm, fn, mn || null, ln, fullName, cleanGender,
            date_of_birth || null, phone || null, email ? email.toLowerCase().trim() : null,
            address || null, state || null, nationality || 'Nigerian', admission_date,
            student_status, class_id || null, class_arm_id || null, class_name || null,
            class_arm_name || null, academic_session_id || null, profile_photo_url || null,
            emergency_contact || null, medical_notes || null
          ]
        );
      } catch (pgErr: any) {
        console.error('[Student Enroll PG Error]', pgErr.message);
        return res.status(500).json({ error: 'ENROLL_FAILED', message: safeClientError(pgErr, 'Failed to enroll student in database.') });
      }
    }

    // 2. Sync cacheDb safely
    try {
      cacheDb.prepare(`
        INSERT INTO students (
          id, school_id, admission_number, first_name, middle_name, last_name, full_name, gender,
          date_of_birth, phone, email, address, state, nationality, admission_date, student_status,
          class_id, class_arm_id, class_name, class_arm_name, academic_session_id, profile_photo_url,
          emergency_contact, medical_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          full_name = excluded.full_name,
          student_status = excluded.student_status
      `).run(
        id, schoolId, cleanAdm, fn, mn || null, ln, fullName, cleanGender,
        date_of_birth || null, phone || null, email ? email.toLowerCase().trim() : null,
        address || null, state || null, nationality || 'Nigerian', admission_date,
        student_status, class_id || null, class_arm_id || null, class_name || null,
        class_arm_name || null, academic_session_id || null, profile_photo_url || null,
        emergency_contact || null, medical_notes || null
      );
    } catch {}

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'ENROLL_STUDENT',
      entity: 'STUDENT',
      entityId: id,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { admission_number: cleanAdm, full_name: fullName, class_name },
    });

    let student: any = null;
    if (pool) {
      const sRes = await queryPg('SELECT * FROM students WHERE id = $1', [id]);
      if (sRes.rows.length > 0) student = sRes.rows[0];
    }
    if (!student) {
      student = cacheDb.prepare('SELECT * FROM students WHERE id = ?').get(id);
    }
    return res.status(201).json({
      success: true,
      message: autoGeneratedAdmissionNumber
        ? `Student enrolled successfully with auto-generated Admission Number ${cleanAdm}.`
        : 'Student enrolled successfully',
      autoGeneratedAdmissionNumber,
      student,
    });
  }
);

// PUT /api/v1/school/students/:id (Update student)
apiRouter.put(
  '/v1/school/students/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    let existing: any = null;
    const pool = getPgPool();
    if (pool) {
      const exRes = await queryPg('SELECT * FROM students WHERE id = $1 AND school_id = $2', [id, schoolId]);
      if (exRes.rows.length > 0) existing = exRes.rows[0];
    }
    if (!existing) {
      existing = cacheDb.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(id, schoolId) as any;
    }

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found in this school.' });
    }

    const b = req.body || {};
    const firstName = b.first_name !== undefined ? String(b.first_name).trim() : existing.first_name;
    const middleName = b.middle_name !== undefined ? String(b.middle_name).trim() : (existing.middle_name || '');
    const lastName = b.last_name !== undefined ? String(b.last_name).trim() : existing.last_name;
    const fullName = `${firstName} ${middleName ? middleName + ' ' : ''}${lastName}`.trim();
    const rawUpdateAdm = b.admission_number !== undefined ? String(b.admission_number || '').trim() : String(existing.admission_number || '').trim();
    const cleanAdm = rawUpdateAdm || (await generateNextAdmissionNumber(schoolId));
    const cleanGender = b.gender !== undefined ? (b.gender ? (String(b.gender).toLowerCase().startsWith('f') ? 'Female' : 'Male') : null) : existing.gender;

    // Check admission number uniqueness if changed
    if (cleanAdm && cleanAdm !== existing.admission_number) {
      if (pool) {
        const dup = await queryPg('SELECT id FROM students WHERE school_id = $1 AND LOWER(admission_number) = $2 AND id != $3', [schoolId, cleanAdm.toLowerCase(), id]);
        if (dup.rows.length > 0) {
          return res.status(409).json({ error: 'DUPLICATE_ADMISSION_NUMBER', message: 'Admission number already in use.' });
        }
      } else {
        const dup = cacheDb.prepare('SELECT id FROM students WHERE school_id = ? AND LOWER(admission_number) = ? AND id != ?').get(schoolId, cleanAdm.toLowerCase(), id);
        if (dup) {
          return res.status(409).json({ error: 'DUPLICATE_ADMISSION_NUMBER', message: 'Admission number already in use.' });
        }
      }
    }

    const resolvedClassId = b.class_id !== undefined ? (b.class_id || null) : existing.class_id;
    const resolvedArmId = b.class_arm_id !== undefined ? (b.class_arm_id || null) : existing.class_arm_id;
    const resolvedClassName = b.class_name !== undefined ? (b.class_name || null) : existing.class_name;
    const resolvedArmName = b.class_arm_name !== undefined ? (b.class_arm_name || null) : existing.class_arm_name;

    if (pool) {
      await queryPg(
        `UPDATE students SET
          admission_number = $1,
          first_name = $2,
          middle_name = $3,
          last_name = $4,
          full_name = $5,
          gender = $6,
          date_of_birth = COALESCE($7, date_of_birth),
          phone = COALESCE($8, phone),
          email = COALESCE($9, email),
          address = COALESCE($10, address),
          state = COALESCE($11, state),
          nationality = COALESCE($12, nationality),
          student_status = COALESCE($13, student_status),
          class_id = $14,
          class_arm_id = $15,
          class_name = $16,
          class_arm_name = $17,
          academic_session_id = COALESCE($18, academic_session_id),
          emergency_contact = COALESCE($19, emergency_contact),
          medical_notes = COALESCE($20, medical_notes),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $21 AND school_id = $22`,
        [
          cleanAdm, firstName, middleName || null, lastName, fullName, cleanGender,
          b.date_of_birth || null, b.phone || null, b.email ? b.email.toLowerCase().trim() : null,
          b.address || null, b.state || null, b.nationality || null, b.student_status || null,
          resolvedClassId, resolvedArmId, resolvedClassName, resolvedArmName,
          b.academic_session_id || null, b.emergency_contact || null, b.medical_notes || null,
          id, schoolId
        ]
      );
    }

    cacheDb.prepare(`
      UPDATE students SET
        admission_number = ?,
        first_name = ?,
        middle_name = ?,
        last_name = ?,
        full_name = ?,
        gender = ?,
        date_of_birth = COALESCE(?, date_of_birth),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        state = COALESCE(?, state),
        nationality = COALESCE(?, nationality),
        student_status = COALESCE(?, student_status),
        class_id = ?,
        class_arm_id = ?,
        class_name = ?,
        class_arm_name = ?,
        academic_session_id = COALESCE(?, academic_session_id),
        emergency_contact = COALESCE(?, emergency_contact),
        medical_notes = COALESCE(?, medical_notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(
      cleanAdm, firstName, middleName || null, lastName, fullName, cleanGender,
      b.date_of_birth || null, b.phone || null, b.email ? b.email.toLowerCase().trim() : null,
      b.address || null, b.state || null, b.nationality || null, b.student_status || null,
      resolvedClassId, resolvedArmId, resolvedClassName, resolvedArmName,
      b.academic_session_id || null, b.emergency_contact || null, b.medical_notes || null,
      id, schoolId
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

    let updated: any = null;
    if (pool) {
      const uRes = await queryPg('SELECT * FROM students WHERE id = $1', [id]);
      if (uRes.rows.length > 0) updated = uRes.rows[0];
    }
    if (!updated) {
      updated = cacheDb.prepare('SELECT * FROM students WHERE id = ?').get(id);
    }
    return res.json({ success: true, message: 'Student updated successfully', student: updated });
  }
);

// DELETE /api/v1/school/students/:id (Controlled soft-deletion to Recycle Bin)
apiRouter.delete(
  '/v1/school/students/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    let existing: any = null;
    const pool = getPgPool();
    if (pool) {
      const exRes = await queryPg('SELECT * FROM students WHERE id = $1 AND school_id = $2', [id, schoolId]);
      if (exRes.rows.length > 0) existing = exRes.rows[0];
    }
    if (!existing) {
      existing = cacheDb.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(id, schoolId) as any;
    }

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found.' });
    }

    let paymentCount = 0;
    let invoiceCount = 0;
    if (pool) {
      try {
        paymentCount = Number((await queryPg('SELECT COUNT(*) as c FROM payments WHERE student_id = $1 AND school_id = $2', [id, schoolId])).rows[0]?.c || 0);
        invoiceCount = Number((await queryPg('SELECT COUNT(*) as c FROM invoices WHERE student_id = $1 AND school_id = $2', [id, schoolId])).rows[0]?.c || 0);
      } catch {}
    } else {
      paymentCount = (cacheDb.prepare('SELECT COUNT(*) as c FROM payments WHERE student_id = ? AND school_id = ?').get(id, schoolId) as any)?.c || 0;
      invoiceCount = (cacheDb.prepare('SELECT COUNT(*) as c FROM invoices WHERE student_id = ? AND school_id = ?').get(id, schoolId) as any)?.c || 0;
    }

    const reason = req.body?.reason || (paymentCount > 0 || invoiceCount > 0 
      ? 'Archived to Recycle Bin (has recorded financial transactions)' 
      : 'Removed by School Admin');

    if (pool) {
      await queryPg(
        `UPDATE students 
         SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1, deletion_reason = $2 
         WHERE id = $3 AND school_id = $4`,
        [req.user!.email, reason, id, schoolId]
      );
    }

    cacheDb.prepare(`
      UPDATE students 
      SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, deletion_reason = ? 
      WHERE id = ? AND school_id = ?
    `).run(req.user!.email, reason, id, schoolId);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'SOFT_DELETE_STUDENT',
      entity: 'STUDENT',
      entityId: id,
      ipAddress: req.ip || '127.0.0.1',
      metadata: { admission_number: existing.admission_number, full_name: existing.full_name, paymentCount, invoiceCount },
    });

    return res.json({
      success: true,
      message: `Student record safely moved to Recycle Bin. Can be restored at any time. (${paymentCount} payments, ${invoiceCount} invoices preserved in ledger).`,
    });
  }
);

// Shared Nigerian class name normalization & inference helpers
function normalizeClassMatchKey(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\bjs\s*([1-3])\b/gi, 'jss $1')
    .replace(/\bss\s*([1-3])\b/gi, 'sss $1')
    .replace(/\bpry\s*([1-6])\b/gi, 'primary $1')
    .replace(/\bnur\s*([1-3])\b/gi, 'nursery $1')
    .replace(/([a-z])(\d)/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCanonicalClassName(raw?: string | null): string {
  const trimmed = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const mJss = trimmed.match(/^(?:jss?|junior\s*sec(?:ondary)?)\s*([1-3])$/i);
  if (mJss) return `JSS ${mJss[1]}`;
  const mSss = trimmed.match(/^(?:sss?|senior\s*sec(?:ondary)?)\s*([1-3])$/i);
  if (mSss) return `SSS ${mSss[1]}`;
  const mPry = trimmed.match(/^(?:pry|pri|primary)\s*([1-6])$/i);
  if (mPry) return `Primary ${mPry[1]}`;
  const mNur = trimmed.match(/^(?:nur|nursery)\s*([1-3])$/i);
  if (mNur) return `Nursery ${mNur[1]}`;
  return trimmed;
}

function inferNigerianClassLevel(className: string, explicitLevel?: string | null): string {
  const exp = String(explicitLevel || '').trim();
  if (exp && !['general', 'other', ''].includes(exp.toLowerCase())) return exp;
  const lower = String(className || '').toLowerCase();
  if (/creche|playgroup|kg|kindergarten|nursery|early|reception|pre[-\s]?(?:nursery|school)/i.test(lower)) {
    return 'Early Years / Nursery';
  }
  if (/primary|pry|basic\s*[1-6]\b/i.test(lower)) {
    return 'Primary';
  }
  if (/jss?|junior\s*sec|basic\s*[7-9]\b/i.test(lower)) {
    return 'Junior Secondary';
  }
  if (/sss?|senior\s*sec/i.test(lower)) {
    return 'Senior Secondary';
  }
  if (/\b(?:pgd|msc|m\.sc|mba|m\.a|phd|ph\.d|postgraduate|masters|doctorate)\b/i.test(lower)) {
    return 'Postgraduate';
  }
  if (/\bhnd\b|higher\s*national\s*diploma/i.test(lower)) {
    return 'Higher National Diploma';
  }
  if (/\bnd\s*[1-3]\b|national\s*diploma/i.test(lower)) {
    return 'National Diploma';
  }
  if (/\b[1-6]00\s*(?:level|l)\b|undergraduate/i.test(lower)) {
    return 'Undergraduate';
  }
  if (/\b(?:year\s*[1-5]|nce\s*[1-3]|chew|jchew|diploma|nursing|midwifery)\b/i.test(lower)) {
    return 'College / Diploma';
  }
  return 'General';
}

// POST /api/v1/school/students/import (Bulk CSV/Paste Import with duplicate detection, auto admission nos, and class/arm auto-linking)
apiRouter.post(
  '/v1/school/students/import',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { students: rawRows, auto_create_classes = true } = req.body || {};

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'No student records provided for import.' });
    }

    let importedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let createdClassesCount = 0;
    let createdArmsCount = 0;
    const errors: { row: number; admission_number?: string; student_name?: string; error: string; isDuplicate?: boolean }[] = [];
    const warnings: { row: number; admission_number?: string; student_name?: string; message: string; isPossibleDuplicate?: boolean }[] = [];

    const pool = getPgPool();
    if (pool) {
      if (!isPgConnected()) {
        try {
          await ensurePgConnected();
        } catch {}
      }
    }

    // Load existing students and classes/arms from authoritative Neon PG
    const existingAdmissions = new Set<string>();
    const preExistingFingerprints = new Set<string>();
    const preExistingNames = new Set<string>();
    const classByKey = new Map<string, { id: string; name: string; level: string }>();
    const classById = new Map<string, { id: string; name: string; level: string }>();
    const armByKey = new Map<string, { id: string; class_id: string; name: string }>();
    const armById = new Map<string, { id: string; class_id: string; name: string }>();

    if (pool) {
      try {
        const stuRes = await queryPg(
          `SELECT admission_number, LOWER(full_name) as clean_name,
                  LOWER(COALESCE(class_name, '')) as clean_class,
                  LOWER(COALESCE(class_arm_name, '')) as clean_arm,
                  LOWER(COALESCE(gender, '')) as clean_gender,
                  LOWER(COALESCE(phone, '')) as clean_phone,
                  LOWER(COALESCE(email, '')) as clean_email
           FROM students WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
          [schoolId]
        );
        for (const r of stuRes.rows) {
          if (r.admission_number) existingAdmissions.add(r.admission_number.trim().toLowerCase());
          if (r.clean_name) {
            preExistingNames.add(r.clean_name);
            preExistingFingerprints.add(`${r.clean_name}|${r.clean_class}|${r.clean_arm}|${r.clean_gender}|${r.clean_phone}|${r.clean_email}`);
          }
        }

        const clsRes = await queryPg(
          `SELECT id, name, COALESCE(level, 'General') as level FROM classes WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
          [schoolId]
        );
        for (const c of clsRes.rows) {
          const item = { id: c.id, name: c.name, level: c.level || 'General' };
          classById.set(c.id, item);
          classByKey.set(normalizeClassMatchKey(c.name), item);
        }

        const armRes = await queryPg(
          `SELECT id, class_id, name FROM class_arms WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
          [schoolId]
        );
        for (const a of armRes.rows) {
          const item = { id: a.id, class_id: a.class_id, name: a.name };
          armById.set(a.id, item);
          armByKey.set(`${a.class_id}|${String(a.name).trim().toLowerCase()}`, item);
        }
      } catch (e: any) {
        console.warn('[Bulk Import PG Load Notice]', e.message);
      }
    }

    // Also sync local cache existing sets
    try {
      const localStudents = cacheDb.prepare(`
        SELECT admission_number, LOWER(full_name) as clean_name,
               LOWER(COALESCE(class_name, '')) as clean_class,
               LOWER(COALESCE(class_arm_name, '')) as clean_arm,
               LOWER(COALESCE(gender, '')) as clean_gender,
               LOWER(COALESCE(phone, '')) as clean_phone,
               LOWER(COALESCE(email, '')) as clean_email
        FROM students WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
      `).all(schoolId) as any[];
      for (const r of localStudents) {
        if (r.admission_number) existingAdmissions.add(r.admission_number.trim().toLowerCase());
        if (r.clean_name) {
          preExistingNames.add(r.clean_name);
          preExistingFingerprints.add(`${r.clean_name}|${r.clean_class}|${r.clean_arm}|${r.clean_gender}|${r.clean_phone}|${r.clean_email}`);
        }
      }

      const localClasses = cacheDb.prepare(
        `SELECT id, name, COALESCE(level, 'General') as level FROM classes WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`
      ).all(schoolId) as any[];
      for (const c of localClasses) {
        if (!classById.has(c.id)) {
          const item = { id: c.id, name: c.name, level: c.level || 'General' };
          classById.set(c.id, item);
          const key = normalizeClassMatchKey(c.name);
          if (!classByKey.has(key)) classByKey.set(key, item);
        }
      }

      const localArms = cacheDb.prepare(
        `SELECT id, class_id, name FROM class_arms WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`
      ).all(schoolId) as any[];
      for (const a of localArms) {
        if (!armById.has(a.id)) {
          const item = { id: a.id, class_id: a.class_id, name: a.name };
          armById.set(a.id, item);
          const key = `${a.class_id}|${String(a.name).trim().toLowerCase()}`;
          if (!armByKey.has(key)) armByKey.set(key, item);
        }
      }
    } catch (e) {}

    let pgClient: any = null;
    if (pool) {
      try {
        pgClient = await pool.connect();
        await pgClient.query('BEGIN');
      } catch (connErr) {
        console.error('[Bulk Import PG Connect Error]', connErr);
        return res.status(503).json({
          error: 'DATABASE_UNAVAILABLE',
          message: 'Authoritative database connection failed. Aborted to avoid creating non-persistent records.',
        });
      }
    }

    const seenInBatchAdmissions = new Set<string>();
    const seenInBatchFingerprints = new Set<string>();
    const seenInBatchNames = new Set<string>();
    const batchAllocator = await createBatchAdmissionAllocator(schoolId);
    let generatedAdmissionCount = 0;
    const importedStudentsPreview: Array<{
      id: string;
      full_name: string;
      admission_number: string;
      class_id: string | null;
      class_name: string | null;
      class_arm_name: string | null;
      gender: string | null;
    }> = [];

    try {
      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const rawAdm = (
          row.admission_number || row.admission_no || row['Admission No'] || row['Admission Number'] ||
          row.adm_no || row.reg_no || row.student_id || row['Student ID'] || ''
        ).toString().trim();

        let fn = (row.first_name || row['First Name'] || row.firstname || '').toString().trim();
        let ln = (row.last_name || row['Last Name'] || row.lastname || row.surname || row['Surname'] || '').toString().trim();
        const mn = (row.middle_name || row['Middle Name'] || row.middlename || row.other_name || '').toString().trim();

        const singleName = (row.student_name || row.full_name || row.name || '').toString().trim();
        if ((!fn || !ln) && singleName) {
          const parts = singleName.split(/\s+/).filter(Boolean);
          if (parts.length >= 2) {
            fn = parts[0];
            ln = parts.slice(1).join(' ');
          } else if (parts.length === 1) {
            fn = parts[0];
          }
        }

        const rawGender = (row.gender || row['Gender'] || row.sex || '').toString().trim();
        const gender = rawGender ? (rawGender.toLowerCase().startsWith('f') ? 'Female' : (rawGender.toLowerCase().startsWith('m') ? 'Male' : null)) : null;
        const explicitClassId = (row.class_id || '').toString().trim();
        const explicitArmId = (row.class_arm_id || '').toString().trim();
        const rawClassName = (row.class_name || row['Class'] || row.class || row.grade || '').toString().trim();
        const rawClassLevel = (row.class_level || row.level || '').toString().trim();
        const rawArmName = (row.class_arm_name || row['Arm'] || row['Stream'] || row.arm || row.section || '').toString().trim();
        const phone = (row.phone || row['Phone'] || row.parent_phone || row['Parent Phone'] || '').toString().trim();
        const email = (row.email || row['Email'] || row.parent_email || row['Parent Email'] || '').toString().trim();

        // STRICT VALIDATION: Require BOTH first_name and last_name
        if (!fn || !ln) {
          failedCount++;
          errors.push({
            row: i + 1,
            admission_number: rawAdm || undefined,
            student_name: `${fn} ${ln}`.trim() || 'Incomplete Name',
            error: !fn && !ln ? 'Missing first name and last name' : (!fn ? 'Missing first name' : 'Missing last name'),
          });
          continue;
        }

        // Resolve or auto-create class & arm so students appear under their class counts & filters immediately
        let resolvedClassId: string | null = null;
        let resolvedClassName: string | null = rawClassName ? formatCanonicalClassName(rawClassName) : null;
        let resolvedArmId: string | null = null;
        let resolvedArmName: string | null = rawArmName || null;

        if (explicitClassId && classById.has(explicitClassId)) {
          const c = classById.get(explicitClassId)!;
          resolvedClassId = c.id;
          resolvedClassName = c.name;
        } else if (rawClassName) {
          const classKey = normalizeClassMatchKey(rawClassName);
          let matchedClass = classByKey.get(classKey);
          if (!matchedClass && auto_create_classes !== false) {
            const newClassId = 'cls_' + crypto.randomUUID().slice(0, 8);
            const canonicalName = formatCanonicalClassName(rawClassName);
            const inferredLevel = inferNigerianClassLevel(canonicalName, rawClassLevel);
            if (pgClient) {
              await pgClient.query(`SAVEPOINT sp_cls_${i}`);
              try {
                await pgClient.query(
                  `INSERT INTO classes (id, school_id, name, level, created_at, updated_at, is_deleted)
                   VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)`,
                  [newClassId, schoolId, canonicalName, inferredLevel]
                );
                await pgClient.query(`RELEASE SAVEPOINT sp_cls_${i}`);
              } catch {
                await pgClient.query(`ROLLBACK TO SAVEPOINT sp_cls_${i}`);
              }
            }
            try {
              cacheDb.prepare(`
                INSERT INTO classes (id, school_id, name, level, is_deleted, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              `).run(newClassId, schoolId, canonicalName, inferredLevel);
            } catch {}
            matchedClass = { id: newClassId, name: canonicalName, level: inferredLevel };
            classById.set(newClassId, matchedClass);
            classByKey.set(classKey, matchedClass);
            createdClassesCount++;
          }
          if (matchedClass) {
            resolvedClassId = matchedClass.id;
            resolvedClassName = matchedClass.name;
          }
        }

        if (resolvedClassId) {
          if (explicitArmId && armById.has(explicitArmId) && armById.get(explicitArmId)!.class_id === resolvedClassId) {
            const a = armById.get(explicitArmId)!;
            resolvedArmId = a.id;
            resolvedArmName = a.name;
          } else if (rawArmName) {
            const armKey = `${resolvedClassId}|${rawArmName.toLowerCase()}`;
            let matchedArm = armByKey.get(armKey);
            if (!matchedArm && auto_create_classes !== false) {
              const newArmId = 'arm_' + crypto.randomUUID().slice(0, 8);
              if (pgClient) {
                await pgClient.query(`SAVEPOINT sp_arm_${i}`);
                try {
                  await pgClient.query(
                    `INSERT INTO class_arms (id, school_id, class_id, name, capacity, created_at, updated_at, is_deleted)
                     VALUES ($1, $2, $3, $4, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)`,
                    [newArmId, schoolId, resolvedClassId, rawArmName]
                  );
                  await pgClient.query(`RELEASE SAVEPOINT sp_arm_${i}`);
                } catch {
                  await pgClient.query(`ROLLBACK TO SAVEPOINT sp_arm_${i}`);
                }
              }
              try {
                cacheDb.prepare(`
                  INSERT INTO class_arms (id, school_id, class_id, name, capacity, is_deleted, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 40, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `).run(newArmId, schoolId, resolvedClassId, rawArmName);
              } catch {}
              matchedArm = { id: newArmId, class_id: resolvedClassId, name: rawArmName };
              armById.set(newArmId, matchedArm);
              armByKey.set(armKey, matchedArm);
              createdArmsCount++;
            }
            if (matchedArm) {
              resolvedArmId = matchedArm.id;
              resolvedArmName = matchedArm.name;
            }
          }
        }

        const fullName = `${fn} ${mn ? mn + ' ' : ''}${ln}`.trim();
        const cleanNameKey = fullName.toLowerCase();
        const cleanAdmKey = rawAdm.toLowerCase();
        const rowFingerprint = `${cleanNameKey}|${(resolvedClassName || '').toLowerCase()}|${(resolvedArmName || '').toLowerCase()}|${(gender || '').toLowerCase()}|${phone.toLowerCase()}|${email.toLowerCase()}`;

        // RULE 1: Duplicate admission number within school
        if (rawAdm) {
          if (existingAdmissions.has(cleanAdmKey) || seenInBatchAdmissions.has(cleanAdmKey)) {
            skippedCount++;
            errors.push({
              row: i + 1,
              admission_number: rawAdm,
              student_name: fullName,
              error: `Skipped: Admission number "${rawAdm}" already registered in this school.`,
              isDuplicate: true,
            });
            continue;
          }
        }

        // RULE 2: Exact repeat import without admission number
        if (!rawAdm) {
          if (preExistingFingerprints.has(rowFingerprint) || seenInBatchFingerprints.has(rowFingerprint)) {
            skippedCount++;
            errors.push({
              row: i + 1,
              student_name: fullName,
              error: `Skipped repeat import: matching student record "${fullName}" already exists in this school.`,
              isDuplicate: true,
            });
            continue;
          }

          if (preExistingNames.has(cleanNameKey) || seenInBatchNames.has(cleanNameKey)) {
            warnings.push({
              row: i + 1,
              student_name: fullName,
              message: `Possible duplicate student name "${fullName}" detected — imported as a distinct record for administrative review.`,
              isPossibleDuplicate: true,
            });
          }
        }

        const studentId = 'stu_' + crypto.randomUUID().slice(0, 10);
        const effectiveAdm = rawAdm || batchAllocator.allocateNext();
        if (!rawAdm) generatedAdmissionCount++;

        // 1. Authoritative Neon PostgreSQL Persistence
        if (pgClient) {
          try {
            await pgClient.query(`SAVEPOINT sp_stu_${i}`);
            await pgClient.query(
              `INSERT INTO students (
                id, school_id, admission_number, first_name, middle_name, last_name, full_name,
                gender, phone, email, class_id, class_arm_id, class_name, class_arm_name, student_status, is_deleted
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ACTIVE', 0)`,
              [
                studentId,
                schoolId,
                effectiveAdm,
                fn,
                mn || null,
                ln,
                fullName,
                gender,
                phone || null,
                email ? email.toLowerCase() : null,
                resolvedClassId,
                resolvedArmId,
                resolvedClassName,
                resolvedArmName,
              ]
            );
            await pgClient.query(`RELEASE SAVEPOINT sp_stu_${i}`);
          } catch (pgErr: any) {
            await pgClient.query(`ROLLBACK TO SAVEPOINT sp_stu_${i}`);
            failedCount++;
            errors.push({
              row: i + 1,
              admission_number: rawAdm || undefined,
              student_name: fullName,
              error: `Cloud database write failed: ${pgErr.message}`,
            });
            continue;
          }
        }

        // 2. Local SQLite Engine Cache
        try {
          cacheDb.prepare(`
            INSERT INTO students (
              id, school_id, admission_number, first_name, middle_name, last_name, full_name,
              gender, phone, email, class_id, class_arm_id, class_name, class_arm_name, student_status, is_deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0)
            ON CONFLICT(id) DO UPDATE SET
              full_name = excluded.full_name,
              class_id = excluded.class_id,
              class_arm_id = excluded.class_arm_id,
              class_name = excluded.class_name,
              class_arm_name = excluded.class_arm_name,
              student_status = excluded.student_status
          `).run(
            studentId,
            schoolId,
            effectiveAdm,
            fn,
            mn || null,
            ln,
            fullName,
            gender,
            phone || null,
            email ? email.toLowerCase() : null,
            resolvedClassId,
            resolvedArmId,
            resolvedClassName,
            resolvedArmName
          );
        } catch (sqErr) {
          console.warn('[Bulk Import Local Cache Notice]', sqErr);
        }

        seenInBatchAdmissions.add(effectiveAdm.toLowerCase());
        seenInBatchFingerprints.add(rowFingerprint);
        seenInBatchNames.add(cleanNameKey);
        importedCount++;
        if (importedStudentsPreview.length < 50) {
          importedStudentsPreview.push({
            id: studentId,
            full_name: fullName,
            admission_number: effectiveAdm,
            class_id: resolvedClassId,
            class_name: resolvedClassName,
            class_arm_name: resolvedArmName,
            gender,
          });
        }
      }

      if (pgClient) {
        await pgClient.query('COMMIT');
        markPgConnected();
      }
    } catch (globalErr: any) {
      if (pgClient) {
        try {
          await pgClient.query('ROLLBACK');
        } catch {}
      }
      console.error('[Bulk Import Fatal Error]', globalErr);
      return res.status(500).json({
        error: 'IMPORT_TRANSACTION_FAILED',
        message: 'Bulk import transaction encountered an error: ' + globalErr.message,
      });
    } finally {
      if (pgClient) pgClient.release();
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'BULK_IMPORT_STUDENTS',
      entity: 'STUDENTS',
      ipAddress: req.ip || '127.0.0.1',
      metadata: {
        importedCount,
        failedCount,
        skippedCount,
        createdClassesCount,
        createdArmsCount,
        warningsCount: warnings.length,
        totalRows: rawRows.length,
      },
    });

    const classSyncNote = createdClassesCount > 0 || createdArmsCount > 0
      ? ` Auto-created ${createdClassesCount} class(es) and ${createdArmsCount} arm(s).`
      : '';

    return res.json({
      success: true,
      importedCount,
      failedCount,
      skippedCount,
      generatedAdmissionCount,
      createdClassesCount,
      createdArmsCount,
      importedStudentsPreview,
      errors,
      warnings,
      message: `Successfully imported ${importedCount} student(s) (${generatedAdmissionCount} assigned automatic Admission Numbers).${classSyncNote} ${skippedCount} duplicate(s) skipped. ${failedCount} row(s) failed.`,
    });
  }
);

// POST /api/v1/school/students/bulk-assign (Separate / move selected students into Class, Arm, Gender, or Status)
apiRouter.post(
  '/v1/school/students/bulk-assign',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      student_ids,
      class_id,
      class_name,
      class_arm_id,
      class_arm_name,
      gender,
      student_status,
      create_missing_class = true,
    } = req.body || {};

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Select at least one student to separate or assign.' });
    }

    const cleanStudentIds = Array.from(new Set(student_ids.map((id: any) => String(id || '').trim()).filter(Boolean)));
    if (cleanStudentIds.length === 0) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Valid student IDs are required.' });
    }

    const hasClassUpdate = class_id !== undefined || class_name !== undefined;
    const hasArmUpdate = class_arm_id !== undefined || class_arm_name !== undefined;
    const hasGenderUpdate = gender !== undefined && gender !== '';
    const hasStatusUpdate = student_status !== undefined && student_status !== '';

    if (!hasClassUpdate && !hasArmUpdate && !hasGenderUpdate && !hasStatusUpdate) {
      return res.status(400).json({ error: 'NO_CHANGES', message: 'Choose a Class, Arm, Gender, or Status to apply.' });
    }

    const pool = getPgPool();
    let pgClient: any = null;
    if (pool) {
      try {
        pgClient = await pool.connect();
        await pgClient.query('BEGIN');
      } catch (err: any) {
        return res.status(503).json({ error: 'DATABASE_UNAVAILABLE', message: 'Cloud database temporarily unavailable.' });
      }
    }

    try {
      let targetClassId: string | null | undefined = undefined;
      let targetClassName: string | null | undefined = undefined;
      let targetArmId: string | null | undefined = undefined;
      let targetArmName: string | null | undefined = undefined;

      // Resolve Class if requested
      if (hasClassUpdate) {
        const rawCid = String(class_id || '').trim();
        const rawCname = String(class_name || '').trim();

        if (!rawCid && !rawCname) {
          // Explicit unassign
          targetClassId = null;
          targetClassName = null;
          targetArmId = null;
          targetArmName = null;
        } else if (rawCid) {
          let cls: any = null;
          if (pgClient) {
            const r = await pgClient.query('SELECT id, name FROM classes WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)', [rawCid, schoolId]);
            cls = r.rows[0];
          }
          if (!cls) {
            cls = cacheDb.prepare('SELECT id, name FROM classes WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(rawCid, schoolId);
          }
          if (!cls) {
            if (pgClient) await pgClient.query('ROLLBACK');
            return res.status(404).json({ error: 'CLASS_NOT_FOUND', message: 'Selected class was not found in this school.' });
          }
          targetClassId = cls.id;
          targetClassName = cls.name;
        } else if (rawCname) {
          const normalizedKey = normalizeClassMatchKey(rawCname);
          let allCls: any[] = [];
          if (pgClient) {
            const r = await pgClient.query('SELECT id, name FROM classes WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)', [schoolId]);
            allCls = r.rows;
          } else {
            allCls = cacheDb.prepare('SELECT id, name FROM classes WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').all(schoolId) as any[];
          }
          let matched = allCls.find((c) => normalizeClassMatchKey(c.name) === normalizedKey);
          if (!matched && create_missing_class !== false) {
            const newClassId = 'cls_' + crypto.randomUUID().slice(0, 8);
            const canonicalName = formatCanonicalClassName(rawCname);
            const inferredLevel = inferNigerianClassLevel(canonicalName);
            if (pgClient) {
              await pgClient.query(
                `INSERT INTO classes (id, school_id, name, level, is_deleted, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [newClassId, schoolId, canonicalName, inferredLevel]
              );
            }
            cacheDb.prepare(`
              INSERT INTO classes (id, school_id, name, level, is_deleted, created_at, updated_at)
              VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(newClassId, schoolId, canonicalName, inferredLevel);
            matched = { id: newClassId, name: canonicalName };
          }
          if (matched) {
            targetClassId = matched.id;
            targetClassName = matched.name;
          }
        }
      }

      // Resolve Arm if requested
      if (hasArmUpdate && targetClassId !== null) {
        const rawAid = String(class_arm_id || '').trim();
        const rawAname = String(class_arm_name || '').trim();
        if (!rawAid && !rawAname) {
          targetArmId = null;
          targetArmName = null;
        } else if (rawAid) {
          let arm: any = null;
          if (pgClient) {
            const r = await pgClient.query('SELECT id, class_id, name FROM class_arms WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)', [rawAid, schoolId]);
            arm = r.rows[0];
          }
          if (!arm) {
            arm = cacheDb.prepare('SELECT id, class_id, name FROM class_arms WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(rawAid, schoolId);
          }
          if (!arm) {
            if (pgClient) await pgClient.query('ROLLBACK');
            return res.status(404).json({ error: 'ARM_NOT_FOUND', message: 'Selected class arm was not found in this school.' });
          }
          targetArmId = arm.id;
          targetArmName = arm.name;
        } else if (rawAname && targetClassId) {
          let armsList: any[] = [];
          if (pgClient) {
            const r = await pgClient.query('SELECT id, name FROM class_arms WHERE class_id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)', [targetClassId, schoolId]);
            armsList = r.rows;
          } else {
            armsList = cacheDb.prepare('SELECT id, name FROM class_arms WHERE class_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').all(targetClassId, schoolId) as any[];
          }
          let matchedArm = armsList.find((a) => String(a.name).trim().toLowerCase() === rawAname.toLowerCase());
          if (!matchedArm && create_missing_class !== false) {
            const newArmId = 'arm_' + crypto.randomUUID().slice(0, 8);
            if (pgClient) {
              await pgClient.query(
                `INSERT INTO class_arms (id, school_id, class_id, name, capacity, is_deleted, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 40, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [newArmId, schoolId, targetClassId, rawAname]
              );
            }
            cacheDb.prepare(`
              INSERT INTO class_arms (id, school_id, class_id, name, capacity, is_deleted, created_at, updated_at)
              VALUES (?, ?, ?, ?, 40, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(newArmId, schoolId, targetClassId, rawAname);
            matchedArm = { id: newArmId, name: rawAname };
          }
          if (matchedArm) {
            targetArmId = matchedArm.id;
            targetArmName = matchedArm.name;
          }
        }
      } else if (hasClassUpdate && !hasArmUpdate) {
        // Class changed without specifying arm -> clear stale arm to keep data clean
        targetArmId = null;
        targetArmName = null;
      }

      const cleanGender = hasGenderUpdate
        ? (String(gender).toLowerCase().startsWith('f') ? 'Female' : 'Male')
        : undefined;
      const cleanStatus = hasStatusUpdate ? String(student_status).trim().toUpperCase() : undefined;

      // Build updates dynamically
      let updatedCount = 0;
      const setsPg: string[] = ['updated_at = CURRENT_TIMESTAMP'];
      const valsPg: any[] = [];
      let idxPg = 1;

      const setsSq: string[] = ['updated_at = CURRENT_TIMESTAMP'];
      const valsSq: any[] = [];

      if (targetClassId !== undefined) {
        setsPg.push(`class_id = $${idxPg++}`);
        valsPg.push(targetClassId);
        setsSq.push('class_id = ?');
        valsSq.push(targetClassId);
      }
      if (targetClassName !== undefined) {
        setsPg.push(`class_name = $${idxPg++}`);
        valsPg.push(targetClassName);
        setsSq.push('class_name = ?');
        valsSq.push(targetClassName);
      }
      if (targetArmId !== undefined) {
        setsPg.push(`class_arm_id = $${idxPg++}`);
        valsPg.push(targetArmId);
        setsSq.push('class_arm_id = ?');
        valsSq.push(targetArmId);
      }
      if (targetArmName !== undefined) {
        setsPg.push(`class_arm_name = $${idxPg++}`);
        valsPg.push(targetArmName);
        setsSq.push('class_arm_name = ?');
        valsSq.push(targetArmName);
      }
      if (cleanGender !== undefined) {
        setsPg.push(`gender = $${idxPg++}`);
        valsPg.push(cleanGender);
        setsSq.push('gender = ?');
        valsSq.push(cleanGender);
      }
      if (cleanStatus !== undefined) {
        setsPg.push(`student_status = $${idxPg++}`);
        valsPg.push(cleanStatus);
        setsSq.push('student_status = ?');
        valsSq.push(cleanStatus);
      }

      if (pgClient) {
        const resPg = await pgClient.query(
          `UPDATE students SET ${setsPg.join(', ')}
           WHERE school_id = $${idxPg} AND id = ANY($${idxPg + 1}::text[]) AND (is_deleted = 0 OR is_deleted IS NULL)`,
          [...valsPg, schoolId, cleanStudentIds]
        );
        updatedCount = resPg.rowCount || 0;
        await pgClient.query('COMMIT');
        markPgConnected();
      }

      const placeholdersSq = cleanStudentIds.map(() => '?').join(', ');
      const sqRes = cacheDb.prepare(
        `UPDATE students SET ${setsSq.join(', ')}
         WHERE school_id = ? AND id IN (${placeholdersSq}) AND (is_deleted = 0 OR is_deleted IS NULL)`
      ).run(...valsSq, schoolId, ...cleanStudentIds);
      if (!pgClient) {
        updatedCount = Number(sqRes.changes || 0);
      }

      logAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        schoolId,
        action: 'BULK_ASSIGN_STUDENTS',
        entity: 'STUDENTS',
        ipAddress: req.ip || '127.0.0.1',
        metadata: {
          updatedCount,
          targetClassId,
          targetClassName,
          targetArmId,
          targetArmName,
          cleanGender,
          cleanStatus,
        },
      });

      return res.json({
        success: true,
        updatedCount,
        message: `Updated ${updatedCount} student record(s)${targetClassName ? ` → ${targetClassName}${targetArmName ? ` (${targetArmName})` : ''}` : ''}.`,
      });
    } catch (err: any) {
      if (pgClient) {
        try { await pgClient.query('ROLLBACK'); } catch {}
      }
      console.error('[Bulk Assign Students Error]', err);
      return res.status(500).json({ error: 'BULK_ASSIGN_FAILED', message: safeClientError(err) });
    } finally {
      if (pgClient) pgClient.release();
    }
  }
);

// POST /api/v1/school/students/assign-missing-admission-numbers (Backfill Nigerian Admission Numbers for existing unnumbered students)
apiRouter.post(
  '/v1/school/students/assign-missing-admission-numbers',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const result = await assignMissingAdmissionNumbersForSchool(schoolId);
    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'ASSIGN_MISSING_ADMISSION_NUMBERS',
      entity: 'STUDENTS',
      ipAddress: req.ip || '127.0.0.1',
      metadata: { assignedCount: result.assignedCount, prefix: result.prefix },
    });
    return res.json({
      success: true,
      ...result,
      message:
        result.assignedCount > 0
          ? `Assigned official Admission Numbers (${result.prefix}/...) to ${result.assignedCount} student(s).`
          : 'All enrolled students already have an official Admission Number.',
    });
  }
);

// GET /api/v1/school/students/export (Tenant-scoped student data export)
apiRouter.get(
  '/v1/school/students/export',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    let students: any[] = [];
    const pool = getPgPool();
    if (pool) {
      try {
        const pgRes = await queryPg(`
          SELECT admission_number, first_name, middle_name, last_name, full_name, gender,
                 date_of_birth, phone, email, class_name, class_arm_name, student_status,
                 state, admission_date, emergency_contact, created_at
          FROM students
          WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
          ORDER BY COALESCE(admission_number, 'ZZZZ') ASC, last_name ASC, first_name ASC
        `, [schoolId]);
        students = pgRes.rows;
      } catch (e: any) {
        console.warn('[Student Export PG Notice]', e.message);
      }
    }
    if (students.length === 0) {
      students = cacheDb.prepare(`
        SELECT admission_number, first_name, middle_name, last_name, full_name, gender,
               date_of_birth, phone, email, class_name, class_arm_name, student_status,
               state, admission_date, emergency_contact, created_at
        FROM students
        WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
        ORDER BY COALESCE(admission_number, 'ZZZZ') ASC, last_name ASC, first_name ASC
      `).all(schoolId) as any[];
    }

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
apiRouter.get('/v1/school/parents', requireAuth, requireTenant, requireRole(DIRECTORY_READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  try {
    let parents: any[] = [];
    const pool = getPgPool();
    const pgRes = pool ? await queryPg(`
      SELECT p.*,
             u.email as portal_user_email,
             u.full_name as portal_user_name,
             (SELECT COUNT(*) FROM parent_students ps WHERE ps.parent_id = p.id) as total_children
      FROM parents p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.school_id = $1 AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
      ORDER BY p.last_name ASC, p.first_name ASC
    `, [schoolId]) : null;

    if (pgRes) {
      parents = pgRes.rows;
      // Sync into cacheDb
      for (const p of parents) {
        cacheDb.prepare(`
          INSERT INTO parents (id, school_id, user_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact, is_deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            user_id = COALESCE(excluded.user_id, parents.user_id),
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            phone = excluded.phone,
            email = excluded.email,
            address = excluded.address,
            occupation = excluded.occupation,
            relationship = excluded.relationship,
            emergency_contact = excluded.emergency_contact,
            is_deleted = excluded.is_deleted,
            updated_at = excluded.updated_at
        `).run(
          p.id,
          p.school_id,
          p.user_id || null,
          p.first_name,
          p.last_name,
          p.phone || null,
          p.email || null,
          p.address || null,
          p.occupation || null,
          p.relationship || 'Parent',
          p.emergency_contact || null,
          p.is_deleted ? 1 : 0,
          p.created_at || new Date().toISOString(),
          p.updated_at || new Date().toISOString()
        );
      }
    } else {
      parents = cacheDb.prepare(`
        SELECT p.*,
               u.email as portal_user_email,
               u.full_name as portal_user_name,
               (SELECT COUNT(*) FROM parent_students ps WHERE ps.parent_id = p.id) as total_children
        FROM parents p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.school_id = ? AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
        ORDER BY p.last_name ASC, p.first_name ASC
      `).all(schoolId) as any[];
    }

    // Join children
    const parentsWithChildren = await Promise.all(parents.map(async (p) => {
      let children: any[] = [];
      const chPg = pool
        ? await queryPg(`
        SELECT s.id as student_id, s.admission_number, s.full_name, s.class_name, ps.relationship_type, ps.is_primary_contact
        FROM parent_students ps
        JOIN students s ON ps.student_id = s.id
        WHERE ps.parent_id = $1 AND ps.school_id = $2
      `, [p.id, schoolId])
        : null;

      if (chPg) {
        children = chPg.rows;
      } else {
        children = cacheDb.prepare(`
          SELECT s.id as student_id, s.admission_number, s.full_name, s.class_name, ps.relationship_type, ps.is_primary_contact
          FROM parent_students ps
          JOIN students s ON ps.student_id = s.id
          WHERE ps.parent_id = ? AND ps.school_id = ?
        `).all(p.id, schoolId);
      }
      return { ...p, children };
    }));

    return res.json({ success: true, count: parentsWithChildren.length, parents: parentsWithChildren });
  } catch (err: any) {
    console.error('[GET /v1/school/parents Error]', err);
    return res.status(500).json({ error: 'FETCH_FAILED', message: safeClientError(err) });
  }
});

// POST /api/v1/school/parents
apiRouter.post(
  '/v1/school/parents',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { first_name, last_name, phone, email, address, occupation, relationship, emergency_contact, student_ids } = req.body;

    // Flexible Parent Validation: Names required, phone and email optional
    if (!first_name || typeof first_name !== 'string' || !first_name.trim() || !last_name || typeof last_name !== 'string' || !last_name.trim()) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Parent first name and last name are required.' });
    }

    const safeFirstName = first_name.trim();
    const safeLastName = last_name.trim();
    const safePhone = phone && typeof phone === 'string' && phone.trim() ? phone.trim() : null;
    const safeEmail = email && typeof email === 'string' && email.trim() ? email.toLowerCase().trim() : null;
    const safeRelationship = relationship && typeof relationship === 'string' && relationship.trim() ? relationship.trim() : 'Parent';

    const id = 'par_' + crypto.randomUUID().slice(0, 10);
    const pool = getPgPool();

    // 1. Write authoritatively to Neon PostgreSQL first
    if (pool) {
      await queryPg(`
        INSERT INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        id,
        schoolId,
        safeFirstName,
        safeLastName,
        safePhone,
        safeEmail,
        address || null,
        occupation || null,
        safeRelationship,
        emergency_contact || null,
      ]);
    }

    // 2. Cache in local SQLite
    cacheDb.prepare(`
      INSERT INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        phone = excluded.phone,
        email = excluded.email,
        address = excluded.address,
        occupation = excluded.occupation,
        relationship = excluded.relationship,
        emergency_contact = excluded.emergency_contact,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      schoolId,
      safeFirstName,
      safeLastName,
      safePhone,
      safeEmail,
      address || null,
      occupation || null,
      safeRelationship,
      emergency_contact || null
    );

    // Link verified students belonging to this school only
    if (Array.isArray(student_ids)) {
      for (const sid of student_ids) {
        const pgStu = pool ? await queryPg('SELECT id FROM students WHERE id = $1 AND school_id = $2', [sid, schoolId]) : null;
        const validStu = pgStu?.rows[0] || cacheDb.prepare('SELECT id FROM students WHERE id = ? AND school_id = ?').get(sid, schoolId);
        if (!validStu) continue;

        const psId = 'ps_' + crypto.randomUUID().slice(0, 10);
        if (pool) {
          await queryPg(`
            INSERT INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact, verified_by, verified_at)
            VALUES ($1, $2, $3, $4, $5, 1, $6, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO NOTHING
          `, [psId, schoolId, id, sid, safeRelationship, req.user!.id]);
        }

        try {
          cacheDb.prepare(`
            INSERT INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact, verified_by, verified_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO NOTHING
          `).run(psId, schoolId, id, sid, safeRelationship, req.user!.id);
        } catch {}
      }
    }

    const pgParent = pool ? await queryPg('SELECT * FROM parents WHERE id = $1', [id]) : null;
    const parent = pgParent?.rows[0] || cacheDb.prepare('SELECT * FROM parents WHERE id = ?').get(id);

    return res.status(201).json({ success: true, message: 'Parent record created successfully', parent });
  }
);

// PUT /api/v1/school/parents/:id
apiRouter.put(
  '/v1/school/parents/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const pool = getPgPool();

    let existing: any = null;
    const pgCheck = pool ? await queryPg('SELECT * FROM parents WHERE id = $1', [id]) : null;
    if (pgCheck && pgCheck.rows.length > 0) {
      existing = pgCheck.rows[0];
    } else {
      existing = cacheDb.prepare('SELECT * FROM parents WHERE id = ?').get(id) as any;
    }

    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Parent not found.' });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot edit parent of another school.' });
    }

    const b = req.body || {};
    const safeFirst = b.first_name !== undefined ? (b.first_name ? b.first_name.trim() : null) : null;
    const safeLast = b.last_name !== undefined ? (b.last_name ? b.last_name.trim() : null) : null;
    const safePhone = b.phone !== undefined ? (b.phone ? b.phone.trim() : null) : null;
    const safeEmail = b.email !== undefined ? (b.email ? b.email.toLowerCase().trim() : null) : null;

    if (pool) {
      await queryPg(`
        UPDATE parents SET
          first_name = COALESCE($1, first_name),
          last_name = COALESCE($2, last_name),
          phone = COALESCE($3, phone),
          email = COALESCE($4, email),
          address = COALESCE($5, address),
          occupation = COALESCE($6, occupation),
          relationship = COALESCE($7, relationship),
          emergency_contact = COALESCE($8, emergency_contact),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9 AND school_id = $10
      `, [
        safeFirst,
        safeLast,
        safePhone,
        safeEmail,
        b.address || null,
        b.occupation || null,
        b.relationship || null,
        b.emergency_contact || null,
        id,
        schoolId
      ]);
    }

    cacheDb.prepare(`
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
      safeFirst,
      safeLast,
      safePhone,
      safeEmail,
      b.address || null,
      b.occupation || null,
      b.relationship || null,
      b.emergency_contact || null,
      id,
      schoolId
    );

    const updatedPg = pool ? await queryPg('SELECT * FROM parents WHERE id = $1', [id]) : null;
    const updated = updatedPg?.rows[0] || cacheDb.prepare('SELECT * FROM parents WHERE id = ?').get(id);
    return res.json({ success: true, message: 'Parent updated successfully', parent: updated });
  }
);

// DELETE /api/v1/school/parents/:id (Controlled soft-deletion to Recycle Bin)
apiRouter.delete(
  '/v1/school/parents/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const pool = getPgPool();

    let existing: any = null;
    const pgCheck = pool ? await queryPg('SELECT * FROM parents WHERE id = $1', [id]) : null;
    if (pgCheck && pgCheck.rows.length > 0) {
      existing = pgCheck.rows[0];
    } else {
      existing = cacheDb.prepare('SELECT * FROM parents WHERE id = ?').get(id) as any;
    }

    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Parent not found.' });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot delete parent of another school.' });
    }

    const reason = req.body?.reason || 'Parent archived by School Admin';
    if (pool) {
      await queryPg(`
        UPDATE parents 
        SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1, deletion_reason = $2 
        WHERE id = $3 AND school_id = $4
      `, [req.user!.email, reason, id, schoolId]);
    }

    cacheDb.prepare(`
      UPDATE parents 
      SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, deletion_reason = ? 
      WHERE id = ? AND school_id = ?
    `).run(req.user!.email, reason, id, schoolId);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'SOFT_DELETE_PARENT',
      entity: 'PARENT',
      entityId: id,
      metadata: { parentName: `${existing.first_name} ${existing.last_name}` },
    });

    return res.json({ success: true, message: 'Parent record safely moved to Recycle Bin.' });
  }
);

// ==============================================================================
// CLASSES & CLASS ARMS ENDPOINTS
// ==============================================================================

function parseArmNamesInput(armsInput?: string | string[] | null): string[] {
  const rawList: string[] = Array.isArray(armsInput)
    ? armsInput.map((x) => String(x || ''))
    : typeof armsInput === 'string'
      ? armsInput.split(/[,;\n]+/)
      : [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const item of rawList) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      clean.push(trimmed);
    }
  }
  return clean;
}

const NIGERIAN_CLASS_PRESETS = {
  PRIMARY: [
    { name: 'Nursery 1', level: 'Early Years / Nursery', description: 'Early Years Reception 1', arms: ['A', 'B'] },
    { name: 'Nursery 2', level: 'Early Years / Nursery', description: 'Early Years Reception 2', arms: ['A', 'B'] },
    { name: 'Primary 1', level: 'Primary', description: 'Lower Basic 1', arms: ['A', 'B'] },
    { name: 'Primary 2', level: 'Primary', description: 'Lower Basic 2', arms: ['A', 'B'] },
    { name: 'Primary 3', level: 'Primary', description: 'Lower Basic 3', arms: ['A', 'B'] },
    { name: 'Primary 4', level: 'Primary', description: 'Middle Basic 4', arms: ['A', 'B'] },
    { name: 'Primary 5', level: 'Primary', description: 'Middle Basic 5', arms: ['A', 'B'] },
    { name: 'Primary 6', level: 'Primary', description: 'Upper Primary / Common Entrance', arms: ['A', 'B'] },
  ],
  SECONDARY: [
    { name: 'JSS 1', level: 'Junior Secondary', description: 'Junior Secondary School 1 (Basic 7)', arms: ['Gold', 'Silver'] },
    { name: 'JSS 2', level: 'Junior Secondary', description: 'Junior Secondary School 2 (Basic 8)', arms: ['Gold', 'Silver'] },
    { name: 'JSS 3', level: 'Junior Secondary', description: 'Junior Secondary School 3 (BECE / Basic 9)', arms: ['Gold', 'Silver'] },
    { name: 'SSS 1', level: 'Senior Secondary', description: 'Senior Secondary School 1', arms: ['Science', 'Art', 'Commercial'] },
    { name: 'SSS 2', level: 'Senior Secondary', description: 'Senior Secondary School 2', arms: ['Science', 'Art', 'Commercial'] },
    { name: 'SSS 3', level: 'Senior Secondary', description: 'Senior Secondary School 3 (WAEC / NECO)', arms: ['Science', 'Art', 'Commercial'] },
  ],
  UNIVERSITY: [
    { name: '100 Level', level: 'Undergraduate', description: 'Year 1 Undergraduate Level', arms: ['Computer Science', 'Accounting', 'Business Administration', 'General Studies'] },
    { name: '200 Level', level: 'Undergraduate', description: 'Year 2 Undergraduate Level', arms: ['Computer Science', 'Accounting', 'Business Administration', 'General Studies'] },
    { name: '300 Level', level: 'Undergraduate', description: 'Year 3 Undergraduate Level', arms: ['Computer Science', 'Accounting', 'Business Administration'] },
    { name: '400 Level', level: 'Undergraduate', description: 'Final Year Undergraduate Level', arms: ['Computer Science', 'Accounting', 'Business Administration'] },
    { name: '500 Level', level: 'Undergraduate', description: 'Professional / 5-Year Degree Level', arms: ['Engineering', 'Law', 'Health Sciences'] },
  ],
  POLYTECHNIC: [
    { name: 'ND 1', level: 'National Diploma', description: 'National Diploma Year 1', arms: ['Computer Science', 'Accountancy', 'Business Admin', 'Science Lab Tech'] },
    { name: 'ND 2', level: 'National Diploma', description: 'National Diploma Year 2', arms: ['Computer Science', 'Accountancy', 'Business Admin', 'Science Lab Tech'] },
    { name: 'HND 1', level: 'Higher National Diploma', description: 'Higher National Diploma Year 1', arms: ['Computer Science', 'Accountancy', 'Business Admin', 'Science Lab Tech'] },
    { name: 'HND 2', level: 'Higher National Diploma', description: 'Higher National Diploma Year 2', arms: ['Computer Science', 'Accountancy', 'Business Admin', 'Science Lab Tech'] },
  ],
  COLLEGE: [
    { name: 'Year 1 (100L)', level: 'College / Diploma', description: 'First Year Programme Level', arms: ['Community Health', 'Public Health', 'Health Info Mgmt', 'General'] },
    { name: 'Year 2 (200L)', level: 'College / Diploma', description: 'Second Year Programme Level', arms: ['Community Health', 'Public Health', 'Health Info Mgmt', 'General'] },
    { name: 'Year 3 (300L)', level: 'College / Diploma', description: 'Final Year Programme Level', arms: ['Community Health', 'Public Health', 'Health Info Mgmt', 'General'] },
  ],
};

// GET /api/v1/school/classes (Returns classes with arms and student totals)
apiRouter.get('/v1/school/classes', requireAuth, requireTenant, requireRole(ACADEMIC_READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const pool = getPgPool();
  try {
    let classes: any[] = [];
    const pgClasses = pool
      ? await queryPg(`
      SELECT c.*,
             (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND (s.is_deleted = 0 OR s.is_deleted IS NULL)) as total_students
      FROM classes c
      WHERE c.school_id = $1 AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
      ORDER BY c.name ASC
    `, [schoolId])
      : null;

    if (pgClasses) {
      classes = pgClasses.rows.map((c: any) => ({
        ...c,
        level: c.level || inferNigerianClassLevel(c.name),
      }));
      for (const cls of classes) {
        try {
          cacheDb.prepare(`
            INSERT INTO classes (id, school_id, name, level, description, academic_session_id, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              level = excluded.level,
              description = excluded.description,
              academic_session_id = excluded.academic_session_id,
              is_deleted = excluded.is_deleted,
              updated_at = excluded.updated_at
          `).run(
            cls.id,
            cls.school_id,
            cls.name,
            cls.level || 'General',
            cls.description || null,
            cls.academic_session_id || null,
            cls.is_deleted ? 1 : 0,
            cls.created_at || new Date().toISOString(),
            cls.updated_at || new Date().toISOString()
          );
        } catch {}
      }
    } else {
      classes = cacheDb.prepare(`
        SELECT c.*,
               (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND (s.is_deleted = 0 OR s.is_deleted IS NULL)) as total_students
        FROM classes c
        WHERE c.school_id = ? AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
        ORDER BY c.name ASC
      `).all(schoolId) as any[];
    }

    const classesWithArms = await Promise.all(classes.map(async (cls) => {
      let arms: any[] = [];
      const pgArms = pool
        ? await queryPg(`
        SELECT ca.*,
               (SELECT COUNT(*) FROM students s WHERE s.class_arm_id = ca.id AND (s.is_deleted = 0 OR s.is_deleted IS NULL)) as total_students,
               (SELECT (first_name || ' ' || last_name) FROM staff st WHERE st.id = ca.class_teacher_id) as class_teacher_name
        FROM class_arms ca
        WHERE ca.class_id = $1 AND ca.school_id = $2 AND (ca.is_deleted = 0 OR ca.is_deleted IS NULL)
        ORDER BY ca.name ASC
      `, [cls.id, schoolId])
        : null;

      if (pgArms) {
        arms = pgArms.rows;
        for (const arm of arms) {
          try {
            cacheDb.prepare(`
              INSERT INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id, is_deleted, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                capacity = excluded.capacity,
                class_teacher_id = excluded.class_teacher_id,
                is_deleted = 0,
                updated_at = excluded.updated_at
            `).run(
              arm.id,
              arm.school_id,
              arm.class_id,
              arm.name,
              arm.capacity || 40,
              arm.class_teacher_id || null,
              arm.created_at || new Date().toISOString(),
              arm.updated_at || new Date().toISOString()
            );
          } catch {}
        }
      } else {
        arms = cacheDb.prepare(`
          SELECT ca.*,
                 (SELECT COUNT(*) FROM students s WHERE s.class_arm_id = ca.id AND (s.is_deleted = 0 OR s.is_deleted IS NULL)) as total_students,
                 (SELECT (first_name || ' ' || last_name) FROM staff st WHERE st.id = ca.class_teacher_id) as class_teacher_name
          FROM class_arms ca
          WHERE ca.class_id = ? AND ca.school_id = ? AND (ca.is_deleted = 0 OR ca.is_deleted IS NULL)
          ORDER BY ca.name ASC
        `).all(cls.id, schoolId);
      }
      return { ...cls, arms };
    }));

    return res.json({ success: true, count: classesWithArms.length, classes: classesWithArms });
  } catch (err: any) {
    console.error('[GET /v1/school/classes Error]', err);
    return res.status(500).json({ error: 'FETCH_FAILED', message: safeClientError(err) });
  }
});

// POST /api/v1/school/classes/bulk-setup (Transactional single-call Nigerian preset setup)
apiRouter.post(
  '/v1/school/classes/bulk-setup',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const mode = String(req.body?.mode || 'SECONDARY').toUpperCase();
    const templates =
      mode === 'PRIMARY'
        ? NIGERIAN_CLASS_PRESETS.PRIMARY
        : mode === 'K12'
          ? [...NIGERIAN_CLASS_PRESETS.PRIMARY, ...NIGERIAN_CLASS_PRESETS.SECONDARY]
          : mode === 'UNIVERSITY'
            ? NIGERIAN_CLASS_PRESETS.UNIVERSITY
            : mode === 'POLYTECHNIC'
              ? NIGERIAN_CLASS_PRESETS.POLYTECHNIC
              : mode === 'COLLEGE'
                ? NIGERIAN_CLASS_PRESETS.COLLEGE
                : NIGERIAN_CLASS_PRESETS.SECONDARY;

    const pool = getPgPool();
    let pgClient: any = null;
    if (pool) {
      try {
        pgClient = await pool.connect();
        await pgClient.query('BEGIN');
      } catch (err: any) {
        return res.status(503).json({ error: 'DATABASE_UNAVAILABLE', message: 'Cloud database connection failed.' });
      }
    }

    try {
      const existingClassesMap = new Map<string, any>();
      if (pgClient) {
        const resC = await pgClient.query(
          'SELECT id, name FROM classes WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)',
          [schoolId]
        );
        for (const c of resC.rows) {
          existingClassesMap.set(normalizeClassMatchKey(c.name), c);
        }
      } else {
        const rowsC = cacheDb.prepare(
          'SELECT id, name FROM classes WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)'
        ).all(schoolId) as any[];
        for (const c of rowsC) {
          existingClassesMap.set(normalizeClassMatchKey(c.name), c);
        }
      }

      let createdClassesCount = 0;
      let createdArmsCount = 0;

      for (const tpl of templates) {
        const key = normalizeClassMatchKey(tpl.name);
        let cls = existingClassesMap.get(key);
        if (!cls) {
          const classId = 'cls_' + crypto.randomUUID().slice(0, 8);
          if (pgClient) {
            await pgClient.query(
              `INSERT INTO classes (id, school_id, name, level, description, is_deleted, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [classId, schoolId, tpl.name, tpl.level, tpl.description]
            );
          }
          cacheDb.prepare(`
            INSERT INTO classes (id, school_id, name, level, description, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).run(classId, schoolId, tpl.name, tpl.level, tpl.description);
          cls = { id: classId, name: tpl.name };
          existingClassesMap.set(key, cls);
          createdClassesCount++;
        }

        // Load existing arms on this class and fill missing preset arms
        const existingArmKeys = new Set<string>();
        if (pgClient) {
          const resA = await pgClient.query(
            'SELECT name FROM class_arms WHERE class_id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)',
            [cls.id, schoolId]
          );
          for (const a of resA.rows) existingArmKeys.add(String(a.name).trim().toLowerCase());
        } else {
          const rowsA = cacheDb.prepare(
            'SELECT name FROM class_arms WHERE class_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)'
          ).all(cls.id, schoolId) as any[];
          for (const a of rowsA) existingArmKeys.add(String(a.name).trim().toLowerCase());
        }

        for (const armName of tpl.arms) {
          if (existingArmKeys.has(armName.toLowerCase())) continue;
          const armId = 'arm_' + crypto.randomUUID().slice(0, 8);
          if (pgClient) {
            await pgClient.query(
              `INSERT INTO class_arms (id, school_id, class_id, name, capacity, is_deleted, created_at, updated_at)
               VALUES ($1, $2, $3, $4, 40, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [armId, schoolId, cls.id, armName]
            );
          }
          cacheDb.prepare(`
            INSERT INTO class_arms (id, school_id, class_id, name, capacity, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, 40, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).run(armId, schoolId, cls.id, armName);
          existingArmKeys.add(armName.toLowerCase());
          createdArmsCount++;
        }
      }

      if (pgClient) {
        await pgClient.query('COMMIT');
        markPgConnected();
      }

      logAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        schoolId,
        action: 'BULK_SETUP_CLASSES',
        entity: 'CLASSES',
        metadata: { mode, createdClassesCount, createdArmsCount },
      });

      return res.json({
        success: true,
        createdClassesCount,
        createdArmsCount,
        message:
          createdClassesCount === 0 && createdArmsCount === 0
            ? 'Nigerian classes and streams are already configured for this school.'
            : `Created ${createdClassesCount} class(es) and ${createdArmsCount} arm(s)/stream(s) successfully.`,
      });
    } catch (err: any) {
      if (pgClient) {
        try { await pgClient.query('ROLLBACK'); } catch {}
      }
      console.error('[POST /v1/school/classes/bulk-setup Error]', err);
      return res.status(500).json({ error: 'BULK_SETUP_FAILED', message: safeClientError(err) });
    } finally {
      if (pgClient) pgClient.release();
    }
  }
);

// POST /api/v1/school/classes
apiRouter.post(
  '/v1/school/classes',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { name, level, description, academic_session_id, arms, arm_capacity = 40 } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim() || !level || typeof level !== 'string' || !level.trim()) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Class name and level are required.' });
    }

    const safeName = name.trim();
    const safeLevel = level.trim();
    const pool = getPgPool();

    try {
      // Check duplicate class name in school
      const dupPg = pool
        ? await queryPg(
            'SELECT id FROM classes WHERE school_id = $1 AND LOWER(name) = LOWER($2) AND (is_deleted = 0 OR is_deleted IS NULL)',
            [schoolId, safeName]
          )
        : null;
      const dupSq = cacheDb
        .prepare('SELECT id FROM classes WHERE school_id = ? AND LOWER(name) = LOWER(?) AND (is_deleted = 0 OR is_deleted IS NULL)')
        .get(schoolId, safeName);

      if ((dupPg && dupPg.rows.length > 0) || dupSq) {
        return res.status(409).json({
          error: 'DUPLICATE_CLASS',
          message: `Class "${safeName}" already exists in this school. You can add arms directly on its card.`,
        });
      }

      const id = 'cls_' + crypto.randomUUID().slice(0, 8);
      if (pool) {
        await queryPg(`
          INSERT INTO classes (id, school_id, name, level, description, academic_session_id, is_deleted, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [id, schoolId, safeName, safeLevel, description || null, academic_session_id || null]);
      }

      cacheDb.prepare(`
        INSERT INTO classes (id, school_id, name, level, description, academic_session_id, is_deleted, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          level = excluded.level,
          description = excluded.description,
          academic_session_id = excluded.academic_session_id,
          is_deleted = 0,
          updated_at = CURRENT_TIMESTAMP
      `).run(id, schoolId, safeName, safeLevel, description || null, academic_session_id || null);

      const requestedArms = parseArmNamesInput(arms);
      const safeCap = parseInt(String(arm_capacity), 10) || 40;
      const createdArms: any[] = [];
      for (const armName of requestedArms) {
        const armId = 'arm_' + crypto.randomUUID().slice(0, 8);
        if (pool) {
          await queryPg(`
            INSERT INTO class_arms (id, school_id, class_id, name, capacity, is_deleted, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `, [armId, schoolId, id, armName, safeCap]);
        }
        cacheDb.prepare(`
          INSERT INTO class_arms (id, school_id, class_id, name, capacity, is_deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(armId, schoolId, id, armName, safeCap);
        createdArms.push({ id: armId, school_id: schoolId, class_id: id, name: armName, capacity: safeCap });
      }

      const pgCreated = pool ? await queryPg('SELECT * FROM classes WHERE id = $1', [id]) : null;
      const created = pgCreated?.rows[0] || cacheDb.prepare('SELECT * FROM classes WHERE id = ?').get(id);
      return res.status(201).json({
        success: true,
        message: createdArms.length > 0
          ? `Class "${safeName}" created with ${createdArms.length} arm(s).`
          : `Class "${safeName}" created successfully.`,
        class: { ...created, arms: createdArms },
      });
    } catch (err: any) {
      console.error('[POST /v1/school/classes Error]', err);
      return res.status(500).json({ error: 'CLASS_CREATE_FAILED', message: safeClientError(err) });
    }
  }
);

// POST /api/v1/school/classes/:id/arms (Create one or multiple comma-separated class arms)
apiRouter.post(
  '/v1/school/classes/:id/arms',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: classId } = req.params;
    const { name, arms, capacity = 40, class_teacher_id } = req.body || {};
    const pool = getPgPool();

    try {
      let cls: any = null;
      const pgCls = pool ? await queryPg('SELECT * FROM classes WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)', [classId, schoolId]) : null;
      if (pgCls && pgCls.rows.length > 0) {
        cls = pgCls.rows[0];
      } else {
        cls = cacheDb.prepare('SELECT * FROM classes WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(classId, schoolId);
        // Ensure parent class also exists in Neon PG if created earlier in cache only
        if (cls && pool) {
          try {
            await queryPg(`
              INSERT INTO classes (id, school_id, name, level, description, academic_session_id, is_deleted, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT (id) DO NOTHING
            `, [cls.id, schoolId, cls.name, cls.level || 'General', cls.description || null, cls.academic_session_id || null]);
          } catch {}
        }
      }

      if (!cls) {
        return res.status(404).json({ error: 'CLASS_NOT_FOUND', message: 'Class not found in this school.' });
      }

      const armNames = parseArmNamesInput(Array.isArray(arms) && arms.length > 0 ? arms : name);
      if (armNames.length === 0) {
        return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Arm name is required (e.g. Gold, A, Science).' });
      }

      const safeCapacity = parseInt(String(capacity), 10) || 40;
      let verifiedTeacherId: string | null = null;
      if (class_teacher_id && String(class_teacher_id).trim()) {
        const cleanTeacherId = String(class_teacher_id).trim();
        const pgStaff = pool
          ? await queryPg('SELECT id FROM staff WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)', [cleanTeacherId, schoolId])
          : null;
        const sqStaff = cacheDb
          .prepare('SELECT id FROM staff WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)')
          .get(cleanTeacherId, schoolId);
        if ((pgStaff && pgStaff.rows.length > 0) || sqStaff) {
          verifiedTeacherId = cleanTeacherId;
        }
      }

      // Check existing active arms in this class to skip duplicates
      const existingArmNames = new Set<string>();
      if (pool) {
        const exRes = await queryPg(
          'SELECT name FROM class_arms WHERE class_id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)',
          [classId, schoolId]
        );
        for (const r of exRes.rows) existingArmNames.add(String(r.name).trim().toLowerCase());
      } else {
        const exRows = cacheDb
          .prepare('SELECT name FROM class_arms WHERE class_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)')
          .all(classId, schoolId) as any[];
        for (const r of exRows) existingArmNames.add(String(r.name).trim().toLowerCase());
      }

      const toCreate = armNames.filter((n) => !existingArmNames.has(n.toLowerCase()));
      const skippedDuplicates = armNames.filter((n) => existingArmNames.has(n.toLowerCase()));

      if (toCreate.length === 0) {
        return res.status(409).json({
          error: 'DUPLICATE_ARM',
          message: `Arm(s) ${skippedDuplicates.join(', ')} already exist under ${cls.name}.`,
        });
      }

      const createdArms: any[] = [];
      for (const safeName of toCreate) {
        const armId = 'arm_' + crypto.randomUUID().slice(0, 8);
        if (pool) {
          await queryPg(`
            INSERT INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id, is_deleted, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `, [armId, schoolId, classId, safeName, safeCapacity, verifiedTeacherId]);
        }

        cacheDb.prepare(`
          INSERT INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id, is_deleted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            capacity = excluded.capacity,
            class_teacher_id = excluded.class_teacher_id,
            is_deleted = 0,
            updated_at = CURRENT_TIMESTAMP
        `).run(armId, schoolId, classId, safeName, safeCapacity, verifiedTeacherId);

        const pgArm = pool
          ? await queryPg(
              `SELECT ca.*, (SELECT (first_name || ' ' || last_name) FROM staff st WHERE st.id = ca.class_teacher_id) as class_teacher_name
               FROM class_arms ca WHERE ca.id = $1`,
              [armId]
            )
          : null;
        const arm =
          pgArm?.rows[0] ||
          cacheDb
            .prepare(
              `SELECT ca.*, (SELECT (first_name || ' ' || last_name) FROM staff st WHERE st.id = ca.class_teacher_id) as class_teacher_name
               FROM class_arms ca WHERE ca.id = ?`
            )
            .get(armId);
        createdArms.push(arm);
      }

      return res.status(201).json({
        success: true,
        message:
          createdArms.length === 1
            ? `Class arm "${createdArms[0].name}" created successfully.`
            : `Created ${createdArms.length} class arm(s) under ${cls.name}.`,
        arm: createdArms[0],
        arms: createdArms,
        createdCount: createdArms.length,
        skippedDuplicates,
      });
    } catch (err: any) {
      console.error('[POST /v1/school/classes/:id/arms Error]', err);
      return res.status(500).json({ error: 'CREATE_ARM_FAILED', message: safeClientError(err) });
    }
  }
);

// PUT /api/v1/school/classes/:id/arms/:armId (Update class arm name, capacity, or form teacher)
apiRouter.put(
  '/v1/school/classes/:id/arms/:armId',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: classId, armId } = req.params;
    const { name, capacity, class_teacher_id } = req.body || {};
    const pool = getPgPool();

    try {
      let existing: any = null;
      if (pool) {
        const r = await queryPg(
          'SELECT * FROM class_arms WHERE id = $1 AND class_id = $2 AND school_id = $3 AND (is_deleted = 0 OR is_deleted IS NULL)',
          [armId, classId, schoolId]
        );
        existing = r.rows[0];
      }
      if (!existing) {
        existing = cacheDb
          .prepare('SELECT * FROM class_arms WHERE id = ? AND class_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)')
          .get(armId, classId, schoolId);
      }
      if (!existing) {
        return res.status(404).json({ error: 'ARM_NOT_FOUND', message: 'Class arm not found in this class.' });
      }

      const safeName = name !== undefined ? String(name).trim() : existing.name;
      if (!safeName) {
        return res.status(400).json({ error: 'INVALID_NAME', message: 'Arm name cannot be empty.' });
      }

      // Check duplicate name with sibling arms
      if (safeName.toLowerCase() !== String(existing.name).trim().toLowerCase()) {
        const dupPg = pool
          ? await queryPg(
              'SELECT id FROM class_arms WHERE class_id = $1 AND school_id = $2 AND LOWER(name) = LOWER($3) AND id != $4 AND (is_deleted = 0 OR is_deleted IS NULL)',
              [classId, schoolId, safeName, armId]
            )
          : null;
        const dupSq = cacheDb
          .prepare(
            'SELECT id FROM class_arms WHERE class_id = ? AND school_id = ? AND LOWER(name) = LOWER(?) AND id != ? AND (is_deleted = 0 OR is_deleted IS NULL)'
          )
          .get(classId, schoolId, safeName, armId);
        if ((dupPg && dupPg.rows.length > 0) || dupSq) {
          return res.status(409).json({ error: 'DUPLICATE_ARM', message: `Another arm named "${safeName}" already exists in this class.` });
        }
      }

      const safeCap = capacity !== undefined ? (parseInt(String(capacity), 10) || 40) : existing.capacity;
      let resolvedTeacherId = existing.class_teacher_id || null;
      if (class_teacher_id !== undefined) {
        resolvedTeacherId = class_teacher_id && String(class_teacher_id).trim() ? String(class_teacher_id).trim() : null;
      }

      if (pool) {
        await queryPg(
          `UPDATE class_arms SET name = $1, capacity = $2, class_teacher_id = $3, updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND class_id = $5 AND school_id = $6`,
          [safeName, safeCap, resolvedTeacherId, armId, classId, schoolId]
        );
        if (safeName !== existing.name) {
          await queryPg(
            'UPDATE students SET class_arm_name = $1, updated_at = CURRENT_TIMESTAMP WHERE class_arm_id = $2 AND school_id = $3',
            [safeName, armId, schoolId]
          );
        }
      }

      cacheDb
        .prepare(
          `UPDATE class_arms SET name = ?, capacity = ?, class_teacher_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND class_id = ? AND school_id = ?`
        )
        .run(safeName, safeCap, resolvedTeacherId, armId, classId, schoolId);
      if (safeName !== existing.name) {
        cacheDb
          .prepare('UPDATE students SET class_arm_name = ?, updated_at = CURRENT_TIMESTAMP WHERE class_arm_id = ? AND school_id = ?')
          .run(safeName, armId, schoolId);
      }

      const pgUpdated = pool
        ? await queryPg(
            `SELECT ca.*, (SELECT (first_name || ' ' || last_name) FROM staff st WHERE st.id = ca.class_teacher_id) as class_teacher_name
             FROM class_arms ca WHERE ca.id = $1`,
            [armId]
          )
        : null;
      const updated =
        pgUpdated?.rows[0] ||
        cacheDb
          .prepare(
            `SELECT ca.*, (SELECT (first_name || ' ' || last_name) FROM staff st WHERE st.id = ca.class_teacher_id) as class_teacher_name
             FROM class_arms ca WHERE ca.id = ?`
          )
          .get(armId);

      return res.json({ success: true, message: 'Class arm updated successfully.', arm: updated });
    } catch (err: any) {
      console.error('[PUT /v1/school/classes/:id/arms/:armId Error]', err);
      return res.status(500).json({ error: 'UPDATE_ARM_FAILED', message: safeClientError(err) });
    }
  }
);

// DELETE /api/v1/school/classes/:id/arms/:armId (Delete/Archive class arm)
apiRouter.delete(
  '/v1/school/classes/:id/arms/:armId',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: classId, armId } = req.params;
    const force = req.query.force === 'true' || req.body?.force === true;
    const pool = getPgPool();

    try {
      let existing: any = null;
      if (pool) {
        const r = await queryPg(
          'SELECT * FROM class_arms WHERE id = $1 AND class_id = $2 AND school_id = $3 AND (is_deleted = 0 OR is_deleted IS NULL)',
          [armId, classId, schoolId]
        );
        existing = r.rows[0];
      }
      if (!existing) {
        existing = cacheDb
          .prepare('SELECT * FROM class_arms WHERE id = ? AND class_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)')
          .get(armId, classId, schoolId);
      }
      if (!existing) {
        return res.status(404).json({ error: 'ARM_NOT_FOUND', message: 'Class arm not found.' });
      }

      let enrolledStudents = 0;
      if (pool) {
        const cRes = await queryPg(
          'SELECT COUNT(*) as c FROM students WHERE class_arm_id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)',
          [armId, schoolId]
        );
        enrolledStudents = parseInt(cRes.rows[0]?.c || '0', 10);
      } else {
        enrolledStudents = (
          cacheDb
            .prepare('SELECT COUNT(*) as c FROM students WHERE class_arm_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)')
            .get(armId, schoolId) as any
        )?.c || 0;
      }

      if (enrolledStudents > 0 && !force) {
        return res.status(400).json({
          error: 'ARM_NOT_EMPTY',
          message: `Cannot remove arm "${existing.name}": ${enrolledStudents} student(s) currently assigned. Confirm unlink or reassign students first.`,
        });
      }

      const reason = req.body?.reason || 'Class arm removed by School Admin';
      if (pool) {
        if (enrolledStudents > 0) {
          await queryPg(
            'UPDATE students SET class_arm_id = NULL, class_arm_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE class_arm_id = $1 AND school_id = $2',
            [armId, schoolId]
          );
        }
        await queryPg(
          `UPDATE class_arms SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1, deletion_reason = $2
           WHERE id = $3 AND class_id = $4 AND school_id = $5`,
          [req.user!.email, reason, armId, classId, schoolId]
        );
      }

      if (enrolledStudents > 0) {
        cacheDb
          .prepare('UPDATE students SET class_arm_id = NULL, class_arm_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE class_arm_id = ? AND school_id = ?')
          .run(armId, schoolId);
      }
      cacheDb
        .prepare(
          `UPDATE class_arms SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, deletion_reason = ?
           WHERE id = ? AND class_id = ? AND school_id = ?`
        )
        .run(req.user!.email, reason, armId, classId, schoolId);

      return res.json({ success: true, message: `Class arm "${existing.name}" removed.` });
    } catch (err: any) {
      console.error('[DELETE /v1/school/classes/:id/arms/:armId Error]', err);
      return res.status(500).json({ error: 'DELETE_ARM_FAILED', message: safeClientError(err) });
    }
  }
);

// DELETE /api/v1/school/classes/:id (Controlled soft-deletion to Recycle Bin)
apiRouter.delete(
  '/v1/school/classes/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const pool = getPgPool();

    try {
      let cls: any = null;
      const pgCls = pool ? await queryPg('SELECT id, school_id, name FROM classes WHERE id = $1', [id]) : null;
      if (pgCls && pgCls.rows.length > 0) {
        cls = pgCls.rows[0];
      } else {
        cls = cacheDb.prepare('SELECT id, school_id, name FROM classes WHERE id = ?').get(id) as any;
      }

      if (!cls) return res.status(404).json({ error: 'NOT_FOUND', message: 'Class not found.' });
      if (cls.school_id !== schoolId) {
        return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot delete class of another school.' });
      }

      let enrolledStudents = 0;
      const pgCount = pool ? await queryPg('SELECT COUNT(*) as c FROM students WHERE class_id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)', [id, schoolId]) : null;
      if (pgCount) {
        enrolledStudents = parseInt(pgCount.rows[0]?.c || '0', 10);
      } else {
        enrolledStudents = (cacheDb.prepare('SELECT COUNT(*) as c FROM students WHERE class_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(id, schoolId) as any)?.c || 0;
      }

      if (enrolledStudents > 0) {
        return res.status(400).json({
          error: 'CLASS_NOT_EMPTY',
          message: `Cannot delete class "${cls.name}": ${enrolledStudents} active student(s) currently enrolled. Please reassign students first.`,
        });
      }

      const reason = req.body?.reason || 'Class archived by School Admin';
      if (pool) {
        await queryPg(`
          UPDATE classes 
          SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1, deletion_reason = $2 
          WHERE id = $3 AND school_id = $4
        `, [req.user!.email, reason, id, schoolId]);
        await queryPg(`
          UPDATE class_arms 
          SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1, deletion_reason = $2 
          WHERE class_id = $3 AND school_id = $4
        `, [req.user!.email, reason, id, schoolId]);
      }

      cacheDb.prepare(`
        UPDATE classes 
        SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, deletion_reason = ? 
        WHERE id = ? AND school_id = ?
      `).run(req.user!.email, reason, id, schoolId);
      cacheDb.prepare(`
        UPDATE class_arms 
        SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, deletion_reason = ? 
        WHERE class_id = ? AND school_id = ?
      `).run(req.user!.email, reason, id, schoolId);

      logAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        schoolId,
        action: 'SOFT_DELETE_CLASS',
        entity: 'CLASS',
        entityId: id,
        metadata: { className: cls.name },
      });

      return res.json({ success: true, message: 'Class safely moved to Recycle Bin.' });
    } catch (err: any) {
      console.error('[DELETE /v1/school/classes/:id Error]', err);
      return res.status(500).json({ error: 'DELETE_CLASS_FAILED', message: safeClientError(err) });
    }
  }
);

// ==============================================================================
// STAFF MANAGEMENT ENDPOINTS
// ==============================================================================

// GET /api/v1/school/staff
apiRouter.get('/v1/school/staff', requireAuth, requireTenant, requireRole(DIRECTORY_READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const pool = getPgPool();
  try {
    let staff: any[] = [];
    const pgRes = pool
      ? await queryPg(`
      SELECT * FROM staff WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY staff_number ASC
    `, [schoolId])
      : null;

    if (pgRes) {
      staff = pgRes.rows;
      for (const st of staff) {
        cacheDb.prepare(`
          INSERT INTO staff (
            id, school_id, user_id, staff_number, first_name, middle_name, last_name, email, phone,
            gender, address, job_title, department, employment_status, date_joined, is_deleted, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            user_id = COALESCE(excluded.user_id, staff.user_id),
            staff_number = excluded.staff_number,
            first_name = excluded.first_name,
            middle_name = excluded.middle_name,
            last_name = excluded.last_name,
            email = excluded.email,
            phone = excluded.phone,
            gender = excluded.gender,
            address = excluded.address,
            job_title = excluded.job_title,
            department = excluded.department,
            employment_status = excluded.employment_status,
            date_joined = excluded.date_joined,
            is_deleted = excluded.is_deleted,
            updated_at = excluded.updated_at
        `).run(
          st.id,
          st.school_id,
          st.user_id || null,
          st.staff_number || null,
          st.first_name,
          st.middle_name || null,
          st.last_name,
          st.email || null,
          st.phone || null,
          st.gender || null,
          st.address || null,
          st.job_title || null,
          st.department || null,
          st.employment_status || 'ACTIVE',
          st.date_joined || null,
          st.is_deleted ? 1 : 0,
          st.created_at || new Date().toISOString(),
          st.updated_at || new Date().toISOString()
        );
      }
    } else {
      staff = cacheDb.prepare(`
        SELECT * FROM staff WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY staff_number ASC
      `).all(schoolId);
    }

    return res.json({ success: true, count: staff.length, staff });
  } catch (err: any) {
    console.error('[GET /v1/school/staff Error]', err);
    return res.status(500).json({ error: 'FETCH_FAILED', message: safeClientError(err) });
  }
});

// POST /api/v1/school/staff
apiRouter.post(
  '/v1/school/staff',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
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

    // Flexible Staff Validation: First & last name required; staff_number, email, phone optional
    if (!first_name || typeof first_name !== 'string' || !first_name.trim() || !last_name || typeof last_name !== 'string' || !last_name.trim()) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'Staff first name and last name are required.',
      });
    }

    const safeFirstName = first_name.trim();
    const safeMiddleName = middle_name && typeof middle_name === 'string' ? middle_name.trim() : '';
    const safeLastName = last_name.trim();
    const effectiveStaffNo = staff_number && typeof staff_number === 'string' && staff_number.trim()
      ? staff_number.trim()
      : await generateNextStaffCode(schoolId);
    const effectiveJobTitle = job_title && typeof job_title === 'string' && job_title.trim()
      ? job_title.trim()
      : 'Staff Member';
    const safeEmail = email && typeof email === 'string' && email.trim() ? email.toLowerCase().trim() : null;
    const safePhone = phone && typeof phone === 'string' && phone.trim() ? phone.trim() : null;

    const pool = getPgPool();
    // Enforce Plan Staff Limit
    let currentStaffCount = 0;
    const countPg = pool ? await queryPg('SELECT COUNT(*) as c FROM staff WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)', [schoolId]) : null;
    if (countPg) {
      currentStaffCount = parseInt(countPg.rows[0]?.c || '0', 10);
    } else {
      currentStaffCount = (cacheDb.prepare('SELECT COUNT(*) as c FROM staff WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(schoolId) as any)?.c || 0;
    }

    let schoolPlan: any = null;
    const planPg = pool
      ? await queryPg(`
      SELECT p.staff_limit, p.maximum_staff, p.display_name
      FROM schools s
      LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
      WHERE s.id = $1
    `, [schoolId])
      : null;
    if (planPg && planPg.rows.length > 0) {
      schoolPlan = planPg.rows[0];
    } else {
      schoolPlan = cacheDb.prepare(`
        SELECT p.staff_limit, p.maximum_staff, p.display_name
        FROM schools s
        LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
        WHERE s.id = ?
      `).get(schoolId) as any;
    }

    const staffLimit = schoolPlan?.maximum_staff || schoolPlan?.staff_limit;
    if (staffLimit && currentStaffCount >= staffLimit) {
      return res.status(403).json({
        error: 'STAFF_LIMIT_REACHED',
        message: `Your school has reached the maximum staff limit of ${staffLimit} on the ${schoolPlan.display_name || 'current'} plan. Please upgrade your subscription plan to add more staff.`,
        currentCount: currentStaffCount,
        limit: staffLimit,
      });
    }

    // Check staff number uniqueness in this school (case-insensitive)
    let existingStaffNo: any = null;
    const checkPg = pool
      ? await queryPg('SELECT id FROM staff WHERE school_id = $1 AND LOWER(TRIM(staff_number)) = LOWER($2) AND (is_deleted = 0 OR is_deleted IS NULL)', [schoolId, effectiveStaffNo])
      : null;
    if (checkPg && checkPg.rows.length > 0) {
      existingStaffNo = checkPg.rows[0];
    } else {
      existingStaffNo = cacheDb.prepare('SELECT id FROM staff WHERE school_id = ? AND LOWER(TRIM(staff_number)) = LOWER(?) AND (is_deleted = 0 OR is_deleted IS NULL)').get(schoolId, effectiveStaffNo);
    }

    if (existingStaffNo) {
      return res.status(409).json({ error: 'DUPLICATE_STAFF_NUMBER', message: 'Staff code already exists in your school.' });
    }

    // Link existing TEACHER/STAFF account in this school if email matches (never links ADMIN/BURSAR accounts)
    let matchedUserId: string | null = null;
    if (safeEmail) {
      const matchedUserRow = pool
        ? (
            await queryPg(
              `SELECT u.id FROM users u
               JOIN user_roles ur ON ur.user_id = u.id
               JOIN roles r ON ur.role_id = r.id
               WHERE ur.school_id = $1 AND LOWER(u.email) = $2 AND r.name IN ('TEACHER', 'STAFF')
               LIMIT 1`,
              [schoolId, safeEmail]
            )
          ).rows[0]
        : cacheDb
            .prepare(
              `SELECT u.id FROM users u
               JOIN user_roles ur ON ur.user_id = u.id
               JOIN roles r ON ur.role_id = r.id
               WHERE ur.school_id = ? AND LOWER(u.email) = ? AND r.name IN ('TEACHER', 'STAFF')
               LIMIT 1`
            )
            .get(schoolId, safeEmail) as any;
      if (matchedUserRow?.id) matchedUserId = matchedUserRow.id;
    }

    const id = 'stf_' + crypto.randomUUID().slice(0, 8);

    if (pool) {
      await queryPg(`
        INSERT INTO staff (
          id, school_id, user_id, staff_number, first_name, middle_name, last_name, email, phone,
          gender, address, job_title, department, employment_status, date_joined, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        id,
        schoolId,
        matchedUserId,
        effectiveStaffNo,
        safeFirstName,
        safeMiddleName,
        safeLastName,
        safeEmail,
        safePhone,
        gender || null,
        address || null,
        effectiveJobTitle,
        department || null,
        employment_status,
        date_joined
      ]);
    }

    cacheDb.prepare(`
      INSERT INTO staff (
        id, school_id, user_id, staff_number, first_name, middle_name, last_name, email, phone,
        gender, address, job_title, department, employment_status, date_joined, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        user_id = COALESCE(excluded.user_id, staff.user_id),
        staff_number = excluded.staff_number,
        first_name = excluded.first_name,
        middle_name = excluded.middle_name,
        last_name = excluded.last_name,
        email = excluded.email,
        phone = excluded.phone,
        gender = excluded.gender,
        address = excluded.address,
        job_title = excluded.job_title,
        department = excluded.department,
        employment_status = excluded.employment_status,
        date_joined = excluded.date_joined,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      schoolId,
      matchedUserId,
      effectiveStaffNo,
      safeFirstName,
      safeMiddleName,
      safeLastName,
      safeEmail,
      safePhone,
      gender || null,
      address || null,
      effectiveJobTitle,
      department || null,
      employment_status,
      date_joined
    );

    const pgCreated = pool ? await queryPg('SELECT * FROM staff WHERE id = $1', [id]) : null;
    const created = pgCreated?.rows[0] || cacheDb.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: `Staff member added with login code ${effectiveStaffNo}`, staff: created });
  }
);

// POST /api/v1/school/staff/assign-missing-codes (Backfill unique Staff Codes for existing uncoded staff/teachers)
apiRouter.post(
  '/v1/school/staff/assign-missing-codes',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const result = await assignMissingStaffCodesForSchool(schoolId);
    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'ASSIGN_MISSING_STAFF_CODES',
      entity: 'STAFF',
      ipAddress: req.ip || '127.0.0.1',
      metadata: {
        assignedCount: result.assignedCount,
        createdProfilesCount: result.createdProfilesCount,
        prefix: result.prefix,
      },
    });
    return res.json({
      success: true,
      ...result,
      message:
        result.assignedCount > 0
          ? `Assigned unique Staff Login Codes (${result.prefix}/STF/...) to ${result.assignedCount} staff record(s).`
          : 'All active staff and teachers already have a unique Staff Login Code.',
    });
  }
);

// PUT /api/v1/school/staff/:id
apiRouter.put(
  '/v1/school/staff/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const pool = getPgPool();

    let existing: any = null;
    const checkPg = pool ? await queryPg('SELECT * FROM staff WHERE id = $1', [id]) : null;
    if (checkPg && checkPg.rows.length > 0) {
      existing = checkPg.rows[0];
    } else {
      existing = cacheDb.prepare('SELECT * FROM staff WHERE id = ?').get(id) as any;
    }

    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Staff member not found.' });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot edit staff of another school.' });
    }

    const b = req.body || {};
    const safeStaffNo = b.staff_number !== undefined ? (b.staff_number ? b.staff_number.trim() : null) : null;
    const safeFirstName = b.first_name !== undefined ? (b.first_name ? b.first_name.trim() : null) : null;
    const safeMiddleName = b.middle_name !== undefined ? (b.middle_name ? b.middle_name.trim() : null) : null;
    const safeLastName = b.last_name !== undefined ? (b.last_name ? b.last_name.trim() : null) : null;
    const safeEmail = b.email !== undefined ? (b.email ? b.email.toLowerCase().trim() : null) : null;
    const safePhone = b.phone !== undefined ? (b.phone ? b.phone.trim() : null) : null;
    const safeJobTitle = b.job_title !== undefined ? (b.job_title ? b.job_title.trim() : null) : null;

    if (pool) {
      await queryPg(`
        UPDATE staff SET
          staff_number = COALESCE($1, staff_number),
          first_name = COALESCE($2, first_name),
          middle_name = COALESCE($3, middle_name),
          last_name = COALESCE($4, last_name),
          email = COALESCE($5, email),
          phone = COALESCE($6, phone),
          gender = COALESCE($7, gender),
          job_title = COALESCE($8, job_title),
          department = COALESCE($9, department),
          employment_status = COALESCE($10, employment_status),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $11 AND school_id = $12
      `, [
        safeStaffNo,
        safeFirstName,
        safeMiddleName,
        safeLastName,
        safeEmail,
        safePhone,
        b.gender || null,
        safeJobTitle,
        b.department || null,
        b.employment_status || null,
        id,
        schoolId
      ]);
    }

    cacheDb.prepare(`
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
      safeStaffNo,
      safeFirstName,
      safeMiddleName,
      safeLastName,
      safeEmail,
      safePhone,
      b.gender || null,
      safeJobTitle,
      b.department || null,
      b.employment_status || null,
      id,
      schoolId
    );

    const updatedPg = pool ? await queryPg('SELECT * FROM staff WHERE id = $1', [id]) : null;
    const updated = updatedPg?.rows[0] || cacheDb.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    return res.json({ success: true, message: 'Staff updated successfully', staff: updated });
  }
);

// DELETE /api/v1/school/staff/:id (Controlled soft-deletion to Recycle Bin)
apiRouter.delete(
  '/v1/school/staff/:id',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const pool = getPgPool();

    let existing: any = null;
    const checkPg = pool ? await queryPg('SELECT * FROM staff WHERE id = $1', [id]) : null;
    if (checkPg && checkPg.rows.length > 0) {
      existing = checkPg.rows[0];
    } else {
      existing = cacheDb.prepare('SELECT * FROM staff WHERE id = ?').get(id) as any;
    }

    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Staff not found.' });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: 'CROSS_TENANT_ACCESS_DENIED', message: 'Cannot delete staff of another school.' });
    }

    const reason = req.body?.reason || 'Staff archived by School Admin';
    if (pool) {
      await queryPg(`
        UPDATE staff 
        SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1, deletion_reason = $2 
        WHERE id = $3 AND school_id = $4
      `, [req.user!.email, reason, id, schoolId]);
    }

    cacheDb.prepare(`
      UPDATE staff 
      SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, deletion_reason = ? 
      WHERE id = ? AND school_id = ?
    `).run(req.user!.email, reason, id, schoolId);

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'SOFT_DELETE_STAFF',
      entity: 'STAFF',
      entityId: id,
      metadata: { staffName: `${existing.first_name} ${existing.last_name}` },
    });

    return res.json({ success: true, message: 'Staff record safely moved to Recycle Bin.' });
  }
);

// ==============================================================================
// ACADEMIC SESSIONS & TERMS ENDPOINTS
// ==============================================================================

// GET /api/v1/school/academic-sessions
apiRouter.get('/v1/school/academic-sessions', requireAuth, requireTenant, requireRole(ACADEMIC_READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const pool = getPgPool();
  try {
    let sessions: any[] = [];
    const pgSessions = pool
      ? await queryPg(`
      SELECT * FROM academic_sessions WHERE school_id = $1 ORDER BY name DESC
    `, [schoolId])
      : null;

    if (pgSessions) {
      sessions = pgSessions.rows;
      for (const s of sessions) {
        cacheDb.prepare(`
          INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            start_date = excluded.start_date,
            end_date = excluded.end_date,
            status = excluded.status,
            updated_at = excluded.updated_at
        `).run(
          s.id,
          s.school_id,
          s.name,
          s.start_date || null,
          s.end_date || null,
          s.status || 'UPCOMING',
          s.created_at || new Date().toISOString(),
          s.updated_at || new Date().toISOString()
        );
      }
    } else {
      sessions = cacheDb.prepare(`
        SELECT * FROM academic_sessions WHERE school_id = ? ORDER BY name DESC
      `).all(schoolId) as any[];
    }

    const sessionsWithTerms = await Promise.all(sessions.map(async (s) => {
      let terms: any[] = [];
      const pgTerms = pool
        ? await queryPg(`
        SELECT * FROM terms WHERE academic_session_id = $1 AND school_id = $2 ORDER BY name ASC
      `, [s.id, schoolId])
        : null;

      if (pgTerms) {
        terms = pgTerms.rows;
        for (const t of terms) {
          cacheDb.prepare(`
            INSERT INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              start_date = excluded.start_date,
              end_date = excluded.end_date,
              status = excluded.status,
              updated_at = excluded.updated_at
          `).run(
            t.id,
            t.school_id,
            t.academic_session_id,
            t.name,
            t.start_date || null,
            t.end_date || null,
            t.status || 'UPCOMING',
            t.created_at || new Date().toISOString(),
            t.updated_at || new Date().toISOString()
          );
        }
      } else {
        terms = cacheDb.prepare(`
          SELECT * FROM terms WHERE academic_session_id = ? AND school_id = ? ORDER BY name ASC
        `).all(s.id, schoolId);
      }
      return { ...s, terms };
    }));

    return res.json({ success: true, sessions: sessionsWithTerms });
  } catch (err: any) {
    console.error('[GET /v1/school/academic-sessions Error]', err);
    return res.status(500).json({ error: 'FETCH_FAILED', message: safeClientError(err) });
  }
});

// POST /api/v1/school/academic-sessions
apiRouter.post(
  '/v1/school/academic-sessions',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { name, start_date, end_date, status = 'UPCOMING' } = req.body;
    const pool = getPgPool();

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Session name is required (e.g. 2025/2026).' });
    }

    if (status === 'ACTIVE') {
      if (pool) await queryPg("UPDATE academic_sessions SET status = 'COMPLETED' WHERE school_id = $1 AND status = 'ACTIVE'", [schoolId]);
      cacheDb.prepare("UPDATE academic_sessions SET status = 'COMPLETED' WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);
    }

    const id = 'ses_' + crypto.randomUUID().slice(0, 8);
    const safeName = name.trim();

    if (pool) {
      await queryPg(`
        INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [id, schoolId, safeName, start_date || null, end_date || null, status]);
    }

    cacheDb.prepare(`
      INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        updated_at = CURRENT_TIMESTAMP
    `).run(id, schoolId, safeName, start_date || null, end_date || null, status);

    const pgSession = pool ? await queryPg('SELECT * FROM academic_sessions WHERE id = $1', [id]) : null;
    const session = pgSession?.rows[0] || cacheDb.prepare('SELECT * FROM academic_sessions WHERE id = ?').get(id);
    return res.status(201).json({ success: true, message: 'Academic session created successfully', session });
  }
);

// POST /api/v1/school/academic-sessions/:id/terms
apiRouter.post(
  '/v1/school/academic-sessions/:id/terms',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: sessionId } = req.params;
    const { name, start_date, end_date, status = 'UPCOMING' } = req.body;
    const pool = getPgPool();

    let session: any = null;
    const pgSes = pool ? await queryPg('SELECT id FROM academic_sessions WHERE id = $1 AND school_id = $2', [sessionId, schoolId]) : null;
    if (pgSes && pgSes.rows.length > 0) {
      session = pgSes.rows[0];
    } else {
      session = cacheDb.prepare('SELECT id FROM academic_sessions WHERE id = ? AND school_id = ?').get(sessionId, schoolId);
    }

    if (!session) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'Academic session not found in your school.' });
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Term name is required (e.g. 1st Term).' });
    }

    if (status === 'ACTIVE') {
      if (pool) await queryPg("UPDATE terms SET status = 'COMPLETED' WHERE school_id = $1 AND status = 'ACTIVE'", [schoolId]);
      cacheDb.prepare("UPDATE terms SET status = 'COMPLETED' WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);
    }

    const termId = 'trm_' + crypto.randomUUID().slice(0, 8);
    const safeName = name.trim();

    if (pool) {
      await queryPg(`
        INSERT INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [termId, schoolId, sessionId, safeName, start_date || null, end_date || null, status]);
    }

    cacheDb.prepare(`
      INSERT INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        updated_at = CURRENT_TIMESTAMP
    `).run(termId, schoolId, sessionId, safeName, start_date || null, end_date || null, status);

    const pgTerm = pool ? await queryPg('SELECT * FROM terms WHERE id = $1', [termId]) : null;
    const term = pgTerm?.rows[0] || cacheDb.prepare('SELECT * FROM terms WHERE id = ?').get(termId);
    return res.status(201).json({ success: true, message: 'Term created successfully', term });
  }
);

// GET /api/v1/school/fees (Strictly tenant-scoped fees)
apiRouter.get('/v1/school/fees', requireAuth, requireTenant, requireRole(ACADEMIC_READ_ROLES), async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const pool = getPgPool();
  try {
    let fees: any[] = [];
    const pgFees = pool ? await queryPg('SELECT * FROM fees WHERE school_id = $1 ORDER BY name ASC', [schoolId]) : null;
    if (pgFees) {
      fees = pgFees.rows;
    } else {
      fees = cacheDb.prepare('SELECT * FROM fees WHERE school_id = ? ORDER BY name ASC').all(schoolId);
    }
    return res.json({ success: true, count: fees.length, fees });
  } catch (err: any) {
    console.error('[GET /v1/school/fees Error]', err);
    return res.status(500).json({ error: 'FETCH_FAILED', message: safeClientError(err) });
  }
});

// GET /api/v1/school/users (Admin-only list of portal users in THIS tenant only)
apiRouter.get('/v1/school/users', requireAuth, requireTenant, requireRole(ADMIN_ONLY_ROLES), async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const pool = getPgPool();
  try {
    let users: any[] = [];
    const pgUsers = pool
      ? await queryPg(`
      SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.is_platform_admin, u.created_at,
             r.name as role_name, r.display_name as role_display_name,
             (SELECT p.id FROM parents p WHERE p.user_id = u.id AND p.school_id = $1 AND (p.is_deleted = 0 OR p.is_deleted IS NULL) LIMIT 1) as linked_parent_id,
             (SELECT s.id FROM students s WHERE s.user_id = u.id AND s.school_id = $1 AND (s.is_deleted = 0 OR s.is_deleted IS NULL) LIMIT 1) as linked_student_id,
             (SELECT s.full_name FROM students s WHERE s.user_id = u.id AND s.school_id = $1 AND (s.is_deleted = 0 OR s.is_deleted IS NULL) LIMIT 1) as linked_student_name,
             (SELECT st.id FROM staff st WHERE st.school_id = $1 AND (st.user_id = u.id OR (st.email IS NOT NULL AND TRIM(st.email) != '' AND LOWER(TRIM(st.email)) = LOWER(TRIM(u.email)))) AND (st.is_deleted = 0 OR st.is_deleted IS NULL) LIMIT 1) as linked_staff_id,
             (SELECT st.staff_number FROM staff st WHERE st.school_id = $1 AND (st.user_id = u.id OR (st.email IS NOT NULL AND TRIM(st.email) != '' AND LOWER(TRIM(st.email)) = LOWER(TRIM(u.email)))) AND (st.is_deleted = 0 OR st.is_deleted IS NULL) LIMIT 1) as linked_staff_number
      FROM user_roles ur
      JOIN users u ON ur.user_id = u.id
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.school_id = $1
      ORDER BY u.created_at ASC
    `, [schoolId])
      : null;

    if (pgUsers) {
      users = pgUsers.rows;
    } else {
      users = cacheDb.prepare(`
        SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.created_at,
               r.name as role_name, r.display_name as role_display_name,
               (SELECT p.id FROM parents p WHERE p.user_id = u.id AND p.school_id = ? AND (p.is_deleted = 0 OR p.is_deleted IS NULL) LIMIT 1) as linked_parent_id,
               (SELECT s.id FROM students s WHERE s.user_id = u.id AND s.school_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL) LIMIT 1) as linked_student_id,
               (SELECT s.full_name FROM students s WHERE s.user_id = u.id AND s.school_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL) LIMIT 1) as linked_student_name,
               (SELECT st.id FROM staff st WHERE st.school_id = ? AND (st.user_id = u.id OR (st.email IS NOT NULL AND TRIM(st.email) != '' AND LOWER(TRIM(st.email)) = LOWER(TRIM(u.email)))) AND (st.is_deleted = 0 OR st.is_deleted IS NULL) LIMIT 1) as linked_staff_id,
               (SELECT st.staff_number FROM staff st WHERE st.school_id = ? AND (st.user_id = u.id OR (st.email IS NOT NULL AND TRIM(st.email) != '' AND LOWER(TRIM(st.email)) = LOWER(TRIM(u.email)))) AND (st.is_deleted = 0 OR st.is_deleted IS NULL) LIMIT 1) as linked_staff_number
        FROM user_roles ur
        JOIN users u ON ur.user_id = u.id
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.school_id = ?
        ORDER BY u.created_at ASC
      `).all(schoolId, schoolId, schoolId, schoolId, schoolId, schoolId);
    }

    return res.json({ success: true, users });
  } catch (err: any) {
    console.error('[GET /v1/school/users Error]', err);
    return res.status(500).json({ error: 'FETCH_FAILED', message: safeClientError(err) });
  }
});

// POST /api/v1/school/users/provision (Admin-only portal user provisioning & explicit linkage)
apiRouter.post(
  '/v1/school/users/provision',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      email,
      full_name,
      phone = null,
      password,
      role_name,
      staff_number = null,
      job_title = null,
      department = 'Academic',
      parent_id = null,
      create_parent_profile = false,
      student_ids = [],
      student_id = null,
    } = req.body || {};

    const allowedRoles = ['SCHOOL_ADMIN', 'BURSAR', 'TEACHER', 'STAFF', 'PARENT', 'STUDENT'];
    const isStaffRole = role_name === 'TEACHER' || role_name === 'STAFF';
    if (!full_name || !role_name || !allowedRoles.includes(role_name) || (!isStaffRole && !email)) {
      return res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: isStaffRole
          ? 'Staff full name and role_name are required.'
          : 'Valid email, full_name, and role_name (SCHOOL_ADMIN, BURSAR, TEACHER, STAFF, PARENT, STUDENT) are required.',
      });
    }

    const cleanName = String(full_name).trim();
    const pool = getPgPool();

    // Generate or validate staff_number upfront for TEACHER / STAFF so every staff user gets a unique login code
    let resolvedStaffCode: string | null = null;
    if (isStaffRole) {
      resolvedStaffCode =
        staff_number && typeof staff_number === 'string' && staff_number.trim()
          ? staff_number.trim()
          : await generateNextStaffCode(schoolId);
      const dupStaff = pool
        ? (
            await queryPg(
              'SELECT id FROM staff WHERE school_id = $1 AND LOWER(TRIM(staff_number)) = LOWER($2) AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
              [schoolId, resolvedStaffCode]
            )
          ).rows[0]
        : cacheDb
            .prepare(
              'SELECT id FROM staff WHERE school_id = ? AND LOWER(TRIM(staff_number)) = LOWER(?) AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1'
            )
            .get(schoolId, resolvedStaffCode);
      if (dupStaff) {
        return res.status(409).json({
          error: 'DUPLICATE_STAFF_NUMBER',
          message: `Staff code "${resolvedStaffCode}" is already assigned in your school.`,
        });
      }
    }

    const cleanEmail =
      email && String(email).trim()
        ? String(email).trim().toLowerCase()
        : `${String(resolvedStaffCode || 'staff').toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${crypto.randomBytes(2).toString('hex')}@${schoolId.slice(-6)}.staff.bursariq.local`;

    // Verify role exists
    let roleRow: any = null;
    if (pool) {
      const rRes = await queryPg('SELECT id, name, display_name FROM roles WHERE name = $1 LIMIT 1', [role_name]);
      roleRow = rRes.rows[0];
    }
    if (!roleRow) {
      roleRow = cacheDb.prepare('SELECT id, name, display_name FROM roles WHERE name = ? LIMIT 1').get(role_name);
    }
    if (!roleRow) {
      return res.status(400).json({ error: 'ROLE_NOT_FOUND', message: `Role ${role_name} is not registered.` });
    }

    // Verify explicit student linkage if STUDENT role
    if (role_name === 'STUDENT' && student_id) {
      const pgStu = pool ? (await queryPg('SELECT id FROM students WHERE id = $1 AND school_id = $2', [student_id, schoolId])).rows[0] : null;
      const sqStu = cacheDb.prepare('SELECT id FROM students WHERE id = ? AND school_id = ?').get(student_id, schoolId);
      if (!pgStu && !sqStu) {
        return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Selected student does not belong to this school.' });
      }
    }

    // Find or create user
    let existingUser: any = null;
    if (pool) {
      const uRes = await queryPg('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [cleanEmail]);
      existingUser = uRes.rows[0] || null;
    }
    if (!existingUser) {
      existingUser = cacheDb.prepare('SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1').get(cleanEmail) as any;
    }

    let userId: string;
    let temporaryPasswordUsed = false;
    if (existingUser) {
      if (existingUser.is_platform_admin === 1) {
        return res.status(403).json({
          error: 'PLATFORM_ADMIN_PROTECTED',
          message: 'Platform administrator accounts cannot be provisioned as school portal users.',
        });
      }
      userId = existingUser.id;
    } else {
      const hasPassword = Boolean(password && String(password).trim().length > 0);
      if (!isStaffRole && (!hasPassword || String(password).length < 6)) {
        return res.status(400).json({
          error: 'WEAK_PASSWORD',
          message: 'New user accounts require a password of at least 6 characters.',
        });
      }
      if (isStaffRole && hasPassword && String(password).length < 6) {
        return res.status(400).json({
          error: 'WEAK_PASSWORD',
          message: 'Optional initial password must be at least 6 characters if provided.',
        });
      }
      const effectivePassword = hasPassword ? String(password) : crypto.randomBytes(24).toString('hex');
      userId = 'usr_' + crypto.randomUUID().slice(0, 12);
      const salt = generateSalt();
      const passwordHash = hashPassword(effectivePassword, salt);
      temporaryPasswordUsed = true;

      if (pool) {
        await queryPg(
          `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, cleanEmail, passwordHash, salt, cleanName, phone]
        );
      }
      try {
        cacheDb.prepare(`
          INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, phone = excluded.phone
        `).run(userId, cleanEmail, passwordHash, salt, cleanName, phone);
      } catch {}
    }

    // Assign tenant role
    const urId = 'ur_' + crypto.randomUUID().slice(0, 12);
    if (pool) {
      await queryPg(
        `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
         VALUES ($1, $2, $3, $4, 0, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
        [urId, userId, schoolId, roleRow.id]
      );
    }
    try {
      cacheDb.prepare(`
        INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
        VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, school_id, role_id) DO NOTHING
      `).run(urId, userId, schoolId, roleRow.id);
    } catch {}

    // Handle explicit verified Parent linkage
    let linkedParentId: string | null = parent_id || null;
    if (role_name === 'PARENT') {
      if (parent_id) {
        const pgPar = pool ? (await queryPg('SELECT id FROM parents WHERE id = $1 AND school_id = $2', [parent_id, schoolId])).rows[0] : null;
        const sqPar = cacheDb.prepare('SELECT id FROM parents WHERE id = ? AND school_id = ?').get(parent_id, schoolId);
        if (!pgPar && !sqPar) {
          return res.status(404).json({ error: 'PARENT_NOT_FOUND', message: 'Parent record not found in this school.' });
        }
        if (pool) await queryPg('UPDATE parents SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [userId, parent_id, schoolId]);
        try { cacheDb.prepare('UPDATE parents SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?').run(userId, parent_id, schoolId); } catch {}
      } else if (create_parent_profile) {
        const parts = cleanName.split(/\s+/);
        const firstName = parts[0] || cleanName;
        const lastName = parts.slice(1).join(' ') || 'Guardian';
        linkedParentId = 'par_' + crypto.randomUUID().slice(0, 10);
        if (pool) {
          await queryPg(
            `INSERT INTO parents (id, school_id, user_id, first_name, last_name, phone, email, relationship, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Parent', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [linkedParentId, schoolId, userId, firstName, lastName, phone, cleanEmail]
          );
        }
        try {
          cacheDb.prepare(`
            INSERT INTO parents (id, school_id, user_id, first_name, last_name, phone, email, relationship, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Parent', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).run(linkedParentId, schoolId, userId, firstName, lastName, phone, cleanEmail);
        } catch {}
      }

      if (linkedParentId && Array.isArray(student_ids) && student_ids.length > 0) {
        for (const sid of student_ids) {
          const validStu = pool
            ? (await queryPg('SELECT id FROM students WHERE id = $1 AND school_id = $2', [sid, schoolId])).rows[0]
            : cacheDb.prepare('SELECT id FROM students WHERE id = ? AND school_id = ?').get(sid, schoolId);
          if (!validStu) continue;
          const psId = 'ps_' + crypto.randomUUID().slice(0, 10);
          if (pool) {
            const existingLink = (
              await queryPg(
                'SELECT id FROM parent_students WHERE parent_id = $1 AND student_id = $2 AND school_id = $3 LIMIT 1',
                [linkedParentId, sid, schoolId]
              )
            ).rows[0];
            if (existingLink) {
              await queryPg(
                'UPDATE parent_students SET verified_by = $1, verified_at = CURRENT_TIMESTAMP WHERE id = $2',
                [req.user!.id, existingLink.id]
              );
            } else {
              await queryPg(
                `INSERT INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact, verified_by, verified_at)
                 VALUES ($1, $2, $3, $4, 'Parent', 1, $5, CURRENT_TIMESTAMP)`,
                [psId, schoolId, linkedParentId, sid, req.user!.id]
              );
            }
          }
          try {
            const sqExisting = cacheDb
              .prepare('SELECT id FROM parent_students WHERE parent_id = ? AND student_id = ? AND school_id = ? LIMIT 1')
              .get(linkedParentId, sid, schoolId) as any;
            if (sqExisting) {
              cacheDb
                .prepare('UPDATE parent_students SET verified_by = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(req.user!.id, sqExisting.id);
            } else {
              cacheDb
                .prepare(`
                  INSERT INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact, verified_by, verified_at)
                  VALUES (?, ?, ?, ?, 'Parent', 1, ?, CURRENT_TIMESTAMP)
                `)
                .run(psId, schoolId, linkedParentId, sid, req.user!.id);
            }
          } catch {}
        }
      }
    }

    // Handle explicit Student portal linkage
    if (role_name === 'STUDENT' && student_id) {
      if (pool) await queryPg('UPDATE students SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [userId, student_id, schoolId]);
      try { cacheDb.prepare('UPDATE students SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?').run(userId, student_id, schoolId); } catch {}
    }

    // Handle explicit Staff Directory profile creation / linking + unique Staff Code for TEACHER / STAFF
    let linkedStaffId: string | null = null;
    if (isStaffRole) {
      const existingStaffRow = pool
        ? (
            await queryPg(
              `SELECT id, staff_number FROM staff
               WHERE school_id = $1 AND (user_id = $2 OR (email IS NOT NULL AND TRIM(email) != '' AND LOWER(TRIM(email)) = LOWER($3)))
                 AND (is_deleted = 0 OR is_deleted IS NULL)
               LIMIT 1`,
              [schoolId, userId, cleanEmail]
            )
          ).rows[0]
        : (cacheDb
            .prepare(
              `SELECT id, staff_number FROM staff
               WHERE school_id = ? AND (user_id = ? OR (email IS NOT NULL AND TRIM(email) != '' AND LOWER(TRIM(email)) = LOWER(?)))
                 AND (is_deleted = 0 OR is_deleted IS NULL)
               LIMIT 1`
            )
            .get(schoolId, userId, cleanEmail) as any);

      if (existingStaffRow) {
        linkedStaffId = existingStaffRow.id;
        resolvedStaffCode = existingStaffRow.staff_number && String(existingStaffRow.staff_number).trim()
          ? String(existingStaffRow.staff_number).trim()
          : resolvedStaffCode;
        if (pool) {
          await queryPg(
            `UPDATE staff SET user_id = $1, staff_number = COALESCE(NULLIF(TRIM(staff_number), ''), $2), updated_at = CURRENT_TIMESTAMP
             WHERE id = $3 AND school_id = $4`,
            [userId, resolvedStaffCode, existingStaffRow.id, schoolId]
          );
        }
        try {
          cacheDb
            .prepare(
              `UPDATE staff SET user_id = ?, staff_number = COALESCE(NULLIF(TRIM(staff_number), ''), ?), updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND school_id = ?`
            )
            .run(userId, resolvedStaffCode, existingStaffRow.id, schoolId);
        } catch {}
      } else {
        linkedStaffId = 'stf_' + crypto.randomUUID().slice(0, 8);
        const nameParts = cleanName.split(/\s+/);
        const sFirst = nameParts[0] || cleanName;
        const sLast = nameParts.slice(1).join(' ') || 'Staff';
        const effectiveJobTitle =
          job_title && typeof job_title === 'string' && job_title.trim()
            ? job_title.trim()
            : role_name === 'TEACHER'
            ? 'Class Teacher'
            : 'School Staff';
        const effectiveDept = department && typeof department === 'string' && department.trim() ? department.trim() : 'Academic';
        const staffEmailVal = email && String(email).trim() ? cleanEmail : null;

        if (pool) {
          await queryPg(
            `INSERT INTO staff (
              id, school_id, user_id, staff_number, first_name, middle_name, last_name,
              email, phone, job_title, department, employment_status, date_joined, is_deleted, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, '', $6, $7, $8, $9, $10, 'ACTIVE', CURRENT_DATE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [linkedStaffId, schoolId, userId, resolvedStaffCode, sFirst, sLast, staffEmailVal, phone, effectiveJobTitle, effectiveDept]
          );
        }
        try {
          cacheDb
            .prepare(
              `INSERT INTO staff (
                id, school_id, user_id, staff_number, first_name, middle_name, last_name,
                email, phone, job_title, department, employment_status, date_joined, is_deleted, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_DATE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            )
            .run(linkedStaffId, schoolId, userId, resolvedStaffCode, sFirst, sLast, staffEmailVal, phone, effectiveJobTitle, effectiveDept);
        } catch {}
      }
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'PROVISION_PORTAL_USER',
      entity: 'USER',
      entityId: userId,
      metadata: {
        email: cleanEmail,
        role_name,
        linkedParentId,
        linkedStaffId,
        linkedStaffCode: resolvedStaffCode,
        student_id,
        student_ids,
        temporaryPasswordUsed,
      },
    });

    return res.status(201).json({
      success: true,
      issuedStaffNumber: resolvedStaffCode,
      message: isStaffRole && resolvedStaffCode
        ? `${roleRow.display_name} provisioned with unique Staff Code ${resolvedStaffCode}.`
        : `${roleRow.display_name} account provisioned successfully.`,
      user: {
        id: userId,
        email: cleanEmail,
        full_name: cleanName,
        role_name,
        linked_parent_id: linkedParentId,
        linked_student_id: student_id,
        linked_staff_id: linkedStaffId,
        linked_staff_number: resolvedStaffCode,
      },
    });
  }
);

// PUT /api/v1/school/parents/:id/students (Admin-only explicit verified child assignment)
apiRouter.put(
  '/v1/school/parents/:id/students',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: parentId } = req.params;
    const { student_ids = [], user_id } = req.body || {};

    if (!Array.isArray(student_ids)) {
      return res.status(400).json({ error: 'INVALID_STUDENT_IDS', message: 'student_ids must be an array.' });
    }

    const pool = getPgPool();
    const existingParent = pool
      ? (await queryPg('SELECT * FROM parents WHERE id = $1 AND school_id = $2', [parentId, schoolId])).rows[0]
      : cacheDb.prepare('SELECT * FROM parents WHERE id = ? AND school_id = ?').get(parentId, schoolId);

    if (!existingParent) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Parent record not found in your school.' });
    }

    if (user_id !== undefined) {
      if (pool) await queryPg('UPDATE parents SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [user_id || null, parentId, schoolId]);
      try { cacheDb.prepare('UPDATE parents SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?').run(user_id || null, parentId, schoolId); } catch {}
    }

    // Validate all student IDs belong to this school before mutating
    const verifiedIds: string[] = [];
    for (const sid of student_ids) {
      const stu = pool
        ? (await queryPg('SELECT id FROM students WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)', [sid, schoolId])).rows[0]
        : cacheDb.prepare('SELECT id FROM students WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(sid, schoolId);
      if (!stu) {
        return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: `Student ${sid} does not belong to this school.` });
      }
      if (!verifiedIds.includes(sid)) verifiedIds.push(sid);
    }

    if (pool) await queryPg('DELETE FROM parent_students WHERE parent_id = $1 AND school_id = $2', [parentId, schoolId]);
    try { cacheDb.prepare('DELETE FROM parent_students WHERE parent_id = ? AND school_id = ?').run(parentId, schoolId); } catch {}

    for (let i = 0; i < verifiedIds.length; i++) {
      const sid = verifiedIds[i];
      const psId = 'ps_' + crypto.randomUUID().slice(0, 10);
      if (pool) {
        await queryPg(
          `INSERT INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact, verified_by, verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
          [psId, schoolId, parentId, sid, existingParent.relationship || 'Parent', i === 0 ? 1 : 0, req.user!.id]
        );
      }
      try {
        cacheDb.prepare(`
          INSERT INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact, verified_by, verified_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(psId, schoolId, parentId, sid, existingParent.relationship || 'Parent', i === 0 ? 1 : 0, req.user!.id);
      } catch {}
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'UPDATE_PARENT_STUDENT_LINKS',
      entity: 'PARENT',
      entityId: parentId,
      metadata: { verifiedIds },
    });

    return res.json({ success: true, message: 'Verified child links updated.', student_ids: verifiedIds });
  }
);

// POST /api/v1/school/students/:id/provision-account (Admin-only student login provisioning)
apiRouter.post(
  '/v1/school/students/:id/provision-account',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id: studentId } = req.params;
    const { email, password } = req.body || {};

    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'A password (min 6 chars) is required.' });
    }

    const pool = getPgPool();
    const stu = pool
      ? (await queryPg('SELECT * FROM students WHERE id = $1 AND school_id = $2', [studentId, schoolId])).rows[0]
      : (cacheDb.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(studentId, schoolId) as any);
    if (!stu) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found in your school.' });
    }

    if (!stu.admission_number || !String(stu.admission_number).trim()) {
      const assignedAdm = await generateNextAdmissionNumber(schoolId);
      stu.admission_number = assignedAdm;
      if (pool) {
        await queryPg('UPDATE students SET admission_number = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [
          assignedAdm,
          studentId,
          schoolId,
        ]);
      }
      try {
        cacheDb
          .prepare('UPDATE students SET admission_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
          .run(assignedAdm, studentId, schoolId);
      } catch {}
    }

    const schoolRow = pool
      ? (await queryPg('SELECT slug FROM schools WHERE id = $1', [schoolId])).rows[0]
      : (cacheDb.prepare('SELECT slug FROM schools WHERE id = ?').get(schoolId) as any);
    const cleanInputEmail = String(email || '').trim().toLowerCase();
    const admToken = String(stu.admission_number || stu.id.slice(-6))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'student';
    const slugToken = String(schoolRow?.slug || 'school')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'school';

    const cleanEmail =
      cleanInputEmail ||
      (stu.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(stu.email).trim())
        ? String(stu.email).trim().toLowerCase()
        : `${admToken}.${schoolId.slice(-4)}@${slugToken}.student.bursariq.local`);

    const studentFullName =
      [stu.first_name, stu.middle_name, stu.last_name].filter(Boolean).join(' ') || stu.full_name || 'Student';

    let userRow = pool
      ? (await queryPg('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [cleanEmail])).rows[0]
      : (cacheDb.prepare('SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1').get(cleanEmail) as any);

    let userId: string;
    if (userRow) {
      if (userRow.is_platform_admin === 1) {
        return res.status(403).json({
          error: 'PLATFORM_ADMIN_PROTECTED',
          message: 'Platform administrator accounts cannot be bound to a student portal profile.',
        });
      }
      userId = userRow.id;
    } else {
      userId = 'usr_' + crypto.randomUUID().slice(0, 12);
      const salt = generateSalt();
      const hash = hashPassword(String(password), salt);
      if (pool) {
        await queryPg(
          `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, cleanEmail, hash, salt, studentFullName, stu.phone || null]
        );
      }
      try {
        cacheDb.prepare(`
          INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(userId, cleanEmail, hash, salt, studentFullName, stu.phone || null);
      } catch {}
    }

    const urId = 'ur_' + crypto.randomUUID().slice(0, 12);
    if (pool) {
      await queryPg(
        `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
         VALUES ($1, $2, $3, 'role_student', 0, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
        [urId, userId, schoolId]
      );
      await queryPg('UPDATE students SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [userId, studentId, schoolId]);
    }
    try {
      cacheDb.prepare(`
        INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
        VALUES (?, ?, ?, 'role_student', 0, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, school_id, role_id) DO NOTHING
      `).run(urId, userId, schoolId);
      cacheDb.prepare('UPDATE students SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?').run(userId, studentId, schoolId);
    } catch {}

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'PROVISION_STUDENT_ACCOUNT',
      entity: 'STUDENT',
      entityId: studentId,
      metadata: { userId, email: cleanEmail },
    });

    return res.status(201).json({
      success: true,
      message: 'Student portal access provisioned.',
      userId,
      studentId,
      loginEmail: cleanEmail,
      admissionNumber: stu.admission_number || null,
    });
  }
);

// POST /api/v1/school/users/bulk-provision-portals (Admin-only one-click login generation for unlinked students & parents)
apiRouter.post(
  '/v1/school/users/bulk-provision-portals',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { target = 'BOTH', custom_password } = req.body || {};
    const normalizedTarget = String(target || 'BOTH').toUpperCase();
    if (!['STUDENTS', 'PARENTS', 'BOTH'].includes(normalizedTarget)) {
      return res.status(400).json({ error: 'INVALID_TARGET', message: 'target must be STUDENTS, PARENTS, or BOTH.' });
    }
    if (custom_password && String(custom_password).length < 6) {
      return res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Custom initial password must be at least 6 characters.' });
    }

    const pool = getPgPool();
    const schoolRow = pool
      ? (await queryPg('SELECT slug, name FROM schools WHERE id = $1', [schoolId])).rows[0]
      : (cacheDb.prepare('SELECT slug, name FROM schools WHERE id = ?').get(schoolId) as any);
    const slugToken =
      String(schoolRow?.slug || 'school')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '') || 'school';

    const generateTempPassword = () =>
      custom_password
        ? String(custom_password)
        : 'Bq' + crypto.randomBytes(4).toString('hex').toUpperCase() + '!';

    const credentials: Array<{
      role: 'STUDENT' | 'PARENT';
      name: string;
      loginIdentifier: string;
      aliasIdentifier: string | null;
      temporaryPassword: string;
    }> = [];
    let skippedCount = 0;

    // Automatically issue Nigerian Admission Numbers to any unnumbered students before generating portal logins
    if (normalizedTarget === 'STUDENTS' || normalizedTarget === 'BOTH') {
      await assignMissingAdmissionNumbersForSchool(schoolId);
    }

    if (normalizedTarget === 'STUDENTS' || normalizedTarget === 'BOTH') {
      const unlinkedStudents: any[] = pool
        ? (
            await queryPg(
              `SELECT * FROM students
               WHERE school_id = $1
                 AND user_id IS NULL
                 AND (is_deleted = 0 OR is_deleted IS NULL)
               ORDER BY created_at ASC`,
              [schoolId]
            )
          ).rows
        : (cacheDb
            .prepare(
              `SELECT * FROM students
               WHERE school_id = ?
                 AND user_id IS NULL
                 AND (is_deleted = 0 OR is_deleted IS NULL)
               ORDER BY created_at ASC`
            )
            .all(schoolId) as any[]);

      for (const stu of unlinkedStudents) {
        const adm = String(stu.admission_number || '').trim();
        const rawEmail = stu.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(stu.email).trim())
          ? String(stu.email).trim().toLowerCase()
          : '';
        if (!adm && !rawEmail) {
          skippedCount += 1;
          continue;
        }
        const admToken =
          (adm || stu.id.slice(-6))
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '.')
            .replace(/^\.+|\.+$/g, '') || 'student';
        const loginEmail = rawEmail || `${admToken}.${schoolId.slice(-4)}@${slugToken}.student.bursariq.local`;

        const existingUser = pool
          ? (await queryPg('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [loginEmail])).rows[0]
          : cacheDb.prepare('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1').get(loginEmail);
        if (existingUser) {
          skippedCount += 1;
          continue;
        }

        const tempPass = generateTempPassword();
        const salt = generateSalt();
        const hash = hashPassword(tempPass, salt);
        const userId = 'usr_' + crypto.randomUUID().slice(0, 12);
        const urId = 'ur_' + crypto.randomUUID().slice(0, 12);
        const fullName =
          [stu.first_name, stu.middle_name, stu.last_name].filter(Boolean).join(' ') || stu.full_name || 'Student';

        if (pool) {
          await queryPg(
            `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [userId, loginEmail, hash, salt, fullName, stu.phone || null]
          );
          await queryPg(
            `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
             VALUES ($1, $2, $3, 'role_student', 1, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
            [urId, userId, schoolId]
          );
          await queryPg('UPDATE students SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [
            userId,
            stu.id,
            schoolId,
          ]);
        }
        try {
          cacheDb
            .prepare(
              `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            )
            .run(userId, loginEmail, hash, salt, fullName, stu.phone || null);
          cacheDb
            .prepare(
              `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
               VALUES (?, ?, ?, 'role_student', 1, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id, school_id, role_id) DO NOTHING`
            )
            .run(urId, userId, schoolId);
          cacheDb
            .prepare('UPDATE students SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
            .run(userId, stu.id, schoolId);
        } catch {}

        credentials.push({
          role: 'STUDENT',
          name: fullName,
          loginIdentifier: adm || loginEmail,
          aliasIdentifier: adm ? loginEmail : null,
          temporaryPassword: tempPass,
        });
      }
    }

    if (normalizedTarget === 'PARENTS' || normalizedTarget === 'BOTH') {
      const unlinkedParents: any[] = pool
        ? (
            await queryPg(
              `SELECT * FROM parents
               WHERE school_id = $1
                 AND user_id IS NULL
                 AND (is_deleted = 0 OR is_deleted IS NULL)
               ORDER BY created_at ASC`,
              [schoolId]
            )
          ).rows
        : (cacheDb
            .prepare(
              `SELECT * FROM parents
               WHERE school_id = ?
                 AND user_id IS NULL
                 AND (is_deleted = 0 OR is_deleted IS NULL)
               ORDER BY created_at ASC`
            )
            .all(schoolId) as any[]);

      for (const par of unlinkedParents) {
        const rawEmail = par.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(par.email).trim())
          ? String(par.email).trim().toLowerCase()
          : '';
        const phoneDigits = normalizePhoneDigits(par.phone);
        if (!rawEmail && phoneDigits.length < 7) {
          skippedCount += 1;
          continue;
        }
        const loginEmail = rawEmail || `${phoneDigits}.${schoolId.slice(-4)}@${slugToken}.parent.bursariq.local`;

        const existingUser = pool
          ? (await queryPg('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [loginEmail])).rows[0]
          : cacheDb.prepare('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1').get(loginEmail);
        if (existingUser) {
          skippedCount += 1;
          continue;
        }

        const tempPass = generateTempPassword();
        const salt = generateSalt();
        const hash = hashPassword(tempPass, salt);
        const userId = 'usr_' + crypto.randomUUID().slice(0, 12);
        const urId = 'ur_' + crypto.randomUUID().slice(0, 12);
        const fullName = `${par.first_name || ''} ${par.last_name || ''}`.trim() || 'Parent';

        if (pool) {
          await queryPg(
            `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [userId, loginEmail, hash, salt, fullName, par.phone || null]
          );
          await queryPg(
            `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
             VALUES ($1, $2, $3, 'role_parent', 1, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
            [urId, userId, schoolId]
          );
          await queryPg('UPDATE parents SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [
            userId,
            par.id,
            schoolId,
          ]);
        }
        try {
          cacheDb
            .prepare(
              `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            )
            .run(userId, loginEmail, hash, salt, fullName, par.phone || null);
          cacheDb
            .prepare(
              `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
               VALUES (?, ?, ?, 'role_parent', 1, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id, school_id, role_id) DO NOTHING`
            )
            .run(urId, userId, schoolId);
          cacheDb
            .prepare('UPDATE parents SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
            .run(userId, par.id, schoolId);
        } catch {}

        credentials.push({
          role: 'PARENT',
          name: fullName,
          loginIdentifier: rawEmail || par.phone,
          aliasIdentifier: par.phone && rawEmail ? par.phone : !rawEmail ? loginEmail : null,
          temporaryPassword: tempPass,
        });
      }
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'BULK_PROVISION_PORTALS',
      entity: 'SCHOOL',
      entityId: schoolId,
      metadata: { target: normalizedTarget, provisionedCount: credentials.length, skippedCount },
    });

    return res.status(201).json({
      success: true,
      message: `Provisioned ${credentials.length} individual portal account(s)${skippedCount ? ` (${skippedCount} skipped)` : ''}.`,
      provisionedCount: credentials.length,
      skippedCount,
      credentials,
    });
  }
);

// PATCH /api/v1/school/users/:userId/status (Admin-only activate / deactivate user without deleting records)
apiRouter.patch(
  '/v1/school/users/:userId/status',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { userId } = req.params;
    const { is_active } = req.body || {};

    if (typeof is_active !== 'boolean' && is_active !== 0 && is_active !== 1) {
      return res.status(400).json({ error: 'INVALID_STATUS', message: 'is_active boolean or 0/1 is required.' });
    }

    if (userId === req.user!.id) {
      return res.status(400).json({ error: 'CANNOT_DEACTIVATE_SELF', message: 'You cannot deactivate your own account.' });
    }

    const activeFlag = is_active === true || is_active === 1 ? 1 : 0;
    const pool = getPgPool();

    const memberRows = pool
      ? (
          await queryPg(
            `SELECT u.id, u.email, u.is_platform_admin, r.name as role_name
             FROM user_roles ur
             JOIN users u ON ur.user_id = u.id
             JOIN roles r ON ur.role_id = r.id
             WHERE ur.user_id = $1 AND ur.school_id = $2`,
            [userId, schoolId]
          )
        ).rows
      : (cacheDb
          .prepare(
            `SELECT u.id, u.email, u.is_platform_admin, r.name as role_name
             FROM user_roles ur
             JOIN users u ON ur.user_id = u.id
             JOIN roles r ON ur.role_id = r.id
             WHERE ur.user_id = ? AND ur.school_id = ?`
          )
          .all(userId, schoolId) as any[]);

    if (memberRows.length === 0) {
      return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User does not belong to this school.' });
    }

    if (memberRows.some((m: any) => m.is_platform_admin === 1 || m.role_name === 'SCHOOL_OWNER')) {
      return res.status(403).json({
        error: 'PROTECTED_ACCOUNT',
        message: 'School Owner and Platform Super Admin accounts cannot be deactivated here.',
      });
    }

    if (pool) {
      await queryPg('UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [activeFlag, userId]);
      if (activeFlag === 0) {
        await queryPg('DELETE FROM sessions WHERE user_id = $1', [userId]);
      }
    }
    try {
      cacheDb.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(activeFlag, userId);
      if (activeFlag === 0) {
        cacheDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      }
    } catch {}

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: activeFlag === 1 ? 'ACTIVATE_PORTAL_USER' : 'DEACTIVATE_PORTAL_USER',
      entity: 'USER',
      entityId: userId,
      metadata: { email: memberRows[0].email, is_active: activeFlag },
    });

    return res.json({
      success: true,
      message: activeFlag === 1 ? 'User account activated.' : 'User account deactivated and active sessions revoked.',
      userId,
      is_active: activeFlag,
    });
  }
);

// DELETE /api/v1/school/users/:userId (Revoke user's role in this school)
apiRouter.delete(
  '/v1/school/users/:userId',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { userId } = req.params;

    if (userId === req.user!.id) {
      return res.status(400).json({ error: 'CANNOT_REMOVE_SELF', message: 'You cannot revoke your own school access.' });
    }

    const pool = getPgPool();
    const roleCheck = pool
      ? (await queryPg('SELECT r.name as role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1 AND ur.school_id = $2', [userId, schoolId])).rows
      : (cacheDb.prepare('SELECT r.name as role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND ur.school_id = ?').all(userId, schoolId) as any[]);

    if (roleCheck.some((r: any) => r.role_name === 'SCHOOL_OWNER')) {
      return res.status(403).json({ error: 'CANNOT_REMOVE_OWNER', message: 'Cannot revoke the School Owner role.' });
    }

    if (pool) {
      await queryPg('DELETE FROM user_roles WHERE user_id = $1 AND school_id = $2', [userId, schoolId]);
      await queryPg('UPDATE parents SET user_id = NULL WHERE user_id = $1 AND school_id = $2', [userId, schoolId]);
      await queryPg('UPDATE students SET user_id = NULL WHERE user_id = $1 AND school_id = $2', [userId, schoolId]);
    }
    try {
      cacheDb.prepare('DELETE FROM user_roles WHERE user_id = ? AND school_id = ?').run(userId, schoolId);
      cacheDb.prepare('UPDATE parents SET user_id = NULL WHERE user_id = ? AND school_id = ?').run(userId, schoolId);
      cacheDb.prepare('UPDATE students SET user_id = NULL WHERE user_id = ? AND school_id = ?').run(userId, schoolId);
    } catch {}

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'REVOKE_PORTAL_USER',
      entity: 'USER',
      entityId: userId,
    });

    return res.json({ success: true, message: 'User access revoked for this school.' });
  }
);

// GET /api/v1/school/audit-logs (Audit trail for this school tenant only)
apiRouter.get(
  '/v1/school/audit-logs',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const pool = getPgPool();
    try {
      let logs: any[] = [];
      const pgLogs = pool
        ? await queryPg(`
        SELECT * FROM audit_logs
        WHERE school_id = $1
        ORDER BY created_at DESC
        LIMIT 100
      `, [schoolId])
        : null;

      if (pgLogs) {
        logs = pgLogs.rows;
      } else {
        logs = cacheDb.prepare(`
          SELECT * FROM audit_logs
          WHERE school_id = ?
          ORDER BY created_at DESC
          LIMIT 100
        `).all(schoolId);
      }

      return res.json({ success: true, logs });
    } catch (err: any) {
      console.error('[GET /v1/school/audit-logs Error]', err);
      return res.status(500).json({ error: 'FETCH_FAILED', message: safeClientError(err) });
    }
  }
);

// ==============================================================================
// 3. SUPER ADMIN PLATFORM ROUTES DELEGATED TO adminRouter (/v1/admin)
// ==============================================================================

// ==============================================================================
// 4. INTERACTIVE VERIFICATION / IDOR ATTACK SIMULATOR (PROVES TENANT ISOLATION)
// ==============================================================================

// POST /api/v1/test/simulate-idor
// This endpoint allows authorized administrators and auditors to verify cross-tenant isolation
apiRouter.post('/v1/test/simulate-idor', requireAuth, (req: AuthenticatedRequest, res) => {
  const isSuper = req.user?.is_platform_admin === 1;
  const hasAdminRole = (req.roles || []).some((r) => ['SCHOOL_OWNER', 'SCHOOL_ADMIN'].includes(r.role_name));
  if (!isSuper && !hasAdminRole) {
    return res.status(403).json({
      error: 'FORBIDDEN_ROLE',
      message: 'Only School Administrators or Super Admins can run the tenant isolation verifier.',
    });
  }

  const { foreignSchoolId } = req.body;

  if (!foreignSchoolId) {
    return res.status(400).json({ error: 'MISSING_PARAM', message: 'foreignSchoolId is required to test isolation' });
  }

  // Infiltrating foreign school: attach to headers so requireTenant detects the mismatch against user's active tenant
  req.headers['x-school-id'] = foreignSchoolId;

  // Run the tenant guard manually to capture result
  requireTenant(req, res, () => {
    // Only reachable if user is platform super admin or actually authorized
    return res.json({
      accessGranted: true,
      message: 'Access permitted because you are either a Super Admin or legitimately belong to this school.',
      schoolId: foreignSchoolId,
    });
  });
});


// GET /api/v1/school/staff/export (Tenant-scoped staff directory export)
apiRouter.get(
  '/v1/school/staff/export',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    let staffList: any[] = [];
    const { getPgPool } = await import('./db.ts');
    const pool = getPgPool();
    if (pool) {
      try {
        const pgRes = await pool.query(`
          SELECT staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined
          FROM staff
          WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
          ORDER BY last_name ASC, first_name ASC
        `, [schoolId]);
        staffList = pgRes.rows;
      } catch {}
    }
    if (staffList.length === 0) {
      staffList = db.prepare(`
        SELECT staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined
        FROM staff
        WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
        ORDER BY last_name ASC, first_name ASC
      `).all(schoolId) as any[];
    }

    const headers = ['Staff Number', 'First Name', 'Middle Name', 'Last Name', 'Email', 'Phone', 'Gender', 'Job Title', 'Department', 'Status', 'Date Joined'];
    const csvRows = [headers.join(',')];
    for (const s of staffList) {
      csvRows.push([
        sanitizeCsvCell(s.staff_number || ''),
        sanitizeCsvCell(s.first_name || ''),
        sanitizeCsvCell(s.middle_name || ''),
        sanitizeCsvCell(s.last_name || ''),
        sanitizeCsvCell(s.email || ''),
        sanitizeCsvCell(s.phone || ''),
        sanitizeCsvCell(s.gender || ''),
        sanitizeCsvCell(s.job_title || ''),
        sanitizeCsvCell(s.department || ''),
        sanitizeCsvCell(s.employment_status || 'ACTIVE'),
        sanitizeCsvCell(s.date_joined || '')
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=staff_${schoolId}.csv`);
    return res.send(csvRows.join('\n'));
  }
);

// GET /api/v1/school/parents/export (Tenant-scoped parents directory export)
apiRouter.get(
  '/v1/school/parents/export',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    let parentsList: any[] = [];
    const { getPgPool } = await import('./db.ts');
    const pool = getPgPool();
    if (pool) {
      try {
        const pgRes = await pool.query(`
          SELECT first_name, last_name, phone, email, address, occupation, relationship
          FROM parents
          WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
          ORDER BY last_name ASC, first_name ASC
        `, [schoolId]);
        parentsList = pgRes.rows;
      } catch {}
    }
    if (parentsList.length === 0) {
      parentsList = db.prepare(`
        SELECT first_name, last_name, phone, email, address, occupation, relationship
        FROM parents
        WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
        ORDER BY last_name ASC, first_name ASC
      `).all(schoolId) as any[];
    }

    const headers = ['First Name', 'Last Name', 'Phone', 'Email', 'Address', 'Occupation', 'Relationship'];
    const csvRows = [headers.join(',')];
    for (const p of parentsList) {
      csvRows.push([
        sanitizeCsvCell(p.first_name || ''),
        sanitizeCsvCell(p.last_name || ''),
        sanitizeCsvCell(p.phone || ''),
        sanitizeCsvCell(p.email || ''),
        sanitizeCsvCell(p.address || ''),
        sanitizeCsvCell(p.occupation || ''),
        sanitizeCsvCell(p.relationship || '')
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=parents_${schoolId}.csv`);
    return res.send(csvRows.join('\n'));
  }
);
