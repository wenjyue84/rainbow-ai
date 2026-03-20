/**
 * Profile Contamination Tests (US-015 + US-032)
 *
 * Comprehensive verification that each business profile's data files
 * contain no identifiers belonging to a different business.
 * Tests both JSON data files and KB files (markdown).
 * File-read only — no network calls.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// Resolve project root from this file's location (src/tests/profile-contamination.test.ts)
// Use fileURLToPath to handle URL-encoded spaces in Windows paths.
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function readFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8').toLowerCase();
}

function readProfile(profile: string, filename: string): string | null {
  const filePath = join(ROOT, 'src', 'assistant', profile, filename);
  return readFile(filePath);
}

function readKBFile(profile: string, filename: string): string | null {
  const filePath = join(ROOT, `.rainbow-kb-${profile}`, filename);
  return readFile(filePath);
}

// Comprehensive Pelangi Capsule Hostel identifiers
const PELANGI_IDENTIFIERS = [
  'pelangi capsule',
  'ilovestaycapsule',
  '1270#',
  'taman pelangi',
  '26a jalan perang',
  'jalan perang taman pelangi',
  '6ux11obzaqqq', // YouTube video ID (case-insensitive variant)
  '6Ux11oBZaQQ', // YouTube video ID (original case)
  'youtube.com/watch?v=6',  // YouTube link variant
  '60127088789', // Maya staff phone (Pelangi contact)
  '+60127088789',
  'capsule',
  'dorm',
  'locker',
  'bunk',
];

// Comprehensive Makan Moments Cafe identifiers
const MAKAN_IDENTIFIERS = [
  'makan moments',
  'kafe kenangan makan',
  '食光记忆',
  'skudai',
  'jalan impian emas',
  'taman impian emas',
  '012-7088789', // Makan phone
  '012 708 8789',
  'ilovemakan', // Makan WiFi password
  'thai-malaysian fusion',
  'thai basil chicken',
  'salted egg chicken chop',
];

// Comprehensive Southern Homestay identifiers
const SOUTHERN_IDENTIFIERS = [
  'southern homestay',
  'rumah tumpangan selatan',
  'ksl d\'esplanade',
  'setia sky88',
  'pinnacle towers',
  'johor bahru',
  '8009679425', // Southern CIMB account
];

// Data files to validate (expanded to include routing, templates, workflows, settings)
const DATA_JSON_FILES = [
  'knowledge.json',
  'intent-keywords.json',
  'intents.json',
  'routing.json',
  'templates.json',
  'workflows.json',
  'settings.json',
];

// KB files to validate
const KB_FILES = [
  'AGENTS.md',
  'soul.md',
  'faq.md',
  'cafe-facts.md',
  'company-profile.md',
  'check-in-guide.md',
  'pricing-and-payment.md',
  'ordering.md',
];

// ─── Helper ─────────────────────────────────────────────────────────────────

function checkDataFiles(
  profile: string,
  forbidden: string[]
): void {
  for (const filename of DATA_JSON_FILES) {
    const content = readProfile(profile, filename);
    if (content === null) {
      // Skip if file doesn't exist
      continue;
    }
    describe(`${profile}/${filename}`, () => {
      for (const term of forbidden) {
        it(`must not contain "${term}"`, () => {
          expect(content).not.toContain(term.toLowerCase());
        });
      }
    });
  }
}

function checkKBFiles(
  profile: string,
  forbidden: string[]
): void {
  for (const filename of KB_FILES) {
    const content = readKBFile(profile, filename);
    if (content === null) {
      // Skip if KB file doesn't exist
      continue;
    }
    describe(`.rainbow-kb-${profile}/${filename}`, () => {
      for (const term of forbidden) {
        it(`must not contain "${term}"`, () => {
          expect(content).not.toContain(term.toLowerCase());
        });
      }
    });
  }
}

// ─── Makan Moments: must not contain Pelangi or Southern identifiers ────────

describe('data-makan profile — profile separation', () => {
  checkDataFiles('data-makan', PELANGI_IDENTIFIERS);
  checkDataFiles('data-makan', SOUTHERN_IDENTIFIERS);
  checkKBFiles('makan', PELANGI_IDENTIFIERS);
  checkKBFiles('makan', SOUTHERN_IDENTIFIERS);
});

// ─── Southern Homestay: must not contain Pelangi or Makan identifiers ──────

describe('data-southern profile — profile separation', () => {
  checkDataFiles('data-southern', PELANGI_IDENTIFIERS);
  checkDataFiles('data-southern', MAKAN_IDENTIFIERS);
  checkKBFiles('southern', PELANGI_IDENTIFIERS);
  checkKBFiles('southern', MAKAN_IDENTIFIERS);
});

// ─── Pelangi Capsule (main data/): must not contain other profile identifiers ─

describe('data (Pelangi Capsule) profile — profile separation', () => {
  checkDataFiles('data', MAKAN_IDENTIFIERS);
  checkDataFiles('data', SOUTHERN_IDENTIFIERS);
});
