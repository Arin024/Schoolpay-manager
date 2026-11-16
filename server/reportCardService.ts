import crypto from 'crypto';
import {
  computeGrade,
  dbAll,
  dbGet,
  getSchoolAcademicSettings,
} from './accessControl.ts';

export interface CompileReportOptions {
  onlyPublished?: boolean;
  visibilityRole?: 'ADMIN' | 'TEACHER' | 'PARENT' | 'STUDENT';
  examinationId?: string | null;
  forceLive?: boolean;
}

function getTermSortOrder(termName: string, startDate?: string | null): number {
  const lower = String(termName || '').toLowerCase();
  if (lower.includes('1st') || lower.includes('first')) return 1;
  if (lower.includes('2nd') || lower.includes('second')) return 2;
  if (lower.includes('3rd') || lower.includes('third')) return 3;
  if (startDate) {
    const ts = Date.parse(startDate);
    if (!Number.isNaN(ts)) return 10 + ts / 1e12;
  }
  return 99;
}

export function sortTermsChronologically<T extends { name: string; start_date?: string | null; created_at?: string | null }>(
  terms: T[]
): T[] {
  return [...terms].sort((a, b) => {
    const orderDiff = getTermSortOrder(a.name, a.start_date) - getTermSortOrder(b.name, b.start_date);
    if (orderDiff !== 0) return orderDiff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function buildBehaviourClause(visibilityRole: CompileReportOptions['visibilityRole']): string {
  if (visibilityRole === 'STUDENT') return 'AND visible_to_student = 1';
  if (visibilityRole === 'TEACHER') return 'AND visible_to_teacher = 1';
  if (visibilityRole === 'PARENT') return 'AND visible_to_parent = 1';
  return 'AND visible_to_parent = 1';
}

function buildRemarkClause(visibilityRole: CompileReportOptions['visibilityRole']): string {
  if (visibilityRole === 'STUDENT') return 'AND visible_to_student = 1';
  if (visibilityRole === 'PARENT') return 'AND visible_to_parent = 1';
  return '';
}

function parseGradingScaleSafe(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}

/**
 * Computes and returns a structured End-of-Term Report Card breakdown for a student,
 * works both from persisted report_cards rows and dynamically from recorded/published scores.
 */
export async function compileTermReportCard(
  schoolId: string,
  studentId: string,
  academicSessionId: string,
  termId: string,
  options: CompileReportOptions = {}
): Promise<{ reportCard: any; source: 'OFFICIAL' | 'LIVE' } | null> {
  const onlyPublished = Boolean(options.onlyPublished);
  const visibilityRole = options.visibilityRole || (onlyPublished ? 'PARENT' : 'ADMIN');

  const existingRc = await dbGet(
    `SELECT rc.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
            ses.name as session_name, t.name as term_name
     FROM report_cards rc
     JOIN students s ON rc.student_id = s.id
     LEFT JOIN classes c ON COALESCE(rc.class_id, s.class_id) = c.id
     LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
     LEFT JOIN terms t ON rc.term_id = t.id
     WHERE rc.school_id = $1 AND rc.student_id = $2 AND rc.academic_session_id = $3 AND rc.term_id = $4
     LIMIT 1`,
    `SELECT rc.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
            ses.name as session_name, t.name as term_name
     FROM report_cards rc
     JOIN students s ON rc.student_id = s.id
     LEFT JOIN classes c ON COALESCE(rc.class_id, s.class_id) = c.id
     LEFT JOIN academic_sessions ses ON rc.academic_session_id = ses.id
     LEFT JOIN terms t ON rc.term_id = t.id
     WHERE rc.school_id = ? AND rc.student_id = ? AND rc.academic_session_id = ? AND rc.term_id = ?
     LIMIT 1`,
    [schoolId, studentId, academicSessionId, termId]
  );

  // If official published report card snapshot exists and live rebuild isn't forced
  if (!options.forceLive && existingRc && existingRc.status === 'PUBLISHED' && existingRc.snapshot_json) {
    try {
      const parsedBreakdown = JSON.parse(existingRc.snapshot_json);
      return {
        source: 'OFFICIAL',
        reportCard: {
          ...existingRc,
          report_type: 'TERM',
          breakdown: {
            report_type: 'TERM',
            ...parsedBreakdown,
          },
        },
      };
    } catch {}
  }

  const settings = await getSchoolAcademicSettings(schoolId);
  const school = await dbGet(
    `SELECT id, name, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = $1`,
    `SELECT id, name, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = ?`,
    [schoolId]
  );
  const student = await dbGet(
    `SELECT id, admission_number, full_name, first_name, last_name, gender, class_id, class_name, class_arm_name
     FROM students WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT id, admission_number, full_name, first_name, last_name, gender, class_id, class_name, class_arm_name
     FROM students WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [studentId, schoolId]
  );
  if (!student) return null;

  const session = await dbGet(
    `SELECT id, name FROM academic_sessions WHERE id = $1`,
    `SELECT id, name FROM academic_sessions WHERE id = ?`,
    [academicSessionId]
  );
  const term = await dbGet(
    `SELECT id, name FROM terms WHERE id = $1`,
    `SELECT id, name FROM terms WHERE id = ?`,
    [termId]
  );

  const examFilterId = options.examinationId || existingRc?.examination_id || null;
  const pubScoreClause = onlyPublished ? `AND ss.status = 'PUBLISHED' AND ex.status = 'PUBLISHED'` : '';

  const rawScores = await dbAll(
    `SELECT ss.*, sub.name as subject_name, sub.code as subject_code, ex.total_max_score, ex.ca_max_score, ex.exam_max_score,
            ex.title as examination_title, ex.created_at as exam_created_at
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     JOIN examinations ex ON ss.examination_id = ex.id
     WHERE ss.school_id = $1 AND ss.student_id = $2 AND ss.academic_session_id = $3 AND ss.term_id = $4
       AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
       ${pubScoreClause}
       ${examFilterId ? 'AND ss.examination_id = $5' : ''}
     ORDER BY sub.name ASC, ex.created_at DESC`,
    `SELECT ss.*, sub.name as subject_name, sub.code as subject_code, ex.total_max_score, ex.ca_max_score, ex.exam_max_score,
            ex.title as examination_title, ex.created_at as exam_created_at
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     JOIN examinations ex ON ss.examination_id = ex.id
     WHERE ss.school_id = ? AND ss.student_id = ? AND ss.academic_session_id = ? AND ss.term_id = ?
       AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
       ${pubScoreClause}
       ${examFilterId ? 'AND ss.examination_id = ?' : ''}
     ORDER BY sub.name ASC, ex.created_at DESC`,
    examFilterId
      ? [schoolId, studentId, academicSessionId, termId, examFilterId]
      : [schoolId, studentId, academicSessionId, termId]
  );

  // Deduplicate by subject_id (keeping latest exam if multiple exist across same term)
  const subjectScoreMap = new Map<string, any>();
  for (const s of rawScores) {
    if (!subjectScoreMap.has(s.subject_id)) {
      subjectScoreMap.set(s.subject_id, s);
    }
  }
  const scores = Array.from(subjectScoreMap.values());

  // When onlyPublished is requested (parent/student), fail cleanly if neither published report card nor published scores exist
  const hasPublishedOfficialRc = Boolean(existingRc && existingRc.status === 'PUBLISHED');
  if (onlyPublished && !hasPublishedOfficialRc && scores.length === 0) {
    return null;
  }

  const valid = scores.filter((s) => s.total_score !== null && s.total_score !== undefined);
  const totalScore = Math.round(valid.reduce((acc, s) => acc + Number(s.total_score || 0), 0) * 100) / 100;
  const pctSum = valid.reduce((acc, s) => {
    const max = Number(s.total_max_score) > 0 ? Number(s.total_max_score) : 100;
    return acc + (Number(s.total_score) / max) * 100;
  }, 0);
  const activeSubjects = await dbAll(
    `SELECT id FROM subjects WHERE school_id = $1 AND status = 'ACTIVE' AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT id FROM subjects WHERE school_id = ? AND status = 'ACTIVE' AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [schoolId]
  );
  const denom =
    settings.missing_score_policy === 'ZERO' && activeSubjects.length > valid.length
      ? activeSubjects.length
      : valid.length;
  const computedAvg = denom > 0 ? Math.round((pctSum / denom) * 100) / 100 : 0;

  // Compute deterministic class rank if show_class_position is enabled and existingRc does not already have it
  let classPosition: number | null = existingRc?.class_position ?? null;
  let classSize: number | null = existingRc?.class_size ?? null;
  if (settings.show_class_position && student.class_id && (classPosition === null || !existingRc)) {
    const peers = await dbAll(
      `SELECT st.id,
              COALESCE(AVG(CASE WHEN ex.total_max_score > 0 THEN (ss.total_score / ex.total_max_score) * 100 ELSE ss.total_score END), 0) as avg_pct,
              COUNT(ss.id) as sc_count
       FROM students st
       LEFT JOIN student_scores ss ON ss.student_id = st.id AND ss.academic_session_id = $3 AND ss.term_id = $4
         ${onlyPublished ? "AND ss.status = 'PUBLISHED'" : ''}
       LEFT JOIN examinations ex ON ss.examination_id = ex.id AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
         ${onlyPublished ? "AND ex.status = 'PUBLISHED'" : ''}
       WHERE st.school_id = $1 AND st.class_id = $2 AND (st.is_deleted = 0 OR st.is_deleted IS NULL)
       GROUP BY st.id`,
      `SELECT st.id,
              COALESCE(AVG(CASE WHEN ex.total_max_score > 0 THEN (ss.total_score / ex.total_max_score) * 100 ELSE ss.total_score END), 0) as avg_pct,
              COUNT(ss.id) as sc_count
       FROM students st
       LEFT JOIN student_scores ss ON ss.student_id = st.id AND ss.academic_session_id = ? AND ss.term_id = ?
         ${onlyPublished ? "AND ss.status = 'PUBLISHED'" : ''}
       LEFT JOIN examinations ex ON ss.examination_id = ex.id AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
         ${onlyPublished ? "AND ex.status = 'PUBLISHED'" : ''}
       WHERE st.school_id = ? AND st.class_id = ? AND (st.is_deleted = 0 OR st.is_deleted IS NULL)
       GROUP BY st.id`,
      onlyPublished || true
        ? (
            // Note: parameter order differs between PG ($1=school, $2=class, $3=sess, $4=term) and SQ (?, ?, ?, ?)
            // Pass same SQL param order in both PG and SQ!
            [schoolId, student.class_id, academicSessionId, termId]
          )
        : [schoolId, student.class_id, academicSessionId, termId]
    ).catch(() => []);

    // Wait: SQLite ? positional order in the query above had academic_session_id, term_id BEFORE school_id, class_id!
    // Let's compute rank using clean consistent parameter order below instead to prevent any SQLite positional mismatch!
    void peers;
  }

  // Clean consistent query for class ranking (identical placeholder order for PG and SQLite)
  if (settings.show_class_position && student.class_id && (classPosition === null || !existingRc)) {
    const classStudents = await dbAll(
      `SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT id FROM students WHERE school_id = ? AND class_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [schoolId, student.class_id]
    );
    const classScores = await dbAll(
      `SELECT ss.student_id, ss.total_score, ex.total_max_score
       FROM student_scores ss
       JOIN examinations ex ON ss.examination_id = ex.id
       WHERE ss.school_id = $1 AND ss.academic_session_id = $2 AND ss.term_id = $3
         AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
         ${pubScoreClause}`,
      `SELECT ss.student_id, ss.total_score, ex.total_max_score
       FROM student_scores ss
       JOIN examinations ex ON ss.examination_id = ex.id
       WHERE ss.school_id = ? AND ss.academic_session_id = ? AND ss.term_id = ?
         AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
         ${pubScoreClause}`,
      [schoolId, academicSessionId, termId]
    );
    const byStu = new Map<string, number[]>();
    for (const cs of classScores) {
      if (cs.total_score === null || cs.total_score === undefined) continue;
      const max = Number(cs.total_max_score) > 0 ? Number(cs.total_max_score) : 100;
      const pct = (Number(cs.total_score) / max) * 100;
      if (!byStu.has(cs.student_id)) byStu.set(cs.student_id, []);
      byStu.get(cs.student_id)!.push(pct);
    }
    const ranked = classStudents
      .map((cs: any) => {
        const arr = byStu.get(cs.id) || [];
        const avg = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return { id: cs.id, avg };
      })
      .sort((a, b) => b.avg - a.avg);
    classSize = ranked.length;
    const idx = ranked.findIndex((r) => r.id === studentId);
    if (idx >= 0) {
      let pos = idx + 1;
      for (let k = idx - 1; k >= 0; k--) {
        if (Math.round(ranked[k].avg * 100) === Math.round(ranked[idx].avg * 100)) {
          pos = k + 1;
        } else {
          break;
        }
      }
      classPosition = pos;
    }
  }

  const attFilter = onlyPublished ? 'AND is_published = 1' : '';
  const attRows = await dbAll(
    `SELECT status FROM attendance_records
     WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 AND term_id = $4 ${attFilter}`,
    `SELECT status FROM attendance_records
     WHERE school_id = ? AND student_id = ? AND academic_session_id = ? AND term_id = ? ${attFilter}`,
    [schoolId, studentId, academicSessionId, termId]
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

  const behClause = buildBehaviourClause(visibilityRole);
  const behRows = await dbAll(
    `SELECT category, severity, title, record_date FROM behaviour_records
     WHERE school_id = $1 AND student_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       AND (academic_session_id = $3 OR academic_session_id IS NULL)
       AND (term_id = $4 OR term_id IS NULL)
       ${behClause}`,
    `SELECT category, severity, title, record_date FROM behaviour_records
     WHERE school_id = ? AND student_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       AND (academic_session_id = ? OR academic_session_id IS NULL)
       AND (term_id = ? OR term_id IS NULL)
       ${behClause}`,
    [schoolId, studentId, academicSessionId, termId]
  );
  const behSummary = {
    totalRecords: behRows.length,
    positiveCount: behRows.filter((b) => b.category === 'POSITIVE' || b.category === 'COMMENDATION').length,
    disciplineCount: behRows.filter((b) => b.category === 'DISCIPLINE' || b.category === 'INCIDENT').length,
    highlights: behRows.slice(0, 5),
  };

  const remClause = buildRemarkClause(visibilityRole);
  const officialRemark = await dbGet(
    `SELECT remark_text, staff_name FROM teacher_remarks
     WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 AND term_id = $4 ${remClause} LIMIT 1`,
    `SELECT remark_text, staff_name FROM teacher_remarks
     WHERE school_id = ? AND student_id = ? AND academic_session_id = ? AND term_id = ? ${remClause} LIMIT 1`,
    [schoolId, studentId, academicSessionId, termId]
  );

  const avgScore = existingRc && Number(existingRc.subjects_count || 0) > 0 && scores.length === 0
    ? Number(existingRc.average_score || 0)
    : computedAvg;
  const effectiveTotal = existingRc && Number(existingRc.subjects_count || 0) > 0 && scores.length === 0
    ? Number(existingRc.total_score || 0)
    : totalScore;

  const overallGrade = computeGrade(avgScore, 100, settings.grading_scale);
  const verCode =
    existingRc?.verification_code ||
    `RC-${crypto.createHash('sha256').update(`${schoolId}:${studentId}:${academicSessionId}:${termId}`).digest('hex').slice(0, 6).toUpperCase()}`;

  const breakdown = {
    report_type: 'TERM' as const,
    reportCardId: existingRc?.id || `live_rc_${studentId}_${termId}`,
    verificationCode: verCode,
    isLiveGenerated: !hasPublishedOfficialRc,
    school,
    student,
    sessionName: session?.name || existingRc?.session_name || '',
    termName: term?.name || existingRc?.term_name || '',
    showClassPosition: Boolean(settings.show_class_position),
    total_score: effectiveTotal,
    average_score: avgScore,
    subjects_count: scores.length || Number(existingRc?.subjects_count || 0),
    class_position: settings.show_class_position ? classPosition : null,
    class_size: settings.show_class_position ? classSize : null,
    overall_grade: overallGrade,
    gradingScale: parseGradingScaleSafe(settings.grading_scale),
    passMark: Number(settings.pass_mark ?? 40),
    subjects: scores.map((s) => ({
      subject_id: s.subject_id,
      subject_name: s.subject_name,
      subject_code: s.subject_code,
      ca_score: s.ca_score,
      exam_score: s.exam_score,
      ca_max_score: s.ca_max_score,
      exam_max_score: s.exam_max_score,
      total_score: s.total_score,
      grade: s.grade,
      grade_remark: s.grade_remark,
      subject_remark: s.subject_remark,
    })),
    attendance_summary: attSummary,
    behaviour_summary: behSummary,
    teacher_remark: existingRc?.teacher_remark || officialRemark?.remark_text || '',
    teacher_remark_author: officialRemark?.staff_name || '',
    principal_remark: existingRc?.principal_remark || '',
    published_at: existingRc?.published_at || new Date().toISOString(),
  };

  return {
    source: hasPublishedOfficialRc ? 'OFFICIAL' : 'LIVE',
    reportCard: {
      id: existingRc?.id || `live_rc_${studentId}_${termId}`,
      school_id: schoolId,
      student_id: studentId,
      student_name: student.full_name,
      admission_number: student.admission_number,
      class_id: student.class_id,
      class_name: student.class_name,
      academic_session_id: academicSessionId,
      session_name: session?.name || '',
      term_id: termId,
      term_name: term?.name || '',
      status: existingRc?.status || 'PUBLISHED',
      total_score: breakdown.total_score,
      average_score: breakdown.average_score,
      subjects_count: breakdown.subjects_count,
      class_position: breakdown.class_position,
      class_size: breakdown.class_size,
      teacher_remark: breakdown.teacher_remark,
      principal_remark: breakdown.principal_remark,
      verification_code: verCode,
      published_at: breakdown.published_at,
      report_type: 'TERM' as const,
      breakdown,
    },
  };
}

/**
 * Computes and returns a Full-Session Cumulative Annual Report Card breakdown
 * aggregating 1st Term, 2nd Term, and 3rd Term performance across all subjects in a session.
 */
export async function compileSessionReportCard(
  schoolId: string,
  studentId: string,
  academicSessionId: string,
  options: CompileReportOptions = {}
): Promise<{ reportCard: any; source: 'OFFICIAL' | 'LIVE' } | null> {
  const onlyPublished = Boolean(options.onlyPublished);
  const visibilityRole = options.visibilityRole || (onlyPublished ? 'PARENT' : 'ADMIN');

  const existingSrc = await dbGet(
    `SELECT src.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
            ses.name as session_name
     FROM session_report_cards src
     JOIN students s ON src.student_id = s.id
     LEFT JOIN classes c ON COALESCE(src.class_id, s.class_id) = c.id
     LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
     WHERE src.school_id = $1 AND src.student_id = $2 AND src.academic_session_id = $3
     LIMIT 1`,
    `SELECT src.*, s.full_name as student_name, s.admission_number, COALESCE(c.name, s.class_name) as class_name,
            ses.name as session_name
     FROM session_report_cards src
     JOIN students s ON src.student_id = s.id
     LEFT JOIN classes c ON COALESCE(src.class_id, s.class_id) = c.id
     LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
     WHERE src.school_id = ? AND src.student_id = ? AND src.academic_session_id = ?
     LIMIT 1`,
    [schoolId, studentId, academicSessionId]
  );

  if (!options.forceLive && existingSrc && existingSrc.status === 'PUBLISHED' && existingSrc.snapshot_json) {
    try {
      const parsedBreakdown = JSON.parse(existingSrc.snapshot_json);
      return {
        source: 'OFFICIAL',
        reportCard: {
          ...existingSrc,
          report_type: 'SESSION',
          breakdown: {
            report_type: 'SESSION',
            ...parsedBreakdown,
          },
        },
      };
    } catch {}
  }

  const settings = await getSchoolAcademicSettings(schoolId);
  const school = await dbGet(
    `SELECT id, name, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = $1`,
    `SELECT id, name, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = ?`,
    [schoolId]
  );
  const student = await dbGet(
    `SELECT id, admission_number, full_name, first_name, last_name, gender, class_id, class_name, class_arm_name
     FROM students WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT id, admission_number, full_name, first_name, last_name, gender, class_id, class_name, class_arm_name
     FROM students WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [studentId, schoolId]
  );
  if (!student) return null;

  const session = await dbGet(
    `SELECT id, name FROM academic_sessions WHERE id = $1 AND school_id = $2`,
    `SELECT id, name FROM academic_sessions WHERE id = ? AND school_id = ?`,
    [academicSessionId, schoolId]
  );
  if (!session) return null;

  const sessionTermsRaw = await dbAll(
    `SELECT id, name, start_date, end_date, created_at FROM terms
     WHERE school_id = $1 AND academic_session_id = $2`,
    `SELECT id, name, start_date, end_date, created_at FROM terms
     WHERE school_id = ? AND academic_session_id = ?`,
    [schoolId, academicSessionId]
  );
  const sessionTerms = sortTermsChronologically(sessionTermsRaw);

  const pubScoreClause = onlyPublished ? `AND ss.status = 'PUBLISHED' AND ex.status = 'PUBLISHED'` : '';

  const rawScores = await dbAll(
    `SELECT ss.*, sub.name as subject_name, sub.code as subject_code, ex.total_max_score, ex.ca_max_score, ex.exam_max_score,
            ex.created_at as exam_created_at, t.name as term_name
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     JOIN examinations ex ON ss.examination_id = ex.id
     LEFT JOIN terms t ON ss.term_id = t.id
     WHERE ss.school_id = $1 AND ss.student_id = $2 AND ss.academic_session_id = $3
       AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
       ${pubScoreClause}
     ORDER BY sub.name ASC, ex.created_at DESC`,
    `SELECT ss.*, sub.name as subject_name, sub.code as subject_code, ex.total_max_score, ex.ca_max_score, ex.exam_max_score,
            ex.created_at as exam_created_at, t.name as term_name
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     JOIN examinations ex ON ss.examination_id = ex.id
     LEFT JOIN terms t ON ss.term_id = t.id
     WHERE ss.school_id = ? AND ss.student_id = ? AND ss.academic_session_id = ?
       AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
       ${pubScoreClause}
     ORDER BY sub.name ASC, ex.created_at DESC`,
    [schoolId, studentId, academicSessionId]
  );

  const hasPublishedOfficialSrc = Boolean(existingSrc && existingSrc.status === 'PUBLISHED');
  if (onlyPublished && !hasPublishedOfficialSrc && rawScores.length === 0) {
    return null;
  }

  // Group scores cleanly per subject + term (latest exam per subject+term)
  const subjectTermMap = new Map<string, { subject_id: string; subject_name: string; subject_code: string; byTerm: Map<string, any> }>();
  for (const s of rawScores) {
    if (!subjectTermMap.has(s.subject_id)) {
      subjectTermMap.set(s.subject_id, {
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        subject_code: s.subject_code,
        byTerm: new Map<string, any>(),
      });
    }
    const entry = subjectTermMap.get(s.subject_id)!;
    if (!entry.byTerm.has(s.term_id)) {
      entry.byTerm.set(s.term_id, s);
    }
  }

  // Ensure terms list covers all terms from sessionTerms plus any term referenced in scores
  const termIdsSeen = new Set(sessionTerms.map((t: any) => t.id));
  const extraTerms: any[] = [];
  for (const s of rawScores) {
    if (s.term_id && !termIdsSeen.has(s.term_id)) {
      termIdsSeen.add(s.term_id);
      extraTerms.push({ id: s.term_id, name: s.term_name || 'Term' });
    }
  }
  const orderedTerms = sortTermsChronologically([...sessionTerms, ...extraTerms]);

  const subjects = Array.from(subjectTermMap.values()).map((sub) => {
    let cumulativeTotal = 0;
    let pctSum = 0;
    let termsTaken = 0;

    const termScores = orderedTerms.map((t: any) => {
      const sc = sub.byTerm.get(t.id);
      if (!sc || sc.total_score === null || sc.total_score === undefined) {
        return {
          term_id: t.id,
          term_name: t.name,
          ca_score: null,
          exam_score: null,
          total_score: null,
          percentage: null,
          grade: null,
        };
      }
      const totalVal = Number(sc.total_score || 0);
      const maxVal = Number(sc.total_max_score) > 0 ? Number(sc.total_max_score) : 100;
      const pct = Math.round((totalVal / maxVal) * 10000) / 100;
      cumulativeTotal += totalVal;
      pctSum += pct;
      termsTaken += 1;
      return {
        term_id: t.id,
        term_name: t.name,
        ca_score: sc.ca_score,
        exam_score: sc.exam_score,
        total_score: totalVal,
        percentage: pct,
        grade: sc.grade || computeGrade(pct, 100, settings.grading_scale).grade,
      };
    });

    const cumulativeAvg = termsTaken > 0 ? Math.round((pctSum / termsTaken) * 100) / 100 : 0;
    const gradeInfo = computeGrade(cumulativeAvg, 100, settings.grading_scale);

    return {
      subject_id: sub.subject_id,
      subject_name: sub.subject_name,
      subject_code: sub.subject_code,
      term_scores: termScores,
      terms_taken: termsTaken,
      cumulative_total: Math.round(cumulativeTotal * 100) / 100,
      cumulative_average: cumulativeAvg,
      total_score: cumulativeAvg,
      grade: gradeInfo.grade,
      grade_remark: gradeInfo.remark,
    };
  });

  // Compute term-by-term averages across subjects
  const termAverages = orderedTerms.map((t: any) => {
    const scored = subjects
      .map((sub) => sub.term_scores.find((ts) => ts.term_id === t.id))
      .filter((ts) => ts && ts.percentage !== null);
    const termTotal = Math.round(scored.reduce((acc, ts) => acc + Number(ts!.total_score || 0), 0) * 100) / 100;
    const termAvg =
      scored.length > 0
        ? Math.round((scored.reduce((acc, ts) => acc + Number(ts!.percentage || 0), 0) / scored.length) * 100) / 100
        : 0;
    return {
      term_id: t.id,
      term_name: t.name,
      subjects_count: scored.length,
      total_score: termTotal,
      average_score: termAvg,
      grade: scored.length > 0 ? computeGrade(termAvg, 100, settings.grading_scale).grade : '—',
    };
  });

  const activeSubjects = await dbAll(
    `SELECT id FROM subjects WHERE school_id = $1 AND status = 'ACTIVE' AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT id FROM subjects WHERE school_id = ? AND status = 'ACTIVE' AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [schoolId]
  );

  const sessionTotal = Math.round(subjects.reduce((acc, s) => acc + Number(s.cumulative_total || 0), 0) * 100) / 100;
  const denom =
    settings.missing_score_policy === 'ZERO' && activeSubjects.length > subjects.length
      ? activeSubjects.length
      : subjects.length;
  const sessionAverage =
    denom > 0
      ? Math.round((subjects.reduce((acc, s) => acc + Number(s.cumulative_average || 0), 0) / denom) * 100) / 100
      : Number(existingSrc?.average_score || 0);

  // Class annual position
  let classPosition: number | null = existingSrc?.class_position ?? null;
  let classSize: number | null = existingSrc?.class_size ?? null;
  if (settings.show_class_position && student.class_id && (classPosition === null || !existingSrc)) {
    const classStudents = await dbAll(
      `SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT id FROM students WHERE school_id = ? AND class_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [schoolId, student.class_id]
    );
    const classScores = await dbAll(
      `SELECT ss.student_id, ss.total_score, ex.total_max_score
       FROM student_scores ss
       JOIN examinations ex ON ss.examination_id = ex.id
       WHERE ss.school_id = $1 AND ss.academic_session_id = $2
         AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
         ${pubScoreClause}`,
      `SELECT ss.student_id, ss.total_score, ex.total_max_score
       FROM student_scores ss
       JOIN examinations ex ON ss.examination_id = ex.id
       WHERE ss.school_id = ? AND ss.academic_session_id = ?
         AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
         ${pubScoreClause}`,
      [schoolId, academicSessionId]
    );
    const byStu = new Map<string, number[]>();
    for (const cs of classScores) {
      if (cs.total_score === null || cs.total_score === undefined) continue;
      const max = Number(cs.total_max_score) > 0 ? Number(cs.total_max_score) : 100;
      const pct = (Number(cs.total_score) / max) * 100;
      if (!byStu.has(cs.student_id)) byStu.set(cs.student_id, []);
      byStu.get(cs.student_id)!.push(pct);
    }
    const ranked = classStudents
      .map((cs: any) => {
        const arr = byStu.get(cs.id) || [];
        const avg = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return { id: cs.id, avg };
      })
      .sort((a, b) => b.avg - a.avg);
    classSize = ranked.length;
    const idx = ranked.findIndex((r) => r.id === studentId);
    if (idx >= 0) {
      let pos = idx + 1;
      for (let k = idx - 1; k >= 0; k--) {
        if (Math.round(ranked[k].avg * 100) === Math.round(ranked[idx].avg * 100)) {
          pos = k + 1;
        } else {
          break;
        }
      }
      classPosition = pos;
    }
  }

  // Annual attendance across the session
  const attFilter = onlyPublished ? 'AND is_published = 1' : '';
  const attRows = await dbAll(
    `SELECT status FROM attendance_records
     WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 ${attFilter}`,
    `SELECT status FROM attendance_records
     WHERE school_id = ? AND student_id = ? AND academic_session_id = ? ${attFilter}`,
    [schoolId, studentId, academicSessionId]
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

  // Behaviour summary across session
  const behClause = buildBehaviourClause(visibilityRole);
  const behRows = await dbAll(
    `SELECT category, severity, title, record_date FROM behaviour_records
     WHERE school_id = $1 AND student_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       AND (academic_session_id = $3 OR academic_session_id IS NULL)
       ${behClause}`,
    `SELECT category, severity, title, record_date FROM behaviour_records
     WHERE school_id = ? AND student_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       AND (academic_session_id = ? OR academic_session_id IS NULL)
       ${behClause}`,
    [schoolId, studentId, academicSessionId]
  );
  const behSummary = {
    totalRecords: behRows.length,
    positiveCount: behRows.filter((b) => b.category === 'POSITIVE' || b.category === 'COMMENDATION').length,
    disciplineCount: behRows.filter((b) => b.category === 'DISCIPLINE' || b.category === 'INCIDENT').length,
    highlights: behRows.slice(0, 5),
  };

  // Latest remark across the session if no explicit annual remark saved yet
  const remClause = buildRemarkClause(visibilityRole);
  const officialRemark = await dbGet(
    `SELECT remark_text, staff_name FROM teacher_remarks
     WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 ${remClause}
     ORDER BY updated_at DESC LIMIT 1`,
    `SELECT remark_text, staff_name FROM teacher_remarks
     WHERE school_id = ? AND student_id = ? AND academic_session_id = ? ${remClause}
     ORDER BY updated_at DESC LIMIT 1`,
    [schoolId, studentId, academicSessionId]
  );

  const passMark = Number(settings.pass_mark ?? 40);
  const activeTermAveragesCount = termAverages.filter((t) => t.subjects_count > 0).length;
  const defaultPromotionStatus =
    subjects.length > 0 ? (sessionAverage >= passMark ? 'PROMOTED' : 'PROBATION') : 'PENDING';
  const promotionStatus =
    existingSrc?.promotion_status && existingSrc.promotion_status !== 'PENDING'
      ? existingSrc.promotion_status
      : defaultPromotionStatus;

  const overallGrade = computeGrade(sessionAverage, 100, settings.grading_scale);
  const verCode =
    existingSrc?.verification_code ||
    `SRC-${crypto.createHash('sha256').update(`${schoolId}:${studentId}:${academicSessionId}`).digest('hex').slice(0, 6).toUpperCase()}`;

  const breakdown = {
    report_type: 'SESSION' as const,
    reportCardId: existingSrc?.id || `live_src_${studentId}_${academicSessionId}`,
    verificationCode: verCode,
    isLiveGenerated: !hasPublishedOfficialSrc,
    school,
    student,
    sessionName: session.name,
    termName: 'Full Academic Session (Annual Cumulative)',
    showClassPosition: Boolean(settings.show_class_position),
    total_score: sessionTotal,
    average_score: sessionAverage,
    subjects_count: subjects.length,
    terms_count: activeTermAveragesCount || orderedTerms.length,
    class_position: settings.show_class_position ? classPosition : null,
    class_size: settings.show_class_position ? classSize : null,
    promotion_status: promotionStatus,
    overall_grade: overallGrade,
    gradingScale: parseGradingScaleSafe(settings.grading_scale),
    passMark,
    terms: orderedTerms.map((t: any) => ({ id: t.id, name: t.name })),
    term_averages: termAverages,
    subjects,
    attendance_summary: attSummary,
    behaviour_summary: behSummary,
    teacher_remark: existingSrc?.teacher_remark || officialRemark?.remark_text || '',
    teacher_remark_author: officialRemark?.staff_name || '',
    principal_remark: existingSrc?.principal_remark || '',
    published_at: existingSrc?.published_at || new Date().toISOString(),
  };

  return {
    source: hasPublishedOfficialSrc ? 'OFFICIAL' : 'LIVE',
    reportCard: {
      id: existingSrc?.id || `live_src_${studentId}_${academicSessionId}`,
      school_id: schoolId,
      student_id: studentId,
      student_name: student.full_name,
      admission_number: student.admission_number,
      class_id: student.class_id,
      class_name: student.class_name,
      academic_session_id: academicSessionId,
      session_name: session.name,
      status: existingSrc?.status || 'PUBLISHED',
      total_score: breakdown.total_score,
      average_score: breakdown.average_score,
      subjects_count: breakdown.subjects_count,
      terms_count: breakdown.terms_count,
      class_position: breakdown.class_position,
      class_size: breakdown.class_size,
      promotion_status: promotionStatus,
      term_averages: termAverages,
      teacher_remark: breakdown.teacher_remark,
      principal_remark: breakdown.principal_remark,
      verification_code: verCode,
      published_at: breakdown.published_at,
      report_type: 'SESSION' as const,
      breakdown,
    },
  };
}
