import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Edit3,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  AcademicSessionItem,
  ClassItem,
  ManagedResultBatch,
  ManagedResultRow,
  SubjectItem,
} from '../../types';

interface BulkResultsManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
  sessions: AcademicSessionItem[];
  classes: ClassItem[];
  subjects: SubjectItem[];
  departments?: string[];
  classLabel?: string;
  cycleLabel?: string;
  subjectLabel?: string;
  learnerLabel?: string;
  isTertiary?: boolean;
  initialTab?: 'BATCHES' | 'SCORES';
  initialExamIds?: string[];
  initialAction?: 'REASSIGN' | 'DELETE' | null;
}

interface ScoreDraft {
  ca_score: string;
  exam_score: string;
  total_score: string;
  subject_remark: string;
}

export const BulkResultsManagerModal: React.FC<BulkResultsManagerModalProps> = ({
  isOpen,
  onClose,
  onChanged,
  sessions,
  classes,
  subjects,
  departments = [],
  classLabel = 'Class',
  cycleLabel = 'Term',
  subjectLabel = 'Subject',
  learnerLabel = 'Student',
  isTertiary = false,
  initialTab = 'BATCHES',
  initialExamIds = [],
  initialAction = null,
}) => {
  const [activeTab, setActiveTab] = useState<'BATCHES' | 'SCORES'>(initialTab);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [batches, setBatches] = useState<ManagedResultBatch[]>([]);
  const [scores, setScores] = useState<ManagedResultRow[]>([]);

  // Filters
  const [filterSessionId, setFilterSessionId] = useState('');
  const [filterTermId, setFilterTermId] = useState('');
  const [filterClassId, setFilterClassId] = useState('');
  const [filterSubjectId, setFilterSubjectId] = useState('');
  const [filterExamId, setFilterExamId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Multi-select state
  const [selectedExamIds, setSelectedExamIds] = useState<string[]>([]);
  const [selectedScoreIds, setSelectedScoreIds] = useState<string[]>([]);

  // Inline score edit state: map scoreId -> draft
  const [editedScores, setEditedScores] = useState<Record<string, ScoreDraft>>({});
  const [editReason, setEditReason] = useState('Corrected score entry error');

  // Action drawer ('REASSIGN' | 'DELETE' | null)
  const [actionMode, setActionMode] = useState<'REASSIGN' | 'DELETE' | null>(null);
  const [actionScope, setActionScope] = useState<'EXAMS' | 'SCORES'>('EXAMS');

  // Reassign form state
  const [targetClassId, setTargetClassId] = useState('');
  const [targetSessionId, setTargetSessionId] = useState('');
  const [targetTermId, setTargetTermId] = useState('');
  const [targetDepartment, setTargetDepartment] = useState('');
  const [newExamTitle, setNewExamTitle] = useState('');
  const [reassignReason, setReassignReason] = useState('');

  // Delete form state
  const [alsoDeleteRegistrations, setAlsoDeleteRegistrations] = useState(true);
  const [deleteReason, setDeleteReason] = useState('');

  const filterSessionObj = useMemo(
    () => sessions.find((s) => s.id === filterSessionId) || null,
    [sessions, filterSessionId]
  );

  const targetSessionObj = useMemo(
    () => sessions.find((s) => s.id === targetSessionId) || null,
    [sessions, targetSessionId]
  );

  const loadData = async (override?: {
    academic_session_id?: string;
    term_id?: string;
    class_id?: string;
    subject_id?: string;
    examination_id?: string;
    search?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getManagedResults({
        academic_session_id: override?.academic_session_id ?? (filterSessionId || undefined),
        term_id: override?.term_id ?? (filterTermId || undefined),
        class_id: override?.class_id ?? (filterClassId || undefined),
        subject_id: override?.subject_id ?? (filterSubjectId || undefined),
        examination_id: override?.examination_id ?? (filterExamId || undefined),
        search: override?.search ?? (searchQuery.trim() || undefined),
        limit: 800,
      });
      setBatches(res.batches || []);
      setScores(res.scores || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load uploaded results.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    setError(null);
    setNotice(null);
    setEditedScores({});
    setSelectedScoreIds([]);
    setSelectedExamIds(initialExamIds);
    setActionMode(initialAction);
    setActionScope('EXAMS');
    setTargetClassId('');
    setTargetSessionId('');
    setTargetTermId('');
    setTargetDepartment('');
    setNewExamTitle('');
    setReassignReason(
      initialAction === 'REASSIGN' ? `Corrected mistakenly assigned ${classLabel.toLowerCase()}` : ''
    );
    setDeleteReason(initialAction === 'DELETE' ? 'Removed mistakenly uploaded results' : '');
    setFilterSessionId('');
    setFilterTermId('');
    setFilterClassId('');
    setFilterSubjectId('');
    setFilterExamId('');
    setSearchQuery('');
    loadData({
      academic_session_id: undefined,
      term_id: undefined,
      class_id: undefined,
      subject_id: undefined,
      examination_id: undefined,
      search: undefined,
    });
  }, [isOpen, initialTab, initialAction, JSON.stringify(initialExamIds)]);

  if (!isOpen) return null;

  const modifiedCount = Object.keys(editedScores).length;

  const toggleExam = (id: string) => {
    setSelectedExamIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAllExams = () => {
    if (selectedExamIds.length === batches.length && batches.length > 0) {
      setSelectedExamIds([]);
    } else {
      setSelectedExamIds(batches.map((b) => b.examination_id));
    }
  };

  const toggleScore = (id: string) => {
    setSelectedScoreIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAllScores = () => {
    if (selectedScoreIds.length === scores.length && scores.length > 0) {
      setSelectedScoreIds([]);
    } else {
      setSelectedScoreIds(scores.map((s) => s.id));
    }
  };

  const getDraft = (row: ManagedResultRow): ScoreDraft => {
    return (
      editedScores[row.id] || {
        ca_score: row.ca_score !== null && row.ca_score !== undefined ? String(row.ca_score) : '',
        exam_score: row.exam_score !== null && row.exam_score !== undefined ? String(row.exam_score) : '',
        total_score: row.total_score !== null && row.total_score !== undefined ? String(row.total_score) : '',
        subject_remark: row.subject_remark || '',
      }
    );
  };

  const updateScoreDraft = (row: ManagedResultRow, field: keyof ScoreDraft, value: string) => {
    setEditedScores((prev) => {
      const current = prev[row.id] || {
        ca_score: row.ca_score !== null && row.ca_score !== undefined ? String(row.ca_score) : '',
        exam_score: row.exam_score !== null && row.exam_score !== undefined ? String(row.exam_score) : '',
        total_score: row.total_score !== null && row.total_score !== undefined ? String(row.total_score) : '',
        subject_remark: row.subject_remark || '',
      };
      const next = { ...current, [field]: value };
      if (field === 'ca_score' || field === 'exam_score') {
        const ca = next.ca_score.trim() === '' ? 0 : Number(next.ca_score);
        const ex = next.exam_score.trim() === '' ? 0 : Number(next.exam_score);
        if (Number.isFinite(ca) && Number.isFinite(ex)) {
          next.total_score = String(Math.round((ca + ex) * 100) / 100);
        }
      }
      return { ...prev, [row.id]: next };
    });
  };

  const openReassignFor = (scope: 'EXAMS' | 'SCORES', singleExamId?: string) => {
    if (singleExamId) setSelectedExamIds([singleExamId]);
    setActionScope(scope);
    setActionMode('REASSIGN');
    setTargetClassId('');
    setTargetSessionId('');
    setTargetTermId('');
    setTargetDepartment('');
    setNewExamTitle('');
    setReassignReason(`Corrected mistakenly assigned ${classLabel.toLowerCase()}`);
    setError(null);
    setNotice(null);
  };

  const openDeleteFor = (scope: 'EXAMS' | 'SCORES', singleExamId?: string) => {
    if (singleExamId) setSelectedExamIds([singleExamId]);
    setActionScope(scope);
    setActionMode('DELETE');
    setAlsoDeleteRegistrations(true);
    setDeleteReason('Removed mistakenly uploaded results');
    setError(null);
    setNotice(null);
  };

  const handleSaveScoreEdits = async () => {
    const entries = Object.entries(editedScores);
    if (entries.length === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const edits = entries.map(([scoreId, d]) => ({
        score_id: scoreId,
        ca_score: d.ca_score.trim() === '' ? null : Number(d.ca_score),
        exam_score: d.exam_score.trim() === '' ? null : Number(d.exam_score),
        total_score: d.total_score.trim() === '' ? null : Number(d.total_score),
        subject_remark: d.subject_remark.trim() || null,
      }));
      const res = await api.bulkEditResults({
        edits,
        reason: editReason.trim() || 'Admin score correction',
      });
      setEditedScores({});
      setNotice(res.message);
      await loadData();
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to save edited scores.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmReassign = async () => {
    const examIds = actionScope === 'EXAMS' ? selectedExamIds : [];
    const scoreIds = actionScope === 'SCORES' ? selectedScoreIds : [];
    if (examIds.length === 0 && scoreIds.length === 0) {
      setError('Select at least one batch or score row to reassign.');
      return;
    }
    if (!targetClassId && !targetSessionId && !targetTermId && !targetDepartment.trim() && !newExamTitle.trim()) {
      setError(`Choose a new ${classLabel}, Session, ${cycleLabel}, Department, or Title to apply.`);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.bulkReassignResults({
        examination_ids: examIds.length > 0 ? examIds : undefined,
        score_ids: scoreIds.length > 0 ? scoreIds : undefined,
        target_class_id: targetClassId || null,
        target_academic_session_id: targetSessionId || null,
        target_term_id: targetTermId || null,
        target_department: targetDepartment.trim() || null,
        new_exam_title: newExamTitle.trim() || null,
        reason: reassignReason.trim() || `Corrected ${classLabel.toLowerCase()} assignment`,
      });
      setNotice(res.message);
      setActionMode(null);
      setSelectedExamIds([]);
      setSelectedScoreIds([]);
      await loadData();
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to reassign results.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    const examIds = actionScope === 'EXAMS' ? selectedExamIds : [];
    const scoreIds = actionScope === 'SCORES' ? selectedScoreIds : [];
    if (examIds.length === 0 && scoreIds.length === 0) {
      setError('Select at least one batch or score row to delete.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.bulkDeleteResults({
        examination_ids: examIds.length > 0 ? examIds : undefined,
        score_ids: scoreIds.length > 0 ? scoreIds : undefined,
        also_delete_registrations: alsoDeleteRegistrations,
        reason: deleteReason.trim() || 'Removed mistakenly uploaded results',
      });
      setNotice(res.message);
      setActionMode(null);
      setSelectedExamIds([]);
      setSelectedScoreIds([]);
      await loadData();
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete selected results.');
    } finally {
      setSaving(false);
    }
  };

  const selectedBatchSummaries = batches.filter((b) => selectedExamIds.includes(b.examination_id));
  const selectedBatchScoreTotal = selectedBatchSummaries.reduce((sum, b) => sum + b.scores_count, 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[1px] flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Manage, Fix and Bulk Delete Results"
    >
      <div className="bg-white w-full max-w-6xl max-h-[92vh] rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">
              Manage, Correct &amp; Bulk Delete Uploaded Results
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Fix mistaken {classLabel.toLowerCase()} assignments (e.g. {isTertiary ? 'HND 1 → Year 1 (100L)' : 'JSS 3 → Primary 1'}), move wrong sessions or {cycleLabel.toLowerCase()}s, edit score typos inline, or bulk delete wrongly uploaded batches—report cards update automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
            aria-label="Close results manager"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher + Filter Bar */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex p-1 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('BATCHES');
                  setActionMode(null);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  activeTab === 'BATCHES' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Uploaded Batches ({batches.length})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('SCORES');
                  setActionMode(null);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  activeTab === 'SCORES' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Individual Scores ({scores.length})</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeTab === 'BATCHES' && selectedExamIds.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => openReassignFor('EXAMS')}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Fix {classLabel} / Session ({selectedExamIds.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeleteFor('EXAMS')}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Bulk Delete ({selectedExamIds.length})</span>
                  </button>
                </>
              )}

              {activeTab === 'SCORES' && modifiedCount > 0 && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveScoreEdits}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : `Save ${modifiedCount} Score Edit${modifiedCount > 1 ? 's' : ''}`}</span>
                </button>
              )}

              {activeTab === 'SCORES' && selectedScoreIds.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => openReassignFor('SCORES')}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Reassign ({selectedScoreIds.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeleteFor('SCORES')}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Bulk Delete ({selectedScoreIds.length})</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => loadData()}
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Filter controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 text-xs">
            <select
              aria-label="Filter by Session"
              value={filterSessionId}
              onChange={(e) => {
                const v = e.target.value;
                setFilterSessionId(v);
                setFilterTermId('');
                loadData({ academic_session_id: v || undefined, term_id: undefined });
              }}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            >
              <option value="">All Sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              aria-label={`Filter by ${cycleLabel}`}
              value={filterTermId}
              onChange={(e) => {
                const v = e.target.value;
                setFilterTermId(v);
                loadData({ term_id: v || undefined });
              }}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            >
              <option value="">All {cycleLabel}s</option>
              {(filterSessionObj?.terms || sessions.flatMap((s) => s.terms || [])).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <select
              aria-label={`Filter by ${classLabel}`}
              value={filterClassId}
              onChange={(e) => {
                const v = e.target.value;
                setFilterClassId(v);
                loadData({ class_id: v || undefined });
              }}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            >
              <option value="">All {classLabel}es</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              aria-label={`Filter by ${subjectLabel}`}
              value={filterSubjectId}
              onChange={(e) => {
                const v = e.target.value;
                setFilterSubjectId(v);
                loadData({ subject_id: v || undefined });
              }}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            >
              <option value="">All {subjectLabel}s</option>
              {subjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.code ? `${sub.code} — ` : ''}{sub.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by Examination Batch"
              value={filterExamId}
              onChange={(e) => {
                const v = e.target.value;
                setFilterExamId(v);
                loadData({ examination_id: v || undefined });
              }}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            >
              <option value="">All Batches / Exams</option>
              {batches.map((b) => (
                <option key={b.examination_id} value={b.examination_id}>
                  {b.title}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadData({ search: searchQuery.trim() || undefined });
                }}
                placeholder={`Search ${learnerLabel.toLowerCase()} or ${subjectLabel.toLowerCase()}...`}
                className="w-full pl-8 pr-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>
        </div>

        {/* Feedback banners */}
        {(error || notice) && (
          <div className="px-5 pt-3">
            {error && (
              <div className="px-3.5 py-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </span>
                <button type="button" onClick={() => setError(null)} className="p-0.5 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {notice && (
              <div className="px-3.5 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{notice}</span>
                </span>
                <button type="button" onClick={() => setNotice(null)} className="p-0.5 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Inline Reassign Drawer (Fix Class / Level / Session / Term / Department) */}
        {actionMode === 'REASSIGN' && (
          <div className="mx-5 mt-3 p-4 rounded-xl bg-slate-50 border border-slate-300 space-y-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Reassign / Fix {classLabel}, Session or {cycleLabel}
                </h3>
                <p className="text-slate-600 mt-0.5">
                  {actionScope === 'EXAMS'
                    ? `Moving ${selectedExamIds.length} selected batch(es) (${selectedBatchScoreTotal} score row(s)).`
                    : `Moving ${selectedScoreIds.length} selected score row(s).`}{' '}
                  Leave any field unchanged to keep its current value. Report cards, registrations, and historical records update automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionMode(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Cancel reassignment"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Correct {classLabel} (e.g. {isTertiary ? 'Year 1 (100L)' : 'Primary 1'})
                </label>
                <select
                  aria-label={`Target ${classLabel} for Reassignment`}
                  value={targetClassId}
                  onChange={(e) => setTargetClassId(e.target.value)}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">Keep current {classLabel.toLowerCase()}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Correct Academic Session</label>
                <select
                  aria-label="Target Session for Reassignment"
                  value={targetSessionId}
                  onChange={(e) => {
                    setTargetSessionId(e.target.value);
                    setTargetTermId('');
                  }}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">Keep current session</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Correct {cycleLabel}</label>
                <select
                  aria-label={`Target ${cycleLabel} for Reassignment`}
                  value={targetTermId}
                  onChange={(e) => setTargetTermId(e.target.value)}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">Keep current {cycleLabel.toLowerCase()}</option>
                  {(targetSessionObj?.terms || sessions.flatMap((s) => s.terms || [])).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {isTertiary ? 'Department (optional)' : 'Arm / Stream (optional)'}
                </label>
                <input
                  type="text"
                  list="reassign-dept-options"
                  value={targetDepartment}
                  onChange={(e) => setTargetDepartment(e.target.value)}
                  placeholder="Keep current"
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                />
                <datalist id="reassign-dept-options">
                  {departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Updated Batch / Exam Title (optional — auto-updates class name)
                </label>
                <input
                  type="text"
                  value={newExamTitle}
                  onChange={(e) => setNewExamTitle(e.target.value)}
                  placeholder="Leave blank to automatically swap old class name"
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Audit Note</label>
                <input
                  type="text"
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  placeholder="e.g. Uploaded under HND 1 instead of Year 1 (100L)"
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setActionMode(null)}
                className="px-3.5 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirmReassign}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
                <span>{saving ? 'Applying...' : 'Apply Reassignment'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Inline Bulk Delete Confirmation Drawer */}
        {actionMode === 'DELETE' && (
          <div className="mx-5 mt-3 p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-rose-900">
                  Confirm Permanent Bulk Delete
                </h3>
                <p className="text-rose-800 mt-0.5">
                  {actionScope === 'EXAMS'
                    ? `This will permanently delete ${selectedExamIds.length} examination batch(es) and all ${selectedBatchScoreTotal} linked score(s).`
                    : `This will permanently delete ${selectedScoreIds.length} selected score row(s).`}{' '}
                  Affected Term/{cycleLabel} and Session Report Cards will automatically be removed or recalculated so no wrong results remain.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionMode(null)}
                className="p-1 text-rose-500 hover:text-rose-800 cursor-pointer"
                aria-label="Cancel bulk delete"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div>
                <label className="block font-semibold text-rose-900 mb-1">
                  Audit Reason (required for published results)
                </label>
                <input
                  type="text"
                  aria-label="Bulk Delete Audit Reason"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="e.g. Uploaded wrong file for JSS 3 instead of Primary 1"
                  className="w-full px-2.5 py-2 bg-white border border-rose-300 rounded-lg text-slate-900"
                />
              </div>
              <label className="flex items-center gap-2 text-rose-900 font-medium pt-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alsoDeleteRegistrations}
                  onChange={(e) => setAlsoDeleteRegistrations(e.target.checked)}
                  className="w-4 h-4 rounded border-rose-300 text-rose-600"
                />
                <span>Also remove linked {subjectLabel.toLowerCase()} registrations &amp; empty backlog markers</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setActionMode(null)}
                className="px-3.5 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{saving ? 'Deleting...' : 'Confirm Permanent Bulk Delete'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>Loading uploaded results...</span>
            </div>
          ) : activeTab === 'BATCHES' ? (
            batches.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No uploaded result batches match your current filters.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3 w-9">
                        <input
                          type="checkbox"
                          aria-label="Select all batches"
                          checked={selectedExamIds.length === batches.length && batches.length > 0}
                          onChange={toggleAllExams}
                          className="w-4 h-4 rounded border-slate-300 text-emerald-600"
                        />
                      </th>
                      <th className="py-2.5 px-3">Batch / Examination</th>
                      <th className="py-2.5 px-3">Session · {cycleLabel}</th>
                      <th className="py-2.5 px-3">{classLabel} {isTertiary ? '· Department' : ''}</th>
                      <th className="py-2.5 px-3 text-right">Scores</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Quick Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.map((b) => {
                      const checked = selectedExamIds.includes(b.examination_id);
                      return (
                        <tr
                          key={b.examination_id}
                          className={`hover:bg-slate-50/80 ${checked ? 'bg-emerald-50/40' : ''}`}
                        >
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              aria-label={`Select ${b.title}`}
                              checked={checked}
                              onChange={() => toggleExam(b.examination_id)}
                              className="w-4 h-4 rounded border-slate-300 text-emerald-600"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900">{b.title}</div>
                            <div className="text-[11px] text-slate-500 tabular-nums">
                              {b.students_count} {learnerLabel.toLowerCase()}(s) · {b.subjects_count} {subjectLabel.toLowerCase()}(s)
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                            {b.session_name || '—'} · {b.term_name || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-800 font-medium">
                            {b.class_name || `All ${classLabel}es`}
                            {b.department ? <span className="text-slate-500 font-normal"> · {b.department}</span> : null}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                            {b.scores_count}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 font-medium">
                            {b.status}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setFilterExamId(b.examination_id);
                                  setActiveTab('SCORES');
                                  loadData({ examination_id: b.examination_id });
                                }}
                                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-md font-semibold cursor-pointer"
                              >
                                Edit Scores
                              </button>
                              <button
                                type="button"
                                onClick={() => openReassignFor('EXAMS', b.examination_id)}
                                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold cursor-pointer"
                              >
                                Fix {classLabel}
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeleteFor('EXAMS', b.examination_id)}
                                className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-md font-semibold cursor-pointer"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="space-y-3">
              {modifiedCount > 0 && (
                <div className="px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-amber-900 tabular-nums">
                    {modifiedCount} unsaved score edit(s) pending.
                  </span>
                  <div className="flex items-center gap-2 flex-1 max-w-md justify-end">
                    <input
                      type="text"
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      placeholder="Correction reason (logged to audit)"
                      className="flex-1 px-2.5 py-1 bg-white border border-amber-300 rounded-md text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setEditedScores({})}
                      className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 rounded-md font-semibold cursor-pointer"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSaveScoreEdits}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Edits'}
                    </button>
                  </div>
                </div>
              )}

              {scores.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No individual score rows match your current filters.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <th className="py-2 px-2.5 w-8">
                          <input
                            type="checkbox"
                            aria-label="Select all score rows"
                            checked={selectedScoreIds.length === scores.length && scores.length > 0}
                            onChange={toggleAllScores}
                            className="w-4 h-4 rounded border-slate-300 text-emerald-600"
                          />
                        </th>
                        <th className="py-2 px-2.5">{learnerLabel}</th>
                        <th className="py-2 px-2.5">Session · {cycleLabel} · {classLabel}</th>
                        <th className="py-2 px-2.5">{subjectLabel}</th>
                        <th className="py-2 px-2.5 text-right w-20">CA</th>
                        <th className="py-2 px-2.5 text-right w-20">Exam</th>
                        <th className="py-2 px-2.5 text-right w-20">Total</th>
                        <th className="py-2 px-2.5 w-14 text-center">Grade</th>
                        <th className="py-2 px-2.5">Remark</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {scores.map((row) => {
                        const checked = selectedScoreIds.includes(row.id);
                        const isDirty = Boolean(editedScores[row.id]);
                        const d = getDraft(row);
                        return (
                          <tr
                            key={row.id}
                            className={`hover:bg-slate-50/70 ${isDirty ? 'bg-amber-50/60' : checked ? 'bg-emerald-50/40' : ''}`}
                          >
                            <td className="py-2 px-2.5">
                              <input
                                type="checkbox"
                                aria-label={`Select score for ${row.student_name} ${row.subject_name}`}
                                checked={checked}
                                onChange={() => toggleScore(row.id)}
                                className="w-4 h-4 rounded border-slate-300 text-emerald-600"
                              />
                            </td>
                            <td className="py-2 px-2.5">
                              <div className="font-semibold text-slate-900">{row.student_name}</div>
                              <div className="text-[11px] text-slate-500 font-mono">
                                {row.admission_number || '—'}
                              </div>
                            </td>
                            <td className="py-2 px-2.5 text-slate-600 whitespace-nowrap">
                              {row.session_name || '—'} · {row.term_name || '—'} · <strong className="text-slate-800">{row.class_name || '—'}</strong>
                            </td>
                            <td className="py-2 px-2.5 text-slate-800">
                              <span className="font-medium">{row.subject_name}</span>
                              {row.subject_code ? <span className="text-slate-400 ml-1">({row.subject_code})</span> : null}
                            </td>
                            <td className="py-1.5 px-2 text-right">
                              <input
                                type="number"
                                step="0.5"
                                min={0}
                                max={row.total_max_score || 100}
                                aria-label={`CA score for ${row.student_name} ${row.subject_name}`}
                                value={d.ca_score}
                                onChange={(e) => updateScoreDraft(row, 'ca_score', e.target.value)}
                                className="w-16 px-1.5 py-1 text-right font-mono tabular-nums bg-white border border-slate-300 rounded"
                              />
                            </td>
                            <td className="py-1.5 px-2 text-right">
                              <input
                                type="number"
                                step="0.5"
                                min={0}
                                max={row.total_max_score || 100}
                                aria-label={`Exam score for ${row.student_name} ${row.subject_name}`}
                                value={d.exam_score}
                                onChange={(e) => updateScoreDraft(row, 'exam_score', e.target.value)}
                                className="w-16 px-1.5 py-1 text-right font-mono tabular-nums bg-white border border-slate-300 rounded"
                              />
                            </td>
                            <td className="py-1.5 px-2 text-right">
                              <input
                                type="number"
                                step="0.5"
                                min={0}
                                max={row.total_max_score || 100}
                                aria-label={`Total score for ${row.student_name} ${row.subject_name}`}
                                value={d.total_score}
                                onChange={(e) => updateScoreDraft(row, 'total_score', e.target.value)}
                                className="w-16 px-1.5 py-1 text-right font-mono tabular-nums font-bold bg-slate-50 border border-slate-300 rounded"
                              />
                            </td>
                            <td className="py-2 px-2 text-center font-mono font-bold text-slate-800">
                              {row.grade || '—'}
                            </td>
                            <td className="py-1.5 px-2">
                              <input
                                type="text"
                                value={d.subject_remark}
                                onChange={(e) => updateScoreDraft(row, 'subject_remark', e.target.value)}
                                placeholder="Optional remark"
                                className="w-full min-w-[110px] px-2 py-1 bg-white border border-slate-200 rounded"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Every correction, reassignment, and bulk deletion is recorded in the School Audit Log and automatically syncs Report Cards.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-lg font-semibold cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
