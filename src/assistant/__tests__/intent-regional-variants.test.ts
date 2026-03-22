/**
 * US-053: Intent Regional Variants Test
 *
 * Verifies that Malaysian English and regional hospitality terms
 * are correctly matched to the booking intent with sufficient confidence.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import intentKeywordsData from '../data/intent-keywords.json' with { type: 'json' };
import { FuzzyIntentMatcher, type KeywordIntent } from '../fuzzy-matcher.js';

describe('US-053: Intent Regional Variants — Malaysian English', () => {
  let fuzzyMatcher: FuzzyIntentMatcher;

  beforeAll(() => {
    // Initialize matcher the same way as intents.ts does
    const keywordIntents: KeywordIntent[] = [];

    for (const intent of intentKeywordsData.intents) {
      for (const [lang, keywords] of Object.entries(intent.keywords)) {
        keywordIntents.push({
          intent: intent.intent,
          keywords: keywords as string[],
          language: lang as 'en' | 'ms' | 'zh' | 'ta'
        });
      }

      // Include regional variants (US-053)
      if ((intent as any).regional_variants) {
        for (const [lang, variants] of Object.entries((intent as any).regional_variants)) {
          keywordIntents.push({
            intent: intent.intent,
            keywords: variants as string[],
            language: lang as 'en' | 'ms' | 'zh' | 'ta'
          });
        }
      }
    }

    fuzzyMatcher = new FuzzyIntentMatcher(keywordIntents);
  });

  describe('regional_variants exist in intent-keywords.json', () => {
    it('booking intent has regional_variants object', () => {
      const bookingIntent = intentKeywordsData.intents.find(
        (i: any) => i.intent === 'booking'
      );
      expect(bookingIntent).toBeDefined();
      expect((bookingIntent as any).regional_variants).toBeDefined();
    });

    it('booking regional_variants has at least 20 variants', () => {
      const bookingIntent = intentKeywordsData.intents.find(
        (i: any) => i.intent === 'booking'
      );
      const variants = (bookingIntent as any).regional_variants?.en || [];
      expect(variants.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Malaysian English phrases match booking intent', () => {
    // Test data with expected minimum confidence
    const testCases = [
      {
        phrase: 'how much for 3 nites',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Malaysian spelling variant (nites vs nights)'
      },
      {
        phrase: 'can stay in flat near airport',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Malaysian English term (flat vs apartment)'
      },
      {
        phrase: 'need a flat',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Flat (Malaysian term)'
      },
      {
        phrase: 'looking for a flat',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Flat accommodation search'
      },
      {
        phrase: 'do you have flat',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Flat availability query'
      },
      {
        phrase: 'one nite stay',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Singular nite (night)'
      },
      {
        phrase: 'two nites',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Plural nites variant'
      },
      {
        phrase: 'stay in flat',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Stay in flat'
      },
      {
        phrase: 'rent a flat',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Rent flat'
      },
      {
        phrase: 'flat for stay',
        expectedIntent: 'booking',
        minConfidence: 0.75,
        description: 'Flat availability for accommodation'
      }
    ];

    for (const testCase of testCases) {
      it(`"${testCase.phrase}" → ${testCase.expectedIntent} (≥${testCase.minConfidence}) — ${testCase.description}`, () => {
        const result = fuzzyMatcher.match(testCase.phrase, 'en');

        expect(result).toBeDefined();
        expect(result!.intent).toBe(testCase.expectedIntent);
        expect(result!.score).toBeGreaterThanOrEqual(testCase.minConfidence);
      });
    }
  });

  describe('Context-aware matching with regional variants', () => {
    it('should match "flat" in booking context when preceded by booking-related message', () => {
      // After "do you have rooms?" → "flat" should still match booking
      const result = fuzzyMatcher.matchWithContext(
        'flat',
        [{ role: 'assistant', content: 'do you have rooms?' }],
        'booking',
        'en'
      );

      expect(result).toBeDefined();
      expect(result!.intent).toBe('booking');
    });

    it('should match "nites" with high confidence in standalone message', () => {
      const result = fuzzyMatcher.match('3 nites', 'en');

      expect(result).toBeDefined();
      expect(result!.intent).toBe('booking');
      expect(result!.score).toBeGreaterThanOrEqual(0.75);
    });
  });

  describe('Standard keywords still work (backward compatibility)', () => {
    it('standard "book a room" still matches with high confidence', () => {
      const result = fuzzyMatcher.match('book a room', 'en');

      expect(result).toBeDefined();
      expect(result!.intent).toBe('booking');
      expect(result!.score).toBeGreaterThanOrEqual(0.90);
    });

    it('standard "want to book" still matches', () => {
      const result = fuzzyMatcher.match('want to book', 'en');

      expect(result).toBeDefined();
      expect(result!.intent).toBe('booking');
      expect(result!.score).toBeGreaterThanOrEqual(0.90);
    });
  });
});
