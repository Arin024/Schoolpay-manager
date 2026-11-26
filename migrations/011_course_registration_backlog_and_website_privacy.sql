-- ==============================================================================
-- Migration 011: Course/Subject Registration, Credit Units, Historical Backlog
--                Support & Public School Website Privacy Controls
-- 100% Additive & Idempotent — NEVER mutates or deletes existing school records.
-- ==============================================================================

-- 1. Enrich subjects/courses with course_type & semester_tag (credit_units already added in 009)
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS course_type VARCHAR(32) DEFAULT 'CORE';
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS semester_tag VARCHAR(64);
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS credit_units INTEGER DEFAULT 3;

-- 2. Academic credit load policy guardrails (Higher Institutions / Elective Schools)
ALTER TABLE school_academic_settings ADD COLUMN IF NOT EXISTS min_credit_units_per_cycle INTEGER DEFAULT 12;
ALTER TABLE school_academic_settings ADD COLUMN IF NOT EXISTS max_credit_units_per_cycle INTEGER DEFAULT 24;

-- 3. Public School Website Privacy Controls
--    Defaults hide sensitive enrollment & staff headcounts from anonymous internet visitors
--    while giving every school one-click toggles to publish any figure they choose.
ALTER TABLE school_website_profiles ADD COLUMN IF NOT EXISTS show_enrollment_count INTEGER DEFAULT 0;
ALTER TABLE school_website_profiles ADD COLUMN IF NOT EXISTS show_staff_count INTEGER DEFAULT 0;
ALTER TABLE school_website_profiles ADD COLUMN IF NOT EXISTS show_classes_count INTEGER DEFAULT 1;
ALTER TABLE school_website_profiles ADD COLUMN IF NOT EXISTS show_cbt_hall INTEGER DEFAULT 1;
ALTER TABLE school_website_profiles ADD COLUMN IF NOT EXISTS show_admissions_form INTEGER DEFAULT 1;

-- 4. Student Course / Subject Registration Ledger (supports current, elective, carryover & historical backlog)
CREATE TABLE IF NOT EXISTS student_course_registrations (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_session_id VARCHAR(64) NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
  term_id VARCHAR(64) NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
  subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  credit_units_snapshot INTEGER DEFAULT 3,
  registration_type VARCHAR(32) DEFAULT 'REGULAR', -- REGULAR | CARRYOVER | ELECTIVE | HISTORICAL
  status VARCHAR(32) DEFAULT 'REGISTERED',         -- REGISTERED | APPROVED | DROPPED
  registered_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, student_id, academic_session_id, term_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_course_reg_school_ses_term
  ON student_course_registrations(school_id, academic_session_id, term_id);
CREATE INDEX IF NOT EXISTS idx_course_reg_student
  ON student_course_registrations(school_id, student_id, academic_session_id);
CREATE INDEX IF NOT EXISTS idx_course_reg_subject
  ON student_course_registrations(school_id, subject_id);
