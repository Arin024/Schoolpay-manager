import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test.local') });
dotenv.config();

import { initDatabase, db, getPgPool } from '../server/db.js';
import { apiRouter } from '../server/routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', apiRouter);
app.use('/v1', apiRouter);

const server = http.createServer(app);

async function req(
  method: string,
  urlPath: string,
  body?: any,
  token?: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extraHeaders,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload).toString();
  }
  const port = (server.address() as any).port;

  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let data: any = raw;
          try {
            data = JSON.parse(raw);
          } catch {
            // keep text
          }
          resolve({ status: res.statusCode || 500, data });
        });
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function cleanupTestData(schoolIds: string[], userIds: string[]) {
  const pool = getPgPool();
  const safeIds = schoolIds.filter(Boolean);
  const safeUsers = userIds.filter(Boolean);

  if (pool && safeIds.length > 0) {
    const client = await pool.connect();
    try {
      const tables = [
        'score_correction_logs',
        'student_scores',
        'report_cards',
        'attendance_publications',
        'attendance_records',
        'behaviour_records',
        'teacher_remarks',
        'school_announcements',
        'examinations',
        'subjects',
        'academic_settings',
        'receipts',
        'payments',
        'invoice_discounts',
        'invoice_items',
        'invoices',
        'fee_structure_items',
        'fee_structures',
        'fee_categories',
        'parent_students',
        'parents',
        'students',
        'class_arms',
        'classes',
        'staff',
        'terms',
        'academic_sessions',
        'notifications',
        'audit_logs',
        'school_settings',
        'user_roles',
      ];
      for (const tbl of tables) {
        try {
          await client.query(`DELETE FROM ${tbl} WHERE school_id = ANY($1)`, [safeIds]);
        } catch {
          // ignore if table has no school_id or doesn't exist
        }
      }
      await client.query(`DELETE FROM schools WHERE id = ANY($1)`, [safeIds]);
      if (safeUsers.length > 0) {
        await client.query(`DELETE FROM sessions WHERE user_id = ANY($1)`, [safeUsers]);
        await client.query(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [safeUsers]);
        await client.query(`DELETE FROM users WHERE id = ANY($1) AND is_platform_admin = 0`, [safeUsers]);
      }
    } finally {
      client.release();
    }
  }

  if (safeIds.length > 0) {
    const tables = [
      'score_correction_logs',
      'student_scores',
      'report_cards',
      'attendance_publications',
      'attendance_records',
      'behaviour_records',
      'teacher_remarks',
      'school_announcements',
      'examinations',
      'subjects',
      'academic_settings',
      'receipts',
      'payments',
      'invoice_discounts',
      'invoice_items',
      'invoices',
      'fee_structure_items',
      'fee_structures',
      'fee_categories',
      'parent_students',
      'parents',
      'students',
      'class_arms',
      'classes',
      'staff',
      'terms',
      'academic_sessions',
      'notifications',
      'audit_logs',
      'school_settings',
      'user_roles',
    ];
    for (const sId of safeIds) {
      for (const tbl of tables) {
        try {
          db.prepare(`DELETE FROM ${tbl} WHERE school_id = ?`).run(sId);
        } catch {
          // ignore
        }
      }
      try {
        db.prepare(`DELETE FROM schools WHERE id = ?`).run(sId);
      } catch {
        // ignore
      }
    }
  }

  for (const uid of safeUsers) {
    try {
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(uid);
      db.prepare(`DELETE FROM user_roles WHERE user_id = ?`).run(uid);
      db.prepare(`DELETE FROM users WHERE id = ? AND is_platform_admin = 0`).run(uid);
    } catch {
      // ignore
    }
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('   BURSARIQ: RBAC, ROLE PORTALS & ADMIN RECORD PROTECTION E2E   ');
  console.log('===============================================================');

  await initDatabase();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const createdSchools: string[] = [];
  const createdUsers: string[] = [];

  try {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;

    // -------------------------------------------------------------------------
    // 1. Register Isolated School A & School B
    // -------------------------------------------------------------------------
    console.log('\n[1/9] Registering isolated School A & School B...');
    const regA = await req('POST', '/api/v1/auth/register-school', {
      schoolName: `RBAC Alpha College ${suffix}`,
      schoolType: 'Secondary',
      state: 'Lagos',
      lga: 'Ikeja',
      address: '12 Isaac John St, GRA Ikeja',
      phone: `0805${suffix.slice(0, 7)}`,
      email: `info@rbac-alpha-${suffix}.edu.ng`,
      ownerName: 'Chief Adeyemi',
      ownerEmail: `owner-a-${suffix}@rbac.edu.ng`,
      password: 'RbacOwnerPassword2026!',
      question1: 'What is your favorite Nigerian city?',
      answer1: 'Lagos',
      question2: 'What is your mother maiden name?',
      answer2: 'Adebayo',
    });
    assert.strictEqual(regA.status, 201, `School A registration failed: ${JSON.stringify(regA.data)}`);
    const schoolAId = regA.data.school.id;
    const ownerAToken = regA.data.token;
    createdSchools.push(schoolAId);
    createdUsers.push(regA.data.user.id);

    const regB = await req('POST', '/api/v1/auth/register-school', {
      schoolName: `RBAC Beta Academy ${suffix}`,
      schoolType: 'Secondary',
      state: 'FCT - Abuja',
      lga: 'Wuse',
      address: '5 Aminu Kano Cres, Wuse II',
      phone: `0806${suffix.slice(0, 7)}`,
      email: `info@rbac-beta-${suffix}.edu.ng`,
      ownerName: 'Dr. Bello',
      ownerEmail: `owner-b-${suffix}@rbac.edu.ng`,
      password: 'RbacOwnerPassword2026!',
      question1: 'What is your favorite Nigerian city?',
      answer1: 'Abuja',
      question2: 'What is your mother maiden name?',
      answer2: 'Danladi',
    });
    assert.strictEqual(regB.status, 201, `School B registration failed: ${JSON.stringify(regB.data)}`);
    const schoolBId = regB.data.school.id;
    const ownerBToken = regB.data.token;
    createdSchools.push(schoolBId);
    createdUsers.push(regB.data.user.id);

    // Authoritative /v1/auth/me check for Owner A
    const ownerMe = await req('GET', '/api/v1/auth/me', undefined, ownerAToken, { 'X-School-Id': schoolAId });
    assert.strictEqual(ownerMe.status, 200);
    assert.strictEqual(ownerMe.data.activeRole?.role_name, 'SCHOOL_OWNER');
    assert.strictEqual(ownerMe.data.activeSchoolId, schoolAId);
    console.log('✓ PASS: School registration & authoritative Owner /auth/me verified');

    // -------------------------------------------------------------------------
    // 2. Owner A Sets Up Academic & Student Entities
    // -------------------------------------------------------------------------
    console.log('\n[2/9] Admin creating class, arm, subject, session, term, students, exam, scores, attendance...');
    const hOwner = { 'X-School-Id': schoolAId };

    const clsRes = await req('POST', '/api/v1/school/classes', { name: 'JSS 2', level: 'Junior Secondary' }, ownerAToken, hOwner);
    assert.strictEqual(clsRes.status, 201);
    const classId = clsRes.data.class.id;

    const stfRes = await req('POST', '/api/v1/school/staff', {
      first_name: 'Tunde',
      last_name: 'Bakare',
      email: `teacher-${suffix}@rbac.edu.ng`,
      job_title: 'Mathematics Teacher',
      department: 'Science',
    }, ownerAToken, hOwner);
    assert.strictEqual(stfRes.status, 201, `Staff create failed: ${JSON.stringify(stfRes.data)}`);
    const teacherStaffId = stfRes.data.staff.id;

    const armRes = await req('POST', `/api/v1/school/classes/${classId}/arms`, {
      name: 'Gold',
      capacity: 35,
      class_teacher_id: teacherStaffId,
    }, ownerAToken, hOwner);
    assert.strictEqual(armRes.status, 201);
    const armId = armRes.data.arm.id;

    const subRes = await req('POST', '/api/v1/school/subjects', { name: 'Mathematics', code: `MTH-${suffix.slice(-3)}`, class_id: classId }, ownerAToken, hOwner);
    assert.strictEqual(subRes.status, 201);
    const subjectId = subRes.data.subject.id;

    const sessRes = await req('POST', '/api/v1/school/academic-sessions', { name: '2025/2026', status: 'ACTIVE' }, ownerAToken, hOwner);
    assert.strictEqual(sessRes.status, 201);
    const sessionId = sessRes.data.session.id;

    const termRes = await req('POST', `/api/v1/school/academic-sessions/${sessionId}/terms`, { name: '1st Term', status: 'ACTIVE' }, ownerAToken, hOwner);
    assert.strictEqual(termRes.status, 201);
    const termId = termRes.data.term.id;

    const s1Res = await req('POST', '/api/v1/school/students', {
      first_name: 'Chidi',
      last_name: 'Okafor',
      admission_number: `ADM-${suffix}-01`,
      class_id: classId,
      class_arm_id: armId,
      gender: 'Male',
    }, ownerAToken, hOwner);
    assert.strictEqual(s1Res.status, 201);
    const student1Id = s1Res.data.student.id;

    const s2Res = await req('POST', '/api/v1/school/students', {
      first_name: 'Amina',
      last_name: 'Musa',
      admission_number: `ADM-${suffix}-02`,
      class_id: classId,
      class_arm_id: armId,
      gender: 'Female',
    }, ownerAToken, hOwner);
    assert.strictEqual(s2Res.status, 201);
    const student2Id = s2Res.data.student.id;

    const examRes = await req('POST', '/api/v1/school/examinations', {
      title: '1st Term Exam',
      exam_type: 'TERMINAL',
      academic_session_id: sessionId,
      term_id: termId,
      class_id: classId,
      ca_max_score: 40,
      exam_max_score: 60,
    }, ownerAToken, hOwner);
    assert.strictEqual(examRes.status, 201);
    const examId = examRes.data.examination.id;

    const scoresRes = await req('PUT', `/api/v1/school/examinations/${examId}/scores`, {
      entries: [
        { student_id: student1Id, subject_id: subjectId, ca_score: 35, exam_score: 52, subject_remark: 'Excellent' },
        { student_id: student2Id, subject_id: subjectId, ca_score: 28, exam_score: 44, subject_remark: 'Good' },
      ],
    }, ownerAToken, hOwner);
    assert.strictEqual(scoresRes.status, 200);

    const revExam = await req('POST', `/api/v1/school/examinations/${examId}/status`, { status: 'REVIEW' }, ownerAToken, hOwner);
    assert.strictEqual(revExam.status, 200, `Review exam failed: ${JSON.stringify(revExam.data)}`);
    const pubExam = await req('POST', `/api/v1/school/examinations/${examId}/status`, { status: 'PUBLISHED' }, ownerAToken, hOwner);
    assert.strictEqual(pubExam.status, 200, `Publish exam failed: ${JSON.stringify(pubExam.data)}`);

    const genRc = await req('POST', '/api/v1/school/report-cards/generate', {
      academic_session_id: sessionId,
      term_id: termId,
      class_id: classId,
      examination_id: examId,
    }, ownerAToken, hOwner);
    assert.strictEqual(genRc.status, 200, `Generate RC failed: ${JSON.stringify(genRc.data)}`);

    const pubRc = await req('POST', '/api/v1/school/report-cards/publish-class', {
      academic_session_id: sessionId,
      term_id: termId,
      class_id: classId,
    }, ownerAToken, hOwner);
    assert.strictEqual(pubRc.status, 200, `Publish RC failed: ${JSON.stringify(pubRc.data)}`);

    const attRes = await req('POST', '/api/v1/school/attendance/bulk', {
      attendance_date: '2026-02-10',
      class_id: classId,
      academic_session_id: sessionId,
      term_id: termId,
      is_published: true,
      records: [
        { student_id: student1Id, status: 'PRESENT', notes: 'On time' },
        { student_id: student2Id, status: 'LATE', notes: '10m late' },
      ],
    }, ownerAToken, hOwner);
    assert.strictEqual(attRes.status, 200);

    const behRes = await req('POST', '/api/v1/school/behaviour', {
      student_id: student1Id,
      class_id: classId,
      academic_session_id: sessionId,
      term_id: termId,
      category: 'COMMENDATION',
      severity: 'LOW',
      title: 'Class Prefect Distinction',
      description: 'Helpful in class laboratory',
      visible_to_parent: true,
      visible_to_student: true,
      visible_to_teacher: true,
    }, ownerAToken, hOwner);
    assert.strictEqual(behRes.status, 201, `Behaviour failed: ${JSON.stringify(behRes.data)}`);

    const annRes = await req('POST', '/api/v1/school/announcements', {
      title: 'Midterm Break Notice',
      content: 'School closes Friday for midterm break.',
      audience: 'ALL',
      priority: 'NORMAL',
      is_published: true,
    }, ownerAToken, hOwner);
    assert.strictEqual(annRes.status, 201);
    console.log('✓ PASS: Academic, exam, report card, attendance, behaviour & announcement setup completed');

    // -------------------------------------------------------------------------
    // 3. Provision Portal Users (SCHOOL_ADMIN, BURSAR, TEACHER, PARENT, STUDENT)
    // -------------------------------------------------------------------------
    console.log('\n[3/9] Provisioning SCHOOL_ADMIN, BURSAR, TEACHER, PARENT (Student 1 only) & STUDENT (Student 1)...');

    const provAdmin = await req('POST', '/api/v1/school/users/provision', {
      full_name: 'Principal Ada',
      email: `principal-${suffix}@rbac.edu.ng`,
      password: 'RolePassword2026!',
      role_name: 'SCHOOL_ADMIN',
    }, ownerAToken, hOwner);
    assert.strictEqual(provAdmin.status, 201, `Admin provision failed: ${JSON.stringify(provAdmin.data)}`);
    createdUsers.push(provAdmin.data.user.id);

    const provBursar = await req('POST', '/api/v1/school/users/provision', {
      full_name: 'Bursar Emeka',
      email: `bursar-${suffix}@rbac.edu.ng`,
      password: 'RolePassword2026!',
      role_name: 'BURSAR',
    }, ownerAToken, hOwner);
    assert.strictEqual(provBursar.status, 201);
    createdUsers.push(provBursar.data.user.id);

    const provTeacher = await req('POST', '/api/v1/school/users/provision', {
      full_name: 'Mr. Tunde Teacher',
      email: `teacher-${suffix}@rbac.edu.ng`,
      password: 'RolePassword2026!',
      role_name: 'TEACHER',
    }, ownerAToken, hOwner);
    assert.strictEqual(provTeacher.status, 201);
    const teacherUserId = provTeacher.data.user.id;
    createdUsers.push(teacherUserId);

    const provParent = await req('POST', '/api/v1/school/users/provision', {
      full_name: 'Mrs. Okafor Parent',
      email: `parent-${suffix}@rbac.edu.ng`,
      phone: '08090001111',
      password: 'RolePassword2026!',
      role_name: 'PARENT',
      create_parent_profile: true,
      student_ids: [student1Id],
    }, ownerAToken, hOwner);
    assert.strictEqual(provParent.status, 201);
    createdUsers.push(provParent.data.user.id);

    const provStudent = await req('POST', '/api/v1/school/users/provision', {
      full_name: 'Chidi Okafor',
      email: `student1-${suffix}@rbac.edu.ng`,
      password: 'RolePassword2026!',
      role_name: 'STUDENT',
      student_id: student1Id,
    }, ownerAToken, hOwner);
    assert.strictEqual(provStudent.status, 201);
    createdUsers.push(provStudent.data.user.id);

    // Login all 5 users and verify authoritative activeRole from /v1/auth/me
    const loginAndVerifyRole = async (email: string, expectedRole: string) => {
      const loginRes = await req('POST', '/api/v1/auth/login', { email, password: 'RolePassword2026!' });
      assert.strictEqual(loginRes.status, 200, `Login failed for ${email}`);
      const token = loginRes.data.token;
      const meRes = await req('GET', '/api/v1/auth/me', undefined, token, { 'X-School-Id': schoolAId });
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.data.activeRole?.role_name, expectedRole, `Expected activeRole ${expectedRole}, got ${meRes.data.activeRole?.role_name}`);
      return token as string;
    };

    const adminToken = await loginAndVerifyRole(`principal-${suffix}@rbac.edu.ng`, 'SCHOOL_ADMIN');
    const bursarToken = await loginAndVerifyRole(`bursar-${suffix}@rbac.edu.ng`, 'BURSAR');
    const teacherToken = await loginAndVerifyRole(`teacher-${suffix}@rbac.edu.ng`, 'TEACHER');
    const parentToken = await loginAndVerifyRole(`parent-${suffix}@rbac.edu.ng`, 'PARENT');
    const studentToken = await loginAndVerifyRole(`student1-${suffix}@rbac.edu.ng`, 'STUDENT');
    console.log('✓ PASS: All 5 provisioned role accounts login cleanly and return authoritative activeRole');

    // -------------------------------------------------------------------------
    // 4. SCHOOL_ADMIN Verification
    // -------------------------------------------------------------------------
    console.log('\n[4/9] Verifying SCHOOL_ADMIN retains full school management...');
    assert.strictEqual((await req('GET', '/api/v1/school/users', undefined, adminToken, hOwner)).status, 200);
    assert.strictEqual((await req('GET', '/api/v1/school/recycle-bin', undefined, adminToken, hOwner)).status, 200);
    assert.strictEqual((await req('PUT', '/api/v1/school/settings', { allow_partial_payments: 1 }, adminToken, hOwner)).status, 200);
    const idorSimAdmin = await req('POST', '/api/v1/test/simulate-idor', { foreignSchoolId: schoolBId }, adminToken, hOwner);
    assert.strictEqual(idorSimAdmin.status, 403);
    assert.strictEqual(idorSimAdmin.data.error, 'CROSS_TENANT_ACCESS_DENIED');
    console.log('✓ PASS: SCHOOL_ADMIN permissions fully intact');

    // -------------------------------------------------------------------------
    // 5. BURSAR Permissions & Admin Blocking
    // -------------------------------------------------------------------------
    console.log('\n[5/9] Verifying BURSAR financial access + strict admin/academic write denial...');
    // Allowed lookups & fee workflows
    assert.strictEqual((await req('GET', '/api/v1/school/students', undefined, bursarToken, hOwner)).status, 200);
    assert.strictEqual((await req('GET', '/api/v1/school/parents', undefined, bursarToken, hOwner)).status, 200);
    const feeCatRes = await req('POST', '/api/v1/school/fee-categories', { name: `Tuition-${suffix}` }, bursarToken, hOwner);
    assert.strictEqual(feeCatRes.status, 201);
    const catId = feeCatRes.data.category.id;

    const invS1Res = await req('POST', '/api/v1/school/invoices', {
      student_id: student1Id,
      academic_session_id: sessionId,
      term_id: termId,
      due_date: '2026-04-30',
      items: [{ fee_category_id: catId, description: 'Tuition Fee', quantity: 1, unit_amount_kobo: 5000000 }],
    }, bursarToken, hOwner);
    assert.strictEqual(invS1Res.status, 201, `Bursar invoice create failed: ${JSON.stringify(invS1Res.data)}`);
    const invoice1Id = invS1Res.data.invoice.id;

    const invS2Res = await req('POST', '/api/v1/school/invoices', {
      student_id: student2Id,
      academic_session_id: sessionId,
      term_id: termId,
      due_date: '2026-04-30',
      items: [{ fee_category_id: catId, description: 'Tuition Fee', quantity: 1, unit_amount_kobo: 5000000 }],
    }, bursarToken, hOwner);
    assert.strictEqual(invS2Res.status, 201, `Bursar invoice 2 create failed: ${JSON.stringify(invS2Res.data)}`);
    const invoice2Id = invS2Res.data.invoice.id;

    // Bursar blocked from admin mutations & admin endpoints
    assert.strictEqual((await req('POST', '/api/v1/school/students', { first_name: 'Bad', last_name: 'Boy' }, bursarToken, hOwner)).status, 403);
    assert.strictEqual((await req('PUT', `/api/v1/school/students/${student1Id}`, { first_name: 'Hacked' }, bursarToken, hOwner)).status, 403);
    assert.strictEqual((await req('POST', '/api/v1/school/parents', { first_name: 'Bad', last_name: 'Dad', phone: '080111' }, bursarToken, hOwner)).status, 403);
    assert.strictEqual((await req('PUT', '/api/v1/school/settings', { allow_partial_payments: 0 }, bursarToken, hOwner)).status, 403);
    assert.strictEqual((await req('GET', '/api/v1/school/recycle-bin', undefined, bursarToken, hOwner)).status, 403);
    assert.strictEqual((await req('POST', '/api/v1/school/users/provision', { full_name: 'X', email: `x-${suffix}@rbac.edu.ng`, password: 'Password123!', role_name: 'TEACHER' }, bursarToken, hOwner)).status, 403);
    assert.strictEqual((await req('PATCH', `/api/v1/school/users/${teacherUserId}/status`, { is_active: false }, bursarToken, hOwner)).status, 403);
    assert.strictEqual((await req('DELETE', `/api/v1/school/users/${teacherUserId}`, undefined, bursarToken, hOwner)).status, 403);
    const idorSimBursar = await req('POST', '/api/v1/test/simulate-idor', { foreignSchoolId: schoolBId }, bursarToken, hOwner);
    assert.strictEqual(idorSimBursar.status, 403);
    assert.strictEqual(idorSimBursar.data.error, 'FORBIDDEN_ROLE');
    console.log('✓ PASS: BURSAR financial endpoints allowed and all admin mutations denied (403)');

    // -------------------------------------------------------------------------
    // 6. TEACHER Read-Only Educator Workspace & Fees Policy
    // -------------------------------------------------------------------------
    console.log('\n[6/9] Verifying TEACHER read-only workspace & strict mutation blocks...');
    const tDash = await req('GET', '/api/v1/portal/teacher/dashboard', undefined, teacherToken, hOwner);
    assert.strictEqual(tDash.status, 200, `Teacher dashboard failed: ${JSON.stringify(tDash.data)}`);
    assert.strictEqual(tDash.data.teacherProfile.user.id, teacherUserId);
    assert.strictEqual(tDash.data.hasAssignedClasses, true);
    assert.strictEqual(tDash.data.assignedClasses.length, 1);
    assert.ok(Array.isArray(tDash.data.students) && tDash.data.students.length >= 2);
    assert.ok(Array.isArray(tDash.data.subjects) && tDash.data.subjects.length >= 1);
    assert.ok(Array.isArray(tDash.data.announcements) && tDash.data.announcements.length >= 1);

    assert.strictEqual((await req('GET', '/api/v1/school/examinations', undefined, teacherToken, hOwner)).status, 200);
    assert.strictEqual((await req('GET', '/api/v1/school/attendance', undefined, teacherToken, hOwner)).status, 200);
    assert.strictEqual((await req('GET', '/api/v1/school/behaviour', undefined, teacherToken, hOwner)).status, 200);

    // Teacher blocked from ALL mutations & admin routes
    assert.strictEqual((await req('POST', '/api/v1/school/students', { first_name: 'Hack', last_name: 'Stu' }, teacherToken, hOwner)).status, 403);
    assert.strictEqual((await req('POST', '/api/v1/school/examinations', { title: 'Fake Exam' }, teacherToken, hOwner)).status, 403);
    assert.strictEqual((await req('PUT', `/api/v1/school/examinations/${examId}/scores`, { entries: [] }, teacherToken, hOwner)).status, 403);
    assert.strictEqual((await req('POST', '/api/v1/school/attendance/bulk', { attendance_date: '2026-02-11', records: [] }, teacherToken, hOwner)).status, 403);
    assert.strictEqual((await req('POST', '/api/v1/school/behaviour', { student_id: student1Id, category: 'DISCIPLINE', title: 'X', description: 'Y' }, teacherToken, hOwner)).status, 403);
    assert.strictEqual((await req('POST', '/api/v1/school/announcements', { title: 'Hack', content: 'No', audience: 'ALL' }, teacherToken, hOwner)).status, 403);
    assert.strictEqual((await req('POST', `/api/v1/school/invoices/${invoice1Id}/payments`, { amount_kobo: 100000, payment_method: 'CASH' }, teacherToken, hOwner)).status, 403);
    assert.strictEqual((await req('GET', '/api/v1/school/users', undefined, teacherToken, hOwner)).status, 403);
    assert.strictEqual((await req('GET', '/api/v1/school/recycle-bin', undefined, teacherToken, hOwner)).status, 403);

    // Conditional teachers_can_view_fees policy
    assert.strictEqual((await req('GET', '/api/v1/school/invoices', undefined, teacherToken, hOwner)).status, 403);
    const updTchFee = await req('PUT', '/api/v1/school/performance/settings', { teachers_can_view_fees: true }, adminToken, hOwner);
    assert.strictEqual(updTchFee.status, 200, `Update teacher fee setting failed: ${JSON.stringify(updTchFee.data)}`);
    assert.strictEqual((await req('GET', '/api/v1/school/invoices', undefined, teacherToken, hOwner)).status, 200);
    assert.strictEqual((await req('POST', '/api/v1/school/invoices', { student_id: student1Id, items: [] }, teacherToken, hOwner)).status, 403);
    console.log('✓ PASS: TEACHER workspace is strictly read-only and honors teachers_can_view_fees policy');

    // -------------------------------------------------------------------------
    // 7. PARENT Portal Isolation & Authorized Online Checkout
    // -------------------------------------------------------------------------
    console.log('\n[7/9] Verifying PARENT child-level isolation & authorized online checkout...');
    const pDash = await req('GET', '/api/v1/portal/parent/dashboard', undefined, parentToken, hOwner);
    assert.strictEqual(pDash.status, 200, `Parent dashboard failed: ${JSON.stringify(pDash.data)}`);
    assert.strictEqual(pDash.data.children.length, 1);
    assert.strictEqual(pDash.data.children[0].id, student1Id);
    assert.ok(Array.isArray(pDash.data.sessions) && pDash.data.sessions.length >= 1, 'Parent dashboard returns sessions');
    assert.ok(pDash.data.parentProfile, 'Parent dashboard returns parentProfile');
    assert.strictEqual(pDash.data.results.length, 1);
    assert.strictEqual(pDash.data.reportCards.length, 1);
    assert.strictEqual(pDash.data.invoices.length, 1);

    // Cross-child blocking (Student 2 is unlinked)
    assert.strictEqual((await req('GET', `/api/v1/portal/parent/dashboard?student_id=${student2Id}`, undefined, parentToken, hOwner)).status, 403);
    // Staff/Admin endpoints blocked for parent
    assert.strictEqual((await req('GET', '/api/v1/school/students', undefined, parentToken, hOwner)).status, 403);
    assert.strictEqual((await req('GET', '/api/v1/school/academic-sessions', undefined, parentToken, hOwner)).status, 403);
    assert.strictEqual((await req('GET', '/api/v1/portal/teacher/dashboard', undefined, parentToken, hOwner)).status, 403);
    assert.strictEqual((await req('POST', `/api/v1/school/invoices/${invoice1Id}/payments`, { amount_kobo: 100000, payment_method: 'CASH' }, parentToken, hOwner)).status, 403);

    // Online checkout allowed on linked Student 1 invoice, blocked on Student 2 invoice
    assert.strictEqual((await req('POST', `/api/v1/school/invoices/${invoice2Id}/checkout`, { provider: 'TEST_SANDBOX', amount_kobo: 100000 }, parentToken, hOwner)).status, 403);
    const pCheckout = await req('POST', `/api/v1/school/invoices/${invoice1Id}/checkout`, {
      provider: 'TEST_SANDBOX',
      amount_kobo: 2000000,
      email: `parent-${suffix}@rbac.edu.ng`,
    }, parentToken, hOwner);
    assert.strictEqual(pCheckout.status, 200, `Parent online checkout failed: ${JSON.stringify(pCheckout.data)}`);
    const pVerify = await req('POST', '/api/v1/school/payments/verify-online', {
      provider: 'TEST_SANDBOX',
      reference: pCheckout.data.providerReference,
      invoice_id: invoice1Id,
      amount_kobo: 2000000,
    }, parentToken, hOwner);
    assert.strictEqual(pVerify.status, 200, `Parent online verify failed: ${JSON.stringify(pVerify.data)}`);
    console.log('✓ PASS: PARENT sees only verified child, is blocked from staff routes, and pays child invoice online');

    // -------------------------------------------------------------------------
    // 8. STUDENT Portal Isolation & Fee Visibility Policy
    // -------------------------------------------------------------------------
    console.log('\n[8/9] Verifying STUDENT self-only isolation & students_can_view_fees toggle...');
    const hideStuFee = await req('PUT', '/api/v1/school/performance/settings', { students_can_view_fees: false }, adminToken, hOwner);
    assert.strictEqual(hideStuFee.status, 200);
    const stDash1 = await req('GET', '/api/v1/portal/student/dashboard', undefined, studentToken, hOwner);
    assert.strictEqual(stDash1.status, 200);
    assert.strictEqual(stDash1.data.student.id, student1Id);
    assert.strictEqual(stDash1.data.feesVisible, false);
    assert.strictEqual(stDash1.data.invoices.length, 0);
    assert.ok(Array.isArray(stDash1.data.sessions) && stDash1.data.sessions.length >= 1, 'Student dashboard returns sessions');

    const updStuFee = await req('PUT', '/api/v1/school/performance/settings', { students_can_view_fees: true }, adminToken, hOwner);
    assert.strictEqual(updStuFee.status, 200, `Update student fee setting failed: ${JSON.stringify(updStuFee.data)}`);
    const stDash2 = await req('GET', '/api/v1/portal/student/dashboard', undefined, studentToken, hOwner);
    assert.strictEqual(stDash2.status, 200);
    assert.strictEqual(stDash2.data.feesVisible, true);
    assert.strictEqual(stDash2.data.invoices.length, 1);

    // Student blocked from peer student, parent portal, teacher portal, admin endpoints, and checkout
    assert.strictEqual((await req('GET', `/api/v1/portal/student/dashboard?student_id=${student2Id}`, undefined, studentToken, hOwner)).status, 403);
    assert.strictEqual((await req('GET', '/api/v1/portal/parent/dashboard', undefined, studentToken, hOwner)).status, 403);
    assert.strictEqual((await req('GET', '/api/v1/portal/teacher/dashboard', undefined, studentToken, hOwner)).status, 403);
    assert.strictEqual((await req('GET', '/api/v1/school/students', undefined, studentToken, hOwner)).status, 403);
    assert.strictEqual((await req('GET', '/api/v1/school/academic-sessions', undefined, studentToken, hOwner)).status, 403);
    assert.strictEqual((await req('POST', `/api/v1/school/invoices/${invoice1Id}/checkout`, { provider: 'TEST_SANDBOX', amount_kobo: 100000 }, studentToken, hOwner)).status, 403);
    console.log('✓ PASS: STUDENT self-only isolation & fee visibility verified');

    // -------------------------------------------------------------------------
    // 9. User Activation / Deactivation & Cross-Tenant Guard
    // -------------------------------------------------------------------------
    console.log('\n[9/9] Verifying User Deactivation/Reactivation & Cross-Tenant Isolation...');
    const deactRes = await req('PATCH', `/api/v1/school/users/${teacherUserId}/status`, { is_active: false }, adminToken, hOwner);
    assert.strictEqual(deactRes.status, 200);
    assert.strictEqual(deactRes.data.is_active, 0);

    // Old teacher session immediately invalidated
    assert.strictEqual((await req('GET', '/api/v1/portal/teacher/dashboard', undefined, teacherToken, hOwner)).status, 401);
    // Deactivated teacher cannot log back in
    const blockedLogin = await req('POST', '/api/v1/auth/login', { email: `teacher-${suffix}@rbac.edu.ng`, password: 'RolePassword2026!' });
    assert.ok(blockedLogin.status === 401 || blockedLogin.status === 403, `Expected 401/403 for deactivated login, got ${blockedLogin.status}`);

    // Reactivate teacher
    const reactRes = await req('PATCH', `/api/v1/school/users/${teacherUserId}/status`, { is_active: true }, adminToken, hOwner);
    assert.strictEqual(reactRes.status, 200);
    assert.strictEqual(reactRes.data.is_active, 1);

    const reactLogin = await req('POST', '/api/v1/auth/login', { email: `teacher-${suffix}@rbac.edu.ng`, password: 'RolePassword2026!' });
    assert.strictEqual(reactLogin.status, 200);

    // Owner cannot deactivate self
    assert.strictEqual((await req('PATCH', `/api/v1/school/users/${regA.data.user.id}/status`, { is_active: false }, ownerAToken, hOwner)).status, 400);

    // Cross-tenant header rejected
    const crossRes = await req('GET', '/api/v1/school/students', undefined, ownerBToken, { 'X-School-Id': schoolAId });
    assert.strictEqual(crossRes.status, 403);
    assert.strictEqual(crossRes.data.error, 'CROSS_TENANT_ACCESS_DENIED');
    console.log('✓ PASS: User deactivation/reactivation, self-protection & cross-tenant IDOR barrier verified');

    console.log('\n===============================================================');
    console.log('   ALL RBAC, ROLE PORTAL & RECORD MANAGEMENT TESTS PASSED (9/9) ');
    console.log('===============================================================');
  } finally {
    await cleanupTestData(createdSchools, createdUsers);
    server.close();
  }
}

runTests().catch((err) => {
  console.error('[RBAC E2E TEST FAILED]', err);
  process.exit(1);
});
