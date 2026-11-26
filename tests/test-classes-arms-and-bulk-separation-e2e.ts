import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseBulkStudentInput, inferNigerianLevel, normalizeNigerianClassName } from '../src/utils/studentRecordParser.js';

const CHROME_BIN = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const TEST_PORT = 3205;
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

  async reload() {
    await this.send('Page.reload', { ignoreCache: true });
    await this.waitFor(() => this.evaluate('return document.readyState === "complete"'), 10000);
    await new Promise((r) => setTimeout(r, 600));
  }

  async waitFor<T>(fn: () => Promise<T>, timeoutMs = 12000, msg = 'Timed out waiting for condition'): Promise<T> {
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

  async waitForText(snippet: string, timeoutMs = 12000) {
    try {
      return await this.waitFor(
        () => this.evaluate(`return (document.body?.innerText || '').includes(${JSON.stringify(snippet)});`),
        timeoutMs,
        `Timed out waiting for text: "${snippet}"`
      );
    } catch (err: any) {
      const txt = await this.bodyText().catch(() => '');
      throw new Error(`${err.message}\n--- PAGE TEXT ---\n${txt.slice(0, 1500)}`);
    }
  }

  async bodyText(): Promise<string> {
    return this.evaluate('return document.body?.innerText || "";');
  }

  async fillInputByPlaceholder(placeholderSnippet: string, value: string) {
    const ok = await this.evaluate(`
      const inputs = Array.from(document.querySelectorAll('input, textarea'));
      const el = inputs.find((i) => (i.placeholder || '').includes(${JSON.stringify(placeholderSnippet)}));
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    assert.ok(ok, `Input/Textarea with placeholder "${placeholderSnippet}" not found`);
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
    await new Promise((r) => setTimeout(r, 300));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-classes-arms-e2e-'));
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
    JWT_SECRET: 'safe-classes-arms-e2e-jwt-secret-64-chars-long-9876543210',
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
  console.log('=== Classes, Class Arms, Smart Record Separation & Persistence E2E ===');

  // 1. Unit tests on smart Nigerian parser
  console.log('[1/7] Running studentRecordParser unit assertions...');
  assert.strictEqual(normalizeNigerianClassName('jss1'), 'JSS 1');
  assert.strictEqual(normalizeNigerianClassName('SS2'), 'SSS 2');
  assert.strictEqual(normalizeNigerianClassName('pry 4'), 'Primary 4');
  assert.strictEqual(inferNigerianLevel('SSS 2'), 'Senior Secondary');
  assert.strictEqual(inferNigerianLevel('JSS 1'), 'Junior Secondary');
  assert.strictEqual(inferNigerianLevel('Primary 5'), 'Primary');
  assert.strictEqual(inferNigerianLevel('Nursery 2'), 'Early Years / Nursery');

  const parsedMessy = parseBulkStudentInput([
    '1. Chinedu Okafor - SSS 2 Science - Male',
    '2) Blessing Ngozi Amadi | JSS 1 Gold | F',
    '3. Tunde Bakare, Primary 4 A, Male',
    'Zainab Musa',
  ].join('\n'));
  assert.strictEqual(parsedMessy.length, 4);
  assert.strictEqual(parsedMessy[0].first_name, 'Chinedu');
  assert.strictEqual(parsedMessy[0].last_name, 'Okafor');
  assert.strictEqual(parsedMessy[0].class_name, 'SSS 2');
  assert.strictEqual(parsedMessy[0].class_arm_name, 'Science');
  assert.strictEqual(parsedMessy[0].gender, 'Male');
  assert.strictEqual(parsedMessy[0].class_level, 'Senior Secondary');

  assert.strictEqual(parsedMessy[1].first_name, 'Blessing');
  assert.strictEqual(parsedMessy[1].middle_name, 'Ngozi');
  assert.strictEqual(parsedMessy[1].last_name, 'Amadi');
  assert.strictEqual(parsedMessy[1].class_name, 'JSS 1');
  assert.strictEqual(parsedMessy[1].class_arm_name, 'Gold');
  assert.strictEqual(parsedMessy[1].gender, 'Female');

  assert.strictEqual(parsedMessy[2].class_name, 'Primary 4');
  assert.strictEqual(parsedMessy[2].class_arm_name, 'A');
  assert.strictEqual(parsedMessy[3].class_name, '');
  console.log('  Smart parser checks passed.');

  // Verify live server safe
  const liveHealth = await waitForHealth(LIVE_BASE, 5000).catch(() => null);
  if (liveHealth) {
    console.log(`[2/7] Live port 3000 healthy (${liveHealth.database?.provider || liveHealth.database}); starting isolated sandbox on port ${TEST_PORT}...`);
  }

  const tmpDir = setupSafeTempWorkspace();
  let serverProc: ChildProcess | null = spawnSafeTestServer(tmpDir);
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;
  const chromeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-classes-'));

  try {
    const testHealth = await waitForHealth(TEST_BASE, 25000);
    assert.strictEqual(Boolean(testHealth.neonConnected), false, 'Test server MUST NOT connect to live Neon PostgreSQL!');
    const dbDesc = String(testHealth.database?.provider || testHealth.database || '');
    assert.ok(dbDesc.includes('SQLite'), `Expected SQLite test DB, got: ${JSON.stringify(testHealth.database)}`);

    // Seed School + Teacher via API
    console.log('[3/7] Seeding test Nigerian school & staff...');
    const reg = await apiReq(null, null, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'De Great Light Academy',
      schoolType: 'Secondary',
      state: 'Lagos',
      lga: 'Alimosho',
      address: '15 Faith Road, Lagos',
      phone: '08031112222',
      email: 'info@degreatlight.edu.ng',
      ownerName: 'Mrs. Grace Adeyemi',
      ownerEmail: 'admin@degreatlight.edu.ng',
      password: 'Password123!',
      question1: 'City?',
      answer1: 'Lagos',
      question2: 'Color?',
      answer2: 'Emerald',
    });
    assert.strictEqual(reg.status, 201, `School registration failed: ${JSON.stringify(reg.data)}`);
    const adminToken = reg.data.token;
    const schoolId = reg.data.school.id;

    // Add Teacher
    const staffRes = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/staff', {
      first_name: 'Sola',
      last_name: 'Ogunleye',
      email: 'sola@degreatlight.edu.ng',
      phone: '08035556666',
      job_title: 'Form Teacher',
    });
    assert.strictEqual(staffRes.status, 201, `Teacher creation failed: ${JSON.stringify(staffRes.data)}`);

    const provTeacher = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Sola Ogunleye',
      email: 'sola@degreatlight.edu.ng',
      password: 'Password123!',
      role_name: 'TEACHER',
    });
    assert.strictEqual(provTeacher.status, 201, `Teacher portal provision failed: ${JSON.stringify(provTeacher.data)}`);

    const teacherLogin = await apiReq(null, null, 'POST', '/api/v1/auth/login', {
      email: 'sola@degreatlight.edu.ng',
      password: 'Password123!',
    });
    assert.strictEqual(teacherLogin.status, 200, 'Teacher login failed');
    const teacherToken = teacherLogin.data.token;

    // Launch Headless Chromium
    console.log('[4/7] Testing Classes & Multi-Arm CRUD in Headless Chromium...');
    const chromeDebugPort = 9338;
    chromeProc = spawn(
      CHROME_BIN,
      [
        `--remote-debugging-port=${chromeDebugPort}`,
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--user-data-dir=${chromeUserData}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let chromeErr = '';
    chromeProc.stderr?.on('data', (c) => {
      chromeErr += String(c || '');
    });

    const targets: any[] = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        try {
          const r = await fetch(`http://127.0.0.1:${chromeDebugPort}/json/list`);
          if (r.ok) {
            const list = await r.json();
            if (Array.isArray(list) && list.length > 0 && list[0]?.webSocketDebuggerUrl) return list;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`Chrome DevTools failed to start. stderr: ${chromeErr.slice(0, 500)}`);
    })();

    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    cdp = await CDPClient.connect(pageTarget.webSocketDebuggerUrl);

    await cdp.goto(`${TEST_BASE}/`);
    await cdp.waitForText('Sign In');
    await cdp.fillInputByPlaceholder('school.edu.ng', 'admin@degreatlight.edu.ng');
    await cdp.fillInputByPlaceholder('••••', 'Password123!');
    await cdp.evaluate(`
      const btn = document.querySelector('form button[type="submit"]');
      if (!btn || btn.disabled) throw new Error('Login submit button not found');
      btn.click();
    `);
    await cdp.waitForText('De Great Light Academy');

    // Open Classes & Arms view
    await cdp.clickButtonByText('Classes & Arms');
    await cdp.waitForText('No classes & arms configured yet.');
    await cdp.waitForText('Create Custom Class');

    // 4a. Create Custom Class with initial arms
    await cdp.clickButtonByText('Create Custom Class');
    await cdp.waitForText('Create Academic Class');
    await cdp.fillInputByPlaceholder('e.g. JSS 1, SSS 2, Primary 4, Creche', 'Creche');
    await cdp.fillInputByPlaceholder('e.g. Gold, Silver or A, B, C', 'Gold, Silver');
    await cdp.clickButtonByText('Create Class');
    await cdp.waitForText('Creche');
    await cdp.waitForText('Gold');
    await cdp.waitForText('Silver');
    console.log('  Custom Class + initial multi-arm created.');

    // 4b. Add multi-arms ("Diamond, Emerald") + Form Teacher
    await cdp.clickButtonByText('Add Arm');
    await cdp.waitForText('Add Arm / Stream to Creche');
    await cdp.fillInputByPlaceholder('e.g. Gold or Gold, Silver, Diamond', 'Diamond, Emerald');
    await cdp.evaluate(`
      const selects = Array.from(document.querySelectorAll('form select'));
      const teacherSel = selects[selects.length - 1];
      const opt = Array.from(teacherSel.options).find((o) => o.text.includes('Ogunleye'));
      if (opt) {
        teacherSel.value = opt.value;
        teacherSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    `);
    await cdp.evaluate(`
      const form = document.querySelector('form');
      const btn = form?.querySelector('button[type="submit"]');
      if (!btn || btn.disabled) throw new Error('Add Arm submit button not found');
      btn.click();
    `);
    await cdp.waitForText('Diamond');
    await cdp.waitForText('Emerald');
    await cdp.waitForText('Teacher: Sola Ogunleye');
    console.log('  Multi-arm creation & Form Teacher assignment succeeded.');

    // 4c. Edit Arm ("Gold" -> "Gold Elite", Cap 35)
    await cdp.evaluate(`
      const btn = document.querySelector('button[title="Edit Arm"]');
      if (!btn) throw new Error('Edit Arm button not found');
      btn.click();
    `);
    await cdp.waitForText('Edit Arm · Creche');
    await cdp.evaluate(`
      const modal = Array.from(document.querySelectorAll('h3')).find((h) => h.innerText.includes('Edit Arm · Creche')).closest('.bg-white');
      const nameInput = modal.querySelector('input[type="text"]');
      const capInput = modal.querySelector('input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(nameInput, 'Gold Elite');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(capInput, '35');
      capInput.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await cdp.clickButtonByText('Save Arm Changes');
    await cdp.waitForText('Gold Elite');
    await cdp.waitForText('Cap: 35');
    console.log('  Edit Arm succeeded.');

    // 4d. Delete Arm ("Emerald")
    await cdp.evaluate(`
      const delBtns = Array.from(document.querySelectorAll('button[title="Delete Arm"]'));
      if (delBtns.length === 0) throw new Error('Delete Arm button not found');
      delBtns[delBtns.length - 1].click();
    `);
    await cdp.waitForText('Remove Arm: Creche');
    await cdp.clickButtonByText('Confirm Remove');
    await cdp.waitForText('ARM / STREAMS (3)');
    console.log('  Delete Arm succeeded.');

    // 4e. Single-call Load Nigerian Classes
    await cdp.clickButtonByText('Load Nigerian Classes');
    await cdp.waitForText('JSS 1');
    await cdp.waitForText('SSS 2');
    console.log('  Bulk Nigerian class preset loaded cleanly.');

    // 5. Bulk Smart Paste & Record Separation in Students Directory
    console.log('[5/7] Testing Smart Bulk Paste, Separation & Auto-Class Creation...');
    await cdp.clickButtonByText('Students');
    await cdp.waitForText('Student Management & Directory');
    await cdp.clickButtonByText('Import CSV');
    await cdp.waitForText('Bulk Import Students via CSV / Smart Paste');

    const messyPaste = [
      '1. Chinedu Okafor - SSS 2 Science - Male',
      '2. Blessing Amadi - JSS 1 Gold - Female',
      '3. Tunde Bakare - Primary 4 A - Male',
      '4. Zainab Musa - Female',
    ].join('\n');
    await cdp.fillInputByPlaceholder('first_name,last_name', messyPaste);
    await cdp.waitForText('Separated Preview: 4 Student(s) Ready');
    await cdp.waitForText('Needs Class (1)');

    // Use Fill Missing to assign Zainab Musa -> JSS 2 / Diamond
    await cdp.fillInputByPlaceholder('Set Class (e.g. JSS 1)', 'JSS 2');
    await cdp.fillInputByPlaceholder('Set Arm (e.g. Gold, A)', 'Diamond');
    await cdp.clickButtonByText('Fill Missing');
    await cdp.waitFor(async () => !(await cdp!.bodyText()).includes('Needs Class (1)'));

    await cdp.clickButtonByText('Import 4 Student(s)');
    await cdp.waitForText('Assigned Admission Numbers Preview');
    await cdp.clickButtonByText('Close', true);

    // Wait for directory refresh
    await cdp.waitForText('Chinedu Okafor');
    await cdp.waitForText('Tunde Bakare');
    await cdp.waitForText('Zainab Musa');
    console.log('  Smart bulk import & auto-class/arm linking verified.');

    // Test View Separation tabs: By Class & Arm, By Level, By Gender
    await cdp.clickButtonByText('By Level');
    await cdp.waitForText('Senior Secondary');
    await cdp.waitForText('Primary');
    await cdp.clickButtonByText('By Gender');
    await cdp.waitForText('Male');
    await cdp.waitForText('Female');
    await cdp.clickButtonByText('All List');

    // Use Directory Checkboxes + Bulk Separate / Assign toolbar on Zainab Musa
    await cdp.evaluate(`
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const row = rows.find((r) => r.innerText.includes('Zainab Musa'));
      if (!row) throw new Error('Zainab Musa row not found');
      const cb = row.querySelector('input[type="checkbox"]');
      cb.click();
    `);
    await cdp.waitForText('Separate / Assign 1 Selected Student');
    await cdp.evaluate(`
      const bar = Array.from(document.querySelectorAll('div.bg-slate-900')).find((d) => (d.innerText || '').includes('Separate / Assign'));
      if (!bar) throw new Error('Bulk separation toolbar not found');
      const selects = Array.from(bar.querySelectorAll('select'));
      const sss1Opt = Array.from(selects[0].options).find((o) => o.text.startsWith('SSS 1'));
      if (!sss1Opt) throw new Error('SSS 1 option missing in bulk bar');
      selects[0].value = sss1Opt.value;
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await new Promise((r) => setTimeout(r, 150));
    await cdp.evaluate(`
      const bar = Array.from(document.querySelectorAll('div.bg-slate-900')).find((d) => (d.innerText || '').includes('Separate / Assign'));
      const selects = Array.from(bar.querySelectorAll('select'));
      const commOpt = Array.from(selects[1].options).find((o) => o.text === 'Commercial');
      if (!commOpt) throw new Error('Commercial option missing in bulk arm select');
      selects[1].value = commOpt.value;
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await cdp.clickButtonByText('Save Separation');
    await cdp.waitFor(async () => {
      return await cdp!.evaluate(`
        const row = Array.from(document.querySelectorAll('tbody tr')).find((r) => r.innerText.includes('Zainab Musa'));
        return Boolean(row && row.innerText.includes('SSS 1') && row.innerText.includes('Commercial'));
      `);
    });
    console.log('  Directory bulk separation toolbar updated Zainab Musa -> SSS 1 / Commercial.');

    // 6. Browser Reload & Full Server Restart Persistence Check
    console.log('[6/7] Verifying persistence across browser refresh AND full server restart...');
    await cdp.reload();
    await cdp.waitForText('De Great Light Academy');
    await cdp.clickButtonByText('Classes & Arms');
    await cdp.waitForText('Creche');
    await cdp.waitForText('Gold Elite');
    await cdp.waitForText('Primary 4');

    // Restart isolated server completely
    await stopChild(serverProc);
    serverProc = spawnSafeTestServer(tmpDir);
    await waitForHealth(TEST_BASE, 25000);

    // Verify in reloaded Chromium AND via direct API reads
    await cdp.reload();
    await cdp.clickButtonByText('Classes & Arms');
    await cdp.waitForText('Creche');
    await cdp.waitForText('Gold Elite');
    await cdp.waitForText('Cap: 35');
    await cdp.clickButtonByText('Students');
    await cdp.waitForText('Zainab Musa');
    await cdp.waitForText('SSS 1');
    await cdp.waitForText('Commercial');

    const postRestartStudents = await apiReq(adminToken, schoolId, 'GET', '/api/v1/school/students?limit=50');
    assert.strictEqual(postRestartStudents.status, 200);
    const zainab = postRestartStudents.data.students.find((s: any) => s.full_name.includes('Zainab Musa'));
    const tunde = postRestartStudents.data.students.find((s: any) => s.full_name.includes('Tunde Bakare'));
    assert.ok(zainab, 'Zainab Musa missing after server restart');
    assert.strictEqual(zainab.class_name, 'SSS 1');
    assert.strictEqual(zainab.class_arm_name, 'Commercial');
    assert.ok(zainab.class_id && zainab.class_arm_id, 'class_id / class_arm_id missing on Zainab after restart');
    assert.ok(tunde, 'Tunde Bakare missing after server restart');
    assert.strictEqual(tunde.class_name, 'Primary 4');
    assert.strictEqual(tunde.class_arm_name, 'A');
    assert.ok(tunde.class_id && tunde.class_arm_id, 'Auto-created Primary 4 & A IDs did not persist on Tunde');
    console.log('  Full server restart persistence verified.');

    // 7. RBAC checks: Teacher MUST NOT be allowed to mutate classes, arms, or bulk-assign
    console.log('[7/7] Verifying RBAC protection on new class/arm/bulk-assign endpoints...');
    const classesList = await apiReq(adminToken, schoolId, 'GET', '/api/v1/school/classes');
    const creche = classesList.data.classes.find((c: any) => c.name === 'Creche');
    assert.ok(creche && creche.arms.length >= 2);
    const firstArm = creche.arms[0];

    for (const check of [
      await apiReq(teacherToken, schoolId, 'POST', '/api/v1/school/classes', { name: 'HackClass' }),
      await apiReq(teacherToken, schoolId, 'POST', '/api/v1/school/classes/bulk-setup', { mode: 'PRIMARY' }),
      await apiReq(teacherToken, schoolId, 'POST', `/api/v1/school/classes/${creche.id}/arms`, { name: 'HackArm' }),
      await apiReq(teacherToken, schoolId, 'PUT', `/api/v1/school/classes/${creche.id}/arms/${firstArm.id}`, { name: 'Hacked' }),
      await apiReq(teacherToken, schoolId, 'DELETE', `/api/v1/school/classes/${creche.id}/arms/${firstArm.id}`),
      await apiReq(teacherToken, schoolId, 'POST', '/api/v1/school/students/bulk-assign', { student_ids: [zainab.id], gender: 'Male' }),
    ]) {
      assert.strictEqual(check.status, 403, `Expected 403 for non-admin RBAC probe, got ${check.status}`);
    }

    assert.strictEqual(cdp.pageErrors.length, 0, `Uncaught page errors: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('ALL CLASSES, ARMS, SMART BULK SEPARATION & PERSISTENCE E2E TESTS PASSED!');
  } finally {
    if (cdp) cdp.close();
    await stopChild(chromeProc);
    await stopChild(serverProc);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(chromeUserData, { recursive: true, force: true }); } catch {}
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
