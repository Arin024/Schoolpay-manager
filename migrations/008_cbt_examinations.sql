-- ============================================================================
-- MIGRATION 008: COMPUTER-BASED TESTING (CBT) EXAMINATION ENGINE
-- Non-destructive additive schema for multi-class CBT exams, question bank,
-- timed auto-saved attempts, proctoring telemetry & report card score sync.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cbt_exams (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
  class_name TEXT,
  class_arm_id TEXT REFERENCES class_arms(id) ON DELETE SET NULL,
  class_arm_name TEXT,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  subject_name TEXT NOT NULL,
  academic_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
  linked_examination_id TEXT REFERENCES examinations(id) ON DELETE SET NULL,
  sync_score_target TEXT NOT NULL DEFAULT 'NONE',
  exam_mode TEXT NOT NULL DEFAULT 'TERM_EXAM',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  total_marks NUMERIC NOT NULL DEFAULT 0,
  pass_mark_percent NUMERIC NOT NULL DEFAULT 50,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  shuffle_questions INTEGER NOT NULL DEFAULT 1,
  shuffle_options INTEGER NOT NULL DEFAULT 0,
  show_result_immediately INTEGER NOT NULL DEFAULT 1,
  show_correct_answers INTEGER NOT NULL DEFAULT 1,
  access_code TEXT,
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_school_status ON cbt_exams(school_id, status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_class ON cbt_exams(school_id, class_id, is_deleted);

CREATE TABLE IF NOT EXISTS cbt_questions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  cbt_exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL DEFAULT 1,
  question_type TEXT NOT NULL DEFAULT 'MCQ',
  question_text TEXT NOT NULL,
  question_image_url TEXT,
  option_a TEXT,
  option_b TEXT,
  option_c TEXT,
  option_d TEXT,
  option_e TEXT,
  correct_answer TEXT NOT NULL,
  explanation TEXT,
  marks NUMERIC NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cbt_questions_exam ON cbt_questions(cbt_exam_id, is_deleted, question_order);

CREATE TABLE IF NOT EXISTS cbt_attempts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  cbt_exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  admission_number TEXT,
  class_id TEXT,
  class_name TEXT,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  submitted_at TIMESTAMP,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  question_order_json TEXT,
  answers_json TEXT DEFAULT '{}',
  total_questions INTEGER NOT NULL DEFAULT 0,
  answered_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  unanswered_count INTEGER NOT NULL DEFAULT 0,
  score_obtained NUMERIC NOT NULL DEFAULT 0,
  max_score NUMERIC NOT NULL DEFAULT 0,
  percentage NUMERIC NOT NULL DEFAULT 0,
  grade TEXT,
  passed INTEGER NOT NULL DEFAULT 0,
  tab_switch_count INTEGER NOT NULL DEFAULT 0,
  synced_to_report_card INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cbt_attempts_exam_student ON cbt_attempts(cbt_exam_id, student_id, status);
CREATE INDEX IF NOT EXISTS idx_cbt_attempts_school_student ON cbt_attempts(school_id, student_id, created_at);
