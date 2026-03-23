#!/usr/bin/env tsx
/**
 * US-097: Profile Contamination Detection CLI
 *
 * Detects cross-profile intent routing violations in data files.
 * Checks for hostel terms in cafe profiles and cafe terms in hostel profiles.
 *
 * Usage:
 *   npm run check:contamination
 *   npx tsx scripts/check-contamination.ts
 *
 * Exit codes:
 *   0 — All profiles clean, no contamination detected
 *   1 — Contamination detected in one or more profiles
 */

import { detectContamination, generateContaminationReport } from '../src/lib/profile-contamination-check.js';

const PROFILES = ['pelangi', 'southern', 'makan'];

const results = PROFILES.map(profile => detectContamination(profile));

const hasContamination = results.some(r => r.contaminated);

// Generate report
console.log('='.repeat(80));
console.log('Profile Contamination Detection Report');
console.log('='.repeat(80));
console.log('');

for (const result of results) {
  const status = result.contaminated ? '❌ CONTAMINATED' : '✓ Clean';
  console.log(`${result.profileName.toUpperCase()}: ${status}`);

  if (result.findings.length > 0) {
    console.log(`  Violations found: ${result.findings.length}`);
    for (const finding of result.findings) {
      console.log(`    • ${finding.sourceFile} - Matched term: "${finding.matchedTerm}" in ${finding.context}`);
    }
  }
  console.log('');
}

console.log('='.repeat(80));

if (hasContamination) {
  console.error('ERROR: Cross-profile intent routing violations detected.');
  console.error('Profile separation is enforced - fix contamination before merge.');
  console.log(generateContaminationReport(results));
  process.exit(1);
}

console.log('✓ All profiles are clean - no cross-profile contamination detected.');
process.exit(0);
