import { cacheDb, getPgPool, queryPg } from './db.ts';

const SKIP_ACRONYM_WORDS = new Set(['of', 'the', 'and', 'for', 'in', 'at', 'by', 'to', '&']);

/**
 * Computes a clean 3-4 uppercase character institutional code from a Nigerian school name.
 * Examples:
 * - "Brightstar Model College" -> "BMC"
 * - "Government Secondary School Ikeja" -> "GSSI"
 * - "Horizon Academy" -> "HAC"
 * - "Crown Heights" -> "CRH"
 */
export function computeSchoolPrefix(schoolName?: string | null, schoolSlug?: string | null): string {
  const cleanName = String(schoolName || '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim();
  const words = cleanName
    .split(/\s+/)
    .filter((w) => w.length > 0 && !SKIP_ACRONYM_WORDS.has(w.toLowerCase()));

  let prefix = '';
  if (words.length >= 3) {
    prefix = words
      .slice(0, 4)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  } else if (words.length === 2) {
    const w1 = words[0].toUpperCase();
    const w2 = words[1].toUpperCase();
    prefix = (w1.slice(0, 2) + w2[0]).slice(0, 4);
  } else if (words.length === 1) {
    prefix = words[0].toUpperCase().slice(0, 3);
  }

  if (prefix.length < 2 && schoolSlug) {
    prefix = String(schoolSlug)
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 3);
  }

  return prefix || 'SCH';
}

/**
 * Computes the active Nigerian academic session & term from a given date.
 * Nigerian school calendar runs September -> August across 3 terms:
 * - Sep - Dec: First Term (e.g., 2026/2027, 1st Term)
 * - Jan - Apr: Second Term (e.g., 2025/2026, 2nd Term)
 * - May - Aug: Third Term (e.g., 2025/2026, 3rd Term)
 */
export function getCurrentNigerianCalendar(date = new Date()): {
  sessionName: string;
  termShort: '1st Term' | '2nd Term' | '3rd Term';
  termDisplay: 'First Term' | 'Second Term' | 'Third Term';
  sessionStartDate: string;
  sessionEndDate: string;
  admissionYear: number;
} {
  const month = date.getUTCMonth() + 1; // 1..12
  const year = date.getUTCFullYear();
  const startYear = month >= 9 ? year : year - 1;
  const endYear = startYear + 1;
  const sessionName = `${startYear}/${endYear}`;

  let termShort: '1st Term' | '2nd Term' | '3rd Term' = '1st Term';
  let termDisplay: 'First Term' | 'Second Term' | 'Third Term' = 'First Term';
  if (month >= 1 && month <= 4) {
    termShort = '2nd Term';
    termDisplay = 'Second Term';
  } else if (month >= 5 && month <= 8) {
    termShort = '3rd Term';
    termDisplay = 'Third Term';
  }

  return {
    sessionName,
    termShort,
    termDisplay,
    sessionStartDate: `${startYear}-09-01`,
    sessionEndDate: `${endYear}-07-31`,
    admissionYear: year,
  };
}

export interface BatchAdmissionAllocator {
  prefix: string;
  year: number;
  allocateNext: () => string;
}

/**
 * Loads all existing admission numbers for a school (from both PG and SQLite cache)
 * and returns a sequential collision-free allocator formatted as `<PREFIX>/<YEAR>/<0001>`.
 */
export async function createBatchAdmissionAllocator(
  schoolId: string,
  schoolName?: string | null,
  schoolSlug?: string | null,
  year = new Date().getUTCFullYear()
): Promise<BatchAdmissionAllocator> {
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
      const sRow = cacheDb.prepare('SELECT name, slug FROM schools WHERE id = ? LIMIT 1').get(schoolId) as any;
      if (sRow) {
        resolvedName = sRow.name || '';
        resolvedSlug = resolvedSlug || sRow.slug || '';
      }
    }
  }

  const prefix = computeSchoolPrefix(resolvedName, resolvedSlug);
  const existingSet = new Set<string>();
  const existingRaw: string[] = [];

  if (pool) {
    try {
      const pgRes = await queryPg(
        'SELECT admission_number FROM students WHERE school_id = $1 AND admission_number IS NOT NULL',
        [schoolId]
      );
      for (const r of pgRes.rows) {
        const val = String(r.admission_number || '').trim();
        if (val) {
          existingSet.add(val.toLowerCase());
          existingRaw.push(val);
        }
      }
    } catch {}
  }

  try {
    const localRows = cacheDb
      .prepare('SELECT admission_number FROM students WHERE school_id = ? AND admission_number IS NOT NULL')
      .all(schoolId) as any[];
    for (const r of localRows) {
      const val = String(r.admission_number || '').trim();
      if (val) {
        existingSet.add(val.toLowerCase());
        existingRaw.push(val);
      }
    }
  } catch {}

  const patternPrefix = `${prefix}/${year}/`.toLowerCase();
  let maxSeq = 0;
  for (const adm of existingRaw) {
    const lower = adm.toLowerCase();
    if (lower.startsWith(patternPrefix)) {
      const suffixDigits = adm.slice(patternPrefix.length).match(/^\d+/);
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
    // Guard against gaps or manually entered codes matching our generated pattern
    while (true) {
      nextSeq += 1;
      const candidate = `${prefix}/${year}/${String(nextSeq).padStart(4, '0')}`;
      if (!existingSet.has(candidate.toLowerCase())) {
        existingSet.add(candidate.toLowerCase());
        return candidate;
      }
    }
  };

  return { prefix, year, allocateNext };
}

/**
 * Generates a single next unique Admission Number for a student in the given school.
 */
export async function generateNextAdmissionNumber(schoolId: string): Promise<string> {
  const allocator = await createBatchAdmissionAllocator(schoolId);
  return allocator.allocateNext();
}

/**
 * Assigns Nigerian-format Admission Numbers to all active/non-deleted students in a school
 * whose `admission_number` is currently NULL or blank.
 */
export async function assignMissingAdmissionNumbersForSchool(schoolId: string): Promise<{
  assignedCount: number;
  prefix: string;
  students: Array<{ id: string; full_name: string; admission_number: string; class_name: string | null }>;
}> {
  const pool = getPgPool();
  let missingRows: any[] = [];

  if (pool) {
    try {
      const res = await queryPg(
        `SELECT id, first_name, middle_name, last_name, full_name, class_name, admission_number
         FROM students
         WHERE school_id = $1
           AND (admission_number IS NULL OR TRIM(admission_number) = '')
           AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY created_at ASC, id ASC`,
        [schoolId]
      );
      missingRows = res.rows;
    } catch {}
  }

  if (missingRows.length === 0) {
    missingRows = cacheDb
      .prepare(
        `SELECT id, first_name, middle_name, last_name, full_name, class_name, admission_number
         FROM students
         WHERE school_id = ?
           AND (admission_number IS NULL OR TRIM(admission_number) = '')
           AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY created_at ASC, id ASC`
      )
      .all(schoolId) as any[];
  }

  const allocator = await createBatchAdmissionAllocator(schoolId);
  const updatedList: Array<{ id: string; full_name: string; admission_number: string; class_name: string | null }> = [];

  for (const stu of missingRows) {
    const newAdm = allocator.allocateNext();
    if (pool) {
      await queryPg(
        'UPDATE students SET admission_number = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND school_id = $3',
        [newAdm, stu.id, schoolId]
      );
    }
    try {
      cacheDb
        .prepare('UPDATE students SET admission_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?')
        .run(newAdm, stu.id, schoolId);
    } catch {}

    const fullName =
      String(stu.full_name || '').trim() ||
      [stu.first_name, stu.middle_name, stu.last_name].filter(Boolean).join(' ') ||
      'Student';
    updatedList.push({
      id: stu.id,
      full_name: fullName,
      admission_number: newAdm,
      class_name: stu.class_name || null,
    });
  }

  return {
    assignedCount: updatedList.length,
    prefix: allocator.prefix,
    students: updatedList,
  };
}
