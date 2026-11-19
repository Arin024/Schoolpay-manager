import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_BIN = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const TEST_PORT = 3212;
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
    await client.setViewport(1440, 900, false);
    return client;
  }

  async setViewport(width: number, height: number, mobile: boolean) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await new Promise((r) => setTimeout(r, 200));
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
    await new Promise((r) => setTimeout(r, 500));
  }

  async reload() {
    await this.send('Page.reload', { ignoreCache: true });
    await this.waitFor(() => this.evaluate('return document.readyState === "complete"'), 10000);
    await new Promise((r) => setTimeout(r, 500));
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

  async clickButtonContaining(text: string) {
    const ok = await this.evaluate(`
      const els = Array.from(document.querySelectorAll('button, a'));
      const target = els.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.innerText || '').includes(${JSON.stringify(text)});
      });
      if (!target) return false;
      target.click();
      return true;
    `);
    assert.ok(ok, `Visible button/link containing "${text}" not found`);
    await new Promise((r) => setTimeout(r, 350));
  }

  async checkNoHorizontalOverflow(label: string) {
    const metrics = await this.evaluate<{ scrollWidth: number; clientWidth: number }>(
      'return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };'
    );
    assert.ok(
      metrics.scrollWidth <= metrics.clientWidth + 2,
      `[${label}] Horizontal overflow detected: scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth}`
    );
  }

  async clearAuth() {
    await this.evaluate('localStorage.clear(); sessionStorage.clear();');
  }

  async setAuthToken(token: string, schoolId: string) {
    await this.evaluate(`
      localStorage.setItem('bursariq_session_token', ${JSON.stringify(token)});
      localStorage.setItem('bursariq_active_school', ${JSON.stringify(schoolId)});
    `);
  }

  async gotoFresh(url: string) {
    await this.send('Page.navigate', { url: 'about:blank' });
    await new Promise((r) => setTimeout(r, 100));
    await this.goto(url);
  }

  close() {
    this.ws.close();
  }
}

async function apiJson(
  urlPath: string,
  options: { method?: string; token?: string; schoolId?: string; body?: any } = {}
): Promise<{ status: number; data: any; rawText: string; contentType: string }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.schoolId) headers['X-School-Id'] = options.schoolId;

  const res = await fetch(`${TEST_BASE}${urlPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const rawText = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }
  return { status: res.status, data, rawText, contentType: res.headers.get('content-type') || '' };
}

function setupSafeTempWorkspace(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-cbt-e2e-'));
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  const appRoot = process.cwd();
  for (const item of [
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
  ]) {
    const src = path.join(appRoot, item);
    if (fs.existsSync(src)) {
      fs.symlinkSync(src, path.join(tmpDir, item));
    }
  }
  return tmpDir;
}

async function startIsolatedServer(tmpDir: string): Promise<ChildProcess> {
  const tsxBin = path.join(tmpDir, 'node_modules', '.bin', 'tsx');
  const proc = spawn(tsxBin, ['server.ts'], {
    cwd: tmpDir,
    env: {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/root',
      NODE_ENV: 'development',
      RENDER: '1',
      PORT: String(TEST_PORT),
      JWT_SECRET: 'test-cbt-secret-key-2026-isolated-sandbox-64-chars-long',
      ALLOW_SANDBOX_PAYMENTS: 'true',
      DISABLE_HMR: 'true',
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stderr?.on('data', (chunk) => {
    const s = chunk.toString();
    if (!s.includes('DeprecationWarning') && !s.includes('ExperimentalWarning')) {
      process.stderr.write(`[server stderr] ${s}`);
    }
  });

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${TEST_BASE}/api/health`);
      if (r.ok) return proc;
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await stopProcess(proc);
  throw new Error('Isolated server failed to start in time');
}

async function stopProcess(proc: ChildProcess | null) {
  if (!proc || proc.killed || !proc.pid) return;
  const pid = proc.pid;
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {}
      try {
        proc.kill('SIGKILL');
      } catch {}
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        proc.kill('SIGTERM');
      } catch {}
    }
  });
}

async function launchChrome(debugPort: number): Promise<{ proc: ChildProcess; wsUrl: string }> {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-cbt-chrome-'));
  const proc = spawn(
    CHROME_BIN,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDir}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--headless=new',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const listRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (listRes.ok) {
        const targets: any[] = await listRes.json();
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return { proc, wsUrl: page.webSocketDebuggerUrl };
      }
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill('SIGTERM');
  throw new Error('Failed to launch headless Chromium');
}

async function main() {
  const tmpDir = setupSafeTempWorkspace();
  let serverProc: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;

  try {
    console.log('1. Starting isolated SQLite sandbox server on port', TEST_PORT);
    serverProc = await startIsolatedServer(tmpDir);

    const chrome = await launchChrome(9322);
    chromeProc = chrome.proc;
    cdp = await CDPClient.connect(chrome.wsUrl);

    // -------------------------------------------------------------------------
    // STEP 1: Register School + Seed Academic Structure, Staff, Students, Parent
    // -------------------------------------------------------------------------
    console.log('2. Registering school & provisioning classes, subjects, staff, students, parent...');
    const reg = await apiJson('/api/v1/auth/register-school', {
      method: 'POST',
      body: {
        schoolName: 'Crestview CBT Model College',
        schoolType: 'Secondary',
        state: 'Lagos',
        lga: 'Ikeja',
        address: '45 Allen Avenue, Ikeja, Lagos',
        phone: '08030001122',
        email: 'info@crestviewcbt.edu.ng',
        ownerName: 'Principal Adaora Obi',
        ownerEmail: 'principal@crestviewcbt.edu.ng',
        password: 'Password123!',
        question1: 'What city was the school founded in?',
        answer1: 'Lagos',
        question2: 'What is the school motto?',
        answer2: 'Excellence',
      },
    });
    assert.strictEqual(reg.status, 201, `School registration failed: ${reg.rawText}`);
    const adminToken = reg.data.token as string;
    const schoolId = (reg.data.activeSchoolId || reg.data.school.id) as string;

    // Update custom subdomain handle via Website Profile API
    const customHandle = 'crestview-cbt-college';
    const brandSave = await apiJson('/api/v1/school/website/profile', {
      method: 'PUT',
      token: adminToken,
      schoolId,
      body: {
        portal_subdomain: customHandle,
        hero_title: 'Welcome to Crestview CBT Model College',
        hero_subtitle: 'Pioneering digital computer-based assessments across every grade level in Lagos.',
        about_text: 'Crestview combines rigorous WAEC & JAMB preparation with modern digital examinations.',
      },
    });
    assert.strictEqual(brandSave.status, 200, `Failed to save branding: ${brandSave.rawText}`);
    assert.strictEqual(brandSave.data.urls.sitePathUrl, `/site/${customHandle}`);

    // Create Academic Session + First Term
    const sessRes = await apiJson('/api/v1/school/academic-sessions', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        name: '2026/2027',
        start_date: '2026-09-07',
        end_date: '2027-07-24',
        status: 'ACTIVE',
      },
    });
    assert.strictEqual(sessRes.status, 201, `Failed creating session: ${sessRes.rawText}`);
    const sessionId = sessRes.data.session.id as string;

    const termRes = await apiJson(`/api/v1/school/academic-sessions/${sessionId}/terms`, {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        name: 'First Term',
        start_date: '2026-09-07',
        end_date: '2026-12-18',
        status: 'ACTIVE',
      },
    });
    assert.strictEqual(termRes.status, 201, `Failed creating term: ${termRes.rawText}`);
    const termId = termRes.data.term.id as string;

    // Create Classes: JSS 1 and SSS 1
    const jss1Res = await apiJson('/api/v1/school/classes', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: { name: 'JSS 1', level: 'Junior Secondary' },
    });
    assert.strictEqual(jss1Res.status, 201, `JSS 1 class failed: ${jss1Res.rawText}`);
    const jss1ClassId = jss1Res.data.class.id as string;

    const sss1Res = await apiJson('/api/v1/school/classes', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: { name: 'SSS 1', level: 'Senior Secondary' },
    });
    assert.strictEqual(sss1Res.status, 201, `SSS 1 class failed: ${sss1Res.rawText}`);
    const sss1ClassId = sss1Res.data.class.id as string;

    // Create Subject: Mathematics
    const mathRes = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: { name: 'Mathematics', code: 'MTH101', class_id: jss1ClassId },
    });
    assert.strictEqual(mathRes.status, 201, `Subject create failed: ${mathRes.rawText}`);
    const mathSubjectId = mathRes.data.subject.id as string;

    // Create Term Examination (for 1-click CBT -> Report Card sync test)
    const termExamRes = await apiJson('/api/v1/school/examinations', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        title: 'First Term Unified Examination 2026',
        academic_session_id: sessionId,
        term_id: termId,
        class_id: jss1ClassId,
        status: 'PUBLISHED',
      },
    });
    assert.strictEqual(termExamRes.status, 201, `Term exam create failed: ${termExamRes.rawText}`);
    const termExaminationId = termExamRes.data.examination.id as string;

    // Create Staff (Teacher) with unique staff_number and login via Staff Code
    const staffCreate = await apiJson('/api/v1/school/users/provision', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        full_name: 'Mr. Emeka Nwosu',
        email: 'emeka.nwosu@crestviewcbt.edu.ng',
        password: 'Password123!',
        role_name: 'TEACHER',
        designation: 'Mathematics Teacher',
      },
    });
    assert.strictEqual(staffCreate.status, 201, `Staff create failed: ${staffCreate.rawText}`);
    const staffCode = staffCreate.data.issuedStaffNumber as string;
    assert.ok(staffCode, 'Staff record should auto-generate unique staff_number');

    const staffLoginRes = await apiJson('/api/v1/public/portal/staff-code-login', {
      method: 'POST',
      body: { staff_code: staffCode, school_slug: customHandle },
    });
    assert.strictEqual(staffLoginRes.status, 200, `Staff code login failed: ${staffLoginRes.rawText}`);
    const teacherToken = staffLoginRes.data.token as string;

    // Enroll Student 1 (JSS 1) and Student 2 (SSS 1)
    const stuJss1Res = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        first_name: 'Chidi',
        last_name: 'Okafor',
        gender: 'Male',
        class_id: jss1ClassId,
        parent_name: 'Mr. Nnamdi Okafor',
        parent_phone: '08091112233',
      },
    });
    assert.strictEqual(stuJss1Res.status, 201, `JSS 1 student enroll failed: ${stuJss1Res.rawText}`);
    const jss1Student = stuJss1Res.data.student;

    const stuSss1Res = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        first_name: 'Zainab',
        last_name: 'Bello',
        gender: 'Female',
        class_id: sss1ClassId,
        parent_name: 'Alhaji Musa Bello',
        parent_phone: '08094445566',
      },
    });
    assert.strictEqual(stuSss1Res.status, 201, `SSS 1 student enroll failed: ${stuSss1Res.rawText}`);
    const sss1Student = stuSss1Res.data.student;

    // Student 1 Admission-Number-Only Login
    const stuLogin = await apiJson('/api/v1/public/portal/admission-login', {
      method: 'POST',
      body: {
        portal_type: 'STUDENT',
        admission_number: jss1Student.admission_number,
        school_slug: customHandle,
      },
    });
    assert.strictEqual(stuLogin.status, 200, `Student admission login failed: ${stuLogin.rawText}`);
    const jss1StudentToken = stuLogin.data.token as string;

    // Parent Admission-Number-Only Login (linked ONLY to JSS 1 student)
    const parentLogin = await apiJson('/api/v1/public/portal/admission-login', {
      method: 'POST',
      body: {
        portal_type: 'PARENT',
        admission_number: jss1Student.admission_number,
        school_slug: customHandle,
      },
    });
    assert.strictEqual(parentLogin.status, 200, `Parent admission login failed: ${parentLogin.rawText}`);
    const parentToken = parentLogin.data.token as string;

    // -------------------------------------------------------------------------
    // STEP 2: Create Multi-Class CBT Exams + Bulk Import + Single Question Types
    // -------------------------------------------------------------------------
    console.log('3. Authoring multi-class CBT exams (JSS 1 with PIN, All Classes, SSS 1)...');

    // Exam A: JSS 1 Mathematics with PIN 'MATH26'
    const examARes = await apiJson('/api/v1/cbt/exams', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        title: 'JSS 1 Mathematics CBT Term Exam',
        subject_id: mathSubjectId,
        subject_name: 'Mathematics',
        class_id: jss1ClassId,
        academic_session_id: sessionId,
        term_id: termId,
        exam_mode: 'TERM_EXAM',
        duration_minutes: 30,
        pass_mark_percent: 50,
        max_attempts: 1,
        shuffle_questions: false,
        show_result_immediately: true,
        show_correct_answers: true,
        access_code: 'MATH26',
        status: 'DRAFT',
      },
    });
    assert.strictEqual(examARes.status, 201, `Exam A create failed: ${examARes.rawText}`);
    const examAId = examARes.data.exam.id as string;

    // Smart Bulk Import WAEC/JAMB plain text (3 MCQ questions, 2 marks each)
    const bulkText = [
      '1. What is the value of 15 + 27?',
      'A. 32',
      'B. 42',
      'C. 44',
      'D. 52',
      'Answer: B',
      'Explanation: 15 + 27 = 42.',
      'Marks: 2',
      '',
      '2. Solve for x: 3x = 24',
      'A. 6',
      'B. 7',
      'C. 8',
      'D. 9',
      'Answer: C',
      'Explanation: Dividing 24 by 3 gives 8.',
      'Marks: 2',
      '',
      '3. Which shape has exactly 3 interior angles summing to 180 degrees?',
      'A. Triangle',
      'B. Square',
      'C. Pentagon',
      'D. Hexagon',
      'Answer: A',
      'Marks: 2',
    ].join('\n');

    const bulkRes = await apiJson(`/api/v1/cbt/exams/${examAId}/questions/bulk`, {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: { raw_text: bulkText },
    });
    assert.strictEqual(bulkRes.status, 201, `Bulk import failed: ${bulkRes.rawText}`);
    assert.strictEqual(bulkRes.data.importedCount, 3, 'Should import 3 MCQ questions');

    // Add 1 True/False question (2 marks) + 1 Short Answer question (2 marks) -> total 10 marks
    const qTfRes = await apiJson(`/api/v1/cbt/exams/${examAId}/questions`, {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        question_type: 'TRUE_FALSE',
        question_text: 'Zero is an even integer.',
        correct_answer: 'TRUE',
        explanation: '0 divided by 2 leaves no remainder.',
        marks: 2,
      },
    });
    assert.strictEqual(qTfRes.status, 201);

    const qSaRes = await apiJson(`/api/v1/cbt/exams/${examAId}/questions`, {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        question_type: 'SHORT_ANSWER',
        question_text: 'What is the capital of Nigeria?',
        correct_answer: 'Abuja',
        explanation: 'Abuja became Nigeria capital in 1991.',
        marks: 2,
      },
    });
    assert.strictEqual(qSaRes.status, 201);
    assert.strictEqual(qSaRes.data.total_marks, 10, 'Total marks should recalculate to 10');

    // Publish Exam A
    const pubA = await apiJson(`/api/v1/cbt/exams/${examAId}`, {
      method: 'PUT',
      token: adminToken,
      schoolId,
      body: { status: 'PUBLISHED' },
    });
    assert.strictEqual(pubA.status, 200);

    // Exam B: Teacher creates All Classes open General Quiz
    const examBRes = await apiJson('/api/v1/cbt/exams', {
      method: 'POST',
      token: teacherToken,
      schoolId,
      body: {
        title: 'All-School Inter-House General Knowledge CBT',
        subject_name: 'General Studies',
        class_id: null,
        exam_mode: 'PRACTICE',
        duration_minutes: 15,
        pass_mark_percent: 50,
        status: 'PUBLISHED',
      },
    });
    assert.strictEqual(examBRes.status, 201, `Teacher Exam B create failed: ${examBRes.rawText}`);
    const examBId = examBRes.data.exam.id as string;

    await apiJson(`/api/v1/cbt/exams/${examBId}/questions`, {
      method: 'POST',
      token: teacherToken,
      schoolId,
      body: {
        question_type: 'MCQ',
        question_text: 'Which continent is Nigeria located in?',
        option_a: 'Asia',
        option_b: 'Africa',
        option_c: 'Europe',
        option_d: 'South America',
        correct_answer: 'B',
        marks: 5,
      },
    });

    // Exam C: SSS 1 Physics (should be strictly invisible & blocked for JSS 1 student)
    const examCRes = await apiJson('/api/v1/cbt/exams', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        title: 'SSS 1 Physics Mock CBT',
        subject_name: 'Physics',
        class_id: sss1ClassId,
        exam_mode: 'MOCK',
        duration_minutes: 45,
        status: 'PUBLISHED',
      },
    });
    assert.strictEqual(examCRes.status, 201);
    const examCId = examCRes.data.exam.id as string;
    await apiJson(`/api/v1/cbt/exams/${examCId}/questions`, {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        question_type: 'MCQ',
        question_text: 'What is the SI unit of Force?',
        option_a: 'Joule',
        option_b: 'Newton',
        option_c: 'Watt',
        option_d: 'Pascal',
        correct_answer: 'B',
        marks: 5,
      },
    });

    // -------------------------------------------------------------------------
    // STEP 3: Public Website /site/<handle> Sanitization & Browser Verification
    // -------------------------------------------------------------------------
    console.log('4. Verifying /site/<handle> public API sanitization and responsive browser rendering...');
    const pubSite = await apiJson(`/api/v1/public/schools/${customHandle}/website`);
    assert.strictEqual(pubSite.status, 200, `Public website fetch failed: ${pubSite.rawText}`);
    assert.strictEqual(pubSite.data.urls.sitePathUrl, `/site/${customHandle}`);
    assert.strictEqual(pubSite.data.cbtSummary.activeExamsCount, 3, 'Should show 3 active published CBT exams');
    const pubJsonStr = JSON.stringify(pubSite.data);
    assert.ok(!pubJsonStr.includes('MATH26'), 'Public website JSON MUST NEVER expose CBT access_code PIN!');
    assert.ok(!pubJsonStr.includes('correct_answer'), 'Public website JSON MUST NEVER expose correct_answer!');
    assert.ok(!pubJsonStr.includes('15 + 27'), 'Public website JSON MUST NEVER expose exam questions!');

    // Test 3A: Logged-in Admin dashboard Overview + live /site/<handle> preview
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.setAuthToken(adminToken, schoolId);
    await cdp.gotoFresh(`${TEST_BASE}/#overview`);
    await cdp.waitForText('Crestview CBT Model College');
    await cdp.waitForText(`/site/${customHandle}`);
    await cdp.waitForText('Open Live Site');
    await cdp.waitForText('CBT Examination Centre');

    // Open /site/<handle> directly while logged in as Admin
    await cdp.goto(`${TEST_BASE}/site/${customHandle}`);
    await cdp.waitForText('Welcome to Crestview CBT Model College');
    await cdp.waitForText('Back to My Dashboard');
    await cdp.waitForText('School CBT Examination Hall');
    const adminPreviewPath = await cdp.evaluate<string>('return window.location.pathname;');
    assert.strictEqual(adminPreviewPath, `/site/${customHandle}`, 'Logged-in /site/<handle> pathname must be preserved');
    const adminPreviewBody = await cdp.bodyText();
    assert.ok(!adminPreviewBody.includes('Register Your School'), '"Register Your School" must be hidden on school website');

    // Responsive overflow check at 1440px and 360px
    await cdp.checkNoHorizontalOverflow('School Website 1440px');
    await cdp.setViewport(360, 800, true);
    await cdp.checkNoHorizontalOverflow('School Website 360px');
    await cdp.setViewport(1440, 900, false);

    // Test 3B: Unauthenticated Visitor opens /site/<handle>
    await cdp.clearAuth();
    await cdp.gotoFresh(`${TEST_BASE}/site/${customHandle}`);
    await cdp.waitForText('Welcome to Crestview CBT Model College');
    await cdp.waitForText('School CBT Examination Hall');
    await cdp.waitForText('JSS 1 Mathematics CBT Term Exam');
    const visitorBody = await cdp.bodyText();
    assert.ok(!visitorBody.includes('Register Your School'), '"Register Your School" must be hidden for visitors');
    assert.ok(!visitorBody.includes('MATH26'), 'Exam PIN must never appear on public website');

    // -------------------------------------------------------------------------
    // STEP 4: Strict Class Eligibility, PIN Guard & Zero-Leakage API Checks
    // -------------------------------------------------------------------------
    console.log('5. Verifying strict class isolation, PIN validation, and zero answer-key leakage...');
    const stuExamsRes = await apiJson('/api/v1/cbt/student/exams', {
      token: jss1StudentToken,
      schoolId,
    });
    assert.strictEqual(stuExamsRes.status, 200);
    const eligibleIds = (stuExamsRes.data.exams || []).map((e: any) => e.id);
    assert.ok(eligibleIds.includes(examAId), 'JSS 1 student must see JSS 1 exam');
    assert.ok(eligibleIds.includes(examBId), 'JSS 1 student must see All Classes exam');
    assert.ok(!eligibleIds.includes(examCId), 'JSS 1 student MUST NOT see SSS 1 exam');

    // Direct attempt to start SSS 1 exam -> 403 CLASS_NOT_ELIGIBLE
    const blockedClass = await apiJson(`/api/v1/cbt/student/exams/${examCId}/start`, {
      method: 'POST',
      token: jss1StudentToken,
      schoolId,
      body: {},
    });
    assert.strictEqual(blockedClass.status, 403, `Expected 403 for SSS 1 exam, got ${blockedClass.status}`);
    assert.strictEqual(blockedClass.data.error, 'CLASS_NOT_ELIGIBLE');

    // Wrong PIN on Exam A -> 403 INVALID_ACCESS_CODE
    const badPin = await apiJson(`/api/v1/cbt/student/exams/${examAId}/start`, {
      method: 'POST',
      token: jss1StudentToken,
      schoolId,
      body: { access_code: 'WRONG99' },
    });
    assert.strictEqual(badPin.status, 403, `Expected 403 for bad PIN, got ${badPin.status}`);
    assert.strictEqual(badPin.data.error, 'INVALID_ACCESS_CODE');

    // Start Exam A with valid PIN -> verify zero answer leakage
    const startA = await apiJson(`/api/v1/cbt/student/exams/${examAId}/start`, {
      method: 'POST',
      token: jss1StudentToken,
      schoolId,
      body: { access_code: 'MATH26' },
    });
    assert.strictEqual(startA.status, 201, `Start exam A failed: ${startA.rawText}`);
    const attemptAId = startA.data.attempt.id as string;
    const questionsA = startA.data.questions as any[];
    assert.strictEqual(questionsA.length, 5);
    for (const q of questionsA) {
      assert.strictEqual(q.correct_answer, undefined, 'correct_answer MUST NOT leak to student during active attempt');
      assert.strictEqual(q.explanation, undefined, 'explanation MUST NOT leak to student during active attempt');
    }

    // Auto-save Q1 (correct 'B'), Q2 (wrong 'A' + flagged), Q3 (correct 'A'), Q4 (correct 'TRUE'), Q5 (correct 'abuja' case-insensitive)
    // Expected score: 8 / 10 = 80.0% -> A1!
    const save1 = await apiJson(`/api/v1/cbt/student/attempts/${attemptAId}/answer`, {
      method: 'PUT',
      token: jss1StudentToken,
      schoolId,
      body: { question_id: questionsA[0].id, selected: 'B', flagged: false },
    });
    assert.strictEqual(save1.status, 200);
    await apiJson(`/api/v1/cbt/student/attempts/${attemptAId}/answer`, {
      method: 'PUT',
      token: jss1StudentToken,
      schoolId,
      body: { question_id: questionsA[1].id, selected: 'A', flagged: true },
    });
    await apiJson(`/api/v1/cbt/student/attempts/${attemptAId}/answer`, {
      method: 'PUT',
      token: jss1StudentToken,
      schoolId,
      body: { question_id: questionsA[2].id, selected: 'A', flagged: false },
    });
    await apiJson(`/api/v1/cbt/student/attempts/${attemptAId}/answer`, {
      method: 'PUT',
      token: jss1StudentToken,
      schoolId,
      body: { question_id: questionsA[3].id, selected: 'TRUE', flagged: false },
    });

    // -------------------------------------------------------------------------
    // STEP 5: Live Student CBT Hall in Browser (Resume After Reload + Submit)
    // -------------------------------------------------------------------------
    console.log('6. Testing Student CBT Exam Hall in headless Chromium (resume across reload + submit + review)...');
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.setAuthToken(jss1StudentToken, schoolId);
    await cdp.evaluate("sessionStorage.setItem('bursariq_post_login_tab', 'cbt');");
    await cdp.gotoFresh(`${TEST_BASE}/#overview`);
    // Should auto-land directly on CBT Exams tab via post-login handoff!
    await cdp.waitForText('JSS 1 Mathematics CBT Term Exam');
    await cdp.waitForText('Resume In-Progress Exam');

    // Click Resume In-Progress Exam -> verify Q1 persisted, then save Q5, reload, and submit!
    await cdp.clickButtonContaining('Resume In-Progress Exam');
    await cdp.waitForText('What is the value of 15 + 27?');
    await cdp.waitForText('Question Navigator');
    await cdp.checkNoHorizontalOverflow('Student CBT Hall 1440px');

    // Save Q5 via API, reload page mid-exam to confirm browser resume persistence
    await apiJson(`/api/v1/cbt/student/attempts/${attemptAId}/answer`, {
      method: 'PUT',
      token: jss1StudentToken,
      schoolId,
      body: { question_id: questionsA[4].id, selected: 'abuja', flagged: false },
    });

    await cdp.reload();
    await cdp.waitForText('CBT Exams');
    await cdp.clickButtonContaining('CBT Exams');
    await cdp.waitForText('Resume In-Progress Exam');
    await cdp.clickButtonContaining('Resume In-Progress Exam');
    await cdp.waitForText('What is the value of 15 + 27?');
    await cdp.waitForText('5/5'); // All 5 questions persisted across full reload!

    // Submit via UI modal
    await cdp.clickButtonContaining('Submit Exam');
    await cdp.waitForText('Confirm & Submit');
    await cdp.clickButtonContaining('Confirm & Submit');
    await cdp.waitForText('80%');
    await cdp.waitForText('A1');
    await cdp.waitForText('Answer Sheet Review');
    await cdp.waitForText('Dividing 24 by 3 gives 8.'); // Explanation shown after submission!

    // -------------------------------------------------------------------------
    // STEP 6: Parent Read-Only CBT Results & Strict Parent Isolation
    // -------------------------------------------------------------------------
    console.log('7. Verifying Parent CBT Results visibility and strict cross-student 403 isolation...');
    const parentOwnRes = await apiJson(`/api/v1/cbt/parent/results?student_id=${jss1Student.id}`, {
      token: parentToken,
      schoolId,
    });
    assert.strictEqual(parentOwnRes.status, 200, `Parent CBT fetch failed: ${parentOwnRes.rawText}`);
    assert.strictEqual(parentOwnRes.data.results.length, 1);
    assert.strictEqual(parentOwnRes.data.results[0].score_obtained, 8);
    assert.strictEqual(parentOwnRes.data.results[0].percentage, 80);
    assert.strictEqual(parentOwnRes.data.results[0].grade, 'A1');

    // Cross-student access attempt by Parent MUST be rejected (403)
    const parentUnauthorized = await apiJson(`/api/v1/cbt/parent/results?student_id=${sss1Student.id}`, {
      token: parentToken,
      schoolId,
    });
    assert.strictEqual(
      parentUnauthorized.status,
      403,
      `Parent MUST be blocked from viewing unlinked student CBT results (got ${parentUnauthorized.status})`
    );

    // Browser verification of Parent CBT Results tab
    await cdp.clearAuth();
    await cdp.setAuthToken(parentToken, schoolId);
    await cdp.gotoFresh(`${TEST_BASE}/#overview`);
    await cdp.waitForText('CBT Results');
    await cdp.clickButtonContaining('CBT Results');
    await cdp.waitForText('JSS 1 Mathematics CBT Term Exam');
    await cdp.waitForText('80.0%');
    await cdp.waitForText('A1');

    // -------------------------------------------------------------------------
    // STEP 7: Admin Analytics, CSV Export & 1-Click Sync CBT -> Report Card
    // -------------------------------------------------------------------------
    console.log('8. Verifying Admin CBT Analytics, CSV Export & 1-Click Sync to Report Card...');
    const analyticsRes = await apiJson(`/api/v1/cbt/exams/${examAId}/results`, {
      token: adminToken,
      schoolId,
    });
    assert.strictEqual(analyticsRes.status, 200);
    assert.strictEqual(analyticsRes.data.summary.completed_count, 1);
    assert.strictEqual(analyticsRes.data.summary.average_percentage, 80);
    assert.strictEqual(analyticsRes.data.questionAnalytics.length, 5);
    assert.strictEqual(analyticsRes.data.questionAnalytics[0].accuracy_percent, 100);
    assert.strictEqual(analyticsRes.data.questionAnalytics[1].accuracy_percent, 0);

    const csvRes = await apiJson(`/api/v1/cbt/exams/${examAId}/results/export`, {
      token: adminToken,
      schoolId,
    });
    assert.strictEqual(csvRes.status, 200);
    assert.ok(csvRes.contentType.includes('text/csv'), 'Export must return text/csv');
    assert.ok(csvRes.rawText.includes('Chidi Okafor'), 'CSV must contain student name');
    assert.ok(csvRes.rawText.includes('80'), 'CSV must contain percentage');

    // 1-Click Sync CBT -> Report Card Examination (EXAM column = 60 max => 80% of 60 = 48)
    const syncRes = await apiJson(`/api/v1/cbt/exams/${examAId}/sync-scores`, {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        examination_id: termExaminationId,
        subject_id: mathSubjectId,
        target: 'EXAM',
      },
    });
    assert.strictEqual(syncRes.status, 200, `CBT sync failed: ${syncRes.rawText}`);
    assert.strictEqual(syncRes.data.syncedCount, 1);

    // Compile End-of-Term Report Card & verify synced 48/60 score flows straight through!
    const rcGen = await apiJson('/api/v1/school/report-cards/generate', {
      method: 'POST',
      token: adminToken,
      schoolId,
      body: {
        student_id: jss1Student.id,
        academic_session_id: sessionId,
        term_id: termId,
      },
    });
    assert.strictEqual(rcGen.status, 200, `Report card generation failed: ${rcGen.rawText}`);
    const generatedRc = rcGen.data.reportCards?.[0];
    assert.ok(generatedRc, 'Report card should be generated from synced CBT score');
    assert.strictEqual(Number(generatedRc.total_score), 48, `Expected synced total_score 48 (80% of 60), got ${generatedRc.total_score}`);
    const rcDetail = await apiJson(`/api/v1/school/report-cards/${generatedRc.id}`, {
      token: adminToken,
      schoolId,
    });
    assert.strictEqual(rcDetail.status, 200, `Report card detail fetch failed: ${rcDetail.rawText}`);
    const subjectsInRc =
      rcDetail.data.reportCard?.breakdown?.subjects ||
      rcDetail.data.reportCard?.subjects ||
      [];
    const mathRow = subjectsInRc.find((s: any) => s.subject_name === 'Mathematics');
    assert.ok(mathRow, 'Mathematics synced from CBT must appear in compiled End-of-Term Report Card');
    assert.strictEqual(Number(mathRow.exam_score), 48, `Expected synced exam_score 48 (80% of 60), got ${mathRow.exam_score}`);

    // Verify Admin CBT tab & Teacher CBT tab render cleanly in Chromium
    await cdp.clearAuth();
    await cdp.setAuthToken(adminToken, schoolId);
    await cdp.gotoFresh(`${TEST_BASE}/#cbt`);
    await cdp.waitForText('Computer-Based Testing (CBT) Examination Centre');
    await cdp.waitForText('JSS 1 Mathematics CBT Term Exam');
    await cdp.checkNoHorizontalOverflow('Admin CBT Studio 1440px');

    await cdp.clearAuth();
    await cdp.setAuthToken(teacherToken, schoolId);
    await cdp.gotoFresh(`${TEST_BASE}/#overview`);
    await cdp.waitForText('CBT Exams');
    await cdp.clickButtonContaining('CBT Exams');
    await cdp.waitForText('All-School Inter-House General Knowledge CBT');

    // -------------------------------------------------------------------------
    // STEP 8: Persistence Verification Across Full Server Restart
    // -------------------------------------------------------------------------
    console.log('9. Restarting isolated server to verify 100% database persistence...');
    await stopProcess(serverProc);
    serverProc = await startIsolatedServer(tmpDir);

    const postRestartSite = await apiJson(`/api/v1/public/schools/${customHandle}/website`);
    assert.strictEqual(postRestartSite.status, 200);
    assert.strictEqual(postRestartSite.data.cbtSummary.activeExamsCount, 3);

    const postRestartResults = await apiJson(`/api/v1/cbt/exams/${examAId}/results`, {
      token: adminToken,
      schoolId,
    });
    assert.strictEqual(postRestartResults.status, 200);
    assert.strictEqual(postRestartResults.data.summary.completed_count, 1);
    assert.strictEqual(postRestartResults.data.attempts[0].synced_to_report_card, true);

    assert.strictEqual(cdp.pageErrors.length, 0, `Uncaught page errors: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.consoleErrors.length, 0, `Console errors: ${cdp.consoleErrors.join(' | ')}`);
    assert.strictEqual(
      cdp.apiServerErrors.length,
      0,
      `5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`
    );

    console.log('✅ ALL CBT EXAMINATION ENGINE & LIVE SCHOOL WEBSITE LINK E2E TESTS PASSED!');
  } finally {
    if (cdp) cdp.close();
    await stopProcess(chromeProc);
    await stopProcess(serverProc);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }
}

main().catch((err) => {
  console.error('❌ E2E TEST FAILED:', err);
  process.exit(1);
});
