import React, { useEffect, useState } from 'react';
import {
  GraduationCap,
  BarChart3,
  FileText,
  CalendarCheck,
  MessageSquare,
  Bell,
  CreditCard,
  Printer,
  Receipt,
  Check,
  User,
  Megaphone,
  Lock,
  Mail,
  Phone,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { AcademicSessionItem, ReceiptItem, ReportCardItem, StudentDashboardData } from '../../types/index.js';
import { AttendanceBadge, SeverityBadge, WorkflowStatusBadge } from '../common/StatusBadge.js';
import { PrintableReportCardModal } from '../performance/PrintableReportCardModal.js';
import { PrintableReceiptModal } from '../school/PrintableReceiptModal.js';

type StudentTab =
  | 'overview'
  | 'profile'
  | 'results'
  | 'reports'
  | 'attendance'
  | 'behaviour'
  | 'fees'
  | 'announcements'
  | 'notifications';

export const StudentPortalView: React.FC = () => {
  const { activeSchoolId, user } = useAuth();
  const [tab, setTab] = useState<StudentTab>('overview');
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [sessions, setSessions] = useState<AcademicSessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedTermId, setSelectedTermId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewingRc, setViewingRc] = useState<ReportCardItem | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptItem | null>(null);

  const loadDashboard = async (sessionId = selectedSessionId, termId = selectedTermId) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStudentDashboard({
        academic_session_id: sessionId || undefined,
        term_id: termId || undefined,
      });
      setData(res);
      if (res.sessions) {
        setSessions(res.sessions);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load student portal');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard('', '');
  }, [activeSchoolId]);

  const handleOpenReportCard = async (id: string) => {
    try {
      const res = await api.getStudentReportCard(id);
      setViewingRc(res.reportCard);
    } catch (err: any) {
      setError(err?.message || 'Failed to open report card');
    }
  };

  const handleOpenReceipt = async (receiptId: string) => {
    try {
      const res = await api.getReceiptDetails(receiptId);
      setViewingReceipt(res.receipt);
    } catch (err: any) {
      setError(err?.message || 'Failed to open receipt');
    }
  };

  const handleMarkNoticeRead = async (id: string) => {
    try {
      await api.markNotificationAsRead(id);
      await loadDashboard();
    } catch {
      // ignore
    }
  };

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-400">
        Loading Student Academic Portal...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-xs text-rose-800">{error}</div>
    );
  }

  if (!data || !data.student) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
          <GraduationCap className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-slate-900">Student Profile Not Bound Yet</h2>
        <p className="text-xs text-slate-600 max-w-md mx-auto">
          Your login is active, but your school administrator has not linked it to an enrolled student profile yet.
        </p>
      </div>
    );
  }

  const latestAverage =
    data.results.length > 0
      ? data.results.reduce((acc, r) => acc + Number(r.total_score || 0), 0) / data.results.length
      : null;
  const selectedSessionObj = sessions.find((s) => s.id === selectedSessionId);

  const unreadNotificationsCount = data.notifications.filter((n) => !n.read_at).length;

  const navItems: Array<{ key: StudentTab; label: string; icon: any; badge?: number }> = [
    { key: 'overview', label: 'Overview', icon: GraduationCap },
    { key: 'profile', label: 'My Profile', icon: User },
    { key: 'results', label: 'My Results', icon: BarChart3 },
    { key: 'reports', label: 'My Report Cards', icon: FileText },
    { key: 'attendance', label: 'My Attendance', icon: CalendarCheck },
    { key: 'behaviour', label: 'Behaviour & Remarks', icon: MessageSquare },
    ...(data.feesVisible ? [{ key: 'fees' as const, label: 'My Fee Status', icon: CreditCard }] : []),
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
    { key: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotificationsCount },
  ];

  return (
    <div className="space-y-6">
      {/* Student Profile Header & Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{data.student.full_name}</h2>
            <p className="text-xs text-slate-500">
              Admission No: <span className="font-mono text-slate-700">{data.student.admission_number}</span> · Class:{' '}
              {data.student.class_name || 'Unassigned'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={selectedSessionId}
              onChange={(e) => {
                setSelectedSessionId(e.target.value);
                setSelectedTermId('');
                loadDashboard(e.target.value, '');
              }}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
            >
              <option value="">All Sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={selectedTermId}
              onChange={(e) => {
                setSelectedTermId(e.target.value);
                loadDashboard(selectedSessionId, e.target.value);
              }}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
            >
              <option value="">All Terms</option>
              {(selectedSessionObj?.terms || sessions.flatMap((s) => s.terms || [])).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-100">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
                {item.badge ? (
                  <span className="px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-bold tabular-nums">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* MY PROFILE (READ-ONLY) */}
      {tab === 'profile' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Student Academic Profile</h3>
              <p className="text-slate-500 mt-0.5">
                Official student biodata and enrollment records are managed by School Administration.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold self-start">
              <Lock className="w-3 h-3" />
              <span>Read-Only</span>
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400">Student Record</p>
              <p className="text-sm font-bold text-slate-900">{data.student.full_name}</p>
              <p className="text-slate-600">
                Admission Number: <span className="font-mono font-semibold text-slate-800">{data.student.admission_number}</span>
              </p>
              <p className="text-slate-600">
                Class &amp; Arm: <strong>{data.student.class_name || 'Unassigned'}</strong>
                {data.student.class_arm_name ? ` · ${data.student.class_arm_name}` : ''}
              </p>
              <p className="text-slate-600">Gender: {data.student.gender || '—'}</p>
              <p className="text-slate-600">Status: {data.student.student_status || 'ACTIVE'}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400">Account &amp; School</p>
              <p className="flex items-center gap-1.5 text-slate-600">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>{user?.email || data.student.email || '—'}</span>
              </p>
              <p className="flex items-center gap-1.5 text-slate-600">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>{data.student.phone || data.student.guardian_phone || 'Not recorded'}</span>
              </p>
              <p className="text-slate-600">School: {data.school?.name || '—'}</p>
              <p className="text-slate-600">State: {data.student.state || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Published Score Avg</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {latestAverage !== null ? `${latestAverage.toFixed(1)}%` : '—'}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">{data.results.length} subject(s)</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Attendance Rate</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                {data.attendance.summary.totalDays > 0 ? `${data.attendance.summary.attendanceRatePct}%` : '—'}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                {data.attendance.summary.present}/{data.attendance.summary.totalDays} day(s)
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Report Cards</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{data.reportCards.length}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Published copies</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Conduct Notes</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{data.behaviour.length}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Shared observations</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Academic Progress Across Terms</h3>
            {data.termTrend.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No published examination trends available yet.
              </p>
            ) : (
              <svg viewBox="0 0 420 140" className="w-full h-36 overflow-visible">
                <line x1="24" y1="115" x2="404" y2="115" stroke="#e2e8f0" strokeWidth="1" />
                {data.termTrend.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#059669"
                    strokeWidth="2.5"
                    points={data.termTrend
                      .map((pt, i) => {
                        const x = 36 + (i * 356) / Math.max(1, data.termTrend.length - 1);
                        const y = 115 - Math.min(100, Math.max(0, pt.averagePct));
                        return `${x},${y}`;
                      })
                      .join(' ')}
                  />
                )}
                {data.termTrend.map((pt, i) => {
                  const x = data.termTrend.length === 1 ? 210 : 36 + (i * 356) / (data.termTrend.length - 1);
                  const y = 115 - Math.min(100, Math.max(0, pt.averagePct));
                  return (
                    <g key={pt.key}>
                      <circle cx={x} cy={y} r="4.5" fill="#059669" stroke="#fff" strokeWidth="1.5" />
                      <text x={x} y={y - 9} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">
                        {pt.averagePct.toFixed(1)}%
                      </text>
                      <text x={x} y="132" textAnchor="middle" fontSize="9.5" fill="#64748b">
                        {pt.label.slice(0, 18)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>
      )}

      {/* RESULTS */}
      {tab === 'results' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Published Examination Results</h3>
          {data.results.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No published examination scores yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-3">Examination</th>
                    <th className="py-2.5 px-3">Subject</th>
                    <th className="py-2.5 px-3 text-right">CA</th>
                    <th className="py-2.5 px-3 text-right">Exam</th>
                    <th className="py-2.5 px-3 text-right">Total</th>
                    <th className="py-2.5 px-3 text-center">Grade</th>
                    <th className="py-2.5 px-3">Remark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.results.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-3 text-slate-700">{r.exam_title}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{r.subject_name}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{r.ca_score ?? '—'}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{r.exam_score ?? '—'}</td>
                      <td className="py-2.5 px-3 text-right font-bold tabular-nums">{r.total_score ?? '—'}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-emerald-700">{r.grade || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-600">{r.subject_remark || r.grade_remark || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* REPORT CARDS */}
      {tab === 'reports' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Published Report Cards</h3>
          {data.reportCards.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No published report cards available yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {data.reportCards.map((rc) => (
                <div key={rc.id} className="p-4 rounded-xl border border-slate-200 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900 text-sm">
                        {rc.session_name} · {rc.term_name}
                      </p>
                      <WorkflowStatusBadge status={rc.status} />
                    </div>
                    <p className="text-slate-600 tabular-nums">
                      Average: <strong>{Number(rc.average_score || 0).toFixed(1)}%</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenReportCard(rc.id)}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Open &amp; Print</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ATTENDANCE */}
      {tab === 'attendance' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Published Attendance Record</h3>
          {data.attendance.records.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No published attendance logs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.attendance.records.map((rec) => (
                    <tr key={rec.id}>
                      <td className="py-2.5 px-3 font-mono text-slate-700 tabular-nums">{rec.attendance_date}</td>
                      <td className="py-2.5 px-3">
                        <AttendanceBadge status={rec.status} />
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{rec.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* BEHAVIOUR & REMARKS */}
      {tab === 'behaviour' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">Teacher Remarks</h3>
            {data.teacherRemarks.length === 0 ? (
              <p className="text-slate-400 italic">No official remarks shared yet.</p>
            ) : (
              <div className="space-y-2">
                {data.teacherRemarks.map((rm) => (
                  <div key={rm.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50">
                    <p className="font-semibold text-slate-900">
                      {rm.session_name} · {rm.term_name}
                    </p>
                    <p className="text-slate-700 mt-1">{rm.remark_text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">Behaviour Highlights</h3>
            {data.behaviour.length === 0 ? (
              <p className="text-slate-400 italic">No behaviour notes shared with student portal.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.behaviour.map((b) => (
                  <div key={b.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{b.title}</span>
                      <SeverityBadge severity={b.severity} />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {b.category} · <span className="font-mono tabular-nums">{b.record_date}</span>
                    </p>
                    <p className="text-slate-700">{b.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SCHOOL ANNOUNCEMENTS */}
      {tab === 'announcements' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 text-xs">
          <h3 className="text-sm font-bold text-slate-900">School Announcements ({data.announcements.length})</h3>
          {data.announcements.length === 0 ? (
            <p className="py-10 text-center text-slate-400">No announcements published for students yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.announcements.map((a) => (
                <div key={a.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-900 text-sm">{a.title}</p>
                    <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                      {a.published_at ? new Date(a.published_at).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <p className="text-slate-700 whitespace-pre-line leading-relaxed">{a.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* NOTIFICATIONS */}
      {tab === 'notifications' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 text-xs">
          <h3 className="text-sm font-bold text-slate-900">Notifications ({data.notifications.length})</h3>
          {data.notifications.length === 0 ? (
            <p className="py-10 text-center text-slate-400">No notifications yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.notifications.map((n) => (
                <div key={n.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-900">{n.title}</p>
                    <p className="text-slate-600">{n.message}</p>
                    <p className="text-[10px] font-mono text-slate-400 tabular-nums">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                  {!n.read_at && (
                    <button
                      type="button"
                      onClick={() => handleMarkNoticeRead(n.id)}
                      className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 shrink-0 cursor-pointer"
                      title="Mark read"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CONDITIONAL READ-ONLY FEES TAB */}
      {tab === 'fees' && data.feesVisible && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <p className="text-slate-500">Total Billed</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">
                ₦{Number(data.feeSummary?.totalBilledNaira || 0).toLocaleString()}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <p className="text-slate-500">Total Paid</p>
              <p className="text-lg font-bold text-emerald-700 tabular-nums">
                ₦{Number(data.feeSummary?.totalPaidNaira || 0).toLocaleString()}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
              <p className="text-slate-500">Outstanding</p>
              <p className="text-lg font-bold text-rose-700 tabular-nums">
                ₦{Number(data.feeSummary?.outstandingNaira || 0).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900">Receipts</h3>
            {data.receipts.length === 0 ? (
              <p className="text-slate-400 italic">No receipts issued yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 px-3">Receipt #</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.receipts.map((rcp) => (
                      <tr key={rcp.id}>
                        <td className="py-2 px-3 font-mono font-semibold">{rcp.receipt_number}</td>
                        <td className="py-2 px-3 font-mono tabular-nums">
                          {new Date(rcp.issue_date || rcp.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-3 text-right font-bold tabular-nums text-emerald-700">
                          ₦{Number(rcp.amount_naira ?? rcp.amount / 100).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenReceipt(rcp.id)}
                            className="px-3 py-1 bg-slate-900 text-white rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Receipt className="w-3 h-3" />
                            <span>View</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <PrintableReportCardModal
        reportCard={viewingRc}
        isOpen={Boolean(viewingRc)}
        onClose={() => setViewingRc(null)}
      />

      <PrintableReceiptModal
        receipt={viewingReceipt}
        isOpen={Boolean(viewingReceipt)}
        onClose={() => setViewingReceipt(null)}
      />
    </div>
  );
};
