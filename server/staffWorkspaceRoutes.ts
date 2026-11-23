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
  dbAll,
  dbGet,
  getEffectiveRoleName,
  newId,
} from './accessControl.ts';
import { logAudit } from './audit.ts';
import { notificationService } from './notificationService.ts';
import { wrapRouterAsync } from './securityUtils.ts';
import { resolveInstitutionProfile } from '../src/utils/institutionMode.ts';

export const staffWorkspaceRouter = wrapRouterAsync(Router());

// Dedicated Staff & Admin roles — STRICTLY blocks PARENT, STUDENT, and BURSAR from private staff workspace
export const STAFF_WORKSPACE_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'STAFF'];

const staffOnlyGuard = [requireAuth, requireTenant, requireRole(STAFF_WORKSPACE_ROLES)];
const adminReviewGuard = [requireAuth, requireTenant, requireRole(ADMIN_ONLY_ROLES)];

async function execWrite(pgSql: string, sqliteSql: string, pgParams: any[], sqliteParams?: any[]) {
  const pool = getPgPool();
  if (pool) {
    await queryPg(pgSql, pgParams);
  }
  try {
    cacheDb.prepare(sqliteSql).run(...(sqliteParams ?? pgParams));
  } catch (err: any) {
    console.warn('[StaffWorkspace SQLite Cache Sync Notice]', err?.message);
  }
}

/**
 * Deterministic Nigerian NERDC-Aligned Lesson Plan & Lesson Note Generator
 * Runs server-side without requiring external API keys.
 */
function buildNerdcLessonPlanDraft(params: {
  subjectName: string;
  className: string;
  termName: string;
  weekNumber: number;
  durationMinutes: number;
  topic: string;
  subTopic?: string;
}) {
  const subject = params.subjectName.trim();
  const className = params.className.trim();
  const term = params.termName.trim() || '1st Term';
  const week = Math.max(1, Math.min(14, Number(params.weekNumber || 1)));
  const duration = Math.max(20, Math.min(180, Number(params.durationMinutes || 40)));
  const topic = params.topic.trim();
  const subTopic = (params.subTopic || `Core Concepts & Applications of ${topic}`).trim();

  const lowerSubj = subject.toLowerCase();
  const isMath = /math|algebra|geometry|calc|stat|arith/.test(lowerSubj);
  const isScience = /phys|chem|bio|agric|basic sci|health|science/.test(lowerSubj);
  const isLang = /eng|lit|yoruba|igbo|hausa|french|phonics|reading|grammar/.test(lowerSubj);
  const isVocational = /ict|comp|data|tech|civic|social|comm|econ|account|govt|hist/.test(lowerSubj);

  const objectives = [
    `By the end of this ${duration}-minute lesson, ${className} learners should be able to:`,
    `1. Define and explain "${topic}" clearly in their own words within the Nigerian ${className} curriculum context.`,
    isMath
      ? `2. State key formulas/rules governing ${topic} and work out at least three guided numerical problems accurately.`
      : isScience
      ? `2. Identify scientific principles, observable features, or practical processes involved in ${topic}.`
      : isLang
      ? `2. Identify correct usage, structure, and comprehension cues related to ${topic} in written and spoken expression.`
      : `2. Outline three real-life applications or civic implications of ${topic} in Nigerian society.`,
    `3. Solve independent evaluation exercises on ${subTopic} with at least 80% accuracy.`,
  ].join('\n');

  const previousKnowledge = `Students have prior exposure to foundational ${subject} concepts taught in earlier weeks of ${term} and relatable everyday experiences in their community.`;

  const instructionalMaterials = isMath
    ? `NERDC ${className} Mathematics Textbook, whiteboard & markers, worked-example chart on ${topic}, mathematical set / graph board, and learner workbooks.`
    : isScience
    ? `NERDC ${className} ${subject} Textbook, labelled instructional wall chart on ${topic}, approved laboratory apparatus / specimen models, and whiteboard.`
    : isLang
    ? `NERDC ${className} ${subject} Reader & Curriculum Guide, flashcards displaying ${topic} examples, sample passage sheet, and whiteboard.`
    : isVocational
    ? `NERDC ${className} ${subject} Curriculum Guide, real-world Nigerian case examples on ${topic}, visual reference chart, and whiteboard.`
    : `NERDC-approved ${className} ${subject} Textbook, lesson reference chart on ${topic}, whiteboard, and learner exercise books.`;

  const introStep = `Step I — Introduction (5 mins): Teacher greets learners, checks attendance, reviews Week ${Math.max(1, week - 1)} prior concepts using quick oral warm-up prompts, and introduces "${topic}" (${subTopic}) with a relatable Nigerian classroom illustration.`;

  const presentationSteps = [
    `Step II — Concept Explanation (${Math.round(duration * 0.3)} mins):\n• Teacher clearly writes "${topic}" on the board and breaks down "${subTopic}" into logical points aligned with the NERDC scheme of work for ${className} (${term}, Week ${week}).\n• Students listen attentively, ask clarifying questions, and note key definitions.`,
    `Step III — Guided Practice & Demonstration (${Math.round(duration * 0.3)} mins):\n• Teacher works through two step-by-step ${isMath ? 'worked calculations' : isScience ? 'guided observations/diagrams' : 'structured classroom examples'} on the board, inviting volunteer learners to participate.\n• Class discusses common errors to avoid.`,
    `Step IV — Collaborative Group Activity (${Math.round(duration * 0.15)} mins):\n• Learners pair up to solve or discuss a brief 2-question drill while teacher moves around providing formative feedback.`,
    `Step V — Summary & Board Copy (${Math.round(duration * 0.1)} mins):\n• Teacher summarizes the key takeaways and directs students to copy clean board notes into their exercise books.`,
  ].join('\n\n');

  const evaluationQuestions = [
    `1. In clear terms, what is ${topic}?`,
    `2. State two important characteristics, rules, or applications of ${subTopic}.`,
    isMath
      ? `3. Solve the two board practice exercises independently showing complete workings.`
      : `3. Explain how ${topic} applies to an everyday situation you can observe around you.`,
  ].join('\n');

  const assignmentText = `1. Review today's class notes on ${topic}.\n2. Answer Questions 1–4 under Week ${week} Revision in your ${subject} workbook on ${subTopic}.\n3. Prepare one question or real-life example to share in the next lesson.`;

  return {
    topic,
    sub_topic: subTopic,
    behavioural_objectives: objectives,
    previous_knowledge: previousKnowledge,
    instructional_materials: instructionalMaterials,
    introduction_step: introStep,
    presentation_steps: presentationSteps,
    evaluation_questions: evaluationQuestions,
    assignment_text: assignmentText,
  };
}

function buildTertiaryLectureOutlineDraft(params: {
  subjectName: string;
  className: string;
  termName: string;
  weekNumber: number;
  durationMinutes: number;
  topic: string;
  subTopic?: string;
  schoolType?: string;
}) {
  const course = params.subjectName.trim();
  const levelName = params.className.trim();
  const semester = params.termName.trim() || '1st Semester';
  const week = Math.max(1, Math.min(16, Number(params.weekNumber || 1)));
  const duration = Math.max(30, Math.min(240, Number(params.durationMinutes || 120)));
  const topic = params.topic.trim();
  const subTopic = (params.subTopic || `Theoretical Foundations & Applied Analysis of ${topic}`).trim();
  const standardBody = /polytechnic/i.test(params.schoolType || '') ? 'NBTE' : 'NUC CCMAS';

  const objectives = [
    `Upon completing this ${duration}-minute ${levelName} lecture, students should be able to:`,
    `1. Critically define and formulate the theoretical principles underlying "${topic}" within ${course}.`,
    `2. Analyze and apply "${subTopic}" to real-world engineering, analytical, or professional problem sets.`,
    `3. Synthesize peer-reviewed references and defend solutions during tutorial/seminar review.`,
  ].join('\n');

  const previousKnowledge = `Students have completed prerequisite modules from Weeks 1–${Math.max(1, week - 1)} of ${semester} in ${course} and foundational ${levelName} departmental coursework.`;

  const instructionalMaterials = `${standardBody}-aligned ${course} Course Synopsis & Lecture Slides, recommended university textbooks & journal excerpts on ${topic}, projector/whiteboard, and ${levelName} tutorial problem sheet.`;

  const introStep = `Part I — Lecture Framing & Recap (${Math.round(duration * 0.1)} mins): Lecturer links Week ${Math.max(1, week - 1)} concepts to today's module "${topic}" (${subTopic}), outlines expected learning outcomes, and states assessment relevance.`;

  const presentationSteps = [
    `Part II — Core Theoretical Exposition (${Math.round(duration * 0.35)} mins):\n• Lecturer presents the formal definitions, models, and derivations of "${topic}" in line with the ${standardBody} syllabus for ${levelName} (${semester}, Week ${week}).\n• Students annotate lecture handouts and raise clarification queries.`,
    `Part III — Applied Case Study & Worked Analysis (${Math.round(duration * 0.3)} mins):\n• Lecturer demonstrates two rigorous worked examples or empirical Nigerian/international case analyses illustrating "${subTopic}".\n• Critical evaluation of assumptions, edge cases, and methodological trade-offs.`,
    `Part IV — Interactive Seminar & Tutorial Discussion (${Math.round(duration * 0.15)} mins):\n• Students discuss applied tutorial prompts in small groups and present concise critiques to the lecture hall.`,
    `Part V — Synthesis & Reading List (${Math.round(duration * 0.1)} mins):\n• Lecturer consolidates key takeaways, highlights examinable principles, and assigns pre-reading for Week ${week + 1}.`,
  ].join('\n\n');

  const evaluationQuestions = [
    `1. Critically examine the core principles and formal structure of ${topic}.`,
    `2. Using an applied scenario in ${course}, demonstrate how ${subTopic} solves a practical problem.`,
    `3. Identify two limitations or boundary conditions of the standard approach to ${topic}.`,
  ].join('\n');

  const assignmentText = `1. Complete Tutorial Problem Set ${week} on "${topic}" and submit before the next ${course} lecture.\n2. Read the assigned chapter/article on "${subTopic}" and prepare a 1-page critical summary.\n3. Review worked lecture derivations in preparation for Continuous Assessment (CA).`;

  return {
    topic,
    sub_topic: subTopic,
    behavioural_objectives: objectives,
    previous_knowledge: previousKnowledge,
    instructional_materials: instructionalMaterials,
    introduction_step: introStep,
    presentation_steps: presentationSteps,
    evaluation_questions: evaluationQuestions,
    assignment_text: assignmentText,
  };
}

// ==============================================================================
// 1. LESSON NOTES & LECTURE OUTLINES STUDIO
// ==============================================================================

// POST /api/v1/staff-workspace/lesson-notes/generate
staffWorkspaceRouter.post('/lesson-notes/generate', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const subjectName = String(req.body?.subject_name || '').trim();
  const className = String(req.body?.class_name || '').trim();
  const termName = String(req.body?.term_name || '').trim();
  const weekNumber = Number(req.body?.week_number || 1);
  const durationMinutes = Number(req.body?.duration_minutes || 40);
  const topic = String(req.body?.topic || '').trim();
  const subTopic = String(req.body?.sub_topic || '').trim();

  if (!subjectName || !className || !topic) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Subject/Course, Class/Level, and Topic are required to generate a draft.',
    });
  }

  const school = await dbGet(
    `SELECT id, type FROM schools WHERE id = $1 LIMIT 1`,
    `SELECT id, type FROM schools WHERE id = ? LIMIT 1`,
    [schoolId]
  );
  const schoolSettings = await dbGet(
    `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json, current_term
     FROM school_settings WHERE school_id = $1 LIMIT 1`,
    `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json, current_term
     FROM school_settings WHERE school_id = ? LIMIT 1`,
    [schoolId]
  );
  const instProfile = resolveInstitutionProfile(school, schoolSettings);
  const resolvedTerm = termName || instProfile.cycleLabels[0] || '1st Term';

  if (instProfile.isTertiary) {
    const generated = buildTertiaryLectureOutlineDraft({
      subjectName,
      className,
      termName: resolvedTerm,
      weekNumber,
      durationMinutes: Number(req.body?.duration_minutes || 120),
      topic,
      subTopic,
      schoolType: school?.type,
    });
    return res.json({
      success: true,
      draft: generated,
      message: 'Structured Higher Institution lecture note & course outline draft generated. Review and customize before saving.',
    });
  }

  const generated = buildNerdcLessonPlanDraft({
    subjectName,
    className,
    termName: resolvedTerm,
    weekNumber,
    durationMinutes,
    topic,
    subTopic,
  });

  return res.json({
    success: true,
    draft: generated,
    message: 'Structured NERDC lesson plan draft generated. Review and customize before saving.',
  });
});

// GET /api/v1/staff-workspace/lesson-notes
staffWorkspaceRouter.get('/lesson-notes', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const roleName = getEffectiveRoleName(req);
  const isAdmin = Boolean(roleName && ADMIN_ONLY_ROLES.includes(roleName));
  const statusFilter = String(req.query.status || '').trim().toUpperCase();

  let notes: any[];
  if (isAdmin) {
    notes = await dbAll(
      `SELECT * FROM lesson_notes
       WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY updated_at DESC, created_at DESC LIMIT 200`,
      `SELECT * FROM lesson_notes
       WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       ORDER BY updated_at DESC, created_at DESC LIMIT 200`,
      [schoolId]
    );
  } else {
    // Staff/Teachers see all their own notes plus any APPROVED shared colleague notes
    notes = await dbAll(
      `SELECT * FROM lesson_notes
       WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
         AND (teacher_user_id = $2 OR status = 'APPROVED')
       ORDER BY updated_at DESC, created_at DESC LIMIT 200`,
      `SELECT * FROM lesson_notes
       WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
         AND (teacher_user_id = ? OR status = 'APPROVED')
       ORDER BY updated_at DESC, created_at DESC LIMIT 200`,
      [schoolId, req.user!.id]
    );
  }

  if (statusFilter && statusFilter !== 'ALL') {
    notes = notes.filter((n) => String(n.status).toUpperCase() === statusFilter);
  }

  return res.json({ success: true, lessonNotes: notes });
});

// POST /api/v1/staff-workspace/lesson-notes
staffWorkspaceRouter.post('/lesson-notes', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const subjectName = String(req.body?.subject_name || '').trim();
  const className = String(req.body?.class_name || '').trim();
  const topic = String(req.body?.topic || '').trim();

  if (!subjectName || !className || !topic) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Subject, Class, and Topic are required.',
    });
  }

  const allowedCreateStatuses = ['DRAFT', 'SUBMITTED'];
  const requestedStatus = String(req.body?.status || 'DRAFT').toUpperCase();
  const status = allowedCreateStatuses.includes(requestedStatus) ? requestedStatus : 'DRAFT';

  const id = newId('ln');
  const teacherName = String(req.body?.teacher_name || req.user?.full_name || 'Staff Member').trim();

  await execWrite(
    `INSERT INTO lesson_notes (
       id, school_id, teacher_user_id, teacher_name, subject_id, subject_name,
       class_id, class_name, academic_session_id, term_name, week_number, duration_minutes,
       topic, sub_topic, behavioural_objectives, previous_knowledge, instructional_materials,
       introduction_step, presentation_steps, evaluation_questions, assignment_text, teacher_notes, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    `INSERT INTO lesson_notes (
       id, school_id, teacher_user_id, teacher_name, subject_id, subject_name,
       class_id, class_name, academic_session_id, term_name, week_number, duration_minutes,
       topic, sub_topic, behavioural_objectives, previous_knowledge, instructional_materials,
       introduction_step, presentation_steps, evaluation_questions, assignment_text, teacher_notes, status
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      schoolId,
      req.user!.id,
      teacherName,
      req.body?.subject_id || null,
      subjectName,
      req.body?.class_id || null,
      className,
      req.body?.academic_session_id || null,
      String(req.body?.term_name || '1st Term').trim(),
      Number(req.body?.week_number || 1),
      Number(req.body?.duration_minutes || 40),
      topic,
      req.body?.sub_topic ? String(req.body.sub_topic).trim() : null,
      req.body?.behavioural_objectives ? String(req.body.behavioural_objectives).trim() : null,
      req.body?.previous_knowledge ? String(req.body.previous_knowledge).trim() : null,
      req.body?.instructional_materials ? String(req.body.instructional_materials).trim() : null,
      req.body?.introduction_step ? String(req.body.introduction_step).trim() : null,
      req.body?.presentation_steps ? String(req.body.presentation_steps).trim() : null,
      req.body?.evaluation_questions ? String(req.body.evaluation_questions).trim() : null,
      req.body?.assignment_text ? String(req.body.assignment_text).trim() : null,
      req.body?.teacher_notes ? String(req.body.teacher_notes).trim() : null,
      status,
    ]
  );

  if (status === 'SUBMITTED') {
    notificationService.notifySchoolAdmins(
      schoolId,
      'SYSTEM',
      `Lesson Note Submitted: ${subjectName} (${className})`,
      `${teacherName} submitted a Week ${Number(req.body?.week_number || 1)} lesson note on "${topic}" for approval.`,
      { lessonNoteId: id }
    );
  }

  const lessonNote = await dbGet(
    `SELECT * FROM lesson_notes WHERE id = $1 LIMIT 1`,
    `SELECT * FROM lesson_notes WHERE id = ? LIMIT 1`,
    [id]
  );
  return res.status(201).json({
    success: true,
    lessonNote,
    message: status === 'SUBMITTED' ? 'Lesson note submitted for Principal review.' : 'Lesson note saved as draft.',
  });
});

// PUT /api/v1/staff-workspace/lesson-notes/:id
staffWorkspaceRouter.put('/lesson-notes/:id', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const existing = await dbGet(
    `SELECT * FROM lesson_notes WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
    `SELECT * FROM lesson_notes WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
    [req.params.id, schoolId]
  );
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Lesson note not found.' });
  }

  const roleName = getEffectiveRoleName(req);
  const isAdmin = Boolean(roleName && ADMIN_ONLY_ROLES.includes(roleName));
  if (!isAdmin && existing.teacher_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'You can only modify your own lesson notes.' });
  }

  const nextStatus =
    req.body?.status && ['DRAFT', 'SUBMITTED'].includes(String(req.body.status).toUpperCase())
      ? String(req.body.status).toUpperCase()
      : existing.status;

  await execWrite(
    `UPDATE lesson_notes SET
       subject_name=$1, class_name=$2, term_name=$3, week_number=$4, duration_minutes=$5,
       topic=$6, sub_topic=$7, behavioural_objectives=$8, previous_knowledge=$9,
       instructional_materials=$10, introduction_step=$11, presentation_steps=$12,
       evaluation_questions=$13, assignment_text=$14, teacher_notes=$15, status=$16,
       updated_at=CURRENT_TIMESTAMP
     WHERE id=$17 AND school_id=$18`,
    `UPDATE lesson_notes SET
       subject_name=?, class_name=?, term_name=?, week_number=?, duration_minutes=?,
       topic=?, sub_topic=?, behavioural_objectives=?, previous_knowledge=?,
       instructional_materials=?, introduction_step=?, presentation_steps=?,
       evaluation_questions=?, assignment_text=?, teacher_notes=?, status=?,
       updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND school_id=?`,
    [
      req.body?.subject_name !== undefined ? String(req.body.subject_name).trim() : existing.subject_name,
      req.body?.class_name !== undefined ? String(req.body.class_name).trim() : existing.class_name,
      req.body?.term_name !== undefined ? String(req.body.term_name).trim() : existing.term_name,
      req.body?.week_number !== undefined ? Number(req.body.week_number) : existing.week_number,
      req.body?.duration_minutes !== undefined ? Number(req.body.duration_minutes) : existing.duration_minutes,
      req.body?.topic !== undefined ? String(req.body.topic).trim() : existing.topic,
      req.body?.sub_topic !== undefined ? req.body.sub_topic : existing.sub_topic,
      req.body?.behavioural_objectives !== undefined ? req.body.behavioural_objectives : existing.behavioural_objectives,
      req.body?.previous_knowledge !== undefined ? req.body.previous_knowledge : existing.previous_knowledge,
      req.body?.instructional_materials !== undefined ? req.body.instructional_materials : existing.instructional_materials,
      req.body?.introduction_step !== undefined ? req.body.introduction_step : existing.introduction_step,
      req.body?.presentation_steps !== undefined ? req.body.presentation_steps : existing.presentation_steps,
      req.body?.evaluation_questions !== undefined ? req.body.evaluation_questions : existing.evaluation_questions,
      req.body?.assignment_text !== undefined ? req.body.assignment_text : existing.assignment_text,
      req.body?.teacher_notes !== undefined ? req.body.teacher_notes : existing.teacher_notes,
      nextStatus,
      existing.id,
      schoolId,
    ]
  );

  if (nextStatus === 'SUBMITTED' && existing.status !== 'SUBMITTED') {
    notificationService.notifySchoolAdmins(
      schoolId,
      'SYSTEM',
      `Lesson Note Submitted for Review`,
      `${existing.teacher_name || req.user?.full_name} submitted a lesson note on "${req.body?.topic || existing.topic}" for approval.`,
      { lessonNoteId: existing.id }
    );
  }

  const lessonNote = await dbGet(
    `SELECT * FROM lesson_notes WHERE id = $1 LIMIT 1`,
    `SELECT * FROM lesson_notes WHERE id = ? LIMIT 1`,
    [existing.id]
  );

  return res.json({ success: true, lessonNote, message: 'Lesson note updated.' });
});

// POST /api/v1/staff-workspace/lesson-notes/:id/review (Strictly Admin/Principal)
staffWorkspaceRouter.post('/lesson-notes/:id/review', ...adminReviewGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const decision = String(req.body?.status || '').toUpperCase();
  if (!['APPROVED', 'REVISION_REQUESTED'].includes(decision)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Review decision must be APPROVED or REVISION_REQUESTED.' });
  }
  const feedback = req.body?.admin_feedback ? String(req.body.admin_feedback).trim() : null;

  const existing = await dbGet(
    `SELECT * FROM lesson_notes WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
    `SELECT * FROM lesson_notes WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
    [req.params.id, schoolId]
  );
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Lesson note not found.' });
  }

  await execWrite(
    `UPDATE lesson_notes SET status = $1, admin_feedback = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 AND school_id = $5`,
    `UPDATE lesson_notes SET status = ?, admin_feedback = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND school_id = ?`,
    [decision, feedback, req.user!.id, existing.id, schoolId]
  );

  if (existing.teacher_user_id) {
    notificationService.createNotification({
      schoolId,
      userId: existing.teacher_user_id,
      type: 'SYSTEM',
      title: `Lesson Note ${decision === 'APPROVED' ? 'Approved' : 'Revision Requested'}: ${existing.topic}`,
      message: feedback || `Administration marked your ${existing.subject_name} (${existing.class_name}) lesson note as ${decision}.`,
      data: { lessonNoteId: existing.id, decision },
    });
  }

  logAudit({
    actorId: req.user?.id || null,
    actorEmail: req.user?.email || null,
    schoolId,
    action: 'LESSON_NOTE_REVIEWED',
    entity: 'lesson_notes',
    entityId: existing.id,
    metadata: { status: decision, admin_feedback: feedback },
  });

  const lessonNote = await dbGet(
    `SELECT * FROM lesson_notes WHERE id = $1 LIMIT 1`,
    `SELECT * FROM lesson_notes WHERE id = ? LIMIT 1`,
    [existing.id]
  );
  return res.json({ success: true, lessonNote, message: `Lesson note marked as ${decision}.` });
});

// DELETE /api/v1/staff-workspace/lesson-notes/:id
staffWorkspaceRouter.delete('/lesson-notes/:id', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const existing = await dbGet(
    `SELECT * FROM lesson_notes WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
    `SELECT * FROM lesson_notes WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
    [req.params.id, schoolId]
  );
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Lesson note not found.' });
  }
  const roleName = getEffectiveRoleName(req);
  const isAdmin = Boolean(roleName && ADMIN_ONLY_ROLES.includes(roleName));
  if (!isAdmin && existing.teacher_user_id !== req.user!.id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'You can only delete your own lesson notes.' });
  }

  await execWrite(
    `UPDATE lesson_notes SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
    `UPDATE lesson_notes SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
    [existing.id, schoolId]
  );
  return res.json({ success: true, message: 'Lesson note removed.' });
});

// ==============================================================================
// 2. CONFIDENTIAL STAFF NOTICES & ACKNOWLEDGMENT RECEIPTS
// Parents, Students & Bursars CANNOT access this endpoint (403).
// ==============================================================================

staffWorkspaceRouter.get('/confidential-notices', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const notices = await dbAll(
    `SELECT sa.*,
            sar.read_at as my_read_at,
            (SELECT COUNT(*) FROM staff_announcement_reads r WHERE r.announcement_id = sa.id) as acknowledged_count
     FROM (
       SELECT * FROM school_announcements
       WHERE school_id = $1
         AND (is_deleted = 0 OR is_deleted IS NULL)
         AND is_published = 1
         AND (audience IN ('STAFF_ONLY', 'TEACHERS', 'ALL') OR COALESCE(is_confidential, 0) = 1)
     ) sa
     LEFT JOIN staff_announcement_reads sar ON sar.announcement_id = sa.id AND sar.user_id = $2
     ORDER BY CASE WHEN sa.audience = 'STAFF_ONLY' OR COALESCE(sa.is_confidential, 0) = 1 THEN 0 ELSE 1 END,
              sa.published_at DESC, sa.created_at DESC
     LIMIT 100`,
    `SELECT sa.*,
            sar.read_at as my_read_at,
            (SELECT COUNT(*) FROM staff_announcement_reads r WHERE r.announcement_id = sa.id) as acknowledged_count
     FROM (
       SELECT * FROM school_announcements
       WHERE school_id = ?
         AND (is_deleted = 0 OR is_deleted IS NULL)
         AND is_published = 1
         AND (audience IN ('STAFF_ONLY', 'TEACHERS', 'ALL') OR COALESCE(is_confidential, 0) = 1)
     ) sa
     LEFT JOIN staff_announcement_reads sar ON sar.announcement_id = sa.id AND sar.user_id = ?
     ORDER BY CASE WHEN sa.audience = 'STAFF_ONLY' OR COALESCE(sa.is_confidential, 0) = 1 THEN 0 ELSE 1 END,
              sa.published_at DESC, sa.created_at DESC
     LIMIT 100`,
    [schoolId, req.user!.id]
  );

  return res.json({
    success: true,
    notices: notices.map((n) => ({
      ...n,
      is_acknowledged: Boolean(n.my_read_at),
      is_staff_confidential: n.audience === 'STAFF_ONLY' || n.audience === 'TEACHERS' || Number(n.is_confidential) === 1,
    })),
  });
});

staffWorkspaceRouter.post('/confidential-notices/:id/acknowledge', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const ann = await dbGet(
    `SELECT id FROM school_announcements
     WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
       AND (audience IN ('STAFF_ONLY', 'TEACHERS', 'ALL') OR COALESCE(is_confidential, 0) = 1)
     LIMIT 1`,
    `SELECT id FROM school_announcements
     WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
       AND (audience IN ('STAFF_ONLY', 'TEACHERS', 'ALL') OR COALESCE(is_confidential, 0) = 1)
     LIMIT 1`,
    [req.params.id, schoolId]
  );

  if (!ann) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Staff notice not found.' });
  }

  const id = newId('sar');
  await execWrite(
    `INSERT INTO staff_announcement_reads (id, school_id, announcement_id, user_id, read_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    `INSERT INTO staff_announcement_reads (id, school_id, announcement_id, user_id, read_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(announcement_id, user_id) DO NOTHING`,
    [id, schoolId, ann.id, req.user!.id]
  );

  return res.json({ success: true, message: 'Acknowledgment recorded.' });
});

// ==============================================================================
// 3. STAFF TEACHING TIMETABLE & INTERNAL CALENDAR EVENTS
// ==============================================================================

staffWorkspaceRouter.get('/timetable', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const slots = await dbAll(
    `SELECT * FROM school_timetable_slots
     WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY day_of_week ASC, start_time ASC`,
    `SELECT * FROM school_timetable_slots
     WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY day_of_week ASC, start_time ASC`,
    [schoolId]
  );
  return res.json({ success: true, slots });
});

staffWorkspaceRouter.get('/events', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const events = await dbAll(
    `SELECT * FROM school_calendar_events
     WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY event_date ASC LIMIT 100`,
    `SELECT * FROM school_calendar_events
     WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
     ORDER BY event_date ASC LIMIT 100`,
    [schoolId]
  );
  return res.json({ success: true, events });
});

// ==============================================================================
// 4. CONFIDENTIAL STAFF REQUESTS DESK (Leave, Teaching Resources, Maintenance)
// ==============================================================================

staffWorkspaceRouter.get('/requests', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const roleName = getEffectiveRoleName(req);
  const isAdmin = Boolean(roleName && ADMIN_ONLY_ROLES.includes(roleName));

  const requests = isAdmin
    ? await dbAll(
        `SELECT * FROM staff_requests
         WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY created_at DESC LIMIT 200`,
        `SELECT * FROM staff_requests
         WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY created_at DESC LIMIT 200`,
        [schoolId]
      )
    : await dbAll(
        `SELECT * FROM staff_requests
         WHERE school_id = $1 AND user_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY created_at DESC LIMIT 100`,
        `SELECT * FROM staff_requests
         WHERE school_id = ? AND user_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY created_at DESC LIMIT 100`,
        [schoolId, req.user!.id]
      );

  return res.json({ success: true, requests });
});

staffWorkspaceRouter.post('/requests', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const requestType = ['LEAVE', 'RESOURCES', 'MAINTENANCE', 'GENERAL'].includes(String(req.body?.request_type || '').toUpperCase())
    ? String(req.body.request_type).toUpperCase()
    : 'LEAVE';
  const subject = String(req.body?.subject || '').trim();
  const details = String(req.body?.details || '').trim();
  const startDate = req.body?.start_date ? String(req.body.start_date).trim() : null;
  const endDate = req.body?.end_date ? String(req.body.end_date).trim() : null;

  if (!subject || !details) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Request subject and details are required.' });
  }

  const id = newId('sreq');
  const staffName = req.user?.full_name || 'Staff Member';

  await execWrite(
    `INSERT INTO staff_requests (id, school_id, user_id, staff_name, request_type, subject, details, start_date, end_date, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING')`,
    `INSERT INTO staff_requests (id, school_id, user_id, staff_name, request_type, subject, details, start_date, end_date, status)
     VALUES (?,?,?,?,?,?,?,?,?,'PENDING')`,
    [id, schoolId, req.user!.id, staffName, requestType, subject, details, startDate, endDate]
  );

  notificationService.notifySchoolAdmins(
    schoolId,
    'SYSTEM',
    `New Staff ${requestType} Request: ${subject}`,
    `${staffName} submitted a confidential ${requestType.toLowerCase()} request.`,
    { requestId: id }
  );

  const request = await dbGet(
    `SELECT * FROM staff_requests WHERE id = $1 LIMIT 1`,
    `SELECT * FROM staff_requests WHERE id = ? LIMIT 1`,
    [id]
  );
  return res.status(201).json({ success: true, request, message: 'Request sent confidentially to School Administration.' });
});

staffWorkspaceRouter.patch('/requests/:id', ...adminReviewGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const status = String(req.body?.status || '').toUpperCase();
  if (!['PENDING', 'APPROVED', 'DECLINED'].includes(status)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Status must be PENDING, APPROVED, or DECLINED.' });
  }
  const adminResponse = req.body?.admin_response ? String(req.body.admin_response).trim() : null;

  const existing = await dbGet(
    `SELECT * FROM staff_requests WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
    `SELECT * FROM staff_requests WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
    [req.params.id, schoolId]
  );
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Staff request not found.' });
  }

  await execWrite(
    `UPDATE staff_requests SET status = $1, admin_response = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 AND school_id = $5`,
    `UPDATE staff_requests SET status = ?, admin_response = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND school_id = ?`,
    [status, adminResponse, req.user!.id, existing.id, schoolId]
  );

  notificationService.createNotification({
    schoolId,
    userId: existing.user_id,
    type: 'SYSTEM',
    title: `Staff Request ${status}: ${existing.subject}`,
    message: adminResponse || `School Administration marked your request "${existing.subject}" as ${status}.`,
    data: { requestId: existing.id, status },
  });

  const request = await dbGet(
    `SELECT * FROM staff_requests WHERE id = $1 LIMIT 1`,
    `SELECT * FROM staff_requests WHERE id = ? LIMIT 1`,
    [existing.id]
  );
  return res.json({ success: true, request, message: `Staff request marked as ${status}.` });
});

// ==============================================================================
// 5. PROSPECTIVE ADMISSIONS INQUIRY NOTICES (READ-ONLY FOR STAFF, WRITABLE BY ADMIN)
// ==============================================================================

staffWorkspaceRouter.get('/admissions-inquiries', ...staffOnlyGuard, async (req: AuthenticatedRequest, res) => {
  const schoolId = req.targetSchoolId!;
  const inquiries = await dbAll(
    `SELECT id, school_id, student_name, target_class, parent_name, parent_phone, parent_email, message, status, admin_notes, created_at
     FROM school_admission_inquiries
     WHERE school_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    `SELECT id, school_id, student_name, target_class, parent_name, parent_phone, parent_email, message, status, admin_notes, created_at
     FROM school_admission_inquiries
     WHERE school_id = ?
     ORDER BY created_at DESC LIMIT 50`,
    [schoolId]
  );
  return res.json({ success: true, inquiries });
});
