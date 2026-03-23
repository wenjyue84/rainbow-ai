#!/usr/bin/env tsx
/**
 * US-316: Fallback Response Coverage Gap Analysis CLI
 *
 * Scans intents.json against knowledge.json to identify intents missing
 * fallback responses. Generates a report of coverage gaps with templated
 * suggestions to improve low-confidence handling.
 *
 * Usage:
 *   npm run fallback:coverage-analysis
 *   npm run fallback:coverage-analysis -- --profile pelangi
 *   npm run fallback:coverage-analysis -- --profile southern
 *   npm run fallback:coverage-analysis -- --profile makan
 *   npx tsx src/cli/commands/fallback-coverage.ts --profile pelangi
 *
 * Flags:
 *   --profile <pelangi|southern|makan>  Target profile to analyze (default: pelangi)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  type FallbackCoverageReport,
  loadIntentsFile,
  loadKnowledgeFile,
  runFallbackCoverageAnalysis,
} from './fallback-coverage-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { profile: string } {
  const profileIdx = argv.indexOf('--profile');
  const profile = profileIdx >= 0 && argv[profileIdx + 1] ? argv[profileIdx + 1] : 'pelangi';

  return { profile };
}

// ---------------------------------------------------------------------------
// Human-readable report formatter
// ---------------------------------------------------------------------------

function formatHumanReport(report: FallbackCoverageReport): string {
  const lines: string[] = [];

  lines.push('=== Fallback Response Coverage Gap Analysis ===');
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');
  lines.push(`Total intents (enabled): ${report.totalIntents}`);
  lines.push(`Total knowledge entries: ${report.totalKnowledgeEntries}`);
  lines.push(`Coverage gaps found: ${report.totalGaps}`);
  lines.push('');

  if (report.gaps.length === 0) {
    lines.push('No coverage gaps detected. All intents have fallback responses.');
    return lines.join('\n');
  }

  // Group by gap type
  const byType: Record<string, typeof report.gaps> = {};
  for (const gap of report.gaps) {
    if (!byType[gap.gapType]) byType[gap.gapType] = [];
    byType[gap.gapType].push(gap);
  }

  const typeLabels: Record<string, string> = {
    no_template: 'No Template (intent has no knowledge entry)',
    incomplete_coverage: 'Incomplete Coverage (missing language translations)',
    low_confidence_gap: 'Low Confidence Gap (low min_confidence + no template)',
  };

  for (const [type, gaps] of Object.entries(byType)) {
    lines.push(`--- ${typeLabels[type] ?? type} (${gaps.length}) ---`);
    for (const gap of gaps) {
      lines.push(`  Intent: ${gap.intent}`);
      lines.push(`    Suggestion: ${gap.suggestion}`);
      lines.push(`    Affected: ${gap.affectedProfiles.join(', ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const validProfiles = ['pelangi', 'southern', 'makan'];
  if (!validProfiles.includes(args.profile)) {
    console.error(`ERROR: --profile must be one of: ${validProfiles.join(', ')}`);
    console.error('Usage: npm run fallback:coverage-analysis -- --profile pelangi');
    process.exit(1);
  }

  // Resolve paths
  const profileDirs: Record<string, string> = {
    pelangi: 'src/assistant/data',
    southern: 'src/assistant/data-southern',
    makan: 'src/assistant/data-makan',
  };

  const dataDir = path.join(rootDir, profileDirs[args.profile]);
  const intentsPath = path.join(dataDir, 'intents.json');
  const knowledgePath = path.join(dataDir, 'knowledge.json');

  if (!fs.existsSync(intentsPath)) {
    console.error(`ERROR: Intents file not found: ${intentsPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(knowledgePath)) {
    console.error(`ERROR: Knowledge file not found: ${knowledgePath}`);
    process.exit(1);
  }

  // Load data files
  const intentsData = loadIntentsFile(intentsPath);
  const knowledgeData = loadKnowledgeFile(knowledgePath);

  // Run analysis
  const report = runFallbackCoverageAnalysis(args.profile, intentsData, knowledgeData);

  // Write report
  const reportsDir = path.join(rootDir, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportPath = path.join(
    reportsDir,
    `fallback-coverage-${args.profile}-${dateStr}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  // Print human-readable output
  console.log(formatHumanReport(report));
  console.log(`\nReport saved: ${reportPath}`);

  process.exit(0);
}

main();
