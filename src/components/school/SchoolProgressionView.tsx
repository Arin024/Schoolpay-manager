import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  CheckCircle2,
  AlertTriangle,
  GraduationCap,
  History,
  RotateCcw,
  Search,
  FileText,
  Loader2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { resolveInstitutionProfile } from '../../utils/institutionMode.js';
import { PrintableCareerTranscriptModal } from '../performance/PrintableCareerTranscriptModal.js';
import { HistoricalBacklogImportModal } from '../performance/HistoricalBacklogImportModal.js';

type ProgressionSubTab = 'promote' | 'transcripts' | 'batches' | 'alumni';
type DecisionAction = 'PROMOTE' | 'RETAIN' | 'PROBATION' | 'GRADUATE' | 'SKIP';

const formatNaira = (kobo: number) =>
  `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const SchoolProgressionView: React.FC = () => {
  const { activeSchool, activeSettings } = useAuth();
  const instProfile = resolveInstitutionProfile(activeSchool, activeSettings);
  const { labels, isTertiary, gradingMode } = instProfile;
  const isGpaMode = gradingMode === 'GPA_5' || gradingMode === 'GPA_4';

  const [subTab, setSubTab] = useState<ProgressionSubTab>('promote');
  const [loadingInit, setLoadingInit] = useState(true);
  const [classes, setClasses] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);

  // Tab 1: Promotion / Graduation Wizard State
  const [fromSessionId, setFromSessionId] = useState('');
  const [toSessionId, setToSessionId] = useState('');
  const [fromClassId, setFromClassId] = useState('');
  const [toClassId, setToClassId] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [decisions, setDecisions] = useState<Record<string, DecisionAction>>({});
  const [executing, setExecuting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Tab 2: Career Transcripts State
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [publishedTranscripts, setPublishedTranscripts] = useState<any[]>([]);
  const [compilingStudentId, setCompilingStudentId] = useState<string | null>(null);
  const [activeTranscript, setActiveTranscript] = useState<any | null>(null);

  // Tab 3: Progression Batches & Rollback State
  const [batches, setBatches] = useState<any[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [confirmRollbackId, setConfirmRollbackId] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  // Tab 4: Alumni Registry State
  const [alumni, setAlumni] = useState<any[]>([]);
  const [alumniLoading, setAlumniLoading] = useState(false);
  const [alumniSearch, setAlumniSearch] = useState('');
  const [backlogModalOpen, setBacklogModalOpen] = useState(false);

  const loadReferenceData = useCallback(async () => {
    setLoadingInit(true);
    try {
      const [clsRes, sesRes, stuRes, ctRes] = await Promise.all([
        api.getSchoolClasses(),
        api.getSchoolAcademicSessions(),
        api.getSchoolStudents({ limit: 500 }),
        api.getCareerTranscripts().catch(() => ({ transcripts: [] })),
      ]);
      const clsList = clsRes.classes || [];
      const sesList = sesRes.sessions || [];
      setClasses(clsList);
      setSessions(sesList);
      setAllStudents(stuRes.students || []);
      setPublishedTranscripts(ctRes.transcripts || []);

      const activeSes = sesList.find((s: any) => s.status === 'ACTIVE' || Number(s.is_active) === 1) || sesList[0];
      if (activeSes && !fromSessionId) {
        setFromSessionId(activeSes.id);
        const otherSes = sesList.find((s: any) => s.id !== activeSes.id);
        setToSessionId(otherSes ? otherSes.id : activeSes.id);
      }
      if (clsList.length > 0 && !fromClassId) {
        setFromClassId(clsList[0].id);
      }
    } catch (err: any) {
      setBanner({ type: 'error', text: err?.message || 'Unable to load academic structure.' });
    } finally {
      setLoadingInit(false);
    }
  }, []);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  const loadPreview = useCallback(async (classId: string, sessionId: string) => {
    if (!classId) {
      setPreviewData(null);
      return;
    }
    setPreviewLoading(true);
    setBanner(null);
    try {
      const data = await api.getProgressionPreview({
        class_id: classId,
        from_session_id: sessionId || undefined,
      });
      setPreviewData(data);
      if (data.suggestion?.nextClass?.id) {
        setToClassId(data.suggestion.nextClass.id);
      } else {
        setToClassId('');
      }
      const nextDecs: Record<string, DecisionAction> = {};
      for (const s of data.students || []) {
        nextDecs[s.student_id] = s.recommended_decision || (data.suggestion?.isTerminalClass ? 'GRADUATE' : 'PROMOTE');
      }
      setDecisions(nextDecs);
    } catch (err: any) {
      setBanner({ type: 'error', text: err?.message || 'Failed to load progression preview.' });
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'promote' && fromClassId) {
      loadPreview(fromClassId, fromSessionId);
    }
  }, [subTab, fromClassId, fromSessionId, loadPreview]);

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true);
    try {
      const res = await api.getProgressionBatches();
      setBatches(res.batches || []);
    } catch (err: any) {
      setBanner({ type: 'error', text: err?.message || 'Failed to load progression history.' });
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  const loadAlumni = useCallback(async () => {
    setAlumniLoading(true);
    try {
      const res = await api.getAlumniRegistry();
      setAlumni(res.alumni || []);
    } catch (err: any) {
      setBanner({ type: 'error', text: err?.message || 'Failed to load graduated alumni registry.' });
    } finally {
      setAlumniLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'batches') loadBatches();
    if (subTab === 'alumni') loadAlumni();
  }, [subTab, loadBatches, loadAlumni]);

  const actionCounts = useMemo(() => {
    const vals = Object.values(decisions);
    return {
      promote: vals.filter((v) => v === 'PROMOTE').length,
      probation: vals.filter((v) => v === 'PROBATION').length,
      retain: vals.filter((v) => v === 'RETAIN').length,
      graduate: vals.filter((v) => v === 'GRADUATE').length,
      skip: vals.filter((v) => v === 'SKIP').length,
    };
  }, [decisions]);

  const handleBulkDecision = (action: DecisionAction) => {
    if (!previewData?.students) return;
    const updated: Record<string, DecisionAction> = {};
    for (const stu of previewData.students) {
      updated[stu.student_id] = action;
    }
    setDecisions(updated);
  };

  const handleApplyRecommended = () => {
    if (!previewData?.students) return;
    const updated: Record<string, DecisionAction> = {};
    for (const stu of previewData.students) {
      updated[stu.student_id] = stu.recommended_decision || 'PROMOTE';
    }
    setDecisions(updated);
  };

  const handleExecuteProgression = async () => {
    if (!previewData?.students || previewData.students.length === 0) return;
    const needsDestination = Object.values(decisions).some((a) => a === 'PROMOTE' || a === 'PROBATION');
    if (needsDestination && !toClassId) {
      setBanner({
        type: 'error',
        text: `Select a destination ${labels.classLabel.toLowerCase()} for promoted learners, or switch their action to Graduate / Retain.`,
      });
      return;
    }

    setExecuting(true);
    setBanner(null);
    try {
      const payloadDecisions = previewData.students.map((stu: any) => ({
        student_id: stu.student_id,
        action: decisions[stu.student_id] || 'SKIP',
        target_class_id: toClassId || null,
        target_arm_id: stu.suggested_target_arm_id || null,
        session_average: stu.session_average,
        session_gpa: stu.session_gpa,
        outstanding_balance_kobo: stu.outstanding_balance_kobo || 0,
      }));
      const res = await api.executeProgression({
        from_session_id: fromSessionId || null,
        to_session_id: toSessionId || null,
        from_class_id: fromClassId,
        to_class_id: toClassId || null,
        notes: batchNotes || undefined,
        decisions: payloadDecisions,
      });
      setBanner({ type: 'success', text: res.message });
      setBatchNotes('');
      await Promise.all([loadPreview(fromClassId, fromSessionId), loadReferenceData()]);
    } catch (err: any) {
      setBanner({ type: 'error', text: err?.message || 'Unable to execute progression batch.' });
    } finally {
      setExecuting(false);
    }
  };

  const handleRollback = async (batchId: string) => {
    setRollingBackId(batchId);
    setBanner(null);
    try {
      const res = await api.rollbackProgressionBatch(batchId);
      setBanner({ type: 'success', text: res.message });
      setConfirmRollbackId(null);
      await Promise.all([loadBatches(), loadReferenceData()]);
    } catch (err: any) {
      setBanner({ type: 'error', text: err?.message || 'Unable to roll back progression batch.' });
    } finally {
      setRollingBackId(null);
    }
  };

  const handleOpenCareerTranscript = async (studentId: string) => {
    setCompilingStudentId(studentId);
    setBanner(null);
    try {
      const res = await api.compileCareerTranscript(studentId);
      setActiveTranscript(res.transcript);
    } catch (err: any) {
      setBanner({ type: 'error', text: err?.message || 'Failed to compile career transcript.' });
    } finally {
      setCompilingStudentId(null);
    }
  };

  const handlePublishCareerTranscript = async (remarks: { registrar_remark: string; principal_remark: string }) => {
    if (!activeTranscript?.student_id) return;
    const res = await api.publishCareerTranscript(activeTranscript.student_id, remarks);
    setActiveTranscript(res.transcript);
    const ctRes = await api.getCareerTranscripts().catch(() => ({ transcripts: [] }));
    setPublishedTranscripts(ctRes.transcripts || []);
    if (subTab === 'alumni') loadAlumni();
  };

  const filteredStudentsForTranscripts = useMemo(() => {
    const q = transcriptSearch.trim().toLowerCase();
    return allStudents.filter((s) => {
      if (!q) return true;
      return (
        String(s.full_name || '').toLowerCase().includes(q) ||
        String(s.admission_number || '').toLowerCase().includes(q) ||
        String(s.class_name || '').toLowerCase().includes(q)
      );
    });
  }, [allStudents, transcriptSearch]);

  const publishedMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const ct of publishedTranscripts) {
      map.set(ct.student_id, ct);
    }
    return map;
  }, [publishedTranscripts]);

  const filteredAlumni = useMemo(() => {
    const q = alumniSearch.trim().toLowerCase();
    return alumni.filter((a) => {
      if (!q) return true;
      return (
        String(a.full_name || '').toLowerCase().includes(q) ||
        String(a.admission_number || '').toLowerCase().includes(q) ||
        String(a.graduation_session_name || '').toLowerCase().includes(q)
      );
    });
  }, [alumni, alumniSearch]);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {isTertiary ? 'Academic Progression, Graduation & Career Transcripts' : 'Student Promotion, Graduation & Career Transcripts'}
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Move cohorts across {labels.classPlural.toLowerCase()} and academic sessions with full historical record protection, one-click undo safety, and lifetime cumulative transcripts.
          </p>
        </div>

        {/* Right Controls: Historical Backlog Upload + Sub-Tab Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setBacklogModalOpen(true)}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <History className="w-3.5 h-3.5" />
            <span>Upload Previous Years / {labels.classPlural}</span>
          </button>
          <div className="inline-flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
          {[
            { id: 'promote', label: 'Promote & Graduate', icon: ArrowRight },
            { id: 'transcripts', label: 'Career Transcripts', icon: FileText },
            { id: 'batches', label: 'Ledger & Undo', icon: History },
            { id: 'alumni', label: 'Alumni Registry', icon: GraduationCap },
          ].map((t) => {
            const Icon = t.icon;
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id as ProgressionSubTab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  active ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            banner.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: PROMOTE & GRADUATE WIZARD */}
      {subTab === 'promote' && (
        <div className="space-y-5">
          {/* Historical Data Preservation Notice */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-start gap-3 text-xs text-slate-700">
            <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <p>
              <strong>Zero Historical Data Loss:</strong> Promoting, retaining, or graduating learners never alters their previous {labels.cycle.toLowerCase()} scores, report cards, fee invoices, or payment receipts. Unpaid prior balances remain payable, and alumni are automatically excluded from active bulk fee billing.
            </p>
          </div>

          {/* Selection Controls */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Completed Academic Session
                </label>
                <select
                  value={fromSessionId}
                  onChange={(e) => setFromSessionId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">All / No Specific Session</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.status === 'ACTIVE' || Number(s.is_active) === 1 ? '(Active)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Source {labels.classLabel} (Current)
                </label>
                <select
                  value={fromClassId}
                  onChange={(e) => setFromClassId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">Select {labels.classLabel}...</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  New Academic Session
                </label>
                <select
                  value={toSessionId}
                  onChange={(e) => setToSessionId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">Keep Current Session</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.status === 'ACTIVE' || Number(s.is_active) === 1 ? '(Active)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Destination {labels.classLabel} (Next)
                </label>
                <select
                  value={toClassId}
                  onChange={(e) => setToClassId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">Graduation / Terminal Cohort</option>
                  {classes
                    .filter((c) => c.id !== fromClassId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {previewData?.suggestion?.reason && (
              <p className="text-xs text-slate-600 border-t border-slate-100 pt-3">
                <strong className="text-slate-900">Smart Progression Recommendation:</strong> {previewData.suggestion.reason}
              </p>
            )}
          </div>

          {/* Preview Summary Strip & Table */}
          {loadingInit || previewLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Evaluating learner records, scores, carryovers, and fee balances...</span>
            </div>
          ) : !previewData || (previewData.students || []).length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-2">
              <Users className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">
                No active learners currently in {previewData?.sourceClass?.name || `this ${labels.classLabel.toLowerCase()}`}
              </p>
              <p className="text-xs text-slate-500">
                Select another {labels.classLabel.toLowerCase()} above, or check the Ledger &amp; Undo / Alumni Registry tabs if this cohort has already progressed.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Dry-Run Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/70 border-b border-slate-200 text-xs">
                <div className="p-3.5">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Active Cohort</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{previewData.totals?.total_students || 0}</p>
                </div>
                <div className="p-3.5">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">To Promote</p>
                  <p className="text-lg font-bold text-emerald-700 tabular-nums mt-0.5">{actionCounts.promote}</p>
                </div>
                <div className="p-3.5">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">To Graduate</p>
                  <p className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{actionCounts.graduate}</p>
                </div>
                <div className="p-3.5">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Retain / Probation</p>
                  <p className="text-lg font-bold text-amber-700 tabular-nums mt-0.5">{actionCounts.retain + actionCounts.probation}</p>
                </div>
                <div className="p-3.5">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">With Fee Arrears</p>
                  <p className="text-lg font-bold text-rose-700 tabular-nums mt-0.5">{previewData.totals?.with_arrears_count || 0}</p>
                </div>
              </div>

              {/* Quick Bulk Overrides */}
              <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-500 font-medium">Quick Set:</span>
                  <button
                    type="button"
                    onClick={handleApplyRecommended}
                    className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 font-medium cursor-pointer"
                  >
                    Apply Recommended
                  </button>
                  {toClassId && (
                    <button
                      type="button"
                      onClick={() => handleBulkDecision('PROMOTE')}
                      className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 font-medium cursor-pointer"
                    >
                      Promote All
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleBulkDecision('GRADUATE')}
                    className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 font-medium cursor-pointer"
                  >
                    Graduate All
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkDecision('SKIP')}
                    className="px-2.5 py-1 border border-slate-300 rounded-md text-slate-600 hover:bg-slate-50 font-medium cursor-pointer"
                  >
                    Skip All
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    placeholder="Optional batch note (e.g. Senate Approved)..."
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg w-60 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleExecuteProgression}
                    disabled={executing || actionCounts.promote + actionCounts.probation + actionCounts.retain + actionCounts.graduate === 0}
                    className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                    <span>Execute Progression</span>
                  </button>
                </div>
              </div>

              {/* Learner Evaluation Grid */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                      <th className="py-2.5 px-4 font-semibold">Learner</th>
                      <th className="py-2.5 px-3 font-semibold">{labels.studentId}</th>
                      <th className="py-2.5 px-3 font-semibold text-right">
                        {isGpaMode ? 'Session GPA / Avg' : 'Session Avg'}
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right">
                        {isTertiary ? 'Carryovers' : 'Failed Subjects'}
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right">Prior Arrears</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Progression Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {previewData.students.map((stu: any) => {
                      const decision = decisions[stu.student_id] || 'PROMOTE';
                      return (
                        <tr key={stu.student_id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4">
                            <p className="font-semibold text-slate-900">{stu.full_name}</p>
                            {stu.current_class_arm_name && (
                              <p className="text-[11px] text-slate-500">{stu.current_class_arm_name}</p>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600">{stu.admission_number || '—'}</td>
                          <td className="py-2.5 px-3 text-right">
                            {stu.graded_courses > 0 ? (
                              isGpaMode ? (
                                <span className="font-semibold text-slate-900">
                                  {stu.session_gpa !== null ? Number(stu.session_gpa).toFixed(2) : '—'} GPA
                                  <span className="text-slate-500 font-normal"> ({Number(stu.session_average || 0).toFixed(1)}%)</span>
                                </span>
                              ) : (
                                <span className="font-semibold text-slate-900">{Number(stu.session_average || 0).toFixed(1)}%</span>
                              )
                            ) : (
                              <span className="text-slate-400">No scores yet</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {stu.failed_courses_count > 0 ? (
                              <span className="font-semibold text-rose-700">{stu.failed_courses_count} failed</span>
                            ) : (
                              <span className="text-emerald-700">0</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {stu.outstanding_balance_kobo > 0 ? (
                              <span className="font-semibold text-amber-700">
                                {formatNaira(stu.outstanding_balance_kobo)}
                              </span>
                            ) : (
                              <span className="text-slate-500">Cleared</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <select
                              aria-label={`Progression decision for ${stu.full_name}`}
                              value={decision}
                              onChange={(e) =>
                                setDecisions((prev) => ({
                                  ...prev,
                                  [stu.student_id]: e.target.value as DecisionAction,
                                }))
                              }
                              className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                            >
                              <option value="PROMOTE">
                                Promote {toClassId ? `→ ${classes.find((c) => c.id === toClassId)?.name || 'Next'}` : '(Select Dest)'}
                              </option>
                              <option value="PROBATION">Promote on Probation</option>
                              <option value="RETAIN">Retain / Repeat {previewData.sourceClass?.name}</option>
                              <option value="GRADUATE">Graduate (Alumni)</option>
                              <option value="SKIP">Skip (No Change)</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MULTI-YEAR CAREER TRANSCRIPTS */}
      {subTab === 'transcripts' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Multi-Year Cumulative Career Transcripts</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Aggregates all sessions, {labels.classPlural.toLowerCase()}, {labels.cyclePlural.toLowerCase()}, and {labels.subjectPlural.toLowerCase()} into one official verifiable transcript (`CTR-...`).
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                placeholder="Search learner name, ID, or class..."
                className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                  <th className="py-2.5 px-4 font-semibold">Learner</th>
                  <th className="py-2.5 px-3 font-semibold">{labels.studentId}</th>
                  <th className="py-2.5 px-3 font-semibold">{labels.classLabel} &amp; Status</th>
                  <th className="py-2.5 px-3 font-semibold">Official Transcript</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {filteredStudentsForTranscripts.slice(0, 100).map((stu) => {
                  const published = publishedMap.get(stu.id);
                  const busy = compilingStudentId === stu.id;
                  return (
                    <tr key={stu.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{stu.full_name}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{stu.admission_number || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {stu.class_name || 'Unassigned'} ·{' '}
                        <span className={stu.student_status === 'GRADUATED' ? 'font-semibold text-emerald-700' : 'text-slate-500'}>
                          {stu.student_status || 'ACTIVE'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {published ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-emerald-700">{published.verification_code}</span>
                            <span className="text-slate-500">
                              {isGpaMode && published.lifetime_cgpa !== null
                                ? `${Number(published.lifetime_cgpa).toFixed(2)} CGPA`
                                : `${Number(published.lifetime_average || 0).toFixed(1)}%`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">Not yet published</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenCareerTranscript(stu.id)}
                          disabled={busy}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Award className="w-3.5 h-3.5 text-emerald-400" />}
                          <span>{published ? 'Open / Re-Publish' : 'Compile Transcript'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredStudentsForTranscripts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-400">
                      No matching learner records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: PROGRESSION LEDGER & UNDO ROLLBACK */}
      {subTab === 'batches' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">Progression Batch Audit &amp; Safe Undo</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Every bulk promotion or graduation is recorded atomically. If a cohort was moved by mistake, roll it back in one click without losing any scores or invoices.
            </p>
          </div>
          {batchesLoading ? (
            <div className="p-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading progression batches...</span>
            </div>
          ) : batches.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              No promotion or graduation batches have been executed yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                    <th className="py-2.5 px-4 font-semibold">Date</th>
                    <th className="py-2.5 px-3 font-semibold">Transition</th>
                    <th className="py-2.5 px-3 font-semibold">Breakdown</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Recovery Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {batches.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {b.executed_at ? new Date(b.executed_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-semibold text-slate-900">
                          {b.from_class_name || 'Source'} → {b.to_class_name || (b.graduated_count > 0 ? 'Graduated / Alumni' : 'Same Class')}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {b.from_session_name || 'Prior Session'} → {b.to_session_name || 'Current Session'}
                          {b.notes ? ` · ${b.notes}` : ''}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        Total <strong>{b.total_students}</strong>
                        {b.promoted_count > 0 ? ` · ${b.promoted_count} Promoted` : ''}
                        {b.graduated_count > 0 ? ` · ${b.graduated_count} Graduated` : ''}
                        {b.probation_count > 0 ? ` · ${b.probation_count} Probation` : ''}
                        {b.retained_count > 0 ? ` · ${b.retained_count} Retained` : ''}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`font-semibold ${
                            b.status === 'ROLLED_BACK' ? 'text-slate-500' : 'text-emerald-700'
                          }`}
                        >
                          {b.status === 'ROLLED_BACK' ? 'Rolled Back' : 'Applied'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {b.status === 'APPLIED' ? (
                          confirmRollbackId === b.id ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleRollback(b.id)}
                                disabled={rollingBackId === b.id}
                                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-md font-semibold cursor-pointer"
                              >
                                {rollingBackId === b.id ? 'Restoring...' : 'Confirm Undo'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRollbackId(null)}
                                className="px-2 py-1 border border-slate-300 rounded-md text-slate-600 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmRollbackId(b.id)}
                              className="px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Undo Batch</span>
                            </button>
                          )
                        ) : (
                          <span className="text-slate-400">Restored</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: ALUMNI / GRADUATED REGISTRY */}
      {subTab === 'alumni' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Graduated Alumni Registry</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Graduated learners keep permanent access to their historical receipts &amp; official career transcript, while being automatically excluded from active tuition bulk-billing.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={alumniSearch}
                onChange={(e) => setAlumniSearch(e.target.value)}
                placeholder="Search alumni..."
                className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          {alumniLoading ? (
            <div className="p-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading alumni registry...</span>
            </div>
          ) : filteredAlumni.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <GraduationCap className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">No graduated alumni recorded yet</p>
              <p className="text-xs text-slate-500">
                Use the &ldquo;Promote &amp; Graduate&rdquo; tab to graduate a final-year cohort into your permanent Alumni Registry.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                    <th className="py-2.5 px-4 font-semibold">Graduate</th>
                    <th className="py-2.5 px-3 font-semibold">{labels.studentId}</th>
                    <th className="py-2.5 px-3 font-semibold">Final {labels.classLabel} &amp; Set</th>
                    <th className="py-2.5 px-3 font-semibold">Final Standing</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Career Transcript</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredAlumni.map((al) => (
                    <tr key={al.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{al.full_name}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{al.admission_number || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {al.final_class_name || '—'} · {al.graduation_session_name || al.graduation_date || 'Graduated'}
                      </td>
                      <td className="py-2.5 px-3">
                        {al.final_standing ? (
                          <span className="font-semibold text-emerald-700">
                            {al.final_standing}
                            {isGpaMode && al.lifetime_cgpa !== null ? ` (${Number(al.lifetime_cgpa).toFixed(2)} CGPA)` : ''}
                          </span>
                        ) : (
                          <span className="text-slate-400">Compile to compute</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenCareerTranscript(al.id)}
                          disabled={compilingStudentId === al.id}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{al.verification_code ? `Open (${al.verification_code})` : 'Generate Final Transcript'}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTranscript && (
        <PrintableCareerTranscriptModal
          transcript={activeTranscript}
          onClose={() => setActiveTranscript(null)}
          canPublish
          onPublish={handlePublishCareerTranscript}
        />
      )}

      {backlogModalOpen && (
        <HistoricalBacklogImportModal
          students={allStudents}
          isTertiary={isTertiary}
          subjectLabel={labels.subject}
          subjectPlural={labels.subjectPlural}
          classLabel={labels.classLabel}
          cycleLabel={labels.cycle}
          learnerLabel={isTertiary ? 'Student' : 'Learner'}
          onClose={() => setBacklogModalOpen(false)}
          onImported={async (msg) => {
            setBacklogModalOpen(false);
            setBanner({ type: 'success', text: msg });
            await loadReferenceData();
          }}
        />
      )}
    </div>
  );
};
