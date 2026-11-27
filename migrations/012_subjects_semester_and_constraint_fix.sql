-- ==============================================================================
-- Migration 012: Flexible Course/Subject Uniqueness Across Levels & Semesters
--                + Wider Course Title & Department Lengths for Higher Institutions
-- 100% Additive & Non-Destructive — NEVER deletes or alters existing school data.
-- ==============================================================================

-- 1. Drop legacy overly-restrictive UNIQUE(school_id, name) constraint on subjects
--    so institutions can have courses per level/semester and cleanly re-register
--    previously soft-deleted courses without unique constraint crashes.
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_school_id_name_key;

-- 2. Widen name and department columns so full university/polytechnic course titles
--    and faculty/department names never fail with VARCHAR length overflow (SQLSTATE 22001).
ALTER TABLE subjects ALTER COLUMN name TYPE VARCHAR(255);
ALTER TABLE subjects ALTER COLUMN department TYPE VARCHAR(128);

-- 3. Active-only scoped uniqueness index (school + lowercase name + level + semester_tag)
--    Allows identical titles across distinct levels/semesters while preventing active dupes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_active_scope_unique
  ON subjects (school_id, LOWER(name), COALESCE(class_id, ''), COALESCE(semester_tag, ''))
  WHERE (is_deleted = 0 OR is_deleted IS NULL);

-- 4. Fast lookup index for Level x Semester course filtering
CREATE INDEX IF NOT EXISTS idx_subjects_school_class_sem
  ON subjects (school_id, class_id, semester_tag)
  WHERE (is_deleted = 0 OR is_deleted IS NULL);
