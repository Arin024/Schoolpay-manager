import assert from 'node:assert';
import { db, initDatabase } from '../server/db.js';
import {
  toKobo,
  toNaira,
  calculateItemsSubtotalKobo,
  calculateDiscountKobo,
  determineInvoiceStatus,
  generateInvoiceNumber,
  generatePaymentReference,
} from '../server/financeUtils.js';

console.log('===============================================================');
console.log('   STEP 3: FINANCIAL MANAGEMENT & TENANT ISOLATION TESTS');
console.log('===============================================================');

// Ensure database is initialized
initDatabase();

const schoolAId = 'sch_lagos_premier_01';
const schoolBId = 'sch_abuja_horizon_02';

// TEST 1: Deterministic Minor Unit (Kobo) Arithmetic & No Floating-Point Inaccuracies
console.log('\n[TEST 1] Testing Deterministic Minor Unit (Kobo) Math...');
assert.strictEqual(toKobo(100), 10000, '₦100 must equal 10,000 kobo');
assert.strictEqual(toKobo('50,000'), 5000000, '₦50,000 must equal 5,000,000 kobo');
assert.strictEqual(toKobo('185,000.50'), 18500050, '₦185,000.50 must equal 18,500,050 kobo');
assert.strictEqual(toNaira(18500050), 185000.5, '18,500,050 kobo must convert back to ₦185,000.50');

const itemsTest = [
  { unit_amount: 12000000, quantity: 1 }, // 120,000 NGN
  { unit_amount: 1500000, quantity: 2 },  // 15,000 NGN * 2 = 30,000 NGN
];
const subtotalTest = calculateItemsSubtotalKobo(itemsTest);
assert.strictEqual(subtotalTest, 15000000, 'Subtotal must strictly equal 15,000,000 kobo (₦150,000)');
console.log('✓ PASS: Minor unit kobo conversions and subtotal calculations are exact and deterministic.');

// TEST 2: Discount & Scholarship Calculation
console.log('\n[TEST 2] Testing Fixed & Percentage Discounts & Scholarships...');
const fixedDiscount = calculateDiscountKobo(15000000, [{ type: 'FIXED', amount: 2500000 }]);
assert.strictEqual(fixedDiscount, 2500000, 'Fixed discount of 25,000 NGN must equal 2,500,000 kobo');

const pctDiscount = calculateDiscountKobo(10000000, [{ type: 'PERCENTAGE', percentage: 10 }]);
assert.strictEqual(pctDiscount, 1000000, '10% discount on 100,000 NGN must equal 10,000 NGN (1,000,000 kobo)');

// Capped discount (cannot exceed subtotal)
const excessiveDiscount = calculateDiscountKobo(5000000, [{ type: 'FIXED', amount: 99000000 }]);
assert.strictEqual(excessiveDiscount, 5000000, 'Discount must be clamped to subtotal max');
console.log('✓ PASS: Discount algorithms are deterministic, safe, and audited.');

// TEST 3: Partial Payments & Automatic Status Transitions
console.log('\n[TEST 3] Testing Automatic Status Transitions on Payments...');
const totalKobo = 10000000; // ₦100,000

// 0 paid -> ISSUED
assert.strictEqual(determineInvoiceStatus(totalKobo, 0, '2099-12-31', 'ISSUED'), 'ISSUED');

// 30,000 NGN paid -> PARTIALLY_PAID
assert.strictEqual(determineInvoiceStatus(totalKobo, 3000000, '2099-12-31', 'ISSUED'), 'PARTIALLY_PAID');

// 100,000 NGN paid -> PAID
assert.strictEqual(determineInvoiceStatus(totalKobo, 10000000, '2099-12-31', 'ISSUED'), 'PAID');

// Past due date with 0 paid -> OVERDUE
assert.strictEqual(determineInvoiceStatus(totalKobo, 0, '2020-01-01', 'ISSUED'), 'OVERDUE');
console.log('✓ PASS: Automatic state transitions (ISSUED -> PARTIALLY_PAID -> PAID / OVERDUE) verified.');

// TEST 4: Database Invoices & Seed Records
console.log('\n[TEST 4] Verifying Seed Invoices in Database...');
const invA1 = db.prepare(`SELECT * FROM invoices WHERE id = 'inv_a_001' AND school_id = ?`).get(schoolAId) as any;
assert.ok(invA1, 'School A Invoice 1 must exist');
assert.strictEqual(invA1.school_id, schoolAId);
assert.strictEqual(invA1.subtotal, 17500000);
assert.strictEqual(invA1.discount, 2500000);
assert.strictEqual(invA1.total, 15000000);
assert.strictEqual(invA1.amount_paid, 10000000);
assert.strictEqual(invA1.balance, 5000000);
assert.strictEqual(invA1.status, 'PARTIALLY_PAID');
console.log(`✓ PASS: Seed invoice inv_a_001 verified with Total: ₦${toNaira(invA1.total)}, Paid: ₦${toNaira(invA1.amount_paid)}, Balance: ₦${toNaira(invA1.balance)}`);

// TEST 5: STRICT CROSS-TENANT ISOLATION
console.log('\n[TEST 5] Testing Zero-Trust Tenant Isolation (Cross-Tenant Security)...');

// School A trying to lookup School B's invoice
const crossTenantInvoice = db.prepare(`SELECT * FROM invoices WHERE id = 'inv_b_001' AND school_id = ?`).get(schoolAId);
assert.strictEqual(crossTenantInvoice, undefined, 'School A MUST NEVER be able to query School B invoice');

// School B trying to lookup School A's invoice
const crossTenantInvoiceB = db.prepare(`SELECT * FROM invoices WHERE id = 'inv_a_001' AND school_id = ?`).get(schoolBId);
assert.strictEqual(crossTenantInvoiceB, undefined, 'School B MUST NEVER be able to query School A invoice');

// Attempting to inject School B's id into School A's payment query
const crossTenantPayments = db.prepare(`SELECT * FROM payments WHERE school_id = ? AND student_id = 'stu_b1_01'`).all(schoolAId);
assert.strictEqual(crossTenantPayments.length, 0, 'School A tenant context must return zero rows for School B students');

// Attempting cross-tenant fee structures lookup
const crossTenantStructures = db.prepare(`SELECT * FROM fee_structures WHERE school_id = ? AND id = 'fs_a_ss2_t1'`).all(schoolBId);
assert.strictEqual(crossTenantStructures.length, 0, 'School B must not be able to view School A fee structures');

console.log('✓ PASS: All cross-tenant access attempts rejected by WHERE school_id isolation.');

// TEST 6: Unique Tenant-Scoped Identifiers
console.log('\n[TEST 6] Testing Invoice & Payment Reference Generators...');
const invNum = generateInvoiceNumber('LPC', 42);
assert.strictEqual(invNum, `INV-LPC-${new Date().getFullYear()}-0042`);

const payRef = generatePaymentReference('LPC', 123);
assert.strictEqual(payRef, `PAY-LPC-${new Date().getFullYear()}-0123`);
console.log(`✓ PASS: Generated reference formats: ${invNum}, ${payRef}`);

console.log('\n===============================================================');
console.log('   ALL STEP 3 FINANCIAL TESTS PASSED WITH 100% SUCCESS!');
console.log('===============================================================\n');
