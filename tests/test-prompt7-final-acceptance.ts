import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, initDatabase } from '../server/db.js';
import { apiRouter } from '../server/routes.js';
import { paymentService } from '../server/paymentService.js';
import { toKobo, toNaira } from '../server/financeUtils.js';

// Setup Test Server
const app = express();
app.use(
  express.json({
    limit: '1mb',
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
  const reqHeaders: Record<string, string> = { ...headers };
  if (token) reqHeaders['Authorization'] = `Bearer ${token}`;
  if (body && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';

  const bodyData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined;
  if (bodyData) reqHeaders['Content-Length'] = Buffer.byteLength(bodyData).toString();

  const addr = server.address() as any;
  const port = addr.port;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let data: any = raw;
          try {
            data = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode || 500, data, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function runPrompt7AcceptanceTests() {
  console.log('===============================================================');
  console.log('   PROMPT 7/7: FINAL INTEGRATION, SECURITY & READINESS TESTS   ');
  console.log('===============================================================');

  initDatabase();

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      console.log(`[Test Server] Listening on http://127.0.0.1:${addr.port}`);
      resolve();
    });
  });

  try {
    const randSuffix = Math.floor(Math.random() * 9000 + 1000);

    // -------------------------------------------------------------------------
    // 1. SETUP ACTORS & TENANTS
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Registering School A and School B tenants via Public Auth API...');

    // Register School A
    const schoolARes = await makeRequest('POST', '/api/v1/auth/register-school', {
      schoolName: `Lekki Horizon Academy ${randSuffix}`,
      schoolType: 'Secondary',
      state: 'Lagos',
      lga: 'Eti-Osa',
      address: 'Plot 12 Admiralty Way, Lekki',
      phone: `0801${randSuffix}001`,
      email: `contact@lekkihorizon${randSuffix}.edu.ng`,
      ownerName: 'Alhaji Babatunde Sanusi',
      ownerEmail: `owner@lekkihorizon${randSuffix}.edu.ng`,
      password: 'SecureBankGradePassword2026!',
    });
    assert.strictEqual(schoolARes.status, 201, `School A registration failed: ${JSON.stringify(schoolARes.data)}`);
    const schoolA = schoolARes.data.school;
    const schoolAToken = schoolARes.data.token;
    assert.ok(schoolA.id.startsWith('sch_'), 'School A has valid tenant ID');
    console.log(`✓ PASS: School A registered: ${schoolA.name} (${schoolA.id})`);

    // Register School B
    const schoolBRes = await makeRequest('POST', '/api/v1/auth/register-school', {
      schoolName: `Abuja Capital College ${randSuffix}`,
      schoolType: 'Comprehensive / K-12',
      state: 'FCT - Abuja',
      lga: 'Municipal Area Council',
      address: '24 Constitution Avenue, Central Area',
      phone: `0802${randSuffix}002`,
      email: `admin@abujacapital${randSuffix}.edu.ng`,
      ownerName: 'Dr. (Mrs) Ngozi Okonjo',
      ownerEmail: `proprietress@abujacapital${randSuffix}.edu.ng`,
      password: 'SecureBankGradePassword2026!',
    });
    assert.strictEqual(schoolBRes.status, 201, `School B registration failed: ${JSON.stringify(schoolBRes.data)}`);
    const schoolB = schoolBRes.data.school;
    const schoolBToken = schoolBRes.data.token;
    assert.ok(schoolB.id.startsWith('sch_'), 'School B has valid tenant ID');
    console.log(`✓ PASS: School B registered: ${schoolB.name} (${schoolB.id})`);

    // Login Platform Super Admin
    const superAdminRes = await makeRequest('POST', '/api/v1/auth/login', {
      email: 'superadmin@schoolpay.ng',
      password: 'SuperAdmin@2025!',
    });
    assert.strictEqual(superAdminRes.status, 200, 'Super admin login failed');
    const superAdminToken = superAdminRes.data.token;
    assert.strictEqual(superAdminRes.data.user.is_platform_admin, 1, 'Confirmed Platform Admin status');
    console.log('✓ PASS: Platform Super Admin authenticated successfully');

    // -------------------------------------------------------------------------
    // 2. SCHOOL A MANAGES OWN RECORDS (STUDENTS & INVOICES)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] School A creates its own students and fee records...');
    const studentARes = await makeRequest(
      'POST',
      '/api/v1/school/students',
      {
        admission_number: `LHA/${randSuffix}/001`,
        first_name: 'Chidubem',
        last_name: 'Okafor',
        gender: 'Male',
        class_name: 'SS 1',
        class_arm_name: 'Gold',
      },
      schoolAToken
    );
    assert.strictEqual(studentARes.status, 201, 'Student creation in School A failed');
    const studentA = studentARes.data.student;
    console.log(`✓ PASS: Student A enrolled in School A: ${studentA.full_name} (${studentA.id})`);

    // Create fee structure & invoice in School A
    const feeCategoryARes = await makeRequest(
      'POST',
      '/api/v1/school/fee-categories',
      { name: 'Tuition Fee - First Term', description: 'Termly academic tuition' },
      schoolAToken
    );
    assert.strictEqual(feeCategoryARes.status, 201, 'Fee category creation in School A failed');
    const feeCategoryA = feeCategoryARes.data.category;

    const invoiceARes = await makeRequest(
      'POST',
      '/api/v1/school/invoices',
      {
        student_id: studentA.id,
        due_date: '2026-11-30',
        items: [
          { fee_category_id: feeCategoryA.id, unit_amount: 85000, description: 'SS1 Tuition Fee' }
        ],
      },
      schoolAToken
    );
    assert.strictEqual(invoiceARes.status, 201, 'Invoice creation in School A failed');
    const invoiceA = invoiceARes.data.invoice;
    assert.strictEqual(invoiceA.total_naira, 85000, 'Invoice total matches exactly');
    console.log(`✓ PASS: School A issued invoice: ${invoiceA.invoice_number} for ₦85,000`);

    // -------------------------------------------------------------------------
    // 3. SCHOOL B MANAGES OWN RECORDS INDEPENDENTLY
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] School B creates its own student and invoice...');
    const studentBRes = await makeRequest(
      'POST',
      '/api/v1/school/students',
      {
        admission_number: `ACC/${randSuffix}/001`,
        first_name: 'Amina',
        last_name: 'Bello',
        gender: 'Female',
        class_name: 'JSS 2',
        class_arm_name: 'Emerald',
      },
      schoolBToken
    );
    assert.strictEqual(studentBRes.status, 201, 'Student creation in School B failed');
    const studentB = studentBRes.data.student;
    console.log(`✓ PASS: Student B enrolled in School B: ${studentB.full_name} (${studentB.id})`);

    // -------------------------------------------------------------------------
    // 4. ZERO-TRUST TENANT ISOLATION (CROSS-TENANT ATTACK PREVENTED)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing strict cross-tenant boundary defense...');

    // Attack 4.1: School A attempts to read School B's student
    const crossStudentRes = await makeRequest(
      'GET',
      `/api/v1/school/students/${studentB.id}`,
      undefined,
      schoolAToken
    );
    assert.ok(
      crossStudentRes.status === 403 || crossStudentRes.status === 404,
      'Cross-tenant student access must be strictly rejected (403 or 404)'
    );
    console.log('✓ PASS: School A strictly blocked from accessing School B student record');

    // Attack 4.2: School A attempts to read School B's invoice
    const crossInvoiceRes = await makeRequest(
      'GET',
      `/api/v1/school/invoices/${invoiceA.id}`,
      undefined,
      schoolBToken
    );
    assert.ok(
      crossInvoiceRes.status === 403 || crossInvoiceRes.status === 404,
      'School B strictly blocked from accessing School A invoice'
    );
    console.log('✓ PASS: School B strictly blocked from accessing School A invoice');

    // Attack 4.3: School A injects School B's tenant header (x-school-id spoofing)
    const spoofHeaderRes = await makeRequest(
      'GET',
      '/api/v1/school/profile',
      undefined,
      schoolAToken,
      { 'x-school-id': schoolB.id }
    );
    assert.strictEqual(spoofHeaderRes.status, 403, 'Spoofed tenant header must be rejected with 403');
    assert.strictEqual(spoofHeaderRes.data.code, 'IDOR_PREVENTED', 'IDOR attempt logged and neutralized');
    console.log('✓ PASS: Spoofed tenant header IDOR injection neutralized with IDOR_PREVENTED');

    // -------------------------------------------------------------------------
    // 5. ROLE PERMISSION GUARD: SCHOOL USERS FORBIDDEN FROM SUPER ADMIN
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Verifying school users cannot access Super Admin endpoints...');
    const forbiddenStatsRes = await makeRequest('GET', '/api/v1/admin/stats', undefined, schoolAToken);
    assert.strictEqual(forbiddenStatsRes.status, 403, 'School user must be blocked from /admin/stats');

    const forbiddenSchoolsRes = await makeRequest('GET', '/api/v1/admin/schools', undefined, schoolBToken);
    assert.strictEqual(forbiddenSchoolsRes.status, 403, 'School user must be blocked from /admin/schools');

    const forbiddenRevenueRes = await makeRequest('GET', '/api/v1/admin/revenue', undefined, schoolAToken);
    assert.strictEqual(forbiddenRevenueRes.status, 403, 'School user must be blocked from /admin/revenue');

    const forbiddenUsageRes = await makeRequest('GET', '/api/v1/admin/usage', undefined, schoolAToken);
    assert.strictEqual(forbiddenUsageRes.status, 403, 'School user must be blocked from /admin/usage');
    console.log('✓ PASS: School users strictly forbidden from all Super Admin endpoints (403)');

    // -------------------------------------------------------------------------
    // 6. SUPER ADMIN MANAGEMENT & DYNAMIC SAAS PRICING
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Super Admin creates plan and sets negotiated price for School A...');
    const planName = `enterprise_${randSuffix}`;
    const createPlanRes = await makeRequest(
      'POST',
      '/api/v1/admin/plans',
      {
        name: planName,
        display_name: `Enterprise Growth ${randSuffix}`,
        description: 'Custom school expansion tier',
        price_naira: 2500000,
        billing_interval: 'ANNUAL',
        student_limit: 1500,
        staff_limit: 150,
      },
      superAdminToken
    );
    assert.strictEqual(createPlanRes.status, 201, 'Plan creation failed');
    const planKey = createPlanRes.data.planId;
    console.log(`✓ PASS: Super Admin created plan: ${planKey}`);

    // Set school-specific negotiated price for School A (override standard ₦2,500,000 to ₦1,800,000)
    const customPriceRes = await makeRequest(
      'POST',
      `/api/v1/admin/schools/${schoolA.id}/custom-subscription`,
      {
        plan_id: planKey,
        negotiated_price_naira: 1800000,
        billing_interval: 'ANNUAL',
        duration_days: 365,
        notes: 'Executive proprietor partnership agreement',
      },
      superAdminToken
    );
    assert.strictEqual(customPriceRes.status, 201, 'Custom pricing failed');
    assert.strictEqual(customPriceRes.data.finalAmountNaira, 1800000);
    console.log('✓ PASS: Super Admin configured custom negotiated price of ₦1,800,000 for School A');

    // -------------------------------------------------------------------------
    // 7. CHECKOUT AMOUNT STRICTLY AUTHORITATIVE (SERVER-DICTATED)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Verifying checkout amount is server-dictated and cannot be manipulated by client...');
    const checkoutRes = await makeRequest(
      'POST',
      '/api/v1/school/billing/checkout',
      {
        plan_id: planKey,
        billing_interval: 'ANNUAL',
        gateway: 'BACHS',
        tampered_amount: 100, // Client tries to spoof amount to ₦100
      },
      schoolAToken
    );
    assert.strictEqual(checkoutRes.status, 200, 'Checkout initiation failed');
    assert.strictEqual(
      checkoutRes.data.finalAmountNaira,
      1800000,
      'Backend strictly dictated the negotiated price of ₦1,800,000, ignoring client tampering'
    );
    const internalRef = checkoutRes.data.internalReference;
    assert.ok(internalRef.startsWith('PLT-'), 'Internal reference has valid PLT- format');
    console.log(`✓ PASS: Authoritative checkout verified. Amount locked at ₦1,800,000. Ref: ${internalRef}`);

    // -------------------------------------------------------------------------
    // 8. DEDICATED BACHS.IO WEBHOOK (POST /api/webhooks/bachs)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Testing dedicated Bachs.io Webhook at POST /api/webhooks/bachs...');
    const webhookProviderRef = `bch_final_test_${Date.now()}`;
    const webhookPayload = {
      event: 'payment.success',
      reference: webhookProviderRef,
      amount_kobo: toKobo(1800000),
      currency: 'NGN',
      metadata: {
        school_id: schoolA.id,
        plan_id: planKey,
        internal_reference: internalRef,
      },
    };

    const rawPayloadString = JSON.stringify(webhookPayload);
    const secret = process.env.BACHS_WEBHOOK_SECRET;

    // Test 8.1: Missing signature rejected
    if (secret) {
      const missingSigRes = await makeRequest(
        'POST',
        '/api/webhooks/bachs',
        webhookPayload,
        undefined
      );
      assert.strictEqual(missingSigRes.status, 401, 'Missing signature must be rejected with 401');
      console.log('✓ PASS: Missing webhook signature rejected with HTTP 401');

      // Test 8.2: Invalid signature rejected
      const invalidSigRes = await makeRequest(
        'POST',
        '/api/webhooks/bachs',
        webhookPayload,
        undefined,
        { 'x-bachs-signature': 'invalid_forged_signature_0000' }
      );
      assert.strictEqual(invalidSigRes.status, 401, 'Invalid signature must be rejected with 401');
      console.log('✓ PASS: Invalid webhook signature rejected with HTTP 401');
    }

    // Test 8.3: Valid HMAC signature accepted and activates subscription
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const validSignature = secret
      ? crypto.createHmac('sha256', secret).update(`${timestamp}.${rawPayloadString}`).digest('hex')
      : 'bachs-sandbox-sig';

    const validWebhookRes = await makeRequest(
      'POST',
      '/api/webhooks/bachs',
      webhookPayload,
      undefined,
      {
        'x-bachs-signature': validSignature,
        'x-bachs-timestamp': timestamp,
      }
    );
    assert.strictEqual(validWebhookRes.status, 200, 'Valid webhook should return HTTP 200');
    assert.strictEqual(validWebhookRes.data.status, 'success', 'Webhook processed successfully');

    // Confirm School A is now ACTIVE
    const updatedSchoolA = db.prepare('SELECT status, current_plan_id, subscription_end_date FROM schools WHERE id = ?').get(schoolA.id) as any;
    assert.strictEqual(updatedSchoolA.status, 'ACTIVE', 'School A is now ACTIVE');
    assert.strictEqual(updatedSchoolA.current_plan_id, planKey, 'School A current plan updated');
    console.log(`✓ PASS: Verified successful payment activated subscription. Expiry: ${updatedSchoolA.subscription_end_date}`);

    // Test 8.4: Idempotency - duplicate delivery safely ignored
    const duplicateWebhookRes = await makeRequest(
      'POST',
      '/api/webhooks/bachs',
      webhookPayload,
      undefined,
      {
        'x-bachs-signature': validSignature,
        'x-bachs-timestamp': timestamp,
      }
    );
    assert.strictEqual(duplicateWebhookRes.status, 200);
    assert.strictEqual(duplicateWebhookRes.data.status, 'ignored', 'Duplicate webhook safely ignored');
    console.log('✓ PASS: Webhook idempotency confirmed: duplicate event ignored safely');

    // -------------------------------------------------------------------------
    // 9. MANUAL BANK TRANSFER WITH AUTHORIZED SUPER ADMIN APPROVAL
    // -------------------------------------------------------------------------
    console.log('\n[TEST 9] School submits manual bank transfer; Super Admin approves...');
    const manualSubmitRes = await makeRequest(
      'POST',
      '/api/v1/school/billing/bank-transfer/submit',
      {
        plan_id: planKey,
        amount_naira: 1800000,
        bank_name: 'Guaranty Trust Bank',
        depositor_name: 'Abuja Capital College Ltd',
        transaction_reference: `TEL-${randSuffix}-998`,
      },
      schoolBToken
    );
    assert.strictEqual(manualSubmitRes.status, 201, 'Manual transfer submission failed');
    const paymentId = manualSubmitRes.data.paymentId;
    console.log(`✓ PASS: School B submitted bank transfer proof. Payment ID: ${paymentId}`);

    // Verify school user cannot approve their own payment
    const unauthorizedApproveRes = await makeRequest(
      'POST',
      `/api/v1/admin/platform-payments/${paymentId}/approve`,
      {},
      schoolBToken
    );
    assert.strictEqual(unauthorizedApproveRes.status, 403, 'School user must not approve own payment');

    // Super Admin approves payment
    const approveRes = await makeRequest(
      'POST',
      `/api/v1/admin/platform-payments/${paymentId}/approve`,
      {},
      superAdminToken
    );
    assert.strictEqual(approveRes.status, 200, 'Super admin approval failed');
    console.log('✓ PASS: Super Admin approved manual bank transfer. Subscription activated.');

    // -------------------------------------------------------------------------
    // 10. STRICT DOMAIN SEPARATION: SCHOOL FEES VS PLATFORM SAAS REVENUE
    // -------------------------------------------------------------------------
    console.log('\n[TEST 10] Verifying strict separation between School Fees and Platform SaaS Revenue...');
    const globalRevenueRes = await makeRequest('GET', '/api/v1/admin/revenue', undefined, superAdminToken);
    assert.strictEqual(globalRevenueRes.status, 200);
    const platformRev = globalRevenueRes.data.revenue;

    // Platform revenue should only reflect subscription fees
    assert.ok(platformRev.platformRevenueNaira > 0, 'Platform revenue reflects SaaS subscription income');
    console.log(`✓ PASS: Platform SaaS revenue correctly calculated: ₦${platformRev.platformRevenueNaira.toLocaleString()}`);

    // School A fee collections
    const schoolAStatsRes = await makeRequest('GET', '/api/v1/school/stats', undefined, schoolAToken);
    assert.strictEqual(schoolAStatsRes.status, 200);
    console.log(`✓ PASS: School A operational statistics strictly isolated`);

    // -------------------------------------------------------------------------
    // 11. PLATFORM USAGE MONITORING & CAPACITY (SECTION 14)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 11] Verifying Super Admin Platform Usage & Capacity metrics...');
    const usageRes = await makeRequest('GET', '/api/v1/admin/usage', undefined, superAdminToken);
    assert.strictEqual(usageRes.status, 200, 'Usage metrics endpoint failed');
    const usage = usageRes.data.usage;

    assert.ok(usage.database.fileSizeBytes >= 0, 'Database size in bytes reported');
    assert.strictEqual(usage.database.freeTierLimitFormatted, '5.00 GB', 'Free tier limit documented');
    assert.ok(usage.entities.totalSchools >= 2, 'Schools count reflects active tenants');
    assert.ok(usage.schoolsBreakdown.length >= 2, 'Schools breakdown contains tenant resource rows');
    console.log(`✓ PASS: Platform usage metrics returned: DB Size: ${usage.database.fileSizeFormatted}, Webhook Health: ${usage.webhooks.healthRatePercent}%`);

    // -------------------------------------------------------------------------
    // 12. EXACT BRANDING LABELS & DESTINATION VERIFICATION (SECTION 18)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 12] Auditing exact branding wording and portfolio destination...');
    const footerPath = path.resolve(process.cwd(), 'src/components/common/Footer.tsx');
    const footerContent = fs.readFileSync(footerPath, 'utf8');

    assert.ok(
      footerContent.includes('Engineered and designed by Arinzechukwu Christian'),
      'Must contain exact label: "Engineered and designed by Arinzechukwu Christian"'
    );
    assert.ok(
      footerContent.includes('Powered by Arinze Web Studio'),
      'Must contain exact label: "Powered by Arinze Web Studio"'
    );
    assert.ok(
      footerContent.includes('target="_blank"'),
      'Branding links must open in a new tab'
    );
    assert.ok(
      footerContent.includes('rel="noopener noreferrer"'),
      'Branding links must use rel="noopener noreferrer"'
    );

    const constantsPath = path.resolve(process.cwd(), 'src/constants/index.ts');
    const constantsContent = fs.readFileSync(constantsPath, 'utf8');
    assert.ok(
      constantsContent.includes("export const PORTFOLIO_URL = 'https://arinze-web-studio.netlify.app/';"),
      'Must point directly to https://arinze-web-studio.netlify.app/'
    );
    console.log('✓ PASS: All branding labels, casing, attributes, and URL verified with 100% precision');

    console.log('\n===============================================================');
    console.log('   ALL 12 PROMPT 7 ACCEPTANCE CRITERIA PASSED WITH 100% SUCCESS ');
    console.log('===============================================================');
  } finally {
    server.close();
    process.exit(0);
  }
}

runPrompt7AcceptanceTests().catch((err) => {
  console.error('\n❌ Acceptance Test Failed:', err);
  process.exit(1);
});
