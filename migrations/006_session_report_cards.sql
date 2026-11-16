-- Migration 006: Full-Session Cumulative Annual Report Cards (Additive Only)

CREATE TABLE IF NOT EXISTS session_report_cards (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    academic_session_id VARCHAR(64) NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED')),
    total_score DOUBLE PRECISION DEFAULT 0,
    average_score DOUBLE PRECISION DEFAULT 0,
    subjects_count INTEGER DEFAULT 0,
    terms_count INTEGER DEFAULT 0,
    class_position INTEGER,
    class_size INTEGER,
    promotion_status VARCHAR(32) DEFAULT 'PENDING',
    term_averages_json TEXT,
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
    UNIQUE (school_id, student_id, academic_session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_report_cards_school_student ON session_report_cards(school_id, student_id, status);
