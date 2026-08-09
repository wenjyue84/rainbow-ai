import { describe, it, expect } from 'vitest';
import { analyzeKeywordConflicts } from '../tools/analyze-keyword-conflicts-cli.js';

interface IntentKeywordsFile {
  intents: Array<{
    intent: string;
    keywords: Record<string, string[]>;
  }>;
}

describe('Intent Keyword Overlap Conflict Analyzer', () => {
  describe('analyzeKeywordConflicts', () => {
    it('should identify keywords used by 3+ intents as high severity', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'booking_request',
            keywords: { en: ['book', 'reserve', 'booking'] },
          },
          {
            intent: 'availability',
            keywords: { en: ['available', 'book', 'rooms'] },
          },
          {
            intent: 'check_in',
            keywords: { en: ['check in', 'book', 'arrive'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const bookKeyword = result.conflicting_keywords.find((k) => k.keyword === 'book');
      expect(bookKeyword).toBeDefined();
      expect(bookKeyword!.severity).toBe('high');
      expect(bookKeyword!.intents.length).toBe(3);
    });

    it('should identify keywords used by 2 intents as medium severity', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'booking_request',
            keywords: { en: ['reserve', 'book'] },
          },
          {
            intent: 'availability',
            keywords: { en: ['reserve', 'available'] },
          },
          {
            intent: 'check_in',
            keywords: { en: ['arrive', 'check in'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const reserveKeyword = result.conflicting_keywords.find((k) => k.keyword === 'reserve');
      expect(reserveKeyword).toBeDefined();
      expect(reserveKeyword!.severity).toBe('medium');
      expect(reserveKeyword!.intents.length).toBe(2);
    });

    it('should not report keywords used by only one intent', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'booking_request',
            keywords: { en: ['exclusive_keyword_1'] },
          },
          {
            intent: 'availability',
            keywords: { en: ['exclusive_keyword_2'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      expect(result.total_conflicts).toBe(0);
      expect(result.conflicting_keywords.length).toBe(0);
    });

    it('should normalize keywords to lowercase for comparison', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'greeting',
            keywords: { en: ['Hello', 'Hi'] },
          },
          {
            intent: 'thanks',
            keywords: { en: ['HELLO', 'Thanks'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const helloKeyword = result.conflicting_keywords.find((k) => k.keyword === 'hello');
      expect(helloKeyword).toBeDefined();
      expect(helloKeyword!.intents).toContain('greeting');
      expect(helloKeyword!.intents).toContain('thanks');
    });

    it('should handle keywords across multiple languages', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'greeting',
            keywords: {
              en: ['hello'],
              ms: ['halo'],
              zh: ['你好'],
            },
          },
          {
            intent: 'thanks',
            keywords: {
              en: ['hello', 'thanks'],
              ms: ['terima kasih'],
            },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const helloKeyword = result.conflicting_keywords.find((k) => k.keyword === 'hello');
      expect(helloKeyword).toBeDefined();
      expect(helloKeyword!.intents.length).toBe(2);
    });

    it('should provide recommendations for high severity conflicts', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'booking_request',
            keywords: { en: ['book'] },
          },
          {
            intent: 'availability',
            keywords: { en: ['book'] },
          },
          {
            intent: 'check_in',
            keywords: { en: ['book'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const bookKeyword = result.conflicting_keywords.find((k) => k.keyword === 'book');
      expect(bookKeyword!.recommendation).toBeDefined();
      expect(bookKeyword!.recommendation).toContain('High overlap');
      expect(bookKeyword!.recommendation).toContain('3 intents');
    });

    it('should provide recommendations for medium severity conflicts', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'booking_request',
            keywords: { en: ['reserve'] },
          },
          {
            intent: 'availability',
            keywords: { en: ['reserve'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const reserveKeyword = result.conflicting_keywords.find((k) => k.keyword === 'reserve');
      expect(reserveKeyword!.recommendation).toBeDefined();
      expect(reserveKeyword!.recommendation).toContain('Medium overlap');
      expect(reserveKeyword!.recommendation).toContain('2 intents');
    });

    it('should sort results by severity (high first) then by number of conflicting intents', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'intent_a',
            keywords: { en: ['high_conflict', 'medium_conflict'] },
          },
          {
            intent: 'intent_b',
            keywords: { en: ['high_conflict', 'medium_conflict'] },
          },
          {
            intent: 'intent_c',
            keywords: { en: ['high_conflict'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      // First should be the 3-intent conflict (high severity)
      expect(result.conflicting_keywords[0].keyword).toBe('high_conflict');
      expect(result.conflicting_keywords[0].severity).toBe('high');
      // Second should be the 2-intent conflict (medium severity)
      expect(result.conflicting_keywords[1].keyword).toBe('medium_conflict');
      expect(result.conflicting_keywords[1].severity).toBe('medium');
    });

    it('should return correct total_conflicts count', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'greeting',
            keywords: { en: ['hi', 'hello'] },
          },
          {
            intent: 'thanks',
            keywords: { en: ['hi', 'thanks'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      // Only 'hi' is a conflict (appears in 2 intents)
      // 'hello' and 'thanks' each appear in only 1 intent
      expect(result.total_conflicts).toBe(1);
    });

    it('should trim whitespace from keywords', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'booking',
            keywords: { en: [' book ', 'reserve'] },
          },
          {
            intent: 'availability',
            keywords: { en: ['book', ' reserve  '] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const bookKeyword = result.conflicting_keywords.find((k) => k.keyword === 'book');
      expect(bookKeyword).toBeDefined();

      const reserveKeyword = result.conflicting_keywords.find((k) => k.keyword === 'reserve');
      expect(reserveKeyword).toBeDefined();
    });

    it('should handle intents with empty keywords object', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'greeting',
            keywords: { en: ['hi'] },
          },
          {
            intent: 'unknown_intent',
            keywords: {},
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      // Should handle gracefully, only 'hi' reported (no conflicts)
      expect(result.total_conflicts).toBe(0);
    });

    it('should handle empty input', () => {
      const input: IntentKeywordsFile = {
        intents: [],
      };

      const result = analyzeKeywordConflicts(input);

      expect(result.total_conflicts).toBe(0);
      expect(result.conflicting_keywords.length).toBe(0);
    });

    it('should handle intents with no keywords', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'intent_a',
            keywords: { en: ['keyword_a'] },
          },
          {
            intent: 'intent_b',
            keywords: { en: [] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      // No conflicts expected
      expect(result.total_conflicts).toBe(0);
    });

    it('should list all intents using a conflicting keyword', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'booking_request',
            keywords: { en: ['book'] },
          },
          {
            intent: 'room_availability',
            keywords: { en: ['book'] },
          },
          {
            intent: 'check_in',
            keywords: { en: ['book'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const bookKeyword = result.conflicting_keywords[0];
      expect(bookKeyword.intents).toEqual(['booking_request', 'check_in', 'room_availability']);
    });

    it('should output JSON format with conflicting_keywords and total_conflicts fields', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'greeting',
            keywords: { en: ['hi', 'hello'] },
          },
          {
            intent: 'thanks',
            keywords: { en: ['hi'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      expect(result).toHaveProperty('conflicting_keywords');
      expect(result).toHaveProperty('total_conflicts');
      expect(Array.isArray(result.conflicting_keywords)).toBe(true);
      expect(typeof result.total_conflicts).toBe('number');
    });

    it('should include keyword, intents, severity, and recommendation in output', () => {
      const input: IntentKeywordsFile = {
        intents: [
          {
            intent: 'booking_request',
            keywords: { en: ['book', 'reserve'] },
          },
          {
            intent: 'availability',
            keywords: { en: ['book'] },
          },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const bookKeyword = result.conflicting_keywords[0];

      expect(bookKeyword).toHaveProperty('keyword');
      expect(bookKeyword).toHaveProperty('intents');
      expect(bookKeyword).toHaveProperty('severity');
      expect(bookKeyword).toHaveProperty('recommendation');
      expect(typeof bookKeyword.keyword).toBe('string');
      expect(Array.isArray(bookKeyword.intents)).toBe(true);
      expect(['high', 'medium']).toContain(bookKeyword.severity);
      expect(typeof bookKeyword.recommendation).toBe('string');
    });

    it('should handle 4+ intent conflicts with high severity', () => {
      const input: IntentKeywordsFile = {
        intents: [
          { intent: 'intent_1', keywords: { en: ['shared'] } },
          { intent: 'intent_2', keywords: { en: ['shared'] } },
          { intent: 'intent_3', keywords: { en: ['shared'] } },
          { intent: 'intent_4', keywords: { en: ['shared'] } },
          { intent: 'intent_5', keywords: { en: ['unique'] } },
        ],
      };

      const result = analyzeKeywordConflicts(input);

      const sharedKeyword = result.conflicting_keywords.find((k) => k.keyword === 'shared');
      expect(sharedKeyword!.severity).toBe('high');
      expect(sharedKeyword!.intents.length).toBe(4);
    });
  });
});
