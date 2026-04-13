/**
 * Unit tests for language-specific keyword weight multipliers (US-572)
 *
 * Verifies that applyLanguageWeight correctly scales fuzzy match scores
 * based on the user's detected/preferred language and the keyword's weight fields.
 */

import { describe, it, expect } from 'vitest';
import { applyLanguageWeight, buildIntentWeightsMap } from '../../src/assistant/classifier/keyword-weights.js';

describe('applyLanguageWeight (US-572)', () => {
  const bookingKeyword = {
    text: 'book',
    en_weight: 1.0,
    ta_weight: 1.3,
    ml_weight: 1.2,
  };

  it('returns 1.3x score for Tamil language', () => {
    const base = 0.8;
    const result = applyLanguageWeight(base, 'ta', bookingKeyword);
    expect(result).toBeCloseTo(base * 1.3, 5);
  });

  it('returns 1.0x (unchanged) score for English language', () => {
    const base = 0.8;
    const result = applyLanguageWeight(base, 'en', bookingKeyword);
    expect(result).toBeCloseTo(base * 1.0, 5);
  });

  it('returns 1.2x score for Malayalam language', () => {
    const base = 0.8;
    const result = applyLanguageWeight(base, 'ml', bookingKeyword);
    expect(result).toBeCloseTo(base * 1.2, 5);
  });

  it('returns unchanged score when no weight defined for language', () => {
    const base = 0.75;
    const result = applyLanguageWeight(base, 'zh', bookingKeyword);
    expect(result).toBeCloseTo(base, 5);
  });

  it('returns unchanged score when keyword has no weight fields', () => {
    const base = 0.9;
    const result = applyLanguageWeight(base, 'ta', { text: 'reserve' });
    expect(result).toBeCloseTo(base, 5);
  });

  it('Tamil-weighted score is 1.3x higher than English-weighted score for same base', () => {
    const base = 0.7;
    const taScore = applyLanguageWeight(base, 'ta', bookingKeyword);
    const enScore = applyLanguageWeight(base, 'en', bookingKeyword);
    expect(taScore / enScore).toBeCloseTo(1.3, 5);
  });

  it('weighted scoring chooses correct intent: Tamil score crosses threshold while English does not', () => {
    // Simulate a base score just below the T2 threshold (0.7) in English
    // but above threshold after Tamil weight (0.7 * 1.3 = 0.91)
    const T2_THRESHOLD = 0.7;
    const base = 0.55; // below threshold in English

    const enScore = applyLanguageWeight(base, 'en', bookingKeyword);
    const taScore = applyLanguageWeight(base, 'ta', bookingKeyword);

    expect(enScore).toBeLessThan(T2_THRESHOLD);
    expect(taScore).toBeGreaterThanOrEqual(T2_THRESHOLD);
  });
});

describe('buildIntentWeightsMap (US-572)', () => {
  it('builds map with correct weights for weighted intents', () => {
    const mockData = {
      intents: [
        {
          intent: 'booking',
          keyword_weights: { en_weight: 1.0, ta_weight: 1.3, ml_weight: 1.2 },
          keywords: { en: ['book'], ta: ['புக்'] },
        },
        {
          intent: 'greeting',
          keywords: { en: ['hi'], ta: ['வணக்கம்'] },
          // No keyword_weights
        },
      ],
    };

    const map = buildIntentWeightsMap(mockData);

    expect(map.has('booking')).toBe(true);
    expect(map.get('booking')).toMatchObject({ ta_weight: 1.3, ml_weight: 1.2 });

    expect(map.has('greeting')).toBe(false);
  });

  it('returns empty map when no intents have keyword_weights', () => {
    const mockData = {
      intents: [
        { intent: 'greeting', keywords: { en: ['hi'] } },
      ],
    };

    const map = buildIntentWeightsMap(mockData);
    expect(map.size).toBe(0);
  });
});
