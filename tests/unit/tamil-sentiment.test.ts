/**
 * US-585: Tamil Sentiment Detection Tests
 *
 * Validates TamilSentimentAnalyzer:
 * - Positive sentiment detection from Tamil words
 * - Negative sentiment detection from Tamil words
 * - Neutral/no-sentiment text handling
 * - Confidence scoring based on match counts
 * - Strong positive/negative classification
 * - Edge cases and mixed sentiments
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TamilSentimentAnalyzer,
  analyzeTamilSentiment,
  getTamilSentimentAnalyzer,
} from '../../src/lib/tamil-sentiment.js';

describe('TamilSentimentAnalyzer', () => {
  let analyzer: TamilSentimentAnalyzer;

  beforeEach(() => {
    analyzer = new TamilSentimentAnalyzer();
  });

  describe('Positive Sentiment Detection', () => {
    it('detects positive sentiment from "நன்றி" (thank you)', () => {
      const result = analyzer.analyze('நன்றி');
      expect(result.score).toBeGreaterThan(0);
      expect(result.positive).toBeGreaterThan(0);
      expect(result.negative).toBe(0);
    });

    it('detects positive sentiment from "நல்ல" (good)', () => {
      const result = analyzer.analyze('நல்ல');
      expect(result.score).toBeGreaterThan(0);
      expect(result.positive).toBeGreaterThan(0);
    });

    it('detects positive sentiment from "மிக்க நன்றி" (thank you very much)', () => {
      const result = analyzer.analyze('மிக்க நன்றி');
      expect(result.score).toBeGreaterThan(0);
      expect(result.positive).toBeGreaterThanOrEqual(1);
    });

    it('detects positive sentiment from "அருமையான" (wonderful)', () => {
      const result = analyzer.analyze('அருமையான');
      expect(result.score).toBeGreaterThan(0);
    });

    it('detects positive sentiment from multiple positive words', () => {
      const result = analyzer.analyze('நல்ல நன்றி அருமையான');
      expect(result.score).toBeGreaterThan(0);
      expect(result.positive).toBeGreaterThanOrEqual(2);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('returns score 1.0 for pure positive text', () => {
      const result = analyzer.analyze('நன்றி நல்ல');
      expect(result.score).toBe(1.0);
      expect(result.negative).toBe(0);
    });

    it('detects "சிறந்த" (excellent) as positive', () => {
      const result = analyzer.analyze('சிறந்த');
      expect(result.score).toBeGreaterThan(0);
    });

    it('detects "மகிழ்ச்சி" (happiness) as positive', () => {
      const result = analyzer.analyze('மகிழ்ச்சி');
      expect(result.score).toBeGreaterThan(0);
    });
  });

  describe('Negative Sentiment Detection', () => {
    it('detects negative sentiment from "பிரச்சனை" (problem)', () => {
      const result = analyzer.analyze('பிரச்சனை');
      expect(result.score).toBeLessThan(0);
      expect(result.negative).toBeGreaterThan(0);
      expect(result.positive).toBe(0);
    });

    it('detects negative sentiment from "தவறு" (mistake)', () => {
      const result = analyzer.analyze('தவறு');
      expect(result.score).toBeLessThan(0);
      expect(result.negative).toBeGreaterThan(0);
    });

    it('detects negative sentiment from "நோய்" (disease/pain)', () => {
      const result = analyzer.analyze('நோய்');
      expect(result.score).toBeLessThan(0);
    });

    it('detects negative sentiment from "கோபம்" (anger)', () => {
      const result = analyzer.analyze('கோபம்');
      expect(result.score).toBeLessThan(0);
    });

    it('detects negative sentiment from multiple negative words', () => {
      const result = analyzer.analyze('பிரச்சனை தவறு நோய்');
      expect(result.score).toBeLessThan(0);
      expect(result.negative).toBeGreaterThanOrEqual(2);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('returns score -1.0 for pure negative text', () => {
      const result = analyzer.analyze('பிரச்சனை நோய்');
      expect(result.score).toBe(-1.0);
      expect(result.positive).toBe(0);
    });

    it('detects "வேதனை" (suffering) as negative', () => {
      const result = analyzer.analyze('வேதனை');
      expect(result.score).toBeLessThan(0);
    });

    it('detects "மோசம்" (bad) as negative', () => {
      const result = analyzer.analyze('மோசம்');
      expect(result.score).toBeLessThan(0);
    });
  });

  describe('Neutral Sentiment Detection', () => {
    it('returns 0 score for text with no sentiment words', () => {
      const result = analyzer.analyze('அறை போதுமான');
      expect(result.score).toBe(0);
      expect(result.positive).toBe(0);
      expect(result.negative).toBe(0);
    });

    it('returns 0 confidence for neutral text', () => {
      const result = analyzer.analyze('இது ஒரு செய்தி');
      expect(result.score).toBe(0);
      expect(result.confidence).toBe(0);
    });

    it('returns 0 score for empty string', () => {
      const result = analyzer.analyze('');
      expect(result.score).toBe(0);
      expect(result.confidence).toBe(0);
    });

    it('returns 0 score for whitespace only', () => {
      const result = analyzer.analyze('   ');
      expect(result.score).toBe(0);
    });
  });

  describe('Mixed Sentiment Detection', () => {
    it('balances positive and negative words equally', () => {
      const result = analyzer.analyze('நன்றி பிரச்சனை');
      // 1 positive, 1 negative = score 0
      expect(result.score).toBe(0);
      expect(result.positive).toBe(1);
      expect(result.negative).toBe(1);
    });

    it('weighs multiple positive more than single negative', () => {
      const result = analyzer.analyze('நன்றி நல்ல சிறந்த பிரச்சனை');
      // 3 positive, 1 negative
      expect(result.score).toBeGreaterThan(0);
      expect(result.positive).toBeGreaterThan(result.negative);
    });

    it('weighs multiple negative more than single positive', () => {
      const result = analyzer.analyze('நன்றி பிரச்சனை தவறு நோய்');
      // 1 positive, 3 negative
      expect(result.score).toBeLessThan(0);
      expect(result.negative).toBeGreaterThan(result.positive);
    });
  });

  describe('Confidence Scoring', () => {
    it('returns 0 confidence for no matches', () => {
      const result = analyzer.analyze('இது ஒரு செய்தி');
      expect(result.confidence).toBe(0);
    });

    it('returns 0.3 confidence for 1 match', () => {
      const result = analyzer.analyze('நன்றி');
      expect(result.confidence).toBe(0.3);
    });

    it('returns 0.6 confidence for 2-3 matches', () => {
      const result = analyzer.analyze('நன்றி நல்ல');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.confidence).toBeLessThanOrEqual(0.6);
    });

    it('returns 0.6 confidence for exactly 3 matches', () => {
      const result = analyzer.analyze('நன்றி நல்ல சிறந்த');
      expect(result.confidence).toBe(0.6);
    });

    it('returns 0.95 confidence for 4+ matches', () => {
      const result = analyzer.analyze('நன்றி நல்ல சிறந்த அருமையான');
      expect(result.confidence).toBe(0.95);
    });

    it('returns high confidence for many negative words', () => {
      const result = analyzer.analyze('பிரச்சனை தவறு நோய் கோபம் வேதனை');
      expect(result.confidence).toBe(0.95);
    });
  });

  describe('Strong Positive/Negative Classification', () => {
    it('recognizes strong positive sentiment (>= 0.6)', () => {
      const result = analyzer.analyze('நன்றி நல்ல');
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    });

    it('isStronglyPositive returns true for "நன்றி நல்ல"', () => {
      expect(analyzer.isStronglyPositive('நன்றி நல்ல')).toBe(true);
    });

    it('isStronglyPositive returns true for single strong word "நன்றி"', () => {
      // Single positive word gives score 1.0, which is >= 0.6, so returns true
      expect(analyzer.isStronglyPositive('நன்றி')).toBe(true);
    });

    it('recognizes strong negative sentiment (<= -0.6)', () => {
      const result = analyzer.analyze('பிரச்சனை தவறு');
      expect(result.score).toBeLessThanOrEqual(-0.6);
    });

    it('isStronglyNegative returns true for "பிரச்சனை தவறு"', () => {
      expect(analyzer.isStronglyNegative('பிரச்சனை தவறு')).toBe(true);
    });

    it('isStronglyNegative returns true for single word "பிரச்சனை"', () => {
      // Single negative word gives score -1.0, which is <= -0.6, so returns true
      expect(analyzer.isStronglyNegative('பிரச்சனை')).toBe(true);
    });
  });

  describe('Real-World Booking Intent Messages', () => {
    it('detects positive sentiment in booking interest message', () => {
      const result = analyzer.analyze('நன்றி, நல்ல அறை வேண்டும்');
      expect(result.score).toBeGreaterThan(0);
      expect(result.positive).toBeGreaterThan(0);
    });

    it('detects negative sentiment in complaint message', () => {
      const result = analyzer.analyze('பிரச்சனை தவறு');
      expect(result.score).toBeLessThan(0);
      expect(result.negative).toBeGreaterThan(0);
    });

    it('detects positive sentiment in satisfaction message', () => {
      const result = analyzer.analyze('மிக்க நன்றி சிறந்த');
      expect(result.score).toBeGreaterThan(0);
      expect(analyzer.isStronglyPositive('மிக்க நன்றி சிறந்த')).toBe(true);
    });

    it('detects negative sentiment in cancellation complaint', () => {
      const result = analyzer.analyze('பிரச்சனை நோய் வேதனை');
      expect(result.score).toBeLessThan(0);
    });

    it('returns neutral for availability inquiry', () => {
      const result = analyzer.analyze('அறை கிடைக்குமா');
      expect(result.score).toBe(0);
      expect(result.confidence).toBe(0);
    });
  });

  describe('Case Sensitivity & Normalization', () => {
    it('handles Tamil text in different cases', () => {
      const result1 = analyzer.analyze('நன்றி');
      const result2 = analyzer.analyze('நன்றி');
      expect(result1.score).toBe(result2.score);
    });

    it('handles mixed case text', () => {
      const result = analyzer.analyze('நன்றி hello');
      expect(result.score).toBeGreaterThan(0);
    });

    it('handles extra whitespace', () => {
      const result1 = analyzer.analyze('நன்றி');
      const result2 = analyzer.analyze('  நன்றி  ');
      expect(result1.score).toBe(result2.score);
    });
  });

  describe('Singleton & Convenience Methods', () => {
    it('getTamilSentimentAnalyzer returns singleton instance', () => {
      const analyzer1 = getTamilSentimentAnalyzer();
      const analyzer2 = getTamilSentimentAnalyzer();
      expect(analyzer1).toBe(analyzer2);
    });

    it('analyzeTamilSentiment convenience function works', () => {
      const result = analyzeTamilSentiment('நன்றி');
      expect(result.score).toBeGreaterThan(0);
    });

    it('analyzeTamilSentiment result has all required fields', () => {
      const result = analyzeTamilSentiment('நன்றி');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('positive');
      expect(result).toHaveProperty('negative');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('language');
      expect(result.language).toBe('ta');
    });
  });

  describe('Score Clamping', () => {
    it('clamps score to maximum 1.0', () => {
      const result = analyzer.analyze('நன்றி நல்ல சிறந்த அருமையான');
      expect(result.score).toBeLessThanOrEqual(1.0);
      expect(result.score).toBeGreaterThanOrEqual(-1.0);
    });

    it('clamps score to minimum -1.0', () => {
      const result = analyzer.analyze('பிரச்சனை தவறு நோய் கோபம்');
      expect(result.score).toBeLessThanOrEqual(1.0);
      expect(result.score).toBeGreaterThanOrEqual(-1.0);
    });
  });

  describe('Edge Cases', () => {
    it('handles single character Tamil text', () => {
      const result = analyzer.analyze('ஆ');
      expect(result.score).toBe(0);
      expect(result.confidence).toBe(0);
    });

    it('handles text with special characters', () => {
      const result = analyzer.analyze('நன்றி! @#$ பிரச்சனை?');
      expect(result.score).toBeDefined();
      expect(result.positive).toBeGreaterThan(0);
      expect(result.negative).toBeGreaterThan(0);
    });

    it('handles very long text with mixed sentiments', () => {
      const longText = 'நன்றி நல்ல பிரச்சனை நல்ல நல்ல பிரச்சனை பிரச்சனை';
      const result = analyzer.analyze(longText);
      expect(result.score).toBeDefined();
      expect(result.confidence).toBe(0.95); // 8 total matches
    });

    it('analyzes same text multiple times with consistent results', () => {
      const text = 'நன்றி பிரச்சனை';
      const result1 = analyzer.analyze(text);
      const result2 = analyzer.analyze(text);
      expect(result1.score).toBe(result2.score);
      expect(result1.positive).toBe(result2.positive);
      expect(result1.negative).toBe(result2.negative);
    });
  });

  describe('Reload Functionality', () => {
    it('reloadSentiments method exists', () => {
      expect(typeof analyzer.reloadSentiments).toBe('function');
      analyzer.reloadSentiments();
    });

    it('analyzer still works after reload', () => {
      analyzer.reloadSentiments();
      const result = analyzer.analyze('நன்றி');
      expect(result.score).toBeGreaterThan(0);
    });
  });
});
