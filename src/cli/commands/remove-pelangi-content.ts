#!/usr/bin/env tsx
/**
 * US-337: Makan Moments Knowledge Base Pelangi Content Removal Tool
 *
 * CLI tool to identify and remove Pelangi Capsule-specific content
 * (hostel terminology, room types, pricing) from data-makan/knowledge.json,
 * preserving cafe-specific content (menu items, promotions, operating hours).
 *
 * Usage:
 *   npm run cli:remove-pelangi-content -- --profile=makan --dry-run
 *   npm run cli:remove-pelangi-content -- --profile=makan
 *   npx tsx src/cli/commands/remove-pelangi-content.ts --profile=makan --dry-run
 *
 * Flags:
 *   --profile <makan>    Target profile to clean (required, currently only makan)
 *   --dry-run             Preview changes without writing (default if --apply not given)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  type RemovalReport,
  loadKnowledgeFile,
  writeKnowledgeFile,
  createBackup,
  runPelangiContentRemoval,
} from './remove-pelangi-content-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { profile: string; dryRun: boolean } {
  let profile = '';

  // Support both --profile=makan and --profile makan
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--profile=')) {
      profile = arg.split('=')[1];
    } else if (arg === '--profile' && argv[i + 1]) {
      profile = argv[i + 1];
      i++;
    }
  }

  const dryRun = argv.includes('--dry-run');

  return { profile, dryRun };
}

// ---------------------------------------------------------------------------
// Human-readable report formatter
// ---------------------------------------------------------------------------

function formatHumanReport(report: RemovalReport, dryRun: boolean): string {
  const lines: string[] = [];
  const mode = dryRun ? 'DRY-RUN' : 'APPLIED';

  lines.push(`=== Pelangi Content Removal [${mode}] ===`);
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');

  lines.push(`Static entries before: ${report.static_entries_before}`);
  lines.push(`Static entries after:  ${report.static_entries_after}`);
  lines.push(`Static entries removed: ${report.static_entries_removed}`);
  lines.push('');

  if (report.dynamic_keys_before > 0) {
    lines.push(`Dynamic keys before: ${report.dynamic_keys_before}`);
    lines.push(`Dynamic keys after:  ${report.dynamic_keys_after}`);
    lines.push(`Dynamic keys removed: ${report.dynamic_keys_removed}`);
    lines.push('');
  }

  if (report.removed_entries.length > 0) {
    lines.push('--- Removable Static Entries ---');
    for (const detail of report.removed_entries) {
      lines.push(`  Intent: ${detail.intent} (id: ${detail.id ?? 'none'})`);
      lines.push(`    Reason: ${detail.reason}`);
      lines.push(`    Patterns: ${detail.matchedPatterns.join(', ')}`);
    }
    lines.push('');
  }

  if (report.removed_dynamic_keys.length > 0) {
    lines.push('--- Removable Dynamic Keys ---');
    for (const detail of report.removed_dynamic_keys) {
      lines.push(`  Key: ${detail.key}`);
      lines.push(`    Reason: ${detail.reason}`);
    }
    lines.push('');
  }

  lines.push(`Hostel references remaining: ${report.hostel_references_remaining}`);
  lines.push(`Success: ${report.success}`);

  if (dryRun) {
    lines.push('');
    lines.push('NOTE: This was a dry-run. Run without --dry-run to apply changes.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.profile || args.profile !== 'makan') {
    console.error('ERROR: --profile is required and must be "makan"');
    console.error('Usage: npm run cli:remove-pelangi-content -- --profile=makan --dry-run');
    console.error('       npm run cli:remove-pelangi-content -- --profile=makan');
    process.exit(1);
  }

  // Resolve paths
  const profileDirs: Record<string, string> = {
    makan: 'src/assistant/data-makan',
  };

  const knowledgePath = path.join(rootDir, profileDirs[args.profile], 'knowledge.json');

  if (!fs.existsSync(knowledgePath)) {
    console.error(`ERROR: Knowledge file not found: ${knowledgePath}`);
    process.exit(1);
  }

  // Load knowledge file
  const knowledgeData = loadKnowledgeFile(knowledgePath);

  // Run removal analysis
  const { report, cleaned } = runPelangiContentRemoval(args.profile, knowledgeData);

  // In non-dry-run mode, write changes
  if (!args.dryRun) {
    // Create backup
    const backupPath = createBackup(knowledgePath);
    console.log(`BACKUP: ${backupPath}`);

    // Write cleaned file
    if (report.static_entries_removed > 0 || report.dynamic_keys_removed > 0) {
      writeKnowledgeFile(knowledgePath, cleaned);
      console.log(`WRITTEN: ${knowledgePath}`);
    } else {
      console.log('No changes to write — knowledge.json is already clean.');
    }
  }

  // Print human-readable output
  console.log(formatHumanReport(report, args.dryRun));

  // Save JSON report
  const reportsDir = path.join(rootDir, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportPath = path.join(reportsDir, `pelangi-content-removal-${args.profile}-${dateStr}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nReport saved: ${reportPath}`);

  process.exit(report.success ? 0 : 1);
}

main();
