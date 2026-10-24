/**
 * BURSARIQ - POSTGRESQL SCHOOL ADMINISTRATION & STUDENT MANAGEMENT SERVICE
 *
 * Implements asynchronous, PostgreSQL-native operations for:
 * 1. School settings, profiles, and academic sessions.
 * 2. Student enrollment, updates, pagination, and search.
 * 3. Parent creation and student-parent relationships.
 * 4. Classes, class arms, and arm allocations.
 * 5. Staff records, roles, and credential management.
 *
 * Enforces strict school_id tenant isolation across all operations.
 */

import crypto from 'node:crypto';
import pg from 'pg';
import { getPgPool } from './db.ts';

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// -----------------------------------------------------------------------------
// 1. School Profile & Settings
// -----------------------------------------------------------------------------

export async function getSchoolProfilePg(
  schoolId: string,
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ school: any; settings: any }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  const schoolRes = await pool.query('SELECT * FROM schools WHERE id = $1', [schoolId]);
  if (schoolRes.rows.length === 0) {
    return { success: false, error: 'School not found', code: 'NOT_FOUND' };
  }

  const settingsRes = await pool.query('SELECT * FROM school_settings WHERE school_id = $1', [schoolId]);

  return {
    success: true,
    data: {
      school: schoolRes.rows[0],
      settings: settingsRes.rows[0] || null,
    },
  };
}

export async function updateSchoolProfilePg(
  schoolId: string,
  params: {
    name: string;
    address?: string;
    state: string;
    lga: string;
    phone: string;
    email: string;
    website?: string;
    type?: string;
  },
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ school: any }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  // Check email uniqueness across schools
  const emailCheck = await pool.query(
    'SELECT id FROM schools WHERE LOWER(email) = LOWER($1) AND id != $2',
    [params.email.trim(), schoolId]
  );
  if (emailCheck.rows.length > 0) {
    return { success: false, error: 'Email already registered to another school', code: 'EMAIL_IN_USE' };
  }

  const updateRes = await pool.query(
    `UPDATE schools
     SET name = $1, address = $2, state = $3, lga = $4, phone = $5,
         email = LOWER($6), website = $7, type = COALESCE($8, type), updated_at = CURRENT_TIMESTAMP
     WHERE id = $9
     RETURNING *`,
    [
      params.name.trim(),
      params.address || '',
      params.state,
      params.lga,
      params.phone,
      params.email.trim(),
      params.website || null,
      params.type || null,
      schoolId,
    ]
  );

  return { success: true, data: { school: updateRes.rows[0] } };
}

// -----------------------------------------------------------------------------
// 2. Academic Sessions & Terms
// -----------------------------------------------------------------------------

export async function getAcademicSessionsPg(
  schoolId: string,
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ sessions: any[] }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  const res = await pool.query(
    `SELECT * FROM academic_sessions WHERE school_id = $1 ORDER BY start_date DESC`,
    [schoolId]
  );
  return { success: true, data: { sessions: res.rows } };
}

export async function createAcademicSessionPg(
  schoolId: string,
  params: {
    name: string;
    startDate: string;
    endDate: string;
    isCurrent?: boolean;
  },
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ session: any }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  const sessionId = 'ses_' + crypto.randomBytes(8).toString('hex');

  // If isCurrent is true, unset others within the same school
  if (params.isCurrent) {
    await pool.query('UPDATE academic_sessions SET is_current = 0 WHERE school_id = $1', [schoolId]);
  }

  const res = await pool.query(
    `INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      sessionId,
      schoolId,
      params.name,
      params.startDate,
      params.endDate,
      params.isCurrent ? 1 : 0,
      params.isCurrent ? 'ACTIVE' : 'UPCOMING',
    ]
  );

  return { success: true, data: { session: res.rows[0] } };
}

// -----------------------------------------------------------------------------
// 3. Classes and Arms
// -----------------------------------------------------------------------------

export async function getClassesPg(
  schoolId: string,
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ classes: any[] }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  const classesRes = await pool.query(
    `SELECT c.*, 
            (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.school_id = c.school_id AND s.is_deleted = 0) as student_count
     FROM classes c 
     WHERE c.school_id = $1 
     ORDER BY c.level_order ASC, c.name ASC`,
    [schoolId]
  );

  const armsRes = await pool.query(
    `SELECT * FROM class_arms WHERE school_id = $1 ORDER BY name ASC`,
    [schoolId]
  );

  const armsByClass = new Map<string, any[]>();
  for (const arm of armsRes.rows) {
    const list = armsByClass.get(arm.class_id) || [];
    list.push(arm);
    armsByClass.set(arm.class_id, list);
  }

  const classesWithArms = classesRes.rows.map((c) => ({
    ...c,
    student_count: parseInt(c.student_count || '0', 10),
    arms: armsByClass.get(c.id) || [],
  }));

  return { success: true, data: { classes: classesWithArms } };
}

export async function createClassPg(
  schoolId: string,
  params: {
    name: string;
    level?: string;
    orderIndex?: number;
  },
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ classRecord: any }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  // Check unique class name within school
  const dupCheck = await pool.query(
    'SELECT id FROM classes WHERE school_id = $1 AND LOWER(name) = LOWER($2)',
    [schoolId, params.name.trim()]
  );
  if (dupCheck.rows.length > 0) {
    return { success: false, error: 'A class with this name already exists in this school', code: 'DUPLICATE_CLASS' };
  }

  const classId = 'cls_' + crypto.randomBytes(8).toString('hex');
  const res = await pool.query(
    `INSERT INTO classes (id, school_id, name, level, level_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [classId, schoolId, params.name.trim(), params.level || 'SECONDARY', params.orderIndex || 0]
  );

  return { success: true, data: { classRecord: res.rows[0] } };
}

export async function createClassArmPg(
  schoolId: string,
  params: {
    classId: string;
    name: string;
    capacity?: number;
  },
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ arm: any }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  // Verify parent class belongs to school
  const classCheck = await pool.query(
    'SELECT id FROM classes WHERE id = $1 AND school_id = $2',
    [params.classId, schoolId]
  );
  if (classCheck.rows.length === 0) {
    return { success: false, error: 'Target class not found in school', code: 'CLASS_NOT_FOUND' };
  }

  const armId = 'arm_' + crypto.randomBytes(8).toString('hex');
  const res = await pool.query(
    `INSERT INTO class_arms (id, school_id, class_id, name, capacity)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [armId, schoolId, params.classId, params.name.trim(), params.capacity || 40]
  );

  return { success: true, data: { arm: res.rows[0] } };
}

// -----------------------------------------------------------------------------
// 4. Student Enrollment & Management
// -----------------------------------------------------------------------------

export async function createStudentPg(
  schoolId: string,
  params: {
    admissionNumber: string;
    firstName: string;
    lastName: string;
    middleName?: string;
    gender: 'MALE' | 'FEMALE';
    dateOfBirth?: string;
    classId?: string;
    classArmId?: string;
    academicSessionId?: string;
    emergencyContact?: string;
    phone?: string;
    email?: string;
    address?: string;
    state?: string;
  },
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ student: any }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  // 1. Verify admission number uniqueness within school
  const dupCheck = await pool.query(
    'SELECT id FROM students WHERE school_id = $1 AND LOWER(admission_number) = LOWER($2) AND is_deleted = 0',
    [schoolId, params.admissionNumber.trim()]
  );
  if (dupCheck.rows.length > 0) {
    return {
      success: false,
      error: `Admission number "${params.admissionNumber}" is already in use at this school`,
      code: 'DUPLICATE_ADMISSION_NUMBER',
    };
  }

  // 2. If classId provided, verify tenant ownership
  let classArmName: string | null = null;
  if (params.classId) {
    const classCheck = await pool.query('SELECT id FROM classes WHERE id = $1 AND school_id = $2', [
      params.classId,
      schoolId,
    ]);
    if (classCheck.rows.length === 0) {
      return { success: false, error: 'Specified class does not belong to this school', code: 'INVALID_CLASS' };
    }
  }

  if (params.classArmId) {
    const armCheck = await pool.query('SELECT name FROM class_arms WHERE id = $1 AND school_id = $2', [
      params.classArmId,
      schoolId,
    ]);
    if (armCheck.rows.length > 0) {
      classArmName = armCheck.rows[0].name;
    }
  }

  const studentId = 'stu_' + crypto.randomBytes(8).toString('hex');
  const res = await pool.query(
    `INSERT INTO students (
       id, school_id, admission_number, first_name, last_name, middle_name,
       gender, date_of_birth, class_id, class_arm_id, class_arm_name,
       academic_session_id, emergency_contact, phone, email, address, state,
       student_status, admission_date, is_deleted
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16, $17,
       'ACTIVE', CURRENT_DATE, 0
     ) RETURNING *`,
    [
      studentId,
      schoolId,
      params.admissionNumber.trim(),
      params.firstName.trim(),
      params.lastName.trim(),
      params.middleName?.trim() || '',
      params.gender,
      params.dateOfBirth || null,
      params.classId || null,
      params.classArmId || null,
      classArmName,
      params.academicSessionId || null,
      params.emergencyContact || null,
      params.phone || null,
      params.email || null,
      params.address || null,
      params.state || 'Lagos',
    ]
  );

  return { success: true, data: { student: res.rows[0] } };
}

export async function getStudentsPg(
  schoolId: string,
  options: {
    page?: number;
    limit?: number;
    search?: string;
    classId?: string;
    status?: string;
  },
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ students: any[]; total: number; page: number; totalPages: number }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 25));
  const offset = (page - 1) * limit;

  const conditions: string[] = ['s.school_id = $1', 's.is_deleted = 0'];
  const values: any[] = [schoolId];
  let pIndex = 2;

  if (options.classId) {
    conditions.push(`s.class_id = $${pIndex++}`);
    values.push(options.classId);
  }

  if (options.status) {
    conditions.push(`s.student_status = $${pIndex++}`);
    values.push(options.status);
  }

  if (options.search && options.search.trim() !== '') {
    const q = `%${options.search.trim().toLowerCase()}%`;
    conditions.push(
      `(LOWER(s.first_name) LIKE $${pIndex} OR LOWER(s.last_name) LIKE $${pIndex} OR LOWER(s.admission_number) LIKE $${pIndex})`
    );
    values.push(q);
    pIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) as count FROM students s WHERE ${whereClause}`,
    values
  );
  const total = parseInt(countRes.rows[0]?.count || '0', 10);

  const queryValues = [...values, limit, offset];
  const studentsRes = await pool.query(
    `SELECT s.*, c.name as class_name, ca.name as arm_name
     FROM students s
     LEFT JOIN classes c ON s.class_id = c.id AND c.school_id = s.school_id
     LEFT JOIN class_arms ca ON s.class_arm_id = ca.id AND ca.school_id = s.school_id
     WHERE ${whereClause}
     ORDER BY s.last_name ASC, s.first_name ASC
     LIMIT $${pIndex++} OFFSET $${pIndex++}`,
    queryValues
  );

  return {
    success: true,
    data: {
      students: studentsRes.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// -----------------------------------------------------------------------------
// 5. Parent Management & Student Links
// -----------------------------------------------------------------------------

export async function createParentWithStudentLinkPg(
  schoolId: string,
  params: {
    studentId: string;
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    relationship?: string;
  },
  clientOverride?: pg.PoolClient
): Promise<ServiceResult<{ parent: any; link: any }>> {
  const pool = clientOverride || getPgPool();
  if (!pool) return { success: false, error: 'Database offline', code: 'DB_OFFLINE' };

  // 1. Verify student belongs to school
  const stuCheck = await pool.query(
    'SELECT id FROM students WHERE id = $1 AND school_id = $2 AND is_deleted = 0',
    [params.studentId, schoolId]
  );
  if (stuCheck.rows.length === 0) {
    return { success: false, error: 'Student not found in this school', code: 'STUDENT_NOT_FOUND' };
  }

  const client = clientOverride || (await getPgPool()!.connect());
  const shouldManage = !clientOverride;

  try {
    if (shouldManage) await client.query('BEGIN');

    const parentId = 'par_' + crypto.randomBytes(8).toString('hex');
    const parentRes = await client.query(
      `INSERT INTO parents (id, school_id, first_name, last_name, phone, email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [parentId, schoolId, params.firstName.trim(), params.lastName.trim(), params.phone.trim(), params.email || null]
    );

    const linkId = 'ps_' + crypto.randomBytes(8).toString('hex');
    const linkRes = await client.query(
      `INSERT INTO parent_students (id, school_id, parent_id, student_id, relationship)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [linkId, schoolId, parentId, params.studentId, params.relationship || 'GUARDIAN']
    );

    if (shouldManage) await client.query('COMMIT');

    return {
      success: true,
      data: {
        parent: parentRes.rows[0],
        link: linkRes.rows[0],
      },
    };
  } catch (err: any) {
    if (shouldManage) await client.query('ROLLBACK');
    return { success: false, error: err.message, code: 'PARENT_CREATE_FAILED' };
  } finally {
    if (shouldManage) client.release();
  }
}
