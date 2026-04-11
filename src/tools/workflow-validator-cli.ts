#!/usr/bin/env node

import { resolve } from 'path';
import { writeFileSync } from 'fs';
import {
  validateWorkflowsFile,
  generateRepairSuggestions,
  applyRepairs,
  formatValidationReport
} from './workflow-validator.js';

interface CliOptions {
  validate?: boolean;
  autoRepair?: boolean;
  output?: string;
  workflows?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--validate') {
      opts.validate = true;
    } else if (arg === '--auto-repair') {
      opts.autoRepair = true;
    } else if (arg === '--output' && args[i + 1]) {
      opts.output = args[i + 1];
      i++;
    } else if (arg === '--workflows' && args[i + 1]) {
      opts.workflows = args[i + 1];
      i++;
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  // Default paths
  const workflowsPath = opts.workflows || resolve(process.cwd(), 'src/assistant/data/workflows.json');
  const repairsOutputPath = opts.output || resolve(process.cwd(), 'repair-suggestions.json');

  console.log(`\n🔍 Validating workflows at: ${workflowsPath}\n`);

  try {
    // Run validation
    const report = validateWorkflowsFile(workflowsPath);

    // Print formatted report
    const formatted = formatValidationReport(report);
    console.log(formatted);

    // Generate repair suggestions
    if (report.repairs.length > 0) {
      console.log(`\n💾 Saving ${report.repairs.length} repair suggestions to ${repairsOutputPath}\n`);
      generateRepairSuggestions(workflowsPath, repairsOutputPath);

      if (opts.autoRepair) {
        console.log('🔧 Attempting auto-repair...\n');
        const repairResult = applyRepairs(workflowsPath, report.repairs, false);

        if (repairResult.errors.length > 0) {
          console.log('❌ Auto-repair encountered errors:');
          for (const error of repairResult.errors) {
            console.log(`  - ${error}`);
          }
        } else {
          console.log(`✓ Applied ${repairResult.applied} repairs, skipped ${repairResult.skipped}`);
        }
      } else {
        console.log('💡 Tip: Use --auto-repair flag to attempt automatic fixes\n');
      }
    } else {
      console.log('✓ No repairs needed!\n');
    }

    // Exit with appropriate code
    process.exit(report.valid ? 0 : 1);

  } catch (error) {
    console.error('❌ Validation failed:', error instanceof Error ? error.message : error);
    process.exit(2);
  }
}

// Run CLI
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(2);
});
