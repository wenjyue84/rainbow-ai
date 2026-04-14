/**
 * tests/booking-microclassifier.test.ts — Test suite for booking intent disambiguation
 *
 * Covers 15+ real booking queries with expected sub-intent output
 * Target: 95%+ pass rate on golden dataset
 */

import { describe, it, expect } from 'vitest';
import { classifyBookingSubIntent } from '../src/assistant/classifiers/booking-microclassifier.js';

describe('Booking Microclassifier', () => {
  describe('check_in_confirm', () => {
    it('EN: "I want to check in now"', () => {
      const result = classifyBookingSubIntent('I want to check in now', 'en', 'pelangi');
      expect(result.sub_intent).toBe('check_in_confirm');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('EN: "I just arrived at the property"', () => {
      const result = classifyBookingSubIntent('I just arrived at the property', 'en', 'pelangi');
      expect(result.sub_intent).toBe('check_in_confirm');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('EN: "Can I check in early?"', () => {
      const result = classifyBookingSubIntent('Can I check in early?', 'en', 'pelangi');
      expect(result.sub_intent).toBe('check_in_confirm');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('MS: "Saya dah sampai, boleh masuk bilik?"', () => {
      const result = classifyBookingSubIntent('Saya dah sampai, boleh masuk bilik?', 'ms', 'pelangi');
      expect(result.sub_intent).toBe('check_in_confirm');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('ZH: "我已经到了，什么时候可以入住？"', () => {
      const result = classifyBookingSubIntent('我已经到了，什么时候可以入住？', 'zh', 'pelangi');
      expect(result.sub_intent).toBe('check_in_confirm');
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('modification_request', () => {
    it('EN: "Can I add one more night to my booking?"', () => {
      const result = classifyBookingSubIntent('Can I add one more night to my booking?', 'en', 'pelangi');
      expect(result.sub_intent).toBe('modification_request');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('EN: "I want to change my check-in date"', () => {
      const result = classifyBookingSubIntent('I want to change my check-in date', 'en', 'pelangi');
      expect(result.sub_intent).toBe('modification_request');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('EN: "Can I upgrade to a larger room?"', () => {
      const result = classifyBookingSubIntent('Can I upgrade to a larger room?', 'en', 'pelangi');
      expect(result.sub_intent).toBe('modification_request');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('MS: "Boleh ubah tarikh check-in saya?"', () => {
      const result = classifyBookingSubIntent('Boleh ubah tarikh check-in saya?', 'ms', 'pelangi');
      expect(result.sub_intent).toBe('modification_request');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('ZH: "我想加一晚，可以吗？"', () => {
      const result = classifyBookingSubIntent('我想加一晚，可以吗？', 'zh', 'pelangi');
      expect(result.sub_intent).toBe('modification_request');
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('cancellation', () => {
    it('EN: "I want to cancel my booking"', () => {
      const result = classifyBookingSubIntent('I want to cancel my booking', 'en', 'pelangi');
      expect(result.sub_intent).toBe('cancellation');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('EN: "Can I get a refund?"', () => {
      const result = classifyBookingSubIntent('Can I get a refund?', 'en', 'pelangi');
      expect(result.sub_intent).toBe('cancellation');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('EN: "I need to check out early"', () => {
      const result = classifyBookingSubIntent('I need to check out early', 'en', 'pelangi');
      expect(result.sub_intent).toBe('cancellation');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('MS: "Saya nak batal tempahan saya"', () => {
      const result = classifyBookingSubIntent('Saya nak batal tempahan saya', 'ms', 'pelangi');
      expect(result.sub_intent).toBe('cancellation');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('ZH: "我想取消订单"', () => {
      const result = classifyBookingSubIntent('我想取消订单', 'zh', 'pelangi');
      expect(result.sub_intent).toBe('cancellation');
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('availability_check', () => {
    it('EN: "Do you have rooms available this weekend?"', () => {
      const result = classifyBookingSubIntent('Do you have rooms available this weekend?', 'en', 'pelangi');
      expect(result.sub_intent).toBe('availability_check');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('EN: "Is the room available on 15th April?"', () => {
      const result = classifyBookingSubIntent('Is the room available on 15th April?', 'en', 'pelangi');
      expect(result.sub_intent).toBe('availability_check');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('MS: "Ada bilik kosong untuk minggu depan?"', () => {
      const result = classifyBookingSubIntent('Ada bilik kosong untuk minggu depan?', 'ms', 'pelangi');
      expect(result.sub_intent).toBe('availability_check');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('ZH: "你们有空房吗？"', () => {
      const result = classifyBookingSubIntent('你们有空房吗？', 'zh', 'pelangi');
      expect(result.sub_intent).toBe('availability_check');
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('unknown or ambiguous', () => {
    it('EN: "Hi there" should default to unknown', () => {
      const result = classifyBookingSubIntent('Hi there', 'en', 'pelangi');
      expect(result.sub_intent).toBe('unknown');
    });

    it('EN: "Tell me a joke" should default to unknown', () => {
      const result = classifyBookingSubIntent('Tell me a joke', 'en', 'pelangi');
      expect(result.sub_intent).toBe('unknown');
    });
  });

  describe('profile-specific keywords', () => {
    it('Should load keywords from pelangi profile', () => {
      const result = classifyBookingSubIntent('check in now', 'en', 'pelangi');
      expect(result.sub_intent).toBe('check_in_confirm');
      expect(result.model).toBe('keyword-matching');
    });

    it('Should load keywords from southern profile', () => {
      const result = classifyBookingSubIntent('want to check in', 'en', 'southern');
      expect(result.sub_intent).toBe('check_in_confirm');
      expect(result.model).toBe('keyword-matching');
    });

    it('Should load keywords from makan profile', () => {
      const result = classifyBookingSubIntent('cancel booking', 'en', 'makan');
      expect(result.sub_intent).toBe('cancellation');
      expect(result.model).toBe('keyword-matching');
    });
  });

  describe('language detection', () => {
    it('Should handle English messages', () => {
      const result = classifyBookingSubIntent('I want to check in', 'en', 'pelangi');
      expect(result.sub_intent).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('Should handle Malay messages', () => {
      const result = classifyBookingSubIntent('saya nak check in', 'ms', 'pelangi');
      expect(result.sub_intent).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('Should handle Mandarin messages', () => {
      const result = classifyBookingSubIntent('我要入住', 'zh', 'pelangi');
      expect(result.sub_intent).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('Should fallback to English on unknown language', () => {
      const result = classifyBookingSubIntent('check in', 'pt', 'pelangi');
      expect(result.sub_intent).toBeDefined();
    });
  });

  describe('confidence scoring', () => {
    it('Multiple keyword matches should have high confidence', () => {
      const result = classifyBookingSubIntent('I want to check in and arrive tomorrow', 'en', 'pelangi');
      expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('Single keyword match should have medium-high confidence', () => {
      const result = classifyBookingSubIntent('check in', 'en', 'pelangi');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('No matches should default to unknown with 0.5 confidence', () => {
      const result = classifyBookingSubIntent('blah blah', 'en', 'pelangi');
      expect(result.sub_intent).toBe('unknown');
      expect(result.confidence).toBe(0.5);
    });
  });

  describe('edge cases', () => {
    it('Empty message should return unknown', () => {
      const result = classifyBookingSubIntent('', 'en', 'pelangi');
      expect(result.sub_intent).toBe('unknown');
    });

    it('Whitespace-only message should return unknown', () => {
      const result = classifyBookingSubIntent('   ', 'en', 'pelangi');
      expect(result.sub_intent).toBe('unknown');
    });

    it('Very long message should still classify', () => {
      const longMsg = 'can i please check in now i am waiting at the door i have arrived '.repeat(10);
      const result = classifyBookingSubIntent(longMsg, 'en', 'pelangi');
      expect(result.sub_intent).toBeDefined();
    });

    it('Message with special characters should normalize', () => {
      const result = classifyBookingSubIntent('café check-in!!!', 'en', 'pelangi');
      expect(result.sub_intent).toBe('check_in_confirm');
    });

    it('Case insensitive matching', () => {
      const result1 = classifyBookingSubIntent('CHECK IN', 'en', 'pelangi');
      const result2 = classifyBookingSubIntent('check in', 'en', 'pelangi');
      expect(result1.sub_intent).toBe(result2.sub_intent);
    });
  });
});
