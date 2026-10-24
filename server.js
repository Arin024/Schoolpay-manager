// server.ts
import express4 from "express";
import { createServer as createViteServer } from "vite";
import path3 from "node:path";

// server/db.ts
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
var dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
var dbPath = path.join(dataDir, "schoolpay.db");
var db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
function initDatabase() {
  migrateStep2Columns();
  migrateStep4Columns();
  migrateStep5Columns();
  const schemaPath = path.resolve(process.cwd(), "schema.sql");
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, "utf8");
    db.exec(schemaSql);
  }
  migrateStep2Columns();
  migrateStep4Columns();
  migrateStep5Columns();
  seedInitialData();
  seedStep2SchoolManagement();
  seedStep3FinancialManagement();
  seedStep4PaymentsAndReceipts();
  seedStep5PlatformSubscriptions();
}
function migrateStep2Columns() {
  const studentTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get();
  if (studentTableExists) {
    const studentCols = db.prepare("PRAGMA table_info(students)").all().map((c) => c.name);
    const requiredStudentCols = {
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
      updated_at: "DATETIME DEFAULT CURRENT_TIMESTAMP"
    };
    for (const [col, colType] of Object.entries(requiredStudentCols)) {
      if (!studentCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE students ADD COLUMN ${col} ${colType};`);
        } catch (e) {
        }
      }
    }
    try {
      db.exec(`
        UPDATE students 
        SET student_status = status 
        WHERE (student_status IS NULL OR student_status = '') AND status IS NOT NULL;
      `);
    } catch (e) {
    }
  }
  const classTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='classes'").get();
  if (classTableExists) {
    const classCols = db.prepare("PRAGMA table_info(classes)").all().map((c) => c.name);
    if (!classCols.includes("description")) {
      try {
        db.exec("ALTER TABLE classes ADD COLUMN description TEXT;");
      } catch (e) {
      }
    }
    if (!classCols.includes("academic_session_id")) {
      try {
        db.exec("ALTER TABLE classes ADD COLUMN academic_session_id TEXT;");
      } catch (e) {
      }
    }
    if (!classCols.includes("updated_at")) {
      try {
        db.exec("ALTER TABLE classes ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;");
      } catch (e) {
      }
    }
  }
}
function migrateStep4Columns() {
  const paymentsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payments'").get();
  if (paymentsTableExists) {
    const paymentCols = db.prepare("PRAGMA table_info(payments)").all().map((c) => c.name);
    const requiredPaymentCols = {
      currency: "TEXT DEFAULT 'NGN'",
      provider: "TEXT DEFAULT 'MANUAL'",
      provider_reference: "TEXT",
      internal_reference: "TEXT",
      status: "TEXT DEFAULT 'SUCCESS'",
      paid_at: "TEXT",
      verified_at: "TEXT",
      verified_by: "TEXT",
      metadata: "TEXT",
      updated_at: "DATETIME"
    };
    for (const [col, colType] of Object.entries(requiredPaymentCols)) {
      if (!paymentCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE payments ADD COLUMN ${col} ${colType};`);
        } catch (e) {
          console.warn(`[DB Migration] Could not add ${col} to payments:`, e?.message);
        }
      }
    }
    try {
      db.exec(`
        UPDATE payments
        SET internal_reference = payment_reference
        WHERE internal_reference IS NULL OR internal_reference = '';
      `);
      db.exec(`
        UPDATE payments
        SET paid_at = payment_date
        WHERE paid_at IS NULL OR paid_at = '';
      `);
      db.exec(`
        UPDATE payments
        SET status = 'SUCCESS'
        WHERE status IS NULL OR status = '';
      `);
      db.exec(`
        UPDATE payments
        SET provider = 'MANUAL'
        WHERE provider IS NULL OR provider = '';
      `);
    } catch (e) {
    }
  }
  const settingsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='school_settings'").get();
  if (settingsTableExists) {
    const settingsCols = db.prepare("PRAGMA table_info(school_settings)").all().map((c) => c.name);
    const requiredSettingsCols = {
      paystack_public_key: "TEXT",
      paystack_secret_key: "TEXT",
      paystack_enabled: "INTEGER DEFAULT 0",
      flutterwave_public_key: "TEXT",
      flutterwave_secret_key: "TEXT",
      flutterwave_enabled: "INTEGER DEFAULT 0",
      bachs_api_key: "TEXT",
      bachs_webhook_secret: "TEXT",
      bachs_enabled: "INTEGER DEFAULT 1",
      webhook_secret: "TEXT"
    };
    for (const [col, colType] of Object.entries(requiredSettingsCols)) {
      if (!settingsCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE school_settings ADD COLUMN ${col} ${colType};`);
        } catch (e) {
        }
      }
    }
  }
  const webhookTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='webhook_events'").get();
  if (webhookTable && !webhookTable.sql.includes("PENDING")) {
    try {
      db.exec(`
        DROP TABLE IF EXISTS webhook_events;
        CREATE TABLE webhook_events (
          id TEXT PRIMARY KEY,
          school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          event_type TEXT NOT NULL,
          idempotency_key TEXT UNIQUE,
          provider_reference TEXT,
          payload TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('PROCESSED', 'FAILED', 'IGNORED', 'DUPLICATE', 'PENDING')),
          processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) {
    }
  }
}
function migrateStep5Columns() {
  const sessionsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (sessionsTableExists) {
    const sessionCols = db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name);
    if (!sessionCols.includes("impersonated_by")) {
      try {
        db.exec("ALTER TABLE sessions ADD COLUMN impersonated_by TEXT;");
      } catch (e) {
      }
    }
  }
  const schoolsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schools'").get();
  if (schoolsTableExists) {
    const schoolCols = db.prepare("PRAGMA table_info(schools)").all().map((c) => c.name);
    if (!schoolCols.includes("current_plan_id")) {
      try {
        db.exec("ALTER TABLE schools ADD COLUMN current_plan_id TEXT;");
      } catch (e) {
      }
    }
    if (!schoolCols.includes("subscription_end_date")) {
      try {
        db.exec("ALTER TABLE schools ADD COLUMN subscription_end_date DATE;");
      } catch (e) {
      }
    }
  }
  const plansTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subscription_plans'").get();
  if (plansTableExists) {
    const planCols = db.prepare("PRAGMA table_info(subscription_plans)").all().map((c) => c.name);
    const planRequired = {
      currency: "TEXT NOT NULL DEFAULT 'NGN'",
      billing_interval_count: "INTEGER NOT NULL DEFAULT 1",
      trial_days: "INTEGER NOT NULL DEFAULT 30",
      maximum_students: "INTEGER NOT NULL DEFAULT 200",
      maximum_staff: "INTEGER NOT NULL DEFAULT 25",
      maximum_admin_users: "INTEGER NOT NULL DEFAULT 5",
      feature_limits: "TEXT"
    };
    for (const [col, def] of Object.entries(planRequired)) {
      if (!planCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE subscription_plans ADD COLUMN ${col} ${def};`);
        } catch (e) {
        }
      }
    }
  }
  const subsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='school_subscriptions'").get();
  if (subsTableExists) {
    const subCols = db.prepare("PRAGMA table_info(school_subscriptions)").all().map((c) => c.name);
    const subRequired = {
      standard_plan_price: "INTEGER NOT NULL DEFAULT 0",
      negotiated_price: "INTEGER",
      discount_amount: "INTEGER NOT NULL DEFAULT 0",
      discount_reason: "TEXT",
      final_amount: "INTEGER NOT NULL DEFAULT 0",
      currency: "TEXT NOT NULL DEFAULT 'NGN'",
      expiry_date: "DATE",
      renewal_date: "DATE",
      grace_period_days: "INTEGER NOT NULL DEFAULT 7"
    };
    for (const [col, def] of Object.entries(subRequired)) {
      if (!subCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE school_subscriptions ADD COLUMN ${col} ${def};`);
        } catch (e) {
        }
      }
    }
    try {
      db.exec(`
        UPDATE school_subscriptions
        SET final_amount = COALESCE(amount_paid, 0),
            standard_plan_price = COALESCE(amount_paid, 0),
            expiry_date = end_date,
            renewal_date = end_date
        WHERE final_amount = 0 AND amount_paid > 0;
      `);
    } catch (e) {
    }
  }
  const ppTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_payments'").get();
  if (ppTableExists) {
    const ppCols = db.prepare("PRAGMA table_info(platform_payments)").all().map((c) => c.name);
    const ppRequired = {
      invoice_id: "TEXT",
      provider_transaction_id: "TEXT",
      metadata: "TEXT",
      updated_at: "DATETIME"
    };
    for (const [col, def] of Object.entries(ppRequired)) {
      if (!ppCols.includes(col)) {
        try {
          db.exec(`ALTER TABLE platform_payments ADD COLUMN ${col} ${def};`);
        } catch (e) {
        }
      }
    }
  }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscription_discounts (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE,
        name TEXT NOT NULL,
        discount_type TEXT NOT NULL CHECK(discount_type IN ('PERCENTAGE', 'FIXED')),
        discount_value INTEGER NOT NULL,
        school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
        plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
        active INTEGER NOT NULL DEFAULT 1,
        expires_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS platform_invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        subscription_id TEXT NOT NULL REFERENCES school_subscriptions(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
        billing_period TEXT,
        standard_price INTEGER NOT NULL,
        discount INTEGER NOT NULL DEFAULT 0,
        negotiated_price INTEGER,
        final_amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'NGN',
        payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(payment_status IN ('PAID', 'PENDING', 'OVERDUE', 'CANCELLED')),
        issue_date DATE NOT NULL,
        due_date DATE NOT NULL,
        paid_at DATETIME,
        payment_method TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS platform_settings (
        id TEXT PRIMARY KEY,
        default_currency TEXT NOT NULL DEFAULT 'NGN',
        default_grace_period_days INTEGER NOT NULL DEFAULT 7,
        default_trial_days INTEGER NOT NULL DEFAULT 30,
        bachs_enabled INTEGER NOT NULL DEFAULT 1,
        bank_transfer_enabled INTEGER NOT NULL DEFAULT 1,
        invoice_payments_enabled INTEGER NOT NULL DEFAULT 1,
        platform_bank_name TEXT DEFAULT 'Zenith Bank Plc',
        platform_account_name TEXT DEFAULT 'School Pay Manager Global Ltd',
        platform_account_number TEXT DEFAULT '1012345678',
        platform_contact_email TEXT DEFAULT 'SchoolPay28@gmail.com',
        platform_contact_phone TEXT DEFAULT '08160754659',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT OR IGNORE INTO platform_settings (
        id, default_currency, default_grace_period_days, default_trial_days,
        bachs_enabled, bank_transfer_enabled, invoice_payments_enabled,
        platform_bank_name, platform_account_name, platform_account_number,
        platform_contact_email, platform_contact_phone
      ) VALUES (
        'platform_global_settings', 'NGN', 7, 30,
        1, 1, 1,
        'Zenith Bank Plc', 'School Pay Manager Global Ltd', '1012345678',
        'SchoolPay28@gmail.com', '08160754659'
      );
      UPDATE platform_settings SET
        platform_contact_email = 'SchoolPay28@gmail.com',
        platform_contact_phone = '08160754659';
    `);
  } catch (e) {
    console.warn("[DB Migration] Table creation warning:", e?.message);
  }
}
function seedStep2SchoolManagement() {
  const schoolAId = "sch_lagos_premier_01";
  const schoolBId = "sch_abuja_horizon_02";
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
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level, description, academic_session_id) VALUES
    ('cls_a_ss2', ?, 'SSS 2', 'Senior Secondary', 'Senior Secondary School Level 2', 'ses_a_2024'),
    ('cls_a_ss1', ?, 'SSS 1', 'Senior Secondary', 'Senior Secondary School Level 1', 'ses_a_2024'),
    ('cls_a_jss1', ?, 'JSS 1', 'Junior Secondary', 'Junior Secondary School Level 1', 'ses_a_2024')
  `).run(schoolAId, schoolAId, schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO staff (id, school_id, staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined) VALUES
    ('stf_a_01', ?, 'LPC/STF/001', 'Emmanuel', 'Chukwuma', 'Okafor', 'principal@lagospremier.edu.ng', '+2348021112233', 'Male', 'Principal / Academic Director', 'Administration', 'ACTIVE', '2021-08-15'),
    ('stf_a_02', ?, 'LPC/STF/002', 'Titilayo', 'Bolanle', 'Adeleke', 'maths.adeleke@lagospremier.edu.ng', '+2348034445566', 'Female', 'Senior Mathematics Teacher', 'Sciences', 'ACTIVE', '2022-01-10'),
    ('stf_a_03', ?, 'LPC/STF/003', 'Babatunde', 'Segun', 'Ogundipe', 'bursar@lagospremier.edu.ng', '+2348057778899', 'Male', 'School Bursar & Accountant', 'Bursary', 'ACTIVE', '2020-09-01')
  `).run(schoolAId, schoolAId, schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id) VALUES
    ('arm_a_ss2_gold', ?, 'cls_a_ss2', 'Gold', 40, 'stf_a_02'),
    ('arm_a_ss2_silver', ?, 'cls_a_ss2', 'Silver', 40, NULL),
    ('arm_a_ss1_sci', ?, 'cls_a_ss1', 'Science', 35, 'stf_a_02')
  `).run(schoolAId, schoolAId, schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact) VALUES
    ('par_a_01', ?, 'Olawale', 'Adebayo', '+2348031110001', 'adebayo.parent@gmail.com', '12 Admiralty Way, Lekki Phase 1, Lagos', 'Civil Engineer', 'Father', '+2348031110001'),
    ('par_a_02', ?, 'Ngozi', 'Okonkwo', '+2348031110002', 'chioma.parent@gmail.com', '45 Glover Road, Ikoyi, Lagos', 'Chartered Accountant', 'Mother', '+2348031110002')
  `).run(schoolAId, schoolAId);
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
  db.prepare(`
    INSERT OR IGNORE INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact) VALUES
    ('ps_a_01', ?, 'par_a_01', 'stu_a1_01', 'Father', 1),
    ('ps_a_02', ?, 'par_a_02', 'stu_a2_02', 'Mother', 1)
  `).run(schoolAId, schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO academic_sessions (id, school_id, name, start_date, end_date, status) VALUES
    ('ses_b_2024', ?, '2024/2025', '2024-09-16', '2025-07-18', 'ACTIVE')
  `).run(schoolBId);
  db.prepare(`
    INSERT OR IGNORE INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status) VALUES
    ('trm_b_1', ?, 'ses_b_2024', '1st Term', '2024-09-16', '2024-12-18', 'ACTIVE')
  `).run(schoolBId);
  db.prepare(`
    INSERT OR IGNORE INTO classes (id, school_id, name, level, description, academic_session_id) VALUES
    ('cls_b_jss3', ?, 'JSS 3', 'Junior Secondary', 'Junior Secondary School Level 3', 'ses_b_2024'),
    ('cls_b_jss2', ?, 'JSS 2', 'Junior Secondary', 'Junior Secondary School Level 2', 'ses_b_2024')
  `).run(schoolBId, schoolBId);
  db.prepare(`
    INSERT OR IGNORE INTO staff (id, school_id, staff_number, first_name, middle_name, last_name, email, phone, gender, job_title, department, employment_status, date_joined) VALUES
    ('stf_b_01', ?, 'AHA/STF/001', 'Usman', 'Aliyu', 'Danjuma', 'viceprincipal@abujahorizon.sch.ng', '+2348065551122', 'Male', 'Vice Principal (Academics)', 'Administration', 'ACTIVE', '2021-10-01'),
    ('stf_b_02', ?, 'AHA/STF/002', 'Grace', 'Onyinye', 'Danladi', 'grace.danladi@abujahorizon.sch.ng', '+2348078889900', 'Female', 'English & Literature Educator', 'Arts', 'ACTIVE', '2022-03-15')
  `).run(schoolBId, schoolBId);
  db.prepare(`
    INSERT OR IGNORE INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id) VALUES
    ('arm_b_jss3_em', ?, 'cls_b_jss3', 'Emerald', 35, 'stf_b_01'),
    ('arm_b_jss2_dia', ?, 'cls_b_jss2', 'Diamond', 35, 'stf_b_02')
  `).run(schoolBId, schoolBId);
  db.prepare(`
    INSERT OR IGNORE INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact) VALUES
    ('par_b_01', ?, 'Amina', 'Bello', '+2348098887701', 'amina.bello@horizon.sch.ng', 'Plot 402 Shehu Shagari Way, Maitama, Abuja', 'Medical Practitioner', 'Mother', '+2348098887701'),
    ('par_b_02', ?, 'Paul', 'Eze', '+2348098887702', 'eze.paul@yahoo.com', '15 Gana Street, Maitama, Abuja', 'Petroleum Engineer', 'Father', '+2348098887702')
  `).run(schoolBId, schoolBId);
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
  db.prepare(`
    INSERT OR IGNORE INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact) VALUES
    ('ps_b_01', ?, 'par_b_01', 'stu_b1_01', 'Mother', 1),
    ('ps_b_02', ?, 'par_b_02', 'stu_b2_02', 'Father', 1)
  `).run(schoolBId, schoolBId);
}
function hashPasswordHelper(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 1e5, 64, "sha512").toString("hex");
}
function seedInitialData() {
  console.log("[Database] Seeding initial Super Admin and demo Nigerian school tenants...");
  const superAdminId = "usr_super_admin_01";
  const saSalt = crypto.randomBytes(16).toString("hex");
  const saHash = hashPasswordHelper("SuperAdmin@2025!", saSalt);
  db.prepare(`DELETE FROM users WHERE email = 'superadmin@schoolpay.ng' AND id != ?;`).run(superAdminId);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1)
  `).run(superAdminId, "SchoolPay28@gmail.com", saHash, saSalt, "Platform Super Admin & Support", "08160754659");
  db.prepare(`
    UPDATE users SET
      email = 'SchoolPay28@gmail.com',
      password_hash = ?,
      salt = ?,
      full_name = 'Platform Super Admin & Support',
      phone = '08160754659',
      is_platform_admin = 1,
      is_active = 1
    WHERE id = ?;
  `).run(saHash, saSalt, superAdminId);
  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, NULL, 'role_super_admin', 1)
  `).run("ur_sa_01", superAdminId);
  const schoolAId = "sch_lagos_premier_01";
  db.prepare(`
    INSERT OR IGNORE INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolAId,
    "Lagos Premier College",
    "lagos-premier-college",
    "Secondary",
    "ACTIVE",
    "14 Allen Avenue, Ikeja",
    "Lagos",
    "Ikeja",
    "+2348021112233",
    "info@lagospremier.edu.ng",
    "https://lagospremier.edu.ng"
  );
  db.prepare(`
    INSERT OR IGNORE INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email, payment_notification_sms, portal_subdomain)
    VALUES (?, ?, 'NGN', '\u20A6', '2024/2025', '1st Term', 'bursary@lagospremier.edu.ng', 1, 'lagospremier')
  `).run("set_lagos_01", schoolAId);
  const ownerAId = "usr_owner_lagos_01";
  const ownerASalt = crypto.randomBytes(16).toString("hex");
  const ownerAHash = hashPasswordHelper("OwnerLagos@2025!", ownerASalt);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(ownerAId, "proprietor@lagospremier.edu.ng", ownerAHash, ownerASalt, "Chief Mrs. Folashade Adeleke", "+2348031234567");
  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, ?, 'role_school_owner', 1)
  `).run("ur_lagos_owner_01", ownerAId, schoolAId);
  const bursarAId = "usr_bursar_lagos_01";
  const bursarASalt = crypto.randomBytes(16).toString("hex");
  const bursarAHash = hashPasswordHelper("BursarLagos@2025!", bursarASalt);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(bursarAId, "bursar@lagospremier.edu.ng", bursarAHash, bursarASalt, "Mr. Babatunde Ogundipe (Bursar)", "+2348057778899");
  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, ?, 'role_bursar', 1)
  `).run("ur_lagos_bursar_01", bursarAId, schoolAId);
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
  const schoolBId = "sch_abuja_horizon_02";
  db.prepare(`
    INSERT OR IGNORE INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    schoolBId,
    "Abuja Horizon Academy",
    "abuja-horizon-academy",
    "Comprehensive / K-12",
    "TRIAL",
    "Plot 402 Shehu Shagari Way, Maitama",
    "FCT - Abuja",
    "Abuja Municipal (AMAC)",
    "+2348064445566",
    "admin@abujahorizon.sch.ng",
    "https://abujahorizon.sch.ng"
  );
  db.prepare(`
    INSERT OR IGNORE INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email, payment_notification_sms, portal_subdomain)
    VALUES (?, ?, 'NGN', '\u20A6', '2024/2025', '1st Term', 'accounts@abujahorizon.sch.ng', 0, 'abujahorizon')
  `).run("set_abuja_01", schoolBId);
  const ownerBId = "usr_owner_abuja_02";
  const ownerBSalt = crypto.randomBytes(16).toString("hex");
  const ownerBHash = hashPasswordHelper("OwnerAbuja@2025!", ownerBSalt);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(ownerBId, "proprietor@abujahorizon.sch.ng", ownerBHash, ownerBSalt, "Dr. Amina Bello", "+2348098887766");
  db.prepare(`
    INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
    VALUES (?, ?, ?, 'role_school_owner', 1)
  `).run("ur_abuja_owner_01", ownerBId, schoolBId);
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
  db.prepare(`
    INSERT OR IGNORE INTO audit_logs (id, actor_id, actor_email, school_id, action, entity, entity_id, ip_address, metadata)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    superAdminId,
    "superadmin@schoolpay.ng",
    null,
    "SYSTEM_BOOTSTRAP",
    "SYSTEM",
    "PLATFORM",
    "127.0.0.1",
    JSON.stringify({ note: "Initial system seeding completed with multi-tenant isolation" })
  );
  console.log("[Database] Seeding finished successfully.");
}
function seedStep3FinancialManagement() {
  const schoolAId = "sch_lagos_premier_01";
  const schoolBId = "sch_abuja_horizon_02";
  const categoriesA = [
    { id: "cat_a_tui", name: "Tuition Fee", desc: "Core academic instruction and termly tuition" },
    { id: "cat_a_reg", name: "Registration Fee", desc: "Annual or admission enrollment fee" },
    { id: "cat_a_exm", name: "Examination Fee", desc: "Termly assessments, mock & external examinations" },
    { id: "cat_a_txt", name: "Textbooks & Workbooks", desc: "Curriculum-mandated books and learning materials" },
    { id: "cat_a_uni", name: "School Uniform", desc: "Official uniforms, sports jerseys and accessories" },
    { id: "cat_a_trn", name: "School Bus Transportation", desc: "Daily pickup and drop-off transport routes" },
    { id: "cat_a_fed", name: "School Lunch / Feeding", desc: "Termly nutritious lunch and cafeteria meal plan" },
    { id: "cat_a_brd", name: "Boarding & Hostel Levy", desc: "Hostel accommodation, laundry and boarding amenities" },
    { id: "cat_a_dev", name: "Development Levy", desc: "Infrastructure, lab equipment and facility enhancements" },
    { id: "cat_a_med", name: "Medical & Health Insurance", desc: "School clinic access and emergency health coverage" },
    { id: "cat_a_ict", name: "ICT & STEM Robotics Lab", desc: "Computer lab, internet and robotics programming license" },
    { id: "cat_a_oth", name: "Other Sundry Fees", desc: "Extracurricular club levies and special events" }
  ];
  for (const cat of categoriesA) {
    db.prepare(`
      INSERT OR IGNORE INTO fee_categories (id, school_id, name, description, status)
      VALUES (?, ?, ?, ?, 'ACTIVE')
    `).run(cat.id, schoolAId, cat.name, cat.desc);
  }
  const categoriesB = [
    { id: "cat_b_tui", name: "Tuition Fee", desc: "Academic instruction levy" },
    { id: "cat_b_reg", name: "Registration Fee", desc: "Enrollment processing fee" },
    { id: "cat_b_exm", name: "Examination Fee", desc: "Internal & external assessments" },
    { id: "cat_b_ict", name: "ICT & Digital Learning", desc: "Digital portals and tablet learning" },
    { id: "cat_b_dev", name: "Campus Development Levy", desc: "Campus facilities" }
  ];
  for (const cat of categoriesB) {
    db.prepare(`
      INSERT OR IGNORE INTO fee_categories (id, school_id, name, description, status)
      VALUES (?, ?, ?, ?, 'ACTIVE')
    `).run(cat.id, schoolBId, cat.name, cat.desc);
  }
  db.prepare(`
    INSERT OR IGNORE INTO fee_structures (id, school_id, class_id, academic_session_id, term_id, name, description, status)
    VALUES ('fs_a_ss2_t1', ?, 'cls_a_ss2', 'ses_a_2024', 'trm_a_1', 'SSS 2 Standard Composite Fees 2024/2025 Term 1', 'Termly fee package for Senior Secondary 2', 'ACTIVE')
  `).run(schoolAId);
  const fsItemsA = [
    { id: "fsi_a_1", fs_id: "fs_a_ss2_t1", cat_id: "cat_a_tui", amount: 12e6, comp: 1, desc: "Term 1 Tuition" },
    { id: "fsi_a_2", fs_id: "fs_a_ss2_t1", cat_id: "cat_a_exm", amount: 15e5, comp: 1, desc: "Continuous Assessment & Term Examination" },
    { id: "fsi_a_3", fs_id: "fs_a_ss2_t1", cat_id: "cat_a_ict", amount: 25e5, comp: 1, desc: "Computer & Coding Lab Access" },
    { id: "fsi_a_4", fs_id: "fs_a_ss2_t1", cat_id: "cat_a_dev", amount: 15e5, comp: 1, desc: "School Infrastructure Levy" },
    { id: "fsi_a_5", fs_id: "fs_a_ss2_t1", cat_id: "cat_a_uni", amount: 1e6, comp: 0, desc: "Optional Replacement Uniform set" }
  ];
  for (const item of fsItemsA) {
    db.prepare(`
      INSERT OR IGNORE INTO fee_structure_items (id, school_id, fee_structure_id, fee_category_id, amount, compulsory, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, schoolAId, item.fs_id, item.cat_id, item.amount, item.comp, item.desc);
  }
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
  const inv1Items = [
    { id: "ii_a_1", inv_id: "inv_a_001", cat_id: "cat_a_tui", desc: "SSS 2 Tuition Fee", qty: 1, unit: 12e6, tot: 12e6 },
    { id: "ii_a_2", inv_id: "inv_a_001", cat_id: "cat_a_exm", desc: "Examinations & Term Assessment", qty: 1, unit: 15e5, tot: 15e5 },
    { id: "ii_a_3", inv_id: "inv_a_001", cat_id: "cat_a_ict", desc: "ICT and STEM Laboratory", qty: 1, unit: 25e5, tot: 25e5 },
    { id: "ii_a_4", inv_id: "inv_a_001", cat_id: "cat_a_dev", desc: "School Development Levy", qty: 1, unit: 15e5, tot: 15e5 }
  ];
  for (const it of inv1Items) {
    db.prepare(`
      INSERT OR IGNORE INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(it.id, schoolAId, it.inv_id, it.cat_id, it.desc, it.qty, it.unit, it.tot);
  }
  db.prepare(`
    INSERT OR IGNORE INTO invoice_discounts (id, school_id, invoice_id, type, amount, reason, authorized_by)
    VALUES ('disc_a_1', ?, 'inv_a_001', 'SCHOLARSHIP', 2500000, 'Academic Merit Scholarship Award (Top 3 in JSS3 WAEC)', 'usr_owner_lagos_01')
  `).run(schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO payments (id, school_id, invoice_id, student_id, payment_reference, amount, payment_method, payment_date, notes, received_by)
    VALUES
    ('pay_a_1', ?, 'inv_a_001', 'stu_a1_01', 'PAY-LPC-2024-001', 5000000, 'BANK_TRANSFER', '2024-09-15', 'First installment via GTBank transfer', 'usr_bursar_lagos_01'),
    ('pay_a_2', ?, 'inv_a_001', 'stu_a1_01', 'PAY-LPC-2024-002', 5000000, 'POS', '2024-10-02', 'Second installment card payment at Bursary', 'usr_bursar_lagos_01')
  `).run(schoolAId, schoolAId);
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
    { id: "ii_a_5", inv_id: "inv_a_002", cat_id: "cat_a_tui", desc: "SSS 1 Tuition Fee", qty: 1, unit: 11e6, tot: 11e6 },
    { id: "ii_a_6", inv_id: "inv_a_002", cat_id: "cat_a_exm", desc: "Term 1 Examinations", qty: 1, unit: 15e5, tot: 15e5 },
    { id: "ii_a_7", inv_id: "inv_a_002", cat_id: "cat_a_ict", desc: "ICT and Laboratory fee", qty: 1, unit: 2e6, tot: 2e6 },
    { id: "ii_a_8", inv_id: "inv_a_002", cat_id: "cat_a_dev", desc: "Campus Development Levy", qty: 1, unit: 15e5, tot: 15e5 }
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
  console.log("[Database] Step 3 Financial Management seeded successfully.");
}
function seedStep4PaymentsAndReceipts() {
  const schoolAId = "sch_lagos_premier_01";
  const schoolBId = "sch_abuja_horizon_02";
  db.prepare(`
    INSERT OR IGNORE INTO receipts (
      id, school_id, receipt_number, payment_id, invoice_id, student_id,
      amount, previous_balance, current_balance, issue_date, issued_by, notes
    ) VALUES (
      'rcp_a_001', ?, 'RCP-LPC-2024-0001', 'pay_a_1', 'inv_a_001', 'stu_a1_01',
      5000000, 15000000, 10000000, '2024-09-15', 'usr_bursar_lagos_01', 'Official receipt for first installment bank transfer'
    )
  `).run(schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO receipts (
      id, school_id, receipt_number, payment_id, invoice_id, student_id,
      amount, previous_balance, current_balance, issue_date, issued_by, notes
    ) VALUES (
      'rcp_a_002', ?, 'RCP-LPC-2024-0002', 'pay_a_2', 'inv_a_001', 'stu_a1_01',
      5000000, 10000000, 5000000, '2024-10-02', 'usr_bursar_lagos_01', 'Official receipt for second installment POS terminal payment'
    )
  `).run(schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO receipts (
      id, school_id, receipt_number, payment_id, invoice_id, student_id,
      amount, previous_balance, current_balance, issue_date, issued_by, notes
    ) VALUES (
      'rcp_a_003', ?, 'RCP-LPC-2024-0003', 'pay_a_3', 'inv_a_002', 'stu_a2_02',
      16000000, 16000000, 0, '2024-09-12', 'usr_bursar_lagos_01', 'Official receipt for full term payment via online portal'
    )
  `).run(schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO payments (
      id, school_id, invoice_id, student_id, payment_reference, internal_reference,
      amount, currency, payment_method, provider, provider_reference, status,
      payment_date, paid_at, notes, received_by
    ) VALUES (
      'pay_a_pending_01', ?, 'inv_a_001', 'stu_a1_01', 'PAY-LPC-2024-0004-PEND', 'PAY-LPC-2024-0004-PEND',
      2500000, 'NGN', 'BANK_TRANSFER', 'MANUAL', 'GTB-TRF-REF-998124', 'PENDING',
      '2024-10-10', '2024-10-10 14:20:00', 'Direct bank transfer teller submitted by guardian. Awaiting Bursar bank reconciliation.', 'usr_bursar_lagos_01'
    )
  `).run(schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO notifications (id, school_id, user_id, type, title, message, data) VALUES
    (
      'notif_a_01', ?, 'usr_bursar_lagos_01', 'PAYMENT_RECEIVED',
      'New Payment Recorded: \u20A650,000.00',
      'Payment PAY-LPC-2024-0002 recorded via POS for Adebayo Olawale (SSS 2 Gold). Receipt RCP-LPC-2024-0002 issued.',
      '{"invoiceId":"inv_a_001","paymentId":"pay_a_2","studentId":"stu_a1_01","amountKobo":5000000}'
    ),
    (
      'notif_a_02', ?, 'usr_bursar_lagos_01', 'PAYMENT_VERIFIED',
      'Online Payment Confirmed: \u20A6160,000.00',
      'Chioma Okonkwo (SSS 1 Science) settled Invoice INV-2024-002 in full via online checkout. Receipt RCP-LPC-2024-0003 generated.',
      '{"invoiceId":"inv_a_002","paymentId":"pay_a_3","studentId":"stu_a2_02","amountKobo":16000000}'
    ),
    (
      'notif_a_03', ?, 'usr_bursar_lagos_01', 'INVOICE_CREATED',
      'Term 1 Invoices Dispatched',
      'Term 1 fee billing schedule published for 2024/2025 Academic Session across SSS classes.',
      '{"sessionId":"ses_a_2024","termId":"trm_a_1"}'
    )
  `).run(schoolAId, schoolAId, schoolAId);
  db.prepare(`
    INSERT OR IGNORE INTO notifications (id, school_id, user_id, type, title, message, data) VALUES
    (
      'notif_b_01', ?, 'usr_owner_abuja_02', 'INVOICE_CREATED',
      'Term 1 Invoice Issued: Zainab Bello',
      'Invoice INV-AHA-2024-101 generated for Zainab Bello (JSS 3 Emerald) totaling \u20A6240,000.00.',
      '{"invoiceId":"inv_b_001","studentId":"stu_b1_01","amountKobo":24000000}'
    )
  `).run(schoolBId);
  console.log("[Database] Step 4 Payments, Receipts, and Notifications seeded successfully.");
}
function seedStep5PlatformSubscriptions() {
  const schoolAId = "sch_lagos_premier_01";
  const schoolBId = "sch_abuja_horizon_02";
  const plans = [
    {
      id: "plan_trial",
      name: "TRIAL",
      display_name: "Free 30-Day Trial",
      description: "Full evaluation environment for new schools joining School Pay Manager.",
      price: 0,
      billing_interval: "TERM",
      student_limit: 50,
      staff_limit: 10,
      storage_limit_mb: 250,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: false,
        reports: true,
        parent_portal: false,
        notifications: false,
        exports: false,
        advanced_analytics: false,
        api_access: false,
        custom_branding: false
      }),
      active: 1
    },
    {
      id: "plan_basic",
      name: "BASIC",
      display_name: "Basic Tier",
      description: "Essential billing, invoicing, and student management for growing primary schools.",
      price: 25e5,
      // ₦25,000 / term
      billing_interval: "TERM",
      student_limit: 200,
      staff_limit: 20,
      storage_limit_mb: 1e3,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: false,
        reports: true,
        parent_portal: false,
        notifications: true,
        exports: true,
        advanced_analytics: false,
        api_access: false,
        custom_branding: false
      }),
      active: 1
    },
    {
      id: "plan_standard",
      name: "STANDARD",
      display_name: "Standard Tier",
      description: "Comprehensive financial suite with online payment gateway integration and parent portal.",
      price: 6e6,
      // ₦60,000 / term
      billing_interval: "TERM",
      student_limit: 500,
      staff_limit: 50,
      storage_limit_mb: 5e3,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: true,
        reports: true,
        parent_portal: true,
        notifications: true,
        exports: true,
        advanced_analytics: false,
        api_access: false,
        custom_branding: false
      }),
      active: 1
    },
    {
      id: "plan_premium",
      name: "PREMIUM",
      display_name: "Premium Tier",
      description: "High-capacity platform with multi-campus features, custom branding, and advanced analytics.",
      price: 12e6,
      // ₦120,000 / term
      billing_interval: "TERM",
      student_limit: 1500,
      staff_limit: 120,
      storage_limit_mb: 2e4,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: true,
        reports: true,
        parent_portal: true,
        notifications: true,
        exports: true,
        advanced_analytics: true,
        api_access: false,
        custom_branding: true
      }),
      active: 1
    },
    {
      id: "plan_enterprise",
      name: "ENTERPRISE",
      display_name: "Enterprise Tier",
      description: "Unlimited scale for educational groups, mission schools, and multi-branch networks.",
      price: 25e6,
      // ₦250,000 / annual
      billing_interval: "ANNUAL",
      student_limit: 1e4,
      staff_limit: 500,
      storage_limit_mb: 1e5,
      feature_flags: JSON.stringify({
        student_management: true,
        financial_management: true,
        online_payments: true,
        reports: true,
        parent_portal: true,
        notifications: true,
        exports: true,
        advanced_analytics: true,
        api_access: true,
        custom_branding: true
      }),
      active: 1
    }
  ];
  for (const p of plans) {
    db.prepare(`
      INSERT OR REPLACE INTO subscription_plans (
        id, name, display_name, description, price, billing_interval,
        student_limit, staff_limit, storage_limit_mb, feature_flags, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      p.id,
      p.name,
      p.display_name,
      p.description,
      p.price,
      p.billing_interval,
      p.student_limit,
      p.staff_limit,
      p.storage_limit_mb,
      p.feature_flags,
      p.active
    );
  }
  const showcaseSchools = [
    {
      id: "sch_ibadan_model_03",
      name: "Ibadan Model Academy",
      slug: "ibadan-model",
      type: "Comprehensive / K-12",
      status: "TRIAL",
      state: "Oyo",
      lga: "Ibadan North",
      phone: "+234 802 345 6789",
      email: "admin@ibadanmodel.sch.ng",
      plan_id: "plan_trial",
      sub_status: "TRIAL"
    },
    {
      id: "sch_kano_heritage_04",
      name: "Kano Heritage College",
      slug: "kano-heritage",
      type: "Secondary",
      status: "SUSPENDED",
      state: "Kano",
      lga: "Nassarawa",
      phone: "+234 806 789 0123",
      email: "info@kanoheritage.edu.ng",
      plan_id: "plan_basic",
      sub_status: "SUSPENDED"
    },
    {
      id: "sch_enugu_grace_05",
      name: "Enugu Grace High School",
      slug: "enugu-grace",
      type: "Secondary",
      status: "EXPIRED",
      state: "Enugu",
      lga: "Enugu North",
      phone: "+234 803 456 7890",
      email: "office@enugugrace.sch.ng",
      plan_id: "plan_standard",
      sub_status: "EXPIRED"
    }
  ];
  for (const s of showcaseSchools) {
    db.prepare(`
      INSERT OR IGNORE INTO schools (id, name, slug, type, status, state, lga, phone, email, current_plan_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(s.id, s.name, s.slug, s.type, s.status, s.state, s.lga, s.phone, s.email, s.plan_id);
    db.prepare(`
      INSERT OR IGNORE INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term)
      VALUES (?, ?, 'NGN', '\u20A6', '2024/2025', '1st Term')
    `).run(`set_${s.id}`, s.id);
  }
  const subscriptions = [
    {
      id: "sub_lagos_01",
      school_id: schoolAId,
      plan_id: "plan_standard",
      status: "ACTIVE",
      start_date: "2024-09-01",
      end_date: "2025-08-31",
      amount_paid: 6e6,
      // ₦60,000
      provider: "BANK_TRANSFER",
      notes: "Term 1 standard subscription renewal confirmed."
    },
    {
      id: "sub_abuja_02",
      school_id: schoolBId,
      plan_id: "plan_premium",
      status: "ACTIVE",
      start_date: "2024-09-01",
      end_date: "2025-08-31",
      amount_paid: 12e6,
      // ₦120,000
      provider: "PAYSTACK",
      provider_reference: "PSTK_SUB_ABUJA_2024",
      notes: "Premium enterprise subscription with online gateway activated."
    },
    {
      id: "sub_ibadan_03",
      school_id: "sch_ibadan_model_03",
      plan_id: "plan_trial",
      status: "TRIAL",
      start_date: "2026-09-20",
      end_date: "2026-10-20",
      trial_end_date: "2026-10-20",
      amount_paid: 0,
      provider: "MANUAL",
      notes: "New trial evaluation period."
    },
    {
      id: "sub_kano_04",
      school_id: "sch_kano_heritage_04",
      plan_id: "plan_basic",
      status: "SUSPENDED",
      start_date: "2024-09-01",
      end_date: "2024-12-31",
      amount_paid: 25e5,
      provider: "BANK_TRANSFER",
      notes: "Account suspended by platform admin pending compliance documentation."
    },
    {
      id: "sub_enugu_05",
      school_id: "sch_enugu_grace_05",
      plan_id: "plan_standard",
      status: "EXPIRED",
      start_date: "2024-01-10",
      end_date: "2024-07-31",
      amount_paid: 6e6,
      provider: "MANUAL",
      notes: "Subscription expired. Preserved data intact in grace period."
    }
  ];
  for (const sub of subscriptions) {
    db.prepare(`
      INSERT OR REPLACE INTO school_subscriptions (
        id, school_id, plan_id, status, start_date, end_date, trial_end_date, amount_paid, provider, provider_reference, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sub.id,
      sub.school_id,
      sub.plan_id,
      sub.status,
      sub.start_date,
      sub.end_date,
      sub.trial_end_date || null,
      sub.amount_paid,
      sub.provider,
      sub.provider_reference || null,
      sub.notes
    );
    db.prepare(`
      UPDATE schools SET current_plan_id = ?, subscription_end_date = ? WHERE id = ?
    `).run(sub.plan_id, sub.end_date, sub.school_id);
  }
  const platformPayments = [
    {
      id: "ppay_lagos_01",
      school_id: schoolAId,
      subscription_id: "sub_lagos_01",
      plan_id: "plan_standard",
      amount: 6e6,
      // ₦60,000
      payment_method: "BANK_TRANSFER",
      provider: "MANUAL",
      internal_reference: "PLT-PAY-LPC-2024-01",
      status: "SUCCESS",
      paid_at: "2024-09-02 11:30:00",
      notes: "Lagos Premier College Term 1 SaaS fee settlement."
    },
    {
      id: "ppay_abuja_02",
      school_id: schoolBId,
      subscription_id: "sub_abuja_02",
      plan_id: "plan_premium",
      amount: 12e6,
      // ₦120,000
      payment_method: "PAYSTACK",
      provider: "PAYSTACK",
      provider_reference: "pstk_ref_aha_2024_01",
      internal_reference: "PLT-PAY-AHA-2024-01",
      status: "SUCCESS",
      paid_at: "2024-09-03 14:15:00",
      notes: "Abuja Horizon Academy Premium SaaS subscription payment via Paystack."
    },
    {
      id: "ppay_kano_03",
      school_id: "sch_kano_heritage_04",
      subscription_id: "sub_kano_04",
      plan_id: "plan_basic",
      amount: 25e5,
      // ₦25,000
      payment_method: "BANK_TRANSFER",
      provider: "MANUAL",
      internal_reference: "PLT-PAY-KHC-2024-01",
      status: "SUCCESS",
      paid_at: "2024-09-05 09:45:00",
      notes: "Kano Heritage College Basic Plan fee."
    }
  ];
  for (const pp of platformPayments) {
    db.prepare(`
      INSERT OR REPLACE INTO platform_payments (
        id, school_id, subscription_id, plan_id, amount, currency, payment_method, provider,
        provider_reference, internal_reference, status, paid_at, notes
      ) VALUES (?, ?, ?, ?, ?, 'NGN', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pp.id,
      pp.school_id,
      pp.subscription_id,
      pp.plan_id,
      pp.amount,
      pp.payment_method,
      pp.provider,
      pp.provider_reference || null,
      pp.internal_reference,
      pp.status,
      pp.paid_at,
      pp.notes
    );
  }
  const partners = [
    {
      id: "ptn_access_01",
      name: "Access Bank EdTech Alliance",
      email: "partnerships@accessbankplc.com",
      phone: "+234 1 271 2005",
      company: "Access Bank Plc",
      partner_type: "BANK",
      commission_rate: 15,
      referral_code: "ACCESS-EDU",
      status: "ACTIVE",
      notes: "Nationwide institutional banking partner integrating digital collections for partner schools."
    },
    {
      id: "ptn_zenith_02",
      name: "Zenith EduConnect",
      email: "edutech@zenithbank.com",
      phone: "+234 1 278 7000",
      company: "Zenith Bank Plc",
      partner_type: "BANK",
      commission_rate: 12.5,
      referral_code: "ZENITH-SCH",
      status: "ACTIVE",
      notes: "Automated settlement partner in Lagos, Abuja and Port Harcourt educational zones."
    },
    {
      id: "ptn_reseller_03",
      name: "Nigerian Schools Direct Ltd",
      email: "contact@nigerianschoolsdirect.ng",
      phone: "+234 803 123 4567",
      company: "Nigerian Schools Direct Ltd",
      partner_type: "RESELLER",
      commission_rate: 20,
      referral_code: "NSD-PARTNER",
      status: "ACTIVE",
      notes: "Regional educational consultancy and school onboarding agency in South-West Nigeria."
    }
  ];
  for (const p of partners) {
    db.prepare(`
      INSERT OR REPLACE INTO partners (
        id, name, email, phone, company, partner_type, commission_rate, referral_code, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      p.id,
      p.name,
      p.email,
      p.phone,
      p.company,
      p.partner_type,
      p.commission_rate,
      p.referral_code,
      p.status,
      p.notes
    );
  }
  const commissions = [
    {
      id: "com_01",
      partner_id: "ptn_access_01",
      school_id: schoolAId,
      platform_payment_id: "ppay_lagos_01",
      amount: 9e5,
      // 15% of ₦60,000 = ₦9,000 (900000 kobo)
      rate_percent: 15,
      status: "PAID",
      notes: "Settled commission for Lagos Premier College Term 1 onboarding.",
      paid_at: "2024-09-10"
    },
    {
      id: "com_02",
      partner_id: "ptn_zenith_02",
      school_id: schoolBId,
      platform_payment_id: "ppay_abuja_02",
      amount: 15e5,
      // 12.5% of ₦120,000 = ₦15,000 (1500000 kobo)
      rate_percent: 12.5,
      status: "PENDING",
      notes: "Pending payout for Abuja Horizon Academy Premium Plan commission.",
      paid_at: null
    }
  ];
  for (const c of commissions) {
    db.prepare(`
      INSERT OR REPLACE INTO commissions (
        id, partner_id, school_id, platform_payment_id, amount, rate_percent, status, notes, paid_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(c.id, c.partner_id, c.school_id, c.platform_payment_id, c.amount, c.rate_percent, c.status, c.notes, c.paid_at);
  }
  console.log("[Database] Step 5 Platform Super Admin, Subscriptions & SaaS seeded successfully.");
}

// server/routes.ts
import express3 from "express";
import crypto10 from "node:crypto";

// server/auth.ts
import crypto2 from "node:crypto";
function hashPassword(password, salt) {
  return crypto2.pbkdf2Sync(password, salt, 1e5, 64, "sha512").toString("hex");
}
function generateSalt() {
  return crypto2.randomBytes(16).toString("hex");
}
function verifyPassword(password, hash, salt) {
  const computed = hashPassword(password, salt);
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return crypto2.timingSafeEqual(a, b);
}
function createSession(userId, schoolId, ip, userAgent) {
  const token = crypto2.randomBytes(32).toString("hex");
  const sessionId = "ses_" + crypto2.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
  db.prepare(`
    INSERT INTO sessions (id, token, user_id, school_id, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, token, userId, schoolId || null, ip || null, userAgent || null, expiresAt);
  return token;
}
function createImpersonationSession(targetUserId, targetSchoolId, superAdminId, ip, userAgent) {
  const token = "imp_" + crypto2.randomBytes(32).toString("hex");
  const sessionId = "ses_imp_" + crypto2.randomUUID();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1e3).toISOString();
  db.prepare(`
    INSERT INTO sessions (id, token, user_id, school_id, impersonated_by, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, token, targetUserId, targetSchoolId, superAdminId, ip || null, userAgent || null, expiresAt);
  return token;
}
function validateSession(token) {
  if (!token) return null;
  const session = db.prepare(`
    SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')
  `).get(token);
  if (!session) return null;
  const user = db.prepare(`
    SELECT * FROM users WHERE id = ? AND is_active = 1
  `).get(session.user_id);
  if (!user) return null;
  const roles = db.prepare(`
    SELECT ur.*, r.name as role_name, r.display_name as role_display_name, r.scope as role_scope,
           s.name as school_name, s.status as school_status
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    LEFT JOIN schools s ON ur.school_id = s.id
    WHERE ur.user_id = ?
  `).all(user.id);
  return {
    user,
    schoolId: session.school_id,
    roles,
    impersonatedBy: session.impersonated_by || null
  };
}
function destroySession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

// server/audit.ts
function logAudit(params) {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (actor_id, actor_email, school_id, action, entity, entity_id, ip_address, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      params.actorId || null,
      params.actorEmail || null,
      params.schoolId || null,
      params.action,
      params.entity,
      params.entityId || null,
      params.ipAddress || "127.0.0.1",
      params.metadata ? JSON.stringify(params.metadata) : null
    );
  } catch (err) {
    console.error("[AuditLog] Failed to record audit log:", err);
  }
}

// server/tenantMiddleware.ts
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  let token;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (req.headers["x-session-token"]) {
    token = req.headers["x-session-token"];
  }
  if (!token) {
    return res.status(401).json({
      error: "UNAUTHENTICATED",
      message: "Access denied. Valid authentication session required."
    });
  }
  const sessionData = validateSession(token);
  if (!sessionData) {
    return res.status(401).json({
      error: "INVALID_SESSION",
      message: "Your session has expired or is invalid. Please sign in again."
    });
  }
  req.user = sessionData.user;
  req.roles = sessionData.roles;
  req.activeSchoolId = sessionData.schoolId;
  req.impersonatedBy = sessionData.impersonatedBy;
  next();
}
function requireTenant(req, res, next) {
  if (!req.user || !req.roles) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Authentication required" });
  }
  if (req.user.is_platform_admin === 1) {
    const requestedSchoolId = req.params.schoolId || req.headers["x-school-id"] || req.query.school_id || req.activeSchoolId;
    if (!requestedSchoolId) {
      return res.status(400).json({ error: "MISSING_TENANT_ID", message: "Super admin must specify target school_id" });
    }
    const school2 = db.prepare("SELECT * FROM schools WHERE id = ?").get(requestedSchoolId);
    if (!school2) {
      return res.status(404).json({ error: "SCHOOL_NOT_FOUND", message: "School tenant does not exist" });
    }
    req.targetSchoolId = requestedSchoolId;
    return next();
  }
  if (!req.activeSchoolId) {
    return res.status(403).json({
      error: "NO_ACTIVE_TENANT",
      message: "Your authenticated account is not associated with an active school tenant."
    });
  }
  const clientSpecifiedSchoolId = req.headers["x-school-id"] || req.params.schoolId || req.query.school_id || req.body && req.body.school_id;
  if (clientSpecifiedSchoolId && clientSpecifiedSchoolId !== req.activeSchoolId) {
    const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId: req.activeSchoolId,
      action: "IDOR_SECURITY_VIOLATION",
      entity: "TENANT_BOUNDARY",
      entityId: clientSpecifiedSchoolId,
      ipAddress: clientIp,
      metadata: {
        severity: "CRITICAL",
        attemptedEndpoint: req.originalUrl,
        userAuthorizedSchool: req.activeSchoolId,
        injectedTargetSchool: clientSpecifiedSchoolId
      }
    });
    console.warn(`[SECURITY ALERT - IDOR PREVENTED] User ${req.user.email} (School: ${req.activeSchoolId}) attempted to access foreign tenant ${clientSpecifiedSchoolId}`);
    return res.status(403).json({
      error: "CROSS_TENANT_ACCESS_DENIED",
      message: "Unauthorized: Cross-tenant access is strictly prohibited. You cannot access another school's records.",
      code: "IDOR_PREVENTED"
    });
  }
  req.targetSchoolId = req.activeSchoolId;
  const matchedRole = req.roles.find((r) => r.school_id === req.activeSchoolId);
  if (!matchedRole) {
    return res.status(403).json({
      error: "TENANT_ACCESS_DENIED",
      message: "User does not possess an active role in this school tenant."
    });
  }
  req.activeRole = matchedRole;
  const school = db.prepare("SELECT id, status, name FROM schools WHERE id = ?").get(req.targetSchoolId);
  if (!school) {
    return res.status(404).json({ error: "SCHOOL_NOT_FOUND", message: "School tenant not found" });
  }
  if (["SUSPENDED", "CANCELLED", "EXPIRED"].includes(school.status) && req.method !== "GET") {
    return res.status(403).json({
      error: "SCHOOL_LOCKED",
      message: `School account is currently ${school.status}. Modifications are restricted. Contact platform administration.`,
      status: school.status
    });
  }
  next();
}
function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Authentication required" });
  }
  if (req.user.is_platform_admin !== 1) {
    const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT",
      entity: "SUPER_ADMIN_PORTAL",
      ipAddress: clientIp,
      metadata: { endpoint: req.originalUrl }
    });
    return res.status(403).json({
      error: "FORBIDDEN_SUPER_ADMIN_ONLY",
      message: "Access restricted to Platform Super Administrators only."
    });
  }
  next();
}
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "UNAUTHENTICATED", message: "Authentication required" });
    }
    if (req.user.is_platform_admin === 1) {
      return next();
    }
    const currentRole = req.activeRole?.role_name;
    if (!currentRole || !allowedRoles.includes(currentRole)) {
      return res.status(403).json({
        error: "INSUFFICIENT_ROLE_PERMISSIONS",
        message: `Action requires one of the following roles: ${allowedRoles.join(", ")}`
      });
    }
    next();
  };
}

// server/financeRoutes.ts
import express from "express";
import crypto3 from "node:crypto";

// server/financeUtils.ts
function toKobo(naira) {
  if (typeof naira === "string") {
    const cleaned = naira.replace(/[^0-9.-]+/g, "");
    naira = parseFloat(cleaned) || 0;
  }
  if (isNaN(Number(naira))) return 0;
  return Math.round(Number(naira) * 100);
}
function toNaira(kobo) {
  if (isNaN(Number(kobo))) return 0;
  return Number(kobo) / 100;
}
function determineInvoiceStatus(totalKobo, paidKobo, dueDateStr, currentStatus = "ISSUED") {
  if (currentStatus === "CANCELLED") return "CANCELLED";
  if (currentStatus === "DRAFT") return "DRAFT";
  if (paidKobo >= totalKobo && totalKobo > 0) return "PAID";
  if (paidKobo > 0 && paidKobo < totalKobo) return "PARTIALLY_PAID";
  if (dueDateStr) {
    const due = new Date(dueDateStr);
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    if (!isNaN(due.getTime()) && due < today && paidKobo < totalKobo) {
      return "OVERDUE";
    }
  }
  return "ISSUED";
}
function generateInvoiceNumber(schoolSlugOrPrefix, sequenceNum) {
  const year = (/* @__PURE__ */ new Date()).getFullYear();
  const seq = String(sequenceNum).padStart(4, "0");
  const cleanPrefix = (schoolSlugOrPrefix || "INV").slice(0, 4).toUpperCase();
  return `INV-${cleanPrefix}-${year}-${seq}`;
}
function generatePaymentReference(schoolSlugOrPrefix, sequenceNum) {
  const year = (/* @__PURE__ */ new Date()).getFullYear();
  const seq = String(sequenceNum).padStart(4, "0");
  const cleanPrefix = (schoolSlugOrPrefix || "PAY").slice(0, 4).toUpperCase();
  return `PAY-${cleanPrefix}-${year}-${seq}`;
}

// server/financeRoutes.ts
var financeRouter = express.Router();
var FINANCIAL_ADMIN_ROLES = ["SCHOOL_OWNER", "SCHOOL_ADMIN", "BURSAR"];
financeRouter.get(
  "/fee-categories",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const categories = db.prepare(
      `SELECT * FROM fee_categories WHERE school_id = ? ORDER BY name ASC`
    ).all(schoolId);
    return res.json({ success: true, count: categories.length, categories });
  }
);
financeRouter.post(
  "/fee-categories",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { name, description, status = "ACTIVE" } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "MISSING_NAME", message: "Category name is required." });
    }
    const trimmedName = name.trim();
    const existing = db.prepare(`SELECT id FROM fee_categories WHERE school_id = ? AND LOWER(name) = LOWER(?)`).get(schoolId, trimmedName);
    if (existing) {
      return res.status(409).json({
        error: "DUPLICATE_CATEGORY",
        message: `A fee category with name "${trimmedName}" already exists for this school.`
      });
    }
    const id = `cat_${crypto3.randomBytes(8).toString("hex")}`;
    db.prepare(`
      INSERT INTO fee_categories (id, school_id, name, description, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, schoolId, trimmedName, description || null, status);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "CREATE_FEE_CATEGORY",
      entity: "FEE_CATEGORY",
      entityId: id,
      ipAddress: req.ip,
      metadata: { name: trimmedName, status }
    });
    const created = db.prepare(`SELECT * FROM fee_categories WHERE id = ? AND school_id = ?`).get(id, schoolId);
    return res.status(201).json({ success: true, category: created });
  }
);
financeRouter.put(
  "/fee-categories/:id",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const { name, description, status } = req.body;
    const cat = db.prepare(`SELECT * FROM fee_categories WHERE id = ? AND school_id = ?`).get(id, schoolId);
    if (!cat) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Fee category not found in your school." });
    }
    if (name && name.trim()) {
      const trimmed = name.trim();
      const duplicate = db.prepare(`SELECT id FROM fee_categories WHERE school_id = ? AND LOWER(name) = LOWER(?) AND id != ?`).get(schoolId, trimmed, id);
      if (duplicate) {
        return res.status(409).json({ error: "DUPLICATE_CATEGORY", message: `Fee category "${trimmed}" already exists.` });
      }
    }
    db.prepare(`
      UPDATE fee_categories SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(name?.trim() || null, description !== void 0 ? description : null, status || null, id, schoolId);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "UPDATE_FEE_CATEGORY",
      entity: "FEE_CATEGORY",
      entityId: id,
      ipAddress: req.ip,
      metadata: { name, status }
    });
    const updated = db.prepare(`SELECT * FROM fee_categories WHERE id = ? AND school_id = ?`).get(id, schoolId);
    return res.json({ success: true, category: updated });
  }
);
financeRouter.delete(
  "/fee-categories/:id",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const cat = db.prepare(`SELECT * FROM fee_categories WHERE id = ? AND school_id = ?`).get(id, schoolId);
    if (!cat) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Fee category not found in your school." });
    }
    const usedInFs = db.prepare(`SELECT COUNT(*) as c FROM fee_structure_items WHERE fee_category_id = ? AND school_id = ?`).get(id, schoolId);
    const usedInInv = db.prepare(`SELECT COUNT(*) as c FROM invoice_items WHERE fee_category_id = ? AND school_id = ?`).get(id, schoolId);
    if (usedInFs.c > 0 || usedInInv.c > 0) {
      db.prepare(`UPDATE fee_categories SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`).run(id, schoolId);
      return res.json({
        success: true,
        message: "Fee category is referenced in fee structures or invoices. Deactivated to preserve financial audit trail."
      });
    }
    db.prepare(`DELETE FROM fee_categories WHERE id = ? AND school_id = ?`).run(id, schoolId);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "DELETE_FEE_CATEGORY",
      entity: "FEE_CATEGORY",
      entityId: id,
      ipAddress: req.ip
    });
    return res.json({ success: true, message: "Fee category deleted." });
  }
);
financeRouter.get(
  "/fee-structures",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { class_id, session_id, term_id } = req.query;
    let sql = `
      SELECT fs.*,
             c.name as class_name,
             s.name as session_name,
             t.name as term_name
      FROM fee_structures fs
      LEFT JOIN classes c ON fs.class_id = c.id
      LEFT JOIN academic_sessions s ON fs.academic_session_id = s.id
      LEFT JOIN terms t ON fs.term_id = t.id
      WHERE fs.school_id = ?
    `;
    const params = [schoolId];
    if (class_id) {
      sql += ` AND fs.class_id = ?`;
      params.push(class_id);
    }
    if (session_id) {
      sql += ` AND fs.academic_session_id = ?`;
      params.push(session_id);
    }
    if (term_id) {
      sql += ` AND fs.term_id = ?`;
      params.push(term_id);
    }
    sql += ` ORDER BY fs.created_at DESC`;
    const structures = db.prepare(sql).all(...params);
    const fullStructures = structures.map((fs3) => {
      const items = db.prepare(`
        SELECT fsi.*, fc.name as category_name
        FROM fee_structure_items fsi
        LEFT JOIN fee_categories fc ON fsi.fee_category_id = fc.id
        WHERE fsi.fee_structure_id = ? AND fsi.school_id = ?
        ORDER BY fsi.compulsory DESC, fc.name ASC
      `).all(fs3.id, schoolId);
      const totalKobo = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      return {
        ...fs3,
        items,
        total_amount: totalKobo,
        total_naira: toNaira(totalKobo)
      };
    });
    return res.json({ success: true, count: fullStructures.length, feeStructures: fullStructures });
  }
);
financeRouter.post(
  "/fee-structures",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const {
      name,
      description,
      class_id,
      academic_session_id,
      term_id,
      items
      // array of { fee_category_id, amount (in kobo or naira), compulsory, due_date, description }
    } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "MISSING_NAME", message: "Fee structure name is required." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "MISSING_ITEMS", message: "At least one fee line item is required." });
    }
    if (class_id) {
      const cls = db.prepare(`SELECT id FROM classes WHERE id = ? AND school_id = ?`).get(class_id, schoolId);
      if (!cls) return res.status(400).json({ error: "INVALID_CLASS", message: "Selected class does not exist in your school." });
    }
    if (academic_session_id) {
      const ses = db.prepare(`SELECT id FROM academic_sessions WHERE id = ? AND school_id = ?`).get(academic_session_id, schoolId);
      if (!ses) return res.status(400).json({ error: "INVALID_SESSION", message: "Selected session does not exist in your school." });
    }
    if (term_id) {
      const trm = db.prepare(`SELECT id FROM terms WHERE id = ? AND school_id = ?`).get(term_id, schoolId);
      if (!trm) return res.status(400).json({ error: "INVALID_TERM", message: "Selected term does not exist in your school." });
    }
    const structureId = `fs_${crypto3.randomBytes(8).toString("hex")}`;
    db.prepare(`
      INSERT INTO fee_structures (id, school_id, class_id, academic_session_id, term_id, name, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(
      structureId,
      schoolId,
      class_id || null,
      academic_session_id || null,
      term_id || null,
      name.trim(),
      description || null
    );
    let totalKobo = 0;
    const insertItemStmt = db.prepare(`
      INSERT INTO fee_structure_items (id, school_id, fee_structure_id, fee_category_id, amount, compulsory, due_date, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of items) {
      const itemId = `fsi_${crypto3.randomBytes(8).toString("hex")}`;
      const koboVal = it.amount_kobo !== void 0 ? Math.round(Number(it.amount_kobo)) : toKobo(it.amount || 0);
      const isCompulsory = it.compulsory === false ? 0 : 1;
      insertItemStmt.run(
        itemId,
        schoolId,
        structureId,
        it.fee_category_id,
        koboVal,
        isCompulsory,
        it.due_date || null,
        it.description || null
      );
      totalKobo += koboVal;
    }
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "CREATE_FEE_STRUCTURE",
      entity: "FEE_STRUCTURE",
      entityId: structureId,
      ipAddress: req.ip,
      metadata: { name: name.trim(), totalKobo, itemCount: items.length }
    });
    const createdItems = db.prepare(`
      SELECT fsi.*, fc.name as category_name
      FROM fee_structure_items fsi
      LEFT JOIN fee_categories fc ON fsi.fee_category_id = fc.id
      WHERE fsi.fee_structure_id = ? AND fsi.school_id = ?
    `).all(structureId, schoolId);
    const created = db.prepare(`SELECT * FROM fee_structures WHERE id = ? AND school_id = ?`).get(structureId, schoolId);
    return res.status(201).json({
      success: true,
      feeStructure: {
        ...created,
        items: createdItems,
        total_amount: totalKobo,
        total_naira: toNaira(totalKobo)
      }
    });
  }
);
financeRouter.delete(
  "/fee-structures/:id",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const fs3 = db.prepare(`SELECT * FROM fee_structures WHERE id = ? AND school_id = ?`).get(id, schoolId);
    if (!fs3) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Fee structure not found." });
    }
    db.prepare(`DELETE FROM fee_structure_items WHERE fee_structure_id = ? AND school_id = ?`).run(id, schoolId);
    db.prepare(`DELETE FROM fee_structures WHERE id = ? AND school_id = ?`).run(id, schoolId);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "DELETE_FEE_STRUCTURE",
      entity: "FEE_STRUCTURE",
      entityId: id,
      ipAddress: req.ip
    });
    return res.json({ success: true, message: "Fee structure deleted." });
  }
);
financeRouter.get(
  "/invoices",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const {
      student_id,
      class_id,
      academic_session_id,
      term_id,
      status,
      search,
      start_date,
      end_date,
      limit = "50",
      offset = "0"
    } = req.query;
    let sql = `
      SELECT inv.*,
             s.full_name as student_name,
             s.first_name,
             s.last_name,
             s.admission_number,
             s.class_name,
             c.name as current_class_name,
             ses.name as session_name,
             t.name as term_name
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      LEFT JOIN classes c ON inv.class_id = c.id
      LEFT JOIN academic_sessions ses ON inv.academic_session_id = ses.id
      LEFT JOIN terms t ON inv.term_id = t.id
      WHERE inv.school_id = ?
    `;
    const params = [schoolId];
    if (student_id) {
      sql += ` AND inv.student_id = ?`;
      params.push(student_id);
    }
    if (class_id) {
      sql += ` AND (inv.class_id = ? OR s.class_id = ?)`;
      params.push(class_id, class_id);
    }
    if (academic_session_id) {
      sql += ` AND inv.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      sql += ` AND inv.term_id = ?`;
      params.push(term_id);
    }
    if (status) {
      sql += ` AND inv.status = ?`;
      params.push(status);
    }
    if (search && typeof search === "string" && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      sql += ` AND (LOWER(inv.invoice_number) LIKE ? OR LOWER(s.full_name) LIKE ? OR LOWER(s.admission_number) LIKE ?)`;
      params.push(term, term, term);
    }
    if (start_date) {
      sql += ` AND inv.issue_date >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      sql += ` AND inv.issue_date <= ?`;
      params.push(end_date);
    }
    const countSql = sql.replace(/SELECT inv\.\*.*?FROM invoices inv/s, "SELECT COUNT(*) as total FROM invoices inv");
    const totalRow = db.prepare(countSql).get(...params);
    sql += ` ORDER BY inv.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);
    const invoices = db.prepare(sql).all(...params);
    const mapped = invoices.map((inv) => {
      const dynamicStatus = determineInvoiceStatus(inv.total, inv.amount_paid, inv.due_date, inv.status);
      if (dynamicStatus !== inv.status && inv.status !== "CANCELLED" && inv.status !== "PAID") {
        db.prepare(`UPDATE invoices SET status = ? WHERE id = ?`).run(dynamicStatus, inv.id);
        inv.status = dynamicStatus;
      }
      return {
        ...inv,
        subtotal_naira: toNaira(inv.subtotal),
        discount_naira: toNaira(inv.discount),
        total_naira: toNaira(inv.total),
        amount_paid_naira: toNaira(inv.amount_paid),
        balance_naira: toNaira(inv.balance)
      };
    });
    return res.json({
      success: true,
      total: totalRow?.total || 0,
      count: mapped.length,
      invoices: mapped
    });
  }
);
financeRouter.get(
  "/invoices/:id",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const invoice = db.prepare(`
      SELECT inv.*,
             s.full_name as student_name,
             s.first_name,
             s.last_name,
             s.admission_number,
             s.class_name,
             s.gender as student_gender,
             c.name as class_official_name,
             ses.name as session_name,
             t.name as term_name,
             sch.name as school_name,
             sch.address as school_address,
             sch.phone as school_phone,
             sch.email as school_email,
             sch.website as school_website,
             sch.logo_url as school_logo_url
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      JOIN schools sch ON inv.school_id = sch.id
      LEFT JOIN classes c ON inv.class_id = c.id
      LEFT JOIN academic_sessions ses ON inv.academic_session_id = ses.id
      LEFT JOIN terms t ON inv.term_id = t.id
      WHERE inv.id = ? AND inv.school_id = ?
    `).get(id, schoolId);
    if (!invoice) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found in your school." });
    }
    const items = db.prepare(`
      SELECT ii.*, fc.name as category_name
      FROM invoice_items ii
      LEFT JOIN fee_categories fc ON ii.fee_category_id = fc.id
      WHERE ii.invoice_id = ? AND ii.school_id = ?
      ORDER BY ii.created_at ASC
    `).all(id, schoolId);
    const discounts = db.prepare(`
      SELECT id.*, u.full_name as authorizer_name
      FROM invoice_discounts id
      LEFT JOIN users u ON id.authorized_by = u.id
      WHERE id.invoice_id = ? AND id.school_id = ?
      ORDER BY id.created_at ASC
    `).all(id, schoolId);
    const payments = db.prepare(`
      SELECT p.*, u.full_name as receiver_name
      FROM payments p
      LEFT JOIN users u ON p.received_by = u.id
      WHERE p.invoice_id = ? AND p.school_id = ?
      ORDER BY p.payment_date DESC, p.created_at DESC
    `).all(id, schoolId);
    return res.json({
      success: true,
      invoice: {
        ...invoice,
        subtotal_naira: toNaira(invoice.subtotal),
        discount_naira: toNaira(invoice.discount),
        total_naira: toNaira(invoice.total),
        amount_paid_naira: toNaira(invoice.amount_paid),
        balance_naira: toNaira(invoice.balance),
        items: items.map((it) => ({
          ...it,
          unit_amount_naira: toNaira(it.unit_amount),
          total_amount_naira: toNaira(it.total_amount)
        })),
        discounts: discounts.map((d) => ({
          ...d,
          amount_naira: toNaira(d.amount)
        })),
        payments: payments.map((p) => ({
          ...p,
          amount_naira: toNaira(p.amount)
        }))
      }
    });
  }
);
financeRouter.post(
  "/invoices",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const {
      student_id,
      academic_session_id,
      term_id,
      class_id,
      issue_date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      due_date,
      notes,
      items,
      // array of { fee_category_id, description, quantity, unit_amount (in kobo or naira) }
      discounts,
      // optional array of { type, amount, percentage, reason }
      status = "ISSUED"
    } = req.body;
    if (!student_id) {
      return res.status(400).json({ error: "MISSING_STUDENT", message: "Student ID is required." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "MISSING_ITEMS", message: "Invoice must contain at least one line item." });
    }
    if (!due_date) {
      return res.status(400).json({ error: "MISSING_DUE_DATE", message: "Payment due date is required." });
    }
    const student = db.prepare(`SELECT * FROM students WHERE id = ? AND school_id = ?`).get(student_id, schoolId);
    if (!student) {
      return res.status(404).json({ error: "STUDENT_NOT_FOUND", message: "Student not found in your school." });
    }
    const calculatedItems = items.map((it) => {
      const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
      const unitKobo = it.unit_amount_kobo !== void 0 ? Math.round(Number(it.unit_amount_kobo)) : toKobo(it.unit_amount || 0);
      const totalKobo2 = unitKobo * qty;
      return {
        id: `ii_${crypto3.randomBytes(8).toString("hex")}`,
        fee_category_id: it.fee_category_id || null,
        description: (it.description || "Fee Item").trim(),
        quantity: qty,
        unit_amount: unitKobo,
        total_amount: totalKobo2
      };
    });
    const subtotalKobo = calculatedItems.reduce((acc, it) => acc + it.total_amount, 0);
    let totalDiscountKobo = 0;
    const discountRecords = [];
    if (Array.isArray(discounts)) {
      for (const d of discounts) {
        let discAmountKobo = 0;
        if (d.type === "PERCENTAGE" && typeof d.percentage === "number") {
          const clamped = Math.min(100, Math.max(0, d.percentage));
          discAmountKobo = Math.round(subtotalKobo * clamped / 100);
        } else {
          discAmountKobo = d.amount_kobo !== void 0 ? Math.round(Number(d.amount_kobo)) : toKobo(d.amount || 0);
        }
        if (discAmountKobo > 0) {
          totalDiscountKobo += discAmountKobo;
          discountRecords.push({
            id: `disc_${crypto3.randomBytes(8).toString("hex")}`,
            type: d.type || "FIXED",
            amount: discAmountKobo,
            percentage: d.percentage || null,
            reason: (d.reason || "Fee discount").trim()
          });
        }
      }
    }
    totalDiscountKobo = Math.min(subtotalKobo, totalDiscountKobo);
    const totalKobo = Math.max(0, subtotalKobo - totalDiscountKobo);
    const amountPaidKobo = 0;
    const balanceKobo = totalKobo;
    const computedStatus = determineInvoiceStatus(totalKobo, amountPaidKobo, due_date, status);
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE school_id = ?`).get(schoolId);
    const invoiceNumber = generateInvoiceNumber(student.admission_number || "INV", countRow.c + 1);
    const invoiceId = `inv_${crypto3.randomBytes(8).toString("hex")}`;
    db.prepare(`
      INSERT INTO invoices (
        id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
        issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceId,
      schoolId,
      student_id,
      invoiceNumber,
      academic_session_id || student.academic_session_id || null,
      term_id || null,
      class_id || student.class_id || null,
      issue_date,
      due_date,
      subtotalKobo,
      totalDiscountKobo,
      totalKobo,
      amountPaidKobo,
      balanceKobo,
      computedStatus,
      notes || null
    );
    const insertItemStmt = db.prepare(`
      INSERT INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of calculatedItems) {
      insertItemStmt.run(it.id, schoolId, invoiceId, it.fee_category_id, it.description, it.quantity, it.unit_amount, it.total_amount);
    }
    const insertDiscStmt = db.prepare(`
      INSERT INTO invoice_discounts (id, school_id, invoice_id, type, amount, percentage, reason, authorized_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of discountRecords) {
      insertDiscStmt.run(d.id, schoolId, invoiceId, d.type, d.amount, d.percentage, d.reason, req.user?.id || null);
    }
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "CREATE_INVOICE",
      entity: "INVOICE",
      entityId: invoiceId,
      ipAddress: req.ip,
      metadata: { invoiceNumber, studentId: student_id, totalKobo, subtotalKobo, totalDiscountKobo }
    });
    const created = db.prepare(`SELECT * FROM invoices WHERE id = ? AND school_id = ?`).get(invoiceId, schoolId);
    return res.status(201).json({
      success: true,
      invoice: {
        ...created,
        subtotal_naira: toNaira(subtotalKobo),
        discount_naira: toNaira(totalDiscountKobo),
        total_naira: toNaira(totalKobo),
        amount_paid_naira: 0,
        balance_naira: toNaira(balanceKobo),
        items: calculatedItems,
        discounts: discountRecords
      }
    });
  }
);
financeRouter.post(
  "/invoices/generate-bulk",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const {
      fee_structure_id,
      class_id,
      academic_session_id,
      term_id,
      due_date,
      issue_date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      notes
    } = req.body;
    if (!fee_structure_id) {
      return res.status(400).json({ error: "MISSING_STRUCTURE", message: "Fee structure ID is required." });
    }
    if (!class_id) {
      return res.status(400).json({ error: "MISSING_CLASS", message: "Target class ID is required." });
    }
    if (!due_date) {
      return res.status(400).json({ error: "MISSING_DUE_DATE", message: "Due date is required." });
    }
    const fs3 = db.prepare(`SELECT * FROM fee_structures WHERE id = ? AND school_id = ?`).get(fee_structure_id, schoolId);
    if (!fs3) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Fee structure not found in your school." });
    }
    const fsItems = db.prepare(`
      SELECT fsi.*, fc.name as category_name
      FROM fee_structure_items fsi
      LEFT JOIN fee_categories fc ON fsi.fee_category_id = fc.id
      WHERE fsi.fee_structure_id = ? AND fsi.school_id = ?
    `).all(fee_structure_id, schoolId);
    if (fsItems.length === 0) {
      return res.status(400).json({ error: "NO_ITEMS", message: "Fee structure has no line items." });
    }
    const students = db.prepare(`
      SELECT * FROM students
      WHERE school_id = ? AND class_id = ? AND student_status = 'ACTIVE'
    `).all(schoolId, class_id);
    if (students.length === 0) {
      return res.status(400).json({ error: "NO_STUDENTS", message: "No active students found in the selected class." });
    }
    const subtotalKobo = fsItems.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
    const totalKobo = subtotalKobo;
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE school_id = ?`).get(schoolId);
    let currentSeq = countRow.c;
    const generatedInvoices = [];
    const insertInvStmt = db.prepare(`
      INSERT INTO invoices (
        id, school_id, student_id, invoice_number, academic_session_id, term_id, class_id,
        issue_date, due_date, subtotal, discount, total, amount_paid, balance, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertItemStmt = db.prepare(`
      INSERT INTO invoice_items (id, school_id, invoice_id, fee_category_id, description, quantity, unit_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const student of students) {
      currentSeq += 1;
      const invNum = generateInvoiceNumber(student.admission_number || "INV", currentSeq);
      const invId = `inv_${crypto3.randomBytes(8).toString("hex")}`;
      const status = determineInvoiceStatus(totalKobo, 0, due_date, "ISSUED");
      insertInvStmt.run(
        invId,
        schoolId,
        student.id,
        invNum,
        academic_session_id || fs3.academic_session_id || null,
        term_id || fs3.term_id || null,
        class_id,
        issue_date,
        due_date,
        subtotalKobo,
        0,
        totalKobo,
        0,
        totalKobo,
        status,
        notes || `Generated from ${fs3.name}`
      );
      for (const it of fsItems) {
        const itemId = `ii_${crypto3.randomBytes(8).toString("hex")}`;
        insertItemStmt.run(
          itemId,
          schoolId,
          invId,
          it.fee_category_id,
          it.description || it.category_name || "Fee item",
          1,
          it.amount,
          it.amount
        );
      }
      generatedInvoices.push({ invoiceId: invId, invoiceNumber: invNum, studentName: student.full_name });
    }
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "BULK_GENERATE_INVOICES",
      entity: "INVOICE",
      entityId: fee_structure_id,
      ipAddress: req.ip,
      metadata: { classId: class_id, count: generatedInvoices.length, subtotalKobo }
    });
    return res.status(201).json({
      success: true,
      message: `Successfully generated ${generatedInvoices.length} invoices.`,
      count: generatedInvoices.length,
      invoices: generatedInvoices
    });
  }
);
financeRouter.post(
  "/invoices/:id/cancel",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const { reason } = req.body;
    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ? AND school_id = ?`).get(id, schoolId);
    if (!invoice) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
    }
    if (invoice.amount_paid > 0) {
      return res.status(400).json({
        error: "CANNOT_CANCEL_PAID",
        message: "Cannot cancel invoice with confirmed payments. Reverse or refund payments first."
      });
    }
    db.prepare(`UPDATE invoices SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?`).run(id, schoolId);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "CANCEL_INVOICE",
      entity: "INVOICE",
      entityId: id,
      ipAddress: req.ip,
      metadata: { reason }
    });
    return res.json({ success: true, message: "Invoice marked as CANCELLED." });
  }
);
financeRouter.post(
  "/invoices/:id/discounts",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id: invoiceId } = req.params;
    const { type, amount, percentage, reason } = req.body;
    if (!type || !["FIXED", "PERCENTAGE", "SCHOLARSHIP", "WAIVER"].includes(type)) {
      return res.status(400).json({ error: "INVALID_TYPE", message: "Type must be FIXED, PERCENTAGE, SCHOLARSHIP, or WAIVER." });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "MISSING_REASON", message: "Audit reason is required for fee adjustments." });
    }
    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ? AND school_id = ?`).get(invoiceId, schoolId);
    if (!invoice) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
    }
    if (invoice.status === "CANCELLED" || invoice.status === "PAID") {
      return res.status(400).json({ error: "INVALID_STATE", message: "Cannot add discounts to a PAID or CANCELLED invoice." });
    }
    let discountAmountKobo = 0;
    if (type === "PERCENTAGE") {
      const pct = Math.min(100, Math.max(0, Number(percentage) || 0));
      discountAmountKobo = Math.round(invoice.subtotal * pct / 100);
    } else {
      discountAmountKobo = toKobo(amount || 0);
    }
    if (discountAmountKobo <= 0) {
      return res.status(400).json({ error: "INVALID_AMOUNT", message: "Discount amount must be greater than zero." });
    }
    const newTotalDiscountKobo = invoice.discount + discountAmountKobo;
    if (newTotalDiscountKobo > invoice.subtotal) {
      return res.status(400).json({
        error: "EXCEEDS_SUBTOTAL",
        message: "Cumulative discount cannot exceed invoice subtotal."
      });
    }
    const newTotalKobo = Math.max(0, invoice.subtotal - newTotalDiscountKobo);
    const newBalanceKobo = Math.max(0, newTotalKobo - invoice.amount_paid);
    const newStatus = determineInvoiceStatus(newTotalKobo, invoice.amount_paid, invoice.due_date, invoice.status);
    const discountId = `disc_${crypto3.randomBytes(8).toString("hex")}`;
    db.prepare(`
      INSERT INTO invoice_discounts (id, school_id, invoice_id, type, amount, percentage, reason, authorized_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      discountId,
      schoolId,
      invoiceId,
      type,
      discountAmountKobo,
      percentage || null,
      reason.trim(),
      req.user?.id || null
    );
    db.prepare(`
      UPDATE invoices SET
        discount = ?,
        total = ?,
        balance = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(newTotalDiscountKobo, newTotalKobo, newBalanceKobo, newStatus, invoiceId, schoolId);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "APPLY_INVOICE_DISCOUNT",
      entity: "INVOICE_DISCOUNT",
      entityId: discountId,
      ipAddress: req.ip,
      metadata: { invoiceId, type, discountAmountKobo, reason: reason.trim() }
    });
    return res.status(201).json({
      success: true,
      message: `${type} discount applied successfully.`,
      discount: {
        id: discountId,
        type,
        amount: discountAmountKobo,
        amount_naira: toNaira(discountAmountKobo),
        reason
      },
      invoice: {
        id: invoiceId,
        subtotal: invoice.subtotal,
        discount: newTotalDiscountKobo,
        total: newTotalKobo,
        amount_paid: invoice.amount_paid,
        balance: newBalanceKobo,
        status: newStatus,
        total_naira: toNaira(newTotalKobo),
        balance_naira: toNaira(newBalanceKobo)
      }
    });
  }
);
financeRouter.get(
  "/payments",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { student_id, payment_method, start_date, end_date, limit = "50", offset = "0" } = req.query;
    let sql = `
      SELECT p.*,
             inv.invoice_number,
             s.full_name as student_name,
             s.admission_number,
             s.class_name,
             u.full_name as receiver_name
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      LEFT JOIN users u ON p.received_by = u.id
      WHERE p.school_id = ?
    `;
    const params = [schoolId];
    if (student_id) {
      sql += ` AND p.student_id = ?`;
      params.push(student_id);
    }
    if (payment_method) {
      sql += ` AND p.payment_method = ?`;
      params.push(payment_method);
    }
    if (start_date) {
      sql += ` AND p.payment_date >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      sql += ` AND p.payment_date <= ?`;
      params.push(end_date);
    }
    sql += ` ORDER BY p.payment_date DESC, p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);
    const payments = db.prepare(sql).all(...params);
    return res.json({
      success: true,
      count: payments.length,
      payments: payments.map((p) => ({
        ...p,
        amount_naira: toNaira(p.amount)
      }))
    });
  }
);
financeRouter.post(
  "/invoices/:id/payments",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id: invoiceId } = req.params;
    const {
      amount,
      // in naira or kobo
      payment_method,
      // BANK_TRANSFER, POS, CASH, ONLINE, CHEQUE
      payment_date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      notes
    } = req.body;
    const validMethods = ["BANK_TRANSFER", "POS", "CASH", "ONLINE", "CHEQUE"];
    if (!payment_method || !validMethods.includes(payment_method)) {
      return res.status(400).json({ error: "INVALID_PAYMENT_METHOD", message: `Payment method must be one of: ${validMethods.join(", ")}` });
    }
    const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ? AND school_id = ?`).get(invoiceId, schoolId);
    if (!invoice) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found in your school." });
    }
    if (invoice.status === "CANCELLED") {
      return res.status(400).json({ error: "INVOICE_CANCELLED", message: "Cannot record payment for a CANCELLED invoice." });
    }
    if (invoice.status === "PAID" && invoice.balance <= 0) {
      return res.status(400).json({ error: "ALREADY_PAID", message: "Invoice is already fully settled." });
    }
    const payKobo = req.body.amount_kobo !== void 0 ? Math.round(Number(req.body.amount_kobo)) : toKobo(amount || 0);
    if (payKobo <= 0) {
      return res.status(400).json({ error: "INVALID_AMOUNT", message: "Payment amount must be greater than zero." });
    }
    if (payKobo > invoice.balance) {
      return res.status(400).json({
        error: "OVERPAYMENT_NOT_ALLOWED",
        message: `Payment amount (\u20A6${toNaira(payKobo).toLocaleString()}) exceeds outstanding balance (\u20A6${toNaira(invoice.balance).toLocaleString()}).`
      });
    }
    const newAmountPaidKobo = invoice.amount_paid + payKobo;
    const newBalanceKobo = Math.max(0, invoice.total - newAmountPaidKobo);
    const newStatus = determineInvoiceStatus(invoice.total, newAmountPaidKobo, invoice.due_date, invoice.status);
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM payments WHERE school_id = ?`).get(schoolId);
    const paymentRef = generatePaymentReference("PAY", countRow.c + 1);
    const paymentId = `pay_${crypto3.randomBytes(8).toString("hex")}`;
    db.prepare(`
      INSERT INTO payments (id, school_id, invoice_id, student_id, payment_reference, amount, payment_method, payment_date, notes, received_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      schoolId,
      invoiceId,
      invoice.student_id,
      paymentRef,
      payKobo,
      payment_method,
      payment_date,
      notes || null,
      req.user?.id || null
    );
    db.prepare(`
      UPDATE invoices SET
        amount_paid = ?,
        balance = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(newAmountPaidKobo, newBalanceKobo, newStatus, invoiceId, schoolId);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "RECORD_PAYMENT",
      entity: "PAYMENT",
      entityId: paymentId,
      ipAddress: req.ip,
      metadata: { invoiceId, paymentRef, amountKobo: payKobo, newBalanceKobo, newStatus }
    });
    return res.status(201).json({
      success: true,
      message: "Payment recorded successfully.",
      payment: {
        id: paymentId,
        payment_reference: paymentRef,
        amount: payKobo,
        amount_naira: toNaira(payKobo),
        payment_method,
        payment_date
      },
      invoice: {
        id: invoiceId,
        total: invoice.total,
        amount_paid: newAmountPaidKobo,
        balance: newBalanceKobo,
        status: newStatus,
        total_naira: toNaira(invoice.total),
        amount_paid_naira: toNaira(newAmountPaidKobo),
        balance_naira: toNaira(newBalanceKobo)
      }
    });
  }
);
financeRouter.get(
  "/finance/dashboard",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(amount_paid), 0) as total_collected,
        COALESCE(SUM(balance), 0) as outstanding_fees,
        COUNT(*) as total_invoices,
        SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN status = 'PARTIALLY_PAID' THEN 1 ELSE 0 END) as partially_paid_count,
        SUM(CASE WHEN status = 'ISSUED' THEN 1 ELSE 0 END) as unpaid_count,
        SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END) as overdue_count,
        SUM(CASE WHEN status = 'OVERDUE' THEN balance ELSE 0 END) as overdue_amount
      FROM invoices
      WHERE school_id = ? AND status != 'CANCELLED'
    `).get(schoolId);
    const totalInvoicedKobo = Number(totals.total_invoiced) || 0;
    const totalCollectedKobo = Number(totals.total_collected) || 0;
    const outstandingKobo = Number(totals.outstanding_fees) || 0;
    const overdueKobo = Number(totals.overdue_amount) || 0;
    const collectionRate = totalInvoicedKobo > 0 ? Math.round(totalCollectedKobo / totalInvoicedKobo * 1e3) / 10 : 0;
    const recentInvoices = db.prepare(`
      SELECT inv.*, s.full_name as student_name, s.admission_number, s.class_name
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      WHERE inv.school_id = ?
      ORDER BY inv.created_at DESC
      LIMIT 5
    `).all(schoolId);
    const recentPayments = db.prepare(`
      SELECT p.*, inv.invoice_number, s.full_name as student_name, s.admission_number
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      WHERE p.school_id = ?
      ORDER BY p.payment_date DESC, p.created_at DESC
      LIMIT 5
    `).all(schoolId);
    return res.json({
      success: true,
      stats: {
        totalInvoicedKobo,
        totalInvoicedNaira: toNaira(totalInvoicedKobo),
        totalCollectedKobo,
        totalCollectedNaira: toNaira(totalCollectedKobo),
        outstandingKobo,
        outstandingNaira: toNaira(outstandingKobo),
        overdueKobo,
        overdueNaira: toNaira(overdueKobo),
        paidCount: Number(totals.paid_count) || 0,
        partiallyPaidCount: Number(totals.partially_paid_count) || 0,
        unpaidCount: Number(totals.unpaid_count) || 0,
        overdueCount: Number(totals.overdue_count) || 0,
        totalInvoices: Number(totals.total_invoices) || 0,
        collectionRate,
        recentInvoices: recentInvoices.map((inv) => ({
          ...inv,
          total_naira: toNaira(inv.total),
          balance_naira: toNaira(inv.balance),
          amount_paid_naira: toNaira(inv.amount_paid)
        })),
        recentPayments: recentPayments.map((p) => ({
          ...p,
          amount_naira: toNaira(p.amount)
        }))
      }
    });
  }
);
financeRouter.get(
  "/finance/reports/summary",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { academic_session_id, term_id } = req.query;
    let sqlWhere = `WHERE inv.school_id = ? AND inv.status != 'CANCELLED'`;
    const params = [schoolId];
    if (academic_session_id) {
      sqlWhere += ` AND inv.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    if (term_id) {
      sqlWhere += ` AND inv.term_id = ?`;
      params.push(term_id);
    }
    const classRevenue = db.prepare(`
      SELECT COALESCE(c.name, 'Unassigned') as class_name,
             COUNT(inv.id) as invoice_count,
             COALESCE(SUM(inv.total), 0) as total_billed,
             COALESCE(SUM(inv.amount_paid), 0) as total_paid,
             COALESCE(SUM(inv.balance), 0) as total_balance
      FROM invoices inv
      LEFT JOIN classes c ON inv.class_id = c.id
      ${sqlWhere}
      GROUP BY c.name
      ORDER BY total_billed DESC
    `).all(...params);
    const categoryRevenue = db.prepare(`
      SELECT COALESCE(fc.name, 'Other') as category_name,
             COUNT(ii.id) as item_count,
             COALESCE(SUM(ii.total_amount), 0) as total_billed
      FROM invoice_items ii
      JOIN invoices inv ON ii.invoice_id = inv.id
      LEFT JOIN fee_categories fc ON ii.fee_category_id = fc.id
      ${sqlWhere}
      GROUP BY fc.name
      ORDER BY total_billed DESC
    `).all(...params);
    const paymentMethods = db.prepare(`
      SELECT p.payment_method,
             COUNT(p.id) as payment_count,
             COALESCE(SUM(p.amount), 0) as total_amount
      FROM payments p
      WHERE p.school_id = ?
      GROUP BY p.payment_method
      ORDER BY total_amount DESC
    `).all(schoolId);
    return res.json({
      success: true,
      classRevenue: classRevenue.map((c) => ({
        ...c,
        total_billed_naira: toNaira(c.total_billed),
        total_paid_naira: toNaira(c.total_paid),
        total_balance_naira: toNaira(c.total_balance)
      })),
      categoryRevenue: categoryRevenue.map((cat) => ({
        ...cat,
        total_billed_naira: toNaira(cat.total_billed)
      })),
      paymentMethods: paymentMethods.map((pm) => ({
        ...pm,
        total_amount_naira: toNaira(pm.total_amount)
      }))
    });
  }
);
financeRouter.get(
  "/finance/reports/export-csv",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { type = "invoices", status, academic_session_id } = req.query;
    if (type === "payments") {
      const payments = db.prepare(`
        SELECT p.payment_reference,
               p.payment_date,
               s.admission_number,
               s.full_name as student_name,
               inv.invoice_number,
               p.amount as amount_kobo,
               p.payment_method,
               p.notes
        FROM payments p
        JOIN invoices inv ON p.invoice_id = inv.id
        JOIN students s ON p.student_id = s.id
        WHERE p.school_id = ?
        ORDER BY p.payment_date DESC
      `).all(schoolId);
      const header2 = "Payment Reference,Date,Admission Number,Student Name,Invoice Number,Amount (NGN),Payment Method,Notes\n";
      const rows2 = payments.map((p) => {
        const naira = (p.amount_kobo / 100).toFixed(2);
        const safeName = `"${(p.student_name || "").replace(/"/g, '""')}"`;
        const safeNotes = `"${(p.notes || "").replace(/"/g, '""')}"`;
        return `${p.payment_reference},${p.payment_date},${p.admission_number},${safeName},${p.invoice_number},${naira},${p.payment_method},${safeNotes}`;
      }).join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="school_payments_${Date.now()}.csv"`);
      return res.send(header2 + rows2);
    }
    let sql = `
      SELECT inv.invoice_number,
             s.admission_number,
             s.full_name as student_name,
             c.name as class_name,
             inv.issue_date,
             inv.due_date,
             inv.subtotal,
             inv.discount,
             inv.total,
             inv.amount_paid,
             inv.balance,
             inv.status,
             inv.notes
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      LEFT JOIN classes c ON inv.class_id = c.id
      WHERE inv.school_id = ?
    `;
    const params = [schoolId];
    if (status) {
      sql += ` AND inv.status = ?`;
      params.push(status);
    }
    if (academic_session_id) {
      sql += ` AND inv.academic_session_id = ?`;
      params.push(academic_session_id);
    }
    sql += ` ORDER BY inv.created_at DESC`;
    const invoices = db.prepare(sql).all(...params);
    const header = "Invoice Number,Admission Number,Student Name,Class,Issue Date,Due Date,Subtotal (NGN),Discount (NGN),Total (NGN),Amount Paid (NGN),Balance (NGN),Status,Notes\n";
    const rows = invoices.map((inv) => {
      const subtotal = (inv.subtotal / 100).toFixed(2);
      const discount = (inv.discount / 100).toFixed(2);
      const total = (inv.total / 100).toFixed(2);
      const paid = (inv.amount_paid / 100).toFixed(2);
      const balance = (inv.balance / 100).toFixed(2);
      const safeName = `"${(inv.student_name || "").replace(/"/g, '""')}"`;
      const safeClass = `"${(inv.class_name || "").replace(/"/g, '""')}"`;
      const safeNotes = `"${(inv.notes || "").replace(/"/g, '""')}"`;
      return `${inv.invoice_number},${inv.admission_number},${safeName},${safeClass},${inv.issue_date},${inv.due_date},${subtotal},${discount},${total},${paid},${balance},${inv.status},${safeNotes}`;
    }).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="school_invoices_${Date.now()}.csv"`);
    return res.send(header + rows);
  }
);
financeRouter.get(
  "/students/:id/finance",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id: studentId } = req.params;
    const student = db.prepare(`SELECT * FROM students WHERE id = ? AND school_id = ?`).get(studentId, schoolId);
    if (!student) {
      return res.status(404).json({ error: "STUDENT_NOT_FOUND", message: "Student not found in your school." });
    }
    const balanceRow = db.prepare(`
      SELECT
        COALESCE(SUM(total), 0) as total_billed,
        COALESCE(SUM(discount), 0) as total_discount,
        COALESCE(SUM(amount_paid), 0) as total_paid,
        COALESCE(SUM(balance), 0) as outstanding_balance,
        COUNT(*) as total_invoices
      FROM invoices
      WHERE student_id = ? AND school_id = ? AND status != 'CANCELLED'
    `).get(studentId, schoolId);
    const invoices = db.prepare(`
      SELECT * FROM invoices
      WHERE student_id = ? AND school_id = ?
      ORDER BY created_at DESC
    `).all(studentId, schoolId);
    const payments = db.prepare(`
      SELECT p.*, inv.invoice_number
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      WHERE p.student_id = ? AND p.school_id = ?
      ORDER BY p.payment_date DESC, p.created_at DESC
    `).all(studentId, schoolId);
    return res.json({
      success: true,
      student: {
        id: student.id,
        fullName: student.full_name,
        admissionNumber: student.admission_number,
        className: student.class_name
      },
      summary: {
        totalBilledKobo: Number(balanceRow.total_billed) || 0,
        totalBilledNaira: toNaira(Number(balanceRow.total_billed) || 0),
        totalDiscountKobo: Number(balanceRow.total_discount) || 0,
        totalDiscountNaira: toNaira(Number(balanceRow.total_discount) || 0),
        totalPaidKobo: Number(balanceRow.total_paid) || 0,
        totalPaidNaira: toNaira(Number(balanceRow.total_paid) || 0),
        outstandingBalanceKobo: Number(balanceRow.outstanding_balance) || 0,
        outstandingBalanceNaira: toNaira(Number(balanceRow.outstanding_balance) || 0),
        invoiceCount: Number(balanceRow.total_invoices) || 0
      },
      invoices: invoices.map((inv) => ({
        ...inv,
        total_naira: toNaira(inv.total),
        amount_paid_naira: toNaira(inv.amount_paid),
        balance_naira: toNaira(inv.balance)
      })),
      payments: payments.map((p) => ({
        ...p,
        amount_naira: toNaira(p.amount)
      }))
    });
  }
);

// server/paymentRoutes.ts
import { Router } from "express";
import crypto6 from "node:crypto";

// server/paymentService.ts
import crypto4 from "node:crypto";
function generateInternalPaymentReference(schoolSlug, sequenceNumber) {
  const cleanSlug = schoolSlug.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "SCH";
  const year = (/* @__PURE__ */ new Date()).getFullYear();
  const seq = String(sequenceNumber !== void 0 ? sequenceNumber : Math.floor(1e3 + Math.random() * 9e3)).padStart(4, "0");
  const randomSuffix = crypto4.randomBytes(2).toString("hex").toUpperCase();
  return `PAY-${cleanSlug}-${year}-${seq}-${randomSuffix}`;
}
function generateReceiptNumber(schoolSlug, sequenceNumber) {
  const cleanSlug = schoolSlug.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "SCH";
  const year = (/* @__PURE__ */ new Date()).getFullYear();
  const seq = String(sequenceNumber).padStart(4, "0");
  return `RCP-${cleanSlug}-${year}-${seq}`;
}
var PaystackProvider = class {
  constructor() {
    this.name = "PAYSTACK";
    this.displayName = "Paystack (Cards, Bank Transfer, USSD, Apple Pay)";
  }
  getSecretKey(schoolId) {
    if (schoolId) {
      const setting = db.prepare("SELECT paystack_secret_key FROM school_settings WHERE school_id = ?").get(schoolId);
      if (setting?.paystack_secret_key) return setting.paystack_secret_key;
    }
    return process.env.PAYSTACK_SECRET_KEY || null;
  }
  isConfigured(schoolId) {
    const key = this.getSecretKey(schoolId);
    return Boolean(key && key.startsWith("sk_"));
  }
  async initializePayment(params) {
    const secretKey = this.getSecretKey(params.schoolId);
    const providerRef = `pstk_${Date.now()}_${crypto4.randomBytes(4).toString("hex")}`;
    const countRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ?").get(params.schoolId);
    const internalRef = generateInternalPaymentReference("PAY", countRow.c + 1);
    if (!secretKey || !secretKey.startsWith("sk_")) {
      return {
        success: false,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        message: "Paystack is not configured with live credentials. Configure PAYSTACK_SECRET_KEY in School Settings or environment, or use Sandbox simulation."
      };
    }
    try {
      const payload = {
        email: params.email,
        amount: params.amountKobo,
        reference: providerRef,
        callback_url: params.callbackUrl,
        metadata: {
          ...params.metadata,
          school_id: params.schoolId,
          student_id: params.studentId,
          invoice_id: params.invoiceId,
          internal_reference: internalRef
        }
      };
      const response = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || !data.status) {
        return {
          success: false,
          provider: this.name,
          providerReference: providerRef,
          internalReference: internalRef,
          message: data.message || "Failed to initialize Paystack payment"
        };
      }
      return {
        success: true,
        provider: this.name,
        providerReference: data.data.reference,
        internalReference: internalRef,
        authorizationUrl: data.data.authorization_url,
        checkoutUrl: data.data.authorization_url,
        accessCode: data.data.access_code
      };
    } catch (err) {
      return {
        success: false,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        message: err.message || "Network error communicating with Paystack"
      };
    }
  }
  async verifyPayment(providerReference, schoolId) {
    const secretKey = this.getSecretKey(schoolId);
    if (!secretKey) {
      return {
        success: false,
        status: "FAILED",
        amountKobo: 0,
        currency: "NGN",
        providerReference,
        internalReference: "",
        message: "Paystack secret key is missing."
      };
    }
    try {
      const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(providerReference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` }
      });
      const data = await response.json();
      if (!response.ok || !data.status) {
        return {
          success: false,
          status: "FAILED",
          amountKobo: 0,
          currency: "NGN",
          providerReference,
          internalReference: "",
          message: data.message || "Paystack verification failed"
        };
      }
      const tx = data.data;
      const status = tx.status === "success" ? "SUCCESS" : "FAILED";
      const internalRef = tx.metadata?.internal_reference || "";
      return {
        success: tx.status === "success",
        status,
        amountKobo: Math.round(tx.amount),
        // Paystack returns amount in kobo
        currency: tx.currency || "NGN",
        providerReference,
        internalReference: internalRef,
        paidAt: tx.paid_at || (/* @__PURE__ */ new Date()).toISOString(),
        rawResponse: tx
      };
    } catch (err) {
      return {
        success: false,
        status: "FAILED",
        amountKobo: 0,
        currency: "NGN",
        providerReference,
        internalReference: "",
        message: err.message || "Network error during Paystack verification"
      };
    }
  }
  verifyWebhookSignature(rawBody, signature, schoolId) {
    const secretKey = this.getSecretKey(schoolId);
    if (!secretKey || !signature) return false;
    const hash = crypto4.createHmac("sha512", secretKey).update(rawBody).digest("hex");
    return hash === signature;
  }
};
var FlutterwaveProvider = class {
  constructor() {
    this.name = "FLUTTERWAVE";
    this.displayName = "Flutterwave (Cards, Bank Account, USSD, Barter)";
  }
  getSecretKey(schoolId) {
    if (schoolId) {
      const setting = db.prepare("SELECT flutterwave_secret_key FROM school_settings WHERE school_id = ?").get(schoolId);
      if (setting?.flutterwave_secret_key) return setting.flutterwave_secret_key;
    }
    return process.env.FLUTTERWAVE_SECRET_KEY || null;
  }
  getWebhookSecret(schoolId) {
    if (schoolId) {
      const setting = db.prepare("SELECT webhook_secret FROM school_settings WHERE school_id = ?").get(schoolId);
      if (setting?.webhook_secret) return setting.webhook_secret;
    }
    return process.env.FLUTTERWAVE_SECRET_HASH || process.env.WEBHOOK_SECRET || null;
  }
  isConfigured(schoolId) {
    const key = this.getSecretKey(schoolId);
    return Boolean(key && key.startsWith("FLWSECK_"));
  }
  async initializePayment(params) {
    const secretKey = this.getSecretKey(params.schoolId);
    const providerRef = `flw_${Date.now()}_${crypto4.randomBytes(4).toString("hex")}`;
    const countRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ?").get(params.schoolId);
    const internalRef = generateInternalPaymentReference("PAY", countRow.c + 1);
    if (!secretKey || !secretKey.startsWith("FLWSECK_")) {
      return {
        success: false,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        message: "Flutterwave is not configured with live credentials. Configure FLUTTERWAVE_SECRET_KEY in School Settings or environment."
      };
    }
    try {
      const amountNaira = toNaira(params.amountKobo);
      const payload = {
        tx_ref: providerRef,
        amount: amountNaira,
        currency: "NGN",
        redirect_url: params.callbackUrl,
        customer: {
          email: params.email,
          name: params.studentName || "Student Guardian"
        },
        meta: {
          ...params.metadata,
          school_id: params.schoolId,
          student_id: params.studentId,
          invoice_id: params.invoiceId,
          internal_reference: internalRef
        },
        customizations: {
          title: "School Fees Payment",
          description: `Payment for Invoice #${params.invoiceNumber || params.invoiceId}`
        }
      };
      const response = await fetch("https://api.flutterwave.com/v3/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || data.status !== "success") {
        return {
          success: false,
          provider: this.name,
          providerReference: providerRef,
          internalReference: internalRef,
          message: data.message || "Failed to initialize Flutterwave payment"
        };
      }
      return {
        success: true,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        authorizationUrl: data.data.link,
        checkoutUrl: data.data.link
      };
    } catch (err) {
      return {
        success: false,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        message: err.message || "Network error communicating with Flutterwave"
      };
    }
  }
  async verifyPayment(providerReference, schoolId) {
    const secretKey = this.getSecretKey(schoolId);
    if (!secretKey) {
      return {
        success: false,
        status: "FAILED",
        amountKobo: 0,
        currency: "NGN",
        providerReference,
        internalReference: "",
        message: "Flutterwave secret key is missing."
      };
    }
    try {
      const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerReference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` }
      });
      const data = await response.json();
      if (!response.ok || data.status !== "success") {
        return {
          success: false,
          status: "FAILED",
          amountKobo: 0,
          currency: "NGN",
          providerReference,
          internalReference: "",
          message: data.message || "Flutterwave transaction verification failed"
        };
      }
      const tx = data.data;
      const status = tx.status === "successful" ? "SUCCESS" : "FAILED";
      const amountKobo = toKobo(tx.amount);
      return {
        success: tx.status === "successful",
        status,
        amountKobo,
        currency: tx.currency || "NGN",
        providerReference,
        internalReference: tx.meta?.internal_reference || "",
        paidAt: tx.created_at || (/* @__PURE__ */ new Date()).toISOString(),
        rawResponse: tx
      };
    } catch (err) {
      return {
        success: false,
        status: "FAILED",
        amountKobo: 0,
        currency: "NGN",
        providerReference,
        internalReference: "",
        message: err.message || "Network error during Flutterwave verification"
      };
    }
  }
  verifyWebhookSignature(_rawBody, signature, schoolId) {
    const secret = this.getWebhookSecret(schoolId);
    if (!secret || !signature) return false;
    return secret === signature;
  }
};
var TestSandboxProvider = class {
  constructor() {
    this.name = "TEST_SANDBOX";
    this.displayName = "Instant Sandbox Checkout (Testing & Demo Verification)";
  }
  isConfigured(_schoolId) {
    return true;
  }
  async initializePayment(params) {
    const providerRef = `test_sndbx_${Date.now()}_${crypto4.randomBytes(3).toString("hex")}`;
    const countRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ?").get(params.schoolId);
    const internalRef = generateInternalPaymentReference("SNDBX", countRow.c + 1);
    return {
      success: true,
      provider: this.name,
      providerReference: providerRef,
      internalReference: internalRef,
      isSandbox: true,
      message: "Sandbox transaction initialized. Ready for instant simulation."
    };
  }
  async verifyPayment(providerReference) {
    return {
      success: true,
      status: "SUCCESS",
      amountKobo: 0,
      // determined by invoice context in caller
      currency: "NGN",
      providerReference,
      internalReference: "",
      paidAt: (/* @__PURE__ */ new Date()).toISOString(),
      rawResponse: { mode: "sandbox", verified: true }
    };
  }
  verifyWebhookSignature(_rawBody, signature) {
    return !signature || signature === "sandbox-test-sig";
  }
};
var ManualProvider = class {
  constructor() {
    this.name = "MANUAL";
    this.displayName = "Manual Bursary Entry (Cash, POS, Direct Bank Transfer)";
  }
  isConfigured(_schoolId) {
    return true;
  }
  async initializePayment(params) {
    const countRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ?").get(params.schoolId);
    const internalRef = generateInternalPaymentReference("MAN", countRow.c + 1);
    const providerRef = `man_${Date.now()}_${crypto4.randomBytes(3).toString("hex")}`;
    return {
      success: true,
      provider: this.name,
      providerReference: providerRef,
      internalReference: internalRef
    };
  }
  async verifyPayment(providerReference) {
    return {
      success: true,
      status: "SUCCESS",
      amountKobo: 0,
      currency: "NGN",
      providerReference,
      internalReference: "",
      paidAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  verifyWebhookSignature() {
    return false;
  }
};
var BachsPaymentProvider = class {
  constructor() {
    this.name = "BACHS";
    this.displayName = "Bachs.io (Cards, Bank Transfer, USSD, Stablecoins & Mobile Money)";
  }
  getApiKey(schoolId) {
    if (schoolId) {
      const setting = db.prepare("SELECT * FROM school_settings WHERE school_id = ?").get(schoolId);
      if (setting?.bachs_api_key) return setting.bachs_api_key;
    }
    return process.env.BACHS_API_KEY || process.env.BACHS_SECRET_KEY || null;
  }
  getWebhookSecret(schoolId) {
    if (schoolId) {
      const setting = db.prepare("SELECT * FROM school_settings WHERE school_id = ?").get(schoolId);
      if (setting?.bachs_webhook_secret) return setting.bachs_webhook_secret;
    }
    return process.env.BACHS_WEBHOOK_SECRET || null;
  }
  getApiBase() {
    const key = this.getApiKey();
    if (key && key.startsWith("sk_live_")) {
      return "https://api.bachs.io";
    }
    return "https://sandbox-api.bachs.io";
  }
  isConfigured(schoolId) {
    const key = this.getApiKey(schoolId);
    const secret = this.getWebhookSecret(schoolId);
    return Boolean(key && (key.startsWith("sk_live_") || key.startsWith("sk_sandbox_")) || secret);
  }
  async initializePayment(params) {
    const apiKey = this.getApiKey(params.schoolId);
    const countRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ?").get(params.schoolId);
    const internalRef = generateInternalPaymentReference("BCH", countRow.c + 1);
    const providerRef = `bch_${Date.now()}_${crypto4.randomBytes(4).toString("hex")}`;
    if (!apiKey) {
      const appUrl = process.env.APP_URL || "http://localhost:3000";
      const checkoutUrl = `${appUrl}/api/v1/webhooks/bachs-demo-checkout?ref=${providerRef}&internal=${internalRef}&amount=${params.amountKobo}&school=${params.schoolId}`;
      return {
        success: true,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        checkoutUrl,
        authorizationUrl: checkoutUrl,
        isSandbox: true,
        message: "Bachs sandbox session initialized (API key in demo mode)"
      };
    }
    try {
      const payload = {
        amount: params.amountKobo,
        // in minor units
        currency: params.currency || "NGN",
        customer: {
          email: params.email,
          name: params.studentName || "School Pay Subscriber"
        },
        metadata: {
          ...params.metadata,
          school_id: params.schoolId,
          student_id: params.studentId,
          invoice_id: params.invoiceId,
          internal_reference: internalRef
        },
        success_url: params.callbackUrl || `${process.env.APP_URL || "http://localhost:3000"}/?status=success&ref=${providerRef}`,
        cancel_url: params.callbackUrl || `${process.env.APP_URL || "http://localhost:3000"}/?status=cancelled&ref=${providerRef}`
      };
      const res = await fetch(`${this.getApiBase()}/v1/checkouts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `Bachs checkout error: HTTP ${res.status}`);
      }
      return {
        success: true,
        provider: this.name,
        providerReference: data.id || data.reference || providerRef,
        internalReference: internalRef,
        checkoutUrl: data.checkout_url || data.hosted_url || data.url,
        authorizationUrl: data.checkout_url || data.hosted_url || data.url
      };
    } catch (err) {
      console.warn("[BachsPaymentProvider] API call failed, falling back to simulated sandbox:", err.message);
      const appUrl = process.env.APP_URL || "http://localhost:3000";
      const checkoutUrl = `${appUrl}/api/v1/webhooks/bachs-demo-checkout?ref=${providerRef}&internal=${internalRef}&amount=${params.amountKobo}&school=${params.schoolId}`;
      return {
        success: true,
        provider: this.name,
        providerReference: providerRef,
        internalReference: internalRef,
        checkoutUrl,
        authorizationUrl: checkoutUrl,
        isSandbox: true,
        message: `Bachs sandbox fallback: ${err.message}`
      };
    }
  }
  async verifyPayment(providerReference, schoolId) {
    const apiKey = this.getApiKey(schoolId);
    if (!apiKey) {
      return {
        success: true,
        status: "SUCCESS",
        amountKobo: 0,
        currency: "NGN",
        providerReference,
        internalReference: "",
        paidAt: (/* @__PURE__ */ new Date()).toISOString(),
        rawResponse: { mode: "sandbox_fallback", verified: true }
      };
    }
    try {
      const res = await fetch(`${this.getApiBase()}/v1/checkouts/${providerReference}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          status: "FAILED",
          amountKobo: 0,
          currency: "NGN",
          providerReference,
          internalReference: "",
          message: data.message || `HTTP ${res.status}`
        };
      }
      const statusMap = {
        succeeded: "SUCCESS",
        paid: "SUCCESS",
        completed: "SUCCESS",
        pending: "PENDING",
        failed: "FAILED",
        expired: "CANCELLED"
      };
      const status = statusMap[data.status] || "PENDING";
      return {
        success: status === "SUCCESS",
        status,
        amountKobo: Number(data.amount) || 0,
        currency: data.currency || "NGN",
        providerReference,
        internalReference: data.metadata?.internal_reference || "",
        paidAt: data.paid_at || (/* @__PURE__ */ new Date()).toISOString(),
        rawResponse: data
      };
    } catch (err) {
      return {
        success: false,
        status: "FAILED",
        amountKobo: 0,
        currency: "NGN",
        providerReference,
        internalReference: "",
        message: err.message
      };
    }
  }
  /**
   * Verify Bachs webhook signature.
   * Format: HMAC-SHA256 of `${timestamp}.${rawBody}` (or `${timestamp}${rawBody}` or `rawBody`) compared against X-Bachs-Signature
   */
  verifyWebhookSignature(rawBody, signature, schoolId, timestamp) {
    const secret = this.getWebhookSecret(schoolId);
    if (secret) {
      if (!signature) {
        return false;
      }
      if (timestamp) {
        const now = Math.floor(Date.now() / 1e3);
        const ts = parseInt(timestamp, 10);
        if (!isNaN(ts) && Math.abs(now - ts) > 300) {
          console.warn("[Bachs] Webhook timestamp outside 300s window (replay defense)");
          return false;
        }
      }
      try {
        let cleanSignature = signature.trim();
        if (cleanSignature.startsWith("sha256=")) {
          cleanSignature = cleanSignature.slice(7);
        } else if (cleanSignature.includes("v1=")) {
          const parts = cleanSignature.split(",");
          const v1Part = parts.find((p) => p.startsWith("v1="));
          if (v1Part) cleanSignature = v1Part.slice(3);
        }
        const candidates = timestamp ? [`${timestamp}.${rawBody}`, `${timestamp}${rawBody}`, rawBody] : [rawBody];
        for (const payloadToSign of candidates) {
          const computed = crypto4.createHmac("sha256", secret).update(payloadToSign).digest("hex");
          if (cleanSignature.toLowerCase() === computed.toLowerCase()) {
            return true;
          }
          try {
            const sigBuffer = Buffer.from(cleanSignature, "hex");
            const compBuffer = Buffer.from(computed, "hex");
            if (sigBuffer.length === compBuffer.length && crypto4.timingSafeEqual(sigBuffer, compBuffer)) {
              return true;
            }
          } catch {
          }
        }
        return false;
      } catch {
        return false;
      }
    }
    if (!signature || signature === "bachs-sandbox-sig" || signature === "test-signature") {
      return true;
    }
    return false;
  }
};
var PaymentService = class {
  constructor() {
    this.providers = /* @__PURE__ */ new Map();
    this.registerProvider(new PaystackProvider());
    this.registerProvider(new FlutterwaveProvider());
    this.registerProvider(new BachsPaymentProvider());
    this.registerProvider(new ManualProvider());
    this.registerProvider(new TestSandboxProvider());
  }
  registerProvider(provider) {
    this.providers.set(provider.name, provider);
  }
  getProvider(name) {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Unsupported payment provider: ${name}`);
    }
    return provider;
  }
  getRegisteredGateways() {
    return Array.from(this.providers.keys());
  }
  isConfigured(name, schoolId) {
    return this.getProvider(name).isConfigured(schoolId);
  }
  getAllProviders(schoolId) {
    return Array.from(this.providers.values()).map((p) => ({
      name: p.name,
      displayName: p.displayName,
      isConfigured: p.isConfigured(schoolId)
    }));
  }
};
var paymentService = new PaymentService();

// server/notificationService.ts
import crypto5 from "node:crypto";
var NotificationService = class {
  /**
   * Persist in-app notification to the notifications table
   */
  createNotification(params) {
    const id = `notif_${crypto5.randomBytes(8).toString("hex")}`;
    const dataJson = params.data ? JSON.stringify(params.data) : null;
    try {
      db.prepare(`
        INSERT INTO notifications (id, school_id, user_id, type, title, message, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        params.schoolId,
        params.userId || null,
        params.type,
        params.title,
        params.message,
        dataJson
      );
    } catch (e) {
      console.warn("[NotificationService] Failed to insert notification:", e?.message);
    }
    this.dispatchExternalChannels(params);
    return id;
  }
  async notify(params) {
    const schoolId = params.school_id || params.schoolId || "";
    const userId = params.user_id !== void 0 ? params.user_id : params.userId;
    const id = params.id || `notif_${crypto5.randomBytes(8).toString("hex")}`;
    const dataJson = params.data ? JSON.stringify(params.data) : null;
    try {
      db.prepare(`
        INSERT INTO notifications (id, school_id, user_id, type, title, message, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        schoolId,
        userId || null,
        params.type,
        params.title,
        params.message,
        dataJson
      );
    } catch (e) {
      console.warn("[NotificationService] Failed to insert notification:", e?.message);
    }
    this.dispatchExternalChannels({
      schoolId,
      userId,
      type: params.type,
      title: params.title,
      message: params.message,
      data: params.data
    });
    return id;
  }
  /**
   * Broadcast notification to all school financial admins / bursars
   */
  notifySchoolAdmins(schoolId, type, title, message, data) {
    try {
      const adminUsers = db.prepare(`
        SELECT DISTINCT u.id
        FROM user_roles ur
        JOIN users u ON ur.user_id = u.id
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.school_id = ? AND r.name IN ('SCHOOL_OWNER', 'SCHOOL_ADMIN', 'BURSAR')
      `).all(schoolId);
      for (const admin of adminUsers) {
        this.createNotification({
          schoolId,
          userId: admin.id,
          type,
          title,
          message,
          data
        });
      }
    } catch (err) {
      console.warn("[NotificationService] Admin broadcast error:", err?.message);
    }
  }
  /**
   * Notify parents linked to a student
   */
  notifyParentsOfStudent(schoolId, studentId, type, title, message, data) {
    try {
      const parents = db.prepare(`
        SELECT DISTINCT p.id as parent_record_id, p.email, p.phone
        FROM parent_students ps
        JOIN parents p ON ps.parent_id = p.id
        WHERE ps.school_id = ? AND ps.student_id = ?
      `).all(schoolId, studentId);
      for (const parent of parents) {
        let userId = null;
        if (parent.email) {
          const userRow = db.prepare("SELECT id FROM users WHERE email = ?").get(parent.email);
          if (userRow) userId = userRow.id;
        }
        this.createNotification({
          schoolId,
          userId,
          type,
          title,
          message,
          data: {
            ...data,
            parentEmail: parent.email,
            parentPhone: parent.phone,
            studentId
          }
        });
      }
    } catch (err) {
      console.warn("[NotificationService] Parent notification error:", err?.message);
    }
  }
  /**
   * Dispatches to email/SMS/WhatsApp abstractions without requiring external credentials
   */
  dispatchExternalChannels(params) {
    const channels = [{ channel: "IN_APP", status: "DELIVERED" }];
    const settings = db.prepare("SELECT payment_notification_email, payment_notification_sms FROM school_settings WHERE school_id = ?").get(params.schoolId);
    if (settings?.payment_notification_email) {
      channels.push({ channel: "EMAIL", status: "SIMULATED" });
    }
    if (settings?.payment_notification_sms) {
      channels.push({ channel: "SMS", status: "SIMULATED" });
    }
    return channels;
  }
};
var notificationService = new NotificationService();

// server/paymentRoutes.ts
var paymentRouter = Router();
var FINANCIAL_ADMIN_ROLES2 = ["SUPER_ADMIN", "SCHOOL_OWNER", "SCHOOL_ADMIN", "BURSAR"];
function issueOfficialReceipt(params) {
  const schoolRow = db.prepare("SELECT slug FROM schools WHERE id = ?").get(params.schoolId);
  const slug = schoolRow?.slug || "SCH";
  const countRow = db.prepare("SELECT COUNT(*) as c FROM receipts WHERE school_id = ?").get(params.schoolId);
  const receiptNumber = generateReceiptNumber(slug, countRow.c + 1);
  const receiptId = `rcp_${crypto6.randomBytes(8).toString("hex")}`;
  db.prepare(`
    INSERT INTO receipts (
      id, school_id, receipt_number, payment_id, invoice_id, student_id,
      amount, previous_balance, current_balance, issue_date, issued_by, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    receiptId,
    params.schoolId,
    receiptNumber,
    params.paymentId,
    params.invoiceId,
    params.studentId,
    params.amountKobo,
    params.previousBalanceKobo,
    params.currentBalanceKobo,
    (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    params.issuedBy || null,
    params.notes || null
  );
  return { receiptId, receiptNumber };
}
paymentRouter.get(
  "/payments",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const {
      student_id,
      class_id,
      payment_method,
      status,
      invoice_id,
      start_date,
      end_date,
      min_amount,
      max_amount,
      search,
      limit = "50",
      offset = "0"
    } = req.query;
    let sql = `
      SELECT p.*,
             inv.invoice_number,
             inv.total as invoice_total,
             inv.balance as invoice_balance,
             s.full_name as student_name,
             s.admission_number,
             s.class_name,
             c.name as class_display_name,
             u.full_name as receiver_name,
             v.full_name as verifier_name,
             r.receipt_number,
             r.id as receipt_id
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN users u ON p.received_by = u.id
      LEFT JOIN users v ON p.verified_by = v.id
      LEFT JOIN receipts r ON p.id = r.payment_id
      WHERE p.school_id = ?
    `;
    const params = [schoolId];
    if (student_id) {
      sql += ` AND p.student_id = ?`;
      params.push(student_id);
    }
    if (class_id) {
      sql += ` AND s.class_id = ?`;
      params.push(class_id);
    }
    if (payment_method) {
      sql += ` AND p.payment_method = ?`;
      params.push(payment_method);
    }
    if (status) {
      sql += ` AND p.status = ?`;
      params.push(status);
    }
    if (invoice_id) {
      sql += ` AND p.invoice_id = ?`;
      params.push(invoice_id);
    }
    if (start_date) {
      sql += ` AND p.payment_date >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      sql += ` AND p.payment_date <= ?`;
      params.push(end_date);
    }
    if (min_amount) {
      const minKobo = toKobo(Number(min_amount));
      sql += ` AND p.amount >= ?`;
      params.push(minKobo);
    }
    if (max_amount) {
      const maxKobo = toKobo(Number(max_amount));
      sql += ` AND p.amount <= ?`;
      params.push(maxKobo);
    }
    if (search && typeof search === "string" && search.trim()) {
      sql += ` AND (p.payment_reference LIKE ? OR p.internal_reference LIKE ? OR s.full_name LIKE ? OR s.admission_number LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }
    sql += ` ORDER BY p.payment_date DESC, p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);
    const payments = db.prepare(sql).all(...params);
    return res.json({
      success: true,
      count: payments.length,
      payments: payments.map((p) => ({
        ...p,
        amount_naira: toNaira(p.amount),
        invoice_total_naira: toNaira(p.invoice_total),
        invoice_balance_naira: toNaira(p.invoice_balance)
      }))
    });
  }
);
paymentRouter.get(
  "/payments/:id",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const payment = db.prepare(`
      SELECT p.*,
             inv.invoice_number,
             inv.total as invoice_total,
             inv.balance as invoice_balance,
             s.full_name as student_name,
             s.admission_number,
             s.class_name,
             c.name as class_display_name,
             u.full_name as receiver_name,
             v.full_name as verifier_name,
             r.id as receipt_id,
             r.receipt_number,
             r.previous_balance,
             r.current_balance
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN users u ON p.received_by = u.id
      LEFT JOIN users v ON p.verified_by = v.id
      LEFT JOIN receipts r ON p.id = r.payment_id
      WHERE p.id = ? AND p.school_id = ?
    `).get(id, schoolId);
    if (!payment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Payment record not found." });
    }
    return res.json({
      success: true,
      payment: {
        ...payment,
        amount_naira: toNaira(payment.amount),
        invoice_total_naira: toNaira(payment.invoice_total),
        invoice_balance_naira: toNaira(payment.invoice_balance),
        previous_balance_naira: payment.previous_balance !== null ? toNaira(payment.previous_balance) : void 0,
        current_balance_naira: payment.current_balance !== null ? toNaira(payment.current_balance) : void 0
      }
    });
  }
);
paymentRouter.post(
  "/invoices/:id/payments",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES2),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id: invoiceId } = req.params;
    const {
      amount,
      amount_kobo,
      payment_method,
      provider = "MANUAL",
      provider_reference,
      payment_date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      notes,
      is_pending = false
      // If true, logged as PENDING awaiting bank reconciliation
    } = req.body;
    const validMethods = ["BANK_TRANSFER", "POS", "CASH", "ONLINE", "CHEQUE", "OTHER"];
    if (!payment_method || !validMethods.includes(payment_method)) {
      return res.status(400).json({ error: "INVALID_PAYMENT_METHOD", message: `Payment method must be one of: ${validMethods.join(", ")}` });
    }
    const invoice = db.prepare("SELECT * FROM invoices WHERE id = ? AND school_id = ?").get(invoiceId, schoolId);
    if (!invoice) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found in your school." });
    }
    if (invoice.status === "CANCELLED") {
      return res.status(400).json({ error: "INVOICE_CANCELLED", message: "Cannot record payment for a CANCELLED invoice." });
    }
    if (invoice.status === "PAID" && invoice.balance <= 0) {
      return res.status(400).json({ error: "ALREADY_PAID", message: "Invoice is already fully settled." });
    }
    const payKobo = amount_kobo !== void 0 ? Math.round(Number(amount_kobo)) : toKobo(amount || 0);
    if (payKobo <= 0) {
      return res.status(400).json({ error: "INVALID_AMOUNT", message: "Payment amount must be greater than zero." });
    }
    if (payKobo > invoice.balance) {
      return res.status(400).json({
        error: "OVERPAYMENT_NOT_ALLOWED",
        message: `Payment amount (\u20A6${toNaira(payKobo).toLocaleString()}) exceeds outstanding balance (\u20A6${toNaira(invoice.balance).toLocaleString()}).`
      });
    }
    const schoolRow = db.prepare("SELECT slug FROM schools WHERE id = ?").get(schoolId);
    const slug = schoolRow?.slug || "SCH";
    const countRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ?").get(schoolId);
    const internalRef = generateInternalPaymentReference(slug, countRow.c + 1);
    const paymentRef = internalRef;
    const paymentId = `pay_${crypto6.randomBytes(8).toString("hex")}`;
    const initialStatus = is_pending ? "PENDING" : "SUCCESS";
    const paidAt = (/* @__PURE__ */ new Date()).toISOString();
    const verifiedAt = is_pending ? null : paidAt;
    const verifiedBy = is_pending ? null : req.user?.id || null;
    db.prepare(`
      INSERT INTO payments (
        id, school_id, invoice_id, student_id, payment_reference, internal_reference,
        amount, currency, payment_method, provider, provider_reference, status,
        payment_date, paid_at, verified_at, verified_by, notes, received_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NGN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      paymentId,
      schoolId,
      invoiceId,
      invoice.student_id,
      paymentRef,
      internalRef,
      payKobo,
      payment_method,
      provider,
      provider_reference || null,
      initialStatus,
      payment_date,
      paidAt,
      verifiedAt,
      verifiedBy,
      notes || null,
      req.user?.id || null
    );
    let newAmountPaidKobo = invoice.amount_paid;
    let newBalanceKobo = invoice.balance;
    let newStatus = invoice.status;
    let receiptData = null;
    if (initialStatus === "SUCCESS") {
      newAmountPaidKobo = invoice.amount_paid + payKobo;
      newBalanceKobo = Math.max(0, invoice.total - newAmountPaidKobo);
      newStatus = determineInvoiceStatus(invoice.total, newAmountPaidKobo, invoice.due_date, invoice.status);
      db.prepare(`
        UPDATE invoices SET
          amount_paid = ?,
          balance = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?
      `).run(newAmountPaidKobo, newBalanceKobo, newStatus, invoiceId, schoolId);
      receiptData = issueOfficialReceipt({
        schoolId,
        paymentId,
        invoiceId,
        studentId: invoice.student_id,
        amountKobo: payKobo,
        previousBalanceKobo: invoice.balance,
        currentBalanceKobo: newBalanceKobo,
        issuedBy: req.user?.id,
        notes
      });
      notificationService.notifySchoolAdmins(
        schoolId,
        "PAYMENT_RECEIVED",
        `Payment Received: \u20A6${toNaira(payKobo).toLocaleString()}`,
        `Payment ${internalRef} recorded against Invoice #${invoice.invoice_number}. Receipt #${receiptData.receiptNumber} issued.`,
        { invoiceId, paymentId, receiptId: receiptData.receiptId, amountKobo: payKobo }
      );
      notificationService.notifyParentsOfStudent(
        schoolId,
        invoice.student_id,
        "RECEIPT_AVAILABLE",
        `Payment Receipt Ready: \u20A6${toNaira(payKobo).toLocaleString()}`,
        `Your payment of \u20A6${toNaira(payKobo).toLocaleString()} has been received and confirmed. Receipt #${receiptData.receiptNumber} is now available.`,
        { invoiceId, paymentId, receiptId: receiptData.receiptId, amountKobo: payKobo }
      );
    } else {
      notificationService.notifySchoolAdmins(
        schoolId,
        "PAYMENT_RECEIVED",
        `Pending Payment Logged: \u20A6${toNaira(payKobo).toLocaleString()}`,
        `Manual payment ${internalRef} logged as PENDING verification. Requires Bursar review.`,
        { invoiceId, paymentId, amountKobo: payKobo }
      );
    }
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: is_pending ? "RECORD_PENDING_PAYMENT" : "RECORD_PAYMENT",
      entity: "PAYMENT",
      entityId: paymentId,
      ipAddress: req.ip,
      metadata: { invoiceId, internalRef, amountKobo: payKobo, status: initialStatus, newBalanceKobo }
    });
    return res.status(201).json({
      success: true,
      message: is_pending ? "Payment logged as PENDING verification." : "Payment confirmed and receipt issued.",
      payment: {
        id: paymentId,
        payment_reference: paymentRef,
        internal_reference: internalRef,
        amount: payKobo,
        amount_naira: toNaira(payKobo),
        payment_method,
        status: initialStatus,
        payment_date,
        receipt: receiptData
      },
      invoice: {
        id: invoiceId,
        total: invoice.total,
        amount_paid: newAmountPaidKobo,
        balance: newBalanceKobo,
        status: newStatus,
        total_naira: toNaira(invoice.total),
        amount_paid_naira: toNaira(newAmountPaidKobo),
        balance_naira: toNaira(newBalanceKobo)
      }
    });
  }
);
paymentRouter.post(
  "/payments/:id/verify",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES2),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const payment = db.prepare("SELECT * FROM payments WHERE id = ? AND school_id = ?").get(id, schoolId);
    if (!payment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Payment record not found." });
    }
    if (payment.status === "SUCCESS") {
      return res.status(400).json({ error: "ALREADY_VERIFIED", message: "Payment has already been verified." });
    }
    if (payment.status === "CANCELLED" || payment.status === "FAILED") {
      return res.status(400).json({ error: "INVALID_STATUS", message: `Cannot verify a ${payment.status} payment.` });
    }
    const invoice = db.prepare("SELECT * FROM invoices WHERE id = ? AND school_id = ?").get(payment.invoice_id, schoolId);
    if (!invoice) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Associated invoice not found." });
    }
    if (payment.amount > invoice.balance) {
      return res.status(400).json({
        error: "OVERPAYMENT_NOT_ALLOWED",
        message: `Verified payment amount (\u20A6${toNaira(payment.amount).toLocaleString()}) exceeds invoice balance (\u20A6${toNaira(invoice.balance).toLocaleString()}).`
      });
    }
    const newAmountPaidKobo = invoice.amount_paid + payment.amount;
    const newBalanceKobo = Math.max(0, invoice.total - newAmountPaidKobo);
    const newStatus = determineInvoiceStatus(invoice.total, newAmountPaidKobo, invoice.due_date, invoice.status);
    const verifiedAt = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`
      UPDATE payments SET
        status = 'SUCCESS',
        verified_at = ?,
        verified_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(verifiedAt, req.user?.id || null, id, schoolId);
    db.prepare(`
      UPDATE invoices SET
        amount_paid = ?,
        balance = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(newAmountPaidKobo, newBalanceKobo, newStatus, invoice.id, schoolId);
    const receiptData = issueOfficialReceipt({
      schoolId,
      paymentId: payment.id,
      invoiceId: invoice.id,
      studentId: payment.student_id,
      amountKobo: payment.amount,
      previousBalanceKobo: invoice.balance,
      currentBalanceKobo: newBalanceKobo,
      issuedBy: req.user?.id,
      notes: `Verified by Bursar: ${req.user?.full_name || req.user?.email}`
    });
    notificationService.notifyParentsOfStudent(
      schoolId,
      payment.student_id,
      "PAYMENT_VERIFIED",
      `Payment Confirmed: \u20A6${toNaira(payment.amount).toLocaleString()}`,
      `Your payment ${payment.internal_reference || payment.payment_reference} has been verified by the Bursary. Official Receipt #${receiptData.receiptNumber} is ready.`,
      { paymentId: payment.id, receiptId: receiptData.receiptId, amountKobo: payment.amount }
    );
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "VERIFY_PAYMENT",
      entity: "PAYMENT",
      entityId: id,
      ipAddress: req.ip,
      metadata: { invoiceId: invoice.id, paymentRef: payment.internal_reference, amountKobo: payment.amount, receiptNumber: receiptData.receiptNumber }
    });
    return res.json({
      success: true,
      message: "Payment verified successfully and official receipt issued.",
      payment: {
        ...payment,
        status: "SUCCESS",
        verified_at: verifiedAt,
        receipt: receiptData
      },
      invoice: {
        id: invoice.id,
        total: invoice.total,
        amount_paid: newAmountPaidKobo,
        balance: newBalanceKobo,
        status: newStatus,
        total_naira: toNaira(invoice.total),
        balance_naira: toNaira(newBalanceKobo)
      }
    });
  }
);
paymentRouter.post(
  "/payments/:id/cancel",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES2),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const { reason } = req.body;
    const payment = db.prepare("SELECT * FROM payments WHERE id = ? AND school_id = ?").get(id, schoolId);
    if (!payment) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Payment record not found." });
    }
    if (payment.status === "CANCELLED") {
      return res.status(400).json({ error: "ALREADY_CANCELLED", message: "Payment is already cancelled." });
    }
    const wasSuccess = payment.status === "SUCCESS";
    if (wasSuccess) {
      const invoice = db.prepare("SELECT * FROM invoices WHERE id = ? AND school_id = ?").get(payment.invoice_id, schoolId);
      if (invoice) {
        const rollbackPaidKobo = Math.max(0, invoice.amount_paid - payment.amount);
        const rollbackBalanceKobo = invoice.total - rollbackPaidKobo;
        const rollbackStatus = determineInvoiceStatus(invoice.total, rollbackPaidKobo, invoice.due_date, invoice.status);
        db.prepare(`
          UPDATE invoices SET
            amount_paid = ?,
            balance = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND school_id = ?
        `).run(rollbackPaidKobo, rollbackBalanceKobo, rollbackStatus, invoice.id, schoolId);
      }
    }
    db.prepare(`
      UPDATE payments SET
        status = 'CANCELLED',
        notes = COALESCE(notes || ' | ', '') || ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(`[Cancelled: ${reason || "Bursar cancellation"}]`, id, schoolId);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId,
      action: "CANCEL_PAYMENT",
      entity: "PAYMENT",
      entityId: id,
      ipAddress: req.ip,
      metadata: { reason, wasSuccess, amountKobo: payment.amount }
    });
    return res.json({
      success: true,
      message: "Payment cancelled successfully.",
      paymentId: id
    });
  }
);
paymentRouter.get(
  "/receipts",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { student_id, search, limit = "50", offset = "0" } = req.query;
    let sql = `
      SELECT r.*,
             p.payment_reference,
             p.payment_method,
             p.paid_at,
             inv.invoice_number,
             s.full_name as student_name,
             s.admission_number,
             s.class_name,
             u.full_name as issuer_name
      FROM receipts r
      JOIN payments p ON r.payment_id = p.id
      JOIN invoices inv ON r.invoice_id = inv.id
      JOIN students s ON r.student_id = s.id
      LEFT JOIN users u ON r.issued_by = u.id
      WHERE r.school_id = ?
    `;
    const params = [schoolId];
    if (student_id) {
      sql += ` AND r.student_id = ?`;
      params.push(student_id);
    }
    if (search && typeof search === "string" && search.trim()) {
      sql += ` AND (r.receipt_number LIKE ? OR p.payment_reference LIKE ? OR s.full_name LIKE ? OR s.admission_number LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }
    sql += ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);
    const receipts = db.prepare(sql).all(...params);
    return res.json({
      success: true,
      count: receipts.length,
      receipts: receipts.map((r) => ({
        ...r,
        amount_naira: toNaira(r.amount),
        previous_balance_naira: toNaira(r.previous_balance),
        current_balance_naira: toNaira(r.current_balance)
      }))
    });
  }
);
paymentRouter.get(
  "/receipts/:id",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const receipt = db.prepare(`
      SELECT r.*,
             p.payment_reference,
             p.internal_reference,
             p.payment_method,
             p.provider,
             p.status as payment_status,
             p.paid_at,
             inv.invoice_number,
             inv.issue_date as invoice_issue_date,
             inv.total as invoice_total,
             s.full_name as student_name,
             s.first_name,
             s.last_name,
             s.admission_number,
             s.class_name,
             s.class_arm_name,
             c.name as class_display_name,
             u.full_name as issuer_name,
             u.email as issuer_email,
             sch.name as school_name,
             sch.slug as school_slug,
             sch.type as school_type,
             sch.address as school_address,
             sch.state as school_state,
             sch.lga as school_lga,
             sch.phone as school_phone,
             sch.email as school_email,
             sch.website as school_website,
             sch.logo_url as school_logo_url
      FROM receipts r
      JOIN payments p ON r.payment_id = p.id
      JOIN invoices inv ON r.invoice_id = inv.id
      JOIN students s ON r.student_id = s.id
      JOIN schools sch ON r.school_id = sch.id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN users u ON r.issued_by = u.id
      WHERE r.id = ? AND r.school_id = ?
    `).get(id, schoolId);
    if (!receipt) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Receipt not found." });
    }
    return res.json({
      success: true,
      receipt: {
        ...receipt,
        amount_naira: toNaira(receipt.amount),
        previous_balance_naira: toNaira(receipt.previous_balance),
        current_balance_naira: toNaira(receipt.current_balance),
        invoice_total_naira: toNaira(receipt.invoice_total)
      }
    });
  }
);
paymentRouter.get(
  "/payments/:paymentId/receipt",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { paymentId } = req.params;
    const receipt = db.prepare(`SELECT id FROM receipts WHERE payment_id = ? AND school_id = ?`).get(paymentId, schoolId);
    if (!receipt) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Receipt not found for this payment." });
    }
    return res.redirect(`/api/v1/school/receipts/${receipt.id}`);
  }
);
paymentRouter.get(
  "/gateways/status",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const providers = paymentService.getAllProviders(schoolId);
    return res.json({ success: true, providers });
  }
);
paymentRouter.post(
  "/invoices/:id/checkout",
  requireAuth,
  requireTenant,
  async (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id: invoiceId } = req.params;
    const { provider = "TEST_SANDBOX", amount_kobo, email, callback_url } = req.body;
    const invoice = db.prepare(`
      SELECT inv.*, s.full_name as student_name, s.email as student_email
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      WHERE inv.id = ? AND inv.school_id = ?
    `).get(invoiceId, schoolId);
    if (!invoice) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
    }
    if (invoice.balance <= 0) {
      return res.status(400).json({ error: "ALREADY_PAID", message: "Invoice is already settled in full." });
    }
    const payKobo = amount_kobo ? Math.round(Number(amount_kobo)) : invoice.balance;
    if (payKobo <= 0 || payKobo > invoice.balance) {
      return res.status(400).json({ error: "INVALID_AMOUNT", message: "Checkout amount exceeds outstanding balance." });
    }
    const payerEmail = email || req.user?.email || invoice.student_email || "guardian@student.sch.ng";
    try {
      const selectedProvider = paymentService.getProvider(provider);
      const initResult = await selectedProvider.initializePayment({
        schoolId,
        studentId: invoice.student_id,
        invoiceId,
        amountKobo: payKobo,
        email: payerEmail,
        studentName: invoice.student_name,
        invoiceNumber: invoice.invoice_number,
        callbackUrl: callback_url
      });
      return res.json({
        ...initResult,
        amountKobo: payKobo,
        amountNaira: toNaira(payKobo)
      });
    } catch (err) {
      return res.status(500).json({ error: "GATEWAY_ERROR", message: err.message || "Payment gateway initialization failed" });
    }
  }
);
paymentRouter.post(
  "/payments/verify-online",
  requireAuth,
  requireTenant,
  async (req, res) => {
    const schoolId = req.targetSchoolId;
    const { provider = "TEST_SANDBOX", reference, invoice_id, amount_kobo } = req.body;
    if (!reference) {
      return res.status(400).json({ error: "MISSING_REFERENCE", message: "Payment reference is required." });
    }
    const existingPayment = db.prepare("SELECT * FROM payments WHERE provider_reference = ? OR payment_reference = ?").get(reference, reference);
    if (existingPayment) {
      return res.json({
        success: true,
        alreadyProcessed: true,
        message: "Payment has already been confirmed and processed.",
        payment: existingPayment
      });
    }
    const invoice = db.prepare("SELECT * FROM invoices WHERE id = ? AND school_id = ?").get(invoice_id, schoolId);
    if (!invoice) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
    }
    try {
      const gateway = paymentService.getProvider(provider);
      const verification = await gateway.verifyPayment(reference, schoolId);
      if (!verification.success || verification.status !== "SUCCESS") {
        return res.status(400).json({
          success: false,
          error: "VERIFICATION_FAILED",
          message: verification.message || "Payment gateway could not verify transaction."
        });
      }
      const confirmedKobo = verification.amountKobo > 0 ? verification.amountKobo : amount_kobo ? Math.round(Number(amount_kobo)) : invoice.balance;
      if (confirmedKobo > invoice.balance) {
        return res.status(400).json({
          error: "OVERPAYMENT_NOT_ALLOWED",
          message: "Confirmed gateway amount exceeds invoice balance."
        });
      }
      const schoolRow = db.prepare("SELECT slug FROM schools WHERE id = ?").get(schoolId);
      const slug = schoolRow?.slug || "SCH";
      const countRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ?").get(schoolId);
      const internalRef = generateInternalPaymentReference(slug, countRow.c + 1);
      const paymentId = `pay_${crypto6.randomBytes(8).toString("hex")}`;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      db.prepare(`
        INSERT INTO payments (
          id, school_id, invoice_id, student_id, payment_reference, internal_reference,
          amount, currency, payment_method, provider, provider_reference, status,
          payment_date, paid_at, verified_at, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NGN', 'ONLINE', ?, ?, 'SUCCESS', ?, ?, ?, 'Online gateway verified payment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        paymentId,
        schoolId,
        invoice.id,
        invoice.student_id,
        internalRef,
        internalRef,
        confirmedKobo,
        provider,
        reference,
        now.slice(0, 10),
        now,
        now
      );
      const newAmountPaid = invoice.amount_paid + confirmedKobo;
      const newBalance = Math.max(0, invoice.total - newAmountPaid);
      const newStatus = determineInvoiceStatus(invoice.total, newAmountPaid, invoice.due_date, invoice.status);
      db.prepare(`
        UPDATE invoices SET
          amount_paid = ?,
          balance = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?
      `).run(newAmountPaid, newBalance, newStatus, invoice.id, schoolId);
      const receiptData = issueOfficialReceipt({
        schoolId,
        paymentId,
        invoiceId: invoice.id,
        studentId: invoice.student_id,
        amountKobo: confirmedKobo,
        previousBalanceKobo: invoice.balance,
        currentBalanceKobo: newBalance,
        notes: `Online Checkout via ${provider}`
      });
      notificationService.notifySchoolAdmins(
        schoolId,
        "PAYMENT_VERIFIED",
        `Online Payment Verified: \u20A6${toNaira(confirmedKobo).toLocaleString()}`,
        `Payment ${reference} verified successfully via ${provider}. Receipt #${receiptData.receiptNumber} issued.`,
        { invoiceId: invoice.id, paymentId, receiptId: receiptData.receiptId, amountKobo: confirmedKobo }
      );
      notificationService.notifyParentsOfStudent(
        schoolId,
        invoice.student_id,
        "RECEIPT_AVAILABLE",
        `Payment Successful: \u20A6${toNaira(confirmedKobo).toLocaleString()}`,
        `Online payment for Invoice #${invoice.invoice_number} was confirmed. Receipt #${receiptData.receiptNumber} is ready.`,
        { invoiceId: invoice.id, paymentId, receiptId: receiptData.receiptId, amountKobo: confirmedKobo }
      );
      logAudit({
        actorId: req.user?.id,
        actorEmail: req.user?.email,
        schoolId,
        action: "VERIFY_ONLINE_PAYMENT",
        entity: "PAYMENT",
        entityId: paymentId,
        ipAddress: req.ip,
        metadata: { provider, reference, internalRef, amountKobo: confirmedKobo, receiptNumber: receiptData.receiptNumber }
      });
      return res.json({
        success: true,
        message: "Online payment verified and receipt generated.",
        payment: {
          id: paymentId,
          reference,
          internal_reference: internalRef,
          amount_naira: toNaira(confirmedKobo),
          status: "SUCCESS",
          receipt: receiptData
        },
        invoice: {
          id: invoice.id,
          total_naira: toNaira(invoice.total),
          amount_paid_naira: toNaira(newAmountPaid),
          balance_naira: toNaira(newBalance),
          status: newStatus
        }
      });
    } catch (err) {
      return res.status(500).json({ error: "VERIFICATION_ERROR", message: err.message || "Payment verification failed" });
    }
  }
);
paymentRouter.get(
  "/notifications",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const userId = req.user?.id;
    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE school_id = ? AND (user_id IS NULL OR user_id = ?)
      ORDER BY created_at DESC
      LIMIT 50
    `).all(schoolId, userId || "");
    const unreadCountRow = db.prepare(`
      SELECT COUNT(*) as unread
      FROM notifications
      WHERE school_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL
    `).get(schoolId, userId || "");
    return res.json({
      success: true,
      unreadCount: unreadCountRow.unread || 0,
      notifications: notifications.map((n) => ({
        ...n,
        data: n.data ? JSON.parse(n.data) : null
      }))
    });
  }
);
paymentRouter.patch(
  "/notifications/:id/read",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    db.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(id, schoolId);
    return res.json({ success: true, message: "Notification marked as read." });
  }
);
paymentRouter.post(
  "/notifications/mark-all-read",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const userId = req.user?.id;
    db.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE school_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL
    `).run(schoolId, userId || "");
    return res.json({ success: true, message: "All notifications marked as read." });
  }
);
paymentRouter.get(
  "/finance/reports/daily",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const days = Math.min(parseInt(req.query.days || "14", 10), 90);
    const rows = db.prepare(`
      SELECT p.payment_date,
             COUNT(p.id) as transaction_count,
             COALESCE(SUM(p.amount), 0) as total_collected
      FROM payments p
      WHERE p.school_id = ? AND p.status = 'SUCCESS'
      GROUP BY p.payment_date
      ORDER BY p.payment_date DESC
      LIMIT ?
    `).all(schoolId, days);
    return res.json({
      success: true,
      daily: rows.map((r) => ({
        date: r.payment_date,
        count: r.transaction_count,
        total_kobo: r.total_collected,
        total_naira: toNaira(r.total_collected)
      }))
    });
  }
);
paymentRouter.get(
  "/finance/reports/monthly",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const rows = db.prepare(`
      SELECT strftime('%Y-%m', p.payment_date) as month,
             COUNT(p.id) as transaction_count,
             COALESCE(SUM(p.amount), 0) as total_collected
      FROM payments p
      WHERE p.school_id = ? AND p.status = 'SUCCESS'
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `).all(schoolId);
    return res.json({
      success: true,
      monthly: rows.map((r) => ({
        month: r.month,
        count: r.transaction_count,
        total_kobo: r.total_collected,
        total_naira: toNaira(r.total_collected)
      }))
    });
  }
);
paymentRouter.get(
  "/finance/reports/defaulters",
  requireAuth,
  requireTenant,
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { class_id, min_balance } = req.query;
    let sql = `
      SELECT s.id as student_id,
             s.admission_number,
             s.full_name as student_name,
             c.name as class_name,
             COALESCE(SUM(inv.total), 0) as total_billed,
             COALESCE(SUM(inv.amount_paid), 0) as total_paid,
             COALESCE(SUM(inv.balance), 0) as outstanding_balance,
             COUNT(inv.id) as unpaid_invoices_count
      FROM students s
      JOIN invoices inv ON s.id = inv.student_id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.school_id = ? AND inv.balance > 0 AND inv.status != 'CANCELLED'
    `;
    const params = [schoolId];
    if (class_id) {
      sql += ` AND s.class_id = ?`;
      params.push(class_id);
    }
    sql += ` GROUP BY s.id HAVING outstanding_balance > 0`;
    if (min_balance) {
      const minKobo = toKobo(Number(min_balance));
      sql += ` AND outstanding_balance >= ?`;
      params.push(minKobo);
    }
    sql += ` ORDER BY outstanding_balance DESC LIMIT 100`;
    const defaulters = db.prepare(sql).all(...params);
    return res.json({
      success: true,
      count: defaulters.length,
      defaulters: defaulters.map((d) => ({
        ...d,
        total_billed_naira: toNaira(d.total_billed),
        total_paid_naira: toNaira(d.total_paid),
        outstanding_balance_naira: toNaira(d.outstanding_balance)
      }))
    });
  }
);
paymentRouter.get(
  "/finance/reports/export/payments-csv",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES2),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const payments = db.prepare(`
      SELECT p.payment_reference,
             p.internal_reference,
             p.payment_date,
             s.admission_number,
             s.full_name as student_name,
             inv.invoice_number,
             p.amount as amount_kobo,
             p.payment_method,
             p.status,
             p.notes
      FROM payments p
      JOIN invoices inv ON p.invoice_id = inv.id
      JOIN students s ON p.student_id = s.id
      WHERE p.school_id = ?
      ORDER BY p.payment_date DESC
    `).all(schoolId);
    const header = "Payment Reference,Internal Ref,Date,Admission Number,Student Name,Invoice Number,Amount (NGN),Method,Status,Notes\n";
    const rows = payments.map((p) => {
      const naira = (p.amount_kobo / 100).toFixed(2);
      const safeName = `"${(p.student_name || "").replace(/"/g, '""')}"`;
      const safeNotes = `"${(p.notes || "").replace(/"/g, '""')}"`;
      return `${p.payment_reference},${p.internal_reference || ""},${p.payment_date},${p.admission_number},${safeName},${p.invoice_number},${naira},${p.payment_method},${p.status},${safeNotes}`;
    }).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="school_payments_${Date.now()}.csv"`);
    return res.send(header + rows);
  }
);
paymentRouter.get(
  "/finance/reports/export/invoices-csv",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES2),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const invoices = db.prepare(`
      SELECT inv.invoice_number,
             s.admission_number,
             s.full_name as student_name,
             c.name as class_name,
             inv.issue_date,
             inv.due_date,
             inv.subtotal,
             inv.discount,
             inv.total,
             inv.amount_paid,
             inv.balance,
             inv.status,
             inv.notes
      FROM invoices inv
      JOIN students s ON inv.student_id = s.id
      LEFT JOIN classes c ON inv.class_id = c.id
      WHERE inv.school_id = ?
      ORDER BY inv.issue_date DESC
    `).all(schoolId);
    const header = "Invoice Number,Admission Number,Student Name,Class,Issue Date,Due Date,Subtotal (NGN),Discount (NGN),Total (NGN),Paid (NGN),Balance (NGN),Status,Notes\n";
    const rows = invoices.map((i) => {
      const safeName = `"${(i.student_name || "").replace(/"/g, '""')}"`;
      const safeNotes = `"${(i.notes || "").replace(/"/g, '""')}"`;
      return `${i.invoice_number},${i.admission_number},${safeName},"${i.class_name || ""}",${i.issue_date},${i.due_date},${(i.subtotal / 100).toFixed(2)},${(i.discount / 100).toFixed(2)},${(i.total / 100).toFixed(2)},${(i.amount_paid / 100).toFixed(2)},${(i.balance / 100).toFixed(2)},${i.status},${safeNotes}`;
    }).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="school_invoices_${Date.now()}.csv"`);
    return res.send(header + rows);
  }
);
paymentRouter.get(
  "/finance/reports/export/defaulters-csv",
  requireAuth,
  requireTenant,
  requireRole(FINANCIAL_ADMIN_ROLES2),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const defaulters = db.prepare(`
      SELECT s.admission_number,
             s.full_name as student_name,
             c.name as class_name,
             COALESCE(SUM(inv.total), 0) as total_billed,
             COALESCE(SUM(inv.amount_paid), 0) as total_paid,
             COALESCE(SUM(inv.balance), 0) as outstanding_balance,
             COUNT(inv.id) as unpaid_invoices_count
      FROM students s
      JOIN invoices inv ON s.id = inv.student_id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.school_id = ? AND inv.balance > 0 AND inv.status != 'CANCELLED'
      GROUP BY s.id
      ORDER BY outstanding_balance DESC
    `).all(schoolId);
    const header = "Admission Number,Student Name,Class,Total Billed (NGN),Total Paid (NGN),Outstanding Balance (NGN),Unpaid Invoices Count\n";
    const rows = defaulters.map((d) => {
      const safeName = `"${(d.student_name || "").replace(/"/g, '""')}"`;
      return `${d.admission_number},${safeName},"${d.class_name || ""}",${(d.total_billed / 100).toFixed(2)},${(d.total_paid / 100).toFixed(2)},${(d.outstanding_balance / 100).toFixed(2)},${d.unpaid_invoices_count}`;
    }).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="school_defaulters_${Date.now()}.csv"`);
    return res.send(header + rows);
  }
);

// server/adminRoutes.ts
import { Router as Router2 } from "express";
import crypto7 from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";

// src/constants/index.ts
var SCHOOL_STATUSES = [
  "TRIAL",
  "ACTIVE",
  "GRACE_PERIOD",
  "SUSPENDED",
  "EXPIRED",
  "CANCELLED"
];

// server/adminRoutes.ts
var adminRouter = Router2();
adminRouter.get("/stats", requireAuth, requireSuperAdmin, (req, res) => {
  const totalSchools = db.prepare("SELECT COUNT(*) as c FROM schools").get().c;
  const activeSchools = db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'ACTIVE'").get().c;
  const trialSchools = db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'TRIAL'").get().c;
  const graceSchools = db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'GRACE_PERIOD'").get().c;
  const suspendedSchools = db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'SUSPENDED'").get().c;
  const expiredSchools = db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'EXPIRED'").get().c;
  const cancelledSchools = db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'CANCELLED'").get().c;
  const totalStudents = db.prepare("SELECT COUNT(*) as c FROM students").get().c;
  const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  const totalStaff = db.prepare("SELECT COUNT(*) as c FROM staff").get().c;
  const totalInvoices = db.prepare("SELECT COUNT(*) as c FROM invoices").get().c;
  const totalPayments = db.prepare("SELECT COUNT(*) as c FROM payments").get().c;
  const platformRevenueRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo, COUNT(*) as count
    FROM platform_payments
    WHERE status = 'SUCCESS'
  `).get();
  const platformRevenueKobo = Number(platformRevenueRow.total_kobo);
  const schoolRevenueRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo, COUNT(*) as count
    FROM payments
    WHERE status = 'SUCCESS'
  `).get();
  const schoolCollectedRevenueKobo = Number(schoolRevenueRow.total_kobo);
  const activeSubscriptions = db.prepare("SELECT COUNT(*) as c FROM school_subscriptions WHERE status = 'ACTIVE'").get().c;
  const expiringSubscriptions = db.prepare(`
    SELECT COUNT(*) as c FROM school_subscriptions
    WHERE status = 'ACTIVE' AND date(end_date) <= date('now', '+30 days')
  `).get().c;
  const totalPartners = db.prepare("SELECT COUNT(*) as c FROM partners WHERE status = 'ACTIVE'").get().c;
  const commissionRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo
    FROM commissions
    WHERE status IN ('APPROVED', 'PAID')
  `).get();
  const totalCommissionsKobo = Number(commissionRow.total_kobo);
  const recentActivity = db.prepare(`
    SELECT al.*, s.name as school_name
    FROM audit_logs al
    LEFT JOIN schools s ON al.school_id = s.id
    ORDER BY al.created_at DESC
    LIMIT 10
  `).all();
  return res.json({
    success: true,
    stats: {
      totalSchools,
      activeSchools,
      trialSchools,
      graceSchools,
      suspendedSchools,
      expiredSchools,
      cancelledSchools,
      totalStudents,
      totalUsers,
      totalStaff,
      totalInvoices,
      totalPayments,
      platformRevenueKobo,
      platformRevenueNaira: toNaira(platformRevenueKobo),
      schoolCollectedRevenueKobo,
      schoolCollectedRevenueNaira: toNaira(schoolCollectedRevenueKobo),
      activeSubscriptions,
      expiringSubscriptions,
      totalPartners,
      totalCommissionsKobo,
      totalCommissionsNaira: toNaira(totalCommissionsKobo),
      recentActivity
    }
  });
});
adminRouter.get("/schools", requireAuth, requireSuperAdmin, (req, res) => {
  const { search, status, plan_id, state } = req.query;
  let query = `
    SELECT s.*,
           p.display_name as plan_display_name,
           p.name as plan_name,
           sub.status as subscription_status,
           sub.end_date as subscription_end_date,
           (SELECT COUNT(*) FROM students stu WHERE stu.school_id = s.id) as total_students,
           (SELECT COUNT(*) FROM staff st WHERE st.school_id = s.id) as total_staff,
           (SELECT COUNT(*) FROM user_roles ur WHERE ur.school_id = s.id) as total_users,
           (SELECT u.full_name FROM user_roles ur JOIN users u ON ur.user_id = u.id WHERE ur.school_id = s.id AND ur.role_id = 'role_school_owner' LIMIT 1) as owner_name,
           (SELECT u.email FROM user_roles ur JOIN users u ON ur.user_id = u.id WHERE ur.school_id = s.id AND ur.role_id = 'role_school_owner' LIMIT 1) as owner_email,
           (SELECT COALESCE(SUM(inv.total), 0) FROM invoices inv WHERE inv.school_id = s.id) as total_invoiced,
           (SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay WHERE pay.school_id = s.id AND pay.status = 'SUCCESS') as total_collected
    FROM schools s
    LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
    LEFT JOIN school_subscriptions sub ON sub.school_id = s.id AND sub.status = 'ACTIVE'
    WHERE 1=1
  `;
  const params = [];
  if (search && typeof search === "string" && search.trim() !== "") {
    const term = `%${search.trim().toLowerCase()}%`;
    query += ` AND (LOWER(s.name) LIKE ? OR LOWER(s.email) LIKE ? OR LOWER(s.phone) LIKE ? OR LOWER(s.slug) LIKE ? OR LOWER(s.id) LIKE ?)`;
    params.push(term, term, term, term, term);
  }
  if (status && status !== "ALL") {
    query += ` AND s.status = ?`;
    params.push(status);
  }
  if (plan_id && plan_id !== "ALL") {
    query += ` AND s.current_plan_id = ?`;
    params.push(plan_id);
  }
  if (state && state !== "ALL") {
    query += ` AND s.state = ?`;
    params.push(state);
  }
  query += ` ORDER BY s.created_at DESC`;
  const rows = db.prepare(query).all(...params);
  return res.json({
    success: true,
    schools: rows.map((s) => ({
      ...s,
      total_invoiced_naira: toNaira(s.total_invoiced || 0),
      total_collected_naira: toNaira(s.total_collected || 0),
      outstanding_naira: toNaira(Math.max(0, (s.total_invoiced || 0) - (s.total_collected || 0)))
    }))
  });
});
adminRouter.post("/schools", requireAuth, requireSuperAdmin, (req, res) => {
  const {
    name,
    slug,
    type,
    state,
    lga,
    phone,
    email,
    address,
    status = "TRIAL",
    plan_id = "plan_trial",
    owner_name,
    owner_email,
    owner_phone,
    owner_password = "Password123!"
  } = req.body;
  if (!name || !email || !state || !lga || !phone) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Name, email, state, LGA, and phone are required." });
  }
  const cleanSlug = (slug || name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-")).slice(0, 32);
  const schoolId = `sch_${cleanSlug.replace(/-/g, "_")}_${Date.now().toString().slice(-4)}`;
  const existingEmail = db.prepare("SELECT id FROM schools WHERE email = ?").get(email);
  if (existingEmail) {
    return res.status(400).json({ error: "EMAIL_EXISTS", message: "School email is already registered." });
  }
  try {
    db.prepare(`
      INSERT INTO schools (id, name, slug, type, status, state, lga, phone, email, address, current_plan_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(schoolId, name, cleanSlug, type || "Comprehensive / K-12", status, state, lga, phone, email, address || null, plan_id);
    db.prepare(`
      INSERT INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term)
      VALUES (?, ?, 'NGN', '\u20A6', '2024/2025', '1st Term')
    `).run(`set_${schoolId}`, schoolId);
    const subId = `sub_${crypto7.randomBytes(6).toString("hex")}`;
    const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3).toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO school_subscriptions (id, school_id, plan_id, status, start_date, end_date, trial_end_date, amount_paid, notes)
      VALUES (?, ?, ?, ?, date('now'), ?, ?, 0, 'Initial tenant setup subscription')
    `).run(subId, schoolId, plan_id, status === "ACTIVE" ? "ACTIVE" : "TRIAL", subEnd, subEnd);
    let createdUserId = "";
    if (owner_email) {
      let existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(owner_email);
      if (!existingUser) {
        createdUserId = `usr_owner_${Date.now()}`;
        const salt = generateSalt();
        const pwdHash = hashPassword(owner_password, salt);
        db.prepare(`
          INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 0, 1)
        `).run(createdUserId, owner_email, pwdHash, salt, owner_name || `${name} Proprietor`, owner_phone || phone);
      } else {
        createdUserId = existingUser.id;
      }
      const urId = `ur_${crypto7.randomBytes(6).toString("hex")}`;
      db.prepare(`
        INSERT OR IGNORE INTO user_roles (id, user_id, school_id, role_id, is_primary)
        VALUES (?, ?, ?, 'role_school_owner', 1)
      `).run(urId, createdUserId, schoolId);
    }
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId,
      action: "SCHOOL_CREATED",
      entity: "SCHOOL",
      entityId: schoolId,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { name, slug: cleanSlug, plan_id, owner_email }
    });
    const created = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
    return res.status(201).json({
      success: true,
      message: "School tenant successfully created.",
      school: created
    });
  } catch (err) {
    return res.status(500).json({ error: "CREATE_FAILED", message: err.message || "Failed to create school" });
  }
});
adminRouter.get("/schools/:schoolId", requireAuth, requireSuperAdmin, (req, res) => {
  const { schoolId } = req.params;
  const school = db.prepare(`
    SELECT s.*, p.display_name as plan_display_name, p.name as plan_name, p.feature_flags as plan_feature_flags
    FROM schools s
    LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
    WHERE s.id = ?
  `).get(schoolId);
  if (!school) {
    return res.status(404).json({ error: "NOT_FOUND", message: "School not found" });
  }
  const settings = db.prepare("SELECT * FROM school_settings WHERE school_id = ?").get(schoolId);
  const users = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.phone, u.created_at, r.name as role_name, r.display_name as role_display_name
    FROM user_roles ur
    JOIN users u ON ur.user_id = u.id
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.school_id = ?
  `).all(schoolId);
  const studentCount = db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ?").get(schoolId).c;
  const staffCount = db.prepare("SELECT COUNT(*) as c FROM staff WHERE school_id = ?").get(schoolId).c;
  const classCount = db.prepare("SELECT COUNT(*) as c FROM classes WHERE school_id = ?").get(schoolId).c;
  const invoiceCount = db.prepare("SELECT COUNT(*) as c FROM invoices WHERE school_id = ?").get(schoolId).c;
  const financialRow = db.prepare(`
    SELECT 
      COALESCE(SUM(total), 0) as total_invoiced,
      COALESCE(SUM(amount_paid), 0) as total_collected,
      COALESCE(SUM(balance), 0) as outstanding
    FROM invoices
    WHERE school_id = ? AND status != 'CANCELLED'
  `).get(schoolId);
  const subscriptions = db.prepare(`
    SELECT sub.*, p.display_name as plan_display_name, p.price as plan_price
    FROM school_subscriptions sub
    JOIN subscription_plans p ON sub.plan_id = p.id
    WHERE sub.school_id = ?
    ORDER BY sub.created_at DESC
  `).all(schoolId);
  const recentLogs = db.prepare(`
    SELECT * FROM audit_logs WHERE school_id = ? ORDER BY created_at DESC LIMIT 25
  `).all(schoolId);
  return res.json({
    success: true,
    school,
    settings,
    users,
    usage: {
      students: studentCount,
      staff: staffCount,
      classes: classCount,
      invoices: invoiceCount,
      totalInvoicedNaira: toNaira(Number(financialRow.total_invoiced)),
      totalCollectedNaira: toNaira(Number(financialRow.total_collected)),
      outstandingNaira: toNaira(Number(financialRow.outstanding))
    },
    subscriptions,
    recentLogs
  });
});
adminRouter.patch("/schools/:schoolId", requireAuth, requireSuperAdmin, (req, res) => {
  const { schoolId } = req.params;
  const { name, phone, email, state, lga, address, type, website, logo_url } = req.body;
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  if (!school) {
    return res.status(404).json({ error: "NOT_FOUND", message: "School not found" });
  }
  try {
    db.prepare(`
      UPDATE schools SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        state = COALESCE(?, state),
        lga = COALESCE(?, lga),
        address = COALESCE(?, address),
        type = COALESCE(?, type),
        website = COALESCE(?, website),
        logo_url = COALESCE(?, logo_url),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, phone, email, state, lga, address, type, website, logo_url, schoolId);
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId,
      action: "UPDATE_SCHOOL_PROFILE",
      entity: "SCHOOL",
      entityId: schoolId,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { changes: req.body }
    });
    const updated = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
    return res.json({ success: true, message: "School profile updated successfully.", school: updated });
  } catch (err) {
    return res.status(500).json({ error: "UPDATE_FAILED", message: err.message });
  }
});
adminRouter.patch("/schools/:schoolId/status", requireAuth, requireSuperAdmin, (req, res) => {
  const { schoolId } = req.params;
  const { status, reason } = req.body;
  if (!status || !SCHOOL_STATUSES.includes(status)) {
    return res.status(400).json({
      error: "INVALID_STATUS",
      message: `Status must be one of: ${SCHOOL_STATUSES.join(", ")}`
    });
  }
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  if (!school) {
    return res.status(404).json({ error: "NOT_FOUND", message: "School not found" });
  }
  const previousStatus = school.status;
  db.prepare(`
    UPDATE schools SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, schoolId);
  if (["SUSPENDED", "EXPIRED", "CANCELLED"].includes(status)) {
    db.prepare(`
      UPDATE school_subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE school_id = ? AND status = 'ACTIVE'
    `).run(status, schoolId);
  }
  const actionName = status === "SUSPENDED" ? "SCHOOL_SUSPENDED" : status === "ACTIVE" ? "SCHOOL_ACTIVATED" : "UPDATE_SCHOOL_STATUS";
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    schoolId,
    action: actionName,
    entity: "SCHOOL",
    entityId: schoolId,
    ipAddress: req.ip || "127.0.0.1",
    metadata: { previousStatus, newStatus: status, reason: reason || "Platform administrator action" }
  });
  return res.json({
    success: true,
    message: `School status updated to ${status}. School data preserved safely.`,
    schoolId,
    status
  });
});
adminRouter.post("/schools/:schoolId/subscription", requireAuth, requireSuperAdmin, (req, res) => {
  const { schoolId } = req.params;
  const { plan_id, duration_months = 4, amount_paid_naira, provider = "MANUAL", notes } = req.body;
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  if (!school) {
    return res.status(404).json({ error: "NOT_FOUND", message: "School not found" });
  }
  const plan = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(plan_id);
  if (!plan) {
    return res.status(404).json({ error: "PLAN_NOT_FOUND", message: "Subscription plan not found" });
  }
  const amountKobo = amount_paid_naira !== void 0 ? toKobo(Number(amount_paid_naira)) : plan.price;
  const subId = `sub_${crypto7.randomBytes(6).toString("hex")}`;
  const startDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const endDateObj = /* @__PURE__ */ new Date();
  endDateObj.setMonth(endDateObj.getMonth() + Number(duration_months));
  const endDate = endDateObj.toISOString().slice(0, 10);
  db.prepare(`
    UPDATE school_subscriptions SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
    WHERE school_id = ? AND status = 'ACTIVE'
  `).run(schoolId);
  db.prepare(`
    INSERT INTO school_subscriptions (
      id, school_id, plan_id, status, start_date, end_date, amount_paid, provider, notes, created_at
    ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(subId, schoolId, plan.id, startDate, endDate, amountKobo, provider, notes || `Assigned ${plan.display_name} by platform administrator`);
  db.prepare(`
    UPDATE schools SET current_plan_id = ?, subscription_end_date = ?, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(plan.id, endDate, schoolId);
  if (amountKobo > 0) {
    const platPayId = `ppay_${crypto7.randomBytes(6).toString("hex")}`;
    const intRef = `PLT-${school.slug.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
    db.prepare(`
      INSERT INTO platform_payments (
        id, school_id, subscription_id, plan_id, amount, currency, payment_method, provider,
        internal_reference, status, notes
      ) VALUES (?, ?, ?, ?, ?, 'NGN', ?, ?, ?, 'SUCCESS', ?)
    `).run(platPayId, schoolId, subId, plan.id, amountKobo, provider, provider, intRef, `Subscription payment for ${plan.display_name}`);
  }
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    schoolId,
    action: "SUBSCRIPTION_CHANGED",
    entity: "SUBSCRIPTION",
    entityId: subId,
    ipAddress: req.ip || "127.0.0.1",
    metadata: { plan_id: plan.id, plan_name: plan.name, amountKobo, endDate }
  });
  return res.json({
    success: true,
    message: `Subscription plan ${plan.display_name} successfully activated for ${school.name}.`,
    subscriptionId: subId,
    endDate
  });
});
adminRouter.get("/plans", requireAuth, requireSuperAdmin, (_req, res) => {
  const plans = db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM schools s WHERE s.current_plan_id = p.id) as subscriber_count
    FROM subscription_plans p
    ORDER BY p.price ASC
  `).all();
  return res.json({
    success: true,
    plans: plans.map((p) => ({
      ...p,
      price_naira: toNaira(p.price),
      feature_flags: typeof p.feature_flags === "string" ? JSON.parse(p.feature_flags || "{}") : p.feature_flags
    }))
  });
});
adminRouter.post("/plans", requireAuth, requireSuperAdmin, (req, res) => {
  const { name, display_name, description, price_naira, billing_interval = "TERM", student_limit, staff_limit, storage_limit_mb, feature_flags } = req.body;
  if (!name || !display_name) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Plan name and display name are required" });
  }
  const id = `plan_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
  const priceKobo = toKobo(Number(price_naira) || 0);
  const flagsJson = JSON.stringify(feature_flags || {});
  try {
    db.prepare(`
      INSERT INTO subscription_plans (
        id, name, display_name, description, price, billing_interval,
        student_limit, staff_limit, storage_limit_mb, feature_flags, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      name.toUpperCase(),
      display_name,
      description || null,
      priceKobo,
      billing_interval,
      Number(student_limit) || 200,
      Number(staff_limit) || 25,
      Number(storage_limit_mb) || 1e3,
      flagsJson
    );
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "PLAN_CREATED",
      entity: "SUBSCRIPTION_PLAN",
      entityId: id,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { name, priceKobo }
    });
    return res.status(201).json({ success: true, message: "Plan created successfully.", planId: id });
  } catch (err) {
    return res.status(500).json({ error: "CREATE_PLAN_FAILED", message: err.message });
  }
});
adminRouter.patch("/plans/:id", requireAuth, requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { display_name, description, price_naira, student_limit, staff_limit, storage_limit_mb, feature_flags, active } = req.body;
  const plan = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(id);
  if (!plan) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Plan not found" });
  }
  const priceKobo = price_naira !== void 0 ? toKobo(Number(price_naira)) : void 0;
  const flagsJson = feature_flags !== void 0 ? JSON.stringify(feature_flags) : void 0;
  db.prepare(`
    UPDATE subscription_plans SET
      display_name = COALESCE(?, display_name),
      description = COALESCE(?, description),
      price = COALESCE(?, price),
      student_limit = COALESCE(?, student_limit),
      staff_limit = COALESCE(?, staff_limit),
      storage_limit_mb = COALESCE(?, storage_limit_mb),
      feature_flags = COALESCE(?, feature_flags),
      active = COALESCE(?, active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    display_name ?? null,
    description ?? null,
    priceKobo ?? null,
    student_limit !== void 0 ? Number(student_limit) : null,
    staff_limit !== void 0 ? Number(staff_limit) : null,
    storage_limit_mb !== void 0 ? Number(storage_limit_mb) : null,
    flagsJson ?? null,
    active !== void 0 ? active ? 1 : 0 : null,
    id
  );
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    action: "PLAN_UPDATED",
    entity: "SUBSCRIPTION_PLAN",
    entityId: id,
    ipAddress: req.ip || "127.0.0.1",
    metadata: { changes: req.body }
  });
  return res.json({ success: true, message: "Plan updated successfully." });
});
adminRouter.get("/subscriptions", requireAuth, requireSuperAdmin, (req, res) => {
  const { status, plan_id, expiring_soon } = req.query;
  let query = `
    SELECT sub.*,
           s.name as school_name,
           s.slug as school_slug,
           p.name as plan_name,
           p.display_name as plan_display_name,
           p.billing_interval
    FROM school_subscriptions sub
    JOIN schools s ON sub.school_id = s.id
    JOIN subscription_plans p ON sub.plan_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (status && status !== "ALL") {
    query += ` AND sub.status = ?`;
    params.push(status);
  }
  if (plan_id && plan_id !== "ALL") {
    query += ` AND sub.plan_id = ?`;
    params.push(plan_id);
  }
  if (expiring_soon === "true") {
    query += ` AND sub.status = 'ACTIVE' AND date(sub.end_date) <= date('now', '+30 days')`;
  }
  query += ` ORDER BY sub.created_at DESC`;
  const rows = db.prepare(query).all(...params);
  return res.json({
    success: true,
    subscriptions: rows.map((r) => ({
      ...r,
      amount_paid_naira: toNaira(r.amount_paid)
    }))
  });
});
adminRouter.get("/revenue", requireAuth, requireSuperAdmin, (_req, res) => {
  const totalSaaSRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo, COUNT(*) as count
    FROM platform_payments WHERE status = 'SUCCESS'
  `).get();
  const platformRevenueKobo = Number(totalSaaSRow.total_kobo);
  const schoolTotalRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_kobo, COUNT(*) as count
    FROM payments WHERE status = 'SUCCESS'
  `).get();
  const schoolCollectedRevenueKobo = Number(schoolTotalRow.total_kobo);
  const successfulCount = db.prepare("SELECT COUNT(*) as c FROM platform_payments WHERE status = 'SUCCESS'").get().c;
  const failedCount = db.prepare("SELECT COUNT(*) as c FROM platform_payments WHERE status = 'FAILED'").get().c;
  const refundedCount = db.prepare("SELECT COUNT(*) as c FROM platform_payments WHERE status = 'REFUNDED'").get().c;
  const revenueByPlan = db.prepare(`
    SELECT p.id as plan_id, p.display_name, COALESCE(SUM(pp.amount), 0) as total_kobo, COUNT(pp.id) as payment_count
    FROM subscription_plans p
    LEFT JOIN platform_payments pp ON p.id = pp.plan_id AND pp.status = 'SUCCESS'
    GROUP BY p.id
    ORDER BY total_kobo DESC
  `).all();
  const transactions = db.prepare(`
    SELECT pp.*, s.name as school_name, p.display_name as plan_display_name
    FROM platform_payments pp
    JOIN schools s ON pp.school_id = s.id
    LEFT JOIN subscription_plans p ON pp.plan_id = p.id
    ORDER BY pp.paid_at DESC
    LIMIT 50
  `).all();
  return res.json({
    success: true,
    revenue: {
      platformRevenueKobo,
      platformRevenueNaira: toNaira(platformRevenueKobo),
      schoolCollectedRevenueKobo,
      schoolCollectedRevenueNaira: toNaira(schoolCollectedRevenueKobo),
      successfulCount,
      failedCount,
      refundedCount,
      revenueByPlan: revenueByPlan.map((r) => ({
        ...r,
        total_naira: toNaira(r.total_kobo)
      })),
      transactions: transactions.map((t) => ({
        ...t,
        amount_naira: toNaira(t.amount)
      }))
    }
  });
});
adminRouter.get("/partners", requireAuth, requireSuperAdmin, (_req, res) => {
  const partners = db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM commissions c WHERE c.partner_id = p.id) as commission_count,
           (SELECT COALESCE(SUM(amount), 0) FROM commissions c WHERE c.partner_id = p.id AND c.status = 'PAID') as paid_commissions_kobo,
           (SELECT COALESCE(SUM(amount), 0) FROM commissions c WHERE c.partner_id = p.id AND c.status = 'PENDING') as pending_commissions_kobo
    FROM partners p
    ORDER BY p.created_at DESC
  `).all();
  return res.json({
    success: true,
    partners: partners.map((p) => ({
      ...p,
      paid_commissions_naira: toNaira(p.paid_commissions_kobo),
      pending_commissions_naira: toNaira(p.pending_commissions_kobo)
    }))
  });
});
adminRouter.post("/partners", requireAuth, requireSuperAdmin, (req, res) => {
  const { name, email, phone, company, partner_type = "REFERRAL", commission_rate = 10, referral_code, notes } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Partner name and email are required" });
  }
  const id = `ptn_${crypto7.randomBytes(6).toString("hex")}`;
  const code = referral_code || `${name.slice(0, 4).toUpperCase()}-${crypto7.randomBytes(2).toString("hex").toUpperCase()}`;
  try {
    db.prepare(`
      INSERT INTO partners (id, name, email, phone, company, partner_type, commission_rate, referral_code, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    `).run(id, name, email, phone || null, company || null, partner_type, Number(commission_rate), code, notes || null);
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "PARTNER_CREATED",
      entity: "PARTNER",
      entityId: id,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { name, email, referral_code: code }
    });
    return res.status(201).json({ success: true, message: "Partner added successfully.", partnerId: id });
  } catch (err) {
    return res.status(500).json({ error: "CREATE_PARTNER_FAILED", message: err.message });
  }
});
adminRouter.get("/commissions", requireAuth, requireSuperAdmin, (req, res) => {
  const { status, partner_id } = req.query;
  let query = `
    SELECT c.*,
           p.name as partner_name,
           p.company as partner_company,
           s.name as school_name
    FROM commissions c
    JOIN partners p ON c.partner_id = p.id
    LEFT JOIN schools s ON c.school_id = s.id
    WHERE 1=1
  `;
  const params = [];
  if (status && status !== "ALL") {
    query += ` AND c.status = ?`;
    params.push(status);
  }
  if (partner_id && partner_id !== "ALL") {
    query += ` AND c.partner_id = ?`;
    params.push(partner_id);
  }
  query += ` ORDER BY c.created_at DESC`;
  const rows = db.prepare(query).all(...params);
  return res.json({
    success: true,
    commissions: rows.map((c) => ({
      ...c,
      amount_naira: toNaira(c.amount)
    }))
  });
});
adminRouter.patch("/commissions/:id/status", requireAuth, requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  if (!status || !["PENDING", "APPROVED", "PAID", "CANCELLED"].includes(status)) {
    return res.status(400).json({ error: "INVALID_STATUS", message: "Status must be PENDING, APPROVED, PAID, or CANCELLED" });
  }
  const commission = db.prepare("SELECT * FROM commissions WHERE id = ?").get(id);
  if (!commission) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Commission not found" });
  }
  const paidAt = status === "PAID" ? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) : commission.paid_at || null;
  db.prepare(`
    UPDATE commissions SET status = ?, notes = COALESCE(?, notes), paid_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, notes || null, paidAt, id);
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    action: "COMMISSION_STATUS_UPDATED",
    entity: "COMMISSION",
    entityId: id,
    ipAddress: req.ip || "127.0.0.1",
    metadata: { previousStatus: commission.status, newStatus: status }
  });
  return res.json({ success: true, message: `Commission marked as ${status}.` });
});
adminRouter.get("/users", requireAuth, requireSuperAdmin, (_req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.phone, u.is_platform_admin, u.is_active, u.created_at,
           COUNT(ur.school_id) as assigned_schools
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    GROUP BY u.id
    ORDER BY u.is_platform_admin DESC, u.created_at DESC
  `).all();
  return res.json({ success: true, users });
});
adminRouter.get("/audit-logs", requireAuth, requireSuperAdmin, (req, res) => {
  const { action, school_id, limit = "100" } = req.query;
  let query = `
    SELECT al.*, s.name as school_name
    FROM audit_logs al
    LEFT JOIN schools s ON al.school_id = s.id
    WHERE 1=1
  `;
  const params = [];
  if (action && typeof action === "string" && action !== "ALL") {
    query += ` AND al.action = ?`;
    params.push(action);
  }
  if (school_id && typeof school_id === "string" && school_id !== "ALL") {
    query += ` AND al.school_id = ?`;
    params.push(school_id);
  }
  query += ` ORDER BY al.created_at DESC LIMIT ?`;
  params.push(Math.min(parseInt(limit, 10) || 100, 500));
  const logs = db.prepare(query).all(...params);
  return res.json({ success: true, logs });
});
adminRouter.post("/impersonate", requireAuth, requireSuperAdmin, (req, res) => {
  const { schoolId, userId } = req.body;
  if (!schoolId) {
    return res.status(400).json({ error: "MISSING_PARAM", message: "schoolId is required for support impersonation" });
  }
  const school = db.prepare("SELECT id, name, slug, status FROM schools WHERE id = ?").get(schoolId);
  if (!school) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Target school not found" });
  }
  let targetUser;
  if (userId) {
    targetUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  } else {
    targetUser = db.prepare(`
      SELECT u.* FROM user_roles ur
      JOIN users u ON ur.user_id = u.id
      WHERE ur.school_id = ? AND ur.role_id IN ('role_school_owner', 'role_school_admin', 'role_bursar')
      ORDER BY ur.role_id ASC
      LIMIT 1
    `).get(schoolId);
  }
  if (!targetUser) {
    return res.status(404).json({ error: "NO_TARGET_USER", message: "No authorized staff or owner user found in target school to impersonate." });
  }
  const superAdminId = req.user.id;
  const clientIp = req.ip || "127.0.0.1";
  const userAgent = req.headers["user-agent"] || "";
  const impersonationToken = createImpersonationSession(targetUser.id, schoolId, superAdminId, clientIp, userAgent);
  logAudit({
    actorId: superAdminId,
    actorEmail: req.user.email,
    schoolId,
    action: "IMPERSONATION_STARTED",
    entity: "SUPPORT_SESSION",
    entityId: targetUser.id,
    ipAddress: clientIp,
    metadata: {
      targetUserId: targetUser.id,
      targetUserEmail: targetUser.email,
      targetSchoolName: school.name,
      reason: req.body.reason || "Customer support investigation"
    }
  });
  return res.json({
    success: true,
    message: `Support impersonation session initiated for ${school.name}.`,
    impersonationToken,
    targetUser: {
      id: targetUser.id,
      email: targetUser.email,
      full_name: targetUser.full_name
    },
    targetSchool: school
  });
});
adminRouter.post("/plans/:id/duplicate", requireAuth, requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const original = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(id);
  if (!original) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Original plan not found" });
  }
  const newId = `plan_${original.name.toLowerCase()}_copy_${Date.now().toString().slice(-4)}`;
  const newName = `${original.name}_COPY`;
  const newDisplayName = `${original.display_name} (Copy)`;
  try {
    db.prepare(`
      INSERT INTO subscription_plans (
        id, name, display_name, description, price, billing_interval,
        billing_interval_count, currency, trial_days, student_limit, staff_limit,
        maximum_students, maximum_staff, maximum_admin_users, storage_limit_mb,
        feature_flags, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      newId,
      newName,
      newDisplayName,
      original.description,
      original.price,
      original.billing_interval,
      original.billing_interval_count || 1,
      original.currency || "NGN",
      original.trial_days || 30,
      original.student_limit,
      original.staff_limit,
      original.maximum_students || original.student_limit,
      original.maximum_staff || original.staff_limit,
      original.maximum_admin_users || 5,
      original.storage_limit_mb,
      original.feature_flags
    );
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "PLAN_DUPLICATED",
      entity: "SUBSCRIPTION_PLAN",
      entityId: newId,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { originalPlanId: id, newPlanId: newId }
    });
    return res.status(201).json({ success: true, message: `Plan duplicated as "${newDisplayName}".`, planId: newId });
  } catch (err) {
    return res.status(500).json({ error: "DUPLICATE_FAILED", message: err.message });
  }
});
adminRouter.post("/plans/:id/archive", requireAuth, requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const plan = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(id);
  if (!plan) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Plan not found" });
  }
  db.prepare("UPDATE subscription_plans SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    action: "PLAN_ARCHIVED",
    entity: "SUBSCRIPTION_PLAN",
    entityId: id,
    ipAddress: req.ip || "127.0.0.1"
  });
  return res.json({ success: true, message: `Plan "${plan.display_name}" archived.` });
});
adminRouter.post("/schools/:schoolId/custom-subscription", requireAuth, requireSuperAdmin, (req, res) => {
  const { schoolId } = req.params;
  const {
    plan_id,
    negotiated_price_naira,
    discount_amount_naira,
    discount_reason,
    final_amount_naira,
    billing_interval = "ANNUAL",
    duration_months = 12,
    status = "ACTIVE",
    notes
  } = req.body;
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  if (!school) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Target school not found" });
  }
  const plan = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(plan_id);
  if (!plan) {
    return res.status(404).json({ error: "PLAN_NOT_FOUND", message: "Subscription plan not found" });
  }
  const standardPriceKobo = plan.price;
  let negotiatedKobo = negotiated_price_naira !== void 0 && negotiated_price_naira !== null ? toKobo(Number(negotiated_price_naira)) : null;
  let discountKobo = discount_amount_naira !== void 0 ? toKobo(Number(discount_amount_naira)) : 0;
  let finalKobo;
  if (final_amount_naira !== void 0 && final_amount_naira !== null) {
    finalKobo = toKobo(Number(final_amount_naira));
  } else if (negotiatedKobo !== null) {
    finalKobo = Math.max(0, negotiatedKobo - discountKobo);
  } else {
    finalKobo = Math.max(0, standardPriceKobo - discountKobo);
  }
  const subId = `sub_${crypto7.randomBytes(6).toString("hex")}`;
  const startDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const endDateObj = /* @__PURE__ */ new Date();
  endDateObj.setMonth(endDateObj.getMonth() + Number(duration_months));
  const endDate = endDateObj.toISOString().slice(0, 10);
  db.prepare("UPDATE school_subscriptions SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);
  db.prepare(`
    INSERT INTO school_subscriptions (
      id, school_id, plan_id, status, start_date, end_date, standard_plan_price,
      negotiated_price, discount_amount, discount_reason, final_amount, amount_paid,
      currency, expiry_date, renewal_date, provider, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NGN', ?, ?, 'SUPER_ADMIN_CUSTOM', ?, CURRENT_TIMESTAMP)
  `).run(
    subId,
    schoolId,
    plan.id,
    status,
    startDate,
    endDate,
    standardPriceKobo,
    negotiatedKobo,
    discountKobo,
    discount_reason || null,
    finalKobo,
    finalKobo,
    endDate,
    endDate,
    notes || `Custom negotiated pricing set by Super Admin (Final: \u20A6${toNaira(finalKobo).toLocaleString()})`
  );
  db.prepare(`
    UPDATE schools SET
      status = ?,
      current_plan_id = ?,
      subscription_end_date = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, plan.id, endDate, schoolId);
  const invNumber = `INV-PLT-${(/* @__PURE__ */ new Date()).getFullYear()}-${Date.now().toString().slice(-4)}`;
  const invoiceId = `pinv_${crypto7.randomBytes(6).toString("hex")}`;
  db.prepare(`
    INSERT INTO platform_invoices (
      id, invoice_number, school_id, subscription_id, plan_id, billing_period,
      standard_price, discount, negotiated_price, final_amount, currency,
      payment_status, issue_date, due_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NGN', 'PENDING', ?, ?, ?)
  `).run(
    invoiceId,
    invNumber,
    schoolId,
    subId,
    plan.id,
    `${startDate} to ${endDate}`,
    standardPriceKobo,
    discountKobo,
    negotiatedKobo,
    finalKobo,
    startDate,
    startDate,
    `Invoice for customized subscription: ${plan.display_name}`
  );
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    schoolId,
    action: "CUSTOM_PRICING_ASSIGNED",
    entity: "SCHOOL_SUBSCRIPTION",
    entityId: subId,
    ipAddress: req.ip || "127.0.0.1",
    metadata: {
      planId: plan.id,
      standardPriceKobo,
      negotiatedKobo,
      discountKobo,
      finalKobo,
      durationMonths: duration_months
    }
  });
  return res.status(201).json({
    success: true,
    message: `Custom subscription successfully created for ${school.name}. Final charge amount: \u20A6${toNaira(finalKobo).toLocaleString()}.`,
    subscriptionId: subId,
    invoiceId,
    finalAmountNaira: toNaira(finalKobo),
    endDate
  });
});
adminRouter.get("/discounts", requireAuth, requireSuperAdmin, (_req, res) => {
  const discounts = db.prepare(`
    SELECT sd.*, s.name as school_name, p.display_name as plan_display_name
    FROM subscription_discounts sd
    LEFT JOIN schools s ON sd.school_id = s.id
    LEFT JOIN subscription_plans p ON sd.plan_id = p.id
    ORDER BY sd.created_at DESC
  `).all();
  return res.json({
    success: true,
    discounts: discounts.map((d) => ({
      ...d,
      discount_value_display: d.discount_type === "PERCENTAGE" ? `${d.discount_value}%` : `\u20A6${toNaira(d.discount_value).toLocaleString()}`
    }))
  });
});
adminRouter.post("/discounts", requireAuth, requireSuperAdmin, (req, res) => {
  const { code, name, discount_type, discount_value, school_id, plan_id, expires_at, notes } = req.body;
  if (!name || !discount_type || discount_value === void 0) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "Name, discount_type, and discount_value are required" });
  }
  const id = `disc_${crypto7.randomBytes(6).toString("hex")}`;
  const promoCode = code ? code.toUpperCase().trim() : `PROMO-${crypto7.randomBytes(3).toString("hex").toUpperCase()}`;
  const valueInt = discount_type === "FIXED" ? toKobo(Number(discount_value)) : Number(discount_value);
  try {
    db.prepare(`
      INSERT INTO subscription_discounts (
        id, code, name, discount_type, discount_value, school_id, plan_id, active, expires_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, promoCode, name, discount_type, valueInt, school_id || null, plan_id || null, expires_at || null, notes || null);
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      action: "DISCOUNT_CREATED",
      entity: "SUBSCRIPTION_DISCOUNT",
      entityId: id,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { code: promoCode, discount_type, discount_value: valueInt }
    });
    return res.status(201).json({ success: true, message: "Discount promotion created.", discountId: id, code: promoCode });
  } catch (err) {
    return res.status(500).json({ error: "CREATE_DISCOUNT_FAILED", message: err.message });
  }
});
adminRouter.delete("/discounts/:id", requireAuth, requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  db.prepare("DELETE FROM subscription_discounts WHERE id = ?").run(id);
  return res.json({ success: true, message: "Discount deleted." });
});
adminRouter.get("/settings", requireAuth, requireSuperAdmin, (_req, res) => {
  const settings = db.prepare("SELECT * FROM platform_settings WHERE id = ?").get("platform_global_settings");
  return res.json({ success: true, settings });
});
adminRouter.patch("/settings", requireAuth, requireSuperAdmin, (req, res) => {
  const {
    default_currency,
    default_grace_period_days,
    default_trial_days,
    bachs_enabled,
    bank_transfer_enabled,
    invoice_payments_enabled,
    platform_bank_name,
    platform_account_name,
    platform_account_number,
    platform_contact_email,
    platform_contact_phone
  } = req.body;
  db.prepare(`
    UPDATE platform_settings SET
      default_currency = COALESCE(?, default_currency),
      default_grace_period_days = COALESCE(?, default_grace_period_days),
      default_trial_days = COALESCE(?, default_trial_days),
      bachs_enabled = COALESCE(?, bachs_enabled),
      bank_transfer_enabled = COALESCE(?, bank_transfer_enabled),
      invoice_payments_enabled = COALESCE(?, invoice_payments_enabled),
      platform_bank_name = COALESCE(?, platform_bank_name),
      platform_account_name = COALESCE(?, platform_account_name),
      platform_account_number = COALESCE(?, platform_account_number),
      platform_contact_email = COALESCE(?, platform_contact_email),
      platform_contact_phone = COALESCE(?, platform_contact_phone),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 'platform_global_settings'
  `).run(
    default_currency,
    default_grace_period_days,
    default_trial_days,
    bachs_enabled,
    bank_transfer_enabled,
    invoice_payments_enabled,
    platform_bank_name,
    platform_account_name,
    platform_account_number,
    platform_contact_email,
    platform_contact_phone
  );
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    action: "PLATFORM_SETTINGS_UPDATED",
    entity: "PLATFORM_SETTINGS",
    entityId: "platform_global_settings",
    ipAddress: req.ip || "127.0.0.1",
    metadata: req.body
  });
  return res.json({ success: true, message: "Platform settings updated successfully." });
});
adminRouter.get("/platform-payments", requireAuth, requireSuperAdmin, (req, res) => {
  const { status, payment_method, school_id } = req.query;
  let query = `
    SELECT pp.*, s.name as school_name, s.slug as school_slug, p.display_name as plan_display_name,
           p.billing_interval
    FROM platform_payments pp
    JOIN schools s ON pp.school_id = s.id
    LEFT JOIN subscription_plans p ON pp.plan_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (status && status !== "ALL") {
    query += ` AND pp.status = ?`;
    params.push(status);
  }
  if (payment_method && payment_method !== "ALL") {
    query += ` AND pp.payment_method = ?`;
    params.push(payment_method);
  }
  if (school_id && school_id !== "ALL") {
    query += ` AND pp.school_id = ?`;
    params.push(school_id);
  }
  query += ` ORDER BY pp.created_at DESC`;
  const rows = db.prepare(query).all(...params);
  return res.json({
    success: true,
    payments: rows.map((r) => ({
      ...r,
      amount_naira: toNaira(r.amount)
    }))
  });
});
adminRouter.post("/platform-payments/:id/approve", requireAuth, requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  const payment = db.prepare("SELECT * FROM platform_payments WHERE id = ?").get(id);
  if (!payment) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Platform payment record not found" });
  }
  if (payment.status === "SUCCESS") {
    return res.status(400).json({ error: "ALREADY_APPROVED", message: "This payment has already been approved" });
  }
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(payment.school_id);
  const plan = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(payment.plan_id);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const todayStr = nowIso.slice(0, 10);
  const interval = (plan?.billing_interval || "ANNUAL").toUpperCase();
  const count = plan?.billing_interval_count || 1;
  const endDateObj = /* @__PURE__ */ new Date();
  if (interval === "MONTHLY") endDateObj.setMonth(endDateObj.getMonth() + 1 * count);
  else if (interval === "QUARTERLY") endDateObj.setMonth(endDateObj.getMonth() + 3 * count);
  else if (interval === "SEMI_ANNUAL") endDateObj.setMonth(endDateObj.getMonth() + 6 * count);
  else if (interval === "ANNUAL") endDateObj.setFullYear(endDateObj.getFullYear() + 1 * count);
  else endDateObj.setMonth(endDateObj.getMonth() + 4 * count);
  const newEndDateStr = endDateObj.toISOString().slice(0, 10);
  db.prepare(`
    UPDATE platform_payments SET
      status = 'SUCCESS',
      paid_at = ?,
      notes = COALESCE(?, notes),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nowIso, notes || "Approved by Super Admin", id);
  if (payment.subscription_id) {
    db.prepare(`
      UPDATE school_subscriptions SET
        status = 'ACTIVE',
        amount_paid = ?,
        end_date = ?,
        expiry_date = ?,
        renewal_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(payment.amount, newEndDateStr, newEndDateStr, newEndDateStr, payment.subscription_id);
  } else {
    const subId = `sub_${crypto7.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO school_subscriptions (
        id, school_id, plan_id, status, start_date, end_date, amount_paid,
        standard_plan_price, final_amount, currency, expiry_date, renewal_date, provider, notes
      ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, 'NGN', ?, ?, 'BANK_TRANSFER', 'Approved by Super Admin')
    `).run(
      subId,
      payment.school_id,
      payment.plan_id,
      todayStr,
      newEndDateStr,
      payment.amount,
      plan.price,
      payment.amount,
      newEndDateStr,
      newEndDateStr
    );
  }
  db.prepare(`
    UPDATE schools SET
      status = 'ACTIVE',
      current_plan_id = ?,
      subscription_end_date = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(payment.plan_id, newEndDateStr, payment.school_id);
  db.prepare(`
    UPDATE platform_invoices SET
      payment_status = 'PAID',
      paid_at = ?,
      payment_method = 'BANK_TRANSFER',
      updated_at = CURRENT_TIMESTAMP
    WHERE school_id = ? AND payment_status = 'PENDING'
  `).run(nowIso, payment.school_id);
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    schoolId: payment.school_id,
    action: "MANUAL_PAYMENT_APPROVED",
    entity: "PLATFORM_PAYMENT",
    entityId: id,
    ipAddress: req.ip || "127.0.0.1",
    metadata: {
      amountKobo: payment.amount,
      planId: payment.plan_id,
      schoolName: school?.name,
      newEndDate: newEndDateStr
    }
  });
  return res.json({
    success: true,
    message: `Payment of \u20A6${toNaira(payment.amount).toLocaleString()} approved. School ${school?.name} is now ACTIVE until ${newEndDateStr}.`,
    newEndDate: newEndDateStr
  });
});
adminRouter.post("/platform-payments/:id/reject", requireAuth, requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const payment = db.prepare("SELECT * FROM platform_payments WHERE id = ?").get(id);
  if (!payment) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Platform payment record not found" });
  }
  db.prepare(`
    UPDATE platform_payments SET
      status = 'FAILED',
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(reason ? `Rejected by Super Admin: ${reason}` : "Rejected by Super Admin", id);
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    schoolId: payment.school_id,
    action: "MANUAL_PAYMENT_REJECTED",
    entity: "PLATFORM_PAYMENT",
    entityId: id,
    ipAddress: req.ip || "127.0.0.1",
    metadata: { reason }
  });
  return res.json({ success: true, message: "Payment marked as rejected." });
});
adminRouter.get("/platform-invoices", requireAuth, requireSuperAdmin, (req, res) => {
  const { status, school_id } = req.query;
  let query = `
    SELECT pi.*, s.name as school_name, s.slug as school_slug, p.display_name as plan_display_name
    FROM platform_invoices pi
    JOIN schools s ON pi.school_id = s.id
    LEFT JOIN subscription_plans p ON pi.plan_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (status && status !== "ALL") {
    query += ` AND pi.payment_status = ?`;
    params.push(status);
  }
  if (school_id && school_id !== "ALL") {
    query += ` AND pi.school_id = ?`;
    params.push(school_id);
  }
  query += ` ORDER BY pi.issue_date DESC`;
  const rows = db.prepare(query).all(...params);
  return res.json({
    success: true,
    invoices: rows.map((r) => ({
      ...r,
      standard_price_naira: toNaira(r.standard_price),
      discount_naira: toNaira(r.discount),
      final_amount_naira: toNaira(r.final_amount)
    }))
  });
});
adminRouter.get("/usage", requireAuth, requireSuperAdmin, (_req, res) => {
  try {
    const dataDir2 = path2.resolve(process.cwd(), "data");
    const dbPath2 = path2.join(dataDir2, "schoolpay.db");
    let dbFileSizeBytes = 0;
    try {
      if (fs2.existsSync(dbPath2)) {
        dbFileSizeBytes = fs2.statSync(dbPath2).size;
      }
    } catch {
      dbFileSizeBytes = 0;
    }
    const freeTierLimitBytes = 5 * 1024 * 1024 * 1024;
    const dbUsagePercent = Number((dbFileSizeBytes / freeTierLimitBytes * 100).toFixed(4));
    const totalSchools = db.prepare("SELECT COUNT(*) as c FROM schools").get()?.c || 0;
    const activeSchools = db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'ACTIVE'").get()?.c || 0;
    const trialSchools = db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'TRIAL'").get()?.c || 0;
    const suspendedSchools = db.prepare("SELECT COUNT(*) as c FROM schools WHERE status = 'SUSPENDED'").get()?.c || 0;
    const totalStudents = db.prepare("SELECT COUNT(*) as c FROM students").get()?.c || 0;
    const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users").get()?.c || 0;
    const totalStaff = db.prepare("SELECT COUNT(*) as c FROM staff").get()?.c || 0;
    const totalInvoices = db.prepare("SELECT COUNT(*) as c FROM invoices").get()?.c || 0;
    const totalPayments = db.prepare("SELECT COUNT(*) as c FROM payments").get()?.c || 0;
    const totalReceipts = db.prepare("SELECT COUNT(*) as c FROM receipts").get()?.c || 0;
    const totalWebhookEvents = db.prepare("SELECT COUNT(*) as c FROM webhook_events").get()?.c || 0;
    const failedWebhookEvents = db.prepare("SELECT COUNT(*) as c FROM webhook_events WHERE status IN ('FAILED', 'REJECTED')").get()?.c || 0;
    const successfulWebhookEvents = db.prepare("SELECT COUNT(*) as c FROM webhook_events WHERE status = 'PROCESSED'").get()?.c || 0;
    const totalSecurityViolations = db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE action LIKE '%VIOLATION%' OR action LIKE '%IDOR%' OR action LIKE '%REJECTED%'").get()?.c || 0;
    const recentViolations = db.prepare(`
      SELECT al.*, s.name as school_name
      FROM audit_logs al
      LEFT JOIN schools s ON al.school_id = s.id
      WHERE al.action LIKE '%VIOLATION%' OR al.action LIKE '%IDOR%' OR al.action LIKE '%REJECTED%'
      ORDER BY al.created_at DESC
      LIMIT 5
    `).all();
    const schoolUsage = db.prepare(`
      SELECT s.id, s.name, s.slug, s.status, s.state,
             p.display_name as plan_name,
             (SELECT COUNT(*) FROM students stu WHERE stu.school_id = s.id) as student_count,
             (SELECT COUNT(*) FROM user_roles ur WHERE ur.school_id = s.id) as user_count,
             (SELECT COUNT(*) FROM invoices inv WHERE inv.school_id = s.id) as invoice_count,
             (SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay WHERE pay.school_id = s.id AND pay.status = 'SUCCESS') as total_collected_kobo
      FROM schools s
      LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
      ORDER BY student_count DESC, s.created_at DESC
      LIMIT 50
    `).all();
    const cfD1Configured = Boolean(process.env.CLOUDFLARE_D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN);
    return res.json({
      success: true,
      usage: {
        database: {
          engine: "SQLite WAL Mode / Cloudflare D1 Compatible",
          fileSizeBytes: dbFileSizeBytes,
          fileSizeFormatted: `${(dbFileSizeBytes / (1024 * 1024)).toFixed(2)} MB`,
          freeTierLimitBytes,
          freeTierLimitFormatted: "5.00 GB",
          usagePercent: dbUsagePercent,
          warningThresholdPercent: 80,
          status: dbUsagePercent > 80 ? "WARNING" : "HEALTHY",
          cloudflareD1: {
            configured: cfD1Configured,
            databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID || null,
            liveAnalyticsAvailable: cfD1Configured,
            setupNotice: cfD1Configured ? "Connected to Cloudflare D1 edge database." : "Running on local persistent SQLite WAL database. For remote Cloudflare D1 edge metrics, define CLOUDFLARE_API_TOKEN and CLOUDFLARE_D1_DATABASE_ID in production environment variables."
          }
        },
        entities: {
          totalSchools,
          activeSchools,
          trialSchools,
          suspendedSchools,
          totalStudents,
          totalUsers,
          totalStaff,
          totalInvoices,
          totalPayments,
          totalReceipts
        },
        webhooks: {
          totalEvents: totalWebhookEvents,
          successfulEvents: successfulWebhookEvents,
          failedEvents: failedWebhookEvents,
          healthRatePercent: totalWebhookEvents > 0 ? Number((successfulWebhookEvents / totalWebhookEvents * 100).toFixed(1)) : 100
        },
        security: {
          totalViolations: totalSecurityViolations,
          recentViolations
        },
        schoolsBreakdown: schoolUsage.map((s) => ({
          ...s,
          total_collected_naira: toNaira(s.total_collected_kobo)
        })),
        infrastructureNotes: [
          "Architecture uses parameterized queries and strictly isolated school_id indexes for sub-millisecond query execution.",
          "Database storage capacity is bounded by Cloudflare D1 5 GB free tier limit before requiring paid Workers scale plans.",
          "Tenant isolation is enforced server-side on every request via cryptographic session tokens."
        ]
      }
    });
  } catch (error) {
    console.error("[Usage Metrics Error]", error);
    return res.status(500).json({
      error: "USAGE_METRICS_ERROR",
      message: "Failed to retrieve platform usage metrics: " + (error?.message || "Unknown error")
    });
  }
});

// server/schoolBillingRoutes.ts
import express2 from "express";
import crypto8 from "node:crypto";
var schoolBillingRouter = express2.Router();
schoolBillingRouter.get("/subscription", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const sub = db.prepare(`
    SELECT sub.*,
           p.name as plan_name,
           p.display_name as plan_display_name,
           p.description as plan_description,
           p.student_limit as plan_student_limit,
           p.staff_limit as plan_staff_limit,
           p.storage_limit_mb as plan_storage_limit,
           p.feature_flags as plan_feature_flags
    FROM school_subscriptions sub
    JOIN subscription_plans p ON sub.plan_id = p.id
    WHERE sub.school_id = ?
    ORDER BY CASE WHEN sub.status = 'ACTIVE' THEN 0 ELSE 1 END, sub.rowid DESC
    LIMIT 1
  `).get(schoolId);
  const studentCount = db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ?").get(schoolId).c;
  const staffCount = db.prepare("SELECT COUNT(*) as c FROM staff WHERE school_id = ?").get(schoolId).c;
  const platformSettings = db.prepare("SELECT * FROM platform_settings WHERE id = ?").get("platform_global_settings");
  const availablePlans = db.prepare(`
    SELECT * FROM subscription_plans WHERE active = 1 ORDER BY price ASC
  `).all();
  return res.json({
    success: true,
    subscription: sub ? {
      ...sub,
      standard_plan_price_naira: toNaira(sub.standard_plan_price || sub.amount_paid || 0),
      negotiated_price_naira: sub.negotiated_price !== null && sub.negotiated_price !== void 0 ? toNaira(sub.negotiated_price) : null,
      discount_amount_naira: toNaira(sub.discount_amount || 0),
      final_amount_naira: toNaira(sub.final_amount || sub.amount_paid || 0),
      amount_paid_naira: toNaira(sub.amount_paid || 0),
      feature_flags: typeof sub.plan_feature_flags === "string" ? JSON.parse(sub.plan_feature_flags || "{}") : sub.plan_feature_flags
    } : null,
    usage: {
      students: studentCount,
      staff: staffCount
    },
    platformSettings: {
      default_currency: platformSettings?.default_currency || "NGN",
      default_grace_period_days: platformSettings?.default_grace_period_days || 7,
      bachs_enabled: Boolean(platformSettings?.bachs_enabled ?? 1),
      bank_transfer_enabled: Boolean(platformSettings?.bank_transfer_enabled ?? 1),
      invoice_payments_enabled: Boolean(platformSettings?.invoice_payments_enabled ?? 1),
      platform_bank_name: platformSettings?.platform_bank_name || "Zenith Bank Plc",
      platform_account_name: platformSettings?.platform_account_name || "School Pay Manager Global Ltd",
      platform_account_number: platformSettings?.platform_account_number || "1012345678",
      platform_contact_email: platformSettings?.platform_contact_email || "SchoolPay28@gmail.com",
      platform_contact_phone: platformSettings?.platform_contact_phone || "08160754659"
    },
    availablePlans: availablePlans.map((p) => ({
      ...p,
      price_naira: toNaira(p.price),
      feature_flags: typeof p.feature_flags === "string" ? JSON.parse(p.feature_flags || "{}") : p.feature_flags
    }))
  });
});
schoolBillingRouter.get("/history", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const payments = db.prepare(`
    SELECT pp.*, p.display_name as plan_display_name
    FROM platform_payments pp
    LEFT JOIN subscription_plans p ON pp.plan_id = p.id
    WHERE pp.school_id = ?
    ORDER BY pp.created_at DESC
  `).all(schoolId);
  const invoices = db.prepare(`
    SELECT pi.*, p.display_name as plan_display_name
    FROM platform_invoices pi
    LEFT JOIN subscription_plans p ON pi.plan_id = p.id
    WHERE pi.school_id = ?
    ORDER BY pi.issue_date DESC
  `).all(schoolId);
  return res.json({
    success: true,
    payments: payments.map((p) => ({
      ...p,
      amount_naira: toNaira(p.amount)
    })),
    invoices: invoices.map((inv) => ({
      ...inv,
      standard_price_naira: toNaira(inv.standard_price),
      discount_naira: toNaira(inv.discount),
      final_amount_naira: toNaira(inv.final_amount)
    }))
  });
});
schoolBillingRouter.post("/checkout", requireAuth, requireTenant, async (req, res) => {
  const schoolId = req.targetSchoolId;
  const { plan_id, callback_url } = req.body;
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  if (!school) {
    return res.status(404).json({ error: "NOT_FOUND", message: "School tenant not found" });
  }
  let sub = db.prepare(`
    SELECT * FROM school_subscriptions
    WHERE school_id = ?
    ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, rowid DESC
    LIMIT 1
  `).get(schoolId);
  const targetPlanId = plan_id || sub?.plan_id || school.current_plan_id || "plan_standard";
  const plan = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(targetPlanId);
  if (!plan) {
    return res.status(404).json({ error: "PLAN_NOT_FOUND", message: "Selected subscription plan not found" });
  }
  let standardPriceKobo = plan.price;
  let finalAmountKobo = standardPriceKobo;
  let discountKobo = 0;
  if (sub && sub.plan_id === targetPlanId && sub.final_amount > 0) {
    finalAmountKobo = sub.final_amount;
  } else if (sub && sub.plan_id === targetPlanId && sub.negotiated_price !== null && sub.negotiated_price !== void 0) {
    finalAmountKobo = sub.negotiated_price;
  } else {
    const discountRow = db.prepare(`
      SELECT * FROM subscription_discounts
      WHERE active = 1 AND (school_id = ? OR school_id IS NULL) AND (plan_id = ? OR plan_id IS NULL)
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      ORDER BY discount_type ASC LIMIT 1
    `).get(schoolId, targetPlanId);
    if (discountRow) {
      if (discountRow.discount_type === "PERCENTAGE") {
        discountKobo = Math.round(standardPriceKobo * discountRow.discount_value / 100);
      } else {
        discountKobo = discountRow.discount_value;
      }
      finalAmountKobo = Math.max(0, standardPriceKobo - discountKobo);
    }
  }
  const internalRef = `PLT-${school.slug.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
  const paymentId = `ppay_${crypto8.randomBytes(6).toString("hex")}`;
  db.prepare(`
    INSERT INTO platform_payments (
      id, school_id, subscription_id, plan_id, amount, currency, payment_method, provider,
      internal_reference, status, notes
    ) VALUES (?, ?, ?, ?, ?, 'NGN', 'ONLINE', 'BACHS', ?, 'PENDING', ?)
  `).run(
    paymentId,
    schoolId,
    sub?.id || null,
    plan.id,
    finalAmountKobo,
    internalRef,
    `Bachs checkout initiated for ${plan.display_name}`
  );
  try {
    const bachsProvider = paymentService.getProvider("BACHS");
    const initResult = await bachsProvider.initializePayment({
      schoolId,
      studentId: req.user.id,
      invoiceId: sub?.id || "sub_init",
      amountKobo: finalAmountKobo,
      currency: "NGN",
      email: req.user.email || school.email,
      studentName: school.name,
      callbackUrl: callback_url || `${process.env.APP_URL || "http://localhost:3000"}/?status=success&ref=${internalRef}`,
      metadata: {
        school_id: schoolId,
        subscription_id: sub?.id || null,
        plan_id: plan.id,
        platform_payment_id: paymentId,
        internal_reference: internalRef
      }
    });
    db.prepare("UPDATE platform_payments SET provider_reference = ? WHERE id = ?").run(
      initResult.providerReference,
      paymentId
    );
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId,
      action: "SAAS_CHECKOUT_SESSION_INITIATED",
      entity: "PLATFORM_PAYMENT",
      entityId: paymentId,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { plan_id: plan.id, amountKobo: finalAmountKobo, internalRef, provider: "BACHS" }
    });
    return res.json({
      success: true,
      checkoutUrl: initResult.checkoutUrl,
      providerReference: initResult.providerReference,
      internalReference: internalRef,
      finalAmountNaira: toNaira(finalAmountKobo),
      finalAmountKobo
    });
  } catch (err) {
    db.prepare("UPDATE platform_payments SET status = ? WHERE id = ?").run("FAILED", paymentId);
    return res.status(500).json({ error: "CHECKOUT_FAILED", message: err.message || "Failed to initiate checkout with Bachs" });
  }
});
schoolBillingRouter.post("/bank-transfer/submit", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const { plan_id, bank_name, transaction_reference, depositor_name, amount_naira, notes } = req.body;
  if (!transaction_reference || !depositor_name) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "Transaction reference and depositor name are required" });
  }
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  const sub = db.prepare("SELECT * FROM school_subscriptions WHERE school_id = ? ORDER BY created_at DESC LIMIT 1").get(schoolId);
  const targetPlanId = plan_id || sub?.plan_id || school.current_plan_id || "plan_standard";
  const plan = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(targetPlanId);
  if (!plan) {
    return res.status(404).json({ error: "PLAN_NOT_FOUND", message: "Subscription plan not found" });
  }
  const authoritativeAmountKobo = sub?.final_amount > 0 ? sub.final_amount : plan.price;
  const submittedAmountKobo = amount_naira ? toKobo(Number(amount_naira)) : authoritativeAmountKobo;
  const internalRef = `PLT-TRF-${school.slug.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
  const paymentId = `ppay_${crypto8.randomBytes(6).toString("hex")}`;
  db.prepare(`
    INSERT INTO platform_payments (
      id, school_id, subscription_id, plan_id, amount, currency, payment_method, provider,
      provider_reference, internal_reference, status, notes, metadata
    ) VALUES (?, ?, ?, ?, ?, 'NGN', 'BANK_TRANSFER', 'MANUAL', ?, ?, 'PENDING', ?, ?)
  `).run(
    paymentId,
    schoolId,
    sub?.id || null,
    plan.id,
    submittedAmountKobo,
    transaction_reference,
    internalRef,
    `Manual Bank Transfer submitted by ${depositor_name}. Notes: ${notes || "None"}`,
    JSON.stringify({ bank_name, depositor_name, notes })
  );
  logAudit({
    actorId: req.user.id,
    actorEmail: req.user.email,
    schoolId,
    action: "MANUAL_SAAS_PAYMENT_SUBMITTED",
    entity: "PLATFORM_PAYMENT",
    entityId: paymentId,
    ipAddress: req.ip || "127.0.0.1",
    metadata: { depositor_name, transaction_reference, amountKobo: submittedAmountKobo, plan_id: plan.id }
  });
  return res.status(201).json({
    success: true,
    message: "Bank transfer payment proof submitted. Platform administrator will review and approve within 24 hours.",
    internalReference: internalRef,
    paymentId
  });
});
schoolBillingRouter.get("/invoices/:invoiceId", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const { invoiceId } = req.params;
  const invoice = db.prepare(`
    SELECT pi.*,
           s.name as school_name,
           s.address as school_address,
           s.email as school_email,
           s.phone as school_phone,
           p.name as plan_name,
           p.display_name as plan_display_name
    FROM platform_invoices pi
    JOIN schools s ON pi.school_id = s.id
    JOIN subscription_plans p ON pi.plan_id = p.id
    WHERE pi.id = ? AND pi.school_id = ?
  `).get(invoiceId, schoolId);
  if (!invoice) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Platform invoice not found for this school" });
  }
  const platformSettings = db.prepare("SELECT * FROM platform_settings WHERE id = ?").get("platform_global_settings");
  return res.json({
    success: true,
    invoice: {
      ...invoice,
      standard_price_naira: toNaira(invoice.standard_price),
      discount_naira: toNaira(invoice.discount),
      final_amount_naira: toNaira(invoice.final_amount)
    },
    platformSettings
  });
});

// server/webhookHandler.ts
import crypto9 from "node:crypto";
async function handlePaymentWebhook(req, res) {
  const provider = (req.params.provider || "BACHS").toUpperCase();
  const rawBody = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  const signature = req.headers["x-bachs-signature"] || req.headers["x-webhook-signature"] || req.headers["x-signature"] || req.headers["x-hub-signature-256"] || req.headers["x-paystack-signature"] || req.headers["verif-hash"];
  const timestamp = req.headers["x-bachs-timestamp"] || req.headers["x-webhook-timestamp"] || req.headers["x-timestamp"];
  const eventId = `wh_${crypto9.randomBytes(8).toString("hex")}`;
  let payload = {};
  if (typeof req.body === "object" && req.body !== null) {
    payload = req.body;
  } else {
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      payload = {};
    }
  }
  let providerReference = "";
  let internalReference = "";
  let eventType = "unknown";
  let amountKobo = 0;
  let currency = "NGN";
  let schoolId = "";
  let invoiceId = "";
  let studentId = "";
  let platformPaymentId = "";
  if (provider === "PAYSTACK") {
    eventType = payload.event || "charge.success";
    const data = payload.data || {};
    providerReference = data.reference || "";
    amountKobo = Math.round(Number(data.amount) || 0);
    currency = data.currency || "NGN";
    const meta = data.metadata || {};
    schoolId = meta.school_id || "";
    invoiceId = meta.invoice_id || "";
    studentId = meta.student_id || "";
    internalReference = meta.internal_reference || "";
    platformPaymentId = meta.platform_payment_id || "";
  } else if (provider === "FLUTTERWAVE") {
    eventType = payload.event || payload["event.type"] || "charge.completed";
    const data = payload.data || {};
    providerReference = data.tx_ref || data.flw_ref || "";
    amountKobo = toKobo(Number(data.amount) || 0);
    currency = data.currency || "NGN";
    const meta = data.meta || {};
    schoolId = meta.school_id || "";
    invoiceId = meta.invoice_id || "";
    studentId = meta.student_id || "";
    internalReference = meta.internal_reference || "";
    platformPaymentId = meta.platform_payment_id || "";
  } else if (provider === "BACHS") {
    eventType = payload.event || "payment.success";
    const data = payload.data || payload;
    providerReference = data.reference || data.id || payload.reference || "";
    amountKobo = Number(data.amount) || Number(payload.amount_kobo) || toKobo(Number(payload.amount) || 0);
    currency = data.currency || payload.currency || "NGN";
    const meta = data.metadata || payload.metadata || {};
    schoolId = meta.school_id || "";
    invoiceId = meta.invoice_id || "";
    studentId = meta.student_id || "";
    internalReference = meta.internal_reference || "";
    platformPaymentId = meta.platform_payment_id || "";
  } else {
    eventType = payload.event || "payment.success";
    providerReference = payload.reference || payload.provider_reference || "";
    amountKobo = Number(payload.amount_kobo) || toKobo(Number(payload.amount) || 0);
    currency = payload.currency || "NGN";
    const meta = payload.metadata || {};
    schoolId = payload.school_id || meta.school_id || "";
    invoiceId = payload.invoice_id || meta.invoice_id || "";
    studentId = payload.student_id || meta.student_id || "";
    internalReference = payload.internal_reference || meta.internal_reference || "";
    platformPaymentId = payload.platform_payment_id || meta.platform_payment_id || "";
  }
  const idempotencyKey = `${provider}:${providerReference}:${eventType}`;
  const existingEvent = db.prepare("SELECT id, status FROM webhook_events WHERE idempotency_key = ?").get(idempotencyKey);
  if (existingEvent && existingEvent.status === "PROCESSED") {
    return res.status(200).json({ status: "ignored", message: "Webhook event has already been processed." });
  }
  let platPaymentRow = null;
  if (platformPaymentId) {
    platPaymentRow = db.prepare("SELECT * FROM platform_payments WHERE id = ?").get(platformPaymentId);
  }
  if (!platPaymentRow && (providerReference || internalReference)) {
    platPaymentRow = db.prepare(`
      SELECT * FROM platform_payments
      WHERE provider_reference = ? OR internal_reference = ?
    `).get(providerReference, internalReference);
  }
  const isPlatformSaaSPayment = Boolean(
    platPaymentRow || platformPaymentId || internalReference && internalReference.startsWith("PLT-") || payload.metadata && (payload.metadata.subscription_id || payload.metadata.plan_id)
  );
  db.prepare(`
    INSERT OR REPLACE INTO webhook_events (id, school_id, provider, event_type, idempotency_key, provider_reference, payload, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(
    eventId,
    schoolId || platPaymentRow?.school_id || null,
    provider,
    eventType,
    idempotencyKey,
    providerReference,
    rawBody
  );
  try {
    const gateway = paymentService.getProvider(provider);
    const hasGlobalSecret = provider === "BACHS" ? Boolean(process.env.BACHS_WEBHOOK_SECRET) : false;
    if (gateway.isConfigured(schoolId || void 0) || hasGlobalSecret) {
      const isValid = gateway.verifyWebhookSignature(rawBody, signature, schoolId || void 0, timestamp);
      if (!isValid) {
        db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", "Invalid signature", eventId);
        return res.status(401).json({ error: "INVALID_SIGNATURE", message: "Webhook signature verification failed." });
      }
    }
  } catch (err) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", err.message, eventId);
    return res.status(400).json({ error: "PROVIDER_ERROR", message: err.message });
  }
  if (isPlatformSaaSPayment) {
    return processPlatformSubscriptionWebhook({
      res,
      eventId,
      provider,
      providerReference,
      internalReference,
      amountKobo,
      currency,
      platPaymentRow,
      schoolId: schoolId || platPaymentRow?.school_id,
      metadata: payload.metadata || {},
      eventType,
      payload
    });
  }
  const existingPayment = db.prepare("SELECT id, status FROM payments WHERE provider_reference = ?").get(providerReference);
  if (existingPayment && existingPayment.status === "SUCCESS") {
    return res.status(200).json({ status: "ignored", message: "Payment record already exists and confirmed." });
  }
  const isFailedFeeEvent = eventType.includes("failed") || eventType.includes("declined") || eventType.includes("cancelled") || payload?.status === "failed" || payload?.data?.status === "failed";
  if (isFailedFeeEvent) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", `Payment ${eventType}`, eventId);
    return res.status(200).json({ status: "failed", message: `Recorded fee payment failure: ${eventType}` });
  }
  if (!invoiceId) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("IGNORED", "No invoice_id associated", eventId);
    return res.status(200).json({ status: "ignored", message: "No invoice specified in webhook payload." });
  }
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
  if (!invoice) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", "Invoice not found", eventId);
    return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
  }
  if (schoolId && invoice.school_id !== schoolId) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", "School ID mismatch with invoice", eventId);
    return res.status(403).json({ error: "FORBIDDEN", message: "School ownership mismatch." });
  }
  schoolId = invoice.school_id;
  studentId = invoice.student_id;
  if (currency.toUpperCase() !== "NGN") {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", "Invalid currency", eventId);
    return res.status(400).json({ error: "INVALID_CURRENCY", message: "Currency must be NGN." });
  }
  if (amountKobo <= 0 || amountKobo > invoice.balance) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", "Amount exceeds invoice balance", eventId);
    return res.status(400).json({ error: "OVERPAYMENT", message: "Webhook amount exceeds invoice balance." });
  }
  const schoolRow = db.prepare("SELECT slug FROM schools WHERE id = ?").get(schoolId);
  const slug = schoolRow?.slug || "SCH";
  const countRow = db.prepare("SELECT COUNT(*) as c FROM payments WHERE school_id = ?").get(schoolId);
  if (!internalReference) {
    internalReference = generateInternalPaymentReference(slug, countRow.c + 1);
  }
  const paymentId = `pay_${crypto9.randomBytes(8).toString("hex")}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    db.prepare(`
      INSERT INTO payments (
        id, school_id, invoice_id, student_id, payment_reference, internal_reference,
        amount, currency, payment_method, provider, provider_reference, status,
        payment_date, paid_at, verified_at, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NGN', 'ONLINE', ?, ?, 'SUCCESS', ?, ?, ?, 'Automated webhook verified payment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      paymentId,
      schoolId,
      invoice.id,
      invoice.student_id,
      internalReference,
      internalReference,
      amountKobo,
      provider,
      providerReference,
      now.slice(0, 10),
      now,
      now
    );
    const newAmountPaid = invoice.amount_paid + amountKobo;
    const newBalance = Math.max(0, invoice.total - newAmountPaid);
    const newStatus = determineInvoiceStatus(invoice.total, newAmountPaid, invoice.due_date, invoice.status);
    db.prepare(`
      UPDATE invoices SET
        amount_paid = ?,
        balance = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(newAmountPaid, newBalance, newStatus, invoice.id, schoolId);
    const receiptData = issueOfficialReceipt({
      schoolId,
      paymentId,
      invoiceId: invoice.id,
      studentId: invoice.student_id,
      amountKobo,
      previousBalanceKobo: invoice.balance,
      currentBalanceKobo: newBalance,
      notes: `Automated Webhook from ${provider}`
    });
    db.prepare("UPDATE webhook_events SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?").run("PROCESSED", eventId);
    notificationService.notifySchoolAdmins(
      schoolId,
      "PAYMENT_VERIFIED",
      `Webhook Payment Verified: \u20A6${toNaira(amountKobo).toLocaleString()}`,
      `Webhook received from ${provider}. Receipt #${receiptData.receiptNumber} generated for Invoice #${invoice.invoice_number}.`,
      { invoiceId: invoice.id, paymentId, receiptId: receiptData.receiptId, amountKobo }
    );
    notificationService.notifyParentsOfStudent(
      schoolId,
      invoice.student_id,
      "RECEIPT_AVAILABLE",
      `Payment Confirmed: \u20A6${toNaira(amountKobo).toLocaleString()}`,
      `Your payment via ${provider} has been confirmed. Receipt #${receiptData.receiptNumber} is ready.`,
      { invoiceId: invoice.id, paymentId, receiptId: receiptData.receiptId, amountKobo }
    );
    logAudit({
      actorId: null,
      actorEmail: `webhook@${provider.toLowerCase()}.com`,
      schoolId,
      action: "PROCESS_WEBHOOK_PAYMENT",
      entity: "PAYMENT",
      entityId: paymentId,
      ipAddress: req.ip,
      metadata: { provider, providerReference, internalReference, amountKobo, receiptNumber: receiptData.receiptNumber }
    });
    return res.status(200).json({
      status: "success",
      message: "Webhook processed successfully.",
      paymentId,
      receiptNumber: receiptData.receiptNumber
    });
  } catch (err) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", err.message, eventId);
    return res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED", message: err.message });
  }
}
async function processPlatformSubscriptionWebhook(params) {
  const { res, eventId, provider, providerReference, internalReference, currency, metadata, eventType = "payment.success", payload = {} } = params;
  let { platPaymentRow, schoolId, amountKobo } = params;
  const isFailedEvent = eventType.includes("failed") || eventType.includes("declined") || eventType.includes("cancelled") || payload?.status === "failed" || payload?.data?.status === "failed";
  if (isFailedEvent) {
    if (platPaymentRow) {
      db.prepare(`
        UPDATE platform_payments SET
          status = 'FAILED',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(platPaymentRow.id);
    }
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", `Payment ${eventType}`, eventId);
    return res.status(200).json({ status: "failed", message: `Recorded subscription payment failure: ${eventType}` });
  }
  if (!platPaymentRow && schoolId) {
    platPaymentRow = db.prepare(`
      SELECT * FROM platform_payments
      WHERE school_id = ? AND status = 'PENDING'
      ORDER BY created_at DESC LIMIT 1
    `).get(schoolId);
  }
  if (platPaymentRow && platPaymentRow.status === "SUCCESS") {
    db.prepare("UPDATE webhook_events SET status = ? WHERE id = ?").run("PROCESSED", eventId);
    return res.status(200).json({ status: "ignored", message: "Platform subscription payment already confirmed." });
  }
  if (platPaymentRow && platPaymentRow.amount > 0 && amountKobo > 0 && amountKobo < platPaymentRow.amount) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", "Payment amount is less than expected subscription amount", eventId);
    return res.status(400).json({ error: "AMOUNT_MISMATCH", message: "Paid amount is less than required subscription amount." });
  }
  if (!schoolId && platPaymentRow) {
    schoolId = platPaymentRow.school_id;
  }
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  if (!school) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", "School tenant not found", eventId);
    return res.status(404).json({ error: "SCHOOL_NOT_FOUND", message: "School not found for SaaS subscription payment" });
  }
  const planId = platPaymentRow?.plan_id || metadata?.plan_id || school.current_plan_id || "plan_standard";
  const plan = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(planId);
  if (!plan) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", "Plan not found", eventId);
    return res.status(404).json({ error: "PLAN_NOT_FOUND", message: "Subscription plan not found" });
  }
  if (amountKobo <= 0 && platPaymentRow) {
    amountKobo = platPaymentRow.amount;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const todayStr = nowIso.slice(0, 10);
  const interval = (plan.billing_interval || "ANNUAL").toUpperCase();
  const count = plan.billing_interval_count || 1;
  const endDateObj = /* @__PURE__ */ new Date();
  if (interval === "MONTHLY") {
    endDateObj.setMonth(endDateObj.getMonth() + 1 * count);
  } else if (interval === "QUARTERLY") {
    endDateObj.setMonth(endDateObj.getMonth() + 3 * count);
  } else if (interval === "SEMI_ANNUAL") {
    endDateObj.setMonth(endDateObj.getMonth() + 6 * count);
  } else if (interval === "ANNUAL") {
    endDateObj.setFullYear(endDateObj.getFullYear() + 1 * count);
  } else if (interval === "ONE_TIME") {
    endDateObj.setFullYear(endDateObj.getFullYear() + 10);
  } else {
    endDateObj.setMonth(endDateObj.getMonth() + 4 * count);
  }
  const newEndDateStr = endDateObj.toISOString().slice(0, 10);
  try {
    let paymentId = platPaymentRow?.id;
    if (paymentId) {
      db.prepare(`
        UPDATE platform_payments SET
          status = 'SUCCESS',
          provider_reference = COALESCE(?, provider_reference),
          paid_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(providerReference, nowIso, paymentId);
    } else {
      paymentId = `ppay_${crypto9.randomBytes(6).toString("hex")}`;
      const intRef = internalReference || `PLT-${school.slug.slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-6)}`;
      db.prepare(`
        INSERT INTO platform_payments (
          id, school_id, plan_id, amount, currency, payment_method, provider,
          provider_reference, internal_reference, status, paid_at, notes
        ) VALUES (?, ?, ?, ?, 'NGN', 'ONLINE', ?, ?, ?, 'SUCCESS', ?, ?)
      `).run(
        paymentId,
        schoolId,
        plan.id,
        amountKobo,
        provider,
        providerReference,
        intRef,
        nowIso,
        `Automated SaaS payment via ${provider}`
      );
    }
    const activeSub = db.prepare(`
      SELECT * FROM school_subscriptions WHERE school_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(schoolId);
    let subId = activeSub?.id;
    if (activeSub && activeSub.plan_id === plan.id) {
      db.prepare(`
        UPDATE school_subscriptions SET
          status = 'ACTIVE',
          amount_paid = ?,
          final_amount = ?,
          start_date = ?,
          end_date = ?,
          expiry_date = ?,
          renewal_date = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(amountKobo, amountKobo, todayStr, newEndDateStr, newEndDateStr, newEndDateStr, activeSub.id);
    } else {
      subId = `sub_${crypto9.randomBytes(6).toString("hex")}`;
      db.prepare("UPDATE school_subscriptions SET status = 'EXPIRED' WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);
      db.prepare(`
        INSERT INTO school_subscriptions (
          id, school_id, plan_id, status, start_date, end_date, amount_paid,
          standard_plan_price, final_amount, currency, expiry_date, renewal_date, provider, notes
        ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, 'NGN', ?, ?, ?, ?)
      `).run(
        subId,
        schoolId,
        plan.id,
        todayStr,
        newEndDateStr,
        amountKobo,
        plan.price,
        amountKobo,
        newEndDateStr,
        newEndDateStr,
        provider,
        `Activated via ${provider} online checkout`
      );
    }
    db.prepare(`
      UPDATE schools SET
        status = 'ACTIVE',
        current_plan_id = ?,
        subscription_end_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(plan.id, newEndDateStr, schoolId);
    const existingInvoice = db.prepare(`
      SELECT * FROM platform_invoices WHERE school_id = ? AND payment_status = 'PENDING' ORDER BY created_at DESC LIMIT 1
    `).get(schoolId);
    if (existingInvoice) {
      db.prepare(`
        UPDATE platform_invoices SET
          payment_status = 'PAID',
          paid_at = ?,
          payment_method = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nowIso, provider, existingInvoice.id);
    } else {
      const invNumber = `INV-PLT-${(/* @__PURE__ */ new Date()).getFullYear()}-${Date.now().toString().slice(-4)}`;
      db.prepare(`
        INSERT INTO platform_invoices (
          id, invoice_number, school_id, subscription_id, plan_id, billing_period,
          standard_price, discount, final_amount, currency, payment_status,
          issue_date, due_date, paid_at, payment_method, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'NGN', 'PAID', ?, ?, ?, ?, 'Automated platform subscription receipt')
      `).run(
        `pinv_${crypto9.randomBytes(6).toString("hex")}`,
        invNumber,
        schoolId,
        subId,
        plan.id,
        `${todayStr} to ${newEndDateStr}`,
        plan.price,
        amountKobo,
        todayStr,
        todayStr,
        nowIso,
        provider
      );
    }
    db.prepare("UPDATE webhook_events SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?").run("PROCESSED", eventId);
    logAudit({
      actorId: null,
      actorEmail: `billing@${provider.toLowerCase()}.com`,
      schoolId,
      action: "SAAS_SUBSCRIPTION_ACTIVATED_WEBHOOK",
      entity: "PLATFORM_PAYMENT",
      entityId: paymentId,
      metadata: {
        provider,
        providerReference,
        amountKobo,
        planId: plan.id,
        newEndDate: newEndDateStr
      }
    });
    notificationService.notifySchoolAdmins(
      schoolId,
      "SYSTEM",
      `SaaS Subscription Activated: ${plan.display_name}`,
      `Your subscription to ${plan.display_name} has been confirmed. Expiry date extended to ${newEndDateStr}.`,
      { planId: plan.id, expiryDate: newEndDateStr, paymentId, event: "SUBSCRIPTION_RENEWED" }
    );
    return res.status(200).json({
      status: "success",
      message: `SaaS subscription activated successfully for ${school.name}.`,
      paymentId,
      planId: plan.id,
      expiryDate: newEndDateStr
    });
  } catch (err) {
    db.prepare("UPDATE webhook_events SET status = ?, error_message = ? WHERE id = ?").run("FAILED", err.message, eventId);
    return res.status(500).json({ error: "SUBSCRIPTION_WEBHOOK_FAILED", message: err.message });
  }
}
function handleBachsDemoCheckout(req, res) {
  const { ref, internal, amount, school: schoolId } = req.query;
  const school = schoolId ? db.prepare("SELECT name, email, slug FROM schools WHERE id = ?").get(String(schoolId)) : null;
  const amountKobo = Number(amount) || 0;
  const amountNaira = toNaira(amountKobo);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bachs.io Secure Hosted Checkout</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-slate-800 border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
    <div class="flex items-center justify-between pb-4 border-b border-slate-700">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950 font-black">
          B
        </div>
        <span class="font-bold text-lg text-white tracking-tight">bachs<span class="text-emerald-400">.io</span></span>
      </div>
      <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
        Demo Sandbox
      </span>
    </div>

    <div>
      <p class="text-xs text-slate-400">Subscribing Organization</p>
      <h2 class="text-xl font-black text-white">${school ? school.name : "Nigerian School Tenant"}</h2>
      <p class="text-xs text-slate-400 mt-1 font-mono">${internal || ref || "PLT-SUBSCRIPTION"}</p>
    </div>

    <div class="p-4 rounded-2xl bg-slate-950/70 border border-slate-700/80 flex items-center justify-between">
      <div>
        <p class="text-[11px] font-semibold text-slate-400">Total Payable Amount</p>
        <p class="text-xs text-slate-500">Includes secure checkout fees</p>
      </div>
      <div class="text-right">
        <span class="text-2xl font-black text-emerald-400">\u20A6${amountNaira.toLocaleString()}</span>
        <span class="block text-[10px] text-slate-500 font-mono">NGN</span>
      </div>
    </div>

    <div class="space-y-3">
      <p class="text-xs font-bold text-slate-300">Select Test Payment Channel:</p>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="p-3 rounded-xl bg-slate-700/50 border border-emerald-500/50 text-emerald-300 font-semibold flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          Card / Debit
        </div>
        <div class="p-3 rounded-xl bg-slate-700/30 border border-slate-600/50 text-slate-300 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-slate-500"></span>
          Bank Transfer
        </div>
        <div class="p-3 rounded-xl bg-slate-700/30 border border-slate-600/50 text-slate-300 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-slate-500"></span>
          USSD
        </div>
        <div class="p-3 rounded-xl bg-slate-700/30 border border-slate-600/50 text-slate-300 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-slate-500"></span>
          USDC / Crypto
        </div>
      </div>
    </div>

    <form method="POST" action="/api/v1/webhooks/bachs-demo-checkout/complete" class="space-y-3 pt-2">
      <input type="hidden" name="ref" value="${ref || ""}" />
      <input type="hidden" name="internal" value="${internal || ""}" />
      <input type="hidden" name="amount" value="${amountKobo}" />
      <input type="hidden" name="school" value="${schoolId || ""}" />

      <button type="submit" class="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition shadow-lg shadow-emerald-500/20 cursor-pointer">
        Simulate Successful Payment (Instant Webhook)
      </button>

      <a href="/?status=cancelled&ref=${ref || ""}" class="block text-center text-xs text-slate-400 hover:text-white py-2">
        Cancel and return to School Pay Manager
      </a>
    </form>
  </div>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  return res.send(html);
}
async function handleBachsDemoCheckoutComplete(req, res) {
  const { ref, internal, amount, school } = req.body;
  const amountKobo = Number(amount) || 0;
  let platPayment = db.prepare(`
    SELECT * FROM platform_payments
    WHERE provider_reference = ? OR internal_reference = ?
  `).get(ref, internal);
  if (!platPayment && school) {
    platPayment = db.prepare(`
      SELECT * FROM platform_payments
      WHERE school_id = ? AND status = 'PENDING'
      ORDER BY created_at DESC LIMIT 1
    `).get(school);
  }
  const schoolId = school || platPayment?.school_id;
  const targetSchool = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  if (targetSchool) {
    const planId = platPayment?.plan_id || targetSchool.current_plan_id || "plan_standard";
    const plan = db.prepare("SELECT * FROM subscription_plans WHERE id = ?").get(planId);
    const endDateObj = /* @__PURE__ */ new Date();
    endDateObj.setFullYear(endDateObj.getFullYear() + 1);
    const newEndDateStr = endDateObj.toISOString().slice(0, 10);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (platPayment) {
      db.prepare(`
        UPDATE platform_payments SET
          status = 'SUCCESS',
          paid_at = ?,
          provider_reference = COALESCE(?, provider_reference),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nowIso, ref || "bch_simulated_success", platPayment.id);
    }
    db.prepare(`
      UPDATE school_subscriptions SET
        status = 'ACTIVE',
        end_date = ?,
        expiry_date = ?,
        renewal_date = ?,
        amount_paid = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE school_id = ? AND (status = 'ACTIVE' OR status = 'TRIAL' OR status = 'EXPIRED')
    `).run(newEndDateStr, newEndDateStr, newEndDateStr, amountKobo || plan?.price || 0, schoolId);
    db.prepare(`
      UPDATE schools SET
        status = 'ACTIVE',
        subscription_end_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newEndDateStr, schoolId);
    logAudit({
      actorId: null,
      actorEmail: "bachs_demo_checkout@system.local",
      schoolId,
      action: "SAAS_SUBSCRIPTION_ACTIVATED_WEBHOOK",
      entity: "PLATFORM_PAYMENT",
      entityId: platPayment?.id || ref,
      metadata: { simulated: true, provider: "BACHS", newEndDate: newEndDateStr }
    });
  }
  return res.redirect(`/?status=success&ref=${ref || internal || "demo"}`);
}
async function handleBachsWebhook(req, res) {
  req.params = req.params || {};
  req.params.provider = "BACHS";
  return handlePaymentWebhook(req, res);
}

// server/routes.ts
var apiRouter = express3.Router();
apiRouter.post("/webhooks/bachs", handleBachsWebhook);
apiRouter.use("/v1/admin", adminRouter);
apiRouter.use("/v1/school/billing", schoolBillingRouter);
apiRouter.use("/v1/school", schoolBillingRouter);
apiRouter.use("/v1/school", paymentRouter);
apiRouter.use("/v1/school", financeRouter);
apiRouter.post("/v1/webhooks/payments/:provider", handlePaymentWebhook);
apiRouter.post("/v1/webhooks/platform-payments/:provider", handlePaymentWebhook);
apiRouter.get("/v1/webhooks/bachs-demo-checkout", handleBachsDemoCheckout);
apiRouter.post("/v1/webhooks/bachs-demo-checkout/complete", express3.urlencoded({ extended: true }), handleBachsDemoCheckoutComplete);
function slugify(text) {
  return text.toString().toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]+/g, "").replace(/--+/g, "-");
}
apiRouter.post("/v1/auth/register-school", (req, res) => {
  const {
    schoolName,
    schoolType,
    state,
    lga,
    address,
    phone,
    email: schoolEmail,
    ownerName,
    ownerEmail,
    password
  } = req.body;
  if (!schoolName || !schoolType || !state || !lga || !phone || !schoolEmail || !ownerName || !ownerEmail || !password) {
    return res.status(400).json({
      error: "MISSING_FIELDS",
      message: "All fields marked with an asterisk are required for school registration."
    });
  }
  if (password.length < 8) {
    return res.status(400).json({
      error: "WEAK_PASSWORD",
      message: "Password must be at least 8 characters long for bank-grade security."
    });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(schoolEmail) || !emailRegex.test(ownerEmail)) {
    return res.status(400).json({
      error: "INVALID_EMAIL",
      message: "Please provide valid email addresses for school contact and proprietor."
    });
  }
  const existingSchool = db.prepare("SELECT id FROM schools WHERE email = ?").get(schoolEmail.toLowerCase());
  if (existingSchool) {
    return res.status(409).json({
      error: "SCHOOL_EXISTS",
      message: "A school with this official email address is already registered."
    });
  }
  const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail.toLowerCase());
  if (existingUser) {
    return res.status(409).json({
      error: "USER_EXISTS",
      message: "A user account with this proprietor email address already exists. Please log in or use another email."
    });
  }
  const schoolId = "sch_" + crypto10.randomUUID().slice(0, 8);
  const userId = "usr_" + crypto10.randomUUID().slice(0, 8);
  const settingsId = "set_" + crypto10.randomUUID().slice(0, 8);
  const userRoleId = "ur_" + crypto10.randomUUID().slice(0, 8);
  const baseSlug = slugify(schoolName);
  const slug = `${baseSlug}-${crypto10.randomBytes(3).toString("hex")}`;
  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);
  try {
    db.exec("BEGIN TRANSACTION;");
    db.prepare(`
      INSERT INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website)
      VALUES (?, ?, ?, ?, 'TRIAL', ?, ?, ?, ?, ?, ?)
    `).run(
      schoolId,
      schoolName.trim(),
      slug,
      schoolType,
      address || "",
      state,
      lga,
      phone,
      schoolEmail.toLowerCase(),
      req.body.website || null
    );
    db.prepare(`
      INSERT INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email, payment_notification_sms, portal_subdomain)
      VALUES (?, ?, 'NGN', '\u20A6', '2024/2025', '1st Term', ?, 0, ?)
    `).run(settingsId, schoolId, schoolEmail.toLowerCase(), baseSlug);
    db.prepare(`
      INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1)
    `).run(
      userId,
      ownerEmail.toLowerCase(),
      passwordHash,
      salt,
      ownerName.trim(),
      phone
    );
    db.prepare(`
      INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
      VALUES (?, ?, ?, 'role_school_owner', 1)
    `).run(userRoleId, userId, schoolId);
    db.exec("COMMIT;");
    const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
    const token = createSession(userId, schoolId, clientIp, req.headers["user-agent"]);
    logAudit({
      actorId: userId,
      actorEmail: ownerEmail.toLowerCase(),
      schoolId,
      action: "REGISTER_SCHOOL",
      entity: "SCHOOL",
      entityId: schoolId,
      ipAddress: clientIp,
      metadata: { schoolName, schoolType, state, lga }
    });
    return res.status(201).json({
      success: true,
      message: "School tenant and proprietor account registered successfully!",
      token,
      user: {
        id: userId,
        email: ownerEmail.toLowerCase(),
        full_name: ownerName.trim(),
        is_platform_admin: 0
      },
      school: {
        id: schoolId,
        name: schoolName.trim(),
        slug,
        type: schoolType,
        status: "TRIAL",
        state,
        lga,
        phone,
        email: schoolEmail.toLowerCase()
      },
      activeRole: {
        role_name: "SCHOOL_OWNER",
        role_display_name: "School Proprietor / Owner",
        scope: "SCHOOL"
      }
    });
  } catch (error) {
    db.exec("ROLLBACK;");
    console.error("[Registration Error]", error);
    return res.status(500).json({
      error: "REGISTRATION_FAILED",
      message: "Failed to complete registration: " + (error?.message || "Database error")
    });
  }
});
apiRouter.post("/v1/auth/login", (req, res) => {
  const { email, password, schoolId } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "MISSING_CREDENTIALS", message: "Email and password are required." });
  }
  const normalizedEmail = (email || "").trim().toLowerCase();
  const user = db.prepare("SELECT * FROM users WHERE LOWER(email) = ? AND is_active = 1").get(normalizedEmail);
  if (!user) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email address or password." });
  }
  const isValid = verifyPassword(password, user.password_hash, user.salt);
  if (!isValid) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email address or password." });
  }
  const roles = db.prepare(`
    SELECT ur.*, r.name as role_name, r.display_name as role_display_name, r.scope as role_scope,
           s.name as school_name, s.status as school_status, s.slug as school_slug
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    LEFT JOIN schools s ON ur.school_id = s.id
    WHERE ur.user_id = ?
  `).all(user.id);
  let activeSchoolId = null;
  let activeRole = roles[0] || null;
  if (user.is_platform_admin === 1) {
    activeSchoolId = null;
  } else if (schoolId) {
    const matched = roles.find((r) => r.school_id === schoolId);
    if (!matched) {
      return res.status(403).json({ error: "TENANT_UNAUTHORIZED", message: "You do not belong to this school." });
    }
    activeSchoolId = schoolId;
    activeRole = matched;
  } else {
    const firstSchoolRole = roles.find((r) => r.school_id !== null);
    if (firstSchoolRole) {
      activeSchoolId = firstSchoolRole.school_id;
      activeRole = firstSchoolRole;
    }
  }
  const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
  const token = createSession(user.id, activeSchoolId, clientIp, req.headers["user-agent"]);
  logAudit({
    actorId: user.id,
    actorEmail: user.email,
    schoolId: activeSchoolId,
    action: "LOGIN",
    entity: "AUTH_SESSION",
    ipAddress: clientIp,
    metadata: {
      isSuperAdmin: user.is_platform_admin === 1,
      role: activeRole?.role_name || "UNKNOWN"
    }
  });
  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      is_platform_admin: user.is_platform_admin
    },
    activeSchoolId,
    activeRole,
    roles
  });
});
apiRouter.post("/v1/auth/logout", requireAuth, (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : req.headers["x-session-token"];
  if (token) {
    destroySession(token);
  }
  if (req.user) {
    const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId: req.activeSchoolId,
      action: "LOGOUT",
      entity: "AUTH_SESSION",
      ipAddress: clientIp
    });
  }
  return res.json({ success: true, message: "Logged out successfully" });
});
apiRouter.post("/v1/auth/exit-impersonation", requireAuth, (req, res) => {
  const authHeader = req.headers.authorization;
  let token;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (req.headers["x-session-token"]) {
    token = req.headers["x-session-token"];
  }
  if (token) {
    destroySession(token);
    logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      schoolId: req.activeSchoolId,
      action: "IMPERSONATION_ENDED",
      entity: "SUPPORT_SESSION",
      ipAddress: req.ip || "127.0.0.1",
      metadata: { impersonatedBy: req.impersonatedBy }
    });
  }
  return res.json({ success: true, message: "Support impersonation session safely terminated." });
});
apiRouter.get("/v1/auth/me", requireAuth, (req, res) => {
  const user = req.user;
  const roles = req.roles;
  let activeSchool = null;
  let activeSettings = null;
  if (req.activeSchoolId) {
    activeSchool = db.prepare("SELECT * FROM schools WHERE id = ?").get(req.activeSchoolId);
    activeSettings = db.prepare("SELECT * FROM school_settings WHERE school_id = ?").get(req.activeSchoolId);
  }
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      phone: user.phone,
      is_platform_admin: user.is_platform_admin
    },
    roles,
    activeSchoolId: req.activeSchoolId,
    activeSchool,
    activeSettings,
    impersonatedBy: req.impersonatedBy || null
  });
});
apiRouter.post("/v1/auth/forgot-password", (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "MISSING_EMAIL", message: "Email address is required" });
  }
  const normalizedEmail = (email || "").trim().toLowerCase();
  const user = db.prepare("SELECT id, email, full_name FROM users WHERE LOWER(email) = ? AND is_active = 1").get(normalizedEmail);
  if (!user) {
    return res.json({
      success: true,
      message: "If an account exists with this email, a password reset link has been dispatched."
    });
  }
  const resetToken = "rst_" + crypto10.randomBytes(24).toString("hex");
  const resetId = "pr_" + crypto10.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1e3).toISOString();
  db.prepare(`
    INSERT INTO password_resets (id, email, token, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(resetId, user.email, resetToken, expiresAt);
  logAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: "PASSWORD_RESET_REQUESTED",
    entity: "USER_CREDENTIALS",
    entityId: user.id,
    ipAddress: req.ip || "127.0.0.1"
  });
  return res.json({
    success: true,
    message: "Password reset token generated successfully. In production, this is sent to the registered email address.",
    debugToken: resetToken
    // Provided in development for instantaneous testing
  });
});
apiRouter.post("/v1/auth/reset-password", (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "Reset token and new password are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "WEAK_PASSWORD", message: "Password must be at least 8 characters long." });
  }
  const resetRecord = db.prepare(`
    SELECT * FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(token);
  if (!resetRecord) {
    return res.status(400).json({
      error: "INVALID_TOKEN",
      message: "This reset token is invalid or has expired. Please request a new link."
    });
  }
  const salt = generateSalt();
  const passwordHash = hashPassword(newPassword, salt);
  db.exec("BEGIN TRANSACTION;");
  db.prepare(`
    UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?
  `).run(passwordHash, salt, resetRecord.email);
  db.prepare(`
    UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(resetRecord.id);
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(resetRecord.email);
  if (user) {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  }
  db.exec("COMMIT;");
  logAudit({
    actorEmail: resetRecord.email,
    action: "PASSWORD_RESET_COMPLETED",
    entity: "USER_CREDENTIALS",
    ipAddress: req.ip || "127.0.0.1"
  });
  return res.json({
    success: true,
    message: "Your password has been successfully reset. Please sign in with your new password."
  });
});
apiRouter.get("/v1/school/profile", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const school = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
  const settings = db.prepare("SELECT * FROM school_settings WHERE school_id = ?").get(schoolId);
  return res.json({ success: true, school, settings });
});
apiRouter.put(
  "/v1/school/profile",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { name, address, state, lga, phone, email, website, type } = req.body;
    if (!name || !phone || !email || !state || !lga) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Name, phone, email, state, and LGA are required." });
    }
    const existing = db.prepare("SELECT id FROM schools WHERE email = ? AND id != ?").get(email.toLowerCase(), schoolId);
    if (existing) {
      return res.status(409).json({ error: "EMAIL_IN_USE", message: "This email is already registered to another school." });
    }
    db.prepare(`
      UPDATE schools
      SET name = ?, address = ?, state = ?, lga = ?, phone = ?, email = ?, website = ?, type = COALESCE(?, type), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name.trim(), address || "", state, lga, phone, email.toLowerCase(), website || null, type || null, schoolId);
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId,
      action: "UPDATE_SCHOOL_PROFILE",
      entity: "SCHOOL",
      entityId: schoolId,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { name, state, lga, phone }
    });
    const updated = db.prepare("SELECT * FROM schools WHERE id = ?").get(schoolId);
    return res.json({ success: true, message: "School profile updated successfully", school: updated });
  }
);
apiRouter.get("/v1/school/settings", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const settings = db.prepare("SELECT * FROM school_settings WHERE school_id = ?").get(schoolId);
  return res.json({ success: true, settings });
});
apiRouter.put(
  "/v1/school/settings",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN", "BURSAR"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const {
      current_academic_session,
      current_term,
      payment_notification_email,
      payment_notification_sms,
      allow_partial_payments
    } = req.body;
    db.prepare(`
      UPDATE school_settings
      SET current_academic_session = ?,
          current_term = ?,
          payment_notification_email = ?,
          payment_notification_sms = ?,
          allow_partial_payments = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE school_id = ?
    `).run(
      current_academic_session || "2024/2025",
      current_term || "1st Term",
      payment_notification_email || null,
      payment_notification_sms ? 1 : 0,
      allow_partial_payments !== void 0 ? allow_partial_payments ? 1 : 0 : 1,
      schoolId
    );
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId,
      action: "UPDATE_SCHOOL_SETTINGS",
      entity: "SCHOOL_SETTINGS",
      entityId: schoolId,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { current_academic_session, current_term }
    });
    const settings = db.prepare("SELECT * FROM school_settings WHERE school_id = ?").get(schoolId);
    return res.json({ success: true, message: "School settings saved", settings });
  }
);
apiRouter.get("/v1/school/stats", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const totalStudents = db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ?").get(schoolId)?.c || 0;
  const activeStudents = db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ? AND student_status = 'ACTIVE'").get(schoolId)?.c || 0;
  const totalClasses = db.prepare("SELECT COUNT(*) as c FROM classes WHERE school_id = ?").get(schoolId)?.c || 0;
  const totalStaff = db.prepare("SELECT COUNT(*) as c FROM staff WHERE school_id = ?").get(schoolId)?.c || 0;
  const totalParents = db.prepare("SELECT COUNT(*) as c FROM parents WHERE school_id = ?").get(schoolId)?.c || 0;
  const activeSessionRow = db.prepare("SELECT name FROM academic_sessions WHERE school_id = ? AND status = 'ACTIVE' LIMIT 1").get(schoolId);
  const activeTermRow = db.prepare("SELECT name FROM terms WHERE school_id = ? AND status = 'ACTIVE' LIMIT 1").get(schoolId);
  const settings = db.prepare("SELECT current_academic_session, current_term FROM school_settings WHERE school_id = ?").get(schoolId);
  const recentStudents = db.prepare(`
    SELECT id, admission_number, full_name, class_name, student_status, created_at
    FROM students
    WHERE school_id = ?
    ORDER BY created_at DESC
    LIMIT 5
  `).all(schoolId);
  return res.json({
    success: true,
    stats: {
      totalStudents,
      activeStudents,
      totalClasses,
      totalStaff,
      totalParents,
      currentAcademicSession: activeSessionRow?.name || settings?.current_academic_session || "2024/2025",
      currentTerm: activeTermRow?.name || settings?.current_term || "1st Term",
      recentStudents
    }
  });
});
apiRouter.get("/v1/school/students", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const {
    search,
    class_id,
    class_arm_id,
    gender,
    status,
    academic_session_id,
    page = "1",
    limit = "50",
    sort = "name_asc"
  } = req.query;
  let sql = "SELECT * FROM students WHERE school_id = ?";
  const params = [schoolId];
  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    sql += " AND (full_name LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR admission_number LIKE ? OR phone LIKE ? OR email LIKE ?)";
    params.push(s, s, s, s, s, s);
  }
  if (class_id) {
    sql += " AND class_id = ?";
    params.push(class_id);
  }
  if (class_arm_id) {
    sql += " AND class_arm_id = ?";
    params.push(class_arm_id);
  }
  if (gender) {
    sql += " AND gender = ?";
    params.push(gender);
  }
  if (status) {
    sql += " AND student_status = ?";
    params.push(status);
  }
  if (academic_session_id) {
    sql += " AND academic_session_id = ?";
    params.push(academic_session_id);
  }
  const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as c");
  const total = db.prepare(countSql).get(...params)?.c || 0;
  if (sort === "name_desc") {
    sql += " ORDER BY full_name DESC";
  } else if (sort === "admission_asc") {
    sql += " ORDER BY admission_number ASC";
  } else if (sort === "admission_desc") {
    sql += " ORDER BY admission_number DESC";
  } else if (sort === "date_desc") {
    sql += " ORDER BY created_at DESC";
  } else {
    sql += " ORDER BY full_name ASC";
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;
  sql += " LIMIT ? OFFSET ?";
  params.push(limitNum, offset);
  const students = db.prepare(sql).all(...params);
  return res.json({
    success: true,
    count: total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum) || 1,
    students
  });
});
apiRouter.get("/v1/school/students/:id", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const { id } = req.params;
  const student = db.prepare(`
    SELECT * FROM students WHERE id = ? AND school_id = ?
  `).get(id, schoolId);
  if (!student) {
    const crossSchoolCheck = db.prepare("SELECT school_id FROM students WHERE id = ?").get(id);
    if (crossSchoolCheck && crossSchoolCheck.school_id !== schoolId) {
      const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
      logAudit({
        actorId: req.user.id,
        actorEmail: req.user.email,
        schoolId,
        action: "CROSS_TENANT_STUDENT_ACCESS_REJECTED",
        entity: "STUDENT",
        entityId: id,
        ipAddress: clientIp,
        metadata: {
          attemptedId: id,
          requesterSchool: schoolId,
          targetSchool: crossSchoolCheck.school_id
        }
      });
      return res.status(403).json({
        error: "CROSS_TENANT_ACCESS_DENIED",
        message: "Security Violation: This student record belongs to a different school tenant.",
        code: "IDOR_PREVENTED"
      });
    }
    return res.status(404).json({ error: "NOT_FOUND", message: "Student record not found in your school." });
  }
  const parents = db.prepare(`
    SELECT p.id, p.id as parent_id, p.first_name, p.last_name, (p.first_name || ' ' || p.last_name) as full_name,
           p.phone, p.email, p.occupation, p.address, ps.relationship_type, ps.is_primary_contact
    FROM parent_students ps
    JOIN parents p ON ps.parent_id = p.id
    WHERE ps.student_id = ? AND ps.school_id = ?
  `).all(id, schoolId);
  return res.json({
    success: true,
    student: {
      ...student,
      parents
    }
  });
});
apiRouter.post(
  "/v1/school/students",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN", "BURSAR"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const body = req.body || {};
    const {
      admission_number,
      first_name,
      middle_name = "",
      last_name,
      gender,
      date_of_birth,
      phone,
      email,
      address,
      state,
      nationality = "Nigerian",
      admission_date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      student_status = "ACTIVE",
      class_id,
      class_arm_id,
      class_name,
      class_arm_name,
      academic_session_id,
      profile_photo_url,
      emergency_contact,
      medical_notes
    } = body;
    if (!admission_number || !first_name || !last_name) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Admission number, first name, and last name are required."
      });
    }
    const currentStudentCount = db.prepare("SELECT COUNT(*) as c FROM students WHERE school_id = ?").get(schoolId).c;
    const schoolPlan = db.prepare(`
      SELECT p.student_limit, p.maximum_students, p.display_name
      FROM schools s
      LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
      WHERE s.id = ?
    `).get(schoolId);
    const studentLimit = schoolPlan?.maximum_students || schoolPlan?.student_limit;
    if (studentLimit && currentStudentCount >= studentLimit) {
      return res.status(403).json({
        error: "STUDENT_LIMIT_REACHED",
        message: `Your school has reached the maximum student limit of ${studentLimit} on the ${schoolPlan.display_name || "current"} plan. Please upgrade your subscription plan to enroll more students.`,
        currentCount: currentStudentCount,
        limit: studentLimit
      });
    }
    const existing = db.prepare("SELECT id FROM students WHERE school_id = ? AND admission_number = ?").get(schoolId, admission_number.trim());
    if (existing) {
      return res.status(409).json({
        error: "DUPLICATE_ADMISSION_NUMBER",
        message: `Admission number "${admission_number}" already exists in your school.`
      });
    }
    const id = "stu_" + crypto10.randomUUID().slice(0, 10);
    const fullName = `${first_name.trim()} ${middle_name ? middle_name.trim() + " " : ""}${last_name.trim()}`.trim();
    db.prepare(`
      INSERT INTO students (
        id, school_id, admission_number, first_name, middle_name, last_name, full_name, gender,
        date_of_birth, phone, email, address, state, nationality, admission_date, student_status,
        class_id, class_arm_id, class_name, class_arm_name, academic_session_id, profile_photo_url,
        emergency_contact, medical_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      schoolId,
      admission_number.trim(),
      first_name.trim(),
      middle_name.trim(),
      last_name.trim(),
      fullName,
      gender || null,
      date_of_birth || null,
      phone || null,
      email ? email.toLowerCase().trim() : null,
      address || null,
      state || null,
      nationality || "Nigerian",
      admission_date,
      student_status,
      class_id || null,
      class_arm_id || null,
      class_name || null,
      class_arm_name || null,
      academic_session_id || null,
      profile_photo_url || null,
      emergency_contact || null,
      medical_notes || null
    );
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId,
      action: "ENROLL_STUDENT",
      entity: "STUDENT",
      entityId: id,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { admission_number, full_name: fullName, class_name }
    });
    const student = db.prepare("SELECT * FROM students WHERE id = ?").get(id);
    return res.status(201).json({ success: true, message: "Student enrolled successfully", student });
  }
);
apiRouter.put(
  "/v1/school/students/:id",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN", "BURSAR"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const existing = db.prepare("SELECT * FROM students WHERE id = ?").get(id);
    if (!existing) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Student not found." });
    }
    if (existing.school_id !== schoolId) {
      return res.status(403).json({
        error: "CROSS_TENANT_ACCESS_DENIED",
        message: "Security Violation: Cannot modify student of another school."
      });
    }
    const b = req.body || {};
    const firstName = b.first_name !== void 0 ? b.first_name.trim() : existing.first_name;
    const middleName = b.middle_name !== void 0 ? b.middle_name.trim() : existing.middle_name;
    const lastName = b.last_name !== void 0 ? b.last_name.trim() : existing.last_name;
    const fullName = `${firstName} ${middleName ? middleName + " " : ""}${lastName}`.trim();
    if (b.admission_number && b.admission_number.trim() !== existing.admission_number) {
      const duplicate = db.prepare("SELECT id FROM students WHERE school_id = ? AND admission_number = ? AND id != ?").get(schoolId, b.admission_number.trim(), id);
      if (duplicate) {
        return res.status(409).json({ error: "DUPLICATE_ADMISSION_NUMBER", message: "Admission number already in use." });
      }
    }
    db.prepare(`
      UPDATE students SET
        admission_number = COALESCE(?, admission_number),
        first_name = ?,
        middle_name = ?,
        last_name = ?,
        full_name = ?,
        gender = COALESCE(?, gender),
        date_of_birth = COALESCE(?, date_of_birth),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        state = COALESCE(?, state),
        nationality = COALESCE(?, nationality),
        student_status = COALESCE(?, student_status),
        class_id = COALESCE(?, class_id),
        class_arm_id = COALESCE(?, class_arm_id),
        class_name = COALESCE(?, class_name),
        class_arm_name = COALESCE(?, class_arm_name),
        academic_session_id = COALESCE(?, academic_session_id),
        emergency_contact = COALESCE(?, emergency_contact),
        medical_notes = COALESCE(?, medical_notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(
      b.admission_number?.trim() || null,
      firstName,
      middleName || "",
      lastName,
      fullName,
      b.gender || null,
      b.date_of_birth || null,
      b.phone || null,
      b.email ? b.email.toLowerCase().trim() : null,
      b.address || null,
      b.state || null,
      b.nationality || null,
      b.student_status || null,
      b.class_id || null,
      b.class_arm_id || null,
      b.class_name || null,
      b.class_arm_name || null,
      b.academic_session_id || null,
      b.emergency_contact || null,
      b.medical_notes || null,
      id,
      schoolId
    );
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId,
      action: "UPDATE_STUDENT",
      entity: "STUDENT",
      entityId: id,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { full_name: fullName }
    });
    const updated = db.prepare("SELECT * FROM students WHERE id = ?").get(id);
    return res.json({ success: true, message: "Student updated successfully", student: updated });
  }
);
apiRouter.delete(
  "/v1/school/students/:id",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const existing = db.prepare("SELECT * FROM students WHERE id = ?").get(id);
    if (!existing) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Student not found." });
    }
    if (existing.school_id !== schoolId) {
      return res.status(403).json({
        error: "CROSS_TENANT_ACCESS_DENIED",
        message: "Security Violation: Cannot delete student of another school."
      });
    }
    db.prepare("DELETE FROM parent_students WHERE student_id = ? AND school_id = ?").run(id, schoolId);
    db.prepare("DELETE FROM students WHERE id = ? AND school_id = ?").run(id, schoolId);
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId,
      action: "DELETE_STUDENT",
      entity: "STUDENT",
      entityId: id,
      ipAddress: req.ip || "127.0.0.1",
      metadata: { admission_number: existing.admission_number, full_name: existing.full_name }
    });
    return res.json({ success: true, message: "Student record deleted successfully" });
  }
);
apiRouter.post(
  "/v1/school/students/import",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN", "BURSAR"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { students: rawRows } = req.body;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: "INVALID_PAYLOAD", message: "No student records provided for import." });
    }
    let importedCount = 0;
    let failedCount = 0;
    const errors = [];
    const existingAdmissions = new Set(
      db.prepare("SELECT admission_number FROM students WHERE school_id = ?").all(schoolId).map((r) => r.admission_number)
    );
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const adm = (row.admission_number || row["Admission No"] || row["Admission Number"] || "").toString().trim();
      const fn = (row.first_name || row["First Name"] || "").toString().trim();
      const ln = (row.last_name || row["Last Name"] || "").toString().trim();
      const mn = (row.middle_name || row["Middle Name"] || "").toString().trim();
      const gender = (row.gender || row["Gender"] || "Male").toString().trim();
      const className = (row.class_name || row["Class"] || "").toString().trim();
      const armName = (row.class_arm_name || row["Arm"] || row["Stream"] || "").toString().trim();
      const phone = (row.phone || row["Phone"] || "").toString().trim();
      const email = (row.email || row["Email"] || "").toString().trim();
      if (!adm || !fn || !ln) {
        failedCount++;
        errors.push({ row: i + 1, admission_number: adm, error: "Missing required admission number, first name, or last name" });
        continue;
      }
      if (existingAdmissions.has(adm)) {
        failedCount++;
        errors.push({ row: i + 1, admission_number: adm, error: `Admission number "${adm}" already exists in this school` });
        continue;
      }
      try {
        const id = "stu_" + crypto10.randomUUID().slice(0, 10);
        const fullName = `${fn} ${mn ? mn + " " : ""}${ln}`.trim();
        db.prepare(`
          INSERT INTO students (
            id, school_id, admission_number, first_name, middle_name, last_name, full_name,
            gender, phone, email, class_name, class_arm_name, student_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
        `).run(
          id,
          schoolId,
          adm,
          fn,
          mn,
          ln,
          fullName,
          gender,
          phone || null,
          email ? email.toLowerCase() : null,
          className || null,
          armName || null
        );
        existingAdmissions.add(adm);
        importedCount++;
      } catch (err) {
        failedCount++;
        errors.push({ row: i + 1, admission_number: adm, error: err?.message || "Database insert failed" });
      }
    }
    logAudit({
      actorId: req.user.id,
      actorEmail: req.user.email,
      schoolId,
      action: "BULK_IMPORT_STUDENTS",
      entity: "STUDENTS",
      ipAddress: req.ip || "127.0.0.1",
      metadata: { importedCount, failedCount, totalRows: rawRows.length }
    });
    return res.json({
      success: true,
      importedCount,
      failedCount,
      errors,
      message: `Successfully imported ${importedCount} student(s). ${failedCount} record(s) failed or were duplicates.`
    });
  }
);
apiRouter.get(
  "/v1/school/students/export",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN", "BURSAR"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const students = db.prepare(`
      SELECT admission_number, first_name, middle_name, last_name, full_name, gender,
             date_of_birth, phone, email, class_name, class_arm_name, student_status,
             state, admission_date, emergency_contact, created_at
      FROM students
      WHERE school_id = ?
      ORDER BY admission_number ASC
    `).all(schoolId);
    const headers = [
      "Admission Number",
      "First Name",
      "Middle Name",
      "Last Name",
      "Full Name",
      "Gender",
      "Date of Birth",
      "Phone",
      "Email",
      "Class",
      "Arm",
      "Status",
      "State",
      "Admission Date",
      "Emergency Contact"
    ];
    const csvRows = [headers.join(",")];
    for (const s of students) {
      const row = [
        `"${s.admission_number || ""}"`,
        `"${s.first_name || ""}"`,
        `"${s.middle_name || ""}"`,
        `"${s.last_name || ""}"`,
        `"${s.full_name || ""}"`,
        `"${s.gender || ""}"`,
        `"${s.date_of_birth || ""}"`,
        `"${s.phone || ""}"`,
        `"${s.email || ""}"`,
        `"${s.class_name || ""}"`,
        `"${s.class_arm_name || ""}"`,
        `"${s.student_status || ""}"`,
        `"${s.state || ""}"`,
        `"${s.admission_date || ""}"`,
        `"${s.emergency_contact || ""}"`
      ];
      csvRows.push(row.join(","));
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=students_${schoolId}.csv`);
    return res.send(csvRows.join("\n"));
  }
);
apiRouter.get("/v1/school/parents", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const parents = db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM parent_students ps WHERE ps.parent_id = p.id) as total_children
    FROM parents p
    WHERE p.school_id = ?
    ORDER BY p.last_name ASC, p.first_name ASC
  `).all(schoolId);
  const parentsWithChildren = parents.map((p) => {
    const children = db.prepare(`
      SELECT s.id as student_id, s.admission_number, s.full_name, s.class_name, ps.relationship_type, ps.is_primary_contact
      FROM parent_students ps
      JOIN students s ON ps.student_id = s.id
      WHERE ps.parent_id = ? AND ps.school_id = ?
    `).all(p.id, schoolId);
    return { ...p, children };
  });
  return res.json({ success: true, count: parentsWithChildren.length, parents: parentsWithChildren });
});
apiRouter.post(
  "/v1/school/parents",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN", "BURSAR"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { first_name, last_name, phone, email, address, occupation, relationship, emergency_contact, student_ids } = req.body;
    if (!first_name || !last_name || !phone) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "First name, last name, and phone are required." });
    }
    const id = "par_" + crypto10.randomUUID().slice(0, 10);
    db.prepare(`
      INSERT INTO parents (id, school_id, first_name, last_name, phone, email, address, occupation, relationship, emergency_contact)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      schoolId,
      first_name.trim(),
      last_name.trim(),
      phone.trim(),
      email ? email.toLowerCase().trim() : null,
      address || null,
      occupation || null,
      relationship || "Parent",
      emergency_contact || null
    );
    if (Array.isArray(student_ids)) {
      for (const sid of student_ids) {
        const student = db.prepare("SELECT id FROM students WHERE id = ? AND school_id = ?").get(sid, schoolId);
        if (student) {
          db.prepare(`
            INSERT OR IGNORE INTO parent_students (id, school_id, parent_id, student_id, relationship_type, is_primary_contact)
            VALUES (?, ?, ?, ?, ?, 1)
          `).run("ps_" + crypto10.randomUUID().slice(0, 10), schoolId, id, sid, relationship || "Parent");
        }
      }
    }
    const parent = db.prepare("SELECT * FROM parents WHERE id = ?").get(id);
    return res.status(201).json({ success: true, message: "Parent record created successfully", parent });
  }
);
apiRouter.put(
  "/v1/school/parents/:id",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN", "BURSAR"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const existing = db.prepare("SELECT * FROM parents WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Parent not found." });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: "CROSS_TENANT_ACCESS_DENIED", message: "Cannot edit parent of another school." });
    }
    const b = req.body || {};
    db.prepare(`
      UPDATE parents SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        occupation = COALESCE(?, occupation),
        relationship = COALESCE(?, relationship),
        emergency_contact = COALESCE(?, emergency_contact),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(
      b.first_name?.trim() || null,
      b.last_name?.trim() || null,
      b.phone?.trim() || null,
      b.email ? b.email.toLowerCase().trim() : null,
      b.address || null,
      b.occupation || null,
      b.relationship || null,
      b.emergency_contact || null,
      id,
      schoolId
    );
    const updated = db.prepare("SELECT * FROM parents WHERE id = ?").get(id);
    return res.json({ success: true, message: "Parent updated successfully", parent: updated });
  }
);
apiRouter.delete(
  "/v1/school/parents/:id",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const existing = db.prepare("SELECT * FROM parents WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Parent not found." });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: "CROSS_TENANT_ACCESS_DENIED", message: "Cannot delete parent of another school." });
    }
    db.prepare("DELETE FROM parent_students WHERE parent_id = ? AND school_id = ?").run(id, schoolId);
    db.prepare("DELETE FROM parents WHERE id = ? AND school_id = ?").run(id, schoolId);
    return res.json({ success: true, message: "Parent record deleted successfully" });
  }
);
apiRouter.get("/v1/school/classes", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const classes = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as total_students
    FROM classes c
    WHERE c.school_id = ?
    ORDER BY c.name ASC
  `).all(schoolId);
  const classesWithArms = classes.map((cls) => {
    const arms = db.prepare(`
      SELECT ca.*,
             (SELECT COUNT(*) FROM students s WHERE s.class_arm_id = ca.id) as total_students,
             (SELECT (first_name || ' ' || last_name) FROM staff st WHERE st.id = ca.class_teacher_id) as class_teacher_name
      FROM class_arms ca
      WHERE ca.class_id = ? AND ca.school_id = ?
      ORDER BY ca.name ASC
    `).all(cls.id, schoolId);
    return { ...cls, arms };
  });
  return res.json({ success: true, count: classesWithArms.length, classes: classesWithArms });
});
apiRouter.post(
  "/v1/school/classes",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { name, level, description, academic_session_id } = req.body;
    if (!name || !level) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Class name and level are required." });
    }
    const id = "cls_" + crypto10.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO classes (id, school_id, name, level, description, academic_session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, schoolId, name.trim(), level.trim(), description || null, academic_session_id || null);
    const created = db.prepare("SELECT * FROM classes WHERE id = ?").get(id);
    return res.status(201).json({ success: true, message: "Class created successfully", class: created });
  }
);
apiRouter.post(
  "/v1/school/classes/:id/arms",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id: classId } = req.params;
    const { name, capacity = 40, class_teacher_id } = req.body;
    const cls = db.prepare("SELECT id FROM classes WHERE id = ? AND school_id = ?").get(classId, schoolId);
    if (!cls) {
      return res.status(404).json({ error: "CLASS_NOT_FOUND", message: "Class not found in this school." });
    }
    if (!name) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Arm name is required (e.g. Gold, A, Science)." });
    }
    const armId = "arm_" + crypto10.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO class_arms (id, school_id, class_id, name, capacity, class_teacher_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(armId, schoolId, classId, name.trim(), parseInt(capacity, 10) || 40, class_teacher_id || null);
    const arm = db.prepare("SELECT * FROM class_arms WHERE id = ?").get(armId);
    return res.status(201).json({ success: true, message: "Class arm created successfully", arm });
  }
);
apiRouter.delete(
  "/v1/school/classes/:id",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const cls = db.prepare("SELECT id, school_id FROM classes WHERE id = ?").get(id);
    if (!cls) return res.status(404).json({ error: "NOT_FOUND", message: "Class not found." });
    if (cls.school_id !== schoolId) {
      return res.status(403).json({ error: "CROSS_TENANT_ACCESS_DENIED", message: "Cannot delete class of another school." });
    }
    db.prepare("DELETE FROM class_arms WHERE class_id = ? AND school_id = ?").run(id, schoolId);
    db.prepare("DELETE FROM classes WHERE id = ? AND school_id = ?").run(id, schoolId);
    return res.json({ success: true, message: "Class deleted successfully" });
  }
);
apiRouter.get("/v1/school/staff", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const staff = db.prepare(`
    SELECT * FROM staff WHERE school_id = ? ORDER BY staff_number ASC
  `).all(schoolId);
  return res.json({ success: true, count: staff.length, staff });
});
apiRouter.post(
  "/v1/school/staff",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const {
      staff_number,
      first_name,
      middle_name = "",
      last_name,
      email,
      phone,
      gender,
      address,
      job_title,
      department,
      employment_status = "ACTIVE",
      date_joined = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)
    } = req.body;
    if (!staff_number || !first_name || !last_name || !email || !phone || !job_title) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Staff number, name, email, phone, and job title are required."
      });
    }
    const currentStaffCount = db.prepare("SELECT COUNT(*) as c FROM staff WHERE school_id = ?").get(schoolId).c;
    const schoolPlan = db.prepare(`
      SELECT p.staff_limit, p.maximum_staff, p.display_name
      FROM schools s
      LEFT JOIN subscription_plans p ON s.current_plan_id = p.id
      WHERE s.id = ?
    `).get(schoolId);
    const staffLimit = schoolPlan?.maximum_staff || schoolPlan?.staff_limit;
    if (staffLimit && currentStaffCount >= staffLimit) {
      return res.status(403).json({
        error: "STAFF_LIMIT_REACHED",
        message: `Your school has reached the maximum staff limit of ${staffLimit} on the ${schoolPlan.display_name || "current"} plan. Please upgrade your subscription plan to add more staff.`,
        currentCount: currentStaffCount,
        limit: staffLimit
      });
    }
    const existing = db.prepare("SELECT id FROM staff WHERE school_id = ? AND staff_number = ?").get(schoolId, staff_number.trim());
    if (existing) {
      return res.status(409).json({ error: "DUPLICATE_STAFF_NUMBER", message: "Staff number already exists in your school." });
    }
    const id = "stf_" + crypto10.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO staff (
        id, school_id, staff_number, first_name, middle_name, last_name, email, phone,
        gender, address, job_title, department, employment_status, date_joined
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      schoolId,
      staff_number.trim(),
      first_name.trim(),
      middle_name.trim(),
      last_name.trim(),
      email.toLowerCase().trim(),
      phone.trim(),
      gender || null,
      address || null,
      job_title.trim(),
      department || null,
      employment_status,
      date_joined
    );
    const created = db.prepare("SELECT * FROM staff WHERE id = ?").get(id);
    return res.status(201).json({ success: true, message: "Staff member added successfully", staff: created });
  }
);
apiRouter.put(
  "/v1/school/staff/:id",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const existing = db.prepare("SELECT * FROM staff WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Staff member not found." });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: "CROSS_TENANT_ACCESS_DENIED", message: "Cannot edit staff of another school." });
    }
    const b = req.body || {};
    db.prepare(`
      UPDATE staff SET
        staff_number = COALESCE(?, staff_number),
        first_name = COALESCE(?, first_name),
        middle_name = COALESCE(?, middle_name),
        last_name = COALESCE(?, last_name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        gender = COALESCE(?, gender),
        job_title = COALESCE(?, job_title),
        department = COALESCE(?, department),
        employment_status = COALESCE(?, employment_status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(
      b.staff_number?.trim() || null,
      b.first_name?.trim() || null,
      b.middle_name?.trim() || null,
      b.last_name?.trim() || null,
      b.email ? b.email.toLowerCase().trim() : null,
      b.phone?.trim() || null,
      b.gender || null,
      b.job_title?.trim() || null,
      b.department || null,
      b.employment_status || null,
      id,
      schoolId
    );
    const updated = db.prepare("SELECT * FROM staff WHERE id = ?").get(id);
    return res.json({ success: true, message: "Staff updated successfully", staff: updated });
  }
);
apiRouter.delete(
  "/v1/school/staff/:id",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id } = req.params;
    const existing = db.prepare("SELECT * FROM staff WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Staff not found." });
    if (existing.school_id !== schoolId) {
      return res.status(403).json({ error: "CROSS_TENANT_ACCESS_DENIED", message: "Cannot delete staff of another school." });
    }
    db.prepare("DELETE FROM staff WHERE id = ? AND school_id = ?").run(id, schoolId);
    return res.json({ success: true, message: "Staff record deleted successfully" });
  }
);
apiRouter.get("/v1/school/academic-sessions", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const sessions = db.prepare(`
    SELECT * FROM academic_sessions WHERE school_id = ? ORDER BY name DESC
  `).all(schoolId);
  const sessionsWithTerms = sessions.map((s) => {
    const terms = db.prepare(`
      SELECT * FROM terms WHERE academic_session_id = ? AND school_id = ? ORDER BY name ASC
    `).all(s.id, schoolId);
    return { ...s, terms };
  });
  return res.json({ success: true, sessions: sessionsWithTerms });
});
apiRouter.post(
  "/v1/school/academic-sessions",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { name, start_date, end_date, status = "UPCOMING" } = req.body;
    if (!name) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Session name is required (e.g. 2025/2026)." });
    }
    if (status === "ACTIVE") {
      db.prepare("UPDATE academic_sessions SET status = 'COMPLETED' WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);
    }
    const id = "ses_" + crypto10.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, schoolId, name.trim(), start_date || null, end_date || null, status);
    const session = db.prepare("SELECT * FROM academic_sessions WHERE id = ?").get(id);
    return res.status(201).json({ success: true, message: "Academic session created successfully", session });
  }
);
apiRouter.post(
  "/v1/school/academic-sessions/:id/terms",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const { id: sessionId } = req.params;
    const { name, start_date, end_date, status = "UPCOMING" } = req.body;
    const session = db.prepare("SELECT id FROM academic_sessions WHERE id = ? AND school_id = ?").get(sessionId, schoolId);
    if (!session) {
      return res.status(404).json({ error: "SESSION_NOT_FOUND", message: "Academic session not found in your school." });
    }
    if (!name) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Term name is required (e.g. 1st Term)." });
    }
    if (status === "ACTIVE") {
      db.prepare("UPDATE terms SET status = 'COMPLETED' WHERE school_id = ? AND status = 'ACTIVE'").run(schoolId);
    }
    const termId = "trm_" + crypto10.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO terms (id, school_id, academic_session_id, name, start_date, end_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(termId, schoolId, sessionId, name.trim(), start_date || null, end_date || null, status);
    const term = db.prepare("SELECT * FROM terms WHERE id = ?").get(termId);
    return res.status(201).json({ success: true, message: "Term created successfully", term });
  }
);
apiRouter.get("/v1/school/fees", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const fees = db.prepare("SELECT * FROM fees WHERE school_id = ? ORDER BY name ASC").all(schoolId);
  return res.json({ success: true, count: fees.length, fees });
});
apiRouter.get("/v1/school/users", requireAuth, requireTenant, (req, res) => {
  const schoolId = req.targetSchoolId;
  const users = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.created_at,
           r.name as role_name, r.display_name as role_display_name
    FROM user_roles ur
    JOIN users u ON ur.user_id = u.id
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.school_id = ?
    ORDER BY u.created_at ASC
  `).all(schoolId);
  return res.json({ success: true, users });
});
apiRouter.get(
  "/v1/school/audit-logs",
  requireAuth,
  requireTenant,
  requireRole(["SCHOOL_OWNER", "SCHOOL_ADMIN"]),
  (req, res) => {
    const schoolId = req.targetSchoolId;
    const logs = db.prepare(`
      SELECT * FROM audit_logs
      WHERE school_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(schoolId);
    return res.json({ success: true, logs });
  }
);
apiRouter.post("/v1/test/simulate-idor", requireAuth, (req, res) => {
  const { foreignSchoolId } = req.body;
  if (!foreignSchoolId) {
    return res.status(400).json({ error: "MISSING_PARAM", message: "foreignSchoolId is required to test isolation" });
  }
  req.params.schoolId = foreignSchoolId;
  requireTenant(req, res, () => {
    return res.json({
      accessGranted: true,
      message: "Access permitted because you are either a Super Admin or legitimately belong to this school.",
      schoolId: foreignSchoolId
    });
  });
});

// server.ts
process.env.DISABLE_HMR = "true";
async function startServer() {
  const app = express4();
  const PORT = 3e3;
  initDatabase();
  app.use(
    express4.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      }
    })
  );
  app.use(express4.urlencoded({ extended: true }));
  const rateLimitMap = /* @__PURE__ */ new Map();
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (req.path.startsWith("/api/v1/auth")) {
      const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
      const now = Date.now();
      const windowMs = 60 * 1e3;
      const history = rateLimitMap.get(clientIp) || [];
      const recent = history.filter((ts) => now - ts < windowMs);
      if (recent.length >= 100) {
        return res.status(429).json({
          error: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again after 60 seconds."
        });
      }
      recent.push(now);
      rateLimitMap.set(clientIp, recent);
    }
    next();
  });
  app.use("/api", apiRouter);
  const publicDir = path3.resolve(process.cwd(), "public");
  app.use(express4.static(publicDir));
  app.get("/api/health", (req, res) => {
    res.json({
      status: "healthy",
      service: "School Pay Manager API",
      version: "1.0.0-step1",
      tenantIsolation: "ENFORCED",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: process.cwd(),
      server: {
        middlewareMode: true,
        hmr: false
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path3.resolve(process.cwd(), "dist");
    app.use(express4.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path3.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`=======================================================`);
    console.log(`  SCHOOL PAY MANAGER - STEP 1 FOUNDATION SERVER`);
    console.log(`  Running on: http://0.0.0.0:${PORT}`);
    console.log(`  Multi-Tenant Guard: ACTIVE`);
    console.log(`  Platform Super Admin: SchoolPay28@gmail.com`);
    console.log(`=======================================================`);
  });
}
startServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
