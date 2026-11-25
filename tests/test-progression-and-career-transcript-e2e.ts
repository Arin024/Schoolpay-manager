import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_BIN = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const TEST_PORT = 3222;
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
    const body = await this.evaluate<string>(`(document.body?.innerText || '').slice(0, 600)`);
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
    assert(clicked, `Expected clickable button containing "${text}"`);
    await new Promise((r) => setTimeout(r, 400));
  }

  async close() {
    this.ws.close();
  }
}

async function apiReq(
  urlPath: string,
  opts: { method?: string; token?: string; schoolId?: string; body?: any } = {}
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.schoolId) headers['X-School-Id'] = opts.schoolId;
  const res = await fetch(`${TEST_BASE}${urlPath}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, data: json };
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${TEST_BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Test server failed to start');
}

async function run() {
  const rootDir = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-progression-e2e-'));
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
  const cleanEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || '/root',
    NODE_ENV: 'development',
    RENDER: '1',
    PORT: String(TEST_PORT),
    JWT_SECRET: 'test-progression-secret-key-2026-isolated-sandbox-64-chars-long',
    ALLOW_SANDBOX_PAYMENTS: 'true',
    DISABLE_HMR: 'true',
  };

  const serverProc: ChildProcess = spawn(tsxBin, ['server.ts'], {
    cwd: tmpDir,
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLogs = '';
  serverProc.stdout?.on('data', (d) => (serverLogs += d.toString()));
  serverProc.stderr?.on('data', (d) => (serverLogs += d.toString()));

  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;

  try {
    console.log('[1/8] Booting isolated SQLite test server on port', TEST_PORT);
    await waitForServer();

    // =========================================================================
    // PART A: 3-YEAR UNIVERSITY PROGRESSION + CARRYOVER CLEARANCE + CAREER TRANSCRIPT
    // =========================================================================
    console.log('[2/8] Registering University (GPA_5, Semesters) & setting up 3 Academic Sessions...');
    const uniEmail = `registrar.uni.${Date.now()}@crestfield.edu.ng`;
    const uniReg = await apiReq('/api/v1/auth/register-school', {
      method: 'POST',
      body: {
        schoolName: 'Crestfield University of Science & Tech',
        schoolType: 'University',
        institutionCategory: 'TERTIARY',
        academicCycleType: 'SEMESTER',
        cycleLabels: ['Harmattan Semester', 'Rain Semester'],
        gradingMode: 'GPA_5',
        state: 'Lagos',
        lga: 'Ikeja',
        address: '10 Crestfield Avenue, Ikeja, Lagos',
        phone: '+2348011223344',
        email: uniEmail,
        ownerName: 'Prof. Akinwumi Adesina',
        ownerEmail: uniEmail,
        password: 'Password123!',
        question1: 'City?',
        answer1: 'Lagos',
        question2: 'Motto?',
        answer2: 'Excellence',
      },
    });
    assert.strictEqual(uniReg.status, 201, `University registration failed: ${JSON.stringify(uniReg.data)}`);
    const uniToken = uniReg.data.token;
    const uniId = uniReg.data.school?.id || uniReg.data.activeSchool?.id || uniReg.data.activeSchoolId;
    assert(uniToken && uniId, 'Expected uni token & schoolId');

    // Ensure University levels (100L, 200L, 300L) exist
    const ensureClass = async (tok: string, schId: string, name: string, level: string, order_index: number) => {
      const list = (await apiReq('/api/v1/school/classes', { token: tok, schoolId: schId })).data.classes || [];
      const found = list.find((c: any) => String(c.name || '').toLowerCase() === name.toLowerCase());
      if (found) return found;
      const cr = await apiReq('/api/v1/school/classes', {
        method: 'POST',
        token: tok,
        schoolId: schId,
        body: { name, level, order_index },
      });
      assert.strictEqual(cr.status, 201, `Create class ${name} failed: ${JSON.stringify(cr.data)}`);
      return cr.data.class || cr.data.data || cr.data;
    };

    const cls100 = await ensureClass(uniToken, uniId, '100 Level', 'Tertiary', 1);
    const cls200 = await ensureClass(uniToken, uniId, '200 Level', 'Tertiary', 2);
    const cls300 = await ensureClass(uniToken, uniId, '300 Level', 'Tertiary', 3);
    assert(cls100?.id && cls200?.id && cls300?.id, 'Expected 100/200/300 Level classes');

    const createSessionWithSemester = async (name: string, start: string, end: string, status: string) => {
      const sRes = await apiReq('/api/v1/school/academic-sessions', {
        method: 'POST',
        token: uniToken,
        schoolId: uniId,
        body: { name, start_date: start, end_date: end, status },
      });
      assert.strictEqual(sRes.status, 201, `Create session ${name} failed: ${JSON.stringify(sRes.data)}`);
      const sesId = sRes.data.session?.id || sRes.data.id;
      const tRes = await apiReq(`/api/v1/school/academic-sessions/${sesId}/terms`, {
        method: 'POST',
        token: uniToken,
        schoolId: uniId,
        body: { name: 'Harmattan Semester', start_date: start, end_date: end, status },
      });
      assert.strictEqual(tRes.status, 201, `Create semester for ${name} failed: ${JSON.stringify(tRes.data)}`);
      const termId = tRes.data.term?.id || tRes.data.id;
      return { sesId, termId };
    };

    const y1 = await createSessionWithSemester('2024/2025', '2024-09-01', '2025-07-31', 'COMPLETED');
    const y2 = await createSessionWithSemester('2025/2026', '2025-09-01', '2026-07-31', 'COMPLETED');
    const y3 = await createSessionWithSemester('2026/2027', '2026-09-01', '2027-07-31', 'ACTIVE');

    // Create 4 courses with distinct credit units
    const createCourse = async (name: string, code: string, credit_units: number) => {
      const r = await apiReq('/api/v1/school/subjects', {
        method: 'POST',
        token: uniToken,
        schoolId: uniId,
        body: { name, code, credit_units },
      });
      assert.strictEqual(r.status, 201, `Create course ${code} failed: ${JSON.stringify(r.data)}`);
      return r.data.subject?.id || r.data.id;
    };

    const csc101 = await createCourse('Introduction to Computer Science', 'CSC 101', 3);
    const mth101 = await createCourse('General Mathematics I', 'MTH 101', 4);
    const csc201 = await createCourse('Data Structures & Algorithms', 'CSC 201', 3);
    const csc301 = await createCourse('Operating Systems & Architecture', 'CSC 301', 4);

    // Enroll student in 100 Level (Year 1)
    const matric = 'CUST/CSC/24/001';
    const stuRes = await apiReq('/api/v1/school/students', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        admission_number: matric,
        first_name: 'Chidinma',
        last_name: 'Okafor',
        gender: 'Female',
        class_id: cls100.id,
        class_name: cls100.name,
        academic_session_id: y1.sesId,
        student_status: 'ACTIVE',
      },
    });
    assert.strictEqual(stuRes.status, 201, `Enroll student failed: ${JSON.stringify(stuRes.data)}`);
    const studentId = stuRes.data.student?.id || stuRes.data.id;

    // Create an unpaid ₦50,000 fee invoice in Year 1 (100 Level) to prove arrears persist across years
    const invRes = await apiReq('/api/v1/school/invoices', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        student_id: studentId,
        class_id: cls100.id,
        academic_session_id: y1.sesId,
        term_id: y1.termId,
        due_date: '2024-11-30',
        items: [{ description: '100 Level Tuition Fee', quantity: 1, unit_amount: 50000 }],
      },
    });
    assert.strictEqual(invRes.status, 201, `Create Year 1 invoice failed: ${JSON.stringify(invRes.data)}`);

    const recordPublishedExamScore = async (
      title: string,
      sesId: string,
      termId: string,
      classId: string,
      subjectId: string,
      ca: number,
      exam: number
    ) => {
      const exRes = await apiReq('/api/v1/school/examinations', {
        method: 'POST',
        token: uniToken,
        schoolId: uniId,
        body: {
          title,
          exam_type: 'END_OF_TERM',
          academic_session_id: sesId,
          term_id: termId,
          class_id: classId,
          ca_max_score: 30,
          exam_max_score: 70,
          total_max_score: 100,
        },
      });
      assert.strictEqual(exRes.status, 201, `Create exam ${title} failed: ${JSON.stringify(exRes.data)}`);
      const examId = exRes.data.examination?.id || exRes.data.id;

      const scRes = await apiReq(`/api/v1/school/examinations/${examId}/scores`, {
        method: 'PUT',
        token: uniToken,
        schoolId: uniId,
        body: {
          entries: [{ student_id: studentId, subject_id: subjectId, ca_score: ca, exam_score: exam }],
        },
      });
      assert.strictEqual(scRes.status, 200, `Save score ${title} failed: ${JSON.stringify(scRes.data)}`);

      const pubRes = await apiReq(`/api/v1/school/examinations/${examId}/publish`, {
        method: 'POST',
        token: uniToken,
        schoolId: uniId,
        body: {},
      });
      if (pubRes.status === 404) {
        const stRes = await apiReq(`/api/v1/school/examinations/${examId}`, {
          method: 'PUT',
          token: uniToken,
          schoolId: uniId,
          body: { status: 'PUBLISHED' },
        });
        assert(stRes.status === 200, `Publish exam ${title} failed: ${JSON.stringify(stRes.data)}`);
      } else {
        assert.strictEqual(pubRes.status, 200, `Publish exam ${title} failed: ${JSON.stringify(pubRes.data)}`);
      }
    };

    console.log('[3/8] Executing Year 1 (100L -> 200L), Year 2 (200L -> 300L + Carryover Retake), Year 3 (300L -> GRADUATED)...');
    // YEAR 1 (100 Level, 2024/2025): CSC 101 = 80 (A, 5x3=15), MTH 101 = 32 (F, 0x4=0 -> CARRYOVER!)
    await recordPublishedExamScore('2024/2025 Harmattan CSC 101', y1.sesId, y1.termId, cls100.id, csc101, 25, 55);
    await recordPublishedExamScore('2024/2025 Harmattan MTH 101', y1.sesId, y1.termId, cls100.id, mth101, 10, 22);

    // Dry-run progression preview for 100 Level
    const prev100 = await apiReq(
      `/api/v1/school/progression/preview?class_id=${encodeURIComponent(cls100.id)}&from_session_id=${encodeURIComponent(y1.sesId)}`,
      { token: uniToken, schoolId: uniId }
    );
    assert.strictEqual(prev100.status, 200, `Preview 100L failed: ${JSON.stringify(prev100.data)}`);
    assert.strictEqual(prev100.data.suggestion?.nextClass?.id, cls200.id, 'Smart ladder should suggest 200 Level after 100 Level');
    const row100 = prev100.data.students.find((s: any) => s.student_id === studentId);
    assert(row100, 'Expected student in 100L preview');
    assert.strictEqual(row100.failed_courses_count, 1, 'Expected 1 carryover detected in 100L preview');
    assert.strictEqual(row100.outstanding_balance_kobo, 5000000, 'Expected ₦50,000 arrears visible in 100L preview');

    // Promote 100 Level -> 200 Level (2025/2026)
    const execY1 = await apiReq('/api/v1/school/progression/execute', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        from_session_id: y1.sesId,
        to_session_id: y2.sesId,
        from_class_id: cls100.id,
        to_class_id: cls200.id,
        notes: 'Senate Approved 100L -> 200L Promotion',
        decisions: [{ student_id: studentId, action: 'PROMOTE', target_class_id: cls200.id }],
      },
    });
    assert.strictEqual(execY1.status, 201, `Execute 100L->200L failed: ${JSON.stringify(execY1.data)}`);

    // CRITICAL NON-DISTORTION CHECK: Compile Year 1 report card AFTER student is in 200 Level -> must STILL show 100 Level!
    const histRcRes = await apiReq('/api/v1/school/report-cards/generate', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { student_id: studentId, academic_session_id: y1.sesId, term_id: y1.termId },
    });
    assert(histRcRes.status === 200 || histRcRes.status === 201, `Generate historical Y1 report card failed: ${JSON.stringify(histRcRes.data)}`);
    const rcObj = histRcRes.data.reportCard || histRcRes.data.reportCards?.[0];
    assert.strictEqual(
      rcObj?.class_name || rcObj?.breakdown?.student?.class_name,
      cls100.name,
      `Historical Year 1 report card must still display "${cls100.name}", NOT "200 Level"! Got: ${rcObj?.class_name}`
    );

    // YEAR 2 (200 Level, 2025/2026): CSC 201 = 76 (A, 5x3=15), RETAKE MTH 101 = 65 (B, 4x4=16 -> CLEARS CARRYOVER!)
    await recordPublishedExamScore('2025/2026 Harmattan CSC 201', y2.sesId, y2.termId, cls200.id, csc201, 24, 52);
    await recordPublishedExamScore('2025/2026 Harmattan MTH 101 Retake', y2.sesId, y2.termId, cls200.id, mth101, 20, 45);

    // Promote 200 Level -> 300 Level (2026/2027)
    const execY2 = await apiReq('/api/v1/school/progression/execute', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        from_session_id: y2.sesId,
        to_session_id: y3.sesId,
        from_class_id: cls200.id,
        to_class_id: cls300.id,
        notes: 'Senate Approved 200L -> 300L Promotion',
        decisions: [{ student_id: studentId, action: 'PROMOTE', target_class_id: cls300.id }],
      },
    });
    assert.strictEqual(execY2.status, 201, `Execute 200L->300L failed: ${JSON.stringify(execY2.data)}`);

    // YEAR 3 (300 Level, 2026/2027): CSC 301 = 85 (A, 5x4=20)
    await recordPublishedExamScore('2026/2027 Harmattan CSC 301', y3.sesId, y3.termId, cls300.id, csc301, 28, 57);

    // Graduate from 300 Level into Alumni Registry
    const execGrad = await apiReq('/api/v1/school/progression/execute', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        from_session_id: y3.sesId,
        to_session_id: y3.sesId,
        from_class_id: cls300.id,
        notes: '2026/2027 Convocation Graduating Cohort',
        decisions: [{ student_id: studentId, action: 'GRADUATE' }],
      },
    });
    assert.strictEqual(execGrad.status, 201, `Execute graduation failed: ${JSON.stringify(execGrad.data)}`);
    assert.strictEqual(execGrad.data.batch.graduated_count, 1, 'Expected 1 graduated student');

    // ALUMNI BULK BILLING GUARD: Create fee category + fee structure for 300 Level and run bulk invoice generation -> must NOT bill graduated alumni!
    const fcRes = await apiReq('/api/v1/school/fee-categories', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { name: '300L Tuition', code: 'TUI300' },
    });
    const fsRes = await apiReq('/api/v1/school/fee-structures', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        name: '300L Standard Tuition',
        class_id: cls300.id,
        academic_session_id: y3.sesId,
        term_id: y3.termId,
        items: [{ fee_category_id: fcRes.data.category?.id || fcRes.data.id, amount: 80000, compulsory: true }],
      },
    });
    const bulkInvRes = await apiReq('/api/v1/school/invoices/generate-bulk', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        fee_structure_id: fsRes.data.feeStructure?.id || fsRes.data.id,
        class_id: cls300.id,
        academic_session_id: y3.sesId,
        term_id: y3.termId,
        due_date: '2027-01-31',
      },
    });
    assert.strictEqual(bulkInvRes.status, 400, 'Bulk invoicing on 300 Level must exclude graduated alumni (NO_STUDENTS)');
    assert.strictEqual(bulkInvRes.data.error, 'NO_STUDENTS', 'Expected NO_STUDENTS error when only alumni remain in class');

    // =========================================================================
    // PART B: COMPILE & PUBLISH 3-YEAR CUMULATIVE CAREER TRANSCRIPT (EXACT MATH)
    // =========================================================================
    console.log('[4/8] Compiling & publishing 3-Year Cumulative Career Transcript and asserting exact CGPA math...');
    const ctCompile = await apiReq('/api/v1/school/career-transcripts/compile', {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: { student_id: studentId },
    });
    assert.strictEqual(ctCompile.status, 200, `Compile career transcript failed: ${JSON.stringify(ctCompile.data)}`);
    const ct = ctCompile.data.transcript;

    // Total Units Attempted = 3 + 4 + 3 + 4 + 4 = 18; Units Earned = 3 + 0 + 3 + 4 + 4 = 14; QP = 15 + 0 + 15 + 16 + 20 = 66; CGPA = 66/18 = 3.67
    assert.strictEqual(ct.summary.sessions_count, 3, 'Expected 3 academic sessions in career transcript');
    assert.strictEqual(ct.summary.total_credit_units_attempted, 18, `Expected 18 attempted units, got ${ct.summary.total_credit_units_attempted}`);
    assert.strictEqual(ct.summary.total_credit_units_earned, 14, `Expected 14 earned units, got ${ct.summary.total_credit_units_earned}`);
    assert.strictEqual(ct.summary.total_grade_points, 66, `Expected 66 quality points, got ${ct.summary.total_grade_points}`);
    assert.strictEqual(ct.summary.lifetime_cgpa, 3.67, `Expected exact lifetime CGPA 3.67, got ${ct.summary.lifetime_cgpa}`);
    assert.strictEqual(ct.summary.final_standing, 'Second Class Upper (2:1)', `Expected Second Class Upper (2:1), got ${ct.summary.final_standing}`);
    assert.strictEqual(ct.summary.total_carryovers_ever, 1, 'Expected 1 historical carryover');
    assert.strictEqual(ct.summary.uncleared_carryovers_count, 0, 'Expected 0 uncleared carryovers after retake pass');
    assert.strictEqual(ct.carryovers[0].cleared, true, 'MTH 101 carryover should be marked cleared');
    assert.strictEqual(ct.carryovers[0].cleared_session_name, '2025/2026', 'MTH 101 should be cleared in 2025/2026');
    assert.deepStrictEqual(
      ct.sessions.map((s: any) => `${s.session_name}:${s.class_name}`),
      ['2024/2025:100 Level', '2025/2026:200 Level', '2026/2027:300 Level'],
      'Historical levels across 3 years must stay exact (100 Level -> 200 Level -> 300 Level)'
    );
    assert.strictEqual(ct.fee_clearance.outstanding_balance_kobo, 5000000, 'Year 1 unpaid ₦50,000 fee arrears must remain tracked in career clearance');

    // Publish Official Career Transcript
    const ctPub = await apiReq(`/api/v1/school/career-transcripts/${studentId}/publish`, {
      method: 'POST',
      token: uniToken,
      schoolId: uniId,
      body: {
        registrar_remark: 'Satisfied all Senate requirements for graduation.',
        principal_remark: 'Cleared by Faculty of Computing.',
      },
    });
    assert.strictEqual(ctPub.status, 200, `Publish career transcript failed: ${JSON.stringify(ctPub.data)}`);
    const ctrCode = ctPub.data.transcript.verification_code;
    assert(ctrCode.startsWith('CTR-'), `Expected CTR-... verification code, got ${ctrCode}`);

    // =========================================================================
    // PART C: GRADUATED ALUMNI STUDENT PORTAL + PUBLIC EMPLOYER VERIFICATION + RBAC
    // =========================================================================
    console.log('[5/8] Verifying Graduated Alumni Student Portal, Public Employer CTR Verification & RBAC...');
    const alumniLogin = await apiReq('/api/v1/public/portal/admission-login', {
      method: 'POST',
      body: { admission_number: matric, portal_type: 'STUDENT', school_id: uniId },
    });
    assert.strictEqual(alumniLogin.status, 200, `Graduated alumni matric login failed: ${JSON.stringify(alumniLogin.data)}`);
    const alumniToken = alumniLogin.data.token;

    const studentCtRes = await apiReq('/api/v1/portal/student/career-transcript', {
      token: alumniToken,
      schoolId: uniId,
    });
    assert.strictEqual(studentCtRes.status, 200, `Alumni career transcript fetch failed: ${JSON.stringify(studentCtRes.data)}`);
    assert.strictEqual(studentCtRes.data.source, 'OFFICIAL');
    assert.strictEqual(studentCtRes.data.transcript.summary.lifetime_cgpa, 3.67);
    assert.strictEqual(studentCtRes.data.transcript.verification_code, ctrCode);

    // RBAC Check: Student MUST NOT execute progression!
    const forbiddenProg = await apiReq('/api/v1/school/progression/execute', {
      method: 'POST',
      token: alumniToken,
      schoolId: uniId,
      body: { from_class_id: cls100.id, decisions: [{ student_id: studentId, action: 'PROMOTE' }] },
    });
    assert.strictEqual(forbiddenProg.status, 403, `Student must receive 403 on progression/execute, got ${forbiddenProg.status}`);

    // Public Verification by Employer / Foreign University
    const pubVerify = await apiReq('/api/v1/public/verify-document', {
      method: 'POST',
      body: { document_type: 'REPORT_CARD', code: ctrCode },
    });
    assert.strictEqual(pubVerify.status, 200, `Public CTR verify failed: ${JSON.stringify(pubVerify.data)}`);
    assert.strictEqual(pubVerify.data.valid, true);
    assert.strictEqual(pubVerify.data.document_type, 'CAREER_TRANSCRIPT');
    assert.strictEqual(pubVerify.data.details.cgpa, 3.67);
    assert.strictEqual(pubVerify.data.details.academic_standing, 'Second Class Upper (2:1)');
    assert.strictEqual(pubVerify.data.details.graduation_status, 'GRADUATED');
    assert(pubVerify.data.details.student_name_masked.includes('***'), 'Learner name must be privacy-masked publicly');

    // =========================================================================
    // PART D: K-12 MIXED PROMOTION/RETENTION + SAFE ONE-CLICK UNDO / ROLLBACK
    // =========================================================================
    console.log('[6/8] Testing K-12 Mixed Promotion/Retention (JSS 1 -> JSS 2) & Safe Undo/Rollback...');
    const k12Email = `principal.k12.${Date.now()}@oakridge.sch.ng`;
    const k12Reg = await apiReq('/api/v1/auth/register-school', {
      method: 'POST',
      body: {
        schoolName: 'Oakridge Royal College',
        schoolType: 'Secondary',
        state: 'Oyo',
        lga: 'Ibadan North',
        address: '22 Bodija Estate, Ibadan',
        phone: '+2348099887766',
        email: k12Email,
        ownerName: 'Mrs. Folake Adeyemi',
        ownerEmail: k12Email,
        password: 'Password123!',
        question1: 'City?',
        answer1: 'Ibadan',
        question2: 'Motto?',
        answer2: 'Discipline',
      },
    });
    assert.strictEqual(k12Reg.status, 201);
    const k12Token = k12Reg.data.token;
    const k12Id = k12Reg.data.school?.id || k12Reg.data.activeSchool?.id || k12Reg.data.activeSchoolId;

    const jss1 = await ensureClass(k12Token, k12Id, 'JSS 1', 'Junior Secondary', 1);
    const jss2 = await ensureClass(k12Token, k12Id, 'JSS 2', 'Junior Secondary', 2);
    assert(jss1?.id && jss2?.id, 'Expected JSS 1 and JSS 2 in K-12 secondary school');

    const k12SesList = (await apiReq('/api/v1/school/academic-sessions', { token: k12Token, schoolId: k12Id })).data.sessions || [];
    let k12Ses1Id = k12SesList[0]?.id;
    if (!k12Ses1Id) {
      const sCreate = await apiReq('/api/v1/school/academic-sessions', {
        method: 'POST',
        token: k12Token,
        schoolId: k12Id,
        body: { name: '2025/2026', start_date: '2025-09-01', end_date: '2026-07-31', status: 'ACTIVE' },
      });
      k12Ses1Id = sCreate.data.session?.id || sCreate.data.id;
    }

    const enrollK12 = async (adm: string, fn: string, ln: string) => {
      const r = await apiReq('/api/v1/school/students', {
        method: 'POST',
        token: k12Token,
        schoolId: k12Id,
        body: {
          admission_number: adm,
          first_name: fn,
          last_name: ln,
          gender: 'Male',
          class_id: jss1.id,
          class_name: jss1.name,
          academic_session_id: k12Ses1Id,
          student_status: 'ACTIVE',
        },
      });
      assert.strictEqual(r.status, 201);
      return r.data.student?.id || r.data.id;
    };

    const s1 = await enrollK12('ORC/24/001', 'Tunde', 'Bakare');
    const s2 = await enrollK12('ORC/24/002', 'Emeka', 'Nwachukwu');
    const s3 = await enrollK12('ORC/24/003', 'Musa', 'Ibrahim');

    const k12Preview = await apiReq(
      `/api/v1/school/progression/preview?class_id=${encodeURIComponent(jss1.id)}&from_session_id=${encodeURIComponent(k12Ses1Id)}`,
      { token: k12Token, schoolId: k12Id }
    );
    assert.strictEqual(k12Preview.status, 200);
    assert.strictEqual(k12Preview.data.suggestion?.nextClass?.id, jss2.id, 'Smart K-12 ladder should suggest JSS 2 after JSS 1');

    // Execute mixed batch: s1 & s2 PROMOTE -> JSS 2, s3 RETAIN -> JSS 1
    const k12BatchRes = await apiReq('/api/v1/school/progression/execute', {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
      body: {
        from_session_id: k12Ses1Id,
        to_session_id: k12Ses1Id,
        from_class_id: jss1.id,
        to_class_id: jss2.id,
        notes: 'End-of-Year Promotion Board',
        decisions: [
          { student_id: s1, action: 'PROMOTE', target_class_id: jss2.id },
          { student_id: s2, action: 'PROMOTE', target_class_id: jss2.id },
          { student_id: s3, action: 'RETAIN' },
        ],
      },
    });
    assert.strictEqual(k12BatchRes.status, 201);
    assert.strictEqual(k12BatchRes.data.batch.promoted_count, 2);
    assert.strictEqual(k12BatchRes.data.batch.retained_count, 1);
    const batchId = k12BatchRes.data.batch.id;

    // Verify s1 moved to JSS 2 and s3 stayed in JSS 1
    const stuAfter = (await apiReq('/api/v1/school/students', { token: k12Token, schoolId: k12Id })).data.students || [];
    assert.strictEqual(stuAfter.find((x: any) => x.id === s1)?.class_id, jss2.id, 's1 should be in JSS 2');
    assert.strictEqual(stuAfter.find((x: any) => x.id === s3)?.class_id, jss1.id, 's3 should stay in JSS 1');

    // Execute Safe Undo / Rollback
    const rollbackRes = await apiReq(`/api/v1/school/progression/batches/${batchId}/rollback`, {
      method: 'POST',
      token: k12Token,
      schoolId: k12Id,
    });
    assert.strictEqual(rollbackRes.status, 200, `Rollback failed: ${JSON.stringify(rollbackRes.data)}`);
    assert.strictEqual(rollbackRes.data.restoredCount, 3);

    const stuReverted = (await apiReq('/api/v1/school/students', { token: k12Token, schoolId: k12Id })).data.students || [];
    for (const sid of [s1, s2, s3]) {
      assert.strictEqual(
        stuReverted.find((x: any) => x.id === sid)?.class_id,
        jss1.id,
        `Student ${sid} must be restored back to JSS 1 after rollback`
      );
    }

    // =========================================================================
    // PART E: HEADLESS CHROMIUM FULL UI VERIFICATION (1440px & 360px)
    // =========================================================================
    console.log('[7/8] Launching Headless Chromium to verify Progression Hub, Alumni Registry, Career Transcript Modal & Public CTR Verifier...');
    const chromePort = 9344;
    const chromeUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-prog-chrome-'));
    chromeProc = spawn(
      CHROME_BIN,
      [
        `--remote-debugging-port=${chromePort}`,
        `--user-data-dir=${chromeUserDir}`,
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1440,900',
        'about:blank',
      ],
      { stdio: 'ignore' }
    );

    let wsUrl = '';
    for (let i = 0; i < 40; i++) {
      try {
        const listRes = await fetch(`http://127.0.0.1:${chromePort}/json/list`);
        const pages = (await listRes.json()) as any[];
        const target = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
        if (target) {
          wsUrl = target.webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(wsUrl, 'Failed to attach to Chromium CDP');
    cdp = await CDPClient.connect(wsUrl);

    // 1. Public CTR-... Verification UI on Login page
    await cdp.navigate(`${TEST_BASE}/#login`);
    await cdp.waitForText('Verify Document');
    await cdp.clickButtonByText('Verify Document');
    await cdp.clickButtonByText('Report Card / Transcript');
    await cdp.evaluate(`(() => {
      const inp = document.querySelector('input[placeholder*="CTR-"]');
      if (!inp) throw new Error('CTR verification input not found');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, ${JSON.stringify(ctrCode)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.clickButtonByText('Verify Document Now');
    await cdp.waitForText('Authentic Cumulative Career Transcript Verified');
    await cdp.waitForText('3.67 / 5.00');
    await cdp.waitForText('Second Class Upper (2:1)');
    console.log('   ✓ Public CTR Career Transcript Verifier UI passed!');

    // 2. Admin Sign-in & Progression Hub UI (Desktop 1440px)
    await cdp.evaluate(`(() => {
      localStorage.setItem('bursariq_session_token', ${JSON.stringify(uniToken)});
      localStorage.setItem('bursariq_active_school', ${JSON.stringify(uniId)});
    })()`);
    await cdp.navigate(`${TEST_BASE}/?e2e_auth=1`);
    await cdp.waitForText('Progression & Graduation');
    await cdp.clickButtonByText('Progression & Graduation');
    await cdp.waitForText('Academic Progression, Graduation & Career Transcripts');

    // Switch to Alumni Registry tab & open Official Career Transcript Modal
    await cdp.clickButtonByText('Alumni Registry');
    await cdp.waitForText('Chidinma Okafor');
    await cdp.waitForText('Second Class Upper (2:1)');
    await cdp.clickButtonByText(ctrCode);
    await cdp.waitForText('Official Cumulative Academic Career Transcript');
    await cdp.waitForText('3.67 / 5.00');
    await cdp.waitForText('2024/2025');
    await cdp.waitForText('2025/2026');
    await cdp.waitForText('2026/2027');
    await cdp.waitForText('Cleared in 2025/2026');

    const overflowDesktop = await cdp.evaluate<number>(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`
    );
    assert(overflowDesktop <= 4, `Unexpected desktop horizontal overflow: ${overflowDesktop}px`);

    // Close modal & check Ledger & Undo tab
    await cdp.evaluate(`(() => {
      const closeBtn = document.querySelector('button[aria-label="Close transcript modal"]');
      if (closeBtn) closeBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 300));
    await cdp.clickButtonByText('Ledger & Undo');
    await cdp.waitForText('Convocation Graduating Cohort');

    // Mobile viewport check (360px)
    await cdp.setViewport(360, 780, true);
    await new Promise((r) => setTimeout(r, 400));
    const overflowMobile = await cdp.evaluate<number>(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`
    );
    assert(overflowMobile <= 4, `Unexpected 360px mobile horizontal overflow: ${overflowMobile}px`);

    // Assert zero runtime browser errors or 5xx API failures
    assert.strictEqual(cdp.pageErrors.length, 0, `Page errors: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.consoleErrors.length, 0, `Console errors: ${cdp.consoleErrors.join(' | ')}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`);

    console.log('[8/8] ALL PROGRESSION, GRADUATION, ROLLBACK & 3-YEAR CAREER TRANSCRIPT E2E ASSERTIONS PASSED 100%!');
  } catch (err) {
    console.error('\n[E2E FAILURE]', err);
    console.error('\n--- Server Logs (tail) ---\n', serverLogs.slice(-2000));
    process.exitCode = 1;
  } finally {
    try {
      await cdp?.close();
    } catch {}
    try {
      chromeProc?.kill('SIGKILL');
    } catch {}
    try {
      serverProc.kill('SIGTERM');
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

run();
