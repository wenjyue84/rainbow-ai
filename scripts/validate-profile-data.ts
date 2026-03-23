#!/usr/bin/env tsx
/**
 * US-325: Profile Data Contamination Validator with Auto-Fix
 *
 * Validates that each profile's intent-keywords.json does not contain
 * keywords or intents that belong to other profiles.
 *
 * Usage:
 *   npm run validate-profile-data             # Check mode (exit 1 if contaminated)
 *   npm run validate-profile-data -- --strict  # Same as default (strict check)
 *   npm run validate-profile-data -- --fix     # Auto-remove cross-profile keywords and log fixes
 *
 * Exit codes:
 *   0 — All profiles clean, no contamination detected
 *   1 — Contamination detected (--strict) or fix applied (--fix)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// ─── Types ──────────────────────────────────────────────────────────────────

interface IntentKeywordEntry {
  intent: string;
  keywords: Record<string, string[]>;
}

interface IntentKeywordsFile {
  intents: IntentKeywordEntry[];
}

interface ContaminationViolation {
  profile: string;
  intent: string;
  language: string;
  keyword: string;
  sourceProfile: string;
  reason: string;
}

interface ContaminationFix {
  timestamp: string;
  profile: string;
  intent: string;
  language: string;
  keyword: string;
  sourceProfile: string;
  action: 'removed';
}

// ─── Profile Definitions ────────────────────────────────────────────────────

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(currentDir, '..');
const DATA_ROOT = join(PROJECT_ROOT, 'src', 'assistant');

interface ProfileDef {
  name: string;
  type: 'hostel' | 'cafe';
  dataDir: string;
}

const PROFILES: ProfileDef[] = [
  { name: 'pelangi', type: 'hostel', dataDir: join(DATA_ROOT, 'data') },
  { name: 'makan', type: 'cafe', dataDir: join(DATA_ROOT, 'data-makan') },
  { name: 'southern', type: 'hostel', dataDir: join(DATA_ROOT, 'data-southern') },
];

/**
 * Intents that are universally shared across all profiles.
 * These are NOT considered contamination.
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
 * If found in hostel profiles, it is contamination.
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
 * Keywords that are specific to the Makan (cafe) profile.
 * If found in hostel intent-keywords.json, it is contamination.
 */
const MAKAN_EXCLUSIVE_KEYWORDS = [
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
];

/**
 * Keywords that are specific to hostel profiles (Pelangi/Southern).
 * If found in Makan intent-keywords.json, it is contamination.
 */
const HOSTEL_EXCLUSIVE_KEYWORDS = [
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
];

// ─── Core Functions ─────────────────────────────────────────────────────────

function loadIntentKeywords(dataDir: string): IntentKeywordsFile | null {
  const filePath = join(dataDir, 'intent-keywords.json');
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function getExclusiveKeywordsForProfile(profileType: 'hostel' | 'cafe'): { keywords: string[]; sourceLabel: string } {
  if (profileType === 'cafe') {
    // Cafe profiles should NOT have hostel keywords
    return { keywords: HOSTEL_EXCLUSIVE_KEYWORDS, sourceLabel: 'hostel' };
  } else {
    // Hostel profiles should NOT have makan/cafe keywords
    return { keywords: MAKAN_EXCLUSIVE_KEYWORDS, sourceLabel: 'makan' };
  }
}

function getExclusiveIntentsForProfile(profileType: 'hostel' | 'cafe'): Set<string> {
  if (profileType === 'cafe') {
    // Cafe profiles should NOT have hostel-exclusive intents
    // (We don't define them here since the intents are naturally different)
    return new Set();
  } else {
    // Hostel profiles should NOT have makan-exclusive intents
    return MAKAN_EXCLUSIVE_INTENTS;
  }
}

/**
 * Validates a single profile's intent-keywords.json for cross-profile contamination.
 */
export function validateProfile(profile: ProfileDef): ContaminationViolation[] {
  const data = loadIntentKeywords(profile.dataDir);
  if (!data) return [];

  const violations: ContaminationViolation[] = [];
  const { keywords: forbiddenKeywords, sourceLabel } = getExclusiveKeywordsForProfile(profile.type);
  const forbiddenIntents = getExclusiveIntentsForProfile(profile.type);

  for (const entry of data.intents) {
    // Check if the intent name itself is from another profile
    if (forbiddenIntents.has(entry.intent) && !SHARED_INTENTS.has(entry.intent)) {
      violations.push({
        profile: profile.name,
        intent: entry.intent,
        language: '*',
        keyword: entry.intent,
        sourceProfile: sourceLabel,
        reason: `Intent "${entry.intent}" belongs exclusively to ${sourceLabel} profile`,
      });
    }

    // Check each keyword for cross-profile contamination
    for (const [lang, keywords] of Object.entries(entry.keywords)) {
      for (const keyword of keywords) {
        const lowerKeyword = keyword.toLowerCase();
        for (const forbidden of forbiddenKeywords) {
          if (lowerKeyword === forbidden.toLowerCase()) {
            violations.push({
              profile: profile.name,
              intent: entry.intent,
              language: lang,
              keyword,
              sourceProfile: sourceLabel,
              reason: `Keyword "${keyword}" belongs to ${sourceLabel} profile`,
            });
          }
        }
      }
    }
  }

  return violations;
}

/**
 * Validates all profiles and returns all violations.
 */
export function validateAllProfiles(): Map<string, ContaminationViolation[]> {
  const results = new Map<string, ContaminationViolation[]>();
  for (const profile of PROFILES) {
    results.set(profile.name, validateProfile(profile));
  }
  return results;
}

/**
 * Auto-fix: remove cross-profile keywords from intent-keywords.json files.
 * Returns a list of fixes applied and writes the fixed files.
 */
export function fixAllProfiles(): ContaminationFix[] {
  const allFixes: ContaminationFix[] = [];
  const timestamp = new Date().toISOString();

  for (const profile of PROFILES) {
    const filePath = join(profile.dataDir, 'intent-keywords.json');
    if (!existsSync(filePath)) continue;

    const data: IntentKeywordsFile = JSON.parse(readFileSync(filePath, 'utf-8'));
    const { keywords: forbiddenKeywords, sourceLabel } = getExclusiveKeywordsForProfile(profile.type);
    const forbiddenIntents = getExclusiveIntentsForProfile(profile.type);
    const forbiddenLower = new Set(forbiddenKeywords.map(k => k.toLowerCase()));

    let modified = false;

    // Remove entire intent entries that belong to other profiles
    const originalLength = data.intents.length;
    data.intents = data.intents.filter(entry => {
      if (forbiddenIntents.has(entry.intent) && !SHARED_INTENTS.has(entry.intent)) {
        // Log all keywords from this intent as removed
        for (const [lang, keywords] of Object.entries(entry.keywords)) {
          for (const keyword of keywords) {
            allFixes.push({
              timestamp,
              profile: profile.name,
              intent: entry.intent,
              language: lang,
              keyword,
              sourceProfile: sourceLabel,
              action: 'removed',
            });
          }
        }
        return false; // Remove this intent
      }
      return true;
    });
    if (data.intents.length !== originalLength) {
      modified = true;
    }

    // Remove individual forbidden keywords within remaining intents
    for (const entry of data.intents) {
      for (const [lang, keywords] of Object.entries(entry.keywords)) {
        const filtered = keywords.filter(keyword => {
          if (forbiddenLower.has(keyword.toLowerCase())) {
            allFixes.push({
              timestamp,
              profile: profile.name,
              intent: entry.intent,
              language: lang,
              keyword,
              sourceProfile: sourceLabel,
              action: 'removed',
            });
            return false;
          }
          return true;
        });
        if (filtered.length !== keywords.length) {
          entry.keywords[lang] = filtered;
          modified = true;
        }
      }
    }

    if (modified) {
      writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    }
  }

  return allFixes;
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const isFixMode = args.includes('--fix');
  // --strict is the default behavior (also triggered explicitly)

  if (isFixMode) {
    console.log('Profile Data Contamination Auto-Fix');
    console.log('='.repeat(50));

    const fixes = fixAllProfiles();

    if (fixes.length === 0) {
      console.log('\nNo contamination found. All profiles are clean.');
      process.exit(0);
    }

    // Log fixes to fixture file
    const fixturesDir = join(PROJECT_ROOT, 'src', '__tests__', 'fixtures');
    if (!existsSync(fixturesDir)) {
      mkdirSync(fixturesDir, { recursive: true });
    }
    const fixesPath = join(fixturesDir, 'contamination-fixes.json');

    // Append to existing fixes if file exists
    let existingFixes: ContaminationFix[] = [];
    if (existsSync(fixesPath)) {
      try {
        existingFixes = JSON.parse(readFileSync(fixesPath, 'utf-8'));
      } catch {
        existingFixes = [];
      }
    }
    const allFixes = [...existingFixes, ...fixes];
    writeFileSync(fixesPath, JSON.stringify(allFixes, null, 2) + '\n', 'utf-8');

    console.log(`\nApplied ${fixes.length} fix(es):`);
    for (const fix of fixes) {
      console.log(`  - Removed "${fix.keyword}" from ${fix.profile}/${fix.intent} (${fix.language}) [source: ${fix.sourceProfile}]`);
    }
    console.log(`\nFixes logged to: ${fixesPath}`);
    process.exit(0);
  }

  // Strict/default mode: validate and report
  console.log('Profile Data Contamination Validator (strict mode)');
  console.log('='.repeat(50));

  const results = validateAllProfiles();
  let totalViolations = 0;

  for (const [profileName, violations] of results) {
    const status = violations.length === 0 ? 'CLEAN' : `CONTAMINATED (${violations.length} violations)`;
    console.log(`\n${profileName.toUpperCase()}: ${status}`);

    if (violations.length > 0) {
      totalViolations += violations.length;
      for (const v of violations) {
        console.log(`  - [${v.intent}] (${v.language}) keyword "${v.keyword}" -> belongs to ${v.sourceProfile} profile`);
      }
    }
  }

  console.log('\n' + '='.repeat(50));

  if (totalViolations > 0) {
    console.error(`\nERROR: ${totalViolations} cross-profile contamination violation(s) detected.`);
    console.error('Run "npm run validate-profile-data -- --fix" to auto-remove contaminated keywords.');
    process.exit(1);
  }

  console.log('\nAll profiles are clean. No cross-profile contamination detected.');
  process.exit(0);
}

main();
