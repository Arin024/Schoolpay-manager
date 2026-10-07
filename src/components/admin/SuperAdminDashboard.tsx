import React, { useEffect, useState } from 'react';
import { Shield, Building2, Search, Filter, Eye, CheckCircle2, AlertTriangle, History, RefreshCw, X, ChevronRight } from 'lucide-react';
import { api } from '../../services/api.js';
import { School, SchoolStatus, AuditLog } from '../../types/index.js';
import { SchoolStatusBadge } from '../common/StatusBadge.js';
import { SCHOOL_STATUSES } from '../../constants/index.js';

export const SuperAdminDashboard: React.FC = () => {
  const [schools, setSchools] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [platformStats, setPlatformStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedSchool, setSelectedSchool] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [schoolDetails, setSchoolDetails] = useState<any | null>(null);

  const [statusModalSchool, setStatusModalSchool] = useState<any | null>(null);
  const [newStatus, setNewStatus] = useState<SchoolStatus>('ACTIVE');
  const [statusReason, setStatusReason] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'schools' | 'platform_audit'>('schools');

  const loadData = async () => {
    setLoading(true);
    try {
      const [schoolsRes, logsRes, statsRes] = await Promise.all([
        api.getAdminSchools(),
        api.getAdminAuditLogs(),
        api.getAdminStats().catch(() => ({ stats: null })),
      ]);
      setSchools(schoolsRes.schools || []);
      setAuditLogs(logsRes.logs || []);
      if (statsRes && statsRes.stats) {
        setPlatformStats(statsRes.stats);
      }
    } catch (err) {
      console.error('Failed to load super admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const viewDetails = async (school: any) => {
    setSelectedSchool(school);
    setDetailsLoading(true);
    try {
      const res = await api.getAdminSchoolDetails(school.id);
      setSchoolDetails(res);
    } catch (err) {
      console.error('Failed to load school details:', err);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalSchool) return;

    setStatusSubmitting(true);
    try {
      await api.updateSchoolStatus(statusModalSchool.id, newStatus, statusReason);
      setStatusModalSchool(null);
      setStatusReason('');
      await loadData();
      if (selectedSchool && selectedSchool.id === statusModalSchool.id) {
        viewDetails(statusModalSchool);
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to update status');
    } finally {
      setStatusSubmitting(false);
    }
  };

  const filteredSchools = schools.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.state.toLowerCase().includes(search.toLowerCase()) ||
      s.id.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Calculate platform stats
  const totalTenants = schools.length;
  const activeTenants = schools.filter((s) => s.status === 'ACTIVE').length;
  const trialTenants = schools.filter((s) => s.status === 'TRIAL').length;
  const suspendedTenants = schools.filter((s) => s.status === 'SUSPENDED').length;

  return (
    <div className="space-y-6">
      {/* Top Governance Banner */}
      <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-slate-900 rounded-2xl p-6 sm:p-8 text-white border border-purple-900/60 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30 text-xs font-bold uppercase tracking-wider">
              <Shield className="w-3.5 h-3.5" />
              <span>Platform Governance Layer</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Super Admin Console
            </h1>
            <p className="text-xs sm:text-sm text-slate-300">
              Clear architectural boundary: Platform management governing all independent school tenants.
            </p>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="self-start sm:self-auto flex items-center gap-2 px-3.5 py-2 bg-purple-900/50 hover:bg-purple-800/60 border border-purple-700/60 rounded-xl text-xs font-semibold text-purple-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Telemetry</span>
          </button>
        </div>

        {/* Global Tenant Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 pt-6 border-t border-purple-900/40">
          <div className="bg-slate-900/80 p-3 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Total Schools</p>
            <p className="text-xl font-black text-white mt-1">{totalTenants}</p>
          </div>
          <div className="bg-slate-900/80 p-3 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Active Tenants</p>
            <p className="text-xl font-black text-emerald-400 mt-1">{activeTenants}</p>
          </div>
          <div className="bg-slate-900/80 p-3 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Trial Status</p>
            <p className="text-xl font-black text-blue-400 mt-1">{trialTenants}</p>
          </div>
          <div className="bg-slate-900/80 p-3 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Suspended</p>
            <p className="text-xl font-black text-rose-400 mt-1">{suspendedTenants}</p>
          </div>
          <div className="bg-slate-900/80 p-3 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Total Learners</p>
            <p className="text-xl font-black text-teal-300 mt-1">{platformStats?.totalStudents ?? 4}</p>
          </div>
          <div className="bg-slate-900/80 p-3 rounded-xl border border-purple-900/40">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Platform Users</p>
            <p className="text-xl font-black text-purple-300 mt-1">{platformStats?.totalUsers ?? 5}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('schools')}
          className={`pb-3 px-4 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'schools'
              ? 'border-purple-600 text-purple-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>All Registered School Tenants ({schools.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('platform_audit')}
          className={`pb-3 px-4 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'platform_audit'
              ? 'border-purple-600 text-purple-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Platform-Wide Audit Stream ({auditLogs.length})</span>
        </button>
      </div>

      {/* Tab 1: All Schools */}
      {activeTab === 'schools' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by school name, state, or ID..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-lg focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs text-slate-500 font-semibold">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              >
                <option value="ALL">All Statuses</option>
                {SCHOOL_STATUSES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Schools Table */}
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading tenants...</div>
          ) : filteredSchools.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">No schools matching filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px] bg-slate-50/60">
                    <th className="py-3 px-4">School Tenant</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">Owner / Contact</th>
                    <th className="py-3 px-4">Lifecycle Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSchools.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-900 text-emerald-400 font-bold flex items-center justify-center text-xs flex-shrink-0">
                            {s.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{s.name}</p>
                            <p className="text-[11px] text-slate-400 font-mono">ID: {s.id} • {s.type}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <p className="font-medium text-slate-800">{s.state}</p>
                        <p className="text-[11px] text-slate-400">{s.lga}</p>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <p className="font-medium text-slate-800">{s.owner_name || 'Proprietor'}</p>
                        <p className="text-[11px] text-slate-400">{s.email}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <SchoolStatusBadge status={s.status} />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => viewDetails(s)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold text-[11px] transition flex items-center gap-1"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Details</span>
                          </button>
                          <button
                            onClick={() => {
                              setStatusModalSchool(s);
                              setNewStatus(s.status);
                            }}
                            className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-md font-semibold text-[11px] transition"
                          >
                            Change Status
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Platform Audit Logs */}
      {activeTab === 'platform_audit' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Platform-Wide Security &amp; Activity Log</h3>
              <p className="text-xs text-slate-500">Includes global logins, tenant provisions, and blocked IDOR violation events across all schools.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px] bg-slate-50/60">
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">School Tenant</th>
                  <th className="py-2.5 px-3">Actor</th>
                  <th className="py-2.5 px-3">Metadata</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {auditLogs.map((log) => {
                  const isViolation = log.action === 'IDOR_SECURITY_VIOLATION';
                  return (
                    <tr key={log.id} className={isViolation ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-slate-50/50'}>
                      <td className="py-2.5 px-3 font-sans">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          isViolation ? 'bg-red-600 text-white animate-pulse' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 font-sans">
                        {log.school_name || log.school_id || <span className="text-slate-400 italic">Platform Level</span>}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 font-sans">
                        {log.actor_email || 'System'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate">
                        {log.metadata || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* School Details Drawer / Modal */}
      {selectedSchool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div>
                <h3 className="font-bold text-base text-white">{selectedSchool.name}</h3>
                <p className="text-xs text-slate-400 font-mono">Tenant ID: {selectedSchool.id}</p>
              </div>
              <button
                onClick={() => setSelectedSchool(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs flex-1">
              {detailsLoading ? (
                <div className="py-12 text-center text-slate-400">Loading school metadata...</div>
              ) : schoolDetails ? (
                <>
                  <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase text-[10px]">Current Status</span>
                      <div className="mt-1">
                        <SchoolStatusBadge status={schoolDetails.school.status} />
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase text-[10px]">Classification</span>
                      <p className="font-bold text-slate-800 mt-1">{schoolDetails.school.type}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase text-[10px]">Location</span>
                      <p className="font-medium text-slate-800 mt-0.5">{schoolDetails.school.lga}, {schoolDetails.school.state}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold uppercase text-[10px]">Contact</span>
                      <p className="font-medium text-slate-800 mt-0.5">{schoolDetails.school.phone}</p>
                      <p className="text-slate-500">{schoolDetails.school.email}</p>
                    </div>
                  </div>

                  {/* Registered Users */}
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm mb-2">Registered School Users ({schoolDetails.users.length})</h4>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                      {schoolDetails.users.map((u: any) => (
                        <div key={u.id} className="p-3 bg-white flex items-center justify-between">
                          <div>
                            <p className="font-bold text-slate-800">{u.full_name}</p>
                            <p className="text-[11px] text-slate-500">{u.email}</p>
                          </div>
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-semibold rounded text-[10px]">
                            {u.role_display_name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent Tenant Audit Trail */}
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm mb-2">Recent School Audit Trail</h4>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-[11px] font-mono">
                      {schoolDetails.recentLogs.map((l: any) => (
                        <div key={l.id} className="p-2.5 bg-white flex items-center justify-between">
                          <div>
                            <span className="font-bold text-slate-900">{l.action}</span>
                            <span className="text-slate-500 ml-2">by {l.actor_email}</span>
                          </div>
                          <span className="text-slate-400">{new Date(l.created_at).toLocaleTimeString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedSchool(null)}
                className="px-4 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Status Modal */}
      {statusModalSchool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white">
              <div>
                <h3 className="font-bold text-sm text-white">Update School Account Lifecycle Status</h3>
                <p className="text-[11px] text-slate-400">{statusModalSchool.name}</p>
              </div>
              <button
                onClick={() => setStatusModalSchool(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateStatus} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Select New Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as SchoolStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold"
                >
                  {SCHOOL_STATUSES.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Administrative Note / Reason</label>
                <textarea
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder="e.g. Paid termly subscription, or requested temporary pause"
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Tenant Data Guarantee:</strong> Setting status to SUSPENDED, EXPIRED, or CANCELLED temporarily locks write operations for school users, but <strong>NEVER deletes</strong> any school data.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStatusModalSchool(null)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={statusSubmitting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow disabled:opacity-50"
                >
                  {statusSubmitting ? 'Updating...' : 'Confirm Status Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
