import React, { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, ClipboardList, X } from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { ClassItem, StaffRequestItem, SubjectItem } from '../../types/index.js';
import { LessonNotesStudio } from '../portal/LessonNotesStudio.js';

export const AdminStaffDeskView: React.FC = () => {
  const { activeSchool } = useAuth();
  const [subTab, setSubTab] = useState<'lesson-notes' | 'requests'>('lesson-notes');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [requests, setRequests] = useState<StaffRequestItem[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [loadingRequests, setLoadingRequests] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getSchoolClasses().catch(() => ({ classes: [] })),
      api.getSubjects().catch(() => ({ subjects: [] })),
    ]).then(([clsRes, subRes]) => {
      setClasses(clsRes.classes || []);
      setSubjects(subRes.subjects || []);
    });
  }, [activeSchool?.id]);

  const loadRequests = async () => {
    setLoadingRequests(true);
    try {
      const res = await api.getStaffRequests();
      setRequests(res.requests || []);
      const map: Record<string, string> = {};
      for (const item of res.requests || []) {
        map[item.id] = item.admin_response || '';
      }
      setResponses(map);
    } catch {
      setRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, [activeSchool?.id]);

  const handleReviewRequest = async (id: string, status: 'APPROVED' | 'DECLINED') => {
    try {
      const res = await api.reviewStaffRequest(id, {
        status,
        admin_response: responses[id] ?? '',
      });
      setRequests((prev) => prev.map((r) => (r.id === id ? res.request : r)));
      setFeedback({ type: 'ok', text: `Staff request marked ${status.toLowerCase()}.` });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to update staff request.' });
    }
  };

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('lesson-notes')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap ${
              subTab === 'lesson-notes' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4 text-emerald-400" />
            <span>Staff Lesson Notes Review</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('requests')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap ${
              subTab === 'requests' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <ClipboardList className="w-4 h-4 text-emerald-400" />
            <span>Staff Leave &amp; Resource Requests</span>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold tabular-nums">
                {pendingCount}
              </span>
            )}
          </button>
        </div>
        <span className="text-xs text-slate-500">Private Staff &amp; Admin Desk (Hidden from Parents &amp; Students)</span>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            <span>{feedback.text}</span>
          </span>
          <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {subTab === 'lesson-notes' ? (
        <LessonNotesStudio
          isAdminMode
          classes={classes.map((c) => ({ id: c.id, name: c.name }))}
          subjects={subjects.map((s) => ({ id: s.id, name: s.name }))}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 text-xs">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Staff Leave &amp; Resource Requests ({requests.length})</h3>
            <p className="text-slate-500 mt-0.5">
              Approve or decline staff requests submitted from the Dedicated Staff Workspace.
            </p>
          </div>

          {loadingRequests ? (
            <p className="py-10 text-center text-slate-400">Loading staff requests...</p>
          ) : requests.length === 0 ? (
            <p className="py-10 text-center text-slate-400">No staff requests submitted yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {requests.map((reqItem) => (
                <div key={reqItem.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{reqItem.subject}</p>
                      <p className="text-[11px] text-slate-500">
                        From: <strong className="text-slate-700">{reqItem.staff_name}</strong> · Type: {reqItem.request_type}
                        {reqItem.start_date
                          ? ` · ${reqItem.start_date}${reqItem.end_date ? ` to ${reqItem.end_date}` : ''}`
                          : ''}
                      </p>
                      <p className="text-slate-700 mt-1">{reqItem.details}</p>
                    </div>
                    <span
                      className={`font-bold shrink-0 ${
                        reqItem.status === 'APPROVED'
                          ? 'text-emerald-700'
                          : reqItem.status === 'DECLINED'
                          ? 'text-rose-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {reqItem.status}
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={responses[reqItem.id] ?? ''}
                      onChange={(e) => setResponses((prev) => ({ ...prev, [reqItem.id]: e.target.value }))}
                      placeholder="Administrative decision note..."
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleReviewRequest(reqItem.id, 'DECLINED')}
                        className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-xl font-bold cursor-pointer"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewRequest(reqItem.id, 'APPROVED')}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold cursor-pointer"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
