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
  Power,
  Sparkles,
  Download,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { RoleBadge } from '../common/StatusBadge.js';
import { BulkProvisionCredential, ParentItem, Student } from '../../types/index.js';

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
    staff_number: '',
    job_title: 'Classroom Educator',
    department: 'Academics',
    role_name: 'TEACHER' as 'SCHOOL_ADMIN' | 'BURSAR' | 'TEACHER' | 'STAFF' | 'PARENT' | 'STUDENT',
    parent_id: '',
    create_parent_profile: false,
    student_ids: [] as string[],
    student_id: '',
  });
  const [copiedUserStaffCode, setCopiedUserStaffCode] = useState<string | null>(null);

  // Revoke & Status Toggle Modal State
  const [userToRevoke, setUserToRevoke] = useState<any | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Bulk Auto-Provision Logins State
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkTarget, setBulkTarget] = useState<'BOTH' | 'STUDENTS' | 'PARENTS'>('BOTH');
  const [bulkCustomPassword, setBulkCustomPassword] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkProvisionCredential[] | null>(null);

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
    const isStaffPortalRole = provForm.role_name === 'TEACHER' || provForm.role_name === 'STAFF';
    try {
      const payload: any = {
        email: provForm.email.trim() || undefined,
        full_name: provForm.full_name.trim(),
        phone: provForm.phone.trim() || undefined,
        password: provForm.password || undefined,
        role_name: provForm.role_name,
      };
      if (isStaffPortalRole) {
        if (provForm.staff_number.trim()) payload.staff_number = provForm.staff_number.trim();
        if (provForm.job_title.trim()) payload.job_title = provForm.job_title.trim();
        if (provForm.department.trim()) payload.department = provForm.department.trim();
      }
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
      const staffCodeNotice = res.issuedStaffNumber
        ? ` Issued Staff Login Code: ${res.issuedStaffNumber}`
        : '';
      setProvisionSuccess((res.message || 'Portal account provisioned successfully.') + staffCodeNotice);
      setIsProvisionOpen(false);
      setProvForm({
        full_name: '',
        email: '',
        phone: '',
        password: '',
        staff_number: '',
        job_title: 'Classroom Educator',
        department: 'Academics',
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

  const handleToggleUserStatus = async (targetUser: any) => {
    const currentlyActive = targetUser.is_active !== 0 && targetUser.is_active !== false;
    setTogglingUserId(targetUser.id);
    setActionError(null);
    setProvisionSuccess(null);
    try {
      const res = await api.toggleSchoolUserStatus(targetUser.id, !currentlyActive);
      setProvisionSuccess(res.message || `Account status updated for ${targetUser.full_name}.`);
      await loadData();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to update user account status');
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleBulkProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkSaving(true);
    setBulkError(null);
    try {
      const res = await api.bulkProvisionPortals({
        target: bulkTarget,
        custom_password: bulkCustomPassword.trim() || undefined,
      });
      setBulkResults(res.credentials || []);
      setProvisionSuccess(res.message);
      await loadData();
    } catch (err: any) {
      setBulkError(err?.message || 'Failed to auto-provision portal logins.');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleDownloadBulkCsv = () => {
    if (!bulkResults || bulkResults.length === 0) return;
    const rows = [
      ['Role', 'Full Name', 'Primary Login (Adm No / Email / Phone)', 'Alt Email Identifier', 'Temporary Password'],
      ...bulkResults.map((c) => [c.role, c.name, c.loginIdentifier, c.aliasIdentifier || '', c.temporaryPassword]),
    ];
    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSchool?.slug || 'school'}_portal_credentials.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
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
            <>
              <button
                type="button"
                onClick={() => {
                  setBulkError(null);
                  setBulkResults(null);
                  setBulkCustomPassword('');
                  setIsBulkOpen(true);
                }}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>Bulk Generate Logins</span>
              </button>
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
            </>
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

      {actionError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError}</span>
          </span>
          <button type="button" onClick={() => setActionError(null)} className="text-rose-700 hover:text-rose-900">
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
                const isAccountActive = u.is_active !== 0 && u.is_active !== false;
                return (
                  <tr key={`${u.id}-${u.role_name}`} className="hover:bg-slate-50/50 transition">
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                          {u.full_name?.charAt(0) || 'U'}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-slate-900 font-bold">{u.full_name}</p>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                isAccountActive
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {isAccountActive ? 'Active' : 'Deactivated'}
                            </span>
                          </div>
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
                      {u.linked_staff_number && (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className="font-mono text-[11px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                            Staff Code: {u.linked_staff_number}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(u.linked_staff_number);
                              setCopiedUserStaffCode(u.id);
                              setTimeout(() => setCopiedUserStaffCode(null), 2000);
                            }}
                            className="p-0.5 text-slate-400 hover:text-indigo-700 cursor-pointer"
                            title="Copy Staff Login Code"
                          >
                            {copiedUserStaffCode === u.id ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      )}
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
                                <>
                                  <button
                                    type="button"
                                    disabled={togglingUserId === u.id}
                                    onClick={() => handleToggleUserStatus(u)}
                                    className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 border transition cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                                      isAccountActive
                                        ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                                    }`}
                                    title={isAccountActive ? 'Deactivate user login' : 'Activate user login'}
                                  >
                                    <Power className="w-3 h-3" />
                                    <span>{togglingUserId === u.id ? '...' : isAccountActive ? 'Deactivate' : 'Activate'}</span>
                                  </button>
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
                                </>
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
                    <option value="TEACHER">Teacher (Dedicated Staff Workspace)</option>
                    <option value="STAFF">Non-Teaching Staff (Dedicated Staff Workspace)</option>
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
                  <label className="block font-semibold text-slate-700 mb-1">
                    Login Email {provForm.role_name === 'TEACHER' || provForm.role_name === 'STAFF' ? '(Optional for Staff Code)' : '*'}
                  </label>
                  <input
                    type="email"
                    required={provForm.role_name !== 'TEACHER' && provForm.role_name !== 'STAFF'}
                    value={provForm.email}
                    onChange={(e) => setProvForm({ ...provForm, email: e.target.value })}
                    placeholder={
                      provForm.role_name === 'TEACHER' || provForm.role_name === 'STAFF'
                        ? 'Optional (Staff Code works without email)'
                        : 'user@school.edu.ng'
                    }
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

              {(provForm.role_name === 'TEACHER' || provForm.role_name === 'STAFF') && (
                <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-3">
                  <p className="font-bold text-indigo-950">Unique Staff Login Code &amp; Role Profile</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Staff Login Code <span className="text-slate-400 font-normal">(Auto-issued if blank)</span>
                      </label>
                      <input
                        type="text"
                        value={provForm.staff_number}
                        onChange={(e) => setProvForm({ ...provForm, staff_number: e.target.value })}
                        placeholder="e.g. BMC/STF/2026/0001"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Job Title</label>
                      <input
                        type="text"
                        value={provForm.job_title}
                        onChange={(e) => setProvForm({ ...provForm, job_title: e.target.value })}
                        placeholder={provForm.role_name === 'STAFF' ? 'e.g. Lab Attendant / Librarian' : 'e.g. Biology Teacher'}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Initial Password{' '}
                  {provForm.role_name === 'TEACHER' || provForm.role_name === 'STAFF' ? (
                    <span className="font-normal text-slate-400">(Optional — Staff sign in using their Staff Login Code)</span>
                  ) : (
                    <>
                      * <span className="font-normal text-slate-400">(Min 8 chars; required for Admin/Bursar)</span>
                    </>
                  )}
                </label>
                <input
                  type="password"
                  required={provForm.role_name !== 'TEACHER' && provForm.role_name !== 'STAFF'}
                  minLength={provForm.password ? 8 : undefined}
                  value={provForm.password}
                  onChange={(e) => setProvForm({ ...provForm, password: e.target.value })}
                  placeholder={
                    provForm.role_name === 'TEACHER' || provForm.role_name === 'STAFF'
                      ? 'Optional password'
                      : '••••••••'
                  }
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

      {/* BULK AUTO-PROVISION PORTAL LOGINS MODAL */}
      {isBulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">Bulk Generate Student &amp; Parent Logins</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkOpen(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
              <p className="text-slate-600">
                Automatically issue separate, individual role-scoped portal credentials for unlinked students and parents in <strong>{activeSchool?.name}</strong>. Students can sign in using their Admission Number and parents using their Email or Phone at{' '}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-emerald-700">
                  /#portal/{activeSchool?.slug}
                </code>.
              </p>

              {bulkError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl">{bulkError}</div>
              )}

              {!bulkResults ? (
                <form onSubmit={handleBulkProvisionSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Accounts to Provision</label>
                      <select
                        value={bulkTarget}
                        onChange={(e) => setBulkTarget(e.target.value as any)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-semibold"
                      >
                        <option value="BOTH">Unlinked Students &amp; Parents</option>
                        <option value="STUDENTS">Unlinked Students Only</option>
                        <option value="PARENTS">Unlinked Parents Only</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Initial Password (Optional)
                      </label>
                      <input
                        type="text"
                        value={bulkCustomPassword}
                        onChange={(e) => setBulkCustomPassword(e.target.value)}
                        placeholder="Leave blank for unique random passwords"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsBulkOpen(false)}
                      className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={bulkSaving}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60 cursor-pointer"
                    >
                      {bulkSaving ? 'Generating Logins...' : 'Generate Individual Logins'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-emerald-800">
                      {bulkResults.length} New Credential{bulkResults.length === 1 ? '' : 's'} Generated
                    </span>
                    {bulkResults.length > 0 && (
                      <button
                        type="button"
                        onClick={handleDownloadBulkCsv}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Credentials CSV</span>
                      </button>
                    )}
                  </div>
                  {bulkResults.length === 0 ? (
                    <p className="text-slate-500 italic py-4 text-center">
                      All eligible students and parents already have active portal accounts (or are missing admission number / contact info).
                    </p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase">
                          <tr>
                            <th className="py-2 px-3">Role</th>
                            <th className="py-2 px-3">Name</th>
                            <th className="py-2 px-3">Login Identifier</th>
                            <th className="py-2 px-3">Temporary Password</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {bulkResults.map((c, idx) => (
                            <tr key={idx}>
                              <td className="py-2 px-3 font-bold">{c.role}</td>
                              <td className="py-2 px-3 text-slate-900">{c.name}</td>
                              <td className="py-2 px-3 font-mono text-slate-700">{c.loginIdentifier}</td>
                              <td className="py-2 px-3 font-mono font-bold text-emerald-700">{c.temporaryPassword}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsBulkOpen(false)}
                      className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
