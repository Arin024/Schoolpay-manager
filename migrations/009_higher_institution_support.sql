-- Migration 009: Higher Institution (University, Polytechnic, College) & Custom Institutional Structure
-- Strictly additive, idempotent, zero impact on existing school records or data.

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS institution_category TEXT DEFAULT 'K12';
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS academic_cycle_type TEXT DEFAULT 'TERM';
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS cycle_labels_json TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS grading_mode TEXT DEFAULT 'PERCENTAGE';
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS terminology_json TEXT;

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS credit_units INTEGER DEFAULT 3;
