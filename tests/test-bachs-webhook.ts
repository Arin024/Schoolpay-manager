import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { db, initDatabase } from '../server/db.js';
import { apiRouter } from '../server/routes.js';
import { paymentService } from '../server/paymentService.js';

async function runBachsWebhookSuite() {
  console.log('===============================================================');
  console.log('   DEDICATED BACHS.IO WEBHOOK VERIFICATION TEST SUITE         ');
  console.log('===============================================================');

  // Initialize DB
  initDatabase();

  // Create isolated test server
  const app = express();
  app.use(
    express.json({
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const TEST_SECRET = 'whsec_bachs_secret_key_testing_12345';
  process.env.BACHS_WEBHOOK_SECRET = TEST_SECRET;

  async function postWebhook(body: any, headers: Record<string, string> = {}) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await fetch(`${baseUrl}/api/webhooks/bachs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: rawBody,
    });
    const status = res.status;
    let json: any = {};
    try {
      json = await res.json();
    } catch {}
    return { status, json };
  }

  // Setup test school & pending platform payment
  const schoolId = 'sch_bachs_wh_test';
  const planId = 'plan_standard';
  const expectedAmountKobo = 25000000; // 250,000 NGN

  db.prepare(`
    INSERT OR REPLACE INTO schools (
      id, name, slug, email, phone, state, lga, type, status, current_plan_id, subscription_end_date, created_at, updated_at
    ) VALUES (?, 'Bachs Webhook Test Academy', 'bachs-test', 'wh@bachs.test', '08012345678', 'Lagos', 'Ikeja', 'PRIMARY', 'TRIAL', ?, '2026-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(schoolId, planId);

  const paymentId = 'ppay_bachs_wh_test';
  const internalRef = 'PLT-BACH-999001';
  const providerRef = `bch_test_ref_${Date.now()}`;

  db.prepare(`
    INSERT OR REPLACE INTO platform_payments (
      id, school_id, plan_id, amount, currency, payment_method, provider,
      provider_reference, internal_reference, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'NGN', 'ONLINE', 'BACHS', ?, ?, 'PENDING', 'Pending Bachs Checkout', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(paymentId, schoolId, planId, expectedAmountKobo, providerRef, internalRef);

  console.log('\n[TEST 1] Rejects webhook request when signature is missing (401 Unauthorized)...');
  const payload1 = {
    event: 'payment.success',
    data: {
      reference: providerRef,
      amount: expectedAmountKobo,
      currency: 'NGN',
      metadata: {
        school_id: schoolId,
        platform_payment_id: paymentId,
        internal_reference: internalRef,
      },
    },
  };
  const res1 = await postWebhook(payload1);
  assert.strictEqual(res1.status, 401, 'Must reject missing signature with 401');
  assert.strictEqual(res1.json.error, 'INVALID_SIGNATURE');
  console.log('✓ PASS: Missing signature rejected with HTTP 401');

  console.log('\n[TEST 2] Rejects webhook request when signature is invalid (401 Unauthorized)...');
  const res2 = await postWebhook(payload1, {
    'x-bachs-signature': 'invalid_forged_signature_hex_1234567890abcdef',
  });
  assert.strictEqual(res2.status, 401, 'Must reject invalid signature with 401');
  assert.strictEqual(res2.json.error, 'INVALID_SIGNATURE');
  console.log('✓ PASS: Invalid signature rejected with HTTP 401');

  console.log('\n[TEST 3] Rejects webhook request with stale timestamp (Replay defense)...');
  const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
  const rawBody3 = JSON.stringify(payload1);
  const sigStale = crypto.createHmac('sha256', TEST_SECRET).update(`${staleTimestamp}.${rawBody3}`).digest('hex');
  const res3 = await postWebhook(rawBody3, {
    'x-bachs-signature': sigStale,
    'x-bachs-timestamp': String(staleTimestamp),
  });
  assert.strictEqual(res3.status, 401, 'Must reject stale timestamp with 401');
  console.log('✓ PASS: Stale timestamp rejected');

  console.log('\n[TEST 4] Accepts webhook with valid HMAC signature and activates subscription...');
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const sigValid = crypto.createHmac('sha256', TEST_SECRET).update(`${currentTimestamp}.${rawBody3}`).digest('hex');
  const res4 = await postWebhook(rawBody3, {
    'x-bachs-signature': sigValid,
    'x-bachs-timestamp': String(currentTimestamp),
  });
  assert.strictEqual(res4.status, 200, `Expected 200 OK, got ${res4.status}: ${JSON.stringify(res4.json)}`);
  assert.strictEqual(res4.json.status, 'success');

  // Verify school is activated in DB
  const updatedSchool = db.prepare('SELECT status, subscription_end_date FROM schools WHERE id = ?').get(schoolId) as any;
  assert.strictEqual(updatedSchool.status, 'ACTIVE', 'School status must be ACTIVE');
  assert.ok(updatedSchool.subscription_end_date > '2026-10-01', 'School expiry must be updated in future');

  const updatedPayment = db.prepare('SELECT status, paid_at FROM platform_payments WHERE id = ?').get(paymentId) as any;
  assert.strictEqual(updatedPayment.status, 'SUCCESS', 'Payment status must be updated to SUCCESS');
  assert.ok(updatedPayment.paid_at, 'Payment paid_at must be set');
  console.log('✓ PASS: Subscription activated and school set to ACTIVE');

  console.log('\n[TEST 5] Idempotency: Duplicate webhook event does not re-process...');
  const res5 = await postWebhook(rawBody3, {
    'x-bachs-signature': sigValid,
    'x-bachs-timestamp': String(currentTimestamp),
  });
  assert.strictEqual(res5.status, 200);
  assert.strictEqual(res5.json.status, 'ignored');
  console.log('✓ PASS: Duplicate webhook safely ignored idempotently');

  console.log('\n[TEST 6] Underpayment protection: Rejects if amount is less than expected fee...');
  const underpayRef = `bch_underpay_${Date.now()}`;
  const underpayPaymentId = 'ppay_underpay_test';
  db.prepare(`
    INSERT INTO platform_payments (
      id, school_id, plan_id, amount, currency, payment_method, provider,
      provider_reference, internal_reference, status, created_at, updated_at
    ) VALUES (?, ?, ?, 50000000, 'NGN', 'ONLINE', 'BACHS', ?, 'PLT-UNDER-1', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(underpayPaymentId, schoolId, planId, underpayRef);

  const underpayPayload = {
    event: 'payment.success',
    data: {
      reference: underpayRef,
      amount: 10000, // 100 NGN instead of 500,000 NGN
      currency: 'NGN',
      metadata: {
        school_id: schoolId,
        platform_payment_id: underpayPaymentId,
      },
    },
  };
  const underpayBody = JSON.stringify(underpayPayload);
  const tsUnder = Math.floor(Date.now() / 1000);
  const sigUnder = crypto.createHmac('sha256', TEST_SECRET).update(`${tsUnder}.${underpayBody}`).digest('hex');
  const res6 = await postWebhook(underpayBody, {
    'x-bachs-signature': sigUnder,
    'x-bachs-timestamp': String(tsUnder),
  });
  assert.strictEqual(res6.status, 400, 'Underpayment must be rejected with 400');
  assert.strictEqual(res6.json.error, 'AMOUNT_MISMATCH');
  console.log('✓ PASS: Underpayment safely detected and rejected');

  console.log('\n[TEST 7] Failed payment event does not activate subscription...');
  const failSchoolId = 'sch_fail_test';
  db.prepare(`
    INSERT OR REPLACE INTO schools (
      id, name, slug, email, phone, state, lga, type, status, current_plan_id, subscription_end_date, created_at, updated_at
    ) VALUES (?, 'Failed School', 'failed-school', 'f@sch.test', '08000000000', 'Lagos', 'Ikeja', 'PRIMARY', 'EXPIRED', ?, '2025-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(failSchoolId, planId);

  const failRef = `bch_fail_${Date.now()}`;
  const failPaymentId = 'ppay_fail_test';
  db.prepare(`
    INSERT INTO platform_payments (
      id, school_id, plan_id, amount, currency, payment_method, provider,
      provider_reference, internal_reference, status, created_at, updated_at
    ) VALUES (?, ?, ?, 50000000, 'NGN', 'ONLINE', 'BACHS', ?, 'PLT-FAIL-1', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(failPaymentId, failSchoolId, planId, failRef);

  const failPayload = {
    event: 'payment.failed',
    data: {
      reference: failRef,
      amount: 50000000,
      currency: 'NGN',
      metadata: {
        school_id: failSchoolId,
        platform_payment_id: failPaymentId,
      },
    },
  };
  const failBody = JSON.stringify(failPayload);
  const tsFail = Math.floor(Date.now() / 1000);
  const sigFail = crypto.createHmac('sha256', TEST_SECRET).update(`${tsFail}.${failBody}`).digest('hex');
  const res7 = await postWebhook(failBody, {
    'x-bachs-signature': sigFail,
    'x-bachs-timestamp': String(tsFail),
  });
  assert.strictEqual(res7.status, 200);
  assert.strictEqual(res7.json.status, 'failed');

  const checkFailSchool = db.prepare('SELECT status FROM schools WHERE id = ?').get(failSchoolId) as any;
  assert.strictEqual(checkFailSchool.status, 'EXPIRED', 'School must remain EXPIRED');
  console.log('✓ PASS: Failed payment does not activate subscription');

  // Close server
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log('\n===============================================================');
  console.log('   ALL BACHS WEBHOOK TESTS PASSED SUCCESSFULLY!               ');
  console.log('===============================================================');
}

runBachsWebhookSuite().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
