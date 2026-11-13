/**
 * BURSARIQ - CLOUD SCHEDULER SECURE BACKUP ENDPOINT
 *
 * Dedicated endpoint for automated daily PostgreSQL disaster recovery snapshots:
 * - Route: POST /api/v1/system/backup
 * - Authentication: Authenticated invocation via verified Google Cloud OIDC ID token
 *   (when CLOUD_SCHEDULER_OIDC_AUDIENCE is configured) OR constant-time pre-shared secret
 *   (CLOUD_SCHEDULER_SECRET >= 16 chars). Never trusts raw unverified Bearer strings.
 * - Least-Privilege Authorization: Rejects public unauthenticated requests with 401 UNAUTHENTICATED.
 * - Idempotent & Non-Blocking: Executes consistent REPEATABLE READ snapshot and exports manifest.
 */

import express from 'express';
import { createPostgresBackup } from './postgresDisasterRecoveryService.ts';
import { getPgPool } from './db.ts';
import { timingSafeEqualStr, safeClientError, wrapRouterAsync } from './securityUtils.ts';

export const cloudSchedulerRouter = express.Router();
wrapRouterAsync(cloudSchedulerRouter);

async function verifyGoogleOidcToken(bearerToken: string, expectedAudience: string): Promise<boolean> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(bearerToken)}`);
    if (!res.ok) return false;
    const payload = (await res.json()) as Record<string, string>;
    if (payload.aud !== expectedAudience) return false;
    if (payload.email_verified !== 'true') return false;
    const allowedSa = process.env.CLOUD_SCHEDULER_SERVICE_ACCOUNT;
    if (allowedSa && payload.email !== allowedSa) return false;
    return true;
  } catch {
    return false;
  }
}

cloudSchedulerRouter.post('/system/backup', async (req, res) => {
  // 1. Authenticate Request (fail-closed)
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerSecret = typeof req.headers['x-scheduler-secret'] === 'string' ? req.headers['x-scheduler-secret'] : '';
  const schedulerSecret = process.env.CLOUD_SCHEDULER_SECRET;
  const oidcAudience = process.env.CLOUD_SCHEDULER_OIDC_AUDIENCE;

  let authenticated = false;

  if (schedulerSecret && schedulerSecret.length >= 16) {
    if (timingSafeEqualStr(headerSecret, schedulerSecret) || timingSafeEqualStr(bearerToken, schedulerSecret)) {
      authenticated = true;
    }
  }

  if (!authenticated && oidcAudience && bearerToken.split('.').length === 3) {
    authenticated = await verifyGoogleOidcToken(bearerToken, oidcAudience);
  }

  if (!authenticated) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHENTICATED',
      message: 'Access denied. Valid Google Cloud OIDC token or scheduler secret required.',
    });
  }

  try {
    let clientOverride: any = undefined;
    const testDbUrl = process.env.TEST_POSTGRES_URL;
    let poolToClose: any = null;

    if (!getPgPool() && testDbUrl) {
      const pg = await import('pg');
      poolToClose = new pg.default.Pool({
        connectionString: testDbUrl,
        ssl: testDbUrl.includes('localhost') ? false : { rejectUnauthorized: true },
        max: 2,
      });
      clientOverride = await poolToClose.connect();
    }

    const backupRes = await createPostgresBackup(clientOverride);
    if (!backupRes.success) {
      if (clientOverride) clientOverride.release();
      if (poolToClose) await poolToClose.end();
      return res.status(500).json({
        success: false,
        error: safeClientError({ message: backupRes.error }, 'Backup execution failed.'),
        code: 'BACKUP_FAILED',
      });
    }

    if (clientOverride) clientOverride.release();
    if (poolToClose) await poolToClose.end();
    return res.status(200).json({
      success: true,
      message: 'Automated PostgreSQL backup completed successfully.',
      backupId: backupRes.backupId,
      manifest: backupRes.manifest,
      uploadedToGcs: backupRes.uploadedToGcs,
      gcsDestination: backupRes.gcsDestination,
    });
  } catch (err: any) {
    console.error('[Cloud Scheduler Backup Error]', err?.message);
    return res.status(500).json({
      success: false,
      error: safeClientError(err, 'Backup exception occurred.'),
      code: 'BACKUP_EXCEPTION',
    });
  }
});
