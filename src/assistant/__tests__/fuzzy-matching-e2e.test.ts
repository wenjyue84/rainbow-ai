/**
 * End-to-end tests for fuzzy keyword matching with typo tolerance
 * Tests that misspelled messages are matched with ≥85% Levenshtein distance similarity
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { FuzzyKeywordMatcher } from '../utils/fuzzy-matcher.js';
import intentKeywordsData from '../data/intent-keywords.json' with { type: 'json' };

describe('Fuzzy Keyword Matching E2E - Levenshtein Distance Typo Tolerance', () => {
  let matcher: FuzzyKeywordMatcher;
  let allKeywords: string[] = [];

  beforeAll(() => {
    // Collect all keywords from all intents
    for (const intent of intentKeywordsData.intents) {
      for (const keywordList of Object.values(intent.keywords)) {
        allKeywords.push(...(keywordList as string[]));
      }
    }

    // Also add some realistic misspelling variants for testing
    allKeywords.push('check-in', 'checkin', 'check in');

    matcher = new FuzzyKeywordMatcher();
  });

  describe('Levenshtein Distance Fuzzy Matching', () => {
    it('should match "bokking" (existing variant) with 100% similarity', () => {
      const result = matcher.match('bokking', allKeywords, 0.85);
      expect(result).not.toBeNull();
      expect(result?.similarity).toBe(1.0);
      console.log(`✓ "bokking" → "${result?.matched}" (${(result?.similarity ?? 0).toFixed(2)})`);
    });

    it('should match "bocking" → "booking" with ≥85% similarity', () => {
      const result = matcher.match('bocking', allKeywords, 0.85);
      expect(result).not.toBeNull();
      expect(result?.similarity).toBeGreaterThanOrEqual(0.85);
      console.log(`✓ "bocking" → "${result?.matched}" (${(result?.similarity ?? 0).toFixed(2)})`);
    });

    it('should match "reservtion" → "reservation" with ≥85% similarity', () => {
      const result = matcher.match('reservtion', allKeywords, 0.85);
      expect(result).not.toBeNull();
      expect(result?.similarity).toBeGreaterThanOrEqual(0.85);
      console.log(`✓ "reservtion" → "${result?.matched}" (${(result?.similarity ?? 0).toFixed(2)})`);
    });

    it('should match "chekout" → "checkout" with ≥85% similarity', () => {
      const result = matcher.match('chekout', allKeywords, 0.85);
      expect(result).not.toBeNull();
      expect(result?.similarity).toBeGreaterThanOrEqual(0.85);
      console.log(`✓ "chekout" → "${result?.matched}" (${(result?.similarity ?? 0).toFixed(2)})`);
    });

    it('should match "wifi" with 100% similarity', () => {
      const result = matcher.match('wifi', allKeywords, 0.85);
      expect(result).not.toBeNull();
      expect(result?.similarity).toBe(1.0);
      console.log(`✓ "wifi" → "${result?.matched}" (${(result?.similarity ?? 0).toFixed(2)})`);
    });

    it('should match "wify" (missing i) → "wifi" with ≥80% similarity', () => {
      const result = matcher.match('wify', allKeywords, 0.80);
      expect(result).not.toBeNull();
      expect(result?.similarity).toBeGreaterThanOrEqual(0.80);
      console.log(`✓ "wify" → "${result?.matched}" (${(result?.similarity ?? 0).toFixed(2)})`);
    });

    it('should match "faclities" → "facilities" with ≥85% similarity', () => {
      const result = matcher.match('faclities', allKeywords, 0.85);
      expect(result).not.toBeNull();
      expect(result?.similarity).toBeGreaterThanOrEqual(0.85);
      console.log(`✓ "faclities" → "${result?.matched}" (${(result?.similarity ?? 0).toFixed(2)})`);
    });

    it('should match "complaint" with 100% similarity', () => {
      const result = matcher.match('complaint', allKeywords, 0.85);
      expect(result).not.toBeNull();
      expect(result?.similarity).toBe(1.0);
      console.log(`✓ "complaint" → "${result?.matched}" (${(result?.similarity ?? 0).toFixed(2)})`);
    });
  });

  describe('Extract and Match (Word-by-Word)', () => {
    it('should find "bokking" in longer text', () => {
      const result = matcher.extractAndMatch('i want to do bokking', allKeywords, 0.85);
      expect(result.length).toBeGreaterThan(0);
      console.log(`✓ "i want to do bokking" → found "${result[0]?.matched}" (${result[0]?.similarity.toFixed(2)})`);
    });

    it('should find "bocking" in longer text', () => {
      const result = matcher.extractAndMatch('i want to do bocking', allKeywords, 0.85);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(r => r.similarity >= 0.85)).toBe(true);
      console.log(`✓ "i want to do bocking" → found matches`);
    });

    it('should find "chekout" in longer text', () => {
      const result = matcher.extractAndMatch('when is chekout time', allKeywords, 0.85);
      expect(result.length).toBeGreaterThan(0);
      console.log(`✓ "when is chekout time" → found "${result[0]?.matched}" (${result[0]?.similarity.toFixed(2)})`);
    });
  });

  describe('Accuracy Metrics - 15 Test Cases', () => {
    it('should achieve ≥90% accuracy on 15 booking/inquiry misspelled messages', () => {
      const testMessages = [
        // Booking intent typos (8 messages)
        { text: 'bokking', expected: true },
        { text: 'booking', expected: true },
        { text: 'bocking', expected: true },
        { text: 'reservtion', expected: true },
        { text: 'i want to do bokking', expected: true },
        { text: 'can i do bocking', expected: true },
        { text: 'make a reservtion', expected: true },
        { text: 'want to book', expected: true },

        // General/Facilities inquiry typos (7 messages)
        { text: 'faclities', expected: true },
        { text: 'where are faclities', expected: true },
        { text: 'wifi password', expected: true },
        { text: 'wify password', expected: true },
        { text: 'chekout time', expected: true },
        { text: 'complaint', expected: true },
        { text: 'what is the complaint policy', expected: true },
      ];

      let successCount = 0;
      const results: Array<{ text: string; matched: boolean; matchCount: number }> = [];

      for (const test of testMessages) {
        const matches = matcher.extractAndMatch(test.text, allKeywords, 0.80);
        const hasMatch = matches.length > 0;
        const success = hasMatch === test.expected;

        if (success) {
          successCount++;
        }

        results.push({
          text: test.text,
          matched: hasMatch,
          matchCount: matches.length
        });
      }

      const accuracy = successCount / testMessages.length;
      const accuracyPercent = (accuracy * 100).toFixed(1);

      console.log(`\n${'='.repeat(70)}`);
      console.log('ACCURACY SUMMARY');
      console.log(`${'='.repeat(70)}`);
      console.log(`Successful: ${successCount}/${testMessages.length}`);
      console.log(`Accuracy: ${accuracyPercent}%`);
      console.log(`${'='.repeat(70)}\n`);

      // Detailed results table
      console.log('Detailed Results:');
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const status = (r.matched === testMessages[i].expected) ? '✓' : '✗';
        const outcome = r.matched ? `found ${r.matchCount} match(es)` : 'no matches';
        console.log(`${status} "${r.text}" → ${outcome} [expected: ${testMessages[i].expected ? 'match' : 'no match'}]`);
      }

      expect(accuracy).toBeGreaterThanOrEqual(0.90);
    });
  });

  describe('Logging Capability (US-456)', () => {
    it('should create entries suitable for fuzzy-matches.jsonl logging', () => {
      const testWords = ['bokking', 'bocking', 'reservtion', 'faclities'];
      const logEntries: Array<{ original: string; matched: string; similarity: number; distance: number }> = [];

      for (const word of testWords) {
        const match = matcher.match(word, allKeywords, 0.80);
        if (match && match.similarity >= 0.85) {
          logEntries.push({
            original: match.original,
            matched: match.matched,
            similarity: match.similarity,
            distance: match.distance
          });
        }
      }

      // All entries should have required fields
      for (const entry of logEntries) {
        expect(entry.original).toBeDefined();
        expect(entry.matched).toBeDefined();
        expect(entry.similarity).toBeDefined();
        expect(entry.distance).toBeDefined();
        expect(typeof entry.similarity).toBe('number');
        expect(entry.similarity >= 0).toBe(true);
        expect(entry.similarity <= 1).toBe(true);
      }

      console.log(`\n✓ Generated ${logEntries.length} valid log entries for fuzzy-matches.jsonl`);
      logEntries.forEach(e => {
        console.log(`  - "${e.original}" → "${e.matched}" (similarity: ${(e.similarity * 100).toFixed(0)}%, distance: ${e.distance})`);
      });
    });
  });
});
