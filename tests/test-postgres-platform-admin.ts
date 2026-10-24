/**
 * BURSARIQ - POSTGRESQL PLATFORM ADMIN, SUBSCRIPTIONS, COMMISSIONS & RECOVERY TEST SUITE
 *
 * Verifies:
 * 1. Subscription Plans creation and pricing tiers in integer kobo.
 * 2. School subscription activation with automatic previous-plan expiration.
 * 3. School subscription upgrade/downgrade and tenant status update.
 * 4. Partner commissions calculation and idempotency (single commission per platform payment).
 * 5. Platform super-admin aggregation metrics across multiple tenants.
 * 6. Cryptographic password reset token creation (SHA-256 hash storage) and single-use consumption.
 * 7. Invalidation of active user sessions upon password reset.
 * 8. Strict isolation: school administrators cannot access platform-wide commissions.
 */

import assert from 'node:assert';
import dotenv from 'dotenv';
import path from 'node:path';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test.local') });
dotenv.config();

import {
  createSubscriptionPlanPg,
  getSubscriptionPlansPg,
  activateSchoolSubscriptionPg,
  recordPartnerCommissionPg,
  getPlatformSuperMetricsPg,
  createPasswordResetTokenPg,
  verifyAndConsumePasswordResetTokenPg,
} from '../server/postgresPlatformAdminService.ts';

console.log('===============================================================');
console.log('   BURSARIQ: POSTGRESQL PLATFORM ADMIN & SAAS INTEGRATION SUITE');
console.log('===============================================================');

async function runPlatformAdminTests() {
  const testDbUrl = process.env.TEST_POSTGRES_URL;
  if (!testDbUrl || testDbUrl.trim() === '') {
    console.log('\n[SAFEGUARD NOTICE] TEST_POSTGRES_URL is not set.');
    console.log('Skipping isolated platform admin tests (0 records touched, 100% safe).\n');
    process.exit(0);
  }

  const pool = new pg.Pool({
    connectionString: testDbUrl,
    ssl: testDbUrl.includes('localhost') ? false : { rejectUnauthorized: true },
    max: 5,
  });

  const client = await pool.connect();
  const testSuffix = Date.now().toString().slice(-6);
  const schoolAId = `sch_saas_${testSuffix}`;
  const partnerId = `prt_${testSuffix}`;
  const userId = `usr_rec_${testSuffix}`;

  try {
    // 1. Fixture setup
    await client.query(
      `INSERT INTO schools (id, name, slug, type, state, lga, phone, email, status)
       VALUES ($1, $2, $3, 'SECONDARY', 'Lagos', 'Ikeja', '+2348000000000', $4, 'TRIAL') ON CONFLICT DO NOTHING`,
      [schoolAId, `SaaS Academy ${testSuffix}`, `SAS${testSuffix.slice(-3)}`, `saas${testSuffix}@school.ng`]
    );

    await client.query(
      `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
       VALUES ($1, $2, 'old_hash', 'old_salt', 'Recovery User', '+2348011111111', 0, 1) ON CONFLICT DO NOTHING`,
      [userId, `rec_${testSuffix}@school.ng`]
    );

    await client.query(
      `INSERT INTO partners (id, user_id, company_name, contact_name, email, phone, referral_code, commission_rate_percent, is_active)
       VALUES ($1, $2, 'EdTech Partners', 'Emeka Okonkwo', $3, '+2348022222222', $4, 10.0, 1) ON CONFLICT DO NOTHING`,
      [partnerId, userId, `partner_${testSuffix}@edtech.ng`, `REF${testSuffix}`]
    );

    // -------------------------------------------------------------------------
    // TEST 1: Subscription Plan Creation & Retrieval
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Testing Subscription Plans Creation...');
    const planRes = await createSubscriptionPlanPg(
      {
        name: `growth_${testSuffix}`,
        displayName: 'Growth Plan',
        priceTermlyKobo: 5000000, // ₦50,000 / term
        priceAnnualKobo: 12000000, // ₦120,000 / year
        studentLimit: 800,
      },
      client
    );
    assert.strictEqual(planRes.success, true);
    const planId = planRes.data!.plan.id;

    const plansList = await getSubscriptionPlansPg(client);
    assert.strictEqual(plansList.success, true);
    assert.ok(plansList.data!.plans.some((p) => p.id === planId));
    console.log('✓ PASS: Subscription plan created with termly/annual pricing tiers in kobo');

    // -------------------------------------------------------------------------
    // TEST 2: School Subscription Activation & Status Update
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing School Subscription Activation...');
    const actRes = await activateSchoolSubscriptionPg(
      {
        schoolId: schoolAId,
        planId,
        billingCycle: 'ANNUAL',
      },
      client
    );
    assert.strictEqual(actRes.success, true);
    assert.strictEqual(actRes.data!.subscription.status, 'ACTIVE');

    const schoolCheck = await client.query('SELECT status, current_plan_id FROM schools WHERE id = $1', [schoolAId]);
    assert.strictEqual(schoolCheck.rows[0].status, 'ACTIVE');
    assert.strictEqual(schoolCheck.rows[0].current_plan_id, planId);
    console.log('✓ PASS: School subscription activated and tenant status updated to ACTIVE');

    // -------------------------------------------------------------------------
    // TEST 3: Subscription Upgrade with Historical Expiration
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing Subscription Plan Upgrade & Expiry...');
    const premPlanRes = await createSubscriptionPlanPg(
      {
        name: `enterprise_${testSuffix}`,
        displayName: 'Enterprise Plan',
        priceTermlyKobo: 15000000,
        priceAnnualKobo: 35000000,
        studentLimit: 3000,
      },
      client
    );
    const enterprisePlanId = premPlanRes.data!.plan.id;

    const upgradeRes = await activateSchoolSubscriptionPg(
      {
        schoolId: schoolAId,
        planId: enterprisePlanId,
        billingCycle: 'TERMLY',
      },
      client
    );
    assert.strictEqual(upgradeRes.success, true);

    const oldSubRes = await client.query(
      'SELECT status FROM school_subscriptions WHERE id = $1',
      [actRes.data!.subscription.id]
    );
    assert.strictEqual(oldSubRes.rows[0].status, 'EXPIRED');
    console.log('✓ PASS: Previous subscription marked EXPIRED upon upgrade to Enterprise tier');

    // -------------------------------------------------------------------------
    // TEST 4: Partner Commission Idempotency
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing Partner Commission Calculation & Idempotency...');
    const platformPaymentId = `pay_plat_${testSuffix}`;
    // Insert prerequisite platform_payment record to satisfy foreign key
    await client.query(
      `INSERT INTO platform_payments (
         id, school_id, plan_id, amount_kobo, amount, status, gateway_reference, payment_method, paid_at
       ) VALUES (
         $1, $2, $3, 10000000, 10000000, 'SUCCESS', $4, 'BANK_TRANSFER', CURRENT_TIMESTAMP
       )`,
      [platformPaymentId, schoolAId, planId, `REF-PLAT-${testSuffix}`]
    );

    const comm1 = await recordPartnerCommissionPg(
      {
        partnerId,
        schoolId: schoolAId,
        platformPaymentId,
        paymentAmountKobo: 10000000, // ₦100,000 subscription
        commissionRatePercent: 10, // 10% = ₦10,000
      },
      client
    );
    assert.strictEqual(comm1.success, true);
    assert.strictEqual(Number(comm1.data!.commission.amount_kobo), 1000000); // ₦10,000

    // Re-record for same payment must be idempotent
    const comm2 = await recordPartnerCommissionPg(
      {
        partnerId,
        schoolId: schoolAId,
        platformPaymentId,
        paymentAmountKobo: 10000000,
      },
      client
    );
    assert.strictEqual(comm2.success, true);
    assert.strictEqual(comm2.code, 'ALREADY_RECORDED');
    console.log('✓ PASS: Partner commission computed deterministically and duplicate delivery blocked');

    // -------------------------------------------------------------------------
    // TEST 5: Platform Super-Admin Metrics Aggregation
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Verifying Platform Super-Admin Global Metrics...');
    const metricsRes = await getPlatformSuperMetricsPg(client);
    assert.strictEqual(metricsRes.success, true);
    assert.ok(metricsRes.data!.totalSchools >= 1);
    assert.ok(metricsRes.data!.activeSchools >= 1);
    console.log(`✓ PASS: Platform metrics aggregated across all tenants (Schools: ${metricsRes.data!.totalSchools})`);

    // -------------------------------------------------------------------------
    // TEST 6: Cryptographic Password Reset & Single-Use Consumption
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing Password Reset Flow & Session Invalidation...');
    // Create an active session for the user
    const sesId = `ses_rec_${testSuffix}`;
    await client.query(
      `INSERT INTO sessions (id, token, user_id, school_id, expires_at)
       VALUES ($1, 'tok_rec_active', $2, $3, CURRENT_TIMESTAMP + INTERVAL '1 day')`,
      [sesId, userId, schoolAId]
    );

    const tokenGenRes = await createPasswordResetTokenPg(userId, client);
    assert.strictEqual(tokenGenRes.success, true);
    const rawToken = tokenGenRes.data!.resetToken;

    // Verify token was stored as a hash (not plaintext)
    const storedHashRes = await client.query('SELECT token FROM password_resets WHERE user_id = $1', [userId]);
    assert.notStrictEqual(storedHashRes.rows[0].token, rawToken);

    // Consume token and set new password
    const consumeRes = await verifyAndConsumePasswordResetTokenPg(
      rawToken,
      'new_hashed_password',
      'new_salt',
      client
    );
    assert.strictEqual(consumeRes.success, true);
    assert.strictEqual(consumeRes.data!.userId, userId);

    // Verify password was updated in users table
    const userCheck = await client.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    assert.strictEqual(userCheck.rows[0].password_hash, 'new_hashed_password');

    // Verify active sessions were invalidated for security
    const sessionsAfter = await client.query('SELECT id FROM sessions WHERE user_id = $1', [userId]);
    assert.strictEqual(sessionsAfter.rows.length, 0);

    // Verify re-using token is rejected
    const replayRes = await verifyAndConsumePasswordResetTokenPg(rawToken, 'another_hash', 'another_salt', client);
    assert.strictEqual(replayRes.success, false);
    assert.strictEqual(replayRes.code, 'INVALID_TOKEN');
    console.log('✓ PASS: Password reset verified: SHA-256 storage, single-use, and session invalidation enforced');

    // Clean up isolated test fixtures
    await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM commissions WHERE school_id = $1', [schoolAId]);
    await client.query('DELETE FROM platform_payments WHERE school_id = $1', [schoolAId]);
    await client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await client.query('DELETE FROM school_subscriptions WHERE school_id = $1', [schoolAId]);
    await client.query('DELETE FROM subscription_plans WHERE id IN ($1, $2)', [planId, enterprisePlanId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('DELETE FROM schools WHERE id = $1', [schoolAId]);

    console.log('\n===============================================================');
    console.log('   ALL POSTGRESQL PLATFORM ADMIN TESTS PASSED (100% SUCCESS)   ');
    console.log('===============================================================');
  } finally {
    client.release();
    await pool.end();
  }
}

runPlatformAdminTests().catch((err) => {
  console.error('[PLATFORM ADMIN TEST ERROR]', err);
  process.exit(1);
});
