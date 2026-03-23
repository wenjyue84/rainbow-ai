#!/usr/bin/env tsx
/**
 * US-094: Profile Routing Isolation CLI Validator
 *
 * Usage:
 *   npm run validate:routing
 *   npx tsx scripts/validate-routing.ts
 *
 * Exit codes:
 *   0 — All routing configurations valid
 *   1 — Routing mismatches detected
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  validateAllProfiles,
  formatReport,
} from '../src/lib/routing-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const report = validateAllProfiles(rootDir);

console.log(formatReport(report));

if (!report.isValid) {
  console.error(
    '\nERROR: Routing mismatches detected. Fix routing.json before deployment.'
  );
  process.exit(1);
}

process.exit(0);
