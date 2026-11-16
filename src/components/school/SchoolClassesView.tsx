import React, { useEffect, useState } from 'react';
import {
  Building2,
  Plus,
  Trash2,
  Edit2,
  Sparkles,
  Layers,
  AlertCircle,
  CheckCircle2,
  X,
  UserCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { ClassItem, ClassArmItem, StaffItem } from '../../types/index.js';

const ARM_QUICK_PRESETS = [
  { label: 'A, B', value: 'A, B' },
  { label: 'A, B, C', value: 'A, B, C' },
  { label: 'Gold, Silver', value: 'Gold, Silver' },
  { label: 'Diamond, Emerald', value: 'Diamond, Emerald' },
  { label: 'Science, Art, Commercial', value: 'Science, Art, Commercial' },
];

export const SchoolClassesView: React.FC = () => {
  const { activeSchool } = useAuth();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modals
  const [isAddClassModalOpen, setIsAddClassModalOpen] = useState(false);
  const [isAddArmModalOpen, setIsAddArmModalOpen] = useState(false);
  const [selectedClassForArm, setSelectedClassForArm] = useState<ClassItem | null>(null);
  const [classToDelete, setClassToDelete] = useState<ClassItem | null>(null);

  const [editingArm, setEditingArm] = useState<{ classItem: ClassItem; arm: ClassArmItem } | null>(null);
  const [armToDelete, setArmToDelete] = useState<{ classItem: ClassItem; arm: ClassArmItem } | null>(null);

  // Form states
  const [newClassName, setNewClassName] = useState('');
  const [newClassLevel, setNewClassLevel] = useState('Junior Secondary');
  const [newClassDesc, setNewClassDesc] = useState('');
  const [newClassArmsText, setNewClassArmsText] = useState('');

  const [newArmName, setNewArmName] = useState('Gold');
  const [newArmCapacity, setNewArmCapacity] = useState('40');
  const [newArmTeacherId, setNewArmTeacherId] = useState('');

  const [editArmName, setEditArmName] = useState('');
  const [editArmCapacity, setEditArmCapacity] = useState('40');
  const [editArmTeacherId, setEditArmTeacherId] = useState('');

  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [presetLoading, setPresetLoading] = useState(false);

  const handleLoadNigerianPreset = async (mode: 'SECONDARY' | 'PRIMARY' | 'K12') => {
    setPresetLoading(true);
    setStatusBanner(null);
    try {
      const res = await api.bulkSetupClasses(mode);
      await loadData();
      setStatusBanner({
        type: 'success',
        message: res.message || 'Nigerian classes and arms loaded successfully.',
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to apply Nigerian class preset.',
      });
    } finally {
      setPresetLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeSchool?.id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [classesRes, staffRes] = await Promise.all([
        api.getSchoolClasses(),
        api.getSchoolStaff(),
      ]);
      setClasses(classesRes.classes || []);
      setStaff(staffRes.staff || []);
    } catch (err: any) {
      console.error('Failed to load classes or staff:', err);
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to load classes and arms from database.',
      });
    } finally {
      setLoading(false);
    }
  };

  const openCreateClassModal = () => {
    setNewClassName('');
    setNewClassDesc('');
    setNewClassArmsText('');
    setFormError(null);
    setIsAddClassModalOpen(true);
  };

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await api.createClass({
        name: newClassName.trim(),
        level: newClassLevel,
        description: newClassDesc.trim(),
        arms: newClassArmsText.trim() || undefined,
      });
      setIsAddClassModalOpen(false);
      setNewClassName('');
      setNewClassDesc('');
      setNewClassArmsText('');
      await loadData();
      setStatusBanner({
        type: 'success',
        message: res.message || `Class "${newClassName.trim()}" created successfully.`,
      });
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create class');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleAddArm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassForArm) return;
    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await api.createClassArm(selectedClassForArm.id, {
        name: newArmName.trim(),
        capacity: parseInt(newArmCapacity, 10) || 40,
        class_teacher_id: newArmTeacherId || undefined,
      });
      setIsAddArmModalOpen(false);
      setSelectedClassForArm(null);
      setNewArmName('');
      setNewArmTeacherId('');
      await loadData();
      setStatusBanner({
        type: 'success',
        message: res.message || 'Class arm added successfully.',
      });
    } catch (err: any) {
      setFormError(err?.message || 'Failed to add class arm');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleUpdateArm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingArm) return;
    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await api.updateClassArm(editingArm.classItem.id, editingArm.arm.id, {
        name: editArmName.trim(),
        capacity: parseInt(editArmCapacity, 10) || 40,
        class_teacher_id: editArmTeacherId || null,
      });
      setEditingArm(null);
      await loadData();
      setStatusBanner({
        type: 'success',
        message: res.message || 'Class arm updated.',
      });
    } catch (err: any) {
      setFormError(err?.message || 'Failed to update class arm');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteArm = async () => {
    if (!armToDelete) return;
    setFormSubmitting(true);
    try {
      const res = await api.deleteClassArm(armToDelete.classItem.id, armToDelete.arm.id, true);
      setArmToDelete(null);
      await loadData();
      setStatusBanner({
        type: 'success',
        message: res.message || 'Class arm removed.',
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to remove class arm.',
      });
      setArmToDelete(null);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteClass = async () => {
    if (!classToDelete) return;
    setFormSubmitting(true);
    try {
      await api.deleteClass(classToDelete.id);
      setStatusBanner({
        type: 'success',
        message: `Class "${classToDelete.name}" moved to Recycle Bin.`,
      });
      setClassToDelete(null);
      await loadData();
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Failed to delete class.',
      });
      setClassToDelete(null);
    } finally {
      setFormSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-600" />
            <span>Classes &amp; Stream/Arm Structure</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure academic grade levels, streams (e.g. Gold, Diamond, A, B), capacities, and assigned class teachers for{' '}
            <strong className="text-slate-700">{activeSchool?.name}</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            disabled={presetLoading}
            onClick={() => {
              const t = String(activeSchool?.type || '').toLowerCase();
              const mode =
                t.includes('comprehensive') || t.includes('k-12')
                  ? 'K12'
                  : t.includes('primary') || t.includes('nursery')
                    ? 'PRIMARY'
                    : 'SECONDARY';
              handleLoadNigerianPreset(mode);
            }}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span>{presetLoading ? 'Setting up...' : 'Load Nigerian Classes'}</span>
          </button>
          <button
            type="button"
            onClick={openCreateClassModal}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Academic Class</span>
          </button>
        </div>
      </div>

      {/* Inline Status / Error Feedback */}
      {statusBanner && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{statusBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="p-1 rounded hover:bg-black/5 shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Classes Grid */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-xs text-slate-400 shadow-sm">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin mx-auto mb-2" />
          <span>Loading classes and arms...</span>
        </div>
      ) : classes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">No classes configured for this school yet.</p>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Quickly load Nigerian standard classes &amp; streams (JSS 1–3, SSS 1–3 Science/Art/Commercial, or Nursery &amp; Primary 1–6) in one click.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={presetLoading}
              onClick={() => handleLoadNigerianPreset('SECONDARY')}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-60"
            >
              {presetLoading ? 'Creating...' : 'Auto-Setup Secondary (JSS 1–3 & SSS 1–3)'}
            </button>
            <button
              type="button"
              disabled={presetLoading}
              onClick={() => handleLoadNigerianPreset('PRIMARY')}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-60"
            >
              Auto-Setup Nursery &amp; Primary 1–6
            </button>
            <button
              type="button"
              onClick={openCreateClassModal}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Create Custom Class
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map((cls) => (
            <div
              key={cls.id}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 space-y-4 hover:border-emerald-300 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                      {cls.level || 'General'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      <span>{cls.total_students || 0}</span>
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900 mt-1.5">{cls.name}</h3>
                  {cls.description && <p className="text-[11px] text-slate-400 mt-0.5">{cls.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => setClassToDelete(cls)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                  title="Delete Class"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Arms List */}
              <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px] text-slate-600 uppercase tracking-wider">
                    Arms / Streams ({cls.arms?.length || 0})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedClassForArm(cls);
                      setNewArmName('');
                      setNewArmCapacity('40');
                      setNewArmTeacherId('');
                      setFormError(null);
                      setIsAddArmModalOpen(true);
                    }}
                    className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-emerald-50 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Arm</span>
                  </button>
                </div>

                {!cls.arms || cls.arms.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic bg-slate-50 p-2.5 rounded-xl border border-dashed border-slate-200">
                    No streams created yet (e.g. A, B, Gold, Diamond). Click Add Arm above.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {cls.arms.map((arm) => (
                      <div
                        key={arm.id}
                        className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center flex-wrap gap-1.5">
                            <span className="font-bold text-slate-800">{arm.name}</span>
                            <span className="text-[10px] text-slate-500 font-semibold bg-white px-1.5 py-0.5 rounded border border-slate-200">
                              Cap: {arm.capacity}
                            </span>
                            {Number(arm.total_students || 0) > 0 && (
                              <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                {arm.total_students} student{Number(arm.total_students) === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                          {arm.class_teacher_name ? (
                            <p className="text-[10px] text-emerald-700 mt-0.5 flex items-center gap-1 truncate">
                              <UserCheck className="w-3 h-3 shrink-0" />
                              <span className="truncate">Teacher: {arm.class_teacher_name}</span>
                            </p>
                          ) : (
                            <p className="text-[10px] text-slate-400 mt-0.5 italic">No class teacher assigned</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingArm({ classItem: cls, arm });
                              setEditArmName(arm.name);
                              setEditArmCapacity(String(arm.capacity || 40));
                              setEditArmTeacherId(arm.class_teacher_id || '');
                              setFormError(null);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition cursor-pointer"
                            title="Edit Arm"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setArmToDelete({ classItem: cls, arm })}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                            title="Delete Arm"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADD CLASS MODAL */}
      {isAddClassModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs my-6">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">Create Academic Class</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddClassModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddClass} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Class Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  placeholder="e.g. JSS 1, SSS 2, Primary 4, Creche"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Grade Level</label>
                <select
                  value={newClassLevel}
                  onChange={(e) => setNewClassLevel(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="Early Years / Nursery">Early Years / Nursery</option>
                  <option value="Primary">Primary (Basic 1 - 6)</option>
                  <option value="Junior Secondary">Junior Secondary (JSS 1 - 3)</option>
                  <option value="Senior Secondary">Senior Secondary (SSS 1 - 3)</option>
                  <option value="Vocational / Other">Vocational / Other</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Initial Arms / Streams <span className="text-slate-400 font-normal">(Optional, comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={newClassArmsText}
                  onChange={(e) => setNewClassArmsText(e.target.value)}
                  placeholder="e.g. Gold, Silver or A, B, C"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {ARM_QUICK_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setNewClassArmsText(p.value)}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 text-[10px] font-semibold transition cursor-pointer"
                    >
                      + {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={newClassDesc}
                  onChange={(e) => setNewClassDesc(e.target.value)}
                  placeholder="e.g. Upper basic junior class"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddClassModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60 cursor-pointer"
                >
                  {formSubmitting ? 'Creating...' : 'Create Class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD ARM MODAL */}
      {isAddArmModalOpen && selectedClassForArm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs my-6">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">Add Arm to {selectedClassForArm.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddArmModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddArm} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Arm / Stream Name(s) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newArmName}
                  onChange={(e) => setNewArmName(e.target.value)}
                  placeholder="e.g. Gold or Gold, Silver, Diamond"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Tip: Separate multiple arms with commas (e.g. <span className="font-mono">A, B, C</span>) to add them all at once.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {ARM_QUICK_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setNewArmName(p.value)}
                      className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 text-[10px] font-semibold transition cursor-pointer"
                    >
                      + {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Max Capacity</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={newArmCapacity}
                  onChange={(e) => setNewArmCapacity(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assign Class Teacher (Optional)</label>
                <select
                  value={newArmTeacherId}
                  onChange={(e) => setNewArmTeacherId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="">No Teacher Assigned</option>
                  {staff.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.first_name} {st.last_name} ({st.job_title})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddArmModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60 cursor-pointer"
                >
                  {formSubmitting ? 'Saving...' : 'Add Arm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT ARM MODAL */}
      {editingArm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm">
                  Edit Arm · {editingArm.classItem.name} ({editingArm.arm.name})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingArm(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateArm} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Arm / Stream Name *</label>
                <input
                  type="text"
                  required
                  value={editArmName}
                  onChange={(e) => setEditArmName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Max Capacity</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={editArmCapacity}
                  onChange={(e) => setEditArmCapacity(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assigned Class Teacher</label>
                <select
                  value={editArmTeacherId}
                  onChange={(e) => setEditArmTeacherId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  <option value="">No Teacher Assigned</option>
                  {staff.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.first_name} {st.last_name} ({st.job_title})
                    </option>
                  ))}
                </select>
              </div>
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingArm(null)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60 cursor-pointer"
                >
                  {formSubmitting ? 'Saving...' : 'Save Arm Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE ARM MODAL */}
      {armToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4 text-xs">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-700 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-bold text-sm text-slate-900">
                Remove Arm: {armToDelete.classItem.name} — {armToDelete.arm.name}
              </h3>
              <p className="text-slate-500">
                {Number(armToDelete.arm.total_students || 0) > 0
                  ? `${armToDelete.arm.total_students} student(s) in this arm will stay in ${armToDelete.classItem.name} without an arm assigned.`
                  : 'Are you sure you want to remove this class arm?'}
              </p>
            </div>
            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setArmToDelete(null)}
                className="w-full py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={formSubmitting}
                onClick={handleDeleteArm}
                className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold cursor-pointer"
              >
                {formSubmitting ? 'Removing...' : 'Confirm Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE CLASS MODAL */}
      {classToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4 text-xs">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-700 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-bold text-sm text-slate-900">Delete Class: {classToDelete.name}</h3>
              <p className="text-slate-500">
                Are you sure you want to delete this class? This will also remove any arms under it.
              </p>
            </div>
            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setClassToDelete(null)}
                className="w-full py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={formSubmitting}
                onClick={handleDeleteClass}
                className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold cursor-pointer"
              >
                {formSubmitting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
