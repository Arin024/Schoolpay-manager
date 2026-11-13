import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Lock,
  X,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  AcademicSessionItem,
  BehaviourCategory,
  BehaviourRecordItem,
  BehaviourSeverity,
  ClassItem,
  Student,
  TeacherRemarkItem,
} from '../../types/index.js';
import { SeverityBadge } from '../common/StatusBadge.js';

interface SchoolBehaviourViewProps {
  readOnly?: boolean;
}

export const SchoolBehaviourView: React.FC<SchoolBehaviourViewProps> = ({ readOnly = false }) => {
  const { activeSchool } = useAuth();
  const [tab, setTab] = useState<'behaviour' | 'remarks'>('behaviour');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [sessions, setSessions] = useState<AcademicSessionItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<BehaviourRecordItem[]>([]);
  const [remarks, setRemarks] = useState<TeacherRemarkItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({
    class_id: '',
    category: '',
    severity: '',
    academic_session_id: '',
    term_id: '',
  });

  // Behaviour Modal
  const [bModalOpen, setBModalOpen] = useState(false);
  const [editingB, setEditingB] = useState<BehaviourRecordItem | null>(null);
  const [bForm, setBForm] = useState({
    student_id: '',
    record_date: new Date().toISOString().slice(0, 10),
    category: 'COMMENDATION',
    severity: 'LOW',
    title: '',
    description: '',
    action_taken: '',
    admin_remarks: '',
    visible_to_parent: true,
    visible_to_student: true,
    visible_to_teacher: true,
  });
  const [bSaving, setBSaving] = useState(false);

  // Teacher Remark Modal
  const [rModalOpen, setRModalOpen] = useState(false);
  const [rForm, setRForm] = useState({
    student_id: '',
    academic_session_id: '',
    term_id: '',
    remark_text: '',
    staff_name: '',
    visible_to_parent: true,
    visible_to_student: true,
  });
  const [rSaving, setRSaving] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    if (type === 'ok') setTimeout(() => setFeedback(null), 4000);
  };

  const loadBootstrap = async () => {
    const [clsRes, sessRes, stuRes] = await Promise.all([
      api.getSchoolClasses().catch(() => ({ classes: [] })),
      api.getSchoolAcademicSessions().catch(() => ({ sessions: [] })),
      !readOnly ? api.getSchoolStudents({ limit: 300 }).catch(() => ({ students: [] })) : Promise.resolve({ students: [] }),
    ]);
    setClasses(clsRes.classes || []);
    const sessList = sessRes.sessions || [];
    setSessions(sessList);
    setStudents(stuRes.students || []);

    const activeSess = sessList.find((s) => s.status === 'ACTIVE') || sessList[0];
    const activeTerm = activeSess?.terms?.find((t) => t.status === 'ACTIVE') || activeSess?.terms?.[0];
    if (activeSess) {
      setRForm((prev) => ({
        ...prev,
        academic_session_id: prev.academic_session_id || activeSess.id,
        term_id: prev.term_id || activeTerm?.id || '',
      }));
    }
  };

  const loadData = async (f = filters) => {
    setLoading(true);
    try {
      const [bRes, rRes] = await Promise.all([
        api.getBehaviourRecords({
          class_id: f.class_id || undefined,
          category: f.category || undefined,
          severity: f.severity || undefined,
          academic_session_id: f.academic_session_id || undefined,
          term_id: f.term_id || undefined,
        }),
        api.getTeacherRemarks({
          class_id: f.class_id || undefined,
          academic_session_id: f.academic_session_id || undefined,
          term_id: f.term_id || undefined,
        }),
      ]);
      setRecords(bRes.records || []);
      setRemarks(rRes.remarks || []);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to load conduct and remarks records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBootstrap();
    loadData();
  }, [activeSchool?.id]);

  const handleSaveBehaviour = async (e: React.FormEvent) => {
    e.preventDefault();
    setBSaving(true);
    try {
      const st = students.find((s) => s.id === bForm.student_id);
      const payload = {
        ...bForm,
        category: bForm.category as BehaviourCategory,
        severity: bForm.severity as BehaviourSeverity,
      };
      if (editingB) {
        await api.updateBehaviourRecord(editingB.id, payload);
        showMsg('ok', 'Behaviour record updated.');
      } else {
        await api.createBehaviourRecord({
          ...payload,
          class_id: st?.class_id || undefined,
          academic_session_id: filters.academic_session_id || rForm.academic_session_id || undefined,
          term_id: filters.term_id || rForm.term_id || undefined,
        });
        showMsg('ok', 'Behaviour record saved.');
      }
      setBModalOpen(false);
      setEditingB(null);
      await loadData();
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to save behaviour record');
    } finally {
      setBSaving(false);
    }
  };

  const handleDeleteBehaviour = async (id: string) => {
    try {
      await api.deleteBehaviourRecord(id);
      await loadData();
      showMsg('ok', 'Behaviour record removed.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to delete behaviour record');
    }
  };

  const handleSaveRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    setRSaving(true);
    try {
      const st = students.find((s) => s.id === rForm.student_id);
      await api.upsertTeacherRemark({
        ...rForm,
        class_id: st?.class_id || undefined,
      });
      setRModalOpen(false);
      await loadData();
      showMsg('ok', 'Official termly teacher remark saved.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to save remark');
    } finally {
      setRSaving(false);
    }
  };

  const rSessionObj = sessions.find((s) => s.id === rForm.academic_session_id);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-600" />
              <span>Behaviour Monitoring &amp; Official Termly Remarks</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {readOnly
                ? 'Read-only conduct observations and termly teacher remarks visible to educators.'
                : 'Track commendations, discipline incidents, and official term remarks with strict Parent, Student, and Teacher visibility controls.'}
            </p>
          </div>
          {readOnly && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Read-Only Educator View</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTab('behaviour')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                tab === 'behaviour' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Behaviour &amp; Conduct ({records.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('remarks')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                tab === 'remarks' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Official Teacher Remarks ({remarks.length})
            </button>
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                if (tab === 'behaviour') {
                  setEditingB(null);
                  setBForm({
                    student_id: students[0]?.id || '',
                    record_date: new Date().toISOString().slice(0, 10),
                    category: 'COMMENDATION',
                    severity: 'LOW',
                    title: '',
                    description: '',
                    action_taken: '',
                    admin_remarks: '',
                    visible_to_parent: true,
                    visible_to_student: true,
                    visible_to_teacher: true,
                  });
                  setBModalOpen(true);
                } else {
                  setRForm((prev) => ({
                    ...prev,
                    student_id: prev.student_id || students[0]?.id || '',
                    remark_text: '',
                  }));
                  setRModalOpen(true);
                }
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{tab === 'behaviour' ? 'Log Behaviour Record' : 'Add / Update Remark'}</span>
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <select
            value={filters.class_id}
            onChange={(e) => {
              const next = { ...filters, class_id: e.target.value };
              setFilters(next);
              loadData(next);
            }}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
          >
            <option value="">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={filters.category}
            onChange={(e) => {
              const next = { ...filters, category: e.target.value };
              setFilters(next);
              loadData(next);
            }}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
          >
            <option value="">All Categories</option>
            <option value="POSITIVE">Positive</option>
            <option value="COMMENDATION">Commendation</option>
            <option value="OBSERVATION">Observation</option>
            <option value="DISCIPLINE">Discipline</option>
            <option value="INCIDENT">Incident</option>
          </select>

          <select
            value={filters.severity}
            onChange={(e) => {
              const next = { ...filters, severity: e.target.value };
              setFilters(next);
              loadData(next);
            }}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
          >
            <option value="">All Severities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>

          <select
            value={filters.academic_session_id}
            onChange={(e) => {
              const next = { ...filters, academic_session_id: e.target.value };
              setFilters(next);
              loadData(next);
            }}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
          >
            <option value="">All Sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
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

      {tab === 'behaviour' ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          {loading ? (
            <p className="py-10 text-center text-xs text-slate-400">Loading behaviour records...</p>
          ) : records.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No behaviour records match your filter criteria.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {records.map((rec) => (
                <div key={rec.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{rec.title}</span>
                      <SeverityBadge severity={rec.severity} />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {rec.student_name} ({rec.admission_number}) · {rec.class_name || 'Unassigned'} · {rec.category} ·{' '}
                      <span className="font-mono tabular-nums">{rec.record_date}</span>
                    </p>
                    <p className="text-slate-700 leading-relaxed pt-1">{rec.description}</p>
                    {rec.action_taken && (
                      <p className="text-[11px] text-slate-600">
                        <strong>Action Taken:</strong> {rec.action_taken}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-400">
                      Visibility: {[
                        rec.visible_to_parent ? 'Parent' : null,
                        rec.visible_to_student ? 'Student' : null,
                        rec.visible_to_teacher ? 'Teacher' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Admin Only'}
                    </p>
                  </div>
                  {!readOnly && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingB(rec);
                          setBForm({
                            student_id: rec.student_id,
                            record_date: rec.record_date,
                            category: rec.category,
                            severity: rec.severity,
                            title: rec.title,
                            description: rec.description,
                            action_taken: rec.action_taken || '',
                            admin_remarks: rec.admin_remarks || '',
                            visible_to_parent: rec.visible_to_parent === 1,
                            visible_to_student: rec.visible_to_student === 1,
                            visible_to_teacher: rec.visible_to_teacher === 1,
                          });
                          setBModalOpen(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteBehaviour(rec.id)}
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
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          {loading ? (
            <p className="py-10 text-center text-xs text-slate-400">Loading remarks...</p>
          ) : remarks.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No termly teacher remarks recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {remarks.map((rm) => (
                <div key={rm.id} className="py-4 first:pt-0 last:pb-0 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-900 text-sm">
                      {rm.student_name}{' '}
                      <span className="font-mono text-[11px] font-normal text-slate-400">
                        ({rm.admission_number})
                      </span>
                    </p>
                    <span className="text-[11px] text-slate-500">
                      {rm.session_name} · {rm.term_name}
                    </span>
                  </div>
                  <p className="text-slate-700 leading-relaxed">{rm.remark_text}</p>
                  <p className="text-[11px] text-slate-400">
                    {rm.staff_name ? `Recorded for: ${rm.staff_name} · ` : ''}
                    Visible to: {[rm.visible_to_parent ? 'Parent' : null, rm.visible_to_student ? 'Student' : null]
                      .filter(Boolean)
                      .join(', ') || 'Admin Only'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BEHAVIOUR MODAL */}
      {bModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">{editingB ? 'Edit Behaviour Log' : 'Log Behaviour / Conduct Note'}</h3>
              <button type="button" onClick={() => setBModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveBehaviour} className="p-5 space-y-3 text-xs">
              {!editingB && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Student *</label>
                  <select
                    required
                    value={bForm.student_id}
                    onChange={(e) => setBForm({ ...bForm, student_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Student...</option>
                    {students.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.full_name} ({st.admission_number}) · {st.class_name || '—'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={bForm.record_date}
                    onChange={(e) => setBForm({ ...bForm, record_date: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={bForm.category}
                    onChange={(e) => setBForm({ ...bForm, category: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="POSITIVE">Positive</option>
                    <option value="COMMENDATION">Commendation</option>
                    <option value="OBSERVATION">Observation</option>
                    <option value="DISCIPLINE">Discipline</option>
                    <option value="INCIDENT">Incident</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Severity</label>
                  <select
                    value={bForm.severity}
                    onChange={(e) => setBForm({ ...bForm, severity: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={bForm.title}
                  onChange={(e) => setBForm({ ...bForm, title: e.target.value })}
                  placeholder="e.g. Science Fair Leadership Award"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Description *</label>
                <textarea
                  rows={3}
                  required
                  value={bForm.description}
                  onChange={(e) => setBForm({ ...bForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Action Taken</label>
                <input
                  type="text"
                  value={bForm.action_taken}
                  onChange={(e) => setBForm({ ...bForm, action_taken: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bForm.visible_to_parent}
                    onChange={(e) => setBForm({ ...bForm, visible_to_parent: e.target.checked })}
                  />
                  <span>Visible to Parent</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bForm.visible_to_student}
                    onChange={(e) => setBForm({ ...bForm, visible_to_student: e.target.checked })}
                  />
                  <span>Visible to Student</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bForm.visible_to_teacher}
                    onChange={(e) => setBForm({ ...bForm, visible_to_teacher: e.target.checked })}
                  />
                  <span>Visible to Teacher</span>
                </label>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold"
                >
                  {bSaving ? 'Saving...' : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TEACHER REMARK MODAL */}
      {rModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
              <h3 className="font-bold text-sm">Record Official Termly Teacher Remark</h3>
              <button type="button" onClick={() => setRModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveRemark} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Student *</label>
                <select
                  required
                  value={rForm.student_id}
                  onChange={(e) => setRForm({ ...rForm, student_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="">Select Student...</option>
                  {students.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.full_name} ({st.admission_number})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Session *</label>
                  <select
                    required
                    value={rForm.academic_session_id}
                    onChange={(e) => setRForm({ ...rForm, academic_session_id: e.target.value, term_id: '' })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Session...</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Term *</label>
                  <select
                    required
                    value={rForm.term_id}
                    onChange={(e) => setRForm({ ...rForm, term_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="">Select Term...</option>
                    {(rSessionObj?.terms || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Teacher Name (Display)</label>
                <input
                  type="text"
                  value={rForm.staff_name}
                  onChange={(e) => setRForm({ ...rForm, staff_name: e.target.value })}
                  placeholder="e.g. Mr. Adewale (Class Teacher)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Official Remark *</label>
                <textarea
                  rows={3}
                  required
                  value={rForm.remark_text}
                  onChange={(e) => setRForm({ ...rForm, remark_text: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rForm.visible_to_parent}
                    onChange={(e) => setRForm({ ...rForm, visible_to_parent: e.target.checked })}
                  />
                  <span>Visible to Parent</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rForm.visible_to_student}
                    onChange={(e) => setRForm({ ...rForm, visible_to_student: e.target.checked })}
                  />
                  <span>Visible to Student</span>
                </label>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rSaving}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold"
                >
                  {rSaving ? 'Saving...' : 'Save Remark'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
