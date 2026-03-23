/**
 * US-233: Startup Profile Data Isolation Enforcement
 *
 * Compares intent-keywords.json across all profiles (Pelangi, Makan, Southern)
 * and identifies keywords appearing in multiple profiles. On startup, logs
 * ERROR and exits if cross-profile keyword contamination is detected.
 *
 * This complements profile-keyword-validator.ts (US-210) which checks for
 * blocked terms within a single profile. This module instead detects actual
 * keyword overlap across profiles, catching copy-paste contamination.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProfileKeywordMap {
  /** Profile name -> Set of all keywords (lowercased) */
  [profileName: string]: Set<string>;
}

export interface CrossProfileViolation {
  keyword: string;
  profiles: string[];
}

export interface ProfileIsolationResult {
  valid: boolean;
  violations: CrossProfileViolation[];
}

interface IntentKeywordsFile {
  intents: Array<{
    intent: string;
    keywords: Record<string, string[]>;
  }>;
}

// ─── Profile definitions ────────────────────────────────────────────────────

/**
 * Maps profile name to its data directory (relative to src/assistant/).
 */
export const PROFILE_DATA_DIRS: Record<string, string> = {
  pelangi: 'data',
  makan: 'data-makan',
  southern: 'data-southern',
};

// ─── Generic keywords to exclude from cross-profile comparison ──────────────

/**
 * Common keywords that legitimately appear in multiple profiles (greetings,
 * thanks, cancellations, etc.). These are excluded from violation detection.
 */
const COMMON_INTENTS = new Set([
  'greeting',
  'thanks',
  'farewell',
  'cancel_workflow',
  'complaint',
  'contact_staff',
  'local_services',
  'accessibility',
]);

// ─── Core logic ─────────────────────────────────────────────────────────────

/**
 * Extract all keywords from a parsed intent-keywords.json, excluding common intents.
 * Returns a Set of lowercased keyword strings.
 */
export function extractProfileKeywords(
  data: IntentKeywordsFile,
  excludeIntents: Set<string> = COMMON_INTENTS,
): Set<string> {
  const keywords = new Set<string>();

  if (!data.intents || !Array.isArray(data.intents)) {
    return keywords;
  }

  for (const entry of data.intents) {
    if (excludeIntents.has(entry.intent)) continue;
    if (!entry.keywords || typeof entry.keywords !== 'object') continue;

    for (const [_lang, keywordList] of Object.entries(entry.keywords)) {
      if (!Array.isArray(keywordList)) continue;
      for (const kw of keywordList) {
        keywords.add(String(kw).toLowerCase().trim());
      }
    }
  }

  return keywords;
}

/**
 * Load intent-keywords.json for a profile and extract its keywords.
 *
 * @param profileName - Profile identifier (e.g. 'pelangi', 'makan')
 * @param rootDir - Project root directory
 * @param excludeIntents - Set of intent names to exclude from comparison
 * @returns Set of lowercased keywords, or null if file not found
 */
export function loadProfileKeywords(
  profileName: string,
  rootDir: string = process.cwd(),
  excludeIntents: Set<string> = COMMON_INTENTS,
): Set<string> | null {
  const dataDir = PROFILE_DATA_DIRS[profileName];
  if (!dataDir) return null;

  const filePath = join(rootDir, 'src', 'assistant', dataDir, 'intent-keywords.json');
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf-8');
  const data: IntentKeywordsFile = JSON.parse(content);
  return extractProfileKeywords(data, excludeIntents);
}

/**
 * Compare keyword sets across profiles and find keywords appearing in multiple.
 *
 * @param profileKeywords - Map of profile name -> keyword set
 * @returns Array of violations (keyword + which profiles it appears in)
 */
export function findCrossProfileKeywords(
  profileKeywords: ProfileKeywordMap,
): CrossProfileViolation[] {
  // Build reverse index: keyword -> list of profiles containing it
  const keywordProfiles = new Map<string, string[]>();
  const profileNames = Object.keys(profileKeywords);

  for (const profile of profileNames) {
    const keywords = profileKeywords[profile];
    for (const kw of keywords) {
      if (!keywordProfiles.has(kw)) {
        keywordProfiles.set(kw, []);
      }
      keywordProfiles.get(kw)!.push(profile);
    }
  }

  // Collect violations: keywords in 2+ profiles
  const violations: CrossProfileViolation[] = [];
  for (const [keyword, profiles] of keywordProfiles) {
    if (profiles.length > 1) {
      violations.push({
        keyword,
        profiles: profiles.sort(),
      });
    }
  }

  // Sort by keyword for deterministic output
  violations.sort((a, b) => a.keyword.localeCompare(b.keyword));
  return violations;
}

/**
 * Format a cross-profile violation report for logging.
 */
export function formatIsolationViolations(
  violations: CrossProfileViolation[],
): string {
  if (violations.length === 0) return '';

  const lines: string[] = [
    `[STARTUP] Profile data isolation check failed — ${violations.length} cross-profile keyword(s) detected:`,
    '',
  ];

  for (const v of violations) {
    lines.push(
      `PROFILE_ISOLATION_VIOLATION: keyword "${v.keyword}" found in [${v.profiles.join(', ')}]; must remove from ${v.profiles.length > 2 ? 'non-primary profiles' : v.profiles[v.profiles.length - 1]} profile`,
    );
  }

  return lines.join('\n');
}

/**
 * Main startup validator: enforce profile data isolation across all profiles.
 *
 * Loads intent-keywords.json from each profile, compares keywords, and
 * throws an error if any keyword appears in multiple profiles.
 *
 * Common intents (greeting, thanks, farewell, cancel_workflow, complaint,
 * contact_staff, local_services, accessibility) are excluded from comparison
 * since they legitimately share keywords.
 *
 * @param rootDir - Project root directory (default: process.cwd())
 * @throws Error if cross-profile keyword contamination is detected
 */
export function enforceProfileDataIsolation(
  rootDir: string = process.cwd(),
): void {
  const profileKeywords: ProfileKeywordMap = {};

  for (const profileName of Object.keys(PROFILE_DATA_DIRS)) {
    const keywords = loadProfileKeywords(profileName, rootDir);
    if (keywords) {
      profileKeywords[profileName] = keywords;
    }
  }

  // Need at least 2 profiles to compare
  if (Object.keys(profileKeywords).length < 2) {
    return;
  }

  const violations = findCrossProfileKeywords(profileKeywords);

  if (violations.length > 0) {
    const report = formatIsolationViolations(violations);
    console.error(report);
    throw new Error(
      `Profile data isolation failed: ${violations.length} keyword(s) found in multiple profiles. ` +
        `See logged errors above for details.`,
    );
  }
}
