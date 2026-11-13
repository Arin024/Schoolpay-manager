-- ==============================================================================
-- BURSARIQ - MIGRATION 005: SCHOOL PERFORMANCE MANAGEMENT, REPORT CARDS,
-- ATTENDANCE, BEHAVIOUR MONITORING, ANNOUNCEMENTS & PARENT/STUDENT PORTALS
-- Idempotent PostgreSQL Migration (Neon Serverless Compatible)
-- Preserves all existing schools, users, students, invoices, payments & receipts
-- ==============================================================================

-- 1. Seed STUDENT role cleanly
INSERT INTO roles (id, name, display_name, description, scope)
VALUES (
    'role_student',
    'STUDENT',
    'Student / Learner',
    'Student portal read-only access to published results, attendance, and report cards',
    'SCHOOL'
)
ON CONFLICT (name) DO NOTHING;

-- 2. Add explicit user account linkage to students (never auto-linked by email/phone)
ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);

-- 3. Enhance parent_students with explicit admin verification metadata
ALTER TABLE parent_students ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(64) DEFAULT 'Parent';
ALTER TABLE parent_students ADD COLUMN IF NOT EXISTS is_primary_contact INTEGER DEFAULT 1;
ALTER TABLE parent_students ADD COLUMN IF NOT EXISTS verified_by VARCHAR(64);
ALTER TABLE parent_students ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- 4. Ensure notifications table compatibility for modern in-app portal & admin notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(64) DEFAULT 'SYSTEM';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

DO $$
BEGIN
    ALTER TABLE notifications ALTER COLUMN recipient_type DROP NOT NULL;
EXCEPTION WHEN undefined_column OR others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE notifications ALTER COLUMN recipient_address DROP NOT NULL;
EXCEPTION WHEN undefined_column OR others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE notifications ALTER COLUMN channel DROP NOT NULL;
EXCEPTION WHEN undefined_column OR others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE notifications ALTER COLUMN template_type DROP NOT NULL;
EXCEPTION WHEN undefined_column OR others THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE notifications ALTER COLUMN body DROP NOT NULL;
EXCEPTION WHEN undefined_column OR others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_school_user ON notifications(school_id, user_id);

-- 5. School Academic & Portal Policy Settings (Per-tenant)
CREATE TABLE IF NOT EXISTS school_academic_settings (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) UNIQUE NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    ca_max_score DOUBLE PRECISION NOT NULL DEFAULT 40,
    exam_max_score DOUBLE PRECISION NOT NULL DEFAULT 60,
    component_structure_json TEXT,
    grading_scale_json TEXT NOT NULL,
    missing_score_policy VARCHAR(32) NOT NULL DEFAULT 'EXCLUDE' CHECK(missing_score_policy IN ('EXCLUDE', 'ZERO')),
    show_class_position INTEGER NOT NULL DEFAULT 1,
    students_can_view_fees INTEGER NOT NULL DEFAULT 1,
    teachers_can_view_fees INTEGER NOT NULL DEFAULT 0,
    require_review_before_approve INTEGER NOT NULL DEFAULT 0,
    updated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Subjects
CREATE TABLE IF NOT EXISTS subjects (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    code VARCHAR(32),
    department VARCHAR(64),
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
    is_deleted INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school_id, is_deleted);

-- 7. Examinations / Assessment Cycles
CREATE TABLE IF NOT EXISTS examinations (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_session_id VARCHAR(64) REFERENCES academic_sessions(id) ON DELETE SET NULL,
    term_id VARCHAR(64) REFERENCES terms(id) ON DELETE SET NULL,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    exam_type VARCHAR(64) NOT NULL DEFAULT 'TERMLY',
    ca_max_score DOUBLE PRECISION NOT NULL DEFAULT 40,
    exam_max_score DOUBLE PRECISION NOT NULL DEFAULT 60,
    total_max_score DOUBLE PRECISION NOT NULL DEFAULT 100,
    component_weights_json TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED')),
    created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    approved_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    published_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    is_deleted INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_examinations_school_status ON examinations(school_id, status, is_deleted);

-- 8. Student Scores
CREATE TABLE IF NOT EXISTS student_scores (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    examination_id VARCHAR(64) NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    academic_session_id VARCHAR(64) REFERENCES academic_sessions(id) ON DELETE SET NULL,
    term_id VARCHAR(64) REFERENCES terms(id) ON DELETE SET NULL,
    ca_score DOUBLE PRECISION,
    exam_score DOUBLE PRECISION,
    component_scores_json TEXT,
    total_score DOUBLE PRECISION,
    grade VARCHAR(16),
    grade_remark VARCHAR(64),
    subject_remark TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED')),
    entered_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    updated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    approved_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    published_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (examination_id, student_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_scores_school_exam ON student_scores(school_id, examination_id);
CREATE INDEX IF NOT EXISTS idx_scores_student_status ON student_scores(school_id, student_id, status);

-- 9. Post-Publication Score Correction Audit Logs (Immutable)
CREATE TABLE IF NOT EXISTS score_correction_logs (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    score_id VARCHAR(64) NOT NULL REFERENCES student_scores(id) ON DELETE CASCADE,
    examination_id VARCHAR(64) NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id VARCHAR(64) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    previous_ca_score DOUBLE PRECISION,
    new_ca_score DOUBLE PRECISION,
    previous_exam_score DOUBLE PRECISION,
    new_exam_score DOUBLE PRECISION,
    previous_total DOUBLE PRECISION,
    new_total DOUBLE PRECISION,
    previous_grade VARCHAR(16),
    new_grade VARCHAR(16),
    reason TEXT NOT NULL,
    corrected_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    corrected_by_email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_score_corrections_school ON score_correction_logs(school_id, examination_id);

-- 10. Official Termly Report Cards (with frozen snapshot upon publish)
CREATE TABLE IF NOT EXISTS report_cards (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    academic_session_id VARCHAR(64) NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    term_id VARCHAR(64) NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    examination_id VARCHAR(64) REFERENCES examinations(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED')),
    total_score DOUBLE PRECISION DEFAULT 0,
    average_score DOUBLE PRECISION DEFAULT 0,
    subjects_count INTEGER DEFAULT 0,
    class_position INTEGER,
    class_size INTEGER,
    attendance_summary_json TEXT,
    behaviour_summary_json TEXT,
    teacher_remark TEXT,
    principal_remark TEXT,
    snapshot_json TEXT,
    verification_code VARCHAR(64),
    approved_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    published_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, student_id, academic_session_id, term_id)
);
CREATE INDEX IF NOT EXISTS idx_report_cards_school_student ON report_cards(school_id, student_id, status);

-- 11. Attendance Records
CREATE TABLE IF NOT EXISTS attendance_records (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    class_arm_id VARCHAR(64) REFERENCES class_arms(id) ON DELETE SET NULL,
    academic_session_id VARCHAR(64) REFERENCES academic_sessions(id) ON DELETE SET NULL,
    term_id VARCHAR(64) REFERENCES terms(id) ON DELETE SET NULL,
    attendance_date TEXT NOT NULL,
    status VARCHAR(32) NOT NULL CHECK(status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED')),
    notes TEXT,
    is_published INTEGER NOT NULL DEFAULT 0,
    recorded_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    updated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, student_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance_records(school_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_pub ON attendance_records(school_id, student_id, is_published);

-- 12. Attendance Publications (Class & Term publication control)
CREATE TABLE IF NOT EXISTS attendance_publications (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    academic_session_id VARCHAR(64) REFERENCES academic_sessions(id) ON DELETE SET NULL,
    term_id VARCHAR(64) REFERENCES terms(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'PUBLISHED')),
    published_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, class_id, academic_session_id, term_id)
);

-- 13. Behaviour & Conduct Records
CREATE TABLE IF NOT EXISTS behaviour_records (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    academic_session_id VARCHAR(64) REFERENCES academic_sessions(id) ON DELETE SET NULL,
    term_id VARCHAR(64) REFERENCES terms(id) ON DELETE SET NULL,
    record_date TEXT NOT NULL,
    category VARCHAR(32) NOT NULL CHECK(category IN ('POSITIVE', 'COMMENDATION', 'DISCIPLINE', 'INCIDENT', 'PASTORAL')),
    severity VARCHAR(32) NOT NULL DEFAULT 'LOW' CHECK(severity IN ('LOW', 'MODERATE', 'HIGH')),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    action_taken TEXT,
    admin_remarks TEXT,
    visible_to_parent INTEGER NOT NULL DEFAULT 1,
    visible_to_student INTEGER NOT NULL DEFAULT 1,
    visible_to_teacher INTEGER NOT NULL DEFAULT 1,
    recorded_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    updated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_behaviour_school_student ON behaviour_records(school_id, student_id, is_deleted);

-- 14. Official Termly Teacher Remarks (Admin-authored & published)
CREATE TABLE IF NOT EXISTS teacher_remarks (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    academic_session_id VARCHAR(64) NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    term_id VARCHAR(64) NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    remark_text TEXT NOT NULL,
    staff_name VARCHAR(255),
    visible_to_parent INTEGER NOT NULL DEFAULT 1,
    visible_to_student INTEGER NOT NULL DEFAULT 1,
    author_admin_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    updated_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, student_id, academic_session_id, term_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_remarks_school_student ON teacher_remarks(school_id, student_id);

-- 15. School Announcements
CREATE TABLE IF NOT EXISTS school_announcements (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    audience VARCHAR(32) NOT NULL DEFAULT 'ALL' CHECK(audience IN ('ALL', 'PARENTS', 'STUDENTS', 'TEACHERS', 'CLASS')),
    target_class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    priority VARCHAR(32) NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('NORMAL', 'IMPORTANT', 'URGENT')),
    is_published INTEGER NOT NULL DEFAULT 1,
    published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_announcements_school ON school_announcements(school_id, is_published, is_deleted);
