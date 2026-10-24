/**
 * BURSARIQ - GCS ERROR HANDLING & FAILURE REPORTING TEST
 *
 * Verifies that when GCS_BACKUP_BUCKET is configured with a non-existent or failing bucket,
 * the backup endpoint explicitly returns a 500 error and does NOT report a false-positive success.
 */

import assert from 'node:assert';
import dotenv from 'dotenv';
import path from 'node:path';
import express from 'express';
import http from 'node:http';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test.local') });
dotenv.config();

// Intentionally point to an unprovisioned bucket to verify failure behavior
process.env.GCS_BACKUP_BUCKET = 'bursariq-unprovisioned-test-bucket-99999';

import { apiRouter } from '../server/routes.ts';

console.log('===============================================================');
console.log('   BURSARIQ: GCS FAILURE HANDLING INTEGRATION TEST             ');
console.log('===============================================================');

async function makeRequest(
  port: number,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
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
          resolve({ status: res.statusCode || 500, body: parsed });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function runGcsFailureTest() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  app.use('/v1', apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;

  try {
    console.log('\n[TEST] Testing Explicit Failure when GCS Bucket is Unreachable...');
    const res = await makeRequest(port, 'POST', '/api/v1/system/backup', {
      Authorization: 'Bearer test_token',
    });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'BACKUP_FAILED');
    assert.ok(res.body.error && res.body.error.includes('Remote backup upload failed'));
    console.log('✓ PASS: System explicitly returned 500 BACKUP_FAILED; zero false-positive success reported');

    console.log('\n===============================================================');
    console.log('   ALL GCS FAILURE REPORTING TESTS PASSED (100% SUCCESS)       ');
    console.log('===============================================================');
  } finally {
    server.close();
  }
}

runGcsFailureTest().catch((err) => {
  console.error('[GCS FAILURE TEST ERROR]', err);
  process.exit(1);
});
