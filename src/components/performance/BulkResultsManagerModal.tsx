import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Edit3,
  Filter,
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
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'BATCHES' | 'SCORES'>(initialTab);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Keep both full batch catalog (for accurate selected summaries) and filtered list
  const [allBatches, setAllBatches] = useState<ManagedResultBatch[]>([]);
  const [batches, setBatches] = useState<ManagedResultBatch[]>([]);
  const [scores, setScores] = useState<ManagedResultRow[]>([]);

  // Filters (collapsible on mobile so content & action forms are always immediately visible)
  const [showFilters, setShowFilters] = useState(false);
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

  // Focused action panel ('REASSIGN' | 'DELETE' | null)
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

  const activeFilterCount = [
    filterSessionId,
    filterTermId,
    filterClassId,
    filterSubjectId,
    filterExamId,
    searchQuery.trim(),
  ].filter(Boolean).length;

  const loadData = async (override?: {
    academic_session_id?: string;
    term_id?: string;
    class_id?: string;
    subject_id?: string;
    examination_id?: string;
    search?: string;
    refreshAllBatches?: boolean;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const hasOverride = override !== undefined;
      const reqParams = {
        academic_session_id: hasOverride ? override.academic_session_id : filterSessionId || undefined,
        term_id: hasOverride ? override.term_id : filterTermId || undefined,
        class_id: hasOverride ? override.class_id : filterClassId || undefined,
        subject_id: hasOverride ? override.subject_id : filterSubjectId || undefined,
        examination_id: hasOverride ? override.examination_id : filterExamId || undefined,
        search: hasOverride ? override.search : searchQuery.trim() || undefined,
        limit: 800,
      };
      const hasAnyFilter = Boolean(
        reqParams.academic_session_id ||
          reqParams.term_id ||
          reqParams.class_id ||
          reqParams.subject_id ||
          reqParams.examination_id ||
          reqParams.search
      );

      const res = await api.getManagedResults(reqParams);
      setBatches(res.batches || []);
      setScores(res.scores || []);
      if (!hasAnyFilter || override?.refreshAllBatches) {
        if (!hasAnyFilter) {
          setAllBatches(res.batches || []);
        } else {
          const allRes = await api.getManagedResults({ limit: 1 });
          setAllBatches(allRes.batches || []);
        }
      }
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
    setShowFilters(false);
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
      refreshAllBatches: true,
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
    setShowFilters(false);
    setTargetClassId('');
    setTargetSessionId('');
    setTargetTermId('');
    setTargetDepartment('');
    setNewExamTitle('');
    setReassignReason(`Corrected mistakenly assigned ${classLabel.toLowerCase()}`);
    setError(null);
    setNotice(null);
    scrollBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openDeleteFor = (scope: 'EXAMS' | 'SCORES', singleExamId?: string) => {
    if (singleExamId) setSelectedExamIds([singleExamId]);
    setActionScope(scope);
    setActionMode('DELETE');
    setShowFilters(false);
    setAlsoDeleteRegistrations(true);
    setDeleteReason('Removed mistakenly uploaded results');
    setError(null);
    setNotice(null);
    scrollBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearAllFilters = () => {
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
      await loadData({ refreshAllBatches: true });
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
      setError(`Choose a new ${classLabel}, Session, ${cycleLabel}, Department, or Title below before clicking Apply.`);
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
      await loadData({
        academic_session_id: filterSessionId || undefined,
        term_id: filterTermId || undefined,
        class_id: filterClassId || undefined,
        subject_id: filterSubjectId || undefined,
        examination_id: filterExamId || undefined,
        search: searchQuery.trim() || undefined,
        refreshAllBatches: true,
      });
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
      await loadData({
        academic_session_id: filterSessionId || undefined,
        term_id: filterTermId || undefined,
        class_id: filterClassId || undefined,
        subject_id: filterSubjectId || undefined,
        examination_id: filterExamId || undefined,
        search: searchQuery.trim() || undefined,
        refreshAllBatches: true,
      });
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete selected results.');
    } finally {
      setSaving(false);
    }
  };

  const batchLookupPool = allBatches.length > 0 ? allBatches : batches;
  const selectedBatchSummaries = batchLookupPool.filter((b) => selectedExamIds.includes(b.examination_id));
  const selectedBatchScoreTotal = selectedBatchSummaries.reduce((sum, b) => sum + b.scores_count, 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Manage, Fix and Bulk Delete Results"
    >
      <div className="bg-white w-full max-w-6xl h-[94dvh] sm:h-auto sm:max-h-[92vh] rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        {/* Compact Sticky Header */}
        <div className="shrink-0 px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
              Manage, Correct &amp; Bulk Delete Uploaded Results
            </h2>
            <p className="hidden sm:block text-xs text-slate-500 mt-0.5">
              Fix mistaken {classLabel.toLowerCase()} assignments (e.g. {isTertiary ? 'HND 1 → Year 1 (100L)' : 'JSS 3 → Primary 1'}), move wrong sessions or {cycleLabel.toLowerCase()}s, edit score typos inline, or bulk delete wrongly uploaded batches—report cards update automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer shrink-0"
            aria-label="Close results manager"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Single Unified Scrollable Body — guarantees EVERY form field, button & table is reachable on mobile & desktop */}
        <div
          ref={scrollBodyRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-4"
        >
          {/* Feedback banners */}
          {error && (
            <div className="px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start justify-between gap-2">
              <span className="flex items-start gap-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </span>
              <button type="button" onClick={() => setError(null)} className="p-0.5 cursor-pointer shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {notice && (
            <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start justify-between gap-2">
              <span className="flex items-start gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{notice}</span>
              </span>
              <button type="button" onClick={() => setNotice(null)} className="p-0.5 cursor-pointer shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* FOCUSED REASSIGN PANEL — pinned at very top of scroll body so mobile users immediately see & edit it! */}
          {actionMode === 'REASSIGN' && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-300 space-y-3.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Reassign / Fix {classLabel}, Session or {cycleLabel}
                  </h3>
                  <p className="text-slate-600 mt-0.5">
                    {actionScope === 'EXAMS'
                      ? `Updating ${selectedExamIds.length} selected batch(es) (${selectedBatchScoreTotal} score row(s)).`
                      : `Updating ${selectedScoreIds.length} selected score row(s).`}{' '}
                    Choose the correct {classLabel.toLowerCase()}, session, or {cycleLabel.toLowerCase()} below and tap <strong>Apply Reassignment</strong>.
                  </p>
                  {actionScope === 'EXAMS' && selectedBatchSummaries.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {selectedBatchSummaries.slice(0, 3).map((b) => (
                        <div key={b.examination_id} className="text-[11px] text-slate-700 font-medium">
                          Selected: <strong className="text-slate-900">{b.title}</strong> · Currently{' '}
                          <strong className="text-slate-900">{b.class_name || `All ${classLabel}es`}</strong> ·{' '}
                          {b.session_name || '—'} · {b.term_name || '—'} ({b.scores_count} scores)
                        </div>
                      ))}
                      {selectedBatchSummaries.length > 3 && (
                        <div className="text-[11px] text-slate-500">
                          +{selectedBatchSummaries.length - 3} more selected batch(es)
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setActionMode(null)}
                  className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
                  aria-label="Cancel reassignment"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    New / Correct {classLabel}
                  </label>
                  <select
                    aria-label={`Target ${classLabel} for Reassignment`}
                    value={targetClassId}
                    onChange={(e) => setTargetClassId(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-sm sm:text-xs"
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
                  <label className="block font-semibold text-slate-800 mb-1">New / Correct Academic Session</label>
                  <select
                    aria-label="Target Session for Reassignment"
                    value={targetSessionId}
                    onChange={(e) => {
                      setTargetSessionId(e.target.value);
                      setTargetTermId('');
                    }}
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-sm sm:text-xs"
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
                  <label className="block font-semibold text-slate-800 mb-1">New / Correct {cycleLabel}</label>
                  <select
                    aria-label={`Target ${cycleLabel} for Reassignment`}
                    value={targetTermId}
                    onChange={(e) => setTargetTermId(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-sm sm:text-xs"
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
                  <label className="block font-semibold text-slate-800 mb-1">
                    {isTertiary ? 'Department (optional)' : 'Arm / Stream (optional)'}
                  </label>
                  <input
                    type="text"
                    list="reassign-dept-options"
                    value={targetDepartment}
                    onChange={(e) => setTargetDepartment(e.target.value)}
                    placeholder="Keep current"
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-sm sm:text-xs"
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
                  <label className="block font-semibold text-slate-800 mb-1">
                    Updated Batch / Exam Title (optional)
                  </label>
                  <input
                    type="text"
                    value={newExamTitle}
                    onChange={(e) => setNewExamTitle(e.target.value)}
                    placeholder="Leave blank to auto-update class name"
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-sm sm:text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">Audit Note</label>
                  <input
                    type="text"
                    value={reassignReason}
                    onChange={(e) => setReassignReason(e.target.value)}
                    placeholder="e.g. Uploaded under HND 1 instead of Year 1 (100L)"
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-lg text-sm sm:text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setActionMode(null)}
                  className="w-full sm:w-auto px-4 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleConfirmReassign}
                  className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                  <span>{saving ? 'Applying...' : 'Apply Reassignment'}</span>
                </button>
              </div>
            </div>
          )}

          {/* FOCUSED BULK DELETE CONFIRMATION PANEL — pinned at very top of scroll body! */}
          {actionMode === 'DELETE' && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-3.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-rose-900">
                    Confirm Permanent Bulk Delete
                  </h3>
                  <p className="text-rose-800 mt-0.5">
                    {actionScope === 'EXAMS'
                      ? `This will permanently delete ${selectedExamIds.length} examination batch(es) and all ${selectedBatchScoreTotal} linked score(s).`
                      : `This will permanently delete ${selectedScoreIds.length} selected score row(s).`}{' '}
                    Affected {cycleLabel} and Session Report Cards will automatically be removed or recalculated.
                  </p>
                  {actionScope === 'EXAMS' && selectedBatchSummaries.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {selectedBatchSummaries.slice(0, 3).map((b) => (
                        <div key={b.examination_id} className="text-[11px] text-rose-900 font-medium">
                          Deleting: <strong>{b.title}</strong> · {b.class_name || `All ${classLabel}es`} ·{' '}
                          {b.session_name || '—'} · {b.term_name || '—'} ({b.scores_count} scores)
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setActionMode(null)}
                  className="p-1.5 text-rose-600 hover:text-rose-900 cursor-pointer shrink-0"
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
                    className="w-full px-3 py-2.5 bg-white border border-rose-300 rounded-lg text-slate-900 text-sm sm:text-xs"
                  />
                </div>
                <label className="flex items-center gap-2.5 text-rose-900 font-medium sm:pt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alsoDeleteRegistrations}
                    onChange={(e) => setAlsoDeleteRegistrations(e.target.checked)}
                    className="w-4 h-4 rounded border-rose-300 text-rose-600 shrink-0"
                  />
                  <span>Also remove linked {subjectLabel.toLowerCase()} registrations &amp; empty backlog markers</span>
                </label>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setActionMode(null)}
                  className="w-full sm:w-auto px-4 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleConfirmDelete}
                  className="w-full sm:w-auto px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  <span>{saving ? 'Deleting...' : 'Confirm Permanent Bulk Delete'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Mode Tabs + Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="grid grid-cols-2 sm:inline-flex p-1 bg-slate-100 rounded-xl w-full sm:w-auto gap-1">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('BATCHES');
                  setActionMode(null);
                }}
                className={`px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'BATCHES' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Uploaded Batches ({batches.length})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('SCORES');
                  setActionMode(null);
                }}
                className={`px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeTab === 'SCORES' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Individual Scores ({scores.length})</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeTab === 'BATCHES' && selectedExamIds.length > 0 && !actionMode && (
                <>
                  <button
                    type="button"
                    onClick={() => openReassignFor('EXAMS')}
                    className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Fix {classLabel} ({selectedExamIds.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeleteFor('EXAMS')}
                    className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
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
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : `Save ${modifiedCount} Score Edit${modifiedCount > 1 ? 's' : ''}`}</span>
                </button>
              )}

              {activeTab === 'SCORES' && selectedScoreIds.length > 0 && !actionMode && (
                <>
                  <button
                    type="button"
                    onClick={() => openReassignFor('SCORES')}
                    className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Reassign ({selectedScoreIds.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeleteFor('SCORES')}
                    className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Bulk Delete ({selectedScoreIds.length})</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={`px-3 py-2 border rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                  showFilters || activeFilterCount > 0
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
              </button>

              <button
                type="button"
                onClick={() => loadData({ refreshAllBatches: true })}
                className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Collapsible Filter Bar (only for searching/filtering the list below, never confused with Reassign) */}
          {showFilters && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-700">
                  Filter List Below (use “Fix {classLabel}” on a batch to change its assigned {classLabel.toLowerCase()})
                </span>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="text-emerald-700 hover:text-emerald-800 font-semibold cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
                <select
                  aria-label="Filter by Session"
                  value={filterSessionId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFilterSessionId(v);
                    setFilterTermId('');
                    loadData({
                      academic_session_id: v || undefined,
                      term_id: undefined,
                      class_id: filterClassId || undefined,
                      subject_id: filterSubjectId || undefined,
                      examination_id: filterExamId || undefined,
                      search: searchQuery.trim() || undefined,
                    });
                  }}
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
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
                    loadData({
                      academic_session_id: filterSessionId || undefined,
                      term_id: v || undefined,
                      class_id: filterClassId || undefined,
                      subject_id: filterSubjectId || undefined,
                      examination_id: filterExamId || undefined,
                      search: searchQuery.trim() || undefined,
                    });
                  }}
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
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
                    loadData({
                      academic_session_id: filterSessionId || undefined,
                      term_id: filterTermId || undefined,
                      class_id: v || undefined,
                      subject_id: filterSubjectId || undefined,
                      examination_id: filterExamId || undefined,
                      search: searchQuery.trim() || undefined,
                    });
                  }}
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
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
                    loadData({
                      academic_session_id: filterSessionId || undefined,
                      term_id: filterTermId || undefined,
                      class_id: filterClassId || undefined,
                      subject_id: v || undefined,
                      examination_id: filterExamId || undefined,
                      search: searchQuery.trim() || undefined,
                    });
                  }}
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
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
                    loadData({
                      academic_session_id: filterSessionId || undefined,
                      term_id: filterTermId || undefined,
                      class_id: filterClassId || undefined,
                      subject_id: filterSubjectId || undefined,
                      examination_id: v || undefined,
                      search: searchQuery.trim() || undefined,
                    });
                  }}
                  className="px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">All Batches / Exams</option>
                  {batchLookupPool.map((b) => (
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
                      if (e.key === 'Enter') {
                        loadData({
                          academic_session_id: filterSessionId || undefined,
                          term_id: filterTermId || undefined,
                          class_id: filterClassId || undefined,
                          subject_id: filterSubjectId || undefined,
                          examination_id: filterExamId || undefined,
                          search: searchQuery.trim() || undefined,
                        });
                      }
                    }}
                    placeholder={`Search ${learnerLabel.toLowerCase()} or ${subjectLabel.toLowerCase()}...`}
                    className="w-full pl-8 pr-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Active Data View */}
          {loading && batches.length === 0 && scores.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>Loading uploaded results...</span>
            </div>
          ) : activeTab === 'BATCHES' ? (
            batches.length === 0 ? (
              <div className="py-10 px-4 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl space-y-2">
                <p>No uploaded result batches match your current filter.</p>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="px-3.5 py-2 bg-slate-900 text-white rounded-lg font-semibold cursor-pointer"
                  >
                    Show All Batches
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Mobile Card List (< 640px) */}
                <div className="sm:hidden space-y-2.5">
                  {batches.map((b) => {
                    const checked = selectedExamIds.includes(b.examination_id);
                    return (
                      <div
                        key={b.examination_id}
                        className={`p-3.5 rounded-xl border ${
                          checked ? 'border-emerald-400 bg-emerald-50/40' : 'border-slate-200 bg-white'
                        } space-y-2.5 text-xs`}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Select ${b.title}`}
                            checked={checked}
                            onChange={() => toggleExam(b.examination_id)}
                            className="w-4 h-4 mt-0.5 rounded border-slate-300 text-emerald-600 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-slate-900 leading-snug">{b.title}</div>
                            <div className="text-[11px] text-slate-600 mt-0.5">
                              {b.session_name || '—'} · {b.term_name || '—'} · <strong className="text-slate-900">{b.class_name || `All ${classLabel}es`}</strong>
                              {b.department ? ` · ${b.department}` : ''}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                              {b.scores_count} score(s) · {b.students_count} {learnerLabel.toLowerCase()}(s) · {b.status}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setFilterExamId(b.examination_id);
                              setActiveTab('SCORES');
                              loadData({ examination_id: b.examination_id });
                            }}
                            className="py-2 px-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 rounded-lg font-semibold text-center cursor-pointer"
                          >
                            Edit Scores
                          </button>
                          <button
                            type="button"
                            onClick={() => openReassignFor('EXAMS', b.examination_id)}
                            className="py-2 px-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold text-center cursor-pointer"
                          >
                            Fix {classLabel}
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteFor('EXAMS', b.examination_id)}
                            className="py-2 px-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-lg font-semibold text-center cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Table (>= 640px) */}
                <div className="hidden sm:block overflow-x-auto border border-slate-200 rounded-xl">
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
                                  className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-md font-semibold cursor-pointer"
                                >
                                  Edit Scores
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openReassignFor('EXAMS', b.examination_id)}
                                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold cursor-pointer"
                                >
                                  Fix {classLabel}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openDeleteFor('EXAMS', b.examination_id)}
                                  className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-md font-semibold cursor-pointer"
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
              </>
            )
          ) : (
            <div className="space-y-3">
              {modifiedCount > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-amber-900 tabular-nums">
                    {modifiedCount} unsaved score edit(s) pending.
                  </span>
                  <div className="flex flex-wrap items-center gap-2 flex-1 sm:max-w-md justify-end">
                    <input
                      type="text"
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      placeholder="Correction reason (logged to audit)"
                      className="flex-1 min-w-[160px] px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setEditedScores({})}
                      className="px-2.5 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg font-semibold cursor-pointer"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSaveScoreEdits}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Edits'}
                    </button>
                  </div>
                </div>
              )}

              {scores.length === 0 ? (
                <div className="py-10 px-4 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl space-y-2">
                  <p>No individual score rows match your current filter.</p>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="px-3.5 py-2 bg-slate-900 text-white rounded-lg font-semibold cursor-pointer"
                    >
                      Show All Scores
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Mobile Score Cards (< 640px) */}
                  <div className="sm:hidden space-y-2.5">
                    {scores.map((row) => {
                      const checked = selectedScoreIds.includes(row.id);
                      const isDirty = Boolean(editedScores[row.id]);
                      const d = getDraft(row);
                      return (
                        <div
                          key={row.id}
                          className={`p-3 rounded-xl border text-xs space-y-2 ${
                            isDirty
                              ? 'border-amber-300 bg-amber-50/50'
                              : checked
                              ? 'border-emerald-400 bg-emerald-50/40'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              aria-label={`Select score for ${row.student_name} ${row.subject_name}`}
                              checked={checked}
                              onChange={() => toggleScore(row.id)}
                              className="w-4 h-4 mt-0.5 rounded border-slate-300 text-emerald-600 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-slate-900">
                                {row.student_name}{' '}
                                <span className="font-mono font-normal text-slate-500">
                                  {row.admission_number || ''}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-600">
                                {row.subject_name} · {row.session_name || '—'} · {row.term_name || '—'} · <strong>{row.class_name || '—'}</strong>
                              </div>
                            </div>
                            <span className="font-mono font-bold text-slate-800">{row.grade || '—'}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">CA</label>
                              <input
                                type="number"
                                step="0.5"
                                min={0}
                                max={row.total_max_score || 100}
                                aria-label={`Mobile CA score for ${row.student_name} ${row.subject_name}`}
                                value={d.ca_score}
                                onChange={(e) => updateScoreDraft(row, 'ca_score', e.target.value)}
                                className="w-full px-2 py-1.5 text-right font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Exam</label>
                              <input
                                type="number"
                                step="0.5"
                                min={0}
                                max={row.total_max_score || 100}
                                aria-label={`Mobile Exam score for ${row.student_name} ${row.subject_name}`}
                                value={d.exam_score}
                                onChange={(e) => updateScoreDraft(row, 'exam_score', e.target.value)}
                                className="w-full px-2 py-1.5 text-right font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Total</label>
                              <input
                                type="number"
                                step="0.5"
                                min={0}
                                max={row.total_max_score || 100}
                                aria-label={`Mobile Total score for ${row.student_name} ${row.subject_name}`}
                                value={d.total_score}
                                onChange={(e) => updateScoreDraft(row, 'total_score', e.target.value)}
                                className="w-full px-2 py-1.5 text-right font-mono tabular-nums font-bold bg-slate-50 border border-slate-300 rounded-lg"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop Spreadsheet Table (>= 640px) */}
                  <div className="hidden sm:block overflow-x-auto border border-slate-200 rounded-xl">
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
                </>
              )}
            </div>
          )}
        </div>

        {/* Compact Sticky Footer */}
        <div className="shrink-0 px-4 sm:px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="hidden sm:inline">
            Every correction, reassignment, and bulk deletion is recorded in the School Audit Log and automatically syncs Report Cards.
          </span>
          <span className="sm:hidden font-medium text-slate-600 tabular-nums">
            {batches.length} batch(es) · {scores.length} score(s)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-lg font-semibold cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
