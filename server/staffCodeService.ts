import crypto from 'crypto';
import { cacheDb, getPgPool, queryPg } from './db.ts';
import { computeSchoolPrefix } from './admissionNumberService.ts';

export interface BatchStaffCodeAllocator {
  prefix: string;
  year: number;
  allocateNext: () => string;
}

/**
 * Loads all existing staff codes for a school (from both PG and SQLite cache)
 * and returns a sequential collision-free allocator formatted as `<PREFIX>/STF/<YEAR>/<0001>`.
 */
export async function createBatchStaffCodeAllocator(
  schoolId: string,
  schoolName?: string | null,
  schoolSlug?: string | null,
  year = new Date().getUTCFullYear()
): Promise<BatchStaffCodeAllocator> {
  const pool = getPgPool();

  let resolvedName = schoolName || '';
  let resolvedSlug = schoolSlug || '';
  if (!resolvedName) {
    if (pool) {
      try {
        const sRes = await queryPg('SELECT name, slug FROM schools WHERE id = $1 LIMIT 1', [schoolId]);
        if (sRes.rows[0]) {
          resolvedName = sRes.rows[0].name || '';
          resolvedSlug = resolvedSlug || sRes.rows[0].slug || '';
        }
      } catch {}
    }
    if (!resolvedName) {
      try {
        const sRow = cacheDb.prepare('SELECT name, slug FROM schools WHERE id = ? LIMIT 1').get(schoolId) as any;
        if (sRow) {
          resolvedName = sRow.name || '';
          resolvedSlug = resolvedSlug || sRow.slug || '';
        }
      } catch {}
    }
  }

  const prefix = computeSchoolPrefix(resolvedName, resolvedSlug);
  const existingSet = new Set<string>();
  const existingRaw: string[] = [];

  if (pool) {
    try {
      const pgRes = await queryPg(
        'SELECT staff_number FROM staff WHERE school_id = $1 AND staff_number IS NOT NULL',
        [schoolId]
      );
      for (const r of pgRes.rows) {
        const val = String(r.staff_number || '').trim();
        if (val) {
          existingSet.add(val.toLowerCase());
          existingRaw.push(val);
        }
      }
    } catch {}
  }

  try {
    const localRows = cacheDb
      .prepare('SELECT staff_number FROM staff WHERE school_id = ? AND staff_number IS NOT NULL')
      .all(schoolId) as any[];
    for (const r of localRows) {
      const val = String(r.staff_number || '').trim();
      if (val) {
        existingSet.add(val.toLowerCase());
        existingRaw.push(val);
      }
    }
  } catch {}

  const patternPrefix = `${prefix}/STF/${year}/`.toLowerCase();
  let maxSeq = 0;
  for (const code of existingRaw) {
    const lower = code.toLowerCase();
    if (lower.startsWith(patternPrefix)) {
      const suffixDigits = code.slice(patternPrefix.length).match(/^\d+/);
      if (suffixDigits) {
        const n = parseInt(suffixDigits[0], 10);
        if (Number.isFinite(n) && n > maxSeq) {
          maxSeq = n;
        }
      }
    }
  }

  let nextSeq = maxSeq;
  const allocateNext = (): string => {
    while (true) {
      nextSeq += 1;
      const candidate = `${prefix}/STF/${year}/${String(nextSeq).padStart(4, '0')}`;
      if (!existingSet.has(candidate.toLowerCase())) {
        existingSet.add(candidate.toLowerCase());
        return candidate;
      }
    }
  };

  return { prefix, year, allocateNext };
}

/**
 * Generates a single next unique Staff Code (`<PREFIX>/STF/<YEAR>/<0001>`) for a staff member in a school.
 */
export async function generateNextStaffCode(schoolId: string): Promise<string> {
  const allocator = await createBatchStaffCodeAllocator(schoolId);
  return allocator.allocateNext();
}

/**
 * Non-destructively assigns missing Staff Login Codes for:
 * 1) Any existing non-deleted `staff` rows lacking a `staff_number`.
 * 2) Any active TEACHER/STAFF portal user lacking a linked `staff` row (links matching email/user_id first, or creates a linked staff row).
 */
export async function assignMissingStaffCodesForSchool(schoolId: string): Promise<{
  assignedCount: number;
  createdProfilesCount: number;
  prefix: string;
  staff: Array<{ id: string; full_name: string; staff_number: string; email: string | null }>;
}> {
  const pool = getPgPool();
  const allocator = await createBatchStaffCodeAllocator(schoolId);
  const updatedList: Array<{ id: string; full_name: string; staff_number: string; email: string | null }> = [];
  let createdProfilesCount = 0;

  // Step 1: Load all active staff rows for this school
  let staffRows: any[] = [];
  if (pool) {
    try {
      const res = await queryPg(
        `SELECT id, user_id, staff_number, first_name, middle_name, last_name, email, job_title
         FROM staff
         WHERE school_id = $1 AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY created_at ASC, id ASC`,
        [schoolId]
      );
      staffRows = res.rows;
    } catch {}
  }
  if (staffRows.length === 0) {
    staffRows = cacheDb
      .prepare(
        `SELECT id, user_id, staff_number, first_name, middle_name, last_name, email, job_title
         FROM staff
         WHERE school_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY created_at ASC, id ASC`
      )
      .all(schoolId) as any[];
  }

  // Step 2: Load TEACHER/STAFF user_roles in this school so we can link user_ids and create missing staff rows
  let staffRoleUsers: any[] = [];
  if (pool) {
    try {
      const uRes = await queryPg(
        `SELECT u.id as user_id, u.email, u.full_name, u.phone, r.name as role_name
         FROM user_roles ur
         JOIN users u ON ur.user_id = u.id
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.school_id = $1 AND r.name IN ('TEACHER', 'STAFF') AND COALESCE(u.is_active, 1) = 1`,
        [schoolId]
      );
      staffRoleUsers = uRes.rows;
    } catch {}
  }
  if (staffRoleUsers.length === 0) {
    staffRoleUsers = cacheDb
      .prepare(
        `SELECT u.id as user_id, u.email, u.full_name, u.phone, r.name as role_name
         FROM user_roles ur
         JOIN users u ON ur.user_id = u.id
         JOIN roles r ON ur.role_id = r.id
         WHERE ur.school_id = ? AND r.name IN ('TEACHER', 'STAFF') AND COALESCE(u.is_active, 1) = 1`
      )
      .all(schoolId) as any[];
  }

  const userByEmail = new Map<string, any>();
  for (const su of staffRoleUsers) {
    if (su.email) userByEmail.set(String(su.email).trim().toLowerCase(), su);
  }

  // Fill missing staff_number or missing user_id link on existing staff rows
  for (const st of staffRows) {
    const needsCode = !st.staff_number || !String(st.staff_number).trim();
    const matchedUser =
      !st.user_id && st.email ? userByEmail.get(String(st.email).trim().toLowerCase()) : null;

    if (needsCode || matchedUser) {
      const nextCode = needsCode ? allocator.allocateNext() : String(st.staff_number).trim();
      const nextUserId = st.user_id || matchedUser?.user_id || null;

      if (pool) {
        try {
          await queryPg(
            `UPDATE staff SET staff_number = $1, user_id = COALESCE(user_id, $2), updated_at = CURRENT_TIMESTAMP
             WHERE id = $3 AND school_id = $4`,
            [nextCode, nextUserId, st.id, schoolId]
          );
        } catch {}
      }
      try {
        cacheDb
          .prepare(
            `UPDATE staff SET staff_number = ?, user_id = COALESCE(user_id, ?), updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND school_id = ?`
          )
          .run(nextCode, nextUserId, st.id, schoolId);
      } catch {}

      st.staff_number = nextCode;
      st.user_id = nextUserId;

      if (needsCode) {
        const fullName = [st.first_name, st.middle_name, st.last_name].filter(Boolean).join(' ') || 'Staff Member';
        updatedList.push({
          id: st.id,
          full_name: fullName,
          staff_number: nextCode,
          email: st.email || null,
        });
      }
    }
  }

  // Step 3: Ensure every active TEACHER/STAFF portal user has a staff profile + unique Staff Code
  const linkedUserIds = new Set<string>(staffRows.map((s) => String(s.user_id || '')).filter(Boolean));
  const staffEmails = new Set<string>(
    staffRows.map((s) => String(s.email || '').trim().toLowerCase()).filter(Boolean)
  );

  for (const su of staffRoleUsers) {
    const emailLower = String(su.email || '').trim().toLowerCase();
    if (linkedUserIds.has(String(su.user_id)) || (emailLower && staffEmails.has(emailLower))) {
      continue;
    }

    const parts = String(su.full_name || 'Staff Member').trim().split(/\s+/);
    const firstName = parts[0] || 'Staff';
    const lastName = parts.slice(1).join(' ') || 'Member';
    const newStaffId = 'stf_' + crypto.randomBytes(6).toString('hex');
    const newCode = allocator.allocateNext();
    const jobTitle = su.role_name === 'TEACHER' ? 'Class Teacher' : 'School Staff';

    if (pool) {
      try {
        await queryPg(
          `INSERT INTO staff (
            id, school_id, user_id, staff_number, first_name, middle_name, last_name,
            email, phone, job_title, department, employment_status, date_joined, is_deleted, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, '', $6, $7, $8, $9, 'Academic', 'ACTIVE', CURRENT_DATE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [newStaffId, schoolId, su.user_id, newCode, firstName, lastName, emailLower || null, su.phone || null, jobTitle]
        );
      } catch {}
    }

    try {
      cacheDb
        .prepare(
          `INSERT OR IGNORE INTO staff (
            id, school_id, user_id, staff_number, first_name, middle_name, last_name,
            email, phone, job_title, department, employment_status, date_joined, is_deleted, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 'Academic', 'ACTIVE', CURRENT_DATE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run(newStaffId, schoolId, su.user_id, newCode, firstName, lastName, emailLower || null, su.phone || null, jobTitle);
    } catch {}

    linkedUserIds.add(String(su.user_id));
    if (emailLower) staffEmails.add(emailLower);
    createdProfilesCount += 1;
    updatedList.push({
      id: newStaffId,
      full_name: su.full_name || `${firstName} ${lastName}`,
      staff_number: newCode,
      email: emailLower || null,
    });
  }

  return {
    assignedCount: updatedList.length,
    createdProfilesCount,
    prefix: allocator.prefix,
    staff: updatedList,
  };
}

/**
 * Startup non-destructive backfill across all existing active schools so existing staff and teachers
 * automatically receive unique Staff Login Codes without disturbing any existing records.
 */
export async function backfillAllSchoolsStaffCodesAndLinks(): Promise<void> {
  try {
    const pool = getPgPool();
    let schools: Array<{ id: string }> = [];
    if (pool) {
      try {
        const res = await queryPg(
          `SELECT id FROM schools WHERE UPPER(COALESCE(status, 'TRIAL')) != 'CANCELLED' ORDER BY created_at ASC`
        );
        schools = res.rows;
      } catch {}
    }
    if (schools.length === 0) {
      schools = cacheDb
        .prepare(`SELECT id FROM schools WHERE UPPER(COALESCE(status, 'TRIAL')) != 'CANCELLED' ORDER BY created_at ASC`)
        .all() as Array<{ id: string }>;
    }

    for (const sch of schools) {
      await assignMissingStaffCodesForSchool(sch.id);
    }
  } catch (err: any) {
    console.warn('[Backfill Staff Codes Notice]', err?.message);
  }
}
