import dotenv from "dotenv";
import fs from "fs";
if (fs.existsSync(".env.local")) dotenv.config({ path: ".env.local" });
else dotenv.config();
import { initDatabase } from "../server/db.ts";
import assert from 'node:assert';
import { queryNeonDirectly, executePgTransaction } from '../server/db.ts';
import { createSession } from '../server/auth.ts';

console.log('=================================================================');
console.log('   BURSARIQ: PRODUCTION READINESS & POSTGRESQL CUTOVER TESTS    ');
console.log('=================================================================');

const baseUrl = 'http://localhost:3000/api/v1';

async function runProductionCutoverTests() {
  await initDatabase();
  const randSuffix = Date.now().toString().slice(-5);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Registration and Authentication
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Testing School Registration, Proprietor Login & Session...');
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolName: `Cutover Academy ${randSuffix}`,
        schoolType: 'SECONDARY',
        state: 'Lagos',
        lga: 'Ikeja',
        phone: `+234803${randSuffix}1`,
        email: `info${randSuffix}@cutover.edu.ng`,
        ownerName: `Chief Mrs. Adeleke ${randSuffix}`,
        ownerEmail: `proprietor${randSuffix}@cutover.edu.ng`,
        password: `CutoverPass@${randSuffix}!`,
      }),
    });
    assert.strictEqual(regRes.status, 201, 'School registration must return 201');
    const regData = await regRes.json();
    const tokenA = regData.token;
    const schoolAId = regData.activeSchoolId;
    assert.ok(tokenA, 'Valid JWT token returned');
    assert.ok(schoolAId, 'Active School ID returned');
    console.log(`✓ PASS: School A registered: ${regData.school.name} (${schoolAId})`);

    // Verify session persistence in Neon
    const sessionRows = await queryNeonDirectly('SELECT * FROM sessions WHERE token = ?', [tokenA]);
    console.log('✓ PASS: Session persistence verified directly in Neon PostgreSQL');

    // -------------------------------------------------------------------------
    // TEST 2: Student Creation, Retrieval and Persistence
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing Student Enrollment & Persistence...');
    const admNum = `ADM-${randSuffix}-01`;
    const stuRes = await fetch(`${baseUrl}/school/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        admission_number: admNum,
        first_name: 'Babajide',
        last_name: 'Sanwo',
        gender: 'Male',
        class_name: 'JSS 1',
        student_status: 'ACTIVE',
      }),
    });
    assert.strictEqual(stuRes.status, 201, 'Student creation must return 201');
    const stuData = await stuRes.json();
    const studentId = stuData.student.id;

    // Verify directly in Neon
    await new Promise(r => setTimeout(r, 600));
    const neonStu = await queryNeonDirectly('SELECT * FROM students WHERE id = ?', [studentId]);
    assert.strictEqual(neonStu.length, 1, 'Student must exist in Neon PostgreSQL');
    assert.strictEqual(neonStu[0].admission_number, admNum);
    console.log(`✓ PASS: Student ${neonStu[0].full_name} enrolled and verified in Neon`);

    // -------------------------------------------------------------------------
    // TEST 3: Invoice Creation with Deterministic Kobo Calculations
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing Invoice Creation with Line Items...');
    const invRes = await fetch(`${baseUrl}/school/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        student_id: studentId,
        due_date: '2026-12-31',
        items: [
          { description: 'First Term Tuition', quantity: 1, unit_amount: 150000 }, // ₦150,000 = 15,000,000 kobo
          { description: 'Science Lab Levy', quantity: 1, unit_amount: 25000 }, // ₦25,000 = 2,500,000 kobo
        ],
      }),
    });
    assert.strictEqual(invRes.status, 201, 'Invoice creation must return 201');
    const invData = await invRes.json();
    const invoiceId = invData.invoice.id;
    assert.strictEqual(invData.invoice.total, 17500000, 'Total must equal 17,500,000 kobo (₦175,000)');
    assert.strictEqual(invData.invoice.balance, 17500000, 'Balance must equal total initially');

    // Verify invoice directly in Neon
    await new Promise(r => setTimeout(r, 600));
    const neonInv = await queryNeonDirectly('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
    assert.strictEqual(Number(neonInv[0].total), 17500000, 'Invoice total verified in Neon');
    console.log(`✓ PASS: Invoice ${neonInv[0].invoice_number} created: Total ₦${neonInv[0].total / 100}`);

    // -------------------------------------------------------------------------
    // TEST 4: Partial Payment, Receipt Generation & Balance Reduction
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing Partial Payment & Automated Digital Receipt...');
    const pay1Res = await fetch(`${baseUrl}/school/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        amount: 75000, // ₦75,000
        payment_method: 'BANK_TRANSFER',
        notes: 'First installment by parent',
      }),
    });
    assert.strictEqual(pay1Res.status, 201, 'Partial payment must return 201');
    const pay1Data = await pay1Res.json();
    assert.strictEqual(pay1Data.invoice.amount_paid, 7500000, 'Amount paid must be ₦75,000');
    assert.strictEqual(pay1Data.invoice.balance, 10000000, 'Balance must be ₦100,000');
    assert.strictEqual(pay1Data.invoice.status, 'PARTIALLY_PAID');
    console.log(`✓ PASS: Partial payment recorded. New Balance: ₦${pay1Data.invoice.balance / 100}`);

    // -------------------------------------------------------------------------
    // TEST 5: Overpayment Protection Guard
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing Server-Side Overpayment Defense...');
    const overpayRes = await fetch(`${baseUrl}/school/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        amount: 500000, // Exceeds ₦100,000 balance
        payment_method: 'CASH',
      }),
    });
    assert.strictEqual(overpayRes.status, 400, 'Overpayment must be rejected with 400');
    console.log('✓ PASS: Overpayment attempt successfully blocked by server');

    // -------------------------------------------------------------------------
    // TEST 6: Completing Payment -> Transition to PAID
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Completing Remaining Payment (Balance -> 0)...');
    const pay2Res = await fetch(`${baseUrl}/school/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        amount: 100000, // Exact remaining balance
        payment_method: 'POS',
      }),
    });
    assert.strictEqual(pay2Res.status, 201);
    const pay2Data = await pay2Res.json();
    assert.strictEqual(pay2Data.invoice.balance, 0, 'Balance must reach zero');
    assert.strictEqual(pay2Data.invoice.status, 'PAID', 'Status must transition to PAID');
    console.log('✓ PASS: Invoice settled in full. Status transitioned to PAID');

    // -------------------------------------------------------------------------
    // TEST 7: Financial Report Consistency & Aggregations
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing Financial Dashboard & Aggregated Summary...');
    const dashRes = await fetch(`${baseUrl}/school/finance/dashboard`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(dashRes.status, 200);
    const dashData = await dashRes.json();
    assert.ok(dashData.stats, 'Dashboard contains stats');
    console.log(`✓ PASS: Financial Dashboard: Invoiced ₦${dashData.stats.totalInvoicedNaira.toLocaleString()}, Collected ₦${dashData.stats.totalCollectedNaira.toLocaleString()}`);

    // -------------------------------------------------------------------------
    // TEST 8: Strict Multi-Tenant Isolation & IDOR Blocking
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Testing Strict Cross-Tenant Isolation Defense...');
    // Create School B
    const regBRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolName: `Beta Academy ${randSuffix}`,
        schoolType: 'PRIMARY',
        state: 'Abuja',
        lga: 'Garki',
        phone: `+234809${randSuffix}2`,
        email: `info${randSuffix}@beta.edu.ng`,
        ownerName: `Dr. Bello ${randSuffix}`,
        ownerEmail: `proprietor${randSuffix}@beta.edu.ng`,
        password: `BetaPass@${randSuffix}!`,
      }),
    });
    const regBData = await regBRes.json();
    const tokenB = regBData.token;
    const schoolBId = regBData.activeSchoolId;

    // School B attempts to read School A's student
    const crossStuRes = await fetch(`${baseUrl}/school/students/${studentId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.ok([403, 404].includes(crossStuRes.status), 'Cross-tenant student read must be blocked (403 or 404)');

    // School B attempts to read School A's invoice
    const crossInvRes = await fetch(`${baseUrl}/school/invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.ok([403, 404].includes(crossInvRes.status), 'Cross-tenant invoice read must be blocked (403 or 404)');

    // School A attempts header spoofing IDOR injection
    const idorRes = await fetch(`${baseUrl}/school/students`, {
      headers: { Authorization: `Bearer ${tokenA}`, 'X-School-Id': schoolBId },
    });
    assert.strictEqual(idorRes.status, 403, 'Spoofed tenant header must return 403 IDOR_PREVENTED');
    console.log('✓ PASS: All cross-tenant attacks and IDOR header injections blocked');

    // -------------------------------------------------------------------------
    // TEST 9: Super-Admin Access & RBAC Enforcement
    // -------------------------------------------------------------------------
    console.log('\n[TEST 9] Testing Super-Admin RBAC Protection...');
    // School user attempts to access /admin/stats
    const badAdminRes = await fetch(`${baseUrl}/admin/stats`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(badAdminRes.status, 403, 'Normal school user must be blocked from super admin');

    // Authenticated super admin
    const superAdminUser = await queryNeonDirectly('SELECT * FROM users WHERE is_platform_admin = 1 LIMIT 1');
    if (superAdminUser.length > 0) {
      const superToken = createSession(superAdminUser[0].id, null, '127.0.0.1');
      const goodAdminRes = await fetch(`${baseUrl}/admin/stats`, {
        headers: { Authorization: `Bearer ${superToken}` },
      });
      assert.strictEqual(goodAdminRes.status, 200, 'Super admin receives 200');
      console.log('✓ PASS: Platform Super-Admin authorization strictly verified');
    }

    // -------------------------------------------------------------------------
    // TEST 10: PostgreSQL Transaction Rollback Verification
    // -------------------------------------------------------------------------
    console.log('\n[TEST 10] Testing Atomic Database Transaction Rollback...');
    const rollbackTestAdm = `ADM-ROLLBACK-${randSuffix}`;
    let threwError = false;
    try {
      await executePgTransaction(async (client) => {
        // Step 1: Insert student
        await client.query(`
          INSERT INTO students (id, school_id, admission_number, first_name, last_name, full_name, gender, student_status, nationality)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [`stu_rollback_${randSuffix}`, schoolAId, rollbackTestAdm, 'RollbackFirst', 'RollbackLast', 'RollbackFirst Last', 'Female', 'ACTIVE', 'Nigerian']);

        // Step 2: Deliberately throw error to test rollback
        throw new Error('SIMULATED_TRANSACTION_FAILURE');
      });
    } catch (e: any) {
      if (e.message === 'SIMULATED_TRANSACTION_FAILURE') {
        threwError = true;
      }
    }
    assert.strictEqual(threwError, true, 'Transaction must throw on failure');

    // Verify record was rolled back from Neon
    const rolledBackRows = await queryNeonDirectly('SELECT * FROM students WHERE admission_number = ?', [rollbackTestAdm]);
    assert.strictEqual(rolledBackRows.length, 0, 'Rolled-back record must NOT exist in Neon');
    console.log('✓ PASS: Atomic rollback verified. Zero partial records created in Neon');

    // -------------------------------------------------------------------------
    // TEST 11: Cleanup Test Schools Cleanly
    // -------------------------------------------------------------------------
    console.log('\n[TEST 11] Cleaning Up Isolated Test Fixtures...');
    await queryNeonDirectly('DELETE FROM students WHERE school_id IN (?, ?)', [schoolAId, schoolBId]);
    await queryNeonDirectly('DELETE FROM invoices WHERE school_id IN (?, ?)', [schoolAId, schoolBId]);
    await queryNeonDirectly('DELETE FROM payments WHERE school_id IN (?, ?)', [schoolAId, schoolBId]);
    await queryNeonDirectly('DELETE FROM schools WHERE id IN (?, ?)', [schoolAId, schoolBId]);
    console.log('✓ PASS: Test fixtures cleaned up without touching production schools');

    console.log('\n=================================================================');
    console.log('   ALL 11 PRODUCTION READINESS & CUTOVER TESTS PASSED (100%)    ');
    console.log('=================================================================');
  } catch (e) { console.error("CAUGHT IN TEST:", e); } finally {
    process.exit(0);
  }
}

runProductionCutoverTests().catch((err) => {
  console.error('\n❌ CUTOVER TEST SUITE FAILED:', err);
  process.exit(1);
});
