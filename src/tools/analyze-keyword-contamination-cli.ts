#!/usr/bin/env tsx
/**
 * US-222: Intent Keyword Contamination Scanner CLI with Cross-Profile Report
 *
 * Analyzes intent-keywords.json across all profiles (pelangi, southern, makan)
 * to detect copy-pasted keywords indicating data contamination. Generates a
 * CSV report showing keyword duplicates with Levenshtein distance scores.
 *
 * Usage:
 *   npm run analyze:contamination
 *   npx tsx src/tools/analyze-keyword-contamination-cli.ts
 *   npx tsx src/tools/analyze-keyword-contamination-cli.ts --json
 *   npx tsx src/tools/analyze-keyword-contamination-cli.ts --csv
 *
 * Exit codes:
 *   0 — No contaminated keywords found
 *   1 — Contaminated keywords detected
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadAllProfiles,
  buildContaminationReport,
  formatCSV,
  type ContaminationReport,
} from './analyze-keyword-contamination.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Human-readable formatter
// ---------------------------------------------------------------------------

function formatHumanReport(report: ContaminationReport): string {
  const lines: string[] = [];

  lines.push('=== Intent Keyword Contamination Report ===');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Profiles analyzed: ${report.profiles_analyzed.join(', ')}`);
  lines.push(`Total keywords scanned: ${report.total_keywords_scanned}`);
  lines.push(`Contaminated matches: ${report.contaminated_count}`);
  lines.push(`Review matches: ${report.review_count}`);
  lines.push('');

  // Show contaminated matches
  const contaminated = report.matches.filter(m => m.status === 'CONTAMINATED');
  if (contaminated.length > 0) {
    lines.push('--- CONTAMINATED Keywords ---');
    for (const m of contaminated) {
      lines.push(
        `  [${m.similarity_score}%] "${m.keyword}" — ${m.profile_a}/${m.intent_a} <-> ${m.profile_b}/${m.intent_b}`,
      );
    }
    lines.push('');
  }

  // Show review matches (limited to top 20 for readability)
  const review = report.matches.filter(m => m.status === 'REVIEW');
  if (review.length > 0) {
    const shown = review.slice(0, 20);
    lines.push(`--- REVIEW Keywords (showing ${shown.length}/${review.length}) ---`);
    for (const m of shown) {
      lines.push(
        `  [${m.similarity_score}%] "${m.keyword}" — ${m.profile_a}/${m.intent_a} <-> ${m.profile_b}/${m.intent_b}`,
      );
    }
    lines.push('');
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('--- Recommendations ---');
    for (const r of report.recommendations) {
      lines.push(`  * ${r.recommendation}`);
    }
    lines.push('');
  }

  // Summary
  if (report.contaminated_count > 0) {
    lines.push(`RESULT: ${report.contaminated_count} contaminated keyword(s) found — cleanup needed`);
  } else {
    lines.push('RESULT: No contamination detected');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const csvMode = args.includes('--csv');

  const profileData = loadAllProfiles(rootDir);

  if (profileData.size === 0) {
    console.error('ERROR: No profile intent-keywords.json files found');
    process.exit(1);
  }

  const report = buildContaminationReport(profileData);

  if (csvMode) {
    console.log(formatCSV(report.matches));
  } else if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHumanReport(report));
  }

  process.exit(report.contaminated_count > 0 ? 1 : 0);
}

main();
