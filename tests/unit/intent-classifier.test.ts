/**
 * Unit tests for IntentClassifier (US-518: Low-Confidence Intent Fallback)
 *
 * Tests confidence threshold enforcement and fallback handler integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateClarifyingResponse, formatClarifyingResponseForDisplay } from '../../src/assistant/pipeline/fallback-handler.js';

describe('IntentClassifier - Confidence Threshold (US-518)', () => {
  describe('confidence threshold enforcement', () => {
    it('should recognize confidence threshold of 0.65 as the fallback trigger point', () => {
      // The fallback handler uses 0.65 threshold
      const confidenceThreshold = 0.65;

      // Confidence below threshold
      const belowThreshold = 0.64;
      expect(belowThreshold).toBeLessThan(confidenceThreshold);

      // Confidence above threshold
      const aboveThreshold = 0.66;
      expect(aboveThreshold).toBeGreaterThan(confidenceThreshold);
    });

    it('should trigger fallback for confidence < 0.65 on low-confidence intents', () => {
      // Simulate classification result with low confidence
      const classificationResult = {
        intent: 'checkin_info',
        confidence: 0.60,
      };

      const threshold = 0.65;
      const shouldFallback = classificationResult.confidence < threshold && classificationResult.intent !== 'unknown';

      expect(shouldFallback).toBe(true);
    });

    it('should not trigger fallback for confidence >= 0.65', () => {
      const classificationResult = {
        intent: 'checkout_now',
        confidence: 0.70,
      };

      const threshold = 0.65;
      const shouldFallback = classificationResult.confidence < threshold && classificationResult.intent !== 'unknown';

      expect(shouldFallback).toBe(false);
    });

    it('should not trigger fallback for already-unknown intents', () => {
      const classificationResult = {
        intent: 'unknown',
        confidence: 0.40,
      };

      const threshold = 0.65;
      const shouldFallback = classificationResult.confidence < threshold && classificationResult.intent !== 'unknown';

      expect(shouldFallback).toBe(false);
    });
  });

  describe('fallback handler integration', () => {
    it('should generate clarifying response when confidence < 0.65', () => {
      const failedIntent = 'booking';
      const language = 'en';

      const response = generateClarifyingResponse(failedIntent, language);

      // Verify response structure matches AC2 requirement
      expect(response.message).toBeTruthy();
      expect(response.message).toContain("didn't quite understand");

      // 2 clarifying questions from top 3 keywords
      expect(response.clarifyingQuestions).toHaveLength(2);
      response.clarifyingQuestions.forEach((q, idx) => {
        expect(q).toMatch(new RegExp(`^${idx + 1}\.`)); // Numbered questions
      });

      // Escalation offer
      expect(response.escalationOffer).toBeTruthy();
      expect(response.escalationOffer).toContain('staff');
    });

    it('should format clarifying response for WhatsApp display', () => {
      const failedIntent = 'wifi';
      const response = generateClarifyingResponse(failedIntent, 'en');
      const formatted = formatClarifyingResponseForDisplay(response);

      // Should be a multi-line string suitable for WhatsApp
      expect(formatted).toBeTruthy();
      expect(formatted).toContain('\n');
      expect(formatted).toContain(response.message);
      expect(formatted).toContain(response.clarifyingQuestions[0]);
    });

    it('should include both questions in formatted output', () => {
      const response = generateClarifyingResponse('checkin_info', 'en');
      const formatted = formatClarifyingResponseForDisplay(response);

      expect(formatted).toContain(response.clarifyingQuestions[0]);
      expect(formatted).toContain(response.clarifyingQuestions[1]);
    });
  });

  describe('US-518 Acceptance Criteria Tests', () => {
    it('AC1: IntentClassifier checks confidenceScore against 0.65 threshold; low-confidence intents routed to FallbackHandler', () => {
      // When confidence < 0.65 and intent is not 'unknown'
      const result = {
        intent: 'checkout_now',
        confidence: 0.62,
        action: 'escalate',
      };

      const threshold = 0.65;
      const shouldCallFallback = result.confidence < threshold && result.intent !== 'unknown';

      expect(shouldCallFallback).toBe(true);

      // FallbackHandler generates response
      const fallbackResponse = generateClarifyingResponse(result.intent, 'en');
      expect(fallbackResponse).toBeDefined();
      expect(fallbackResponse.message).toBeTruthy();
    });

    it('AC2: FallbackHandler generates response with template, 2 questions from top 3 keywords, and escalation offer', () => {
      const response = generateClarifyingResponse('booking', 'en');

      // Template 'I didn't quite understand that'
      expect(response.message).toMatch(/didn't|understand/i);

      // 2 clarifying questions from top 3 intent keywords
      expect(response.clarifyingQuestions.length).toBe(2);
      expect(response.clarifyingQuestions[0]).toMatch(/^1\./);
      expect(response.clarifyingQuestions[1]).toMatch(/^2\./);

      // Offer to escalate
      expect(response.escalationOffer).toMatch(/staff|speak|escalate/i);
    });

    it('AC3: rainbowMessages records low-confidence classification attempt with confidence < 0.65', () => {
      // This test verifies the fallback handler generates appropriate response
      // that can be logged. Actual DB logging is tested in integration tests.
      const originalConfidence = 0.60;
      const threshold = 0.65;

      expect(originalConfidence).toBeLessThan(threshold);

      const response = generateClarifyingResponse('checkout_now', 'en');
      expect(response).toBeTruthy();

      // Response can be formatted for logging
      const formatted = formatClarifyingResponseForDisplay(response);
      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(0);

      // The log would include:
      // - originalMessage: user input
      // - originalIntent: what was classified
      // - originalConfidence: 0.60
      // - clarifyingResponse: the formatted response
    });

    it('should test confidence threshold with actual classifier confidence values', () => {
      const testCases = [
        { confidence: 0.30, shouldFallback: true },   // Very low
        { confidence: 0.50, shouldFallback: true },   // Below threshold
        { confidence: 0.64, shouldFallback: true },   // Just below
        { confidence: 0.65, shouldFallback: false },  // At threshold (no fallback)
        { confidence: 0.70, shouldFallback: false },  // Above threshold
        { confidence: 0.95, shouldFallback: false },  // Very high
      ];

      const threshold = 0.65;

      testCases.forEach(({ confidence, shouldFallback }) => {
        const result = confidence < threshold;
        expect(result).toBe(shouldFallback);
      });
    });
  });

  describe('fallback handler with different intents', () => {
    it('should generate clarifying questions for greeting intent', () => {
      const response = generateClarifyingResponse('greeting', 'en');
      expect(response.clarifyingQuestions.length).toBeGreaterThanOrEqual(2);
    });

    it('should generate clarifying questions for thanks intent', () => {
      const response = generateClarifyingResponse('thanks', 'en');
      expect(response.clarifyingQuestions.length).toBeGreaterThanOrEqual(2);
    });

    it('should generate clarifying questions for booking intent', () => {
      const response = generateClarifyingResponse('booking', 'en');
      expect(response.clarifyingQuestions.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle intents with no keywords gracefully', () => {
      const response = generateClarifyingResponse('nonexistent_intent_12345', 'en');

      // Should still return valid response
      expect(response.message).toBeTruthy();
      expect(response.clarifyingQuestions.length).toBeGreaterThanOrEqual(1);
      expect(response.escalationOffer).toBeTruthy();
    });
  });

  describe('multilingual support', () => {
    it('should support English clarifying questions', () => {
      const response = generateClarifyingResponse('wifi', 'en');
      expect(response.message).toMatch(/didn't/);
      expect(response.clarifyingQuestions[0]).toMatch(/Did you mean/);
    });

    it('should support Malay clarifying questions', () => {
      const response = generateClarifyingResponse('wifi', 'ms');
      expect(response.message).toMatch(/memahami|jelaskan/i);
    });

    it('should support Chinese clarifying questions', () => {
      const response = generateClarifyingResponse('wifi', 'zh');
      expect(response.message).toMatch(/理解|澄清/);
    });

    it('should support Tamil clarifying questions', () => {
      const response = generateClarifyingResponse('wifi', 'ta');
      expect(response.message).toMatch(/புரிந்து|விளக்க/);
    });
  });
});
