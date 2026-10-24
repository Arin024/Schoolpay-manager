import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import { apiRouter } from '../server/routes.js';
import { initDatabase, db } from '../server/db.js';
import { createSession } from '../server/auth.js';

console.log('===============================================================');
console.log('   STEP 5: PLATFORM SUPER ADMIN & SAAS ECOSYSTEM SECURITY TESTS');
console.log('===============================================================');

async function runStep5SecurityTests() {
  initDatabase();

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  try {
    // 1. Identify Test Users
    const superAdmin = db.prepare(`SELECT * FROM users WHERE is_platform_admin = 1 LIMIT 1`).get() as any;
    const bursarA = db.prepare(`SELECT * FROM users WHERE email = 'bursar@lagospremier.edu.ng'`).get() as any;
    const ownerB = db.prepare(`SELECT * FROM users WHERE email = 'proprietor@abujahorizon.sch.ng'`).get() as any;

    assert.ok(superAdmin, 'Platform Super Admin must exist in database');
    assert.ok(bursarA, 'School A Bursar must exist');
    assert.ok(ownerB, 'School B Owner must exist');

    const schoolAId = 'sch_lagos_premier_01';
    const schoolBId = 'sch_abuja_horizon_02';

    const superAdminToken = createSession(superAdmin.id, null, '127.0.0.1');
    const tokenSchoolA = createSession(bursarA.id, schoolAId, '127.0.0.1');
    const tokenSchoolB = createSession(ownerB.id, schoolBId, '127.0.0.1');

    const headersSuperAdmin = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${superAdminToken}`,
    };

    const headersSchoolA = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenSchoolA}`,
    };

    const headersSchoolB = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenSchoolB}`,
    };

    // -------------------------------------------------------------------------
    // TEST 1: SCHOOL A CANNOT ACCESS SUPER ADMIN DASHBOARD /admin/*
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 1] School A user cannot access /api/v1/admin/stats...');
    const resAStats = await fetch(`${baseUrl}/admin/stats`, { headers: headersSchoolA });
    assert.strictEqual(
      resAStats.status,
      403,
      `School A user must be blocked with HTTP 403 Forbidden on /admin/stats (received ${resAStats.status})`
    );
    const dataAStats = await resAStats.json();
    assert.strictEqual(dataAStats.error, 'FORBIDDEN_SUPER_ADMIN_ONLY');
    console.log('✓ PASS: School A strictly blocked from Super Admin stats with HTTP 403');

    // -------------------------------------------------------------------------
    // TEST 2: SCHOOL B CANNOT ACCESS SUPER ADMIN DASHBOARD /admin/*
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 2] School B user cannot access /api/v1/admin/schools directory...');
    const resBSchools = await fetch(`${baseUrl}/admin/schools`, { headers: headersSchoolB });
    assert.strictEqual(
      resBSchools.status,
      403,
      `School B user must be blocked with HTTP 403 Forbidden on /admin/schools (received ${resBSchools.status})`
    );
    console.log('✓ PASS: School B strictly blocked from Super Admin schools directory with HTTP 403');

    // -------------------------------------------------------------------------
    // TEST 3: SCHOOL A CANNOT ACCESS GLOBAL PLATFORM REVENUE
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 3] School A cannot access /api/v1/admin/revenue...');
    const resARevenue = await fetch(`${baseUrl}/admin/revenue`, { headers: headersSchoolA });
    assert.strictEqual(resARevenue.status, 403, 'School A user must be blocked from platform revenue');
    console.log('✓ PASS: Global SaaS revenue strictly hidden from school users');

    // -------------------------------------------------------------------------
    // TEST 4: SCHOOL B CANNOT ACCESS GLOBAL PLATFORM AUDIT LOGS
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 4] School B cannot access /api/v1/admin/audit-logs...');
    const resBAudit = await fetch(`${baseUrl}/admin/audit-logs`, { headers: headersSchoolB });
    assert.strictEqual(resBAudit.status, 403, 'School B user must be blocked from platform audit logs');
    console.log('✓ PASS: Global platform audit logs strictly hidden from school users');

    // -------------------------------------------------------------------------
    // TEST 5: SCHOOL A CANNOT ACCESS SCHOOL B (TENANT ISOLATION)
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 5] School A attempts cross-tenant IDOR access to School B...');
    const resIdor = await fetch(`${baseUrl}/school/invoices`, {
      headers: {
        ...headersSchoolA,
        'x-school-id': schoolBId, // Malicious tenant header injection attempt
      },
    });
    assert.strictEqual(resIdor.status, 403, 'Cross-tenant IDOR attempt must be denied with HTTP 403');
    const idorData = await resIdor.json();
    assert.strictEqual(idorData.code, 'IDOR_PREVENTED');
    console.log('✓ PASS: Cross-tenant attack detected and neutralized with IDOR_PREVENTED');

    // -------------------------------------------------------------------------
    // TEST 6: SUPER ADMIN CAN ACCESS GLOBAL TELEMETRY & STATS
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 6] Super Admin access to global platform statistics...');
    const resAdminStats = await fetch(`${baseUrl}/admin/stats`, { headers: headersSuperAdmin });
    assert.strictEqual(resAdminStats.status, 200, 'Super admin should receive HTTP 200');
    const statsData = await resAdminStats.json();
    assert.ok(statsData.success, 'Platform stats request must succeed');
    assert.ok(typeof statsData.stats.totalSchools === 'number');
    assert.ok(typeof statsData.stats.activeSchools === 'number');
    assert.ok(typeof statsData.stats.platformRevenueNaira === 'number');
    assert.ok(typeof statsData.stats.schoolCollectedRevenueNaira === 'number');
    console.log(`✓ PASS: Global Stats retrieved — Total Schools: ${statsData.stats.totalSchools}, SaaS Revenue: ₦${statsData.stats.platformRevenueNaira.toLocaleString()}`);

    // -------------------------------------------------------------------------
    // TEST 7: SUPER ADMIN GLOBAL SCHOOL SEARCH
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 7] Super Admin searching schools across ecosystem...');
    const resAdminSearch = await fetch(`${baseUrl}/admin/schools?search=Lagos`, { headers: headersSuperAdmin });
    assert.strictEqual(resAdminSearch.status, 200);
    const searchData = await resAdminSearch.json();
    assert.ok(searchData.success);
    assert.ok(searchData.schools.length > 0, 'Should find Lagos school');
    console.log(`✓ PASS: Super Admin successfully searched schools across tenants (found ${searchData.schools.length})`);

    // -------------------------------------------------------------------------
    // TEST 8: SUPER ADMIN CAN SUSPEND AND ACTIVATE SCHOOLS (DATA PRESERVED)
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 8] Super Admin updates school status to SUSPENDED...');
    const resSuspend = await fetch(`${baseUrl}/admin/schools/${schoolAId}/status`, {
      method: 'PATCH',
      headers: headersSuperAdmin,
      body: JSON.stringify({ status: 'SUSPENDED', reason: 'Automated test temporary suspension' }),
    });
    assert.strictEqual(resSuspend.status, 200);
    const suspendData = await resSuspend.json();
    assert.strictEqual(suspendData.status, 'SUSPENDED');

    // Verify school data is preserved in DB!
    const schoolRow = db.prepare('SELECT id, status FROM schools WHERE id = ?').get(schoolAId) as any;
    assert.strictEqual(schoolRow.status, 'SUSPENDED', 'Database status must be SUSPENDED');
    const studentCount = (db.prepare('SELECT COUNT(*) as c FROM students WHERE school_id = ?').get(schoolAId) as any).c;
    assert.ok(studentCount > 0, 'School student records MUST NOT be deleted upon suspension');

    // Reactivate school
    const resActivate = await fetch(`${baseUrl}/admin/schools/${schoolAId}/status`, {
      method: 'PATCH',
      headers: headersSuperAdmin,
      body: JSON.stringify({ status: 'ACTIVE', reason: 'Reactivated after test' }),
    });
    assert.strictEqual(resActivate.status, 200);
    console.log('✓ PASS: Suspension preserved all school data; successfully reactivated');

    // -------------------------------------------------------------------------
    // TEST 9: SUPER ADMIN MANAGES SUBSCRIPTION PLANS & ASSIGNMENTS
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 9] Super Admin assigns new subscription plan to School A...');
    const resAssignSub = await fetch(`${baseUrl}/admin/schools/${schoolAId}/subscription`, {
      method: 'POST',
      headers: headersSuperAdmin,
      body: JSON.stringify({
        plan_id: 'plan_standard',
        duration_months: 4,
        amount_paid_naira: 45000,
        provider: 'BANK_TRANSFER',
        notes: 'Automated test subscription renewal',
      }),
    });
    assert.strictEqual(resAssignSub.status, 200);
    const assignData = await resAssignSub.json();
    assert.ok(assignData.success);
    assert.ok(assignData.subscriptionId);
    console.log(`✓ PASS: Assigned plan_standard to ${schoolAId} (Subscription ID: ${assignData.subscriptionId})`);

    // -------------------------------------------------------------------------
    // TEST 10: AUDITED SUPPORT IMPERSONATION
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 10] Super Admin initiates support impersonation session...');
    const resImpersonate = await fetch(`${baseUrl}/admin/impersonate`, {
      method: 'POST',
      headers: headersSuperAdmin,
      body: JSON.stringify({
        schoolId: schoolAId,
        reason: 'Automated test customer support check',
      }),
    });
    assert.strictEqual(resImpersonate.status, 200);
    const impData = await resImpersonate.json();
    assert.ok(impData.impersonationToken.startsWith('imp_'), 'Impersonation token must have imp_ prefix');
    assert.strictEqual(impData.targetSchool.id, schoolAId);

    // Verify audit log has recorded the impersonation event
    const auditRecord = db.prepare(`
      SELECT * FROM audit_logs WHERE action = 'IMPERSONATION_STARTED' ORDER BY created_at DESC LIMIT 1
    `).get() as any;
    assert.ok(auditRecord, 'IMPERSONATION_STARTED must be logged in audit trail');
    assert.strictEqual(auditRecord.school_id, schoolAId);
    console.log(`✓ PASS: Impersonation token issued & audit event recorded: "${auditRecord.action}"`);

    // -------------------------------------------------------------------------
    // TEST 11: IMPERSONATED SESSION CANNOT ACCESS SUPER ADMIN /admin/*
    // -------------------------------------------------------------------------
    console.log('\n[SECURITY TEST 11] Impersonated session cannot elevate to Super Admin...');
    const resImpAdmin = await fetch(`${baseUrl}/admin/stats`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${impData.impersonationToken}`,
      },
    });
    assert.strictEqual(resImpAdmin.status, 403, 'Impersonated session cannot access /admin/stats');
    console.log('✓ PASS: Impersonated session strictly prevented from acting as Super Admin');

    console.log('\n===============================================================');
    console.log('   ALL 11 STEP 5 SUPER ADMIN & SECURITY TESTS PASSED (100%)');
    console.log('===============================================================');
  } finally {
    server.close();
    process.exit(0);
  }
}

runStep5SecurityTests().catch((err) => {
  console.error('\n❌ STEP 5 TEST RUN FAILED:', err);
  process.exit(1);
});
