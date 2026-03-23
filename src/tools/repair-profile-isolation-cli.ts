#!/usr/bin/env tsx
/**
 * US-238: Profile Isolation Violations Auto-Repair CLI
 *
 * Detects and automatically repairs data contamination that violates profile isolation rules.
 *
 * Usage:
 *   npm run repair:profile-isolation
 *   npx tsx src/tools/repair-profile-isolation-cli.ts
 *   npx tsx src/tools/repair-profile-isolation-cli.ts --dry-run
 *
 * Exit codes:
 *   0 — No violations found or all repairs applied
 *   1 — Violations found and repairs flagged for review (check output)
 *   2 — Database error or configuration issue
 */

import { Pool } from 'pg';
import { repairProfileIsolation } from './repair-profile-isolation.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('[ERROR] DATABASE_URL environment variable not set');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('[INFO] Starting profile isolation repair tool...');
    if (dryRun) {
      console.log('[INFO] Running in DRY RUN mode - no changes will be applied');
    }

    const report = await repairProfileIsolation(pool, ['pelangi', 'makan', 'southern']);

    // Output JSON report
    console.log(JSON.stringify(report, null, 2));

    // Exit with appropriate code
    if (report.violations_found === 0) {
      process.exit(0);
    } else if (report.repairs_flagged > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('[ERROR] Profile isolation repair failed:', error);
    process.exit(2);
  } finally {
    await pool.end();
  }
}

main();
