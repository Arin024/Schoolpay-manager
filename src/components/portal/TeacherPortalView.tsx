import React, { useEffect, useState } from 'react';
import { BarChart3, CalendarCheck, MessageSquare, Megaphone, CreditCard, Lock } from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { AcademicSettings, InvoiceDef, PaymentItem } from '../../types/index.js';
import { SchoolPerformanceView } from '../performance/SchoolPerformanceView.js';
import { SchoolAttendanceView } from '../performance/SchoolAttendanceView.js';
import { SchoolBehaviourView } from '../performance/SchoolBehaviourView.js';
import { SchoolAnnouncementsView } from '../performance/SchoolAnnouncementsView.js';

type TeacherTab = 'performance' | 'attendance' | 'behaviour' | 'announcements' | 'fees';

export const TeacherPortalView: React.FC = () => {
  const { activeSchoolId } = useAuth();
  const [tab, setTab] = useState<TeacherTab>('performance');
  const [settings, setSettings] = useState<AcademicSettings | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDef[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [feesLoading, setFeesLoading] = useState(false);

  useEffect(() => {
    api
      .getAcademicSettings()
      .then((res) => setSettings(res.settings))
      .catch(() => setSettings(null));
  }, [activeSchoolId]);

  useEffect(() => {
    if (tab === 'fees' && settings?.teachers_can_view_fees) {
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
  }, [tab, settings?.teachers_can_view_fees]);

  const navItems: Array<{ key: TeacherTab; label: string; icon: any }> = [
    { key: 'performance', label: 'Performance & Report Cards', icon: BarChart3 },
    { key: 'attendance', label: 'Attendance Logs', icon: CalendarCheck },
    { key: 'behaviour', label: 'Behaviour & Remarks', icon: MessageSquare },
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
    ...(settings?.teachers_can_view_fees
      ? [{ key: 'fees' as const, label: 'Fees Overview', icon: CreditCard }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Educator Workspace Banner & Nav */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Read-Only Educator Workspace</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Official score approvals, report card publication, attendance registers, and discipline logs are managed by School Administration.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 shrink-0">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
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
                  active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'performance' && <SchoolPerformanceView readOnly />}
      {tab === 'attendance' && <SchoolAttendanceView readOnly />}
      {tab === 'behaviour' && <SchoolBehaviourView readOnly />}
      {tab === 'announcements' && <SchoolAnnouncementsView readOnly />}

      {tab === 'fees' && settings?.teachers_can_view_fees && (
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
