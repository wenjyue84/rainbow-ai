/**
 * audit-config CLI — Production configuration audit report generator.
 *
 * Usage:
 *   npm run audit:config -- --environment=production --output=config-audit.json
 *   npm run audit:config -- --environment=staging
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ConfigAuditor } from '../lib/config-auditor.js';

function parseArgs(argv: string[]): { environment: string; output: string | null } {
  let environment = 'production';
  let output: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith('--environment=')) {
      environment = arg.slice('--environment='.length);
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
    }
  }

  return { environment, output };
}

async function main(): Promise<void> {
  const { environment, output } = parseArgs(process.argv.slice(2));

  console.log(`Running config audit for environment: ${environment}`);

  const auditor = new ConfigAuditor(process.cwd());
  const result = await auditor.runAll(environment);

  const json = JSON.stringify(result, null, 2);

  if (output) {
    const outputPath = resolve(process.cwd(), output);
    writeFileSync(outputPath, json, 'utf-8');
    console.log(`Audit report written to: ${outputPath}`);
  } else {
    console.log(json);
  }

  // Print summary
  const statusIcon = result.validation_result === 'PASS' ? '✓' : '✗';
  console.log(
    `\n${statusIcon} Audit ${result.validation_result}: ${result.passed}/${result.total_checks} checks passed`
  );

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of result.warnings) {
      console.log(`  [${w.field}] ${w.message}`);
      console.log(`    Fix: ${w.fix_command}`);
    }
  }

  process.exit(result.validation_result === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
