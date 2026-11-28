import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const TEST_PORT = 3239;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;

async function waitForHealth(base: string, serverLogs: string[], timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Isolated sandbox server failed to boot in time.\nLogs:\n${serverLogs.slice(-20).join('')}`);
}

async function apiReq(
  base: string,
  method: string,
  urlPath: string,
  body?: any,
  token?: string,
  schoolId?: string
) {
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

async function stopChild(proc: ChildProcess | null) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {}
  await new Promise((r) => setTimeout(r, 400));
  try {
    proc.kill('SIGKILL');
  } catch {}
}

class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  pageErrors: string[] = [];
  apiServerErrors: Array<{ url: string; status: number }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const desc =
          msg.params?.exceptionDetails?.exception?.description ||
          msg.params?.exceptionDetails?.text ||
          'JS error';
        this.pageErrors.push(String(desc));
      } else if (msg.method === 'Network.responseReceived') {
        const resp = msg.params?.response;
        if (resp?.url?.includes('/api/') && resp.status >= 500) {
          this.apiServerErrors.push({ url: resp.url, status: resp.status });
        }
      }
    });
  }

  static async connect(debugPort: number): Promise<CDPClient> {
    let wsUrl = '';
    for (let i = 0; i < 40; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        const page = list.find((t: any) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!wsUrl) throw new Error('Could not connect to Chromium CDP');
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e) => reject(e));
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
    await new Promise((r) => setTimeout(r, 1200));
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

  async assertPortalDialogOpen(labelPart: string) {
    await this.waitFor(
      `() => {
        const dialogs = Array.from(document.querySelectorAll('body > [role="dialog"]'));
        return dialogs.some(d => {
          const rect = d.getBoundingClientRect();
          const aria = d.getAttribute('aria-label') || '';
          const txt = d.textContent || '';
          return rect.width > 200 && rect.height > 200 && (aria.includes(${JSON.stringify(labelPart)}) || txt.includes(${JSON.stringify(labelPart)}));
        });
      }`,
      `Portal dialog containing "${labelPart}"`
    );
  }

  async closeDialogByEscape() {
    await this.eval(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);
    await new Promise((r) => setTimeout(r, 350));
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function run() {
  const repoRoot = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-modals-quickaward-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-modals-'));
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
      JWT_SECRET: 'test-modals-quick-award-secret-2026',
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
    const collegeEmail = 'provost@stjudehealth.edu.ng';

    // ------------------------------------------------------------------
    // Register a Tertiary Health Technology College (mirrors user portal)
    // ------------------------------------------------------------------
    const regCollege = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'St. Jude College of Health Technology',
      schoolType: 'College of Health / Nursing',
      institutionCategory: 'TERTIARY',
      academicCycleType: 'SEMESTER',
      cycleLabels: ['1st Semester', '2nd Semester'],
      gradingMode: 'GPA_5',
      state: 'Kogi',
      lga: 'Lokoja',
      address: '14 College Road, Lokoja',
      phone: '08035550091',
      email: 'info@stjudehealth.edu.ng',
      ownerName: 'Provost Admin',
      ownerEmail: collegeEmail,
      password,
      question1: 'City?',
      answer1: 'Lokoja',
      question2: 'Color?',
      answer2: 'Green',
    });
    assert.strictEqual(regCollege.status, 201, `College registration failed: ${JSON.stringify(regCollege.data)}`);
    const collegeToken = regCollege.data.token as string;
    const collegeId = (regCollege.data.school?.id || regCollege.data.activeSchool?.id || regCollege.data.activeSchoolId) as string;

    // Ensure Active Session + Create Completed Historical Session
    let listSes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, collegeToken, collegeId);
    assert.strictEqual(listSes.status, 200);
    let activeSession = (listSes.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || listSes.data.sessions?.[0];
    if (!activeSession) {
      const sesRes = await apiReq(
        TEST_BASE,
        'POST',
        '/api/v1/school/academic-sessions',
        { name: '2025/2026', status: 'ACTIVE', auto_create_terms: true },
        collegeToken,
        collegeId
      );
      assert.ok(sesRes.status === 200 || sesRes.status === 201);
      activeSession = sesRes.data.session;
    }
    if (!activeSession.terms || activeSession.terms.length === 0) {
      await apiReq(TEST_BASE, 'POST', `/api/v1/school/academic-sessions/${activeSession.id}/ensure-terms`, {}, collegeToken, collegeId);
    }

    const histSes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/academic-sessions',
      { name: '2024/2025', status: 'COMPLETED', auto_create_terms: true },
      collegeToken,
      collegeId
    );
    assert.ok(histSes.status === 200 || histSes.status === 201);

    listSes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, collegeToken, collegeId);
    assert.strictEqual(listSes.status, 200);
    assert.ok(listSes.data.sessions.length >= 2, 'Expected at least 2 sessions returned');
    activeSession = listSes.data.sessions.find((s: any) => s.id === activeSession.id) || listSes.data.sessions[0];
    assert.ok((activeSession.terms || []).length >= 2, 'Expected semesters nested inside active session');
    const firstSemId = activeSession.terms[0].id as string;

    // Seed Classes & Departments
    const clsRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/classes',
      { name: 'Year 1 (100L)', level: '100L', arms: ['Family Healthcare', 'CHEW'] },
      collegeToken,
      collegeId
    );
    assert.strictEqual(clsRes.status, 201);
    const cls100 = clsRes.data.class;
    const fhcArmId = (cls100.arms || []).find((a: any) => a.name === 'Family Healthcare')?.id;
    const chewArmId = (cls100.arms || []).find((a: any) => a.name === 'CHEW')?.id;

    // Seed Students
    const stu1 = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      {
        first_name: 'ABDULSALAM',
        middle_name: 'SOFIAT',
        last_name: 'ENIOLA',
        admission_number: 'SJAC/2026/001',
        class_id: cls100.id,
        class_arm_id: fhcArmId,
        gender: 'Female',
      },
      collegeToken,
      collegeId
    );
    assert.strictEqual(stu1.status, 201);

    const stu2 = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      {
        first_name: 'OKONKWO',
        middle_name: 'CHINEDU',
        last_name: 'EMMANUEL',
        admission_number: 'SJAC/2026/002',
        class_id: cls100.id,
        class_arm_id: chewArmId,
        gender: 'Male',
      },
      collegeToken,
      collegeId
    );
    assert.strictEqual(stu2.status, 201);

    // Seed 1 subject + 1 empty exam (for Score Sheet auto-fallback + Broadsheet modal check)
    const subRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/subjects',
      {
        name: 'Anatomy and Physiology I',
        code: 'FHC 111',
        credit_units: 3,
        course_type: 'CORE',
        class_id: cls100.id,
        department: 'Family Healthcare',
        semester_tag: '1ST',
      },
      collegeToken,
      collegeId
    );
    assert.strictEqual(subRes.status, 201);

    const examRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/examinations',
      {
        title: '2025/2026 1st Semester Exam',
        academic_session_id: activeSession.id,
        term_id: firstSemId,
        class_id: cls100.id,
        ca_max_score: 40,
        exam_max_score: 60,
      },
      collegeToken,
      collegeId
    );
    assert.strictEqual(examRes.status, 201);

    console.log('2. Seeded Tertiary college data cleanly');

    // ------------------------------------------------------------------
    // Register a Primary School to verify Quick Award works for Primary too
    // ------------------------------------------------------------------
    const regPrimary = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Bright Future Primary Academy',
      schoolType: 'Primary',
      institutionCategory: 'PRIMARY',
      academicCycleType: 'TERM',
      cycleLabels: ['1st Term', '2nd Term', '3rd Term'],
      gradingMode: 'PERCENTAGE',
      state: 'Lagos',
      lga: 'Ikeja',
      address: '22 Allen Avenue, Ikeja',
      phone: '08035550092',
      email: 'info@brightfuture.ng',
      ownerName: 'Head Teacher',
      ownerEmail: 'head@brightfuture.ng',
      password,
      question1: 'City?',
      answer1: 'Lagos',
      question2: 'Color?',
      answer2: 'Blue',
    });
    assert.strictEqual(regPrimary.status, 201, `Primary reg failed: ${JSON.stringify(regPrimary.data)}`);
    const primToken = regPrimary.data.token as string;
    const primId = (regPrimary.data.school?.id || regPrimary.data.activeSchool?.id || regPrimary.data.activeSchoolId) as string;

    const pCls = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/classes',
      { name: 'Primary 4', level: 'Primary' },
      primToken,
      primId
    );
    assert.strictEqual(pCls.status, 201);

    const pStu = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      {
        first_name: 'Tobi',
        last_name: 'Adebayo',
        full_name: 'ADEBAYO TOBI',
        admission_number: 'BFA/2024/010',
        class_id: pCls.data.class.id,
        gender: 'Male',
      },
      primToken,
      primId
    );
    assert.strictEqual(pStu.status, 201);

    // Quick-award a past Primary year 2023/2024 3rd Term via API (zero pre-created 2023/2024 session!)
    const primQuickRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/historical-backlog/import',
      {
        publish_scores: true,
        auto_generate_reports: true,
        rows: [
          {
            admission_number: 'BFA/2024/010',
            session_name: '2023/2024',
            term_name: '3rd Term',
            class_name: 'Primary 4',
            subject_name: 'Mathematics',
            subject_code: 'MTH',
            credit_units: 1,
            ca_score: 35,
            exam_score: 55,
            total_score: 90,
          },
        ],
      },
      primToken,
      primId
    );
    assert.ok(
      primQuickRes.status === 200 || primQuickRes.status === 201,
      `Primary any-year award failed: ${JSON.stringify(primQuickRes.data)}`
    );
    assert.strictEqual(primQuickRes.data.summary.scoresSaved, 1);
    assert.strictEqual(primQuickRes.data.summary.sessionsCreated, 1);
    assert.ok(primQuickRes.data.summary.termReportsGenerated >= 1, 'Expected auto-generated Primary report card');
    console.log('3. Verified Primary School any-year (2023/2024 3rd Term) award & auto-report creation');

    // ------------------------------------------------------------------
    // Launch Headless Chromium for Real Desktop + Mobile E2E Verification
    // ------------------------------------------------------------------
    const chromePath = [
      '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ].find((p) => fs.existsSync(p));
    assert.ok(chromePath, 'Chromium binary not found');

    const debugPort = 9259;
    chromeProc = spawn(
      chromePath!,
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

    // Log in as College Provost on Desktop 1440x900
    await cdp.setViewport(1440, 900);
    await cdp.navigate(`${TEST_BASE}/login`);
    await cdp.waitFor(`() => (document.body.textContent || '').includes('Sign In')`, 'Login page render');

    await cdp.eval(`(() => {
      const email = document.querySelector('input[type="email"]');
      const pwd = document.querySelector('input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(email, ${JSON.stringify(collegeEmail)});
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwd, ${JSON.stringify(password)});
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = Array.from(document.querySelectorAll('button[type="submit"]'))[0];
      btn.click();
    })()`);

    await cdp.waitFor(
      `() => (document.body.textContent || '').includes('Performance')`,
      'School Portal dashboard load after sign in'
    );

    // Also test Academic Sessions modal opens cleanly via ModalPortal
    await cdp.clickButtonText('Sessions');
    await cdp.waitFor(
      `() => (document.body.textContent || '').includes('New Academic Session')`,
      'Academic Sessions view loaded'
    );
    await cdp.clickButtonText('New Academic Session');
    await cdp.assertPortalDialogOpen('New Academic Session');
    await cdp.closeDialogByEscape();

    // Navigate to Performance & Reports
    await cdp.clickButtonText('Performance');
    await cdp.waitFor(
      `() => (document.body.textContent || '').includes('Quick Award Scores')`,
      'Performance & Reports header with Quick Award Scores button'
    );

    // ------------------------------------------------------------------
    // TEST A: Desktop — Open EVERY Modal and Verify Portal Mount in document.body
    // ------------------------------------------------------------------
    // 1) Quick Award Scores modal
    await cdp.clickButtonText('Quick Award Scores');
    await cdp.assertPortalDialogOpen('Quick Award Scores');
    const quickModeActive = await cdp.eval<boolean>(`(() => {
      const dlg = document.querySelector('body > [role="dialog"]');
      return Boolean(dlg && dlg.querySelector('select[aria-label="Select Course to Award Scores"]'));
    })()`);
    assert.strictEqual(quickModeActive, true, 'Quick Award Scores button should open directly in Quick Award mode');
    await cdp.closeDialogByEscape();

    // 2) Bulk Upload Results modal (Matrix mode)
    await cdp.clickButtonText('Bulk Upload Results');
    await cdp.assertPortalDialogOpen('Bulk Upload Results');
    await cdp.closeDialogByEscape();

    // 3) Courses tab -> Add Course modal & Bulk Register Courses modal
    await cdp.clickButtonText('Courses', true);
    await new Promise((r) => setTimeout(r, 300));
    await cdp.clickButtonText('Add Course', true);
    await cdp.assertPortalDialogOpen('Add Course');
    await cdp.closeDialogByEscape();

    await cdp.clickButtonText('Bulk Add Courses');
    await cdp.assertPortalDialogOpen('Bulk Register');
    await cdp.closeDialogByEscape();

    // 4) Examinations & Scores tab -> New Examination modal, Manage/Fix Results modal, Broadsheet modal, Score Sheet auto-fallback
    await cdp.clickButtonText('Examinations & Scores');
    await cdp.waitFor(
      `() => (document.body.textContent || '').includes('2025/2026 1st Semester Exam')`,
      'Examinations table loaded'
    );
    await cdp.clickButtonText('New Examination');
    await cdp.assertPortalDialogOpen('Create Examination Assessment');
    await cdp.closeDialogByEscape();

    await cdp.clickButtonText('Manage / Fix Results');
    await cdp.assertPortalDialogOpen('Manage, Fix and Bulk Delete Results');
    await cdp.closeDialogByEscape();

    await cdp.clickButtonText('Broadsheet');
    await cdp.assertPortalDialogOpen('Master Examination Broadsheet');
    await cdp.closeDialogByEscape();

    // Score Sheet auto-fallback check (0 course registrations exist -> should auto-show cohort students!)
    await cdp.clickButtonText('Score Sheet');
    await cdp.waitFor(
      `() => (document.body.textContent || '').includes('ABDULSALAM SOFIAT ENIOLA')`,
      'Score Sheet auto-fallback displays students even with 0 course registrations'
    );

    console.log('4. Desktop 1440x900: All 8 modals opened cleanly via ModalPortal & Score Sheet auto-fallback passed');

    // ------------------------------------------------------------------
    // TEST B: Mobile 390x844 — Quick Award Scores for BRAND-NEW Past Year (2021/2022 · 2nd Semester) + Inline Custom Course
    // ------------------------------------------------------------------
    await cdp.setViewport(390, 844);
    await new Promise((r) => setTimeout(r, 300));

    await cdp.clickButtonText('Quick Award Scores');
    await cdp.assertPortalDialogOpen('Quick Award Scores');

    // Verify modal fits cleanly inside 390px viewport with zero horizontal overflow
    const mobileModalFit = await cdp.eval<{ width: number; overflow: boolean }>(`(() => {
      const dlg = document.querySelector('body > [role="dialog"] > div');
      const rect = dlg.getBoundingClientRect();
      return { width: rect.width, overflow: rect.right > window.innerWidth + 1 };
    })()`);
    assert.strictEqual(
      mobileModalFit.overflow,
      false,
      `Mobile Quick Award modal overflowed horizontally: ${JSON.stringify(mobileModalFit)}`
    );

    // Choose a brand-new past Academic Year "2021/2022", "2nd Semester", and type a brand-new custom Course
    await cdp.eval(`(() => {
      const dlg = document.querySelector('body > [role="dialog"]');
      const setNative = (el, val) => {
        if (!el) throw new Error('Missing input element');
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const sessInput = dlg.querySelector('input[aria-label="Target Academic Session"]');
      setNative(sessInput, '2021/2022');
      const termInput = dlg.querySelector('input[aria-label="Target Semester"]');
      setNative(termInput, '2nd Semester');
      const courseSelect = dlg.querySelector('select[aria-label="Select Course to Award Scores"]');
      setNative(courseSelect, '__CUSTOM__');
    })()`);
    await new Promise((r) => setTimeout(r, 250));

    await cdp.eval(`(() => {
      const dlg = document.querySelector('body > [role="dialog"]');
      const setNative = (el, val) => {
        if (!el) throw new Error('Missing input element');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const nameInput = dlg.querySelector('input[aria-label="Custom Course Title"]');
      const codeInput = dlg.querySelector('input[aria-label="Custom Course Code"]');
      setNative(nameInput, 'Primary Health Practicum');
      setNative(codeInput, 'CHE 204');

      // Enter mobile CA & Exam scores for ABDULSALAM SOFIAT ENIOLA (32 + 56 = 88)
      const caInput = dlg.querySelector('input[aria-label="Quick Mobile CA for ABDULSALAM SOFIAT ENIOLA"]');
      const exInput = dlg.querySelector('input[aria-label="Quick Mobile Exam for ABDULSALAM SOFIAT ENIOLA"]');
      if (!caInput || !exInput) throw new Error('Mobile Quick Award inputs not found');
      setNative(caInput, '32');
      setNative(exInput, '56');
    })()`);
    await new Promise((r) => setTimeout(r, 250));

    // Tap Save Score(s) inside the mobile modal
    await cdp.clickButtonText('Save 1 Score', false, true);

    // Wait for modal to close and success feedback toast to appear
    await cdp.waitFor(
      `() => !document.querySelector('body > [role="dialog"]') && (document.body.textContent || '').includes('2021/2022')`,
      'Quick Award saved 2021/2022 score and closed modal'
    );
    console.log('5. Mobile 390x844: Quick Award Scores saved brand-new past year 2021/2022 · 2nd Semester + custom course CHE 204');

    // ------------------------------------------------------------------
    // TEST C: Mobile 360x780 — Results & Transcripts Screenshot 1 & 2 Verification!
    // Verify populated Sessions & Semesters, zero tab clipping, and Instant Report Card modal!
    // ------------------------------------------------------------------
    await cdp.setViewport(360, 780);
    await new Promise((r) => setTimeout(r, 250));
    await cdp.clickButtonText('Results & Transcripts');
    await cdp.waitFor(
      `() => (document.body.textContent || '').includes('Instant End-of-Semester')`,
      'Results & Transcripts tab with Tertiary Semester label'
    );

    const resultsCheck = await cdp.eval<{
      hasOldTermTitle: boolean;
      sessionOptionsCount: number;
      has2021Session: boolean;
      termOptionsCount: number;
      tabOverflowRight: number;
    }>(`(() => {
      const txt = document.body.textContent || '';
      const form = document.querySelector('form');
      const selects = form ? Array.from(form.querySelectorAll('select')) : [];
      const sessSelect = selects[1];
      const termSelect = selects[2];
      const sessOpts = sessSelect ? Array.from(sessSelect.options).map(o => o.textContent || '') : [];
      const termOpts = termSelect ? Array.from(termSelect.options).map(o => o.textContent || '') : [];
      const tabs = Array.from(document.querySelectorAll('button')).filter(b =>
        (b.textContent || '').includes('Full-Session Cumulative')
      );
      const maxRight = tabs.reduce((m, b) => Math.max(m, b.getBoundingClientRect().right), 0);
      return {
        hasOldTermTitle: txt.includes('Instant End-of-Term'),
        sessionOptionsCount: sessOpts.length - 1,
        has2021Session: sessOpts.some(s => s.includes('2021/2022')),
        termOptionsCount: termOpts.length - 1,
        tabOverflowRight: Math.max(0, Math.round(maxRight - window.innerWidth)),
      };
    })()`);

    assert.strictEqual(resultsCheck.hasOldTermTitle, false, 'Tertiary portal should show End-of-Semester, not End-of-Term');
    assert.ok(resultsCheck.sessionOptionsCount >= 3, `Expected >=3 sessions in dropdown, got ${resultsCheck.sessionOptionsCount}`);
    assert.strictEqual(resultsCheck.has2021Session, true, 'Newly awarded 2021/2022 session must appear immediately in dropdown');
    assert.ok(resultsCheck.termOptionsCount >= 2, `Expected >=2 semesters in dropdown, got ${resultsCheck.termOptionsCount}`);
    assert.strictEqual(
      resultsCheck.tabOverflowRight,
      0,
      `Full-Session Cumulative tab clipped off 360px screen by ${resultsCheck.tabOverflowRight}px`
    );

    // Select 2021/2022 + 2nd Semester in Instant Report Card Generator and generate & view PrintableReportCardModal!
    await cdp.eval(`(() => {
      const form = document.querySelector('form');
      const selects = Array.from(form.querySelectorAll('select'));
      const setSel = (sel, matchText) => {
        const opt = Array.from(sel.options).find(o => (o.textContent || '').includes(matchText));
        if (!opt) throw new Error('Option not found: ' + matchText);
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, opt.value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setSel(selects[0], 'ABDULSALAM SOFIAT ENIOLA');
      setSel(selects[1], '2021/2022');
    })()`);
    await new Promise((r) => setTimeout(r, 200));
    await cdp.eval(`(() => {
      const form = document.querySelector('form');
      const selects = Array.from(form.querySelectorAll('select'));
      const opt = Array.from(selects[2].options).find(o => (o.textContent || '').includes('2nd Semester'));
      if (!opt) throw new Error('2nd Semester option not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(selects[2], opt.value);
      selects[2].dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await new Promise((r) => setTimeout(r, 200));

    await cdp.clickButtonText('Generate & View Report');
    await cdp.assertPortalDialogOpen('Statement of Result');
    const rcHasCourseAndScore = await cdp.eval<boolean>(`(() => {
      const dlg = document.querySelector('body > [role="dialog"]');
      const t = dlg ? (dlg.textContent || '') : '';
      return t.includes('Primary Health Practicum') && t.includes('88') && t.includes('2021/2022');
    })()`);
    assert.strictEqual(rcHasCourseAndScore, true, 'Compiled report card must display newly awarded 2021/2022 CHE 204 score (88)');
    await cdp.closeDialogByEscape();

    console.log('6. Mobile 360x780: Instant Report Card Generator populated, zero tab clipping, and compiled 2021/2022 result modal cleanly');

    // Final error checks
    assert.strictEqual(cdp.pageErrors.length, 0, `Unexpected browser runtime errors: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(
      cdp.apiServerErrors.length,
      0,
      `Unexpected 5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`
    );

    console.log('✅ ALL MODAL PORTAL, ANY-YEAR QUICK AWARD, AND MOBILE 360px/390px E2E CHECKS PASSED!');
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
