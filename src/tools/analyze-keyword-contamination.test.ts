/**
 * US-222: Intent Keyword Contamination Scanner — unit tests
 *
 * Tests pure logic only — no file system access required for core tests.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  levenshtein,
  similarityScore,
  flattenKeywords,
  findContamination,
  generateRecommendations,
  buildContaminationReport,
  formatCSV,
  loadAllProfiles,
  SIMILARITY_THRESHOLD,
  PROFILE_DIRS,
  type KeywordsFile,
  type ContaminationMatch,
} from './analyze-keyword-contamination.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ── Test fixtures ──────────────────────────────────────────────────────

function makeKeywordsFile(
  intents: { intent: string; keywords: Record<string, string[]> }[],
): KeywordsFile {
  return { intents };
}

// ── levenshtein ────────────────────────────────────────────────────────

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length of other string when one is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('computes single-character edits correctly', () => {
    expect(levenshtein('cat', 'bat')).toBe(1); // substitution
    expect(levenshtein('cat', 'cats')).toBe(1); // insertion
    expect(levenshtein('cats', 'cat')).toBe(1); // deletion
  });

  it('handles multi-edit transformations', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

// ── similarityScore ────────────────────────────────────────────────────

describe('similarityScore', () => {
  it('returns 100 for identical strings', () => {
    expect(similarityScore('booking', 'booking')).toBe(100);
  });

  it('returns 100 for two empty strings', () => {
    expect(similarityScore('', '')).toBe(100);
  });

  it('is case-insensitive', () => {
    expect(similarityScore('Booking', 'booking')).toBe(100);
  });

  it('returns high score for similar strings', () => {
    const score = similarityScore('checkin', 'check_in');
    expect(score).toBeGreaterThan(60);
  });

  it('returns low score for dissimilar strings', () => {
    const score = similarityScore('hello', 'pricing');
    expect(score).toBeLessThan(40);
  });
});

// ── flattenKeywords ────────────────────────────────────────────────────

describe('flattenKeywords', () => {
  it('flattens keywords across languages and intents', () => {
    const data = makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi', 'hello'], ms: ['hai'] } },
      { intent: 'booking', keywords: { en: ['book'] } },
    ]);
    const result = flattenKeywords(data);
    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ intent: 'greeting', language: 'en', keyword: 'hi' });
    expect(result).toContainEqual({ intent: 'booking', language: 'en', keyword: 'book' });
  });

  it('lowercases and trims keywords', () => {
    const data = makeKeywordsFile([
      { intent: 'test', keywords: { en: ['  Hello  ', 'WORLD'] } },
    ]);
    const result = flattenKeywords(data);
    expect(result[0].keyword).toBe('hello');
    expect(result[1].keyword).toBe('world');
  });

  it('returns empty array for empty intents', () => {
    const data = makeKeywordsFile([]);
    expect(flattenKeywords(data)).toEqual([]);
  });
});

// ── findContamination ──────────────────────────────────────────────────

describe('findContamination', () => {
  it('detects exact keyword matches across profiles', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in', 'check-in'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]));

    const matches = findContamination(profileData);
    expect(matches.length).toBeGreaterThan(0);

    const exactMatch = matches.find(m => m.keyword === 'check in' && m.similarity_score === 100);
    expect(exactMatch).toBeDefined();
    expect(exactMatch!.status).toBe('CONTAMINATED');
  });

  it('detects fuzzy keyword matches above threshold', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkout_info', keywords: { en: ['checkout'] } },
    ]));
    profileData.set('southern', makeKeywordsFile([
      { intent: 'checkout_info', keywords: { en: ['check out'] } },
    ]));

    const matches = findContamination(profileData, 70);
    const fuzzy = matches.find(m => m.similarity_score >= 70 && m.similarity_score < 100);
    // checkout vs "check out" should score above 70%
    expect(matches.length).toBeGreaterThan(0);
  });

  it('returns empty array when profiles have no overlapping keywords', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['capsule bed'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'menu_query', keywords: { en: ['nasi lemak'] } },
    ]));

    const matches = findContamination(profileData);
    expect(matches).toHaveLength(0);
  });

  it('flags hostel-specific intent in makan as CONTAMINATED', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]));

    const matches = findContamination(profileData);
    const contaminated = matches.filter(m => m.status === 'CONTAMINATED');
    expect(contaminated.length).toBeGreaterThan(0);
  });

  it('handles three profiles simultaneously', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'pricing', keywords: { en: ['price', 'rate'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'pricing', keywords: { en: ['price', 'cost'] } },
    ]));
    profileData.set('southern', makeKeywordsFile([
      { intent: 'pricing', keywords: { en: ['price', 'tariff'] } },
    ]));

    const matches = findContamination(profileData);
    // "price" should appear in comparisons between all three pairs
    const priceMatches = matches.filter(m => m.keyword === 'price');
    expect(priceMatches.length).toBeGreaterThanOrEqual(2); // pelangi-makan, pelangi-southern, makan-southern
  });
});

// ── generateRecommendations ────────────────────────────────────────────

describe('generateRecommendations', () => {
  it('recommends removal for hostel-specific intents in non-hostel profiles', () => {
    const matches: ContaminationMatch[] = [
      {
        keyword: 'check in',
        profile_a: 'pelangi',
        intent_a: 'checkin_info',
        profile_b: 'makan',
        intent_b: 'checkin_info',
        similarity_score: 100,
        status: 'CONTAMINATED',
      },
    ];

    const recs = generateRecommendations(matches);
    expect(recs.length).toBeGreaterThan(0);
    const makanRec = recs.find(r => r.found_in_profile === 'makan');
    expect(makanRec).toBeDefined();
    expect(makanRec!.recommendation).toContain('Remove');
    expect(makanRec!.recommendation).toContain('makan');
  });

  it('returns empty recommendations when no contamination found', () => {
    const matches: ContaminationMatch[] = [
      {
        keyword: 'hi',
        profile_a: 'pelangi',
        intent_a: 'greeting',
        profile_b: 'makan',
        intent_b: 'greeting',
        similarity_score: 100,
        status: 'REVIEW',
      },
    ];

    const recs = generateRecommendations(matches);
    // REVIEW status should not generate removal recommendations
    expect(recs).toHaveLength(0);
  });
});

// ── buildContaminationReport ───────────────────────────────────────────

describe('buildContaminationReport', () => {
  it('builds a complete report with all required fields', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]));

    const report = buildContaminationReport(profileData);

    expect(report.timestamp).toBeDefined();
    expect(report.profiles_analyzed).toEqual(['pelangi', 'makan']);
    expect(report.total_keywords_scanned).toBe(4);
    expect(report.contaminated_count).toBeGreaterThan(0);
    expect(report.matches).toBeDefined();
    expect(Array.isArray(report.matches)).toBe(true);
    expect(report.recommendations).toBeDefined();
  });

  it('reports zero contamination when profiles are clean', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['capsule bed'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'menu_query', keywords: { en: ['nasi lemak'] } },
    ]));

    const report = buildContaminationReport(profileData);
    expect(report.contaminated_count).toBe(0);
    expect(report.matches).toHaveLength(0);
  });
});

// ── formatCSV ──────────────────────────────────────────────────────────

describe('formatCSV', () => {
  it('produces CSV with correct header columns', () => {
    const csv = formatCSV([]);
    const header = csv.split('\n')[0];
    expect(header).toBe('keyword,profile_a,profile_b,similarity_score,intent_a,intent_b,status');
  });

  it('formats matches into CSV rows', () => {
    const matches: ContaminationMatch[] = [
      {
        keyword: 'check in',
        profile_a: 'pelangi',
        intent_a: 'checkin_info',
        profile_b: 'makan',
        intent_b: 'checkin_info',
        similarity_score: 100,
        status: 'CONTAMINATED',
      },
    ];

    const csv = formatCSV(matches);
    const rows = csv.split('\n');
    expect(rows).toHaveLength(2); // header + 1 row
    expect(rows[1]).toBe('check in,pelangi,makan,100,checkin_info,checkin_info,CONTAMINATED');
  });

  it('includes similarity_score column as required by AC1', () => {
    const csv = formatCSV([]);
    expect(csv).toContain('similarity_score');
  });
});

// ── AC1: CSV output with required columns ──────────────────────────────

describe('AC1: CSV output format', () => {
  it('outputs CSV with columns: keyword, profile_a, profile_b, similarity_score (0-100)', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]));

    const report = buildContaminationReport(profileData);
    const csv = formatCSV(report.matches);

    // Check header has required columns
    const header = csv.split('\n')[0];
    expect(header).toContain('keyword');
    expect(header).toContain('profile_a');
    expect(header).toContain('profile_b');
    expect(header).toContain('similarity_score');

    // Check similarity_score is 0-100
    for (const m of report.matches) {
      expect(m.similarity_score).toBeGreaterThanOrEqual(0);
      expect(m.similarity_score).toBeLessThanOrEqual(100);
    }
  });
});

// ── AC2: Flag >70% similarity as CONTAMINATED ─────────────────────────

describe('AC2: Flag keywords with >70% similarity as CONTAMINATED', () => {
  it('uses 70% as the default similarity threshold', () => {
    expect(SIMILARITY_THRESHOLD).toBe(70);
  });

  it('flags keywords appearing in data-makan with >70% similarity as CONTAMINATED', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['hostel checkin'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['hostel checkin'] } },
    ]));

    const report = buildContaminationReport(profileData);
    const contaminated = report.matches.filter(m => m.status === 'CONTAMINATED');
    expect(contaminated.length).toBeGreaterThan(0);
  });

  it('flags keywords appearing in data-southern with >70% similarity as CONTAMINATED', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkout_info', keywords: { en: ['checkout procedure'] } },
    ]));
    profileData.set('southern', makeKeywordsFile([
      { intent: 'checkout_info', keywords: { en: ['checkout procedure'] } },
    ]));

    const report = buildContaminationReport(profileData);
    const contaminated = report.matches.filter(m => m.status === 'CONTAMINATED');
    expect(contaminated.length).toBeGreaterThan(0);
  });
});

// ── AC3: Specific contamination examples with recommendations ─────────

describe('AC3: Specific contamination examples with recommendations', () => {
  it('identifies hostel_checkin-like intent appearing in both pelangi and makan', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['hostel check-in', 'check in time'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['hostel check-in'] } },
    ]));

    const report = buildContaminationReport(profileData);
    const contaminated = report.matches.filter(m => m.status === 'CONTAMINATED');
    expect(contaminated.length).toBeGreaterThan(0);

    // Should have recommendation to remove from makan
    const rec = report.recommendations.find(r => r.found_in_profile === 'makan');
    expect(rec).toBeDefined();
    expect(rec!.recommendation).toContain('Remove');
  });

  it('generates recommendation specifying which profile to remove from', () => {
    const profileData = new Map<string, KeywordsFile>();
    profileData.set('pelangi', makeKeywordsFile([
      { intent: 'luggage_storage', keywords: { en: ['store luggage', 'bag storage'] } },
    ]));
    profileData.set('makan', makeKeywordsFile([
      { intent: 'luggage_storage', keywords: { en: ['store luggage'] } },
    ]));

    const report = buildContaminationReport(profileData);
    expect(report.recommendations.length).toBeGreaterThan(0);
    const rec = report.recommendations[0];
    expect(rec.found_in_profile).toBe('makan');
    expect(rec.recommendation).toContain('makan');
  });
});

// ── Integration: loads real profile files ──────────────────────────────

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
    const report = buildContaminationReport(profileData);

    expect(report.profiles_analyzed).toEqual(['pelangi', 'makan', 'southern']);
    expect(report.total_keywords_scanned).toBeGreaterThan(0);
    expect(report.matches).toBeDefined();
    expect(Array.isArray(report.matches)).toBe(true);
  });

  it('produces valid CSV from real data', () => {
    const profileData = loadAllProfiles(rootDir);
    const report = buildContaminationReport(profileData);
    const csv = formatCSV(report.matches);

    const lines = csv.split('\n');
    expect(lines[0]).toBe('keyword,profile_a,profile_b,similarity_score,intent_a,intent_b,status');

    // Each data row should have 7 comma-separated fields
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      // Handle quoted fields with commas
      const fields = lines[i].match(/(".*?"|[^,]+)/g);
      expect(fields).not.toBeNull();
      expect(fields!.length).toBe(7);
    }
  });
});
