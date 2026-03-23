/**
 * US-314: Profile Keyword Contamination Auto-Fixer — Pure Logic Module
 *
 * Loads the master Pelangi keyword list and removes any matching entries
 * from a target profile's intent-keywords.json. Validates against
 * Pelangi hostel keywords (check-in, checkout, room-type, guest-list patterns).
 *
 * Pure logic module — no file I/O in the core functions (except loadKeywordsFile
 * and writeKeywordsFile helpers). All core functions accept data as parameters
 * for easy testing.
 */

import fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntentKeywordEntry {
  intent: string;
  keywords: Record<string, string[]>;
}

export interface KeywordsFile {
  intents: IntentKeywordEntry[];
}

export interface RemovedKeywordDetail {
  keyword: string;
  language: string;
  reason: string;
}

export interface IntentCleanupDetail {
  intent: string;
  removed_keywords: RemovedKeywordDetail[];
}

export interface ProfileCleanupReport {
  timestamp: string;
  profile: string;
  removed_keywords: number;
  affected_intents: string[];
  success: boolean;
  details: IntentCleanupDetail[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hostel-specific intent patterns that should ONLY exist in Pelangi.
 * If found in makan or southern, the entire intent block is contamination.
 */
export const HOSTEL_SPECIFIC_INTENTS: string[] = [
  'checkin_info',
  'check_in_arrival',
  'checkout_info',
  'checkout_now',
  'checkout_procedure',
  'late_checkout',
  'late_checkout_request',
  'capsule_conflict',
  'lower_deck_preference',
  'facility_orientation',
  'theft_report',
  'theft',
  'card_locked',
  'luggage_storage',
  'bag_storage',
  'stay_extension',
  'extend_stay',
  'prolong_stay',
  'room_type_inquiry',
  'room_type_preference',
  'unit_orientation',
  'unit_conflict',
  'security_incident',
  'access_issue',
  'data_portability_request',
  'seasonal_promotion_inquiry',
];

/**
 * Hostel-specific keyword patterns (partial match). If a keyword in a
 * non-hostel profile contains any of these substrings, it is likely
 * contamination from Pelangi data.
 */
export const HOSTEL_KEYWORD_PATTERNS: string[] = [
  'check in',
  'check-in',
  'checkin',
  'check out',
  'check-out',
  'checkout',
  'capsule',
  'hostel',
  'dorm',
  'dormitory',
  'bunk',
  'locker',
  'luggage',
  'guest list',
  'guest-list',
  'room type',
  'room-type',
  'bed type',
  'bed-type',
  'upper deck',
  'lower deck',
  'upper bunk',
  'lower bunk',
  'key card',
  'keycard',
  'card locked',
  'extend stay',
  'extend my stay',
  'late checkout',
  'late check out',
  'early check in',
  'early checkin',
  '入住',       // check-in (Chinese)
  '退房',       // checkout (Chinese)
  'daftar masuk', // check-in (Malay)
  'daftar keluar', // check-out (Malay)
];

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/**
 * Load and parse an intent-keywords.json file from disk.
 */
export function loadKeywordsFile(filePath: string): KeywordsFile {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as KeywordsFile;
}

/**
 * Write a KeywordsFile back to disk with pretty formatting.
 */
export function writeKeywordsFile(filePath: string, data: KeywordsFile): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Build a set of all keywords (lowercased) from the Pelangi master file,
 * filtered to only hostel-specific intents.
 */
export function buildPelangiHostelKeywordSet(pelangiData: KeywordsFile): Set<string> {
  const keywords = new Set<string>();

  for (const entry of pelangiData.intents) {
    if (HOSTEL_SPECIFIC_INTENTS.includes(entry.intent)) {
      for (const words of Object.values(entry.keywords)) {
        for (const kw of words) {
          keywords.add(kw.toLowerCase().trim());
        }
      }
    }
  }

  return keywords;
}

/**
 * Check if a keyword matches any hostel-specific pattern (substring match).
 */
export function matchesHostelPattern(keyword: string): string | null {
  const lower = keyword.toLowerCase().trim();
  for (const pattern of HOSTEL_KEYWORD_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

/**
 * Determine if a given intent name is hostel-specific and should be
 * removed entirely from non-hostel profiles.
 */
export function isHostelSpecificIntent(intent: string): boolean {
  return HOSTEL_SPECIFIC_INTENTS.includes(intent);
}

/**
 * Run the profile cleanup process.
 *
 * Compares the target profile's intents against the Pelangi master list and:
 * 1. Removes entire intents that are hostel-specific (check-in, checkout, room-type, etc.)
 * 2. Removes individual keywords within shared intents that match Pelangi hostel keywords
 * 3. Removes individual keywords that match hostel keyword patterns
 *
 * Returns the cleanup report and the cleaned KeywordsFile (not yet written to disk).
 */
export function runProfileCleanup(
  profileName: string,
  pelangiData: KeywordsFile,
  targetData: KeywordsFile,
): { report: ProfileCleanupReport; cleaned: KeywordsFile } {
  const pelangiHostelKeywords = buildPelangiHostelKeywordSet(pelangiData);
  const details: IntentCleanupDetail[] = [];
  const cleanedIntents: IntentKeywordEntry[] = [];
  let totalRemoved = 0;
  const affectedIntentSet = new Set<string>();

  for (const entry of targetData.intents) {
    // Case 1: Entire intent is hostel-specific — remove it completely
    if (isHostelSpecificIntent(entry.intent)) {
      const removedKws: RemovedKeywordDetail[] = [];
      for (const [lang, words] of Object.entries(entry.keywords)) {
        for (const kw of words) {
          removedKws.push({
            keyword: kw,
            language: lang,
            reason: `hostel-specific intent '${entry.intent}' — entire intent removed`,
          });
        }
      }
      if (removedKws.length > 0) {
        totalRemoved += removedKws.length;
        affectedIntentSet.add(entry.intent);
        details.push({ intent: entry.intent, removed_keywords: removedKws });
      }
      // Do NOT add to cleanedIntents — entire intent is removed
      continue;
    }

    // Case 2: Shared intent — check individual keywords
    const cleanedKeywords: Record<string, string[]> = {};
    const removedKws: RemovedKeywordDetail[] = [];

    for (const [lang, words] of Object.entries(entry.keywords)) {
      const kept: string[] = [];
      for (const kw of words) {
        const lower = kw.toLowerCase().trim();

        // Check if keyword is in Pelangi hostel keyword set
        if (pelangiHostelKeywords.has(lower)) {
          removedKws.push({
            keyword: kw,
            language: lang,
            reason: `matches Pelangi hostel keyword (exact match in hostel-specific intent)`,
          });
          continue;
        }

        // Check if keyword matches hostel pattern
        const pattern = matchesHostelPattern(kw);
        if (pattern) {
          removedKws.push({
            keyword: kw,
            language: lang,
            reason: `matches hostel keyword pattern: '${pattern}'`,
          });
          continue;
        }

        kept.push(kw);
      }
      if (kept.length > 0) {
        cleanedKeywords[lang] = kept;
      }
    }

    if (removedKws.length > 0) {
      totalRemoved += removedKws.length;
      affectedIntentSet.add(entry.intent);
      details.push({ intent: entry.intent, removed_keywords: removedKws });
    }

    // Only keep the intent if it still has keywords after cleanup
    if (Object.keys(cleanedKeywords).length > 0) {
      cleanedIntents.push({ intent: entry.intent, keywords: cleanedKeywords });
    }
  }

  const report: ProfileCleanupReport = {
    timestamp: new Date().toISOString(),
    profile: profileName,
    removed_keywords: totalRemoved,
    affected_intents: Array.from(affectedIntentSet).sort(),
    success: true,
    details,
  };

  return {
    report,
    cleaned: { intents: cleanedIntents },
  };
}
