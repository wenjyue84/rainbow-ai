/**
 * US-197: Profile Data Contamination Regression Test Suite
 *
 * Scans data-makan/ and data-southern/ profile directories for Pelangi-specific
 * terms that should not leak across profile boundaries. Also validates that
 * intent name sets across profiles are disjoint where expected.
 *
 * Failing tests indicate cross-profile contamination that must be remediated
 * before merging. Error messages list contaminated files and offending keywords.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// ─── Constants ───────────────────────────────────────────────────────────────

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const DATA_ROOT = resolve(currentDir, '..', 'assistant');

const DATA_PELANGI = join(DATA_ROOT, 'data');
const DATA_MAKAN = join(DATA_ROOT, 'data-makan');
const DATA_SOUTHERN = join(DATA_ROOT, 'data-southern');

/**
 * Pelangi-specific terms that must NOT appear in data-makan/ or data-southern/ files.
 * These are hostel/capsule concepts that belong exclusively to the Pelangi profile.
 */
const PELANGI_EXCLUSIVE_TERMS = [
  'capsule',
  'pelangi',
  'dorm',
  'dormitory',
  'hostel_booking',
] as const;

/**
 * Extended set of Pelangi-specific intent names and keywords that should not
 * leak into non-Pelangi profiles.
 */
const PELANGI_INTENT_TERMS = [
  'capsule_conflict',
  'lower_deck_preference',
  'card_locked',
  'theft_report',
  'luggage_storage',
  'late_checkout_request',
  'stay_extension',
  'extend_stay',
  'facility_orientation',
  'EXTRA_TOWEL',
  'EXTRA_PILLOW',
  'ROOM_CLEANING',
  'MAINTENANCE_ISSUE',
  'WIFI_PASSWORD',
  'booking_modification',
  'booking_cancellation',
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ContaminationMatch {
  file: string;
  term: string;
  line: number;
  content: string;
}

/**
 * Scans all JSON and .md files in a directory for occurrences of forbidden terms.
 * Returns an array of matches with file path, term, line number, and line content.
 */
function scanDirectoryForTerms(
  dirPath: string,
  terms: readonly string[],
): ContaminationMatch[] {
  if (!existsSync(dirPath)) return [];

  const files = readdirSync(dirPath).filter(
    (f) => f.endsWith('.json') || f.endsWith('.md'),
  );
  const matches: ContaminationMatch[] = [];

  for (const file of files) {
    const filePath = join(dirPath, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      for (const term of terms) {
        if (lineLower.includes(term.toLowerCase())) {
          matches.push({
            file,
            term,
            line: i + 1,
            content: lines[i].trim().substring(0, 120),
          });
        }
      }
    }
  }

  return matches;
}

/**
 * Extracts intent names from an intents.json file (categories across all phases).
 */
function extractIntentNames(filePath: string): Set<string> {
  if (!existsSync(filePath)) return new Set();

  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  const names = new Set<string>();

  if (data.categories && Array.isArray(data.categories)) {
    for (const cat of data.categories) {
      if (cat.intents && Array.isArray(cat.intents)) {
        for (const intent of cat.intents) {
          if (intent.category) names.add(intent.category);
        }
      }
    }
  }

  return names;
}

/**
 * Extracts intent names from a routing.json file (top-level keys).
 */
function extractRoutingIntents(filePath: string): Set<string> {
  if (!existsSync(filePath)) return new Set();

  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  const names = new Set<string>();

  for (const key of Object.keys(data)) {
    if (key === 'schema_version') continue;
    names.add(key);
  }

  return names;
}

/**
 * Extracts intent names from an intent-keywords.json file.
 */
function extractKeywordIntents(filePath: string): Set<string> {
  if (!existsSync(filePath)) return new Set();

  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  const names = new Set<string>();

  if (data.intents && Array.isArray(data.intents)) {
    for (const entry of data.intents) {
      if (entry.intent) names.add(entry.intent);
    }
  }

  return names;
}

/**
 * Formats contamination matches into a human-readable error message for CI output.
 */
function formatContaminationReport(
  profileName: string,
  matches: ContaminationMatch[],
): string {
  const lines = [
    '',
    '=== CONTAMINATION DETECTED in ' + profileName + ' ===',
    'Found ' + matches.length + ' contaminated occurrence(s):',
    '',
  ];

  const byFile = new Map<string, ContaminationMatch[]>();
  for (const m of matches) {
    if (!byFile.has(m.file)) byFile.set(m.file, []);
    byFile.get(m.file)!.push(m);
  }

  for (const [file, fileMatches] of byFile) {
    lines.push('  ' + file + ':');
    for (const m of fileMatches) {
      lines.push('    L' + m.line + ': term "' + m.term + '" -> ' + m.content);
    }
  }

  lines.push('');
  lines.push('Remediation: Remove or replace the above Pelangi-specific terms.');
  return lines.join('\n');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('US-197: Profile Data Contamination Regression', () => {
  // ── AC1: Scan data-makan for Pelangi terms ──────────────────────────────

  describe('data-makan/ must not contain Pelangi-specific terms', () => {
    const matches = scanDirectoryForTerms(DATA_MAKAN, PELANGI_EXCLUSIVE_TERMS);

    it('should not contain "capsule" in any JSON/MD file', () => {
      const capsuleHits = matches.filter((m) => m.term === 'capsule');
      expect(
        capsuleHits,
        formatContaminationReport('data-makan (capsule)', capsuleHits),
      ).toHaveLength(0);
    });

    it('should not contain "pelangi" in any JSON/MD file', () => {
      const pelangiHits = matches.filter((m) => m.term === 'pelangi');
      expect(
        pelangiHits,
        formatContaminationReport('data-makan (pelangi)', pelangiHits),
      ).toHaveLength(0);
    });

    it('should not contain "dorm" in any JSON/MD file', () => {
      const dormHits = matches.filter((m) => m.term === 'dorm');
      expect(
        dormHits,
        formatContaminationReport('data-makan (dorm)', dormHits),
      ).toHaveLength(0);
    });

    it('should not contain "dormitory" in any JSON/MD file', () => {
      const dormitoryHits = matches.filter((m) => m.term === 'dormitory');
      expect(
        dormitoryHits,
        formatContaminationReport('data-makan (dormitory)', dormitoryHits),
      ).toHaveLength(0);
    });

    it('should not contain "hostel_booking" in any JSON/MD file', () => {
      const hostelBookingHits = matches.filter((m) => m.term === 'hostel_booking');
      expect(
        hostelBookingHits,
        formatContaminationReport('data-makan (hostel_booking)', hostelBookingHits),
      ).toHaveLength(0);
    });

    it('should not contain Pelangi-exclusive intent names in routing or config files', () => {
      const intentMatches = scanDirectoryForTerms(DATA_MAKAN, PELANGI_INTENT_TERMS);
      expect(
        intentMatches,
        formatContaminationReport('data-makan (Pelangi intents)', intentMatches),
      ).toHaveLength(0);
    });
  });

  // ── AC1: Scan data-southern for Pelangi terms ───────────────────────────

  describe('data-southern/ must not contain Pelangi-specific terms', () => {
    const matches = scanDirectoryForTerms(DATA_SOUTHERN, PELANGI_EXCLUSIVE_TERMS);

    it('should not contain "capsule" in any JSON/MD file', () => {
      const capsuleHits = matches.filter((m) => m.term === 'capsule');
      expect(
        capsuleHits,
        formatContaminationReport('data-southern (capsule)', capsuleHits),
      ).toHaveLength(0);
    });

    it('should not contain "pelangi" in any JSON/MD file', () => {
      const pelangiHits = matches.filter((m) => m.term === 'pelangi');
      expect(
        pelangiHits,
        formatContaminationReport('data-southern (pelangi)', pelangiHits),
      ).toHaveLength(0);
    });

    it('should not contain "dorm" in any JSON/MD file', () => {
      const dormHits = matches.filter((m) => m.term === 'dorm');
      expect(
        dormHits,
        formatContaminationReport('data-southern (dorm)', dormHits),
      ).toHaveLength(0);
    });

    it('should not contain "dormitory" in any JSON/MD file', () => {
      const dormitoryHits = matches.filter((m) => m.term === 'dormitory');
      expect(
        dormitoryHits,
        formatContaminationReport('data-southern (dormitory)', dormitoryHits),
      ).toHaveLength(0);
    });

    it('should not contain "hostel_booking" in any JSON/MD file', () => {
      const hostelBookingHits = matches.filter((m) => m.term === 'hostel_booking');
      expect(
        hostelBookingHits,
        formatContaminationReport('data-southern (hostel_booking)', hostelBookingHits),
      ).toHaveLength(0);
    });

    it('should not contain Pelangi-exclusive intent names in routing or config files', () => {
      const intentMatches = scanDirectoryForTerms(DATA_SOUTHERN, PELANGI_INTENT_TERMS);
      expect(
        intentMatches,
        formatContaminationReport('data-southern (Pelangi intents)', intentMatches),
      ).toHaveLength(0);
    });
  });

  // ── AC2: Intent name set disjointness ───────────────────────────────────

  describe('Intent name sets must be disjoint between profiles', () => {
    const makanIntents = extractIntentNames(join(DATA_MAKAN, 'intents.json'));
    const pelangiIntents = extractIntentNames(join(DATA_PELANGI, 'intents.json'));
    const southernIntents = extractIntentNames(join(DATA_SOUTHERN, 'intents.json'));

    const makanRouting = extractRoutingIntents(join(DATA_MAKAN, 'routing.json'));
    const pelangiRouting = extractRoutingIntents(join(DATA_PELANGI, 'routing.json'));

    // General/shared intents expected to appear across all profiles
    const SHARED_INTENTS = new Set([
      'greeting',
      'thanks',
      'contact_staff',
      'unknown',
      'pricing',
      'directions',
      'complaint',
      'positive_review',
      'review_feedback',
      'accessibility',
      'cancel_workflow',
      'emergency',
    ]);

    function exclusiveIntents(intents: Set<string>): Set<string> {
      const exclusive = new Set(intents);
      for (const shared of SHARED_INTENTS) {
        exclusive.delete(shared);
      }
      return exclusive;
    }

    it('Makan-exclusive intents.json categories should not overlap with Pelangi-exclusive ones', () => {
      const makanExclusive = exclusiveIntents(makanIntents);
      const pelangiExclusive = exclusiveIntents(pelangiIntents);

      const overlap = [...makanExclusive].filter((i) => pelangiExclusive.has(i));
      expect(
        overlap,
        'Overlapping intent categories between Makan and Pelangi (excluding shared): ' + overlap.join(', '),
      ).toHaveLength(0);
    });

    it('Makan routing.json intent keys should not overlap with Pelangi-exclusive routing keys', () => {
      const makanExclusive = exclusiveIntents(makanRouting);
      const pelangiExclusive = exclusiveIntents(pelangiRouting);

      const overlap = [...makanExclusive].filter((i) => pelangiExclusive.has(i));
      expect(
        overlap,
        'Overlapping routing intents between Makan and Pelangi (excluding shared): ' + overlap.join(', '),
      ).toHaveLength(0);
    });

    it('Southern-exclusive intents.json categories should not overlap with Makan-exclusive ones', () => {
      const southernExclusive = exclusiveIntents(southernIntents);
      const makanExclusive = exclusiveIntents(makanIntents);

      const overlap = [...southernExclusive].filter((i) => makanExclusive.has(i));
      expect(
        overlap,
        'Overlapping intent categories between Southern and Makan (excluding shared): ' + overlap.join(', '),
      ).toHaveLength(0);
    });

    it('Makan intent-keywords.json intents should not include Pelangi hostel-specific intents', () => {
      const makanKeywords = extractKeywordIntents(join(DATA_MAKAN, 'intent-keywords.json'));
      const hostelOnlyIntents = [
        'capsule_conflict',
        'lower_deck_preference',
        'card_locked',
        'theft_report',
        'luggage_storage',
        'late_checkout_request',
        'stay_extension',
        'extend_stay',
        'booking_modification',
        'booking_cancellation',
      ];

      const leaked = hostelOnlyIntents.filter((i) => makanKeywords.has(i));
      expect(
        leaked,
        'Pelangi hostel intents leaked into data-makan/intent-keywords.json: ' + leaked.join(', '),
      ).toHaveLength(0);
    });

    it('Southern intent-keywords.json intents should not include Makan cafe-specific intents', () => {
      const southernKeywords = extractKeywordIntents(join(DATA_SOUTHERN, 'intent-keywords.json'));
      const cafeOnlyIntents = [
        'menu_query',
        'menu_browse_category',
        'order_placement',
        'order_status',
        'vegetarian_query',
        'menu_filter_dietary',
        'budget_query',
        'specials_query',
        'food_recommendation',
        'menu_item_detail',
        'table_reservation',
        'order_feedback_rating',
        'allergen_query',
      ];

      const leaked = cafeOnlyIntents.filter((i) => southernKeywords.has(i));
      expect(
        leaked,
        'Makan cafe intents leaked into data-southern/intent-keywords.json: ' + leaked.join(', '),
      ).toHaveLength(0);
    });
  });

  // ── AC3: Contaminated file presence check ──────────────────────────────

  describe('Known contamination files must not exist', () => {
    it('data-makan/ should not contain pelangi-kb.md', () => {
      const exists = existsSync(join(DATA_MAKAN, 'pelangi-kb.md'));
      expect(
        exists,
        'data-makan/pelangi-kb.md is a Pelangi knowledge base file that should not exist in the Makan profile directory',
      ).toBe(false);
    });

    it('data-southern/ should not contain pelangi-kb.md', () => {
      const exists = existsSync(join(DATA_SOUTHERN, 'pelangi-kb.md'));
      expect(
        exists,
        'data-southern/pelangi-kb.md is a Pelangi knowledge base file that should not exist in the Southern profile directory',
      ).toBe(false);
    });
  });
});
