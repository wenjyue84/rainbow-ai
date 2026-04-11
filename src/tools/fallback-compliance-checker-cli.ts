#!/usr/bin/env tsx
/**
 * US-461: Fallback Compliance Checker CLI
 *
 * Usage:
 *   npx tsx src/tools/fallback-compliance-checker-cli.ts --profile=pelangi
 *   npx tsx src/tools/fallback-compliance-checker-cli.ts --profile=southern --severity=critical
 *   node dist/tools/fallback-compliance-checker.js --profile=pelangi --severity=critical
 *
 * Exit codes:
 *   0 — passed (no critical violations)
 *   1 — critical violations found
 */

import { loadBusinessRules, loadKnowledge, checkCompliance } from './fallback-compliance-checker.js';

function parseArgs(argv: string[]): { profile: string; severity?: 'critical' | 'warning' } {
  let profile = '';
  let severity: 'critical' | 'warning' | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    } else if (arg === '--profile' || arg === '-p') {
      const next = argv[argv.indexOf(arg) + 1];
      if (next && !next.startsWith('--')) profile = next;
    } else if (arg.startsWith('--severity=')) {
      const val = arg.slice('--severity='.length);
      if (val === 'critical' || val === 'warning') severity = val;
    } else if (arg === '--severity') {
      const next = argv[argv.indexOf(arg) + 1];
      if (next === 'critical' || next === 'warning') severity = next;
    }
  }

  if (!profile) {
    console.error('Error: --profile is required');
    console.error('Usage: npx tsx src/tools/fallback-compliance-checker-cli.ts --profile=pelangi [--severity=critical|warning]');
    process.exit(1);
  }

  return { profile, severity };
}

function main(): void {
  const { profile, severity } = parseArgs(process.argv.slice(2));

  let knowledge;
  try {
    knowledge = loadKnowledge(profile);
  } catch (err) {
    console.error(`Error loading knowledge: ${(err as Error).message}`);
    process.exit(1);
  }

  const config = loadBusinessRules();
  const report = checkCompliance(profile, knowledge, config, severity);

  console.log(`\n📋 Fallback Compliance Report`);
  console.log(`Profile: ${profile}${severity ? ` (severity filter: ${severity})` : ''}`);
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Responses checked: ${report.total_responses_checked}`);
  console.log(`Total violations: ${report.total_violations}`);
  console.log(`  Critical: ${report.critical_violations}`);
  console.log(`  Warnings: ${report.warning_violations}`);
  console.log(`Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'}\n`);

  if (report.violations.length === 0) {
    console.log('No violations found.');
  } else {
    console.log('Violations:');
    for (const v of report.violations) {
      const icon = v.severity === 'critical' ? '🚨' : '⚠️ ';
      console.log(`\n  ${icon} [${v.severity.toUpperCase()}] ${v.response_id}`);
      console.log(`     Rule:    ${v.failed_rule}`);
      console.log(`     Text:    ${v.response_text}`);
      console.log(`     Fix:     ${v.suggested_fix}`);
    }
  }

  // CI: exit 1 if critical violations found
  if (!report.passed) {
    process.exit(1);
  }
}

main();
