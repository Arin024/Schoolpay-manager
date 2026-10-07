import React, { useState } from 'react';
import { Building2, MapPin, Phone, Mail, Globe, Shield, Save, CheckCircle2, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { SchoolStatusBadge } from '../common/StatusBadge.js';
import { NIGERIAN_STATES, SCHOOL_TYPES } from '../../constants/index.js';

export const SchoolProfileView: React.FC = () => {
  const { activeSchool, activeSchoolId, activeRole, setActiveSchool, refreshMe } = useAuth();

  const [formData, setFormData] = useState({
    name: activeSchool?.name || '',
    type: activeSchool?.type || 'Secondary',
    state: activeSchool?.state || 'Lagos',
    lga: activeSchool?.lga || '',
    address: activeSchool?.address || '',
    phone: activeSchool?.phone || '',
    email: activeSchool?.email || '',
    website: activeSchool?.website || '',
  });

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canEdit = activeRole?.role_name === 'SCHOOL_OWNER' || activeRole?.role_name === 'SCHOOL_ADMIN' || activeRole?.role_name === 'SUPER_ADMIN';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
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
      const res = await api.updateSchoolProfile(activeSchoolId, formData as any);
      setSuccessMsg(res.message);
      setActiveSchool(res.school);
      await refreshMe();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  if (!activeSchool) {
    return (
      <div className="bg-white rounded-2xl p-8 text-center border border-slate-200">
        <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-base font-bold text-slate-800">No active school tenant selected</h3>
        <p className="text-xs text-slate-500 mt-1">Please select an affiliated school from your profile menu.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* School Header Banner Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Logo Placeholder */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-slate-200 flex items-center justify-center text-white shadow-inner flex-shrink-0">
              <span className="text-2xl font-black text-emerald-400">
                {activeSchool.name.charAt(0)}
              </span>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                  {activeSchool.name}
                </h1>
                <SchoolStatusBadge status={activeSchool.status} size="sm" />
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Tenant ID: <span className="font-mono text-slate-700 font-semibold">{activeSchool.id}</span> • Slug: <span className="font-mono text-slate-700">{activeSchool.slug}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 self-start sm:self-auto">
            <Shield className="w-4 h-4 text-emerald-600" />
            <span className="text-slate-600 font-medium">Tenant Isolation: <strong className="text-emerald-700">Strictly Enforced</strong></span>
          </div>
        </div>

        {/* Warning banner if suspended or in trial */}
        {activeSchool.status === 'TRIAL' && (
          <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
            <span><strong>Trial Account:</strong> You are currently on an active trial with full platform access.</span>
          </div>
        )}

        {activeSchool.status === 'SUSPENDED' && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-600" />
            <span><strong>Account Suspended:</strong> Modifications are temporarily restricted. Your school data is safely preserved.</span>
          </div>
        )}
      </div>

      {/* Profile Form Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-6">
          <div>
            <h2 className="text-base font-bold text-slate-900">Official Institutional Profile</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              School registration details displayed on fee invoices, student receipts, and official reports.
            </p>
          </div>
          {!canEdit && (
            <span className="text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 font-medium">
              Read-Only View
            </span>
          )}
        </div>

        {successMsg && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Registered School Name
              </label>
              <input
                type="text"
                name="name"
                disabled={!canEdit}
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-xl disabled:bg-slate-100 disabled:text-slate-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                School Classification / Type
              </label>
              <select
                name="type"
                disabled={!canEdit}
                value={formData.type}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-xl disabled:bg-slate-100 disabled:text-slate-500 transition"
              >
                {SCHOOL_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                State (Nigeria)
              </label>
              <select
                name="state"
                disabled={!canEdit}
                value={formData.state}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-xl disabled:bg-slate-100 disabled:text-slate-500 transition"
              >
                {NIGERIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Local Government Area (LGA)
              </label>
              <input
                type="text"
                name="lga"
                disabled={!canEdit}
                value={formData.lga}
                onChange={handleChange}
                required
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-xl disabled:bg-slate-100 disabled:text-slate-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Official Phone Contact
              </label>
              <input
                type="tel"
                name="phone"
                disabled={!canEdit}
                value={formData.phone}
                onChange={handleChange}
                required
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-xl disabled:bg-slate-100 disabled:text-slate-500 transition"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Campus Physical Address
              </label>
              <input
                type="text"
                name="address"
                disabled={!canEdit}
                value={formData.address}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-xl disabled:bg-slate-100 disabled:text-slate-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Official School Email Address
              </label>
              <input
                type="email"
                name="email"
                disabled={!canEdit}
                value={formData.email}
                onChange={handleChange}
                required
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-xl disabled:bg-slate-100 disabled:text-slate-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                School Website URL
              </label>
              <input
                type="url"
                name="website"
                disabled={!canEdit}
                value={formData.website}
                onChange={handleChange}
                placeholder="https://myschool.edu.ng"
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 focus:bg-white border border-slate-300 focus:border-emerald-500 rounded-xl disabled:bg-slate-100 disabled:text-slate-500 transition"
              />
            </div>
          </div>

          {canEdit && (
            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl shadow-sm transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{loading ? 'Saving...' : 'Save Profile Changes'}</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
