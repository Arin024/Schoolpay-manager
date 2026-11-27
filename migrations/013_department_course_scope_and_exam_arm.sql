-- ==============================================================================
-- Migration 013: Department-Scoped Courses & Exam Department/Arm Support
-- Allows different departments (e.g. Family Healthcare, CHEW, Public Health)
-- in the same level & semester to hold distinct courses even with similar titles,
-- and enables department-scoped examinations & grading queues.
-- Idempotent & 100% non-destructive to existing records.
-- ==============================================================================

-- 1. Replace active-scope unique index on subjects to include department
DROP INDEX IF EXISTS idx_subjects_active_scope_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_active_scope_unique
  ON subjects (
    school_id,
    LOWER(name),
    COALESCE(class_id, ''),
    COALESCE(semester_tag, ''),
    LOWER(COALESCE(department, ''))
  )
  WHERE (is_deleted = 0 OR is_deleted IS NULL);

CREATE INDEX IF NOT EXISTS idx_subjects_school_dept_class_sem
  ON subjects (school_id, LOWER(COALESCE(department, '')), class_id, semester_tag)
  WHERE (is_deleted = 0 OR is_deleted IS NULL);

-- 2. Add optional department & class_arm_id columns to examinations
ALTER TABLE examinations ADD COLUMN IF NOT EXISTS department VARCHAR(128);
ALTER TABLE examinations ADD COLUMN IF NOT EXISTS class_arm_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_examinations_school_dept
  ON examinations (school_id, academic_session_id, term_id, class_id, LOWER(COALESCE(department, '')))
  WHERE (is_deleted = 0 OR is_deleted IS NULL);
