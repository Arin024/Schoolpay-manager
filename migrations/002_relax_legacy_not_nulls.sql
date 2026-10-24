-- ==============================================================================
-- BURSARIQ - MIGRATION 002: RELAX LEGACY NOT NULL CONSTRAINTS FOR COMPLETE PARITY
-- Ensures columns match SQLite schema nullable specifications
-- ==============================================================================

ALTER TABLE bank_statement_entries ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE commissions ALTER COLUMN amount_kobo DROP NOT NULL;
ALTER TABLE fees ALTER COLUMN category_id DROP NOT NULL;
ALTER TABLE invoice_discounts ALTER COLUMN name DROP NOT NULL;
ALTER TABLE invoice_discounts ALTER COLUMN value DROP NOT NULL;
ALTER TABLE invoice_items ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN academic_session_id DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN term_id DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN recipient_type DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN recipient_address DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN channel DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN template_type DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN body DROP NOT NULL;
ALTER TABLE parent_students ALTER COLUMN relationship DROP NOT NULL;
ALTER TABLE partners ALTER COLUMN company_name DROP NOT NULL;
ALTER TABLE partners ALTER COLUMN contact_name DROP NOT NULL;
ALTER TABLE payment_reversals ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE payment_reversals ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE platform_invoices ALTER COLUMN amount_kobo DROP NOT NULL;
ALTER TABLE platform_invoices ALTER COLUMN final_amount_kobo DROP NOT NULL;
ALTER TABLE platform_payments ALTER COLUMN amount_kobo DROP NOT NULL;
ALTER TABLE platform_payments ALTER COLUMN gateway_reference DROP NOT NULL;
ALTER TABLE recovery_challenges ALTER COLUMN method DROP NOT NULL;
ALTER TABLE subscription_discounts ALTER COLUMN discount_percent DROP NOT NULL;
ALTER TABLE subscription_plans ALTER COLUMN code DROP NOT NULL;
ALTER TABLE user_recovery_codes ALTER COLUMN salt DROP NOT NULL;
ALTER TABLE webhook_events ALTER COLUMN event_id DROP NOT NULL;

ALTER TABLE invoice_items ALTER COLUMN fee_category_id DROP NOT NULL;
