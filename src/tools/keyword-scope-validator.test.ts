/**
 * US-275: Profile Intent Keyword Scope Validator — unit tests
 *
 * Tests pure logic. Validates that:
 *   1. CLI outputs CSV with columns: profile_a,profile_b,keyword,overlap_count,risk_level
 *   2. Overlapping keywords across profiles are detected and flagged
 *   3. Shared keyword 'booking' between makan and pelangi is flagged HIGH risk
 *   4. Startup validation runs via src/lib/startup-validation.ts
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractKeywordIntentMap,
  classifyRisk,
  findKeywordScopeOverlaps,
  buildScopeReport,
  formatScopeCSV,
  loadAllProfiles,
  validateKeywordScopeOnStartup,
  PROFILE_DIRS,
  type KeywordsFile,
  type KeywordScopeOverlap,
} from './keyword-scope-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ── Helpers ──────────────────────────────────────────────────────────────

function makeKeywordsFile(
  intents: { intent: string; keywords: Record<string, string[]> }[],
): KeywordsFile {
  return { intents };
}

// ── extractKeywordIntentMap ──────────────────────────────────────────────

describe('extractKeywordIntentMap', () => {
  it('extracts keywords mapped to their intents', () => {
    const data = makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['book', 'reserve'] } },
      { intent: 'pricing', keywords: { en: ['price', 'book'] } },
    ]);

    const map = extractKeywordIntentMap(data);
    expect(map.get('book')).toEqual(new Set(['booking', 'pricing']));
    expect(map.get('reserve')).toEqual(new Set(['booking']));
    expect(map.get('price')).toEqual(new Set(['pricing']));
  });

  it('normalizes keywords to lowercase and trimmed', () => {
    const data = makeKeywordsFile([
      { intent: 'test', keywords: { en: ['  HELLO  ', 'World'] } },
    ]);

    const map = extractKeywordIntentMap(data);
    expect(map.has('hello')).toBe(true);
    expect(map.has('world')).toBe(true);
  });

  it('returns empty map for empty intents', () => {
    const data = makeKeywordsFile([]);
    const map = extractKeywordIntentMap(data);
    expect(map.size).toBe(0);
  });
});

// ── classifyRisk ─────────────────────────────────────────────────────────

describe('classifyRisk', () => {
  it('returns LOW when all intents are shared (greeting, thanks, etc.)', () => {
    const intentsA = new Set(['greeting']);
    const intentsB = new Set(['greeting']);
    expect(classifyRisk('hi', intentsA, intentsB)).toBe('LOW');
  });

  it('returns MEDIUM when only one profile has non-shared intents', () => {
    const intentsA = new Set(['greeting']);
    const intentsB = new Set(['booking']);
    expect(classifyRisk('test', intentsA, intentsB)).toBe('MEDIUM');
  });

  it('returns HIGH when both profiles have non-shared intents', () => {
    const intentsA = new Set(['booking']);
    const intentsB = new Set(['pricing']);
    expect(classifyRisk('price', intentsA, intentsB)).toBe('HIGH');
  });

  it('returns HIGH when both profiles use keyword in same non-shared intent', () => {
    const intentsA = new Set(['booking']);
    const intentsB = new Set(['booking']);
    expect(classifyRisk('booking', intentsA, intentsB)).toBe('HIGH');
  });
});

// ── findKeywordScopeOverlaps ─────────────────────────────────────────────

describe('findKeywordScopeOverlaps', () => {
  it('detects overlapping keywords between two profiles', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['booking', 'reserve'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'order_placement', keywords: { en: ['booking', 'order'] } },
    ]));

    const overlaps = findKeywordScopeOverlaps(profileData);
    expect(overlaps.length).toBeGreaterThan(0);

    const bookingOverlap = overlaps.find(o => o.keyword === 'booking');
    expect(bookingOverlap).toBeDefined();
    expect(bookingOverlap!.profile_a).toBe('pelangi');
    expect(bookingOverlap!.profile_b).toBe('makan');
  });

  it('returns empty array when no overlaps exist', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['capsule bed'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'menu_query', keywords: { en: ['nasi lemak'] } },
    ]));

    const overlaps = findKeywordScopeOverlaps(profileData);
    expect(overlaps).toHaveLength(0);
  });

  it('handles three profiles simultaneously', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'pricing', keywords: { en: ['price'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'pricing', keywords: { en: ['price'] } },
    ]));
    profileData.set('southern', makeKeywordsFile([
      { intent: 'pricing', keywords: { en: ['price'] } },
    ]));

    const overlaps = findKeywordScopeOverlaps(profileData);
    const priceOverlaps = overlaps.filter(o => o.keyword === 'price');
    // Should have 3 pairs: pelangi-makan, pelangi-southern, makan-southern
    expect(priceOverlaps).toHaveLength(3);
  });

  it('sorts results with HIGH risk first', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
      { intent: 'booking', keywords: { en: ['booking'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
      { intent: 'order_placement', keywords: { en: ['booking'] } },
    ]));

    const overlaps = findKeywordScopeOverlaps(profileData);
    expect(overlaps.length).toBeGreaterThanOrEqual(2);

    // First overlap should be HIGH (booking), second LOW (hi)
    const highIdx = overlaps.findIndex(o => o.risk_level === 'HIGH');
    const lowIdx = overlaps.findIndex(o => o.risk_level === 'LOW');
    if (highIdx !== -1 && lowIdx !== -1) {
      expect(highIdx).toBeLessThan(lowIdx);
    }
  });
});

// ── AC1: CSV output with required columns ────────────────────────────────

describe('AC1: CSV output format', () => {
  it('outputs CSV with columns: profile_a,profile_b,keyword,overlap_count,risk_level', () => {
    const csv = formatScopeCSV([]);
    const header = csv.split('\n')[0];
    expect(header).toBe('profile_a,profile_b,keyword,overlap_count,risk_level');
  });

  it('formats overlap rows correctly', () => {
    const overlaps: KeywordScopeOverlap[] = [
      {
        profile_a: 'pelangi',
        profile_b: 'makan',
        keyword: 'booking',
        overlap_count: 2,
        risk_level: 'HIGH',
      },
    ];

    const csv = formatScopeCSV(overlaps);
    const rows = csv.split('\n');
    expect(rows).toHaveLength(2); // header + 1 row
    expect(rows[1]).toBe('pelangi,makan,booking,2,HIGH');
  });

  it('escapes commas in keywords', () => {
    const overlaps: KeywordScopeOverlap[] = [
      {
        profile_a: 'pelangi',
        profile_b: 'makan',
        keyword: 'hello, world',
        overlap_count: 2,
        risk_level: 'LOW',
      },
    ];

    const csv = formatScopeCSV(overlaps);
    expect(csv).toContain('"hello, world"');
  });
});

// ── AC2: Compares across all profiles and flags overlaps ──────────────────

describe('AC2: Cross-profile comparison', () => {
  it('compares intent-keywords.json across pelangi, makan, and southern profiles', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'wifi', keywords: { en: ['wifi password'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'wifi_query', keywords: { en: ['wifi password'] } },
    ]));
    profileData.set('southern', makeKeywordsFile([
      { intent: 'wifi', keywords: { en: ['wifi password'] } },
    ]));

    const report = buildScopeReport(profileData);
    expect(report.profiles_analyzed).toEqual(['pelangi', 'makan', 'southern']);
    expect(report.total_overlaps).toBeGreaterThan(0);

    // wifi password appears in all 3 profiles -> 3 pair overlaps
    const wifiOverlaps = report.overlaps.filter(o => o.keyword === 'wifi password');
    expect(wifiOverlaps).toHaveLength(3);
  });

  it('flags overlapping keywords with correct overlap_count', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['book'] } },
      { intent: 'pricing', keywords: { en: ['book'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'order_placement', keywords: { en: ['book'] } },
    ]));

    const report = buildScopeReport(profileData);
    const bookOverlap = report.overlaps.find(o => o.keyword === 'book');
    expect(bookOverlap).toBeDefined();
    // pelangi has 'book' in 2 intents, makan in 1 -> overlap_count = 3
    expect(bookOverlap!.overlap_count).toBe(3);
  });
});

// ── AC3: Shared keyword 'booking' between makan and pelangi flagged HIGH ──

describe('AC3: booking keyword between makan and pelangi is HIGH risk', () => {
  it('flags shared keyword "booking" between makan and pelangi as HIGH risk', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'booking', keywords: { en: ['booking', 'reserve a room'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'order_placement', keywords: { en: ['booking', 'place order'] } },
    ]));

    const overlaps = findKeywordScopeOverlaps(profileData);
    const bookingOverlap = overlaps.find(o => o.keyword === 'booking');

    expect(bookingOverlap).toBeDefined();
    expect(bookingOverlap!.risk_level).toBe('HIGH');
    expect(bookingOverlap!.profile_a).toBe('pelangi');
    expect(bookingOverlap!.profile_b).toBe('makan');
  });
});

// ── AC3: Validation runs on startup via src/lib/startup-validation.ts ────

describe('AC3: startup validation integration', () => {
  it('validateKeywordScopeOnStartup returns a valid report', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const report = validateKeywordScopeOnStartup(rootDir);
      expect(report).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(report.profiles_analyzed.length).toBeGreaterThanOrEqual(2);
      expect(typeof report.total_overlaps).toBe('number');
      expect(typeof report.high_risk_count).toBe('number');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('can be imported from src/lib/startup-validation.ts', async () => {
    const mod = await import('../lib/startup-validation.js');
    expect(typeof mod.validateKeywordScopeOnStartup).toBe('function');
  });
});

// ── buildScopeReport ─────────────────────────────────────────────────────

describe('buildScopeReport', () => {
  it('builds a complete report with all required fields', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
      { intent: 'booking', keywords: { en: ['booking'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
      { intent: 'menu_query', keywords: { en: ['booking'] } },
    ]));

    const report = buildScopeReport(profileData);
    expect(report.timestamp).toBeDefined();
    expect(report.profiles_analyzed).toEqual(['pelangi', 'makan']);
    expect(report.total_overlaps).toBe(2); // 'hi' + 'booking'
    expect(report.high_risk_count).toBeGreaterThanOrEqual(1); // 'booking' is HIGH
    expect(report.low_risk_count).toBeGreaterThanOrEqual(1); // 'hi' is LOW
    expect(Array.isArray(report.overlaps)).toBe(true);
  });

  it('reports zero overlaps when profiles have unique keywords', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['capsule'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'menu_query', keywords: { en: ['nasi lemak'] } },
    ]));

    const report = buildScopeReport(profileData);
    expect(report.total_overlaps).toBe(0);
    expect(report.high_risk_count).toBe(0);
  });
});

// ── Profile dirs configuration ───────────────────────────────────────────

describe('PROFILE_DIRS', () => {
  it('maps all three profiles to correct directories', () => {
    expect(PROFILE_DIRS.pelangi).toBe('src/assistant/data');
    expect(PROFILE_DIRS.makan).toBe('src/assistant/data-makan');
    expect(PROFILE_DIRS.southern).toBe('src/assistant/data-southern');
  });
});

// ── Integration: loads real profile files ─────────────────────────────────

describe('Integration: load real profile files', () => {
  it('loads all three profile intent-keywords.json files', () => {
    const profileData = loadAllProfiles(rootDir);
    expect(profileData.size).toBe(3);
    expect(profileData.has('pelangi')).toBe(true);
    expect(profileData.has('makan')).toBe(true);
    expect(profileData.has('southern')).toBe(true);
  });

  it('generates a report from real profile data', () => {
    const profileData = loadAllProfiles(rootDir);
    const report = buildScopeReport(profileData);

    expect(report.profiles_analyzed).toEqual(['pelangi', 'makan', 'southern']);
    expect(report.total_overlaps).toBeGreaterThan(0);
    expect(Array.isArray(report.overlaps)).toBe(true);
  });

  it('produces valid CSV from real data', () => {
    const profileData = loadAllProfiles(rootDir);
    const report = buildScopeReport(profileData);
    const csv = formatScopeCSV(report.overlaps);

    const lines = csv.split('\n');
    expect(lines[0]).toBe('profile_a,profile_b,keyword,overlap_count,risk_level');

    // Each data row should have 5 comma-separated fields
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      const fields = lines[i].match(/(".*?"|[^,]+)/g);
      expect(fields).not.toBeNull();
      expect(fields!.length).toBe(5);
    }
  });
});
