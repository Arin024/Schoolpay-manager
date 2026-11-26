import React, { useState } from 'react';
import {
  History,
  Upload,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  X,
  ArrowRight,
} from 'lucide-react';
import { api } from '../../services/api';
import { HistoricalBacklogInputRow, Student } from '../../types';

interface HistoricalBacklogImportModalProps {
  students: Student[];
  isTertiary: boolean;
  subjectLabel: string;
  subjectPlural: string;
  classLabel: string;
  cycleLabel: string;
  learnerLabel: string;
  onClose: () => void;
  onImported: (message: string) => void;
}

interface EditableBacklogRow {
  id: string;
  admission_number: string;
  session_name: string;
  term_name: string;
  class_name: string;
  subject_code: string;
  subject_name: string;
  credit_units: string;
  ca_score: string;
  exam_score: string;
  total_score: string;
}

export const HistoricalBacklogImportModal: React.FC<HistoricalBacklogImportModalProps> = ({
  students,
  isTertiary,
  subjectLabel,
  subjectPlural,
  classLabel,
  cycleLabel,
  learnerLabel,
  onClose,
  onImported,
}) => {
  const sampleAdm = students[0]?.admission_number || (isTertiary ? 'MAT/2023/001' : 'STU/2023/001');

  const makeRow = (): EditableBacklogRow => ({
    id: `bh_${Math.random().toString(36).slice(2, 9)}`,
    admission_number: students[0]?.admission_number || '',
    session_name: '2023/2024',
    term_name: isTertiary ? 'First Semester' : '1st Term',
    class_name: isTertiary ? '100 Level' : 'JSS 1',
    subject_code: '',
    subject_name: '',
    credit_units: '3',
    ca_score: '',
    exam_score: '',
    total_score: '',
  });

  const [inputTab, setInputTab] = useState<'BUILDER' | 'CSV'>('BUILDER');
  const [rows, setRows] = useState<EditableBacklogRow[]>([makeRow(), makeRow()]);
  const [csvText, setCsvText] = useState('');
  const [publishScores, setPublishScores] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<Awaited<ReturnType<typeof api.previewHistoricalBacklog>> | null>(null);

  const updateRow = (id: string, patch: Partial<EditableBacklogRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setPreviewData(null);
  };

  const downloadCsvTemplate = () => {
    const header = 'admission_number,session_name,term_name,class_name,subject_code,subject_name,credit_units,ca_score,exam_score,total_score';
    const sampleLines = isTertiary
      ? [
          `${sampleAdm},2023/2024,First Semester,100 Level,CSC101,Introduction to Computer Science,3,26,52,78`,
          `${sampleAdm},2023/2024,First Semester,100 Level,GST101,Use of English,2,22,48,70`,
          `${sampleAdm},2023/2024,Second Semester,100 Level,PHY107,Physics Practical I,1,30,55,85`,
          `${sampleAdm},2024/2025,First Semester,200 Level,CSC201,Data Structures and Algorithms,4,28,54,82`,
        ]
      : [
          `${sampleAdm},2023/2024,1st Term,JSS 1,MTH,Mathematics,4,32,50,82`,
          `${sampleAdm},2023/2024,1st Term,JSS 1,ENG,English Studies,4,28,48,76`,
          `${sampleAdm},2024/2025,1st Term,JSS 2,MTH,Mathematics,4,34,54,88`,
        ];
    const csvContent = [header, ...sampleLines].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bursariq-historical-backlog-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseCsvIntoBuilder = (rawText: string) => {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setError('Paste or upload at least one CSV/TSV row.');
      return;
    }

    const parsed: EditableBacklogRow[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.includes('\t') ? line.split('\t') : line.split(',');
      const cols = parts.map((c) => c.trim().replace(/^"|"$/g, ''));
      if (i === 0 && /admission|matric|student/i.test(cols[0] || '') && /session|term|class/i.test(cols.join(' '))) {
        continue;
      }
      if (cols.length < 5) continue;
      parsed.push({
        id: `bh_${Math.random().toString(36).slice(2, 9)}`,
        admission_number: cols[0] || '',
        session_name: cols[1] || '',
        term_name: cols[2] || '',
        class_name: cols[3] || '',
        subject_code: cols[4] || '',
        subject_name: cols[5] || cols[4] || '',
        credit_units: cols[6] || '3',
        ca_score: cols[7] || '',
        exam_score: cols[8] || '',
        total_score: cols[9] || '',
      });
    }

    if (parsed.length === 0) {
      setError('No valid rows detected. Use columns: admission_number, session_name, term_name, class_name, subject_code, subject_name, credit_units, ca_score, exam_score, total_score.');
      return;
    }
    setRows(parsed);
    setInputTab('BUILDER');
    setError(null);
    setPreviewData(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setCsvText(text);
      parseCsvIntoBuilder(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const buildPayloadRows = (): HistoricalBacklogInputRow[] => {
    return rows
      .filter((r) => r.admission_number.trim() && (r.subject_name.trim() || r.subject_code.trim()))
      .map((r) => ({
        admission_number: r.admission_number.trim(),
        session_name: r.session_name.trim(),
        term_name: r.term_name.trim(),
        class_name: r.class_name.trim(),
        subject_code: r.subject_code.trim().toUpperCase(),
        subject_name: r.subject_name.trim() || r.subject_code.trim().toUpperCase(),
        credit_units: r.credit_units.trim() === '' ? 3 : Number(r.credit_units),
        ca_score: r.ca_score.trim() !== '' ? Number(r.ca_score) : null,
        exam_score: r.exam_score.trim() !== '' ? Number(r.exam_score) : null,
        total_score: r.total_score.trim() !== '' ? Number(r.total_score) : null,
      }));
  };

  const handlePreview = async () => {
    const payloadRows = buildPayloadRows();
    if (payloadRows.length === 0) {
      setError(`Enter at least one complete historical row with ${learnerLabel} ID, Session, ${cycleLabel}, Past ${classLabel}, and ${subjectLabel}.`);
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const res = await api.previewHistoricalBacklog(payloadRows);
      setPreviewData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to validate historical records.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmImport = async () => {
    const payloadRows = buildPayloadRows();
    if (payloadRows.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.importHistoricalBacklog({
        rows: payloadRows,
        publish_scores: publishScores,
      });
      onImported(res.message);
    } catch (err: any) {
      setError(err?.message || 'Historical backlog import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-700" />
              <h3 className="text-base font-bold text-slate-900">
                Upload Previous Years, {cycleLabel}s & Past {classLabel} Records
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ideal for newly onboarded institutions migrating prior academic history. Records are safely anchored to past sessions & {classLabel.toLowerCase()}s — current placements are never altered.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Close historical backlog modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Safety Guarantee Strip */}
        <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-100 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              <strong>Zero-Distortion Guarantee:</strong> Past sessions are created as archived history and never overwrite any {learnerLabel.toLowerCase()}&apos;s current {classLabel.toLowerCase()}. Imported scores aggregate automatically into Multi-Year Career Transcripts & CGPA.
            </span>
          </div>
          <button
            type="button"
            onClick={downloadCsvTemplate}
            className="px-2.5 py-1 bg-white border border-emerald-300 text-emerald-800 font-semibold rounded-md hover:bg-emerald-100/50 flex items-center gap-1 shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download CSV Template
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setInputTab('BUILDER')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
                inputTab === 'BUILDER'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Interactive Table ({rows.length} rows)
            </button>
            <button
              type="button"
              onClick={() => setInputTab('CSV')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border flex items-center gap-1.5 ${
                inputTab === 'CSV'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload CSV / Paste Excel
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={publishScores}
              onChange={(e) => setPublishScores(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            Publish imported historical scores immediately (for Career Transcripts)
          </label>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {inputTab === 'CSV' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50">
                <div className="text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">Upload a `.csv` file or paste spreadsheet rows below</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    Columns: admission_number, session_name, term_name, class_name, subject_code, subject_name, credit_units, ca_score, exam_score, total_score
                  </p>
                </div>
                <label className="px-3.5 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  Choose CSV File
                  <input type="file" accept=".csv,text/csv,.txt" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              <textarea
                rows={8}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={`${sampleAdm}, 2023/2024, ${isTertiary ? 'First Semester, 100 Level, CSC101, Intro to Computing, 3, 25, 50, 75' : '1st Term, JSS 1, MTH, Mathematics, 4, 30, 50, 80'}`}
                className="w-full px-3 py-2.5 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => parseCsvIntoBuilder(csvText)}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  Load Pasted Rows into Table
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse min-w-[960px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-2 py-2 w-40">{learnerLabel} ID *</th>
                      <th className="px-2 py-2 w-28">Past Session *</th>
                      <th className="px-2 py-2 w-32">Past {cycleLabel} *</th>
                      <th className="px-2 py-2 w-28">Past {classLabel} *</th>
                      <th className="px-2 py-2 w-24">Code</th>
                      <th className="px-2 py-2">{subjectLabel} Title *</th>
                      <th className="px-2 py-2 w-16 text-center">Units</th>
                      <th className="px-2 py-2 w-16 text-center">CA</th>
                      <th className="px-2 py-2 w-16 text-center">Exam</th>
                      <th className="px-2 py-2 w-16 text-center">Total</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="px-1.5 py-1.5">
                          <input
                            list="backlog-student-ids"
                            value={row.admission_number}
                            onChange={(e) => updateRow(row.id, { admission_number: e.target.value })}
                            placeholder={sampleAdm}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="text"
                            value={row.session_name}
                            onChange={(e) => updateRow(row.id, { session_name: e.target.value })}
                            placeholder="2023/2024"
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="text"
                            value={row.term_name}
                            onChange={(e) => updateRow(row.id, { term_name: e.target.value })}
                            placeholder={isTertiary ? 'First Semester' : '1st Term'}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="text"
                            value={row.class_name}
                            onChange={(e) => updateRow(row.id, { class_name: e.target.value })}
                            placeholder={isTertiary ? '100 Level' : 'JSS 1'}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="text"
                            value={row.subject_code}
                            onChange={(e) => updateRow(row.id, { subject_code: e.target.value.toUpperCase() })}
                            placeholder={isTertiary ? 'CSC101' : 'MTH'}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono uppercase"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="text"
                            value={row.subject_name}
                            onChange={(e) => updateRow(row.id, { subject_name: e.target.value })}
                            placeholder={isTertiary ? 'Intro to Computing' : 'Mathematics'}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="number"
                            min={0}
                            max={12}
                            value={row.credit_units}
                            onChange={(e) => updateRow(row.id, { credit_units: e.target.value })}
                            className="w-full px-1.5 py-1 border border-slate-200 rounded text-xs text-center font-semibold tabular-nums"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={row.ca_score}
                            onChange={(e) => updateRow(row.id, { ca_score: e.target.value })}
                            placeholder="Opt"
                            className="w-full px-1.5 py-1 border border-slate-200 rounded text-xs text-center tabular-nums"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={row.exam_score}
                            onChange={(e) => updateRow(row.id, { exam_score: e.target.value })}
                            placeholder="Opt"
                            className="w-full px-1.5 py-1 border border-slate-200 rounded text-xs text-center tabular-nums"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={row.total_score}
                            onChange={(e) => updateRow(row.id, { total_score: e.target.value })}
                            placeholder="0-100"
                            className="w-full px-1.5 py-1 border border-slate-200 rounded text-xs text-center font-semibold tabular-nums"
                          />
                        </td>
                        <td className="px-1.5 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== row.id) : [makeRow()]))}
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id="backlog-student-ids">
                  {students.map((s) => (
                    <option key={s.id} value={s.admission_number || ''}>
                      {s.full_name} ({s.class_name || 'Unassigned'})
                    </option>
                  ))}
                </datalist>
              </div>

              <button
                type="button"
                onClick={() => setRows((prev) => [...prev, makeRow()])}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Historical Row
              </button>
            </div>
          )}

          {/* Dry-Run Validation Preview */}
          {previewData && (
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Dry-Run Validation Summary
                </h4>
                <div className="text-xs tabular-nums text-slate-600">
                  <span className="text-emerald-700 font-bold">{previewData.summary.valid_rows} valid</span> ·{' '}
                  <span className={previewData.summary.invalid_rows > 0 ? 'text-red-600 font-bold' : 'text-slate-500'}>
                    {previewData.summary.invalid_rows} invalid
                  </span>{' '}
                  · {previewData.summary.unique_students} learner(s) · {previewData.summary.rows_with_scores} with scores
                </div>
              </div>

              {(previewData.summary.will_auto_create.sessions.length > 0 ||
                previewData.summary.will_auto_create.classes.length > 0 ||
                previewData.summary.will_auto_create.subjects.length > 0) && (
                <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                  <p className="font-semibold text-slate-900">Will auto-create missing archived records safely:</p>
                  {previewData.summary.will_auto_create.sessions.length > 0 && (
                    <p>Archived Sessions: {previewData.summary.will_auto_create.sessions.join(', ')}</p>
                  )}
                  {previewData.summary.will_auto_create.classes.length > 0 && (
                    <p>Past {classLabel}s: {previewData.summary.will_auto_create.classes.join(', ')}</p>
                  )}
                  {previewData.summary.will_auto_create.subjects.length > 0 && (
                    <p>{subjectPlural}: {previewData.summary.will_auto_create.subjects.slice(0, 8).join(', ')}{previewData.summary.will_auto_create.subjects.length > 8 ? ` +${previewData.summary.will_auto_create.subjects.length - 8} more` : ''}</p>
                  )}
                </div>
              )}

              {previewData.invalidRows.length > 0 && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                  <p className="font-semibold">Rows with errors (will be skipped unless corrected):</p>
                  {previewData.invalidRows.slice(0, 6).map((inv, idx) => (
                    <p key={idx}>Row {inv.row}: {inv.reason}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Leave CA/Exam/Total blank to import historical {subjectLabel.toLowerCase()} registration only, or fill scores to compute historical CGPA/Averages.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={previewing}
              onClick={handlePreview}
              className="px-4 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 flex items-center gap-1.5"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              {previewing ? 'Validating...' : 'Validate & Preview'}
            </button>
            <button
              type="button"
              disabled={importing || (previewData !== null && previewData.summary.valid_rows === 0)}
              onClick={handleConfirmImport}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {importing ? 'Importing History...' : 'Confirm & Import Records'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
