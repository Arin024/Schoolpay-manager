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
  Plus,
  CalendarPlus,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import { ModalPortal } from '../common/ModalPortal';
import {
  AcademicSessionItem,
  ClassItem,
  CourseRegistrationItem,
  CourseRegistrationMatrixItem,
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
    prefillDepartment?: string,
    prefillSessionId?: string
  ) => void;
  onSessionsChanged?: () => Promise<void> | void;
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
  onSessionsChanged,
  onOpenSessionReports,
  onLaunchGradingFromRegistrations,
  onToast,
}) => {
  const activeSession = sessions.find((s) => s.status === 'ACTIVE') || sessions[0];
  const [sessionId, setSessionId] = useState(activeSession?.id || '');
  // termId === '__ALL__' shows read-only Full-Session Combined ledger;
  // termId === '__BATCH_ALL__' enables registering across multiple semesters (e.g. 1st & 2nd Semester) in one batch!
  const [termId, setTermId] = useState(activeSession?.terms?.[0]?.id || '');
  const [batchTermIds, setBatchTermIds] = useState<string[]>([]);
  const [classId, setClassId] = useState('');
  const [department, setDepartment] = useState('');
  const [includeGeneralCourses, setIncludeGeneralCourses] = useState(true);
  const [targetMode, setTargetMode] = useState<'CLASS' | 'STUDENTS'>('CLASS');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [unitOverrides, setUnitOverrides] = useState<Record<string, string>>({});
  const [registrationType, setRegistrationType] = useState<'REGULAR' | 'CARRYOVER' | 'ELECTIVE' | 'HISTORICAL'>('REGULAR');
  const [showOtherSemesters, setShowOtherSemesters] = useState(false);

  // Inline Academic Session quick-configurator state
  const [showAddSessionBar, setShowAddSessionBar] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionStatus, setNewSessionStatus] = useState<'COMPLETED' | 'ACTIVE' | 'UPCOMING'>('COMPLETED');
  const [newSessionAutoTerms, setNewSessionAutoTerms] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);
  const [ensuringTerms, setEnsuringTerms] = useState(false);

  // Configured Session x Department Matrix
  const [matrix, setMatrix] = useState<CourseRegistrationMatrixItem[]>([]);

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
  const isBatchMultiSemesterMode = termId === '__BATCH_ALL__';
  const showCombinedLedger = isFullSessionView || isBatchMultiSemesterMode;
  const selectedTerm = useMemo(
    () => (showCombinedLedger ? null : sessionTerms.find((t) => t.id === termId) || null),
    [sessionTerms, termId, showCombinedLedger]
  );
  const activeSemesterCanonical: CanonicalSemesterTag = useMemo(
    () => (selectedTerm ? normalizeSemesterTag(selectedTerm.name) : ''),
    [selectedTerm]
  );

  const expectedCycleCount = useMemo(() => {
    if (Array.isArray(cycleLabels) && cycleLabels.length > 0) return cycleLabels.length;
    return isTertiary ? 2 : 3;
  }, [cycleLabels, isTertiary]);

  const suggestedNewSessions = useMemo(() => {
    const existingNames = new Set(sessions.map((s) => s.name.trim().toLowerCase()));
    const currentYear = new Date().getFullYear();
    const candidates: string[] = [];
    for (let y = currentYear - 4; y <= currentYear + 1; y++) {
      candidates.push(`${y}/${y + 1}`);
    }
    return candidates.filter((c) => !existingNames.has(c.toLowerCase()));
  }, [sessions]);

  // Keep batchTermIds synced with the active session's available terms
  useEffect(() => {
    const validIds = sessionTerms.map((t) => t.id);
    setBatchTermIds((prev) => {
      const kept = prev.filter((id) => validIds.includes(id));
      return kept.length > 0 ? kept : validIds;
    });
  }, [sessionId, sessionTerms.length]);

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
    matrix.forEach((m) => add(m.department));
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [departments, classes, students, subjects, departmentSummaries, matrix]);

  useEffect(() => {
    if (!sessionId && sessions.length > 0) {
      const def = sessions.find((s) => s.status === 'ACTIVE') || sessions[0];
      setSessionId(def.id);
      if (def.terms?.[0]) setTermId(def.terms[0].id);
    }
  }, [sessions, sessionId]);

  useEffect(() => {
    if (!selectedSession) return;
    if (termId === '__ALL__') return;
    if (termId === '__BATCH_ALL__') {
      if (sessionTerms.length < 2) {
        setTermId(sessionTerms[0]?.id || '');
      }
      return;
    }
    if (!termId || !sessionTerms.some((t) => t.id === termId)) {
      setTermId(sessionTerms[0]?.id || '');
    }
  }, [selectedSession, sessionTerms, termId]);

  const loadMatrix = async () => {
    try {
      const res = await api.getCourseRegistrationMatrix();
      setMatrix(res.matrix || []);
    } catch {
      // Non-blocking overview strip
    }
  };

  const loadRegistrations = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await api.getCourseRegistrations({
        academic_session_id: sessionId || undefined,
        term_id: showCombinedLedger ? undefined : termId || undefined,
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
    loadMatrix();
  }, [sessions.length]);

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

  // Courses strictly matching the selected Level (classId), Department, AND selected Semester(s)
  const matchingCycleSubjects = useMemo(() => {
    const deptKey = department.trim().toLowerCase();
    const activeBatchTerms = sessionTerms.filter((t) => batchTermIds.includes(t.id));
    return activeSubjects.filter((s) => {
      const matchesClass = !classId || !s.class_id || s.class_id === classId;
      let matchesSem = true;
      if (isBatchMultiSemesterMode) {
        matchesSem =
          activeBatchTerms.length === 0 ||
          !s.semester_tag ||
          activeBatchTerms.some((t) => termMatchesSemesterTag(t.name, s.semester_tag));
      } else if (selectedTerm) {
        matchesSem = termMatchesSemesterTag(selectedTerm.name, s.semester_tag);
      }
      if (!matchesClass || !matchesSem) return false;
      if (!deptKey) return true;
      const subDept = (s.department || '').trim().toLowerCase();
      if (subDept === deptKey) return true;
      if (includeGeneralCourses && isGeneralOrSharedCourse(s)) return true;
      return false;
    });
  }, [activeSubjects, classId, selectedTerm, isBatchMultiSemesterMode, sessionTerms, batchTermIds, department, includeGeneralCourses]);

  const displayedSubjects = useMemo(() => {
    if (showOtherSemesters || registrationType === 'CARRYOVER') {
      return activeSubjects;
    }
    return matchingCycleSubjects;
  }, [activeSubjects, matchingCycleSubjects, showOtherSemesters, registrationType]);

  const hiddenOtherCount = Math.max(0, activeSubjects.length - matchingCycleSubjects.length);

  // Per-semester target helper for Multi-Semester Batch mode
  const resolveTargetTermsForSubject = (sub: SubjectItem) => {
    const chosenTerms = sessionTerms.filter((t) => batchTermIds.includes(t.id));
    if (!isBatchMultiSemesterMode) return selectedTerm ? [selectedTerm] : [];
    if (chosenTerms.length <= 1) return chosenTerms;
    const tag = normalizeSemesterTag(sub.semester_tag);
    if (tag) {
      const matched = chosenTerms.filter((t) => normalizeSemesterTag(t.name) === tag);
      if (matched.length > 0) return matched;
    }
    return chosenTerms;
  };

  const selectedUnitsSum = useMemo(() => {
    return selectedSubjectIds.reduce((sum, id) => {
      const sub = activeSubjects.find((s) => s.id === id);
      const raw = unitOverrides[id] !== undefined ? Number(unitOverrides[id]) : Number(sub?.credit_units ?? 3);
      return sum + (Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0);
    }, 0);
  }, [selectedSubjectIds, unitOverrides, activeSubjects]);

  const perBatchTermUnits = useMemo(() => {
    if (!isBatchMultiSemesterMode) return [] as Array<{ term_id: string; term_name: string; units: number; count: number }>;
    const chosen = sessionTerms.filter((t) => batchTermIds.includes(t.id));
    return chosen.map((t) => {
      let units = 0;
      let count = 0;
      for (const id of selectedSubjectIds) {
        const sub = activeSubjects.find((s) => s.id === id);
        if (!sub) continue;
        const targets = resolveTargetTermsForSubject(sub);
        if (targets.some((x) => x.id === t.id)) {
          const raw = unitOverrides[id] !== undefined ? Number(unitOverrides[id]) : Number(sub.credit_units ?? 3);
          units += Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0;
          count += 1;
        }
      }
      return { term_id: t.id, term_name: t.name, units, count };
    });
  }, [isBatchMultiSemesterMode, sessionTerms, batchTermIds, selectedSubjectIds, activeSubjects, unitOverrides]);

  const anyBatchTermOverloaded = isBatchMultiSemesterMode
    ? perBatchTermUnits.some((x) => x.units > policy.max_credit_units_per_cycle)
    : selectedUnitsSum > policy.max_credit_units_per_cycle;

  const toggleSubject = (id: string) => {
    setSelectedSubjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleBatchTerm = (id: string) => {
    setBatchTermIds((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((x) => x !== id) : prev;
      }
      return [...prev, id];
    });
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

  const handleCreateQuickSession = async () => {
    const cleanName = newSessionName.trim();
    if (!cleanName) {
      onToast('error', 'Enter an Academic Session name (e.g. 2024/2025).');
      return;
    }
    setCreatingSession(true);
    try {
      const res = await api.createAcademicSession({
        name: cleanName,
        status: newSessionStatus,
        auto_create_terms: newSessionAutoTerms,
        reuse_existing: true,
      });
      if (onSessionsChanged) {
        await onSessionsChanged();
      }
      const createdSession = res.session;
      if (createdSession?.id) {
        setSessionId(createdSession.id);
        const createdTerms = createdSession.terms || [];
        if (createdTerms.length >= 2) {
          setBatchTermIds(createdTerms.map((t) => t.id));
          setTermId('__BATCH_ALL__');
        } else if (createdTerms[0]?.id) {
          setTermId(createdTerms[0].id);
        } else {
          setTermId('');
        }
        if (newSessionStatus === 'COMPLETED') {
          setRegistrationType('HISTORICAL');
        }
      }
      setNewSessionName('');
      setShowAddSessionBar(false);
      onToast('success', res.message || `Session "${cleanName}" is ready for course registration.`);
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to configure academic session.');
    } finally {
      setCreatingSession(false);
    }
  };

  const handleEnsureTerms = async () => {
    if (!sessionId) return;
    setEnsuringTerms(true);
    try {
      const res = await api.ensureAcademicSessionTerms(sessionId);
      if (onSessionsChanged) {
        await onSessionsChanged();
      }
      if (res.terms && res.terms.length > 0) {
        setBatchTermIds(res.terms.map((t) => t.id));
        if (!termId || termId === '') {
          setTermId(res.terms[0].id);
        }
      }
      onToast('success', res.message);
    } catch (err: any) {
      onToast('error', err?.message || `Failed to setup ${cycleLabel.toLowerCase()}s.`);
    } finally {
      setEnsuringTerms(false);
    }
  };

  const handleBulkRegister = async () => {
    if (!sessionId || isFullSessionView) {
      onToast('error', `Select a specific Academic Session and ${cycleLabel} first.`);
      return;
    }
    const targetTermList = isBatchMultiSemesterMode ? batchTermIds : termId ? [termId] : [];
    if (targetTermList.length === 0) {
      onToast('error', `Select at least one ${cycleLabel} (or click Setup ${cycleLabel}s first).`);
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
        term_id: targetTermList.length === 1 ? targetTermList[0] : undefined,
        term_ids: targetTermList,
        auto_match_semester_tag: isBatchMultiSemesterMode,
        class_id: classId || null,
        department: department || null,
        student_ids: targetMode === 'STUDENTS' ? selectedStudentIds : undefined,
        subject_ids: subjectPayload,
        registration_type: registrationType,
      });

      onToast('success', res.message);
      await Promise.all([loadRegistrations(), loadMatrix()]);
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
      await Promise.all([loadRegistrations(), loadMatrix()]);
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to drop registration.');
    }
  };

  const handleLaunchGrading = async (overrideTermId?: string) => {
    const resolvedTermId = overrideTermId || (!showCombinedLedger ? termId : sessionTerms[0]?.id || '');
    if (!onLaunchGradingFromRegistrations || !sessionId || !resolvedTermId) return;
    setLaunchingGrading(true);
    try {
      await onLaunchGradingFromRegistrations({
        academic_session_id: sessionId,
        term_id: resolvedTermId,
        class_id: classId || null,
        department: department || null,
      });
    } finally {
      setLaunchingGrading(false);
    }
  };

  const formatSessionStatusBadge = (status?: string) => {
    const st = String(status || '').toUpperCase();
    if (st === 'ACTIVE') return '(Active)';
    if (st === 'UPCOMING') return '(Upcoming)';
    return '(Historical)';
  };

  const printingStudent = printingStudentId
    ? studentSummaries.find((s) => s.student_id === printingStudentId) || null
    : null;

  const selectedClassName = classId ? classes.find((c) => c.id === classId)?.name || '' : '';
  const deptLabel = isTertiary ? 'Department / Programme' : 'Department / Arm';
  const cohortTitle = [selectedClassName, department].filter(Boolean).join(' · ') || classLabel;
  const activeBatchTermNames = sessionTerms
    .filter((t) => batchTermIds.includes(t.id))
    .map((t) => t.name)
    .join(' & ');

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
                onClick={() => setShowAddSessionBar((v) => !v)}
                className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 flex items-center gap-1.5 cursor-pointer"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                {showAddSessionBar ? 'Close Session Setup' : '+ Add / Configure Session'}
              </button>
              <button
                type="button"
                onClick={() => onOpenBulkCourses(classId || '', activeSemesterCanonical, department || '', sessionId || '')}
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

        {/* Inline Quick-Configure Academic Session Drawer (e.g. 2024/2025 with 1st & 2nd Semester) */}
        {isAdmin && showAddSessionBar && (
          <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <CalendarPlus className="w-4 h-4 text-emerald-700" />
                  Configure Any Academic Session for Course Registration (e.g. 2024/2025, 2023/2024, 2026/2027)
                </p>
                <p className="text-[11px] text-emerald-800 mt-0.5">
                  Create past, current, or upcoming sessions with automatic {isTertiary ? '1st & 2nd Semester' : '1st, 2nd & 3rd Term'} setup — register different sessions for different departments without disturbing your current active session.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddSessionBar(false)}
                className="p-1 rounded-lg text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                aria-label="Close session configurator"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {suggestedNewSessions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-emerald-900">Quick-pick:</span>
                {suggestedNewSessions.map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => {
                      setNewSessionName(yr);
                      const startYr = parseInt(yr.split('/')[0], 10);
                      const curYr = new Date().getFullYear();
                      setNewSessionStatus(startYr < curYr ? 'COMPLETED' : startYr === curYr ? 'UPCOMING' : 'UPCOMING');
                    }}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      newSessionName === yr
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                    }`}
                  >
                    + {yr}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-semibold text-emerald-950 mb-1">
                  Session Name *
                </label>
                <input
                  type="text"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="e.g. 2024/2025"
                  aria-label="New Academic Session Name"
                  className="w-full px-3 py-2 text-xs bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-emerald-950 mb-1">
                  Session Role
                </label>
                <select
                  value={newSessionStatus}
                  onChange={(e) => setNewSessionStatus(e.target.value as any)}
                  aria-label="New Academic Session Status"
                  className="w-full px-3 py-2 text-xs bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="COMPLETED">Past / Historical (Keeps Active Session)</option>
                  <option value="UPCOMING">Upcoming Session</option>
                  <option value="ACTIVE">Set as Current Active Session</option>
                </select>
              </div>
              <div className="sm:col-span-3 flex items-center py-2">
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newSessionAutoTerms}
                    onChange={(e) => setNewSessionAutoTerms(e.target.checked)}
                    className="rounded border-emerald-400 text-emerald-600"
                  />
                  Auto-add {isTertiary ? '1st & 2nd Semester' : '1st–3rd Term'}
                </label>
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  disabled={creatingSession || !newSessionName.trim()}
                  onClick={handleCreateQuickSession}
                  className="w-full px-3 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {creatingSession ? 'Configuring...' : 'Create & Select'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Configured Sessions x Departments Overview Matrix (Jump between e.g. 2024/2025 FHC vs 2025/2026 CHEW in 1 click) */}
        {matrix.length > 0 && (
          <div className="pt-2 border-t border-slate-100 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                Configured Sessions × Departments ({matrix.length})
              </span>
              <span className="text-[11px] text-slate-400">Click any card to jump directly to that session &amp; department</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {matrix.map((item) => {
                const isCurrent =
                  sessionId === item.academic_session_id &&
                  (item.department === 'General / Unassigned'
                    ? !department
                    : department.toLowerCase() === item.department.toLowerCase());
                return (
                  <button
                    key={`${item.academic_session_id}-${item.department}`}
                    type="button"
                    onClick={() => {
                      setSessionId(item.academic_session_id);
                      setDepartment(item.department === 'General / Unassigned' ? '' : item.department);
                      setSelectedStudentIds([]);
                      setSelectedSubjectIds([]);
                      if (item.terms.length >= 2) {
                        setTermId('__BATCH_ALL__');
                      } else if (item.terms[0]?.term_id) {
                        setTermId(item.terms[0].term_id);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-emerald-50 hover:border-emerald-300'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <span>{item.session_name}</span>
                      <span className={isCurrent ? 'text-emerald-400' : 'text-slate-400'}>·</span>
                      <span>{item.department}</span>
                    </div>
                    <div className={`text-[10px] mt-0.5 tabular-nums ${isCurrent ? 'text-slate-300' : 'text-slate-500'}`}>
                      {item.terms.map((t) => t.term_name).join(' & ')} · {item.students_count}{' '}
                      {item.students_count === 1 ? learnerLabel.toLowerCase() : learnerPlural.toLowerCase()} ·{' '}
                      {item.registrations_count} regs
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Cycle, Class, Department & Type Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                Academic Session
              </label>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAddSessionBar(true)}
                  className="text-[11px] font-semibold text-emerald-700 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> New
                </button>
              )}
            </div>
            <select
              value={sessionId}
              aria-label="Academic Session"
              onChange={(e) => {
                const nextId = e.target.value;
                setSessionId(nextId);
                setSelectedSubjectIds([]);
                const nextSes = sessions.find((s) => s.id === nextId);
                if (nextSes && nextSes.status !== 'ACTIVE') {
                  setRegistrationType('HISTORICAL');
                } else {
                  setRegistrationType('REGULAR');
                }
              }}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
            >
              {sessions.length === 0 ? (
                <option value="">No sessions yet — click + New</option>
              ) : (
                sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {formatSessionStatusBadge(s.status)}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                {cycleLabel} / Scope
              </label>
              {isAdmin && selectedSession && sessionTerms.length < expectedCycleCount && (
                <button
                  type="button"
                  disabled={ensuringTerms}
                  onClick={handleEnsureTerms}
                  className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer disabled:opacity-50"
                >
                  {ensuringTerms ? 'Setting up...' : `+ Auto-Setup ${cycleLabel}s`}
                </button>
              )}
            </div>
            <select
              value={termId}
              aria-label={`${cycleLabel} Scope`}
              onChange={(e) => handleSelectTermTab(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
            >
              {sessionTerms.length === 0 ? (
                <option value="">No {cycleLabel.toLowerCase()}s — click + Auto-Setup</option>
              ) : (
                <>
                  {sessionTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  {sessionTerms.length >= 2 && (
                    <option value="__BATCH_ALL__">
                      {sessionTerms.map((t) => t.name).join(' & ')} (Register Together)
                    </option>
                  )}
                  <option value="__ALL__">
                    Full Session Combined (Ledger View)
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

        {/* Missing Semesters Quick-Fix Banner (when selected session has 0 terms) */}
        {isAdmin && selectedSession && sessionTerms.length === 0 && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
            <span>
              <strong>{selectedSession.name}</strong> has no {cycleLabel.toLowerCase()}s configured yet. Click to automatically create{' '}
              <strong>{isTertiary ? '1st Semester & 2nd Semester' : '1st, 2nd & 3rd Term'}</strong>.
            </span>
            <button
              type="button"
              disabled={ensuringTerms}
              onClick={handleEnsureTerms}
              className="px-3 py-1.5 text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {ensuringTerms ? 'Setting up...' : `Auto-Setup ${isTertiary ? '1st & 2nd Semester' : 'Terms'}`}
            </button>
          </div>
        )}

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

        {/* One-Click Level x Semester Switcher Bar (Single Semester, 1st & 2nd Together, or Combined Ledger) */}
        {sessionTerms.length > 0 && (
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 mr-1 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-emerald-600" />
                {selectedSession?.name ? `${selectedSession.name} · ` : ''}
                {selectedClassName ? `${selectedClassName} · ` : ''}
                {cycleLabel}s:
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
              {sessionTerms.length >= 2 && (
                <button
                  type="button"
                  onClick={() => handleSelectTermTab('__BATCH_ALL__')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isBatchMultiSemesterMode
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  {isTertiary ? '1st & 2nd Semester (Register Both)' : `All ${cycleLabel}s (Register Together)`}
                </button>
              )}
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

            {showCombinedLedger && onOpenSessionReports && (
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
                onClick={() => handleLaunchGrading()}
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
              Showing combined {subjectPlural.toLowerCase()} across all {cycleLabel.toLowerCase()}s for each {learnerLabel.toLowerCase()}. Select a specific {cycleLabel.toLowerCase()} tab or <strong>1st &amp; 2nd {cycleLabel} (Register Both)</strong> above to register new {subjectPlural.toLowerCase()}.
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

            <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
              <span className="text-slate-600">
                Selected: <strong className="text-slate-900">{selectedSubjectIds.length}</strong> {subjectPlural.toLowerCase()}
              </span>
              <span className="text-slate-300">·</span>
              {isBatchMultiSemesterMode ? (
                <div className="flex flex-wrap items-center gap-2">
                  {perBatchTermUnits.map((bt) => (
                    <span
                      key={bt.term_id}
                      className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                        bt.units > policy.max_credit_units_per_cycle
                          ? 'bg-red-50 border-red-200 text-red-700'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      }`}
                    >
                      {bt.term_name}: {bt.units} / {policy.max_credit_units_per_cycle}u
                    </span>
                  ))}
                </div>
              ) : (
                <span
                  className={`font-semibold ${
                    selectedUnitsSum > policy.max_credit_units_per_cycle ? 'text-red-600' : 'text-emerald-700'
                  }`}
                >
                  {selectedUnitsSum} / {policy.max_credit_units_per_cycle} max units ({selectedTerm?.name || cycleLabel})
                </span>
              )}
            </div>
          </div>

          {/* Multi-Semester Batch Target Strip (when 1st & 2nd Semester Register Both is active) */}
          {isBatchMultiSemesterMode && sessionTerms.length >= 2 && (
            <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-emerald-950">
                  Target {cycleLabel}s for {selectedSession?.name}:
                </span>
                {sessionTerms.map((t) => {
                  const checked = batchTermIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${
                        checked
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBatchTerm(t.id)}
                        className="sr-only"
                      />
                      {checked ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                      {t.name}
                    </label>
                  );
                })}
              </div>
              <span className="text-[11px] text-emerald-900">
                1st-{cycleLabel.toLowerCase()} courses auto-route to 1st {cycleLabel}; 2nd-{cycleLabel.toLowerCase()} courses auto-route to 2nd {cycleLabel}; untagged courses register into all checked {cycleLabel.toLowerCase()}s.
              </span>
            </div>
          )}

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
                  Select {selectedSession?.name ? `${selectedSession.name} · ` : ''}
                  {department ? `${department} ` : ''}
                  {isBatchMultiSemesterMode ? `${activeBatchTermNames} ` : selectedTerm ? `${selectedTerm.name} ` : ''}
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
                  <strong>{isBatchMultiSemesterMode ? activeBatchTermNames : selectedTerm?.name || cycleLabel}</strong> yet.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenBulkCourses(classId || '', activeSemesterCanonical, department || '', sessionId || '')}
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
                  const batchTargets = isBatchMultiSemesterMode ? resolveTargetTermsForSubject(sub) : [];
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
                            {sub.class_name || `All ${classLabel}s`} ·{' '}
                            {isBatchMultiSemesterMode && batchTargets.length > 0 ? (
                              <span className="font-semibold text-emerald-700">
                                → {batchTargets.length === sessionTerms.length ? `All ${cycleLabel}s` : batchTargets.map((t) => t.name).join(' & ')}
                              </span>
                            ) : (
                              semLabel
                            )}
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

          {anyBatchTermOverloaded && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>
                Selected load exceeds your institutional maximum of {policy.max_credit_units_per_cycle} credit units per {cycleLabel.toLowerCase()}. You can still override and register if approved.
              </span>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={saving || selectedSubjectIds.length === 0 || sessionTerms.length === 0}
              onClick={handleBulkRegister}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {saving
                ? 'Registering...'
                : targetMode === 'CLASS'
                ? `Bulk Register ${selectedSubjectIds.length} ${subjectPlural} for ${selectedSession?.name || ''} · ${cohortTitle} (${isBatchMultiSemesterMode ? activeBatchTermNames : selectedTerm?.name || cycleLabel})`
                : `Register ${selectedSubjectIds.length} ${subjectPlural} for ${selectedStudentIds.length} ${learnerPlural} (${selectedSession?.name || ''} · ${isBatchMultiSemesterMode ? activeBatchTermNames : selectedTerm?.name || cycleLabel})`}
            </button>
          </div>
        </div>
      )}

      {/* Registered Roster Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              {showCombinedLedger
                ? `Full-Session ${subjectPlural} Ledger (${selectedSession?.name || ''}${department ? ` · ${department}` : ''})`
                : `Registered ${subjectPlural} Ledger · ${selectedSession?.name || ''} · ${selectedTerm?.name || ''}${department ? ` · ${department}` : ''}`}{' '}
              ({registrations.length} registrations · {studentSummaries.length} {learnerPlural.toLowerCase()})
            </h4>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isBatchMultiSemesterMode && isAdmin && onLaunchGradingFromRegistrations && registrations.length > 0 && (
              <>
                {sessionTerms.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={launchingGrading}
                    onClick={() => handleLaunchGrading(t.id)}
                    className="px-2.5 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    <span>Grade {t.name} →</span>
                  </button>
                ))}
              </>
            )}
            {!showCombinedLedger && isAdmin && onLaunchGradingFromRegistrations && registrations.length > 0 && (
              <button
                type="button"
                disabled={launchingGrading}
                onClick={() => handleLaunchGrading()}
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
                        {stu.total_credit_units} {showCombinedLedger ? 'Session Total Credit Units' : 'Credit Units'}
                        {stu.exceeds_max_units ? ` (Exceeds ${policy.max_credit_units_per_cycle} max/${cycleLabel.toLowerCase()})` : ''}
                      </span>
                    </p>
                    {showCombinedLedger && stu.term_breakdown && stu.term_breakdown.length > 0 && (
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
                    {showCombinedLedger ? 'Session Course Form' : 'Course Form Slip'}
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="text-[11px] text-slate-500 border-b border-slate-100">
                      <tr>
                        {showCombinedLedger && <th className="py-1.5 pr-3">{cycleLabel}</th>}
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
                          {showCombinedLedger && (
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
        <ModalPortal onEscape={() => setPrintingStudentId(null)}>
          <div
            className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`Official ${subjectLabel} Registration Form`}
          >
            <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden h-[92dvh] sm:h-auto sm:max-h-[90vh] flex flex-col">
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
                  <p>{showCombinedLedger ? `Full Session (All ${cycleLabel}s)` : selectedTerm?.name || ''}</p>
                </div>
              </div>

              <table className="w-full text-left text-xs border border-slate-200 border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    {showCombinedLedger && <th className="px-3 py-2 border-r border-slate-200">{cycleLabel}</th>}
                    <th className="px-3 py-2 border-r border-slate-200">Code</th>
                    <th className="px-3 py-2 border-r border-slate-200">{subjectLabel} Title</th>
                    <th className="px-3 py-2 border-r border-slate-200 text-center">Units</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {printingStudent.courses.map((c) => (
                    <tr key={c.id}>
                      {showCombinedLedger && (
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
                    <td colSpan={showCombinedLedger ? 3 : 2} className="px-3 py-2 text-right border-r border-slate-200">
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
        </ModalPortal>
      )}
    </div>
  );
};
