/**
 * CLI tool for profile configuration audit (US-592)
 *
 * Usage: npm run audit:profile-config
 *
 * Outputs JSON report with referential integrity checks:
 * - Missing intent references
 * - Orphaned workflow steps
 * - Unused workflows
 * - Unused intent definitions per profile
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  generateAuditReport,
  formatAuditReportAsJson,
} from '../lib/profile-config-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  try {
    const dataDir = join(__dirname, '..', 'assistant', 'data');

    console.log('[ProfileConfigAudit] Generating audit report...\n');

    const reports = generateAuditReport(dataDir);

    const jsonReport = formatAuditReportAsJson(reports);
    console.log(jsonReport);

    // Exit with error code if any issues found
    const hasIssues = reports.some(r => !r.isValid);
    if (hasIssues) {
      process.exit(1);
    }
  } catch (error) {
    console.error('[ProfileConfigAudit] Error:', (error as Error).message);
    process.exit(1);
  }
}

main();
