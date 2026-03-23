#!/usr/bin/env tsx
/**
 * US-298: CLI command to generate/validate profile data file checksums.
 *
 * Usage:
 *   npm run validate:profile-integrity           # Generate hashes
 *   npm run validate:profile-integrity -- --check # Validate against stored hashes
 */

import { join } from 'path';
import { fileURLToPath } from 'url';
import {
  generateProfileHashes,
  writeProfileHashes,
  validateProfileIntegrity,
  formatIntegrityErrors,
} from '../src/lib/profile-integrity.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const isCheck = process.argv.includes('--check');

if (isCheck) {
  // Validate mode: compare live files against stored hashes
  const result = validateProfileIntegrity(ROOT);

  if (result.valid) {
    console.log('[validate:profile-integrity] All profile data files match stored checksums.');
    process.exit(0);
  } else {
    console.error(formatIntegrityErrors(result));
    process.exit(1);
  }
} else {
  // Generate mode: compute hashes and write profile-hashes.json
  const hashes = generateProfileHashes(ROOT);

  let totalFiles = 0;
  for (const p of hashes.profiles) {
    totalFiles += p.files.length;
    console.log(`[${p.profile}]`);
    for (const f of p.files) {
      console.log(`  ${f.file}: ${f.sha256}`);
    }
  }

  writeProfileHashes(ROOT, hashes);
  console.log(`\nWrote ${totalFiles} hashes across ${hashes.profiles.length} profiles to profile-hashes.json`);
}
