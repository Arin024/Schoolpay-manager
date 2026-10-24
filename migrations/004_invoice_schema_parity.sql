-- ==============================================================================
-- BURSARIQ - MIGRATION 004: INVOICE SCHEMA PARITY & CONCURRENCY CONSTRAINTS
-- Preserves existing records; idempotent additions
-- ==============================================================================

-- 1. Invoice parity columns
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fee_structure_id VARCHAR(64);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount BIGINT DEFAULT 0;

-- 2. Performance & Tenant Isolation Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_school_student ON invoices (school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_invoices_school_status ON invoices (school_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_school_invoice ON payments (school_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_school_status ON payments (school_id, status);
CREATE INDEX IF NOT EXISTS idx_receipts_school_invoice ON receipts (school_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_reversals_payment ON payment_reversals (school_id, payment_id);

-- 3. Idempotency Constraint: Ensure payment_reference is unique per school tenant
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_payments_school_reference'
    ) THEN
        ALTER TABLE payments ADD CONSTRAINT uq_payments_school_reference UNIQUE (school_id, payment_reference);
    END IF;
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN others THEN NULL;
END $$;
