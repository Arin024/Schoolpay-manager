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
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { InvoiceDef, PaymentItem, TeacherDashboardData } from '../../types/index.js';
import { SchoolPerformanceView } from '../performance/SchoolPerformanceView.js';
import { SchoolAttendanceView } from '../performance/SchoolAttendanceView.js';
import { SchoolBehaviourView } from '../performance/SchoolBehaviourView.js';
import { SchoolAnnouncementsView } from '../performance/SchoolAnnouncementsView.js';

type TeacherTab =
  | 'overview'
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

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTeacherDashboard();
      setDashboard(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Educator Workspace');
    } finally {
      setLoading(false);
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

  const navItems: Array<{ key: TeacherTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
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
      {/* Educator Workspace Banner & Navigation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Read-Only Educator Workspace</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              View authorized classes, learners, academic results, attendance registers, and conduct logs. All record updates are restricted to School Administration.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 shrink-0">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            <span>Read-Only Access</span>
          </span>
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
              </button>
            );
          })}
        </div>
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && dashboard && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <button
              type="button"
              onClick={() => setTab('students')}
              className="bg-white rounded-2xl border border-slate-200 p-4 text-left hover:border-slate-300 transition cursor-pointer"
            >
              <p className="text-xs text-slate-500">Authorized Learners</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{dashboard.stats.studentsCount}</p>
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
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{dashboard.stats.subjectsCount}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Active school subjects</p>
            </button>
            <button
              type="button"
              onClick={() => setTab('performance')}
              className="bg-white rounded-2xl border border-slate-200 p-4 text-left hover:border-slate-300 transition cursor-pointer"
            >
              <p className="text-xs text-slate-500">Published Exams</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                {dashboard.stats.publishedExamsCount}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">Report &amp; score access</p>
            </button>
            <button
              type="button"
              onClick={() => setTab('announcements')}
              className="bg-white rounded-2xl border border-slate-200 p-4 text-left hover:border-slate-300 transition cursor-pointer col-span-2 lg:col-span-1"
            >
              <p className="text-xs text-slate-500">Announcements</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {dashboard.stats.announcementsCount}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">Published notices</p>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
              <p className="text-slate-600">
                Staff No: <span className="font-mono">{teacherStaff?.staff_number || 'Unlinked'}</span>
              </p>
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
    </div>
  );
};
