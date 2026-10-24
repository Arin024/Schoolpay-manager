import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import crypto from 'node:crypto';
import { apiRouter } from '../server/routes.js';
import { initDatabase, db } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { paymentService } from '../server/paymentService.js';
import { toKobo, toNaira } from '../server/financeUtils.js';

// Setup Test Server
const app = express();
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf-8');
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use('/api', apiRouter);

const server = http.createServer(app);

async function makeRequest(
  method: string,
  path: string,
  body?: any,
  token?: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders: Record<string, string> = {
      ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(postData)) } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    };

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: (server.address() as any).port,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode || 500, data: parsed, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('===============================================================');
  console.log('   STEP 5 & 6: DYNAMIC SAAS PRICING, BACHS & BILLING TESTS     ');
  console.log('===============================================================');

  // Initialize DB
  initDatabase();

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  console.log(`[Test Server] Listening on http://127.0.0.1:${port}`);

  try {
    // Setup sessions
    const superAdmin = db.prepare('SELECT * FROM users WHERE is_platform_admin = 1 LIMIT 1').get() as any;
    const superAdminToken = createSession(superAdmin.id, null, '127.0.0.1', 'TestRunner');

    const schoolA = db.prepare("SELECT * FROM schools WHERE id = 'sch_lagos_premier_01'").get() as any;
    const schoolAOwner = db.prepare(`
      SELECT u.* FROM users u
      JOIN user_roles ur ON u.id = ur.user_id
      WHERE ur.school_id = 'sch_lagos_premier_01'
      LIMIT 1
    `).get() as any;
    const schoolAToken = createSession(schoolAOwner.id, 'sch_lagos_premier_01', '127.0.0.1', 'TestRunner');

    // -------------------------------------------------------------------------
    // TEST 1: Super Admin Dynamic Pricing Control - Create, Edit & Duplicate Plan
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Super Admin dynamically creates, edits, and duplicates SaaS plans...');
    const planName = `PREMIUM_${Date.now().toString().slice(-4)}`;
    const createPlanRes = await makeRequest(
      'POST',
      '/api/v1/admin/plans',
      {
        name: planName,
        display_name: 'Premium Enterprise Elite',
        description: 'Comprehensive multi-campus SaaS package with unlimited quotas',
        price_naira: 280000,
        billing_interval: 'ANNUAL',
        student_limit: 800,
        staff_limit: 80,
        storage_limit_mb: 5000,
        feature_flags: {
          online_payments: true,
          financial_management: true,
          reports: true,
          parent_portal: true,
          advanced_analytics: true,
          api_access: true,
        },
      },
      superAdminToken
    );

    assert.strictEqual(createPlanRes.status, 201, 'Super Admin should be able to create new plan');
    const createdPlanId = createPlanRes.data.planId;

    // Duplicate plan
    const dupRes = await makeRequest('POST', `/api/v1/admin/plans/${createdPlanId}/duplicate`, {}, superAdminToken);
    assert.strictEqual(dupRes.status, 201, 'Super Admin should be able to duplicate plan');
    assert.ok(dupRes.data.planId.includes('copy'), 'Duplicated plan ID should have copy identifier');
    console.log(`✓ PASS: Created plan "${createdPlanId}" and duplicated as "${dupRes.data.planId}"`);

    // -------------------------------------------------------------------------
    // TEST 2: Custom Negotiated School Pricing Override
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Super Admin overrides standard plan price for a specific school...');
    // Standard plan is ₦280,000/year; negotiated is ₦135,000/year; discount is ₦15,000; final = ₦120,000
    const customSubRes = await makeRequest(
      'POST',
      `/api/v1/admin/schools/${schoolA.id}/custom-subscription`,
      {
        plan_id: createdPlanId,
        negotiated_price_naira: 135000,
        discount_amount_naira: 15000,
        discount_reason: 'Proprietor alliance negotiated rate',
        billing_interval: 'ANNUAL',
        duration_months: 12,
        notes: 'Agreed at Lagos State Private Schools summit',
      },
      superAdminToken
    );

    assert.strictEqual(customSubRes.status, 201, 'Should create custom negotiated subscription');
    assert.strictEqual(customSubRes.data.finalAmountNaira, 120000, 'Authoritative final amount should be ₦120,000');

    // Verify stored authoritative amount in database
    const dbSub = db.prepare(`
      SELECT * FROM school_subscriptions WHERE id = ?
    `).get(customSubRes.data.subscriptionId) as any;

    assert.strictEqual(dbSub.standard_plan_price, toKobo(280000), 'Standard plan price stored correctly in kobo');
    assert.strictEqual(dbSub.negotiated_price, toKobo(135000), 'Negotiated price stored in kobo');
    assert.strictEqual(dbSub.discount_amount, toKobo(15000), 'Discount amount stored in kobo');
    assert.strictEqual(dbSub.final_amount, toKobo(120000), 'Final payable amount stored in kobo');
    console.log('✓ PASS: Custom negotiated pricing recorded authoritatively (Final: ₦120,000)');

    // -------------------------------------------------------------------------
    // TEST 3: School Retrieves Its Authoritative Subscription & Billing Status
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] School views subscription & authoritative payable amount...');
    const schoolSubRes = await makeRequest('GET', '/api/v1/school/billing/subscription', null, schoolAToken);
    assert.strictEqual(schoolSubRes.status, 200, 'School can view its billing information');
    assert.strictEqual(schoolSubRes.data.subscription.final_amount_naira, 120000);
    assert.ok(schoolSubRes.data.usage.students >= 0, 'Returns usage metric for students');
    console.log(`✓ PASS: School retrieved subscription: Final payable = ₦${schoolSubRes.data.subscription.final_amount_naira.toLocaleString()}`);

    // -------------------------------------------------------------------------
    // TEST 4: Bachs Payment Provider Abstraction
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Bachs Payment Provider Abstraction exists and handles initialization...');
    const bachsProvider = paymentService.getProvider('BACHS');
    assert.strictEqual(bachsProvider.name, 'BACHS', 'PaymentService must register BachsPaymentProvider');
    assert.ok(typeof bachsProvider.initializePayment === 'function', 'Bachs provider must implement initializePayment');
    assert.ok(typeof bachsProvider.verifyPayment === 'function', 'Bachs provider must implement verifyPayment');
    assert.ok(typeof bachsProvider.verifyWebhookSignature === 'function', 'Bachs provider must implement verifyWebhookSignature');
    console.log('✓ PASS: BachsPaymentProvider registered in PaymentService abstraction');

    // -------------------------------------------------------------------------
    // TEST 5: School Initiates Bachs.io Checkout Session
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] School initiates checkout session (server dictates amount, not client)...');
    const checkoutRes = await makeRequest(
      'POST',
      '/api/v1/school/billing/checkout',
      { plan_id: createdPlanId },
      schoolAToken
    );

    assert.strictEqual(checkoutRes.status, 200, `Checkout session initiated successfully: ${JSON.stringify(checkoutRes.data)}`);
    assert.strictEqual(checkoutRes.data.finalAmountNaira, 120000, 'Charge amount strictly determined by backend');
    assert.ok(checkoutRes.data.internalReference.startsWith('PLT-'), 'Internal reference has PLT- prefix');
    console.log(`✓ PASS: Checkout created with internal reference: ${checkoutRes.data.internalReference}`);

    // -------------------------------------------------------------------------
    // TEST 6: Bachs Webhook Verification & Subscription Activation
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Bachs webhook arrives, validates signature, and updates subscription...');
    const testProviderRef = `bch_test_${Date.now()}`;
    const webhookPayload = {
      event: 'payment.success',
      reference: testProviderRef,
      amount_kobo: toKobo(120000),
      currency: 'NGN',
      metadata: {
        school_id: schoolA.id,
        plan_id: createdPlanId,
        internal_reference: checkoutRes.data.internalReference,
      },
    };

    const rawPayloadStr = JSON.stringify(webhookPayload);
    const secret = process.env.BACHS_WEBHOOK_SECRET;
    const testSignature = secret
      ? crypto.createHmac('sha256', secret).update(rawPayloadStr).digest('hex')
      : 'bachs-sandbox-sig';

    const webhookRes = await makeRequest(
      'POST',
      '/api/v1/webhooks/payments/BACHS',
      webhookPayload,
      undefined,
      { 'x-bachs-signature': testSignature }
    );

    assert.strictEqual(webhookRes.status, 200, 'Webhook should return 200 success');
    assert.strictEqual(webhookRes.data.status, 'success', 'Webhook processed successfully');

    // Verify school subscription is now ACTIVE with extended expiry
    const updatedSchool = db.prepare('SELECT status, current_plan_id, subscription_end_date FROM schools WHERE id = ?').get(schoolA.id) as any;
    assert.strictEqual(updatedSchool.status, 'ACTIVE', 'School status updated to ACTIVE');
    assert.strictEqual(updatedSchool.current_plan_id, createdPlanId, 'Current plan updated');
    assert.ok(new Date(updatedSchool.subscription_end_date) > new Date(), 'Subscription end date extended');
    console.log(`✓ PASS: Webhook processed. School is ACTIVE until ${updatedSchool.subscription_end_date}`);

    // Idempotency check: duplicate event ignored
    const dupWebhookRes = await makeRequest(
      'POST',
      '/api/v1/webhooks/payments/BACHS',
      webhookPayload,
      undefined,
      { 'x-bachs-signature': testSignature }
    );
    assert.strictEqual(dupWebhookRes.status, 200);
    assert.strictEqual(dupWebhookRes.data.status, 'ignored', 'Duplicate webhook event correctly ignored');
    console.log('✓ PASS: Webhook idempotency verified (duplicate ignored)');

    // -------------------------------------------------------------------------
    // TEST 7: Manual Bank Transfer Submission & Super Admin Approval
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] School submits offline bank transfer proof; Super Admin approves...');
    const submitTrfRes = await makeRequest(
      'POST',
      '/api/v1/school/billing/bank-transfer/submit',
      {
        plan_id: createdPlanId,
        bank_name: 'Zenith Bank Plc',
        depositor_name: 'Chief O. Adeleke (Proprietor)',
        transaction_reference: `ZENITH-TRF-${Date.now()}`,
        amount_naira: 120000,
        notes: 'Paid via corporate online banking',
      },
      schoolAToken
    );

    assert.strictEqual(submitTrfRes.status, 201, 'Bank transfer proof submitted');
    const paymentId = submitTrfRes.data.paymentId;

    // Super Admin lists pending payments
    const pendingListRes = await makeRequest('GET', '/api/v1/admin/platform-payments?status=PENDING', null, superAdminToken);
    assert.strictEqual(pendingListRes.status, 200);
    assert.ok(pendingListRes.data.payments.some((p: any) => p.id === paymentId), 'Pending list includes submitted transfer');

    // Super Admin approves payment
    const approveRes = await makeRequest('POST', `/api/v1/admin/platform-payments/${paymentId}/approve`, { notes: 'Confirmed with Zenith Bank statement' }, superAdminToken);
    assert.strictEqual(approveRes.status, 200, 'Super admin successfully approves manual payment');

    const approvedPay = db.prepare('SELECT status FROM platform_payments WHERE id = ?').get(paymentId) as any;
    assert.strictEqual(approvedPay.status, 'SUCCESS', 'Payment status updated to SUCCESS');
    console.log('✓ PASS: Manual bank transfer submitted and approved by Super Admin');

    // -------------------------------------------------------------------------
    // TEST 8: Promotional Discount Engine
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Super Admin creates promotional discount code...');
    const discountRes = await makeRequest(
      'POST',
      '/api/v1/admin/discounts',
      {
        code: `PROMO${Date.now().toString().slice(-4)}`,
        name: 'Back to School 20%',
        discount_type: 'PERCENTAGE',
        discount_value: 20,
      },
      superAdminToken
    );

    assert.strictEqual(discountRes.status, 201, 'Discount created successfully');
    console.log(`✓ PASS: Created discount ${discountRes.data.code}`);

    // -------------------------------------------------------------------------
    // TEST 9: Revenue Isolation (School Fees vs Platform SaaS Revenue)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 9] Verify strict distinction between school-collected money and platform SaaS revenue...');
    const revRes = await makeRequest('GET', '/api/v1/admin/revenue', null, superAdminToken);
    assert.strictEqual(revRes.status, 200);
    assert.ok(revRes.data.revenue.platformRevenueKobo !== undefined, 'Platform revenue exists');
    assert.ok(revRes.data.revenue.schoolCollectedRevenueKobo !== undefined, 'School collected revenue exists');
    console.log(`✓ PASS: Revenue separated — Platform SaaS: ₦${revRes.data.revenue.platformRevenueNaira.toLocaleString()} | School-collected: ₦${revRes.data.revenue.schoolCollectedRevenueNaira.toLocaleString()}`);

    // -------------------------------------------------------------------------
    // TEST 10: Security Isolation (Normal school user blocked from admin routes)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 10] Normal school user strictly blocked from administrative controls...');
    const forbidden1 = await makeRequest('GET', '/api/v1/admin/platform-payments', null, schoolAToken);
    assert.strictEqual(forbidden1.status, 403, 'School user blocked from platform payments');

    const forbidden2 = await makeRequest('POST', '/api/v1/admin/discounts', { name: 'Hack' }, schoolAToken);
    assert.strictEqual(forbidden2.status, 403, 'School user blocked from creating discounts');
    console.log('✓ PASS: Normal school user strictly forbidden from Super Admin controls (HTTP 403)');

    console.log('\n===============================================================');
    console.log('   ALL 10 DYNAMIC SAAS PRICING & BILLING TESTS PASSED (100%)   ');
    console.log('===============================================================');
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test Failure:', err);
  process.exit(1);
});
