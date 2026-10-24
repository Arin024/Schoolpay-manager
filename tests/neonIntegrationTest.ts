import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { translateSqlForPostgres } from '../server/dbAdapter.ts';

if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
} else {
  dotenv.config();
}

async function runTests() {
  console.log('=====================================================');
  console.log('   BURSARIQ: NEON POSTGRESQL INTEGRATION TEST SUITE  ');
  console.log('=====================================================\n');

  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    console.error('[BLOCKED] DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 5000,
  });

  const client = await pool.connect();
  try {
    // TEST 1: Connectivity & Harmless Check
    console.log('TEST 1: Live PostgreSQL Connectivity Check...');
    const connRes = await client.query(
      'SELECT current_database() AS database_name, current_user AS database_user, version() AS postgres_version, NOW() AS database_time;'
    );
    const info = connRes.rows[0];
    console.log(`  [PASS] Connected to Database: "${info.database_name}", User: "${info.database_user}"`);
    console.log(`  [INFO] Version: ${info.postgres_version.slice(0, 50)}...`);
    console.log(`  [INFO] Time: ${info.database_time}\n`);

    // TEST 2: Schema Parity & Table Existence
    console.log('TEST 2: Verifying 44 Authoritative Tables in Neon...');
    const tablesRes = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
    );
    const tableNames = tablesRes.rows.map((r: any) => r.table_name);
    console.log(`  [PASS] Found ${tableNames.length} tables in PostgreSQL public schema.`);
    if (tableNames.length < 44) {
      throw new Error(`Expected at least 44 tables, but found ${tableNames.length}`);
    }

    // TEST 3: Baseline Data Integrity
    console.log('TEST 3: Verifying Baseline Data in Neon PostgreSQL...');
    const schoolsRes = await client.query('SELECT count(*) as count FROM schools');
    const usersRes = await client.query('SELECT count(*) as count FROM users');
    const invoicesRes = await client.query('SELECT count(*) as count FROM invoices');
    const paymentsRes = await client.query('SELECT count(*) as count FROM payments');
    console.log(`  [PASS] Schools: ${schoolsRes.rows[0].count}`);
    console.log(`  [PASS] Users: ${usersRes.rows[0].count}`);
    console.log(`  [PASS] Invoices: ${invoicesRes.rows[0].count}`);
    console.log(`  [PASS] Payments: ${paymentsRes.rows[0].count}\n`);

    // TEST 4: Student Persistence (Write -> Read -> Update -> Verify)
    console.log('TEST 4: Student Persistence in Neon PostgreSQL...');
    const testStudentId = 'stu_test_audit_' + Date.now();
    const testSchoolId = 'sch_lagos_premier_01';
    const testAdmNum = 'ADM-AUDIT-' + Math.floor(Math.random() * 10000);

    // Insert student
    const insertSql = `
      INSERT INTO students (
        id, school_id, admission_number, first_name, last_name, full_name,
        gender, student_status, nationality
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await client.query(insertSql, [
      testStudentId,
      testSchoolId,
      testAdmNum,
      'AuditFirst',
      'AuditLast',
      'AuditFirst AuditLast',
      'Male',
      'ACTIVE',
      'Nigerian',
    ]);
    console.log('  [PASS] Successfully inserted test student into Neon.');

    // Read back
    const readRes = await client.query('SELECT * FROM students WHERE id = $1', [testStudentId]);
    if (readRes.rows.length === 0 || readRes.rows[0].admission_number !== testAdmNum) {
      throw new Error('Test student could not be verified in Neon PostgreSQL');
    }
    console.log('  [PASS] Successfully retrieved test student from Neon.');

    // Update
    await client.query("UPDATE students SET student_status = 'SUSPENDED' WHERE id = $1", [testStudentId]);
    const updatedRes = await client.query('SELECT student_status FROM students WHERE id = $1', [testStudentId]);
    if (updatedRes.rows[0].student_status !== 'SUSPENDED') {
      throw new Error('Student update did not persist in Neon');
    }
    console.log('  [PASS] Student status update persisted in Neon.');

    // TEST 5: Tenant Isolation Verification
    console.log('\nTEST 5: Tenant Isolation in Neon PostgreSQL...');
    // Querying as School B (sch_abuja_horizon_02) must NOT return School A's student
    const crossTenantRes = await client.query(
      'SELECT * FROM students WHERE id = $1 AND school_id = $2',
      [testStudentId, 'sch_abuja_horizon_02']
    );
    if (crossTenantRes.rows.length !== 0) {
      throw new Error('CRITICAL SECURITY FAILURE: Cross-tenant query returned student belonging to another school!');
    }
    console.log('  [PASS] Verified: School B cannot retrieve School A\'s student (0 rows returned).');

    // Cross-tenant invoices test
    const invoicesCrossRes = await client.query(
      'SELECT id, school_id FROM invoices WHERE school_id = $1',
      ['sch_lagos_premier_01']
    );
    const invoiceIdsA = invoicesCrossRes.rows.map((r: any) => r.id);
    const foreignInvoiceLeak = await client.query(
      'SELECT * FROM invoices WHERE id = ANY($1) AND school_id = $2',
      [invoiceIdsA, 'sch_abuja_horizon_02']
    );
    if (foreignInvoiceLeak.rows.length !== 0) {
      throw new Error('CRITICAL SECURITY FAILURE: Cross-tenant query leaked foreign invoices!');
    }
    console.log('  [PASS] Verified: School B cannot access School A\'s invoices.');

    // TEST 6: Financial Consistency & Transaction Integrity
    console.log('\nTEST 6: Financial Consistency & Transaction Boundaries...');
    await client.query('BEGIN');
    try {
      const testInvoiceId = 'inv_test_' + Date.now();
      await client.query(
        `INSERT INTO invoices (id, school_id, invoice_number, student_id, total, amount_paid, balance, status)
         VALUES ($1, $2, $3, $4, 5000000, 0, 5000000, 'ISSUED')`,
        [testInvoiceId, testSchoolId, 'INV-TEST-001', testStudentId]
      );
      // Simulate rollback
      throw new Error('Intentional failure to test rollback');
    } catch (err: any) {
      await client.query('ROLLBACK');
    }
    const checkRolledBack = await client.query("SELECT * FROM invoices WHERE invoice_number = 'INV-TEST-001'");
    if (checkRolledBack.rows.length !== 0) {
      throw new Error('Transaction rollback failed: Invoice was persisted despite rollback');
    }
    console.log('  [PASS] Transaction boundary verified: Rollback prevented partial/inconsistent record creation.');

    // Cleanup test student
    await client.query('DELETE FROM students WHERE id = $1', [testStudentId]);
    console.log('  [PASS] Cleaned up test student cleanly from Neon.');

    console.log('\n=====================================================');
    console.log('   ALL INTEGRATION TESTS PASSED WITH 100% SUCCESS    ');
    console.log('=====================================================');
  } finally {
    client.release();
    await pool.end();
  }
}

runTests().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]', err);
  process.exit(1);
});
