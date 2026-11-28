/**
 * Deep E2E Test: Editable Academic Sessions & Semesters/Terms (2027/2028, 2035/2036, etc.),
 * Custom Session Creation & Inline Rename inside Create/Edit Examination & Bulk Reassign,
 * Editable School Settings Session Input, Portal-Mounted Classes Modals, & Multi-Tenant Guards.
 *
 * Runs strictly in an isolated temporary sandbox (no DATABASE_URL) on port 3241.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

const TEST_PORT = 3241;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;

async function apiReq(
  base: string,
  method: string,
  urlPath: string,
  body?: unknown,
  token?: string,
  schoolId?: string
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (schoolId) headers['x-school-id'] = schoolId;

  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function waitForHealth(base: string, logs: string[], timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Sandbox server failed to boot:\n${logs.join('').slice(-2500)}`);
}

async function stopChild(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    if (!proc.killed) proc.kill('SIGKILL');
  } catch {}
}

function findChromeBinary(): string {
  const candidates = [
    process.env.CHROME_BIN,
    '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean) as string[];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('No Chromium/Chrome binary found.');
}

async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  public pageErrors: string[] = [];
  public apiServerErrors: Array<{ url: string; status: number }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const text =
          msg.params?.exceptionDetails?.exception?.description ||
          msg.params?.exceptionDetails?.text ||
          'Runtime exception';
        this.pageErrors.push(String(text));
      } else if (msg.method === 'Network.responseReceived') {
        const resp = msg.params?.response;
        if (resp && resp.url && resp.url.includes('/api/') && resp.status >= 500) {
          this.apiServerErrors.push({ url: resp.url, status: resp.status });
        }
      }
    });
  }

  static async connect(debugPort: number): Promise<CDPClient> {
    const start = Date.now();
    let targets: any[] = [];
    while (Date.now() - start < 15000) {
      try {
        targets = await fetchJson(`http://127.0.0.1:${debugPort}/json`);
        if (Array.isArray(targets) && targets.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) {
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error('No Chromium page target available');

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', (err) => reject(err), { once: true });
    });
    const client = new CDPClient(ws);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    return client;
  }

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewport(width: number, height: number) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
  }

  async navigate(url: string) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 1100));
  }

  async eval<T = any>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text ||
          'Eval failed'
      );
    }
    return res?.result?.value as T;
  }

  async waitFor(fnExpr: string, label: string, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await this.eval<boolean>(`Boolean((${fnExpr})())`);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async clickButtonText(needle: string, exact = false, insideDialog = false) {
    const clicked = await this.eval<boolean>(`(() => {
      const scope = ${insideDialog ? 'document.querySelector(\'body > [role="dialog"]\') || document' : 'document'};
      const btns = Array.from(scope.querySelectorAll('button')).filter(b => !b.disabled && b.offsetParent !== null);
      const target = btns.find(b => {
        const t = (b.textContent || '').replace(/\\s+/g, ' ').trim();
        return ${exact ? `t === ${JSON.stringify(needle)}` : `t.includes(${JSON.stringify(needle)})`};
      });
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    })()`);
    assert.strictEqual(clicked, true, `Failed to click button "${needle}" (insideDialog=${insideDialog})`);
    await new Promise((r) => setTimeout(r, 350));
  }

  async closeDialogByEscape() {
    await this.eval(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);
    await new Promise((r) => setTimeout(r, 300));
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function run() {
  const repoRoot = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-session-edit-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-sesedit-'));
  const serverLogs: string[] = [];
  let serverProc: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;

  try {
    for (const item of [
      'server.ts',
      'server',
      'src',
      'migrations',
      'dist',
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'index.html',
      'public',
      'node_modules',
      'schema.sql',
      'schema.pg.sql',
    ]) {
      const srcPath = path.join(repoRoot, item);
      if (fs.existsSync(srcPath)) {
        fs.symlinkSync(srcPath, path.join(tmpDir, item));
      }
    }
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });

    const cleanEnv: Record<string, string> = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/root',
      NODE_ENV: 'development',
      PORT: String(TEST_PORT),
      RENDER: '1',
      DISABLE_HMR: 'true',
      ALLOW_SANDBOX_PAYMENTS: 'true',
      JWT_SECRET: 'test-session-edit-secret-2026',
    };

    serverProc = spawn(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), ['server.ts'], {
      cwd: tmpDir,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout?.on('data', (d) => serverLogs.push(d.toString()));
    serverProc.stderr?.on('data', (d) => serverLogs.push(d.toString()));

    await waitForHealth(TEST_BASE, serverLogs);
    console.log('1. Isolated sandbox server healthy on port', TEST_PORT);

    const password = 'Password123!';
    const emailA = 'admin@healthcollege.edu.ng';
    const emailB = 'admin@rivalcollege.edu.ng';

    // Register Tenant A (Tertiary College) & Tenant B (IDOR attacker check)
    const regA = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Apex College of Health Technology',
      schoolType: 'College of Health / Nursing',
      institutionCategory: 'TERTIARY',
      academicCycleType: 'SEMESTER',
      cycleLabels: ['1st Semester', '2nd Semester'],
      gradingMode: 'GPA_5',
      state: 'Kogi',
      lga: 'Lokoja',
      address: '10 Health Rd',
      phone: '08030001111',
      email: 'info@apexhealth.edu.ng',
      ownerName: 'Registrar A',
      ownerEmail: emailA,
      password,
      question1: 'City?',
      answer1: 'Lokoja',
      question2: 'Color?',
      answer2: 'Blue',
    });
    assert.strictEqual(regA.status, 201);
    const tokenA = regA.data.token as string;
    const schoolA = (regA.data.school?.id || regA.data.activeSchool?.id || regA.data.activeSchoolId) as string;

    const regB = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Rival Health College',
      schoolType: 'College of Health / Nursing',
      institutionCategory: 'TERTIARY',
      academicCycleType: 'SEMESTER',
      cycleLabels: ['1st Semester', '2nd Semester'],
      gradingMode: 'GPA_5',
      state: 'Lagos',
      lga: 'Ikeja',
      address: '20 Rival Rd',
      phone: '08030002222',
      email: 'info@rivalhealth.edu.ng',
      ownerName: 'Registrar B',
      ownerEmail: emailB,
      password,
      question1: 'City?',
      answer1: 'Lagos',
      question2: 'Color?',
      answer2: 'Red',
    });
    assert.strictEqual(regB.status, 201);
    const tokenB = regB.data.token as string;
    const schoolB = (regB.data.school?.id || regB.data.activeSchool?.id || regB.data.activeSchoolId) as string;

    // ------------------------------------------------------------------
    // 2. API TESTS: Edit/Rename Session & Term, Active Sync, Delete Guard, IDOR, Exam Edit
    // ------------------------------------------------------------------
    const listSes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, tokenA, schoolA);
    assert.strictEqual(listSes.status, 200);
    let activeSes = listSes.data.sessions?.[0];
    if (!activeSes) {
      const created = await apiReq(
        TEST_BASE,
        'POST',
        '/api/v1/school/academic-sessions',
        { name: '2025/2026', status: 'ACTIVE', auto_create_terms: true },
        tokenA,
        schoolA
      );
      assert.strictEqual(created.status, 201);
      activeSes = created.data.session;
    }

    // Rename active session to 2027/2028
    const renameRes = await apiReq(
      TEST_BASE,
      'PUT',
      `/api/v1/school/academic-sessions/${activeSes.id}`,
      { name: '2027/2028', start_date: '2027-09-01', end_date: '2028-07-31', status: 'ACTIVE' },
      tokenA,
      schoolA
    );
    assert.strictEqual(renameRes.status, 200, `Rename session failed: ${JSON.stringify(renameRes.data)}`);
    assert.strictEqual(renameRes.data.session.name, '2027/2028');

    // Verify school_settings.current_academic_session auto-synced to 2027/2028
    const meA = await apiReq(TEST_BASE, 'GET', '/api/v1/auth/me', undefined, tokenA, schoolA);
    assert.strictEqual(meA.data.activeSettings?.current_academic_session, '2027/2028');

    // Cross-tenant IDOR check: Tenant B cannot modify or delete Tenant A's session!
    const idorPut = await apiReq(
      TEST_BASE,
      'PUT',
      `/api/v1/school/academic-sessions/${activeSes.id}`,
      { name: 'HACKED/9999' },
      tokenB,
      schoolB
    );
    assert.strictEqual(idorPut.status, 404, 'Cross-tenant session edit MUST fail with 404');

    const idorDel = await apiReq(
      TEST_BASE,
      'DELETE',
      `/api/v1/school/academic-sessions/${activeSes.id}`,
      undefined,
      tokenB,
      schoolB
    );
    assert.strictEqual(idorDel.status, 404, 'Cross-tenant session delete MUST fail with 404');

    // Rename 1st Semester -> Harmattan Semester & verify active term sync
    const firstTerm = renameRes.data.session.terms?.[0];
    assert.ok(firstTerm, 'Expected at least 1 semester');
    const renameTermRes = await apiReq(
      TEST_BASE,
      'PUT',
      `/api/v1/school/academic-sessions/${activeSes.id}/terms/${firstTerm.id}`,
      { name: 'Harmattan Semester', status: 'ACTIVE' },
      tokenA,
      schoolA
    );
    assert.strictEqual(renameTermRes.status, 200);
    assert.strictEqual(renameTermRes.data.term.name, 'Harmattan Semester');

    // Create an unused future session 2030/2031, verify duplicate name guard, then safely delete it
    const futureSes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/academic-sessions',
      { name: '2030/2031', status: 'UPCOMING', auto_create_terms: true },
      tokenA,
      schoolA
    );
    assert.strictEqual(futureSes.status, 201);
    const dupRename = await apiReq(
      TEST_BASE,
      'PUT',
      `/api/v1/school/academic-sessions/${futureSes.data.session.id}`,
      { name: '2027/2028' },
      tokenA,
      schoolA
    );
    assert.strictEqual(dupRename.status, 409, 'Duplicate session name must return 409');

    const delUnused = await apiReq(
      TEST_BASE,
      'DELETE',
      `/api/v1/school/academic-sessions/${futureSes.data.session.id}`,
      undefined,
      tokenA,
      schoolA
    );
    assert.strictEqual(delUnused.status, 200);

    // Seed a class + exam linked to 2027/2028, verify DELETE returns 409 SESSION_IN_USE
    const clsRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/classes',
      { name: 'Year 1 (100L)', level: '100L', arms: ['Family Healthcare'] },
      tokenA,
      schoolA
    );
    assert.strictEqual(clsRes.status, 201);
    const clsId = clsRes.data.class.id as string;

    const exRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/examinations',
      {
        title: 'Initial Draft Exam',
        academic_session_id: activeSes.id,
        term_id: firstTerm.id,
        class_id: clsId,
        department: 'Family Healthcare',
        ca_max_score: 30,
        exam_max_score: 70,
      },
      tokenA,
      schoolA
    );
    assert.strictEqual(exRes.status, 201);
    const examId = exRes.data.examination.id as string;

    const delInUse = await apiReq(
      TEST_BASE,
      'DELETE',
      `/api/v1/school/academic-sessions/${activeSes.id}`,
      undefined,
      tokenA,
      schoolA
    );
    assert.strictEqual(delInUse.status, 409, 'Deleting a session with linked exams MUST return 409');

    // Test upgraded PUT /examinations/:id (clear class_id to null, update department & CA/Exam max)
    const editEx = await apiReq(
      TEST_BASE,
      'PUT',
      `/api/v1/school/examinations/${examId}`,
      {
        title: 'Updated Exam 40/60',
        class_id: null,
        department: null,
        ca_max_score: 40,
        exam_max_score: 60,
      },
      tokenA,
      schoolA
    );
    assert.strictEqual(editEx.status, 200);
    assert.strictEqual(editEx.data.examination.class_id, null, 'PUT /examinations/:id must allow clearing class_id to All Levels');
    assert.strictEqual(Number(editEx.data.examination.ca_max_score), 40);
    assert.strictEqual(Number(editEx.data.examination.exam_max_score), 60);

    console.log('2. API checks passed: Session/Term Edit & Delete guards, Active calendar sync, IDOR 404, & Exam PUT');

    // ------------------------------------------------------------------
    // 3. HEADLESS CHROMIUM: Desktop + Mobile 360px/390px Full Workflow
    // ------------------------------------------------------------------
    const chromeBin = findChromeBinary();
    const debugPort = 9441;
    chromeProc = spawn(
      chromeBin,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        'about:blank',
      ],
      { stdio: 'ignore' }
    );
    cdp = await CDPClient.connect(debugPort);
    await cdp.setViewport(1440, 900);
    await cdp.navigate(`${TEST_BASE}/login`);
    await cdp.waitFor(`() => Boolean(document.querySelector('input[type="email"]'))`, 'Login screen');

    await cdp.eval(`(() => {
      const email = document.querySelector('input[type="email"]');
      const pwd = document.querySelector('input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(email, ${JSON.stringify(emailA)});
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwd, ${JSON.stringify(password)});
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('button[type="submit"]').click();
    })()`);

    await cdp.waitFor(`() => (document.body.textContent || '').includes('Session 2027/2028')`, 'Dashboard shows synced Session 2027/2028');

    // 3a. Academic Sessions View: Edit Session 2027/2028 -> 2028/2029 & Create Future 2035/2036 (auto-date sync!)
    await cdp.clickButtonText('Sessions');
    await cdp.waitFor(`() => (document.body.textContent || '').includes('2027/2028 Session')`, 'Sessions list rendered');

    await cdp.clickButtonText('Edit Session');
    await cdp.waitFor(`() => Boolean(document.querySelector('body > [role="dialog"] input[aria-label="Academic Session Name"]'))`, 'Edit Session modal opened');
    await cdp.eval(`(() => {
      const inp = document.querySelector('body > [role="dialog"] input[aria-label="Academic Session Name"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '2028/2029');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.clickButtonText('Save Changes', true, true);
    await cdp.waitFor(
      `() => !document.querySelector('body > [role="dialog"]') && (document.body.textContent || '').includes('2028/2029 Session') && (document.body.textContent || '').includes('Session 2028/2029')`,
      'Edited session renamed to 2028/2029 and top header badge updated live'
    );

    // Create 2035/2036 session & verify automatic date derivation (2035-09-01 to 2036-07-31)!
    await cdp.clickButtonText('New Academic Session');
    await cdp.waitFor(`() => Boolean(document.querySelector('body > [role="dialog"] input[aria-label="Academic Session Name"]'))`, 'New Session modal opened');
    const derivedDates = await cdp.eval<{ start: string; end: string }>(`(() => {
      const dlg = document.querySelector('body > [role="dialog"]');
      const inp = dlg.querySelector('input[aria-label="Academic Session Name"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '2035/2036');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const dates = Array.from(dlg.querySelectorAll('input[type="date"]'));
      return { start: dates[0]?.value || '', end: dates[1]?.value || '' };
    })()`);
    assert.strictEqual(derivedDates.start, '2035-09-01', `Expected auto-derived start 2035-09-01, got ${derivedDates.start}`);
    assert.strictEqual(derivedDates.end, '2036-07-31', `Expected auto-derived end 2036-07-31, got ${derivedDates.end}`);
    await cdp.clickButtonText('Create Session', true, true);
    await cdp.waitFor(`() => (document.body.textContent || '').includes('2035/2036 Session')`, '2035/2036 session created');
    console.log('3. Sessions UI: Edited 2027/2028 -> 2028/2029 (live header sync) & created 2035/2036 with auto-derived dates');

    // 3b. Mobile 360x780 — Exact User Screenshot Flow: New Examination -> Custom Session 2037/2038 -> Edit Exam & Inline Rename 2037/2038 -> 2038/2039!
    await cdp.setViewport(360, 780);
    await new Promise((r) => setTimeout(r, 250));
    await cdp.clickButtonText('Performance');
    await cdp.waitFor(`() => (document.body.textContent || '').includes('Examinations & Scores')`, 'Performance loaded');
    await cdp.clickButtonText('Examinations & Scores');
    await cdp.waitFor(`() => (document.body.textContent || '').includes('New Examination')`, 'Examinations tab loaded');

    await cdp.clickButtonText('New Examination');
    await cdp.waitFor(`() => Boolean(document.querySelector('body > [role="dialog"] select[aria-label="Examination Academic Session"]'))`, 'Create Exam modal opened');

    // Verify zero horizontal overflow on 360px phone screen
    const examModalFit = await cdp.eval<{ overflow: boolean; rightDiff: number }>(`(() => {
      const box = document.querySelector('body > [role="dialog"] > div');
      const rect = box.getBoundingClientRect();
      return { overflow: rect.right > window.innerWidth + 1, rightDiff: Math.round(rect.right - window.innerWidth) };
    })()`);
    assert.strictEqual(examModalFit.overflow, false, `Create Exam modal overflowed 360px viewport: ${JSON.stringify(examModalFit)}`);

    // Pick "+ Add / Type Custom Session" and create exam for 2037/2038!
    await cdp.eval(`(() => {
      const dlg = document.querySelector('body > [role="dialog"]');
      const setVal = (el, val) => {
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const titleInput = dlg.querySelector('input[type="text"]');
      setVal(titleInput, '2037/2038 Clinical Exam');
      const sessSel = dlg.querySelector('select[aria-label="Examination Academic Session"]');
      setVal(sessSel, '__CUSTOM__');
    })()`);
    await new Promise((r) => setTimeout(r, 200));

    await cdp.eval(`(() => {
      const dlg = document.querySelector('body > [role="dialog"]');
      const setVal = (el, val) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const customSess = dlg.querySelector('input[aria-label="Custom Examination Academic Session"]');
      assert: if (!customSess) throw new Error('Custom session input did not render');
      setVal(customSess, '2037/2038');
    })()`);

    await cdp.clickButtonText('Create Examination', true, true);
    await cdp.waitFor(
      `() => !document.querySelector('body > [role="dialog"]') && (document.body.textContent || '').includes('2037/2038 Clinical Exam') && (document.body.textContent || '').includes('2037/2038')`,
      'Exam created directly for brand-new custom session 2037/2038'
    );

    // Edit that exam & rename 2037/2038 -> 2038/2039 inline inside the Edit Examination modal!
    await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => (r.textContent || '').includes('2037/2038 Clinical Exam'));
      if (!row) throw new Error('Exam row not found');
      const editBtn = Array.from(row.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'Edit');
      if (!editBtn) throw new Error('Edit button not found on exam row');
      editBtn.click();
    })()`);
    await cdp.waitFor(`() => Boolean(document.querySelector('body > [role="dialog"]')?.textContent?.includes('Edit Examination Assessment'))`, 'Edit Exam modal opened');
    await cdp.clickButtonText('Edit / Rename', false, true);
    await cdp.waitFor(`() => Boolean(document.querySelector('body > [role="dialog"] input[aria-label="Rename Selected Academic Session"]'))`, 'Inline rename session input visible');
    await cdp.eval(`(() => {
      const inp = document.querySelector('body > [role="dialog"] input[aria-label="Rename Selected Academic Session"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '2038/2039');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.clickButtonText('Save Session Name', true, true);
    await cdp.waitFor(
      `() => {
        const sel = document.querySelector('body > [role="dialog"] select[aria-label="Examination Academic Session"]');
        return Boolean(sel && Array.from(sel.options).some(o => (o.textContent || '').includes('2038/2039')));
      }`,
      'Session renamed to 2038/2039 right inside Examination modal'
    );
    await cdp.clickButtonText('Save Changes', true, true);
    await cdp.waitFor(`() => !document.querySelector('body > [role="dialog"]') && (document.body.textContent || '').includes('2038/2039')`, 'Updated exam reflects 2038/2039');
    console.log('4. Mobile 360x780: Created exam for custom 2037/2038 & renamed session inline to 2038/2039 with zero clipping');

    // 3c. School Settings: Free-editable Current Academic Session accepts 2035/2036 (was previously hardcoded to 2027/2028 max!)
    await cdp.setViewport(1440, 900);
    await new Promise((r) => setTimeout(r, 200));
    await cdp.clickButtonText('Settings');
    await cdp.waitFor(`() => Boolean(document.querySelector('input[name="current_academic_session"]'))`, 'School Settings editable session input loaded');
    await cdp.eval(`(() => {
      const inp = document.querySelector('input[name="current_academic_session"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '2035/2036');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.clickButtonText('Save');
    await cdp.waitFor(`() => (document.body.textContent || '').includes('Session 2035/2036')`, 'Top header updated to Session 2035/2036 from School Settings');
    console.log('5. School Settings: Freely saved future session 2035/2036 (no hardcoded 2027/2028 ceiling)');

    // 3d. Levels & Departments (Classes) Portal Modal Check
    await cdp.clickButtonText('Levels & Departments');
    await cdp.waitFor(`() => (document.body.textContent || '').includes('Year 1 (100L)')`, 'Levels & Departments view loaded');
    await cdp.clickButtonText('Add', false, false);
    await cdp.waitFor(`() => Boolean(document.querySelector('body > [role="dialog"]'))`, 'Levels & Departments modal mounts cleanly in document.body via ModalPortal');
    await cdp.closeDialogByEscape();
    console.log('6. Levels & Departments modal verified in document.body via ModalPortal');

    assert.strictEqual(cdp.pageErrors.length, 0, `Unexpected page errors: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `Unexpected 5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('✅ ALL SESSION EDITING, CUSTOM FUTURE YEARS (2027/2028, 2035/2036+), MOBILE 360px & PORTAL E2E CHECKS PASSED!');
  } finally {
    if (cdp) cdp.close();
    await stopChild(chromeProc);
    await stopChild(serverProc);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

run().catch((err) => {
  console.error('❌ E2E FAILED:', err);
  process.exit(1);
});
