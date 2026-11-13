import React, { useEffect, useState } from 'react';
import { CalendarCheck, CheckCircle2, AlertCircle, Send, Lock, Save, X } from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  AcademicSessionItem,
  AttendancePublicationItem,
  AttendanceRecordItem,
  AttendanceStatus,
  ClassItem,
  Student,
} from '../../types/index.js';
import { AttendanceBadge } from '../common/StatusBadge.js';

interface SchoolAttendanceViewProps {
  readOnly?: boolean;
}

export const SchoolAttendanceView: React.FC<SchoolAttendanceViewProps> = ({ readOnly = false }) => {
  const { activeSchool } = useAuth();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [sessions, setSessions] = useState<AcademicSessionItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecordItem[]>([]);
  const [publications, setPublications] = useState<AttendancePublicationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedTermId, setSelectedTermId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10));

  const [draftStatuses, setDraftStatuses] = useState<Record<string, { status: AttendanceStatus; notes: string }>>({});
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    if (type === 'ok') setTimeout(() => setFeedback(null), 4000);
  };

  const loadMetadata = async () => {
    try {
      const [clsRes, sessRes, stuRes] = await Promise.all([
        api.getSchoolClasses().catch(() => ({ classes: [] })),
        api.getSchoolAcademicSessions().catch(() => ({ sessions: [] })),
        !readOnly ? api.getSchoolStudents({ limit: 300 }).catch(() => ({ students: [] })) : Promise.resolve({ students: [] }),
      ]);
      const clsList = clsRes.classes || [];
      const sessList = sessRes.sessions || [];
      setClasses(clsList);
      setSessions(sessList);
      setStudents(stuRes.students || []);

      const activeSess = sessList.find((s) => s.status === 'ACTIVE') || sessList[0];
      const activeTerm = activeSess?.terms?.find((t) => t.status === 'ACTIVE') || activeSess?.terms?.[0];
      if (activeSess) {
        setSelectedSessionId(activeSess.id);
        setSelectedTermId(activeTerm?.id || '');
      }
      if (clsList.length > 0 && !readOnly) {
        setSelectedClassId(clsList[0].id);
      }
    } catch {
      // handled below
    }
  };

  const loadAttendance = async (
    classId = selectedClassId,
    date = attendanceDate,
    sessionId = selectedSessionId,
    termId = selectedTermId
  ) => {
    setLoading(true);
    try {
      const res = await api.getAttendance({
        class_id: classId || undefined,
        attendance_date: date || undefined,
        academic_session_id: sessionId || undefined,
        term_id: termId || undefined,
      });
      setRecords(res.records || []);
      setPublications(res.publications || []);

      const nextDrafts: Record<string, { status: AttendanceStatus; notes: string }> = {};
      const classRoster = students.filter((s) => !classId || s.class_id === classId);
      for (const st of classRoster) {
        const existing = (res.records || []).find((r) => r.student_id === st.id && r.attendance_date === date);
        nextDrafts[st.id] = {
          status: existing?.status || 'PRESENT',
          notes: existing?.notes || '',
        };
      }
      setDraftStatuses(nextDrafts);
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to load attendance records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetadata();
  }, [activeSchool?.id]);

  useEffect(() => {
    loadAttendance();
  }, [selectedClassId, attendanceDate, selectedSessionId, selectedTermId, students.length]);

  const classRoster = students.filter((s) => !selectedClassId || s.class_id === selectedClassId);
  const selectedSessionObj = sessions.find((s) => s.id === selectedSessionId);

  const handleBulkSave = async (isPublished: boolean) => {
    if (classRoster.length === 0) {
      showMsg('err', 'No students in selected class scope.');
      return;
    }
    setSaving(true);
    try {
      const payloadRecords = classRoster.map((st) => {
        const d = draftStatuses[st.id] || { status: 'PRESENT' as AttendanceStatus, notes: '' };
        return {
          student_id: st.id,
          status: d.status,
          notes: d.notes || undefined,
        };
      });
      const res = await api.bulkMarkAttendance({
        attendance_date: attendanceDate,
        class_id: selectedClassId || undefined,
        academic_session_id: selectedSessionId || undefined,
        term_id: selectedTermId || undefined,
        is_published: isPublished,
        records: payloadRecords,
      });
      await loadAttendance();
      showMsg(
        'ok',
        `Saved ${res.savedCount} attendance record(s) (${isPublished ? 'Published to portals' : 'Saved as Draft'}).`
      );
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to save attendance');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishScope = async () => {
    setPublishing(true);
    try {
      const res = await api.publishAttendance({
        class_id: selectedClassId || undefined,
        academic_session_id: selectedSessionId || undefined,
        term_id: selectedTermId || undefined,
      });
      await loadAttendance();
      showMsg('ok', res.message || 'Attendance published to Parent and Student portals.');
    } catch (err: any) {
      showMsg('err', err?.message || 'Failed to publish attendance');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-emerald-600" />
              <span>Attendance Monitoring &amp; Roll-Call</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {readOnly
                ? 'Read-only class attendance history and portal publication log.'
                : 'Mark daily class registers as Draft or Publish directly to verified Parent and Student portals.'}
            </p>
          </div>
          {readOnly && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Read-Only Educator View</span>
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs pt-2 border-t border-slate-100">
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
          >
            <option value="">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={attendanceDate}
            onChange={(e) => setAttendanceDate(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
          />

          <select
            value={selectedSessionId}
            onChange={(e) => {
              setSelectedSessionId(e.target.value);
              setSelectedTermId('');
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

          <select
            value={selectedTermId}
            onChange={(e) => setSelectedTermId(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
          >
            <option value="">All Terms</option>
            {(selectedSessionObj?.terms || sessions.flatMap((s) => s.terms || [])).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
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

      {/* Admin Daily Roll-Call Workspace */}
      {!readOnly && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Daily Register ({classRoster.length} Student{classRoster.length === 1 ? '' : 's'})
              </h3>
              <p className="text-xs text-slate-500 tabular-nums">Date: {attendanceDate}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving || classRoster.length === 0}
                onClick={() => handleBulkSave(false)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Draft</span>
              </button>
              <button
                type="button"
                disabled={saving || classRoster.length === 0}
                onClick={() => handleBulkSave(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Save &amp; Publish</span>
              </button>
              <button
                type="button"
                disabled={publishing}
                onClick={handlePublishScope}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {publishing ? 'Publishing...' : 'Publish All Unreleased'}
              </button>
            </div>
          </div>

          {classRoster.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              No enrolled students in this class filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-3">Student</th>
                    <th className="py-2.5 px-3">Class</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {classRoster.map((st) => {
                    const draft = draftStatuses[st.id] || { status: 'PRESENT' as AttendanceStatus, notes: '' };
                    return (
                      <tr key={st.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {st.full_name}
                          <span className="block text-[10px] font-mono text-slate-400">{st.admission_number}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{st.class_name || '—'}</td>
                        <td className="py-2.5 px-3">
                          <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                            {(['PRESENT', 'LATE', 'EXCUSED', 'ABSENT'] as AttendanceStatus[]).map((statusOpt) => (
                              <button
                                key={statusOpt}
                                type="button"
                                onClick={() =>
                                  setDraftStatuses((prev) => ({
                                    ...prev,
                                    [st.id]: { ...draft, status: statusOpt },
                                  }))
                                }
                                className={`px-2 py-1 rounded text-[11px] font-semibold transition cursor-pointer ${
                                  draft.status === statusOpt
                                    ? statusOpt === 'PRESENT'
                                      ? 'bg-emerald-600 text-white'
                                      : statusOpt === 'LATE'
                                      ? 'bg-amber-500 text-white'
                                      : statusOpt === 'EXCUSED'
                                      ? 'bg-sky-600 text-white'
                                      : 'bg-rose-600 text-white'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                {statusOpt}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={draft.notes}
                            onChange={(e) =>
                              setDraftStatuses((prev) => ({
                                ...prev,
                                [st.id]: { ...draft, notes: e.target.value },
                              }))
                            }
                            placeholder="Optional note..."
                            className="w-full min-w-[140px] px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-lg"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Attendance Records History + Publication Log */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Attendance Log ({records.length})</h3>
          {loading ? (
            <p className="py-8 text-center text-xs text-slate-400">Loading attendance logs...</p>
          ) : records.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">No attendance entries recorded for these filters.</p>
          ) : (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3">Student</th>
                    <th className="py-2 px-3">Class</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Portal Visibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 px-3 font-mono text-slate-600 tabular-nums">{r.attendance_date}</td>
                      <td className="py-2 px-3 font-medium text-slate-900">{r.student_name}</td>
                      <td className="py-2 px-3 text-slate-600">{r.class_name || '—'}</td>
                      <td className="py-2 px-3">
                        <AttendanceBadge status={r.status} />
                      </td>
                      <td className="py-2 px-3 text-[11px] font-medium">
                        {r.is_published === 1 ? (
                          <span className="text-emerald-700">Published</span>
                        ) : (
                          <span className="text-slate-400">Draft</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Publication History</h3>
          {publications.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">No attendance publications yet.</p>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto text-xs">
              {publications.map((pub) => (
                <div key={pub.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                  <p className="font-semibold text-slate-900">
                    {pub.class_name || 'All Classes'} · {pub.status}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {pub.session_name || ''} {pub.term_name ? `· ${pub.term_name}` : ''}
                  </p>
                  {pub.published_at && (
                    <p className="text-[10px] font-mono text-slate-400 tabular-nums">
                      {new Date(pub.published_at).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
