import assert from 'node:assert/strict';
import { ApiError, getAlternateOriginUrl, resolveRequestUrl, safeFetch } from '../src/services/api.ts';

async function runTests() {
  console.log('=== BursarIQ Network Resilience & Apex-Domain Self-Healing Test Suite ===');

  // 1. Apex/WWW bidirectional API URL resolution (prevents Render 301/307 CORS preflight aborts in EITHER primary config)
  assert.equal(
    resolveRequestUrl('/api/v1/auth/login', 'bursariq.com.ng'),
    'https://www.bursariq.com.ng/api/v1/auth/login',
    'Apex bursariq.com.ng must rewrite relative API calls to canonical www.bursariq.com.ng'
  );
  assert.equal(
    resolveRequestUrl('/api/v1/auth/login', 'www.bursariq.com.ng'),
    '/api/v1/auth/login',
    'Canonical www.bursariq.com.ng must keep relative API paths'
  );
  assert.equal(
    resolveRequestUrl('/api/v1/public/schools', 'localhost'),
    '/api/v1/public/schools',
    'Localhost must keep relative API paths'
  );
  assert.equal(
    resolveRequestUrl('https://www.bursariq.com.ng/api/health', 'bursariq.com.ng'),
    'https://www.bursariq.com.ng/api/health',
    'Already-absolute URLs must remain unchanged'
  );
  assert.equal(
    getAlternateOriginUrl('/api/v1/auth/login', 'https://www.bursariq.com.ng/api/v1/auth/login', 'bursariq.com.ng'),
    '/api/v1/auth/login',
    'If Render switches primary to apex, bursariq.com.ng must fall back to same-origin relative URL'
  );
  assert.equal(
    getAlternateOriginUrl('/api/v1/auth/login', '/api/v1/auth/login', 'www.bursariq.com.ng'),
    'https://bursariq.com.ng/api/v1/auth/login',
    'If Render switches primary to apex, www.bursariq.com.ng must fail over to https://bursariq.com.ng'
  );
  console.log('[PASS] 1. Bidirectional Apex <-> WWW API URL resolution & failover');

  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const setOnline = (online: boolean) => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: online },
    });
  };

  try {
    setOnline(true);

    // 2. GET auto-recovers from transient 502/503 Render cold-start/deploy hiccup
    let getCalls = 0;
    globalThis.fetch = (async () => {
      getCalls++;
      if (getCalls === 1) {
        return new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response(JSON.stringify({ success: true, schools: ['demo'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;

    const getRes = await safeFetch('/api/v1/public/schools', { timeoutMs: 2000 });
    assert.equal(getCalls, 2, 'GET should retry once after 502 and succeed');
    assert.equal(getRes.success, true);
    console.log('[PASS] 2. GET automatic retry recovery from 502 cold-start');

    // 3. Login POST auto-recovers from single dropped socket / TypeError: Failed to fetch
    let loginCalls = 0;
    globalThis.fetch = (async () => {
      loginCalls++;
      if (loginCalls === 1) {
        throw new TypeError('Failed to fetch');
      }
      return new Response(JSON.stringify({ token: 'tok_123', user: { id: 'u1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;

    const loginRes = await safeFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.ng', password: 'secret' }),
      timeoutMs: 2000,
    });
    assert.equal(loginCalls, 2, 'Login POST should retry once on transient socket drop');
    assert.equal(loginRes.token, 'tok_123');
    console.log('[PASS] 3. Login POST automatic retry recovery on transient network drop');

    // 4. Financial mutation POST MUST NOT auto-retry (zero double-charge risk)
    let paymentCalls = 0;
    globalThis.fetch = (async () => {
      paymentCalls++;
      throw new TypeError('Failed to fetch');
    }) as any;

    let paymentErr: any = null;
    try {
      await safeFetch('/api/v1/schools/s1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 50000 }),
        timeoutMs: 2000,
      });
    } catch (e) {
      paymentErr = e;
    }
    assert.equal(paymentCalls, 1, 'Financial mutation POST must NOT auto-retry');
    assert.ok(paymentErr instanceof ApiError);
    assert.equal(paymentErr.code, 'NETWORK_ERROR');
    console.log('[PASS] 4. Financial mutation POST strictly avoids unsafe auto-retry');

    // 5. Auth 401 fails fast without pointless retry
    let badAuthCalls = 0;
    globalThis.fetch = (async () => {
      badAuthCalls++;
      return new Response(JSON.stringify({ message: 'Invalid email or password.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;

    let authErr: any = null;
    try {
      await safeFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@test.ng', password: 'wrong' }),
        timeoutMs: 2000,
      });
    } catch (e) {
      authErr = e;
    }
    assert.equal(badAuthCalls, 1, 'HTTP 401 must fail immediately without retry');
    assert.ok(authErr instanceof ApiError);
    assert.equal(authErr.status, 401);
    assert.equal(authErr.message, 'Invalid email or password.');
    console.log('[PASS] 5. HTTP 401 fails fast with exact server message');

    // 6. Stalled/hung connection aborts cleanly via timeout (prevents infinite Loading spinner)
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    }) as any;

    let timeoutErr: any = null;
    try {
      await safeFetch('/api/v1/public/schools/demo/website', { timeoutMs: 80, maxRetries: 0 });
    } catch (e) {
      timeoutErr = e;
    }
    assert.ok(timeoutErr instanceof ApiError);
    assert.equal(timeoutErr.status, 408);
    assert.equal(timeoutErr.code, 'TIMEOUT');
    console.log('[PASS] 6. Stalled request cleanly aborts with TIMEOUT (408)');

    // 7a. False-offline Android Chrome bug: navigator.onLine === false while 4G data works MUST still send fetch & succeed!
    setOnline(false);
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ token: 'tok_android_ok', success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;
    const falseOfflineRes = await safeFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.ng', password: 'ok' }),
      timeoutMs: 1000,
      maxRetries: 0,
    });
    assert.equal(falseOfflineRes.token, 'tok_android_ok', 'Must NOT short-circuit when navigator.onLine is falsely false');
    console.log('[PASS] 7a. False navigator.onLine=false (Android bug) still executes login & succeeds');

    // 7b. Truly offline device (fetch actually throws AND navigator.onLine === false) throws OFFLINE ApiError
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as any;
    let offlineErr: any = null;
    try {
      await safeFetch('/api/v1/public/schools/demo/website', { timeoutMs: 500, maxRetries: 0 });
    } catch (e) {
      offlineErr = e;
    }
    assert.ok(offlineErr instanceof ApiError);
    assert.equal(offlineErr.status, 0);
    assert.equal(offlineErr.code, 'OFFLINE');
    console.log('[PASS] 7b. True offline failure throws accurate OFFLINE ApiError after attempting fetch');

    console.log('ALL 8 NETWORK RESILIENCE & FALSE-OFFLINE ANDROID TESTS PASSED!');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    }
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
