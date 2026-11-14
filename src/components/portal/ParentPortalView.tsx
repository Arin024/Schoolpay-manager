import React, { useEffect, useState } from 'react';
import {
  User,
  BarChart3,
  FileText,
  CalendarCheck,
  MessageSquare,
  CreditCard,
  Bell,
  Printer,
  CheckCircle2,
  AlertCircle,
  X,
  Receipt,
  Check,
  Users,
  Megaphone,
  History,
  UserCheck,
  Mail,
  Phone,
  Lock,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  AcademicSessionItem,
  ParentDashboardData,
  ReceiptItem,
  ReportCardItem,
  InvoiceDef,
} from '../../types/index.js';
import { AttendanceBadge, SeverityBadge, WorkflowStatusBadge } from '../common/StatusBadge.js';
import { PrintableReportCardModal } from '../performance/PrintableReportCardModal.js';
import { PrintableReceiptModal } from '../school/PrintableReceiptModal.js';

type ParentTab =
  | 'overview'
  | 'results'
  | 'reports'
  | 'attendance'
  | 'behaviour'
  | 'fees'
  | 'payments'
  | 'receipts'
  | 'announcements'
  | 'profile'
  | 'notifications';

export const ParentPortalView: React.FC = () => {
  const { activeSchoolId, user } = useAuth();
  const [tab, setTab] = useState<ParentTab>('overview');
  const [data, setData] = useState<ParentDashboardData | null>(null);
  const [sessions, setSessions] = useState<AcademicSessionItem[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedTermId, setSelectedTermId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Report card & Receipt modals
  const [viewingRc, setViewingRc] = useState<ReportCardItem | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptItem | null>(null);

  // Online Checkout state (Parent online payment only)
  const [checkoutInvoice, setCheckoutInvoice] = useState<InvoiceDef | null>(null);
  const [checkoutProvider, setCheckoutProvider] = useState<'TEST_SANDBOX' | 'PAYSTACK' | 'FLUTTERWAVE'>('TEST_SANDBOX');
  const [checkoutAmountNaira, setCheckoutAmountNaira] = useState('');
  const [checkoutEmail, setCheckoutEmail] = useState('');
  const [checkoutProcessing, setCheckoutProcessing] = useState(false);
  const [hostedCheckout, setHostedCheckout] = useState<{ url?: string; reference: string; amountKobo: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadDashboard = async (
    studentId = selectedChildId,
    sessionId = selectedSessionId,
    termId = selectedTermId
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getParentDashboard({
        student_id: studentId || undefined,
        academic_session_id: sessionId || undefined,
        term_id: termId || undefined,
      });
      setData(res);
      if (res.sessions) {
        setSessions(res.sessions);
      }
      if (!studentId && res.selectedChild?.id) {
        setSelectedChildId(res.selectedChild.id);
      }
      if (res.gateways?.length) {
        const firstConfigured = res.gateways.find((g) => g.isConfigured && g.name !== 'MANUAL');
        if (firstConfigured && (firstConfigured.name === 'PAYSTACK' || firstConfigured.name === 'FLUTTERWAVE' || firstConfigured.name === 'TEST_SANDBOX')) {
          setCheckoutProvider(firstConfigured.name);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load parent portal');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard('', '', '');
  }, [activeSchoolId]);

  const handleChildChange = (childId: string) => {
    setSelectedChildId(childId);
    loadDashboard(childId, selectedSessionId, selectedTermId);
  };

  const handleOpenReportCard = async (id: string) => {
    try {
      const res = await api.getParentReportCard(id);
      setViewingRc(res.reportCard);
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err?.message || 'Failed to load report card' });
    }
  };

  const handleOpenReceipt = async (receiptId: string) => {
    try {
      const res = await api.getReceiptDetails(receiptId);
      setViewingReceipt(res.receipt);
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err?.message || 'Failed to open receipt' });
    }
  };

  const handleStartCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutInvoice) return;
    setCheckoutProcessing(true);
    setStatusMsg(null);
    try {
      const amountKobo = Math.round(parseFloat(checkoutAmountNaira) * 100);
      const initRes = await api.initializeOnlineCheckout(checkoutInvoice.id, {
        provider: checkoutProvider,
        amount_kobo: amountKobo,
        email: checkoutEmail || user?.email || 'parent@school.edu.ng',
      });

      if (checkoutProvider === 'TEST_SANDBOX') {
        const verifyRes = await api.verifyOnlinePayment({
          provider: checkoutProvider,
          reference: initRes.providerReference,
          invoice_id: checkoutInvoice.id,
          amount_kobo: amountKobo,
        });
        setCheckoutInvoice(null);
        setHostedCheckout(null);
        setStatusMsg({ type: 'ok', text: 'Online payment verified and official digital receipt issued.' });
        await loadDashboard(selectedChildId, selectedSessionId, selectedTermId);
        if (verifyRes.payment?.receipt?.receiptId) {
          await handleOpenReceipt(verifyRes.payment.receipt.receiptId);
        }
      } else {
        setHostedCheckout({
          url: initRes.authorizationUrl || initRes.checkoutUrl,
          reference: initRes.providerReference,
          amountKobo,
        });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err?.message || 'Failed to initialize online checkout' });
    } finally {
      setCheckoutProcessing(false);
    }
  };

  const handleVerifyHostedCheckout = async () => {
    if (!checkoutInvoice || !hostedCheckout) return;
    setCheckoutProcessing(true);
    try {
      const verifyRes = await api.verifyOnlinePayment({
        provider: checkoutProvider,
        reference: hostedCheckout.reference,
        invoice_id: checkoutInvoice.id,
        amount_kobo: hostedCheckout.amountKobo,
      });
      setCheckoutInvoice(null);
      setHostedCheckout(null);
      setStatusMsg({ type: 'ok', text: 'Online payment verified and official digital receipt issued.' });
      await loadDashboard(selectedChildId, selectedSessionId, selectedTermId);
      if (verifyRes.payment?.receipt?.receiptId) {
        await handleOpenReceipt(verifyRes.payment.receipt.receiptId);
      }
    } catch (err: any) {
      setStatusMsg({ type: 'err', text: err?.message || 'Payment verification failed' });
    } finally {
      setCheckoutProcessing(false);
    }
  };

  const handleMarkNoticeRead = async (id: string) => {
    try {
      await api.markNotificationAsRead(id);
      await loadDashboard(selectedChildId, selectedSessionId, selectedTermId);
    } catch {
      // ignore
    }
  };

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-400">
        Loading Parent &amp; Guardian Portal...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-xs text-rose-800">
        {error}
      </div>
    );
  }

  if (!data || data.children.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
          <User className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-slate-900">No Verified Children Assigned Yet</h2>
        <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
          Your Parent Portal account is active, but the School Administration has not explicitly linked your profile to any enrolled student yet. For student privacy protection, parent-child links are verified strictly by school staff.
        </p>
      </div>
    );
  }

  const latestAverage =
    data.results.length > 0
      ? data.results.reduce((acc, r) => acc + Number(r.total_score || 0), 0) / data.results.length
      : null;

  const selectedSessionObj = sessions.find((s) => s.id === selectedSessionId);

  return (
    <div className="space-y-6">
      {/* Child Selector & Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {data.children.map((ch) => {
              const active = data.selectedChild?.id === ch.id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => handleChildChange(ch.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {ch.full_name} · {ch.class_name || 'Unassigned'}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={selectedSessionId}
              onChange={(e) => {
                setSelectedSessionId(e.target.value);
                setSelectedTermId('');
                loadDashboard(selectedChildId, e.target.value, '');
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
                loadDashboard(selectedChildId, selectedSessionId, e.target.value);
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

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-100">
          {(
            [
              { key: 'overview', label: 'My Children', icon: Users },
              { key: 'results', label: 'Examination Results', icon: BarChart3 },
              { key: 'reports', label: 'Report Cards', icon: FileText },
              { key: 'attendance', label: 'Attendance History', icon: CalendarCheck },
              { key: 'behaviour', label: 'Behaviour & Remarks', icon: MessageSquare },
              { key: 'fees', label: 'Fee Status', icon: CreditCard },
              { key: 'payments', label: 'Payment History', icon: History },
              { key: 'receipts', label: 'Receipts', icon: Receipt },
              { key: 'announcements', label: 'Announcements', icon: Megaphone },
              { key: 'profile', label: 'Profile', icon: UserCheck },
              {
                key: 'notifications',
                label: 'Notifications',
                icon: Bell,
                badge: data.notifications.filter((n) => !n.read_at).length,
              },
            ] as Array<{ key: ParentTab; label: string; icon: any; badge?: number }>
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                  active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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

      {statusMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            statusMsg.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            {statusMsg.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </span>
          <button type="button" onClick={() => setStatusMsg(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Published Score Avg</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {latestAverage !== null ? `${latestAverage.toFixed(1)}%` : '—'}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                {data.results.length} published subject(s)
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Attendance Rate</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                {data.attendance.summary.totalDays > 0 ? `${data.attendance.summary.attendanceRatePct}%` : '—'}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                {data.attendance.summary.present} of {data.attendance.summary.totalDays} day(s)
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Published Report Cards</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{data.reportCards.length}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Official verified copies</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Outstanding Fees</p>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                ₦{Number(data.feeSummary?.outstandingNaira || 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                {data.feeSummary?.unpaidInvoicesCount || 0} open invoice(s)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Multi-term trend */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Academic Progress Trend</h3>
              {data.termTrend.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">
                  Published examination averages across terms will appear here.
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
                    const x =
                      data.termTrend.length === 1 ? 210 : 36 + (i * 356) / (data.termTrend.length - 1);
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

            {/* Latest Remarks & Announcements */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 text-xs">
              <h3 className="text-sm font-bold text-slate-900">Recent Remarks &amp; Notices</h3>
              {data.teacherRemarks.length === 0 && data.announcements.length === 0 ? (
                <p className="py-8 text-center text-slate-400">No published remarks or announcements yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.teacherRemarks.slice(0, 2).map((rm) => (
                    <div key={rm.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <p className="font-semibold text-slate-900">
                        Teacher Remark · {rm.session_name} {rm.term_name}
                      </p>
                      <p className="text-slate-600 mt-0.5">{rm.remark_text}</p>
                    </div>
                  ))}
                  {data.announcements.slice(0, 2).map((ann) => (
                    <div key={ann.id} className="p-3 rounded-xl border border-slate-200">
                      <p className="font-semibold text-slate-900">{ann.title}</p>
                      <p className="text-slate-600 mt-0.5 line-clamp-2">{ann.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PUBLISHED RESULTS */}
      {tab === 'results' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">
            Published Subject Results · {data.selectedChild?.full_name}
          </h3>
          {data.results.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">
              No published examination results available yet. Draft scores remain hidden until approved and published by School Admin.
            </p>
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
                      <td className="py-2.5 px-3 text-slate-700">
                        {r.exam_title}
                        <span className="block text-[10px] text-slate-400">
                          {r.session_name} · {r.term_name}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{r.subject_name}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{r.ca_score ?? '—'}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{r.exam_score ?? '—'}</td>
                      <td className="py-2.5 px-3 text-right font-bold tabular-nums text-slate-900">{r.total_score ?? '—'}</td>
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

      {/* TAB 3: REPORT CARDS */}
      {tab === 'reports' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Published Digital Report Cards</h3>
          {data.reportCards.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">
              No published report cards available for this child yet.
            </p>
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
                      {data.settings.show_class_position && rc.class_position
                        ? ` · Position ${rc.class_position} of ${rc.class_size || '—'}`
                        : ''}
                    </p>
                    <p className="font-mono text-[10px] text-slate-400">Code: {rc.verification_code || '—'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenReportCard(rc.id)}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
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

      {/* TAB 4: ATTENDANCE */}
      {tab === 'attendance' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900">Published Attendance History</h3>
            <div className="flex items-center gap-4 text-xs tabular-nums">
              <span>Present: <strong className="text-emerald-700">{data.attendance.summary.present}</strong></span>
              <span>Late: <strong className="text-amber-700">{data.attendance.summary.late}</strong></span>
              <span>Excused: <strong className="text-sky-700">{data.attendance.summary.excused}</strong></span>
              <span>Absent: <strong className="text-rose-700">{data.attendance.summary.absent}</strong></span>
            </div>
          </div>

          {data.attendance.records.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No published attendance records yet.</p>
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

      {/* TAB 5: CONDUCT & REMARKS */}
      {tab === 'behaviour' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">Official Termly Teacher Remarks</h3>
            {data.teacherRemarks.length === 0 ? (
              <p className="text-slate-400 italic">No remarks published for this period.</p>
            ) : (
              <div className="space-y-2.5">
                {data.teacherRemarks.map((rm) => (
                  <div key={rm.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50">
                    <p className="font-semibold text-slate-900">
                      {rm.session_name} · {rm.term_name} {rm.staff_name ? `(${rm.staff_name})` : ''}
                    </p>
                    <p className="text-slate-700 mt-1 leading-relaxed">{rm.remark_text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">Behaviour &amp; Conduct Observations</h3>
            {data.behaviour.length === 0 ? (
              <p className="text-slate-400 italic">No behaviour notes shared with parents for this child.</p>
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
                    {b.action_taken && (
                      <p className="text-[11px] text-slate-500">Action Taken: {b.action_taken}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: SCHOOL FEES, ONLINE CHECKOUT & RECEIPTS */}
      {tab === 'fees' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total Billed</p>
              <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                ₦{Number(data.feeSummary?.totalBilledNaira || 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total Paid</p>
              <p className="text-xl font-bold text-emerald-700 mt-1 tabular-nums">
                ₦{Number(data.feeSummary?.totalPaidNaira || 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Outstanding Balance</p>
              <p className="text-xl font-bold text-rose-700 mt-1 tabular-nums">
                ₦{Number(data.feeSummary?.outstandingNaira || 0).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Student Fee Invoices</h3>
            {data.invoices.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">No invoices issued for this student yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-3">Invoice #</th>
                      <th className="py-2.5 px-3">Session / Term</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      <th className="py-2.5 px-3 text-right">Paid</th>
                      <th className="py-2.5 px-3 text-right">Balance</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{inv.invoice_number}</td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {inv.session_name || '—'} · {inv.term_name || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          ₦{Number(inv.total_naira ?? inv.total / 100).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700">
                          ₦{Number(inv.amount_paid_naira ?? inv.amount_paid / 100).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold tabular-nums text-slate-900">
                          ₦{Number(inv.balance_naira ?? inv.balance / 100).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-700">{inv.status}</td>
                        <td className="py-2.5 px-3 text-right">
                          {inv.balance > 0 && inv.status !== 'CANCELLED' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCheckoutInvoice(inv);
                                setCheckoutAmountNaira(String(inv.balance / 100));
                                setCheckoutEmail(user?.email || '');
                                setHostedCheckout(null);
                              }}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                            >
                              Pay Online
                            </button>
                          ) : (
                            <span className="text-slate-400">Settled</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Official Digital Receipts ({data.receipts.length})</h3>
            {data.receipts.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">No payment receipts issued yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-3">Receipt #</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3 text-right">Amount Paid</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.receipts.map((rcp) => (
                      <tr key={rcp.id}>
                        <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{rcp.receipt_number}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-600 tabular-nums">
                          {new Date(rcp.issue_date || rcp.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{rcp.payment_method || 'ONLINE'}</td>
                        <td className="py-2.5 px-3 text-right font-bold tabular-nums text-emerald-700">
                          ₦{Number(rcp.amount_naira ?? rcp.amount / 100).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenReceipt(rcp.id)}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Receipt className="w-3 h-3" />
                            <span>View / Print</span>
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

      {/* TAB 7: PAYMENT HISTORY */}
      {tab === 'payments' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Payment History · {data.selectedChild?.full_name} ({data.payments.length})
            </h3>
            <span className="text-xs text-slate-500 tabular-nums">
              Total Paid: <strong className="text-emerald-700">₦{Number(data.feeSummary?.totalPaidNaira || 0).toLocaleString()}</strong>
            </span>
          </div>
          {data.payments.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No payments recorded for this child yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-3">Reference</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Invoice</th>
                    <th className="py-2.5 px-3">Method</th>
                    <th className="py-2.5 px-3 text-right">Amount</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{p.payment_reference}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 tabular-nums">
                        {p.payment_date || p.paid_at ? new Date(p.payment_date || p.paid_at!).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">{p.invoice_number || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-600">{p.payment_method}</td>
                      <td className="py-2.5 px-3 text-right font-bold tabular-nums text-emerald-700">
                        ₦{Number(p.amount_naira ?? p.amount / 100).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-700">{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 8: OFFICIAL DIGITAL RECEIPTS */}
      {tab === 'receipts' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">
            Official Digital Receipts · {data.selectedChild?.full_name} ({data.receipts.length})
          </h3>
          {data.receipts.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No payment receipts issued yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-3">Receipt #</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Method</th>
                    <th className="py-2.5 px-3 text-right">Amount Paid</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.receipts.map((rcp) => (
                    <tr key={rcp.id}>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">{rcp.receipt_number}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 tabular-nums">
                        {new Date(rcp.issue_date || rcp.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{rcp.payment_method || 'ONLINE'}</td>
                      <td className="py-2.5 px-3 text-right font-bold tabular-nums text-emerald-700">
                        ₦{Number(rcp.amount_naira ?? rcp.amount / 100).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenReceipt(rcp.id)}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Receipt className="w-3 h-3" />
                          <span>View / Print</span>
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

      {/* TAB 9: SCHOOL ANNOUNCEMENTS */}
      {tab === 'announcements' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 text-xs">
          <h3 className="text-sm font-bold text-slate-900">School Announcements ({data.announcements.length})</h3>
          {data.announcements.length === 0 ? (
            <p className="py-10 text-center text-slate-400">No announcements published for parents yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.announcements.map((a) => (
                <div key={a.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-900 text-sm">{a.title}</p>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {a.published_at ? new Date(a.published_at).toLocaleDateString() : ''}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">Priority: {a.priority}</p>
                  <p className="text-slate-700 leading-relaxed whitespace-pre-line">{a.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 10: GUARDIAN PROFILE */}
      {tab === 'profile' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 text-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Parent / Guardian Profile</h3>
              <p className="text-slate-500 mt-0.5">
                Contact information and verified child linkages are managed by School Administration.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold">
              <Lock className="w-3 h-3" />
              <span>Read-Only</span>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400">Guardian Details</p>
              <p className="text-sm font-bold text-slate-900">
                {data.parentProfile
                  ? `${data.parentProfile.first_name} ${data.parentProfile.last_name}`.trim()
                  : user?.full_name}
              </p>
              <p className="flex items-center gap-1.5 text-slate-600">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>{user?.email || data.parentProfile?.email || '—'}</span>
              </p>
              <p className="flex items-center gap-1.5 text-slate-600">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>{data.parentProfile?.phone || user?.phone || 'Not recorded'}</span>
              </p>
              {data.parentProfile?.occupation && (
                <p className="text-slate-600">Occupation: {data.parentProfile.occupation}</p>
              )}
              {data.parentProfile?.address && (
                <p className="text-slate-600">Address: {data.parentProfile.address}</p>
              )}
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400">
                Verified Linked Children ({data.children.length})
              </p>
              <div className="space-y-1.5">
                {data.children.map((ch) => (
                  <div key={ch.id} className="p-2 rounded-lg bg-white border border-slate-200 flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{ch.full_name}</span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {ch.admission_number} · {ch.class_name || 'Unassigned'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 11: NOTIFICATIONS */}
      {tab === 'notifications' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 text-xs">
          <h3 className="text-sm font-bold text-slate-900">Notifications ({data.notifications.length})</h3>
          {data.notifications.length === 0 ? (
            <p className="py-10 text-center text-slate-400">No notifications recorded.</p>
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

      {/* ONLINE CHECKOUT MODAL (PARENTS ONLY) */}
      {checkoutInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Online School Fee Checkout</h3>
              <button
                type="button"
                onClick={() => {
                  setCheckoutInvoice(null);
                  setHostedCheckout(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <p className="font-semibold text-slate-900">
                  Invoice {checkoutInvoice.invoice_number} · {data.selectedChild?.full_name}
                </p>
                <p className="text-slate-600 tabular-nums">
                  Balance Due: <strong>₦{(checkoutInvoice.balance / 100).toLocaleString()}</strong>
                </p>
              </div>

              {hostedCheckout ? (
                <div className="space-y-3">
                  <p className="text-slate-700">
                    Checkout session initialized (Reference: <code className="font-mono">{hostedCheckout.reference}</code>).
                  </p>
                  {hostedCheckout.url && (
                    <a
                      href={hostedCheckout.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold"
                    >
                      Open Payment Gateway Page
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={checkoutProcessing}
                    onClick={handleVerifyHostedCheckout}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60"
                  >
                    {checkoutProcessing ? 'Verifying...' : 'Verify Completed Payment'}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleStartCheckout} className="space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Payment Gateway</label>
                    <select
                      value={checkoutProvider}
                      onChange={(e) => setCheckoutProvider(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    >
                      <option value="TEST_SANDBOX">Instant Sandbox Checkout</option>
                      {data.gateways
                        .filter((g) => g.isConfigured && g.name !== 'TEST_SANDBOX' && g.name !== 'MANUAL')
                        .map((g) => (
                          <option key={g.name} value={g.name}>
                            {g.displayName}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Amount to Pay (₦)</label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={checkoutInvoice.balance / 100}
                      step="0.01"
                      value={checkoutAmountNaira}
                      onChange={(e) => setCheckoutAmountNaira(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Receipt Email</label>
                    <input
                      type="email"
                      required
                      value={checkoutEmail}
                      onChange={(e) => setCheckoutEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div className="pt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCheckoutInvoice(null)}
                      className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={checkoutProcessing}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60"
                    >
                      {checkoutProcessing ? 'Processing...' : 'Proceed to Pay'}
                    </button>
                  </div>
                </form>
              )}
            </div>
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
