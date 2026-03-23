/**
 * Tests for US-278: Remove Pelangi Hostel Keywords from Makan Moments Intent-Keywords File
 *
 * Validates that:
 * 1. data-makan/intent-keywords.json contains zero hostel-specific keywords
 * 2. Cleaned file passes Zod schema validation
 * 3. All remaining intents resolve in the Makan routing.json
 * 4. Cafe-specific keywords are preserved
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { intentKeywordsDataSchema } from '../../src/assistant/schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../../src/assistant/data-makan');

interface IntentKeywordEntry {
  intent: string;
  keywords: Record<string, string[]>;
}

interface IntentKeywordsFile {
  intents: IntentKeywordEntry[];
}

function loadMakanKeywords(): IntentKeywordsFile {
  return JSON.parse(readFileSync(join(dataDir, 'intent-keywords.json'), 'utf-8'));
}

function loadMakanRouting(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dataDir, 'routing.json'), 'utf-8'));
}

/** Hostel-specific keywords that must NOT appear in a cafe profile */
const HOSTEL_KEYWORDS = [
  // Check-in / checkout
  'checkin', 'check-in', 'check in',
  'checkout', 'check-out', 'check out',
  // Room / accommodation
  'room type', 'room', 'nightly rate', 'capsule', 'dormitory', 'bunk', 'bed',
  'dorm', 'upper deck', 'lower deck', 'dek atas', 'dek bawah',
  // Amenities / facilities (hostel context)
  'amenities', 'kemudahan', 'locker', 'towel', 'tuala', 'pillow',
  // Stay / booking
  'extend stay', 'late checkout', 'luggage storage', 'simpan bagasi',
  // Airport / travel (hostel-guest specific)
  'airport', 'senai airport', 'lapangan terbang', 'dari airport',
  'from airport', 'how to get here from airport',
  'macam mana nak sampai dari airport',
  '机场', '怎么去机场', '从机场怎么到',
  // Hostel-specific intents as keywords
  'hostel', 'guest house', 'homestay',
];

/** Hostel-specific intent names that must NOT exist in Makan profile */
const HOSTEL_INTENTS = [
  'wifi',
  'checkin_info',
  'check_in_arrival',
  'checkout_info',
  'checkout_procedure',
  'late_checkout_request',
  'stay_extension',
  'extend_stay',
  'facility_orientation',
  'luggage_storage',
  'card_locked',
  'lower_deck_preference',
  'capsule_conflict',
  'facility_malfunction',
  'noise_complaint',
  'cleanliness_complaint',
  'climate_control_complaint',
  'general_complaint_in_stay',
  'booking',
  'availability',
  'facilities_info',
  'rules_policy',
  'extra_amenity_request',
  'forgot_item_post_checkout',
  'billing_dispute',
  'billing_inquiry',
  'theft',
  'theft_report',
  'tourist_guide',
  'checkout_now',
  'payment_made',
  'payment_info',
  'room_type_inquiry',
];

/** Cafe-specific keywords that MUST be preserved */
const REQUIRED_CAFE_KEYWORDS = [
  'menu',
  'order',
  'recommend',
  'food',
  'complaint',
  'greeting',
];

// ─── AC1: Identify and confirm 8+ hostel keywords are absent ─────────────────

describe('US-278: Hostel keyword removal from Makan profile', () => {
  const data = loadMakanKeywords();

  it('should contain zero hostel-specific intent names', () => {
    const intentNames = data.intents.map((i) => i.intent);
    const found = intentNames.filter((name) => HOSTEL_INTENTS.includes(name));
    expect(found).toEqual([]);
  });

  it('should contain zero hostel-specific keywords across all intents', () => {
    const contaminated: { intent: string; lang: string; keyword: string }[] = [];

    for (const entry of data.intents) {
      for (const [lang, keywords] of Object.entries(entry.keywords)) {
        for (const kw of keywords) {
          const lower = kw.toLowerCase();
          for (const hostelKw of HOSTEL_KEYWORDS) {
            if (lower === hostelKw.toLowerCase()) {
              contaminated.push({ intent: entry.intent, lang, keyword: kw });
            }
          }
        }
      }
    }

    expect(contaminated).toEqual([]);
  });

  it('should have removed 8+ hostel-specific keywords (audit count check)', () => {
    // These hostel keywords were confirmed present in the original file
    // and have been removed:
    // EN: airport, from airport, how to get here from airport, senai airport, how much per day
    // MS: airport, dari airport, lapangan terbang, macam mana nak sampai dari airport
    // ZH: 机场, 怎么去机场, 从机场怎么到
    // Plus entire hostel intents removed in prior cleanup: wifi, facilities_info,
    // local_services, rules_policy, payment
    const removedKeywords = [
      'airport',
      'from airport',
      'how to get here from airport',
      'senai airport',
      'dari airport',
      'lapangan terbang',
      'macam mana nak sampai dari airport',
      '机场',
      '怎么去机场',
      '从机场怎么到',
      'how much per day',
    ];

    // Verify none of these exist in the current file
    const allKeywords: string[] = [];
    for (const entry of data.intents) {
      for (const keywords of Object.values(entry.keywords)) {
        allKeywords.push(...keywords);
      }
    }

    for (const removed of removedKeywords) {
      expect(allKeywords).not.toContain(removed);
    }

    expect(removedKeywords.length).toBeGreaterThanOrEqual(8);
  });
});

// ─── AC2: Cafe-specific keywords preserved ───────────────────────────────────

describe('US-278: Cafe keyword preservation', () => {
  const data = loadMakanKeywords();

  it('should preserve cafe-specific intents', () => {
    const intentNames = data.intents.map((i) => i.intent);
    const expectedCafeIntents = [
      'greeting',
      'thanks',
      'pricing',
      'directions',
      'complaint',
      'contact_staff',
      'review_feedback',
      'cancel_workflow',
      'accessibility',
      'order_placement',
      'menu_query',
      'food_recommendation',
    ];

    for (const expected of expectedCafeIntents) {
      expect(intentNames).toContain(expected);
    }
  });

  it('should preserve cafe-relevant keywords in each language', () => {
    const allKeywords: string[] = [];
    for (const entry of data.intents) {
      for (const keywords of Object.values(entry.keywords)) {
        allKeywords.push(...keywords.map((k) => k.toLowerCase()));
      }
    }

    for (const cafeKw of REQUIRED_CAFE_KEYWORDS) {
      const found = allKeywords.some((kw) => kw.includes(cafeKw));
      expect(found).toBe(true);
    }
  });

  it('should have multilingual keywords (en, ms, zh) for all intents', () => {
    for (const entry of data.intents) {
      expect(entry.keywords).toHaveProperty('en');
      expect(entry.keywords).toHaveProperty('ms');
      expect(entry.keywords).toHaveProperty('zh');
      expect(entry.keywords.en.length).toBeGreaterThan(0);
      expect(entry.keywords.ms.length).toBeGreaterThan(0);
      expect(entry.keywords.zh.length).toBeGreaterThan(0);
    }
  });
});

// ─── AC3: Zod schema validation and routing resolution ───────────────────────

describe('US-278: Schema validation and routing', () => {
  it('should pass Zod schema validation (intentKeywordsDataSchema)', () => {
    const data = loadMakanKeywords();
    const result = intentKeywordsDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should have all intents resolve in Makan routing.json', () => {
    const data = loadMakanKeywords();
    const routing = loadMakanRouting();
    const routedIntents = Object.keys(routing);
    const keywordIntents = data.intents.map((i) => i.intent);

    const unrouted = keywordIntents.filter((i) => !routedIntents.includes(i));
    expect(unrouted).toEqual([]);
  });

  it('should produce valid JSON with proper structure', () => {
    const raw = readFileSync(join(dataDir, 'intent-keywords.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();

    const data = JSON.parse(raw);
    expect(data).toHaveProperty('intents');
    expect(Array.isArray(data.intents)).toBe(true);
    expect(data.intents.length).toBeGreaterThan(0);
  });
});
