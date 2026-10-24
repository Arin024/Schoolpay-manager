import React, { useEffect, useState } from 'react';
import {
  Building2,
  Plus,
  Trash2,
  Users,
  GraduationCap,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  X,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { ClassItem, StaffItem } from '../../types/index.js';

export const SchoolClassesView: React.FC = () => {
  const { activeSchool } = useAuth();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isAddClassModalOpen, setIsAddClassModalOpen] = useState(false);
  const [isAddArmModalOpen, setIsAddArmModalOpen] = useState(false);
  const [selectedClassForArm, setSelectedClassForArm] = useState<ClassItem | null>(null);
  const [classToDelete, setClassToDelete] = useState<ClassItem | null>(null);

  // Form states
  const [newClassName, setNewClassName] = useState('');
  const [newClassLevel, setNewClassLevel] = useState('Primary');
  const [newClassDesc, setNewClassDesc] = useState('');
  const [newArmName, setNewArmName] = useState('Gold');
  const [newArmCapacity, setNewArmCapacity] = useState('35');
  const [newArmTeacherId, setNewArmTeacherId] = useState('');

  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    } catch (err) {
      console.error('Failed to load classes or staff:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);

    try {
      await api.createClass({
        name: newClassName,
        level: newClassLevel,
        description: newClassDesc,
      });
      setIsAddClassModalOpen(false);
      setNewClassName('');
      setNewClassDesc('');
      await loadData();
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
      await api.createClassArm(selectedClassForArm.id, {
        name: newArmName,
        capacity: parseInt(newArmCapacity) || 35,
        class_teacher_id: newArmTeacherId || undefined,
      });
      setIsAddArmModalOpen(false);
      setSelectedClassForArm(null);
      setNewArmName('');
      await loadData();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to add class arm');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteClass = async () => {
    if (!classToDelete) return;
    try {
      await api.deleteClass(classToDelete.id);
      setClassToDelete(null);
      await loadData();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete class');
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

        <button
          onClick={() => {
            setNewClassName('');
            setFormError(null);
            setIsAddClassModalOpen(true);
          }}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm self-start md:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Academic Class</span>
        </button>
      </div>

      {/* Classes Grid */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center text-xs text-slate-400 shadow-sm">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin mx-auto mb-2" />
          <span>Loading classes and arms...</span>
        </div>
      ) : classes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center space-y-3 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <p className="text-xs font-semibold text-slate-700">No classes configured for this school yet.</p>
          <button
            onClick={() => setIsAddClassModalOpen(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition"
          >
            Create First Class (e.g. JSS 1, SSS 1, Basic 1)
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map((cls) => (
            <div
              key={cls.id}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 space-y-4 hover:border-emerald-300 transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                    {cls.level}
                  </span>
                  <h3 className="text-base font-black text-slate-900 mt-1">{cls.name}</h3>
                  {cls.description && <p className="text-[11px] text-slate-400 mt-0.5">{cls.description}</p>}
                </div>
                <button
                  onClick={() => setClassToDelete(cls)}
                  className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
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
                    onClick={() => {
                      setSelectedClassForArm(cls);
                      setNewArmName('');
                      setFormError(null);
                      setIsAddArmModalOpen(true);
                    }}
                    className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Arm</span>
                  </button>
                </div>

                {!cls.arms || cls.arms.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic bg-slate-50 p-2.5 rounded-xl border border-dashed border-slate-200">
                    No streams created yet (e.g. A, B, Gold, Diamond).
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {cls.arms.map((arm) => (
                      <div
                        key={arm.id}
                        className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800">{arm.name}</span>
                            <span className="text-[10px] text-slate-500 font-semibold bg-white px-1.5 py-0.5 rounded border border-slate-200">
                              Cap: {arm.capacity}
                            </span>
                          </div>
                          {arm.class_teacher_name ? (
                            <p className="text-[10px] text-emerald-700 mt-0.5 flex items-center gap-1">
                              <UserCheck className="w-3 h-3" />
                              <span>Teacher: {arm.class_teacher_name}</span>
                            </p>
                          ) : (
                            <p className="text-[10px] text-slate-400 mt-0.5 italic">No class teacher assigned</p>
                          )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">Create Academic Class</h3>
              </div>
              <button
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
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base">Add Arm to {selectedClassForArm.name}</h3>
              </div>
              <button
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
                  Arm / Stream Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newArmName}
                  onChange={(e) => setNewArmName(e.target.value)}
                  placeholder="e.g. Gold, Diamond, A, Blue"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Max Capacity</label>
                <input
                  type="number"
                  min="1"
                  max="100"
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
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-60"
                >
                  {formSubmitting ? 'Saving...' : 'Add Arm'}
                </button>
              </div>
            </form>
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
                onClick={() => setClassToDelete(null)}
                className="w-full py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteClass}
                className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
