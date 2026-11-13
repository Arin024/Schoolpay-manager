import express from 'express';
import crypto from 'node:crypto';
import { db, cacheDb, queryPg } from './db.ts';
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
import { wrapRouterAsync } from './securityUtils.ts';

export const recoveryRouter = express.Router();
wrapRouterAsync(recoveryRouter);

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

// Bounded rate limiting map for recovery endpoints: IP -> timestamps
const recoveryRateLimit = new Map<string, number[]>();
const MAX_RATE_LIMIT_KEYS = 5000;

function checkRateLimit(ip: string, maxReqs = 15, windowMs = 60 * 1000): boolean {
  const now = Date.now();
  if (recoveryRateLimit.size > MAX_RATE_LIMIT_KEYS) {
    for (const [k, ts] of recoveryRateLimit.entries()) {
      const valid = ts.filter((t) => now - t < windowMs);
      if (valid.length === 0) recoveryRateLimit.delete(k);
      else recoveryRateLimit.set(k, valid);
    }
    if (recoveryRateLimit.size > MAX_RATE_LIMIT_KEYS) {
      recoveryRateLimit.clear();
    }
  }
  const history = recoveryRateLimit.get(ip) || [];
  const recent = history.filter((t) => now - t < windowMs);
  if (recent.length >= maxReqs) return false;
  recent.push(now);
  recoveryRateLimit.set(ip, recent);
  return true;
}

function getClientIp(req: express.Request): string {
  return (req.ip || req.socket?.remoteAddress || '127.0.0.1') as string;
}

// ==============================================================================
// 1. IDENTIFY ACCOUNT & DISCOVER AVAILABLE RECOVERY METHODS
// ==============================================================================
recoveryRouter.post('/recovery/identify', async (req, res) => {
  const clientIp = getClientIp(req);
  if (!checkRateLimit(`identify:${clientIp}`, 20)) {
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

  // Search user by email or phone number in Neon PG first
  let user: any = null;
  const pgUser = await queryPg(`
    SELECT id, email, phone, full_name, is_platform_admin, is_active,
           security_question_1, security_question_2,
           recovery_attempts, recovery_locked_until
    FROM users
    WHERE (LOWER(email) = $1 OR phone = $1 OR LOWER(recovery_email) = $1 OR recovery_phone = $1)
      AND is_active = 1
    LIMIT 1
  `, [clean]);

  if (pgUser && pgUser.rows.length > 0) {
    user = pgUser.rows[0];
  } else {
    // Check if identifier is an official school email (schools.email)
    const schoolOwnerPg = await queryPg(`
      SELECT u.id, u.email, u.phone, u.full_name, u.is_platform_admin, u.is_active,
             u.security_question_1, u.security_question_2,
             u.recovery_attempts, u.recovery_locked_until
      FROM schools s
      JOIN user_roles ur ON ur.school_id = s.id AND ur.role_id = 'role_school_owner'
      JOIN users u ON u.id = ur.user_id
      WHERE LOWER(s.email) = $1 AND u.is_active = 1
      LIMIT 1
    `, [clean]);
    if (schoolOwnerPg && schoolOwnerPg.rows.length > 0) {
      user = schoolOwnerPg.rows[0];
    }
  }

  // Fallback to cacheDb if Neon PG returned nothing
  if (!user) {
    user = cacheDb.prepare(`
      SELECT id, email, phone, full_name, is_platform_admin, is_active,
             security_question_1, security_question_2,
             recovery_attempts, recovery_locked_until
      FROM users
      WHERE (LOWER(email) = ? OR phone = ? OR LOWER(recovery_email) = ? OR recovery_phone = ?)
        AND is_active = 1
    `).get(clean, clean, clean, clean) as any;

    if (!user) {
      user = cacheDb.prepare(`
        SELECT u.id, u.email, u.phone, u.full_name, u.is_platform_admin, u.is_active,
               u.security_question_1, u.security_question_2,
               u.recovery_attempts, u.recovery_locked_until
        FROM schools s
        JOIN user_roles ur ON ur.school_id = s.id AND ur.role_id = 'role_school_owner'
        JOIN users u ON u.id = ur.user_id
        WHERE LOWER(s.email) = ? AND u.is_active = 1
        LIMIT 1
      `).get(clean) as any;
    }
  }

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
      await queryPg('UPDATE users SET recovery_attempts = 0, recovery_locked_until = NULL WHERE id = $1', [user.id]);
      try {
        cacheDb.prepare(`
          UPDATE users SET recovery_attempts = 0, recovery_locked_until = NULL WHERE id = ?
        `).run(user.id);
      } catch {}
    }
  }

  // Check unused backup codes
  let unusedCodesCount = 0;
  const bcPg = await queryPg('SELECT COUNT(*) as count FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL', [user.id]);
  if (bcPg) {
    unusedCodesCount = parseInt(bcPg.rows[0]?.count || '0', 10);
  } else {
    unusedCodesCount = (
      cacheDb.prepare(`SELECT COUNT(*) as count FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL`).get(user.id) as any
    )?.count || 0;
  }

  // Create stateful recovery challenge valid for 15 minutes
  const challengeId = 'rc_' + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await queryPg(`
    INSERT INTO recovery_challenges (id, user_id, identifier, expires_at)
    VALUES ($1, $2, $3, $4)
  `, [challengeId, user.id, user.email, expiresAt]);

  try {
    cacheDb.prepare(`
      INSERT INTO recovery_challenges (id, user_id, identifier, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(challengeId, user.id, user.email, expiresAt);
  } catch {}

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
    questions: hasSecurityQuestions
      ? [user.security_question_1, user.security_question_2]
      : null,
    message: 'Account identified. Please select your preferred recovery verification method.',
  });
});

// ==============================================================================
// 2. SECURITY-QUESTION-ASSISTED VERIFICATION (Neon PG + cacheDb synced)
// ==============================================================================
recoveryRouter.post('/recovery/verify-questions', async (req, res) => {
  const clientIp = getClientIp(req);
  if (!checkRateLimit(`questions:${clientIp}`, 15)) {
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many verification attempts. Please wait a moment and try again.',
    });
  }

  const { challengeId, answer1, answer2 } = req.body;

  if (!challengeId || !answer1 || !answer2) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Both security answers are required to verify your identity.',
    });
  }

  let challenge: any = null;
  const pgChallenge = await queryPg(`
    SELECT * FROM recovery_challenges
    WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP AND verified_at IS NULL
  `, [challengeId]);
  if (pgChallenge && pgChallenge.rows.length > 0) {
    challenge = pgChallenge.rows[0];
  } else {
    challenge = db.prepare(`
      SELECT * FROM recovery_challenges
      WHERE id = ? AND expires_at > datetime('now') AND verified_at IS NULL
    `).get(challengeId) as any;
  }

  if (!challenge) {
    return res.status(400).json({
      error: 'INVALID_CHALLENGE',
      message: 'This recovery session has expired or is invalid. Please start over.',
    });
  }

  let user: any = null;
  const pgUser = await queryPg(`
    SELECT id, email, is_platform_admin,
           security_question_1, security_answer_hash_1, security_answer_salt_1,
           security_question_2, security_answer_hash_2, security_answer_salt_2,
           recovery_attempts, recovery_locked_until
    FROM users WHERE id = $1
  `, [challenge.user_id]);
  if (pgUser && pgUser.rows.length > 0) {
    user = pgUser.rows[0];
  } else {
    user = db.prepare(`
      SELECT id, email, is_platform_admin,
             security_question_1, security_answer_hash_1, security_answer_salt_1,
             security_question_2, security_answer_hash_2, security_answer_salt_2,
             recovery_attempts, recovery_locked_until
      FROM users WHERE id = ?
    `).get(challenge.user_id) as any;
  }

  if (!user || user.is_platform_admin === 1) {
    return res.status(403).json({
      error: 'UNAUTHORIZED_METHOD',
      message: 'Security questions are not available for this account type. Please use verified email recovery.',
    });
  }

  if (user.recovery_locked_until) {
    const lockExpiry = new Date(user.recovery_locked_until).getTime();
    if (Date.now() < lockExpiry) {
      const minutesLeft = Math.ceil((lockExpiry - Date.now()) / (60 * 1000));
      return res.status(429).json({
        error: 'ACCOUNT_LOCKED',
        message: `Account recovery is temporarily locked. Try again in ${minutesLeft} minute(s).`,
      });
    }
  }

  if (!user.security_answer_hash_1 || !user.security_answer_hash_2) {
    return res.status(400).json({
      error: 'QUESTIONS_NOT_CONFIGURED',
      message: 'Security questions have not been configured for this account. Please use verified email or administrator assistance.',
    });
  }

  const norm1 = normalizeAnswer(answer1);
  const norm2 = normalizeAnswer(answer2);

  const match1 = verifyPassword(norm1, user.security_answer_hash_1, user.security_answer_salt_1);
  const match2 = verifyPassword(norm2, user.security_answer_hash_2, user.security_answer_salt_2);

  if (!match1 || !match2) {
    const newAttempts = (user.recovery_attempts || 0) + 1;
    let lockUntil: string | null = null;
    let remaining = 3 - newAttempts;

    if (newAttempts >= 3) {
      lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      remaining = 0;
    }

    await queryPg(`
      UPDATE users SET recovery_attempts = $1, recovery_locked_until = $2 WHERE id = $3
    `, [newAttempts, lockUntil, user.id]);
    try {
      db.prepare(`
        UPDATE users SET recovery_attempts = ?, recovery_locked_until = ? WHERE id = ?
      `).run(newAttempts, lockUntil, user.id);
    } catch {}

    logAudit({
      actorEmail: user.email,
      action: 'SECURITY_QUESTIONS_FAILED',
      entity: 'USER_RECOVERY',
      entityId: user.id,
      ipAddress: clientIp,
    });

    if (remaining <= 0) {
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

  // Success: Reset attempt counters and mark challenge verified
  await queryPg(`UPDATE users SET recovery_attempts = 0, recovery_locked_until = NULL WHERE id = $1`, [user.id]);
  await queryPg(`UPDATE recovery_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = $1`, [challengeId]);
  try {
    db.prepare(`UPDATE users SET recovery_attempts = 0, recovery_locked_until = NULL WHERE id = ?`).run(user.id);
    db.prepare(`UPDATE recovery_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = ?`).run(challengeId);
  } catch {}

  const recoveryTicket = 'rck_' + crypto.randomBytes(24).toString('hex');
  const ticketId = 'pr_' + crypto.randomUUID();
  const ticketExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await queryPg(`
    INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
    VALUES ($1, $2, $3, $4, 'SECURITY_QUESTIONS', $5, CURRENT_TIMESTAMP, $6)
  `, [ticketId, user.id, user.email, recoveryTicket, ticketExpiresAt, clientIp]);
  try {
    db.prepare(`
      INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
      VALUES (?, ?, ?, ?, 'SECURITY_QUESTIONS', ?, CURRENT_TIMESTAMP, ?)
    `).run(ticketId, user.id, user.email, recoveryTicket, ticketExpiresAt, clientIp);
  } catch {}

  logAudit({
    actorEmail: user.email,
    action: 'SECURITY_QUESTIONS_VERIFIED',
    entity: 'USER_RECOVERY',
    entityId: user.id,
    ipAddress: clientIp,
  });

  return res.json({
    success: true,
    recoveryTicket,
    message: 'Identity verified successfully! You may now set your new password.',
  });
});

// ==============================================================================
// 3. ONE-TIME EMERGENCY BACKUP CODE VERIFICATION (Neon PG + cacheDb synced)
// ==============================================================================
recoveryRouter.post('/recovery/verify-code', async (req, res) => {
  const clientIp = getClientIp(req);
  if (!checkRateLimit(`backupcode:${clientIp}`, 15)) {
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many verification attempts. Please wait a moment and try again.',
    });
  }

  const { challengeId, code } = req.body;

  if (!challengeId || !code) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Both challenge session and recovery code are required.',
    });
  }

  let challenge: any = null;
  const pgChallenge = await queryPg(`
    SELECT * FROM recovery_challenges
    WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP AND verified_at IS NULL
  `, [challengeId]);
  if (pgChallenge && pgChallenge.rows.length > 0) {
    challenge = pgChallenge.rows[0];
  } else {
    challenge = db.prepare(`
      SELECT * FROM recovery_challenges
      WHERE id = ? AND expires_at > datetime('now') AND verified_at IS NULL
    `).get(challengeId) as any;
  }

  if (!challenge) {
    return res.status(400).json({
      error: 'INVALID_CHALLENGE',
      message: 'Recovery session has expired or is invalid. Please start over.',
    });
  }

  let user: any = null;
  const pgUser = await queryPg(`
    SELECT id, email, salt, is_platform_admin, recovery_attempts, recovery_locked_until
    FROM users WHERE id = $1
  `, [challenge.user_id]);
  if (pgUser && pgUser.rows.length > 0) {
    user = pgUser.rows[0];
  } else {
    user = db.prepare(`
      SELECT id, email, salt, is_platform_admin, recovery_attempts, recovery_locked_until
      FROM users WHERE id = ?
    `).get(challenge.user_id) as any;
  }

  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User account not found' });
  }

  if (user.is_platform_admin === 1) {
    return res.status(403).json({
      error: 'UNAUTHORIZED_METHOD',
      message: 'Backup recovery codes are not permitted for Platform Super Admin accounts.',
    });
  }

  if (user.recovery_locked_until) {
    const lockExpiry = new Date(user.recovery_locked_until).getTime();
    if (Date.now() < lockExpiry) {
      const minutesLeft = Math.ceil((lockExpiry - Date.now()) / (60 * 1000));
      return res.status(429).json({
        error: 'ACCOUNT_LOCKED',
        message: `Account recovery is temporarily locked. Try again in ${minutesLeft} minute(s).`,
      });
    }
  }

  const cleanCode = (code || '').trim().toUpperCase();

  let backupCodes: any[] = [];
  const pgCodes = await queryPg(`
    SELECT id, code_hash FROM user_recovery_codes
    WHERE user_id = $1 AND used_at IS NULL
  `, [user.id]);
  if (pgCodes) {
    backupCodes = pgCodes.rows;
  } else {
    backupCodes = db.prepare(`
      SELECT id, code_hash FROM user_recovery_codes
      WHERE user_id = ? AND used_at IS NULL
    `).all(user.id) as any[];
  }

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
    const newAttempts = (user.recovery_attempts || 0) + 1;
    let lockUntil: string | null = null;
    if (newAttempts >= 3) {
      lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    }
    await queryPg(`UPDATE users SET recovery_attempts = $1, recovery_locked_until = $2 WHERE id = $3`, [newAttempts, lockUntil, user.id]);
    try {
      db.prepare(`UPDATE users SET recovery_attempts = ?, recovery_locked_until = ? WHERE id = ?`).run(newAttempts, lockUntil, user.id);
    } catch {}

    logAudit({
      actorEmail: user.email,
      action: 'RECOVERY_CODE_FAILED',
      entity: 'USER_RECOVERY',
      entityId: user.id,
      ipAddress: clientIp,
    });

    if (newAttempts >= 3) {
      return res.status(429).json({
        error: 'ACCOUNT_LOCKED',
        message: 'Too many invalid recovery code attempts. Account recovery has been locked for 15 minutes.',
      });
    }

    return res.status(400).json({
      error: 'INVALID_CODE',
      message: 'The recovery code entered is invalid or has already been used.',
    });
  }

  // Single-use enforcement: Permanently mark code as used + reset attempts + verify challenge
  await queryPg(`UPDATE user_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1`, [matchedCodeId]);
  await queryPg(`UPDATE recovery_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = $1`, [challengeId]);
  await queryPg(`UPDATE users SET recovery_attempts = 0, recovery_locked_until = NULL WHERE id = $1`, [user.id]);
  try {
    db.prepare(`UPDATE user_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(matchedCodeId);
    db.prepare(`UPDATE recovery_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = ?`).run(challengeId);
    db.prepare(`UPDATE users SET recovery_attempts = 0, recovery_locked_until = NULL WHERE id = ?`).run(user.id);
  } catch {}

  const recoveryTicket = 'rck_' + crypto.randomBytes(24).toString('hex');
  const ticketId = 'pr_' + crypto.randomUUID();
  const ticketExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await queryPg(`
    INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
    VALUES ($1, $2, $3, $4, 'BACKUP_CODE', $5, CURRENT_TIMESTAMP, $6)
  `, [ticketId, user.id, user.email, recoveryTicket, ticketExpiresAt, clientIp]);
  try {
    db.prepare(`
      INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
      VALUES (?, ?, ?, ?, 'BACKUP_CODE', ?, CURRENT_TIMESTAMP, ?)
    `).run(ticketId, user.id, user.email, recoveryTicket, ticketExpiresAt, clientIp);
  } catch {}

  logAudit({
    actorEmail: user.email,
    action: 'RECOVERY_CODE_VERIFIED',
    entity: 'USER_RECOVERY',
    entityId: user.id,
    ipAddress: clientIp,
  });

  return res.json({
    success: true,
    recoveryTicket,
    message: 'Backup recovery code verified successfully! You may now set your new password.',
  });
});

// ==============================================================================
// 4. VERIFIED EMAIL RECOVERY LINK REQUEST (NEVER exposes token in API response)
// ==============================================================================
recoveryRouter.post('/recovery/request-link', async (req, res) => {
  const clientIp = getClientIp(req);
  if (!checkRateLimit(`reqlink:${clientIp}`, 10)) {
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many recovery link requests. Please wait a moment and try again.',
    });
  }

  const { challengeId } = req.body;
  if (!challengeId) {
    return res.status(400).json({
      error: 'MISSING_CHALLENGE',
      message: 'Recovery challenge session ID is required.',
    });
  }

  let challenge: any = null;
  const pgChallenge = await queryPg(`
    SELECT * FROM recovery_challenges
    WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP
  `, [challengeId]);
  if (pgChallenge && pgChallenge.rows.length > 0) {
    challenge = pgChallenge.rows[0];
  } else {
    challenge = db.prepare(`
      SELECT * FROM recovery_challenges
      WHERE id = ? AND expires_at > datetime('now')
    `).get(challengeId) as any;
  }

  const genericMessage =
    'Outbound email relay is not configured on this server. Please use Security Questions, a Single-Use Backup Code, or request an Administrator-Assisted Recovery Ticket from your school administrator.';

  // Anti-enumeration: even if dummy challengeId is passed, return the exact same safe response
  if (!challenge) {
    return res.json({
      success: true,
      emailDelivered: false,
      message: genericMessage,
    });
  }

  let user: any = null;
  const pgUser = await queryPg('SELECT id, email FROM users WHERE id = $1', [challenge.user_id]);
  if (pgUser && pgUser.rows.length > 0) {
    user = pgUser.rows[0];
  } else {
    user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(challenge.user_id) as any;
  }

  if (!user) {
    return res.json({
      success: true,
      emailDelivered: false,
      message: genericMessage,
    });
  }

  // Only generate & store an email reset token if an outbound email provider is configured
  const hasEmailRelay = Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
  if (hasEmailRelay) {
    const resetToken = 'rst_' + crypto.randomBytes(24).toString('hex');
    const resetId = 'pr_' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await queryPg(`
      INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
      VALUES ($1, $2, $3, $4, 'EMAIL_LINK', $5, CURRENT_TIMESTAMP, $6)
    `, [resetId, user.id, user.email, resetToken, expiresAt, clientIp]);

    try {
      cacheDb.prepare(`
        INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
        VALUES (?, ?, ?, ?, 'EMAIL_LINK', ?, CURRENT_TIMESTAMP, ?)
      `).run(resetId, user.id, user.email, resetToken, expiresAt, clientIp);
    } catch {}
  }

  logAudit({
    actorEmail: user.email,
    action: 'PASSWORD_RESET_LINK_REQUESTED',
    entity: 'USER_CREDENTIALS',
    entityId: user.id,
    ipAddress: clientIp,
  });

  // CRITICAL SECURITY: NEVER return resetToken / recoveryTicket in the HTTP response body!
  return res.json({
    success: true,
    emailDelivered: hasEmailRelay,
    message: hasEmailRelay
      ? `If an account exists for ${maskEmail(user.email)}, a password reset link has been sent to that inbox.`
      : genericMessage,
  });
});

// ==============================================================================
// 5. COMPLETE PASSWORD RESET WITH STRICT SERVER VALIDATION
// ==============================================================================
recoveryRouter.post('/recovery/complete', async (req, res) => {
  const clientIp = getClientIp(req);
  if (!checkRateLimit(`complete:${clientIp}`, 15)) {
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many password reset attempts. Please wait a moment and try again.',
    });
  }

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

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({
      error: 'WEAK_PASSWORD',
      message: 'Password must be at least 8 characters long.',
    });
  }

  let resetRecord: any = null;
  const pgReset = await queryPg(`
    SELECT * FROM password_resets
    WHERE token = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
  `, [recoveryTicket]);

  if (pgReset && pgReset.rows.length > 0) {
    resetRecord = pgReset.rows[0];
  } else {
    resetRecord = cacheDb.prepare(`
      SELECT * FROM password_resets
      WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
    `).get(recoveryTicket) as any;
  }

  if (!resetRecord) {
    return res.status(400).json({
      error: 'INVALID_OR_EXPIRED_TICKET',
      message: 'This recovery verification session is invalid or has expired. Please request a new recovery verification.',
    });
  }

  let user: any = null;
  const pgUser = await queryPg('SELECT id, email FROM users WHERE email = $1', [resetRecord.email]);
  if (pgUser && pgUser.rows.length > 0) {
    user = pgUser.rows[0];
  } else {
    user = cacheDb.prepare('SELECT id, email FROM users WHERE email = ?').get(resetRecord.email) as any;
  }

  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Target user account not found.' });
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(newPassword, salt);

  // 1. Authoritative Neon PostgreSQL Update
  await queryPg(`
    UPDATE users SET
      password_hash = $1,
      salt = $2,
      recovery_attempts = 0,
      recovery_locked_until = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
  `, [passwordHash, salt, user.id]);

  await queryPg(`UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = $1`, [resetRecord.id]);
  await queryPg(`DELETE FROM sessions WHERE user_id = $1`, [user.id]);

  // 2. Local cacheDb Update
  try {
    cacheDb.prepare(`
      UPDATE users SET
        password_hash = ?,
        salt = ?,
        recovery_attempts = 0,
        recovery_locked_until = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(passwordHash, salt, user.id);

    cacheDb.prepare(`UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(resetRecord.id);
    cacheDb.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
  } catch {}

  logAudit({
    actorEmail: user.email,
    action: 'PASSWORD_RESET_COMPLETED',
    entity: 'USER_CREDENTIALS',
    entityId: user.id,
    ipAddress: clientIp,
  });

  return res.json({
    success: true,
    message: 'Your password has been reset successfully. Please sign in with your new password.',
  });
});

// ==============================================================================
// 6. FORGOTTEN EMAIL OR PHONE IDENTIFIER LOOKUP (MASKED DISPLAY)
// ==============================================================================
recoveryRouter.post('/recovery/lookup-identifier', async (req, res) => {
  const clientIp = getClientIp(req);
  if (!checkRateLimit(`lookup:${clientIp}`, 10)) {
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

  if (phone && typeof phone === 'string') {
    const cleanPhone = phone.trim();
    const pgMatch = await queryPg(`
      SELECT id, email, phone, full_name, is_platform_admin FROM users
      WHERE (phone = $1 OR recovery_phone = $1) AND is_active = 1
      LIMIT 1
    `, [cleanPhone]);
    if (pgMatch && pgMatch.rows.length > 0) {
      matchedUser = pgMatch.rows[0];
    } else {
      matchedUser = db.prepare(`
        SELECT id, email, phone, full_name, is_platform_admin FROM users
        WHERE (phone = ? OR recovery_phone = ?) AND is_active = 1
      `).get(cleanPhone, cleanPhone);
    }
  } else if (fullName && schoolName && typeof fullName === 'string' && typeof schoolName === 'string') {
    const cleanName = fullName.trim().toLowerCase();
    const cleanSchool = schoolName.trim().toLowerCase();

    const pgMatch = await queryPg(`
      SELECT u.id, u.email, u.phone, u.full_name, u.is_platform_admin
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN schools s ON s.id = ur.school_id
      WHERE LOWER(u.full_name) LIKE $1 AND LOWER(s.name) LIKE $2 AND u.is_active = 1
      LIMIT 1
    `, [`%${cleanName}%`, `%${cleanSchool}%`]);
    if (pgMatch && pgMatch.rows.length > 0) {
      matchedUser = pgMatch.rows[0];
    } else {
      matchedUser = db.prepare(`
        SELECT u.id, u.email, u.phone, u.full_name, u.is_platform_admin
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN schools s ON s.id = ur.school_id
        WHERE LOWER(u.full_name) LIKE ? AND LOWER(s.name) LIKE ? AND u.is_active = 1
        LIMIT 1
      `).get(`%${cleanName}%`, `%${cleanSchool}%`);
    }
  }

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
// 7. AUTHENTICATED USER SECURITY SETTINGS (Neon PG + cacheDb synced)
// ==============================================================================
recoveryRouter.get('/security/status', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  let user: any = null;
  const pgUser = await queryPg(`
    SELECT security_question_1, security_question_2, recovery_email, recovery_phone, is_platform_admin
    FROM users WHERE id = $1
  `, [userId]);
  if (pgUser && pgUser.rows.length > 0) {
    user = pgUser.rows[0];
  } else {
    user = db.prepare(`
      SELECT security_question_1, security_question_2, recovery_email, recovery_phone, is_platform_admin
      FROM users WHERE id = ?
    `).get(userId) as any;
  }

  let unusedCodesCount = 0;
  const pgCodes = await queryPg(`SELECT COUNT(*) as count FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  if (pgCodes) {
    unusedCodesCount = parseInt(pgCodes.rows[0]?.count || '0', 10);
  } else {
    unusedCodesCount = (
      db.prepare(`SELECT COUNT(*) as count FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL`).get(userId) as any
    )?.count || 0;
  }

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

recoveryRouter.post('/security/configure-questions', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { currentPassword, question1, answer1, question2, answer2, recoveryEmail, recoveryPhone } = req.body;

  if (!currentPassword) {
    return res.status(400).json({
      error: 'MISSING_PASSWORD',
      message: 'Current account password is required to update security recovery questions.',
    });
  }

  let user: UserRecord | null = null;
  const pgUser = await queryPg('SELECT * FROM users WHERE id = $1', [userId]);
  if (pgUser && pgUser.rows.length > 0) {
    user = pgUser.rows[0] as unknown as UserRecord;
  } else {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRecord;
  }

  if (!user) {
    return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' });
  }

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

  const q1 = question1.trim();
  const q2 = question2.trim();
  const rEmail = recoveryEmail?.trim() || null;
  const rPhone = recoveryPhone?.trim() || null;

  await queryPg(`
    UPDATE users SET
      security_question_1 = $1,
      security_answer_hash_1 = $2,
      security_answer_salt_1 = $3,
      security_question_2 = $4,
      security_answer_hash_2 = $5,
      security_answer_salt_2 = $6,
      recovery_email = COALESCE($7, recovery_email),
      recovery_phone = COALESCE($8, recovery_phone),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $9
  `, [q1, hash1, salt1, q2, hash2, salt2, rEmail, rPhone, userId]);

  try {
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
    `).run(q1, hash1, salt1, q2, hash2, salt2, rEmail, rPhone, userId);
  } catch {}

  logAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'SECURITY_QUESTIONS_UPDATED',
    entity: 'USER_SECURITY',
    entityId: user.id,
    ipAddress: getClientIp(req),
  });

  return res.json({
    success: true,
    message: 'Your security recovery questions have been configured securely.',
  });
});

recoveryRouter.post('/security/generate-backup-codes', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { currentPassword } = req.body;

  if (!currentPassword) {
    return res.status(400).json({
      error: 'MISSING_PASSWORD',
      message: 'Current password is required to generate new emergency recovery backup codes.',
    });
  }

  let user: UserRecord | null = null;
  const pgUser = await queryPg('SELECT * FROM users WHERE id = $1', [userId]);
  if (pgUser && pgUser.rows.length > 0) {
    user = pgUser.rows[0] as unknown as UserRecord;
  } else {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRecord;
  }

  if (!user || !verifyPassword(currentPassword, user.password_hash, user.salt)) {
    return res.status(401).json({
      error: 'INCORRECT_PASSWORD',
      message: 'Current password is incorrect.',
    });
  }

  await queryPg(`DELETE FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  try {
    db.prepare(`DELETE FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL`).run(userId);
  } catch {}

  const plainCodes: string[] = [];
  const generatedEntries: Array<{ id: string; storedVal: string }> = [];

  for (let i = 0; i < 8; i++) {
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `BK-${part1}-${part2}`;
    plainCodes.push(code);

    const codeSalt = generateSalt();
    const codeHash = hashPassword(code, codeSalt);
    generatedEntries.push({
      id: 'rc_' + crypto.randomUUID(),
      storedVal: `${codeSalt}:${codeHash}`,
    });
  }

  for (const entry of generatedEntries) {
    await queryPg(`
      INSERT INTO user_recovery_codes (id, user_id, code_hash)
      VALUES ($1, $2, $3)
    `, [entry.id, userId, entry.storedVal]);
  }

  try {
    db.exec('BEGIN TRANSACTION;');
    for (const entry of generatedEntries) {
      db.prepare(`
        INSERT INTO user_recovery_codes (id, user_id, code_hash)
        VALUES (?, ?, ?)
      `).run(entry.id, userId, entry.storedVal);
    }
    db.exec('COMMIT;');
  } catch {
    try {
      db.exec('ROLLBACK;');
    } catch {}
  }

  logAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'BACKUP_CODES_GENERATED',
    entity: 'USER_SECURITY',
    entityId: user.id,
    ipAddress: getClientIp(req),
  });

  return res.json({
    success: true,
    codes: plainCodes,
    message: '8 single-use emergency backup recovery codes generated. Store them safely offline.',
  });
});

// ==============================================================================
// 8. ADMINISTRATOR-ASSISTED RECOVERY FOR SCHOOL USERS
// ==============================================================================
recoveryRouter.post(
  '/school/users/:targetUserId/recovery-ticket',
  requireAuth,
  requireTenant,
  requireRole(['SCHOOL_ADMIN', 'SCHOOL_OWNER']),
  async (req: AuthenticatedRequest, res) => {
    const { targetUserId } = req.params;
    const adminUser = req.user!;
    const schoolId = req.targetSchoolId || req.activeSchoolId!;

    let targetUser: any = null;
    const pgTarget = await queryPg(`
      SELECT u.id, u.email, u.full_name, u.is_platform_admin
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.id = $1 AND ur.school_id = $2 AND u.is_active = 1
    `, [targetUserId, schoolId]);
    if (pgTarget && pgTarget.rows.length > 0) {
      targetUser = pgTarget.rows[0];
    } else {
      targetUser = db.prepare(`
        SELECT u.id, u.email, u.full_name, u.is_platform_admin
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.id = ? AND ur.school_id = ? AND u.is_active = 1
      `).get(targetUserId, schoolId) as any;
    }

    if (!targetUser) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'The requested staff member was not found in your school.',
      });
    }

    if (targetUser.is_platform_admin === 1) {
      return res.status(403).json({
        error: 'UNAUTHORIZED_PRIVILEGE',
        message: 'School administrators cannot issue recovery tickets for Platform Super Admin accounts.',
      });
    }

    const ticketToken = 'adm_' + crypto.randomBytes(24).toString('hex');
    const ticketId = 'pr_' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const clientIp = getClientIp(req);

    await queryPg(`
      INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
      VALUES ($1, $2, $3, $4, 'ADMIN_ASSISTED', $5, CURRENT_TIMESTAMP, $6)
    `, [ticketId, targetUser.id, targetUser.email, ticketToken, expiresAt, clientIp]);

    try {
      db.prepare(`
        INSERT INTO password_resets (id, user_id, email, token, recovery_method, expires_at, verified_at, ip_address)
        VALUES (?, ?, ?, ?, 'ADMIN_ASSISTED', ?, CURRENT_TIMESTAMP, ?)
      `).run(ticketId, targetUser.id, targetUser.email, ticketToken, expiresAt, clientIp);
    } catch {}

    logAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      schoolId,
      action: 'ADMIN_ASSISTED_RECOVERY_ISSUED',
      entity: 'USER_CREDENTIALS',
      entityId: targetUser.id,
      ipAddress: clientIp,
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
// 9. DISABLED UNAUTHENTICATED ACCOUNT RECLAIM ENDPOINT (Security Hardening)
// ==============================================================================
recoveryRouter.post('/recovery/claim-wiped-account', (req, res) => {
  logAudit({
    actorEmail: typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'unknown',
    action: 'BLOCKED_ACCOUNT_RECLAIM_ATTEMPT',
    entity: 'USER_CREDENTIALS',
    ipAddress: getClientIp(req),
  });
  return res.status(403).json({
    error: 'ACCOUNT_RECLAIM_DISABLED',
    message:
      'Unauthenticated account reclamation is disabled for security. Please use verified Security Questions, an Emergency Backup Code, an Administrator-Assisted Recovery Ticket, or contact Platform Support.',
  });
});
