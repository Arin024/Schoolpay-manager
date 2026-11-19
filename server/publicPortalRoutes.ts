import express from 'express';
import crypto from 'node:crypto';
import {
  cacheDb,
  getPgPool,
  normalizeSubdomainSlug,
  queryPg,
} from './db.ts';
import {
  hashPassword,
  generateSalt,
  createSessionAsync,
} from './auth.ts';
import { logAudit } from './audit.ts';
import { wrapRouterAsync, safeClientError } from './securityUtils.ts';

export const publicPortalRouter = wrapRouterAsync(express.Router());

// Simple in-memory per-IP rate limiter for unauthenticated portal activation & verification
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 40;

function enforcePublicRateLimit(req: express.Request, res: express.Response): boolean {
  const ip =
    String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() ||
    req.ip ||
    'unknown';
  const key = `${ip}:${req.path}`;
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX_REQUESTS) {
    res.status(429).json({
      error: 'TOO_MANY_ATTEMPTS',
      message: 'Too many verification attempts. Please wait a few minutes and try again.',
    });
    return false;
  }
  entry.count += 1;
  return true;
}

export function normalizePhoneDigits(phone: unknown): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

function normalizeDob(dob: unknown): string {
  if (!dob) return '';
  if (dob instanceof Date && !Number.isNaN(dob.getTime())) {
    return dob.toISOString().slice(0, 10);
  }
  const raw = String(dob).trim();
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const dmyMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  return raw.slice(0, 10);
}

function maskPersonName(fullName: string | null | undefined): string {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Verified Record';
  if (parts.length === 1) return parts[0].slice(0, 2) + '***';
  return parts
    .map((part, idx) => (idx === 0 ? part : part.charAt(0) + '***'))
    .join(' ');
}

function formatSchoolPublicSummary(s: any) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    type: s.type,
    status: s.status,
    state: s.state,
    lga: s.lga,
    address: s.address || null,
    phone: s.phone || null,
    email: s.email || null,
    website: s.website || null,
    logo_url: s.logo_url || null,
  };
}

function buildStudentFullName(stu: any): string {
  const joined = [stu?.first_name, stu?.middle_name, stu?.last_name]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ');
  return joined || String(stu?.full_name || '').trim() || 'Student';
}

function makeSafeSlugToken(value: unknown, fallback = 'id'): string {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return cleaned || fallback;
}

async function findActiveSchoolBySlugOrId(identifier: string): Promise<any | null> {
  const clean = String(identifier || '').trim();
  if (!clean) return null;
  const cleanLower = clean.toLowerCase();
  const normalizedInput = normalizeSubdomainSlug(clean);
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await queryPg(
        `SELECT s.* FROM schools s
         LEFT JOIN school_settings ss ON ss.school_id = s.id
         WHERE (LOWER(s.slug) = LOWER($1) OR LOWER(COALESCE(ss.portal_subdomain, '')) = LOWER($1) OR s.id = $1)
           AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         LIMIT 1`,
        [clean]
      );
      if (res.rows[0]) return res.rows[0];

      const allPg = await queryPg(
        `SELECT s.*, ss.portal_subdomain FROM schools s
         LEFT JOIN school_settings ss ON ss.school_id = s.id
         WHERE (s.is_deleted = 0 OR s.is_deleted IS NULL)
           AND UPPER(COALESCE(s.status, 'TRIAL')) != 'CANCELLED'`,
        []
      );
      const matchedPg = allPg.rows.find((row: any) => {
        const sub = String(row.portal_subdomain || '').trim().toLowerCase();
        const slug = String(row.slug || '').trim().toLowerCase();
        return (
          (sub && normalizeSubdomainSlug(sub) === normalizedInput) ||
          (slug && normalizeSubdomainSlug(slug) === normalizedInput) ||
          (slug && slug.startsWith(`${cleanLower}-`)) ||
          (sub && sub.startsWith(`${cleanLower}-`))
        );
      });
      if (matchedPg) return matchedPg;
    } catch (err: any) {
      console.warn('[Public School Lookup PG Notice]', err?.message);
    }
  }
  const exactSqlite =
    cacheDb
      .prepare(
        `SELECT s.* FROM schools s
         LEFT JOIN school_settings ss ON ss.school_id = s.id
         WHERE (LOWER(s.slug) = LOWER(?) OR LOWER(COALESCE(ss.portal_subdomain, '')) = LOWER(?) OR s.id = ?)
           AND UPPER(COALESCE(s.status, 'TRIAL')) != 'CANCELLED'
         LIMIT 1`
      )
      .get(clean, clean, clean) || null;
  if (exactSqlite) return exactSqlite;

  const allSqlite = cacheDb
    .prepare(
      `SELECT s.*, ss.portal_subdomain FROM schools s
       LEFT JOIN school_settings ss ON ss.school_id = s.id
       WHERE UPPER(COALESCE(s.status, 'TRIAL')) != 'CANCELLED'`
    )
    .all() as any[];

  return (
    allSqlite.find((row: any) => {
      const sub = String(row.portal_subdomain || '').trim().toLowerCase();
      const slug = String(row.slug || '').trim().toLowerCase();
      return (
        (sub && normalizeSubdomainSlug(sub) === normalizedInput) ||
        (slug && normalizeSubdomainSlug(slug) === normalizedInput) ||
        (slug && slug.startsWith(`${cleanLower}-`)) ||
        (sub && sub.startsWith(`${cleanLower}-`))
      );
    }) || null
  );
}

// ==============================================================================
// 1. PUBLIC SCHOOL DIRECTORY SEARCH
// GET /api/v1/public/schools?q=...
// ==============================================================================
publicPortalRouter.get('/schools', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = 15;
  const pool = getPgPool();

  let rows: any[] = [];
  if (pool) {
    try {
      if (q) {
        const pattern = `%${q.toLowerCase()}%`;
        const pgRes = await queryPg(
          `SELECT s.id, s.name, s.slug, s.type, s.status, s.state, s.lga, s.logo_url, s.website, ss.portal_subdomain
           FROM schools s
           LEFT JOIN school_settings ss ON ss.school_id = s.id
           WHERE (s.is_deleted = 0 OR s.is_deleted IS NULL)
             AND UPPER(COALESCE(s.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
             AND (LOWER(s.name) LIKE $1 OR LOWER(s.slug) LIKE $1 OR LOWER(COALESCE(ss.portal_subdomain, '')) LIKE $1 OR LOWER(s.state) LIKE $1 OR LOWER(s.lga) LIKE $1)
           ORDER BY s.name ASC
           LIMIT $2`,
          [pattern, limit]
        );
        rows = pgRes.rows;
      } else {
        const pgRes = await queryPg(
          `SELECT s.id, s.name, s.slug, s.type, s.status, s.state, s.lga, s.logo_url, s.website, ss.portal_subdomain
           FROM schools s
           LEFT JOIN school_settings ss ON ss.school_id = s.id
           WHERE (s.is_deleted = 0 OR s.is_deleted IS NULL)
             AND UPPER(COALESCE(s.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
           ORDER BY s.created_at DESC, s.name ASC
           LIMIT $1`,
          [limit]
        );
        rows = pgRes.rows;
      }
    } catch (err: any) {
      console.warn('[Public Schools Search PG Notice]', err?.message);
    }
  }

  if (rows.length === 0) {
    if (q) {
      const pattern = `%${q.toLowerCase()}%`;
      rows = cacheDb
        .prepare(
          `SELECT s.id, s.name, s.slug, s.type, s.status, s.state, s.lga, s.logo_url, s.website, ss.portal_subdomain
           FROM schools s
           LEFT JOIN school_settings ss ON ss.school_id = s.id
           WHERE UPPER(COALESCE(s.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
             AND (LOWER(s.name) LIKE ? OR LOWER(s.slug) LIKE ? OR LOWER(COALESCE(ss.portal_subdomain, '')) LIKE ? OR LOWER(s.state) LIKE ? OR LOWER(s.lga) LIKE ?)
           ORDER BY s.name ASC
           LIMIT ?`
        )
        .all(pattern, pattern, pattern, pattern, pattern, limit) as any[];
    } else {
      rows = cacheDb
        .prepare(
          `SELECT s.id, s.name, s.slug, s.type, s.status, s.state, s.lga, s.logo_url, s.website, ss.portal_subdomain
           FROM schools s
           LEFT JOIN school_settings ss ON ss.school_id = s.id
           WHERE UPPER(COALESCE(s.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
           ORDER BY s.created_at DESC, s.name ASC
           LIMIT ?`
        )
        .all(limit) as any[];
    }
  }

  return res.json({
    success: true,
    schools: rows.map(formatSchoolPublicSummary),
  });
});

// ==============================================================================
// 2. PUBLIC SCHOOL BRANDED PORTAL METADATA
// GET /api/v1/public/schools/:slug
// ==============================================================================
publicPortalRouter.get('/schools/:slug', async (req, res) => {
  const school = await findActiveSchoolBySlugOrId(req.params.slug);
  if (!school) {
    return res.status(404).json({
      error: 'SCHOOL_NOT_FOUND',
      message: 'No active school portal was found for that school code or link.',
    });
  }
  const statusUpper = String(school.status || '').toUpperCase();
  if (statusUpper === 'CANCELLED') {
    return res.status(404).json({
      error: 'SCHOOL_UNAVAILABLE',
      message: 'This school portal is currently unavailable.',
    });
  }

  return res.json({
    success: true,
    school: formatSchoolPublicSummary(school),
  });
});

// ==============================================================================
// 3. PUBLIC / OUTSIDER DOCUMENT VERIFICATION (RECEIPT OR REPORT CARD)
// POST /api/v1/public/verify-document
// ==============================================================================
publicPortalRouter.post('/verify-document', async (req, res) => {
  if (!enforcePublicRateLimit(req, res)) return;

  const { document_type, code, school_slug } = req.body || {};
  const cleanCode = String(code || '').trim();
  const docType = String(document_type || 'RECEIPT').toUpperCase();

  if (!cleanCode || !['RECEIPT', 'REPORT_CARD'].includes(docType)) {
    return res.status(400).json({
      valid: false,
      error: 'INVALID_REQUEST',
      message: 'Provide document_type (RECEIPT or REPORT_CARD) and a verification/receipt number.',
    });
  }

  let scopedSchoolId: string | null = null;
  if (school_slug) {
    const matchedSchool = await findActiveSchoolBySlugOrId(String(school_slug));
    if (!matchedSchool) {
      return res.status(404).json({
        valid: false,
        error: 'SCHOOL_NOT_FOUND',
        message: 'Specified school portal could not be found.',
      });
    }
    scopedSchoolId = matchedSchool.id;
  }

  const pool = getPgPool();

  if (docType === 'RECEIPT') {
    let rec: any = null;
    if (pool) {
      try {
        const pgRes = await queryPg(
          `SELECT r.id, r.receipt_number, r.issued_at, r.created_at,
                  p.amount, p.currency, p.payment_method, p.status AS payment_status, p.payment_date, p.payment_reference,
                  s.id AS school_id, s.name AS school_name, s.slug AS school_slug, s.state AS school_state, s.lga AS school_lga,
                  st.first_name, st.middle_name, st.last_name
           FROM receipts r
           JOIN payments p ON p.id = r.payment_id
           JOIN schools s ON s.id = r.school_id
           JOIN students st ON st.id = p.student_id
           WHERE UPPER(TRIM(r.receipt_number)) = UPPER($1)
             AND (r.is_deleted = 0 OR r.is_deleted IS NULL)
             AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
             ${scopedSchoolId ? 'AND r.school_id = $2' : ''}
           LIMIT 1`,
          scopedSchoolId ? [cleanCode, scopedSchoolId] : [cleanCode]
        );
        rec = pgRes.rows[0] || null;
      } catch (err: any) {
        console.warn('[Public Verify Receipt PG Notice]', err?.message);
      }
    }

    if (!rec) {
      rec = cacheDb
        .prepare(
          `SELECT r.id, r.receipt_number, r.created_at,
                  p.amount, p.currency, p.payment_method, p.status AS payment_status, p.payment_date, p.payment_reference,
                  s.id AS school_id, s.name AS school_name, s.slug AS school_slug, s.state AS school_state, s.lga AS school_lga,
                  st.first_name, st.middle_name, st.last_name
           FROM receipts r
           JOIN payments p ON p.id = r.payment_id
           JOIN schools s ON s.id = r.school_id
           JOIN students st ON st.id = p.student_id
           WHERE UPPER(TRIM(r.receipt_number)) = UPPER(?)
             AND UPPER(COALESCE(s.status, 'TRIAL')) != 'CANCELLED'
             ${scopedSchoolId ? 'AND r.school_id = ?' : ''}
           LIMIT 1`
        )
        .get(...(scopedSchoolId ? [cleanCode, scopedSchoolId] : [cleanCode])) as any;
    }

    if (!rec) {
      return res.status(404).json({
        valid: false,
        error: 'DOCUMENT_NOT_FOUND',
        message: 'No official receipt matched that receipt number.',
      });
    }

    return res.json({
      valid: true,
      document_type: 'RECEIPT',
      school: {
        id: rec.school_id,
        name: rec.school_name,
        slug: rec.school_slug,
        state: rec.school_state,
        lga: rec.school_lga,
      },
      details: {
        receipt_number: rec.receipt_number,
        student_name_masked: maskPersonName(buildStudentFullName(rec)),
        amount_kobo: Number(rec.amount || 0),
        currency: rec.currency || 'NGN',
        payment_method: rec.payment_method,
        payment_status: rec.payment_status,
        payment_date: rec.payment_date || rec.issued_at || rec.created_at,
        payment_reference: rec.payment_reference,
      },
    });
  }

  // REPORT_CARD verification
  let card: any = null;
  if (pool) {
    try {
      const pgRes = await queryPg(
        `SELECT rc.id, rc.verification_code, rc.status, rc.average_score, rc.subjects_count, rc.published_at,
                s.id AS school_id, s.name AS school_name, s.slug AS school_slug, s.state AS school_state, s.lga AS school_lga,
                st.first_name, st.middle_name, st.last_name,
                c.name AS class_name,
                sess.name AS session_name,
                t.name AS term_name
         FROM report_cards rc
         JOIN schools s ON s.id = rc.school_id
         JOIN students st ON st.id = rc.student_id
         LEFT JOIN classes c ON c.id = rc.class_id
         LEFT JOIN academic_sessions sess ON sess.id = rc.academic_session_id
         LEFT JOIN terms t ON t.id = rc.term_id
         WHERE UPPER(TRIM(rc.verification_code)) = UPPER($1)
           AND rc.status = 'PUBLISHED'
           AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
           ${scopedSchoolId ? 'AND rc.school_id = $2' : ''}
         LIMIT 1`,
        scopedSchoolId ? [cleanCode, scopedSchoolId] : [cleanCode]
      );
      card = pgRes.rows[0] || null;
    } catch (err: any) {
      console.warn('[Public Verify Report Card PG Notice]', err?.message);
    }
  }

  if (!card) {
    card = cacheDb
      .prepare(
        `SELECT rc.id, rc.verification_code, rc.status, rc.average_score, rc.subjects_count, rc.published_at,
                s.id AS school_id, s.name AS school_name, s.slug AS school_slug, s.state AS school_state, s.lga AS school_lga,
                st.first_name, st.middle_name, st.last_name,
                c.name AS class_name,
                sess.name AS session_name,
                t.name AS term_name
         FROM report_cards rc
         JOIN schools s ON s.id = rc.school_id
         JOIN students st ON st.id = rc.student_id
         LEFT JOIN classes c ON c.id = rc.class_id
         LEFT JOIN academic_sessions sess ON sess.id = rc.academic_session_id
         LEFT JOIN terms t ON t.id = rc.term_id
         WHERE UPPER(TRIM(rc.verification_code)) = UPPER(?)
           AND rc.status = 'PUBLISHED'
           AND UPPER(COALESCE(s.status, 'TRIAL')) != 'CANCELLED'
           ${scopedSchoolId ? 'AND rc.school_id = ?' : ''}
         LIMIT 1`
      )
      .get(...(scopedSchoolId ? [cleanCode, scopedSchoolId] : [cleanCode])) as any;
  }

  if (!card) {
    // Also check Full-Session Cumulative Annual Report Cards (SRC-...)
    if (getPgPool()) {
      try {
        const pgSessionRes = await queryPg(
          `SELECT src.id, src.verification_code, src.status, src.average_score, src.subjects_count, src.published_at,
                  s.id AS school_id, s.name AS school_name, s.slug AS school_slug, s.state AS school_state, s.lga AS school_lga,
                  st.first_name, st.middle_name, st.last_name,
                  c.name AS class_name,
                  sess.name AS session_name,
                  'Full Academic Session' AS term_name
           FROM session_report_cards src
           JOIN schools s ON s.id = src.school_id
           JOIN students st ON st.id = src.student_id
           LEFT JOIN classes c ON c.id = src.class_id
           LEFT JOIN academic_sessions sess ON sess.id = src.academic_session_id
           WHERE UPPER(TRIM(src.verification_code)) = UPPER($1)
             AND src.status = 'PUBLISHED'
             AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
             ${scopedSchoolId ? 'AND src.school_id = $2' : ''}
           LIMIT 1`,
          scopedSchoolId ? [cleanCode, scopedSchoolId] : [cleanCode]
        );
        card = pgSessionRes.rows[0] || null;
      } catch (err: any) {
        console.warn('[Public Verify Session Report Card PG Notice]', err?.message);
      }
    }
    if (!card) {
      try {
        card = cacheDb
          .prepare(
            `SELECT src.id, src.verification_code, src.status, src.average_score, src.subjects_count, src.published_at,
                    s.id AS school_id, s.name AS school_name, s.slug AS school_slug, s.state AS school_state, s.lga AS school_lga,
                    st.first_name, st.middle_name, st.last_name,
                    c.name AS class_name,
                    sess.name AS session_name,
                    'Full Academic Session' AS term_name
             FROM session_report_cards src
             JOIN schools s ON s.id = src.school_id
             JOIN students st ON st.id = src.student_id
             LEFT JOIN classes c ON c.id = src.class_id
             LEFT JOIN academic_sessions sess ON sess.id = src.academic_session_id
             WHERE UPPER(TRIM(src.verification_code)) = UPPER(?)
               AND src.status = 'PUBLISHED'
               AND UPPER(COALESCE(s.status, 'TRIAL')) != 'CANCELLED'
               ${scopedSchoolId ? 'AND src.school_id = ?' : ''}
             LIMIT 1`
          )
          .get(...(scopedSchoolId ? [cleanCode, scopedSchoolId] : [cleanCode])) as any;
      } catch {}
    }
  }

  if (!card) {
    return res.status(404).json({
      valid: false,
      error: 'DOCUMENT_NOT_FOUND',
      message: 'No published report card matched that verification code.',
    });
  }

  return res.json({
    valid: true,
    document_type: 'REPORT_CARD',
    school: {
      id: card.school_id,
      name: card.school_name,
      slug: card.school_slug,
      state: card.school_state,
      lga: card.school_lga,
    },
    details: {
      verification_code: card.verification_code,
      student_name_masked: maskPersonName(buildStudentFullName(card)),
      class_name: card.class_name || 'N/A',
      session_name: card.session_name || 'N/A',
      term_name: card.term_name || 'N/A',
      subjects_count: Number(card.subjects_count || 0),
      published_at: card.published_at,
    },
  });
});

// ==============================================================================
// 4. ZERO-TRUST SELF-ACTIVATION FOR VERIFIED SCHOOL STUDENTS & PARENTS
// POST /api/v1/public/portal/activate
// Only activates pre-enrolled unlinked (user_id IS NULL) STUDENT or PARENT records
// after multi-field verification against records stored by the School Admin.
// Never grants staff, bursar, or administrative roles.
// ==============================================================================
publicPortalRouter.post('/portal/activate', async (req, res) => {
  if (!enforcePublicRateLimit(req, res)) return;

  try {
    const {
      school_slug,
      school_id,
      portal_type,
      admission_number,
      last_name,
      verification_value,
      contact,
      child_identifier,
      login_email,
      password,
    } = req.body || {};

    const portalType = String(portal_type || '').toUpperCase();
    if (!['STUDENT', 'PARENT'].includes(portalType)) {
      return res.status(400).json({
        error: 'INVALID_PORTAL_TYPE',
        message: 'Self-activation is only supported for STUDENT or PARENT portal accounts.',
      });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        error: 'WEAK_PASSWORD',
        message: 'Please choose a personal password with at least 6 characters.',
      });
    }

    const schoolIdentifier = String(school_slug || school_id || '').trim();
    const school = await findActiveSchoolBySlugOrId(schoolIdentifier);
    if (!school || ['CANCELLED', 'SUSPENDED'].includes(String(school.status || '').toUpperCase())) {
      return res.status(404).json({
        error: 'SCHOOL_NOT_FOUND',
        message: 'Select a valid, active school before activating portal access.',
      });
    }

    const pool = getPgPool();
    const cleanLastName = String(last_name || '').trim().toLowerCase();
    const cleanLoginEmail = login_email ? String(login_email).trim().toLowerCase() : '';
    if (cleanLoginEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanLoginEmail)) {
      return res.status(400).json({
        error: 'INVALID_EMAIL',
        message: 'Please provide a valid personal email address or leave email blank.',
      });
    }

    let boundUserId: string | null = null;
    let boundEmail = '';
    let boundFullName = '';
    let boundPhone: string | null = null;
    let assignedRoleId = 'role_student';
    let entityType: 'STUDENT' | 'PARENT' = 'STUDENT';
    let entityId = '';

    if (portalType === 'STUDENT') {
      const cleanAdm = String(admission_number || '').trim().toLowerCase();
      const cleanVerif = String(verification_value || '').trim();
      if (!cleanAdm || !cleanLastName || !cleanVerif) {
        return res.status(400).json({
          error: 'MISSING_FIELDS',
          message: 'Admission number, student surname, and verification detail (date of birth, phone, or email on file) are required.',
        });
      }

      let student: any = null;
      if (pool) {
        try {
          const pgRes = await queryPg(
            `SELECT * FROM students
             WHERE school_id = $1
               AND LOWER(TRIM(admission_number)) = $2
               AND (is_deleted = 0 OR is_deleted IS NULL)
             LIMIT 1`,
            [school.id, cleanAdm]
          );
          student = pgRes.rows[0] || null;
        } catch (err: any) {
          console.warn('[Self Activate Student PG Notice]', err?.message);
        }
      }
      if (!student) {
        student = cacheDb
          .prepare(
            `SELECT * FROM students
             WHERE school_id = ?
               AND LOWER(TRIM(admission_number)) = ?
               AND (is_deleted = 0 OR is_deleted IS NULL)
             LIMIT 1`
          )
          .get(school.id, cleanAdm);
      }

      if (!student || String(student.last_name || '').trim().toLowerCase() !== cleanLastName) {
        return res.status(401).json({
          error: 'VERIFICATION_FAILED',
          message: 'No student record matched that admission number and surname at this school.',
        });
      }

      // Collect authoritative verification factors from student & verified parents
      let linkedParents: any[] = [];
      if (pool) {
        try {
          const pRes = await queryPg(
            `SELECT p.phone, p.email, p.alternate_phone
             FROM parent_students ps
             JOIN parents p ON p.id = ps.parent_id
             WHERE ps.student_id = $1 AND ps.school_id = $2
               AND (p.is_deleted = 0 OR p.is_deleted IS NULL)`,
            [student.id, school.id]
          );
          linkedParents = pRes.rows;
        } catch {}
      }
      if (linkedParents.length === 0) {
        linkedParents = cacheDb
          .prepare(
            `SELECT p.phone, p.email
             FROM parent_students ps
             JOIN parents p ON p.id = ps.parent_id
             WHERE ps.student_id = ? AND ps.school_id = ?
               AND (p.is_deleted = 0 OR p.is_deleted IS NULL)`
          )
          .all(student.id, school.id) as any[];
      }

      const dobOnFile = normalizeDob(student.date_of_birth);
      const emailCandidates = new Set<string>();
      const phoneCandidates = new Set<string>();

      if (student.email) emailCandidates.add(String(student.email).trim().toLowerCase());
      if (student.phone) {
        const d = normalizePhoneDigits(student.phone);
        if (d.length >= 7) phoneCandidates.add(d);
      }
      if (student.emergency_contact) {
        const ecDigitsMatches = String(student.emergency_contact).match(/(?:\+?234|0)?[789][01]\d{8}|\d{7,14}/g) || [];
        for (const rawNum of ecDigitsMatches) {
          const d = normalizePhoneDigits(rawNum);
          if (d.length >= 7) phoneCandidates.add(d);
        }
      }
      for (const p of linkedParents) {
        if (p.email) emailCandidates.add(String(p.email).trim().toLowerCase());
        if (p.phone) {
          const d = normalizePhoneDigits(p.phone);
          if (d.length >= 7) phoneCandidates.add(d);
        }
        if (p.alternate_phone) {
          const d = normalizePhoneDigits(p.alternate_phone);
          if (d.length >= 7) phoneCandidates.add(d);
        }
      }

      if (!dobOnFile && emailCandidates.size === 0 && phoneCandidates.size === 0) {
        return res.status(400).json({
          error: 'VERIFICATION_DATA_MISSING',
          message: 'Your school has not yet recorded a date of birth, phone number, or guardian contact on your profile. Please ask your School Administrator to issue your portal login.',
        });
      }

      const verifDob = normalizeDob(cleanVerif);
      const verifEmail = cleanVerif.toLowerCase();
      const verifPhone = normalizePhoneDigits(cleanVerif);

      const factorMatched =
        (dobOnFile && verifDob && dobOnFile === verifDob) ||
        (cleanVerif.includes('@') && emailCandidates.has(verifEmail)) ||
        (verifPhone.length >= 7 && phoneCandidates.has(verifPhone));

      if (!factorMatched) {
        return res.status(401).json({
          error: 'VERIFICATION_FAILED',
          message: 'Verification failed. Check your Date of Birth (YYYY-MM-DD), phone number, or email on file with your school.',
        });
      }

      if (student.user_id) {
        return res.status(409).json({
          error: 'ALREADY_ACTIVATED',
          message: 'This student portal account is already activated. Please use the Student tab in Sign In or ask your school admin to reset your password.',
        });
      }

      const admToken = makeSafeSlugToken(student.admission_number, student.id.slice(-6));
      const slugToken = makeSafeSlugToken(school.slug, 'school');
      boundEmail =
        cleanLoginEmail ||
        (student.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(student.email).trim())
          ? String(student.email).trim().toLowerCase()
          : `${admToken}.${school.id.slice(-4)}@${slugToken}.student.bursariq.local`);
      boundFullName = buildStudentFullName(student);
      boundPhone = student.phone || null;
      assignedRoleId = 'role_student';
      entityType = 'STUDENT';
      entityId = student.id;
    } else {
      // PARENT self-activation
      const cleanContact = String(contact || '').trim();
      const cleanChildIdent = String(child_identifier || '').trim().toLowerCase();
      if (!cleanContact || !cleanLastName || !cleanChildIdent) {
        return res.status(400).json({
          error: 'MISSING_FIELDS',
          message: 'Registered email or phone number, guardian surname, and a linked child admission number or first name are required.',
        });
      }

      const contactEmail = cleanContact.includes('@') ? cleanContact.toLowerCase() : '';
      const contactDigits = normalizePhoneDigits(cleanContact);

      let candidateParents: any[] = [];
      if (pool) {
        try {
          const pRes = await queryPg(
            `SELECT * FROM parents
             WHERE school_id = $1
               AND LOWER(TRIM(last_name)) = $2
               AND (is_deleted = 0 OR is_deleted IS NULL)`,
            [school.id, cleanLastName]
          );
          candidateParents = pRes.rows;
        } catch (err: any) {
          console.warn('[Self Activate Parent PG Notice]', err?.message);
        }
      }
      if (candidateParents.length === 0) {
        candidateParents = cacheDb
          .prepare(
            `SELECT * FROM parents
             WHERE school_id = ?
               AND LOWER(TRIM(last_name)) = ?
               AND (is_deleted = 0 OR is_deleted IS NULL)`
          )
          .all(school.id, cleanLastName) as any[];
      }

      const matchedParents = candidateParents.filter((p) => {
        if (contactEmail && String(p.email || '').trim().toLowerCase() === contactEmail) {
          return true;
        }
        if (contactDigits.length >= 7) {
          const p1 = normalizePhoneDigits(p.phone);
          const p2 = normalizePhoneDigits(p.alternate_phone);
          if ((p1.length >= 7 && p1 === contactDigits) || (p2.length >= 7 && p2 === contactDigits)) {
            return true;
          }
        }
        return false;
      });

      if (matchedParents.length === 0) {
        return res.status(401).json({
          error: 'VERIFICATION_FAILED',
          message: 'No guardian profile matched your registered contact and surname at this school.',
        });
      }

      // Check linked children across matched parent(s)
      let verifiedParent: any = null;
      let hadAnyLinkedChild = false;
      for (const candidate of matchedParents) {
        let children: any[] = [];
        if (pool) {
          try {
            const cRes = await queryPg(
              `SELECT s.id, s.admission_number, s.first_name
               FROM parent_students ps
               JOIN students s ON s.id = ps.student_id
               WHERE ps.parent_id = $1 AND ps.school_id = $2
                 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)`,
              [candidate.id, school.id]
            );
            children = cRes.rows;
          } catch {}
        }
        if (children.length === 0) {
          children = cacheDb
            .prepare(
              `SELECT s.id, s.admission_number, s.first_name
               FROM parent_students ps
               JOIN students s ON s.id = ps.student_id
               WHERE ps.parent_id = ? AND ps.school_id = ?
                 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)`
            )
            .all(candidate.id, school.id) as any[];
        }
        if (children.length > 0) {
          hadAnyLinkedChild = true;
          const childMatched = children.some(
            (c) =>
              String(c.admission_number || '').trim().toLowerCase() === cleanChildIdent ||
              String(c.first_name || '').trim().toLowerCase() === cleanChildIdent
          );
          if (childMatched) {
            verifiedParent = candidate;
            break;
          }
        }
      }

      if (!verifiedParent) {
        if (!hadAnyLinkedChild) {
          return res.status(400).json({
            error: 'VERIFICATION_DATA_MISSING',
            message: 'Your guardian record has not been linked to any enrolled child yet. Please contact your School Administrator.',
          });
        }
        return res.status(401).json({
          error: 'VERIFICATION_FAILED',
          message: 'Your child details did not match our school records for this guardian profile.',
        });
      }

      if (verifiedParent.user_id) {
        return res.status(409).json({
          error: 'ALREADY_ACTIVATED',
          message: 'This parent portal account is already activated. Please use the Parent tab in Sign In (with your email or registered phone number).',
        });
      }

      const phoneToken = makeSafeSlugToken(
        normalizePhoneDigits(verifiedParent.phone) || verifiedParent.id.slice(-6),
        'parent'
      );
      const slugToken = makeSafeSlugToken(school.slug, 'school');
      boundEmail =
        cleanLoginEmail ||
        (verifiedParent.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(verifiedParent.email).trim())
          ? String(verifiedParent.email).trim().toLowerCase()
          : `${phoneToken}.${school.id.slice(-4)}@${slugToken}.parent.bursariq.local`);
      boundFullName = `${verifiedParent.first_name || ''} ${verifiedParent.last_name || ''}`.trim() || 'Parent';
      boundPhone = verifiedParent.phone || null;
      assignedRoleId = 'role_parent';
      entityType = 'PARENT';
      entityId = verifiedParent.id;
    }

    // Ensure chosen login email is not already claimed by a different user account
    let existingUser: any = null;
    if (pool) {
      try {
        existingUser = (
          await queryPg('SELECT id, is_platform_admin FROM users WHERE LOWER(email) = $1 LIMIT 1', [boundEmail])
        ).rows[0] || null;
      } catch {}
    }
    if (!existingUser) {
      existingUser = cacheDb
        .prepare('SELECT id, is_platform_admin FROM users WHERE LOWER(email) = ? LIMIT 1')
        .get(boundEmail) as any;
    }

    if (existingUser) {
      return res.status(409).json({
        error: 'EMAIL_IN_USE',
        message: 'That login email is already associated with an active account. Sign in with it directly or supply a different personal email.',
      });
    }

    // Create dedicated non-admin portal user, assign role_student/role_parent, and bind record
    boundUserId = 'usr_' + crypto.randomUUID().slice(0, 12);
    const salt = generateSalt();
    const passwordHash = hashPassword(String(password), salt);
    const urId = 'ur_' + crypto.randomUUID().slice(0, 12);

    if (pool) {
      await queryPg(
        `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [boundUserId, boundEmail, passwordHash, salt, boundFullName, boundPhone]
      );
      await queryPg(
        `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
         VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
        [urId, boundUserId, school.id, assignedRoleId]
      );
      if (entityType === 'STUDENT') {
        await queryPg('UPDATE students SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [
          boundUserId,
          entityId,
          school.id,
        ]);
      } else {
        await queryPg('UPDATE parents SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [
          boundUserId,
          entityId,
          school.id,
        ]);
      }
    }

    try {
      cacheDb
        .prepare(
          `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run(boundUserId, boundEmail, passwordHash, salt, boundFullName, boundPhone);
      cacheDb
        .prepare(
          `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
           VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, school_id, role_id) DO NOTHING`
        )
        .run(urId, boundUserId, school.id, assignedRoleId);
      if (entityType === 'STUDENT') {
        cacheDb
          .prepare('UPDATE students SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
          .run(boundUserId, entityId, school.id);
      } else {
        cacheDb
          .prepare('UPDATE parents SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
          .run(boundUserId, entityId, school.id);
      }
    } catch {}

    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    const token = await createSessionAsync(boundUserId, school.id, clientIp, req.headers['user-agent']);

    // Hydrate roles and school settings cleanly for AuthContext
    let roles: any[] = [];
    if (pool) {
      try {
        const rRes = await queryPg(
          `SELECT ur.*, r.name AS role_name, r.display_name AS role_display_name, r.scope AS role_scope,
                  s.name AS school_name, s.status AS school_status, s.slug AS school_slug
           FROM user_roles ur
           JOIN roles r ON ur.role_id = r.id
           LEFT JOIN schools s ON ur.school_id = s.id
           WHERE ur.user_id = $1`,
          [boundUserId]
        );
        roles = rRes.rows;
      } catch {}
    }
    if (roles.length === 0) {
      roles = cacheDb
        .prepare(
          `SELECT ur.*, r.name AS role_name, r.display_name AS role_display_name, r.scope AS role_scope,
                  s.name AS school_name, s.status AS school_status, s.slug AS school_slug
           FROM user_roles ur
           JOIN roles r ON ur.role_id = r.id
           LEFT JOIN schools s ON ur.school_id = s.id
           WHERE ur.user_id = ?`
        )
        .all(boundUserId) as any[];
    }

    let activeSettings: any = null;
    if (pool) {
      try {
        activeSettings =
          (await queryPg('SELECT * FROM school_settings WHERE school_id = $1 LIMIT 1', [school.id])).rows[0] || null;
      } catch {}
    }
    if (!activeSettings) {
      activeSettings =
        cacheDb.prepare('SELECT * FROM school_settings WHERE school_id = ? LIMIT 1').get(school.id) || null;
    }

    logAudit({
      actorId: boundUserId,
      actorEmail: boundEmail,
      schoolId: school.id,
      action: entityType === 'STUDENT' ? 'SELF_ACTIVATE_STUDENT_PORTAL' : 'SELF_ACTIVATE_PARENT_PORTAL',
      entity: entityType,
      entityId,
      ipAddress: clientIp,
      metadata: { schoolSlug: school.slug },
    });

    return res.status(201).json({
      success: true,
      message: `${entityType === 'STUDENT' ? 'Student' : 'Parent'} portal access activated.`,
      token,
      user: {
        id: boundUserId,
        email: boundEmail,
        full_name: boundFullName,
        phone: boundPhone,
        is_platform_admin: 0,
        is_active: 1,
      },
      roles,
      activeSchoolId: school.id,
      activeRole: roles[0] || null,
      activeSchool: school,
      activeSettings,
    });
  } catch (err: any) {
    console.error('[Public Portal Activate Error]', err);
    return res.status(500).json({
      error: 'ACTIVATION_FAILED',
      message: safeClientError(err, 'Failed to activate portal access. Please verify your details and try again.'),
    });
  }
});

// ==============================================================================
// 5. ADMISSION-NUMBER-ONLY LOGIN FOR READ-ONLY STUDENT & PARENT PORTALS
// POST /api/v1/public/portal/admission-login
// Allows verified enrolled students & parents to sign in with ONLY the
// school-generated Admission Number (no password/email needed).
// Security Guarantees:
// - Strictly limited to read-only STUDENT or PARENT portals.
// - Rejects SUPER_ADMIN, SCHOOL_OWNER, SCHOOL_ADMIN, BURSAR, or TEACHER accounts.
// - Enforces tenant isolation & admin account deactivation (is_active = 0).
// - Creates and persists child-scoped portal user/links in PG & SQLite cleanly.
// ==============================================================================
publicPortalRouter.post('/portal/admission-login', async (req, res) => {
  if (!enforcePublicRateLimit(req, res)) return;

  try {
    const {
      admission_number,
      portal_type = 'STUDENT',
      school_id,
      school_slug,
    } = req.body || {};

    const cleanAdm = String(admission_number || '').trim();
    const portalType = String(portal_type || 'STUDENT').toUpperCase();

    if (!cleanAdm) {
      return res.status(400).json({
        error: 'MISSING_ADMISSION_NUMBER',
        message: 'Please enter the student admission number generated by your school.',
      });
    }

    if (!['STUDENT', 'PARENT'].includes(portalType)) {
      return res.status(400).json({
        error: 'INVALID_PORTAL_TYPE',
        message: 'Admission-number login is only allowed for Student and Parent portals.',
      });
    }

    const pool = getPgPool();
    const schoolFilterInput = String(school_slug || school_id || '').trim();
    let scopedSchool: any = null;
    if (schoolFilterInput) {
      scopedSchool = await findActiveSchoolBySlugOrId(schoolFilterInput);
      if (!scopedSchool || ['CANCELLED', 'SUSPENDED'].includes(String(scopedSchool.status || '').toUpperCase())) {
        return res.status(404).json({
          error: 'SCHOOL_NOT_FOUND',
          message: 'Selected school portal was not found or is inactive.',
        });
      }
    }

    // 1. Find matching non-deleted student(s) across authoritative PG (or SQLite fallback)
    let matchedRows: any[] = [];
    if (pool) {
      try {
        const sql = scopedSchool
          ? `SELECT s.*, sc.name AS school_name, sc.slug AS school_slug, sc.type AS school_type, sc.status AS school_status,
                    sc.state AS school_state, sc.lga AS school_lga, sc.address AS school_address,
                    sc.phone AS school_phone, sc.email AS school_email, sc.website AS school_website, sc.logo_url AS school_logo_url
             FROM students s
             JOIN schools sc ON s.school_id = sc.id
             WHERE s.school_id = $1
               AND LOWER(TRIM(s.admission_number)) = LOWER($2)
               AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
               AND (sc.is_deleted = 0 OR sc.is_deleted IS NULL)
               AND UPPER(COALESCE(sc.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
             LIMIT 10`
          : `SELECT s.*, sc.name AS school_name, sc.slug AS school_slug, sc.type AS school_type, sc.status AS school_status,
                    sc.state AS school_state, sc.lga AS school_lga, sc.address AS school_address,
                    sc.phone AS school_phone, sc.email AS school_email, sc.website AS school_website, sc.logo_url AS school_logo_url
             FROM students s
             JOIN schools sc ON s.school_id = sc.id
             WHERE LOWER(TRIM(s.admission_number)) = LOWER($1)
               AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
               AND (sc.is_deleted = 0 OR sc.is_deleted IS NULL)
               AND UPPER(COALESCE(sc.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
             LIMIT 10`;
        const pgRes = await queryPg(sql, scopedSchool ? [scopedSchool.id, cleanAdm] : [cleanAdm]);
        matchedRows = pgRes.rows;
      } catch (err: any) {
        console.warn('[Admission Login PG Query Notice]', err?.message);
      }
    }

    if (matchedRows.length === 0) {
      const sqSql = scopedSchool
        ? `SELECT s.*, sc.name AS school_name, sc.slug AS school_slug, sc.type AS school_type, sc.status AS school_status,
                  sc.state AS school_state, sc.lga AS school_lga, sc.address AS school_address,
                  sc.phone AS school_phone, sc.email AS school_email, sc.website AS school_website, sc.logo_url AS school_logo_url
           FROM students s
           JOIN schools sc ON s.school_id = sc.id
           WHERE s.school_id = ?
             AND LOWER(TRIM(s.admission_number)) = LOWER(?)
             AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
             AND UPPER(COALESCE(sc.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
           LIMIT 10`
        : `SELECT s.*, sc.name AS school_name, sc.slug AS school_slug, sc.type AS school_type, sc.status AS school_status,
                  sc.state AS school_state, sc.lga AS school_lga, sc.address AS school_address,
                  sc.phone AS school_phone, sc.email AS school_email, sc.website AS school_website, sc.logo_url AS school_logo_url
           FROM students s
           JOIN schools sc ON s.school_id = sc.id
           WHERE LOWER(TRIM(s.admission_number)) = LOWER(?)
             AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
             AND UPPER(COALESCE(sc.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
           LIMIT 10`;
      matchedRows = cacheDb.prepare(sqSql).all(...(scopedSchool ? [scopedSchool.id, cleanAdm] : [cleanAdm])) as any[];
    }

    if (matchedRows.length === 0) {
      return res.status(401).json({
        error: 'ADMISSION_NUMBER_NOT_FOUND',
        message: scopedSchool
          ? `No student with admission number "${cleanAdm}" was found at ${scopedSchool.name}.`
          : `No active student record matched admission number "${cleanAdm}". Check the number with your school administrator.`,
      });
    }

    // Deduplicate by school_id and check cross-school ambiguity if school wasn't explicitly picked
    const distinctSchoolsMap = new Map<string, any>();
    for (const r of matchedRows) {
      if (!distinctSchoolsMap.has(r.school_id)) {
        distinctSchoolsMap.set(r.school_id, r);
      }
    }

    if (distinctSchoolsMap.size > 1 && !scopedSchool) {
      return res.status(409).json({
        error: 'AMBIGUOUS_ADMISSION_NUMBER',
        message: 'Multiple schools share this admission number. Please tap your school below to sign in.',
        schools: Array.from(distinctSchoolsMap.values()).map((r) => ({
          id: r.school_id,
          name: r.school_name,
          slug: r.school_slug,
          type: r.school_type,
          status: r.school_status,
          state: r.school_state,
          lga: r.school_lga,
        })),
      });
    }

    const stu = matchedRows[0];
    const targetSchoolId = String(stu.school_id);
    const school = scopedSchool || {
      id: targetSchoolId,
      name: stu.school_name,
      slug: stu.school_slug,
      type: stu.school_type,
      status: stu.school_status,
      state: stu.school_state,
      lga: stu.school_lga,
      address: stu.school_address,
      phone: stu.school_phone,
      email: stu.school_email,
      website: stu.school_website,
      logo_url: stu.school_logo_url,
    };

    const stStatus = String(stu.student_status || 'ACTIVE').toUpperCase();
    if (stStatus === 'SUSPENDED' || stStatus === 'WITHDRAWN') {
      return res.status(403).json({
        error: 'STUDENT_PORTAL_SUSPENDED',
        message: `Portal access is currently unavailable because this student record is marked ${stStatus}. Contact your school administrator.`,
      });
    }

    // Ensure school row exists in SQLite cache so FK inserts into user_roles/sessions succeed
    try {
      cacheDb
        .prepare(
          `INSERT INTO schools (id, name, slug, type, status, state, lga, address, phone, email, website, logo_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             slug = excluded.slug,
             status = excluded.status`
        )
        .run(
          school.id,
          school.name || 'School',
          school.slug || targetSchoolId,
          school.type || 'Secondary',
          school.status || 'TRIAL',
          school.state || '',
          school.lga || '',
          school.address || null,
          school.phone || null,
          school.email || null,
          school.website || null,
          school.logo_url || null
        );
    } catch {}

    const STAFF_OR_ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR', 'TEACHER'];
    const targetRoleId = portalType === 'PARENT' ? 'role_parent' : 'role_student';
    const targetRoleName = portalType === 'PARENT' ? 'PARENT' : 'STUDENT';
    const admToken = makeSafeSlugToken(stu.admission_number, stu.id);
    const schoolSlugToken = makeSafeSlugToken(school.slug, targetSchoolId.slice(-6));

    // Helper: inspect existing user safely across PG & SQLite and block staff escalation or deactivated users
    async function resolveVerifiedReadOnlyUser(userId: string): Promise<{ user: any; blocked?: { status: number; error: string; message: string } }> {
      let u: any = null;
      let uRoles: any[] = [];
      if (pool) {
        try {
          u = (await queryPg('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId])).rows[0] || null;
          if (u) {
            uRoles = (
              await queryPg(
                `SELECT ur.*, r.name AS role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
                [userId]
              )
            ).rows;
          }
        } catch {}
      }
      if (!u) {
        u = cacheDb.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(userId) as any;
        if (u) {
          uRoles = cacheDb
            .prepare(`SELECT ur.*, r.name AS role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?`)
            .all(userId) as any[];
        }
      }
      if (!u) return { user: null };
      if (Number(u.is_platform_admin) === 1 || uRoles.some((r) => STAFF_OR_ADMIN_ROLES.includes(String(r.role_name || '').toUpperCase()))) {
        return {
          user: u,
          blocked: {
            status: 403,
            error: 'STAFF_PASSWORD_REQUIRED',
            message: 'Admission-number login is strictly for read-only Student and Parent portals. Staff and Administrators must sign in under "Staff / Email" with a password.',
          },
        };
      }
      if (Number(u.is_active) === 0) {
        return {
          user: u,
          blocked: {
            status: 403,
            error: 'ACCOUNT_DEACTIVATED',
            message: 'This portal account has been deactivated by the school administrator.',
          },
        };
      }
      return { user: u };
    }

    async function ensureReadOnlyUser(opts: {
      fullName: string;
      phone: string | null;
      emailHint: string;
      roleId: string;
    }) {
      const userId = 'usr_' + crypto.randomUUID().slice(0, 12);
      const salt = generateSalt();
      const randomSecret = crypto.randomBytes(24).toString('hex');
      const passwordHash = hashPassword(randomSecret, salt);
      const urId = 'ur_' + crypto.randomUUID().slice(0, 12);
      const email = opts.emailHint;

      if (pool) {
        await queryPg(
          `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, email, passwordHash, salt, opts.fullName, opts.phone]
        );
        await queryPg(
          `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
           VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
          [urId, userId, targetSchoolId, opts.roleId]
        );
      }

      cacheDb
        .prepare(
          `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, phone = excluded.phone, is_active = excluded.is_active`
        )
        .run(userId, email, passwordHash, salt, opts.fullName, opts.phone);
      cacheDb
        .prepare(
          `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
           VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, school_id, role_id) DO NOTHING`
        )
        .run(urId, userId, targetSchoolId, opts.roleId);

      return {
        id: userId,
        email,
        full_name: opts.fullName,
        phone: opts.phone,
        is_platform_admin: 0,
        is_active: 1,
      };
    }

    let portalUser: any = null;

    function extractPhoneHint(stuRow: any): string | null {
      if (stuRow.phone && String(stuRow.phone).trim()) return String(stuRow.phone).trim();
      if (stuRow.emergency_contact) {
        const m = String(stuRow.emergency_contact).match(/(?:\+?234|0)?[789][01]\d{8}|\d{7,14}/);
        if (m) return m[0];
      }
      return null;
    }

    if (portalType === 'STUDENT') {
      if (stu.user_id) {
        const resolved = await resolveVerifiedReadOnlyUser(stu.user_id);
        if (resolved.blocked) {
          return res.status(resolved.blocked.status).json({
            error: resolved.blocked.error,
            message: resolved.blocked.message,
          });
        }
        portalUser = resolved.user;
      }

      if (!portalUser) {
        const studentName = buildStudentFullName(stu);
        const generatedEmail = `${admToken}.${crypto.randomBytes(2).toString('hex')}@${schoolSlugToken}.student.bursariq.local`;
        portalUser = await ensureReadOnlyUser({
          fullName: studentName,
          phone: extractPhoneHint(stu),
          emailHint: generatedEmail,
          roleId: 'role_student',
        });

        if (pool) {
          await queryPg(
            'UPDATE students SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3',
            [portalUser.id, stu.id, targetSchoolId]
          );
        }
        cacheDb
          .prepare('UPDATE students SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
          .run(portalUser.id, stu.id, targetSchoolId);
      }
    } else {
      // PARENT Portal login using child's Admission Number
      let linkedParent: any = null;
      if (pool) {
        try {
          linkedParent =
            (
              await queryPg(
                `SELECT p.* FROM parent_students ps
                 JOIN parents p ON ps.parent_id = p.id
                 WHERE ps.student_id = $1 AND p.school_id = $2 AND ps.school_id = $2
                   AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
                 ORDER BY ps.is_primary_contact DESC, p.created_at ASC
                 LIMIT 1`,
                [stu.id, targetSchoolId]
              )
            ).rows[0] || null;
        } catch {}
      }
      if (!linkedParent) {
        linkedParent = cacheDb
          .prepare(
            `SELECT p.* FROM parent_students ps
             JOIN parents p ON ps.parent_id = p.id
             WHERE ps.student_id = ? AND p.school_id = ? AND ps.school_id = ?
               AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
             ORDER BY ps.is_primary_contact DESC, p.created_at ASC
             LIMIT 1`
          )
          .get(stu.id, targetSchoolId, targetSchoolId) as any;
      }

      if (linkedParent?.user_id) {
        const resolved = await resolveVerifiedReadOnlyUser(linkedParent.user_id);
        if (resolved.blocked) {
          return res.status(resolved.blocked.status).json({
            error: resolved.blocked.error,
            message: resolved.blocked.message,
          });
        }
        portalUser = resolved.user;
      }

      if (!portalUser && linkedParent) {
        const parentName = `${linkedParent.first_name || ''} ${linkedParent.last_name || ''}`.trim() || `Parent of ${buildStudentFullName(stu)}`;
        const generatedEmail = `parent.${admToken}.${crypto.randomBytes(2).toString('hex')}@${schoolSlugToken}.parent.bursariq.local`;
        portalUser = await ensureReadOnlyUser({
          fullName: parentName,
          phone: linkedParent.phone || extractPhoneHint(stu),
          emailHint: generatedEmail,
          roleId: 'role_parent',
        });

        if (pool) {
          await queryPg(
            'UPDATE parents SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3',
            [portalUser.id, linkedParent.id, targetSchoolId]
          );
        }
        cacheDb
          .prepare('UPDATE parents SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
          .run(portalUser.id, linkedParent.id, targetSchoolId);
      }

      if (!portalUser && !linkedParent) {
        // Student was enrolled/imported without a separate parent row yet:
        // Create a child-scoped guardian record + link strictly to THIS student only.
        const studentName = buildStudentFullName(stu);
        const parentId = 'par_' + crypto.randomUUID().slice(0, 12);
        const linkId = 'ps_' + crypto.randomUUID().slice(0, 12);
        const guardianFirst = 'Parent / Guardian';
        const guardianLast = `of ${studentName}`;
        const guardianFull = `${guardianFirst} ${guardianLast}`.trim();
        const phoneHint = extractPhoneHint(stu);
        const generatedEmail = `parent.${admToken}.${crypto.randomBytes(2).toString('hex')}@${schoolSlugToken}.parent.bursariq.local`;

        portalUser = await ensureReadOnlyUser({
          fullName: guardianFull,
          phone: phoneHint,
          emailHint: generatedEmail,
          roleId: 'role_parent',
        });

        if (pool) {
          await queryPg(
            `INSERT INTO parents (id, school_id, user_id, first_name, last_name, phone, email, relationship, is_deleted, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, 'Guardian', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [parentId, targetSchoolId, portalUser.id, guardianFirst, guardianLast, phoneHint]
          );
          await queryPg(
            `INSERT INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact, verified_at)
             VALUES ($1, $2, $3, $4, 'Guardian', 1, CURRENT_TIMESTAMP)`,
            [linkId, targetSchoolId, parentId, stu.id]
          );
        }

        try {
          cacheDb
            .prepare(
              `INSERT INTO parents (id, school_id, user_id, first_name, last_name, phone, email, relationship, is_deleted, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL, 'Guardian', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            )
            .run(parentId, targetSchoolId, portalUser.id, guardianFirst, guardianLast, phoneHint);
          cacheDb
            .prepare(
              `INSERT INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact, verified_at)
               VALUES (?, ?, ?, ?, 'Guardian', 1, CURRENT_TIMESTAMP)`
            )
            .run(linkId, targetSchoolId, parentId, stu.id);
        } catch {}
      }
    }

    // Ensure role assignment exists cleanly for targetSchoolId & sync PG user/roles into cacheDb for fallback parity
    if (pool) {
      try {
        const urIdCheck = 'ur_' + crypto.randomUUID().slice(0, 12);
        await queryPg(
          `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
           VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
          [urIdCheck, portalUser.id, targetSchoolId, targetRoleId]
        );
      } catch {}
    }
    try {
      cacheDb
        .prepare(
          `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, phone = excluded.phone, is_active = excluded.is_active`
        )
        .run(
          portalUser.id,
          portalUser.email,
          portalUser.password_hash || 'locked',
          portalUser.salt || 'locked',
          portalUser.full_name,
          portalUser.phone || null
        );
      cacheDb
        .prepare(
          `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
           VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, school_id, role_id) DO NOTHING`
        )
        .run('ur_' + crypto.randomUUID().slice(0, 12), portalUser.id, targetSchoolId, targetRoleId);
    } catch {}

    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    const token = await createSessionAsync(portalUser.id, targetSchoolId, clientIp, req.headers['user-agent']);

    let roles: any[] = [];
    if (pool) {
      try {
        roles = (
          await queryPg(
            `SELECT ur.*, r.name AS role_name, r.display_name AS role_display_name, r.scope AS role_scope,
                    s.name AS school_name, s.status AS school_status, s.slug AS school_slug
             FROM user_roles ur
             JOIN roles r ON ur.role_id = r.id
             LEFT JOIN schools s ON ur.school_id = s.id
             WHERE ur.user_id = $1`,
            [portalUser.id]
          )
        ).rows;
      } catch {}
    }
    if (roles.length === 0) {
      roles = cacheDb
        .prepare(
          `SELECT ur.*, r.name AS role_name, r.display_name AS role_display_name, r.scope AS role_scope,
                  s.name AS school_name, s.status AS school_status, s.slug AS school_slug
           FROM user_roles ur
           JOIN roles r ON ur.role_id = r.id
           LEFT JOIN schools s ON ur.school_id = s.id
           WHERE ur.user_id = ?`
        )
        .all(portalUser.id) as any[];
    }

    const activeRole =
      roles.find((r) => r.school_id === targetSchoolId && r.role_name === targetRoleName) ||
      roles.find((r) => r.school_id === targetSchoolId) ||
      roles[0] ||
      null;

    let activeSettings: any = null;
    if (pool) {
      try {
        activeSettings =
          (await queryPg('SELECT * FROM school_settings WHERE school_id = $1 LIMIT 1', [targetSchoolId])).rows[0] || null;
      } catch {}
    }
    if (!activeSettings) {
      activeSettings = cacheDb.prepare('SELECT * FROM school_settings WHERE school_id = ? LIMIT 1').get(targetSchoolId) || null;
    }

    logAudit({
      actorId: portalUser.id,
      actorEmail: portalUser.email,
      schoolId: targetSchoolId,
      action: portalType === 'PARENT' ? 'ADMISSION_LOGIN_PARENT_PORTAL' : 'ADMISSION_LOGIN_STUDENT_PORTAL',
      entity: portalType,
      entityId: stu.id,
      ipAddress: clientIp,
      metadata: { admissionNumber: stu.admission_number, schoolSlug: school.slug },
    });

    return res.json({
      success: true,
      token,
      user: {
        id: portalUser.id,
        email: portalUser.email,
        full_name: portalUser.full_name,
        phone: portalUser.phone,
        is_platform_admin: 0,
        is_active: 1,
      },
      roles,
      activeSchoolId: targetSchoolId,
      activeRole,
      activeSchool: school,
      activeSettings,
    });
  } catch (err: any) {
    console.error('[Admission Portal Login Error]', err);
    return res.status(500).json({
      error: 'ADMISSION_LOGIN_FAILED',
      message: safeClientError(err, 'Unable to sign in with that admission number. Please try again.'),
    });
  }
});

/**
 * POST /api/v1/public/portal/staff-code-login
 * Passwordless unique Staff Code login strictly for Staff Workspace roles (TEACHER & STAFF).
 * Strictly enforces role separation:
 *   - NEVER allows signing into SUPER_ADMIN, SCHOOL_OWNER, SCHOOL_ADMIN, BURSAR, PARENT, or STUDENT accounts.
 *   - School Admins / Owners / Bursars must sign in via the Admin tab with Email + Password.
 */
publicPortalRouter.post('/portal/staff-code-login', async (req, res) => {
  if (!enforcePublicRateLimit(req, res)) return;

  try {
    const { staff_code, school_id, school_slug } = req.body || {};
    const cleanCode = String(staff_code || '').trim();

    if (!cleanCode) {
      return res.status(400).json({
        error: 'MISSING_STAFF_CODE',
        message: 'Please enter the unique Staff Login Code issued by your school administrator.',
      });
    }

    const pool = getPgPool();
    const schoolFilterInput = String(school_slug || school_id || '').trim();
    let scopedSchool: any = null;
    if (schoolFilterInput) {
      scopedSchool = await findActiveSchoolBySlugOrId(schoolFilterInput);
      if (!scopedSchool || ['CANCELLED', 'SUSPENDED'].includes(String(scopedSchool.status || '').toUpperCase())) {
        return res.status(404).json({
          error: 'SCHOOL_NOT_FOUND',
          message: 'Selected school portal was not found or is inactive.',
        });
      }
    }

    let matchedRows: any[] = [];
    if (pool) {
      try {
        const sql = scopedSchool
          ? `SELECT st.*, sc.name AS school_name, sc.slug AS school_slug, sc.type AS school_type, sc.status AS school_status,
                    sc.state AS school_state, sc.lga AS school_lga, sc.address AS school_address,
                    sc.phone AS school_phone, sc.email AS school_email, sc.website AS school_website, sc.logo_url AS school_logo_url
             FROM staff st
             JOIN schools sc ON st.school_id = sc.id
             WHERE st.school_id = $1
               AND LOWER(TRIM(st.staff_number)) = LOWER($2)
               AND (st.is_deleted = 0 OR st.is_deleted IS NULL)
               AND (sc.is_deleted = 0 OR sc.is_deleted IS NULL)
               AND UPPER(COALESCE(sc.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
             LIMIT 10`
          : `SELECT st.*, sc.name AS school_name, sc.slug AS school_slug, sc.type AS school_type, sc.status AS school_status,
                    sc.state AS school_state, sc.lga AS school_lga, sc.address AS school_address,
                    sc.phone AS school_phone, sc.email AS school_email, sc.website AS school_website, sc.logo_url AS school_logo_url
             FROM staff st
             JOIN schools sc ON st.school_id = sc.id
             WHERE LOWER(TRIM(st.staff_number)) = LOWER($1)
               AND (st.is_deleted = 0 OR st.is_deleted IS NULL)
               AND (sc.is_deleted = 0 OR sc.is_deleted IS NULL)
               AND UPPER(COALESCE(sc.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
             LIMIT 10`;
        const pgRes = await queryPg(sql, scopedSchool ? [scopedSchool.id, cleanCode] : [cleanCode]);
        matchedRows = pgRes.rows;
      } catch (err: any) {
        console.warn('[Staff Code Login PG Query Notice]', err?.message);
      }
    }

    if (matchedRows.length === 0) {
      const sqSql = scopedSchool
        ? `SELECT st.*, sc.name AS school_name, sc.slug AS school_slug, sc.type AS school_type, sc.status AS school_status,
                  sc.state AS school_state, sc.lga AS school_lga, sc.address AS school_address,
                  sc.phone AS school_phone, sc.email AS school_email, sc.website AS school_website, sc.logo_url AS school_logo_url
           FROM staff st
           JOIN schools sc ON st.school_id = sc.id
           WHERE st.school_id = ?
             AND LOWER(TRIM(st.staff_number)) = LOWER(?)
             AND (st.is_deleted = 0 OR st.is_deleted IS NULL)
             AND UPPER(COALESCE(sc.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
           LIMIT 10`
        : `SELECT st.*, sc.name AS school_name, sc.slug AS school_slug, sc.type AS school_type, sc.status AS school_status,
                  sc.state AS school_state, sc.lga AS school_lga, sc.address AS school_address,
                  sc.phone AS school_phone, sc.email AS school_email, sc.website AS school_website, sc.logo_url AS school_logo_url
           FROM staff st
           JOIN schools sc ON st.school_id = sc.id
           WHERE LOWER(TRIM(st.staff_number)) = LOWER(?)
             AND (st.is_deleted = 0 OR st.is_deleted IS NULL)
             AND UPPER(COALESCE(sc.status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
           LIMIT 10`;
      matchedRows = cacheDb.prepare(sqSql).all(...(scopedSchool ? [scopedSchool.id, cleanCode] : [cleanCode])) as any[];
    }

    if (matchedRows.length === 0) {
      return res.status(401).json({
        error: 'STAFF_CODE_NOT_FOUND',
        message: scopedSchool
          ? `No active staff member with code "${cleanCode}" was found at ${scopedSchool.name}.`
          : `No active staff record matched Staff Code "${cleanCode}". Verify your code with your school administrator.`,
      });
    }

    const distinctSchoolsMap = new Map<string, any>();
    for (const r of matchedRows) {
      if (!distinctSchoolsMap.has(r.school_id)) {
        distinctSchoolsMap.set(r.school_id, r);
      }
    }

    if (distinctSchoolsMap.size > 1 && !scopedSchool) {
      return res.status(409).json({
        error: 'AMBIGUOUS_STAFF_CODE',
        message: 'Multiple schools share this staff code. Please select your school below to sign in.',
        schools: Array.from(distinctSchoolsMap.values()).map((r) => ({
          id: r.school_id,
          name: r.school_name,
          slug: r.school_slug,
          type: r.school_type,
          status: r.school_status,
          state: r.school_state,
          lga: r.school_lga,
        })),
      });
    }

    const st = matchedRows[0];
    const targetSchoolId = String(st.school_id);
    const school = scopedSchool || {
      id: targetSchoolId,
      name: st.school_name,
      slug: st.school_slug,
      type: st.school_type,
      status: st.school_status,
      state: st.school_state,
      lga: st.school_lga,
      address: st.school_address,
      phone: st.school_phone,
      email: st.email || st.school_email,
      website: st.school_website,
      logo_url: st.school_logo_url,
    };

    const empStatus = String(st.employment_status || 'ACTIVE').toUpperCase();
    if (empStatus !== 'ACTIVE') {
      return res.status(403).json({
        error: 'STAFF_PORTAL_SUSPENDED',
        message: `Staff portal access is unavailable because this staff record is marked ${empStatus}. Contact your school administrator.`,
      });
    }

    try {
      cacheDb
        .prepare(
          `INSERT INTO schools (id, name, slug, type, status, state, lga, address, phone, email, website, logo_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, status = excluded.status`
        )
        .run(
          school.id,
          school.name || 'School',
          school.slug || targetSchoolId,
          school.type || 'Secondary',
          school.status || 'TRIAL',
          school.state || '',
          school.lga || '',
          school.address || null,
          school.phone || null,
          st.school_email || null,
          school.website || null,
          school.logo_url || null
        );
    } catch {}

    const ADMIN_OR_NON_STAFF_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR', 'PARENT', 'STUDENT'];
    const ALLOWED_STAFF_ROLES = ['TEACHER', 'STAFF'];

    async function inspectCandidateUser(userId: string): Promise<{
      user: any;
      roles: any[];
      blocked?: { status: number; error: string; message: string };
    }> {
      let u: any = null;
      let uRoles: any[] = [];
      if (pool) {
        try {
          u = (await queryPg('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId])).rows[0] || null;
          if (u) {
            uRoles = (
              await queryPg(
                `SELECT ur.*, r.name AS role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
                [userId]
              )
            ).rows;
          }
        } catch {}
      }
      if (!u) {
        u = cacheDb.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(userId) as any;
        if (u) {
          uRoles = cacheDb
            .prepare(`SELECT ur.*, r.name AS role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?`)
            .all(userId) as any[];
        }
      }
      if (!u) return { user: null, roles: [] };
      const schoolScopedRoles = uRoles.filter((r) => String(r.school_id || '') === targetSchoolId);
      const hasDisallowedRole =
        Number(u.is_platform_admin) === 1 ||
        schoolScopedRoles.some((r) => ADMIN_OR_NON_STAFF_ROLES.includes(String(r.role_name || '').toUpperCase())) ||
        uRoles.some((r) => ['SUPER_ADMIN'].includes(String(r.role_name || '').toUpperCase()));

      if (hasDisallowedRole) {
        return {
          user: u,
          roles: uRoles,
          blocked: {
            status: 403,
            error: 'ADMIN_PASSWORD_REQUIRED',
            message:
              'Staff Login Codes are strictly for Teaching & Non-Teaching Staff portals. School Administrators, Owners, and Bursars must sign in under the Admin tab with Email and Password.',
          },
        };
      }
      if (Number(u.is_active) === 0) {
        return {
          user: u,
          roles: uRoles,
          blocked: {
            status: 403,
            error: 'ACCOUNT_DEACTIVATED',
            message: 'This staff portal account has been deactivated by your school administrator.',
          },
        };
      }
      return { user: u, roles: uRoles };
    }

    let portalUser: any = null;
    let targetRoleName: 'TEACHER' | 'STAFF' = 'TEACHER';

    if (st.user_id) {
      const checked = await inspectCandidateUser(st.user_id);
      if (checked.blocked) {
        return res.status(checked.blocked.status).json({ error: checked.blocked.error, message: checked.blocked.message });
      }
      if (checked.user) {
        portalUser = checked.user;
        const staffRoleMatch = checked.roles.find(
          (r) => String(r.school_id || '') === targetSchoolId && ALLOWED_STAFF_ROLES.includes(String(r.role_name || '').toUpperCase())
        );
        if (staffRoleMatch?.role_name === 'STAFF') targetRoleName = 'STAFF';
      }
    }

    // Fallback: match existing active user by staff email within this school
    if (!portalUser && st.email && String(st.email).trim()) {
      const cleanStaffEmail = String(st.email).trim().toLowerCase();
      let candidateByEmail: any = null;
      if (pool) {
        try {
          candidateByEmail = (await queryPg('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [cleanStaffEmail])).rows[0] || null;
        } catch {}
      }
      if (!candidateByEmail) {
        candidateByEmail = cacheDb.prepare('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1').get(cleanStaffEmail) as any;
      }
      if (candidateByEmail) {
        const checked = await inspectCandidateUser(candidateByEmail.id);
        if (checked.blocked) {
          return res.status(checked.blocked.status).json({ error: checked.blocked.error, message: checked.blocked.message });
        }
        if (checked.user) {
          portalUser = checked.user;
          const staffRoleMatch = checked.roles.find(
            (r) => String(r.school_id || '') === targetSchoolId && ALLOWED_STAFF_ROLES.includes(String(r.role_name || '').toUpperCase())
          );
          if (staffRoleMatch?.role_name === 'STAFF') targetRoleName = 'STAFF';
          if (pool) {
            await queryPg('UPDATE staff SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [
              portalUser.id,
              st.id,
              targetSchoolId,
            ]);
          }
          try {
            cacheDb
              .prepare('UPDATE staff SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
              .run(portalUser.id, st.id, targetSchoolId);
          } catch {}
        }
      }
    }

    // If staff record exists without a portal user yet, auto-bind a strict TEACHER portal user
    if (!portalUser) {
      const codeToken = makeSafeSlugToken(st.staff_number, st.id);
      const schoolSlugToken = makeSafeSlugToken(school.slug, targetSchoolId.slice(-6));
      const fullName = [st.first_name, st.middle_name, st.last_name].filter(Boolean).join(' ').trim() || 'Staff Member';
      const userEmail =
        st.email && String(st.email).trim()
          ? String(st.email).trim().toLowerCase()
          : `staff.${codeToken}.${crypto.randomBytes(2).toString('hex')}@${schoolSlugToken}.staff.bursariq.local`;

      const jobLower = String(st.job_title || '').toLowerCase();
      targetRoleName =
        jobLower.includes('teacher') || jobLower.includes('educator') || jobLower.includes('lecturer') || !jobLower
          ? 'TEACHER'
          : 'STAFF';
      const targetRoleId = targetRoleName === 'STAFF' ? 'role_staff' : 'role_teacher';

      const newUserId = 'usr_' + crypto.randomUUID().slice(0, 12);
      const salt = generateSalt();
      const passwordHash = hashPassword(crypto.randomBytes(24).toString('hex'), salt);

      if (pool) {
        await queryPg(
          `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [newUserId, userEmail, passwordHash, salt, fullName, st.phone || null]
        );
        await queryPg(
          `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
           VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
          ['ur_' + crypto.randomUUID().slice(0, 12), newUserId, targetSchoolId, targetRoleId]
        );
        await queryPg('UPDATE staff SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3', [
          newUserId,
          st.id,
          targetSchoolId,
        ]);
      }

      try {
        cacheDb
          .prepare(
            `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name`
          )
          .run(newUserId, userEmail, passwordHash, salt, fullName, st.phone || null);
        cacheDb
          .prepare(
            `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
             VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, school_id, role_id) DO NOTHING`
          )
          .run('ur_' + crypto.randomUUID().slice(0, 12), newUserId, targetSchoolId, targetRoleId);
        cacheDb
          .prepare('UPDATE staff SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
          .run(newUserId, st.id, targetSchoolId);
      } catch {}

      portalUser = {
        id: newUserId,
        email: userEmail,
        password_hash: passwordHash,
        salt,
        full_name: fullName,
        phone: st.phone || null,
        is_platform_admin: 0,
        is_active: 1,
      };
    } else {
      const targetRoleId = targetRoleName === 'STAFF' ? 'role_staff' : 'role_teacher';
      if (pool) {
        try {
          await queryPg(
            `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
             VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
            ['ur_' + crypto.randomUUID().slice(0, 12), portalUser.id, targetSchoolId, targetRoleId]
          );
        } catch {}
      }
      try {
        cacheDb
          .prepare(
            `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, phone = excluded.phone, is_active = excluded.is_active`
          )
          .run(
            portalUser.id,
            portalUser.email,
            portalUser.password_hash || 'locked',
            portalUser.salt || 'locked',
            portalUser.full_name,
            portalUser.phone || null
          );
        cacheDb
          .prepare(
            `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary, created_at)
             VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, school_id, role_id) DO NOTHING`
          )
          .run('ur_' + crypto.randomUUID().slice(0, 12), portalUser.id, targetSchoolId, targetRoleId);
      } catch {}
    }

    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
    const token = await createSessionAsync(portalUser.id, targetSchoolId, clientIp, req.headers['user-agent']);

    let roles: any[] = [];
    if (pool) {
      try {
        roles = (
          await queryPg(
            `SELECT ur.*, r.name AS role_name, r.display_name AS role_display_name, r.scope AS role_scope,
                    s.name AS school_name, s.status AS school_status, s.slug AS school_slug
             FROM user_roles ur
             JOIN roles r ON ur.role_id = r.id
             LEFT JOIN schools s ON ur.school_id = s.id
             WHERE ur.user_id = $1`,
            [portalUser.id]
          )
        ).rows;
      } catch {}
    }
    if (roles.length === 0) {
      roles = cacheDb
        .prepare(
          `SELECT ur.*, r.name AS role_name, r.display_name AS role_display_name, r.scope AS role_scope,
                  s.name AS school_name, s.status AS school_status, s.slug AS school_slug
           FROM user_roles ur
           JOIN roles r ON ur.role_id = r.id
           LEFT JOIN schools s ON ur.school_id = s.id
           WHERE ur.user_id = ?`
        )
        .all(portalUser.id) as any[];
    }

    const activeRole =
      roles.find((r) => r.school_id === targetSchoolId && ALLOWED_STAFF_ROLES.includes(String(r.role_name || '').toUpperCase())) ||
      roles.find((r) => r.school_id === targetSchoolId) ||
      roles[0] ||
      null;

    let activeSettings: any = null;
    if (pool) {
      try {
        activeSettings =
          (await queryPg('SELECT * FROM school_settings WHERE school_id = $1 LIMIT 1', [targetSchoolId])).rows[0] || null;
      } catch {}
    }
    if (!activeSettings) {
      activeSettings = cacheDb.prepare('SELECT * FROM school_settings WHERE school_id = ? LIMIT 1').get(targetSchoolId) || null;
    }

    logAudit({
      actorId: portalUser.id,
      actorEmail: portalUser.email,
      schoolId: targetSchoolId,
      action: 'STAFF_CODE_LOGIN',
      entity: 'STAFF',
      entityId: st.id,
      ipAddress: clientIp,
      metadata: { staffCode: st.staff_number, schoolSlug: school.slug, roleName: activeRole?.role_name || targetRoleName },
    });

    return res.json({
      success: true,
      token,
      user: {
        id: portalUser.id,
        email: portalUser.email,
        full_name: portalUser.full_name,
        phone: portalUser.phone,
        is_platform_admin: 0,
        is_active: 1,
      },
      roles,
      activeSchoolId: targetSchoolId,
      activeRole,
      activeSchool: {
        id: school.id,
        name: school.name,
        slug: school.slug,
        type: school.type,
        status: school.status,
        state: school.state,
        lga: school.lga,
        address: school.address,
        phone: school.phone,
        email: st.school_email || school.email,
        website: school.website,
        logo_url: school.logo_url,
      },
      activeSettings,
      staffProfile: {
        id: st.id,
        staff_number: st.staff_number,
        job_title: st.job_title,
        department: st.department,
      },
    });
  } catch (err: any) {
    console.error('[Staff Code Login Error]', err);
    return res.status(500).json({
      error: 'STAFF_LOGIN_FAILED',
      message: safeClientError(err, 'Unable to sign in with that Staff Login Code. Please try again.'),
    });
  }
});
