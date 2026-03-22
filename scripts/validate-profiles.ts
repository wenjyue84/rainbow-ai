#!/usr/bin/env tsx
/**
 * US-044: Profile Data Contamination CLI
 *
 * Usage:
 *   npm run validate:profiles
 *   npx tsx scripts/validate-profiles.ts
 *
 * Exit codes:
 *   0 — All profiles clean
 *   1 — Contamination detected
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { validateAllProfiles, formatReport } from '../src/lib/profile-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const report = validateAllProfiles(rootDir);

console.log(formatReport(report));

if (!report.isClean) {
  console.error('\nERROR: Cross-profile contamination detected. Fix data files before deployment.');
  process.exit(1);
}

process.exit(0);
