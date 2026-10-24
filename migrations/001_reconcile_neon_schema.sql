-- ==============================================================================
-- BURSARIQ - MIGRATION 001: RECONCILE POSTGRESQL SCHEMA WITH SQLITE APP STATE
-- Safely adds missing columns with IF NOT EXISTS to guarantee 100% schema parity
-- ==============================================================================

-- 1. Academic Sessions
ALTER TABLE academic_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'UPCOMING';

-- 2. Bank Statement Entries
ALTER TABLE bank_statement_entries ADD COLUMN IF NOT EXISTS amount_kobo BIGINT;
ALTER TABLE bank_statement_entries ADD COLUMN IF NOT EXISTS channel VARCHAR(64);
ALTER TABLE bank_statement_entries ADD COLUMN IF NOT EXISTS payer_name VARCHAR(255);
ALTER TABLE bank_statement_entries ADD COLUMN IF NOT EXISTS match_status VARCHAR(64) DEFAULT 'UNMATCHED';
ALTER TABLE bank_statement_entries ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE bank_statement_entries ADD COLUMN IF NOT EXISTS imported_by VARCHAR(64);
ALTER TABLE bank_statement_entries ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
ALTER TABLE bank_statement_entries ADD COLUMN IF NOT EXISTS reconciled_by VARCHAR(64);
ALTER TABLE bank_statement_entries ADD COLUMN IF NOT EXISTS reconciliation_decision VARCHAR(64);

-- 3. Class Arms
ALTER TABLE class_arms ADD COLUMN IF NOT EXISTS class_teacher_id VARCHAR(64);

-- 4. Classes
ALTER TABLE classes ADD COLUMN IF NOT EXISTS level VARCHAR(64);

-- 5. Commissions
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS amount BIGINT DEFAULT 0;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS rate_percent NUMERIC DEFAULT 0;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- 6. Fee Categories
ALTER TABLE fee_categories ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'ACTIVE';

-- 7. Fee Structure Items
ALTER TABLE fee_structure_items ADD COLUMN IF NOT EXISTS school_id VARCHAR(64);
ALTER TABLE fee_structure_items ADD COLUMN IF NOT EXISTS compulsory INTEGER DEFAULT 1;
ALTER TABLE fee_structure_items ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE fee_structure_items ADD COLUMN IF NOT EXISTS description TEXT;

-- 8. Fee Structures
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'ACTIVE';

-- 9. Fees
ALTER TABLE fees ADD COLUMN IF NOT EXISTS session VARCHAR(64);
ALTER TABLE fees ADD COLUMN IF NOT EXISTS term VARCHAR(64);

-- 10. Invoice Discounts
ALTER TABLE invoice_discounts ADD COLUMN IF NOT EXISTS school_id VARCHAR(64);
ALTER TABLE invoice_discounts ADD COLUMN IF NOT EXISTS percentage NUMERIC DEFAULT 0;
ALTER TABLE invoice_discounts ADD COLUMN IF NOT EXISTS authorized_by VARCHAR(64);

-- 11. Invoice Items
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS school_id VARCHAR(64);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_amount BIGINT DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS total_amount BIGINT DEFAULT 0;

-- 12. Notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(64);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- 13. Parent Students
ALTER TABLE parent_students ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(64) DEFAULT 'GUARDIAN';
ALTER TABLE parent_students ADD COLUMN IF NOT EXISTS is_primary_contact INTEGER DEFAULT 0;

-- 14. Parents
ALTER TABLE parents ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE parents ADD COLUMN IF NOT EXISTS relationship VARCHAR(64);
ALTER TABLE parents ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(64);

-- 15. Partners
ALTER TABLE partners ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS company VARCHAR(255);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS partner_type VARCHAR(64);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS commission_rate NUMERIC DEFAULT 0;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'ACTIVE';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- 16. Password Resets
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS recovery_method VARCHAR(64);
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);

-- 17. Payment Reversals
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS invoice_id VARCHAR(64);
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS student_id VARCHAR(64);
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS amount_kobo BIGINT;
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS reversal_type VARCHAR(64);
ALTER TABLE payment_reversals ADD COLUMN IF NOT EXISTS initiated_by VARCHAR(64);

-- 18. Platform Invoices
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS subscription_id VARCHAR(64);
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS billing_period VARCHAR(64);
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS standard_price BIGINT DEFAULT 0;
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS discount BIGINT DEFAULT 0;
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS negotiated_price BIGINT;
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS final_amount BIGINT DEFAULT 0;
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'NGN';
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS payment_status VARCHAR(32) DEFAULT 'UNPAID';
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS issue_date DATE;
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS payment_method VARCHAR(64);
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE platform_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- 19. Platform Payments
ALTER TABLE platform_payments ADD COLUMN IF NOT EXISTS subscription_id VARCHAR(64);
ALTER TABLE platform_payments ADD COLUMN IF NOT EXISTS amount BIGINT DEFAULT 0;
ALTER TABLE platform_payments ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'NGN';
ALTER TABLE platform_payments ADD COLUMN IF NOT EXISTS provider VARCHAR(64);
ALTER TABLE platform_payments ADD COLUMN IF NOT EXISTS provider_transaction_id VARCHAR(255);
ALTER TABLE platform_payments ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(255);
ALTER TABLE platform_payments ADD COLUMN IF NOT EXISTS internal_reference VARCHAR(255);
ALTER TABLE platform_payments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE platform_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- 20. Platform Settings
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS default_currency VARCHAR(10) DEFAULT 'NGN';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS default_grace_period_days INTEGER DEFAULT 7;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS default_trial_days INTEGER DEFAULT 30;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS bachs_enabled INTEGER DEFAULT 1;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS bank_transfer_enabled INTEGER DEFAULT 1;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS invoice_payments_enabled INTEGER DEFAULT 1;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS platform_bank_name VARCHAR(128) DEFAULT 'Zenith Bank Plc';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS platform_account_name VARCHAR(255) DEFAULT 'BursarIQ Global Ltd';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS platform_account_number VARCHAR(32) DEFAULT '1012345678';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS platform_contact_email VARCHAR(255) DEFAULT 'support@bursariq.com.ng';
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS platform_contact_phone VARCHAR(64) DEFAULT '08160754659';

-- 21. Receipts
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS invoice_id VARCHAR(64);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS student_id VARCHAR(64);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS amount BIGINT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS previous_balance BIGINT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS current_balance BIGINT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS issue_date VARCHAR(64);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS issued_by VARCHAR(64);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS notes TEXT;

-- 22. Recovery Challenges
ALTER TABLE recovery_challenges ADD COLUMN IF NOT EXISTS identifier VARCHAR(255);
ALTER TABLE recovery_challenges ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;

-- 23. Schema Migrations
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS version INTEGER;
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(128);
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER DEFAULT 0;

-- 24. School Settings
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS paystack_enabled INTEGER DEFAULT 0;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS flutterwave_enabled INTEGER DEFAULT 0;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS bachs_webhook_secret TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS bachs_enabled INTEGER DEFAULT 1;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

-- 25. School Subscriptions
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS renewal_date DATE;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS trial_end_date DATE;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS provider VARCHAR(64) DEFAULT 'MANUAL';
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(255);
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS standard_plan_price BIGINT DEFAULT 0;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS negotiated_price BIGINT;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS discount_amount BIGINT DEFAULT 0;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS discount_reason TEXT;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS final_amount BIGINT DEFAULT 0;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'NGN';
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS amount_paid BIGINT DEFAULT 0;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 7;

-- 26. Staff
ALTER TABLE staff ADD COLUMN IF NOT EXISTS staff_number VARCHAR(64);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS middle_name VARCHAR(255);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS gender VARCHAR(32);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS job_title VARCHAR(128);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS employment_status VARCHAR(32) DEFAULT 'ACTIVE';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS date_joined VARCHAR(64);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

-- 27. Student Fee Assignments
ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'ACTIVE';

-- 28. Students
ALTER TABLE students ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS class_name VARCHAR(128);

-- 29. Subscription Discounts
ALTER TABLE subscription_discounts ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE subscription_discounts ADD COLUMN IF NOT EXISTS discount_type VARCHAR(64);
ALTER TABLE subscription_discounts ADD COLUMN IF NOT EXISTS discount_value BIGINT;
ALTER TABLE subscription_discounts ADD COLUMN IF NOT EXISTS school_id VARCHAR(64);
ALTER TABLE subscription_discounts ADD COLUMN IF NOT EXISTS plan_id VARCHAR(64);
ALTER TABLE subscription_discounts ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
ALTER TABLE subscription_discounts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE subscription_discounts ADD COLUMN IF NOT EXISTS notes TEXT;

-- 30. Subscription Plans
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_name VARCHAR(128);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS price BIGINT DEFAULT 0;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'NGN';
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(32);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS billing_interval_count INTEGER DEFAULT 1;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 30;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS maximum_students INTEGER DEFAULT 200;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS maximum_staff INTEGER DEFAULT 25;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS maximum_admin_users INTEGER DEFAULT 5;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS staff_limit INTEGER DEFAULT 25;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS storage_limit_mb INTEGER DEFAULT 1000;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS feature_limits TEXT;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS feature_flags TEXT;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;

-- 31. Terms
ALTER TABLE terms ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'UPCOMING';

-- 32. Webhook Events
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS school_id VARCHAR(64);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(255);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
