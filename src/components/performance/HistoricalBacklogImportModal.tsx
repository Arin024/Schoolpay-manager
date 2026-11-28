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
  Award,
  Search,
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
import { ModalPortal } from '../common/ModalPortal';

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
  defaultMode?: 'QUICK' | 'MATRIX' | 'CSV' | 'BUILDER';
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

interface QuickScoreEntry {
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
  defaultMode = 'MATRIX',
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

  const initialSessionName = activeSession?.name || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`;
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

  // 4 Input Modes: Quick Award Scores (easiest!), Class Broadsheet Matrix, Multi-Year CSV, Review Table
  const [inputTab, setInputTab] = useState<'QUICK' | 'MATRIX' | 'CSV' | 'BUILDER'>(defaultMode);

  // Batch target context (supports ANY year/session/term — existing OR brand new!)
  const [batchSessionName, setBatchSessionName] = useState(initialSessionName);
  const [batchTermName, setBatchTermName] = useState(initialTermName);
  const [batchClassName, setBatchClassName] = useState(initialClassName);
  const [batchDepartment, setBatchDepartment] = useState('');

  // Quick Award Scores state (1-screen direct scoring for any year/session/term!)
  const [quickSubjectId, setQuickSubjectId] = useState(subjects[0]?.id || '__CUSTOM__');
  const [quickCustomSubjectName, setQuickCustomSubjectName] = useState('');
  const [quickCustomSubjectCode, setQuickCustomSubjectCode] = useState('');
  const [quickCreditUnits, setQuickCreditUnits] = useState(
    subjects[0]?.credit_units !== undefined ? String(subjects[0].credit_units) : displayUnitsCol ? '3' : '1'
  );
  const [quickShowAllStudents, setQuickShowAllStudents] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [quickScores, setQuickScores] = useState<Record<string, QuickScoreEntry>>({});

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
    for (let y = yr + 10; y >= yr - 8; y--) {
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

  // Filtered students for Quick Award Scores (auto-falls back to all students if none match chosen class!)
  const quickMatchingStudents = useMemo(() => {
    const matchedClass = classes.find((c) => c.name.trim().toLowerCase() === batchClassName.trim().toLowerCase());
    let list = students;
    if (!quickShowAllStudents && matchedClass) {
      const inClass = students.filter((s) => {
        if (s.class_id !== matchedClass.id) return false;
        if (batchDepartment.trim()) {
          return (s.class_arm_name || '').trim().toLowerCase() === batchDepartment.trim().toLowerCase();
        }
        return true;
      });
      // If class has students, show them; otherwise fall back cleanly to all school students so admin is never stuck!
      if (inClass.length > 0) list = inClass;
    }
    const q = quickSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          (s.full_name || '').toLowerCase().includes(q) ||
          (s.admission_number || '').toLowerCase().includes(q) ||
          (s.class_name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [students, classes, batchClassName, batchDepartment, quickShowAllStudents, quickSearch]);

  const activeQuickSubject = useMemo(() => {
    if (quickSubjectId === '__CUSTOM__' || !quickSubjectId) {
      return {
        name: quickCustomSubjectName.trim(),
        code: quickCustomSubjectCode.trim().toUpperCase(),
        credit_units: quickCreditUnits.trim() === '' ? (displayUnitsCol ? 3 : 1) : Number(quickCreditUnits),
      };
    }
    const found = subjects.find((s) => s.id === quickSubjectId);
    return {
      name: found?.name || quickCustomSubjectName.trim(),
      code: (found?.code || quickCustomSubjectCode).trim().toUpperCase(),
      credit_units:
        quickCreditUnits.trim() !== ''
          ? Number(quickCreditUnits)
          : found?.credit_units ?? (displayUnitsCol ? 3 : 1),
    };
  }, [quickSubjectId, quickCustomSubjectName, quickCustomSubjectCode, quickCreditUnits, subjects, displayUnitsCol]);

  const updateQuickScore = (studentId: string, field: keyof QuickScoreEntry, value: string) => {
    setQuickScores((prev) => {
      const cur = prev[studentId] || { ca_score: '', exam_score: '', total_score: '' };
      const next = { ...cur, [field]: value };
      if (field === 'ca_score' || field === 'exam_score') {
        const hasAny = next.ca_score.trim() !== '' || next.exam_score.trim() !== '';
        if (hasAny) {
          const ca = next.ca_score.trim() === '' ? 0 : Number(next.ca_score);
          const ex = next.exam_score.trim() === '' ? 0 : Number(next.exam_score);
          if (Number.isFinite(ca) && Number.isFinite(ex)) {
            next.total_score = String(Math.round((ca + ex) * 100) / 100);
          }
        } else {
          next.total_score = '';
        }
      }
      return { ...prev, [studentId]: next };
    });
    setPreviewData(null);
  };

  const quickFilledRows = useMemo((): HistoricalBacklogInputRow[] => {
    const subName = activeQuickSubject.name;
    const subCode = activeQuickSubject.code;
    if (!subName && !subCode) return [];
    const sess = batchSessionName.trim();
    const trm = batchTermName.trim();
    const cls = batchClassName.trim();
    if (!sess || !trm || !cls) return [];

    const out: HistoricalBacklogInputRow[] = [];
    for (const st of students) {
      const sc = quickScores[st.id];
      if (!sc) continue;
      if (sc.ca_score.trim() === '' && sc.exam_score.trim() === '' && sc.total_score.trim() === '') continue;
      out.push({
        admission_number: st.admission_number || '',
        student_name: st.full_name,
        session_name: sess,
        term_name: trm,
        class_name: cls,
        department: batchDepartment.trim() || st.class_arm_name || undefined,
        subject_code: subCode,
        subject_name: subName || subCode,
        credit_units: Number.isFinite(activeQuickSubject.credit_units)
          ? activeQuickSubject.credit_units
          : displayUnitsCol
          ? 3
          : 1,
        ca_score: sc.ca_score.trim() !== '' ? Number(sc.ca_score) : null,
        exam_score: sc.exam_score.trim() !== '' ? Number(sc.exam_score) : null,
        total_score: sc.total_score.trim() !== '' ? Number(sc.total_score) : null,
      });
    }
    return out;
  }, [
    students,
    quickScores,
    activeQuickSubject,
    batchSessionName,
    batchTermName,
    batchClassName,
    batchDepartment,
    displayUnitsCol,
  ]);

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
      .filter(
        (s) =>
          (!matchedClass || s.class_id === matchedClass.id) &&
          (!batchDepartment || (s.class_arm_name || '').toLowerCase() === batchDepartment.toLowerCase())
      )
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
    const header =
      'admission_number,session_name,term_name,class_name,subject_code,subject_name,credit_units,ca_score,exam_score,total_score';
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
    if (inputTab === 'QUICK') {
      return quickFilledRows;
    }
    return rows
      .filter(
        (r) =>
          (r.admission_number.trim() || (r.student_name || '').trim()) &&
          (r.subject_name.trim() || r.subject_code.trim())
      )
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
        inputTab === 'QUICK'
          ? `Select or type a ${subjectLabel} and enter at least one ${learnerLabel.toLowerCase()} score first.`
          : `Load or enter at least one complete row with ${learnerLabel} ID/Name, Session, ${cycleLabel}, ${classLabel}, and ${subjectLabel}.`
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
    <ModalPortal onEscape={onClose}>
      <div
        className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Bulk Upload Results & Quick Award Scores"
      >
        <div className="bg-white w-full max-w-6xl h-[94dvh] sm:h-auto sm:max-h-[92vh] rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
          {/* Compact Sticky Header */}
          <div className="shrink-0 px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                  Award Scores &amp; Bulk Upload Results (Any Year, Session or {cycleLabel})
                </h3>
              </div>
              <p className="hidden sm:block text-xs text-slate-500 mt-0.5">
                Award scores directly to students or upload {cycleLabel.toLowerCase()} / full-session results for <strong>any past, current, or new academic year</strong>—missing sessions, {cycleLabel.toLowerCase()}s, and {subjectPlural.toLowerCase()} are created safely automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer shrink-0"
              aria-label="Close bulk results upload modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Single Unified Scrollable Body — guarantees EVERY tab, input & student row scrolls smoothly on mobile & desktop */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-4">
            {/* Mode Switcher (2x2 on mobile, inline on desktop — zero horizontal clipping!) */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="grid grid-cols-2 sm:inline-flex gap-1 p-1 bg-slate-100 rounded-xl w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    setInputTab('QUICK');
                    setError(null);
                    setPreviewData(null);
                  }}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    inputTab === 'QUICK'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Award className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">Quick Award Scores{quickFilledRows.length > 0 ? ` (${quickFilledRows.length})` : ''}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputTab('MATRIX');
                    setError(null);
                  }}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    inputTab === 'MATRIX'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Class Broadsheet (Excel)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputTab('CSV');
                    setError(null);
                  }}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    inputTab === 'CSV'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Multi-{cycleLabel} / Multi-Year CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputTab('BUILDER');
                    setError(null);
                  }}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    inputTab === 'BUILDER'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Table2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Review Table ({inputTab === 'QUICK' ? rows.filter((r) => r.subject_name || r.subject_code).length : readyRowCount})</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
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

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {matrixNotice && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>{matrixNotice}</span>
              </div>
            )}

            {/* Shared Any-Year / Session / Term / Class / Department Target Context (used by Quick Award & Broadsheet) */}
            {(inputTab === 'QUICK' || inputTab === 'MATRIX') && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Target Year, Session, {cycleLabel} &amp; {classLabel} (pick OR type any year freely)</span>
                  </span>
                  {inputTab === 'MATRIX' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={downloadBroadsheetTemplate}
                        className="px-2.5 py-1 bg-white border border-emerald-300 text-emerald-800 font-semibold rounded-md hover:bg-emerald-50 flex items-center gap-1 whitespace-nowrap cursor-pointer"
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
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Academic Session / Year *
                    </label>
                    <input
                      list="bulk-result-sessions"
                      value={batchSessionName}
                      aria-label="Target Academic Session"
                      onChange={(e) => setBatchSessionName(e.target.value)}
                      placeholder="e.g. 2025/2026 or 2022/2023"
                      className="w-full px-3 py-2 bg-white text-sm sm:text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
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
                          ? 'Existing session (ready)'
                          : 'Any new/past year — auto-created safely'}
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
                      className="w-full px-3 py-2 bg-white text-sm sm:text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
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
                      className="w-full px-3 py-2 bg-white text-sm sm:text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                    />
                    <datalist id="bulk-result-classes">
                      {classes.map((c) => (
                        <option key={c.id} value={c.name} />
                      ))}
                    </datalist>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Pick or type any current or past {classLabel.toLowerCase()}
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
                      className="w-full px-3 py-2 bg-white text-sm sm:text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <datalist id="bulk-result-depts">
                      {departments.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 1: QUICK AWARD SCORES (Direct Student Roster Scoring for ANY Year/Session/Term) */}
            {inputTab === 'QUICK' && (
              <div className="space-y-4">
                {/* Course / Subject Picker */}
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-3 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1">
                        {subjectLabel} to Award Scores For *
                      </label>
                      <select
                        aria-label={`Select ${subjectLabel} to Award Scores`}
                        value={quickSubjectId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setQuickSubjectId(v);
                          const sub = subjects.find((s) => s.id === v);
                          if (sub) {
                            setQuickCreditUnits(String(sub.credit_units ?? (displayUnitsCol ? 3 : 1)));
                          }
                          setPreviewData(null);
                        }}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm sm:text-xs font-semibold"
                      >
                        <option value="__CUSTOM__">+ Type a New / Custom {subjectLabel}...</option>
                        {subjects.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.code ? `${sub.code} — ` : ''}
                            {sub.name}
                            {sub.department ? ` [${sub.department}]` : ''}
                            {displayUnitsCol ? ` (${sub.credit_units ?? 3}u)` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {displayUnitsCol && (
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Credit Units</label>
                        <input
                          type="number"
                          min={0}
                          max={12}
                          value={quickCreditUnits}
                          onChange={(e) => setQuickCreditUnits(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm sm:text-xs font-bold tabular-nums"
                        />
                      </div>
                    )}

                    <div className="relative">
                      <label className="block font-semibold text-slate-700 mb-1">Find {learnerLabel}</label>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={quickSearch}
                          onChange={(e) => setQuickSearch(e.target.value)}
                          placeholder={`Search name or ID...`}
                          className="w-full pl-8 pr-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm sm:text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {quickSubjectId === '__CUSTOM__' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          New {subjectLabel} Title *
                        </label>
                        <input
                          type="text"
                          aria-label={`Custom ${subjectLabel} Title`}
                          value={quickCustomSubjectName}
                          onChange={(e) => setQuickCustomSubjectName(e.target.value)}
                          placeholder={isTertiary ? 'e.g. Community Health Nursing I' : 'e.g. Mathematics'}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm sm:text-xs"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          {subjectLabel} Code (Optional)
                        </label>
                        <input
                          type="text"
                          aria-label={`Custom ${subjectLabel} Code`}
                          value={quickCustomSubjectCode}
                          onChange={(e) => setQuickCustomSubjectCode(e.target.value.toUpperCase())}
                          placeholder={isTertiary ? 'e.g. CHN 101' : 'e.g. MTH'}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm sm:text-xs font-mono uppercase"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <span className="text-slate-600 tabular-nums">
                      Showing <strong className="text-slate-900">{quickMatchingStudents.length}</strong> {learnerLabel.toLowerCase()}(s) ·{' '}
                      <strong className="text-emerald-700">{quickFilledRows.length}</strong> score(s) entered
                    </span>
                    <label className="flex items-center gap-1.5 text-slate-700 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={quickShowAllStudents}
                        onChange={(e) => setQuickShowAllStudents(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      <span>Show all school {learnerLabel.toLowerCase()}s</span>
                    </label>
                  </div>
                </div>

                {quickMatchingStudents.length === 0 ? (
                  <div className="py-8 px-4 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                    No {learnerLabel.toLowerCase()}s found. Enroll {learnerLabel.toLowerCase()}s first or clear the search box.
                  </div>
                ) : (
                  <>
                    {/* Mobile Student Scoring Cards (< 640px) */}
                    <div className="sm:hidden space-y-2.5">
                      {quickMatchingStudents.slice(0, 120).map((st) => {
                        const sc = quickScores[st.id] || { ca_score: '', exam_score: '', total_score: '' };
                        const hasVal = sc.ca_score !== '' || sc.exam_score !== '' || sc.total_score !== '';
                        return (
                          <div
                            key={st.id}
                            className={`p-3 rounded-xl border text-xs space-y-2 ${
                              hasVal ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-bold text-slate-900 truncate">{st.full_name}</div>
                                <div className="text-[11px] text-slate-500 font-mono">
                                  {st.admission_number || '—'} {st.class_name ? `· ${st.class_name}` : ''}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">CA</label>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.5"
                                  aria-label={`Quick Mobile CA for ${st.full_name}`}
                                  value={sc.ca_score}
                                  onChange={(e) => updateQuickScore(st.id, 'ca_score', e.target.value)}
                                  placeholder="e.g. 28"
                                  className="w-full px-2 py-2 text-right font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Exam</label>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.5"
                                  aria-label={`Quick Mobile Exam for ${st.full_name}`}
                                  value={sc.exam_score}
                                  onChange={(e) => updateQuickScore(st.id, 'exam_score', e.target.value)}
                                  placeholder="e.g. 54"
                                  className="w-full px-2 py-2 text-right font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Total</label>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.5"
                                  aria-label={`Quick Mobile Total for ${st.full_name}`}
                                  value={sc.total_score}
                                  onChange={(e) => updateQuickScore(st.id, 'total_score', e.target.value)}
                                  placeholder="0-100"
                                  className="w-full px-2 py-2 text-right font-mono tabular-nums font-bold bg-slate-50 border border-slate-300 rounded-lg text-sm"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop Quick Scoring Table (>= 640px) */}
                    <div className="hidden sm:block overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                          <tr>
                            <th className="py-2.5 px-3">{learnerLabel}</th>
                            <th className="py-2.5 px-3">Current {classLabel}</th>
                            <th className="py-2.5 px-3 text-right w-28">CA Score</th>
                            <th className="py-2.5 px-3 text-right w-28">Exam Score</th>
                            <th className="py-2.5 px-3 text-right w-28">Total (0–100)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {quickMatchingStudents.slice(0, 200).map((st) => {
                            const sc = quickScores[st.id] || { ca_score: '', exam_score: '', total_score: '' };
                            const hasVal = sc.ca_score !== '' || sc.exam_score !== '' || sc.total_score !== '';
                            return (
                              <tr key={st.id} className={hasVal ? 'bg-emerald-50/40' : 'hover:bg-slate-50/70'}>
                                <td className="py-2 px-3">
                                  <div className="font-semibold text-slate-900">{st.full_name}</div>
                                  <div className="text-[11px] font-mono text-slate-500">{st.admission_number || '—'}</div>
                                </td>
                                <td className="py-2 px-3 text-slate-600">
                                  {st.class_name || 'Unassigned'}
                                  {st.class_arm_name ? ` · ${st.class_arm_name}` : ''}
                                </td>
                                <td className="py-1.5 px-3 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.5"
                                    aria-label={`Quick CA for ${st.full_name}`}
                                    value={sc.ca_score}
                                    onChange={(e) => updateQuickScore(st.id, 'ca_score', e.target.value)}
                                    placeholder="Opt"
                                    className="w-20 px-2 py-1.5 text-right font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                                  />
                                </td>
                                <td className="py-1.5 px-3 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.5"
                                    aria-label={`Quick Exam for ${st.full_name}`}
                                    value={sc.exam_score}
                                    onChange={(e) => updateQuickScore(st.id, 'exam_score', e.target.value)}
                                    placeholder="Opt"
                                    className="w-20 px-2 py-1.5 text-right font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                                  />
                                </td>
                                <td className="py-1.5 px-3 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.5"
                                    aria-label={`Quick Total for ${st.full_name}`}
                                    value={sc.total_score}
                                    onChange={(e) => updateQuickScore(st.id, 'total_score', e.target.value)}
                                    placeholder="0-100"
                                    className="w-20 px-2 py-1.5 text-right font-mono tabular-nums font-bold bg-slate-50 border border-slate-300 rounded-lg"
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

            {/* TAB 2: CLASS BROADSHEET MATRIX (Excel / Google Sheets Paste) */}
            {inputTab === 'MATRIX' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 border border-dashed border-slate-300 rounded-xl bg-slate-50">
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
                  rows={7}
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
                  className="w-full px-3 py-2.5 text-xs font-mono border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleParseMatrix(matrixText)}
                    className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 whitespace-nowrap cursor-pointer"
                  >
                    Parse Broadsheet into Review Table
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: MULTI-TERM / MULTI-YEAR CSV & EXCEL */}
            {inputTab === 'CSV' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 border border-dashed border-slate-300 rounded-xl bg-slate-50">
                  <div className="text-xs text-slate-600">
                    <p className="font-semibold text-slate-900">
                      Upload multiple {cycleLabel.toLowerCase()}s, full sessions, or multiple previous years in one file
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      Columns: admission_number, session_name, term_name, class_name, subject_code, subject_name, credit_units, ca_score, exam_score, total_score
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={downloadLongCsvTemplate}
                      className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Sample CSV
                    </button>
                    <label className="px-3.5 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                      <Upload className="w-3.5 h-3.5" />
                      Choose CSV File
                      <input type="file" accept=".csv,text/csv,.txt" onChange={handleFileUpload('CSV')} className="hidden" />
                    </label>
                  </div>
                </div>

                <textarea
                  rows={7}
                  value={csvText}
                  aria-label="Multi-Term CSV Paste Area"
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={`${sampleAdm}, ${initialSessionName}, ${initialTermName}, ${initialClassName}, ${isTertiary ? 'CSC101, Intro to Computing, 3, 25, 50, 75' : 'MTH, Mathematics, 1, 30, 50, 80'}`}
                  className="w-full px-3 py-2.5 text-xs font-mono border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleParseLongCsv(csvText)}
                    className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 whitespace-nowrap cursor-pointer"
                  >
                    Load Pasted Rows into Review Table
                  </button>
                </div>
              </div>
            )}

            {/* TAB 4: INTERACTIVE REVIEW TABLE */}
            {inputTab === 'BUILDER' && (
              <div className="space-y-3">
                {/* Quick-Apply Session/Term/Class Defaults Strip */}
                <div className="flex flex-wrap items-end gap-2 pb-3 border-b border-slate-200 text-xs">
                  <div className="flex-1 min-w-[120px]">
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
                  <div className="flex-1 min-w-[120px]">
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
                  <div className="flex-1 min-w-[120px]">
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
                  <table className="w-full text-left border-collapse min-w-[900px]">
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
                              onClick={() =>
                                setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== row.id) : [makeRow()]))
                              }
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
                  <h4 className="text-xs font-bold text-slate-900">Dry-Run Validation Summary</h4>
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
                      <p>
                        {classLabel}s: {previewData.summary.will_auto_create.classes.join(', ')}
                      </p>
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
                      <p key={idx}>
                        Row {inv.row}: {inv.reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Compact Sticky Footer */}
          <div className="shrink-0 px-4 sm:px-5 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="hidden sm:flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>Works for Primary, Secondary &amp; Tertiary — any past or current year.</span>
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
            <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                disabled={previewing || readyRowCount === 0}
                onClick={handlePreview}
                className="px-3.5 py-2.5 sm:py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>{previewing ? 'Validating...' : 'Validate & Preview'}</span>
              </button>
              <button
                type="button"
                disabled={
                  importing ||
                  readyRowCount === 0 ||
                  (previewData !== null && previewData.summary.valid_rows === 0)
                }
                onClick={handleConfirmImport}
                className="px-4 py-2.5 sm:py-2 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {importing
                    ? 'Saving...'
                    : inputTab === 'QUICK'
                    ? `Save ${readyRowCount > 0 ? `${readyRowCount} ` : ''}Score${readyRowCount === 1 ? '' : 's'}`
                    : `Upload ${readyRowCount > 0 ? `${readyRowCount} ` : ''}Result${readyRowCount === 1 ? '' : 's'}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
