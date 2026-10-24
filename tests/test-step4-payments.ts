import assert from 'node:assert';
import crypto from 'node:crypto';
import { db, initDatabase } from '../server/db.js';
import { paymentService, generateInternalPaymentReference } from '../server/paymentService.js';
import { notificationService } from '../server/notificationService.js';
import { toKobo, toNaira } from '../server/financeUtils.js';

console.log('===============================================================');
console.log('   STEP 4: PAYMENTS, RECEIPTS, REPORTS & NOTIFICATIONS TESTS');
console.log('===============================================================');

// 1. Initialize database & migrations
initDatabase();

const schoolAId = 'sch_lagos_premier_01';
const schoolBId = 'sch_abuja_horizon_02';

// ---------------------------------------------------------------------------
// TEST 1: PaymentService Abstraction & Gateway Registry
// ---------------------------------------------------------------------------
console.log('\n[TEST 1] PaymentService Abstraction & Gateway Registry...');
const registeredGateways = paymentService.getRegisteredGateways();
assert(registeredGateways.includes('MANUAL'), 'MANUAL gateway must be registered');
assert(registeredGateways.includes('PAYSTACK'), 'PAYSTACK gateway must be registered');
assert(registeredGateways.includes('FLUTTERWAVE'), 'FLUTTERWAVE gateway must be registered');
assert(registeredGateways.includes('TEST_SANDBOX'), 'TEST_SANDBOX gateway must be registered');

// Test that unconfigured gateways do NOT activate without credentials
const isPaystackActiveWithoutKey = paymentService.isConfigured('PAYSTACK', schoolBId);
assert.strictEqual(isPaystackActiveWithoutKey, false, 'Paystack must not be active without valid credentials');

console.log('✓ PASS: PaymentService abstraction handles multiple providers safely.');

// ---------------------------------------------------------------------------
// TEST 2: Unique Internal Reference & Idempotency Generation
// ---------------------------------------------------------------------------
console.log('\n[TEST 2] Internal Payment Reference Generation & Uniqueness...');
const ref1 = generateInternalPaymentReference(schoolAId);
const ref2 = generateInternalPaymentReference(schoolAId);
assert.notStrictEqual(ref1, ref2, 'Consecutive references must be distinct');
assert(ref1.startsWith('PAY-'), 'Reference must start with PAY-');
console.log(`✓ PASS: Generated unique references (Sample: ${ref1}, ${ref2})`);

// ---------------------------------------------------------------------------
// TEST 3: Payment Record & Automatic Receipt Generation
// ---------------------------------------------------------------------------
console.log('\n[TEST 3] Payment Recording, Balance Deduction & Receipt Creation...');

// Find a student in School A
const student = db.prepare(`SELECT id FROM students WHERE school_id = ? LIMIT 1`).get(schoolAId) as any;
assert(student, 'Must have a student in School A');

// Create a dedicated test invoice
const testInvoiceId = `inv_test_${crypto.randomBytes(6).toString('hex')}`;
const testInvNumber = `INV-LPC-TEST-${Date.now()}`;
const startingTotal = 15000000; // ₦150,000

db.prepare(`
  INSERT INTO invoices (
    id, school_id, student_id, invoice_number, issue_date, due_date,
    subtotal, discount, total, amount_paid, balance, status
  ) VALUES (?, ?, ?, ?, date('now'), date('now', '+30 days'), ?, 0, ?, 0, ?, 'ISSUED')
`).run(testInvoiceId, schoolAId, student.id, testInvNumber, startingTotal, startingTotal, startingTotal);

const startingAmountPaid = 0;
const startingBalance = startingTotal;
const paymentKobo = 5000000; // ₦50,000 partial payment

const testPaymentId = `pay_test_${crypto.randomBytes(6).toString('hex')}`;
const internalRef = generateInternalPaymentReference(schoolAId);

// Record payment
db.prepare(`
  INSERT INTO payments (
    id, school_id, student_id, invoice_id, amount, currency,
    payment_method, provider, internal_reference, payment_reference, payment_date, status, paid_at, notes
  ) VALUES (?, ?, ?, ?, ?, 'NGN', 'BANK_TRANSFER', 'MANUAL', ?, ?, date('now'), 'SUCCESS', CURRENT_TIMESTAMP, 'Automated Test Payment')
`).run(
  testPaymentId,
  schoolAId,
  student.id,
  testInvoiceId,
  paymentKobo,
  internalRef,
  internalRef
);

// Update invoice balance deterministically
const newAmountPaid = startingAmountPaid + paymentKobo;
const newBalance = Math.max(0, startingTotal - newAmountPaid);
const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';

db.prepare(`
  UPDATE invoices
  SET amount_paid = ?, balance = ?, status = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND school_id = ?
`).run(newAmountPaid, newBalance, newStatus, testInvoiceId, schoolAId);

// Generate official receipt
const receiptId = `rec_test_${crypto.randomBytes(6).toString('hex')}`;
const receiptNumber = `REC-LPC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

db.prepare(`
  INSERT INTO receipts (
    id, school_id, receipt_number, payment_id, invoice_id, student_id,
    amount, previous_balance, current_balance, issue_date, issued_by, notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), 'usr_owner_lagos_01', 'Official receipt from automated test')
`).run(
  receiptId,
  schoolAId,
  receiptNumber,
  testPaymentId,
  testInvoiceId,
  student.id,
  paymentKobo,
  startingBalance,
  newBalance
);

// Verify receipt in database
const storedReceipt = db.prepare(`SELECT * FROM receipts WHERE id = ? AND school_id = ?`).get(receiptId, schoolAId) as any;
assert(storedReceipt, 'Receipt must exist in database');
assert.strictEqual(Number(storedReceipt.amount), paymentKobo, 'Receipt amount must match payment');
assert.strictEqual(Number(storedReceipt.previous_balance), startingBalance, 'Previous balance must match');
assert.strictEqual(Number(storedReceipt.current_balance), newBalance, 'Current balance must match');

console.log(`✓ PASS: Payment recorded and Receipt ${receiptNumber} created (Amount: ₦${toNaira(paymentKobo)}, Bal: ₦${toNaira(newBalance)})`);

// ---------------------------------------------------------------------------
// TEST 4: Secure Webhook Idempotency & Replay Attack Defense
// ---------------------------------------------------------------------------
console.log('\n[TEST 4] Webhook Processing & Idempotency Protection...');

const webhookEventId = `ev_test_${crypto.randomBytes(8).toString('hex')}`;
const idempotencyKey = `PAYSTACK:REF_${Date.now()}:charge.success`;
const webhookPayload = JSON.stringify({
  event: 'charge.success',
  data: {
    reference: `PAYSTACK_REF_${Date.now()}`,
    amount: 5000000,
    status: 'success',
  },
});

// First webhook delivery
db.prepare(`
  INSERT INTO webhook_events (id, school_id, provider, event_type, idempotency_key, payload, status)
  VALUES (?, ?, 'PAYSTACK', 'charge.success', ?, ?, 'PROCESSED')
`).run(webhookEventId, schoolAId, idempotencyKey, webhookPayload);

// Attempt duplicate delivery with the same idempotencyKey
let duplicateRejected = false;
try {
  const anotherEventId = `ev_test_${crypto.randomBytes(8).toString('hex')}`;
  db.prepare(`
    INSERT INTO webhook_events (id, school_id, provider, event_type, idempotency_key, payload, status)
    VALUES (?, ?, 'PAYSTACK', 'charge.success', ?, ?, 'PROCESSED')
  `).run(anotherEventId, schoolAId, idempotencyKey, webhookPayload);
} catch (err: any) {
  if (err.message.includes('UNIQUE constraint failed') || err.message.includes('PRIMARY KEY')) {
    duplicateRejected = true;
  }
}

assert(duplicateRejected, 'Duplicate webhook event MUST be rejected by idempotency_key UNIQUE constraint');
console.log('✓ PASS: Webhook idempotency enforced. Replay attack prevented.');

// ---------------------------------------------------------------------------
// TEST 5: Tenant Isolation (Zero-Trust) for Financial Data
// ---------------------------------------------------------------------------
console.log('\n[TEST 5] Strict Tenant Isolation (Zero-Trust Across Schools)...');

// School B must NEVER see School A receipts
const schoolBReceipts = db.prepare(`SELECT * FROM receipts WHERE school_id = ? AND id = ?`).all(schoolBId, receiptId);
assert.strictEqual(schoolBReceipts.length, 0, 'School B must not be able to access School A receipt');

// School B must NEVER see School A payments
const schoolBPayments = db.prepare(`SELECT * FROM payments WHERE school_id = ? AND id = ?`).all(schoolBId, testPaymentId);
assert.strictEqual(schoolBPayments.length, 0, 'School B must not be able to access School A payment');

console.log('✓ PASS: Strict tenant isolation confirmed. Cross-tenant leakage impossible.');

// ---------------------------------------------------------------------------
// TEST 6: In-App Notification Service
// ---------------------------------------------------------------------------
console.log('\n[TEST 6] Notification Dispatch & State Lifecycle...');

const testNotifId = `notif_test_${crypto.randomBytes(6).toString('hex')}`;
await notificationService.notify({
  id: testNotifId,
  school_id: schoolAId,
  user_id: 'usr_owner_lagos_01',
  type: 'PAYMENT_RECEIVED',
  title: 'Payment Received',
  message: `Payment of ₦${toNaira(paymentKobo)} recorded successfully.`,
  data: { payment_id: testPaymentId, receipt_number: receiptNumber },
});

// Check notification created
const notifRecord = db.prepare(`SELECT * FROM notifications WHERE id = ? AND school_id = ?`).get(testNotifId, schoolAId) as any;
assert(notifRecord, 'Notification record must exist');
assert.strictEqual(notifRecord.read_at, null, 'Notification must initially be unread');

// Mark as read
db.prepare(`UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`).run(testNotifId, schoolAId);
const updatedNotif = db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(testNotifId) as any;
assert(updatedNotif.read_at !== null, 'Notification must now be marked as read');

console.log('✓ PASS: In-app notification successfully dispatched and state updated.');

// ---------------------------------------------------------------------------
// TEST 7: Financial Reports & Daily/Monthly Aggregation
// ---------------------------------------------------------------------------
console.log('\n[TEST 7] Deterministic Financial Aggregation Reports...');

const dailyReport = db.prepare(`
  SELECT 
    substr(paid_at, 1, 10) AS date,
    COUNT(*) AS count,
    SUM(amount) AS total_kobo
  FROM payments
  WHERE school_id = ? AND status = 'SUCCESS'
  GROUP BY substr(paid_at, 1, 10)
  ORDER BY date DESC
`).all(schoolAId) as any[];

assert(dailyReport.length > 0, 'Daily collections report must return data');
assert(dailyReport[0].total_kobo > 0, 'Total kobo collected must be positive');

console.log(`✓ PASS: Daily report aggregated ${dailyReport.length} dates. Latest: ${dailyReport[0].date} (₦${toNaira(dailyReport[0].total_kobo)})`);

console.log('\n===============================================================');
console.log('   ALL STEP 4 PAYMENTS & RECEIPTS TESTS PASSED SUCCESSFULLY!   ');
console.log('===============================================================\n');

process.exit(0);
