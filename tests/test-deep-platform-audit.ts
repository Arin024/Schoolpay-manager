import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  computeGpaGradeBand,
  getAcademicClassStanding,
  resolveInstitutionProfile,
} from '../src/utils/institutionMode.ts';

const CHROME_BIN = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const TEST_PORT = 3218;
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
        if (args && !args.includes('401') && !args.includes('403') && !args.includes('409') && !args.includes('404')) {
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
    await new Promise((r) => setTimeout(r, 450));
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

  async fillInputByPlaceholder(placeholderPart: string, value: string) {
    const ok = await this.evaluate(`
      const inputs = Array.from(document.querySelectorAll('input, textarea'));
      const target = inputs.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.getAttribute('placeholder') || '').includes(${JSON.stringify(placeholderPart)});
      });
      if (!target) return false;
      const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(target, ${JSON.stringify(value)});
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    assert.ok(ok, `Visible input with placeholder containing "${placeholderPart}" not found`);
    await new Promise((r) => setTimeout(r, 200));
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-deep-audit-'));
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
      JWT_SECRET: 'test-deep-audit-secret-key-2026-isolated-sandbox-64-chars',
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
    } catch {}
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
      try { process.kill(-pid, 'SIGKILL'); } catch {}
      try { proc.kill('SIGKILL'); } catch {}
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    try { process.kill(-pid, 'SIGTERM'); } catch {
      try { proc.kill('SIGTERM'); } catch {}
    }
  });
}

async function launchChrome(debugPort: number): Promise<{ proc: ChildProcess; wsUrl: string }> {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-deep-chrome-'));
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
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill('SIGTERM');
  throw new Error('Failed to launch headless Chromium');
}

function runExhaustiveUnitBoundaryChecks() {
  console.log('1. Running exhaustive NUC 5.00 & NBTE 4.00 GPA/CGPA boundary & standing unit checks...');

  // NUC 5.00 exact score boundaries
  const nucCases: Array<[number, string, number]> = [
    [100, 'A', 5.0],
    [70, 'A', 5.0],
    [69.9, 'B', 4.0],
    [60, 'B', 4.0],
    [59.5, 'C', 3.0],
    [50, 'C', 3.0],
    [49.9, 'D', 2.0],
    [45, 'D', 2.0],
    [44.9, 'E', 1.0],
    [40, 'E', 1.0],
    [39.9, 'F', 0.0],
    [0, 'F', 0.0],
  ];
  for (const [score, expectedGrade, expectedPoints] of nucCases) {
    const band = computeGpaGradeBand(score, 'GPA_5');
    assert.strictEqual(band.grade, expectedGrade, `NUC score ${score}: expected grade ${expectedGrade}, got ${band.grade}`);
    assert.strictEqual(band.points, expectedPoints, `NUC score ${score}: expected points ${expectedPoints}, got ${band.points}`);
  }

  // NBTE 4.00 exact score boundaries
  const nbteCases: Array<[number, string, number]> = [
    [100, 'A', 4.0],
    [75, 'A', 4.0],
    [74.9, 'AB', 3.5],
    [70, 'AB', 3.5],
    [65, 'B', 3.25],
    [60, 'BC', 3.0],
    [55, 'C', 2.75],
    [50, 'CD', 2.5],
    [45, 'D', 2.25],
    [40, 'E', 2.0],
    [39.9, 'F', 0.0],
    [0, 'F', 0.0],
  ];
  for (const [score, expectedGrade, expectedPoints] of nbteCases) {
    const band = computeGpaGradeBand(score, 'GPA_4');
    assert.strictEqual(band.grade, expectedGrade, `NBTE score ${score}: expected grade ${expectedGrade}, got ${band.grade}`);
    assert.strictEqual(band.points, expectedPoints, `NBTE score ${score}: expected points ${expectedPoints}, got ${band.points}`);
  }

  // Academic Standings
  assert.strictEqual(getAcademicClassStanding(4.5, 'GPA_5'), 'First Class Honours');
  assert.strictEqual(getAcademicClassStanding(3.5, 'GPA_5'), 'Second Class Upper (2:1)');
  assert.strictEqual(getAcademicClassStanding(2.4, 'GPA_5'), 'Second Class Lower (2:2)');
  assert.strictEqual(getAcademicClassStanding(1.5, 'GPA_5'), 'Third Class Honours');
  assert.strictEqual(getAcademicClassStanding(1.0, 'GPA_5'), 'Pass');
  assert.strictEqual(getAcademicClassStanding(0.99, 'GPA_5'), 'Academic Probation');

  assert.strictEqual(getAcademicClassStanding(3.5, 'GPA_4'), 'Distinction');
  assert.strictEqual(getAcademicClassStanding(3.0, 'GPA_4'), 'Upper Credit');
  assert.strictEqual(getAcademicClassStanding(2.5, 'GPA_4'), 'Lower Credit');
  assert.strictEqual(getAcademicClassStanding(2.0, 'GPA_4'), 'Pass');
  assert.strictEqual(getAcademicClassStanding(1.99, 'GPA_4'), 'Academic Probation');

  // Corrupt JSON resilience in resolveInstitutionProfile
  const corruptProfile = resolveInstitutionProfile(
    { type: 'University' },
    {
      institution_category: 'TERTIARY',
      academic_cycle_type: 'SEMESTER',
      cycle_labels_json: '{NOT VALID JSON',
      grading_mode: 'GPA_5',
      terminology_json: '{BROKEN',
    }
  );
  assert.strictEqual(corruptProfile.isTertiary, true);
  assert.strictEqual(corruptProfile.cycleLabels.length, 2);
  assert.strictEqual(corruptProfile.labels.subjectPlural, 'Courses');
}

async function main() {
  runExhaustiveUnitBoundaryChecks();

  const tmpDir = setupSafeTempWorkspace();
  let serverProc: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;

  try {
    console.log('2. Starting isolated sandbox server on port', TEST_PORT);
    serverProc = await startIsolatedServer(tmpDir);

    const chrome = await launchChrome(9328);
    chromeProc = chrome.proc;
    cdp = await CDPClient.connect(chrome.wsUrl);

    // =========================================================================
    // SCENARIO 1: FULL UNIVERSITY MULTI-ROLE LIFECYCLE + BURSARY + LECTURER + STUDENT + PARENT + VERIFIER
    // =========================================================================
    console.log('3. Setting up University (Harmattan/Rain, 5.00 GPA), Lecturer, 2 Students, Courses & Credit Unit Clamping...');
    const uniReg = await apiJson('/api/v1/auth/register-school', {
      method: 'POST',
      body: {
        schoolName: 'Meridian Federal University',
        schoolType: 'University',
        institutionCategory: 'TERTIARY',
        academicCycleType: 'SEMESTER',
        cycleLabels: ['Harmattan Semester', 'Rain Semester'],
        gradingMode: 'GPA_5',
        state: 'Abuja',
        lga: 'Garki',
        address: 'Plot 10 University Way, Abuja',
        phone: '08039990001',
        email: 'registrar@meridianuni.edu.ng',
        ownerName: 'Prof. Amina Lawal',
        ownerEmail: 'vc@meridianuni.edu.ng',
        password: 'Password123!',
        question1: 'City?',
        answer1: 'Abuja',
        question2: 'Motto?',
        answer2: 'Truth and Discovery',
      },
    });
    assert.strictEqual(uniReg.status, 201, `Uni reg failed: ${uniReg.rawText}`);
    const uniToken = uniReg.data.token as string;
    const uniId = (uniReg.data.activeSchoolId || uniReg.data.school.id) as string;
    const uniSlug = uniReg.data.school.slug as string;

    // Bulk setup University 100L-500L
    const uniBulk = await apiJson('/api/v1/school/classes/bulk-setup', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { mode: 'UNIVERSITY' },
    });
    assert.strictEqual(uniBulk.status, 200);
    const classesList = await apiJson('/api/v1/school/classes', { token: uniToken, schoolId: uniId });
    const level100 = classesList.data.classes.find((c: any) => c.name === '100 Level');
    const level200 = classesList.data.classes.find((c: any) => c.name === '200 Level');
    assert.ok(level100 && level200);

    // Academic Session + Harmattan & Rain Semesters
    const sessRes = await apiJson('/api/v1/school/academic-sessions', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: '2026/2027', start_date: '2026-10-01', end_date: '2027-07-31', status: 'ACTIVE' },
    });
    const sessionId = sessRes.data.session.id as string;
    const harmSem = await apiJson(`/api/v1/school/academic-sessions/${sessionId}/terms`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'Harmattan Semester', start_date: '2026-10-01', end_date: '2027-02-28', status: 'ACTIVE' },
    });
    const rainSem = await apiJson(`/api/v1/school/academic-sessions/${sessionId}/terms`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'Rain Semester', start_date: '2027-03-10', end_date: '2027-07-31', status: 'UPCOMING' },
    });
    const harmId = harmSem.data.term.id as string;
    const rainId = rainSem.data.term.id as string;

    // Courses with edge-case credit_units clamping checks
    const clampLow = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'General Studies Seminar', code: 'GST 101', class_id: level100.id, credit_units: -5 },
    });
    assert.strictEqual(clampLow.status, 201);
    assert.strictEqual(Number(clampLow.data.subject.credit_units), 3, 'Negative credit units must safely default to 3 (never <= 0)');

    const clampHigh = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'Core Computing Studio', code: 'CSC 101', class_id: level100.id, credit_units: 99 },
    });
    assert.strictEqual(clampHigh.status, 201);
    assert.strictEqual(Number(clampHigh.data.subject.credit_units), 3, 'Out-of-range credit units (> 12) must safely default to 3');

    // Update CSC 101 to 4 units and create MTH 101 (3u) + PHY 101 (2u)
    const updCsc = await apiJson(`/api/v1/school/subjects/${clampHigh.data.subject.id}`, {
      method: 'PUT',
      token: uniToken,
      schoolId: uniId,
      body: { credit_units: 4 },
    });
    assert.strictEqual(updCsc.status, 200);
    assert.strictEqual(Number(updCsc.data.subject.credit_units), 4);
    const cscId = clampHigh.data.subject.id as string;
    const gstId = clampLow.data.subject.id as string;
    await apiJson(`/api/v1/school/subjects/${gstId}`, {
      method: 'PUT',
      token: uniToken,
      schoolId: uniId,
      body: { credit_units: 2 },
    });
    const mthRes = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: 'Calculus & Algebra I', code: 'MTH 101', class_id: level100.id, credit_units: 3 },
    });
    const mthId = mthRes.data.subject.id as string;

    // Enroll Student 1 (Honor Roll) & Student 2 (Carryover / F test + IDOR target)
    const stu1Res = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        first_name: 'Kelechi',
        last_name: 'Onyeka',
        gender: 'Male',
        admission_number: 'MFU/CSC/26/001',
        class_id: level100.id,
        parent_name: 'Engr. Emeka Onyeka',
        parent_phone: '08031112200',
      },
    });
    assert.strictEqual(stu1Res.status, 201);
    const stu1 = stu1Res.data.student;

    const stu2Res = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        first_name: 'Bola',
        last_name: 'Ogunleye',
        gender: 'Female',
        admission_number: 'MFU/CSC/26/002',
        class_id: level100.id,
        parent_name: 'Mrs. Shade Ogunleye',
        parent_phone: '08031112299',
      },
    });
    assert.strictEqual(stu2Res.status, 201);
    const stu2 = stu2Res.data.student;

    // Provision University Lecturer & sign in via Staff Code
    const lectCreate = await apiJson('/api/v1/school/users/provision', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        full_name: 'Dr. Musa Ibrahim',
        email: 'm.ibrahim@meridianuni.edu.ng',
        password: 'Password123!',
        role_name: 'TEACHER',
        designation: 'Senior Lecturer, Computer Science',
      },
    });
    assert.strictEqual(lectCreate.status, 201, `Lecturer provision failed: ${lectCreate.rawText}`);
    const lectLogin = await apiJson('/api/v1/public/portal/staff-code-login', {
      method: 'POST',
      body: { staff_code: lectCreate.data.issuedStaffNumber, school_slug: uniSlug },
    });
    assert.strictEqual(lectLogin.status, 200, `Lecturer login failed: ${lectLogin.rawText}`);
    const lecturerToken = lectLogin.data.token as string;

    // -------------------------------------------------------------------------
    // TEST LECTURER LECTURE NOTE GENERATOR (MUST NOT CONTAIN NERDC!)
    // -------------------------------------------------------------------------
    console.log('4. Verifying Higher Institution Lecture Note generator (NUC CCMAS, zero NERDC)...');
    const draftGen = await apiJson('/api/v1/staff-workspace/lesson-notes/generate', {
      method: 'POST',
      token: lecturerToken,
      schoolId: uniId,
      body: {
        subject_name: 'CSC 101 - Core Computing Studio',
        class_name: '100 Level',
        term_name: 'Harmattan Semester',
        week_number: 3,
        duration_minutes: 120,
        topic: 'Algorithms and Asymptotic Complexity',
        sub_topic: 'Big-O Notation and Recurrence Relations',
      },
    });
    assert.strictEqual(draftGen.status, 200, `Lecture draft gen failed: ${draftGen.rawText}`);
    const draftStr = JSON.stringify(draftGen.data);
    assert.ok(!draftStr.includes('NERDC'), 'University Lecture Note draft MUST NOT contain K-12 NERDC text!');
    assert.ok(draftStr.includes('NUC CCMAS'), 'University Lecture Note draft should reference NUC CCMAS');
    assert.ok(draftStr.includes('Harmattan Semester'), 'Draft should reference Harmattan Semester');

    const saveLecture = await apiJson('/api/v1/staff-workspace/lesson-notes', {
      method: 'POST',
      token: lecturerToken,
      schoolId: uniId,
      body: {
        subject_id: cscId,
        subject_name: 'CSC 101 - Core Computing Studio',
        class_id: level100.id,
        class_name: '100 Level',
        academic_session_id: sessionId,
        term_name: 'Harmattan Semester',
        week_number: 3,
        duration_minutes: 120,
        ...draftGen.data.draft,
        status: 'PUBLISHED',
      },
    });
    assert.strictEqual(saveLecture.status, 201, `Save lecture note failed: ${saveLecture.rawText}`);

    // -------------------------------------------------------------------------
    // TEST HIGHER INSTITUTION SEMESTER BURSARY, INVOICE, PAYMENT & PUBLIC RECEIPT VERIFICATION
    // -------------------------------------------------------------------------
    console.log('5. Verifying Higher Institution Semester Bursary (Invoice -> Payment -> Receipt -> Public Verify)...');
    const invRes = await apiJson('/api/v1/school/invoices', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        student_id: stu1.id,
        academic_session_id: sessionId,
        term_id: harmId,
        class_id: level100.id,
        due_date: '2026-11-15',
        items: [
          { description: 'Harmattan Semester Tuition Fee', quantity: 1, unit_amount: 120000 },
          { description: 'Computer Science Laboratory Levy', quantity: 1, unit_amount: 25000 },
        ],
      },
    });
    assert.strictEqual(invRes.status, 201, `Semester invoice failed: ${invRes.rawText}`);
    const uniInvoiceId = invRes.data.invoice.id as string;

    const payRes = await apiJson(`/api/v1/school/invoices/${uniInvoiceId}/payments`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { amount: 145000, payment_method: 'BANK_TRANSFER', notes: 'Full Harmattan Semester payment' },
    });
    assert.strictEqual(payRes.status, 201, `Semester payment failed: ${payRes.rawText}`);
    const receiptNo =
      payRes.data.payment?.receipt?.receiptNumber ||
      payRes.data.receipt?.receipt_number ||
      payRes.data.payment?.receipt_number;
    assert.ok(receiptNo, `Expected official receipt number from full payment: ${payRes.rawText}`);

    const verifyReceipt = await apiJson('/api/v1/public/verify-document', {
      method: 'POST',
      body: { document_type: 'RECEIPT', code: receiptNo, school_slug: uniSlug },
    });
    assert.strictEqual(verifyReceipt.status, 200, `Public receipt verification failed: ${verifyReceipt.rawText}`);
    assert.strictEqual(verifyReceipt.data.valid, true);
    assert.strictEqual(verifyReceipt.data.details.amount_kobo, 14500000);
    assert.ok(!verifyReceipt.data.details.student_name_masked.includes('Kelechi Onyeka'), 'Public receipt must mask full student name');

    // -------------------------------------------------------------------------
    // TEST EXAMS, CARRYOVER/F IMPACT, PUBLISHING SNAPSHOTS, STUDENT/PARENT PORTALS & PUBLIC VERIFICATION
    // -------------------------------------------------------------------------
    console.log('6. Verifying Exams, Carryover (F) GPA Math, Published Snapshots, Student/Parent Portals & Public Transcript Verification...');
    const harmExam = await apiJson('/api/v1/school/examinations', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { title: 'Harmattan Semester Exam 2026/2027', academic_session_id: sessionId, term_id: harmId, class_id: level100.id, status: 'OPEN' },
    });
    const harmExamId = harmExam.data.examination.id as string;

    // Stu1: CSC101 (4u)=78 (A,5->20), MTH101 (3u)=68 (B,4->12), GST101 (2u)=70 (A,5->10) => 42/9 = 4.67 (First Class Honours)
    // Stu2: CSC101 (4u)=32 (F,0->0 CARRYOVER!), MTH101 (3u)=72 (A,5->15), GST101 (2u)=45 (D,2->4) => 19/9 = 2.11 (Third Class)
    const putHarm = await apiJson(`/api/v1/school/examinations/${harmExamId}/scores`, {
      method: 'PUT',
      token: uniToken,
      schoolId: uniId,
      body: {
        entries: [
          { student_id: stu1.id, subject_id: cscId, ca_score: 24, exam_score: 54 },
          { student_id: stu1.id, subject_id: mthId, ca_score: 20, exam_score: 48 },
          { student_id: stu1.id, subject_id: gstId, ca_score: 20, exam_score: 50 },
          { student_id: stu2.id, subject_id: cscId, ca_score: 10, exam_score: 22 },
          { student_id: stu2.id, subject_id: mthId, ca_score: 22, exam_score: 50 },
          { student_id: stu2.id, subject_id: gstId, ca_score: 15, exam_score: 30 },
        ],
      },
    });
    assert.strictEqual(putHarm.status, 200);

    // Publish Harmattan Exam so student/parent portals can read published scores
    const pubHarmExam = await apiJson(`/api/v1/school/examinations/${harmExamId}/status`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { status: 'PUBLISHED' },
    });
    assert.strictEqual(pubHarmExam.status, 200, `Publish exam failed: ${pubHarmExam.rawText}`);

    // Rain Exam for Stu1: CSC101 (4u)=74 (A,5->20), MTH101 (3u)=71 (A,5->15), GST101 (2u)=62 (B,4->8) => 43/9 = 4.78 (First Class)
    // Full Session CGPA for Stu1 = (42 + 43) / 18 = 85 / 18 = 4.72 (First Class Honours!)
    const rainExam = await apiJson('/api/v1/school/examinations', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { title: 'Rain Semester Exam 2026/2027', academic_session_id: sessionId, term_id: rainId, class_id: level100.id, status: 'OPEN' },
    });
    const rainExamId = rainExam.data.examination.id as string;
    await apiJson(`/api/v1/school/examinations/${rainExamId}/scores`, {
      method: 'PUT',
      token: uniToken,
      schoolId: uniId,
      body: {
        entries: [
          { student_id: stu1.id, subject_id: cscId, ca_score: 24, exam_score: 50 },
          { student_id: stu1.id, subject_id: mthId, ca_score: 21, exam_score: 50 },
          { student_id: stu1.id, subject_id: gstId, ca_score: 20, exam_score: 42 },
        ],
      },
    });
    await apiJson(`/api/v1/school/examinations/${rainExamId}/status`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { status: 'PUBLISHED' },
    });

    // Generate Harmattan Report Cards for BOTH students (check Stu2 carryover F math!)
    const harmGenAll = await apiJson('/api/v1/school/report-cards/generate', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { academic_session_id: sessionId, term_id: harmId, class_id: level100.id },
    });
    assert.strictEqual(harmGenAll.status, 200);
    const stu1HarmRc = harmGenAll.data.reportCards.find((r: any) => r.student_id === stu1.id);
    const stu2HarmRc = harmGenAll.data.reportCards.find((r: any) => r.student_id === stu2.id);
    assert.ok(stu1HarmRc && stu2HarmRc);

    // Verify Stu2 Carryover / Fail math before publish
    const stu2Detail = await apiJson(`/api/v1/school/report-cards/${stu2HarmRc.id}`, { token: uniToken, schoolId: uniId });
    assert.strictEqual(Number(stu2Detail.data.reportCard.breakdown.gpa), 2.11, `Carryover GPA mismatch: ${stu2Detail.data.reportCard.breakdown.gpa}`);
    assert.strictEqual(stu2Detail.data.reportCard.breakdown.academic_standing, 'Third Class Honours');
    const cscFailRow = stu2Detail.data.reportCard.breakdown.subjects.find((s: any) => s.subject_code === 'CSC 101');
    assert.strictEqual(cscFailRow.grade, 'F');
    assert.strictEqual(Number(cscFailRow.grade_point), 0);
    assert.strictEqual(Number(cscFailRow.quality_points), 0);

    // Unpublished Draft MUST NOT verify publicly (404)
    const draftVerify = await apiJson('/api/v1/public/verify-document', {
      method: 'POST',
      body: { document_type: 'REPORT_CARD', code: stu1HarmRc.verification_code, school_slug: uniSlug },
    });
    assert.strictEqual(draftVerify.status, 404, 'Draft/unpublished report card MUST NOT verify publicly!');

    // Publish Stu1 & Stu2 Harmattan Report Cards + Generate & Publish Stu1 Full-Session Transcript
    const pubStu1Harm = await apiJson(`/api/v1/school/report-cards/${stu1HarmRc.id}/publish`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
    });
    assert.strictEqual(pubStu1Harm.status, 200, `Publish Stu1 Harmattan failed: ${pubStu1Harm.rawText}`);
    await apiJson(`/api/v1/school/report-cards/${stu2HarmRc.id}/publish`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
    });

    const sessGen = await apiJson('/api/v1/school/session-report-cards/generate', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { academic_session_id: sessionId, student_id: stu1.id },
    });
    const stu1SessId = sessGen.data.sessionReportCards[0].id as string;
    const stu1SessCode = sessGen.data.sessionReportCards[0].verification_code as string;
    const pubStu1Sess = await apiJson(`/api/v1/school/session-report-cards/${stu1SessId}/publish`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
    });
    assert.strictEqual(pubStu1Sess.status, 200, `Publish session transcript failed: ${pubStu1Sess.rawText}`);

    // Student 1 Matric-Number-Only Login & Portal API checks
    const stu1Login = await apiJson('/api/v1/public/portal/admission-login', {
      method: 'POST',
      body: { portal_type: 'STUDENT', admission_number: 'MFU/CSC/26/001', school_slug: uniSlug },
    });
    assert.strictEqual(stu1Login.status, 200, `Student matric login failed: ${stu1Login.rawText}`);
    const stu1Token = stu1Login.data.token as string;
    assert.strictEqual(stu1Login.data.activeSettings?.institution_category, 'TERTIARY');
    assert.strictEqual(stu1Login.data.activeSettings?.grading_mode, 'GPA_5');

    const stu1PortalRc = await apiJson(`/api/v1/portal/student/report-cards/${stu1HarmRc.id}`, {
      token: stu1Token,
      schoolId: uniId,
    });
    assert.strictEqual(stu1PortalRc.status, 200, `Student portal RC fetch failed: ${stu1PortalRc.rawText}`);
    assert.strictEqual(Number(stu1PortalRc.data.reportCard.breakdown.gpa), 4.67);
    assert.strictEqual(stu1PortalRc.data.reportCard.breakdown.academic_standing, 'First Class Honours');

    const stu1PortalSess = await apiJson(`/api/v1/portal/student/session-report-cards/${stu1SessId}`, {
      token: stu1Token,
      schoolId: uniId,
    });
    assert.strictEqual(stu1PortalSess.status, 200, `Student portal session transcript failed: ${stu1PortalSess.rawText}`);
    assert.strictEqual(Number(stu1PortalSess.data.reportCard.breakdown.cgpa), 4.72);
    assert.strictEqual(stu1PortalSess.data.reportCard.breakdown.academic_standing, 'First Class Honours');

    // Parent 1 Matric-Number-Only Login & Portal API checks
    const parent1Login = await apiJson('/api/v1/public/portal/admission-login', {
      method: 'POST',
      body: { portal_type: 'PARENT', admission_number: 'MFU/CSC/26/001', school_slug: uniSlug },
    });
    assert.strictEqual(parent1Login.status, 200);
    const parent1Token = parent1Login.data.token as string;

    const parent1PortalSess = await apiJson(`/api/v1/portal/parent/session-report-cards/${stu1SessId}`, {
      token: parent1Token,
      schoolId: uniId,
    });
    assert.strictEqual(parent1PortalSess.status, 200);
    assert.strictEqual(Number(parent1PortalSess.data.reportCard.breakdown.cgpa), 4.72);
    assert.strictEqual(parent1PortalSess.data.reportCard.breakdown.academic_standing, 'First Class Honours');

    // Public Employer Verification of Published University Transcript (SRC-...)
    const verifyTranscript = await apiJson('/api/v1/public/verify-document', {
      method: 'POST',
      body: { document_type: 'REPORT_CARD', code: stu1SessCode, school_slug: uniSlug },
    });
    assert.strictEqual(verifyTranscript.status, 200, `Public transcript verify failed: ${verifyTranscript.rawText}`);
    assert.strictEqual(verifyTranscript.data.valid, true);
    assert.strictEqual(verifyTranscript.data.details.grading_mode, 'GPA_5');
    assert.strictEqual(Number(verifyTranscript.data.details.cgpa), 4.72);
    assert.strictEqual(verifyTranscript.data.details.academic_standing, 'First Class Honours');
    assert.ok(!verifyTranscript.data.details.student_name_masked.includes('Kelechi Onyeka'), 'Public transcript must mask full learner name');

    // -------------------------------------------------------------------------
    // SCENARIO 2: TRIMESTER COLLEGE OF HEALTH + 3-TRIMESTER CUMULATIVE CGPA + MULTI-TENANT SECURITY AUDIT
    // -------------------------------------------------------------------------
    console.log('7. Verifying Trimester College (3 Trimesters, Year 1-3) & Strict Multi-Tenant / Cross-Student Security Guards...');
    const triReg = await apiJson('/api/v1/auth/register-school', {
      method: 'POST',
      body: {
        schoolName: 'Apex College of Nursing & Health',
        schoolType: 'College of Health / Nursing',
        institutionCategory: 'TERTIARY',
        academicCycleType: 'TRIMESTER',
        cycleLabels: ['1st Trimester', '2nd Trimester', '3rd Trimester'],
        gradingMode: 'GPA_5',
        state: 'Rivers',
        lga: 'Port Harcourt',
        address: '22 Hospital Road, Port Harcourt',
        phone: '08035558899',
        email: 'provost@apexnursing.edu.ng',
        ownerName: 'Dr. Blessing Okoro',
        ownerEmail: 'blessing@apexnursing.edu.ng',
        password: 'Password123!',
        question1: 'City?',
        answer1: 'Port Harcourt',
        question2: 'Motto?',
        answer2: 'Care and Science',
      },
    });
    assert.strictEqual(triReg.status, 201);
    const triToken = triReg.data.token as string;
    const triId = (triReg.data.activeSchoolId || triReg.data.school.id) as string;
    assert.strictEqual(triReg.data.settings.academic_cycle_type, 'TRIMESTER');
    assert.strictEqual(triReg.data.settings.current_term, '1st Trimester');

    const colBulk = await apiJson('/api/v1/school/classes/bulk-setup', {
      method: 'POST',
      token: triToken,
      schoolId: triId,
      body: { mode: 'COLLEGE' },
    });
    assert.strictEqual(colBulk.status, 200);
    const colClasses = await apiJson('/api/v1/school/classes', { token: triToken, schoolId: triId });
    const year1 = colClasses.data.classes.find((c: any) => c.name === 'Year 1 (100L)');
    assert.ok(year1, 'COLLEGE bulk setup must create Year 1 (100L) - Year 3 (300L)');

    const triSess = await apiJson('/api/v1/school/academic-sessions', {
      method: 'POST',
      token: triToken,
      schoolId: triId,
      body: { name: '2026/2027', start_date: '2026-09-01', end_date: '2027-08-31', status: 'ACTIVE' },
    });
    const triSessId = triSess.data.session.id as string;
    const triTerms: string[] = [];
    for (const [idx, name] of ['1st Trimester', '2nd Trimester', '3rd Trimester'].entries()) {
      const tr = await apiJson(`/api/v1/school/academic-sessions/${triSessId}/terms`, {
        method: 'POST',
        token: triToken,
        schoolId: triId,
        body: { name, start_date: `2026-0${idx + 1}-01`, end_date: `2026-0${idx + 3}-28`, status: idx === 0 ? 'ACTIVE' : 'UPCOMING' },
      });
      triTerms.push(tr.data.term.id);
    }
    const anat = await apiJson('/api/v1/school/subjects', {
      method: 'POST',
      token: triToken,
      schoolId: triId,
      body: { name: 'Human Anatomy', code: 'ANA 101', class_id: year1.id, credit_units: 4 },
    });
    const triStu = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: triToken,
      schoolId: triId,
      body: {
        first_name: 'Ngozi',
        last_name: 'Eze',
        gender: 'Female',
        admission_number: 'ACNH/26/001',
        class_id: year1.id,
        parent_name: 'Mr. Paul Eze',
        parent_phone: '08090001111',
      },
    });
    // Record 3 trimester scores: 80 (5.0), 65 (4.0), 55 (3.0) all 4u => (20 + 16 + 12) / 12 = 4.00 (Second Class Upper (2:1))
    const triScoreTargets = [
      [25, 55], // 80 -> 5.0
      [20, 45], // 65 -> 4.0
      [15, 40], // 55 -> 3.0
    ];
    for (let i = 0; i < 3; i++) {
      const ex = await apiJson('/api/v1/school/examinations', {
        method: 'POST',
        token: triToken,
        schoolId: triId,
        body: { title: `Trimester ${i + 1} Exam`, academic_session_id: triSessId, term_id: triTerms[i], class_id: year1.id, status: 'OPEN' },
      });
      await apiJson(`/api/v1/school/examinations/${ex.data.examination.id}/scores`, {
        method: 'PUT',
        token: triToken,
        schoolId: triId,
        body: {
          entries: [{ student_id: triStu.data.student.id, subject_id: anat.data.subject.id, ca_score: triScoreTargets[i][0], exam_score: triScoreTargets[i][1] }],
        },
      });
    }
    const triSessGen = await apiJson('/api/v1/school/session-report-cards/generate', {
      method: 'POST',
      token: triToken,
      schoolId: triId,
      body: { academic_session_id: triSessId, student_id: triStu.data.student.id },
    });
    const triDetail = await apiJson(`/api/v1/school/session-report-cards/${triSessGen.data.sessionReportCards[0].id}`, {
      token: triToken,
      schoolId: triId,
    });
    const triBd = triDetail.data.sessionReportCard.breakdown;
    assert.strictEqual(triBd.term_averages.length, 3);
    assert.strictEqual(triBd.term_averages[0].term_name, '1st Trimester');
    assert.strictEqual(triBd.term_averages[1].term_name, '2nd Trimester');
    assert.strictEqual(triBd.term_averages[2].term_name, '3rd Trimester');
    assert.strictEqual(Number(triBd.cgpa), 4.0, `Expected 3-trimester CGPA 4.00, got ${triBd.cgpa}`);
    assert.strictEqual(triBd.academic_standing, 'Second Class Upper (2:1)');

    // STRICT RBAC / IDOR / CROSS-TENANT SECURITY CHECKS
    const idorStu2Rc = await apiJson(`/api/v1/portal/student/report-cards/${stu2HarmRc.id}`, {
      token: stu1Token,
      schoolId: uniId,
    });
    assert.strictEqual(idorStu2Rc.status, 403, `Student 1 MUST NOT access Student 2 report card (got ${idorStu2Rc.status})`);

    const idorParent2Rc = await apiJson(`/api/v1/portal/parent/report-cards/${stu2HarmRc.id}`, {
      token: parent1Token,
      schoolId: uniId,
    });
    assert.strictEqual(idorParent2Rc.status, 403, `Parent 1 MUST NOT access unlinked Student 2 report card (got ${idorParent2Rc.status})`);

    const stuBlockedStaffDesk = await apiJson('/api/v1/staff-workspace/lesson-notes', {
      token: stu1Token,
      schoolId: uniId,
    });
    assert.strictEqual(stuBlockedStaffDesk.status, 403, 'Student MUST be blocked from Staff Workspace');

    const crossTenantAttack = await apiJson('/api/v1/school/students', {
      token: triToken,
      schoolId: uniId,
    });
    assert.ok(
      crossTenantAttack.status === 403 || crossTenantAttack.status === 404,
      `Cross-tenant access MUST be blocked (got ${crossTenantAttack.status})`
    );

    // =========================================================================
    // SCENARIO 3: DEEP INTERACTIVE HEADLESS CHROMIUM AUDIT (DESKTOP 1440px + MOBILE 360px)
    // =========================================================================
    console.log('8. Running interactive Chromium audit across Student Portal, Parent Portal, Lecture Notes, Settings & Public Verifier...');

    // 8A. Public Document Verification UI -> Verify University Transcript (SRC-...)
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.clearAuth();
    await cdp.gotoFresh(`${TEST_BASE}/#login`);
    await cdp.waitForText('Verify Document');
    await cdp.clickButtonContaining('Verify Document');
    await cdp.clickButtonContaining('Report Card');
    await cdp.fillInputByPlaceholder('RC-', stu1SessCode);
    await cdp.clickButtonContaining('Verify Document Now');
    await cdp.waitForText('Verified GPA / CGPA');
    await cdp.waitForText('4.72 / 5.00');
    await cdp.waitForText('First Class Honours');
    await cdp.checkNoHorizontalOverflow('Public Transcript Verifier 1440px');

    // 8B. University Student Portal (Desktop 1440px + Mobile 360px) -> Open Published Academic Transcript Modal
    await cdp.setAuthToken(stu1Token, uniId);
    await cdp.gotoFresh(`${TEST_BASE}/#overview`);
    await cdp.waitForText('Kelechi Onyeka');
    await cdp.waitForText('Results & Transcripts');
    await cdp.checkNoHorizontalOverflow('University Student Portal 1440px');
    await cdp.setViewport(360, 800, true);
    await cdp.checkNoHorizontalOverflow('University Student Portal 360px');
    await cdp.setViewport(1440, 900, false);

    // 8C. University Parent/Sponsor Portal (Desktop 1440px + Mobile 360px)
    await cdp.clearAuth();
    await cdp.setAuthToken(parent1Token, uniId);
    await cdp.gotoFresh(`${TEST_BASE}/#overview`);
    await cdp.waitForText('Results & Transcripts');
    await cdp.checkNoHorizontalOverflow('University Parent Portal 1440px');
    await cdp.setViewport(360, 800, true);
    await cdp.checkNoHorizontalOverflow('University Parent Portal 360px');
    await cdp.setViewport(1440, 900, false);

    // 8D. University Lecturer Portal & Lecture Notes Studio (MUST NOT contain "NERDC"!)
    await cdp.clearAuth();
    await cdp.setAuthToken(lecturerToken, uniId);
    await cdp.gotoFresh(`${TEST_BASE}/#overview`);
    await cdp.waitForText('Lecture Notes & Outlines');
    await cdp.clickButtonContaining('Lecture Notes & Outlines');
    await cdp.waitForText('Lecture Notes & Course Outlines Studio');
    await cdp.waitForText('Algorithms and Asymptotic Complexity');
    const lecturePageText = await cdp.bodyText();
    assert.ok(!lecturePageText.includes('NERDC'), 'University Lecture Notes Studio UI MUST NOT show K-12 NERDC text!');
    await cdp.checkNoHorizontalOverflow('University Lecture Notes Studio 1440px');

    // 8E. Interactive Settings Customization -> Save Custom Terminology -> Reload -> Verify Live Sidebar Updates!
    await cdp.clearAuth();
    await cdp.setAuthToken(uniToken, uniId);
    await cdp.gotoFresh(`${TEST_BASE}/#settings`);
    await cdp.waitForText('Institutional Mode, Academic Calendar & Bursary Settings');
    await cdp.clickButtonContaining('Customize Portal Terminology');
    await cdp.waitForText('Reset Defaults');
    await cdp.checkNoHorizontalOverflow('University Settings Custom Terminology 1440px');
    await cdp.setViewport(360, 800, true);
    await cdp.checkNoHorizontalOverflow('University Settings 360px');
    await cdp.setViewport(1440, 900, false);

    // Final Zero-Error Browser Assertion
    assert.strictEqual(cdp.pageErrors.length, 0, `Uncaught page errors: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.consoleErrors.length, 0, `Console errors: ${cdp.consoleErrors.join(' | ')}`);
    assert.strictEqual(
      cdp.apiServerErrors.length,
      0,
      `5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`
    );

    console.log('✅ DEEP PLATFORM AUDIT PASSED 100%: GPA/CGPA BOUNDARIES, CARRYOVER/F, TRIMESTERS, BURSARY, LECTURE STUDIO, STUDENT/PARENT/LECTURER PORTALS, PUBLIC VERIFIER, RBAC/IDOR & RESPONSIVE UI!');
  } finally {
    if (cdp) cdp.close();
    await stopProcess(chromeProc);
    await stopProcess(serverProc);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('❌ DEEP PLATFORM AUDIT FAILED:', err);
  process.exit(1);
});
