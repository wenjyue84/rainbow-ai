#!/usr/bin/env tsx
/**
 * US-314: Profile Keyword Contamination Auto-Fixer CLI
 *
 * Automatically removes Pelangi Capsule Hostel keyword contamination from
 * Makan Moments and Southern Homestay profile data files. Enforces profile
 * separation at data cleanup time with detailed before/after reporting.
 *
 * Usage:
 *   npm run profile:fix-contamination -- --profile makan --dry-run
 *   npm run profile:fix-contamination -- --profile makan --apply
 *   npm run profile:fix-contamination -- --profile southern --apply
 *   npx tsx src/cli/commands/profile-cleanup.ts --profile makan --dry-run
 *   npx tsx src/cli/commands/profile-cleanup.ts --profile makan --apply
 *
 * Flags:
 *   --profile <makan|southern>  Target profile to clean (required)
 *   --apply                     Actually write changes to disk
 *   --dry-run                   Preview changes without writing (default)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  type ProfileCleanupReport,
  runProfileCleanup,
  loadKeywordsFile,
  writeKeywordsFile,
  type KeywordsFile,
} from './profile-cleanup-logic.js';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { profile: string; apply: boolean; dryRun: boolean } {
  const profileIdx = argv.indexOf('--profile');
  const profile = profileIdx >= 0 && argv[profileIdx + 1] ? argv[profileIdx + 1] : '';
  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run') || !apply;

  return { profile, apply, dryRun };
}

// ---------------------------------------------------------------------------
// Human-readable report formatter
// ---------------------------------------------------------------------------

function formatHumanReport(report: ProfileCleanupReport, dryRun: boolean): string {
  const lines: string[] = [];
  const mode = dryRun ? 'DRY-RUN' : 'APPLIED';

  lines.push(`=== Profile Keyword Contamination Fix [${mode}] ===`);
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');

  lines.push(`Removed keywords: ${report.removed_keywords}`);
  lines.push(`Affected intents: ${report.affected_intents.length}`);
  if (report.affected_intents.length > 0) {
    for (const intent of report.affected_intents) {
      lines.push(`  - ${intent}`);
    }
  }
  lines.push('');

  if (report.details.length > 0) {
    lines.push('--- Removal Details ---');
    for (const detail of report.details) {
      lines.push(`  Intent: ${detail.intent}`);
      for (const kw of detail.removed_keywords) {
        lines.push(`    [${kw.language}] removed: "${kw.keyword}" (reason: ${kw.reason})`);
      }
    }
    lines.push('');
  }

  lines.push(`Success: ${report.success}`);
  if (dryRun) {
    lines.push('');
    lines.push('NOTE: This was a dry-run. Use --apply to write changes to disk.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.profile || !['makan', 'southern'].includes(args.profile)) {
    console.error('ERROR: --profile is required and must be "makan" or "southern"');
    console.error('Usage: npm run profile:fix-contamination -- --profile makan --apply');
    console.error('       npm run profile:fix-contamination -- --profile makan --dry-run');
    process.exit(1);
  }

  // Resolve paths
  const profileDirs: Record<string, string> = {
    pelangi: 'src/assistant/data',
    makan: 'src/assistant/data-makan',
    southern: 'src/assistant/data-southern',
  };

  const pelangiPath = path.join(rootDir, profileDirs.pelangi, 'intent-keywords.json');
  const targetPath = path.join(rootDir, profileDirs[args.profile], 'intent-keywords.json');

  if (!fs.existsSync(pelangiPath)) {
    console.error(`ERROR: Pelangi keywords file not found: ${pelangiPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(targetPath)) {
    console.error(`ERROR: Target profile keywords file not found: ${targetPath}`);
    process.exit(1);
  }

  // Load keyword files
  const pelangiData = loadKeywordsFile(pelangiPath);
  const targetData = loadKeywordsFile(targetPath);

  // Run cleanup
  const { report, cleaned } = runProfileCleanup(args.profile, pelangiData, targetData);

  // Write report
  const reportsDir = path.join(rootDir, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportPath = path.join(reportsDir, `contamination-fix-${args.profile}-${dateStr}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  // Write cleaned file if --apply
  if (args.apply && report.removed_keywords > 0) {
    writeKeywordsFile(targetPath, cleaned);
    console.log(`WRITTEN: ${targetPath}`);
  }

  // Print human-readable output
  console.log(formatHumanReport(report, args.dryRun));
  console.log(`\nReport saved: ${reportPath}`);

  process.exit(report.success ? 0 : 1);
}

main();
