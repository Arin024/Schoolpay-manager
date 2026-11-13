import React from 'react';
import { Printer, X, FileText, ShieldCheck } from 'lucide-react';
import { ReportCardItem, ReportCardBreakdown } from '../../types/index.js';
import { WorkflowStatusBadge } from '../common/StatusBadge.js';

interface PrintableReportCardModalProps {
  reportCard: ReportCardItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export const PrintableReportCardModal: React.FC<PrintableReportCardModalProps> = ({
  reportCard,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !reportCard) return null;

  const breakdown: ReportCardBreakdown | null = reportCard.breakdown || null;
  const schoolName = breakdown?.school?.name || 'Official Academic Report';
  const schoolLocation = [breakdown?.school?.address, breakdown?.school?.lga, breakdown?.school?.state]
    .filter(Boolean)
    .join(', ');
  const studentName = breakdown?.student?.full_name || reportCard.student_name || 'Student';
  const admissionNo = breakdown?.student?.admission_number || reportCard.admission_number || '—';
  const className = breakdown?.student?.class_name || reportCard.class_name || 'Unassigned';
  const sessionName = breakdown?.sessionName || reportCard.session_name || '—';
  const termName = breakdown?.termName || reportCard.term_name || '—';
  const verificationCode = breakdown?.verificationCode || reportCard.verification_code || 'PENDING';
  const showPosition = breakdown?.showClassPosition ?? true;
  const classPos = breakdown?.class_position ?? reportCard.class_position;
  const classSize = breakdown?.class_size ?? reportCard.class_size;
  const totalScore = Number(breakdown?.total_score ?? reportCard.total_score ?? 0);
  const averageScore = Number(breakdown?.average_score ?? reportCard.average_score ?? 0);
  const subjectsCount = Number(breakdown?.subjects_count ?? reportCard.subjects_count ?? 0);
  const overallGrade = breakdown?.overall_grade || reportCard.overall_grade;
  const subjects = breakdown?.subjects || [];
  const attendance = breakdown?.attendance_summary;
  const behaviour = breakdown?.behaviour_summary;
  const teacherRemark = breakdown?.teacher_remark ?? reportCard.teacher_remark;
  const teacherAuthor = breakdown?.teacher_remark_author;
  const principalRemark = breakdown?.principal_remark ?? reportCard.principal_remark;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/65 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6 print:my-0 print:border-none print:shadow-none print:w-full print:max-w-none">
        {/* Toolbar - hidden when printing */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white print:hidden">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold text-sm">Official Digital Report Card</span>
            <WorkflowStatusBadge status={reportCard.status} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close report card"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Body */}
        <div className="p-6 sm:p-8 space-y-6 text-xs text-slate-800">
          {/* School Letterhead */}
          <div className="border-b border-slate-200 pb-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">{schoolName}</h2>
              {schoolLocation && <p className="text-slate-500 mt-0.5">{schoolLocation}</p>}
              {(breakdown?.school?.phone || breakdown?.school?.email) && (
                <p className="text-slate-500 mt-0.5">
                  {[breakdown?.school?.phone, breakdown?.school?.email].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className="sm:text-right space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Terminal Academic Report
              </p>
              <p className="font-bold text-slate-900 text-sm">
                {sessionName} · {termName}
              </p>
              <p className="font-mono text-[11px] text-slate-600 inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Verification: {verificationCode}</span>
              </p>
            </div>
          </div>

          {/* Student Bio & Overall Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3 border-b border-slate-200">
            <div>
              <p className="text-[11px] text-slate-500">Student Name</p>
              <p className="font-bold text-slate-900 text-sm mt-0.5">{studentName}</p>
              <p className="font-mono text-[11px] text-slate-500">{admissionNo}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Class</p>
              <p className="font-bold text-slate-900 text-sm mt-0.5">{className}</p>
              <p className="text-[11px] text-slate-500 tabular-nums">{subjectsCount} Subject(s)</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Total &amp; Average</p>
              <p className="font-bold text-slate-900 text-sm mt-0.5 tabular-nums">
                {averageScore.toFixed(1)}% ({overallGrade?.grade || '—'})
              </p>
              <p className="text-[11px] text-slate-500 tabular-nums">
                Aggregate: {totalScore.toFixed(1)} · {overallGrade?.remark || ''}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">
                {showPosition ? 'Class Standing' : 'Report Status'}
              </p>
              {showPosition && classPos ? (
                <>
                  <p className="font-bold text-emerald-700 text-sm mt-0.5 tabular-nums">
                    Position {classPos} of {classSize || '—'}
                  </p>
                  <p className="text-[11px] text-slate-500">Class Cohort Ranking</p>
                </>
              ) : (
                <>
                  <p className="font-bold text-slate-900 text-sm mt-0.5">{reportCard.status}</p>
                  <p className="text-[11px] text-slate-500">
                    {reportCard.published_at ? new Date(reportCard.published_at).toLocaleDateString() : 'Unpublished'}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Subject Breakdown Table */}
          <div>
            <h3 className="font-bold text-slate-900 text-sm mb-2">Academic Subject Breakdown</h3>
            {subjects.length === 0 ? (
              <p className="text-slate-500 italic py-4">No subject scores included in this report snapshot.</p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3 text-right">CA</th>
                      <th className="py-2.5 px-3 text-right">Exam</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      <th className="py-2.5 px-3 text-center">Grade</th>
                      <th className="py-2.5 px-3">Remark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {subjects.map((sub, idx) => (
                      <tr key={sub.subject_id || idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {sub.subject_name}
                          {sub.subject_code ? (
                            <span className="ml-1.5 text-[10px] font-mono text-slate-400">{sub.subject_code}</span>
                          ) : null}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                          {sub.ca_score ?? '—'}
                          {sub.ca_max_score ? <span className="text-[10px] text-slate-400">/{sub.ca_max_score}</span> : null}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                          {sub.exam_score ?? '—'}
                          {sub.exam_max_score ? <span className="text-[10px] text-slate-400">/{sub.exam_max_score}</span> : null}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold tabular-nums text-slate-900">
                          {sub.total_score ?? '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-slate-900">
                          {sub.grade || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {sub.subject_remark || sub.grade_remark || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Attendance & Conduct Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <h4 className="font-bold text-slate-900">Attendance Summary</h4>
              {attendance && attendance.totalDays > 0 ? (
                <div className="grid grid-cols-4 gap-2 text-center pt-1">
                  <div>
                    <p className="text-[10px] text-slate-500">Rate</p>
                    <p className="font-bold text-emerald-700 text-sm tabular-nums">{attendance.attendanceRatePct}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">Present</p>
                    <p className="font-bold text-slate-900 text-sm tabular-nums">{attendance.present}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">Late</p>
                    <p className="font-bold text-amber-700 text-sm tabular-nums">{attendance.late}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">Absent</p>
                    <p className="font-bold text-rose-700 text-sm tabular-nums">{attendance.absent}</p>
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 italic">No published attendance records for this term.</p>
              )}
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <h4 className="font-bold text-slate-900">Behaviour &amp; Conduct</h4>
              {behaviour && behaviour.totalRecords > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-slate-600 tabular-nums">
                    {behaviour.positiveCount} commendation(s) · {behaviour.disciplineCount} discipline note(s)
                  </p>
                  {behaviour.highlights && behaviour.highlights.length > 0 && (
                    <ul className="space-y-1 text-[11px] text-slate-700">
                      {behaviour.highlights.slice(0, 3).map((h, i) => (
                        <li key={i}>
                          • {h.title} ({h.category})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="text-slate-500 italic">Satisfactory conduct; no special notes recorded.</p>
              )}
            </div>
          </div>

          {/* Official Remarks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
            <div className="p-4 rounded-xl border border-slate-200 space-y-1">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Class Teacher Remark {teacherAuthor ? `(${teacherAuthor})` : ''}
              </p>
              <p className="text-slate-800 leading-relaxed">
                {teacherRemark || 'No class teacher remark recorded.'}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 space-y-1">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Principal / Head of School Remark
              </p>
              <p className="text-slate-800 leading-relaxed">
                {principalRemark || 'Approved for term record.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
