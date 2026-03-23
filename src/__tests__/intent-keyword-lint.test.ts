/**
 * US-305: Intent Keyword Conflict Scanner — unit tests
 *
 * Validates that:
 *   1. Duplicate keywords across intents within a profile are detected
 *   2. Report format matches AC: CONFLICT: keyword "X" appears in [A, B] in profile P (remove from B to disambiguate)
 *   3. Fixture with duplicate keywords triggers exit code 1 (conflicts found)
 *   4. Clean fixture triggers exit code 0
 */

import { describe, it, expect } from 'vitest';
import {
  findIntraProfileConflicts,
  lintAllProfiles,
  formatConflictLine,
  formatHumanReport,
  loadAllProfiles,
  PROFILE_DIRS,
  type KeywordsFile,
  type KeywordConflict,
} from '../tools/intent-keyword-lint.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ── Helpers ──────────────────────────────────────────────────────────────

function makeKeywordsFile(
  intents: { intent: string; keywords: Record<string, string[]> }[],
): KeywordsFile {
  return { intents };
}

// ── findIntraProfileConflicts ────────────────────────────────────────────

describe('findIntraProfileConflicts', () => {
  it('detects keyword appearing in two intents', () => {
    const data = makeKeywordsFile([
      { intent: 'booking_request', keywords: { en: ['booking', 'reserve'] } },
      { intent: 'booking_inquiry', keywords: { en: ['booking', 'status'] } },
    ]);

    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].keyword).toBe('booking');
    expect(conflicts[0].intents).toEqual(['booking_request', 'booking_inquiry']);
    expect(conflicts[0].profile).toBe('data-pelangi');
    expect(conflicts[0].removeFrom).toBe('booking_inquiry');
  });

  it('detects multiple conflicting keywords', () => {
    const data = makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['book', 'reserve', 'price'] } },
      { intent: 'pricing', keywords: { en: ['price', 'cost', 'book'] } },
    ]);

    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');

    expect(conflicts).toHaveLength(2);
    const keywords = conflicts.map(c => c.keyword).sort();
    expect(keywords).toEqual(['book', 'price']);
  });

  it('returns empty array when no conflicts exist', () => {
    const data = makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['reserve', 'book'] } },
      { intent: 'pricing', keywords: { en: ['price', 'cost'] } },
    ]);

    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');
    expect(conflicts).toHaveLength(0);
  });

  it('normalizes keywords to lowercase for comparison', () => {
    const data = makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['Hello'] } },
      { intent: 'farewell', keywords: { en: ['hello'] } },
    ]);

    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].keyword).toBe('hello');
  });

  it('trims whitespace before comparison', () => {
    const data = makeKeywordsFile([
      { intent: 'a', keywords: { en: ['  wifi  '] } },
      { intent: 'b', keywords: { en: ['wifi'] } },
    ]);

    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].keyword).toBe('wifi');
  });

  it('detects conflicts across different language arrays', () => {
    const data = makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['book'] } },
      { intent: 'pricing', keywords: { ms: ['book'] } },
    ]);

    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].keyword).toBe('book');
  });

  it('does not duplicate intent when keyword appears in multiple langs of same intent', () => {
    const data = makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['book'], ms: ['book'] } },
      { intent: 'pricing', keywords: { en: ['book'] } },
    ]);

    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].intents).toEqual(['booking', 'pricing']);
  });

  it('detects keyword in three or more intents', () => {
    const data = makeKeywordsFile([
      { intent: 'a', keywords: { en: ['shared'] } },
      { intent: 'b', keywords: { en: ['shared'] } },
      { intent: 'c', keywords: { en: ['shared'] } },
    ]);

    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].intents).toEqual(['a', 'b', 'c']);
    expect(conflicts[0].removeFrom).toBe('c');
  });

  it('handles empty intents array', () => {
    const data = makeKeywordsFile([]);
    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');
    expect(conflicts).toHaveLength(0);
  });

  it('handles intents with empty keywords', () => {
    const data = makeKeywordsFile([
      { intent: 'a', keywords: {} },
      { intent: 'b', keywords: {} },
    ]);
    const conflicts = findIntraProfileConflicts(data, 'data-pelangi');
    expect(conflicts).toHaveLength(0);
  });
});

// ── formatConflictLine ──────────────────────────────────────────────────

describe('formatConflictLine', () => {
  it('produces the AC-specified report format', () => {
    const conflict: KeywordConflict = {
      keyword: 'booking',
      intents: ['booking_request', 'booking_inquiry'],
      profile: 'data-pelangi',
      removeFrom: 'booking_inquiry',
    };

    const line = formatConflictLine(conflict);

    expect(line).toBe(
      'CONFLICT: keyword "booking" appears in [booking_request, booking_inquiry] ' +
      'in profile data-pelangi (remove from booking_inquiry to disambiguate)',
    );
  });

  it('handles three intents in conflict', () => {
    const conflict: KeywordConflict = {
      keyword: 'price',
      intents: ['booking', 'pricing', 'general_info'],
      profile: 'data-makan',
      removeFrom: 'general_info',
    };

    const line = formatConflictLine(conflict);

    expect(line).toContain('appears in [booking, pricing, general_info]');
    expect(line).toContain('in profile data-makan');
    expect(line).toContain('remove from general_info to disambiguate');
  });
});

// ── lintAllProfiles ──────────────────────────────────────────────────────

describe('lintAllProfiles', () => {
  it('scans multiple profiles and aggregates conflicts', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('data-pelangi', makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['book'] } },
      { intent: 'pricing', keywords: { en: ['book'] } },
    ]));
    profileData.set('data-makan', makeKeywordsFile([
      { intent: 'order', keywords: { en: ['order'] } },
      { intent: 'menu', keywords: { en: ['order'] } },
    ]));

    const report = lintAllProfiles(profileData);

    expect(report.profiles_scanned).toEqual(['data-pelangi', 'data-makan']);
    expect(report.total_conflicts).toBe(2);
    expect(report.conflicts).toHaveLength(2);

    const profiles = report.conflicts.map(c => c.profile);
    expect(profiles).toContain('data-pelangi');
    expect(profiles).toContain('data-makan');
  });

  it('returns zero conflicts for clean profiles', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('data-pelangi', makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['reserve'] } },
      { intent: 'pricing', keywords: { en: ['cost'] } },
    ]));

    const report = lintAllProfiles(profileData);
    expect(report.total_conflicts).toBe(0);
    expect(report.conflicts).toHaveLength(0);
  });
});

// ── formatHumanReport ────────────────────────────────────────────────────

describe('formatHumanReport', () => {
  it('includes CONFLICT lines when conflicts exist', () => {
    const report = lintAllProfiles(
      new Map<string, KeywordsFile>([
        ['data-pelangi', makeKeywordsFile([
          { intent: 'booking_request', keywords: { en: ['booking'] } },
          { intent: 'booking_inquiry', keywords: { en: ['booking'] } },
        ])],
      ]),
    );

    const output = formatHumanReport(report);

    expect(output).toContain('CONFLICT:');
    expect(output).toContain('keyword "booking"');
    expect(output).toContain('[booking_request, booking_inquiry]');
    expect(output).toContain('data-pelangi');
    expect(output).toContain('remove from booking_inquiry to disambiguate');
  });

  it('shows "No cross-intent keyword conflicts" when clean', () => {
    const report = lintAllProfiles(
      new Map<string, KeywordsFile>([
        ['data-pelangi', makeKeywordsFile([
          { intent: 'booking', keywords: { en: ['reserve'] } },
        ])],
      ]),
    );

    const output = formatHumanReport(report);
    expect(output).toContain('No cross-intent keyword conflicts detected.');
  });
});

// ── AC3: Fixture with duplicate keywords asserts exit code 1 ─────────────

describe('AC3: exit code semantics', () => {
  it('fixture with duplicate keywords yields total_conflicts > 0 (exit code 1)', () => {
    const fixtureWithDuplicates = new Map<string, KeywordsFile>([
      ['data-pelangi', makeKeywordsFile([
        { intent: 'booking_request', keywords: { en: ['booking', 'reserve'] } },
        { intent: 'booking_inquiry', keywords: { en: ['booking', 'check'] } },
      ])],
    ]);

    const report = lintAllProfiles(fixtureWithDuplicates);

    // total_conflicts > 0 means the CLI would exit with code 1
    expect(report.total_conflicts).toBeGreaterThan(0);
    expect(report.total_conflicts).toBe(1);

    // Verify the specific conflict
    const conflict = report.conflicts[0];
    expect(conflict.keyword).toBe('booking');
    expect(conflict.intents).toEqual(['booking_request', 'booking_inquiry']);
    expect(conflict.removeFrom).toBe('booking_inquiry');
  });

  it('fixture without duplicates yields total_conflicts === 0 (exit code 0)', () => {
    const fixtureClean = new Map<string, KeywordsFile>([
      ['data-pelangi', makeKeywordsFile([
        { intent: 'booking', keywords: { en: ['reserve', 'book'] } },
        { intent: 'pricing', keywords: { en: ['price', 'cost'] } },
      ])],
    ]);

    const report = lintAllProfiles(fixtureClean);
    expect(report.total_conflicts).toBe(0);
  });
});

// ── PROFILE_DIRS configuration ───────────────────────────────────────────

describe('PROFILE_DIRS', () => {
  it('maps all three profiles to correct directories', () => {
    expect(PROFILE_DIRS['data-pelangi']).toBe('src/assistant/data');
    expect(PROFILE_DIRS['data-makan']).toBe('src/assistant/data-makan');
    expect(PROFILE_DIRS['data-southern']).toBe('src/assistant/data-southern');
  });
});

// ── Integration: loads real profile files ─────────────────────────────────

describe('Integration: load real profile files', () => {
  it('loads all three profile intent-keywords.json files', () => {
    const profileData = loadAllProfiles(rootDir);
    expect(profileData.size).toBe(3);
    expect(profileData.has('data-pelangi')).toBe(true);
    expect(profileData.has('data-makan')).toBe(true);
    expect(profileData.has('data-southern')).toBe(true);
  });

  it('generates a report from real profile data', () => {
    const profileData = loadAllProfiles(rootDir);
    const report = lintAllProfiles(profileData);

    expect(report.profiles_scanned).toContain('data-pelangi');
    expect(report.profiles_scanned).toContain('data-makan');
    expect(report.profiles_scanned).toContain('data-southern');
    expect(typeof report.total_conflicts).toBe('number');
    expect(Array.isArray(report.conflicts)).toBe(true);
  });

  it('all reported conflicts have valid structure', () => {
    const profileData = loadAllProfiles(rootDir);
    const report = lintAllProfiles(profileData);

    for (const c of report.conflicts) {
      expect(c.keyword).toBeTruthy();
      expect(c.intents.length).toBeGreaterThanOrEqual(2);
      expect(c.profile).toBeTruthy();
      expect(c.removeFrom).toBeTruthy();
      // removeFrom should be the last intent in the list
      expect(c.removeFrom).toBe(c.intents[c.intents.length - 1]);
    }
  });

  it('all conflict report lines match the AC format', () => {
    const profileData = loadAllProfiles(rootDir);
    const report = lintAllProfiles(profileData);

    for (const c of report.conflicts) {
      const line = formatConflictLine(c);
      expect(line).toMatch(
        /^CONFLICT: keyword ".+" appears in \[.+\] in profile .+ \(remove from .+ to disambiguate\)$/,
      );
    }
  });
});
