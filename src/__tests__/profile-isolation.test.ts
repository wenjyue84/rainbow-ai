/**
 * US-325: Profile Data Contamination Pre-Commit Hook with Auto-Fix Suggestions
 *
 * Test suite that validates each profile's intent-keywords.json contains
 * zero keywords from other profiles. Uses assertion-based checking against
 * the actual profile data files.
 *
 * AC3: Validates each profile's intent-keywords.json contains zero keywords
 * from other profiles using assertion library.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// ─── Constants ──────────────────────────────────────────────────────────────

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const DATA_ROOT = resolve(currentDir, '..', 'assistant');

const DATA_PELANGI = join(DATA_ROOT, 'data');
const DATA_MAKAN = join(DATA_ROOT, 'data-makan');
const DATA_SOUTHERN = join(DATA_ROOT, 'data-southern');

// ─── Types ──────────────────────────────────────────────────────────────────

interface IntentKeywordEntry {
  intent: string;
  keywords: Record<string, string[]>;
}

interface IntentKeywordsFile {
  intents: IntentKeywordEntry[];
}

interface CrossProfileMatch {
  profile: string;
  intent: string;
  language: string;
  keyword: string;
  matchedAgainst: string;
}

// ─── Profile-Exclusive Definitions ──────────────────────────────────────────

/**
 * Intents shared across all profiles (greeting, thanks, etc.).
 * These are allowed to overlap and are NOT considered contamination.
 */
const SHARED_INTENTS = new Set([
  'greeting',
  'thanks',
  'farewell',
  'contact_staff',
  'complaint',
  'review_feedback',
  'cancel_workflow',
  'accessibility',
  'pricing',
  'directions',
  'unknown',
  'emergency',
]);

/**
 * Intents exclusive to the Makan (cafe) profile.
 */
const MAKAN_EXCLUSIVE_INTENTS = new Set([
  'order_placement',
  'menu_query',
  'food_recommendation',
  'menu_browse_category',
  'order_status',
  'vegetarian_query',
  'menu_filter_dietary',
  'budget_query',
  'specials_query',
  'menu_item_detail',
  'table_reservation',
  'order_feedback_rating',
  'allergen_query',
]);

/**
 * Keywords exclusive to the Makan (cafe) profile.
 * These should NOT appear in hostel profiles (Pelangi/Southern).
 */
const MAKAN_EXCLUSIVE_KEYWORDS = new Set([
  'i want to order',
  'i wanna order',
  'place an order',
  'place order',
  'nak order',
  'nak makan',
  'nak pesan',
  'pesan',
  'tapau',
  'bungkus',
  'bawa balik',
  'food menu',
  'show me the menu',
  'senarai makanan',
  'nak tengok menu',
  'menu makanan',
  'set lunch price',
  'set dinner price',
  'meal price',
  'food price',
  'harga makanan',
  'harga set lunch',
  'harga menu',
  'amazing food',
  'great cafe',
  'love the food',
  'recommend this cafe',
  'kafe yang best',
  'makanan sedap',
  'syorkan kafe ini',
  '点餐',
  '菜单',
  '打包',
].map(k => k.toLowerCase()));

/**
 * Keywords exclusive to hostel profiles (Pelangi/Southern).
 * These should NOT appear in the Makan (cafe) profile.
 */
const HOSTEL_EXCLUSIVE_KEYWORDS = new Set([
  'check in',
  'check-in',
  'checkin',
  'check out',
  'check-out',
  'checkout',
  'daftar masuk',
  'daftar keluar',
  'capsule',
  'kapsul',
  'dorm',
  'dormitory',
  'hostel',
  'bed',
  'katil',
  'deck',
  'lower deck',
  'upper deck',
  'key card',
  'kad kunci',
  'wifi password',
  'door password',
  'room availability',
  'booking',
  'reservation',
  'tempahan',
  'bilik',
  'room',
  'arrival',
  'ketibaan',
  'luggage',
  'bagasi',
  'towel',
  'tuala',
  'pillow',
  'bantal',
  'locker',
  'theft',
  'kecurian',
  'stolen',
  'dicuri',
  'extend stay',
  'late checkout',
  'late check out',
  '入住',
  '退房',
  '胶囊',
  '床位',
  '钥匙卡',
  '行李',
  '毛巾',
  '枕头',
].map(k => k.toLowerCase()));

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadIntentKeywords(dataDir: string): IntentKeywordsFile | null {
  const filePath = join(dataDir, 'intent-keywords.json');
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function extractAllKeywords(data: IntentKeywordsFile): Map<string, { intent: string; lang: string }[]> {
  const result = new Map<string, { intent: string; lang: string }[]>();
  for (const entry of data.intents) {
    for (const [lang, keywords] of Object.entries(entry.keywords)) {
      for (const kw of keywords) {
        const lower = kw.toLowerCase();
        if (!result.has(lower)) result.set(lower, []);
        result.get(lower)!.push({ intent: entry.intent, lang });
      }
    }
  }
  return result;
}

function extractIntentNames(data: IntentKeywordsFile): Set<string> {
  return new Set(data.intents.map(e => e.intent));
}

/**
 * Finds keywords from a forbidden set that appear in a profile's intent-keywords.json.
 * Only checks intents that are NOT shared intents (shared are allowed).
 */
function findCrossProfileKeywords(
  data: IntentKeywordsFile,
  forbiddenKeywords: Set<string>,
  profileName: string,
  sourceProfile: string,
): CrossProfileMatch[] {
  const matches: CrossProfileMatch[] = [];

  for (const entry of data.intents) {
    // Skip shared intents — they are expected to overlap
    if (SHARED_INTENTS.has(entry.intent)) continue;

    for (const [lang, keywords] of Object.entries(entry.keywords)) {
      for (const keyword of keywords) {
        if (forbiddenKeywords.has(keyword.toLowerCase())) {
          matches.push({
            profile: profileName,
            intent: entry.intent,
            language: lang,
            keyword,
            matchedAgainst: sourceProfile,
          });
        }
      }
    }
  }

  return matches;
}

function formatMatches(matches: CrossProfileMatch[]): string {
  if (matches.length === 0) return '';
  const lines = [
    '',
    `Found ${matches.length} cross-profile keyword(s):`,
    '',
  ];
  for (const m of matches) {
    lines.push(`  [${m.intent}] (${m.language}) "${m.keyword}" -> belongs to ${m.matchedAgainst}`);
  }
  lines.push('');
  lines.push('Run "npm run validate-profile-data -- --fix" to auto-remove.');
  return lines.join('\n');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('US-325: Profile Isolation — intent-keywords.json cross-profile validation', () => {

  // ── Pelangi (hostel) must not contain Makan keywords ──────────────────

  describe('Pelangi profile (hostel) must not contain Makan (cafe) keywords', () => {
    const data = loadIntentKeywords(DATA_PELANGI);

    it('should load Pelangi intent-keywords.json successfully', () => {
      expect(data).not.toBeNull();
    });

    it('should not contain any Makan-exclusive keywords in non-shared intents', () => {
      if (!data) return;
      const matches = findCrossProfileKeywords(data, MAKAN_EXCLUSIVE_KEYWORDS, 'pelangi', 'makan');
      expect(matches, formatMatches(matches)).toHaveLength(0);
    });

    it('should not contain any Makan-exclusive intent names', () => {
      if (!data) return;
      const intentNames = extractIntentNames(data);
      const leaked = [...MAKAN_EXCLUSIVE_INTENTS].filter(i => intentNames.has(i));
      expect(
        leaked,
        `Makan-exclusive intents found in Pelangi: ${leaked.join(', ')}`,
      ).toHaveLength(0);
    });
  });

  // ── Southern (hostel) must not contain Makan keywords ─────────────────

  describe('Southern profile (hostel) must not contain Makan (cafe) keywords', () => {
    const data = loadIntentKeywords(DATA_SOUTHERN);

    it('should load Southern intent-keywords.json successfully', () => {
      expect(data).not.toBeNull();
    });

    it('should not contain any Makan-exclusive keywords in non-shared intents', () => {
      if (!data) return;
      const matches = findCrossProfileKeywords(data, MAKAN_EXCLUSIVE_KEYWORDS, 'southern', 'makan');
      expect(matches, formatMatches(matches)).toHaveLength(0);
    });

    it('should not contain any Makan-exclusive intent names', () => {
      if (!data) return;
      const intentNames = extractIntentNames(data);
      const leaked = [...MAKAN_EXCLUSIVE_INTENTS].filter(i => intentNames.has(i));
      expect(
        leaked,
        `Makan-exclusive intents found in Southern: ${leaked.join(', ')}`,
      ).toHaveLength(0);
    });
  });

  // ── Makan (cafe) must not contain hostel keywords ─────────────────────

  describe('Makan profile (cafe) must not contain hostel keywords', () => {
    const data = loadIntentKeywords(DATA_MAKAN);

    it('should load Makan intent-keywords.json successfully', () => {
      expect(data).not.toBeNull();
    });

    it('should not contain any hostel-exclusive keywords in non-shared intents', () => {
      if (!data) return;
      const matches = findCrossProfileKeywords(data, HOSTEL_EXCLUSIVE_KEYWORDS, 'makan', 'hostel');
      expect(matches, formatMatches(matches)).toHaveLength(0);
    });

    it('should not contain hostel-exclusive intent names', () => {
      if (!data) return;
      const intentNames = extractIntentNames(data);
      const hostelOnlyIntents = [
        'checkin_info',
        'check_in_arrival',
        'checkout_info',
        'late_checkout_request',
        'late_checkout',
        'wifi',
        'availability',
        'booking',
        'theft',
        'theft_report',
        'card_locked',
        'security_incident',
        'access_issue',
        'tourist_guide',
        'lower_deck_preference',
        'room_type_preference',
        'facility_orientation',
        'unit_orientation',
        'luggage_storage',
        'bag_storage',
        'capsule_conflict',
        'unit_conflict',
        'extend_stay',
        'stay_extension',
        'prolong_stay',
        'checkout_now',
        'checkout_procedure',
        'billing_dispute',
        'billing_inquiry',
        'payment_made',
        'payment_info',
        'payment',
        'facilities',
        'facilities_info',
        'rules',
        'rules_policy',
        'general_complaint_in_stay',
        'climate_control_complaint',
        'noise_complaint',
        'cleanliness_complaint',
        'facility_malfunction',
        'extra_amenity_request',
        'forgot_item_post_checkout',
        'post_checkout_complaint',
        'local_services',
        'room_type_inquiry',
        'conversation_reset',
        'seasonal_promotion_inquiry',
        'data_portability_request',
      ];

      const leaked = hostelOnlyIntents.filter(i => intentNames.has(i));
      expect(
        leaked,
        `Hostel-exclusive intents found in Makan: ${leaked.join(', ')}`,
      ).toHaveLength(0);
    });
  });

  // ── Cross-profile keyword uniqueness using curated lists ────────────

  describe('Cross-profile keyword uniqueness using curated exclusive lists', () => {
    const makanData = loadIntentKeywords(DATA_MAKAN);
    const southernData = loadIntentKeywords(DATA_SOUTHERN);

    it('Southern should not contain Makan-exclusive keywords', () => {
      if (!southernData) return;
      const matches = findCrossProfileKeywords(southernData, MAKAN_EXCLUSIVE_KEYWORDS, 'southern', 'makan');
      expect(matches, formatMatches(matches)).toHaveLength(0);
    });

    it('Makan should not contain hostel-exclusive keywords', () => {
      if (!makanData) return;
      const matches = findCrossProfileKeywords(makanData, HOSTEL_EXCLUSIVE_KEYWORDS, 'makan', 'hostel');
      expect(matches, formatMatches(matches)).toHaveLength(0);
    });
  });

  // ── Each profile has valid structure ──────────────────────────────────

  describe('All profiles have valid intent-keywords.json structure', () => {
    const profiles = [
      { name: 'pelangi', dir: DATA_PELANGI },
      { name: 'makan', dir: DATA_MAKAN },
      { name: 'southern', dir: DATA_SOUTHERN },
    ];

    for (const { name, dir } of profiles) {
      it(`${name} intent-keywords.json should have valid structure`, () => {
        const data = loadIntentKeywords(dir);
        expect(data).not.toBeNull();
        expect(data!.intents).toBeDefined();
        expect(Array.isArray(data!.intents)).toBe(true);
        expect(data!.intents.length).toBeGreaterThan(0);

        for (const entry of data!.intents) {
          expect(entry.intent).toBeDefined();
          expect(typeof entry.intent).toBe('string');
          expect(entry.keywords).toBeDefined();
          expect(typeof entry.keywords).toBe('object');

          for (const [lang, keywords] of Object.entries(entry.keywords)) {
            expect(Array.isArray(keywords), `${name}/${entry.intent}/${lang} should be an array`).toBe(true);
            expect(keywords.length, `${name}/${entry.intent}/${lang} should have at least one keyword`).toBeGreaterThan(0);
          }
        }
      });
    }
  });
});
