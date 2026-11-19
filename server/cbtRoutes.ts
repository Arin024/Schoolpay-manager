import { Router } from 'express';
import { cacheDb, getPgPool, queryPg } from './db.ts';
import {
  requireAuth,
  requireTenant,
  requireRole,
  type AuthenticatedRequest,
} from './tenantMiddleware.ts';
import {
  ADMIN_ONLY_ROLES,
  canAccessStudent,
  computeGrade,
  dbAll,
  dbGet,
  getAuthorizedStudentIds,
  getEffectiveRoleName,
  getSchoolAcademicSettings,
  newId,
} from './accessControl.ts';
import { logAudit } from './audit.ts';
import { sanitizeCsvCell, wrapRouterAsync } from './securityUtils.ts';

export const cbtRouter = wrapRouterAsync(Router());

const CBT_AUTHOR_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'STAFF'];

async function execWrite(pgSql: string, sqliteSql: string, pgParams: any[], sqliteParams?: any[]) {
  const pool = getPgPool();
  if (pool) {
    await queryPg(pgSql, pgParams);
  }
  try {
    cacheDb.prepare(sqliteSql).run(...(sqliteParams ?? pgParams));
  } catch (err: any) {
    console.warn('[CBT SQLite Cache Sync Notice]', err?.message);
  }
}

function validateImageUrl(val: unknown): { ok: boolean; value: string | null; message?: string } {
  if (val === undefined || val === null || String(val).trim() === '') {
    return { ok: true, value: null };
  }
  const s = String(val).trim();
  if (s.startsWith('data:image/')) {
    if (s.length > 3_000_000) {
      return { ok: false, value: null, message: 'Diagram image is too large (max 2MB).' };
    }
    return { ok: true, value: s };
  }
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) {
    if (s.length > 2048) return { ok: false, value: null, message: 'Image URL is too long.' };
    return { ok: true, value: s };
  }
  return { ok: false, value: null, message: 'Image must be an uploaded picture or valid http(s):// URL.' };
}

function computeWaecGrade(percentage: number): string {
  const p = Number(percentage || 0);
  if (p >= 75) return 'A1';
  if (p >= 70) return 'B2';
  if (p >= 65) return 'B3';
  if (p >= 60) return 'C4';
  if (p >= 55) return 'C5';
  if (p >= 50) return 'C6';
  if (p >= 45) return 'D7';
  if (p >= 40) return 'E8';
  return 'F9';
}

function normalizeAnswerString(val: unknown): string {
  return String(val ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function evaluateQuestionCorrectness(question: any, selectedRaw: unknown): boolean {
  const selected = normalizeAnswerString(selectedRaw);
  if (!selected) return false;
  const qType = String(question.question_type || 'MCQ').toUpperCase();
  const correctRaw = String(question.correct_answer || '').trim();
  if (!correctRaw) return false;

  if (qType === 'SHORT_ANSWER') {
    const accepted = correctRaw
      .split('|')
      .map((item) => normalizeAnswerString(item))
      .filter(Boolean);
    return accepted.includes(selected);
  }

  return selected === normalizeAnswerString(correctRaw);
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

interface StoredAnswerEntry {
  selected?: string;
  flagged?: boolean;
  updated_at?: string;
}

function sanitizeQuestionForStudent(q: any) {
  return {
    id: q.id,
    cbt_exam_id: q.cbt_exam_id,
    question_order: Number(q.question_order || 1),
    question_type: q.question_type || 'MCQ',
    question_text: q.question_text,
    question_image_url: q.question_image_url || null,
    option_a: q.option_a || null,
    option_b: q.option_b || null,
    option_c: q.option_c || null,
    option_d: q.option_d || null,
    option_e: q.option_e || null,
    marks: Number(q.marks || 1),
  };
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function recalculateExamTotalMarks(schoolId: string, examId: string): Promise<number> {
  const row = await dbGet(
    `SELECT COALESCE(SUM(marks), 0) as total
     FROM cbt_questions
     WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT COALESCE(SUM(marks), 0) as total
     FROM cbt_questions
     WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [schoolId, examId]
  );
  const total = Math.round(Number(row?.total || 0) * 100) / 100;
  await execWrite(
    `UPDATE cbt_exams SET total_marks = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3`,
    `UPDATE cbt_exams SET total_marks = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
    [total, examId, schoolId]
  );
  return total;
}

async function getStudentForUser(schoolId: string, userId: string): Promise<any | null> {
  return dbGet(
    `SELECT s.*, c.name as resolved_class_name, ca.name as resolved_arm_name
     FROM students s
     LEFT JOIN classes c ON s.class_id = c.id
     LEFT JOIN class_arms ca ON s.class_arm_id = ca.id
     WHERE s.school_id = $1 AND s.user_id = $2 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
     LIMIT 1`,
    `SELECT s.*, c.name as resolved_class_name, ca.name as resolved_arm_name
     FROM students s
     LEFT JOIN classes c ON s.class_id = c.id
     LEFT JOIN class_arms ca ON s.class_arm_id = ca.id
     WHERE s.school_id = ? AND s.user_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
     LIMIT 1`,
    [schoolId, userId]
  );
}

function isStudentEligibleForExam(exam: any, student: any): boolean {
  if (!exam.class_id) return true; // School-wide "All Classes" exam
  if (!student.class_id) return false;
  if (String(exam.class_id) !== String(student.class_id)) return false;
  if (exam.class_arm_id && student.class_arm_id && String(exam.class_arm_id) !== String(student.class_arm_id)) {
    return false;
  }
  return true;
}

function gradeAndFinalizeStats(exam: any, questions: any[], answersMap: Record<string, StoredAnswerEntry>) {
  const totalQuestions = questions.length;
  let answeredCount = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;
  let scoreObtained = 0;
  let maxScore = 0;

  const reviewItems: any[] = [];

  for (const q of questions) {
    const marks = Number(q.marks || 1);
    maxScore += marks;
    const entry = answersMap[q.id];
    const selected = entry?.selected ? String(entry.selected).trim() : '';
    const isAnswered = selected.length > 0;
    const isCorrect = isAnswered ? evaluateQuestionCorrectness(q, selected) : false;

    if (!isAnswered) {
      unansweredCount++;
    } else {
      answeredCount++;
      if (isCorrect) {
        correctCount++;
        scoreObtained += marks;
      } else {
        wrongCount++;
      }
    }

    reviewItems.push({
      question_id: q.id,
      question_order: Number(q.question_order || 1),
      question_type: q.question_type || 'MCQ',
      question_text: q.question_text,
      question_image_url: q.question_image_url || null,
      option_a: q.option_a || null,
      option_b: q.option_b || null,
      option_c: q.option_c || null,
      option_d: q.option_d || null,
      option_e: q.option_e || null,
      selected_answer: selected || null,
      correct_answer: q.correct_answer,
      explanation: q.explanation || null,
      marks,
      earned_marks: isCorrect ? marks : 0,
      is_correct: isCorrect,
      flagged: Boolean(entry?.flagged),
    });
  }

  scoreObtained = Math.round(scoreObtained * 100) / 100;
  maxScore = Math.round(maxScore * 100) / 100;
  const percentage = maxScore > 0 ? Math.round((scoreObtained / maxScore) * 10000) / 100 : 0;
  const grade = computeWaecGrade(percentage);
  const passMark = Number(exam.pass_mark_percent ?? 50);
  const passed = percentage >= passMark ? 1 : 0;

  return {
    totalQuestions,
    answeredCount,
    correctCount,
    wrongCount,
    unansweredCount,
    scoreObtained,
    maxScore,
    percentage,
    grade,
    passed,
    reviewItems,
  };
}

async function finalizeAttemptInDb(
  schoolId: string,
  exam: any,
  attempt: any,
  answersMap: Record<string, StoredAnswerEntry>,
  status: 'SUBMITTED' | 'AUTO_SUBMITTED'
) {
  const questions = await dbAll(
    `SELECT * FROM cbt_questions
     WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY question_order ASC, created_at ASC`,
    `SELECT * FROM cbt_questions
     WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY question_order ASC, created_at ASC`,
    [schoolId, exam.id]
  );

  const stats = gradeAndFinalizeStats(exam, questions, answersMap);
  const startedMs = attempt.started_at ? new Date(attempt.started_at).getTime() : Date.now();
  const nowMs = Date.now();
  const maxDurationSec = Number(exam.duration_minutes || 30) * 60;
  const elapsedSec = Math.max(1, Math.min(maxDurationSec, Math.floor((nowMs - startedMs) / 1000)));
  const submittedAt = new Date().toISOString();

  await execWrite(
    `UPDATE cbt_attempts
     SET status = $1,
         submitted_at = $2,
         time_spent_seconds = $3,
         answers_json = $4,
         total_questions = $5,
         answered_count = $6,
         correct_count = $7,
         wrong_count = $8,
         unanswered_count = $9,
         score_obtained = $10,
         max_score = $11,
         percentage = $12,
         grade = $13,
         passed = $14,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $15 AND school_id = $16`,
    `UPDATE cbt_attempts
     SET status = ?,
         submitted_at = ?,
         time_spent_seconds = ?,
         answers_json = ?,
         total_questions = ?,
         answered_count = ?,
         correct_count = ?,
         wrong_count = ?,
         unanswered_count = ?,
         score_obtained = ?,
         max_score = ?,
         percentage = ?,
         grade = ?,
         passed = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND school_id = ?`,
    [
      status,
      submittedAt,
      elapsedSec,
      JSON.stringify(answersMap),
      stats.totalQuestions,
      stats.answeredCount,
      stats.correctCount,
      stats.wrongCount,
      stats.unansweredCount,
      stats.scoreObtained,
      stats.maxScore,
      stats.percentage,
      stats.grade,
      stats.passed,
      attempt.id,
      schoolId,
    ]
  );

  const updated = await dbGet(
    `SELECT * FROM cbt_attempts WHERE id = $1 AND school_id = $2`,
    `SELECT * FROM cbt_attempts WHERE id = ? AND school_id = ?`,
    [attempt.id, schoolId]
  );

  return { updated, stats };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseBulkQuestionsText(rawText: string): { parsed: any[]; errors: string[] } {
  const text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!text) return { parsed: [], errors: ['Paste WAEC/JAMB formatted questions or CSV rows first.'] };

  const lines = text.split('\n').map((l) => l.trim());
  const firstNonEmpty = lines.find((l) => l.length > 0) || '';

  // Detect CSV mode when header starts with question_text or question,
  if (/^"?(question_text|question)\s*,/i.test(firstNonEmpty)) {
    const nonEmptyLines = lines.filter(Boolean);
    const headers = parseCsvLine(nonEmptyLines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
    const parsed: any[] = [];
    const errors: string[] = [];

    for (let i = 1; i < nonEmptyLines.length; i++) {
      const cells = parseCsvLine(nonEmptyLines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = cells[idx] ?? '';
      });
      const qText = (row.question_text || row.question || '').trim();
      const correct = (row.correct_answer || row.answer || '').trim();
      if (!qText || !correct) {
        errors.push(`Row ${i + 1}: missing question text or correct answer.`);
        continue;
      }
      const qType = (row.question_type || row.type || (row.option_a ? 'MCQ' : 'SHORT_ANSWER')).toUpperCase();
      parsed.push({
        question_type: ['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER'].includes(qType) ? qType : 'MCQ',
        question_text: qText,
        option_a: row.option_a || row.a || (qType === 'TRUE_FALSE' ? 'True' : null),
        option_b: row.option_b || row.b || (qType === 'TRUE_FALSE' ? 'False' : null),
        option_c: row.option_c || row.c || null,
        option_d: row.option_d || row.d || null,
        option_e: row.option_e || row.e || null,
        correct_answer: qType === 'MCQ' ? correct.toUpperCase().replace(/[^A-E]/g, '').slice(0, 1) || correct.toUpperCase() : correct,
        explanation: row.explanation || null,
        marks: Math.max(0.5, Number(row.marks || 1) || 1),
      });
    }
    return { parsed, errors };
  }

  // Plain text WAEC / JAMB / Teacher block parser
  // Supports numbered blocks ("1. Question...\nA. ...\nB. ...\nAnswer: B") separated by blank lines or numbered headers
  const parsed: any[] = [];
  const errors: string[] = [];
  let current: any = null;

  const flushCurrent = () => {
    if (!current) return;
    if (!current.question_text) {
      current = null;
      return;
    }
    if (!current.correct_answer) {
      errors.push(`Question "${current.question_text.slice(0, 45)}..." is missing an Answer line (e.g. Answer: B).`);
      current = null;
      return;
    }
    const hasOptions = Boolean(current.option_a || current.option_b);
    if (!current.question_type) {
      if (hasOptions) {
        current.question_type = 'MCQ';
      } else if (/^(TRUE|FALSE)$/i.test(current.correct_answer)) {
        current.question_type = 'TRUE_FALSE';
        current.option_a = 'True';
        current.option_b = 'False';
        current.correct_answer = current.correct_answer.toUpperCase();
      } else {
        current.question_type = 'SHORT_ANSWER';
      }
    }
    if (current.question_type === 'MCQ') {
      current.correct_answer = current.correct_answer.toUpperCase().replace(/^OPTION\s*/i, '').slice(0, 1);
    }
    parsed.push(current);
    current = null;
  };

  for (const line of lines) {
    if (!line) {
      flushCurrent();
      continue;
    }

    const optMatch = line.match(/^([A-Ea-e])[).:\-]\s+(.+)$/);
    const ansMatch = line.match(/^(?:Answer|Ans|Correct(?:\s+Answer)?)\s*[:=\-]\s*(.+)$/i);
    const expMatch = line.match(/^(?:Explanation|Hint|Note)\s*[:=\-]\s*(.+)$/i);
    const marksMatch = line.match(/^(?:Marks?|Points?|Score)\s*[:=\-]\s*([0-9.]+)$/i);
    const numQMatch = line.match(/^(?:Q(?:uestion)?\s*)?\d+[).:\-]\s+(.+)$/i);

    if (optMatch && current) {
      const key = `option_${optMatch[1].toLowerCase()}`;
      current[key] = optMatch[2].trim();
      continue;
    }
    if (ansMatch && current) {
      current.correct_answer = ansMatch[1].trim();
      continue;
    }
    if (expMatch && current) {
      current.explanation = expMatch[1].trim();
      continue;
    }
    if (marksMatch && current) {
      current.marks = Math.max(0.5, Number(marksMatch[1]) || 1);
      continue;
    }
    if (numQMatch) {
      flushCurrent();
      current = {
        question_text: numQMatch[1].trim(),
        option_a: null,
        option_b: null,
        option_c: null,
        option_d: null,
        option_e: null,
        correct_answer: '',
        explanation: null,
        marks: 1,
      };
      continue;
    }

    if (!current) {
      current = {
        question_text: line,
        option_a: null,
        option_b: null,
        option_c: null,
        option_d: null,
        option_e: null,
        correct_answer: '',
        explanation: null,
        marks: 1,
      };
    } else if (!current.option_a && !current.correct_answer) {
      current.question_text = `${current.question_text} ${line}`.trim();
    }
  }
  flushCurrent();

  return { parsed, errors };
}

// ==============================================================================
// 1. STAFF & ADMIN CBT EXAM MANAGEMENT
// ==============================================================================

// GET /api/v1/cbt/exams
cbtRouter.get(
  '/exams',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const classId = String(req.query.class_id || '').trim();
    const status = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const rows = await dbAll(
      `SELECT e.*,
              (SELECT COUNT(*) FROM cbt_questions q WHERE q.cbt_exam_id = e.id AND (q.is_deleted = 0 OR q.is_deleted IS NULL)) as question_count,
              (SELECT COUNT(*) FROM cbt_attempts a WHERE a.cbt_exam_id = e.id AND a.status != 'RESET') as attempts_count,
              (SELECT COUNT(*) FROM cbt_attempts a WHERE a.cbt_exam_id = e.id AND a.status IN ('SUBMITTED', 'AUTO_SUBMITTED')) as completed_count,
              (SELECT ROUND(AVG(a.percentage), 1) FROM cbt_attempts a WHERE a.cbt_exam_id = e.id AND a.status IN ('SUBMITTED', 'AUTO_SUBMITTED')) as avg_percentage
       FROM cbt_exams e
       WHERE e.school_id = $1 AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
       ORDER BY e.created_at DESC`,
      `SELECT e.*,
              (SELECT COUNT(*) FROM cbt_questions q WHERE q.cbt_exam_id = e.id AND (q.is_deleted = 0 OR q.is_deleted IS NULL)) as question_count,
              (SELECT COUNT(*) FROM cbt_attempts a WHERE a.cbt_exam_id = e.id AND a.status != 'RESET') as attempts_count,
              (SELECT COUNT(*) FROM cbt_attempts a WHERE a.cbt_exam_id = e.id AND a.status IN ('SUBMITTED', 'AUTO_SUBMITTED')) as completed_count,
              (SELECT ROUND(AVG(a.percentage), 1) FROM cbt_attempts a WHERE a.cbt_exam_id = e.id AND a.status IN ('SUBMITTED', 'AUTO_SUBMITTED')) as avg_percentage
       FROM cbt_exams e
       WHERE e.school_id = ? AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
       ORDER BY e.created_at DESC`,
      [schoolId]
    );

    const filtered = rows.filter((e: any) => {
      if (classId && classId !== 'ALL') {
        if (classId === 'SCHOOL_WIDE') {
          if (e.class_id) return false;
        } else if (String(e.class_id || '') !== classId) {
          return false;
        }
      }
      if (status && status !== 'ALL' && String(e.status).toUpperCase() !== status) {
        return false;
      }
      if (search) {
        const hay = `${e.title || ''} ${e.subject_name || ''} ${e.class_name || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    return res.json({
      success: true,
      exams: filtered.map((e: any) => ({
        ...e,
        question_count: Number(e.question_count || 0),
        attempts_count: Number(e.attempts_count || 0),
        completed_count: Number(e.completed_count || 0),
        avg_percentage: e.avg_percentage !== null && e.avg_percentage !== undefined ? Number(e.avg_percentage) : null,
        total_marks: Number(e.total_marks || 0),
        duration_minutes: Number(e.duration_minutes || 30),
        pass_mark_percent: Number(e.pass_mark_percent ?? 50),
        max_attempts: Number(e.max_attempts || 1),
      })),
    });
  }
);

// POST /api/v1/cbt/exams
cbtRouter.post(
  '/exams',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const b = req.body || {};

    const title = String(b.title || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'CBT exam title is required.' });
    }

    let classId: string | null = b.class_id ? String(b.class_id).trim() : null;
    let className: string | null = b.class_name ? String(b.class_name).trim() : null;
    if (classId === 'ALL' || classId === 'SCHOOL_WIDE' || classId === '') {
      classId = null;
      className = 'All Classes';
    } else if (classId) {
      const cls = await dbGet(
        `SELECT id, name FROM classes WHERE id = $1 AND school_id = $2`,
        `SELECT id, name FROM classes WHERE id = ? AND school_id = ?`,
        [classId, schoolId]
      );
      if (!cls) {
        return res.status(400).json({ error: 'INVALID_CLASS', message: 'Selected class does not belong to this school.' });
      }
      className = cls.name;
    } else {
      className = 'All Classes';
    }

    let classArmId: string | null = b.class_arm_id ? String(b.class_arm_id).trim() : null;
    let classArmName: string | null = null;
    if (classArmId && classId) {
      const arm = await dbGet(
        `SELECT id, name FROM class_arms WHERE id = $1 AND school_id = $2 AND class_id = $3`,
        `SELECT id, name FROM class_arms WHERE id = ? AND school_id = ? AND class_id = ?`,
        [classArmId, schoolId, classId]
      );
      if (arm) {
        classArmName = arm.name;
      } else {
        classArmId = null;
      }
    } else {
      classArmId = null;
    }

    let subjectId: string | null = b.subject_id ? String(b.subject_id).trim() : null;
    let subjectName = String(b.subject_name || '').trim();
    if (subjectId) {
      const subj = await dbGet(
        `SELECT id, name FROM subjects WHERE id = $1 AND school_id = $2`,
        `SELECT id, name FROM subjects WHERE id = ? AND school_id = ?`,
        [subjectId, schoolId]
      );
      if (subj) {
        subjectName = subj.name;
      } else {
        subjectId = null;
      }
    }
    if (!subjectName) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Subject name is required.' });
    }

    const durationMinutes = Math.max(1, Math.min(300, Number(b.duration_minutes || 30) || 30));
    const passMarkPercent = Math.max(0, Math.min(100, Number(b.pass_mark_percent ?? 50)));
    const maxAttempts = Math.max(1, Math.min(10, Number(b.max_attempts || 1) || 1));
    const examMode = ['CA_TEST', 'TERM_EXAM', 'MOCK', 'PRACTICE', 'ENTRANCE'].includes(String(b.exam_mode || '').toUpperCase())
      ? String(b.exam_mode).toUpperCase()
      : 'TERM_EXAM';
    const syncScoreTarget = ['NONE', 'CA', 'EXAM'].includes(String(b.sync_score_target || '').toUpperCase())
      ? String(b.sync_score_target).toUpperCase()
      : 'NONE';
    const status = ['DRAFT', 'PUBLISHED', 'CLOSED'].includes(String(b.status || '').toUpperCase())
      ? String(b.status).toUpperCase()
      : 'DRAFT';

    const id = newId('cbt');
    const createdByName = (req.user?.full_name || '').trim() || 'School Staff';

    await execWrite(
      `INSERT INTO cbt_exams (
        id, school_id, title, description, instructions,
        class_id, class_name, class_arm_id, class_arm_name,
        subject_id, subject_name, academic_session_id, term_id,
        linked_examination_id, sync_score_target, exam_mode,
        duration_minutes, total_marks, pass_mark_percent, max_attempts,
        shuffle_questions, shuffle_options, show_result_immediately, show_correct_answers,
        access_code, starts_at, ends_at, status, created_by, created_by_name
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16,
        $17, 0, $18, $19,
        $20, $21, $22, $23,
        $24, $25, $26, $27, $28, $29
      )`,
      `INSERT INTO cbt_exams (
        id, school_id, title, description, instructions,
        class_id, class_name, class_arm_id, class_arm_name,
        subject_id, subject_name, academic_session_id, term_id,
        linked_examination_id, sync_score_target, exam_mode,
        duration_minutes, total_marks, pass_mark_percent, max_attempts,
        shuffle_questions, shuffle_options, show_result_immediately, show_correct_answers,
        access_code, starts_at, ends_at, status, created_by, created_by_name
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, 0, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )`,
      [
        id,
        schoolId,
        title,
        b.description ? String(b.description).trim() : null,
        b.instructions ? String(b.instructions).trim() : 'Answer all questions carefully. Your selections are auto-saved in real time.',
        classId,
        className,
        classArmId,
        classArmName,
        subjectId,
        subjectName,
        b.academic_session_id ? String(b.academic_session_id).trim() : null,
        b.term_id ? String(b.term_id).trim() : null,
        b.linked_examination_id ? String(b.linked_examination_id).trim() : null,
        syncScoreTarget,
        examMode,
        durationMinutes,
        passMarkPercent,
        maxAttempts,
        b.shuffle_questions === false || b.shuffle_questions === 0 ? 0 : 1,
        b.shuffle_options === true || b.shuffle_options === 1 ? 1 : 0,
        b.show_result_immediately === false || b.show_result_immediately === 0 ? 0 : 1,
        b.show_correct_answers === false || b.show_correct_answers === 0 ? 0 : 1,
        b.access_code ? String(b.access_code).trim().toUpperCase() : null,
        b.starts_at ? String(b.starts_at).trim() : null,
        b.ends_at ? String(b.ends_at).trim() : null,
        status,
        req.user?.id || null,
        createdByName,
      ]
    );

    const created = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1`,
      `SELECT * FROM cbt_exams WHERE id = ?`,
      [id]
    );

    logAudit({
      schoolId,
      actorId: req.user?.id || null,
      actorEmail: req.user?.email || null,
      action: 'CREATE_CBT_EXAM',
      entity: 'cbt_exams',
      entityId: id,
      metadata: { title, subjectName, className, durationMinutes },
      ipAddress: req.ip,
    });

    return res.status(201).json({ success: true, exam: created });
  }
);

// PUT /api/v1/cbt/exams/:id
cbtRouter.put(
  '/exams/:id',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');
    const existing = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT * FROM cbt_exams WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    const b = req.body || {};
    const title = b.title !== undefined ? String(b.title).trim() : existing.title;
    if (!title) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Title cannot be empty.' });
    }

    let classId = existing.class_id;
    let className = existing.class_name;
    if (b.class_id !== undefined) {
      const rawCid = b.class_id ? String(b.class_id).trim() : '';
      if (!rawCid || rawCid === 'ALL' || rawCid === 'SCHOOL_WIDE') {
        classId = null;
        className = 'All Classes';
      } else {
        const cls = await dbGet(
          `SELECT id, name FROM classes WHERE id = $1 AND school_id = $2`,
          `SELECT id, name FROM classes WHERE id = ? AND school_id = ?`,
          [rawCid, schoolId]
        );
        if (!cls) {
          return res.status(400).json({ error: 'INVALID_CLASS', message: 'Invalid class selected.' });
        }
        classId = cls.id;
        className = cls.name;
      }
    }

    let classArmId = existing.class_arm_id;
    let classArmName = existing.class_arm_name;
    if (b.class_arm_id !== undefined) {
      const rawArm = b.class_arm_id ? String(b.class_arm_id).trim() : '';
      if (!rawArm || !classId) {
        classArmId = null;
        classArmName = null;
      } else {
        const arm = await dbGet(
          `SELECT id, name FROM class_arms WHERE id = $1 AND school_id = $2 AND class_id = $3`,
          `SELECT id, name FROM class_arms WHERE id = ? AND school_id = ? AND class_id = ?`,
          [rawArm, schoolId, classId]
        );
        classArmId = arm ? arm.id : null;
        classArmName = arm ? arm.name : null;
      }
    }

    let subjectId = existing.subject_id;
    let subjectName = b.subject_name !== undefined ? String(b.subject_name).trim() : existing.subject_name;
    if (b.subject_id !== undefined) {
      const rawSubj = b.subject_id ? String(b.subject_id).trim() : '';
      if (!rawSubj) {
        subjectId = null;
      } else {
        const subj = await dbGet(
          `SELECT id, name FROM subjects WHERE id = $1 AND school_id = $2`,
          `SELECT id, name FROM subjects WHERE id = ? AND school_id = ?`,
          [rawSubj, schoolId]
        );
        if (subj) {
          subjectId = subj.id;
          subjectName = subj.name;
        }
      }
    }

    const nextStatus =
      b.status !== undefined && ['DRAFT', 'PUBLISHED', 'CLOSED'].includes(String(b.status).toUpperCase())
        ? String(b.status).toUpperCase()
        : existing.status;

    if (nextStatus === 'PUBLISHED') {
      const qCountRow = await dbGet(
        `SELECT COUNT(*) as c FROM cbt_questions WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
        `SELECT COUNT(*) as c FROM cbt_questions WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
        [schoolId, examId]
      );
      if (Number(qCountRow?.c || 0) === 0) {
        return res.status(400).json({
          error: 'NO_QUESTIONS',
          message: 'Add at least one CBT question before publishing this exam to students.',
        });
      }
    }

    const durationMinutes =
      b.duration_minutes !== undefined
        ? Math.max(1, Math.min(300, Number(b.duration_minutes) || 30))
        : Number(existing.duration_minutes || 30);
    const passMarkPercent =
      b.pass_mark_percent !== undefined
        ? Math.max(0, Math.min(100, Number(b.pass_mark_percent)))
        : Number(existing.pass_mark_percent ?? 50);
    const maxAttempts =
      b.max_attempts !== undefined
        ? Math.max(1, Math.min(10, Number(b.max_attempts) || 1))
        : Number(existing.max_attempts || 1);

    await execWrite(
      `UPDATE cbt_exams
       SET title = $1,
           description = $2,
           instructions = $3,
           class_id = $4,
           class_name = $5,
           class_arm_id = $6,
           class_arm_name = $7,
           subject_id = $8,
           subject_name = $9,
           academic_session_id = $10,
           term_id = $11,
           linked_examination_id = $12,
           sync_score_target = $13,
           exam_mode = $14,
           duration_minutes = $15,
           pass_mark_percent = $16,
           max_attempts = $17,
           shuffle_questions = $18,
           shuffle_options = $19,
           show_result_immediately = $20,
           show_correct_answers = $21,
           access_code = $22,
           starts_at = $23,
           ends_at = $24,
           status = $25,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $26 AND school_id = $27`,
      `UPDATE cbt_exams
       SET title = ?,
           description = ?,
           instructions = ?,
           class_id = ?,
           class_name = ?,
           class_arm_id = ?,
           class_arm_name = ?,
           subject_id = ?,
           subject_name = ?,
           academic_session_id = ?,
           term_id = ?,
           linked_examination_id = ?,
           sync_score_target = ?,
           exam_mode = ?,
           duration_minutes = ?,
           pass_mark_percent = ?,
           max_attempts = ?,
           shuffle_questions = ?,
           shuffle_options = ?,
           show_result_immediately = ?,
           show_correct_answers = ?,
           access_code = ?,
           starts_at = ?,
           ends_at = ?,
           status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [
        title,
        b.description !== undefined ? (b.description ? String(b.description).trim() : null) : existing.description,
        b.instructions !== undefined ? (b.instructions ? String(b.instructions).trim() : null) : existing.instructions,
        classId,
        className,
        classArmId,
        classArmName,
        subjectId,
        subjectName,
        b.academic_session_id !== undefined ? b.academic_session_id || null : existing.academic_session_id,
        b.term_id !== undefined ? b.term_id || null : existing.term_id,
        b.linked_examination_id !== undefined ? b.linked_examination_id || null : existing.linked_examination_id,
        b.sync_score_target !== undefined ? String(b.sync_score_target).toUpperCase() : existing.sync_score_target,
        b.exam_mode !== undefined ? String(b.exam_mode).toUpperCase() : existing.exam_mode,
        durationMinutes,
        passMarkPercent,
        maxAttempts,
        b.shuffle_questions !== undefined ? (b.shuffle_questions ? 1 : 0) : existing.shuffle_questions,
        b.shuffle_options !== undefined ? (b.shuffle_options ? 1 : 0) : existing.shuffle_options,
        b.show_result_immediately !== undefined ? (b.show_result_immediately ? 1 : 0) : existing.show_result_immediately,
        b.show_correct_answers !== undefined ? (b.show_correct_answers ? 1 : 0) : existing.show_correct_answers,
        b.access_code !== undefined ? (b.access_code ? String(b.access_code).trim().toUpperCase() : null) : existing.access_code,
        b.starts_at !== undefined ? b.starts_at || null : existing.starts_at,
        b.ends_at !== undefined ? b.ends_at || null : existing.ends_at,
        nextStatus,
        examId,
        schoolId,
      ]
    );

    const updated = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM cbt_exams WHERE id = ? AND school_id = ?`,
      [examId, schoolId]
    );

    return res.json({ success: true, exam: updated });
  }
);

// DELETE /api/v1/cbt/exams/:id
cbtRouter.delete(
  '/exams/:id',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');
    await execWrite(
      `UPDATE cbt_exams SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
      `UPDATE cbt_exams SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
      [examId, schoolId]
    );
    return res.json({ success: true });
  }
);

// ==============================================================================
// 2. QUESTION BANK AUTHORING & SMART BULK IMPORTER
// ==============================================================================

// GET /api/v1/cbt/exams/:id/questions
cbtRouter.get(
  '/exams/:id/questions',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');
    const exam = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT * FROM cbt_exams WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    const questions = await dbAll(
      `SELECT * FROM cbt_questions
       WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY question_order ASC, created_at ASC`,
      `SELECT * FROM cbt_questions
       WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY question_order ASC, created_at ASC`,
      [schoolId, examId]
    );

    return res.json({
      success: true,
      exam,
      questions: questions.map((q: any) => ({
        ...q,
        question_order: Number(q.question_order || 1),
        marks: Number(q.marks || 1),
      })),
    });
  }
);

// POST /api/v1/cbt/exams/:id/questions
cbtRouter.post(
  '/exams/:id/questions',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');
    const exam = await dbGet(
      `SELECT id FROM cbt_exams WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT id FROM cbt_exams WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    const b = req.body || {};
    const questionText = String(b.question_text || '').trim();
    const qType = ['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER'].includes(String(b.question_type || 'MCQ').toUpperCase())
      ? String(b.question_type || 'MCQ').toUpperCase()
      : 'MCQ';
    const correctAnswer = String(b.correct_answer || '').trim();

    if (!questionText) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Question text is required.' });
    }
    if (!correctAnswer) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Correct answer is required.' });
    }

    const imgCheck = validateImageUrl(b.question_image_url);
    if (!imgCheck.ok) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: imgCheck.message });
    }

    const maxOrderRow = await dbGet(
      `SELECT COALESCE(MAX(question_order), 0) as max_ord FROM cbt_questions WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT COALESCE(MAX(question_order), 0) as max_ord FROM cbt_questions WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [schoolId, examId]
    );
    const nextOrder = Number(maxOrderRow?.max_ord || 0) + 1;
    const marks = Math.max(0.5, Number(b.marks || 1) || 1);
    const id = newId('cbtq');

    const optA = qType === 'TRUE_FALSE' ? 'True' : b.option_a ? String(b.option_a).trim() : null;
    const optB = qType === 'TRUE_FALSE' ? 'False' : b.option_b ? String(b.option_b).trim() : null;
    const optC = qType === 'MCQ' && b.option_c ? String(b.option_c).trim() : null;
    const optD = qType === 'MCQ' && b.option_d ? String(b.option_d).trim() : null;
    const optE = qType === 'MCQ' && b.option_e ? String(b.option_e).trim() : null;
    const normCorrect = qType === 'SHORT_ANSWER' ? correctAnswer : correctAnswer.toUpperCase();

    await execWrite(
      `INSERT INTO cbt_questions (
        id, school_id, cbt_exam_id, question_order, question_type, question_text, question_image_url,
        option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, marks
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      `INSERT INTO cbt_questions (
        id, school_id, cbt_exam_id, question_order, question_type, question_text, question_image_url,
        option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, marks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        schoolId,
        examId,
        nextOrder,
        qType,
        questionText,
        imgCheck.value,
        optA,
        optB,
        optC,
        optD,
        optE,
        normCorrect,
        b.explanation ? String(b.explanation).trim() : null,
        marks,
      ]
    );

    const totalMarks = await recalculateExamTotalMarks(schoolId, examId);
    const created = await dbGet(
      `SELECT * FROM cbt_questions WHERE id = $1`,
      `SELECT * FROM cbt_questions WHERE id = ?`,
      [id]
    );

    return res.status(201).json({ success: true, question: created, total_marks: totalMarks });
  }
);

// POST /api/v1/cbt/exams/:id/questions/bulk
cbtRouter.post(
  '/exams/:id/questions/bulk',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');
    const exam = await dbGet(
      `SELECT id FROM cbt_exams WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT id FROM cbt_exams WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    let items: any[] = [];
    let parseErrors: string[] = [];

    if (Array.isArray(req.body?.questions) && req.body.questions.length > 0) {
      items = req.body.questions;
    } else if (typeof req.body?.raw_text === 'string' && req.body.raw_text.trim()) {
      const result = parseBulkQuestionsText(req.body.raw_text);
      items = result.parsed;
      parseErrors = result.errors;
    } else {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Provide raw_text (WAEC/JAMB format or CSV) or a questions array.',
      });
    }

    if (items.length === 0) {
      return res.status(400).json({
        error: 'PARSE_EMPTY',
        message: parseErrors[0] || 'No valid questions could be parsed. Ensure each question includes an Answer: line.',
        errors: parseErrors,
      });
    }

    const maxOrderRow = await dbGet(
      `SELECT COALESCE(MAX(question_order), 0) as max_ord FROM cbt_questions WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT COALESCE(MAX(question_order), 0) as max_ord FROM cbt_questions WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [schoolId, examId]
    );
    let nextOrder = Number(maxOrderRow?.max_ord || 0);
    let importedCount = 0;

    for (const item of items) {
      const qText = String(item.question_text || '').trim();
      const correct = String(item.correct_answer || '').trim();
      if (!qText || !correct) {
        parseErrors.push('Skipped an entry missing question_text or correct_answer.');
        continue;
      }
      const qType = ['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER'].includes(String(item.question_type || 'MCQ').toUpperCase())
        ? String(item.question_type || 'MCQ').toUpperCase()
        : 'MCQ';
      const marks = Math.max(0.5, Number(item.marks || 1) || 1);
      nextOrder++;
      const qId = newId('cbtq');

      await execWrite(
        `INSERT INTO cbt_questions (
          id, school_id, cbt_exam_id, question_order, question_type, question_text, question_image_url,
          option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, marks
        ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12, $13, $14)`,
        `INSERT INTO cbt_questions (
          id, school_id, cbt_exam_id, question_order, question_type, question_text, question_image_url,
          option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, marks
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          qId,
          schoolId,
          examId,
          nextOrder,
          qType,
          qText,
          qType === 'TRUE_FALSE' ? 'True' : item.option_a ? String(item.option_a).trim() : null,
          qType === 'TRUE_FALSE' ? 'False' : item.option_b ? String(item.option_b).trim() : null,
          qType === 'MCQ' && item.option_c ? String(item.option_c).trim() : null,
          qType === 'MCQ' && item.option_d ? String(item.option_d).trim() : null,
          qType === 'MCQ' && item.option_e ? String(item.option_e).trim() : null,
          qType === 'SHORT_ANSWER' ? correct : correct.toUpperCase(),
          item.explanation ? String(item.explanation).trim() : null,
          marks,
        ]
      );
      importedCount++;
    }

    const totalMarks = await recalculateExamTotalMarks(schoolId, examId);
    const questions = await dbAll(
      `SELECT * FROM cbt_questions WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY question_order ASC`,
      `SELECT * FROM cbt_questions WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY question_order ASC`,
      [schoolId, examId]
    );

    return res.status(201).json({
      success: true,
      importedCount,
      skippedCount: parseErrors.length,
      errors: parseErrors,
      total_marks: totalMarks,
      questions,
    });
  }
);

// PUT /api/v1/cbt/exams/:id/questions/:qid
cbtRouter.put(
  '/exams/:id/questions/:qid',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');
    const qid = String(req.params.qid || '');
    const existing = await dbGet(
      `SELECT * FROM cbt_questions WHERE id = $1 AND cbt_exam_id = $2 AND school_id = $3 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT * FROM cbt_questions WHERE id = ? AND cbt_exam_id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [qid, examId, schoolId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Question not found.' });
    }

    const b = req.body || {};
    const imgCheck: { ok: boolean; value: string | null; message?: string } =
      b.question_image_url !== undefined
        ? validateImageUrl(b.question_image_url)
        : { ok: true, value: existing.question_image_url };
    if (!imgCheck.ok) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: imgCheck.message || 'Invalid image URL.' });
    }

    const qType =
      b.question_type !== undefined && ['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER'].includes(String(b.question_type).toUpperCase())
        ? String(b.question_type).toUpperCase()
        : existing.question_type;
    const questionText = b.question_text !== undefined ? String(b.question_text).trim() : existing.question_text;
    const correctRaw = b.correct_answer !== undefined ? String(b.correct_answer).trim() : existing.correct_answer;
    const marks = b.marks !== undefined ? Math.max(0.5, Number(b.marks) || 1) : Number(existing.marks || 1);

    await execWrite(
      `UPDATE cbt_questions
       SET question_type = $1, question_text = $2, question_image_url = $3,
           option_a = $4, option_b = $5, option_c = $6, option_d = $7, option_e = $8,
           correct_answer = $9, explanation = $10, marks = $11, updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 AND school_id = $13`,
      `UPDATE cbt_questions
       SET question_type = ?, question_text = ?, question_image_url = ?,
           option_a = ?, option_b = ?, option_c = ?, option_d = ?, option_e = ?,
           correct_answer = ?, explanation = ?, marks = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [
        qType,
        questionText,
        imgCheck.value,
        qType === 'TRUE_FALSE' ? 'True' : b.option_a !== undefined ? (b.option_a ? String(b.option_a).trim() : null) : existing.option_a,
        qType === 'TRUE_FALSE' ? 'False' : b.option_b !== undefined ? (b.option_b ? String(b.option_b).trim() : null) : existing.option_b,
        qType === 'MCQ' ? (b.option_c !== undefined ? (b.option_c ? String(b.option_c).trim() : null) : existing.option_c) : null,
        qType === 'MCQ' ? (b.option_d !== undefined ? (b.option_d ? String(b.option_d).trim() : null) : existing.option_d) : null,
        qType === 'MCQ' ? (b.option_e !== undefined ? (b.option_e ? String(b.option_e).trim() : null) : existing.option_e) : null,
        qType === 'SHORT_ANSWER' ? correctRaw : correctRaw.toUpperCase(),
        b.explanation !== undefined ? (b.explanation ? String(b.explanation).trim() : null) : existing.explanation,
        marks,
        qid,
        schoolId,
      ]
    );

    const totalMarks = await recalculateExamTotalMarks(schoolId, examId);
    const updated = await dbGet(
      `SELECT * FROM cbt_questions WHERE id = $1`,
      `SELECT * FROM cbt_questions WHERE id = ?`,
      [qid]
    );
    return res.json({ success: true, question: updated, total_marks: totalMarks });
  }
);

// DELETE /api/v1/cbt/exams/:id/questions/:qid
cbtRouter.delete(
  '/exams/:id/questions/:qid',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');
    const qid = String(req.params.qid || '');

    await execWrite(
      `UPDATE cbt_questions SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND cbt_exam_id = $2 AND school_id = $3`,
      `UPDATE cbt_questions SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND cbt_exam_id = ? AND school_id = ?`,
      [qid, examId, schoolId]
    );
    const totalMarks = await recalculateExamTotalMarks(schoolId, examId);
    return res.json({ success: true, total_marks: totalMarks });
  }
);

// ==============================================================================
// 3. LIVE RESULTS, QUESTION ANALYTICS, CSV EXPORT, RESET & REPORT CARD SYNC
// ==============================================================================

// GET /api/v1/cbt/exams/:id/results
cbtRouter.get(
  '/exams/:id/results',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');

    const exam = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT * FROM cbt_exams WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    const attempts = await dbAll(
      `SELECT * FROM cbt_attempts
       WHERE school_id = $1 AND cbt_exam_id = $2 AND status != 'RESET'
       ORDER BY percentage DESC, time_spent_seconds ASC, created_at DESC`,
      `SELECT * FROM cbt_attempts
       WHERE school_id = ? AND cbt_exam_id = ? AND status != 'RESET'
       ORDER BY percentage DESC, time_spent_seconds ASC, created_at DESC`,
      [schoolId, examId]
    );

    const questions = await dbAll(
      `SELECT * FROM cbt_questions
       WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY question_order ASC`,
      `SELECT * FROM cbt_questions
       WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY question_order ASC`,
      [schoolId, examId]
    );

    const completed = attempts.filter((a: any) => a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED');
    const inProgress = attempts.filter((a: any) => a.status === 'IN_PROGRESS');
    const passedCount = completed.filter((a: any) => Number(a.passed) === 1).length;
    const avgPercentage =
      completed.length > 0
        ? Math.round((completed.reduce((s: number, a: any) => s + Number(a.percentage || 0), 0) / completed.length) * 10) / 10
        : 0;
    const highestPercentage = completed.length > 0 ? Math.max(...completed.map((a: any) => Number(a.percentage || 0))) : 0;
    const lowestPercentage = completed.length > 0 ? Math.min(...completed.map((a: any) => Number(a.percentage || 0))) : 0;

    // Question-level accuracy analytics across all submitted attempts
    const questionAnalytics = questions.map((q: any, idx: number) => {
      let totalAnswered = 0;
      let totalCorrect = 0;
      for (const att of completed) {
        const ansMap = safeParseJson<Record<string, StoredAnswerEntry>>(att.answers_json, {});
        const sel = ansMap[q.id]?.selected;
        if (sel && String(sel).trim()) {
          totalAnswered++;
          if (evaluateQuestionCorrectness(q, sel)) {
            totalCorrect++;
          }
        }
      }
      const accuracyPercent = completed.length > 0 ? Math.round((totalCorrect / completed.length) * 1000) / 10 : 0;
      return {
        question_id: q.id,
        question_number: idx + 1,
        question_text: q.question_text,
        question_type: q.question_type,
        correct_answer: q.correct_answer,
        marks: Number(q.marks || 1),
        answered_count: totalAnswered,
        correct_count: totalCorrect,
        accuracy_percent: accuracyPercent,
      };
    });

    return res.json({
      success: true,
      exam,
      summary: {
        total_attempts: attempts.length,
        completed_count: completed.length,
        in_progress_count: inProgress.length,
        passed_count: passedCount,
        pass_rate_percent: completed.length > 0 ? Math.round((passedCount / completed.length) * 1000) / 10 : 0,
        average_percentage: avgPercentage,
        highest_percentage: highestPercentage,
        lowest_percentage: lowestPercentage,
      },
      attempts: attempts.map((a: any) => ({
        id: a.id,
        student_id: a.student_id,
        student_name: a.student_name,
        admission_number: a.admission_number,
        class_name: a.class_name,
        attempt_number: Number(a.attempt_number || 1),
        status: a.status,
        started_at: a.started_at,
        submitted_at: a.submitted_at,
        time_spent_seconds: Number(a.time_spent_seconds || 0),
        total_questions: Number(a.total_questions || 0),
        answered_count: Number(a.answered_count || 0),
        correct_count: Number(a.correct_count || 0),
        wrong_count: Number(a.wrong_count || 0),
        score_obtained: Number(a.score_obtained || 0),
        max_score: Number(a.max_score || 0),
        percentage: Number(a.percentage || 0),
        grade: a.grade || null,
        passed: Number(a.passed || 0) === 1,
        tab_switch_count: Number(a.tab_switch_count || 0),
        synced_to_report_card: Number(a.synced_to_report_card || 0) === 1,
        synced_at: a.synced_at || null,
      })),
      questionAnalytics,
    });
  }
);

// GET /api/v1/cbt/exams/:id/results/export
cbtRouter.get(
  '/exams/:id/results/export',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');
    const exam = await dbGet(
      `SELECT title, subject_name, class_name FROM cbt_exams WHERE id = $1 AND school_id = $2`,
      `SELECT title, subject_name, class_name FROM cbt_exams WHERE id = ? AND school_id = ?`,
      [examId, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    const attempts = await dbAll(
      `SELECT * FROM cbt_attempts
       WHERE school_id = $1 AND cbt_exam_id = $2 AND status IN ('SUBMITTED', 'AUTO_SUBMITTED')
       ORDER BY percentage DESC, student_name ASC`,
      `SELECT * FROM cbt_attempts
       WHERE school_id = ? AND cbt_exam_id = ? AND status IN ('SUBMITTED', 'AUTO_SUBMITTED')
       ORDER BY percentage DESC, student_name ASC`,
      [schoolId, examId]
    );

    const headers = [
      'Student Name',
      'Admission Number',
      'Class',
      'Status',
      'Score Obtained',
      'Max Score',
      'Percentage (%)',
      'Grade',
      'Result',
      'Correct',
      'Wrong',
      'Time Spent (sec)',
      'Tab Switches',
      'Submitted At',
    ];
    const rows = [headers.join(',')];
    for (const a of attempts) {
      rows.push(
        [
          sanitizeCsvCell(a.student_name || ''),
          sanitizeCsvCell(a.admission_number || ''),
          sanitizeCsvCell(a.class_name || ''),
          sanitizeCsvCell(a.status || ''),
          sanitizeCsvCell(a.score_obtained ?? 0),
          sanitizeCsvCell(a.max_score ?? 0),
          sanitizeCsvCell(a.percentage ?? 0),
          sanitizeCsvCell(a.grade || ''),
          sanitizeCsvCell(Number(a.passed) === 1 ? 'PASSED' : 'FAILED'),
          sanitizeCsvCell(a.correct_count ?? 0),
          sanitizeCsvCell(a.wrong_count ?? 0),
          sanitizeCsvCell(a.time_spent_seconds ?? 0),
          sanitizeCsvCell(a.tab_switch_count ?? 0),
          sanitizeCsvCell(a.submitted_at || ''),
        ].join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="cbt_results_${examId}.csv"`);
    return res.send(rows.join('\n'));
  }
);

// POST /api/v1/cbt/exams/:id/sync-scores
// Maps each student's best submitted CBT attempt score into student_scores (CA or Exam column)
cbtRouter.post(
  '/exams/:id/sync-scores',
  requireAuth,
  requireTenant,
  requireRole(CBT_AUTHOR_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.id || '');
    const examinationId = String(req.body?.examination_id || '').trim();
    const subjectIdInput = String(req.body?.subject_id || '').trim();
    const target = String(req.body?.target || 'EXAM').toUpperCase() === 'CA' ? 'CA' : 'EXAM';

    const cbtExam = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT * FROM cbt_exams WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!cbtExam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    const effectiveExamId = examinationId || cbtExam.linked_examination_id;
    if (!effectiveExamId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Select a target Report Card Examination to sync CBT scores into.',
      });
    }

    const targetExam = await dbGet(
      `SELECT * FROM examinations WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT * FROM examinations WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [effectiveExamId, schoolId]
    );
    if (!targetExam) {
      return res.status(404).json({ error: 'EXAM_NOT_FOUND', message: 'Target examination does not exist for this school.' });
    }

    // Resolve subject_id: explicit input > cbtExam.subject_id > match by subject_name
    let effectiveSubjectId = subjectIdInput || cbtExam.subject_id || null;
    if (!effectiveSubjectId) {
      const matchedSubject = await dbGet(
        `SELECT id FROM subjects WHERE school_id = $1 AND LOWER(name) = LOWER($2) AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
        `SELECT id FROM subjects WHERE school_id = ? AND LOWER(name) = LOWER(?) AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
        [schoolId, cbtExam.subject_name]
      );
      if (matchedSubject) effectiveSubjectId = matchedSubject.id;
    }
    if (!effectiveSubjectId) {
      return res.status(400).json({
        error: 'SUBJECT_REQUIRED',
        message: `Select a matching subject from your school's Subject Catalog for "${cbtExam.subject_name}".`,
      });
    }

    const academicSettings = await getSchoolAcademicSettings(schoolId);
    const caMax = Number(academicSettings.ca_max_score || 40);
    const examMax = Number(academicSettings.exam_max_score || 60);
    const targetMax = target === 'CA' ? caMax : examMax;

    const attempts = await dbAll(
      `SELECT * FROM cbt_attempts
       WHERE school_id = $1 AND cbt_exam_id = $2 AND status IN ('SUBMITTED', 'AUTO_SUBMITTED')
       ORDER BY percentage DESC, submitted_at DESC`,
      `SELECT * FROM cbt_attempts
       WHERE school_id = ? AND cbt_exam_id = ? AND status IN ('SUBMITTED', 'AUTO_SUBMITTED')
       ORDER BY percentage DESC, submitted_at DESC`,
      [schoolId, examId]
    );

    if (attempts.length === 0) {
      return res.status(400).json({
        error: 'NO_COMPLETED_ATTEMPTS',
        message: 'No completed student CBT submissions exist yet to sync.',
      });
    }

    // Pick best attempt per student
    const bestByStudent = new Map<string, any>();
    for (const att of attempts) {
      if (!bestByStudent.has(att.student_id)) {
        bestByStudent.set(att.student_id, att);
      }
    }

    let syncedCount = 0;
    const syncedAt = new Date().toISOString();

    for (const [studentId, att] of bestByStudent.entries()) {
      const pct = Math.max(0, Math.min(100, Number(att.percentage || 0)));
      const scaledScore = Math.round((pct / 100) * targetMax * 100) / 100;

      const existingScore = await dbGet(
        `SELECT * FROM student_scores
         WHERE school_id = $1 AND examination_id = $2 AND student_id = $3 AND subject_id = $4 LIMIT 1`,
        `SELECT * FROM student_scores
         WHERE school_id = ? AND examination_id = ? AND student_id = ? AND subject_id = ? LIMIT 1`,
        [schoolId, targetExam.id, studentId, effectiveSubjectId]
      );

      const nextCa = target === 'CA' ? scaledScore : existingScore?.ca_score !== null && existingScore?.ca_score !== undefined ? Number(existingScore.ca_score) : 0;
      const nextExam = target === 'EXAM' ? scaledScore : existingScore?.exam_score !== null && existingScore?.exam_score !== undefined ? Number(existingScore.exam_score) : 0;
      const nextTotal = Math.round((nextCa + nextExam) * 100) / 100;
      const gradeBand = computeGrade(nextTotal, caMax + examMax, academicSettings.grading_scale);

      if (existingScore) {
        await execWrite(
          `UPDATE student_scores
           SET ca_score = $1, exam_score = $2, total_score = $3, grade = $4, grade_remark = $5,
               updated_by = $6, updated_at = CURRENT_TIMESTAMP
           WHERE id = $7 AND school_id = $8`,
          `UPDATE student_scores
           SET ca_score = ?, exam_score = ?, total_score = ?, grade = ?, grade_remark = ?,
               updated_by = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND school_id = ?`,
          [nextCa, nextExam, nextTotal, gradeBand.grade, gradeBand.remark, req.user?.id || null, existingScore.id, schoolId]
        );
      } else {
        const scoreId = newId('scr');
        await execWrite(
          `INSERT INTO student_scores (
            id, school_id, examination_id, student_id, class_id, subject_id,
            academic_session_id, term_id, ca_score, exam_score, total_score,
            grade, grade_remark, status, entered_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'APPROVED', $14, $15)`,
          `INSERT INTO student_scores (
            id, school_id, examination_id, student_id, class_id, subject_id,
            academic_session_id, term_id, ca_score, exam_score, total_score,
            grade, grade_remark, status, entered_by, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?)`,
          [
            scoreId,
            schoolId,
            targetExam.id,
            studentId,
            att.class_id || targetExam.class_id || null,
            effectiveSubjectId,
            targetExam.academic_session_id || null,
            targetExam.term_id || null,
            nextCa,
            nextExam,
            nextTotal,
            gradeBand.grade,
            gradeBand.remark,
            req.user?.id || null,
            req.user?.id || null,
          ]
        );
      }

      await execWrite(
        `UPDATE cbt_attempts SET synced_to_report_card = 1, synced_at = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3`,
        `UPDATE cbt_attempts SET synced_to_report_card = 1, synced_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
        [syncedAt, att.id, schoolId]
      );
      syncedCount++;
    }

    // Persist linked examination metadata on the CBT exam for transparency
    await execWrite(
      `UPDATE cbt_exams SET linked_examination_id = $1, subject_id = $2, sync_score_target = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND school_id = $5`,
      `UPDATE cbt_exams SET linked_examination_id = ?, subject_id = ?, sync_score_target = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
      [targetExam.id, effectiveSubjectId, target, examId, schoolId]
    );

    logAudit({
      schoolId,
      actorId: req.user?.id || null,
      actorEmail: req.user?.email || null,
      action: 'SYNC_CBT_SCORES_TO_REPORT_CARD',
      entity: 'cbt_exams',
      entityId: examId,
      metadata: { examinationId: targetExam.id, subjectId: effectiveSubjectId, target, syncedCount, targetMax },
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      syncedCount,
      target,
      targetMax,
      examinationTitle: targetExam.title,
      message: `Synced ${syncedCount} student CBT score(s) into "${targetExam.title}" (${target} column, scaled to /${targetMax}).`,
    });
  }
);

// POST /api/v1/cbt/attempts/:attemptId/reset (Admin only)
cbtRouter.post(
  '/attempts/:attemptId/reset',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const attemptId = String(req.params.attemptId || '');
    const attempt = await dbGet(
      `SELECT id, cbt_exam_id, student_name FROM cbt_attempts WHERE id = $1 AND school_id = $2`,
      `SELECT id, cbt_exam_id, student_name FROM cbt_attempts WHERE id = ? AND school_id = ?`,
      [attemptId, schoolId]
    );
    if (!attempt) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Attempt not found.' });
    }

    await execWrite(
      `UPDATE cbt_attempts SET status = 'RESET', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
      `UPDATE cbt_attempts SET status = 'RESET', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
      [attemptId, schoolId]
    );

    logAudit({
      schoolId,
      actorId: req.user?.id || null,
      actorEmail: req.user?.email || null,
      action: 'RESET_CBT_ATTEMPT',
      entity: 'cbt_attempts',
      entityId: attemptId,
      metadata: { studentName: attempt.student_name, examId: attempt.cbt_exam_id },
      ipAddress: req.ip,
    });

    return res.json({ success: true, message: `Attempt reset for ${attempt.student_name}. They may now retake the CBT exam.` });
  }
);

// ==============================================================================
// 4. STUDENT CBT EXAM HALL (STRICT CLASS ISOLATION & ZERO ANSWER LEAKAGE)
// ==============================================================================

// GET /api/v1/cbt/student/exams
cbtRouter.get(
  '/student/exams',
  requireAuth,
  requireTenant,
  requireRole(['STUDENT', ...ADMIN_ONLY_ROLES]),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const student = await getStudentForUser(schoolId, req.user!.id);
    if (!student) {
      return res.status(404).json({ error: 'STUDENT_PROFILE_NOT_FOUND', message: 'Student profile not linked.' });
    }

    const publishedExams = await dbAll(
      `SELECT e.*,
              (SELECT COUNT(*) FROM cbt_questions q WHERE q.cbt_exam_id = e.id AND (q.is_deleted = 0 OR q.is_deleted IS NULL)) as question_count
       FROM cbt_exams e
       WHERE e.school_id = $1 AND e.status = 'PUBLISHED' AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
       ORDER BY e.created_at DESC`,
      `SELECT e.*,
              (SELECT COUNT(*) FROM cbt_questions q WHERE q.cbt_exam_id = e.id AND (q.is_deleted = 0 OR q.is_deleted IS NULL)) as question_count
       FROM cbt_exams e
       WHERE e.school_id = ? AND e.status = 'PUBLISHED' AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
       ORDER BY e.created_at DESC`,
      [schoolId]
    );

    const eligibleExams = publishedExams.filter((e: any) => isStudentEligibleForExam(e, student));

    const studentAttempts = await dbAll(
      `SELECT * FROM cbt_attempts
       WHERE school_id = $1 AND student_id = $2 AND status != 'RESET'
       ORDER BY created_at DESC`,
      `SELECT * FROM cbt_attempts
       WHERE school_id = ? AND student_id = ? AND status != 'RESET'
       ORDER BY created_at DESC`,
      [schoolId, student.id]
    );

    const attemptsByExam = new Map<string, any[]>();
    for (const att of studentAttempts) {
      const list = attemptsByExam.get(att.cbt_exam_id) || [];
      list.push(att);
      attemptsByExam.set(att.cbt_exam_id, list);
    }

    const nowMs = Date.now();
    const examsPayload = eligibleExams.map((e: any) => {
      const myAttempts = attemptsByExam.get(e.id) || [];
      const activeAttempt = myAttempts.find((a) => a.status === 'IN_PROGRESS') || null;
      const submittedAttempts = myAttempts.filter((a) => a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED');
      const bestAttempt = submittedAttempts.length
        ? [...submittedAttempts].sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0))[0]
        : null;

      const startsMs = e.starts_at ? new Date(e.starts_at).getTime() : null;
      const endsMs = e.ends_at ? new Date(e.ends_at).getTime() : null;
      const notYetOpen = startsMs !== null && !Number.isNaN(startsMs) && nowMs < startsMs;
      const windowClosed = endsMs !== null && !Number.isNaN(endsMs) && nowMs > endsMs;
      const attemptsUsed = myAttempts.length;
      const maxAttempts = Number(e.max_attempts || 1);
      const canStart = Boolean(activeAttempt) || (!notYetOpen && !windowClosed && attemptsUsed < maxAttempts && Number(e.question_count || 0) > 0);

      return {
        id: e.id,
        title: e.title,
        description: e.description || null,
        instructions: e.instructions || null,
        subject_name: e.subject_name,
        class_id: e.class_id || null,
        class_name: e.class_name || 'All Classes',
        exam_mode: e.exam_mode,
        duration_minutes: Number(e.duration_minutes || 30),
        total_marks: Number(e.total_marks || 0),
        pass_mark_percent: Number(e.pass_mark_percent ?? 50),
        question_count: Number(e.question_count || 0),
        max_attempts: maxAttempts,
        attempts_used: attemptsUsed,
        requires_access_code: Boolean(e.access_code && String(e.access_code).trim().length > 0),
        starts_at: e.starts_at || null,
        ends_at: e.ends_at || null,
        show_result_immediately: Number(e.show_result_immediately ?? 1) === 1,
        show_correct_answers: Number(e.show_correct_answers ?? 1) === 1,
        not_yet_open: notYetOpen,
        window_closed: windowClosed,
        can_start: canStart,
        active_attempt_id: activeAttempt?.id || null,
        latest_submitted_attempt: bestAttempt
          ? {
              id: bestAttempt.id,
              status: bestAttempt.status,
              submitted_at: bestAttempt.submitted_at,
              score_obtained: Number(e.show_result_immediately ?? 1) === 1 ? Number(bestAttempt.score_obtained || 0) : null,
              max_score: Number(e.show_result_immediately ?? 1) === 1 ? Number(bestAttempt.max_score || 0) : null,
              percentage: Number(e.show_result_immediately ?? 1) === 1 ? Number(bestAttempt.percentage || 0) : null,
              grade: Number(e.show_result_immediately ?? 1) === 1 ? bestAttempt.grade : null,
              passed: Number(e.show_result_immediately ?? 1) === 1 ? Number(bestAttempt.passed) === 1 : null,
            }
          : null,
      };
    });

    // Completed history across all exams the student has taken
    const examTitleMap = new Map<string, any>();
    for (const e of publishedExams) examTitleMap.set(e.id, e);
    const allCompleted = await dbAll(
      `SELECT a.*, e.title as exam_title, e.subject_name, e.show_result_immediately, e.show_correct_answers
       FROM cbt_attempts a
       JOIN cbt_exams e ON a.cbt_exam_id = e.id
       WHERE a.school_id = $1 AND a.student_id = $2 AND a.status IN ('SUBMITTED', 'AUTO_SUBMITTED')
       ORDER BY a.submitted_at DESC, a.created_at DESC`,
      `SELECT a.*, e.title as exam_title, e.subject_name, e.show_result_immediately, e.show_correct_answers
       FROM cbt_attempts a
       JOIN cbt_exams e ON a.cbt_exam_id = e.id
       WHERE a.school_id = ? AND a.student_id = ? AND a.status IN ('SUBMITTED', 'AUTO_SUBMITTED')
       ORDER BY a.submitted_at DESC, a.created_at DESC`,
      [schoolId, student.id]
    );

    const history = allCompleted.map((a: any) => {
      const canSeeScore = Number(a.show_result_immediately ?? 1) === 1;
      return {
        id: a.id,
        cbt_exam_id: a.cbt_exam_id,
        exam_title: a.exam_title,
        subject_name: a.subject_name,
        status: a.status,
        submitted_at: a.submitted_at,
        time_spent_seconds: Number(a.time_spent_seconds || 0),
        total_questions: Number(a.total_questions || 0),
        answered_count: Number(a.answered_count || 0),
        score_obtained: canSeeScore ? Number(a.score_obtained || 0) : null,
        max_score: canSeeScore ? Number(a.max_score || 0) : null,
        percentage: canSeeScore ? Number(a.percentage || 0) : null,
        grade: canSeeScore ? a.grade : null,
        passed: canSeeScore ? Number(a.passed) === 1 : null,
        can_review: canSeeScore && Number(a.show_correct_answers ?? 1) === 1,
        result_withheld: !canSeeScore,
      };
    });

    return res.json({
      success: true,
      student: {
        id: student.id,
        full_name: student.full_name,
        admission_number: student.admission_number,
        class_id: student.class_id,
        class_name: student.resolved_class_name || student.class_name || null,
      },
      exams: examsPayload,
      history,
    });
  }
);

// POST /api/v1/cbt/student/exams/:examId/start
cbtRouter.post(
  '/student/exams/:examId/start',
  requireAuth,
  requireTenant,
  requireRole(['STUDENT']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const examId = String(req.params.examId || '');
    const student = await getStudentForUser(schoolId, req.user!.id);
    if (!student) {
      return res.status(404).json({ error: 'STUDENT_PROFILE_NOT_FOUND', message: 'Student profile not found.' });
    }

    const exam = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)`,
      `SELECT * FROM cbt_exams WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [examId, schoolId]
    );
    if (!exam || exam.status !== 'PUBLISHED') {
      return res.status(404).json({ error: 'EXAM_UNAVAILABLE', message: 'This CBT exam is not currently published.' });
    }

    if (!isStudentEligibleForExam(exam, student)) {
      return res.status(403).json({
        error: 'CLASS_NOT_ELIGIBLE',
        message: `This CBT exam is restricted to ${exam.class_name || 'another class'}.`,
      });
    }

    const questions = await dbAll(
      `SELECT * FROM cbt_questions
       WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY question_order ASC, created_at ASC`,
      `SELECT * FROM cbt_questions
       WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY question_order ASC, created_at ASC`,
      [schoolId, examId]
    );

    if (questions.length === 0) {
      return res.status(400).json({ error: 'EMPTY_EXAM', message: 'This exam has no questions configured yet.' });
    }

    // Check for an existing IN_PROGRESS attempt to seamlessly resume after refresh or power loss
    const activeAttempt = await dbGet(
      `SELECT * FROM cbt_attempts
       WHERE school_id = $1 AND cbt_exam_id = $2 AND student_id = $3 AND status = 'IN_PROGRESS'
       ORDER BY created_at DESC LIMIT 1`,
      `SELECT * FROM cbt_attempts
       WHERE school_id = ? AND cbt_exam_id = ? AND student_id = ? AND status = 'IN_PROGRESS'
       ORDER BY created_at DESC LIMIT 1`,
      [schoolId, examId, student.id]
    );

    const nowMs = Date.now();

    if (activeAttempt) {
      const expiresMs = new Date(activeAttempt.expires_at).getTime();
      if (!Number.isNaN(expiresMs) && nowMs >= expiresMs) {
        const answersMap = safeParseJson<Record<string, StoredAnswerEntry>>(activeAttempt.answers_json, {});
        const { updated } = await finalizeAttemptInDb(schoolId, exam, activeAttempt, answersMap, 'AUTO_SUBMITTED');
        return res.json({
          success: true,
          auto_submitted: true,
          message: 'Your previous exam timer expired and your saved answers were automatically submitted.',
          attempt: {
            id: updated.id,
            status: updated.status,
            score_obtained: Number(exam.show_result_immediately ?? 1) === 1 ? Number(updated.score_obtained) : null,
            max_score: Number(exam.show_result_immediately ?? 1) === 1 ? Number(updated.max_score) : null,
            percentage: Number(exam.show_result_immediately ?? 1) === 1 ? Number(updated.percentage) : null,
            grade: Number(exam.show_result_immediately ?? 1) === 1 ? updated.grade : null,
          },
        });
      }

      const storedOrder = safeParseJson<string[]>(activeAttempt.question_order_json, []);
      const qById = new Map(questions.map((q: any) => [q.id, q]));
      const orderedQuestions =
        storedOrder.length > 0
          ? storedOrder.map((id) => qById.get(id)).filter(Boolean)
          : questions;
      // Append any newly added questions not in storedOrder
      for (const q of questions) {
        if (!orderedQuestions.some((oq: any) => oq.id === q.id)) orderedQuestions.push(q);
      }

      const remainingSeconds = Math.max(1, Math.floor((expiresMs - nowMs) / 1000));
      return res.json({
        success: true,
        resumed: true,
        server_now: new Date(nowMs).toISOString(),
        remaining_seconds: remainingSeconds,
        exam: {
          id: exam.id,
          title: exam.title,
          subject_name: exam.subject_name,
          class_name: exam.class_name || 'All Classes',
          instructions: exam.instructions || null,
          duration_minutes: Number(exam.duration_minutes || 30),
          total_marks: Number(exam.total_marks || 0),
          show_result_immediately: Number(exam.show_result_immediately ?? 1) === 1,
          show_correct_answers: Number(exam.show_correct_answers ?? 1) === 1,
        },
        attempt: {
          id: activeAttempt.id,
          status: activeAttempt.status,
          started_at: activeAttempt.started_at,
          expires_at: activeAttempt.expires_at,
          tab_switch_count: Number(activeAttempt.tab_switch_count || 0),
          answers: safeParseJson<Record<string, StoredAnswerEntry>>(activeAttempt.answers_json, {}),
        },
        questions: orderedQuestions.map(sanitizeQuestionForStudent),
      });
    }

    // Starting a fresh attempt — check schedule window, PIN code, and max attempts
    if (exam.starts_at && nowMs < new Date(exam.starts_at).getTime()) {
      return res.status(403).json({ error: 'NOT_YET_OPEN', message: 'This CBT exam has not opened yet.' });
    }
    if (exam.ends_at && nowMs > new Date(exam.ends_at).getTime()) {
      return res.status(403).json({ error: 'WINDOW_CLOSED', message: 'The examination window for this CBT exam has closed.' });
    }

    if (exam.access_code && String(exam.access_code).trim()) {
      const providedCode = String(req.body?.access_code || '').trim().toUpperCase();
      if (!providedCode || providedCode !== String(exam.access_code).trim().toUpperCase()) {
        return res.status(403).json({
          error: 'INVALID_ACCESS_CODE',
          message: 'Invalid exam access PIN. Please ask your invigilator or teacher for the correct code.',
        });
      }
    }

    const priorCountRow = await dbGet(
      `SELECT COUNT(*) as c FROM cbt_attempts
       WHERE school_id = $1 AND cbt_exam_id = $2 AND student_id = $3 AND status != 'RESET'`,
      `SELECT COUNT(*) as c FROM cbt_attempts
       WHERE school_id = ? AND cbt_exam_id = ? AND student_id = ? AND status != 'RESET'`,
      [schoolId, examId, student.id]
    );
    const priorCount = Number(priorCountRow?.c || 0);
    if (priorCount >= Number(exam.max_attempts || 1)) {
      return res.status(403).json({
        error: 'MAX_ATTEMPTS_REACHED',
        message: 'You have already completed the maximum allowed attempt(s) for this CBT exam.',
      });
    }

    const orderedQuestions = Number(exam.shuffle_questions ?? 1) === 1 ? shuffleArray(questions) : questions;
    const questionOrderIds = orderedQuestions.map((q: any) => q.id);
    const durationSec = Math.max(60, Number(exam.duration_minutes || 30) * 60);
    const startedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + durationSec * 1000).toISOString();
    const maxScore = Math.round(questions.reduce((acc: number, q: any) => acc + Number(q.marks || 1), 0) * 100) / 100;
    const attemptId = newId('cbta');

    await execWrite(
      `INSERT INTO cbt_attempts (
        id, school_id, cbt_exam_id, student_id, student_name, admission_number,
        class_id, class_name, attempt_number, status, started_at, expires_at,
        question_order_json, answers_json, total_questions, unanswered_count, max_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'IN_PROGRESS', $10, $11, $12, '{}', $13, $14, $15)`,
      `INSERT INTO cbt_attempts (
        id, school_id, cbt_exam_id, student_id, student_name, admission_number,
        class_id, class_name, attempt_number, status, started_at, expires_at,
        question_order_json, answers_json, total_questions, unanswered_count, max_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, '{}', ?, ?, ?)`,
      [
        attemptId,
        schoolId,
        examId,
        student.id,
        student.full_name,
        student.admission_number || null,
        student.class_id || null,
        student.resolved_class_name || student.class_name || null,
        priorCount + 1,
        startedAt,
        expiresAt,
        JSON.stringify(questionOrderIds),
        orderedQuestions.length,
        orderedQuestions.length,
        maxScore,
      ]
    );

    return res.status(201).json({
      success: true,
      resumed: false,
      server_now: startedAt,
      remaining_seconds: durationSec,
      exam: {
        id: exam.id,
        title: exam.title,
        subject_name: exam.subject_name,
        class_name: exam.class_name || 'All Classes',
        instructions: exam.instructions || null,
        duration_minutes: Number(exam.duration_minutes || 30),
        total_marks: maxScore,
        show_result_immediately: Number(exam.show_result_immediately ?? 1) === 1,
        show_correct_answers: Number(exam.show_correct_answers ?? 1) === 1,
      },
      attempt: {
        id: attemptId,
        status: 'IN_PROGRESS',
        started_at: startedAt,
        expires_at: expiresAt,
        tab_switch_count: 0,
        answers: {},
      },
      questions: orderedQuestions.map(sanitizeQuestionForStudent),
    });
  }
);

// PUT /api/v1/cbt/student/attempts/:attemptId/answer
cbtRouter.put(
  '/student/attempts/:attemptId/answer',
  requireAuth,
  requireTenant,
  requireRole(['STUDENT']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const attemptId = String(req.params.attemptId || '');
    const student = await getStudentForUser(schoolId, req.user!.id);
    if (!student) {
      return res.status(404).json({ error: 'STUDENT_PROFILE_NOT_FOUND', message: 'Student profile not found.' });
    }

    const attempt = await dbGet(
      `SELECT * FROM cbt_attempts WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM cbt_attempts WHERE id = ? AND school_id = ?`,
      [attemptId, schoolId]
    );
    if (!attempt || String(attempt.student_id) !== String(student.id)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have access to this CBT attempt.' });
    }
    if (attempt.status !== 'IN_PROGRESS') {
      return res.status(409).json({ error: 'ALREADY_SUBMITTED', message: 'This CBT attempt has already been submitted.' });
    }

    const exam = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM cbt_exams WHERE id = ? AND school_id = ?`,
      [attempt.cbt_exam_id, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    const answersMap = safeParseJson<Record<string, StoredAnswerEntry>>(attempt.answers_json, {});
    const nowMs = Date.now();
    const expiresMs = new Date(attempt.expires_at).getTime();

    // Update answer entry if provided
    const qid = req.body?.question_id ? String(req.body.question_id).trim() : '';
    if (qid) {
      const prev = answersMap[qid] || {};
      answersMap[qid] = {
        selected: req.body.selected !== undefined ? String(req.body.selected ?? '') : prev.selected,
        flagged: req.body.flagged !== undefined ? Boolean(req.body.flagged) : Boolean(prev.flagged),
        updated_at: new Date(nowMs).toISOString(),
      };
    }

    const tabDelta = Math.max(0, Math.min(10, Number(req.body?.tab_switch_delta || 0) || 0));
    const nextTabSwitches = Number(attempt.tab_switch_count || 0) + tabDelta;

    // Server-authoritative timer expiration check (+5s grace for network latency)
    if (!Number.isNaN(expiresMs) && nowMs > expiresMs + 5000) {
      const { updated } = await finalizeAttemptInDb(schoolId, exam, attempt, answersMap, 'AUTO_SUBMITTED');
      return res.json({
        success: true,
        auto_submitted: true,
        remaining_seconds: 0,
        attempt: {
          id: updated.id,
          status: updated.status,
          score_obtained: Number(exam.show_result_immediately ?? 1) === 1 ? Number(updated.score_obtained) : null,
          max_score: Number(exam.show_result_immediately ?? 1) === 1 ? Number(updated.max_score) : null,
          percentage: Number(exam.show_result_immediately ?? 1) === 1 ? Number(updated.percentage) : null,
          grade: Number(exam.show_result_immediately ?? 1) === 1 ? updated.grade : null,
          passed: Number(exam.show_result_immediately ?? 1) === 1 ? Number(updated.passed) === 1 : null,
        },
      });
    }

    const answeredCount = Object.values(answersMap).filter((e) => e?.selected && String(e.selected).trim().length > 0).length;

    await execWrite(
      `UPDATE cbt_attempts
       SET answers_json = $1, answered_count = $2, tab_switch_count = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND school_id = $5`,
      `UPDATE cbt_attempts
       SET answers_json = ?, answered_count = ?, tab_switch_count = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND school_id = ?`,
      [JSON.stringify(answersMap), answeredCount, nextTabSwitches, attempt.id, schoolId]
    );

    return res.json({
      success: true,
      auto_submitted: false,
      saved_at: new Date(nowMs).toISOString(),
      answered_count: answeredCount,
      tab_switch_count: nextTabSwitches,
      remaining_seconds: Math.max(0, Math.floor((expiresMs - nowMs) / 1000)),
    });
  }
);

// POST /api/v1/cbt/student/attempts/:attemptId/submit
cbtRouter.post(
  '/student/attempts/:attemptId/submit',
  requireAuth,
  requireTenant,
  requireRole(['STUDENT']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const attemptId = String(req.params.attemptId || '');
    const student = await getStudentForUser(schoolId, req.user!.id);
    if (!student) {
      return res.status(404).json({ error: 'STUDENT_PROFILE_NOT_FOUND', message: 'Student profile not found.' });
    }

    const attempt = await dbGet(
      `SELECT * FROM cbt_attempts WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM cbt_attempts WHERE id = ? AND school_id = ?`,
      [attemptId, schoolId]
    );
    if (!attempt || String(attempt.student_id) !== String(student.id)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied to this CBT attempt.' });
    }

    const exam = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM cbt_exams WHERE id = ? AND school_id = ?`,
      [attempt.cbt_exam_id, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    const answersMap = safeParseJson<Record<string, StoredAnswerEntry>>(attempt.answers_json, {});
    if (req.body?.answers && typeof req.body.answers === 'object') {
      for (const [qid, entry] of Object.entries(req.body.answers as Record<string, any>)) {
        if (entry && typeof entry === 'object') {
          answersMap[qid] = {
            selected: entry.selected !== undefined ? String(entry.selected ?? '') : answersMap[qid]?.selected,
            flagged: entry.flagged !== undefined ? Boolean(entry.flagged) : Boolean(answersMap[qid]?.flagged),
            updated_at: new Date().toISOString(),
          };
        }
      }
    }

    const isAuto = req.body?.auto_submitted === true;
    const { updated, stats } =
      attempt.status === 'IN_PROGRESS'
        ? await finalizeAttemptInDb(schoolId, exam, attempt, answersMap, isAuto ? 'AUTO_SUBMITTED' : 'SUBMITTED')
        : {
            updated: attempt,
            stats: gradeAndFinalizeStats(
              exam,
              await dbAll(
                `SELECT * FROM cbt_questions WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY question_order ASC`,
                `SELECT * FROM cbt_questions WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY question_order ASC`,
                [schoolId, exam.id]
              ),
              answersMap
            ),
          };

    const showResult = Number(exam.show_result_immediately ?? 1) === 1;
    const showAnswers = showResult && Number(exam.show_correct_answers ?? 1) === 1;

    return res.json({
      success: true,
      result_withheld: !showResult,
      attempt: {
        id: updated.id,
        cbt_exam_id: exam.id,
        exam_title: exam.title,
        subject_name: exam.subject_name,
        status: updated.status,
        submitted_at: updated.submitted_at,
        time_spent_seconds: Number(updated.time_spent_seconds || 0),
        total_questions: Number(updated.total_questions || stats.totalQuestions),
        answered_count: Number(updated.answered_count || stats.answeredCount),
        correct_count: showResult ? Number(updated.correct_count || 0) : null,
        wrong_count: showResult ? Number(updated.wrong_count || 0) : null,
        unanswered_count: showResult ? Number(updated.unanswered_count || 0) : null,
        score_obtained: showResult ? Number(updated.score_obtained || 0) : null,
        max_score: showResult ? Number(updated.max_score || 0) : null,
        percentage: showResult ? Number(updated.percentage || 0) : null,
        grade: showResult ? updated.grade : null,
        passed: showResult ? Number(updated.passed) === 1 : null,
      },
      review: showAnswers ? stats.reviewItems : null,
    });
  }
);

// GET /api/v1/cbt/student/attempts/:attemptId/review
cbtRouter.get(
  '/student/attempts/:attemptId/review',
  requireAuth,
  requireTenant,
  requireRole(['STUDENT', 'PARENT', ...CBT_AUTHOR_ROLES]),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const attemptId = String(req.params.attemptId || '');
    const roleName = getEffectiveRoleName(req);

    const attempt = await dbGet(
      `SELECT * FROM cbt_attempts WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM cbt_attempts WHERE id = ? AND school_id = ?`,
      [attemptId, schoolId]
    );
    if (!attempt) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT attempt not found.' });
    }
    if (attempt.status === 'IN_PROGRESS') {
      return res.status(403).json({ error: 'EXAM_IN_PROGRESS', message: 'Answer review is unavailable while an exam is in progress.' });
    }

    const allowed = await canAccessStudent(req, attempt.student_id);
    if (!allowed) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You are not authorized to view this CBT attempt.' });
    }

    const exam = await dbGet(
      `SELECT * FROM cbt_exams WHERE id = $1 AND school_id = $2`,
      `SELECT * FROM cbt_exams WHERE id = ? AND school_id = ?`,
      [attempt.cbt_exam_id, schoolId]
    );
    if (!exam) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'CBT exam not found.' });
    }

    const isStaff = Boolean(roleName && CBT_AUTHOR_ROLES.includes(roleName));
    const canSeeResult = isStaff || Number(exam.show_result_immediately ?? 1) === 1;
    const canSeeAnswers = isStaff || (canSeeResult && Number(exam.show_correct_answers ?? 1) === 1);

    if (!canSeeResult) {
      return res.status(403).json({
        error: 'RESULT_WITHHELD',
        message: 'Results for this CBT examination are currently withheld by the school.',
      });
    }

    const questions = await dbAll(
      `SELECT * FROM cbt_questions
       WHERE school_id = $1 AND cbt_exam_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY question_order ASC, created_at ASC`,
      `SELECT * FROM cbt_questions
       WHERE school_id = ? AND cbt_exam_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY question_order ASC, created_at ASC`,
      [schoolId, exam.id]
    );

    const answersMap = safeParseJson<Record<string, StoredAnswerEntry>>(attempt.answers_json, {});
    const stats = gradeAndFinalizeStats(exam, questions, answersMap);

    return res.json({
      success: true,
      exam: {
        id: exam.id,
        title: exam.title,
        subject_name: exam.subject_name,
        class_name: exam.class_name || 'All Classes',
        pass_mark_percent: Number(exam.pass_mark_percent ?? 50),
      },
      attempt: {
        id: attempt.id,
        student_name: attempt.student_name,
        admission_number: attempt.admission_number,
        status: attempt.status,
        submitted_at: attempt.submitted_at,
        time_spent_seconds: Number(attempt.time_spent_seconds || 0),
        total_questions: Number(attempt.total_questions || stats.totalQuestions),
        answered_count: Number(attempt.answered_count || stats.answeredCount),
        correct_count: Number(attempt.correct_count || 0),
        wrong_count: Number(attempt.wrong_count || 0),
        unanswered_count: Number(attempt.unanswered_count || 0),
        score_obtained: Number(attempt.score_obtained || 0),
        max_score: Number(attempt.max_score || 0),
        percentage: Number(attempt.percentage || 0),
        grade: attempt.grade,
        passed: Number(attempt.passed) === 1,
        tab_switch_count: Number(attempt.tab_switch_count || 0),
      },
      review: canSeeAnswers ? stats.reviewItems : null,
    });
  }
);

// ==============================================================================
// 5. PARENT READ-ONLY CHILD CBT RESULTS
// ==============================================================================

// GET /api/v1/cbt/parent/results?student_id=...
cbtRouter.get(
  '/parent/results',
  requireAuth,
  requireTenant,
  requireRole(['PARENT', ...ADMIN_ONLY_ROLES]),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const roleName = getEffectiveRoleName(req);
    const requestedStudentId = String(req.query.student_id || '').trim();

    const authorizedIds = await getAuthorizedStudentIds(req.user!.id, schoolId, roleName);
    let targetIds: string[] = [];

    if (authorizedIds !== null) {
      if (requestedStudentId) {
        if (!authorizedIds.includes(requestedStudentId)) {
          return res.status(403).json({
            error: 'FORBIDDEN',
            message: 'You are not authorized to view CBT results for this student.',
          });
        }
        targetIds = [requestedStudentId];
      } else {
        targetIds = authorizedIds;
      }
    } else if (requestedStudentId) {
      targetIds = [requestedStudentId];
    }

    if (targetIds.length === 0) {
      return res.json({ success: true, results: [] });
    }

    const pgPlaceholders = targetIds.map((_, idx) => `$${idx + 2}`).join(', ');
    const sqPlaceholders = targetIds.map(() => '?').join(', ');

    const rows = await dbAll(
      `SELECT a.*, e.title as exam_title, e.subject_name, e.exam_mode, e.pass_mark_percent,
              e.show_result_immediately, e.show_correct_answers
       FROM cbt_attempts a
       JOIN cbt_exams e ON a.cbt_exam_id = e.id
       WHERE a.school_id = $1
         AND a.student_id IN (${pgPlaceholders})
         AND a.status IN ('SUBMITTED', 'AUTO_SUBMITTED')
         AND COALESCE(e.show_result_immediately, 1) = 1
       ORDER BY a.submitted_at DESC, a.created_at DESC`,
      `SELECT a.*, e.title as exam_title, e.subject_name, e.exam_mode, e.pass_mark_percent,
              e.show_result_immediately, e.show_correct_answers
       FROM cbt_attempts a
       JOIN cbt_exams e ON a.cbt_exam_id = e.id
       WHERE a.school_id = ?
         AND a.student_id IN (${sqPlaceholders})
         AND a.status IN ('SUBMITTED', 'AUTO_SUBMITTED')
         AND COALESCE(e.show_result_immediately, 1) = 1
       ORDER BY a.submitted_at DESC, a.created_at DESC`,
      [schoolId, ...targetIds]
    );

    return res.json({
      success: true,
      results: rows.map((r: any) => ({
        id: r.id,
        cbt_exam_id: r.cbt_exam_id,
        student_id: r.student_id,
        student_name: r.student_name,
        admission_number: r.admission_number,
        class_name: r.class_name,
        exam_title: r.exam_title,
        subject_name: r.subject_name,
        exam_mode: r.exam_mode,
        status: r.status,
        submitted_at: r.submitted_at,
        time_spent_seconds: Number(r.time_spent_seconds || 0),
        total_questions: Number(r.total_questions || 0),
        correct_count: Number(r.correct_count || 0),
        score_obtained: Number(r.score_obtained || 0),
        max_score: Number(r.max_score || 0),
        percentage: Number(r.percentage || 0),
        grade: r.grade,
        passed: Number(r.passed) === 1,
        can_review: Number(r.show_correct_answers ?? 1) === 1,
      })),
    });
  }
);
