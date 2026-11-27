import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { parseCurriculumPaste } from '../src/components/performance/BulkCoursesModal.tsx';
import { normalizeSemesterTag, termMatchesSemesterTag } from '../src/utils/semesterTag.ts';

const TEST_PORT = 3228;
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
    throw new Error(`Timed out waiting for text "${snippet}".\nPAGE:\n${last.slice(0, 1200)}`);
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
    await new Promise((r) => setTimeout(r, 250));
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
  console.log('=== Semester-Split Course Registration, Smart Paste & Bulk Fix E2E ===');

  // ---------------------------------------------------------------------------
  // 1. Unit Tests: Smart Excel/Word/CSV Paste Parser & Semester Tag Matching
  // ---------------------------------------------------------------------------
  console.log('[1/6] Running unit checks for S/N paste parser & semester tags...');
  const sampleRealPaste = [
    'S/N\tCOURSE CODE\tCOURSE TITLE\tCREDIT UNIT',
    '1\tFHC 111\tIntroduction to Community Health\t2',
    '2\tFHC 112\tHuman Anatomy and Physiology I\t3',
    '3\tFHC 113\tPrimary Health Care Management\t2',
    '4\tGST 111\tCommunication in English I\t2',
    'Total\t\t\t9',
  ].join('\n');

  const parsed1 = parseCurriculumPaste(sampleRealPaste, 'cls_100l', '1ST');
  assert.strictEqual(parsed1.rows.length, 4, `Expected 4 courses (header & Total skipped), got ${parsed1.rows.length}`);
  assert.strictEqual(parsed1.rows[0].code, 'FHC 111');
  assert.strictEqual(parsed1.rows[0].name, 'Introduction to Community Health');
  assert.strictEqual(parsed1.rows[0].credit_units, '2');
  assert.strictEqual(parsed1.rows[0].semester_tag, '1ST');
  assert.strictEqual(parsed1.rows[1].code, 'FHC 112');
  assert.strictEqual(parsed1.rows[1].credit_units, '3');

  // No-header S/N paste + quoted commas + pipes
  const noHeaderSnPaste = [
    '1, FHC 121, "Epidemiology, Disease Control & Prevention", 3, CORE',
    '2 | FHC 122 | Environmental Health Practical | 1 | ELECTIVE',
  ].join('\n');
  const parsed2 = parseCurriculumPaste(noHeaderSnPaste, 'cls_100l', '2ND');
  assert.strictEqual(parsed2.rows.length, 2);
  assert.strictEqual(parsed2.rows[0].code, 'FHC 121');
  assert.strictEqual(parsed2.rows[0].name, 'Epidemiology, Disease Control & Prevention');
  assert.strictEqual(parsed2.rows[0].credit_units, '3');
  assert.strictEqual(parsed2.rows[0].semester_tag, '2ND');
  assert.strictEqual(parsed2.rows[1].code, 'FHC 122');
  assert.strictEqual(parsed2.rows[1].credit_units, '1');
  assert.strictEqual(parsed2.rows[1].course_type, 'ELECTIVE');

  assert.strictEqual(normalizeSemesterTag('1st Semester'), '1ST');
  assert.strictEqual(normalizeSemesterTag('Harmattan Semester'), '1ST');
  assert.strictEqual(normalizeSemesterTag('2nd Semester'), '2ND');
  assert.strictEqual(normalizeSemesterTag('Rain Semester'), '2ND');
  assert.strictEqual(normalizeSemesterTag('All Semesters'), '');
  assert.strictEqual(termMatchesSemesterTag('1st Semester', '1ST'), true);
  assert.strictEqual(termMatchesSemesterTag('1st Semester', '2ND'), false);
  assert.strictEqual(termMatchesSemesterTag('2nd Semester', '2ND'), true);
  assert.strictEqual(termMatchesSemesterTag('2nd Semester', ''), true);
  console.log('  Smart paste parser & semester tag unit tests passed.');

  // ---------------------------------------------------------------------------
  // 2. Boot Isolated SQLite Sandbox Server (NEVER touches live Neon PG!)
  // ---------------------------------------------------------------------------
  const rootDir = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-sem-split-'));
  const chromeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-sem-'));
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
  let serverProc: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;
  let serverLogs = '';

  try {
    console.log('[2/6] Booting isolated sandbox server on port 3228...');
    const tsxBin = path.join(rootDir, 'node_modules', '.bin', 'tsx');
    serverProc = spawn(tsxBin, ['server.ts'], {
      cwd: tmpDir,
      env: {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME || '/root',
        PORT: String(TEST_PORT),
        RENDER: '1',
        NODE_ENV: 'development',
        JWT_SECRET: 'test-sem-split-secret-2026-isolated-sandbox-key',
        ALLOW_SANDBOX_PAYMENTS: 'true',
        DISABLE_HMR: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout?.on('data', (d) => { serverLogs += d.toString(); });
    serverProc.stderr?.on('data', (d) => { serverLogs += d.toString(); });

    try {
      await waitForHealth(TEST_BASE, 25000);
    } catch (bootErr) {
      console.error('Sandbox server logs:\n', serverLogs);
      throw bootErr;
    }

    // Register a University / College of Health Technology (2 Semesters, 5.00 GPA)
    const reg = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Prime Health Sciences University',
      schoolType: 'University',
      institutionCategory: 'TERTIARY',
      academicCycleType: 'SEMESTER',
      cycleLabels: ['1st Semester', '2nd Semester'],
      gradingMode: 'GPA_5',
      state: 'Lagos',
      lga: 'Ikeja',
      address: '10 Medical Campus Road',
      phone: '08031234567',
      email: 'registrar@primehealth.edu.ng',
      ownerName: 'Prof. Chinedu Okeke',
      ownerEmail: 'admin@primehealth.edu.ng',
      password: 'Password123!',
      question1: 'City?',
      answer1: 'Lagos',
      question2: 'Pet?',
      answer2: 'Rex',
    });
    assert.strictEqual(reg.status, 201, `Reg failed: ${JSON.stringify(reg.data)}`);
    const token = reg.data.token;
    const schoolId = reg.data.school?.id || reg.data.activeSchool?.id || reg.data.activeSchoolId;
    assert.ok(token && schoolId, `Missing auth metadata: ${JSON.stringify(reg.data)}`);

    // Fetch or create active session & both semesters (1st Semester & 2nd Semester)
    let sesRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
    assert.strictEqual(sesRes.status, 200, `Sessions fetch failed: ${JSON.stringify(sesRes.data)}`);
    let activeSession = (sesRes.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || (sesRes.data.sessions || [])[0];
    if (!activeSession) {
      const sCreate = await apiReq(TEST_BASE, 'POST', '/api/v1/school/academic-sessions', {
        name: '2025/2026',
        start_date: '2025-09-01',
        end_date: '2026-07-31',
        status: 'ACTIVE',
      }, token, schoolId);
      assert.strictEqual(sCreate.status, 201, `Create session failed: ${JSON.stringify(sCreate.data)}`);
      sesRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
      activeSession = (sesRes.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || (sesRes.data.sessions || [])[0];
    }
    let terms: any[] = activeSession.terms || [];
    if (terms.length < 1) {
      await apiReq(TEST_BASE, 'POST', `/api/v1/school/academic-sessions/${activeSession.id}/terms`, {
        name: '1st Semester',
        start_date: '2025-09-01',
        end_date: '2026-02-15',
        status: 'ACTIVE',
      }, token, schoolId);
    }
    if (terms.length < 2) {
      await apiReq(TEST_BASE, 'POST', `/api/v1/school/academic-sessions/${activeSession.id}/terms`, {
        name: '2nd Semester',
        start_date: '2026-02-20',
        end_date: '2026-07-31',
        status: 'UPCOMING',
      }, token, schoolId);
      sesRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
      activeSession = (sesRes.data.sessions || []).find((s: any) => s.id === activeSession.id) || sesRes.data.sessions[0];
      terms = activeSession.terms || [];
    }
    assert.ok(terms.length >= 2, `Expected 2 semesters for University, got: ${JSON.stringify(activeSession)}`);
    const sem1 = terms[0];
    const sem2 = terms[1];

    const clsList = await apiReq(TEST_BASE, 'GET', '/api/v1/school/classes', undefined, token, schoolId);
    const existingClasses: any[] = clsList.data.classes || [];
    let cls100 = existingClasses.find((c) => /100/i.test(c.name));
    if (!cls100) {
      const c100 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Year 1 (100L)', level: 'Undergraduate' }, token, schoolId);
      assert.strictEqual(c100.status, 201, `Create 100L failed: ${JSON.stringify(c100.data)}`);
      cls100 = c100.data.class || c100.data;
    }
    let cls200 = existingClasses.find((c) => /200/i.test(c.name));
    if (!cls200) {
      const c200 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Year 2 (200L)', level: 'Undergraduate' }, token, schoolId);
      assert.strictEqual(c200.status, 201, `Create 200L failed: ${JSON.stringify(c200.data)}`);
      cls200 = c200.data.class || c200.data;
    }
    const cls100Id = cls100.id;
    const cls200Id = cls200.id;

    const stuRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/students', {
      first_name: 'Amaka',
      last_name: 'Nwosu',
      gender: 'Female',
      class_id: cls100Id,
      class_name: cls100.name,
      admission_number: 'PHU/2026/001',
    }, token, schoolId);
    assert.strictEqual(stuRes.status, 201, `Student create failed: ${JSON.stringify(stuRes.data)}`);
    const stuId = stuRes.data.student?.id || stuRes.data.id;

    // -------------------------------------------------------------------------
    // 3. Test Bulk Course Registration Edge Cases (Same Name Across Levels/Semesters,
    //    Soft-Delete Reactivation, Long Titles > 128 chars)
    // -------------------------------------------------------------------------
    console.log('[3/6] Testing bulk course resilience (soft-delete reactivation, cross-level dupes, >128 char titles)...');
    const longTitle = 'Advanced Clinical Foundations in Community Medicine, Maternal Epidemiology, Immunization Strategy, Biostatistics and Primary Health Care Systems Management';
    assert.ok(longTitle.length > 135);

    // Create & soft-delete a subject first to guarantee reactivation works without UNIQUE crash
    const tempSub = await apiReq(TEST_BASE, 'POST', '/api/v1/school/subjects', {
      name: 'Clinical Seminar',
      code: 'FHC 100',
      class_id: cls100Id,
      semester_tag: '1ST',
      credit_units: 2,
    }, token, schoolId);
    assert.strictEqual(tempSub.status, 201);
    await apiReq(TEST_BASE, 'DELETE', `/api/v1/school/subjects/${tempSub.data.subject.id}`, undefined, token, schoolId);

    // Bulk upload 100L 1st Semester courses (including reactivated 'Clinical Seminar' & longTitle)
    const bulkSem1 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/subjects/bulk', {
      default_semester_tag: '1ST',
      courses: [
        { code: 'FHC 111', name: 'Introduction to Community Health', credit_units: 2, class_id: cls100Id, semester_tag: '1ST', course_type: 'CORE' },
        { code: 'FHC 112', name: longTitle, credit_units: 3, class_id: cls100Id, semester_tag: '1ST', course_type: 'CORE' },
        { code: 'FHC 100', name: 'Clinical Seminar', credit_units: 1, class_id: cls100Id, semester_tag: '1ST', course_type: 'ELECTIVE' },
      ],
    }, token, schoolId);
    assert.strictEqual(bulkSem1.status, 201, `Bulk Sem 1 failed: ${JSON.stringify(bulkSem1.data)}`);
    assert.strictEqual(bulkSem1.data.errors.length, 0);
    assert.strictEqual(bulkSem1.data.subjects.length, 3);

    // Bulk upload 100L 2nd Semester courses (INCLUDING same title 'Clinical Seminar' in 2nd Semester AND in 200L!)
    const bulkSem2 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/subjects/bulk', {
      default_semester_tag: '2ND',
      courses: [
        { code: 'FHC 121', name: 'Environmental Health & Sanitation', credit_units: 3, class_id: cls100Id, semester_tag: '2ND', course_type: 'CORE' },
        { code: 'FHC 122', name: 'Clinical Seminar', credit_units: 2, class_id: cls100Id, semester_tag: '2ND', course_type: 'CORE' },
        { code: 'FHC 211', name: 'Clinical Seminar', credit_units: 3, class_id: cls200Id, semester_tag: '1ST', course_type: 'CORE' },
      ],
    }, token, schoolId);
    assert.strictEqual(bulkSem2.status, 201, `Bulk Sem 2 failed: ${JSON.stringify(bulkSem2.data)}`);
    assert.strictEqual(bulkSem2.data.errors.length, 0);
    assert.strictEqual(bulkSem2.data.createdCount, 3, 'Same-named courses in different semester/level must be created cleanly');

    const sem1Subs = bulkSem1.data.subjects;
    const sem2Subs = bulkSem2.data.subjects.filter((s: any) => s.class_id === cls100Id);

    // -------------------------------------------------------------------------
    // 4. Separate 1st Semester & 2nd Semester Course Registrations -> Full Session Aggregation
    // -------------------------------------------------------------------------
    console.log('[4/6] Verifying separate 1st/2nd Semester registration & end-of-session aggregation...');
    const regSem1 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/course-registrations/bulk', {
      academic_session_id: activeSession.id,
      term_id: sem1.id,
      class_id: cls100Id,
      subject_ids: sem1Subs.map((s: any) => ({ subject_id: s.id, credit_units: s.credit_units })),
    }, token, schoolId);
    assert.strictEqual(regSem1.status, 201);

    const regSem2 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/course-registrations/bulk', {
      academic_session_id: activeSession.id,
      term_id: sem2.id,
      class_id: cls100Id,
      subject_ids: sem2Subs.map((s: any) => ({ subject_id: s.id, credit_units: s.credit_units })),
    }, token, schoolId);
    assert.strictEqual(regSem2.status, 201);

    // Fetch Full Session Combined (no term_id)
    const fullSesRegs = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/course-registrations?academic_session_id=${activeSession.id}&class_id=${cls100Id}`,
      undefined,
      token,
      schoolId
    );
    assert.strictEqual(fullSesRegs.status, 200);
    const amakaSum = fullSesRegs.data.studentSummaries[0];
    assert.strictEqual(amakaSum.courses_count, 5, 'Expected 3 (Sem 1) + 2 (Sem 2) = 5 courses');
    assert.strictEqual(amakaSum.total_credit_units, 11, 'Expected 6u (Sem 1) + 5u (Sem 2) = 11 total session units');
    assert.strictEqual(amakaSum.term_breakdown.length, 2);
    assert.strictEqual(amakaSum.exceeds_max_units, false);

    // Record & publish exams for 1st Semester and 2nd Semester, then compile Full-Session Cumulative Result!
    // Enable missing_score_policy='ZERO' too so we verify 200L course doesn't dilute 100L average!
    await apiReq(TEST_BASE, 'PUT', '/api/v1/school/academic-settings', { missing_score_policy: 'ZERO' }, token, schoolId);

    const ex1 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/examinations', {
      title: '100L First Semester Exam',
      academic_session_id: activeSession.id,
      term_id: sem1.id,
      class_id: cls100Id,
      ca_max_score: 30,
      exam_max_score: 70,
    }, token, schoolId);
    assert.strictEqual(ex1.status, 201, `Create ex1 failed: ${JSON.stringify(ex1.data)}`);
    const sc1 = await apiReq(TEST_BASE, 'PUT', `/api/v1/school/examinations/${ex1.data.examination.id}/scores`, {
      entries: [
        { student_id: stuId, subject_id: sem1Subs[0].id, ca_score: 25, exam_score: 55 }, // 80 -> A (5.0) * 2u = 10
        { student_id: stuId, subject_id: sem1Subs[1].id, ca_score: 20, exam_score: 45 }, // 65 -> B (4.0) * 3u = 12
        { student_id: stuId, subject_id: sem1Subs[2].id, ca_score: 24, exam_score: 50 }, // 74 -> A (5.0) * 1u = 5
      ],
    }, token, schoolId);
    assert.strictEqual(sc1.status, 200, `Save sem1 scores failed: ${JSON.stringify(sc1.data)}`);
    // Sem 1 GPA = (10 + 12 + 5) / 6 = 27 / 6 = 4.50
    const pub1 = await apiReq(TEST_BASE, 'POST', `/api/v1/school/examinations/${ex1.data.examination.id}/status`, { status: 'PUBLISHED' }, token, schoolId);
    assert.strictEqual(pub1.status, 200, `Publish ex1 failed: ${JSON.stringify(pub1.data)}`);

    const ex2 = await apiReq(TEST_BASE, 'POST', '/api/v1/school/examinations', {
      title: '100L Second Semester Exam',
      academic_session_id: activeSession.id,
      term_id: sem2.id,
      class_id: cls100Id,
      ca_max_score: 30,
      exam_max_score: 70,
    }, token, schoolId);
    assert.strictEqual(ex2.status, 201, `Create ex2 failed: ${JSON.stringify(ex2.data)}`);
    const sc2 = await apiReq(TEST_BASE, 'PUT', `/api/v1/school/examinations/${ex2.data.examination.id}/scores`, {
      entries: [
        { student_id: stuId, subject_id: sem2Subs[0].id, ca_score: 26, exam_score: 54 }, // 80 -> A (5.0) * 3u = 15
        { student_id: stuId, subject_id: sem2Subs[1].id, ca_score: 22, exam_score: 42 }, // 64 -> B (4.0) * 2u = 8
      ],
    }, token, schoolId);
    assert.strictEqual(sc2.status, 200, `Save sem2 scores failed: ${JSON.stringify(sc2.data)}`);
    // Sem 2 GPA = (15 + 8) / 5 = 23 / 5 = 4.60
    // Combined Session CGPA = (27 + 23) / (6 + 5) = 50 / 11 = 4.55!
    const pub2 = await apiReq(TEST_BASE, 'POST', `/api/v1/school/examinations/${ex2.data.examination.id}/status`, { status: 'PUBLISHED' }, token, schoolId);
    assert.strictEqual(pub2.status, 200, `Publish ex2 failed: ${JSON.stringify(pub2.data)}`);

    const genSrc = await apiReq(TEST_BASE, 'POST', '/api/v1/school/session-report-cards/generate', {
      academic_session_id: activeSession.id,
      class_id: cls100Id,
    }, token, schoolId);
    assert.strictEqual(genSrc.status, 200);
    const srcItem = genSrc.data.sessionReportCards[0];
    const srcDetail = await apiReq(TEST_BASE, 'GET', `/api/v1/school/session-report-cards/${srcItem.id}`, undefined, token, schoolId);
    const bd = srcDetail.data.sessionReportCard.breakdown;
    assert.strictEqual(bd.total_credit_units, 11, 'Expected combined 11 credit units across both semesters');
    assert.strictEqual(bd.cgpa, 4.55, `Expected exact combined Sessional CGPA 4.55, got ${bd.cgpa}`);
    assert.strictEqual(bd.term_averages[0].gpa, 4.5, 'Expected 1st Semester GPA = 4.50');
    assert.strictEqual(bd.term_averages[1].gpa, 4.6, 'Expected 2nd Semester GPA = 4.60');
    // Session average = (80+65+74+80+64)/5 = 72.6% (NOT diluted by the 200L course!)
    assert.strictEqual(bd.average_score, 72.6, `Expected 72.6% without 200L dilution, got ${bd.average_score}`);
    console.log('  1st Sem GPA (4.50) + 2nd Sem GPA (4.60) -> Combined Session CGPA (4.55, 11u) & 72.6% avg verified!');

    // -------------------------------------------------------------------------
    // 5. Real Headless Chromium Verification (Mobile 390px + Desktop 1440px)
    // -------------------------------------------------------------------------
    console.log('[5/6] Testing Bulk Paste (S/N table) & Semester Switcher UI in Headless Chromium...');
    const chromeDebugPort = 9298;
    const chromeBin = [
      '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ].find((p) => fs.existsSync(p));
    assert.ok(chromeBin, 'Chromium binary not found');
    chromeProc = spawn(chromeBin!, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${chromeDebugPort}`,
      `--user-data-dir=${chromeUserData}`,
      'about:blank',
    ]);

    const targets: any[] = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 12000) {
        try {
          const r = await fetch(`http://127.0.0.1:${chromeDebugPort}/json/list`);
          if (r.ok) {
            const list = await r.json();
            if (Array.isArray(list) && list[0]?.webSocketDebuggerUrl) return list;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error('Chrome DevTools failed to start');
    })();

    cdp = await CDPClient.connect((targets.find((t) => t.type === 'page') || targets[0]).webSocketDebuggerUrl);
    await cdp.setViewport(1440, 900);
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.waitForText('Admin Sign In');

    await cdp.evaluate(`
      const email = document.querySelector('input[type="email"]');
      const pwd = document.querySelector('input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(email, 'admin@primehealth.edu.ng');
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwd, 'Password123!');
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type="submit"]').click();
    `);
    await cdp.waitForText('Prime Health Sciences University');

    // Navigate to Performance & Reports -> Course Registration
    await cdp.clickButton('Performance & Reports');
    await cdp.waitForText('Course Registration');
    await cdp.clickButton('Course Registration');
    await cdp.waitForText('Full Session Combined');

    // Open Bulk Add Courses modal & test S/N Excel paste end-to-end
    await cdp.clickButton('Bulk Add Courses');
    await cdp.waitForText('Paste Excel / CSV');
    await cdp.clickButton('Paste Excel / CSV');

    await cdp.evaluate(`
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(
        'S/N\tCOURSE CODE\tCOURSE TITLE\tCREDIT UNIT\n1\tBIO 111\tGeneral Biology I\t3\n2\tCHM 111\tGeneral Chemistry I\t2'
      )});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await cdp.clickButton('Parse into Table for Review');
    await cdp.waitForText('automatically skipped header row & ignored S/N column');
    await cdp.waitForText('Save 2 Courses');
    await cdp.clickButton('Save 2 Courses');
    await cdp.waitForText('Processed 2 course(s)/subject(s)');

    // Switch to Full Session Combined tab inside Course Registration and verify both semesters show!
    await cdp.clickButton('Full Session Combined');
    await cdp.waitForText('11 Session Total Credit Units');
    await cdp.waitForText('Amaka Nwosu');

    // Verify clean mobile 390px rendering too (no crashes / 5xx)
    await cdp.setViewport(390, 844);
    await new Promise((r) => setTimeout(r, 300));
    const overflowX = await cdp.evaluate(`return document.documentElement.scrollWidth - window.innerWidth;`);
    assert.ok(overflowX <= 24, `Unexpected mobile horizontal overflow: ${overflowX}px`);

    assert.strictEqual(cdp.pageErrors.length, 0, `Uncaught page errors: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('[6/6] ALL SEMESTER-SPLIT, SMART PASTE & BULK COURSE FIX E2E CHECKS PASSED!');
  } finally {
    if (cdp) cdp.close();
    await stopChild(chromeProc);
    await stopChild(serverProc);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(chromeUserData, { recursive: true, force: true }); } catch {}
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
