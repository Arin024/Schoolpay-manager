import { Router } from 'express';
import {
  requireAuth,
  requireTenant,
  requireRole,
  type AuthenticatedRequest,
} from './tenantMiddleware.ts';
import {
  canAccessStudent,
  computeGrade,
  dbAll,
  dbGet,
  getEffectiveRoleName,
  getSchoolAcademicSettings,
} from './accessControl.ts';
import { toNaira } from './financeUtils.ts';
import { paymentService } from './paymentService.ts';
import { compileSessionReportCard, compileTermReportCard } from './reportCardService.ts';

export const portalRouter = Router();

for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
  const orig = (portalRouter as any)[method].bind(portalRouter);
  (portalRouter as any)[method] = (path: any, ...handlers: any[]) =>
    orig(
      path,
      ...handlers.map((fn) =>
        typeof fn === 'function' && fn.length < 4
          ? (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next)
          : fn
      )
    );
}

const PARENT_PORTAL_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'PARENT'];
const STUDENT_PORTAL_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'STUDENT'];
const TEACHER_PORTAL_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'TEACHER'];

function sanitizeBreakdownForPortal(
  rawSnapshot: string | null,
  rc: any,
  showClassPosition: boolean
): any {
  let breakdown: any = null;
  if (rawSnapshot) {
    try {
      breakdown = JSON.parse(rawSnapshot);
    } catch {
      breakdown = null;
    }
  }
  if (!breakdown) return null;
  if (!showClassPosition) {
    breakdown.showClassPosition = false;
    breakdown.class_position = null;
    breakdown.class_size = null;
  } else {
    breakdown.showClassPosition = true;
    breakdown.class_position = breakdown.class_position ?? rc.class_position ?? null;
    breakdown.class_size = breakdown.class_size ?? rc.class_size ?? null;
  }
  return breakdown;
}

async function fetchStudentPublishedScores(
  schoolId: string,
  studentId: string,
  academicSessionId?: string,
  termId?: string
) {
  let pgSql = `
    SELECT ss.*,
           sub.name as subject_name, sub.code as subject_code,
           ex.title as exam_title, ex.exam_type, ex.ca_max_score, ex.exam_max_score, ex.total_max_score, ex.published_at as exam_published_at,
           ses.name as session_name, t.name as term_name
    FROM student_scores ss
    JOIN examinations ex ON ss.examination_id = ex.id
    JOIN subjects sub ON ss.subject_id = sub.id
    LEFT JOIN academic_sessions ses ON ss.academic_session_id = ses.id
    LEFT JOIN terms t ON ss.term_id = t.id
    WHERE ss.school_id = $1
      AND ss.student_id = $2
      AND ss.status = 'PUBLISHED'
      AND ex.status = 'PUBLISHED'
      AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
  `;
  let sqSql = `
    SELECT ss.*,
           sub.name as subject_name, sub.code as subject_code,
           ex.title as exam_title, ex.exam_type, ex.ca_max_score, ex.exam_max_score, ex.total_max_score, ex.published_at as exam_published_at,
           ses.name as session_name, t.name as term_name
    FROM student_scores ss
    JOIN examinations ex ON ss.examination_id = ex.id
    JOIN subjects sub ON ss.subject_id = sub.id
    LEFT JOIN academic_sessions ses ON ss.academic_session_id = ses.id
    LEFT JOIN terms t ON ss.term_id = t.id
    WHERE ss.school_id = ?
      AND ss.student_id = ?
      AND ss.status = 'PUBLISHED'
      AND ex.status = 'PUBLISHED'
      AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
  `;
  const params: any[] = [schoolId, studentId];
  let idx = 3;
  if (academicSessionId) {
    pgSql += ` AND ss.academic_session_id = $${idx++}`;
    sqSql += ` AND ss.academic_session_id = ?`;
    params.push(academicSessionId);
  }
  if (termId) {
    pgSql += ` AND ss.term_id = $${idx++}`;
    sqSql += ` AND ss.term_id = ?`;
    params.push(termId);
  }
  pgSql += ` ORDER BY ex.published_at DESC, sub.name ASC`;
  sqSql += ` ORDER BY ex.published_at DESC, sub.name ASC`;

  return dbAll(pgSql, sqSql, params);
}

async function fetchStudentPublishedReportCards(
  schoolId: string,
  studentId: string,
  showClassPosition: boolean,
  gradingScale: any[]
) {
  const rows = await dbAll(
    `SELECT rc.*, ses.name as session_name, t.name as term_name, c.name as class_name
     FROM report_cards rc
     LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
     LEFT JOIN terms t ON rc.term_id = t.id
     LEFT JOIN classes c ON rc.class_id = c.id
     WHERE rc.school_id = $1 AND rc.student_id = $2 AND rc.status = 'PUBLISHED'
     ORDER BY rc.published_at DESC, rc.created_at DESC`,
    `SELECT rc.*, ses.name as session_name, t.name as term_name, c.name as class_name
     FROM report_cards rc
     LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
     LEFT JOIN terms t ON rc.term_id = t.id
     LEFT JOIN classes c ON rc.class_id = c.id
     WHERE rc.school_id = ? AND rc.student_id = ? AND rc.status = 'PUBLISHED'
     ORDER BY rc.published_at DESC, rc.created_at DESC`,
    [schoolId, studentId]
  );

  return rows.map((rc) => {
    const breakdown = sanitizeBreakdownForPortal(rc.snapshot_json, rc, showClassPosition);
    return {
      ...rc,
      report_type: 'TERM',
      class_position: showClassPosition ? rc.class_position : null,
      class_size: showClassPosition ? rc.class_size : null,
      overall_grade: computeGrade(Number(rc.average_score || 0), 100, gradingScale),
      breakdown,
    };
  });
}

async function fetchStudentPublishedSessionReportCards(
  schoolId: string,
  studentId: string,
  showClassPosition: boolean,
  gradingScale: any[]
) {
  const rows = await dbAll(
    `SELECT src.*, ses.name as session_name, c.name as class_name
     FROM session_report_cards src
     LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
     LEFT JOIN classes c ON src.class_id = c.id
     WHERE src.school_id = $1 AND src.student_id = $2 AND src.status = 'PUBLISHED'
     ORDER BY src.published_at DESC, src.created_at DESC`,
    `SELECT src.*, ses.name as session_name, c.name as class_name
     FROM session_report_cards src
     LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
     LEFT JOIN classes c ON src.class_id = c.id
     WHERE src.school_id = ? AND src.student_id = ? AND src.status = 'PUBLISHED'
     ORDER BY src.published_at DESC, src.created_at DESC`,
    [schoolId, studentId]
  );

  return rows.map((src) => {
    const breakdown = sanitizeBreakdownForPortal(src.snapshot_json, src, showClassPosition);
    let termAverages = [];
    try {
      termAverages = src.term_averages_json ? JSON.parse(src.term_averages_json) : [];
    } catch {}
    return {
      ...src,
      report_type: 'SESSION',
      term_averages: termAverages,
      class_position: showClassPosition ? src.class_position : null,
      class_size: showClassPosition ? src.class_size : null,
      overall_grade: computeGrade(Number(src.average_score || 0), 100, gradingScale),
      breakdown,
    };
  });
}

async function fetchStudentPublishedAttendance(
  schoolId: string,
  studentId: string,
  academicSessionId?: string,
  termId?: string
) {
  let pgSql = `
    SELECT ar.*, ses.name as session_name, t.name as term_name
    FROM attendance_records ar
    LEFT JOIN academic_sessions ses ON ar.academic_session_id = ses.id
    LEFT JOIN terms t ON ar.term_id = t.id
    WHERE ar.school_id = $1 AND ar.student_id = $2 AND ar.is_published = 1
  `;
  let sqSql = `
    SELECT ar.*, ses.name as session_name, t.name as term_name
    FROM attendance_records ar
    LEFT JOIN academic_sessions ses ON ar.academic_session_id = ses.id
    LEFT JOIN terms t ON ar.term_id = t.id
    WHERE ar.school_id = ? AND ar.student_id = ? AND ar.is_published = 1
  `;
  const params: any[] = [schoolId, studentId];
  let idx = 3;
  if (academicSessionId) {
    pgSql += ` AND ar.academic_session_id = $${idx++}`;
    sqSql += ` AND ar.academic_session_id = ?`;
    params.push(academicSessionId);
  }
  if (termId) {
    pgSql += ` AND ar.term_id = $${idx++}`;
    sqSql += ` AND ar.term_id = ?`;
    params.push(termId);
  }
  pgSql += ` ORDER BY ar.attendance_date DESC LIMIT 120`;
  sqSql += ` ORDER BY ar.attendance_date DESC LIMIT 120`;

  const records = await dbAll(pgSql, sqSql, params);
  const totalDays = records.length;
  const present = records.filter((r) => r.status === 'PRESENT').length;
  const absent = records.filter((r) => r.status === 'ABSENT').length;
  const late = records.filter((r) => r.status === 'LATE').length;
  const excused = records.filter((r) => r.status === 'EXCUSED').length;
  const attendanceRatePct =
    totalDays > 0 ? Math.round(((present + late) / totalDays) * 1000) / 10 : 0;

  return {
    summary: {
      totalDays,
      present,
      absent,
      late,
      excused,
      attendanceRatePct,
    },
    records,
  };
}

async function fetchStudentVisibleFees(schoolId: string, studentId: string) {
  const invoices = await dbAll(
    `SELECT inv.*, ses.name as session_name, t.name as term_name, c.name as class_name
     FROM invoices inv
     LEFT JOIN academic_sessions ses ON inv.academic_session_id = ses.id
     LEFT JOIN terms t ON inv.term_id = t.id
     LEFT JOIN classes c ON inv.class_id = c.id
     WHERE inv.school_id = $1 AND inv.student_id = $2
       AND (inv.is_deleted = 0 OR inv.is_deleted IS NULL)
       AND inv.status != 'CANCELLED'
     ORDER BY inv.issue_date DESC, inv.created_at DESC`,
    `SELECT inv.*, ses.name as session_name, t.name as term_name, c.name as class_name
     FROM invoices inv
     LEFT JOIN academic_sessions ses ON inv.academic_session_id = ses.id
     LEFT JOIN terms t ON inv.term_id = t.id
     LEFT JOIN classes c ON inv.class_id = c.id
     WHERE inv.school_id = ? AND inv.student_id = ?
       AND inv.status != 'CANCELLED'
     ORDER BY inv.issue_date DESC, inv.created_at DESC`,
    [schoolId, studentId]
  );

  const payments = await dbAll(
    `SELECT p.*, inv.invoice_number, r.id as receipt_id, r.receipt_number
     FROM payments p
     LEFT JOIN invoices inv ON p.invoice_id = inv.id
     LEFT JOIN receipts r ON p.id = r.payment_id
     WHERE p.school_id = $1 AND p.student_id = $2
     ORDER BY p.payment_date DESC, p.created_at DESC`,
    `SELECT p.*, inv.invoice_number, r.id as receipt_id, r.receipt_number
     FROM payments p
     LEFT JOIN invoices inv ON p.invoice_id = inv.id
     LEFT JOIN receipts r ON p.id = r.payment_id
     WHERE p.school_id = ? AND p.student_id = ?
     ORDER BY p.payment_date DESC, p.created_at DESC`,
    [schoolId, studentId]
  );

  const receipts = await dbAll(
    `SELECT r.*, p.payment_method, p.payment_reference, p.payment_date, inv.invoice_number
     FROM receipts r
     JOIN payments p ON r.payment_id = p.id
     JOIN invoices inv ON r.invoice_id = inv.id
     WHERE r.school_id = $1 AND r.student_id = $2
     ORDER BY r.issue_date DESC, r.created_at DESC`,
    `SELECT r.*, p.payment_method, p.payment_reference, p.payment_date, inv.invoice_number
     FROM receipts r
     JOIN payments p ON r.payment_id = p.id
     JOIN invoices inv ON r.invoice_id = inv.id
     WHERE r.school_id = ? AND r.student_id = ?
     ORDER BY r.issue_date DESC, r.created_at DESC`,
    [schoolId, studentId]
  );

  const totalBilledKobo = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const totalPaidKobo = invoices.reduce((sum, inv) => sum + Number(inv.amount_paid || 0), 0);
  const outstandingKobo = invoices.reduce((sum, inv) => sum + Number(inv.balance || 0), 0);

  return {
    feeSummary: {
      totalBilledKobo,
      totalPaidKobo,
      outstandingKobo,
      totalBilledNaira: toNaira(totalBilledKobo),
      totalPaidNaira: toNaira(totalPaidKobo),
      outstandingNaira: toNaira(outstandingKobo),
      invoicesCount: invoices.length,
      unpaidInvoicesCount: invoices.filter((i) => Number(i.balance || 0) > 0).length,
    },
    invoices: invoices.map((inv) => ({
      ...inv,
      subtotal_naira: toNaira(Number(inv.subtotal || 0)),
      discount_naira: toNaira(Number(inv.discount || 0)),
      total_naira: toNaira(Number(inv.total || 0)),
      amount_paid_naira: toNaira(Number(inv.amount_paid || 0)),
      balance_naira: toNaira(Number(inv.balance || 0)),
    })),
    payments: payments.map((p) => ({
      ...p,
      amount_naira: toNaira(Number(p.amount || 0)),
    })),
    receipts: receipts.map((r) => ({
      ...r,
      amount_naira: toNaira(Number(r.amount || 0)),
      previous_balance_naira: toNaira(Number(r.previous_balance || 0)),
      current_balance_naira: toNaira(Number(r.current_balance || 0)),
    })),
  };
}

function buildTermPerformanceTrend(scores: any[]) {
  const map = new Map<string, { label: string; pctSum: number; count: number }>();
  for (const s of scores) {
    if (s.total_score === null || s.total_score === undefined) continue;
    const max = Number(s.total_max_score) > 0 ? Number(s.total_max_score) : 100;
    const pct = Math.max(0, Math.min(100, (Number(s.total_score) / max) * 100));
    const key = `${s.academic_session_id || 'na'}_${s.term_id || 'na'}`;
    const label = [s.session_name, s.term_name].filter(Boolean).join(' · ') || s.exam_title || 'Published Assessment';
    if (!map.has(key)) map.set(key, { label, pctSum: 0, count: 0 });
    const entry = map.get(key)!;
    entry.pctSum += pct;
    entry.count += 1;
  }
  return Array.from(map.entries()).map(([key, v]) => ({
    key,
    label: v.label,
    averagePct: Math.round((v.pctSum / v.count) * 100) / 100,
    subjectsCount: v.count,
  }));
}

async function fetchUserSchools(userId: string) {
  return dbAll(
    `SELECT DISTINCT ur.school_id, s.name as school_name, s.status as school_status, r.name as role_name, r.display_name as role_display_name
     FROM user_roles ur
     JOIN schools s ON ur.school_id = s.id
     JOIN roles r ON ur.role_id = r.id
     WHERE ur.user_id = $1 AND ur.school_id IS NOT NULL
     ORDER BY s.name ASC`,
    `SELECT DISTINCT ur.school_id, s.name as school_name, s.status as school_status, r.name as role_name, r.display_name as role_display_name
     FROM user_roles ur
     JOIN schools s ON ur.school_id = s.id
     JOIN roles r ON ur.role_id = r.id
     WHERE ur.user_id = ? AND ur.school_id IS NOT NULL
     ORDER BY s.name ASC`,
    [userId]
  );
}

async function fetchPersonalNotifications(schoolId: string, userId: string) {
  const rows = await dbAll(
    `SELECT * FROM notifications WHERE school_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 30`,
    `SELECT * FROM notifications WHERE school_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 30`,
    [schoolId, userId]
  );
  return rows.map((n) => {
    let data = null;
    if (n.data) {
      try {
        data = typeof n.data === 'string' ? JSON.parse(n.data) : n.data;
      } catch {}
    }
    return { ...n, message: n.message || n.body || '', data };
  });
}

async function fetchSchoolSessionsWithTerms(schoolId: string) {
  const sessions = await dbAll(
    `SELECT * FROM academic_sessions WHERE school_id = $1 ORDER BY name DESC`,
    `SELECT * FROM academic_sessions WHERE school_id = ? ORDER BY name DESC`,
    [schoolId]
  );
  const terms = await dbAll(
    `SELECT * FROM terms WHERE school_id = $1 ORDER BY name ASC`,
    `SELECT * FROM terms WHERE school_id = ? ORDER BY name ASC`,
    [schoolId]
  );
  return sessions.map((s) => ({
    ...s,
    terms: terms.filter((t) => t.academic_session_id === s.id),
  }));
}

// ==============================================================================
// 1. PARENT PORTAL ENDPOINTS (STRICTLY READ-ONLY ACADEMIC + CHILD-SCOPED FEES)
// ==============================================================================

portalRouter.get(
  '/parent/dashboard',
  requireAuth,
  requireTenant,
  requireRole(PARENT_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const userId = req.user!.id;
    const roleName = getEffectiveRoleName(req);
    const { student_id, academic_session_id, term_id } = req.query as Record<string, string>;

    const settings = await getSchoolAcademicSettings(schoolId);
    const school = await dbGet(
      `SELECT id, name, slug, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = $1`,
      `SELECT id, name, slug, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = ?`,
      [schoolId]
    );
    const userSchools = await fetchUserSchools(userId);
    const notifications = await fetchPersonalNotifications(schoolId, userId);
    const sessions = await fetchSchoolSessionsWithTerms(schoolId);
    const parentProfile = await dbGet(
      `SELECT id, first_name, last_name, phone, email, address, occupation, relationship
       FROM parents
       WHERE user_id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       LIMIT 1`,
      `SELECT id, first_name, last_name, phone, email, address, occupation, relationship
       FROM parents
       WHERE user_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       LIMIT 1`,
      [userId, schoolId]
    );

    // Strictly resolve ONLY explicitly verified linked children
    let children: any[] = [];
    if (roleName === 'PARENT') {
      children = await dbAll(
        `SELECT DISTINCT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
                s.class_id, COALESCE(c.name, s.class_name) as class_name, s.class_arm_name, s.student_status,
                ps.relationship_type, ps.is_primary_contact, ps.verified_at
         FROM parent_students ps
         JOIN parents p ON ps.parent_id = p.id
         JOIN students s ON ps.student_id = s.id
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE p.user_id = $1
           AND p.school_id = $2
           AND ps.school_id = $2
           AND s.school_id = $2
           AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
           AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         ORDER BY ps.is_primary_contact DESC, s.full_name ASC`,
        `SELECT DISTINCT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
                s.class_id, COALESCE(c.name, s.class_name) as class_name, s.class_arm_name, s.student_status,
                ps.relationship_type, ps.is_primary_contact, ps.verified_at
         FROM parent_students ps
         JOIN parents p ON ps.parent_id = p.id
         JOIN students s ON ps.student_id = s.id
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE p.user_id = ?
           AND p.school_id = ?
           AND ps.school_id = p.school_id
           AND s.school_id = p.school_id
           AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
           AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         ORDER BY ps.is_primary_contact DESC, s.full_name ASC`,
        [userId, schoolId]
      );
    } else if (student_id) {
      // Admin preview of a specific student
      const stu = await dbGet(
        `SELECT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
                s.class_id, COALESCE(c.name, s.class_name) as class_name, s.class_arm_name, s.student_status
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.id = $1 AND s.school_id = $2 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)`,
        `SELECT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
                s.class_id, COALESCE(c.name, s.class_name) as class_name, s.class_arm_name, s.student_status
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.id = ? AND s.school_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL)`,
        [student_id, schoolId]
      );
      if (stu) children = [stu];
    }

    if (roleName === 'PARENT' && student_id && !children.some((c) => c.id === student_id)) {
      return res.status(403).json({
        error: 'UNAUTHORIZED_STUDENT_ACCESS',
        message: 'You are not authorized to access records for this student.',
      });
    }

    const selectedChild = student_id
      ? children.find((c) => c.id === student_id) || null
      : children[0] || null;

    if (!selectedChild) {
      const announcements = await dbAll(
        `SELECT sa.*, c.name as target_class_name
         FROM school_announcements sa
         LEFT JOIN classes c ON sa.target_class_id = c.id
         WHERE sa.school_id = $1 AND sa.is_published = 1 AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
           AND sa.audience IN ('ALL', 'PARENTS')
         ORDER BY sa.published_at DESC LIMIT 20`,
        `SELECT sa.*, c.name as target_class_name
         FROM school_announcements sa
         LEFT JOIN classes c ON sa.target_class_id = c.id
         WHERE sa.school_id = ? AND sa.is_published = 1 AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
           AND sa.audience IN ('ALL', 'PARENTS')
         ORDER BY sa.published_at DESC LIMIT 20`,
        [schoolId]
      );

      return res.json({
        success: true,
        school,
        settings,
        schools: userSchools,
        sessions,
        parentProfile: parentProfile || null,
        children: [],
        selectedChild: null,
        results: [],
        termTrend: [],
        reportCards: [],
        attendance: { summary: { totalDays: 0, present: 0, absent: 0, late: 0, excused: 0, attendanceRatePct: 0 }, records: [] },
        behaviour: [],
        teacherRemarks: [],
        feeSummary: null,
        invoices: [],
        payments: [],
        receipts: [],
        gateways: paymentService.getAllProviders(schoolId),
        announcements,
        notifications,
      });
    }

    const [results, reportCards, sessionReportCards, attendance, behaviour, teacherRemarks, fees, announcements] = await Promise.all([
      fetchStudentPublishedScores(schoolId, selectedChild.id, academic_session_id, term_id),
      fetchStudentPublishedReportCards(schoolId, selectedChild.id, Boolean(settings.show_class_position), settings.grading_scale),
      fetchStudentPublishedSessionReportCards(schoolId, selectedChild.id, Boolean(settings.show_class_position), settings.grading_scale),
      fetchStudentPublishedAttendance(schoolId, selectedChild.id, academic_session_id, term_id),
      dbAll(
        `SELECT br.*, ses.name as session_name, t.name as term_name
         FROM behaviour_records br
         LEFT JOIN academic_sessions ses ON br.academic_session_id = ses.id
         LEFT JOIN terms t ON br.term_id = t.id
         WHERE br.school_id = $1 AND br.student_id = $2
           AND (br.is_deleted = 0 OR br.is_deleted IS NULL)
           AND br.visible_to_parent = 1
         ORDER BY br.record_date DESC, br.created_at DESC`,
        `SELECT br.*, ses.name as session_name, t.name as term_name
         FROM behaviour_records br
         LEFT JOIN academic_sessions ses ON br.academic_session_id = ses.id
         LEFT JOIN terms t ON br.term_id = t.id
         WHERE br.school_id = ? AND br.student_id = ?
           AND (br.is_deleted = 0 OR br.is_deleted IS NULL)
           AND br.visible_to_parent = 1
         ORDER BY br.record_date DESC, br.created_at DESC`,
        [schoolId, selectedChild.id]
      ),
      dbAll(
        `SELECT tr.*, ses.name as session_name, t.name as term_name
         FROM teacher_remarks tr
         LEFT JOIN academic_sessions ses ON tr.academic_session_id = ses.id
         LEFT JOIN terms t ON tr.term_id = t.id
         WHERE tr.school_id = $1 AND tr.student_id = $2 AND tr.visible_to_parent = 1
         ORDER BY tr.updated_at DESC`,
        `SELECT tr.*, ses.name as session_name, t.name as term_name
         FROM teacher_remarks tr
         LEFT JOIN academic_sessions ses ON tr.academic_session_id = ses.id
         LEFT JOIN terms t ON tr.term_id = t.id
         WHERE tr.school_id = ? AND tr.student_id = ? AND tr.visible_to_parent = 1
         ORDER BY tr.updated_at DESC`,
        [schoolId, selectedChild.id]
      ),
      fetchStudentVisibleFees(schoolId, selectedChild.id),
      dbAll(
        `SELECT sa.*, c.name as target_class_name
         FROM school_announcements sa
         LEFT JOIN classes c ON sa.target_class_id = c.id
         WHERE sa.school_id = $1 AND sa.is_published = 1 AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
           AND (sa.audience IN ('ALL', 'PARENTS') OR (sa.audience = 'CLASS' AND sa.target_class_id = $2))
         ORDER BY sa.published_at DESC LIMIT 30`,
        `SELECT sa.*, c.name as target_class_name
         FROM school_announcements sa
         LEFT JOIN classes c ON sa.target_class_id = c.id
         WHERE sa.school_id = ? AND sa.is_published = 1 AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
           AND (sa.audience IN ('ALL', 'PARENTS') OR (sa.audience = 'CLASS' AND sa.target_class_id = ?))
         ORDER BY sa.published_at DESC LIMIT 30`,
        [schoolId, selectedChild.class_id || '__none__']
      ),
    ]);

    return res.json({
      success: true,
      school,
      settings,
      schools: userSchools,
      sessions,
      parentProfile: parentProfile || null,
      children,
      selectedChild,
      results,
      termTrend: buildTermPerformanceTrend(results),
      reportCards,
      sessionReportCards,
      attendance,
      behaviour,
      teacherRemarks,
      feeSummary: fees.feeSummary,
      invoices: fees.invoices,
      payments: fees.payments,
      receipts: fees.receipts,
      gateways: paymentService.getAllProviders(schoolId),
      announcements,
      notifications,
    });
  }
);

portalRouter.get(
  '/parent/report-cards/:id',
  requireAuth,
  requireTenant,
  requireRole(PARENT_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const rc = await dbGet(
      `SELECT rc.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
              ses.name as session_name, t.name as term_name
       FROM report_cards rc
       JOIN students s ON rc.student_id = s.id
       LEFT JOIN classes c ON COALESCE(rc.class_id, s.class_id) = c.id
       LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
       LEFT JOIN terms t ON rc.term_id = t.id
       WHERE rc.id = $1 AND rc.school_id = $2`,
      `SELECT rc.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
              ses.name as session_name, t.name as term_name
       FROM report_cards rc
       JOIN students s ON rc.student_id = s.id
       LEFT JOIN classes c ON COALESCE(rc.class_id, s.class_id) = c.id
       LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
       LEFT JOIN terms t ON rc.term_id = t.id
       WHERE rc.id = ? AND rc.school_id = ?`,
      [id, schoolId]
    );

    if (!rc || rc.status !== 'PUBLISHED') {
      return res.status(404).json({
        error: 'REPORT_CARD_UNAVAILABLE',
        message: 'Published report card not found.',
      });
    }

    if (!(await canAccessStudent(req, rc.student_id))) {
      return res.status(403).json({
        error: 'UNAUTHORIZED_STUDENT_ACCESS',
        message: 'You are not authorized to view this student report card.',
      });
    }

    const settings = await getSchoolAcademicSettings(schoolId);
    const breakdown = sanitizeBreakdownForPortal(rc.snapshot_json, rc, Boolean(settings.show_class_position));

    return res.json({
      success: true,
      reportCard: {
        ...rc,
        report_type: 'TERM',
        class_position: settings.show_class_position ? rc.class_position : null,
        class_size: settings.show_class_position ? rc.class_size : null,
        breakdown,
      },
    });
  }
);

portalRouter.get(
  '/parent/session-report-cards/:id',
  requireAuth,
  requireTenant,
  requireRole(PARENT_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const src = await dbGet(
      `SELECT src.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
              ses.name as session_name
       FROM session_report_cards src
       JOIN students s ON src.student_id = s.id
       LEFT JOIN classes c ON COALESCE(src.class_id, s.class_id) = c.id
       LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
       WHERE src.id = $1 AND src.school_id = $2`,
      `SELECT src.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
              ses.name as session_name
       FROM session_report_cards src
       JOIN students s ON src.student_id = s.id
       LEFT JOIN classes c ON COALESCE(src.class_id, s.class_id) = c.id
       LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
       WHERE src.id = ? AND src.school_id = ?`,
      [id, schoolId]
    );

    if (!src || src.status !== 'PUBLISHED') {
      return res.status(404).json({
        error: 'SESSION_REPORT_CARD_UNAVAILABLE',
        message: 'Published session report card not found.',
      });
    }

    if (!(await canAccessStudent(req, src.student_id))) {
      return res.status(403).json({
        error: 'UNAUTHORIZED_STUDENT_ACCESS',
        message: 'You are not authorized to view this student session report card.',
      });
    }

    const settings = await getSchoolAcademicSettings(schoolId);
    const breakdown = sanitizeBreakdownForPortal(src.snapshot_json, src, Boolean(settings.show_class_position));

    return res.json({
      success: true,
      reportCard: {
        ...src,
        report_type: 'SESSION',
        class_position: settings.show_class_position ? src.class_position : null,
        class_size: settings.show_class_position ? src.class_size : null,
        breakdown,
      },
    });
  }
);

// Parent on-demand End-of-Term or Full-Session Report Card / Performance Result generation (published records only)
portalRouter.post(
  '/parent/report-cards/generate',
  requireAuth,
  requireTenant,
  requireRole(PARENT_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { student_id, report_type = 'TERM', academic_session_id, term_id } = req.body || {};

    if (!student_id || !academic_session_id) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'student_id and academic_session_id are required.',
      });
    }

    if (!(await canAccessStudent(req, student_id))) {
      return res.status(403).json({
        error: 'UNAUTHORIZED_STUDENT_ACCESS',
        message: 'You are not authorized to generate report cards for this student.',
      });
    }

    if (report_type === 'SESSION') {
      const compiled = await compileSessionReportCard(schoolId, student_id, academic_session_id, {
        onlyPublished: true,
        visibilityRole: 'PARENT',
      });
      if (!compiled) {
        return res.status(404).json({
          error: 'NO_PUBLISHED_RESULTS',
          message: 'No published examination results or session report cards are available for this session yet.',
        });
      }
      return res.json({ success: true, source: compiled.source, reportCard: compiled.reportCard });
    }

    if (!term_id) {
      return res.status(400).json({
        error: 'MISSING_TERM',
        message: 'term_id is required when generating an End-of-Term report card.',
      });
    }

    const compiled = await compileTermReportCard(schoolId, student_id, academic_session_id, term_id, {
      onlyPublished: true,
      visibilityRole: 'PARENT',
    });
    if (!compiled) {
      return res.status(404).json({
        error: 'NO_PUBLISHED_RESULTS',
        message: 'No published examination results or report card are available for the selected term yet.',
      });
    }
    return res.json({ success: true, source: compiled.source, reportCard: compiled.reportCard });
  }
);

// ==============================================================================
// 2. STUDENT PORTAL ENDPOINTS (STRICTLY READ-ONLY & POLICY-GATED)
// ==============================================================================

portalRouter.get(
  '/student/dashboard',
  requireAuth,
  requireTenant,
  requireRole(STUDENT_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const userId = req.user!.id;
    const roleName = getEffectiveRoleName(req);
    const { student_id, academic_session_id, term_id } = req.query as Record<string, string>;

    const settings = await getSchoolAcademicSettings(schoolId);
    const school = await dbGet(
      `SELECT id, name, slug, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = $1`,
      `SELECT id, name, slug, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = ?`,
      [schoolId]
    );
    const notifications = await fetchPersonalNotifications(schoolId, userId);
    const sessions = await fetchSchoolSessionsWithTerms(schoolId);

    let student: any = null;
    if (roleName === 'STUDENT') {
      student = await dbGet(
        `SELECT s.*, COALESCE(c.name, s.class_name) as class_display_name
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.user_id = $1 AND s.school_id = $2 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         LIMIT 1`,
        `SELECT s.*, COALESCE(c.name, s.class_name) as class_display_name
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.user_id = ? AND s.school_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         LIMIT 1`,
        [userId, schoolId]
      );
      if (student && student_id && student_id !== student.id) {
        return res.status(403).json({
          error: 'UNAUTHORIZED_STUDENT_ACCESS',
          message: 'You may only access your own student academic records.',
        });
      }
    } else if (student_id) {
      student = await dbGet(
        `SELECT s.*, COALESCE(c.name, s.class_name) as class_display_name
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.id = $1 AND s.school_id = $2 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         LIMIT 1`,
        `SELECT s.*, COALESCE(c.name, s.class_name) as class_display_name
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.id = ? AND s.school_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         LIMIT 1`,
        [student_id, schoolId]
      );
    }

    if (!student) {
      return res.json({
        success: true,
        school,
        settings,
        sessions,
        student: null,
        results: [],
        termTrend: [],
        reportCards: [],
        sessionReportCards: [],
        attendance: { summary: { totalDays: 0, present: 0, absent: 0, late: 0, excused: 0, attendanceRatePct: 0 }, records: [] },
        behaviour: [],
        teacherRemarks: [],
        feesVisible: Boolean(settings.students_can_view_fees),
        feeSummary: null,
        invoices: [],
        payments: [],
        receipts: [],
        announcements: [],
        notifications,
      });
    }

    const feesAllowed = Boolean(settings.students_can_view_fees);
    const [results, reportCards, sessionReportCards, attendance, behaviour, teacherRemarks, fees, announcements] = await Promise.all([
      fetchStudentPublishedScores(schoolId, student.id, academic_session_id, term_id),
      fetchStudentPublishedReportCards(schoolId, student.id, Boolean(settings.show_class_position), settings.grading_scale),
      fetchStudentPublishedSessionReportCards(schoolId, student.id, Boolean(settings.show_class_position), settings.grading_scale),
      fetchStudentPublishedAttendance(schoolId, student.id, academic_session_id, term_id),
      dbAll(
        `SELECT br.*, ses.name as session_name, t.name as term_name
         FROM behaviour_records br
         LEFT JOIN academic_sessions ses ON br.academic_session_id = ses.id
         LEFT JOIN terms t ON br.term_id = t.id
         WHERE br.school_id = $1 AND br.student_id = $2
           AND (br.is_deleted = 0 OR br.is_deleted IS NULL)
           AND br.visible_to_student = 1
         ORDER BY br.record_date DESC, br.created_at DESC`,
        `SELECT br.*, ses.name as session_name, t.name as term_name
         FROM behaviour_records br
         LEFT JOIN academic_sessions ses ON br.academic_session_id = ses.id
         LEFT JOIN terms t ON br.term_id = t.id
         WHERE br.school_id = ? AND br.student_id = ?
           AND (br.is_deleted = 0 OR br.is_deleted IS NULL)
           AND br.visible_to_student = 1
         ORDER BY br.record_date DESC, br.created_at DESC`,
        [schoolId, student.id]
      ),
      dbAll(
        `SELECT tr.*, ses.name as session_name, t.name as term_name
         FROM teacher_remarks tr
         LEFT JOIN academic_sessions ses ON tr.academic_session_id = ses.id
         LEFT JOIN terms t ON tr.term_id = t.id
         WHERE tr.school_id = $1 AND tr.student_id = $2 AND tr.visible_to_student = 1
         ORDER BY tr.updated_at DESC`,
        `SELECT tr.*, ses.name as session_name, t.name as term_name
         FROM teacher_remarks tr
         LEFT JOIN academic_sessions ses ON tr.academic_session_id = ses.id
         LEFT JOIN terms t ON tr.term_id = t.id
         WHERE tr.school_id = ? AND tr.student_id = ? AND tr.visible_to_student = 1
         ORDER BY tr.updated_at DESC`,
        [schoolId, student.id]
      ),
      feesAllowed ? fetchStudentVisibleFees(schoolId, student.id) : Promise.resolve(null),
      dbAll(
        `SELECT sa.*, c.name as target_class_name
         FROM school_announcements sa
         LEFT JOIN classes c ON sa.target_class_id = c.id
         WHERE sa.school_id = $1 AND sa.is_published = 1 AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
           AND (sa.audience IN ('ALL', 'STUDENTS') OR (sa.audience = 'CLASS' AND sa.target_class_id = $2))
         ORDER BY sa.published_at DESC LIMIT 30`,
        `SELECT sa.*, c.name as target_class_name
         FROM school_announcements sa
         LEFT JOIN classes c ON sa.target_class_id = c.id
         WHERE sa.school_id = ? AND sa.is_published = 1 AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
           AND (sa.audience IN ('ALL', 'STUDENTS') OR (sa.audience = 'CLASS' AND sa.target_class_id = ?))
         ORDER BY sa.published_at DESC LIMIT 30`,
        [schoolId, student.class_id || '__none__']
      ),
    ]);

    return res.json({
      success: true,
      school,
      settings,
      sessions,
      student: {
        ...student,
        class_name: student.class_display_name || student.class_name,
      },
      results,
      termTrend: buildTermPerformanceTrend(results),
      reportCards,
      sessionReportCards,
      attendance,
      behaviour,
      teacherRemarks,
      feesVisible: feesAllowed,
      feeSummary: fees ? fees.feeSummary : null,
      invoices: fees ? fees.invoices : [],
      payments: fees ? fees.payments : [],
      receipts: fees ? fees.receipts : [],
      announcements,
      notifications,
    });
  }
);

portalRouter.get(
  '/student/report-cards/:id',
  requireAuth,
  requireTenant,
  requireRole(STUDENT_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const rc = await dbGet(
      `SELECT rc.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
              ses.name as session_name, t.name as term_name
       FROM report_cards rc
       JOIN students s ON rc.student_id = s.id
       LEFT JOIN classes c ON COALESCE(rc.class_id, s.class_id) = c.id
       LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
       LEFT JOIN terms t ON rc.term_id = t.id
       WHERE rc.id = $1 AND rc.school_id = $2`,
      `SELECT rc.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
              ses.name as session_name, t.name as term_name
       FROM report_cards rc
       JOIN students s ON rc.student_id = s.id
       LEFT JOIN classes c ON COALESCE(rc.class_id, s.class_id) = c.id
       LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
       LEFT JOIN terms t ON rc.term_id = t.id
       WHERE rc.id = ? AND rc.school_id = ?`,
      [id, schoolId]
    );

    if (!rc || rc.status !== 'PUBLISHED') {
      return res.status(404).json({
        error: 'REPORT_CARD_UNAVAILABLE',
        message: 'Published report card not found.',
      });
    }

    if (!(await canAccessStudent(req, rc.student_id))) {
      return res.status(403).json({
        error: 'UNAUTHORIZED_STUDENT_ACCESS',
        message: 'You are not authorized to view this report card.',
      });
    }

    const settings = await getSchoolAcademicSettings(schoolId);
    const breakdown = sanitizeBreakdownForPortal(rc.snapshot_json, rc, Boolean(settings.show_class_position));

    return res.json({
      success: true,
      reportCard: {
        ...rc,
        report_type: 'TERM',
        class_position: settings.show_class_position ? rc.class_position : null,
        class_size: settings.show_class_position ? rc.class_size : null,
        breakdown,
      },
    });
  }
);

portalRouter.get(
  '/student/session-report-cards/:id',
  requireAuth,
  requireTenant,
  requireRole(STUDENT_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;

    const src = await dbGet(
      `SELECT src.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
              ses.name as session_name
       FROM session_report_cards src
       JOIN students s ON src.student_id = s.id
       LEFT JOIN classes c ON COALESCE(src.class_id, s.class_id) = c.id
       LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
       WHERE src.id = $1 AND src.school_id = $2`,
      `SELECT src.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
              ses.name as session_name
       FROM session_report_cards src
       JOIN students s ON src.student_id = s.id
       LEFT JOIN classes c ON COALESCE(src.class_id, s.class_id) = c.id
       LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
       WHERE src.id = ? AND src.school_id = ?`,
      [id, schoolId]
    );

    if (!src || src.status !== 'PUBLISHED') {
      return res.status(404).json({
        error: 'SESSION_REPORT_CARD_UNAVAILABLE',
        message: 'Published session report card not found.',
      });
    }

    if (!(await canAccessStudent(req, src.student_id))) {
      return res.status(403).json({
        error: 'UNAUTHORIZED_STUDENT_ACCESS',
        message: 'You are not authorized to view this session report card.',
      });
    }

    const settings = await getSchoolAcademicSettings(schoolId);
    const breakdown = sanitizeBreakdownForPortal(src.snapshot_json, src, Boolean(settings.show_class_position));

    return res.json({
      success: true,
      reportCard: {
        ...src,
        report_type: 'SESSION',
        class_position: settings.show_class_position ? src.class_position : null,
        class_size: settings.show_class_position ? src.class_size : null,
        breakdown,
      },
    });
  }
);

// Student on-demand End-of-Term or Full-Session Report Card generation (self-only & published records only)
portalRouter.post(
  '/student/report-cards/generate',
  requireAuth,
  requireTenant,
  requireRole(STUDENT_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const userId = req.user!.id;
    const roleName = getEffectiveRoleName(req);
    const { student_id, report_type = 'TERM', academic_session_id, term_id } = req.body || {};

    if (!academic_session_id) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'academic_session_id is required.' });
    }

    let targetStudentId = student_id;
    if (roleName === 'STUDENT') {
      const selfStudent = await dbGet(
        `SELECT id FROM students WHERE user_id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
        `SELECT id FROM students WHERE user_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
        [userId, schoolId]
      );
      if (!selfStudent) {
        return res.status(404).json({ error: 'STUDENT_NOT_BOUND', message: 'Your student profile is not bound yet.' });
      }
      if (student_id && student_id !== selfStudent.id) {
        return res.status(403).json({
          error: 'UNAUTHORIZED_STUDENT_ACCESS',
          message: 'You may only generate report cards for your own student record.',
        });
      }
      targetStudentId = selfStudent.id;
    } else if (!targetStudentId) {
      return res.status(400).json({ error: 'MISSING_STUDENT', message: 'student_id is required.' });
    }

    if (report_type === 'SESSION') {
      const compiled = await compileSessionReportCard(schoolId, targetStudentId, academic_session_id, {
        onlyPublished: true,
        visibilityRole: 'STUDENT',
      });
      if (!compiled) {
        return res.status(404).json({
          error: 'NO_PUBLISHED_RESULTS',
          message: 'No published examination results or session report cards are available for this session yet.',
        });
      }
      return res.json({ success: true, source: compiled.source, reportCard: compiled.reportCard });
    }

    if (!term_id) {
      return res.status(400).json({
        error: 'MISSING_TERM',
        message: 'term_id is required when generating an End-of-Term report card.',
      });
    }

    const compiled = await compileTermReportCard(schoolId, targetStudentId, academic_session_id, term_id, {
      onlyPublished: true,
      visibilityRole: 'STUDENT',
    });
    if (!compiled) {
      return res.status(404).json({
        error: 'NO_PUBLISHED_RESULTS',
        message: 'No published examination results or report card are available for the selected term yet.',
      });
    }
    return res.json({ success: true, source: compiled.source, reportCard: compiled.reportCard });
  }
);

// ==============================================================================
// 3. TEACHER PORTAL ENDPOINTS (STRICTLY READ-ONLY EDUCATOR WORKSPACE)
// ==============================================================================

portalRouter.get(
  '/teacher/dashboard',
  requireAuth,
  requireTenant,
  requireRole(TEACHER_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const userId = req.user!.id;
    const userEmail = String(req.user!.email || '').toLowerCase();

    const [settings, school, userSchools, sessions, notifications] = await Promise.all([
      getSchoolAcademicSettings(schoolId),
      dbGet(
        `SELECT id, name, slug, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = $1`,
        `SELECT id, name, slug, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = ?`,
        [schoolId]
      ),
      fetchUserSchools(userId),
      fetchSchoolSessionsWithTerms(schoolId),
      fetchPersonalNotifications(schoolId, userId),
    ]);

    const staff = await dbGet(
      `SELECT id, staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined
       FROM staff
       WHERE school_id = $1 AND LOWER(COALESCE(email, '')) = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       LIMIT 1`,
      `SELECT id, staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined
       FROM staff
       WHERE school_id = ? AND LOWER(COALESCE(email, '')) = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       LIMIT 1`,
      [schoolId, userEmail]
    );

    let assignedArms: any[] = [];
    if (staff?.id) {
      assignedArms = await dbAll(
        `SELECT ca.id as arm_id, ca.name as arm_name, ca.capacity,
                c.id as class_id, c.name as class_name, c.level as class_level,
                (SELECT COUNT(*) FROM students s WHERE s.school_id = $1 AND s.class_id = c.id AND (s.class_arm_id = ca.id OR s.class_arm_id IS NULL) AND (s.is_deleted = 0 OR s.is_deleted IS NULL)) as students_count
         FROM class_arms ca
         JOIN classes c ON ca.class_id = c.id
         WHERE ca.school_id = $1 AND ca.class_teacher_id = $2
           AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
         ORDER BY c.name ASC, ca.name ASC`,
        `SELECT ca.id as arm_id, ca.name as arm_name, ca.capacity,
                c.id as class_id, c.name as class_name, c.level as class_level,
                (SELECT COUNT(*) FROM students s WHERE s.school_id = ca.school_id AND s.class_id = c.id AND (s.class_arm_id = ca.id OR s.class_arm_id IS NULL) AND (s.is_deleted = 0 OR s.is_deleted IS NULL)) as students_count
         FROM class_arms ca
         JOIN classes c ON ca.class_id = c.id
         WHERE ca.school_id = ? AND ca.class_teacher_id = ?
           AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
         ORDER BY c.name ASC, ca.name ASC`,
        [schoolId, staff.id]
      );
    }

    const assignedClassIds = Array.from(new Set(assignedArms.map((a) => String(a.class_id))));
    const assignedArmIds = Array.from(new Set(assignedArms.map((a) => String(a.arm_id))));

    let students: any[] = [];
    if (assignedClassIds.length > 0) {
      const classStudents = await dbAll(
        `SELECT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
                s.class_id, s.class_arm_id, COALESCE(c.name, s.class_name) as class_name,
                s.class_arm_name, s.student_status
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.school_id = $1 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         ORDER BY s.full_name ASC`,
        `SELECT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
                s.class_id, s.class_arm_id, COALESCE(c.name, s.class_name) as class_name,
                s.class_arm_name, s.student_status
         FROM students s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.school_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         ORDER BY s.full_name ASC`,
        [schoolId]
      );
      students = classStudents.filter(
        (st) =>
          (st.class_arm_id && assignedArmIds.includes(String(st.class_arm_id))) ||
          (!st.class_arm_id && st.class_id && assignedClassIds.includes(String(st.class_id)))
      );
    }

    const [allClasses, subjects, announcements, examCountRow, reportCountRow, attCountRow] = await Promise.all([
      dbAll(
        `SELECT c.id, c.name, c.level,
                (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.school_id = $1 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)) as total_students
         FROM classes c
         WHERE c.school_id = $1 AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
         ORDER BY c.name ASC`,
        `SELECT c.id, c.name, c.level,
                (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.school_id = c.school_id AND (s.is_deleted = 0 OR s.is_deleted IS NULL)) as total_students
         FROM classes c
         WHERE c.school_id = ? AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
         ORDER BY c.name ASC`,
        [schoolId]
      ),
      dbAll(
        `SELECT id, name, code, department, class_id, status FROM subjects WHERE school_id = $1 AND status = 'ACTIVE' ORDER BY name ASC`,
        `SELECT id, name, code, department, class_id, status FROM subjects WHERE school_id = ? AND status = 'ACTIVE' ORDER BY name ASC`,
        [schoolId]
      ),
      dbAll(
        `SELECT sa.*, c.name as target_class_name
         FROM school_announcements sa
         LEFT JOIN classes c ON sa.target_class_id = c.id
         WHERE sa.school_id = $1 AND sa.is_published = 1 AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
           AND sa.audience IN ('ALL', 'TEACHERS', 'CLASS')
         ORDER BY sa.published_at DESC LIMIT 20`,
        `SELECT sa.*, c.name as target_class_name
         FROM school_announcements sa
         LEFT JOIN classes c ON sa.target_class_id = c.id
         WHERE sa.school_id = ? AND sa.is_published = 1 AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
           AND sa.audience IN ('ALL', 'TEACHERS', 'CLASS')
         ORDER BY sa.published_at DESC LIMIT 20`,
        [schoolId]
      ),
      dbGet(
        `SELECT COUNT(*) as c FROM examinations WHERE school_id = $1 AND status = 'PUBLISHED' AND (is_deleted = 0 OR is_deleted IS NULL)`,
        `SELECT COUNT(*) as c FROM examinations WHERE school_id = ? AND status = 'PUBLISHED' AND (is_deleted = 0 OR is_deleted IS NULL)`,
        [schoolId]
      ),
      dbGet(
        `SELECT COUNT(*) as c FROM report_cards WHERE school_id = $1 AND status = 'PUBLISHED'`,
        `SELECT COUNT(*) as c FROM report_cards WHERE school_id = ? AND status = 'PUBLISHED'`,
        [schoolId]
      ),
      dbGet(
        `SELECT COUNT(*) as c FROM attendance_records WHERE school_id = $1`,
        `SELECT COUNT(*) as c FROM attendance_records WHERE school_id = ?`,
        [schoolId]
      ),
    ]);

    return res.json({
      success: true,
      school,
      settings,
      schools: userSchools,
      sessions,
      teacherProfile: {
        user: {
          id: req.user!.id,
          email: req.user!.email,
          full_name: req.user!.full_name,
          phone: req.user!.phone,
        },
        staff: staff || null,
      },
      assignedClasses: assignedArms,
      hasAssignedClasses: assignedArms.length > 0,
      allClasses,
      subjects,
      students,
      announcements,
      notifications,
      stats: {
        assignedClassesCount: assignedArms.length,
        authorizedStudentsCount: students.length,
        publishedExamsCount: Number(examCountRow?.c || 0),
        reportCardsPublishedCount: Number(reportCountRow?.c || 0),
        attendanceLogsCount: Number(attCountRow?.c || 0),
        unreadNotificationsCount: notifications.filter((n) => !n.read_at).length,
      },
    });
  }
);

// Teacher Read-Only On-Demand Report Card / Performance Result Compilation (never mutates DB records)
portalRouter.post(
  '/teacher/report-cards/generate',
  requireAuth,
  requireTenant,
  requireRole(TEACHER_PORTAL_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { student_id, report_type = 'TERM', academic_session_id, term_id } = req.body || {};

    if (!student_id || !academic_session_id) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'student_id and academic_session_id are required.',
      });
    }

    if (!(await canAccessStudent(req, student_id))) {
      return res.status(403).json({
        error: 'UNAUTHORIZED_STUDENT_ACCESS',
        message: 'You are not authorized to access this student record.',
      });
    }

    if (report_type === 'SESSION') {
      const compiled = await compileSessionReportCard(schoolId, student_id, academic_session_id, {
        onlyPublished: false,
        visibilityRole: 'TEACHER',
      });
      if (!compiled) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Student or session record not found.' });
      }
      return res.json({ success: true, source: compiled.source, reportCard: compiled.reportCard });
    }

    if (!term_id) {
      return res.status(400).json({
        error: 'MISSING_TERM',
        message: 'term_id is required for an End-of-Term report card.',
      });
    }

    const compiled = await compileTermReportCard(schoolId, student_id, academic_session_id, term_id, {
      onlyPublished: false,
      visibilityRole: 'TEACHER',
    });
    if (!compiled) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Student record not found.' });
    }
    return res.json({ success: true, source: compiled.source, reportCard: compiled.reportCard });
  }
);
