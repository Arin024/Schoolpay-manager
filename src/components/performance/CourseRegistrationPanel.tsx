import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Square,
  Users,
  BookOpen,
  Trash2,
  AlertTriangle,
  History,
  CheckCircle2,
  Printer,
  RefreshCw,
  Layers,
  Award,
  Building2,
  ClipboardCheck,
  ArrowRight,
} from 'lucide-react';
import { api } from '../../services/api';
import {
  AcademicSessionItem,
  ClassItem,
  CourseRegistrationItem,
  DepartmentSummaryItem,
  Student,
  SubjectItem,
} from '../../types';
import {
  CanonicalSemesterTag,
  formatSemesterTagLabel,
  normalizeSemesterTag,
  termMatchesSemesterTag,
} from '../../utils/semesterTag';

interface CourseRegistrationPanelProps {
  sessions: AcademicSessionItem[];
  classes: ClassItem[];
  subjects: SubjectItem[];
  students: Student[];
  departments?: DepartmentSummaryItem[];
  isAdmin: boolean;
  isTertiary: boolean;
  subjectLabel: string;
  subjectPlural: string;
  classLabel: string;
  cycleLabel: string;
  cycleLabels?: string[];
  learnerLabel: string;
  learnerPlural: string;
  onOpenHistoricalBacklog: () => void;
  onOpenBulkCourses: (
    prefillClassId?: string,
    prefillSemesterTag?: CanonicalSemesterTag,
    prefillDepartment?: string
  ) => void;
  onOpenSessionReports?: () => void;
  onLaunchGradingFromRegistrations?: (params: {
    academic_session_id: string;
    term_id: string;
    class_id?: string | null;
    department?: string | null;
  }) => Promise<void> | void;
  onToast: (type: 'success' | 'error', text: string) => void;
}

const isGeneralOrSharedCourse = (sub: SubjectItem): boolean => {
  const dept = (sub.department || '').trim().toLowerCase();
  return !dept || dept === 'general' || dept === 'shared' || dept === 'all' || sub.course_type === 'GENERAL';
};

export const CourseRegistrationPanel: React.FC<CourseRegistrationPanelProps> = ({
  sessions,
  classes,
  subjects,
  students,
  departments = [],
  isAdmin,
  isTertiary,
  subjectLabel,
  subjectPlural,
  classLabel,
  cycleLabel,
  cycleLabels,
  learnerLabel,
  learnerPlural,
  onOpenHistoricalBacklog,
  onOpenBulkCourses,
  onOpenSessionReports,
  onLaunchGradingFromRegistrations,
  onToast,
}) => {
  const activeSession = sessions.find((s) => s.status === 'ACTIVE') || sessions[0];
  const [sessionId, setSessionId] = useState(activeSession?.id || '');
  // termId === '__ALL__' shows Full-Session Combined aggregation across all semesters/terms
  const [termId, setTermId] = useState(activeSession?.terms?.[0]?.id || '');
  const [classId, setClassId] = useState('');
  const [department, setDepartment] = useState('');
  const [includeGeneralCourses, setIncludeGeneralCourses] = useState(true);
  const [targetMode, setTargetMode] = useState<'CLASS' | 'STUDENTS'>('CLASS');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [unitOverrides, setUnitOverrides] = useState<Record<string, string>>({});
  const [registrationType, setRegistrationType] = useState<'REGULAR' | 'CARRYOVER' | 'ELECTIVE' | 'HISTORICAL'>('REGULAR');
  const [showOtherSemesters, setShowOtherSemesters] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [launchingGrading, setLaunchingGrading] = useState(false);
  const [registrations, setRegistrations] = useState<CourseRegistrationItem[]>([]);
  const [studentSummaries, setStudentSummaries] = useState<
    Array<{
      student_id: string;
      student_name: string;
      admission_number: string | null;
      class_name: string | null;
      department?: string | null;
      courses_count: number;
      total_credit_units: number;
      exceeds_max_units: boolean;
      term_breakdown?: Array<{
        term_id: string;
        term_name: string;
        courses_count: number;
        total_credit_units: number;
        exceeds_max_units: boolean;
      }>;
      courses: CourseRegistrationItem[];
    }>
  >([]);
  const [departmentSummaries, setDepartmentSummaries] = useState<
    Array<{ department: string; registered_students_count: number; registrations_count: number }>
  >([]);
  const [policy, setPolicy] = useState({ min_credit_units_per_cycle: 12, max_credit_units_per_cycle: 24 });
  const [printingStudentId, setPrintingStudentId] = useState<string | null>(null);

  const selectedSession = useMemo(() => sessions.find((s) => s.id === sessionId), [sessions, sessionId]);
  const sessionTerms = selectedSession?.terms || [];
  const isFullSessionView = termId === '__ALL__';
  const selectedTerm = useMemo(
    () => (isFullSessionView ? null : sessionTerms.find((t) => t.id === termId) || null),
    [sessionTerms, termId, isFullSessionView]
  );
  const activeSemesterCanonical: CanonicalSemesterTag = useMemo(
    () => (selectedTerm ? normalizeSemesterTag(selectedTerm.name) : ''),
    [selectedTerm]
  );

  // Discover canonical list of departments/arms across API summary, class arms, students, and courses
  const availableDepartments = useMemo(() => {
    const map = new Map<string, string>();
    const add = (val?: string | null) => {
      const cleaned = (val || '').trim();
      if (!cleaned) return;
      const lower = cleaned.toLowerCase();
      if (lower === 'general' || lower === 'general / unassigned') return;
      if (!map.has(lower)) map.set(lower, cleaned);
    };
    departments.forEach((d) => add(d.name));
    classes.forEach((c) => (c.arms || []).forEach((a) => add(a.name)));
    students.forEach((s) => add(s.class_arm_name));
    subjects.forEach((s) => add(s.department));
    departmentSummaries.forEach((d) => add(d.department));
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [departments, classes, students, subjects, departmentSummaries]);

  useEffect(() => {
    if (!sessionId && sessions.length > 0) {
      const def = sessions.find((s) => s.status === 'ACTIVE') || sessions[0];
      setSessionId(def.id);
      if (def.terms?.[0]) setTermId(def.terms[0].id);
    }
  }, [sessions, sessionId]);

  useEffect(() => {
    if (selectedSession && termId !== '__ALL__' && (!termId || !sessionTerms.some((t) => t.id === termId))) {
      setTermId(sessionTerms[0]?.id || '');
    }
  }, [selectedSession, sessionTerms, termId]);

  const loadRegistrations = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await api.getCourseRegistrations({
        academic_session_id: sessionId || undefined,
        term_id: isFullSessionView ? undefined : termId || undefined,
        class_id: classId || undefined,
        department: department || undefined,
      });
      setRegistrations(res.registrations || []);
      setStudentSummaries(res.studentSummaries || []);
      setDepartmentSummaries(res.departmentSummaries || []);
      if (res.policy) setPolicy(res.policy);
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to load course registrations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRegistrations();
  }, [sessionId, termId, classId, department]);

  const filteredStudents = useMemo(() => {
    const deptKey = department.trim().toLowerCase();
    return students.filter((s) => {
      if (classId && s.class_id !== classId) return false;
      if (deptKey) {
        const stuDept = (s.class_arm_name || '').trim().toLowerCase();
        if (stuDept !== deptKey) return false;
      }
      return true;
    });
  }, [students, classId, department]);

  const activeSubjects = useMemo(() => {
    return subjects.filter((s) => s.status !== 'INACTIVE');
  }, [subjects]);

  // Courses strictly matching the selected Level (classId), Department, AND selected Semester/Term
  const matchingCycleSubjects = useMemo(() => {
    const deptKey = department.trim().toLowerCase();
    return activeSubjects.filter((s) => {
      const matchesClass = !classId || !s.class_id || s.class_id === classId;
      const matchesSem = selectedTerm ? termMatchesSemesterTag(selectedTerm.name, s.semester_tag) : true;
      if (!matchesClass || !matchesSem) return false;
      if (!deptKey) return true;
      const subDept = (s.department || '').trim().toLowerCase();
      if (subDept === deptKey) return true;
      if (includeGeneralCourses && isGeneralOrSharedCourse(s)) return true;
      return false;
    });
  }, [activeSubjects, classId, selectedTerm, department, includeGeneralCourses]);

  const displayedSubjects = useMemo(() => {
    if (showOtherSemesters || registrationType === 'CARRYOVER') {
      return activeSubjects;
    }
    return matchingCycleSubjects;
  }, [activeSubjects, matchingCycleSubjects, showOtherSemesters, registrationType]);

  const hiddenOtherCount = Math.max(0, activeSubjects.length - matchingCycleSubjects.length);

  const selectedUnitsSum = useMemo(() => {
    return selectedSubjectIds.reduce((sum, id) => {
      const sub = activeSubjects.find((s) => s.id === id);
      const raw = unitOverrides[id] !== undefined ? Number(unitOverrides[id]) : Number(sub?.credit_units ?? 3);
      return sum + (Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0);
    }, 0);
  }, [selectedSubjectIds, unitOverrides, activeSubjects]);

  const toggleSubject = (id: string) => {
    setSelectedSubjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSelectTermTab = (nextTermId: string) => {
    setTermId(nextTermId);
    setSelectedSubjectIds([]);
  };

  const handleSelectDepartment = (nextDept: string) => {
    setDepartment(nextDept);
    setSelectedStudentIds([]);
    setSelectedSubjectIds([]);
  };

  const handleBulkRegister = async () => {
    if (!sessionId || !termId || isFullSessionView) {
      onToast('error', `Select a specific Academic Session and ${cycleLabel} first.`);
      return;
    }
    if (selectedSubjectIds.length === 0) {
      onToast('error', `Select at least one ${subjectLabel.toLowerCase()} to register.`);
      return;
    }
    if (targetMode === 'CLASS' && !classId && !department) {
      onToast('error', `Select a ${classLabel} or Department, or switch to specific ${learnerPlural.toLowerCase()}.`);
      return;
    }
    if (targetMode === 'STUDENTS' && selectedStudentIds.length === 0) {
      onToast('error', `Select at least one ${learnerLabel.toLowerCase()}.`);
      return;
    }

    setSaving(true);
    try {
      const subjectPayload = selectedSubjectIds.map((subId) => {
        const sub = activeSubjects.find((s) => s.id === subId);
        const rawOverride = unitOverrides[subId];
        const parsed =
          rawOverride !== undefined && rawOverride.trim() !== ''
            ? Number(rawOverride)
            : Number(sub?.credit_units ?? 3);
        return {
          subject_id: subId,
          credit_units: Number.isFinite(parsed) ? Math.max(0, Math.min(12, Math.round(parsed))) : 3,
          registration_type: registrationType,
        };
      });

      const res = await api.bulkRegisterStudentCourses({
        academic_session_id: sessionId,
        term_id: termId,
        class_id: classId || null,
        department: department || null,
        student_ids: targetMode === 'STUDENTS' ? selectedStudentIds : undefined,
        subject_ids: subjectPayload,
        registration_type: registrationType,
      });

      onToast('success', res.message);
      await loadRegistrations();
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to register courses.');
    } finally {
      setSaving(false);
    }
  };

  const handleDropRegistration = async (regId: string) => {
    try {
      await api.deleteCourseRegistration(regId);
      onToast('success', `${subjectLabel} dropped from registration.`);
      await loadRegistrations();
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to drop registration.');
    }
  };

  const handleLaunchGrading = async () => {
    if (!onLaunchGradingFromRegistrations || !sessionId || !termId || isFullSessionView) return;
    setLaunchingGrading(true);
    try {
      await onLaunchGradingFromRegistrations({
        academic_session_id: sessionId,
        term_id: termId,
        class_id: classId || null,
        department: department || null,
      });
    } finally {
      setLaunchingGrading(false);
    }
  };

  const printingStudent = printingStudentId
    ? studentSummaries.find((s) => s.student_id === printingStudentId) || null
    : null;

  const selectedClassName = classId ? classes.find((c) => c.id === classId)?.name || '' : '';
  const deptLabel = isTertiary ? 'Department / Programme' : 'Department / Arm';
  const cohortTitle = [selectedClassName, department].filter(Boolean).join(' · ') || classLabel;

  return (
    <div className="space-y-5">
      {/* Top Action & Filter Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Department &amp; {cycleLabel} Bulk {subjectLabel} Registration
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Register each {deptLabel.toLowerCase()} &amp; {classLabel.toLowerCase()} independently per {cycleLabel.toLowerCase()} (e.g. Family Healthcare vs CHEW vs Public Health). Registered {subjectPlural.toLowerCase()} flow directly into Exam Grading &amp; CGPA compilation.
            </p>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenBulkCourses(classId || '', activeSemesterCanonical, department || '')}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5 text-emerald-700" />
                Bulk Add {subjectPlural}
              </button>
              <button
                type="button"
                onClick={onOpenHistoricalBacklog}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
              >
                <History className="w-3.5 h-3.5 text-emerald-400" />
                Upload Previous Years / Backlog
              </button>
            </div>
          )}
        </div>

        {/* Cycle, Class, Department & Type Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Academic Session
            </label>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.status === 'ACTIVE' ? '(Active)' : '(Archived)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
              {cycleLabel} / Scope
            </label>
            <select
              value={termId}
              onChange={(e) => handleSelectTermTab(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
            >
              {sessionTerms.length === 0 ? (
                <option value="">No {cycleLabel.toLowerCase()}s configured</option>
              ) : (
                <>
                  {sessionTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value="__ALL__">
                    Full Session Combined (All {cycleLabel}s)
                  </option>
                </>
              )}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
              {classLabel}
            </label>
            <select
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSelectedStudentIds([]);
                setSelectedSubjectIds([]);
              }}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All {classLabel}s</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
              {deptLabel}
            </label>
            <select
              value={department}
              onChange={(e) => handleSelectDepartment(e.target.value)}
              aria-label={`Filter by ${deptLabel}`}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
            >
              <option value="">All Departments</option>
              {availableDepartments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Registration Type
            </label>
            <select
              value={registrationType}
              onChange={(e) => setRegistrationType(e.target.value as any)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="REGULAR">Regular ({cycleLabel})</option>
              <option value="CARRYOVER">Carryover / Retake</option>
              <option value="ELECTIVE">Elective / Optional</option>
              <option value="HISTORICAL">Historical / Previous Year</option>
            </select>
          </div>
        </div>

        {/* One-Click Department Switcher Bar */}
        {availableDepartments.length > 0 && (
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500 mr-1 flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
              {deptLabel}:
            </span>
            <button
              type="button"
              onClick={() => handleSelectDepartment('')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                !department
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              All ({students.filter((s) => !classId || s.class_id === classId).length})
            </button>
            {availableDepartments.map((deptName) => {
              const deptStuCount = students.filter(
                (s) =>
                  (!classId || s.class_id === classId) &&
                  (s.class_arm_name || '').trim().toLowerCase() === deptName.toLowerCase()
              ).length;
              const isSelected = department.toLowerCase() === deptName.toLowerCase();
              return (
                <button
                  key={deptName}
                  type="button"
                  onClick={() => handleSelectDepartment(deptName)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {deptName}{' '}
                  <span className={`tabular-nums ${isSelected ? 'text-emerald-100' : 'text-slate-400'}`}>
                    ({deptStuCount})
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* One-Click Level x Semester Switcher Bar */}
        {sessionTerms.length > 0 && (
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 mr-1 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-emerald-600" />
                {selectedClassName ? `${selectedClassName} · ` : ''}Split by {cycleLabel}:
              </span>
              {sessionTerms.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelectTermTab(t.id)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    termId === t.id
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {t.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleSelectTermTab('__ALL__')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  isFullSessionView
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Full Session Combined
              </button>
            </div>

            {isFullSessionView && onOpenSessionReports && (
              <button
                type="button"
                onClick={onOpenSessionReports}
                className="px-3 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 flex items-center gap-1.5 cursor-pointer"
              >
                <Award className="w-3.5 h-3.5" />
                Compile End-of-Session Results / CGPA
              </button>
            )}

            {!isFullSessionView && isAdmin && onLaunchGradingFromRegistrations && registrations.length > 0 && (
              <button
                type="button"
                disabled={launchingGrading}
                onClick={handleLaunchGrading}
                className="px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-emerald-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  {launchingGrading
                    ? 'Opening Grading Queue...'
                    : `Grade Registered ${subjectPlural}${department ? ` (${department})` : ''}`}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Full-Session Combined Banner */}
      {isFullSessionView && (
        <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              End-of-Session Aggregated View · {selectedSession?.name}
            </p>
            <p className="text-xs text-slate-300 mt-0.5">
              Showing combined {subjectPlural.toLowerCase()} across all {cycleLabel.toLowerCase()}s for each {learnerLabel.toLowerCase()}. Select a specific {cycleLabel.toLowerCase()} tab above (e.g. 1st or 2nd {cycleLabel}) to register new {subjectPlural.toLowerCase()}.
            </p>
          </div>
          {onOpenSessionReports && (
            <button
              type="button"
              onClick={onOpenSessionReports}
              className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Award className="w-4 h-4" />
              Go to Full-Session Cumulative Results
            </button>
          )}
        </div>
      )}

      {/* Admin Bulk Registration Builder (Active when a specific Semester / Term is selected) */}
      {isAdmin && !isFullSessionView && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTargetMode('CLASS')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                  targetMode === 'CLASS'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {department
                  ? `Whole ${cohortTitle} Cohort (${classId || department ? filteredStudents.length : 0})`
                  : `Whole ${classLabel} (${classId ? filteredStudents.length : 0})`}
              </button>
              <button
                type="button"
                onClick={() => setTargetMode('STUDENTS')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                  targetMode === 'STUDENTS'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Specific {learnerPlural} ({selectedStudentIds.length})
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs tabular-nums">
              <span className="text-slate-600">
                Selected: <strong className="text-slate-900">{selectedSubjectIds.length}</strong> {subjectPlural.toLowerCase()}
              </span>
              <span className="text-slate-300">·</span>
              <span
                className={`font-semibold ${
                  selectedUnitsSum > policy.max_credit_units_per_cycle ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {selectedUnitsSum} / {policy.max_credit_units_per_cycle} max units ({selectedTerm?.name || cycleLabel})
              </span>
            </div>
          </div>

          {/* Specific Students Picker (when targetMode === STUDENTS) */}
          {targetMode === 'STUDENTS' && (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50/50">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-500" />
                  Select {learnerPlural} ({selectedStudentIds.length} of {filteredStudents.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedStudentIds(filteredStudents.map((s) => s.id))}
                    className="text-emerald-700 hover:underline font-medium"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStudentIds([])}
                    className="text-slate-500 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
                {filteredStudents.map((stu) => {
                  const checked = selectedStudentIds.includes(stu.id);
                  return (
                    <button
                      key={stu.id}
                      type="button"
                      onClick={() => toggleStudent(stu.id)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left text-xs transition-colors ${
                        checked
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {checked ? (
                        <CheckSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="truncate block font-medium">{stu.full_name}</span>
                        {stu.class_arm_name && (
                          <span className="text-[10px] text-slate-500 truncate block">{stu.class_arm_name}</span>
                        )}
                      </div>
                      <span className="ml-auto text-[10px] font-mono text-slate-500 shrink-0">{stu.admission_number}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Course / Subject Checklist with Per-Registration Credit Units Override */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">
                  Select {department ? `${department} ` : ''}
                  {selectedTerm ? `${selectedTerm.name} ` : ''}
                  {subjectPlural} (adjust credit units inline if needed)
                </span>
                {department && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer bg-emerald-50/70 px-2 py-0.5 rounded border border-emerald-200">
                    <input
                      type="checkbox"
                      checked={includeGeneralCourses}
                      onChange={(e) => setIncludeGeneralCourses(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    Include General / Shared (GST/GNS)
                  </label>
                )}
                {hiddenOtherCount > 0 && registrationType !== 'CARRYOVER' && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                    <input
                      type="checkbox"
                      checked={showOtherSemesters}
                      onChange={(e) => setShowOtherSemesters(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    Show {hiddenOtherCount} from other departments / levels (carryovers)
                  </label>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSubjectIds(matchingCycleSubjects.map((s) => s.id));
                  }}
                  className="text-emerald-700 hover:underline font-medium cursor-pointer"
                >
                  Select Matching ({matchingCycleSubjects.length})
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setSelectedSubjectIds([])}
                  className="text-slate-500 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            {activeSubjects.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-slate-300 rounded-lg text-xs text-slate-500">
                No {subjectPlural.toLowerCase()} configured yet. Click <strong>Bulk Add {subjectPlural}</strong> above to add your curriculum in seconds.
              </div>
            ) : displayedSubjects.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 space-y-2">
                <p>
                  No {subjectPlural.toLowerCase()} tagged for <strong>{department || 'this filter'}</strong> in{' '}
                  <strong>{selectedTerm?.name || cycleLabel}</strong> yet.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenBulkCourses(classId || '', activeSemesterCanonical, department || '')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold cursor-pointer"
                  >
                    Bulk Upload {department ? `${department} ` : ''}{subjectPlural}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowOtherSemesters(true)}
                    className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-50 cursor-pointer"
                  >
                    Show All {activeSubjects.length} Catalog {subjectPlural}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                {displayedSubjects.map((sub) => {
                  const checked = selectedSubjectIds.includes(sub.id);
                  const currentUnits =
                    unitOverrides[sub.id] !== undefined
                      ? unitOverrides[sub.id]
                      : String(sub.credit_units ?? 3);
                  const semLabel = formatSemesterTagLabel(sub.semester_tag, cycleLabel, cycleLabels);
                  const deptDisplay = (sub.department || '').trim() || 'General / Shared';
                  return (
                    <div
                      key={sub.id}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border transition-colors ${
                        checked
                          ? 'bg-emerald-50/70 border-emerald-300'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSubject(sub.id)}
                        className="flex items-center gap-2 text-left min-w-0 flex-1 cursor-pointer"
                      >
                        {checked ? (
                          <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            <span className="font-mono text-emerald-800 mr-1.5">{sub.code}</span>
                            {sub.name}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            <span className="font-medium text-slate-700">{deptDisplay}</span> ·{' '}
                            {sub.class_name || `All ${classLabel}s`} · {semLabel}
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={0}
                          max={12}
                          value={currentUnits}
                          onChange={(e) =>
                            setUnitOverrides((prev) => ({ ...prev, [sub.id]: e.target.value }))
                          }
                          aria-label={`${sub.name} credit units`}
                          className="w-11 px-1.5 py-1 text-xs font-semibold text-center tabular-nums border border-slate-200 rounded bg-white"
                        />
                        <span className="text-[10px] text-slate-500">u</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedUnitsSum > policy.max_credit_units_per_cycle && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>
                Selected load ({selectedUnitsSum} units) exceeds your institutional maximum of {policy.max_credit_units_per_cycle} credit units per {cycleLabel.toLowerCase()}. You can still override and register if approved.
              </span>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={saving || selectedSubjectIds.length === 0}
              onClick={handleBulkRegister}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {saving
                ? 'Registering...'
                : targetMode === 'CLASS'
                ? `Bulk Register ${selectedSubjectIds.length} ${subjectPlural} for ${cohortTitle} (${selectedTerm?.name || cycleLabel})`
                : `Register ${selectedSubjectIds.length} ${subjectPlural} for ${selectedStudentIds.length} ${learnerPlural}`}
            </button>
          </div>
        </div>
      )}

      {/* Registered Roster Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              {isFullSessionView
                ? `Full-Session Aggregated ${subjectPlural} Ledger (${selectedSession?.name || ''})`
                : `Registered ${subjectPlural} Ledger · ${selectedTerm?.name || ''}${department ? ` · ${department}` : ''}`}{' '}
              ({registrations.length} registrations · {studentSummaries.length} {learnerPlural.toLowerCase()})
            </h4>
          </div>
          <div className="flex items-center gap-2">
            {!isFullSessionView && isAdmin && onLaunchGradingFromRegistrations && registrations.length > 0 && (
              <button
                type="button"
                disabled={launchingGrading}
                onClick={handleLaunchGrading}
                className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
                <span>Grade Registered {subjectPlural} →</span>
              </button>
            )}
            <button
              type="button"
              onClick={loadRegistrations}
              className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading course registrations...</div>
        ) : studentSummaries.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No {subjectPlural.toLowerCase()} registered for this selection yet. Use the bulk registration form above or upload historical records.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {studentSummaries.map((stu) => (
              <div key={stu.student_id} className="p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 flex flex-wrap items-center gap-2">
                      <span>{stu.student_name}</span>
                      {stu.admission_number && (
                        <span className="text-xs font-mono font-normal text-slate-500">
                          {stu.admission_number}
                        </span>
                      )}
                      {stu.department && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          {stu.department}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                      {stu.class_name || 'Unassigned'} · {stu.courses_count} {subjectPlural.toLowerCase()} ·{' '}
                      <span className={stu.exceeds_max_units ? 'text-red-600 font-semibold' : 'text-slate-700 font-semibold'}>
                        {stu.total_credit_units} {isFullSessionView ? 'Session Total Credit Units' : 'Credit Units'}
                        {stu.exceeds_max_units ? ` (Exceeds ${policy.max_credit_units_per_cycle} max/${cycleLabel.toLowerCase()})` : ''}
                      </span>
                    </p>
                    {isFullSessionView && stu.term_breakdown && stu.term_breakdown.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {stu.term_breakdown.map((tb) => (
                          <span
                            key={tb.term_id}
                            className={`text-[11px] px-2 py-0.5 rounded border tabular-nums ${
                              tb.exceeds_max_units
                                ? 'bg-red-50 border-red-200 text-red-700 font-semibold'
                                : 'bg-slate-50 border-slate-200 text-slate-700'
                            }`}
                          >
                            {tb.term_name}: <strong>{tb.courses_count}</strong> {subjectPlural.toLowerCase()} ({tb.total_credit_units}u)
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setPrintingStudentId(stu.student_id)}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    {isFullSessionView ? 'Session Course Form' : 'Course Form Slip'}
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="text-[11px] text-slate-500 border-b border-slate-100">
                      <tr>
                        {isFullSessionView && <th className="py-1.5 pr-3">{cycleLabel}</th>}
                        <th className="py-1.5 pr-3">Code</th>
                        <th className="py-1.5 pr-3">{subjectLabel}</th>
                        <th className="py-1.5 pr-3">Department</th>
                        <th className="py-1.5 pr-3">Units</th>
                        <th className="py-1.5 pr-3">Type</th>
                        {isAdmin && <th className="py-1.5 text-right">Action</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {stu.courses.map((c) => (
                        <tr key={c.id}>
                          {isFullSessionView && (
                            <td className="py-1.5 pr-3 text-slate-600 font-medium whitespace-nowrap">
                              {c.term_name || '—'}
                            </td>
                          )}
                          <td className="py-1.5 pr-3 font-mono font-semibold text-slate-700">{c.subject_code}</td>
                          <td className="py-1.5 pr-3 text-slate-800">{c.subject_name}</td>
                          <td className="py-1.5 pr-3 text-slate-500">{c.subject_department || 'General'}</td>
                          <td className="py-1.5 pr-3 font-semibold tabular-nums text-slate-900">{c.credit_units}</td>
                          <td className="py-1.5 pr-3 text-slate-500">{c.registration_type}</td>
                          {isAdmin && (
                            <td className="py-1.5 text-right">
                              <button
                                type="button"
                                onClick={() => handleDropRegistration(c.id)}
                                className="text-slate-400 hover:text-red-600 p-1 cursor-pointer"
                                title="Drop registration"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Printable Course Registration Slip Modal */}
      {printingStudent && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between print:hidden">
              <h4 className="text-sm font-bold text-slate-900">
                Official {subjectLabel} Registration Form
              </h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Slip
                </button>
                <button
                  type="button"
                  onClick={() => setPrintingStudentId(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="border-b border-slate-200 pb-3 flex justify-between items-start">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{printingStudent.student_name}</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    ID: <span className="font-mono font-semibold">{printingStudent.admission_number || '—'}</span> ·{' '}
                    {classLabel}: <strong>{printingStudent.class_name || '—'}</strong>
                    {printingStudent.department && (
                      <>
                        {' '}· Department: <strong>{printingStudent.department}</strong>
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-600">
                  <p className="font-semibold text-slate-900">{selectedSession?.name || ''}</p>
                  <p>{isFullSessionView ? `Full Session (All ${cycleLabel}s)` : selectedTerm?.name || ''}</p>
                </div>
              </div>

              <table className="w-full text-left text-xs border border-slate-200 border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    {isFullSessionView && <th className="px-3 py-2 border-r border-slate-200">{cycleLabel}</th>}
                    <th className="px-3 py-2 border-r border-slate-200">Code</th>
                    <th className="px-3 py-2 border-r border-slate-200">{subjectLabel} Title</th>
                    <th className="px-3 py-2 border-r border-slate-200 text-center">Units</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {printingStudent.courses.map((c) => (
                    <tr key={c.id}>
                      {isFullSessionView && (
                        <td className="px-3 py-2 border-r border-slate-200 font-medium">{c.term_name || '—'}</td>
                      )}
                      <td className="px-3 py-2 border-r border-slate-200 font-mono font-semibold">{c.subject_code}</td>
                      <td className="px-3 py-2 border-r border-slate-200">{c.subject_name}</td>
                      <td className="px-3 py-2 border-r border-slate-200 text-center font-semibold tabular-nums">{c.credit_units}</td>
                      <td className="px-3 py-2">{c.registration_type}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 font-bold">
                  <tr>
                    <td colSpan={isFullSessionView ? 3 : 2} className="px-3 py-2 text-right border-r border-slate-200">
                      Total Registered Credit Units
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums border-r border-slate-200">
                      {printingStudent.total_credit_units}
                    </td>
                    <td className="px-3 py-2">{printingStudent.courses_count} {subjectPlural}</td>
                  </tr>
                </tfoot>
              </table>

              {isTertiary && (
                <div className="grid grid-cols-2 gap-8 pt-6 text-xs text-slate-500">
                  <div className="border-t border-slate-300 pt-1.5">Academic Adviser Signature &amp; Date</div>
                  <div className="border-t border-slate-300 pt-1.5">Head of Department / Registrar Stamp</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
