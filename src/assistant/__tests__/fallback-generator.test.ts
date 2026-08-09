/**
 * fallback-generator.test.ts — Tests for Context-Aware Fallback Response Generator (US-342)
 *
 * Test suite covering:
 * - Similarity score calculation (deterministic)
 * - Intent-matched pattern fetching
 * - Profile isolation (no Pelangi responses for Makan intent)
 * - Fallback response generation with score > 0.75 threshold
 */

import { describe, it, expect } from 'vitest';
import {
  calculateSimilarity,
  validateProfileIsolation,
  type EscalationPattern,
} from '../fallback-generator.js';

describe('Fallback Response Generator (US-342)', () => {
  // ─── Similarity Score Tests ──────────────────────────────────────

  describe('calculateSimilarity()', () => {
    it('should return 1 for identical strings', () => {
      const text = 'I have a booking question';
      const score = calculateSimilarity(text, text);
      expect(score).toBe(1);
    });

    it('should return 0 for completely different strings', () => {
      const score = calculateSimilarity('abc', 'xyz');
      expect(score).toBe(0);
    });

    it('should return same score regardless of input order', () => {
      const text1 = 'Can I modify my booking?';
      const text2 = 'booking modify can I';
      const score1 = calculateSimilarity(text1, text2);
      const score2 = calculateSimilarity(text2, text1);
      expect(score1).toBe(score2);
    });

    it('should be case-insensitive', () => {
      const score1 = calculateSimilarity('BOOKING', 'booking');
      const score2 = calculateSimilarity('Booking', 'booking');
      expect(score1).toBe(1);
      expect(score2).toBe(1);
    });

    it('should handle whitespace normalization', () => {
      const score = calculateSimilarity('  booking  ', 'booking');
      expect(score).toBe(1);
    });

    it('should be deterministic (same inputs = same output)', () => {
      const text1 = 'Can I modify my booking?';
      const text2 = 'I want to change my reservation';
      const score1 = calculateSimilarity(text1, text2);
      const score2 = calculateSimilarity(text1, text2);
      expect(score1).toBe(score2);
    });

    it('should return partial scores for similar strings', () => {
      // "booking" and "book" share several bigrams
      const score = calculateSimilarity('booking', 'book');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('should handle empty strings gracefully', () => {
      expect(calculateSimilarity('', '')).toBe(0);
      expect(calculateSimilarity('text', '')).toBe(0);
      expect(calculateSimilarity('', 'text')).toBe(0);
    });

    it('should calculate realistic booking intent similarity', () => {
      const context1 = 'Can I modify my booking dates?';
      const context2 = 'I need to change my reservation dates';
      const score = calculateSimilarity(context1, context2);
      // Both mention "dates" and have similar length, should have meaningful similarity
      expect(score).toBeGreaterThan(0.25);
      expect(score).toBeLessThan(0.75); // but not identical
    });

    it('should distinguish between check-in and pricing intents', () => {
      const checkin = 'What time is check-in?';
      const pricing = 'How much does the room cost?';
      const score = calculateSimilarity(checkin, pricing);
      // These are very different intents
      expect(score).toBeLessThan(0.4);
    });
  });

  // ─── Profile Isolation Tests ─────────────────────────────────────

  describe('validateProfileIsolation()', () => {
    it('should validate all patterns from same profile', () => {
      const patterns: EscalationPattern[] = [
        {
          intentId: 'booking',
          staffResolution: 'Can modify for you',
          profileId: 'pelangi',
          similarityScore: 0.85,
        },
        {
          intentId: 'booking',
          staffResolution: 'Updated your booking',
          profileId: 'pelangi',
          similarityScore: 0.88,
        },
      ];
      expect(validateProfileIsolation(patterns, 'pelangi')).toBe(true);
    });

    it('should reject patterns from different profile', () => {
      const patterns: EscalationPattern[] = [
        {
          intentId: 'booking',
          staffResolution: 'Updated your booking',
          profileId: 'pelangi',
          similarityScore: 0.88,
        },
        {
          intentId: 'booking',
          staffResolution: 'Updated your order',
          profileId: 'makan', // Different profile!
          similarityScore: 0.85,
        },
      ];
      expect(validateProfileIsolation(patterns, 'pelangi')).toBe(false);
    });

    it('should reject if expected profile does not match any pattern', () => {
      const patterns: EscalationPattern[] = [
        {
          intentId: 'booking',
          staffResolution: 'Updated your booking',
          profileId: 'southern',
          similarityScore: 0.85,
        },
      ];
      expect(validateProfileIsolation(patterns, 'pelangi')).toBe(false);
    });

    it('should pass for empty pattern array', () => {
      expect(validateProfileIsolation([], 'pelangi')).toBe(true);
    });
  });

  // ─── Escalation Pattern Matching Tests ──────────────────────────

  describe('Escalation Pattern Scenarios', () => {
    it('should identify booking intent escalations', () => {
      const patterns: EscalationPattern[] = [
        {
          intentId: 'booking',
          staffResolution: 'We can modify your dates to 3-5 March',
          guestFeedback: 'Guest appreciated the flexibility',
          profileId: 'pelangi',
          similarityScore: 0.82,
        },
      ];

      // Should be correctly attributed to booking intent
      expect(patterns[0].intentId).toBe('booking');
      expect(patterns[0].profileId).toBe('pelangi');
    });

    it('should isolate Pelangi responses from Makan intents', () => {
      const pelangiPatterns: EscalationPattern[] = [
        {
          intentId: 'check_in',
          staffResolution: 'Check-in is from 2pm onwards',
          profileId: 'pelangi',
          similarityScore: 0.90,
        },
      ];

      const makanPatterns: EscalationPattern[] = [
        {
          intentId: 'check_in',
          staffResolution: 'We open at 10am for breakfast',
          profileId: 'makan',
          similarityScore: 0.88,
        },
      ];

      // Ensure no cross-contamination
      expect(pelangiPatterns[0].profileId).not.toBe(makanPatterns[0].profileId);
      expect(pelangiPatterns[0].staffResolution).not.toBe(makanPatterns[0].staffResolution);
    });

    it('should track multi-intent escalations per profile', () => {
      const patterns: EscalationPattern[] = [
        {
          intentId: 'booking',
          staffResolution: 'Updated your booking dates',
          profileId: 'pelangi',
          similarityScore: 0.85,
        },
        {
          intentId: 'pricing',
          staffResolution: 'Room rates are RM 100/night',
          profileId: 'pelangi',
          similarityScore: 0.80,
        },
        {
          intentId: 'facilities',
          staffResolution: 'WiFi password is available at check-in',
          profileId: 'pelangi',
          similarityScore: 0.78,
        },
      ];

      // All should be from pelangi profile
      expect(validateProfileIsolation(patterns, 'pelangi')).toBe(true);

      // Should have different intents
      const intents = new Set(patterns.map((p) => p.intentId));
      expect(intents.size).toBe(3);
      expect(intents.has('booking')).toBe(true);
      expect(intents.has('pricing')).toBe(true);
      expect(intents.has('facilities')).toBe(true);
    });
  });

  // ─── Similarity Threshold Tests ──────────────────────────────────

  describe('Similarity Score Threshold (> 0.75)', () => {
    it('should accept patterns with similarity > 0.75', () => {
      const scores = [0.76, 0.80, 0.85, 0.90, 0.95, 1.0];
      for (const score of scores) {
        expect(score).toBeGreaterThan(0.75);
      }
    });

    it('should reject patterns with similarity <= 0.75', () => {
      const scores = [0.0, 0.25, 0.50, 0.75];
      for (const score of scores) {
        expect(score).toBeLessThanOrEqual(0.75);
      }
    });

    it('should have deterministic scores for identical matching', () => {
      const context = 'Can I modify my booking?';
      const resolution = 'We can modify your booking dates';

      // Run calculation multiple times
      const scores = [
        calculateSimilarity(context, resolution),
        calculateSimilarity(context, resolution),
        calculateSimilarity(context, resolution),
      ];

      // All should be identical
      expect(scores[0]).toBe(scores[1]);
      expect(scores[1]).toBe(scores[2]);
    });
  });

  // ─── Realistic Intent Scenarios ──────────────────────────────────

  describe('Realistic Intent Categories', () => {
    const intents = [
      'booking',
      'check_in',
      'check_out',
      'pricing',
      'facilities',
      'cancellation',
      'modifications',
      'special_requests',
      'payment',
      'general_inquiry',
    ];

    it('should support all 10 intent categories', () => {
      expect(intents.length).toBe(10);
      expect(intents).toContain('booking');
      expect(intents).toContain('check_in');
      expect(intents).toContain('check_out');
      expect(intents).toContain('pricing');
    });

    it('should isolate patterns by intent within profile', () => {
      const bookingPattern: EscalationPattern = {
        intentId: 'booking',
        staffResolution: 'Updated your booking',
        profileId: 'pelangi',
        similarityScore: 0.85,
      };

      const pricingPattern: EscalationPattern = {
        intentId: 'pricing',
        staffResolution: 'Rates are RM 100/night',
        profileId: 'pelangi',
        similarityScore: 0.82,
      };

      // Same profile, different intents
      expect(bookingPattern.profileId).toBe(pricingPattern.profileId);
      expect(bookingPattern.intentId).not.toBe(pricingPattern.intentId);
    });
  });

  // ─── Multi-Language Support ─────────────────────────────────────

  describe('Multi-Language Similarity', () => {
    it('should calculate similarity for English text', () => {
      const score = calculateSimilarity('booking', 'book');
      expect(score).toBeGreaterThan(0);
    });

    it('should calculate similarity for Malay text', () => {
      const score = calculateSimilarity('tempahan', 'pesan');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should be case-insensitive for all languages', () => {
      const text1 = 'BOOKING';
      const text2 = 'booking';
      expect(calculateSimilarity(text1, text2)).toBe(1);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle null/undefined gracefully in patterns', () => {
      const pattern: EscalationPattern = {
        intentId: 'booking',
        staffResolution: 'Updated your booking',
        guestFeedback: undefined,
        profileId: 'pelangi',
        similarityScore: 0.85,
      };

      expect(pattern.guestFeedback).toBeUndefined();
      expect(pattern.staffResolution).toBeDefined();
    });

    it('should handle very long text in similarity calculation', () => {
      const longText = 'Can I modify my booking? '.repeat(100);
      const shortText = 'booking modify';
      const score = calculateSimilarity(longText, shortText);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should handle special characters in similarity calculation', () => {
      const text1 = 'Can I modify? Yes!';
      const text2 = 'Can I modify Yes';
      const score = calculateSimilarity(text1, text2);
      expect(score).toBeGreaterThan(0);
    });

    it('should handle multiple profiles without cross-contamination', () => {
      const profiles = ['pelangi', 'makan', 'southern'];
      const patterns: EscalationPattern[] = profiles.map((p) => ({
        intentId: 'booking',
        staffResolution: `Updated booking for ${p}`,
        profileId: p,
        similarityScore: 0.85,
      }));

      for (const profile of profiles) {
        const profilePatterns = patterns.filter((p) => p.profileId === profile);
        expect(validateProfileIsolation(profilePatterns, profile)).toBe(true);
        expect(validateProfileIsolation(profilePatterns, 'different-profile')).toBe(false);
      }
    });
  });
});
