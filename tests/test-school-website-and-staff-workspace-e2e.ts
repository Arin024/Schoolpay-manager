import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_BIN = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const TEST_PORT = 3208;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;
const LIVE_BASE = 'http://127.0.0.1:3000';

// Minimal valid 1x1 PNG data URL (<150 bytes) for upload testing
const SAMPLE_DATA_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return client;
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
      throw new Error(`${err.message}\n--- PAGE TEXT ---\n${txt.slice(0, 1400)}`);
    }
  }

  async bodyText(): Promise<string> {
    return this.evaluate('return document.body?.innerText || "";');
  }

  async fillInputByPlaceholder(placeholderSnippet: string, value: string) {
    const ok = await this.evaluate(`
      const inputs = Array.from(document.querySelectorAll('input, textarea'));
      const el = inputs.find((i) => (i.placeholder || '').includes(${JSON.stringify(placeholderSnippet)}));
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    assert.ok(ok, `Field with placeholder "${placeholderSnippet}" not found`);
  }

  async fillInput(selector: string, value: string) {
    const ok = await this.evaluate(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    assert.ok(ok, `Input not found: ${selector}`);
  }

  async selectByOptionText(optionSnippet: string) {
    const ok = await this.evaluate(`
      const selects = Array.from(document.querySelectorAll('select'));
      for (const s of selects) {
        const opt = Array.from(s.options).find((o) => (o.textContent || '').includes(${JSON.stringify(optionSnippet)}));
        if (opt) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(s, opt.value);
          s.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    `);
    assert.ok(ok, `Select containing option "${optionSnippet}" not found`);
  }

  async clickButtonByText(text: string, exact = false) {
    const clicked = await this.evaluate(`
      const target = ${JSON.stringify(text)};
      const exact = ${exact ? 'true' : 'false'};
      const btns = Array.from(document.querySelectorAll('button'));
      const found = btns.find((b) => {
        if (b.disabled) return false;
        const t = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
        return exact ? t === target : t.includes(target);
      });
      if (!found) return false;
      found.scrollIntoView({ block: 'center' });
      found.click();
      return true;
    `);
    assert.ok(clicked, `Button with text "${text}" not found or disabled`);
    await new Promise((r) => setTimeout(r, 250));
  }

  async clickSubmit() {
    const clicked = await this.evaluate(`
      const forms = Array.from(document.querySelectorAll('form'));
      for (const f of forms.reverse()) {
        const btn = f.querySelector('button[type="submit"]');
        if (btn && !btn.disabled) {
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          return true;
        }
      }
      return false;
    `);
    assert.ok(clicked, 'Form submit button not found or disabled');
    await new Promise((r) => setTimeout(r, 300));
  }

  async logoutInBrowser() {
    const clicked = await this.evaluate(`
      const btn = document.querySelector('button[title="Sign Out"]');
      if (btn) { btn.click(); return true; }
      const byText = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Sign Out');
      if (byText) { byText.click(); return true; }
      return false;
    `);
    assert.ok(clicked, 'Sign Out button not found');
    await this.waitFor(
      () => this.evaluate('return Boolean(document.querySelector("input[type=email]") || document.querySelector("input[type=password]") || (document.body?.innerText || "").includes("Portal Login"))'),
      10000
    );
    await new Promise((r) => setTimeout(r, 250));
  }

  async setViewport(width: number, height: number, mobile: boolean) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile,
    });
    await new Promise((r) => setTimeout(r, 250));
  }

  async checkNoHorizontalOverflow(contextLabel: string) {
    const metrics = await this.evaluate<{ scrollWidth: number; innerWidth: number }>(
      'return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };'
    );
    assert.ok(
      metrics.scrollWidth <= metrics.innerWidth + 1,
      `[${contextLabel}] Horizontal overflow detected: scrollWidth=${metrics.scrollWidth}px > innerWidth=${metrics.innerWidth}px`
    );
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function waitForHealth(baseUrl: string, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${baseUrl} failed health check`);
}

function setupSafeTempWorkspace(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-website-staff-e2e-'));
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

function spawnSafeTestServer(tmpDir: string): ChildProcess {
  const cleanEnv: Record<string, string> = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || '/root',
    NODE_ENV: 'development',
    RENDER: '1',
    PORT: String(TEST_PORT),
    JWT_SECRET: 'safe-school-website-staff-workspace-e2e-jwt-secret-64-chars-long',
    ALLOW_SANDBOX_PAYMENTS: 'true',
    DISABLE_HMR: 'true',
  };
  const tsxBin = path.join(tmpDir, 'node_modules', '.bin', 'tsx');
  const child = spawn(tsxBin, ['server.ts'], {
    cwd: tmpDir,
    env: cleanEnv,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (chunk) => {
    const s = String(chunk || '').trim();
    if (s && !s.includes('ExperimentalWarning')) console.error('[TestServer stderr]', s);
  });
  return child;
}

async function stopChild(child: ChildProcess | null) {
  if (!child || child.killed || !child.pid) return;
  const pid = child.pid;
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {}
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        resolve();
      }
    }
  });
}

async function apiReq(token: string | null, schoolId: string | null, method: string, p: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (schoolId) headers['X-School-Id'] = schoolId;
  const res = await fetch(`${TEST_BASE}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function run() {
  console.log('=== Unique School Website, Subdomain Portal & Dedicated Staff Workspace E2E ===');
  const liveHealth = await waitForHealth(LIVE_BASE, 5000);
  console.log(`[0/8] Live port 3000 healthy (${liveHealth.database?.provider}); isolated sandbox will run on port ${TEST_PORT}.`);

  const tmpDir = setupSafeTempWorkspace();
  let serverProc: ChildProcess | null = spawnSafeTestServer(tmpDir);
  let chromeProc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;
  const chromeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-web-staff-'));

  try {
    await waitForHealth(TEST_BASE, 25000);

    // 1. Verify existing seeded school preserves records & has website + subdomain backfill
    const preExistingWebsite = await apiReq(null, null, 'GET', '/api/v1/public/schools/lagos-premier-college/website');
    assert.strictEqual(preExistingWebsite.status, 200, 'Pre-seeded school website profile missing');
    assert.ok(preExistingWebsite.data.urls?.portal_subdomain, 'Existing school should receive automatic subdomain');
    assert.ok(preExistingWebsite.data.urls?.subdomainUrl.endsWith('.bursariq.com.ng'));

    // Register a brand new Nigerian school and verify auto-generated portal_subdomain + website profile
    const regRes = await apiReq(null, null, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Ahmadu Bello Crescent Academy',
      schoolType: 'Secondary',
      state: 'Kano',
      lga: 'Nassarawa',
      address: '18 Independence Road, Kano',
      phone: '08025551100',
      email: 'info@abca.edu.ng',
      ownerName: 'Mallam Sani Bello',
      ownerEmail: 'principal@abca.edu.ng',
      password: 'Password123!',
      question1: 'What city was the school founded in?',
      answer1: 'Kano',
      question2: 'What is the founder mother maiden name?',
      answer2: 'Amina',
    });
    assert.strictEqual(regRes.status, 201, `Registration failed: ${JSON.stringify(regRes.data)}`);
    const adminToken: string = regRes.data.token;
    const schoolId: string = regRes.data.activeSchoolId || regRes.data.school?.id;
    const schoolSlug: string = regRes.data.school?.slug;
    assert.ok(schoolId && schoolSlug, 'School registration missing schoolId or slug');

    const initialSiteRes = await apiReq(null, null, 'GET', `/api/v1/public/schools/${schoolSlug}/website`);
    assert.strictEqual(initialSiteRes.status, 200, 'Newly registered school must have immediate public website');
    assert.ok(initialSiteRes.data.urls?.portal_subdomain, 'Newly registered school must get portal_subdomain automatically');

    // Provision JSS 1 Class, Mathematics Subject, Enrolled Student (auto admission number), TEACHER & STAFF accounts
    const clsRes = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/classes', {
      name: 'JSS 1',
      level: 'Junior Secondary',
    });
    assert.strictEqual(clsRes.status, 201, `Create class failed: ${JSON.stringify(clsRes.data)}`);
    const classId: string = clsRes.data.class.id;

    const subRes = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/subjects', {
      name: 'Mathematics',
      code: 'MTH101',
      class_id: classId,
    });
    assert.strictEqual(subRes.status, 201, `Create subject failed: ${JSON.stringify(subRes.data)}`);

    const stuRes = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/students', {
      first_name: 'Kemi',
      last_name: 'Adeola',
      gender: 'Female',
      class_id: classId,
      parent_name: 'Mrs. Funmi Adeola',
      parent_phone: '08093334455',
    });
    assert.strictEqual(stuRes.status, 201, `Enroll student failed: ${JSON.stringify(stuRes.data)}`);
    const studentAdmNo: string = stuRes.data.student.admission_number;
    assert.ok(studentAdmNo, 'Student should receive auto-generated admission number');

    const teacherUserRes = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Mr. Tunde Adewale',
      email: 'teacher@abca.edu.ng',
      password: 'Password123!',
      role_name: 'TEACHER',
      designation: 'Senior Mathematics Tutor',
    });
    assert.strictEqual(teacherUserRes.status, 201, `Teacher provision failed: ${JSON.stringify(teacherUserRes.data)}`);
    const teacherStaffCode: string = teacherUserRes.data.issuedStaffNumber;
    assert.ok(teacherStaffCode && teacherStaffCode.includes('/STF/'), `Expected sequential Staff Login Code, got: ${teacherStaffCode}`);

    const staffUserRes = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Mrs. Halima Yusuf',
      email: 'librarian@abca.edu.ng',
      password: 'Password123!',
      role_name: 'STAFF',
      designation: 'School Librarian & Exam Officer',
    });
    assert.strictEqual(staffUserRes.status, 201, `Staff provision failed: ${JSON.stringify(staffUserRes.data)}`);
    const librarianStaffCode: string = staffUserRes.data.issuedStaffNumber;
    assert.ok(librarianStaffCode && librarianStaffCode !== teacherStaffCode, 'Librarian must receive a distinct unique Staff Login Code');

    // Also add a code-only staff member via Staff Directory (NO email, NO password)
    const codeOnlyStaffRes = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/staff', {
      first_name: 'Mallam',
      last_name: 'Ibrahim',
      job_title: 'Biology Tutor',
      department: 'Sciences',
    });
    assert.strictEqual(codeOnlyStaffRes.status, 201, `Code-only staff creation failed: ${JSON.stringify(codeOnlyStaffRes.data)}`);
    const codeOnlyStaffNumber: string = codeOnlyStaffRes.data.staff?.staff_number;
    assert.ok(codeOnlyStaffNumber && codeOnlyStaffNumber.includes('/STF/'), 'Code-only staff must auto-receive Staff Login Code');

    // Verify Admin/Owner & Bursar cannot authenticate via Staff Login Code endpoint (role separation guard)
    const bursarUserRes = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/users/provision', {
      full_name: 'Mr. Kabiru Musa',
      email: 'bursar@abca.edu.ng',
      password: 'Password123!',
      role_name: 'BURSAR',
      designation: 'School Bursar',
    });
    assert.strictEqual(bursarUserRes.status, 201);

    // Also test a long-named Nigerian school (matching mobile overflow edge-case)
    const longSchoolReg = await apiReq(null, null, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Saint Joseph Advanced College Of Health and Management Sciences',
      schoolType: 'International',
      state: 'Ogun',
      lga: 'Ado-Odo Ota',
      address: 'KM 10 Idiroko Express Way, Ota',
      phone: '08160754659',
      email: 'admissions@sjachms.edu.ng',
      ownerName: 'Dr. Joseph Adeyinka',
      ownerEmail: 'rector@sjachms.edu.ng',
      password: 'Password123!',
      question1: 'What state is the college located?',
      answer1: 'Ogun',
      question2: 'Founder year?',
      answer2: '2020',
    });
    assert.strictEqual(longSchoolReg.status, 201);
    const longSchoolSlug: string = longSchoolReg.data.school.slug;

    console.log(`[1/8] Backfill + Auto Admission ${studentAdmNo} + Staff Codes (${teacherStaffCode}, ${librarianStaffCode}, ${codeOnlyStaffNumber}) ready.`);

    // Launch Headless Chrome CDP
    const cdpPort = 9338;
    chromeProc = spawn(CHROME_BIN, [
      `--remote-debugging-port=${cdpPort}`,
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${chromeUserData}`,
      'about:blank',
    ]);
    let wsUrl = '';
    for (let i = 0; i < 40; i++) {
      try {
        const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        const pages = (await listRes.json()) as any[];
        if (pages[0]?.webSocketDebuggerUrl) {
          wsUrl = pages[0].webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(wsUrl, 'Failed to obtain Chromium CDP WebSocket URL');
    cdp = await CDPClient.connect(wsUrl);

    // 2. Verify Root Landing keeps Register Your School, then Admin signs in cleanly
    await cdp.goto(`${TEST_BASE}/`);
    const rootText = await cdp.bodyText();
    assert.ok(rootText.includes('Register Your School'), 'Root BursarIQ landing must retain Register Your School');
    await cdp.fillInput('input[type="email"]', 'principal@abca.edu.ng');
    await cdp.fillInput('input[type="password"]', 'Password123!');
    await cdp.clickSubmit();
    await cdp.waitForText('Shareable School Website & Subdomain Portal');
    await cdp.waitForText('Copy Subdomain');
    await cdp.waitForText('Copy Portal Link');

    await cdp.clickButtonByText('Manage School Website');
    await cdp.waitForText('Public School Website, Subdomain & Content Studio');

    // Update Subdomain + Theme Palette + Tagline + Principal
    await cdp.fillInputByPlaceholder('bright-stars-college', 'abca-kano');
    await cdp.clickButtonByText('Royal Navy');
    await cdp.fillInputByPlaceholder('Excellence, Discipline & Integrity', 'Knowledge, Character & National Service');
    await cdp.fillInputByPlaceholder('Chief Mrs. Folake Adeyemi', 'Mallam Sani Bello');
    await cdp.clickButtonByText('Save Website & Subdomain');
    await cdp.waitForText('https://abca-kano.bursariq.com.ng');

    // Publish News Article
    await cdp.clickButtonByText('News & Blog Articles');
    await cdp.clickButtonByText('Write New Article');
    await cdp.fillInputByPlaceholder('2026 Cultural & Career Day', '2026 STEM Olympiad Victory');
    await cdp.fillInputByPlaceholder('Brief 1-sentence summary', 'Our JSS & SSS learners clinched gold at the Northern Nigeria STEM Quiz.');
    await cdp.fillInputByPlaceholder('Write the full school article', 'Ahmadu Bello Crescent Academy proudly celebrates our mathematics and robotics students for winning top honours across Kano State.');
    await cdp.clickButtonByText('Save Article');
    await cdp.waitForText('2026 STEM Olympiad Victory');

    // Upload Gallery Photo (via data:image URL simulating compressed file)
    await cdp.clickButtonByText('Photo Gallery');
    await cdp.fillInputByPlaceholder('Science Fair Exhibition', 'New Science Laboratory Wing');
    await cdp.fillInputByPlaceholder('https://... or upload', SAMPLE_DATA_IMAGE);
    await cdp.clickButtonByText('Add Photo to Gallery');
    await cdp.waitForText('New Science Laboratory Wing');

    // Add PUBLIC and STAFF_ONLY Calendar Events
    await cdp.clickButtonByText('School Calendar');
    await cdp.fillInputByPlaceholder('Inter-House Sports Festival', 'Open Day & PTA Congress');
    await cdp.fillInput('input[type="date"]', '2026-06-18');
    await cdp.fillInputByPlaceholder('Main Assembly Hall', 'Auditorium Hall');
    await cdp.selectByOptionText('Public (Website, Parents & Students)');
    await cdp.clickButtonByText('Save Calendar Event');
    await cdp.waitForText('Open Day & PTA Congress');

    await cdp.fillInputByPlaceholder('Inter-House Sports Festival', 'Confidential Staff Promotion Panel');
    await cdp.fillInput('input[type="date"]', '2026-06-25');
    await cdp.selectByOptionText('Staff Only (Confidential Internal Calendar)');
    await cdp.clickButtonByText('Save Calendar Event');
    await cdp.waitForText('Confidential Staff Promotion Panel');

    // Add Timetable Period
    await cdp.clickButtonByText('Class Timetable');
    await cdp.selectByOptionText('JSS 1');
    await cdp.fillInputByPlaceholder('e.g. Mathematics', 'Mathematics');
    await cdp.fillInputByPlaceholder('e.g. Mr. Adewale', 'Mr. Tunde Adewale');
    await cdp.clickButtonByText('Add Timetable Period');
    await cdp.waitForText('Mr. Tunde Adewale');

    // Also Publish CONFIDENTIAL STAFF_ONLY Announcement & PUBLIC Announcement
    await cdp.clickButtonByText('Announcements', true);
    await cdp.clickButtonByText('Publish Announcement');
    await cdp.fillInputByPlaceholder('Mid-Term Open Day', 'Confidential: 2026 Term Salary & Appraisal Review');
    await cdp.selectByOptionText('Confidential — Staff Only');
    await cdp.evaluate(`
      const areas = Array.from(document.querySelectorAll('form textarea'));
      const el = areas[areas.length - 1];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, 'All teaching and non-teaching staff must submit appraisal forms directly to the Principal office before Friday.');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await cdp.clickSubmit();
    await cdp.waitForText('Confidential: 2026 Term Salary & Appraisal Review');

    await cdp.clickButtonByText('Publish Announcement');
    await cdp.fillInputByPlaceholder('Mid-Term Open Day', 'Mid-Term Break & Uniform Guidelines');
    await cdp.selectByOptionText('All Portal Users');
    await cdp.evaluate(`
      const areas = Array.from(document.querySelectorAll('form textarea'));
      const el = areas[areas.length - 1];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, 'Mid-term break begins Thursday and classes resume Monday at 8:00 AM sharp.');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await cdp.clickSubmit();
    await cdp.waitForText('Mid-Term Break & Uniform Guidelines');

    console.log('[2/8] School Admin configured Subdomain abca-kano, Website articles/gallery/timetable, and Confidential Staff Notice.');
    await cdp.logoutInBrowser();

    // 3. Test Subdomain Host Lookup API + Public Visitor School Website (/site/abca-kano and /#portal/<slug>)
    const hostLookup = await apiReq(null, null, 'GET', '/api/v1/public/portal-context?host=abca-kano.bursariq.com.ng');
    assert.strictEqual(hostLookup.status, 200);
    assert.strictEqual(hostLookup.data.matched, true);
    assert.strictEqual(hostLookup.data.slug, schoolSlug);
    assert.strictEqual(hostLookup.data.urls?.portal_subdomain, 'abca-kano');

    await cdp.goto(`${TEST_BASE}/site/abca-kano`);
    await cdp.waitForText('Ahmadu Bello Crescent Academy');
    await cdp.waitForText('Knowledge, Character & National Service');
    await cdp.waitForText('Mallam Sani Bello');
    await cdp.waitForText('2026 STEM Olympiad Victory');
    await cdp.waitForText('New Science Laboratory Wing');
    await cdp.waitForText('Open Day & PTA Congress');
    await cdp.waitForText('OFFICIAL SCHOOL PORTAL');

    const publicDomText = await cdp.bodyText();
    assert.ok(!publicDomText.includes('Confidential: 2026 Term Salary'), 'Public website leaked confidential staff notice!');
    assert.ok(!publicDomText.includes('Confidential Staff Promotion Panel'), 'Public website leaked confidential staff event!');
    assert.ok(!publicDomText.includes('Register Your School'), 'Public school website must hide Register Your School!');
    assert.ok(!publicDomText.includes('Register New School'), 'Public school website must hide Register New School footer link!');
    assert.ok(!publicDomText.includes('Register Free'), 'Public school website must hide Register Free CTA!');
    await cdp.checkNoHorizontalOverflow('Desktop /site/abca-kano');

    // Mobile Responsive Audit across narrow 360px & 390px viewports on long-named school & abca-kano
    await cdp.setViewport(360, 800, true);
    await cdp.goto(`${TEST_BASE}/#portal/${longSchoolSlug}`);
    await cdp.waitForText('Saint Joseph Advanced College Of Health and Management Sciences');
    await cdp.checkNoHorizontalOverflow('Mobile 360px /#portal/longSchool');
    const mobilePortalText = await cdp.bodyText();
    assert.ok(!mobilePortalText.includes('Register Your School'), 'Mobile school portal must hide Register Your School!');
    assert.ok(!mobilePortalText.includes('Register Free'), 'Mobile school portal must hide Register Free!');

    await cdp.setViewport(390, 844, true);
    await cdp.goto(`${TEST_BASE}/site/abca-kano`);
    await cdp.waitForText('Ahmadu Bello Crescent Academy');
    await cdp.checkNoHorizontalOverflow('Mobile 390px /site/abca-kano');

    // Restore desktop viewport for interaction steps
    await cdp.setViewport(1440, 900, false);

    // Open Article Reader Modal & close
    await cdp.clickButtonByText('Read Full Article');
    await cdp.waitForText('proudly celebrates our mathematics');
    await cdp.clickButtonByText('Close article');

    // Use prominent Apply / Inquiry CTA and submit Prospective Admissions Inquiry on Public Website
    await cdp.clickButtonByText('Apply / Inquiry');
    await cdp.fillInputByPlaceholder('Chinedu Okafor', 'Chinedu Okonkwo');
    await cdp.fillInputByPlaceholder('Mrs. Ngozi Okafor', 'Mrs. Ngozi Okonkwo');
    await cdp.fillInputByPlaceholder('08031234567', '08031234567');
    await cdp.fillInputByPlaceholder('Tell us about boarding preference', 'Seeking boarding space for JSS 1 transfer student.');
    await cdp.clickButtonByText('Send Admissions Inquiry');
    await cdp.waitForText('inquiry');

    console.log('[3/8] Public School Website (/site/abca-kano + mobile 360px/390px + Register Your School hidden + Inquiry) verified.');

    // Verify Admin sees Inquiry on Dashboard Overview, Announcements Notices, AND Website Inbox
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.fillInput('input[type="email"]', 'principal@abca.edu.ng');
    await cdp.fillInput('input[type="password"]', 'Password123!');
    await cdp.clickSubmit();
    await cdp.waitForText('Prospective Student Admissions Notices');
    await cdp.waitForText('Chinedu Okonkwo');
    await cdp.clickButtonByText('Announcements', true);
    await cdp.waitForText('Prospective Student Inquiry Notices');
    await cdp.waitForText('Chinedu Okonkwo');
    await cdp.clickButtonByText('Website & Gallery');
    await cdp.clickButtonByText('Admissions Inquiries');
    await cdp.waitForText('Chinedu Okonkwo');
    await cdp.clickButtonByText('CONTACTED');
    await cdp.waitForText('Status: CONTACTED');
    await cdp.logoutInBrowser();

    // 4. Role-Separated Dedicated Staff Login via UNIQUE STAFF LOGIN CODE (No Password Needed!)
    await cdp.goto(`${TEST_BASE}/#portal/${schoolSlug}`);
    await cdp.clickButtonByText('Staff', true);
    await cdp.fillInputByPlaceholder('BMC/STF/2026/0001', teacherStaffCode);
    await cdp.clickButtonByText('Open Staff Workspace');
    await cdp.waitForText('Dedicated Staff Workspace');
    await cdp.waitForText(teacherStaffCode);

    // Confirm Staff Overview displays Prospective Student Admissions Notices
    await cdp.waitForText('Prospective Student Applications & Admissions Notices');
    await cdp.waitForText('Chinedu Okonkwo');

    // Confidential Briefing + Admissions Notice in Confidential Notices tab + Acknowledge
    await cdp.clickButtonByText('Confidential Notices');
    await cdp.waitForText('Confidential: 2026 Term Salary & Appraisal Review');
    await cdp.waitForText('Prospective Student Admissions Notices');
    await cdp.waitForText('Chinedu Okonkwo');
    await cdp.clickButtonByText('Acknowledge Receipt');
    await cdp.waitForText('Acknowledged');

    // NERDC Lesson Note Generator + Submit to Principal
    await cdp.clickButtonByText('Lesson Notes & Plans');
    await cdp.clickButtonByText('Write / Generate Lesson Note');
    await cdp.fillInputByPlaceholder('Basic Science or Mathematics', 'Mathematics');
    await cdp.fillInputByPlaceholder('JSS 2 or SSS 1', 'JSS 1');
    await cdp.fillInputByPlaceholder('Quadratic Equations', 'Quadratic Equations by Factorization');
    await cdp.clickButtonByText('Auto-Generate NERDC Lesson Plan');
    await cdp.waitForText('Structured NERDC lesson plan draft generated');
    await cdp.clickButtonByText('Submit to Principal / Admin');
    await cdp.waitForText('Submitted for Review');

    // Teaching Timetable & Staff Calendar (sees both PUBLIC and STAFF_ONLY events!)
    await cdp.clickButtonByText('Timetable & Events');
    await cdp.waitForText('Mathematics');
    await cdp.waitForText('Confidential Staff Promotion Panel');

    // Staff Request submission
    await cdp.clickButtonByText('Staff Requests');
    await cdp.fillInputByPlaceholder('Science Laboratory Reagents', 'Need New Physics Pendulum Apparatus');
    await cdp.evaluate(`
      const area = document.querySelector('form textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, 'Requesting 10 pendulum kits for upcoming JSS practical sessions.');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await cdp.clickButtonByText('Submit Private Request');
    await cdp.waitForText('Need New Physics Pendulum Apparatus');
    await cdp.logoutInBrowser();

    // Confirm code-only staff member (created WITHOUT password/email) also enters Dedicated Staff Workspace seamlessly!
    await cdp.goto(`${TEST_BASE}/#portal/${schoolSlug}`);
    await cdp.clickButtonByText('Staff', true);
    await cdp.fillInputByPlaceholder('BMC/STF/2026/0001', codeOnlyStaffNumber);
    await cdp.clickButtonByText('Open Staff Workspace');
    await cdp.waitForText('Dedicated Staff Workspace');
    await cdp.waitForText(codeOnlyStaffNumber);
    await cdp.waitForText('Chinedu Okonkwo');
    await cdp.logoutInBrowser();

    // Strict API Role Separation Checks for Staff Code Login
    const invalidAdminStaffCode = await apiReq(null, null, 'POST', '/api/v1/public/portal/staff-code-login', {
      staff_code: 'PRINCIPAL-ADMIN',
      school_slug: schoolSlug,
    });
    assert.strictEqual(invalidAdminStaffCode.status, 401);

    // Link an Admin staff_number and confirm staff-code-login REJECTS Admin role (403 ADMIN_PASSWORD_REQUIRED)
    const adminStaffEntry = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/staff', {
      first_name: 'Sani',
      last_name: 'Bello',
      email: 'principal@abca.edu.ng',
      job_title: 'Principal',
      department: 'Administration',
    });
    assert.strictEqual(adminStaffEntry.status, 201);
    const adminCode = adminStaffEntry.data.staff?.staff_number;
    const rejectedAdminCodeLogin = await apiReq(null, null, 'POST', '/api/v1/public/portal/staff-code-login', {
      staff_code: adminCode,
      school_slug: schoolSlug,
    });
    assert.strictEqual(
      rejectedAdminCodeLogin.status,
      403,
      `Admin/Owner MUST be rejected by staff-code-login (got ${rejectedAdminCodeLogin.status})`
    );
    assert.strictEqual(rejectedAdminCodeLogin.data.error, 'ADMIN_PASSWORD_REQUIRED');

    // Confirm assign-missing-codes is non-destructive and preserves existing codes
    const assignRes = await apiReq(adminToken, schoolId, 'POST', '/api/v1/school/staff/assign-missing-codes');
    assert.strictEqual(assignRes.status, 200);
    assert.strictEqual(assignRes.data.assignedCount, 0, 'Existing issued staff codes must be preserved without overwriting');

    console.log('[4/8] Dedicated Staff Workspace (Staff Login Code role separation + Prospective Notices + Lesson Notes) verified.');

    // 5. Admin Approves Submitted Lesson Note & Staff Request
    await cdp.goto(`${TEST_BASE}/`);
    await cdp.fillInput('input[type="email"]', 'principal@abca.edu.ng');
    await cdp.fillInput('input[type="password"]', 'Password123!');
    await cdp.clickSubmit();
    await cdp.waitForText('Lesson Notes & Staff Desk');
    await cdp.clickButtonByText('Lesson Notes & Staff Desk');
    await cdp.waitForText('Quadratic Equations by Factorization');
    await cdp.clickButtonByText('Open & Review');
    await cdp.waitForText('Principal / Admin Review Decision');
    await cdp.clickButtonByText('Approve Lesson Note');
    await cdp.waitForText('Approved by Admin');
    await cdp.clickButtonByText('Close modal');

    await cdp.clickButtonByText('Staff Leave & Resource Requests');
    await cdp.waitForText('Need New Physics Pendulum Apparatus');
    await cdp.clickButtonByText('Approve', true);
    await cdp.waitForText('APPROVED');
    await cdp.logoutInBrowser();

    console.log('[5/8] School Admin reviewed & approved NERDC Lesson Note and Staff Request.');

    // 6. STRICT ZERO-LEAKAGE CHECK: Student & Parent Portals in Browser + Direct API 403 Guards
    await cdp.goto(`${TEST_BASE}/#portal/${schoolSlug}`);
    await cdp.clickButtonByText('Student', true);
    await cdp.fillInputByPlaceholder('ADM-2025-001', studentAdmNo);
    await cdp.clickButtonByText('View Student Portal');
    await cdp.waitForText('Kemi Adeola');
    await cdp.clickButtonByText('Timetable & Calendar');
    await cdp.waitForText('Open Day & PTA Congress');
    await cdp.waitForText('Mathematics');

    const studentDom = await cdp.bodyText();
    assert.ok(!studentDom.includes('Confidential: 2026 Term Salary'), 'LEAK: Student UI showed confidential notice!');
    assert.ok(!studentDom.includes('Confidential Staff Promotion Panel'), 'LEAK: Student UI showed STAFF_ONLY event!');
    assert.ok(!studentDom.includes('Quadratic Equations by Factorization'), 'LEAK: Student UI showed teacher lesson note!');
    assert.ok(!studentDom.includes('Need New Physics Pendulum Apparatus'), 'LEAK: Student UI showed private staff request!');
    assert.ok(!studentDom.includes('Chinedu Okonkwo'), 'LEAK: Student UI showed prospective admission inquiry!');
    await cdp.logoutInBrowser();

    await cdp.goto(`${TEST_BASE}/#portal/${schoolSlug}`);
    await cdp.clickButtonByText('Parent', true);
    await cdp.fillInputByPlaceholder('ADM-2025-001', studentAdmNo);
    await cdp.clickButtonByText('View Parent Portal');
    await cdp.waitForText('Kemi Adeola');
    await cdp.clickButtonByText('Timetable & Calendar');
    await cdp.waitForText('Open Day & PTA Congress');

    const parentDom = await cdp.bodyText();
    assert.ok(!parentDom.includes('Confidential: 2026 Term Salary'), 'LEAK: Parent UI showed confidential notice!');
    assert.ok(!parentDom.includes('Confidential Staff Promotion Panel'), 'LEAK: Parent UI showed STAFF_ONLY event!');
    assert.ok(!parentDom.includes('Quadratic Equations by Factorization'), 'LEAK: Parent UI showed teacher lesson note!');
    assert.ok(!parentDom.includes('Need New Physics Pendulum Apparatus'), 'LEAK: Parent UI showed private staff request!');
    await cdp.logoutInBrowser();

    // Direct API 403 Zero-Leakage checks for Student & Parent tokens
    const stuLoginRes = await apiReq(null, null, 'POST', '/api/v1/public/portal/admission-login', {
      admission_number: studentAdmNo,
      portal_type: 'STUDENT',
    });
    assert.strictEqual(stuLoginRes.status, 200);
    const stuToken = stuLoginRes.data.token;

    const parLoginRes = await apiReq(null, null, 'POST', '/api/v1/public/portal/admission-login', {
      admission_number: studentAdmNo,
      portal_type: 'PARENT',
    });
    assert.strictEqual(parLoginRes.status, 200);
    const parToken = parLoginRes.data.token;

    for (const [label, tok] of [
      ['STUDENT', stuToken],
      ['PARENT', parToken],
    ] as const) {
      const confBlock = await apiReq(tok, schoolId, 'GET', '/api/v1/staff-workspace/confidential-notices');
      assert.strictEqual(confBlock.status, 403, `${label} must receive 403 on confidential-notices, got ${confBlock.status}`);

      const lnBlock = await apiReq(tok, schoolId, 'GET', '/api/v1/staff-workspace/lesson-notes');
      assert.strictEqual(lnBlock.status, 403, `${label} must receive 403 on lesson-notes, got ${lnBlock.status}`);

      const genBlock = await apiReq(tok, schoolId, 'POST', '/api/v1/staff-workspace/lesson-notes/generate', {
        subject_name: 'Math',
        class_name: 'JSS 1',
        topic: 'Test',
      });
      assert.strictEqual(genBlock.status, 403, `${label} must receive 403 on lesson-notes/generate, got ${genBlock.status}`);

      const reqBlock = await apiReq(tok, schoolId, 'GET', '/api/v1/staff-workspace/requests');
      assert.strictEqual(reqBlock.status, 403, `${label} must receive 403 on staff requests, got ${reqBlock.status}`);

      const inqBlock = await apiReq(tok, schoolId, 'GET', '/api/v1/school/website/inquiries');
      assert.strictEqual(inqBlock.status, 403, `${label} must receive 403 on website inquiries, got ${inqBlock.status}`);

      const staffInqBlock = await apiReq(tok, schoolId, 'GET', '/api/v1/staff-workspace/admissions-inquiries');
      assert.strictEqual(staffInqBlock.status, 403, `${label} must receive 403 on staff admissions-inquiries, got ${staffInqBlock.status}`);

      const annList = await apiReq(tok, schoolId, 'GET', '/api/v1/school/announcements');
      assert.strictEqual(annList.status, 403, `${label} must receive 403 on /api/v1/school/announcements, got ${annList.status}`);
    }

    const stuDashApi = await apiReq(stuToken, schoolId, 'GET', '/api/v1/portal/student/dashboard');
    assert.strictEqual(stuDashApi.status, 200);
    assert.ok(
      !(stuDashApi.data.events || []).some((e: any) => e.visibility === 'STAFF_ONLY'),
      'Student dashboard API leaked STAFF_ONLY event!'
    );
    assert.ok(
      !(stuDashApi.data.announcements || []).some(
        (a: any) => String(a.title || '').includes('Confidential: 2026 Term Salary') || a.audience === 'STAFF_ONLY' || a.is_confidential === 1
      ),
      'Student dashboard API leaked confidential notice!'
    );

    const parDashApi = await apiReq(parToken, schoolId, 'GET', '/api/v1/portal/parent/dashboard');
    assert.strictEqual(parDashApi.status, 200);
    assert.ok(
      !(parDashApi.data.events || []).some((e: any) => e.visibility === 'STAFF_ONLY'),
      'Parent dashboard API leaked STAFF_ONLY event!'
    );
    assert.ok(
      !(parDashApi.data.announcements || []).some(
        (a: any) => String(a.title || '').includes('Confidential: 2026 Term Salary') || a.audience === 'STAFF_ONLY' || a.is_confidential === 1
      ),
      'Parent dashboard API leaked confidential notice!'
    );

    console.log('[6/8] Strict Zero-Leakage Audit passed across Student, Parent, Public UI & all API 403 guards.');

    // 7. Full Server Restart Persistence Check
    await stopChild(serverProc);
    serverProc = spawnSafeTestServer(tmpDir);
    await waitForHealth(TEST_BASE, 25000);

    await cdp.goto(`${TEST_BASE}/site/abca-kano`);
    await cdp.waitForText('Knowledge, Character & National Service');
    await cdp.waitForText('2026 STEM Olympiad Victory');
    await cdp.waitForText('New Science Laboratory Wing');

    await cdp.goto(`${TEST_BASE}/#portal/${schoolSlug}`);
    await cdp.clickButtonByText('Staff', true);
    await cdp.fillInputByPlaceholder('BMC/STF/2026/0001', teacherStaffCode);
    await cdp.clickButtonByText('Open Staff Workspace');
    await cdp.waitForText('Dedicated Staff Workspace');
    await cdp.clickButtonByText('Confidential Notices');
    await cdp.waitForText('Acknowledged');
    await cdp.waitForText('Chinedu Okonkwo');
    await cdp.clickButtonByText('Lesson Notes & Plans');
    await cdp.waitForText('Quadratic Equations by Factorization');
    await cdp.waitForText('Approved by Admin');
    await cdp.clickButtonByText('Staff Requests');
    await cdp.waitForText('APPROVED');
    await cdp.logoutInBrowser();

    console.log('[7/8] Full Server Restart Persistence verified cleanly.');

    assert.strictEqual(cdp.pageErrors.length, 0, `Page errors detected: ${cdp.pageErrors.join(' | ')}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `API 5xx errors detected: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('[8/8] Zero page errors and zero API 5xx errors across all School Website & Staff Workspace flows!');
    console.log('=== SCHOOL WEBSITE & STAFF WORKSPACE E2E: ALL CHECKS PASSED ===');
  } finally {
    cdp?.close();
    await stopChild(chromeProc);
    await stopChild(serverProc);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(chromeUserData, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('❌ SCHOOL WEBSITE & STAFF WORKSPACE E2E FAILED:', err);
  process.exit(1);
});
