import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_BIN = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const TEST_PORT = 3224;
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
    await new Promise((r) => setTimeout(r, 250));
  }

  async send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url: string) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 1200));
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        `Browser eval error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`
      );
    }
    return res.result?.value;
  }

  async waitForText(snippet: string, timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    const needle = snippet.toLowerCase();
    while (Date.now() - start < timeoutMs) {
      const ok = await this.evaluate<boolean>(
        `Boolean(document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(needle)}))`
      );
      if (ok) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    const body = await this.evaluate<string>(`(document.body?.innerText || '').slice(0, 700)`);
    throw new Error(`Timed out waiting for text "${snippet}". Current body:\n${body}`);
  }

  async clickButtonByText(text: string): Promise<void> {
    const clicked = await this.evaluate<boolean>(`(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      const target = btns.find((el) => (el.textContent || '').trim().includes(${JSON.stringify(text)}));
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    })()`);
    assert.strictEqual(clicked, true, `Could not find clickable element containing "${text}"`);
    await new Promise((r) => setTimeout(r, 450));
  }

  async close() {
    this.ws.close();
  }
}

async function apiJson(
  endpoint: string,
  opts: { method?: string; token?: string; schoolId?: string; body?: any } = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.schoolId) headers['X-School-Id'] = opts.schoolId;
  const res = await fetch(`${TEST_BASE}${endpoint}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function waitForHealth(timeoutMs = 25000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${TEST_BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Isolated test server failed to respond on /api/health');
}

async function main() {
  const rootDir = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-course-backlog-privacy-'));
  const chromeDataDir = path.join(tmpDir, 'chrome-profile');
  fs.mkdirSync(chromeDataDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });

  for (const entry of [
    'node_modules',
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'schema.sql',
    'schema.pg.sql',
    'server.ts',
    'server',
    'src',
    'public',
    'migrations',
    'dist',
  ]) {
    const srcPath = path.join(rootDir, entry);
    if (fs.existsSync(srcPath)) {
      fs.symlinkSync(srcPath, path.join(tmpDir, entry));
    }
  }

  const tsxBin = path.join(rootDir, 'node_modules', '.bin', 'tsx');
  const serverEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || '/root',
    NODE_ENV: 'development',
    RENDER: '1',
    PORT: String(TEST_PORT),
    JWT_SECRET: 'test-secret-course-reg-backlog-privacy-2026-isolated-sandbox-64chars',
    ALLOW_SANDBOX_PAYMENTS: 'true',
    DISABLE_HMR: 'true',
  };

  const serverProc: ChildProcess = spawn(tsxBin, ['server.ts'], {
    cwd: tmpDir,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLogs = '';
  serverProc.stdout?.on('data', (d) => {
    serverLogs += String(d);
  });
  serverProc.stderr?.on('data', (d) => {
    serverLogs += String(d);
  });

  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;

  try {
    console.log('1. Starting isolated SQLite sandbox server on port', TEST_PORT);
    await waitForHealth();
    console.log('   Server healthy.');

    // =========================================================================
    // 2. REGISTER UNIVERSITY (5-POINT GPA, SEMESTERS) & K-12 SCHOOL
    // =========================================================================
    console.log('2. Registering Higher Institution (University) & checking defaults...');
    const regUni = await apiJson('/api/v1/auth/register-school', {
      method: 'POST',
      body: {
        schoolName: 'Horizon Federal University',
        schoolType: 'University',
        institutionCategory: 'TERTIARY',
        academicCycleType: 'SEMESTER',
        cycleLabels: ['First Semester', 'Second Semester'],
        gradingMode: 'GPA_5',
        state: 'Lagos',
        lga: 'Yaba',
        address: '12 Campus Drive, Yaba',
        phone: '+2348030001122',
        email: 'registrar@horizonuni.edu.ng',
        ownerName: 'Registrar Ogunleye',
        ownerEmail: 'registrar@horizonuni.edu.ng',
        password: 'Password123!',
        question1: 'City?',
        answer1: 'Lagos',
        question2: 'Motto?',
        answer2: 'Knowledge',
      },
    });
    assert.strictEqual(regUni.status, 201, `University registration failed: ${JSON.stringify(regUni.data)}`);
    const uniToken = regUni.data.token;
    const uniSchoolId = regUni.data.school?.id || regUni.data.activeSchool?.id || regUni.data.activeSchoolId;
    const uniSlug = regUni.data.school?.portal_subdomain || regUni.data.school?.slug || regUni.data.activeSchool?.slug;
    assert.ok(uniToken && uniSchoolId && uniSlug, `Missing university auth metadata: ${JSON.stringify(regUni.data)}`);

    // Fetch or create active academic session & semester
    const [sessRes, clsRes] = await Promise.all([
      apiJson('/api/v1/school/academic-sessions', { token: uniToken, schoolId: uniSchoolId }),
      apiJson('/api/v1/school/classes', { token: uniToken, schoolId: uniSchoolId }),
    ]);
    assert.strictEqual(sessRes.status, 200);
    assert.strictEqual(clsRes.status, 200);

    let activeSession = (sessRes.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || (sessRes.data.sessions || [])[0];
    if (!activeSession) {
      const sCreate = await apiJson('/api/v1/school/academic-sessions', {
        method: 'POST',
        token: uniToken,
        schoolId: uniSchoolId,
        body: { name: '2025/2026', start_date: '2025-09-01', end_date: '2026-07-31', status: 'ACTIVE' },
      });
      assert.strictEqual(sCreate.status, 201, `Create session failed: ${JSON.stringify(sCreate.data)}`);
      activeSession = sCreate.data.session || sCreate.data;
    }
    let activeTerm = (activeSession.terms || []).find((t: any) => t.status === 'ACTIVE') || (activeSession.terms || [])[0];
    if (!activeTerm) {
      const tCreate = await apiJson(`/api/v1/school/academic-sessions/${activeSession.id}/terms`, {
        method: 'POST',
        token: uniToken,
        schoolId: uniSchoolId,
        body: { name: 'First Semester', start_date: '2025-09-01', end_date: '2026-02-28', status: 'ACTIVE' },
      });
      assert.strictEqual(tCreate.status, 201, `Create semester failed: ${JSON.stringify(tCreate.data)}`);
      activeTerm = tCreate.data.term || tCreate.data;
    }

    let level300 = (clsRes.data.classes || []).find((c: any) => /300/i.test(c.name));
    if (!level300) {
      const createdCls = await apiJson('/api/v1/school/classes', {
        method: 'POST',
        token: uniToken,
        schoolId: uniSchoolId,
        body: { name: '300 Level', level: 'Tertiary', order_index: 3 },
      });
      assert.strictEqual(createdCls.status, 201, `Create 300 Level failed: ${JSON.stringify(createdCls.data)}`);
      level300 = createdCls.data.class || createdCls.data;
    }
    let level100 = (clsRes.data.classes || []).find((c: any) => /100/i.test(c.name));
    if (!level100) {
      const createdCls = await apiJson('/api/v1/school/classes', {
        method: 'POST',
        token: uniToken,
        schoolId: uniSchoolId,
        body: { name: '100 Level', level: 'Tertiary', order_index: 1 },
      });
      assert.strictEqual(createdCls.status, 201, `Create 100 Level failed: ${JSON.stringify(createdCls.data)}`);
      level100 = createdCls.data.class || createdCls.data;
    }

    // =========================================================================
    // 3. BULK COURSE CREATION + MODIFIABLE CREDIT UNITS (0, 1, 2, 3, 4, 6)
    // =========================================================================
    console.log('3. Testing Bulk Course Creation & Modifiable Credit Units (0, 1, 2, 3, 4, 6)...');
    const bulkRes = await apiJson('/api/v1/school/subjects/bulk', {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        courses: [
          { code: 'GST 301', name: 'Entrepreneurship Studies', credit_units: 1, course_type: 'GENERAL', class_id: level300.id, department: 'GST' },
          { code: 'CSC 301', name: 'Operating Systems', credit_units: 3, course_type: 'CORE', class_id: level300.id, department: 'Computer Science' },
          { code: 'CSC 303', name: 'Algorithms & Complexity', credit_units: 4, course_type: 'CORE', class_id: level300.id, department: 'Computer Science' },
          { code: 'CSC 309', name: 'UI/UX Seminar', credit_units: 2, course_type: 'ELECTIVE', class_id: level300.id, department: 'Computer Science' },
          { code: 'SIW 300', name: 'SIWES Industrial Attachment', credit_units: 6, course_type: 'CORE', class_id: level300.id, department: 'Computer Science' },
          { code: 'AUD 300', name: 'Non-Credit Orientation', credit_units: 0, course_type: 'GENERAL', class_id: level300.id, department: 'Registry' },
        ],
      },
    });
    assert.strictEqual(bulkRes.status, 201, `Bulk courses failed: ${JSON.stringify(bulkRes.data)}`);
    assert.strictEqual(bulkRes.data.createdCount, 6, 'Expected 6 bulk courses created');

    const subjectsList = await apiJson('/api/v1/school/subjects', { token: uniToken, schoolId: uniSchoolId });
    const gst301 = subjectsList.data.subjects.find((s: any) => s.code === 'GST 301');
    const csc301 = subjectsList.data.subjects.find((s: any) => s.code === 'CSC 301');
    const csc303 = subjectsList.data.subjects.find((s: any) => s.code === 'CSC 303');
    const aud300 = subjectsList.data.subjects.find((s: any) => s.code === 'AUD 300');
    assert.strictEqual(Number(gst301.credit_units), 1, '1 credit unit must be preserved');
    assert.strictEqual(Number(csc303.credit_units), 4, '4 credit units must be preserved');
    assert.strictEqual(Number(aud300.credit_units), 0, '0 credit unit must NOT snap to 3');

    // Test inline PATCH credit-units modification (3 -> 2 -> 1 -> 3)
    const patchTo2 = await apiJson(`/api/v1/school/subjects/${csc301.id}/credit-units`, {
      method: 'PATCH',
      token: uniToken,
      schoolId: uniSchoolId,
      body: { credit_units: 2, sync_registrations: true },
    });
    assert.strictEqual(patchTo2.status, 200);
    assert.strictEqual(Number(patchTo2.data.subject.credit_units), 2);

    const patchTo1 = await apiJson(`/api/v1/school/subjects/${csc301.id}/credit-units`, {
      method: 'PATCH',
      token: uniToken,
      schoolId: uniSchoolId,
      body: { credit_units: 1, sync_registrations: true },
    });
    assert.strictEqual(patchTo1.status, 200);
    assert.strictEqual(Number(patchTo1.data.subject.credit_units), 1);

    // Restore CSC 301 to 3 units AND clear class_id to null via PUT to verify COALESCE bug is fixed
    const putClearClass = await apiJson(`/api/v1/school/subjects/${csc301.id}`, {
      method: 'PUT',
      token: uniToken,
      schoolId: uniSchoolId,
      body: { name: csc301.name, code: csc301.code, department: csc301.department, class_id: null, credit_units: 3, course_type: 'CORE', status: 'ACTIVE' },
    });
    assert.strictEqual(putClearClass.status, 200);
    assert.strictEqual(putClearClass.data.subject.class_id, null, 'Clearing class_id to null must persist');
    assert.strictEqual(Number(putClearClass.data.subject.credit_units), 3);

    // Verify policy settings save min/max credit units
    const putPolicy = await apiJson('/api/v1/school/performance/settings', {
      method: 'PUT',
      token: uniToken,
      schoolId: uniSchoolId,
      body: { min_credit_units_per_cycle: 10, max_credit_units_per_cycle: 12 },
    });
    assert.strictEqual(putPolicy.status, 200);
    assert.strictEqual(Number(putPolicy.data.settings.min_credit_units_per_cycle), 10);
    assert.strictEqual(Number(putPolicy.data.settings.max_credit_units_per_cycle), 12);

    // =========================================================================
    // 4. ENROLL 2 STUDENTS IN 300 LEVEL & TEST BULK COURSE REGISTRATION + PORTAL RBAC
    // =========================================================================
    console.log('4. Enrolling 300L students, testing Bulk Course Registration, unit guardrails & Portal RBAC...');
    const stu1Res = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        first_name: 'Amina',
        last_name: 'Balogun',
        admission_number: 'HFU/2023/001',
        class_id: level300.id,
        gender: 'Female',
      },
    });
    assert.strictEqual(stu1Res.status, 201);
    const stu1 = stu1Res.data.student;

    const stu2Res = await apiJson('/api/v1/school/students', {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        first_name: 'Chidi',
        last_name: 'Eze',
        admission_number: 'HFU/2023/002',
        class_id: level300.id,
        gender: 'Male',
      },
    });
    assert.strictEqual(stu2Res.status, 201);
    const stu2 = stu2Res.data.student;

    // Bulk register 4 courses (1 + 3 + 4 + 6 = 14 units > max 12 units -> should flag guardrail warning!)
    const siw300 = subjectsList.data.subjects.find((s: any) => s.code === 'SIW 300');
    const bulkRegRes = await apiJson('/api/v1/school/course-registrations/bulk', {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        academic_session_id: activeSession.id,
        term_id: activeTerm.id,
        class_id: level300.id,
        subject_ids: [gst301.id, csc301.id, csc303.id, siw300.id],
        credit_unit_overrides: { [gst301.id]: 1 },
        registration_type: 'REGULAR',
      },
    });
    assert.strictEqual(bulkRegRes.status, 201, `Bulk course registration failed: ${JSON.stringify(bulkRegRes.data)}`);
    assert.strictEqual(bulkRegRes.data.registeredCount, 8, 'Expected 2 students x 4 courses = 8 registrations');

    const listRegs = await apiJson(
      `/api/v1/school/course-registrations?academic_session_id=${activeSession.id}&term_id=${activeTerm.id}`,
      { token: uniToken, schoolId: uniSchoolId }
    );
    assert.strictEqual(listRegs.status, 200);
    const stu1Summary = listRegs.data.studentSummaries.find((s: any) => s.student_id === stu1.id);
    assert.ok(stu1Summary, 'Missing student summary');
    assert.strictEqual(stu1Summary.total_credit_units, 14, 'Expected 1+3+4+6 = 14 credit units');
    assert.strictEqual(stu1Summary.exceeds_max_units, true, 'Expected guardrail warning when 14 > max 12');

    // Drop SIW 300 (6 units) for stu1 so stu1 drops to 8 units
    const siwReg = stu1Summary.courses.find((c: any) => c.subject_id === siw300.id);
    const dropRes = await apiJson(`/api/v1/school/course-registrations/${siwReg.id}`, {
      method: 'DELETE',
      token: uniToken,
      schoolId: uniSchoolId,
    });
    assert.strictEqual(dropRes.status, 200);

    // Issue student portal credentials for stu1 & parent portal credentials linked ONLY to stu1
    const stuCred = await apiJson(`/api/v1/school/students/${stu1.id}/provision-account`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: { email: 'amina.balogun@horizonuni.edu.ng', password: 'StudentPass123!' },
    });
    assert.ok(stuCred.status === 200 || stuCred.status === 201, `Student provision failed: ${JSON.stringify(stuCred.data)}`);
    const stuLogin = await apiJson('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'amina.balogun@horizonuni.edu.ng', password: 'StudentPass123!' },
    });
    assert.strictEqual(stuLogin.status, 200, `Student login failed: ${JSON.stringify(stuLogin.data)}`);
    const stu1Token = stuLogin.data.token;

    // Student views own course registrations
    const stuRegsApi = await apiJson('/api/v1/portal/student/course-registrations', {
      token: stu1Token,
      schoolId: uniSchoolId,
    });
    assert.strictEqual(stuRegsApi.status, 200, `Student course regs failed: ${JSON.stringify(stuRegsApi.data)}`);
    assert.strictEqual(stuRegsApi.data.totalCourses, 3, 'Student should see 3 active courses after drop');
    assert.strictEqual(stuRegsApi.data.totalCreditUnits, 8, 'Student should see 1+3+4 = 8 total credit units');

    // Provision Parent linked ONLY to stu1 and verify IDOR protection against stu2
    const parProv = await apiJson('/api/v1/school/users/provision', {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        role_name: 'PARENT',
        full_name: 'Alhaji Balogun',
        phone: '08091112233',
        email: 'balogun.parent@example.com',
        password: 'ParentPass123!',
        create_parent_profile: true,
        student_ids: [stu1.id],
      },
    });
    assert.ok(parProv.status === 200 || parProv.status === 201, `Parent provision failed: ${JSON.stringify(parProv.data)}`);
    const parLogin = await apiJson('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'balogun.parent@example.com', password: 'ParentPass123!' },
    });
    assert.strictEqual(parLogin.status, 200, `Parent login failed: ${JSON.stringify(parLogin.data)}`);
    const parToken = parLogin.data.token;

    const parOwnChildRegs = await apiJson(`/api/v1/portal/parent/course-registrations?student_id=${stu1.id}`, {
      token: parToken,
      schoolId: uniSchoolId,
    });
    assert.strictEqual(parOwnChildRegs.status, 200);
    assert.strictEqual(parOwnChildRegs.data.totalCreditUnits, 8);

    const parIdorAttempt = await apiJson(`/api/v1/portal/parent/course-registrations?student_id=${stu2.id}`, {
      token: parToken,
      schoolId: uniSchoolId,
    });
    assert.strictEqual(parIdorAttempt.status, 403, 'Parent MUST be blocked (403) from reading unlinked student courses');

    // =========================================================================
    // 5. HISTORICAL BACKLOG ONBOARDING (PREVIOUS YEARS/LEVELS) + CUMULATIVE CGPA
    // =========================================================================
    console.log('5. Testing Historical Backlog Upload (100L & 200L past years) + Zero Distortion + Career CGPA...');
    const backlogRows = [
      // 2023/2024 100 Level (First Semester): 1u=80(5), 4u=75(5), 2u=62(4) => 33/7 = 4.714
      { admission_number: 'HFU/2023/001', session_name: '2023/2024', term_name: 'First Semester', class_name: '100 Level', subject_code: 'GST 101', subject_name: 'Use of English I', credit_units: 1, ca_score: 30, exam_score: 50 },
      { admission_number: 'HFU/2023/001', session_name: '2023/2024', term_name: 'First Semester', class_name: '100 Level', subject_code: 'CSC 101', subject_name: 'Intro to Computing', credit_units: 4, ca_score: 28, exam_score: 47 },
      { admission_number: 'HFU/2023/001', session_name: '2023/2024', term_name: 'First Semester', class_name: '100 Level', subject_code: 'MTH 101', subject_name: 'General Mathematics I', credit_units: 2, ca_score: 22, exam_score: 40 },
      // 2024/2025 200 Level (First Semester): 3u=55(3), 2u=72(5) => 19/5 = 3.800
      { admission_number: 'HFU/2023/001', session_name: '2024/2025', term_name: 'First Semester', class_name: '200 Level', subject_code: 'CSC 201', subject_name: 'Computer Programming II', credit_units: 3, ca_score: 20, exam_score: 35 },
      { admission_number: 'HFU/2023/001', session_name: '2024/2025', term_name: 'First Semester', class_name: '200 Level', subject_code: 'STA 201', subject_name: 'Probability & Statistics', credit_units: 2, ca_score: 27, exam_score: 45 },
      // Intentional invalid row to verify validation catches it cleanly
      { admission_number: 'UNKNOWN/999', session_name: '2023/2024', term_name: 'First Semester', class_name: '100 Level', subject_code: 'BAD 101', subject_name: 'Ghost Course', credit_units: 2, total_score: 70 },
    ];

    const previewRes = await apiJson('/api/v1/school/historical-backlog/preview', {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: { rows: backlogRows },
    });
    assert.strictEqual(previewRes.status, 200, `Backlog preview failed: ${JSON.stringify(previewRes.data)}`);
    assert.strictEqual(previewRes.data.summary.valid_rows, 5, 'Expected 5 valid historical rows');
    assert.strictEqual(previewRes.data.summary.invalid_rows, 1, 'Expected 1 invalid historical row');

    const importRes = await apiJson('/api/v1/school/historical-backlog/import', {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: { rows: backlogRows.slice(0, 5), publish_scores: true },
    });
    assert.strictEqual(importRes.status, 201, `Backlog import failed: ${JSON.stringify(importRes.data)}`);
    assert.strictEqual(importRes.data.summary.rowsImported, 5);
    assert.strictEqual(importRes.data.summary.registrationsSaved, 5);
    assert.strictEqual(importRes.data.summary.scoresSaved, 5);

    // ZERO-DISTORTION CHECK: Verify stu1 is STILL in 300 Level and active session is UNCHANGED
    const stuCheck = await apiJson(`/api/v1/school/students?search=HFU/2023/001`, {
      token: uniToken,
      schoolId: uniSchoolId,
    });
    const stu1After = stuCheck.data.students.find((s: any) => s.id === stu1.id);
    assert.strictEqual(stu1After.class_id, level300.id, 'ZERO-DISTORTION: Student MUST remain in 300 Level after backlog upload!');
    assert.strictEqual(stu1After.student_status, 'ACTIVE');

    const sessAfter = await apiJson('/api/v1/school/academic-sessions', { token: uniToken, schoolId: uniSchoolId });
    const activeSessionsNow = sessAfter.data.sessions.filter((s: any) => s.status === 'ACTIVE');
    assert.strictEqual(activeSessionsNow.length, 1, 'Active session count must remain 1');
    assert.strictEqual(activeSessionsNow[0].id, activeSession.id, 'Active session must remain untouched');

    // Add current 300 Level published examination & score (CSC 301: 3u = 78 [5pts] -> 15/3)
    const exam300 = await apiJson('/api/v1/school/examinations', {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        title: '300 Level First Semester Exam',
        exam_type: 'TERMLY',
        academic_session_id: activeSession.id,
        term_id: activeTerm.id,
        class_id: level300.id,
        ca_max_score: 40,
        exam_max_score: 60,
      },
    });
    assert.strictEqual(exam300.status, 201);
    const exId = exam300.data.examination.id;

    // Enter scores for BOTH students on CSC 301 (3u) and GST 301 (1u)
    const saveSc1 = await apiJson(`/api/v1/school/examinations/${exId}/scores`, {
      method: 'PUT',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        entries: [
          { student_id: stu1.id, subject_id: csc301.id, ca_score: 30, exam_score: 48 }, // 78 -> A (5.0)
          { student_id: stu2.id, subject_id: csc301.id, ca_score: 22, exam_score: 38 }, // 60 -> B (4.0)
        ],
      },
    });
    assert.strictEqual(saveSc1.status, 200, `Save score 1 failed: ${JSON.stringify(saveSc1.data)}`);

    const saveSc2 = await apiJson(`/api/v1/school/examinations/${exId}/scores`, {
      method: 'PUT',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        entries: [
          { student_id: stu1.id, subject_id: gst301.id, ca_score: 32, exam_score: 48 }, // 80 -> A (5.0)
          { student_id: stu2.id, subject_id: gst301.id, ca_score: 25, exam_score: 30 }, // 55 -> C (3.0)
        ],
      },
    });
    assert.strictEqual(saveSc2.status, 200, `Save score 2 failed: ${JSON.stringify(saveSc2.data)}`);

    // Transition exam to PUBLISHED
    for (const nextStatus of ['REVIEW', 'APPROVED', 'PUBLISHED']) {
      const tr = await apiJson(`/api/v1/school/examinations/${exId}/status`, {
        method: 'POST',
        token: uniToken,
        schoolId: uniSchoolId,
        body: { status: nextStatus },
      });
      assert.strictEqual(tr.status, 200, `Exam transition to ${nextStatus} failed: ${JSON.stringify(tr.data)}`);
    }

    // Compile Multi-Year Career Transcript for stu1 and verify EXACT weighted CGPA across all 3 years!
    // 100L: 1*5 + 4*5 + 2*4 = 33 pts / 7 units
    // 200L: 3*3 + 2*5       = 19 pts / 5 units
    // 300L: 3*5 + 1*5       = 20 pts / 4 units
    // Lifetime Total: 72 quality points / 16 credit units = 4.50 exact (First Class Honours!)
    const ctRes = await apiJson('/api/v1/school/career-transcripts/compile', {
      method: 'POST',
      token: uniToken,
      schoolId: uniSchoolId,
      body: { student_id: stu1.id },
    });
    assert.strictEqual(ctRes.status, 200, `Career transcript compile failed: ${JSON.stringify(ctRes.data)}`);
    const ct = ctRes.data.transcript;
    const summary = ct.summary || ct;
    assert.strictEqual(summary.sessions_count, 3, `Expected 3 aggregated sessions (2023/2024, 2024/2025, current), got ${summary.sessions_count}`);
    assert.strictEqual(summary.total_credit_units_attempted, 16, `Expected 16 total credit units (7+5+4), got ${summary.total_credit_units_attempted}`);
    assert.ok(Math.abs(Number(summary.lifetime_cgpa) - 4.5) < 0.01, `Expected exact weighted CGPA 4.50, got ${summary.lifetime_cgpa}`);
    console.log(`   Exact Multi-Year Career CGPA verified: ${summary.lifetime_cgpa} (${summary.total_credit_units_attempted} units across ${summary.sessions_count} years — ${summary.final_standing})`);

    // =========================================================================
    // 6. MASTER CLASS/LEVEL BROADSHEET VERIFICATION
    // =========================================================================
    console.log('6. Verifying Master Class/Level Examination Broadsheet API...');
    const bsRes = await apiJson(`/api/v1/school/examinations/${exId}/broadsheet`, {
      token: uniToken,
      schoolId: uniSchoolId,
    });
    assert.strictEqual(bsRes.status, 200, `Broadsheet failed: ${JSON.stringify(bsRes.data)}`);
    assert.strictEqual(bsRes.data.subjects.length, 2, 'Expected 2 subjects in broadsheet');
    assert.strictEqual(bsRes.data.rows.length, 2, 'Expected 2 students in broadsheet');
    assert.strictEqual(bsRes.data.rows[0].student_id, stu1.id, 'Amina should rank 1st');
    assert.strictEqual(bsRes.data.rows[0].position, 1);
    assert.strictEqual(bsRes.data.rows[0].credit_units, 4, 'Expected 3 + 1 = 4 units');
    assert.ok(Math.abs(Number(bsRes.data.rows[0].gpa) - 5.0) < 0.01, `Expected 5.00 GPA, got ${bsRes.data.rows[0].gpa}`);
    // Chidi: CSC 301 (3u * 4 = 12) + GST 301 (1u * 3 = 3) = 15 / 4 = 3.75 GPA
    assert.strictEqual(bsRes.data.rows[1].position, 2);
    assert.ok(Math.abs(Number(bsRes.data.rows[1].gpa) - 3.75) < 0.01, `Expected 3.75 GPA for Chidi, got ${bsRes.data.rows[1].gpa}`);
    console.log('   Broadsheet math & rankings verified.');

    // =========================================================================
    // 7. PUBLIC WEBSITE FRONT PAGE PRIVACY CONTROLS (TRUE SERVER-SIDE REDACTION)
    // =========================================================================
    console.log('7. Testing Public School Website Privacy Controls (default redaction + admin toggles)...');
    const pubDefault = await apiJson(`/api/v1/public/schools/${uniSlug}/website`);
    assert.strictEqual(pubDefault.status, 200, `Public website fetch failed: ${JSON.stringify(pubDefault.data)}`);
    assert.strictEqual(Number(pubDefault.data.website.show_enrollment_count), 0, 'Enrollment count MUST be hidden by default');
    assert.strictEqual(Number(pubDefault.data.website.show_staff_count), 0, 'Staff count MUST be hidden by default');
    assert.strictEqual(pubDefault.data.stats.studentsCount, null, 'Server MUST redact studentsCount to null when hidden!');
    assert.strictEqual(pubDefault.data.stats.staffCount, null, 'Server MUST redact staffCount to null when hidden!');
    assert.ok(typeof pubDefault.data.stats.classesCount === 'number' && pubDefault.data.stats.classesCount >= 2, 'Classes count visible by default');

    // Admin enables enrollment & staff count, disables CBT hall & admissions form
    const toggleOn = await apiJson('/api/v1/school/website/profile', {
      method: 'PUT',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        show_enrollment_count: 1,
        show_staff_count: 1,
        show_classes_count: 1,
        show_cbt_hall: 0,
        show_admissions_form: 0,
      },
    });
    assert.strictEqual(toggleOn.status, 200);

    const pubEnabled = await apiJson(`/api/v1/public/schools/${uniSlug}/website`);
    assert.strictEqual(pubEnabled.status, 200);
    assert.strictEqual(pubEnabled.data.stats.studentsCount, 2, 'Enrollment count should equal 2 when toggled ON');
    assert.strictEqual(typeof pubEnabled.data.stats.staffCount, 'number', 'Staff count should be a non-null number when toggled ON');
    assert.strictEqual(Number(pubEnabled.data.website.show_cbt_hall), 0);
    assert.strictEqual(Number(pubEnabled.data.website.show_admissions_form), 0);

    // Toggle enrollment & staff back OFF (restoring privacy-first default for browser test)
    const toggleBackOff = await apiJson('/api/v1/school/website/profile', {
      method: 'PUT',
      token: uniToken,
      schoolId: uniSchoolId,
      body: {
        show_enrollment_count: 0,
        show_staff_count: 0,
        show_classes_count: 1,
        show_cbt_hall: 1,
        show_admissions_form: 1,
      },
    });
    assert.strictEqual(toggleBackOff.status, 200);
    const pubRedactedAgain = await apiJson(`/api/v1/public/schools/${uniSlug}/website`);
    assert.strictEqual(pubRedactedAgain.data.stats.studentsCount, null);
    assert.strictEqual(pubRedactedAgain.data.stats.staffCount, null);
    console.log('   Server-side privacy redaction & toggle persistence verified.');

    // =========================================================================
    // 8. HEADLESS CHROMIUM BROWSER E2E VERIFICATION (1440px DESKTOP + 360px MOBILE)
    // =========================================================================
    console.log('8. Launching Headless Chromium for real UI & responsive verification...');
    const debugPort = 9244;
    chromeProc = spawn(
      CHROME_BIN,
      [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${chromeDataDir}`,
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        'about:blank',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let wsUrl = '';
    const startChrome = Date.now();
    while (Date.now() - startChrome < 15000) {
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
        const pages = (await res.json()) as any[];
        const target = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
        if (target) {
          wsUrl = target.webSocketDebuggerUrl;
          break;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(wsUrl, 'Headless Chromium DevTools endpoint did not come up');
    cdp = await CDPClient.connect(wsUrl);

    // 8A. Verify Public School Website Front Page hides enrollment & staff counts in DOM
    await cdp.navigate(`${TEST_BASE}/site/${uniSlug}`);
    await cdp.waitForText('Horizon Federal University');
    const pubText = await cdp.evaluate<string>(`document.body.innerText`);
    assert.ok(!pubText.includes('Enrolled Students') && !pubText.includes('Enrolled Learners'), 'Front page DOM must NOT render Enrollment Count when hidden');
    assert.ok(!pubText.includes('Lecturers & Faculty') && !pubText.includes('Teaching Staff'), 'Front page DOM must NOT render Staff Count when hidden');
    assert.ok(pubText.includes('Current Session'), 'Front page should render dignified Current Session fact');

    // Check desktop & mobile overflow on public website
    const pubDesktopOverflow = await cdp.evaluate<boolean>(`document.documentElement.scrollWidth > window.innerWidth + 4`);
    assert.strictEqual(pubDesktopOverflow, false, 'Public website has horizontal overflow at 1440px');
    await cdp.setViewport(360, 800, true);
    const pubMobileOverflow = await cdp.evaluate<boolean>(`document.documentElement.scrollWidth > window.innerWidth + 4`);
    assert.strictEqual(pubMobileOverflow, false, 'Public website has horizontal overflow at 360px');
    await cdp.setViewport(1440, 900, false);
    console.log('   Public School Website privacy & responsive layout verified (1440px & 360px).');

    // 8B. Authenticate Admin in Browser & test Performance + Course Registration + Broadsheet + Website Privacy Manager
    await cdp.evaluate(`(() => {
      localStorage.setItem('bursariq_session_token', ${JSON.stringify(uniToken)});
      localStorage.setItem('bursariq_active_school_id', ${JSON.stringify(uniSchoolId)});
    })()`);
    await cdp.navigate(`${TEST_BASE}/`);
    await cdp.waitForText('Horizon Federal University');

    // Open Academic Performance tab
    await cdp.clickButtonByText('Performance');
    await cdp.waitForText('Analytics & Rankings');

    // Go to Courses tab and verify inline Credit Units controls + Bulk Add + Upload Previous Years buttons
    await cdp.clickButtonByText('Courses');
    await cdp.waitForText('GST 301');
    await cdp.waitForText('Bulk Add Courses');
    await cdp.waitForText('Upload Previous Years');

    // Open Bulk Add Courses modal and verify presets render
    await cdp.clickButtonByText('Bulk Add Courses');
    await cdp.waitForText('University 100L Computing');
    await cdp.clickButtonByText('Cancel');

    // Open Course Registration tab and verify student summaries render
    await cdp.clickButtonByText('Course Registration');
    await cdp.waitForText('Amina Balogun');

    // Open Upload Previous Years modal and verify Zero-Distortion guarantee copy
    await cdp.clickButtonByText('Upload Previous Years');
    await cdp.waitForText('Previous Years');
    await cdp.clickButtonByText('Cancel');

    // Open Examinations & Scores tab -> open Master Broadsheet
    await cdp.clickButtonByText('Examinations & Scores');
    await cdp.waitForText('300 Level First Semester Exam');
    await cdp.clickButtonByText('Broadsheet');
    await cdp.waitForText('Master Examination Broadsheet');
    await cdp.waitForText('Amina Balogun');
    await cdp.evaluate(`document.querySelector('button[aria-label="Close broadsheet modal"]')?.click()`);
    await new Promise((r) => setTimeout(r, 300));

    // Open Website & Gallery Manager & verify Privacy Controls card
    await cdp.clickButtonByText('Website & Gallery');
    await cdp.waitForText('Front Page Privacy & Visitor Visibility Controls');
    await cdp.waitForText('Show Enrollment Count');
    await cdp.waitForText('Show Staff / Lecturer Count');

    // Check overflow on mobile inside admin dashboard
    await cdp.setViewport(360, 800, true);
    const adminMobileOverflow = await cdp.evaluate<boolean>(`document.documentElement.scrollWidth > window.innerWidth + 8`);
    assert.strictEqual(adminMobileOverflow, false, 'Admin Website Privacy view has horizontal overflow at 360px');

    assert.strictEqual(cdp.pageErrors.length, 0, `Uncaught page errors: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.consoleErrors.length, 0, `Console errors: ${cdp.consoleErrors.join(' | ')}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`);

    console.log('\nALL COURSE REGISTRATION, CREDIT UNITS, HISTORICAL BACKLOG, BROADSHEET & WEBSITE PRIVACY E2E TESTS PASSED!');
  } catch (err) {
    console.error('\n--- SANDBOX SERVER LOGS ---\n' + serverLogs + '\n--- END LOGS ---');
    throw err;
  } finally {
    if (cdp) await cdp.close().catch(() => {});
    if (chromeProc) chromeProc.kill('SIGKILL');
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
