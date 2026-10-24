-- ==============================================================================
-- BURSARIQ - MIGRATION 003: ADJUST CHECK CONSTRAINTS FOR COMPLETE ENUM PARITY
-- ==============================================================================

ALTER TABLE school_subscriptions DROP CONSTRAINT IF EXISTS school_subscriptions_status_check;
ALTER TABLE school_subscriptions ADD CONSTRAINT school_subscriptions_status_check 
  CHECK(status IN ('TRIAL', 'TRIALING', 'ACTIVE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED', 'EXPIRED'));

ALTER TABLE school_subscriptions ALTER COLUMN billing_cycle DROP NOT NULL;
