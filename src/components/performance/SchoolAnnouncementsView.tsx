import React, { useEffect, useState } from 'react';
import { Megaphone, Plus, Trash2, Edit2, CheckCircle2, AlertCircle, Lock, X, UserPlus } from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  AnnouncementAudience,
  AnnouncementPriority,
  ClassItem,
  SchoolAdmissionInquiry,
  SchoolAnnouncementItem,
} from '../../types/index.js';

interface SchoolAnnouncementsViewProps {
  readOnly?: boolean;
}

export const SchoolAnnouncementsView: React.FC<SchoolAnnouncementsViewProps> = ({ readOnly = false }) => {
  const { activeSchool } = useAuth();
  const [announcements, setAnnouncements] = useState<SchoolAnnouncementItem[]>([]);
  const [inquiries, setInquiries] = useState<SchoolAdmissionInquiry[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolAnnouncementItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [form, setForm] = useState({
    title: '',
    content: '',
    audience: 'ALL',
    target_class_id: '',
    priority: 'NORMAL',
    is_confidential: false,
    is_published: true,
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [annRes, clsRes, inqRes] = await Promise.all([
        api.getAnnouncements(),
        api.getSchoolClasses().catch(() => ({ classes: [] })),
        (readOnly ? api.getStaffWorkspaceAdmissionsInquiries() : api.getAdmissionInquiries()).catch(() => ({
          inquiries: [],
        })),
      ]);
      setAnnouncements(annRes.announcements || []);
      setClasses(clsRes.classes || []);
      setInquiries(inqRes.inquiries || []);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to load announcements' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeSchool?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const isConfidential = form.audience === 'STAFF_ONLY' || Boolean(form.is_confidential);
      const payload = {
        ...form,
        audience: (isConfidential && form.audience !== 'TEACHERS' ? 'STAFF_ONLY' : form.audience) as AnnouncementAudience,
        priority: form.priority as AnnouncementPriority,
        is_confidential: isConfidential ? 1 : 0,
        target_class_id: form.audience === 'CLASS' && form.target_class_id ? form.target_class_id : null,
      };
      if (editing) {
        await api.updateAnnouncement(editing.id, payload);
        setFeedback({ type: 'ok', text: 'Announcement updated.' });
      } else {
        await api.createAnnouncement(payload);
        setFeedback({ type: 'ok', text: 'Announcement posted.' });
      }
      setModalOpen(false);
      setEditing(null);
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to save announcement' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteAnnouncement(id);
      setFeedback({ type: 'ok', text: 'Announcement deleted.' });
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete announcement' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-emerald-600" />
            <span>School Announcements &amp; Circulars</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {readOnly
              ? 'Official notices published by School Administration.'
              : 'Broadcast official notices to Parents, Students, Teachers, or specific classes.'}
          </p>
        </div>

        {readOnly ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Read-Only Educator View</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setForm({
                title: '',
                content: '',
                audience: 'ALL',
                target_class_id: '',
                priority: 'NORMAL',
                is_confidential: false,
                is_published: true,
              });
              setModalOpen(true);
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer self-start"
          >
            <Plus className="w-4 h-4" />
            <span>Publish Announcement</span>
          </button>
        )}
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span className="flex items-center gap-2 font-medium">
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </span>
          <button type="button" onClick={() => setFeedback(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {inquiries.length > 0 && (
        <div className="bg-white rounded-2xl border border-blue-200 p-6 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600" />
              <span>Prospective Student Inquiry Notices ({inquiries.length})</span>
            </h3>
            <span className="text-[11px] font-semibold text-blue-700 tabular-nums">
              {inquiries.filter((i) => i.status === 'NEW').length} New
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {inquiries.slice(0, 6).map((inq) => (
              <div key={inq.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-slate-900 text-sm">
                    {inq.student_name} {inq.target_class ? `(${inq.target_class})` : ''}
                  </p>
                  <span className="font-bold text-blue-700">{inq.status}</span>
                </div>
                <p className="text-slate-600">
                  Parent: <strong>{inq.parent_name}</strong> · <span className="font-mono">{inq.parent_phone}</span>
                  {inq.parent_email ? ` · ${inq.parent_email}` : ''}
                </p>
                {inq.message && <p className="text-slate-700">{inq.message}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        {loading ? (
          <p className="py-10 text-center text-xs text-slate-400">Loading announcements...</p>
        ) : announcements.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">No announcements published yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {announcements.map((a) => (
              <div key={a.id} className="py-4 first:pt-0 last:pb-0 flex items-start justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{a.title}</h3>
                    {a.priority !== 'NORMAL' && (
                      <span
                        className={`text-[11px] font-semibold ${
                          a.priority === 'URGENT' ? 'text-rose-700' : 'text-amber-700'
                        }`}
                      >
                        · {a.priority}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Audience: {a.audience === 'STAFF_ONLY' ? 'Confidential Staff Only' : a.audience}
                    {a.target_class_name ? ` (${a.target_class_name})` : ''} ·{' '}
                    {(a.is_confidential === 1 || a.audience === 'STAFF_ONLY') && (
                      <span className="font-bold text-rose-700">Private Staff Only (Hidden from Parents/Students) · </span>
                    )}
                    {a.is_published === 1 ? 'Published' : 'Draft'} ·{' '}
                    <span className="font-mono tabular-nums">
                      {a.published_at || a.created_at
                        ? new Date(a.published_at || a.created_at || '').toLocaleDateString()
                        : ''}
                    </span>
                  </p>
                  <p className="text-slate-700 leading-relaxed pt-1 whitespace-pre-line">{a.content}</p>
                </div>

                {!readOnly && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(a);
                        setForm({
                          title: a.title,
                          content: a.content,
                          audience: a.audience,
                          target_class_id: a.target_class_id || '',
                          priority: a.priority,
                          is_confidential: a.is_confidential === 1 || a.audience === 'STAFF_ONLY',
                          is_published: a.is_published === 1,
                        });
                        setModalOpen(true);
                      }}
                      className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">{editing ? 'Edit Announcement' : 'Publish School Announcement'}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Mid-Term Open Day & PTA Meeting"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Target Audience</label>
                  <select
                    value={form.audience}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm({
                        ...form,
                        audience: val,
                        is_confidential: val === 'STAFF_ONLY' ? true : form.is_confidential,
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="ALL">All Portal Users</option>
                    <option value="PARENTS">Parents Only</option>
                    <option value="STUDENTS">Students Only</option>
                    <option value="TEACHERS">Teachers Only</option>
                    <option value="STAFF_ONLY">Confidential — Staff Only (Hidden from Parents &amp; Students)</option>
                    <option value="CLASS">Specific Class</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="IMPORTANT">Important</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>
              {form.audience === 'CLASS' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Select Class *</label>
                  <select
                    required
                    value={form.target_class_id}
                    onChange={(e) => setForm({ ...form, target_class_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Choose Class...</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Message Content *</label>
                <textarea
                  rows={4}
                  required
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-rose-700">
                  <input
                    type="checkbox"
                    checked={form.is_confidential || form.audience === 'STAFF_ONLY'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        is_confidential: e.target.checked,
                        audience: e.target.checked && form.audience !== 'TEACHERS' ? 'STAFF_ONLY' : form.audience === 'STAFF_ONLY' && !e.target.checked ? 'TEACHERS' : form.audience,
                      })
                    }
                  />
                  <span>Mark Confidential (Strict Staff Workspace Only — Invisible to Parents &amp; Students)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_published}
                    onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
                  />
                  <span>Publish immediately to target portals</span>
                </label>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold"
                >
                  {saving ? 'Saving...' : 'Save Announcement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
