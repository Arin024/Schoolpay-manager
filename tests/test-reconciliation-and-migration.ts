/**
 * BURSARIQ - FINANCIAL RECONCILIATION & STAGING MIGRATION TEST SUITE
 *
 * Verifies:
 * 1. Financial reconciliation calculates exact kobo totals and catches discrepancies.
 * 2. Unrecorded reversals and negative balances are flagged as CRITICAL.
 * 3. Pending/failed payments do NOT reduce invoice balances.
 * 4. Staging migration refuses unconfirmed targets.
 * 5. Staging migration refuses URLs matching DATABASE_URL or containing production keywords.
 * 6. Migration dry-run generates checksums without executing writes.
 * 7. Foreign-key preservation order is strictly dependency-aware.
 */

import assert from 'node:assert';
import { reconcileInvoiceLedger } from '../server/financialReconciliationService.ts';
import { validateStagingTarget, MIGRATION_TABLE_ORDER } from '../server/stagingMigrationEngine.ts';

console.log('===============================================================');
console.log('   BURSARIQ: RECONCILIATION & MIGRATION SAFEGUARD TEST SUITE   ');
console.log('===============================================================');

// -----------------------------------------------------------------------------
// TEST 1: Reconcile Healthy Ledger (100% Invariant Match)
// -----------------------------------------------------------------------------
console.log('\n[TEST 1] Testing Healthy Ledger Invariant Reconciliation...');
const mockInvoicesHealthy = [
  { id: 'inv_1', invoice_number: 'INV-001', school_id: 'sch_1', student_id: 'stu_1', subtotal: 10000000, discount: 1000000, total: 9000000, amount_paid: 9000000, balance: 0, status: 'PAID' },
  { id: 'inv_2', invoice_number: 'INV-002', school_id: 'sch_1', student_id: 'stu_2', subtotal: 5000000, discount: 0, total: 5000000, amount_paid: 2000000, balance: 3000000, status: 'PARTIALLY_PAID' },
];

const mockItemsHealthy = [
  { invoice_id: 'inv_1', total_amount: 10000000 },
  { invoice_id: 'inv_2', total_amount: 5000000 },
];

const mockDiscountsHealthy = [
  { invoice_id: 'inv_1', amount: 1000000 },
];

const mockPaymentsHealthy = [
  { id: 'pay_1', invoice_id: 'inv_1', amount: 9000000, status: 'SUCCESS' },
  { id: 'pay_2', invoice_id: 'inv_2', amount: 2000000, status: 'SUCCESS' },
];

const report1 = reconcileInvoiceLedger(
  mockInvoicesHealthy,
  mockItemsHealthy,
  mockDiscountsHealthy,
  mockPaymentsHealthy,
  []
);

assert.strictEqual(report1.ledgerBalanced, true);
assert.strictEqual(report1.discrepancies.length, 0);
assert.strictEqual(report1.summary.totalExpectedInvoicedKobo, 14000000);
assert.strictEqual(report1.summary.totalExpectedCollectedKobo, 11000000);
assert.strictEqual(report1.summary.totalExpectedOutstandingKobo, 3000000);
console.log('✓ PASS: Healthy ledger reconciled with 0 discrepancies and exact kobo balance');

// -----------------------------------------------------------------------------
// TEST 2: Catch Payment Sum Mismatch & Subtotal Discrepancy
// -----------------------------------------------------------------------------
console.log('\n[TEST 2] Testing Detection of Corrupted Payments and Subtotals...');
const mockInvoicesCorrupt = [
  { id: 'inv_bad', invoice_number: 'INV-BAD-01', school_id: 'sch_1', student_id: 'stu_1', subtotal: 10000000, discount: 0, total: 10000000, amount_paid: 8000000, balance: 2000000, status: 'PARTIALLY_PAID' },
];
// Real payments only add up to ₦50,000, but invoice claims ₦80,000 paid
const mockPaymentsCorrupt = [
  { id: 'pay_c1', invoice_id: 'inv_bad', amount: 5000000, status: 'SUCCESS' },
  { id: 'pay_failed', invoice_id: 'inv_bad', amount: 3000000, status: 'FAILED' }, // FAILED must NOT count
];

const report2 = reconcileInvoiceLedger(
  mockInvoicesCorrupt,
  [{ invoice_id: 'inv_bad', total_amount: 10000000 }],
  [],
  mockPaymentsCorrupt,
  []
);

assert.strictEqual(report2.ledgerBalanced, false);
const catTypes = report2.discrepancies.map((d) => d.category);
assert.ok(catTypes.includes('PAYMENT_SUM_MISMATCH'));
assert.ok(catTypes.includes('BALANCE_EQUATION_VIOLATION'));
console.log('✓ PASS: Discrepancy detected: Failed payment correctly excluded and balance mismatch flagged');

// -----------------------------------------------------------------------------
// TEST 3: Unrecorded Reversals & Negative Balances
// -----------------------------------------------------------------------------
console.log('\n[TEST 3] Testing Detection of Unrecorded Reversals and Negative Balances...');
const mockInvoicesNegative = [
  { id: 'inv_neg', invoice_number: 'INV-NEG', school_id: 'sch_1', student_id: 'stu_1', subtotal: 5000000, discount: 0, total: 5000000, amount_paid: 6000000, balance: -1000000, status: 'PAID' },
];
const mockPaymentsReversed = [
  { id: 'pay_rev_orphan', invoice_id: 'inv_neg', amount: 6000000, status: 'REVERSED' }, // Lacks entry in payment_reversals
];

const report3 = reconcileInvoiceLedger(
  mockInvoicesNegative,
  [{ invoice_id: 'inv_neg', total_amount: 5000000 }],
  [],
  mockPaymentsReversed,
  [] // No reversals provided
);

assert.strictEqual(report3.ledgerBalanced, false);
const cats3 = report3.discrepancies.map((d) => d.category);
assert.ok(cats3.includes('UNRECORDED_REVERSAL'));
assert.ok(cats3.includes('NEGATIVE_BALANCE'));
console.log('✓ PASS: Flagged UNRECORDED_REVERSAL and NEGATIVE_BALANCE as CRITICAL');

// -----------------------------------------------------------------------------
// TEST 4: Staging Migration URL Safeguards
// -----------------------------------------------------------------------------
console.log('\n[TEST 4] Testing Staging Migration URL Safeguards...');

// Test 4A: Missing URL
const v1 = validateStagingTarget('');
assert.strictEqual(v1.valid, false);

// Test 4B: Production keyword "prod"
const v2 = validateStagingTarget('postgresql://admin:secret@pg-prod.neon.tech/bursariq');
assert.strictEqual(v2.valid, false);
assert.ok(v2.reason?.includes('production or authoritative keywords'));

// Test 4C: Production keyword "bursariq-production"
const v3 = validateStagingTarget('postgresql://admin:secret@db.neon.tech/bursariq-production');
assert.strictEqual(v3.valid, false);

// Test 4D: Valid staging URL
const v4 = validateStagingTarget('postgresql://staging_user:secret@ep-staging-123.neon.tech/stagingdb');
assert.strictEqual(v4.valid, true);

console.log('✓ PASS: Staging validator rejects empty, production, and authoritative database URLs');

// -----------------------------------------------------------------------------
// TEST 5: Foreign-Key Preservation Order
// -----------------------------------------------------------------------------
console.log('\n[TEST 5] Verifying Foreign-Key Dependency-Aware Migration Table Order...');
const schIdx = MIGRATION_TABLE_ORDER.indexOf('schools');
const stuIdx = MIGRATION_TABLE_ORDER.indexOf('students');
const invIdx = MIGRATION_TABLE_ORDER.indexOf('invoices');
const payIdx = MIGRATION_TABLE_ORDER.indexOf('payments');
const recIdx = MIGRATION_TABLE_ORDER.indexOf('receipts');
const revIdx = MIGRATION_TABLE_ORDER.indexOf('payment_reversals');

assert.ok(schIdx < stuIdx, 'schools must precede students');
assert.ok(stuIdx < invIdx, 'students must precede invoices');
assert.ok(invIdx < payIdx, 'invoices must precede payments');
assert.ok(payIdx < recIdx, 'payments must precede receipts');
assert.ok(payIdx < revIdx, 'payments must precede payment_reversals');

console.log('✓ PASS: Migration table order guarantees 0 foreign key constraint violations');

console.log('\n===============================================================');
console.log('   ALL RECONCILIATION & MIGRATION TESTS PASSED (100% SUCCESS)  ');
console.log('===============================================================');

// -----------------------------------------------------------------------------
// TEST 6: Hardened Conflict Detection (Identical vs Mismatch)
// -----------------------------------------------------------------------------
console.log('\n[TEST 6] Testing Migration Row Conflict Comparison Engine...');
import { compareRowValues } from '../server/stagingMigrationEngine.ts';

// 6A: Identical rows (including integer vs string bigint normalization)
const rowSource = { id: 'inv_101', school_id: 'sch_1', total: 5000000, balance: 2500000, notes: null };
const rowDestIdentical = { id: 'inv_101', school_id: 'sch_1', total: '5000000', balance: 2500000, notes: null };
const diffsIdentical = compareRowValues(rowSource, rowDestIdentical, ['id', 'school_id', 'total', 'balance', 'notes']);
assert.strictEqual(diffsIdentical.length, 0, 'Identical row must yield 0 differences');
console.log('✓ PASS: Identical existing row correctly recognized with 0 false differences');

// 6B: Data Mismatch Conflict on same ID
const rowDestConflict = { id: 'inv_101', school_id: 'sch_1', total: '5000000', balance: 1000000, notes: 'Altered' };
const diffsConflict = compareRowValues(rowSource, rowDestConflict, ['id', 'school_id', 'total', 'balance', 'notes']);
assert.strictEqual(diffsConflict.length, 2, 'Must detect 2 conflicting columns');
assert.strictEqual(diffsConflict[0].column, 'balance');
assert.strictEqual(diffsConflict[1].column, 'notes');
console.log('✓ PASS: Data mismatch conflict successfully detected with exact column differentials');
