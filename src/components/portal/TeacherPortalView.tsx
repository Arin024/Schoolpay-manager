import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Building2,
  GraduationCap,
  BarChart3,
  CalendarCheck,
  MessageSquare,
  Megaphone,
  UserCheck,
  CreditCard,
  Lock,
  Search,
  BookOpen,
  Mail,
  Phone,
  Briefcase,
  Printer,
  X,
  FileText,
  AlertCircle,
  ShieldAlert,
  Clock,
  Send,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  UserPlus,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  ConfidentialNoticeItem,
  InvoiceDef,
  PaymentItem,
  ReportCardItem,
  SchoolAdmissionInquiry,
  SchoolCalendarEvent,
  StaffRequestItem,
  Student,
  TeacherDashboardData,
  TimetableSlotItem,
} from '../../types/index.js';
import { SchoolPerformanceView } from '../performance/SchoolPerformanceView.js';
import { SchoolAttendanceView } from '../performance/SchoolAttendanceView.js';
import { SchoolBehaviourView } from '../performance/SchoolBehaviourView.js';
import { SchoolAnnouncementsView } from '../performance/SchoolAnnouncementsView.js';
import { PrintableReportCardModal } from '../performance/PrintableReportCardModal.js';
import { LessonNotesStudio } from './LessonNotesStudio.js';

type TeacherTab =
  | 'overview'
  | 'confidential'
  | 'lesson-notes'
  | 'timetable'
  | 'requests'
  | 'classes'
  | 'students'
  | 'performance'
  | 'attendance'
  | 'behaviour'
  | 'announcements'
  | 'profile'
  | 'fees';

export const TeacherPortalView: React.FC = () => {
  const { activeSchoolId } = useAuth();
  const [tab, setTab] = useState<TeacherTab>('overview');
  const [dashboard, setDashboard] = useState<TeacherDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('');

  // Conditional read-only fees overview
  const [invoices, setInvoices] = useState<InvoiceDef[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [feesLoading, setFeesLoading] = useState(false);

  // Teacher read-only report card generator state
  const [reportTargetStudent, setReportTargetStudent] = useState<Student | null>(null);
  const [reportGenType, setReportGenType] = useState<'TERM' | 'SESSION'>('TERM');
  const [reportGenSessionId, setReportGenSessionId] = useState('');
  const [reportGenTermId, setReportGenTermId] = useState('');
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportGenError, setReportGenError] = useState<string | null>(null);
  const [viewingRc, setViewingRc] = useState<ReportCardItem | null>(null);

  // Staff-only workspace modules (Confidential Briefings, Admissions Notices, Timetable & Events, Staff Requests)
  const [confidentialNotices, setConfidentialNotices] = useState<ConfidentialNoticeItem[]>([]);
  const [admissionsInquiries, setAdmissionsInquiries] = useState<SchoolAdmissionInquiry[]>([]);
  const [copiedStaffCode, setCopiedStaffCode] = useState(false);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlotItem[]>([]);
  const [staffEvents, setStaffEvents] = useState<SchoolCalendarEvent[]>([]);
  const [staffRequests, setStaffRequests] = useState<StaffRequestItem[]>([]);
  const [staffWorkspaceLoading, setStaffWorkspaceLoading] = useState(false);
  const [staffFeedback, setStaffFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [requestForm, setRequestForm] = useState({
    request_type: 'LEAVE' as 'LEAVE' | 'RESOURCES' | 'MAINTENANCE' | 'GENERAL',
    subject: '',
    details: '',
    start_date: '',
    end_date: '',
  });
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTeacherDashboard();
      setDashboard(res);
      if (res.recentAdmissionsInquiries) {
        setAdmissionsInquiries(res.recentAdmissionsInquiries);
      }
      const sessList = res.sessions || [];
      const activeSess = sessList.find((s) => s.status === 'ACTIVE') || sessList[0];
      const activeTerm = activeSess?.terms?.find((t) => t.status === 'ACTIVE') || activeSess?.terms?.[0];
      if (activeSess) {
        setReportGenSessionId((prev) => prev || activeSess.id);
        setReportGenTermId((prev) => prev || activeTerm?.id || '');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load Educator Workspace');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenTeacherReportGenerator = (stu: Student) => {
    setReportTargetStudent(stu);
    setReportGenError(null);
    const sessList = dashboard?.sessions || [];
    const activeSess = sessList.find((s) => s.status === 'ACTIVE') || sessList[0];
    const activeTerm = activeSess?.terms?.find((t) => t.status === 'ACTIVE') || activeSess?.terms?.[0];
    if (activeSess && !reportGenSessionId) {
      setReportGenSessionId(activeSess.id);
    }
    if (activeTerm && !reportGenTermId) {
      setReportGenTermId(activeTerm.id);
    }
  };

  const handleGenerateTeacherReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTargetStudent || !reportGenSessionId) return;
    if (reportGenType === 'TERM' && !reportGenTermId) {
      setReportGenError('Select a Term for the End-of-Term Report Card.');
      return;
    }
    setReportGenerating(true);
    setReportGenError(null);
    try {
      const res = await api.generateTeacherReportCard({
        student_id: reportTargetStudent.id,
        academic_session_id: reportGenSessionId,
        term_id: reportGenType === 'TERM' ? reportGenTermId : undefined,
        report_type: reportGenType,
      });
      setReportTargetStudent(null);
      setViewingRc(res.reportCard);
    } catch (err: any) {
      setReportGenError(err?.message || 'Unable to generate report card for this selection.');
    } finally {
      setReportGenerating(false);
    }
  };

  useEffect(() => {
    setTab('overview');
    setStudentSearch('');
    setStudentClassFilter('');
    loadDashboard();
  }, [activeSchoolId]);

  const canViewFees = Boolean(dashboard?.settings?.teachers_can_view_fees);

  useEffect(() => {
    if (tab === 'fees' && canViewFees) {
      setFeesLoading(true);
      Promise.all([
        api.getInvoices({ limit: 100 }).catch(() => ({ invoices: [] })),
        api.getPayments({ limit: 100 }).catch(() => ({ payments: [] })),
      ])
        .then(([invRes, payRes]) => {
          setInvoices(invRes.invoices || []);
          setPayments(payRes.payments || []);
        })
        .finally(() => setFeesLoading(false));
    }
  }, [tab, canViewFees]);

  useEffect(() => {
    if (tab === 'confidential' || tab === 'overview') {
      api
        .getConfidentialStaffNotices()
        .then((res) => setConfidentialNotices(res.notices || []))
        .catch(() => setConfidentialNotices([]));
      api
        .getStaffWorkspaceAdmissionsInquiries()
        .then((res) => setAdmissionsInquiries(res.inquiries || []))
        .catch(() => {});
    }
    if (tab === 'timetable') {
      setStaffWorkspaceLoading(true);
      Promise.all([
        api.getStaffWorkspaceTimetable().catch(() => ({ slots: [] })),
        api.getStaffWorkspaceEvents().catch(() => ({ events: [] })),
      ])
        .then(([ttRes, evRes]) => {
          setTimetableSlots(ttRes.slots || []);
          setStaffEvents(evRes.events || []);
        })
        .finally(() => setStaffWorkspaceLoading(false));
    }
    if (tab === 'requests') {
      setStaffWorkspaceLoading(true);
      api
        .getStaffRequests()
        .then((res) => setStaffRequests(res.requests || []))
        .catch(() => setStaffRequests([]))
        .finally(() => setStaffWorkspaceLoading(false));
    }
  }, [tab, activeSchoolId]);

  const handleAcknowledgeConfidential = async (noticeId: string) => {
    try {
      await api.acknowledgeConfidentialNotice(noticeId);
      setConfidentialNotices((prev) =>
        prev.map((n) => (n.id === noticeId ? { ...n, is_acknowledged: true, my_read_at: new Date().toISOString() } : n))
      );
      setStaffFeedback({ type: 'ok', text: 'Confidential briefing acknowledged.' });
    } catch (err: any) {
      setStaffFeedback({ type: 'err', text: err?.message || 'Could not acknowledge notice.' });
    }
  };

  const handleCreateStaffRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingRequest(true);
    setStaffFeedback(null);
    try {
      const res = await api.createStaffRequest({
        request_type: requestForm.request_type,
        subject: requestForm.subject.trim(),
        details: requestForm.details.trim(),
        start_date: requestForm.start_date || undefined,
        end_date: requestForm.end_date || undefined,
      });
      setStaffRequests((prev) => [res.request, ...prev]);
      setRequestForm({ request_type: 'LEAVE', subject: '', details: '', start_date: '', end_date: '' });
      setStaffFeedback({ type: 'ok', text: res.message || 'Staff request submitted to School Administration.' });
    } catch (err: any) {
      setStaffFeedback({ type: 'err', text: err?.message || 'Failed to submit request.' });
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleCopyStaffCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedStaffCode(true);
    setTimeout(() => setCopiedStaffCode(false), 2000);
  };

  const unreadConfidentialCount = confidentialNotices.filter((n) => !n.is_acknowledged && !n.my_read_at).length;
  const newInquiriesCount = dashboard?.stats?.newInquiriesCount ?? admissionsInquiries.filter((i) => i.status === 'NEW').length;

  const navItems: Array<{
    key: TeacherTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { key: 'overview', label: 'Staff Overview', icon: LayoutDashboard },
    { key: 'confidential', label: 'Confidential Notices', icon: ShieldAlert, badge: unreadConfidentialCount },
    { key: 'lesson-notes', label: 'Lesson Notes & Plans', icon: BookOpen },
    { key: 'timetable', label: 'Timetable & Events', icon: Clock },
    { key: 'requests', label: 'Staff Requests', icon: Send },
    { key: 'classes', label: 'Assigned Classes', icon: Building2 },
    { key: 'students', label: 'Students', icon: GraduationCap },
    { key: 'performance', label: 'Performance & Reports', icon: BarChart3 },
    { key: 'attendance', label: 'Attendance', icon: CalendarCheck },
    { key: 'behaviour', label: 'Behaviour & Remarks', icon: MessageSquare },
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
    { key: 'profile', label: 'Profile', icon: UserCheck },
    ...(canViewFees ? [{ key: 'fees' as const, label: 'Fees Overview', icon: CreditCard }] : []),
  ];

  if (loading && !dashboard) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-400">
        Loading Read-Only Educator Workspace...
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-xs text-rose-800">{error}</div>
    );
  }

  const studentsList = dashboard?.students || [];
  const filteredStudents = studentsList.filter((s) => {
    const q = studentSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (s.full_name || '').toLowerCase().includes(q) ||
      (s.admission_number || '').toLowerCase().includes(q) ||
      (s.class_name || '').toLowerCase().includes(q);
    const matchesClass = !studentClassFilter || s.class_id === studentClassFilter;
    return matchesSearch && matchesClass;
  });

  const teacherUser = dashboard?.teacherProfile?.user;
  const teacherStaff = dashboard?.teacherProfile?.staff;

  return (
    <div className="space-y-6">
      {/* Dedicated Staff Workspace Banner & Navigation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Dedicated Staff Workspace</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Private staff portal for NERDC lesson notes, confidential administrative circulars, prospective admissions notices, teaching schedules, and staff requests. Strictly isolated from parent and student portals.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {teacherStaff?.staff_number && (
              <button
                type="button"
                onClick={() => handleCopyStaffCode(teacherStaff.staff_number!)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-mono font-bold cursor-pointer hover:bg-emerald-100 transition"
                title="Copy your unique Staff Login Code"
              >
                <KeyRound className="w-3.5 h-3.5 text-emerald-700" />
                <span>{teacherStaff.staff_number}</span>
                {copiedStaffCode ? (
                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-emerald-600" />
                )}
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold shrink-0">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Staff-Only Isolation</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  active ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
                {item.badge ? (
                  <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold tabular-nums">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && dashboard && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <button
              type="button"
              onClick={() => setTab('confidential')}
              className="bg-white rounded-2xl border border-rose-200 p-4 text-left hover:border-rose-300 transition cursor-pointer"
            >
              <p className="text-xs text-rose-700 font-semibold">Confidential Notices</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {dashboard.stats.confidentialNoticesCount ?? confidentialNotices.length}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                {unreadConfidentialCount > 0 ? `${unreadConfidentialCount} unread briefing(s)` : 'Private staff-only channel'}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setTab('lesson-notes')}
              className="bg-white rounded-2xl border border-emerald-200 p-4 text-left hover:border-emerald-300 transition cursor-pointer"
            >
              <p className="text-xs text-emerald-700 font-semibold">My Lesson Notes</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {dashboard.stats.lessonNotesCount ?? 0}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">NERDC plans &amp; notes</p>
            </button>
            <button
              type="button"
              onClick={() => setTab('students')}
              className="bg-white rounded-2xl border border-slate-200 p-4 text-left hover:border-slate-300 transition cursor-pointer"
            >
              <p className="text-xs text-slate-500">Authorized Learners</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {dashboard.stats.authorizedStudentsCount ?? dashboard.stats.studentsCount ?? dashboard.students.length}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {dashboard.hasAssignedClasses ? 'Assigned class arms' : 'School roster'}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setTab('classes')}
              className="bg-white rounded-2xl border border-slate-200 p-4 text-left hover:border-slate-300 transition cursor-pointer"
            >
              <p className="text-xs text-slate-500">Assigned Arms</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {dashboard.assignedClasses.length}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                {dashboard.allClasses.length} total class(es)
              </p>
            </button>
            <button
              type="button"
              onClick={() => setTab('classes')}
              className="bg-white rounded-2xl border border-slate-200 p-4 text-left hover:border-slate-300 transition cursor-pointer"
            >
              <p className="text-xs text-slate-500">Curriculum Subjects</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {dashboard.stats.subjectsCount ?? dashboard.subjects.length}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">Active school subjects</p>
            </button>
            <button
              type="button"
              onClick={() => setTab('confidential')}
              className="bg-white rounded-2xl border border-blue-200 p-4 text-left hover:border-blue-300 transition cursor-pointer"
            >
              <p className="text-xs text-blue-700 font-semibold">Admissions Inquiries</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {admissionsInquiries.length}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                {newInquiriesCount > 0 ? `${newInquiriesCount} new inquiry notice(s)` : 'Prospective student forms'}
              </p>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Assigned Classes &amp; Arms</h3>
                <button
                  type="button"
                  onClick={() => setTab('classes')}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                >
                  View all
                </button>
              </div>
              {dashboard.assignedClasses.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-600">
                  No specific class arm is assigned to your staff profile yet. You have school-wide read-only visibility across{' '}
                  <strong className="tabular-nums">{dashboard.allClasses.length}</strong> class(es).
                </div>
              ) : (
                <div className="space-y-2">
                  {dashboard.assignedClasses.map((arm) => (
                    <div
                      key={arm.id}
                      className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-bold text-slate-900">
                          {arm.class_name} · {arm.arm_name}
                        </p>
                        <p className="text-[11px] text-slate-500">{arm.level}</p>
                      </div>
                      <span className="text-xs font-bold text-emerald-700 tabular-nums">
                        {arm.total_students} student(s)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Recent School Announcements</h3>
                <button
                  type="button"
                  onClick={() => setTab('announcements')}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                >
                  Open feed
                </button>
              </div>
              {dashboard.announcements.length === 0 ? (
                <p className="py-6 text-center text-slate-400">No announcements published yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {dashboard.announcements.slice(0, 3).map((a) => (
                    <div key={a.id} className="p-3 rounded-xl border border-slate-200">
                      <p className="font-semibold text-slate-900">{a.title}</p>
                      <p className="text-slate-600 mt-0.5 line-clamp-2">{a.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Prospective Student Admissions Inquiry Notices */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-600" />
                <span>Prospective Student Applications &amp; Admissions Notices ({admissionsInquiries.length})</span>
              </h3>
              <button
                type="button"
                onClick={() => setTab('confidential')}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
              >
                View all notices
              </button>
            </div>
            {admissionsInquiries.length === 0 ? (
              <p className="py-4 text-slate-400">
                No prospective student inquiry forms submitted on your public school website yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {admissionsInquiries.slice(0, 4).map((inq) => (
                  <div key={inq.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-slate-900">
                        {inq.student_name} {inq.target_class ? `(${inq.target_class})` : ''}
                      </p>
                      <span className="text-[11px] font-bold text-blue-700">{inq.status}</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Parent: {inq.parent_name} · {inq.parent_phone}
                    </p>
                    {inq.message && <p className="text-slate-600 line-clamp-2">{inq.message}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ASSIGNED CLASSES & SUBJECTS */}
      {tab === 'classes' && dashboard && (
        <div className="space-y-6 text-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {dashboard.hasAssignedClasses ? 'Your Assigned Classes & Arms' : 'School Academic Classes'}
              </h3>
              <p className="text-slate-500 mt-0.5">
                Class levels, arms, and student counts managed by School Administration.
              </p>
            </div>
            {dashboard.assignedClasses.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {dashboard.assignedClasses.map((arm) => (
                  <div key={arm.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-sm">
                        {arm.class_name} ({arm.arm_name})
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">{arm.level}</span>
                    </div>
                    <p className="text-slate-600 tabular-nums">
                      Enrolled: <strong>{arm.total_students}</strong> / Capacity {arm.capacity || '—'}
                    </p>
                  </div>
                ))}
              </div>
            ) : dashboard.allClasses.length === 0 ? (
              <p className="py-8 text-center text-slate-400">No academic classes configured yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {dashboard.allClasses.map((cls) => (
                  <div key={cls.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                    <p className="font-bold text-slate-900 text-sm">{cls.name}</p>
                    <p className="text-slate-500">{cls.level}</p>
                    <p className="text-emerald-700 font-semibold tabular-nums">
                      {cls.total_students} student(s)
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-600" />
              <span>Curriculum Subjects ({dashboard.subjects.length})</span>
            </h3>
            {dashboard.subjects.length === 0 ? (
              <p className="py-6 text-center text-slate-400">No subjects created by administration yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-3">Code</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3">Department</th>
                      <th className="py-2.5 px-3">Class Scope</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dashboard.subjects.map((sub) => (
                      <tr key={sub.id}>
                        <td className="py-2.5 px-3 font-mono font-semibold text-slate-700">{sub.code}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{sub.name}</td>
                        <td className="py-2.5 px-3 text-slate-600">{sub.department || 'General'}</td>
                        <td className="py-2.5 px-3 text-slate-600">{sub.class_name || 'All Classes'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* READ-ONLY STUDENTS ROSTER */}
      {tab === 'students' && dashboard && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Authorized Students Roster ({filteredStudents.length})</h3>
              <p className="text-slate-500 mt-0.5">
                Read-only learner directory. Student enrollment and edits are performed by School Administration.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search student or admission #..."
                  className="pl-8 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>
              <select
                value={studentClassFilter}
                onChange={(e) => setStudentClassFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
              >
                <option value="">All Authorized Classes</option>
                {dashboard.allClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredStudents.length === 0 ? (
            <p className="py-10 text-center text-slate-400">No authorized student records match your search.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-3">Admission #</th>
                      <th className="py-2.5 px-3">Student Name</th>
                      <th className="py-2.5 px-3">Class &amp; Arm</th>
                      <th className="py-2.5 px-3">Gender</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Report Card</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.map((st) => (
                      <tr key={st.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-3 font-mono font-semibold text-slate-700">{st.admission_number}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{st.full_name}</td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {st.class_name || 'Unassigned'}
                          {st.class_arm_name ? ` · ${st.class_arm_name}` : ''}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{st.gender || '—'}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                            {st.student_status || st.status || 'ACTIVE'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenTeacherReportGenerator(st)}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <FileText className="w-3 h-3" />
                            <span>Term / Session Report</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* CONFIDENTIAL STAFF NOTICES */}
      {tab === 'confidential' && (
        <div className="space-y-6 text-xs">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <span>Confidential Staff Briefings ({confidentialNotices.length})</span>
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Internal administrative memos meant strictly for teaching &amp; school staff. Never visible to Parents, Students, or Public visitors.
                </p>
              </div>
            </div>

            {staffFeedback && (
              <div
                className={`p-3 rounded-xl border flex items-center justify-between ${
                  staffFeedback.type === 'ok'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{staffFeedback.text}</span>
                </span>
                <button type="button" onClick={() => setStaffFeedback(null)} className="cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {confidentialNotices.length === 0 ? (
              <p className="py-10 text-center text-slate-400">No confidential staff circulars issued yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {confidentialNotices.map((notice) => {
                  const isAcked = Boolean(notice.is_acknowledged || notice.my_read_at);
                  return (
                    <div key={notice.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="font-bold text-rose-700">Confidential Staff Only</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500">Priority: {notice.priority}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            {notice.published_at || notice.created_at
                              ? new Date(notice.published_at || notice.created_at || '').toLocaleDateString()
                              : ''}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-900">{notice.title}</h4>
                        <p className="text-slate-700 whitespace-pre-line leading-relaxed">{notice.content}</p>
                      </div>

                      <div className="shrink-0">
                        {isAcked ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                            <Check className="w-3.5 h-3.5" />
                            <span>Acknowledged</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAcknowledgeConfidential(notice.id)}
                            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Acknowledge Receipt</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-blue-600" />
                  <span>Prospective Student Admissions Notices ({admissionsInquiries.length})</span>
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Prospective family forms submitted through your school&apos;s public website. Strictly visible to School Admin &amp; Staff only.
                </p>
              </div>
            </div>
            {admissionsInquiries.length === 0 ? (
              <p className="py-8 text-center text-slate-400">No prospective student admissions inquiries submitted yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {admissionsInquiries.map((inq) => (
                  <div key={inq.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold text-slate-900 text-sm">
                        {inq.student_name} {inq.target_class ? `— Applying for ${inq.target_class}` : ''}
                      </p>
                      <span className="font-semibold text-blue-700">Status: {inq.status}</span>
                    </div>
                    <p className="text-slate-600">
                      Guardian: <strong>{inq.parent_name}</strong> · Phone: <span className="font-mono">{inq.parent_phone}</span>
                      {inq.parent_email ? ` · Email: ${inq.parent_email}` : ''}
                    </p>
                    {inq.message && <p className="text-slate-700">{inq.message}</p>}
                    <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                      Submitted: {inq.created_at ? new Date(inq.created_at).toLocaleString() : '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* LESSON NOTES STUDIO */}
      {tab === 'lesson-notes' && (
        <LessonNotesStudio
          isAdminMode={false}
          classes={dashboard?.allClasses || []}
          subjects={dashboard?.subjects || []}
        />
      )}

      {/* TEACHING TIMETABLE & STAFF EVENTS */}
      {tab === 'timetable' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Teaching Timetable ({timetableSlots.length})</h3>
            {staffWorkspaceLoading ? (
              <p className="py-10 text-center text-slate-400">Loading school timetable...</p>
            ) : timetableSlots.length === 0 ? (
              <p className="py-10 text-center text-slate-400">No timetable periods configured by administration yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-3">Day</th>
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Class</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3">Room</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {timetableSlots.map((slot) => (
                      <tr key={slot.id}>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{slot.day_of_week}</td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                          {slot.start_time} – {slot.end_time}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          {slot.class_name}
                          {slot.arm_name ? ` (${slot.arm_name})` : ''}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-emerald-700">{slot.subject_name}</td>
                        <td className="py-2.5 px-3 text-slate-600">{slot.room_label || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Staff &amp; School Calendar ({staffEvents.length})</h3>
            {staffEvents.length === 0 ? (
              <p className="py-10 text-center text-slate-400">No upcoming events scheduled.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {staffEvents.map((ev) => (
                  <div key={ev.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono font-semibold text-slate-700 tabular-nums">{ev.event_date}</span>
                      <span aria-hidden="true">·</span>
                      <span className={ev.visibility === 'STAFF_ONLY' ? 'font-bold text-rose-700' : 'text-emerald-700 font-semibold'}>
                        {ev.visibility === 'STAFF_ONLY' ? 'Staff Only' : 'Public Event'}
                      </span>
                    </div>
                    <p className="font-bold text-slate-900">{ev.title}</p>
                    {ev.location && <p className="text-slate-500">Venue: {ev.location}</p>}
                    {ev.description && <p className="text-slate-600">{ev.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* STAFF REQUESTS DESK */}
      {tab === 'requests' && (
        <div className="space-y-6 text-xs">
          {staffFeedback && (
            <div
              className={`p-3.5 rounded-xl border flex items-center justify-between ${
                staffFeedback.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <span className="font-medium">{staffFeedback.text}</span>
              <button type="button" onClick={() => setStaffFeedback(null)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <form onSubmit={handleCreateStaffRequest} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Submit Private Staff Request to Administration</h3>
              <p className="text-slate-500 mt-0.5">
                Request leave, teaching materials, exam stationery, or facility maintenance privately.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Request Type</label>
                <select
                  value={requestForm.request_type}
                  onChange={(e) => setRequestForm({ ...requestForm, request_type: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="LEAVE">Leave / Time Off</option>
                  <option value="RESOURCES">Teaching Resources / Lab</option>
                  <option value="MAINTENANCE">Classroom Maintenance</option>
                  <option value="GENERAL">General Memo</option>
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1">Subject *</label>
                <input
                  type="text"
                  required
                  value={requestForm.subject}
                  onChange={(e) => setRequestForm({ ...requestForm, subject: e.target.value })}
                  placeholder="e.g. Science Laboratory Reagents & Whiteboard Markers"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              {requestForm.request_type === 'LEAVE' && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={requestForm.start_date}
                      onChange={(e) => setRequestForm({ ...requestForm, start_date: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">End Date</label>
                    <input
                      type="date"
                      value={requestForm.end_date}
                      onChange={(e) => setRequestForm({ ...requestForm, end_date: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                </>
              )}
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1">Request Details *</label>
                <textarea
                  rows={3}
                  required
                  value={requestForm.details}
                  onChange={(e) => setRequestForm({ ...requestForm, details: e.target.value })}
                  placeholder="Provide clear context for the Principal or School Admin..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submittingRequest}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{submittingRequest ? 'Submitting...' : 'Submit Private Request'}</span>
              </button>
            </div>
          </form>

          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">My Submitted Requests ({staffRequests.length})</h3>
            {staffWorkspaceLoading ? (
              <p className="py-8 text-center text-slate-400">Loading requests...</p>
            ) : staffRequests.length === 0 ? (
              <p className="py-8 text-center text-slate-400">No requests submitted yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {staffRequests.map((reqItem) => (
                  <div key={reqItem.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">{reqItem.subject}</span>
                      <span
                        className={`font-bold ${
                          reqItem.status === 'APPROVED'
                            ? 'text-emerald-700'
                            : reqItem.status === 'DECLINED'
                            ? 'text-rose-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {reqItem.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Type: {reqItem.request_type}
                      {reqItem.start_date ? ` · Dates: ${reqItem.start_date}${reqItem.end_date ? ` to ${reqItem.end_date}` : ''}` : ''}
                    </p>
                    <p className="text-slate-700">{reqItem.details}</p>
                    {reqItem.admin_response && (
                      <p className="text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-2.5 mt-1">
                        <strong>Admin Response:</strong> {reqItem.admin_response}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'performance' && <SchoolPerformanceView readOnly />}
      {tab === 'attendance' && <SchoolAttendanceView readOnly />}
      {tab === 'behaviour' && <SchoolBehaviourView readOnly />}
      {tab === 'announcements' && <SchoolAnnouncementsView readOnly />}

      {/* TEACHER PROFILE */}
      {tab === 'profile' && dashboard && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 text-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Educator Profile</h3>
              <p className="text-slate-500 mt-0.5">
                Staff details and class assignments are managed by School Administration.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold">Read-Only</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400">Account Identity</p>
              <p className="text-sm font-bold text-slate-900">{teacherUser?.full_name || 'Educator'}</p>
              <p className="flex items-center gap-1.5 text-slate-600">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>{teacherUser?.email || '—'}</span>
              </p>
              <p className="flex items-center gap-1.5 text-slate-600">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>{teacherStaff?.phone || teacherUser?.phone || 'Not recorded'}</span>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400">Staff Record</p>
              <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                <Briefcase className="w-3.5 h-3.5 text-emerald-600" />
                <span>{teacherStaff?.job_title || 'Classroom Educator'}</span>
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
                <span>
                  Staff Login Code: <span className="font-mono font-bold text-slate-900">{teacherStaff?.staff_number || 'Pending'}</span>
                </span>
                {teacherStaff?.staff_number && (
                  <button
                    type="button"
                    onClick={() => handleCopyStaffCode(teacherStaff.staff_number!)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
                  >
                    {copiedStaffCode ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedStaffCode ? 'Copied' : 'Copy Code'}</span>
                  </button>
                )}
              </div>
              <p className="text-slate-600">Department: {teacherStaff?.department || 'Academics'}</p>
              <p className="text-slate-600">
                Assigned Arms: <strong className="tabular-nums">{dashboard.assignedClasses.length}</strong>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* CONDITIONAL READ-ONLY FEES OVERVIEW */}
      {tab === 'fees' && canViewFees && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 text-xs">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Read-Only School Fees Overview</h3>
            <p className="text-slate-500 mt-0.5">
              Enabled by School Administration policy. Teachers cannot record payments or modify fee structures.
            </p>
          </div>
          {feesLoading ? (
            <p className="py-10 text-center text-slate-400">Loading fee status...</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h4 className="font-bold text-slate-800 mb-2">Recent Invoices ({invoices.length})</h4>
                <div className="overflow-x-auto max-h-96 border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 px-3">Invoice</th>
                        <th className="py-2 px-3">Student</th>
                        <th className="py-2 px-3 text-right">Balance</th>
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="py-2 px-3 font-mono">{inv.invoice_number}</td>
                          <td className="py-2 px-3 font-medium text-slate-900">{inv.student_name || '—'}</td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            ₦{Number(inv.balance_naira ?? inv.balance / 100).toLocaleString()}
                          </td>
                          <td className="py-2 px-3">{inv.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h4 className="font-bold text-slate-800 mb-2">Recent Payments ({payments.length})</h4>
                <div className="overflow-x-auto max-h-96 border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 px-3">Reference</th>
                        <th className="py-2 px-3">Student</th>
                        <th className="py-2 px-3 text-right">Amount</th>
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2 px-3 font-mono">{p.payment_reference}</td>
                          <td className="py-2 px-3 font-medium text-slate-900">{p.student_name || '—'}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-emerald-700">
                            ₦{Number(p.amount_naira ?? p.amount / 100).toLocaleString()}
                          </td>
                          <td className="py-2 px-3">{p.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Teacher Read-Only Report Card Generator Modal */}
      {reportTargetStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm">Generate Student Report Card</h3>
                <p className="text-[11px] text-slate-300">
                  {reportTargetStudent.full_name} ({reportTargetStudent.admission_number})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportTargetStudent(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleGenerateTeacherReport} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">Report Card Type</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setReportGenType('TERM')}
                    className={`py-2 px-3 rounded-lg font-semibold transition cursor-pointer ${
                      reportGenType === 'TERM' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    End-of-Term
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportGenType('SESSION')}
                    className={`py-2 px-3 rounded-lg font-semibold transition cursor-pointer ${
                      reportGenType === 'SESSION' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Full-Session Cumulative
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Academic Session</label>
                <select
                  required
                  value={reportGenSessionId}
                  onChange={(e) => {
                    const nextSessId = e.target.value;
                    setReportGenSessionId(nextSessId);
                    const matched = (dashboard?.sessions || []).find((s) => s.id === nextSessId);
                    setReportGenTermId(matched?.terms?.[0]?.id || '');
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="">Select Session...</option>
                  {(dashboard?.sessions || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {reportGenType === 'TERM' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Term</label>
                  <select
                    required
                    value={reportGenTermId}
                    onChange={(e) => setReportGenTermId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Term...</option>
                    {((dashboard?.sessions || []).find((s) => s.id === reportGenSessionId)?.terms || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {reportGenError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>{reportGenError}</span>
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReportTargetStudent(null)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reportGenerating}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{reportGenerating ? 'Compiling...' : 'Compile & Print'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <PrintableReportCardModal
        reportCard={viewingRc}
        isOpen={Boolean(viewingRc)}
        onClose={() => setViewingRc(null)}
      />
    </div>
  );
};
