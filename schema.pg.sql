-- ==============================================================================
-- BURSARIQ - ENTERPRISE POSTGRESQL SCHEMA (NEON COMPATIBLE)
-- Generated for safe migration from SQLite to Neon Serverless PostgreSQL
-- ==============================================================================

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Schools (Tenants)
CREATE TABLE IF NOT EXISTS schools (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    type VARCHAR(64) NOT NULL,
    status VARCHAR(32) DEFAULT 'TRIAL' CHECK(status IN ('TRIAL', 'ACTIVE', 'GRACE_PERIOD', 'SUSPENDED', 'EXPIRED', 'CANCELLED')),
    address TEXT,
    state VARCHAR(64) NOT NULL,
    lga VARCHAR(128) NOT NULL,
    phone VARCHAR(64) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    website VARCHAR(255),
    logo_url TEXT,
    current_plan_id VARCHAR(64),
    subscription_end_date DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 2. School Settings
CREATE TABLE IF NOT EXISTS school_settings (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) UNIQUE NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    currency VARCHAR(10) DEFAULT 'NGN',
    currency_symbol VARCHAR(10) DEFAULT '₦',
    current_academic_session VARCHAR(64) DEFAULT '2024/2025',
    current_term VARCHAR(64) DEFAULT '1st Term',
    payment_notification_email VARCHAR(255),
    payment_notification_sms INTEGER DEFAULT 0,
    portal_subdomain VARCHAR(128),
    allow_partial_payments INTEGER DEFAULT 1,
    bank_name VARCHAR(128),
    account_number VARCHAR(32),
    account_name VARCHAR(255),
    paystack_public_key TEXT,
    paystack_secret_key TEXT,
    flutterwave_public_key TEXT,
    flutterwave_secret_key TEXT,
    bachs_merchant_id VARCHAR(128),
    bachs_api_key TEXT,
    bachs_secret_key TEXT,
    default_payment_provider VARCHAR(64) DEFAULT 'SANDBOX',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 3. Roles
CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(128) NOT NULL,
    description TEXT,
    scope VARCHAR(32) NOT NULL CHECK(scope IN ('PLATFORM', 'SCHOOL'))
);

-- 4. Permissions
CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL
);

-- 5. Role Permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id VARCHAR(64) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(64) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 6. Users
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt VARCHAR(128) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(64),
    recovery_email VARCHAR(255),
    recovery_phone VARCHAR(64),
    security_question_1 TEXT,
    security_answer_hash_1 TEXT,
    security_answer_salt_1 TEXT,
    security_question_2 TEXT,
    security_answer_hash_2 TEXT,
    security_answer_salt_2 TEXT,
    recovery_attempts INTEGER DEFAULT 0,
    recovery_locked_until TIMESTAMPTZ,
    is_platform_admin INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 7. User Roles
CREATE TABLE IF NOT EXISTS user_roles (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    school_id VARCHAR(64) REFERENCES schools(id) ON DELETE CASCADE,
    role_id VARCHAR(64) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    is_primary INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT,
    UNIQUE (user_id, school_id, role_id)
);

-- 8. Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(128) PRIMARY KEY,
    token VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    school_id VARCHAR(64) REFERENCES schools(id) ON DELETE CASCADE,
    ip_address VARCHAR(128),
    user_agent TEXT,
    impersonated_by VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 9. Academic Sessions
CREATE TABLE IF NOT EXISTS academic_sessions (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 10. Terms
CREATE TABLE IF NOT EXISTS terms (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_session_id VARCHAR(64) NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 11. Classes
CREATE TABLE IF NOT EXISTS classes (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    level VARCHAR(64) DEFAULT 'General',
    code VARCHAR(32),
    level_order INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    academic_session_id VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 12. Class Arms
CREATE TABLE IF NOT EXISTS class_arms (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id VARCHAR(64) NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    capacity INTEGER DEFAULT 40,
    class_teacher_id VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 13. Staff
CREATE TABLE IF NOT EXISTS staff (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    staff_id_number VARCHAR(64),
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(64),
    designation VARCHAR(128),
    department VARCHAR(128),
    employment_date DATE,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 14. Parents
CREATE TABLE IF NOT EXISTS parents (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(32),
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(64),
    alternate_phone VARCHAR(64),
    occupation VARCHAR(128),
    home_address TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 15. Students
CREATE TABLE IF NOT EXISTS students (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    admission_number VARCHAR(64),
    first_name VARCHAR(128) NOT NULL,
    middle_name VARCHAR(128) DEFAULT '',
    last_name VARCHAR(128) NOT NULL,
    gender VARCHAR(16),
    date_of_birth DATE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    class_arm_id VARCHAR(64) REFERENCES class_arms(id) ON DELETE SET NULL,
    class_arm_name VARCHAR(64),
    academic_session_id VARCHAR(64),
    admission_date DATE,
    student_status VARCHAR(32) DEFAULT 'ACTIVE',
    profile_photo_url TEXT,
    emergency_contact VARCHAR(128),
    medical_notes TEXT,
    phone VARCHAR(64),
    email VARCHAR(255),
    address TEXT,
    state VARCHAR(64),
    nationality VARCHAR(64) DEFAULT 'Nigerian',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT,
    UNIQUE (school_id, admission_number)
);

-- 16. Parent Students Bridge
CREATE TABLE IF NOT EXISTS parent_students (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    parent_id VARCHAR(64) NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    relationship VARCHAR(64) DEFAULT 'Parent',
    relationship_type VARCHAR(64) DEFAULT 'Parent',
    is_primary_contact INTEGER DEFAULT 1,
    is_emergency_contact INTEGER DEFAULT 1,
    verified_by VARCHAR(64),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT,
    UNIQUE (school_id, parent_id, student_id)
);

-- 17. Fee Categories
CREATE TABLE IF NOT EXISTS fee_categories (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    is_system_default INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 18. Fees
CREATE TABLE IF NOT EXISTS fees (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    category_id VARCHAR(64) NOT NULL REFERENCES fee_categories(id) ON DELETE RESTRICT,
    name VARCHAR(128) NOT NULL,
    amount BIGINT NOT NULL,
    description TEXT,
    is_optional INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 19. Fee Structures
CREATE TABLE IF NOT EXISTS fee_structures (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    academic_session_id VARCHAR(64) NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    term_id VARCHAR(64) NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 20. Fee Structure Items
CREATE TABLE IF NOT EXISTS fee_structure_items (
    id VARCHAR(64) PRIMARY KEY,
    fee_structure_id VARCHAR(64) NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
    fee_category_id VARCHAR(64) NOT NULL REFERENCES fee_categories(id) ON DELETE RESTRICT,
    amount BIGINT NOT NULL,
    is_mandatory INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 21. Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    invoice_number VARCHAR(64) NOT NULL,
    academic_session_id VARCHAR(64) NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    term_id VARCHAR(64) NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    subtotal BIGINT NOT NULL,
    discount BIGINT DEFAULT 0,
    total BIGINT NOT NULL,
    amount_paid BIGINT DEFAULT 0,
    balance BIGINT NOT NULL,
    status VARCHAR(32) DEFAULT 'ISSUED' CHECK(status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT,
    UNIQUE (school_id, invoice_number)
);

-- 22. Invoice Items
CREATE TABLE IF NOT EXISTS invoice_items (
    id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    fee_category_id VARCHAR(64) NOT NULL REFERENCES fee_categories(id) ON DELETE RESTRICT,
    description VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 23. Invoice Discounts
CREATE TABLE IF NOT EXISTS invoice_discounts (
    id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    type VARCHAR(32) NOT NULL,
    value BIGINT NOT NULL,
    amount BIGINT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 24. Student Fee Assignments
CREATE TABLE IF NOT EXISTS student_fee_assignments (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    fee_structure_id VARCHAR(64) NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
    academic_session_id VARCHAR(64) NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    term_id VARCHAR(64) NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 25. Payments
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    invoice_id VARCHAR(64) REFERENCES invoices(id) ON DELETE SET NULL,
    student_id VARCHAR(64) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    payment_reference VARCHAR(128) NOT NULL,
    amount BIGINT NOT NULL,
    currency VARCHAR(10) DEFAULT 'NGN',
    payment_method VARCHAR(64) NOT NULL,
    provider VARCHAR(64) DEFAULT 'SANDBOX',
    provider_reference VARCHAR(128),
    internal_reference VARCHAR(128),
    status VARCHAR(32) DEFAULT 'SUCCESS' CHECK(status IN ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
    payment_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    verified_by VARCHAR(64),
    notes TEXT,
    metadata TEXT,
    received_by VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_reversed INTEGER DEFAULT 0,
    reversed_at TIMESTAMPTZ,
    reversed_by VARCHAR(64),
    reversal_reason TEXT,
    is_refunded INTEGER DEFAULT 0,
    refunded_at TIMESTAMPTZ,
    refunded_by VARCHAR(64),
    refund_reason TEXT,
    refund_amount BIGINT DEFAULT 0,
    reconciliation_status VARCHAR(32) DEFAULT 'UNRECONCILED',
    reconciled_at TIMESTAMPTZ,
    reconciled_by VARCHAR(64),
    reconciliation_notes TEXT,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT,
    UNIQUE (school_id, payment_reference)
);

-- 26. Receipts
CREATE TABLE IF NOT EXISTS receipts (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    payment_id VARCHAR(64) NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    receipt_number VARCHAR(128) NOT NULL,
    issued_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    pdf_url TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT,
    UNIQUE (school_id, receipt_number)
);

-- 27. Payment Reversals
CREATE TABLE IF NOT EXISTS payment_reversals (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    payment_id VARCHAR(64) NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    reason TEXT NOT NULL,
    requested_by VARCHAR(64) NOT NULL,
    approved_by VARCHAR(64),
    status VARCHAR(32) DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 28. Bank Statement Entries
CREATE TABLE IF NOT EXISTS bank_statement_entries (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    value_date DATE,
    description TEXT NOT NULL,
    reference VARCHAR(128),
    amount BIGINT NOT NULL,
    entry_type VARCHAR(16) NOT NULL CHECK(entry_type IN ('CREDIT', 'DEBIT')),
    balance_after BIGINT,
    matched_payment_id VARCHAR(64) REFERENCES payments(id) ON DELETE SET NULL,
    status VARCHAR(32) DEFAULT 'UNMATCHED' CHECK(status IN ('UNMATCHED', 'MATCHED', 'IGNORED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 29. Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id VARCHAR(64),
    type VARCHAR(64) DEFAULT 'SYSTEM',
    recipient_type VARCHAR(32),
    recipient_id VARCHAR(64),
    recipient_address VARCHAR(255),
    channel VARCHAR(32) DEFAULT 'IN_APP',
    template_type VARCHAR(64),
    title VARCHAR(255) NOT NULL,
    message TEXT,
    body TEXT,
    data TEXT,
    read_at TIMESTAMPTZ,
    status VARCHAR(32) DEFAULT 'PENDING',
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 30. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    school_id VARCHAR(64) REFERENCES schools(id) ON DELETE SET NULL,
    action VARCHAR(128) NOT NULL,
    entity VARCHAR(128) NOT NULL,
    entity_id VARCHAR(128),
    ip_address VARCHAR(128),
    metadata TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 31. Subscription Plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    price_kobo BIGINT NOT NULL DEFAULT 0,
    annual_price_kobo BIGINT NOT NULL DEFAULT 0,
    termly_price_kobo BIGINT NOT NULL DEFAULT 0,
    billing_cycle VARCHAR(32) NOT NULL DEFAULT 'TERMLY',
    student_limit INTEGER NOT NULL DEFAULT 250,
    features TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 32. School Subscriptions
CREATE TABLE IF NOT EXISTS school_subscriptions (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    plan_id VARCHAR(64) NOT NULL REFERENCES subscription_plans(id),
    billing_cycle VARCHAR(32) NOT NULL DEFAULT 'TERMLY',
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'TRIALING', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED', 'EXPIRED')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    amount_paid_kobo BIGINT NOT NULL DEFAULT 0,
    auto_renew INTEGER DEFAULT 1,
    last_payment_reference VARCHAR(128),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(64),
    deletion_reason TEXT
);

-- 33. Subscription Discounts
CREATE TABLE IF NOT EXISTS subscription_discounts (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    discount_percent NUMERIC(5, 2) NOT NULL,
    valid_until DATE,
    max_uses INTEGER DEFAULT 100,
    times_used INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 34. Platform Invoices
CREATE TABLE IF NOT EXISTS platform_invoices (
    id VARCHAR(64) PRIMARY KEY,
    invoice_number VARCHAR(128) NOT NULL UNIQUE,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    plan_id VARCHAR(64) NOT NULL REFERENCES subscription_plans(id),
    amount_kobo BIGINT NOT NULL,
    discount_kobo BIGINT DEFAULT 0,
    final_amount_kobo BIGINT NOT NULL,
    status VARCHAR(32) DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED')),
    due_date DATE NOT NULL,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 35. Platform Payments
CREATE TABLE IF NOT EXISTS platform_payments (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    invoice_id VARCHAR(64) REFERENCES platform_invoices(id),
    plan_id VARCHAR(64) REFERENCES subscription_plans(id),
    amount_kobo BIGINT NOT NULL,
    payment_method VARCHAR(64) NOT NULL DEFAULT 'ONLINE_CARD',
    gateway_provider VARCHAR(64) DEFAULT 'SANDBOX',
    gateway_reference VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(32) DEFAULT 'SUCCESS' CHECK(status IN ('PENDING', 'SUCCESS', 'FAILED')),
    paid_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    verified_by VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 36. Partners
CREATE TABLE IF NOT EXISTS partners (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    company_name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(128) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(64) NOT NULL,
    referral_code VARCHAR(64) NOT NULL UNIQUE,
    commission_rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 15.00,
    total_earned_kobo BIGINT DEFAULT 0,
    total_paid_kobo BIGINT DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 37. Commissions
CREATE TABLE IF NOT EXISTS commissions (
    id VARCHAR(64) PRIMARY KEY,
    partner_id VARCHAR(64) NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    platform_payment_id VARCHAR(64) REFERENCES platform_payments(id),
    amount_kobo BIGINT NOT NULL,
    status VARCHAR(32) DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PAID', 'CANCELLED')),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 38. Platform Settings
CREATE TABLE IF NOT EXISTS platform_settings (
    id VARCHAR(64) PRIMARY KEY,
    platform_name VARCHAR(128) DEFAULT 'BursarIQ',
    support_email VARCHAR(255) DEFAULT 'support@bursariq.ng',
    support_phone VARCHAR(64) DEFAULT '+2348000000000',
    trial_period_days INTEGER DEFAULT 30,
    grace_period_days INTEGER DEFAULT 14,
    default_partner_commission_percent NUMERIC(5, 2) DEFAULT 15.00,
    bachs_platform_merchant_id VARCHAR(128),
    bachs_platform_api_key TEXT,
    bachs_platform_secret_key TEXT,
    paystack_platform_secret_key TEXT,
    flutterwave_platform_secret_key TEXT,
    maintenance_mode INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 39. Password Resets
CREATE TABLE IF NOT EXISTS password_resets (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 40. User Recovery Codes
CREATE TABLE IF NOT EXISTS user_recovery_codes (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    salt VARCHAR(128) NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 41. Recovery Challenges
CREATE TABLE IF NOT EXISTS recovery_challenges (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method VARCHAR(64) NOT NULL,
    otp_hash TEXT,
    otp_salt VARCHAR(128),
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 42. Webhook Events
CREATE TABLE IF NOT EXISTS webhook_events (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(128) UNIQUE NOT NULL,
    provider VARCHAR(64) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload TEXT NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) DEFAULT 'PROCESSED'
);

-- 43. Schema Migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 44. Database Backups
CREATE TABLE IF NOT EXISTS database_backups (
    id VARCHAR(64) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    filepath TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    trigger_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMPTZ,
    test_restored_at TIMESTAMPTZ
);

-- ==============================================================================
-- PERFORMANCE MANAGEMENT, REPORT CARDS, ATTENDANCE, BEHAVIOUR & PORTALS
-- ==============================================================================

INSERT INTO roles (id, name, display_name, description, scope)
VALUES ('role_student', 'STUDENT', 'Student / Learner', 'Student portal read-only access to published results, attendance, and report cards', 'SCHOOL')
ON CONFLICT (name) DO NOTHING;

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

CREATE TABLE IF NOT EXISTS school_announcements (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    audience VARCHAR(32) NOT NULL DEFAULT 'ALL' CHECK(audience IN ('ALL', 'PARENTS', 'STUDENTS', 'TEACHERS', 'CLASS', 'STAFF_ONLY')),
    target_class_id VARCHAR(64) REFERENCES classes(id) ON DELETE SET NULL,
    priority VARCHAR(32) NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('NORMAL', 'IMPORTANT', 'URGENT')),
    is_confidential INTEGER NOT NULL DEFAULT 0,
    is_published INTEGER NOT NULL DEFAULT 1,
    published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(255),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS staff_announcement_reads (
    id VARCHAR(64) PRIMARY KEY,
    school_id VARCHAR(64) NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    announcement_id VARCHAR(64) NOT NULL REFERENCES school_announcements(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (announcement_id, user_id)
);

