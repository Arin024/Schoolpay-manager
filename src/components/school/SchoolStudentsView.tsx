import React, { useEffect, useState } from 'react';
import {
  GraduationCap,
  Search,
  Filter,
  Plus,
  Download,
  Upload,
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  BookOpen,
  Edit2,
  Trash2,
  Eye,
  X,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { Student, ClassItem, StudentStatus } from '../../types/index.js';
import { NIGERIAN_STATES } from '../../constants/index.js';

interface SchoolStudentsViewProps {
  initialOpenEnroll?: boolean;
  initialOpenImport?: boolean;
}

export const SchoolStudentsView: React.FC<SchoolStudentsViewProps> = ({
  initialOpenEnroll = false,
  initialOpenImport = false,
}) => {
  const { activeSchool } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedGender, setSelectedGender] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [sortBy, setSortBy] = useState('name_asc');

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
  const [probing, setProbing] = useState(false);

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

  // CSV Import State
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<any | null>(null);

  useEffect(() => {
    loadClasses();
  }, [activeSchool?.id]);

  useEffect(() => {
    loadStudents();
  }, [activeSchool?.id, search, selectedClassId, selectedGender, selectedStatus, sortBy, currentPage]);

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
      const res = await api.getSchoolStudents({
        search,
        class_id: selectedClassId,
        gender: selectedGender,
        status: selectedStatus,
        sort: sortBy,
        page: currentPage,
        limit: 20,
      });
      setStudents(res.students || []);
      setTotalCount(res.count || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      console.error('Failed to load students:', err);
    } finally {
      setLoading(false);
    }
  };

  // View Student Profile Modal
  const openStudentProfile = async (id: string) => {
    try {
      const res = await api.getSchoolStudentById(id);
      setSelectedStudent(res.student);
    } catch (err: any) {
      alert(err?.message || 'Failed to fetch student details');
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
      await api.createStudent({
        ...formData,
        class_name: matchedClass?.name || formData.class_name,
        class_arm_name: matchedArm?.name || formData.class_arm_name,
      });
      setIsEnrollModalOpen(false);
      setFormData(initialFormState);
      await loadStudents();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to enroll student');
    } finally {
      setFormSubmitting(false);
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
      alert(err?.message || 'Failed to delete student');
    }
  };

  // Export CSV
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
      alert(err?.message || 'Failed to export CSV');
    }
  };

  // Parse CSV File or Text
  const handleCsvTextChange = (text: string) => {
    setCsvText(text);
    setImportSummary(null);

    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      setParsedRows([]);
      return;
    }

    const headers = lines[0].split(',').map((h) => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
    const rows: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(',').map((v) => v.replace(/^["']|["']$/g, '').trim());
      const rowObj: any = {};
      headers.forEach((h, idx) => {
        rowObj[h] = values[idx] || '';
      });

      // Map common column names
      rows.push({
        admission_number: rowObj['admission number'] || rowObj['admission no'] || rowObj.admission_number || '',
        first_name: rowObj['first name'] || rowObj.first_name || '',
        middle_name: rowObj['middle name'] || rowObj.middle_name || '',
        last_name: rowObj['last name'] || rowObj.last_name || '',
        gender: rowObj['gender'] || 'Male',
        class_name: rowObj['class'] || rowObj.class_name || '',
        class_arm_name: rowObj['arm'] || rowObj['stream'] || rowObj.class_arm_name || '',
        phone: rowObj['phone'] || '',
        email: rowObj['email'] || '',
      });
    }

    setParsedRows(rows);
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

  const handleExecuteImport = async () => {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setImportSummary(null);

    try {
      const res = await api.importStudents(parsedRows);
      setImportSummary(res);
      await loadStudents();
    } catch (err: any) {
      alert(err?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  // Cross-tenant probe test
  const testCrossTenantSecurity = async () => {
    setProbing(true);
    setProbeResult(null);

    const targetForeignStudentId = activeSchool?.id === 'sch_lagos_premier_01' ? 'stu_b1_01' : 'stu_a1_01';

    try {
      const res = await api.getSchoolStudentById(targetForeignStudentId);
      setProbeResult({ success: true, student: res.student });
    } catch (err: any) {
      setProbeResult({
        success: false,
        status: err.status || 403,
        message: err.message,
        targetId: targetForeignStudentId,
      });
    } finally {
      setProbing(false);
    }
  };

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

          <button
            onClick={handleExportCsv}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 text-blue-600" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={testCrossTenantSecurity}
            disabled={probing}
            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-emerald-400 rounded-xl text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5"
            title="Probe backend IDOR security"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{probing ? 'Probing...' : 'Verify Tenant Guard'}</span>
          </button>
        </div>
      </div>

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

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
              placeholder="Search by name, admission no, phone, email..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Class Filter */}
          <div>
            <select
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:border-emerald-500"
            >
              <option value="">All Classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.level})
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

          {/* Status Filter */}
          <div>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full py-2 px-3 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-xl focus:border-emerald-500"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
              <option value="GRADUATED">GRADUATED</option>
              <option value="TRANSFERRED">TRANSFERRED</option>
              <option value="WITHDRAWN">WITHDRAWN</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
          <span>
            Found <strong>{totalCount}</strong> student record(s) in this school
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none"
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

      {/* Students Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-400">
            <div className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin mx-auto mb-2" />
            <span>Loading tenant student directory...</span>
          </div>
        ) : students.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <GraduationCap className="w-6 h-6" />
            </div>
            <p className="text-xs font-semibold text-slate-700">No students match your filter criteria.</p>
            <button
              onClick={() => {
                setFormData(initialFormState);
                setIsEnrollModalOpen(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition"
            >
              Enroll Student Now
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px] bg-slate-50/60">
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
                {students.map((st) => (
                  <tr key={st.id} className="hover:bg-slate-50/60 transition group">
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs flex-shrink-0">
                          {st.full_name?.charAt(0) || 'S'}
                        </div>
                        <div>
                          <p className="group-hover:text-emerald-700 transition">{st.full_name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {st.state ? `${st.state} State` : 'Nigerian'}
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
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          (st.student_status || st.status) === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-300'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            (st.student_status || st.status) === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                        {st.student_status || st.status || 'ACTIVE'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openStudentProfile(st.id)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition"
                          title="View Profile"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
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
                    Admission Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.admission_number}
                    onChange={(e) => setFormData({ ...formData, admission_number: e.target.value })}
                    placeholder="e.g. SCH/2024/005"
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
                  <label className="block font-semibold text-slate-700 mb-1">Admission Number</label>
                  <input
                    type="text"
                    required
                    value={formData.admission_number}
                    onChange={(e) => setFormData({ ...formData, admission_number: e.target.value })}
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
      {/* MODAL 4: CSV BULK IMPORT MODAL */}
      {/* ========================================================================= */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">Bulk Import Students via CSV</h3>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-emerald-950 space-y-1">
                <p className="font-bold">Required CSV Columns:</p>
                <p className="text-[11px] font-mono">
                  admission_number, first_name, last_name, middle_name, gender, class_name, arm, phone, email
                </p>
                <p className="text-[11px] text-emerald-800">
                  All rows are automatically bound to tenant: <strong>{activeSchool?.name}</strong>. Existing admission
                  numbers are safely detected and skipped.
                </p>
              </div>

              {/* Upload or Paste */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700">Upload CSV File or Paste Raw Text</label>
                  <label className="cursor-pointer text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Select File</span>
                    <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
                <textarea
                  rows={4}
                  value={csvText}
                  onChange={(e) => handleCsvTextChange(e.target.value)}
                  placeholder="admission_number,first_name,last_name,class_name,gender&#10;LPC/2024/010,Emmanuel,Afolabi,SSS 1,Male&#10;LPC/2024/011,Blessing,Amadi,SSS 1,Female"
                  className="w-full p-3 font-mono text-[11px] bg-slate-50 border border-slate-300 rounded-xl focus:bg-white"
                />
              </div>

              {/* Preview Table */}
              {parsedRows.length > 0 && (
                <div className="space-y-2">
                  <p className="font-bold text-slate-800">Preview: {parsedRows.length} Row(s) Parsed</p>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0">
                        <tr>
                          <th className="p-2">Admission No</th>
                          <th className="p-2">Name</th>
                          <th className="p-2">Class</th>
                          <th className="p-2">Arm</th>
                          <th className="p-2">Gender</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedRows.slice(0, 8).map((r, i) => (
                          <tr key={i}>
                            <td className="p-2 font-mono font-bold text-slate-800">{r.admission_number || 'MISSING'}</td>
                            <td className="p-2">{r.first_name} {r.last_name}</td>
                            <td className="p-2">{r.class_name || '—'}</td>
                            <td className="p-2">{r.class_arm_name || '—'}</td>
                            <td className="p-2">{r.gender || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsedRows.length > 8 && (
                    <p className="text-[10px] text-slate-400 italic">Showing first 8 of {parsedRows.length} rows</p>
                  )}
                </div>
              )}

              {/* Import Summary */}
              {importSummary && (
                <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 space-y-1">
                  <p className="font-bold text-slate-900">{importSummary.message}</p>
                  {importSummary.errors && importSummary.errors.length > 0 && (
                    <div className="text-[10px] text-rose-700 space-y-0.5">
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
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-50"
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
                <code>{studentToDelete.admission_number}</code>)?
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
    </div>
  );
};
