#!/usr/bin/env tsx
/**
 * US-332: Intent Routing Table Cross-Profile Contamination Validator CLI
 *
 * Validates that each intent in routing.json maps only to handlers from the
 * same profile. Catches cross-profile contamination in routing configuration
 * before deployment.
 *
 * Usage:
 *   npm run validate:routing-conflicts -- --profile pelangi
 *   npm run validate:routing-conflicts -- --profile southern
 *   npm run validate:routing-conflicts -- --profile makan
 *   npx tsx src/cli/routingConflictValidator.ts --profile pelangi
 *
 * Flags:
 *   --profile <pelangi|southern|makan>  Target profile to validate (default: pelangi)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  type RoutingConflictReport,
  PROFILE_CONFIGS,
  loadRoutingFile,
  loadWorkflowsFile,
  extractWorkflowIds,
  validateRoutingConflicts,
  findLineNumber,
} from './commands/routing-conflict-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { profile: string } {
  const profileIdx = argv.indexOf('--profile');
  const profile =
    profileIdx >= 0 && argv[profileIdx + 1] ? argv[profileIdx + 1] : 'pelangi';

  return { profile };
}

// ---------------------------------------------------------------------------
// Human-readable report formatter
// ---------------------------------------------------------------------------

function formatHumanReport(report: RoutingConflictReport): string {
  const lines: string[] = [];

  lines.push('=== Intent Routing Cross-Profile Conflict Report ===');
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');
  lines.push(`Total intents in routing.json: ${report.totalIntents}`);
  lines.push(`Cross-profile violations found: ${report.totalViolations}`);
  lines.push('');

  if (report.violations.length === 0) {
    lines.push(
      'No cross-profile routing conflicts detected. All handlers belong to this profile.',
    );
    return lines.join('\n');
  }

  lines.push('--- Violations ---');
  for (const v of report.violations) {
    const loc = v.line > 0 ? `:${v.line}` : '';
    lines.push(`  Intent: "${v.intent}"`);
    lines.push(`    Handler: "${v.handler}" (does not belong to profile "${v.profile}")`);
    lines.push(`    File: ${v.file}${loc}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const validProfiles = Object.keys(PROFILE_CONFIGS);
  if (!validProfiles.includes(args.profile)) {
    console.error(
      `ERROR: --profile must be one of: ${validProfiles.join(', ')}`,
    );
    console.error(
      'Usage: npm run validate:routing-conflicts -- --profile pelangi',
    );
    process.exit(1);
  }

  const profileConfig = PROFILE_CONFIGS[args.profile];
  const dataDir = path.join(rootDir, profileConfig.dataDir);
  const routingPath = path.join(dataDir, 'routing.json');
  const workflowsPath = path.join(dataDir, 'workflows.json');

  // Validate files exist
  if (!fs.existsSync(routingPath)) {
    console.error(`ERROR: Routing file not found: ${routingPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(workflowsPath)) {
    console.error(`ERROR: Workflows file not found: ${workflowsPath}`);
    process.exit(1);
  }

  // Load this profile's data
  const routingData = loadRoutingFile(routingPath);
  const workflowsData = loadWorkflowsFile(workflowsPath);
  const ownWorkflows = extractWorkflowIds(workflowsData);

  // Load other profiles' workflows for cross-reference
  const otherProfileWorkflows = new Map<string, Set<string>>();
  for (const [profileId, config] of Object.entries(PROFILE_CONFIGS)) {
    if (profileId === args.profile) continue;

    const otherWorkflowsPath = path.join(rootDir, config.dataDir, 'workflows.json');
    if (fs.existsSync(otherWorkflowsPath)) {
      const otherData = loadWorkflowsFile(otherWorkflowsPath);
      otherProfileWorkflows.set(profileId, extractWorkflowIds(otherData));
    }
  }

  // Build line finder for this routing file
  const lineFinder = (key: string) => findLineNumber(routingPath, key);

  // Relative routing path for report output
  const relativeRoutingPath = path.relative(rootDir, routingPath).replace(/\\/g, '/');

  // Run validation
  const report = validateRoutingConflicts(
    args.profile,
    routingData,
    ownWorkflows,
    otherProfileWorkflows,
    relativeRoutingPath,
    lineFinder,
  );

  // Print human-readable output
  console.log(formatHumanReport(report));

  // Print JSON output
  console.log('\n--- JSON Report ---');
  console.log(JSON.stringify(report, null, 2));

  if (report.totalViolations > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main();
