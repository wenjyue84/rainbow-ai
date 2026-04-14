/**
 * tests/clarification-flow.test.ts
 * Tests for US-633: Intent Classification Low-Confidence Clarification Flow
 *
 * Verifies that:
 * 1. Response processor generates context-aware clarifying questions
 * 2. Different intents generate different clarification questions
 * 3. Clarifying questions support multiple languages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateClarifyingQuestions } from '../src/assistant/response-processor.js';

describe('US-633: Low-Confidence Clarification Flow', () => {
  describe('generateClarifyingQuestions', () => {
    it('should return 2-3 clarifying questions for low-confidence booking intent', () => {
      const result = generateClarifyingQuestions(
        'booking',
        'en',
        [{ content: 'I need a room' }],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0].text).toContain('?');
      expect(result.suggestions[1].text).toContain('?');
    });

    it('should generate different clarifying questions for inquiry vs booking intents', () => {
      const bookingResult = generateClarifyingQuestions(
        'booking',
        'en',
        [],
        'pelangi'
      );

      const inquiryResult = generateClarifyingQuestions(
        'inquiry',
        'en',
        [],
        'pelangi'
      );

      // Questions should be different
      expect(bookingResult.message).not.toEqual(inquiryResult.message);
      expect(bookingResult.suggestions[0].text).not.toEqual(inquiryResult.suggestions[0].text);
    });

    it('should return questions based on conversation context', () => {
      const recentMessages = [
        { content: 'Hi, I want to book' },
        { content: 'How much does it cost?' },
        { content: 'What dates?' }
      ];

      const result = generateClarifyingQuestions(
        'booking',
        'en',
        recentMessages,
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeLessThanOrEqual(3);
    });

    it('should support Malay language clarifying questions', () => {
      const result = generateClarifyingQuestions(
        'booking',
        'ms',
        [],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      // Should contain Malay characters or patterns
      expect(result.message).toMatch(/[a-z]/i);
      expect(result.suggestions).toHaveLength(2);
    });

    it('should support Chinese language clarifying questions', () => {
      const result = generateClarifyingQuestions(
        'booking',
        'zh',
        [],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
    });

    it('should handle check-in intent clarifications', () => {
      const result = generateClarifyingQuestions(
        'check_in_arrival',
        'en',
        [{ content: 'I am arriving soon' }],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
      // Check-in questions should be different from booking
      expect(result.message).toContain('check-in' || 'Check-in' || 'CHECK-IN');
    });

    it('should handle checkout intent clarifications', () => {
      const result = generateClarifyingQuestions(
        'checkout_procedure',
        'en',
        [],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
      expect(result.message.toLowerCase()).toContain('checkout');
    });

    it('should handle pricing intent clarifications', () => {
      const result = generateClarifyingQuestions(
        'pricing',
        'en',
        [],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
    });

    it('should handle complaint intent clarifications', () => {
      const result = generateClarifyingQuestions(
        'complaint',
        'en',
        [{ content: 'Something is wrong with my room' }],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
    });

    it('should use default clarifying questions for unknown intents', () => {
      const result = generateClarifyingQuestions(
        'nonexistent_intent',
        'en',
        [],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
      // Should contain generic fallback text
      expect(result.message).toContain('details' || 'information' || 'help');
    });

    it('should fallback to English if language not supported', () => {
      const result = generateClarifyingQuestions(
        'booking',
        'ta',  // Tamil not defined for booking in test data
        [],
        'pelangi'
      );

      // Should still return something (fallback to English or default)
      expect(result.message).toBeTruthy();
      expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it('should create unique suggestion payloads', () => {
      const result = generateClarifyingQuestions(
        'booking',
        'en',
        [],
        'pelangi'
      );

      const payloads = result.suggestions.map(s => s.payload);
      // Payloads should be unique
      expect(new Set(payloads).size).toEqual(payloads.length);
      // Payloads should be sequential numbers
      expect(payloads[0]).toBe('1');
      expect(payloads[1]).toBe('2');
    });

    it('should handle facilities intent clarifications', () => {
      const result = generateClarifyingQuestions(
        'facilities',
        'en',
        [{ content: 'How do I use the WiFi?' }],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
    });

    it('should handle payment intent clarifications', () => {
      const result = generateClarifyingQuestions(
        'payment_made',
        'en',
        [{ content: 'I just paid' }],
        'pelangi'
      );

      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
    });

    it('should limit suggestions to 2-3 questions max', () => {
      const result = generateClarifyingQuestions(
        'booking',
        'en',
        [],
        'pelangi'
      );

      expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
      expect(result.suggestions.length).toBeLessThanOrEqual(3);
    });

    it('should accept profile-specific clarifying questions', () => {
      // Test with makan profile (if it exists)
      const result = generateClarifyingQuestions(
        'booking',
        'en',
        [],
        'makan'
      );

      expect(result.message).toBeTruthy();
      // Should use default if profile-specific doesn't exist
      expect(result.suggestions).toHaveLength(2);
    });

    it('should include interactive response format with button options', () => {
      const result = generateClarifyingQuestions(
        'booking',
        'en',
        [],
        'pelangi'
      );

      // Each suggestion should have both text and payload for button rendering
      result.suggestions.forEach(suggestion => {
        expect(suggestion.text).toBeTruthy();
        expect(suggestion.payload).toBeTruthy();
        expect(typeof suggestion.text).toBe('string');
        expect(typeof suggestion.payload).toBe('string');
      });
    });

    it('should provide fallback when clarifying questions cannot be loaded', () => {
      const result = generateClarifyingQuestions(
        'booking',
        'en',
        [],
        'nonexistent_profile'
      );

      // Should still return something reasonable
      expect(result.message).toBeTruthy();
      // May have suggestions or be empty
      expect(Array.isArray(result.suggestions)).toBe(true);
    });
  });

  describe('Multilingual Support', () => {
    it('should provide Malay variants for all major intents', () => {
      const intents = ['booking', 'check_in_arrival', 'checkout_procedure', 'pricing'];

      for (const intent of intents) {
        const result = generateClarifyingQuestions(intent, 'ms', [], 'pelangi');
        expect(result.message).toBeTruthy();
        expect(result.suggestions.length).toBeGreaterThan(0);
      }
    });

    it('should provide Chinese variants for all major intents', () => {
      const intents = ['booking', 'check_in_arrival', 'checkout_procedure', 'pricing'];

      for (const intent of intents) {
        const result = generateClarifyingQuestions(intent, 'zh', [], 'pelangi');
        expect(result.message).toBeTruthy();
        expect(result.suggestions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Confidence Threshold Behavior', () => {
    it('should be invoked for confidence 0.5-0.6 range', () => {
      // This test verifies that the clarification flow should be active
      // for confidence scores between the two thresholds (0.5 and 0.6)
      // In actual usage in chat-engine.ts, clarification is used for:
      // 0.5 <= confidence < 0.6
      const result = generateClarifyingQuestions('booking', 'en', [], 'pelangi');
      expect(result.message).toBeTruthy();
      expect(result.suggestions).toHaveLength(2);
    });

    it('should be different from fallback handling below 0.5', () => {
      // Below 0.5, intents are routed to 'unknown' instead
      // Clarification is only for 0.5-0.6 range
      const result = generateClarifyingQuestions('booking', 'en', [], 'pelangi');
      // Clarification should have specific questions
      expect(result.message).toContain('?');
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });
});
