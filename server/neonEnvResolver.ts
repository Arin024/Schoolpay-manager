import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fetchEnv, toEntries } from '@neon/env';
import neonConfig from '../neon.ts';

/**
 * Ensures DATABASE_URL and related Neon configuration are loaded into process.env
 * strictly from server-side environment variables, secure server-only .env.local file,
 * or dynamic resolution via @neon/env using NEON_API_KEY.
 *
 * CRITICAL SECURITY COMPLIANCE:
 * Zero credentials, passwords, or connection strings are embedded or hardcoded in source code.
 */
export async function ensureNeonEnvironment(): Promise<void> {
  // 1. If already configured in environment, proceed
  if (process.env.DATABASE_URL) {
    return;
  }

  // 1b. In non-production testing environments only, allow TEST_POSTGRES_URL
  if (process.env.NODE_ENV !== 'production' && process.env.TEST_POSTGRES_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
    return;
  }

  // 2. Load from secure server-only .env.local if present
  const envLocalPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
    if (process.env.DATABASE_URL) {
      return;
    }
  }

  // 3. Fallback: Dynamic resolution via @neon/env if NEON_API_KEY is available
  const neonJsonPath = path.resolve(process.cwd(), '.neon');
  if (fs.existsSync(neonJsonPath) && process.env.NEON_API_KEY) {
    try {
      const neonJson = JSON.parse(fs.readFileSync(neonJsonPath, 'utf8'));
      const envResult = await fetchEnv(neonConfig, {
        projectId: neonJson.projectId,
        branch: neonJson.branch,
        apiKey: process.env.NEON_API_KEY,
      });
      const entries = toEntries(envResult);
      for (const [k, v] of Object.entries(entries)) {
        if (!process.env[k]) {
          process.env[k] = v;
        }
      }
    } catch (err: any) {
      console.warn('[Neon Env Resolver] Dynamic resolution notice:', err.message);
    }
  }
}
