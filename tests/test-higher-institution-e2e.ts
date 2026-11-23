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

  async gotoFresh(url: string) {
    await this.send('Page.navigate', { url: 'about:blank' });
    await new Promise((r) => setTimeout(r, 100));
    await this.goto(url);
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
      throw new Error(`${err.message}\n--- PAGE TEXT ---\n${txt.slice(0, 1800)}`);
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
    await new Promise((r) => setTimeout(r, 400));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-tertiary-e2e-'));
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
      JWT_SECRET: 'test-tertiary-secret-key-2026-isolated-sandbox-64-chars-long',
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
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-tertiary-chrome-'));
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

    const chrome = await launchChrome(9325);
    chromeProc = chrome.proc;
    cdp = await CDPClient.connect(chrome.wsUrl);

    // =========================================================================
    // SCENARIO A: UNIVERSITY REGISTRATION (Harmattan/Rain Semesters, 5.00 NUC GPA)
    // =========================================================================
    console.log('2. Registering University with Harmattan/Rain Semesters & NUC 5.00 GPA scale...');
    const uniReg = await apiJson('/api/v1/auth/register-school', {
      method: 'POST',
      body: {
        schoolName: 'Horizon University of Science & Technology',
        schoolType: 'University',
        institutionCategory: 'TERTIARY',
        academicCycleType: 'SEMESTER',
        cycleLabels: ['Harmattan Semester', 'Rain Semester'],
        gradingMode: 'GPA_5',
        state: 'Enugu',
        lga: 'Nsukka',
        address: '1 University Crescent, Nsukka, Enugu State',
        phone: '08035550199',
        email: 'registrar@horizonuni.edu.ng',
        ownerName: 'Prof. Chinedu Eze',
        ownerEmail: 'vc@horizonuni.edu.ng',
        password: 'Password123!',
        question1: 'What city was the university founded in?',
        answer1: 'Nsukka',
        question2: 'What is the university motto?',
        answer2: 'Knowledge and Innovation',
      },
    });
    assert.strictEqual(uniReg.status, 201, `University registration failed: ${uniReg.rawText}`);
    const uniToken = uniReg.data.token as string;
    const uniId = (uniReg.data.activeSchoolId || uniReg.data.school.id) as string;
    const uniSlug = uniReg.data.school.slug as string;

    assert.strictEqual(uniReg.data.settings.institution_category, 'TERTIARY');
    assert.strictEqual(uniReg.data.settings.academic_cycle_type, 'SEMESTER');
    assert.strictEqual(uniReg.data.settings.grading_mode, 'GPA_5');
    assert.strictEqual(uniReg.data.settings.current_term, 'Harmattan Semester');

    // Verify academic performance settings seeded to 30 CA / 70 Exam for University
    const uniPerfSettings = await apiJson('/api/v1/school/performance/settings', {
      token: uniToken,
      schoolId: uniId,
    });
    assert.strictEqual(uniPerfSettings.status, 200);
    assert.strictEqual(Number(uniPerfSettings.data.settings.ca_max_score), 30, 'University CA max should default to 30');
    assert.strictEqual(Number(uniPerfSettings.data.settings.exam_max_score), 70, 'University Exam max should default to 70');

    // Verify public website reflects tertiary settings and zero K-12 "NERDC" copy
    const uniWebsite = await apiJson(`/api/v1/public/schools/${uniSlug}/website`);
    assert.strictEqual(uniWebsite.status, 200, `University public website fetch failed: ${uniWebsite.rawText}`);
    assert.strictEqual(uniWebsite.data.settings.institution_category, 'TERTIARY');
    assert.strictEqual(uniWebsite.data.settings.academic_cycle_type, 'SEMESTER');
    assert.strictEqual(uniWebsite.data.settings.grading_mode, 'GPA_5');
    assert.ok(
      !JSON.stringify(uniWebsite.data.websiteProfile || {}).includes('NERDC'),
      'University website profile should not contain K-12 NERDC copy'
    );

    // =========================================================================
    // SCENARIO B: UNIVERSITY LEVELS (100L-500L), CREDIT UNITS, EXACT 5.00 GPA/CGPA
    // =========================================================================
    console.log('3. Setting up University Levels (100L–500L), Courses with Credit Units, & Semesters...');
    const uniBulkClasses = await apiJson('/api/v1/school/classes/bulk-setup', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { mode: 'UNIVERSITY' },
    });
    assert.strictEqual(uniBulkClasses.status, 200, `University bulk-setup failed: ${uniBulkClasses.rawText}`);
    assert.strictEqual(uniBulkClasses.data.createdClassesCount, 5);
    const uniClassesRes = await apiJson('/api/v1/school/classes', { token: uniToken, schoolId: uniId });
    assert.strictEqual(uniClassesRes.status, 200);
    const levelNames = (uniClassesRes.data.classes || []).map((c: any) => c.name);
    for (const expected of ['100 Level', '200 Level', '300 Level', '400 Level', '500 Level']) {
      assert.ok(levelNames.includes(expected), `Missing expected university level: ${expected}`);
    }
    const level100 = (uniClassesRes.data.classes || []).find((c: any) => c.name === '100 Level');
    assert.strictEqual(level100.level, 'Undergraduate');

    // Create Academic Session + Harmattan & Rain Semesters
    const uniSessionRes = await apiJson('/api/v1/school/academic-sessions', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: '2026/2027', start_date: '2026-10-01', end_date: '2027-07-31', status: 'ACTIVE' },
    });
    assert.strictEqual(uniSessionRes.status, 201);
    const uniSessionId = uniSessionRes.data.session.id as string;

    const harmattanRes = await apiJson(`/api/v1/school/academic-sessions/${uniSessionId}/terms`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'Harmattan Semester', start_date: '2026-10-01', end_date: '2027-02-28', status: 'ACTIVE' },
    });
    assert.strictEqual(harmattanRes.status, 201);
    const harmattanId = harmattanRes.data.term.id as string;

    const rainRes = await apiJson(`/api/v1/school/academic-sessions/${uniSessionId}/terms`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'Rain Semester', start_date: '2027-03-15', end_date: '2027-07-31', status: 'UPCOMING' },
    });
    assert.strictEqual(rainRes.status, 201);
    const rainId = rainRes.data.term.id as string;

    // Create 3 Courses with distinct Credit Units (4, 3, 2)
    const cscRes = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'Introduction to Computer Science', code: 'CSC 101', class_id: level100.id, credit_units: 4 },
    });
    assert.strictEqual(cscRes.status, 201, `CSC 101 create failed: ${cscRes.rawText}`);
    assert.strictEqual(Number(cscRes.data.subject.credit_units), 4);
    const cscId = cscRes.data.subject.id as string;

    const mthRes = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'Elementary Mathematics I', code: 'MTH 101', class_id: level100.id, credit_units: 3 },
    });
    assert.strictEqual(mthRes.status, 201);
    assert.strictEqual(Number(mthRes.data.subject.credit_units), 3);
    const mthId = mthRes.data.subject.id as string;

    const gstRes = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'Use of English & Communication', code: 'GST 101', class_id: level100.id, credit_units: 2 },
    });
    assert.strictEqual(gstRes.status, 201);
    assert.strictEqual(Number(gstRes.data.subject.credit_units), 2);
    const gstId = gstRes.data.subject.id as string;

    // Enroll Undergraduate Student with Matriculation Number
    const uniStuRes = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        first_name: 'Amaka',
        last_name: 'Nwankwo',
        gender: 'Female',
        admission_number: 'HUST/CSC/26/001',
        class_id: level100.id,
        parent_name: 'Chief Ikechukwu Nwankwo',
        parent_phone: '08091234567',
      },
    });
    assert.strictEqual(uniStuRes.status, 201, `Uni student create failed: ${uniStuRes.rawText}`);
    const uniStudent = uniStuRes.data.student;

    // Create Harmattan & Rain Examinations and record exact scores
    const harmExamRes = await apiJson('/api/v1/school/examinations', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        title: 'Harmattan Semester Examinations 2026/2027',
        academic_session_id: uniSessionId,
        term_id: harmattanId,
        class_id: level100.id,
        status: 'OPEN',
      },
    });
    assert.strictEqual(harmExamRes.status, 201);
    const harmExamId = harmExamRes.data.examination.id as string;

    // Harmattan: CSC101 (4u)=80 (A,5->20), MTH101 (3u)=64 (B,4->12), GST101 (2u)=75 (A,5->10) => 42/9 = 4.67 (First Class Honours)
    const harmScores = await apiJson(`/api/v1/school/examinations/${harmExamId}/scores`, {
      method: 'PUT',
      token: uniToken,
      schoolId: uniId,
      body: {
        entries: [
          { student_id: uniStudent.id, subject_id: cscId, ca_score: 24, exam_score: 56 },
          { student_id: uniStudent.id, subject_id: mthId, ca_score: 20, exam_score: 44 },
          { student_id: uniStudent.id, subject_id: gstId, ca_score: 25, exam_score: 50 },
        ],
      },
    });
    assert.strictEqual(harmScores.status, 200, `Harmattan scores failed: ${harmScores.rawText}`);

    const rainExamRes = await apiJson('/api/v1/school/examinations', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        title: 'Rain Semester Examinations 2026/2027',
        academic_session_id: uniSessionId,
        term_id: rainId,
        class_id: level100.id,
        status: 'OPEN',
      },
    });
    assert.strictEqual(rainExamRes.status, 201);
    const rainExamId = rainExamRes.data.examination.id as string;

    // Rain: CSC101 (4u)=65 (B,4->16), MTH101 (3u)=56 (C,3->9), GST101 (2u)=74 (A,5->10) => 35/9 = 3.89 (Second Class Upper (2:1))
    const rainScores = await apiJson(`/api/v1/school/examinations/${rainExamId}/scores`, {
      method: 'PUT',
      token: uniToken,
      schoolId: uniId,
      body: {
        entries: [
          { student_id: uniStudent.id, subject_id: cscId, ca_score: 20, exam_score: 45 },
          { student_id: uniStudent.id, subject_id: mthId, ca_score: 18, exam_score: 38 },
          { student_id: uniStudent.id, subject_id: gstId, ca_score: 22, exam_score: 52 },
        ],
      },
    });
    assert.strictEqual(rainScores.status, 200, `Rain scores failed: ${rainScores.rawText}`);

    // Generate Harmattan Semester Result Statement
    console.log('4. Compiling Semester Result Statements & Full-Session Academic Transcript (5.00 GPA/CGPA)...');
    const harmRcGen = await apiJson('/api/v1/school/report-cards/generate', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { student_id: uniStudent.id, academic_session_id: uniSessionId, term_id: harmattanId },
    });
    assert.strictEqual(harmRcGen.status, 200, `Harmattan RC generate failed: ${harmRcGen.rawText}`);
    const harmRcId = harmRcGen.data.reportCards[0].id as string;

    const harmRcDetail = await apiJson(`/api/v1/school/report-cards/${harmRcId}`, {
      token: uniToken,
      schoolId: uniId,
    });
    assert.strictEqual(harmRcDetail.status, 200);
    const harmBd = harmRcDetail.data.reportCard.breakdown;
    assert.strictEqual(harmBd.gradingMode, 'GPA_5');
    assert.strictEqual(Number(harmBd.total_credit_units), 9, `Expected 9 units, got ${harmBd.total_credit_units}`);
    assert.strictEqual(Number(harmBd.total_grade_points), 42, `Expected 42 QP, got ${harmBd.total_grade_points}`);
    assert.strictEqual(Number(harmBd.gpa), 4.67, `Expected Harmattan GPA 4.67, got ${harmBd.gpa}`);
    assert.strictEqual(harmBd.academic_standing, 'First Class Honours');
    assert.strictEqual(harmBd.institution_profile?.isTertiary, true);

    // Generate Rain Semester Result Statement
    const rainRcGen = await apiJson('/api/v1/school/report-cards/generate', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { student_id: uniStudent.id, academic_session_id: uniSessionId, term_id: rainId },
    });
    assert.strictEqual(rainRcGen.status, 200);
    const rainRcDetail = await apiJson(`/api/v1/school/report-cards/${rainRcGen.data.reportCards[0].id}`, {
      token: uniToken,
      schoolId: uniId,
    });
    const rainBd = rainRcDetail.data.reportCard.breakdown;
    assert.strictEqual(Number(rainBd.total_credit_units), 9);
    assert.strictEqual(Number(rainBd.total_grade_points), 35);
    assert.strictEqual(Number(rainBd.gpa), 3.89, `Expected Rain GPA 3.89, got ${rainBd.gpa}`);
    assert.strictEqual(rainBd.academic_standing, 'Second Class Upper (2:1)');

    // Generate Full-Session Cumulative Academic Transcript -> CGPA = (42 + 35) / 18 = 4.28
    const sessionRcGen = await apiJson('/api/v1/school/session-report-cards/generate', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { student_id: uniStudent.id, academic_session_id: uniSessionId },
    });
    assert.strictEqual(sessionRcGen.status, 200, `Session transcript generate failed: ${sessionRcGen.rawText}`);
    const sessionRcId = sessionRcGen.data.sessionReportCards[0].id as string;

    const sessionRcDetail = await apiJson(`/api/v1/school/session-report-cards/${sessionRcId}`, {
      token: uniToken,
      schoolId: uniId,
    });
    assert.strictEqual(sessionRcDetail.status, 200);
    const sessionBd = sessionRcDetail.data.sessionReportCard.breakdown;
    assert.strictEqual(sessionBd.gradingMode, 'GPA_5');
    assert.strictEqual(Number(sessionBd.total_credit_units), 18, `Expected 18 cumulative units, got ${sessionBd.total_credit_units}`);
    assert.strictEqual(Number(sessionBd.total_grade_points), 77, `Expected 77 cumulative QP, got ${sessionBd.total_grade_points}`);
    assert.strictEqual(Number(sessionBd.cgpa), 4.28, `Expected CGPA 4.28, got ${sessionBd.cgpa}`);
    assert.strictEqual(sessionBd.academic_standing, 'Second Class Upper (2:1)');
    assert.strictEqual(sessionBd.term_averages.length, 2, 'Expected 2 semester summaries in full-session transcript');
    assert.strictEqual(sessionBd.term_averages[0].term_name, 'Harmattan Semester');
    assert.strictEqual(Number(sessionBd.term_averages[0].gpa), 4.67);
    assert.strictEqual(sessionBd.term_averages[1].term_name, 'Rain Semester');
    assert.strictEqual(Number(sessionBd.term_averages[1].gpa), 3.89);

    // =========================================================================
    // SCENARIO C: POLYTECHNIC (4.00 NBTE GPA SCALE + ND/HND BULK SETUP)
    // =========================================================================
    console.log('5. Verifying Polytechnic 4.00 NBTE GPA Scale & ND/HND levels...');
    const polyReg = await apiJson('/api/v1/auth/register-school', {
      method: 'POST',
      body: {
        schoolName: 'Gateway Federal Model Polytechnic',
        schoolType: 'Polytechnic',
        institutionCategory: 'TERTIARY',
        academicCycleType: 'SEMESTER',
        cycleLabels: ['First Semester', 'Second Semester'],
        gradingMode: 'GPA_4',
        state: 'Ogun',
        lga: 'Abeokuta South',
        address: '12 Polytechnic Road, Abeokuta',
        phone: '08031119988',
        email: 'registrar@gatewaypoly.edu.ng',
        ownerName: 'Dr. Tunde Bakare',
        ownerEmail: 'rector@gatewaypoly.edu.ng',
        password: 'Password123!',
        question1: 'City?',
        answer1: 'Abeokuta',
        question2: 'Motto?',
        answer2: 'Skill and Enterprise',
      },
    });
    assert.strictEqual(polyReg.status, 201, `Polytechnic reg failed: ${polyReg.rawText}`);
    const polyToken = polyReg.data.token as string;
    const polyId = (polyReg.data.activeSchoolId || polyReg.data.school.id) as string;
    assert.strictEqual(polyReg.data.settings.grading_mode, 'GPA_4');

    const polyBulk = await apiJson('/api/v1/school/classes/bulk-setup', {
      method: 'POST',
      token: polyToken,
      schoolId: polyId,
      body: { mode: 'POLYTECHNIC' },
    });
    assert.strictEqual(polyBulk.status, 200, `Polytechnic bulk-setup failed: ${polyBulk.rawText}`);
    assert.strictEqual(polyBulk.data.createdClassesCount, 4);
    const polyClassesRes = await apiJson('/api/v1/school/classes', { token: polyToken, schoolId: polyId });
    assert.strictEqual(polyClassesRes.status, 200);
    const nd1 = (polyClassesRes.data.classes || []).find((c: any) => c.name === 'ND 1');
    const hnd2 = (polyClassesRes.data.classes || []).find((c: any) => c.name === 'HND 2');
    assert.ok(nd1 && hnd2, 'Polytechnic bulk-setup must create ND 1 through HND 2');

    const polySess = await apiJson('/api/v1/school/academic-sessions', {
      method: 'POST',
      token: polyToken,
      schoolId: polyId,
      body: { name: '2026/2027', start_date: '2026-10-01', end_date: '2027-07-31', status: 'ACTIVE' },
    });
    const polySessId = polySess.data.session.id as string;
    const polySem1 = await apiJson(`/api/v1/school/academic-sessions/${polySessId}/terms`, {
      method: 'POST',
      token: polyToken,
      schoolId: polyId,
      body: { name: 'First Semester', start_date: '2026-10-01', end_date: '2027-02-28', status: 'ACTIVE' },
    });
    const polySem1Id = polySem1.data.term.id as string;

    const comCourse = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: polyToken,
      schoolId: polyId,
      body: { name: 'Introduction to Computing', code: 'COM 111', class_id: nd1.id, credit_units: 4 },
    });
    const staCourse = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: polyToken,
      schoolId: polyId,
      body: { name: 'Descriptive Statistics', code: 'STA 111', class_id: nd1.id, credit_units: 3 },
    });
    const polyStu = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: polyToken,
      schoolId: polyId,
      body: {
        first_name: 'Seyi',
        last_name: 'Adebayo',
        gender: 'Male',
        admission_number: 'GFP/ND/CS/26/014',
        class_id: nd1.id,
        parent_name: 'Mrs. Folake Adebayo',
        parent_phone: '08087776655',
      },
    });
    const polyExam = await apiJson('/api/v1/school/examinations', {
      method: 'POST',
      token: polyToken,
      schoolId: polyId,
      body: { title: 'ND 1 First Semester Exam', academic_session_id: polySessId, term_id: polySem1Id, class_id: nd1.id, status: 'OPEN' },
    });
    // 78 -> 4.00 GP (4u = 16 QP), 72 -> 3.50 GP (3u = 10.5 QP) => 26.5 / 7 = 3.79 (Distinction)
    await apiJson(`/api/v1/school/examinations/${polyExam.data.examination.id}/scores`, {
      method: 'PUT',
      token: polyToken,
      schoolId: polyId,
      body: {
        entries: [
          { student_id: polyStu.data.student.id, subject_id: comCourse.data.subject.id, ca_score: 26, exam_score: 52 },
          { student_id: polyStu.data.student.id, subject_id: staCourse.data.subject.id, ca_score: 22, exam_score: 50 },
        ],
      },
    });
    const polyRcGen = await apiJson('/api/v1/school/report-cards/generate', {
      method: 'POST',
      token: polyToken,
      schoolId: polyId,
      body: { student_id: polyStu.data.student.id, academic_session_id: polySessId, term_id: polySem1Id },
    });
    const polyRcDetail = await apiJson(`/api/v1/school/report-cards/${polyRcGen.data.reportCards[0].id}`, {
      token: polyToken,
      schoolId: polyId,
    });
    const polyBd = polyRcDetail.data.reportCard.breakdown;
    assert.strictEqual(polyBd.gradingMode, 'GPA_4');
    assert.strictEqual(Number(polyBd.gpa_scale_max), 4);
    assert.strictEqual(Number(polyBd.gpa), 3.79, `Expected NBTE 4.00 GPA 3.79, got ${polyBd.gpa}`);
    assert.strictEqual(polyBd.academic_standing, 'Distinction');

    // =========================================================================
    // SCENARIO D: NON-DESTRUCTIVE UPGRADE OF EXISTING K-12 SCHOOL (ZERO DATA LOSS)
    // =========================================================================
    console.log('6. Verifying NON-DESTRUCTIVE customization of an existing K-12 school with live records...');
    const k12Reg = await apiJson('/api/v1/auth/register-school', {
      method: 'POST',
      body: {
        schoolName: 'Heritage Legacy Academy',
        schoolType: 'Secondary',
        state: 'Lagos',
        lga: 'Surulere',
        address: '8 Bode Thomas Street, Surulere',
        phone: '08023334455',
        email: 'admin@heritagelegacy.edu.ng',
        ownerName: 'Mrs. Grace Balogun',
        ownerEmail: 'grace@heritagelegacy.edu.ng',
        password: 'Password123!',
        question1: 'City?',
        answer1: 'Lagos',
        question2: 'Motto?',
        answer2: 'Truth',
      },
    });
    assert.strictEqual(k12Reg.status, 201);
    const k12Token = k12Reg.data.token as string;
    const k12Id = (k12Reg.data.activeSchoolId || k12Reg.data.school.id) as string;
    assert.strictEqual(k12Reg.data.settings.institution_category, 'K12');
    assert.strictEqual(k12Reg.data.settings.academic_cycle_type, 'TERM');
    assert.strictEqual(k12Reg.data.settings.grading_mode, 'PERCENTAGE');

    // Populate real K-12 records: class, student, invoice, payment, exam, score, report card
    const k12Class = await apiJson('/api/v1/school/classes', {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: { name: 'JSS 1', level: 'Junior Secondary' },
    });
    const k12ClassId = k12Class.data.class.id as string;

    const k12Sess = await apiJson('/api/v1/school/academic-sessions', {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: { name: '2026/2027', start_date: '2026-09-01', end_date: '2027-07-31', status: 'ACTIVE' },
    });
    const k12SessId = k12Sess.data.session.id as string;
    const k12Term = await apiJson(`/api/v1/school/academic-sessions/${k12SessId}/terms`, {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: { name: 'First Term', start_date: '2026-09-01', end_date: '2026-12-18', status: 'ACTIVE' },
    });
    const k12TermId = k12Term.data.term.id as string;

    const k12Stu = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: {
        first_name: 'Tobi',
        last_name: 'Adeyemi',
        gender: 'Male',
        class_id: k12ClassId,
        parent_name: 'Mr. Femi Adeyemi',
        parent_phone: '08051112233',
      },
    });
    const k12StuId = k12Stu.data.student.id as string;
    const k12AdmNo = k12Stu.data.student.admission_number as string;

    const k12Inv = await apiJson('/api/v1/school/invoices', {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: {
        student_id: k12StuId,
        academic_session_id: k12SessId,
        term_id: k12TermId,
        class_id: k12ClassId,
        due_date: '2026-10-15',
        items: [{ description: 'First Term Tuition Fee', quantity: 1, unit_amount: 45000 }],
      },
    });
    assert.strictEqual(k12Inv.status, 201, `K12 invoice failed: ${k12Inv.rawText}`);
    const k12InvId = k12Inv.data.invoice.id as string;

    const k12Pay = await apiJson(`/api/v1/school/invoices/${k12InvId}/payments`, {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: { amount: 20000, payment_method: 'BANK_TRANSFER', notes: 'Part payment' },
    });
    assert.strictEqual(k12Pay.status, 201, `K12 payment failed: ${k12Pay.rawText}`);

    const k12Subj = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: { name: 'English Language', code: 'ENG', class_id: k12ClassId },
    });
    const k12Exam = await apiJson('/api/v1/school/examinations', {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: { title: 'First Term Exam', academic_session_id: k12SessId, term_id: k12TermId, class_id: k12ClassId, status: 'OPEN' },
    });
    await apiJson(`/api/v1/school/examinations/${k12Exam.data.examination.id}/scores`, {
      method: 'PUT',
      token: k12Token,
      schoolId: k12Id,
      body: {
        entries: [{ student_id: k12StuId, subject_id: k12Subj.data.subject.id, ca_score: 34, exam_score: 50 }],
      },
    });
    const k12Rc = await apiJson('/api/v1/school/report-cards/generate', {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: { student_id: k12StuId, academic_session_id: k12SessId, term_id: k12TermId },
    });
    const k12RcId = k12Rc.data.reportCards[0].id as string;

    // Switch existing K-12 school to Tertiary + Semesters + GPA_5 + Custom Terminology
    const upgradeRes = await apiJson('/api/v1/school/settings', {
      method: 'PUT',
      token: k12Token,
      schoolId: k12Id,
      body: {
        institution_category: 'TERTIARY',
        academic_cycle_type: 'SEMESTER',
        cycle_labels_json: JSON.stringify(['Harmattan Semester', 'Rain Semester']),
        grading_mode: 'GPA_5',
        terminology_json: JSON.stringify({
          student_singular: 'Cadet',
          student_plural: 'Cadets',
          class_plural: 'Squadrons',
        }),
      },
    });
    assert.strictEqual(upgradeRes.status, 200, `Settings upgrade failed: ${upgradeRes.rawText}`);
    assert.strictEqual(upgradeRes.data.settings.institution_category, 'TERTIARY');
    assert.strictEqual(upgradeRes.data.settings.grading_mode, 'GPA_5');

    // Verify 100% of pre-existing student, invoice, payment, and report card data is UNTOUCHED
    const stuAfter = await apiJson(`/api/v1/school/students`, { token: k12Token, schoolId: k12Id });
    assert.strictEqual(stuAfter.data.students.length, 1);
    assert.strictEqual(stuAfter.data.students[0].id, k12StuId);
    assert.strictEqual(stuAfter.data.students[0].admission_number, k12AdmNo);

    const invAfter = await apiJson(`/api/v1/school/invoices/${k12InvId}`, { token: k12Token, schoolId: k12Id });
    assert.strictEqual(invAfter.status, 200);
    assert.strictEqual(Number(invAfter.data.invoice.total), 4500000);
    assert.strictEqual(Number(invAfter.data.invoice.amount_paid), 2000000);
    assert.strictEqual(Number(invAfter.data.invoice.balance), 2500000);

    const rcAfter = await apiJson(`/api/v1/school/report-cards/${k12RcId}`, { token: k12Token, schoolId: k12Id });
    assert.strictEqual(rcAfter.status, 200);
    assert.strictEqual(Number(rcAfter.data.reportCard.total_score), 84);

    // =========================================================================
    // SCENARIO E: HEADLESS CHROMIUM UI VERIFICATION (Registration, Admin, Transcript, Public Site)
    // =========================================================================
    console.log('7. Testing Higher Institution UI end-to-end in headless Chromium...');

    // 7A. Registration Page -> Toggle Higher Institution / Tertiary
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.clearAuth();
    await cdp.gotoFresh(`${TEST_BASE}/#register`);
    await cdp.waitForText('Higher Institution / Tertiary');
    await cdp.clickButtonContaining('Higher Institution / Tertiary');
    await cdp.waitForText('Academic Calendar Structure');
    await cdp.waitForText('Result & Transcript Grading Scale');
    await cdp.waitForText('5.00 GPA / CGPA Scale (NUC University & College Standard)');
    await cdp.checkNoHorizontalOverflow('Register Higher Institution 1440px');

    // 7B. University Admin Dashboard -> Adaptive Sidebar, Settings Hub & Printable Academic Transcript
    await cdp.setAuthToken(uniToken, uniId);
    await cdp.gotoFresh(`${TEST_BASE}/#overview`);
    await cdp.waitForText('Horizon University of Science & Technology');
    await cdp.waitForText('Levels & Departments');
    await cdp.waitForText('Sessions & Semesters');
    await cdp.waitForText('Lecture Notes & Desk');
    await cdp.checkNoHorizontalOverflow('University Admin Overview 1440px');

    // Navigate to Settings -> verify Institutional Mode & Custom Terminology Hub
    await cdp.gotoFresh(`${TEST_BASE}/#settings`);
    await cdp.waitForText('Institutional Mode, Academic Calendar & Bursary Settings');
    await cdp.waitForText('University (Harmattan & Rain · 5.0 GPA)');
    await cdp.waitForText('Non-destructive — existing students, fees & scores remain untouched');
    await cdp.checkNoHorizontalOverflow('University Settings 1440px');

    // Navigate to Performance -> Results & Transcripts -> Full-Session Cumulative Reports -> Open Printable Transcript Modal
    await cdp.gotoFresh(`${TEST_BASE}/#performance`);
    await cdp.waitForText('Courses');
    await cdp.clickButtonContaining('Results & Transcripts');
    await cdp.waitForText('Full-Session Cumulative Reports');
    await cdp.clickButtonContaining('Full-Session Cumulative Reports');
    await cdp.waitForText('Amaka Nwankwo');
    await cdp.clickButtonContaining('View / Print');
    await cdp.waitForText('ACADEMIC TRANSCRIPT');
    await cdp.waitForText('4.28');
    await cdp.waitForText('Second Class Upper (2:1)');
    await cdp.waitForText('HUST/CSC/26/001');
    await cdp.checkNoHorizontalOverflow('University Printable Transcript 1440px');

    // 7C. Public University Website at 1440px and 360px
    await cdp.clearAuth();
    await cdp.gotoFresh(`${TEST_BASE}/site/${uniSlug}`);
    await cdp.waitForText('Horizon University of Science & Technology');
    await cdp.waitForText('Official University Website');
    await cdp.waitForText('Harmattan Semester');
    await cdp.checkNoHorizontalOverflow('University Public Site 1440px');
    await cdp.setViewport(360, 800, true);
    await cdp.checkNoHorizontalOverflow('University Public Site 360px');
    await cdp.setViewport(1440, 900, false);

    // =========================================================================
    // SCENARIO F: FULL SERVER RESTART PERSISTENCE CHECK
    // =========================================================================
    console.log('8. Restarting isolated server to verify 100% persistence...');
    await stopProcess(serverProc);
    serverProc = await startIsolatedServer(tmpDir);

    const postRestartSettings = await apiJson('/api/v1/school/settings', { token: k12Token, schoolId: k12Id });
    assert.strictEqual(postRestartSettings.status, 200);
    assert.strictEqual(postRestartSettings.data.settings.institution_category, 'TERTIARY');
    assert.ok(String(postRestartSettings.data.settings.terminology_json).includes('Squadrons'));

    const postRestartTranscript = await apiJson(`/api/v1/school/session-report-cards/${sessionRcId}`, {
      token: uniToken,
      schoolId: uniId,
    });
    assert.strictEqual(postRestartTranscript.status, 200);
    assert.strictEqual(Number(postRestartTranscript.data.sessionReportCard.breakdown.cgpa), 4.28);

    assert.strictEqual(cdp.pageErrors.length, 0, `Uncaught page errors: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.consoleErrors.length, 0, `Console errors: ${cdp.consoleErrors.join(' | ')}`);
    assert.strictEqual(
      cdp.apiServerErrors.length,
      0,
      `5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`
    );

    console.log('✅ ALL HIGHER INSTITUTION / TERTIARY, GPA/CGPA & NON-DESTRUCTIVE CUSTOMIZATION E2E TESTS PASSED!');
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
  console.error('❌ HIGHER INSTITUTION E2E TEST FAILED:', err);
  process.exit(1);
});
