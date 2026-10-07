-- ==============================================================================
-- SCHOOL PAY MANAGER - D1 / SQLITE MULTI-TENANT DATABASE SCHEMA (STEP 1)
-- ==============================================================================

-- 1. Schools (Tenants)
CREATE TABLE IF NOT EXISTS schools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL, -- 'Nursery & Primary', 'Secondary', 'Comprehensive / K-12', 'Vocational / Technical', 'International'
    status TEXT DEFAULT 'TRIAL' CHECK(status IN ('TRIAL', 'ACTIVE', 'GRACE_PERIOD', 'SUSPENDED', 'EXPIRED', 'CANCELLED')),
    address TEXT,
    state TEXT NOT NULL, -- Nigerian 36 States + FCT
    lga TEXT NOT NULL,   -- Local Government Area
    phone TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    website TEXT,
    logo_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. School Settings (Per-tenant configuration)
CREATE TABLE IF NOT EXISTS school_settings (
    id TEXT PRIMARY KEY,
    school_id TEXT UNIQUE NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    currency TEXT DEFAULT 'NGN',
    currency_symbol TEXT DEFAULT '₦',
    current_academic_session TEXT DEFAULT '2024/2025',
    current_term TEXT DEFAULT '1st Term',
    payment_notification_email TEXT,
    payment_notification_sms INTEGER DEFAULT 0,
    portal_subdomain TEXT,
    allow_partial_payments INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Platform & School Roles
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE, -- SUPER_ADMIN, SCHOOL_OWNER, SCHOOL_ADMIN, BURSAR, TEACHER, STAFF, PARENT, PARTNER
    display_name TEXT NOT NULL,
    description TEXT,
    scope TEXT NOT NULL CHECK(scope IN ('PLATFORM', 'SCHOOL'))
);

-- 4. Permissions
CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL
);

-- 5. Role Permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 6. Users (Global platform accounts; linked to tenants via user_roles)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    is_platform_admin INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. User Roles (Multi-tenant bridge mapping users to schools with distinct roles)
CREATE TABLE IF NOT EXISTS user_roles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    school_id TEXT REFERENCES schools(id) ON DELETE CASCADE, -- NULL for PLATFORM SUPER_ADMIN
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    is_primary INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, school_id, role_id)
);

-- 8. Sessions (Server-side session management)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    school_id TEXT REFERENCES schools(id) ON DELETE CASCADE, -- Currently active school tenant
    ip_address TEXT,
    user_agent TEXT,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. Password Resets (Secure time-limited reset tokens)
CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. Academic Sessions (School-owned academic years, e.g., '2024/2025')
CREATE TABLE IF NOT EXISTS academic_sessions (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'UPCOMING' CHECK(status IN ('UPCOMING', 'ACTIVE', 'COMPLETED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. Terms (School-owned academic terms/semesters, e.g., '1st Term', '2nd Term', '3rd Term')
CREATE TABLE IF NOT EXISTS terms (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'UPCOMING' CHECK(status IN ('UPCOMING', 'ACTIVE', 'COMPLETED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 12. Staff (School-owned personnel, teachers, administrative and financial staff)
CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    staff_number TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    gender TEXT,
    address TEXT,
    job_title TEXT NOT NULL,
    department TEXT,
    employment_status TEXT DEFAULT 'ACTIVE' CHECK(employment_status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'LEFT')),
    date_joined TEXT,
    profile_photo_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, staff_number)
);

-- 13. Classes (School-owned academic levels)
CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    level TEXT NOT NULL,
    academic_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14. Class Arms / Streams (e.g., 'Gold', 'Silver', 'Science', 'A', 'B')
CREATE TABLE IF NOT EXISTS class_arms (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    capacity INTEGER DEFAULT 40,
    class_teacher_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 15. Parents / Guardians (Strictly tenant-scoped family guardians)
CREATE TABLE IF NOT EXISTS parents (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT,
    occupation TEXT,
    relationship TEXT DEFAULT 'Parent',
    emergency_contact TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 16. Students (Strictly tenant-owned learner records)
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    admission_number TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    gender TEXT,
    date_of_birth TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    state TEXT,
    nationality TEXT DEFAULT 'Nigerian',
    admission_date TEXT,
    student_status TEXT DEFAULT 'ACTIVE' CHECK(student_status IN ('ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'WITHDRAWN', 'SUSPENDED')),
    class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
    class_arm_id TEXT REFERENCES class_arms(id) ON DELETE SET NULL,
    class_name TEXT,
    class_arm_name TEXT,
    academic_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
    profile_photo_url TEXT,
    emergency_contact TEXT,
    medical_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, admission_number)
);

-- 17. Parent-Student Relationships (Tenant-consistent many-to-many bridge)
CREATE TABLE IF NOT EXISTS parent_students (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    parent_id TEXT NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    relationship_type TEXT DEFAULT 'Parent',
    is_primary_contact INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (parent_id, student_id)
);

-- 18. Fee Categories (e.g., Tuition, Uniform, Transport, Exam, Boarding)
CREATE TABLE IF NOT EXISTS fee_categories (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, name)
);

-- 19. Fee Structures (Class & session-specific fee templates)
CREATE TABLE IF NOT EXISTS fee_structures (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
    academic_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
    term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 20. Fee Structure Items (Line items with exact kobo minor units)
CREATE TABLE IF NOT EXISTS fee_structure_items (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    fee_structure_id TEXT NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
    fee_category_id TEXT NOT NULL REFERENCES fee_categories(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- Integer amount in Kobo (e.g. 50,000 NGN = 5,000,000 kobo)
    compulsory INTEGER DEFAULT 1,
    due_date TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 21. Invoices (Student fee bills, strictly tenant-isolated)
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    academic_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
    term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
    class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    subtotal INTEGER NOT NULL DEFAULT 0, -- In kobo
    discount INTEGER NOT NULL DEFAULT 0, -- In kobo
    total INTEGER NOT NULL DEFAULT 0,    -- In kobo
    amount_paid INTEGER NOT NULL DEFAULT 0, -- In kobo
    balance INTEGER NOT NULL DEFAULT 0,  -- In kobo
    status TEXT DEFAULT 'ISSUED' CHECK(status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, invoice_number)
);

-- 22. Invoice Line Items
CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    fee_category_id TEXT REFERENCES fee_categories(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_amount INTEGER NOT NULL, -- In kobo
    total_amount INTEGER NOT NULL, -- In kobo
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 23. Invoice Discounts / Scholarships / Waivers
CREATE TABLE IF NOT EXISTS invoice_discounts (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('FIXED', 'PERCENTAGE', 'SCHOLARSHIP', 'WAIVER')),
    amount INTEGER NOT NULL, -- In kobo
    percentage REAL,
    reason TEXT NOT NULL,
    authorized_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 24. Payments (Receipted transactions against invoices)
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    payment_reference TEXT NOT NULL,
    amount INTEGER NOT NULL, -- In kobo
    payment_method TEXT NOT NULL CHECK(payment_method IN ('BANK_TRANSFER', 'POS', 'CASH', 'ONLINE', 'CHEQUE')),
    payment_date TEXT NOT NULL,
    notes TEXT,
    received_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, payment_reference)
);

-- 25. Student Fee Assignments
CREATE TABLE IF NOT EXISTS student_fee_assignments (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    fee_structure_id TEXT NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
    academic_session_id TEXT REFERENCES academic_sessions(id) ON DELETE SET NULL,
    term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, fee_structure_id, term_id)
);

-- Legacy fees table retained for backward compatibility
CREATE TABLE IF NOT EXISTS fees (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 26. Audit Logs (Immutable platform & tenant audit trail)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_email TEXT,
    school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    ip_address TEXT,
    metadata TEXT, -- JSON payload
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- INDEXES FOR ZERO-OVERHEAD PERFORMANCE (Free-tier optimization)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_schools_status ON schools(status);
CREATE INDEX IF NOT EXISTS idx_schools_slug ON schools(slug);
CREATE INDEX IF NOT EXISTS idx_user_roles_lookup ON user_roles(user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_school ON user_roles(school_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_academic_sessions_school ON academic_sessions(school_id);
CREATE INDEX IF NOT EXISTS idx_terms_school ON terms(school_id);
CREATE INDEX IF NOT EXISTS idx_terms_session ON terms(academic_session_id);
CREATE INDEX IF NOT EXISTS idx_staff_school ON staff(school_id);
CREATE INDEX IF NOT EXISTS idx_staff_number ON staff(school_id, staff_number);
CREATE INDEX IF NOT EXISTS idx_classes_school ON classes(school_id);
CREATE INDEX IF NOT EXISTS idx_class_arms_school ON class_arms(school_id);
CREATE INDEX IF NOT EXISTS idx_class_arms_class ON class_arms(class_id);
CREATE INDEX IF NOT EXISTS idx_parents_school ON parents(school_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_school ON parent_students(school_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_parent ON parent_students(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students(student_id);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_admission ON students(school_id, admission_number);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_arm ON students(class_arm_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(school_id, student_status);
CREATE INDEX IF NOT EXISTS idx_fees_school ON fees(school_id);
CREATE INDEX IF NOT EXISTS idx_fee_categories_school ON fee_categories(school_id);
CREATE INDEX IF NOT EXISTS idx_fee_structures_school ON fee_structures(school_id);
CREATE INDEX IF NOT EXISTS idx_fee_structures_class ON fee_structures(class_id);
CREATE INDEX IF NOT EXISTS idx_fee_structure_items_fs ON fee_structure_items(fee_structure_id);
CREATE INDEX IF NOT EXISTS idx_invoices_school ON invoices(school_id);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(school_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(school_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_discounts_invoice ON invoice_discounts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_school ON payments(school_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_assignments_student ON student_fee_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ==============================================================================
-- SEED INITIAL DATA (Roles & Permissions)
-- ==============================================================================

INSERT OR IGNORE INTO roles (id, name, display_name, description, scope) VALUES
('role_super_admin', 'SUPER_ADMIN', 'Super Admin', 'Platform administrator with global visibility and governance', 'PLATFORM'),
('role_school_owner', 'SCHOOL_OWNER', 'School Proprietor / Owner', 'Ultimate authority and financial owner of the school tenant', 'SCHOOL'),
('role_school_admin', 'SCHOOL_ADMIN', 'School Principal / Administrator', 'Academic and operational manager of the school', 'SCHOOL'),
('role_bursar', 'BURSAR', 'Bursar / Financial Officer', 'Manages billing, reconciliations, collections, and student accounts', 'SCHOOL'),
('role_teacher', 'TEACHER', 'Teacher / Educator', 'Class management, attendance, and student performance tracking', 'SCHOOL'),
('role_staff', 'STAFF', 'Administrative Staff', 'General support and administrative staff', 'SCHOOL'),
('role_parent', 'PARENT', 'Parent / Guardian', 'Parent portal access to view student balances and payment receipts', 'SCHOOL'),
('role_partner', 'PARTNER', 'Integration / Bank Partner', 'Read-only financial audit and settlement reconciliation partner', 'SCHOOL');

INSERT OR IGNORE INTO permissions (id, code, name, category) VALUES
('perm_sa_manage', 'platform:manage', 'Full Platform Administration', 'PLATFORM'),
('perm_sa_schools', 'platform:schools:view', 'View All School Tenants', 'PLATFORM'),
('perm_sa_status', 'platform:schools:status', 'Update School Account Status', 'PLATFORM'),
('perm_sch_view', 'school:profile:read', 'View School Profile', 'SCHOOL'),
('perm_sch_update', 'school:profile:update', 'Update School Profile', 'SCHOOL'),
('perm_sch_settings', 'school:settings:update', 'Update School Financial Settings', 'SCHOOL'),
('perm_sch_users', 'school:users:manage', 'Manage School Staff & Roles', 'SCHOOL'),
('perm_sch_audit', 'school:audit:view', 'View School Audit Trail', 'SCHOOL');
