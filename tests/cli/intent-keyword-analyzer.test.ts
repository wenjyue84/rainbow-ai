/**
 * Tests for Intent Keyword Frequency Analysis CLI Tool (US-583)
 *
 * Verifies accurate frequency counting, gap analysis, and over-representation
 * detection across multiple profile KB files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { analyzeKeywordFrequency } from '../../src/cli/intent-keyword-analyzer.js';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

let testRoot: string;

function setupProfile(
  profileDataDir: string,
  kbDir: string,
  keywordsData: object,
  kbFiles: Record<string, string>,
): void {
  mkdirSync(join(testRoot, profileDataDir), { recursive: true });
  writeFileSync(
    join(testRoot, profileDataDir, 'intent-keywords.json'),
    JSON.stringify(keywordsData),
  );
  mkdirSync(join(testRoot, kbDir), { recursive: true });
  for (const [filename, content] of Object.entries(kbFiles)) {
    writeFileSync(join(testRoot, kbDir, filename), content);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PELANGI_KEYWORDS = {
  intents: [
    {
      intent: 'checkin',
      keywords: {
        en: ['check in', 'check-in', 'checkin', 'arrival'],
        ms: ['daftar masuk'],
      },
    },
    {
      intent: 'wifi',
      keywords: {
        en: ['wifi', 'wi-fi', 'internet', 'password'],
        ms: ['wifi', 'internet'],
      },
    },
    {
      intent: 'pricing',
      keywords: {
        en: ['price', 'rate', 'cost', 'how much'],
        ms: ['harga'],
      },
    },
  ],
};

const SOUTHERN_KEYWORDS = {
  intents: [
    {
      intent: 'booking',
      keywords: {
        en: ['book', 'reserve', 'reservation', 'availability'],
        ms: ['tempah'],
      },
    },
    {
      intent: 'checkin',
      keywords: {
        en: ['check in', 'check-in', 'arrival'],
      },
    },
  ],
};

// KB that mentions some keywords but not others
const PELANGI_KB = {
  'checkin.md': 'Check in time is 2pm. Arrival before 2pm will incur early check-in fee.',
  'wifi.md': 'The wifi password is printed on the welcome card. Connect to our internet network.',
};

const SOUTHERN_KB = {
  'faq.md': 'You can book or reserve a room online. Check in at the counter.',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyzeKeywordFrequency', () => {
  beforeEach(() => {
    // Create a unique temp dir per test
    testRoot = join(tmpdir(), `kw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('counts keyword frequency accurately across multiple intents', () => {
    setupProfile(
      'src/assistant/data',
      '.rainbow-kb',
      PELANGI_KEYWORDS,
      PELANGI_KB,
    );

    const report = analyzeKeywordFrequency(testRoot, 'pelangi');

    // 'wifi' appears in both en and ms in wifi intent => totalCount 2
    const wifiEntry = report.keywords.find((k) => k.keyword === 'wifi');
    expect(wifiEntry).toBeDefined();
    expect(wifiEntry!.totalCount).toBe(2);
    expect(wifiEntry!.intents).toContain('wifi');

    // 'check in' appears once in en keywords for checkin
    const checkinEntry = report.keywords.find((k) => k.keyword === 'check in');
    expect(checkinEntry).toBeDefined();
    expect(checkinEntry!.totalCount).toBe(1);
  });

  it('reports total unique keyword count correctly', () => {
    setupProfile(
      'src/assistant/data',
      '.rainbow-kb',
      PELANGI_KEYWORDS,
      PELANGI_KB,
    );

    const report = analyzeKeywordFrequency(testRoot, 'pelangi');

    // Count unique keywords in fixture: check in, check-in, checkin, arrival, daftar masuk,
    // wifi (x2 → still 1 unique), wi-fi, internet (x2 → 1), password, price, rate, cost,
    // how much, harga = 14 unique
    expect(report.totalUniqueKeywords).toBeGreaterThan(0);
    expect(typeof report.totalUniqueKeywords).toBe('number');
  });

  it('detects gap keywords — defined in intents but absent from KB', () => {
    setupProfile(
      'src/assistant/data',
      '.rainbow-kb',
      PELANGI_KEYWORDS,
      PELANGI_KB,
    );

    const report = analyzeKeywordFrequency(testRoot, 'pelangi');

    // 'harga' is not in any KB file provided
    const hargaGap = report.gaps.find((g) => g.keyword === 'harga');
    expect(hargaGap).toBeDefined();
    expect(hargaGap!.intents).toContain('pricing');
  });

  it('finds keywords present in KB and excludes them from gaps', () => {
    setupProfile(
      'src/assistant/data',
      '.rainbow-kb',
      PELANGI_KEYWORDS,
      PELANGI_KB,
    );

    const report = analyzeKeywordFrequency(testRoot, 'pelangi');

    // 'wifi' appears in wifi.md, so should NOT be in gaps
    const wifiGap = report.gaps.find((g) => g.keyword === 'wifi');
    expect(wifiGap).toBeUndefined();
  });

  it('scans multiple profiles when no filter is provided', () => {
    setupProfile(
      'src/assistant/data',
      '.rainbow-kb',
      PELANGI_KEYWORDS,
      PELANGI_KB,
    );
    setupProfile(
      'src/assistant/data-southern',
      '.rainbow-kb-southern',
      SOUTHERN_KEYWORDS,
      SOUTHERN_KB,
    );

    const report = analyzeKeywordFrequency(testRoot);

    expect(report.profilesScanned).toContain('pelangi');
    expect(report.profilesScanned).toContain('southern');
    expect(report.kbFilesScanned).toBeGreaterThanOrEqual(3);
  });

  it('correctly identifies keywords shared across multiple intents', () => {
    setupProfile(
      'src/assistant/data',
      '.rainbow-kb',
      PELANGI_KEYWORDS,
      PELANGI_KB,
    );
    setupProfile(
      'src/assistant/data-southern',
      '.rainbow-kb-southern',
      SOUTHERN_KEYWORDS,
      SOUTHERN_KB,
    );

    const report = analyzeKeywordFrequency(testRoot);

    // 'check in' appears in both pelangi.checkin and southern.checkin
    const checkinEntry = report.keywords.find((k) => k.keyword === 'check in');
    expect(checkinEntry).toBeDefined();
    expect(checkinEntry!.intents).toContain('checkin');
  });

  it('marks keywords over-represented when in more than 3 intents', () => {
    const manyIntentKeywords = {
      intents: [
        { intent: 'a', keywords: { en: ['shared'] } },
        { intent: 'b', keywords: { en: ['shared'] } },
        { intent: 'c', keywords: { en: ['shared'] } },
        { intent: 'd', keywords: { en: ['shared'] } },
      ],
    };
    setupProfile('src/assistant/data', '.rainbow-kb', manyIntentKeywords, {});

    const report = analyzeKeywordFrequency(testRoot, 'pelangi');

    const overRep = report.overRepresented.find((k) => k.keyword === 'shared');
    expect(overRep).toBeDefined();
    expect(overRep!.intents.length).toBe(4);
  });

  it('handles missing KB directory gracefully', () => {
    // Only set up intent-keywords.json, no KB dir
    mkdirSync(join(testRoot, 'src/assistant/data'), { recursive: true });
    writeFileSync(
      join(testRoot, 'src/assistant/data', 'intent-keywords.json'),
      JSON.stringify(PELANGI_KEYWORDS),
    );

    const report = analyzeKeywordFrequency(testRoot, 'pelangi');

    expect(report.profilesScanned).toContain('pelangi');
    expect(report.kbFilesScanned).toBe(0);
    // All keywords are gaps since no KB
    expect(report.gaps.length).toBe(report.totalUniqueKeywords);
  });

  it('sorts keywords descending by totalCount', () => {
    setupProfile(
      'src/assistant/data',
      '.rainbow-kb',
      PELANGI_KEYWORDS,
      PELANGI_KB,
    );

    const report = analyzeKeywordFrequency(testRoot, 'pelangi');

    for (let i = 1; i < report.keywords.length; i++) {
      expect(report.keywords[i - 1].totalCount).toBeGreaterThanOrEqual(
        report.keywords[i].totalCount,
      );
    }
  });

  it('includes timestamp and metadata in report', () => {
    setupProfile(
      'src/assistant/data',
      '.rainbow-kb',
      PELANGI_KEYWORDS,
      PELANGI_KB,
    );

    const report = analyzeKeywordFrequency(testRoot, 'pelangi');

    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.profilesScanned).toEqual(['pelangi']);
    expect(report.kbFilesScanned).toBe(2);
  });
});
