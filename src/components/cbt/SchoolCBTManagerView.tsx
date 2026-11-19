import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Edit2,
  Eye,
  FileSpreadsheet,
  KeyRound,
  Layers,
  MonitorCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  CbtExamItem,
  CbtExamMode,
  CbtExamResultsResponse,
  CbtQuestionItem,
  CbtQuestionType,
  CbtReviewItem,
  ClassItem,
  ExaminationItem,
  SubjectItem,
} from '../../types/index.js';
import { compressImageFileToDataUrl } from '../../utils/imageUpload.js';

interface SchoolCBTManagerViewProps {
  isAdminOverride?: boolean;
}

const EXAM_MODE_LABELS: Record<CbtExamMode, string> = {
  TERM_EXAM: 'Term Examination',
  CA_TEST: 'Continuous Assessment (CA)',
  MOCK: 'Mock Exam (WAEC / JAMB)',
  PRACTICE: 'Practice Drill',
  ENTRANCE: 'Entrance CBT',
};

const SAMPLE_BULK_QUESTIONS = `1. Which city is the Federal Capital Territory of Nigeria?
A. Lagos
B. Abuja
C. Port Harcourt
D. Kano
Answer: B
Explanation: Abuja became Nigeria's Federal Capital Territory in December 1991.
Marks: 2

2. Solve for x: 3x + 6 = 21
A. 3
B. 4
C. 5
D. 7
Answer: C
Explanation: Subtract 6 from both sides (3x = 15), then divide by 3 (x = 5).
Marks: 2

3. Photosynthesis takes place primarily in the chloroplasts of plant leaves.
Answer: TRUE
Marks: 1`;

function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

export const SchoolCBTManagerView: React.FC<SchoolCBTManagerViewProps> = ({ isAdminOverride }) => {
  const { activeRole, isSuperAdmin } = useAuth();
  const isAdmin =
    isAdminOverride ??
    Boolean(isSuperAdmin || ['SCHOOL_OWNER', 'SCHOOL_ADMIN'].includes(activeRole?.role_name || ''));

  const [exams, setExams] = useState<CbtExamItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [reportExams, setReportExams] = useState<ExaminationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const [filterClassId, setFilterClassId] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Exam Studio
  const [selectedExam, setSelectedExam] = useState<CbtExamItem | null>(null);
  const [studioTab, setStudioTab] = useState<'questions' | 'results'>('questions');
  const [questions, setQuestions] = useState<CbtQuestionItem[]>([]);
  const [resultsData, setResultsData] = useState<CbtExamResultsResponse | null>(null);
  const [studioLoading, setStudioLoading] = useState(false);

  // Create / Edit Exam Modal
  const [examModalOpen, setExamModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<CbtExamItem | null>(null);
  const [examForm, setExamForm] = useState({
    title: '',
    subject_id: '',
    subject_name: '',
    class_id: 'ALL',
    exam_mode: 'TERM_EXAM' as CbtExamMode,
    duration_minutes: 30,
    pass_mark_percent: 50,
    max_attempts: 1,
    access_code: '',
    starts_at: '',
    ends_at: '',
    description: '',
    instructions: 'Read every question carefully before selecting your answer. Your progress is auto-saved.',
    shuffle_questions: true,
    show_result_immediately: true,
    show_correct_answers: true,
  });

  // Add / Edit Question Form
  const [editingQuestion, setEditingQuestion] = useState<CbtQuestionItem | null>(null);
  const [qForm, setQForm] = useState({
    question_type: 'MCQ' as CbtQuestionType,
    question_text: '',
    question_image_url: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    option_e: '',
    correct_answer: 'A',
    explanation: '',
    marks: 1,
  });

  // Bulk Import Modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkRawText, setBulkRawText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);

  // Sync Scores Modal
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncForm, setSyncForm] = useState({
    examination_id: '',
    subject_id: '',
    target: 'EXAM' as 'CA' | 'EXAM',
  });

  // Attempt Review Modal
  const [reviewModal, setReviewModal] = useState<{
    attempt: any;
    exam: any;
    review: CbtReviewItem[] | null;
  } | null>(null);

  const loadDirectory = async () => {
    setLoading(true);
    try {
      const [examsRes, clsRes, subRes, perfExamsRes] = await Promise.all([
        api.getCbtExams(),
        api.getSchoolClasses().catch(() => ({ classes: [] })),
        api.getSubjects().catch(() => ({ subjects: [] })),
        api.getExaminations().catch(() => ({ examinations: [] })),
      ]);
      setExams(examsRes.exams || []);
      setClasses(clsRes.classes || []);
      setSubjects(subRes.subjects || []);
      setReportExams(perfExamsRes.examinations || []);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to load CBT examinations.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory();
  }, []);

  const loadExamStudio = async (exam: CbtExamItem, tab: 'questions' | 'results' = studioTab) => {
    setSelectedExam(exam);
    setStudioTab(tab);
    setStudioLoading(true);
    try {
      const [qRes, rRes] = await Promise.all([
        api.getCbtQuestions(exam.id),
        api.getCbtExamResults(exam.id),
      ]);
      setSelectedExam(qRes.exam || exam);
      setQuestions(qRes.questions || []);
      setResultsData(rRes);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to load CBT exam studio.' });
    } finally {
      setStudioLoading(false);
    }
  };

  const filteredExams = useMemo(() => {
    return exams.filter((e) => {
      if (filterClassId !== 'ALL') {
        if (filterClassId === 'SCHOOL_WIDE') {
          if (e.class_id) return false;
        } else if (e.class_id !== filterClassId) {
          return false;
        }
      }
      if (filterStatus !== 'ALL' && e.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${e.title} ${e.subject_name} ${e.class_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [exams, filterClassId, filterStatus, searchQuery]);

  const openCreateExamModal = () => {
    setEditingExam(null);
    setExamForm({
      title: '',
      subject_id: '',
      subject_name: '',
      class_id: 'ALL',
      exam_mode: 'TERM_EXAM',
      duration_minutes: 30,
      pass_mark_percent: 50,
      max_attempts: 1,
      access_code: '',
      starts_at: '',
      ends_at: '',
      description: '',
      instructions: 'Read every question carefully before selecting your answer. Your progress is auto-saved.',
      shuffle_questions: true,
      show_result_immediately: true,
      show_correct_answers: true,
    });
    setExamModalOpen(true);
  };

  const openEditExamModal = (exam: CbtExamItem) => {
    setEditingExam(exam);
    setExamForm({
      title: exam.title,
      subject_id: exam.subject_id || '',
      subject_name: exam.subject_name,
      class_id: exam.class_id || 'ALL',
      exam_mode: exam.exam_mode || 'TERM_EXAM',
      duration_minutes: exam.duration_minutes || 30,
      pass_mark_percent: exam.pass_mark_percent ?? 50,
      max_attempts: exam.max_attempts || 1,
      access_code: exam.access_code || '',
      starts_at: exam.starts_at ? exam.starts_at.slice(0, 16) : '',
      ends_at: exam.ends_at ? exam.ends_at.slice(0, 16) : '',
      description: exam.description || '',
      instructions: exam.instructions || '',
      shuffle_questions: Number(exam.shuffle_questions ?? 1) === 1,
      show_result_immediately: Number(exam.show_result_immediately ?? 1) === 1,
      show_correct_answers: Number(exam.show_correct_answers ?? 1) === 1,
    });
    setExamModalOpen(true);
  };

  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const payload: Partial<CbtExamItem> = {
        title: examForm.title.trim(),
        subject_id: examForm.subject_id || null,
        subject_name: examForm.subject_name.trim(),
        class_id: examForm.class_id === 'ALL' ? null : examForm.class_id,
        exam_mode: examForm.exam_mode,
        duration_minutes: Number(examForm.duration_minutes) || 30,
        pass_mark_percent: Number(examForm.pass_mark_percent) || 50,
        max_attempts: Number(examForm.max_attempts) || 1,
        access_code: examForm.access_code.trim() || null,
        starts_at: examForm.starts_at ? new Date(examForm.starts_at).toISOString() : null,
        ends_at: examForm.ends_at ? new Date(examForm.ends_at).toISOString() : null,
        description: examForm.description.trim() || null,
        instructions: examForm.instructions.trim() || null,
        shuffle_questions: examForm.shuffle_questions ? 1 : 0,
        show_result_immediately: examForm.show_result_immediately ? 1 : 0,
        show_correct_answers: examForm.show_correct_answers ? 1 : 0,
      };

      if (editingExam) {
        const res = await api.updateCbtExam(editingExam.id, payload);
        setFeedback({ type: 'ok', text: `Updated "${res.exam.title}".` });
        setExamModalOpen(false);
        await loadDirectory();
        if (selectedExam?.id === editingExam.id) {
          setSelectedExam(res.exam);
        }
      } else {
        const res = await api.createCbtExam(payload);
        setFeedback({ type: 'ok', text: `Created CBT Exam "${res.exam.title}". Add questions below to publish it.` });
        setExamModalOpen(false);
        await loadDirectory();
        await loadExamStudio(res.exam, 'questions');
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to save CBT exam.' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleExamStatus = async (exam: CbtExamItem, nextStatus: 'DRAFT' | 'PUBLISHED' | 'CLOSED') => {
    setFeedback(null);
    try {
      const res = await api.updateCbtExam(exam.id, { status: nextStatus });
      setFeedback({
        type: 'ok',
        text:
          nextStatus === 'PUBLISHED'
            ? `"${exam.title}" is now LIVE for eligible students in ${exam.class_name || 'All Classes'}.`
            : nextStatus === 'CLOSED'
              ? `"${exam.title}" has been closed to new attempts.`
              : `"${exam.title}" moved back to Draft.`,
      });
      await loadDirectory();
      if (selectedExam?.id === exam.id) {
        setSelectedExam(res.exam);
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to update CBT exam status.' });
    }
  };

  const handleDeleteExam = async (exam: CbtExamItem) => {
    setFeedback(null);
    try {
      await api.deleteCbtExam(exam.id);
      setExams((prev) => prev.filter((item) => item.id !== exam.id));
      if (selectedExam?.id === exam.id) setSelectedExam(null);
      setFeedback({ type: 'ok', text: `Removed "${exam.title}".` });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete CBT exam.' });
    }
  };

  const resetQuestionForm = () => {
    setEditingQuestion(null);
    setQForm({
      question_type: 'MCQ',
      question_text: '',
      question_image_url: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_answer: 'A',
      explanation: '',
      marks: 1,
    });
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExam) return;
    setSaving(true);
    setFeedback(null);
    try {
      const payload: Partial<CbtQuestionItem> = {
        question_type: qForm.question_type,
        question_text: qForm.question_text.trim(),
        question_image_url: qForm.question_image_url.trim() || null,
        option_a: qForm.question_type === 'TRUE_FALSE' ? 'True' : qForm.option_a.trim() || null,
        option_b: qForm.question_type === 'TRUE_FALSE' ? 'False' : qForm.option_b.trim() || null,
        option_c: qForm.question_type === 'MCQ' ? qForm.option_c.trim() || null : null,
        option_d: qForm.question_type === 'MCQ' ? qForm.option_d.trim() || null : null,
        option_e: qForm.question_type === 'MCQ' ? qForm.option_e.trim() || null : null,
        correct_answer: qForm.correct_answer.trim(),
        explanation: qForm.explanation.trim() || null,
        marks: Math.max(0.5, Number(qForm.marks) || 1),
      };

      if (editingQuestion) {
        await api.updateCbtQuestion(selectedExam.id, editingQuestion.id, payload);
        setFeedback({ type: 'ok', text: 'Question updated.' });
      } else {
        await api.createCbtQuestion(selectedExam.id, payload);
        setFeedback({ type: 'ok', text: 'Question added to CBT bank.' });
      }
      resetQuestionForm();
      await loadExamStudio(selectedExam, 'questions');
      await loadDirectory();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Could not save question.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteQuestion = async (qid: string) => {
    if (!selectedExam) return;
    try {
      await api.deleteCbtQuestion(selectedExam.id, qid);
      setQuestions((prev) => prev.filter((q) => q.id !== qid));
      await loadDirectory();
      setFeedback({ type: 'ok', text: 'Question deleted.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete question.' });
    }
  };

  const handleDiagramUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setQForm((prev) => ({ ...prev, question_image_url: dataUrl }));
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Could not process diagram image.' });
    }
  };

  const handleBulkImport = async () => {
    if (!selectedExam || !bulkRawText.trim()) return;
    setBulkImporting(true);
    setFeedback(null);
    try {
      const res = await api.bulkImportCbtQuestions(selectedExam.id, { raw_text: bulkRawText });
      setBulkModalOpen(false);
      setBulkRawText('');
      setFeedback({
        type: 'ok',
        text: `Imported ${res.importedCount} question(s) (${res.total_marks} total marks).${res.skippedCount ? ` Skipped ${res.skippedCount} incomplete item(s).` : ''}`,
      });
      await loadExamStudio(selectedExam, 'questions');
      await loadDirectory();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Bulk question import failed.' });
    } finally {
      setBulkImporting(false);
    }
  };

  const handleExportCsv = async () => {
    if (!selectedExam) return;
    try {
      const blob = await api.exportCbtExamResultsCsv(selectedExam.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cbt_results_${selectedExam.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to export CBT CSV.' });
    }
  };

  const handleOpenSyncModal = () => {
    if (!selectedExam) return;
    const matchedSubj =
      selectedExam.subject_id ||
      subjects.find((s) => s.name.toLowerCase() === selectedExam.subject_name.toLowerCase())?.id ||
      '';
    setSyncForm({
      examination_id: selectedExam.linked_examination_id || reportExams[0]?.id || '',
      subject_id: matchedSubj,
      target: selectedExam.sync_score_target === 'CA' ? 'CA' : 'EXAM',
    });
    setSyncModalOpen(true);
  };

  const handleSyncScores = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExam) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await api.syncCbtScoresToReportCard(selectedExam.id, {
        examination_id: syncForm.examination_id,
        subject_id: syncForm.subject_id || undefined,
        target: syncForm.target,
      });
      setSyncModalOpen(false);
      setFeedback({ type: 'ok', text: res.message });
      await loadExamStudio(selectedExam, 'results');
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Could not sync CBT scores.' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetAttempt = async (attemptId: string) => {
    if (!selectedExam) return;
    setFeedback(null);
    try {
      const res = await api.resetCbtAttempt(attemptId);
      setFeedback({ type: 'ok', text: res.message });
      await loadExamStudio(selectedExam, 'results');
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to reset student attempt.' });
    }
  };

  const handleInspectAttempt = async (attemptId: string) => {
    try {
      const res = await api.getStudentCbtAttemptReview(attemptId);
      setReviewModal({ attempt: res.attempt, exam: res.exam, review: res.review });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Could not load student attempt review.' });
    }
  };

  // ============================================================================
  // RENDER: SELECTED EXAM STUDIO (QUESTION BANK + LIVE RESULTS)
  // ============================================================================
  if (selectedExam) {
    return (
      <div className="space-y-6">
        {/* Studio Header */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <button
                type="button"
                onClick={() => setSelectedExam(null)}
                className="text-xs font-bold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1.5 cursor-pointer mb-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to All CBT Exams</span>
              </button>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight break-words">{selectedExam.title}</h2>
                <span
                  className={`text-xs font-bold px-2.5 py-0.5 rounded-md ${
                    selectedExam.status === 'PUBLISHED'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : selectedExam.status === 'CLOSED'
                        ? 'bg-slate-100 text-slate-700 border border-slate-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {selectedExam.status}
                </span>
              </div>
              <p className="text-xs text-slate-600 tabular-nums">
                {selectedExam.subject_name} · Class: <strong className="text-slate-800">{selectedExam.class_name || 'All Classes'}</strong> ·{' '}
                {selectedExam.duration_minutes} mins · {questions.length} question(s) · {selectedExam.total_marks} marks · Pass: {selectedExam.pass_mark_percent}%
                {selectedExam.access_code ? ` · PIN: ${selectedExam.access_code}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openEditExamModal(selectedExam)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Exam Settings</span>
              </button>
              {selectedExam.status !== 'PUBLISHED' ? (
                <button
                  type="button"
                  onClick={() => handleToggleExamStatus(selectedExam, 'PUBLISHED')}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Publish CBT Exam</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleToggleExamStatus(selectedExam, 'CLOSED')}
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Close Exam Window</span>
                </button>
              )}
            </div>
          </div>

          {/* Studio Sub-Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStudioTab('questions')}
                className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition ${
                  studioTab === 'questions' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Question Bank ({questions.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStudioTab('results');
                  loadExamStudio(selectedExam, 'results');
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition ${
                  studioTab === 'results' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Live Results &amp; Analytics ({resultsData?.summary.completed_count ?? 0})
              </button>
            </div>

            {studioTab === 'questions' && (
              <button
                type="button"
                onClick={() => setBulkModalOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Smart Bulk Question Importer</span>
              </button>
            )}
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            <span className="flex items-center gap-2">
              {feedback.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{feedback.text}</span>
            </span>
            <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* TAB 1: QUESTION BANK */}
        {studioTab === 'questions' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Add / Edit Question Form */}
            <form
              onSubmit={handleSaveQuestion}
              className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  {editingQuestion ? `Edit Question #${editingQuestion.question_order}` : 'Add CBT Question'}
                </h3>
                {editingQuestion && (
                  <button
                    type="button"
                    onClick={resetQuestionForm}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Question Type</label>
                  <select
                    value={qForm.question_type}
                    onChange={(e) => {
                      const nextType = e.target.value as CbtQuestionType;
                      setQForm((prev) => ({
                        ...prev,
                        question_type: nextType,
                        correct_answer: nextType === 'TRUE_FALSE' ? 'TRUE' : nextType === 'MCQ' ? 'A' : '',
                      }));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white"
                  >
                    <option value="MCQ">Multiple Choice (A–E)</option>
                    <option value="TRUE_FALSE">True / False</option>
                    <option value="SHORT_ANSWER">Short Answer</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Marks</label>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    required
                    value={qForm.marks}
                    onChange={(e) => setQForm((prev) => ({ ...prev, marks: Number(e.target.value) || 1 }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl tabular-nums"
                  />
                </div>
              </div>

              <div className="text-xs">
                <label className="block font-semibold text-slate-700 mb-1">Question Prompt *</label>
                <textarea
                  rows={3}
                  required
                  value={qForm.question_text}
                  onChange={(e) => setQForm((prev) => ({ ...prev, question_text: e.target.value }))}
                  placeholder="Enter the question stem clearly..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                />
              </div>

              {/* Optional Diagram Upload */}
              <div className="text-xs space-y-1.5">
                <label className="block font-semibold text-slate-700">Optional Diagram / Image</label>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer inline-flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Image</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleDiagramUpload(e.target.files?.[0])}
                    />
                  </label>
                  {qForm.question_image_url && (
                    <button
                      type="button"
                      onClick={() => setQForm((prev) => ({ ...prev, question_image_url: '' }))}
                      className="text-rose-600 font-semibold hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {qForm.question_image_url && (
                  <img
                    src={qForm.question_image_url}
                    alt="Question diagram preview"
                    className="max-h-32 rounded-lg border border-slate-200 object-contain"
                  />
                )}
              </div>

              {qForm.question_type === 'MCQ' && (
                <div className="space-y-2.5 text-xs">
                  {(['a', 'b', 'c', 'd', 'e'] as const).map((letter) => {
                    const key = `option_${letter}` as keyof typeof qForm;
                    const required = letter === 'a' || letter === 'b';
                    return (
                      <div key={letter} className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 font-bold flex items-center justify-center shrink-0 uppercase">
                          {letter}
                        </span>
                        <input
                          type="text"
                          required={required}
                          value={String(qForm[key] || '')}
                          onChange={(e) => setQForm((prev) => ({ ...prev, [key]: e.target.value }))}
                          placeholder={required ? `Option ${letter.toUpperCase()} *` : `Option ${letter.toUpperCase()} (optional)`}
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-xl"
                        />
                      </div>
                    );
                  })}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Correct Option *</label>
                    <select
                      value={qForm.correct_answer}
                      onChange={(e) => setQForm((prev) => ({ ...prev, correct_answer: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white font-bold"
                    >
                      <option value="A">Option A</option>
                      <option value="B">Option B</option>
                      {qForm.option_c.trim() && <option value="C">Option C</option>}
                      {qForm.option_d.trim() && <option value="D">Option D</option>}
                      {qForm.option_e.trim() && <option value="E">Option E</option>}
                    </select>
                  </div>
                </div>
              )}

              {qForm.question_type === 'TRUE_FALSE' && (
                <div className="text-xs">
                  <label className="block font-semibold text-slate-700 mb-1">Correct Answer *</label>
                  <select
                    value={qForm.correct_answer}
                    onChange={(e) => setQForm((prev) => ({ ...prev, correct_answer: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white font-bold"
                  >
                    <option value="TRUE">TRUE</option>
                    <option value="FALSE">FALSE</option>
                  </select>
                </div>
              )}

              {qForm.question_type === 'SHORT_ANSWER' && (
                <div className="text-xs">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Accepted Answer(s) * <span className="font-normal text-slate-500">(separate variants with |)</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={qForm.correct_answer}
                    onChange={(e) => setQForm((prev) => ({ ...prev, correct_answer: e.target.value }))}
                    placeholder="e.g. Abuja|FCT Abuja"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>
              )}

              <div className="text-xs">
                <label className="block font-semibold text-slate-700 mb-1">Answer Explanation (Optional)</label>
                <input
                  type="text"
                  value={qForm.explanation}
                  onChange={(e) => setQForm((prev) => ({ ...prev, explanation: e.target.value }))}
                  placeholder="Shown to students during post-exam review"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Saving...' : editingQuestion ? 'Update Question' : 'Add Question to Exam'}</span>
              </button>
            </form>

            {/* Question List */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  Configured Questions ({questions.length})
                </h3>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">
                  Total Marks: {selectedExam.total_marks}
                </span>
              </div>

              {studioLoading ? (
                <p className="py-10 text-center text-xs text-slate-500">Loading questions...</p>
              ) : questions.length === 0 ? (
                <div className="py-10 text-center space-y-3 border border-dashed border-slate-200 rounded-xl p-6">
                  <p className="text-sm font-bold text-slate-800">No questions added yet</p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Use the form on the left to add questions one by one, or paste an entire WAEC/JAMB question set using the Smart Bulk Question Importer.
                  </p>
                  <button
                    type="button"
                    onClick={() => setBulkModalOpen(true)}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                  >
                    Open Smart Bulk Importer
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {questions.map((q, index) => (
                    <div key={q.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500 tabular-nums">
                            <span className="text-slate-900">Q{index + 1}</span>
                            <span>·</span>
                            <span>{q.question_type}</span>
                            <span>·</span>
                            <span>{q.marks} mark{q.marks === 1 ? '' : 's'}</span>
                          </div>
                          <p className="text-sm font-semibold text-slate-900 break-words">{q.question_text}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingQuestion(q);
                              setQForm({
                                question_type: q.question_type,
                                question_text: q.question_text,
                                question_image_url: q.question_image_url || '',
                                option_a: q.option_a || '',
                                option_b: q.option_b || '',
                                option_c: q.option_c || '',
                                option_d: q.option_d || '',
                                option_e: q.option_e || '',
                                correct_answer: q.correct_answer || '',
                                explanation: q.explanation || '',
                                marks: q.marks || 1,
                              });
                            }}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white cursor-pointer"
                            title="Edit question"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(q.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-white cursor-pointer"
                            title="Delete question"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {q.question_image_url && (
                        <img
                          src={q.question_image_url}
                          alt={`Question ${index + 1} diagram`}
                          className="max-h-36 rounded-lg border border-slate-200 object-contain bg-white"
                        />
                      )}

                      {q.question_type === 'MCQ' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                          {(['A', 'B', 'C', 'D', 'E'] as const).map((ltr) => {
                            const val = (q as any)[`option_${ltr.toLowerCase()}`];
                            if (!val) return null;
                            const isCorrect = String(q.correct_answer || '').toUpperCase() === ltr;
                            return (
                              <div
                                key={ltr}
                                className={`px-2.5 py-1.5 rounded-lg border ${
                                  isCorrect
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-bold'
                                    : 'bg-white border-slate-200 text-slate-700'
                                }`}
                              >
                                <span className="font-bold mr-1.5">{ltr}.</span>
                                <span>{val}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {q.question_type !== 'MCQ' && (
                        <p className="text-emerald-800 font-bold">
                          Correct Answer: <span className="font-mono">{q.correct_answer}</span>
                        </p>
                      )}

                      {q.explanation && (
                        <p className="text-[11px] text-slate-600">
                          <strong>Explanation:</strong> {q.explanation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: LIVE RESULTS, ANALYTICS & REPORT CARD SYNC */}
        {studioTab === 'results' && resultsData && (
          <div className="space-y-6">
            {/* KPI Summary Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-500">Completed Submissions</p>
                <p className="text-2xl font-black text-slate-900 tabular-nums mt-1">
                  {resultsData.summary.completed_count}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  {resultsData.summary.in_progress_count} in progress
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-500">Class Average Score</p>
                <p className="text-2xl font-black text-slate-900 tabular-nums mt-1">
                  {resultsData.summary.average_percentage}%
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  Pass mark: {selectedExam.pass_mark_percent}%
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-500">Pass Rate</p>
                <p className="text-2xl font-black text-emerald-700 tabular-nums mt-1">
                  {resultsData.summary.pass_rate_percent}%
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  {resultsData.summary.passed_count} passed
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-500">Score Range</p>
                <p className="text-2xl font-black text-slate-900 tabular-nums mt-1">
                  {resultsData.summary.highest_percentage}%
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  Lowest: {resultsData.summary.lowest_percentage}%
                </p>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-xs text-slate-600">
                <strong className="text-slate-900">Report Card Integration:</strong> Sync completed CBT scores directly into any termly Examination&apos;s CA or Exam score column.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadExamStudio(selectedExam, 'results')}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenSyncModal}
                  disabled={resultsData.summary.completed_count === 0}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  <span>Sync Scores to Report Card</span>
                </button>
              </div>
            </div>

            {/* Student Attempts Table */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Student Submissions Leaderboard</h3>
              </div>
              {resultsData.attempts.length === 0 ? (
                <p className="p-8 text-center text-xs text-slate-500">
                  No student has started this CBT exam yet. Publish the exam so eligible students can sit it from their portal.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4">Student</th>
                        <th className="py-3 px-3">Class</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3 text-right">Score</th>
                        <th className="py-3 px-3 text-right">%</th>
                        <th className="py-3 px-3">Grade</th>
                        <th className="py-3 px-3">Duration</th>
                        <th className="py-3 px-3">Focus</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {resultsData.attempts.map((a) => (
                        <tr key={a.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4">
                            <p className="font-bold text-slate-900">{a.student_name}</p>
                            <p className="text-[11px] font-mono text-slate-500">{a.admission_number || '—'}</p>
                          </td>
                          <td className="py-3 px-3 text-slate-700">{a.class_name || '—'}</td>
                          <td className="py-3 px-3">
                            <span className="font-semibold text-slate-700">
                              {a.status === 'IN_PROGRESS' ? 'In Progress' : a.synced_to_report_card ? 'Synced' : 'Submitted'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-slate-900">
                            {a.score_obtained} / {a.max_score}
                          </td>
                          <td className="py-3 px-3 text-right font-bold">
                            <span className={a.passed ? 'text-emerald-700' : 'text-rose-700'}>{a.percentage}%</span>
                          </td>
                          <td className="py-3 px-3 font-bold text-slate-900">{a.grade || '—'}</td>
                          <td className="py-3 px-3 text-slate-600">{formatSeconds(a.time_spent_seconds)}</td>
                          <td className="py-3 px-3">
                            <span className={a.tab_switch_count > 0 ? 'text-amber-700 font-bold' : 'text-slate-500'}>
                              {a.tab_switch_count} switch{a.tab_switch_count === 1 ? '' : 'es'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {a.status !== 'IN_PROGRESS' && (
                                <button
                                  type="button"
                                  onClick={() => handleInspectAttempt(a.id)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Review</span>
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleResetAttempt(a.id)}
                                  className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold cursor-pointer inline-flex items-center gap-1"
                                  title="Allow student to retake this CBT exam"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Reset</span>
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

            {/* Per-Question Accuracy Analytics */}
            {resultsData.questionAnalytics.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-emerald-600" />
                  <span>Question Difficulty &amp; Accuracy Breakdown</span>
                </h3>
                <div className="space-y-2.5">
                  {resultsData.questionAnalytics.map((qa) => (
                    <div key={qa.question_id} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-slate-800 font-medium truncate">
                          <strong className="text-slate-900">Q{qa.question_number}.</strong> {qa.question_text}
                        </p>
                        <span className="font-bold text-slate-700 tabular-nums shrink-0">
                          {qa.accuracy_percent}% correct ({qa.correct_count}/{resultsData.summary.completed_count})
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            qa.accuracy_percent >= 70
                              ? 'bg-emerald-600'
                              : qa.accuracy_percent >= 45
                                ? 'bg-amber-500'
                                : 'bg-rose-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, qa.accuracy_percent))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SMART BULK QUESTION IMPORTER MODAL */}
        {bulkModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">Smart Bulk CBT Question Importer</h3>
                <button type="button" onClick={() => setBulkModalOpen(false)} className="cursor-pointer text-slate-500">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Paste multiple WAEC/JAMB-style numbered questions (with <code className="font-mono">A.</code>–<code className="font-mono">D.</code> and <code className="font-mono">Answer: B</code>) or paste CSV rows with headers <code className="font-mono">question_text,option_a,option_b,option_c,option_d,correct_answer,marks</code>.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">Raw Questions Text or CSV</span>
                <button
                  type="button"
                  onClick={() => setBulkRawText(SAMPLE_BULK_QUESTIONS)}
                  className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                >
                  Load Sample WAEC/JAMB Format
                </button>
              </div>
              <textarea
                rows={11}
                value={bulkRawText}
                onChange={(e) => setBulkRawText(e.target.value)}
                placeholder={SAMPLE_BULK_QUESTIONS}
                className="w-full p-3 border border-slate-300 rounded-xl font-mono text-xs"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBulkModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={bulkImporting || !bulkRawText.trim()}
                  onClick={handleBulkImport}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {bulkImporting ? 'Importing Questions...' : 'Parse & Import Questions'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SYNC SCORES TO REPORT CARD MODAL */}
        {syncModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
            <form
              onSubmit={handleSyncScores}
              className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">Sync CBT Scores to Report Card</h3>
                <button type="button" onClick={() => setSyncModalOpen(false)} className="cursor-pointer text-slate-500">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs text-slate-600">
                Each student&apos;s best CBT percentage is proportionally scaled to your school&apos;s CA or Exam maximum score and written cleanly into their subject record.
              </p>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Target Examination *</label>
                  <select
                    required
                    value={syncForm.examination_id}
                    onChange={(e) => setSyncForm((prev) => ({ ...prev, examination_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white"
                  >
                    <option value="">Select an Examination...</option>
                    {reportExams.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.title} {ex.class_name ? `(${ex.class_name})` : ''} — {ex.status}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Target Subject *</label>
                  <select
                    required
                    value={syncForm.subject_id}
                    onChange={(e) => setSyncForm((prev) => ({ ...prev, subject_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white"
                  >
                    <option value="">Select Subject from Catalog...</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Score Column *</label>
                  <select
                    value={syncForm.target}
                    onChange={(e) => setSyncForm((prev) => ({ ...prev, target: e.target.value as 'CA' | 'EXAM' }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white"
                  >
                    <option value="EXAM">Examination Score Column (e.g. /60)</option>
                    <option value="CA">Continuous Assessment / CA Column (e.g. /40)</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSyncModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Syncing...' : 'Sync Scores Now'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ATTEMPT REVIEW MODAL */}
        {reviewModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl max-h-[88vh] overflow-y-auto p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {reviewModal.attempt.student_name} — {reviewModal.exam.title}
                  </h3>
                  <p className="text-xs text-slate-600 tabular-nums">
                    Score: {reviewModal.attempt.score_obtained}/{reviewModal.attempt.max_score} ({reviewModal.attempt.percentage}% · Grade {reviewModal.attempt.grade})
                  </p>
                </div>
                <button type="button" onClick={() => setReviewModal(null)} className="cursor-pointer text-slate-500">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3 text-xs">
                {(reviewModal.review || []).map((item, i) => (
                  <div
                    key={item.question_id}
                    className={`p-3.5 rounded-xl border ${
                      item.is_correct ? 'bg-emerald-50/50 border-emerald-200' : 'bg-rose-50/40 border-rose-200'
                    }`}
                  >
                    <p className="font-bold text-slate-900">
                      Q{i + 1}. {item.question_text}
                    </p>
                    <p className="mt-1 text-slate-700">
                      Student Answer: <strong>{item.selected_answer || 'Unanswered'}</strong> · Correct Answer:{' '}
                      <strong className="text-emerald-800">{item.correct_answer}</strong> ({item.earned_marks}/{item.marks} marks)
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* EDIT EXAM MODAL (also reused from directory) */}
        {examModalOpen && renderExamModal()}
      </div>
    );
  }

  function renderExamModal() {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
        <form
          onSubmit={handleSaveExam}
          className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              {editingExam ? 'Edit CBT Examination Settings' : 'Create New CBT Examination'}
            </h3>
            <button type="button" onClick={() => setExamModalOpen(false)} className="cursor-pointer text-slate-500">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Exam Title *</label>
              <input
                type="text"
                required
                value={examForm.title}
                onChange={(e) => setExamForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="e.g. 1st Term JSS 1 Mathematics CBT Examination"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Subject (from catalog or custom) *</label>
              {subjects.length > 0 && (
                <select
                  value={examForm.subject_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const found = subjects.find((s) => s.id === id);
                    setExamForm((prev) => ({
                      ...prev,
                      subject_id: id,
                      subject_name: found ? found.name : prev.subject_name,
                    }));
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white mb-1.5"
                >
                  <option value="">Custom Subject Name...</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              )}
              <input
                type="text"
                required
                value={examForm.subject_name}
                onChange={(e) => setExamForm((prev) => ({ ...prev, subject_name: e.target.value }))}
                placeholder="e.g. Mathematics, English Language, Biology"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Target Class Scope *</label>
              <select
                value={examForm.class_id}
                onChange={(e) => setExamForm((prev) => ({ ...prev, class_id: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white"
              >
                <option value="ALL">All Classes (School-Wide CBT)</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.level ? `(${c.level})` : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Students only see CBT exams assigned to their class or All Classes.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Exam Mode</label>
              <select
                value={examForm.exam_mode}
                onChange={(e) => setExamForm((prev) => ({ ...prev, exam_mode: e.target.value as CbtExamMode }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white"
              >
                {Object.entries(EXAM_MODE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Duration (Minutes) *</label>
              <input
                type="number"
                min={1}
                max={300}
                required
                value={examForm.duration_minutes}
                onChange={(e) => setExamForm((prev) => ({ ...prev, duration_minutes: Number(e.target.value) || 30 }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl tabular-nums"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Pass Mark (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={examForm.pass_mark_percent}
                onChange={(e) => setExamForm((prev) => ({ ...prev, pass_mark_percent: Number(e.target.value) || 50 }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl tabular-nums"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Max Attempts per Student</label>
              <input
                type="number"
                min={1}
                max={10}
                value={examForm.max_attempts}
                onChange={(e) => setExamForm((prev) => ({ ...prev, max_attempts: Number(e.target.value) || 1 }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl tabular-nums"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Optional Exam Access PIN</label>
              <input
                type="text"
                value={examForm.access_code}
                onChange={(e) => setExamForm((prev) => ({ ...prev, access_code: e.target.value.toUpperCase() }))}
                placeholder="Leave blank for open entry (e.g. MATH2026)"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono uppercase"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Opens At (Optional)</label>
                <input
                  type="datetime-local"
                  value={examForm.starts_at}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, starts_at: e.target.value }))}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Closes At (Optional)</label>
                <input
                  type="datetime-local"
                  value={examForm.ends_at}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, ends_at: e.target.value }))}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-xl"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Exam Instructions for Students</label>
              <textarea
                rows={2}
                value={examForm.instructions}
                onChange={(e) => setExamForm((prev) => ({ ...prev, instructions: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl"
              />
            </div>

            <div className="sm:col-span-2 flex flex-wrap gap-4 pt-1">
              <label className="inline-flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={examForm.shuffle_questions}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, shuffle_questions: e.target.checked }))}
                />
                <span>Shuffle question order per student</span>
              </label>
              <label className="inline-flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={examForm.show_result_immediately}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, show_result_immediately: e.target.checked }))}
                />
                <span>Show score immediately on submission</span>
              </label>
              <label className="inline-flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={examForm.show_correct_answers}
                  onChange={(e) => setExamForm((prev) => ({ ...prev, show_correct_answers: e.target.checked }))}
                />
                <span>Allow post-submission answer review</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setExamModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingExam ? 'Save Changes' : 'Create Exam & Add Questions'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ============================================================================
  // RENDER: CBT EXAMINATIONS DIRECTORY
  // ============================================================================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <MonitorCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>Computer-Based Testing (CBT) Examination Centre</span>
          </h2>
          <p className="text-xs text-slate-600 max-w-2xl">
            Create timed CBT exams across Nursery, Primary, JSS, SSS, or school-wide classes. Import WAEC/JAMB questions in seconds, monitor live submissions, and sync scores directly into End-of-Term Report Cards.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateExamModal}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0 self-start lg:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Create CBT Exam</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span className="flex items-center gap-2">
            {feedback.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{feedback.text}</span>
          </span>
          <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col md:flex-row items-stretch md:items-center gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by exam title, subject, or class..."
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl"
          />
        </div>
        <select
          value={filterClassId}
          onChange={(e) => setFilterClassId(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-xl bg-white"
        >
          <option value="ALL">All Classes Filter</option>
          <option value="SCHOOL_WIDE">School-Wide (All Classes)</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-xl bg-white"
        >
          <option value="ALL">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published (Live)</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>

      {/* Exams Grid */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-500">
          Loading CBT examinations...
        </div>
      ) : filteredExams.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
          <MonitorCheck className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-900">No CBT Examinations Found</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Create your first Computer-Based Test for any class (e.g. Primary 5, JSS 1, SSS 3, or All Classes), add or bulk-import questions, and publish it for students.
          </p>
          <button
            type="button"
            onClick={openCreateExamModal}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
          >
            Create First CBT Exam
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredExams.map((exam) => (
            <div
              key={exam.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4 hover:border-slate-300 transition"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide truncate">
                      {exam.subject_name} · {exam.class_name || 'All Classes'}
                    </p>
                    <h3 className="text-sm font-bold text-slate-900 mt-0.5 break-words">{exam.title}</h3>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                      exam.status === 'PUBLISHED'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : exam.status === 'CLOSED'
                          ? 'bg-slate-100 text-slate-700 border border-slate-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {exam.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-[11px] tabular-nums">
                  <div>
                    <p className="text-slate-500">Questions</p>
                    <p className="font-bold text-slate-900">{exam.question_count ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Duration</p>
                    <p className="font-bold text-slate-900">{exam.duration_minutes} min</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Submitted</p>
                    <p className="font-bold text-slate-900">
                      {exam.completed_count ?? 0}
                      {exam.avg_percentage !== null && exam.avg_percentage !== undefined ? ` (${exam.avg_percentage}%)` : ''}
                    </p>
                  </div>
                </div>

                {exam.access_code && (
                  <p className="text-[11px] text-slate-600 flex items-center gap-1 font-mono">
                    <KeyRound className="w-3 h-3 text-slate-400" />
                    <span>PIN: {exam.access_code}</span>
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => loadExamStudio(exam, 'questions')}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer text-center"
                >
                  Questions ({exam.question_count ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => loadExamStudio(exam, 'results')}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer text-center"
                >
                  Results ({exam.completed_count ?? 0})
                </button>
                {exam.status !== 'PUBLISHED' ? (
                  <button
                    type="button"
                    onClick={() => handleToggleExamStatus(exam, 'PUBLISHED')}
                    className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold cursor-pointer"
                    title="Publish CBT Exam"
                  >
                    Publish
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleToggleExamStatus(exam, 'CLOSED')}
                    className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold cursor-pointer"
                    title="Close CBT Exam"
                  >
                    Close
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteExam(exam)}
                  className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                  title="Delete CBT exam"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {examModalOpen && renderExamModal()}
    </div>
  );
};
