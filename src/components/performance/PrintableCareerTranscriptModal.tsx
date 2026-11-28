import React, { useState } from 'react';
import {
  X,
  Printer,
  ShieldCheck,
  Award,
  CheckCircle2,
  AlertTriangle,
  GraduationCap,
  FileCheck2,
  Loader2,
} from 'lucide-react';
import { ModalPortal } from '../common/ModalPortal';

interface PrintableCareerTranscriptModalProps {
  transcript: any;
  onClose: () => void;
  canPublish?: boolean;
  onPublish?: (remarks: { registrar_remark: string; principal_remark: string }) => Promise<void>;
}

const formatNaira = (kobo: number) =>
  `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PrintableCareerTranscriptModal: React.FC<PrintableCareerTranscriptModalProps> = ({
  transcript,
  onClose,
  canPublish = false,
  onPublish,
}) => {
  const [registrarRemark, setRegistrarRemark] = useState<string>(transcript?.registrar_remark || '');
  const [principalRemark, setPrincipalRemark] = useState<string>(transcript?.principal_remark || '');
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [publishErr, setPublishErr] = useState<string | null>(null);

  if (!transcript) return null;

  const isTertiary = Boolean(transcript.institution_profile?.isTertiary);
  const gradingMode = String(transcript.summary?.grading_mode || 'PERCENTAGE');
  const isGpaMode = gradingMode === 'GPA_5' || gradingMode === 'GPA_4';
  const gpaMax = Number(transcript.summary?.gpa_scale_max || (gradingMode === 'GPA_4' ? 4.0 : 5.0));
  const rawLabels = transcript.institution_profile?.labels || {};
  const labels = {
    studentId: rawLabels.studentId || (isTertiary ? 'Matriculation Number' : 'Admission Number'),
    classLabel: rawLabels.classLabel || (isTertiary ? 'Level' : 'Class'),
    cycle: rawLabels.cycle || (isTertiary ? 'Semester' : 'Term'),
    subject: rawLabels.subject || (isTertiary ? 'Course' : 'Subject'),
    subjectPlural: rawLabels.subjectPlural || (isTertiary ? 'Courses' : 'Subjects'),
    head: rawLabels.head || (isTertiary ? 'Registrar / Provost' : 'Principal / Head of School'),
  };

  const handlePrint = () => {
    window.print();
  };

  const handlePublishClick = async () => {
    if (!onPublish) return;
    setPublishing(true);
    setPublishErr(null);
    setPublishMsg(null);
    try {
      await onPublish({
        registrar_remark: registrarRemark,
        principal_remark: principalRemark,
      });
      setPublishMsg('Official cumulative career transcript published and verifiable online.');
    } catch (err: any) {
      setPublishErr(err?.message || 'Unable to publish career transcript.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <ModalPortal onEscape={onClose}>
      <div
        className="fixed inset-0 z-[9999] bg-slate-950/75 backdrop-blur-xs flex items-start justify-center overflow-y-auto p-2 sm:p-6 print:p-0 print:bg-white print:static"
        role="dialog"
        aria-modal="true"
        aria-label={isTertiary ? 'Cumulative Academic Career Transcript' : 'Cumulative Multi-Year Academic Record'}
      >
        <div className="bg-white w-full max-w-5xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden my-2 print:my-0 print:border-0 print:shadow-none print:rounded-none print:max-w-none">
        {/* Non-printing Toolbar */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-sm font-bold leading-tight">
                {isTertiary ? 'Cumulative Academic Career Transcript' : 'Cumulative Multi-Year Academic Record'}
              </h2>
              <p className="text-[11px] text-slate-300 font-mono">
                Verification Code: {transcript.verification_code} · {transcript.is_official ? 'OFFICIAL PUBLISHED' : 'LIVE PREVIEW'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canPublish && onPublish && (
              <button
                type="button"
                onClick={handlePublishClick}
                disabled={publishing}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCheck2 className="w-3.5 h-3.5" />}
                <span>{transcript.is_official ? 'Re-Publish Official Snapshot' : 'Publish Official Transcript'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-2 bg-white text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer"
              aria-label="Close transcript modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(publishMsg || publishErr) && (
          <div
            className={`px-5 py-2.5 text-xs font-medium flex items-center gap-2 print:hidden ${
              publishErr ? 'bg-rose-50 text-rose-700 border-b border-rose-200' : 'bg-emerald-50 text-emerald-800 border-b border-emerald-200'
            }`}
          >
            {publishErr ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{publishErr || publishMsg}</span>
          </div>
        )}

        {/* Printable Official Document Body */}
        <div className="p-6 sm:p-8 space-y-6 text-slate-900 print:p-6">
          {/* Institutional Letterhead */}
          <div className="border-b-2 border-slate-900 pb-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {transcript.school?.logo_url ? (
                <img
                  src={transcript.school.logo_url}
                  alt={transcript.school?.name || 'Institution logo'}
                  className="w-16 h-16 object-contain rounded-lg border border-slate-200 p-1 bg-white shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-lg shrink-0">
                  {String(transcript.school?.name || 'BI').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 uppercase">
                  {transcript.school?.name || 'Academic Institution'}
                </h1>
                <p className="text-xs text-slate-600 mt-0.5">
                  {[transcript.school?.address, transcript.school?.lga, transcript.school?.state].filter(Boolean).join(', ')}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {[transcript.school?.email, transcript.school?.phone, transcript.school?.website].filter(Boolean).join(' · ')}
                </p>
                <p className="text-xs font-bold tracking-wider uppercase text-emerald-700 mt-2">
                  {isTertiary
                    ? 'Official Cumulative Academic Career Transcript'
                    : 'Official Multi-Year Cumulative Academic Statement'}
                </p>
              </div>
            </div>

            <div className="sm:text-right border border-slate-200 rounded-lg px-3.5 py-2.5 bg-slate-50/70 shrink-0">
              <div className="flex items-center sm:justify-end gap-1.5 text-[11px] font-semibold text-emerald-700">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{transcript.is_official ? 'VERIFIED OFFICIAL RECORD' : 'UNPUBLISHED DRAFT'}</span>
              </div>
              <p className="font-mono text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                {transcript.verification_code}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                Issued: {new Date(transcript.published_at || transcript.generated_at).toLocaleDateString('en-NG', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </div>
          </div>

          {/* Learner Biodata & Standing Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3 border-b border-slate-200 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Full Name</p>
              <p className="font-bold text-slate-900 mt-0.5">{transcript.student?.full_name}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{labels.studentId}</p>
              <p className="font-mono font-semibold text-slate-900 mt-0.5">{transcript.student?.admission_number || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                {transcript.student?.student_status === 'GRADUATED' ? `Final ${labels.classLabel}` : `Current ${labels.classLabel}`}
              </p>
              <p className="font-semibold text-slate-900 mt-0.5">
                {transcript.student?.current_class_name}
                {transcript.student?.current_class_arm_name ? ` (${transcript.student.current_class_arm_name})` : ''}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Enrollment Status</p>
              <p
                className={`font-bold mt-0.5 ${
                  transcript.student?.student_status === 'GRADUATED'
                    ? 'text-emerald-700'
                    : 'text-slate-900'
                }`}
              >
                {transcript.student?.student_status === 'GRADUATED'
                  ? `GRADUATED${transcript.student?.graduation_session_name ? ` (${transcript.student.graduation_session_name})` : ''}`
                  : transcript.student?.student_status || 'ACTIVE'}
              </p>
            </div>
          </div>

          {/* Lifetime Cumulative KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 border border-slate-200 rounded-xl divide-y md:divide-y-0 md:divide-x divide-slate-200 bg-slate-50/60">
            <div className="p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {isGpaMode ? 'Lifetime Cumulative CGPA' : 'Lifetime Cumulative Avg'}
              </p>
              <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                {isGpaMode
                  ? `${transcript.summary?.lifetime_cgpa !== null && transcript.summary?.lifetime_cgpa !== undefined ? Number(transcript.summary.lifetime_cgpa).toFixed(2) : '—'} / ${gpaMax.toFixed(2)}`
                  : `${Number(transcript.summary?.lifetime_average || 0).toFixed(1)}%`}
              </p>
            </div>
            <div className="p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {isGpaMode ? 'Final Classification' : 'Overall Standing'}
              </p>
              <p className="text-sm font-bold text-emerald-700 mt-1.5 leading-snug">
                {transcript.summary?.final_standing || '—'}
              </p>
            </div>
            <div className="p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Academic Tenure</p>
              <p className="text-sm font-bold text-slate-900 mt-1.5 tabular-nums">
                {transcript.summary?.sessions_count || 0} Session{Number(transcript.summary?.sessions_count) === 1 ? '' : 's'} ·{' '}
                {transcript.summary?.terms_count || 0} {labels.cycle}
                {Number(transcript.summary?.terms_count) === 1 ? '' : 's'}
              </p>
            </div>
            <div className="p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {isGpaMode ? 'Credit Units Earned' : `${labels.subjectPlural} Graded`}
              </p>
              <p className="text-sm font-bold text-slate-900 mt-1.5 tabular-nums">
                {isGpaMode
                  ? `${transcript.summary?.total_credit_units_earned ?? 0} / ${transcript.summary?.total_credit_units_attempted ?? 0} Units`
                  : `${transcript.summary?.total_subjects_courses || 0} Records`}
              </p>
            </div>
            <div className="p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {isGpaMode ? 'Outstanding Carryovers' : 'Bursary Clearance'}
              </p>
              {isGpaMode ? (
                <p
                  className={`text-sm font-bold mt-1.5 tabular-nums ${
                    Number(transcript.summary?.uncleared_carryovers_count || 0) > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {Number(transcript.summary?.uncleared_carryovers_count || 0) === 0
                    ? '0 (All Cleared)'
                    : `${transcript.summary.uncleared_carryovers_count} Pending`}
                </p>
              ) : (
                <p
                  className={`text-sm font-bold mt-1.5 ${
                    transcript.fee_clearance?.is_cleared ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {transcript.fee_clearance?.is_cleared
                    ? 'Cleared'
                    : `Arrears: ${formatNaira(transcript.fee_clearance?.outstanding_balance_kobo || 0)}`}
                </p>
              )}
            </div>
          </div>

          {/* Chronological Multi-Year Session Breakdown */}
          {(!transcript.sessions || transcript.sessions.length === 0) ? (
            <div className="py-12 text-center border border-dashed border-slate-300 rounded-xl text-xs text-slate-500">
              No graded academic records have been recorded for this learner across any session yet.
            </div>
          ) : (
            <div className="space-y-6">
              {transcript.sessions.map((ses: any, idx: number) => (
                <div key={ses.academic_session_id || idx} className="border border-slate-200 rounded-xl overflow-hidden break-inside-avoid">
                  <div className="px-4 py-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-emerald-400 font-bold">YEAR {idx + 1}</span>
                      <span className="font-bold text-sm">{ses.session_name}</span>
                      <span className="text-slate-300">
                        {ses.class_name}
                        {ses.class_arm_name ? ` · ${ses.class_arm_name}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 tabular-nums">
                      {isGpaMode ? (
                        <>
                          <span>
                            Session GPA: <strong>{ses.session_gpa !== null ? Number(ses.session_gpa).toFixed(2) : '—'}</strong>
                          </span>
                          <span>
                            Running CGPA:{' '}
                            <strong className="text-emerald-300">
                              {ses.cumulative_cgpa_after !== null ? Number(ses.cumulative_cgpa_after).toFixed(2) : '—'}
                            </strong>
                          </span>
                        </>
                      ) : (
                        <>
                          <span>
                            Session Avg: <strong>{Number(ses.session_average || 0).toFixed(1)}%</strong>
                          </span>
                          <span>
                            Cumulative Avg:{' '}
                            <strong className="text-emerald-300">{Number(ses.cumulative_average_after || 0).toFixed(1)}%</strong>
                          </span>
                        </>
                      )}
                      <span className="uppercase tracking-wider text-[10px] font-bold text-slate-200 border-l border-slate-700 pl-3">
                        {ses.outcome || 'COMPLETED'}
                      </span>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {(ses.terms || []).map((term: any) => (
                      <div key={term.term_id} className="p-4 space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <h4 className="font-bold text-slate-800">{term.term_name}</h4>
                          <div className="text-slate-600 tabular-nums font-medium">
                            {isGpaMode ? (
                              <>
                                GPA: <strong className="text-slate-900">{term.gpa !== null ? Number(term.gpa).toFixed(2) : '—'}</strong>
                                {' · '}
                                Units: {term.credit_units_earned ?? 0}/{term.credit_units_attempted ?? 0}
                              </>
                            ) : (
                              <>
                                Average: <strong className="text-slate-900">{Number(term.average_score || 0).toFixed(1)}%</strong>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-y border-slate-200 bg-slate-50 text-[11px] text-slate-500 uppercase">
                                <th className="py-2 px-2.5 font-semibold">Code</th>
                                <th className="py-2 px-2.5 font-semibold">{labels.subject}</th>
                                {isGpaMode && <th className="py-2 px-2.5 font-semibold text-right">Units</th>}
                                <th className="py-2 px-2.5 font-semibold text-right">CA</th>
                                <th className="py-2 px-2.5 font-semibold text-right">Exam</th>
                                <th className="py-2 px-2.5 font-semibold text-right">Total</th>
                                <th className="py-2 px-2.5 font-semibold text-center">Grade</th>
                                {isGpaMode && <th className="py-2 px-2.5 font-semibold text-right">GP</th>}
                                {isGpaMode && <th className="py-2 px-2.5 font-semibold text-right">QP</th>}
                                <th className="py-2 px-2.5 font-semibold text-right">Remark</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 tabular-nums">
                              {(term.courses || []).map((c: any) => (
                                <tr key={c.subject_id} className={!c.passed ? 'bg-rose-50/50' : ''}>
                                  <td className="py-2 px-2.5 font-mono text-slate-600">{c.subject_code || '—'}</td>
                                  <td className="py-2 px-2.5 font-medium text-slate-900">{c.subject_name}</td>
                                  {isGpaMode && <td className="py-2 px-2.5 text-right text-slate-700">{c.credit_units}</td>}
                                  <td className="py-2 px-2.5 text-right text-slate-600">{c.ca_score ?? '—'}</td>
                                  <td className="py-2 px-2.5 text-right text-slate-600">{c.exam_score ?? '—'}</td>
                                  <td className="py-2 px-2.5 text-right font-semibold text-slate-900">
                                    {Number(c.total_score || 0).toFixed(1)}
                                  </td>
                                  <td className={`py-2 px-2.5 text-center font-bold ${c.passed ? 'text-slate-900' : 'text-rose-700'}`}>
                                    {c.grade}
                                  </td>
                                  {isGpaMode && (
                                    <td className="py-2 px-2.5 text-right text-slate-700">
                                      {c.grade_point !== null ? Number(c.grade_point).toFixed(2) : '—'}
                                    </td>
                                  )}
                                  {isGpaMode && (
                                    <td className="py-2 px-2.5 text-right font-semibold text-slate-900">
                                      {c.quality_points !== null ? Number(c.quality_points).toFixed(2) : '—'}
                                    </td>
                                  )}
                                  <td className={`py-2 px-2.5 text-right font-medium ${c.passed ? 'text-slate-600' : 'text-rose-700'}`}>
                                    {c.passed ? c.remark : 'Carryover / Fail'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Carryover & Clearance Tracker (only shown if any course was ever failed) */}
          {Array.isArray(transcript.carryovers) && transcript.carryovers.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3 break-inside-avoid">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Carryover &amp; Retake Clearance Ledger
                </h3>
                <span className="text-xs font-semibold tabular-nums text-slate-600">
                  {transcript.summary?.uncleared_carryovers_count || 0} Outstanding of {transcript.carryovers.length} Historical Fail(s)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-y border-slate-200 bg-slate-50 text-[11px] text-slate-500 uppercase">
                      <th className="py-2 px-2.5">{labels.subject}</th>
                      <th className="py-2 px-2.5">Failed In</th>
                      <th className="py-2 px-2.5 text-right">Score</th>
                      <th className="py-2 px-2.5">Clearance Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {transcript.carryovers.map((co: any, i: number) => (
                      <tr key={`${co.subject_id}-${i}`}>
                        <td className="py-2 px-2.5 font-medium text-slate-900">
                          {co.subject_code ? `${co.subject_code} · ` : ''}{co.subject_name}
                        </td>
                        <td className="py-2 px-2.5 text-slate-600">
                          {co.failed_session_name} ({co.failed_term_name})
                        </td>
                        <td className="py-2 px-2.5 text-right text-rose-700 font-semibold">
                          {Number(co.failed_score).toFixed(1)}% ({co.failed_grade})
                        </td>
                        <td className="py-2 px-2.5 font-semibold">
                          {co.cleared ? (
                            <span className="text-emerald-700">
                              Cleared in {co.cleared_session_name} ({Number(co.cleared_score).toFixed(1)}% / {co.cleared_grade})
                            </span>
                          ) : (
                            <span className="text-rose-700">Outstanding Carryover</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Official Remarks & Verification Footer */}
          <div className="border-t border-slate-200 pt-5 space-y-4 break-inside-avoid">
            {canPublish ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:hidden">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {isTertiary ? 'Academic Registrar / Senate Remark' : 'Head of School / Principal Remark'}
                  </label>
                  <input
                    type="text"
                    value={registrarRemark}
                    onChange={(e) => setRegistrarRemark(e.target.value)}
                    placeholder="e.g. Satisfied all academic requirements for graduation."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {isTertiary ? 'Dean / Provost Endorsement Note' : 'Director / Proprietor Endorsement Note'}
                  </label>
                  <input
                    type="text"
                    value={principalRemark}
                    onChange={(e) => setPrincipalRemark(e.target.value)}
                    placeholder="Optional endorsement remark..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>
            ) : null}

            {(registrarRemark || principalRemark) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                {registrarRemark && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {isTertiary ? 'Registrar Remark' : 'Principal Remark'}
                    </p>
                    <p className="text-slate-900 mt-1">{registrarRemark}</p>
                  </div>
                )}
                {principalRemark && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Endorsement Note
                    </p>
                    <p className="text-slate-900 mt-1">{principalRemark}</p>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-8 pt-6 text-xs">
              <div>
                <div className="border-t border-slate-400 pt-2 font-semibold text-slate-800">
                  {labels.head}
                </div>
                <p className="text-[11px] text-slate-500">Authorized Signature &amp; Institutional Seal</p>
              </div>
              <div className="text-right">
                <div className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                  <Award className="w-4 h-4" />
                  <span>Online Document Authenticity Verification</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1">
                  Verify this transcript anytime using code <strong className="font-mono text-slate-900">{transcript.verification_code}</strong> on the institution&apos;s public verification portal.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};
