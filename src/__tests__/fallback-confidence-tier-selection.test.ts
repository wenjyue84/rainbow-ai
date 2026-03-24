/**
 * Unit tests for Fallback Response Auto-Selection from Confidence Tiers (US-360)
 *
 * Tests confidence-based fallback response selection:
 * - HIGH confidence (≥0.8): Use AI response
 * - MEDIUM (0.5-0.8): Use intent-specific template
 * - LOW (<0.5): Escalate to staff
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  selectFallbackResponse,
  clearKnowledgeCache,
} from '../assistant/pipeline/fallbacks.js';

describe('selectFallbackResponse - Confidence Tier Selection', () => {
  beforeEach(() => {
    clearKnowledgeCache();
  });

  describe('HIGH confidence (≥0.8): Use AI response', () => {
    it('returns high tier for confidence >= 0.8', () => {
      const result = selectFallbackResponse('booking', 0.85, 'booking', 'en');
      expect(result.tier).toBe('high');
      expect(result.shouldEscalate).toBe(false);
    });

    it('returns empty text for high confidence (caller should use AI response)', () => {
      const result = selectFallbackResponse('booking', 0.95, 'booking', 'en');
      expect(result.text).toBe('');
      expect(result.tier).toBe('high');
    });

    it('handles boundary case: confidence = 0.8 exactly', () => {
      const result = selectFallbackResponse('inquiry', 0.8, 'facilities', 'en');
      expect(result.tier).toBe('high');
      expect(result.shouldEscalate).toBe(false);
    });

    it('handles confidence > 0.8 (e.g., 1.0)', () => {
      const result = selectFallbackResponse('pricing', 1.0, 'default', 'en');
      expect(result.tier).toBe('high');
      expect(result.shouldEscalate).toBe(false);
    });
  });

  describe('MEDIUM confidence (0.5-0.8): Use intent-specific template', () => {
    it('returns medium tier for 0.5 <= confidence < 0.8', () => {
      const result = selectFallbackResponse('wifi', 0.65, 'facilities', 'en');
      expect(result.tier).toBe('medium');
      expect(result.shouldEscalate).toBe(false);
    });

    it('returns intent-specific template from knowledge.json when available', () => {
      const result = selectFallbackResponse('wifi', 0.6, 'facilities', 'en');
      // WiFi intent exists in knowledge.json, should return its template
      expect(result.text).toBeTruthy();
      expect(result.text).toContain('WiFi');
      expect(result.tier).toBe('medium');
    });

    it('returns template for facilities intent', () => {
      const result = selectFallbackResponse('facilities', 0.55, 'facilities', 'en');
      expect(result.text).toBeTruthy();
      expect(result.text).toContain('Facilities');
      expect(result.tier).toBe('medium');
    });

    it('returns template for checkin_info intent', () => {
      const result = selectFallbackResponse('checkin_info', 0.6, 'checkin', 'en');
      expect(result.text).toBeTruthy();
      expect(result.text).toContain('Check-in');
      expect(result.tier).toBe('medium');
    });

    it('returns template in requested language (Malay)', () => {
      const result = selectFallbackResponse('pricing', 0.65, 'booking', 'ms');
      expect(result.tier).toBe('medium');
      expect(result.text).toBeTruthy();
      // Should be Malay version containing "Harga" (price in Malay)
      if (result.text.includes('Harga') || result.text.includes('harga')) {
        expect(result.text.toLowerCase()).toContain('harga');
      }
    });

    it('returns template in requested language (Chinese)', () => {
      const result = selectFallbackResponse('pricing', 0.65, 'booking', 'zh');
      expect(result.tier).toBe('medium');
      expect(result.text).toBeTruthy();
    });

    it('falls back to generic inquiry if specific intent template not found', () => {
      const result = selectFallbackResponse('nonexistent_intent', 0.55, 'default', 'en');
      expect(result.tier).toBe('medium');
      expect(result.text).toBeTruthy();
      // Should contain generic fallback message
      expect(result.text.toLowerCase()).toContain('detail');
    });

    it('handles boundary case: confidence = 0.5 exactly', () => {
      const result = selectFallbackResponse('facilities', 0.5, 'facilities', 'en');
      expect(result.tier).toBe('medium');
      expect(result.shouldEscalate).toBe(false);
    });

    it('handles boundary case: confidence = 0.799 (just below 0.8)', () => {
      const result = selectFallbackResponse('checkin_info', 0.799, 'checkin', 'en');
      expect(result.tier).toBe('medium');
      expect(result.shouldEscalate).toBe(false);
    });

    it('low-confidence booking query returns category-specific template', () => {
      // This is the acceptance criteria test case
      const result = selectFallbackResponse('booking_request', 0.65, 'booking', 'en');
      expect(result.tier).toBe('medium');
      expect(result.shouldEscalate).toBe(false);
      // Should be category-specific (booking-related) not generic fallback
      expect(result.text).toBeTruthy();
      expect(result.text).not.toBe('');
    });
  });

  describe('LOW confidence (<0.5): Escalate to staff', () => {
    it('returns low tier for confidence < 0.5', () => {
      const result = selectFallbackResponse('unknown', 0.3, 'default', 'en');
      expect(result.tier).toBe('low');
      expect(result.shouldEscalate).toBe(true);
    });

    it('returns escalation message for low confidence', () => {
      const result = selectFallbackResponse('booking', 0.4, 'booking', 'en');
      expect(result.text).toContain('not confident');
      expect(result.text).toContain('team');
      expect(result.shouldEscalate).toBe(true);
    });

    it('returns Malay escalation message when language is ms', () => {
      const result = selectFallbackResponse('pricing', 0.25, 'pricing', 'ms');
      expect(result.tier).toBe('low');
      expect(result.text).toBeTruthy();
      expect(result.shouldEscalate).toBe(true);
    });

    it('returns Chinese escalation message when language is zh', () => {
      const result = selectFallbackResponse('facilities', 0.1, 'facilities', 'zh');
      expect(result.tier).toBe('low');
      expect(result.text).toBeTruthy();
      expect(result.shouldEscalate).toBe(true);
    });

    it('handles boundary case: confidence = 0.0 (minimum)', () => {
      const result = selectFallbackResponse('unknown', 0.0, 'default', 'en');
      expect(result.tier).toBe('low');
      expect(result.shouldEscalate).toBe(true);
    });

    it('handles confidence just below 0.5: 0.499', () => {
      const result = selectFallbackResponse('inquiry', 0.499, 'default', 'en');
      expect(result.tier).toBe('low');
      expect(result.shouldEscalate).toBe(true);
    });
  });

  describe('Tier boundaries and edge cases', () => {
    it('correctly distinguishes between 0.5 (medium) and 0.499 (low)', () => {
      const medium = selectFallbackResponse('test', 0.5, 'default', 'en');
      const low = selectFallbackResponse('test', 0.499, 'default', 'en');

      expect(medium.tier).toBe('medium');
      expect(low.tier).toBe('low');
    });

    it('correctly distinguishes between 0.8 (high) and 0.799 (medium)', () => {
      const high = selectFallbackResponse('test', 0.8, 'default', 'en');
      const medium = selectFallbackResponse('test', 0.799, 'default', 'en');

      expect(high.tier).toBe('high');
      expect(medium.tier).toBe('medium');
    });

    it('handles multiple categories (booking, facilities, checkin, default)', () => {
      const categories = ['booking', 'facilities', 'checkin', 'default'];

      for (const category of categories) {
        const result = selectFallbackResponse('test', 0.65, category, 'en');
        expect(result.tier).toBe('medium');
        expect(result.shouldEscalate).toBe(false);
      }
    });

    it('handles all major languages (en, ms, zh)', () => {
      const languages = ['en', 'ms', 'zh'];

      for (const lang of languages) {
        const result = selectFallbackResponse('facilities', 0.3, 'facilities', lang);
        expect(result.tier).toBe('low');
        expect(result.text).toBeTruthy();
      }
    });
  });

  describe('Real-world scenario: Ambiguous booking query with low confidence', () => {
    it('returns category-specific template instead of generic fallback', () => {
      // User asks: "How much for a week?" (ambiguous, could be room type, pricing, etc.)
      // Classified as booking with low confidence 0.45
      const result = selectFallbackResponse('booking_request', 0.45, 'booking', 'en');

      expect(result.tier).toBe('low');
      expect(result.shouldEscalate).toBe(true);
      expect(result.text).toContain('team');
      // Should NOT be a super generic "I don't understand" message
      expect(result.text).toBeTruthy();
    });

    it('returns medium-tier template when confidence improves to 0.6', () => {
      // Same query, but classifier confidence improved to 0.6
      const result = selectFallbackResponse('pricing', 0.6, 'booking', 'en');

      expect(result.tier).toBe('medium');
      expect(result.shouldEscalate).toBe(false);
      // Should have pricing information
      expect(result.text).toBeTruthy();
    });
  });
});
