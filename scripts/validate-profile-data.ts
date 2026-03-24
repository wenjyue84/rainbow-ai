#!/usr/bin/env tsx
/**
 * US-364: Profile Data File Consistency Validator CLI
 *
 * Validates profile data files for cross-file consistency:
 * - intents defined in intents.json exist in routing.json
 * - routing.json entries have corresponding intents
 * - intent-keywords.json keywords match intents
 * - Zero Pelangi-specific content in Makan/Southern profiles
 *
 * Usage:
 *   npm run validate:profile-data -- --profile makan     # Validate makan profile
 *   npm run validate:profile-data -- --profile southern  # Validate southern profile
 *   npm run validate:profile-data                        # Validate all profiles
 *
 * Exit codes:
 *   0 — All profiles consistent
 *   1 — Violations detected
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

interface IntentEntry {
  id: string;
  name: string;
  [key: string]: any;
}

interface RoutingEntry {
  intent: string;
  [key: string]: any;
}

interface KnowledgeEntry {
  intent: string;
  [key: string]: any;
}

interface ContaminationViolation {
  profile: string;
  intent: string;
  language: string;
  keyword: string;
  sourceProfile: string;
  reason: string;
}

interface ConsistencyViolation {
  type: 'intents_not_in_routing' | 'routing_entries_missing_intents' | 'orphaned_keywords' | 'keyword_contamination';
  profile: string;
  details: string;
  file?: string;
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

function loadIntents(dataDir: string): string[] {
  const filePath = join(dataDir, 'intents.json');
  if (!existsSync(filePath)) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const intentIds: string[] = [];

    // Handle nested structure: { categories: [{ intents: [{ category: "name" }] }] }
    if (data.categories && Array.isArray(data.categories)) {
      for (const category of data.categories) {
        if (category.intents && Array.isArray(category.intents)) {
          for (const intent of category.intents) {
            if (intent.category) {
              intentIds.push(intent.category);
            }
          }
        }
      }
    }

    // Handle flat array structure
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.id) intentIds.push(item.id);
        if (item.name) intentIds.push(item.name);
        if (item.category) intentIds.push(item.category);
      }
    }

    // Handle { intents: [...] } structure
    if (data.intents && Array.isArray(data.intents)) {
      for (const item of data.intents) {
        if (item.id) intentIds.push(item.id);
        if (item.name) intentIds.push(item.name);
        if (item.category) intentIds.push(item.category);
      }
    }

    return intentIds;
  } catch {
    return [];
  }
}

function loadRouting(dataDir: string): Record<string, any> {
  const filePath = join(dataDir, 'routing.json');
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function loadKnowledge(dataDir: string): any {
  const filePath = join(dataDir, 'knowledge.json');
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
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
 * Validates cross-file consistency within a profile.
 * Checks:
 * - intents in intents.json that don't appear in routing.json
 * - routes in routing.json that aren't defined in intents.json
 * - keywords in intent-keywords.json without matching intents
 */
export function validateConsistency(profile: ProfileDef): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  // Load all files
  const intents = loadIntents(profile.dataDir);
  const routing = loadRouting(profile.dataDir);
  const keywords = loadIntentKeywords(profile.dataDir);
  const knowledge = loadKnowledge(profile.dataDir);

  // Create sets for quick lookup
  const intentIds = new Set(intents.filter(i => i && i.length > 0));

  // Extract intent references from routing.json
  // routing format is { [intentName]: { action, ... } }
  const routingIntents = new Set<string>();
  for (const key of Object.keys(routing)) {
    if (key !== 'routes' && typeof routing[key] === 'object' && routing[key] !== null) {
      routingIntents.add(key);
    }
  }

  // Check: intents in intents.json not in routing.json
  for (const intentId of intentIds) {
    if (intentId && !routingIntents.has(intentId)) {
      violations.push({
        type: 'intents_not_in_routing',
        profile: profile.name,
        details: `Intent "${intentId}" defined in intents.json but not found in routing.json`,
        file: 'intents.json -> routing.json',
      });
    }
  }

  // Check: routes in routing.json not defined in intents.json
  for (const routingIntent of routingIntents) {
    if (routingIntent && !intentIds.has(routingIntent)) {
      violations.push({
        type: 'routing_entries_missing_intents',
        profile: profile.name,
        details: `Intent "${routingIntent}" referenced in routing.json but not defined in intents.json`,
        file: 'routing.json -> intents.json',
      });
    }
  }

  // Check: keywords in intent-keywords.json without matching intents
  if (keywords && keywords.intents) {
    const keywordIntents = new Set(keywords.intents.map((k: IntentKeywordEntry) => k.intent));
    for (const keywordIntent of keywordIntents) {
      if (keywordIntent && !intentIds.has(keywordIntent)) {
        violations.push({
          type: 'orphaned_keywords',
          profile: profile.name,
          details: `Keywords defined for intent "${keywordIntent}" but intent not found in intents.json`,
          file: 'intent-keywords.json -> intents.json',
        });
      }
    }
  }

  return violations;
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

  // Parse --profile argument
  const profileIdx = args.indexOf('--profile');
  const targetProfile = profileIdx >= 0 && profileIdx < args.length - 1 ? args[profileIdx + 1] : null;

  // Determine which profiles to validate
  let profilesToValidate = PROFILES;
  if (targetProfile) {
    profilesToValidate = PROFILES.filter(p => p.name === targetProfile);
    if (profilesToValidate.length === 0) {
      console.error(`ERROR: Unknown profile "${targetProfile}"`);
      console.error(`Available profiles: ${PROFILES.map(p => p.name).join(', ')}`);
      process.exit(1);
    }
  }

  console.log('Profile Data File Consistency Validator');
  console.log('='.repeat(60));

  let totalViolations = 0;
  let totalContamination = 0;

  for (const profile of profilesToValidate) {
    console.log(`\n📋 Validating profile: ${profile.name.toUpperCase()}`);
    console.log('-'.repeat(60));

    // Check contamination (keywords)
    const contamViolations = validateProfile(profile);
    if (contamViolations.length > 0) {
      totalContamination += contamViolations.length;
      console.log(`\n  ⚠️  Keyword Contamination (${contamViolations.length}):`);
      for (const v of contamViolations) {
        console.log(`     - [${v.intent}] (${v.language}) keyword "${v.keyword}" -> belongs to ${v.sourceProfile} profile`);
      }
    }

    // Check cross-file consistency
    const consistencyViolations = validateConsistency(profile);
    if (consistencyViolations.length > 0) {
      totalViolations += consistencyViolations.length;
      console.log(`\n  ⚠️  Cross-File Inconsistencies (${consistencyViolations.length}):`);
      for (const v of consistencyViolations) {
        console.log(`     - [${v.type}] ${v.details}`);
        if (v.file) console.log(`       (${v.file})`);
      }
    }

    if (contamViolations.length === 0 && consistencyViolations.length === 0) {
      console.log('  ✅ Profile is clean (no violations detected)');
    }
  }

  console.log('\n' + '='.repeat(60));

  const totalIssues = totalViolations + totalContamination;
  if (totalIssues > 0) {
    console.error(`\n❌ FAILED: ${totalIssues} issue(s) detected`);
    console.error(`  - ${totalContamination} keyword contamination violation(s)`);
    console.error(`  - ${totalViolations} cross-file consistency violation(s)`);
    process.exit(1);
  }

  console.log('\n✅ All profiles are consistent and clean.');
  process.exit(0);
}

main();
