import React, { useEffect, useState } from 'react';
import { Users, Shield, UserPlus, Mail, Phone, Calendar } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { RoleBadge } from '../common/StatusBadge.js';

export const SchoolUsersView: React.FC = () => {
  const { activeSchoolId, activeSchool } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeSchoolId) return;
    setLoading(true);
    api.getSchoolUsers(activeSchoolId)
      .then((res) => setUsers(res.users || []))
      .catch((err) => console.error('Failed to load users:', err))
      .finally(() => setLoading(false));
  }, [activeSchoolId]);

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
                </tr>
              ))}
            </tbody>
          </table>
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
