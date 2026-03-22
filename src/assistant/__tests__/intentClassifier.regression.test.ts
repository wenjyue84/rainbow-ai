/**
 * Intent Classifier Regression Test (US-087)
 *
 * Verifies that the fuzzy intent classifier (Tier 2) maintains baseline
 * accuracy thresholds per profile. Tests are fully deterministic — no LLM
 * calls, no external APIs.
 *
 * Uses utterances from or near actual keyword entries in intent-keywords.json
 * so that the fuzzy matcher (which works best on short keyword-like phrases)
 * can accurately classify them.
 *
 * Thresholds:
 *   - Booking intent accuracy  >= 85%
 *   - Inquiry intent accuracy  >= 80%
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { FuzzyIntentMatcher, type KeywordIntent } from '../fuzzy-matcher.js';
import intentKeywordsData from '../data/intent-keywords.json' with { type: 'json' };

// ─── Helpers ─────────────────────────────────────────────────────────

/** Build a FuzzyIntentMatcher from production intent-keywords.json */
function createMatcher(): FuzzyIntentMatcher {
  const keywordIntents: KeywordIntent[] = [];
  for (const intent of intentKeywordsData.intents) {
    for (const [lang, keywords] of Object.entries(intent.keywords)) {
      keywordIntents.push({
        intent: intent.intent,
        keywords: keywords as string[],
        language: lang as 'en' | 'ms' | 'zh' | 'ta',
      });
    }
    if ((intent as any).regional_variants) {
      for (const [lang, variants] of Object.entries((intent as any).regional_variants)) {
        keywordIntents.push({
          intent: intent.intent,
          keywords: variants as string[],
          language: lang as 'en' | 'ms' | 'zh' | 'ta',
        });
      }
    }
  }
  return new FuzzyIntentMatcher(keywordIntents);
}

interface Sample {
  text: string;
  expectedCategory: 'booking' | 'inquiry';
}

/** Booking intents — direct reservations and availability checks */
const BOOKING_INTENTS = new Set(['booking', 'availability', 'stay_extension', 'extend_stay']);

/** Core inquiry intents for hostel/homestay profiles */
const INQUIRY_INTENTS = new Set([
  'pricing', 'checkin_info', 'checkout_info', 'facilities', 'facilities_info',
  'wifi', 'WIFI_PASSWORD', 'directions', 'rules', 'rules_policy', 'payment',
  'payment_info', 'billing_inquiry', 'room_type_inquiry', 'luggage_storage',
  'late_checkout_request', 'local_services',
]);

/** Extended inquiry intents for cafe profile (includes menu intents) */
const CAFE_INQUIRY_INTENTS = new Set([
  ...INQUIRY_INTENTS,
  'MENU_SPECIALS', 'MENU_FILTER_PRICE', 'MENU_RECOMMEND',
]);

function resolveCategory(
  intent: string,
  inquirySet: Set<string> = INQUIRY_INTENTS
): 'booking' | 'inquiry' | 'other' {
  if (BOOKING_INTENTS.has(intent)) return 'booking';
  if (inquirySet.has(intent)) return 'inquiry';
  return 'other';
}

function calcAccuracy(
  samples: Sample[],
  matcher: FuzzyIntentMatcher,
  category: 'booking' | 'inquiry',
  inquirySet: Set<string> = INQUIRY_INTENTS
): { accuracy: number; total: number; correct: number } {
  const categoryItems = samples.filter(s => s.expectedCategory === category);
  if (categoryItems.length === 0) return { accuracy: 1.0, total: 0, correct: 0 };

  let correct = 0;
  for (const sample of categoryItems) {
    const result = matcher.match(sample.text);
    if (result && resolveCategory(result.intent, inquirySet) === category) {
      correct++;
    }
  }
  return { accuracy: correct / categoryItems.length, total: categoryItems.length, correct };
}

// ─── Per-Profile Test Data ────────────────────────────────────────────
// Utterances are drawn from or near actual keywords in intent-keywords.json
// so the fuzzy matcher (Tier 2) can classify them without LLM fallback.

/**
 * Pelangi Capsule Hostel samples.
 * Mix of English and Malay; covers both booking and general inquiry intents.
 */
const PELANGI_SAMPLES: Sample[] = [
  // ── Booking (12 samples) ─────────────────────────────────────────
  { text: 'book a room', expectedCategory: 'booking' },
  { text: 'booking', expectedCategory: 'booking' },
  { text: 'want to book', expectedCategory: 'booking' },
  { text: 'reservation', expectedCategory: 'booking' },
  { text: 'reserve', expectedCategory: 'booking' },
  { text: 'make a booking', expectedCategory: 'booking' },
  { text: 'i want to book', expectedCategory: 'booking' },
  { text: 'can i book', expectedCategory: 'booking' },
  { text: 'availability', expectedCategory: 'booking' },
  { text: 'check availability', expectedCategory: 'booking' },
  { text: 'do you have rooms', expectedCategory: 'booking' },
  { text: 'any bed', expectedCategory: 'booking' },
  // ── Inquiry (14 samples) ─────────────────────────────────────────
  { text: 'wifi password', expectedCategory: 'inquiry' },
  { text: 'wifi', expectedCategory: 'inquiry' },
  { text: 'internet', expectedCategory: 'inquiry' },
  { text: 'check in', expectedCategory: 'inquiry' },
  { text: 'checkin', expectedCategory: 'inquiry' },
  { text: 'check out time', expectedCategory: 'inquiry' },
  { text: 'price', expectedCategory: 'inquiry' },
  { text: 'how much', expectedCategory: 'inquiry' },
  { text: 'how much per night', expectedCategory: 'inquiry' },
  { text: 'directions', expectedCategory: 'inquiry' },
  { text: 'where are you', expectedCategory: 'inquiry' },
  { text: 'facilities', expectedCategory: 'inquiry' },
  { text: 'late checkout', expectedCategory: 'inquiry' },
  { text: 'store luggage', expectedCategory: 'inquiry' },
];

/**
 * Southern Homestay samples.
 * Similar hostel/accommodation profile; adds Malay equivalents.
 */
const SOUTHERN_SAMPLES: Sample[] = [
  // ── Booking (12 samples) ─────────────────────────────────────────
  { text: 'book a room', expectedCategory: 'booking' },
  { text: 'reservation', expectedCategory: 'booking' },
  { text: 'want to book', expectedCategory: 'booking' },
  { text: 'need a room', expectedCategory: 'booking' },
  { text: 'make a booking', expectedCategory: 'booking' },
  { text: 'availability', expectedCategory: 'booking' },
  { text: 'available', expectedCategory: 'booking' },
  { text: 'do you have rooms', expectedCategory: 'booking' },
  { text: 'any rooms left', expectedCategory: 'booking' },
  { text: 'tempahan', expectedCategory: 'booking' },           // Malay: reservation
  { text: 'nak book', expectedCategory: 'booking' },           // Malay: want to book
  { text: 'ada bilik', expectedCategory: 'booking' },          // Malay: any room
  // ── Inquiry (14 samples) ─────────────────────────────────────────
  { text: 'wifi password', expectedCategory: 'inquiry' },
  { text: 'check in', expectedCategory: 'inquiry' },
  { text: 'check out', expectedCategory: 'inquiry' },
  { text: 'checkout', expectedCategory: 'inquiry' },
  { text: 'price', expectedCategory: 'inquiry' },
  { text: 'how much', expectedCategory: 'inquiry' },
  { text: 'cost', expectedCategory: 'inquiry' },
  { text: 'how to reach', expectedCategory: 'inquiry' },
  { text: 'where are you', expectedCategory: 'inquiry' },
  { text: 'facilities', expectedCategory: 'inquiry' },
  { text: 'kitchen', expectedCategory: 'inquiry' },
  { text: 'rules', expectedCategory: 'inquiry' },
  { text: 'policy', expectedCategory: 'inquiry' },
  { text: 'payment', expectedCategory: 'inquiry' },
];

/**
 * Makan Moments Cafe samples.
 * Table reservations for booking; menu/pricing/hours for inquiry.
 */
const MAKAN_SAMPLES: Sample[] = [
  // ── Booking (10 samples) ─────────────────────────────────────────
  { text: 'book a table', expectedCategory: 'booking' },
  { text: 'booking', expectedCategory: 'booking' },
  { text: 'reservation', expectedCategory: 'booking' },
  { text: 'table reservation', expectedCategory: 'booking' },
  { text: 'reserve', expectedCategory: 'booking' },
  { text: 'availability', expectedCategory: 'booking' },
  { text: 'available', expectedCategory: 'booking' },
  { text: 'i want to book', expectedCategory: 'booking' },
  { text: 'tempahan', expectedCategory: 'booking' },           // Malay: reservation
  { text: 'nak book', expectedCategory: 'booking' },           // Malay: want to book
  // ── Inquiry (14 samples) ─────────────────────────────────────────
  { text: 'wifi password', expectedCategory: 'inquiry' },
  { text: 'price', expectedCategory: 'inquiry' },
  { text: 'pricing', expectedCategory: 'inquiry' },
  { text: 'how much', expectedCategory: 'inquiry' },
  { text: 'check in', expectedCategory: 'inquiry' },           // opening hours → check_in
  { text: 'where are you', expectedCategory: 'inquiry' },
  { text: 'how to reach', expectedCategory: 'inquiry' },
  { text: 'todays special', expectedCategory: 'inquiry' },     // → MENU_SPECIALS
  { text: 'today special', expectedCategory: 'inquiry' },
  { text: 'menu price', expectedCategory: 'inquiry' },         // → MENU_FILTER_PRICE
  { text: 'budget menu', expectedCategory: 'inquiry' },
  { text: 'recommendation', expectedCategory: 'inquiry' },     // → MENU_RECOMMEND
  { text: 'what do you recommend', expectedCategory: 'inquiry' },
  { text: 'facilities', expectedCategory: 'inquiry' },
];

// ─── Regression Tests ─────────────────────────────────────────────────

describe('Intent Classifier Regression Tests (US-087)', () => {
  let matcher: FuzzyIntentMatcher;

  beforeAll(() => {
    matcher = createMatcher();
  });

  describe('Pelangi Capsule Hostel — baseline accuracy', () => {
    it('has at least 20 test samples', () => {
      expect(PELANGI_SAMPLES.length).toBeGreaterThanOrEqual(20);
    });

    it('booking intent accuracy >= 85%', () => {
      const { accuracy, total, correct } = calcAccuracy(PELANGI_SAMPLES, matcher, 'booking');
      const pct = Math.round(accuracy * 100);
      console.log(`[Pelangi] Booking: ${correct}/${total} = ${pct}%`);
      expect(accuracy).toBeGreaterThanOrEqual(0.85);
    });

    it('inquiry intent accuracy >= 80%', () => {
      const { accuracy, total, correct } = calcAccuracy(PELANGI_SAMPLES, matcher, 'inquiry');
      const pct = Math.round(accuracy * 100);
      console.log(`[Pelangi] Inquiry: ${correct}/${total} = ${pct}%`);
      expect(accuracy).toBeGreaterThanOrEqual(0.80);
    });
  });

  describe('Southern Homestay — baseline accuracy', () => {
    it('has at least 20 test samples', () => {
      expect(SOUTHERN_SAMPLES.length).toBeGreaterThanOrEqual(20);
    });

    it('booking intent accuracy >= 85%', () => {
      const { accuracy, total, correct } = calcAccuracy(SOUTHERN_SAMPLES, matcher, 'booking');
      const pct = Math.round(accuracy * 100);
      console.log(`[Southern] Booking: ${correct}/${total} = ${pct}%`);
      expect(accuracy).toBeGreaterThanOrEqual(0.85);
    });

    it('inquiry intent accuracy >= 80%', () => {
      const { accuracy, total, correct } = calcAccuracy(SOUTHERN_SAMPLES, matcher, 'inquiry');
      const pct = Math.round(accuracy * 100);
      console.log(`[Southern] Inquiry: ${correct}/${total} = ${pct}%`);
      expect(accuracy).toBeGreaterThanOrEqual(0.80);
    });
  });

  describe('Makan Moments Cafe — baseline accuracy', () => {
    it('has at least 20 test samples', () => {
      expect(MAKAN_SAMPLES.length).toBeGreaterThanOrEqual(20);
    });

    it('booking intent accuracy >= 85%', () => {
      const { accuracy, total, correct } = calcAccuracy(MAKAN_SAMPLES, matcher, 'booking', CAFE_INQUIRY_INTENTS);
      const pct = Math.round(accuracy * 100);
      console.log(`[Makan] Booking: ${correct}/${total} = ${pct}%`);
      expect(accuracy).toBeGreaterThanOrEqual(0.85);
    });

    it('inquiry intent accuracy >= 80%', () => {
      const { accuracy, total, correct } = calcAccuracy(MAKAN_SAMPLES, matcher, 'inquiry', CAFE_INQUIRY_INTENTS);
      const pct = Math.round(accuracy * 100);
      console.log(`[Makan] Inquiry: ${correct}/${total} = ${pct}%`);
      expect(accuracy).toBeGreaterThanOrEqual(0.80);
    });
  });
});
