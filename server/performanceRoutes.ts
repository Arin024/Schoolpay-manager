import { Router } from 'express';
import crypto from 'node:crypto';
import { cacheDb, getPgPool, queryPg } from './db.ts';
import {
  requireAuth,
  requireTenant,
  requireRole,
  type AuthenticatedRequest,
} from './tenantMiddleware.ts';
import { logAudit } from './audit.ts';
import { notificationService } from './notificationService.ts';
import {
  ACADEMIC_READ_ROLES,
  ADMIN_ONLY_ROLES,
  computeGrade,
  dbAll,
  dbGet,
  DEFAULT_GRADING_SCALE,
  getEffectiveRoleName,
  getSchoolAcademicSettings,
  newId,
  normalizeGradingScale,
} from './accessControl.ts';
import {
  compileSessionReportCard,
  compileTermReportCard,
} from './reportCardService.ts';
import { resolveHistoricalStudentClass } from './progressionService.ts';
import {
  computeGpaGradeBand,
  getAcademicClassStanding,
  resolveInstitutionProfile,
} from '../src/utils/institutionMode.ts';

export const performanceRouter = Router();

for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
  const orig = (performanceRouter as any)[method].bind(performanceRouter);
  (performanceRouter as any)[method] = (path: any, ...handlers: any[]) =>
    orig(
      path,
      ...handlers.map((fn) =>
        typeof fn === 'function' && fn.length < 4
          ? (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next)
          : fn
      )
    );
}

async function execWrite(pgSql: string, sqliteSql: string, pgParams: any[], sqliteParams?: any[]) {
  const pool = getPgPool();
  if (pool) {
    await queryPg(pgSql, pgParams);
  }
  try {
    cacheDb.prepare(sqliteSql).run(...(sqliteParams ?? pgParams));
  } catch (err: any) {
    console.warn('[Performance SQLite Cache Sync Notice]', err?.message);
  }
}

async function recalculateStudentReportCardIfPresent(
  schoolId: string,
  studentId: string,
  sessionId: string | null,
  termId: string | null
) {
  if (!sessionId || !termId) return;
  const existing = await dbGet(
    `SELECT * FROM report_cards WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 AND term_id = $4 LIMIT 1`,
    `SELECT * FROM report_cards WHERE school_id = ? AND student_id = ? AND academic_session_id = ? AND term_id = ? LIMIT 1`,
    [schoolId, studentId, sessionId, termId]
  );
  if (!existing) return;

  const scores = await dbAll(
    `SELECT ss.*, sub.name as subject_name, sub.code as subject_code
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     WHERE ss.school_id = $1 AND ss.student_id = $2 AND ss.academic_session_id = $3 AND ss.term_id = $4
       ${existing.examination_id ? 'AND ss.examination_id = $5' : ''}`,
    `SELECT ss.*, sub.name as subject_name, sub.code as subject_code
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     WHERE ss.school_id = ? AND ss.student_id = ? AND ss.academic_session_id = ? AND ss.term_id = ?
       ${existing.examination_id ? 'AND ss.examination_id = ?' : ''}`,
    existing.examination_id
      ? [schoolId, studentId, sessionId, termId, existing.examination_id]
      : [schoolId, studentId, sessionId, termId]
  );

  const validTotals = scores.filter((s) => s.total_score !== null && s.total_score !== undefined);
  const totalScore = Math.round(validTotals.reduce((acc, s) => acc + Number(s.total_score || 0), 0) * 100) / 100;
  const avgScore = validTotals.length > 0 ? Math.round((totalScore / validTotals.length) * 100) / 100 : 0;

  let updatedSnapshotJson = existing.snapshot_json;
  if (existing.snapshot_json) {
    try {
      const snap = JSON.parse(existing.snapshot_json);
      snap.subjects = scores.map((s) => ({
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        subject_code: s.subject_code,
        ca_score: s.ca_score,
        exam_score: s.exam_score,
        total_score: s.total_score,
        grade: s.grade,
        grade_remark: s.grade_remark,
        subject_remark: s.subject_remark,
      }));
      snap.total_score = totalScore;
      snap.average_score = avgScore;
      snap.subjects_count = validTotals.length;
      snap.last_corrected_at = new Date().toISOString();
      updatedSnapshotJson = JSON.stringify(snap);
    } catch {}
  }

  await execWrite(
    `UPDATE report_cards
     SET total_score = $1, average_score = $2, subjects_count = $3, snapshot_json = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $5 AND school_id = $6`,
    `UPDATE report_cards
     SET total_score = ?, average_score = ?, subjects_count = ?, snapshot_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND school_id = ?`,
    [totalScore, avgScore, validTotals.length, updatedSnapshotJson, existing.id, schoolId]
  );
}

// ==============================================================================
// 1. ACADEMIC & PORTAL POLICY SETTINGS
// ==============================================================================

performanceRouter.get(
  '/performance/settings',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const settings = await getSchoolAcademicSettings(schoolId);
    return res.json({ success: true, settings });
  }
);

performanceRouter.put(
  '/performance/settings',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      ca_max_score = 40,
      exam_max_score = 60,
      component_structure,
      grading_scale,
      missing_score_policy = 'EXCLUDE',
      show_class_position = true,
      students_can_view_fees = true,
      teachers_can_view_fees = false,
      require_review_before_approve = false,
      min_credit_units_per_cycle,
      max_credit_units_per_cycle,
    } = req.body || {};

    const caMax = Number(ca_max_score);
    const examMax = Number(exam_max_score);
    if (Number.isNaN(caMax) || Number.isNaN(examMax) || caMax < 0 || examMax < 0 || caMax + examMax <= 0) {
      return res.status(400).json({
        error: 'INVALID_ASSESSMENT_WEIGHTS',
        message: 'CA max score and Exam max score must be valid non-negative numbers totaling more than 0.',
      });
    }

    const scale = grading_scale ? normalizeGradingScale(grading_scale) : DEFAULT_GRADING_SCALE;
    const scaleJson = JSON.stringify(scale);
    const compJson = component_structure ? JSON.stringify(component_structure) : null;
    const missingPolicy = missing_score_policy === 'ZERO' ? 'ZERO' : 'EXCLUDE';
    const showPos = show_class_position ? 1 : 0;
    const stuFees = students_can_view_fees ? 1 : 0;
    const tchFees = teachers_can_view_fees ? 1 : 0;
    const reqRev = require_review_before_approve ? 1 : 0;
    const existingSet = await getSchoolAcademicSettings(schoolId);
    const minUnits = min_credit_units_per_cycle !== undefined && Number.isFinite(Number(min_credit_units_per_cycle))
      ? Math.max(0, Math.min(60, Math.round(Number(min_credit_units_per_cycle))))
      : Number(existingSet.min_credit_units_per_cycle ?? 12);
    const maxUnits = max_credit_units_per_cycle !== undefined && Number.isFinite(Number(max_credit_units_per_cycle))
      ? Math.max(minUnits, Math.min(80, Math.round(Number(max_credit_units_per_cycle))))
      : Math.max(minUnits, Number(existingSet.max_credit_units_per_cycle ?? 24));
    const id = `acad_set_${schoolId}`;

    await execWrite(
      `INSERT INTO school_academic_settings (
         id, school_id, ca_max_score, exam_max_score, component_structure_json, grading_scale_json,
         missing_score_policy, show_class_position, students_can_view_fees, teachers_can_view_fees,
         require_review_before_approve, min_credit_units_per_cycle, max_credit_units_per_cycle, updated_by, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (school_id) DO UPDATE SET
         ca_max_score = EXCLUDED.ca_max_score,
         exam_max_score = EXCLUDED.exam_max_score,
         component_structure_json = COALESCE(EXCLUDED.component_structure_json, school_academic_settings.component_structure_json),
         grading_scale_json = EXCLUDED.grading_scale_json,
         missing_score_policy = EXCLUDED.missing_score_policy,
         show_class_position = EXCLUDED.show_class_position,
         students_can_view_fees = EXCLUDED.students_can_view_fees,
         teachers_can_view_fees = EXCLUDED.teachers_can_view_fees,
         require_review_before_approve = EXCLUDED.require_review_before_approve,
         min_credit_units_per_cycle = EXCLUDED.min_credit_units_per_cycle,
         max_credit_units_per_cycle = EXCLUDED.max_credit_units_per_cycle,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      `INSERT INTO school_academic_settings (
         id, school_id, ca_max_score, exam_max_score, component_structure_json, grading_scale_json,
         missing_score_policy, show_class_position, students_can_view_fees, teachers_can_view_fees,
         require_review_before_approve, min_credit_units_per_cycle, max_credit_units_per_cycle, updated_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(school_id) DO UPDATE SET
         ca_max_score = excluded.ca_max_score,
         exam_max_score = excluded.exam_max_score,
         component_structure_json = COALESCE(excluded.component_structure_json, school_academic_settings.component_structure_json),
         grading_scale_json = excluded.grading_scale_json,
         missing_score_policy = excluded.missing_score_policy,
         show_class_position = excluded.show_class_position,
         students_can_view_fees = excluded.students_can_view_fees,
         teachers_can_view_fees = excluded.teachers_can_view_fees,
         require_review_before_approve = excluded.require_review_before_approve,
         min_credit_units_per_cycle = excluded.min_credit_units_per_cycle,
         max_credit_units_per_cycle = excluded.max_credit_units_per_cycle,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [id, schoolId, caMax, examMax, compJson, scaleJson, missingPolicy, showPos, stuFees, tchFees, reqRev, minUnits, maxUnits, req.user!.id]
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'UPDATE_ACADEMIC_SETTINGS',
      entity: 'SCHOOL_ACADEMIC_SETTINGS',
      entityId: id,
      ipAddress: req.ip,
      metadata: { caMax, examMax, missingPolicy, showPos, stuFees, tchFees, reqRev, minUnits, maxUnits },
    });

    const updated = await getSchoolAcademicSettings(schoolId);
    return res.json({ success: true, message: 'Academic & portal settings updated.', settings: updated });
  }
);

// ==============================================================================
// 2. PERFORMANCE OVERVIEW & ANALYTICS
// ==============================================================================

performanceRouter.get(
  '/performance/overview',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const roleName = getEffectiveRoleName(req);
    const {
      academic_session_id,
      term_id,
      class_id,
      subject_id,
      examination_id,
      behaviour_category,
      date_from,
      date_to,
    } = req.query as Record<string, string>;

    const settings = await getSchoolAcademicSettings(schoolId);

    // 1. Fetch filtered scores joined with exam, subject, student, class, session, term
    let scorePg = `
      SELECT ss.id, ss.student_id, ss.subject_id, ss.class_id, ss.academic_session_id, ss.term_id,
             ss.examination_id, ss.ca_score, ss.exam_score, ss.total_score, ss.grade, ss.status,
             ex.title as exam_title, ex.total_max_score,
             s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name, 'Unassigned') as class_name,
             sub.name as subject_name,
             ses.name as session_name, t.name as term_name
      FROM student_scores ss
      JOIN examinations ex ON ss.examination_id = ex.id
      JOIN students s ON ss.student_id = s.id
      JOIN subjects sub ON ss.subject_id = sub.id
      LEFT JOIN classes c ON COALESCE(ss.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON ss.academic_session_id = ses.id
      LEFT JOIN terms t ON ss.term_id = t.id
      WHERE ss.school_id = $1
        AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
        AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
    `;
    let scoreSq = `
      SELECT ss.id, ss.student_id, ss.subject_id, ss.class_id, ss.academic_session_id, ss.term_id,
             ss.examination_id, ss.ca_score, ss.exam_score, ss.total_score, ss.grade, ss.status,
             ex.title as exam_title, ex.total_max_score,
             s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name, 'Unassigned') as class_name,
             sub.name as subject_name,
             ses.name as session_name, t.name as term_name
      FROM student_scores ss
      JOIN examinations ex ON ss.examination_id = ex.id
      JOIN students s ON ss.student_id = s.id
      JOIN subjects sub ON ss.subject_id = sub.id
      LEFT JOIN classes c ON COALESCE(ss.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON ss.academic_session_id = ses.id
      LEFT JOIN terms t ON ss.term_id = t.id
      WHERE ss.school_id = ?
        AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
        AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
    `;
    const scoreParams: any[] = [schoolId];
    let pIdx = 2;

    if (academic_session_id) {
      scorePg += ` AND ss.academic_session_id = $${pIdx++}`;
      scoreSq += ` AND ss.academic_session_id = ?`;
      scoreParams.push(academic_session_id);
    }
    if (term_id) {
      scorePg += ` AND ss.term_id = $${pIdx++}`;
      scoreSq += ` AND ss.term_id = ?`;
      scoreParams.push(term_id);
    }
    if (class_id) {
      scorePg += ` AND COALESCE(ss.class_id, s.class_id) = $${pIdx++}`;
      scoreSq += ` AND COALESCE(ss.class_id, s.class_id) = ?`;
      scoreParams.push(class_id);
    }
    if (subject_id) {
      scorePg += ` AND ss.subject_id = $${pIdx++}`;
      scoreSq += ` AND ss.subject_id = ?`;
      scoreParams.push(subject_id);
    }
    if (examination_id) {
      scorePg += ` AND ss.examination_id = $${pIdx++}`;
      scoreSq += ` AND ss.examination_id = ?`;
      scoreParams.push(examination_id);
    }

    const scoreRows = await dbAll(scorePg, scoreSq, scoreParams);

    // 2. Fetch attendance rows
    let attPg = `SELECT student_id, class_id, academic_session_id, term_id, attendance_date, status, is_published FROM attendance_records WHERE school_id = $1`;
    let attSq = `SELECT student_id, class_id, academic_session_id, term_id, attendance_date, status, is_published FROM attendance_records WHERE school_id = ?`;
    const attParams: any[] = [schoolId];
    let aIdx = 2;
    if (academic_session_id) {
      attPg += ` AND academic_session_id = $${aIdx++}`;
      attSq += ` AND academic_session_id = ?`;
      attParams.push(academic_session_id);
    }
    if (term_id) {
      attPg += ` AND term_id = $${aIdx++}`;
      attSq += ` AND term_id = ?`;
      attParams.push(term_id);
    }
    if (class_id) {
      attPg += ` AND class_id = $${aIdx++}`;
      attSq += ` AND class_id = ?`;
      attParams.push(class_id);
    }
    if (date_from) {
      attPg += ` AND attendance_date >= $${aIdx++}`;
      attSq += ` AND attendance_date >= ?`;
      attParams.push(date_from);
    }
    if (date_to) {
      attPg += ` AND attendance_date <= $${aIdx++}`;
      attSq += ` AND attendance_date <= ?`;
      attParams.push(date_to);
    }
    const attRows = await dbAll(attPg, attSq, attParams);

    // 3. Fetch behaviour rows
    let behPg = `SELECT student_id, class_id, category, severity, record_date, visible_to_teacher FROM behaviour_records WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`;
    let behSq = `SELECT student_id, class_id, category, severity, record_date, visible_to_teacher FROM behaviour_records WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`;
    const behParams: any[] = [schoolId];
    let bIdx = 2;
    if (roleName === 'TEACHER') {
      behPg += ' AND visible_to_teacher = 1';
      behSq += ' AND visible_to_teacher = 1';
    }
    if (academic_session_id) {
      behPg += ` AND academic_session_id = $${bIdx++}`;
      behSq += ` AND academic_session_id = ?`;
      behParams.push(academic_session_id);
    }
    if (term_id) {
      behPg += ` AND term_id = $${bIdx++}`;
      behSq += ` AND term_id = ?`;
      behParams.push(term_id);
    }
    if (class_id) {
      behPg += ` AND class_id = $${bIdx++}`;
      behSq += ` AND class_id = ?`;
      behParams.push(class_id);
    }
    if (behaviour_category) {
      behPg += ` AND category = $${bIdx++}`;
      behSq += ` AND category = ?`;
      behParams.push(behaviour_category);
    }
    if (date_from) {
      behPg += ` AND record_date >= $${bIdx++}`;
      behSq += ` AND record_date >= ?`;
      behParams.push(date_from);
    }
    if (date_to) {
      behPg += ` AND record_date <= $${bIdx++}`;
      behSq += ` AND record_date <= ?`;
      behParams.push(date_to);
    }
    const behRows = await dbAll(behPg, behSq, behParams);

    // 4. Exam & Report Card counts
    const examRows = await dbAll(
      `SELECT id, status FROM examinations WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT id, status FROM examinations WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [schoolId]
    );
    const rcRows = await dbAll(
      `SELECT id, status FROM report_cards WHERE school_id = $1`,
      `SELECT id, status FROM report_cards WHERE school_id = ?`,
      [schoolId]
    );

    // Compute deterministic aggregations
    const scoredEntries = scoreRows.filter((r) => r.total_score !== null && r.total_score !== undefined);
    const pctValues = scoredEntries.map((r) => {
      const max = Number(r.total_max_score) > 0 ? Number(r.total_max_score) : 100;
      return Math.max(0, Math.min(100, (Number(r.total_score) / max) * 100));
    });

    const overallAveragePct =
      pctValues.length > 0 ? Math.round((pctValues.reduce((a, b) => a + b, 0) / pctValues.length) * 100) / 100 : 0;
    const passCount = pctValues.filter((p) => p >= 40).length;
    const passRatePct = pctValues.length > 0 ? Math.round((passCount / pctValues.length) * 1000) / 10 : 0;

    // Class comparisons
    const classMap = new Map<string, { classId: string; className: string; pctSum: number; count: number; passes: number; students: Set<string> }>();
    // Subject trends
    const subjMap = new Map<string, { subjectId: string; subjectName: string; pctSum: number; count: number; min: number; max: number; passes: number }>();
    // Multi-term trend
    const termMap = new Map<string, { key: string; label: string; pctSum: number; count: number; passes: number }>();
    // Grade distribution
    const gradeCounts: Record<string, number> = {};
    // Student aggregates
    const stuMap = new Map<string, { studentId: string; studentName: string; admissionNumber: string; className: string; pctSum: number; count: number }>();

    for (const r of scoredEntries) {
      const max = Number(r.total_max_score) > 0 ? Number(r.total_max_score) : 100;
      const pct = Math.max(0, Math.min(100, (Number(r.total_score) / max) * 100));
      const isPass = pct >= 40 ? 1 : 0;

      const cKey = r.class_id || r.class_name || 'Unassigned';
      if (!classMap.has(cKey)) {
        classMap.set(cKey, { classId: cKey, className: r.class_name || 'Unassigned', pctSum: 0, count: 0, passes: 0, students: new Set() });
      }
      const cEntry = classMap.get(cKey)!;
      cEntry.pctSum += pct;
      cEntry.count += 1;
      cEntry.passes += isPass;
      cEntry.students.add(r.student_id);

      const sKey = r.subject_id;
      if (!subjMap.has(sKey)) {
        subjMap.set(sKey, { subjectId: sKey, subjectName: r.subject_name, pctSum: 0, count: 0, min: pct, max: pct, passes: 0 });
      }
      const sEntry = subjMap.get(sKey)!;
      sEntry.pctSum += pct;
      sEntry.count += 1;
      sEntry.min = Math.min(sEntry.min, pct);
      sEntry.max = Math.max(sEntry.max, pct);
      sEntry.passes += isPass;

      const tKey = `${r.academic_session_id || 'na'}_${r.term_id || 'na'}`;
      const tLabel = [r.session_name, r.term_name].filter(Boolean).join(' · ') || r.exam_title || 'Current Period';
      if (!termMap.has(tKey)) {
        termMap.set(tKey, { key: tKey, label: tLabel, pctSum: 0, count: 0, passes: 0 });
      }
      const tEntry = termMap.get(tKey)!;
      tEntry.pctSum += pct;
      tEntry.count += 1;
      tEntry.passes += isPass;

      const g = r.grade || computeGrade(Number(r.total_score), max, settings.grading_scale).grade || 'F';
      gradeCounts[g] = (gradeCounts[g] || 0) + 1;

      if (!stuMap.has(r.student_id)) {
        stuMap.set(r.student_id, {
          studentId: r.student_id,
          studentName: r.student_name,
          admissionNumber: r.admission_number || '',
          className: r.class_name || 'Unassigned',
          pctSum: 0,
          count: 0,
        });
      }
      const st = stuMap.get(r.student_id)!;
      st.pctSum += pct;
      st.count += 1;
    }

    const attTotal = attRows.length;
    const attPresentOrLate = attRows.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
    const attendanceRatePct = attTotal > 0 ? Math.round((attPresentOrLate / attTotal) * 1000) / 10 : 0;

    const studentAttMap = new Map<string, { present: number; total: number }>();
    for (const a of attRows) {
      if (!studentAttMap.has(a.student_id)) studentAttMap.set(a.student_id, { present: 0, total: 0 });
      const sa = studentAttMap.get(a.student_id)!;
      sa.total += 1;
      if (a.status === 'PRESENT' || a.status === 'LATE') sa.present += 1;
    }

    const positiveBehaviourCount = behRows.filter((b) => b.category === 'POSITIVE' || b.category === 'COMMENDATION').length;
    const disciplineBehaviourCount = behRows.filter((b) => b.category === 'DISCIPLINE' || b.category === 'INCIDENT').length;

    const studentRankList = Array.from(stuMap.values())
      .map((s) => {
        const avg = Math.round((s.pctSum / s.count) * 100) / 100;
        const att = studentAttMap.get(s.studentId);
        const attPct = att && att.total > 0 ? Math.round((att.present / att.total) * 1000) / 10 : null;
        return { ...s, averagePct: avg, attendancePct: attPct };
      })
      .sort((a, b) => b.averagePct - a.averagePct);

    const topStudents = studentRankList.slice(0, 10);
    const atRiskStudents = studentRankList
      .filter((s) => s.averagePct < 50 || (s.attendancePct !== null && s.attendancePct < 75))
      .sort((a, b) => a.averagePct - b.averagePct)
      .slice(0, 10);

    return res.json({
      success: true,
      summary: {
        studentsAssessed: stuMap.size,
        scoredEntriesCount: scoredEntries.length,
        overallAveragePct,
        passRatePct,
        publishedExamsCount: examRows.filter((e) => e.status === 'PUBLISHED').length,
        draftExamsCount: examRows.filter((e) => e.status !== 'PUBLISHED').length,
        reportCardsPublished: rcRows.filter((r) => r.status === 'PUBLISHED').length,
        reportCardsTotal: rcRows.length,
        attendanceRecordsCount: attTotal,
        attendanceRatePct,
        positiveBehaviourCount,
        disciplineBehaviourCount,
      },
      classRankings: Array.from(classMap.values())
        .map((c) => ({
          classId: c.classId,
          className: c.className,
          studentsCount: c.students.size,
          entriesCount: c.count,
          averagePct: Math.round((c.pctSum / c.count) * 100) / 100,
          passRatePct: Math.round((c.passes / c.count) * 1000) / 10,
        }))
        .sort((a, b) => b.averagePct - a.averagePct),
      subjectTrends: Array.from(subjMap.values())
        .map((s) => ({
          subjectId: s.subjectId,
          subjectName: s.subjectName,
          entriesCount: s.count,
          averagePct: Math.round((s.pctSum / s.count) * 100) / 100,
          minPct: Math.round(s.min * 100) / 100,
          maxPct: Math.round(s.max * 100) / 100,
          passRatePct: Math.round((s.passes / s.count) * 1000) / 10,
        }))
        .sort((a, b) => b.averagePct - a.averagePct),
      termTrend: Array.from(termMap.values()).map((t) => ({
        key: t.key,
        label: t.label,
        entriesCount: t.count,
        averagePct: Math.round((t.pctSum / t.count) * 100) / 100,
        passRatePct: Math.round((t.passes / t.count) * 1000) / 10,
      })),
      gradeDistribution: Object.entries(gradeCounts).map(([grade, count]) => ({ grade, count })),
      topStudents,
      atRiskStudents,
    });
  }
);

// ==============================================================================
// 3. SUBJECTS MANAGEMENT (Admin Write, Academic Staff Read)
// ==============================================================================

performanceRouter.get(
  '/subjects',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const subjects = await dbAll(
      `SELECT sub.*, c.name as class_name
       FROM subjects sub
       LEFT JOIN classes c ON sub.class_id = c.id
       WHERE sub.school_id = $1 AND (sub.is_deleted = 0 OR sub.is_deleted IS NULL)
       ORDER BY sub.name ASC`,
      `SELECT sub.*, c.name as class_name
       FROM subjects sub
       LEFT JOIN classes c ON sub.class_id = c.id
       WHERE sub.school_id = ? AND (sub.is_deleted = 0 OR sub.is_deleted IS NULL)
       ORDER BY sub.name ASC`,
      [schoolId]
    );
    return res.json({ success: true, count: subjects.length, subjects });
  }
);

performanceRouter.post(
  '/subjects',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      name,
      code,
      department,
      class_id,
      status = 'ACTIVE',
      credit_units,
      course_type = 'CORE',
      semester_tag,
    } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'MISSING_NAME', message: 'Subject/Course name is required.' });
    }
    const cleanName = name.trim();
    const cleanClassId = class_id && String(class_id).trim() ? String(class_id).trim() : null;
    const cleanCode = code && String(code).trim()
      ? String(code).trim().toUpperCase().slice(0, 24)
      : cleanName.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'SUB';

    const dup = await dbGet(
      `SELECT id FROM subjects
       WHERE school_id = $1
         AND COALESCE(class_id, '') = COALESCE($2, '')
         AND (LOWER(name) = LOWER($3) OR (code IS NOT NULL AND LOWER(code) = LOWER($4)))
         AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT id FROM subjects
       WHERE school_id = ?
         AND COALESCE(class_id, '') = COALESCE(?, '')
         AND (LOWER(name) = LOWER(?) OR (code IS NOT NULL AND LOWER(code) = LOWER(?)))
         AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [schoolId, cleanClassId || '', cleanName, cleanCode]
    );
    if (dup) {
      return res.status(409).json({
        error: 'DUPLICATE_SUBJECT',
        message: `"${cleanName}" (${cleanCode}) already exists for this class/level scope.`,
      });
    }

    const id = newId('sub');
    const validStatus = status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const hasExplicitUnits = credit_units !== undefined && credit_units !== null && String(credit_units).trim() !== '';
    const parsedUnits = hasExplicitUnits ? Number(credit_units) : 3;
    const cleanUnits =
      Number.isFinite(parsedUnits) && parsedUnits >= 0 && parsedUnits <= 12
        ? Math.round(parsedUnits)
        : 3;
    const validCourseType = ['CORE', 'ELECTIVE', 'GENERAL', 'CARRYOVER', 'PRACTICAL'].includes(
      String(course_type || 'CORE').toUpperCase()
    )
      ? String(course_type || 'CORE').toUpperCase()
      : 'CORE';
    const cleanSemesterTag = semester_tag && String(semester_tag).trim() ? String(semester_tag).trim().slice(0, 64) : null;
    const cleanDepartment = department && String(department).trim() ? String(department).trim() : null;

    await execWrite(
      `INSERT INTO subjects (id, school_id, name, code, department, class_id, credit_units, course_type, semester_tag, status, is_deleted, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      `INSERT INTO subjects (id, school_id, name, code, department, class_id, credit_units, course_type, semester_tag, status, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, credit_units = excluded.credit_units, course_type = excluded.course_type, semester_tag = excluded.semester_tag`,
      [id, schoolId, cleanName, cleanCode, cleanDepartment, cleanClassId, cleanUnits, validCourseType, cleanSemesterTag, validStatus]
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'CREATE_SUBJECT',
      entity: 'SUBJECT',
      entityId: id,
      metadata: { name: cleanName, code: cleanCode, credit_units: cleanUnits, course_type: validCourseType, class_id: cleanClassId },
    });

    const subject = await dbGet(
      `SELECT sub.*, c.name as class_name FROM subjects sub LEFT JOIN classes c ON sub.class_id = c.id WHERE sub.id = $1`,
      `SELECT sub.*, c.name as class_name FROM subjects sub LEFT JOIN classes c ON sub.class_id = c.id WHERE sub.id = ?`,
      [id]
    );
    return res.status(201).json({ success: true, subject });
  }
);

performanceRouter.put(
  '/subjects/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const body = req.body || {};
    const { name, code, department, class_id, status, credit_units, course_type, semester_tag } = body;

    const existing = await dbGet(
      `SELECT * FROM subjects WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM subjects WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Subject not found.' });
    }

    const nextName = name !== undefined && String(name).trim() ? String(name).trim() : existing.name;
    const nextCode = code !== undefined && String(code).trim() ? String(code).trim().toUpperCase().slice(0, 24) : existing.code;
    const nextDepartment = Object.prototype.hasOwnProperty.call(body, 'department')
      ? (department && String(department).trim() ? String(department).trim() : null)
      : existing.department;
    const nextClassId = Object.prototype.hasOwnProperty.call(body, 'class_id')
      ? (class_id && String(class_id).trim() ? String(class_id).trim() : null)
      : existing.class_id;
    const nextSemesterTag = Object.prototype.hasOwnProperty.call(body, 'semester_tag')
      ? (semester_tag && String(semester_tag).trim() ? String(semester_tag).trim().slice(0, 64) : null)
      : existing.semester_tag || null;
    const nextCourseType = course_type !== undefined && ['CORE', 'ELECTIVE', 'GENERAL', 'CARRYOVER', 'PRACTICAL'].includes(String(course_type).toUpperCase())
      ? String(course_type).toUpperCase()
      : (existing.course_type || 'CORE');
    const nextStatus = status === 'INACTIVE' ? 'INACTIVE' : status === 'ACTIVE' ? 'ACTIVE' : (existing.status || 'ACTIVE');

    let nextUnits = existing.credit_units !== null && existing.credit_units !== undefined ? Number(existing.credit_units) : 3;
    if (Object.prototype.hasOwnProperty.call(body, 'credit_units') && credit_units !== null && credit_units !== undefined && String(credit_units).trim() !== '') {
      const parsedUnits = Number(credit_units);
      if (!Number.isFinite(parsedUnits) || parsedUnits < 0 || parsedUnits > 12) {
        return res.status(400).json({
          error: 'INVALID_CREDIT_UNITS',
          message: 'Credit units must be a whole number between 0 and 12.',
        });
      }
      nextUnits = Math.round(parsedUnits);
    }

    await execWrite(
      `UPDATE subjects
       SET name = $1, code = $2, department = $3, class_id = $4, credit_units = $5,
           course_type = $6, semester_tag = $7, status = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND school_id = $10`,
      `UPDATE subjects
       SET name = ?, code = ?, department = ?, class_id = ?, credit_units = ?,
           course_type = ?, semester_tag = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [nextName, nextCode, nextDepartment, nextClassId, nextUnits, nextCourseType, nextSemesterTag, nextStatus, id, schoolId]
    );

    const subject = await dbGet(
      `SELECT sub.*, c.name as class_name FROM subjects sub LEFT JOIN classes c ON sub.class_id = c.id WHERE sub.id = $1`,
      `SELECT sub.*, c.name as class_name FROM subjects sub LEFT JOIN classes c ON sub.class_id = c.id WHERE sub.id = ?`,
      [id]
    );
    return res.json({ success: true, subject });
  }
);

performanceRouter.delete(
  '/subjects/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const existing = await dbGet(
      `SELECT * FROM subjects WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM subjects WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Subject not found.' });
    }

    await execWrite(
      `UPDATE subjects SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
      `UPDATE subjects SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );

    return res.json({ success: true, message: 'Subject archived.' });
  }
);

// ==============================================================================
// 4. EXAMINATIONS & RESULT WORKFLOW (DRAFT -> REVIEW -> APPROVED -> PUBLISHED)
// ==============================================================================

performanceRouter.get(
  '/examinations',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { academic_session_id, term_id, class_id, status } = req.query as Record<string, string>;

    let pgSql = `
      SELECT ex.*,
             ses.name as session_name,
             t.name as term_name,
             c.name as class_name,
             (SELECT COUNT(*) FROM student_scores ss WHERE ss.examination_id = ex.id) as scores_count
      FROM examinations ex
      LEFT JOIN academic_sessions ses ON ex.academic_session_id = ses.id
      LEFT JOIN terms t ON ex.term_id = t.id
      LEFT JOIN classes c ON ex.class_id = c.id
      WHERE ex.school_id = $1 AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
    `;
    let sqSql = `
      SELECT ex.*,
             ses.name as session_name,
             t.name as term_name,
             c.name as class_name,
             (SELECT COUNT(*) FROM student_scores ss WHERE ss.examination_id = ex.id) as scores_count
      FROM examinations ex
      LEFT JOIN academic_sessions ses ON ex.academic_session_id = ses.id
      LEFT JOIN terms t ON ex.term_id = t.id
      LEFT JOIN classes c ON ex.class_id = c.id
      WHERE ex.school_id = ? AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
    `;
    const params: any[] = [schoolId];
    let idx = 2;
    if (academic_session_id) {
      pgSql += ` AND ex.academic_session_id = $${idx++}`;
      sqSql += ` AND ex.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      pgSql += ` AND ex.term_id = $${idx++}`;
      sqSql += ` AND ex.term_id = ?`;
      params.push(term_id);
    }
    if (class_id) {
      pgSql += ` AND ex.class_id = $${idx++}`;
      sqSql += ` AND ex.class_id = ?`;
      params.push(class_id);
    }
    if (status) {
      pgSql += ` AND ex.status = $${idx++}`;
      sqSql += ` AND ex.status = ?`;
      params.push(status);
    }
    pgSql += ' ORDER BY ex.created_at DESC';
    sqSql += ' ORDER BY ex.created_at DESC';

    const examinations = await dbAll(pgSql, sqSql, params);
    return res.json({ success: true, count: examinations.length, examinations });
  }
);

performanceRouter.post(
  '/examinations',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      title,
      exam_type = 'TERMLY',
      academic_session_id,
      term_id,
      class_id,
      ca_max_score,
      exam_max_score,
      component_weights_json,
    } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'MISSING_TITLE', message: 'Examination title is required.' });
    }

    const settings = await getSchoolAcademicSettings(schoolId);
    const caMax = ca_max_score !== undefined ? Number(ca_max_score) : settings.ca_max_score;
    const examMax = exam_max_score !== undefined ? Number(exam_max_score) : settings.exam_max_score;
    const totalMax = caMax + examMax;
    if (caMax < 0 || examMax < 0 || totalMax <= 0) {
      return res.status(400).json({ error: 'INVALID_WEIGHTS', message: 'Exam max scores must be positive.' });
    }

    const id = newId('exm');
    await execWrite(
      `INSERT INTO examinations (
         id, school_id, academic_session_id, term_id, class_id, title, exam_type,
         ca_max_score, exam_max_score, total_max_score, component_weights_json,
         status, created_by, is_deleted, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      `INSERT INTO examinations (
         id, school_id, academic_session_id, term_id, class_id, title, exam_type,
         ca_max_score, exam_max_score, total_max_score, component_weights_json,
         status, created_by, is_deleted, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        schoolId,
        academic_session_id || null,
        term_id || null,
        class_id || null,
        title.trim(),
        exam_type,
        caMax,
        examMax,
        totalMax,
        component_weights_json ? (typeof component_weights_json === 'string' ? component_weights_json : JSON.stringify(component_weights_json)) : null,
        req.user!.id,
      ]
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'CREATE_EXAMINATION',
      entity: 'EXAMINATION',
      entityId: id,
      metadata: { title: title.trim(), caMax, examMax },
    });

    const exam = await dbGet(`SELECT * FROM examinations WHERE id = $1`, `SELECT * FROM examinations WHERE id = ?`, [id]);
    return res.status(201).json({ success: true, examination: exam });
  }
);

performanceRouter.put(
  '/examinations/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const exam = await dbGet(
      `SELECT * FROM examinations WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM examinations WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Examination not found.' });
    }
    const { title, exam_type, class_id, academic_session_id, term_id } = req.body || {};
    await execWrite(
      `UPDATE examinations
       SET title = COALESCE($1, title), exam_type = COALESCE($2, exam_type),
           class_id = COALESCE($3, class_id), academic_session_id = COALESCE($4, academic_session_id),
           term_id = COALESCE($5, term_id), updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND school_id = $7`,
      `UPDATE examinations
       SET title = COALESCE(?, title), exam_type = COALESCE(?, exam_type),
           class_id = COALESCE(?, class_id), academic_session_id = COALESCE(?, academic_session_id),
           term_id = COALESCE(?, term_id), updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [title?.trim() || null, exam_type || null, class_id ?? null, academic_session_id ?? null, term_id ?? null, id, schoolId]
    );

    const updated = await dbGet(`SELECT * FROM examinations WHERE id = $1`, `SELECT * FROM examinations WHERE id = ?`, [id]);
    return res.json({ success: true, examination: updated });
  }
);

performanceRouter.delete(
  '/examinations/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const exam = await dbGet(
      `SELECT * FROM examinations WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM examinations WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!exam) return res.status(404).json({ error: 'NOT_FOUND', message: 'Examination not found.' });
    if (exam.status === 'PUBLISHED') {
      return res.status(409).json({
        error: 'CANNOT_DELETE_PUBLISHED_EXAM',
        message: 'Published examinations cannot be deleted to preserve academic audit history.',
      });
    }

    await execWrite(
      `UPDATE examinations SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
      `UPDATE examinations SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return res.json({ success: true, message: 'Examination deleted.' });
  }
);

performanceRouter.post(
  '/examinations/:examId/status',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { examId } = req.params;
    const { status } = req.body || {};
    const allowedStatuses = ['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'INVALID_STATUS', message: 'Status must be DRAFT, REVIEW, APPROVED, or PUBLISHED.' });
    }

    const exam = await dbGet(
      `SELECT * FROM examinations WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT * FROM examinations WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Examination not found.' });
    }

    const settings = await getSchoolAcademicSettings(schoolId);
    if (
      settings.require_review_before_approve &&
      exam.status === 'DRAFT' &&
      (status === 'APPROVED' || status === 'PUBLISHED')
    ) {
      return res.status(400).json({
        error: 'REVIEW_REQUIRED',
        message: 'School policy requires moving examination from DRAFT to REVIEW before approving or publishing.',
      });
    }

    const now = new Date().toISOString();
    if (status === 'REVIEW') {
      await execWrite(
        `UPDATE examinations SET status = $1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND school_id = $4`,
        `UPDATE examinations SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
        ['REVIEW', req.user!.id, examId, schoolId],
        ['REVIEW', req.user!.id, now, examId, schoolId]
      );
      await execWrite(
        `UPDATE student_scores SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE examination_id = $2 AND school_id = $3`,
        `UPDATE student_scores SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE examination_id = ? AND school_id = ?`,
        ['REVIEW', examId, schoolId]
      );
    } else if (status === 'APPROVED') {
      await execWrite(
        `UPDATE examinations SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND school_id = $4`,
        `UPDATE examinations SET status = ?, approved_by = ?, approved_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
        ['APPROVED', req.user!.id, examId, schoolId],
        ['APPROVED', req.user!.id, now, examId, schoolId]
      );
      await execWrite(
        `UPDATE student_scores SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE examination_id = $3 AND school_id = $4`,
        `UPDATE student_scores SET status = ?, approved_by = ?, approved_at = ?, updated_at = CURRENT_TIMESTAMP WHERE examination_id = ? AND school_id = ?`,
        ['APPROVED', req.user!.id, examId, schoolId],
        ['APPROVED', req.user!.id, now, examId, schoolId]
      );
    } else if (status === 'PUBLISHED') {
      await execWrite(
        `UPDATE examinations SET status = $1, published_by = $2, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND school_id = $4`,
        `UPDATE examinations SET status = ?, published_by = ?, published_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
        ['PUBLISHED', req.user!.id, examId, schoolId],
        ['PUBLISHED', req.user!.id, now, examId, schoolId]
      );
      await execWrite(
        `UPDATE student_scores SET status = $1, published_by = $2, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE examination_id = $3 AND school_id = $4`,
        `UPDATE student_scores SET status = ?, published_by = ?, published_at = ?, updated_at = CURRENT_TIMESTAMP WHERE examination_id = ? AND school_id = ?`,
        ['PUBLISHED', req.user!.id, examId, schoolId],
        ['PUBLISHED', req.user!.id, now, examId, schoolId]
      );
    } else {
      await execWrite(
        `UPDATE examinations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3`,
        `UPDATE examinations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
        ['DRAFT', examId, schoolId]
      );
      await execWrite(
        `UPDATE student_scores SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE examination_id = $2 AND school_id = $3`,
        `UPDATE student_scores SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE examination_id = ? AND school_id = ?`,
        ['DRAFT', examId, schoolId]
      );
    }

    if (status === 'PUBLISHED') {
      const scoredStudents = await dbAll(
        `SELECT DISTINCT student_id FROM student_scores WHERE examination_id = $1 AND school_id = $2`,
        `SELECT DISTINCT student_id FROM student_scores WHERE examination_id = ? AND school_id = ?`,
        [examId, schoolId]
      );
      for (const row of scoredStudents) {
        notificationService.notifyParentsOfStudent(
          schoolId,
          row.student_id,
          'SYSTEM',
          `Results Published: ${exam.title}`,
          `Official assessment results for "${exam.title}" have been published on the Parent Portal.`,
          { eventType: 'RESULT_PUBLISHED', examinationId: examId }
        );
        notificationService.notifyStudent(
          schoolId,
          row.student_id,
          'SYSTEM',
          `Results Published: ${exam.title}`,
          `Your assessment results for "${exam.title}" are now available.`,
          { eventType: 'RESULT_PUBLISHED', examinationId: examId }
        );
      }
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'EXAM_STATUS_TRANSITION',
      entity: 'EXAMINATION',
      entityId: examId,
      metadata: { from: exam.status, to: status },
    });

    const updated = await dbGet(`SELECT * FROM examinations WHERE id = $1`, `SELECT * FROM examinations WHERE id = ?`, [examId]);
    return res.json({ success: true, message: `Examination transitioned to ${status}.`, examination: updated });
  }
);

// ==============================================================================
// 5. SCORES ENTRY & POST-PUBLICATION AUDITED CORRECTIONS
// ==============================================================================

performanceRouter.get(
  '/examinations/:examId/scores',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { examId } = req.params;
    const { subject_id, class_id } = req.query as Record<string, string>;

    const exam = await dbGet(
      `SELECT ex.*, ses.name as session_name, t.name as term_name, c.name as class_name
       FROM examinations ex
       LEFT JOIN academic_sessions ses ON ex.academic_session_id = ses.id
       LEFT JOIN terms t ON ex.term_id = t.id
       LEFT JOIN classes c ON ex.class_id = c.id
       WHERE ex.id = $1 AND ex.school_id = $2 AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)`,
      `SELECT ex.*, ses.name as session_name, t.name as term_name, c.name as class_name
       FROM examinations ex
       LEFT JOIN academic_sessions ses ON ex.academic_session_id = ses.id
       LEFT JOIN terms t ON ex.term_id = t.id
       LEFT JOIN classes c ON ex.class_id = c.id
       WHERE ex.id = ? AND ex.school_id = ? AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!exam) return res.status(404).json({ error: 'NOT_FOUND', message: 'Examination not found.' });

    const effectiveClassId = class_id || exam.class_id || null;
    const roster = await dbAll(
      `SELECT id, admission_number, full_name, class_id, class_name
       FROM students
       WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
         ${effectiveClassId ? 'AND class_id = $2' : ''}
       ORDER BY full_name ASC`,
      `SELECT id, admission_number, full_name, class_id, class_name
       FROM students
       WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
         ${effectiveClassId ? 'AND class_id = ?' : ''}
       ORDER BY full_name ASC`,
      effectiveClassId ? [schoolId, effectiveClassId] : [schoolId]
    );

    const scoreParams: any[] = [schoolId, examId];
    let scorePg = `
      SELECT ss.*, s.full_name as student_name, s.admission_number, sub.name as subject_name, sub.code as subject_code
      FROM student_scores ss
      JOIN students s ON ss.student_id = s.id
      JOIN subjects sub ON ss.subject_id = sub.id
      WHERE ss.school_id = $1 AND ss.examination_id = $2
    `;
    let scoreSq = `
      SELECT ss.*, s.full_name as student_name, s.admission_number, sub.name as subject_name, sub.code as subject_code
      FROM student_scores ss
      JOIN students s ON ss.student_id = s.id
      JOIN subjects sub ON ss.subject_id = sub.id
      WHERE ss.school_id = ? AND ss.examination_id = ?
    `;
    if (subject_id) {
      scorePg += ' AND ss.subject_id = $3';
      scoreSq += ' AND ss.subject_id = ?';
      scoreParams.push(subject_id);
    }
    scorePg += ' ORDER BY s.full_name ASC, sub.name ASC';
    scoreSq += ' ORDER BY s.full_name ASC, sub.name ASC';

    const scores = await dbAll(scorePg, scoreSq, scoreParams);

    const corrections = await dbAll(
      `SELECT scl.*, s.full_name as student_name, sub.name as subject_name
       FROM score_correction_logs scl
       JOIN students s ON scl.student_id = s.id
       JOIN subjects sub ON scl.subject_id = sub.id
       WHERE scl.school_id = $1 AND scl.examination_id = $2
       ORDER BY scl.created_at DESC
       LIMIT 50`,
      `SELECT scl.*, s.full_name as student_name, sub.name as subject_name
       FROM score_correction_logs scl
       JOIN students s ON scl.student_id = s.id
       JOIN subjects sub ON scl.subject_id = sub.id
       WHERE scl.school_id = ? AND scl.examination_id = ?
       ORDER BY scl.created_at DESC
       LIMIT 50`,
      [schoolId, examId]
    );

    return res.json({ success: true, examination: exam, roster, scores, corrections });
  }
);

performanceRouter.put(
  '/examinations/:examId/scores',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { examId } = req.params;
    const { entries } = req.body || {};

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'MISSING_ENTRIES', message: 'Score entries array is required.' });
    }

    const exam = await dbGet(
      `SELECT * FROM examinations WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT * FROM examinations WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!exam) return res.status(404).json({ error: 'NOT_FOUND', message: 'Examination not found.' });

    if (exam.status === 'PUBLISHED') {
      return res.status(409).json({
        error: 'PUBLISHED_EXAM_LOCKED',
        message: 'Published exam scores cannot be overwritten directly. Use the audited post-publication correction endpoint with a mandatory reason.',
      });
    }

    const settings = await getSchoolAcademicSettings(schoolId);
    const caMax = Number(exam.ca_max_score ?? settings.ca_max_score);
    const examMax = Number(exam.exam_max_score ?? settings.exam_max_score);
    const totalMax = Number(exam.total_max_score ?? caMax + examMax);

    const savedScores: any[] = [];
    for (const item of entries) {
      const { student_id, subject_id, ca_score, exam_score, component_scores_json, subject_remark } = item || {};
      if (!student_id || !subject_id) {
        return res.status(400).json({ error: 'INVALID_ENTRY', message: 'Each score entry requires student_id and subject_id.' });
      }

      const stu = await dbGet(
        `SELECT id, class_id FROM students WHERE id = $1 AND school_id = $2`,
        `SELECT id, class_id FROM students WHERE id = ? AND school_id = ?`,
        [student_id, schoolId]
      );
      const subj = await dbGet(
        `SELECT id FROM subjects WHERE id = $1 AND school_id = $2`,
        `SELECT id FROM subjects WHERE id = ? AND school_id = ?`,
        [subject_id, schoolId]
      );
      if (!stu || !subj) {
        return res.status(404).json({ error: 'INVALID_REFERENCE', message: 'Student or subject not found in this school.' });
      }

      const caVal = ca_score === null || ca_score === undefined || ca_score === '' ? null : Number(ca_score);
      const exVal = exam_score === null || exam_score === undefined || exam_score === '' ? null : Number(exam_score);
      if (caVal !== null && (Number.isNaN(caVal) || caVal < 0 || caVal > caMax)) {
        return res.status(400).json({ error: 'INVALID_CA_SCORE', message: `CA score must be between 0 and ${caMax}.` });
      }
      if (exVal !== null && (Number.isNaN(exVal) || exVal < 0 || exVal > examMax)) {
        return res.status(400).json({ error: 'INVALID_EXAM_SCORE', message: `Exam score must be between 0 and ${examMax}.` });
      }

      const hasScore = caVal !== null || exVal !== null;
      const totalVal = hasScore ? Math.round(((caVal || 0) + (exVal || 0)) * 100) / 100 : null;
      const gradeInfo = computeGrade(totalVal, totalMax, settings.grading_scale);

      const scoreId = newId('scr');
      const compJson = component_scores_json
        ? typeof component_scores_json === 'string'
          ? component_scores_json
          : JSON.stringify(component_scores_json)
        : null;

      await execWrite(
        `INSERT INTO student_scores (
           id, school_id, examination_id, student_id, class_id, subject_id, academic_session_id, term_id,
           ca_score, exam_score, component_scores_json, total_score, grade, grade_remark, subject_remark,
           status, entered_by, updated_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (examination_id, student_id, subject_id) DO UPDATE SET
           ca_score = EXCLUDED.ca_score,
           exam_score = EXCLUDED.exam_score,
           component_scores_json = EXCLUDED.component_scores_json,
           total_score = EXCLUDED.total_score,
           grade = EXCLUDED.grade,
           grade_remark = EXCLUDED.grade_remark,
           subject_remark = COALESCE(EXCLUDED.subject_remark, student_scores.subject_remark),
           status = EXCLUDED.status,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        `INSERT INTO student_scores (
           id, school_id, examination_id, student_id, class_id, subject_id, academic_session_id, term_id,
           ca_score, exam_score, component_scores_json, total_score, grade, grade_remark, subject_remark,
           status, entered_by, updated_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(examination_id, student_id, subject_id) DO UPDATE SET
           ca_score = excluded.ca_score,
           exam_score = excluded.exam_score,
           component_scores_json = excluded.component_scores_json,
           total_score = excluded.total_score,
           grade = excluded.grade,
           grade_remark = excluded.grade_remark,
           subject_remark = COALESCE(excluded.subject_remark, student_scores.subject_remark),
           status = excluded.status,
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        [
          scoreId,
          schoolId,
          examId,
          student_id,
          exam.class_id || stu.class_id || null,
          subject_id,
          exam.academic_session_id || null,
          exam.term_id || null,
          caVal,
          exVal,
          compJson,
          totalVal,
          gradeInfo.grade,
          gradeInfo.remark,
          subject_remark || null,
          exam.status,
          req.user!.id,
        ]
      );

      const saved = await dbGet(
        `SELECT * FROM student_scores WHERE examination_id = $1 AND student_id = $2 AND subject_id = $3`,
        `SELECT * FROM student_scores WHERE examination_id = ? AND student_id = ? AND subject_id = ?`,
        [examId, student_id, subject_id]
      );
      if (saved) savedScores.push(saved);
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'UPSERT_EXAM_SCORES',
      entity: 'STUDENT_SCORE',
      entityId: examId,
      metadata: { entriesCount: savedScores.length },
    });

    return res.json({ success: true, savedCount: savedScores.length, scores: savedScores });
  }
);

performanceRouter.post(
  '/scores/:scoreId/correct',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { scoreId } = req.params;
    const { ca_score, exam_score, subject_remark, reason } = req.body || {};

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({
        error: 'REASON_REQUIRED',
        message: 'A detailed correction reason (minimum 5 characters) is mandatory for audited score corrections.',
      });
    }

    const existing = await dbGet(
      `SELECT * FROM student_scores WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM student_scores WHERE id = ? AND school_id = ?`,
      [scoreId, schoolId]
    );
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Score record not found.' });

    const exam = await dbGet(
      `SELECT * FROM examinations WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM examinations WHERE id = ? AND school_id = ?`,
      [existing.examination_id, schoolId]
    );
    const settings = await getSchoolAcademicSettings(schoolId);
    const caMax = Number(exam?.ca_max_score ?? settings.ca_max_score);
    const examMax = Number(exam?.exam_max_score ?? settings.exam_max_score);
    const totalMax = Number(exam?.total_max_score ?? caMax + examMax);

    const newCa = ca_score !== undefined ? (ca_score === null ? null : Number(ca_score)) : existing.ca_score;
    const newEx = exam_score !== undefined ? (exam_score === null ? null : Number(exam_score)) : existing.exam_score;

    if (newCa !== null && (Number.isNaN(newCa) || newCa < 0 || newCa > caMax)) {
      return res.status(400).json({ error: 'INVALID_CA_SCORE', message: `CA score must be between 0 and ${caMax}.` });
    }
    if (newEx !== null && (Number.isNaN(newEx) || newEx < 0 || newEx > examMax)) {
      return res.status(400).json({ error: 'INVALID_EXAM_SCORE', message: `Exam score must be between 0 and ${examMax}.` });
    }

    const newTotal = newCa !== null || newEx !== null ? Math.round(((newCa || 0) + (newEx || 0)) * 100) / 100 : null;
    const gradeInfo = computeGrade(newTotal, totalMax, settings.grading_scale);
    const logId = newId('scl');

    await execWrite(
      `INSERT INTO score_correction_logs (
         id, school_id, score_id, examination_id, student_id, subject_id,
         previous_ca_score, new_ca_score, previous_exam_score, new_exam_score,
         previous_total, new_total, previous_grade, new_grade, reason, corrected_by, corrected_by_email, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)`,
      `INSERT INTO score_correction_logs (
         id, school_id, score_id, examination_id, student_id, subject_id,
         previous_ca_score, new_ca_score, previous_exam_score, new_exam_score,
         previous_total, new_total, previous_grade, new_grade, reason, corrected_by, corrected_by_email, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        logId,
        schoolId,
        scoreId,
        existing.examination_id,
        existing.student_id,
        existing.subject_id,
        existing.ca_score,
        newCa,
        existing.exam_score,
        newEx,
        existing.total_score,
        newTotal,
        existing.grade,
        gradeInfo.grade,
        reason.trim(),
        req.user!.id,
        req.user!.email,
      ]
    );

    await execWrite(
      `UPDATE student_scores
       SET ca_score = $1, exam_score = $2, total_score = $3, grade = $4, grade_remark = $5,
           subject_remark = COALESCE($6, subject_remark), updated_by = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND school_id = $9`,
      `UPDATE student_scores
       SET ca_score = ?, exam_score = ?, total_score = ?, grade = ?, grade_remark = ?,
           subject_remark = COALESCE(?, subject_remark), updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [newCa, newEx, newTotal, gradeInfo.grade, gradeInfo.remark, subject_remark ?? null, req.user!.id, scoreId, schoolId]
    );

    await recalculateStudentReportCardIfPresent(
      schoolId,
      existing.student_id,
      existing.academic_session_id,
      existing.term_id
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'POST_PUBLISH_SCORE_CORRECTION',
      entity: 'STUDENT_SCORE',
      entityId: scoreId,
      metadata: {
        reason: reason.trim(),
        previousTotal: existing.total_score,
        newTotal,
        previousGrade: existing.grade,
        newGrade: gradeInfo.grade,
      },
    });

    const updated = await dbGet(`SELECT * FROM student_scores WHERE id = $1`, `SELECT * FROM student_scores WHERE id = ?`, [scoreId]);
    const correctionLog = await dbGet(`SELECT * FROM score_correction_logs WHERE id = $1`, `SELECT * FROM score_correction_logs WHERE id = ?`, [logId]);
    return res.json({ success: true, message: 'Score corrected with audit trail.', score: updated, correctionLog });
  }
);

performanceRouter.get(
  '/scores/corrections',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const corrections = await dbAll(
      `SELECT scl.*, s.full_name as student_name, s.admission_number, sub.name as subject_name, ex.title as exam_title
       FROM score_correction_logs scl
       JOIN students s ON scl.student_id = s.id
       JOIN subjects sub ON scl.subject_id = sub.id
       JOIN examinations ex ON scl.examination_id = ex.id
       WHERE scl.school_id = $1
       ORDER BY scl.created_at DESC
       LIMIT 100`,
      `SELECT scl.*, s.full_name as student_name, s.admission_number, sub.name as subject_name, ex.title as exam_title
       FROM score_correction_logs scl
       JOIN students s ON scl.student_id = s.id
       JOIN subjects sub ON scl.subject_id = sub.id
       JOIN examinations ex ON scl.examination_id = ex.id
       WHERE scl.school_id = ?
       ORDER BY scl.created_at DESC
       LIMIT 100`,
      [schoolId]
    );
    return res.json({ success: true, corrections });
  }
);

performanceRouter.get(
  '/students/:studentId/performance',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { studentId } = req.params;
    const roleName = getEffectiveRoleName(req);

    const student = await dbGet(
      `SELECT * FROM students WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM students WHERE id = ? AND school_id = ?`,
      [studentId, schoolId]
    );
    if (!student) return res.status(404).json({ error: 'NOT_FOUND', message: 'Student not found.' });

    const scores = await dbAll(
      `SELECT ss.*, ex.title as exam_title, ex.total_max_score, sub.name as subject_name, sub.code as subject_code,
              ses.name as session_name, t.name as term_name
       FROM student_scores ss
       JOIN examinations ex ON ss.examination_id = ex.id
       JOIN subjects sub ON ss.subject_id = sub.id
       LEFT JOIN academic_sessions ses ON ss.academic_session_id = ses.id
       LEFT JOIN terms t ON ss.term_id = t.id
       WHERE ss.school_id = $1 AND ss.student_id = $2 AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
       ORDER BY ss.created_at DESC`,
      `SELECT ss.*, ex.title as exam_title, ex.total_max_score, sub.name as subject_name, sub.code as subject_code,
              ses.name as session_name, t.name as term_name
       FROM student_scores ss
       JOIN examinations ex ON ss.examination_id = ex.id
       JOIN subjects sub ON ss.subject_id = sub.id
       LEFT JOIN academic_sessions ses ON ss.academic_session_id = ses.id
       LEFT JOIN terms t ON ss.term_id = t.id
       WHERE ss.school_id = ? AND ss.student_id = ? AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
       ORDER BY ss.created_at DESC`,
      [schoolId, studentId]
    );

    const attendance = await dbAll(
      `SELECT * FROM attendance_records WHERE school_id = $1 AND student_id = $2 ORDER BY attendance_date DESC LIMIT 120`,
      `SELECT * FROM attendance_records WHERE school_id = ? AND student_id = ? ORDER BY attendance_date DESC LIMIT 120`,
      [schoolId, studentId]
    );

    const behaviour = await dbAll(
      `SELECT * FROM behaviour_records
       WHERE school_id = $1 AND student_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
         ${roleName === 'TEACHER' ? 'AND visible_to_teacher = 1' : ''}
       ORDER BY record_date DESC`,
      `SELECT * FROM behaviour_records
       WHERE school_id = ? AND student_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
         ${roleName === 'TEACHER' ? 'AND visible_to_teacher = 1' : ''}
       ORDER BY record_date DESC`,
      [schoolId, studentId]
    );

    const remarks = await dbAll(
      `SELECT tr.*, ses.name as session_name, t.name as term_name
       FROM teacher_remarks tr
       LEFT JOIN academic_sessions ses ON tr.academic_session_id = ses.id
       LEFT JOIN terms t ON tr.term_id = t.id
       WHERE tr.school_id = $1 AND tr.student_id = $2`,
      `SELECT tr.*, ses.name as session_name, t.name as term_name
       FROM teacher_remarks tr
       LEFT JOIN academic_sessions ses ON tr.academic_session_id = ses.id
       LEFT JOIN terms t ON tr.term_id = t.id
       WHERE tr.school_id = ? AND tr.student_id = ?`,
      [schoolId, studentId]
    );

    const reportCards = await dbAll(
      `SELECT rc.*, ses.name as session_name, t.name as term_name
       FROM report_cards rc
       LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
       LEFT JOIN terms t ON rc.term_id = t.id
       WHERE rc.school_id = $1 AND rc.student_id = $2
       ORDER BY rc.created_at DESC`,
      `SELECT rc.*, ses.name as session_name, t.name as term_name
       FROM report_cards rc
       LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
       LEFT JOIN terms t ON rc.term_id = t.id
       WHERE rc.school_id = ? AND rc.student_id = ?
       ORDER BY rc.created_at DESC`,
      [schoolId, studentId]
    );

    return res.json({ success: true, student, scores, attendance, behaviour, remarks, reportCards });
  }
);

// ==============================================================================
// 6. DIGITAL REPORT CARDS (Generate, Remarks, Approve, Publish & Print Snapshot)
// ==============================================================================

async function buildLiveReportCardBreakdown(schoolId: string, rc: any) {
  const settings = await getSchoolAcademicSettings(schoolId);
  const school = await dbGet(
    `SELECT id, name, type, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = $1`,
    `SELECT id, name, type, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = ?`,
    [schoolId]
  );
  const schoolSettingsRow = await dbGet(
    `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json, current_term
     FROM school_settings WHERE school_id = $1 LIMIT 1`,
    `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json, current_term
     FROM school_settings WHERE school_id = ? LIMIT 1`,
    [schoolId]
  );
  const instProfile = resolveInstitutionProfile(school, schoolSettingsRow);
  const student = await dbGet(`SELECT id, admission_number, full_name, first_name, last_name, gender, class_id, class_name, class_arm_name FROM students WHERE id = $1 AND school_id = $2`, `SELECT id, admission_number, full_name, first_name, last_name, gender, class_id, class_name, class_arm_name FROM students WHERE id = ? AND school_id = ?`, [rc.student_id, schoolId]);
  const session = await dbGet(`SELECT id, name FROM academic_sessions WHERE id = $1`, `SELECT id, name FROM academic_sessions WHERE id = ?`, [rc.academic_session_id]);
  const term = await dbGet(`SELECT id, name FROM terms WHERE id = $1`, `SELECT id, name FROM terms WHERE id = ?`, [rc.term_id]);

  const scores = await dbAll(
    `SELECT ss.*, sub.name as subject_name, sub.code as subject_code, COALESCE(sub.credit_units, 3) as credit_units, ex.total_max_score, ex.ca_max_score, ex.exam_max_score
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     JOIN examinations ex ON ss.examination_id = ex.id
     WHERE ss.school_id = $1 AND ss.student_id = $2 AND ss.academic_session_id = $3 AND ss.term_id = $4
       ${rc.examination_id ? 'AND ss.examination_id = $5' : ''}
     ORDER BY sub.name ASC`,
    `SELECT ss.*, sub.name as subject_name, sub.code as subject_code, COALESCE(sub.credit_units, 3) as credit_units, ex.total_max_score, ex.ca_max_score, ex.exam_max_score
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     JOIN examinations ex ON ss.examination_id = ex.id
     WHERE ss.school_id = ? AND ss.student_id = ? AND ss.academic_session_id = ? AND ss.term_id = ?
       ${rc.examination_id ? 'AND ss.examination_id = ?' : ''}
     ORDER BY sub.name ASC`,
    rc.examination_id
      ? [schoolId, rc.student_id, rc.academic_session_id, rc.term_id, rc.examination_id]
      : [schoolId, rc.student_id, rc.academic_session_id, rc.term_id]
  );

  const attRows = await dbAll(
    `SELECT status FROM attendance_records WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 AND term_id = $4`,
    `SELECT status FROM attendance_records WHERE school_id = ? AND student_id = ? AND academic_session_id = ? AND term_id = ?`,
    [schoolId, rc.student_id, rc.academic_session_id, rc.term_id]
  );

  const attSummary = {
    totalDays: attRows.length,
    present: attRows.filter((a) => a.status === 'PRESENT').length,
    absent: attRows.filter((a) => a.status === 'ABSENT').length,
    late: attRows.filter((a) => a.status === 'LATE').length,
    excused: attRows.filter((a) => a.status === 'EXCUSED').length,
    attendanceRatePct:
      attRows.length > 0
        ? Math.round((attRows.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length / attRows.length) * 1000) / 10
        : 0,
  };

  const behRows = await dbAll(
    `SELECT category, severity, title, record_date FROM behaviour_records
     WHERE school_id = $1 AND student_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       AND (academic_session_id = $3 OR academic_session_id IS NULL)
       AND (term_id = $4 OR term_id IS NULL)
       AND visible_to_parent = 1`,
    `SELECT category, severity, title, record_date FROM behaviour_records
     WHERE school_id = ? AND student_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       AND (academic_session_id = ? OR academic_session_id IS NULL)
       AND (term_id = ? OR term_id IS NULL)
       AND visible_to_parent = 1`,
    [schoolId, rc.student_id, rc.academic_session_id, rc.term_id]
  );

  const behSummary = {
    totalRecords: behRows.length,
    positiveCount: behRows.filter((b) => b.category === 'POSITIVE' || b.category === 'COMMENDATION').length,
    disciplineCount: behRows.filter((b) => b.category === 'DISCIPLINE' || b.category === 'INCIDENT').length,
    highlights: behRows.slice(0, 5),
  };

  const officialRemark = await dbGet(
    `SELECT remark_text, staff_name FROM teacher_remarks
     WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 AND term_id = $4 AND visible_to_parent = 1 LIMIT 1`,
    `SELECT remark_text, staff_name FROM teacher_remarks
     WHERE school_id = ? AND student_id = ? AND academic_session_id = ? AND term_id = ? AND visible_to_parent = 1 LIMIT 1`,
    [schoolId, rc.student_id, rc.academic_session_id, rc.term_id]
  );

  const isGpaMode = instProfile.gradingMode === 'GPA_5' || instProfile.gradingMode === 'GPA_4';
  let totalCreditUnits = 0;
  let totalQualityPoints = 0;

  const compiledSubjects = scores.map((s) => {
    const units = Math.max(1, Math.round(Number(s.credit_units || 3)));
    const maxScore = Number(s.total_max_score) > 0 ? Number(s.total_max_score) : 100;
    const pct = s.total_score !== null && s.total_score !== undefined ? (Number(s.total_score) / maxScore) * 100 : null;
    let gradePoint: number | null = null;
    let qualityPoints: number | null = null;
    let effectiveGrade = s.grade;
    let effectiveRemark = s.grade_remark;
    if (isGpaMode && pct !== null) {
      const band = computeGpaGradeBand(pct, instProfile.gradingMode);
      gradePoint = band.points;
      qualityPoints = Math.round(units * band.points * 100) / 100;
      totalCreditUnits += units;
      totalQualityPoints += qualityPoints;
      effectiveGrade = band.grade;
      effectiveRemark = band.remark;
    }
    return {
      subject_id: s.subject_id,
      subject_name: s.subject_name,
      subject_code: s.subject_code,
      credit_units: units,
      grade_point: gradePoint,
      quality_points: qualityPoints,
      ca_score: s.ca_score,
      exam_score: s.exam_score,
      ca_max_score: s.ca_max_score,
      exam_max_score: s.exam_max_score,
      total_score: s.total_score,
      grade: effectiveGrade,
      grade_remark: effectiveRemark,
      subject_remark: s.subject_remark,
    };
  });

  const computedGpa = isGpaMode && totalCreditUnits > 0
    ? Math.round((totalQualityPoints / totalCreditUnits) * 100) / 100
    : null;
  const academicStanding = computedGpa !== null ? getAcademicClassStanding(computedGpa, instProfile.gradingMode) : null;
  const overallGrade = isGpaMode
    ? (() => {
        const band = computeGpaGradeBand(Number(rc.average_score || 0), instProfile.gradingMode);
        return { grade: band.grade, remark: academicStanding || band.remark };
      })()
    : computeGrade(Number(rc.average_score || 0), 100, settings.grading_scale);

  return {
    reportCardId: rc.id,
    verificationCode: rc.verification_code || `RC-${rc.id.slice(-6).toUpperCase()}`,
    school,
    student,
    sessionName: session?.name || '',
    termName: term?.name || '',
    showClassPosition: Boolean(settings.show_class_position),
    total_score: Number(rc.total_score || 0),
    average_score: Number(rc.average_score || 0),
    subjects_count: Number(rc.subjects_count || scores.length),
    class_position: settings.show_class_position ? rc.class_position : null,
    class_size: settings.show_class_position ? rc.class_size : null,
    gradingMode: instProfile.gradingMode,
    gpa: computedGpa,
    cgpa: computedGpa,
    gpa_scale_max: instProfile.gpaScaleMax,
    total_credit_units: isGpaMode ? totalCreditUnits : null,
    total_grade_points: isGpaMode ? Math.round(totalQualityPoints * 100) / 100 : null,
    academic_standing: academicStanding,
    institution_profile: {
      category: instProfile.category,
      isTertiary: instProfile.isTertiary,
      cycleType: instProfile.cycleType,
      gradingMode: instProfile.gradingMode,
      labels: instProfile.labels,
    },
    overall_grade: overallGrade,
    gradingScale: normalizeGradingScale(settings.grading_scale),
    subjects: compiledSubjects,
    attendance_summary: attSummary,
    behaviour_summary: behSummary,
    teacher_remark: rc.teacher_remark || officialRemark?.remark_text || '',
    teacher_remark_author: officialRemark?.staff_name || '',
    principal_remark: rc.principal_remark || '',
    published_at: rc.published_at || new Date().toISOString(),
  };
}

performanceRouter.get(
  '/report-cards',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { academic_session_id, term_id, class_id, status, student_id } = req.query as Record<string, string>;

    let pgSql = `
      SELECT rc.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
             ses.name as session_name, t.name as term_name
      FROM report_cards rc
      JOIN students s ON rc.student_id = s.id
      LEFT JOIN classes c ON COALESCE(rc.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
      LEFT JOIN terms t ON rc.term_id = t.id
      WHERE rc.school_id = $1
    `;
    let sqSql = `
      SELECT rc.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
             ses.name as session_name, t.name as term_name
      FROM report_cards rc
      JOIN students s ON rc.student_id = s.id
      LEFT JOIN classes c ON COALESCE(rc.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
      LEFT JOIN terms t ON rc.term_id = t.id
      WHERE rc.school_id = ?
    `;
    const params: any[] = [schoolId];
    let idx = 2;
    if (academic_session_id) {
      pgSql += ` AND rc.academic_session_id = $${idx++}`;
      sqSql += ` AND rc.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      pgSql += ` AND rc.term_id = $${idx++}`;
      sqSql += ` AND rc.term_id = ?`;
      params.push(term_id);
    }
    if (class_id) {
      pgSql += ` AND COALESCE(rc.class_id, s.class_id) = $${idx++}`;
      sqSql += ` AND COALESCE(rc.class_id, s.class_id) = ?`;
      params.push(class_id);
    }
    if (status) {
      pgSql += ` AND rc.status = $${idx++}`;
      sqSql += ` AND rc.status = ?`;
      params.push(status);
    }
    if (student_id) {
      pgSql += ` AND rc.student_id = $${idx++}`;
      sqSql += ` AND rc.student_id = ?`;
      params.push(student_id);
    }

    pgSql += ' ORDER BY rc.average_score DESC, s.full_name ASC';
    sqSql += ' ORDER BY rc.average_score DESC, s.full_name ASC';

    const reportCards = await dbAll(pgSql, sqSql, params);
    return res.json({ success: true, count: reportCards.length, reportCards });
  }
);

performanceRouter.get(
  '/report-cards/:id',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
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
    if (!rc) return res.status(404).json({ error: 'NOT_FOUND', message: 'Report card not found.' });

    let breakdown: any = null;
    if (rc.status === 'PUBLISHED' && rc.snapshot_json) {
      try { breakdown = JSON.parse(rc.snapshot_json); } catch {}
    }
    if (!breakdown) {
      breakdown = await buildLiveReportCardBreakdown(schoolId, rc);
    }

    return res.json({ success: true, reportCard: { ...rc, breakdown } });
  }
);

performanceRouter.post(
  '/report-cards/generate',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { academic_session_id, term_id, class_id, examination_id, student_id } = req.body || {};

    if (!academic_session_id || !term_id) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'academic_session_id and term_id are required.' });
    }

    const stuParams: any[] = [schoolId];
    let stuPg = `SELECT * FROM students WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`;
    let stuSq = `SELECT * FROM students WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`;
    if (student_id) {
      stuPg += ' AND id = $2';
      stuSq += ' AND id = ?';
      stuParams.push(student_id);
    } else if (class_id) {
      stuPg += ' AND class_id = $2';
      stuSq += ' AND class_id = ?';
      stuParams.push(class_id);
    }
    const students = await dbAll(stuPg, stuSq, stuParams);
    if (students.length === 0) {
      return res.status(404).json({ error: 'NO_STUDENTS', message: 'No matching active students found.' });
    }

    const settings = await getSchoolAcademicSettings(schoolId);
    const activeSubjects = await dbAll(
      `SELECT id FROM subjects WHERE school_id = $1 AND status = 'ACTIVE' AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT id FROM subjects WHERE school_id = ? AND status = 'ACTIVE' AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [schoolId]
    );

    const computedList: {
      student: any;
      historicalClassId: string | null;
      historicalClassName: string | null;
      totalScore: number;
      averageScore: number;
      subjectsCount: number;
    }[] = [];
    for (const stu of students) {
      const histCls = await resolveHistoricalStudentClass(schoolId, stu.id, academic_session_id, stu);
      const sParams = examination_id
        ? [schoolId, stu.id, academic_session_id, term_id, examination_id]
        : [schoolId, stu.id, academic_session_id, term_id];
      const scores = await dbAll(
        `SELECT ss.total_score, ex.total_max_score
         FROM student_scores ss
         JOIN examinations ex ON ss.examination_id = ex.id
         WHERE ss.school_id = $1 AND ss.student_id = $2 AND ss.academic_session_id = $3 AND ss.term_id = $4
           ${examination_id ? 'AND ss.examination_id = $5' : ''}`,
        `SELECT ss.total_score, ex.total_max_score
         FROM student_scores ss
         JOIN examinations ex ON ss.examination_id = ex.id
         WHERE ss.school_id = ? AND ss.student_id = ? AND ss.academic_session_id = ? AND ss.term_id = ?
           ${examination_id ? 'AND ss.examination_id = ?' : ''}`,
        sParams
      );

      const valid = scores.filter((s) => s.total_score !== null && s.total_score !== undefined);
      const pctSum = valid.reduce((acc, s) => {
        const max = Number(s.total_max_score) > 0 ? Number(s.total_max_score) : 100;
        return acc + (Number(s.total_score) / max) * 100;
      }, 0);
      const totalScore = Math.round(valid.reduce((acc, s) => acc + Number(s.total_score || 0), 0) * 100) / 100;
      const denom =
        settings.missing_score_policy === 'ZERO' && activeSubjects.length > valid.length
          ? activeSubjects.length
          : valid.length;
      const averageScore = denom > 0 ? Math.round((pctSum / denom) * 100) / 100 : 0;

      computedList.push({
        student: stu,
        historicalClassId: histCls.class_id || stu.class_id || null,
        historicalClassName: histCls.class_name || stu.class_name || null,
        totalScore,
        averageScore,
        subjectsCount: valid.length,
      });
    }

    // Group by historical class_id to assign deterministic class ranks
    const classGroups = new Map<string, typeof computedList>();
    for (const item of computedList) {
      const cKey = item.historicalClassId || 'UNASSIGNED';
      if (!classGroups.has(cKey)) classGroups.set(cKey, []);
      classGroups.get(cKey)!.push(item);
    }

    const generated: any[] = [];
    for (const [, group] of classGroups) {
      const sorted = [...group].sort((a, b) => b.averageScore - a.averageScore);
      const classSize = sorted.length;

      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const position = i > 0 && item.averageScore === sorted[i - 1].averageScore ? i : i + 1;
        const rcId = newId('rc');
        const verCode = `RC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const officialRemark = await dbGet(
          `SELECT remark_text FROM teacher_remarks WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 AND term_id = $4 LIMIT 1`,
          `SELECT remark_text FROM teacher_remarks WHERE school_id = ? AND student_id = ? AND academic_session_id = ? AND term_id = ? LIMIT 1`,
          [schoolId, item.student.id, academic_session_id, term_id]
        );

        await execWrite(
          `INSERT INTO report_cards (
             id, school_id, student_id, class_id, academic_session_id, term_id, examination_id,
             status, total_score, average_score, subjects_count, class_position, class_size,
             teacher_remark, verification_code, created_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (school_id, student_id, academic_session_id, term_id) DO UPDATE SET
             class_id = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.class_id ELSE EXCLUDED.class_id END,
             examination_id = COALESCE(EXCLUDED.examination_id, report_cards.examination_id),
             total_score = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.total_score ELSE EXCLUDED.total_score END,
             average_score = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.average_score ELSE EXCLUDED.average_score END,
             subjects_count = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.subjects_count ELSE EXCLUDED.subjects_count END,
             class_position = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.class_position ELSE EXCLUDED.class_position END,
             class_size = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.class_size ELSE EXCLUDED.class_size END,
             teacher_remark = COALESCE(report_cards.teacher_remark, EXCLUDED.teacher_remark),
             updated_at = CURRENT_TIMESTAMP`,
          `INSERT INTO report_cards (
             id, school_id, student_id, class_id, academic_session_id, term_id, examination_id,
             status, total_score, average_score, subjects_count, class_position, class_size,
             teacher_remark, verification_code, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(school_id, student_id, academic_session_id, term_id) DO UPDATE SET
             class_id = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.class_id ELSE excluded.class_id END,
             examination_id = COALESCE(excluded.examination_id, report_cards.examination_id),
             total_score = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.total_score ELSE excluded.total_score END,
             average_score = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.average_score ELSE excluded.average_score END,
             subjects_count = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.subjects_count ELSE excluded.subjects_count END,
             class_position = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.class_position ELSE excluded.class_position END,
             class_size = CASE WHEN report_cards.status = 'PUBLISHED' THEN report_cards.class_size ELSE excluded.class_size END,
             teacher_remark = COALESCE(report_cards.teacher_remark, excluded.teacher_remark),
             updated_at = CURRENT_TIMESTAMP`,
          [
            rcId,
            schoolId,
            item.student.id,
            item.historicalClassId,
            academic_session_id,
            term_id,
            examination_id || null,
            item.totalScore,
            item.averageScore,
            item.subjectsCount,
            position,
            classSize,
            officialRemark?.remark_text || null,
            verCode,
            req.user!.id,
          ]
        );

        const row = await dbGet(
          `SELECT * FROM report_cards WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 AND term_id = $4`,
          `SELECT * FROM report_cards WHERE school_id = ? AND student_id = ? AND academic_session_id = ? AND term_id = ?`,
          [schoolId, item.student.id, academic_session_id, term_id]
        );
        if (row) generated.push({ ...row, class_name: item.historicalClassName });
      }
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'GENERATE_REPORT_CARDS',
      entity: 'REPORT_CARD',
      metadata: { count: generated.length, class_id, academic_session_id, term_id },
    });

    return res.json({ success: true, count: generated.length, reportCards: generated });
  }
);

performanceRouter.put(
  '/report-cards/:id/remarks',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const { teacher_remark, principal_remark, status } = req.body || {};

    const rc = await dbGet(
      `SELECT * FROM report_cards WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM report_cards WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!rc) return res.status(404).json({ error: 'NOT_FOUND', message: 'Report card not found.' });

    const nextStatus =
      status && ['DRAFT', 'REVIEW', 'APPROVED'].includes(status) && rc.status !== 'PUBLISHED' ? status : rc.status;

    if (nextStatus === 'APPROVED') {
      await execWrite(
        `UPDATE report_cards
         SET teacher_remark = COALESCE($1, teacher_remark),
             principal_remark = COALESCE($2, principal_remark),
             status = $3,
             approved_by = $4,
             approved_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5 AND school_id = $6`,
        `UPDATE report_cards
         SET teacher_remark = COALESCE(?, teacher_remark),
             principal_remark = COALESCE(?, principal_remark),
             status = ?,
             approved_by = ?,
             approved_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND school_id = ?`,
        [teacher_remark ?? null, principal_remark ?? null, nextStatus, req.user!.id, id, schoolId]
      );
    } else {
      await execWrite(
        `UPDATE report_cards
         SET teacher_remark = COALESCE($1, teacher_remark),
             principal_remark = COALESCE($2, principal_remark),
             status = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND school_id = $5`,
        `UPDATE report_cards
         SET teacher_remark = COALESCE(?, teacher_remark),
             principal_remark = COALESCE(?, principal_remark),
             status = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND school_id = ?`,
        [teacher_remark ?? null, principal_remark ?? null, nextStatus, id, schoolId]
      );
    }

    const updated = await dbGet(`SELECT * FROM report_cards WHERE id = $1`, `SELECT * FROM report_cards WHERE id = ?`, [id]);
    return res.json({ success: true, reportCard: updated });
  }
);

performanceRouter.post(
  '/report-cards/:id/publish',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const rc = await dbGet(
      `SELECT * FROM report_cards WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM report_cards WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!rc) return res.status(404).json({ error: 'NOT_FOUND', message: 'Report card not found.' });

    const breakdown = await buildLiveReportCardBreakdown(schoolId, rc);
    const snapshotJson = JSON.stringify(breakdown);

    await execWrite(
      `UPDATE report_cards
       SET status = 'PUBLISHED',
           snapshot_json = $1,
           attendance_summary_json = $2,
           behaviour_summary_json = $3,
           published_by = $4,
           published_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND school_id = $6`,
      `UPDATE report_cards
       SET status = 'PUBLISHED',
           snapshot_json = ?,
           attendance_summary_json = ?,
           behaviour_summary_json = ?,
           published_by = ?,
           published_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [
        snapshotJson,
        JSON.stringify(breakdown.attendance_summary),
        JSON.stringify(breakdown.behaviour_summary),
        req.user!.id,
        id,
        schoolId,
      ]
    );

    notificationService.notifyParentsOfStudent(
      schoolId,
      rc.student_id,
      'SYSTEM',
      `Report Card Available: ${breakdown.termName} (${breakdown.sessionName})`,
      `The official digital report card for ${breakdown.student?.full_name || 'your ward'} is now published and ready to print.`,
      { eventType: 'REPORT_CARD_AVAILABLE', reportCardId: id }
    );
    notificationService.notifyStudent(
      schoolId,
      rc.student_id,
      'SYSTEM',
      `Report Card Published: ${breakdown.termName}`,
      `Your official report card for ${breakdown.termName} (${breakdown.sessionName}) has been published.`,
      { eventType: 'REPORT_CARD_AVAILABLE', reportCardId: id }
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'PUBLISH_REPORT_CARD',
      entity: 'REPORT_CARD',
      entityId: id,
      metadata: { studentId: rc.student_id },
    });

    const published = await dbGet(`SELECT * FROM report_cards WHERE id = $1`, `SELECT * FROM report_cards WHERE id = ?`, [id]);
    return res.json({ success: true, message: 'Report card published and snapshot frozen.', reportCard: { ...published, breakdown } });
  }
);

performanceRouter.post(
  '/report-cards/publish-class',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { class_id, academic_session_id, term_id } = req.body || {};
    if (!academic_session_id || !term_id) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'academic_session_id and term_id are required.' });
    }

    const cards = await dbAll(
      `SELECT * FROM report_cards
       WHERE school_id = $1 AND academic_session_id = $2 AND term_id = $3
         ${class_id ? 'AND class_id = $4' : ''}`,
      `SELECT * FROM report_cards
       WHERE school_id = ? AND academic_session_id = ? AND term_id = ?
         ${class_id ? 'AND class_id = ?' : ''}`,
      class_id ? [schoolId, academic_session_id, term_id, class_id] : [schoolId, academic_session_id, term_id]
    );

    let publishedCount = 0;
    for (const rc of cards) {
      const breakdown = await buildLiveReportCardBreakdown(schoolId, rc);
      await execWrite(
        `UPDATE report_cards
         SET status = 'PUBLISHED', snapshot_json = $1, attendance_summary_json = $2, behaviour_summary_json = $3,
             published_by = $4, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $5 AND school_id = $6`,
        `UPDATE report_cards
         SET status = 'PUBLISHED', snapshot_json = ?, attendance_summary_json = ?, behaviour_summary_json = ?,
             published_by = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND school_id = ?`,
        [
          JSON.stringify(breakdown),
          JSON.stringify(breakdown.attendance_summary),
          JSON.stringify(breakdown.behaviour_summary),
          req.user!.id,
          rc.id,
          schoolId,
        ]
      );
      notificationService.notifyParentsOfStudent(
        schoolId,
        rc.student_id,
        'SYSTEM',
        `Report Card Available: ${breakdown.termName}`,
        `The official digital report card for ${breakdown.student?.full_name || 'your ward'} is now published.`,
        { eventType: 'REPORT_CARD_AVAILABLE', reportCardId: rc.id }
      );
      notificationService.notifyStudent(
        schoolId,
        rc.student_id,
        'SYSTEM',
        `Report Card Available: ${breakdown.termName}`,
        `Your official digital report card for ${breakdown.termName} is now published.`,
        { eventType: 'REPORT_CARD_AVAILABLE', reportCardId: rc.id }
      );
      publishedCount++;
    }

    return res.json({ success: true, publishedCount });
  }
);

// On-demand Report Card Compiler for School Staff / Admin / SuperAdmin (Term or Full-Session Cumulative)
performanceRouter.post(
  '/report-cards/compile-preview',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { student_id, report_type = 'TERM', academic_session_id, term_id, examination_id } = req.body || {};

    if (!student_id || !academic_session_id) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'student_id and academic_session_id are required.',
      });
    }

    if (report_type === 'SESSION') {
      const compiled = await compileSessionReportCard(schoolId, student_id, academic_session_id, {
        onlyPublished: false,
        visibilityRole: 'ADMIN',
        forceLive: true,
      });
      if (!compiled) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Student or session record not found.' });
      }
      return res.json({ success: true, source: compiled.source, reportCard: compiled.reportCard });
    }

    if (!term_id) {
      return res.status(400).json({ error: 'MISSING_TERM', message: 'term_id is required for an End-of-Term report card.' });
    }
    const compiled = await compileTermReportCard(schoolId, student_id, academic_session_id, term_id, {
      onlyPublished: false,
      visibilityRole: 'ADMIN',
      examinationId: examination_id || null,
      forceLive: true,
    });
    if (!compiled) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Student record not found.' });
    }
    return res.json({ success: true, source: compiled.source, reportCard: compiled.reportCard });
  }
);

// ==============================================================================
// 6B. FULL-SESSION CUMULATIVE ANNUAL REPORT CARDS (Admin / SuperAdmin Workflow)
// ==============================================================================

performanceRouter.get(
  '/session-report-cards',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { academic_session_id, class_id, status, student_id } = req.query as Record<string, string>;

    let pgSql = `
      SELECT src.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
             ses.name as session_name
      FROM session_report_cards src
      JOIN students s ON src.student_id = s.id
      LEFT JOIN classes c ON COALESCE(src.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
      WHERE src.school_id = $1
    `;
    let sqSql = `
      SELECT src.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
             ses.name as session_name
      FROM session_report_cards src
      JOIN students s ON src.student_id = s.id
      LEFT JOIN classes c ON COALESCE(src.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
      WHERE src.school_id = ?
    `;
    const params: any[] = [schoolId];
    let idx = 2;
    if (academic_session_id) {
      pgSql += ` AND src.academic_session_id = $${idx++}`;
      sqSql += ` AND src.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (class_id) {
      pgSql += ` AND COALESCE(src.class_id, s.class_id) = $${idx++}`;
      sqSql += ` AND COALESCE(src.class_id, s.class_id) = ?`;
      params.push(class_id);
    }
    if (status) {
      pgSql += ` AND src.status = $${idx++}`;
      sqSql += ` AND src.status = ?`;
      params.push(status);
    }
    if (student_id) {
      pgSql += ` AND src.student_id = $${idx++}`;
      sqSql += ` AND src.student_id = ?`;
      params.push(student_id);
    }

    pgSql += ' ORDER BY src.average_score DESC, s.full_name ASC';
    sqSql += ' ORDER BY src.average_score DESC, s.full_name ASC';

    const rows = await dbAll(pgSql, sqSql, params);
    const sessionReportCards = rows.map((r: any) => {
      let term_averages = [];
      try {
        term_averages = r.term_averages_json ? JSON.parse(r.term_averages_json) : [];
      } catch {}
      return { ...r, report_type: 'SESSION', term_averages };
    });

    return res.json({ success: true, count: sessionReportCards.length, sessionReportCards });
  }
);

performanceRouter.get(
  '/session-report-cards/:id',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
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
    if (!src) return res.status(404).json({ error: 'NOT_FOUND', message: 'Session report card not found.' });

    let breakdown: any = null;
    if (src.status === 'PUBLISHED' && src.snapshot_json) {
      try { breakdown = JSON.parse(src.snapshot_json); } catch {}
    }
    if (!breakdown) {
      const compiled = await compileSessionReportCard(schoolId, src.student_id, src.academic_session_id, {
        onlyPublished: false,
        visibilityRole: 'ADMIN',
        forceLive: true,
      });
      breakdown = compiled?.reportCard?.breakdown || null;
    }

    return res.json({
      success: true,
      sessionReportCard: {
        ...src,
        report_type: 'SESSION',
        breakdown,
      },
    });
  }
);

performanceRouter.post(
  '/session-report-cards/generate',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { academic_session_id, class_id, student_id } = req.body || {};

    if (!academic_session_id) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'academic_session_id is required.' });
    }

    const stuParams: any[] = [schoolId];
    let stuPg = `SELECT * FROM students WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`;
    let stuSq = `SELECT * FROM students WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`;
    if (student_id) {
      stuPg += ' AND id = $2';
      stuSq += ' AND id = ?';
      stuParams.push(student_id);
    } else if (class_id) {
      stuPg += ' AND class_id = $2';
      stuSq += ' AND class_id = ?';
      stuParams.push(class_id);
    }
    const students = await dbAll(stuPg, stuSq, stuParams);
    if (students.length === 0) {
      return res.status(404).json({ error: 'NO_STUDENTS', message: 'No matching active students found.' });
    }

    const generated: any[] = [];
    for (const stu of students) {
      const compiled = await compileSessionReportCard(schoolId, stu.id, academic_session_id, {
        onlyPublished: false,
        visibilityRole: 'ADMIN',
        forceLive: true,
      });
      if (!compiled) continue;
      const bd = compiled.reportCard.breakdown;
      const srcId = newId('src');
      const verCode = `SRC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      const histClassId = compiled.reportCard.class_id || stu.class_id || null;
      const histClassName = bd?.student?.class_name || stu.class_name || null;

      await execWrite(
        `INSERT INTO session_report_cards (
           id, school_id, student_id, class_id, academic_session_id,
           status, total_score, average_score, subjects_count, terms_count,
           class_position, class_size, promotion_status, term_averages_json,
           attendance_summary_json, behaviour_summary_json, teacher_remark, verification_code,
           created_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (school_id, student_id, academic_session_id) DO UPDATE SET
           class_id = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.class_id ELSE EXCLUDED.class_id END,
           total_score = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.total_score ELSE EXCLUDED.total_score END,
           average_score = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.average_score ELSE EXCLUDED.average_score END,
           subjects_count = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.subjects_count ELSE EXCLUDED.subjects_count END,
           terms_count = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.terms_count ELSE EXCLUDED.terms_count END,
           class_position = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.class_position ELSE EXCLUDED.class_position END,
           class_size = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.class_size ELSE EXCLUDED.class_size END,
           promotion_status = CASE WHEN session_report_cards.status = 'PUBLISHED' OR (session_report_cards.promotion_status IS NOT NULL AND session_report_cards.promotion_status != 'PENDING') THEN session_report_cards.promotion_status ELSE EXCLUDED.promotion_status END,
           term_averages_json = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.term_averages_json ELSE EXCLUDED.term_averages_json END,
           teacher_remark = COALESCE(session_report_cards.teacher_remark, EXCLUDED.teacher_remark),
           updated_at = CURRENT_TIMESTAMP`,
        `INSERT INTO session_report_cards (
           id, school_id, student_id, class_id, academic_session_id,
           status, total_score, average_score, subjects_count, terms_count,
           class_position, class_size, promotion_status, term_averages_json,
           attendance_summary_json, behaviour_summary_json, teacher_remark, verification_code,
           created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(school_id, student_id, academic_session_id) DO UPDATE SET
           class_id = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.class_id ELSE excluded.class_id END,
           total_score = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.total_score ELSE excluded.total_score END,
           average_score = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.average_score ELSE excluded.average_score END,
           subjects_count = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.subjects_count ELSE excluded.subjects_count END,
           terms_count = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.terms_count ELSE excluded.terms_count END,
           class_position = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.class_position ELSE excluded.class_position END,
           class_size = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.class_size ELSE excluded.class_size END,
           promotion_status = CASE WHEN session_report_cards.status = 'PUBLISHED' OR (session_report_cards.promotion_status IS NOT NULL AND session_report_cards.promotion_status != 'PENDING') THEN session_report_cards.promotion_status ELSE excluded.promotion_status END,
           term_averages_json = CASE WHEN session_report_cards.status = 'PUBLISHED' THEN session_report_cards.term_averages_json ELSE excluded.term_averages_json END,
           teacher_remark = COALESCE(session_report_cards.teacher_remark, excluded.teacher_remark),
           updated_at = CURRENT_TIMESTAMP`,
        [
          srcId,
          schoolId,
          stu.id,
          histClassId,
          academic_session_id,
          bd.total_score,
          bd.average_score,
          bd.subjects_count,
          bd.terms_count,
          bd.class_position,
          bd.class_size,
          bd.promotion_status || 'PENDING',
          JSON.stringify(bd.term_averages || []),
          JSON.stringify(bd.attendance_summary || {}),
          JSON.stringify(bd.behaviour_summary || {}),
          bd.teacher_remark || null,
          verCode,
          req.user!.id,
        ]
      );

      const row = await dbGet(
        `SELECT * FROM session_report_cards WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3`,
        `SELECT * FROM session_report_cards WHERE school_id = ? AND student_id = ? AND academic_session_id = ?`,
        [schoolId, stu.id, academic_session_id]
      );
      if (row) generated.push({ ...row, class_name: histClassName, report_type: 'SESSION' });
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'GENERATE_SESSION_REPORT_CARDS',
      entity: 'SESSION_REPORT_CARD',
      metadata: { count: generated.length, class_id, academic_session_id },
    });

    return res.json({ success: true, count: generated.length, sessionReportCards: generated });
  }
);

performanceRouter.put(
  '/session-report-cards/:id/remarks',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const { teacher_remark, principal_remark, status, promotion_status } = req.body || {};

    const src = await dbGet(
      `SELECT * FROM session_report_cards WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM session_report_cards WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!src) return res.status(404).json({ error: 'NOT_FOUND', message: 'Session report card not found.' });

    const nextStatus =
      status && ['DRAFT', 'REVIEW', 'APPROVED'].includes(status) && src.status !== 'PUBLISHED' ? status : src.status;
    const nextPromotion =
      promotion_status && ['PROMOTED', 'RETAINED', 'PROBATION', 'GRADUATED', 'PENDING'].includes(promotion_status)
        ? promotion_status
        : null;

    if (nextStatus === 'APPROVED') {
      await execWrite(
        `UPDATE session_report_cards
         SET teacher_remark = COALESCE($1, teacher_remark),
             principal_remark = COALESCE($2, principal_remark),
             promotion_status = COALESCE($3, promotion_status),
             status = $4,
             approved_by = $5,
             approved_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6 AND school_id = $7`,
        `UPDATE session_report_cards
         SET teacher_remark = COALESCE(?, teacher_remark),
             principal_remark = COALESCE(?, principal_remark),
             promotion_status = COALESCE(?, promotion_status),
             status = ?,
             approved_by = ?,
             approved_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND school_id = ?`,
        [teacher_remark ?? null, principal_remark ?? null, nextPromotion, nextStatus, req.user!.id, id, schoolId]
      );
    } else {
      await execWrite(
        `UPDATE session_report_cards
         SET teacher_remark = COALESCE($1, teacher_remark),
             principal_remark = COALESCE($2, principal_remark),
             promotion_status = COALESCE($3, promotion_status),
             status = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5 AND school_id = $6`,
        `UPDATE session_report_cards
         SET teacher_remark = COALESCE(?, teacher_remark),
             principal_remark = COALESCE(?, principal_remark),
             promotion_status = COALESCE(?, promotion_status),
             status = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND school_id = ?`,
        [teacher_remark ?? null, principal_remark ?? null, nextPromotion, nextStatus, id, schoolId]
      );
    }

    const updated = await dbGet(
      `SELECT * FROM session_report_cards WHERE id = $1`,
      `SELECT * FROM session_report_cards WHERE id = ?`,
      [id]
    );
    return res.json({ success: true, sessionReportCard: { ...updated, report_type: 'SESSION' } });
  }
);

performanceRouter.post(
  '/session-report-cards/:id/publish',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const src = await dbGet(
      `SELECT * FROM session_report_cards WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM session_report_cards WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!src) return res.status(404).json({ error: 'NOT_FOUND', message: 'Session report card not found.' });

    const compiled = await compileSessionReportCard(schoolId, src.student_id, src.academic_session_id, {
      onlyPublished: false,
      visibilityRole: 'ADMIN',
      forceLive: true,
    });
    if (!compiled) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Unable to compile session breakdown.' });
    }
    const breakdown = {
      ...compiled.reportCard.breakdown,
      reportCardId: id,
      verificationCode: src.verification_code || compiled.reportCard.breakdown.verificationCode,
      teacher_remark: src.teacher_remark || compiled.reportCard.breakdown.teacher_remark,
      principal_remark: src.principal_remark || compiled.reportCard.breakdown.principal_remark,
      promotion_status: src.promotion_status || compiled.reportCard.breakdown.promotion_status,
    };

    await execWrite(
      `UPDATE session_report_cards
       SET status = 'PUBLISHED',
           total_score = $1,
           average_score = $2,
           subjects_count = $3,
           terms_count = $4,
           term_averages_json = $5,
           snapshot_json = $6,
           attendance_summary_json = $7,
           behaviour_summary_json = $8,
           published_by = $9,
           published_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10 AND school_id = $11`,
      `UPDATE session_report_cards
       SET status = 'PUBLISHED',
           total_score = ?,
           average_score = ?,
           subjects_count = ?,
           terms_count = ?,
           term_averages_json = ?,
           snapshot_json = ?,
           attendance_summary_json = ?,
           behaviour_summary_json = ?,
           published_by = ?,
           published_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [
        breakdown.total_score,
        breakdown.average_score,
        breakdown.subjects_count,
        breakdown.terms_count,
        JSON.stringify(breakdown.term_averages || []),
        JSON.stringify(breakdown),
        JSON.stringify(breakdown.attendance_summary || {}),
        JSON.stringify(breakdown.behaviour_summary || {}),
        req.user!.id,
        id,
        schoolId,
      ]
    );

    notificationService.notifyParentsOfStudent(
      schoolId,
      src.student_id,
      'SYSTEM',
      `Annual Session Report Card Published: ${breakdown.sessionName}`,
      `The full-session cumulative report card for ${breakdown.student?.full_name || 'your ward'} (${breakdown.sessionName}) is now published.`,
      { eventType: 'SESSION_REPORT_CARD_AVAILABLE', sessionReportCardId: id }
    );
    notificationService.notifyStudent(
      schoolId,
      src.student_id,
      'SYSTEM',
      `Annual Session Report Card Published: ${breakdown.sessionName}`,
      `Your full-session cumulative report card for ${breakdown.sessionName} has been published.`,
      { eventType: 'SESSION_REPORT_CARD_AVAILABLE', sessionReportCardId: id }
    );

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'PUBLISH_SESSION_REPORT_CARD',
      entity: 'SESSION_REPORT_CARD',
      entityId: id,
      metadata: { studentId: src.student_id, sessionId: src.academic_session_id },
    });

    const published = await dbGet(
      `SELECT * FROM session_report_cards WHERE id = $1`,
      `SELECT * FROM session_report_cards WHERE id = ?`,
      [id]
    );
    return res.json({
      success: true,
      message: 'Session cumulative report card published.',
      sessionReportCard: { ...published, report_type: 'SESSION', breakdown },
    });
  }
);

performanceRouter.post(
  '/session-report-cards/publish-class',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { class_id, academic_session_id } = req.body || {};
    if (!academic_session_id) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'academic_session_id is required.' });
    }

    const cards = await dbAll(
      `SELECT * FROM session_report_cards
       WHERE school_id = $1 AND academic_session_id = $2
         ${class_id ? 'AND class_id = $3' : ''}`,
      `SELECT * FROM session_report_cards
       WHERE school_id = ? AND academic_session_id = ?
         ${class_id ? 'AND class_id = ?' : ''}`,
      class_id ? [schoolId, academic_session_id, class_id] : [schoolId, academic_session_id]
    );

    let publishedCount = 0;
    for (const src of cards) {
      const compiled = await compileSessionReportCard(schoolId, src.student_id, src.academic_session_id, {
        onlyPublished: false,
        visibilityRole: 'ADMIN',
        forceLive: true,
      });
      if (!compiled) continue;
      const breakdown = {
        ...compiled.reportCard.breakdown,
        reportCardId: src.id,
        verificationCode: src.verification_code || compiled.reportCard.breakdown.verificationCode,
        teacher_remark: src.teacher_remark || compiled.reportCard.breakdown.teacher_remark,
        principal_remark: src.principal_remark || compiled.reportCard.breakdown.principal_remark,
        promotion_status: src.promotion_status || compiled.reportCard.breakdown.promotion_status,
      };
      await execWrite(
        `UPDATE session_report_cards
         SET status = 'PUBLISHED', total_score = $1, average_score = $2, subjects_count = $3, terms_count = $4,
             term_averages_json = $5, snapshot_json = $6, attendance_summary_json = $7, behaviour_summary_json = $8,
             published_by = $9, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $10 AND school_id = $11`,
        `UPDATE session_report_cards
         SET status = 'PUBLISHED', total_score = ?, average_score = ?, subjects_count = ?, terms_count = ?,
             term_averages_json = ?, snapshot_json = ?, attendance_summary_json = ?, behaviour_summary_json = ?,
             published_by = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND school_id = ?`,
        [
          breakdown.total_score,
          breakdown.average_score,
          breakdown.subjects_count,
          breakdown.terms_count,
          JSON.stringify(breakdown.term_averages || []),
          JSON.stringify(breakdown),
          JSON.stringify(breakdown.attendance_summary || {}),
          JSON.stringify(breakdown.behaviour_summary || {}),
          req.user!.id,
          src.id,
          schoolId,
        ]
      );
      notificationService.notifyParentsOfStudent(
        schoolId,
        src.student_id,
        'SYSTEM',
        `Annual Session Report Card Published: ${breakdown.sessionName}`,
        `The full-session cumulative report card for ${breakdown.student?.full_name || 'your ward'} is now published.`,
        { eventType: 'SESSION_REPORT_CARD_AVAILABLE', sessionReportCardId: src.id }
      );
      notificationService.notifyStudent(
        schoolId,
        src.student_id,
        'SYSTEM',
        `Annual Session Report Card Published: ${breakdown.sessionName}`,
        `Your full-session cumulative report card for ${breakdown.sessionName} is now published.`,
        { eventType: 'SESSION_REPORT_CARD_AVAILABLE', sessionReportCardId: src.id }
      );
      publishedCount++;
    }

    return res.json({ success: true, publishedCount });
  }
);

// ==============================================================================
// 7. ATTENDANCE TRACKING & PUBLICATION
// ==============================================================================

performanceRouter.get(
  '/attendance',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { class_id, attendance_date, academic_session_id, term_id, student_id } = req.query as Record<string, string>;

    let pgSql = `
      SELECT ar.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name
      FROM attendance_records ar
      JOIN students s ON ar.student_id = s.id
      LEFT JOIN classes c ON COALESCE(ar.class_id, s.class_id) = c.id
      WHERE ar.school_id = $1
    `;
    let sqSql = `
      SELECT ar.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name
      FROM attendance_records ar
      JOIN students s ON ar.student_id = s.id
      LEFT JOIN classes c ON COALESCE(ar.class_id, s.class_id) = c.id
      WHERE ar.school_id = ?
    `;
    const params: any[] = [schoolId];
    let idx = 2;
    if (class_id) {
      pgSql += ` AND COALESCE(ar.class_id, s.class_id) = $${idx++}`;
      sqSql += ` AND COALESCE(ar.class_id, s.class_id) = ?`;
      params.push(class_id);
    }
    if (attendance_date) {
      pgSql += ` AND ar.attendance_date = $${idx++}`;
      sqSql += ` AND ar.attendance_date = ?`;
      params.push(attendance_date);
    }
    if (academic_session_id) {
      pgSql += ` AND ar.academic_session_id = $${idx++}`;
      sqSql += ` AND ar.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      pgSql += ` AND ar.term_id = $${idx++}`;
      sqSql += ` AND ar.term_id = ?`;
      params.push(term_id);
    }
    if (student_id) {
      pgSql += ` AND ar.student_id = $${idx++}`;
      sqSql += ` AND ar.student_id = ?`;
      params.push(student_id);
    }
    pgSql += ' ORDER BY ar.attendance_date DESC, s.full_name ASC LIMIT 300';
    sqSql += ' ORDER BY ar.attendance_date DESC, s.full_name ASC LIMIT 300';

    const records = await dbAll(pgSql, sqSql, params);
    const publications = await dbAll(
      `SELECT ap.*, c.name as class_name, ses.name as session_name, t.name as term_name
       FROM attendance_publications ap
       LEFT JOIN classes c ON ap.class_id = c.id
       LEFT JOIN academic_sessions ses ON ap.academic_session_id = ses.id
       LEFT JOIN terms t ON ap.term_id = t.id
       WHERE ap.school_id = $1
       ORDER BY ap.updated_at DESC`,
      `SELECT ap.*, c.name as class_name, ses.name as session_name, t.name as term_name
       FROM attendance_publications ap
       LEFT JOIN classes c ON ap.class_id = c.id
       LEFT JOIN academic_sessions ses ON ap.academic_session_id = ses.id
       LEFT JOIN terms t ON ap.term_id = t.id
       WHERE ap.school_id = ?
       ORDER BY ap.updated_at DESC`,
      [schoolId]
    );

    return res.json({ success: true, count: records.length, records, publications });
  }
);

performanceRouter.post(
  '/attendance/bulk',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { attendance_date, class_id, academic_session_id, term_id, is_published = 0, records } = req.body || {};

    if (!attendance_date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'attendance_date and records array are required.' });
    }

    const validStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
    let savedCount = 0;

    for (const rec of records) {
      if (!rec.student_id || !validStatuses.includes(rec.status)) {
        return res.status(400).json({ error: 'INVALID_RECORD', message: 'Valid student_id and status (PRESENT, ABSENT, LATE, EXCUSED) are required.' });
      }
      const stu = await dbGet(
        `SELECT id, class_id, class_arm_id FROM students WHERE id = $1 AND school_id = $2`,
        `SELECT id, class_id, class_arm_id FROM students WHERE id = ? AND school_id = ?`,
        [rec.student_id, schoolId]
      );
      if (!stu) return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student does not belong to your school.' });

      const id = newId('att');
      const pubFlag = is_published ? 1 : 0;
      await execWrite(
        `INSERT INTO attendance_records (
           id, school_id, student_id, class_id, class_arm_id, academic_session_id, term_id,
           attendance_date, status, notes, is_published, recorded_by, updated_by, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (school_id, student_id, attendance_date) DO UPDATE SET
           status = EXCLUDED.status,
           notes = COALESCE(EXCLUDED.notes, attendance_records.notes),
           class_id = COALESCE(EXCLUDED.class_id, attendance_records.class_id),
           academic_session_id = COALESCE(EXCLUDED.academic_session_id, attendance_records.academic_session_id),
           term_id = COALESCE(EXCLUDED.term_id, attendance_records.term_id),
           is_published = GREATEST(attendance_records.is_published, EXCLUDED.is_published),
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        `INSERT INTO attendance_records (
           id, school_id, student_id, class_id, class_arm_id, academic_session_id, term_id,
           attendance_date, status, notes, is_published, recorded_by, updated_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(school_id, student_id, attendance_date) DO UPDATE SET
           status = excluded.status,
           notes = COALESCE(excluded.notes, attendance_records.notes),
           class_id = COALESCE(excluded.class_id, attendance_records.class_id),
           academic_session_id = COALESCE(excluded.academic_session_id, attendance_records.academic_session_id),
           term_id = COALESCE(excluded.term_id, attendance_records.term_id),
           is_published = MAX(attendance_records.is_published, excluded.is_published),
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        [
          id,
          schoolId,
          rec.student_id,
          class_id || stu.class_id || null,
          stu.class_arm_id || null,
          academic_session_id || null,
          term_id || null,
          attendance_date,
          rec.status,
          rec.notes || null,
          pubFlag,
          req.user!.id,
        ]
      );
      savedCount++;
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'RECORD_ATTENDANCE_BULK',
      entity: 'ATTENDANCE',
      metadata: { attendance_date, class_id, savedCount, is_published: Boolean(is_published) },
    });

    return res.json({ success: true, savedCount });
  }
);

performanceRouter.put(
  '/attendance/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const { status, notes } = req.body || {};

    if (status && !['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'].includes(status)) {
      return res.status(400).json({ error: 'INVALID_STATUS', message: 'Invalid attendance status.' });
    }
    const existing = await dbGet(
      `SELECT * FROM attendance_records WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM attendance_records WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Attendance record not found.' });

    await execWrite(
      `UPDATE attendance_records SET status = COALESCE($1, status), notes = COALESCE($2, notes), updated_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND school_id = $5`,
      `UPDATE attendance_records SET status = COALESCE(?, status), notes = COALESCE(?, notes), updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
      [status || null, notes ?? null, req.user!.id, id, schoolId]
    );

    const updated = await dbGet(`SELECT * FROM attendance_records WHERE id = $1`, `SELECT * FROM attendance_records WHERE id = ?`, [id]);
    return res.json({ success: true, record: updated });
  }
);

performanceRouter.post(
  '/attendance/publish',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { class_id, academic_session_id, term_id, notes } = req.body || {};

    let pgWhere = 'school_id = $1';
    let sqWhere = 'school_id = ?';
    const params: any[] = [schoolId];
    let idx = 2;
    if (class_id) {
      pgWhere += ` AND class_id = $${idx++}`;
      sqWhere += ' AND class_id = ?';
      params.push(class_id);
    }
    if (academic_session_id) {
      pgWhere += ` AND academic_session_id = $${idx++}`;
      sqWhere += ' AND academic_session_id = ?';
      params.push(academic_session_id);
    }
    if (term_id) {
      pgWhere += ` AND term_id = $${idx++}`;
      sqWhere += ' AND term_id = ?';
      params.push(term_id);
    }

    await execWrite(
      `UPDATE attendance_records SET is_published = 1, updated_at = CURRENT_TIMESTAMP WHERE ${pgWhere}`,
      `UPDATE attendance_records SET is_published = 1, updated_at = CURRENT_TIMESTAMP WHERE ${sqWhere}`,
      params
    );

    const pubId = newId('apub');
    await execWrite(
      `INSERT INTO attendance_publications (id, school_id, class_id, academic_session_id, term_id, status, published_by, published_at, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', $6, CURRENT_TIMESTAMP, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (school_id, class_id, academic_session_id, term_id) DO UPDATE SET
         status = 'PUBLISHED', published_by = EXCLUDED.published_by, published_at = CURRENT_TIMESTAMP, notes = EXCLUDED.notes, updated_at = CURRENT_TIMESTAMP`,
      `INSERT INTO attendance_publications (id, school_id, class_id, academic_session_id, term_id, status, published_by, published_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(school_id, class_id, academic_session_id, term_id) DO UPDATE SET
         status = 'PUBLISHED', published_by = excluded.published_by, published_at = CURRENT_TIMESTAMP, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`,
      [pubId, schoolId, class_id || null, academic_session_id || null, term_id || null, req.user!.id, notes || null]
    );

    // Notify parents of students whose published attendance shows absences
    const absentStudents = await dbAll(
      `SELECT DISTINCT student_id FROM attendance_records WHERE ${pgWhere} AND status = 'ABSENT'`,
      `SELECT DISTINCT student_id FROM attendance_records WHERE ${sqWhere} AND status = 'ABSENT'`,
      params
    );
    for (const row of absentStudents) {
      notificationService.notifyParentsOfStudent(
        schoolId,
        row.student_id,
        'SYSTEM',
        'Attendance Update Published',
        'Updated attendance records have been published. Please review recent absence entries on the Parent Portal.',
        { eventType: 'ATTENDANCE_ALERT' }
      );
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'PUBLISH_ATTENDANCE',
      entity: 'ATTENDANCE_PUBLICATION',
      metadata: { class_id, academic_session_id, term_id },
    });

    return res.json({ success: true, message: 'Attendance records published to Parent & Student portals.' });
  }
);

// ==============================================================================
// 8. BEHAVIOUR MONITORING & OFFICIAL TERMLY TEACHER REMARKS
// ==============================================================================

performanceRouter.get(
  '/behaviour',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const roleName = getEffectiveRoleName(req);
    const { student_id, class_id, category, severity, academic_session_id, term_id } = req.query as Record<string, string>;

    let pgSql = `
      SELECT br.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name
      FROM behaviour_records br
      JOIN students s ON br.student_id = s.id
      LEFT JOIN classes c ON COALESCE(br.class_id, s.class_id) = c.id
      WHERE br.school_id = $1 AND (br.is_deleted = 0 OR br.is_deleted IS NULL)
    `;
    let sqSql = `
      SELECT br.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name
      FROM behaviour_records br
      JOIN students s ON br.student_id = s.id
      LEFT JOIN classes c ON COALESCE(br.class_id, s.class_id) = c.id
      WHERE br.school_id = ? AND (br.is_deleted = 0 OR br.is_deleted IS NULL)
    `;
    const params: any[] = [schoolId];
    let idx = 2;

    if (roleName === 'TEACHER') {
      pgSql += ' AND br.visible_to_teacher = 1';
      sqSql += ' AND br.visible_to_teacher = 1';
    }
    if (student_id) {
      pgSql += ` AND br.student_id = $${idx++}`;
      sqSql += ` AND br.student_id = ?`;
      params.push(student_id);
    }
    if (class_id) {
      pgSql += ` AND COALESCE(br.class_id, s.class_id) = $${idx++}`;
      sqSql += ` AND COALESCE(br.class_id, s.class_id) = ?`;
      params.push(class_id);
    }
    if (category) {
      pgSql += ` AND br.category = $${idx++}`;
      sqSql += ` AND br.category = ?`;
      params.push(category);
    }
    if (severity) {
      pgSql += ` AND br.severity = $${idx++}`;
      sqSql += ` AND br.severity = ?`;
      params.push(severity);
    }
    if (academic_session_id) {
      pgSql += ` AND br.academic_session_id = $${idx++}`;
      sqSql += ` AND br.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      pgSql += ` AND br.term_id = $${idx++}`;
      sqSql += ` AND br.term_id = ?`;
      params.push(term_id);
    }

    pgSql += ' ORDER BY br.record_date DESC, br.created_at DESC';
    sqSql += ' ORDER BY br.record_date DESC, br.created_at DESC';

    const records = await dbAll(pgSql, sqSql, params);
    return res.json({ success: true, count: records.length, records });
  }
);

performanceRouter.post(
  '/behaviour',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      student_id,
      class_id,
      academic_session_id,
      term_id,
      record_date = new Date().toISOString().slice(0, 10),
      category,
      severity = 'LOW',
      title,
      description,
      action_taken,
      admin_remarks,
      visible_to_parent = true,
      visible_to_student = true,
      visible_to_teacher = true,
    } = req.body || {};

    const validCategories = ['POSITIVE', 'COMMENDATION', 'DISCIPLINE', 'INCIDENT', 'PASTORAL'];
    const validSeverities = ['LOW', 'MODERATE', 'HIGH'];
    if (!student_id || !category || !title?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'student_id, category, title, and description are required.' });
    }
    const cleanCategory = String(category).trim().toUpperCase();
    const cleanSeverity = String(severity || 'LOW').trim().toUpperCase();
    if (!validCategories.includes(cleanCategory)) {
      return res.status(400).json({ error: 'INVALID_CATEGORY', message: `Category must be one of: ${validCategories.join(', ')}` });
    }
    if (!validSeverities.includes(cleanSeverity)) {
      return res.status(400).json({ error: 'INVALID_SEVERITY', message: `Severity must be one of: ${validSeverities.join(', ')}` });
    }
    const stu = await dbGet(
      `SELECT id, class_id, full_name FROM students WHERE id = $1 AND school_id = $2`,
      `SELECT id, class_id, full_name FROM students WHERE id = ? AND school_id = ?`,
      [student_id, schoolId]
    );
    if (!stu) return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student not found in this school.' });

    const id = newId('beh');
    const visP = visible_to_parent ? 1 : 0;
    const visS = visible_to_student ? 1 : 0;
    const visT = visible_to_teacher ? 1 : 0;

    await execWrite(
      `INSERT INTO behaviour_records (
         id, school_id, student_id, class_id, academic_session_id, term_id, record_date, category, severity,
         title, description, action_taken, admin_remarks, visible_to_parent, visible_to_student, visible_to_teacher,
         recorded_by, updated_by, is_deleted, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      `INSERT INTO behaviour_records (
         id, school_id, student_id, class_id, academic_session_id, term_id, record_date, category, severity,
         title, description, action_taken, admin_remarks, visible_to_parent, visible_to_student, visible_to_teacher,
         recorded_by, updated_by, is_deleted, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        schoolId,
        student_id,
        class_id || stu.class_id || null,
        academic_session_id || null,
        term_id || null,
        record_date,
        cleanCategory,
        cleanSeverity,
        title.trim(),
        description.trim(),
        action_taken || null,
        admin_remarks || null,
        visP,
        visS,
        visT,
        req.user!.id,
      ]
    );

    if (visP === 1) {
      notificationService.notifyParentsOfStudent(
        schoolId,
        student_id,
        'SYSTEM',
        `Conduct Update: ${title.trim()}`,
        `A ${category.toLowerCase()} record for ${stu.full_name} was logged on ${record_date}.`,
        { eventType: 'BEHAVIOUR_NOTICE', behaviourId: id }
      );
    }
    if (visS === 1) {
      notificationService.notifyStudent(
        schoolId,
        student_id,
        'SYSTEM',
        `Conduct Record: ${title.trim()}`,
        `A ${category.toLowerCase()} note was recorded on ${record_date}.`,
        { eventType: 'BEHAVIOUR_NOTICE', behaviourId: id }
      );
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'CREATE_BEHAVIOUR_RECORD',
      entity: 'BEHAVIOUR_RECORD',
      entityId: id,
      metadata: { student_id, category, severity, visP, visS, visT },
    });

    const record = await dbGet(`SELECT * FROM behaviour_records WHERE id = $1`, `SELECT * FROM behaviour_records WHERE id = ?`, [id]);
    return res.status(201).json({ success: true, record });
  }
);

performanceRouter.put(
  '/behaviour/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const existing = await dbGet(
      `SELECT * FROM behaviour_records WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM behaviour_records WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Behaviour record not found.' });

    const b = req.body || {};
    const validCategories = ['POSITIVE', 'COMMENDATION', 'DISCIPLINE', 'INCIDENT', 'PASTORAL'];
    const validSeverities = ['LOW', 'MODERATE', 'HIGH'];
    if (b.category !== undefined && !validCategories.includes(String(b.category).trim().toUpperCase())) {
      return res.status(400).json({ error: 'INVALID_CATEGORY', message: `Category must be one of: ${validCategories.join(', ')}` });
    }
    if (b.severity !== undefined && !validSeverities.includes(String(b.severity).trim().toUpperCase())) {
      return res.status(400).json({ error: 'INVALID_SEVERITY', message: `Severity must be one of: ${validSeverities.join(', ')}` });
    }
    await execWrite(
      `UPDATE behaviour_records
       SET category = COALESCE($1, category),
           severity = COALESCE($2, severity),
           title = COALESCE($3, title),
           description = COALESCE($4, description),
           action_taken = COALESCE($5, action_taken),
           admin_remarks = COALESCE($6, admin_remarks),
           visible_to_parent = COALESCE($7, visible_to_parent),
           visible_to_student = COALESCE($8, visible_to_student),
           visible_to_teacher = COALESCE($9, visible_to_teacher),
           updated_by = $10,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11 AND school_id = $12`,
      `UPDATE behaviour_records
       SET category = COALESCE(?, category),
           severity = COALESCE(?, severity),
           title = COALESCE(?, title),
           description = COALESCE(?, description),
           action_taken = COALESCE(?, action_taken),
           admin_remarks = COALESCE(?, admin_remarks),
           visible_to_parent = COALESCE(?, visible_to_parent),
           visible_to_student = COALESCE(?, visible_to_student),
           visible_to_teacher = COALESCE(?, visible_to_teacher),
           updated_by = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [
        b.category ? String(b.category).trim().toUpperCase() : null,
        b.severity ? String(b.severity).trim().toUpperCase() : null,
        b.title?.trim() || null,
        b.description?.trim() || null,
        b.action_taken ?? null,
        b.admin_remarks ?? null,
        b.visible_to_parent !== undefined ? (b.visible_to_parent ? 1 : 0) : null,
        b.visible_to_student !== undefined ? (b.visible_to_student ? 1 : 0) : null,
        b.visible_to_teacher !== undefined ? (b.visible_to_teacher ? 1 : 0) : null,
        req.user!.id,
        id,
        schoolId,
      ]
    );

    const record = await dbGet(`SELECT * FROM behaviour_records WHERE id = $1`, `SELECT * FROM behaviour_records WHERE id = ?`, [id]);
    return res.json({ success: true, record });
  }
);

performanceRouter.delete(
  '/behaviour/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const existing = await dbGet(
      `SELECT * FROM behaviour_records WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM behaviour_records WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Behaviour record not found.' });

    await execWrite(
      `UPDATE behaviour_records SET is_deleted = 1, updated_by = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3`,
      `UPDATE behaviour_records SET is_deleted = 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
      [req.user!.id, id, schoolId]
    );
    return res.json({ success: true, message: 'Behaviour record deleted.' });
  }
);

performanceRouter.get(
  '/teacher-remarks',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { student_id, academic_session_id, term_id, class_id } = req.query as Record<string, string>;

    let pgSql = `
      SELECT tr.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
             ses.name as session_name, t.name as term_name
      FROM teacher_remarks tr
      JOIN students s ON tr.student_id = s.id
      LEFT JOIN classes c ON COALESCE(tr.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON tr.academic_session_id = ses.id
      LEFT JOIN terms t ON tr.term_id = t.id
      WHERE tr.school_id = $1
    `;
    let sqSql = `
      SELECT tr.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
             ses.name as session_name, t.name as term_name
      FROM teacher_remarks tr
      JOIN students s ON tr.student_id = s.id
      LEFT JOIN classes c ON COALESCE(tr.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON tr.academic_session_id = ses.id
      LEFT JOIN terms t ON tr.term_id = t.id
      WHERE tr.school_id = ?
    `;
    const params: any[] = [schoolId];
    let idx = 2;
    if (student_id) {
      pgSql += ` AND tr.student_id = $${idx++}`;
      sqSql += ` AND tr.student_id = ?`;
      params.push(student_id);
    }
    if (academic_session_id) {
      pgSql += ` AND tr.academic_session_id = $${idx++}`;
      sqSql += ` AND tr.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      pgSql += ` AND tr.term_id = $${idx++}`;
      sqSql += ` AND tr.term_id = ?`;
      params.push(term_id);
    }
    if (class_id) {
      pgSql += ` AND COALESCE(tr.class_id, s.class_id) = $${idx++}`;
      sqSql += ` AND COALESCE(tr.class_id, s.class_id) = ?`;
      params.push(class_id);
    }
    pgSql += ' ORDER BY tr.updated_at DESC';
    sqSql += ' ORDER BY tr.updated_at DESC';

    const remarks = await dbAll(pgSql, sqSql, params);
    return res.json({ success: true, remarks });
  }
);

performanceRouter.put(
  '/teacher-remarks',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      student_id,
      class_id,
      academic_session_id,
      term_id,
      remark_text,
      staff_name,
      visible_to_parent = true,
      visible_to_student = true,
    } = req.body || {};

    if (!student_id || !academic_session_id || !term_id || !remark_text?.trim()) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'student_id, academic_session_id, term_id, and remark_text are required.' });
    }

    const stu = await dbGet(`SELECT id, class_id FROM students WHERE id = $1 AND school_id = $2`, `SELECT id, class_id FROM students WHERE id = ? AND school_id = ?`, [student_id, schoolId]);
    if (!stu) return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student not found in your school.' });

    const id = newId('rmk');
    await execWrite(
      `INSERT INTO teacher_remarks (
         id, school_id, student_id, class_id, academic_session_id, term_id,
         remark_text, staff_name, visible_to_parent, visible_to_student, author_admin_id, updated_by, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (school_id, student_id, academic_session_id, term_id) DO UPDATE SET
         remark_text = EXCLUDED.remark_text,
         staff_name = COALESCE(EXCLUDED.staff_name, teacher_remarks.staff_name),
         visible_to_parent = EXCLUDED.visible_to_parent,
         visible_to_student = EXCLUDED.visible_to_student,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      `INSERT INTO teacher_remarks (
         id, school_id, student_id, class_id, academic_session_id, term_id,
         remark_text, staff_name, visible_to_parent, visible_to_student, author_admin_id, updated_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(school_id, student_id, academic_session_id, term_id) DO UPDATE SET
         remark_text = excluded.remark_text,
         staff_name = COALESCE(excluded.staff_name, teacher_remarks.staff_name),
         visible_to_parent = excluded.visible_to_parent,
         visible_to_student = excluded.visible_to_student,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        schoolId,
        student_id,
        class_id || stu.class_id || null,
        academic_session_id,
        term_id,
        remark_text.trim(),
        staff_name || req.user!.full_name || 'School Administration',
        visible_to_parent ? 1 : 0,
        visible_to_student ? 1 : 0,
        req.user!.id,
      ]
    );

    const remark = await dbGet(
      `SELECT * FROM teacher_remarks WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 AND term_id = $4`,
      `SELECT * FROM teacher_remarks WHERE school_id = ? AND student_id = ? AND academic_session_id = ? AND term_id = ?`,
      [schoolId, student_id, academic_session_id, term_id]
    );
    return res.json({ success: true, remark });
  }
);

// ==============================================================================
// 9. SCHOOL ANNOUNCEMENTS
// ==============================================================================

performanceRouter.get(
  '/announcements',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const roleName = getEffectiveRoleName(req);

    let pgSql = `
      SELECT sa.*, c.name as target_class_name
      FROM school_announcements sa
      LEFT JOIN classes c ON sa.target_class_id = c.id
      WHERE sa.school_id = $1 AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
    `;
    let sqSql = `
      SELECT sa.*, c.name as target_class_name
      FROM school_announcements sa
      LEFT JOIN classes c ON sa.target_class_id = c.id
      WHERE sa.school_id = ? AND (sa.is_deleted = 0 OR sa.is_deleted IS NULL)
    `;
    if (roleName === 'TEACHER' || roleName === 'STAFF') {
      pgSql += ` AND sa.is_published = 1 AND (sa.audience IN ('ALL', 'TEACHERS', 'STAFF_ONLY') OR COALESCE(sa.is_confidential, 0) = 1)`;
      sqSql += ` AND sa.is_published = 1 AND (sa.audience IN ('ALL', 'TEACHERS', 'STAFF_ONLY') OR COALESCE(sa.is_confidential, 0) = 1)`;
    } else if (!ADMIN_ONLY_ROLES.includes(roleName || '')) {
      pgSql += ` AND COALESCE(sa.is_confidential, 0) = 0 AND sa.audience NOT IN ('TEACHERS', 'STAFF_ONLY')`;
      sqSql += ` AND COALESCE(sa.is_confidential, 0) = 0 AND sa.audience NOT IN ('TEACHERS', 'STAFF_ONLY')`;
    }
    pgSql += ' ORDER BY sa.published_at DESC, sa.created_at DESC';
    sqSql += ' ORDER BY sa.published_at DESC, sa.created_at DESC';

    const announcements = await dbAll(pgSql, sqSql, [schoolId]);
    return res.json({ success: true, count: announcements.length, announcements });
  }
);

performanceRouter.post(
  '/announcements',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const {
      title,
      content,
      audience = 'ALL',
      target_class_id = null,
      priority = 'NORMAL',
      is_confidential = false,
      is_published = true,
    } = req.body || {};

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'Announcement title and content are required.' });
    }
    if (!['ALL', 'PARENTS', 'STUDENTS', 'TEACHERS', 'CLASS', 'STAFF_ONLY'].includes(audience)) {
      return res.status(400).json({ error: 'INVALID_AUDIENCE', message: 'Invalid announcement audience.' });
    }

    const id = newId('ann');
    const pub = is_published ? 1 : 0;
    const confidentialFlag = audience === 'STAFF_ONLY' || Boolean(is_confidential) ? 1 : 0;
    const effectiveAudience = confidentialFlag === 1 && !['STAFF_ONLY', 'TEACHERS'].includes(audience) ? 'STAFF_ONLY' : audience;

    await execWrite(
      `INSERT INTO school_announcements (
         id, school_id, title, content, audience, target_class_id, priority, is_confidential, is_published,
         published_at, created_by, created_by_name, is_deleted, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, $10, $11, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      `INSERT INTO school_announcements (
         id, school_id, title, content, audience, target_class_id, priority, is_confidential, is_published,
         published_at, created_by, created_by_name, is_deleted, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        schoolId,
        title.trim(),
        content.trim(),
        effectiveAudience,
        effectiveAudience === 'CLASS' ? target_class_id : null,
        ['NORMAL', 'IMPORTANT', 'URGENT'].includes(priority) ? priority : 'NORMAL',
        confidentialFlag,
        pub,
        req.user!.id,
        req.user!.full_name || 'School Admin',
      ]
    );

    if (pub === 1) {
      notificationService.notifyAnnouncementAudience(
        schoolId,
        effectiveAudience,
        effectiveAudience === 'CLASS' ? target_class_id : null,
        title.trim(),
        content.trim().slice(0, 180),
        { eventType: 'SCHOOL_ANNOUNCEMENT', announcementId: id, priority, isConfidential: confidentialFlag === 1 },
        confidentialFlag === 1
      );
    }

    logAudit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      schoolId,
      action: 'CREATE_ANNOUNCEMENT',
      entity: 'SCHOOL_ANNOUNCEMENT',
      entityId: id,
      metadata: { title: title.trim(), audience: effectiveAudience, priority, isConfidential: confidentialFlag === 1 },
    });

    const announcement = await dbGet(`SELECT * FROM school_announcements WHERE id = $1`, `SELECT * FROM school_announcements WHERE id = ?`, [id]);
    return res.status(201).json({ success: true, announcement });
  }
);

performanceRouter.put(
  '/announcements/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const { title, content, audience, target_class_id, priority, is_confidential, is_published } = req.body || {};

    const existing = await dbGet(
      `SELECT * FROM school_announcements WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM school_announcements WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Announcement not found.' });

    const nextAudience = audience || existing.audience;
    const nextConfidential =
      audience === 'STAFF_ONLY'
        ? 1
        : is_confidential !== undefined
        ? is_confidential
          ? 1
          : 0
        : existing.is_confidential ?? 0;

    await execWrite(
      `UPDATE school_announcements
       SET title = COALESCE($1, title),
           content = COALESCE($2, content),
           audience = $3,
           target_class_id = $4,
           priority = COALESCE($5, priority),
           is_confidential = $6,
           is_published = COALESCE($7, is_published),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND school_id = $9`,
      `UPDATE school_announcements
       SET title = COALESCE(?, title),
           content = COALESCE(?, content),
           audience = ?,
           target_class_id = ?,
           priority = COALESCE(?, priority),
           is_confidential = ?,
           is_published = COALESCE(?, is_published),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [
        title?.trim() || null,
        content?.trim() || null,
        nextAudience,
        target_class_id !== undefined ? target_class_id : existing.target_class_id,
        priority || null,
        nextConfidential,
        is_published !== undefined ? (is_published ? 1 : 0) : null,
        id,
        schoolId,
      ]
    );

    const announcement = await dbGet(`SELECT * FROM school_announcements WHERE id = $1`, `SELECT * FROM school_announcements WHERE id = ?`, [id]);
    return res.json({ success: true, announcement });
  }
);

performanceRouter.delete(
  '/announcements/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { id } = req.params;
    const existing = await dbGet(
      `SELECT * FROM school_announcements WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM school_announcements WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Announcement not found.' });

    await execWrite(
      `UPDATE school_announcements SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
      `UPDATE school_announcements SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
      [id, schoolId]
    );
    return res.json({ success: true, message: 'Announcement removed.' });
  }
);
