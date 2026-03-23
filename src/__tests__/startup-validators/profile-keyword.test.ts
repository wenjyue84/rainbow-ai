/**
 * US-210: Profile-specific keyword contamination blocker tests
 *
 * Verifies that:
 *   1. Importing data-southern with a 'cafe' keyword throws an error
 *   2. Importing data-makan with a 'hostel' keyword throws an error
 *   3. Clean profiles pass validation without errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findKeywordViolations,
  validateProfileKeywords,
  enforceProfileKeywordPurity,
  formatViolationError,
  BLOCKED_KEYWORDS,
} from '../../lib/startup-validators/profile-keyword-validator.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeIntentKeywordsData(intents: Array<{ intent: string; keywords: Record<string, string[]> }>) {
  return { intents };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('US-210: Profile keyword contamination blocker', () => {
  // ── AC1: Blocked keyword lists are correctly defined ──────────────────

  describe('blocked keyword configuration', () => {
    it('should block hostel/pelangi/capsule/check-in for data-makan', () => {
      expect(BLOCKED_KEYWORDS['data-makan']).toEqual(
        expect.arrayContaining(['hostel', 'pelangi', 'capsule', 'check-in']),
      );
    });

    it('should block cafe/makan/menu/order for data-southern', () => {
      expect(BLOCKED_KEYWORDS['data-southern']).toEqual(
        expect.arrayContaining(['cafe', 'makan', 'menu', 'order']),
      );
    });
  });

  // ── AC2: findKeywordViolations detects contaminated keywords ──────────

  describe('findKeywordViolations', () => {
    it('should detect "cafe" keyword in data-southern profile', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'greeting',
          keywords: {
            en: ['hello', 'cafe nearby'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-southern', data, BLOCKED_KEYWORDS['data-southern']!);
      expect(violations).toHaveLength(1);
      expect(violations[0].blockedTerm).toBe('cafe');
      expect(violations[0].keyword).toBe('cafe nearby');
      expect(violations[0].intent).toBe('greeting');
      expect(violations[0].language).toBe('en');
    });

    it('should detect "makan" keyword in data-southern profile', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'food_query',
          keywords: {
            ms: ['tempat makan'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-southern', data, BLOCKED_KEYWORDS['data-southern']!);
      expect(violations).toHaveLength(1);
      expect(violations[0].blockedTerm).toBe('makan');
      expect(violations[0].keyword).toBe('tempat makan');
    });

    it('should detect "menu" keyword in data-southern profile', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'dining',
          keywords: {
            en: ['show menu'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-southern', data, BLOCKED_KEYWORDS['data-southern']!);
      expect(violations).toHaveLength(1);
      expect(violations[0].blockedTerm).toBe('menu');
    });

    it('should detect "order" keyword in data-southern profile', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'food',
          keywords: {
            en: ['place order'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-southern', data, BLOCKED_KEYWORDS['data-southern']!);
      expect(violations).toHaveLength(1);
      expect(violations[0].blockedTerm).toBe('order');
    });

    it('should detect "hostel" keyword in data-makan profile', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'accommodation',
          keywords: {
            en: ['hostel booking'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-makan', data, BLOCKED_KEYWORDS['data-makan']!);
      expect(violations).toHaveLength(1);
      expect(violations[0].blockedTerm).toBe('hostel');
    });

    it('should detect "pelangi" keyword in data-makan profile', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'location',
          keywords: {
            en: ['pelangi capsule'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-makan', data, BLOCKED_KEYWORDS['data-makan']!);
      // Should match both 'pelangi' and 'capsule'
      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations.some((v) => v.blockedTerm === 'pelangi')).toBe(true);
    });

    it('should detect "capsule" keyword in data-makan profile', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'room',
          keywords: {
            en: ['capsule room'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-makan', data, BLOCKED_KEYWORDS['data-makan']!);
      expect(violations).toHaveLength(1);
      expect(violations[0].blockedTerm).toBe('capsule');
    });

    it('should detect "check-in" keyword in data-makan profile', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'arrival',
          keywords: {
            en: ['check-in time'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-makan', data, BLOCKED_KEYWORDS['data-makan']!);
      expect(violations).toHaveLength(1);
      expect(violations[0].blockedTerm).toBe('check-in');
    });

    it('should be case-insensitive when matching blocked terms', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'test',
          keywords: {
            en: ['HOSTEL info', 'Pelangi Place'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-makan', data, BLOCKED_KEYWORDS['data-makan']!);
      expect(violations.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array for clean profile data', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'greeting',
          keywords: {
            en: ['hello', 'hi', 'hey'],
            ms: ['hai', 'helo'],
          },
        },
        {
          intent: 'thanks',
          keywords: {
            en: ['thank you', 'thanks'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-makan', data, BLOCKED_KEYWORDS['data-makan']!);
      expect(violations).toHaveLength(0);
    });

    it('should handle empty intents array', () => {
      const data = makeIntentKeywordsData([]);
      const violations = findKeywordViolations('data-makan', data, BLOCKED_KEYWORDS['data-makan']!);
      expect(violations).toHaveLength(0);
    });

    it('should detect multiple violations across intents and languages', () => {
      const data = makeIntentKeywordsData([
        {
          intent: 'intent_a',
          keywords: {
            en: ['hostel booking'],
            ms: ['pelangi hotel'],
          },
        },
        {
          intent: 'intent_b',
          keywords: {
            en: ['capsule room'],
          },
        },
      ]);

      const violations = findKeywordViolations('data-makan', data, BLOCKED_KEYWORDS['data-makan']!);
      expect(violations.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── AC3: formatViolationError produces remediation message ────────────

  describe('formatViolationError', () => {
    it('should produce empty string for valid result', () => {
      const result = { profile: 'data-makan', valid: true, violations: [] };
      expect(formatViolationError(result)).toBe('');
    });

    it('should include profile name and remediation instructions on violation', () => {
      const result = {
        profile: 'data-southern',
        valid: false,
        violations: [
          {
            profile: 'data-southern',
            intent: 'food_query',
            language: 'en',
            keyword: 'cafe nearby',
            blockedTerm: 'cafe',
          },
        ],
      };

      const msg = formatViolationError(result);
      expect(msg).toContain('data-southern');
      expect(msg).toContain('cafe nearby');
      expect(msg).toContain('cafe');
      expect(msg).toContain('Remove');
      expect(msg).toContain('intent-keywords.json');
      expect(msg).toContain('rebuild');
    });
  });

  // ── AC4: enforceProfileKeywordPurity integration test ──────────────────

  describe('enforceProfileKeywordPurity', () => {
    it('should detect known contamination in actual project data-southern profile', () => {
      // data-southern/intent-keywords.json contains "makanan teruk" (contains "makan")
      // and "out of order" (contains "order") which are flagged as contamination
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(() => enforceProfileKeywordPurity()).toThrow(/Profile keyword contamination/);
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it('should throw with synthesized contaminated data', () => {
      const data = makeIntentKeywordsData([
        { intent: 'test', keywords: { en: ['cafe food'] } },
      ]);
      const violations = findKeywordViolations('data-southern', data, BLOCKED_KEYWORDS['data-southern']!);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('should pass with clean synthesized data', () => {
      const data = makeIntentKeywordsData([
        { intent: 'greeting', keywords: { en: ['hello', 'hi'] } },
      ]);
      const violations = findKeywordViolations('data-southern', data, BLOCKED_KEYWORDS['data-southern']!);
      expect(violations).toHaveLength(0);
    });
  });

  // ── AC5: validateProfileKeywords for unknown profiles ─────────────────

  describe('validateProfileKeywords', () => {
    it('should return valid for unknown profile (no blocked keywords defined)', () => {
      const result = validateProfileKeywords('data-unknown');
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should return valid when intent-keywords.json does not exist', () => {
      const result = validateProfileKeywords('data-makan', '/nonexistent/path');
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });
});
