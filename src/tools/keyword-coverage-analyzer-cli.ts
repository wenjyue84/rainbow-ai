#!/usr/bin/env tsx
/**
 * US-244: Booking Intent Keyword Coverage Gap Analyzer CLI
 *
 * Analyzes intent-keywords.json across all three profiles (pelangi, makan, southern)
 * to identify booking-related keywords with uneven coverage.
 *
 * Usage:
 *   npm run analyze:keyword-coverage
 *   npx tsx src/tools/keyword-coverage-analyzer-cli.ts
 *   npx tsx src/tools/keyword-coverage-analyzer-cli.ts --json
 *
 * Exit codes:
 *   0 — No zero-keyword booking/inquiry intents found
 *   1 — At least one profile has a booking/inquiry intent with zero keywords
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { buildCoverageReport, type CoverageReport } from './keyword-coverage-analyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Human-readable formatter
// ---------------------------------------------------------------------------

function formatHumanReport(report: CoverageReport): string {
  const lines: string[] = [];

  lines.push('=== Booking Intent Keyword Coverage Gap Report ===');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Profiles analyzed: ${report.profiles.join(', ')}`);
  lines.push(`Booking intent pattern: /${report.bookingIntentPattern}/i`);
  lines.push(`Total booking/inquiry intents found: ${report.totalBookingIntents}`);
  lines.push('');

  // Per-profile summary
  lines.push('--- Per-Profile Summary ---');
  for (const [profile, summary] of Object.entries(report.perProfileSummary)) {
    lines.push(`  ${profile}: ${summary.intentCount} intents, ${summary.totalKeywords} total keywords`);
    if (summary.intentsBelow5.length > 0) {
      lines.push(`    Below threshold (<5 keywords): ${summary.intentsBelow5.join(', ')}`);
    }
  }
  lines.push('');

  // Coverage entries
  lines.push('--- Intent Coverage ---');
  for (const entry of report.coverageEntries) {
    const status = entry.missingFromProfiles.length === 0 ? '[FULL]' : '[GAP] ';
    const counts = report.profiles
      .map(p => `${p}=${entry.perProfileCounts[p] || 0}`)
      .join(', ');
    lines.push(`  ${status} ${entry.intent}: ${counts}`);
    if (entry.missingFromProfiles.length > 0) {
      lines.push(`         Missing from: ${entry.missingFromProfiles.join(', ')}`);
    }
    if (entry.profilesBelowThreshold.length > 0) {
      lines.push(`         Below threshold: ${entry.profilesBelowThreshold.join(', ')}`);
    }
  }
  lines.push('');

  // Suggestions
  if (report.suggestions.length > 0) {
    lines.push('--- Suggestions ---');
    for (const s of report.suggestions) {
      lines.push(`  ${s.targetProfile} should adopt "${s.intent}" from ${s.sourceProfile}`);
      lines.push(`    Reason: ${s.reason}`);
    }
    lines.push('');
  }

  // Zero-keyword failures
  if (report.zeroKeywordIntents.length > 0) {
    lines.push('--- FAILURES: Zero-keyword booking/inquiry intents ---');
    for (const z of report.zeroKeywordIntents) {
      lines.push(`  [FAIL] ${z.profile}: ${z.intent} has 0 keywords`);
    }
    lines.push('');
  }

  // Summary
  lines.push('--- Summary ---');
  lines.push(`  Fully covered: ${report.summary.fullyConvered}`);
  lines.push(`  Partial coverage: ${report.summary.partialCoverage}`);
  lines.push(`  Below threshold (<5): ${report.summary.belowThresholdCount}`);
  lines.push(`  Zero-keyword failures: ${report.zeroKeywordIntents.length}`);

  if (report.hasZeroKeywordFailure) {
    lines.push('');
    lines.push('[FAIL] One or more profiles have booking/inquiry intents with zero keywords.');
  } else {
    lines.push('');
    lines.push('[PASS] No booking/inquiry intents have zero keywords.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run(): number {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');

  const report = buildCoverageReport(rootDir);

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHumanReport(report));
  }

  // Exit with code 1 if any profile has booking/inquiry intent with zero keywords
  return report.hasZeroKeywordFailure ? 1 : 0;
}

const exitCode = run();
process.exit(exitCode);
