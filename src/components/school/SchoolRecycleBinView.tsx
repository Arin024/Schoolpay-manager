import React, { useState, useEffect } from 'react';
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Search,
  Filter,
  Users,
  GraduationCap,
  Briefcase,
  BookOpen,
  ShieldAlert,
  Info,
  Clock,
  UserCheck,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { api } from '../../services/api.js';

export const SchoolRecycleBinView: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [recycleData, setRecycleData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'students' | 'staff' | 'classes' | 'parents'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Purge Modal State
  const [selectedItemForPurge, setSelectedItemForPurge] = useState<{ type: string; item: any } | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const [purging, setPurging] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await api.getSchoolRecycleBin();
      if (res.success) {
        setRecycleData(res);
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Failed to load Recycle Bin records.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRestore = async (entityType: string, entityId: string) => {
    try {
      setActionLoading(true);
      const res = await api.restoreSchoolRecycleBinRecord(entityType, entityId);
      if (res.success) {
        setNotice({ type: 'success', message: res.message });
        await loadData();
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Failed to restore record.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePurge = async () => {
    if (!selectedItemForPurge) return;
    if (purgeConfirmation !== 'CONFIRM_PERMANENT_PURGE') {
      setNotice({ type: 'error', message: 'Please type the exact confirmation string CONFIRM_PERMANENT_PURGE.' });
      return;
    }

    try {
      setPurging(true);
      const res = await api.purgeSchoolRecycleBinRecord(
        selectedItemForPurge.type,
        selectedItemForPurge.item.id,
        purgeConfirmation
      );
      if (res.success) {
        setNotice({ type: 'success', message: res.message });
        setSelectedItemForPurge(null);
        setPurgeConfirmation('');
        await loadData();
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Permanent purge failed.' });
    } finally {
      setPurging(false);
    }
  };

  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return 'N/A';
    return new Date(isoStr).toLocaleString('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const rawRecycle = recycleData?.recycleBin || {
    students: [],
    staff: [],
    classes: [],
    parents: [],
  };

  const allItems = [
    ...rawRecycle.students.map((s: any) => ({ ...s, type: 'student', typeLabel: 'Student', icon: GraduationCap })),
    ...rawRecycle.staff.map((st: any) => ({ ...st, type: 'staff', typeLabel: 'Staff', icon: Briefcase })),
    ...rawRecycle.classes.map((c: any) => ({ ...c, type: 'class', typeLabel: 'Class', icon: BookOpen })),
    ...rawRecycle.parents.map((p: any) => ({ ...p, type: 'parent', typeLabel: 'Parent', icon: Users })),
  ];

  const filteredItems = allItems.filter((item) => {
    if (activeTab !== 'all' && item.type !== activeTab) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.displayName && item.displayName.toLowerCase().includes(q)) ||
      (item.deleted_by && item.deleted_by.toLowerCase().includes(q)) ||
      (item.deletion_reason && item.deletion_reason.toLowerCase().includes(q))
    );
  });

  const counts = recycleData?.counts || { students: 0, staff: 0, classes: 0, parents: 0, total: 0 };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-6 rounded-3xl border border-slate-700 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold mb-3">
              <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
              <span>CONTROLLED RECORD RECOVERY &amp; RECYCLE BIN</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <span>Recycle Bin &amp; Soft-Deleted Records</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Records archived or removed by school administrators are safely held here instead of being permanently erased. You can inspect who deleted each record, view the reason, and restore it with relationships fully preserved.
            </p>
          </div>

          <button
            onClick={loadData}
            disabled={loading || actionLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition cursor-pointer self-start md:self-auto"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Bin</span>
          </button>
        </div>
      </div>

      {/* Notice Alert */}
      {notice && (
        <div
          className={`p-4 rounded-2xl border text-xs font-medium flex items-center justify-between ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : notice.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : notice.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            ) : (
              <Info className="w-4 h-4 text-blue-600" />
            )}
            <span>{notice.message}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-slate-400 hover:text-slate-600 font-bold ml-4">
            ×
          </button>
        </div>
      )}

      {/* Filter Tabs and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {[
            { id: 'all', label: `All Records (${counts.total})` },
            { id: 'students', label: `Students (${counts.students})` },
            { id: 'staff', label: `Staff (${counts.staff})` },
            { id: 'classes', label: `Classes (${counts.classes})` },
            { id: 'parents', label: `Parents (${counts.parents})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white shadow'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search deleted records..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Records Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Record Identifier</th>
                <th className="px-5 py-3.5">Type</th>
                <th className="px-5 py-3.5">Deleted Date</th>
                <th className="px-5 py-3.5">Deleted By</th>
                <th className="px-5 py-3.5">Reason</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                    <Trash2 className="w-8 h-8 text-slate-300 mx-auto mb-2 opacity-60" />
                    <p className="font-semibold text-slate-600">Recycle Bin is Empty</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      No soft-deleted records match the active criteria. All school records are safely active.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const Icon = item.icon || GraduationCap;
                  return (
                    <tr key={`${item.type}-${item.id}`} className="hover:bg-slate-50 transition">
                      <td className="px-5 py-3.5 font-medium">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{item.displayName}</p>
                            <p className="text-[10px] text-slate-400 font-mono">ID: {item.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 uppercase">
                          {item.typeLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                        {formatDate(item.deleted_at)}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 whitespace-nowrap font-medium">
                        {item.deleted_by || 'School Administrator'}
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 max-w-xs truncate">
                        {item.deletion_reason || 'Archived'}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleRestore(item.type, item.id)}
                            disabled={actionLoading}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Restore</span>
                          </button>
                          <button
                            onClick={() => {
                              setSelectedItemForPurge({ type: item.type, item });
                              setPurgeConfirmation('');
                            }}
                            disabled={actionLoading}
                            title="School Owner Permanent Purge"
                            className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition cursor-pointer"
                          >
                            Purge...
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permanent Purge Confirmation Modal */}
      {selectedItemForPurge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-rose-200">
            <div className="flex items-center gap-3 text-rose-700">
              <div className="p-3 bg-rose-100 rounded-2xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Irreversible Permanent Purge</h3>
                <p className="text-xs text-rose-600 font-semibold">Financial &amp; Legal Guard Protection</p>
              </div>
            </div>

            <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl text-xs text-rose-900 space-y-2">
              <p className="font-bold">Record to be purged:</p>
              <p className="font-mono bg-white p-2 rounded-lg border border-rose-200 text-slate-800 break-all">
                {selectedItemForPurge.item.displayName}
              </p>
              <p className="text-[11px] leading-relaxed">
                <strong>FINANCIAL SAFEGUARD:</strong> If this record has ANY recorded payments or active invoices, BursarIQ will strictly block permanent deletion to preserve the school accounting ledger.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">
                To confirm permanent purge, type <span className="font-mono text-rose-700 font-black">CONFIRM_PERMANENT_PURGE</span>:
              </label>
              <input
                type="text"
                value={purgeConfirmation}
                onChange={(e) => setPurgeConfirmation(e.target.value)}
                placeholder="CONFIRM_PERMANENT_PURGE"
                className="w-full px-4 py-2 rounded-xl border border-slate-300 font-mono text-xs focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setSelectedItemForPurge(null);
                  setPurgeConfirmation('');
                }}
                disabled={purging}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handlePurge}
                disabled={purgeConfirmation !== 'CONFIRM_PERMANENT_PURGE' || purging}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-lg transition cursor-pointer disabled:opacity-40"
              >
                {purging ? 'Purging...' : 'Permanently Purge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
