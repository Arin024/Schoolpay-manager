/**
 * BURSARIQ - ACTIVE ROUTE DATABASE DELEGATE MANAGER
 *
 * Directs active Express HTTP route handlers to either:
 * - PostgreSQL (asynchronous, via pg.Pool / postgres*Service.ts)
 * - SQLite (legacy synchronous fallback during staging validation)
 *
 * STRICT PRINCIPLES:
 * 1. ZERO SILENT FALLBACKS: If a module is flagged for PostgreSQL and PG is offline,
 *    it raises an explicit HTTP 503 DATABASE_OFFLINE error.
 * 2. ZERO DUAL WRITES: Writes are executed against exactly one authoritative database.
 * 3. TRANSPARENCY: Routes announce which database handled the request via headers:
 *    - `X-BursarIQ-Database: PostgreSQL` or `SQLite`
 */

import { getPgPool, isPgConnected } from './db.ts';

export type MigratedModule =
  | 'AUTH'
  | 'SCHOOL_ADMIN'
  | 'FEES_INVOICING'
  | 'FINANCIAL'
  | 'PLATFORM_ADMIN';

export function isRouteUsingPostgres(moduleName: MigratedModule): boolean {
  const envFlag = process.env[`USE_PG_${moduleName}`];
  if (envFlag === 'false') return false;
  if (envFlag === 'true') return true;

  // By default, if TEST_POSTGRES_URL or DATABASE_URL is active and connected:
  return isPgConnected();
}

export function assertPostgresAvailable(res: any, moduleName: MigratedModule): boolean {
  if (!isPgConnected()) {
    res.status(503).json({
      success: false,
      error: 'DATABASE_OFFLINE',
      message: `The ${moduleName} module is configured for PostgreSQL, but the PostgreSQL database is currently unreachable.`,
      code: 'PG_UNAVAILABLE',
    });
    return false;
  }
  return true;
}
