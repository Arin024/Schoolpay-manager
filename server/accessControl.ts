import crypto from 'node:crypto';
import { cacheDb, getPgPool, queryPg } from './db.ts';
import type { AuthenticatedRequest } from './tenantMiddleware.ts';

export const ADMIN_ONLY_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN'];
export const FINANCE_ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR'];
export const ACADEMIC_READ_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR', 'TEACHER'];
export const DIRECTORY_READ_ROLES = ['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR'];

export interface GradingScaleBand {
  grade: string;
  min: number;
  max: number;
  remark: string;
}

export interface SchoolAcademicSettingsRecord {
  id: string;
  school_id: string;
  ca_max_score: number;
  exam_max_score: number;
  component_structure_json: string | null;
  grading_scale_json: string;
  grading_scale: GradingScaleBand[];
  missing_score_policy: 'EXCLUDE' | 'ZERO';
  show_class_position: number;
  students_can_view_fees: number;
  teachers_can_view_fees: number;
  require_review_before_approve: number;
  updated_by?: string | null;
  updated_at?: string;
}

export const DEFAULT_GRADING_SCALE: GradingScaleBand[] = [
  { grade: 'A', min: 75, max: 100, remark: 'Excellent' },
  { grade: 'B', min: 65, max: 74.99, remark: 'Very Good' },
  { grade: 'C', min: 50, max: 64.99, remark: 'Credit' },
  { grade: 'D', min: 45, max: 49.99, remark: 'Pass' },
  { grade: 'E', min: 40, max: 44.99, remark: 'Fair' },
  { grade: 'F', min: 0, max: 39.99, remark: 'Needs Improvement' },
];

export function getEffectiveRoleName(req: AuthenticatedRequest): string | null {
  if (req.user?.is_platform_admin === 1) {
    return 'SUPER_ADMIN';
  }
  return req.activeRole?.role_name || null;
}

export function isAdminRole(req: AuthenticatedRequest): boolean {
  const role = getEffectiveRoleName(req);
  return Boolean(role && ADMIN_ONLY_ROLES.includes(role));
}

export function isFinanceAdminRole(req: AuthenticatedRequest): boolean {
  const role = getEffectiveRoleName(req);
  return Boolean(role && FINANCE_ADMIN_ROLES.includes(role));
}

/**
 * Returns null if the role can view school-wide student rosters (Admins/Bursar/Teacher).
 * Returns an explicit array of authorized student IDs for PARENT or STUDENT roles.
 * NEVER auto-links by email, phone, or name — strictly checks verified parent_students / students.user_id.
 */
export async function getAuthorizedStudentIds(
  userId: string,
  schoolId: string,
  roleName: string | null
): Promise<string[] | null> {
  if (!roleName) return [];
  if (['SUPER_ADMIN', 'SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR', 'TEACHER'].includes(roleName)) {
    return null;
  }

  const pool = getPgPool();

  if (roleName === 'PARENT') {
    if (pool) {
      try {
        const res = await queryPg(
          `SELECT DISTINCT ps.student_id
           FROM parent_students ps
           JOIN parents p ON ps.parent_id = p.id
           JOIN students s ON ps.student_id = s.id
           WHERE p.user_id = $1
             AND p.school_id = $2
             AND ps.school_id = $2
             AND s.school_id = $2
             AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
             AND (s.is_deleted = 0 OR s.is_deleted IS NULL)`,
          [userId, schoolId]
        );
        return res.rows.map((r: any) => String(r.student_id));
      } catch {
        // fallback to SQLite cache below
      }
    }

    const rows = cacheDb
      .prepare(
        `SELECT DISTINCT ps.student_id
         FROM parent_students ps
         JOIN parents p ON ps.parent_id = p.id
         JOIN students s ON ps.student_id = s.id
         WHERE p.user_id = ?
           AND p.school_id = ?
           AND ps.school_id = ?
           AND s.school_id = ?
           AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
           AND (s.is_deleted = 0 OR s.is_deleted IS NULL)`
      )
      .all(userId, schoolId, schoolId, schoolId) as { student_id: string }[];

    return rows.map((r) => String(r.student_id));
  }

  if (roleName === 'STUDENT') {
    if (pool) {
      try {
        const res = await queryPg(
          `SELECT id FROM students
           WHERE user_id = $1 AND school_id = $2
             AND (is_deleted = 0 OR is_deleted IS NULL)`,
          [userId, schoolId]
        );
        return res.rows.map((r: any) => String(r.id));
      } catch {
        // fallback below
      }
    }

    const rows = cacheDb
      .prepare(
        `SELECT id FROM students
         WHERE user_id = ? AND school_id = ?
           AND (is_deleted = 0 OR is_deleted IS NULL)`
      )
      .all(userId, schoolId) as { id: string }[];

    return rows.map((r) => String(r.id));
  }

  return [];
}

export async function canAccessStudent(req: AuthenticatedRequest, studentId: string): Promise<boolean> {
  const schoolId = req.targetSchoolId || req.activeSchoolId;
  if (!req.user || !schoolId) return false;
  const roleName = getEffectiveRoleName(req);
  const allowedIds = await getAuthorizedStudentIds(req.user.id, schoolId, roleName);
  if (allowedIds === null) return true;
  return allowedIds.includes(studentId);
}

export function normalizeGradingScale(raw: unknown): GradingScaleBand[] {
  let parsed: any = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return DEFAULT_GRADING_SCALE;
  }
  const clean = parsed
    .map((band: any) => ({
      grade: String(band?.grade || '').trim().toUpperCase(),
      min: Number(band?.min ?? 0),
      max: Number(band?.max ?? 100),
      remark: String(band?.remark || '').trim() || 'Graded',
    }))
    .filter((b: GradingScaleBand) => b.grade.length > 0 && !Number.isNaN(b.min) && !Number.isNaN(b.max))
    .sort((a: GradingScaleBand, b: GradingScaleBand) => b.min - a.min);

  return clean.length > 0 ? clean : DEFAULT_GRADING_SCALE;
}

export function computeGrade(
  totalScore: number | null,
  totalMaxScore: number,
  gradingScale: GradingScaleBand[]
): { grade: string | null; remark: string | null; percentage: number | null } {
  if (totalScore === null || totalScore === undefined || Number.isNaN(Number(totalScore))) {
    return { grade: null, remark: null, percentage: null };
  }
  const max = totalMaxScore > 0 ? totalMaxScore : 100;
  const pct = Math.max(0, Math.min(100, Math.round(((Number(totalScore) / max) * 100) * 100) / 100));
  const sorted = [...gradingScale].sort((a, b) => b.min - a.min);
  for (const band of sorted) {
    if (pct >= band.min) {
      return { grade: band.grade, remark: band.remark, percentage: pct };
    }
  }
  const last = sorted[sorted.length - 1];
  return {
    grade: last?.grade || 'F',
    remark: last?.remark || 'Needs Improvement',
    percentage: pct,
  };
}

export async function getSchoolAcademicSettings(schoolId: string): Promise<SchoolAcademicSettingsRecord> {
  const pool = getPgPool();
  let row: any = null;

  if (pool) {
    try {
      const res = await queryPg('SELECT * FROM school_academic_settings WHERE school_id = $1 LIMIT 1', [schoolId]);
      if (res.rows.length > 0) {
        row = res.rows[0];
        try {
          cacheDb
            .prepare(
              `INSERT INTO school_academic_settings (
                 id, school_id, ca_max_score, exam_max_score, component_structure_json,
                 grading_scale_json, missing_score_policy, show_class_position,
                 students_can_view_fees, teachers_can_view_fees, require_review_before_approve, updated_by, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(school_id) DO UPDATE SET
                 ca_max_score = excluded.ca_max_score,
                 exam_max_score = excluded.exam_max_score,
                 component_structure_json = excluded.component_structure_json,
                 grading_scale_json = excluded.grading_scale_json,
                 missing_score_policy = excluded.missing_score_policy,
                 show_class_position = excluded.show_class_position,
                 students_can_view_fees = excluded.students_can_view_fees,
                 teachers_can_view_fees = excluded.teachers_can_view_fees,
                 require_review_before_approve = excluded.require_review_before_approve`
            )
            .run(
              row.id,
              row.school_id,
              Number(row.ca_max_score ?? 40),
              Number(row.exam_max_score ?? 60),
              row.component_structure_json || null,
              row.grading_scale_json || JSON.stringify(DEFAULT_GRADING_SCALE),
              row.missing_score_policy || 'EXCLUDE',
              Number(row.show_class_position ?? 1),
              Number(row.students_can_view_fees ?? 1),
              Number(row.teachers_can_view_fees ?? 0),
              Number(row.require_review_before_approve ?? 0),
              row.updated_by || null
            );
        } catch {}
      }
    } catch {}
  }

  if (!row) {
    try {
      row = cacheDb.prepare('SELECT * FROM school_academic_settings WHERE school_id = ? LIMIT 1').get(schoolId);
    } catch {}
  }

  if (!row) {
    const defaultScaleJson = JSON.stringify(DEFAULT_GRADING_SCALE);
    return {
      id: `acad_set_${schoolId}`,
      school_id: schoolId,
      ca_max_score: 40,
      exam_max_score: 60,
      component_structure_json: JSON.stringify([
        { key: 'ca1', label: '1st CA', max: 20 },
        { key: 'ca2', label: '2nd CA', max: 20 },
        { key: 'exam', label: 'Terminal Exam', max: 60 },
      ]),
      grading_scale_json: defaultScaleJson,
      grading_scale: DEFAULT_GRADING_SCALE,
      missing_score_policy: 'EXCLUDE',
      show_class_position: 1,
      students_can_view_fees: 1,
      teachers_can_view_fees: 0,
      require_review_before_approve: 0,
    };
  }

  const scale = normalizeGradingScale(row.grading_scale_json);
  return {
    id: row.id,
    school_id: row.school_id,
    ca_max_score: Number(row.ca_max_score ?? 40),
    exam_max_score: Number(row.exam_max_score ?? 60),
    component_structure_json: row.component_structure_json || null,
    grading_scale_json: JSON.stringify(scale),
    grading_scale: scale,
    missing_score_policy: row.missing_score_policy === 'ZERO' ? 'ZERO' : 'EXCLUDE',
    show_class_position: Number(row.show_class_position ?? 1),
    students_can_view_fees: Number(row.students_can_view_fees ?? 1),
    teachers_can_view_fees: Number(row.teachers_can_view_fees ?? 0),
    require_review_before_approve: Number(row.require_review_before_approve ?? 0),
    updated_by: row.updated_by || null,
    updated_at: row.updated_at || undefined,
  };
}

export async function dbAll(sqlPg: string, sqlSqlite: string, params: any[] = []): Promise<any[]> {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await queryPg(sqlPg, params);
      return res.rows;
    } catch {
      // fall back to SQLite cache
    }
  }
  return cacheDb.prepare(sqlSqlite).all(...params) as any[];
}

export async function dbGet(sqlPg: string, sqlSqlite: string, params: any[] = []): Promise<any | undefined> {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await queryPg(sqlPg, params);
      return res.rows[0];
    } catch {
      // fall back to SQLite cache
    }
  }
  return cacheDb.prepare(sqlSqlite).get(...params) as any;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}
