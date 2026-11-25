import express from 'express';
import { cacheDb, getPgPool, queryPg } from './db.ts';
import {
  requireAuth,
  requireTenant,
  requireRole,
  type AuthenticatedRequest,
} from './tenantMiddleware.ts';
import {
  ACADEMIC_READ_ROLES,
  ADMIN_ONLY_ROLES,
  dbAll,
  dbGet,
  getSchoolAcademicSettings,
  newId,
} from './accessControl.ts';
import { logAudit } from './audit.ts';
import { wrapRouterAsync, safeClientError } from './securityUtils.ts';
import { resolveInstitutionProfile } from '../src/utils/institutionMode.ts';
import { compileCareerTranscript, suggestNextClass } from './progressionService.ts';

export const progressionRouter = wrapRouterAsync(express.Router());

async function dualWrite(sqlPg: string, sqlSq: string, params: any[]) {
  const pool = getPgPool();
  if (pool) {
    await queryPg(sqlPg, params);
  }
  try {
    cacheDb.prepare(sqlSq).run(...params);
  } catch (e: any) {
    if (!pool) throw e;
  }
}

// ==============================================================================
// 1. SMART PROGRESSION DRY-RUN PREVIEW
// GET /api/v1/school/progression/preview?class_id=...&from_session_id=...
// Returns every active student in the class with their session performance,
// carryover count, unpaid prior arrears, suggested destination class/arm,
// and recommended progression decision (PROMOTE / RETAIN / PROBATION / GRADUATE).
// ==============================================================================
progressionRouter.get(
  '/progression/preview',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const classId = String(req.query.class_id || '').trim();
      const fromSessionId = String(req.query.from_session_id || '').trim();

      if (!classId) {
        return res.status(400).json({
          error: 'MISSING_CLASS_ID',
          message: 'Select a source class or level to preview progression.',
        });
      }

      const school = await dbGet(
        `SELECT id, name, type FROM schools WHERE id = $1`,
        `SELECT id, name, type FROM schools WHERE id = ?`,
        [schoolId]
      );
      const schoolSettings = await dbGet(
        `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json
         FROM school_settings WHERE school_id = $1 LIMIT 1`,
        `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json
         FROM school_settings WHERE school_id = ? LIMIT 1`,
        [schoolId]
      );
      const acadSettings = await getSchoolAcademicSettings(schoolId);
      const instProfile = resolveInstitutionProfile(school, schoolSettings);
      const passMark = Number(acadSettings.pass_mark ?? 40);

      const allClasses = await dbAll(
        `SELECT id, name, level, level_order as order_index FROM classes
         WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY level_order ASC, name ASC`,
        `SELECT id, name, level FROM classes
         WHERE school_id = ?
         ORDER BY name ASC`,
        [schoolId]
      );

      const sourceClass = allClasses.find((c) => c.id === classId);
      if (!sourceClass) {
        return res.status(404).json({
          error: 'CLASS_NOT_FOUND',
          message: 'Selected source class or level was not found in your institution.',
        });
      }

      const suggestion = suggestNextClass(sourceClass, allClasses, instProfile.isTertiary);

      const targetClassArms = suggestion.nextClass
        ? await dbAll(
            `SELECT id, name, class_id FROM class_arms WHERE school_id = $1 AND class_id = $2 ORDER BY name ASC`,
            `SELECT id, name, class_id FROM class_arms WHERE school_id = ? AND class_id = ? ORDER BY name ASC`,
            [schoolId, suggestion.nextClass.id]
          )
        : [];

      const students = await dbAll(
        `SELECT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
                s.class_id, s.class_name, s.class_arm_id, s.class_arm_name,
                s.academic_session_id, s.student_status
         FROM students s
         WHERE s.school_id = $1
           AND s.class_id = $2
           AND UPPER(COALESCE(s.student_status, 'ACTIVE')) = 'ACTIVE'
           AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         ORDER BY s.full_name ASC, s.admission_number ASC`,
        `SELECT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
                s.class_id, s.class_name, s.class_arm_id, s.class_arm_name,
                s.academic_session_id, s.student_status
         FROM students s
         WHERE s.school_id = ?
           AND s.class_id = ?
           AND UPPER(COALESCE(s.student_status, 'ACTIVE')) = 'ACTIVE'
           AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         ORDER BY s.full_name ASC, s.admission_number ASC`,
        [schoolId, classId]
      );

      const previewRows: any[] = [];
      for (const stu of students) {
        // Compute session average, GPA, and failed courses for fromSessionId (if provided)
        let sessionAverage: number | null = null;
        let sessionGpa: number | null = null;
        let gradedCourses = 0;
        let failedCoursesCount = 0;
        let savedPromotionStatus: string | null = null;

        if (fromSessionId) {
          const src = await dbGet(
            `SELECT average_score, promotion_status, snapshot_json FROM session_report_cards
             WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3 LIMIT 1`,
            `SELECT average_score, promotion_status, snapshot_json FROM session_report_cards
             WHERE school_id = ? AND student_id = ? AND academic_session_id = ? LIMIT 1`,
            [schoolId, stu.id, fromSessionId]
          );
          if (src) {
            savedPromotionStatus = src.promotion_status || null;
            if (src.average_score !== null && src.average_score !== undefined) {
              sessionAverage = Math.round(Number(src.average_score) * 100) / 100;
            }
            if (src.snapshot_json) {
              try {
                const snap = JSON.parse(src.snapshot_json);
                if (snap.cgpa !== null && snap.cgpa !== undefined) sessionGpa = Number(snap.cgpa);
              } catch {}
            }
          }

          const scores = await dbAll(
            `SELECT ss.total_score, ex.total_max_score, COALESCE(sub.credit_units, 3) as credit_units
             FROM student_scores ss
             JOIN examinations ex ON ss.examination_id = ex.id
             JOIN subjects sub ON ss.subject_id = sub.id
             WHERE ss.school_id = $1 AND ss.student_id = $2 AND ss.academic_session_id = $3
               AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)`,
            `SELECT ss.total_score, ex.total_max_score, COALESCE(sub.credit_units, 3) as credit_units
             FROM student_scores ss
             JOIN examinations ex ON ss.examination_id = ex.id
             JOIN subjects sub ON ss.subject_id = sub.id
             WHERE ss.school_id = ? AND ss.student_id = ? AND ss.academic_session_id = ?
               AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)`,
            [schoolId, stu.id, fromSessionId]
          );

          if (scores.length > 0) {
            gradedCourses = scores.length;
            let pctSum = 0;
            let unitsSum = 0;
            let qpSum = 0;
            for (const sc of scores) {
              const maxS = Number(sc.total_max_score) > 0 ? Number(sc.total_max_score) : 100;
              const pct = (Number(sc.total_score || 0) / maxS) * 100;
              pctSum += pct;
              if (pct < passMark) failedCoursesCount += 1;
              if (instProfile.gradingMode === 'GPA_5' || instProfile.gradingMode === 'GPA_4') {
                const units = Number(sc.credit_units) > 0 ? Number(sc.credit_units) : 3;
                unitsSum += units;
                const pts =
                  instProfile.gradingMode === 'GPA_5'
                    ? pct >= 70 ? 5 : pct >= 60 ? 4 : pct >= 50 ? 3 : pct >= 45 ? 2 : pct >= 40 ? 1 : 0
                    : pct >= 75 ? 4.0 : pct >= 70 ? 3.5 : pct >= 65 ? 3.25 : pct >= 60 ? 3.0 : pct >= 55 ? 2.75 : pct >= 50 ? 2.5 : pct >= 45 ? 2.25 : pct >= 40 ? 2.0 : 0;
                qpSum += units * pts;
              }
            }
            if (sessionAverage === null) {
              sessionAverage = Math.round((pctSum / scores.length) * 100) / 100;
            }
            if (sessionGpa === null && unitsSum > 0) {
              sessionGpa = Math.round((qpSum / unitsSum) * 100) / 100;
            }
          }
        }

        // Unpaid balance across ALL prior/existing invoices (so arrears stay visible on progression!)
        const invBal = await dbGet(
          `SELECT COALESCE(SUM(balance), 0) as balance, COUNT(*) as open_count
           FROM invoices
           WHERE school_id = $1 AND student_id = $2 AND balance > 0 AND status != 'CANCELLED'
             AND (is_deleted = 0 OR is_deleted IS NULL)`,
          `SELECT COALESCE(SUM(balance), 0) as balance, COUNT(*) as open_count
           FROM invoices
           WHERE school_id = ? AND student_id = ? AND balance > 0 AND status != 'CANCELLED'`,
          [schoolId, stu.id]
        );
        const outstandingBalanceKobo = Number(invBal?.balance || 0);

        // Determine smart recommended action
        let recommendedDecision: 'PROMOTE' | 'RETAIN' | 'PROBATION' | 'GRADUATE' = suggestion.suggestedAction;
        if (savedPromotionStatus === 'RETAINED') {
          recommendedDecision = 'RETAIN';
        } else if (savedPromotionStatus === 'PROBATION') {
          recommendedDecision = 'PROBATION';
        } else if (savedPromotionStatus === 'GRADUATED') {
          recommendedDecision = 'GRADUATE';
        } else if (gradedCourses > 0 && sessionAverage !== null && sessionAverage < passMark) {
          recommendedDecision = instProfile.isTertiary ? 'PROBATION' : 'RETAIN';
        } else if (instProfile.isTertiary && sessionGpa !== null && sessionGpa < 1.5 && gradedCourses > 0) {
          recommendedDecision = 'PROBATION';
        }

        // Auto-match equivalent arm/department name in target class (e.g. "Computer Science" -> "Computer Science", "A" -> "A")
        const matchedArm =
          stu.class_arm_name && targetClassArms.length > 0
            ? targetClassArms.find(
                (a) => String(a.name || '').trim().toLowerCase() === String(stu.class_arm_name || '').trim().toLowerCase()
              ) || null
            : null;

        previewRows.push({
          student_id: stu.id,
          admission_number: stu.admission_number,
          full_name: stu.full_name || `${stu.first_name || ''} ${stu.last_name || ''}`.trim(),
          gender: stu.gender,
          current_class_id: stu.class_id,
          current_class_name: stu.class_name || sourceClass.name,
          current_class_arm_id: stu.class_arm_id,
          current_class_arm_name: stu.class_arm_name,
          graded_courses: gradedCourses,
          session_average: sessionAverage,
          session_gpa: sessionGpa,
          failed_courses_count: failedCoursesCount,
          outstanding_balance_kobo: outstandingBalanceKobo,
          unpaid_invoices_count: Number(invBal?.open_count || 0),
          recommended_decision: recommendedDecision,
          suggested_target_arm_id: matchedArm?.id || null,
          suggested_target_arm_name: matchedArm?.name || null,
        });
      }

      return res.json({
        success: true,
        sourceClass,
        suggestion,
        targetClassArms,
        institutionProfile: {
          category: instProfile.category,
          isTertiary: instProfile.isTertiary,
          gradingMode: instProfile.gradingMode,
          gpaScaleMax: instProfile.gpaScaleMax,
          labels: instProfile.labels,
        },
        passMark,
        students: previewRows,
        totals: {
          total_students: previewRows.length,
          with_arrears_count: previewRows.filter((r) => r.outstanding_balance_kobo > 0).length,
          with_carryovers_count: previewRows.filter((r) => r.failed_courses_count > 0).length,
          recommended_promote: previewRows.filter((r) => r.recommended_decision === 'PROMOTE').length,
          recommended_graduate: previewRows.filter((r) => r.recommended_decision === 'GRADUATE').length,
          recommended_probation: previewRows.filter((r) => r.recommended_decision === 'PROBATION').length,
          recommended_retain: previewRows.filter((r) => r.recommended_decision === 'RETAIN').length,
        },
      });
    } catch (err: any) {
      console.error('[Progression Preview Error]', err);
      return res.status(500).json({
        error: 'PREVIEW_FAILED',
        message: safeClientError(err, 'Failed to load student progression preview.'),
      });
    }
  }
);

// ==============================================================================
// 2. EXECUTE BULK PROGRESSION / PROMOTION / GRADUATION
// POST /api/v1/school/progression/execute
// Atomically promotes, retains, places on probation, or graduates selected students,
// writes an immutable batch + per-student enrollment ledger, and NEVER touches
// historical scores, report cards, invoices, receipts, or attendance records.
// ==============================================================================
progressionRouter.post(
  '/progression/execute',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const actorId = req.user?.id || null;
      const {
        from_session_id,
        to_session_id,
        from_class_id,
        to_class_id,
        notes,
        decisions,
      } = req.body || {};

      if (!from_class_id || !Array.isArray(decisions) || decisions.length === 0) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Provide source class and at least one student progression decision.',
        });
      }

      const actionableDecisions = decisions.filter(
        (d: any) => d && d.student_id && String(d.action || '').toUpperCase() !== 'SKIP'
      );
      if (actionableDecisions.length === 0) {
        return res.status(400).json({
          error: 'NO_ACTIONABLE_STUDENTS',
          message: 'All selected students are marked Skip. Choose at least one student to promote, retain, or graduate.',
        });
      }

      const sourceClass = await dbGet(
        `SELECT id, name FROM classes WHERE id = $1 AND school_id = $2 LIMIT 1`,
        `SELECT id, name FROM classes WHERE id = ? AND school_id = ? LIMIT 1`,
        [from_class_id, schoolId]
      );
      if (!sourceClass) {
        return res.status(404).json({ error: 'SOURCE_CLASS_NOT_FOUND', message: 'Source class/level not found.' });
      }

      let targetClass: any = null;
      if (to_class_id) {
        targetClass = await dbGet(
          `SELECT id, name FROM classes WHERE id = $1 AND school_id = $2 LIMIT 1`,
          `SELECT id, name FROM classes WHERE id = ? AND school_id = ? LIMIT 1`,
          [to_class_id, schoolId]
        );
        if (!targetClass) {
          return res.status(404).json({ error: 'TARGET_CLASS_NOT_FOUND', message: 'Destination class/level not found.' });
        }
      }

      const needsTargetClass = actionableDecisions.some((d: any) => {
        const act = String(d.action || '').toUpperCase();
        return (act === 'PROMOTE' || act === 'PROBATION') && !d.target_class_id && !targetClass;
      });
      if (needsTargetClass) {
        return res.status(400).json({
          error: 'MISSING_TARGET_CLASS',
          message: 'Select a destination class or level for promoted students.',
        });
      }

      const toSession = to_session_id
        ? await dbGet(
            `SELECT id, name FROM academic_sessions WHERE id = $1 AND school_id = $2 LIMIT 1`,
            `SELECT id, name FROM academic_sessions WHERE id = ? AND school_id = ? LIMIT 1`,
            [to_session_id, schoolId]
          )
        : null;
      const fromSession = from_session_id
        ? await dbGet(
            `SELECT id, name FROM academic_sessions WHERE id = $1 AND school_id = $2 LIMIT 1`,
            `SELECT id, name FROM academic_sessions WHERE id = ? AND school_id = ? LIMIT 1`,
            [from_session_id, schoolId]
          )
        : null;

      // Load all classes & arms for fast lookup
      const allClasses = await dbAll(
        `SELECT id, name FROM classes WHERE school_id = $1`,
        `SELECT id, name FROM classes WHERE school_id = ?`,
        [schoolId]
      );
      const classMap = new Map(allClasses.map((c) => [c.id, c]));

      const allArms = await dbAll(
        `SELECT id, name, class_id FROM class_arms WHERE school_id = $1`,
        `SELECT id, name, class_id FROM class_arms WHERE school_id = ?`,
        [schoolId]
      );
      const armMap = new Map(allArms.map((a) => [a.id, a]));

      const batchId = newId('pbatch');
      const nowIso = new Date().toISOString();
      const todayDate = nowIso.slice(0, 10);

      let promotedCount = 0;
      let retainedCount = 0;
      let probationCount = 0;
      let graduatedCount = 0;
      const processedIds: string[] = [];

      // Create batch header row first so foreign keys on student_enrollment_history succeed cleanly
      await dualWrite(
        `INSERT INTO student_promotion_batches (
          id, school_id, from_session_id, to_session_id, from_class_id, from_class_name,
          to_class_id, to_class_name, action_type, total_students, status, notes, executed_by, executed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'APPLIED',$11,$12,CURRENT_TIMESTAMP)`,
        `INSERT INTO student_promotion_batches (
          id, school_id, from_session_id, to_session_id, from_class_id, from_class_name,
          to_class_id, to_class_name, action_type, total_students, status, notes, executed_by, executed_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,'APPLIED',?,?,CURRENT_TIMESTAMP)`,
        [
          batchId,
          schoolId,
          fromSession?.id || null,
          toSession?.id || null,
          sourceClass.id,
          sourceClass.name,
          targetClass?.id || null,
          targetClass?.name || null,
          'MIXED',
          0,
          notes ? String(notes).trim() : null,
          actorId,
        ]
      );

      for (const item of actionableDecisions) {
        const stu = await dbGet(
          `SELECT * FROM students WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
          `SELECT * FROM students WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
          [item.student_id, schoolId]
        );
        if (!stu) continue;

        const action = String(item.action || 'PROMOTE').toUpperCase();
        const prevClassId = stu.class_id || null;
        const prevClassName = stu.class_name || classMap.get(stu.class_id)?.name || sourceClass.name;
        const prevArmId = stu.class_arm_id || null;
        const prevArmName = stu.class_arm_name || null;
        const prevSessionId = fromSession?.id || stu.academic_session_id || null;
        const prevStatus = String(stu.student_status || 'ACTIVE').toUpperCase();

        let nextClassId: string | null = prevClassId;
        let nextClassName: string | null = prevClassName;
        let nextArmId: string | null = prevArmId;
        let nextArmName: string | null = prevArmName;
        let nextSessionId: string | null = toSession?.id || stu.academic_session_id || null;
        let nextStatus = 'ACTIVE';
        let outcome = 'PROMOTED';
        let gradDate: string | null = stu.graduation_date || null;
        let gradSessionId: string | null = stu.graduation_session_id || null;

        if (action === 'PROMOTE' || action === 'PROBATION') {
          const destCls = (item.target_class_id && classMap.get(item.target_class_id)) || targetClass;
          if (!destCls) continue;
          nextClassId = destCls.id;
          nextClassName = destCls.name;

          // Resolve target arm: explicit override -> auto-match by arm name -> null
          if (item.target_arm_id && armMap.has(item.target_arm_id)) {
            const explicitArm = armMap.get(item.target_arm_id)!;
            nextArmId = explicitArm.id;
            nextArmName = explicitArm.name;
          } else if (prevArmName) {
            const autoArm = allArms.find(
              (a) => a.class_id === destCls.id && String(a.name || '').trim().toLowerCase() === String(prevArmName).trim().toLowerCase()
            );
            nextArmId = autoArm?.id || null;
            nextArmName = autoArm?.name || null;
          } else {
            nextArmId = null;
            nextArmName = null;
          }

          outcome = action === 'PROBATION' ? 'PROBATION' : 'PROMOTED';
          if (action === 'PROBATION') probationCount += 1;
          else promotedCount += 1;
        } else if (action === 'RETAIN') {
          // Student stays in current class/level, rolls into new academic session
          outcome = 'RETAINED';
          retainedCount += 1;
        } else if (action === 'GRADUATE') {
          // Student graduates into Alumni registry, keeps final class_id for record, status -> GRADUATED
          outcome = 'GRADUATED';
          nextStatus = 'GRADUATED';
          nextSessionId = fromSession?.id || toSession?.id || stu.academic_session_id || null;
          gradDate = todayDate;
          gradSessionId = fromSession?.id || toSession?.id || stu.academic_session_id || null;
          graduatedCount += 1;
        } else {
          continue;
        }

        // Update student active record (ZERO historical tables mutated!)
        await dualWrite(
          `UPDATE students
           SET class_id = $1, class_name = $2, class_arm_id = $3, class_arm_name = $4,
               academic_session_id = $5, student_status = $6,
               graduation_date = $7, graduation_session_id = $8,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $9 AND school_id = $10`,
          `UPDATE students
           SET class_id = ?, class_name = ?, class_arm_id = ?, class_arm_name = ?,
               academic_session_id = ?, student_status = ?,
               graduation_date = ?, graduation_session_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND school_id = ?`,
          [
            nextClassId,
            nextClassName,
            nextArmId,
            nextArmName,
            nextSessionId,
            nextStatus,
            gradDate,
            gradSessionId,
            stu.id,
            schoolId,
          ]
        );

        // Sync promotion_status on session_report_cards if one exists for fromSessionId
        if (fromSession?.id) {
          try {
            await dualWrite(
              `UPDATE session_report_cards SET promotion_status = $1, updated_at = CURRENT_TIMESTAMP
               WHERE school_id = $2 AND student_id = $3 AND academic_session_id = $4`,
              `UPDATE session_report_cards SET promotion_status = ?, updated_at = CURRENT_TIMESTAMP
               WHERE school_id = ? AND student_id = ? AND academic_session_id = ?`,
              [outcome, schoolId, stu.id, fromSession.id]
            );
          } catch {}
        }

        // Append immutable progression history ledger row
        const histId = newId('enrh');
        await dualWrite(
          `INSERT INTO student_enrollment_history (
            id, school_id, student_id, batch_id,
            academic_session_id, session_name, class_id, class_name, class_arm_id, class_arm_name,
            previous_session_id, previous_class_id, previous_class_name, previous_class_arm_id, previous_class_arm_name,
            previous_status, new_status, outcome,
            session_average, session_gpa, outstanding_balance_kobo, remarks, recorded_by, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,CURRENT_TIMESTAMP)`,
          `INSERT INTO student_enrollment_history (
            id, school_id, student_id, batch_id,
            academic_session_id, session_name, class_id, class_name, class_arm_id, class_arm_name,
            previous_session_id, previous_class_id, previous_class_name, previous_class_arm_id, previous_class_arm_name,
            previous_status, new_status, outcome,
            session_average, session_gpa, outstanding_balance_kobo, remarks, recorded_by, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
          [
            histId,
            schoolId,
            stu.id,
            batchId,
            nextSessionId,
            toSession?.name || fromSession?.name || null,
            nextClassId,
            nextClassName,
            nextArmId,
            nextArmName,
            prevSessionId,
            prevClassId,
            prevClassName,
            prevArmId,
            prevArmName,
            prevStatus,
            nextStatus,
            outcome,
            item.session_average !== undefined && item.session_average !== null ? Number(item.session_average) : null,
            item.session_gpa !== undefined && item.session_gpa !== null ? Number(item.session_gpa) : null,
            Number(item.outstanding_balance_kobo || 0),
            item.remarks ? String(item.remarks).trim() : notes ? String(notes).trim() : null,
            actorId,
          ]
        );

        processedIds.push(stu.id);
      }

      const totalProcessed = processedIds.length;
      const resolvedActionType =
        graduatedCount === totalProcessed
          ? 'GRADUATE'
          : promotedCount === totalProcessed
          ? 'PROMOTE'
          : retainedCount === totalProcessed
          ? 'RETAIN'
          : 'MIXED';

      await dualWrite(
        `UPDATE student_promotion_batches
         SET action_type = $1, total_students = $2, promoted_count = $3,
             retained_count = $4, probation_count = $5, graduated_count = $6
         WHERE id = $7 AND school_id = $8`,
        `UPDATE student_promotion_batches
         SET action_type = ?, total_students = ?, promoted_count = ?,
             retained_count = ?, probation_count = ?, graduated_count = ?
         WHERE id = ? AND school_id = ?`,
        [
          resolvedActionType,
          totalProcessed,
          promotedCount,
          retainedCount,
          probationCount,
          graduatedCount,
          batchId,
          schoolId,
        ]
      );

      logAudit({
        actorId,
        actorEmail: req.user?.email,
        schoolId,
        action: 'EXECUTE_STUDENT_PROGRESSION_BATCH',
        entity: 'STUDENT_PROMOTION_BATCH',
        entityId: batchId,
        metadata: {
          fromClass: sourceClass.name,
          toClass: targetClass?.name || null,
          fromSession: fromSession?.name || null,
          toSession: toSession?.name || null,
          totalProcessed,
          promotedCount,
          retainedCount,
          probationCount,
          graduatedCount,
        },
      });

      return res.status(201).json({
        success: true,
        message: `Progression completed for ${totalProcessed} student${totalProcessed === 1 ? '' : 's'}. All historical scores, report cards, and fee records remain safely preserved.`,
        batch: {
          id: batchId,
          action_type: resolvedActionType,
          from_class_name: sourceClass.name,
          to_class_name: targetClass?.name || null,
          from_session_name: fromSession?.name || null,
          to_session_name: toSession?.name || null,
          total_students: totalProcessed,
          promoted_count: promotedCount,
          retained_count: retainedCount,
          probation_count: probationCount,
          graduated_count: graduatedCount,
          status: 'APPLIED',
        },
      });
    } catch (err: any) {
      console.error('[Progression Execute Error]', err);
      return res.status(500).json({
        error: 'PROGRESSION_FAILED',
        message: safeClientError(err, 'Failed to execute student progression.'),
      });
    }
  }
);

// ==============================================================================
// 3. SAFE ONE-CLICK UNDO / ROLLBACK OF A PROGRESSION BATCH
// POST /api/v1/school/progression/batches/:batchId/rollback
// Reverts every student in the batch back to their exact previous class, arm,
// session, and status without deleting or touching any academic or financial data.
// ==============================================================================
progressionRouter.post(
  '/progression/batches/:batchId/rollback',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const batchId = req.params.batchId;
      const actorId = req.user?.id || null;

      const batch = await dbGet(
        `SELECT * FROM student_promotion_batches WHERE id = $1 AND school_id = $2 LIMIT 1`,
        `SELECT * FROM student_promotion_batches WHERE id = ? AND school_id = ? LIMIT 1`,
        [batchId, schoolId]
      );
      if (!batch) {
        return res.status(404).json({ error: 'BATCH_NOT_FOUND', message: 'Progression batch not found.' });
      }
      if (batch.status === 'ROLLED_BACK') {
        return res.status(409).json({
          error: 'ALREADY_ROLLED_BACK',
          message: 'This progression batch has already been rolled back.',
        });
      }

      const historyRows = await dbAll(
        `SELECT * FROM student_enrollment_history WHERE school_id = $1 AND batch_id = $2`,
        `SELECT * FROM student_enrollment_history WHERE school_id = ? AND batch_id = ?`,
        [schoolId, batchId]
      );

      // Clean explicit per-driver restore loop so PG ($1..$8) and SQLite (?) bind identically without mismatch
      let restoredCount = 0;
      for (const h of historyRows) {
        const restoreStatus = h.previous_status || 'ACTIVE';
        const clearGrad = restoreStatus !== 'GRADUATED';
        const pool = getPgPool();
        if (pool) {
          await queryPg(
            `UPDATE students
             SET class_id = $1, class_name = $2, class_arm_id = $3, class_arm_name = $4,
                 academic_session_id = $5, student_status = $6,
                 graduation_date = ${clearGrad ? 'NULL' : 'graduation_date'},
                 graduation_session_id = ${clearGrad ? 'NULL' : 'graduation_session_id'},
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $7 AND school_id = $8`,
            [
              h.previous_class_id || null,
              h.previous_class_name || null,
              h.previous_class_arm_id || null,
              h.previous_class_arm_name || null,
              h.previous_session_id || null,
              restoreStatus,
              h.student_id,
              schoolId,
            ]
          );
        }
        try {
          cacheDb
            .prepare(
              `UPDATE students
               SET class_id = ?, class_name = ?, class_arm_id = ?, class_arm_name = ?,
                   academic_session_id = ?, student_status = ?,
                   graduation_date = ${clearGrad ? 'NULL' : 'graduation_date'},
                   graduation_session_id = ${clearGrad ? 'NULL' : 'graduation_session_id'},
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND school_id = ?`
            )
            .run(
              h.previous_class_id || null,
              h.previous_class_name || null,
              h.previous_class_arm_id || null,
              h.previous_class_arm_name || null,
              h.previous_session_id || null,
              restoreStatus,
              h.student_id,
              schoolId
            );
        } catch (e) {
          if (!pool) throw e;
        }

        // Mark history row as rolled back
        await dualWrite(
          `UPDATE student_enrollment_history SET outcome = 'ROLLED_BACK' WHERE id = $1 AND school_id = $2`,
          `UPDATE student_enrollment_history SET outcome = 'ROLLED_BACK' WHERE id = ? AND school_id = ?`,
          [h.id, schoolId]
        );
        restoredCount += 1;
      }

      await dualWrite(
        `UPDATE student_promotion_batches
         SET status = 'ROLLED_BACK', rolled_back_by = $1, rolled_back_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND school_id = $3`,
        `UPDATE student_promotion_batches
         SET status = 'ROLLED_BACK', rolled_back_by = ?, rolled_back_at = CURRENT_TIMESTAMP
         WHERE id = ? AND school_id = ?`,
        [actorId, batchId, schoolId]
      );

      logAudit({
        actorId,
        actorEmail: req.user?.email,
        schoolId,
        action: 'ROLLBACK_STUDENT_PROGRESSION_BATCH',
        entity: 'STUDENT_PROMOTION_BATCH',
        entityId: batchId,
        metadata: { restoredCount, fromClass: batch.from_class_name, toClass: batch.to_class_name },
      });

      return res.json({
        success: true,
        message: `Safely restored ${restoredCount} student${restoredCount === 1 ? '' : 's'} back to ${batch.from_class_name || 'their previous class'}. Zero historical scores or payment records were affected.`,
        restoredCount,
      });
    } catch (err: any) {
      console.error('[Progression Rollback Error]', err);
      return res.status(500).json({
        error: 'ROLLBACK_FAILED',
        message: safeClientError(err, 'Failed to roll back progression batch.'),
      });
    }
  }
);

// ==============================================================================
// 4. LIST PROGRESSION BATCHES & LEDGER
// GET /api/v1/school/progression/batches
// ==============================================================================
progressionRouter.get(
  '/progression/batches',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const batches = await dbAll(
      `SELECT b.*,
              fs.name as from_session_name,
              ts.name as to_session_name,
              u.full_name as executed_by_name,
              ru.full_name as rolled_back_by_name
       FROM student_promotion_batches b
       LEFT JOIN academic_sessions fs ON b.from_session_id = fs.id
       LEFT JOIN academic_sessions ts ON b.to_session_id = ts.id
       LEFT JOIN users u ON b.executed_by = u.id
       LEFT JOIN users ru ON b.rolled_back_by = ru.id
       WHERE b.school_id = $1
       ORDER BY b.executed_at DESC
       LIMIT 50`,
      `SELECT b.*,
              fs.name as from_session_name,
              ts.name as to_session_name,
              u.full_name as executed_by_name,
              ru.full_name as rolled_back_by_name
       FROM student_promotion_batches b
       LEFT JOIN academic_sessions fs ON b.from_session_id = fs.id
       LEFT JOIN academic_sessions ts ON b.to_session_id = ts.id
       LEFT JOIN users u ON b.executed_by = u.id
       LEFT JOIN users ru ON b.rolled_back_by = ru.id
       WHERE b.school_id = ?
       ORDER BY b.executed_at DESC
       LIMIT 50`,
      [schoolId]
    );
    return res.json({ success: true, batches });
  }
);

// ==============================================================================
// 5. ALUMNI / GRADUATED REGISTRY
// GET /api/v1/school/progression/alumni
// ==============================================================================
progressionRouter.get(
  '/progression/alumni',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const alumni = await dbAll(
      `SELECT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
              COALESCE(c.name, s.class_name) as final_class_name,
              s.class_arm_name, s.graduation_date, s.student_status,
              gs.name as graduation_session_name,
              ct.verification_code, ct.status as transcript_status,
              ct.lifetime_cgpa, ct.lifetime_average, ct.final_standing, ct.sessions_count
       FROM students s
       LEFT JOIN classes c ON s.class_id = c.id
       LEFT JOIN academic_sessions gs ON s.graduation_session_id = gs.id
       LEFT JOIN career_transcripts ct ON ct.student_id = s.id AND ct.school_id = s.school_id
       WHERE s.school_id = $1
         AND UPPER(COALESCE(s.student_status, 'ACTIVE')) = 'GRADUATED'
         AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
       ORDER BY s.graduation_date DESC, s.full_name ASC`,
      `SELECT s.id, s.admission_number, s.full_name, s.first_name, s.last_name, s.gender,
              COALESCE(c.name, s.class_name) as final_class_name,
              s.class_arm_name, s.graduation_date, s.student_status,
              gs.name as graduation_session_name,
              ct.verification_code, ct.status as transcript_status,
              ct.lifetime_cgpa, ct.lifetime_average, ct.final_standing, ct.sessions_count
       FROM students s
       LEFT JOIN classes c ON s.class_id = c.id
       LEFT JOIN academic_sessions gs ON s.graduation_session_id = gs.id
       LEFT JOIN career_transcripts ct ON ct.student_id = s.id AND ct.school_id = s.school_id
       WHERE s.school_id = ?
         AND UPPER(COALESCE(s.student_status, 'ACTIVE')) = 'GRADUATED'
         AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
       ORDER BY s.graduation_date DESC, s.full_name ASC`,
      [schoolId]
    );
    return res.json({ success: true, alumni });
  }
);

// ==============================================================================
// 6. SINGLE STUDENT PROGRESSION TIMELINE
// GET /api/v1/school/progression/students/:studentId/history
// ==============================================================================
progressionRouter.get(
  '/progression/students/:studentId/history',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const studentId = req.params.studentId;
    const history = await dbAll(
      `SELECT h.*, u.full_name as recorded_by_name
       FROM student_enrollment_history h
       LEFT JOIN users u ON h.recorded_by = u.id
       WHERE h.school_id = $1 AND h.student_id = $2
       ORDER BY h.created_at DESC`,
      `SELECT h.*, u.full_name as recorded_by_name
       FROM student_enrollment_history h
       LEFT JOIN users u ON h.recorded_by = u.id
       WHERE h.school_id = ? AND h.student_id = ?
       ORDER BY h.created_at DESC`,
      [schoolId, studentId]
    );
    return res.json({ success: true, history });
  }
);

// ==============================================================================
// 7. MULTI-YEAR CUMULATIVE CAREER TRANSCRIPTS
// GET  /api/v1/school/career-transcripts
// POST /api/v1/school/career-transcripts/compile
// POST /api/v1/school/career-transcripts/:studentId/publish
// ==============================================================================
progressionRouter.get(
  '/career-transcripts',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const transcripts = await dbAll(
      `SELECT ct.*, s.full_name as student_name, s.admission_number,
              COALESCE(c.name, s.class_name) as current_class_name, s.student_status
       FROM career_transcripts ct
       JOIN students s ON ct.student_id = s.id
       LEFT JOIN classes c ON s.class_id = c.id
       WHERE ct.school_id = $1 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
       ORDER BY ct.updated_at DESC`,
      `SELECT ct.*, s.full_name as student_name, s.admission_number,
              COALESCE(c.name, s.class_name) as current_class_name, s.student_status
       FROM career_transcripts ct
       JOIN students s ON ct.student_id = s.id
       LEFT JOIN classes c ON s.class_id = c.id
       WHERE ct.school_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
       ORDER BY ct.updated_at DESC`,
      [schoolId]
    );
    return res.json({ success: true, transcripts });
  }
);

progressionRouter.post(
  '/career-transcripts/compile',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { student_id } = req.body || {};
    if (!student_id) {
      return res.status(400).json({ error: 'MISSING_STUDENT_ID', message: 'student_id is required.' });
    }
    const transcript = await compileCareerTranscript(schoolId, String(student_id), {
      onlyPublished: false,
      visibilityRole: 'ADMIN',
    });
    if (!transcript) {
      return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student record not found.' });
    }
    return res.json({ success: true, transcript });
  }
);

progressionRouter.post(
  '/career-transcripts/:studentId/publish',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const studentId = req.params.studentId;
      const actorId = req.user?.id || null;
      const { registrar_remark, principal_remark } = req.body || {};

      const compiled = await compileCareerTranscript(schoolId, studentId, {
        onlyPublished: false,
        visibilityRole: 'ADMIN',
      });
      if (!compiled) {
        return res.status(404).json({ error: 'STUDENT_NOT_FOUND', message: 'Student record not found.' });
      }

      const finalRegistrarRemark =
        registrar_remark !== undefined ? String(registrar_remark).trim() : compiled.registrar_remark || '';
      const finalPrincipalRemark =
        principal_remark !== undefined ? String(principal_remark).trim() : compiled.principal_remark || '';

      const publishedAt = new Date().toISOString();
      const snapshotPayload = {
        ...compiled,
        status: 'PUBLISHED',
        is_official: true,
        published_at: publishedAt,
        registrar_remark: finalRegistrarRemark,
        principal_remark: finalPrincipalRemark,
      };
      const snapshotJson = JSON.stringify(snapshotPayload);

      const existing = await dbGet(
        `SELECT id, verification_code FROM career_transcripts WHERE school_id = $1 AND student_id = $2 LIMIT 1`,
        `SELECT id, verification_code FROM career_transcripts WHERE school_id = ? AND student_id = ? LIMIT 1`,
        [schoolId, studentId]
      );

      const recordId = existing?.id || newId('ctr');
      const verificationCode = existing?.verification_code || compiled.verification_code;
      snapshotPayload.id = recordId;
      snapshotPayload.verification_code = verificationCode;

      if (existing) {
        await dualWrite(
          `UPDATE career_transcripts
           SET status = 'PUBLISHED',
               institution_category = $1,
               grading_mode = $2,
               sessions_count = $3,
               terms_count = $4,
               total_subjects_courses = $5,
               total_credit_units = $6,
               total_grade_points = $7,
               lifetime_cgpa = $8,
               lifetime_average = $9,
               final_standing = $10,
               graduation_status = $11,
               graduation_session_name = $12,
               carryover_count = $13,
               snapshot_json = $14,
               registrar_remark = $15,
               principal_remark = $16,
               published_by = $17,
               published_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $18 AND school_id = $19`,
          `UPDATE career_transcripts
           SET status = 'PUBLISHED',
               institution_category = ?,
               grading_mode = ?,
               sessions_count = ?,
               terms_count = ?,
               total_subjects_courses = ?,
               total_credit_units = ?,
               total_grade_points = ?,
               lifetime_cgpa = ?,
               lifetime_average = ?,
               final_standing = ?,
               graduation_status = ?,
               graduation_session_name = ?,
               carryover_count = ?,
               snapshot_json = ?,
               registrar_remark = ?,
               principal_remark = ?,
               published_by = ?,
               published_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND school_id = ?`,
          [
            compiled.institution_profile.category,
            compiled.summary.grading_mode,
            compiled.summary.sessions_count,
            compiled.summary.terms_count,
            compiled.summary.total_subjects_courses,
            compiled.summary.total_credit_units_attempted ?? 0,
            compiled.summary.total_grade_points ?? 0,
            compiled.summary.lifetime_cgpa,
            compiled.summary.lifetime_average,
            compiled.summary.final_standing,
            compiled.summary.graduation_status,
            compiled.summary.graduation_session_name || null,
            compiled.summary.uncleared_carryovers_count,
            JSON.stringify(snapshotPayload),
            finalRegistrarRemark,
            finalPrincipalRemark,
            actorId,
            recordId,
            schoolId,
          ]
        );
      } else {
        await dualWrite(
          `INSERT INTO career_transcripts (
            id, school_id, student_id, verification_code, status,
            institution_category, grading_mode, sessions_count, terms_count,
            total_subjects_courses, total_credit_units, total_grade_points,
            lifetime_cgpa, lifetime_average, final_standing,
            graduation_status, graduation_session_name, carryover_count,
            snapshot_json, registrar_remark, principal_remark,
            published_by, published_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,'PUBLISHED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
          `INSERT INTO career_transcripts (
            id, school_id, student_id, verification_code, status,
            institution_category, grading_mode, sessions_count, terms_count,
            total_subjects_courses, total_credit_units, total_grade_points,
            lifetime_cgpa, lifetime_average, final_standing,
            graduation_status, graduation_session_name, carryover_count,
            snapshot_json, registrar_remark, principal_remark,
            published_by, published_at, created_at, updated_at
          ) VALUES (?,?,?,?,'PUBLISHED',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
          [
            recordId,
            schoolId,
            studentId,
            verificationCode,
            compiled.institution_profile.category,
            compiled.summary.grading_mode,
            compiled.summary.sessions_count,
            compiled.summary.terms_count,
            compiled.summary.total_subjects_courses,
            compiled.summary.total_credit_units_attempted ?? 0,
            compiled.summary.total_grade_points ?? 0,
            compiled.summary.lifetime_cgpa,
            compiled.summary.lifetime_average,
            compiled.summary.final_standing,
            compiled.summary.graduation_status,
            compiled.summary.graduation_session_name || null,
            compiled.summary.uncleared_carryovers_count,
            JSON.stringify(snapshotPayload),
            finalRegistrarRemark,
            finalPrincipalRemark,
            actorId,
          ]
        );
      }

      logAudit({
        actorId,
        actorEmail: req.user?.email,
        schoolId,
        action: 'PUBLISH_CAREER_TRANSCRIPT',
        entity: 'CAREER_TRANSCRIPT',
        entityId: recordId,
        metadata: {
          studentId,
          verificationCode,
          sessionsCount: compiled.summary.sessions_count,
          lifetimeCgpa: compiled.summary.lifetime_cgpa,
          lifetimeAverage: compiled.summary.lifetime_average,
          finalStanding: compiled.summary.final_standing,
        },
      });

      return res.json({
        success: true,
        message: `Official Multi-Year Career Transcript (${verificationCode}) published and verifiable.`,
        transcript: snapshotPayload,
      });
    } catch (err: any) {
      console.error('[Career Transcript Publish Error]', err);
      return res.status(500).json({
        error: 'PUBLISH_FAILED',
        message: safeClientError(err, 'Failed to publish official career transcript.'),
      });
    }
  }
);
