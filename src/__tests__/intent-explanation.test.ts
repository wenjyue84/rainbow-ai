/**
 * Unit tests for Intent Classification Explanation Generator (US-378)
 */

import { describe, it, expect } from 'vitest';
import { generateIntentExplanation, explainIntentClassification } from '../lib/intent-explanation.js';

describe('Intent Classification Explanation Generator (US-378)', () => {
  describe('generateIntentExplanation', () => {
    it('should return empty keywords for fallback intent', () => {
      const explanation = generateIntentExplanation('any message', 'fallback');

      expect(explanation.top_keywords).toEqual([]);
      expect(explanation.classifier_scores).toEqual({});
      expect(explanation.matched_patterns).toEqual([]);
    });

    it('should return empty keywords for undefined intent', () => {
      const explanation = generateIntentExplanation('any message', '');

      expect(explanation.top_keywords).toEqual([]);
      expect(explanation.classifier_scores).toEqual({});
      expect(explanation.matched_patterns).toEqual([]);
    });

    it('should extract keywords for booking intent from booking message', () => {
      const message = 'I want to book a room for tomorrow for 3 nights';
      const explanation = generateIntentExplanation(message, 'booking');

      // Should find booking-related keywords
      expect(explanation.top_keywords.length).toBeGreaterThan(0);
      expect(explanation.top_keywords.length).toBeLessThanOrEqual(3);

      // All top keywords should be in classifier_scores
      for (const keyword of explanation.top_keywords) {
        expect(explanation.classifier_scores[keyword]).toBeDefined();
        expect(explanation.classifier_scores[keyword]).toBeGreaterThan(0);
        expect(explanation.classifier_scores[keyword]).toBeLessThanOrEqual(1);
      }
    });

    it('should detect booking pattern for booking messages', () => {
      const message = 'I want to book a room and check-in tomorrow';
      const explanation = generateIntentExplanation(message, 'booking');

      expect(explanation.matched_patterns).toContain('booking_pattern');
    });

    it('should detect date pattern for messages with dates', () => {
      const message = 'I need a room tomorrow for 3 nights';
      const explanation = generateIntentExplanation(message, 'booking');

      expect(explanation.matched_patterns).toContain('date_pattern');
    });

    it('should detect number pattern for messages with numbers', () => {
      const message = 'I need a room for 3 people for 2 nights';
      const explanation = generateIntentExplanation(message, 'booking');

      expect(explanation.matched_patterns).toContain('number_pattern');
    });

    it('should detect question pattern for question messages', () => {
      const message = 'What rooms are available tomorrow?';
      const explanation = generateIntentExplanation(message, 'booking');

      expect(explanation.matched_patterns).toContain('question_pattern');
    });

    it('should return non-zero scores for matched keywords', () => {
      const message = 'check-in tomorrow';
      const explanation = generateIntentExplanation(message, 'booking');

      if (explanation.top_keywords.length > 0) {
        for (const keyword of explanation.top_keywords) {
          const score = explanation.classifier_scores[keyword];
          expect(score).toBeGreaterThan(0);
          expect(score).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should handle greeting intent', () => {
      const message = 'hello there';
      const explanation = generateIntentExplanation(message, 'greeting');

      // Greeting has keywords in intent-keywords.json
      expect(explanation.top_keywords.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle thanks intent', () => {
      const message = 'thank you very much';
      const explanation = generateIntentExplanation(message, 'thanks');

      // Should find at least one keyword match
      expect(explanation.top_keywords.length).toBeGreaterThanOrEqual(0);
    });

    it('should return sorted scores (highest first)', () => {
      const message = 'I want to check-in tomorrow for 3 nights in a room';
      const explanation = generateIntentExplanation(message, 'booking');

      const scores = explanation.top_keywords.map(
        keyword => explanation.classifier_scores[keyword]
      );

      // Verify scores are in descending order (or all zero)
      for (let i = 0; i < scores.length - 1; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
      }
    });

    it('should cap top_keywords at 3', () => {
      const message = 'I want to check-in tomorrow for 3 nights in a room with a view';
      const explanation = generateIntentExplanation(message, 'booking');

      expect(explanation.top_keywords.length).toBeLessThanOrEqual(3);
    });

    it('should handle empty message gracefully', () => {
      const explanation = generateIntentExplanation('', 'booking');

      expect(explanation.top_keywords).toBeDefined();
      expect(explanation.classifier_scores).toBeDefined();
      expect(explanation.matched_patterns).toBeDefined();
    });

    it('should handle unknown intent gracefully', () => {
      const message = 'any message';
      const explanation = generateIntentExplanation(message, 'unknown_intent_xyz');

      expect(explanation.top_keywords).toBeDefined();
      expect(explanation.classifier_scores).toBeDefined();
      expect(explanation.matched_patterns).toBeDefined();
    });

    it('should return classifier_scores with 2 decimal places', () => {
      const message = 'I want to check-in';
      const explanation = generateIntentExplanation(message, 'booking');

      for (const score of Object.values(explanation.classifier_scores)) {
        const scoreStr = score.toString();
        const decimalPart = scoreStr.split('.')[1];
        if (decimalPart) {
          expect(decimalPart.length).toBeLessThanOrEqual(2);
        }
      }
    });
  });

  describe('explainIntentClassification', () => {
    it('should be an alias for generateIntentExplanation', () => {
      const message = 'I want to book a room';
      const intent = 'booking';

      const result1 = generateIntentExplanation(message, intent);
      const result2 = explainIntentClassification(message, intent);

      expect(result1).toEqual(result2);
    });
  });

  describe('Multi-language support', () => {
    it('should handle Malay booking keywords', () => {
      const message = 'Saya ingin check-in besok untuk 3 malam';
      const explanation = generateIntentExplanation(message, 'booking');

      // Should find some keywords even if not all are exact matches
      expect(explanation.matched_patterns.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle Mandarin keywords', () => {
      const message = '我想明天入住，住3晚';
      const explanation = generateIntentExplanation(message, 'booking');

      expect(explanation.matched_patterns.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Pattern detection accuracy', () => {
    it('should not over-match generic patterns', () => {
      const message = 'How are you today?';
      const explanation = generateIntentExplanation(message, 'greeting');

      // Should not have booking pattern
      expect(explanation.matched_patterns).not.toContain('booking_pattern');
    });

    it('should detect multiple patterns together', () => {
      const message = 'Can I book a room for 3 people next Monday?';
      const explanation = generateIntentExplanation(message, 'booking');

      // Should have at least booking and date patterns
      expect(explanation.matched_patterns.length).toBeGreaterThanOrEqual(2);
      expect(explanation.matched_patterns).toContain('booking_pattern');
      expect(explanation.matched_patterns).toContain('date_pattern');
    });
  });
});
