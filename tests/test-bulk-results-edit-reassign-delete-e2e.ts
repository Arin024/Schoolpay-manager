import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const TEST_PORT = 3233;
const TEST_BASE = `http://127.0.0.1:${TEST_PORT}`;

async function waitForHealth(base: string, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Isolated sandbox server failed to boot in time');
}

async function apiReq(
  base: string,
  method: string,
  urlPath: string,
  body?: any,
  token?: string,
  schoolId?: string
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (schoolId) headers['x-school-id'] = schoolId;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function stopChild(proc: ChildProcess | null) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {}
  await new Promise((r) => setTimeout(r, 400));
  try {
    proc.kill('SIGKILL');
  } catch {}
}

class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  pageErrors: string[] = [];
  apiServerErrors: Array<{ url: string; status: number }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'JS error';
        this.pageErrors.push(String(desc));
      } else if (msg.method === 'Network.responseReceived') {
        const resp = msg.params?.response;
        if (resp?.url?.includes('/api/') && resp.status >= 500) {
          this.apiServerErrors.push({ url: resp.url, status: resp.status });
        }
      }
    });
  }

  static async connect(debugPort: number): Promise<CDPClient> {
    let wsUrl = '';
    for (let i = 0; i < 40; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        const page = list.find((t: any) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!wsUrl) throw new Error('Could not connect to Chromium CDP');
    const ws = new WebSocket(wsUrl);
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

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewport(width: number, height: number) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 500,
    });
  }

  async navigate(url: string) {
    await this.send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 900));
  }

  async evaluate<T = any>(expr: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval error');
    }
    return res.result?.value;
  }

  async bodyText(): Promise<string> {
    return this.evaluate(`return document.body?.innerText || '';`);
  }

  async waitForText(snippet: string, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const txt = await this.bodyText();
      if (txt.includes(snippet)) return txt;
      await new Promise((r) => setTimeout(r, 250));
    }
    const last = await this.bodyText();
    throw new Error(`Timed out waiting for "${snippet}". Snippet of page:\n${last.slice(0, 700)}`);
  }

  async clickButton(label: string) {
    const clicked = await this.evaluate(`
      const btns = Array.from(document.querySelectorAll('button, [role="button"]')).filter((b) => {
        const rect = b.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !b.disabled;
      });
      const exact = btns.find((b) => (b.innerText || '').trim() === ${JSON.stringify(label)});
      const partial = btns.find((b) => (b.innerText || '').trim().includes(${JSON.stringify(label)}));
      const target = exact || partial;
      if (!target) return null;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return (target.innerText || '').trim();
    `);
    if (!clicked) throw new Error(`Button containing "${label}" not found`);
    await new Promise((r) => setTimeout(r, 350));
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function run() {
  console.log('=== Bulk Results Edit, Reassign (Fix Wrong Class/Level/Session) & Bulk Delete E2E ===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-fix-results-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bursariq-chrome-fix-'));
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

    console.log(`1. Booting isolated sandbox server on port ${TEST_PORT}...`);
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
        JWT_SECRET: 'fix-results-e2e-secret-99999',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout?.on('data', (d) => serverLogs.push(d.toString()));
    serverProc.stderr?.on('data', (d) => serverLogs.push(d.toString()));
    await waitForHealth(TEST_BASE);
    console.log('   ✓ Isolated sandbox server healthy');

    const ensureActiveSession = async (token: string, schoolId: string, name = '2025/2026') => {
      let sesInit = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
      let active = (sesInit.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || (sesInit.data.sessions || [])[0];
      if (!active) {
        const created = await apiReq(TEST_BASE, 'POST', '/api/v1/school/academic-sessions', { name, status: 'ACTIVE' }, token, schoolId);
        assert.ok(created.status === 200 || created.status === 201);
        sesInit = await apiReq(TEST_BASE, 'GET', '/api/v1/school/academic-sessions', undefined, token, schoolId);
        active = (sesInit.data.sessions || []).find((s: any) => s.status === 'ACTIVE') || (sesInit.data.sessions || [])[0];
      }
      await apiReq(TEST_BASE, 'POST', `/api/v1/school/academic-sessions/${active.id}/ensure-terms`, {}, token, schoolId);
      return active;
    };

    // =========================================================================
    // 2. TERTIARY SCENARIO: Admin mistakenly uploads 100L results under HND 1
    // =========================================================================
    console.log('2. Testing Tertiary Mistake Recovery (HND 1 -> Year 1 (100L) + Inline Edit + Bulk Delete)...');
    const terEmail = `registrar.fix.${Date.now()}@healthtech.edu.ng`;
    const password = 'StrongPassword#2026!';
    const terReg = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Apex College of Health Sciences',
      schoolType: 'College of Health / Nursing',
      institutionCategory: 'TERTIARY',
      academicCycleType: 'SEMESTER',
      cycleLabels: ['1st Semester', '2nd Semester'],
      gradingMode: 'GPA_5',
      state: 'Lagos',
      lga: 'Surulere',
      address: '10 Health Way, Surulere',
      phone: '08035550001',
      email: 'info@apexhealth.edu.ng',
      ownerName: 'Dr. Grace Okonkwo',
      ownerEmail: terEmail,
      password,
      question1: 'City?',
      answer1: 'Lagos',
      question2: 'Color?',
      answer2: 'Blue',
    });
    assert.strictEqual(terReg.status, 201);
    const terToken = terReg.data.token;
    const terSchoolId = terReg.data.school?.id || terReg.data.activeSchool?.id || terReg.data.activeSchoolId;
    const terSes = await ensureActiveSession(terToken, terSchoolId, '2025/2026');

    const cls100L = (await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Year 1 (100L)', level: 'Tertiary' }, terToken, terSchoolId)).data.class;
    const clsHnd1 = (await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'HND 1', level: 'Tertiary' }, terToken, terSchoolId)).data.class;

    const terStu1 = (await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Ngozi', last_name: 'Eze', full_name: 'Ngozi Eze', admission_number: 'ACHS/FHC/101', gender: 'Female', class_id: cls100L.id },
      terToken,
      terSchoolId
    )).data.student;
    const terStu2 = (await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Musa', last_name: 'Bello', full_name: 'Musa Bello', admission_number: 'ACHS/FHC/102', gender: 'Male', class_id: cls100L.id },
      terToken,
      terSchoolId
    )).data.student;

    // Admin mistakenly uploads 100L 1st Semester results under "HND 1" AND publishes them immediately!
    const mistakenTerImport = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/historical-backlog/import',
      {
        rows: [
          { admission_number: 'ACHS/FHC/101', session_name: terSes.name, term_name: '1st Semester', class_name: 'HND 1', department: 'Family Healthcare', subject_code: 'FHC 111', subject_name: 'Family Health I', credit_units: 3, ca_score: 26, exam_score: 50, total_score: 76 },
          { admission_number: 'ACHS/FHC/101', session_name: terSes.name, term_name: '1st Semester', class_name: 'HND 1', department: 'Family Healthcare', subject_code: 'FHC 112', subject_name: 'Anatomy I', credit_units: 2, ca_score: 20, exam_score: 30, total_score: 50 },
          { admission_number: 'ACHS/FHC/102', session_name: terSes.name, term_name: '1st Semester', class_name: 'HND 1', department: 'Family Healthcare', subject_code: 'FHC 111', subject_name: 'Family Health I', credit_units: 3, ca_score: 22, exam_score: 48, total_score: 70 },
        ],
        publish_scores: true,
        auto_generate_reports: true,
      },
      terToken,
      terSchoolId
    );
    assert.strictEqual(mistakenTerImport.status, 201);

    // Also upload a completely wrong 2nd Semester batch that should be bulk-deleted later in Chromium UI!
    const wrongSecondSem = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/historical-backlog/import',
      {
        rows: [
          { admission_number: 'ACHS/FHC/101', session_name: terSes.name, term_name: '2nd Semester', class_name: 'HND 1', department: 'Family Healthcare', subject_code: 'WRONG 999', subject_name: 'Wrong Duplicate Course', credit_units: 2, ca_score: 10, exam_score: 15, total_score: 25 },
        ],
        publish_scores: true,
        auto_generate_reports: true,
      },
      terToken,
      terSchoolId
    );
    assert.strictEqual(wrongSecondSem.status, 201);

    const manageBefore = await apiReq(TEST_BASE, 'GET', '/api/v1/school/results/manage', undefined, terToken, terSchoolId);
    assert.strictEqual(manageBefore.status, 200);
    assert.strictEqual(manageBefore.data.batches.length, 2, 'Should list both uploaded batches');
    const hnd1FirstSemBatch = manageBefore.data.batches.find((b: any) => b.scores_count === 3);
    assert.ok(hnd1FirstSemBatch && hnd1FirstSemBatch.class_id === clsHnd1.id, 'Wrong batch should currently be on HND 1');

    // Fix via API? No, let's test Primary/Secondary via API first, and test Tertiary HND 1 -> Year 1 (100L) LIVE in Headless Chromium!

    // =========================================================================
    // 3. PRIMARY / SECONDARY SCENARIO (API): JSS 3 -> Primary 1 + Inline Score Edit + Bulk Delete + IDOR Guard
    // =========================================================================
    console.log('3. Testing Primary/Secondary Mistake Recovery (JSS 3 -> Primary 1 + Published Score Edit + Bulk Delete)...');
    const k12Email = `principal.fix.${Date.now()}@brightstars.edu.ng`;
    const k12Reg = await apiReq(TEST_BASE, 'POST', '/api/v1/auth/register-school', {
      schoolName: 'Bright Stars Comprehensive School',
      schoolType: 'Comprehensive / K-12',
      institutionCategory: 'K12',
      academicCycleType: 'TERM',
      cycleLabels: ['1st Term', '2nd Term', '3rd Term'],
      gradingMode: 'PERCENTAGE',
      state: 'Abuja',
      lga: 'AMAC',
      address: '15 Wuse II, Abuja',
      phone: '08036660002',
      email: 'info@brightstars.edu.ng',
      ownerName: 'Mr. David Danjuma',
      ownerEmail: k12Email,
      password,
      question1: 'City?',
      answer1: 'Abuja',
      question2: 'Color?',
      answer2: 'Gold',
    });
    assert.strictEqual(k12Reg.status, 201);
    const k12Token = k12Reg.data.token;
    const k12SchoolId = k12Reg.data.school?.id || k12Reg.data.activeSchool?.id || k12Reg.data.activeSchoolId;
    const k12Ses = await ensureActiveSession(k12Token, k12SchoolId, '2025/2026');

    const clsPri1 = (await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'Primary 1', level: 'Primary' }, k12Token, k12SchoolId)).data.class;
    const clsJss3 = (await apiReq(TEST_BASE, 'POST', '/api/v1/school/classes', { name: 'JSS 3', level: 'Junior Secondary' }, k12Token, k12SchoolId)).data.class;

    await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Tobi', last_name: 'Ade', full_name: 'Tobi Ade', admission_number: 'BS/P1/001', gender: 'Male', class_id: clsPri1.id },
      k12Token,
      k12SchoolId
    );
    await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/students',
      { first_name: 'Ada', last_name: 'Nnamdi', full_name: 'Ada Nnamdi', admission_number: 'BS/P1/002', gender: 'Female', class_id: clsPri1.id },
      k12Token,
      k12SchoolId
    );

    // Mistake 1: Uploaded Primary 1 1st Term results under "JSS 3" with a typo on Tobi's Math score (12 + 20 = 32 instead of 35 + 55 = 90)
    // Mistake 2: Also uploaded a completely wrong 2nd Term batch under JSS 3
    const k12Upload = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/historical-backlog/import',
      {
        rows: [
          { admission_number: 'BS/P1/001', session_name: k12Ses.name, term_name: '1st Term', class_name: 'JSS 3', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 12, exam_score: 20, total_score: 32 },
          { admission_number: 'BS/P1/002', session_name: k12Ses.name, term_name: '1st Term', class_name: 'JSS 3', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 34, exam_score: 50, total_score: 84 },
          { admission_number: 'BS/P1/001', session_name: k12Ses.name, term_name: '2nd Term', class_name: 'JSS 3', subject_code: 'MTH', subject_name: 'Mathematics', credit_units: 1, ca_score: 5, exam_score: 10, total_score: 15 },
        ],
        publish_scores: true,
        auto_generate_reports: true,
      },
      k12Token,
      k12SchoolId
    );
    assert.strictEqual(k12Upload.status, 201);

    const k12Manage1 = await apiReq(TEST_BASE, 'GET', '/api/v1/school/results/manage', undefined, k12Token, k12SchoolId);
    const term1Batch = k12Manage1.data.batches.find((b: any) => b.term_name === '1st Term');
    const term2Batch = k12Manage1.data.batches.find((b: any) => b.term_name === '2nd Term');
    assert.ok(term1Batch && term1Batch.class_id === clsJss3.id, 'Term 1 batch must initially be on JSS 3');
    assert.ok(term2Batch && term2Batch.class_id === clsJss3.id, 'Term 2 batch must initially be on JSS 3');

    // Cross-tenant IDOR check: Tertiary school MUST NOT be able to reassign or delete K12 school's batch!
    const idorReassign = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/results/bulk-reassign',
      { examination_ids: [term1Batch.examination_id], target_class_id: cls100L.id, reason: 'IDOR probe' },
      terToken,
      terSchoolId
    );
    assert.strictEqual(idorReassign.status, 404, 'Cross-tenant reassign must be blocked with 404');
    const idorDelete = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/results/bulk-delete',
      { examination_ids: [term1Batch.examination_id], reason: 'IDOR delete probe' },
      terToken,
      terSchoolId
    );
    assert.strictEqual(idorDelete.status, 404, 'Cross-tenant delete must be blocked with 404');
    console.log('   ✓ Cross-tenant IDOR protection verified');

    // 3a. Reassign 1st Term batch from JSS 3 -> Primary 1!
    const reassignK12 = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/results/bulk-reassign',
      {
        examination_ids: [term1Batch.examination_id],
        target_class_id: clsPri1.id,
        reason: 'Mistakenly selected JSS 3 instead of Primary 1',
      },
      k12Token,
      k12SchoolId
    );
    assert.strictEqual(reassignK12.status, 200, `Reassign failed: ${JSON.stringify(reassignK12.data)}`);
    assert.strictEqual(reassignK12.data.summary.scoresMoved, 2);

    // Verify 1st Term batch & report cards are now on Primary 1 (and NOT JSS 3)
    const pri1Reports = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/report-cards?academic_session_id=${k12Ses.id}&class_id=${clsPri1.id}`,
      undefined,
      k12Token,
      k12SchoolId
    );
    assert.strictEqual((pri1Reports.data.reportCards || []).length, 2, 'Both Primary 1 report cards must now be under Primary 1');
    const jss3Term1Reports = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/report-cards?academic_session_id=${k12Ses.id}&term_id=${term1Batch.term_id}&class_id=${clsJss3.id}`,
      undefined,
      k12Token,
      k12SchoolId
    );
    assert.strictEqual((jss3Term1Reports.data.reportCards || []).length, 0, 'JSS 3 must have ZERO 1st Term report cards after reassignment');

    // 3b. Inline edit Tobi's published Mathematics typo (12+20=32 -> 35+55=90)
    const k12Manage2 = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/results/manage?examination_id=${term1Batch.examination_id}`,
      undefined,
      k12Token,
      k12SchoolId
    );
    const tobiScore = k12Manage2.data.scores.find((s: any) => s.admission_number === 'BS/P1/001');
    assert.ok(tobiScore && tobiScore.class_id === clsPri1.id, 'Tobi score must now have Primary 1 class_id');

    const editRes = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/results/bulk-edit',
      {
        edits: [{ score_id: tobiScore.id, ca_score: 35, exam_score: 55, total_score: 90, subject_remark: 'Excellent improvement' }],
        reason: 'Fixed transcription typo from broadsheet',
      },
      k12Token,
      k12SchoolId
    );
    assert.strictEqual(editRes.status, 200, `Bulk edit failed: ${JSON.stringify(editRes.data)}`);
    assert.strictEqual(editRes.data.summary.updatedCount, 1);
    assert.strictEqual(editRes.data.summary.correctionLogsCreated, 1, 'Published score edit must write score_correction_logs');

    // Verify Tobi's report card average refreshed to 90% and moved to 1st position!
    const pri1ReportsAfterEdit = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/report-cards?academic_session_id=${k12Ses.id}&term_id=${term1Batch.term_id}&class_id=${clsPri1.id}`,
      undefined,
      k12Token,
      k12SchoolId
    );
    const tobiRc = (pri1ReportsAfterEdit.data.reportCards || []).find((r: any) => r.admission_number === 'BS/P1/001');
    assert.strictEqual(Number(tobiRc.average_score), 90, 'Tobi report card average must refresh to 90%');
    assert.strictEqual(Number(tobiRc.class_position), 1, 'Tobi must now rank #1 ahead of 84%');

    // 3c. Bulk delete the mistaken published 2nd Term batch (test missing reason validation first!)
    const delNoReason = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/results/bulk-delete',
      { examination_ids: [term2Batch.examination_id], reason: '' },
      k12Token,
      k12SchoolId
    );
    assert.strictEqual(delNoReason.status, 400, 'Deleting published results without reason must return 400');

    const delTerm2 = await apiReq(
      TEST_BASE,
      'POST',
      '/api/v1/school/results/bulk-delete',
      {
        examination_ids: [term2Batch.examination_id],
        also_delete_registrations: true,
        reason: 'Uploaded wrong 2nd term batch under JSS 3',
      },
      k12Token,
      k12SchoolId
    );
    assert.strictEqual(delTerm2.status, 200, `Bulk delete failed: ${JSON.stringify(delTerm2.data)}`);
    assert.strictEqual(delTerm2.data.summary.scoresDeleted, 1);
    assert.strictEqual(delTerm2.data.summary.examsDeleted, 1);
    assert.strictEqual(delTerm2.data.summary.termReportsDeleted, 1, 'Stale 2nd Term report card must be deleted cleanly');

    // Verify 2nd Term report cards are gone while 1st Term Primary 1 report cards stay intact & session report recalculated to 90%!
    const term2ReportsAfter = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/report-cards?academic_session_id=${k12Ses.id}&term_id=${term2Batch.term_id}`,
      undefined,
      k12Token,
      k12SchoolId
    );
    assert.strictEqual((term2ReportsAfter.data.reportCards || []).length, 0, '2nd Term must have 0 report cards remaining');
    const k12SessionRcs = await apiReq(
      TEST_BASE,
      'GET',
      `/api/v1/school/session-report-cards?academic_session_id=${k12Ses.id}`,
      undefined,
      k12Token,
      k12SchoolId
    );
    const tobiSessionRc = (k12SessionRcs.data.sessionReportCards || []).find((r: any) => r.admission_number === 'BS/P1/001');
    assert.ok(tobiSessionRc && Number(tobiSessionRc.average_score) === 90 && Number(tobiSessionRc.terms_count) === 1, 'Session report card must recalculate cleanly to 1 term @ 90%');
    console.log('   ✓ Primary/Secondary Reassign (JSS 3 -> Primary 1), Published Inline Edit & Audited Bulk Delete verified!');

    // =========================================================================
    // 4. REAL HEADLESS CHROMIUM UI E2E (Tertiary HND 1 -> Year 1 (100L), Inline Edit, Bulk Delete & Mobile 390px)
    // =========================================================================
    console.log('4. Launching Headless Chromium to test UI Reassign (HND 1 -> Year 1 100L), Inline Edit & Bulk Delete...');
    const chromePath = [
      '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
    ].find((p) => fs.existsSync(p));
    assert.ok(chromePath, 'Chromium binary not found');
    const debugPort = 9249;
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
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(email, ${JSON.stringify(terEmail)});
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwd, ${JSON.stringify(password)});
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form button[type="submit"]').click();
    `);
    await cdp.waitForText('Apex College of Health Sciences');

    await cdp.clickButton('Performance & Reports');
    await cdp.waitForText('Examinations & Scores');
    await cdp.clickButton('Examinations & Scores');
    await cdp.waitForText('Manage / Fix Results');
    await cdp.waitForText('HND 1');

    // 4a. Click "Manage / Fix Results" to open modal
    await cdp.clickButton('Manage / Fix Results');
    await cdp.waitForText('Manage, Correct & Bulk Delete Uploaded Results');
    await cdp.waitForText('Uploaded Batches (2)');

    // Click "Fix Level" on the 1st Semester HND 1 batch (the row containing "3" scores / 1st Semester)
    await cdp.evaluate(`
      const rows = Array.from(document.querySelectorAll('[role="dialog"] tbody tr'));
      const targetRow = rows.find((r) => (r.innerText || '').includes('1st Semester') && (r.innerText || '').includes('HND 1'));
      if (!targetRow) throw new Error('1st Semester HND 1 batch row not found');
      const btn = Array.from(targetRow.querySelectorAll('button')).find((b) => (b.innerText || '').includes('Fix'));
      if (!btn) throw new Error('Fix Level button not found');
      btn.click();
    `);
    await cdp.waitForText('Apply Reassignment');

    // Select "Year 1 (100L)" in Target Level select and apply!
    await cdp.evaluate(`
      const sel = document.querySelector('select[aria-label*="Target"][aria-label*="Reassignment"]');
      if (!sel) throw new Error('Target class select not found');
      const opt = Array.from(sel.options).find((o) => o.text.includes('Year 1 (100L)'));
      if (!opt) throw new Error('Year 1 (100L) option not found');
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await cdp.clickButton('Apply Reassignment');
    await cdp.waitForText('Reassigned 3 score(s)');
    await cdp.waitForText('Year 1 (100L)');
    console.log('   ✓ UI Reassign (HND 1 -> Year 1 (100L)) verified in Chromium!');

    // 4b. Switch to "Individual Scores" tab, edit Ngozi's Anatomy I score inline (20+30=50 -> 30+52=82), and save!
    await cdp.clickButton('Individual Scores');
    await cdp.waitForText('Ngozi Eze');
    await cdp.evaluate(`
      const caInp = document.querySelector('input[aria-label="CA score for Ngozi Eze Anatomy I"]');
      const exInp = document.querySelector('input[aria-label="Exam score for Ngozi Eze Anatomy I"]');
      if (!caInp || !exInp) throw new Error('Inline score inputs for Ngozi Eze Anatomy I not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(caInp, '30');
      caInp.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(exInp, '52');
      exInp.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await cdp.waitForText('Save 1 Score Edit');
    await cdp.clickButton('Save 1 Score Edit');
    await cdp.waitForText('Updated 1 result score(s)');
    console.log('   ✓ UI Inline Score Edit on published result verified in Chromium!');

    // 4c. Switch back to "Uploaded Batches", bulk-delete the wrong 2nd Semester HND 1 batch!
    await cdp.clickButton('Uploaded Batches');
    await cdp.evaluate(`
      const rows = Array.from(document.querySelectorAll('[role="dialog"] tbody tr'));
      const wrongRow = rows.find((r) => (r.innerText || '').includes('2nd Semester'));
      if (!wrongRow) throw new Error('Wrong 2nd Semester batch row not found');
      const delBtn = Array.from(wrongRow.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Delete');
      if (!delBtn) throw new Error('Delete button not found on wrong batch row');
      delBtn.click();
    `);
    await cdp.waitForText('Confirm Permanent Bulk Delete');
    await cdp.clickButton('Confirm Permanent Bulk Delete');
    await cdp.waitForText('Deleted 1 score(s) and 1 examination batch(es)');
    await cdp.waitForText('Uploaded Batches (1)');

    // 4d. Mobile 390px responsiveness check while modal is open
    await cdp.setViewport(390, 844);
    await new Promise((r) => setTimeout(r, 350));
    const overflow = await cdp.evaluate(`return document.documentElement.scrollWidth - window.innerWidth;`);
    assert.ok(overflow <= 24, `Unexpected mobile overflow: ${overflow}px`);

    assert.strictEqual(cdp.pageErrors.length, 0, `Page errors detected: ${JSON.stringify(cdp.pageErrors)}`);
    assert.strictEqual(cdp.apiServerErrors.length, 0, `5xx API errors detected: ${JSON.stringify(cdp.apiServerErrors)}`);
    console.log('   ✓ UI Bulk Delete & Mobile 390px layout verified (0 page errors, 0 5xx API errors)!');
    console.log('\n✅ ALL BULK RESULTS EDIT, REASSIGN & BULK DELETE E2E TESTS PASSED 100%!');
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
