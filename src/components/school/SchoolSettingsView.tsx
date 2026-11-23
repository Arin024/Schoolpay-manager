import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Save,
  CheckCircle2,
  AlertCircle,
  GraduationCap,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import {
  AcademicCycleType,
  GradingMode,
  INSTITUTION_PRESETS,
  InstitutionCategory,
  InstitutionTerminology,
  getDefaultCycleLabels,
  getDefaultTerminologyForType,
  resolveInstitutionProfile,
} from '../../utils/institutionMode.js';

export const SchoolSettingsView: React.FC = () => {
  const { activeSchool, activeSettings, activeSchoolId, activeRole, setActiveSettings, refreshMe } = useAuth();

  const resolvedInitial = resolveInstitutionProfile(activeSchool, activeSettings);

  const [formData, setFormData] = useState({
    current_academic_session: activeSettings?.current_academic_session || '2025/2026',
    current_term: activeSettings?.current_term || resolvedInitial.cycleLabels[0] || '1st Term',
    payment_notification_email: activeSettings?.payment_notification_email || '',
    payment_notification_sms: activeSettings?.payment_notification_sms === 1,
    allow_partial_payments: activeSettings?.allow_partial_payments !== 0,
    institution_category: resolvedInitial.category as InstitutionCategory,
    academic_cycle_type: resolvedInitial.cycleType as AcademicCycleType,
    cycle_labels_text: resolvedInitial.cycleLabels.join(', '),
    grading_mode: resolvedInitial.gradingMode as GradingMode,
    terminology: { ...resolvedInitial.labels } as InstitutionTerminology,
  });

  const [showCustomTerminology, setShowCustomTerminology] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canEdit = ['SCHOOL_OWNER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(activeRole?.role_name || '');

  // Synchronize formData whenever activeSettings loads or changes
  useEffect(() => {
    if (activeSettings) {
      const profile = resolveInstitutionProfile(activeSchool, activeSettings);
      setFormData({
        current_academic_session: activeSettings.current_academic_session || '2025/2026',
        current_term: activeSettings.current_term || profile.cycleLabels[0] || '1st Term',
        payment_notification_email: activeSettings.payment_notification_email || '',
        payment_notification_sms: activeSettings.payment_notification_sms === 1,
        allow_partial_payments: activeSettings.allow_partial_payments !== 0,
        institution_category: profile.category,
        academic_cycle_type: profile.cycleType,
        cycle_labels_text: profile.cycleLabels.join(', '),
        grading_mode: profile.gradingMode,
        terminology: { ...profile.labels },
      });
    }
  }, [activeSettings, activeSchool]);

  // Fetch authoritative settings on mount or when active school ID switches
  useEffect(() => {
    if (activeSchoolId) {
      api
        .getSchoolSettings(activeSchoolId)
        .then((res) => {
          if (res.settings) {
            setActiveSettings(res.settings);
          }
        })
        .catch((err) => {
          console.warn('Could not fetch authoritative school settings:', err?.message || err);
        });
    }
  }, [activeSchoolId]);

  const parsedCycleLabels = formData.cycle_labels_text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const effectiveCycleOptions =
    parsedCycleLabels.length > 0
      ? parsedCycleLabels
      : getDefaultCycleLabels(formData.academic_cycle_type);

  // Ensure active current_term stays selectable even if it is an older value
  const selectableTerms = effectiveCycleOptions.includes(formData.current_term)
    ? effectiveCycleOptions
    : [formData.current_term, ...effectiveCycleOptions].filter(Boolean);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target;
    const value = target.type === 'checkbox' ? (target as HTMLInputElement).checked : target.value;
    setFormData((prev) => {
      const next = { ...prev, [target.name]: value };
      if (target.name === 'academic_cycle_type') {
        const nextType = value as AcademicCycleType;
        const defaultCycles = getDefaultCycleLabels(nextType);
        next.cycle_labels_text = defaultCycles.join(', ');
        next.current_term = defaultCycles[0];
        next.terminology = {
          ...prev.terminology,
          cycle: nextType === 'SEMESTER' ? 'Semester' : nextType === 'TRIMESTER' ? 'Trimester' : 'Term',
          cyclePlural: nextType === 'SEMESTER' ? 'Semesters' : nextType === 'TRIMESTER' ? 'Trimesters' : 'Terms',
        };
      }
      if (target.name === 'institution_category') {
        const nextCat = value as InstitutionCategory;
        const defaults = getDefaultTerminologyForType(
          activeSchool?.type,
          nextCat,
          nextCat === 'TERTIARY' ? 'SEMESTER' : 'TERM'
        );
        if (nextCat === 'TERTIARY' && prev.academic_cycle_type === 'TERM') {
          next.academic_cycle_type = 'SEMESTER';
          next.cycle_labels_text = '1st Semester, 2nd Semester';
          next.current_term = '1st Semester';
          if (prev.grading_mode === 'PERCENTAGE') {
            next.grading_mode = 'GPA_5';
          }
        }
        next.terminology = defaults;
      }
      return next;
    });
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const applyPreset = (presetKey: keyof typeof INSTITUTION_PRESETS) => {
    if (!canEdit) return;
    const preset = INSTITUTION_PRESETS[presetKey];
    setFormData((prev) => ({
      ...prev,
      institution_category: preset.institution_category,
      academic_cycle_type: preset.academic_cycle_type,
      cycle_labels_text: preset.cycle_labels.join(', '),
      current_term: preset.cycle_labels[0],
      grading_mode: preset.grading_mode,
      terminology: { ...preset.terminology },
    }));
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const handleTerminologyChange = (key: keyof InstitutionTerminology, val: string) => {
    setFormData((prev) => ({
      ...prev,
      terminology: {
        ...prev.terminology,
        [key]: val,
      },
    }));
    setSuccessMsg(null);
  };

  const resetTerminologyToDefaults = () => {
    const defaults = getDefaultTerminologyForType(
      activeSchool?.type,
      formData.institution_category,
      formData.academic_cycle_type
    );
    setFormData((prev) => ({ ...prev, terminology: defaults }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSchoolId) return;

    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const cycleLabelsArray =
        parsedCycleLabels.length > 0
          ? parsedCycleLabels
          : getDefaultCycleLabels(formData.academic_cycle_type);

      const res = await api.updateSchoolSettings(activeSchoolId, {
        current_academic_session: formData.current_academic_session,
        current_term: formData.current_term,
        payment_notification_email: formData.payment_notification_email,
        payment_notification_sms: formData.payment_notification_sms ? 1 : 0,
        allow_partial_payments: formData.allow_partial_payments ? 1 : 0,
        institution_category: formData.institution_category,
        academic_cycle_type: formData.academic_cycle_type,
        cycle_labels_json: JSON.stringify(cycleLabelsArray),
        grading_mode: formData.grading_mode,
        terminology_json: JSON.stringify(formData.terminology),
      } as any);

      setSuccessMsg(res.message || 'Institutional settings updated successfully.');
      setActiveSettings(res.settings);
      await refreshMe();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update institutional settings');
    } finally {
      setLoading(false);
    }
  };

  const terminologyFields: Array<{ key: keyof InstitutionTerminology; label: string; placeholder: string }> = [
    { key: 'institution', label: 'Institution Word', placeholder: 'School / University / Polytechnic' },
    { key: 'cycle', label: 'Academic Period (Singular)', placeholder: 'Term / Semester / Trimester' },
    { key: 'cyclePlural', label: 'Academic Period (Plural)', placeholder: 'Terms / Semesters / Trimesters' },
    { key: 'classLabel', label: 'Level / Class Label', placeholder: 'Class / Level / Programme' },
    { key: 'armLabel', label: 'Arm / Department Label', placeholder: 'Arm / Department / Option' },
    { key: 'subject', label: 'Subject / Course (Singular)', placeholder: 'Subject / Course' },
    { key: 'subjectPlural', label: 'Subject / Course (Plural)', placeholder: 'Subjects / Courses' },
    { key: 'studentId', label: 'Student ID Label', placeholder: 'Admission Number / Matric Number' },
    { key: 'staff', label: 'Educator Label', placeholder: 'Teacher / Lecturer' },
    { key: 'parent', label: 'Guardian / Sponsor Label', placeholder: 'Parent / Guardian / Sponsor' },
    { key: 'head', label: 'Head Signatory Title', placeholder: 'Principal / Registrar / Provost' },
    { key: 'report', label: 'Result Document Title', placeholder: 'Report Card / Semester Result / Transcript' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-600" />
            <span>Institutional Mode, Academic Calendar &amp; Bursary Settings</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure K-12 Terms or Higher Institution Semesters, NUC/NBTE GPA/CGPA grading, custom portal terminology, and payment rules.
          </p>
        </div>
        {!canEdit && (
          <span className="text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 font-medium self-start">
            Read-Only Access
          </span>
        )}
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* 1-Click Institutional Presets */}
        <div className="p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-emerald-600 shrink-0" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Quick Institutional Presets (One-Click Customization)
              </h3>
            </div>
            <span className="text-[11px] text-slate-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Non-destructive — existing students, fees &amp; scores remain untouched
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(Object.keys(INSTITUTION_PRESETS) as Array<keyof typeof INSTITUTION_PRESETS>).map((key) => {
              const preset = INSTITUTION_PRESETS[key];
              const isSelected =
                formData.institution_category === preset.institution_category &&
                formData.academic_cycle_type === preset.academic_cycle_type &&
                formData.grading_mode === preset.grading_mode &&
                formData.cycle_labels_text.trim().toLowerCase() === preset.cycle_labels.join(', ').toLowerCase();

              return (
                <button
                  key={key}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => applyPreset(key)}
                  className={`px-3 py-2.5 rounded-lg border text-left text-xs transition cursor-pointer disabled:opacity-60 ${
                    isSelected
                      ? 'bg-emerald-50 border-emerald-600 text-emerald-950 font-bold ring-1 ring-emerald-600'
                      : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700 font-medium'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate">{preset.label}</span>
                    {isSelected && <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Core Academic Mode & Calendar Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Institution Mode
            </label>
            <select
              name="institution_category"
              disabled={!canEdit}
              value={formData.institution_category}
              onChange={handleChange}
              className="w-full mt-1 px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="K12">Basic &amp; Secondary School (K-12)</option>
              <option value="TERTIARY">Higher Institution / Tertiary</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Adapts navigation, levels/departments, courses, matric numbers &amp; transcripts.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Academic Calendar Cycle
            </label>
            <select
              name="academic_cycle_type"
              disabled={!canEdit}
              value={formData.academic_cycle_type}
              onChange={handleChange}
              className="w-full mt-1 px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="TERM">Terms (3 Terms per Session)</option>
              <option value="SEMESTER">Semesters (2 Semesters per Session)</option>
              <option value="TRIMESTER">Trimesters (3 Trimesters per Session)</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Controls session schedules, billing periods, and result cycles.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Result &amp; Transcript Grading Engine
            </label>
            <select
              name="grading_mode"
              disabled={!canEdit}
              value={formData.grading_mode}
              onChange={handleChange}
              className="w-full mt-1 px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="PERCENTAGE">Percentage Average (0–100%)</option>
              <option value="GPA_5">5.00 GPA / CGPA (NUC University &amp; College)</option>
              <option value="GPA_4">4.00 GPA / CGPA (NBTE Polytechnic)</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-1.5">
              GPA modes automatically compute Credit Units, Quality Points &amp; Class Standing.
            </p>
          </div>
        </div>

        {/* Custom Cycle Names & Active Session / Period */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="sm:col-span-2 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Custom {formData.terminology.cyclePlural} Names (comma-separated)
            </label>
            <input
              type="text"
              name="cycle_labels_text"
              disabled={!canEdit}
              value={formData.cycle_labels_text}
              onChange={handleChange}
              placeholder="e.g. Harmattan Semester, Rain Semester or 1st Term, 2nd Term, 3rd Term"
              className="w-full mt-1 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Examples: <span className="font-mono text-slate-700">Harmattan Semester, Rain Semester</span> ·{' '}
              <span className="font-mono text-slate-700">1st Semester, 2nd Semester, Summer Semester</span> ·{' '}
              <span className="font-mono text-slate-700">1st Term, 2nd Term, 3rd Term</span>
            </p>
          </div>

          {/* Academic Session */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Current Academic Session
            </label>
            <select
              name="current_academic_session"
              disabled={!canEdit}
              value={formData.current_academic_session}
              onChange={handleChange}
              className="w-full mt-1.5 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="2023/2024">2023/2024 Session</option>
              <option value="2024/2025">2024/2025 Session</option>
              <option value="2025/2026">2025/2026 Session</option>
              <option value="2026/2027">2026/2027 Session</option>
              <option value="2027/2028">2027/2028 Session</option>
            </select>
          </div>

          {/* Active Term / Semester */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Active {formData.terminology.cycle}
            </label>
            <select
              name="current_term"
              disabled={!canEdit}
              value={formData.current_term}
              onChange={handleChange}
              className="w-full mt-1.5 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              {selectableTerms.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Base Currency */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Base Settlement Currency
            </label>
            <div className="flex items-center gap-2 mt-2">
              <span className="px-3 py-1.5 bg-emerald-600 text-white font-bold rounded-lg text-sm">
                ₦ NGN
              </span>
              <span className="text-xs text-slate-500">
                Nigerian Naira (Multi-tenant standard)
              </span>
            </div>
          </div>

          {/* Bursar Notification Email */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Bursary Alert Notification Email
            </label>
            <input
              type="email"
              name="payment_notification_email"
              disabled={!canEdit}
              value={formData.payment_notification_email}
              onChange={handleChange}
              placeholder="e.g. bursary@institution.edu.ng"
              className="w-full mt-1.5 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Expandable Custom Portal Terminology Editor */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowCustomTerminology((v) => !v)}
            className="w-full px-4 py-3.5 bg-slate-50 hover:bg-slate-100/80 flex items-center justify-between text-left transition cursor-pointer"
          >
            <div>
              <span className="text-xs font-bold text-slate-900 block">
                Customize Portal Terminology (Advanced)
              </span>
              <span className="text-[11px] text-slate-500">
                Currently using: <strong className="text-slate-700">{formData.terminology.cycle}</strong> ·{' '}
                <strong className="text-slate-700">{formData.terminology.classLabel}</strong> ·{' '}
                <strong className="text-slate-700">{formData.terminology.subjectPlural}</strong> ·{' '}
                <strong className="text-slate-700">{formData.terminology.studentId}</strong>
              </span>
            </div>
            {showCustomTerminology ? (
              <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
            )}
          </button>

          {showCustomTerminology && (
            <div className="p-4 sm:p-5 bg-white border-t border-slate-200 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  Rename any academic label across Admin, Staff, Student, Parent portals, and official transcripts.
                </p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={resetTerminologyToDefaults}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-emerald-700 px-2.5 py-1 rounded-lg border border-slate-200 hover:border-emerald-300 cursor-pointer shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Defaults</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {terminologyFields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {field.label}
                    </label>
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={formData.terminology[field.key] || ''}
                      onChange={(e) => handleTerminologyChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-lg focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Financial Toggles */}
        <div className="space-y-3 pt-1">
          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              name="allow_partial_payments"
              disabled={!canEdit}
              checked={formData.allow_partial_payments}
              onChange={handleChange}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
            />
            <div>
              <span className="text-xs font-bold text-slate-900 block">Allow Installmental / Partial Fee Payments</span>
              <span className="text-[11px] text-slate-500">
                Permits students or sponsors to settle tuition and levies in structured installments.
              </span>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              name="payment_notification_sms"
              disabled={!canEdit}
              checked={formData.payment_notification_sms}
              onChange={handleChange}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
            />
            <div>
              <span className="text-xs font-bold text-slate-900 block">SMS Payment Receipt Alerts</span>
              <span className="text-[11px] text-slate-500">
                Dispatch instant SMS receipt confirmation upon verified fee payment.
              </span>
            </div>
          </label>
        </div>

        {canEdit && (
          <div className="pt-4 border-t border-slate-200 flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl shadow-sm transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{loading ? 'Saving...' : 'Save Institutional Settings'}</span>
            </button>
          </div>
        )}
      </form>
    </div>
  );
};
