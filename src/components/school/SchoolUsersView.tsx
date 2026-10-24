import React, { useEffect, useState } from 'react';
import { Users, Shield, UserPlus, Mail, Phone, Calendar, KeyRound, Copy, Check, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { RoleBadge } from '../common/StatusBadge.js';

export const SchoolUsersView: React.FC = () => {
  const { activeSchoolId, activeSchool, activeRole } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Admin Assisted Recovery State
  const [ticketModalUser, setTicketModalUser] = useState<any | null>(null);
  const [generatedTicket, setGeneratedTicket] = useState<any | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [copiedTicket, setCopiedTicket] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const canManageRecovery = ['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(activeRole?.role_name || '');

  useEffect(() => {
    if (!activeSchoolId) return;
    setLoading(true);
    api.getSchoolUsers(activeSchoolId)
      .then((res) => setUsers(res.users || []))
      .catch((err) => console.error('Failed to load users:', err))
      .finally(() => setLoading(false));
  }, [activeSchoolId]);

  const handleGenerateTicket = async (targetUser: any) => {
    if (!activeSchoolId) return;
    setTicketModalUser(targetUser);
    setGeneratedTicket(null);
    setTicketError(null);
    setTicketLoading(true);

    try {
      const res = await api.generateStaffRecoveryTicket(activeSchoolId, targetUser.id);
      setGeneratedTicket(res);
    } catch (err: any) {
      setTicketError(err?.message || 'Failed to issue administrator recovery ticket.');
    } finally {
      setTicketLoading(false);
    }
  };

  const copyTicketToClipboard = () => {
    if (!generatedTicket) return;
    navigator.clipboard.writeText(generatedTicket.recoveryTicket);
    setCopiedTicket(true);
    setTimeout(() => setCopiedTicket(false), 2500);
  };

  const copyLinkToClipboard = () => {
    if (!generatedTicket) return;
    const recoveryUrl = `${window.location.origin}/?recovery_ticket=${encodeURIComponent(generatedTicket.recoveryTicket)}`;
    navigator.clipboard.writeText(recoveryUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            <span>Staff &amp; Role Authorization</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Users authorized to access <strong className="text-slate-800">{activeSchool?.name}</strong>. Strict tenant binding prevents cross-school data leaks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-slate-100 text-slate-700 font-semibold text-xs rounded-lg">
            {users.length} Authorized User{users.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading authorized users...</div>
      ) : users.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">No users found for this tenant.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px] bg-slate-50/60">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Assigned Role</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4">Joined Date</th>
                {canManageRecovery && <th className="py-3 px-4 text-right">Account Recovery</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition">
                  <td className="py-3.5 px-4 font-semibold text-slate-900">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs">
                        {u.full_name?.charAt(0) || 'U'}
                      </div>
                      <div>
                        <p className="text-slate-900 font-bold">{u.full_name}</p>
                        <p className="text-[11px] text-slate-400 font-mono">ID: {u.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-600">
                    <div className="flex items-center gap-1.5 text-slate-700">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span>{u.email}</span>
                    </div>
                    {u.phone && (
                      <div className="flex items-center gap-1.5 text-slate-500 mt-0.5">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{u.phone}</span>
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <RoleBadge role={u.role_name} />
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px]">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  {canManageRecovery && (
                    <td className="py-3.5 px-4 text-right">
                      {u.is_platform_admin === 1 ? (
                        <span className="text-[10px] text-slate-400 italic">Super Admin Protected</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleGenerateTicket(u)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold text-[11px] inline-flex items-center gap-1 transition"
                          title="Generate a temporary 1-hour recovery ticket for this staff member"
                        >
                          <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Issue Ticket</span>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Admin-Assisted Recovery Ticket Modal */}
      {ticketModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">Administrator-Assisted Recovery</h3>
              </div>
              <button
                onClick={() => setTicketModalUser(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-xs text-slate-600">
                <p>
                  Target Staff Member: <strong className="text-slate-900">{ticketModalUser.full_name}</strong>
                </p>
                <p className="text-slate-500 text-[11px] font-mono">{ticketModalUser.email}</p>
              </div>

              {ticketError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
                  <span>{ticketError}</span>
                </div>
              )}

              {ticketLoading && (
                <div className="py-6 text-center text-xs text-slate-500">
                  Generating cryptographically signed 1-hour recovery ticket...
                </div>
              )}

              {generatedTicket && (
                <div className="space-y-3">
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
                    <p className="font-bold flex items-center gap-1.5 mb-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Recovery Ticket Issued!</span>
                    </p>
                    <p className="text-[11px] text-emerald-700">
                      Provide this single-use 1-hour ticket to <strong>{ticketModalUser.full_name}</strong>. They will use it to securely set their own password without you needing to know it.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 text-white rounded-xl space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">
                        Single-Use Ticket Token &amp; Link
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={copyLinkToClipboard}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-semibold flex items-center gap-1 transition"
                        >
                          {copiedLink ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedLink ? 'Link Copied!' : 'Copy 1-Click Link'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={copyTicketToClipboard}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold flex items-center gap-1 border border-slate-700 transition"
                        >
                          {copiedTicket ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedTicket ? 'Token Copied!' : 'Copy Token'}</span>
                        </button>
                      </div>
                    </div>
                    <p className="font-mono text-xs text-emerald-300 break-all select-all p-2 bg-slate-950/70 rounded border border-slate-800">
                      {generatedTicket.recoveryTicket}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Expires in: 1 hour ({new Date(generatedTicket.expiresAt).toLocaleTimeString()}). User can click the link to reset their password directly without entering tokens.
                    </p>
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setTicketModalUser(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Role Foundation Notice */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
        <p className="font-semibold text-slate-800 mb-1">Step 1 Role Foundation Note:</p>
        <p>
          The schema incorporates role abstractions for <strong>SUPER_ADMIN</strong>, <strong>SCHOOL_OWNER</strong>, <strong>SCHOOL_ADMIN</strong>, <strong>BURSAR</strong>, <strong>TEACHER</strong>, <strong>STAFF</strong>, <strong>PARENT</strong>, and <strong>PARTNER</strong>. Additional staff recruitment and invite workflows will seamlessly layer on top in subsequent steps without breaking tenant constraints.
        </p>
      </div>
    </div>
  );
};
