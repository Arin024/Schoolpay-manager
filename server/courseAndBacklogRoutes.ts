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
  computeGrade,
  dbAll,
  dbGet,
  getSchoolAcademicSettings,
  newId,
} from './accessControl.ts';
import { logAudit } from './audit.ts';
import { wrapRouterAsync, safeClientError } from './securityUtils.ts';
import {
  computeGpaGradeBand,
  resolveInstitutionProfile,
} from '../src/utils/institutionMode.ts';

export const courseAndBacklogRouter = wrapRouterAsync(express.Router());

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

function sanitizeCreditUnits(val: unknown, fallback = 3): number {
  if (val === undefined || val === null || String(val).trim() === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(12, Math.round(n)));
}

function sanitizeCourseType(val: unknown): 'CORE' | 'ELECTIVE' | 'GENERAL' {
  const up = String(val || 'CORE').trim().toUpperCase();
  if (up === 'ELECTIVE' || up === 'E') return 'ELECTIVE';
  if (up === 'GENERAL' || up === 'GST' || up === 'GNS' || up === 'G') return 'GENERAL';
  return 'CORE';
}

function generateDefaultCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0].slice(0, 3) + words[1].slice(0, 2)).toUpperCase();
  }
  return name.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'SUB';
}

// ==============================================================================
// 1. BULK COURSE / SUBJECT REGISTRATION (Curriculum Import & Multi-Row Add)
// POST /api/v1/school/subjects/bulk
// Supports adding up to 300 courses/subjects at once with exact credit units (0-12),
// course codes, departments, course_type (CORE/ELECTIVE/GENERAL), and target class/level.
// ==============================================================================
courseAndBacklogRouter.post(
  '/subjects/bulk',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const actorId = req.user?.id || null;
      const body = req.body || {};
      const courses = Array.isArray(body.courses) ? body.courses : Array.isArray(body.subjects) ? body.subjects : null;
      const update_existing = body.update_existing !== false;

      if (!Array.isArray(courses) || courses.length === 0) {
        return res.status(400).json({
          error: 'EMPTY_BATCH',
          message: 'Provide at least one course or subject row to register.',
        });
      }
      if (courses.length > 300) {
        return res.status(400).json({
          error: 'BATCH_TOO_LARGE',
          message: 'Maximum 300 courses/subjects can be uploaded per batch.',
        });
      }

      const schoolClasses = await dbAll(
        `SELECT id, name FROM classes WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
        `SELECT id, name FROM classes WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
        [schoolId]
      );
      const classById = new Map(schoolClasses.map((c) => [c.id, c]));
      const classByName = new Map(schoolClasses.map((c) => [String(c.name || '').trim().toLowerCase(), c]));

      const existingSubjects = await dbAll(
        `SELECT id, name, code, class_id, credit_units, department, course_type, semester_tag, status
         FROM subjects WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
        `SELECT id, name, code, class_id, credit_units, department, course_type, semester_tag, status
         FROM subjects WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
        [schoolId]
      );

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ row: number; message: string }> = [];
      const savedSubjects: any[] = [];

      for (let i = 0; i < courses.length; i++) {
        const raw = courses[i] || {};
        const cleanName = String(raw.name || raw.title || '').trim();
        if (!cleanName) {
          errors.push({ row: i + 1, message: 'Missing course/subject title.' });
          continue;
        }

        const cleanCode = String(raw.code || '').trim().toUpperCase() || generateDefaultCode(cleanName);
        const cleanUnits = sanitizeCreditUnits(raw.credit_units, 3);
        const cleanDept = raw.department !== undefined && String(raw.department || '').trim() !== ''
          ? String(raw.department).trim()
          : null;
        const cleanType = sanitizeCourseType(raw.course_type);
        const cleanSemTag = raw.semester_tag ? String(raw.semester_tag).trim() : null;
        const validStatus = String(raw.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

        // Resolve optional class/level by ID or Name
        let resolvedClassId: string | null = null;
        if (raw.class_id && classById.has(String(raw.class_id))) {
          resolvedClassId = String(raw.class_id);
        } else if (raw.class_name && String(raw.class_name).trim()) {
          const match = classByName.get(String(raw.class_name).trim().toLowerCase());
          if (match) resolvedClassId = match.id;
        }

        // Match existing subject within same tenant + same class scope by code or exact name
        const existing = existingSubjects.find((s) => {
          const sameScope = (s.class_id || null) === resolvedClassId;
          if (!sameScope) return false;
          const sameCode = cleanCode && String(s.code || '').trim().toUpperCase() === cleanCode;
          const sameName = String(s.name || '').trim().toLowerCase() === cleanName.toLowerCase();
          return sameCode || sameName;
        });

        if (existing) {
          if (!update_existing) {
            skippedCount += 1;
            continue;
          }
          await dualWrite(
            `UPDATE subjects
             SET name = $1, code = $2, department = $3, class_id = $4, credit_units = $5,
                 course_type = $6, semester_tag = $7, status = $8, updated_at = CURRENT_TIMESTAMP
             WHERE id = $9 AND school_id = $10`,
            `UPDATE subjects
             SET name = ?, code = ?, department = ?, class_id = ?, credit_units = ?,
                 course_type = ?, semester_tag = ?, status = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND school_id = ?`,
            [
              cleanName,
              cleanCode,
              cleanDept ?? existing.department ?? null,
              resolvedClassId,
              cleanUnits,
              cleanType,
              cleanSemTag ?? existing.semester_tag ?? null,
              validStatus,
              existing.id,
              schoolId,
            ]
          );
          existing.name = cleanName;
          existing.code = cleanCode;
          existing.credit_units = cleanUnits;
          updatedCount += 1;
          savedSubjects.push({ ...existing, credit_units: cleanUnits, course_type: cleanType });
        } else {
          const id = newId('sub');
          await dualWrite(
            `INSERT INTO subjects (
              id, school_id, name, code, department, class_id, credit_units, course_type, semester_tag, status, is_deleted, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            `INSERT INTO subjects (
              id, school_id, name, code, department, class_id, credit_units, course_type, semester_tag, status, is_deleted, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            [
              id,
              schoolId,
              cleanName,
              cleanCode,
              cleanDept,
              resolvedClassId,
              cleanUnits,
              cleanType,
              cleanSemTag,
              validStatus,
            ]
          );
          const created = {
            id,
            school_id: schoolId,
            name: cleanName,
            code: cleanCode,
            department: cleanDept,
            class_id: resolvedClassId,
            credit_units: cleanUnits,
            course_type: cleanType,
            semester_tag: cleanSemTag,
            status: validStatus,
          };
          existingSubjects.push(created);
          savedSubjects.push(created);
          createdCount += 1;
        }
      }

      logAudit({
        actorId,
        actorEmail: req.user?.email,
        schoolId,
        action: 'BULK_UPSERT_SUBJECTS',
        entity: 'SUBJECT',
        metadata: { createdCount, updatedCount, skippedCount, errorCount: errors.length },
      });

      return res.status(201).json({
        success: true,
        message: `Processed ${createdCount + updatedCount} course(s)/subject(s) (${createdCount} created, ${updatedCount} updated${skippedCount ? `, ${skippedCount} skipped` : ''}).`,
        createdCount,
        updatedCount,
        skippedCount,
        errors,
        subjects: savedSubjects,
      });
    } catch (err: any) {
      console.error('[Bulk Subjects Error]', err);
      return res.status(500).json({
        error: 'BULK_SUBJECTS_FAILED',
        message: safeClientError(err, 'Failed to bulk register courses/subjects.'),
      });
    }
  }
);

// ==============================================================================
// 2. FAST INLINE CREDIT UNIT MODIFICATION
// PATCH /api/v1/school/subjects/:id/credit-units
// Lets admins change any course/subject credit unit (0..12, e.g. 1, 2, 3, 4, 6) in 1 click.
// ==============================================================================
courseAndBacklogRouter.patch(
  '/subjects/:id/credit-units',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const subjectId = req.params.id;
      const rawUnits = req.body?.credit_units;

      if (rawUnits === undefined || rawUnits === null || String(rawUnits).trim() === '') {
        return res.status(400).json({ error: 'MISSING_UNITS', message: 'credit_units is required (0 to 12).' });
      }
      const n = Number(rawUnits);
      if (!Number.isFinite(n) || n < 0 || n > 12) {
        return res.status(400).json({ error: 'INVALID_UNITS', message: 'Credit units must be an integer between 0 and 12.' });
      }
      const cleanUnits = Math.round(n);

      const existing = await dbGet(
        `SELECT id, name, code, credit_units FROM subjects WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
        `SELECT id, name, code, credit_units FROM subjects WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
        [subjectId, schoolId]
      );
      if (!existing) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Course/Subject not found.' });
      }

      await dualWrite(
        `UPDATE subjects SET credit_units = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3`,
        `UPDATE subjects SET credit_units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
        [cleanUnits, subjectId, schoolId]
      );

      // Sync active non-dropped course registration snapshots if requested (default true)
      if (req.body?.sync_registrations !== false) {
        try {
          await dualWrite(
            `UPDATE student_course_registrations
             SET credit_units_snapshot = $1, updated_at = CURRENT_TIMESTAMP
             WHERE school_id = $2 AND subject_id = $3 AND status != 'DROPPED'`,
            `UPDATE student_course_registrations
             SET credit_units_snapshot = ?, updated_at = CURRENT_TIMESTAMP
             WHERE school_id = ? AND subject_id = ? AND status != 'DROPPED'`,
            [cleanUnits, schoolId, subjectId]
          );
        } catch {}
      }

      logAudit({
        actorId: req.user?.id || null,
        actorEmail: req.user?.email,
        schoolId,
        action: 'UPDATE_COURSE_CREDIT_UNITS',
        entity: 'SUBJECT',
        entityId: subjectId,
        metadata: { code: existing.code, name: existing.name, oldUnits: existing.credit_units, newUnits: cleanUnits },
      });

      const updated = await dbGet(
        `SELECT sub.*, c.name as class_name FROM subjects sub LEFT JOIN classes c ON sub.class_id = c.id WHERE sub.id = $1`,
        `SELECT sub.*, c.name as class_name FROM subjects sub LEFT JOIN classes c ON sub.class_id = c.id WHERE sub.id = ?`,
        [subjectId]
      );
      return res.json({ success: true, subject: updated });
    } catch (err: any) {
      console.error('[Credit Units Patch Error]', err);
      return res.status(500).json({
        error: 'UPDATE_UNITS_FAILED',
        message: safeClientError(err, 'Failed to update credit units.'),
      });
    }
  }
);

// ==============================================================================
// 3. STUDENT COURSE / SUBJECT REGISTRATIONS (Bulk & Individual, Current or Historical)
// GET    /api/v1/school/course-registrations
// POST   /api/v1/school/course-registrations/bulk
// DELETE /api/v1/school/course-registrations/:id
// ==============================================================================
courseAndBacklogRouter.get(
  '/course-registrations',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const { academic_session_id, term_id, class_id, student_id, subject_id } = req.query as Record<string, string>;

    const params: any[] = [schoolId];
    let pgSql = `
      SELECT r.*,
             s.full_name as student_name, s.admission_number,
             COALESCE(c.name, s.class_name) as class_name,
             sub.name as subject_name, sub.code as subject_code,
             COALESCE(r.credit_units_snapshot, sub.credit_units, 3) as credit_units,
             sub.course_type,
             ses.name as session_name,
             t.name as term_name
      FROM student_course_registrations r
      JOIN students s ON r.student_id = s.id
      JOIN subjects sub ON r.subject_id = sub.id
      LEFT JOIN classes c ON COALESCE(r.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON r.academic_session_id = ses.id
      LEFT JOIN terms t ON r.term_id = t.id
      WHERE r.school_id = $1 AND r.status != 'DROPPED' AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
    `;
    let sqSql = `
      SELECT r.*,
             s.full_name as student_name, s.admission_number,
             COALESCE(c.name, s.class_name) as class_name,
             sub.name as subject_name, sub.code as subject_code,
             COALESCE(r.credit_units_snapshot, sub.credit_units, 3) as credit_units,
             sub.course_type,
             ses.name as session_name,
             t.name as term_name
      FROM student_course_registrations r
      JOIN students s ON r.student_id = s.id
      JOIN subjects sub ON r.subject_id = sub.id
      LEFT JOIN classes c ON COALESCE(r.class_id, s.class_id) = c.id
      LEFT JOIN academic_sessions ses ON r.academic_session_id = ses.id
      LEFT JOIN terms t ON r.term_id = t.id
      WHERE r.school_id = ? AND r.status != 'DROPPED' AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
    `;

    let pIdx = 2;
    if (academic_session_id) {
      pgSql += ` AND r.academic_session_id = $${pIdx++}`;
      sqSql += ` AND r.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      pgSql += ` AND r.term_id = $${pIdx++}`;
      sqSql += ` AND r.term_id = ?`;
      params.push(term_id);
    }
    if (class_id) {
      pgSql += ` AND COALESCE(r.class_id, s.class_id) = $${pIdx++}`;
      sqSql += ` AND COALESCE(r.class_id, s.class_id) = ?`;
      params.push(class_id);
    }
    if (student_id) {
      pgSql += ` AND r.student_id = $${pIdx++}`;
      sqSql += ` AND r.student_id = ?`;
      params.push(student_id);
    }
    if (subject_id) {
      pgSql += ` AND r.subject_id = $${pIdx++}`;
      sqSql += ` AND r.subject_id = ?`;
      params.push(subject_id);
    }

    pgSql += ` ORDER BY s.full_name ASC, sub.code ASC`;
    sqSql += ` ORDER BY s.full_name ASC, sub.code ASC`;

    const registrations = await dbAll(pgSql, sqSql, params);

    const acadSettings: any = await getSchoolAcademicSettings(schoolId);
    const maxUnits = Number(acadSettings.max_credit_units_per_cycle ?? 24);
    const minUnits = Number(acadSettings.min_credit_units_per_cycle ?? 12);

    // Aggregate per-student load summary
    const byStudent = new Map<string, {
      student_id: string;
      student_name: string;
      admission_number: string | null;
      class_name: string | null;
      courses_count: number;
      total_credit_units: number;
      exceeds_max_units: boolean;
      courses: any[];
    }>();

    for (const r of registrations) {
      if (!byStudent.has(r.student_id)) {
        byStudent.set(r.student_id, {
          student_id: r.student_id,
          student_name: r.student_name,
          admission_number: r.admission_number,
          class_name: r.class_name,
          courses_count: 0,
          total_credit_units: 0,
          exceeds_max_units: false,
          courses: [],
        });
      }
      const entry = byStudent.get(r.student_id)!;
      const units = Number(r.credit_units ?? 3);
      entry.courses_count += 1;
      entry.total_credit_units += units;
      entry.exceeds_max_units = entry.total_credit_units > maxUnits;
      entry.courses.push(r);
    }

    return res.json({
      success: true,
      count: registrations.length,
      registrations,
      studentSummaries: Array.from(byStudent.values()),
      policy: { min_credit_units_per_cycle: minUnits, max_credit_units_per_cycle: maxUnits },
    });
  }
);

courseAndBacklogRouter.post(
  '/course-registrations/bulk',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const actorId = req.user?.id || null;
      const {
        academic_session_id,
        term_id,
        class_id,
        student_ids,
        subject_ids,
        registration_type = 'REGULAR',
      } = req.body || {};

      if (!academic_session_id || !term_id) {
        return res.status(400).json({
          error: 'MISSING_CYCLE',
          message: 'Select both Academic Session and Term / Semester for course registration.',
        });
      }
      if (!Array.isArray(subject_ids) || subject_ids.length === 0) {
        return res.status(400).json({
          error: 'MISSING_SUBJECTS',
          message: 'Select at least one course or subject to register.',
        });
      }

      // Verify session & term belong to tenant
      const ses = await dbGet(
        `SELECT id, name FROM academic_sessions WHERE id = $1 AND school_id = $2 LIMIT 1`,
        `SELECT id, name FROM academic_sessions WHERE id = ? AND school_id = ? LIMIT 1`,
        [academic_session_id, schoolId]
      );
      const term = await dbGet(
        `SELECT id, name FROM terms WHERE id = $1 AND school_id = $2 LIMIT 1`,
        `SELECT id, name FROM terms WHERE id = ? AND school_id = ? LIMIT 1`,
        [term_id, schoolId]
      );
      if (!ses || !term) {
        return res.status(404).json({ error: 'CYCLE_NOT_FOUND', message: 'Academic session or term/semester not found.' });
      }

      // Resolve target students: explicit student_ids[] OR all active students in class_id
      let targetStudents: any[] = [];
      if (Array.isArray(student_ids) && student_ids.length > 0) {
        const cleanIds = Array.from(new Set(student_ids.map((id: any) => String(id).trim()).filter(Boolean)));
        for (const sid of cleanIds) {
          const st = await dbGet(
            `SELECT id, full_name, class_id FROM students WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
            `SELECT id, full_name, class_id FROM students WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
            [sid, schoolId]
          );
          if (st) targetStudents.push(st);
        }
      } else if (class_id) {
        targetStudents = await dbAll(
          `SELECT id, full_name, class_id FROM students
           WHERE school_id = $1 AND class_id = $2
             AND UPPER(COALESCE(student_status, 'ACTIVE')) = 'ACTIVE'
             AND (is_deleted = 0 OR is_deleted IS NULL)`,
          `SELECT id, full_name, class_id FROM students
           WHERE school_id = ? AND class_id = ?
             AND UPPER(COALESCE(student_status, 'ACTIVE')) = 'ACTIVE'
             AND (is_deleted = 0 OR is_deleted IS NULL)`,
          [schoolId, class_id]
        );
      }

      if (targetStudents.length === 0) {
        return res.status(400).json({
          error: 'NO_TARGET_STUDENTS',
          message: 'No matching students selected for course registration.',
        });
      }

      // Validate subjects belong to tenant
      const validSubjects: Array<{ id: string; credit_units: number; registration_type: string }> = [];
      const cleanRegType = ['REGULAR', 'CARRYOVER', 'ELECTIVE', 'HISTORICAL'].includes(String(registration_type).toUpperCase())
        ? String(registration_type).toUpperCase()
        : 'REGULAR';

      for (const item of subject_ids) {
        const subId = typeof item === 'string' ? item : item?.subject_id || item?.id;
        if (!subId) continue;
        const sub = await dbGet(
          `SELECT id, credit_units FROM subjects WHERE id = $1 AND school_id = $2 AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
          `SELECT id, credit_units FROM subjects WHERE id = ? AND school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
          [subId, schoolId]
        );
        if (!sub) continue;
        const customUnits = typeof item === 'object' && item?.credit_units !== undefined
          ? sanitizeCreditUnits(item.credit_units, Number(sub.credit_units ?? 3))
          : Number(sub.credit_units ?? 3);
        const itemType = typeof item === 'object' && item?.registration_type
          ? String(item.registration_type).toUpperCase()
          : cleanRegType;
        validSubjects.push({ id: sub.id, credit_units: customUnits, registration_type: itemType });
      }

      if (validSubjects.length === 0) {
        return res.status(400).json({ error: 'NO_VALID_SUBJECTS', message: 'None of the selected courses were found.' });
      }

      let registeredCount = 0;
      for (const stu of targetStudents) {
        const regClassId = class_id || stu.class_id || null;
        for (const sub of validSubjects) {
          const id = newId('creg');
          await dualWrite(
            `INSERT INTO student_course_registrations (
               id, school_id, student_id, academic_session_id, term_id, class_id, subject_id,
               credit_units_snapshot, registration_type, status, registered_by, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'REGISTERED',$10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
             ON CONFLICT (school_id, student_id, academic_session_id, term_id, subject_id) DO UPDATE SET
               class_id = COALESCE(EXCLUDED.class_id, student_course_registrations.class_id),
               credit_units_snapshot = EXCLUDED.credit_units_snapshot,
               registration_type = EXCLUDED.registration_type,
               status = 'REGISTERED',
               updated_at = CURRENT_TIMESTAMP`,
            `INSERT INTO student_course_registrations (
               id, school_id, student_id, academic_session_id, term_id, class_id, subject_id,
               credit_units_snapshot, registration_type, status, registered_by, created_at, updated_at
             ) VALUES (?,?,?,?,?,?,?,?,?,'REGISTERED',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
             ON CONFLICT(school_id, student_id, academic_session_id, term_id, subject_id) DO UPDATE SET
               class_id = COALESCE(excluded.class_id, student_course_registrations.class_id),
               credit_units_snapshot = excluded.credit_units_snapshot,
               registration_type = excluded.registration_type,
               status = 'REGISTERED',
               updated_at = CURRENT_TIMESTAMP`,
            [
              id,
              schoolId,
              stu.id,
              academic_session_id,
              term_id,
              regClassId,
              sub.id,
              sub.credit_units,
              sub.registration_type,
              actorId,
            ]
          );
          registeredCount += 1;
        }
      }

      logAudit({
        actorId,
        actorEmail: req.user?.email,
        schoolId,
        action: 'BULK_REGISTER_STUDENT_COURSES',
        entity: 'COURSE_REGISTRATION',
        metadata: {
          session: ses.name,
          term: term.name,
          studentsCount: targetStudents.length,
          coursesCount: validSubjects.length,
          registeredCount,
          registrationType: cleanRegType,
        },
      });

      return res.status(201).json({
        success: true,
        message: `Registered ${validSubjects.length} course(s)/subject(s) for ${targetStudents.length} learner(s) in ${ses.name} (${term.name}).`,
        registeredCount,
        studentsAffected: targetStudents.length,
        coursesPerStudent: validSubjects.length,
      });
    } catch (err: any) {
      console.error('[Bulk Course Registration Error]', err);
      return res.status(500).json({
        error: 'COURSE_REG_FAILED',
        message: safeClientError(err, 'Failed to bulk register student courses.'),
      });
    }
  }
);

courseAndBacklogRouter.delete(
  '/course-registrations/:id',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.targetSchoolId!;
    const regId = req.params.id;
    const existing = await dbGet(
      `SELECT id FROM student_course_registrations WHERE id = $1 AND school_id = $2 LIMIT 1`,
      `SELECT id FROM student_course_registrations WHERE id = ? AND school_id = ? LIMIT 1`,
      [regId, schoolId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Course registration entry not found.' });
    }
    await dualWrite(
      `UPDATE student_course_registrations SET status = 'DROPPED', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2`,
      `UPDATE student_course_registrations SET status = 'DROPPED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`,
      [regId, schoolId]
    );
    return res.json({ success: true, message: 'Course registration dropped.' });
  }
);

// ==============================================================================
// 4. HISTORICAL / PREVIOUS-YEAR BACKLOG ONBOARDING WIZARD
// POST /api/v1/school/historical-backlog/preview
// POST /api/v1/school/historical-backlog/import
// Enables newly onboarded schools & universities to upload previous years,
// semesters/terms, classes/levels, courses/subjects (with exact credit units),
// and historical scores WITHOUT moving learners out of their current class/level!
// ==============================================================================
interface BacklogRowInput {
  admission_number?: string;
  student_id?: string;
  session_name?: string;
  term_name?: string;
  class_name?: string;
  subject_code?: string;
  subject_name?: string;
  credit_units?: number | string;
  ca_score?: number | string | null;
  exam_score?: number | string | null;
  total_score?: number | string | null;
}

async function analyzeBacklogRows(schoolId: string, rows: BacklogRowInput[]) {
  const students = await dbAll(
    `SELECT id, admission_number, full_name, class_id, class_name FROM students
     WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT id, admission_number, full_name, class_id, class_name FROM students
     WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [schoolId]
  );
  const stuById = new Map(students.map((s) => [s.id, s]));
  const stuByAdm = new Map(
    students
      .filter((s) => s.admission_number)
      .map((s) => [String(s.admission_number).trim().toLowerCase(), s])
  );

  const sessions = await dbAll(
    `SELECT id, name FROM academic_sessions WHERE school_id = $1`,
    `SELECT id, name FROM academic_sessions WHERE school_id = ?`,
    [schoolId]
  );
  const sesByName = new Map(sessions.map((s) => [String(s.name || '').trim().toLowerCase(), s]));

  const terms = await dbAll(
    `SELECT id, name, academic_session_id FROM terms WHERE school_id = $1`,
    `SELECT id, name, academic_session_id FROM terms WHERE school_id = ?`,
    [schoolId]
  );

  const classes = await dbAll(
    `SELECT id, name FROM classes WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT id, name FROM classes WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [schoolId]
  );
  const clsByName = new Map(classes.map((c) => [String(c.name || '').trim().toLowerCase(), c]));

  const subjects = await dbAll(
    `SELECT id, name, code, class_id, credit_units FROM subjects WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    `SELECT id, name, code, class_id, credit_units FROM subjects WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [schoolId]
  );

  const newSessions = new Set<string>();
  const newClasses = new Set<string>();
  const newSubjects = new Set<string>();
  const validRows: any[] = [];
  const invalidRows: Array<{ row: number; reason: string; raw: BacklogRowInput }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const stu =
      (r.student_id && stuById.get(String(r.student_id).trim())) ||
      (r.admission_number && stuByAdm.get(String(r.admission_number).trim().toLowerCase())) ||
      null;

    if (!stu) {
      invalidRows.push({
        row: i + 1,
        reason: `Learner "${r.admission_number || r.student_id || '(blank)'}" not found in your school directory.`,
        raw: r,
      });
      continue;
    }

    const sessionName = String(r.session_name || '').trim();
    const termName = String(r.term_name || '').trim();
    const className = String(r.class_name || stu.class_name || '').trim();
    const subjectName = String(r.subject_name || '').trim();
    const subjectCode = String(r.subject_code || '').trim().toUpperCase() || (subjectName ? generateDefaultCode(subjectName) : '');

    if (!sessionName || !termName || !className || (!subjectName && !subjectCode)) {
      invalidRows.push({
        row: i + 1,
        reason: 'Each row requires Session, Term/Semester, Historical Class/Level, and Course/Subject Name or Code.',
        raw: r,
      });
      continue;
    }

    const units = sanitizeCreditUnits(r.credit_units, 3);
    const hasCa = r.ca_score !== undefined && r.ca_score !== null && String(r.ca_score).trim() !== '';
    const hasExam = r.exam_score !== undefined && r.exam_score !== null && String(r.exam_score).trim() !== '';
    const hasTotal = r.total_score !== undefined && r.total_score !== null && String(r.total_score).trim() !== '';

    let caScore: number | null = hasCa ? Number(r.ca_score) : null;
    let examScore: number | null = hasExam ? Number(r.exam_score) : null;
    let totalScore: number | null = hasTotal ? Number(r.total_score) : null;

    if (hasCa || hasExam || hasTotal) {
      if (totalScore === null) {
        totalScore = Number(caScore || 0) + Number(examScore || 0);
      } else if (caScore === null && examScore === null) {
        caScore = 0;
        examScore = totalScore;
      }
      if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > 100) {
        invalidRows.push({
          row: i + 1,
          reason: `Score (${totalScore}) must be between 0 and 100.`,
          raw: r,
        });
        continue;
      }
    }

    if (!sesByName.has(sessionName.toLowerCase())) newSessions.add(sessionName);
    if (!clsByName.has(className.toLowerCase())) newClasses.add(className);

    const matchedCls = clsByName.get(className.toLowerCase()) || null;
    const matchedSub = subjects.find(
      (s) =>
        ((subjectCode && String(s.code || '').trim().toUpperCase() === subjectCode) ||
          (subjectName && String(s.name || '').trim().toLowerCase() === subjectName.toLowerCase())) &&
        (!matchedCls || !s.class_id || s.class_id === matchedCls.id)
    );
    if (!matchedSub) newSubjects.add(`${subjectCode || generateDefaultCode(subjectName)} — ${subjectName || subjectCode} (${units}u)`);

    validRows.push({
      row: i + 1,
      student_id: stu.id,
      student_name: stu.full_name,
      admission_number: stu.admission_number,
      session_name: sessionName,
      term_name: termName,
      class_name: className,
      subject_code: subjectCode,
      subject_name: subjectName || matchedSub?.name || subjectCode,
      credit_units: units,
      ca_score: caScore,
      exam_score: examScore,
      total_score: totalScore,
      has_score: totalScore !== null,
    });
  }

  return {
    validRows,
    invalidRows,
    willAutoCreate: {
      sessions: Array.from(newSessions),
      classes: Array.from(newClasses),
      subjects: Array.from(newSubjects),
    },
    existingMaps: { sesByName, terms, clsByName, subjects },
  };
}

courseAndBacklogRouter.post(
  '/historical-backlog/preview',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rows.length === 0) {
        return res.status(400).json({ error: 'EMPTY_ROWS', message: 'Provide at least one historical record row to preview.' });
      }
      if (rows.length > 1000) {
        return res.status(400).json({ error: 'BATCH_TOO_LARGE', message: 'Maximum 1,000 rows per historical import batch.' });
      }

      const analysis = await analyzeBacklogRows(schoolId, rows);
      return res.json({
        success: true,
        summary: {
          total_rows: rows.length,
          valid_rows: analysis.validRows.length,
          invalid_rows: analysis.invalidRows.length,
          rows_with_scores: analysis.validRows.filter((r) => r.has_score).length,
          rows_registration_only: analysis.validRows.filter((r) => !r.has_score).length,
          unique_students: new Set(analysis.validRows.map((r) => r.student_id)).size,
          will_auto_create: analysis.willAutoCreate,
        },
        validRows: analysis.validRows.slice(0, 100),
        invalidRows: analysis.invalidRows.slice(0, 50),
      });
    } catch (err: any) {
      console.error('[Historical Backlog Preview Error]', err);
      return res.status(500).json({
        error: 'BACKLOG_PREVIEW_FAILED',
        message: safeClientError(err, 'Failed to validate historical backlog rows.'),
      });
    }
  }
);

courseAndBacklogRouter.post(
  '/historical-backlog/import',
  requireAuth,
  requireTenant,
  requireRole(ADMIN_ONLY_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const actorId = req.user?.id || null;
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const publishScores = req.body?.publish_scores !== false;

      if (rows.length === 0) {
        return res.status(400).json({ error: 'EMPTY_ROWS', message: 'Provide at least one historical record row to import.' });
      }
      if (rows.length > 1000) {
        return res.status(400).json({ error: 'BATCH_TOO_LARGE', message: 'Maximum 1,000 rows per historical import batch.' });
      }

      const analysis = await analyzeBacklogRows(schoolId, rows);
      if (analysis.validRows.length === 0) {
        return res.status(400).json({
          error: 'NO_VALID_ROWS',
          message: analysis.invalidRows[0]?.reason || 'No valid rows found to import.',
          invalidRows: analysis.invalidRows.slice(0, 20),
        });
      }

      const school = await dbGet(
        `SELECT id, name, type FROM schools WHERE id = $1`,
        `SELECT id, name, type FROM schools WHERE id = ?`,
        [schoolId]
      );
      const tenantSettings = await dbGet(
        `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json
         FROM school_settings WHERE school_id = $1 LIMIT 1`,
        `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json
         FROM school_settings WHERE school_id = ? LIMIT 1`,
        [schoolId]
      );
      const acadSettings = await getSchoolAcademicSettings(schoolId);
      const instProfile = resolveInstitutionProfile(school, tenantSettings);
      const isGpaMode = instProfile.gradingMode === 'GPA_5' || instProfile.gradingMode === 'GPA_4';

      const { sesByName, terms, clsByName, subjects } = analysis.existingMaps;
      const termKeyMap = new Map<string, any>();
      for (const t of terms) {
        termKeyMap.set(`${t.academic_session_id}::${String(t.name || '').trim().toLowerCase()}`, t);
      }

      // Cache historical exams per (session_id, term_id, class_id)
      const examCache = new Map<string, string>();
      const historyRecorded = new Set<string>();

      let sessionsCreated = 0;
      let termsCreated = 0;
      let classesCreated = 0;
      let subjectsCreated = 0;
      let registrationsSaved = 0;
      let scoresSaved = 0;

      for (const row of analysis.validRows) {
        // 1. Resolve or create historical academic session (NEVER mark as active so current session stays untouched!)
        const yearMatch = row.session_name.match(/(19\d{2}|20\d{2})/);
        const startYear = yearMatch ? Number(yearMatch[1]) : 2020;
        const derivedStartDate = `${startYear}-09-01`;
        const derivedEndDate = `${startYear + 1}-07-31`;

        let ses = sesByName.get(row.session_name.toLowerCase());
        if (!ses) {
          const sesId = newId('ses');
          await dualWrite(
            `INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            `INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [sesId, schoolId, row.session_name, derivedStartDate, derivedEndDate]
          );
          ses = { id: sesId, name: row.session_name };
          sesByName.set(row.session_name.toLowerCase(), ses);
          sessionsCreated += 1;
        }

        // 2. Resolve or create historical term/semester under that session
        const tKey = `${ses.id}::${row.term_name.toLowerCase()}`;
        let term = termKeyMap.get(tKey);
        if (!term) {
          const tId = newId('trm');
          await dualWrite(
            `INSERT INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            `INSERT INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [tId, schoolId, ses.id, row.term_name, derivedStartDate, derivedEndDate]
          );
          term = { id: tId, name: row.term_name, academic_session_id: ses.id };
          termKeyMap.set(tKey, term);
          termsCreated += 1;
        }

        // 3. Resolve or create historical class/level
        let cls = clsByName.get(row.class_name.toLowerCase());
        if (!cls) {
          const cId = newId('cls');
          await dualWrite(
            `INSERT INTO classes (id, school_id, name, level, created_at, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            `INSERT INTO classes (id, school_id, name, level, created_at, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [cId, schoolId, row.class_name, row.class_name]
          );
          cls = { id: cId, name: row.class_name };
          clsByName.set(row.class_name.toLowerCase(), cls);
          classesCreated += 1;
        }

        // 4. Resolve or create course/subject with exact modifiable credit_units
        let sub = subjects.find(
          (s) =>
            ((row.subject_code && String(s.code || '').trim().toUpperCase() === row.subject_code) ||
              String(s.name || '').trim().toLowerCase() === row.subject_name.toLowerCase()) &&
            (!s.class_id || s.class_id === cls.id)
        );
        if (!sub) {
          const subId = newId('sub');
          await dualWrite(
            `INSERT INTO subjects (
               id, school_id, name, code, class_id, credit_units, course_type, status, is_deleted, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,'CORE','ACTIVE',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            `INSERT INTO subjects (
               id, school_id, name, code, class_id, credit_units, course_type, status, is_deleted, created_at, updated_at
             ) VALUES (?,?,?,?,?,?,'CORE','ACTIVE',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            [subId, schoolId, row.subject_name, row.subject_code, cls.id, row.credit_units]
          );
          sub = { id: subId, name: row.subject_name, code: row.subject_code, class_id: cls.id, credit_units: row.credit_units };
          subjects.push(sub);
          subjectsCreated += 1;
        }

        // 5. Record historical course registration (preserving exact credit_units_snapshot!)
        const regId = newId('creg');
        await dualWrite(
          `INSERT INTO student_course_registrations (
             id, school_id, student_id, academic_session_id, term_id, class_id, subject_id,
             credit_units_snapshot, registration_type, status, registered_by, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'HISTORICAL','APPROVED',$9,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
           ON CONFLICT (school_id, student_id, academic_session_id, term_id, subject_id) DO UPDATE SET
             class_id = EXCLUDED.class_id,
             credit_units_snapshot = EXCLUDED.credit_units_snapshot,
             status = 'APPROVED',
             updated_at = CURRENT_TIMESTAMP`,
          `INSERT INTO student_course_registrations (
             id, school_id, student_id, academic_session_id, term_id, class_id, subject_id,
             credit_units_snapshot, registration_type, status, registered_by, created_at, updated_at
           ) VALUES (?,?,?,?,?,?,?,?,'HISTORICAL','APPROVED',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
           ON CONFLICT(school_id, student_id, academic_session_id, term_id, subject_id) DO UPDATE SET
             class_id = excluded.class_id,
             credit_units_snapshot = excluded.credit_units_snapshot,
             status = 'APPROVED',
             updated_at = CURRENT_TIMESTAMP`,
          [regId, schoolId, row.student_id, ses.id, term.id, cls.id, sub.id, row.credit_units, actorId]
        );
        registrationsSaved += 1;

        // 6. Anchor immutable historical enrollment class mapping (NEVER mutating students.class_id!)
        const histKey = `${row.student_id}::${ses.id}`;
        if (!historyRecorded.has(histKey)) {
          const existingHist = await dbGet(
            `SELECT id FROM student_enrollment_history
             WHERE school_id = $1 AND student_id = $2 AND academic_session_id = $3
               AND outcome != 'ROLLED_BACK' LIMIT 1`,
            `SELECT id FROM student_enrollment_history
             WHERE school_id = ? AND student_id = ? AND academic_session_id = ?
               AND outcome != 'ROLLED_BACK' LIMIT 1`,
            [schoolId, row.student_id, ses.id]
          );
          if (!existingHist) {
            const histId = newId('enrh');
            await dualWrite(
              `INSERT INTO student_enrollment_history (
                 id, school_id, student_id, academic_session_id, session_name, class_id, class_name,
                 previous_status, new_status, outcome, remarks, recorded_by, created_at
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE','ACTIVE','HISTORICAL_IMPORT','Historical backlog onboarding import',$8,CURRENT_TIMESTAMP)`,
              `INSERT INTO student_enrollment_history (
                 id, school_id, student_id, academic_session_id, session_name, class_id, class_name,
                 previous_status, new_status, outcome, remarks, recorded_by, created_at
               ) VALUES (?,?,?,?,?,?,?,'ACTIVE','ACTIVE','HISTORICAL_IMPORT','Historical backlog onboarding import',?,CURRENT_TIMESTAMP)`,
              [histId, schoolId, row.student_id, ses.id, ses.name, cls.id, cls.name, actorId]
            );
          }
          historyRecorded.add(histKey);
        }

        // 7. If scores are provided, upsert historical examination + student_scores cleanly
        if (row.has_score && row.total_score !== null) {
          const exKey = `${ses.id}::${term.id}::${cls.id}`;
          let examId = examCache.get(exKey);
          if (!examId) {
            const existingExam = await dbGet(
              `SELECT id FROM examinations
               WHERE school_id = $1 AND academic_session_id = $2 AND term_id = $3 AND class_id = $4
                 AND (is_deleted = 0 OR is_deleted IS NULL)
               ORDER BY created_at DESC LIMIT 1`,
              `SELECT id FROM examinations
               WHERE school_id = ? AND academic_session_id = ? AND term_id = ? AND class_id = ?
                 AND (is_deleted = 0 OR is_deleted IS NULL)
               ORDER BY created_at DESC LIMIT 1`,
              [schoolId, ses.id, term.id, cls.id]
            );
            if (existingExam) {
              examId = existingExam.id;
            } else {
              examId = newId('exm');
              const exTitle = `${ses.name} ${term.name} (${cls.name}) — Historical Record`;
              const exStatus = publishScores ? 'PUBLISHED' : 'DRAFT';
              await dualWrite(
                `INSERT INTO examinations (
                   id, school_id, academic_session_id, term_id, class_id, title, exam_type,
                   ca_max_score, exam_max_score, total_max_score, status, created_by,
                   published_by, published_at, is_deleted, created_at, updated_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,'HISTORICAL',40,60,100,$7,$8,$9,${publishScores ? 'CURRENT_TIMESTAMP' : 'NULL'},0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
                `INSERT INTO examinations (
                   id, school_id, academic_session_id, term_id, class_id, title, exam_type,
                   ca_max_score, exam_max_score, total_max_score, status, created_by,
                   published_by, published_at, is_deleted, created_at, updated_at
                 ) VALUES (?,?,?,?,?,?,'HISTORICAL',40,60,100,?,?,?,${publishScores ? 'CURRENT_TIMESTAMP' : 'NULL'},0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
                [examId, schoolId, ses.id, term.id, cls.id, exTitle, exStatus, actorId, publishScores ? actorId : null]
              );
            }
            if (examId) examCache.set(exKey, examId);
          }

          const gradeBand = isGpaMode
            ? computeGpaGradeBand(row.total_score, instProfile.gradingMode)
            : computeGrade(row.total_score, 100, acadSettings.grading_scale);

          const scoreId = newId('scr');
          const scStatus = publishScores ? 'PUBLISHED' : 'DRAFT';
          await dualWrite(
            `INSERT INTO student_scores (
               id, school_id, examination_id, student_id, class_id, subject_id, academic_session_id, term_id,
               ca_score, exam_score, total_score, grade, grade_remark, status, entered_by, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
             ON CONFLICT (examination_id, student_id, subject_id) DO UPDATE SET
               class_id = EXCLUDED.class_id,
               ca_score = EXCLUDED.ca_score,
               exam_score = EXCLUDED.exam_score,
               total_score = EXCLUDED.total_score,
               grade = EXCLUDED.grade,
               grade_remark = EXCLUDED.grade_remark,
               status = EXCLUDED.status,
               updated_at = CURRENT_TIMESTAMP`,
            `INSERT INTO student_scores (
               id, school_id, examination_id, student_id, class_id, subject_id, academic_session_id, term_id,
               ca_score, exam_score, total_score, grade, grade_remark, status, entered_by, created_at, updated_at
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
             ON CONFLICT(examination_id, student_id, subject_id) DO UPDATE SET
               class_id = excluded.class_id,
               ca_score = excluded.ca_score,
               exam_score = excluded.exam_score,
               total_score = excluded.total_score,
               grade = excluded.grade,
               grade_remark = excluded.grade_remark,
               status = excluded.status,
               updated_at = CURRENT_TIMESTAMP`,
            [
              scoreId,
              schoolId,
              examId,
              row.student_id,
              cls.id,
              sub.id,
              ses.id,
              term.id,
              row.ca_score ?? 0,
              row.exam_score ?? row.total_score,
              row.total_score,
              gradeBand.grade,
              gradeBand.remark,
              scStatus,
              actorId,
            ]
          );
          scoresSaved += 1;
        }
      }

      logAudit({
        actorId,
        actorEmail: req.user?.email,
        schoolId,
        action: 'IMPORT_HISTORICAL_BACKLOG',
        entity: 'HISTORICAL_BACKLOG',
        metadata: {
          rowsImported: analysis.validRows.length,
          invalidRows: analysis.invalidRows.length,
          sessionsCreated,
          termsCreated,
          classesCreated,
          subjectsCreated,
          registrationsSaved,
          scoresSaved,
          publishScores,
        },
      });

      return res.status(201).json({
        success: true,
        message: `Imported ${registrationsSaved} historical course registration(s) and ${scoresSaved} score(s) across ${new Set(analysis.validRows.map((r) => r.student_id)).size} learner(s). Current class placements remain untouched.`,
        summary: {
          rowsImported: analysis.validRows.length,
          invalidRows: analysis.invalidRows.length,
          sessionsCreated,
          termsCreated,
          classesCreated,
          subjectsCreated,
          registrationsSaved,
          scoresSaved,
        },
        invalidRows: analysis.invalidRows.slice(0, 20),
      });
    } catch (err: any) {
      console.error('[Historical Backlog Import Error]', err);
      return res.status(500).json({
        error: 'BACKLOG_IMPORT_FAILED',
        message: safeClientError(err, 'Failed to import historical backlog records.'),
      });
    }
  }
);

// ==============================================================================
// 5. CLASS / LEVEL MASTER BROADSHEET (Students x Subjects/Courses + GPA + Rank)
// GET /api/v1/school/examinations/:id/broadsheet
// ==============================================================================
courseAndBacklogRouter.get(
  '/examinations/:id/broadsheet',
  requireAuth,
  requireTenant,
  requireRole(ACADEMIC_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.targetSchoolId!;
      const examId = req.params.id;

      const exam = await dbGet(
        `SELECT ex.*, ses.name as session_name, t.name as term_name, c.name as class_name
         FROM examinations ex
         LEFT JOIN academic_sessions ses ON ex.academic_session_id = ses.id
         LEFT JOIN terms t ON ex.term_id = t.id
         LEFT JOIN classes c ON ex.class_id = c.id
         WHERE ex.id = $1 AND ex.school_id = $2 AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
         LIMIT 1`,
        `SELECT ex.*, ses.name as session_name, t.name as term_name, c.name as class_name
         FROM examinations ex
         LEFT JOIN academic_sessions ses ON ex.academic_session_id = ses.id
         LEFT JOIN terms t ON ex.term_id = t.id
         LEFT JOIN classes c ON ex.class_id = c.id
         WHERE ex.id = ? AND ex.school_id = ? AND (ex.is_deleted = 0 OR ex.is_deleted IS NULL)
         LIMIT 1`,
        [examId, schoolId]
      );
      if (!exam) {
        return res.status(404).json({ error: 'EXAM_NOT_FOUND', message: 'Examination not found.' });
      }

      const school = await dbGet(
        `SELECT id, name, type FROM schools WHERE id = $1`,
        `SELECT id, name, type FROM schools WHERE id = ?`,
        [schoolId]
      );
      const tenantSettings = await dbGet(
        `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json
         FROM school_settings WHERE school_id = $1 LIMIT 1`,
        `SELECT institution_category, academic_cycle_type, cycle_labels_json, grading_mode, terminology_json
         FROM school_settings WHERE school_id = ? LIMIT 1`,
        [schoolId]
      );
      const instProfile = resolveInstitutionProfile(school, tenantSettings);
      const isGpaMode = instProfile.gradingMode === 'GPA_5' || instProfile.gradingMode === 'GPA_4';

      const scores = await dbAll(
        `SELECT ss.*, s.full_name as student_name, s.admission_number,
                sub.name as subject_name, sub.code as subject_code,
                COALESCE(scr.credit_units_snapshot, sub.credit_units, 3) as credit_units
         FROM student_scores ss
         JOIN students s ON ss.student_id = s.id
         JOIN subjects sub ON ss.subject_id = sub.id
         LEFT JOIN student_course_registrations scr
           ON scr.school_id = ss.school_id
          AND scr.student_id = ss.student_id
          AND scr.academic_session_id = ss.academic_session_id
          AND scr.term_id = ss.term_id
          AND scr.subject_id = ss.subject_id
          AND scr.status != 'DROPPED'
         WHERE ss.school_id = $1 AND ss.examination_id = $2 AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         ORDER BY s.full_name ASC, sub.code ASC`,
        `SELECT ss.*, s.full_name as student_name, s.admission_number,
                sub.name as subject_name, sub.code as subject_code,
                COALESCE(scr.credit_units_snapshot, sub.credit_units, 3) as credit_units
         FROM student_scores ss
         JOIN students s ON ss.student_id = s.id
         JOIN subjects sub ON ss.subject_id = sub.id
         LEFT JOIN student_course_registrations scr
           ON scr.school_id = ss.school_id
          AND scr.student_id = ss.student_id
          AND scr.academic_session_id = ss.academic_session_id
          AND scr.term_id = ss.term_id
          AND scr.subject_id = ss.subject_id
          AND scr.status != 'DROPPED'
         WHERE ss.school_id = ? AND ss.examination_id = ? AND (s.is_deleted = 0 OR s.is_deleted IS NULL)
         ORDER BY s.full_name ASC, sub.code ASC`,
        [schoolId, examId]
      );

      const subjectColsMap = new Map<string, { id: string; code: string; name: string; credit_units: number }>();
      const studentMap = new Map<string, {
        student_id: string;
        admission_number: string | null;
        student_name: string;
        scores: Record<string, { total: number; grade: string; percentage: number }>;
        total_score: number;
        subjects_count: number;
        pct_sum: number;
        units_sum: number;
        qp_sum: number;
      }>();

      const maxScore = Number(exam.total_max_score) > 0 ? Number(exam.total_max_score) : 100;

      for (const sc of scores) {
        const units = sc.credit_units !== null && sc.credit_units !== undefined ? Number(sc.credit_units) : 3;
        if (!subjectColsMap.has(sc.subject_id)) {
          subjectColsMap.set(sc.subject_id, {
            id: sc.subject_id,
            code: sc.subject_code || sc.subject_name.slice(0, 5).toUpperCase(),
            name: sc.subject_name,
            credit_units: units,
          });
        }
        if (!studentMap.has(sc.student_id)) {
          studentMap.set(sc.student_id, {
            student_id: sc.student_id,
            admission_number: sc.admission_number || null,
            student_name: sc.student_name,
            scores: {},
            total_score: 0,
            subjects_count: 0,
            pct_sum: 0,
            units_sum: 0,
            qp_sum: 0,
          });
        }
        const entry = studentMap.get(sc.student_id)!;
        const total = Number(sc.total_score ?? 0);
        const pct = Math.round(((total / maxScore) * 100) * 100) / 100;
        entry.scores[sc.subject_id] = { total, grade: sc.grade || '', percentage: pct };
        entry.total_score += total;
        entry.subjects_count += 1;
        entry.pct_sum += pct;
        if (isGpaMode) {
          const band = computeGpaGradeBand(pct, instProfile.gradingMode);
          entry.units_sum += units;
          entry.qp_sum += units * band.points;
        }
      }

      const subjectColumns = Array.from(subjectColsMap.values()).sort((a, b) => a.code.localeCompare(b.code));
      const rows = Array.from(studentMap.values())
        .map((st) => ({
          student_id: st.student_id,
          admission_number: st.admission_number,
          student_name: st.student_name,
          scores: st.scores,
          subjects_count: st.subjects_count,
          total_score: Math.round(st.total_score * 100) / 100,
          average_score: st.subjects_count > 0 ? Math.round((st.pct_sum / st.subjects_count) * 100) / 100 : 0,
          gpa: isGpaMode && st.units_sum > 0 ? Math.round((st.qp_sum / st.units_sum) * 100) / 100 : null,
          credit_units: isGpaMode ? st.units_sum : null,
          position: 0,
        }))
        .sort((a, b) => (isGpaMode ? (b.gpa ?? 0) - (a.gpa ?? 0) : b.average_score - a.average_score));

      for (let i = 0; i < rows.length; i++) {
        if (i > 0) {
          const prevMetric = isGpaMode ? rows[i - 1].gpa : rows[i - 1].average_score;
          const currMetric = isGpaMode ? rows[i].gpa : rows[i].average_score;
          rows[i].position = prevMetric === currMetric ? rows[i - 1].position : i + 1;
        } else {
          rows[i].position = 1;
        }
      }

      return res.json({
        success: true,
        exam: {
          id: exam.id,
          title: exam.title,
          session_name: exam.session_name,
          term_name: exam.term_name,
          class_name: exam.class_name,
          status: exam.status,
          total_max_score: maxScore,
        },
        gradingMode: instProfile.gradingMode,
        isGpaMode,
        subjects: subjectColumns,
        rows,
      });
    } catch (err: any) {
      console.error('[Broadsheet Error]', err);
      return res.status(500).json({
        error: 'BROADSHEET_FAILED',
        message: safeClientError(err, 'Failed to compile examination broadsheet.'),
      });
    }
  }
);
