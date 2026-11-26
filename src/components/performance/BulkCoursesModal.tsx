import React, { useState } from 'react';
import { Plus, Trash2, Upload, Sparkles, X, CheckCircle2, AlertCircle, BookOpen } from 'lucide-react';
import { api } from '../../services/api';
import { ClassItem } from '../../types';

interface BulkCourseDraftRow {
  id: string;
  name: string;
  code: string;
  credit_units: string;
  course_type: 'CORE' | 'ELECTIVE' | 'GENERAL';
  class_id: string;
  department: string;
  semester_tag: string;
}

interface BulkCoursesModalProps {
  classes: ClassItem[];
  isTertiary: boolean;
  subjectLabel: string;
  subjectPlural: string;
  classLabel: string;
  cycleLabel: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const makeEmptyRow = (defaultClassId = ''): BulkCourseDraftRow => ({
  id: `row_${Math.random().toString(36).slice(2, 9)}`,
  name: '',
  code: '',
  credit_units: '3',
  course_type: 'CORE',
  class_id: defaultClassId,
  department: '',
  semester_tag: '',
});

const CURRICULUM_PRESETS: Record<
  string,
  { label: string; tertiary: boolean; rows: Array<{ code: string; name: string; units: number; type: 'CORE' | 'ELECTIVE' | 'GENERAL'; dept?: string }> }
> = {
  uni_100l_cs: {
    label: 'University 100L Computing / Science',
    tertiary: true,
    rows: [
      { code: 'GST101', name: 'Use of English & Communication Skills', units: 2, type: 'GENERAL', dept: 'General Studies' },
      { code: 'GST102', name: 'Nigerian Peoples and Culture', units: 2, type: 'GENERAL', dept: 'General Studies' },
      { code: 'MTH101', name: 'General Mathematics I', units: 3, type: 'CORE', dept: 'Mathematics' },
      { code: 'PHY101', name: 'General Physics I', units: 3, type: 'CORE', dept: 'Physics' },
      { code: 'PHY107', name: 'General Physics Practical I', units: 1, type: 'CORE', dept: 'Physics' },
      { code: 'CSC101', name: 'Introduction to Computer Science', units: 3, type: 'CORE', dept: 'Computer Science' },
      { code: 'STA111', name: 'Descriptive Statistics', units: 2, type: 'ELECTIVE', dept: 'Statistics' },
    ],
  },
  poly_nd1: {
    label: 'Polytechnic ND 1 General & Core',
    tertiary: true,
    rows: [
      { code: 'GNS101', name: 'Use of English I', units: 2, type: 'GENERAL', dept: 'General Studies' },
      { code: 'GNS111', name: 'Citizenship Education I', units: 2, type: 'GENERAL', dept: 'General Studies' },
      { code: 'COM111', name: 'Introduction to Computing', units: 3, type: 'CORE', dept: 'Computer Science' },
      { code: 'COM112', name: 'Introduction to Digital Electronics', units: 3, type: 'CORE', dept: 'Computer Science' },
      { code: 'MTH111', name: 'Logic and Linear Algebra', units: 2, type: 'CORE', dept: 'Mathematics' },
      { code: 'COM115', name: 'Computer Application Packages Lab', units: 1, type: 'CORE', dept: 'Computer Science' },
    ],
  },
  sec_sss_sci: {
    label: 'Senior Secondary (SSS) Science Core',
    tertiary: false,
    rows: [
      { code: 'ENG', name: 'English Language', units: 4, type: 'CORE', dept: 'Languages' },
      { code: 'MTH', name: 'Mathematics', units: 4, type: 'CORE', dept: 'Sciences' },
      { code: 'PHY', name: 'Physics', units: 3, type: 'CORE', dept: 'Sciences' },
      { code: 'CHM', name: 'Chemistry', units: 3, type: 'CORE', dept: 'Sciences' },
      { code: 'BIO', name: 'Biology', units: 3, type: 'CORE', dept: 'Sciences' },
      { code: 'CIV', name: 'Civic Education', units: 2, type: 'GENERAL', dept: 'Humanities' },
      { code: 'ICT', name: 'Data Processing / ICT', units: 2, type: 'ELECTIVE', dept: 'Technology' },
    ],
  },
  sec_jss: {
    label: 'Junior Secondary (JSS) Core',
    tertiary: false,
    rows: [
      { code: 'ENG', name: 'English Studies', units: 4, type: 'CORE', dept: 'Languages' },
      { code: 'MTH', name: 'Mathematics', units: 4, type: 'CORE', dept: 'Sciences' },
      { code: 'BSC', name: 'Basic Science & Technology', units: 3, type: 'CORE', dept: 'Sciences' },
      { code: 'RNV', name: 'Religion & National Values', units: 2, type: 'GENERAL', dept: 'Humanities' },
      { code: 'BUS', name: 'Business Studies', units: 2, type: 'CORE', dept: 'Commercial' },
      { code: 'CCA', name: 'Cultural & Creative Arts', units: 1, type: 'ELECTIVE', dept: 'Arts' },
    ],
  },
  primary_core: {
    label: 'Primary School Core Curriculum',
    tertiary: false,
    rows: [
      { code: 'ENG', name: 'English Studies', units: 4, type: 'CORE' },
      { code: 'MTH', name: 'Mathematics', units: 4, type: 'CORE' },
      { code: 'BSC', name: 'Basic Science', units: 3, type: 'CORE' },
      { code: 'SOS', name: 'Social Studies & Civic Education', units: 2, type: 'CORE' },
      { code: 'VER', name: 'Verbal & Quantitative Reasoning', units: 2, type: 'CORE' },
      { code: 'ICT', name: 'Computer Studies', units: 1, type: 'ELECTIVE' },
    ],
  },
};

export const BulkCoursesModal: React.FC<BulkCoursesModalProps> = ({
  classes,
  isTertiary,
  subjectLabel,
  subjectPlural,
  classLabel,
  cycleLabel,
  onClose,
  onSaved,
}) => {
  const [mode, setMode] = useState<'GRID' | 'PASTE'>('GRID');
  const [defaultClassId, setDefaultClassId] = useState('');
  const [updateExisting, setUpdateExisting] = useState(true);
  const [rows, setRows] = useState<BulkCourseDraftRow[]>([
    makeEmptyRow(),
    makeEmptyRow(),
    makeEmptyRow(),
    makeEmptyRow(),
  ]);
  const [pasteText, setPasteText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Array<{ row: number; message: string }>>([]);

  const updateRow = (id: string, patch: Partial<BulkCourseDraftRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const applyPreset = (presetKey: string) => {
    const preset = CURRICULUM_PRESETS[presetKey];
    if (!preset) return;
    setRows(
      preset.rows.map((item) => ({
        id: `row_${Math.random().toString(36).slice(2, 9)}`,
        name: item.name,
        code: item.code,
        credit_units: String(item.units),
        course_type: item.type,
        class_id: defaultClassId,
        department: item.dept || '',
        semester_tag: '',
      }))
    );
    setMode('GRID');
    setError(null);
  };

  const parsePastedTextToGrid = () => {
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setError('Paste at least one line (e.g. CSC101, Introduction to Computing, 3, CORE).');
      return;
    }

    const parsed: BulkCourseDraftRow[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.includes('\t') ? line.split('\t') : line.split(',');
      const cols = parts.map((p) => p.trim().replace(/^"|"$/g, ''));
      // Skip header row if detected
      if (i === 0 && /code|title|subject|course/i.test(cols[0] || '') && /name|title|unit/i.test(cols.join(' '))) {
        continue;
      }

      // Support either: Code, Name, Units, Type, Department OR Name, Code, Units
      let code = '';
      let name = '';
      let units = '3';
      let type: 'CORE' | 'ELECTIVE' | 'GENERAL' = 'CORE';
      let dept = '';

      if (cols.length >= 2) {
        const firstLooksLikeCode = /^[A-Za-z]{2,6}\s*\d{2,4}[A-Za-z]?$/.test(cols[0]) || cols[0].length <= 8;
        if (firstLooksLikeCode) {
          code = cols[0].toUpperCase();
          name = cols[1];
        } else {
          name = cols[0];
          code = cols[1].toUpperCase();
        }
        if (cols[2] !== undefined && cols[2] !== '') {
          const u = Number(cols[2]);
          if (Number.isFinite(u) && u >= 0 && u <= 12) units = String(Math.round(u));
        }
        if (cols[3]) {
          const up = cols[3].toUpperCase();
          if (up.startsWith('E')) type = 'ELECTIVE';
          else if (up.startsWith('G')) type = 'GENERAL';
        }
        if (cols[4]) dept = cols[4];
      } else if (cols.length === 1 && cols[0]) {
        name = cols[0];
      }

      if (name) {
        parsed.push({
          id: `row_${Math.random().toString(36).slice(2, 9)}`,
          name,
          code,
          credit_units: units,
          course_type: type,
          class_id: defaultClassId,
          department: dept,
          semester_tag: '',
        });
      }
    }

    if (parsed.length === 0) {
      setError('Could not extract any valid rows. Use: Code, Course Title, Credit Units, Type (one per line).');
      return;
    }

    setRows(parsed);
    setMode('GRID');
    setError(null);
  };

  const validRows = rows.filter((r) => r.name.trim().length > 0);
  const totalUnits = validRows.reduce((sum, r) => {
    const n = Number(r.credit_units);
    return sum + (Number.isFinite(n) && n >= 0 ? Math.min(12, Math.round(n)) : 0);
  }, 0);

  const handleSubmit = async () => {
    if (validRows.length === 0) {
      setError(`Enter at least one ${subjectLabel.toLowerCase()} title before saving.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    setRowErrors([]);
    try {
      const payloadCourses = validRows.map((r) => {
        const parsedUnits = r.credit_units.trim() === '' ? 3 : Number(r.credit_units);
        const cleanUnits = Number.isFinite(parsedUnits) ? Math.max(0, Math.min(12, Math.round(parsedUnits))) : 3;
        return {
          name: r.name.trim(),
          code: r.code.trim().toUpperCase() || undefined,
          credit_units: cleanUnits,
          course_type: r.course_type,
          class_id: r.class_id || defaultClassId || null,
          department: r.department.trim() || null,
          semester_tag: r.semester_tag.trim() || null,
          status: 'ACTIVE',
        };
      });

      const res = await api.bulkUpsertSubjects({
        courses: payloadCourses,
        update_existing: updateExisting,
      });

      if (res.errors && res.errors.length > 0) {
        setRowErrors(res.errors);
      }
      onSaved(res.message);
    } catch (err: any) {
      setError(err?.message || `Failed to bulk register ${subjectPlural.toLowerCase()}.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-700" />
              <h3 className="text-base font-bold text-slate-900">
                Bulk Register {subjectPlural} & Credit Units
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Add multiple {subjectPlural.toLowerCase()} at once, paste from Excel/CSV, or load a Nigerian template. Credit units are freely adjustable from 0 to 12 (e.g. 1, 2, 3, 4, 6).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Close bulk courses modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls Bar */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('GRID')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                mode === 'GRID'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Interactive Table ({validRows.length})
            </button>
            <button
              type="button"
              onClick={() => setMode('PASTE')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border flex items-center gap-1.5 transition-colors ${
                mode === 'PASTE'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Paste Excel / CSV
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={defaultClassId}
              onChange={(e) => {
                const nextCls = e.target.value;
                setDefaultClassId(nextCls);
                setRows((prev) => prev.map((r) => (r.class_id === '' ? { ...r, class_id: nextCls } : r)));
              }}
              className="text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700"
              aria-label={`Default ${classLabel}`}
            >
              <option value="">Default Scope: All {classLabel}s</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  Default {classLabel}: {c.name}
                </option>
              ))}
            </select>

            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) applyPreset(e.target.value);
                e.target.value = '';
              }}
              className="text-xs px-2.5 py-1.5 bg-white border border-emerald-200 text-emerald-800 font-medium rounded-lg"
              aria-label="Load Curriculum Preset"
            >
              <option value="">Load Quick Preset...</option>
              {Object.entries(CURRICULUM_PRESETS)
                .sort(([, a], [, b]) => Number(b.tertiary === isTertiary) - Number(a.tertiary === isTertiary))
                .map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {rowErrors.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
              <p className="font-semibold">Some rows had issues:</p>
              {rowErrors.map((e, idx) => (
                <p key={idx}>Row {e.row}: {e.message}</p>
              ))}
            </div>
          )}

          {mode === 'PASTE' ? (
            <div className="space-y-3">
              <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="font-semibold text-slate-800 mb-1">Format: Code, {subjectLabel} Title, Credit Units, Type (CORE/ELECTIVE/GENERAL), Department</p>
                <pre className="font-mono text-[11px] text-slate-600 whitespace-pre-wrap">
{isTertiary
  ? `CSC101, Introduction to Computer Science, 3, CORE, Computer Science\nGST101, Use of English, 2, GENERAL, General Studies\nPHY107, Physics Practical I, 1, CORE, Physics\nMTH101, General Mathematics I, 4, CORE, Mathematics`
  : `MTH, Mathematics, 4, CORE, Sciences\nENG, English Language, 4, CORE, Languages\nPHY, Physics, 3, CORE, Sciences\nICT, Data Processing, 2, ELECTIVE, Technology`}
                </pre>
              </div>
              <textarea
                rows={9}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste rows directly from Excel, Google Sheets, or CSV here..."
                className="w-full px-3 py-2.5 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={parsePastedTextToGrid}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Parse into Table for Review
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse min-w-[760px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-2.5 py-2 w-24">Code</th>
                      <th className="px-2.5 py-2">{subjectLabel} Title *</th>
                      <th className="px-2.5 py-2 w-36">Credit Units (0–12)</th>
                      <th className="px-2.5 py-2 w-28">Type</th>
                      <th className="px-2.5 py-2 w-36">{classLabel}</th>
                      <th className="px-2.5 py-2 w-32">Department</th>
                      <th className="px-2.5 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {rows.map((row, idx) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={row.code}
                            onChange={(e) => updateRow(row.id, { code: e.target.value.toUpperCase() })}
                            placeholder={isTertiary ? 'CSC101' : 'MTH'}
                            aria-label={`Row ${idx + 1} Code`}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => updateRow(row.id, { name: e.target.value })}
                            placeholder={isTertiary ? 'e.g. Data Structures & Algorithms' : 'e.g. Further Mathematics'}
                            aria-label={`Row ${idx + 1} Title`}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={12}
                              value={row.credit_units}
                              onChange={(e) => updateRow(row.id, { credit_units: e.target.value })}
                              aria-label={`Row ${idx + 1} Credit Units`}
                              className="w-14 px-2 py-1.5 border border-slate-200 rounded text-xs font-semibold tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <div className="flex items-center gap-0.5">
                              {[1, 2, 3, 4].map((u) => (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => updateRow(row.id, { credit_units: String(u) })}
                                  className={`w-5 h-6 text-[10px] font-semibold rounded border tabular-nums ${
                                    row.credit_units === String(u)
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                  }`}
                                  title={`Set ${u} unit${u > 1 ? 's' : ''}`}
                                >
                                  {u}
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={row.course_type}
                            onChange={(e) => updateRow(row.id, { course_type: e.target.value as any })}
                            aria-label={`Row ${idx + 1} Type`}
                            className="w-full px-1.5 py-1.5 border border-slate-200 rounded text-xs bg-white"
                          >
                            <option value="CORE">Core</option>
                            <option value="ELECTIVE">Elective</option>
                            <option value="GENERAL">General</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={row.class_id}
                            onChange={(e) => updateRow(row.id, { class_id: e.target.value })}
                            aria-label={`Row ${idx + 1} ${classLabel}`}
                            className="w-full px-1.5 py-1.5 border border-slate-200 rounded text-xs bg-white"
                          >
                            <option value="">All {classLabel}s</option>
                            {classes.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={row.department}
                            onChange={(e) => updateRow(row.id, { department: e.target.value })}
                            placeholder="Optional"
                            aria-label={`Row ${idx + 1} Department`}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== row.id) : [makeEmptyRow(defaultClassId)]))}
                            className="p-1 text-slate-400 hover:text-red-600 rounded"
                            title="Remove row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRows((prev) => [...prev, makeEmptyRow(defaultClassId)])}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Row
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => [
                        ...prev,
                        makeEmptyRow(defaultClassId),
                        makeEmptyRow(defaultClassId),
                        makeEmptyRow(defaultClassId),
                        makeEmptyRow(defaultClassId),
                        makeEmptyRow(defaultClassId),
                      ])
                    }
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    +5 Rows
                  </button>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Update credit units & details if {subjectLabel.toLowerCase()} code/name already exists
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600 tabular-nums">
            <span className="font-semibold text-slate-900">{validRows.length}</span> ready {subjectPlural.toLowerCase()} ·{' '}
            <span className="font-semibold text-slate-900">{totalUnits}</span> total credit units · Applies across {cycleLabel.toLowerCase()}s
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || validRows.length === 0}
              onClick={handleSubmit}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {submitting ? 'Registering...' : `Save ${validRows.length} ${validRows.length === 1 ? subjectLabel : subjectPlural}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
