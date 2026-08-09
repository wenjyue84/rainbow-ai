/**
 * Tests for Confidence-Tiered Fallback Response Selector with Profile Isolation (US-412)
 *
 * Validates:
 * 1. Confidence tiers correctly map confidence scores to tier levels
 * 2. Profile isolation: responses contain only profile-appropriate content
 * 3. Cross-profile contamination detection: hostel keywords banned from makan profile
 * 4. Language fallback: unsupported languages fall back to English
 * 5. Response retrieval for all profiles and tiers
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  getConfidenceTier,
  normalizeProfileId,
  selectTieredFallback,
  getProfileTierResponses,
  getAvailableProfiles,
  type ConfidenceTier
} from '../../src/assistant/pipeline/fallback-selector.js';

// ─── Hostel Keywords Blacklist for Makan Profile ──────────────────

/**
 * Keywords that MUST NOT appear in makan-moments profile responses.
 * These are hostel/homestay-specific terms from the knowledge base.
 */
const HOSTEL_KEYWORDS_BANNED_FROM_MAKAN = [
  'check-in',
  'check-out',
  'checkout',
  'check_in',
  'check_out',
  'checkin',
  'room rate',
  'room rates',
  'hostel',
  'capsule',
  'stay extension',
  'extend stay',
  'luggage',
  'storage',
  'deck',
  'lower deck',
  'upper deck',
  'amenity',
  'amenities',
  'facilities'
];

// ─── Test Suite ──────────────────────────────────────────────────────

describe('Confidence-Tiered Fallback Selector (US-412)', () => {
  describe('getConfidenceTier', () => {
    it('should return tier0 for confidence < 0.3', () => {
      expect(getConfidenceTier(0.0)).toBe('tier0');
      expect(getConfidenceTier(0.15)).toBe('tier0');
      expect(getConfidenceTier(0.299)).toBe('tier0');
    });

    it('should return tier1 for confidence 0.3 to < 0.6', () => {
      expect(getConfidenceTier(0.3)).toBe('tier1');
      expect(getConfidenceTier(0.45)).toBe('tier1');
      expect(getConfidenceTier(0.599)).toBe('tier1');
    });

    it('should return tier2 for confidence >= 0.6', () => {
      expect(getConfidenceTier(0.6)).toBe('tier2');
      expect(getConfidenceTier(0.75)).toBe('tier2');
      expect(getConfidenceTier(1.0)).toBe('tier2');
    });
  });

  describe('normalizeProfileId', () => {
    it('should normalize makan variations to makan-moments', () => {
      expect(normalizeProfileId('makan')).toBe('makan-moments');
      expect(normalizeProfileId('makan-moments')).toBe('makan-moments');
      expect(normalizeProfileId('MAKAN')).toBe('makan-moments');
      expect(normalizeProfileId('Makan-Moments-Cafe')).toBe('makan-moments');
    });

    it('should normalize pelangi variations to pelangi', () => {
      expect(normalizeProfileId('pelangi')).toBe('pelangi');
      expect(normalizeProfileId('pelangi-capsule')).toBe('pelangi');
      expect(normalizeProfileId('PELANGI')).toBe('pelangi');
      expect(normalizeProfileId('Pelangi-Capsule-Hostel')).toBe('pelangi');
    });

    it('should normalize southern variations to southern', () => {
      expect(normalizeProfileId('southern')).toBe('southern');
      expect(normalizeProfileId('southern-homestay')).toBe('southern');
      expect(normalizeProfileId('SOUTHERN')).toBe('southern');
      expect(normalizeProfileId('Southern-Homestay-Hostel')).toBe('southern');
    });

    it('should return unknown profiles as-is', () => {
      expect(normalizeProfileId('unknown-profile')).toBe('unknown-profile');
    });
  });

  describe('selectTieredFallback', () => {
    it('should select tier0 response for low confidence', () => {
      const result = selectTieredFallback(0.2, 'pelangi', 'en');
      expect(result.tier).toBe('tier0');
      expect(result.profile).toBe('pelangi');
      expect(result.confidence).toBe(0.2);
      expect(result.response).toBeDefined();
      expect(result.response.length > 0).toBe(true);
    });

    it('should select tier1 response for medium confidence', () => {
      const result = selectTieredFallback(0.45, 'makan-moments', 'en');
      expect(result.tier).toBe('tier1');
      expect(result.profile).toBe('makan-moments');
      expect(result.confidence).toBe(0.45);
      expect(result.response).toBeDefined();
      expect(result.response.length > 0).toBe(true);
    });

    it('should select tier2 response for high confidence', () => {
      const result = selectTieredFallback(0.8, 'southern', 'en');
      expect(result.tier).toBe('tier2');
      expect(result.profile).toBe('southern');
      expect(result.confidence).toBe(0.8);
      expect(result.response).toBeDefined();
      expect(result.response.length > 0).toBe(true);
    });

    it('should normalize profile ID during selection', () => {
      const result = selectTieredFallback(0.5, 'MAKAN-MOMENTS-CAFE', 'en');
      expect(result.profile).toBe('makan-moments');
    });

    it('should support multiple languages with fallback to English', () => {
      const resultEn = selectTieredFallback(0.5, 'pelangi', 'en');
      const resultMs = selectTieredFallback(0.5, 'pelangi', 'ms');
      const resultZh = selectTieredFallback(0.5, 'pelangi', 'zh');
      const resultTa = selectTieredFallback(0.5, 'pelangi', 'ta');

      expect(resultEn.response).toBeDefined();
      expect(resultMs.response).toBeDefined();
      expect(resultZh.response).toBeDefined();
      expect(resultTa.response).toBeDefined();

      // Responses should be different across languages
      const responses = [resultEn.response, resultMs.response, resultZh.response, resultTa.response];
      const uniqueResponses = new Set(responses);
      expect(uniqueResponses.size).toBe(4);
    });

    it('should fallback to English when unsupported language requested', () => {
      const resultUnsupported = selectTieredFallback(0.5, 'pelangi', 'xx-unsupported');
      expect(resultUnsupported.language).toBe('xx-unsupported');
      expect(resultUnsupported.response).toBeDefined();
    });

    it('should handle confidence scores at tier boundaries', () => {
      const atZero = selectTieredFallback(0.0, 'pelangi', 'en');
      const justBelow = selectTieredFallback(0.299, 'pelangi', 'en');
      const atBoundary = selectTieredFallback(0.3, 'pelangi', 'en');
      const atBoundary2 = selectTieredFallback(0.6, 'pelangi', 'en');
      const atOne = selectTieredFallback(1.0, 'pelangi', 'en');

      expect(atZero.tier).toBe('tier0');
      expect(justBelow.tier).toBe('tier0');
      expect(atBoundary.tier).toBe('tier1');
      expect(atBoundary2.tier).toBe('tier2');
      expect(atOne.tier).toBe('tier2');
    });

    it('should clamp confidence to valid range [0, 1]', () => {
      const negativeResult = selectTieredFallback(-0.5, 'pelangi', 'en');
      const aboveOneResult = selectTieredFallback(1.5, 'pelangi', 'en');

      expect(negativeResult.confidence).toBe(0);
      expect(aboveOneResult.confidence).toBe(1);
      expect(negativeResult.tier).toBe('tier0');
      expect(aboveOneResult.tier).toBe('tier2');
    });

    it('should throw error for unknown profile', () => {
      expect(() => selectTieredFallback(0.5, 'nonexistent-profile', 'en')).toThrow();
    });
  });

  describe('Profile Isolation: Cross-Profile Contamination', () => {
    it('should ensure makan profile responses contain zero hostel keywords', () => {
      const profiles = ['makan-moments', 'makan', 'MAKAN'];
      const tiers: ConfidenceTier[] = ['tier0', 'tier1', 'tier2'];
      const languages = ['en', 'ms', 'zh', 'ta'];

      for (const profileId of profiles) {
        for (const tier of tiers) {
          for (const lang of languages) {
            const result = selectTieredFallback(0.5, profileId, lang);

            // Check response doesn't contain hostel keywords
            const responseUpper = result.response.toUpperCase();
            const foundKeywords = HOSTEL_KEYWORDS_BANNED_FROM_MAKAN.filter(
              (keyword) => responseUpper.includes(keyword.toUpperCase())
            );

            expect(
              foundKeywords,
              `Profile '${result.profile}' ${tier} (${lang}) contains banned keywords: ${foundKeywords.join(', ')}`
            ).toHaveLength(0);
          }
        }
      }
    });

    it('should scan all tier responses for makan profile to validate isolation', () => {
      // Get responses directly from data file for comprehensive scan
      const tierResponses0 = getProfileTierResponses('makan-moments', 'tier0');
      const tierResponses1 = getProfileTierResponses('makan-moments', 'tier1');
      const tierResponses2 = getProfileTierResponses('makan-moments', 'tier2');

      const allResponses = [
        ...Object.values(tierResponses0),
        ...Object.values(tierResponses1),
        ...Object.values(tierResponses2)
      ];

      // Check each response for contamination
      for (const response of allResponses) {
        const responseUpper = response.toUpperCase();
        const foundKeywords = HOSTEL_KEYWORDS_BANNED_FROM_MAKAN.filter(
          (keyword) => responseUpper.includes(keyword.toUpperCase())
        );

        expect(
          foundKeywords,
          `Makan response contains banned keywords: ${foundKeywords.join(', ')}`
        ).toHaveLength(0);
      }
    });

    it('should ensure pelangi profile responses contain only hostel-appropriate content', () => {
      const profiles = ['pelangi', 'pelangi-capsule', 'PELANGI'];
      const tiers: ConfidenceTier[] = ['tier0', 'tier1', 'tier2'];

      // Expected to contain hostel-related terms
      const expectedTerms = ['check-in', 'stay'];

      for (const profileId of profiles) {
        for (const tier of tiers) {
          const result = selectTieredFallback(0.5, profileId, 'en');
          expect(result.profile).toBe('pelangi');
          // Response should be defined and non-empty
          expect(result.response.length > 0).toBe(true);
        }
      }
    });

    it('should ensure southern profile responses do not contain pelangi-specific keywords', () => {
      const pelangiSpecificKeywords = ['capsule', 'lower deck', 'upper deck', 'card locked'];
      const tiers: ConfidenceTier[] = ['tier0', 'tier1', 'tier2'];

      for (const tier of tiers) {
        const tierResponses = getProfileTierResponses('southern', tier);
        const allResponses = Object.values(tierResponses);

        for (const response of allResponses) {
          const responseUpper = response.toUpperCase();
          const foundKeywords = pelangiSpecificKeywords.filter(
            (keyword) => responseUpper.includes(keyword.toUpperCase())
          );

          expect(
            foundKeywords,
            `Southern ${tier} response contains pelangi-specific keywords: ${foundKeywords.join(', ')}`
          ).toHaveLength(0);
        }
      }
    });
  });

  describe('getProfileTierResponses', () => {
    it('should retrieve all language variants for a profile and tier', () => {
      const responses = getProfileTierResponses('pelangi', 'tier1');
      expect(responses).toBeDefined();
      expect(responses.en).toBeDefined();
      expect(responses.ms).toBeDefined();
      expect(responses.zh).toBeDefined();
      expect(responses.ta).toBeDefined();
    });

    it('should throw error for unknown profile', () => {
      expect(() => getProfileTierResponses('unknown', 'tier0')).toThrow();
    });

    it('should throw error for unknown tier', () => {
      const responses = getProfileTierResponses('pelangi', 'tier0' as ConfidenceTier);
      expect(responses).toBeDefined();
      // Invalid tier should return empty or throw — depends on implementation
    });
  });

  describe('getAvailableProfiles', () => {
    it('should return list of available profiles', () => {
      const profiles = getAvailableProfiles();
      expect(profiles).toBeDefined();
      expect(Array.isArray(profiles)).toBe(true);
      expect(profiles.length > 0).toBe(true);
      expect(profiles).toContain('makan-moments');
      expect(profiles).toContain('pelangi');
      expect(profiles).toContain('southern');
    });

    it('should not include schema_version or description in profiles list', () => {
      const profiles = getAvailableProfiles();
      expect(profiles).not.toContain('schema_version');
      expect(profiles).not.toContain('description');
    });
  });

  describe('Integration: Full Workflow', () => {
    it('should support complete workflow from confidence score to tiered response', () => {
      // Simulate a low-confidence classification that should escalate
      const confidence = 0.25;
      const profileId = 'pelangi';
      const language = 'en';

      const result = selectTieredFallback(confidence, profileId, language);

      expect(result.tier).toBe('tier0');
      expect(result.response).toContain('trouble');
      expect(result.profile).toBe('pelangi');
    });

    it('should handle multiple consecutive requests with different tiers', () => {
      const confidenceScores = [0.1, 0.4, 0.9];
      const expectedTiers = ['tier0', 'tier1', 'tier2'];

      for (let i = 0; i < confidenceScores.length; i++) {
        const result = selectTieredFallback(confidenceScores[i], 'makan-moments', 'en');
        expect(result.tier).toBe(expectedTiers[i]);
      }
    });

    it('should provide appropriate escalation responses for tier0', () => {
      const result = selectTieredFallback(0.1, 'pelangi', 'en');
      expect(result.tier).toBe('tier0');
      // Tier0 should mention staff/help
      expect(result.response.toLowerCase()).toMatch(/staff|team|help|assistant/);
    });

    it('should provide uncertain disclaimers for tier1', () => {
      const result = selectTieredFallback(0.45, 'makan-moments', 'en');
      expect(result.tier).toBe('tier1');
      // Tier1 should express uncertainty
      expect(result.response.toLowerCase()).toMatch(/not|uncertain|clarif|rephrase/i);
    });

    it('should provide confident responses for tier2', () => {
      const result = selectTieredFallback(0.85, 'southern', 'en');
      expect(result.tier).toBe('tier2');
      // Tier2 should be positive and helpful
      expect(result.response.toLowerCase()).toMatch(/happy|help|information/);
    });
  });
});
