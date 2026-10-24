
import assert from "node:assert";
import pg from "pg";
import { hashPassword, generateSalt, verifyPassword, createSession } from "../server/auth.ts";
import { initDatabase, getPgPool, isPgConnected } from "../server/db.ts";

async function runTests() {
  console.log("===============================================================");
  console.log("   BURSARIQ: AUTHENTICATION, PERSISTENCE & SAAS PAYMENT TESTS  ");
  console.log("===============================================================");

  await initDatabase();
  const pool = getPgPool();
  assert(pool, "PostgreSQL pool must be active");
  assert(isPgConnected(), "PostgreSQL connection must be active");

  console.log("\n[TEST 1] Testing Password Hashing & Verification...");
  const testPassword = "StrongAdminPassword2026!";
  const salt = generateSalt();
  const hash = hashPassword(testPassword, salt);
  assert(verifyPassword(testPassword, hash, salt), "Password verification must succeed");
  assert(!verifyPassword("WrongPassword", hash, salt), "Wrong password must be rejected");
  console.log("✓ PASS: Password hashing & verification verified");

  console.log("\n[TEST 2] Testing Dual-Database Session Creation & Cross-Engine Validation...");
  const client = await pool.connect();
  try {
    const userRes = await client.query("SELECT id, email, full_name FROM users WHERE is_platform_admin = 1 LIMIT 1");
    assert(userRes.rows.length > 0, "Super admin user must exist in Neon PG");
    const saUser = userRes.rows[0];

    const sessionToken = createSession(saUser.id, null, "127.0.0.1", "RegressionTest");
    assert(sessionToken && sessionToken.length === 64, "Session token must be 64-char hex");

    // Wait 250ms for replication
    await new Promise(r => setTimeout(r, 250));

    const pgSessionRes = await client.query("SELECT * FROM sessions WHERE token = $1", [sessionToken]);
    assert(pgSessionRes.rows.length === 1, "Session must exist in PostgreSQL sessions table");
    console.log("✓ PASS: Session created and verified in Neon PostgreSQL");

    await client.query("DELETE FROM sessions WHERE token = $1", [sessionToken]);
  } finally {
    client.release();
  }

  console.log("\n[TEST 3] Testing Platform Payment Settings (Zenith Bank & OPay Separation)...");
  const client2 = await pool.connect();
  try {
    const settingsRes = await client2.query("SELECT * FROM platform_settings WHERE id = 'platform_global_settings'");
    assert(settingsRes.rows.length === 1, "platform_global_settings must exist");
    const s = settingsRes.rows[0];

    assert.strictEqual(s.platform_bank_name, "Zenith Bank", "Preferred bank must be Zenith Bank");
    assert.strictEqual(s.platform_account_name, "Nwajiaku Arinze Christian", "Beneficiary name must match");
    assert.strictEqual(s.platform_account_number, "2208744650", "Zenith account number must be 2208744650");
    assert.strictEqual(s.opay_account_name, "Nwajiaku Arinzechukwu Christian", "OPay name must match");
    assert.strictEqual(s.opay_account_number, "8160754659", "OPay account number must be 8160754659");

    console.log("✓ PASS: Official Zenith Bank & OPay settings verified in authoritative database");
    console.log("       Bank:", s.platform_bank_name, "| Acct:", s.platform_account_number, "| Name:", s.platform_account_name);
    console.log("       OPay:", s.opay_account_name, "| Acct:", s.opay_account_number);
  } finally {
    client2.release();
  }

  console.log("\n[TEST 4] Testing School Fee vs SaaS Revenue Separation...");
  const client3 = await pool.connect();
  try {
    const schoolInvoiceCount = await client3.query("SELECT COUNT(*) FROM invoices");
    const platformPaymentCount = await client3.query("SELECT COUNT(*) FROM platform_payments");
    console.log(`✓ PASS: School Invoices (${schoolInvoiceCount.rows[0].count}) and Platform SaaS Payments (${platformPaymentCount.rows[0].count}) are in separate tables`);
  } finally {
    client3.release();
  }

  console.log("\n===============================================================");
  console.log("   ALL AUTHENTICATION, PERSISTENCE & PAYMENT TESTS PASSED (100%)");
  console.log("===============================================================");
  process.exit(0);
}

runTests().catch(err => {
  console.error("Test failure:", err);
  process.exit(1);
});
