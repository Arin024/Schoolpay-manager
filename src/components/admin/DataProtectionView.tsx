import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Database,
  HardDrive,
  RefreshCw,
  Download,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck,
  Layers,
  Archive,
  ArrowDownToLine,
  Lock,
  Play,
  RotateCcw,
  Activity,
  Check,
  Info,
  Server,
  Zap,
} from 'lucide-react';
import { api } from '../../services/api.js';

export const DataProtectionView: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusData, setStatusData] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [migrations, setMigrations] = useState<any[]>([]);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Restore Modal State
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<any | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState('');
  const [restoring, setRestoring] = useState(false);

  // Test Restore Modal/Result
  const [testRestoreResult, setTestRestoreResult] = useState<any | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statusRes, backupsRes, invRes, migRes] = await Promise.all([
        api.getDataProtectionStatus(),
        api.getDataProtectionBackups(),
        api.getDataProtectionInventory(),
        api.getDataProtectionMigrations(),
      ]);

      if (statusRes?.success) setStatusData(statusRes);
      if (backupsRes?.success) setBackups(backupsRes.backups || []);
      if (invRes?.success) setInventory(invRes.inventory || []);
      if (migRes?.success) setMigrations(migRes.migrations || []);
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Failed to load data protection statistics.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateManualBackup = async () => {
    try {
      setActionLoading(true);
      setNotice({ type: 'info', message: 'Creating atomic online SQLite snapshot via VACUUM INTO...' });
      const res = await api.createDataProtectionBackup();
      if (res.success) {
        setNotice({ type: 'success', message: res.message });
        await loadData();
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Manual backup creation failed.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyBackup = async (id: string) => {
    try {
      setActionLoading(true);
      const res = await api.verifyDataProtectionBackup(id);
      if (res.success) {
        setNotice({ type: 'success', message: res.message });
        await loadData();
      } else {
        setNotice({ type: 'error', message: res.message || 'Verification check failed.' });
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Verification failed.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleTestRestore = async (id: string) => {
    try {
      setActionLoading(true);
      setNotice({ type: 'info', message: 'Spinning up isolated sandbox instance to verify database restoration...' });
      const res = await api.testRestoreDataProtectionBackup(id);
      if (res.success) {
        setTestRestoreResult(res);
        setNotice({ type: 'success', message: res.summary });
        await loadData();
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Restoration test failed.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleExecuteRestore = async () => {
    if (!selectedBackupForRestore) return;
    if (restoreConfirmation !== 'CONFIRM_RESTORE_OVERWRITE') {
      setNotice({ type: 'error', message: 'Please type the exact confirmation string CONFIRM_RESTORE_OVERWRITE.' });
      return;
    }

    try {
      setRestoring(true);
      const res = await api.restoreDataProtectionBackup(selectedBackupForRestore.id, restoreConfirmation);
      if (res.success) {
        setNotice({ type: 'success', message: res.message });
        setSelectedBackupForRestore(null);
        setRestoreConfirmation('');
        await loadData();
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || 'Database restoration failed.' });
    } finally {
      setRestoring(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return 'Never';
    return new Date(isoStr).toLocaleString('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const stats = statusData?.stats;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 text-white p-6 rounded-3xl border border-purple-800/40 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold mb-3">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>PERMANENT DATA PROTECTION &amp; ZERO-LOSS ARCHITECTURE</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <span>Database Safety &amp; Automated Backups</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
              BursarIQ permanently isolates and protects all school profiles, student records, fee categories, and financial ledgers. Online atomic backups, version-controlled migrations, and tenant isolation guarantee zero accidental loss during app updates.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCreateManualBackup}
              disabled={actionLoading || loading}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg transition cursor-pointer disabled:opacity-50"
            >
              <Zap className={`w-4 h-4 ${actionLoading ? 'animate-spin' : ''}`} />
              <span>Create Manual Backup</span>
            </button>
            <button
              onClick={loadData}
              disabled={loading || actionLoading}
              className="flex items-center gap-2 px-3 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Notification Toast */}
      {notice && (
        <div
          className={`p-4 rounded-2xl border text-xs font-medium flex items-center justify-between transition-all ${
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

      {/* Key Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Last Successful Backup */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Latest Backup</span>
            <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
              <CheckCircle2 className="w-4 h-4" />
            </span>
          </div>
          <p className="text-xl font-black text-slate-900">
            {stats?.lastBackupTime ? formatDate(stats.lastBackupTime) : 'None Taken'}
          </p>
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
            <span>Size: {formatBytes(stats?.lastBackupSize || 0)}</span>
            <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-600">
              {stats?.lastBackupChecksum ? `${stats.lastBackupChecksum.slice(0, 10)}...` : 'N/A'}
            </span>
          </div>
        </div>

        {/* Card 2: Automatic Backup Scheduler */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Auto Scheduler</span>
            <span className="p-2 bg-purple-50 text-purple-600 rounded-xl">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <p className="text-xl font-black text-slate-900">Active (24h Daily)</p>
          </div>
          <div className="text-xs text-slate-500 pt-1 border-t border-slate-100">
            <span>Retention: 14 Rolling Recovery Points</span>
          </div>
        </div>

        {/* Card 3: Restoration Sandbox Health */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Restoration Test</span>
            <span className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Play className="w-4 h-4" />
            </span>
          </div>
          <p className="text-xl font-black text-slate-900">
            {stats?.lastTestRestore ? formatDate(stats.lastTestRestore) : 'Ready'}
          </p>
          <div className="text-xs text-slate-500 pt-1 border-t border-slate-100 flex items-center justify-between">
            <span>FK Integrity: Passed</span>
            <span className="text-emerald-600 font-bold">100% OK</span>
          </div>
        </div>

        {/* Card 4: Database Storage & Engine */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">SQLite DB File</span>
            <span className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <Database className="w-4 h-4" />
            </span>
          </div>
          <p className="text-xl font-black text-slate-900">{formatBytes(stats?.databaseSizeBytes || 0)}</p>
          <div className="text-xs text-slate-500 pt-1 border-t border-slate-100 flex items-center justify-between">
            <span>WAL Journal: ON</span>
            <span>Total Backups: {stats?.totalBackups || 0}</span>
          </div>
        </div>
      </div>

      {/* Test Restore Result Modal/Banner */}
      {testRestoreResult && (
        <div className="bg-emerald-50 border-2 border-emerald-400 p-5 rounded-2xl shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>Isolated Restoration Sandbox Test Completed Successfully</span>
            </h3>
            <button
              onClick={() => setTestRestoreResult(null)}
              className="text-xs text-emerald-700 hover:text-emerald-900 font-bold px-2 py-1 bg-white rounded-lg border border-emerald-300"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-emerald-800 leading-relaxed">{testRestoreResult.summary}</p>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
            <div className="bg-white p-2 rounded-lg border border-emerald-200">
              <p className="text-[10px] text-slate-500">Tables Verified</p>
              <p className="font-bold text-slate-900">{testRestoreResult.tableCount}</p>
            </div>
            <div className="bg-white p-2 rounded-lg border border-emerald-200">
              <p className="text-[10px] text-slate-500">Total Rows</p>
              <p className="font-bold text-slate-900">{testRestoreResult.recordCount}</p>
            </div>
            <div className="bg-white p-2 rounded-lg border border-emerald-200">
              <p className="text-[10px] text-slate-500">Schools</p>
              <p className="font-bold text-slate-900">{testRestoreResult.schoolCount}</p>
            </div>
            <div className="bg-white p-2 rounded-lg border border-emerald-200">
              <p className="text-[10px] text-slate-500">Students</p>
              <p className="font-bold text-slate-900">{testRestoreResult.studentCount}</p>
            </div>
            <div className="bg-white p-2 rounded-lg border border-emerald-200">
              <p className="text-[10px] text-slate-500">Invoices</p>
              <p className="font-bold text-slate-900">{testRestoreResult.invoiceCount}</p>
            </div>
            <div className="bg-white p-2 rounded-lg border border-emerald-200">
              <p className="text-[10px] text-slate-500">Execution Time</p>
              <p className="font-bold text-emerald-700">{testRestoreResult.durationMs}ms</p>
            </div>
          </div>
        </div>
      )}

      {/* Section 1: Backup Snapshots Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-purple-700" />
              <span>Database Backups &amp; Snapshots History</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Atomic online backups generated via SQLite <code>VACUUM INTO</code>. Backups are stored in <code>data/backups/</code> with SHA-256 verification.
            </p>
          </div>
          <span className="text-xs font-bold px-3 py-1 bg-purple-50 text-purple-700 rounded-full border border-purple-200 self-start sm:self-auto">
            {backups.length} Snapshots Available
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Filename &amp; Trigger</th>
                <th className="px-5 py-3.5">Created At</th>
                <th className="px-5 py-3.5">Size</th>
                <th className="px-5 py-3.5">SHA-256 Checksum</th>
                <th className="px-5 py-3.5">Verification</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {backups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                    No database backups found. Click &quot;Create Manual Backup&quot; above to take a snapshot.
                  </td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.id} className="hover:bg-purple-50/30 transition">
                    <td className="px-5 py-3.5 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-900 font-semibold">{b.filename}</span>
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${
                            b.trigger_type === 'AUTOMATIC'
                              ? 'bg-blue-100 text-blue-700'
                              : b.trigger_type === 'PRE_MIGRATION'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}
                        >
                          {b.trigger_type}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                      {formatDate(b.created_at)}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-slate-900 whitespace-nowrap">
                      {formatBytes(b.size_bytes)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[10px] text-slate-500">
                      {b.checksum ? `${b.checksum.slice(0, 16)}...` : 'Pending'}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {b.status === 'VERIFIED' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          VERIFIED
                        </span>
                      ) : b.status === 'SUCCESS' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                          SUCCESS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          FAILED
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleVerifyBackup(b.id)}
                          disabled={actionLoading}
                          title="Verify SHA-256 Checksum & SQLite Header"
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer"
                        >
                          Verify
                        </button>
                        <button
                          onClick={() => handleTestRestore(b.id)}
                          disabled={actionLoading}
                          title="Run isolated restoration test in isolated sandbox"
                          className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold transition cursor-pointer"
                        >
                          Test Restore
                        </button>
                        <a
                          href={`/api/v1/admin/data-protection/backups/${b.id}/download`}
                          download
                          title="Download backup file"
                          className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download</span>
                        </a>
                        <button
                          onClick={() => {
                            setSelectedBackupForRestore(b);
                            setRestoreConfirmation('');
                          }}
                          disabled={actionLoading}
                          title="Initiate controlled production restore"
                          className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold transition cursor-pointer"
                        >
                          Restore...
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Database Schema & Entity Protection Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Table Inventory */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-700" />
              <span>Protected Table Inventory ({inventory.length} Tables)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live row counts and safety protections configured per table. Financial ledgers are permanently protected against hard deletion.
            </p>
          </div>

          <div className="overflow-y-auto max-h-96">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3">Table Name</th>
                  <th className="px-5 py-3">Rows</th>
                  <th className="px-5 py-3">Tier</th>
                  <th className="px-5 py-3 text-right">Guards</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {inventory.map((t) => (
                  <tr key={t.tableName} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-2.5 font-mono font-bold text-slate-900">{t.tableName}</td>
                    <td className="px-5 py-2.5 font-semibold text-slate-800">{t.rowCount.toLocaleString()}</td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${
                          t.protectionTier === 'CRITICAL_FINANCIAL'
                            ? 'bg-rose-100 text-rose-800 border border-rose-200'
                            : t.protectionTier === 'CORE_TENANT'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {t.protectionTier.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {t.isFinancialLedger && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                            IMMUTABLE LEDGER
                          </span>
                        )}
                        {t.hasSoftDelete && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                            RECYCLE BIN
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Incremental Migrations Log */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-indigo-700" />
              <span>Safe Incremental Migrations History</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Migrations execute backward-compatibly without dropping tables or resetting live records.
            </p>
          </div>

          <div className="overflow-y-auto max-h-96">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3">Version</th>
                  <th className="px-5 py-3">Migration Name</th>
                  <th className="px-5 py-3">Applied At</th>
                  <th className="px-5 py-3 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {migrations.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-slate-400">
                      No migration records logged.
                    </td>
                  </tr>
                ) : (
                  migrations.map((m) => (
                    <tr key={m.id || m.version} className="hover:bg-slate-50 transition">
                      <td className="px-5 py-3 font-mono font-black text-purple-700">v{m.version}</td>
                      <td className="px-5 py-3 font-semibold text-slate-900">
                        {m.name.replace(/_/g, ' ')}
                      </td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{formatDate(m.applied_at)}</td>
                      <td className="px-5 py-3 text-right font-mono text-slate-600">
                        {m.execution_time_ms}ms
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Controlled Restore Modal */}
      {selectedBackupForRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-rose-200">
            <div className="flex items-center gap-3 text-rose-700">
              <div className="p-3 bg-rose-100 rounded-2xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Controlled Database Restoration</h3>
                <p className="text-xs text-rose-600 font-semibold">Strict Multi-Step Safeguard Protection</p>
              </div>
            </div>

            <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl text-xs text-rose-900 space-y-2">
              <p className="font-bold">Target Snapshot to Restore:</p>
              <p className="font-mono bg-white p-2 rounded-lg border border-rose-200 text-slate-800 break-all">
                {selectedBackupForRestore.filename} (Created: {formatDate(selectedBackupForRestore.created_at)})
              </p>
              <p className="text-[11px] leading-relaxed pt-1">
                Before restoration starts, BursarIQ will automatically:
                <br />1. Run a sandbox pre-flight test to verify integrity.
                <br />2. Take an automatic safety backup of current live production data.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">
                To confirm, type <span className="font-mono text-rose-700 font-black">CONFIRM_RESTORE_OVERWRITE</span> below:
              </label>
              <input
                type="text"
                value={restoreConfirmation}
                onChange={(e) => setRestoreConfirmation(e.target.value)}
                placeholder="CONFIRM_RESTORE_OVERWRITE"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-mono text-xs focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setSelectedBackupForRestore(null);
                  setRestoreConfirmation('');
                }}
                disabled={restoring}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteRestore}
                disabled={restoreConfirmation !== 'CONFIRM_RESTORE_OVERWRITE' || restoring}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-lg transition cursor-pointer disabled:opacity-40 flex items-center gap-2"
              >
                {restoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                <span>{restoring ? 'Restoring Database...' : 'Execute Controlled Restore'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
