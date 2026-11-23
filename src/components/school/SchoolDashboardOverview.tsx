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
  Copy,
  Check,
  Link2,
  UserPlus,
  AlertCircle,
  X,
  ExternalLink,
  MonitorCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { SchoolAdmissionInquiry, SchoolDashboardStats } from '../../types/index.js';
import { copyTextToClipboard } from '../../utils/clipboard.js';
import { resolveInstitutionProfile } from '../../utils/institutionMode.js';

interface SchoolDashboardOverviewProps {
  onNavigateTab: (tab: any) => void;
  onOpenEnrollModal: () => void;
  onOpenImportModal: () => void;
  onPreviewLiveWebsite?: (slug: string) => void;
  readOnly?: boolean;
}

export const SchoolDashboardOverview: React.FC<SchoolDashboardOverviewProps> = ({
  onNavigateTab,
  onOpenEnrollModal,
  onOpenImportModal,
  onPreviewLiveWebsite,
  readOnly = false,
}) => {
  const { activeSchool, activeSettings } = useAuth();
  const instProfile = resolveInstitutionProfile(activeSchool, activeSettings);
  const { labels: instLabels, isTertiary } = instProfile;
  const [stats, setStats] = useState<SchoolDashboardStats | null>(null);
  const [inquiries, setInquiries] = useState<SchoolAdmissionInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copiedPortalLink, setCopiedPortalLink] = useState(false);
  const [copiedWebsiteLink, setCopiedWebsiteLink] = useState(false);

  const subdomainSlug = (activeSettings?.portal_subdomain || activeSchool?.slug || 'school').toLowerCase();
  const liveWebsiteUrl = `${window.location.origin}/site/${subdomainSlug}`;
  const shareablePortalUrl = activeSchool?.slug
    ? `${window.location.origin}/#portal/${activeSchool.slug}`
    : `${window.location.origin}/#login`;

  const handleCopyPortalLink = async () => {
    const ok = await copyTextToClipboard(shareablePortalUrl);
    if (ok) {
      setCopiedPortalLink(true);
      setTimeout(() => setCopiedPortalLink(false), 2500);
    }
  };

  const handleCopyWebsiteLink = async () => {
    const ok = await copyTextToClipboard(liveWebsiteUrl);
    if (ok) {
      setCopiedWebsiteLink(true);
      setTimeout(() => setCopiedWebsiteLink(false), 2500);
    }
  };

  useEffect(() => {
    loadDashboardStats();
  }, [activeSchool?.id, readOnly]);

  const loadDashboardStats = async () => {
    setLoading(true);
    try {
      const [statsRes, inqRes] = await Promise.all([
        api.getSchoolStats(),
        !readOnly ? api.getAdmissionInquiries().catch(() => ({ inquiries: [] })) : Promise.resolve({ inquiries: [] }),
      ]);
      setStats(statsRes.stats);
      setInquiries(inqRes.inquiries || []);
    } catch (err) {
      console.error('Failed to load school statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExportError(null);
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
      setExportError(err?.message || 'Failed to export CSV');
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

        {/* Classes / Levels */}
        <div
          onClick={() => (!readOnly ? onNavigateTab('classes') : undefined)}
          className={`bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm transition group ${
            !readOnly ? 'hover:border-emerald-300 hover:shadow-md cursor-pointer' : ''
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {instLabels.classPlural}
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center group-hover:scale-110 transition">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight tabular-nums">
            {loading ? '...' : stats?.totalClasses ?? 0}
          </p>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {isTertiary ? 'Levels & Departments' : 'Levels & Streams'}
          </p>
        </div>

        {/* Staff / Faculty Members */}
        <div
          onClick={() => (!readOnly ? onNavigateTab('staff') : undefined)}
          className={`bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm transition group ${
            !readOnly ? 'hover:border-emerald-300 hover:shadow-md cursor-pointer' : ''
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {isTertiary ? 'Faculty & Staff' : 'School Staff'}
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center group-hover:scale-110 transition">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight tabular-nums">
            {loading ? '...' : stats?.totalStaff ?? 0}
          </p>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {instLabels.staffPlural} &amp; Admin
          </p>
        </div>

        {/* Parents / Sponsors */}
        <div
          onClick={() => onNavigateTab('parents')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:border-emerald-300 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {instLabels.parent}s
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center group-hover:scale-110 transition">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight tabular-nums">
            {loading ? '...' : stats?.totalParents ?? 0}
          </p>
          <p className="text-[11px] text-slate-500 font-medium mt-1">Verified Contacts</p>
        </div>

        {/* Active Session & Term / Semester */}
        <div
          onClick={() => (!readOnly ? onNavigateTab('sessions') : undefined)}
          className={`bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm transition col-span-2 lg:col-span-1 group ${
            !readOnly ? 'hover:border-emerald-300 hover:shadow-md cursor-pointer' : ''
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Current Session</span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center group-hover:scale-110 transition">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <p className="text-lg sm:text-xl font-black text-slate-900 tracking-tight truncate">
            {loading ? '...' : stats?.currentAcademicSession ?? activeSettings?.current_academic_session ?? '2025/2026'}
          </p>
          <p className="text-[11px] text-teal-700 font-bold mt-1 truncate">
            {stats?.currentTerm ?? activeSettings?.current_term ?? instProfile.cycleLabels[0]} (Active)
          </p>
        </div>
      </div>

      {/* Shareable Live School Website & Portal Links */}
      {!readOnly && activeSchool && (
        <div className="bg-slate-900 text-white rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border border-slate-800 shadow-sm">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <h3 className="text-sm font-bold text-white">Live Shareable School Website &amp; Portal</h3>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl">
              Share this live link on WhatsApp, flyers, or social media. Visitors see your school&apos;s website, CBT exam hall, news, gallery, and admissions form alongside <strong>Staff, Parent &amp; Student</strong> portals.
            </p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5 pt-0.5 text-[11px] font-mono">
              <span className="text-emerald-300 break-all select-all">
                Website Link: {liveWebsiteUrl}
              </span>
              <span className="text-slate-300 break-all select-all">
                Portal Link: {shareablePortalUrl}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyWebsiteLink}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              {copiedWebsiteLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedWebsiteLink ? 'Website Link Copied' : 'Copy Website Link'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (onPreviewLiveWebsite) {
                  onPreviewLiveWebsite(subdomainSlug);
                } else {
                  window.location.href = `/site/${subdomainSlug}`;
                }
              }}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              <ExternalLink className="w-4 h-4 text-emerald-400" />
              <span>Open Live Site</span>
            </button>
            <button
              type="button"
              onClick={handleCopyPortalLink}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              {copiedPortalLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copiedPortalLink ? 'Portal Copied' : 'Copy Portal Link'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('website')}
              className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-900 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap"
            >
              Manage School Website
            </button>
          </div>
        </div>
      )}

      {exportError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{exportError}</span>
          </span>
          <button type="button" onClick={() => setExportError(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!readOnly && inquiries.length > 0 && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600 shrink-0" />
              <h3 className="text-sm font-bold text-slate-900">
                Prospective Student Admissions Notices ({inquiries.length})
              </h3>
              <span className="text-[11px] font-bold text-blue-700 tabular-nums">
                {inquiries.filter((i) => i.status === 'NEW').length} new
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigateTab('website')}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
              >
                Open Website Inbox
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('announcements')}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold cursor-pointer"
              >
                View School Notices
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {inquiries.slice(0, 3).map((inq) => (
              <div key={inq.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-slate-900 truncate">{inq.student_name}</p>
                  <span className="text-[11px] font-bold text-blue-700 shrink-0">{inq.status}</span>
                </div>
                <p className="text-[11px] text-slate-600 truncate">
                  {inq.target_class || 'General Admissions'} · Parent: {inq.parent_name}
                </p>
                <p className="text-[11px] font-mono text-slate-500">{inq.parent_phone}</p>
              </div>
            ))}
          </div>
        </div>
      )}

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
            {!readOnly && (
              <>
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
              </>
            )}

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

            {!readOnly && (
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
            )}

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

            {!readOnly && (
              <button
                onClick={() => onNavigateTab('cbt')}
                className="w-full py-2.5 px-4 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer border border-emerald-200"
              >
                <span className="flex items-center gap-2">
                  <MonitorCheck className="w-4 h-4 text-emerald-700" />
                  <span>CBT Examination Centre</span>
                </span>
                <ArrowUpRight className="w-4 h-4 text-emerald-600" />
              </button>
            )}

            {!readOnly && (
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
            )}
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
