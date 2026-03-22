#!/usr/bin/env tsx
/**
 * US-088: Booking Workflow Step Dependency Validator CLI
 *
 * Loads workflows.json per profile and reports:
 *   - Hard errors: circular dependencies (non-blocking), missing node refs, bad startNodeId
 *   - Warnings: safe reprompt loops (cycles through wait_reply/collect_input nodes)
 *
 * Usage:
 *   npm run validate:workflows
 *   npx tsx scripts/validate-workflows.ts
 *
 * Exit codes:
 *   0 — All workflows valid (warnings are informational)
 *   1 — Hard validation errors found
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { validateAllWorkflows } from '../src/lib/validators/workflowValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const WORKFLOW_FILES = [
  'src/assistant/data/workflows.json',
  'src/assistant/data-southern/workflows.json',
  'src/assistant/data-makan/workflows.json',
];

let totalHardErrors = 0;
let totalWarnings = 0;
let totalChecked = 0;

for (const relPath of WORKFLOW_FILES) {
  const absPath = join(rootDir, relPath);

  if (!existsSync(absPath)) {
    console.log(`  SKIP   ${relPath} (not found)`);
    continue;
  }

  let data: { workflows: unknown[] };
  try {
    data = JSON.parse(readFileSync(absPath, 'utf8'));
  } catch (err) {
    console.error(`  ERROR  ${relPath}: Failed to parse JSON — ${(err as Error).message}`);
    totalHardErrors++;
    continue;
  }

  const wfCount = data.workflows?.length ?? 0;
  totalChecked += wfCount;

  const report = validateAllWorkflows(data as Parameters<typeof validateAllWorkflows>[0]);

  if (report.errors.length === 0 && report.warnings.length === 0) {
    console.log(`  OK     ${relPath} (${wfCount} workflows)`);
  } else {
    if (report.errors.length > 0) {
      console.error(`  FAIL   ${relPath}`);
      for (const err of report.errors) {
        console.error(`         [${err.workflowId}]`);
        for (const detail of err.details) {
          console.error(`           ERROR: ${detail}`);
        }
      }
      totalHardErrors += report.errors.length;
    }

    if (report.warnings.length > 0) {
      if (report.errors.length === 0) {
        console.log(`  WARN   ${relPath} (${wfCount} workflows)`);
      }
      for (const w of report.warnings) {
        for (const detail of w.warnings) {
          console.log(`           WARN [${w.workflowId}]: ${detail}`);
        }
      }
      totalWarnings += report.warnings.reduce((sum, w) => sum + w.warnings.length, 0);
    }
  }
}

console.log('');
console.log(`Checked ${totalChecked} workflow(s) across ${WORKFLOW_FILES.length} profile(s).`);
if (totalWarnings > 0) {
  console.log(`Warnings: ${totalWarnings} safe reprompt loop(s) detected (no action required).`);
}

if (totalHardErrors > 0) {
  console.error(`FAILED: ${totalHardErrors} hard error(s) found. Fix before deployment.`);
  process.exit(1);
} else {
  console.log('All workflows passed validation.');
  process.exit(0);
}
