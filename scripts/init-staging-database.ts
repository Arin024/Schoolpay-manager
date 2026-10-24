import dotenv from 'dotenv';
import path from 'node:path';

// Load .env.test.local if present, then fallback to .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.test.local') });
dotenv.config();

/**
 * BURSARIQ - CLI SCRIPT TO INITIALIZE STAGING DATABASE
 *
 * Usage:
 *   STAGING_INIT_CONFIRM="YES_INITIALIZE_STAGING" \
 *   TEST_POSTGRES_URL="postgresql://user:pass@ep-staging.neon.tech/bursariq_staging?sslmode=require" \
 *   npx tsx scripts/init-staging-database.ts
 */

import { initializeStagingDatabase } from '../server/stagingDatabaseInitializer.ts';

async function main() {
  const targetUrl = process.env.TEST_POSTGRES_URL;
  const token = process.env.STAGING_INIT_CONFIRM || '';
  const dryRun = process.env.DRY_RUN === 'true';

  if (!targetUrl) {
    console.error('\n[BLOCKED] TEST_POSTGRES_URL is not set.');
    console.error('To initialize a staging database, set:');
    console.error('  export TEST_POSTGRES_URL="postgresql://user:pass@staging-host/dbname?sslmode=require"');
    console.error('  export STAGING_INIT_CONFIRM="YES_INITIALIZE_STAGING"');
    console.error('  npx tsx scripts/init-staging-database.ts\n');
    process.exit(1);
  }

  console.log('===============================================================');
  console.log('   BURSARIQ: STAGING DATABASE INITIALIZATION & MIGRATIONS      ');
  console.log('===============================================================');
  console.log(`Dry Run Mode: ${dryRun}`);

  try {
    const report = await initializeStagingDatabase({
      targetPostgresUrl: targetUrl,
      confirmToken: token,
      dryRun,
    });

    console.log(`\n[Target Database] ${report.databaseName} (User: ${report.databaseUser})`);
    console.log(`Initial State: ${report.initialState}`);
    console.log(`Tables Before: ${report.existingTablesBefore.length}`);
    console.log(`Applied Migrations:`);
    if (report.appliedMigrations.length === 0) {
      console.log('  (None - Already fully migrated or dry-run)');
    } else {
      report.appliedMigrations.forEach((m) => console.log(`  - ${m}`));
    }
    console.log(`Tables After: ${report.existingTablesAfter.length}`);
    console.log(`Post-Migration Verification:`);
    console.log(`  - Invoices Table Exists: ${report.verification.invoicesTableExists}`);
    console.log(`  - Payments Table Exists: ${report.verification.paymentsTableExists}`);
    console.log(`  - Receipts Table Exists: ${report.verification.receiptsTableExists}`);
    console.log(`  - uq_payments_school_reference Constraint: ${report.verification.paymentReferenceUniqueConstraint}`);
    console.log(`Duration: ${report.durationMs}ms`);
    console.log('\n✓ Staging initialization completed successfully.');
  } catch (err: any) {
    console.error('\n[INITIALIZATION ERROR]', err.message);
    process.exit(1);
  }
}

main();
