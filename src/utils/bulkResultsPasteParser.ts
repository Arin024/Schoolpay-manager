/**
 * Universal Bulk Results Paste & CSV Parser
 * Works across Primary, Secondary, and Tertiary schools for BOTH:
 *  1. Wide Class Broadsheet Matrix format:
 *     (Optional S/N) | Admission/Matric No | (Optional Student Name) | Subject 1 | Subject 2 | ...
 *     Each cell can be a total score (e.g. "78") OR "CA/Exam" (e.g. "28/50" or "28+50").
 *     Subject headers can include code & credit units e.g. "FHC 111 (3u)" or "Mathematics" or "MTH - Mathematics (4u)".
 *  2. Long Row-by-Row Multi-Term / Multi-Year CSV/TSV format:
 *     (Optional S/N) | Admission No | Session | Term/Semester | Class | Subject Code | Subject Name | Units | CA | Exam | Total | (Optional Department)
 */

export interface ParsedBulkResultRow {
  admission_number: string;
  student_name?: string;
  session_name: string;
  term_name: string;
  class_name: string;
  department?: string;
  subject_code: string;
  subject_name: string;
  credit_units: string;
  ca_score: string;
  exam_score: string;
  total_score: string;
}

export interface BroadsheetParseResult {
  rows: ParsedBulkResultRow[];
  detectedSubjects: Array<{ code: string; name: string; credit_units: number }>;
  studentRowsCount: number;
  skippedSummaryCols: string[];
  error?: string;
}

/**
 * Splits a CSV or TSV line respecting quoted strings (e.g. "Intro, Part 1").
 */
export function splitSpreadsheetLine(line: string): string[] {
  if (line.includes('\t')) {
    return line.split('\t').map((c) => c.trim().replace(/^"|"$/g, ''));
  }
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

const SUMMARY_COL_RE =
  /^(total|grand\s*total|sum|average|avg|mean|percentage|%|position|pos|rank|grade|gpa|cgpa|remark|remarks|comment|comments|status|standing|units|tcu|tcp|tgp)$/i;

const SERIAL_COL_RE = /^(s\/?n|sn|s\.n\.?|no\.?|#|serial)$/i;
const ID_COL_RE = /^(admission|adm|matric|reg|student[\s_]*id|pupil[\s_]*id|id[\s_]*no)/i;
const NAME_COL_RE = /^(student[\s_]*name|pupil[\s_]*name|learner[\s_]*name|full[\s_]*name|name)$/i;

/**
 * Parses a subject header like "FHC 111 - Maternal Care (3u)", "CSC101 (3)", or "Mathematics".
 */
export function parseSubjectColumnHeader(
  rawHeader: string,
  knownSubjects: Array<{ code?: string | null; name: string; credit_units?: number | null }> = []
): { code: string; name: string; credit_units: number } {
  let clean = rawHeader.trim();
  let explicitUnits: number | null = null;

  // Extract trailing credit unit annotations like "(3u)", "(2 units)", "[4u]", "(3)"
  const unitMatch = clean.match(/[\(\[]\s*(\d{1,2})\s*(?:u|cu|unit|units|cr|credits?)?\s*[\)\]]\s*$/i);
  if (unitMatch) {
    const parsedU = Number(unitMatch[1]);
    if (Number.isFinite(parsedU) && parsedU >= 0 && parsedU <= 12) {
      explicitUnits = parsedU;
      clean = clean.slice(0, unitMatch.index).trim();
    }
  }

  // Try matching directly against school's known subjects catalog
  const lowerClean = clean.toLowerCase();
  const directKnown = knownSubjects.find(
    (s) =>
      s.name.trim().toLowerCase() === lowerClean ||
      (s.code && s.code.trim().toLowerCase() === lowerClean)
  );
  if (directKnown) {
    return {
      code: (directKnown.code || '').trim().toUpperCase(),
      name: directKnown.name.trim(),
      credit_units: explicitUnits ?? Number(directKnown.credit_units ?? 3),
    };
  }

  // Split "CODE - Title" or "CODE: Title"
  const sepMatch = clean.match(/^([A-Za-z]{2,6}\s*\d{2,4}[A-Za-z]?)\s*[-:|]\s*(.+)$/);
  if (sepMatch) {
    const code = sepMatch[1].trim().toUpperCase();
    const title = sepMatch[2].trim();
    const byCode = knownSubjects.find((s) => (s.code || '').trim().toUpperCase() === code);
    return {
      code,
      name: title || byCode?.name || code,
      credit_units: explicitUnits ?? Number(byCode?.credit_units ?? 3),
    };
  }

  // Pure course code e.g. "FHC 111" or "CSC101"
  if (/^[A-Za-z]{2,6}\s*\d{2,4}[A-Za-z]?$/.test(clean)) {
    const code = clean.toUpperCase();
    const byCode = knownSubjects.find((s) => (s.code || '').trim().toUpperCase() === code);
    return {
      code,
      name: byCode?.name || code,
      credit_units: explicitUnits ?? Number(byCode?.credit_units ?? 3),
    };
  }

  // Plain subject title (e.g. "Mathematics", "Basic Science", "English Studies")
  const words = clean.split(/\s+/).filter(Boolean);
  const autoCode =
    words.length >= 2
      ? (words[0].slice(0, 3) + words[1].slice(0, 2)).toUpperCase()
      : clean.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase() || 'SUB';

  return {
    code: autoCode,
    name: clean,
    credit_units: explicitUnits ?? 3,
  };
}

/**
 * Parses a Class Broadsheet Matrix pasted from Excel / Google Sheets / CSV into normalized rows
 * ready for the bulk results preview/import API.
 */
export function parseClassBroadsheetMatrix(
  rawText: string,
  context: {
    sessionName: string;
    termName: string;
    className: string;
    department?: string;
    knownSubjects?: Array<{ code?: string | null; name: string; credit_units?: number | null }>;
  }
): BroadsheetParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      rows: [],
      detectedSubjects: [],
      studentRowsCount: 0,
      skippedSummaryCols: [],
      error: 'Paste a header row (with student ID & subject/course names) plus at least one student score row.',
    };
  }

  const headerCols = splitSpreadsheetLine(lines[0]);
  if (headerCols.length < 2) {
    return {
      rows: [],
      detectedSubjects: [],
      studentRowsCount: 0,
      skippedSummaryCols: [],
      error: 'Could not detect multiple columns. Separate columns with tabs (Excel) or commas (CSV).',
    };
  }

  let serialColIdx = -1;
  let idColIdx = -1;
  let nameColIdx = -1;

  headerCols.forEach((col, idx) => {
    const c = col.trim();
    if (serialColIdx === -1 && SERIAL_COL_RE.test(c)) {
      serialColIdx = idx;
    } else if (idColIdx === -1 && ID_COL_RE.test(c)) {
      idColIdx = idx;
    } else if (nameColIdx === -1 && NAME_COL_RE.test(c)) {
      nameColIdx = idx;
    }
  });

  // Fallback if user didn't label the ID column explicitly: first non-serial column is ID/Name
  if (idColIdx === -1 && nameColIdx === -1) {
    idColIdx = serialColIdx === 0 ? 1 : 0;
  }

  const subjectColumns: Array<{ colIdx: number; code: string; name: string; credit_units: number }> = [];
  const skippedSummaryCols: string[] = [];

  headerCols.forEach((col, idx) => {
    if (idx === serialColIdx || idx === idColIdx || idx === nameColIdx) return;
    const trimmed = col.trim();
    if (!trimmed) return;
    if (SUMMARY_COL_RE.test(trimmed)) {
      skippedSummaryCols.push(trimmed);
      return;
    }
    const parsedSub = parseSubjectColumnHeader(trimmed, context.knownSubjects || []);
    subjectColumns.push({ colIdx: idx, ...parsedSub });
  });

  if (subjectColumns.length === 0) {
    return {
      rows: [],
      detectedSubjects: [],
      studentRowsCount: 0,
      skippedSummaryCols,
      error: 'No subject/course score columns were found in the header row.',
    };
  }

  const rows: ParsedBulkResultRow[] = [];
  let studentRowsCount = 0;

  for (let rIdx = 1; rIdx < lines.length; rIdx++) {
    const cols = splitSpreadsheetLine(lines[rIdx]);
    const rawId = idColIdx >= 0 ? (cols[idColIdx] || '').trim() : '';
    const rawName = nameColIdx >= 0 ? (cols[nameColIdx] || '').trim() : '';
    const identifier = rawId || rawName;
    if (!identifier) continue;

    let addedForStudent = false;
    for (const sub of subjectColumns) {
      const cell = (cols[sub.colIdx] || '').trim();
      if (!cell || cell === '-' || cell === '—' || cell.toUpperCase() === 'N/A' || cell.toUpperCase() === 'ABS') {
        continue;
      }

      // Support "CA/Exam" or "CA+Exam" inside a single matrix cell, or plain numeric total score
      let ca = '';
      let exam = '';
      let total = '';
      const splitMatch = cell.match(/^(\d+(?:\.\d+)?)\s*[\/+]\s*(\d+(?:\.\d+)?)$/);
      if (splitMatch) {
        ca = splitMatch[1];
        exam = splitMatch[2];
        total = String(Math.round((Number(ca) + Number(exam)) * 100) / 100);
      } else {
        const cleanedNum = cell.replace(/%$/, '').trim();
        if (!/^\d+(?:\.\d+)?$/.test(cleanedNum)) continue;
        total = cleanedNum;
      }

      rows.push({
        admission_number: rawId || rawName,
        student_name: rawName || undefined,
        session_name: context.sessionName.trim(),
        term_name: context.termName.trim(),
        class_name: context.className.trim(),
        department: context.department?.trim() || '',
        subject_code: sub.code,
        subject_name: sub.name,
        credit_units: String(sub.credit_units),
        ca_score: ca,
        exam_score: exam,
        total_score: total,
      });
      addedForStudent = true;
    }

    if (addedForStudent) studentRowsCount += 1;
  }

  if (rows.length === 0) {
    return {
      rows: [],
      detectedSubjects: subjectColumns.map(({ code, name, credit_units }) => ({ code, name, credit_units })),
      studentRowsCount: 0,
      skippedSummaryCols,
      error: 'No numeric scores were found under the subject/course columns. Enter numbers like 78 or CA/Exam like 28/50.',
    };
  }

  return {
    rows,
    detectedSubjects: subjectColumns.map(({ code, name, credit_units }) => ({ code, name, credit_units })),
    studentRowsCount,
    skippedSummaryCols,
  };
}

/**
 * Parses Long Multi-Term / Multi-Year CSV or Excel TSV rows.
 * Automatically skips header rows and strips optional leading S/N column.
 */
export function parseLongBulkResultsCsv(rawText: string): {
  rows: ParsedBulkResultRow[];
  error?: string;
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], error: 'Paste or upload at least one CSV/Excel row.' };
  }

  let hasLeadingSerial = false;
  let startIdx = 0;

  const firstCols = splitSpreadsheetLine(lines[0]);
  const firstRowJoined = firstCols.join(' ');
  const isHeaderRow =
    (/admission|matric|student|pupil|s\/?n|serial/i.test(firstCols[0] || '') &&
      /session|term|semester|class|level|subject|course/i.test(firstRowJoined)) ||
    (SERIAL_COL_RE.test(firstCols[0] || '') && /admission|matric|student/i.test(firstCols[1] || ''));

  if (isHeaderRow) {
    hasLeadingSerial = SERIAL_COL_RE.test(firstCols[0] || '');
    startIdx = 1;
  } else if (
    firstCols.length >= 6 &&
    /^\d{1,4}$/.test(firstCols[0] || '') &&
    /(19|20)\d{2}\s*[\/-]\s*(19|20)\d{2}/.test(firstCols[2] || '')
  ) {
    hasLeadingSerial = true;
  }

  const parsed: ParsedBulkResultRow[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    let cols = splitSpreadsheetLine(lines[i]);
    if (hasLeadingSerial) cols = cols.slice(1);
    if (cols.length < 5) continue;

    parsed.push({
      admission_number: cols[0] || '',
      session_name: cols[1] || '',
      term_name: cols[2] || '',
      class_name: cols[3] || '',
      subject_code: (cols[4] || '').toUpperCase(),
      subject_name: cols[5] || cols[4] || '',
      credit_units: cols[6] || '3',
      ca_score: cols[7] || '',
      exam_score: cols[8] || '',
      total_score: cols[9] || '',
      department: cols[10] || '',
    });
  }

  if (parsed.length === 0) {
    return {
      rows: [],
      error:
        'No valid rows detected. Use columns: admission_number, session_name, term_name, class_name, subject_code, subject_name, credit_units, ca_score, exam_score, total_score.',
    };
  }

  return { rows: parsed };
}
