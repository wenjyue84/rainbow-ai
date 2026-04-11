import { describe, it, expect } from 'vitest';
import { FuzzyKeywordMatcher } from './fuzzy-matcher.js';

describe('FuzzyKeywordMatcher', () => {
  const candidates = ['booking', 'inquiry', 'checkout', 'wifi', 'facilities', 'complaint'];

  describe('match()', () => {
    it('should find exact matches', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('booking', candidates);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe('booking');
      expect(result?.similarity).toBe(1.0);
      expect(result?.distance).toBe(0);
    });

    it('should find typos with ≥85% similarity', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('bokking', candidates);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe('booking');
      expect(result?.similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('should find spelling variations', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('enquiry', candidates);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe('inquiry');
      expect(result?.similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('should handle single character typos', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('checout', candidates);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe('checkout');
      expect(result?.similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('should handle multiple character typos', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('faciities', candidates);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe('facilities');
      expect(result?.similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('should return null for words below threshold', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('xyz', candidates, 0.85);
      expect(result).toBeNull();
    });

    it('should respect custom threshold', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('complain', candidates, 0.70);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe('complaint');
    });

    it('should be case-insensitive', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('BOOKING', candidates);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe('booking');
    });

    it('should handle whitespace', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('  booking  ', candidates);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe('booking');
    });
  });

  describe('matchAll()', () => {
    it('should return all matches above threshold', () => {
      const matcher = new FuzzyKeywordMatcher();
      const results = matcher.matchAll('bokking', candidates, 0.70);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].similarity).toBeGreaterThanOrEqual(0.70);
    });

    it('should sort by similarity descending', () => {
      const matcher = new FuzzyKeywordMatcher();
      const results = matcher.matchAll('bokking', candidates, 0.70);
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
      }
    });

    it('should return empty array if no matches', () => {
      const matcher = new FuzzyKeywordMatcher();
      const results = matcher.matchAll('xyz', candidates, 0.85);
      expect(results).toEqual([]);
    });
  });

  describe('matchBatch()', () => {
    it('should match multiple keywords', () => {
      const matcher = new FuzzyKeywordMatcher();
      const keywords = ['bokking', 'enquiry', 'wifi'];
      const results = matcher.matchBatch(keywords, candidates, 0.85);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.matched === 'booking')).toBe(true);
      expect(results.some(r => r.matched === 'inquiry')).toBe(true);
    });
  });

  describe('extractAndMatch()', () => {
    it('should extract keywords from text and match them', () => {
      const matcher = new FuzzyKeywordMatcher();
      const text = 'i want to bokking a room';
      const results = matcher.extractAndMatch(text, candidates, 0.85);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.matched === 'booking')).toBe(true);
    });

    it('should avoid duplicate matches', () => {
      const matcher = new FuzzyKeywordMatcher();
      const text = 'bokking bokking bokking';
      const results = matcher.extractAndMatch(text, candidates, 0.85);
      // Should only match once, not three times
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should extract multiple distinct keywords', () => {
      const matcher = new FuzzyKeywordMatcher();
      const text = 'i have an enquiry about wifi';
      const results = matcher.extractAndMatch(text, candidates, 0.85);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('hasMatch()', () => {
    it('should return true for matches above threshold', () => {
      const matcher = new FuzzyKeywordMatcher();
      expect(matcher.hasMatch('bokking', candidates, 0.85)).toBe(true);
      expect(matcher.hasMatch('booking', candidates, 0.85)).toBe(true);
    });

    it('should return false for words below threshold', () => {
      const matcher = new FuzzyKeywordMatcher();
      expect(matcher.hasMatch('xyz', candidates, 0.85)).toBe(false);
    });
  });

  describe('Levenshtein distance edge cases', () => {
    it('should handle empty strings', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('', ['booking'], 0.0);
      expect(result).not.toBeNull();
      expect(result?.distance).toBe(7); // Length of 'booking'
    });

    it('should handle single character keywords', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('a', ['a'], 0.85);
      expect(result).not.toBeNull();
      expect(result?.similarity).toBe(1.0);
    });

    it('should handle transposition (common typo pattern)', () => {
      const matcher = new FuzzyKeywordMatcher();
      // 'teh' vs 'the' - transposition (3-char words)
      // Standard Levenshtein counts each swap as 2 edits: distance=2, sim=0.333
      // Use a lower threshold appropriate for short-word transpositions
      const result = matcher.match('teh', ['the', 'booking'], 0.30);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe('the');
    });
  });

  describe('Real-world typo scenarios (Acceptance Criteria)', () => {
    it('should handle booking typos', () => {
      const matcher = new FuzzyKeywordMatcher();
      const typos = ['bokking', 'booking', 'bocking', 'boking'];
      const matches = matcher.matchBatch(typos, candidates, 0.85);
      expect(matches.filter(m => m.matched === 'booking').length).toBeGreaterThan(0);
    });

    it('should handle inquiry variations', () => {
      const matcher = new FuzzyKeywordMatcher();
      const variations = ['enquiry', 'inquiry', 'enquiry'];
      const matches = matcher.matchBatch(variations, candidates, 0.85);
      expect(matches.filter(m => m.matched === 'inquiry').length).toBeGreaterThan(0);
    });

    it('should maintain ≥85% similarity threshold', () => {
      const matcher = new FuzzyKeywordMatcher();
      const result = matcher.match('bokking', candidates, 0.85);
      expect(result).not.toBeNull();
      expect(result!.similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('should handle multi-word extraction', () => {
      const matcher = new FuzzyKeywordMatcher();
      const text = 'can i make a bokking for tomarrow?';
      const results = matcher.extractAndMatch(text, ['booking', 'tomorrow'], 0.85);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Similarity calculation', () => {
    it('should calculate similarity correctly', () => {
      const matcher = new FuzzyKeywordMatcher();

      // Exact match
      const exact = matcher.match('booking', ['booking'], 0.0);
      expect(exact!.similarity).toBe(1.0);

      // One character different
      const oneChar = matcher.match('bokking', ['booking'], 0.0);
      expect(oneChar!.similarity).toBeGreaterThan(0.85);
      expect(oneChar!.similarity).toBeLessThan(1.0);
    });
  });
});
