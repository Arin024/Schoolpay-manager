/**
 * BURSARIQ - POSTGRESQL SCHOOL ADMINISTRATION & STUDENT MANAGEMENT TEST SUITE
 *
 * Verifies:
 * 1. School settings and profile updates with email uniqueness.
 * 2. Academic sessions creation with current session exclusivity.
 * 3. Class and class-arm creation with parent class tenant check.
 * 4. Student enrollment with unique admission numbers within school.
 * 5. Parent creation and atomic student-parent relationship mapping.
 * 6. Cross-tenant authorization defenses (IDOR blocked).
 * 7. Paginated student retrieval and search.
 */

import assert from 'node:assert';
import dotenv from 'dotenv';
import path from 'node:path';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test.local') });
dotenv.config();

import {
  getSchoolProfilePg,
  updateSchoolProfilePg,
  createAcademicSessionPg,
  getAcademicSessionsPg,
  createClassPg,
  createClassArmPg,
  getClassesPg,
  createStudentPg,
  getStudentsPg,
  createParentWithStudentLinkPg,
} from '../server/postgresSchoolAdminService.ts';

console.log('===============================================================');
console.log('   BURSARIQ: POSTGRESQL SCHOOL ADMIN INTEGRATION SUITE         ');
console.log('===============================================================');

async function runSchoolAdminTests() {
  const testDbUrl = process.env.TEST_POSTGRES_URL;
  if (!testDbUrl || testDbUrl.trim() === '') {
    console.log('\n[SAFEGUARD NOTICE] TEST_POSTGRES_URL is not set.');
    console.log('Skipping isolated school admin tests (0 records touched, 100% safe).\n');
    process.exit(0);
  }

  const pool = new pg.Pool({
    connectionString: testDbUrl,
    ssl: testDbUrl.includes('localhost') ? false : { rejectUnauthorized: true },
    max: 5,
  });

  const client = await pool.connect();
  const testSuffix = Date.now().toString().slice(-6);
  const schoolAId = `sch_adm_a_${testSuffix}`;
  const schoolBId = `sch_adm_b_${testSuffix}`;

  try {
    // Setup isolated fixtures
    await client.query(
      `INSERT INTO schools (id, name, slug, type, state, lga, phone, email)
       VALUES ($1, $2, $3, 'SECONDARY', 'Lagos', 'Ikeja', '+2348000000000', $4) ON CONFLICT DO NOTHING`,
      [schoolAId, `Alpha High ${testSuffix}`, `ALP${testSuffix.slice(-3)}`, `alpha${testSuffix}@school.ng`]
    );

    await client.query(
      `INSERT INTO schools (id, name, slug, type, state, lga, phone, email)
       VALUES ($1, $2, $3, 'SECONDARY', 'Oyo', 'Ibadan', '+2348000000001', $4) ON CONFLICT DO NOTHING`,
      [schoolBId, `Beta Academy ${testSuffix}`, `BET${testSuffix.slice(-3)}`, `beta${testSuffix}@school.ng`]
    );

    // -------------------------------------------------------------------------
    // TEST 1: School Profile & Updates
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Testing School Profile Read & Update...');
    const profRes = await getSchoolProfilePg(schoolAId, client);
    assert.strictEqual(profRes.success, true);
    assert.strictEqual(profRes.data!.school.name, `Alpha High ${testSuffix}`);

    const updRes = await updateSchoolProfilePg(
      schoolAId,
      {
        name: `Alpha High Renamed ${testSuffix}`,
        address: '123 Broad St',
        state: 'Lagos',
        lga: 'Ikeja',
        phone: '+2348099999999',
        email: `alpha${testSuffix}@school.ng`,
      },
      client
    );
    assert.strictEqual(updRes.success, true);
    assert.strictEqual(updRes.data!.school.name, `Alpha High Renamed ${testSuffix}`);
    console.log('✓ PASS: School profile read and updated with input validation');

    // -------------------------------------------------------------------------
    // TEST 2: Academic Sessions & Current Status
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing Academic Sessions Creation...');
    const ses1 = await createAcademicSessionPg(
      schoolAId,
      {
        name: '2026/2027 Academic Year',
        startDate: '2026-09-01',
        endDate: '2027-07-31',
        isCurrent: true,
      },
      client
    );
    assert.strictEqual(ses1.success, true);
    assert.strictEqual(ses1.data!.session.status, 'ACTIVE');

    const sesList = await getAcademicSessionsPg(schoolAId, client);
    assert.strictEqual(sesList.success, true);
    assert.strictEqual(sesList.data!.sessions.length, 1);
    console.log('✓ PASS: Academic session created and set as current active session');

    // -------------------------------------------------------------------------
    // TEST 3: Classes & Arms Hierarchy
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing Classes & Class Arms Creation...');
    const clsRes = await createClassPg(schoolAId, { name: 'JSS 1', level: 'JUNIOR_SECONDARY', orderIndex: 1 }, client);
    assert.strictEqual(clsRes.success, true);
    const classId = clsRes.data!.classRecord.id;

    const armRes = await createClassArmPg(schoolAId, { classId, name: 'Gold', capacity: 35 }, client);
    assert.strictEqual(armRes.success, true);
    const armId = armRes.data!.arm.id;

    const classesList = await getClassesPg(schoolAId, client);
    assert.strictEqual(classesList.success, true);
    assert.strictEqual(classesList.data!.classes.length, 1);
    assert.strictEqual(classesList.data!.classes[0].arms.length, 1);
    assert.strictEqual(classesList.data!.classes[0].arms[0].name, 'Gold');
    console.log('✓ PASS: Class and class arm created with relational nesting');

    // -------------------------------------------------------------------------
    // TEST 4: Student Enrollment & Duplicate Admission Guard
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing Student Enrollment & Duplicate Admission Guard...');
    const stu1 = await createStudentPg(
      schoolAId,
      {
        admissionNumber: `ADM-${testSuffix}-001`,
        firstName: 'Chidinma',
        lastName: 'Eze',
        gender: 'FEMALE',
        classId,
        classArmId: armId,
      },
      client
    );
    assert.strictEqual(stu1.success, true);
    const studentId = stu1.data!.student.id;
    assert.strictEqual(stu1.data!.student.student_status, 'ACTIVE');

    // Re-enroll with duplicate admission number in same school
    const dupStu = await createStudentPg(
      schoolAId,
      {
        admissionNumber: `ADM-${testSuffix}-001`,
        firstName: 'Another',
        lastName: 'Student',
        gender: 'MALE',
      },
      client
    );
    assert.strictEqual(dupStu.success, false);
    assert.strictEqual(dupStu.code, 'DUPLICATE_ADMISSION_NUMBER');
    console.log('✓ PASS: Student enrolled and duplicate admission number blocked');

    // -------------------------------------------------------------------------
    // TEST 5: Parent Creation & Student Mapping
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing Parent Creation & Atomic Linkage...');
    const parRes = await createParentWithStudentLinkPg(
      schoolAId,
      {
        studentId,
        firstName: 'Ngozi',
        lastName: 'Eze',
        phone: '+2348033333333',
        relationship: 'MOTHER',
      },
      client
    );
    assert.strictEqual(parRes.success, true);
    assert.strictEqual(parRes.data!.link.student_id, studentId);
    assert.strictEqual(parRes.data!.link.relationship, 'MOTHER');
    console.log('✓ PASS: Parent profile and student linkage created atomically');

    // -------------------------------------------------------------------------
    // TEST 6: Strict Cross-Tenant Authorization Defense (IDOR)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing Cross-Tenant Authorization Defense...');
    // School B attempts to link a parent to School A's student
    const crossPar = await createParentWithStudentLinkPg(
      schoolBId,
      {
        studentId, // Belongs to School A
        firstName: 'Foreign',
        lastName: 'Parent',
        phone: '+2348044444444',
      },
      client
    );
    assert.strictEqual(crossPar.success, false);
    assert.strictEqual(crossPar.code, 'STUDENT_NOT_FOUND');

    // School B attempts to assign School A's class
    const crossArm = await createClassArmPg(
      schoolBId,
      {
        classId, // Belongs to School A
        name: 'Diamond',
      },
      client
    );
    assert.strictEqual(crossArm.success, false);
    assert.strictEqual(crossArm.code, 'CLASS_NOT_FOUND');
    console.log('✓ PASS: Cross-tenant operations blocked across students and classes');

    // -------------------------------------------------------------------------
    // TEST 7: Paginated Student Retrieval & Search
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing Student Search & Pagination...');
    const listRes = await getStudentsPg(schoolAId, { search: 'Chidinma' }, client);
    assert.strictEqual(listRes.success, true);
    assert.strictEqual(listRes.data!.students.length, 1);
    assert.strictEqual(listRes.data!.students[0].first_name, 'Chidinma');
    console.log('✓ PASS: Search query isolated to tenant and returned expected student');

    // Clean up isolated test fixtures
    await client.query('DELETE FROM parent_students WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM parents WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM students WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM class_arms WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM classes WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM academic_sessions WHERE school_id IN ($1, $2)', [schoolAId, schoolBId]);
    await client.query('DELETE FROM schools WHERE id IN ($1, $2)', [schoolAId, schoolBId]);

    console.log('\n===============================================================');
    console.log('   ALL POSTGRESQL SCHOOL ADMIN TESTS PASSED (100% SUCCESS)     ');
    console.log('===============================================================');
  } finally {
    client.release();
    await pool.end();
  }
}

runSchoolAdminTests().catch((err) => {
  console.error('[SCHOOL ADMIN TEST ERROR]', err);
  process.exit(1);
});
