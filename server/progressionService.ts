import crypto from 'node:crypto';
import {
  computeGrade,
  dbAll,
  dbGet,
  getSchoolAcademicSettings,
} from './accessControl.ts';
import {
  computeGpaGradeBand,
  getAcademicClassStanding,
  resolveInstitutionProfile,
} from '../src/utils/institutionMode.ts';
import { sortTermsChronologically } from './reportCardService.ts';

export interface ClassRow {
  id: string;
  name: string;
  level?: string | null;
  category?: string | null;
  order_index?: number | null;
}

export interface NextClassSuggestion {
  nextClass: ClassRow | null;
  isTerminalClass: boolean;
  suggestedAction: 'PROMOTE' | 'GRADUATE';
  reason: string;
}

const K12_LADDER: RegExp[] = [
  /^creche$/i,
  /^play\s*group$/i,
  /^(pre[-\s]?nursery|kg\s*1|kindergarten\s*1)$/i,
  /^nursery\s*1$/i,
  /^nursery\s*2$/i,
  /^(nursery\s*3|kg\s*2|kindergarten\s*2|reception)$/i,
  /^(primary|pry|basic|grade)\s*1$/i,
  /^(primary|pry|basic|grade)\s*2$/i,
  /^(primary|pry|basic|grade)\s*3$/i,
  /^(primary|pry|basic|grade)\s*4$/i,
  /^(primary|pry|basic|grade)\s*5$/i,
  /^(primary|pry|basic|grade)\s*6$/i,
  /^(jss|js|junior\s*secondary)\s*1$/i,
  /^(jss|js|junior\s*secondary)\s*2$/i,
  /^(jss|js|junior\s*secondary)\s*3$/i,
  /^(sss|ss|senior\s*secondary)\s*1$/i,
  /^(sss|ss|senior\s*secondary)\s*2$/i,
  /^(sss|ss|senior\s*secondary)\s*3$/i,
];

function parseNumericProgression(name: string): { prefix: string; num: number; step: number } | null {
  const clean = String(name || '').trim();
  // Match 100 Level, 200L, 300 Level, etc.
  const lvlMatch = clean.match(/^(\d{3})\s*(?:level|lvl|l)\b/i);
  if (lvlMatch) {
    return { prefix: 'LEVEL_100', num: parseInt(lvlMatch[1], 10), step: 100 };
  }
  // Match ND 1, ND I, HND 1, HND II, NCE 1, Year 1, Grade 7, etc.
  const romanMap: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
  const structuredMatch = clean.match(/^(nd|hnd|nce|year|yr|level|lvl|grade|form|class|jss|js|sss|ss|primary|pry|nursery|basic)\s*([1-9]\d*|i{1,3}|iv|v|vi)\b/i);
  if (structuredMatch) {
    const rawPrefix = structuredMatch[1].toUpperCase();
    const rawNum = structuredMatch[2].toLowerCase();
    const num = romanMap[rawNum] ?? parseInt(rawNum, 10);
    if (!Number.isNaN(num)) {
      const normalizedPrefix =
        rawPrefix === 'JS' ? 'JSS' :
        rawPrefix === 'SS' ? 'SSS' :
        rawPrefix === 'PRY' ? 'PRIMARY' :
        rawPrefix === 'YR' ? 'YEAR' :
        rawPrefix === 'LVL' ? 'LEVEL' :
        rawPrefix;
      return { prefix: normalizedPrefix, num, step: 1 };
    }
  }
  return null;
}

/**
 * Smart progression suggestion engine supporting Nigerian K-12 (Creche -> Primary -> JSS -> SSS -> Graduate),
 * Universities (100L -> 200L -> ... -> 500L/600L -> Graduate), Polytechnics (ND 1 -> ND 2 -> HND 1 -> HND 2 -> Graduate),
 * Colleges of Education (NCE 1 -> NCE 2 -> NCE 3 -> Graduate), and custom order_index ladders.
 */
export function suggestNextClass(
  currentClass: ClassRow | null | undefined,
  allClasses: ClassRow[],
  isTertiary = false
): NextClassSuggestion {
  if (!currentClass) {
    return {
      nextClass: null,
      isTerminalClass: false,
      suggestedAction: 'PROMOTE',
      reason: 'Select a source class or level to preview progression.',
    };
  }

  const others = allClasses.filter((c) => c.id !== currentClass.id);
  const currentName = String(currentClass.name || '').trim();

  // 1. Numeric / structured ladder (e.g. 100 Level -> 200 Level, ND 1 -> ND 2, JSS 1 -> JSS 2)
  const parsed = parseNumericProgression(currentName);
  if (parsed) {
    const targetNum = parsed.num + parsed.step;
    const directNext = others.find((c) => {
      const p = parseNumericProgression(c.name);
      return p && p.prefix === parsed.prefix && p.num === targetNum;
    });
    if (directNext) {
      return {
        nextClass: directNext,
        isTerminalClass: false,
        suggestedAction: 'PROMOTE',
        reason: `Automatic progression from ${currentName} to ${directNext.name}.`,
      };
    }

    // Cross-stage transitions (e.g., Primary 6 -> JSS 1, JSS 3 -> SSS 1, Nursery 2/3 -> Primary 1)
    if (!isTertiary) {
      const k12Idx = K12_LADDER.findIndex((rx) => rx.test(currentName));
      if (k12Idx >= 0) {
        for (let i = k12Idx + 1; i < K12_LADDER.length; i++) {
          const match = others.find((c) => K12_LADDER[i].test(String(c.name || '').trim()));
          if (match) {
            return {
              nextClass: match,
              isTerminalClass: false,
              suggestedAction: 'PROMOTE',
              reason: `Stage transition from ${currentName} to ${match.name}.`,
            };
          }
        }
        return {
          nextClass: null,
          isTerminalClass: true,
          suggestedAction: 'GRADUATE',
          reason: `${currentName} is the final graduating class in your institution.`,
        };
      }
    } else {
      // Tertiary terminal detection: e.g. 400 Level / 500 Level / ND 2 / HND 2 / NCE 3 with no higher level in same track
      if (parsed.prefix === 'ND' && parsed.num >= 2) {
        // ND 2 normally graduates with National Diploma (unless institution wants to graduate into Alumni)
        return {
          nextClass: null,
          isTerminalClass: true,
          suggestedAction: 'GRADUATE',
          reason: `${currentName} completes the National Diploma (ND) programme — ready for graduation.`,
        };
      }
      return {
        nextClass: null,
        isTerminalClass: true,
        suggestedAction: 'GRADUATE',
        reason: `${currentName} is the highest level configured — students are ready to graduate.`,
      };
    }
  }

  // 2. K-12 regex ladder for non-numeric names (e.g. Creche -> Nursery 1)
  if (!isTertiary) {
    const k12Idx = K12_LADDER.findIndex((rx) => rx.test(currentName));
    if (k12Idx >= 0) {
      for (let i = k12Idx + 1; i < K12_LADDER.length; i++) {
        const match = others.find((c) => K12_LADDER[i].test(String(c.name || '').trim()));
        if (match) {
          return {
            nextClass: match,
            isTerminalClass: false,
            suggestedAction: 'PROMOTE',
            reason: `Progression from ${currentName} to ${match.name}.`,
          };
        }
      }
      return {
        nextClass: null,
        isTerminalClass: true,
        suggestedAction: 'GRADUATE',
        reason: `${currentName} is the final graduating class.`,
      };
    }
  }

  // 3. Fallback to explicit order_index ordering if classes were ordered manually
  const ordered = [...allClasses].sort((a, b) => {
    const diff = Number(a.order_index ?? 999) - Number(b.order_index ?? 999);
    if (diff !== 0) return diff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  const currentIdx = ordered.findIndex((c) => c.id === currentClass.id);
  if (currentIdx >= 0 && currentIdx < ordered.length - 1) {
    const nextByOrder = ordered[currentIdx + 1];
    return {
      nextClass: nextByOrder,
      isTerminalClass: false,
      suggestedAction: 'PROMOTE',
      reason: `Next class by institutional sequence: ${nextByOrder.name}.`,
    };
  }

  return {
    nextClass: null,
    isTerminalClass: true,
    suggestedAction: 'GRADUATE',
    reason: `${currentName} is the final class/level in sequence — ready for graduation.`,
  };
}

/**
 * Resolves the exact historical class & arm a student belonged to during a given academic_session_id,
 * guaranteeing that promoting or graduating a student NEVER alters the class/level shown on prior
 * sessions' report cards or multi-year career transcripts.
 */
export async function resolveHistoricalStudentClass(
  schoolId: string,
  studentId: string,
  academicSessionId: string,
  fallbackStudent: {
    class_id?: string | null;
    class_name?: string | null;
    class_arm_id?: string | null;
    class_arm_name?: string | null;
  },
  explicitClassId?: string | null
): Promise<{
  class_id: string | null;
  class_name: string | null;
  class_arm_id: string | null;
  class_arm_name: string | null;
}> {
  // 1. Explicit class_id from an already-saved report card for that session
  if (explicitClassId) {
    const cls = await dbGet(
      `SELECT id, name FROM classes WHERE id = $1 AND school_id = $2 LIMIT 1`,
      `SELECT id, name FROM classes WHERE id = ? AND school_id = ? LIMIT 1`,
      [explicitClassId, schoolId]
    );
    if (cls) {
      return {
        class_id: cls.id,
        class_name: cls.name,
        class_arm_id: fallbackStudent.class_arm_id || null,
        class_arm_name: fallbackStudent.class_arm_name || null,
      };
    }
  }

  // 2. Immutable enrollment/progression history:
  //    a) If student was promoted/graduated OUT of this session (previous_session_id = academicSessionId),
  //       their class during this session was previous_class_id / previous_class_name!
  try {
    const exitedFromSession = await dbGet(
      `SELECT previous_class_id, previous_class_name, previous_class_arm_id, previous_class_arm_name
       FROM student_enrollment_history
       WHERE school_id = $1 AND student_id = $2 AND previous_session_id = $3
         AND outcome != 'ROLLED_BACK'
       ORDER BY created_at DESC LIMIT 1`,
      `SELECT previous_class_id, previous_class_name, previous_class_arm_id, previous_class_arm_name
       FROM student_enrollment_history
       WHERE school_id = ? AND student_id = ? AND previous_session_id = ?
         AND outcome != 'ROLLED_BACK'
       ORDER BY created_at DESC LIMIT 1`,
      [schoolId, studentId, academicSessionId]
    );
    if (exitedFromSession && (exitedFromSession.previous_class_id || exitedFromSession.previous_class_name)) {
      return {
        class_id: exitedFromSession.previous_class_id || null,
        class_name: exitedFromSession.previous_class_name || null,
        class_arm_id: exitedFromSession.previous_class_arm_id || null,
        class_arm_name: exitedFromSession.previous_class_arm_name || null,
      };
    }

    // b) If student was promoted/enrolled INTO this session (academic_session_id = academicSessionId)
    const enteredSession = await dbGet(
      `SELECT class_id, class_name, class_arm_id, class_arm_name
       FROM student_enrollment_history
       WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3
         AND outcome != 'ROLLED_BACK'
       ORDER BY created_at DESC LIMIT 1`,
      `SELECT class_id, class_name, class_arm_id, class_arm_name
       FROM student_enrollment_history
       WHERE school_id = ? AND student_id = ? AND academic_session_id = ?
         AND outcome != 'ROLLED_BACK'
       ORDER BY created_at DESC LIMIT 1`,
      [schoolId, studentId, academicSessionId]
    );
    if (enteredSession && (enteredSession.class_id || enteredSession.class_name)) {
      return {
        class_id: enteredSession.class_id || null,
        class_name: enteredSession.class_name || null,
        class_arm_id: enteredSession.class_arm_id || null,
        class_arm_name: enteredSession.class_arm_name || null,
      };
    }
  } catch {
    // Table may not exist on legacy DB before migration completes
  }

  // 3. Score / exam class snapshot recorded during that academic session
  const scoreClass = await dbGet(
    `SELECT COALESCE(ss.class_id, ex.class_id) as resolved_class_id, c.name as resolved_class_name
     FROM student_scores ss
     JOIN examinations ex ON ss.examination_id = ex.id
     LEFT JOIN classes c ON COALESCE(ss.class_id, ex.class_id) = c.id
     WHERE ss.school_id = $1 AND ss.student_id = $2 AND ss.academic_session_id = $3
       AND COALESCE(ss.class_id, ex.class_id) IS NOT NULL
     ORDER BY ss.updated_at DESC LIMIT 1`,
    `SELECT COALESCE(ss.class_id, ex.class_id) as resolved_class_id, c.name as resolved_class_name
     FROM student_scores ss
     JOIN examinations ex ON ss.examination_id = ex.id
     LEFT JOIN classes c ON COALESCE(ss.class_id, ex.class_id) = c.id
     WHERE ss.school_id = ? AND ss.student_id = ? AND ss.academic_session_id = ?
       AND COALESCE(ss.class_id, ex.class_id) IS NOT NULL
     ORDER BY ss.updated_at DESC LIMIT 1`,
    [schoolId, studentId, academicSessionId]
  );
  if (scoreClass && (scoreClass.resolved_class_id || scoreClass.resolved_class_name)) {
    return {
      class_id: scoreClass.resolved_class_id || null,
      class_name: scoreClass.resolved_class_name || null,
      class_arm_id: fallbackStudent.class_arm_id || null,
      class_arm_name: fallbackStudent.class_arm_name || null,
    };
  }

  // 4. Fallback to student's current class
  return {
    class_id: fallbackStudent.class_id || null,
    class_name: fallbackStudent.class_name || null,
    class_arm_id: fallbackStudent.class_arm_id || null,
    class_arm_name: fallbackStudent.class_arm_name || null,
  };
}

function getSessionSortKey(ses: { name?: string | null; start_date?: string | null; created_at?: string | null }): string {
  if (ses.start_date) return String(ses.start_date);
  const yrMatch = String(ses.name || '').match(/(20\d{2}|19\d{2})/);
  if (yrMatch) return `${yrMatch[1]}-09-01`;
  return String(ses.created_at || ses.name || '9999');
}

function getK12CareerStanding(avg: number, passMark: number): string {
  if (avg >= 75) return 'Distinction';
  if (avg >= 65) return 'Merit / Very Good';
  if (avg >= 50) return 'Credit';
  if (avg >= passMark) return 'Pass';
  return 'Academic Probation';
}

export interface CompileCareerTranscriptOptions {
  onlyPublished?: boolean;
  visibilityRole?: 'ADMIN' | 'TEACHER' | 'PARENT' | 'STUDENT';
}

/**
 * Compiles a complete Multi-Year Cumulative Academic Career Transcript / Final Graduation Result
 * aggregating EVERY academic session, level/class, term/semester, and subject/course across
 * a student's entire tenure at the school or higher institution.
 */
export async function compileCareerTranscript(
  schoolId: string,
  studentId: string,
  options: CompileCareerTranscriptOptions = {}
): Promise<any | null> {
  const onlyPublished = Boolean(options.onlyPublished);

  const student = await dbGet(
    `SELECT s.*, COALESCE(c.name, s.class_name) as current_class_name
     FROM students s
     LEFT JOIN classes c ON s.class_id = c.id
     WHERE s.id = $1 AND s.school_id = $2 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
     LIMIT 1`,
    `SELECT s.*, COALESCE(c.name, s.class_name) as current_class_name
     FROM students s
     LEFT JOIN classes c ON s.class_id = c.id
     WHERE s.id = ? AND s.school_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
     LIMIT 1`,
    [studentId, schoolId]
  );
  if (!student) return null;

  const school = await dbGet(
    `SELECT id, name, type, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = $1`,
    `SELECT id, name, type, address, state, lga, phone, email, website, logo_url FROM schools WHERE id = ?`,
    [schoolId]
  );
  const schoolTenantSettings = await dbGet(
    `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json, current_term, current_academic_session
     FROM school_settings WHERE school_id = $1 LIMIT 1`,
    `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json, current_term, current_academic_session
     FROM school_settings WHERE school_id = ? LIMIT 1`,
    [schoolId]
  );
  const acadSettings = await getSchoolAcademicSettings(schoolId);
  const instProfile = resolveInstitutionProfile(school, schoolTenantSettings);
  const isGpaMode = instProfile.gradingMode === 'GPA_5' || instProfile.gradingMode === 'GPA_4';
  const passMark = Number(acadSettings.pass_mark ?? 40);

  // Check if an official career_transcripts record already exists
  let existingCt: any = null;
  try {
    existingCt = await dbGet(
      `SELECT * FROM career_transcripts WHERE school_id = $1 AND student_id = $2 LIMIT 1`,
      `SELECT * FROM career_transcripts WHERE school_id = ? AND student_id = ? LIMIT 1`,
      [schoolId, studentId]
    );
  } catch {}

  const pubClause = onlyPublished ? `AND ss.status = 'PUBLISHED' AND ex.status = 'PUBLISHED'` : '';

  // Load ALL scores across ALL sessions and terms for this student
  const allScores = await dbAll(
    `SELECT ss.*,
            sub.name as subject_name, sub.code as subject_code, COALESCE(sub.credit_units, 3) as credit_units,
            ex.title as exam_title, ex.ca_max_score, ex.exam_max_score, ex.total_max_score, ex.class_id as exam_class_id, ex.created_at as exam_created_at,
            ses.name as session_name, ses.start_date as session_start_date, ses.end_date as session_end_date, ses.created_at as session_created_at,
            t.name as term_name, t.start_date as term_start_date, t.created_at as term_created_at
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     JOIN examinations ex ON ss.examination_id = ex.id
     LEFT JOIN academic_sessions ses ON ss.academic_session_id = ses.id
     LEFT JOIN terms t ON ss.term_id = t.id
     WHERE ss.school_id = $1 AND ss.student_id = $2
       AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
       ${pubClause}
     ORDER BY ex.created_at DESC`,
    `SELECT ss.*,
            sub.name as subject_name, sub.code as subject_code, COALESCE(sub.credit_units, 3) as credit_units,
            ex.title as exam_title, ex.ca_max_score, ex.exam_max_score, ex.total_max_score, ex.class_id as exam_class_id, ex.created_at as exam_created_at,
            ses.name as session_name, ses.start_date as session_start_date, ses.end_date as session_end_date, ses.created_at as session_created_at,
            t.name as term_name, t.start_date as term_start_date, t.created_at as term_created_at
     FROM student_scores ss
     JOIN subjects sub ON ss.subject_id = sub.id
     JOIN examinations ex ON ss.examination_id = ex.id
     LEFT JOIN academic_sessions ses ON ss.academic_session_id = ses.id
     LEFT JOIN terms t ON ss.term_id = t.id
     WHERE ss.school_id = ? AND ss.student_id = ?
       AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
       ${pubClause}
     ORDER BY ex.created_at DESC`,
    [schoolId, studentId]
  );

  // Load enrollment & progression history
  let progressionHistory: any[] = [];
  try {
    progressionHistory = await dbAll(
      `SELECT * FROM student_enrollment_history
       WHERE school_id = $1 AND student_id = $2 AND outcome != 'ROLLED_BACK'
       ORDER BY created_at ASC`,
      `SELECT * FROM student_enrollment_history
       WHERE school_id = ? AND student_id = ? AND outcome != 'ROLLED_BACK'
       ORDER BY created_at ASC`,
      [schoolId, studentId]
    );
  } catch {}

  // Load existing session report cards (to capture saved remarks / promotion decisions)
  const sessionCards = await dbAll(
    `SELECT src.*, ses.name as session_name, ses.start_date as session_start_date, ses.created_at as session_created_at
     FROM session_report_cards src
     LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
     WHERE src.school_id = $1 AND src.student_id = $2
       ${onlyPublished ? "AND src.status = 'PUBLISHED'" : ''}`,
    `SELECT src.*, ses.name as session_name, ses.start_date as session_start_date, ses.created_at as session_created_at
     FROM session_report_cards src
     LEFT JOIN academic_sessions ses ON src.academic_session_id = ses.id
     WHERE src.school_id = ? AND src.student_id = ?
       ${onlyPublished ? "AND src.status = 'PUBLISHED'" : ''}`,
    [schoolId, studentId]
  );

  // If portal viewer requests published transcript and there is neither published official transcript nor any published scores
  if (onlyPublished && (!existingCt || existingCt.status !== 'PUBLISHED') && allScores.length === 0 && sessionCards.length === 0) {
    return null;
  }

  // Discover unique sessions touched by scores or session_report_cards
  const sessionMetaMap = new Map<string, { id: string; name: string; start_date: string | null; created_at: string | null }>();
  for (const s of allScores) {
    if (s.academic_session_id && !sessionMetaMap.has(s.academic_session_id)) {
      sessionMetaMap.set(s.academic_session_id, {
        id: s.academic_session_id,
        name: s.session_name || 'Academic Session',
        start_date: s.session_start_date || null,
        created_at: s.session_created_at || null,
      });
    }
  }
  for (const sc of sessionCards) {
    if (sc.academic_session_id && !sessionMetaMap.has(sc.academic_session_id)) {
      sessionMetaMap.set(sc.academic_session_id, {
        id: sc.academic_session_id,
        name: sc.session_name || 'Academic Session',
        start_date: sc.session_start_date || null,
        created_at: sc.session_created_at || null,
      });
    }
  }

  const orderedSessions = Array.from(sessionMetaMap.values()).sort((a, b) =>
    getSessionSortKey(a).localeCompare(getSessionSortKey(b))
  );

  // Deduplicate scores per (session_id, term_id, subject_id) taking the latest exam entry
  const dedupScoreMap = new Map<string, any>();
  for (const s of allScores) {
    if (!s.academic_session_id || !s.subject_id) continue;
    const key = `${s.academic_session_id}::${s.term_id || 'DEFAULT'}::${s.subject_id}`;
    if (!dedupScoreMap.has(key)) {
      dedupScoreMap.set(key, s);
    }
  }

  let runningLifetimeUnits = 0;
  let runningLifetimeUnitsEarned = 0;
  let runningLifetimeQualityPoints = 0;
  let runningLifetimePctSum = 0;
  let runningLifetimeCourseCount = 0;
  let totalTermsCount = 0;

  // Track every attempt per course code/subject to detect carryovers and whether later cleared
  const courseAttempts: Array<{
    subject_id: string;
    subject_key: string;
    subject_code: string;
    subject_name: string;
    credit_units: number;
    session_id: string;
    session_name: string;
    session_order: number;
    term_id: string;
    term_name: string;
    term_order: number;
    percentage: number;
    grade: string;
    passed: boolean;
  }> = [];

  const sessionBreakdowns: any[] = [];

  for (let sIdx = 0; sIdx < orderedSessions.length; sIdx++) {
    const ses = orderedSessions[sIdx];
    const matchingSrc = sessionCards.find((c) => c.academic_session_id === ses.id);
    const histClass = await resolveHistoricalStudentClass(
      schoolId,
      studentId,
      ses.id,
      {
        class_id: student.class_id,
        class_name: student.current_class_name || student.class_name,
        class_arm_id: student.class_arm_id,
        class_arm_name: student.class_arm_name,
      },
      matchingSrc?.class_id || null
    );

    // Collect terms for this session
    const sesScores = Array.from(dedupScoreMap.values()).filter((s) => s.academic_session_id === ses.id);
    const termMap = new Map<string, { id: string; name: string; start_date: string | null; created_at: string | null; scores: any[] }>();
    for (const sc of sesScores) {
      const tid = sc.term_id || 'DEFAULT';
      if (!termMap.has(tid)) {
        termMap.set(tid, {
          id: tid,
          name: sc.term_name || (instProfile.isTertiary ? 'Semester' : 'Term'),
          start_date: sc.term_start_date || null,
          created_at: sc.term_created_at || null,
          scores: [],
        });
      }
      termMap.get(tid)!.scores.push(sc);
    }

    const orderedTerms = sortTermsChronologically(Array.from(termMap.values()));

    let sessionUnitsAttempted = 0;
    let sessionUnitsEarned = 0;
    let sessionQualityPoints = 0;
    let sessionPctSum = 0;
    let sessionCourseCount = 0;

    const compiledTerms: any[] = [];
    for (let tIdx = 0; tIdx < orderedTerms.length; tIdx++) {
      const t = orderedTerms[tIdx];
      totalTermsCount += 1;

      let termUnitsAttempted = 0;
      let termUnitsEarned = 0;
      let termQualityPoints = 0;
      let termPctSum = 0;

      const sortedTermScores = [...t.scores].sort((a, b) =>
        String(a.subject_code || a.subject_name || '').localeCompare(String(b.subject_code || b.subject_name || ''))
      );

      const compiledCourses = sortedTermScores.map((s) => {
        const units = Number(s.credit_units) > 0 ? Number(s.credit_units) : 3;
        const maxScore = Number(s.total_max_score) > 0 ? Number(s.total_max_score) : 100;
        const rawScore = Number(s.total_score ?? 0);
        const pct = Math.round(((rawScore / maxScore) * 100) * 100) / 100;
        const passed = pct >= passMark;

        let grade = s.grade || '';
        let remark = s.grade_remark || '';
        let gradePoint: number | null = null;
        let qualityPoints: number | null = null;

        if (isGpaMode) {
          const band = computeGpaGradeBand(pct, instProfile.gradingMode);
          grade = band.grade;
          remark = band.remark;
          gradePoint = band.points;
          qualityPoints = Math.round(units * band.points * 100) / 100;
          termUnitsAttempted += units;
          if (passed) termUnitsEarned += units;
          termQualityPoints += qualityPoints;
        } else {
          const band = computeGrade(pct, 100, acadSettings.grading_scale);
          grade = band.grade;
          remark = band.remark;
        }

        termPctSum += pct;

        const normKey = String(s.subject_code || '').trim().toUpperCase() || String(s.subject_id);
        courseAttempts.push({
          subject_id: s.subject_id,
          subject_key: normKey,
          subject_code: s.subject_code || '',
          subject_name: s.subject_name,
          credit_units: units,
          session_id: ses.id,
          session_name: ses.name,
          session_order: sIdx,
          term_id: t.id,
          term_name: t.name,
          term_order: tIdx,
          percentage: pct,
          grade,
          passed,
        });

        return {
          subject_id: s.subject_id,
          subject_code: s.subject_code || '',
          subject_name: s.subject_name,
          credit_units: units,
          ca_score: s.ca_score ?? null,
          exam_score: s.exam_score ?? null,
          total_score: rawScore,
          percentage: pct,
          grade,
          grade_point: gradePoint,
          quality_points: qualityPoints,
          remark,
          passed,
        };
      });

      const termAvg = compiledCourses.length > 0 ? Math.round((termPctSum / compiledCourses.length) * 100) / 100 : 0;
      const termGpa = isGpaMode && termUnitsAttempted > 0
        ? Math.round((termQualityPoints / termUnitsAttempted) * 100) / 100
        : null;

      sessionUnitsAttempted += termUnitsAttempted;
      sessionUnitsEarned += termUnitsEarned;
      sessionQualityPoints += termQualityPoints;
      sessionPctSum += termPctSum;
      sessionCourseCount += compiledCourses.length;

      compiledTerms.push({
        term_id: t.id,
        term_name: t.name,
        courses_count: compiledCourses.length,
        average_score: termAvg,
        gpa: termGpa,
        credit_units_attempted: isGpaMode ? termUnitsAttempted : null,
        credit_units_earned: isGpaMode ? termUnitsEarned : null,
        quality_points: isGpaMode ? Math.round(termQualityPoints * 100) / 100 : null,
        courses: compiledCourses,
      });
    }

    runningLifetimeUnits += sessionUnitsAttempted;
    runningLifetimeUnitsEarned += sessionUnitsEarned;
    runningLifetimeQualityPoints += sessionQualityPoints;
    runningLifetimePctSum += sessionPctSum;
    runningLifetimeCourseCount += sessionCourseCount;

    const sessionAvg = sessionCourseCount > 0 ? Math.round((sessionPctSum / sessionCourseCount) * 100) / 100 : 0;
    const sessionGpa = isGpaMode && sessionUnitsAttempted > 0
      ? Math.round((sessionQualityPoints / sessionUnitsAttempted) * 100) / 100
      : null;
    const runningCgpa = isGpaMode && runningLifetimeUnits > 0
      ? Math.round((runningLifetimeQualityPoints / runningLifetimeUnits) * 100) / 100
      : null;
    const runningAverage = runningLifetimeCourseCount > 0
      ? Math.round((runningLifetimePctSum / runningLifetimeCourseCount) * 100) / 100
      : 0;

    // Outcome recorded when progressing out of this session
    const exitEvent = progressionHistory.find((h) => h.previous_session_id === ses.id);
    const sessionOutcome =
      exitEvent?.outcome ||
      matchingSrc?.promotion_status ||
      (student.graduation_session_id === ses.id ? 'GRADUATED' : 'COMPLETED');

    sessionBreakdowns.push({
      academic_session_id: ses.id,
      session_name: ses.name,
      class_id: histClass.class_id,
      class_name: histClass.class_name || 'N/A',
      class_arm_name: histClass.class_arm_name || null,
      outcome: sessionOutcome,
      terms_count: compiledTerms.length,
      courses_count: sessionCourseCount,
      session_average: sessionAvg,
      session_gpa: sessionGpa,
      credit_units_attempted: isGpaMode ? sessionUnitsAttempted : null,
      credit_units_earned: isGpaMode ? sessionUnitsEarned : null,
      quality_points: isGpaMode ? Math.round(sessionQualityPoints * 100) / 100 : null,
      cumulative_cgpa_after: runningCgpa,
      cumulative_average_after: runningAverage,
      terms: compiledTerms,
    });
  }

  // Analyze Carryovers / Failed Courses & whether later retaken/cleared
  const carryovers: any[] = [];
  for (const attempt of courseAttempts) {
    if (!attempt.passed) {
      const laterPass = courseAttempts.find(
        (other) =>
          (other.subject_id === attempt.subject_id ||
            (attempt.subject_code && other.subject_code && other.subject_code.toUpperCase() === attempt.subject_code.toUpperCase()) ||
            other.subject_name.trim().toLowerCase() === attempt.subject_name.trim().toLowerCase()) &&
          other.passed &&
          (other.session_order > attempt.session_order ||
            (other.session_order === attempt.session_order && other.term_order > attempt.term_order))
      );
      carryovers.push({
        subject_id: attempt.subject_id,
        subject_code: attempt.subject_code,
        subject_name: attempt.subject_name,
        credit_units: attempt.credit_units,
        failed_session_name: attempt.session_name,
        failed_term_name: attempt.term_name,
        failed_score: attempt.percentage,
        failed_grade: attempt.grade,
        cleared: Boolean(laterPass),
        cleared_session_name: laterPass?.session_name || null,
        cleared_term_name: laterPass?.term_name || null,
        cleared_score: laterPass?.percentage ?? null,
        cleared_grade: laterPass?.grade || null,
      });
    }
  }
  const unclearedCarryoversCount = carryovers.filter((c) => !c.cleared).length;

  // Lifetime Attendance Summary
  const attClause = onlyPublished ? 'AND is_published = 1' : '';
  const attRows = await dbAll(
    `SELECT status FROM attendance_records WHERE school_id = $1 AND student_id = $2 ${attClause}`,
    `SELECT status FROM attendance_records WHERE school_id = ? AND student_id = ? ${attClause}`,
    [schoolId, studentId]
  );
  const attTotal = attRows.length;
  const attPresent = attRows.filter((a) => a.status === 'PRESENT').length;
  const attLate = attRows.filter((a) => a.status === 'LATE').length;
  const attAbsent = attRows.filter((a) => a.status === 'ABSENT').length;
  const attExcused = attRows.filter((a) => a.status === 'EXCUSED').length;
  const attendanceLifetime = {
    totalDays: attTotal,
    present: attPresent,
    late: attLate,
    absent: attAbsent,
    excused: attExcused,
    attendanceRatePct: attTotal > 0 ? Math.round(((attPresent + attLate) / attTotal) * 1000) / 10 : 0,
  };

  // Financial Clearance Summary across ALL sessions (historical arrears never disappear on promotion!)
  const invRow = await dbGet(
    `SELECT COALESCE(SUM(total), 0) as billed, COALESCE(SUM(amount_paid), 0) as paid, COALESCE(SUM(balance), 0) as balance, COUNT(*) as invoice_count
     FROM invoices
     WHERE school_id = $1 AND student_id = $2 AND status != 'CANCELLED' AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT COALESCE(SUM(total), 0) as billed, COALESCE(SUM(amount_paid), 0) as paid, COALESCE(SUM(balance), 0) as balance, COUNT(*) as invoice_count
     FROM invoices
     WHERE school_id = ? AND student_id = ? AND status != 'CANCELLED'`,
    [schoolId, studentId]
  );
  const feeClearance = {
    invoice_count: Number(invRow?.invoice_count || 0),
    total_billed_kobo: Number(invRow?.billed || 0),
    total_paid_kobo: Number(invRow?.paid || 0),
    outstanding_balance_kobo: Number(invRow?.balance || 0),
    is_cleared: Number(invRow?.balance || 0) <= 0,
  };

  // Lifetime GPA / Average & Final Standing
  const lifetimeCgpa = isGpaMode && runningLifetimeUnits > 0
    ? Math.round((runningLifetimeQualityPoints / runningLifetimeUnits) * 100) / 100
    : null;
  const lifetimeAverage = runningLifetimeCourseCount > 0
    ? Math.round((runningLifetimePctSum / runningLifetimeCourseCount) * 100) / 100
    : 0;
  const finalStanding = isGpaMode
    ? (lifetimeCgpa !== null ? getAcademicClassStanding(lifetimeCgpa, instProfile.gradingMode) : 'No Graded Courses Yet')
    : (runningLifetimeCourseCount > 0 ? getK12CareerStanding(lifetimeAverage, passMark) : 'No Graded Subjects Yet');

  let graduationSessionName: string | null = existingCt?.graduation_session_name || null;
  if (!graduationSessionName && student.graduation_session_id) {
    const gSes = await dbGet(
      `SELECT name FROM academic_sessions WHERE id = $1 LIMIT 1`,
      `SELECT name FROM academic_sessions WHERE id = ? LIMIT 1`,
      [student.graduation_session_id]
    );
    graduationSessionName = gSes?.name || null;
  }

  const verificationCode =
    existingCt?.verification_code ||
    `CTR-${crypto.createHash('sha256').update(`CAREER:${schoolId}:${studentId}`).digest('hex').slice(0, 6).toUpperCase()}`;

  return {
    id: existingCt?.id || `live_ctr_${studentId}`,
    school_id: schoolId,
    student_id: studentId,
    verification_code: verificationCode,
    status: existingCt?.status || 'DRAFT',
    is_official: existingCt?.status === 'PUBLISHED',
    published_at: existingCt?.published_at || null,
    generated_at: new Date().toISOString(),
    school,
    institution_profile: {
      category: instProfile.category,
      isTertiary: instProfile.isTertiary,
      cycleType: instProfile.cycleType,
      gradingMode: instProfile.gradingMode,
      gpaScaleMax: instProfile.gpaScaleMax,
      labels: instProfile.labels,
    },
    student: {
      id: student.id,
      full_name: student.full_name || `${student.first_name || ''} ${student.last_name || ''}`.trim(),
      first_name: student.first_name,
      last_name: student.last_name,
      admission_number: student.admission_number,
      gender: student.gender,
      date_of_birth: student.date_of_birth,
      admission_date: student.admission_date,
      graduation_date: student.graduation_date || null,
      graduation_session_name: graduationSessionName,
      student_status: String(student.student_status || 'ACTIVE').toUpperCase(),
      current_class_id: student.class_id,
      current_class_name: student.current_class_name || student.class_name || 'Unassigned',
      current_class_arm_name: student.class_arm_name || null,
    },
    summary: {
      grading_mode: instProfile.gradingMode,
      gpa_scale_max: instProfile.gpaScaleMax,
      sessions_count: sessionBreakdowns.length,
      terms_count: totalTermsCount,
      total_subjects_courses: runningLifetimeCourseCount,
      total_credit_units_attempted: isGpaMode ? runningLifetimeUnits : null,
      total_credit_units_earned: isGpaMode ? runningLifetimeUnitsEarned : null,
      total_grade_points: isGpaMode ? Math.round(runningLifetimeQualityPoints * 100) / 100 : null,
      lifetime_cgpa: lifetimeCgpa,
      lifetime_average: lifetimeAverage,
      final_standing: finalStanding,
      pass_mark: passMark,
      total_carryovers_ever: carryovers.length,
      uncleared_carryovers_count: unclearedCarryoversCount,
      graduation_status: String(student.student_status || 'ACTIVE').toUpperCase(),
      graduation_session_name: graduationSessionName,
    },
    sessions: sessionBreakdowns,
    carryovers,
    attendance_lifetime: attendanceLifetime,
    fee_clearance: feeClearance,
    progression_timeline: progressionHistory,
    registrar_remark: existingCt?.registrar_remark || '',
    principal_remark: existingCt?.principal_remark || '',
  };
}
