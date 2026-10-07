import React, { useState } from 'react';
import { Sliders, Save, CheckCircle2, AlertCircle, Bell, Calendar, DollarSign, School } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';

export const SchoolSettingsView: React.FC = () => {
  const { activeSettings, activeSchoolId, activeRole, setActiveSettings, refreshMe } = useAuth();

  const [formData, setFormData] = useState({
    current_academic_session: activeSettings?.current_academic_session || '2024/2025',
    current_term: activeSettings?.current_term || '1st Term',
    payment_notification_email: activeSettings?.payment_notification_email || '',
    payment_notification_sms: activeSettings?.payment_notification_sms === 1,
    allow_partial_payments: activeSettings?.allow_partial_payments !== 0,
  });

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canEdit = ['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR', 'SUPER_ADMIN'].includes(activeRole?.role_name || '');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target;
    const value = target.type === 'checkbox' ? (target as HTMLInputElement).checked : target.value;
    setFormData((prev) => ({ ...prev, [target.name]: value }));
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSchoolId) return;

    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await api.updateSchoolSettings(activeSchoolId, {
        current_academic_session: formData.current_academic_session,
        current_term: formData.current_term,
        payment_notification_email: formData.payment_notification_email,
        payment_notification_sms: formData.payment_notification_sms ? 1 : 0,
        allow_partial_payments: formData.allow_partial_payments ? 1 : 0,
      } as any);

      setSuccessMsg(res.message);
      setActiveSettings(res.settings);
      await refreshMe();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update school settings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-600" />
            <span>Academic &amp; Financial Settings</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tenant-isolated financial parameters, academic sessions, and transaction alerts.
          </p>
        </div>
        {!canEdit && (
          <span className="text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 font-medium">
            Read-Only Access
          </span>
        )}
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Base Currency (Locked to NGN for Nigerian commercial market) */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Base Settlement Currency
            </label>
            <div className="flex items-center gap-2 mt-2">
              <span className="px-3 py-1.5 bg-emerald-600 text-white font-bold rounded-lg text-sm">
                ₦ NGN
              </span>
              <span className="text-xs text-slate-500">
                Nigerian Naira (Multi-tenant standard)
              </span>
            </div>
          </div>

          {/* Academic Session */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Current Academic Session
            </label>
            <select
              name="current_academic_session"
              disabled={!canEdit}
              value={formData.current_academic_session}
              onChange={handleChange}
              className="w-full mt-1.5 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="2023/2024">2023/2024 Session</option>
              <option value="2024/2025">2024/2025 Session</option>
              <option value="2025/2026">2025/2026 Session</option>
              <option value="2026/2027">2026/2027 Session</option>
            </select>
          </div>

          {/* Current Academic Term */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Active Term
            </label>
            <select
              name="current_term"
              disabled={!canEdit}
              value={formData.current_term}
              onChange={handleChange}
              className="w-full mt-1.5 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="1st Term">1st Term (Harmattan / First)</option>
              <option value="2nd Term">2nd Term (Easter / Second)</option>
              <option value="3rd Term">3rd Term (Trinity / Third)</option>
            </select>
          </div>

          {/* Bursar Notification Email */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Bursary Alert Notification Email
            </label>
            <input
              type="email"
              name="payment_notification_email"
              disabled={!canEdit}
              value={formData.payment_notification_email}
              onChange={handleChange}
              placeholder="e.g. bursary@school.edu.ng"
              className="w-full mt-1.5 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-3 pt-2">
          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              name="allow_partial_payments"
              disabled={!canEdit}
              checked={formData.allow_partial_payments}
              onChange={handleChange}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
            />
            <div>
              <span className="text-xs font-bold text-slate-900 block">Allow Installmental / Partial Fee Payments</span>
              <span className="text-[11px] text-slate-500">Permits parents to pay school fees in structured installments (foundation ready for Step 2).</span>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              name="payment_notification_sms"
              disabled={!canEdit}
              checked={formData.payment_notification_sms}
              onChange={handleChange}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
            />
            <div>
              <span className="text-xs font-bold text-slate-900 block">SMS Payment Receipt Alerts</span>
              <span className="text-[11px] text-slate-500">Dispatch instant SMS delivery to parents upon successful payment confirmation.</span>
            </div>
          </label>
        </div>

        {canEdit && (
          <div className="pt-4 border-t border-slate-200 flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl shadow-sm transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{loading ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        )}
      </form>
    </div>
  );
};
