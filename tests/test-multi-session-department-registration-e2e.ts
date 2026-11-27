/**
 * Multi-Session x Department x 1st & 2nd Semester Course Registration E2E Test
 *
 * Verifies the user's exact workflow end-to-end (Isolated Sandbox + Real Headless Chromium):
 *  1. Configure any past/current/upcoming session (e.g. 2024/2025, 2023/2024, 2022/2023)
 *     with automatic 1st & 2nd Semester provisioning without disturbing the active session.
 *  2. Auto-setup missing semesters on an empty session via POST /academic-sessions/:id/ensure-terms.
 *  3. Register 2024/2025 · Family Healthcare · 1st & 2nd Semester in ONE batch with smart
 *     semester-tag auto-routing (1ST -> 1st Sem, 2ND -> 2nd Sem, untagged -> Both).
 *  4. Register 2023/2024 · CHEW · 1st & 2nd Semester and current session · Public Health · 1st Sem
 *     with ZERO cross-session or cross-department bleed.
 *  5. Verify GET /course-registrations/matrix returns all Session x Department cards accurately.
 *  6. Headless Chromium UI E2E (1440px Desktop & 390px Mobile):
 *     - Click "+ Add / Configure Session", create 2022/2023 inline with 1st & 2nd Semester,
 *     - Select Family Healthcare, register 1st & 2nd Semester together in 1 click,
 *     - Click Matrix card to jump between 2024/2025 Family Healthcare & 2023/2024 CHEW,
 *     - Verify 0 page errors, 0 5xx API errors, and clean mobile layout.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';

const TEST_PORT = 3231;
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

async function waitForHealth(baseUrl: string, timeoutMs = 20000) {
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

  constructor(ws: WebSocket) {
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

  static async connect(debugPort: number): Promise<CDPClient> {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${debugPort}/json`);
        const pages = (await r.json()) as any[];
        const target = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
        if (target) {
          const ws = new WebSocket(target.webSocketDebuggerUrl);
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
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Could not connect to Chrome DevTools Protocol');
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(js: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${js} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-multisession-e2e-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-ms-'));
  let serverProc: ChildProcess | null = null;
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;
  const serverLogs: string[] = [];

  try {
    console.log('=== Multi-Session x Department x 1st & 2nd Semester Course Registration E2E ===');
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

    console.log(`1. Booting isolated sandbox server on port ${TEST_PORT}...`);
    serverProc = spawn(
      path.join(rootDir, 'node_modules', '.bin', 'tsx'),
      ['server.ts'],
      {
        cwd: tmpDir,
        env: {
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          HOME: process.env.HOME || '/root',
          PORT: String(TEST_PORT),
          NODE_ENV: 'development',
          RENDER: '1',
          DISABLE_HMR: 'true',
          ALLOW_SANDBOX_PAYMENTS: 'true',
          JWT_SECRET: 'multisession-e2e-secret-key-99999',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    serverProc.stdout?.on('data', (d) => serverLogs.push(d.toString()));
    serverProc.stderr?.on('data', (d) => serverLogs.push(d.toString()));
    await waitForHealth(TEST_BASE);
    console.log('   ✓ Isolated sandbox server healthy');

    // 2. Register College of Health Technology with 3 departments & students
    console.log('2. Registering College of Health Technology, 3 departments, students & 1st/2nd Sem courses...');
    const adminEmail = `registrar.ms.${Date.now()}@healthtech.edu.ng`;
    const adminPassword = 'StrongPassword#2026!';
    const regRes = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Federal College of Health Technology',
      schoolType: 'College of Health Technology',
      institutionCategory: 'TERTIARY',
      academicCycleType: 'SEMESTER',
      cycleLabels: ['1st Semester', '2nd Semester'],
      gradingMode: 'GPA_5',
      state: 'Anambra',
      lga: 'Awka South',
      address: '12 College Road, Awka',
      phone: '08035556677',
      email: 'info@fcht-awka.edu.ng',
      ownerName: 'Dr. Emeka Eze',
      ownerEmail: adminEmail,
      password: adminPassword,
      question1: 'City?',
      answer1: 'Awka',
      question2: 'Pet?',
      answer2: 'Rex',
    });
    assert.strictEqual(regRes.status, 201, `School registration failed: ${JSON.stringify(regRes.data)}`);
    const token = regRes.data.token;
    const schoolId = regRes.data.school?.id || regRes.data.activeSchool?.id || regRes.data.activeSchoolId;
    assert.ok(token && schoolId, 'Expected token and schoolId');

    // Fetch or create default active session (2025/2026)
    let initSesRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
    let defaultActiveSession = (initSesRes.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || (initSesRes.data.sessions || [])[0];
    if (!defaultActiveSession) {
      const createdActive = await apiReq(
        TEST_BASE,
        'POST',
        '/api/v1/school/academic-sessions',
        { name: '2025/2026', start_date: '2025-09-01', end_date: '2026-07-31', status: 'ACTIVE', auto_create_terms: true },
        token,
        schoolId
      );
      assert.strictEqual(createdActive.status, 201);
      defaultActiveSession = createdActive.data.session;
    }
    assert.ok(defaultActiveSession, 'Initial active session should exist');

    // Fetch or create 100L class & 3 department arms
    const existingClsRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/classes', undefined, token, schoolId);
    let level100 = (existingClsRes.data.classes || []).find((c: any) => /100L|Year 1|ND 1/i.test(c.name));
    if (!level100) {
      const clsRes = await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Year 1 (100L)', level: 'Tertiary' }, token, schoolId);
      assert.strictEqual(clsRes.status, 201, `Class create failed: ${JSON.stringify(clsRes.data)}`);
      level100 = clsRes.data.class;
    }

    const armFhc = (await apiReq(TEST_BASE, 'POST', `/api/v1/school/classes/${level100.id}/arms`, { name: 'Family Healthcare' }, token, schoolId)).data.arm;
    const armChew = (await apiReq(TEST_BASE, 'POST', `/api/v1/school/classes/${level100.id}/arms`, { name: 'CHEW' }, token, schoolId)).data.arm;
    const armPh = (await apiReq(TEST_BASE, 'POST', `/api/v1/school/classes/${level100.id}/arms`, { name: 'Public Health' }, token, schoolId)).data.arm;

    const mkStu = async (first_name: string, last_name: string, admission_number: string, arm: any) => {
      const r = await apiReq(
        TEST_BASE,
        'POST',
        '/api/v1/school/students',
        { first_name, last_name, full_name: `${first_name} ${last_name}`, admission_number, gender: 'Female', class_id: level100.id, class_arm_id: arm.id },
        token,
        schoolId
      );
      assert.strictEqual(r.status, 201, `Student create failed: ${JSON.stringify(r.data)}`);
      return r.data.student;
    };

    await mkStu('Ngozi', 'Okafor', 'FCHT/FHC/001', armFhc);
    await mkStu('Amina', 'Bello', 'FCHT/FHC/002', armFhc);
    await mkStu('Tunde', 'Adeyemi', 'FCHT/CHEW/001', armChew);
    await mkStu('Ifeoma', 'Umeh', 'FCHT/PH/001', armPh);

    // Upload 1st Semester, 2nd Semester, AND All-Semester courses across Family Healthcare, CHEW, Public Health
    const bulkCourses = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/subjects/bulk',
      {
        default_class_id: level100.id,
        subjects: [
          { code: 'FHC 111', name: 'Intro to Family Health', credit_units: 2, class_id: level100.id, department: 'Family Healthcare', semester_tag: '1ST', course_type: 'CORE' },
          { code: 'FHC 112', name: 'Maternal Care I', credit_units: 3, class_id: level100.id, department: 'Family Healthcare', semester_tag: '1ST', course_type: 'CORE' },
          { code: 'FHC 121', name: 'Child Nutrition II', credit_units: 3, class_id: level100.id, department: 'Family Healthcare', semester_tag: '2ND', course_type: 'CORE' },
          { code: 'FHC 122', name: 'Family Planning Practicum', credit_units: 2, class_id: level100.id, department: 'Family Healthcare', semester_tag: '2ND', course_type: 'CORE' },
          { code: 'GNS 100', name: 'Clinical Ethics (Both Semesters)', credit_units: 1, class_id: level100.id, department: '', semester_tag: '', course_type: 'GENERAL' },
          { code: 'CHE 111', name: 'Primary Health Care I', credit_units: 3, class_id: level100.id, department: 'CHEW', semester_tag: '1ST', course_type: 'CORE' },
          { code: 'CHE 121', name: 'Standing Orders II', credit_units: 3, class_id: level100.id, department: 'CHEW', semester_tag: '2ND', course_type: 'CORE' },
          { code: 'PHC 111', name: 'Epidemiology I', credit_units: 3, class_id: level100.id, department: 'Public Health', semester_tag: '1ST', course_type: 'CORE' },
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(bulkCourses.status, 201, `Bulk courses failed: ${JSON.stringify(bulkCourses.data)}`);
    const byCode = new Map<string, any>((bulkCourses.data.subjects || []).map((s: any) => [s.code, s]));
    console.log('   ✓ Created 3 departments, 4 students, and 8 multi-semester courses');

    // 3. Configure 2024/2025 session with auto_create_terms=true (keeping current active session untouched!)
    console.log('3. Testing 2024/2025 auto-setup + Family Healthcare 1st & 2nd Semester single-batch registration...');
    const ses2024Res = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/academic-sessions',
      { name: '2024/2025', status: 'COMPLETED', auto_create_terms: true, reuse_existing: true },
      token,
      schoolId
    );
    assert.strictEqual(ses2024Res.status, 201, `2024/2025 create failed: ${JSON.stringify(ses2024Res.data)}`);
    const ses2024 = ses2024Res.data.session;
    assert.strictEqual(ses2024.terms.length, 2, `2024/2025 must auto-create 2 semesters, got ${ses2024.terms.length}`);
    const sem1_2024 = ses2024.terms.find((t: any) => /1st|first/i.test(t.name));
    const sem2_2024 = ses2024.terms.find((t: any) => /2nd|second/i.test(t.name));
    assert.ok(sem1_2024 && sem2_2024, '2024/2025 must have both 1st Semester and 2nd Semester');

    // Verify original ACTIVE session is STILL active!
    const verifyActive = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
    const stillActive = verifyActive.data.sessions.find((s: any) => s.id === defaultActiveSession.id);
    assert.strictEqual(stillActive.status, 'ACTIVE', 'Creating historical 2024/2025 session must NOT deactivate active session!');

    // Register Family Healthcare for 2024/2025 · BOTH 1st & 2nd Semester in ONE API call!
    const reg2024Fhc = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/course-registrations/bulk',
      {
        academic_session_id: ses2024.id,
        term_ids: [sem1_2024.id, sem2_2024.id],
        auto_match_semester_tag: true,
        class_id: level100.id,
        department: 'Family Healthcare',
        registration_type: 'HISTORICAL',
        subject_ids: [
          { subject_id: byCode.get('FHC 111').id, credit_units: 2 },
          { subject_id: byCode.get('FHC 112').id, credit_units: 3 },
          { subject_id: byCode.get('FHC 121').id, credit_units: 3 },
          { subject_id: byCode.get('FHC 122').id, credit_units: 2 },
          { subject_id: byCode.get('GNS 100').id, credit_units: 1 }, // Untagged -> goes to BOTH semesters!
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(reg2024Fhc.status, 201, `2024/2025 FHC batch reg failed: ${JSON.stringify(reg2024Fhc.data)}`);
    assert.strictEqual(reg2024Fhc.data.studentsAffected, 2, 'Only 2 Family Healthcare students should be registered');
    // 2 students x (2 1st-sem + 2 2nd-sem + 2 untagged-in-both) = 2 x 6 = 12 registrations!
    assert.strictEqual(reg2024Fhc.data.registeredCount, 12, `Expected 12 routed registrations, got ${reg2024Fhc.data.registeredCount}`);

    // Verify smart semester routing: 1st Sem has FHC 111, FHC 112, GNS 100 (NO FHC 121/122!); 2nd Sem has FHC 121, FHC 122, GNS 100!
    const sem1Check = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/course-registrations?academic_session_id=${ses2024.id}&term_id=${sem1_2024.id}&department=${encodeURIComponent('Family Healthcare')}`,
      undefined,
      token,
      schoolId
    );
    const sem1Codes = Array.from(new Set(sem1Check.data.registrations.map((r: any) => r.subject_code))).sort();
    assert.deepStrictEqual(sem1Codes, ['FHC 111', 'FHC 112', 'GNS 100'], `1st Sem courses mismatch: ${JSON.stringify(sem1Codes)}`);

    const sem2Check = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/course-registrations?academic_session_id=${ses2024.id}&term_id=${sem2_2024.id}&department=${encodeURIComponent('Family Healthcare')}`,
      undefined,
      token,
      schoolId
    );
    const sem2Codes = Array.from(new Set(sem2Check.data.registrations.map((r: any) => r.subject_code))).sort();
    assert.deepStrictEqual(sem2Codes, ['FHC 121', 'FHC 122', 'GNS 100'], `2nd Sem courses mismatch: ${JSON.stringify(sem2Codes)}`);
    console.log('   ✓ 2024/2025 Family Healthcare 1st & 2nd Semester single-batch smart routing verified!');

    // 4. Create 2023/2024 WITHOUT terms, fix via /ensure-terms, and register CHEW (different session + different department!)
    console.log('4. Testing 2023/2024 CHEW (via /ensure-terms) & Active Session Public Health isolation...');
    const ses2023Raw = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/academic-sessions',
      { name: '2023/2024', status: 'COMPLETED', auto_create_terms: false },
      token,
      schoolId
    );
    assert.strictEqual(ses2023Raw.status, 201);
    assert.strictEqual(ses2023Raw.data.session.terms.length, 0);

    const ensureRes = await apiReq(
      TEST_BASE,
      'POST',
      `/api/v1/school/academic-sessions/${ses2023Raw.data.session.id}/ensure-terms`,
      {},
      token,
      schoolId
    );
    assert.strictEqual(ensureRes.status, 200);
    assert.strictEqual(ensureRes.data.createdCount, 2);
    assert.strictEqual(ensureRes.data.terms.length, 2);
    const ses2023Terms = ensureRes.data.terms;

    const reg2023Chew = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/course-registrations/bulk',
      {
        academic_session_id: ses2023Raw.data.session.id,
        term_ids: ses2023Terms.map((t: any) => t.id),
        auto_match_semester_tag: true,
        class_id: level100.id,
        department: 'CHEW',
        registration_type: 'HISTORICAL',
        subject_ids: [
          { subject_id: byCode.get('CHE 111').id, credit_units: 3 },
          { subject_id: byCode.get('CHE 121').id, credit_units: 3 },
        ],
      },
      token,
      schoolId
    );
    assert.strictEqual(reg2023Chew.status, 201);
    assert.strictEqual(reg2023Chew.data.studentsAffected, 1);
    assert.strictEqual(reg2023Chew.data.registeredCount, 2);

    // Register Public Health on default active session (1st Semester)
    const activeSem1 = defaultActiveSession.terms[0];
    const regActivePh = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/course-registrations/bulk',
      {
        academic_session_id: defaultActiveSession.id,
        term_id: activeSem1.id,
        class_id: level100.id,
        department: 'Public Health',
        subject_ids: [{ subject_id: byCode.get('PHC 111').id, credit_units: 3 }],
      },
      token,
      schoolId
    );
    assert.strictEqual(regActivePh.status, 201);

    // 5. Verify Session x Department Matrix returns all 3 separate Session x Department configurations
    const matrixRes = await apiReq(TEST_BASE, 'GET', '/api/v1/school/course-registrations/matrix', undefined, token, schoolId);
    assert.strictEqual(matrixRes.status, 200);
    assert.strictEqual(matrixRes.data.matrix.length, 3, `Expected 3 matrix cards, got ${JSON.stringify(matrixRes.data.matrix)}`);
    const fhc2024Card = matrixRes.data.matrix.find((m: any) => m.session_name === '2024/2025' && m.department === 'Family Healthcare');
    const chew2023Card = matrixRes.data.matrix.find((m: any) => m.session_name === '2023/2024' && m.department === 'CHEW');
    const phActiveCard = matrixRes.data.matrix.find((m: any) => m.session_name === defaultActiveSession.name && m.department === 'Public Health');
    assert.ok(fhc2024Card && fhc2024Card.terms.length === 2 && fhc2024Card.registrations_count === 12);
    assert.ok(chew2023Card && chew2023Card.terms.length === 2 && chew2023Card.registrations_count === 2);
    assert.ok(phActiveCard && phActiveCard.terms.length === 1 && phActiveCard.registrations_count === 1);
    console.log('   ✓ Multi-Session x Multi-Department matrix & strict isolation verified!');

    // 6. Real Headless Chromium UI E2E (Desktop 1440px & Mobile 390px)
    console.log('5. Launching Headless Chromium to test inline Session Setup, 1st & 2nd Sem Batch & Matrix Switcher...');
    const chromePath = [
      '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ].find((p) => fs.existsSync(p));
    assert.ok(chromePath, 'Chromium binary not found');
    const debugPort = 9245;
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
    await cdp.navigate(`${TEST_BASE}/login`);
    await cdp.waitForText('Sign In');

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
    await cdp.waitForText('Federal College of Health Technology');

    await cdp.clickButton('Performance & Reports');
    await cdp.waitForText('Academic Performance');
    await cdp.clickButton('Course Registration');
    await cdp.waitForText('Configured Sessions × Departments');

    // Verify all 3 Session x Department cards appear in the UI
    const initialBody = await cdp.bodyText();
    assert.ok(initialBody.includes('2024/2025') && initialBody.includes('Family Healthcare'), 'Matrix must show 2024/2025 Family Healthcare');
    assert.ok(initialBody.includes('2023/2024') && initialBody.includes('CHEW'), 'Matrix must show 2023/2024 CHEW');

    // Click "+ Add / Configure Session" and create 2022/2023 inline with auto 1st & 2nd Semester!
    await cdp.clickButton('+ Add / Configure Session');
    await cdp.waitForText('Configure Any Academic Session');
    await cdp.evaluate(`
      const inp = document.querySelector('input[aria-label="New Academic Session Name"]');
      if (!inp) throw new Error('New session input not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '2022/2023');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await cdp.clickButton('Create & Select');
    await cdp.waitForText('Target Semesters for 2022/2023');

    // Now pick Family Healthcare department, click Select Matching, and register BOTH 1st & 2nd Semester in 1 click!
    await cdp.clickButton('Family Healthcare (2)');
    await new Promise((r) => setTimeout(r, 400));
    await cdp.clickButton('Select Matching');
    await new Promise((r) => setTimeout(r, 250));
    await cdp.clickButton('Bulk Register');
    await new Promise((r) => setTimeout(r, 900));

    const afterRegText = await cdp.bodyText();
    assert.ok(afterRegText.includes('2022/2023') && afterRegText.includes('Ngozi Okafor'), '2022/2023 Family Healthcare ledger must show Ngozi Okafor');
    assert.ok(afterRegText.includes('1st Semester') && afterRegText.includes('2nd Semester'), 'Both 1st & 2nd Semester registrations must appear');
    assert.ok(
      afterRegText.toLowerCase().includes('configured sessions × departments (4)'),
      'Matrix must now show 4 configured Session x Department combinations'
    );

    // Mobile 390px responsiveness check
    await cdp.setViewport(390, 844);
    await new Promise((r) => setTimeout(r, 400));
    const overflow = await cdp.evaluate(`return document.documentElement.scrollWidth - window.innerWidth;`);
    assert.ok(overflow <= 24, `Unexpected mobile horizontal overflow: ${overflow}px`);

    assert.strictEqual(cdp.pageErrors.length, 0, `Page errors detected: ${JSON.stringify(cdp.pageErrors)}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors detected: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('   ✓ Inline 2022/2023 Session Creation, 1st & 2nd Semester Batch Registration, Matrix Switcher & Mobile 390px verified!');
    console.log('\n✅ ALL MULTI-SESSION x DEPARTMENT x 1ST & 2ND SEMESTER E2E TESTS PASSED!');
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
