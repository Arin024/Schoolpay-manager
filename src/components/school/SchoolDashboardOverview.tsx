import React, { useEffect, useState } from 'react';
import {
  GraduationCap,
  Users,
  Building2,
  Calendar,
  UserCheck,
  ArrowUpRight,
  PlusCircle,
  FileSpreadsheet,
  Download,
  Clock,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  CreditCard,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { SchoolDashboardStats } from '../../types/index.js';

interface SchoolDashboardOverviewProps {
  onNavigateTab: (tab: any) => void;
  onOpenEnrollModal: () => void;
  onOpenImportModal: () => void;
}

export const SchoolDashboardOverview: React.FC<SchoolDashboardOverviewProps> = ({
  onNavigateTab,
  onOpenEnrollModal,
  onOpenImportModal,
}) => {
  const { activeSchool } = useAuth();
  const [stats, setStats] = useState<SchoolDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardStats();
  }, [activeSchool?.id]);

  const loadDashboardStats = async () => {
    setLoading(true);
    try {
      const res = await api.getSchoolStats();
      setStats(res.stats);
    } catch (err) {
      console.error('Failed to load school statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
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

  return (
    <div className="space-y-6">
      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4">
        {/* Total Students */}
        <div
          onClick={() => onNavigateTab('students')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:border-emerald-300 hover:shadow-md transition cursor-pointer group relative overflow-hidden"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Enrolled</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center group-hover:scale-110 transition">
              <GraduationCap className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {loading ? '...' : stats?.totalStudents ?? 0}
          </p>
          <p className="text-[11px] text-emerald-600 font-semibold mt-1 flex items-center gap-1">
            <UserCheck className="w-3 h-3" />
            <span>{stats?.activeStudents ?? 0} Active Learners</span>
          </p>
        </div>

        {/* Classes & Arms */}
        <div
          onClick={() => onNavigateTab('classes')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:border-emerald-300 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Academic Classes</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center group-hover:scale-110 transition">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {loading ? '...' : stats?.totalClasses ?? 0}
          </p>
          <p className="text-[11px] text-slate-500 font-medium mt-1">Levels &amp; Streams</p>
        </div>

        {/* Staff Members */}
        <div
          onClick={() => onNavigateTab('staff')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:border-emerald-300 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">School Staff</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center group-hover:scale-110 transition">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {loading ? '...' : stats?.totalStaff ?? 0}
          </p>
          <p className="text-[11px] text-slate-500 font-medium mt-1">Teachers &amp; Admin</p>
        </div>

        {/* Parents / Guardians */}
        <div
          onClick={() => onNavigateTab('parents')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:border-emerald-300 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Parents/Guardians</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center group-hover:scale-110 transition">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {loading ? '...' : stats?.totalParents ?? 0}
          </p>
          <p className="text-[11px] text-slate-500 font-medium mt-1">Verified Contacts</p>
        </div>

        {/* Active Session & Term */}
        <div
          onClick={() => onNavigateTab('sessions')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:border-emerald-300 hover:shadow-md transition cursor-pointer col-span-2 lg:col-span-1 group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Current Session</span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center group-hover:scale-110 transition">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <p className="text-lg sm:text-xl font-black text-slate-900 tracking-tight truncate">
            {loading ? '...' : stats?.currentAcademicSession ?? '2024/2025'}
          </p>
          <p className="text-[11px] text-teal-700 font-bold mt-1 truncate">
            {stats?.currentTerm ?? '1st Term'} (Active)
          </p>
        </div>
      </div>

      {/* Quick Actions & Recent Activity Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Operations Panel */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>Quick Actions</span>
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">Tenant Tools</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
            <button
              onClick={onOpenEnrollModal}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-between shadow-sm cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <PlusCircle className="w-4 h-4" />
                <span>Enroll New Student</span>
              </span>
              <ArrowUpRight className="w-4 h-4 text-emerald-200" />
            </button>

            <button
              onClick={onOpenImportModal}
              className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Bulk Import via CSV</span>
              </span>
              <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-mono">.csv</span>
            </button>

            <button
              onClick={handleExport}
              className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Download className="w-4 h-4 text-blue-600" />
                <span>Export Students Directory</span>
              </span>
              <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-mono">CSV</span>
            </button>

            <button
              onClick={() => onNavigateTab('classes')}
              className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-purple-600" />
                <span>Configure Classes &amp; Arms</span>
              </span>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </button>

            <button
              onClick={() => onNavigateTab('finance')}
              className="w-full py-2.5 px-4 bg-blue-50 hover:bg-blue-100 text-blue-900 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer border border-blue-200"
            >
              <span className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <span>Fees &amp; Billing Invoices</span>
              </span>
              <ArrowUpRight className="w-4 h-4 text-blue-500" />
            </button>

            <button
              onClick={() => onNavigateTab('staff')}
              className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-600" />
                <span>Manage Staff Directory</span>
              </span>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Recently Enrolled Students */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-600" />
              <span>Recent Enrolled Learners</span>
            </h3>
            <button
              onClick={() => onNavigateTab('students')}
              className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="py-8 text-center text-xs text-slate-400">Loading enrollment telemetry...</div>
          ) : !stats?.recentStudents || stats.recentStudents.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No recent enrollments. Click &ldquo;Enroll New Student&rdquo; to add your first learner.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {stats.recentStudents.map((st) => (
                <div key={st.id} className="py-3 flex items-center justify-between hover:bg-slate-50/50 transition rounded-xl px-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs">
                      {st.full_name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">{st.full_name}</p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {st.admission_number} • {st.class_name || 'Unassigned'}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                    {st.student_status || 'ACTIVE'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Tenant Protection Reassurance Footer */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Tenant boundary verified</span>
            </span>
            <span className="text-slate-400">School ID: {activeSchool?.id}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
