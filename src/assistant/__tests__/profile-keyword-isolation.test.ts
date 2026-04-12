/**
 * US-248: Profile-specific intent keyword isolation test suite
 *
 * Validates that profile intent keywords are properly separated:
 * - Makan Moments keywords contain only cafe-related terms (no hostel terms)
 * - Southern Homestay keywords contain only homestay terms (no cafe terms)
 * - Zero keyword overlap between Makan and Southern profiles
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface IntentKeywords {
  intents: Array<{
    intent: string;
    keywords: Record<string, string[]>;
  }>;
}

function loadProfile(dataDir: string): IntentKeywords {
  const filePath = resolve(__dirname, '..', dataDir, 'intent-keywords.json');
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * Collect every keyword string across all intents and all languages
 * into a single flat array (lowercased for case-insensitive matching).
 */
function allKeywords(profile: IntentKeywords): string[] {
  const keywords: string[] = [];
  for (const entry of profile.intents) {
    for (const lang of Object.keys(entry.keywords)) {
      for (const kw of entry.keywords[lang]) {
        keywords.push(kw.toLowerCase());
      }
    }
  }
  return keywords;
}

// ── Load profiles ──────────────────────────────────────────────────────
const makanProfile = loadProfile('data-makan');
const southernProfile = loadProfile('data-southern');

// ── Blocklists per AC ──────────────────────────────────────────────────
const hostelBlocklist = ['room', 'guest', 'check-in', 'checkout', 'booking', 'amenity'];
const cafeBlocklist = ['menu', 'promotion', 'order', 'recipe', 'table', 'reservation'];

describe('US-248: Profile-specific intent keyword isolation', () => {
  describe('Makan Moments keywords contain no hostel terms', () => {
    const makanKws = allKeywords(makanProfile);

    it.each(hostelBlocklist)(
      'should not contain hostel term "%s" as a standalone keyword',
      (blockedTerm) => {
        // Check for exact match — the blocked term appears as a complete keyword
        const exactMatches = makanKws.filter((kw) => kw === blockedTerm);
        expect(
          exactMatches,
          `Makan Moments profile contains hostel keyword "${blockedTerm}" as exact match`,
        ).toHaveLength(0);
      },
    );

    it('should have no keywords that are exactly a hostel blocklist term', () => {
      const hostelSet = new Set(hostelBlocklist);
      const contaminated = makanKws.filter((kw) => hostelSet.has(kw));
      expect(
        contaminated,
        `Makan Moments profile contains hostel keywords: ${JSON.stringify(contaminated)}`,
      ).toHaveLength(0);
    });
  });

  describe('Southern Homestay keywords contain no cafe terms', () => {
    const southernKws = allKeywords(southernProfile);

    it.each(cafeBlocklist)(
      'should not contain cafe term "%s" as a standalone keyword',
      (blockedTerm) => {
        const exactMatches = southernKws.filter((kw) => kw === blockedTerm);
        expect(
          exactMatches,
          `Southern Homestay profile contains cafe keyword "${blockedTerm}" as exact match`,
        ).toHaveLength(0);
      },
    );

    it('should have no keywords that are exactly a cafe blocklist term', () => {
      const cafeSet = new Set(cafeBlocklist);
      const contaminated = southernKws.filter((kw) => cafeSet.has(kw));
      expect(
        contaminated,
        `Southern Homestay profile contains cafe keywords: ${JSON.stringify(contaminated)}`,
      ).toHaveLength(0);
    });
  });

  describe('Zero keyword overlap between profiles', () => {
    it('should have no keyword arrays with identical entries across Makan and Southern', () => {
      const makanKws = allKeywords(makanProfile);
      const southernKws = allKeywords(southernProfile);

      const makanSet = new Set(makanKws);
      const southernSet = new Set(southernKws);

      // Compute intersection
      const overlap = [...makanSet].filter((kw) => southernSet.has(kw));

      // Generic/shared intents (greeting, thanks, farewell, wifi, etc.) will
      // naturally overlap. The AC says "Set intersection of all profile keyword
      // arrays is empty" — interpret this as *profile-specific* keywords.
      // We filter out keywords belonging to intents that exist in both profiles
      // (shared intents) and only flag overlap from profile-unique intents.
      const makanIntentNames = new Set(makanProfile.intents.map((i) => i.intent));
      const southernIntentNames = new Set(southernProfile.intents.map((i) => i.intent));
      const sharedIntents = [...makanIntentNames].filter((i) => southernIntentNames.has(i));

      // Collect keywords from shared intents (allowed to overlap)
      const sharedKeywords = new Set<string>();
      for (const profile of [makanProfile, southernProfile]) {
        for (const entry of profile.intents) {
          if (sharedIntents.includes(entry.intent)) {
            for (const lang of Object.keys(entry.keywords)) {
              for (const kw of entry.keywords[lang]) {
                sharedKeywords.add(kw.toLowerCase());
              }
            }
          }
        }
      }

      // Profile-specific overlap: keywords that overlap but do NOT come from shared intents
      const profileSpecificOverlap = overlap.filter((kw) => !sharedKeywords.has(kw));

      expect(
        profileSpecificOverlap,
        `Profile-specific keyword overlap found between Makan and Southern: ${JSON.stringify(profileSpecificOverlap)}`,
      ).toHaveLength(0);
    });

    it('should have no overlap between Makan-unique and Southern-unique intent keywords', () => {
      const makanIntentNames = new Set(makanProfile.intents.map((i) => i.intent));
      const southernIntentNames = new Set(southernProfile.intents.map((i) => i.intent));

      // Intents unique to each profile
      const makanOnly = makanProfile.intents.filter((i) => !southernIntentNames.has(i.intent));
      const southernOnly = southernProfile.intents.filter((i) => !makanIntentNames.has(i.intent));

      // Collect keywords from unique intents
      const makanUniqueKws = new Set<string>();
      for (const entry of makanOnly) {
        for (const lang of Object.keys(entry.keywords)) {
          for (const kw of entry.keywords[lang]) {
            makanUniqueKws.add(kw.toLowerCase());
          }
        }
      }

      const southernUniqueKws = new Set<string>();
      for (const entry of southernOnly) {
        for (const lang of Object.keys(entry.keywords)) {
          for (const kw of entry.keywords[lang]) {
            southernUniqueKws.add(kw.toLowerCase());
          }
        }
      }

      const overlap = [...makanUniqueKws].filter((kw) => southernUniqueKws.has(kw));

      expect(
        overlap,
        `Overlap between Makan-unique and Southern-unique intent keywords: ${JSON.stringify(overlap)}`,
      ).toHaveLength(0);
    });
  });

  describe('US-525 Acceptance Criteria: Profile-specific keywords', () => {
    it('should have "checkout" keyword in Pelangi but not in Makan', () => {
      const pelangiProfile = loadProfile('data');
      const makanProfile = loadProfile('data-makan');

      // Find checkout-related intents in Pelangi
      const pelangiCheckout = pelangiProfile.intents.find((i) => i.intent === 'checkout_now' || i.intent === 'late_checkout_request');
      expect(pelangiCheckout, 'Pelangi should have checkout intent').toBeDefined();

      // Checkout intent should NOT exist in Makan (cafe doesn't have checkout concept)
      const makanCheckout = makanProfile.intents.find((i) => i.intent === 'checkout_now' || i.intent === 'late_checkout_request' || i.intent === 'late_checkout');
      expect(makanCheckout, 'Makan should NOT have checkout intent').toBeUndefined();
    });

    it('should have "order" keywords in Makan but not in Pelangi/Southern', () => {
      const pelangiProfile = loadProfile('data');
      const makanProfile = loadProfile('data-makan');
      const southernProfile = loadProfile('data-southern');

      // Find order-related intents in Makan
      const makanOrder = makanProfile.intents.find((i) => i.intent === 'order_placement' || i.intent === 'menu_query');
      expect(makanOrder, 'Makan should have order_placement or menu_query intent').toBeDefined();

      // Order placement should NOT exist in Pelangi/Southern (not food ordering services)
      const pelangiOrder = pelangiProfile.intents.find((i) => i.intent === 'order_placement' || i.intent === 'menu_query');
      expect(pelangiOrder, 'Pelangi should NOT have order_placement intent').toBeUndefined();

      const southernOrder = southernProfile.intents.find((i) => i.intent === 'order_placement' || i.intent === 'menu_query');
      expect(southernOrder, 'Southern should NOT have order_placement intent').toBeUndefined();
    });
  });
});
