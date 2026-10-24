import express from 'express';
import crypto from 'node:crypto';
import { db } from './db.ts';
import {
  hashPassword,
  generateSalt,
  verifyPassword,
  type UserRecord,
} from './auth.ts';
import {
  requireAuth,
  requireTenant,
  requireRole,
  type AuthenticatedRequest,
} from './tenantMiddleware.ts';
import { logAudit } from './audit.ts';

export const recoveryRouter = express.Router();

// Helper: Mask email address for privacy and anti-enumeration
function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***@***.***';
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `${local.charAt(0)}***@${domain}`;
  }
  return `${local.slice(0, 2)}***@${domain}`;
}

// Helper: Mask phone number
function maskPhone(phone: string | null): string {
  if (!phone) return '***';
  const clean = phone.trim();
  if (clean.length <= 4) return '***' + clean;
  return clean.slice(0, 4) + '***' + clean.slice(-3);
}

// Helper: Normalize security answer before hashing
function normalizeAnswer(ans: string): string {
  return (ans || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Rate limiting map for recovery endpoints: IP -> timestamps
const recoveryRateLimit = new Map<string, number[]>();
function checkRateLimit(ip: string, maxReqs = 15, windowMs = 60 * 1000): boolean {
  const now = Date.now();
  const history = recoveryRateLimit.get(ip) || [];
  const recent = history.filter((t) => now - t < windowMs);
  if (recent.length >= maxReqs) return false;
  recent.push(now);
  recoveryRateLimit.set(ip, recent);
  return true;
}

// ==============================================================================
// 1. PHASE 2 & 5: IDENTIFY ACCOUNT & DISCOVER AVAILABLE RECOVERY METHODS
// ==============================================================================
recoveryRouter.post('/recovery/identify', (req, res) => {
  const clientIp = (req.ip || req.headers['x-forwarded-for'] || '127.0.0.1') as string;
  if (!checkRateLimit(clientIp, 20)) {
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many recovery requests. Please wait a moment and try again.',
    });
  }

  const { identifier } = req.body;
  if (!identifier || typeof identifier !== 'string') {
    return res.status(400).json({
      error: 'MISSING_IDENTIFIER',
      message: 'Please provide your registered official email address or phone number.',
    });
  }

  const clean = identifier.trim().toLowerCase();

  // Search user by email or phone number
  const user = db.prepare(`
    SELECT id, email, phone, full_name, is_platform_admin, is_active,
           security_question_1, security_question_2,
           recovery_attempts, recovery_locked_until
    FROM users
    WHERE (LOWER(email) = ? OR phone = ? OR LOWER(recovery_email) = ? OR recovery_phone = ?)
      AND is_active = 1
  `).get(clean, clean, clean, clean) as any;

  // Generic anti-enumeration response if user does not exist
  if (!user) {
    const dummyChallenge = 'rc_' + crypto.randomUUID();
    return res.json({
      success: true,
      challengeId: dummyChallenge,
      maskedIdentifier: clean.includes('@') ? maskEmail(clean) : maskPhone(clean),
      methods: {
        emailLink: true,
        securityQuestions: false,
        backupCodes: false,
        adminAssisted: true,
      },
      message: 'If an account matches these details, recovery options have been initialized.',
    });
  }

  // Check lockout
  if (user.recovery_locked_until) {
    const lockExpiry = new Date(user.recovery_locked_until).getTime();
    if (Date.now() < lockExpiry) {
      const minutesLeft = Math.ceil((lockExpiry - Date.now()) / (60 * 1000));
      return res.status(429).json({
        error: 'ACCOUNT_LOCKED',
        message: `This account is temporarily locked for security due to repeated failed recovery attempts. Please try again in ${minutesLeft} minute(s) or contact your school administrator.`,
      });
    } else {
      // Lock has expired, reset attempts
      db.prepare(`
        UPDATE users SET recovery_attempts = 0, recovery_locked_until = NULL WHERE id = ?
      `).run(user.id);
    }
  }

  // Check unused backup codes
  const unusedCodesCount = (
    db.prepare(`SELECT COUNT(*) as count FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL`).get(user.id) as any
  )?.count || 0;

  // Create stateful recovery challenge valid for 15 minutes
  const challengeId = 'rc_' + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO recovery_challenges (id, user_id, identifier, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(challengeId, user.id, user.email, expiresAt);

  // Security questions cannot be the sole recovery method for platform SUPER_ADMIN
  const hasSecurityQuestions =
    Boolean(user.security_question_1 && user.security_question_2) &&
    user.is_platform_admin !== 1;

  const hasBackupCodes = unusedCodesCount > 0 && user.is_platform_admin !== 1;

  return res.json({
    success: true,
    challengeId,
    maskedIdentifier: maskEmail(user.email),
    maskedPhone: maskPhone(user.phone),
    isPlatformAdmin: user.is_platform_admin === 1,
    methods: {
      emailLink: true,
      securityQuestions: hasSecurityQuestions,
      backupCodes: hasBackupCodes,
      adminAssisted: user.is_platform_admin !== 1,
    },
    // Only return the question prompts, NEVER the stored answer hashes!
    questions: hasSecurityQuestions
      ? [user.security_question_1, user.security_question_2]
      : null,
    message: 'Account identified. Please select your preferred recovery verification method.',
  });
});

// ==============================================================================
// 2. PHASE 3 - METHOD 2: SECURITY-QUESTION-ASSISTED VERIFICATION
// ==============================================================================
recoveryRouter.post('/recovery/verify-questions', (req, res) => {
  const { challengeId, answer1, answer2 } = req.body;

  if (!challengeId || !answer1 || !answer2) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Both security answers are required to verify your identity.',
    });
  }

  const challenge = db.prepare(`
    SELECT * FROM recovery_challenges
    WHERE id = ? AND expires_at > datetime('now') AND verified_at IS NULL
  `).get(challengeId) as any;

  if (!challenge) {
    return res.status(400).json({
      error: 'INVALID_CHALLENGE',
      message: 'This recovery session has expired or is invalid. Please start over.',
    });
  }

  const user = db.prepare(`
    SELECT id, email, is_platform_admin,
           security_question_1, security_answer_hash_1, security_answer_salt_1,
           security_question_2, security_answer_hash_2, security_answer_salt_2,
           recovery_attempts
    FROM users WHERE id = ?
  `).get(challenge.user_id) as any;

  if (!user || user.is_platform_admin === 1) {
    return res.status(403).json({
      error: 'UNAUTHORIZED_METHOD',
      message: 'Security questions are not available for this account type. Please use verified email recovery.',
    });
  }

  if (!user.security_answer_hash_1 || !user.security_answer_hash_2) {
    return res.status(400).json({
      error: 'QUESTIONS_NOT_CONFIGURED',
      message: 'Security questions have not been configured for this account. Please use verified email or administrator assistance.',
    });
  }

  // Verify answers using timing-safe comparison
  const norm1 = normalizeAnswer(answer1);
  const norm2 = normalizeAnswer(answer2);

  const match1 = verifyPassword(norm1, user.security_answer_hash_1, user.security_answer_salt_1);
  const match2 = verifyPassword(norm2, user.security_answer_hash_2, user.security_answer_salt_2);

  if (!match1 || !match2) {
    // Record failed attempt
    const newAttempts = (user.recovery_attempts || 0) + 1;
    let lockUntil: string | null = null;
    let remaining = 3 - newAttempts;

    if (newAttempts >= 3) {
      lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      remaining = 0;
    }

    db.prepare(`
      UPDATE users SET recovery_attempts = ?, recovery_locked_until = ? WHERE id = ?
    `).run(newAttempts, lockUntil, user.id);

    logAudit({
      actorEmail: user.email,
      action: 'SECURITY_QUESTIONS_FAILED',
      entity: 'USER_RECOVERY',
      entityId: user.id,
      ipAddress: (req.ip || '127.0.0.1') as string,
    });

    if (remaining === 0) {
      return res.status(429).json({
        error: 'ACCOUNT_LOCKED',
        message: 'Too many incorrect answers. Account recovery has been locked for 15 minutes.',
      });
    }

    return res.status(400).json({
      error: 'INCORRECT_ANSWERS',
      message: `One or more security answers are incorrect. You have ${remaining} attempt(s) remaining before a temporary security lockout.`,
      attemptsRemaining: remaining,
    });
  }

  // Success: Reset attempt counters
  db.prepare(`
    UPDATE users SET recovery_attempts = 0, recovery_locked_until = NULL WHERE id = ?
  `).run(user.id);

  // Mark challenge verified
  db.prepare(`
    UPDATE recovery_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(challengeId);

  // Generate single-use recovery ticket (15 minutes expiry)
  const recoveryTicket = 'rck_' + crypto.randomBytes(24).toString('hex');
  const ticketId = 'pr_' + crypto.randomUUID();
  const ticketExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
    VALUES (?, ?, ?, ?, 'SECURITY_QUESTIONS', ?, CURRENT_TIMESTAMP, ?)
  `).run(ticketId, user.id, user.email, recoveryTicket, ticketExpiresAt, (req.ip || '127.0.0.1') as string);

  logAudit({
    actorEmail: user.email,
    action: 'SECURITY_QUESTIONS_VERIFIED',
    entity: 'USER_RECOVERY',
    entityId: user.id,
    ipAddress: (req.ip || '127.0.0.1') as string,
  });

  return res.json({
    success: true,
    recoveryTicket,
    message: 'Identity verified successfully! You may now set your new password.',
  });
});

// ==============================================================================
// 3. PHASE 3 - METHOD 3: ONE-TIME EMERGENCY BACKUP CODE VERIFICATION
// ==============================================================================
recoveryRouter.post('/recovery/verify-code', (req, res) => {
  const { challengeId, code } = req.body;

  if (!challengeId || !code) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Both challenge session and recovery code are required.',
    });
  }

  const challenge = db.prepare(`
    SELECT * FROM recovery_challenges
    WHERE id = ? AND expires_at > datetime('now') AND verified_at IS NULL
  `).get(challengeId) as any;

  if (!challenge) {
    return res.status(400).json({
      error: 'INVALID_CHALLENGE',
      message: 'Recovery session has expired or is invalid. Please start over.',
    });
  }

  const user = db.prepare(`SELECT id, email, salt FROM users WHERE id = ?`).get(challenge.user_id) as any;
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  const cleanCode = (code || '').trim().toUpperCase();

  // Find unused backup codes for user
  const backupCodes = db.prepare(`
    SELECT id, code_hash FROM user_recovery_codes
    WHERE user_id = ? AND used_at IS NULL
  `).all(user.id) as any[];

  let matchedCodeId: string | null = null;
  for (const item of backupCodes) {
    const rawVal = item.code_hash || '';
    if (rawVal.includes(':')) {
      const [salt, hash] = rawVal.split(':');
      if (verifyPassword(cleanCode, hash, salt)) {
        matchedCodeId = item.id;
        break;
      }
    } else {
      if (verifyPassword(cleanCode, rawVal, user.salt)) {
        matchedCodeId = item.id;
        break;
      }
    }
  }

  if (!matchedCodeId) {
    logAudit({
      actorEmail: user.email,
      action: 'RECOVERY_CODE_FAILED',
      entity: 'USER_RECOVERY',
      entityId: user.id,
      ipAddress: (req.ip || '127.0.0.1') as string,
    });

    return res.status(400).json({
      error: 'INVALID_CODE',
      message: 'The recovery code entered is invalid or has already been used.',
    });
  }

  // Single-use enforcement: Permanently mark code as used
  db.prepare(`
    UPDATE user_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(matchedCodeId);

  // Mark challenge verified
  db.prepare(`
    UPDATE recovery_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(challengeId);

  // Issue short-lived recovery ticket
  const recoveryTicket = 'rck_' + crypto.randomBytes(24).toString('hex');
  const ticketId = 'pr_' + crypto.randomUUID();
  const ticketExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
    VALUES (?, ?, ?, ?, 'BACKUP_CODE', ?, CURRENT_TIMESTAMP, ?)
  `).run(ticketId, user.id, user.email, recoveryTicket, ticketExpiresAt, (req.ip || '127.0.0.1') as string);

  logAudit({
    actorEmail: user.email,
    action: 'RECOVERY_CODE_VERIFIED',
    entity: 'USER_RECOVERY',
    entityId: user.id,
    ipAddress: (req.ip || '127.0.0.1') as string,
  });

  return res.json({
    success: true,
    recoveryTicket,
    message: 'Backup recovery code verified successfully! You may now set your new password.',
  });
});

// ==============================================================================
// 4. PHASE 3 - METHOD 1: VERIFIED EMAIL RECOVERY LINK / TICKET
// ==============================================================================
recoveryRouter.post('/recovery/request-link', (req, res) => {
  const { challengeId } = req.body;

  if (!challengeId) {
    return res.status(400).json({
      error: 'MISSING_CHALLENGE',
      message: 'Recovery challenge session ID is required.',
    });
  }

  const challenge = db.prepare(`
    SELECT * FROM recovery_challenges
    WHERE id = ? AND expires_at > datetime('now')
  `).get(challengeId) as any;

  if (!challenge) {
    return res.status(400).json({
      error: 'INVALID_CHALLENGE',
      message: 'Recovery session has expired or is invalid. Please start over.',
    });
  }

  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(challenge.user_id) as any;
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  const resetToken = 'rst_' + crypto.randomBytes(24).toString('hex');
  const resetId = 'pr_' + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare(`
    INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
    VALUES (?, ?, ?, ?, 'EMAIL_LINK', ?, CURRENT_TIMESTAMP, ?)
  `).run(resetId, user.id, user.email, resetToken, expiresAt, (req.ip || '127.0.0.1') as string);

  logAudit({
    actorEmail: user.email,
    action: 'PASSWORD_RESET_LINK_REQUESTED',
    entity: 'USER_CREDENTIALS',
    entityId: user.id,
    ipAddress: (req.ip || '127.0.0.1') as string,
  });

  return res.json({
    success: true,
    recoveryTicket: resetToken,
    message: `A secure password recovery verification has been generated for ${maskEmail(user.email)}.`,
  });
});

// ==============================================================================
// 5. PHASE 5 & 6: COMPLETE PASSWORD RESET WITH STRICT SERVER VALIDATION
// ==============================================================================
recoveryRouter.post('/recovery/complete', (req, res) => {
  const { recoveryTicket, newPassword, confirmPassword } = req.body;

  if (!recoveryTicket || !newPassword) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Recovery verification ticket and new password are required.',
    });
  }

  if (confirmPassword && newPassword !== confirmPassword) {
    return res.status(400).json({
      error: 'PASSWORD_MISMATCH',
      message: 'New password and confirmation password do not match.',
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      error: 'WEAK_PASSWORD',
      message: 'Password must be at least 8 characters long.',
    });
  }

  // Find unexpired and unused reset record
  const resetRecord = db.prepare(`
    SELECT * FROM password_resets
    WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(recoveryTicket) as any;

  if (!resetRecord) {
    return res.status(400).json({
      error: 'INVALID_OR_EXPIRED_TICKET',
      message: 'This recovery verification session is invalid or has expired. Please request a new recovery verification.',
    });
  }

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(resetRecord.email) as any;
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Target user account not found.' });
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(newPassword, salt);

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Update user password and clear recovery lockouts
    db.prepare(`
      UPDATE users SET
        password_hash = ?,
        salt = ?,
        recovery_attempts = 0,
        recovery_locked_until = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(passwordHash, salt, user.id);

    // 2. Mark reset token as used (single-use enforcement)
    db.prepare(`
      UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(resetRecord.id);

    // 3. Invalidate ALL active sessions for this user across all devices (Phase 6 requirement)
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);

    db.exec('COMMIT;');
  } catch (err: any) {
    db.exec('ROLLBACK;');
    console.error('Password reset transaction failed:', err);
    return res.status(500).json({
      error: 'RESET_FAILED',
      message: 'Failed to update password. Please try again.',
    });
  }

  logAudit({
    actorEmail: user.email,
    action: 'PASSWORD_RESET_COMPLETED',
    entity: 'USER_CREDENTIALS',
    entityId: user.id,
    ipAddress: (req.ip || '127.0.0.1') as string,
  });

  return res.json({
    success: true,
    message: 'Your password has been reset successfully. Please sign in with your new password.',
  });
});

// ==============================================================================
// 6. PHASE 4: FORGOTTEN EMAIL OR PHONE IDENTIFIER LOOKUP (MASKED DISPLAY)
// ==============================================================================
recoveryRouter.post('/recovery/lookup-identifier', (req, res) => {
  const clientIp = (req.ip || '127.0.0.1') as string;
  if (!checkRateLimit(clientIp, 10)) {
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many lookup requests. Please wait a moment.',
    });
  }

  const { phone, fullName, schoolName } = req.body;
  if (!phone && (!fullName || !schoolName)) {
    return res.status(400).json({
      error: 'INSUFFICIENT_DETAILS',
      message: 'Please provide either your registered phone number, or your full name and school name.',
    });
  }

  let matchedUser: any = null;

  if (phone) {
    const cleanPhone = phone.trim();
    matchedUser = db.prepare(`
      SELECT id, email, phone, full_name, is_platform_admin FROM users
      WHERE (phone = ? OR recovery_phone = ?) AND is_active = 1
    `).get(cleanPhone, cleanPhone);
  } else if (fullName && schoolName) {
    const cleanName = fullName.trim().toLowerCase();
    const cleanSchool = schoolName.trim().toLowerCase();

    matchedUser = db.prepare(`
      SELECT u.id, u.email, u.phone, u.full_name, u.is_platform_admin
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN schools s ON s.id = ur.school_id
      WHERE LOWER(u.full_name) LIKE ? AND LOWER(s.name) LIKE ? AND u.is_active = 1
      LIMIT 1
    `).get(`%${cleanName}%`, `%${cleanSchool}%`);
  }

  // Anti-enumeration: if no match, generic response
  if (!matchedUser) {
    return res.json({
      success: true,
      found: false,
      message: 'If an account matches those verified details, contact your school administrator or use support channels.',
    });
  }

  return res.json({
    success: true,
    found: true,
    maskedEmail: maskEmail(matchedUser.email),
    maskedPhone: maskPhone(matchedUser.phone),
    message: 'Registered account identifier found.',
  });
});

// ==============================================================================
// 7. AUTHENTICATED USER SECURITY SETTINGS (CONFIGURE QUESTIONS & BACKUP CODES)
// ==============================================================================
recoveryRouter.get('/security/status', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const user = db.prepare(`
    SELECT security_question_1, security_question_2, recovery_email, recovery_phone, is_platform_admin
    FROM users WHERE id = ?
  `).get(userId) as any;

  const unusedCodesCount = (
    db.prepare(`SELECT COUNT(*) as count FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL`).get(userId) as any
  )?.count || 0;

  return res.json({
    hasSecurityQuestions: Boolean(user?.security_question_1 && user?.security_question_2),
    question1: user?.security_question_1 || null,
    question2: user?.security_question_2 || null,
    recoveryEmail: user?.recovery_email ? maskEmail(user.recovery_email) : null,
    recoveryPhone: user?.recovery_phone ? maskPhone(user.recovery_phone) : null,
    backupCodesRemaining: unusedCodesCount,
    isPlatformAdmin: user?.is_platform_admin === 1,
  });
});

recoveryRouter.post('/security/configure-questions', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { currentPassword, question1, answer1, question2, answer2, recoveryEmail, recoveryPhone } = req.body;

  if (!currentPassword) {
    return res.status(400).json({
      error: 'MISSING_PASSWORD',
      message: 'Current account password is required to update security recovery questions.',
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRecord;
  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' });
  }

  // Verify current password first
  if (!verifyPassword(currentPassword, user.password_hash, user.salt)) {
    return res.status(401).json({
      error: 'INCORRECT_PASSWORD',
      message: 'Current password is incorrect. Please verify your password.',
    });
  }

  if (!question1 || !answer1 || !question2 || !answer2) {
    return res.status(400).json({
      error: 'MISSING_QUESTIONS',
      message: 'Two distinct security questions and answers are required.',
    });
  }

  if (question1.trim().toLowerCase() === question2.trim().toLowerCase()) {
    return res.status(400).json({
      error: 'DUPLICATE_QUESTIONS',
      message: 'Please choose two different security questions.',
    });
  }

  const salt1 = generateSalt();
  const hash1 = hashPassword(normalizeAnswer(answer1), salt1);

  const salt2 = generateSalt();
  const hash2 = hashPassword(normalizeAnswer(answer2), salt2);

  db.prepare(`
    UPDATE users SET
      security_question_1 = ?,
      security_answer_hash_1 = ?,
      security_answer_salt_1 = ?,
      security_question_2 = ?,
      security_answer_hash_2 = ?,
      security_answer_salt_2 = ?,
      recovery_email = COALESCE(?, recovery_email),
      recovery_phone = COALESCE(?, recovery_phone),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    question1.trim(),
    hash1,
    salt1,
    question2.trim(),
    hash2,
    salt2,
    recoveryEmail?.trim() || null,
    recoveryPhone?.trim() || null,
    userId
  );

  logAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'SECURITY_QUESTIONS_UPDATED',
    entity: 'USER_SECURITY',
    entityId: user.id,
    ipAddress: (req.ip || '127.0.0.1') as string,
  });

  return res.json({
    success: true,
    message: 'Your security recovery questions have been configured securely.',
  });
});

recoveryRouter.post('/security/generate-backup-codes', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { currentPassword } = req.body;

  if (!currentPassword) {
    return res.status(400).json({
      error: 'MISSING_PASSWORD',
      message: 'Current password is required to generate new emergency recovery backup codes.',
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRecord;
  if (!user || !verifyPassword(currentPassword, user.password_hash, user.salt)) {
    return res.status(401).json({
      error: 'INCORRECT_PASSWORD',
      message: 'Current password is incorrect.',
    });
  }

  // Invalidate any previously unused codes
  db.prepare(`DELETE FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL`).run(userId);

  // Generate 8 new single-use codes (e.g. BK-XXXX-XXXX)
  const plainCodes: string[] = [];
  db.exec('BEGIN TRANSACTION;');
  try {
    for (let i = 0; i < 8; i++) {
      const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const code = `BK-${part1}-${part2}`;
      plainCodes.push(code);

      const codeSalt = generateSalt();
      const codeHash = hashPassword(code, codeSalt);
      const storedVal = `${codeSalt}:${codeHash}`;
      const codeId = 'rc_' + crypto.randomUUID();

      db.prepare(`
        INSERT INTO user_recovery_codes (id, user_id, code_hash)
        VALUES (?, ?, ?)
      `).run(codeId, userId, storedVal);
    }
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    return res.status(500).json({ error: 'CODE_GEN_FAILED', message: 'Failed to generate backup codes.' });
  }

  logAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'BACKUP_CODES_GENERATED',
    entity: 'USER_SECURITY',
    entityId: user.id,
    ipAddress: (req.ip || '127.0.0.1') as string,
  });

  return res.json({
    success: true,
    codes: plainCodes,
    message: '8 single-use emergency backup recovery codes generated. Store them safely offline.',
  });
});

// ==============================================================================
// 8. PHASE 3 - METHOD 4: ADMINISTRATOR-ASSISTED RECOVERY FOR SCHOOL USERS
// ==============================================================================
recoveryRouter.post(
  '/school/users/:targetUserId/recovery-ticket',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_ADMIN', 'SCHOOL_OWNER']),
  (req: AuthenticatedRequest, res) => {
    const { targetUserId } = req.params;
    const adminUser = req.user!;
    const schoolId = req.activeSchoolId!;

    // Verify target user belongs to the same school tenant
    const targetUser = db.prepare(`
      SELECT u.id, u.email, u.full_name, u.is_platform_admin
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.id = ? AND ur.school_id = ? AND u.is_active = 1
    `).get(targetUserId, schoolId) as any;

    if (!targetUser) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'The requested staff member was not found in your school.',
      });
    }

    // Strict Tenant / Role Separation: School Admins CANNOT reset Platform SUPER_ADMIN accounts!
    if (targetUser.is_platform_admin === 1) {
      return res.status(403).json({
        error: 'UNAUTHORIZED_PRIVILEGE',
        message: 'School administrators cannot issue recovery tickets for Platform Super Admin accounts.',
      });
    }

    // Issue an admin-assisted 1-hour single-use recovery ticket
    const ticketToken = 'adm_' + crypto.randomBytes(24).toString('hex');
    const ticketId = 'pr_' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
      VALUES (?, ?, ?, ?, 'ADMIN_ASSISTED', ?, CURRENT_TIMESTAMP, ?)
    `).run(ticketId, targetUser.id, targetUser.email, ticketToken, expiresAt, (req.ip || '127.0.0.1') as string);

    logAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: 'ADMIN_ASSISTED_RECOVERY_ISSUED',
      entity: 'USER_CREDENTIALS',
      entityId: targetUser.id,
      ipAddress: (req.ip || '127.0.0.1') as string,
    });

    return res.json({
      success: true,
      targetEmail: targetUser.email,
      targetName: targetUser.full_name,
      recoveryTicket: ticketToken,
      expiresAt,
      message: `Administrator-assisted recovery ticket generated for ${targetUser.full_name}. Provide this ticket or link to the staff member to securely set their password.`,
    });
  }
);

// ==============================================================================
// 6. SELF-SERVICE CLAIM & RESTORATION FOR DISRUPTED / WIPED SCHOOL ACCOUNTS
// ==============================================================================
recoveryRouter.post('/recovery/claim-wiped-account', async (req, res) => {
  const {
    schoolName,
    email,
    phone,
    newPassword,
    ownerName,
    question1,
    answer1,
    question2,
    answer2,
  } = req.body;

  if (!email || !newPassword || newPassword.length < 8) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Official email and a new password (min 8 characters) are required.',
    });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanSchool = (schoolName || '').trim().toLowerCase();
  const cleanPhone = (phone || '').trim();

  try {
    const { getPgPool, isPgConnected, db: localDb } = await import('./db.ts');
    const { createSession } = await import('./auth.ts');
    const pool = getPgPool();
    if (!pool || !isPgConnected()) {
      return res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        message: 'Persistent database service is currently unavailable. Please try again shortly.',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Locate school by email OR name matching
      let schoolRow: any = null;
      const schoolByEmail = await client.query('SELECT * FROM schools WHERE LOWER(email) = $1', [cleanEmail]);
      if (schoolByEmail.rows.length > 0) {
        schoolRow = schoolByEmail.rows[0];
      } else if (cleanSchool) {
        const schoolByName = await client.query('SELECT * FROM schools WHERE LOWER(name) LIKE $1', [`%${cleanSchool}%`]);
        if (schoolByName.rows.length > 0) {
          schoolRow = schoolByName.rows[0];
        }
      }

      // If school still not found, check if a user with this email exists
      let userRow: any = null;
      const userRes = await client.query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanEmail]);
      if (userRes.rows.length > 0) {
        userRow = userRes.rows[0];
      }

      if (!schoolRow && !userRow) {
        // If neither exists, create/restore the school and user safely in PostgreSQL!
        const newSchoolId = 'sch_' + crypto.randomUUID().slice(0, 8);
        const newUserId = 'usr_' + crypto.randomUUID().slice(0, 8);
        const newSettingsId = 'set_' + crypto.randomUUID().slice(0, 8);
        const newRoleId = 'ur_' + crypto.randomUUID().slice(0, 8);
        const newSubId = 'sub_' + crypto.randomUUID().slice(0, 8);

        const salt = generateSalt();
        const pwdHash = hashPassword(newPassword, salt);
        const salt1 = generateSalt();
        const ansHash1 = answer1 ? hashPassword(normalizeAnswer(answer1), salt1) : null;
        const salt2 = generateSalt();
        const ansHash2 = answer2 ? hashPassword(normalizeAnswer(answer2), salt2) : null;
        const sName = schoolName || 'Winner International School';
        const sSlug = sName.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 32);
        const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        await client.query(
          `INSERT INTO schools (id, name, slug, type, status, address, state, lga, phone, email, current_plan_id)
           VALUES ($1, $2, $3, 'MIXED', 'TRIAL', 'Nigeria', 'Lagos', 'Ikeja', $4, $5, 'plan_trial')
           ON CONFLICT (id) DO NOTHING`,
          [newSchoolId, sName, sSlug, cleanPhone || '08000000000', cleanEmail]
        );
        await client.query(
          `INSERT INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, portal_subdomain)
           VALUES ($1, $2, 'NGN', '₦', '2024/2025', '1st Term', $3)
           ON CONFLICT (id) DO NOTHING`,
          [newSettingsId, newSchoolId, sSlug]
        );
        await client.query(
          `INSERT INTO users (
             id, email, password_hash, salt, full_name, phone,
             security_question_1, security_answer_hash_1, security_answer_salt_1,
             security_question_2, security_answer_hash_2, security_answer_salt_2,
             is_platform_admin, is_active
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 1)
           ON CONFLICT (id) DO NOTHING`,
          [
            newUserId, cleanEmail, pwdHash, salt, ownerName || `${sName} Proprietor`, cleanPhone || '08000000000',
            question1 || 'What primary school did you attend?', ansHash1, salt1,
            question2 || 'In what city or town were you born?', ansHash2, salt2,
          ]
        );
        await client.query(
          `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
           VALUES ($1, $2, $3, 'role_school_owner', 1)
           ON CONFLICT (id) DO NOTHING`,
          [newRoleId, newUserId, newSchoolId]
        );
        await client.query(
          `INSERT INTO school_subscriptions (id, school_id, plan_id, status, start_date, end_date, trial_end_date, amount_paid, notes)
           VALUES ($1, $2, 'plan_trial', 'TRIAL', CURRENT_DATE, $3, $4, 0, 'Self-service account restoration')
           ON CONFLICT (id) DO NOTHING`,
          [newSubId, newSchoolId, subEnd, subEnd]
        );

        await client.query('COMMIT');

        const token = createSession(newUserId, newSchoolId, req.ip, req.headers['user-agent']);
        return res.status(201).json({
          success: true,
          message: 'Account successfully registered and restored with your credentials!',
          token,
          user: { id: newUserId, email: cleanEmail, full_name: ownerName || `${sName} Proprietor` },
          school: { id: newSchoolId, name: sName },
        });
      }

      // If school and/or user already exists, update credentials and link them!
      const salt = generateSalt();
      const pwdHash = hashPassword(newPassword, salt);
      const effectiveSchoolId = schoolRow ? schoolRow.id : null;

      let targetUserId = userRow ? userRow.id : 'usr_' + crypto.randomUUID().slice(0, 8);
      if (userRow) {
        await client.query(
          `UPDATE users SET password_hash = $1, salt = $2, is_active = 1, full_name = COALESCE($3, full_name) WHERE id = $4`,
          [pwdHash, salt, ownerName || null, targetUserId]
        );
      } else {
        await client.query(
          `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 1)
           ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt`,
          [targetUserId, cleanEmail, pwdHash, salt, ownerName || `${schoolRow?.name || 'School'} Proprietor`, cleanPhone || schoolRow?.phone || '']
        );
      }

      if (effectiveSchoolId) {
        // Ensure user is tied to school with SCHOOL_OWNER role
        await client.query(
          `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
           VALUES ($1, $2, $3, 'role_school_owner', 1)
           ON CONFLICT (id) DO NOTHING`,
          ['ur_' + crypto.randomUUID().slice(0, 8), targetUserId, effectiveSchoolId]
        );

        // Ensure active trial subscription exists
        await client.query(
          `INSERT INTO school_subscriptions (id, school_id, plan_id, status, start_date, end_date, trial_end_date, amount_paid, notes)
           VALUES ($1, $2, 'plan_trial', 'TRIAL', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE + INTERVAL '30 days', 0, 'Restoration subscription link')
           ON CONFLICT (id) DO NOTHING`,
          ['sub_' + crypto.randomUUID().slice(0, 8), effectiveSchoolId]
        );
        await client.query(`UPDATE schools SET current_plan_id = 'plan_trial' WHERE id = $1`, [effectiveSchoolId]);
      }

      await client.query('COMMIT');

      // Sync into local SQLite
      try {
        localDb.prepare(`
          INSERT OR REPLACE INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 0, 1)
        `).run(targetUserId, cleanEmail, pwdHash, salt, ownerName || `${schoolRow?.name || 'School'} Proprietor`, cleanPhone || '');
      } catch (e) {}

      const token = createSession(targetUserId, effectiveSchoolId, req.ip, req.headers['user-agent']);
      return res.json({
        success: true,
        message: 'Account successfully reclaimed! You are now logged in with your new credentials.',
        token,
        user: { id: targetUserId, email: cleanEmail, full_name: ownerName || `${schoolRow?.name || 'School'} Proprietor` },
        school: schoolRow,
      });
    } catch (txErr: any) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('[Claim Wiped Account Error]', err);
    return res.status(500).json({
      error: 'CLAIM_FAILED',
      message: 'Failed to reclaim account: ' + err.message,
    });
  }
});
