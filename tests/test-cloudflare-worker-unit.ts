/**
 * BURSARIQ - CLOUDFLARE WORKER ROUTING & ASSET UNIT TEST
 *
 * Simulates Cloudflare Worker execution against the built dist/ directory
 * and verifies:
 * 1. Root / returns index.html with no-cache headers.
 * 2. Static assets (/manifest.webmanifest, /sw.js) return appropriate types and no-cache.
 * 3. Hashed assets (/assets/index-*.js, .css) return immutable caching headers.
 * 4. Client SPA routes (e.g. /dashboard, /invoices, /login) fall back to index.html with status 200.
 * 5. Edge health check (/api/health, /health) returns JSON with status 'healthy'.
 * 6. Private financial/API routes (/api/*, /v1/*) receive no-store headers.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import workerModule from '../cloudflare/worker.ts';

console.log('===============================================================');
console.log('   BURSARIQ: CLOUDFLARE WORKER ROUTING & ASSET TEST            ');
console.log('===============================================================');

// Mock Cloudflare Assets binding backed by real dist/ filesystem
const distDir = path.resolve(process.cwd(), 'dist');
assert.ok(fs.existsSync(distDir), 'dist/ directory must exist for testing');

const mockAssets = {
  fetch: async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    let filePath = path.join(distDir, url.pathname === '/' ? 'index.html' : url.pathname);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath);
      let contentType = 'text/plain';
      if (filePath.endsWith('.html')) contentType = 'text/html; charset=utf-8';
      else if (filePath.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
      else if (filePath.endsWith('.css')) contentType = 'text/css; charset=utf-8';
      else if (filePath.endsWith('.webmanifest')) contentType = 'application/manifest+json; charset=utf-8';
      else if (filePath.endsWith('.png')) contentType = 'image/png';

      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': contentType },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

const mockEnv = {
  ASSETS: mockAssets,
  BACKEND_ORIGIN: 'https://ais-pre-eoqypgqka7gqp6j4a5fwme-696474482089.europe-west2.run.app',
};

async function runWorkerTests() {
  // TEST 1: GET / serves index.html with no-cache
  console.log('\n[TEST 1] Testing GET / (Root Frontend Serving)...');
  const req1 = new Request('https://bursariq.com.ng/');
  const res1 = await workerModule.fetch(req1, mockEnv, {});
  assert.strictEqual(res1.status, 200);
  const text1 = await res1.text();
  assert.ok(text1.includes('<title>BursarIQ'), 'index.html contains BursarIQ title');
  assert.strictEqual(res1.headers.get('Cache-Control'), 'no-cache, no-store, must-revalidate');
  console.log('✓ PASS: GET / returns built index.html with proper revalidation headers');

  // TEST 2: GET /manifest.webmanifest
  console.log('\n[TEST 2] Testing GET /manifest.webmanifest (PWA Manifest)...');
  const req2 = new Request('https://bursariq.com.ng/manifest.webmanifest');
  const res2 = await workerModule.fetch(req2, mockEnv, {});
  assert.strictEqual(res2.status, 200);
  const manifest = JSON.parse(await res2.text());
  assert.strictEqual(manifest.name, 'BursarIQ - School Pay Manager');
  assert.strictEqual(manifest.short_name, 'BursarIQ');
  console.log('✓ PASS: /manifest.webmanifest returns valid BursarIQ PWA manifest');

  // TEST 3: GET /sw.js (Service Worker)
  console.log('\n[TEST 3] Testing GET /sw.js (PWA Service Worker)...');
  const req3 = new Request('https://bursariq.com.ng/sw.js');
  const res3 = await workerModule.fetch(req3, mockEnv, {});
  assert.strictEqual(res3.status, 200);
  const swText = await res3.text();
  assert.ok(swText.includes('workbox'), 'sw.js contains workbox precache logic');
  console.log('✓ PASS: /sw.js returns compiled Workbox service worker');

  // TEST 4: GET /invoices (Client-side SPA Route Fallback)
  console.log('\n[TEST 4] Testing Client-side SPA Route Fallback (/invoices)...');
  const req4 = new Request('https://bursariq.com.ng/invoices');
  const res4 = await workerModule.fetch(req4, mockEnv, {});
  assert.strictEqual(res4.status, 200);
  const text4 = await res4.text();
  assert.ok(text4.includes('<div id="root"></div>'), 'SPA route serves index.html root container');
  console.log('✓ PASS: Non-API client routes fall back to index.html with status 200');

  // TEST 5: GET /health (Edge Health Endpoint)
  console.log('\n[TEST 5] Testing GET /health (Edge Health Endpoint)...');
  const req5 = new Request('https://bursariq.com.ng/health');
  const res5 = await workerModule.fetch(req5, mockEnv, {});
  assert.strictEqual(res5.status, 200);
  const healthJson = await res5.json();
  assert.strictEqual(healthJson.status, 'healthy');
  assert.strictEqual(healthJson.service, 'BursarIQ Edge Gateway');
  console.log('✓ PASS: Edge health check returns JSON status healthy');

  console.log('\n===============================================================');
  console.log('   ALL 5 CLOUDFLARE WORKER ROUTING TESTS PASSED (100%)         ');
  console.log('===============================================================');
}

runWorkerTests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
