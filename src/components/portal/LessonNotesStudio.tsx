import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Edit2,
  FileText,
  Printer,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { LessonNoteItem, LessonNoteStatus } from '../../types/index.js';

interface LessonNotesStudioProps {
  isAdminMode?: boolean;
  classes?: Array<{ id?: string; name: string }>;
  subjects?: Array<{ id?: string; name: string }>;
}

const STATUS_LABELS: Record<LessonNoteStatus, { text: string; tone: string }> = {
  DRAFT: { text: 'Draft', tone: 'text-slate-600' },
  SUBMITTED: { text: 'Submitted for Review', tone: 'text-amber-700' },
  APPROVED: { text: 'Approved by Admin', tone: 'text-emerald-700' },
  REVISION_REQUESTED: { text: 'Revision Requested', tone: 'text-rose-700' },
};

export const LessonNotesStudio: React.FC<LessonNotesStudioProps> = ({
  isAdminMode = false,
  classes = [],
  subjects = [],
}) => {
  const { activeSchool } = useAuth();
  const [notes, setNotes] = useState<LessonNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Generator + Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    subject_name: '',
    class_name: '',
    term_name: '1st Term',
    week_number: 1,
    duration_minutes: 40,
    topic: '',
    sub_topic: '',
    behavioural_objectives: '',
    previous_knowledge: '',
    instructional_materials: '',
    introduction_step: '',
    presentation_steps: '',
    evaluation_questions: '',
    assignment_text: '',
    teacher_notes: '',
  });

  // Printable Preview & Admin Review Modal
  const [previewNote, setPreviewNote] = useState<LessonNoteItem | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const loadNotes = async (filter = statusFilter) => {
    setLoading(true);
    try {
      const res = await api.getLessonNotes(filter === 'ALL' ? undefined : filter);
      setNotes(res.lessonNotes || []);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to load lesson notes' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes(statusFilter);
  }, [activeSchool?.id, statusFilter]);

  const resetForm = () => {
    setEditingNoteId(null);
    setForm({
      subject_name: subjects[0]?.name || '',
      class_name: classes[0]?.name || '',
      term_name: '1st Term',
      week_number: 1,
      duration_minutes: 40,
      topic: '',
      sub_topic: '',
      behavioural_objectives: '',
      previous_knowledge: '',
      instructional_materials: '',
      introduction_step: '',
      presentation_steps: '',
      evaluation_questions: '',
      assignment_text: '',
      teacher_notes: '',
    });
  };

  const handleGenerateNerdcDraft = async () => {
    if (!form.subject_name.trim() || !form.class_name.trim() || !form.topic.trim()) {
      setFeedback({
        type: 'err',
        text: 'Enter Subject, Class, and Lesson Topic before generating a Nigerian NERDC Lesson Plan.',
      });
      return;
    }
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await api.generateLessonNoteDraft({
        subject_name: form.subject_name.trim(),
        class_name: form.class_name.trim(),
        term_name: form.term_name,
        week_number: Number(form.week_number) || 1,
        duration_minutes: Number(form.duration_minutes) || 40,
        topic: form.topic.trim(),
        sub_topic: form.sub_topic.trim() || undefined,
      });
      const d = res.draft || {};
      setForm((prev) => ({
        ...prev,
        behavioural_objectives: d.behavioural_objectives || prev.behavioural_objectives,
        previous_knowledge: d.previous_knowledge || prev.previous_knowledge,
        instructional_materials: d.instructional_materials || prev.instructional_materials,
        introduction_step: d.introduction_step || prev.introduction_step,
        presentation_steps: d.presentation_steps || prev.presentation_steps,
        evaluation_questions: d.evaluation_questions || prev.evaluation_questions,
        assignment_text: d.assignment_text || prev.assignment_text,
        teacher_notes: d.teacher_notes || prev.teacher_notes,
      }));
      setEditorOpen(true);
      setFeedback({
        type: 'ok',
        text: res.message || 'NERDC-aligned Nigerian lesson note generated. Review, edit, or submit to Principal.',
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to generate lesson plan draft.' });
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveNote = async (targetStatus: 'DRAFT' | 'SUBMITTED') => {
    if (!form.subject_name.trim() || !form.class_name.trim() || !form.topic.trim()) {
      setFeedback({ type: 'err', text: 'Subject, Class, and Topic are required.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const payload: Partial<LessonNoteItem> = {
        ...form,
        week_number: Number(form.week_number) || 1,
        duration_minutes: Number(form.duration_minutes) || 40,
        status: targetStatus,
      };
      if (editingNoteId) {
        await api.updateLessonNote(editingNoteId, payload);
        setFeedback({
          type: 'ok',
          text:
            targetStatus === 'SUBMITTED'
              ? 'Lesson note updated and submitted to School Administration.'
              : 'Lesson note draft updated.',
        });
      } else {
        await api.createLessonNote(payload);
        setFeedback({
          type: 'ok',
          text:
            targetStatus === 'SUBMITTED'
              ? 'Lesson note submitted to Principal/Admin for review.'
              : 'Lesson note saved to drafts.',
        });
      }
      setEditorOpen(false);
      resetForm();
      await loadNotes(statusFilter);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to save lesson note.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNote = async (id: string) => {
    try {
      await api.deleteLessonNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setFeedback({ type: 'ok', text: 'Lesson note removed.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Could not delete lesson note.' });
    }
  };

  const handleAdminReview = async (
    id: string,
    decision: 'APPROVED' | 'REVISION_REQUESTED'
  ) => {
    setReviewing(true);
    setFeedback(null);
    try {
      const res = await api.reviewLessonNote(id, {
        status: decision,
        admin_feedback: reviewComment.trim(),
      });
      setPreviewNote(res.lessonNote);
      setNotes((prev) => prev.map((n) => (n.id === id ? res.lessonNote : n)));
      setFeedback({
        type: 'ok',
        text: decision === 'APPROVED' ? 'Lesson note approved.' : 'Revision feedback sent to staff member.',
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to submit review.' });
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Header & NERDC Lesson Note Generator Strip */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-600" />
              <span>
                {isAdminMode
                  ? 'Staff Lesson Notes & NERDC Curriculum Review Desk'
                  : 'Nigerian NERDC Lesson Notes & Lesson Plan Studio'}
              </span>
            </h3>
            <p className="text-slate-500 mt-0.5">
              {isAdminMode
                ? 'Review, approve, or request revisions on submitted staff lesson plans. Strictly hidden from parents and students.'
                : 'Auto-generate structured NERDC-aligned lesson notes or author your own weekly notes and submit to Principal/Admin for approval.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!editorOpen) resetForm();
              setEditorOpen((prev) => !prev);
            }}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer self-start whitespace-nowrap shrink-0"
          >
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>{editorOpen ? 'Hide Lesson Editor' : 'Write / Generate Lesson Note'}</span>
          </button>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          {(
            [
              { key: 'ALL', label: 'All Lesson Notes' },
              { key: 'DRAFT', label: 'Drafts' },
              { key: 'SUBMITTED', label: 'Submitted' },
              { key: 'APPROVED', label: 'Approved' },
              { key: 'REVISION_REQUESTED', label: 'Revision Requested' },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                statusFilter === f.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between ${
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
          <button type="button" onClick={() => setFeedback(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Structured Lesson Plan Generator + Editor */}
      {editorOpen && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                {editingNoteId ? 'Edit Lesson Note' : 'New Nigerian NERDC Lesson Plan'}
              </h4>
              <p className="text-slate-500 mt-0.5">
                Fill Subject, Class, and Topic, then click Auto-Generate NERDC Plan or write manually below.
              </p>
            </div>
            <button
              type="button"
              disabled={generating}
              onClick={handleGenerateNerdcDraft}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-4 h-4" />
              <span>{generating ? 'Generating Plan...' : 'Auto-Generate NERDC Lesson Plan'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Subject *</label>
              <input
                type="text"
                list="nerdc-subject-options"
                value={form.subject_name}
                onChange={(e) => setForm({ ...form, subject_name: e.target.value })}
                placeholder="e.g. Basic Science or Mathematics"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
              <datalist id="nerdc-subject-options">
                {subjects.map((s) => (
                  <option key={s.id || s.name} value={s.name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Class *</label>
              <input
                type="text"
                list="nerdc-class-options"
                value={form.class_name}
                onChange={(e) => setForm({ ...form, class_name: e.target.value })}
                placeholder="e.g. JSS 2 or SSS 1"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
              <datalist id="nerdc-class-options">
                {classes.map((c) => (
                  <option key={c.id || c.name} value={c.name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Term</label>
              <select
                value={form.term_name}
                onChange={(e) => setForm({ ...form, term_name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              >
                <option value="1st Term">1st Term</option>
                <option value="2nd Term">2nd Term</option>
                <option value="3rd Term">3rd Term</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Week (1–14)</label>
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={form.week_number}
                  onChange={(e) => setForm({ ...form, week_number: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Duration (mins)</label>
                <input
                  type="number"
                  min={15}
                  max={180}
                  value={form.duration_minutes}
                  onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Topic *</label>
              <input
                type="text"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="e.g. Quadratic Equations by Factorization"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Sub-Topic (Optional)</label>
              <input
                type="text"
                value={form.sub_topic}
                onChange={(e) => setForm({ ...form, sub_topic: e.target.value })}
                placeholder="e.g. Solving Word Problems Leading to Quadratic Equations"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Behavioural Objectives</label>
              <textarea
                rows={3}
                value={form.behavioural_objectives}
                onChange={(e) => setForm({ ...form, behavioural_objectives: e.target.value })}
                placeholder="By the end of the lesson, learners should be able to..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Previous Knowledge &amp; Instructional Materials</label>
              <textarea
                rows={3}
                value={form.previous_knowledge}
                onChange={(e) => setForm({ ...form, previous_knowledge: e.target.value })}
                placeholder="Entry behaviour and previous lesson foundation..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Instructional Materials / Teaching Aids</label>
              <textarea
                rows={2}
                value={form.instructional_materials}
                onChange={(e) => setForm({ ...form, instructional_materials: e.target.value })}
                placeholder="NERDC approved textbook, charts, chalkboard/whiteboard..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Step I: Introduction / Set Induction</label>
              <textarea
                rows={2}
                value={form.introduction_step}
                onChange={(e) => setForm({ ...form, introduction_step: e.target.value })}
                placeholder="How the teacher connects previous knowledge to today's topic..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Steps II–V: Lesson Presentation &amp; Teacher/Learner Activities</label>
              <textarea
                rows={5}
                value={form.presentation_steps}
                onChange={(e) => setForm({ ...form, presentation_steps: e.target.value })}
                placeholder="Step-by-step teacher explanations, worked examples, and class board notes..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Evaluation Questions</label>
              <textarea
                rows={3}
                value={form.evaluation_questions}
                onChange={(e) => setForm({ ...form, evaluation_questions: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Assignment / Homework</label>
              <textarea
                rows={3}
                value={form.assignment_text}
                onChange={(e) => setForm({ ...form, assignment_text: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveNote('DRAFT')}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold cursor-pointer disabled:opacity-60"
            >
              Save as Draft
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveNote('SUBMITTED')}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Submit to Principal / Admin'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Lesson Notes Registry */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h4 className="text-sm font-bold text-slate-900 mb-4">Lesson Notes Register ({notes.length})</h4>
        {loading ? (
          <p className="py-10 text-center text-slate-400">Loading lesson notes...</p>
        ) : notes.length === 0 ? (
          <p className="py-10 text-center text-slate-400">
            No lesson notes match this filter yet. Click &ldquo;Write / Generate Lesson Note&rdquo; above to create one.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {notes.map((note) => {
              const stMeta = STATUS_LABELS[note.status] || STATUS_LABELS.DRAFT;
              return (
                <div key={note.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-bold text-slate-800">{note.subject_name}</span>
                      <span aria-hidden="true">·</span>
                      <span>{note.class_name}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {note.term_name || '1st Term'} · Week {note.week_number}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-bold ${stMeta.tone}`}>{stMeta.text}</span>
                    </div>
                    <p className="text-sm font-bold text-slate-900">{note.topic}</p>
                    <p className="text-[11px] text-slate-500">
                      Prepared by: <strong className="text-slate-700">{note.teacher_name || 'Staff Member'}</strong>
                      {note.admin_feedback ? ` · Principal Note: ${note.admin_feedback}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewNote(note);
                        setReviewComment(note.admin_feedback || '');
                      }}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{isAdminMode ? 'Open & Review' : 'View / Print'}</span>
                    </button>

                    {note.status !== 'APPROVED' && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNoteId(note.id);
                          setForm({
                            subject_name: note.subject_name,
                            class_name: note.class_name,
                            term_name: note.term_name || '1st Term',
                            week_number: note.week_number || 1,
                            duration_minutes: note.duration_minutes || 40,
                            topic: note.topic,
                            sub_topic: note.sub_topic || '',
                            behavioural_objectives: note.behavioural_objectives || '',
                            previous_knowledge: note.previous_knowledge || '',
                            instructional_materials: note.instructional_materials || '',
                            introduction_step: note.introduction_step || '',
                            presentation_steps: note.presentation_steps || '',
                            evaluation_questions: note.evaluation_questions || '',
                            assignment_text: note.assignment_text || '',
                            teacher_notes: note.teacher_notes || '',
                          });
                          setEditorOpen(true);
                        }}
                        className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg cursor-pointer"
                        aria-label="Edit lesson note"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}

                    {(isAdminMode || note.status !== 'APPROVED') && (
                      <button
                        type="button"
                        onClick={() => handleDeleteNote(note.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer"
                        aria-label="Delete lesson note"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Printable Preview & Admin Review Modal */}
      {previewNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200">
            <div className="sticky top-0 bg-slate-900 px-5 py-4 text-white flex items-center justify-between gap-4 print:hidden">
              <div>
                <h3 className="font-bold text-sm">{previewNote.topic}</h3>
                <p className="text-[11px] text-slate-300">
                  {previewNote.subject_name} · {previewNote.class_name} · Week {previewNote.week_number} ({previewNote.duration_minutes} mins)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Note</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewNote(null)}
                  className="p-1.5 text-slate-400 hover:text-white cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5 text-xs">
              <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-base font-black text-slate-900">{activeSchool?.name || 'School Lesson Note'}</p>
                  <p className="text-slate-600">
                    Prepared by {previewNote.teacher_name || 'Teacher'} · {previewNote.term_name || '1st Term'} · Week {previewNote.week_number}
                  </p>
                </div>
                <p className="font-bold text-slate-800">
                  Status: {STATUS_LABELS[previewNote.status]?.text || previewNote.status}
                </p>
              </div>

              {previewNote.behavioural_objectives && (
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 uppercase tracking-wide text-[11px]">Behavioural Objectives</p>
                  <p className="text-slate-700 whitespace-pre-line leading-relaxed">{previewNote.behavioural_objectives}</p>
                </div>
              )}

              {previewNote.previous_knowledge && (
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 uppercase tracking-wide text-[11px]">Previous Knowledge</p>
                  <p className="text-slate-700 whitespace-pre-line leading-relaxed">{previewNote.previous_knowledge}</p>
                </div>
              )}

              {previewNote.instructional_materials && (
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 uppercase tracking-wide text-[11px]">Instructional Materials</p>
                  <p className="text-slate-700 whitespace-pre-line leading-relaxed">{previewNote.instructional_materials}</p>
                </div>
              )}

              {previewNote.introduction_step && (
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 uppercase tracking-wide text-[11px]">Introduction</p>
                  <p className="text-slate-700 whitespace-pre-line leading-relaxed">{previewNote.introduction_step}</p>
                </div>
              )}

              {previewNote.presentation_steps && (
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 uppercase tracking-wide text-[11px]">Presentation Steps</p>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 whitespace-pre-line leading-relaxed">
                    {previewNote.presentation_steps}
                  </div>
                </div>
              )}

              {previewNote.evaluation_questions && (
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 uppercase tracking-wide text-[11px]">Evaluation Questions</p>
                  <p className="text-slate-700 whitespace-pre-line leading-relaxed">{previewNote.evaluation_questions}</p>
                </div>
              )}

              {previewNote.assignment_text && (
                <div className="space-y-1">
                  <p className="font-bold text-slate-900 uppercase tracking-wide text-[11px]">Assignment</p>
                  <p className="text-slate-700 whitespace-pre-line leading-relaxed">{previewNote.assignment_text}</p>
                </div>
              )}

              {isAdminMode && (
                <div className="pt-4 border-t border-slate-200 space-y-3 print:hidden">
                  <p className="font-bold text-slate-900">Principal / Admin Review Decision</p>
                  <textarea
                    rows={2}
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Optional commendation or revision instructions for teacher..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={reviewing}
                      onClick={() => handleAdminReview(previewNote.id, 'REVISION_REQUESTED')}
                      className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-xl font-bold cursor-pointer"
                    >
                      Request Revision
                    </button>
                    <button
                      type="button"
                      disabled={reviewing}
                      onClick={() => handleAdminReview(previewNote.id, 'APPROVED')}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold cursor-pointer"
                    >
                      Approve Lesson Note
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
