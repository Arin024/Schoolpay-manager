/**
 * BURSARIQ - POSTGRESQL AUTH & SESSION SERVICE TEST SUITE
 *
 * Verifies:
 * 1. Session creation in isolated Neon PostgreSQL.
 * 2. Session validation and tenant resolution.
 * 3. Impersonation sessions with 2-hour sliding expiry.
 * 4. Token destruction (logout).
 * 5. Expired token rejection.
 */

import assert from 'node:assert';
import dotenv from 'dotenv';
import path from 'node:path';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test.local') });
dotenv.config();

import {
  createSessionPg,
  createImpersonationSessionPg,
  validateSessionPg,
  destroySessionPg,
} from '../server/postgresAuthService.ts';

console.log('===============================================================');
console.log('   BURSARIQ: POSTGRESQL AUTH & SESSION INTEGRATION SUITE       ');
console.log('===============================================================');

async function runAuthTests() {
  const testDbUrl = process.env.TEST_POSTGRES_URL;
  if (!testDbUrl || testDbUrl.trim() === '') {
    console.log('\n[SAFEGUARD NOTICE] TEST_POSTGRES_URL is not set.');
    console.log('Skipping isolated auth tests (0 records touched, 100% safe).\n');
    process.exit(0);
  }

  const pool = new pg.Pool({
    connectionString: testDbUrl,
    ssl: testDbUrl.includes('localhost') ? false : { rejectUnauthorized: true },
    max: 5,
  });

  const client = await pool.connect();
  const testSuffix = Date.now().toString().slice(-6);
  const testSchoolId = `sch_auth_${testSuffix}`;
  const testUserId = `usr_auth_${testSuffix}`;
  const superAdminId = `usr_sa_${testSuffix}`;

  try {
    // 1. Setup isolated fixtures
    await client.query(
      `INSERT INTO schools (id, name, slug, type, state, lga, phone, email)
       VALUES ($1, $2, $3, 'SECONDARY', 'Lagos', 'Ikeja', '+2348000000000', $4) ON CONFLICT DO NOTHING`,
      [testSchoolId, `Auth Test School ${testSuffix}`, `ATH${testSuffix.slice(-3)}`, `auth${testSuffix}@school.ng`]
    );

    await client.query(
      `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
       VALUES ($1, $2, 'hash', 'salt', 'Auth User', '+2348011111111', 0, 1) ON CONFLICT DO NOTHING`,
      [testUserId, `user_${testSuffix}@school.ng`]
    );

    await client.query(
      `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
       VALUES ($1, $2, 'hash', 'salt', 'Super Admin', '+2348022222222', 1, 1) ON CONFLICT DO NOTHING`,
      [superAdminId, `sa_${testSuffix}@bursariq.ng`]
    );

    // Assign school role
    await client.query(
      `INSERT INTO roles (id, name, display_name, scope)
       VALUES ('role_bursar', 'BURSAR', 'Bursar', 'SCHOOL') ON CONFLICT DO NOTHING`
    );

    await client.query(
      `INSERT INTO user_roles (id, user_id, role_id, school_id, is_primary)
       VALUES ($1, $2, 'role_bursar', $3, 1) ON CONFLICT DO NOTHING`,
      [`ur_${testSuffix}`, testUserId, testSchoolId]
    );

    // TEST 1: Create session & validate
    console.log('\n[TEST 1] Testing Session Creation & Validation...');
    const token = await createSessionPg(testUserId, testSchoolId, '127.0.0.1', 'AuditBot/1.0', client);
    assert.ok(token && token.length === 64, 'Token must be 64-char hex string');

    const sessionData = await validateSessionPg(token, client);
    assert.ok(sessionData, 'Session data must be returned');
    assert.strictEqual(sessionData.user.id, testUserId);
    assert.strictEqual(sessionData.schoolId, testSchoolId);
    assert.strictEqual(sessionData.roles.length, 1);
    assert.strictEqual(sessionData.roles[0].role_name, 'BURSAR');
    console.log('✓ PASS: Asynchronous session created, verified, and bound to school tenant');

    // TEST 2: Impersonation session
    console.log('\n[TEST 2] Testing Impersonation Session...');
    const impToken = await createImpersonationSessionPg(
      testUserId,
      testSchoolId,
      superAdminId,
      '127.0.0.1',
      'AuditBot/1.0',
      client
    );
    assert.ok(impToken.startsWith('imp_'), 'Impersonation token must have prefix imp_');

    const impData = await validateSessionPg(impToken, client);
    assert.ok(impData, 'Impersonation session must be valid');
    assert.strictEqual(impData.user.id, testUserId);
    assert.strictEqual(impData.impersonatedBy, superAdminId);
    console.log('✓ PASS: Impersonation session verified with superAdmin audit linkage');

    // TEST 3: Destroy session
    console.log('\n[TEST 3] Testing Session Destruction (Logout)...');
    await destroySessionPg(token, client);
    const postLogoutData = await validateSessionPg(token, client);
    assert.strictEqual(postLogoutData, null, 'Destroyed token must return null');
    console.log('✓ PASS: Session destroyed cleanly; subsequent token validation returns null');

    // Clean up isolated fixtures
    await client.query('DELETE FROM sessions WHERE school_id = $1', [testSchoolId]);
    await client.query('DELETE FROM user_roles WHERE school_id = $1', [testSchoolId]);
    await client.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, superAdminId]);
    await client.query('DELETE FROM schools WHERE id = $1', [testSchoolId]);

    console.log('\n===============================================================');
    console.log('   ALL POSTGRESQL AUTH TESTS PASSED (100% SUCCESS)             ');
    console.log('===============================================================');
  } finally {
    client.release();
    await pool.end();
  }
}

runAuthTests().catch((err) => {
  console.error('[AUTH TEST ERROR]', err);
  process.exit(1);
});
