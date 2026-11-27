import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Plus,
  Clock,
  AlertCircle,
  X,
  BookOpen,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { AcademicSessionItem, SessionStatus } from '../../types/index.js';
import { resolveInstitutionProfile } from '../../utils/institutionMode.js';

interface SchoolAcademicSessionsViewProps {
  onNavigateProgression?: () => void;
}

export const SchoolAcademicSessionsView: React.FC<SchoolAcademicSessionsViewProps> = ({
  onNavigateProgression,
}) => {
  const { activeSchool, activeSettings } = useAuth();
  const profile = resolveInstitutionProfile(activeSchool, activeSettings);
  const { labels, cycleType, cycleLabels } = profile;

  const [sessions, setSessions] = useState<AcademicSessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isAddSessionModalOpen, setIsAddSessionModalOpen] = useState(false);
  const [isAddTermModalOpen, setIsAddTermModalOpen] = useState(false);
  const [selectedSessionForTerm, setSelectedSessionForTerm] = useState<AcademicSessionItem | null>(null);

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

  // Form states
  const [newSessionName, setNewSessionName] = useState(defaultSessionName);
  const [newSessionStart, setNewSessionStart] = useState(`${currentStartYear}-09-01`);
  const [newSessionEnd, setNewSessionEnd] = useState(`${currentEndYear}-07-31`);
  const [newSessionStatus, setNewSessionStatus] = useState<SessionStatus>('ACTIVE');
  const [autoCreateTerms, setAutoCreateTerms] = useState(true);

  const [newTermName, setNewTermName] = useState(defaultCycleName);
  const [customTermName, setCustomTermName] = useState('');
  const [newTermStart, setNewTermStart] = useState(`${currentStartYear}-09-09`);
  const [newTermEnd, setNewTermEnd] = useState(`${currentStartYear}-12-18`);
  const [newTermStatus, setNewTermStatus] = useState<SessionStatus>('ACTIVE');

  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [seedingTermsId, setSeedingTermsId] = useState<string | null>(null);

  useEffect(() => {
    setNewTermName(defaultCycleName);
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

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);

    try {
      await api.createAcademicSession({
        name: newSessionName,
        start_date: newSessionStart,
        end_date: newSessionEnd,
        status: newSessionStatus,
        auto_create_terms: autoCreateTerms,
      });
      setIsAddSessionModalOpen(false);
      setNewSessionName('');
      await loadSessions();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create academic session');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleCreateTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionForTerm) return;
    const finalName = newTermName === '__CUSTOM__' ? customTermName.trim() : newTermName;
    if (!finalName) {
      setFormError(`Please enter a ${labels.cycle.toLowerCase()} name.`);
      return;
    }
    setFormSubmitting(true);
    setFormError(null);

    try {
      await api.createTerm(selectedSessionForTerm.id, {
        name: finalName,
        start_date: newTermStart,
        end_date: newTermEnd,
        status: newTermStatus,
      });
      setIsAddTermModalOpen(false);
      setSelectedSessionForTerm(null);
      setCustomTermName('');
      await loadSessions();
    } catch (err: any) {
      setFormError(err?.message || `Failed to create ${labels.cycle.toLowerCase()}`);
    } finally {
      setFormSubmitting(false);
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
            status: currentMonth >= 9 || currentMonth <= 2 ? 'ACTIVE' : 'COMPLETED',
          },
          {
            name: secondLabel,
            start_date: `${y2}-03-15`,
            end_date: `${y2}-07-31`,
            status: currentMonth >= 3 && currentMonth <= 8 ? 'ACTIVE' : 'UPCOMING',
          },
        ];
        if (cycleLabels[2]) {
          templates.push({
            name: cycleLabels[2],
            start_date: `${y2}-08-05`,
            end_date: `${y2}-09-20`,
            status: 'UPCOMING',
          });
        }
      } else if (cycleType === 'TRIMESTER') {
        templates = [
          { name: cycleLabels[0] || '1st Trimester', start_date: `${y1}-09-09`, end_date: `${y1}-12-18`, status: currentMonth >= 9 ? 'ACTIVE' : 'COMPLETED' },
          { name: cycleLabels[1] || '2nd Trimester', start_date: `${y2}-01-12`, end_date: `${y2}-04-10`, status: currentMonth >= 1 && currentMonth <= 4 ? 'ACTIVE' : currentMonth >= 9 ? 'UPCOMING' : 'COMPLETED' },
          { name: cycleLabels[2] || '3rd Trimester', start_date: `${y2}-04-27`, end_date: `${y2}-07-24`, status: currentMonth >= 5 && currentMonth <= 8 ? 'ACTIVE' : 'UPCOMING' },
        ];
      } else {
        templates = [
          { name: 'First Term', start_date: `${y1}-09-09`, end_date: `${y1}-12-18`, status: currentMonth >= 9 ? 'ACTIVE' : 'COMPLETED' },
          { name: 'Second Term', start_date: `${y2}-01-12`, end_date: `${y2}-04-10`, status: currentMonth >= 1 && currentMonth <= 4 ? 'ACTIVE' : currentMonth >= 9 ? 'UPCOMING' : 'COMPLETED' },
          { name: 'Third Term', start_date: `${y2}-04-27`, end_date: `${y2}-07-24`, status: currentMonth >= 5 && currentMonth <= 8 ? 'ACTIVE' : 'UPCOMING' },
        ];
      }

      for (const tpl of templates) {
        if (existingNames.has(tpl.name.toLowerCase())) continue;
        await api.createTerm(sess.id, tpl);
      }
      await loadSessions();
    } catch (err: any) {
      setFormError(err?.message || `Failed to setup ${labels.cyclePlural.toLowerCase()}`);
    } finally {
      setSeedingTermsId(null);
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
          : ['First Term', 'Second Term', 'Third Term', '1st Semester', '2nd Semester']),
    ])
  );

  const expectedCycleCount = cycleType === 'SEMESTER' ? Math.max(2, cycleLabels.length) : 3;
  const seedButtonLabel =
    cycleType === 'SEMESTER'
      ? `Setup ${cycleLabels.slice(0, 2).join(' & ')}`
      : cycleType === 'TRIMESTER'
        ? 'Setup 3 Trimesters'
        : 'Setup 3 Nigerian Terms';

  return (
    <div className="space-y-6">
      {formError && !isAddSessionModalOpen && !isAddTermModalOpen && (
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

      {/* Top Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-600" />
            <span>Academic Sessions &amp; {labels.cyclePlural}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage academic calendar years (e.g. {defaultSessionName}) and {labels.cycle.toLowerCase()} schedules ({cycleLabels.join(', ')}) for{' '}
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
            onClick={() => {
              setNewSessionName(defaultSessionName);
              setFormError(null);
              setIsAddSessionModalOpen(true);
            }}
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
            onClick={() => setIsAddSessionModalOpen(true)}
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
              className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 space-y-4 hover:border-emerald-300 transition"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-black text-sm">
                    {sess.name.slice(0, 4)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
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
                      Period: {sess.start_date || 'TBD'} to {sess.end_date || 'TBD'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
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
                    onClick={() => {
                      setSelectedSessionForTerm(sess);
                      setNewTermName(cycleNameOptions[0] || defaultCycleName);
                      setFormError(null);
                      setIsAddTermModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Add {labels.cycle}</span>
                  </button>
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {sess.terms.map((t) => (
                      <div
                        key={t.id}
                        className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 text-xs">{t.name}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              t.status === 'ACTIVE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {t.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {t.start_date || 'Start TBD'} – {t.end_date || 'End TBD'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE SESSION MODAL */}
      {isAddSessionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">New Academic Session</h3>
              </div>
              <button
                onClick={() => setIsAddSessionModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="p-6 space-y-4">
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
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="e.g. 2025/2026"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={newSessionStart}
                    onChange={(e) => setNewSessionStart(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={newSessionEnd}
                    onChange={(e) => setNewSessionEnd(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={newSessionStatus}
                  onChange={(e) => setNewSessionStatus(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="UPCOMING">UPCOMING</option>
                  <option value="COMPLETED">COMPLETED (Past / Historical)</option>
                </select>
              </div>

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

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddSessionModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60 cursor-pointer"
                >
                  {formSubmitting ? 'Saving...' : 'Create Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE TERM / SEMESTER MODAL */}
      {isAddTermModalOpen && selectedSessionForTerm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">
                  Add {labels.cycle} to {selectedSessionForTerm.name}
                </h3>
              </div>
              <button
                onClick={() => setIsAddTermModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTerm} className="p-6 space-y-4">
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
                  value={newTermName}
                  onChange={(e) => setNewTermName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-semibold"
                >
                  {cycleNameOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value="__CUSTOM__">Custom {labels.cycle} Name...</option>
                </select>
                {newTermName === '__CUSTOM__' && (
                  <input
                    type="text"
                    required
                    value={customTermName}
                    onChange={(e) => setCustomTermName(e.target.value)}
                    placeholder={`e.g. Summer ${labels.cycle} / Modular Session`}
                    className="w-full mt-2 px-3 py-2 bg-white border border-slate-300 rounded-xl font-semibold"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={newTermStart}
                    onChange={(e) => setNewTermStart(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={newTermEnd}
                    onChange={(e) => setNewTermEnd(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={newTermStatus}
                  onChange={(e) => setNewTermStatus(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="UPCOMING">UPCOMING</option>
                  <option value="COMPLETED">COMPLETED</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddTermModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60 cursor-pointer"
                >
                  {formSubmitting ? 'Saving...' : `Add ${labels.cycle}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
