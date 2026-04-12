/**
 * Unit tests for FallbackHandler (US-518)
 *
 * Tests the low-confidence intent fallback handler that generates
 * clarifying questions from intent keywords.
 */

import { describe, it, expect } from 'vitest';
import {
  generateClarifyingResponse,
  formatClarifyingResponseForDisplay,
} from '../../src/assistant/pipeline/fallback-handler.js';

describe('FallbackHandler (US-518)', () => {
  describe('generateClarifyingResponse', () => {
    it('should generate clarifying response with template message in English', () => {
      const response = generateClarifyingResponse('checkin_info', 'en');

      expect(response.message).toBeDefined();
      expect(response.message).toContain("didn't quite understand");
      expect(response.clarifyingQuestions).toBeDefined();
      expect(response.clarifyingQuestions.length).toBeGreaterThanOrEqual(2);
      expect(response.escalationOffer).toBeDefined();
    });

    it('should generate 2 clarifying questions from top intent keywords', () => {
      const response = generateClarifyingResponse('greeting', 'en');

      // Should have at least 2 questions
      expect(response.clarifyingQuestions.length).toBeGreaterThanOrEqual(2);

      // Questions should be numbered
      expect(response.clarifyingQuestions[0]).toMatch(/^1\./);
      expect(response.clarifyingQuestions[1]).toMatch(/^2\./);
    });

    it('should include escalation offer in response', () => {
      const response = generateClarifyingResponse('thanks', 'en');

      expect(response.escalationOffer).toContain('staff member');
    });

    it('should support multiple languages', () => {
      const langTests = [
        { lang: 'en', expectedText: "didn't" },
        { lang: 'ms', expectedText: 'memahami' },
        { lang: 'zh', expectedText: '理解' },
        { lang: 'ta', expectedText: 'புரிந்து' },
      ];

      langTests.forEach(({ lang, expectedText }) => {
        const response = generateClarifyingResponse('greeting', lang);
        expect(response.message.toLowerCase()).toContain(expectedText.toLowerCase());
      });
    });

    it('should default to English when unsupported language provided', () => {
      const response = generateClarifyingResponse('greeting', 'invalid-lang');

      expect(response.message).toContain("didn't quite understand");
    });

    it('should generate questions from top 3 keywords of intent', () => {
      const response = generateClarifyingResponse('wifi', 'en');

      // Should have keyword-based questions or generic fallback
      expect(response.clarifyingQuestions.length).toBeGreaterThanOrEqual(1);

      // Each question should be non-empty
      response.clarifyingQuestions.forEach(q => {
        expect(q).toBeTruthy();
        expect(q.length).toBeGreaterThan(0);
      });
    });

    it('should handle intents with no keywords gracefully', () => {
      // 'nonexistent_intent' should not exist in keywords
      const response = generateClarifyingResponse('nonexistent_intent_xyz', 'en');

      // Should still return valid response structure
      expect(response.message).toBeDefined();
      expect(response.clarifyingQuestions).toBeDefined();
      expect(response.escalationOffer).toBeDefined();

      // Should have at least generic question as fallback
      expect(response.clarifyingQuestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('formatClarifyingResponseForDisplay', () => {
    it('should format response as multi-line string for WhatsApp display', () => {
      const response = generateClarifyingResponse('greeting', 'en');
      const formatted = formatClarifyingResponseForDisplay(response);

      expect(formatted).toBeDefined();
      expect(formatted).toContain(response.message);
      expect(formatted).toContain(response.clarifyingQuestions[0]);
      expect(formatted).toContain(response.escalationOffer);

      // Should have newlines for formatting
      expect(formatted).toContain('\n');
    });

    it('should maintain question order in formatted output', () => {
      const response = generateClarifyingResponse('checkin_info', 'en');
      const formatted = formatClarifyingResponseForDisplay(response);

      // Message should come before questions
      const messageIndex = formatted.indexOf(response.message);
      const firstQuestionIndex = formatted.indexOf(response.clarifyingQuestions[0]);
      expect(messageIndex).toBeLessThan(firstQuestionIndex);

      // Questions should come before escalation offer
      const escalationIndex = formatted.indexOf(response.escalationOffer);
      expect(firstQuestionIndex).toBeLessThan(escalationIndex);
    });

    it('should include blank lines for readability', () => {
      const response = generateClarifyingResponse('greeting', 'en');
      const formatted = formatClarifyingResponseForDisplay(response);

      // Should have multiple line breaks (not just between each item)
      const lineCount = formatted.split('\n').length;
      expect(lineCount).toBeGreaterThan(response.clarifyingQuestions.length + 2);
    });
  });

  describe('US-518 Acceptance Criteria', () => {
    it('AC1: generateClarifyingResponse generates response with template, questions, and escalation offer', () => {
      const response = generateClarifyingResponse('checkout_now', 'en');

      // Template message
      expect(response.message).toMatch(/didn't|understand/i);

      // 2 clarifying questions from top 3 keywords
      expect(response.clarifyingQuestions).toHaveLength(2);
      response.clarifyingQuestions.forEach((q, idx) => {
        expect(q).toMatch(new RegExp(`^${idx + 1}\.`));
      });

      // Escalation offer
      expect(response.escalationOffer).toMatch(/staff|speak/i);
    });

    it('AC2: confidence < 0.65 triggers fallback path in intent-classifier', () => {
      // This AC is tested in intent-classifier.test.ts where the integration is checked
      // Here we just verify the fallback handler itself works
      const response = generateClarifyingResponse('wifi', 'en');

      expect(response).toBeDefined();
      expect(response.message).toBeTruthy();
      expect(response.clarifyingQuestions.length).toBeGreaterThanOrEqual(2);
    });

    it('AC3: rainbowMessages records low-confidence attempt with confidence < 0.65', () => {
      // This AC is tested in intent-classifier.test.ts where the logging is checked
      // Here we verify the response structure is suitable for logging
      const response = generateClarifyingResponse('booking', 'en');

      expect(response.message).toBeTruthy();
      expect(response.clarifyingQuestions).toBeDefined();
      expect(response.escalationOffer).toBeTruthy();

      // Format for display/logging
      const formatted = formatClarifyingResponseForDisplay(response);
      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(0);
    });
  });
});
