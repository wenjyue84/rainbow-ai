#!/usr/bin/env tsx
/**
 * US-653: Knowledge Base Schema Validator CLI
 *
 * Scans all .md files in KB profile directories and generates a JSON report
 * identifying cross-profile content contamination.
 *
 * Usage (via npm run cli dispatcher):
 *   npm run cli -- validate-kb-schema
 *   npm run cli -- validate-kb-schema --profile makan
 *   npm run cli -- validate-kb-schema --profile makan --report report.json
 *   npm run cli -- validate-kb-schema --report all-profiles-report.json
 *
 * Direct usage:
 *   npx tsx src/cli/validate-kb-schema.ts --profile southern --report out.json
 *
 * Flags:
 *   --profile <pelangi|makan|southern>  Scan only this profile (default: all)
 *   --report <path>                     Write JSON report to file (default: stdout)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  type ProfileType,
  detectContamination,
  buildSummary,
  type ValidationReport,
} from '../lib/kb-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Profile directory mapping
// ---------------------------------------------------------------------------

const PROFILE_DIRS: Record<ProfileType, string> = {
  pelangi: path.join(PROJECT_ROOT, '.rainbow-kb'),
  makan: path.join(PROJECT_ROOT, '.rainbow-kb-makan'),
  southern: path.join(PROJECT_ROOT, '.rainbow-kb-southern'),
};

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  profile: ProfileType | 'all';
  reportPath: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  let profile: ProfileType | 'all' = 'all';
  let reportPath: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--profile' || arg === '-p') && argv[i + 1]) {
      const val = argv[i + 1];
      if (val === 'pelangi' || val === 'makan' || val === 'southern') {
        profile = val;
      } else {
        console.error(`[validate-kb-schema] Unknown profile: "${val}". Use: pelangi, makan, southern`);
        process.exit(1);
      }
      i++;
    } else if ((arg === '--report' || arg === '-r') && argv[i + 1]) {
      reportPath = argv[i + 1];
      i++;
    }
  }

  return { profile, reportPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runValidateKbSchema(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);

  const profilesToScan: ProfileType[] =
    args.profile === 'all' ? ['pelangi', 'makan', 'southern'] : [args.profile];

  const allResults = profilesToScan.flatMap(p => detectContamination(PROFILE_DIRS[p], p));
  const summaries = profilesToScan.map(p => {
    const profileResults = allResults.filter(r => r.profile === p);
    return buildSummary(profileResults, p);
  });

  const report: ValidationReport = {
    generated_at: new Date().toISOString(),
    profiles: profilesToScan,
    results: allResults,
    summary: summaries,
  };

  const json = JSON.stringify(report, null, 2);

  if (args.reportPath) {
    const outputPath = path.resolve(args.reportPath);
    fs.writeFileSync(outputPath, json, 'utf-8');
    console.log(`[validate-kb-schema] Report saved to: ${outputPath}`);

    // Print summary to stdout even when writing to file
    for (const s of summaries) {
      const status = s.contaminated_files === 0 ? '✓' : '✗';
      console.log(
        `${status} ${s.profile}: ${s.contaminated_files}/${s.total_files} files contaminated` +
        ` (avg score: ${s.avg_contamination_score})`
      );
      for (const rec of s.recommendations) {
        console.log(`  → ${rec}`);
      }
    }
  } else {
    console.log(json);
  }
}

// ---------------------------------------------------------------------------
// Entrypoint — when called directly or via the cli dispatcher
// ---------------------------------------------------------------------------

// Strip the subcommand token 'validate-kb-schema' if present as first arg
const rawArgs = process.argv.slice(2).filter(a => a !== 'validate-kb-schema');

runValidateKbSchema(rawArgs).catch(err => {
  console.error('[validate-kb-schema] Fatal error:', err);
  process.exit(1);
});
