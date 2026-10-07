import React, { useEffect, useState } from 'react';
import { History, Shield, Clock, User, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { AuditLog } from '../../types/index.js';

export const SchoolAuditView: React.FC = () => {
  const { activeSchoolId, activeSchool } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeSchoolId) return;
    setLoading(true);
    api.getSchoolAuditLogs(activeSchoolId)
      .then((res) => setLogs(res.logs || []))
      .catch((err) => console.error('Failed to load audit logs:', err))
      .finally(() => setLoading(false));
  }, [activeSchoolId]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-600" />
            <span>Immutable Tenant Audit Trail</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every administrative change, login, and profile modification is timestamped and tamper-resistant.
          </p>
        </div>

        <span className="text-xs px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold self-start sm:self-auto">
          Tenant Scoped: {activeSchool?.id}
        </span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading audit history...</div>
      ) : logs.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">No audit records recorded yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px] bg-slate-50/60">
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Entity</th>
                <th className="py-3 px-4">Metadata</th>
                <th className="py-3 px-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-3 px-4 font-sans font-bold text-slate-900">
                    <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] uppercase font-mono font-bold">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-700 font-sans">
                    <p className="font-semibold text-xs text-slate-900">{log.actor_email || 'System'}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{log.ip_address || '127.0.0.1'}</p>
                  </td>
                  <td className="py-3 px-4 text-slate-600 font-sans">
                    <span className="text-slate-800 font-semibold">{log.entity}</span>
                    {log.entity_id && <span className="text-[10px] text-slate-400 block font-mono">ID: {log.entity_id}</span>}
                  </td>
                  <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                    {log.metadata || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
