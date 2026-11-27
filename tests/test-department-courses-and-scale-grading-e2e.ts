import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { parseScoreSheetPaste } from '../src/utils/scoreSheetPasteParser.ts';

const TEST_PORT = 3230;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;

async function apiReq(
  baseUrl: string,
  method: string,
  urlPath: string,
  body?: any,
  token?: string,
  schoolId?: string
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (schoolId) headers['x-school-id'] = schoolId;
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload).toString();
  }
  const u = new URL(urlPath, baseUrl);
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let data: any = raw;
          try { data = JSON.parse(raw); } catch {}
          resolve({ status: res.statusCode || 0, data });
        });
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await apiReq(baseUrl, 'GET', '/api/health');
      if (res.status === 200 && res.data?.status === 'healthy') return res.data;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${baseUrl} did not become healthy within ${timeoutMs}ms`);
}

class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  public pageErrors: string[] = [];
  public apiServerErrors: Array<{ url: string; status: number }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev: MessageEvent) => {
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
        if (resp?.url?.includes('/api/') && resp.status >= 500) {
          this.apiServerErrors.push({ url: resp.url, status: resp.status });
        }
      }
    });
  }

  static async connect(wsUrl: string): Promise<CDPClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true });
      ws.addEventListener('error', (err) => rej(err), { once: true });
    });
    const client = new CDPClient(ws);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    return client;
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval error');
    }
    return res?.result?.value;
  }

  async setViewport(width: number, height: number) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 480,
    });
  }

  async goto(url: string) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 900));
  }

  async bodyText(): Promise<string> {
    return (await this.evaluate(`return document.body?.innerText || '';`)) || '';
  }

  async waitForText(snippet: string, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const txt = await this.bodyText();
      if (txt.includes(snippet)) return txt;
      await new Promise((r) => setTimeout(r, 200));
    }
    const last = await this.bodyText();
    throw new Error(`Timed out waiting for text "${snippet}".\nPAGE:\n${last.slice(0, 1400)}`);
  }

  async clickButton(text: string) {
    const ok = await this.evaluate(`
      const target = ${JSON.stringify(text)};
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => !b.disabled && b.offsetParent !== null);
      const found = btns.find((b) => (b.innerText || '').trim() === target)
        || btns.find((b) => (b.innerText || '').trim().includes(target));
      if (!found) return false;
      found.scrollIntoView({ block: 'center' });
      found.click();
      return true;
    `);
    if (!ok) throw new Error(`Button not found: "${text}"`);
    await new Promise((r) => setTimeout(r, 300));
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function stopChild(proc: ChildProcess | null) {
  if (!proc || proc.killed) return;
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  try { proc.kill('SIGKILL'); } catch {}
}

async function run() {
  console.log('=== Department Course Registration & Scale Grading E2E ===');

  // ---------------------------------------------------------------------------
  // 1. UNIT TESTS: Smart Excel/CSV Score Sheet Paste Parser
  // ---------------------------------------------------------------------------
  console.log('1. Verifying parseScoreSheetPaste unit tests...');
  const sampleRoster = [
    { id: 'stu-1', admission_number: 'CHT/FHC/001', full_name: 'Adaeze Nwosu', class_arm_name: 'Family Healthcare' },
    { id: 'stu-2', admission_number: 'CHT/FHC/002', full_name: 'Musa Ibrahim', class_arm_name: 'Family Healthcare' },
    { id: 'stu-3', admission_number: 'CHT/FHC/201', full_name: 'Tunde Bakare', class_arm_name: 'Family Healthcare' },
  ];

  const excelPaste = [
    'S/N\tAdmission No\tStudent Name\tCA\tExam\tRemark',
    '1\tCHT/FHC/001\tAdaeze Nwosu\t32\t55\tExcellent',
    '2\tCHT/FHC/002\tMusa Ibrahim\t26\t44\tGood',
    '3\tCHT/FHC/999\tUnknown Student\t20\t40\t',
    '4\tTunde Bakare\t\t45\t50\tOver CA max',
  ].join('\n');

  const parsed = parseScoreSheetPaste(excelPaste, sampleRoster, 40, 60);
  assert.strictEqual(parsed.skippedHeader, true, 'Should auto-skip header row');
  assert.strictEqual(parsed.strippedSerial, true, 'Should strip leading S/N column');
  assert.strictEqual(parsed.matchedCount, 2, 'Should count 2 valid matched rows');
  assert.strictEqual(parsed.unmatchedCount, 1, 'Should detect 1 unmatched student');
  assert.strictEqual(parsed.errorCount, 1, 'Should flag 1 CA > 40 range error');
  assert.strictEqual(parsed.rows[0].matchedStudentId, 'stu-1');
  assert.strictEqual(parsed.rows[0].ca_score, '32');
  assert.strictEqual(parsed.rows[0].exam_score, '55');
  assert.strictEqual(parsed.rows[0].subject_remark, 'Excellent');
  console.log('   ✓ Score paste parser passed (headers, S/N, Matric/Name matching, range validation)');

  // ---------------------------------------------------------------------------
  // 2. START ISOLATED SANDBOX SERVER (Never touches live Neon PostgreSQL!)
  // ---------------------------------------------------------------------------
  const repoRoot = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-dept-scale-e2e-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-dept-'));
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  for (const entry of [
    'server.ts',
    'server',
    'src',
    'migrations',
    'dist',
    'package.json',
    'node_modules',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'public',
    'schema.sql',
    'schema.pg.sql',
  ]) {
    const srcPath = path.join(repoRoot, entry);
    if (fs.existsSync(srcPath)) {
      fs.symlinkSync(srcPath, path.join(tmpDir, entry));
    }
  }

  let serverProc: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;
  const serverLogs: string[] = [];

  try {
    console.log(`2. Starting isolated sandbox server on port ${TEST_PORT}...`);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/root',
      PORT: String(TEST_PORT),
      RENDER: '1',
      NODE_ENV: 'development',
      DISABLE_HMR: 'true',
      ALLOW_SANDBOX_PAYMENTS: 'true',
      JWT_SECRET: 'dept-scale-e2e-secret-key-99999',
    };

    serverProc = spawn('npx', ['tsx', 'server.ts'], { cwd: tmpDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    serverProc.stdout?.on('data', (d) => serverLogs.push(d.toString()));
    serverProc.stderr?.on('data', (d) => serverLogs.push(d.toString()));

    const health = await waitForHealth(TEST_BASE);
    assert.strictEqual(health.status, 'healthy');
    console.log('   ✓ Isolated sandbox server healthy');

    // -------------------------------------------------------------------------
    // 3. REGISTER COLLEGE OF HEALTH TECHNOLOGY + 3 DEPARTMENTS + STUDENTS
    // -------------------------------------------------------------------------
    console.log('3. Registering College of Health Technology with 3 departments & multi-level students...');
    const adminEmail = `registrar.cht.${Date.now()}@example.com`;
    const adminPassword = 'StrongPassword123!';
    const reg = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'National College of Health Technology',
      schoolType: 'College of Health Technology',
      institutionCategory: 'TERTIARY',
      academicCycleType: 'SEMESTER',
      cycleLabels: ['1st Semester', '2nd Semester'],
      gradingMode: 'GPA_5',
      state: 'Enugu',
      lga: 'Enugu North',
      address: '10 Health Sciences Way, Enugu',
      phone: '08031112233',
      email: 'info@ncht.edu.ng',
      ownerName: 'Dr. Grace Okonkwo',
      ownerEmail: adminEmail,
      password: adminPassword,
      question1: 'City?',
      answer1: 'Enugu',
      question2: 'Pet?',
      answer2: 'Max',
    });
    assert.strictEqual(reg.status, 201, `Registration failed: ${JSON.stringify(reg.data)}`);
    const token = reg.data.token;
    const schoolId = reg.data.school?.id || reg.data.activeSchool?.id || reg.data.activeSchoolId;
    assert.ok(token && schoolId);

    // Fetch or create active session & 1st/2nd Semester
    let sessRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
    assert.strictEqual(sessRes.status, 200);
    let activeSession = (sessRes.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || (sessRes.data.sessions || [])[0];
    if (!activeSession) {
      await apiReq(
        TEST_BASE,
        'POST',
        '/api/v1/school/academic-sessions',
        { name: '2025/2026', start_date: '2025-09-01', end_date: '2026-07-31', status: 'ACTIVE' },
        token,
        schoolId
      );
      sessRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
      activeSession = sessRes.data.sessions[0];
    }
    if (!activeSession.terms || activeSession.terms.length < 1) {
      await apiReq(
        TEST_BASE,
        'POST',
        `/api/v1/school/academic-sessions/${activeSession.id}/terms`,
        { name: '1st Semester', start_date: '2025-09-01', end_date: '2026-02-15', status: 'ACTIVE' },
        token,
        schoolId
      );
      await apiReq(
        TEST_BASE,
        'POST',
        `/api/v1/school/academic-sessions/${activeSession.id}/terms`,
        { name: '2nd Semester', start_date: '2026-02-20', end_date: '2026-07-25', status: 'UPCOMING' },
        token,
        schoolId
      );
      sessRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
      activeSession = sessRes.data.sessions[0];
    }
    const sem1 = activeSession.terms.find((t: any) => /1st|first/i.test(t.name)) || activeSession.terms[0];
    assert.ok(sem1, '1st Semester must exist');

    const clsRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/classes', undefined, token, schoolId);
    let level100 = (clsRes.data.classes || []).find((c: any) => /100L|Year 1|ND 1/i.test(c.name));
    let level200 = (clsRes.data.classes || []).find((c: any) => /200L|Year 2|ND 2/i.test(c.name));
    if (!level100) {
      const c1 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Year 1 (100L)', level: 'Tertiary' }, token, schoolId);
      assert.strictEqual(c1.status, 201, `Class 1 create failed: ${JSON.stringify(c1.data)}`);
      level100 = c1.data.class;
    }
    if (!level200) {
      const c2 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Year 2 (200L)', level: 'Tertiary' }, token, schoolId);
      assert.strictEqual(c2.status, 201, `Class 2 create failed: ${JSON.stringify(c2.data)}`);
      level200 = c2.data.class;
    }

    // Create 3 departments (arms) under Year 1 (100L) and Family Healthcare under Year 2 (200L)
    const mkArm = async (classId: string, name: string) => {
      const r = await apiReq(TEST_BASE, 'POST', `/api/v1/school/classes/${classId}/arms`, { name }, token, schoolId);
      assert.strictEqual(r.status, 201, `Arm creation failed: ${JSON.stringify(r.data)}`);
      return r.data.arm;
    };
    const armFhc100 = await mkArm(level100.id, 'Family Healthcare');
    const armChew100 = await mkArm(level100.id, 'Community Health Extension Workers (CHEW)');
    const armPh100 = await mkArm(level100.id, 'Public Health');
    const armFhc200 = await mkArm(level200.id, 'Family Healthcare');

    const mkStudent = async (first_name: string, last_name: string, admission_number: string, class_id: string, class_arm_id: string) => {
      const r = await apiReq(
        TEST_BASE,
        'POST',
        '/api/v1/school/students',
        { first_name, last_name, full_name: `${first_name} ${last_name}`, admission_number, class_id, class_arm_id, gender: 'Female' },
        token,
        schoolId
      );
      assert.strictEqual(r.status, 201, `Student create failed: ${JSON.stringify(r.data)}`);
      return r.data.student;
    };

    const stuFhc1 = await mkStudent('Adaeze', 'Nwosu', 'CHT/FHC/001', level100.id, armFhc100.id);
    const stuFhc2 = await mkStudent('Musa', 'Ibrahim', 'CHT/FHC/002', level100.id, armFhc100.id);
    const stuChew1 = await mkStudent('Chinedu', 'Okafor', 'CHT/CHEW/001', level100.id, armChew100.id);
    const stuChew2 = await mkStudent('Amina', 'Bello', 'CHT/CHEW/002', level100.id, armChew100.id);
    const stuPh1 = await mkStudent('Bola', 'Adeyemi', 'CHT/PH/001', level100.id, armPh100.id);
    const stuCarryover200 = await mkStudent('Tunde', 'Bakare', 'CHT/FHC/201', level200.id, armFhc200.id);
    console.log('   ✓ Created 6 students across 3 departments + 1 Year 2 carryover student');

    // -------------------------------------------------------------------------
    // 4. SAME COURSE TITLE ACROSS DIFFERENT DEPARTMENTS IN SAME LEVEL & SEMESTER
    // -------------------------------------------------------------------------
    console.log('4. Testing multi-department bulk course upload (same title across FHC, CHEW, Public Health)...');
    const bulkFhc = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/subjects/bulk',
      {
        default_class_id: level100.id,
        default_semester_tag: '1ST',
        default_department: 'Family Healthcare',
        subjects: [
          { code: 'FHC 111', name: 'Introduction to Family Healthcare', credit_units: 2, course_type: 'CORE' },
          { code: 'FHC 112', name: 'Anatomy and Physiology I', credit_units: 3, course_type: 'CORE' },
          { code: 'GNS 101', name: 'Use of English I', credit_units: 2, course_type: 'GENERAL', department: '' },
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(bulkFhc.status, 201, `FHC bulk failed: ${JSON.stringify(bulkFhc.data)}`);
    assert.strictEqual(bulkFhc.data.createdCount, 3);

    // Upload SAME course title "Anatomy and Physiology I" for CHEW (2u) & Public Health (3u) in same 100L 1st Sem!
    const bulkChew = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/subjects/bulk',
      {
        default_class_id: level100.id,
        default_semester_tag: '1ST',
        default_department: 'Community Health Extension Workers (CHEW)',
        subjects: [
          { code: 'CHE 112', name: 'Anatomy and Physiology I', credit_units: 2, course_type: 'CORE' },
          { code: 'CHE 111', name: 'Introduction to Primary Health Care', credit_units: 3, course_type: 'CORE' },
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(bulkChew.status, 201, `CHEW bulk failed (must allow same title in diff dept): ${JSON.stringify(bulkChew.data)}`);
    assert.strictEqual(bulkChew.data.createdCount, 2);

    const bulkPh = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/subjects/bulk',
      {
        default_class_id: level100.id,
        default_semester_tag: '1ST',
        default_department: 'Public Health',
        subjects: [
          { code: 'PHC 112', name: 'Anatomy and Physiology I', credit_units: 3, course_type: 'CORE' },
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(bulkPh.status, 201, `PH bulk failed: ${JSON.stringify(bulkPh.data)}`);
    assert.strictEqual(bulkPh.data.createdCount, 1);

    // Also create 2 legacy untagged courses to verify 1-click PATCH /subjects/bulk-assign
    const bulkLegacy = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/subjects/bulk',
      {
        default_class_id: level100.id,
        default_semester_tag: '1ST',
        subjects: [
          { code: 'FHC 115', name: 'Maternal and Child Health', credit_units: 2, course_type: 'CORE' },
          { code: 'FHC 116', name: 'Family Planning Foundations', credit_units: 2, course_type: 'CORE' },
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(bulkLegacy.status, 201);

    const subListRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/subjects', undefined, token, schoolId);
    const allSubs = subListRes.data.subjects as any[];
    const fhc111 = allSubs.find((s) => s.code === 'FHC 111');
    const fhc112 = allSubs.find((s) => s.code === 'FHC 112');
    const fhc115 = allSubs.find((s) => s.code === 'FHC 115');
    const fhc116 = allSubs.find((s) => s.code === 'FHC 116');
    const gns101 = allSubs.find((s) => s.code === 'GNS 101');
    const che112 = allSubs.find((s) => s.code === 'CHE 112');
    const che111 = allSubs.find((s) => s.code === 'CHE 111');
    const phc112 = allSubs.find((s) => s.code === 'PHC 112');
    assert.ok(fhc112 && che112 && phc112, 'All 3 departments must hold their own Anatomy & Physiology I course');
    assert.strictEqual(fhc112.department, 'Family Healthcare');
    assert.strictEqual(che112.department, 'Community Health Extension Workers (CHEW)');
    assert.strictEqual(phc112.department, 'Public Health');
    assert.strictEqual(fhc112.credit_units, 3);
    assert.strictEqual(che112.credit_units, 2);

    // Test 1-click Bulk Assign Department on legacy FHC 115 & FHC 116
    const bulkAssignRes = await apiReq(
      TEST_BASE,
      'PATCH',
      '/api/v1/school/subjects/bulk-assign',
      { subject_ids: [fhc115.id, fhc116.id], department: 'Family Healthcare' },
      token,
      schoolId
    );
    assert.strictEqual(bulkAssignRes.status, 200, `bulk-assign failed: ${JSON.stringify(bulkAssignRes.data)}`);
    assert.strictEqual(bulkAssignRes.data.updatedCount, 2);

    // Verify GET /departments canonical discovery
    const deptSummaryRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/departments', undefined, token, schoolId);
    assert.strictEqual(deptSummaryRes.status, 200);
    const fhcSummary = deptSummaryRes.data.departments.find((d: any) => d.name === 'Family Healthcare');
    assert.ok(fhcSummary, 'Family Healthcare must appear in /departments');
    assert.strictEqual(fhcSummary.student_count, 3, 'FHC has 2 Year 1 + 1 Year 2 students');
    assert.strictEqual(fhcSummary.course_count, 4, 'FHC has 4 courses after bulk-assign');
    console.log('   ✓ Department-scoped catalog uniqueness, bulk-assign, and /departments summary verified');

    // -------------------------------------------------------------------------
    // 5. DEPARTMENT-SCOPED BULK COURSE REGISTRATION + CARRYOVER REGISTRATION
    // -------------------------------------------------------------------------
    console.log('5. Verifying isolated department-scoped bulk course registration + carryover...');
    const regFhc = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/course-registrations/bulk',
      {
        academic_session_id: activeSession.id,
        term_id: sem1.id,
        class_id: level100.id,
        department: 'Family Healthcare',
        subject_ids: [
          { subject_id: fhc111.id, credit_units: 2 },
          { subject_id: fhc112.id, credit_units: 3 },
          { subject_id: gns101.id, credit_units: 2 },
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(regFhc.status, 201, `FHC reg failed: ${JSON.stringify(regFhc.data)}`);
    assert.strictEqual(regFhc.data.studentsAffected, 2, 'Must ONLY register the 2 Family Healthcare 100L students!');

    const regChew = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/course-registrations/bulk',
      {
        academic_session_id: activeSession.id,
        term_id: sem1.id,
        class_id: level100.id,
        department: 'Community Health Extension Workers (CHEW)',
        subject_ids: [
          { subject_id: che111.id, credit_units: 3 },
          { subject_id: che112.id, credit_units: 2 },
          { subject_id: gns101.id, credit_units: 2 },
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(regChew.status, 201);
    assert.strictEqual(regChew.data.studentsAffected, 2, 'Must ONLY register the 2 CHEW 100L students!');

    const regPh = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/course-registrations/bulk',
      {
        academic_session_id: activeSession.id,
        term_id: sem1.id,
        class_id: level100.id,
        department: 'Public Health',
        subject_ids: [
          { subject_id: phc112.id, credit_units: 3 },
          { subject_id: gns101.id, credit_units: 2 },
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(regPh.status, 201);
    assert.strictEqual(regPh.data.studentsAffected, 1, 'Must ONLY register the 1 Public Health 100L student!');

    // Register 200L student for 100L FHC 112 as a CARRYOVER course
    const regCarry = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/course-registrations/bulk',
      {
        academic_session_id: activeSession.id,
        term_id: sem1.id,
        class_id: level200.id,
        student_ids: [stuCarryover200.id],
        registration_type: 'CARRYOVER',
        subject_ids: [{ subject_id: fhc112.id, credit_units: 3, registration_type: 'CARRYOVER' }],
      },
      token,
      schoolId
    );
    assert.strictEqual(regCarry.status, 201);

    // Verify department filter on GET /course-registrations returns zero cross-dept bleed
    const fhcLedger = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/course-registrations?academic_session_id=${activeSession.id}&term_id=${sem1.id}&class_id=${level100.id}&department=${encodeURIComponent('Family Healthcare')}`,
      undefined,
      token,
      schoolId
    );
    assert.strictEqual(fhcLedger.status, 200);
    assert.strictEqual(fhcLedger.data.studentSummaries.length, 2);
    assert.ok(fhcLedger.data.studentSummaries.every((s: any) => s.department === 'Family Healthcare'));
    console.log('   ✓ Department-isolated bulk course registrations & carryover verified (zero cross-dept bleed)');

    // -------------------------------------------------------------------------
    // 6. ONE-CLICK EXAM FROM REGISTRATIONS + REGISTERED-ONLY ROSTER (INCL. CARRYOVERS)
    // -------------------------------------------------------------------------
    console.log('6. Testing Exam-from-Registrations & Registered-Students-Only grading roster...');
    const examFromReg = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/examinations/from-registrations',
      {
        academic_session_id: activeSession.id,
        term_id: sem1.id,
        class_id: level100.id,
      },
      token,
      schoolId
    );
    assert.strictEqual(examFromReg.status, 201, `from-registrations failed: ${JSON.stringify(examFromReg.data)}`);
    const exam = examFromReg.data.examination;
    assert.ok(exam.id);
    assert.ok(examFromReg.data.registered_subjects.length >= 6, 'Should return all 6 registered courses in queue');

    // Calling it a second time should reuse the existing DRAFT exam (idempotent!)
    const examReuse = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/examinations/from-registrations',
      {
        academic_session_id: activeSession.id,
        term_id: sem1.id,
        class_id: level100.id,
      },
      token,
      schoolId
    );
    assert.strictEqual(examReuse.status, 200);
    assert.strictEqual(examReuse.data.examination.id, exam.id);
    assert.strictEqual(examReuse.data.created, false);

    // Fetch Score Sheet for FHC 112 with registered_only=true -> MUST have 2 FHC 100L + 1 Carryover 200L = 3 students (NO CHEW/PH!)
    const fhc112Sheet = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/examinations/${exam.id}/scores?subject_id=${fhc112.id}&registered_only=true`,
      undefined,
      token,
      schoolId
    );
    assert.strictEqual(fhc112Sheet.status, 200);
    const fhcRosterIds = fhc112Sheet.data.roster.map((r: any) => r.id);
    assert.strictEqual(fhcRosterIds.length, 3, `Expected 3 registered students for FHC 112 (2 FHC + 1 Carryover), got ${fhcRosterIds.length}`);
    assert.ok(fhcRosterIds.includes(stuFhc1.id));
    assert.ok(fhcRosterIds.includes(stuFhc2.id));
    assert.ok(fhcRosterIds.includes(stuCarryover200.id), '200L carryover student MUST appear on FHC 112 score sheet!');
    assert.ok(!fhcRosterIds.includes(stuChew1.id), 'CHEW student MUST NOT appear on FHC 112 score sheet!');
    assert.ok(!fhcRosterIds.includes(stuPh1.id), 'Public Health student MUST NOT appear on FHC 112 score sheet!');
    const carryRow = fhc112Sheet.data.roster.find((r: any) => r.id === stuCarryover200.id);
    assert.strictEqual(carryRow.registration_type, 'CARRYOVER');

    // Fetch Score Sheet for GNS 101 (General) with registered_only=true -> MUST have all 5 Year 1 students across all 3 depts!
    const gnsSheet = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/examinations/${exam.id}/scores?subject_id=${gns101.id}&registered_only=true`,
      undefined,
      token,
      schoolId
    );
    assert.strictEqual(gnsSheet.status, 200);
    assert.strictEqual(gnsSheet.data.roster.length, 5, 'Shared GNS 101 must include all 5 registered students across all 3 departments');
    console.log('   ✓ Registered-students-only roster, carryover inclusion, and shared general course roster verified');

    // -------------------------------------------------------------------------
    // 7. BATCH SCORE ENTRY + DEPARTMENT-FILTERED BROADSHEET + ZERO-DILUTION REPORT CARD
    // -------------------------------------------------------------------------
    console.log('7. Recording scores across departments, testing department broadsheet & zero-dilution report cards...');
    const saveBatch = async (entries: any[]) => {
      const r = await apiReq(
        TEST_BASE,
        'PUT',
        `/api/v1/school/examinations/${exam.id}/scores`,
        { entries },
        token,
        schoolId
      );
      assert.strictEqual(r.status, 200, `Save scores failed: ${JSON.stringify(r.data)}`);
    };

    // Grade FHC 112 (including 200L Carryover!), CHE 111, CHE 112, PHC 112, GNS 101 (leave FHC 111 for Chromium Paste UI test!)
    await saveBatch([
      { student_id: stuFhc1.id, subject_id: fhc112.id, ca_score: 30, exam_score: 50 }, // 80 (A)
      { student_id: stuFhc2.id, subject_id: fhc112.id, ca_score: 25, exam_score: 45 }, // 70 (A)
      { student_id: stuCarryover200.id, subject_id: fhc112.id, ca_score: 22, exam_score: 40 }, // 62 (B)
      { student_id: stuChew1.id, subject_id: che111.id, ca_score: 28, exam_score: 48 }, // 76
      { student_id: stuChew2.id, subject_id: che111.id, ca_score: 20, exam_score: 40 }, // 60
      { student_id: stuChew1.id, subject_id: che112.id, ca_score: 30, exam_score: 45 }, // 75
      { student_id: stuChew2.id, subject_id: che112.id, ca_score: 25, exam_score: 35 }, // 60
      { student_id: stuPh1.id, subject_id: phc112.id, ca_score: 28, exam_score: 56 }, // 84
      { student_id: stuFhc1.id, subject_id: gns101.id, ca_score: 30, exam_score: 50 }, // 80
      { student_id: stuFhc2.id, subject_id: gns101.id, ca_score: 24, exam_score: 46 }, // 70
      { student_id: stuChew1.id, subject_id: gns101.id, ca_score: 26, exam_score: 44 }, // 70
      { student_id: stuChew2.id, subject_id: gns101.id, ca_score: 20, exam_score: 40 }, // 60
      { student_id: stuPh1.id, subject_id: gns101.id, ca_score: 30, exam_score: 50 }, // 80
    ]);

    // Check Broadsheet filtered to Community Health Extension Workers (CHEW)
    const chewBroadsheet = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/examinations/${exam.id}/broadsheet?department=${encodeURIComponent('Community Health Extension Workers (CHEW)')}`,
      undefined,
      token,
      schoolId
    );
    assert.strictEqual(chewBroadsheet.status, 200);
    assert.strictEqual(chewBroadsheet.data.rows.length, 2, 'CHEW broadsheet must show ONLY 2 CHEW students');
    assert.ok(chewBroadsheet.data.rows.every((r: any) => r.department === 'Community Health Extension Workers (CHEW)'));
    const chewSubCodes = chewBroadsheet.data.subjects.map((s: any) => s.code);
    assert.ok(chewSubCodes.includes('CHE 111') && chewSubCodes.includes('CHE 112') && chewSubCodes.includes('GNS 101'));
    assert.ok(!chewSubCodes.includes('FHC 112') && !chewSubCodes.includes('PHC 112'), 'CHEW broadsheet must NOT show FHC/PHC columns');
    assert.ok(chewBroadsheet.data.available_departments.length >= 3);

    // Set missing_score_policy = 'ZERO' and verify report card has ZERO cross-department average dilution!
    await apiReq(
      TEST_BASE,
      'PUT',
      '/api/v1/school/academic-settings',
      { missing_score_policy: 'ZERO' },
      token,
      schoolId
    );
    const genRc = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/report-cards/generate',
      { academic_session_id: activeSession.id, term_id: sem1.id, class_id: level100.id },
      token,
      schoolId
    );
    assert.strictEqual(genRc.status, 200, `Generate report cards failed: ${JSON.stringify(genRc.data)}`);
    const rcList = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/report-cards?academic_session_id=${activeSession.id}&term_id=${sem1.id}&class_id=${level100.id}`,
      undefined,
      token,
      schoolId
    );
    const phRc = rcList.data.reportCards.find((r: any) => r.student_id === stuPh1.id);
    assert.ok(phRc, 'Public Health student report card must exist');
    // stuPh1 registered ONLY 2 courses (PHC 112 = 84, GNS 101 = 80) -> avg MUST be 82.0%, NOT diluted by FHC/CHE courses!
    assert.strictEqual(Number(phRc.average_score), 82, `Expected 82.0% with ZERO dilution across departments, got ${phRc.average_score}`);
    console.log('   ✓ Department-filtered Broadsheet & ZERO cross-department average dilution verified');

    // -------------------------------------------------------------------------
    // 8. HEADLESS CHROMIUM UI E2E (DESKTOP 1440px & MOBILE 390px)
    // -------------------------------------------------------------------------
    console.log('8. Launching Headless Chromium for real UI verification (Desktop 1440px & Mobile 390px)...');
    const chromePath = [
      '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ].find((p) => fs.existsSync(p));
    assert.ok(chromePath, 'Chromium binary not found');
    const debugPort = 9244;
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

    let wsUrl = '';
    for (let i = 0; i < 40; i++) {
      try {
        const listRes = await apiReq(`http://127.0.0.1:${debugPort}`, 'GET', '/json/list');
        if (Array.isArray(listRes.data) && listRes.data[0]?.webSocketDebuggerUrl) {
          wsUrl = (listRes.data.find((t: any) => t.type === 'page') || listRes.data[0]).webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(wsUrl, 'Failed to obtain Chromium CDP WebSocket URL');

    cdp = await CDPClient.connect(wsUrl);
    await cdp.setViewport(1440, 900);
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.waitForText('Admin Sign In');

    // Sign in through the real login form
    await cdp.evaluate(`
      const email = document.querySelector('input[type="email"]');
      const pwd = document.querySelector('input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(email, ${JSON.stringify(adminEmail)});
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwd, ${JSON.stringify(adminPassword)});
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type="submit"]').click();
    `);
    await cdp.waitForText('National College of Health Technology');

    // Navigate to Performance & Reports
    await cdp.clickButton('Performance & Reports');
    await cdp.waitForText('Academic Performance');

    // 8a. Courses Catalog: verify Department filter dropdown
    await cdp.clickButton('Courses');
    await cdp.waitForText('Curriculum Courses');
    const catalogText = await cdp.bodyText();
    assert.ok(catalogText.includes('Family Healthcare'), 'Courses tab must display Family Healthcare department badge');
    assert.ok(catalogText.includes('Community Health Extension Workers (CHEW)'), 'Courses tab must display CHEW department badge');

    await cdp.evaluate(`
      const sel = document.querySelector('select[aria-label="Filter by Department"]');
      if (!sel) throw new Error('Department filter select not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'Family Healthcare');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await new Promise((r) => setTimeout(r, 300));
    const filteredCatalogText = await cdp.bodyText();
    assert.ok(filteredCatalogText.includes('FHC 112'), 'FHC 112 must appear under Family Healthcare filter');
    assert.ok(!filteredCatalogText.includes('CHE 112'), 'CHE 112 must be hidden under Family Healthcare filter');
    console.log('   ✓ Courses Catalog Department filter verified in Chromium');

    // 8b. Course Registration: switch department & click "Grade Registered Courses"
    await cdp.clickButton('Course Registration');
    await cdp.waitForText('Department & Semester Bulk Course Registration');
    await cdp.clickButton('Family Healthcare');
    await new Promise((r) => setTimeout(r, 500));
    const regPanelText = await cdp.bodyText();
    assert.ok(regPanelText.includes('Adaeze Nwosu'), 'Family Healthcare student must be visible in ledger');
    assert.ok(!regPanelText.includes('Chinedu Okafor'), 'CHEW student must NOT appear under Family Healthcare filter');

    // Click "Grade Registered Courses" -> must navigate straight to Examinations & Scores with Grading Queue!
    await cdp.clickButton('Grade Registered Courses');
    await cdp.waitForText('Registered Courses Grading Queue');
    await new Promise((r) => setTimeout(r, 600));

    // Click FHC 111 in the grading queue (ungraded 0/2)
    await cdp.clickButton('FHC 111');
    await new Promise((r) => setTimeout(r, 500));
    const sheetText = await cdp.bodyText();
    assert.ok(sheetText.includes('Adaeze Nwosu') && sheetText.includes('Musa Ibrahim'), 'FHC 111 roster must show the 2 FHC students');
    assert.ok(!sheetText.includes('Chinedu Okafor'), 'FHC 111 roster must exclude CHEW students');

    // Open "Paste Excel Scores" drawer, paste tab-separated scores for FHC 111, and click "Apply & Save Immediately"
    await cdp.clickButton('Paste Excel Scores');
    await cdp.waitForText('Paste Scores Directly from Excel');
    const fhc111Paste = 'S/N\tAdmission No\tName\tCA\tExam\tRemark\n1\tCHT/FHC/001\tAdaeze Nwosu\t28\t58\tDistinction\n2\tCHT/FHC/002\tMusa Ibrahim\t24\t50\tVery Good';
    await cdp.evaluate(`
      const ta = document.querySelector('textarea');
      if (!ta) throw new Error('Paste textarea not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(fhc111Paste)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await new Promise((r) => setTimeout(r, 300));
    const previewTxt = await cdp.bodyText();
    assert.ok(previewTxt.includes('2 matched & valid'), `Expected "2 matched & valid" in paste preview:\n${previewTxt.slice(0, 800)}`);
    await cdp.clickButton('Apply & Save Immediately');
    await new Promise((r) => setTimeout(r, 900));

    // Verify FHC 111 scores persisted (86 & 74)
    const afterPasteText = await cdp.bodyText();
    assert.ok(afterPasteText.includes('86') && afterPasteText.includes('74'), 'Pasted totals (86 & 74) must appear after saving');
    console.log('   ✓ One-click Grade Registered Courses + Grading Queue + Excel Paste & Save verified in Chromium');

    // 8c. Open Master Broadsheet modal & verify Department filter dropdown
    await cdp.clickButton('Broadsheet');
    await cdp.waitForText('Master Examination Broadsheet');
    const bsText = await cdp.bodyText();
    assert.ok(bsText.includes('All Departments'), 'Broadsheet modal must include Department filter dropdown');
    await cdp.evaluate(`
      const closeBtn = document.querySelector('button[aria-label="Close broadsheet modal"]');
      if (!closeBtn) throw new Error('Close broadsheet button not found');
      closeBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 300));

    // 8d. Mobile 390px Responsive Layout Audit
    await cdp.setViewport(390, 844);
    await new Promise((r) => setTimeout(r, 400));
    const overflow = await cdp.evaluate(`return document.documentElement.scrollWidth - window.innerWidth;`);
    assert.ok(overflow <= 24, `Unexpected mobile horizontal overflow: ${overflow}px`);

    assert.strictEqual(cdp.pageErrors.length, 0, `Page errors detected: ${JSON.stringify(cdp.pageErrors)}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors detected: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('   ✓ Broadsheet Department filter, Mobile 390px layout, 0 page errors, and 0 5xx API errors verified!');
    console.log('\n✅ ALL DEPARTMENT COURSE REGISTRATION & SCALE GRADING E2E TESTS PASSED!');
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
