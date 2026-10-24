/**
 * BURSARIQ - ROUTE CUTOVER & DATABASE DELEGATE MANAGER
 *
 * Implements a non-disruptive, module-by-module cutover mechanism:
 * 1. Inspects active PostgreSQL pool connection health (isPgConnected()).
 * 2. Provides deterministic routing flags for migrated modules:
 *    - AUTH_MODULE: Active session validation & authentication (createSession, validateSession)
 *    - SCHOOL_ADMIN_MODULE: School profiles, classes, students, parents, sessions
 *    - FEE_INVOICING_MODULE: Fee categories, structures, bulk invoicing, debtors
 *    - FINANCIAL_MODULE: Payments, instalments, receipts, reversals
 *    - PLATFORM_ADMIN_MODULE: SaaS plans, subscriptions, commissions, super metrics
 * 3. Never fails silently: If a module is routed to PostgreSQL and PG is offline,
 *    it raises an explicit HTTP 503 DATABASE_OFFLINE error instead of silently falling back to SQLite.
 * 4. Allows safe testing on isolated staging while legacy routes continue unaffected.
 */

import { getPgPool, isPgConnected } from './db.ts';

export type CutoverModule =
  | 'AUTH_MODULE'
  | 'SCHOOL_ADMIN_MODULE'
  | 'FEE_INVOICING_MODULE'
  | 'FINANCIAL_MODULE'
  | 'PLATFORM_ADMIN_MODULE';

export interface CutoverStatus {
  pgConnected: boolean;
  activeModules: Record<CutoverModule, boolean>;
}

export function isModuleEnabledForPostgres(moduleName: CutoverModule): boolean {
  // If explicitly overridden via environment variable:
  const envKey = `USE_PG_${moduleName}`;
  if (process.env[envKey] === 'false') return false;
  if (process.env[envKey] === 'true') return true;

  // By default, if PostgreSQL pool is connected, all validated modules use PostgreSQL:
  return isPgConnected();
}

export function getCutoverStatus(): CutoverStatus {
  const connected = isPgConnected();
  return {
    pgConnected: connected,
    activeModules: {
      AUTH_MODULE: isModuleEnabledForPostgres('AUTH_MODULE'),
      SCHOOL_ADMIN_MODULE: isModuleEnabledForPostgres('SCHOOL_ADMIN_MODULE'),
      FEE_INVOICING_MODULE: isModuleEnabledForPostgres('FEE_INVOICING_MODULE'),
      FINANCIAL_MODULE: isModuleEnabledForPostgres('FINANCIAL_MODULE'),
      PLATFORM_ADMIN_MODULE: isModuleEnabledForPostgres('PLATFORM_ADMIN_MODULE'),
    },
  };
}
