import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Upload, Sparkles, X, CheckCircle2, AlertCircle, BookOpen } from 'lucide-react';
import { api } from '../../services/api';
import { ClassItem } from '../../types';
import {
  CanonicalSemesterTag,
  formatSemesterTagLabel,
  getSemesterTagOptions,
  normalizeSemesterTag,
} from '../../utils/semesterTag';

interface BulkCourseDraftRow {
  id: string;
  name: string;
  code: string;
  credit_units: string;
  course_type: 'CORE' | 'ELECTIVE' | 'GENERAL';
  class_id: string;
  department: string;
  semester_tag: CanonicalSemesterTag;
}

interface BulkCoursesModalProps {
  classes: ClassItem[];
  isTertiary: boolean;
  subjectLabel: string;
  subjectPlural: string;
  classLabel: string;
  cycleLabel: string;
  cycleLabels?: string[];
  availableDepartments?: string[];
  initialClassId?: string;
  initialSemesterTag?: CanonicalSemesterTag;
  initialDepartment?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const makeEmptyRow = (
  defaultClassId = '',
  defaultSemesterTag: CanonicalSemesterTag = '',
  defaultDepartment = ''
): BulkCourseDraftRow => ({
  id: `row_${Math.random().toString(36).slice(2, 9)}`,
  name: '',
  code: '',
  credit_units: '2',
  course_type: 'CORE',
  class_id: defaultClassId,
  department: defaultDepartment,
  semester_tag: defaultSemesterTag,
});

const CURRICULUM_PRESETS: Record<
  string,
  {
    label: string;
    tertiary: boolean;
    semesterTag?: CanonicalSemesterTag;
    rows: Array<{
      code: string;
      name: string;
      units: number;
      type: 'CORE' | 'ELECTIVE' | 'GENERAL';
      dept?: string;
      sem?: CanonicalSemesterTag;
    }>;
  }
> = {
  uni_100l_sem1: {
    label: 'University 100L — 1st Semester (Computing / Science)',
    tertiary: true,
    semesterTag: '1ST',
    rows: [
      { code: 'GST111', name: 'Communication in English I', units: 2, type: 'GENERAL', dept: 'General Studies', sem: '1ST' },
      { code: 'MTH101', name: 'Elementary Mathematics I', units: 3, type: 'CORE', dept: 'Mathematics', sem: '1ST' },
      { code: 'PHY101', name: 'General Physics I', units: 3, type: 'CORE', dept: 'Physics', sem: '1ST' },
      { code: 'PHY107', name: 'General Physics Practical I', units: 1, type: 'CORE', dept: 'Physics', sem: '1ST' },
      { code: 'COS101', name: 'Introduction to Computing Sciences', units: 3, type: 'CORE', dept: 'Computer Science', sem: '1ST' },
      { code: 'STA111', name: 'Descriptive Statistics', units: 2, type: 'ELECTIVE', dept: 'Statistics', sem: '1ST' },
    ],
  },
  uni_100l_sem2: {
    label: 'University 100L — 2nd Semester (Computing / Science)',
    tertiary: true,
    semesterTag: '2ND',
    rows: [
      { code: 'GST112', name: 'Nigerian Peoples and Culture', units: 2, type: 'GENERAL', dept: 'General Studies', sem: '2ND' },
      { code: 'MTH102', name: 'Elementary Mathematics II', units: 3, type: 'CORE', dept: 'Mathematics', sem: '2ND' },
      { code: 'PHY102', name: 'General Physics II', units: 3, type: 'CORE', dept: 'Physics', sem: '2ND' },
      { code: 'PHY108', name: 'General Physics Practical II', units: 1, type: 'CORE', dept: 'Physics', sem: '2ND' },
      { code: 'COS102', name: 'Problem Solving & Programming', units: 3, type: 'CORE', dept: 'Computer Science', sem: '2ND' },
      { code: 'STA112', name: 'Probability I', units: 2, type: 'ELECTIVE', dept: 'Statistics', sem: '2ND' },
    ],
  },
  health_fhc_100l_sem1: {
    label: 'Health Tech — Family Healthcare (100L · 1st Sem)',
    tertiary: true,
    semesterTag: '1ST',
    rows: [
      { code: 'FHC 111', name: 'Introduction to Family Health Care', units: 2, type: 'CORE', dept: 'Family Healthcare', sem: '1ST' },
      { code: 'FHC 112', name: 'Anatomy and Physiology I', units: 3, type: 'CORE', dept: 'Family Healthcare', sem: '1ST' },
      { code: 'FHC 113', name: 'Maternal and Child Health Nursing', units: 3, type: 'CORE', dept: 'Family Healthcare', sem: '1ST' },
      { code: 'FHC 114', name: 'Nutrition in Family Health', units: 2, type: 'CORE', dept: 'Family Healthcare', sem: '1ST' },
      { code: 'GNS 101', name: 'Use of English I', units: 2, type: 'GENERAL', dept: '', sem: '1ST' },
    ],
  },
  health_chew_100l_sem1: {
    label: 'Health Tech — CHEW (100L · 1st Sem)',
    tertiary: true,
    semesterTag: '1ST',
    rows: [
      { code: 'CHE 111', name: 'Introduction to Community Health', units: 2, type: 'CORE', dept: 'Community Health Extension Workers (CHEW)', sem: '1ST' },
      { code: 'CHE 112', name: 'Anatomy and Physiology I', units: 3, type: 'CORE', dept: 'Community Health Extension Workers (CHEW)', sem: '1ST' },
      { code: 'CHE 113', name: 'Primary Health Care & Standing Orders', units: 3, type: 'CORE', dept: 'Community Health Extension Workers (CHEW)', sem: '1ST' },
      { code: 'CHE 114', name: 'Community Mobilization & Health Education', units: 2, type: 'CORE', dept: 'Community Health Extension Workers (CHEW)', sem: '1ST' },
      { code: 'GNS 101', name: 'Use of English I', units: 2, type: 'GENERAL', dept: '', sem: '1ST' },
    ],
  },
  health_pub_100l_sem1: {
    label: 'Health Tech — Public Health (100L · 1st Sem)',
    tertiary: true,
    semesterTag: '1ST',
    rows: [
      { code: 'PHC 111', name: 'Principles of Public Health & Epidemiology', units: 3, type: 'CORE', dept: 'Public Health', sem: '1ST' },
      { code: 'PHC 112', name: 'Environmental Health & Sanitation', units: 2, type: 'CORE', dept: 'Public Health', sem: '1ST' },
      { code: 'PHC 113', name: 'Biostatistics I', units: 2, type: 'CORE', dept: 'Public Health', sem: '1ST' },
      { code: 'PHC 114', name: 'Disease Surveillance & Control', units: 3, type: 'CORE', dept: 'Public Health', sem: '1ST' },
      { code: 'GNS 101', name: 'Use of English I', units: 2, type: 'GENERAL', dept: '', sem: '1ST' },
    ],
  },
  poly_nd1_sem1: {
    label: 'Polytechnic ND 1 — 1st Semester Core',
    tertiary: true,
    semesterTag: '1ST',
    rows: [
      { code: 'GNS101', name: 'Use of English I', units: 2, type: 'GENERAL', dept: 'General Studies', sem: '1ST' },
      { code: 'GNS111', name: 'Citizenship Education I', units: 2, type: 'GENERAL', dept: 'General Studies', sem: '1ST' },
      { code: 'COM111', name: 'Introduction to Computing', units: 3, type: 'CORE', dept: 'Computer Science', sem: '1ST' },
      { code: 'COM112', name: 'Introduction to Digital Electronics', units: 3, type: 'CORE', dept: 'Computer Science', sem: '1ST' },
      { code: 'MTH111', name: 'Logic and Linear Algebra', units: 2, type: 'CORE', dept: 'Mathematics', sem: '1ST' },
      { code: 'COM115', name: 'Computer Application Packages Lab', units: 1, type: 'CORE', dept: 'Computer Science', sem: '1ST' },
    ],
  },
  sec_sss_sci: {
    label: 'Senior Secondary (SSS) Science Core (All Terms)',
    tertiary: false,
    semesterTag: '',
    rows: [
      { code: 'ENG', name: 'English Language', units: 4, type: 'CORE', dept: 'Languages', sem: '' },
      { code: 'MTH', name: 'Mathematics', units: 4, type: 'CORE', dept: 'Sciences', sem: '' },
      { code: 'PHY', name: 'Physics', units: 3, type: 'CORE', dept: 'Sciences', sem: '' },
      { code: 'CHM', name: 'Chemistry', units: 3, type: 'CORE', dept: 'Sciences', sem: '' },
      { code: 'BIO', name: 'Biology', units: 3, type: 'CORE', dept: 'Sciences', sem: '' },
      { code: 'CIV', name: 'Civic Education', units: 2, type: 'GENERAL', dept: 'Humanities', sem: '' },
      { code: 'ICT', name: 'Data Processing / ICT', units: 2, type: 'ELECTIVE', dept: 'Technology', sem: '' },
    ],
  },
  sec_jss: {
    label: 'Junior Secondary (JSS) Core (All Terms)',
    tertiary: false,
    semesterTag: '',
    rows: [
      { code: 'ENG', name: 'English Studies', units: 4, type: 'CORE', dept: 'Languages', sem: '' },
      { code: 'MTH', name: 'Mathematics', units: 4, type: 'CORE', dept: 'Sciences', sem: '' },
      { code: 'BSC', name: 'Basic Science & Technology', units: 3, type: 'CORE', dept: 'Sciences', sem: '' },
      { code: 'RNV', name: 'Religion & National Values', units: 2, type: 'GENERAL', dept: 'Humanities', sem: '' },
      { code: 'BUS', name: 'Business Studies', units: 2, type: 'CORE', dept: 'Commercial', sem: '' },
      { code: 'CCA', name: 'Cultural & Creative Arts', units: 1, type: 'ELECTIVE', dept: 'Arts', sem: '' },
    ],
  },
  primary_core: {
    label: 'Primary School Core Curriculum (All Terms)',
    tertiary: false,
    semesterTag: '',
    rows: [
      { code: 'ENG', name: 'English Studies', units: 4, type: 'CORE', sem: '' },
      { code: 'MTH', name: 'Mathematics', units: 4, type: 'CORE', sem: '' },
      { code: 'BSC', name: 'Basic Science', units: 3, type: 'CORE', sem: '' },
      { code: 'SOS', name: 'Social Studies & Civic Education', units: 2, type: 'CORE', sem: '' },
      { code: 'VER', name: 'Verbal & Quantitative Reasoning', units: 2, type: 'CORE', sem: '' },
      { code: 'ICT', name: 'Computer Studies', units: 1, type: 'ELECTIVE', sem: '' },
    ],
  },
};

/** Split a single line cleanly across CSV (with quoted commas), Tabs, Pipes, Semicolons, or multi-spaces. */
function splitDelimitedLine(line: string): string[] {
  if (line.includes('\t')) {
    return line.split('\t').map((c) => c.trim().replace(/^"|"$/g, ''));
  }
  if (line.includes('|')) {
    return line
      .replace(/^\|+|\|+$/g, '')
      .split('|')
      .map((c) => c.trim().replace(/^"|"$/g, ''));
  }
  if (line.includes(';')) {
    return line.split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
  }
  if (line.includes(',')) {
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
  // Fallback for Word / PDF table paste separated by 2+ spaces
  if (/\s{2,}/.test(line)) {
    return line.split(/\s{2,}/).map((c) => c.trim());
  }
  return [line.trim()];
}

function isSerialNumberToken(val: string): boolean {
  return /^\d{1,3}[.)]?$/.test(val.trim());
}

function looksLikeCourseCode(val: string): boolean {
  const s = val.trim();
  if (!s || s.length > 16) return false;
  // Matches FHC 111, CSC101, GST 101, BIO107A, MTH-101, ENG, PHY
  return /^[A-Za-z]{2,6}[\s-]?\d{2,4}[A-Za-z]?$/.test(s) || /^[A-Z]{2,5}$/.test(s);
}

function extractCreditUnitsValue(val: string): number | null {
  const s = val.trim();
  if (!s) return null;
  const match = s.match(/^(\d{1,2})(?:\s*(?:u|units?|cu|cr|credits?))?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (Number.isFinite(n) && n >= 0 && n <= 12) return Math.round(n);
  return null;
}

function extractCourseTypeValue(val: string): 'CORE' | 'ELECTIVE' | 'GENERAL' | null {
  const up = val.trim().toUpperCase();
  if (!up) return null;
  if (up === 'C' || up === 'CORE' || up === 'COMPULSORY' || up === 'REQUIRED' || up === 'R') return 'CORE';
  if (up === 'E' || up === 'ELECTIVE' || up === 'OPTIONAL' || up === 'O') return 'ELECTIVE';
  if (up === 'G' || up === 'GENERAL' || up === 'GST' || up === 'GNS') return 'GENERAL';
  return null;
}

function isHeaderRow(cols: string[]): boolean {
  const joined = cols.join(' ').toLowerCase();
  const c0 = (cols[0] || '').toLowerCase().replace(/[^a-z0-9/]/g, '');
  const hasSnCol = ['sn', 's/n', 'no', 'num', 'number', '#'].includes(c0);
  const hasCourseKeyword = /\b(course\s*code|course\s*title|subject|credit\s*unit|units?|code|title|status|semester|term)\b/i.test(joined);
  if (hasSnCol && hasCourseKeyword) return true;
  // Header without S/N: e.g. "Course Code, Course Title, Credit Unit"
  const headerHits = cols.filter((c) =>
    /^(s\/?n|no\.?|#|code|course\s*code|subject\s*code|title|name|course\s*title|subject(\s*name|\s*title)?|unit|units|cu|credit\s*units?|credits?|type|status|category|department|dept|semester|term)$/i.test(
      c.trim()
    )
  ).length;
  return headerHits >= 2;
}

export function parseCurriculumPaste(
  pasteText: string,
  defaultClassId: string,
  defaultSemesterTag: CanonicalSemesterTag
): { rows: BulkCourseDraftRow[]; notice: string | null } {
  const rawLines = pasteText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (rawLines.length === 0) return { rows: [], notice: null };

  const matrix = rawLines.map((line) => splitDelimitedLine(line));

  let startIdx = 0;
  let skippedHeader = false;
  let strippedSerial = false;

  // Header-mapped indices when a header row is present
  let headerMap: {
    snIdx: number;
    codeIdx: number;
    titleIdx: number;
    unitsIdx: number;
    typeIdx: number;
    deptIdx: number;
    semIdx: number;
  } | null = null;

  if (matrix.length > 0 && isHeaderRow(matrix[0])) {
    skippedHeader = true;
    startIdx = 1;
    const hdr = matrix[0].map((h) => h.trim().toLowerCase());
    headerMap = {
      snIdx: hdr.findIndex((h) => /^(s\/?n|s\.n\.?|no\.?|#|serial)/.test(h)),
      codeIdx: hdr.findIndex((h) => /(^|\s)code$/.test(h) || h === 'course code' || h === 'subject code'),
      titleIdx: hdr.findIndex((h) => /(title|name|subject|course)$/.test(h) && !/code/.test(h)),
      unitsIdx: hdr.findIndex((h) => /(unit|credit|\bcu\b|\bcr\b)/.test(h)),
      typeIdx: hdr.findIndex((h) => /(type|status|category|compulsory|elective)/.test(h)),
      deptIdx: hdr.findIndex((h) => /(dept|department|faculty)/.test(h)),
      semIdx: hdr.findIndex((h) => /(semester|term|trimester|cycle)/.test(h)),
    };
  }

  const parsed: BulkCourseDraftRow[] = [];

  for (let i = startIdx; i < matrix.length; i++) {
    let cols = matrix[i].map((c) => c.trim());
    if (cols.every((c) => !c)) continue;
    // Skip repeated header lines or summary/total footer lines (e.g. "Total | | 24")
    if (isHeaderRow(cols)) continue;
    if (/^total\b/i.test(cols[0] || '') || /^total\b/i.test(cols[1] || '')) continue;

    let code = '';
    let name = '';
    let units = '2';
    let type: 'CORE' | 'ELECTIVE' | 'GENERAL' = 'CORE';
    let dept = '';
    let semTag: CanonicalSemesterTag = defaultSemesterTag;

    if (headerMap && (headerMap.codeIdx >= 0 || headerMap.titleIdx >= 0)) {
      if (headerMap.snIdx >= 0) strippedSerial = true;
      if (headerMap.codeIdx >= 0 && cols[headerMap.codeIdx]) {
        code = cols[headerMap.codeIdx].toUpperCase();
      }
      if (headerMap.titleIdx >= 0 && cols[headerMap.titleIdx]) {
        name = cols[headerMap.titleIdx];
      }
      if (headerMap.unitsIdx >= 0 && cols[headerMap.unitsIdx]) {
        const u = extractCreditUnitsValue(cols[headerMap.unitsIdx]);
        if (u !== null) units = String(u);
      }
      if (headerMap.typeIdx >= 0 && cols[headerMap.typeIdx]) {
        const t = extractCourseTypeValue(cols[headerMap.typeIdx]);
        if (t) type = t;
      }
      if (headerMap.deptIdx >= 0 && cols[headerMap.deptIdx]) {
        dept = cols[headerMap.deptIdx];
      }
      if (headerMap.semIdx >= 0 && cols[headerMap.semIdx]) {
        const normalizedSem = normalizeSemesterTag(cols[headerMap.semIdx]);
        if (normalizedSem) semTag = normalizedSem;
      }
      // If table only had Course Code + Unit (no title column), fallback title to code
      if (!name && code) name = code;
    } else {
      // Heuristic mode (no header row)
      // 1. Strip leading S/N column if col 0 is a plain integer/ordinal and col 1 exists
      if (cols.length >= 2 && isSerialNumberToken(cols[0])) {
        cols = cols.slice(1);
        strippedSerial = true;
      }

      // 2. Single-column fallback: check if line is like "FHC 111 - Primary Health Care (2)" or "FHC 111 Primary Health Care 2"
      if (cols.length === 1) {
        const single = cols[0];
        const dashMatch = single.match(/^([A-Za-z]{2,6}\s*\d{2,4}[A-Za-z]?)\s*[-–:]\s*(.+?)(?:\s*\((\d{1,2})\s*(?:u|units?|cu)?\))?$/i);
        if (dashMatch) {
          code = dashMatch[1].toUpperCase();
          name = dashMatch[2].trim();
          if (dashMatch[3]) {
            const u = extractCreditUnitsValue(dashMatch[3]);
            if (u !== null) units = String(u);
          }
        } else {
          const spMatch = single.match(/^([A-Za-z]{2,6}\s*\d{2,4}[A-Za-z]?)\s+(.+?)(?:\s+(\d{1,2}))?$/);
          if (spMatch) {
            code = spMatch[1].toUpperCase();
            name = spMatch[2].trim();
            if (spMatch[3]) {
              const u = extractCreditUnitsValue(spMatch[3]);
              if (u !== null) units = String(u);
            }
          } else {
            name = single;
          }
        }
      } else {
        // Multi-column without header: inspect each column smartly
        let remaining = [...cols];

        // Identify code & title from first two columns
        if (looksLikeCourseCode(remaining[0]) && !looksLikeCourseCode(remaining[1])) {
          const maybeUnitsInCol1 = extractCreditUnitsValue(remaining[1]);
          if (maybeUnitsInCol1 !== null && remaining[2]) {
            // Pattern: CODE | UNITS | TITLE
            code = remaining[0].toUpperCase();
            units = String(maybeUnitsInCol1);
            name = remaining[2];
            remaining = remaining.slice(3);
          } else {
            // Pattern: CODE | TITLE | ...
            code = remaining[0].toUpperCase();
            name = remaining[1];
            remaining = remaining.slice(2);
          }
        } else if (looksLikeCourseCode(remaining[1]) && !looksLikeCourseCode(remaining[0])) {
          // Pattern: TITLE | CODE | ...
          name = remaining[0];
          code = remaining[1].toUpperCase();
          remaining = remaining.slice(2);
        } else {
          // Default: if col0 is short (<= 10 chars) and not purely numeric, treat as code
          if (remaining[0].length <= 10 && !isSerialNumberToken(remaining[0])) {
            code = remaining[0].toUpperCase();
            name = remaining[1];
            remaining = remaining.slice(2);
          } else {
            name = remaining[0];
            remaining = remaining.slice(1);
          }
        }

        // Scan remaining columns for credit units, course type, semester tag, and department
        let unitsAssigned = false;
        let typeAssigned = false;
        for (const token of remaining) {
          if (!token) continue;
          if (!unitsAssigned) {
            const u = extractCreditUnitsValue(token);
            if (u !== null) {
              units = String(u);
              unitsAssigned = true;
              continue;
            }
          }
          if (!typeAssigned) {
            const t = extractCourseTypeValue(token);
            if (t) {
              type = t;
              typeAssigned = true;
              continue;
            }
          }
          const maybeSem = normalizeSemesterTag(token);
          if (maybeSem) {
            semTag = maybeSem;
            continue;
          }
          if (!dept) {
            dept = token;
          }
        }
      }
    }

    if (name) {
      parsed.push({
        id: `row_${Math.random().toString(36).slice(2, 9)}`,
        name: name.slice(0, 200),
        code: code.slice(0, 32),
        credit_units: units,
        course_type: type,
        class_id: defaultClassId,
        department: dept.slice(0, 120),
        semester_tag: semTag,
      });
    }
  }

  const notes: string[] = [];
  if (skippedHeader) notes.push('skipped header row');
  if (strippedSerial) notes.push('ignored S/N column');
  const notice =
    parsed.length > 0
      ? `Parsed ${parsed.length} row(s)${notes.length ? ` (automatically ${notes.join(' & ')})` : ''}. Review and adjust credit units or semester below, then click Save.`
      : null;

  return { rows: parsed, notice };
}

export const BulkCoursesModal: React.FC<BulkCoursesModalProps> = ({
  classes,
  isTertiary,
  subjectLabel,
  subjectPlural,
  classLabel,
  cycleLabel,
  cycleLabels,
  availableDepartments = [],
  initialClassId = '',
  initialSemesterTag,
  initialDepartment = '',
  onClose,
  onSaved,
}) => {
  const defaultSemInitial: CanonicalSemesterTag =
    initialSemesterTag !== undefined ? initialSemesterTag : isTertiary ? '1ST' : '';

  const [mode, setMode] = useState<'GRID' | 'PASTE'>('GRID');
  const [defaultClassId, setDefaultClassId] = useState(initialClassId);
  const [defaultSemesterTag, setDefaultSemesterTag] = useState<CanonicalSemesterTag>(defaultSemInitial);
  const [defaultDepartment, setDefaultDepartment] = useState(initialDepartment);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [rows, setRows] = useState<BulkCourseDraftRow[]>([
    makeEmptyRow(initialClassId, defaultSemInitial, initialDepartment),
    makeEmptyRow(initialClassId, defaultSemInitial, initialDepartment),
    makeEmptyRow(initialClassId, defaultSemInitial, initialDepartment),
    makeEmptyRow(initialClassId, defaultSemInitial, initialDepartment),
  ]);
  const [pasteText, setPasteText] = useState('');
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Array<{ row: number; message: string }>>([]);

  const semesterOptions = useMemo(
    () => getSemesterTagOptions(cycleLabel, isTertiary, cycleLabels),
    [cycleLabel, isTertiary, cycleLabels]
  );

  const deptSuggestions = useMemo(() => {
    const set = new Set<string>(availableDepartments.filter(Boolean));
    for (const c of classes) {
      for (const arm of c.arms || []) {
        if (arm.name?.trim()) set.add(arm.name.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [availableDepartments, classes]);

  const updateRow = (id: string, patch: Partial<BulkCourseDraftRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const applyPreset = (presetKey: string) => {
    const preset = CURRICULUM_PRESETS[presetKey];
    if (!preset) return;
    const presetSem: CanonicalSemesterTag =
      preset.semesterTag !== undefined ? preset.semesterTag : defaultSemesterTag;
    if (preset.semesterTag !== undefined) {
      setDefaultSemesterTag(preset.semesterTag);
    }
    setRows(
      preset.rows.map((item) => ({
        id: `row_${Math.random().toString(36).slice(2, 9)}`,
        name: item.name,
        code: item.code,
        credit_units: String(item.units),
        course_type: item.type,
        class_id: defaultClassId,
        department: item.dept || '',
        semester_tag: item.sem !== undefined ? item.sem : presetSem,
      }))
    );
    setMode('GRID');
    setParseNotice(`Loaded preset: ${preset.label}.`);
    setError(null);
  };

  const parsePastedTextToGrid = () => {
    if (!pasteText.trim()) {
      setError('Paste at least one line (e.g. FHC 111, Introduction to Community Health, 2, CORE).');
      return;
    }

    const { rows: parsed, notice } = parseCurriculumPaste(
      pasteText,
      defaultClassId,
      defaultSemesterTag
    );

    if (parsed.length === 0) {
      setError(
        'Could not extract any valid rows. Supported formats: Code, Title, Units (with or without S/N column and headers).'
      );
      return;
    }

    const withDept = parsed.map((r) => ({
      ...r,
      department: r.department || (r.course_type === 'GENERAL' ? '' : defaultDepartment),
    }));
    setRows(withDept);
    setParseNotice(notice);
    setMode('GRID');
    setError(null);
  };

  const validRows = rows.filter((r) => r.name.trim().length > 0);
  const totalUnits = validRows.reduce((sum, r) => {
    const n = Number(r.credit_units);
    return sum + (Number.isFinite(n) && n >= 0 ? Math.min(12, Math.round(n)) : 0);
  }, 0);

  const selectedClassName = defaultClassId
    ? classes.find((c) => c.id === defaultClassId)?.name || ''
    : '';
  const selectedSemesterLabel = formatSemesterTagLabel(defaultSemesterTag, cycleLabel, cycleLabels);

  const handleSubmit = async () => {
    if (validRows.length === 0) {
      setError(`Enter at least one ${subjectLabel.toLowerCase()} title before saving.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    setRowErrors([]);
    try {
      const payloadCourses = validRows.map((r) => {
        const parsedUnits = r.credit_units.trim() === '' ? 3 : Number(r.credit_units);
        const cleanUnits = Number.isFinite(parsedUnits)
          ? Math.max(0, Math.min(12, Math.round(parsedUnits)))
          : 3;
        return {
          name: r.name.trim(),
          code: r.code.trim().toUpperCase() || undefined,
          credit_units: cleanUnits,
          course_type: r.course_type,
          class_id: r.class_id || defaultClassId || null,
          department: r.department.trim() || (r.course_type === 'GENERAL' ? null : defaultDepartment.trim() || null),
          semester_tag: r.semester_tag || null,
          status: 'ACTIVE',
        };
      });

      const res = await api.bulkUpsertSubjects({
        courses: payloadCourses,
        update_existing: updateExisting,
        default_semester_tag: defaultSemesterTag || null,
        default_department: defaultDepartment.trim() || null,
      });

      if (res.errors && res.errors.length > 0) {
        setRowErrors(res.errors);
      }
      onSaved(res.message);
    } catch (err: any) {
      setError(err?.message || `Failed to bulk register ${subjectPlural.toLowerCase()}.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-2.5 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-700 shrink-0" />
              <h3 className="text-base font-bold text-slate-900">
                Bulk Register {subjectPlural} &amp; Credit Units
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Organize {subjectPlural.toLowerCase()} by {classLabel.toLowerCase()} and {cycleLabel.toLowerCase()} (e.g. 100L 1st {cycleLabel} separate from 2nd {cycleLabel}). Paste directly from Excel/Word/CSV (S/N columns &amp; headers are handled automatically).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Close bulk courses modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls Bar */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('GRID')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                mode === 'GRID'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Interactive Table ({validRows.length})
            </button>
            <button
              type="button"
              onClick={() => setMode('PASTE')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-colors ${
                mode === 'PASTE'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Paste Excel / CSV
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={defaultClassId}
              onChange={(e) => {
                const nextCls = e.target.value;
                const prevDefault = defaultClassId;
                setDefaultClassId(nextCls);
                setRows((prev) =>
                  prev.map((r) =>
                    r.class_id === '' || r.class_id === prevDefault ? { ...r, class_id: nextCls } : r
                  )
                );
              }}
              className="text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 font-medium"
              aria-label={`Default ${classLabel}`}
            >
              <option value="">Default Scope: All {classLabel}s</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel}: {c.name}
                </option>
              ))}
            </select>

            <select
              value={defaultSemesterTag}
              onChange={(e) => {
                const nextSem = e.target.value as CanonicalSemesterTag;
                const prevDefault = defaultSemesterTag;
                setDefaultSemesterTag(nextSem);
                setRows((prev) =>
                  prev.map((r) =>
                    r.semester_tag === prevDefault ? { ...r, semester_tag: nextSem } : r
                  )
                );
              }}
              className="text-xs px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-emerald-900 font-semibold"
              aria-label={`Default ${cycleLabel}`}
            >
              {semesterOptions.map((opt) => (
                <option key={opt.value || 'ALL'} value={opt.value}>
                  {cycleLabel}: {opt.label}
                </option>
              ))}
            </select>

            <div className="relative flex items-center">
              <input
                type="text"
                list="bursariq-bulk-dept-options"
                value={defaultDepartment}
                onChange={(e) => {
                  const nextDept = e.target.value;
                  const prevDept = defaultDepartment;
                  setDefaultDepartment(nextDept);
                  setRows((prev) =>
                    prev.map((r) =>
                      r.department === '' || r.department === prevDept ? { ...r, department: nextDept } : r
                    )
                  );
                }}
                placeholder="Department (blank = General / Shared)"
                aria-label="Default Department"
                className="text-xs px-2.5 py-1.5 bg-white border border-sky-300 rounded-lg text-slate-800 font-medium w-56 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <datalist id="bursariq-bulk-dept-options">
                {deptSuggestions.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>

            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) applyPreset(e.target.value);
                e.target.value = '';
              }}
              className="text-xs px-2.5 py-1.5 bg-white border border-slate-200 text-slate-700 font-medium rounded-lg"
              aria-label="Load Curriculum Preset"
            >
              <option value="">Load Quick Preset...</option>
              {Object.entries(CURRICULUM_PRESETS)
                .sort(([, a], [, b]) => Number(b.tertiary === isTertiary) - Number(a.tertiary === isTertiary))
                .map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {parseNotice && !error && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{parseNotice}</span>
            </div>
          )}

          {rowErrors.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
              <p className="font-semibold">Some rows had issues:</p>
              {rowErrors.map((e, idx) => (
                <p key={idx}>
                  Row {e.row}: {e.message}
                </p>
              ))}
            </div>
          )}

          {mode === 'PASTE' ? (
            <div className="space-y-3">
              <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
                <p className="font-semibold text-slate-800">
                  Paste directly from Excel, Word, Google Sheets, or CSV — S/N columns &amp; header rows are automatically detected and stripped.
                </p>
                <p className="text-[11px] text-slate-500">
                  Target scope for pasted rows: <strong>{selectedClassName || `All ${classLabel}s`}</strong> ·{' '}
                  <strong>{selectedSemesterLabel}</strong> ·{' '}
                  <strong>{defaultDepartment.trim() || 'General / Shared (All Departments)'}</strong> (you can adjust individual rows after parsing).
                </p>
                <pre className="font-mono text-[11px] text-slate-600 whitespace-pre-wrap bg-white p-2 rounded border border-slate-200">
{isTertiary
  ? `S/N\tCOURSE CODE\tCOURSE TITLE\tCREDIT UNIT\n1\tFHC 111\tIntroduction to Community Health\t2\n2\tFHC 112\tAnatomy & Physiology I\t3\n3\tGST 111\tCommunication in English I\t2`
  : `MTH, Mathematics, 4, CORE, Sciences\nENG, English Language, 4, CORE, Languages\nPHY, Physics, 3, CORE, Sciences\nICT, Data Processing, 2, ELECTIVE, Technology`}
                </pre>
              </div>
              <textarea
                rows={9}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste rows directly from Excel, Word tables, Google Sheets, or CSV here..."
                className="w-full px-3 py-2.5 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={parsePastedTextToGrid}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Parse into Table for Review
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse min-w-[920px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-2.5 py-2 w-28">Code</th>
                      <th className="px-2.5 py-2 min-w-[210px]">{subjectLabel} Title *</th>
                      <th className="px-2.5 py-2 w-40">Credit Units (0–12)</th>
                      <th className="px-2.5 py-2 w-36">{cycleLabel}</th>
                      <th className="px-2.5 py-2 w-36">{classLabel}</th>
                      <th className="px-2.5 py-2 w-28">Type</th>
                      <th className="px-2.5 py-2 w-32">Department</th>
                      <th className="px-2.5 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {rows.map((row, idx) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={row.code}
                            onChange={(e) => updateRow(row.id, { code: e.target.value.toUpperCase() })}
                            placeholder={isTertiary ? 'FHC 111' : 'MTH'}
                            aria-label={`Row ${idx + 1} Code`}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => updateRow(row.id, { name: e.target.value })}
                            placeholder={isTertiary ? 'e.g. Data Structures & Algorithms' : 'e.g. Further Mathematics'}
                            aria-label={`Row ${idx + 1} Title`}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={12}
                              value={row.credit_units}
                              onChange={(e) => updateRow(row.id, { credit_units: e.target.value })}
                              aria-label={`Row ${idx + 1} Credit Units`}
                              className="w-14 px-2 py-1.5 border border-slate-200 rounded text-xs font-semibold tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <div className="flex items-center gap-0.5">
                              {[1, 2, 3, 4].map((u) => (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => updateRow(row.id, { credit_units: String(u) })}
                                  className={`w-5 h-6 text-[10px] font-semibold rounded border tabular-nums ${
                                    row.credit_units === String(u)
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                  }`}
                                  title={`Set ${u} unit${u > 1 ? 's' : ''}`}
                                >
                                  {u}
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={row.semester_tag}
                            onChange={(e) =>
                              updateRow(row.id, { semester_tag: e.target.value as CanonicalSemesterTag })
                            }
                            aria-label={`Row ${idx + 1} ${cycleLabel}`}
                            className="w-full px-1.5 py-1.5 border border-slate-200 rounded text-xs bg-white"
                          >
                            {semesterOptions.map((opt) => (
                              <option key={opt.value || 'ALL'} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={row.class_id}
                            onChange={(e) => updateRow(row.id, { class_id: e.target.value })}
                            aria-label={`Row ${idx + 1} ${classLabel}`}
                            className="w-full px-1.5 py-1.5 border border-slate-200 rounded text-xs bg-white"
                          >
                            <option value="">All {classLabel}s</option>
                            {classes.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={row.course_type}
                            onChange={(e) => updateRow(row.id, { course_type: e.target.value as any })}
                            aria-label={`Row ${idx + 1} Type`}
                            className="w-full px-1.5 py-1.5 border border-slate-200 rounded text-xs bg-white"
                          >
                            <option value="CORE">Core</option>
                            <option value="ELECTIVE">Elective</option>
                            <option value="GENERAL">General</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            list="bursariq-bulk-dept-options"
                            value={row.department}
                            onChange={(e) => updateRow(row.id, { department: e.target.value })}
                            placeholder="General / Shared"
                            aria-label={`Row ${idx + 1} Department`}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setRows((prev) =>
                                prev.length > 1
                                  ? prev.filter((r) => r.id !== row.id)
                                  : [makeEmptyRow(defaultClassId, defaultSemesterTag, defaultDepartment)]
                              )
                            }
                            className="p-1 text-slate-400 hover:text-red-600 rounded"
                            title="Remove row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => [...prev, makeEmptyRow(defaultClassId, defaultSemesterTag, defaultDepartment)])
                    }
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Row
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => [
                        ...prev,
                        makeEmptyRow(defaultClassId, defaultSemesterTag, defaultDepartment),
                        makeEmptyRow(defaultClassId, defaultSemesterTag, defaultDepartment),
                        makeEmptyRow(defaultClassId, defaultSemesterTag, defaultDepartment),
                        makeEmptyRow(defaultClassId, defaultSemesterTag, defaultDepartment),
                        makeEmptyRow(defaultClassId, defaultSemesterTag, defaultDepartment),
                      ])
                    }
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    +5 Rows
                  </button>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Update credit units &amp; details if {subjectLabel.toLowerCase()} code/name already exists
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600 tabular-nums">
            <span className="font-semibold text-slate-900">{validRows.length}</span> ready{' '}
            {subjectPlural.toLowerCase()} ·{' '}
            <span className="font-semibold text-slate-900">{totalUnits}</span> total credit units ·{' '}
            <span className="font-medium text-emerald-800">
              {defaultDepartment.trim() ? `${defaultDepartment.trim()} · ` : 'General · '}
              {selectedClassName ? `${selectedClassName} · ` : ''}
              {selectedSemesterLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || validRows.length === 0}
              onClick={handleSubmit}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {submitting
                ? 'Registering...'
                : `Save ${validRows.length} ${validRows.length === 1 ? subjectLabel : subjectPlural}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
