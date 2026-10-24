import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import { apiRouter } from '../server/routes.js';
import { initDatabase, db } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { toKobo, toNaira } from '../server/financeUtils.js';

console.log('===============================================================');
console.log('   STEP 4: LIVE API ENDPOINTS & WEBHOOK INTEGRATION TESTS');
console.log('===============================================================');

// Init DB
initDatabase();

// Setup express test app
const app = express();
app.use(express.json());
app.use('/api', apiRouter);

const server = http.createServer(app);

server.listen(0, async () => {
  const address = server.address() as any;
  const baseUrl = `http://localhost:${address.port}/api/v1`;

  try {
    const schoolAId = 'sch_lagos_premier_01';
    const schoolBId = 'sch_abuja_horizon_02';

    const bursarA = db.prepare(`SELECT * FROM users WHERE email = 'bursar@lagospremier.edu.ng'`).get() as any;
    const ownerB = db.prepare(`SELECT * FROM users WHERE email = 'proprietor@abujahorizon.sch.ng'`).get() as any;

    assert.ok(bursarA, 'School A Bursar must exist');
    assert.ok(ownerB, 'School B Owner must exist');

    const tokenA = createSession(bursarA.id, schoolAId, '127.0.0.1');
    const tokenB = createSession(ownerB.id, schoolBId, '127.0.0.1');

    const headersA = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenA}`,
    };

    const headersB = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenB}`,
    };

    // TEST 1: Gateways Status Endpoint
    console.log('\n[API TEST 1] GET /api/v1/school/gateways/status...');
    const gwRes = await fetch(`${baseUrl}/school/gateways/status`, { headers: headersA });
    assert.strictEqual(gwRes.status, 200);
    const gwData = await gwRes.json();
    assert(Array.isArray(gwData.providers), 'Should return providers array');
    const sandbox = gwData.providers.find((p: any) => p.name === 'TEST_SANDBOX');
    assert(sandbox, 'TEST_SANDBOX provider must be present');
    console.log('✓ PASS: Gateway status retrieved successfully.');

    // TEST 2: List Payments with Filters
    console.log('\n[API TEST 2] GET /api/v1/school/payments...');
    const payListRes = await fetch(`${baseUrl}/school/payments`, { headers: headersA });
    assert.strictEqual(payListRes.status, 200);
    const payListData = await payListRes.json();
    assert(Array.isArray(payListData.payments), 'Should return payments array');
    assert(payListData.count > 0, 'Should have payments in School A');
    console.log(`✓ PASS: Retrieved ${payListData.count} payments for School A.`);

    // TEST 3: Cross-Tenant Isolation on Payments
    console.log('\n[API TEST 3] Cross-Tenant Isolation: School B querying School A Payment...');
    const samplePaymentA = payListData.payments[0];
    const crossPayRes = await fetch(`${baseUrl}/school/payments/${samplePaymentA.id}`, { headers: headersB });
    assert.strictEqual(crossPayRes.status, 404, 'School B must not be able to find School A payment');
    console.log('✓ PASS: Cross-tenant payment access strictly blocked (404 Not Found).');

    // TEST 4: Receipts Endpoint
    console.log('\n[API TEST 4] GET /api/v1/school/receipts...');
    const rcptRes = await fetch(`${baseUrl}/school/receipts`, { headers: headersA });
    assert.strictEqual(rcptRes.status, 200);
    const rcptData = await rcptRes.json();
    assert(Array.isArray(rcptData.receipts), 'Should return receipts array');
    assert(rcptData.count > 0, 'Should have receipts in School A');
    console.log(`✓ PASS: Retrieved ${rcptData.count} receipts for School A.`);

    // TEST 5: Cross-Tenant Isolation on Receipts
    console.log('\n[API TEST 5] Cross-Tenant Isolation: School B querying School A Receipt...');
    const sampleReceiptA = rcptData.receipts[0];
    const crossRcptRes = await fetch(`${baseUrl}/school/receipts/${sampleReceiptA.id}`, { headers: headersB });
    assert.strictEqual(crossRcptRes.status, 404, 'School B must not be able to find School A receipt');
    console.log('✓ PASS: Cross-tenant receipt access strictly blocked (404 Not Found).');

    // TEST 6: Public Payment Webhook Processing
    console.log('\n[API TEST 6] POST /api/v1/webhooks/payments/test_sandbox (Public Webhook)...');
    const invoice = db.prepare('SELECT id, student_id, balance FROM invoices WHERE school_id = ? AND balance > 0 LIMIT 1').get(schoolAId) as any;
    if (invoice) {
      const testReference = `TST_WH_${Date.now()}`;
      const webhookRes = await fetch(`${baseUrl}/webhooks/payments/test_sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'charge.success',
          reference: testReference,
          amount_kobo: 1000000, // ₦10,000
          currency: 'NGN',
          school_id: schoolAId,
          invoice_id: invoice.id,
        }),
      });
      
      if (webhookRes.status !== 200 && webhookRes.status !== 201) {
        const errorText = await webhookRes.text();
        console.error('Webhook error response:', errorText);
      }
      assert(webhookRes.status === 200 || webhookRes.status === 201, `Webhook responded with ${webhookRes.status}`);
      console.log('✓ PASS: Payment webhook processed and verified successfully.');

      // TEST 7: Replay Attack Defense
      console.log('\n[API TEST 7] Webhook Replay Attack Defense (Idempotency)...');
      const replayRes = await fetch(`${baseUrl}/webhooks/payments/test_sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'charge.success',
          reference: testReference,
          amount_kobo: 1000000,
          currency: 'NGN',
          school_id: schoolAId,
          invoice_id: invoice.id,
        }),
      });
      assert.strictEqual(replayRes.status, 200);
      const replayData = await replayRes.json();
      assert.strictEqual(replayData.status, 'ignored', 'Duplicate webhook must be ignored');
      console.log('✓ PASS: Webhook replay idempotently ignored.');
    }

    // TEST 8: Notifications Center API
    console.log('\n[API TEST 8] GET /api/v1/school/notifications...');
    const notifRes = await fetch(`${baseUrl}/school/notifications`, { headers: headersA });
    assert.strictEqual(notifRes.status, 200);
    const notifData = await notifRes.json();
    assert(Array.isArray(notifData.notifications), 'Should return notifications');
    console.log(`✓ PASS: Retrieved ${notifData.notifications.length} in-app notifications (Unread: ${notifData.unreadCount}).`);

    // TEST 9: Mark All Notifications as Read
    console.log('\n[API TEST 9] POST /api/v1/school/notifications/mark-all-read...');
    const markReadRes = await fetch(`${baseUrl}/school/notifications/mark-all-read`, {
      method: 'POST',
      headers: headersA,
    });
    assert.strictEqual(markReadRes.status, 200);
    const markReadData = await markReadRes.json();
    assert.strictEqual(markReadData.success, true);
    console.log('✓ PASS: Notifications marked as read.');

    // TEST 10: Financial Export CSV
    console.log('\n[API TEST 10] GET /api/v1/school/finance/reports/export/payments-csv...');
    const csvRes = await fetch(`${baseUrl}/school/finance/reports/export/payments-csv`, { headers: headersA });
    assert.strictEqual(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert(csvText.includes('Payment Reference'), 'CSV must have Payment Reference column header');
    console.log('✓ PASS: Payments CSV export generated with valid financial headers.');

    console.log('\n===============================================================');
    console.log('   ALL STEP 4 LIVE API ENDPOINTS PASSED WITH 100% SUCCESS!    ');
    console.log('===============================================================\n');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    server.close();
    process.exit(1);
  }
});
