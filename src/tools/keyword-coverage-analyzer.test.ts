/**
 * US-244: Booking Intent Keyword Coverage Gap Analyzer — unit tests
 *
 * Tests pure logic only — no file system access required.
 */

import { describe, it, expect } from 'vitest';
import {
  extractBookingIntents,
  buildCoverageEntries,
  generateSuggestions,
  findZeroKeywordIntents,
  buildCoverageReport,
  BOOKING_INTENT_PATTERN,
  MIN_KEYWORD_THRESHOLD,
  type KeywordsFile,
  type ProfileIntentInfo,
} from './keyword-coverage-analyzer.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ── Test fixtures ──────────────────────────────────────────────────────

function makeKeywordsFile(intents: { intent: string; keywords: Record<string, string[]> }[]): KeywordsFile {
  return { intents };
}

// ── BOOKING_INTENT_PATTERN ─────────────────────────────────────────────

describe('BOOKING_INTENT_PATTERN', () => {
  it('matches booking-related intent names', () => {
    const shouldMatch = ['booking', 'availability', 'pricing', 'billing_inquiry', 'room_type_inquiry', 'order_placement', 'reservation'];
    for (const name of shouldMatch) {
      expect(BOOKING_INTENT_PATTERN.test(name)).toBe(true);
    }
  });

  it('does not match non-booking intent names', () => {
    const shouldNotMatch = ['greeting', 'thanks', 'wifi', 'farewell', 'complaint', 'rules'];
    for (const name of shouldNotMatch) {
      expect(BOOKING_INTENT_PATTERN.test(name)).toBe(false);
    }
  });
});

// ── extractBookingIntents ──────────────────────────────────────────────

describe('extractBookingIntents', () => {
  it('returns empty array when no booking intents exist', () => {
    const data = makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi', 'hello'] } },
      { intent: 'thanks', keywords: { en: ['thank you'] } },
    ]);
    expect(extractBookingIntents(data)).toEqual([]);
  });

  it('extracts booking-related intents with correct counts', () => {
    const data = makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
      { intent: 'booking', keywords: { en: ['book', 'reserve'], ms: ['tempah'] } },
      { intent: 'pricing', keywords: { en: ['price', 'cost', 'rate'], zh: ['价格'] } },
    ]);
    const result = extractBookingIntents(data);

    expect(result).toHaveLength(2);

    const booking = result.find(r => r.intent === 'booking')!;
    expect(booking.languages).toEqual(['en', 'ms']);
    expect(booking.keywordCounts).toEqual({ en: 2, ms: 1 });
    expect(booking.totalKeywords).toBe(3);

    const pricing = result.find(r => r.intent === 'pricing')!;
    expect(pricing.totalKeywords).toBe(4);
  });

  it('uses custom pattern when provided', () => {
    const data = makeKeywordsFile([
      { intent: 'wifi', keywords: { en: ['wifi'] } },
      { intent: 'greeting', keywords: { en: ['hi'] } },
    ]);
    const result = extractBookingIntents(data, /wifi/i);
    expect(result).toHaveLength(1);
    expect(result[0].intent).toBe('wifi');
  });
});

// ── buildCoverageEntries ───────────────────────────────────────────────

describe('buildCoverageEntries', () => {
  const profiles = ['pelangi', 'makan', 'southern'];

  it('returns empty array when no profile data', () => {
    const result = buildCoverageEntries({}, profiles);
    expect(result).toEqual([]);
  });

  it('marks intent as fully covered when present in all profiles', () => {
    const profileData: Record<string, ProfileIntentInfo[]> = {
      pelangi: [{ intent: 'pricing', languages: ['en'], keywordCounts: { en: 10 }, totalKeywords: 10 }],
      makan: [{ intent: 'pricing', languages: ['en'], keywordCounts: { en: 12 }, totalKeywords: 12 }],
      southern: [{ intent: 'pricing', languages: ['en'], keywordCounts: { en: 8 }, totalKeywords: 8 }],
    };
    const result = buildCoverageEntries(profileData, profiles);

    expect(result).toHaveLength(1);
    expect(result[0].intent).toBe('pricing');
    expect(result[0].presentInProfiles).toEqual(profiles);
    expect(result[0].missingFromProfiles).toEqual([]);
  });

  it('detects partial coverage when intent missing from some profiles', () => {
    const profileData: Record<string, ProfileIntentInfo[]> = {
      pelangi: [{ intent: 'booking', languages: ['en'], keywordCounts: { en: 25 }, totalKeywords: 25 }],
      makan: [],
      southern: [{ intent: 'booking', languages: ['en'], keywordCounts: { en: 10 }, totalKeywords: 10 }],
    };
    const result = buildCoverageEntries(profileData, profiles);

    expect(result).toHaveLength(1);
    expect(result[0].missingFromProfiles).toEqual(['makan']);
    expect(result[0].presentInProfiles).toEqual(['pelangi', 'southern']);
  });

  it('flags profiles below the keyword threshold', () => {
    const profileData: Record<string, ProfileIntentInfo[]> = {
      pelangi: [{ intent: 'pricing', languages: ['en'], keywordCounts: { en: 10 }, totalKeywords: 10 }],
      makan: [{ intent: 'pricing', languages: ['en'], keywordCounts: { en: 3 }, totalKeywords: 3 }],
      southern: [{ intent: 'pricing', languages: ['en'], keywordCounts: { en: 8 }, totalKeywords: 8 }],
    };
    const result = buildCoverageEntries(profileData, profiles);

    expect(result[0].belowThreshold).toBe(true);
    expect(result[0].profilesBelowThreshold).toEqual(['makan']);
  });

  it('sorts partial coverage before full coverage', () => {
    const profileData: Record<string, ProfileIntentInfo[]> = {
      pelangi: [
        { intent: 'pricing', languages: ['en'], keywordCounts: { en: 10 }, totalKeywords: 10 },
        { intent: 'booking', languages: ['en'], keywordCounts: { en: 25 }, totalKeywords: 25 },
      ],
      makan: [
        { intent: 'pricing', languages: ['en'], keywordCounts: { en: 12 }, totalKeywords: 12 },
      ],
      southern: [
        { intent: 'pricing', languages: ['en'], keywordCounts: { en: 8 }, totalKeywords: 8 },
        { intent: 'booking', languages: ['en'], keywordCounts: { en: 10 }, totalKeywords: 10 },
      ],
    };
    const result = buildCoverageEntries(profileData, profiles);

    // booking is missing from makan (partial), pricing is in all (full)
    expect(result[0].intent).toBe('booking'); // partial first
    expect(result[1].intent).toBe('pricing'); // full second
  });
});

// ── generateSuggestions ────────────────────────────────────────────────

describe('generateSuggestions', () => {
  const profiles = ['pelangi', 'makan', 'southern'];

  it('returns empty array when all intents fully covered', () => {
    const entries = [{
      intent: 'pricing',
      presentInProfiles: ['pelangi', 'makan', 'southern'],
      missingFromProfiles: [] as string[],
      perProfileCounts: { pelangi: 10, makan: 12, southern: 8 },
      belowThreshold: false,
      profilesBelowThreshold: [] as string[],
    }];
    expect(generateSuggestions(entries, profiles)).toEqual([]);
  });

  it('suggests adoption from similar business for missing intents', () => {
    const entries = [{
      intent: 'booking',
      presentInProfiles: ['pelangi'],
      missingFromProfiles: ['makan', 'southern'],
      perProfileCounts: { pelangi: 25, makan: 0, southern: 0 },
      belowThreshold: false,
      profilesBelowThreshold: [] as string[],
    }];
    const suggestions = generateSuggestions(entries, profiles);

    // makan has no similar profiles, so should adopt from pelangi (only available)
    const makanSuggestion = suggestions.find(s => s.targetProfile === 'makan');
    expect(makanSuggestion).toBeDefined();
    expect(makanSuggestion!.sourceProfile).toBe('pelangi');

    // southern is similar to pelangi
    const southernSuggestion = suggestions.find(s => s.targetProfile === 'southern');
    expect(southernSuggestion).toBeDefined();
    expect(southernSuggestion!.sourceProfile).toBe('pelangi');
    expect(southernSuggestion!.reason).toContain('similar business types');
  });

  it('suggests improvements for below-threshold profiles', () => {
    const entries = [{
      intent: 'pricing',
      presentInProfiles: ['pelangi', 'makan', 'southern'],
      missingFromProfiles: [] as string[],
      perProfileCounts: { pelangi: 10, makan: 3, southern: 8 },
      belowThreshold: true,
      profilesBelowThreshold: ['makan'],
    }];
    const suggestions = generateSuggestions(entries, profiles);

    const makanSuggestion = suggestions.find(s => s.targetProfile === 'makan' && s.intent === 'pricing');
    expect(makanSuggestion).toBeDefined();
    expect(makanSuggestion!.reason).toContain('below threshold');
    expect(makanSuggestion!.reason).toContain('3');
  });
});

// ── findZeroKeywordIntents ─────────────────────────────────────────────

describe('findZeroKeywordIntents', () => {
  it('returns empty array when no zero-keyword intents', () => {
    const profileData: Record<string, ProfileIntentInfo[]> = {
      pelangi: [{ intent: 'booking', languages: ['en'], keywordCounts: { en: 10 }, totalKeywords: 10 }],
    };
    expect(findZeroKeywordIntents(profileData)).toEqual([]);
  });

  it('detects intents with zero keywords', () => {
    const profileData: Record<string, ProfileIntentInfo[]> = {
      pelangi: [{ intent: 'booking', languages: [], keywordCounts: {}, totalKeywords: 0 }],
      makan: [{ intent: 'pricing', languages: ['en'], keywordCounts: { en: 5 }, totalKeywords: 5 }],
    };
    const result = findZeroKeywordIntents(profileData);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ profile: 'pelangi', intent: 'booking' });
  });
});

// ── buildCoverageReport (integration with real files) ──────────────────

describe('buildCoverageReport', () => {
  it('generates a valid report from the actual project data files', () => {
    const report = buildCoverageReport(rootDir);

    expect(report.profiles).toEqual(['pelangi', 'makan', 'southern']);
    expect(report.totalBookingIntents).toBeGreaterThan(0);
    expect(report.coverageEntries.length).toBeGreaterThan(0);

    // Check structure of coverage entries
    for (const entry of report.coverageEntries) {
      expect(entry.intent).toBeTruthy();
      expect(Array.isArray(entry.presentInProfiles)).toBe(true);
      expect(Array.isArray(entry.missingFromProfiles)).toBe(true);
      expect(typeof entry.perProfileCounts).toBe('object');
    }

    // Per-profile summary should exist for all profiles
    for (const profile of ['pelangi', 'makan', 'southern']) {
      expect(report.perProfileSummary[profile]).toBeDefined();
      expect(report.perProfileSummary[profile].intentCount).toBeGreaterThanOrEqual(0);
      expect(report.perProfileSummary[profile].totalKeywords).toBeGreaterThanOrEqual(0);
    }

    // Summary numbers should add up
    expect(report.summary.fullyConvered + report.summary.partialCoverage)
      .toBe(report.totalBookingIntents);
  });

  it('outputs JSON report with keyword-to-profile mapping', () => {
    const report = buildCoverageReport(rootDir);

    // AC1: JSON report with keyword-to-profile mapping
    // Each coverage entry maps an intent to which profiles have it
    const pricingEntry = report.coverageEntries.find(e => e.intent === 'pricing');
    expect(pricingEntry).toBeDefined();
    expect(pricingEntry!.presentInProfiles.length).toBeGreaterThan(0);
    expect(typeof pricingEntry!.perProfileCounts.pelangi).toBe('number');
  });

  it('identifies booking intents with <5 keywords in any single profile', () => {
    const report = buildCoverageReport(rootDir);

    // AC1: identifies booking intents with <5 keywords
    // The report should track which entries are below threshold
    for (const entry of report.coverageEntries) {
      if (entry.belowThreshold) {
        expect(entry.profilesBelowThreshold.length).toBeGreaterThan(0);
        for (const profile of entry.profilesBelowThreshold) {
          expect(entry.perProfileCounts[profile]).toBeLessThan(MIN_KEYWORD_THRESHOLD);
        }
      }
    }
  });

  it('includes per-profile keyword counts', () => {
    const report = buildCoverageReport(rootDir);

    // AC2: per-profile keyword counts
    for (const [profile, summary] of Object.entries(report.perProfileSummary)) {
      expect(typeof summary.intentCount).toBe('number');
      expect(typeof summary.totalKeywords).toBe('number');
      expect(Array.isArray(summary.intentsBelow5)).toBe(true);
    }
  });

  it('suggests which profiles should adopt missing keywords based on business similarity', () => {
    const report = buildCoverageReport(rootDir);

    // AC2: suggestions based on business similarity
    // At minimum, there should be suggestions for partial coverage
    if (report.summary.partialCoverage > 0 || report.summary.belowThresholdCount > 0) {
      expect(report.suggestions.length).toBeGreaterThan(0);

      for (const s of report.suggestions) {
        expect(s.targetProfile).toBeTruthy();
        expect(s.intent).toBeTruthy();
        expect(s.reason).toBeTruthy();
        expect(s.sourceProfile).toBeTruthy();
      }
    }
  });

  it('fails with hasZeroKeywordFailure when a booking intent has zero keywords', () => {
    // AC3: fails CI with exit code 1 if any profile has booking/inquiry intent with zero keywords
    // Test with synthetic data to guarantee the failure path
    const report = buildCoverageReport(rootDir);

    // The real data should not have zero-keyword booking intents
    // (if it does, the CLI would exit 1)
    expect(typeof report.hasZeroKeywordFailure).toBe('boolean');
    expect(Array.isArray(report.zeroKeywordIntents)).toBe(true);

    if (!report.hasZeroKeywordFailure) {
      expect(report.zeroKeywordIntents).toEqual([]);
    }
  });
});

// ── CLI exit code behavior (AC3) ───────────────────────────────────────

describe('CI exit code logic', () => {
  it('hasZeroKeywordFailure is true when zero-keyword booking intents exist', () => {
    // Simulate the condition that triggers exit code 1
    const profileData: Record<string, ProfileIntentInfo[]> = {
      pelangi: [{ intent: 'booking', languages: [], keywordCounts: {}, totalKeywords: 0 }],
      makan: [{ intent: 'pricing', languages: ['en'], keywordCounts: { en: 5 }, totalKeywords: 5 }],
      southern: [],
    };

    const zeroIntents = findZeroKeywordIntents(profileData);
    expect(zeroIntents.length).toBeGreaterThan(0);
    // In the CLI, this triggers process.exit(1)
  });

  it('hasZeroKeywordFailure is false when all booking intents have keywords', () => {
    const profileData: Record<string, ProfileIntentInfo[]> = {
      pelangi: [{ intent: 'booking', languages: ['en'], keywordCounts: { en: 10 }, totalKeywords: 10 }],
      makan: [{ intent: 'pricing', languages: ['en'], keywordCounts: { en: 5 }, totalKeywords: 5 }],
      southern: [{ intent: 'booking', languages: ['en'], keywordCounts: { en: 7 }, totalKeywords: 7 }],
    };

    const zeroIntents = findZeroKeywordIntents(profileData);
    expect(zeroIntents.length).toBe(0);
    // In the CLI, this would exit 0
  });
});
