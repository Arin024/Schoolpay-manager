import React, { useEffect, useState } from 'react';
import { Download, Printer, X, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';
import { ExamBroadsheetData } from '../../types';

interface ExamBroadsheetModalProps {
  examinationId: string;
  onClose: () => void;
}

function escapeCsvCell(val: unknown): string {
  const str = String(val ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

function formatOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const ExamBroadsheetModal: React.FC<ExamBroadsheetModalProps> = ({
  examinationId,
  onClose,
}) => {
  const [data, setData] = useState<ExamBroadsheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getExamBroadsheet(examinationId)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err: any) => {
        if (active) setError(err?.message || 'Failed to load examination broadsheet.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [examinationId]);

  const handleDownloadCsv = () => {
    if (!data) return;
    const headers = [
      'Rank',
      'Admission / Matric No',
      'Student Name',
      ...data.subjects.map((s) => `${s.code} (${s.credit_units}u)`),
      'Courses Taken',
      'Total Score',
      'Average %',
      ...(data.isGpaMode ? ['Credit Units', 'GPA'] : []),
    ];
    const lines = [
      headers.map(escapeCsvCell).join(','),
      ...data.rows.map((r) =>
        [
          formatOrdinal(r.position),
          r.admission_number || '',
          r.student_name,
          ...data.subjects.map((s) => {
            const sc = r.scores[s.id];
            return sc ? `${sc.total} (${sc.grade})` : '—';
          }),
          r.subjects_count,
          r.total_score,
          `${r.average_score}%`,
          ...(data.isGpaMode ? [r.credit_units ?? 0, r.gpa !== null ? r.gpa.toFixed(2) : '—'] : []),
        ]
          .map(escapeCsvCell)
          .join(',')
      ),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `broadsheet-${data.exam.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Master Examination Broadsheet
              </h3>
              {data && (
                <p className="text-xs text-slate-500">
                  {data.exam.title} · {data.exam.session_name || ''} {data.exam.term_name ? `· ${data.exam.term_name}` : ''} {data.exam.class_name ? `· ${data.exam.class_name}` : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {data && data.rows.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Broadsheet
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              aria-label="Close broadsheet modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">Compiling master broadsheet...</div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No scores have been recorded for this examination yet. Enter scores first to view the Master Broadsheet.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 tabular-nums">
                <span>Learners: <strong className="text-slate-900">{data.rows.length}</strong></span>
                <span>·</span>
                <span>Courses/Subjects: <strong className="text-slate-900">{data.subjects.length}</strong></span>
                <span>·</span>
                <span>
                  Class Avg:{' '}
                  <strong className="text-emerald-700">
                    {(
                      data.rows.reduce((acc, r) => acc + r.average_score, 0) / data.rows.length
                    ).toFixed(1)}%
                  </strong>
                </span>
                <span>·</span>
                <span>Max Score: <strong className="text-slate-900">{data.exam.total_max_score}</strong></span>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase">
                    <tr>
                      <th className="px-3 py-2.5 sticky left-0 bg-slate-50 border-r border-slate-200 w-14">Rank</th>
                      <th className="px-3 py-2.5 border-r border-slate-200 min-w-[180px]">Learner</th>
                      {data.subjects.map((sub) => (
                        <th key={sub.id} className="px-2.5 py-2.5 border-r border-slate-200 text-center whitespace-nowrap" title={sub.name}>
                          <div>{sub.code}</div>
                          <div className="text-[10px] font-normal text-slate-400 tabular-nums">{sub.credit_units}u</div>
                        </th>
                      ))}
                      <th className="px-2.5 py-2.5 border-r border-slate-200 text-center">Total</th>
                      <th className="px-2.5 py-2.5 border-r border-slate-200 text-center">Avg %</th>
                      {data.isGpaMode && (
                        <>
                          <th className="px-2.5 py-2.5 border-r border-slate-200 text-center">Units</th>
                          <th className="px-2.5 py-2.5 text-center">GPA</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {data.rows.map((r) => (
                      <tr key={r.student_id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2 font-bold text-slate-900 sticky left-0 bg-white border-r border-slate-200">
                          {formatOrdinal(r.position)}
                        </td>
                        <td className="px-3 py-2 border-r border-slate-200">
                          <div className="font-semibold text-slate-900">{r.student_name}</div>
                          {r.admission_number && (
                            <div className="text-[10px] font-mono text-slate-500">{r.admission_number}</div>
                          )}
                        </td>
                        {data.subjects.map((sub) => {
                          const sc = r.scores[sub.id];
                          return (
                            <td key={sub.id} className="px-2.5 py-2 border-r border-slate-100 text-center">
                              {sc ? (
                                <div>
                                  <span className="font-semibold text-slate-900">{sc.total}</span>
                                  <span className="ml-1 text-[10px] text-slate-500">{sc.grade}</span>
                                </div>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2.5 py-2 border-r border-slate-200 text-center font-semibold text-slate-900">
                          {r.total_score}
                        </td>
                        <td className="px-2.5 py-2 border-r border-slate-200 text-center font-bold text-emerald-700">
                          {r.average_score.toFixed(1)}%
                        </td>
                        {data.isGpaMode && (
                          <>
                            <td className="px-2.5 py-2 border-r border-slate-200 text-center text-slate-700">
                              {r.credit_units ?? 0}
                            </td>
                            <td className="px-2.5 py-2 text-center font-bold text-slate-900">
                              {r.gpa !== null ? r.gpa.toFixed(2) : '—'}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
