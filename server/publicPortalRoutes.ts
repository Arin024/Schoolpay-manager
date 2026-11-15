import express from 'express';
import crypto from 'node:crypto';
import {
  cacheDb,
  getPgPool,
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
const RATE_MAX_REQUESTS = 25;

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
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await queryPg(
        `SELECT * FROM schools
         WHERE (LOWER(slug) = LOWER($1) OR id = $1)
           AND (is_deleted = 0 OR is_deleted IS NULL)
         LIMIT 1`,
        [clean]
      );
      if (res.rows[0]) return res.rows[0];
    } catch (err: any) {
      console.warn('[Public School Lookup PG Notice]', err?.message);
    }
  }
  return (
    cacheDb
      .prepare(
        `SELECT * FROM schools
         WHERE (LOWER(slug) = LOWER(?) OR id = ?)
           AND UPPER(COALESCE(status, 'TRIAL')) != 'CANCELLED'
         LIMIT 1`
      )
      .get(clean, clean) || null
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
          `SELECT id, name, slug, type, status, state, lga, logo_url, website
           FROM schools
           WHERE (is_deleted = 0 OR is_deleted IS NULL)
             AND UPPER(COALESCE(status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
             AND (LOWER(name) LIKE $1 OR LOWER(slug) LIKE $1 OR LOWER(state) LIKE $1 OR LOWER(lga) LIKE $1)
           ORDER BY name ASC
           LIMIT $2`,
          [pattern, limit]
        );
        rows = pgRes.rows;
      } else {
        const pgRes = await queryPg(
          `SELECT id, name, slug, type, status, state, lga, logo_url, website
           FROM schools
           WHERE (is_deleted = 0 OR is_deleted IS NULL)
             AND UPPER(COALESCE(status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
           ORDER BY created_at DESC, name ASC
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
          `SELECT id, name, slug, type, status, state, lga, logo_url, website
           FROM schools
           WHERE UPPER(COALESCE(status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
             AND (LOWER(name) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(state) LIKE ? OR LOWER(lga) LIKE ?)
           ORDER BY name ASC
           LIMIT ?`
        )
        .all(pattern, pattern, pattern, pattern, limit) as any[];
    } else {
      rows = cacheDb
        .prepare(
          `SELECT id, name, slug, type, status, state, lga, logo_url, website
           FROM schools
           WHERE UPPER(COALESCE(status, 'TRIAL')) NOT IN ('CANCELLED', 'SUSPENDED')
           ORDER BY created_at DESC, name ASC
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
