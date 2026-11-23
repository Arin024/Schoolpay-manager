// Shared Universal Institutional Mode, Academic Calendar, GPA/CGPA & Terminology Engine
// Supports K-12 Schools (Nursery, Primary, Secondary) AND Higher Institutions (University, Polytechnic, Colleges)
// with 100% backwards compatibility for all existing BursarIQ schools.

export type InstitutionCategory = 'K12' | 'TERTIARY';
export type AcademicCycleType = 'TERM' | 'SEMESTER' | 'TRIMESTER';
export type GradingMode = 'PERCENTAGE' | 'GPA_5' | 'GPA_4';

export interface InstitutionTerminology {
  institution: string;       // e.g. 'School' | 'University' | 'Polytechnic' | 'College' | 'Institution'
  cycle: string;             // e.g. 'Term' | 'Semester' | 'Trimester'
  cyclePlural: string;       // e.g. 'Terms' | 'Semesters' | 'Trimesters'
  classLabel: string;        // e.g. 'Class' | 'Level / Programme'
  classPlural: string;       // e.g. 'Classes & Arms' | 'Levels & Departments'
  armLabel: string;          // e.g. 'Arm / Stream' | 'Department / Option'
  subject: string;           // e.g. 'Subject' | 'Course'
  subjectPlural: string;     // e.g. 'Subjects' | 'Courses'
  studentId: string;         // e.g. 'Admission Number' | 'Matric Number'
  staff: string;             // e.g. 'Teacher' | 'Lecturer'
  staffPlural: string;       // e.g. 'Teaching Staff' | 'Lecturers & Faculty'
  parent: string;            // e.g. 'Parent / Guardian' | 'Sponsor / Guardian'
  head: string;              // e.g. 'Principal' | 'Registrar / Provost'
  report: string;            // e.g. 'Report Card' | 'Result / Transcript'
  lessonNotes: string;       // e.g. 'Lesson Notes' | 'Lecture Notes & Outlines'
}

export interface ResolvedInstitutionProfile {
  category: InstitutionCategory;
  isTertiary: boolean;
  cycleType: AcademicCycleType;
  cycleLabels: string[];
  gradingMode: GradingMode;
  gpaScaleMax: number | null;
  labels: InstitutionTerminology;
}

export const TERTIARY_SCHOOL_TYPES = [
  'University',
  'Polytechnic',
  'College of Education',
  'College of Health / Nursing',
  'Monotechnic / Institute',
] as const;

export const K12_SCHOOL_TYPES = [
  'Nursery & Primary',
  'Secondary',
  'Comprehensive / K-12',
  'Vocational / Technical',
  'International',
] as const;

export function isTertiarySchoolType(schoolType?: string | null): boolean {
  const normalized = String(schoolType || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('university') ||
    normalized.includes('polytechnic') ||
    normalized.includes('college of education') ||
    normalized.includes('college of health') ||
    normalized.includes('nursing') ||
    normalized.includes('monotechnic') ||
    normalized.includes('tertiary') ||
    normalized.includes('higher institution') ||
    normalized.includes('institute')
  );
}

export const DEFAULT_K12_TERMINOLOGY: InstitutionTerminology = {
  institution: 'School',
  cycle: 'Term',
  cyclePlural: 'Terms',
  classLabel: 'Class',
  classPlural: 'Classes & Arms',
  armLabel: 'Arm / Stream',
  subject: 'Subject',
  subjectPlural: 'Subjects',
  studentId: 'Admission Number',
  staff: 'Teacher',
  staffPlural: 'Teaching Staff',
  parent: 'Parent / Guardian',
  head: 'Principal',
  report: 'Report Card',
  lessonNotes: 'Lesson Notes',
};

export const DEFAULT_UNIVERSITY_TERMINOLOGY: InstitutionTerminology = {
  institution: 'University',
  cycle: 'Semester',
  cyclePlural: 'Semesters',
  classLabel: 'Level / Programme',
  classPlural: 'Levels & Departments',
  armLabel: 'Department / Option',
  subject: 'Course',
  subjectPlural: 'Courses',
  studentId: 'Matric Number',
  staff: 'Lecturer',
  staffPlural: 'Lecturers & Faculty',
  parent: 'Sponsor / Guardian',
  head: 'Registrar / Vice-Chancellor',
  report: 'Semester Result / Transcript',
  lessonNotes: 'Lecture Notes & Course Outlines',
};

export const DEFAULT_POLYTECHNIC_TERMINOLOGY: InstitutionTerminology = {
  ...DEFAULT_UNIVERSITY_TERMINOLOGY,
  institution: 'Polytechnic',
  head: 'Registrar / Rector',
};

export const DEFAULT_COLLEGE_TERMINOLOGY: InstitutionTerminology = {
  ...DEFAULT_UNIVERSITY_TERMINOLOGY,
  institution: 'College',
  head: 'Registrar / Provost',
};

export function getDefaultCycleLabels(cycleType: AcademicCycleType): string[] {
  if (cycleType === 'SEMESTER') return ['1st Semester', '2nd Semester'];
  if (cycleType === 'TRIMESTER') return ['1st Trimester', '2nd Trimester', '3rd Trimester'];
  return ['1st Term', '2nd Term', '3rd Term'];
}

export function getDefaultGradingModeForType(schoolType?: string | null, category?: InstitutionCategory): GradingMode {
  const cat = category || (isTertiarySchoolType(schoolType) ? 'TERTIARY' : 'K12');
  if (cat !== 'TERTIARY') return 'PERCENTAGE';
  const lower = String(schoolType || '').toLowerCase();
  if (lower.includes('polytechnic') || lower.includes('monotechnic')) return 'GPA_4';
  return 'GPA_5';
}

export function getDefaultTerminologyForType(
  schoolType?: string | null,
  category?: InstitutionCategory,
  cycleType?: AcademicCycleType
): InstitutionTerminology {
  const cat = category || (isTertiarySchoolType(schoolType) ? 'TERTIARY' : 'K12');
  const lower = String(schoolType || '').toLowerCase();
  let base: InstitutionTerminology =
    cat === 'TERTIARY'
      ? lower.includes('polytechnic') || lower.includes('monotechnic')
        ? { ...DEFAULT_POLYTECHNIC_TERMINOLOGY }
        : lower.includes('college')
          ? { ...DEFAULT_COLLEGE_TERMINOLOGY }
          : { ...DEFAULT_UNIVERSITY_TERMINOLOGY }
      : { ...DEFAULT_K12_TERMINOLOGY };

  if (cycleType === 'SEMESTER') {
    base = { ...base, cycle: 'Semester', cyclePlural: 'Semesters' };
  } else if (cycleType === 'TRIMESTER') {
    base = { ...base, cycle: 'Trimester', cyclePlural: 'Trimesters' };
  } else if (cycleType === 'TERM') {
    base = { ...base, cycle: 'Term', cyclePlural: 'Terms' };
  }
  return base;
}

export interface GpaScaleBand {
  grade: string;
  min: number;
  max: number;
  points: number;
  remark: string;
}

export const NUC_5_POINT_SCALE: GpaScaleBand[] = [
  { grade: 'A', min: 70, max: 100, points: 5.0, remark: 'Excellent' },
  { grade: 'B', min: 60, max: 69.99, points: 4.0, remark: 'Very Good' },
  { grade: 'C', min: 50, max: 59.99, points: 3.0, remark: 'Good' },
  { grade: 'D', min: 45, max: 49.99, points: 2.0, remark: 'Fair' },
  { grade: 'E', min: 40, max: 44.99, points: 1.0, remark: 'Pass' },
  { grade: 'F', min: 0, max: 39.99, points: 0.0, remark: 'Fail' },
];

export const NBTE_4_POINT_SCALE: GpaScaleBand[] = [
  { grade: 'A', min: 75, max: 100, points: 4.0, remark: 'Distinction' },
  { grade: 'AB', min: 70, max: 74.99, points: 3.5, remark: 'Very Good' },
  { grade: 'B', min: 65, max: 69.99, points: 3.25, remark: 'Upper Credit' },
  { grade: 'BC', min: 60, max: 64.99, points: 3.0, remark: 'Credit' },
  { grade: 'C', min: 55, max: 59.99, points: 2.75, remark: 'Lower Credit' },
  { grade: 'CD', min: 50, max: 54.99, points: 2.5, remark: 'Merit' },
  { grade: 'D', min: 45, max: 49.99, points: 2.25, remark: 'Pass' },
  { grade: 'E', min: 40, max: 44.99, points: 2.0, remark: 'Weak Pass' },
  { grade: 'F', min: 0, max: 39.99, points: 0.0, remark: 'Fail' },
];

export function computeGpaGradeBand(percentage: number, gradingMode: GradingMode): GpaScaleBand {
  const scale = gradingMode === 'GPA_4' ? NBTE_4_POINT_SCALE : NUC_5_POINT_SCALE;
  const pct = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0;
  for (const band of scale) {
    if (pct >= band.min && pct <= band.max + 0.001) {
      return band;
    }
  }
  return scale[scale.length - 1];
}

export function getAcademicClassStanding(gpa: number, gradingMode: GradingMode): string {
  if (gradingMode === 'GPA_4') {
    if (gpa >= 3.5) return 'Distinction';
    if (gpa >= 3.0) return 'Upper Credit';
    if (gpa >= 2.5) return 'Lower Credit';
    if (gpa >= 2.0) return 'Pass';
    return 'Academic Probation';
  }
  if (gpa >= 4.5) return 'First Class Honours';
  if (gpa >= 3.5) return 'Second Class Upper (2:1)';
  if (gpa >= 2.4) return 'Second Class Lower (2:2)';
  if (gpa >= 1.5) return 'Third Class Honours';
  if (gpa >= 1.0) return 'Pass';
  return 'Academic Probation';
}

function parseJsonSafe<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export function resolveInstitutionProfile(
  school?: { type?: string | null } | null,
  settings?: {
    institution_category?: string | null;
    academic_cycle_type?: string | null;
    cycle_labels_json?: string | string[] | null;
    grading_mode?: string | null;
    terminology_json?: string | Partial<InstitutionTerminology> | null;
    current_term?: string | null;
  } | null
): ResolvedInstitutionProfile {
  const inferredTertiary = isTertiarySchoolType(school?.type);
  const rawCat = String(settings?.institution_category || '').toUpperCase();
  const category: InstitutionCategory =
    rawCat === 'TERTIARY' ? 'TERTIARY' : rawCat === 'K12' ? (inferredTertiary && !settings?.academic_cycle_type ? 'TERTIARY' : 'K12') : inferredTertiary ? 'TERTIARY' : 'K12';

  const rawCycle = String(settings?.academic_cycle_type || '').toUpperCase();
  const inferredCycleFromCurrent = String(settings?.current_term || '').toLowerCase().includes('semester')
    ? 'SEMESTER'
    : String(settings?.current_term || '').toLowerCase().includes('trimester')
      ? 'TRIMESTER'
      : null;

  const cycleType: AcademicCycleType =
    rawCycle === 'SEMESTER' || rawCycle === 'TRIMESTER' || rawCycle === 'TERM'
      ? (rawCycle as AcademicCycleType)
      : inferredCycleFromCurrent || (category === 'TERTIARY' ? 'SEMESTER' : 'TERM');

  const parsedCycles = parseJsonSafe<string[]>(settings?.cycle_labels_json);
  const cycleLabels =
    Array.isArray(parsedCycles) && parsedCycles.filter((c) => typeof c === 'string' && c.trim()).length > 0
      ? parsedCycles.map((c) => String(c).trim()).filter(Boolean)
      : getDefaultCycleLabels(cycleType);

  const rawGrading = String(settings?.grading_mode || '').toUpperCase();
  const gradingMode: GradingMode =
    rawGrading === 'GPA_5' || rawGrading === 'GPA_4' || rawGrading === 'PERCENTAGE'
      ? (rawGrading as GradingMode)
      : getDefaultGradingModeForType(school?.type, category);

  const defaults = getDefaultTerminologyForType(school?.type, category, cycleType);
  const customTerms = parseJsonSafe<Partial<InstitutionTerminology>>(settings?.terminology_json);
  const labels: InstitutionTerminology = {
    ...defaults,
    ...(customTerms
      ? Object.fromEntries(
          Object.entries(customTerms).filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
        )
      : {}),
  };

  return {
    category,
    isTertiary: category === 'TERTIARY',
    cycleType,
    cycleLabels,
    gradingMode,
    gpaScaleMax: gradingMode === 'GPA_5' ? 5.0 : gradingMode === 'GPA_4' ? 4.0 : null,
    labels,
  };
}

export const INSTITUTION_PRESETS = {
  K12_TERM: {
    label: 'Primary / Secondary (3 Terms · %)',
    institution_category: 'K12' as InstitutionCategory,
    academic_cycle_type: 'TERM' as AcademicCycleType,
    cycle_labels: ['1st Term', '2nd Term', '3rd Term'],
    grading_mode: 'PERCENTAGE' as GradingMode,
    terminology: DEFAULT_K12_TERMINOLOGY,
  },
  UNIVERSITY_SEMESTER: {
    label: 'University (1st & 2nd Semester · 5.0 GPA)',
    institution_category: 'TERTIARY' as InstitutionCategory,
    academic_cycle_type: 'SEMESTER' as AcademicCycleType,
    cycle_labels: ['1st Semester', '2nd Semester'],
    grading_mode: 'GPA_5' as GradingMode,
    terminology: DEFAULT_UNIVERSITY_TERMINOLOGY,
  },
  UNIVERSITY_HARMATTAN_RAIN: {
    label: 'University (Harmattan & Rain · 5.0 GPA)',
    institution_category: 'TERTIARY' as InstitutionCategory,
    academic_cycle_type: 'SEMESTER' as AcademicCycleType,
    cycle_labels: ['Harmattan Semester', 'Rain Semester'],
    grading_mode: 'GPA_5' as GradingMode,
    terminology: DEFAULT_UNIVERSITY_TERMINOLOGY,
  },
  POLYTECHNIC_SEMESTER: {
    label: 'Polytechnic (1st & 2nd Semester · 4.0 GPA)',
    institution_category: 'TERTIARY' as InstitutionCategory,
    academic_cycle_type: 'SEMESTER' as AcademicCycleType,
    cycle_labels: ['1st Semester', '2nd Semester'],
    grading_mode: 'GPA_4' as GradingMode,
    terminology: DEFAULT_POLYTECHNIC_TERMINOLOGY,
  },
  COLLEGE_HEALTH_ED: {
    label: 'College of Health / Education (Semesters · 5.0 GPA)',
    institution_category: 'TERTIARY' as InstitutionCategory,
    academic_cycle_type: 'SEMESTER' as AcademicCycleType,
    cycle_labels: ['1st Semester', '2nd Semester'],
    grading_mode: 'GPA_5' as GradingMode,
    terminology: DEFAULT_COLLEGE_TERMINOLOGY,
  },
  TRIMESTER_INSTITUTE: {
    label: 'Trimester Institute (3 Trimesters · 5.0 GPA)',
    institution_category: 'TERTIARY' as InstitutionCategory,
    academic_cycle_type: 'TRIMESTER' as AcademicCycleType,
    cycle_labels: ['1st Trimester', '2nd Trimester', '3rd Trimester'],
    grading_mode: 'GPA_5' as GradingMode,
    terminology: {
      ...DEFAULT_COLLEGE_TERMINOLOGY,
      institution: 'Institute',
      cycle: 'Trimester',
      cyclePlural: 'Trimesters',
    },
  },
};
