import assert from 'node:assert';
import crypto from 'node:crypto';
import { db } from '../server/db.js';
import { createSession } from '../server/auth.js';

console.log('===============================================================');
console.log('   STEP 3: LIVE API ENDPOINTS & HTTP ISOLATION TESTS');
console.log('===============================================================');

async function runApiTests() {
  const baseUrl = 'http://localhost:3000/api/v1';

  // Obtain auth sessions for School A Bursar and School B Owner
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

  // 1. GET Dashboard Stats for School A
  console.log('\n[API TEST 1] GET /api/v1/school/finance/dashboard...');
  const statsRes = await fetch(`${baseUrl}/school/finance/dashboard`, { headers: headersA });
  assert.strictEqual(statsRes.status, 200, 'Dashboard endpoint should return HTTP 200');
  const statsData = await statsRes.json();
  assert.ok(statsData.success, 'Stats must be successful');
  assert.ok(typeof statsData.stats.totalInvoicedKobo === 'number');
  assert.ok(typeof statsData.stats.totalCollectedKobo === 'number');
  console.log(`✓ PASS: Dashboard returned Total Invoiced: ₦${statsData.stats.totalInvoicedNaira.toLocaleString()}`);

  // 2. GET Invoices for School A
  console.log('\n[API TEST 2] GET /api/v1/school/invoices (Tenant Filtered)...');
  const invRes = await fetch(`${baseUrl}/school/invoices`, { headers: headersA });
  assert.strictEqual(invRes.status, 200);
  const invData = await invRes.json();
  assert.ok(invData.success);
  assert.ok(invData.invoices.length > 0, 'School A must have invoices');
  // Verify all returned invoices belong strictly to School A
  for (const inv of invData.invoices) {
    assert.strictEqual(inv.school_id, schoolAId, 'Every returned invoice MUST belong to School A');
  }
  console.log(`✓ PASS: Fetched ${invData.invoices.length} invoices strictly scoped to ${schoolAId}`);

  // 3. POST Create New Invoice for Student in School A
  console.log('\n[API TEST 3] POST /api/v1/school/invoices (Deterministic Server Calculations)...');
  const newInvPayload = {
    student_id: 'stu_a1_01',
    due_date: '2026-11-30',
    notes: 'Test API Generated Invoice',
    items: [
      { description: 'Term 2 Tuition', quantity: 1, unit_amount: 100000 }, // ₦100,000 = 10,000,000 kobo
      { description: 'Exams & Assessment', quantity: 1, unit_amount: 15000 }, // ₦15,000 = 1,500,000 kobo
    ],
  };
  const createInvRes = await fetch(`${baseUrl}/school/invoices`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify(newInvPayload),
  });
  assert.strictEqual(createInvRes.status, 201, 'Invoice creation must return HTTP 201');
  const createInvData = await createInvRes.json();
  const createdInvId = createInvData.invoice.id;
  assert.strictEqual(createInvData.invoice.subtotal, 11500000, 'Subtotal must be 11,500,000 kobo (₦115,000)');
  assert.strictEqual(createInvData.invoice.total, 11500000, 'Total must equal subtotal with 0 discount');
  assert.strictEqual(createInvData.invoice.balance, 11500000, 'Balance must equal total initially');
  assert.strictEqual(createInvData.invoice.status, 'ISSUED');
  console.log(`✓ PASS: Created invoice ${createInvData.invoice.invoice_number} with Total: ₦${createInvData.invoice.total_naira}`);

  // 4. POST Apply Scholarship / Discount
  console.log('\n[API TEST 4] POST /api/v1/school/invoices/:id/discounts...');
  const discountPayload = {
    type: 'SCHOLARSHIP',
    amount: 15000, // ₦15,000 = 1,500,000 kobo
    reason: 'Inter-School Mathematics Olympiad Winner',
  };
  const discRes = await fetch(`${baseUrl}/school/invoices/${createdInvId}/discounts`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify(discountPayload),
  });
  assert.strictEqual(discRes.status, 201);
  const discData = await discRes.json();
  assert.strictEqual(discData.invoice.discount, 1500000, 'Discount must be 1,500,000 kobo');
  assert.strictEqual(discData.invoice.total, 10000000, 'Total must reduce to 10,000,000 kobo (₦100,000)');
  assert.strictEqual(discData.invoice.balance, 10000000, 'Balance must reduce to 10,000,000 kobo');
  console.log(`✓ PASS: Applied scholarship discount. New Total: ₦${discData.invoice.total_naira}, Balance: ₦${discData.invoice.balance_naira}`);

  // 5. POST Record Partial Payment
  console.log('\n[API TEST 5] POST /api/v1/school/invoices/:id/payments (Partial Payment)...');
  const partialPayPayload = {
    amount: 40000, // ₦40,000 = 4,000,000 kobo
    payment_method: 'BANK_TRANSFER',
    notes: 'Partial payment installment 1',
  };
  const pay1Res = await fetch(`${baseUrl}/school/invoices/${createdInvId}/payments`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify(partialPayPayload),
  });
  assert.strictEqual(pay1Res.status, 201);
  const pay1Data = await pay1Res.json();
  assert.strictEqual(pay1Data.invoice.amount_paid, 4000000, 'Amount paid must be 4,000,000 kobo');
  assert.strictEqual(pay1Data.invoice.balance, 6000000, 'Remaining balance must be 6,000,000 kobo (₦60,000)');
  assert.strictEqual(pay1Data.invoice.status, 'PARTIALLY_PAID', 'Status must transition to PARTIALLY_PAID');
  console.log(`✓ PASS: Partial payment processed. Balance: ₦${pay1Data.invoice.balance_naira}, Status: ${pay1Data.invoice.status}`);

  // 6. Prevent Overpayment Test
  console.log('\n[API TEST 6] Preventing Overpayment Beyond Outstanding Balance...');
  const overpayPayload = {
    amount: 999999, // Exceeds ₦60,000 balance
    payment_method: 'CASH',
  };
  const overpayRes = await fetch(`${baseUrl}/school/invoices/${createdInvId}/payments`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify(overpayPayload),
  });
  assert.strictEqual(overpayRes.status, 400, 'Overpayment must be rejected with HTTP 400');
  console.log('✓ PASS: Overpayment successfully rejected by server guard.');

  // 7. Complete Remaining Payment -> Status becomes PAID
  console.log('\n[API TEST 7] Completing Remaining Payment (Balance reaches 0 -> PAID)...');
  const finalPayPayload = {
    amount: 60000, // ₦60,000 settles remaining balance
    payment_method: 'POS',
    notes: 'Final installment payment',
  };
  const pay2Res = await fetch(`${baseUrl}/school/invoices/${createdInvId}/payments`, {
    method: 'POST',
    headers: headersA,
    body: JSON.stringify(finalPayPayload),
  });
  assert.strictEqual(pay2Res.status, 201);
  const pay2Data = await pay2Res.json();
  assert.strictEqual(pay2Data.invoice.amount_paid, 10000000, 'Total paid must equal 10,000,000 kobo (₦100,000)');
  assert.strictEqual(pay2Data.invoice.balance, 0, 'Balance must reach exactly 0');
  assert.strictEqual(pay2Data.invoice.status, 'PAID', 'Status must transition automatically to PAID');
  console.log(`✓ PASS: Final payment processed. Balance: ₦0.00, Status: ${pay2Data.invoice.status}`);

  // 8. STRICT HTTP CROSS-TENANT ISOLATION (ZERO-TRUST SECURITY)
  console.log('\n[API TEST 8] Cross-Tenant HTTP Attack Simulation (School B trying to access School A Invoice)...');
  // School B user using tokenB trying to access School A's newly created invoice
  const crossTenantRes = await fetch(`${baseUrl}/school/invoices/${createdInvId}`, {
    headers: headersB,
  });
  assert.strictEqual(crossTenantRes.status, 404, 'Cross-tenant lookup MUST return 404 Not Found');
  console.log('✓ PASS: Cross-tenant invoice lookup blocked. School B cannot access School A invoice.');

  // School B trying to pay School A invoice
  const crossTenantPay = await fetch(`${baseUrl}/school/invoices/${createdInvId}/payments`, {
    method: 'POST',
    headers: headersB,
    body: JSON.stringify({ amount: 1000, payment_method: 'CASH' }),
  });
  assert.strictEqual(crossTenantPay.status, 404, 'Cross-tenant payment MUST return 404 Not Found');
  console.log('✓ PASS: Cross-tenant payment manipulation rejected.');

  // 9. CSV Export for Authorized Users
  console.log('\n[API TEST 9] GET /api/v1/school/finance/reports/export-csv...');
  const csvRes = await fetch(`${baseUrl}/school/finance/reports/export-csv?type=invoices`, {
    headers: headersA,
  });
  assert.strictEqual(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.ok(csvText.includes('Invoice Number,Admission Number,Student Name'), 'CSV must contain required headers');
  console.log('✓ PASS: CSV export generated successfully.');

  console.log('\n===============================================================');
  console.log('   ALL STEP 3 LIVE API & SECURITY TESTS PASSED (100%)!');
  console.log('===============================================================\n');
}

runApiTests().catch((err) => {
  console.error('API Test Error:', err);
  process.exit(1);
});
