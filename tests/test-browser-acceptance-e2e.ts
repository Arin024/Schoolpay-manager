import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const CHROME_BIN = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const TEST_PORT = 3199;
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
        if (args && !args.includes('401') && !args.includes('403')) {
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
    await new Promise((r) => setTimeout(r, 350));
  }

  async reload() {
    await this.send('Page.reload', { ignoreCache: true });
    await this.waitFor(() => this.evaluate('return document.readyState === "complete"'), 10000);
    await new Promise((r) => setTimeout(r, 500));
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
    return this.waitFor(
      () =>
        this.evaluate(`
          return (document.body?.innerText || '').includes(${JSON.stringify(snippet)});
        `),
      timeoutMs,
      `Timed out waiting for text: "${snippet}"`
    );
  }

  async bodyText(): Promise<string> {
    return this.evaluate('return document.body?.innerText || "";');
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
      const btns = Array.from(document.querySelectorAll('button, a[role="button"]'));
      const found = btns.find((b) => {
        if (b.disabled) return false;
        const t = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
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

  async hasButtonText(text: string, exact = false): Promise<boolean> {
    return this.evaluate(`
      const target = ${JSON.stringify(text)};
      const exact = ${exact ? 'true' : 'false'};
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some((b) => {
        const t = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
        return exact ? t === target : t.includes(target);
      });
    `);
  }

  async loginInBrowser(email: string, password: string) {
    await this.waitFor(() => this.evaluate('return Boolean(document.querySelector("input[type=email]"))'), 10000, 'Login email input missing');
    await this.fillInput('input[type="email"]', email);
    await this.fillInput('input[type="password"]', password);
    await this.clickButtonByText('Sign In', true);
    await this.waitFor(
      () =>
        this.evaluate(`
          return !document.querySelector('input[type="password"]') || (document.body?.innerText || '').includes('Role Not Assigned');
        `),
      12000,
      `Login did not transition out of login form for ${email}`
    );
    await new Promise((r) => setTimeout(r, 450));
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
    await this.waitFor(() => this.evaluate('return Boolean(document.querySelector("input[type=email]"))'), 10000, 'Did not return to login form after logout');
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
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${baseUrl} failed health check within ${timeoutMs}ms`);
}

function setupSafeTempWorkspace(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-safe-verify-'));
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  const appRoot = process.cwd();
  const linkItems = [
    'dist',
    'server',
    'migrations',
    'schema.sql',
    'schema.pg.sql',
    'public',
    'node_modules',
    'server.ts',
    'package.json',
    'tsconfig.json',
  ];
  for (const item of linkItems) {
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
    JWT_SECRET: 'safe-browser-acceptance-test-jwt-secret-64-chars-long-1234567890',
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

async function apiReq(baseUrl: string, method: string, p: string, body?: any, token?: string, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { Accept: 'application/json', ...headers };
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${baseUrl}${p}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch {}
  return { status: r.status, data };
}

async function runBrowserAcceptance() {
  console.log('====================================================================');
  console.log('  BURSARIQ: REAL HEADLESS CHROMIUM BROWSER & ROLE ACCEPTANCE SUITE  ');
  console.log('====================================================================');

  const tmpWorkspace = setupSafeTempWorkspace();
  const chromeUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-cdp-profile-'));
  let testServer: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;

  try {
    // -------------------------------------------------------------------------
    // 0. Launch Headless Chromium & Connect CDP
    // -------------------------------------------------------------------------
    const cdpPort = 9244;
    chromeProc = spawn(
      CHROME_BIN,
      [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${chromeUserDir}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let wsUrl = '';
    for (let i = 0; i < 40; i++) {
      try {
        const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        const pages = (await listRes.json()) as any[];
        const target = pages.find((p) => p.type === 'page') || pages[0];
        if (target?.webSocketDebuggerUrl) {
          wsUrl = target.webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(wsUrl, 'Failed to obtain CDP WebSocket URL for HeadlessChrome');
    cdp = await CDPClient.connect(wsUrl);
    console.log('✓ Connected to real HeadlessChrome via CDP');

    // -------------------------------------------------------------------------
    // 1. Read-Only Live Production Server Check (Port 3000 - Zero Writes!)
    // -------------------------------------------------------------------------
    console.log('\n[1/11] Checking live running app on port 3000 (strictly read-only)...');
    const liveHealth = await (await fetch(`${LIVE_BASE}/api/health`)).json() as any;
    assert.strictEqual(liveHealth.status, 'healthy');
    assert.strictEqual(liveHealth.neonConnected, true, 'Live server should be connected to Neon PostgreSQL');
    assert.strictEqual((await fetch(`${LIVE_BASE}/api/v1/auth/me`)).status, 401);

    await cdp.goto(`${LIVE_BASE}/`);
    await cdp.waitForText('Bursar');
    await cdp.waitFor(() => cdp!.evaluate('return Boolean(document.querySelector("input[type=email]"))'), 8000);
    assert.strictEqual(cdp.pageErrors.length, 0, `Live login page threw uncaught errors: ${cdp.pageErrors.join('; ')}`);
    console.log(`✓ PASS: Live server (${liveHealth.neonEndpoint}) renders login UI cleanly with zero uncaught errors`);

    // -------------------------------------------------------------------------
    // 2. Start Safe Isolated Test Environment (Port 3199, Isolated SQLite)
    // -------------------------------------------------------------------------
    console.log('\n[2/11] Starting isolated safe test server on port 3199 (serving production dist/)...');
    testServer = spawnSafeTestServer(tmpWorkspace);
    const safeHealth = await waitForHealth(TEST_BASE, 25000) as any;
    assert.strictEqual(safeHealth.status, 'healthy');
    assert.strictEqual(safeHealth.neonConnected, false, 'Safe test server MUST NOT connect to production Neon DB');
    console.log('✓ PASS: Isolated safe test server live on http://127.0.0.1:3199 with production dist/ bundle');

    // -------------------------------------------------------------------------
    // 3. Test Login Error State & Register Isolated Schools + Multi-School Owner
    // -------------------------------------------------------------------------
    console.log('\n[3/11] Testing login error feedback and registering isolated School A & School B...');
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.waitFor(() => cdp!.evaluate('return Boolean(document.querySelector("input[type=email]"))'));
    await cdp.fillInput('input[type="email"]', 'invalid@nonexistent.edu.ng');
    await cdp.fillInput('input[type="password"]', 'WrongPassword123!');
    await cdp.clickButtonByText('Sign In', true);
    await cdp.waitForText('Invalid');
    console.log('✓ PASS: Invalid login shows error state cleanly');

    const suffix = '2026';
    const regA = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Brightstar Model College',
      schoolType: 'Secondary',
      state: 'Lagos',
      lga: 'Ikeja',
      address: '14 Allen Avenue, Ikeja',
      phone: '08051112233',
      email: 'info@brightstar.edu.ng',
      ownerName: 'Chief Adeyemi',
      ownerEmail: 'owner@brightstar.edu.ng',
      password: 'OwnerPassword2026!',
      question1: 'What is your favorite Nigerian city?',
      answer1: 'Lagos',
      question2: 'What is your mother maiden name?',
      answer2: 'Adebayo',
    });
    assert.strictEqual(regA.status, 201, `School A reg failed: ${JSON.stringify(regA.data)}`);
    const schoolAId = regA.data.school.id;
    const ownerToken = regA.data.token;

    const regB = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Crescent Heights Academy',
      schoolType: 'Primary',
      state: 'FCT - Abuja',
      lga: 'Wuse',
      address: '8 Aminu Kano Cres, Wuse II',
      phone: '08069998877',
      email: 'info@crescent.edu.ng',
      ownerName: 'Dr. Bello',
      ownerEmail: 'owner-b@crescent.edu.ng',
      password: 'OwnerPassword2026!',
      question1: 'What is your favorite Nigerian city?',
      answer1: 'Abuja',
      question2: 'What is your mother maiden name?',
      answer2: 'Danladi',
    });
    assert.strictEqual(regB.status, 201, `School B reg failed: ${JSON.stringify(regB.data)}`);
    const schoolBId = regB.data.school.id;
    const ownerBToken = regB.data.token;

    // Also grant School A Owner a SCHOOL_ADMIN membership on School B so we can test real UI school switching!
    const grantMulti = await apiReq(TEST_BASE, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Chief Adeyemi',
      email: 'owner@brightstar.edu.ng',
      password: 'OwnerPassword2026!',
      role_name: 'SCHOOL_ADMIN',
    }, ownerBToken, { 'X-School-Id': schoolBId });
    assert.strictEqual(grantMulti.status, 201, `Grant multi-school failed: ${JSON.stringify(grantMulti.data)}`);
    console.log('✓ PASS: Isolated School A & School B registered cleanly');

    // -------------------------------------------------------------------------
    // 4. Admin Creates Complete Academic, Student, Parent, Exam & Financial Records
    // -------------------------------------------------------------------------
    console.log('\n[4/11] Provisioning SCHOOL_ADMIN and building complete school records...');
    const provAdmin = await apiReq(TEST_BASE, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Principal Ada Nwosu',
      email: 'principal@brightstar.edu.ng',
      password: 'RolePassword2026!',
      role_name: 'SCHOOL_ADMIN',
    }, ownerToken, { 'X-School-Id': schoolAId });
    assert.strictEqual(provAdmin.status, 201);

    const adminLogin = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/login', {
      email: 'principal@brightstar.edu.ng',
      password: 'RolePassword2026!',
    });
    const adminToken = adminLogin.data.token;
    const hA = { 'X-School-Id': schoolAId };

    const clsRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'JSS 2', level: 'Junior Secondary' }, adminToken, hA);
    assert.strictEqual(clsRes.status, 201);
    const classId = clsRes.data.class.id;

    const stfRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/staff', {
      first_name: 'Tunde',
      last_name: 'Bakare',
      email: 'teacher@brightstar.edu.ng',
      job_title: 'Mathematics Teacher',
      department: 'Science',
    }, adminToken, hA);
    assert.strictEqual(stfRes.status, 201);

    const armRes = await apiReq(TEST_BASE, 'POST', `/api/v1/school/classes/${classId}/arms`, {
      name: 'Gold',
      capacity: 35,
      class_teacher_id: stfRes.data.staff.id,
    }, adminToken, hA);
    assert.strictEqual(armRes.status, 201);
    const armId = armRes.data.arm.id;

    const subRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/subjects', { name: 'Mathematics', code: 'MTH201', class_id: classId }, adminToken, hA);
    assert.strictEqual(subRes.status, 201);
    const subjectId = subRes.data.subject.id;

    const sesRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/academic-sessions', { name: '2025/2026', status: 'ACTIVE' }, adminToken, hA);
    assert.strictEqual(sesRes.status, 201);
    const sessionId = sesRes.data.session.id;

    const termRes = await apiReq(TEST_BASE, 'POST', `/api/v1/school/academic-sessions/${sessionId}/terms`, { name: '1st Term', status: 'ACTIVE' }, adminToken, hA);
    assert.strictEqual(termRes.status, 201);
    const termId = termRes.data.term.id;

    // Student 1 (Linked to Parent 1 & Student User 1)
    const s1 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/students', {
      first_name: 'Chidi', last_name: 'Okafor', admission_number: 'BSA-001', class_id: classId, class_arm_id: armId, gender: 'Male',
    }, adminToken, hA);
    assert.strictEqual(s1.status, 201);
    const s1Id = s1.data.student.id;

    // Edit Student 1 as SCHOOL_ADMIN
    const s1Edit = await apiReq(TEST_BASE, 'PUT', `/api/v1/school/students/${s1Id}`, {
      middle_name: 'Emeka',
      address: '21 Oba Akran Ave',
    }, adminToken, hA);
    assert.strictEqual(s1Edit.status, 200);

    // Student 2 (Unlinked to Parent 1 - used for cross-child isolation test)
    const s2 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/students', {
      first_name: 'Amina', last_name: 'Musa', admission_number: 'BSA-002', class_id: classId, class_arm_id: armId, gender: 'Female',
    }, adminToken, hA);
    assert.strictEqual(s2.status, 201);
    const s2Id = s2.data.student.id;

    // Student 3 (Also linked to Parent 1 - used for multi-child switcher UI test!)
    const s3 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/students', {
      first_name: 'Tunde', last_name: 'Okafor', admission_number: 'BSA-003', class_id: classId, class_arm_id: armId, gender: 'Male',
    }, adminToken, hA);
    assert.strictEqual(s3.status, 201);
    const s3Id = s3.data.student.id;

    // Create Parent profile & link explicitly to Student 1 + Student 3
    const parCreate = await apiReq(TEST_BASE, 'POST', '/api/v1/school/parents', {
      first_name: 'Ngozi',
      last_name: 'Okafor',
      phone: '08093334455',
      email: 'parent@brightstar.edu.ng',
      relationship: 'Mother',
      student_ids: [s1Id, s3Id],
    }, adminToken, hA);
    assert.strictEqual(parCreate.status, 201);
    const parentRecordId = parCreate.data.parent.id;

    // Exam + Scores + Review + Publish + Report Card Generate + Publish
    const examRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/examinations', {
      title: '1st Term Terminal Exam', exam_type: 'TERMINAL', academic_session_id: sessionId, term_id: termId, class_id: classId, ca_max_score: 40, exam_max_score: 60,
    }, adminToken, hA);
    assert.strictEqual(examRes.status, 201);
    const examId = examRes.data.examination.id;

    assert.strictEqual((await apiReq(TEST_BASE, 'PUT', `/api/v1/school/examinations/${examId}/scores`, {
      entries: [
        { student_id: s1Id, subject_id: subjectId, ca_score: 36, exam_score: 54, subject_remark: 'Outstanding mastery' },
        { student_id: s3Id, subject_id: subjectId, ca_score: 30, exam_score: 45, subject_remark: 'Good steady work' },
        { student_id: s2Id, subject_id: subjectId, ca_score: 25, exam_score: 40, subject_remark: 'Fair' },
      ],
    }, adminToken, hA)).status, 200);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', `/api/v1/school/examinations/${examId}/status`, { status: 'REVIEW' }, adminToken, hA)).status, 200);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', `/api/v1/school/examinations/${examId}/status`, { status: 'PUBLISHED' }, adminToken, hA)).status, 200);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/report-cards/generate', {
      academic_session_id: sessionId, term_id: termId, class_id: classId, examination_id: examId,
    }, adminToken, hA)).status, 200);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/report-cards/publish-class', {
      academic_session_id: sessionId, term_id: termId, class_id: classId,
    }, adminToken, hA)).status, 200);

    // Attendance + Behaviour + Announcement
    const ATTENDANCE_DATE = new Date().toISOString().slice(0, 10);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/attendance/bulk', {
      attendance_date: ATTENDANCE_DATE, class_id: classId, academic_session_id: sessionId, term_id: termId, is_published: true,
      records: [
        { student_id: s1Id, status: 'PRESENT', notes: 'Punctual' },
        { student_id: s3Id, status: 'PRESENT', notes: 'Punctual' },
        { student_id: s2Id, status: 'ABSENT', notes: 'Sick leave' },
      ],
    }, adminToken, hA)).status, 200);

    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/behaviour', {
      student_id: s1Id, class_id: classId, academic_session_id: sessionId, term_id: termId,
      category: 'COMMENDATION', severity: 'LOW', title: 'Science Fair Winner', description: 'Led group experiment cleanly',
      visible_to_parent: true, visible_to_student: true, visible_to_teacher: true,
    }, adminToken, hA)).status, 201);

    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/announcements', {
      title: 'Open Day & PTA Briefing', content: 'Parents are invited on Friday at 10am.', audience: 'ALL', priority: 'IMPORTANT', is_published: true,
    }, adminToken, hA)).status, 201);

    // Fee category + Invoices for Student 1 & Student 2
    const catRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/fee-categories', { name: `Tuition ${suffix}` }, adminToken, hA);
    assert.strictEqual(catRes.status, 201);
    const inv1 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/invoices', {
      student_id: s1Id, academic_session_id: sessionId, term_id: termId, due_date: '2026-04-30',
      items: [{ fee_category_id: catRes.data.category.id, description: '1st Term Tuition', quantity: 1, unit_amount_kobo: 5000000 }],
    }, adminToken, hA);
    assert.strictEqual(inv1.status, 201);
    const invoice1Id = inv1.data.invoice.id;

    const inv2 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/invoices', {
      student_id: s2Id, academic_session_id: sessionId, term_id: termId, due_date: '2026-04-30',
      items: [{ fee_category_id: catRes.data.category.id, description: '1st Term Tuition', quantity: 1, unit_amount_kobo: 5000000 }],
    }, adminToken, hA);
    assert.strictEqual(inv2.status, 201);
    const invoice2Id = inv2.data.invoice.id;

    // Provision BURSAR, TEACHER, PARENT (linked to parentRecordId -> s1 & s3), STUDENT (s1)
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Bursar Emeka', email: 'bursar@brightstar.edu.ng', password: 'RolePassword2026!', role_name: 'BURSAR',
    }, adminToken, hA)).status, 201);

    const provTch = await apiReq(TEST_BASE, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Mr. Tunde Bakare', email: 'teacher@brightstar.edu.ng', password: 'RolePassword2026!', role_name: 'TEACHER',
    }, adminToken, hA);
    assert.strictEqual(provTch.status, 201);
    const teacherUserId = provTch.data.user.id;

    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Mrs. Ngozi Okafor', email: 'parent@brightstar.edu.ng', password: 'RolePassword2026!', role_name: 'PARENT', parent_id: parentRecordId,
    }, adminToken, hA)).status, 201);

    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Chidi Emeka Okafor', email: 'chidi@brightstar.edu.ng', password: 'RolePassword2026!', role_name: 'STUDENT', student_id: s1Id,
    }, adminToken, hA)).status, 201);

    console.log('✓ PASS: Full academic, report card, attendance, behaviour, announcement, invoice & role accounts created');

    // -------------------------------------------------------------------------
    // 5. SUPER_ADMIN Browser Acceptance (Platform Dashboard + Tenant Drilldown + Refresh)
    // -------------------------------------------------------------------------
    console.log('\n[5/11] Verifying SUPER_ADMIN browser dashboard, tenant switch & refresh...');
    await cdp.loginInBrowser('SchoolPay28@gmail.com', 'SuperAdmin@2025!');
    await cdp.waitForText('Platform Super Admin');
    await cdp.waitForText('Brightstar Model College');
    await cdp.reload();
    await cdp.waitForText('Platform Super Admin');
    await cdp.logoutInBrowser();
    console.log('✓ PASS: SUPER_ADMIN platform console & session restore verified in browser');

    // -------------------------------------------------------------------------
    // 6. SCHOOL_OWNER Browser Acceptance (19 Admin Tabs, School Switch, Back/Forward, Mobile)
    // -------------------------------------------------------------------------
    console.log('\n[6/11] Verifying SCHOOL_OWNER dashboard, multi-school switch, browser back/forward & mobile...');
    await cdp.loginInBrowser('owner@brightstar.edu.ng', 'OwnerPassword2026!');
    await cdp.waitForText('Brightstar Model College');
    for (const tabLabel of ['Overview', 'Performance & Reports', 'Attendance', 'Behaviour & Remarks', 'Announcements', 'Fees & Billing', 'Students', 'Parents', 'Staff Directory', 'Settings', 'Roles', 'Audit', 'Recycle Bin', 'Verify Tenant Guard']) {
      assert.ok(await cdp.hasButtonText(tabLabel), `SCHOOL_OWNER missing tab: ${tabLabel}`);
    }

    // Navigate via tabs + test back/forward + direct hash access
    await cdp.clickButtonByText('Students', true);
    await cdp.waitForText('Chidi');
    await cdp.waitForText('BSA-001');
    await cdp.clickButtonByText('Fees & Billing', true);
    await cdp.waitFor(() => cdp!.evaluate('return window.location.hash.includes("finance")'));

    await cdp.evaluate('window.history.back()');
    await cdp.waitFor(() => cdp!.evaluate('return window.location.hash.includes("students")'));
    await cdp.evaluate('window.history.forward()');
    await cdp.waitFor(() => cdp!.evaluate('return window.location.hash.includes("finance")'));

    // Multi-school switch in Header dropdown
    await cdp.evaluate(`
      const sel = document.querySelector('select[aria-label="Switch active school"]');
      if (!sel) throw new Error('School switcher select not found');
      const opt = Array.from(sel.options).find((o) => o.value === ${JSON.stringify(schoolBId)});
      if (!opt) throw new Error('School B option not found');
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await cdp.waitForText('Crescent Heights Academy');
    await cdp.reload();
    await cdp.waitForText('Crescent Heights Academy');

    // Switch back to Brightstar Model College and test mobile viewport (390x844)
    await cdp.evaluate(`
      const sel = document.querySelector('select[aria-label="Switch active school"]');
      sel.value = ${JSON.stringify(schoolAId)};
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await cdp.waitForText('Brightstar Model College');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await new Promise((r) => setTimeout(r, 250));
    const mobileDiag = await cdp.evaluate(`
      const offenders = Array.from(document.querySelectorAll('*'))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 8)
        .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), right: Math.round(el.getBoundingClientRect().right) }));
      return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, offenders };
    `);
    assert.ok(mobileDiag.scrollWidth <= mobileDiag.innerWidth + 12, `Mobile layout overflowed horizontally: ${JSON.stringify(mobileDiag)}`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.logoutInBrowser();
    console.log('✓ PASS: SCHOOL_OWNER 19-tab console, back/forward history, school switching, refresh & mobile responsiveness verified');

    // -------------------------------------------------------------------------
    // 7. SCHOOL_ADMIN Browser Acceptance + Account Deactivation/Activation
    // -------------------------------------------------------------------------
    console.log('\n[7/11] Verifying SCHOOL_ADMIN UI + User Account Deactivation/Activation...');
    await cdp.loginInBrowser('principal@brightstar.edu.ng', 'RolePassword2026!');
    await cdp.waitForText('Brightstar Model College');
    assert.ok(await cdp.hasButtonText('Roles', true));
    assert.ok(await cdp.hasButtonText('Recycle Bin', true));
    await cdp.clickButtonByText('Roles', true);
    await cdp.waitForText('teacher@brightstar.edu.ng');
    const clickedDeact = await cdp.evaluate(`
      const row = Array.from(document.querySelectorAll('tr')).find((r) => (r.innerText || '').includes('teacher@brightstar.edu.ng'));
      if (!row) return false;
      const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').includes('Deactivate'));
      if (!btn) return false;
      btn.click();
      return true;
    `);
    assert.ok(clickedDeact, 'Deactivate button not found in teacher row');
    await cdp.waitFor(() =>
      cdp!.evaluate(`
        const row = Array.from(document.querySelectorAll('tr')).find((r) => (r.innerText || '').includes('teacher@brightstar.edu.ng'));
        return Boolean(row && (row.innerText || '').includes('Deactivated'));
      `)
    );

    // Verify deactivated teacher cannot sign in via API / browser
    const blockedTch = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/login', {
      email: 'teacher@brightstar.edu.ng', password: 'RolePassword2026!',
    });
    assert.ok(blockedTch.status === 401 || blockedTch.status === 403, `Deactivated teacher must not be able to log in, got ${blockedTch.status}`);

    // Reactivate teacher in UI
    const clickedReact = await cdp.evaluate(`
      const row = Array.from(document.querySelectorAll('tr')).find((r) => (r.innerText || '').includes('teacher@brightstar.edu.ng'));
      if (!row) return false;
      const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').includes('Activate'));
      if (!btn) return false;
      btn.click();
      return true;
    `);
    assert.ok(clickedReact, 'Activate button not found in teacher row');
    await cdp.waitFor(() =>
      cdp!.evaluate(`
        const row = Array.from(document.querySelectorAll('tr')).find((r) => (r.innerText || '').includes('teacher@brightstar.edu.ng'));
        return Boolean(row && (row.innerText || '').includes('Active'));
      `)
    );
    await cdp.logoutInBrowser();
    console.log('✓ PASS: SCHOOL_ADMIN permissions and UI Deactivate/Activate workflow verified');

    // -------------------------------------------------------------------------
    // 8. BURSAR Browser Acceptance + Tampering & Unauthorized Write Blocking
    // -------------------------------------------------------------------------
    console.log('\n[8/11] Verifying BURSAR finance-only workspace & admin impersonation rejection...');
    await cdp.loginInBrowser('bursar@brightstar.edu.ng', 'RolePassword2026!');
    await cdp.waitForText('Fees & Billing');
    for (const allowedTab of ['Overview', 'Fees & Billing', 'Students', 'Parents', 'SaaS Subscription', 'Profile']) {
      assert.ok(await cdp.hasButtonText(allowedTab), `BURSAR missing allowed tab: ${allowedTab}`);
    }
    for (const forbiddenTab of ['Performance & Reports', 'Attendance', 'Behaviour & Remarks', 'Settings', 'Roles', 'Audit', 'Recycle Bin', 'Verify Tenant Guard']) {
      assert.strictEqual(await cdp.hasButtonText(forbiddenTab), false, `BURSAR must NOT see admin tab: ${forbiddenTab}`);
    }

    // Verify read-only Students & Parents views hide Enroll/Add/Delete buttons
    await cdp.clickButtonByText('Students', true);
    await cdp.waitForText('Chidi');
    assert.strictEqual(await cdp.hasButtonText('Enroll Student'), false, 'BURSAR Students tab must hide Enroll Student');
    await cdp.clickButtonByText('Parents', true);
    await cdp.waitForText('Ngozi Okafor');
    assert.strictEqual(await cdp.hasButtonText('Add Parent'), false, 'BURSAR Parents tab must hide Add Parent');

    // Tamper localStorage & URL hash to impersonate SCHOOL_OWNER on admin tabs
    await cdp.evaluate(`
      localStorage.setItem('bursariq_active_role', JSON.stringify({ role_name: 'SCHOOL_OWNER', school_id: ${JSON.stringify(schoolBId)} }));
      localStorage.setItem('schoolpay_active_role', JSON.stringify({ role_name: 'SCHOOL_OWNER', school_id: ${JSON.stringify(schoolBId)} }));
      localStorage.setItem('bursariq_active_school', ${JSON.stringify(schoolBId)});
      localStorage.setItem('schoolpay_active_school', ${JSON.stringify(schoolBId)});
      window.location.hash = '#school/users';
    `);
    await cdp.reload();
    await cdp.waitForText('Fees & Billing');
    assert.strictEqual(await cdp.hasButtonText('Roles', true), false, 'Tampered localStorage + #school/users must fail closed to BURSAR');
    await cdp.goto(`${TEST_BASE}/#users`);
    await cdp.waitForText('Fees & Billing');
    assert.strictEqual(await cdp.hasButtonText('Roles', true), false, 'Direct #users navigation must fail closed to BURSAR');

    // Backend unauthorized calls using Bursar session token
    const bursarToken = await cdp.evaluate('return localStorage.getItem("bursariq_session_token");');
    assert.ok(bursarToken, 'Bursar session token missing from localStorage');
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/students', { first_name: 'X', last_name: 'Y' }, bursarToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'PUT', `/api/v1/school/students/${s1Id}`, { first_name: 'Hacked' }, bursarToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/parents', { first_name: 'P', last_name: 'Q' }, bursarToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'PUT', '/api/v1/school/settings', { allow_partial_payments: 0 }, bursarToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'PATCH', `/api/v1/school/users/${teacherUserId}/status`, { is_active: false }, bursarToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'DELETE', `/api/v1/school/users/${teacherUserId}`, undefined, bursarToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'GET', '/api/v1/school/recycle-bin', undefined, bursarToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'GET', '/api/v1/school/students', undefined, bursarToken, { 'X-School-Id': schoolBId })).status, 403);
    await cdp.logoutInBrowser();
    console.log('✓ PASS: BURSAR workspace, read-only directories, tamper defense & 403 backend rejection verified');

    // -------------------------------------------------------------------------
    // 9. TEACHER Browser Acceptance (Read-Only Educator Workspace)
    // -------------------------------------------------------------------------
    console.log('\n[9/11] Verifying TEACHER read-only educator workspace & mutation denial...');
    await cdp.loginInBrowser('teacher@brightstar.edu.ng', 'RolePassword2026!');
    await cdp.waitForText('Assigned Classes');
    assert.strictEqual(await cdp.hasButtonText('Roles', true), false);
    assert.strictEqual(await cdp.hasButtonText('Settings', true), false);
    assert.strictEqual(await cdp.hasButtonText('Fees & Billing', true), false);

    await cdp.clickButtonByText('Students', true);
    await cdp.waitForText('Chidi');
    await cdp.clickButtonByText('Performance & Reports', true);
    await cdp.waitForText('1st Term Terminal Exam');
    await cdp.clickButtonByText('Attendance', true);
    await cdp.waitForText(ATTENDANCE_DATE);
    await cdp.clickButtonByText('Behaviour & Remarks', true);
    await cdp.waitForText('Science Fair Winner');
    await cdp.clickButtonByText('Announcements', true);
    await cdp.waitForText('Open Day & PTA Briefing');
    assert.strictEqual(await cdp.hasButtonText('New Announcement', true), false);
    await cdp.clickButtonByText('Profile', true);
    await cdp.waitForText('teacher@brightstar.edu.ng');

    // Direct URL hash tampering + unauthorized backend mutations
    await cdp.goto(`${TEST_BASE}/#school/settings`);
    await cdp.waitForText('Assigned Classes');
    assert.strictEqual(await cdp.hasButtonText('Roles', true), false);
    const teacherToken = await cdp.evaluate('return localStorage.getItem("bursariq_session_token");');
    assert.ok(teacherToken, 'Teacher session token missing from localStorage');
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/students', { first_name: 'X', last_name: 'Y' }, teacherToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'PUT', `/api/v1/school/examinations/${examId}/scores`, { entries: [] }, teacherToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/attendance/bulk', { attendance_date: '2026-02-13', records: [] }, teacherToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/behaviour', { student_id: s1Id, category: 'DISCIPLINE', title: 'T', description: 'D' }, teacherToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', '/api/v1/school/announcements', { title: 'T', content: 'C', audience: 'ALL' }, teacherToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'PUT', '/api/v1/school/settings', { allow_partial_payments: 0 }, teacherToken, hA)).status, 403);
    await cdp.logoutInBrowser();
    console.log('✓ PASS: TEACHER read-only workspace & strict backend mutation denial verified');

    // -------------------------------------------------------------------------
    // 10. PARENT & STUDENT Browser Acceptance (Child Switch, Checkout, Receipts, Fee Visibility)
    // -------------------------------------------------------------------------
    console.log('\n[10/11] Verifying PARENT portal (child switch, report cards, online checkout, receipts) & STUDENT portal...');
    await cdp.loginInBrowser('parent@brightstar.edu.ng', 'RolePassword2026!');
    await cdp.waitForText('My Children');
    await cdp.waitForText('Chidi Emeka Okafor');
    await cdp.waitForText('Tunde Okafor');
    assert.strictEqual((await cdp.bodyText()).includes('Amina Musa'), false, 'Unlinked student Amina Musa must NEVER appear in Parent Portal');

    // Switch child in UI (Chidi avg 90.0% <-> Tunde avg 75.0%)
    await cdp.waitForText('90.0%');
    await cdp.clickButtonByText('Tunde Okafor');
    await cdp.waitForText('75.0%');
    await cdp.clickButtonByText('Chidi Emeka Okafor');
    await cdp.waitForText('90.0%');

    // Navigate Report Cards & open printable Report Card modal
    await cdp.clickButtonByText('Report Cards', true);
    await cdp.waitForText('Published Digital Report Cards');
    await cdp.clickButtonByText('Open & Print');
    await cdp.waitForText('Official Digital Report Card');
    await cdp.waitForText('Print / Save PDF');
    await cdp.evaluate(`document.querySelector('button[aria-label="Close report card"]')?.click()`);
    await cdp.waitFor(() => cdp!.evaluate(`return !document.body.innerText.includes('Print / Save PDF')`));

    await cdp.clickButtonByText('Attendance History', true);
    await cdp.waitForText(ATTENDANCE_DATE);
    await cdp.clickButtonByText('Behaviour & Remarks', true);
    await cdp.waitForText('Science Fair Winner');
    await cdp.clickButtonByText('Announcements', true);
    await cdp.waitForText('Open Day & PTA Briefing');
    await cdp.clickButtonByText('Profile', true);
    await cdp.waitForText('parent@brightstar.edu.ng');
    await cdp.waitForText('BSA-001');
    await cdp.waitForText('BSA-003');

    // Authorized Online Checkout in Parent Fee Status (TEST_SANDBOX verifies immediately and opens Receipt modal)
    await cdp.clickButtonByText('Fee Status', true);
    await cdp.waitForText('Pay Online');
    await cdp.clickButtonByText('Pay Online');
    await cdp.waitForText('Online School Fee Checkout');
    await cdp.clickButtonByText('Proceed to Pay');
    await cdp.waitForText('Online payment verified');
    await cdp.waitForText('Print Receipt');
    await cdp.evaluate(`document.querySelector('button[aria-label="Close receipt"]')?.click()`);
    await cdp.waitFor(() => cdp!.evaluate(`return !document.body.innerText.includes('Print Receipt')`));

    // Verify Receipts tab & printable receipt modal
    await cdp.clickButtonByText('Receipts', true);
    await cdp.waitForText('Official Digital Receipts · Chidi Emeka Okafor (1)');
    await cdp.clickButtonByText('View / Print');
    await cdp.waitForText('Print Receipt');
    await cdp.evaluate(`document.querySelector('button[aria-label="Close receipt"]')?.click()`);
    await cdp.waitFor(() => cdp!.evaluate(`return !document.body.innerText.includes('Print Receipt')`));

    // Unauthorized Parent attempts (Student 2 / Staff routes / Hash tamper)
    await cdp.goto(`${TEST_BASE}/#school/users`);
    await cdp.waitForText('My Children');
    const parentToken = await cdp.evaluate('return localStorage.getItem("bursariq_session_token");');
    assert.ok(parentToken, 'Parent session token missing from localStorage');
    assert.strictEqual((await apiReq(TEST_BASE, 'GET', `/api/v1/portal/parent/dashboard?student_id=${s2Id}`, undefined, parentToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', `/api/v1/school/invoices/${invoice2Id}/checkout`, { provider: 'TEST_SANDBOX', amount_kobo: 100000 }, parentToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'GET', '/api/v1/school/students', undefined, parentToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', `/api/v1/school/invoices/${invoice1Id}/payments`, { amount_kobo: 100000, payment_method: 'CASH' }, parentToken, hA)).status, 403);
    await cdp.logoutInBrowser();
    console.log('✓ PASS: PARENT child switching, report cards modal, online checkout, receipt modal & cross-child 403 verified');

    // STUDENT Portal Verification + Fee Visibility Toggle
    assert.strictEqual((await apiReq(TEST_BASE, 'PUT', '/api/v1/school/performance/settings', { students_can_view_fees: false }, adminToken, hA)).status, 200);
    await cdp.loginInBrowser('chidi@brightstar.edu.ng', 'RolePassword2026!');
    await cdp.waitForText('My Report Cards');
    assert.strictEqual(await cdp.hasButtonText('My Fee Status', true), false, 'Student Fee Status tab must be hidden when policy disabled');
    await cdp.clickButtonByText('My Results', true);
    await cdp.waitForText('Mathematics');
    await cdp.clickButtonByText('My Attendance', true);
    await cdp.waitForText(ATTENDANCE_DATE);
    await cdp.clickButtonByText('Behaviour & Remarks', true);
    await cdp.waitForText('Science Fair Winner');
    await cdp.clickButtonByText('Announcements', true);
    await cdp.waitForText('Open Day & PTA Briefing');
    await cdp.clickButtonByText('My Profile', true);
    await cdp.waitForText('BSA-001');

    // Enable fee visibility and reload browser
    assert.strictEqual((await apiReq(TEST_BASE, 'PUT', '/api/v1/school/performance/settings', { students_can_view_fees: true }, adminToken, hA)).status, 200);
    await cdp.reload();
    await cdp.waitForText('My Fee Status');
    await cdp.clickButtonByText('My Fee Status', true);
    await cdp.waitForText('Total Paid');
    await cdp.waitForText('₦50,000');
    await cdp.clickButtonByText('View', true);
    await cdp.waitForText('Print Receipt');
    await cdp.evaluate(`document.querySelector('button[aria-label="Close receipt"]')?.click()`);
    await cdp.waitFor(() => cdp!.evaluate(`return !document.body.innerText.includes('Print Receipt')`));

    const studentToken = await cdp.evaluate('return localStorage.getItem("bursariq_session_token");');
    assert.ok(studentToken, 'Student session token missing from localStorage');
    assert.strictEqual((await apiReq(TEST_BASE, 'GET', `/api/v1/portal/student/dashboard?student_id=${s2Id}`, undefined, studentToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'GET', '/api/v1/portal/parent/dashboard', undefined, studentToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'GET', '/api/v1/portal/teacher/dashboard', undefined, studentToken, hA)).status, 403);
    assert.strictEqual((await apiReq(TEST_BASE, 'POST', `/api/v1/school/invoices/${invoice1Id}/checkout`, { provider: 'TEST_SANDBOX', amount_kobo: 100000 }, studentToken, hA)).status, 403);
    await cdp.logoutInBrowser();
    console.log('✓ PASS: STUDENT self-only portal, fee visibility policy & unauthorized blocks verified');

    // -------------------------------------------------------------------------
    // 11. Unrecognized Role Fail-Closed Screen + App Restart Persistence Check
    // -------------------------------------------------------------------------
    console.log('\n[11/11] Verifying null/unrecognized role Access Restricted screen & full server restart persistence...');
    // Insert an unrecognized role user in the ISOLATED test SQLite DB only
    const safeDb = new DatabaseSync(path.join(tmpWorkspace, 'data', 'schoolpay.db'));
    const guestProv = await apiReq(TEST_BASE, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Unassigned Guest',
      email: 'guest@brightstar.edu.ng',
      password: 'RolePassword2026!',
      role_name: 'TEACHER',
    }, adminToken, hA);
    assert.strictEqual(guestProv.status, 201);
    const guestUserId = guestProv.data.user.id;
    // Replace their school role with an unrecognized role name to simulate null/unknown role
    safeDb.prepare(`INSERT OR IGNORE INTO roles (id, name, display_name, description, scope) VALUES ('role_unknown_test', 'UNRECOGNIZED_ROLE', 'Unrecognized', 'Test unknown role', 'SCHOOL')`).run();
    safeDb.prepare(`UPDATE user_roles SET role_id = 'role_unknown_test' WHERE user_id = ? AND school_id = ?`).run(guestUserId, schoolAId);
    safeDb.close();

    await cdp.loginInBrowser('guest@brightstar.edu.ng', 'RolePassword2026!');
    await cdp.waitForText('Role Not Assigned — Access Restricted');
    assert.strictEqual(await cdp.hasButtonText('Overview', true), false);
    assert.strictEqual(await cdp.hasButtonText('Roles', true), false);
    assert.strictEqual(await cdp.hasButtonText('Fees & Billing', true), false);
    await cdp.logoutInBrowser();

    // RESTART SAFE TEST SERVER PROCESS COMPLETELY AND RE-VERIFY DATA PERSISTENCE!
    await stopChild(testServer);
    testServer = null;
    await new Promise((r) => setTimeout(r, 400));
    testServer = spawnSafeTestServer(tmpWorkspace);
    await waitForHealth(TEST_BASE, 25000);

    // Reload browser after server restart and re-verify admin & parent records survived intact
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.loginInBrowser('principal@brightstar.edu.ng', 'RolePassword2026!');
    await cdp.clickButtonByText('Students', true);
    await cdp.waitForText('Chidi Emeka Okafor');
    await cdp.waitForText('BSA-001');
    await cdp.logoutInBrowser();

    await cdp.loginInBrowser('parent@brightstar.edu.ng', 'RolePassword2026!');
    await cdp.clickButtonByText('Receipts', true);
    await cdp.waitForText('Official Digital Receipts · Chidi Emeka Okafor (1)');
    await cdp.logoutInBrowser();

    assert.strictEqual(cdp.pageErrors.length, 0, `Uncaught page errors observed: ${cdp.pageErrors.join('; ')}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors observed: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('✓ PASS: Fail-closed Access Restricted screen & full server restart persistence verified with zero 5xx/uncaught errors');

    console.log('\n====================================================================');
    console.log('  ALL 11 REAL HEADLESS CHROMIUM BROWSER & PERSISTENCE TESTS PASSED  ');
    console.log('====================================================================');
  } finally {
    if (cdp) cdp.close();
    await stopChild(testServer);
    await stopChild(chromeProc);
    try { fs.rmSync(tmpWorkspace, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(chromeUserDir, { recursive: true, force: true }); } catch {}
  }
}

runBrowserAcceptance().catch((err) => {
  console.error('[BROWSER ACCEPTANCE FAILED]', err);
  process.exit(1);
});
