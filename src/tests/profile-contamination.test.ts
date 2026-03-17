/**
 * Profile Contamination Tests (US-015)
 *
 * Verifies that each business profile's data files contain no identifiers
 * belonging to a different business. File-read only — no network calls.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// Resolve project root from this file's location (src/tests/profile-contamination.test.ts)
// Use fileURLToPath to handle URL-encoded spaces in Windows paths.
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function readProfile(profile: string, filename: string): string | null {
  const filePath = join(ROOT, 'src', 'assistant', profile, filename);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8').toLowerCase();
}

// Strings that uniquely identify Pelangi Capsule Hostel
const PELANGI_IDENTIFIERS = [
  'pelangi capsule',
  'ilovestaycapsule',
  '1270#',
  'taman pelangi',
];

// Strings that uniquely identify Makan Moments Cafe
const MAKAN_IDENTIFIERS = ['makan moments'];

// Files to validate in each profile
const PROFILE_FILES = ['knowledge.json', 'intent-keywords.json', 'intents.json'];

// ─── Helper ─────────────────────────────────────────────────────────────────

function checkProfileFiles(
  profile: string,
  forbidden: string[]
): void {
  for (const filename of PROFILE_FILES) {
    const content = readProfile(profile, filename);
    if (content === null) {
      it.skip(`${profile}/${filename} not found`);
    } else {
      describe(filename, () => {
        for (const term of forbidden) {
          it(`must not contain "${term}"`, () => {
            expect(content).not.toContain(term.toLowerCase());
          });
        }
      });
    }
  }
}

// ─── Makan Moments: must not contain Pelangi Capsule identifiers ─────────────

describe('data-makan profile — no Pelangi Capsule identifiers', () => {
  checkProfileFiles('data-makan', PELANGI_IDENTIFIERS);
});

// ─── Southern Homestay: must not contain Pelangi Capsule identifiers ─────────

describe('data-southern profile — no Pelangi Capsule identifiers', () => {
  checkProfileFiles('data-southern', PELANGI_IDENTIFIERS);
});

// ─── Pelangi Capsule (main data/): must not contain Makan Moments identifiers ─

describe('data (Pelangi Capsule) profile — no Makan Moments identifiers', () => {
  checkProfileFiles('data', MAKAN_IDENTIFIERS);
});
