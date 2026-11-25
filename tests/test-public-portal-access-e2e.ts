import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const CHROME_BIN = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const TEST_PORT = 3201;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;
const LIVE_BASE = 'http://127.0.0.1:3000';

class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  public consoleErrors: string[] = [];
  public pageErrors: string[] = [];
  public apiServerErrors: { url: string; status: number }[] = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP Error ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const text = msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'Uncaught exception';
        this.pageErrors.push(text);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const args = (msg.params?.args || []).map((a: any) => a.value ?? a.description ?? '').join(' ');
        if (args && !args.includes('401') && !args.includes('403') && !args.includes('409')) {
          this.consoleErrors.push(args);
        }
      } else if (msg.method === 'Network.responseReceived') {
        const res = msg.params?.response;
        if (res && res.status >= 500 && res.url.includes('/api/')) {
          this.apiServerErrors.push({ url: res.url, status: res.status });
        }
      }
    });
  }

  static async connect(wsUrl: string): Promise<CDPClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', (e) => reject(e), { once: true });
    });
    const client = new CDPClient(ws);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return client;
  }

  async send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval Exception: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
    }
    return res.result?.value as T;
  }

  async goto(url: string) {
    await this.send('Page.navigate', { url });
    await this.waitFor(() => this.evaluate('return document.readyState === "complete"'), 10000);
    await new Promise((r) => setTimeout(r, 400));
  }

  async waitFor<T>(fn: () => Promise<T>, timeoutMs = 10000, msg = 'Timed out waiting for condition'): Promise<T> {
    const start = Date.now();
    let lastErr: any;
    while (Date.now() - start < timeoutMs) {
      try {
        const v = await fn();
        if (v) return v;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    throw new Error(`${msg}${lastErr ? ` (${lastErr.message})` : ''}`);
  }

  async waitForText(snippet: string, timeoutMs = 10000) {
    try {
      return await this.waitFor(
        () => this.evaluate(`return (document.body?.innerText || '').includes(${JSON.stringify(snippet)});`),
        timeoutMs,
        `Timed out waiting for text: "${snippet}"`
      );
    } catch (err: any) {
      const txt = await this.bodyText().catch(() => '');
      throw new Error(`${err.message}\n--- PAGE TEXT ---\n${txt.slice(0, 1200)}`);
    }
  }

  async bodyText(): Promise<string> {
    return this.evaluate('return document.body?.innerText || "";');
  }

  async fillInputByPlaceholder(placeholderSnippet: string, value: string) {
    const ok = await this.evaluate(`
      const inputs = Array.from(document.querySelectorAll('input'));
      const el = inputs.find((i) => (i.placeholder || '').includes(${JSON.stringify(placeholderSnippet)}));
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    assert.ok(ok, `Input with placeholder "${placeholderSnippet}" not found`);
  }

  async fillInput(selector: string, value: string) {
    const ok = await this.evaluate(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    assert.ok(ok, `Input not found: ${selector}`);
  }

  async clickButtonByText(text: string, exact = false) {
    const clicked = await this.evaluate(`
      const target = ${JSON.stringify(text)};
      const exact = ${exact ? 'true' : 'false'};
      const btns = Array.from(document.querySelectorAll('button'));
      const found = btns.find((b) => {
        if (b.disabled) return false;
        const t = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
        return exact ? t === target : t.includes(target);
      });
      if (!found) return false;
      found.scrollIntoView({ block: 'center' });
      found.click();
      return true;
    `);
    assert.ok(clicked, `Button with text "${text}" not found or disabled`);
    await new Promise((r) => setTimeout(r, 250));
  }

  async clickSubmit() {
    const clicked = await this.evaluate(`
      const btn = document.querySelector('form button[type="submit"]');
      if (!btn || btn.disabled) return false;
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      return true;
    `);
    assert.ok(clicked, 'Form submit button not found or disabled');
    await new Promise((r) => setTimeout(r, 250));
  }

  async logoutInBrowser() {
    const clicked = await this.evaluate(`
      const btn = document.querySelector('button[title="Sign Out"]');
      if (btn) { btn.click(); return true; }
      const byText = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Sign Out');
      if (byText) { byText.click(); return true; }
      return false;
    `);
    assert.ok(clicked, 'Sign Out button not found');
    await this.waitFor(() => this.evaluate('return Boolean(document.querySelector("input[type=email]") || document.querySelector("input[type=password]"))'), 10000);
    await new Promise((r) => setTimeout(r, 250));
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function waitForHealth(baseUrl: string, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${baseUrl} failed health check`);
}

function setupSafeTempWorkspace(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-portal-access-e2e-'));
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  const appRoot = process.cwd();
  for (const item of ['dist', 'server', 'migrations', 'schema.sql', 'schema.pg.sql', 'public', 'node_modules', 'server.ts', 'package.json', 'tsconfig.json']) {
    const src = path.join(appRoot, item);
    if (fs.existsSync(src)) {
      fs.symlinkSync(src, path.join(tmpDir, item));
    }
  }
  return tmpDir;
}

function spawnSafeTestServer(tmpDir: string): ChildProcess {
  const cleanEnv: Record<string, string> = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || '/root',
    NODE_ENV: 'development',
    RENDER: '1',
    PORT: String(TEST_PORT),
    JWT_SECRET: 'safe-portal-access-test-jwt-secret-64-chars-long-1234567890',
    ALLOW_SANDBOX_PAYMENTS: 'true',
    DISABLE_HMR: 'true',
  };
  const tsxBin = path.join(tmpDir, 'node_modules', '.bin', 'tsx');
  const child = spawn(tsxBin, ['server.ts'], {
    cwd: tmpDir,
    env: cleanEnv,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (chunk) => {
    const s = String(chunk || '').trim();
    if (s && !s.includes('ExperimentalWarning')) console.error('[TestServer stderr]', s);
  });
  return child;
}

async function stopChild(child: ChildProcess | null) {
  if (!child || child.killed || !child.pid) return;
  const pid = child.pid;
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch {}
      try { child.kill('SIGKILL'); } catch {}
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    try { process.kill(-pid, 'SIGTERM'); } catch {
      try { child.kill('SIGTERM'); } catch { resolve(); }
    }
  });
}

async function apiReq(token: string | null, schoolId: string | null, method: string, p: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (schoolId) headers['X-School-Id'] = schoolId;
  const res = await fetch(`${TEST_BASE}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function run() {
  console.log('=== Public Portal Entry, Self-Activation, Admission/Phone Login & Verification E2E ===');
  const liveHealth = await waitForHealth(LIVE_BASE, 5000);
  console.log(`[0/8] Live port 3000 healthy (${liveHealth.database?.provider}); isolated sandbox will run on port ${TEST_PORT}.`);

  const tmpDir = setupSafeTempWorkspace();
  let serverProc: ChildProcess | null = spawnSafeTestServer(tmpDir);
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;
  const chromeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-portal-'));

  try {
    const testHealth = await waitForHealth(TEST_BASE, 25000);
    assert.strictEqual(testHealth.database?.provider, 'Local SQLite', 'Test server must use isolated SQLite!');

    // Seed two schools + students + parents + receipt + report card via Admin API
    const reg1 = await apiReq(null, null, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Brightstar Model College',
      schoolType: 'Secondary',
      state: 'Lagos',
      lga: 'Ikeja',
      address: '10 Allen Avenue',
      phone: '08030001111',
      email: 'info@brightstar.edu.ng',
      ownerName: 'Chief Admin',
      ownerEmail: 'admin@brightstar.edu.ng',
      password: 'Password123!',
      question1: 'City?',
      answer1: 'Lagos',
      question2: 'Color?',
      answer2: 'Green',
    });
    assert.strictEqual(reg1.status, 201, `Reg1 failed: ${JSON.stringify(reg1.data)}`);
    const admin1Token = reg1.data.token;
    const school1Id = reg1.data.school.id;
    const school1Slug = reg1.data.school.slug;

    const reg2 = await apiReq(null, null, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Horizon Academy',
      schoolType: 'Secondary',
      state: 'FCT - Abuja',
      lga: 'Wuse',
      address: '20 Aminu Kano',
      phone: '08030002222',
      email: 'info@horizon.edu.ng',
      ownerName: 'Horizon Owner',
      ownerEmail: 'admin@horizon.edu.ng',
      password: 'Password123!',
      question1: 'City?',
      answer1: 'Abuja',
      question2: 'Color?',
      answer2: 'Blue',
    });
    assert.strictEqual(reg2.status, 201, `Reg2 failed: ${JSON.stringify(reg2.data)}`);
    const school2Slug = reg2.data.school.slug;

    const clsRes = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/classes', { name: 'JSS 1', level: 'Junior Secondary' });
    assert.strictEqual(clsRes.status, 201);
    const classId = clsRes.data.class.id;

    // Enroll Student A (Adaeze Okafor) with DOB + NO email
    const stuA = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/students', {
      admission_number: 'ADM-2025-101',
      first_name: 'Adaeze',
      last_name: 'Okafor',
      gender: 'Female',
      date_of_birth: '2012-05-14',
      phone: '08031112222',
      class_id: classId,
    });
    assert.strictEqual(stuA.status, 201);
    const stuAId = stuA.data.student.id;

    // Enroll Student B (Tunde Bello) with NO email for Bulk Provisioning test
    const stuB = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/students', {
      admission_number: 'ADM-2025-102',
      first_name: 'Tunde',
      last_name: 'Bello',
      gender: 'Male',
      class_id: classId,
    });
    assert.strictEqual(stuB.status, 201);

    // Create Parent P with Phone ONLY (no email) & link to Student A
    const parP = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/parents', {
      first_name: 'Chinedu',
      last_name: 'Okafor',
      phone: '08059998888',
      student_ids: [stuAId],
    });
    assert.strictEqual(parP.status, 201);

    // Create Fee Category, Session/Term, Invoice, Payment, Receipt + Report Card directly for Outsider verification
    const catRes = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/fee-categories', {
      name: 'Tuition Fee',
      default_amount_naira: 45000,
    });
    assert.strictEqual(catRes.status, 201);

    const sesCreate = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/academic-sessions', {
      name: '2025/2026',
      status: 'ACTIVE',
    });
    assert.strictEqual(sesCreate.status, 201);
    const sessionId = sesCreate.data.session.id;

    const termCreate = await apiReq(admin1Token, school1Id, 'POST', `/api/v1/school/academic-sessions/${sessionId}/terms`, {
      name: '1st Term',
      status: 'ACTIVE',
    });
    assert.strictEqual(termCreate.status, 201);
    const termId = termCreate.data.term.id;

    const invRes = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/invoices', {
      student_id: stuAId,
      academic_session_id: sessionId,
      term_id: termId,
      due_date: '2026-12-31',
      items: [{ fee_category_id: catRes.data.category.id, description: 'Tuition Fee', quantity: 1, unit_amount_kobo: 4500000 }],
    });
    assert.strictEqual(invRes.status, 201, `Invoice failed: ${JSON.stringify(invRes.data)}`);

    const payRes = await apiReq(admin1Token, school1Id, 'POST', `/api/v1/school/invoices/${invRes.data.invoice.id}/payments`, {
      amount_kobo: 4500000,
      payment_method: 'BANK_TRANSFER',
    });
    assert.strictEqual(payRes.status, 201, `Payment failed: ${JSON.stringify(payRes.data)}`);
    const receiptNo =
      payRes.data.payment?.receipt?.receiptNumber ||
      payRes.data.payment?.receipt?.receipt_number ||
      payRes.data.receipt?.receiptNumber ||
      payRes.data.receipt?.receipt_number;
    assert.ok(receiptNo, `Expected official receipt number from recorded payment: ${JSON.stringify(payRes.data)}`);

    // Seed published report card directly in isolated sandbox SQLite
    const dbFile = path.join(tmpDir, 'data', 'schoolpay.db');
    const sqlite = new DatabaseSync(dbFile);
    const sess = sqlite.prepare('SELECT id FROM academic_sessions WHERE school_id = ? LIMIT 1').get(school1Id) as any;
    const term = sqlite.prepare('SELECT id FROM terms WHERE school_id = ? LIMIT 1').get(school1Id) as any;
    const rcCode = 'RC-BSM-9988';
    sqlite.prepare(`
      INSERT INTO report_cards (id, school_id, student_id, class_id, academic_session_id, term_id, status, total_score, average_score, subjects_count, verification_code, published_at)
      VALUES ('rc_verify_1', ?, ?, ?, ?, ?, 'PUBLISHED', 450, 90, 5, ?, CURRENT_TIMESTAMP)
    `).run(school1Id, stuAId, classId, sess?.id || 'sess_default', term?.id || 'term_default', rcCode);
    sqlite.close();
    console.log(`[1/8] Test school #portal/${school1Slug}, student ADM-2025-101, parent phone, receipt ${receiptNo}, report card ${rcCode} ready.`);

    // Launch Headless Chromium via CDP
    const cdpPort = 9335;
    chromeProc = spawn(CHROME_BIN, [
      `--remote-debugging-port=${cdpPort}`,
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${chromeUserData}`,
      'about:blank',
    ]);
    let wsUrl = '';
    for (let i = 0; i < 40; i++) {
      try {
        const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        const pages = (await listRes.json()) as any[];
        if (pages[0]?.webSocketDebuggerUrl) {
          wsUrl = pages[0].webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(wsUrl, 'Failed to obtain Chromium CDP WebSocket URL');
    cdp = await CDPClient.connect(wsUrl);

    // 2. Visit Branded School Portal Link directly (#portal/<slug>) WITHOUT logging in
    await cdp.goto(`${TEST_BASE}/#portal/${school1Slug}`);
    await cdp.waitForText('Brightstar Model College');
    await cdp.waitForText('OFFICIAL SCHOOL PORTAL');
    const guestText = await cdp.bodyText();
    assert.ok(!guestText.includes('Recycle Bin') && !guestText.includes('Verify Tenant Guard') && !guestText.includes('Staff Directory'), 'Unauthenticated visitor saw admin controls!');
    console.log(`[2/8] Branded link /#portal/${school1Slug} renders School Portal Entry for unauthenticated users (zero 404).`);

    // 3. Student Self-Activation without touching Admin email/password
    await cdp.clickButtonByText('Activate Access');
    await cdp.waitForText('I am a Student');
    await cdp.fillInputByPlaceholder('ADM-2025-001', 'ADM-2025-101');
    await cdp.fillInputByPlaceholder('e.g. Okafor', 'Okafor');
    await cdp.fillInputByPlaceholder('2012-05-14', '2012-05-14');
    await cdp.fillInputByPlaceholder('Min 6 characters', 'StudentPass!1');
    await cdp.clickButtonByText('Activate My Student Portal');
    await cdp.waitForText('Adaeze Okafor');
    await cdp.waitForText('My Report Cards');
    const studentPortalText = await cdp.bodyText();
    assert.ok(!studentPortalText.includes('Audit') && !studentPortalText.includes('Enroll Student'), 'Student saw admin UI!');
    console.log('[3/8] Student self-activated via Admission No + Surname + DOB -> landed directly in read-only Student Portal.');

    // Verify API blocks duplicate self-activation (409) & wrong DOB (401)
    const dupAct = await apiReq(null, null, 'POST', '/api/v1/public/portal/activate', {
      school_slug: school1Slug,
      portal_type: 'STUDENT',
      admission_number: 'ADM-2025-101',
      last_name: 'Okafor',
      verification_value: '2012-05-14',
      password: 'OtherPassword1',
    });
    assert.strictEqual(dupAct.status, 409, `Expected 409 ALREADY_ACTIVATED, got ${dupAct.status}`);

    const wrongAct = await apiReq(null, null, 'POST', '/api/v1/public/portal/activate', {
      school_slug: school1Slug,
      portal_type: 'STUDENT',
      admission_number: 'ADM-2025-101',
      last_name: 'Okafor',
      verification_value: '1999-01-01',
      password: 'OtherPassword1',
    });
    assert.strictEqual(wrongAct.status, 401, `Expected 401 VERIFICATION_FAILED, got ${wrongAct.status}`);

    // Log out, then sign back in on Student tab using ONLY Admission Number (NO password field!)
    await cdp.logoutInBrowser();
    await cdp.goto(`${TEST_BASE}/#portal/${school1Slug}`);
    await cdp.waitForText('Brightstar Model College');
    await cdp.clickButtonByText('Student', true);
    const hasStuPwdField = await cdp.evaluate('return Boolean(document.querySelector("input[type=password]"))');
    assert.strictEqual(hasStuPwdField, false, 'Student login tab must NOT render a password field!');
    const stuTabText = await cdp.bodyText();
    assert.ok(!stuTabText.includes('Forgot Password?'), 'Student tab must NOT show Forgot Password link');
    await cdp.fillInputByPlaceholder('ADM-2025-001', 'ADM-2025-101');
    await cdp.clickSubmit();
    await cdp.waitForText('Adaeze Okafor');
    await cdp.waitForText('My Report Cards');
    await cdp.clickButtonByText('My Profile');
    await cdp.waitForText('Student Academic Profile');
    assert.ok(!(await cdp.bodyText()).includes('bursariq.local'), 'Internal placeholder email leaked to Student profile!');
    console.log('[4/10] Student signed in using ONLY Admission Number (no password input, zero leakage).');
    await cdp.logoutInBrowser();

    // 5. Parent Self-Activation + Phone/Password Toggle + Child Admission-Number-Only Login (default)
    await cdp.goto(`${TEST_BASE}/#portal/${school1Slug}`);
    await cdp.clickButtonByText('Activate Access');
    await cdp.clickButtonByText('I am a Parent');
    await cdp.fillInputByPlaceholder('08031234567', '08059998888');
    await cdp.fillInputByPlaceholder('e.g. Okafor', 'Okafor');
    await cdp.fillInputByPlaceholder('Chidi', 'ADM-2025-101');
    await cdp.fillInputByPlaceholder('Min 6 characters', 'ParentPass!1');
    await cdp.clickButtonByText('Activate My Parent Portal');
    await cdp.waitForText('My Children');
    await cdp.waitForText('Adaeze Okafor');
    await cdp.logoutInBrowser();

    // Backward-compatible Phone + Password toggle verification
    await cdp.goto(`${TEST_BASE}/#portal/${school1Slug}`);
    await cdp.clickButtonByText('Parent', true);
    await cdp.clickButtonByText('Sign in with password');
    await cdp.fillInputByPlaceholder('08031234567', '08059998888');
    await cdp.fillInput('input[type="password"]', 'ParentPass!1');
    await cdp.clickSubmit();
    await cdp.waitForText('My Children');
    await cdp.waitForText('Adaeze Okafor');
    await cdp.logoutInBrowser();

    // Default Parent Admission-Number-Only Login (no password field!)
    await cdp.goto(`${TEST_BASE}/#portal/${school1Slug}`);
    await cdp.clickButtonByText('Parent', true);
    const hasParPwdField = await cdp.evaluate('return Boolean(document.querySelector("input[type=password]"))');
    assert.strictEqual(hasParPwdField, false, 'Default Parent tab must NOT render a password field!');
    await cdp.fillInputByPlaceholder('ADM-2025-001', 'ADM-2025-101');
    await cdp.clickSubmit();
    await cdp.waitForText('My Children');
    await cdp.waitForText('Adaeze Okafor');
    console.log('[5/10] Parent signed in via Child Admission Number Only (default) AND optional Phone+Password toggle.');
    await cdp.logoutInBrowser();

    // 6. Outsider Public Verification of Receipt & Report Card WITHOUT Login
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.waitForText('Verify Document');
    await cdp.clickButtonByText('Verify Document');
    await cdp.fillInputByPlaceholder('RCP-2025-0001', receiptNo);
    await cdp.clickButtonByText('Verify Document Now');
    await cdp.waitForText('Authentic Payment Receipt Verified');
    await cdp.waitForText('Adaeze O***');
    await cdp.clickButtonByText('Report Card / Transcript');
    await cdp.fillInputByPlaceholder('RC-', rcCode);
    await cdp.clickButtonByText('Verify Document Now');
    await cdp.waitForText('Authentic Report Card Verified');
    await cdp.waitForText('Brightstar Model College');
    console.log('[6/10] Outsider verified Official Receipt & Published Report Card without login (learner name masked).');

    // 7. School Finder & Admin Bulk Provisioning (Student B ADM-2025-102)
    await cdp.clickButtonByText('Find Your School Portal');
    await cdp.waitForText('Horizon Academy');
    await cdp.clickButtonByText('Close school finder').catch(() => {});

    // Sign in as School Admin -> open Overview & Roles -> Bulk Generate Logins
    await cdp.clickButtonByText('Portal Login', true);
    await cdp.clickButtonByText('Admin', true);
    await cdp.fillInput('input[type="email"]', 'admin@brightstar.edu.ng');
    await cdp.fillInput('input[type="password"]', 'Password123!');
    await cdp.clickSubmit();
    await cdp.waitForText('Live Shareable School Website & Portal');
    await cdp.waitForText(`/#portal/${school1Slug}`);
    await cdp.clickButtonByText('Roles', true);
    await cdp.waitForText('Bulk Generate Logins');
    await cdp.clickButtonByText('Bulk Generate Logins');
    await cdp.waitForText('Bulk Generate Student & Parent Logins');
    await cdp.clickButtonByText('Generate Individual Logins');
    await cdp.waitForText('ADM-2025-102');
    const bulkPass = await cdp.evaluate(`
      const cells = Array.from(document.querySelectorAll('table td'));
      const idx = cells.findIndex((c) => (c.innerText || '').trim() === 'ADM-2025-102');
      return idx >= 0 && cells[idx + 1] ? (cells[idx + 1].innerText || '').trim() : '';
    `);
    assert.ok(bulkPass.length >= 6, 'Expected generated temporary password for ADM-2025-102');
    await cdp.clickButtonByText('Done');
    await cdp.logoutInBrowser();

    // Sign in as Student B using ONLY Admission Number on Student tab (no password!)
    await cdp.goto(`${TEST_BASE}/#portal/${school1Slug}`);
    await cdp.clickButtonByText('Student', true);
    await cdp.fillInputByPlaceholder('ADM-2025-001', 'ADM-2025-102');
    await cdp.clickSubmit();
    await cdp.waitForText('Tunde Bello');
    await cdp.waitForText('My Report Cards');
    console.log('[7/10] Admin Shareable Portal Link, Bulk Logins & Passwordless Student B Admission Login verified.');
    await cdp.logoutInBrowser();

    // 8. Automatic Nigerian School Admission Number Flow + Un-scoped Admission Login (NO pre-activation, NO school picker!)
    const stuC = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/students', {
      first_name: 'Emeka',
      last_name: 'Nwosu',
      gender: 'Male',
      emergency_contact: 'Mrs. Nwosu (+2348091234567)',
      class_id: classId,
    });
    assert.strictEqual(stuC.status, 201, `Student C auto-enroll failed: ${JSON.stringify(stuC.data)}`);
    assert.strictEqual(stuC.data.autoGeneratedAdmissionNumber, true);
    const autoAdmC: string = stuC.data.student.admission_number;
    assert.match(autoAdmC, /^BMC\/\d{4}\/\d{4}$/, `Expected Nigerian BMC/YYYY/NNNN format, got ${autoAdmC}`);

    // Bulk CSV Import students WITHOUT admission_number -> automatic sequential numbering
    const bulkImp = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/students/import', {
      students: [
        { first_name: 'Blessing', last_name: 'Eze', gender: 'Female', class_name: 'JSS 1' },
        { first_name: 'Kemi', last_name: 'Balogun', gender: 'Female', class_name: 'JSS 1' },
      ],
    });
    assert.strictEqual(bulkImp.status, 200, `Bulk import failed: ${JSON.stringify(bulkImp.data)}`);
    assert.strictEqual(bulkImp.data.importedCount, 2);
    assert.strictEqual(bulkImp.data.generatedAdmissionCount, 2);
    assert.notStrictEqual(
      bulkImp.data.importedStudentsPreview[0].admission_number,
      bulkImp.data.importedStudentsPreview[1].admission_number
    );

    // Legacy unnumbered student backfill
    const legacySqlite = new DatabaseSync(path.join(tmpDir, 'data', 'schoolpay.db'));
    legacySqlite
      .prepare(
        `INSERT INTO students (id, school_id, admission_number, first_name, last_name, full_name, gender, student_status, is_deleted)
         VALUES ('stu_legacy_null', ?, NULL, 'Musa', 'Ibrahim', 'Musa Ibrahim', 'Male', 'ACTIVE', 0)`
      )
      .run(school1Id);
    legacySqlite.close();
    const backfillRes = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/students/assign-missing-admission-numbers', {});
    assert.strictEqual(backfillRes.status, 200);
    assert.strictEqual(backfillRes.data.assignedCount, 1);
    assert.match(backfillRes.data.students[0].admission_number, /^BMC\/\d{4}\/\d{4}$/);

    // 8a. Freshly enrolled Emeka Nwosu logs directly on root `/` (NO school selected, NO prior parent/activation)
    // First as PARENT via Child Admission Number Only
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.clickButtonByText('Parent', true);
    await cdp.fillInputByPlaceholder('ADM-2025-001', autoAdmC);
    await cdp.clickSubmit();
    await cdp.waitForText('My Children');
    await cdp.waitForText('Emeka Nwosu');
    const emekaParentText = await cdp.bodyText();
    assert.ok(!emekaParentText.includes('Adaeze Okafor'), 'Parent child-scoping leaked another child!');
    assert.ok(!emekaParentText.includes('Enroll Student'), 'Read-only parent saw admin UI!');
    await cdp.clickButtonByText('Profile', true);
    await cdp.waitForText('Parent / Guardian Profile');
    assert.ok(!(await cdp.bodyText()).includes('bursariq.local'), 'Internal placeholder email leaked to Parent profile!');
    await cdp.logoutInBrowser();

    // Now Emeka Nwosu logs in as STUDENT via Admission Number Only
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.clickButtonByText('Student', true);
    await cdp.fillInputByPlaceholder('ADM-2025-001', autoAdmC);
    await cdp.clickSubmit();
    await cdp.waitForText('Emeka Nwosu');
    await cdp.waitForText(autoAdmC);
    await cdp.logoutInBrowser();

    // 8b. RBAC Mutation Prevention + 403 Staff-Escalation Guard + 403 Deactivation Guard
    const parentApiLogin = await apiReq(null, null, 'POST', '/api/v1/public/portal/admission-login', {
      admission_number: autoAdmC,
      portal_type: 'PARENT',
    });
    assert.strictEqual(parentApiLogin.status, 200);
    assert.strictEqual(parentApiLogin.data.activeRole?.role_name, 'PARENT');
    const parentMutateBlock = await apiReq(parentApiLogin.data.token, school1Id, 'POST', '/api/v1/school/students', {
      first_name: 'Hacker',
      last_name: 'Attempt',
    });
    assert.strictEqual(parentMutateBlock.status, 403, `Read-only parent must get 403 on write routes, got ${parentMutateBlock.status}`);

    const stuApiLogin = await apiReq(null, null, 'POST', '/api/v1/public/portal/admission-login', {
      admission_number: autoAdmC,
      portal_type: 'STUDENT',
    });
    assert.strictEqual(stuApiLogin.status, 200);
    assert.strictEqual(stuApiLogin.data.activeRole?.role_name, 'STUDENT');
    const stuMutateBlock = await apiReq(stuApiLogin.data.token, school1Id, 'POST', '/api/v1/school/students', {
      first_name: 'Hacker',
      last_name: 'Student',
    });
    assert.strictEqual(stuMutateBlock.status, 403, `Read-only student must get 403 on write routes, got ${stuMutateBlock.status}`);

    // Verify deactivated portal account is strictly blocked (403)
    const secDb = new DatabaseSync(path.join(tmpDir, 'data', 'schoolpay.db'));
    secDb.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(stuApiLogin.data.user.id);
    secDb.close();
    const deactivatedRes = await apiReq(null, null, 'POST', '/api/v1/public/portal/admission-login', {
      admission_number: autoAdmC,
      portal_type: 'STUDENT',
    });
    assert.strictEqual(deactivatedRes.status, 403, `Deactivated user must get 403, got ${deactivatedRes.status}`);
    const restoreDb = new DatabaseSync(path.join(tmpDir, 'data', 'schoolpay.db'));
    restoreDb.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(stuApiLogin.data.user.id);
    restoreDb.close();

    // 8c. Ambiguous Admission Number (409 Disambiguation in Browser) across Brightstar vs Horizon Academy
    const loginAdmin2 = await apiReq(null, null, 'POST', '/api/v1/auth/login', {
      email: 'admin@horizon.edu.ng',
      password: 'Password123!',
    });
    assert.strictEqual(loginAdmin2.status, 200);
    const admin2Token = loginAdmin2.data.token;
    const school2Id = loginAdmin2.data.activeSchoolId;
    const dup1 = await apiReq(admin1Token, school1Id, 'POST', '/api/v1/school/students', {
      admission_number: 'DUP-2026-01',
      first_name: 'Sadiq',
      last_name: 'Brightstar',
    });
    assert.strictEqual(dup1.status, 201);
    const dup2 = await apiReq(admin2Token, school2Id, 'POST', '/api/v1/school/students', {
      admission_number: 'DUP-2026-01',
      first_name: 'Zainab',
      last_name: 'Horizon',
    });
    assert.strictEqual(dup2.status, 201);

    await cdp.goto(`${TEST_BASE}/`);
    await cdp.clickButtonByText('Student', true);
    await cdp.fillInputByPlaceholder('ADM-2025-001', 'DUP-2026-01');
    await cdp.clickSubmit();
    await cdp.waitForText('Multiple schools matched');
    await cdp.waitForText('Horizon Academy');
    await cdp.clickButtonByText('Horizon Academy');
    await cdp.waitForText('Zainab Horizon');
    assert.ok(!(await cdp.bodyText()).includes('Sadiq Brightstar'), 'Disambiguation leaked wrong school student!');
    console.log(`[8/10] Un-scoped admission login (${autoAdmC}), Parent auto-link, RBAC 403 guards & 409 disambiguation verified.`);

    // 9. Server Restart Persistence Check
    await stopChild(serverProc);
    serverProc = spawnSafeTestServer(tmpDir);
    await waitForHealth(TEST_BASE, 25000);
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.waitForText('Zainab Horizon');
    await cdp.logoutInBrowser();
    await cdp.clickButtonByText('Parent', true);
    await cdp.fillInputByPlaceholder('ADM-2025-001', autoAdmC);
    await cdp.clickSubmit();
    await cdp.waitForText('Emeka Nwosu');
    console.log('[9/10] Full server restart persistence verified cleanly across reloaded browser session & fresh admission login.');

    assert.strictEqual(cdp.pageErrors.length, 0, `Page errors detected: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `API 5xx errors detected: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('[10/10] Zero page errors and zero API 5xx errors across all browser portal flows!');
    console.log('=== PUBLIC PORTAL ACCESS E2E: ALL CHECKS PASSED ===');
  } finally {
    cdp?.close();
    await stopChild(chromeProc);
    await stopChild(serverProc);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(chromeUserData, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('❌ PUBLIC PORTAL ACCESS E2E FAILED:', err);
  process.exit(1);
});
