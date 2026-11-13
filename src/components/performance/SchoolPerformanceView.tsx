import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  AcademicSessionItem,
  AcademicSettings,
  ClassItem,
  ExaminationItem,
  PerformanceOverviewData,
  ReportCardItem,
  ScoreCorrectionLogItem,
  StudentScoreItem,
  SubjectItem,
} from '../../types/index.js';
import { WorkflowStatusBadge } from '../common/StatusBadge.js';
import { PrintableReportCardModal } from './PrintableReportCardModal.js';

interface SchoolPerformanceViewProps {
  readOnly?: boolean;
}

type PerfSubTab = 'analytics' | 'subjects' | 'exams' | 'reports' | 'settings';

export const SchoolPerformanceView: React.FC<SchoolPerformanceViewProps> = ({ readOnly = false }) => {
  const { activeSchool } = useAuth();
  const [subTab, setSubTab] = useState<PerfSubTab>('analytics');

  // Shared metadata
  const [sessions, setSessions] = useState<AcademicSessionItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
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

  // Subjects modal
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectItem | null>(null);
  const [subjectForm, setSubjectForm] = useState({
    name: '',
    code: '',
    department: '',
    class_id: '',
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
    ca_max_score: 40,
    exam_max_score: 60,
  });
  const [examSaving, setExamSaving] = useState(false);

  const [selectedExam, setSelectedExam] = useState<ExaminationItem | null>(null);
  const [scoreSubjectId, setScoreSubjectId] = useState('');
  const [scoreRoster, setScoreRoster] = useState<
    Array<{ id: string; admission_number: string; full_name: string; class_id?: string | null; class_name?: string | null }>
  >([]);
  const [examScores, setExamScores] = useState<StudentScoreItem[]>([]);
  const [examCorrections, setExamCorrections] = useState<ScoreCorrectionLogItem[]>([]);
  const [scoreDrafts, setScoreDrafts] = useState<
    Record<string, { ca_score: string; exam_score: string; subject_remark: string }>
  >({});
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresSaving, setScoresSaving] = useState(false);

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
  const [reportCards, setReportCards] = useState<ReportCardItem[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [rcFilters, setRcFilters] = useState({
    academic_session_id: '',
    term_id: '',
    class_id: '',
    status: '',
  });
  const [generatingRc, setGeneratingRc] = useState(false);
  const [printingRc, setPrintingRc] = useState<ReportCardItem | null>(null);
  const [remarksModalRc, setRemarksModalRc] = useState<ReportCardItem | null>(null);
  const [remarksForm, setRemarksForm] = useState({
    teacher_remark: '',
    principal_remark: '',
    status: 'DRAFT' as 'DRAFT' | 'REVIEW' | 'APPROVED',
  });
  const [remarksSaving, setRemarksSaving] = useState(false);

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
      const [sessRes, clsRes, subRes, setRes, exRes] = await Promise.all([
        api.getSchoolAcademicSessions().catch(() => ({ sessions: [] })),
        api.getSchoolClasses().catch(() => ({ classes: [] })),
        api.getSubjects().catch(() => ({ subjects: [] })),
        api.getAcademicSettings().catch(() => ({ settings: null })),
        api.getExaminations().catch(() => ({ examinations: [] })),
      ]);
      const loadedSessions = sessRes.sessions || [];
      setSessions(loadedSessions);
      setClasses(clsRes.classes || []);
      setSubjects(subRes.subjects || []);
      if (setRes.settings) setSettings(setRes.settings);
      setExams(exRes.examinations || []);

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
      }
      if (subRes.subjects?.length) {
        setScoreSubjectId((prev) => prev || subRes.subjects[0].id);
      }
    } catch {
      // handled per section
    }
  };

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

  const loadExamScoreSheet = async (exam: ExaminationItem, subjectId: string) => {
    setScoresLoading(true);
    try {
      const res = await api.getExaminationScores(exam.id, {
        subject_id: subjectId || undefined,
        class_id: exam.class_id || undefined,
      });
      setSelectedExam(res.examination);
      setScoreRoster(res.roster || []);
      setExamScores(res.scores || []);
      setExamCorrections(res.corrections || []);

      const nextDrafts: Record<string, { ca_score: string; exam_score: string; subject_remark: string }> = {};
      for (const st of res.roster || []) {
        const existing = (res.scores || []).find((sc) => sc.student_id === st.id && (!subjectId || sc.subject_id === subjectId));
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

  useEffect(() => {
    loadBootstrap();
    loadOverview();
  }, [activeSchool?.id]);

  useEffect(() => {
    if (subTab === 'exams') loadExams();
    if (subTab === 'reports') loadReportCards();
  }, [subTab, examFilterStatus]);

  const selectedSessionObj = sessions.find((s) => s.id === filters.academic_session_id);
  const rcSessionObj = sessions.find((s) => s.id === rcFilters.academic_session_id);
  const examFormSessionObj = sessions.find((s) => s.id === examForm.academic_session_id);

  // Handlers
  const handleSaveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubjectSaving(true);
    try {
      const payload = {
        ...subjectForm,
        status: subjectForm.status as 'ACTIVE' | 'INACTIVE',
      };
      if (editingSubject) {
        await api.updateSubject(editingSubject.id, payload);
        showMsg('ok', 'Subject updated.');
      } else {
        await api.createSubject(payload);
        showMsg('ok', 'Subject created.');
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

  const handleDeleteSubject = async (sub: SubjectItem) => {
    try {
      await api.deleteSubject(sub.id);
      const res = await api.getSubjects();
      setSubjects(res.subjects || []);
      showMsg('ok', `Removed subject ${sub.name}.`);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to delete subject');
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setExamSaving(true);
    try {
      const res = await api.createExamination(examForm);
      setExamModalOpen(false);
      setExamForm((prev) => ({ ...prev, title: '' }));
      await loadExams();
      if (res.examination) {
        setSelectedExam(res.examination);
        const subj = scoreSubjectId || subjects[0]?.id || '';
        if (subj) loadExamScoreSheet(res.examination, subj);
      }
      showMsg('ok', 'Examination created in DRAFT state.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to create examination');
    } finally {
      setExamSaving(false);
    }
  };

  const handleSaveScores = async () => {
    if (!selectedExam || !scoreSubjectId) return;
    setScoresSaving(true);
    try {
      const entries = scoreRoster.map((st) => {
        const draft = scoreDrafts[st.id] || { ca_score: '', exam_score: '', subject_remark: '' };
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
      showMsg('ok', 'Scores saved and graded automatically.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to save scores');
    } finally {
      setScoresSaving(false);
    }
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
              <span>Academic Performance &amp; Digital Report Cards</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {readOnly
                ? 'Read-only analytics, examination standings, and report card archive.'
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
              { key: 'subjects', label: 'Subjects', icon: BookOpen },
              { key: 'exams', label: 'Examinations & Scores', icon: ClipboardCheck },
              { key: 'reports', label: 'Report Cards', icon: FileText },
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
              <h3 className="text-sm font-bold text-slate-900">Curriculum Subjects ({subjects.length})</h3>
              <p className="text-xs text-slate-500">Subjects assessed in examinations and report cards.</p>
            </div>
            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  setEditingSubject(null);
                  setSubjectForm({ name: '', code: '', department: '', class_id: '', status: 'ACTIVE' });
                  setSubjectModalOpen(true);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer self-start"
              >
                <Plus className="w-4 h-4" />
                <span>Add Subject</span>
              </button>
            )}
          </div>

          {subjects.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No subjects configured yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-3">Code</th>
                    <th className="py-2.5 px-3">Subject Name</th>
                    <th className="py-2.5 px-3">Department</th>
                    <th className="py-2.5 px-3">Target Class</th>
                    <th className="py-2.5 px-3">Status</th>
                    {!readOnly && <th className="py-2.5 px-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subjects.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 font-mono text-slate-700 font-semibold">{sub.code}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{sub.name}</td>
                      <td className="py-2.5 px-3 text-slate-600">{sub.department || 'General'}</td>
                      <td className="py-2.5 px-3 text-slate-600">{sub.class_name || 'All Classes'}</td>
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
                                  status: sub.status,
                                });
                                setSubjectModalOpen(true);
                              }}
                              className="p-1.5 text-slate-500 hover:text-blue-700 rounded-lg hover:bg-blue-50"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubject(sub)}
                              className="p-1.5 text-slate-500 hover:text-rose-700 rounded-lg hover:bg-rose-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
              <div className="flex items-center gap-2">
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
                  <button
                    type="button"
                    onClick={() => setExamModalOpen(true)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    <span>New Examination</span>
                  </button>
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
                      <th className="py-2.5 px-3">Session / Term</th>
                      <th className="py-2.5 px-3">Class</th>
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
                        <td className="py-2.5 px-3 text-slate-600">{ex.class_name || 'All Classes'}</td>
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
                                loadExamScoreSheet(ex, subj);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              {readOnly ? 'View Scores' : 'Score Sheet'}
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
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-900">
                      Score Sheet · {selectedExam.title}
                    </h4>
                    <WorkflowStatusBadge status={selectedExam.status} />
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
                    className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium"
                  >
                    {subjects.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name} ({sub.code})
                      </option>
                    ))}
                  </select>

                  {!readOnly && selectedExam.status !== 'PUBLISHED' && (
                    <button
                      type="button"
                      disabled={scoresSaving || !scoreSubjectId}
                      onClick={handleSaveScores}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{scoresSaving ? 'Saving...' : 'Save Scores'}</span>
                    </button>
                  )}
                </div>
              </div>

              {scoresLoading ? (
                <p className="py-8 text-center text-xs text-slate-400">Loading class roster and scores...</p>
              ) : scoreRoster.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">No active students found for this examination scope.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                        <th className="py-2.5 px-3">Student</th>
                        <th className="py-2.5 px-3">Class</th>
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

                        return (
                          <tr key={st.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 font-medium text-slate-900">
                              {st.full_name}
                              <span className="block text-[10px] font-mono text-slate-400">{st.admission_number}</span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">{st.class_name || '—'}</td>
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
                              {existing?.total_score ?? '—'}
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
      {/* SUB-TAB 4: REPORT CARDS */}
      {/* ===================================================================== */}
      {subTab === 'reports' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Digital Report Cards</h3>
              <p className="text-xs text-slate-500">
                Compile term scores, attendance, conduct, and official remarks into verifiable digital report cards.
              </p>
            </div>
            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={generatingRc}
                  onClick={handleGenerateReportCards}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {generatingRc ? 'Generating...' : 'Generate / Recalculate Reports'}
                </button>
                <button
                  type="button"
                  onClick={handlePublishClassReportCards}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Publish Filtered Reports</span>
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <select
              value={rcFilters.academic_session_id}
              onChange={(e) => {
                const next = { ...rcFilters, academic_session_id: e.target.value, term_id: '' };
                setRcFilters(next);
                loadReportCards(next);
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

            <select
              value={rcFilters.class_id}
              onChange={(e) => {
                const next = { ...rcFilters, class_id: e.target.value };
                setRcFilters(next);
                loadReportCards(next);
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
                loadReportCards(next);
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

          {reportsLoading ? (
            <p className="py-10 text-center text-xs text-slate-400">Loading digital report cards...</p>
          ) : reportCards.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">
              No report cards match these filters. Use &ldquo;Generate / Recalculate Reports&rdquo; after entering scores.
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
          )}
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

      {/* SUBJECT MODAL */}
      {subjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">{editingSubject ? 'Edit Subject' : 'Add Subject'}</h3>
              <button type="button" onClick={() => setSubjectModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveSubject} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Subject Name *</label>
                <input
                  type="text"
                  required
                  value={subjectForm.name}
                  onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })}
                  placeholder="e.g. Mathematics"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Subject Code</label>
                  <input
                    type="text"
                    value={subjectForm.code}
                    onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })}
                    placeholder="e.g. MTH101"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    value={subjectForm.department}
                    onChange={(e) => setSubjectForm({ ...subjectForm, department: e.target.value })}
                    placeholder="Sciences, Arts..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Target Class (Optional)</label>
                <select
                  value={subjectForm.class_id}
                  onChange={(e) => setSubjectForm({ ...subjectForm, class_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="">All Classes</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
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
                  {subjectSaving ? 'Saving...' : 'Save Subject'}
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
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Class Scope</label>
                  <select
                    value={examForm.class_id}
                    onChange={(e) => setExamForm({ ...examForm, class_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">All Classes</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
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

      <PrintableReportCardModal
        reportCard={printingRc}
        isOpen={Boolean(printingRc)}
        onClose={() => setPrintingRc(null)}
      />
    </div>
  );
};
