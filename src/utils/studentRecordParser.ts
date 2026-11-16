export interface ParsedStudentRecord {
  id: string;
  admission_number: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  gender: 'Male' | 'Female' | '';
  class_name: string;
  class_level: string;
  class_arm_name: string;
  phone: string;
  email: string;
}

export const NIGERIAN_LEVEL_OPTIONS = [
  'Early Years / Nursery',
  'Primary',
  'Junior Secondary',
  'Senior Secondary',
  'General',
];

export function inferNigerianLevel(className?: string | null, fallbackLevel?: string | null): string {
  const fb = String(fallbackLevel || '').trim();
  if (fb && !['general', 'other', ''].includes(fb.toLowerCase())) return fb;
  const lower = String(className || '').toLowerCase();
  if (!lower) return 'Unassigned';
  if (/creche|playgroup|kg|kindergarten|nursery|early|reception|pre[-\s]?(?:nursery|school)/i.test(lower)) {
    return 'Early Years / Nursery';
  }
  if (/primary|pry|pri\s*\d|basic\s*[1-6]\b/i.test(lower)) {
    return 'Primary';
  }
  if (/jss?|junior\s*sec|basic\s*[7-9]\b/i.test(lower)) {
    return 'Junior Secondary';
  }
  if (/sss?|senior\s*sec/i.test(lower)) {
    return 'Senior Secondary';
  }
  return 'General';
}

export function normalizeNigerianClassName(raw?: string | null): string {
  const trimmed = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const mJss = trimmed.match(/^(?:jss?|junior\s*sec(?:ondary)?)\s*([1-3])$/i);
  if (mJss) return `JSS ${mJss[1]}`;
  const mSss = trimmed.match(/^(?:sss?|senior\s*sec(?:ondary)?)\s*([1-3])$/i);
  if (mSss) return `SSS ${mSss[1]}`;
  const mPry = trimmed.match(/^(?:pry|pri|primary)\s*([1-6])$/i);
  if (mPry) return `Primary ${mPry[1]}`;
  const mNur = trimmed.match(/^(?:nur|nursery)\s*([1-3])$/i);
  if (mNur) return `Nursery ${mNur[1]}`;
  return trimmed;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map((v) => v.replace(/^["']|["']$/g, '').trim());
  }
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && (i === 0 || line[i - 1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.replace(/^["']|["']$/g, '').trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.replace(/^["']|["']$/g, '').trim());
  return result;
}

function detectGenderToken(token: string): 'Male' | 'Female' | '' {
  const t = token.trim().toLowerCase();
  if (['m', 'male', 'boy', 'boys'].includes(t)) return 'Male';
  if (['f', 'female', 'girl', 'girls'].includes(t)) return 'Female';
  return '';
}

function extractClassAndArmFromToken(token: string): { class_name: string; class_arm_name: string } | null {
  const clean = token.trim().replace(/\s+/g, ' ');
  const m = clean.match(
    /\b((?:jss?|sss?|js|ss|pry|pri|primary|nursery|nur|kg|kindergarten|creche|playgroup|basic)\s*[1-9]?)\b(?:\s+(gold|silver|diamond|emerald|ruby|platinum|science|art|arts|commercial|com|alpha|beta|blue|green|red|yellow|[a-f]))?$/i
  );
  if (!m) return null;
  const classPart = normalizeNigerianClassName(m[1]);
  // Avoid matching random single words unless they matched an explicit class prefix
  if (!classPart) return null;
  const armPart = m[2] ? m[2].charAt(0).toUpperCase() + m[2].slice(1) : '';
  return { class_name: classPart, class_arm_name: armPart };
}

function splitFullName(fullName: string): { first_name: string; middle_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', middle_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0], middle_name: '', last_name: parts[0] };
  if (parts.length === 2) return { first_name: parts[0], middle_name: '', last_name: parts[1] };
  return {
    first_name: parts[0],
    middle_name: parts.slice(1, -1).join(' '),
    last_name: parts[parts.length - 1],
  };
}

const KNOWN_HEADER_KEYS = new Set([
  'first_name', 'firstname', 'first', 'last_name', 'lastname', 'surname', 'last',
  'middle_name', 'middlename', 'other_name', 'full_name', 'student_name', 'name',
  'admission_number', 'admission_no', 'adm_no', 'reg_no', 'student_id', 'admission_id',
  'gender', 'sex', 'class', 'class_name', 'grade', 'level', 'class_level',
  'arm', 'class_arm', 'class_arm_name', 'stream', 'section', 'phone', 'parent_phone',
  'phone_number', 'mobile', 'email', 'parent_email',
]);

/**
 * Smart multi-format parser for Nigerian school student lists:
 * Supports CSV with headers, Excel/Google Sheets TSV paste, semicolon files,
 * headerless CSV/pipe/dash lines, and WhatsApp/Word numbered student lists.
 */
export function parseBulkStudentInput(rawText: string): ParsedStudentRecord[] {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t')
    ? '\t'
    : firstLine.includes(';')
      ? ';'
      : firstLine.includes('|')
        ? '|'
        : firstLine.includes(',')
          ? ','
          : '';

  // Detect if first line is a structured header row
  const firstTokens = delimiter ? splitDelimitedLine(firstLine, delimiter) : [];
  const normalizedHeaders = firstTokens.map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const hasHeader = normalizedHeaders.filter((h) => KNOWN_HEADER_KEYS.has(h)).length >= 2;

  const rows: ParsedStudentRecord[] = [];
  const startIdx = hasHeader ? 1 : 0;

  if (hasHeader && delimiter) {
    for (let i = startIdx; i < lines.length; i++) {
      const values = splitDelimitedLine(lines[i], delimiter);
      const rowObj: Record<string, string> = {};
      normalizedHeaders.forEach((h, idx) => {
        rowObj[h] = values[idx] || '';
      });

      const admNum =
        rowObj['admission_no'] ||
        rowObj['admission_number'] ||
        rowObj['adm_no'] ||
        rowObj['reg_no'] ||
        rowObj['student_id'] ||
        rowObj['admission_id'] ||
        '';

      let fn = rowObj['first_name'] || rowObj['firstname'] || rowObj['first'] || '';
      let ln = rowObj['last_name'] || rowObj['lastname'] || rowObj['surname'] || rowObj['last'] || '';
      let mn = rowObj['middle_name'] || rowObj['middlename'] || rowObj['middle'] || rowObj['other_name'] || '';

      const singleFullName = rowObj['student_name'] || rowObj['full_name'] || rowObj['name'] || '';
      if (!fn && !ln && singleFullName) {
        const split = splitFullName(singleFullName);
        fn = split.first_name;
        mn = split.middle_name;
        ln = split.last_name;
      } else if (fn && !ln) {
        ln = fn;
      }

      if (!fn && !ln) continue;

      const rawGender = rowObj['gender'] || rowObj['sex'] || '';
      const genderVal: 'Male' | 'Female' | '' = rawGender
        ? rawGender.toLowerCase().startsWith('f')
          ? 'Female'
          : rawGender.toLowerCase().startsWith('m')
            ? 'Male'
            : ''
        : '';

      const rawClass = rowObj['class_name'] || rowObj['class'] || rowObj['grade'] || '';
      let className = normalizeNigerianClassName(rawClass);
      let armName = rowObj['class_arm_name'] || rowObj['class_arm'] || rowObj['arm'] || rowObj['stream'] || rowObj['section'] || '';

      if (!armName && rawClass) {
        const extracted = extractClassAndArmFromToken(rawClass);
        if (extracted) {
          className = extracted.class_name;
          armName = extracted.class_arm_name;
        }
      }

      const explicitLevel = rowObj['class_level'] || rowObj['level'] || '';
      const classLevel = inferNigerianLevel(className, explicitLevel);
      const phone = rowObj['phone'] || rowObj['parent_phone'] || rowObj['phone_number'] || rowObj['mobile'] || '';
      const email = rowObj['email'] || rowObj['parent_email'] || '';

      rows.push({
        id: `row_${i}_${Math.random().toString(36).slice(2, 7)}`,
        admission_number: admNum,
        first_name: fn,
        middle_name: mn,
        last_name: ln,
        gender: genderVal,
        class_name: className,
        class_level: classLevel,
        class_arm_name: armName,
        phone,
        email,
      });
    }
    return rows;
  }

  // Smart messy-list / headerless mode: handles WhatsApp lists, tab/comma rows without headers, plain names, etc.
  for (let i = 0; i < lines.length; i++) {
    let rawLine = lines[i].replace(/^\s*(?:\d+[\.\)\]]\s*|[-•*]\s+)/, '').trim();
    if (!rawLine) continue;

    // Split by delimiter or dash separators ("Name - Class - Gender")
    const lineDelim = rawLine.includes('\t')
      ? '\t'
      : rawLine.includes('|')
        ? '|'
        : rawLine.includes(';')
          ? ';'
          : rawLine.includes(',')
            ? ','
            : rawLine.includes(' - ')
              ? ' - '
              : rawLine.includes(' – ')
                ? ' – '
                : '';

    const segments = lineDelim
      ? (lineDelim.length > 1 ? rawLine.split(lineDelim).map((s) => s.trim()) : splitDelimitedLine(rawLine, lineDelim))
      : [rawLine];

    let fullNameCandidate = '';
    let genderVal: 'Male' | 'Female' | '' = '';
    let className = '';
    let armName = '';
    let phone = '';
    let email = '';
    let admNum = '';

    for (const seg of segments) {
      if (!seg) continue;
      const g = detectGenderToken(seg);
      if (g) {
        genderVal = g;
        continue;
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(seg)) {
        email = seg;
        continue;
      }
      if (/^(?:\+?234|0)[789]\d{9}$/.test(seg.replace(/[\s-]/g, ''))) {
        phone = seg;
        continue;
      }
      if (/^[A-Z0-9]{2,6}\/\d{2,4}\/\d{2,6}$/i.test(seg)) {
        admNum = seg;
        continue;
      }
      const clsMatch = extractClassAndArmFromToken(seg);
      if (clsMatch && !className && seg.length <= 28) {
        className = clsMatch.class_name;
        if (clsMatch.class_arm_name) armName = clsMatch.class_arm_name;
        continue;
      }
      // If class was already identified, a short 1-word token could be the Arm (e.g. Gold, Science, A)
      if (className && !armName && /^[a-zA-Z0-9]{1,14}$/.test(seg) && !fullNameCandidate.includes(seg)) {
        armName = seg.charAt(0).toUpperCase() + seg.slice(1);
        continue;
      }
      if (!fullNameCandidate) {
        fullNameCandidate = seg;
      } else {
        // E.g. "First, Last" without headers
        fullNameCandidate = `${fullNameCandidate} ${seg}`;
      }
    }

    // Inline extraction fallback if single line has no delimiters (e.g. "Chinedu Okafor SSS 2 Male")
    if (segments.length === 1) {
      let work = rawLine;
      const inlineGender = work.match(/\b(male|female|boy|girl)\b/i);
      if (inlineGender) {
        genderVal = detectGenderToken(inlineGender[1]);
        work = work.replace(inlineGender[0], ' ');
      }
      const inlineCls = extractClassAndArmFromToken(work);
      if (inlineCls) {
        className = inlineCls.class_name;
        armName = inlineCls.class_arm_name;
        work = work
          .replace(
            /\b((?:jss?|sss?|js|ss|pry|pri|primary|nursery|nur|kg|kindergarten|creche|playgroup|basic)\s*[1-9]?)(?:\s+(gold|silver|diamond|emerald|ruby|platinum|science|art|arts|commercial|com|alpha|beta|blue|green|red|yellow|[a-f]))?\b/i,
            ' '
          )
          .trim();
      }
      fullNameCandidate = work.replace(/\s+/g, ' ').trim();
    }

    const { first_name, middle_name, last_name } = splitFullName(fullNameCandidate);
    if (!first_name) continue;

    rows.push({
      id: `row_${i}_${Math.random().toString(36).slice(2, 7)}`,
      admission_number: admNum,
      first_name,
      middle_name,
      last_name,
      gender: genderVal,
      class_name: className,
      class_level: inferNigerianLevel(className),
      class_arm_name: armName,
      phone,
      email,
    });
  }

  return rows;
}
