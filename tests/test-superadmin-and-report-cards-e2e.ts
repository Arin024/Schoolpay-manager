import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_BIN = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const TEST_PORT = 3215;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;

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
        const text =
          msg.params?.exceptionDetails?.exception?.description ||
          msg.params?.exceptionDetails?.text ||
          'Uncaught exception';
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
      height: 920,
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
        () =>
          this.evaluate(`
            const txt = document.body?.innerText || '';
            const needle = ${JSON.stringify(snippet)};
            return txt.includes(needle) || txt.toLowerCase().includes(needle.toLowerCase());
          `),
        timeoutMs,
        `Timed out waiting for text: "${snippet}"`
      );
    } catch (err: any) {
      const txt = await this.bodyText().catch(() => '');
      throw new Error(`${err.message}\n--- BODY SNAPSHOT ---\n${txt.slice(0, 1200)}`);
    }
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

  async loginInBrowser(email: string, password: string) {
    await this.waitFor(
      () => this.evaluate('return Boolean(document.querySelector("input[type=email]"))'),
      10000,
      'Login email input missing'
    );
    await this.fillInput('input[type="email"]', email);
    await this.fillInput('input[type="password"]', password);
    const submitted = await this.evaluate(`
      const btn = document.querySelector('form button[type="submit"]');
      if (!btn || btn.disabled) return false;
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      return true;
    `);
    assert.ok(submitted, 'Login submit button missing or disabled');
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
    await this.waitFor(
      () => this.evaluate('return Boolean(document.querySelector("input[type=email]"))'),
      10000,
      'Did not return to login form after logout'
    );
    await new Promise((r) => setTimeout(r, 250));
  }

  async closeModalReport() {
    await this.evaluate(`document.querySelector('button[aria-label="Close report card"]')?.click()`);
    await this.waitFor(() => this.evaluate(`return !document.body.innerText.includes('Print / Save PDF')`));
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function waitForHealth(baseUrl: string, timeoutMs = 25000) {
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-superadmin-reports-'));
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
    JWT_SECRET: 'safe-superadmin-report-card-e2e-jwt-secret-64-chars-1234567890',
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
  child.stderr?.on('data', (d) => {
    const s = String(d || '').trim();
    if (s && !s.includes('ExperimentalWarning')) console.error('[TestServer STDERR]', s);
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

async function apiReq(
  baseUrl: string,
  method: string,
  p: string,
  body?: any,
  token?: string,
  headers: Record<string, string> = {}
) {
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
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: r.status, data };
}

async function runE2E() {
  console.log('============================================================================');
  console.log('  BURSARIQ: SUPERADMIN ASSISTED ENTRY & TERM/SESSION REPORT CARDS E2E TEST  ');
  console.log('============================================================================');

  const tmpWorkspace = setupSafeTempWorkspace();
  const chromeUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-cdp-superadmin-'));
  let testServer: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;

  try {
    testServer = spawnSafeTestServer(tmpWorkspace);
    const safeHealth = (await waitForHealth(TEST_BASE, 25000)) as any;
    assert.strictEqual(safeHealth.status, 'healthy');
    assert.strictEqual(safeHealth.neonConnected, false, 'Safe test server MUST NOT connect to production Neon DB');
    console.log('✓ [1/6] Isolated safe test server booted with local SQLite only (Neon isolated)');

    const cdpPort = 9249;
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
    assert.ok(wsUrl, 'Failed to obtain CDP WebSocket URL');
    cdp = await CDPClient.connect(wsUrl);
    await cdp.goto(`${TEST_BASE}/`);

    // -------------------------------------------------------------------------
    // 2. SUPER_ADMIN Creates Zero-User School A + School B & Uses Assisted Entry
    // -------------------------------------------------------------------------
    console.log('\n[2/6] Verifying SUPER_ADMIN direct Assisted Record Entry into a zero-user school...');
    await cdp.loginInBrowser('SchoolPay28@gmail.com', 'SuperAdmin@2025!');
    await cdp.waitForText('Platform Super Admin Control Center');

    const superToken = await cdp.evaluate('return localStorage.getItem("bursariq_session_token");');
    assert.ok(superToken, 'SuperAdmin token missing from browser storage');

    // Create School A with ZERO users (no owner_email -> impersonation would be impossible!)
    const createSchoolA = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/admin/schools',
      {
        name: 'Ahmadu Bello Model Grammar School',
        type: 'Secondary',
        state: 'Kaduna',
        lga: 'Zaria',
        phone: '08031112244',
        email: 'admin@ahmadubello.edu.ng',
        address: '12 Samaru Road, Zaria',
        status: 'ACTIVE',
      },
      superToken
    );
    assert.strictEqual(createSchoolA.status, 201, `Create zero-user School A failed: ${JSON.stringify(createSchoolA.data)}`);
    const schoolAId = createSchoolA.data.school.id;

    // Create School B for cross-tenant isolation verification
    const createSchoolB = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/admin/schools',
      {
        name: 'Kano Heritage College',
        type: 'Secondary',
        state: 'Kano',
        lga: 'Nassarawa',
        phone: '08025556677',
        email: 'admin@kanoheritage.edu.ng',
        address: '5 Bompai Ave, Kano',
        status: 'ACTIVE',
      },
      superToken
    );
    assert.strictEqual(createSchoolB.status, 201);
    const schoolBId = createSchoolB.data.school.id;

    // Refresh SuperAdmin dashboard telemetry so newly created schools appear in Assisted Record Entry
    await cdp.clickButtonByText('Refresh Telemetry');
    await cdp.clickButtonByText('Assisted Record Entry');
    await cdp.waitForText('Assisted School Record Entry & Report Generation');

    // Wait for newly provisioned School A option and select it
    await cdp.waitFor(
      () =>
        cdp!.evaluate(`
          const sel = document.querySelector('select[aria-label="Target school for assisted record entry"]');
          return Boolean(sel && Array.from(sel.options).some((o) => o.value === ${JSON.stringify(schoolAId)}));
        `),
      10000,
      'Assisted Entry school select did not populate School A option'
    );
    await cdp.evaluate(`
      const sel = document.querySelector('select[aria-label="Target school for assisted record entry"]');
      sel.value = ${JSON.stringify(schoolAId)};
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await cdp.clickButtonByText('Classes & Arms');
    await cdp.waitForText('Platform SuperAdmin · Assisted School Data Entry Mode');
    await cdp.waitForText('Ahmadu Bello Model Grammar School');

    // Verify SuperAdmin quick school switch in workspace banner (School A -> School B -> School A)
    await cdp.evaluate(`
      const sel = document.querySelector('select[aria-label="Switch target school workspace"]');
      if (!sel) throw new Error('Workspace school switch select missing');
      sel.value = ${JSON.stringify(schoolBId)};
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await cdp.waitForText('Kano Heritage College');

    await cdp.evaluate(`
      const sel = document.querySelector('select[aria-label="Switch target school workspace"]');
      sel.value = ${JSON.stringify(schoolAId)};
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await cdp.waitForText('Ahmadu Bello Model Grammar School');
    console.log('✓ PASS: SUPER_ADMIN entered zero-user School A via Assisted Entry and switched workspaces cleanly');

    // -------------------------------------------------------------------------
    // 3. SUPER_ADMIN Inputs Full Academic Records (3 Terms + Subjects + Students + Scores)
    // -------------------------------------------------------------------------
    console.log('\n[3/6] SUPER_ADMIN inputting classes, 3 Nigerian terms, students, scores & publishing Session Report Cards...');
    const hA = { 'X-School-Id': schoolAId };

    const clsRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'JSS 1', level: 'Junior Secondary' }, superToken, hA);
    assert.strictEqual(clsRes.status, 201, `SuperAdmin create class failed: ${JSON.stringify(clsRes.data)}`);
    const classId = clsRes.data.class.id;

    const stfRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/staff',
      {
        first_name: 'Musa',
        last_name: 'Isa',
        email: 'teacher.musa@ahmadubello.edu.ng',
        job_title: 'Mathematics Form Teacher',
        department: 'Mathematics',
      },
      superToken,
      hA
    );
    assert.strictEqual(stfRes.status, 201);

    const armRes = await apiReq(
      TEST_BASE,
      'POST',
      `/api/v1/school/classes/${classId}/arms`,
      { name: 'Alpha', capacity: 40, class_teacher_id: stfRes.data.staff.id },
      superToken,
      hA
    );
    assert.strictEqual(armRes.status, 201);
    const armId = armRes.data.arm.id;

    const mathSub = await apiReq(TEST_BASE, 'POST', '/api/v1/school/subjects', { name: 'Mathematics', code: 'MTH101', class_id: classId }, superToken, hA);
    assert.strictEqual(mathSub.status, 201);
    const mathId = mathSub.data.subject.id;

    const engSub = await apiReq(TEST_BASE, 'POST', '/api/v1/school/subjects', { name: 'English Language', code: 'ENG101', class_id: classId }, superToken, hA);
    assert.strictEqual(engSub.status, 201);
    const engId = engSub.data.subject.id;

    const sesRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/academic-sessions', { name: '2025/2026', status: 'ACTIVE' }, superToken, hA);
    assert.strictEqual(sesRes.status, 201);
    const sessionId = sesRes.data.session.id;

    const t1Res = await apiReq(TEST_BASE, 'POST', `/api/v1/school/academic-sessions/${sessionId}/terms`, { name: '1st Term', status: 'COMPLETED' }, superToken, hA);
    const t2Res = await apiReq(TEST_BASE, 'POST', `/api/v1/school/academic-sessions/${sessionId}/terms`, { name: '2nd Term', status: 'COMPLETED' }, superToken, hA);
    const t3Res = await apiReq(TEST_BASE, 'POST', `/api/v1/school/academic-sessions/${sessionId}/terms`, { name: '3rd Term', status: 'ACTIVE' }, superToken, hA);
    assert.strictEqual(t1Res.status, 201);
    assert.strictEqual(t2Res.status, 201);
    assert.strictEqual(t3Res.status, 201);
    const term1Id = t1Res.data.term.id;
    const term2Id = t2Res.data.term.id;
    const term3Id = t3Res.data.term.id;

    // Enroll Ibrahim WITHOUT passing admission_number -> verify auto-generated Nigerian admission number
    const s1Res = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Ibrahim', last_name: 'Danjuma', class_id: classId, class_arm_id: armId, gender: 'Male' },
      superToken,
      hA
    );
    assert.strictEqual(s1Res.status, 201, `SuperAdmin enroll student failed: ${JSON.stringify(s1Res.data)}`);
    assert.ok(s1Res.data.student.admission_number, 'Auto-generated admission number must be present');
    const s1Id = s1Res.data.student.id;

    // Unlinked control student for security boundary testing
    const s2Res = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Zainab', last_name: 'Suleiman', class_id: classId, class_arm_id: armId, gender: 'Female' },
      superToken,
      hA
    );
    assert.strictEqual(s2Res.status, 201);
    const s2Id = s2Res.data.student.id;

    // Link parent strictly to Ibrahim (NOT Zainab) and provision Parent, Student, Teacher accounts
    const parRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/parents',
      {
        first_name: 'Usman',
        last_name: 'Danjuma',
        phone: '08039990011',
        email: 'parent.danjuma@ahmadubello.edu.ng',
        relationship: 'Father',
        student_ids: [s1Id],
      },
      superToken,
      hA
    );
    assert.strictEqual(parRes.status, 201);

    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'POST',
          '/api/v1/school/users/provision',
          {
            full_name: 'Alhaji Usman Danjuma',
            email: 'parent.danjuma@ahmadubello.edu.ng',
            password: 'PortalPass2026!',
            role_name: 'PARENT',
            parent_id: parRes.data.parent.id,
          },
          superToken,
          hA
        )
      ).status,
      201
    );
    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'POST',
          '/api/v1/school/users/provision',
          {
            full_name: 'Ibrahim Danjuma',
            email: 'ibrahim.danjuma@ahmadubello.edu.ng',
            password: 'PortalPass2026!',
            role_name: 'STUDENT',
            student_id: s1Id,
          },
          superToken,
          hA
        )
      ).status,
      201
    );
    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'POST',
          '/api/v1/school/users/provision',
          {
            full_name: 'Mallam Musa Isa',
            email: 'teacher.musa@ahmadubello.edu.ng',
            password: 'PortalPass2026!',
            role_name: 'TEACHER',
          },
          superToken,
          hA
        )
      ).status,
      201
    );

    // Create & publish 3 terminal exams (1st, 2nd, 3rd Term)
    const termSpecs = [
      { id: term1Id, label: '1st Term', mathCa: 32, mathEx: 48, engCa: 30, engEx: 42 },
      { id: term2Id, label: '2nd Term', mathCa: 34, mathEx: 50, engCa: 32, engEx: 46 },
      { id: term3Id, label: '3rd Term', mathCa: 36, mathEx: 52, engCa: 35, engEx: 49 },
    ];
    let lastPublishedExamId = '';
    for (const ts of termSpecs) {
      const ex = await apiReq(
        TEST_BASE,
        'POST',
        '/api/v1/school/examinations',
        {
          title: `${ts.label} Examination`,
          exam_type: 'TERMINAL',
          academic_session_id: sessionId,
          term_id: ts.id,
          class_id: classId,
          ca_max_score: 40,
          exam_max_score: 60,
        },
        superToken,
        hA
      );
      assert.strictEqual(ex.status, 201);
      const examId = ex.data.examination.id;
      lastPublishedExamId = examId;
      assert.strictEqual(
        (
          await apiReq(
            TEST_BASE,
            'PUT',
            `/api/v1/school/examinations/${examId}/scores`,
            {
              entries: [
                { student_id: s1Id, subject_id: mathId, ca_score: ts.mathCa, exam_score: ts.mathEx, subject_remark: 'Very strong' },
                { student_id: s1Id, subject_id: engId, ca_score: ts.engCa, exam_score: ts.engEx, subject_remark: 'Articulate' },
                { student_id: s2Id, subject_id: mathId, ca_score: 20, exam_score: 30, subject_remark: 'Average' },
              ],
            },
            superToken,
            hA
          )
        ).status,
        200
      );
      assert.strictEqual(
        (await apiReq(TEST_BASE, 'POST', `/api/v1/school/examinations/${examId}/status`, { status: 'REVIEW' }, superToken, hA)).status,
        200
      );
      assert.strictEqual(
        (await apiReq(TEST_BASE, 'POST', `/api/v1/school/examinations/${examId}/status`, { status: 'PUBLISHED' }, superToken, hA)).status,
        200
      );
    }

    // Create an UNPUBLISHED DRAFT exam in 1st Term to confirm zero draft score leakage into Parent/Student portals
    const draftExam = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/examinations',
      {
        title: 'Secret Mid-Term Draft Test',
        exam_type: 'TEST',
        academic_session_id: sessionId,
        term_id: term1Id,
        class_id: classId,
        ca_max_score: 40,
        exam_max_score: 60,
      },
      superToken,
      hA
    );
    assert.strictEqual(draftExam.status, 201);
    const bioSub = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/subjects',
      { name: 'Hidden Draft Subject', code: 'DRF999', class_id: classId },
      superToken,
      hA
    );
    assert.strictEqual(bioSub.status, 201);
    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'PUT',
          `/api/v1/school/examinations/${draftExam.data.examination.id}/scores`,
          {
            entries: [{ student_id: s1Id, subject_id: bioSub.data.subject.id, ca_score: 10, exam_score: 15, subject_remark: 'Draft only' }],
          },
          superToken,
          hA
        )
      ).status,
      200
    );

    // Also generate & publish official 1st Term report cards for verification
    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'POST',
          '/api/v1/school/report-cards/generate',
          { academic_session_id: sessionId, term_id: term1Id, class_id: classId },
          superToken,
          hA
        )
      ).status,
      200
    );
    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'POST',
          '/api/v1/school/report-cards/publish-class',
          { academic_session_id: sessionId, term_id: term1Id, class_id: classId },
          superToken,
          hA
        )
      ).status,
      200
    );

    // Navigate in Browser as SuperAdmin -> "Exams & Report Cards" -> Report Cards -> Full-Session Cumulative Reports -> Generate & Publish
    await cdp.clickButtonByText('Exams & Report Cards', true);
    await cdp.waitForText('Academic Performance & Digital Report Cards');
    await cdp.clickButtonByText('Report Cards', true);
    await cdp.waitForText('Official Digital Report Cards Registry');
    await cdp.clickButtonByText('Full-Session Cumulative Reports');
    await cdp.clickButtonByText('Generate Session Cumulative Reports');
    await cdp.waitForText('Ibrahim Danjuma');
    await cdp.waitForText('PROMOTED');
    await cdp.clickButtonByText('Publish Filtered Session Reports');
    await cdp.waitForText('Published 2 Full-Session Cumulative');

    // Open Printable Session Report Card inside SuperAdmin view
    const openedSuperModal = await cdp.evaluate(`
      const row = Array.from(document.querySelectorAll('tr')).find((r) => (r.innerText || '').includes('Ibrahim Danjuma') && (r.innerText || '').includes('PROMOTED'));
      if (!row) return false;
      const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').includes('View / Print'));
      if (!btn) return false;
      btn.click();
      return true;
    `);
    assert.ok(openedSuperModal, 'View / Print button missing on Ibrahim Danjuma session report card row');
    await cdp.waitForText('Full-Session Cumulative Annual Report Card');
    await cdp.waitForText('Term-by-Term Performance Progression');
    await cdp.waitForText('Annual Cumulative Average');
    await cdp.waitForText('PROMOTED');
    const superReportCode = await cdp.evaluate(`
      const m = (document.body?.innerText || '').match(/SRC-[A-Z0-9]+/);
      return m ? m[0] : '';
    `);
    assert.ok(superReportCode.startsWith('SRC-'), `Expected SRC-... verification code on modal, got "${superReportCode}"`);
    await cdp.closeModalReport();

    // Verify School B tenant isolation (0 students from School A exist in School B)
    const schoolBStudents = await apiReq(TEST_BASE, 'GET', '/api/v1/school/students', undefined, superToken, { 'X-School-Id': schoolBId });
    assert.strictEqual(schoolBStudents.status, 200);
    assert.strictEqual(schoolBStudents.data.students.length, 0, 'School B must have zero students from School A');

    // Return to Platform Console cleanly
    await cdp.clickButtonByText('Return to Platform Console');
    await cdp.waitForText('Platform Super Admin Control Center');
    await cdp.logoutInBrowser();
    console.log('✓ PASS: SUPER_ADMIN entered records, published 3-term & Full-Session Cumulative reports, verified modal & isolation');

    // -------------------------------------------------------------------------
    // 4. TEACHER Read-Only Portal Report Generation & Strict Mutation Denial
    // -------------------------------------------------------------------------
    console.log('\n[4/6] Verifying TEACHER read-only report generation (Term & Full-Session) & 403 mutation denial...');
    await cdp.loginInBrowser('teacher.musa@ahmadubello.edu.ng', 'PortalPass2026!');
    await cdp.waitForText('Assigned Classes');
    await cdp.clickButtonByText('Students', true);
    await cdp.waitForText('Ibrahim Danjuma');

    // Click "Term / Session Report" on Ibrahim Danjuma
    const clickedTeacherGen = await cdp.evaluate(`
      const row = Array.from(document.querySelectorAll('tr')).find((r) => (r.innerText || '').includes('Ibrahim Danjuma'));
      if (!row) return false;
      const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').includes('Term / Session Report'));
      if (!btn) return false;
      btn.click();
      return true;
    `);
    assert.ok(clickedTeacherGen, 'Teacher Term / Session Report button not found');
    await cdp.waitForText('Generate Student Report Card');
    await cdp.clickButtonByText('Full-Session Cumulative');
    await cdp.clickButtonByText('Compile & Print');
    await cdp.waitForText('Full-Session Cumulative Annual Report Card');
    await cdp.waitForText('Term-by-Term Performance Progression');
    await cdp.waitForText('Mathematics');
    await cdp.waitForText('English Language');
    await cdp.closeModalReport();

    // Check Performance & Reports instant compiler tab as Teacher
    await cdp.clickButtonByText('Performance & Reports', true);
    await cdp.waitForText('Academic Performance & Digital Report Cards');
    await cdp.clickButtonByText('Report Cards', true);
    await cdp.waitForText('Instant End-of-Term & Full-Session Report Card Generator');
    await cdp.clickButtonByText('Generate & View Report');
    await cdp.waitForText('Official End-of-Term Report Card');
    await cdp.closeModalReport();

    // Verify Teacher API cannot mutate any official school records (HTTP 403)
    const teacherToken = await cdp.evaluate('return localStorage.getItem("bursariq_session_token");');
    assert.strictEqual(
      (await apiReq(TEST_BASE, 'POST', '/api/v1/school/students', { first_name: 'Hack', last_name: 'Attempt' }, teacherToken, hA)).status,
      403
    );
    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'PUT',
          `/api/v1/school/examinations/${lastPublishedExamId}/scores`,
          { entries: [] },
          teacherToken,
          hA
        )
      ).status,
      403
    );
    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'POST',
          '/api/v1/school/session-report-cards/generate',
          { academic_session_id: sessionId },
          teacherToken,
          hA
        )
      ).status,
      403
    );
    await cdp.logoutInBrowser();
    console.log('✓ PASS: TEACHER generated End-of-Term & Full-Session reports while mutations returned 403');

    // -------------------------------------------------------------------------
    // 5. PARENT Portal Report Card Generation, No Draft Leakage & Child Isolation
    // -------------------------------------------------------------------------
    console.log('\n[5/6] Verifying PARENT portal Term & Full-Session report generation, zero draft leakage & 403 isolation...');
    await cdp.loginInBrowser('parent.danjuma@ahmadubello.edu.ng', 'PortalPass2026!');
    await cdp.waitForText('My Children');
    await cdp.waitForText('Ibrahim Danjuma');
    assert.strictEqual((await cdp.bodyText()).includes('Zainab Suleiman'), false, 'Unlinked student Zainab must not appear');

    // On Examination Results tab -> compile End-of-Term Report
    await cdp.clickButtonByText('Examination Results', true);
    await cdp.waitForText('Generate Performance Result / Report Card');
    await cdp.clickButtonByText('Generate & View Report Card');
    await cdp.waitForText('Official End-of-Term Report Card');
    await cdp.waitForText('Mathematics');
    const parentEndTermText = await cdp.bodyText();
    assert.strictEqual(
      parentEndTermText.includes('Hidden Draft Subject'),
      false,
      'Unpublished DRAFT subject must NEVER appear in Parent report card'
    );
    await cdp.closeModalReport();

    // On Report Cards tab -> compile Full-Session Cumulative Report Card
    await cdp.clickButtonByText('Report Cards', true);
    await cdp.waitForText('Published Full-Session Cumulative Report Cards');
    await cdp.clickButtonByText('Full-Session Cumulative');
    await cdp.clickButtonByText('Generate & View Report Card');
    await cdp.waitForText('Full-Session Cumulative Annual Report Card');
    await cdp.waitForText('Term-by-Term Performance Progression');
    await cdp.waitForText('PROMOTED');
    await cdp.closeModalReport();

    // Cross-child authorization check on backend
    const parentToken = await cdp.evaluate('return localStorage.getItem("bursariq_session_token");');
    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'POST',
          '/api/v1/portal/parent/report-cards/generate',
          { student_id: s2Id, report_type: 'SESSION', academic_session_id: sessionId },
          parentToken,
          hA
        )
      ).status,
      403
    );
    await cdp.logoutInBrowser();
    console.log('✓ PASS: PARENT compiled Term & Full-Session reports, zero DRAFT leak, and cross-child rejected with 403');

    // -------------------------------------------------------------------------
    // 6. STUDENT Self-Only Report Generation & Public SRC Verification Code
    // -------------------------------------------------------------------------
    console.log('\n[6/6] Verifying STUDENT self-only Term & Full-Session report generation & public verification...');
    await cdp.loginInBrowser('ibrahim.danjuma@ahmadubello.edu.ng', 'PortalPass2026!');
    await cdp.waitForText('My Report Cards');

    // Student compiles End-of-Term from My Results
    await cdp.clickButtonByText('My Results', true);
    await cdp.waitForText('Generate Performance Result / Report Card');
    await cdp.clickButtonByText('Generate & View Report Card');
    await cdp.waitForText('Official End-of-Term Report Card');
    assert.strictEqual(
      (await cdp.bodyText()).includes('Hidden Draft Subject'),
      false,
      'Unpublished DRAFT subject must NEVER appear in Student report card'
    );
    await cdp.closeModalReport();

    // Student compiles Full-Session Cumulative from My Report Cards
    await cdp.clickButtonByText('My Report Cards', true);
    await cdp.waitForText('Published Full-Session Cumulative Report Cards');
    await cdp.clickButtonByText('Full-Session Cumulative');
    await cdp.clickButtonByText('Generate & View Report Card');
    await cdp.waitForText('Full-Session Cumulative Annual Report Card');
    await cdp.waitForText('Term-by-Term Performance Progression');
    await cdp.waitForText('PROMOTED');
    await cdp.closeModalReport();

    // Cross-student isolation check
    const studentToken = await cdp.evaluate('return localStorage.getItem("bursariq_session_token");');
    assert.strictEqual(
      (
        await apiReq(
          TEST_BASE,
          'POST',
          '/api/v1/portal/student/report-cards/generate',
          { student_id: s2Id, report_type: 'SESSION', academic_session_id: sessionId },
          studentToken,
          hA
        )
      ).status,
      403
    );
    await cdp.logoutInBrowser();

    // Verify public document verification works for SRC-... code
    const pubVerify = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/public/verify-document',
      { document_type: 'REPORT_CARD', code: superReportCode }
    );
    assert.strictEqual(pubVerify.status, 200, `Public verification failed: ${JSON.stringify(pubVerify.data)}`);
    assert.strictEqual(pubVerify.data.valid, true);
    assert.strictEqual(pubVerify.data.document_type, 'REPORT_CARD');
    assert.strictEqual(pubVerify.data.details.term_name, 'Full Academic Session');
    assert.strictEqual(pubVerify.data.details.verification_code, superReportCode);

    assert.strictEqual(cdp.pageErrors.length, 0, `Uncaught page errors: ${cdp.pageErrors.join('; ')}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log(`✓ PASS: STUDENT self-only Term/Session reports, cross-student 403 & public verification (${superReportCode}) passed!`);

    console.log('\n============================================================================');
    console.log('  ALL 6 SUPERADMIN & FULL-SESSION REPORT CARD E2E CHECKS PASSED CLEANLY!     ');
    console.log('============================================================================');
  } finally {
    if (cdp) cdp.close();
    await stopChild(testServer);
    await stopChild(chromeProc);
    try { fs.rmSync(tmpWorkspace, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(chromeUserDir, { recursive: true, force: true }); } catch {}
  }
}

runE2E().catch((err) => {
  console.error('[SUPERADMIN & REPORT CARDS E2E FAILED]', err);
  process.exit(1);
});
