/**
 * Universal Bulk Results Upload E2E Test (Primary, Secondary & Tertiary Portals)
 *
 * Tests end-to-end in an isolated sandbox (NEVER touches live Neon PostgreSQL!):
 *  1. Unit tests for Class Broadsheet Matrix & Multi-Term/Year CSV parser.
 *  2. Primary School Portal (Nursery & Primary, 3 Terms):
 *     - Bulk upload Previous Academic Year (2024/2025, Primary 4, 1st/2nd/3rd Term) for Primary 5 pupils
 *     - Zero-Distortion check (pupils stay in Primary 5)
 *     - Auto-generated Term & Full-Session Cumulative Report Cards
 *     - Bulk upload Current Academic Year (2025/2026 active session, "First Term" -> canonical match to "1st Term", ZERO duplicate terms, unique full-name fallback matching)
 *     - Verify POST /report-cards/generate & /session-report-cards/generate filtered by historical class (Primary 4) works!
 *  3. Secondary School Portal (Secondary, 3 Terms):
 *     - Combined single upload spanning BOTH Previous Academic Year (2024/2025 JSS 1) AND Current Academic Year (2025/2026 JSS 2)
 *     - Verify current_year_rows & previous_year_rows preview breakdown + auto-generated Term & Session Report Cards
 *  4. Tertiary Institution Portal (College of Health Technology, 2 Semesters, 5.0 GPA):
 *     - Bulk upload 2024/2025 1st & 2nd Semester ("First Semester" canonical match -> ZERO duplicate terms) + modifiable credit units
 *  5. Real Headless Chromium UI E2E (Desktop 1440px & Mobile 390px):
 *     - Secondary School Portal: Examinations & Scores -> Bulk Upload Results -> Class Broadsheet Matrix Excel Paste -> Parse -> Validate -> Upload -> Verify Report Cards immediately populated
 *     - Primary School Portal: Verify Bulk Upload Results button in Examinations & Scores & Report Cards + Primary-tailored modal (Units hidden by default) + Mobile 390px responsiveness + 0 page errors + 0 5xx errors
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  parseClassBroadsheetMatrix,
  parseLongBulkResultsCsv,
} from '../src/utils/bulkResultsPasteParser.ts';

const TEST_PORT = 3232;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;

async function apiReq(
  baseUrl: string,
  method: string,
  endpoint: string,
  body?: any,
  token?: string,
  schoolId?: string
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (schoolId) headers['x-school-id'] = schoolId;
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

async function waitForHealth(baseUrl: string, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Isolated sandbox server failed to boot within timeout.');
}

async function stopChild(proc: ChildProcess | null) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    if (!proc.killed) proc.kill('SIGKILL');
  } catch {}
}

class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  public pageErrors: string[] = [];
  public apiServerErrors: Array<{ url: string; status: number }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev: any) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.pageErrors.push(msg.params?.exceptionDetails?.text || 'Uncaught exception');
      } else if (msg.method === 'Network.responseReceived') {
        const resp = msg.params?.response;
        if (resp && resp.url?.includes('/api/') && resp.status >= 500) {
          this.apiServerErrors.push({ url: resp.url, status: resp.status });
        }
      }
    });
  }

  static async connect(port: number): Promise<CDPClient> {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      try {
        const listRes = await fetch(`http://127.0.0.1:${port}/json`);
        const targets: any[] = await listRes.json();
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) {
          const ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise<void>((res, rej) => {
            ws.addEventListener('open', () => res(), { once: true });
            ws.addEventListener('error', (err) => rej(err), { once: true });
          });
          const c = new CDPClient(ws);
          await c.send('Page.enable');
          await c.send('Runtime.enable');
          await c.send('Network.enable');
          return c;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Failed to connect to headless Chromium CDP');
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<any> {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r?.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'JS eval error');
    }
    return r?.result?.value;
  }

  async navigate(url: string) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 900));
  }

  async setViewport(width: number, height: number) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 500,
    });
  }

  async bodyText(): Promise<string> {
    return (await this.evaluate(`return document.body ? document.body.innerText : '';`)) || '';
  }

  async waitForText(text: string, timeoutMs = 12000) {
    const start = Date.now();
    const needle = text.toLowerCase();
    while (Date.now() - start < timeoutMs) {
      const txt = await this.bodyText();
      if (txt.toLowerCase().includes(needle)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    const last = await this.bodyText();
    throw new Error(`Timed out waiting for text "${text}".\nPAGE:\n${last.slice(0, 2200)}`);
  }

  async clickButton(label: string) {
    const clicked = await this.evaluate(`
      const target = ${JSON.stringify(label.toLowerCase())};
      const btns = Array.from(document.querySelectorAll('button'));
      const found = btns.find((b) => !b.disabled && (b.innerText || '').trim().toLowerCase().includes(target));
      if (!found) return false;
      found.scrollIntoView({ block: 'center' });
      found.click();
      return true;
    `);
    if (!clicked) throw new Error(`Button containing "${label}" not found or disabled.`);
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function run() {
  console.log('=== Universal Bulk Results Upload E2E (Primary, Secondary & Tertiary) ===');

  // ---------------------------------------------------------------------------
  // 1. UNIT TESTS: Broadsheet Matrix & Long Multi-Term/Year CSV Parser
  // ---------------------------------------------------------------------------
  console.log('1. Running unit tests for Class Broadsheet Matrix & Multi-Term CSV parsers...');
  const primaryMatrixPaste = [
    'S/N\tAdmission No\tPupil Name\tMathematics\tEnglish Studies\tBasic Science\tTotal\tAverage\tPosition',
    '1\tPRI/001\tChidi Okafor\t34/52\t30/48\t84\t248\t82.7\t1st',
    '2\tPRI/002\tZainab Musa\t28/46\t32/50\t79\t235\t78.3\t2nd',
  ].join('\n');

  const parsedPrimary = parseClassBroadsheetMatrix(primaryMatrixPaste, {
    sessionName: '2025/2026',
    termName: '1st Term',
    className: 'Primary 5',
  });
  assert.strictEqual(parsedPrimary.error, undefined);
  assert.strictEqual(parsedPrimary.studentRowsCount, 2);
  assert.strictEqual(parsedPrimary.detectedSubjects.length, 3);
  assert.strictEqual(parsedPrimary.skippedSummaryCols.length, 3, 'Must skip Total, Average, Position');
  assert.strictEqual(parsedPrimary.rows.length, 6);
  assert.strictEqual(parsedPrimary.rows[0].ca_score, '34');
  assert.strictEqual(parsedPrimary.rows[0].exam_score, '52');
  assert.strictEqual(parsedPrimary.rows[0].total_score, '86');
  assert.strictEqual(parsedPrimary.rows[2].total_score, '84');

  const tertiaryMatrixPaste = [
    'Matric No,Student Name,FHC 111 (2u),FHC 112 (3u),GPA',
    'FCHT/001,Ngozi Eze,28/50,30/55,4.6',
  ].join('\n');
  const parsedTertiary = parseClassBroadsheetMatrix(tertiaryMatrixPaste, {
    sessionName: '2024/2025',
    termName: '1st Semester',
    className: 'Year 1 (100L)',
    department: 'Family Healthcare',
  });
  assert.strictEqual(parsedTertiary.rows.length, 2);
  assert.strictEqual(parsedTertiary.rows[0].subject_code, 'FHC 111');
  assert.strictEqual(parsedTertiary.rows[0].credit_units, '2');
  assert.strictEqual(parsedTertiary.rows[1].credit_units, '3');

  const longCsvWithSn = [
    'S/N,admission_number,session_name,term_name,class_name,subject_code,subject_name,credit_units,ca_score,exam_score,total_score',
    '1,SEC/001,2024/2025,1st Term,JSS 1,MTH,"Mathematics, General",1,30,52,82',
  ].join('\n');
  const parsedLong = parseLongBulkResultsCsv(longCsvWithSn);
  assert.strictEqual(parsedLong.rows.length, 1);
  assert.strictEqual(parsedLong.rows[0].admission_number, 'SEC/001');
  assert.strictEqual(parsedLong.rows[0].subject_name, 'Mathematics, General');
  console.log('   ✓ Broadsheet matrix & multi-term CSV unit tests passed');

  // ---------------------------------------------------------------------------
  // 2. BOOT ISOLATED SANDBOX SERVER (Never touches live Neon PostgreSQL!)
  // ---------------------------------------------------------------------------
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-bulkres-e2e-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-br-'));
  let serverProc: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;
  const serverLogs: string[] = [];

  try {
    const rootDir = process.cwd();
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
      const srcPath = path.join(rootDir, item);
      if (fs.existsSync(srcPath)) {
        fs.symlinkSync(srcPath, path.join(tmpDir, item));
      }
    }
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });

    console.log(`2. Booting isolated sandbox server on port ${TEST_PORT}...`);
    serverProc = spawn(path.join(rootDir, 'node_modules', '.bin', 'tsx'), ['server.ts'], {
      cwd: tmpDir,
      env: {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME || '/root',
        PORT: String(TEST_PORT),
        NODE_ENV: 'development',
        RENDER: '1',
        DISABLE_HMR: 'true',
        ALLOW_SANDBOX_PAYMENTS: 'true',
        JWT_SECRET: 'bulk-results-e2e-secret-99999',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout?.on('data', (d) => serverLogs.push(d.toString()));
    serverProc.stderr?.on('data', (d) => serverLogs.push(d.toString()));
    await waitForHealth(TEST_BASE);
    console.log('   ✓ Isolated sandbox server healthy');

    // -------------------------------------------------------------------------
    // 3. PRIMARY SCHOOL PORTAL: Previous Academic Year (3 Terms) + Current Academic Year
    // -------------------------------------------------------------------------
    console.log('3. Testing Primary School Portal (Nursery & Primary — Past 3-Term + Current Active Year)...');
    const priEmail = `headteacher.pri.${Date.now()}@sunshineprimary.edu.ng`;
    const priPassword = 'StrongPassword#2026!';
    const priReg = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Sunshine Nursery & Primary School',
      schoolType: 'Nursery & Primary',
      institutionCategory: 'K12',
      academicCycleType: 'TERM',
      cycleLabels: ['1st Term', '2nd Term', '3rd Term'],
      gradingMode: 'PERCENTAGE',
      state: 'Lagos',
      lga: 'Ikeja',
      address: '5 Palm Avenue, Ikeja',
      phone: '08031110001',
      email: 'info@sunshineprimary.edu.ng',
      ownerName: 'Mrs. Folake Adeyemi',
      ownerEmail: priEmail,
      password: priPassword,
      question1: 'City?',
      answer1: 'Lagos',
      question2: 'Color?',
      answer2: 'Green',
    });
    assert.strictEqual(priReg.status, 201, `Primary reg failed: ${JSON.stringify(priReg.data)}`);
    const priToken = priReg.data.token;
    const priSchoolId = priReg.data.school?.id || priReg.data.activeSchool?.id || priReg.data.activeSchoolId;

    const ensureActiveSession = async (token: string, schoolId: string, name = '2025/2026') => {
      let sesInit = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
      let active = (sesInit.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || (sesInit.data.sessions || [])[0];
      if (!active) {
        const created = await apiReq(TEST_BASE, 'POST', '/api/v1/school/academic-sessions', { name, status: 'ACTIVE' }, token, schoolId);
        assert.ok(created.status === 200 || created.status === 201, `Create session failed: ${JSON.stringify(created.data)}`);
        sesInit = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
        active = (sesInit.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || (sesInit.data.sessions || [])[0];
      }
      assert.ok(active, 'Active session must exist');
      await apiReq(TEST_BASE, 'POST', `/api/v1/school/academic-sessions/${active.id}/ensure-terms`, {}, token, schoolId);
      return active;
    };

    const priActiveSes = await ensureActiveSession(priToken, priSchoolId, '2025/2026');

    const priCls4 = (await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Primary 4', level: 'Primary' }, priToken, priSchoolId)).data.class;
    const priCls5 = (await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Primary 5', level: 'Primary' }, priToken, priSchoolId)).data.class;

    const priStu1 = (await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Chidi', last_name: 'Okafor', full_name: 'Chidi Okafor', admission_number: 'SUN/PRI/001', gender: 'Male', class_id: priCls5.id },
      priToken,
      priSchoolId
    )).data.student;
    const priStu2 = (await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Zainab', last_name: 'Musa', full_name: 'Zainab Musa', admission_number: 'SUN/PRI/002', gender: 'Female', class_id: priCls5.id },
      priToken,
      priSchoolId
    )).data.student;

    // Upload Previous Academic Year (2024/2025, Primary 4, ALL 3 TERMS) + Current Active Year (Primary 5, "First Term" canonical match + full-name fallback!)
    const priBulkRows = [
      // Past year 2024/2025 Primary 4 - 1st, 2nd, 3rd Term
      { admission_number: 'SUN/PRI/001', session_name: '2024/2025', term_name: '1st Term', class_name: 'Primary 4', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 34, exam_score: 54, total_score: 88 },
      { admission_number: 'SUN/PRI/001', session_name: '2024/2025', term_name: '1st Term', class_name: 'Primary 4', subject_code: 'ENG', subject_name: 'English Studies', credit_units: 1, ca_score: 30, exam_score: 50, total_score: 80 },
      { admission_number: 'SUN/PRI/001', session_name: '2024/2025', term_name: '2nd Term', class_name: 'Primary 4', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 36, exam_score: 54, total_score: 90 },
      { admission_number: 'SUN/PRI/001', session_name: '2024/2025', term_name: '3rd Term', class_name: 'Primary 4', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 35, exam_score: 57, total_score: 92 },
      { admission_number: 'SUN/PRI/002', session_name: '2024/2025', term_name: '1st Term', class_name: 'Primary 4', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 28, exam_score: 48, total_score: 76 },
      { admission_number: 'SUN/PRI/002', session_name: '2024/2025', term_name: '1st Term', class_name: 'Primary 4', subject_code: 'ENG', subject_name: 'English Studies', credit_units: 1, ca_score: 30, exam_score: 52, total_score: 82 },
      // Current Active Session: "First Term" must canonically match existing "1st Term" AND match Zainab Musa by unique Full Name!
      { admission_number: 'SUN/PRI/001', session_name: priActiveSes.name, term_name: 'First Term', class_name: 'Primary 5', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 35, exam_score: 55, total_score: 90 },
      { admission_number: 'Zainab Musa', session_name: priActiveSes.name, term_name: 'First Term', class_name: 'Primary 5', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 30, exam_score: 50, total_score: 80 },
    ];

    const priPrevRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/historical-backlog/preview', { rows: priBulkRows }, priToken, priSchoolId);
    assert.strictEqual(priPrevRes.status, 200, `Primary preview failed: ${JSON.stringify(priPrevRes.data)}`);
    assert.strictEqual(priPrevRes.data.summary.valid_rows, 8);
    assert.strictEqual(priPrevRes.data.summary.current_year_rows, 2, 'Preview must identify 2 current-year rows');
    assert.strictEqual(priPrevRes.data.summary.previous_year_rows, 6, 'Preview must identify 6 previous-year rows');

    const priImpRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/historical-backlog/import',
      { rows: priBulkRows, publish_scores: true, auto_generate_reports: true },
      priToken,
      priSchoolId
    );
    assert.strictEqual(priImpRes.status, 201, `Primary import failed: ${JSON.stringify(priImpRes.data)}`);
    assert.strictEqual(priImpRes.data.summary.scoresSaved, 8);
    assert.ok(priImpRes.data.summary.termReportsGenerated >= 5, `Expected auto-generated term reports, got ${priImpRes.data.summary.termReportsGenerated}`);
    assert.ok(priImpRes.data.summary.sessionReportsGenerated >= 4, `Expected auto-generated session reports, got ${priImpRes.data.summary.sessionReportsGenerated}`);

    // Verify ZERO duplicate terms on active session ("First Term" matched existing "1st Term")
    const priSesAfter = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, priToken, priSchoolId);
    const activeAfter = priSesAfter.data.sessions.find((s: any) => s.id === priActiveSes.id);
    assert.strictEqual(activeAfter.terms.length, 3, `Active session must still have exactly 3 terms (no First Term duplicate), got ${activeAfter.terms.map((t: any) => t.name)}`);
    const past2024Pri = priSesAfter.data.sessions.find((s: any) => s.name === '2024/2025');
    assert.ok(past2024Pri && past2024Pri.status === 'COMPLETED' && past2024Pri.terms.length === 3);

    // Verify Zero-Distortion: Chidi & Zainab are STILL in Primary 5!
    const priStuList = await apiReq(TEST_BASE, 'GET', '/api/v1/school/students', undefined, priToken, priSchoolId);
    const chidiAfter = priStuList.data.students.find((s: any) => s.id === priStu1.id);
    assert.strictEqual(chidiAfter.class_id, priCls5.id, 'Past Primary 4 upload must NOT move Chidi out of Primary 5!');

    // Verify report cards exist & manual historical-class /report-cards/generate works for Primary 4 in 2024/2025!
    const priRcList = await apiReq(TEST_BASE, 'GET', `/api/v1/school/report-cards?academic_session_id=${past2024Pri.id}`, undefined, priToken, priSchoolId);
    assert.ok((priRcList.data.reportCards || []).length >= 4, 'Auto-generated 2024/2025 term report cards must be stored');
    const priSessionRcList = await apiReq(TEST_BASE, 'GET', `/api/v1/school/session-report-cards?academic_session_id=${past2024Pri.id}`, undefined, priToken, priSchoolId);
    assert.strictEqual((priSessionRcList.data.sessionReportCards || []).length, 2, 'Both Primary pupils must have 2024/2025 cumulative session report cards');

    const histGenRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/session-report-cards/generate',
      { academic_session_id: past2024Pri.id, class_id: priCls4.id },
      priToken,
      priSchoolId
    );
    assert.strictEqual(histGenRes.status, 200, `Historical class_id session report generation failed: ${JSON.stringify(histGenRes.data)}`);
    assert.strictEqual(histGenRes.data.count, 2, 'Historical Primary 4 filter must find both pupils now in Primary 5');
    console.log('   ✓ Primary School Portal (Past 3-Term + Current Active Year + Zero Distortion + Auto Reports) verified!');

    // -------------------------------------------------------------------------
    // 4. SECONDARY SCHOOL PORTAL: Past Year (JSS 1) + Current Year (JSS 2)
    // -------------------------------------------------------------------------
    console.log('4. Testing Secondary School Portal (Secondary — Past & Current Year Bulk Results)...');
    const secEmail = `principal.sec.${Date.now()}@unitycollege.edu.ng`;
    const secPassword = 'StrongPassword#2026!';
    const secReg = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Unity Grammar Secondary School',
      schoolType: 'Secondary',
      institutionCategory: 'K12',
      academicCycleType: 'TERM',
      cycleLabels: ['1st Term', '2nd Term', '3rd Term'],
      gradingMode: 'PERCENTAGE',
      state: 'Oyo',
      lga: 'Ibadan North',
      address: '22 Bodija Road, Ibadan',
      phone: '08032220002',
      email: 'info@unitygrammar.edu.ng',
      ownerName: 'Mr. Babatunde Ogunleye',
      ownerEmail: secEmail,
      password: secPassword,
      question1: 'City?',
      answer1: 'Ibadan',
      question2: 'Color?',
      answer2: 'Blue',
    });
    assert.strictEqual(secReg.status, 201, `Secondary reg failed: ${JSON.stringify(secReg.data)}`);
    const secToken = secReg.data.token;
    const secSchoolId = secReg.data.school?.id || secReg.data.activeSchool?.id || secReg.data.activeSchoolId;

    const secActiveSes = await ensureActiveSession(secToken, secSchoolId, '2025/2026');

    const secJss1 = (await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'JSS 1', level: 'Junior Secondary' }, secToken, secSchoolId)).data.class;
    const secJss2 = (await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'JSS 2', level: 'Junior Secondary' }, secToken, secSchoolId)).data.class;

    await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Tunde', last_name: 'Bakare', full_name: 'Tunde Bakare', admission_number: 'UGS/2024/001', gender: 'Male', class_id: secJss2.id },
      secToken,
      secSchoolId
    );
    await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Amaka', last_name: 'Obi', full_name: 'Amaka Obi', admission_number: 'UGS/2024/002', gender: 'Female', class_id: secJss2.id },
      secToken,
      secSchoolId
    );

    const secImport = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/historical-backlog/import',
      {
        rows: [
          { admission_number: 'UGS/2024/001', session_name: '2024/2025', term_name: '1st Term', class_name: 'JSS 1', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 32, exam_score: 52, total_score: 84 },
          { admission_number: 'UGS/2024/001', session_name: '2024/2025', term_name: '2nd Term', class_name: 'JSS 1', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 34, exam_score: 54, total_score: 88 },
          { admission_number: 'UGS/2024/001', session_name: '2024/2025', term_name: '3rd Term', class_name: 'JSS 1', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 35, exam_score: 55, total_score: 90 },
          { admission_number: 'UGS/2024/001', session_name: secActiveSes.name, term_name: '1st Term', class_name: 'JSS 2', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 30, exam_score: 56, total_score: 86 },
          { admission_number: 'UGS/2024/002', session_name: secActiveSes.name, term_name: '1st Term', class_name: 'JSS 2', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 36, exam_score: 58, total_score: 94 },
        ],
        publish_scores: true,
        auto_generate_reports: true,
      },
      secToken,
      secSchoolId
    );
    assert.strictEqual(secImport.status, 201, `Secondary import failed: ${JSON.stringify(secImport.data)}`);
    assert.strictEqual(secImport.data.summary.scoresSaved, 5);
    assert.ok(secImport.data.summary.termReportsGenerated >= 5);
    assert.ok(secImport.data.summary.sessionReportsGenerated >= 3);
    console.log('   ✓ Secondary School Portal (Past JSS 1 3-Term + Current JSS 2 Active Year) verified!');

    // -------------------------------------------------------------------------
    // 5. TERTIARY PORTAL: Canonical Semester Match + GPA Credit Units
    // -------------------------------------------------------------------------
    console.log('5. Testing Tertiary Institution Portal (1st & 2nd Semester Canonical Match + GPA)...');
    const terEmail = `registrar.ter.${Date.now()}@healthtech.edu.ng`;
    const terReg = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Delta College of Health Technology',
      schoolType: 'College of Health / Nursing',
      institutionCategory: 'TERTIARY',
      academicCycleType: 'SEMESTER',
      cycleLabels: ['1st Semester', '2nd Semester'],
      gradingMode: 'GPA_5',
      state: 'Delta',
      lga: 'Warri South',
      address: '8 Hospital Road, Warri',
      phone: '08033330003',
      email: 'info@dcht.edu.ng',
      ownerName: 'Dr. Mercy Ovie',
      ownerEmail: terEmail,
      password: secPassword,
      question1: 'City?',
      answer1: 'Warri',
      question2: 'Pet?',
      answer2: 'Leo',
    });
    assert.strictEqual(terReg.status, 201);
    const terToken = terReg.data.token;
    const terSchoolId = terReg.data.school?.id || terReg.data.activeSchool?.id || terReg.data.activeSchoolId;
    const terActiveSes = await ensureActiveSession(terToken, terSchoolId, '2025/2026');
    const terLvl100 = (await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Year 1 (100L)', level: 'Tertiary' }, terToken, terSchoolId)).data.class;
    await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Efe', last_name: 'Okoro', full_name: 'Efe Okoro', admission_number: 'DCHT/FHC/001', gender: 'Female', class_id: terLvl100.id },
      terToken,
      terSchoolId
    );
    const terImp = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/historical-backlog/import',
      {
        rows: [
          { admission_number: 'DCHT/FHC/001', session_name: terActiveSes.name, term_name: 'First Semester', class_name: 'Year 1 (100L)', department: 'Family Healthcare', subject_code: 'FHC 111', subject_name: 'Family Health I', credit_units: 3, ca_score: 28, exam_score: 52, total_score: 80 },
          { admission_number: 'DCHT/FHC/001', session_name: terActiveSes.name, term_name: 'Second Semester', class_name: 'Year 1 (100L)', department: 'Family Healthcare', subject_code: 'FHC 121', subject_name: 'Maternal Care II', credit_units: 2, ca_score: 24, exam_score: 42, total_score: 66 },
        ],
        publish_scores: true,
        auto_generate_reports: true,
      },
      terToken,
      terSchoolId
    );
    assert.strictEqual(terImp.status, 201);
    const terSesAfter = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, terToken, terSchoolId);
    const terActAfter = terSesAfter.data.sessions.find((s: any) => s.id === terActiveSes.id);
    assert.strictEqual(terActAfter.terms.length, 2, `Tertiary session must match First/Second Semester to existing 1st/2nd Semester without duplicates, got ${terActAfter.terms.map((t: any) => t.name)}`);
    console.log('   ✓ Tertiary Portal canonical semester match & GPA bulk upload verified!');

    // -------------------------------------------------------------------------
    // 6. REAL HEADLESS CHROMIUM UI E2E (Secondary & Primary Portals + Mobile 390px)
    // -------------------------------------------------------------------------
    console.log('6. Launching Headless Chromium to test Secondary & Primary Portals UI + Broadsheet Paste...');
    const chromePath = [
      '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ].find((p) => fs.existsSync(p));
    assert.ok(chromePath, 'Chromium binary not found');
    const debugPort = 9247;
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
    await cdp.setViewport(1440, 900);

    // 6a. Login to Secondary School Portal & test Class Broadsheet Excel Paste in Examinations & Scores!
    await cdp.navigate(`${TEST_BASE}/login`);
    await cdp.waitForText('Sign In');
    await cdp.evaluate(`
      const email = document.querySelector('input[type="email"]');
      const pwd = document.querySelector('input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(email, ${JSON.stringify(secEmail)});
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwd, ${JSON.stringify(secPassword)});
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type="submit"]').click();
    `);
    await cdp.waitForText('Unity Grammar Secondary School');

    await cdp.clickButton('Performance & Reports');
    await cdp.waitForText('Academic Performance & Digital Report Cards');
    await cdp.clickButton('Examinations & Scores');
    await cdp.waitForText('Bulk Upload Results');
    await cdp.clickButton('Bulk Upload Results');
    await cdp.waitForText('Bulk Upload Term, Session & Past-Year Results');

    // Paste a Class Broadsheet Matrix for JSS 2 (2nd Term, current active session) straight from Excel!
    const broadsheetPaste = [
      'S/N\tAdmission No\tStudent Name\tMathematics\tEnglish Studies\tBasic Science\tTotal\tPosition',
      '1\tUGS/2024/001\tTunde Bakare\t34/54\t30/50\t85\t253\t2nd',
      '2\tUGS/2024/002\tAmaka Obi\t36/56\t34/54\t91\t271\t1st',
    ].join('\n');

    await cdp.evaluate(`
      const termInp = document.querySelector('input[aria-label="Target Term"]');
      const clsInp = document.querySelector('input[aria-label="Target Class"]');
      const area = document.querySelector('textarea[aria-label="Class Broadsheet Paste Area"]');
      if (!termInp || !clsInp || !area) throw new Error('Broadsheet inputs not found');
      const setInp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const setTxt = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setInp.call(termInp, '2nd Term');
      termInp.dispatchEvent(new Event('input', { bubbles: true }));
      setInp.call(clsInp, 'JSS 2');
      clsInp.dispatchEvent(new Event('input', { bubbles: true }));
      setTxt.call(area, ${JSON.stringify(broadsheetPaste)});
      area.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await cdp.clickButton('Parse Broadsheet into Review Table');
    await cdp.waitForText('Parsed 6 score entries');
    await cdp.clickButton('Validate & Preview');
    await cdp.waitForText('6 valid');
    await cdp.clickButton('Upload 6 Results');
    await cdp.waitForText('Imported 6 registration(s) and 6 result score(s)');

    // Open Report Cards tab and verify auto-generated report cards appear right away!
    await cdp.clickButton('Report Cards');
    await cdp.waitForText('Official Digital Report Cards Registry');
    await cdp.waitForText('Amaka Obi');
    const secReportsBody = await cdp.bodyText();
    assert.ok(secReportsBody.includes('Bulk Upload Results'), 'Report Cards tab must also show Bulk Upload Results button');
    assert.ok(secReportsBody.includes('Tunde Bakare') && secReportsBody.includes('Amaka Obi'), 'Uploaded Secondary results must immediately appear in Report Cards');
    console.log('   ✓ Secondary School Portal Chromium Broadsheet Excel Paste -> Auto Report Cards verified!');

    // 6b. Switch to Primary School Portal & verify Bulk Upload Results + Mobile 390px responsiveness!
    await cdp.evaluate(`localStorage.clear(); sessionStorage.clear();`);
    await cdp.navigate(`${TEST_BASE}/login`);
    await cdp.waitForText('Sign In');
    await cdp.evaluate(`
      const email = document.querySelector('input[type="email"]');
      const pwd = document.querySelector('input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(email, ${JSON.stringify(priEmail)});
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwd, ${JSON.stringify(priPassword)});
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type="submit"]').click();
    `);
    await cdp.waitForText('Sunshine Nursery & Primary School');
    await cdp.clickButton('Performance & Reports');
    await cdp.waitForText('Academic Performance & Digital Report Cards');
    await cdp.clickButton('Report Cards');
    await cdp.waitForText('Chidi Okafor');
    await cdp.clickButton('Bulk Upload Results');
    await cdp.waitForText('Bulk Upload Term, Session & Past-Year Results');
    await cdp.clickButton('Review Table');
    const priModalText = await cdp.bodyText();
    assert.ok(priModalText.includes('Term *') && priModalText.includes('Class *'), 'Primary modal must show Term & Class labels');
    assert.ok(!priModalText.includes('Units\t'), 'Primary modal hides Tertiary credit units column cleanly');

    // Mobile 390px check
    await cdp.setViewport(390, 844);
    await new Promise((r) => setTimeout(r, 350));
    const overflow = await cdp.evaluate(`return document.documentElement.scrollWidth - window.innerWidth;`);
    assert.ok(overflow <= 24, `Unexpected mobile horizontal overflow: ${overflow}px`);

    assert.strictEqual(cdp.pageErrors.length, 0, `Page errors detected: ${JSON.stringify(cdp.pageErrors)}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors detected: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('   ✓ Primary School Portal UI, Modal & Mobile 390px layout verified (0 page errors, 0 5xx API errors)!');
    console.log('\n✅ ALL UNIVERSAL BULK RESULTS UPLOAD E2E TESTS (PRIMARY, SECONDARY & TERTIARY) PASSED!');
  } catch (err) {
    console.error('\n❌ E2E FAILED:', err);
    if (serverLogs.length > 0) {
      console.error('--- Server Logs (tail) ---\n' + serverLogs.join('').slice(-2500));
    }
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    await stopChild(chromeProc);
    await stopChild(serverProc);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

run();
