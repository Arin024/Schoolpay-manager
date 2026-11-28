import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Plus,
  Clock,
  AlertCircle,
  CheckCircle2,
  Edit3,
  Trash2,
  X,
  BookOpen,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { AcademicSessionItem, SessionStatus, TermItem } from '../../types/index.js';
import { resolveInstitutionProfile } from '../../utils/institutionMode.js';
import { ModalPortal } from '../common/ModalPortal.js';

interface SchoolAcademicSessionsViewProps {
  onNavigateProgression?: () => void;
}

function deriveDatesFromSessionName(name: string): { start: string; end: string } | null {
  const m = String(name || '').trim().match(/^(\d{4})\s*[/\-]\s*(\d{4})$/);
  if (!m) return null;
  const y1 = parseInt(m[1], 10);
  const y2 = parseInt(m[2], 10);
  if (!Number.isFinite(y1) || !Number.isFinite(y2) || y1 < 1990 || y1 > 2100) return null;
  return { start: `${y1}-09-01`, end: `${y2}-07-31` };
}

function normalizeDateInput(val?: string | null): string {
  if (!val) return '';
  const str = String(val).trim();
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : '';
}

export const SchoolAcademicSessionsView: React.FC<SchoolAcademicSessionsViewProps> = ({
  onNavigateProgression,
}) => {
  const { activeSchool, activeSettings, refreshMe } = useAuth();
  const profile = resolveInstitutionProfile(activeSchool, activeSettings);
  const { labels, cycleType, cycleLabels } = profile;

  const [sessions, setSessions] = useState<AcademicSessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Session Create / Edit Modal
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<AcademicSessionItem | null>(null);

  // Term Create / Edit Modal
  const [isTermModalOpen, setIsTermModalOpen] = useState(false);
  const [selectedSessionForTerm, setSelectedSessionForTerm] = useState<AcademicSessionItem | null>(null);
  const [editingTerm, setEditingTerm] = useState<TermItem | null>(null);

  // Inline delete confirmation (never uses window.confirm)
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);
  const [confirmDeleteTermId, setConfirmDeleteTermId] = useState<string | null>(null);

  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentStartYear = currentMonth >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const currentEndYear = currentStartYear + 1;
  const defaultSessionName = `${currentStartYear}/${currentEndYear}`;

  const defaultCycleName =
    cycleLabels[0] ||
    (cycleType === 'SEMESTER'
      ? '1st Semester'
      : cycleType === 'TRIMESTER'
        ? '1st Trimester'
        : currentMonth >= 1 && currentMonth <= 4
          ? 'Second Term'
          : currentMonth >= 5 && currentMonth <= 8
            ? 'Third Term'
            : 'First Term');

  // Session Form states
  const [sessionName, setSessionName] = useState(defaultSessionName);
  const [sessionStart, setSessionStart] = useState(`${currentStartYear}-09-01`);
  const [sessionEnd, setSessionEnd] = useState(`${currentEndYear}-07-31`);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('ACTIVE');
  const [autoCreateTerms, setAutoCreateTerms] = useState(true);
  const [datesManuallyEdited, setDatesManuallyEdited] = useState(false);

  // Term Form states
  const [termName, setTermName] = useState(defaultCycleName);
  const [customTermName, setCustomTermName] = useState('');
  const [termStart, setTermStart] = useState(`${currentStartYear}-09-09`);
  const [termEnd, setTermEnd] = useState(`${currentStartYear}-12-18`);
  const [termStatus, setTermStatus] = useState<SessionStatus>('ACTIVE');

  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [seedingTermsId, setSeedingTermsId] = useState<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  useEffect(() => {
    setTermName(defaultCycleName);
  }, [defaultCycleName]);

  useEffect(() => {
    loadSessions();
  }, [activeSchool?.id]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const res = await api.getSchoolAcademicSessions();
      setSessions(res.sessions || []);
    } catch (err) {
      console.error('Failed to load academic sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  // Deduplicated options for modal dropdown
  const cycleNameOptions = Array.from(
    new Set([
      ...cycleLabels,
      ...(cycleType === 'SEMESTER'
        ? ['1st Semester', '2nd Semester', 'Harmattan Semester', 'Rain Semester', 'Summer Semester']
        : cycleType === 'TRIMESTER'
          ? ['1st Trimester', '2nd Trimester', '3rd Trimester']
          : ['First Term', 'Second Term', 'Third Term', '1st Term', '2nd Term', '3rd Term', '1st Semester', '2nd Semester']),
    ])
  );

  const openCreateSessionModal = () => {
    setEditingSession(null);
    setSessionName(defaultSessionName);
    setSessionStart(`${currentStartYear}-09-01`);
    setSessionEnd(`${currentEndYear}-07-31`);
    setSessionStatus(sessions.length === 0 ? 'ACTIVE' : 'UPCOMING');
    setAutoCreateTerms(true);
    setDatesManuallyEdited(false);
    setFormError(null);
    setIsSessionModalOpen(true);
  };

  const openEditSessionModal = (sess: AcademicSessionItem) => {
    setEditingSession(sess);
    setSessionName(sess.name || '');
    const derived = deriveDatesFromSessionName(sess.name || '');
    setSessionStart(normalizeDateInput(sess.start_date) || derived?.start || '');
    setSessionEnd(normalizeDateInput(sess.end_date) || derived?.end || '');
    setSessionStatus((sess.status as SessionStatus) || 'UPCOMING');
    setDatesManuallyEdited(false);
    setFormError(null);
    setIsSessionModalOpen(true);
  };

  const openCreateTermModal = (sess: AcademicSessionItem) => {
    setSelectedSessionForTerm(sess);
    setEditingTerm(null);
    const yrMatch = String(sess.name || '').match(/^(\d{4})/);
    const y1 = yrMatch ? parseInt(yrMatch[1], 10) : currentStartYear;
    const existingLower = new Set((sess.terms || []).map((t) => t.name.trim().toLowerCase()));
    const nextSuggested = cycleNameOptions.find((opt) => !existingLower.has(opt.toLowerCase())) || cycleNameOptions[0] || defaultCycleName;
    setTermName(nextSuggested);
    setCustomTermName('');
    setTermStart(`${y1}-09-09`);
    setTermEnd(`${y1}-12-18`);
    setTermStatus((sess.terms || []).length === 0 && sess.status === 'ACTIVE' ? 'ACTIVE' : 'UPCOMING');
    setFormError(null);
    setIsTermModalOpen(true);
  };

  const openEditTermModal = (sess: AcademicSessionItem, term: TermItem) => {
    setSelectedSessionForTerm(sess);
    setEditingTerm(term);
    if (cycleNameOptions.includes(term.name)) {
      setTermName(term.name);
      setCustomTermName('');
    } else {
      setTermName('__CUSTOM__');
      setCustomTermName(term.name);
    }
    setTermStart(normalizeDateInput(term.start_date));
    setTermEnd(normalizeDateInput(term.end_date));
    setTermStatus((term.status as SessionStatus) || 'UPCOMING');
    setFormError(null);
    setIsTermModalOpen(true);
  };

  const handleSessionNameChange = (val: string) => {
    setSessionName(val);
    if (!datesManuallyEdited) {
      const derived = deriveDatesFromSessionName(val);
      if (derived) {
        setSessionStart(derived.start);
        setSessionEnd(derived.end);
      }
    }
  };

  const handleSubmitSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = sessionName.trim();
    if (!trimmed) {
      setFormError('Please enter an academic session name (e.g. 2027/2028 or 2035/2036).');
      return;
    }
    setFormSubmitting(true);
    setFormError(null);

    try {
      if (editingSession) {
        const res = await api.updateAcademicSession(editingSession.id, {
          name: trimmed,
          start_date: sessionStart || null,
          end_date: sessionEnd || null,
          status: sessionStatus,
        });
        setFeedbackMsg(res.message || `Updated academic session to "${trimmed}".`);
      } else {
        const res = await api.createAcademicSession({
          name: trimmed,
          start_date: sessionStart || undefined,
          end_date: sessionEnd || undefined,
          status: sessionStatus,
          auto_create_terms: autoCreateTerms,
        });
        setFeedbackMsg(res.message || `Created academic session "${trimmed}".`);
      }
      setIsSessionModalOpen(false);
      setEditingSession(null);
      await loadSessions();
      await refreshMe().catch(() => {});
    } catch (err: any) {
      setFormError(err?.message || (editingSession ? 'Failed to update academic session' : 'Failed to create academic session'));
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleActivateSession = async (sess: AcademicSessionItem) => {
    setBusyActionId(sess.id);
    setFormError(null);
    try {
      const res = await api.updateAcademicSession(sess.id, { status: 'ACTIVE' });
      setFeedbackMsg(res.message || `Set "${sess.name}" as the active academic session.`);
      await loadSessions();
      await refreshMe().catch(() => {});
    } catch (err: any) {
      setFormError(err?.message || 'Failed to activate academic session');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDeleteSession = async (sess: AcademicSessionItem) => {
    setBusyActionId(sess.id);
    setFormError(null);
    try {
      const res = await api.deleteAcademicSession(sess.id);
      setConfirmDeleteSessionId(null);
      setFeedbackMsg(res.message || `Deleted academic session "${sess.name}".`);
      await loadSessions();
      await refreshMe().catch(() => {});
    } catch (err: any) {
      setConfirmDeleteSessionId(null);
      setFormError(err?.message || 'Failed to delete academic session');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSubmitTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionForTerm) return;
    const finalName = termName === '__CUSTOM__' ? customTermName.trim() : termName;
    if (!finalName) {
      setFormError(`Please enter a ${labels.cycle.toLowerCase()} name.`);
      return;
    }
    setFormSubmitting(true);
    setFormError(null);

    try {
      if (editingTerm) {
        const res = await api.updateTerm(selectedSessionForTerm.id, editingTerm.id, {
          name: finalName,
          start_date: termStart || null,
          end_date: termEnd || null,
          status: termStatus,
        });
        setFeedbackMsg(res.message || `Updated ${labels.cycle.toLowerCase()} to "${finalName}".`);
      } else {
        const res = await api.createTerm(selectedSessionForTerm.id, {
          name: finalName,
          start_date: termStart || undefined,
          end_date: termEnd || undefined,
          status: termStatus,
        });
        setFeedbackMsg(res.message || `Added "${finalName}" to ${selectedSessionForTerm.name}.`);
      }
      setIsTermModalOpen(false);
      setSelectedSessionForTerm(null);
      setEditingTerm(null);
      setCustomTermName('');
      await loadSessions();
      await refreshMe().catch(() => {});
    } catch (err: any) {
      setFormError(err?.message || `Failed to save ${labels.cycle.toLowerCase()}`);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleActivateTerm = async (sess: AcademicSessionItem, term: TermItem) => {
    setBusyActionId(term.id);
    setFormError(null);
    try {
      await api.updateTerm(sess.id, term.id, { status: 'ACTIVE' });
      setFeedbackMsg(`Set "${term.name}" (${sess.name}) as active.`);
      await loadSessions();
      await refreshMe().catch(() => {});
    } catch (err: any) {
      setFormError(err?.message || `Failed to activate ${labels.cycle.toLowerCase()}`);
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDeleteTerm = async (sess: AcademicSessionItem, term: TermItem) => {
    setBusyActionId(term.id);
    setFormError(null);
    try {
      const res = await api.deleteTerm(sess.id, term.id);
      setConfirmDeleteTermId(null);
      setFeedbackMsg(res.message || `Deleted "${term.name}".`);
      await loadSessions();
      await refreshMe().catch(() => {});
    } catch (err: any) {
      setConfirmDeleteTermId(null);
      setFormError(err?.message || `Failed to delete ${labels.cycle.toLowerCase()}`);
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSeedAcademicCycles = async (sess: AcademicSessionItem) => {
    setSeedingTermsId(sess.id);
    setFormError(null);
    try {
      const yearMatch = String(sess.name || '').match(/^(\d{4})/);
      const y1 = yearMatch ? parseInt(yearMatch[1], 10) : currentStartYear;
      const y2 = y1 + 1;
      const existingNames = new Set((sess.terms || []).map((t) => t.name.trim().toLowerCase()));

      let templates: Array<{ name: string; start_date: string; end_date: string; status: SessionStatus }>;

      if (cycleType === 'SEMESTER') {
        const firstLabel = cycleLabels[0] || '1st Semester';
        const secondLabel = cycleLabels[1] || '2nd Semester';
        templates = [
          {
            name: firstLabel,
            start_date: `${y1}-10-01`,
            end_date: `${y2}-02-28`,
            status: sess.status === 'ACTIVE' ? 'ACTIVE' : sess.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING',
          },
          {
            name: secondLabel,
            start_date: `${y2}-03-15`,
            end_date: `${y2}-07-31`,
            status: sess.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING',
          },
        ];
        if (cycleLabels[2]) {
          templates.push({
            name: cycleLabels[2],
            start_date: `${y2}-08-05`,
            end_date: `${y2}-09-20`,
            status: sess.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING',
          });
        }
      } else if (cycleType === 'TRIMESTER') {
        templates = [
          { name: cycleLabels[0] || '1st Trimester', start_date: `${y1}-09-09`, end_date: `${y1}-12-18`, status: sess.status === 'ACTIVE' ? 'ACTIVE' : sess.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING' },
          { name: cycleLabels[1] || '2nd Trimester', start_date: `${y2}-01-12`, end_date: `${y2}-04-10`, status: sess.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING' },
          { name: cycleLabels[2] || '3rd Trimester', start_date: `${y2}-04-27`, end_date: `${y2}-07-24`, status: sess.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING' },
        ];
      } else {
        templates = [
          { name: 'First Term', start_date: `${y1}-09-09`, end_date: `${y1}-12-18`, status: sess.status === 'ACTIVE' ? 'ACTIVE' : sess.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING' },
          { name: 'Second Term', start_date: `${y2}-01-12`, end_date: `${y2}-04-10`, status: sess.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING' },
          { name: 'Third Term', start_date: `${y2}-04-27`, end_date: `${y2}-07-24`, status: sess.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING' },
        ];
      }

      for (const tpl of templates) {
        if (existingNames.has(tpl.name.toLowerCase())) continue;
        await api.createTerm(sess.id, tpl);
      }
      setFeedbackMsg(`Configured ${labels.cyclePlural.toLowerCase()} for ${sess.name}.`);
      await loadSessions();
    } catch (err: any) {
      setFormError(err?.message || `Failed to setup ${labels.cyclePlural.toLowerCase()}`);
    } finally {
      setSeedingTermsId(null);
    }
  };

  const expectedCycleCount = cycleType === 'SEMESTER' ? Math.max(2, cycleLabels.length) : 3;
  const seedButtonLabel =
    cycleType === 'SEMESTER'
      ? `Setup ${cycleLabels.slice(0, 2).join(' & ')}`
      : cycleType === 'TRIMESTER'
        ? 'Setup 3 Trimesters'
        : 'Setup 3 Nigerian Terms';

  return (
    <div className="space-y-6">
      {formError && !isSessionModalOpen && !isTermModalOpen && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{formError}</span>
          </span>
          <button type="button" onClick={() => setFormError(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {feedbackMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackMsg}</span>
          </span>
          <button type="button" onClick={() => setFeedbackMsg(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-600" />
            <span>Academic Sessions &amp; {labels.cyclePlural}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Create, edit, or rename any academic calendar year (e.g. {defaultSessionName}, 2027/2028, 2035/2036) and {labels.cycle.toLowerCase()} schedules ({cycleLabels.join(', ')}) for{' '}
            <strong className="text-slate-700">{activeSchool?.name}</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {onNavigateProgression && (
            <button
              type="button"
              onClick={onNavigateProgression}
              className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-900 border border-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span>Promote / Graduate</span>
            </button>
          )}
          <button
            type="button"
            onClick={openCreateSessionModal}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Academic Session</span>
          </button>
        </div>
      </div>

      {/* Sessions Grid */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-xs text-slate-400 shadow-sm">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin mx-auto mb-2" />
          <span>Loading academic calendar...</span>
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center space-y-3 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <Calendar className="w-6 h-6" />
          </div>
          <p className="text-xs font-semibold text-slate-700">No academic sessions found for this {labels.institution.toLowerCase()}.</p>
          <button
            type="button"
            onClick={openCreateSessionModal}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Create Initial Academic Session (e.g. {defaultSessionName})
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map((sess) => (
            <div
              key={sess.id}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 sm:p-6 space-y-4 hover:border-emerald-300 transition"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-black text-sm shrink-0">
                    {sess.name.slice(0, 4)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-slate-900">{sess.name} Session</h3>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          sess.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-300'
                        }`}
                      >
                        {sess.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Period: {normalizeDateInput(sess.start_date) || 'TBD'} to {normalizeDateInput(sess.end_date) || 'TBD'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                  {sess.status !== 'ACTIVE' && (
                    <button
                      type="button"
                      disabled={busyActionId === sess.id}
                      onClick={() => handleActivateSession(sess)}
                      className="px-2.5 py-1.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-60"
                    >
                      Set Active
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openEditSessionModal(sess)}
                    aria-label={`Edit session ${sess.name}`}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-xl text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                    <span>Edit Session</span>
                  </button>
                  {(!sess.terms || sess.terms.length < expectedCycleCount) && (
                    <button
                      type="button"
                      disabled={seedingTermsId === sess.id}
                      onClick={() => handleSeedAcademicCycles(sess)}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-60"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{seedingTermsId === sess.id ? `Adding ${labels.cyclePlural}...` : seedButtonLabel}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openCreateTermModal(sess)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Add {labels.cycle}</span>
                  </button>
                  {confirmDeleteSessionId === sess.id ? (
                    <div className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-xl text-[11px]">
                      <span className="font-semibold text-rose-800">Delete?</span>
                      <button
                        type="button"
                        disabled={busyActionId === sess.id}
                        onClick={() => handleDeleteSession(sess)}
                        className="px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-60"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSessionId(null)}
                        className="px-2 py-0.5 rounded-lg bg-white border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSessionId(sess.id)}
                      aria-label={`Delete session ${sess.name}`}
                      className="p-1.5 bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-200 hover:border-rose-200 rounded-xl cursor-pointer"
                      title="Delete unused session"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Terms / Semesters inside Session */}
              <div className="pt-3 border-t border-slate-100">
                <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Academic {labels.cyclePlural} ({sess.terms?.length || 0})
                </h4>

                {!sess.terms || sess.terms.length === 0 ? (
                  <p className="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-xl border border-dashed border-slate-200">
                    No {labels.cyclePlural.toLowerCase()} configured yet. Click &ldquo;{seedButtonLabel}&rdquo; or &ldquo;Add {labels.cycle}&rdquo; above.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sess.terms.map((t) => (
                      <div
                        key={t.id}
                        className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-900 text-xs truncate">{t.name}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                              t.status === 'ACTIVE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {t.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {normalizeDateInput(t.start_date) || 'Start TBD'} – {normalizeDateInput(t.end_date) || 'End TBD'}
                        </p>
                        <div className="pt-1.5 border-t border-slate-200/70 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditTermModal(sess, t)}
                            aria-label={`Edit ${t.name} in ${sess.name}`}
                            className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[10px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          {t.status !== 'ACTIVE' && (
                            <button
                              type="button"
                              disabled={busyActionId === t.id}
                              onClick={() => handleActivateTerm(sess, t)}
                              className="px-2 py-1 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-200 text-[10px] font-semibold text-emerald-700 cursor-pointer disabled:opacity-60"
                            >
                              Set Active
                            </button>
                          )}
                          {confirmDeleteTermId === t.id ? (
                            <span className="inline-flex items-center gap-1 ml-auto text-[10px]">
                              <button
                                type="button"
                                disabled={busyActionId === t.id}
                                onClick={() => handleDeleteTerm(sess, t)}
                                className="px-1.5 py-0.5 rounded bg-rose-600 text-white font-bold cursor-pointer"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteTermId(null)}
                                className="px-1.5 py-0.5 rounded bg-white border border-slate-300 text-slate-600 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteTermId(t.id)}
                              aria-label={`Delete ${t.name}`}
                              className="p-1 ml-auto rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                              title={`Delete unused ${labels.cycle.toLowerCase()}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT SESSION MODAL */}
      {isSessionModalOpen && (
        <ModalPortal onEscape={() => setIsSessionModalOpen(false)}>
          <div
            className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/65 backdrop-blur-[1px] p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={editingSession ? `Edit Academic Session ${editingSession.name}` : 'New Academic Session'}
          >
            <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[92dvh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden text-xs">
              <div className="shrink-0 bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-bold text-base">
                    {editingSession ? 'Edit Academic Session' : 'New Academic Session'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSessionModalOpen(false)}
                  aria-label="Close session modal"
                  className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmitSession} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4">
                {formError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Session Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    aria-label="Academic Session Name"
                    value={sessionName}
                    onChange={(e) => handleSessionNameChange(e.target.value)}
                    placeholder="e.g. 2027/2028 or 2035/2036"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold font-mono text-sm sm:text-xs"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Type any past, current, or future academic year (e.g. 2023/2024, 2027/2028, 2035/2036).
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={sessionStart}
                      onChange={(e) => {
                        setDatesManuallyEdited(true);
                        setSessionStart(e.target.value);
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">End Date</label>
                    <input
                      type="date"
                      value={sessionEnd}
                      onChange={(e) => {
                        setDatesManuallyEdited(true);
                        setSessionEnd(e.target.value);
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    aria-label="Academic Session Status"
                    value={sessionStatus}
                    onChange={(e) => setSessionStatus(e.target.value as SessionStatus)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="ACTIVE">ACTIVE (Current School Session)</option>
                    <option value="UPCOMING">UPCOMING (Future Session)</option>
                    <option value="COMPLETED">COMPLETED (Past / Historical)</option>
                  </select>
                </div>

                {!editingSession && (
                  <label className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCreateTerms}
                      onChange={(e) => setAutoCreateTerms(e.target.checked)}
                      className="rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>
                      Automatically setup standard {labels.cyclePlural.toLowerCase()} (
                      {profile.cycleLabels?.join(', ') || (profile.cycleType === 'SEMESTER' ? '1st Semester, 2nd Semester' : '1st Term, 2nd Term, 3rd Term')})
                    </span>
                  </label>
                )}

                <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSessionModalOpen(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60 cursor-pointer"
                  >
                    {formSubmitting ? 'Saving...' : editingSession ? 'Save Changes' : 'Create Session'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* CREATE / EDIT TERM / SEMESTER MODAL */}
      {isTermModalOpen && selectedSessionForTerm && (
        <ModalPortal onEscape={() => setIsTermModalOpen(false)}>
          <div
            className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-slate-900/65 backdrop-blur-[1px] p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={
              editingTerm
                ? `Edit ${labels.cycle} in ${selectedSessionForTerm.name}`
                : `Add ${labels.cycle} to ${selectedSessionForTerm.name}`
            }
          >
            <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[92dvh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden text-xs">
              <div className="shrink-0 bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-bold text-base">
                    {editingTerm ? `Edit ${labels.cycle}` : `Add ${labels.cycle}`} · {selectedSessionForTerm.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsTermModalOpen(false)}
                  aria-label="Close term modal"
                  className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmitTerm} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4">
                {formError && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {labels.cycle} Name <span className="text-red-500">*</span>
                  </label>
                  <select
                    aria-label={`${labels.cycle} Name Select`}
                    value={termName}
                    onChange={(e) => setTermName(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold"
                  >
                    {cycleNameOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                    <option value="__CUSTOM__">Custom {labels.cycle} Name...</option>
                  </select>
                  {termName === '__CUSTOM__' && (
                    <input
                      type="text"
                      required
                      aria-label={`Custom ${labels.cycle} Name`}
                      value={customTermName}
                      onChange={(e) => setCustomTermName(e.target.value)}
                      placeholder={`e.g. Summer ${labels.cycle} / Modular Session`}
                      className="w-full mt-2 px-3 py-2 bg-white border border-slate-300 rounded-xl font-semibold"
                    />
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={termStart}
                      onChange={(e) => setTermStart(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">End Date</label>
                    <input
                      type="date"
                      value={termEnd}
                      onChange={(e) => setTermEnd(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={termStatus}
                    onChange={(e) => setTermStatus(e.target.value as SessionStatus)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="UPCOMING">UPCOMING</option>
                    <option value="COMPLETED">COMPLETED</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsTermModalOpen(false)}
                    className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60 cursor-pointer"
                  >
                    {formSubmitting ? 'Saving...' : editingTerm ? 'Save Changes' : `Add ${labels.cycle}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
