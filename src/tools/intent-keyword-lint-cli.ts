#!/usr/bin/env tsx
/**
 * US-305: Intent Keyword Conflict Scanner CLI
 *
 * Scans all profile intent-keywords.json files and reports keywords that
 * appear in multiple intents within the same profile, causing classifier
 * ambiguity.
 *
 * Usage:
 *   npm run lint:intent-keywords
 *   npm run lint:intent-keywords -- --json
 *   npx tsx src/tools/intent-keyword-lint-cli.ts
 *
 * Exit codes:
 *   0 — No conflicts found
 *   1 — Conflicts found (or error)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadAllProfiles,
  lintAllProfiles,
  formatHumanReport,
} from './intent-keyword-lint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');

  const profileData = loadAllProfiles(rootDir);

  if (profileData.size === 0) {
    console.error('ERROR: No profile intent-keywords.json files found');
    process.exit(1);
  }

  const report = lintAllProfiles(profileData);

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHumanReport(report));
  }

  process.exit(report.total_conflicts > 0 ? 1 : 0);
}

main();
