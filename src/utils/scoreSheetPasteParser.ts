/**
 * Smart Score Sheet Paste Parser for Scale Grading
 * Parses tab-separated (Excel/Google Sheets), CSV, pipe, or semicolon pastes
 * and matches rows against the active course roster by Admission/Matric No or Full Name.
 * Automatically ignores S/N columns and header rows.
 */

export interface RosterMatchCandidate {
  id: string;
  admission_number?: string | null;
  full_name: string;
  class_arm_name?: string | null;
}

export interface ParsedScoreRow {
  rowNumber: number;
  rawIdentifier: string;
  matchedStudentId: string | null;
  matchedStudentName: string | null;
  matchedAdmissionNumber: string | null;
  ca_score: string;
  exam_score: string;
  subject_remark: string;
  error?: string;
}

export interface ParsedScoreSheetResult {
  rows: ParsedScoreRow[];
  matchedCount: number;
  unmatchedCount: number;
  errorCount: number;
  skippedHeader: boolean;
  strippedSerial: boolean;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  if (delimiter !== ',') {
    return line.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, '').trim());
  }
  const out: string[] = [];
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
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 5);
  if (sample.some((l) => l.includes('\t'))) return '\t';
  if (sample.some((l) => l.includes('|'))) return '|';
  if (sample.some((l) => l.includes(';'))) return ';';
  return ',';
}

function isSerialToken(val: string): boolean {
  return /^\d{1,4}\.?$/.test(val.trim());
}

function isHeaderRow(cols: string[]): boolean {
  const joined = cols.join(' ').toLowerCase();
  const hits = [
    /\bs\/?n\b|serial/,
    /matric|admission|reg\s*no|student\s*id/,
    /student|learner|name/,
    /\bca\b|continuous|test|score|exam|total|remark/,
  ].filter((re) => re.test(joined)).length;
  return hits >= 2;
}

function normalizeKey(val: string): string {
  return val.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseNumericScore(raw: string): number | null {
  const clean = raw.trim();
  if (!clean || clean === '-' || clean === '—' || /^n\/a$/i.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : NaN;
}

export function parseScoreSheetPaste(
  rawText: string,
  roster: RosterMatchCandidate[],
  caMax: number,
  examMax: number
): ParsedScoreSheetResult {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], matchedCount: 0, unmatchedCount: 0, errorCount: 0, skippedHeader: false, strippedSerial: false };
  }

  const delimiter = detectDelimiter(lines);
  const byAdmission = new Map<string, RosterMatchCandidate>();
  const byName = new Map<string, RosterMatchCandidate>();
  for (const st of roster) {
    if (st.admission_number) {
      byAdmission.set(normalizeKey(st.admission_number), st);
    }
    if (st.full_name) {
      byName.set(normalizeKey(st.full_name), st);
    }
  }

  let skippedHeader = false;
  let strippedSerial = false;
  let startIndex = 0;

  let colMap: {
    admission?: number;
    name?: number;
    ca?: number;
    exam?: number;
    remark?: number;
    serial?: number;
  } | null = null;

  const firstCols = splitCsvLine(lines[0], delimiter);
  if (isHeaderRow(firstCols)) {
    skippedHeader = true;
    startIndex = 1;
    colMap = {};
    firstCols.forEach((h, idx) => {
      const low = h.toLowerCase().trim();
      if (/^(s\/?n|sn|no\.?|#)$/.test(low) || low.includes('serial')) colMap!.serial = idx;
      else if (/matric|admission|reg\s*no|student\s*id/.test(low)) colMap!.admission = idx;
      else if (/name|student|learner/.test(low)) colMap!.name = idx;
      else if (/\bca\b|continuous|test|assignment/.test(low)) colMap!.ca = idx;
      else if (/\bexam\b|final|theory/.test(low)) colMap!.exam = idx;
      else if (/remark|comment|note/.test(low)) colMap!.remark = idx;
    });
    if (colMap.serial !== undefined) strippedSerial = true;
  }

  const rows: ParsedScoreRow[] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;
  let errorCount = 0;

  for (let i = startIndex; i < lines.length; i++) {
    const rawCols = splitCsvLine(lines[i], delimiter);
    if (rawCols.length === 0 || rawCols.every((c) => !c)) continue;

    let admToken = '';
    let nameToken = '';
    let caToken = '';
    let examToken = '';
    let remarkToken = '';

    if (colMap && (colMap.ca !== undefined || colMap.exam !== undefined)) {
      admToken = colMap.admission !== undefined ? rawCols[colMap.admission] || '' : '';
      nameToken = colMap.name !== undefined ? rawCols[colMap.name] || '' : '';
      caToken = colMap.ca !== undefined ? rawCols[colMap.ca] || '' : '';
      examToken = colMap.exam !== undefined ? rawCols[colMap.exam] || '' : '';
      remarkToken = colMap.remark !== undefined ? rawCols[colMap.remark] || '' : '';
    } else {
      let cols = [...rawCols];
      // Strip leading S/N column if present (e.g., "1 | PHU/2026/001 | Amaka Nwosu | 25 | 55")
      if (cols.length >= 4 && isSerialToken(cols[0]) && !byAdmission.has(normalizeKey(cols[0]))) {
        cols = cols.slice(1);
        strippedSerial = true;
      }

      // Find the numeric score columns from the right/middle
      // Supported common layouts:
      // 1) MatricNo, FullName, Department, CA, Exam, [Remark]
      // 2) MatricNo, FullName, CA, Exam, [Remark]
      // 3) MatricNo OR FullName, CA, Exam, [Remark]
      let firstScoreIdx = -1;
      for (let c = 1; c < cols.length; c++) {
        const val = parseNumericScore(cols[c]);
        if (val !== null && !Number.isNaN(val)) {
          firstScoreIdx = c;
          break;
        }
      }

      if (firstScoreIdx >= 1) {
        const idParts = cols.slice(0, firstScoreIdx);
        // Check which identifier part matches admission vs name
        for (const p of idParts) {
          if (!admToken && byAdmission.has(normalizeKey(p))) {
            admToken = p;
          } else if (!nameToken && byName.has(normalizeKey(p))) {
            nameToken = p;
          }
        }
        if (!admToken && !nameToken) {
          admToken = idParts[0] || '';
          nameToken = idParts[1] || '';
        }
        caToken = cols[firstScoreIdx] || '';
        examToken = cols[firstScoreIdx + 1] || '';
        remarkToken = cols[firstScoreIdx + 2] || '';
      } else {
        admToken = cols[0] || '';
        caToken = cols[1] || '';
        examToken = cols[2] || '';
        remarkToken = cols[3] || '';
      }
    }

    // Resolve student match (exact admission -> exact name -> fuzzy partial name)
    let matched: RosterMatchCandidate | undefined;
    if (admToken) matched = byAdmission.get(normalizeKey(admToken)) || byName.get(normalizeKey(admToken));
    if (!matched && nameToken) matched = byName.get(normalizeKey(nameToken)) || byAdmission.get(normalizeKey(nameToken));
    if (!matched && (nameToken || admToken)) {
      const needle = normalizeKey(nameToken || admToken);
      if (needle.length >= 4) {
        const partials = roster.filter(
          (st) =>
            normalizeKey(st.full_name).includes(needle) ||
            (st.admission_number && normalizeKey(st.admission_number).includes(needle))
        );
        if (partials.length === 1) matched = partials[0];
      }
    }

    const caNum = parseNumericScore(caToken);
    const examNum = parseNumericScore(examToken);
    let error: string | undefined;

    if (!matched) {
      error = `Student "${[admToken, nameToken].filter(Boolean).join(' / ')}" not found in current roster.`;
    } else if (caNum !== null && Number.isNaN(caNum)) {
      error = `Invalid CA value "${caToken}".`;
    } else if (examNum !== null && Number.isNaN(examNum)) {
      error = `Invalid Exam value "${examToken}".`;
    } else if (caNum !== null && (caNum < 0 || caNum > caMax)) {
      error = `CA score ${caNum} exceeds max (${caMax}).`;
    } else if (examNum !== null && (examNum < 0 || examNum > examMax)) {
      error = `Exam score ${examNum} exceeds max (${examMax}).`;
    } else if (caNum === null && examNum === null) {
      error = 'Both CA and Exam scores are empty.';
    }

    if (matched && !error) matchedCount += 1;
    else if (!matched) unmatchedCount += 1;
    else errorCount += 1;

    rows.push({
      rowNumber: i + 1,
      rawIdentifier: [admToken, nameToken].filter(Boolean).join(' · ') || `Row ${i + 1}`,
      matchedStudentId: matched?.id || null,
      matchedStudentName: matched?.full_name || null,
      matchedAdmissionNumber: matched?.admission_number || null,
      ca_score: caNum !== null && !Number.isNaN(caNum) ? String(caNum) : '',
      exam_score: examNum !== null && !Number.isNaN(examNum) ? String(examNum) : '',
      subject_remark: remarkToken.trim().slice(0, 200),
      error,
    });
  }

  return { rows, matchedCount, unmatchedCount, errorCount, skippedHeader, strippedSerial };
}
