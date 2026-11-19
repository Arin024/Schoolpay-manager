import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  Clock,
  Eye,
  Flag,
  KeyRound,
  MonitorCheck,
  PlayCircle,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import { api } from '../../services/api.js';
import {
  CbtAnswerEntry,
  CbtQuestionItem,
  CbtReviewItem,
  CbtStudentExamItem,
  CbtStudentHistoryItem,
} from '../../types/index.js';

function formatCountdown(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export const StudentCBTHallView: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<CbtStudentExamItem[]>([]);
  const [history, setHistory] = useState<CbtStudentHistoryItem[]>([]);
  const [studentMeta, setStudentMeta] = useState<{ full_name: string; class_name?: string | null; admission_number?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Access PIN modal when starting a PIN-protected exam
  const [pinExam, setPinExam] = useState<CbtStudentExamItem | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [startingExamId, setStartingExamId] = useState<string | null>(null);

  // Active CBT Session State
  const [activeSession, setActiveSession] = useState<{
    attemptId: string;
    exam: {
      id: string;
      title: string;
      subject_name: string;
      class_name: string;
      instructions?: string | null;
      duration_minutes: number;
      total_marks: number;
      show_result_immediately: boolean;
      show_correct_answers: boolean;
    };
    questions: CbtQuestionItem[];
    answers: Record<string, CbtAnswerEntry>;
    tabSwitchCount: number;
  } | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [tabWarning, setTabWarning] = useState<string | null>(null);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Post-Submission Result / Review View
  const [completedResult, setCompletedResult] = useState<{
    result_withheld: boolean;
    examTitle: string;
    subjectName: string;
    attempt: any;
    review: CbtReviewItem[] | null;
  } | null>(null);

  const submittingRef = useRef(false);

  const loadLobby = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStudentCbtExams();
      setExams(res.exams || []);
      setHistory(res.history || []);
      setStudentMeta(res.student || null);
    } catch (err: any) {
      setError(err?.message || 'Unable to load CBT exams for your class.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLobby();
  }, [loadLobby]);

  const handleFinalSubmit = useCallback(
    async (isAuto = false) => {
      if (!activeSession || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      setConfirmSubmitOpen(false);
      try {
        const res = await api.submitStudentCbtAttempt(activeSession.attemptId, {
          answers: activeSession.answers,
          auto_submitted: isAuto,
        });
        setCompletedResult({
          result_withheld: Boolean(res.result_withheld),
          examTitle: activeSession.exam.title,
          subjectName: activeSession.exam.subject_name,
          attempt: res.attempt,
          review: res.review || null,
        });
        setActiveSession(null);
        await loadLobby();
      } catch (err: any) {
        setError(err?.message || 'Could not submit CBT exam. Please retry immediately.');
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [activeSession, loadLobby]
  );

  // Live countdown timer synced with server remaining_seconds
  useEffect(() => {
    if (!activeSession) return;
    if (remainingSeconds <= 0) {
      handleFinalSubmit(true);
      return;
    }
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          handleFinalSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeSession?.attemptId, remainingSeconds <= 0, handleFinalSubmit]);

  // Tab-switch / focus proctoring listener during active exam
  useEffect(() => {
    if (!activeSession) return;
    const onVisibilityChange = () => {
      if (document.hidden) {
        setTabWarning('You switched away from the CBT Exam Hall. Focus switches are recorded for invigilator review.');
        api
          .saveStudentCbtAnswer(activeSession.attemptId, { tab_switch_delta: 1 })
          .then((res) => {
            if (typeof res.tab_switch_count === 'number') {
              setActiveSession((prev) =>
                prev ? { ...prev, tabSwitchCount: res.tab_switch_count! } : prev
              );
            }
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [activeSession?.attemptId]);

  const startOrResumeExam = async (exam: CbtStudentExamItem, accessCode?: string) => {
    setStartingExamId(exam.id);
    setError(null);
    setTabWarning(null);
    try {
      const res = await api.startStudentCbtExam(exam.id, accessCode);
      setPinExam(null);
      setPinInput('');

      if (res.auto_submitted) {
        setError(res.message || 'Your previous timed attempt expired and was automatically submitted.');
        await loadLobby();
        return;
      }

      if (res.exam && res.attempt && res.questions) {
        setActiveSession({
          attemptId: res.attempt.id,
          exam: res.exam,
          questions: res.questions,
          answers: res.attempt.answers || {},
          tabSwitchCount: res.attempt.tab_switch_count || 0,
        });
        setCurrentIdx(0);
        setRemainingSeconds(res.remaining_seconds ?? res.exam.duration_minutes * 60);
        setSaveStatus('saved');
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to start this CBT exam.');
    } finally {
      setStartingExamId(null);
    }
  };

  const persistAnswer = useCallback(
    async (questionId: string, patch: { selected?: string; flagged?: boolean }) => {
      if (!activeSession) return;
      setActiveSession((prev) => {
        if (!prev) return prev;
        const current = prev.answers[questionId] || {};
        return {
          ...prev,
          answers: {
            ...prev.answers,
            [questionId]: {
              ...current,
              ...patch,
              updated_at: new Date().toISOString(),
            },
          },
        };
      });

      setSaveStatus('saving');
      try {
        const res = await api.saveStudentCbtAnswer(activeSession.attemptId, {
          question_id: questionId,
          ...patch,
        });
        if (res.auto_submitted) {
          setCompletedResult({
            result_withheld: !activeSession.exam.show_result_immediately,
            examTitle: activeSession.exam.title,
            subjectName: activeSession.exam.subject_name,
            attempt: res.attempt,
            review: null,
          });
          setActiveSession(null);
          await loadLobby();
          return;
        }
        if (typeof res.remaining_seconds === 'number') {
          setRemainingSeconds(res.remaining_seconds);
        }
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    },
    [activeSession, loadLobby]
  );

  // Keyboard shortcuts during active CBT session (A-E for MCQ, Left/Right arrows)
  useEffect(() => {
    if (!activeSession || confirmSubmitOpen) return;
    const q = activeSession.questions[currentIdx];
    if (!q) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.key === 'ArrowRight' && currentIdx < activeSession.questions.length - 1) {
        e.preventDefault();
        setCurrentIdx((i) => i + 1);
      } else if (e.key === 'ArrowLeft' && currentIdx > 0) {
        e.preventDefault();
        setCurrentIdx((i) => i - 1);
      } else if (q.question_type === 'MCQ') {
        const k = e.key.toUpperCase();
        if (['A', 'B', 'C', 'D', 'E'].includes(k)) {
          const optVal = (q as any)[`option_${k.toLowerCase()}`];
          if (optVal) {
            e.preventDefault();
            persistAnswer(q.id, { selected: k });
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSession, currentIdx, confirmSubmitOpen, persistAnswer]);

  const handleOpenHistoryReview = async (attemptId: string) => {
    setError(null);
    try {
      const res = await api.getStudentCbtAttemptReview(attemptId);
      setCompletedResult({
        result_withheld: false,
        examTitle: res.exam.title,
        subjectName: res.exam.subject_name,
        attempt: res.attempt,
        review: res.review,
      });
    } catch (err: any) {
      setError(err?.message || 'Unable to load answer review.');
    }
  };

  const sessionStats = useMemo(() => {
    if (!activeSession) return { answered: 0, flagged: 0, unanswered: 0 };
    let answered = 0;
    let flagged = 0;
    for (const q of activeSession.questions) {
      const entry = activeSession.answers[q.id];
      if (entry?.selected && entry.selected.trim()) answered++;
      if (entry?.flagged) flagged++;
    }
    return {
      answered,
      flagged,
      unanswered: activeSession.questions.length - answered,
    };
  }, [activeSession]);

  // ============================================================================
  // 1. ACTIVE TIMED CBT EXAM HALL (DISTRACTION-FREE WORKSPACE)
  // ============================================================================
  if (activeSession) {
    const q = activeSession.questions[currentIdx];
    const currentEntry = q ? activeSession.answers[q.id] || {} : {};
    const isUrgent = remainingSeconds < 60;
    const isWarn = remainingSeconds < 300 && !isUrgent;

    return (
      <div className="space-y-4">
        {/* Sticky CBT Top Control Strip */}
        <div className="sticky top-2 z-30 bg-slate-900 text-white rounded-2xl border border-slate-800 px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-md">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-emerald-300 truncate">
              {activeSession.exam.subject_name} · {activeSession.exam.class_name}
            </p>
            <h2 className="text-sm sm:text-base font-bold text-white truncate">{activeSession.exam.title}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-300 hidden sm:inline tabular-nums">
              {sessionStats.answered}/{activeSession.questions.length} answered ·{' '}
              <strong className={saveStatus === 'error' ? 'text-rose-300' : 'text-emerald-300'}>
                {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Retry needed' : 'Auto-saved'}
              </strong>
            </span>

            <div
              className={`px-3.5 py-1.5 rounded-xl font-mono text-base font-black tabular-nums flex items-center gap-1.5 border ${
                isUrgent
                  ? 'bg-rose-600 border-rose-400 text-white'
                  : isWarn
                    ? 'bg-amber-500 border-amber-300 text-slate-950'
                    : 'bg-slate-800 border-slate-700 text-emerald-300'
              }`}
              data-testid="cbt-countdown-timer"
            >
              <Clock className="w-4 h-4" />
              <span>{formatCountdown(remainingSeconds)}</span>
            </div>

            <button
              type="button"
              onClick={() => setConfirmSubmitOpen(true)}
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit Exam</span>
            </button>
          </div>
        </div>

        {tabWarning && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{tabWarning}</span>
            </span>
            <button type="button" onClick={() => setTabWarning(null)} className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Question Stem & Options */}
          {q && (
            <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 space-y-6">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="text-xs font-bold text-slate-500 tabular-nums">
                  Question <span className="text-slate-900 text-sm">{currentIdx + 1}</span> of {activeSession.questions.length} ·{' '}
                  <span>{q.marks} mark{q.marks === 1 ? '' : 's'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => persistAnswer(q.id, { flagged: !currentEntry.flagged })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer border transition ${
                    currentEntry.flagged
                      ? 'bg-amber-50 border-amber-300 text-amber-800'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>{currentEntry.flagged ? 'Flagged for Review' : 'Flag Question'}</span>
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-base sm:text-lg font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                  {q.question_text}
                </p>

                {q.question_image_url && (
                  <img
                    src={q.question_image_url}
                    alt={`Question ${currentIdx + 1} diagram`}
                    className="max-h-72 rounded-xl border border-slate-200 object-contain bg-slate-50 p-2"
                  />
                )}
              </div>

              {/* MCQ Options */}
              {q.question_type === 'MCQ' && (
                <div className="space-y-2.5">
                  {(['A', 'B', 'C', 'D', 'E'] as const).map((ltr) => {
                    const text = (q as any)[`option_${ltr.toLowerCase()}`];
                    if (!text) return null;
                    const isSelected = currentEntry.selected === ltr;
                    return (
                      <button
                        key={ltr}
                        type="button"
                        onClick={() => persistAnswer(q.id, { selected: ltr })}
                        className={`w-full text-left p-4 rounded-xl border transition flex items-start gap-3 cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500 text-slate-900'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <span
                          className={`w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {ltr}
                        </span>
                        <span className="text-sm font-medium pt-0.5 leading-snug">{text}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* True / False Options */}
              {q.question_type === 'TRUE_FALSE' && (
                <div className="grid grid-cols-2 gap-3">
                  {(['TRUE', 'FALSE'] as const).map((val) => {
                    const isSelected = currentEntry.selected === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => persistAnswer(q.id, { selected: val })}
                        className={`p-4 rounded-xl border font-bold text-sm transition cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500 text-emerald-900'
                            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        {val === 'TRUE' ? 'True' : 'False'}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Short Answer Input */}
              {q.question_type === 'SHORT_ANSWER' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">Type Your Answer</label>
                  <input
                    type="text"
                    value={currentEntry.selected || ''}
                    onChange={(e) => persistAnswer(q.id, { selected: e.target.value })}
                    placeholder="Enter your short answer..."
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              )}

              {/* Bottom Navigation Controls */}
              <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  disabled={currentIdx === 0}
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>

                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  Shortcuts: Keys A–E to answer · ← / → to navigate
                </span>

                {currentIdx < activeSession.questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setCurrentIdx((i) => Math.min(activeSession.questions.length - 1, i + 1))}
                    className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Next Question</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmSubmitOpen(true)}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>Finish &amp; Submit</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Question Navigator Palette */}
          <aside className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Question Navigator</h3>
              <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                {sessionStats.answered} answered · {sessionStats.flagged} flagged · {sessionStats.unanswered} remaining
              </p>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-6 lg:grid-cols-5 gap-2 tabular-nums">
              {activeSession.questions.map((item, idx) => {
                const ent = activeSession.answers[item.id];
                const isAnswered = Boolean(ent?.selected && ent.selected.trim());
                const isFlagged = Boolean(ent?.flagged);
                const isCurrent = idx === currentIdx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`h-10 rounded-xl text-xs font-bold transition cursor-pointer relative ${
                      isCurrent
                        ? 'ring-2 ring-slate-900 ring-offset-1 '
                        : ''
                    }${
                      isFlagged
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : isAnswered
                          ? 'bg-emerald-600 text-white border border-emerald-600'
                          : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-3 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-600 inline-block" /> Answered
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-200 border border-amber-400 inline-block" /> Flagged
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-slate-200 inline-block" /> Unanswered
              </span>
            </div>

            {activeSession.exam.instructions && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                <strong className="text-slate-800 block mb-0.5">Instructions</strong>
                {activeSession.exam.instructions}
              </div>
            )}
          </aside>
        </div>

        {/* Submit Confirmation Modal */}
        {confirmSubmitOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-6 space-y-4">
              <h3 className="text-base font-bold text-slate-900">Submit CBT Examination?</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Once submitted, you cannot change your answers for this attempt.
              </p>
              <div className="grid grid-cols-3 gap-2 text-center bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs tabular-nums">
                <div>
                  <p className="text-slate-500">Answered</p>
                  <p className="text-lg font-black text-emerald-700">{sessionStats.answered}</p>
                </div>
                <div>
                  <p className="text-slate-500">Flagged</p>
                  <p className="text-lg font-black text-amber-700">{sessionStats.flagged}</p>
                </div>
                <div>
                  <p className="text-slate-500">Unanswered</p>
                  <p className="text-lg font-black text-rose-700">{sessionStats.unanswered}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmSubmitOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold cursor-pointer"
                >
                  Continue Exam
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleFinalSubmit(false)}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Confirm & Submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // 2. POST-SUBMISSION RESULT & ANSWER REVIEW SCREEN
  // ============================================================================
  if (completedResult) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-emerald-700 uppercase">{completedResult.subjectName}</p>
              <h2 className="text-xl font-bold text-slate-900 mt-0.5">{completedResult.examTitle}</h2>
            </div>
            <button
              type="button"
              onClick={() => setCompletedResult(null)}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
            >
              Back to CBT Exam Hall
            </button>
          </div>

          {completedResult.result_withheld ? (
            <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700">
              <p className="font-bold text-slate-900">Submission Recorded Successfully</p>
              <p className="text-xs text-slate-600 mt-1">
                Your answers have been safely saved and graded. Your school will publish official CBT scores at the scheduled time.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 tabular-nums">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-xs text-slate-500">Score Obtained</p>
                <p className="text-2xl font-black text-slate-900 mt-1">
                  {completedResult.attempt?.score_obtained} / {completedResult.attempt?.max_score}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-xs text-slate-500">Percentage</p>
                <p className="text-2xl font-black text-emerald-700 mt-1">{completedResult.attempt?.percentage}%</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-xs text-slate-500">WAEC Grade</p>
                <p className="text-2xl font-black text-slate-900 mt-1">{completedResult.attempt?.grade || '—'}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-xs text-slate-500">Outcome</p>
                <p
                  className={`text-xl font-black mt-1 ${
                    completedResult.attempt?.passed ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {completedResult.attempt?.passed ? 'PASSED' : 'NEEDS REVIEW'}
                </p>
              </div>
            </div>
          )}
        </div>

        {completedResult.review && completedResult.review.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Answer Sheet Review</h3>
            <div className="space-y-3 text-xs">
              {completedResult.review.map((item, idx) => (
                <div
                  key={item.question_id}
                  className={`p-4 rounded-xl border space-y-1.5 ${
                    item.is_correct ? 'bg-emerald-50/50 border-emerald-200' : 'bg-rose-50/40 border-rose-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      Q{idx + 1}. {item.question_text}
                    </p>
                    <span className={`font-bold shrink-0 ${item.is_correct ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {item.is_correct ? `+${item.earned_marks}` : `0/${item.marks}`}
                    </span>
                  </div>
                  <p className="text-slate-700">
                    Your Answer: <strong>{item.selected_answer || 'Unanswered'}</strong> · Correct Answer:{' '}
                    <strong className="text-emerald-800">{item.correct_answer}</strong>
                  </p>
                  {item.explanation && (
                    <p className="text-slate-600">
                      <strong>Explanation:</strong> {item.explanation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // 3. CBT EXAM HALL LOBBY (ELIGIBLE EXAMS + COMPLETED HISTORY)
  // ============================================================================
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <MonitorCheck className="w-5 h-5 text-emerald-600" />
            <span>Student CBT Examination Hall</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {studentMeta
              ? `Showing published CBT exams for ${studentMeta.class_name || 'your class'} and school-wide sessions.`
              : 'Select an available CBT examination below to begin.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs text-slate-500">
          Loading available CBT examinations...
        </div>
      ) : exams.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
          <MonitorCheck className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-900">No Live CBT Examinations Right Now</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            When your teachers or school administrator publish a CBT test for your class, it will appear right here immediately.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {exams.map((exam) => (
            <div
              key={exam.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">
                    {exam.subject_name} · {exam.class_name}
                  </span>
                  {exam.requires_access_code && (
                    <span className="text-[11px] font-semibold text-amber-700 inline-flex items-center gap-1">
                      <KeyRound className="w-3 h-3" /> PIN Required
                    </span>
                  )}
                </div>
                <h3 className="text-base font-bold text-slate-900">{exam.title}</h3>
                {exam.description && <p className="text-xs text-slate-600">{exam.description}</p>}

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-xs tabular-nums">
                  <div>
                    <p className="text-slate-500">Questions</p>
                    <p className="font-bold text-slate-900">{exam.question_count}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Duration</p>
                    <p className="font-bold text-slate-900">{exam.duration_minutes} mins</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Attempts</p>
                    <p className="font-bold text-slate-900">
                      {exam.attempts_used} / {exam.max_attempts}
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                {exam.active_attempt_id ? (
                  <button
                    type="button"
                    disabled={startingExamId === exam.id}
                    onClick={() => startOrResumeExam(exam)}
                    className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span>{startingExamId === exam.id ? 'Resuming...' : 'Resume In-Progress Exam'}</span>
                  </button>
                ) : exam.can_start ? (
                  <button
                    type="button"
                    disabled={startingExamId === exam.id}
                    onClick={() => {
                      if (exam.requires_access_code) {
                        setPinExam(exam);
                        setPinInput('');
                      } else {
                        startOrResumeExam(exam);
                      }
                    }}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span>{startingExamId === exam.id ? 'Starting Exam...' : 'Start CBT Exam'}</span>
                  </button>
                ) : exam.latest_submitted_attempt ? (
                  <div className="w-full flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-emerald-700 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      Completed
                      {exam.latest_submitted_attempt.percentage !== null
                        ? ` (${exam.latest_submitted_attempt.percentage}% · ${exam.latest_submitted_attempt.grade})`
                        : ''}
                    </span>
                    {exam.show_correct_answers && exam.show_result_immediately && (
                      <button
                        type="button"
                        onClick={() => handleOpenHistoryReview(exam.latest_submitted_attempt!.id)}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer"
                      >
                        Review
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-slate-500">
                    {exam.not_yet_open ? 'Not yet open' : exam.window_closed ? 'Exam window closed' : 'Unavailable'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed CBT Results History */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Award className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">My Completed CBT Results</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Examination</th>
                  <th className="py-3 px-3">Subject</th>
                  <th className="py-3 px-3 text-right">Score</th>
                  <th className="py-3 px-3 text-right">%</th>
                  <th className="py-3 px-3">Grade</th>
                  <th className="py-3 px-4 text-right">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-3 px-4 font-bold text-slate-900">{h.exam_title}</td>
                    <td className="py-3 px-3 text-slate-600">{h.subject_name}</td>
                    <td className="py-3 px-3 text-right font-semibold text-slate-900">
                      {h.result_withheld ? 'Withheld' : `${h.score_obtained} / ${h.max_score}`}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-emerald-700">
                      {h.result_withheld ? '—' : `${h.percentage}%`}
                    </td>
                    <td className="py-3 px-3 font-bold text-slate-900">{h.result_withheld ? '—' : h.grade}</td>
                    <td className="py-3 px-4 text-right">
                      {h.can_review ? (
                        <button
                          type="button"
                          onClick={() => handleOpenHistoryReview(h.id)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Review</span>
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Access PIN Modal */}
      {pinExam && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startOrResumeExam(pinExam, pinInput.trim());
            }}
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Enter Exam Access PIN</h3>
              <button type="button" onClick={() => setPinExam(null)} className="cursor-pointer text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Enter the access PIN provided by your teacher or invigilator for <strong>{pinExam.title}</strong>.
            </p>
            <input
              type="text"
              required
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.toUpperCase())}
              placeholder="e.g. MATH2026"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl font-mono text-sm uppercase tracking-wider"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPinExam(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!pinInput.trim() || startingExamId === pinExam.id}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                Start Exam
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
