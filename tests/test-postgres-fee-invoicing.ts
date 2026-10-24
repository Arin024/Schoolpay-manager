/**
 * BURSARIQ - POSTGRESQL FEE STRUCTURES, BULK INVOICING & DEBTORS TEST SUITE
 *
 * Verifies:
 * 1. Fee categories creation and tenant uniqueness.
 * 2. Fee structure creation with multiple line items and kobo totals.
 * 3. Class-scoped bulk invoice generation across active students in an ACID transaction.
 * 4. Idempotent bulk retry (skips already invoiced students with 0 duplicate invoices).
 * 5. Debtor roster aggregation (verifies sum of invoices, payments, and balances).
 * 6. Partial payment balance reduction reflected in debtor report.
 * 7. Payment reversal restoring debtor balance.
 * 8. Strict cross-tenant IDOR protection across fee structures and invoices.
 */

import assert from 'node:assert';
import dotenv from 'dotenv';
import path from 'node:path';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test.local') });
dotenv.config();

import {
  createFeeCategoryPg,
  createFeeStructurePg,
  generateBulkInvoicesPg,
  getDebtorRosterPg,
} from '../server/postgresFeeInvoicingService.ts';
import { recordPaymentPg, reversePaymentPg } from '../server/postgresFinancialService.ts';

console.log('===============================================================');
console.log('   BURSARIQ: POSTGRESQL FEE & INVOICING INTEGRATION SUITE      ');
console.log('===============================================================');

async function runFeeInvoicingTests() {
  const testDbUrl = process.env.TEST_POSTGRES_URL;
  if (!testDbUrl || testDbUrl.trim() === '') {
    console.log('\n[SAFEGUARD NOTICE] TEST_POSTGRES_URL is not set.');
    console.log('Skipping isolated fee invoicing tests (0 records touched, 100% safe).\n');
    process.exit(0);
  }

  const pool = new pg.Pool({
    connectionString: testDbUrl,
    ssl: testDbUrl.includes('localhost') ? false : { rejectUnauthorized: true },
    max: 5,
  });

  const client = await pool.connect();
  const testSuffix = Date.now().toString().slice(-6);
  const schoolAId = `sch_fee_a_${testSuffix}`;
  const schoolBId = `sch_fee_b_${testSuffix}`;
  const classAId = `cls_fee_${testSuffix}`;
  const student1Id = `stu_fee_1_${testSuffix}`;
  const student2Id = `stu_fee_2_${testSuffix}`;
  const bursarUserId = `usr_fee_${testSuffix}`;

  try {
    // 1. Fixture setup
    await client.query(
      `INSERT INTO schools (id, name, slug, type, state, lga, phone, email)
       VALUES ($1, $2, $3, 'SECONDARY', 'Lagos', 'Ikeja', '+2348000000000', $4) ON CONFLICT DO NOTHING`,
      [schoolAId, `Fee Academy ${testSuffix}`, `FAC${testSuffix.slice(-3)}`, `fee${testSuffix}@school.ng`]
    );

    await client.query(
      `INSERT INTO schools (id, name, slug, type, state, lga, phone, email)
       VALUES ($1, $2, $3, 'SECONDARY', 'Oyo', 'Ibadan', '+2348000000001', $4) ON CONFLICT DO NOTHING`,
      [schoolBId, `Foreign School ${testSuffix}`, `FOR${testSuffix.slice(-3)}`, `foreign${testSuffix}@school.ng`]
    );

    const sesId = `ses_fee_${testSuffix}`;
    const termId = `trm_fee_${testSuffix}`;
    await client.query(
      `INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, is_current, status)
       VALUES ($1, $2, '2026/2027', '2026-09-01', '2027-07-31', 1, 'ACTIVE')`,
      [sesId, schoolAId]
    );
    await client.query(
      `INSERT INTO terms (id, school_id, academic_session_id, name, start_date, end_date, is_current, status)
       VALUES ($1, $2, $3, 'First Term', '2026-09-01', '2026-12-15', 1, 'ACTIVE')`,
      [termId, schoolAId, sesId]
    );
    await client.query(
      `INSERT INTO classes (id, school_id, name, level, level_order)
       VALUES ($1, $2, 'SSS 1', 'SENIOR_SECONDARY', 1)`,
      [classAId, schoolAId]
    );

    await client.query(
      `INSERT INTO students (id, school_id, admission_number, first_name, last_name, gender, class_id, student_status)
       VALUES ($1, $2, $3, 'Tunde', 'Adeyemi', 'MALE', $4, 'ACTIVE'),
              ($5, $2, $6, 'Khadijah', 'Bello', 'FEMALE', $4, 'ACTIVE')`,
      [student1Id, schoolAId, `ADM-F1-${testSuffix}`, classAId, student2Id, `ADM-F2-${testSuffix}`]
    );

    // -------------------------------------------------------------------------
    // TEST 1: Fee Category Creation
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Testing Fee Category Creation...');
    const catRes = await createFeeCategoryPg(schoolAId, { name: 'Tuition Fees', description: 'Academic Tuition' }, client);
    assert.strictEqual(catRes.success, true);
    const catId = catRes.data!.category.id;

    const dupCat = await createFeeCategoryPg(schoolAId, { name: 'Tuition Fees' }, client);
    assert.strictEqual(dupCat.success, false);
    assert.strictEqual(dupCat.code, 'DUPLICATE_CATEGORY');
    console.log('✓ PASS: Fee category created and duplicate name rejected within school');

    // -------------------------------------------------------------------------
    // TEST 2: Fee Structure Creation with Line Items
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing Fee Structure Creation with Line Items...');
    const catSportsRes = await createFeeCategoryPg(schoolAId, { name: 'Sports & Medical' }, client);
    const catSportsId = catSportsRes.data!.category.id;

    const structRes = await createFeeStructurePg(
      schoolAId,
      {
        name: 'SSS 1 First Term 2026/2027',
        classId: classAId,
        academicSessionId: sesId,
        termId: termId,
        items: [
          { feeCategoryId: catId, name: 'Tuition Fee', amountKobo: 12000000, isCompulsory: true },
          { feeCategoryId: catSportsId, name: 'Sports & Medical', amountKobo: 1500000, isCompulsory: true },
        ],
      },
      client
    );
    assert.strictEqual(structRes.success, true);
    const feeStructureId = structRes.data!.feeStructure.id;
    const itemsSum = structRes.data!.items.reduce((s: number, it: any) => s + Number(it.amount), 0);
    assert.strictEqual(itemsSum, 13500000);
    assert.strictEqual(structRes.data!.items.length, 2);
    console.log('✓ PASS: Fee structure created with 2 items totaling ₦135,000');

    // -------------------------------------------------------------------------
    // TEST 3: Bulk Invoice Generation across Class
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing Bulk Invoice Generation...');
    const bulkRes = await generateBulkInvoicesPg(
      schoolAId,
      {
        feeStructureId,
        classId: classAId,
        dueDate: '2026-11-30',
        createdByUserId: bursarUserId,
      },
      client
    );

    assert.strictEqual(bulkRes.success, true);
    assert.strictEqual(bulkRes.data!.totalTargetStudents, 2);
    assert.strictEqual(bulkRes.data!.invoicesGenerated, 2);
    assert.strictEqual(bulkRes.data!.skippedDuplicates, 0);
    assert.strictEqual(bulkRes.data!.totalInvoicedKobo, 27000000); // ₦270,000 total
    console.log('✓ PASS: Bulk invoicing generated 2 invoices atomically totaling ₦270,000');

    // -------------------------------------------------------------------------
    // TEST 4: Idempotent Bulk Generation Retry (Zero Duplicates)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing Idempotent Bulk Re-run...');
    const retryRes = await generateBulkInvoicesPg(
      schoolAId,
      {
        feeStructureId,
        classId: classAId,
        dueDate: '2026-11-30',
        createdByUserId: bursarUserId,
      },
      client
    );

    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(retryRes.data!.invoicesGenerated, 0);
    assert.strictEqual(retryRes.data!.skippedDuplicates, 2);
    console.log('✓ PASS: Re-running bulk invoicing generated 0 duplicates (2 skipped safely)');

    // -------------------------------------------------------------------------
    // TEST 5: Debtor Roster Initial Outstanding Aggregation
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Verifying Debtor Roster Aggregation...');
    const rosterRes = await getDebtorRosterPg(schoolAId, undefined, client);
    assert.strictEqual(rosterRes.success, true);
    assert.strictEqual(rosterRes.data!.debtors.length, 2);
    assert.strictEqual(rosterRes.data!.totalOutstandingKobo, 27000000);
    console.log('✓ PASS: Debtor report correctly reports 2 debtors with ₦270,000 outstanding');

    // -------------------------------------------------------------------------
    // TEST 6: Payment Recording & Debtor Balance Reduction
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing Payment Balance Reduction in Debtor Roster...');
    const student1Invoice = bulkRes.data!.invoices.find((i: any) => i.student_id === student1Id);
    const payRes = await recordPaymentPg(
      {
        schoolId: schoolAId,
        invoiceId: student1Invoice.id,
        amountKobo: 5000000, // ₦50,000 partial payment
        paymentMethod: 'BANK_TRANSFER',
        paymentReference: `PAY-FEE-PART-${testSuffix}`,
        receivedByUserId: bursarUserId,
      },
      client
    );
    assert.strictEqual(payRes.success, true);

    const rosterPostPay = await getDebtorRosterPg(schoolAId, undefined, client);
    assert.strictEqual(rosterPostPay.data!.totalOutstandingKobo, 22000000); // ₦270k - ₦50k = ₦220k
    const s1Debtor = rosterPostPay.data!.debtors.find((d) => d.studentId === student1Id);
    assert.strictEqual(s1Debtor!.outstandingBalanceKobo, 8500000); // ₦135k - ₦50k = ₦85k
    console.log('✓ PASS: Debtor roster balance reduced to ₦220,000 after ₦50,000 partial payment');

    // -------------------------------------------------------------------------
    // TEST 7: Payment Reversal Restoring Debtor Balance
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing Payment Reversal Restoring Debtor Balance...');
    const revRes = await reversePaymentPg(
      {
        schoolId: schoolAId,
        paymentId: payRes.data!.payment.id,
        reason: 'Duplicate teller submission error',
        reversedByUserId: bursarUserId,
        reversedByUserEmail: `bursar${testSuffix}@school.ng`,
      },
      client
    );
    assert.strictEqual(revRes.success, true);

    const rosterPostRev = await getDebtorRosterPg(schoolAId, undefined, client);
    assert.strictEqual(rosterPostRev.data!.totalOutstandingKobo, 27000000); // Restored to ₦270,000
    console.log('✓ PASS: Payment reversal restored debtor roster back to original ₦270,000');

    // -------------------------------------------------------------------------
    // TEST 8: Cross-Tenant Authorization Defense (IDOR)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Testing Cross-Tenant Authorization Defense...');
    // School B attempts to invoice School A's class
    const crossInv = await generateBulkInvoicesPg(
      schoolBId,
      {
        feeStructureId,
        classId: classAId,
        dueDate: '2026-11-30',
        createdByUserId: bursarUserId,
      },
      client
    );
    assert.strictEqual(crossInv.success, false);
    assert.strictEqual(crossInv.code, 'STRUCTURE_NOT_FOUND');

    // School B attempts to read School A's debtor roster
    const crossDebtor = await getDebtorRosterPg(schoolBId, undefined, client);
    assert.strictEqual(crossDebtor.data!.debtors.length, 0);
    assert.strictEqual(crossDebtor.data!.totalOutstandingKobo, 0);
    console.log('✓ PASS: Cross-tenant operations strictly blocked (0 records leaked)');

    // Clean up isolated test fixtures
    await client.query('DELETE FROM receipts WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM payment_reversals WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM payments WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM invoice_items WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM invoices WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM fee_structure_items WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM fee_structures WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM fee_categories WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM students WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM classes WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM terms WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM academic_sessions WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM schools WHERE id IN ($1, $2)', [schoolAId, schoolBId]);

    console.log('\n===============================================================');
    console.log('   ALL POSTGRESQL FEE & INVOICING TESTS PASSED (100% SUCCESS)  ');
    console.log('===============================================================');
  } finally {
    client.release();
    await pool.end();
  }
}

runFeeInvoicingTests().catch((err) => {
  console.error('[FEE INVOICING TEST ERROR]', err);
  process.exit(1);
});
