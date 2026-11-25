-- Migration 010: Academic Progression, Batch Promotion/Graduation Ledger, Rollback & Multi-Year Career Transcripts
-- Strictly additive, idempotent, zero distortion to existing K-12 or Higher Institution records.

ALTER TABLE students ADD COLUMN IF NOT EXISTS graduation_date TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS graduation_session_id TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_session_id TEXT;

CREATE TABLE IF NOT EXISTS student_promotion_batches (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  from_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
  to_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
  from_class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
  from_class_name TEXT,
  to_class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
  to_class_name TEXT,
  action_type TEXT DEFAULT 'PROMOTE',
  total_students INTEGER DEFAULT 0,
  promoted_count INTEGER DEFAULT 0,
  retained_count INTEGER DEFAULT 0,
  probation_count INTEGER DEFAULT 0,
  graduated_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'APPLIED',
  notes TEXT,
  executed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  rolled_back_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  rolled_back_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_promo_batches_school ON student_promotion_batches(school_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS student_enrollment_history (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES student_promotion_batches(id) ON DELETE SET NULL,
  academic_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
  session_name TEXT,
  class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
  class_name TEXT,
  class_arm_id TEXT REFERENCES class_arms(id) ON DELETE SET NULL,
  class_arm_name TEXT,
  previous_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
  previous_class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
  previous_class_name TEXT,
  previous_class_arm_id TEXT REFERENCES class_arms(id) ON DELETE SET NULL,
  previous_class_arm_name TEXT,
  previous_status TEXT DEFAULT 'ACTIVE',
  new_status TEXT DEFAULT 'ACTIVE',
  outcome TEXT NOT NULL,
  session_average REAL,
  session_gpa REAL,
  cumulative_cgpa REAL,
  credits_earned INTEGER,
  outstanding_balance_kobo INTEGER DEFAULT 0,
  remarks TEXT,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enrollment_history_student ON student_enrollment_history(school_id, student_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_enrollment_history_batch ON student_enrollment_history(school_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_history_session ON student_enrollment_history(school_id, academic_session_id);

CREATE TABLE IF NOT EXISTS career_transcripts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  verification_code TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'DRAFT',
  institution_category TEXT DEFAULT 'K12',
  grading_mode TEXT DEFAULT 'PERCENTAGE',
  sessions_count INTEGER DEFAULT 0,
  terms_count INTEGER DEFAULT 0,
  total_subjects_courses INTEGER DEFAULT 0,
  total_credit_units INTEGER DEFAULT 0,
  total_grade_points REAL DEFAULT 0,
  lifetime_cgpa REAL,
  lifetime_average REAL DEFAULT 0,
  final_standing TEXT,
  graduation_status TEXT DEFAULT 'ACTIVE',
  graduation_session_name TEXT,
  carryover_count INTEGER DEFAULT 0,
  snapshot_json TEXT,
  registrar_remark TEXT,
  principal_remark TEXT,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_career_transcripts_school ON career_transcripts(school_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_transcripts_code ON career_transcripts(verification_code);
