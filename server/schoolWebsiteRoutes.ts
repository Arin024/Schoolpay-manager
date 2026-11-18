import { Router } from 'express';
import crypto from 'node:crypto';
import { cacheDb, getPgPool, queryPg, normalizeSubdomainSlug } from './db.ts';
import {
  requireAuth,
  requireTenant,
  requireRole,
  type AuthenticatedRequest,
} from './tenantMiddleware.ts';
import {
  ADMIN_ONLY_ROLES,
  dbAll,
  dbGet,
  newId,
} from './accessControl.ts';
import { logAudit } from './audit.ts';
import { notificationService } from './notificationService.ts';
import { wrapRouterAsync, safeClientError } from './securityUtils.ts';

export const publicWebsiteRouter = wrapRouterAsync(Router());
export const schoolWebsiteRouter = wrapRouterAsync(Router());

const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'superadmin',
  'mail',
  'smtp',
  'portal',
  'bursariq',
  'support',
  'billing',
  'docs',
  'static',
  'assets',
]);

async function execWrite(pgSql: string, sqliteSql: string, pgParams: any[], sqliteParams?: any[]) {
  const pool = getPgPool();
  if (pool) {
    await queryPg(pgSql, pgParams);
  }
  try {
    cacheDb.prepare(sqliteSql).run(...(sqliteParams ?? pgParams));
  } catch (err: any) {
    console.warn('[SchoolWebsite SQLite Cache Sync Notice]', err?.message);
  }
}

function validateImageUrlInput(val: unknown): { ok: boolean; value: string | null; message?: string } {
  if (val === undefined || val === null || String(val).trim() === '') {
    return { ok: true, value: null };
  }
  const s = String(val).trim();
  if (s.startsWith('data:image/')) {
    if (s.length > 3_500_000) {
      return { ok: false, value: null, message: 'Uploaded image is too large. Please choose a smaller image (under 2.5MB).' };
    }
    return { ok: true, value: s };
  }
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) {
    if (s.length > 2048) {
      return { ok: false, value: null, message: 'Image URL is too long.' };
    }
    return { ok: true, value: s };
  }
  return { ok: false, value: null, message: 'Please provide an uploaded image or a valid http(s):// image URL.' };
}

function buildPortalUrls(slug: string, portalSubdomain?: string | null) {
  const sub = normalizeSubdomainSlug(portalSubdomain || slug);
  return {
    portal_subdomain: sub,
    subdomainUrl: `https://${sub}.bursariq.com.ng`,
    portalHashUrl: `/#portal/${slug}`,
    sitePathUrl: `/site/${slug}`,
  };
}

export async function resolveActiveSchoolByAnyIdentifier(identifier: string): Promise<any | null> {
  const clean = String(identifier || '').trim();
  if (!clean) return null;

  const pool = getPgPool();
  if (pool) {
    try {
      const pgRes = await queryPg(
        `SELECT s.*
         FROM schools s
         LEFT JOIN school_settings ss ON ss.school_id = s.id
         WHERE (LOWER(s.slug) = LOWER($1) OR LOWER(COALESCE(ss.portal_subdomain, '')) = LOWER($1) OR s.id = $1)
           AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
           AND UPPER(COALESCE(s.status, 'TRIAL')) != 'CANCELLED'
         LIMIT 1`,
        [clean]
      );
      if (pgRes.rows[0]) return pgRes.rows[0];
    } catch {}
  }

  return (
    cacheDb
      .prepare(
        `SELECT s.*
         FROM schools s
         LEFT JOIN school_settings ss ON ss.school_id = s.id
         WHERE (LOWER(s.slug) = LOWER(?) OR LOWER(COALESCE(ss.portal_subdomain, '')) = LOWER(?) OR s.id = ?)
           AND UPPER(COALESCE(s.status, 'TRIAL')) != 'CANCELLED'
         LIMIT 1`
      )
      .get(clean, clean, clean) || null
  );
}

async function getOrBuildWebsiteProfile(school: any) {
  const existing = await dbGet(
    `SELECT * FROM school_website_profiles WHERE school_id = $1 LIMIT 1`,
    `SELECT * FROM school_website_profiles WHERE school_id = ? LIMIT 1`,
    [school.id]
  );

  if (existing) return existing;

  return {
    id: `web_${school.id}`,
    school_id: school.id,
    tagline: `Excellence in Nigerian ${school.type || 'K-12'} Education`,
    hero_title: `Welcome to ${school.name}`,
    hero_subtitle: `Preparing confident, disciplined, and academically distinguished learners in ${school.lga ? `${school.lga}, ` : ''}${school.state || 'Nigeria'}.`,
    hero_image_url: null,
    theme_accent: 'emerald',
    about_title: `About ${school.name}`,
    about_body: `${school.name} delivers structured, NERDC-aligned instruction supported by dedicated educators, transparent family communication, and verifiable academic records.`,
    vision: `To raise globally competitive, morally grounded students equipped for lifelong excellence.`,
    mission: `To inspire academic diligence, good character, and seamless school-family collaboration.`,
    core_values: `Integrity · Academic Rigour · Discipline · Innovation · Community`,
    principal_name: null,
    principal_title: 'The Principal / Head of School',
    principal_message: `We welcome parents, guardians, students, and prospective families to the official digital campus of ${school.name}.`,
    principal_photo_url: null,
    admissions_open: 1,
    admissions_summary: `Admissions are open across eligible classes. Submit an inquiry online or contact our Admissions Office directly.`,
    established_year: null,
    facilities_text: `Science Laboratories · ICT Suite · School Library · Sports Grounds`,
    social_whatsapp: null,
    social_facebook: null,
    social_instagram: null,
    is_published: 1,
  };
}

function extractSubdomainTokenFromHost(hostHeader: string): string | null {
  const host = String(hostHeader || '')
    .split(':')[0]
    .trim()
    .toLowerCase();
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return null;
  }

  // Known production root domains: *.bursariq.com.ng
  if (host.endsWith('.bursariq.com.ng')) {
    const sub = host.slice(0, -'.bursariq.com.ng'.length);
    if (sub && !sub.includes('.') && !RESERVED_SUBDOMAINS.has(sub)) {
      return sub;
    }
  }

  // Also allow local preview subdomain tests e.g. myschool.localhost
  if (host.endsWith('.localhost')) {
    const sub = host.slice(0, -'.localhost'.length);
    if (sub && !sub.includes('.') && !RESERVED_SUBDOMAINS.has(sub)) {
      return sub;
    }
  }

  return null;
}

// ==============================================================================
// 1. PUBLIC WEBSITE & SUBDOMAIN PORTAL RESOLUTION
// ==============================================================================

// GET /api/v1/public/portal-context
publicWebsiteRouter.get('/portal-context', async (req, res) => {
  const hostInput = String(req.query.host || req.headers['x-forwarded-host'] || req.headers.host || '');
  const subToken = extractSubdomainTokenFromHost(hostInput);

  if (!subToken) {
    return res.json({ success: true, matched: false, school: null, slug: null });
  }

  const school = await resolveActiveSchoolByAnyIdentifier(subToken);
  if (!school) {
    return res.json({ success: true, matched: false, school: null, slug: null });
  }

  const settings = await dbGet(
    `SELECT portal_subdomain FROM school_settings WHERE school_id = $1 LIMIT 1`,
    `SELECT portal_subdomain FROM school_settings WHERE school_id = ? LIMIT 1`,
    [school.id]
  );

  return res.json({
    success: true,
    matched: true,
    slug: school.slug,
    school: {
      id: school.id,
      name: school.name,
      slug: school.slug,
      type: school.type,
      state: school.state,
      lga: school.lga,
      logo_url: school.logo_url || null,
    },
    urls: buildPortalUrls(school.slug, settings?.portal_subdomain),
  });
});

// GET /api/v1/public/schools/:slug/website
publicWebsiteRouter.get('/schools/:slug/website', async (req, res) => {
  const school = await resolveActiveSchoolByAnyIdentifier(String(req.params.slug || ''));
  if (!school) {
    return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'School portal could not be found.' });
  }

  const settings = await dbGet(
    `SELECT portal_subdomain, current_academic_session, current_term FROM school_settings WHERE school_id = $1 LIMIT 1`,
    `SELECT portal_subdomain, current_academic_session, current_term FROM school_settings WHERE school_id = ? LIMIT 1`,
    [school.id]
  );

  const website = await getOrBuildWebsiteProfile(school);

  const posts = await dbAll(
    `SELECT id, title, slug, category, excerpt, content, cover_image_url, author_name, author_role, is_featured, published_at, created_at
     FROM school_website_posts
     WHERE school_id = $1 AND is_published = 1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY is_featured DESC, published_at DESC, created_at DESC
     LIMIT 30`,
    `SELECT id, title, slug, category, excerpt, content, cover_image_url, author_name, author_role, is_featured, published_at, created_at
     FROM school_website_posts
     WHERE school_id = ? AND is_published = 1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY is_featured DESC, published_at DESC, created_at DESC
     LIMIT 30`,
    [school.id]
  );

  const gallery = await dbAll(
    `SELECT id, title, caption, album, image_url, display_order, created_at
     FROM school_website_gallery
     WHERE school_id = $1 AND is_published = 1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY display_order ASC, created_at DESC
     LIMIT 48`,
    `SELECT id, title, caption, album, image_url, display_order, created_at
     FROM school_website_gallery
     WHERE school_id = ? AND is_published = 1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY display_order ASC, created_at DESC
     LIMIT 48`,
    [school.id]
  );

  const events = await dbAll(
    `SELECT id, title, event_date, end_date, location, description, visibility
     FROM school_calendar_events
     WHERE school_id = $1 AND visibility = 'PUBLIC' AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY event_date ASC
     LIMIT 24`,
    `SELECT id, title, event_date, end_date, location, description, visibility
     FROM school_calendar_events
     WHERE school_id = ? AND visibility = 'PUBLIC' AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY event_date ASC
     LIMIT 24`,
    [school.id]
  );

  const classes = await dbAll(
    `SELECT id, name, level FROM classes WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY name ASC`,
    `SELECT id, name, level FROM classes WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY name ASC`,
    [school.id]
  );

  const stuCountRow = await dbGet(
    `SELECT COUNT(*) as c FROM students WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT COUNT(*) as c FROM students WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [school.id]
  );
  const stfCountRow = await dbGet(
    `SELECT COUNT(*) as c FROM staff WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT COUNT(*) as c FROM staff WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [school.id]
  );

  return res.json({
    success: true,
    school: {
      id: school.id,
      name: school.name,
      slug: school.slug,
      type: school.type,
      status: school.status,
      state: school.state,
      lga: school.lga,
      address: school.address || null,
      phone: school.phone || null,
      email: school.email || null,
      website: school.website || null,
      logo_url: school.logo_url || null,
    },
    settings: {
      portal_subdomain: settings?.portal_subdomain || normalizeSubdomainSlug(school.slug),
      current_academic_session: settings?.current_academic_session || '2025/2026',
      current_term: settings?.current_term || '1st Term',
    },
    urls: buildPortalUrls(school.slug, settings?.portal_subdomain),
    website,
    posts,
    gallery,
    events,
    classes,
    stats: {
      studentsCount: Number(stuCountRow?.c || 0),
      classesCount: classes.length,
      staffCount: Number(stfCountRow?.c || 0),
    },
  });
});

// POST /api/v1/public/schools/:slug/inquiries
publicWebsiteRouter.post('/schools/:slug/inquiries', async (req, res) => {
  const school = await resolveActiveSchoolByAnyIdentifier(String(req.params.slug || ''));
  if (!school) {
    return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'School portal could not be found.' });
  }

  const studentName = String(req.body?.student_name || '').trim();
  const targetClass = String(req.body?.target_class || '').trim() || null;
  const parentName = String(req.body?.parent_name || '').trim();
  const parentPhone = String(req.body?.parent_phone || '').trim();
  const parentEmail = String(req.body?.parent_email || '').trim() || null;
  const message = String(req.body?.message || '').trim() || null;

  if (!studentName || !parentName || !parentPhone) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Prospective student name, parent/guardian name, and phone number are required.',
    });
  }

  const id = newId('inq');
  await execWrite(
    `INSERT INTO school_admission_inquiries (id, school_id, student_name, target_class, parent_name, parent_phone, parent_email, message, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW')`,
    `INSERT INTO school_admission_inquiries (id, school_id, student_name, target_class, parent_name, parent_phone, parent_email, message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NEW')`,
    [id, school.id, studentName, targetClass, parentName, parentPhone, parentEmail, message]
  );

  // Publish an internal STAFF_ONLY notice so prospective admissions inquiries appear immediately on both Admin & Staff Notices
  const noticeId = newId('ann');
  const noticeTitle = `New Prospective Student Inquiry: ${studentName}${targetClass ? ` (${targetClass})` : ''}`;
  const noticeBody = [
    `A prospective family submitted an online admissions inquiry via your school website:`,
    `• Prospective Student: ${studentName}`,
    `• Target Class / Level: ${targetClass || 'General Inquiry'}`,
    `• Parent / Guardian: ${parentName}`,
    `• Phone / WhatsApp: ${parentPhone}`,
    parentEmail ? `• Email: ${parentEmail}` : null,
    message ? `• Notes: ${message}` : null,
    `• Reference: ${id.toUpperCase()}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await execWrite(
      `INSERT INTO school_announcements (
        id, school_id, title, content, audience, priority, is_confidential, is_published, published_at, created_by_name, is_deleted
      ) VALUES ($1, $2, $3, $4, 'STAFF_ONLY', 'IMPORTANT', 1, 1, CURRENT_TIMESTAMP, 'Admissions Inquiry Desk', 0)`,
      `INSERT INTO school_announcements (
        id, school_id, title, content, audience, priority, is_confidential, is_published, published_at, created_by_name, is_deleted
      ) VALUES (?, ?, ?, ?, 'STAFF_ONLY', 'IMPORTANT', 1, 1, CURRENT_TIMESTAMP, 'Admissions Inquiry Desk', 0)`,
      [noticeId, school.id, noticeTitle, noticeBody]
    );
  } catch (noticeErr: any) {
    console.warn('[Inquiry Notice Persistence Warning]', noticeErr?.message);
  }

  // Notify BOTH School Admins (Owners/Principals/Admins) AND Teaching/School Staff (strictly excluding Parents & Students)
  notificationService.notifyAnnouncementAudience(
    school.id,
    'STAFF_ONLY',
    null,
    `New Admission Inquiry: ${studentName}`,
    `${parentName} (${parentPhone}) submitted an admission inquiry${targetClass ? ` for ${targetClass}` : ''}.`,
    { inquiryId: id, noticeId, studentName, targetClass },
    true
  );

  return res.status(201).json({
    success: true,
    inquiry: {
      id,
      school_id: school.id,
      student_name: studentName,
      target_class: targetClass,
      parent_name: parentName,
      parent_phone: parentPhone,
      parent_email: parentEmail,
      message,
      status: 'NEW',
    },
    noticeId,
    message: `Thank you! Your admission inquiry has been sent to ${school.name} Administration & Admissions Staff. Reference: ${id.toUpperCase()}`,
  });
});

// ==============================================================================
// 2. ADMIN SCHOOL WEBSITE CMS & TIMETABLE MANAGEMENT
// Mounted under /api/v1/school/website
// ==============================================================================

const websiteAdminGuard = [requireAuth, requireTenant, requireRole(ADMIN_ONLY_ROLES)];

// GET /api/v1/school/website/profile
schoolWebsiteRouter.get('/profile', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const school = await dbGet(
    `SELECT * FROM schools WHERE id = $1 LIMIT 1`,
    `SELECT * FROM schools WHERE id = ? LIMIT 1`,
    [schoolId]
  );
  if (!school) {
    return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'School not found.' });
  }
  const settings = await dbGet(
    `SELECT portal_subdomain FROM school_settings WHERE school_id = $1 LIMIT 1`,
    `SELECT portal_subdomain FROM school_settings WHERE school_id = ? LIMIT 1`,
    [schoolId]
  );
  const website = await getOrBuildWebsiteProfile(school);

  return res.json({
    success: true,
    website,
    urls: buildPortalUrls(school.slug, settings?.portal_subdomain),
  });
});

// PUT /api/v1/school/website/profile
schoolWebsiteRouter.put('/profile', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const school = await dbGet(
    `SELECT * FROM schools WHERE id = $1 LIMIT 1`,
    `SELECT * FROM schools WHERE id = ? LIMIT 1`,
    [schoolId]
  );
  if (!school) {
    return res.status(404).json({ error: 'SCHOOL_NOT_FOUND', message: 'School not found.' });
  }

  const heroCheck = validateImageUrlInput(req.body?.hero_image_url);
  if (!heroCheck.ok) {
    return res.status(400).json({ error: 'INVALID_IMAGE', message: heroCheck.message });
  }
  const principalPhotoCheck = validateImageUrlInput(req.body?.principal_photo_url);
  if (!principalPhotoCheck.ok) {
    return res.status(400).json({ error: 'INVALID_IMAGE', message: principalPhotoCheck.message });
  }

  let updatedSubdomain: string | null = null;
  if (req.body?.portal_subdomain !== undefined) {
    const rawSub = String(req.body.portal_subdomain || '').trim();
    if (rawSub) {
      const normalized = normalizeSubdomainSlug(rawSub);
      if (normalized.length < 3 || RESERVED_SUBDOMAINS.has(normalized)) {
        return res.status(400).json({
          error: 'INVALID_SUBDOMAIN',
          message: 'Please choose a subdomain with at least 3 characters (letters, numbers, hyphens) not matching reserved system names.',
        });
      }

      const conflict = await dbGet(
        `SELECT school_id FROM school_settings WHERE LOWER(portal_subdomain) = LOWER($1) AND school_id != $2 LIMIT 1`,
        `SELECT school_id FROM school_settings WHERE LOWER(portal_subdomain) = LOWER(?) AND school_id != ? LIMIT 1`,
        [normalized, schoolId]
      );
      if (conflict) {
        return res.status(409).json({
          error: 'SUBDOMAIN_TAKEN',
          message: `Subdomain "${normalized}.bursariq.com.ng" is already in use by another school. Please pick another name.`,
        });
      }

      await execWrite(
        `UPDATE school_settings SET portal_subdomain = $1 WHERE school_id = $2`,
        `UPDATE school_settings SET portal_subdomain = ? WHERE school_id = ?`,
        [normalized, schoolId]
      );
      updatedSubdomain = normalized;
    }
  }

  if (!updatedSubdomain) {
    const st = await dbGet(
      `SELECT portal_subdomain FROM school_settings WHERE school_id = $1 LIMIT 1`,
      `SELECT portal_subdomain FROM school_settings WHERE school_id = ? LIMIT 1`,
      [schoolId]
    );
    updatedSubdomain = st?.portal_subdomain || normalizeSubdomainSlug(school.slug);
  }

  const existing = await getOrBuildWebsiteProfile(school);
  const allowedAccents = ['emerald', 'navy', 'indigo', 'burgundy', 'teal'];
  const themeAccent = allowedAccents.includes(String(req.body?.theme_accent || existing.theme_accent))
    ? String(req.body?.theme_accent || existing.theme_accent)
    : 'emerald';

  const nextProfile = {
    id: existing.id || `web_${schoolId}`,
    school_id: schoolId,
    tagline: req.body?.tagline !== undefined ? String(req.body.tagline || '').trim() || null : existing.tagline,
    hero_title: req.body?.hero_title !== undefined ? String(req.body.hero_title || '').trim() || null : existing.hero_title,
    hero_subtitle: req.body?.hero_subtitle !== undefined ? String(req.body.hero_subtitle || '').trim() || null : existing.hero_subtitle,
    hero_image_url: req.body?.hero_image_url !== undefined ? heroCheck.value : existing.hero_image_url,
    theme_accent: themeAccent,
    about_title: req.body?.about_title !== undefined ? String(req.body.about_title || '').trim() || null : existing.about_title,
    about_body: req.body?.about_body !== undefined ? String(req.body.about_body || '').trim() || null : existing.about_body,
    vision: req.body?.vision !== undefined ? String(req.body.vision || '').trim() || null : existing.vision,
    mission: req.body?.mission !== undefined ? String(req.body.mission || '').trim() || null : existing.mission,
    core_values: req.body?.core_values !== undefined ? String(req.body.core_values || '').trim() || null : existing.core_values,
    principal_name: req.body?.principal_name !== undefined ? String(req.body.principal_name || '').trim() || null : existing.principal_name,
    principal_title: req.body?.principal_title !== undefined ? String(req.body.principal_title || '').trim() || null : existing.principal_title,
    principal_message: req.body?.principal_message !== undefined ? String(req.body.principal_message || '').trim() || null : existing.principal_message,
    principal_photo_url: req.body?.principal_photo_url !== undefined ? principalPhotoCheck.value : existing.principal_photo_url,
    admissions_open: req.body?.admissions_open !== undefined ? (req.body.admissions_open ? 1 : 0) : Number(existing.admissions_open ?? 1),
    admissions_summary: req.body?.admissions_summary !== undefined ? String(req.body.admissions_summary || '').trim() || null : existing.admissions_summary,
    established_year: req.body?.established_year !== undefined ? String(req.body.established_year || '').trim() || null : existing.established_year,
    facilities_text: req.body?.facilities_text !== undefined ? String(req.body.facilities_text || '').trim() || null : existing.facilities_text,
    social_whatsapp: req.body?.social_whatsapp !== undefined ? String(req.body.social_whatsapp || '').trim() || null : existing.social_whatsapp,
    social_facebook: req.body?.social_facebook !== undefined ? String(req.body.social_facebook || '').trim() || null : existing.social_facebook,
    social_instagram: req.body?.social_instagram !== undefined ? String(req.body.social_instagram || '').trim() || null : existing.social_instagram,
    is_published: req.body?.is_published !== undefined ? (req.body.is_published ? 1 : 0) : Number(existing.is_published ?? 1),
  };

  await execWrite(
    `INSERT INTO school_website_profiles (
       id, school_id, tagline, hero_title, hero_subtitle, hero_image_url, theme_accent,
       about_title, about_body, vision, mission, core_values,
       principal_name, principal_title, principal_message, principal_photo_url,
       admissions_open, admissions_summary, established_year, facilities_text,
       social_whatsapp, social_facebook, social_instagram, is_published, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,CURRENT_TIMESTAMP)
     ON CONFLICT (school_id) DO UPDATE SET
       tagline = EXCLUDED.tagline,
       hero_title = EXCLUDED.hero_title,
       hero_subtitle = EXCLUDED.hero_subtitle,
       hero_image_url = EXCLUDED.hero_image_url,
       theme_accent = EXCLUDED.theme_accent,
       about_title = EXCLUDED.about_title,
       about_body = EXCLUDED.about_body,
       vision = EXCLUDED.vision,
       mission = EXCLUDED.mission,
       core_values = EXCLUDED.core_values,
       principal_name = EXCLUDED.principal_name,
       principal_title = EXCLUDED.principal_title,
       principal_message = EXCLUDED.principal_message,
       principal_photo_url = EXCLUDED.principal_photo_url,
       admissions_open = EXCLUDED.admissions_open,
       admissions_summary = EXCLUDED.admissions_summary,
       established_year = EXCLUDED.established_year,
       facilities_text = EXCLUDED.facilities_text,
       social_whatsapp = EXCLUDED.social_whatsapp,
       social_facebook = EXCLUDED.social_facebook,
       social_instagram = EXCLUDED.social_instagram,
       is_published = EXCLUDED.is_published,
       updated_at = CURRENT_TIMESTAMP`,
    `INSERT INTO school_website_profiles (
       id, school_id, tagline, hero_title, hero_subtitle, hero_image_url, theme_accent,
       about_title, about_body, vision, mission, core_values,
       principal_name, principal_title, principal_message, principal_photo_url,
       admissions_open, admissions_summary, established_year, facilities_text,
       social_whatsapp, social_facebook, social_instagram, is_published, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(school_id) DO UPDATE SET
       tagline = excluded.tagline,
       hero_title = excluded.hero_title,
       hero_subtitle = excluded.hero_subtitle,
       hero_image_url = excluded.hero_image_url,
       theme_accent = excluded.theme_accent,
       about_title = excluded.about_title,
       about_body = excluded.about_body,
       vision = excluded.vision,
       mission = excluded.mission,
       core_values = excluded.core_values,
       principal_name = excluded.principal_name,
       principal_title = excluded.principal_title,
       principal_message = excluded.principal_message,
       principal_photo_url = excluded.principal_photo_url,
       admissions_open = excluded.admissions_open,
       admissions_summary = excluded.admissions_summary,
       established_year = excluded.established_year,
       facilities_text = excluded.facilities_text,
       social_whatsapp = excluded.social_whatsapp,
       social_facebook = excluded.social_facebook,
       social_instagram = excluded.social_instagram,
       is_published = excluded.is_published,
       updated_at = CURRENT_TIMESTAMP`,
    [
      nextProfile.id,
      nextProfile.school_id,
      nextProfile.tagline,
      nextProfile.hero_title,
      nextProfile.hero_subtitle,
      nextProfile.hero_image_url,
      nextProfile.theme_accent,
      nextProfile.about_title,
      nextProfile.about_body,
      nextProfile.vision,
      nextProfile.mission,
      nextProfile.core_values,
      nextProfile.principal_name,
      nextProfile.principal_title,
      nextProfile.principal_message,
      nextProfile.principal_photo_url,
      nextProfile.admissions_open,
      nextProfile.admissions_summary,
      nextProfile.established_year,
      nextProfile.facilities_text,
      nextProfile.social_whatsapp,
      nextProfile.social_facebook,
      nextProfile.social_instagram,
      nextProfile.is_published,
    ]
  );

  logAudit({
    actorId: req.user?.id || null,
    actorEmail: req.user?.email || null,
    schoolId,
    action: 'WEBSITE_PROFILE_UPDATED',
    entity: 'school_website_profiles',
    entityId: nextProfile.id,
    metadata: { portal_subdomain: updatedSubdomain, theme_accent: themeAccent, is_published: nextProfile.is_published },
  });

  return res.json({
    success: true,
    website: nextProfile,
    urls: buildPortalUrls(school.slug, updatedSubdomain),
    message: 'School website profile and custom portal subdomain saved.',
  });
});

// ==============================================================================
// 3. BLOG ARTICLES & NEWS CRUD
// ==============================================================================

schoolWebsiteRouter.get('/posts', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const posts = await dbAll(
    `SELECT * FROM school_website_posts
     WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY is_featured DESC, created_at DESC`,
    `SELECT * FROM school_website_posts
     WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY is_featured DESC, created_at DESC`,
    [schoolId]
  );
  return res.json({ success: true, posts });
});

schoolWebsiteRouter.post('/posts', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '').trim();
  const category = String(req.body?.category || 'News').trim();
  const excerpt = String(req.body?.excerpt || '').trim() || content.slice(0, 180);
  const authorName = String(req.body?.author_name || req.user?.full_name || 'School Editorial Desk').trim();
  const authorRole = String(req.body?.author_role || 'School Administration').trim();
  const isPublished = req.body?.is_published === false || req.body?.is_published === 0 ? 0 : 1;
  const isFeatured = req.body?.is_featured ? 1 : 0;

  if (!title || !content) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Article title and body content are required.' });
  }

  const coverCheck = validateImageUrlInput(req.body?.cover_image_url);
  if (!coverCheck.ok) {
    return res.status(400).json({ error: 'INVALID_IMAGE', message: coverCheck.message });
  }

  const id = newId('post');
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) +
    '-' +
    crypto.randomBytes(2).toString('hex');

  await execWrite(
    `INSERT INTO school_website_posts (
       id, school_id, title, slug, category, excerpt, content, cover_image_url,
       author_name, author_role, is_published, is_featured, published_at, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_TIMESTAMP,$13)`,
    `INSERT INTO school_website_posts (
       id, school_id, title, slug, category, excerpt, content, cover_image_url,
       author_name, author_role, is_published, is_featured, published_at, created_by
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`,
    [
      id,
      schoolId,
      title,
      slug,
      category,
      excerpt,
      content,
      coverCheck.value,
      authorName,
      authorRole,
      isPublished,
      isFeatured,
      req.user?.id || null,
    ]
  );

  const post = await dbGet(
    `SELECT * FROM school_website_posts WHERE id = $1 LIMIT 1`,
    `SELECT * FROM school_website_posts WHERE id = ? LIMIT 1`,
    [id]
  );

  return res.status(201).json({ success: true, post, message: 'Article saved successfully.' });
});

schoolWebsiteRouter.put('/posts/:id', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const existing = await dbGet(
    `SELECT * FROM school_website_posts WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT * FROM school_website_posts WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [req.params.id, schoolId]
  );
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Article not found.' });
  }

  const coverCheck: { ok: boolean; value: string | null; message?: string } =
    req.body?.cover_image_url !== undefined
      ? validateImageUrlInput(req.body.cover_image_url)
      : { ok: true, value: existing.cover_image_url };
  if (!coverCheck.ok) {
    return res.status(400).json({ error: 'INVALID_IMAGE', message: coverCheck.message || 'Invalid image URL.' });
  }

  const title = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
  const content = req.body?.content !== undefined ? String(req.body.content).trim() : existing.content;
  const category = req.body?.category !== undefined ? String(req.body.category).trim() : existing.category;
  const excerpt = req.body?.excerpt !== undefined ? String(req.body.excerpt).trim() : existing.excerpt;
  const authorName = req.body?.author_name !== undefined ? String(req.body.author_name).trim() : existing.author_name;
  const authorRole = req.body?.author_role !== undefined ? String(req.body.author_role).trim() : existing.author_role;
  const isPublished = req.body?.is_published !== undefined ? (req.body.is_published ? 1 : 0) : existing.is_published;
  const isFeatured = req.body?.is_featured !== undefined ? (req.body.is_featured ? 1 : 0) : existing.is_featured;

  await execWrite(
    `UPDATE school_website_posts
     SET title=$1, category=$2, excerpt=$3, content=$4, cover_image_url=$5,
         author_name=$6, author_role=$7, is_published=$8, is_featured=$9, updated_at=CURRENT_TIMESTAMP
     WHERE id=$10 AND school_id=$11`,
    `UPDATE school_website_posts
     SET title=?, category=?, excerpt=?, content=?, cover_image_url=?,
         author_name=?, author_role=?, is_published=?, is_featured=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND school_id=?`,
    [title, category, excerpt, content, coverCheck.value, authorName, authorRole, isPublished, isFeatured, existing.id, schoolId]
  );

  const post = await dbGet(
    `SELECT * FROM school_website_posts WHERE id = $1 LIMIT 1`,
    `SELECT * FROM school_website_posts WHERE id = ? LIMIT 1`,
    [existing.id]
  );
  return res.json({ success: true, post, message: 'Article updated successfully.' });
});

schoolWebsiteRouter.delete('/posts/:id', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  await execWrite(
    `UPDATE school_website_posts SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
    `UPDATE school_website_posts SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
    [req.params.id, schoolId]
  );
  return res.json({ success: true, message: 'Article removed.' });
});

// ==============================================================================
// 4. CAMPUS PHOTO GALLERY CRUD
// ==============================================================================

schoolWebsiteRouter.get('/gallery', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const items = await dbAll(
    `SELECT * FROM school_website_gallery
     WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY display_order ASC, created_at DESC`,
    `SELECT * FROM school_website_gallery
     WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY display_order ASC, created_at DESC`,
    [schoolId]
  );
  return res.json({ success: true, gallery: items });
});

schoolWebsiteRouter.post('/gallery', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const title = String(req.body?.title || '').trim();
  const caption = String(req.body?.caption || '').trim() || null;
  const album = String(req.body?.album || 'Campus').trim();
  const displayOrder = Number(req.body?.display_order || 0);
  const isPublished = req.body?.is_published === false || req.body?.is_published === 0 ? 0 : 1;

  const imgCheck = validateImageUrlInput(req.body?.image_url);
  if (!imgCheck.ok || !imgCheck.value) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: imgCheck.message || 'Please upload or provide a photo.' });
  }
  if (!title) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Photo title is required.' });
  }

  const id = newId('gal');
  await execWrite(
    `INSERT INTO school_website_gallery (id, school_id, title, caption, album, image_url, is_published, display_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    `INSERT INTO school_website_gallery (id, school_id, title, caption, album, image_url, is_published, display_order, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, schoolId, title, caption, album, imgCheck.value, isPublished, displayOrder, req.user?.id || null]
  );

  const item = await dbGet(
    `SELECT * FROM school_website_gallery WHERE id = $1 LIMIT 1`,
    `SELECT * FROM school_website_gallery WHERE id = ? LIMIT 1`,
    [id]
  );

  return res.status(201).json({ success: true, item, message: 'Photo added to school gallery.' });
});

schoolWebsiteRouter.delete('/gallery/:id', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  await execWrite(
    `UPDATE school_website_gallery SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
    `UPDATE school_website_gallery SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
    [req.params.id, schoolId]
  );
  return res.json({ success: true, message: 'Photo deleted.' });
});

// ==============================================================================
// 5. CALENDAR EVENTS CRUD (PUBLIC & STAFF_ONLY)
// ==============================================================================

schoolWebsiteRouter.get('/events', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const events = await dbAll(
    `SELECT * FROM school_calendar_events
     WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY event_date ASC, created_at DESC`,
    `SELECT * FROM school_calendar_events
     WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY event_date ASC, created_at DESC`,
    [schoolId]
  );
  return res.json({ success: true, events });
});

schoolWebsiteRouter.post('/events', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const title = String(req.body?.title || '').trim();
  const eventDate = String(req.body?.event_date || '').trim();
  const endDate = String(req.body?.end_date || '').trim() || null;
  const location = String(req.body?.location || '').trim() || null;
  const description = String(req.body?.description || '').trim() || null;
  const visibility = String(req.body?.visibility || 'PUBLIC').toUpperCase() === 'STAFF_ONLY' ? 'STAFF_ONLY' : 'PUBLIC';

  if (!title || !eventDate) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Event title and date are required.' });
  }

  const id = newId('evt');
  await execWrite(
    `INSERT INTO school_calendar_events (id, school_id, title, event_date, end_date, location, description, visibility, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    `INSERT INTO school_calendar_events (id, school_id, title, event_date, end_date, location, description, visibility, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, schoolId, title, eventDate, endDate, location, description, visibility, req.user?.id || null]
  );

  const event = await dbGet(
    `SELECT * FROM school_calendar_events WHERE id = $1 LIMIT 1`,
    `SELECT * FROM school_calendar_events WHERE id = ? LIMIT 1`,
    [id]
  );

  return res.status(201).json({ success: true, event, message: 'Calendar event saved.' });
});

schoolWebsiteRouter.delete('/events/:id', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  await execWrite(
    `UPDATE school_calendar_events SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
    `UPDATE school_calendar_events SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
    [req.params.id, schoolId]
  );
  return res.json({ success: true, message: 'Event removed.' });
});

// ==============================================================================
// 6. ADMISSION INQUIRIES INBOX
// ==============================================================================

schoolWebsiteRouter.get('/inquiries', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const inquiries = await dbAll(
    `SELECT * FROM school_admission_inquiries WHERE school_id = $1 ORDER BY created_at DESC LIMIT 200`,
    `SELECT * FROM school_admission_inquiries WHERE school_id = ? ORDER BY created_at DESC LIMIT 200`,
    [schoolId]
  );
  return res.json({ success: true, inquiries });
});

schoolWebsiteRouter.patch('/inquiries/:id', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const status = String(req.body?.status || '').toUpperCase();
  const validStatuses = ['NEW', 'CONTACTED', 'ENROLLED', 'ARCHIVED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'INVALID_STATUS', message: 'Invalid inquiry status.' });
  }
  const adminNotes = req.body?.admin_notes !== undefined ? String(req.body.admin_notes || '').trim() : null;

  await execWrite(
    `UPDATE school_admission_inquiries SET status = $1, admin_notes = COALESCE($2, admin_notes), updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND school_id = $4`,
    `UPDATE school_admission_inquiries SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
    [status, adminNotes, req.params.id, schoolId]
  );

  const inquiry = await dbGet(
    `SELECT * FROM school_admission_inquiries WHERE id = $1 AND school_id = $2 LIMIT 1`,
    `SELECT * FROM school_admission_inquiries WHERE id = ? AND school_id = ? LIMIT 1`,
    [req.params.id, schoolId]
  );
  return res.json({ success: true, inquiry });
});

// ==============================================================================
// 7. CLASS TIMETABLE BUILDER
// ==============================================================================

schoolWebsiteRouter.get('/timetable', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const slots = await dbAll(
    `SELECT * FROM school_timetable_slots
     WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY class_name ASC, day_of_week ASC, start_time ASC`,
    `SELECT * FROM school_timetable_slots
     WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY class_name ASC, day_of_week ASC, start_time ASC`,
    [schoolId]
  );
  return res.json({ success: true, slots });
});

schoolWebsiteRouter.post('/timetable', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const classId = String(req.body?.class_id || '').trim() || null;
  let className = String(req.body?.class_name || '').trim();
  const armName = String(req.body?.arm_name || '').trim() || null;
  const dayOfWeek = String(req.body?.day_of_week || '').trim();
  const periodLabel = String(req.body?.period_label || '').trim() || null;
  const startTime = String(req.body?.start_time || '').trim();
  const endTime = String(req.body?.end_time || '').trim();
  const subjectName = String(req.body?.subject_name || '').trim();
  const teacherUserId = String(req.body?.teacher_user_id || '').trim() || null;
  const teacherName = String(req.body?.teacher_name || '').trim() || null;
  const roomLabel = String(req.body?.room_label || '').trim() || null;

  if (!className && classId) {
    const cls = await dbGet(
      `SELECT name FROM classes WHERE id = $1 AND school_id = $2 LIMIT 1`,
      `SELECT name FROM classes WHERE id = ? AND school_id = ? LIMIT 1`,
      [classId, schoolId]
    );
    className = cls?.name || '';
  }

  if (!className || !dayOfWeek || !startTime || !endTime || !subjectName) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Class, Day of Week, Start/End Times, and Subject Name are required.',
    });
  }

  const id = newId('tt');
  await execWrite(
    `INSERT INTO school_timetable_slots (
       id, school_id, class_id, class_name, arm_name, day_of_week, period_label,
       start_time, end_time, subject_name, teacher_user_id, teacher_name, room_label
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    `INSERT INTO school_timetable_slots (
       id, school_id, class_id, class_name, arm_name, day_of_week, period_label,
       start_time, end_time, subject_name, teacher_user_id, teacher_name, room_label
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      schoolId,
      classId,
      className,
      armName,
      dayOfWeek,
      periodLabel,
      startTime,
      endTime,
      subjectName,
      teacherUserId,
      teacherName,
      roomLabel,
    ]
  );

  const slot = await dbGet(
    `SELECT * FROM school_timetable_slots WHERE id = $1 LIMIT 1`,
    `SELECT * FROM school_timetable_slots WHERE id = ? LIMIT 1`,
    [id]
  );
  return res.status(201).json({ success: true, slot, message: 'Timetable slot added.' });
});

schoolWebsiteRouter.delete('/timetable/:id', ...websiteAdminGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  await execWrite(
    `UPDATE school_timetable_slots SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
    `UPDATE school_timetable_slots SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
    [req.params.id, schoolId]
  );
  return res.json({ success: true, message: 'Timetable slot deleted.' });
});
