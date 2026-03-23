/**
 * US-231: Multi-Language Booking Intent Keyword Expansion for Malay and Tamil
 *
 * Validates that Malay and Tamil keywords are present in intent-keywords.json
 * and that the fuzzy matcher correctly classifies multilingual booking/inquiry phrases.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { FuzzyIntentMatcher, type KeywordIntent } from '../assistant/fuzzy-matcher.js';
import intentKeywordsData from '../assistant/data/intent-keywords.json' with { type: 'json' };

// Build the fuzzy matcher from actual intent-keywords.json data
let fuzzyMatcher: FuzzyIntentMatcher;

beforeAll(() => {
  const keywordIntents: KeywordIntent[] = [];

  for (const intent of intentKeywordsData.intents) {
    for (const [lang, keywords] of Object.entries(intent.keywords)) {
      keywordIntents.push({
        intent: intent.intent,
        keywords: keywords as string[],
        language: lang as 'en' | 'ms' | 'zh' | 'ta'
      });
    }

    // Include regional variants if they exist
    if ((intent as any).regional_variants) {
      for (const [lang, variants] of Object.entries((intent as any).regional_variants)) {
        keywordIntents.push({
          intent: intent.intent,
          keywords: variants as string[],
          language: lang as 'en' | 'ms' | 'zh' | 'ta'
        });
      }
    }
  }

  fuzzyMatcher = new FuzzyIntentMatcher(keywordIntents);
});

describe('US-231: Multi-Language Booking Intent Keyword Expansion', () => {

  describe('Malay keywords presence (20+ required)', () => {
    const bookingInquiryIntents = [
      'booking', 'availability', 'pricing', 'checkin_info',
      'check_in_arrival', 'checkout_info', 'late_checkout_request',
      'room_type_inquiry', 'extend_stay', 'stay_extension'
    ];

    it('should have 20+ Malay keywords across booking/inquiry intents', () => {
      let totalMalayKeywords = 0;

      for (const intentData of intentKeywordsData.intents) {
        if (bookingInquiryIntents.includes(intentData.intent)) {
          const msKeywords = (intentData.keywords as Record<string, string[]>).ms;
          if (msKeywords) {
            totalMalayKeywords += msKeywords.length;
          }
        }
      }

      // Should have at least 20 Malay keywords across booking/inquiry intents
      expect(totalMalayKeywords).toBeGreaterThanOrEqual(20);
    });

    it('should contain specific Malay booking keywords', () => {
      const bookingIntent = intentKeywordsData.intents.find(i => i.intent === 'booking');
      expect(bookingIntent).toBeDefined();
      const msKeywords = (bookingIntent!.keywords as Record<string, string[]>).ms;
      expect(msKeywords).toBeDefined();
      expect(msKeywords).toContain('tarikh check-in');
      expect(msKeywords).toContain('boleh ubah tempahan');
      expect(msKeywords).toContain('bilik untuk malam ini');
    });

    it('should contain specific Malay pricing keywords', () => {
      const pricingIntent = intentKeywordsData.intents.find(i => i.intent === 'pricing');
      expect(pricingIntent).toBeDefined();
      const msKeywords = (pricingIntent!.keywords as Record<string, string[]>).ms;
      expect(msKeywords).toBeDefined();
      expect(msKeywords).toContain('berapa harga bilik');
      expect(msKeywords).toContain('harga per malam');
    });
  });

  describe('Tamil keywords presence (15+ required)', () => {
    const bookingInquiryIntents = [
      'booking', 'availability', 'pricing', 'checkin_info',
      'check_in_arrival', 'checkout_info', 'late_checkout_request',
      'room_type_inquiry', 'extend_stay', 'stay_extension'
    ];

    it('should have 15+ Tamil keywords across booking/inquiry intents', () => {
      let totalTamilKeywords = 0;

      for (const intentData of intentKeywordsData.intents) {
        if (bookingInquiryIntents.includes(intentData.intent)) {
          const taKeywords = (intentData.keywords as Record<string, string[]>).ta;
          if (taKeywords) {
            totalTamilKeywords += taKeywords.length;
          }
        }
      }

      // Should have at least 15 Tamil keywords across booking/inquiry intents
      expect(totalTamilKeywords).toBeGreaterThanOrEqual(15);
    });

    it('should contain Tamil romanized booking keywords', () => {
      const bookingIntent = intentKeywordsData.intents.find(i => i.intent === 'booking');
      expect(bookingIntent).toBeDefined();
      const taKeywords = (bookingIntent!.keywords as Record<string, string[]>).ta;
      expect(taKeywords).toBeDefined();
      expect(taKeywords).toContain('book pannanum');
      expect(taKeywords).toContain('arai vendum');
      expect(taKeywords).toContain('yenna naal check-in');
    });

    it('should contain Tamil script booking keywords', () => {
      const bookingIntent = intentKeywordsData.intents.find(i => i.intent === 'booking');
      expect(bookingIntent).toBeDefined();
      const taKeywords = (bookingIntent!.keywords as Record<string, string[]>).ta;
      expect(taKeywords).toBeDefined();
      expect(taKeywords).toContain('அறை வேண்டும்');
      expect(taKeywords).toContain('தங்கணும்');
    });

    it('should contain Tamil pricing keywords with romanization', () => {
      const pricingIntent = intentKeywordsData.intents.find(i => i.intent === 'pricing');
      expect(pricingIntent).toBeDefined();
      const taKeywords = (pricingIntent!.keywords as Record<string, string[]>).ta;
      expect(taKeywords).toBeDefined();
      expect(taKeywords).toContain('vilai evvalavu');
      expect(taKeywords).toContain('evvalavu aagum');
    });
  });

  describe('Fuzzy classification of Malay phrases', () => {
    it('should classify "Berapa harga bilik?" as pricing intent', () => {
      const result = fuzzyMatcher.match('Berapa harga bilik?', 'ms');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('pricing');
      expect(result!.score).toBeGreaterThanOrEqual(0.70);
    });

    it('should classify "saya nak bilik" as booking intent', () => {
      const result = fuzzyMatcher.match('saya nak bilik', 'ms');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('booking');
      expect(result!.score).toBeGreaterThanOrEqual(0.70);
    });

    it('should classify "ada bilik malam ni" as availability intent', () => {
      const result = fuzzyMatcher.match('ada bilik malam ni', 'ms');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('availability');
      expect(result!.score).toBeGreaterThanOrEqual(0.70);
    });

    it('should classify "saya sudah sampai" as check_in_arrival intent', () => {
      const result = fuzzyMatcher.match('saya sudah sampai', 'ms');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('check_in_arrival');
      expect(result!.score).toBeGreaterThanOrEqual(0.70);
    });
  });

  describe('Fuzzy classification of Tamil phrases', () => {
    it('should classify "Yenna naal check-in?" as booking intent', () => {
      const result = fuzzyMatcher.match('yenna naal check-in', 'ta');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('booking');
      expect(result!.score).toBeGreaterThanOrEqual(0.70);
    });

    it('should classify "book pannanum" as booking intent', () => {
      const result = fuzzyMatcher.match('book pannanum', 'ta');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('booking');
      expect(result!.score).toBeGreaterThanOrEqual(0.70);
    });

    it('should classify "room irukka" as availability intent', () => {
      const result = fuzzyMatcher.match('room irukka', 'ta');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('availability');
      expect(result!.score).toBeGreaterThanOrEqual(0.70);
    });

    it('should classify "vilai evvalavu" as pricing intent', () => {
      const result = fuzzyMatcher.match('vilai evvalavu', 'ta');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('pricing');
      expect(result!.score).toBeGreaterThanOrEqual(0.70);
    });

    it('should classify Tamil script "அறை வேண்டும்" as booking intent', () => {
      const result = fuzzyMatcher.match('அறை வேண்டும்', 'ta');
      expect(result).not.toBeNull();
      expect(result!.intent).toBe('booking');
      expect(result!.score).toBeGreaterThanOrEqual(0.70);
    });
  });
});
