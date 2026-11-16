import { exportTableToPdf } from "../../utils/pdfExport.ts";
import {
  parseBulkStudentInput,
  inferNigerianLevel,
  ParsedStudentRecord,
} from "../../utils/studentRecordParser.ts";
import React, { useEffect, useMemo, useState } from 'react';
import {
  Printer,
  GraduationCap,
  Search,
  Plus,
  Download,
  Upload,
  User,
  Phone,
  Edit2,
  Trash2,
  Eye,
  X,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  BarChart3,
  UserCheck,
  Sparkles,
  Layers,
  CheckSquare,
  ArrowRightLeft,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { Student, ClassItem, StudentStatus } from '../../types/index.js';
import { NIGERIAN_STATES } from '../../constants/index.js';

interface SchoolStudentsViewProps {
  initialOpenEnroll?: boolean;
  initialOpenImport?: boolean;
  readOnly?: boolean;
}

type GroupByMode = 'NONE' | 'CLASS' | 'LEVEL' | 'GENDER';

export const SchoolStudentsView: React.FC<SchoolStudentsViewProps> = ({
  initialOpenEnroll = false,
  initialOpenImport = false,
  readOnly = false,
}) => {
  const { activeSchool } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  // Filters, Search & Separation View
  const [search, setSearch] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedArmId, setSelectedArmId] = useState('');
  const [selectedGender, setSelectedGender] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [sortBy, setSortBy] = useState('name_asc');
  const [groupBy, setGroupBy] = useState<GroupByMode>('NONE');

  // Directory Multi-Select & Bulk Separation State
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [bulkTargetClassId, setBulkTargetClassId] = useState('');
  const [bulkCustomClassName, setBulkCustomClassName] = useState('');
  const [bulkTargetArmId, setBulkTargetArmId] = useState('');
  const [bulkCustomArmName, setBulkCustomArmName] = useState('');
  const [bulkTargetGender, setBulkTargetGender] = useState('');
  const [bulkAssignSaving, setBulkAssignSaving] = useState(false);

  // Modals state
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(initialOpenEnroll);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(initialOpenImport);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);

  // Cross-tenant probe state
  const [probeResult, setProbeResult] = useState<any | null>(null);

  // Student Portal Login & Academic Profile state
  const [loginStudent, setLoginStudent] = useState<Student | null>(null);
  const [studentLoginForm, setStudentLoginForm] = useState({ email: '', password: '' });
  const [studentLoginSaving, setStudentLoginSaving] = useState(false);
  const [studentLoginError, setStudentLoginError] = useState<string | null>(null);
  const [studentStatusMsg, setStudentStatusMsg] = useState<string | null>(null);
  const [assigningAdmissions, setAssigningAdmissions] = useState(false);

  const [acadStudent, setAcadStudent] = useState<Student | null>(null);
  const [acadData, setAcadData] = useState<any | null>(null);
  const [acadLoading, setAcadLoading] = useState(false);

  // Form states for Enroll / Edit
  const initialFormState = {
    admission_number: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    gender: 'Male',
    date_of_birth: '',
    phone: '',
    email: '',
    address: '',
    state: 'Lagos',
    nationality: 'Nigerian',
    admission_date: new Date().toISOString().slice(0, 10),
    student_status: 'ACTIVE' as StudentStatus,
    class_id: '',
    class_arm_id: '',
    class_name: '',
    class_arm_name: '',
    emergency_contact: '',
    medical_notes: '',
  };
  const [formData, setFormData] = useState(initialFormState);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // CSV / Smart Paste Import State
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedStudentRecord[]>([]);
  const [selectedImportRowIds, setSelectedImportRowIds] = useState<string[]>([]);
  const [importPreviewFilter, setImportPreviewFilter] = useState('ALL');
  const [importBatchClass, setImportBatchClass] = useState('');
  const [importBatchArm, setImportBatchArm] = useState('');
  const [importBatchGender, setImportBatchGender] = useState('');
  const [autoCreateClassesOnImport, setAutoCreateClassesOnImport] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<any | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    loadClasses();
  }, [activeSchool?.id]);

  useEffect(() => {
    loadStudents();
  }, [activeSchool?.id, search, selectedClassId, selectedArmId, selectedGender, selectedStatus, sortBy, currentPage, groupBy, selectedLevel]);

  const loadClasses = async () => {
    try {
      const res = await api.getSchoolClasses();
      setClasses(res.classes || []);
    } catch (err) {
      console.error('Failed to load classes:', err);
    }
  };

  const loadStudents = async () => {
    setLoading(true);
    try {
      const needsAll = groupBy !== 'NONE' || Boolean(selectedLevel);
      const res = await api.getSchoolStudents({
        search,
        class_id: selectedClassId,
        class_arm_id: selectedArmId,
        gender: selectedGender,
        status: selectedStatus,
        sort: sortBy,
        page: needsAll ? 1 : currentPage,
        limit: needsAll ? 500 : 25,
      });
      setStudents(res.students || []);
      setTotalCount(res.count || 0);
      setTotalPages(needsAll ? 1 : (res.totalPages || 1));
      setSelectedStudentIds((prev) =>
        prev.filter((id) => (res.students || []).some((s: Student) => s.id === id))
      );
    } catch (err) {
      console.error('Failed to load students:', err);
    } finally {
      setLoading(false);
    }
  };

  const resolveStudentLevel = (st: Student): string => {
    const matchedClass = classes.find(
      (c) => c.id === st.class_id || (st.class_name && c.name.toLowerCase() === st.class_name.toLowerCase())
    );
    return inferNigerianLevel(st.class_name || matchedClass?.name, matchedClass?.level);
  };

  const filteredStudents = useMemo(() => {
    if (!selectedLevel) return students;
    return students.filter((st) => resolveStudentLevel(st) === selectedLevel);
  }, [students, selectedLevel, classes]);

  const groupedStudentSections = useMemo(() => {
    if (groupBy === 'NONE') return [];
    const groups = new Map<string, Student[]>();
    for (const st of filteredStudents) {
      let key = 'Unassigned';
      if (groupBy === 'CLASS') {
        key = st.class_name
          ? `${st.class_name}${st.class_arm_name ? ` — ${st.class_arm_name}` : ''}`
          : 'Unassigned Class';
      } else if (groupBy === 'LEVEL') {
        key = resolveStudentLevel(st);
      } else if (groupBy === 'GENDER') {
        key = st.gender || 'Unspecified Gender';
      }
      const list = groups.get(key) || [];
      list.push(st);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredStudents, groupBy, classes]);

  // View Student Profile Modal
  const openStudentProfile = async (id: string) => {
    try {
      const res = await api.getSchoolStudentById(id);
      setSelectedStudent(res.student);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to fetch student details');
    }
  };

  const openAcademicProfile = async (st: Student) => {
    setAcadStudent(st);
    setAcadData(null);
    setAcadLoading(true);
    try {
      const res = await api.getStudentPerformance(st.id);
      setAcadData(res);
    } catch (err: any) {
      setAcadData({ error: err?.message || 'Failed to load student academic profile' });
    } finally {
      setAcadLoading(false);
    }
  };

  const handleStudentLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginStudent) return;
    setStudentLoginSaving(true);
    setStudentLoginError(null);
    try {
      const res = await api.provisionStudentAccount(loginStudent.id, {
        email: studentLoginForm.email.trim(),
        password: studentLoginForm.password,
      });
      setStudentStatusMsg(res.message || `Student portal login created for ${loginStudent.full_name}.`);
      setLoginStudent(null);
      await loadStudents();
    } catch (err: any) {
      setStudentLoginError(err?.message || 'Failed to provision student account');
    } finally {
      setStudentLoginSaving(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (student: Student) => {
    setEditingStudent(student);
    setFormData({
      admission_number: student.admission_number,
      first_name: student.first_name || '',
      middle_name: student.middle_name || '',
      last_name: student.last_name || '',
      gender: student.gender || 'Male',
      date_of_birth: student.date_of_birth || '',
      phone: student.phone || '',
      email: student.email || '',
      address: student.address || '',
      state: student.state || 'Lagos',
      nationality: student.nationality || 'Nigerian',
      admission_date: student.admission_date || '',
      student_status: (student.student_status || student.status || 'ACTIVE') as StudentStatus,
      class_id: student.class_id || '',
      class_arm_id: student.class_arm_id || '',
      class_name: student.class_name || '',
      class_arm_name: student.class_arm_name || '',
      emergency_contact: student.emergency_contact || '',
      medical_notes: student.medical_notes || '',
    });
    setFormError(null);
    setIsEditModalOpen(true);
  };

  // Submit Enroll Form
  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);

    // Resolve class and arm names
    const matchedClass = classes.find((c) => c.id === formData.class_id);
    const matchedArm = matchedClass?.arms?.find((a) => a.id === formData.class_arm_id);

    try {
      const res = await api.createStudent({
        ...formData,
        class_name: matchedClass?.name || formData.class_name,
        class_arm_name: matchedArm?.name || formData.class_arm_name,
      });
      setIsEnrollModalOpen(false);
      setFormData(initialFormState);
      if (res.student?.admission_number) {
        setStudentStatusMsg(
          `${res.student.full_name} enrolled! Official Admission Number: ${res.student.admission_number} (student can use this number to activate their portal).`
        );
      }
      await loadStudents();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to enroll student');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleAssignMissingAdmissions = async () => {
    setAssigningAdmissions(true);
    try {
      const res = await api.assignMissingAdmissionNumbers();
      setStudentStatusMsg(res.message);
      await loadStudents();
    } catch (err: any) {
      setStudentStatusMsg(err?.message || 'Failed to assign admission numbers');
    } finally {
      setAssigningAdmissions(false);
    }
  };

  // Submit Edit Form
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setFormSubmitting(true);
    setFormError(null);

    const matchedClass = classes.find((c) => c.id === formData.class_id);
    const matchedArm = matchedClass?.arms?.find((a) => a.id === formData.class_arm_id);

    try {
      await api.updateStudent(editingStudent.id, {
        ...formData,
        class_name: matchedClass?.name || formData.class_name,
        class_arm_name: matchedArm?.name || formData.class_arm_name,
      });
      setIsEditModalOpen(false);
      setEditingStudent(null);
      await loadStudents();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to update student');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Confirm Delete
  const handleDeleteConfirm = async () => {
    if (!studentToDelete) return;
    try {
      await api.deleteStudent(studentToDelete.id);
      setIsDeleteModalOpen(false);
      setStudentToDelete(null);
      await loadStudents();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to delete student');
    }
  };

  const handleBulkSeparateSubmit = async () => {
    if (selectedStudentIds.length === 0) return;
    setBulkAssignSaving(true);
    setErrorBanner(null);
    try {
      const payload: any = {
        student_ids: selectedStudentIds,
        create_missing_class: true,
      };
      if (bulkTargetClassId === '__CUSTOM__' && bulkCustomClassName.trim()) {
        payload.class_name = bulkCustomClassName.trim();
      } else if (bulkTargetClassId === '__UNASSIGN__') {
        payload.class_id = '';
        payload.class_arm_id = '';
      } else if (bulkTargetClassId) {
        payload.class_id = bulkTargetClassId;
      }

      if (bulkTargetArmId === '__CUSTOM__' && bulkCustomArmName.trim()) {
        payload.class_arm_name = bulkCustomArmName.trim();
      } else if (bulkTargetArmId === '__CLEAR__') {
        payload.class_arm_id = '';
      } else if (bulkTargetArmId) {
        payload.class_arm_id = bulkTargetArmId;
      }

      if (bulkTargetGender) {
        payload.gender = bulkTargetGender;
      }

      const res = await api.bulkAssignStudents(payload);
      setStudentStatusMsg(res.message);
      setSelectedStudentIds([]);
      setBulkTargetClassId('');
      setBulkCustomClassName('');
      setBulkTargetArmId('');
      setBulkCustomArmName('');
      setBulkTargetGender('');
      await Promise.all([loadClasses(), loadStudents()]);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to apply student separation');
    } finally {
      setBulkAssignSaving(false);
    }
  };

  // Export PDF / CSV
  const handleExportStudentsPdf = () => {
    exportTableToPdf({
      title: "Official Student Register",
      subtitle: `Enrolled Students (${filteredStudents.length} Total)`,
      school: {
        name: activeSchool?.name || "School Portal",
        slug: activeSchool?.slug,
        email: activeSchool?.email,
        phone: activeSchool?.phone,
        address: activeSchool?.address,
        state: activeSchool?.state,
      },
      columns: [
        { header: "Admission #", key: "admission_number" },
        { header: "Student Name", key: "name" },
        { header: "Class", key: "class_name" },
        { header: "Gender", key: "gender", align: "center" },
        { header: "Status", key: "status", align: "center" },
      ],
      data: filteredStudents.map((s) => ({
        admission_number: s.admission_number,
        name: `${s.first_name} ${s.last_name}`,
        class_name: `${s.class_name || '-'}${s.class_arm_name ? ` (${s.class_arm_name})` : ''}`,
        gender: s.gender || "-",
        status: s.status || "ACTIVE",
      })),
      summaryItems: [
        { label: "Total Students", value: String(filteredStudents.length) },
        { label: "Active", value: String(filteredStudents.filter(s => s.status !== "INACTIVE").length) },
      ],
    });
  };

  const handleExportCsv = async () => {
    try {
      const blob = await api.exportStudentsCsv();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `students_${activeSchool?.slug || 'export'}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to export CSV');
    }
  };

  // Smart Parse CSV / Excel / Messy List
  const handleCsvTextChange = (text: string) => {
    setCsvText(text);
    setImportSummary(null);
    const rows = parseBulkStudentInput(text);
    setParsedRows(rows);
    setSelectedImportRowIds([]);
    setImportPreviewFilter('ALL');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleCsvTextChange(content);
    };
    reader.readAsText(file);
  };

  const importBreakdown = useMemo(() => {
    const byClass = new Map<string, number>();
    const byLevel = new Map<string, number>();
    let males = 0;
    let females = 0;
    let unassignedClass = 0;
    for (const r of parsedRows) {
      const clsKey = r.class_name ? `${r.class_name}${r.class_arm_name ? ` ${r.class_arm_name}` : ''}` : 'Unassigned';
      byClass.set(clsKey, (byClass.get(clsKey) || 0) + 1);
      const lvlKey = r.class_level || inferNigerianLevel(r.class_name);
      byLevel.set(lvlKey, (byLevel.get(lvlKey) || 0) + 1);
      if (r.gender === 'Male') males++;
      else if (r.gender === 'Female') females++;
      if (!r.class_name) unassignedClass++;
    }
    return { byClass, byLevel, males, females, unassignedClass };
  }, [parsedRows]);

  const filteredImportRows = useMemo(() => {
    if (importPreviewFilter === 'ALL') return parsedRows;
    if (importPreviewFilter === 'UNASSIGNED') return parsedRows.filter((r) => !r.class_name);
    if (importPreviewFilter === 'MALE') return parsedRows.filter((r) => r.gender === 'Male');
    if (importPreviewFilter === 'FEMALE') return parsedRows.filter((r) => r.gender === 'Female');
    if (importPreviewFilter.startsWith('LEVEL:')) {
      const target = importPreviewFilter.slice(6);
      return parsedRows.filter((r) => (r.class_level || inferNigerianLevel(r.class_name)) === target);
    }
    if (importPreviewFilter.startsWith('CLASS:')) {
      const target = importPreviewFilter.slice(6);
      return parsedRows.filter(
        (r) => (r.class_name ? `${r.class_name}${r.class_arm_name ? ` ${r.class_arm_name}` : ''}` : 'Unassigned') === target
      );
    }
    return parsedRows;
  }, [parsedRows, importPreviewFilter]);

  const applyBatchSeparationToImportRows = (targetMode: 'SELECTED' | 'UNASSIGNED') => {
    const targetIds =
      targetMode === 'SELECTED'
        ? new Set(selectedImportRowIds)
        : new Set(parsedRows.filter((r) => !r.class_name).map((r) => r.id));
    if (targetIds.size === 0) return;

    setParsedRows((prev) =>
      prev.map((row) => {
        if (!targetIds.has(row.id)) return row;
        const nextClass = importBatchClass.trim() || row.class_name;
        const nextArm = importBatchArm.trim() || row.class_arm_name;
        const nextGender = (importBatchGender as 'Male' | 'Female' | '') || row.gender;
        return {
          ...row,
          class_name: nextClass,
          class_level: inferNigerianLevel(nextClass),
          class_arm_name: nextArm,
          gender: nextGender,
        };
      })
    );
    if (targetMode === 'SELECTED') setSelectedImportRowIds([]);
  };

  const updateSingleImportRow = (rowId: string, patch: Partial<ParsedStudentRecord>) => {
    setParsedRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const updated = { ...r, ...patch };
        if (patch.class_name !== undefined) {
          updated.class_level = inferNigerianLevel(patch.class_name);
        }
        return updated;
      })
    );
  };

  const handleExecuteImport = async () => {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setImportSummary(null);
    setErrorBanner(null);

    try {
      const res = await api.importStudents(parsedRows, {
        auto_create_classes: autoCreateClassesOnImport,
      });
      setImportSummary(res);
      await Promise.all([loadClasses(), loadStudents()]);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  // Cross-tenant probe test

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-emerald-600" />
            <span>Student Management &amp; Directory</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage student records, parent linkings, class arms, and enrollments for{' '}
            <strong className="text-slate-700">{activeSchool?.name}</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <>
              <button
                onClick={() => {
                  setFormData(initialFormState);
                  setFormError(null);
                  setIsEnrollModalOpen(true);
                }}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Enroll Student</span>
              </button>

              <button
                onClick={() => {
                  setCsvText('');
                  setParsedRows([]);
                  setImportSummary(null);
                  setIsImportModalOpen(true);
                }}
                className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-4 h-4 text-emerald-600" />
                <span>Import CSV</span>
              </button>
            </>
          )}

          <button
            onClick={handleExportStudentsPdf}
            className="px-3.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
            title="Export Students List as PDF"
          >
            <Printer className="w-4 h-4 text-emerald-600" />
            <span>Export PDF</span>
          </button>
          <button
            onClick={handleExportCsv}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-blue-600" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {!readOnly && students.some((s) => !s.admission_number || !String(s.admission_number).trim()) && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Some students in your directory do not have an Admission Number yet. Click to automatically generate sequential Nigerian Admission Numbers so they can activate their Student Portal.
            </span>
          </div>
          <button
            type="button"
            disabled={assigningAdmissions}
            onClick={handleAssignMissingAdmissions}
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shrink-0 transition cursor-pointer disabled:opacity-60"
          >
            {assigningAdmissions ? 'Assigning...' : 'Auto-Assign Admission Nos'}
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorBanner}</span>
          </span>
          <button type="button" onClick={() => setErrorBanner(null)} className="text-rose-700 hover:text-rose-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {studentStatusMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{studentStatusMsg}</span>
          </span>
          <button type="button" onClick={() => setStudentStatusMsg(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Cross-Tenant Probe Result Banner */}
      {probeResult && (
        <div
          className={`p-4 rounded-xl text-xs space-y-1.5 border ${
            !probeResult.success
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            {!probeResult.success ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>TENANT ISOLATION ENFORCED: HTTP {probeResult.status} ACCESS DENIED</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-red-600" />
                <span>CROSS-TENANT LEAK: Unauthorized record received!</span>
              </>
            )}
          </div>
          <p>
            Attempted probe on foreign student ID:{' '}
            <code className="bg-white/80 px-1 py-0.5 rounded font-mono font-bold">
              {probeResult.targetId}
            </code>
          </p>
          <p className="text-[11px] opacity-90">
            Server response: <strong>{probeResult.message || 'Access rejected by tenant barrier'}</strong>. Data was NOT leaked.
          </p>
        </div>
      )}

      {/* Filter, Separation & Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          {/* Search */}
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by name, admission no, phone..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Level Filter */}
          <div>
            <select
              value={selectedLevel}
              onChange={(e) => {
                setSelectedLevel(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:border-emerald-500"
            >
              <option value="">All Levels</option>
              <option value="Early Years / Nursery">Nursery / Early Years</option>
              <option value="Primary">Primary (Basic 1–6)</option>
              <option value="Junior Secondary">Junior Secondary (JSS 1–3)</option>
              <option value="Senior Secondary">Senior Secondary (SSS 1–3)</option>
              <option value="Unassigned">Unassigned Level</option>
            </select>
          </div>

          {/* Class Filter */}
          <div>
            <select
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setSelectedArmId('');
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:border-emerald-500"
            >
              <option value="">All Classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.arms?.length || 0} arms)
                </option>
              ))}
            </select>
          </div>

          {/* Arm Filter */}
          <div>
            <select
              value={selectedArmId}
              onChange={(e) => {
                setSelectedArmId(e.target.value);
                setCurrentPage(1);
              }}
              disabled={!selectedClassId}
              className="w-full py-2 px-3 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:border-emerald-500 disabled:opacity-50"
            >
              <option value="">All Arms</option>
              {classes
                .find((c) => c.id === selectedClassId)
                ?.arms?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Gender Filter */}
          <div>
            <select
              value={selectedGender}
              onChange={(e) => {
                setSelectedGender(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:border-emerald-500"
            >
              <option value="">All Genders</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
        </div>

        {/* Second row: Separate / Group By pills + Status + Sort */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-slate-100 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1 mr-1">
              <Layers className="w-3.5 h-3.5 text-emerald-600" />
              <span>Separate / View:</span>
            </span>
            {(
              [
                { id: 'NONE', label: 'All List' },
                { id: 'CLASS', label: 'By Class & Arm' },
                { id: 'LEVEL', label: 'By Level' },
                { id: 'GENDER', label: 'By Gender' },
              ] as Array<{ id: GroupByMode; label: string }>
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setGroupBy(mode.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  groupBy === mode.id
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span>
              Showing <strong>{filteredStudents.length}</strong> of <strong>{totalCount}</strong>
            </span>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-700"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
              <option value="GRADUATED">GRADUATED</option>
              <option value="TRANSFERRED">TRANSFERRED</option>
              <option value="WITHDRAWN">WITHDRAWN</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-700"
            >
              <option value="name_asc">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
              <option value="admission_asc">Admission No (Asc)</option>
              <option value="admission_desc">Admission No (Desc)</option>
              <option value="date_desc">Recent Enrollment</option>
            </select>
          </div>
        </div>
      </div>

      {/* Floating / Inline Bulk Separation Toolbar (when rows checked) */}
      {!readOnly && selectedStudentIds.length > 0 && (
        <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-lg border border-slate-800 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold">
              <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
              <span>
                Separate / Assign {selectedStudentIds.length} Selected Student{selectedStudentIds.length === 1 ? '' : 's'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedStudentIds([])}
              className="text-[11px] text-slate-300 hover:text-white underline cursor-pointer"
            >
              Clear Selection
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            <div>
              <select
                value={bulkTargetClassId}
                onChange={(e) => {
                  setBulkTargetClassId(e.target.value);
                  setBulkTargetArmId('');
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs"
              >
                <option value="">-- Class (Unchanged) --</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.level})
                  </option>
                ))}
                <option value="__CUSTOM__">+ Type New Class...</option>
                <option value="__UNASSIGN__">Unassign Class</option>
              </select>
              {bulkTargetClassId === '__CUSTOM__' && (
                <input
                  type="text"
                  value={bulkCustomClassName}
                  onChange={(e) => setBulkCustomClassName(e.target.value)}
                  placeholder="e.g. JSS 1, SSS 2"
                  className="mt-1.5 w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-emerald-500 text-white text-xs"
                />
              )}
            </div>

            <div>
              <select
                value={bulkTargetArmId}
                onChange={(e) => setBulkTargetArmId(e.target.value)}
                disabled={bulkTargetClassId === '__UNASSIGN__'}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs disabled:opacity-40"
              >
                <option value="">-- Arm / Stream (Unchanged) --</option>
                {classes
                  .find((c) => c.id === bulkTargetClassId)
                  ?.arms?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                <option value="__CUSTOM__">+ Type Arm Name (e.g. Gold)...</option>
                <option value="__CLEAR__">Clear Arm</option>
              </select>
              {bulkTargetArmId === '__CUSTOM__' && (
                <input
                  type="text"
                  value={bulkCustomArmName}
                  onChange={(e) => setBulkCustomArmName(e.target.value)}
                  placeholder="e.g. Gold, Science, A"
                  className="mt-1.5 w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-emerald-500 text-white text-xs"
                />
              )}
            </div>

            <div>
              <select
                value={bulkTargetGender}
                onChange={(e) => setBulkTargetGender(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs"
              >
                <option value="">-- Gender (Unchanged) --</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>

            <div className="sm:col-span-2 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={bulkAssignSaving}
                onClick={handleBulkSeparateSubmit}
                className="w-full sm:w-auto px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black rounded-xl transition cursor-pointer disabled:opacity-60"
              >
                {bulkAssignSaving ? 'Saving...' : 'Save Separation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Students Directory (Table or Grouped Sections) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-400">
            <div className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin mx-auto mb-2" />
            <span>Loading tenant student directory...</span>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <GraduationCap className="w-6 h-6" />
            </div>
            <p className="text-xs font-semibold text-slate-700">No students match your filter criteria.</p>
            {!readOnly && (
              <button
                onClick={() => {
                  setFormData(initialFormState);
                  setIsEnrollModalOpen(true);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition"
              >
                Enroll Student Now
              </button>
            )}
          </div>
        ) : groupBy !== 'NONE' ? (
          <div className="divide-y divide-slate-200">
            {groupedStudentSections.map(([groupLabel, groupRows]) => (
              <div key={groupLabel} className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-xs text-slate-900">{groupLabel}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      {groupRows.length} student{groupRows.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const groupIds = groupRows.map((g) => g.id);
                        const allSelected = groupIds.every((id) => selectedStudentIds.includes(id));
                        if (allSelected) {
                          setSelectedStudentIds((prev) => prev.filter((id) => !groupIds.includes(id)));
                        } else {
                          setSelectedStudentIds((prev) => Array.from(new Set([...prev, ...groupIds])));
                        }
                      }}
                      className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      <span>
                        {groupRows.every((g) => selectedStudentIds.includes(g.id)) ? 'Unselect Group' : 'Select Group'}
                      </span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {groupRows.map((st) => {
                    const checked = selectedStudentIds.includes(st.id);
                    return (
                      <div
                        key={st.id}
                        className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 transition ${
                          checked ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {!readOnly && (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setSelectedStudentIds((prev) =>
                                  e.target.checked ? [...prev, st.id] : prev.filter((id) => id !== st.id)
                                );
                              }}
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate">{st.full_name}</p>
                            <p className="text-[10px] text-slate-500 font-mono truncate">
                              {st.admission_number} · {st.class_name || 'Unassigned'}
                              {st.class_arm_name ? ` (${st.class_arm_name})` : ''} · {st.gender || 'Unspecified'}
                            </p>
                          </div>
                        </div>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => openEditModal(st)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-700 hover:bg-blue-50 shrink-0"
                            title="Edit Student"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px] bg-slate-50/60">
                  {!readOnly && (
                    <th className="py-3 pl-4 pr-2 w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all visible students"
                        checked={
                          filteredStudents.length > 0 &&
                          filteredStudents.every((s) => selectedStudentIds.includes(s.id))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedStudentIds(filteredStudents.map((s) => s.id));
                          } else {
                            setSelectedStudentIds([]);
                          }
                        }}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </th>
                  )}
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">Admission No</th>
                  <th className="py-3 px-4">Class &amp; Arm</th>
                  <th className="py-3 px-4">Gender</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.map((st) => {
                  const isChecked = selectedStudentIds.includes(st.id);
                  return (
                    <tr key={st.id} className={`hover:bg-slate-50/60 transition group ${isChecked ? 'bg-emerald-50/40' : ''}`}>
                      {!readOnly && (
                        <td className="py-3.5 pl-4 pr-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              setSelectedStudentIds((prev) =>
                                e.target.checked ? [...prev, st.id] : prev.filter((id) => id !== st.id)
                              );
                            }}
                            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                        </td>
                      )}
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs flex-shrink-0">
                            {st.full_name?.charAt(0) || 'S'}
                          </div>
                          <div>
                            <p className="group-hover:text-emerald-700 transition">{st.full_name}</p>
                            <p className="text-[10px] text-slate-400 font-mono">
                              {resolveStudentLevel(st) !== 'Unassigned' ? resolveStudentLevel(st) : (st.state ? `${st.state} State` : 'Nigerian')}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-700">
                        {st.admission_number}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[11px]">
                            {st.class_name || 'Unassigned'}
                          </span>
                          {st.class_arm_name && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium text-[10px] border border-emerald-200">
                              {st.class_arm_name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {st.gender || 'Not specified'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <p className="text-[11px] truncate max-w-[140px]">{st.phone || st.guardian_phone || '—'}</p>
                        <p className="text-[10px] text-slate-400 truncate max-w-[140px]">{st.email || '—'}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              (st.student_status || st.status) === 'ACTIVE'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border-slate-300'
                            }`}
                          >
                            {st.student_status || st.status || 'ACTIVE'}
                          </span>
                          {st.user_id && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-cyan-700" title="Student portal login active">
                              <UserCheck className="w-3 h-3" />
                              <span>Portal</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openAcademicProfile(st)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 transition"
                            title="Academic Profile"
                          >
                            <BarChart3 className="w-4 h-4" />
                          </button>
                          {!readOnly && !st.user_id && (
                            <button
                              onClick={() => {
                                setLoginStudent(st);
                                setStudentLoginForm({ email: st.email || '', password: '' });
                                setStudentLoginError(null);
                              }}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-700 hover:bg-cyan-50 transition"
                              title="Provision Student Portal Login"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => openStudentProfile(st.id)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition"
                            title="View Profile"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {!readOnly && (
                            <>
                              <button
                                onClick={() => openEditModal(st)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition"
                                title="Edit Student"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setStudentToDelete(st);
                                  setIsDeleteModalOpen(true);
                                }}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50 transition"
                                title="Archive / Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {groupBy === 'NONE' && !selectedLevel && totalPages > 1 && (
          <div className="p-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span>
              Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => p - 1)}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: ENROLL STUDENT MODAL */}
      {/* ========================================================================= */}
      {isEnrollModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">Enroll New Learner</h3>
              </div>
              <button
                onClick={() => setIsEnrollModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEnrollSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    placeholder="e.g. Oluwaseun"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Middle Name</label>
                  <input
                    type="text"
                    value={formData.middle_name}
                    onChange={(e) => setFormData({ ...formData, middle_name: e.target.value })}
                    placeholder="e.g. Adebayo"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Last Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    placeholder="e.g. Balogun"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Admission Number <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.admission_number}
                    onChange={(e) => setFormData({ ...formData, admission_number: e.target.value })}
                    placeholder="Auto-generated if blank"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Gender</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Gender (Optional)...</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={formData.date_of_birth}
                    onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              {/* Class & Arm */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Class Level</label>
                  <select
                    value={formData.class_id}
                    onChange={(e) => setFormData({ ...formData, class_id: e.target.value, class_arm_id: '' })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Class...</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.level})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Class Arm / Stream</label>
                  <select
                    value={formData.class_arm_id}
                    onChange={(e) => setFormData({ ...formData, class_arm_id: e.target.value })}
                    disabled={!formData.class_id}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl disabled:opacity-50"
                  >
                    <option value="">Select Arm (Optional)...</option>
                    {classes
                      .find((c) => c.id === formData.class_id)
                      ?.arms?.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} (Cap: {a.capacity})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Contact & State */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+23480..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="student@school.edu.ng"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">State of Origin</label>
                  <select
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    {NIGERIAN_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Residential Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Street address, City"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Emergency Contact</label>
                  <input
                    type="text"
                    value={formData.emergency_contact}
                    onChange={(e) => setFormData({ ...formData, emergency_contact: e.target.value })}
                    placeholder="e.g. Mrs. Adebayo (+23480...)"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Medical Notes (Optional)</label>
                  <input
                    type="text"
                    value={formData.medical_notes}
                    onChange={(e) => setFormData({ ...formData, medical_notes: e.target.value })}
                    placeholder="Allergies, chronic conditions..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEnrollModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60"
                >
                  {formSubmitting ? 'Enrolling...' : 'Complete Enrollment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT STUDENT MODAL */}
      {/* ========================================================================= */}
      {isEditModalOpen && editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">Edit Student Record: {editingStudent.full_name}</h3>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Middle Name</label>
                  <input
                    type="text"
                    value={formData.middle_name}
                    onChange={(e) => setFormData({ ...formData, middle_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    required
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Admission Number <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.admission_number}
                    onChange={(e) => setFormData({ ...formData, admission_number: e.target.value })}
                    placeholder="Auto-generated if blank"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={formData.student_status}
                    onChange={(e) => setFormData({ ...formData, student_status: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-emerald-700"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="GRADUATED">GRADUATED</option>
                    <option value="TRANSFERRED">TRANSFERRED</option>
                    <option value="WITHDRAWN">WITHDRAWN</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Gender</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Gender (Optional)...</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Class Level</label>
                  <select
                    value={formData.class_id}
                    onChange={(e) => setFormData({ ...formData, class_id: e.target.value, class_arm_id: '' })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Class...</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.level})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Class Arm</label>
                  <select
                    value={formData.class_arm_id}
                    onChange={(e) => setFormData({ ...formData, class_arm_id: e.target.value })}
                    disabled={!formData.class_id}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl disabled:opacity-50"
                  >
                    <option value="">Select Arm (Optional)...</option>
                    {classes
                      .find((c) => c.id === formData.class_id)
                      ?.arms?.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60"
                >
                  {formSubmitting ? 'Saving Changes...' : 'Save Updates'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: STUDENT PROFILE DETAILED VIEW MODAL */}
      {/* ========================================================================= */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="bg-slate-900 p-6 text-white relative">
              <button
                onClick={() => setSelectedStudent(null)}
                className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 border-2 border-emerald-400 text-white flex items-center justify-center text-2xl font-black shadow-lg">
                  {selectedStudent.full_name?.charAt(0) || 'S'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold">{selectedStudent.full_name}</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                      {selectedStudent.student_status || selectedStudent.status || 'ACTIVE'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-mono mt-0.5">
                    Admission No: {selectedStudent.admission_number} • Class: {selectedStudent.class_name || 'Unassigned'}{' '}
                    {selectedStudent.class_arm_name ? `(${selectedStudent.class_arm_name})` : ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5 text-xs">
              {/* Demographic Information */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Gender</span>
                  <p className="font-semibold text-slate-800">{selectedStudent.gender || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Date of Birth</span>
                  <p className="font-semibold text-slate-800">{selectedStudent.date_of_birth || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase">State</span>
                  <p className="font-semibold text-slate-800">{selectedStudent.state || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Nationality</span>
                  <p className="font-semibold text-slate-800">{selectedStudent.nationality || 'Nigerian'}</p>
                </div>
              </div>

              {/* Contact Information */}
              <div>
                <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Contact &amp; Emergency Details</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600 bg-slate-50/60 p-3.5 rounded-xl border border-slate-200">
                  <p>
                    <strong>Phone:</strong> {selectedStudent.phone || 'None recorded'}
                  </p>
                  <p>
                    <strong>Email:</strong> {selectedStudent.email || 'None recorded'}
                  </p>
                  <p className="sm:col-span-2">
                    <strong>Address:</strong> {selectedStudent.address || 'None recorded'}
                  </p>
                  <p className="sm:col-span-2 text-amber-900 bg-amber-50 p-2 rounded-lg border border-amber-200">
                    <strong>Emergency Contact:</strong> {selectedStudent.emergency_contact || 'None specified'}
                  </p>
                </div>
              </div>

              {/* Linked Parents/Guardians */}
              <div>
                <h4 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Verified Parents / Guardians ({selectedStudent.parents?.length || 0})</span>
                </h4>
                {!selectedStudent.parents || selectedStudent.parents.length === 0 ? (
                  <p className="text-slate-400 italic bg-slate-50 p-3 rounded-xl border border-slate-200">
                    No parent records currently linked. Use the Parents Management tab to link guardians.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedStudent.parents.map((p) => (
                      <div
                        key={p.id}
                        className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between"
                      >
                        <div>
                          <p className="font-bold text-slate-900">
                            {p.full_name}{' '}
                            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded ml-1">
                              {p.relationship_type}
                            </span>
                            {p.is_primary_contact === 1 && (
                              <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded ml-1">
                                Primary Contact
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {p.phone} • {p.email || 'No email'} • {p.occupation || 'Guardian'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Medical Notes */}
              {selectedStudent.medical_notes && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900">
                  <p className="font-bold text-[11px]">Medical &amp; Allergy Notes:</p>
                  <p className="mt-0.5">{selectedStudent.medical_notes}</p>
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex justify-end">
                <button
                  onClick={() => setSelectedStudent(null)}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold"
                >
                  Close Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: SMART BULK IMPORT & RECORD SEPARATION MODAL */}
      {/* ========================================================================= */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-6">
            <div className="bg-slate-900 px-5 sm:px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">Bulk Import Students via CSV / Smart Paste</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-emerald-950 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white">SMART PARSER</span>
                    <p className="font-bold">CSV, Excel Paste, or Plain-Text Student Lists</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleCsvTextChange(
                        '1. Emmanuel Afolabi - SSS 1 Science - Male\n2. Blessing Amadi - JSS 1 Gold - Female\n3. Chinedu Okafor - Primary 4 A - Male\n4. Zainab Musa - JSS 1 Gold - Female'
                      )
                    }
                    className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 underline cursor-pointer"
                  >
                    Try Sample Mixed List
                  </button>
                </div>
                <p className="text-[11px] text-slate-700">
                  Paste CSV spreadsheets, tab-separated Excel rows, OR messy WhatsApp/Word lists like <span className="font-mono bg-white px-1 rounded border border-emerald-200">1. Chinedu Okafor - SSS 2 Science - Male</span>. BursarIQ automatically separates names into Class, Grade Level, Arm &amp; Gender, and issues sequential Admission Numbers where omitted.
                </p>
              </div>

              {/* Upload or Paste */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="font-semibold text-slate-700">Upload CSV/TXT File or Paste Records</label>
                  <label className="cursor-pointer text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Select File</span>
                    <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
                <textarea
                  rows={4}
                  value={csvText}
                  onChange={(e) => handleCsvTextChange(e.target.value)}
                  placeholder="first_name,last_name,admission_number,class_name,gender&#10;Emmanuel,Afolabi,LPC/2024/010,SSS 1,Male&#10;Blessing,Amadi,,JSS 1 Gold,Female&#10;Or paste mixed names: 1. Tunde Bakare - Primary 5 - Male"
                  className="w-full p-3 font-mono text-[11px] bg-slate-50 border border-slate-300 rounded-xl focus:bg-white"
                />
              </div>

              {/* Smart Separation & Preview Table */}
              {parsedRows.length > 0 && (
                <div className="space-y-3 border border-slate-200 rounded-2xl p-3.5 bg-slate-50/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-slate-900">
                      Separated Preview: {parsedRows.length} Student(s) Ready
                    </p>
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoCreateClassesOnImport}
                        onChange={(e) => setAutoCreateClassesOnImport(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Auto-create missing Classes &amp; Arms</span>
                    </label>
                  </div>

                  {/* Quick Breakdown Chips & Filter */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setImportPreviewFilter('ALL')}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                        importPreviewFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700'
                      }`}
                    >
                      All ({parsedRows.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportPreviewFilter('MALE')}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                        importPreviewFilter === 'MALE' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-700'
                      }`}
                    >
                      Male ({importBreakdown.males})
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportPreviewFilter('FEMALE')}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                        importPreviewFilter === 'FEMALE' ? 'bg-pink-600 text-white' : 'bg-white border border-slate-200 text-slate-700'
                      }`}
                    >
                      Female ({importBreakdown.females})
                    </button>
                    {Array.from(importBreakdown.byLevel.entries()).map(([lvl, cnt]) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setImportPreviewFilter(`LEVEL:${lvl}`)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                          importPreviewFilter === `LEVEL:${lvl}`
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                        }`}
                      >
                        {lvl} ({cnt})
                      </button>
                    ))}
                    {importBreakdown.unassignedClass > 0 && (
                      <button
                        type="button"
                        onClick={() => setImportPreviewFilter('UNASSIGNED')}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                          importPreviewFilter === 'UNASSIGNED'
                            ? 'bg-amber-600 text-white'
                            : 'bg-amber-50 border border-amber-200 text-amber-800'
                        }`}
                      >
                        Needs Class ({importBreakdown.unassignedClass})
                      </button>
                    )}
                  </div>

                  {/* Quick Batch Separate Controls inside Import Modal */}
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200 grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                    <input
                      type="text"
                      value={importBatchClass}
                      onChange={(e) => setImportBatchClass(e.target.value)}
                      placeholder="Set Class (e.g. JSS 1)"
                      list="bursariq-class-suggestions"
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-[11px] bg-slate-50"
                    />
                    <datalist id="bursariq-class-suggestions">
                      {classes.map((c) => (
                        <option key={c.id} value={c.name} />
                      ))}
                      <option value="JSS 1" />
                      <option value="JSS 2" />
                      <option value="JSS 3" />
                      <option value="SSS 1" />
                      <option value="SSS 2" />
                      <option value="SSS 3" />
                      <option value="Primary 1" />
                      <option value="Primary 2" />
                      <option value="Primary 3" />
                      <option value="Primary 4" />
                      <option value="Primary 5" />
                      <option value="Primary 6" />
                    </datalist>
                    <input
                      type="text"
                      value={importBatchArm}
                      onChange={(e) => setImportBatchArm(e.target.value)}
                      placeholder="Set Arm (e.g. Gold, A)"
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-[11px] bg-slate-50"
                    />
                    <select
                      value={importBatchGender}
                      onChange={(e) => setImportBatchGender(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-[11px] bg-slate-50"
                    >
                      <option value="">Gender (Unchanged)</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={selectedImportRowIds.length === 0}
                        onClick={() => applyBatchSeparationToImportRows('SELECTED')}
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-[10px] disabled:opacity-40 cursor-pointer"
                      >
                        Apply Selected ({selectedImportRowIds.length})
                      </button>
                      {importBreakdown.unassignedClass > 0 && (
                        <button
                          type="button"
                          onClick={() => applyBatchSeparationToImportRows('UNASSIGNED')}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] cursor-pointer"
                          title="Assign all rows missing a class"
                        >
                          Fill Missing
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Editable Preview Table */}
                  <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl bg-white">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 z-10">
                        <tr>
                          <th className="p-2 w-7">
                            <input
                              type="checkbox"
                              checked={
                                filteredImportRows.length > 0 &&
                                filteredImportRows.every((r) => selectedImportRowIds.includes(r.id))
                              }
                              onChange={(e) => {
                                const visIds = filteredImportRows.map((r) => r.id);
                                if (e.target.checked) {
                                  setSelectedImportRowIds((prev) => Array.from(new Set([...prev, ...visIds])));
                                } else {
                                  setSelectedImportRowIds((prev) => prev.filter((id) => !visIds.includes(id)));
                                }
                              }}
                            />
                          </th>
                          <th className="p-2">Name</th>
                          <th className="p-2">Level</th>
                          <th className="p-2">Class</th>
                          <th className="p-2">Arm</th>
                          <th className="p-2">Gender</th>
                          <th className="p-2">Admission No</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredImportRows.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50">
                            <td className="p-2">
                              <input
                                type="checkbox"
                                checked={selectedImportRowIds.includes(r.id)}
                                onChange={(e) => {
                                  setSelectedImportRowIds((prev) =>
                                    e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)
                                  );
                                }}
                              />
                            </td>
                            <td className="p-2 font-semibold text-slate-900">
                              {r.first_name} {r.middle_name ? `${r.middle_name} ` : ''}{r.last_name}
                            </td>
                            <td className="p-2 text-[10px] text-slate-500">
                              {r.class_level || inferNigerianLevel(r.class_name)}
                            </td>
                            <td className="p-1.5">
                              <input
                                type="text"
                                value={r.class_name}
                                onChange={(e) => updateSingleImportRow(r.id, { class_name: e.target.value })}
                                placeholder="e.g. JSS 1"
                                className="w-24 px-2 py-1 rounded border border-slate-200 bg-slate-50 text-[11px]"
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="text"
                                value={r.class_arm_name}
                                onChange={(e) => updateSingleImportRow(r.id, { class_arm_name: e.target.value })}
                                placeholder="e.g. Gold"
                                className="w-20 px-2 py-1 rounded border border-slate-200 bg-slate-50 text-[11px]"
                              />
                            </td>
                            <td className="p-1.5">
                              <select
                                value={r.gender}
                                onChange={(e) => updateSingleImportRow(r.id, { gender: e.target.value as any })}
                                className="px-2 py-1 rounded border border-slate-200 bg-slate-50 text-[11px]"
                              >
                                <option value="">—</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                              </select>
                            </td>
                            <td className="p-2 font-mono text-slate-600">
                              {r.admission_number || <span className="text-slate-400 italic">Auto</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Import Summary */}
              {importSummary && (
                <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 space-y-2">
                  <p className="font-bold text-slate-900">{importSummary.message}</p>
                  {Array.isArray(importSummary.importedStudentsPreview) && importSummary.importedStudentsPreview.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1.5">
                      <p className="text-[11px] font-bold text-emerald-800">
                        Assigned Admission Numbers Preview ({importSummary.importedStudentsPreview.length} shown):
                      </p>
                      <div className="max-h-32 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px]">
                        {importSummary.importedStudentsPreview.map((st: any) => (
                          <div key={st.id} className="flex items-center justify-between gap-2 px-2 py-1 bg-slate-50 rounded border border-slate-100">
                            <span className="truncate font-medium text-slate-800">
                              {st.full_name}
                              {st.class_name ? ` · ${st.class_name}${st.class_arm_name ? ` (${st.class_arm_name})` : ''}` : ''}
                            </span>
                            <span className="font-mono font-bold text-emerald-700 shrink-0">{st.admission_number}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {importSummary.warnings && importSummary.warnings.length > 0 && (
                    <div className="text-[10px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200 space-y-1 mt-1.5">
                      <p className="font-bold text-amber-950 flex items-center gap-1">
                        <span>Notice ({importSummary.warnings.length} warning{importSummary.warnings.length > 1 ? 's' : ''}):</span>
                      </p>
                      <div className="space-y-0.5 max-h-24 overflow-y-auto">
                        {importSummary.warnings.slice(0, 5).map((w: any, idx: number) => (
                          <p key={idx}>
                            • Row {w.row || '?'}: {w.warning || w.message || JSON.stringify(w)}
                          </p>
                        ))}
                        {importSummary.warnings.length > 5 && (
                          <p className="italic text-amber-700 text-[9px]">...and {importSummary.warnings.length - 5} more warning(s)</p>
                        )}
                      </div>
                    </div>
                  )}
                  {importSummary.errors && importSummary.errors.length > 0 && (
                    <div className="text-[10px] text-rose-700 space-y-0.5 mt-1">
                      {importSummary.errors.slice(0, 3).map((e: any, idx: number) => (
                        <p key={idx}>
                          Row {e.row}: {e.error}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={importing || parsedRows.length === 0}
                  onClick={handleExecuteImport}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-50 cursor-pointer"
                >
                  {importing ? 'Importing Rows...' : `Import ${parsedRows.length} Student(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: CONFIRM DELETE MODAL */}
      {/* ========================================================================= */}
      {isDeleteModalOpen && studentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4 text-xs">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-700 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-bold text-sm text-slate-900">Archive / Delete Student Record</h3>
              <p className="text-slate-500">
                Are you sure you want to remove <strong>{studentToDelete.full_name}</strong> (Admission No:{' '}
                <code>{studentToDelete.admission_number || 'None'}</code>)?
              </p>
            </div>
            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                className="w-full py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: PROVISION STUDENT PORTAL LOGIN */}
      {/* ========================================================================= */}
      {loginStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">Provision Student Portal Account</h3>
              </div>
              <button onClick={() => setLoginStudent(null)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleStudentLoginSubmit} className="p-6 space-y-4 text-xs">
              <p className="text-slate-600">
                Bind a Student Portal login directly to <strong>{loginStudent.full_name}</strong> ({loginStudent.admission_number}).
              </p>
              {studentLoginError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl">{studentLoginError}</div>
              )}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Student Login Email {loginStudent.admission_number ? '(Optional — can sign in by Admission No)' : '*'}
                </label>
                <input
                  type="email"
                  required={!loginStudent.admission_number}
                  value={studentLoginForm.email}
                  onChange={(e) => setStudentLoginForm({ ...studentLoginForm, email: e.target.value })}
                  placeholder={loginStudent.admission_number ? 'Optional (or auto-generated for Admission No login)' : 'student@school.edu.ng'}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Initial Password * (min 6 chars)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={studentLoginForm.password}
                  onChange={(e) => setStudentLoginForm({ ...studentLoginForm, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setLoginStudent(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={studentLoginSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60"
                >
                  {studentLoginSaving ? 'Provisioning...' : 'Create Student Login'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 7: STUDENT ACADEMIC PROFILE */}
      {/* ========================================================================= */}
      {acadStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white">
              <div>
                <h3 className="font-bold text-sm">Academic Performance Profile · {acadStudent.full_name}</h3>
                <p className="text-[11px] text-slate-300 font-mono">
                  {acadStudent.admission_number} · {acadStudent.class_name || 'Unassigned'}
                </p>
              </div>
              <button onClick={() => setAcadStudent(null)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-5 text-xs max-h-[80vh] overflow-y-auto">
              {acadLoading ? (
                <div className="py-12 text-center text-slate-400">Loading academic records...</div>
              ) : acadData?.error ? (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl">{acadData.error}</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <p className="text-[11px] text-slate-500">Exam Scores</p>
                      <p className="text-lg font-bold text-slate-900 tabular-nums">{acadData?.scores?.length || 0}</p>
                    </div>
                    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <p className="text-[11px] text-slate-500">Attendance Logs</p>
                      <p className="text-lg font-bold text-slate-900 tabular-nums">{acadData?.attendance?.length || 0}</p>
                    </div>
                    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <p className="text-[11px] text-slate-500">Behaviour Notes</p>
                      <p className="text-lg font-bold text-slate-900 tabular-nums">{acadData?.behaviour?.length || 0}</p>
                    </div>
                    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <p className="text-[11px] text-slate-500">Report Cards</p>
                      <p className="text-lg font-bold text-slate-900 tabular-nums">{acadData?.reportCards?.length || 0}</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-900 mb-2">Recent Subject Scores</h4>
                    {!acadData?.scores?.length ? (
                      <p className="text-slate-400 italic">No examination scores recorded yet.</p>
                    ) : (
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                            <tr>
                              <th className="py-2 px-3">Subject</th>
                              <th className="py-2 px-3">Exam</th>
                              <th className="py-2 px-3 text-right">CA</th>
                              <th className="py-2 px-3 text-right">Exam</th>
                              <th className="py-2 px-3 text-right">Total</th>
                              <th className="py-2 px-3">Grade</th>
                              <th className="py-2 px-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {acadData.scores.slice(0, 15).map((s: any) => (
                              <tr key={s.id}>
                                <td className="py-2 px-3 font-medium text-slate-900">{s.subject_name}</td>
                                <td className="py-2 px-3 text-slate-600">{s.exam_title}</td>
                                <td className="py-2 px-3 text-right tabular-nums">{s.ca_score ?? '—'}</td>
                                <td className="py-2 px-3 text-right tabular-nums">{s.exam_score ?? '—'}</td>
                                <td className="py-2 px-3 text-right font-bold tabular-nums">{s.total_score ?? '—'}</td>
                                <td className="py-2 px-3 font-semibold">{s.grade || '—'}</td>
                                <td className="py-2 px-3 text-slate-500">{s.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-900 mb-2">Behaviour &amp; Teacher Remarks</h4>
                    {!acadData?.behaviour?.length && !acadData?.remarks?.length ? (
                      <p className="text-slate-400 italic">No behaviour records or remarks recorded.</p>
                    ) : (
                      <div className="space-y-2">
                        {acadData?.remarks?.map((r: any) => (
                          <div key={r.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                            <p className="font-semibold text-slate-900">
                              Termly Remark ({r.session_name || ''} · {r.term_name || ''})
                            </p>
                            <p className="text-slate-600 mt-0.5">{r.remark_text}</p>
                          </div>
                        ))}
                        {acadData?.behaviour?.slice(0, 5).map((b: any) => (
                          <div key={b.id} className="p-3 rounded-xl border border-slate-200">
                            <p className="font-semibold text-slate-900">
                              {b.title} · {b.category} ({b.severity})
                            </p>
                            <p className="text-slate-600 mt-0.5">{b.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="pt-3 border-t border-slate-200 flex justify-end">
                <button onClick={() => setAcadStudent(null)} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
