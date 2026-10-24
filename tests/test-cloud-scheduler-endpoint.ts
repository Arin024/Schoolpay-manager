/**
 * BURSARIQ - CLOUD SCHEDULER BACKUP ENDPOINT INTEGRATION TEST
 *
 * Verifies:
 * 1. Unauthenticated public requests to POST /api/v1/system/backup are rejected with 401 UNAUTHENTICATED.
 * 2. Authenticated requests with Bearer OIDC token or secret trigger PostgreSQL backup.
 * 3. Successful execution returns backup manifest and SHA-256 checksum.
 */

import assert from 'node:assert';
import dotenv from 'dotenv';
import path from 'node:path';
import express from 'express';
import http from 'node:http';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test.local') });
dotenv.config();

import { apiRouter } from '../server/routes.ts';

console.log('===============================================================');
console.log('   BURSARIQ: CLOUD SCHEDULER BACKUP ENDPOINT TEST SUITE        ');
console.log('===============================================================');

async function makeRequest(
  port: number,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = { ...headers };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: reqHeaders,
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
          resolve({ status: res.statusCode || 500, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runSchedulerEndpointTests() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  app.use('/v1', apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  console.log(`[Test Server] Live on http://127.0.0.1:${port}`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated Public Request Rejection
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Testing Unauthenticated Public Trigger Rejection...');
    const unauthRes = await makeRequest(port, 'POST', '/api/v1/system/backup');
    assert.strictEqual(unauthRes.status, 401);
    assert.strictEqual(unauthRes.body.error, 'UNAUTHENTICATED');
    console.log('✓ PASS: Public unauthenticated request blocked with 401 UNAUTHENTICATED');

    // -------------------------------------------------------------------------
    // TEST 2: Authenticated OIDC Trigger Execution
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing Authenticated Cloud Scheduler Invocation...');
    const authRes = await makeRequest(port, 'POST', '/api/v1/system/backup', {
      Authorization: 'Bearer mock_oidc_service_token_12345',
    });
    assert.strictEqual(authRes.status, 200);
    assert.strictEqual(authRes.body.success, true);
    assert.ok(authRes.body.backupId && authRes.body.backupId.startsWith('bursariq_pg_backup_'));
    assert.ok(authRes.body.manifest && authRes.body.manifest.checksumSha256);
    console.log(`✓ PASS: Authenticated scheduler invocation completed: ${authRes.body.backupId} (SHA-256: ${authRes.body.manifest.checksumSha256.slice(0, 16)}...)`);

    console.log('\n===============================================================');
    console.log('   ALL CLOUD SCHEDULER BACKUP ENDPOINT TESTS PASSED (100%)     ');
    console.log('===============================================================');
  } finally {
    server.close();
  }
}

runSchedulerEndpointTests().catch((err) => {
  console.error('[SCHEDULER TEST ERROR]', err);
  process.exit(1);
});
