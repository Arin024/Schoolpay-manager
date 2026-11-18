-- Migration 007: Unique School Website CMS, Custom Subdomain Portals & Dedicated Staff Workspace
-- Non-destructive, 100% additive & idempotent for live production databases.

-- 1. Support Confidential Staff-Only Announcements without breaking existing announcements
ALTER TABLE school_announcements ADD COLUMN IF NOT EXISTS is_confidential INTEGER NOT NULL DEFAULT 0;

DO $$
DECLARE
  chk RECORD;
BEGIN
  FOR chk IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'school_announcements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%audience%'
  LOOP
    EXECUTE 'ALTER TABLE school_announcements DROP CONSTRAINT ' || quote_ident(chk.conname);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

ALTER TABLE school_announcements
  ADD CONSTRAINT school_announcements_audience_check
  CHECK (audience IN ('ALL', 'PARENTS', 'STUDENTS', 'TEACHERS', 'CLASS', 'STAFF_ONLY'));

-- 2. School Website Profile & Branding Settings (1 per school tenant)
CREATE TABLE IF NOT EXISTS school_website_profiles (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  tagline VARCHAR(255),
  hero_title VARCHAR(255),
  hero_subtitle TEXT,
  hero_image_url TEXT,
  theme_accent VARCHAR(32) NOT NULL DEFAULT 'emerald',
  about_title VARCHAR(255),
  about_body TEXT,
  vision TEXT,
  mission TEXT,
  core_values TEXT,
  principal_name VARCHAR(255),
  principal_title VARCHAR(128) DEFAULT 'The Principal / Head of School',
  principal_message TEXT,
  principal_photo_url TEXT,
  admissions_open INTEGER NOT NULL DEFAULT 1,
  admissions_summary TEXT,
  established_year VARCHAR(16),
  facilities_text TEXT,
  social_whatsapp VARCHAR(128),
  social_facebook VARCHAR(255),
  social_instagram VARCHAR(255),
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. School Website News & Blog Articles
CREATE TABLE IF NOT EXISTS school_website_posts (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT 'News',
  excerpt TEXT,
  content TEXT NOT NULL,
  cover_image_url TEXT,
  author_name VARCHAR(255),
  author_role VARCHAR(128),
  is_published INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_website_posts_school ON school_website_posts(school_id, is_published, is_deleted);

-- 4. School Campus Photo Gallery
CREATE TABLE IF NOT EXISTS school_website_gallery (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  caption TEXT,
  album VARCHAR(64) NOT NULL DEFAULT 'Campus',
  image_url TEXT NOT NULL,
  is_published INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_website_gallery_school ON school_website_gallery(school_id, is_published, is_deleted);

-- 5. School Events & Academic Calendar (PUBLIC for website or STAFF_ONLY internal)
CREATE TABLE IF NOT EXISTS school_calendar_events (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  event_date VARCHAR(32) NOT NULL,
  end_date VARCHAR(32),
  location VARCHAR(255),
  description TEXT,
  visibility VARCHAR(32) NOT NULL DEFAULT 'PUBLIC' CHECK(visibility IN ('PUBLIC', 'STAFF_ONLY')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_school ON school_calendar_events(school_id, visibility, is_deleted);

-- 6. Prospective Student Admission Inquiries (from public school website)
CREATE TABLE IF NOT EXISTS school_admission_inquiries (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_name VARCHAR(255) NOT NULL,
  target_class VARCHAR(64),
  parent_name VARCHAR(255) NOT NULL,
  parent_phone VARCHAR(64) NOT NULL,
  parent_email VARCHAR(255),
  message TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW', 'CONTACTED', 'ENROLLED', 'ARCHIVED')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admission_inquiries_school ON school_admission_inquiries(school_id, status);

-- 7. Lesson Notes & Nigerian NERDC Lesson Plans (Staff Workspace + Principal Review)
CREATE TABLE IF NOT EXISTS lesson_notes (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  teacher_name VARCHAR(255),
  subject_id VARCHAR(64),
  subject_name VARCHAR(128) NOT NULL,
  class_id VARCHAR(64),
  class_name VARCHAR(128) NOT NULL,
  academic_session_id VARCHAR(64),
  term_name VARCHAR(64) DEFAULT '1st Term',
  week_number INTEGER NOT NULL DEFAULT 1,
  duration_minutes INTEGER NOT NULL DEFAULT 40,
  topic VARCHAR(255) NOT NULL,
  sub_topic VARCHAR(255),
  behavioural_objectives TEXT,
  previous_knowledge TEXT,
  instructional_materials TEXT,
  introduction_step TEXT,
  presentation_steps TEXT,
  evaluation_questions TEXT,
  assignment_text TEXT,
  teacher_notes TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REVISION_REQUESTED')),
  admin_feedback TEXT,
  reviewed_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lesson_notes_school ON lesson_notes(school_id, teacher_user_id, status, is_deleted);

-- 8. Class & Teaching Timetable Slots
CREATE TABLE IF NOT EXISTS school_timetable_slots (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id VARCHAR(64) REFERENCES classes(id) ON DELETE CASCADE,
  class_name VARCHAR(128) NOT NULL,
  arm_name VARCHAR(64),
  day_of_week VARCHAR(24) NOT NULL,
  period_label VARCHAR(64),
  start_time VARCHAR(16) NOT NULL,
  end_time VARCHAR(16) NOT NULL,
  subject_name VARCHAR(128) NOT NULL,
  teacher_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  teacher_name VARCHAR(255),
  room_label VARCHAR(64),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_timetable_school ON school_timetable_slots(school_id, class_id, day_of_week, is_deleted);

-- 9. Confidential Staff Requests Desk (Leave, Resources, Maintenance)
CREATE TABLE IF NOT EXISTS staff_requests (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_name VARCHAR(255) NOT NULL,
  request_type VARCHAR(32) NOT NULL DEFAULT 'LEAVE' CHECK(request_type IN ('LEAVE', 'RESOURCES', 'MAINTENANCE', 'GENERAL')),
  subject VARCHAR(255) NOT NULL,
  details TEXT NOT NULL,
  start_date VARCHAR(32),
  end_date VARCHAR(32),
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'DECLINED')),
  admin_response TEXT,
  reviewed_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_requests_school ON staff_requests(school_id, user_id, status, is_deleted);

-- 10. Read/Acknowledgment receipts for confidential staff briefings
CREATE TABLE IF NOT EXISTS staff_announcement_reads (
  id VARCHAR(64) PRIMARY KEY,
  school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  announcement_id VARCHAR(64) NOT NULL REFERENCES school_announcements(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_ann_reads_school ON staff_announcement_reads(school_id, announcement_id);
