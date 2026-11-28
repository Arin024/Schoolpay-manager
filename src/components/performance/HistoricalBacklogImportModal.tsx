import React, { useMemo, useState } from 'react';
import {
  Upload,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  X,
  ArrowRight,
  FileSpreadsheet,
  Table2,
  Layers,
} from 'lucide-react';
import { api } from '../../services/api';
import {
  AcademicSessionItem,
  ClassItem,
  HistoricalBacklogInputRow,
  Student,
  SubjectItem,
} from '../../types';
import {
  parseClassBroadsheetMatrix,
  parseLongBulkResultsCsv,
} from '../../utils/bulkResultsPasteParser';

interface HistoricalBacklogImportModalProps {
  students: Student[];
  sessions?: AcademicSessionItem[];
  classes?: ClassItem[];
  subjects?: SubjectItem[];
  departments?: string[];
  schoolType?: string;
  cycleLabels?: string[];
  showCreditUnits?: boolean;
  defaultSessionId?: string;
  defaultTermId?: string;
  defaultClassId?: string;
  isTertiary: boolean;
  subjectLabel: string;
  subjectPlural: string;
  classLabel: string;
  cycleLabel: string;
  learnerLabel: string;
  onClose: () => void;
  onImported: (message: string) => void;
  onOpenManageResults?: () => void;
}

interface EditableBacklogRow {
  id: string;
  admission_number: string;
  student_name?: string;
  session_name: string;
  term_name: string;
  class_name: string;
  department: string;
  subject_code: string;
  subject_name: string;
  credit_units: string;
  ca_score: string;
  exam_score: string;
  total_score: string;
}

export const HistoricalBacklogImportModal: React.FC<HistoricalBacklogImportModalProps> = ({
  students,
  sessions = [],
  classes = [],
  subjects = [],
  departments = [],
  schoolType = '',
  cycleLabels,
  showCreditUnits,
  defaultSessionId,
  defaultTermId,
  defaultClassId,
  isTertiary,
  subjectLabel,
  subjectPlural,
  classLabel,
  cycleLabel,
  learnerLabel,
  onClose,
  onImported,
  onOpenManageResults,
}) => {
  const isPrimarySchool = !isTertiary && /primary|nursery|basic|elementary/i.test(schoolType);
  const displayUnitsCol = showCreditUnits !== undefined ? showCreditUnits : isTertiary;

  const resolvedCycles = useMemo(() => {
    if (Array.isArray(cycleLabels) && cycleLabels.length > 0) return cycleLabels;
    return isTertiary ? ['1st Semester', '2nd Semester'] : ['1st Term', '2nd Term', '3rd Term'];
  }, [cycleLabels, isTertiary]);

  const activeSession = useMemo(
    () =>
      (defaultSessionId && sessions.find((s) => s.id === defaultSessionId)) ||
      sessions.find((s) => s.status === 'ACTIVE') ||
      sessions[0] ||
      null,
    [sessions, defaultSessionId]
  );

  const initialSessionName = activeSession?.name || '2025/2026';
  const initialTermName = useMemo(() => {
    if (defaultTermId && activeSession?.terms) {
      const found = activeSession.terms.find((t) => t.id === defaultTermId);
      if (found) return found.name;
    }
    return activeSession?.terms?.[0]?.name || resolvedCycles[0] || (isTertiary ? '1st Semester' : '1st Term');
  }, [activeSession, defaultTermId, resolvedCycles, isTertiary]);

  const initialClassName = useMemo(() => {
    if (defaultClassId) {
      const found = classes.find((c) => c.id === defaultClassId);
      if (found) return found.name;
    }
    if (classes[0]?.name) return classes[0].name;
    if (isTertiary) return 'Year 1 (100L)';
    if (isPrimarySchool) return 'Primary 4';
    return 'JSS 1';
  }, [classes, defaultClassId, isTertiary, isPrimarySchool]);

  const sampleAdm = students[0]?.admission_number || (isTertiary ? 'MAT/2024/001' : 'STU/2024/001');
  const sampleAdm2 = students[1]?.admission_number || (isTertiary ? 'MAT/2024/002' : 'STU/2024/002');

  const makeRow = (overrides?: Partial<EditableBacklogRow>): EditableBacklogRow => ({
    id: `bh_${Math.random().toString(36).slice(2, 9)}`,
    admission_number: students[0]?.admission_number || '',
    student_name: students[0]?.full_name || '',
    session_name: initialSessionName,
    term_name: initialTermName,
    class_name: initialClassName,
    department: '',
    subject_code: '',
    subject_name: '',
    credit_units: displayUnitsCol ? '3' : '1',
    ca_score: '',
    exam_score: '',
    total_score: '',
    ...overrides,
  });

  // 3 Clean Input Modes: Class Broadsheet Matrix, Multi-Term/Multi-Year CSV, Interactive Table
  const [inputTab, setInputTab] = useState<'MATRIX' | 'CSV' | 'BUILDER'>('MATRIX');

  // Batch target context (used by Broadsheet Matrix AND Quick-Apply Defaults in Builder)
  const [batchSessionName, setBatchSessionName] = useState(initialSessionName);
  const [batchTermName, setBatchTermName] = useState(initialTermName);
  const [batchClassName, setBatchClassName] = useState(initialClassName);
  const [batchDepartment, setBatchDepartment] = useState('');

  const [matrixText, setMatrixText] = useState('');
  const [matrixNotice, setMatrixNotice] = useState<string | null>(null);
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState<EditableBacklogRow[]>([makeRow(), makeRow()]);

  const [publishScores, setPublishScores] = useState(true);
  const [autoGenerateReports, setAutoGenerateReports] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<Awaited<ReturnType<typeof api.previewHistoricalBacklog>> | null>(null);

  const suggestedSessions = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => set.add(s.name));
    const yr = new Date().getFullYear();
    for (let y = yr + 1; y >= yr - 4; y--) {
      set.add(`${y}/${y + 1}`);
    }
    return Array.from(set);
  }, [sessions]);

  const matchedSessionObj = useMemo(
    () => sessions.find((s) => s.name.trim().toLowerCase() === batchSessionName.trim().toLowerCase()) || null,
    [sessions, batchSessionName]
  );

  const termOptionsForBatch = useMemo(() => {
    const names = new Set<string>();
    if (matchedSessionObj?.terms?.length) {
      matchedSessionObj.terms.forEach((t) => names.add(t.name));
    }
    resolvedCycles.forEach((c) => names.add(c));
    return Array.from(names);
  }, [matchedSessionObj, resolvedCycles]);

  const updateRow = (id: string, patch: Partial<EditableBacklogRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setPreviewData(null);
  };

  const applyBatchDefaultsToAllRows = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        session_name: batchSessionName.trim() || r.session_name,
        term_name: batchTermName.trim() || r.term_name,
        class_name: batchClassName.trim() || r.class_name,
        department: batchDepartment.trim(),
      }))
    );
    setPreviewData(null);
  };

  const downloadBroadsheetTemplate = () => {
    const matchedClass = classes.find((c) => c.name.trim().toLowerCase() === batchClassName.trim().toLowerCase());
    const classStudents = students
      .filter((s) => (!matchedClass || s.class_id === matchedClass.id) && (!batchDepartment || (s.class_arm_name || '').toLowerCase() === batchDepartment.toLowerCase()))
      .slice(0, 20);
    const listStudents = classStudents.length > 0 ? classStudents : students.slice(0, 5);

    const classSubjects = subjects
      .filter((sub) => (!matchedClass || !sub.class_id || sub.class_id === matchedClass.id) && sub.status !== 'INACTIVE')
      .slice(0, 8);

    const subjectCols =
      classSubjects.length > 0
        ? classSubjects.map((sub) =>
            displayUnitsCol && sub.code ? `${sub.code} (${sub.credit_units ?? 3}u)` : sub.name
          )
        : isTertiary
          ? ['CSC 101 (3u)', 'GST 101 (2u)', 'MTH 101 (3u)']
          : isPrimarySchool
            ? ['Mathematics', 'English Studies', 'Basic Science', 'Civic Education', 'Quantitative Reasoning']
            : ['Mathematics', 'English Studies', 'Basic Science', 'Civic Education', 'Computer Studies'];

    const header = ['Admission No', 'Student Name', ...subjectCols].join(',');
    const bodyLines =
      listStudents.length > 0
        ? listStudents.map((st, idx) => {
            const sampleScores = subjectCols.map((_, sIdx) => String(70 + ((idx * 5 + sIdx * 4) % 24)));
            return [st.admission_number || '', `"${st.full_name}"`, ...sampleScores].join(',');
          })
        : [
            [sampleAdm, '"Sample Learner One"', ...subjectCols.map((_, i) => String(74 + i * 3))].join(','),
            [sampleAdm2, '"Sample Learner Two"', ...subjectCols.map((_, i) => String(68 + i * 4))].join(','),
          ];

    const blob = new Blob([[header, ...bodyLines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bursariq-class-broadsheet-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadLongCsvTemplate = () => {
    const header = 'admission_number,session_name,term_name,class_name,subject_code,subject_name,credit_units,ca_score,exam_score,total_score';
    const sampleLines = isTertiary
      ? [
          `${sampleAdm},2024/2025,1st Semester,${initialClassName},CSC101,Introduction to Computer Science,3,26,52,78`,
          `${sampleAdm},2024/2025,1st Semester,${initialClassName},GST101,Use of English,2,22,48,70`,
          `${sampleAdm},2024/2025,2nd Semester,${initialClassName},CSC102,Programming Fundamentals,3,30,55,85`,
          `${sampleAdm},2025/2026,1st Semester,Year 2 (200L),CSC201,Data Structures,4,28,54,82`,
        ]
      : isPrimarySchool
        ? [
            `${sampleAdm},2024/2025,1st Term,Primary 4,MTH,Mathematics,1,32,50,82`,
            `${sampleAdm},2024/2025,1st Term,Primary 4,ENG,English Studies,1,28,48,76`,
            `${sampleAdm},2024/2025,2nd Term,Primary 4,MTH,Mathematics,1,34,52,86`,
            `${sampleAdm},2024/2025,3rd Term,Primary 4,MTH,Mathematics,1,35,55,90`,
          ]
        : [
            `${sampleAdm},2024/2025,1st Term,JSS 1,MTH,Mathematics,1,32,50,82`,
            `${sampleAdm},2024/2025,1st Term,JSS 1,ENG,English Studies,1,28,48,76`,
            `${sampleAdm},2024/2025,2nd Term,JSS 1,MTH,Mathematics,1,34,54,88`,
            `${sampleAdm},2024/2025,3rd Term,JSS 1,MTH,Mathematics,1,36,56,92`,
          ];
    const csvContent = [header, ...sampleLines].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bursariq-multi-term-results-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleParseMatrix = (rawText: string) => {
    if (!batchSessionName.trim() || !batchTermName.trim() || !batchClassName.trim()) {
      setError(`Select Academic Session, ${cycleLabel}, and ${classLabel} above before parsing the broadsheet.`);
      return;
    }
    const result = parseClassBroadsheetMatrix(rawText, {
      sessionName: batchSessionName.trim(),
      termName: batchTermName.trim(),
      className: batchClassName.trim(),
      department: batchDepartment.trim(),
      knownSubjects: subjects,
    });
    if (result.error || result.rows.length === 0) {
      setError(result.error || 'Could not parse broadsheet rows.');
      return;
    }
    const mapped: EditableBacklogRow[] = result.rows.map((r) => ({
      id: `bh_${Math.random().toString(36).slice(2, 9)}`,
      admission_number: r.admission_number,
      student_name: r.student_name,
      session_name: r.session_name,
      term_name: r.term_name,
      class_name: r.class_name,
      department: r.department || '',
      subject_code: r.subject_code,
      subject_name: r.subject_name,
      credit_units: displayUnitsCol ? r.credit_units : '1',
      ca_score: r.ca_score,
      exam_score: r.exam_score,
      total_score: r.total_score,
    }));
    setRows(mapped);
    setMatrixNotice(
      `Parsed ${mapped.length} score entries across ${result.studentRowsCount} ${learnerLabel.toLowerCase()}(s) and ${result.detectedSubjects.length} ${subjectPlural.toLowerCase()} for ${batchSessionName} · ${batchTermName} (${batchClassName}).` +
        (result.skippedSummaryCols.length > 0 ? ` Skipped summary columns: ${result.skippedSummaryCols.join(', ')}.` : '')
    );
    setInputTab('BUILDER');
    setError(null);
    setPreviewData(null);
  };

  const handleParseLongCsv = (rawText: string) => {
    const parsed = parseLongBulkResultsCsv(rawText);
    if (parsed.error || parsed.rows.length === 0) {
      setError(parsed.error || 'No valid rows detected.');
      return;
    }
    setRows(
      parsed.rows.map((r) => ({
        id: `bh_${Math.random().toString(36).slice(2, 9)}`,
        admission_number: r.admission_number,
        student_name: r.student_name,
        session_name: r.session_name || batchSessionName,
        term_name: r.term_name || batchTermName,
        class_name: r.class_name || batchClassName,
        department: r.department || batchDepartment,
        subject_code: r.subject_code,
        subject_name: r.subject_name,
        credit_units: r.credit_units || (displayUnitsCol ? '3' : '1'),
        ca_score: r.ca_score,
        exam_score: r.exam_score,
        total_score: r.total_score,
      }))
    );
    setMatrixNotice(null);
    setInputTab('BUILDER');
    setError(null);
    setPreviewData(null);
  };

  const handleFileUpload = (mode: 'MATRIX' | 'CSV') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      if (mode === 'MATRIX') {
        setMatrixText(text);
        handleParseMatrix(text);
      } else {
        setCsvText(text);
        handleParseLongCsv(text);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const buildPayloadRows = (): HistoricalBacklogInputRow[] => {
    return rows
      .filter((r) => (r.admission_number.trim() || (r.student_name || '').trim()) && (r.subject_name.trim() || r.subject_code.trim()))
      .map((r) => ({
        admission_number: r.admission_number.trim(),
        student_name: r.student_name?.trim() || undefined,
        session_name: r.session_name.trim(),
        term_name: r.term_name.trim(),
        class_name: r.class_name.trim(),
        department: r.department.trim() || undefined,
        subject_code: r.subject_code.trim().toUpperCase(),
        subject_name: r.subject_name.trim() || r.subject_code.trim().toUpperCase(),
        credit_units: r.credit_units.trim() === '' ? (displayUnitsCol ? 3 : 1) : Number(r.credit_units),
        ca_score: r.ca_score.trim() !== '' ? Number(r.ca_score) : null,
        exam_score: r.exam_score.trim() !== '' ? Number(r.exam_score) : null,
        total_score: r.total_score.trim() !== '' ? Number(r.total_score) : null,
      }));
  };

  const handlePreview = async () => {
    const payloadRows = buildPayloadRows();
    if (payloadRows.length === 0) {
      setError(
        `Load or enter at least one complete row with ${learnerLabel} ID/Name, Session, ${cycleLabel}, ${classLabel}, and ${subjectLabel}.`
      );
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const res = await api.previewHistoricalBacklog(payloadRows);
      setPreviewData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to validate uploaded result rows.');
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
        auto_generate_reports: autoGenerateReports,
      });
      onImported(res.message);
    } catch (err: any) {
      setError(err?.message || 'Bulk results upload failed.');
    } finally {
      setImporting(false);
    }
  };

  const readyRowCount = buildPayloadRows().length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
              <h3 className="text-base font-bold text-slate-900">
                Bulk Upload {cycleLabel}, Session &amp; Past-Year Results
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload {cycleLabel.toLowerCase()} or full-session results for either the <strong>current academic year</strong> or <strong>previous academic years</strong>. Paste a class broadsheet from Excel, upload a multi-{cycleLabel.toLowerCase()} CSV, or edit rows directly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            aria-label="Close bulk results upload modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Safety Guarantee & Quick Templates Strip */}
        <div className="px-5 py-2.5 bg-emerald-50/80 border-b border-emerald-100 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-950">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              <strong>Safe for Current &amp; Past Years:</strong> Current-session uploads populate live {cycleLabel.toLowerCase()} results; past sessions are archived safely without altering any {learnerLabel.toLowerCase()}&apos;s current {classLabel.toLowerCase()}.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={downloadBroadsheetTemplate}
              className="px-2.5 py-1 bg-white border border-emerald-300 text-emerald-800 font-semibold rounded-md hover:bg-emerald-100/60 flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Broadsheet CSV
            </button>
            <button
              type="button"
              onClick={downloadLongCsvTemplate}
              className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 font-semibold rounded-md hover:bg-slate-100 flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Multi-{cycleLabel} CSV
            </button>
          </div>
        </div>

        {/* Mode Switcher + Publish / Auto-Report Controls */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => setInputTab('MATRIX')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                inputTab === 'MATRIX'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Class Broadsheet (Excel)
            </button>
            <button
              type="button"
              onClick={() => setInputTab('CSV')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                inputTab === 'CSV'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Multi-{cycleLabel} / Multi-Year CSV
            </button>
            <button
              type="button"
              onClick={() => setInputTab('BUILDER')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                inputTab === 'BUILDER'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              Review Table ({readyRowCount})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={publishScores}
                onChange={(e) => setPublishScores(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Publish scores immediately</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoGenerateReports}
                onChange={(e) => setAutoGenerateReports(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Auto-generate {cycleLabel} &amp; Session Report Cards</span>
            </label>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {matrixNotice && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{matrixNotice}</span>
            </div>
          )}

          {/* TAB 1: CLASS BROADSHEET MATRIX (Excel / Google Sheets Paste) */}
          {inputTab === 'MATRIX' && (
            <div className="space-y-4">
              {/* Target Session, Term/Semester, Class/Level, Department Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pb-4 border-b border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Academic Session *
                  </label>
                  <input
                    list="bulk-result-sessions"
                    value={batchSessionName}
                    aria-label="Target Academic Session"
                    onChange={(e) => setBatchSessionName(e.target.value)}
                    placeholder="e.g. 2025/2026 or 2023/2024"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                  />
                  <datalist id="bulk-result-sessions">
                    {suggestedSessions.map((sName) => (
                      <option key={sName} value={sName} />
                    ))}
                  </datalist>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {matchedSessionObj?.status === 'ACTIVE'
                      ? 'Current active academic year'
                      : matchedSessionObj
                        ? 'Existing archived/upcoming session'
                        : 'New past session (created safely as archived)'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {cycleLabel} *
                  </label>
                  <input
                    list="bulk-result-terms"
                    value={batchTermName}
                    aria-label={`Target ${cycleLabel}`}
                    onChange={(e) => setBatchTermName(e.target.value)}
                    placeholder={isTertiary ? '1st Semester' : '1st Term'}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                  />
                  <datalist id="bulk-result-terms">
                    {termOptionsForBatch.map((tName) => (
                      <option key={tName} value={tName} />
                    ))}
                  </datalist>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {isTertiary ? 'e.g. 1st Semester or 2nd Semester' : 'e.g. 1st Term, 2nd Term, or 3rd Term'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {classLabel} *
                  </label>
                  <input
                    list="bulk-result-classes"
                    value={batchClassName}
                    aria-label={`Target ${classLabel}`}
                    onChange={(e) => setBatchClassName(e.target.value)}
                    placeholder={initialClassName}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                  />
                  <datalist id="bulk-result-classes">
                    {classes.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Pick a current or past {classLabel.toLowerCase()}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isTertiary ? 'Department / Programme' : 'Arm / Stream'} (Optional)
                  </label>
                  <input
                    list="bulk-result-depts"
                    value={batchDepartment}
                    aria-label="Target Department or Arm"
                    onChange={(e) => setBatchDepartment(e.target.value)}
                    placeholder={isTertiary ? 'e.g. Family Healthcare' : 'e.g. Gold, Science'}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <datalist id="bulk-result-depts">
                    {departments.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50">
                <div className="text-xs text-slate-600 space-y-0.5">
                  <p className="font-semibold text-slate-900">
                    Paste your class result sheet straight from Excel / Google Sheets, or upload a CSV file
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Row 1 must contain student ID/name plus {subjectPlural.toLowerCase()} as columns. Enter either total scores (e.g. <code className="font-mono text-slate-700">82</code>) or CA/Exam pairs (e.g. <code className="font-mono text-slate-700">30/52</code>). S/N, Total, Average, and Position columns are skipped automatically.
                  </p>
                </div>
                <label className="px-3.5 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  Upload Broadsheet CSV
                  <input type="file" accept=".csv,text/csv,.txt" onChange={handleFileUpload('MATRIX')} className="hidden" />
                </label>
              </div>

              <textarea
                rows={8}
                value={matrixText}
                aria-label="Class Broadsheet Paste Area"
                onChange={(e) => setMatrixText(e.target.value)}
                placeholder={
                  isTertiary
                    ? `Matric No\tStudent Name\tFHC 111 (2u)\tFHC 112 (3u)\tGNS 101 (2u)\n${sampleAdm}\tAdaeze Nwosu\t30/52\t28/50\t75\n${sampleAdm2}\tMusa Ibrahim\t24/44\t25/48\t71`
                    : isPrimarySchool
                      ? `Admission No\tPupil Name\tMathematics\tEnglish Studies\tBasic Science\tCivic Education\n${sampleAdm}\tChidi Okafor\t34/52\t30/48\t84\t88\n${sampleAdm2}\tZainab Musa\t28/46\t32/50\t79\t82`
                      : `Admission No\tStudent Name\tMathematics\tEnglish Studies\tPhysics\tChemistry\n${sampleAdm}\tTunde Adeyemi\t32/54\t29/49\t81\t77\n${sampleAdm2}\tNgozi Eze\t35/56\t31/52\t85\t83`
                }
                className="w-full px-3 py-2.5 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => handleParseMatrix(matrixText)}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 whitespace-nowrap cursor-pointer"
                >
                  Parse Broadsheet into Review Table
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: MULTI-TERM / MULTI-YEAR CSV & EXCEL */}
          {inputTab === 'CSV' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50">
                <div className="text-xs text-slate-600">
                  <p className="font-semibold text-slate-900">
                    Upload multiple {cycleLabel.toLowerCase()}s, full sessions, or multiple previous years in one file
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    Columns: admission_number, session_name, term_name, class_name, subject_code, subject_name, credit_units, ca_score, exam_score, total_score
                  </p>
                </div>
                <label className="px-3.5 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  Choose CSV File
                  <input type="file" accept=".csv,text/csv,.txt" onChange={handleFileUpload('CSV')} className="hidden" />
                </label>
              </div>

              <textarea
                rows={8}
                value={csvText}
                aria-label="Multi-Term CSV Paste Area"
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={`${sampleAdm}, ${initialSessionName}, ${initialTermName}, ${initialClassName}, ${isTertiary ? 'CSC101, Intro to Computing, 3, 25, 50, 75' : 'MTH, Mathematics, 1, 30, 50, 80'}`}
                className="w-full px-3 py-2.5 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => handleParseLongCsv(csvText)}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 whitespace-nowrap cursor-pointer"
                >
                  Load Pasted Rows into Review Table
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: INTERACTIVE REVIEW TABLE */}
          {inputTab === 'BUILDER' && (
            <div className="space-y-3">
              {/* Quick-Apply Session/Term/Class Defaults Strip */}
              <div className="flex flex-wrap items-end gap-2 pb-3 border-b border-slate-200 text-xs">
                <div className="min-w-[130px]">
                  <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Session</label>
                  <input
                    list="bulk-result-sessions-tbl"
                    value={batchSessionName}
                    onChange={(e) => setBatchSessionName(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs"
                  />
                  <datalist id="bulk-result-sessions-tbl">
                    {suggestedSessions.map((sName) => (
                      <option key={sName} value={sName} />
                    ))}
                  </datalist>
                </div>
                <div className="min-w-[130px]">
                  <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{cycleLabel}</label>
                  <input
                    list="bulk-result-terms-tbl"
                    value={batchTermName}
                    onChange={(e) => setBatchTermName(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs"
                  />
                  <datalist id="bulk-result-terms-tbl">
                    {termOptionsForBatch.map((tName) => (
                      <option key={tName} value={tName} />
                    ))}
                  </datalist>
                </div>
                <div className="min-w-[130px]">
                  <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{classLabel}</label>
                  <input
                    list="bulk-result-classes-tbl"
                    value={batchClassName}
                    onChange={(e) => setBatchClassName(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs"
                  />
                  <datalist id="bulk-result-classes-tbl">
                    {classes.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </div>
                <button
                  type="button"
                  onClick={applyBatchDefaultsToAllRows}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md whitespace-nowrap cursor-pointer"
                >
                  Apply to All Rows
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse min-w-[920px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <tr>
                      <th className="px-2 py-2 w-40">{learnerLabel} ID / Name *</th>
                      <th className="px-2 py-2 w-28">Session *</th>
                      <th className="px-2 py-2 w-32">{cycleLabel} *</th>
                      <th className="px-2 py-2 w-28">{classLabel} *</th>
                      <th className="px-2 py-2 w-24">Code</th>
                      <th className="px-2 py-2">{subjectLabel} Title *</th>
                      {displayUnitsCol && <th className="px-2 py-2 w-16 text-center">Units</th>}
                      <th className="px-2 py-2 w-16 text-center">CA</th>
                      <th className="px-2 py-2 w-16 text-center">Exam</th>
                      <th className="px-2 py-2 w-16 text-center">Total</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {rows.slice(0, 150).map((row) => (
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
                            placeholder={initialSessionName}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="text"
                            value={row.term_name}
                            onChange={(e) => updateRow(row.id, { term_name: e.target.value })}
                            placeholder={initialTermName}
                            className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input
                            type="text"
                            value={row.class_name}
                            onChange={(e) => updateRow(row.id, { class_name: e.target.value })}
                            placeholder={initialClassName}
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
                        {displayUnitsCol && (
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
                        )}
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
                            className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                            aria-label="Remove row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 150 && (
                  <p className="px-3 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-200 tabular-nums">
                    Showing first 150 of {rows.length} staged rows. All {rows.length} rows will be validated and imported.
                  </p>
                )}
                <datalist id="backlog-student-ids">
                  {students.map((s) => (
                    <option key={s.id} value={s.admission_number || s.full_name}>
                      {s.full_name} ({s.class_name || 'Unassigned'})
                    </option>
                  ))}
                </datalist>
              </div>

              <button
                type="button"
                onClick={() =>
                  setRows((prev) => [
                    ...prev,
                    makeRow({
                      session_name: batchSessionName || initialSessionName,
                      term_name: batchTermName || initialTermName,
                      class_name: batchClassName || initialClassName,
                      department: batchDepartment,
                    }),
                  ])
                }
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Result Row
              </button>
            </div>
          )}

          {/* Dry-Run Validation Preview */}
          {previewData && (
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-slate-900">
                  Dry-Run Validation Summary
                </h4>
                <div className="text-xs tabular-nums text-slate-600">
                  <span className="text-emerald-700 font-bold">{previewData.summary.valid_rows} valid</span>
                  {' · '}
                  <span className={previewData.summary.invalid_rows > 0 ? 'text-red-600 font-bold' : 'text-slate-500'}>
                    {previewData.summary.invalid_rows} invalid
                  </span>
                  {' · '}
                  {previewData.summary.unique_students} {learnerLabel.toLowerCase()}(s)
                  {' · '}
                  {previewData.summary.rows_with_scores} with scores
                  {typeof previewData.summary.current_year_rows === 'number' &&
                    previewData.summary.current_year_rows > 0 && (
                      <>
                        {' · '}
                        <span className="font-semibold text-slate-800">
                          {previewData.summary.current_year_rows} current year
                        </span>
                      </>
                    )}
                  {typeof previewData.summary.previous_year_rows === 'number' &&
                    previewData.summary.previous_year_rows > 0 && (
                      <>
                        {' · '}
                        <span className="font-semibold text-slate-800">
                          {previewData.summary.previous_year_rows} past/other year
                        </span>
                      </>
                    )}
                </div>
              </div>

              {(previewData.summary.will_auto_create.sessions.length > 0 ||
                previewData.summary.will_auto_create.classes.length > 0 ||
                previewData.summary.will_auto_create.subjects.length > 0) && (
                <div className="text-xs text-slate-700 pt-2 border-t border-slate-200 space-y-1">
                  <p className="font-semibold text-slate-900">Missing records that will be auto-created safely:</p>
                  {previewData.summary.will_auto_create.sessions.length > 0 && (
                    <p>Sessions: {previewData.summary.will_auto_create.sessions.join(', ')}</p>
                  )}
                  {previewData.summary.will_auto_create.classes.length > 0 && (
                    <p>{classLabel}s: {previewData.summary.will_auto_create.classes.join(', ')}</p>
                  )}
                  {previewData.summary.will_auto_create.subjects.length > 0 && (
                    <p>
                      {subjectPlural}: {previewData.summary.will_auto_create.subjects.slice(0, 8).join(', ')}
                      {previewData.summary.will_auto_create.subjects.length > 8
                        ? ` +${previewData.summary.will_auto_create.subjects.length - 8} more`
                        : ''}
                    </p>
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
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>Supports up to 2,500 score rows per batch across Primary, Secondary &amp; Tertiary portals.</span>
            {onOpenManageResults && (
              <button
                type="button"
                onClick={onOpenManageResults}
                className="font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-2 cursor-pointer whitespace-nowrap"
              >
                Need to fix a wrong {classLabel.toLowerCase()} or delete uploaded results?
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={previewing || readyRowCount === 0}
              onClick={handlePreview}
              className="px-4 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              {previewing ? 'Validating...' : 'Validate & Preview'}
            </button>
            <button
              type="button"
              disabled={importing || readyRowCount === 0 || (previewData !== null && previewData.summary.valid_rows === 0)}
              onClick={handleConfirmImport}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {importing ? 'Uploading Results...' : `Upload ${readyRowCount > 0 ? `${readyRowCount} ` : ''}Result${readyRowCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
