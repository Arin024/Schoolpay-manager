import React, { useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  Mail,
  Phone,
  KeyRound,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  X,
  Trash2,
  GraduationCap,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { RoleBadge } from '../common/StatusBadge.js';
import { ParentItem, Student } from '../../types/index.js';

export const SchoolUsersView: React.FC = () => {
  const { activeSchoolId, activeSchool, activeRole, user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [parents, setParents] = useState<ParentItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  // Admin Assisted Recovery State
  const [ticketModalUser, setTicketModalUser] = useState<any | null>(null);
  const [generatedTicket, setGeneratedTicket] = useState<any | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [copiedTicket, setCopiedTicket] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Provision Portal User Modal State
  const [isProvisionOpen, setIsProvisionOpen] = useState(false);
  const [provisionSaving, setProvisionSaving] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionSuccess, setProvisionSuccess] = useState<string | null>(null);
  const [provForm, setProvForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    role_name: 'TEACHER' as 'SCHOOL_ADMIN' | 'BURSAR' | 'TEACHER' | 'PARENT' | 'STUDENT',
    parent_id: '',
    create_parent_profile: false,
    student_ids: [] as string[],
    student_id: '',
  });

  // Revoke Modal State
  const [userToRevoke, setUserToRevoke] = useState<any | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const canManage = ['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(activeRole?.role_name || '');

  const loadData = async () => {
    if (!activeSchoolId) return;
    setLoading(true);
    try {
      const [usersRes, parentsRes, studentsRes] = await Promise.all([
        api.getSchoolUsers(activeSchoolId),
        canManage ? api.getSchoolParents().catch(() => ({ parents: [] })) : Promise.resolve({ parents: [] }),
        canManage ? api.getSchoolStudents({ limit: 300 }).catch(() => ({ students: [] })) : Promise.resolve({ students: [] }),
      ]);
      setUsers(usersRes.users || []);
      setParents(parentsRes.parents || []);
      setStudents(studentsRes.students || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
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

  const toggleChildId = (sid: string) => {
    setProvForm((prev) => ({
      ...prev,
      student_ids: prev.student_ids.includes(sid)
        ? prev.student_ids.filter((id) => id !== sid)
        : [...prev.student_ids, sid],
    }));
  };

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionSaving(true);
    setProvisionError(null);
    try {
      const payload: any = {
        email: provForm.email.trim(),
        full_name: provForm.full_name.trim(),
        phone: provForm.phone.trim() || undefined,
        password: provForm.password,
        role_name: provForm.role_name,
      };
      if (provForm.role_name === 'PARENT') {
        if (provForm.create_parent_profile) {
          payload.create_parent_profile = true;
          payload.student_ids = provForm.student_ids;
        } else if (provForm.parent_id) {
          payload.parent_id = provForm.parent_id;
          if (provForm.student_ids.length > 0) {
            payload.student_ids = provForm.student_ids;
          }
        }
      }
      if (provForm.role_name === 'STUDENT') {
        if (!provForm.student_id) {
          setProvisionError('Select a student record to bind this student portal account.');
          setProvisionSaving(false);
          return;
        }
        payload.student_id = provForm.student_id;
      }

      const res = await api.provisionPortalUser(payload);
      setProvisionSuccess(res.message || 'Portal account provisioned successfully.');
      setIsProvisionOpen(false);
      setProvForm({
        full_name: '',
        email: '',
        phone: '',
        password: '',
        role_name: 'TEACHER',
        parent_id: '',
        create_parent_profile: false,
        student_ids: [],
        student_id: '',
      });
      await loadData();
    } catch (err: any) {
      setProvisionError(err?.message || 'Failed to provision portal user');
    } finally {
      setProvisionSaving(false);
    }
  };

  const handleRevokeConfirm = async () => {
    if (!userToRevoke) return;
    setRevokeLoading(true);
    setRevokeError(null);
    try {
      await api.revokeSchoolUser(userToRevoke.id);
      setUserToRevoke(null);
      await loadData();
    } catch (err: any) {
      setRevokeError(err?.message || 'Failed to revoke access');
    } finally {
      setRevokeLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            <span>Portal Users, Staff &amp; Role Authorization</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Authorized staff, teachers, parents, and students for <strong className="text-slate-800">{activeSchool?.name}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 font-medium tabular-nums">
            {users.length} Authorized User{users.length === 1 ? '' : 's'}
          </span>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setProvisionError(null);
                setProvisionSuccess(null);
                setIsProvisionOpen(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>Provision Portal User</span>
            </button>
          )}
        </div>
      </div>

      {provisionSuccess && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{provisionSuccess}</span>
          </span>
          <button type="button" onClick={() => setProvisionSuccess(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading authorized users...</div>
      ) : users.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">No users found for this tenant.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[11px] bg-slate-50/60">
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Role &amp; Linkage</th>
                <th className="py-3 px-4">Joined</th>
                {canManage && <th className="py-3 px-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isSelf = currentUser?.id === u.id;
                const isProtected = u.is_platform_admin === 1 || u.role_name === 'SCHOOL_OWNER' || isSelf;
                return (
                  <tr key={`${u.id}-${u.role_name}`} className="hover:bg-slate-50/50 transition">
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
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
                    <td className="py-3.5 px-4 space-y-1">
                      <div>
                        <RoleBadge role={u.role_name} />
                      </div>
                      {u.linked_student_name && (
                        <p className="text-[11px] text-slate-600 flex items-center gap-1">
                          <GraduationCap className="w-3 h-3 text-emerald-600" />
                          <span>Student: {u.linked_student_name}</span>
                        </p>
                      )}
                      {u.linked_parent_id && (
                        <p className="text-[11px] text-slate-500 font-mono">
                          Parent Profile: {u.linked_parent_id}
                        </p>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px] tabular-nums">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                    </td>
                    {canManage && (
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {u.is_platform_admin === 1 ? (
                            <span className="text-[10px] text-slate-400 italic">Super Admin Protected</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleGenerateTicket(u)}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold text-[11px] inline-flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                                title="Generate a temporary 1-hour recovery ticket"
                              >
                                <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Issue Ticket</span>
                              </button>
                              {!isProtected && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRevokeError(null);
                                    setUserToRevoke(u);
                                  }}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition cursor-pointer"
                                  title="Revoke school portal access"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* PROVISION PORTAL USER MODAL */}
      {isProvisionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">Provision School Portal Account</h3>
              </div>
              <button type="button" onClick={() => setIsProvisionOpen(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleProvisionSubmit} className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              {provisionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{provisionError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Portal Role *</label>
                  <select
                    value={provForm.role_name}
                    onChange={(e) =>
                      setProvForm({
                        ...provForm,
                        role_name: e.target.value as any,
                        parent_id: '',
                        student_id: '',
                        student_ids: [],
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-semibold"
                  >
                    <option value="TEACHER">Teacher (Read-Only Educator)</option>
                    <option value="PARENT">Parent / Guardian Portal</option>
                    <option value="STUDENT">Student Portal</option>
                    <option value="BURSAR">Bursar / Financial Officer</option>
                    <option value="SCHOOL_ADMIN">School Admin / Principal</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={provForm.full_name}
                    onChange={(e) => setProvForm({ ...provForm, full_name: e.target.value })}
                    placeholder="e.g. Mrs. Ngozi Okafor"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Login Email *</label>
                  <input
                    type="email"
                    required
                    value={provForm.email}
                    onChange={(e) => setProvForm({ ...provForm, email: e.target.value })}
                    placeholder="user@school.edu.ng"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={provForm.phone}
                    onChange={(e) => setProvForm({ ...provForm, phone: e.target.value })}
                    placeholder="080..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Initial Password * <span className="font-normal text-slate-400">(Min 8 chars; required for new accounts)</span>
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={provForm.password}
                  onChange={(e) => setProvForm({ ...provForm, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              {/* Explicit Parent Verification Linkage */}
              {provForm.role_name === 'PARENT' && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <p className="font-bold text-slate-800">Verified Parent–Child Linkage</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={provForm.create_parent_profile}
                      onChange={(e) => setProvForm({ ...provForm, create_parent_profile: e.target.checked, parent_id: '' })}
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span className="font-medium text-slate-700">Create a new guardian profile &amp; link selected children</span>
                  </label>

                  {!provForm.create_parent_profile && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Link to Existing Parent Record</label>
                      <select
                        value={provForm.parent_id}
                        onChange={(e) => setProvForm({ ...provForm, parent_id: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl"
                      >
                        <option value="">Select Parent Record (Optional)...</option>
                        {parents.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.first_name} {p.last_name} ({p.phone || p.email || p.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Assign Verified Children ({provForm.student_ids.length} selected)
                    </label>
                    <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-xl bg-white p-2 space-y-1">
                      {students.length === 0 ? (
                        <p className="text-[11px] text-slate-400 italic p-1">No students enrolled yet.</p>
                      ) : (
                        students.map((st) => {
                          const checked = provForm.student_ids.includes(st.id);
                          return (
                            <label
                              key={st.id}
                              className={`flex items-center justify-between p-1.5 rounded-lg cursor-pointer text-[11px] ${
                                checked ? 'bg-emerald-50 text-emerald-900 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleChildId(st.id)}
                                  className="rounded border-slate-300 text-emerald-600"
                                />
                                <span className="font-mono text-slate-500">{st.admission_number}</span>
                                <span>{st.full_name}</span>
                              </span>
                              <span className="text-[10px] text-slate-400">{st.class_name || '—'}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Explicit Student Binding */}
              {provForm.role_name === 'STUDENT' && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <label className="block font-bold text-slate-800">Bind to Enrolled Student *</label>
                  <select
                    required
                    value={provForm.student_id}
                    onChange={(e) => {
                      const sid = e.target.value;
                      const st = students.find((s) => s.id === sid);
                      setProvForm({
                        ...provForm,
                        student_id: sid,
                        full_name: provForm.full_name || st?.full_name || '',
                        email: provForm.email || st?.email || '',
                      });
                    }}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Student Record...</option>
                    {students.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.full_name} ({st.admission_number}) {st.class_name ? `· ${st.class_name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsProvisionOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={provisionSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60"
                >
                  {provisionSaving ? 'Provisioning...' : 'Provision Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REVOKE ACCESS MODAL */}
      {userToRevoke && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4 text-xs">
            <h3 className="font-bold text-sm text-slate-900">Revoke School Portal Access</h3>
            <p className="text-slate-600">
              Remove <strong>{userToRevoke.full_name}</strong> ({userToRevoke.email}) from <strong>{activeSchool?.name}</strong>? Any linked parent or student portal bindings for this school will also be cleared.
            </p>
            {revokeError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl">{revokeError}</div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setUserToRevoke(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={revokeLoading}
                onClick={handleRevokeConfirm}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold disabled:opacity-60"
              >
                {revokeLoading ? 'Revoking...' : 'Confirm Revoke'}
              </button>
            </div>
          </div>
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
                  Target User: <strong className="text-slate-900">{ticketModalUser.full_name}</strong>
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
                      <span>Recovery Ticket Issued</span>
                    </p>
                    <p className="text-[11px] text-emerald-700">
                      Provide this single-use 1-hour ticket to <strong>{ticketModalUser.full_name}</strong> to set their password securely.
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
                          <span>{copiedLink ? 'Link Copied' : 'Copy 1-Click Link'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={copyTicketToClipboard}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold flex items-center gap-1 border border-slate-700 transition"
                        >
                          {copiedTicket ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedTicket ? 'Token Copied' : 'Copy Token'}</span>
                        </button>
                      </div>
                    </div>
                    <p className="font-mono text-xs text-emerald-300 break-all select-all p-2 bg-slate-950/70 rounded border border-slate-800">
                      {generatedTicket.recoveryTicket}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Expires at {new Date(generatedTicket.expiresAt).toLocaleTimeString()}.
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
    </div>
  );
};
