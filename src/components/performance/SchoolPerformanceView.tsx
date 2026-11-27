import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  FileText,
  Sliders,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  X,
  Lock,
  Printer,
  Send,
  History,
  Save,
  Award,
  Layers,
  FileSpreadsheet,
  Upload,
  CheckSquare,
  Square,
  Download,
  ClipboardPaste,
  ArrowRight,
  Tags,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  AcademicSessionItem,
  AcademicSettings,
  ClassItem,
  DepartmentSummaryItem,
  ExaminationItem,
  PerformanceOverviewData,
  RegisteredCourseProgressItem,
  ReportCardItem,
  ScoreCorrectionLogItem,
  SessionReportCardItem,
  Student,
  StudentScoreItem,
  SubjectItem,
} from '../../types/index.js';
import { WorkflowStatusBadge } from '../common/StatusBadge.js';
import { PrintableReportCardModal } from './PrintableReportCardModal.js';
import { BulkCoursesModal } from './BulkCoursesModal.js';
import { CourseRegistrationPanel } from './CourseRegistrationPanel.js';
import { HistoricalBacklogImportModal } from './HistoricalBacklogImportModal.js';
import { ExamBroadsheetModal } from './ExamBroadsheetModal.js';
import { resolveInstitutionProfile } from '../../utils/institutionMode.js';
import {
  CanonicalSemesterTag,
  formatSemesterTagLabel,
  getSemesterTagOptions,
  normalizeSemesterTag,
  termMatchesSemesterTag,
} from '../../utils/semesterTag.js';
import { parseScoreSheetPaste } from '../../utils/scoreSheetPasteParser.js';

interface SchoolPerformanceViewProps {
  readOnly?: boolean;
}

type PerfSubTab = 'analytics' | 'subjects' | 'course_reg' | 'exams' | 'reports' | 'settings';

export const SchoolPerformanceView: React.FC<SchoolPerformanceViewProps> = ({ readOnly = false }) => {
  const { activeSchool, activeSettings } = useAuth();
  const instProfile = resolveInstitutionProfile(activeSchool, activeSettings);
  const { isTertiary, labels: instLabels, gradingMode } = instProfile;
  const isGpaMode = gradingMode === 'GPA_5' || gradingMode === 'GPA_4';
  const showCreditUnits = isTertiary || isGpaMode;
  const [subTab, setSubTab] = useState<PerfSubTab>('analytics');

  // Shared metadata
  const [sessions, setSessions] = useState<AcademicSessionItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentSummaryItem[]>([]);
  const [settings, setSettings] = useState<AcademicSettings | null>(null);

  // Analytics state
  const [filters, setFilters] = useState({
    academic_session_id: '',
    term_id: '',
    class_id: '',
    subject_id: '',
    examination_id: '',
    behaviour_category: '',
    date_from: '',
    date_to: '',
  });
  const [overview, setOverview] = useState<PerformanceOverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Subjects / Courses modal & Bulk / Backlog / Broadsheet modals
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [bulkCoursesOpen, setBulkCoursesOpen] = useState(false);
  const [bulkCoursesPrefill, setBulkCoursesPrefill] = useState<{
    classId?: string;
    semesterTag?: CanonicalSemesterTag;
    department?: string;
  }>({});
  const [historicalBacklogOpen, setHistoricalBacklogOpen] = useState(false);
  const [broadsheetExamId, setBroadsheetExamId] = useState<string | null>(null);
  const [inlineUnitSavingId, setInlineUnitSavingId] = useState<string | null>(null);
  const [inlineSemSavingId, setInlineSemSavingId] = useState<string | null>(null);
  const [subjectFilterClassId, setSubjectFilterClassId] = useState('');
  const [subjectFilterDepartment, setSubjectFilterDepartment] = useState('');
  const [subjectFilterSemester, setSubjectFilterSemester] = useState<'ALL' | '' | '1ST' | '2ND' | '3RD'>('ALL');
  const [selectedCatalogSubjectIds, setSelectedCatalogSubjectIds] = useState<string[]>([]);
  const [bulkAssignDept, setBulkAssignDept] = useState('');
  const [bulkAssignClassId, setBulkAssignClassId] = useState('__KEEP__');
  const [bulkAssignSemTag, setBulkAssignSemTag] = useState('__KEEP__');
  const [bulkAssignSaving, setBulkAssignSaving] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectItem | null>(null);
  const [subjectForm, setSubjectForm] = useState({
    name: '',
    code: '',
    department: '',
    class_id: '',
    credit_units: '3',
    course_type: 'CORE' as 'CORE' | 'ELECTIVE' | 'GENERAL',
    semester_tag: '' as CanonicalSemesterTag,
    status: 'ACTIVE',
  });
  const [subjectSaving, setSubjectSaving] = useState(false);

  // Exams & Score Sheet state
  const [exams, setExams] = useState<ExaminationItem[]>([]);
  const [examsLoading, setExamsLoading] = useState(false);
  const [examFilterStatus, setExamFilterStatus] = useState('');
  const [examModalOpen, setExamModalOpen] = useState(false);
  const [examForm, setExamForm] = useState({
    title: '',
    exam_type: 'TERMLY',
    academic_session_id: '',
    term_id: '',
    class_id: '',
    department: '',
    ca_max_score: 40,
    exam_max_score: 60,
  });
  const [examSaving, setExamSaving] = useState(false);
  const [openingFromReg, setOpeningFromReg] = useState(false);

  const [selectedExam, setSelectedExam] = useState<ExaminationItem | null>(null);
  const [scoreSubjectId, setScoreSubjectId] = useState('');
  const [scoreRegisteredOnly, setScoreRegisteredOnly] = useState(true);
  const [scoreQueueDeptFilter, setScoreQueueDeptFilter] = useState('');
  const [registeredSubjectsQueue, setRegisteredSubjectsQueue] = useState<RegisteredCourseProgressItem[]>([]);
  const [scoreRoster, setScoreRoster] = useState<
    Array<{
      id: string;
      admission_number: string;
      full_name: string;
      class_id?: string | null;
      class_name?: string | null;
      class_arm_id?: string | null;
      class_arm_name?: string | null;
      is_registered?: boolean;
      registration_type?: string | null;
    }>
  >([]);
  const [examScores, setExamScores] = useState<StudentScoreItem[]>([]);
  const [examCorrections, setExamCorrections] = useState<ScoreCorrectionLogItem[]>([]);
  const [scoreDrafts, setScoreDrafts] = useState<
    Record<string, { ca_score: string; exam_score: string; subject_remark: string }>
  >({});
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresSaving, setScoresSaving] = useState(false);
  const [pasteDrawerOpen, setPasteDrawerOpen] = useState(false);
  const [pasteRawText, setPasteRawText] = useState('');

  // Audited correction modal
  const [correctingScore, setCorrectingScore] = useState<StudentScoreItem | null>(null);
  const [correctionForm, setCorrectionForm] = useState({
    ca_score: '',
    exam_score: '',
    subject_remark: '',
    reason: '',
  });
  const [correctionSaving, setCorrectionSaving] = useState(false);

  // Report Cards state
  const [reportMode, setReportMode] = useState<'TERM' | 'SESSION'>('TERM');
  const [reportCards, setReportCards] = useState<ReportCardItem[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [sessionReportCards, setSessionReportCards] = useState<SessionReportCardItem[]>([]);
  const [sessionReportsLoading, setSessionReportsLoading] = useState(false);
  const [rcFilters, setRcFilters] = useState({
    academic_session_id: '',
    term_id: '',
    class_id: '',
    status: '',
  });
  const [generatingRc, setGeneratingRc] = useState(false);
  const [generatingSessionRc, setGeneratingSessionRc] = useState(false);
  const [printingRc, setPrintingRc] = useState<ReportCardItem | null>(null);
  const [remarksModalRc, setRemarksModalRc] = useState<ReportCardItem | null>(null);
  const [remarksForm, setRemarksForm] = useState({
    teacher_remark: '',
    principal_remark: '',
    status: 'DRAFT' as 'DRAFT' | 'REVIEW' | 'APPROVED',
  });
  const [remarksSaving, setRemarksSaving] = useState(false);
  const [sessionRemarksModalRc, setSessionRemarksModalRc] = useState<SessionReportCardItem | null>(null);
  const [sessionRemarksForm, setSessionRemarksForm] = useState({
    promotion_status: 'PROMOTED',
    teacher_remark: '',
    principal_remark: '',
    status: 'DRAFT' as 'DRAFT' | 'REVIEW' | 'APPROVED',
  });
  const [sessionRemarksSaving, setSessionRemarksSaving] = useState(false);

  // On-demand Report Generator state (used by Read-Only Teachers and Admins for quick previews)
  const [rosterStudents, setRosterStudents] = useState<Student[]>([]);
  const [onDemandType, setOnDemandType] = useState<'TERM' | 'SESSION'>('TERM');
  const [onDemandStudentId, setOnDemandStudentId] = useState('');
  const [onDemandSessionId, setOnDemandSessionId] = useState('');
  const [onDemandTermId, setOnDemandTermId] = useState('');
  const [onDemandGenerating, setOnDemandGenerating] = useState(false);

  // Settings edit state
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    if (type === 'ok') {
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const loadBootstrap = async () => {
    try {
      const [sessRes, clsRes, subRes, setRes, exRes, stuRes, deptRes] = await Promise.all([
        api.getSchoolAcademicSessions().catch(() => ({ sessions: [] })),
        api.getSchoolClasses().catch(() => ({ classes: [] })),
        api.getSubjects().catch(() => ({ subjects: [] })),
        api.getAcademicSettings().catch(() => ({ settings: null })),
        api.getExaminations().catch(() => ({ examinations: [] })),
        readOnly
          ? api.getTeacherDashboard().then((d) => ({ students: d.students || [] })).catch(() => ({ students: [] }))
          : api.getSchoolStudents({ limit: 500 }).catch(() => ({ students: [] })),
        api.getSchoolDepartments().catch(() => ({ departments: [] })),
      ]);
      const loadedSessions = sessRes.sessions || [];
      setSessions(loadedSessions);
      setClasses(clsRes.classes || []);
      setSubjects(subRes.subjects || []);
      setDepartments(deptRes.departments || []);
      if (setRes.settings) setSettings(setRes.settings);
      setExams(exRes.examinations || []);
      const loadedStudents = stuRes.students || [];
      setRosterStudents(loadedStudents);
      if (loadedStudents.length > 0) {
        setOnDemandStudentId((prev) => prev || loadedStudents[0].id);
      }

      const activeSess = loadedSessions.find((s) => s.status === 'ACTIVE') || loadedSessions[0];
      const activeTerm = activeSess?.terms?.find((t) => t.status === 'ACTIVE') || activeSess?.terms?.[0];
      if (activeSess) {
        setExamForm((prev) => ({
          ...prev,
          academic_session_id: prev.academic_session_id || activeSess.id,
          term_id: prev.term_id || activeTerm?.id || '',
          ca_max_score: setRes.settings?.ca_max_score ?? prev.ca_max_score,
          exam_max_score: setRes.settings?.exam_max_score ?? prev.exam_max_score,
        }));
        setRcFilters((prev) => ({
          ...prev,
          academic_session_id: prev.academic_session_id || activeSess.id,
          term_id: prev.term_id || activeTerm?.id || '',
        }));
        setOnDemandSessionId((prev) => prev || activeSess.id);
        setOnDemandTermId((prev) => prev || activeTerm?.id || '');
      }
      if (subRes.subjects?.length) {
        setScoreSubjectId((prev) => prev || subRes.subjects[0].id);
      }
    } catch {
      // handled per section
    }
  };

  // Canonical deduplicated department names across class arms, subjects, students, and /departments API
  const availableDepartmentNames = useMemo(() => {
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
    rosterStudents.forEach((s) => add(s.class_arm_name));
    subjects.forEach((s) => add(s.department));
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [departments, classes, rosterStudents, subjects]);

  const loadOverview = async (activeFilters = filters) => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const res = await api.getPerformanceOverview(activeFilters);
      setOverview(res);
    } catch (err: any) {
      setOverviewError(err?.message || 'Failed to load performance analytics');
    } finally {
      setOverviewLoading(false);
    }
  };

  const loadExams = async () => {
    setExamsLoading(true);
    try {
      const res = await api.getExaminations(examFilterStatus ? { status: examFilterStatus } : undefined);
      setExams(res.examinations || []);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to load examinations');
    } finally {
      setExamsLoading(false);
    }
  };

  const loadExamScoreSheet = async (
    exam: ExaminationItem,
    subjectId: string,
    opts?: { registeredOnly?: boolean; department?: string; autoPickRegistered?: boolean }
  ) => {
    setScoresLoading(true);
    try {
      const wantRegOnly = opts?.registeredOnly !== undefined ? opts.registeredOnly : scoreRegisteredOnly;
      const effectiveDept = opts?.department !== undefined ? opts.department : exam.department || '';

      let targetSubjectId = subjectId;
      let res = await api.getExaminationScores(exam.id, {
        subject_id: targetSubjectId || undefined,
        class_id: exam.class_id || undefined,
        department: effectiveDept || undefined,
        registered_only: wantRegOnly,
      });

      const queue = res.registered_subjects || [];
      setRegisteredSubjectsQueue(queue);

      // On initial exam open (when autoPickRegistered is true and registrations exist), jump straight to the first ungraded registered course
      if (opts?.autoPickRegistered && queue.length > 0) {
        const firstUngraded =
          queue.find((q) => q.scored_count < q.registered_count) || queue[0];
        if (firstUngraded && firstUngraded.subject_id !== targetSubjectId) {
          targetSubjectId = firstUngraded.subject_id;
          setScoreSubjectId(targetSubjectId);
          res = await api.getExaminationScores(exam.id, {
            subject_id: targetSubjectId,
            class_id: exam.class_id || undefined,
            department: effectiveDept || undefined,
            registered_only: wantRegOnly,
          });
        }
      }

      // If registered_only was requested for a course with 0 registrations yet, gracefully show all cohort students
      let resolvedRegOnly = wantRegOnly;
      if (wantRegOnly && (res.roster || []).length === 0 && targetSubjectId) {
        const hasRegsForCourse = queue.some((q) => q.subject_id === targetSubjectId && q.registered_count > 0);
        if (!hasRegsForCourse) {
          resolvedRegOnly = false;
          res = await api.getExaminationScores(exam.id, {
            subject_id: targetSubjectId,
            class_id: exam.class_id || undefined,
            department: effectiveDept || undefined,
            registered_only: false,
          });
        }
      }

      setScoreRegisteredOnly(resolvedRegOnly);
      setSelectedExam(res.examination);
      setScoreRoster(res.roster || []);
      setExamScores(res.scores || []);
      setExamCorrections(res.corrections || []);

      const nextDrafts: Record<string, { ca_score: string; exam_score: string; subject_remark: string }> = {};
      for (const st of res.roster || []) {
        const existing = (res.scores || []).find((sc) => sc.student_id === st.id && (!targetSubjectId || sc.subject_id === targetSubjectId));
        nextDrafts[st.id] = {
          ca_score: existing?.ca_score !== null && existing?.ca_score !== undefined ? String(existing.ca_score) : '',
          exam_score: existing?.exam_score !== null && existing?.exam_score !== undefined ? String(existing.exam_score) : '',
          subject_remark: existing?.subject_remark || '',
        };
      }
      setScoreDrafts(nextDrafts);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to load examination score sheet');
    } finally {
      setScoresLoading(false);
    }
  };

  const loadReportCards = async (f = rcFilters) => {
    setReportsLoading(true);
    try {
      const res = await api.getReportCards(f);
      setReportCards(res.reportCards || []);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to load report cards');
    } finally {
      setReportsLoading(false);
    }
  };

  const loadSessionReportCards = async (f = rcFilters) => {
    setSessionReportsLoading(true);
    try {
      const res = await api.getSessionReportCards({
        academic_session_id: f.academic_session_id || undefined,
        class_id: f.class_id || undefined,
        status: f.status || undefined,
      });
      setSessionReportCards(res.sessionReportCards || []);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to load full-session cumulative report cards');
    } finally {
      setSessionReportsLoading(false);
    }
  };

  useEffect(() => {
    loadBootstrap();
    loadOverview();
  }, [activeSchool?.id]);

  useEffect(() => {
    if (subTab === 'exams') loadExams();
    if (subTab === 'reports') {
      if (reportMode === 'SESSION') {
        loadSessionReportCards();
      } else {
        loadReportCards();
      }
    }
  }, [subTab, examFilterStatus, reportMode]);

  const selectedSessionObj = sessions.find((s) => s.id === filters.academic_session_id);
  const rcSessionObj = sessions.find((s) => s.id === rcFilters.academic_session_id);
  const examFormSessionObj = sessions.find((s) => s.id === examForm.academic_session_id);

  // Handlers
  const handleSaveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubjectSaving(true);
    try {
      const trimmedUnits = String(subjectForm.credit_units ?? '').trim();
      const rawNum = trimmedUnits === '' ? 3 : Number(trimmedUnits);
      const safeUnits = Number.isFinite(rawNum) ? Math.max(0, Math.min(12, Math.round(rawNum))) : 3;
      const payload = {
        name: subjectForm.name.trim(),
        code: subjectForm.code.trim(),
        department: subjectForm.department.trim(),
        class_id: subjectForm.class_id || null,
        credit_units: safeUnits,
        course_type: subjectForm.course_type,
        semester_tag: subjectForm.semester_tag || null,
        status: subjectForm.status as 'ACTIVE' | 'INACTIVE',
      };
      if (editingSubject) {
        await api.updateSubject(editingSubject.id, payload);
        showMsg('ok', `${instLabels.subject} updated (${safeUnits} credit unit${safeUnits === 1 ? '' : 's'}).`);
      } else {
        await api.createSubject(payload);
        showMsg('ok', `${instLabels.subject} created (${safeUnits} credit unit${safeUnits === 1 ? '' : 's'}).`);
      }
      const res = await api.getSubjects();
      setSubjects(res.subjects || []);
      setSubjectModalOpen(false);
      setEditingSubject(null);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to save subject');
    } finally {
      setSubjectSaving(false);
    }
  };

  const handleInlineCreditUnitsChange = async (sub: SubjectItem, nextUnits: number) => {
    const safeUnits = Math.max(0, Math.min(12, Math.round(nextUnits)));
    if (Number(sub.credit_units ?? 3) === safeUnits) return;
    setInlineUnitSavingId(sub.id);
    try {
      const res = await api.patchSubjectCreditUnits(sub.id, { credit_units: safeUnits, sync_registrations: true });
      setSubjects((prev) =>
        prev.map((item) => (item.id === sub.id ? { ...item, credit_units: res.subject?.credit_units ?? safeUnits } : item))
      );
      showMsg('ok', `Updated ${sub.code || sub.name} to ${safeUnits} credit unit${safeUnits === 1 ? '' : 's'}.`);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to update credit units');
    } finally {
      setInlineUnitSavingId(null);
    }
  };

  const handleInlineSemesterTagChange = async (sub: SubjectItem, nextTag: CanonicalSemesterTag) => {
    if (normalizeSemesterTag(sub.semester_tag) === nextTag) return;
    setInlineSemSavingId(sub.id);
    try {
      const res = await api.updateSubject(sub.id, { semester_tag: nextTag || null });
      setSubjects((prev) =>
        prev.map((item) => (item.id === sub.id ? { ...item, semester_tag: res.subject?.semester_tag ?? (nextTag || null) } : item))
      );
      showMsg(
        'ok',
        `Assigned ${sub.code || sub.name} to ${formatSemesterTagLabel(nextTag, instLabels.cycle, instProfile.cycleLabels)}.`
      );
    } catch (err: any) {
      showMsg('err', err?.message || `Failed to update ${instLabels.cycle.toLowerCase()} assignment`);
    } finally {
      setInlineSemSavingId(null);
    }
  };

  const handleDeleteSubject = async (sub: SubjectItem) => {
    try {
      await api.deleteSubject(sub.id);
      const res = await api.getSubjects();
      setSubjects(res.subjects || []);
      setSelectedCatalogSubjectIds((prev) => prev.filter((id) => id !== sub.id));
      showMsg('ok', `Removed subject ${sub.name}.`);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to delete subject');
    }
  };

  const handleBulkAssignSubjects = async () => {
    if (selectedCatalogSubjectIds.length === 0) return;
    const payload: {
      subject_ids: string[];
      department?: string | null;
      class_id?: string | null;
      semester_tag?: string | null;
    } = { subject_ids: selectedCatalogSubjectIds };

    let hasChange = false;
    if (bulkAssignDept.trim() !== '') {
      payload.department = bulkAssignDept.trim() === '__CLEAR__' ? '' : bulkAssignDept.trim();
      hasChange = true;
    }
    if (bulkAssignClassId !== '__KEEP__') {
      payload.class_id = bulkAssignClassId === '' ? null : bulkAssignClassId;
      hasChange = true;
    }
    if (bulkAssignSemTag !== '__KEEP__') {
      payload.semester_tag = bulkAssignSemTag === '' ? null : bulkAssignSemTag;
      hasChange = true;
    }

    if (!hasChange) {
      showMsg('err', 'Choose a Department, Level, or Semester to apply to the selected courses.');
      return;
    }

    setBulkAssignSaving(true);
    try {
      const res = await api.bulkAssignSubjects(payload);
      const [subRes, deptRes] = await Promise.all([
        api.getSubjects(),
        api.getSchoolDepartments().catch(() => ({ departments: [] })),
      ]);
      setSubjects(subRes.subjects || []);
      setDepartments(deptRes.departments || []);
      setSelectedCatalogSubjectIds([]);
      setBulkAssignDept('');
      setBulkAssignClassId('__KEEP__');
      setBulkAssignSemTag('__KEEP__');
      showMsg('ok', res.message || 'Updated selected courses.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to batch update courses');
    } finally {
      setBulkAssignSaving(false);
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setExamSaving(true);
    try {
      const res = await api.createExamination({
        ...examForm,
        class_id: examForm.class_id || undefined,
        department: examForm.department.trim() || undefined,
      });
      setExamModalOpen(false);
      setExamForm((prev) => ({ ...prev, title: '' }));
      await loadExams();
      if (res.examination) {
        setSelectedExam(res.examination);
        const subj = scoreSubjectId || subjects[0]?.id || '';
        setScoreSubjectId(subj);
        await loadExamScoreSheet(res.examination, subj, { registeredOnly: true, autoPickRegistered: true });
      }
      showMsg('ok', 'Examination created in DRAFT state.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to create examination');
    } finally {
      setExamSaving(false);
    }
  };

  const handleLaunchGradingFromRegistrations = async (params: {
    academic_session_id: string;
    term_id: string;
    class_id?: string | null;
    department?: string | null;
  }) => {
    setOpeningFromReg(true);
    try {
      const res = await api.createOrOpenExamFromRegistrations(params);
      await loadExams();
      setSubTab('exams');
      setScoreQueueDeptFilter(params.department || '');
      if (res.examination) {
        setSelectedExam(res.examination);
        const queue = res.registered_subjects || [];
        setRegisteredSubjectsQueue(queue);
        const firstSub =
          queue.find((q) => q.scored_count < q.registered_count)?.subject_id ||
          queue[0]?.subject_id ||
          subjects[0]?.id ||
          '';
        setScoreSubjectId(firstSub);
        await loadExamScoreSheet(res.examination, firstSub, {
          registeredOnly: queue.length > 0,
          department: params.department || '',
        });
      }
      showMsg('ok', res.message || 'Opened Examination Grading Queue from registered courses.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to open examination from registrations');
    } finally {
      setOpeningFromReg(false);
    }
  };

  const handleSaveScores = async (advanceToNextCourse = false, overrideDrafts?: typeof scoreDrafts) => {
    if (!selectedExam || !scoreSubjectId) return;
    const activeDrafts = overrideDrafts || scoreDrafts;
    setScoresSaving(true);
    try {
      const entries = scoreRoster.map((st) => {
        const draft = activeDrafts[st.id] || { ca_score: '', exam_score: '', subject_remark: '' };
        return {
          student_id: st.id,
          subject_id: scoreSubjectId,
          ca_score: draft.ca_score === '' ? null : Number(draft.ca_score),
          exam_score: draft.exam_score === '' ? null : Number(draft.exam_score),
          subject_remark: draft.subject_remark || null,
        };
      });
      await api.saveExaminationScores(selectedExam.id, entries);
      await loadExamScoreSheet(selectedExam, scoreSubjectId);
      await loadOverview();
      if (advanceToNextCourse && registeredSubjectsQueue.length > 1) {
        const filteredQueue = registeredSubjectsQueue.filter((q) => {
          if (!scoreQueueDeptFilter) return true;
          const qDept = (q.department || '').trim().toLowerCase();
          if (scoreQueueDeptFilter === '__GENERAL__') return !qDept || qDept === 'general';
          return qDept === scoreQueueDeptFilter.toLowerCase();
        });
        const idx = filteredQueue.findIndex((q) => q.subject_id === scoreSubjectId);
        const nextCourse =
          filteredQueue.slice(idx + 1).find((q) => q.scored_count < q.registered_count) ||
          filteredQueue[idx + 1] ||
          filteredQueue.find((q) => q.subject_id !== scoreSubjectId && q.scored_count < q.registered_count);
        if (nextCourse) {
          setScoreSubjectId(nextCourse.subject_id);
          await loadExamScoreSheet(selectedExam, nextCourse.subject_id, { registeredOnly: scoreRegisteredOnly });
          showMsg('ok', `Saved scores and loaded next course: ${nextCourse.code || nextCourse.name}.`);
          return;
        }
      }
      showMsg('ok', 'Scores saved and graded automatically.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to save scores');
    } finally {
      setScoresSaving(false);
    }
  };

  const parsedPastePreview = useMemo(() => {
    if (!pasteDrawerOpen || !pasteRawText.trim() || !selectedExam) return null;
    return parseScoreSheetPaste(
      pasteRawText,
      scoreRoster,
      Number(selectedExam.ca_max_score ?? 40),
      Number(selectedExam.exam_max_score ?? 60)
    );
  }, [pasteDrawerOpen, pasteRawText, selectedExam, scoreRoster]);

  const handleApplyPastedScores = async (saveImmediately = false) => {
    if (!parsedPastePreview || !selectedExam) return;
    const validRows = parsedPastePreview.rows.filter((r) => r.matchedStudentId && !r.error);
    if (validRows.length === 0) {
      showMsg('err', 'No valid matched student score rows to import.');
      return;
    }
    const mergedDrafts = { ...scoreDrafts };
    for (const r of validRows) {
      if (!r.matchedStudentId) continue;
      const existing = mergedDrafts[r.matchedStudentId] || { ca_score: '', exam_score: '', subject_remark: '' };
      mergedDrafts[r.matchedStudentId] = {
        ca_score: r.ca_score !== '' ? r.ca_score : existing.ca_score,
        exam_score: r.exam_score !== '' ? r.exam_score : existing.exam_score,
        subject_remark: r.subject_remark || existing.subject_remark,
      };
    }
    setScoreDrafts(mergedDrafts);
    setPasteDrawerOpen(false);
    setPasteRawText('');
    if (saveImmediately) {
      await handleSaveScores(false, mergedDrafts);
    } else {
      showMsg('ok', `Populated ${validRows.length} student score(s) into the sheet. Review and click Save Scores.`);
    }
  };

  const handleDownloadRosterCsv = () => {
    if (!selectedExam || scoreRoster.length === 0) return;
    const activeSub = subjects.find((s) => s.id === scoreSubjectId);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'Admission No',
      'Student Name',
      isTertiary ? 'Department' : 'Arm',
      `CA Score (Max ${selectedExam.ca_max_score})`,
      `Exam Score (Max ${selectedExam.exam_max_score})`,
      'Remark',
    ];
    const rows = scoreRoster.map((st) => {
      const d = scoreDrafts[st.id] || { ca_score: '', exam_score: '', subject_remark: '' };
      return [
        esc(st.admission_number || ''),
        esc(st.full_name),
        esc(st.class_arm_name || ''),
        esc(d.ca_score),
        esc(d.exam_score),
        esc(d.subject_remark),
      ].join(',');
    });
    const csv = [headers.map(esc).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = `${activeSub?.code || 'scores'}-${selectedExam.title}`.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    a.download = `${slug}_roster.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleTransitionExamStatus = async (exam: ExaminationItem, status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED') => {
    try {
      const res = await api.updateExaminationStatus(exam.id, status);
      await loadExams();
      if (selectedExam?.id === exam.id) {
        await loadExamScoreSheet(res.examination, scoreSubjectId);
      }
      await loadOverview();
      showMsg('ok', res.message || `Examination moved to ${status}.`);
    } catch (err: any) {
      showMsg('err', err?.message || `Failed to move examination to ${status}`);
    }
  };

  const handleCorrectScoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctingScore || !selectedExam) return;
    setCorrectionSaving(true);
    try {
      const res = await api.correctPublishedScore(correctingScore.id, {
        ca_score: correctionForm.ca_score === '' ? null : Number(correctionForm.ca_score),
        exam_score: correctionForm.exam_score === '' ? null : Number(correctionForm.exam_score),
        subject_remark: correctionForm.subject_remark || undefined,
        reason: correctionForm.reason.trim(),
      });
      setCorrectingScore(null);
      await loadExamScoreSheet(selectedExam, scoreSubjectId);
      await loadOverview();
      showMsg('ok', res.message || 'Published score corrected and audit-logged.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to correct published score');
    } finally {
      setCorrectionSaving(false);
    }
  };

  const handleGenerateReportCards = async () => {
    if (!rcFilters.academic_session_id || !rcFilters.term_id) {
      showMsg('err', 'Select an Academic Session and Term first.');
      return;
    }
    setGeneratingRc(true);
    try {
      const res = await api.generateReportCards({
        academic_session_id: rcFilters.academic_session_id,
        term_id: rcFilters.term_id,
        class_id: rcFilters.class_id || undefined,
      });
      await loadReportCards();
      await loadOverview();
      showMsg('ok', `Generated ${res.count} report card(s).`);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to generate report cards');
    } finally {
      setGeneratingRc(false);
    }
  };

  const handlePublishClassReportCards = async () => {
    if (!rcFilters.academic_session_id || !rcFilters.term_id) {
      showMsg('err', 'Select an Academic Session and Term first.');
      return;
    }
    try {
      const res = await api.publishClassReportCards({
        academic_session_id: rcFilters.academic_session_id,
        term_id: rcFilters.term_id,
        class_id: rcFilters.class_id || undefined,
      });
      await loadReportCards();
      await loadOverview();
      showMsg('ok', `Published ${res.publishedCount} report card(s) to Parent and Student portals.`);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to publish report cards');
    }
  };

  const handleViewPrintReportCard = async (rc: ReportCardItem) => {
    try {
      const res = await api.getReportCardDetail(rc.id);
      setPrintingRc(res.reportCard);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to load report card details');
    }
  };

  const handleSaveRemarks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remarksModalRc) return;
    setRemarksSaving(true);
    try {
      await api.updateReportCardRemarks(remarksModalRc.id, remarksForm);
      setRemarksModalRc(null);
      await loadReportCards();
      showMsg('ok', 'Report card remarks and workflow status updated.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to update report card remarks');
    } finally {
      setRemarksSaving(false);
    }
  };

  const handlePublishSingleRc = async (rc: ReportCardItem) => {
    try {
      await api.publishReportCard(rc.id);
      await loadReportCards();
      await loadOverview();
      showMsg('ok', `Published report card for ${rc.student_name}.`);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to publish report card');
    }
  };

  const handleGenerateSessionReportCards = async () => {
    if (!rcFilters.academic_session_id) {
      showMsg('err', 'Select an Academic Session first to compile Full-Session Cumulative Reports.');
      return;
    }
    setGeneratingSessionRc(true);
    try {
      const res = await api.generateSessionReportCards({
        academic_session_id: rcFilters.academic_session_id,
        class_id: rcFilters.class_id || undefined,
      });
      await loadSessionReportCards();
      showMsg('ok', `Generated ${res.count} Full-Session Cumulative report card(s).`);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to generate session cumulative report cards');
    } finally {
      setGeneratingSessionRc(false);
    }
  };

  const handlePublishClassSessionReportCards = async () => {
    if (!rcFilters.academic_session_id) {
      showMsg('err', 'Select an Academic Session first.');
      return;
    }
    try {
      const res = await api.publishClassSessionReportCards({
        academic_session_id: rcFilters.academic_session_id,
        class_id: rcFilters.class_id || undefined,
      });
      await loadSessionReportCards();
      showMsg('ok', `Published ${res.publishedCount} Full-Session Cumulative report card(s).`);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to publish session report cards');
    }
  };

  const handleViewPrintSessionReportCard = async (src: SessionReportCardItem) => {
    try {
      const res = await api.getSessionReportCardDetail(src.id);
      setPrintingRc(res.sessionReportCard);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to load full-session report card details');
    }
  };

  const handleSaveSessionRemarks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionRemarksModalRc) return;
    setSessionRemarksSaving(true);
    try {
      await api.updateSessionReportCardRemarks(sessionRemarksModalRc.id, sessionRemarksForm);
      setSessionRemarksModalRc(null);
      await loadSessionReportCards();
      showMsg('ok', 'Session cumulative report remarks & promotion status saved.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to update session report card');
    } finally {
      setSessionRemarksSaving(false);
    }
  };

  const handlePublishSingleSessionRc = async (src: SessionReportCardItem) => {
    try {
      await api.publishSessionReportCard(src.id);
      await loadSessionReportCards();
      showMsg('ok', `Published Full-Session report card for ${src.student_name}.`);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to publish session report card');
    }
  };

  const handleOnDemandCompile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onDemandStudentId || !onDemandSessionId) {
      showMsg('err', 'Select a Student and Academic Session first.');
      return;
    }
    if (onDemandType === 'TERM' && !onDemandTermId) {
      showMsg('err', 'Select a Term for End-of-Term Report Card.');
      return;
    }
    setOnDemandGenerating(true);
    try {
      const res = readOnly
        ? await api.generateTeacherReportCard({
            student_id: onDemandStudentId,
            academic_session_id: onDemandSessionId,
            term_id: onDemandType === 'TERM' ? onDemandTermId : undefined,
            report_type: onDemandType,
          })
        : await api.compileSchoolReportCardPreview({
            student_id: onDemandStudentId,
            academic_session_id: onDemandSessionId,
            term_id: onDemandType === 'TERM' ? onDemandTermId : undefined,
            report_type: onDemandType,
          });
      setPrintingRc(res.reportCard);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to compile report card');
    } finally {
      setOnDemandGenerating(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSettingsSaving(true);
    try {
      const res = await api.updateAcademicSettings(settings);
      setSettings(res.settings);
      showMsg('ok', 'Academic and portal visibility policy updated.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to save academic settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-Navigation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-600" />
              <span>
                {isTertiary
                  ? `Academic Performance, GPA/CGPA & ${instLabels.report}`
                  : 'Academic Performance & Digital Report Cards'}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {readOnly
                ? `Read-only analytics, examination standings, and ${instLabels.report.toLowerCase()} archive.`
                : isTertiary
                  ? `Manage ${instLabels.subjectPlural.toLowerCase()} & credit units, ${instLabels.cycle.toLowerCase()} exams, score workflows, and official GPA/CGPA transcripts.`
                  : 'Manage subjects, examinations, score workflows, audited post-publish corrections, and digital report cards.'}
            </p>
          </div>
          {readOnly && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Read-Only Educator View</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          {(
            [
              { key: 'analytics', label: 'Analytics & Rankings', icon: BarChart3 },
              { key: 'subjects', label: instLabels.subjectPlural, icon: BookOpen },
              {
                key: 'course_reg',
                label: isTertiary ? 'Course Registration' : 'Subject Registration',
                icon: Layers,
              },
              { key: 'exams', label: 'Examinations & Scores', icon: ClipboardCheck },
              { key: 'reports', label: isTertiary ? 'Results & Transcripts' : 'Report Cards', icon: FileText },
              ...(!readOnly ? [{ key: 'settings', label: 'Policy Settings', icon: Sliders }] : []),
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = subTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSubTab(t.key as PerfSubTab)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </span>
          <button type="button" onClick={() => setFeedback(null)} className="p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 1: ANALYTICS & RANKINGS */}
      {/* ===================================================================== */}
      {subTab === 'analytics' && (
        <div className="space-y-6">
          {/* Multi-Dimensional Filter Bar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <select
                value={filters.academic_session_id}
                onChange={(e) => {
                  const next = { ...filters, academic_session_id: e.target.value, term_id: '' };
                  setFilters(next);
                  loadOverview(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="">All Academic Sessions</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <select
                value={filters.term_id}
                onChange={(e) => {
                  const next = { ...filters, term_id: e.target.value };
                  setFilters(next);
                  loadOverview(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="">All Terms</option>
                {(selectedSessionObj?.terms || sessions.flatMap((s) => s.terms || [])).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <select
                value={filters.class_id}
                onChange={(e) => {
                  const next = { ...filters, class_id: e.target.value };
                  setFilters(next);
                  loadOverview(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="">All Classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={filters.subject_id}
                onChange={(e) => {
                  const next = { ...filters, subject_id: e.target.value };
                  setFilters(next);
                  loadOverview(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="">All Subjects</option>
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name} ({sub.code})
                  </option>
                ))}
              </select>

              <select
                value={filters.examination_id}
                onChange={(e) => {
                  const next = { ...filters, examination_id: e.target.value };
                  setFilters(next);
                  loadOverview(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="">All Examinations</option>
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title}
                  </option>
                ))}
              </select>

              <select
                value={filters.behaviour_category}
                onChange={(e) => {
                  const next = { ...filters, behaviour_category: e.target.value };
                  setFilters(next);
                  loadOverview(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="">All Behaviour Categories</option>
                <option value="POSITIVE">Positive</option>
                <option value="COMMENDATION">Commendation</option>
                <option value="DISCIPLINE">Discipline</option>
                <option value="INCIDENT">Incident</option>
                <option value="OBSERVATION">Observation</option>
              </select>

              <input
                type="date"
                value={filters.date_from}
                onChange={(e) => {
                  const next = { ...filters, date_from: e.target.value };
                  setFilters(next);
                  loadOverview(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                title="Attendance / Behaviour From Date"
              />

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={(e) => {
                    const next = { ...filters, date_to: e.target.value };
                    setFilters(next);
                    loadOverview(next);
                  }}
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  title="Attendance / Behaviour To Date"
                />
                <button
                  type="button"
                  onClick={() => {
                    const cleared = {
                      academic_session_id: '',
                      term_id: '',
                      class_id: '',
                      subject_id: '',
                      examination_id: '',
                      behaviour_category: '',
                      date_from: '',
                      date_to: '',
                    };
                    setFilters(cleared);
                    loadOverview(cleared);
                  }}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold cursor-pointer whitespace-nowrap"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {overviewLoading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-400">
              Computing real-time academic, attendance, and behaviour analytics...
            </div>
          ) : overviewError ? (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-xs text-rose-800">
              {overviewError}
            </div>
          ) : overview ? (
            <>
              {/* KPI Strip */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">Students Assessed</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                    {overview.summary.studentsAssessed}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                    {overview.summary.scoredEntriesCount} score entries
                  </p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">Overall Average</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                    {overview.summary.overallAveragePct.toFixed(1)}%
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Cohort mean score</p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">Pass Rate</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                    {overview.summary.passRatePct.toFixed(1)}%
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">50%+ threshold</p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">Attendance Rate</p>
                  <p className="text-2xl font-bold text-sky-700 mt-1 tabular-nums">
                    {overview.summary.attendanceRatePct.toFixed(1)}%
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                    {overview.summary.attendanceRecordsCount} logs
                  </p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">Published Reports</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                    {overview.summary.reportCardsPublished}
                    <span className="text-sm font-normal text-slate-400">
                      /{overview.summary.reportCardsTotal}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                    {overview.summary.publishedExamsCount} published exam(s)
                  </p>
                </div>
              </div>

              {/* Charts Row: Multi-Term Trend SVG + Subject Averages */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">Multi-Term Performance Trend</h3>
                    <span className="text-[11px] text-slate-500">Mean Score %</span>
                  </div>
                  {overview.termTrend.length === 0 ? (
                    <p className="py-10 text-center text-xs text-slate-400">
                      No term examination scores recorded for the selected filters.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <svg viewBox="0 0 420 140" className="w-full h-36 overflow-visible">
                        <line x1="24" y1="115" x2="404" y2="115" stroke="#e2e8f0" strokeWidth="1" />
                        <line x1="24" y1="65" x2="404" y2="65" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1="24" y1="15" x2="404" y2="15" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3 3" />
                        {overview.termTrend.length > 1 && (
                          <polyline
                            fill="none"
                            stroke="#059669"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={overview.termTrend
                              .map((pt, i) => {
                                const x =
                                  36 + (i * 356) / Math.max(1, overview.termTrend.length - 1);
                                const y = 115 - Math.min(100, Math.max(0, pt.averagePct));
                                return `${x},${y}`;
                              })
                              .join(' ')}
                          />
                        )}
                        {overview.termTrend.map((pt, i) => {
                          const x =
                            overview.termTrend.length === 1
                              ? 210
                              : 36 + (i * 356) / (overview.termTrend.length - 1);
                          const y = 115 - Math.min(100, Math.max(0, pt.averagePct));
                          return (
                            <g key={pt.key}>
                              <circle cx={x} cy={y} r="4.5" fill="#059669" stroke="#ffffff" strokeWidth="1.5" />
                              <text x={x} y={y - 9} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">
                                {pt.averagePct.toFixed(1)}%
                              </text>
                              <text x={x} y="132" textAnchor="middle" fontSize="9.5" fill="#64748b">
                                {pt.label.slice(0, 18)}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  )}
                </div>

                {/* Subject Averages & Pass Rates */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">Subject Averages &amp; Pass Rates</h3>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {overview.subjectTrends.length} Subject(s)
                    </span>
                  </div>
                  {overview.subjectTrends.length === 0 ? (
                    <p className="py-10 text-center text-xs text-slate-400">No subject score entries match your filters.</p>
                  ) : (
                    <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                      {overview.subjectTrends.map((st) => (
                        <div key={st.subjectId} className="space-y-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-800 truncate">{st.subjectName}</span>
                            <span className="text-slate-600 tabular-nums shrink-0 ml-2">
                              <strong>{st.averagePct.toFixed(1)}%</strong> · Pass {st.passRatePct.toFixed(0)}% ({st.entriesCount})
                            </span>
                          </div>
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-600 rounded-full"
                              style={{ width: `${Math.min(100, Math.max(2, st.averagePct))}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Class Rankings + Grade Distribution */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">Class Performance Comparison</h3>
                  {overview.classRankings.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-400">No class averages computed yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                            <th className="py-2 px-3">Class</th>
                            <th className="py-2 px-3 text-right">Students</th>
                            <th className="py-2 px-3 text-right">Entries</th>
                            <th className="py-2 px-3 text-right">Average %</th>
                            <th className="py-2 px-3 text-right">Pass Rate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {overview.classRankings.map((cr) => (
                            <tr key={cr.classId} className="hover:bg-slate-50/60">
                              <td className="py-2.5 px-3 font-semibold text-slate-900">{cr.className}</td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{cr.studentsCount}</td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{cr.entriesCount}</td>
                              <td className="py-2.5 px-3 text-right font-bold tabular-nums text-emerald-700">
                                {cr.averagePct.toFixed(1)}%
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                                {cr.passRatePct.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">Grade Distribution</h3>
                  {overview.gradeDistribution.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-400">No graded entries yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {overview.gradeDistribution.map((gd) => {
                        const total = overview.summary.scoredEntriesCount || 1;
                        const pct = Math.round((gd.count / total) * 100);
                        return (
                          <div key={gd.grade} className="flex items-center gap-3 text-xs">
                            <span className="w-8 font-bold text-slate-900">{gd.grade}</span>
                            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-slate-800 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-14 text-right tabular-nums text-slate-600">
                              {gd.count} ({pct}%)
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Top Performing & At-Risk Students */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">Top Performing Students</h3>
                  {overview.topStudents.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400">No student rankings available yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 px-2">Student</th>
                            <th className="py-2 px-2">Class</th>
                            <th className="py-2 px-2 text-right">Average</th>
                            <th className="py-2 px-2 text-right">Attendance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {overview.topStudents.map((st, idx) => (
                            <tr key={st.studentId}>
                              <td className="py-2 px-2 font-medium text-slate-900">
                                {idx + 1}. {st.studentName}{' '}
                                <span className="text-[10px] font-mono text-slate-400">{st.admissionNumber}</span>
                              </td>
                              <td className="py-2 px-2 text-slate-600">{st.className}</td>
                              <td className="py-2 px-2 text-right font-bold text-emerald-700 tabular-nums">
                                {st.averagePct.toFixed(1)}%
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums text-slate-600">
                                {st.attendancePct !== null ? `${st.attendancePct.toFixed(0)}%` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">At-Risk Academic &amp; Attendance Watch</h3>
                  {overview.atRiskStudents.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400">
                      No students currently flagged below academic or attendance thresholds.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-2 px-2">Student</th>
                            <th className="py-2 px-2">Class</th>
                            <th className="py-2 px-2 text-right">Average</th>
                            <th className="py-2 px-2 text-right">Attendance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {overview.atRiskStudents.map((st) => (
                            <tr key={st.studentId}>
                              <td className="py-2 px-2 font-medium text-slate-900">
                                {st.studentName}{' '}
                                <span className="text-[10px] font-mono text-slate-400">{st.admissionNumber}</span>
                              </td>
                              <td className="py-2 px-2 text-slate-600">{st.className}</td>
                              <td className="py-2 px-2 text-right font-bold text-rose-700 tabular-nums">
                                {st.averagePct.toFixed(1)}%
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums text-slate-600">
                                {st.attendancePct !== null ? `${st.attendancePct.toFixed(0)}%` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 2: SUBJECTS */}
      {/* ===================================================================== */}
      {subTab === 'subjects' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Curriculum {instLabels.subjectPlural} ({subjects.length})
              </h3>
              <p className="text-xs text-slate-500">
                {showCreditUnits
                  ? `${instLabels.subjectPlural} and modifiable Credit Units (0–12) used to compute weighted GPA & CGPA transcripts.`
                  : `${instLabels.subjectPlural} assessed in examinations and report cards. Credit units can be adjusted anytime (e.g. 1, 2, 3, or 4 units).`}
              </p>
            </div>
            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHistoricalBacklogOpen(true)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5 text-slate-600" />
                  <span>Upload Previous Years</span>
                </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkCoursesPrefill({
                        classId: subjectFilterClassId || '',
                        department:
                          subjectFilterDepartment && subjectFilterDepartment !== '__GENERAL__'
                            ? subjectFilterDepartment
                            : '',
                        semesterTag:
                          subjectFilterSemester !== 'ALL'
                            ? subjectFilterSemester
                            : isTertiary
                            ? '1ST'
                            : '',
                      });
                      setBulkCoursesOpen(true);
                    }}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Bulk Add {instLabels.subjectPlural}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSubject(null);
                      setSubjectForm({
                        name: '',
                        code: '',
                        department:
                          subjectFilterDepartment && subjectFilterDepartment !== '__GENERAL__'
                            ? subjectFilterDepartment
                            : '',
                        class_id: subjectFilterClassId || '',
                        credit_units: '3',
                        course_type: 'CORE',
                        semester_tag:
                          subjectFilterSemester !== 'ALL'
                            ? subjectFilterSemester
                            : isTertiary
                            ? '1ST'
                            : '',
                        status: 'ACTIVE',
                      });
                      setSubjectModalOpen(true);
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add {instLabels.subject}</span>
                  </button>
                </div>
              )}
          </div>

          {/* Level, Department & Semester Catalog Filters */}
          {subjects.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs">
              <select
                value={subjectFilterClassId}
                onChange={(e) => {
                  setSubjectFilterClassId(e.target.value);
                  setSelectedCatalogSubjectIds([]);
                }}
                aria-label={`Filter by ${instLabels.classLabel}`}
                className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 font-medium"
              >
                <option value="">All {isTertiary ? 'Levels' : instLabels.classPlural}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={subjectFilterDepartment}
                onChange={(e) => {
                  setSubjectFilterDepartment(e.target.value);
                  setSelectedCatalogSubjectIds([]);
                }}
                aria-label="Filter by Department"
                className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 font-medium"
              >
                <option value="">All Departments</option>
                <option value="__GENERAL__">General / Shared (Untagged)</option>
                {availableDepartmentNames.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { key: 'ALL', label: `All ${instLabels.cycle}s` },
                    ...getSemesterTagOptions(instLabels.cycle, isTertiary, instProfile.cycleLabels).map((opt) => ({
                      key: opt.value,
                      label: opt.value === '' ? 'Full Session' : opt.label,
                    })),
                  ] as Array<{ key: 'ALL' | '' | '1ST' | '2ND' | '3RD'; label: string }>
                ).map((item) => (
                  <button
                    key={item.key || 'FULL_SES'}
                    type="button"
                    onClick={() => {
                      setSubjectFilterSemester(item.key);
                      setSelectedCatalogSubjectIds([]);
                    }}
                    className={`px-2.5 py-1 rounded-lg border font-semibold transition cursor-pointer ${
                      subjectFilterSemester === item.key
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 1-Click Bulk Assign Department / Level / Semester Bar */}
          {!readOnly && selectedCatalogSubjectIds.length > 0 && (
            <div className="bg-slate-900 text-white rounded-xl p-3 flex flex-wrap items-center gap-2.5 text-xs">
              <span className="font-bold inline-flex items-center gap-1.5 text-emerald-400 shrink-0">
                <Tags className="w-3.5 h-3.5" />
                {selectedCatalogSubjectIds.length} selected
              </span>
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <input
                  type="text"
                  list="school-departments-datalist"
                  value={bulkAssignDept}
                  onChange={(e) => setBulkAssignDept(e.target.value)}
                  placeholder="Assign Department (e.g. Family Healthcare)"
                  className="px-2.5 py-1.5 bg-white text-slate-900 border border-slate-300 rounded-lg text-xs min-w-[200px]"
                />
                <select
                  value={bulkAssignClassId}
                  onChange={(e) => setBulkAssignClassId(e.target.value)}
                  aria-label="Bulk assign level"
                  className="px-2.5 py-1.5 bg-white text-slate-900 border border-slate-300 rounded-lg text-xs"
                >
                  <option value="__KEEP__">Keep {instLabels.classLabel}</option>
                  <option value="">All {instLabels.classPlural}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={bulkAssignSemTag}
                  onChange={(e) => setBulkAssignSemTag(e.target.value)}
                  aria-label="Bulk assign semester"
                  className="px-2.5 py-1.5 bg-white text-slate-900 border border-slate-300 rounded-lg text-xs"
                >
                  <option value="__KEEP__">Keep {instLabels.cycle}</option>
                  {getSemesterTagOptions(instLabels.cycle, isTertiary, instProfile.cycleLabels).map((opt) => (
                    <option key={opt.value || 'ALL_SEM'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={bulkAssignSaving}
                  onClick={handleBulkAssignSubjects}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
                >
                  {bulkAssignSaving ? 'Applying...' : 'Apply to Selected'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCatalogSubjectIds([])}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {(() => {
            const visibleSubjects = subjects.filter((sub) => {
              if (subjectFilterClassId && sub.class_id !== subjectFilterClassId) return false;
              if (subjectFilterDepartment === '__GENERAL__') {
                const d = (sub.department || '').trim().toLowerCase();
                if (d && d !== 'general') return false;
              } else if (subjectFilterDepartment) {
                if ((sub.department || '').trim().toLowerCase() !== subjectFilterDepartment.trim().toLowerCase()) {
                  return false;
                }
              }
              if (subjectFilterSemester !== 'ALL') {
                const subTag = normalizeSemesterTag(sub.semester_tag);
                if (subTag !== subjectFilterSemester) return false;
              }
              return true;
            });
            const semOpts = getSemesterTagOptions(instLabels.cycle, isTertiary, instProfile.cycleLabels);
            const allVisibleSelected =
              visibleSubjects.length > 0 && visibleSubjects.every((s) => selectedCatalogSubjectIds.includes(s.id));

            if (subjects.length === 0) {
              return (
                <div className="py-10 text-center space-y-2">
                  <p className="text-xs text-slate-400">
                    No {instLabels.subjectPlural.toLowerCase()} configured yet.
                  </p>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        setBulkCoursesPrefill({ classId: '', department: '', semesterTag: isTertiary ? '1ST' : '' });
                        setBulkCoursesOpen(true);
                      }}
                      className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Load Preset or Bulk Add {instLabels.subjectPlural}</span>
                    </button>
                  )}
                </div>
              );
            }

            if (visibleSubjects.length === 0) {
              return (
                <div className="py-8 text-center text-xs text-slate-500">
                  No {instLabels.subjectPlural.toLowerCase()} match the selected {instLabels.classLabel.toLowerCase()}, department, and {instLabels.cycle.toLowerCase()} filter.
                </div>
              );
            }

            return (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      {!readOnly && (
                        <th className="py-2.5 px-2.5 w-8">
                          <button
                            type="button"
                            onClick={() => {
                              if (allVisibleSelected) {
                                setSelectedCatalogSubjectIds((prev) =>
                                  prev.filter((id) => !visibleSubjects.some((s) => s.id === id))
                                );
                              } else {
                                const merged = new Set([
                                  ...selectedCatalogSubjectIds,
                                  ...visibleSubjects.map((s) => s.id),
                                ]);
                                setSelectedCatalogSubjectIds(Array.from(merged));
                              }
                            }}
                            aria-label="Select all visible courses"
                            className="text-slate-500 hover:text-emerald-700 cursor-pointer"
                          >
                            {allVisibleSelected ? (
                              <CheckSquare className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </th>
                      )}
                      <th className="py-2.5 px-3">Code</th>
                      <th className="py-2.5 px-3">{instLabels.subject} Title</th>
                      <th className="py-2.5 px-3">Credit Units</th>
                      <th className="py-2.5 px-3">{instLabels.cycle}</th>
                      <th className="py-2.5 px-3">Target {instLabels.classLabel}</th>
                      <th className="py-2.5 px-3">Department</th>
                      <th className="py-2.5 px-3">Status</th>
                      {!readOnly && <th className="py-2.5 px-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleSubjects.map((sub) => {
                      const currentUnits = Number(sub.credit_units ?? 3);
                      const isSavingUnits = inlineUnitSavingId === sub.id;
                      const currentSemTag = normalizeSemesterTag(sub.semester_tag);
                      const isSavingSem = inlineSemSavingId === sub.id;
                      const isSelected = selectedCatalogSubjectIds.includes(sub.id);
                      return (
                        <tr
                          key={sub.id}
                          className={`hover:bg-slate-50/60 ${isSelected ? 'bg-emerald-50/40' : ''}`}
                        >
                          {!readOnly && (
                            <td className="py-2.5 px-2.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedCatalogSubjectIds((prev) =>
                                    prev.includes(sub.id)
                                      ? prev.filter((id) => id !== sub.id)
                                      : [...prev, sub.id]
                                  )
                                }
                                aria-label={`Select ${sub.name}`}
                                className="text-slate-400 hover:text-emerald-700 cursor-pointer"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-emerald-600" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            </td>
                          )}
                          <td className="py-2.5 px-3 font-mono text-slate-700 font-semibold whitespace-nowrap">{sub.code}</td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            <span>{sub.name}</span>
                            {sub.course_type && sub.course_type !== 'CORE' && (
                              <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                · {sub.course_type}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            {readOnly ? (
                              <span className="font-bold tabular-nums text-emerald-700">{currentUnits}u</span>
                            ) : (
                              <div className="inline-flex items-center gap-1">
                                {[1, 2, 3, 4].map((u) => (
                                  <button
                                    key={u}
                                    type="button"
                                    disabled={isSavingUnits}
                                    onClick={() => handleInlineCreditUnitsChange(sub, u)}
                                    title={`Set ${sub.code || sub.name} to ${u} credit unit${u === 1 ? '' : 's'}`}
                                    className={`w-6 h-6 rounded-md text-[11px] font-bold tabular-nums transition cursor-pointer ${
                                      currentUnits === u
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                  >
                                    {u}
                                  </button>
                                ))}
                                <select
                                  aria-label={`Credit units for ${sub.name}`}
                                  disabled={isSavingUnits}
                                  value={String(currentUnits)}
                                  onChange={(e) => handleInlineCreditUnitsChange(sub, Number(e.target.value))}
                                  className="ml-0.5 px-1.5 py-1 bg-slate-50 border border-slate-300 rounded-md text-[11px] font-semibold tabular-nums text-slate-700"
                                >
                                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((u) => (
                                    <option key={u} value={u}>
                                      {u}u
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            {readOnly ? (
                              <span className="text-slate-600">
                                {formatSemesterTagLabel(sub.semester_tag, instLabels.cycle, instProfile.cycleLabels)}
                              </span>
                            ) : (
                              <select
                                aria-label={`${instLabels.cycle} for ${sub.name}`}
                                disabled={isSavingSem}
                                value={currentSemTag}
                                onChange={(e) =>
                                  handleInlineSemesterTagChange(sub, e.target.value as CanonicalSemesterTag)
                                }
                                className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-[11px] font-medium text-slate-700"
                              >
                                {semOpts.map((opt) => (
                                  <option key={opt.value || 'ALL'} value={opt.value}>
                                    {opt.value === '' ? `All ${instLabels.cycle}s` : opt.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{sub.class_name || `All ${instLabels.classPlural}`}</td>
                          <td className="py-2.5 px-3">
                            {sub.department ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-800">
                                {sub.department}
                              </span>
                            ) : (
                              <span className="text-slate-400">General</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`text-[11px] font-semibold ${
                                sub.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-400'
                              }`}
                            >
                              {sub.status}
                            </span>
                          </td>
                          {!readOnly && (
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSubject(sub);
                                    setSubjectForm({
                                      name: sub.name,
                                      code: sub.code,
                                      department: sub.department || '',
                                      class_id: sub.class_id || '',
                                      credit_units: String(sub.credit_units ?? 3),
                                      course_type: (sub.course_type as 'CORE' | 'ELECTIVE' | 'GENERAL') || 'CORE',
                                      semester_tag: normalizeSemesterTag(sub.semester_tag),
                                      status: sub.status,
                                    });
                                    setSubjectModalOpen(true);
                                  }}
                                  className="p-1.5 text-slate-500 hover:text-blue-700 rounded-lg hover:bg-blue-50 cursor-pointer"
                                  title={`Edit ${instLabels.subject}`}
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSubject(sub)}
                                  className="p-1.5 text-slate-500 hover:text-rose-700 rounded-lg hover:bg-rose-50 cursor-pointer"
                                  title={`Delete ${instLabels.subject}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 2B: BULK COURSE / SUBJECT REGISTRATION */}
      {/* ===================================================================== */}
      {subTab === 'course_reg' && (
        <CourseRegistrationPanel
          sessions={sessions}
          classes={classes}
          subjects={subjects}
          students={rosterStudents}
          departments={departments}
          isAdmin={!readOnly}
          isTertiary={isTertiary}
          subjectLabel={instLabels.subject}
          subjectPlural={instLabels.subjectPlural}
          classLabel={instLabels.classLabel}
          cycleLabel={instLabels.cycle}
          cycleLabels={instProfile.cycleLabels}
          learnerLabel={isTertiary ? 'Student' : 'Learner'}
          learnerPlural={isTertiary ? 'Students' : 'Learners'}
          onOpenHistoricalBacklog={() => setHistoricalBacklogOpen(true)}
          onOpenBulkCourses={(prefillClassId, prefillSemTag, prefillDept) => {
            setBulkCoursesPrefill({
              classId: prefillClassId || '',
              department: prefillDept || '',
              semesterTag: prefillSemTag !== undefined ? prefillSemTag : isTertiary ? '1ST' : '',
            });
            setBulkCoursesOpen(true);
          }}
          onOpenSessionReports={() => {
            setReportMode('SESSION');
            setSubTab('reports');
          }}
          onLaunchGradingFromRegistrations={handleLaunchGradingFromRegistrations}
          onToast={(type, text) => showMsg(type === 'success' ? 'ok' : 'err', text)}
        />
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 3: EXAMINATIONS & SCORES */}
      {/* ===================================================================== */}
      {subTab === 'exams' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Examinations &amp; Result Approval Workflow</h3>
                <p className="text-xs text-slate-500">
                  Draft → Review → Approved → Published. Published scores lock against direct edits and require audited corrections.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={examFilterStatus}
                  onChange={(e) => setExamFilterStatus(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                >
                  <option value="">All Workflow States</option>
                  <option value="DRAFT">Draft</option>
                  <option value="REVIEW">In Review</option>
                  <option value="APPROVED">Approved</option>
                  <option value="PUBLISHED">Published</option>
                </select>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      disabled={openingFromReg || !examForm.academic_session_id || !examForm.term_id}
                      onClick={() =>
                        handleLaunchGradingFromRegistrations({
                          academic_session_id: examForm.academic_session_id,
                          term_id: examForm.term_id,
                          class_id: examForm.class_id || null,
                          department: examForm.department || null,
                        })
                      }
                      className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <Layers className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{openingFromReg ? 'Opening...' : 'Open Exam from Registrations'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExamModalOpen(true)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4" />
                      <span>New Examination</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {examsLoading ? (
              <p className="py-8 text-center text-xs text-slate-400">Loading examinations...</p>
            ) : exams.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">No examinations created yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-3">Examination</th>
                      <th className="py-2.5 px-3">Session / {instLabels.cycle}</th>
                      <th className="py-2.5 px-3">{instLabels.classLabel} / Department</th>
                      <th className="py-2.5 px-3 text-right">Max (CA/Exam)</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {exams.map((ex) => (
                      <tr
                        key={ex.id}
                        className={`hover:bg-slate-50/60 ${selectedExam?.id === ex.id ? 'bg-emerald-50/40' : ''}`}
                      >
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {ex.title}
                          <span className="block text-[11px] font-normal text-slate-500">
                            {ex.exam_type} · {ex.scores_count || 0} score(s)
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {ex.session_name || '—'} · {ex.term_name || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          <span>{ex.class_name || `All ${instLabels.classPlural}`}</span>
                          {ex.department && (
                            <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-semibold text-slate-700">
                              {ex.department}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                          {ex.ca_max_score} / {ex.exam_max_score}
                        </td>
                        <td className="py-2.5 px-3">
                          <WorkflowStatusBadge status={ex.status} />
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => {
                                const subj = scoreSubjectId || subjects[0]?.id || '';
                                setScoreSubjectId(subj);
                                setScoreQueueDeptFilter(ex.department || '');
                                loadExamScoreSheet(ex, subj, {
                                  registeredOnly: true,
                                  autoPickRegistered: true,
                                });
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              {readOnly ? 'View Scores' : 'Score Sheet'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setBroadsheetExamId(ex.id)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                              title="Open Master Class / Level Broadsheet"
                            >
                              <FileSpreadsheet className="w-3 h-3 text-emerald-700" />
                              <span>Broadsheet</span>
                            </button>
                            {!readOnly && ex.status === 'DRAFT' && (
                              <button
                                type="button"
                                onClick={() => handleTransitionExamStatus(ex, 'REVIEW')}
                                className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-semibold cursor-pointer"
                              >
                                Submit Review
                              </button>
                            )}
                            {!readOnly && ex.status === 'REVIEW' && (
                              <button
                                type="button"
                                onClick={() => handleTransitionExamStatus(ex, 'APPROVED')}
                                className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-semibold cursor-pointer"
                              >
                                Approve
                              </button>
                            )}
                            {!readOnly && ex.status === 'APPROVED' && (
                              <button
                                type="button"
                                onClick={() => handleTransitionExamStatus(ex, 'PUBLISHED')}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Publish
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Score Entry / Published Inspection Sheet */}
          {selectedExam && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-900">
                      Score Sheet · {selectedExam.title}
                    </h4>
                    <WorkflowStatusBadge status={selectedExam.status} />
                    {selectedExam.department && (
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-700">
                        {selectedExam.department}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    CA Max: {selectedExam.ca_max_score} · Exam Max: {selectedExam.exam_max_score} · Total Max: {selectedExam.total_max_score}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={scoreSubjectId}
                    onChange={(e) => {
                      setScoreSubjectId(e.target.value);
                      loadExamScoreSheet(selectedExam, e.target.value);
                    }}
                    className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium max-w-xs"
                  >
                    {[...subjects]
                      .sort((a, b) => {
                        const aReg = registeredSubjectsQueue.some((q) => q.subject_id === a.id);
                        const bReg = registeredSubjectsQueue.some((q) => q.subject_id === b.id);
                        if (aReg !== bReg) return aReg ? -1 : 1;
                        const aMatch =
                          (!selectedExam.class_id || !a.class_id || a.class_id === selectedExam.class_id) &&
                          termMatchesSemesterTag(selectedExam.term_name, a.semester_tag);
                        const bMatch =
                          (!selectedExam.class_id || !b.class_id || b.class_id === selectedExam.class_id) &&
                          termMatchesSemesterTag(selectedExam.term_name, b.semester_tag);
                        if (aMatch !== bMatch) return aMatch ? -1 : 1;
                        return a.name.localeCompare(b.name);
                      })
                      .map((sub) => {
                        const semTagLabel = sub.semester_tag
                          ? ` · ${formatSemesterTagLabel(sub.semester_tag, instLabels.cycle, instProfile.cycleLabels)}`
                          : '';
                        const deptTag = sub.department ? ` [${sub.department}]` : '';
                        return (
                          <option key={sub.id} value={sub.id}>
                            {sub.code ? `${sub.code} — ` : ''}
                            {sub.name}
                            {deptTag}
                            {semTagLabel}
                          </option>
                        );
                      })}
                  </select>

                  {scoreRoster.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDownloadRosterCsv}
                      className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      title="Download pre-filled Excel/CSV template for the current roster"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-500" />
                      <span>Roster CSV</span>
                    </button>
                  )}

                  {!readOnly && selectedExam.status !== 'PUBLISHED' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPasteDrawerOpen((prev) => !prev)}
                        className={`px-3 py-2 border rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                          pasteDrawerOpen
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                        }`}
                      >
                        <ClipboardPaste className="w-3.5 h-3.5" />
                        <span>Paste Excel Scores</span>
                      </button>

                      <button
                        type="button"
                        disabled={scoresSaving || !scoreSubjectId}
                        onClick={() => handleSaveScores(false)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{scoresSaving ? 'Saving...' : 'Save Scores'}</span>
                      </button>

                      {registeredSubjectsQueue.length > 1 && (
                        <button
                          type="button"
                          disabled={scoresSaving || !scoreSubjectId}
                          onClick={() => handleSaveScores(true)}
                          className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <span>Save &amp; Next Course</span>
                          <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Registered Courses Grading Queue (Reuse Registered Courses at Scale) */}
              {registeredSubjectsQueue.length > 0 && (() => {
                const queueDepts = Array.from(
                  new Set(
                    registeredSubjectsQueue
                      .map((q) => (q.department || '').trim())
                      .filter((d) => d && d.toLowerCase() !== 'general')
                  )
                ).sort((a, b) => a.localeCompare(b));

                const visibleQueue = registeredSubjectsQueue.filter((q) => {
                  if (!scoreQueueDeptFilter) return true;
                  const qDept = (q.department || '').trim().toLowerCase();
                  if (scoreQueueDeptFilter === '__GENERAL__') return !qDept || qDept === 'general';
                  return qDept === scoreQueueDeptFilter.toLowerCase();
                });

                const completedCourses = visibleQueue.filter(
                  (q) => q.registered_count > 0 && q.scored_count >= q.registered_count
                ).length;

                return (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 inline-flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-emerald-600" />
                          Registered {instLabels.subjectPlural} Grading Queue
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {completedCourses}/{visibleQueue.length} graded
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {queueDepts.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setScoreQueueDeptFilter('')}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border cursor-pointer ${
                                !scoreQueueDeptFilter
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              All Depts
                            </button>
                            {queueDepts.map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setScoreQueueDeptFilter(d)}
                                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border cursor-pointer ${
                                  scoreQueueDeptFilter.toLowerCase() === d.toLowerCase()
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                {d}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setScoreQueueDeptFilter('__GENERAL__')}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border cursor-pointer ${
                                scoreQueueDeptFilter === '__GENERAL__'
                                  ? 'bg-slate-700 text-white border-slate-700'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              General
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                      {visibleQueue.map((item) => {
                        const isActive = item.subject_id === scoreSubjectId;
                        const isDone = item.registered_count > 0 && item.scored_count >= item.registered_count;
                        const isPartial = item.scored_count > 0 && item.scored_count < item.registered_count;
                        return (
                          <button
                            key={item.subject_id}
                            type="button"
                            onClick={() => {
                              setScoreSubjectId(item.subject_id);
                              loadExamScoreSheet(selectedExam, item.subject_id, {
                                registeredOnly: scoreRegisteredOnly,
                              });
                            }}
                            className={`px-2.5 py-1.5 rounded-lg border text-left text-[11px] transition cursor-pointer inline-flex items-center gap-1.5 ${
                              isActive
                                ? 'bg-slate-900 text-white border-slate-900'
                                : isDone
                                ? 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                                : isPartial
                                ? 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            <span className="font-mono font-bold">{item.code || item.name}</span>
                            <span className="opacity-70">{item.credit_units}u</span>
                            {item.department && (
                              <span
                                className={`text-[10px] px-1 py-0.5 rounded ${
                                  isActive ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {item.department}
                              </span>
                            )}
                            <span
                              className={`tabular-nums font-bold ${
                                isActive
                                  ? 'text-emerald-400'
                                  : isDone
                                  ? 'text-emerald-700'
                                  : isPartial
                                  ? 'text-amber-700'
                                  : 'text-slate-500'
                              }`}
                            >
                              {item.scored_count}/{item.registered_count}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Roster Scope Switcher */}
                    <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setScoreRegisteredOnly(true);
                            loadExamScoreSheet(selectedExam, scoreSubjectId, { registeredOnly: true });
                          }}
                          className={`px-2.5 py-1 rounded-md font-semibold border cursor-pointer ${
                            scoreRegisteredOnly
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          Registered Students Only (incl. Carryovers)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setScoreRegisteredOnly(false);
                            loadExamScoreSheet(selectedExam, scoreSubjectId, { registeredOnly: false });
                          }}
                          className={`px-2.5 py-1 rounded-md font-semibold border cursor-pointer ${
                            !scoreRegisteredOnly
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          All Cohort Students
                        </button>
                      </div>
                      <span className="text-slate-500 tabular-nums">
                        Showing <strong className="text-slate-800">{scoreRoster.length}</strong> student(s) for active course
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Bulk Excel / CSV Score Paste Drawer */}
              {pasteDrawerOpen && !readOnly && selectedExam.status !== 'PUBLISHED' && (
                <div className="bg-slate-50 border border-emerald-200 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">
                        Paste Scores Directly from Excel, Google Sheets, or CSV
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Format: <code className="bg-white px-1 py-0.5 rounded border border-slate-200">Admission No (or Full Name), CA Score, Exam Score, Remark</code> — headers and S/N columns are skipped automatically.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPasteDrawerOpen(false)}
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <textarea
                    rows={5}
                    value={pasteRawText}
                    onChange={(e) => setPasteRawText(e.target.value)}
                    placeholder={`CHT/FHC/001\t28\t54\tExcellent\nCHT/FHC/002\t22\t48\tGood`}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />

                  {parsedPastePreview && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold">
                        <span className="text-emerald-700">
                          ✓ {parsedPastePreview.matchedCount} matched &amp; valid
                        </span>
                        {parsedPastePreview.unmatchedCount > 0 && (
                          <span className="text-amber-700">
                            ⚠ {parsedPastePreview.unmatchedCount} unmatched student(s)
                          </span>
                        )}
                        {parsedPastePreview.errorCount > 0 && (
                          <span className="text-rose-700">
                            ✕ {parsedPastePreview.errorCount} score range error(s)
                          </span>
                        )}
                      </div>

                      {parsedPastePreview.rows.some((r) => r.error) && (
                        <div className="max-h-24 overflow-y-auto bg-rose-50 border border-rose-200 rounded-lg p-2 space-y-1 text-[11px] text-rose-800">
                          {parsedPastePreview.rows
                            .filter((r) => r.error)
                            .slice(0, 8)
                            .map((r) => (
                              <p key={r.rowNumber}>
                                Line {r.rowNumber} ({r.rawIdentifier}): {r.error}
                              </p>
                            ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPasteRawText('');
                        setPasteDrawerOpen(false);
                      }}
                      className="px-3 py-1.5 border border-slate-300 bg-white text-slate-700 rounded-lg font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!parsedPastePreview || parsedPastePreview.matchedCount === 0}
                      onClick={() => handleApplyPastedScores(false)}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
                    >
                      Apply to Sheet ({parsedPastePreview?.matchedCount || 0})
                    </button>
                    <button
                      type="button"
                      disabled={scoresSaving || !parsedPastePreview || parsedPastePreview.matchedCount === 0}
                      onClick={() => handleApplyPastedScores(true)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
                    >
                      Apply &amp; Save Immediately
                    </button>
                  </div>
                </div>
              )}

              {scoresLoading ? (
                <p className="py-8 text-center text-xs text-slate-400">Loading class roster and scores...</p>
              ) : scoreRoster.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">
                  No students match this course roster yet. Switch to &ldquo;All Cohort Students&rdquo; or register students for this course first.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                        <th className="py-2.5 px-3">Student</th>
                        <th className="py-2.5 px-3">{instLabels.classLabel} / Dept</th>
                        <th className="py-2.5 px-3 text-right">CA (/{selectedExam.ca_max_score})</th>
                        <th className="py-2.5 px-3 text-right">Exam (/{selectedExam.exam_max_score})</th>
                        <th className="py-2.5 px-3 text-right">Total</th>
                        <th className="py-2.5 px-3 text-center">Grade</th>
                        <th className="py-2.5 px-3">Subject Remark</th>
                        {!readOnly && selectedExam.status === 'PUBLISHED' && (
                          <th className="py-2.5 px-3 text-right">Audit Correction</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {scoreRoster.map((st) => {
                        const existing = examScores.find(
                          (sc) => sc.student_id === st.id && (!scoreSubjectId || sc.subject_id === scoreSubjectId)
                        );
                        const draft = scoreDrafts[st.id] || { ca_score: '', exam_score: '', subject_remark: '' };
                        const locked = readOnly || selectedExam.status === 'PUBLISHED';
                        const hasDraftInput = draft.ca_score !== '' || draft.exam_score !== '';
                        const liveTotal = hasDraftInput
                          ? (draft.ca_score === '' ? 0 : Number(draft.ca_score)) +
                            (draft.exam_score === '' ? 0 : Number(draft.exam_score))
                          : existing?.total_score ?? null;
                        const isCarryover =
                          st.registration_type === 'CARRYOVER' ||
                          (Boolean(selectedExam.class_id) && Boolean(st.class_id) && st.class_id !== selectedExam.class_id);

                        return (
                          <tr key={st.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 font-medium text-slate-900">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span>{st.full_name}</span>
                                {isCarryover && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-800">
                                    CARRYOVER
                                  </span>
                                )}
                              </div>
                              <span className="block text-[10px] font-mono text-slate-400">{st.admission_number}</span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              <span>{st.class_name || '—'}</span>
                              {st.class_arm_name && (
                                <span className="block text-[10px] font-semibold text-slate-500">
                                  {st.class_arm_name}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {locked ? (
                                <span className="tabular-nums font-medium">{existing?.ca_score ?? '—'}</span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  max={selectedExam.ca_max_score}
                                  step="0.5"
                                  value={draft.ca_score}
                                  onChange={(e) =>
                                    setScoreDrafts((prev) => ({
                                      ...prev,
                                      [st.id]: { ...draft, ca_score: e.target.value },
                                    }))
                                  }
                                  className="w-20 px-2 py-1 text-right bg-slate-50 border border-slate-300 rounded-lg tabular-nums"
                                />
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {locked ? (
                                <span className="tabular-nums font-medium">{existing?.exam_score ?? '—'}</span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  max={selectedExam.exam_max_score}
                                  step="0.5"
                                  value={draft.exam_score}
                                  onChange={(e) =>
                                    setScoreDrafts((prev) => ({
                                      ...prev,
                                      [st.id]: { ...draft, exam_score: e.target.value },
                                    }))
                                  }
                                  className="w-20 px-2 py-1 text-right bg-slate-50 border border-slate-300 rounded-lg tabular-nums"
                                />
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold tabular-nums text-slate-900">
                              {liveTotal !== null && Number.isFinite(liveTotal) ? liveTotal : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-center font-bold text-emerald-700">
                              {existing?.grade || '—'}
                            </td>
                            <td className="py-2.5 px-3">
                              {locked ? (
                                <span className="text-slate-600">{existing?.subject_remark || existing?.grade_remark || '—'}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={draft.subject_remark}
                                  onChange={(e) =>
                                    setScoreDrafts((prev) => ({
                                      ...prev,
                                      [st.id]: { ...draft, subject_remark: e.target.value },
                                    }))
                                  }
                                  placeholder="Optional remark"
                                  className="w-full min-w-[120px] px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg"
                                />
                              )}
                            </td>
                            {!readOnly && selectedExam.status === 'PUBLISHED' && (
                              <td className="py-2.5 px-3 text-right">
                                {existing ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCorrectingScore(existing);
                                      setCorrectionForm({
                                        ca_score: existing.ca_score !== null ? String(existing.ca_score) : '',
                                        exam_score: existing.exam_score !== null ? String(existing.exam_score) : '',
                                        subject_remark: existing.subject_remark || '',
                                        reason: '',
                                      });
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-semibold cursor-pointer"
                                  >
                                    Correct Score
                                  </button>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Immutable Score Correction Audit Log */}
              {examCorrections.length > 0 && (
                <div className="pt-4 border-t border-slate-200 space-y-2">
                  <h5 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-amber-600" />
                    <span>Immutable Score Correction Audit Log ({examCorrections.length})</span>
                  </h5>
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3">Student</th>
                          <th className="py-2 px-3">Subject</th>
                          <th className="py-2 px-3 text-right">Previous → New Total</th>
                          <th className="py-2 px-3">Mandatory Reason</th>
                          <th className="py-2 px-3">Corrected By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {examCorrections.map((c) => (
                          <tr key={c.id}>
                            <td className="py-2 px-3 font-mono text-slate-500 tabular-nums">
                              {new Date(c.created_at).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 font-semibold text-slate-900">{c.student_name}</td>
                            <td className="py-2 px-3 text-slate-700">{c.subject_name}</td>
                            <td className="py-2 px-3 text-right tabular-nums font-semibold">
                              {c.previous_total ?? '—'} ({c.previous_grade || '—'}) →{' '}
                              <span className="text-emerald-700">
                                {c.new_total ?? '—'} ({c.new_grade || '—'})
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-700">{c.reason}</td>
                            <td className="py-2 px-3 text-slate-500">{c.corrected_by_email || c.corrected_by}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 4: REPORT CARDS (END-OF-TERM & FULL-SESSION CUMULATIVE) */}
      {/* ===================================================================== */}
      {subTab === 'reports' && (
        <div className="space-y-6">
          {/* Instant / On-Demand End-of-Term or Session Report Card Generator (Works for Teachers Read-Only & Admins) */}
          <form
            onSubmit={handleOnDemandCompile}
            className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 text-xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Instant End-of-Term &amp; Full-Session Report Card Generator
                </h3>
                <p className="text-slate-500 mt-0.5">
                  {readOnly
                    ? 'Compile and print End-of-Term or Full-Session Cumulative results for any student without altering official school records.'
                    : 'Preview and print any student’s End-of-Term or Full-Session Cumulative performance result on demand.'}
                </p>
              </div>
              <div className="inline-flex p-1 bg-slate-100 rounded-xl shrink-0">
                <button
                  type="button"
                  onClick={() => setOnDemandType('TERM')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                    onDemandType === 'TERM'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  End-of-Term Report
                </button>
                <button
                  type="button"
                  onClick={() => setOnDemandType('SESSION')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                    onDemandType === 'SESSION'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Full-Session Cumulative
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Student</label>
                <select
                  value={onDemandStudentId}
                  onChange={(e) => setOnDemandStudentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="">Select Student...</option>
                  {rosterStudents.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.full_name} ({st.admission_number || st.class_name || 'Student'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Academic Session</label>
                <select
                  value={onDemandSessionId}
                  onChange={(e) => {
                    const nextSessId = e.target.value;
                    setOnDemandSessionId(nextSessId);
                    const matched = sessions.find((s) => s.id === nextSessId);
                    setOnDemandTermId(matched?.terms?.[0]?.id || '');
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="">Select Session...</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {onDemandType === 'TERM' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Term</label>
                  <select
                    value={onDemandTermId}
                    onChange={(e) => setOnDemandTermId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Term...</option>
                    {(sessions.find((s) => s.id === onDemandSessionId)?.terms || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={onDemandType === 'SESSION' ? 'lg:col-span-2 flex justify-end' : ''}>
                <button
                  type="submit"
                  disabled={onDemandGenerating || !onDemandStudentId || !onDemandSessionId}
                  className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{onDemandGenerating ? 'Compiling...' : 'Generate & View Report'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Official Report Cards Archive & Batch Publishing */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-slate-900">Official Digital Report Cards Registry</h3>
                <div className="inline-flex p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setReportMode('TERM')}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                      reportMode === 'TERM'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    End-of-Term Report Cards
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportMode('SESSION')}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                      reportMode === 'SESSION'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Full-Session Cumulative Reports
                  </button>
                </div>
              </div>

              {!readOnly && reportMode === 'TERM' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={generatingRc}
                    onClick={handleGenerateReportCards}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {generatingRc ? 'Generating...' : 'Generate / Recalculate Term Reports'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePublishClassReportCards}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Publish Filtered Reports</span>
                  </button>
                </div>
              )}

              {!readOnly && reportMode === 'SESSION' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={generatingSessionRc}
                    onClick={handleGenerateSessionReportCards}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {generatingSessionRc ? 'Compiling Session...' : 'Generate Session Cumulative Reports'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePublishClassSessionReportCards}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Publish Filtered Session Reports</span>
                  </button>
                </div>
              )}
            </div>

            <div className={`grid grid-cols-1 ${reportMode === 'TERM' ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-3 text-xs`}>
              <select
                value={rcFilters.academic_session_id}
                onChange={(e) => {
                  const next = { ...rcFilters, academic_session_id: e.target.value, term_id: '' };
                  setRcFilters(next);
                  if (reportMode === 'SESSION') loadSessionReportCards(next);
                  else loadReportCards(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="">All Sessions</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              {reportMode === 'TERM' && (
                <select
                  value={rcFilters.term_id}
                  onChange={(e) => {
                    const next = { ...rcFilters, term_id: e.target.value };
                    setRcFilters(next);
                    loadReportCards(next);
                  }}
                  className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="">All Terms</option>
                  {(rcSessionObj?.terms || sessions.flatMap((s) => s.terms || [])).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={rcFilters.class_id}
                onChange={(e) => {
                  const next = { ...rcFilters, class_id: e.target.value };
                  setRcFilters(next);
                  if (reportMode === 'SESSION') loadSessionReportCards(next);
                  else loadReportCards(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="">All Classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={rcFilters.status}
                onChange={(e) => {
                  const next = { ...rcFilters, status: e.target.value };
                  setRcFilters(next);
                  if (reportMode === 'SESSION') loadSessionReportCards(next);
                  else loadReportCards(next);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="">All Statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="REVIEW">In Review</option>
                <option value="APPROVED">Approved</option>
                <option value="PUBLISHED">Published</option>
              </select>
            </div>

            {reportMode === 'TERM' ? (
              reportsLoading ? (
                <p className="py-10 text-center text-xs text-slate-400">Loading digital report cards...</p>
              ) : reportCards.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-400">
                  No end-of-term report cards match these filters. Use &ldquo;Generate / Recalculate Term Reports&rdquo; after entering scores.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                        <th className="py-2.5 px-3">Student</th>
                        <th className="py-2.5 px-3">Class</th>
                        <th className="py-2.5 px-3">Session / Term</th>
                        <th className="py-2.5 px-3 text-right">Average</th>
                        <th className="py-2.5 px-3 text-right">Position</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportCards.map((rc) => (
                        <tr key={rc.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {rc.student_name}
                            <span className="block text-[10px] font-mono text-slate-400">{rc.admission_number}</span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{rc.class_name || '—'}</td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {rc.session_name} · {rc.term_name}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold tabular-nums text-emerald-700">
                            {Number(rc.average_score || 0).toFixed(1)}%
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                            {rc.class_position ? `${rc.class_position} / ${rc.class_size || '—'}` : '—'}
                          </td>
                          <td className="py-2.5 px-3">
                            <WorkflowStatusBadge status={rc.status} />
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleViewPrintReportCard(rc)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Printer className="w-3 h-3" />
                                <span>View / Print</span>
                              </button>
                              {!readOnly && rc.status !== 'PUBLISHED' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRemarksModalRc(rc);
                                      setRemarksForm({
                                        teacher_remark: rc.teacher_remark || '',
                                        principal_remark: rc.principal_remark || '',
                                        status: (rc.status as any) || 'DRAFT',
                                      });
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-semibold cursor-pointer"
                                  >
                                    Remarks
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handlePublishSingleRc(rc)}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer"
                                  >
                                    Publish
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : sessionReportsLoading ? (
              <p className="py-10 text-center text-xs text-slate-400">
                Loading full-session cumulative report cards...
              </p>
            ) : sessionReportCards.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-400">
                No full-session cumulative report cards match these filters. Select an Academic Session and click &ldquo;Generate Session Cumulative Reports&rdquo;.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-3">Student</th>
                      <th className="py-2.5 px-3">Class</th>
                      <th className="py-2.5 px-3">Session / {instLabels.cycle} Progression</th>
                      <th className="py-2.5 px-3 text-right">{isGpaMode ? 'Sessional CGPA / Avg' : 'Annual Avg'}</th>
                      <th className="py-2.5 px-3 text-right">Position</th>
                      <th className="py-2.5 px-3">Promotion</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessionReportCards.map((src) => (
                      <tr key={src.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">
                          {src.student_name}
                          <span className="block text-[10px] font-mono text-slate-400">{src.admission_number}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{src.class_name || '—'}</td>
                        <td className="py-2.5 px-3 text-slate-600">
                          <span className="font-semibold text-slate-800">{src.session_name}</span>
                          {src.term_averages && src.term_averages.length > 0 && (
                            <span className="block text-[10px] text-slate-500 tabular-nums mt-0.5">
                              {src.term_averages
                                .map((t: any) =>
                                  isGpaMode && t.gpa !== null && t.gpa !== undefined
                                    ? `${t.term_name}: ${Number(t.gpa).toFixed(2)} GPA${t.credit_units ? ` (${t.credit_units}u)` : ''}`
                                    : `${t.term_name}: ${t.subjects_count > 0 ? `${Number(t.average_score).toFixed(1)}%` : '—'}`
                                )
                                .join(' · ')}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold tabular-nums text-emerald-700">
                          {isGpaMode && (src as any).cgpa !== null && (src as any).cgpa !== undefined ? (
                            <>
                              <span>{Number((src as any).cgpa).toFixed(2)} GPA</span>
                              <span className="block text-[10px] font-normal text-slate-500">
                                {Number(src.average_score || 0).toFixed(1)}%
                                {(src as any).total_credit_units ? ` · ${(src as any).total_credit_units}u` : ''}
                              </span>
                            </>
                          ) : (
                            `${Number(src.average_score || 0).toFixed(1)}%`
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                          {src.class_position ? `${src.class_position} / ${src.class_size || '—'}` : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-800">
                            <Award className="w-3 h-3 text-emerald-600" />
                            <span>{src.promotion_status || 'PENDING'}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <WorkflowStatusBadge status={src.status} />
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleViewPrintSessionReportCard(src)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Printer className="w-3 h-3" />
                              <span>View / Print</span>
                            </button>
                            {!readOnly && src.status !== 'PUBLISHED' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSessionRemarksModalRc(src);
                                    setSessionRemarksForm({
                                      promotion_status: src.promotion_status || 'PROMOTED',
                                      teacher_remark: src.teacher_remark || '',
                                      principal_remark: src.principal_remark || '',
                                      status: (src.status as any) || 'DRAFT',
                                    });
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-[11px] font-semibold cursor-pointer"
                                >
                                  Remarks / Promotion
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePublishSingleSessionRc(src)}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer"
                                >
                                  Publish
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUB-TAB 5: ACADEMIC & PORTAL POLICY SETTINGS */}
      {/* ===================================================================== */}
      {subTab === 'settings' && !readOnly && settings && (
        <form onSubmit={handleSaveSettings} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6 text-xs">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Academic Assessment &amp; Portal Visibility Policy</h3>
            <p className="text-slate-500 mt-0.5">
              Configure CA/Exam weights, missing score handling, ranking display, and fee visibility for Teacher &amp; Student portals.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Default CA Max Score</label>
              <input
                type="number"
                min={0}
                max={100}
                value={settings.ca_max_score}
                onChange={(e) => setSettings({ ...settings, ca_max_score: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Default Exam Max Score</label>
              <input
                type="number"
                min={0}
                max={100}
                value={settings.exam_max_score}
                onChange={(e) => setSettings({ ...settings, exam_max_score: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Missing Score Policy</label>
              <select
                value={settings.missing_score_policy}
                onChange={(e) =>
                  setSettings({ ...settings, missing_score_policy: e.target.value as 'EXCLUDE' | 'ZERO' })
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="EXCLUDE">Exclude Unassessed Subjects</option>
                <option value="ZERO">Count Missing as Zero</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Min Credit Units per {instLabels.cycle} (Guardrail)
              </label>
              <input
                type="number"
                min={0}
                max={60}
                value={settings.min_credit_units_per_cycle ?? 12}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    min_credit_units_per_cycle: Math.max(0, Math.min(60, Number(e.target.value || 0))),
                  })
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Advisory minimum credit load during {instLabels.subject.toLowerCase()} registration.
              </p>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Max Credit Units per {instLabels.cycle} (Guardrail)
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={settings.max_credit_units_per_cycle ?? 24}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    max_credit_units_per_cycle: Math.max(1, Math.min(60, Number(e.target.value || 24))),
                  })
                }
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Warns registrars when a learner exceeds standard {instLabels.cycle.toLowerCase()} unit limits (e.g. 24 units).
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={settings.show_class_position}
                onChange={(e) => setSettings({ ...settings, show_class_position: e.target.checked })}
                className="rounded border-slate-300 text-emerald-600"
              />
              <div>
                <p className="font-semibold text-slate-900">Display Class Position on Report Cards</p>
                <p className="text-[11px] text-slate-500">Shows 1st / 2nd / 3rd cohort rank on printed &amp; portal cards.</p>
              </div>
            </label>

            <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={settings.require_review_before_approve}
                onChange={(e) => setSettings({ ...settings, require_review_before_approve: e.target.checked })}
                className="rounded border-slate-300 text-emerald-600"
              />
              <div>
                <p className="font-semibold text-slate-900">Enforce Review Before Approval</p>
                <p className="text-[11px] text-slate-500">Requires exams to pass REVIEW before APPROVED &amp; PUBLISHED.</p>
              </div>
            </label>

            <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={settings.students_can_view_fees}
                onChange={(e) => setSettings({ ...settings, students_can_view_fees: e.target.checked })}
                className="rounded border-slate-300 text-emerald-600"
              />
              <div>
                <p className="font-semibold text-slate-900">Allow Students to View Fee Invoices</p>
                <p className="text-[11px] text-slate-500">Exposes read-only invoice &amp; receipt tab inside Student Portal.</p>
              </div>
            </label>

            <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={settings.teachers_can_view_fees}
                onChange={(e) => setSettings({ ...settings, teachers_can_view_fees: e.target.checked })}
                className="rounded border-slate-300 text-emerald-600"
              />
              <div>
                <p className="font-semibold text-slate-900">Allow Teachers Read-Only Fee Overview</p>
                <p className="text-[11px] text-slate-500">Permits Teacher accounts to view class fee status (read-only).</p>
              </div>
            </label>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end">
            <button
              type="submit"
              disabled={settingsSaving}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold cursor-pointer disabled:opacity-60"
            >
              {settingsSaving ? 'Saving Policy...' : 'Save Academic Policy'}
            </button>
          </div>
        </form>
      )}

      {/* SUBJECT / COURSE MODAL */}
      {subjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">
                {editingSubject ? `Edit ${instLabels.subject}` : `Add ${instLabels.subject}`}
              </h3>
              <button type="button" onClick={() => setSubjectModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveSubject} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{instLabels.subject} Title *</label>
                <input
                  type="text"
                  required
                  value={subjectForm.name}
                  onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })}
                  placeholder={isTertiary ? 'e.g. Introduction to Computer Science' : 'e.g. Mathematics'}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{instLabels.subject} Code</label>
                  <input
                    type="text"
                    value={subjectForm.code}
                    onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })}
                    placeholder={isTertiary ? 'e.g. CSC 101' : 'e.g. MTH101'}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Credit Units (0–12) *</label>
                  <input
                    type="number"
                    min={0}
                    max={12}
                    step={1}
                    value={subjectForm.credit_units}
                    onChange={(e) => setSubjectForm({ ...subjectForm, credit_units: e.target.value })}
                    placeholder="e.g. 1, 2, 3, 4"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold tabular-nums"
                  />
                  <div className="flex items-center gap-1 mt-1.5">
                    {[1, 2, 3, 4, 6].map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setSubjectForm({ ...subjectForm, credit_units: String(u) })}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums cursor-pointer ${
                          subjectForm.credit_units === String(u)
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {u}u
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isTertiary ? 'Department / Programme' : 'Department'}
                  </label>
                  <input
                    type="text"
                    list="school-departments-datalist"
                    value={subjectForm.department}
                    onChange={(e) => setSubjectForm({ ...subjectForm, department: e.target.value })}
                    placeholder={isTertiary ? 'e.g. Family Healthcare, CHEW (blank = General)' : 'Sciences, Arts...'}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isTertiary ? 'Course Category' : 'Subject Type'}
                  </label>
                  <select
                    value={subjectForm.course_type}
                    onChange={(e) =>
                      setSubjectForm({
                        ...subjectForm,
                        course_type: e.target.value as 'CORE' | 'ELECTIVE' | 'GENERAL',
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="CORE">Core / Compulsory</option>
                    <option value="ELECTIVE">Elective / Optional</option>
                    <option value="GENERAL">General Studies (GST/GNS)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Target {instLabels.classLabel} (Optional)
                  </label>
                  <select
                    value={subjectForm.class_id}
                    onChange={(e) => setSubjectForm({ ...subjectForm, class_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">All {instLabels.classPlural}</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {instLabels.cycle} Offering
                  </label>
                  <select
                    value={subjectForm.semester_tag}
                    onChange={(e) =>
                      setSubjectForm({ ...subjectForm, semester_tag: e.target.value as CanonicalSemesterTag })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    {getSemesterTagOptions(instLabels.cycle, isTertiary, instProfile.cycleLabels).map((opt) => (
                      <option key={opt.value || 'ALL'} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSubjectModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={subjectSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold"
                >
                  {subjectSaving ? 'Saving...' : `Save ${instLabels.subject}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE EXAMINATION MODAL */}
      {examModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Create Examination Assessment</h3>
              <button type="button" onClick={() => setExamModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateExam} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Examination Title *</label>
                <input
                  type="text"
                  required
                  value={examForm.title}
                  onChange={(e) => setExamForm({ ...examForm, title: e.target.value })}
                  placeholder="e.g. First Term Terminal Examination"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Academic Session</label>
                  <select
                    value={examForm.academic_session_id}
                    onChange={(e) => setExamForm({ ...examForm, academic_session_id: e.target.value, term_id: '' })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Session...</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Term</label>
                  <select
                    value={examForm.term_id}
                    onChange={(e) => setExamForm({ ...examForm, term_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Term...</option>
                    {(examFormSessionObj?.terms || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{instLabels.classLabel} Scope</label>
                  <select
                    value={examForm.class_id}
                    onChange={(e) => setExamForm({ ...examForm, class_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">All {instLabels.classPlural}</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isTertiary ? 'Department / Programme (Optional)' : 'Department / Arm (Optional)'}
                  </label>
                  <input
                    type="text"
                    list="school-departments-datalist"
                    value={examForm.department}
                    onChange={(e) => setExamForm({ ...examForm, department: e.target.value })}
                    placeholder="All Departments (or e.g. Family Healthcare)"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">CA Max</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={examForm.ca_max_score}
                    onChange={(e) => setExamForm({ ...examForm, ca_max_score: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Exam Max</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={examForm.exam_max_score}
                    onChange={(e) => setExamForm({ ...examForm, exam_max_score: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                  />
                </div>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setExamModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={examSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold"
                >
                  {examSaving ? 'Creating...' : 'Create Examination'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUDITED SCORE CORRECTION MODAL */}
      {correctingScore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Audited Published Score Correction</h3>
              <button type="button" onClick={() => setCorrectingScore(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCorrectScoreSubmit} className="p-5 space-y-3 text-xs">
              <p className="text-slate-600">
                Correcting published result for <strong>{correctingScore.student_name}</strong> ({correctingScore.subject_name}). This writes an immutable entry in the Score Correction Audit Log.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">New CA Score</label>
                  <input
                    type="number"
                    min={0}
                    max={selectedExam?.ca_max_score ?? 40}
                    step="0.5"
                    value={correctionForm.ca_score}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, ca_score: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">New Exam Score</label>
                  <input
                    type="number"
                    min={0}
                    max={selectedExam?.exam_max_score ?? 60}
                    step="0.5"
                    value={correctionForm.exam_score}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, exam_score: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Mandatory Audit Reason * (min 5 chars)</label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={correctionForm.reason}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
                  placeholder="e.g. Script remarking verified by Exam Committee"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCorrectingScore(null)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={correctionSaving}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold"
                >
                  {correctionSaving ? 'Applying...' : 'Apply Audited Correction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REPORT CARD REMARKS & STATUS MODAL */}
      {remarksModalRc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Report Card Remarks · {remarksModalRc.student_name}</h3>
              <button type="button" onClick={() => setRemarksModalRc(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveRemarks} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Workflow Status</label>
                <select
                  value={remarksForm.status}
                  onChange={(e) => setRemarksForm({ ...remarksForm, status: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="DRAFT">Draft</option>
                  <option value="REVIEW">In Review</option>
                  <option value="APPROVED">Approved (Ready to Publish)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Class Teacher Remark</label>
                <textarea
                  rows={2}
                  value={remarksForm.teacher_remark}
                  onChange={(e) => setRemarksForm({ ...remarksForm, teacher_remark: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Principal Remark</label>
                <textarea
                  rows={2}
                  value={remarksForm.principal_remark}
                  onChange={(e) => setRemarksForm({ ...remarksForm, principal_remark: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRemarksModalRc(null)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={remarksSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold"
                >
                  {remarksSaving ? 'Saving...' : 'Save Remarks'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SESSION CUMULATIVE REPORT CARD REMARKS & PROMOTION MODAL */}
      {sessionRemarksModalRc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">
                Annual Cumulative Remarks &amp; Promotion · {sessionRemarksModalRc.student_name}
              </h3>
              <button
                type="button"
                onClick={() => setSessionRemarksModalRc(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveSessionRemarks} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Promotion Decision</label>
                  <select
                    value={sessionRemarksForm.promotion_status}
                    onChange={(e) =>
                      setSessionRemarksForm({ ...sessionRemarksForm, promotion_status: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="PROMOTED">Promoted to Next Class</option>
                    <option value="PROBATION">Promoted on Trial / Probation</option>
                    <option value="RETAINED">Retained in Current Class</option>
                    <option value="GRADUATED">Graduated</option>
                    <option value="PENDING">Pending Decision</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Workflow Status</label>
                  <select
                    value={sessionRemarksForm.status}
                    onChange={(e) =>
                      setSessionRemarksForm({ ...sessionRemarksForm, status: e.target.value as any })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="REVIEW">In Review</option>
                    <option value="APPROVED">Approved (Ready to Publish)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Annual Class Teacher Remark</label>
                <textarea
                  rows={2}
                  value={sessionRemarksForm.teacher_remark}
                  onChange={(e) =>
                    setSessionRemarksForm({ ...sessionRemarksForm, teacher_remark: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Principal Annual Remark</label>
                <textarea
                  rows={2}
                  value={sessionRemarksForm.principal_remark}
                  onChange={(e) =>
                    setSessionRemarksForm({ ...sessionRemarksForm, principal_remark: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSessionRemarksModalRc(null)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sessionRemarksSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold"
                >
                  {sessionRemarksSaving ? 'Saving...' : 'Save Annual Remarks'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <PrintableReportCardModal
        reportCard={printingRc}
        isOpen={Boolean(printingRc)}
        onClose={() => setPrintingRc(null)}
      />

      {bulkCoursesOpen && (
        <BulkCoursesModal
          classes={classes}
          availableDepartments={availableDepartmentNames}
          isTertiary={isTertiary}
          subjectLabel={instLabels.subject}
          subjectPlural={instLabels.subjectPlural}
          classLabel={instLabels.classLabel}
          cycleLabel={instLabels.cycle}
          cycleLabels={instProfile.cycleLabels}
          initialClassId={bulkCoursesPrefill.classId || ''}
          initialDepartment={bulkCoursesPrefill.department || ''}
          initialSemesterTag={bulkCoursesPrefill.semesterTag}
          onClose={() => setBulkCoursesOpen(false)}
          onSaved={async (msg) => {
            setBulkCoursesOpen(false);
            showMsg('ok', msg);
            await loadBootstrap();
          }}
        />
      )}

      {historicalBacklogOpen && (
        <HistoricalBacklogImportModal
          students={rosterStudents}
          isTertiary={isTertiary}
          subjectLabel={instLabels.subject}
          subjectPlural={instLabels.subjectPlural}
          classLabel={instLabels.classLabel}
          cycleLabel={instLabels.cycle}
          learnerLabel={isTertiary ? 'Student' : 'Learner'}
          onClose={() => setHistoricalBacklogOpen(false)}
          onImported={async (msg) => {
            setHistoricalBacklogOpen(false);
            showMsg('ok', msg);
            await loadBootstrap();
          }}
        />
      )}

      {broadsheetExamId && (
        <ExamBroadsheetModal
          examinationId={broadsheetExamId}
          onClose={() => setBroadsheetExamId(null)}
        />
      )}

      <datalist id="school-departments-datalist">
        {availableDepartmentNames.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
};
