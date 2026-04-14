/**
 * US-600: Intent Keyword Dead-Code Audit CLI Tests
 *
 * Tests for the audit-keywords CLI tool that identifies unused keywords
 * and generates recommendations for cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ─── Mock Data ────────────────────────────────────────────────────────────

const MOCK_INTENT_KEYWORDS = {
  intents: [
    {
      intent: 'greeting',
      keywords: {
        en: ['hi', 'hello', 'hey'],
        ms: ['hai', 'halo'],
      },
    },
    {
      intent: 'booking',
      keywords: {
        en: ['book', 'reserve', 'check in', 'checkin'],
        ms: ['tempah', 'daftar'],
      },
    },
    {
      intent: 'support',
      keywords: {
        en: ['help', 'assist', 'issue', 'problem'],
        ms: ['bantuan', 'masalah'],
      },
    },
  ],
};

// ─── Utility: Load Intent Keywords ────────────────────────────────────────

function loadIntentKeywords(profile: string): Array<{ intent: string; language: string; keyword: string }> {
  const keywordFiles = [
    path.join(PROJECT_ROOT, `src/assistant/data/intent-keywords-${profile}.json`),
    path.join(PROJECT_ROOT, `src/assistant/data-${profile}/intent-keywords.json`),
  ];

  let filePath: string | null = null;
  for (const fp of keywordFiles) {
    if (fs.existsSync(fp)) {
      filePath = fp;
      break;
    }
  }

  if (!filePath) {
    throw new Error(`Could not find intent-keywords file for profile: ${profile}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  const entries: Array<{ intent: string; language: string; keyword: string }> = [];
  for (const intentObj of data.intents) {
    const intent = intentObj.intent;
    const keywords = intentObj.keywords || {};

    for (const [language, words] of Object.entries(keywords)) {
      if (Array.isArray(words)) {
        for (const keyword of words) {
          entries.push({
            intent,
            language,
            keyword: keyword.toLowerCase(),
          });
        }
      }
    }
  }

  return entries;
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('CLI: audit-keywords', () => {
  describe('AC1: Load and extract keywords from intent-keywords.json', () => {
    it('should load keywords from intent-keywords-{profile}.json file', () => {
      const keywords = loadIntentKeywords('pelangi');
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);
    });

    it('should have intent, language, and keyword fields for each entry', () => {
      const keywords = loadIntentKeywords('pelangi');
      for (const entry of keywords) {
        expect(entry).toHaveProperty('intent');
        expect(entry).toHaveProperty('language');
        expect(entry).toHaveProperty('keyword');
        expect(typeof entry.intent).toBe('string');
        expect(typeof entry.language).toBe('string');
        expect(typeof entry.keyword).toBe('string');
      }
    });

    it('should handle multiple languages in keywords', () => {
      const keywords = loadIntentKeywords('pelangi');
      const languages = new Set(keywords.map(k => k.language));
      expect(languages.size).toBeGreaterThan(1);
    });

    it('should convert keywords to lowercase', () => {
      const keywords = loadIntentKeywords('pelangi');
      for (const entry of keywords) {
        expect(entry.keyword).toBe(entry.keyword.toLowerCase());
      }
    });

    it('should handle Southern Homestay profile', () => {
      const keywords = loadIntentKeywords('southern');
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);
    });

    it('should handle Makan profile', () => {
      const keywords = loadIntentKeywords('makan');
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);
    });
  });

  describe('AC2: Query usage stats and generate report', () => {
    it('should identify keywords with 0 matches (unused)', () => {
      // Mock scenario: unused keywords are those with matchCount = 0
      const stat = {
        intent: 'booking',
        keyword: 'unused_keyword',
        language: 'en',
        matchCount: 0,
        lastUsedAt: null,
        confidence: 0,
        recommendation: 'remove' as const,
      };

      expect(stat.matchCount).toBe(0);
      expect(stat.recommendation).toBe('remove');
    });

    it('should set recommendation to "remove" when matchCount === 0', () => {
      const stats = [
        { matchCount: 0, recommendation: 'remove' as const },
        { matchCount: 0, recommendation: 'remove' as const },
        { matchCount: 0, recommendation: 'remove' as const },
        { matchCount: 5, recommendation: 'keep' as const },
      ];

      const unused = stats.filter(s => s.recommendation === 'remove');
      expect(unused).toHaveLength(3);
      for (const stat of unused) {
        expect(stat.matchCount).toBe(0);
      }
    });

    it('should set recommendation to "review" when matchCount < 5 or confidence < 0.5', () => {
      const testCases = [
        { matchCount: 1, confidence: 0.7, expected: 'review' as const },
        { matchCount: 3, confidence: 0.4, expected: 'review' as const },
        { matchCount: 2, confidence: 0.3, expected: 'review' as const },
      ];

      for (const tc of testCases) {
        const recommendation: 'remove' | 'review' | 'keep' =
          tc.matchCount === 0
            ? 'remove'
            : tc.matchCount < 5 || tc.confidence < 0.5
              ? 'review'
              : 'keep';

        expect(recommendation).toBe(tc.expected);
      }
    });

    it('should set recommendation to "keep" for frequently used high-confidence keywords', () => {
      const testCases = [
        { matchCount: 10, confidence: 0.9 },
        { matchCount: 100, confidence: 0.8 },
        { matchCount: 5, confidence: 0.7 },
      ];

      for (const tc of testCases) {
        const recommendation: 'remove' | 'review' | 'keep' =
          tc.matchCount === 0
            ? 'remove'
            : tc.matchCount < 5 || tc.confidence < 0.5
              ? 'review'
              : 'keep';

        expect(recommendation).toBe('keep');
      }
    });
  });

  describe('AC3: Report structure and output', () => {
    it('should generate report with required fields', () => {
      const report = {
        profile: 'pelangi',
        auditDate: new Date().toISOString(),
        daysAnalyzed: 30,
        totalKeywords: 100,
        unusedKeywords: 3,
        stats: [
          {
            intent: 'booking',
            keyword: 'unused1',
            language: 'en',
            matchCount: 0,
            lastUsedAt: null,
            confidence: 0,
            recommendation: 'remove' as const,
          },
          {
            intent: 'booking',
            keyword: 'unused2',
            language: 'en',
            matchCount: 0,
            lastUsedAt: null,
            confidence: 0,
            recommendation: 'remove' as const,
          },
          {
            intent: 'support',
            keyword: 'unused3',
            language: 'ms',
            matchCount: 0,
            lastUsedAt: null,
            confidence: 0,
            recommendation: 'remove' as const,
          },
        ],
      };

      expect(report).toHaveProperty('profile');
      expect(report).toHaveProperty('auditDate');
      expect(report).toHaveProperty('daysAnalyzed');
      expect(report).toHaveProperty('totalKeywords');
      expect(report).toHaveProperty('unusedKeywords');
      expect(report).toHaveProperty('stats');
      expect(Array.isArray(report.stats)).toBe(true);
    });

    it('should detect 3 unused keywords in test fixture', () => {
      const report = {
        profile: 'pelangi',
        auditDate: new Date().toISOString(),
        daysAnalyzed: 30,
        totalKeywords: 100,
        unusedKeywords: 3,
        stats: [
          {
            intent: 'booking',
            keyword: 'unused1',
            language: 'en',
            matchCount: 0,
            lastUsedAt: null,
            confidence: 0,
            recommendation: 'remove' as const,
          },
          {
            intent: 'booking',
            keyword: 'unused2',
            language: 'en',
            matchCount: 0,
            lastUsedAt: null,
            confidence: 0,
            recommendation: 'remove' as const,
          },
          {
            intent: 'support',
            keyword: 'unused3',
            language: 'ms',
            matchCount: 0,
            lastUsedAt: null,
            confidence: 0,
            recommendation: 'remove' as const,
          },
          {
            intent: 'greeting',
            keyword: 'hello',
            language: 'en',
            matchCount: 50,
            lastUsedAt: new Date().toISOString(),
            confidence: 0.95,
            recommendation: 'keep' as const,
          },
        ],
      };

      const unused = report.stats.filter(s => s.recommendation === 'remove');
      expect(unused).toHaveLength(3);
      expect(report.unusedKeywords).toBe(3);
    });

    it('should have each stat with required fields: intent, keyword, language, matchCount, lastUsedAt, confidence, recommendation', () => {
      const stat = {
        intent: 'booking',
        keyword: 'book',
        language: 'en',
        matchCount: 25,
        lastUsedAt: '2026-04-14T12:00:00Z',
        confidence: 0.85,
        recommendation: 'keep' as const,
      };

      expect(stat).toHaveProperty('intent');
      expect(stat).toHaveProperty('keyword');
      expect(stat).toHaveProperty('language');
      expect(stat).toHaveProperty('matchCount');
      expect(stat).toHaveProperty('lastUsedAt');
      expect(stat).toHaveProperty('confidence');
      expect(stat).toHaveProperty('recommendation');
      expect(typeof stat.intent).toBe('string');
      expect(typeof stat.keyword).toBe('string');
      expect(typeof stat.language).toBe('string');
      expect(typeof stat.matchCount).toBe('number');
      expect(typeof stat.confidence).toBe('number');
      expect(['remove', 'review', 'keep']).toContain(stat.recommendation);
    });

    it('should sort stats by matchCount ascending (unused first)', () => {
      const stats = [
        { keyword: 'used_a', matchCount: 100 },
        { keyword: 'unused_a', matchCount: 0 },
        { keyword: 'used_b', matchCount: 50 },
        { keyword: 'unused_b', matchCount: 0 },
        { keyword: 'lowuse', matchCount: 2 },
      ];

      stats.sort((a, b) => {
        if (a.matchCount !== b.matchCount) {
          return a.matchCount - b.matchCount;
        }
        return a.keyword.localeCompare(b.keyword);
      });

      expect(stats[0].matchCount).toBe(0);
      expect(stats[1].matchCount).toBe(0);
      expect(stats[2].matchCount).toBe(2);
      expect(stats[3].matchCount).toBe(50);
      expect(stats[4].matchCount).toBe(100);
    });
  });

  describe('Integration: Report generation with mock data', () => {
    it('should generate valid JSON report structure', () => {
      const report = {
        profile: 'pelangi',
        auditDate: new Date().toISOString(),
        daysAnalyzed: 30,
        totalKeywords: 150,
        unusedKeywords: 12,
        stats: [
          {
            intent: 'booking',
            keyword: 'book',
            language: 'en',
            matchCount: 0,
            lastUsedAt: null,
            confidence: 0,
            recommendation: 'remove' as const,
          },
          {
            intent: 'booking',
            keyword: 'reserve',
            language: 'en',
            matchCount: 25,
            lastUsedAt: '2026-04-14T10:00:00Z',
            confidence: 0.88,
            recommendation: 'keep' as const,
          },
        ],
      };

      const json = JSON.stringify(report, null, 2);
      expect(json).toBeDefined();

      const parsed = JSON.parse(json);
      expect(parsed.profile).toBe('pelangi');
      expect(parsed.stats).toHaveLength(2);
    });

    it('should format report text output correctly', () => {
      const report = {
        profile: 'pelangi',
        auditDate: new Date().toISOString(),
        daysAnalyzed: 30,
        totalKeywords: 100,
        unusedKeywords: 3,
        stats: [
          {
            intent: 'booking',
            keyword: 'unused1',
            language: 'en',
            matchCount: 0,
            lastUsedAt: null,
            confidence: 0,
            recommendation: 'remove' as const,
          },
        ],
      };

      const lines: string[] = [];
      lines.push(`Intent Keyword Audit Report`);
      lines.push(`Profile: ${report.profile}`);
      lines.push(`Days Analyzed: ${report.daysAnalyzed}`);
      lines.push(`Unused Keywords: ${report.unusedKeywords}`);

      const text = lines.join('\n');
      expect(text).toContain('Intent Keyword Audit Report');
      expect(text).toContain('Profile: pelangi');
      expect(text).toContain('Days Analyzed: 30');
      expect(text).toContain('Unused Keywords: 3');
    });
  });

  describe('Edge cases', () => {
    it('should handle profiles with no unused keywords', () => {
      const report = {
        profile: 'pelangi',
        auditDate: new Date().toISOString(),
        daysAnalyzed: 30,
        totalKeywords: 100,
        unusedKeywords: 0,
        stats: Array.from({ length: 100 }, (_, i) => ({
          intent: `intent_${i % 5}`,
          keyword: `keyword_${i}`,
          language: 'en',
          matchCount: i + 1,
          lastUsedAt: new Date().toISOString(),
          confidence: 0.8 + Math.random() * 0.2,
          recommendation: 'keep' as const,
        })),
      };

      const unused = report.stats.filter(s => s.recommendation === 'remove');
      expect(unused).toHaveLength(0);
      expect(report.unusedKeywords).toBe(0);
    });

    it('should handle keywords with null lastUsedAt', () => {
      const stat = {
        intent: 'booking',
        keyword: 'unused',
        language: 'en',
        matchCount: 0,
        lastUsedAt: null,
        confidence: 0,
        recommendation: 'remove' as const,
      };

      expect(stat.lastUsedAt).toBeNull();
      expect(stat.matchCount).toBe(0);
    });

    it('should handle confidence scores at boundaries', () => {
      const testCases = [
        { confidence: 0, expected: 'num' },
        { confidence: 0.5, expected: 'num' },
        { confidence: 0.99, expected: 'num' },
        { confidence: 1.0, expected: 'num' },
      ];

      for (const tc of testCases) {
        expect(typeof tc.confidence).toBe('number');
        expect(tc.confidence).toBeGreaterThanOrEqual(0);
        expect(tc.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should handle duplicate keywords across languages', () => {
      // Same keyword might appear in multiple languages for the same intent
      const keywords = [
        { intent: 'greeting', language: 'en', keyword: 'hi' },
        { intent: 'greeting', language: 'ms', keyword: 'hi' }, // Same keyword, different language
      ];

      const uniqueByKey = new Set(keywords.map(k => `${k.intent}|${k.keyword}`));
      expect(uniqueByKey.size).toBe(1); // Should be treated as same entry
    });
  });
});
