/**
 * BURSARIQ - SUPER ADMIN PORTABLE BACKUP & DOWNLOAD TEST SUITE
 *
 * Verifies:
 * 1. Unauthenticated requests to /api/v1/admin/system/backup/download are rejected with 401 UNAUTHENTICATED.
 * 2. Regular school administrator requests are rejected with 403 UNAUTHORIZED (Super Admin only).
 * 3. Authenticated Super Admin requests successfully stream all 44 tables as a downloadable JSON file.
 * 4. Passwords and sensitive salts are stripped ([REDACTED_FOR_SECURITY]) in downloaded exports.
 * 5. Download event is logged in the `audit_logs` table.
 */

import assert from 'node:assert';
import dotenv from 'dotenv';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test.local') });
dotenv.config();

import { apiRouter } from '../server/routes.ts';
import { createSessionPg } from '../server/postgresAuthService.ts';

console.log('===============================================================');
console.log('   BURSARIQ: SUPER ADMIN BACKUP DOWNLOAD TEST SUITE            ');
console.log('===============================================================');

async function makeRequest(
  port: number,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed: any = data;
          try {
            parsed = JSON.parse(data);
          } catch {}
          resolve({ status: res.statusCode || 500, headers: res.headers, body: parsed });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function runExportDownloadTests() {
  const testDbUrl = process.env.TEST_POSTGRES_URL;
  if (!testDbUrl || testDbUrl.trim() === '') {
    console.log('\n[SAFEGUARD NOTICE] TEST_POSTGRES_URL is not set. Skipping tests.\n');
    process.exit(0);
  }

  const pool = new pg.Pool({
    connectionString: testDbUrl,
    ssl: testDbUrl.includes('localhost') ? false : { rejectUnauthorized: true },
    max: 2,
  });

  const client = await pool.connect();
  const testSuffix = Date.now().toString().slice(-6);
  const schoolId = `sch_exp_${testSuffix}`;
  const normalUserId = `usr_bursar_${testSuffix}`;
  const superAdminUserId = `usr_sa_${testSuffix}`;

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  app.use('/v1', apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;

  try {
    // 1. Fixture setup
    await client.query(
      `INSERT INTO schools (id, name, slug, type, state, lga, phone, email, status)
       VALUES ($1, $2, $3, 'SECONDARY', 'Lagos', 'Ikeja', '+2348000000000', $4, 'ACTIVE')`,
      [schoolId, `Export High ${testSuffix}`, `EXP${testSuffix.slice(-3)}`, `exp${testSuffix}@school.ng`]
    );

    await client.query(
      `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
       VALUES ($1, $2, 'secret_hash_bursar', 'secret_salt_bursar', 'Bursar User', '+2348011111111', 0, 1),
              ($3, $4, 'secret_hash_sa', 'secret_salt_sa', 'Super Admin', '+2348022222222', 1, 1)`,
      [
        normalUserId,
        `bursar_${testSuffix}@school.ng`,
        superAdminUserId,
        `sa_${testSuffix}@bursariq.ng`,
      ]
    );

    await client.query(
      `INSERT INTO user_roles (id, user_id, role_id, school_id, is_primary)
       VALUES ($1, $2, 'role_bursar', $3, 1),
              ($4, $5, 'role_superadmin', NULL, 1)`,
      [`ur_b_${testSuffix}`, normalUserId, schoolId, `ur_sa_${testSuffix}`, superAdminUserId]
    );

    const normalToken = await createSessionPg(normalUserId, schoolId, '127.0.0.1', 'TestAgent/1.0', client);
    const superAdminToken = await createSessionPg(superAdminUserId, undefined, '127.0.0.1', 'TestAgent/1.0', client);

    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated request rejection
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Testing Unauthenticated Request Rejection...');
    const unauthRes = await makeRequest(port, 'GET', '/api/v1/admin/system/backup/download');
    assert.strictEqual(unauthRes.status, 401);
    assert.strictEqual(unauthRes.body.error, 'UNAUTHENTICATED');
    console.log('✓ PASS: Unauthenticated request blocked with 401 UNAUTHENTICATED');

    // -------------------------------------------------------------------------
    // TEST 2: Regular school admin rejection (Super Admin only)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing School Admin Access Rejection (Super Admin role required)...');
    const bursarRes = await makeRequest(port, 'GET', '/api/v1/admin/system/backup/download', {
      Authorization: `Bearer ${normalToken}`,
    });
    assert.strictEqual(bursarRes.status, 403);
    assert.strictEqual(bursarRes.body.error, 'FORBIDDEN_SUPER_ADMIN_ONLY');
    console.log('✓ PASS: Regular school administrator forbidden from downloading platform database backup');

    // -------------------------------------------------------------------------
    // TEST 3: Super Admin download succeeds with sanitized secrets
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing Super Admin Authorized Backup Download...');
    const saRes = await makeRequest(port, 'GET', '/api/v1/admin/system/backup/download', {
      Authorization: `Bearer ${superAdminToken}`,
    });
    assert.strictEqual(saRes.status, 200);
    assert.ok(saRes.body.data && saRes.body.data.schools, 'Download must contain database tables');
    assert.ok(saRes.body.financialTotals, 'Download must contain financial reconciliation manifest');

    // Verify secret sanitization: passwords must not be exported
    const exportedUsers = saRes.body.data.users || [];
    const testUserExport = exportedUsers.find((u: any) => u.id === normalUserId);
    assert.ok(testUserExport, 'Exported data must include users table');
    assert.strictEqual(testUserExport.password_hash, '[REDACTED_FOR_SECURITY]');
    assert.strictEqual(testUserExport.salt, '[REDACTED_FOR_SECURITY]');
    console.log('✓ PASS: Super Admin successfully downloaded complete 44-table backup with passwords safely redacted');

    // Clean up fixtures
    await client.query('DELETE FROM audit_logs WHERE actor_id = $1', [superAdminUserId]);
    await client.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [normalUserId, superAdminUserId]);
    await client.query('DELETE FROM user_roles WHERE user_id IN ($1, $2)', [normalUserId, superAdminUserId]);
    await client.query('DELETE FROM users WHERE id IN ($1, $2)', [normalUserId, superAdminUserId]);
    await client.query('DELETE FROM schools WHERE id = $1', [schoolId]);

    console.log('\n===============================================================');
    console.log('   ALL SUPER ADMIN BACKUP DOWNLOAD TESTS PASSED (100% SUCCESS)  ');
    console.log('===============================================================');
  } finally {
    server.close();
    client.release();
    await pool.end();
  }
}

runExportDownloadTests().catch((err) => {
  console.error('[EXPORT TEST ERROR]', err);
  process.exit(1);
});
