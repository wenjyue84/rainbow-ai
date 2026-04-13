/**
 * US-544: Profile-Specific Fallback Response Template System Test
 *
 * Verifies that:
 * - Each profile (pelangi, makan, southern) has profile-specific fallback responses
 * - Pelangi responses don't contain Makan-specific text (e.g., "cafe", "menu")
 * - Makan responses don't contain Pelangi-specific text (e.g., "hostel", "check-in")
 * - Templates render without errors in all supported languages (en, ta, zh)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getProfileFallbackTemplate } from '../../src/assistant/pipeline/response-processor.js';

describe('US-544: Profile-Specific Fallback Template System', () => {
  const dataDir = {
    pelangi: 'src/assistant/data',
    makan: 'src/assistant/data-makan',
    southern: 'src/assistant/data-southern'
  };

  const languages = ['en', 'ta', 'zh'];
  const scenarios = ['low_confidence', 'out_of_scope', 'provider_error', 'rate_limited'];

  // Profile-specific keywords that should NOT appear in other profiles' templates
  const exclusiveKeywords = {
    pelangi: ['hostel', 'check-in', 'room', 'amenities', 'capsule'],
    makan: ['menu', 'cafe', 'order', 'food', 'drink', 'coffee', 'reservation'],
    southern: ['homestay'] // Using broader homestay-specific keywords
  };

  describe('Template Loading', () => {
    it('should load templates for pelangi profile', () => {
      const template = getProfileFallbackTemplate(dataDir.pelangi, 'low_confidence', 'en');
      expect(template).toBeDefined();
      expect(template.length).toBeGreaterThan(0);
    });

    it('should load templates for makan profile', () => {
      const template = getProfileFallbackTemplate(dataDir.makan, 'low_confidence', 'en');
      expect(template).toBeDefined();
      expect(template.length).toBeGreaterThan(0);
    });

    it('should load templates for southern profile', () => {
      const template = getProfileFallbackTemplate(dataDir.southern, 'low_confidence', 'en');
      expect(template).toBeDefined();
      expect(template.length).toBeGreaterThan(0);
    });
  });

  describe('Language Support', () => {
    scenarios.forEach(scenario => {
      languages.forEach(lang => {
        it(`should provide ${scenario} template in ${lang} for pelangi`, () => {
          const template = getProfileFallbackTemplate(dataDir.pelangi, scenario, lang);
          expect(template).toBeTruthy();
          expect(template.length).toBeGreaterThan(0);
        });

        it(`should provide ${scenario} template in ${lang} for makan`, () => {
          const template = getProfileFallbackTemplate(dataDir.makan, scenario, lang);
          expect(template).toBeTruthy();
          expect(template.length).toBeGreaterThan(0);
        });

        it(`should provide ${scenario} template in ${lang} for southern`, () => {
          const template = getProfileFallbackTemplate(dataDir.southern, scenario, lang);
          expect(template).toBeTruthy();
          expect(template.length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe('Profile Isolation: No Content Contamination', () => {
    // Pelangi should not contain Makan-specific keywords
    it('pelangi profile should not contain makan-specific keywords', () => {
      scenarios.forEach(scenario => {
        languages.forEach(lang => {
          const template = getProfileFallbackTemplate(dataDir.pelangi, scenario, lang);
          const makanKeywordsLower = exclusiveKeywords.makan.map(k => k.toLowerCase());
          const templateLower = template.toLowerCase();

          // Check each makan keyword
          for (const keyword of makanKeywordsLower) {
            expect(templateLower).not.toContain(keyword.toLowerCase());
          }
        });
      });
    });

    // Makan should not contain Pelangi-specific keywords
    it('makan profile should not contain pelangi-specific keywords', () => {
      scenarios.forEach(scenario => {
        languages.forEach(lang => {
          const template = getProfileFallbackTemplate(dataDir.makan, scenario, lang);
          const pelangiKeywordsLower = exclusiveKeywords.pelangi.map(k => k.toLowerCase());
          const templateLower = template.toLowerCase();

          // Check each pelangi keyword (excluding common terms like 'room' that might appear generically)
          const strictKeywords = ['check-in', 'capsule', 'hostel'].map(k => k.toLowerCase());
          for (const keyword of strictKeywords) {
            expect(templateLower).not.toContain(keyword.toLowerCase());
          }
        });
      });
    });

    // Southern should not contain Pelangi-specific keywords (but can share hospitality terms like check-in)
    it('southern profile should not contain pelangi-specific keywords', () => {
      scenarios.forEach(scenario => {
        languages.forEach(lang => {
          const template = getProfileFallbackTemplate(dataDir.southern, scenario, lang);
          // Southern is also hospitality, so check-in is acceptable; focus on unique Pelangi terms
          const strictKeywords = ['capsule', 'hostel'].map(k => k.toLowerCase());
          const templateLower = template.toLowerCase();

          for (const keyword of strictKeywords) {
            expect(templateLower).not.toContain(keyword.toLowerCase());
          }
        });
      });
    });
  });

  describe('Template Rendering', () => {
    it('should render all templates without errors', () => {
      const profiles = [dataDir.pelangi, dataDir.makan, dataDir.southern];

      profiles.forEach(profile => {
        scenarios.forEach(scenario => {
          languages.forEach(lang => {
            const template = getProfileFallbackTemplate(profile, scenario, lang);
            // Should be able to access and use the template without exceptions
            expect(() => {
              const rendered = `${template}`; // Simple rendering
              expect(rendered).toBeTruthy();
            }).not.toThrow();
          });
        });
      });
    });

    it('should handle missing language gracefully (fallback to English)', () => {
      const template = getProfileFallbackTemplate(dataDir.pelangi, 'low_confidence', 'unknown-language');
      // Should fall back to English
      expect(template).toBeTruthy();
      expect(template.length).toBeGreaterThan(0);
    });

    it('should handle unknown scenario gracefully', () => {
      const template = getProfileFallbackTemplate(dataDir.pelangi, 'unknown_scenario', 'en');
      // Should return a default message
      expect(template).toBeTruthy();
      expect(template.length).toBeGreaterThan(0);
    });
  });

  describe('Profile-Specific Content Validation', () => {
    it('pelangi should mention hostel-related context', () => {
      const pelangiTemplate = getProfileFallbackTemplate(dataDir.pelangi, 'out_of_scope', 'en');
      const hostelRelatedKeywords = ['hostel', 'check-in', 'room', 'front desk', 'stay'];
      const templateLower = pelangiTemplate.toLowerCase();
      const hasHostelKeyword = hostelRelatedKeywords.some(k => templateLower.includes(k.toLowerCase()));
      expect(hasHostelKeyword).toBe(true);
    });

    it('makan should mention cafe/order context', () => {
      const makanTemplate = getProfileFallbackTemplate(dataDir.makan, 'out_of_scope', 'en');
      const cafeKeywords = ['menu', 'orders', 'cafe', 'order', 'food'];
      const templateLower = makanTemplate.toLowerCase();
      const hasCafeKeyword = cafeKeywords.some(k => templateLower.includes(k.toLowerCase()));
      expect(hasCafeKeyword).toBe(true);
    });

    it('southern should mention booking/facility context', () => {
      const southernTemplate = getProfileFallbackTemplate(dataDir.southern, 'out_of_scope', 'en');
      const bookingKeywords = ['booking', 'facility', 'check-in', 'properties', 'accommodations'];
      const templateLower = southernTemplate.toLowerCase();
      const hasBookingKeyword = bookingKeywords.some(k => templateLower.includes(k.toLowerCase()));
      expect(hasBookingKeyword).toBe(true);
    });
  });

  describe('All Scenarios Covered', () => {
    it('should have templates for all required scenarios', () => {
      const requiredScenarios = ['low_confidence', 'out_of_scope', 'provider_error', 'rate_limited'];

      requiredScenarios.forEach(scenario => {
        const pelangiTemplate = getProfileFallbackTemplate(dataDir.pelangi, scenario, 'en');
        expect(pelangiTemplate).toBeTruthy();

        const makanTemplate = getProfileFallbackTemplate(dataDir.makan, scenario, 'en');
        expect(makanTemplate).toBeTruthy();

        const southernTemplate = getProfileFallbackTemplate(dataDir.southern, scenario, 'en');
        expect(southernTemplate).toBeTruthy();
      });
    });
  });

  describe('Language Variants', () => {
    it('should have different content for different languages', () => {
      const engTemplate = getProfileFallbackTemplate(dataDir.pelangi, 'low_confidence', 'en');
      const tamilTemplate = getProfileFallbackTemplate(dataDir.pelangi, 'low_confidence', 'ta');
      const chineseTemplate = getProfileFallbackTemplate(dataDir.pelangi, 'low_confidence', 'zh');

      // Different templates for different languages (should not be identical)
      expect(engTemplate).not.toBe(tamilTemplate);
      expect(engTemplate).not.toBe(chineseTemplate);
      expect(tamilTemplate).not.toBe(chineseTemplate);
    });

    it('should support Tamil, Mandarin, and English', () => {
      const supportedLanguages = ['en', 'ta', 'zh'];

      supportedLanguages.forEach(lang => {
        const template = getProfileFallbackTemplate(dataDir.pelangi, 'low_confidence', lang);
        expect(template).toBeTruthy();
      });
    });
  });
});
