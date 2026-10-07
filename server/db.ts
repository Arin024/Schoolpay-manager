import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Ensure data directory exists
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'schoolpay.db');
export const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys for high SQLite concurrency and integrity
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDatabase() {
  // Run dynamic schema column migrations FIRST for existing SQLite databases before indexes are created
  migrateStep2Columns();

  // Read and execute schema.sql
  const schemaPath = path.resolve(process.cwd(), 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }

  // Run dynamic schema column migrations again to ensure newly created tables are fully reconciled
  migrateStep2Columns();

  // Ensure base schools, users, and roles always exist
  seedInitialData();

  // Ensure Step 2 modules (academic sessions, terms, classes, arms, staff, parents, students) are seeded
  seedStep2SchoolManagement();

  // Ensure Step 3 financial modules (categories, structures, invoices, payments, discounts) are seeded
  seedStep3FinancialManagement();
}

function migrateStep2Columns() {
  // Ensure students table has all required enterprise fields if it exists
  const studentTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get();
  if (studentTableExists) {
    const studentCols = db.prepare('PRAGMA table_info(students)').all().map((c: any) => c.name);
    const requiredStudentCols: Record<string, string> = {
      first_name: "TEXT DEFAULT ''",
      middle_name: "TEXT DEFAULT ''",
      last_name: "TEXT DEFAULT ''",
      date_of_birth: "TEXT",
      phone: "TEXT",
      email: "TEXT",
      address: "TEXT",
      state: "TEXT",
      nationality: "TEXT DEFAULT 'Nigerian'",
      admission_date: "TEXT",
      student_status: "TEXT DEFAULT 'ACTIVE'",
      class_arm_id: "TEXT",
      class_arm_name: "TEXT",
      academic_session_id: "TEXT",
      profile_photo_url: "TEXT",
      emergency_contact: "TEXT",
      medical_notes: "TEXT",
      updated_at: "DATETIME DEFAULT CURRENT_TIMESTAMP",
    };

    for (const [col, colType] of Object.entries(requiredStudentCols)) {
      if (!studentCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE students ADD COLUMN ${col} ${colType};`);
        } catch (e) {
          // column may already exist
        }
      }
    }

    // Sync status and names for legacy rows
    try {
      db.exec(`
        UPDATE students 
        SET student_status = status 
        WHERE (student_status IS NULL OR student_status = '') AND status IS NOT NULL;
      `);
    } catch (e) {}
  }

  // Ensure classes table has description and academic_session_id
  const classTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='classes'").get();
  if (classTableExists) {
    const classCols = db.prepare('PRAGMA table_info(classes)').all().map((c: any) => c.name);
    if (!classCols.includes('description')) {
      try { db.exec('ALTER TABLE classes ADD COLUMN description TEXT;'); } catch (e) {}
    }
    if (!classCols.includes('academic_session_id')) {
      try { db.exec('ALTER TABLE classes ADD COLUMN academic_session_id TEXT;'); } catch (e) {}
    }
    if (!classCols.includes('updated_at')) {
      try { db.exec('ALTER TABLE classes ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;'); } catch (e) {}
    }
  }
}

function seedStep2SchoolManagement() {
  const schoolAId = 'sch_lagos_premier_01';
  const schoolBId = 'sch_abuja_horizon_02';

  // 1. Academic Sessions & Terms for School A
  db.prepare(`
    INSERT OR IGNORE INTO academic_sessions (id, school_id, name, start_date, end_date, status) VALUES
    ('ses_a_2024', ?, '2024/2025', '2024-09-09', '2025-07-25', 'ACTIVE'),
    ('ses_a_2025', ?, '2025/2026', '2025-09-08', '2026-07-24', 'UPCOMING')
  `).run(schoolAId, schoolAId);

  db.prepare(`
    INSERT OR IGNORE INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status) VALUES
    ('trm_a_1', ?, 'ses_a_2024', '1st Term', '2024-09-09', '2024-12-13', 'ACTIVE'),
    ('trm_a_2', ?, 'ses_a_2024', '2nd Term', '2025-01-06', '2025-04-11', 'UPCOMING'),
    ('trm_a_3', ?, 'ses_a_2024', '3rd Term', '2025-04-28', '2025-07-25', 'UPCOMING')
  `).run(schoolAId, schoolAId, schoolAId);

  // 2. Classes for School A
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level, description, academic_session_id) VALUES
    ('cls_a_ss2', ?, 'SSS 2', 'Senior Secondary', 'Senior Secondary School Level 2', 'ses_a_2024'),
    ('cls_a_ss1', ?, 'SSS 1', 'Senior Secondary', 'Senior Secondary School Level 1', 'ses_a_2024'),
    ('cls_a_jss1', ?, 'JSS 1', 'Junior Secondary', 'Junior Secondary School Level 1', 'ses_a_2024')
  `).run(schoolAId, schoolAId, schoolAId);

  // 3. Staff for School A
  db.prepare(`
    INSERT OR IGNORE INTO staff (id, school_id, staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined) VALUES
    ('stf_a_01', ?, 'LPC/STF/001', 'Emmanuel', 'Chukwuma', 'Okafor', 'principal@lagospremier.edu.ng', '+2348021112233', 'Male', 'Principal / Academic Director', 'Administration', 'ACTIVE', '2021-08-15'),
    ('stf_a_02', ?, 'LPC/STF/002', 'Titilayo', 'Bolanle', 'Adeleke', 'maths.adeleke@lagospremier.edu.ng', '+2348034445566', 'Female', 'Senior Mathematics Teacher', 'Sciences', 'ACTIVE', '2022-01-10'),
    ('stf_a_03', ?, 'LPC/STF/003', 'Babatunde', 'Segun', 'Ogundipe', 'bursar@lagospremier.edu.ng', '+2348057778899', 'Male', 'School Bursar & Accountant', 'Bursary', 'ACTIVE', '2020-09-01')
  `).run(schoolAId, schoolAId, schoolAId);

  // 4. Class Arms for School A
  db.prepare(`
    INSERT OR IGNORE INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id) VALUES
    ('arm_a_ss2_gold', ?, 'cls_a_ss2', 'Gold', 40, 'stf_a_02'),
    ('arm_a_ss2_silver', ?, 'cls_a_ss2', 'Silver', 40, NULL),
    ('arm_a_ss1_sci', ?, 'cls_a_ss1', 'Science', 35, 'stf_a_02')
  `).run(schoolAId, schoolAId, schoolAId);

  // 5. Parents for School A
  db.prepare(`
    INSERT OR IGNORE INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact) VALUES
    ('par_a_01', ?, 'Olawale', 'Adebayo', '+2348031110001', 'adebayo.parent@gmail.com', '12 Admiralty Way, Lekki Phase 1, Lagos', 'Civil Engineer', 'Father', '+2348031110001'),
    ('par_a_02', ?, 'Ngozi', 'Okonkwo', '+2348031110002', 'chioma.parent@gmail.com', '45 Glover Road, Ikoyi, Lagos', 'Chartered Accountant', 'Mother', '+2348031110002')
  `).run(schoolAId, schoolAId);

  // 6. Students for School A (Full enterprise schema)
  db.prepare(`
    INSERT OR IGNORE INTO students (
      id, school_id, admission_number, first_name, middle_name, last_name, full_name, gender,
      date_of_birth, phone, email, address, state, nationality, admission_date, student_status,
      class_id, class_arm_id, class_name, class_arm_name, academic_session_id, emergency_contact
    ) VALUES
    (
      'stu_a1_01', ?, 'LPC/2024/001', 'Adebayo', 'Femi', 'Olawale', 'Adebayo Olawale', 'Male',
      '2008-05-14', '+2348031110001', 'adebayo.olawale@student.lpc.edu.ng', '12 Admiralty Way, Lekki', 'Lagos', 'Nigerian',
      '2022-09-12', 'ACTIVE', 'cls_a_ss2', 'arm_a_ss2_gold', 'SSS 2', 'Gold', 'ses_a_2024', 'Mr. Olawale (+2348031110001)'
    ),
    (
      'stu_a2_02', ?, 'LPC/2024/002', 'Chioma', 'Grace', 'Okonkwo', 'Chioma Okonkwo', 'Female',
      '2009-08-22', '+2348031110002', 'chioma.okonkwo@student.lpc.edu.ng', '45 Glover Road, Ikoyi', 'Anambra', 'Nigerian',
      '2023-09-11', 'ACTIVE', 'cls_a_ss1', 'arm_a_ss1_sci', 'SSS 1', 'Science', 'ses_a_2024', 'Mrs. Ngozi (+2348031110002)'
    )
  `).run(schoolAId, schoolAId);

  // Reconcile pre-existing School A student rows from Step 1
  db.prepare(`
    UPDATE students SET
      first_name = 'Adebayo', last_name = 'Olawale', middle_name = 'Femi',
      class_id = 'cls_a_ss2', class_arm_id = 'arm_a_ss2_gold', class_name = 'SSS 2', class_arm_name = 'Gold',
      academic_session_id = 'ses_a_2024', student_status = 'ACTIVE'
    WHERE id = 'stu_a1_01';
  `).run();

  db.prepare(`
    UPDATE students SET
      first_name = 'Chioma', last_name = 'Okonkwo', middle_name = 'Grace',
      class_id = 'cls_a_ss1', class_arm_id = 'arm_a_ss1_sci', class_name = 'SSS 1', class_arm_name = 'Science',
      academic_session_id = 'ses_a_2024', student_status = 'ACTIVE'
    WHERE id = 'stu_a2_02';
  `).run();

  // 7. Parent-Student Links for School A
  db.prepare(`
    INSERT OR IGNORE INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact) VALUES
    ('ps_a_01', ?, 'par_a_01', 'stu_a1_01', 'Father', 1),
    ('ps_a_02', ?, 'par_a_02', 'stu_a2_02', 'Mother', 1)
  `).run(schoolAId, schoolAId);

  // 8. Academic Sessions & Terms for School B
  db.prepare(`
    INSERT OR IGNORE INTO academic_sessions (id, school_id, name, start_date, end_date, status) VALUES
    ('ses_b_2024', ?, '2024/2025', '2024-09-16', '2025-07-18', 'ACTIVE')
  `).run(schoolBId);

  db.prepare(`
    INSERT OR IGNORE INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status) VALUES
    ('trm_b_1', ?, 'ses_b_2024', '1st Term', '2024-09-16', '2024-12-18', 'ACTIVE')
  `).run(schoolBId);

  // 9. Classes for School B
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level, description, academic_session_id) VALUES
    ('cls_b_jss3', ?, 'JSS 3', 'Junior Secondary', 'Junior Secondary School Level 3', 'ses_b_2024'),
    ('cls_b_jss2', ?, 'JSS 2', 'Junior Secondary', 'Junior Secondary School Level 2', 'ses_b_2024')
  `).run(schoolBId, schoolBId);

  // 10. Staff for School B
  db.prepare(`
    INSERT OR IGNORE INTO staff (id, school_id, staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined) VALUES
    ('stf_b_01', ?, 'AHA/STF/001', 'Usman', 'Aliyu', 'Danjuma', 'viceprincipal@abujahorizon.sch.ng', '+2348065551122', 'Male', 'Vice Principal (Academics)', 'Administration', 'ACTIVE', '2021-10-01'),
    ('stf_b_02', ?, 'AHA/STF/002', 'Grace', 'Onyinye', 'Danladi', 'grace.danladi@abujahorizon.sch.ng', '+2348078889900', 'Female', 'English & Literature Educator', 'Arts', 'ACTIVE', '2022-03-15')
  `).run(schoolBId, schoolBId);

  // 11. Class Arms for School B
  db.prepare(`
    INSERT OR IGNORE INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id) VALUES
    ('arm_b_jss3_em', ?, 'cls_b_jss3', 'Emerald', 35, 'stf_b_01'),
    ('arm_b_jss2_dia', ?, 'cls_b_jss2', 'Diamond', 35, 'stf_b_02')
  `).run(schoolBId, schoolBId);

  // 12. Parents for School B
  db.prepare(`
    INSERT OR IGNORE INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact) VALUES
    ('par_b_01', ?, 'Amina', 'Bello', '+2348098887701', 'amina.bello@horizon.sch.ng', 'Plot 402 Shehu Shagari Way, Maitama, Abuja', 'Medical Practitioner', 'Mother', '+2348098887701'),
    ('par_b_02', ?, 'Paul', 'Eze', '+2348098887702', 'eze.paul@yahoo.com', '15 Gana Street, Maitama, Abuja', 'Petroleum Engineer', 'Father', '+2348098887702')
  `).run(schoolBId, schoolBId);

  // 13. Students for School B (Full enterprise schema)
  db.prepare(`
    INSERT OR IGNORE INTO students (
      id, school_id, admission_number, first_name, middle_name, last_name, full_name, gender,
      date_of_birth, phone, email, address, state, nationality, admission_date, student_status,
      class_id, class_arm_id, class_name, class_arm_name, academic_session_id, emergency_contact
    ) VALUES
    (
      'stu_b1_01', ?, 'AHA/2024/101', 'Zainab', 'Fatima', 'Bello', 'Zainab Bello', 'Female',
      '2010-02-18', '+2348098887701', 'zainab.bello@student.horizon.sch.ng', 'Maitama, Abuja', 'FCT - Abuja', 'Nigerian',
      '2022-09-18', 'ACTIVE', 'cls_b_jss3', 'arm_b_jss3_em', 'JSS 3', 'Emerald', 'ses_b_2024', 'Dr. Amina (+2348098887701)'
    ),
    (
      'stu_b2_02', ?, 'AHA/2024/102', 'Emeka', 'Chinedu', 'Eze', 'Emeka Eze', 'Male',
      '2011-09-05', '+2348098887702', 'emeka.eze@student.horizon.sch.ng', 'Maitama, Abuja', 'Enugu', 'Nigerian',
      '2023-09-15', 'ACTIVE', 'cls_b_jss2', 'arm_b_jss2_dia', 'JSS 2', 'Diamond', 'ses_b_2024', 'Engr. Paul (+2348098887702)'
    )
  `).run(schoolBId, schoolBId);

  // Reconcile pre-existing School B student rows from Step 1
  db.prepare(`
    UPDATE students SET
      first_name = 'Zainab', last_name = 'Bello', middle_name = 'Fatima',
      class_id = 'cls_b_jss3', class_arm_id = 'arm_b_jss3_em', class_name = 'JSS 3', class_arm_name = 'Emerald',
      academic_session_id = 'ses_b_2024', student_status = 'ACTIVE'
    WHERE id = 'stu_b1_01';
  `).run();

  db.prepare(`
    UPDATE students SET
      first_name = 'Emeka', last_name = 'Eze', middle_name = 'Chinedu',
      class_id = 'cls_b_jss2', class_arm_id = 'arm_b_jss2_dia', class_name = 'JSS 2', class_arm_name = 'Diamond',
      academic_session_id = 'ses_b_2024', student_status = 'ACTIVE'
    WHERE id = 'stu_b2_02';
  `).run();

  // 14. Parent-Student Links for School B
  db.prepare(`
    INSERT OR IGNORE INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact) VALUES
    ('ps_b_01', ?, 'par_b_01', 'stu_b1_01', 'Mother', 1),
    ('ps_b_02', ?, 'par_b_02', 'stu_b2_02', 'Father', 1)
  `).run(schoolBId, schoolBId);
}

function hashPasswordHelper(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function seedInitialData() {
  console.log('[Database] Seeding initial Super Admin and demo Nigerian school tenants...');

  // 1. Seed Super Admin (Platform level, no school_id)
  const superAdminId = 'usr_super_admin_01';
  const saSalt = crypto.randomBytes(16).toString('hex');
  const saHash = hashPasswordHelper('SuperAdmin@2025!', saSalt);

  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1)
  `).run(superAdminId, 'superadmin@schoolpay.ng', saHash, saSalt, 'Alhaji Ibrahim Danladi (Super Admin)', '+2348030000001');

  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, NULL, 'role_super_admin', 1)
  `).run('ur_sa_01', superAdminId);

  // 2. Demo School A: Lagos Premier College (Ikeja, Lagos)
  const schoolAId = 'sch_lagos_premier_01';
  db.prepare(`
    INSERT OR IGNORE INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolAId,
    'Lagos Premier College',
    'lagos-premier-college',
    'Secondary',
    'ACTIVE',
    '14 Allen Avenue, Ikeja',
    'Lagos',
    'Ikeja',
    '+2348021112233',
    'info@lagospremier.edu.ng',
    'https://lagospremier.edu.ng'
  );

  db.prepare(`
    INSERT OR IGNORE INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email, payment_notification_sms, portal_subdomain)
    VALUES (?, ?, 'NGN', '₦', '2024/2025', '1st Term', 'bursary@lagospremier.edu.ng', 1, 'lagospremier')
  `).run('set_lagos_01', schoolAId);

  // Owner for School A
  const ownerAId = 'usr_owner_lagos_01';
  const ownerASalt = crypto.randomBytes(16).toString('hex');
  const ownerAHash = hashPasswordHelper('OwnerLagos@2025!', ownerASalt);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(ownerAId, 'proprietor@lagospremier.edu.ng', ownerAHash, ownerASalt, 'Chief Mrs. Folashade Adeleke', '+2348031234567');

  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, ?, 'role_school_owner', 1)
  `).run('ur_lagos_owner_01', ownerAId, schoolAId);

  // Bursar for School A
  const bursarAId = 'usr_bursar_lagos_01';
  const bursarASalt = crypto.randomBytes(16).toString('hex');
  const bursarAHash = hashPasswordHelper('BursarLagos@2025!', bursarASalt);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(bursarAId, 'bursar@lagospremier.edu.ng', bursarAHash, bursarASalt, 'Mr. Babatunde Ogundipe (Bursar)', '+2348057778899');

  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, ?, 'role_bursar', 1)
  `).run('ur_lagos_bursar_01', bursarAId, schoolAId);

  // Seed School A Classes, Students, and Fees
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level) VALUES
    ('cls_a1', ?, 'SS 2 Gold', 'Senior Secondary 2'),
    ('cls_a2', ?, 'SS 1 Silver', 'Senior Secondary 1')
  `).run(schoolAId, schoolAId);

  db.prepare(`
    INSERT OR IGNORE INTO students (id, school_id, admission_number, first_name, last_name, full_name, gender, class_name, student_status) VALUES
    ('stu_a1_01', ?, 'LPC/2024/001', 'Adebayo', 'Olawale', 'Adebayo Olawale', 'Male', 'SS 2 Gold', 'ACTIVE'),
    ('stu_a2_02', ?, 'LPC/2024/002', 'Chioma', 'Okonkwo', 'Chioma Okonkwo', 'Female', 'SS 1 Silver', 'ACTIVE')
  `).run(schoolAId, schoolAId);

  db.prepare(`
    INSERT OR IGNORE INTO fees (id, school_id, name, amount, session, term, description) VALUES
    ('fee_a1', ?, 'Tuition & Academic Levy - 1st Term', 185000, '2024/2025', '1st Term', 'Termly standard tuition fee')
  `).run(schoolAId);

  // 3. Demo School B: Abuja Horizon Academy (Maitama, FCT)
  const schoolBId = 'sch_abuja_horizon_02';
  db.prepare(`
    INSERT OR IGNORE INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolBId,
    'Abuja Horizon Academy',
    'abuja-horizon-academy',
    'Comprehensive / K-12',
    'TRIAL',
    'Plot 402 Shehu Shagari Way, Maitama',
    'FCT - Abuja',
    'Abuja Municipal (AMAC)',
    '+2348064445566',
    'admin@abujahorizon.sch.ng',
    'https://abujahorizon.sch.ng'
  );

  db.prepare(`
    INSERT OR IGNORE INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email, payment_notification_sms, portal_subdomain)
    VALUES (?, ?, 'NGN', '₦', '2024/2025', '1st Term', 'accounts@abujahorizon.sch.ng', 0, 'abujahorizon')
  `).run('set_abuja_01', schoolBId);

  // Owner for School B
  const ownerBId = 'usr_owner_abuja_02';
  const ownerBSalt = crypto.randomBytes(16).toString('hex');
  const ownerBHash = hashPasswordHelper('OwnerAbuja@2025!', ownerBSalt);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(ownerBId, 'proprietor@abujahorizon.sch.ng', ownerBHash, ownerBSalt, 'Dr. Amina Bello', '+2348098887766');

  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, ?, 'role_school_owner', 1)
  `).run('ur_abuja_owner_01', ownerBId, schoolBId);

  // Seed School B Classes, Students, and Fees
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level) VALUES
    ('cls_b1', ?, 'JSS 3 Emerald', 'Junior Secondary 3'),
    ('cls_b2', ?, 'JSS 2 Diamond', 'Junior Secondary 2')
  `).run(schoolBId, schoolBId);

  db.prepare(`
    INSERT OR IGNORE INTO students (id, school_id, admission_number, first_name, last_name, full_name, gender, class_name, student_status) VALUES
    ('stu_b1_01', ?, 'AHA/2024/101', 'Zainab', 'Bello', 'Zainab Bello', 'Female', 'JSS 3 Emerald', 'ACTIVE'),
    ('stu_b2_02', ?, 'AHA/2024/102', 'Emeka', 'Eze', 'Emeka Eze', 'Male', 'JSS 2 Diamond', 'ACTIVE')
  `).run(schoolBId, schoolBId);

  db.prepare(`
    INSERT OR IGNORE INTO fees (id, school_id, name, amount, session, term, description) VALUES
    ('fee_b1', ?, 'Comprehensive Tuition - Term 1', 240000, '2024/2025', '1st Term', 'Full composite tuition package')
  `).run(schoolBId);

  // Add initial audit logs
  db.prepare(`
    INSERT OR IGNORE INTO audit_logs (id, actor_id, actor_email, school_id, action, entity, entity_id, ip_address, metadata)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    superAdminId,
    'superadmin@schoolpay.ng',
    null,
    'SYSTEM_BOOTSTRAP',
    'SYSTEM',
    'PLATFORM',
    '127.0.0.1',
    JSON.stringify({ note: 'Initial system seeding completed with multi-tenant isolation' })
  );

  console.log('[Database] Seeding finished successfully.');
}

function seedStep3FinancialManagement() {
  const schoolAId = 'sch_lagos_premier_01';
  const schoolBId = 'sch_abuja_horizon_02';

  // 1. Fee Categories for School A
  const categoriesA = [
    { id: 'cat_a_tui', name: 'Tuition Fee', desc: 'Core academic instruction and termly tuition' },
    { id: 'cat_a_reg', name: 'Registration Fee', desc: 'Annual or admission enrollment fee' },
    { id: 'cat_a_exm', name: 'Examination Fee', desc: 'Termly assessments, mock & external examinations' },
    { id: 'cat_a_txt', name: 'Textbooks & Workbooks', desc: 'Curriculum-mandated books and learning materials' },
    { id: 'cat_a_uni', name: 'School Uniform', desc: 'Official uniforms, sports jerseys and accessories' },
    { id: 'cat_a_trn', name: 'School Bus Transportation', desc: 'Daily pickup and drop-off transport routes' },
    { id: 'cat_a_fed', name: 'School Lunch / Feeding', desc: 'Termly nutritious lunch and cafeteria meal plan' },
    { id: 'cat_a_brd', name: 'Boarding & Hostel Levy', desc: 'Hostel accommodation, laundry and boarding amenities' },
    { id: 'cat_a_dev', name: 'Development Levy', desc: 'Infrastructure, lab equipment and facility enhancements' },
    { id: 'cat_a_med', name: 'Medical & Health Insurance', desc: 'School clinic access and emergency health coverage' },
    { id: 'cat_a_ict', name: 'ICT & STEM Robotics Lab', desc: 'Computer lab, internet and robotics programming license' },
    { id: 'cat_a_oth', name: 'Other Sundry Fees', desc: 'Extracurricular club levies and special events' },
  ];

  for (const cat of categoriesA) {
    db.prepare(`
      INSERT OR IGNORE INTO fee_categories (id, school_id, name, description, status)
      VALUES (?, ?, ?, ?, 'ACTIVE')
    `).run(cat.id, schoolAId, cat.name, cat.desc);
  }

  // 2. Fee Categories for School B
  const categoriesB = [
    { id: 'cat_b_tui', name: 'Tuition Fee', desc: 'Academic instruction levy' },
    { id: 'cat_b_reg', name: 'Registration Fee', desc: 'Enrollment processing fee' },
    { id: 'cat_b_exm', name: 'Examination Fee', desc: 'Internal & external assessments' },
    { id: 'cat_b_ict', name: 'ICT & Digital Learning', desc: 'Digital portals and tablet learning' },
    { id: 'cat_b_dev', name: 'Campus Development Levy', desc: 'Campus facilities' },
  ];

  for (const cat of categoriesB) {
    db.prepare(`
      INSERT OR IGNORE INTO fee_categories (id, school_id, name, description, status)
      VALUES (?, ?, ?, ?, 'ACTIVE')
    `).run(cat.id, schoolBId, cat.name, cat.desc);
  }

  // 3. Fee Structure for School A (SSS 2 - Term 1)
  db.prepare(`
    INSERT OR IGNORE INTO fee_structures (id, school_id, class_id, academic_session_id, term_id, name, description, status)
    VALUES ('fs_a_ss2_t1', ?, 'cls_a_ss2', 'ses_a_2024', 'trm_a_1', 'SSS 2 Standard Composite Fees 2024/2025 Term 1', 'Termly fee package for Senior Secondary 2', 'ACTIVE')
  `).run(schoolAId);

  // Fee Structure Items for School A (Amounts in kobo: 1 NGN = 100 kobo)
  // Tuition: 120,000 NGN = 12,000,000 kobo
  // Exam: 15,000 NGN = 1,500,000 kobo
  // ICT: 25,000 NGN = 2,500,000 kobo
  // Dev: 15,000 NGN = 1,500,000 kobo
  // Uniform: 10,000 NGN = 1,000,000 kobo (Optional)
  const fsItemsA = [
    { id: 'fsi_a_1', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_tui', amount: 12000000, comp: 1, desc: 'Term 1 Tuition' },
    { id: 'fsi_a_2', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_exm', amount: 1500000, comp: 1, desc: 'Continuous Assessment & Term Examination' },
    { id: 'fsi_a_3', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_ict', amount: 2500000, comp: 1, desc: 'Computer & Coding Lab Access' },
    { id: 'fsi_a_4', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_dev', amount: 1500000, comp: 1, desc: 'School Infrastructure Levy' },
    { id: 'fsi_a_5', fs_id: 'fs_a_ss2_t1', cat_id: 'cat_a_uni', amount: 1000000, comp: 0, desc: 'Optional Replacement Uniform set' },
  ];

  for (const item of fsItemsA) {
    db.prepare(`
      INSERT OR IGNORE INTO fee_structure_items (id, school_id, fee_structure_id, fee_category_id, amount, compulsory, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, schoolAId, item.fs_id, item.cat_id, item.amount, item.comp, item.desc);
  }

  // 4. Initial Invoices for School A
  // Invoice 1: INV-2024-001 for Adebayo Olawale (stu_a1_01)
  // Subtotal: 175,000 NGN (17,500,000 kobo)
  // Discount: 25,000 NGN (2,500,000 kobo) Academic Merit Scholarship
  // Total: 150,000 NGN (15,000,000 kobo)
  // Paid: 100,000 NGN (10,000,000 kobo)
  // Balance: 50,000 NGN (5,000,000 kobo)
  // Status: PARTIALLY_PAID
  db.prepare(`
    INSERT OR IGNORE INTO invoices (
      id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
      issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
    ) VALUES (
      'inv_a_001', ?, 'stu_a1_01', 'INV-2024-001', 'ses_a_2024', 'trm_a_1', 'cls_a_ss2',
      '2024-09-09', '2024-10-15', 17500000, 2500000, 15000000, 10000000, 5000000, 'PARTIALLY_PAID',
      'Standard termly invoice for Adebayo Olawale (SSS 2 Gold)'
    )
  `).run(schoolAId);

  // Line Items for Invoice 1
  const inv1Items = [
    { id: 'ii_a_1', inv_id: 'inv_a_001', cat_id: 'cat_a_tui', desc: 'SSS 2 Tuition Fee', qty: 1, unit: 12000000, tot: 12000000 },
    { id: 'ii_a_2', inv_id: 'inv_a_001', cat_id: 'cat_a_exm', desc: 'Examinations & Term Assessment', qty: 1, unit: 1500000, tot: 1500000 },
    { id: 'ii_a_3', inv_id: 'inv_a_001', cat_id: 'cat_a_ict', desc: 'ICT and STEM Laboratory', qty: 1, unit: 2500000, tot: 2500000 },
    { id: 'ii_a_4', inv_id: 'inv_a_001', cat_id: 'cat_a_dev', desc: 'School Development Levy', qty: 1, unit: 1500000, tot: 1500000 },
  ];
  for (const it of inv1Items) {
    db.prepare(`
      INSERT OR IGNORE INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(it.id, schoolAId, it.inv_id, it.cat_id, it.desc, it.qty, it.unit, it.tot);
  }

  // Discount for Invoice 1
  db.prepare(`
    INSERT OR IGNORE INTO invoice_discounts (id, school_id, invoice_id, type, amount, reason, authorized_by)
    VALUES ('disc_a_1', ?, 'inv_a_001', 'SCHOLARSHIP', 2500000, 'Academic Merit Scholarship Award (Top 3 in JSS3 WAEC)', 'usr_owner_lagos_01')
  `).run(schoolAId);

  // Payments for Invoice 1
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, school_id, invoice_id, student_id, payment_reference, amount, payment_method, payment_date, notes, received_by)
    VALUES
    ('pay_a_1', ?, 'inv_a_001', 'stu_a1_01', 'PAY-LPC-2024-001', 5000000, 'BANK_TRANSFER', '2024-09-15', 'First installment via GTBank transfer', 'usr_bursar_lagos_01'),
    ('pay_a_2', ?, 'inv_a_001', 'stu_a1_01', 'PAY-LPC-2024-002', 5000000, 'POS', '2024-10-02', 'Second installment card payment at Bursary', 'usr_bursar_lagos_01')
  `).run(schoolAId, schoolAId);

  // Invoice 2: INV-2024-002 for Chioma Okonkwo (stu_a2_02)
  // Total: 160,000 NGN (16,000,000 kobo)
  // Fully Paid (160,000 NGN)
  // Balance: 0
  // Status: PAID
  db.prepare(`
    INSERT OR IGNORE INTO invoices (
      id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
      issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
    ) VALUES (
      'inv_a_002', ?, 'stu_a2_02', 'INV-2024-002', 'ses_a_2024', 'trm_a_1', 'cls_a_ss1',
      '2024-09-09', '2024-10-15', 16000000, 0, 16000000, 16000000, 0, 'PAID',
      'Full payment confirmed for Chioma Okonkwo (SSS 1 Science)'
    )
  `).run(schoolAId);

  const inv2Items = [
    { id: 'ii_a_5', inv_id: 'inv_a_002', cat_id: 'cat_a_tui', desc: 'SSS 1 Tuition Fee', qty: 1, unit: 11000000, tot: 11000000 },
    { id: 'ii_a_6', inv_id: 'inv_a_002', cat_id: 'cat_a_exm', desc: 'Term 1 Examinations', qty: 1, unit: 1500000, tot: 1500000 },
    { id: 'ii_a_7', inv_id: 'inv_a_002', cat_id: 'cat_a_ict', desc: 'ICT and Laboratory fee', qty: 1, unit: 2000000, tot: 2000000 },
    { id: 'ii_a_8', inv_id: 'inv_a_002', cat_id: 'cat_a_dev', desc: 'Campus Development Levy', qty: 1, unit: 1500000, tot: 1500000 },
  ];
  for (const it of inv2Items) {
    db.prepare(`
      INSERT OR IGNORE INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(it.id, schoolAId, it.inv_id, it.cat_id, it.desc, it.qty, it.unit, it.tot);
  }

  db.prepare(`
    INSERT OR IGNORE INTO payments (id, school_id, invoice_id, student_id, payment_reference, amount, payment_method, payment_date, notes, received_by)
    VALUES ('pay_a_3', ?, 'inv_a_002', 'stu_a2_02', 'PAY-LPC-2024-003', 16000000, 'ONLINE', '2024-09-12', 'Direct online payment receipt via portal', 'usr_bursar_lagos_01')
  `).run(schoolAId);

  // 5. Invoice for School B (Strictly isolated to sch_abuja_horizon_02)
  db.prepare(`
    INSERT OR IGNORE INTO invoices (
      id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
      issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
    ) VALUES (
      'inv_b_001', ?, 'stu_b1_01', 'INV-AHA-2024-101', 'ses_b_2024', 'trm_b_1', 'cls_b_jss3',
      '2024-09-16', '2024-10-31', 24000000, 0, 24000000, 0, 24000000, 'ISSUED',
      'Comprehensive termly bill for Zainab Bello (JSS 3 Emerald)'
    )
  `).run(schoolBId);

  db.prepare(`
    INSERT OR IGNORE INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
    VALUES
    ('ii_b_1', ?, 'inv_b_001', 'cat_b_tui', 'JSS 3 Academic Tuition', 1, 18000000, 18000000),
    ('ii_b_2', ?, 'inv_b_001', 'cat_b_exm', 'Junior WAEC & Mock Levy', 1, 3000000, 3000000),
    ('ii_b_3', ?, 'inv_b_001', 'cat_b_ict', 'Digital Tablet Platform', 1, 3000000, 3000000)
  `).run(schoolBId, schoolBId, schoolBId);

  console.log('[Database] Step 3 Financial Management seeded successfully.');
}
