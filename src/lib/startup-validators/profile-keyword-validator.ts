/**
 * US-210: Profile-specific keyword contamination blocker
 *
 * Validates that profile intent-keywords.json files do not contain keywords
 * belonging to a different business domain. Designed to run at startup to
 * prevent cross-profile contamination from reaching production.
 *
 * Blocked keywords per profile:
 *   - data-makan:    hostel, pelangi, capsule, check-in
 *   - data-southern: cafe, makan, menu, order
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KeywordViolation {
  profile: string;
  intent: string;
  language: string;
  keyword: string;
  blockedTerm: string;
}

export interface KeywordValidationResult {
  profile: string;
  valid: boolean;
  violations: KeywordViolation[];
}

interface IntentKeywordsFile {
  intents: Array<{
    intent: string;
    keywords: Record<string, string[]>;
  }>;
}

// ─── Blocked keyword lists per profile ──────────────────────────────────────

export const BLOCKED_KEYWORDS: Record<string, string[]> = {
  'data-makan': ['hostel', 'pelangi', 'capsule', 'check-in'],
  'data-southern': ['cafe', 'makan', 'menu', 'order'],
};

// ─── Core validation ────────────────────────────────────────────────────────

/**
 * Scan a parsed intent-keywords structure for blocked terms.
 *
 * Each keyword string is checked (case-insensitive) for whether it contains
 * any of the blocked terms for the given profile.
 */
export function findKeywordViolations(
  profile: string,
  data: IntentKeywordsFile,
  blockedTerms: string[],
): KeywordViolation[] {
  const violations: KeywordViolation[] = [];

  if (!data.intents || !Array.isArray(data.intents)) {
    return violations;
  }

  for (const entry of data.intents) {
    const intent = entry.intent;
    const keywords = entry.keywords;
    if (!keywords || typeof keywords !== 'object') continue;

    for (const [lang, keywordList] of Object.entries(keywords)) {
      if (!Array.isArray(keywordList)) continue;

      for (const kw of keywordList) {
        const kwLower = String(kw).toLowerCase();
        for (const blocked of blockedTerms) {
          if (kwLower.includes(blocked.toLowerCase())) {
            violations.push({
              profile,
              intent,
              language: lang,
              keyword: String(kw),
              blockedTerm: blocked,
            });
          }
        }
      }
    }
  }

  return violations;
}

/**
 * Validate a single profile's intent-keywords.json against its blocked list.
 *
 * @param profile  - Profile directory name (e.g. 'data-makan', 'data-southern')
 * @param rootDir  - Project root directory (default: process.cwd())
 * @returns Validation result with any violations found
 */
export function validateProfileKeywords(
  profile: string,
  rootDir: string = process.cwd(),
): KeywordValidationResult {
  const blockedTerms = BLOCKED_KEYWORDS[profile];
  if (!blockedTerms) {
    return { profile, valid: true, violations: [] };
  }

  const filePath = join(rootDir, 'src', 'assistant', profile, 'intent-keywords.json');

  if (!existsSync(filePath)) {
    // If the file doesn't exist, there's nothing to contaminate
    return { profile, valid: true, violations: [] };
  }

  const content = readFileSync(filePath, 'utf-8');
  const data: IntentKeywordsFile = JSON.parse(content);
  const violations = findKeywordViolations(profile, data, blockedTerms);

  return {
    profile,
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Format violations into a remediation error message suitable for stdout logging.
 */
export function formatViolationError(result: KeywordValidationResult): string {
  if (result.valid) return '';

  const lines: string[] = [
    `[STARTUP] Profile keyword contamination detected in ${result.profile}:`,
  ];

  for (const v of result.violations) {
    lines.push(
      `  - intent "${v.intent}" (${v.language}): keyword "${v.keyword}" contains blocked term "${v.blockedTerm}"`,
    );
    lines.push(
      `    Remove ${v.keyword} from src/assistant/data/${result.profile}/intent-keywords.json and rebuild`,
    );
  }

  return lines.join('\n');
}

/**
 * Run keyword contamination validation for all known profiles.
 * On violation: logs error to stdout and throws to halt startup.
 *
 * @param rootDir - Project root directory (default: process.cwd())
 * @throws Error if any profile contains contaminated keywords
 */
export function enforceProfileKeywordPurity(
  rootDir: string = process.cwd(),
): void {
  const profiles = Object.keys(BLOCKED_KEYWORDS);
  const allViolations: KeywordViolation[] = [];

  for (const profile of profiles) {
    const result = validateProfileKeywords(profile, rootDir);
    if (!result.valid) {
      const errorMsg = formatViolationError(result);
      console.error(errorMsg);
      allViolations.push(...result.violations);
    }
  }

  if (allViolations.length > 0) {
    throw new Error(
      `Profile keyword contamination: ${allViolations.length} violation(s) found. ` +
        `See logged errors above for remediation steps.`,
    );
  }
}
