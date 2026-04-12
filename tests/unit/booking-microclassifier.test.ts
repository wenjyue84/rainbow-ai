/**
 * Unit tests for booking-microclassifier.ts (US-535)
 *
 * Tests the BookingMicroClassifier against 10+ scenarios:
 * - check_in: "I want to check in tomorrow"
 * - check_out: "When can I leave?"
 * - modification: "Can I change my dates?"
 * - general_inquiry: "Is the room still available?"
 */

import { describe, it, expect } from 'vitest';
import { classifyBookingSubtype } from '../../src/assistant/classifiers/booking-microclassifier.js';

describe('BookingMicroClassifier', () => {
  describe('check_in intent recognition', () => {
    it('should classify "check in tomorrow" as check_in', () => {
      const result = classifyBookingSubtype('I want to check in tomorrow', 'en');
      expect(result.subtype).toBe('check_in');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify "I have arrived" as check_in', () => {
      const result = classifyBookingSubtype('I have arrived at the property', 'en');
      expect(result.subtype).toBe('check_in');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify "can I check in now?" as check_in', () => {
      const result = classifyBookingSubtype('can I check in now?', 'en');
      expect(result.subtype).toBe('check_in');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify Malay "sudah tiba" as check_in', () => {
      const result = classifyBookingSubtype('Sudah tiba di tempat', 'ms');
      expect(result.subtype).toBe('check_in');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify Chinese "我到了" as check_in', () => {
      const result = classifyBookingSubtype('我到了', 'zh');
      expect(result.subtype).toBe('check_in');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });
  });

  describe('check_out intent recognition', () => {
    it('should classify "when can I check out?" as check_out', () => {
      const result = classifyBookingSubtype('when can I check out?', 'en');
      expect(result.subtype).toBe('check_out');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify "I am leaving tomorrow" as check_out', () => {
      const result = classifyBookingSubtype('I am leaving tomorrow', 'en');
      expect(result.subtype).toBe('check_out');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify "I must return the key before checkout" as check_out', () => {
      const result = classifyBookingSubtype('I must return the key before checkout', 'en');
      expect(result.subtype).toBe('check_out');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify Malay "keluar malam ini" as check_out', () => {
      const result = classifyBookingSubtype('Saya keluar malam ini', 'ms');
      expect(result.subtype).toBe('check_out');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify Chinese "退房" as check_out', () => {
      const result = classifyBookingSubtype('我要退房', 'zh');
      expect(result.subtype).toBe('check_out');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });
  });

  describe('modification intent recognition', () => {
    it('should classify "can I change my dates?" as modification', () => {
      const result = classifyBookingSubtype('can I change my dates?', 'en');
      expect(result.subtype).toBe('modification');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify "I want to modify my booking" as modification', () => {
      const result = classifyBookingSubtype('I want to modify my booking', 'en');
      expect(result.subtype).toBe('modification');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify "can I extend for one more night?" as modification', () => {
      const result = classifyBookingSubtype('can I extend for one more night?', 'en');
      expect(result.subtype).toBe('modification');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify Malay "ubah tanggal saya" as modification', () => {
      const result = classifyBookingSubtype('Boleh ubah tanggal saya', 'ms');
      expect(result.subtype).toBe('modification');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify Chinese "改日期" as modification', () => {
      const result = classifyBookingSubtype('我要改日期', 'zh');
      expect(result.subtype).toBe('modification');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });
  });

  describe('general_inquiry recognition', () => {
    it('should classify "is the room still available?" as general_inquiry', () => {
      const result = classifyBookingSubtype('Is the room still available?', 'en');
      expect(result.subtype).toBe('general_inquiry');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should classify "what is the booking status?" as general_inquiry', () => {
      const result = classifyBookingSubtype('What is my booking status?', 'en');
      expect(result.subtype).toBe('general_inquiry');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should classify "how much is the price?" as general_inquiry', () => {
      const result = classifyBookingSubtype('How much is the price?', 'en');
      expect(result.subtype).toBe('general_inquiry');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should classify unknown booking text as general_inquiry by default', () => {
      const result = classifyBookingSubtype('abcdef xyz qwerty', 'en');
      // Should fall back to general_inquiry with low confidence
      expect(result.subtype).toBe('general_inquiry');
      expect(result.confidence).toBeLessThanOrEqual(0.6);
    });
  });

  describe('language fallback', () => {
    it('should fallback to English patterns when language is unsupported', () => {
      const result = classifyBookingSubtype('check in tomorrow', 'fr');
      // Should use English patterns as fallback
      expect(result.subtype).toBe('check_in');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });
  });

  describe('model field', () => {
    it('should return model as "keyword-matching"', () => {
      const result = classifyBookingSubtype('check in tomorrow', 'en');
      expect(result.model).toBe('keyword-matching');
    });
  });

  describe('confidence scoring', () => {
    it('should score multiple keyword matches higher than single match', () => {
      // "check in arriving" has 2 keywords: "check in" + "arriving"
      const multiMatch = classifyBookingSubtype('check in arriving now', 'en');
      // "check in" has 1 keyword
      const singleMatch = classifyBookingSubtype('check in', 'en');
      expect(multiMatch.confidence).toBeGreaterThanOrEqual(singleMatch.confidence);
    });

    it('should return confidence of 0.9 for multiple matches', () => {
      const result = classifyBookingSubtype('I want to check in and arrive tomorrow', 'en');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('should return confidence >= 0.65 for single match', () => {
      const result = classifyBookingSubtype('check in', 'en');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
      expect(result.confidence).toBeLessThanOrEqual(0.8);
    });
  });

  describe('edge cases', () => {
    it('should handle case-insensitive matching', () => {
      const lower = classifyBookingSubtype('check in tomorrow', 'en');
      const upper = classifyBookingSubtype('CHECK IN TOMORROW', 'en');
      expect(lower.subtype).toBe(upper.subtype);
      expect(lower.confidence).toBe(upper.confidence);
    });

    it('should handle extra whitespace', () => {
      const clean = classifyBookingSubtype('check in tomorrow', 'en');
      const dirty = classifyBookingSubtype('   check   in   tomorrow   ', 'en');
      expect(clean.subtype).toBe(dirty.subtype);
      expect(clean.confidence).toBe(dirty.confidence);
    });

    it('should handle diacritics removal for Latin characters', () => {
      const result = classifyBookingSubtype('Café check in', 'en');
      expect(result.subtype).toBe('check_in');
    });

    it('should preserve non-Latin characters (e.g., Mandarin)', () => {
      const result = classifyBookingSubtype('我要入住明天', 'zh');
      expect(result.subtype).toBe('check_in');
    });
  });

  describe('additional multi-language coverage', () => {
    it('should classify "I am ready to check in now" as check_in', () => {
      const result = classifyBookingSubtype('I am ready to check in now', 'en');
      expect(result.subtype).toBe('check_in');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify "what is the checkout time" as check_out', () => {
      const result = classifyBookingSubtype('what is the checkout time', 'en');
      expect(result.subtype).toBe('check_out');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify "I would like to upgrade the room" as modification', () => {
      const result = classifyBookingSubtype('I would like to upgrade the room', 'en');
      expect(result.subtype).toBe('modification');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify "what are the payment terms" as general_inquiry', () => {
      const result = classifyBookingSubtype('what are the payment terms', 'en');
      expect(result.subtype).toBe('general_inquiry');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should classify Malay "saya ingin masuk sekarang" as check_in', () => {
      const result = classifyBookingSubtype('saya ingin masuk sekarang', 'ms');
      expect(result.subtype).toBe('check_in');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify Malay "berapa harga per malam" as general_inquiry', () => {
      const result = classifyBookingSubtype('berapa harga per malam', 'ms');
      expect(result.subtype).toBe('general_inquiry');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should classify Chinese "我想延期住宿" as modification', () => {
      const result = classifyBookingSubtype('我想延期住宿', 'zh');
      expect(result.subtype).toBe('modification');
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    });

    it('should classify Chinese "有房间吗" as general_inquiry', () => {
      const result = classifyBookingSubtype('有房间吗', 'zh');
      expect(result.subtype).toBe('general_inquiry');
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });
});
