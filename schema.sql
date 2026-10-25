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
    recovery_email TEXT,
    recovery_phone TEXT,
    security_question_1 TEXT,
    security_answer_hash_1 TEXT,
    security_answer_salt_1 TEXT,
    security_question_2 TEXT,
    security_answer_hash_2 TEXT,
    security_answer_salt_2 TEXT,
    recovery_attempts INTEGER DEFAULT 0,
    recovery_locked_until DATETIME,
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
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    recovery_method TEXT DEFAULT 'EMAIL_LINK',
    expires_at DATETIME NOT NULL,
    verified_at DATETIME,
    used_at DATETIME,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9b. User Emergency Backup Recovery Codes
CREATE TABLE IF NOT EXISTS user_recovery_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9c. Account Recovery Challenges (Multi-step verification state)
CREATE TABLE IF NOT EXISTS recovery_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    identifier TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    expires_at DATETIME NOT NULL,
    verified_at DATETIME,
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
    staff_number TEXT,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    gender TEXT,
    address TEXT,
    job_title TEXT DEFAULT 'Staff Member',
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
    phone TEXT,
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
    admission_number TEXT,
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
    currency TEXT DEFAULT 'NGN',
    payment_method TEXT NOT NULL CHECK(payment_method IN ('BANK_TRANSFER', 'POS', 'CASH', 'ONLINE', 'CHEQUE', 'OTHER')),
    provider TEXT DEFAULT 'MANUAL', -- 'MANUAL', 'PAYSTACK', 'FLUTTERWAVE', 'MONIEPOINT', 'TEST_SANDBOX'
    provider_reference TEXT,
    internal_reference TEXT,
    status TEXT DEFAULT 'SUCCESS' CHECK(status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED', 'REVERSED')),
    payment_date TEXT NOT NULL,
    paid_at TEXT,
    verified_at TEXT,
    verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    metadata TEXT, -- JSON payload
    received_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, payment_reference)
);

-- 25. Receipts (Official immutable numbered payment vouchers)
CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    receipt_number TEXT NOT NULL,
    payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- In kobo
    previous_balance INTEGER NOT NULL, -- In kobo
    current_balance INTEGER NOT NULL, -- In kobo
    issue_date TEXT NOT NULL,
    issued_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (school_id, receipt_number)
);

-- 26. Webhook Events (Audit trail & idempotency log for payment gateways)
CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    provider_reference TEXT,
    payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PROCESSED', 'FAILED', 'IGNORED', 'DUPLICATE', 'PENDING')),
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 27. Notifications (Multi-channel in-app notification center)
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('INVOICE_CREATED', 'PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'PAYMENT_VERIFIED', 'INVOICE_OVERDUE', 'RECEIPT_AVAILABLE', 'ANNOUNCEMENT', 'SYSTEM')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT, -- JSON payload
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 28. Student Fee Assignments
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

-- 29. Audit Logs (Immutable platform & tenant audit trail)
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
-- STEP 5: PLATFORM SUPER ADMIN, SUBSCRIPTIONS & SAAS TABLES
-- ==============================================================================

-- 30. Subscription Plans (Configurable SaaS Pricing Tiers)
CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0, -- In kobo (minor unit)
    currency TEXT NOT NULL DEFAULT 'NGN',
    billing_interval TEXT NOT NULL CHECK(billing_interval IN ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM', 'TERM', 'LIFETIME')),
    billing_interval_count INTEGER NOT NULL DEFAULT 1,
    trial_days INTEGER NOT NULL DEFAULT 30,
    maximum_students INTEGER NOT NULL DEFAULT 200,
    maximum_staff INTEGER NOT NULL DEFAULT 25,
    maximum_admin_users INTEGER NOT NULL DEFAULT 5,
    student_limit INTEGER NOT NULL DEFAULT 200,
    staff_limit INTEGER NOT NULL DEFAULT 25,
    storage_limit_mb INTEGER NOT NULL DEFAULT 1000,
    feature_limits TEXT, -- JSON string
    feature_flags TEXT NOT NULL, -- JSON string
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 31. Subscription Discounts & Promotions (Super Admin Controlled)
CREATE TABLE IF NOT EXISTS subscription_discounts (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('PERCENTAGE', 'FIXED')),
    discount_value INTEGER NOT NULL, -- percentage integer (e.g. 15 for 15%) or fixed kobo amount
    school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
    active INTEGER NOT NULL DEFAULT 1,
    expires_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 32. School Subscriptions (Tenant Subscription Lifecycle & History)
CREATE TABLE IF NOT EXISTS school_subscriptions (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'TRIAL', 'GRACE_PERIOD', 'PAST_DUE', 'SUSPENDED', 'EXPIRED', 'CANCELLED')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    expiry_date DATE,
    renewal_date DATE,
    trial_end_date DATE,
    auto_renew INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'MANUAL',
    provider_reference TEXT,
    standard_plan_price INTEGER NOT NULL DEFAULT 0, -- in kobo
    negotiated_price INTEGER, -- in kobo, custom negotiated by SUPER_ADMIN
    discount_amount INTEGER NOT NULL DEFAULT 0, -- in kobo
    discount_reason TEXT,
    final_amount INTEGER NOT NULL DEFAULT 0, -- authoritative checkout amount in kobo
    currency TEXT NOT NULL DEFAULT 'NGN',
    amount_paid INTEGER NOT NULL DEFAULT 0, -- in kobo
    grace_period_days INTEGER NOT NULL DEFAULT 7,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 33. Platform SaaS Invoices (Generated for School Tenants by Super Admin)
CREATE TABLE IF NOT EXISTS platform_invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    subscription_id TEXT NOT NULL REFERENCES school_subscriptions(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
    billing_period TEXT,
    standard_price INTEGER NOT NULL, -- in kobo
    discount INTEGER NOT NULL DEFAULT 0, -- in kobo
    negotiated_price INTEGER, -- in kobo
    final_amount INTEGER NOT NULL, -- in kobo
    currency TEXT NOT NULL DEFAULT 'NGN',
    payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(payment_status IN ('PAID', 'PENDING', 'OVERDUE', 'CANCELLED')),
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    paid_at DATETIME,
    payment_method TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 34. Platform Payments (SaaS subscription billing - separated from school fees)
CREATE TABLE IF NOT EXISTS platform_payments (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    subscription_id TEXT REFERENCES school_subscriptions(id) ON DELETE SET NULL,
    plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
    invoice_id TEXT REFERENCES platform_invoices(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL, -- In kobo
    currency TEXT NOT NULL DEFAULT 'NGN',
    payment_method TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'MANUAL',
    provider_transaction_id TEXT,
    provider_reference TEXT,
    internal_reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'PENDING', 'FAILED', 'REFUNDED')),
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 35. Platform Settings (Global Super Admin Configurations)
CREATE TABLE IF NOT EXISTS platform_settings (
    id TEXT PRIMARY KEY,
    default_currency TEXT NOT NULL DEFAULT 'NGN',
    default_grace_period_days INTEGER NOT NULL DEFAULT 7,
    default_trial_days INTEGER NOT NULL DEFAULT 30,
    bachs_enabled INTEGER NOT NULL DEFAULT 1,
    bank_transfer_enabled INTEGER NOT NULL DEFAULT 1,
    invoice_payments_enabled INTEGER NOT NULL DEFAULT 1,
    platform_bank_name TEXT DEFAULT 'Zenith Bank Plc',
    platform_account_name TEXT DEFAULT 'School Pay Manager Global Ltd',
    platform_account_number TEXT DEFAULT '2208744650',
        opay_account_name TEXT DEFAULT 'Nwajiaku Arinzechukwu Christian',
        opay_account_number TEXT DEFAULT '8160754659',
    platform_contact_email TEXT DEFAULT 'billing@schoolpaymanager.ng',
    platform_contact_phone TEXT DEFAULT '+234 1 234 5678',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 36. Partners (Integration, Bank & Referral Partners)
CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    company TEXT,
    partner_type TEXT NOT NULL CHECK(partner_type IN ('BANK', 'REFERRAL', 'INTEGRATION', 'RESELLER')),
    commission_rate REAL NOT NULL DEFAULT 10.0,
    referral_code TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 34. Commissions (Partner Revenue Share on Platform Subscriptions)
CREATE TABLE IF NOT EXISTS commissions (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
    platform_payment_id TEXT REFERENCES platform_payments(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL, -- In kobo
    rate_percent REAL NOT NULL DEFAULT 10.0,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED')),
    notes TEXT,
    paid_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(school_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_internal_ref ON payments(school_id, internal_reference);
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider_reference);
CREATE INDEX IF NOT EXISTS idx_receipts_school ON receipts(school_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment ON receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_receipts_student ON receipts(student_id);
CREATE INDEX IF NOT EXISTS idx_receipts_number ON receipts(school_id, receipt_number);
CREATE INDEX IF NOT EXISTS idx_webhook_events_school ON webhook_events(school_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_idempotency ON webhook_events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_notifications_school ON notifications(school_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_fee_assignments_student ON student_fee_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_plans_active ON subscription_plans(active);
CREATE INDEX IF NOT EXISTS idx_subs_school ON school_subscriptions(school_id);
CREATE INDEX IF NOT EXISTS idx_subs_plan ON school_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON school_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_plat_payments_school ON platform_payments(school_id);
CREATE INDEX IF NOT EXISTS idx_plat_payments_status ON platform_payments(status);
CREATE INDEX IF NOT EXISTS idx_partners_code ON partners(referral_code);
CREATE INDEX IF NOT EXISTS idx_commissions_partner ON commissions(partner_id);

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


-- 45. Payment Reversals
CREATE TABLE IF NOT EXISTS payment_reversals (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
    amount_kobo INTEGER NOT NULL,
    reversal_type TEXT DEFAULT 'FULL_REVERSAL',
    reason TEXT NOT NULL,
    initiated_by TEXT NOT NULL,
    approved_by TEXT,
    status TEXT DEFAULT 'APPROVED',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_reversals_school ON payment_reversals(school_id);


-- 46. Bank Statement Entries
CREATE TABLE IF NOT EXISTS bank_statement_entries (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    transaction_date TEXT NOT NULL,
    value_date TEXT,
    description TEXT NOT NULL,
    reference TEXT,
    amount INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bank_entries_school ON bank_statement_entries(school_id);
