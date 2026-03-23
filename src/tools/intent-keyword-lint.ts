/**
 * US-305: Intent Keyword Conflict Scanner — Cross-Intent Detection
 *
 * Detects same keywords appearing in multiple intents within a single profile,
 * creating classifier ambiguity. Reports conflicts and suggests removal from
 * the lower-priority (later-listed) intent.
 *
 * Pure logic module — no CLI concerns. The CLI entry point is
 * `intent-keyword-lint-cli.ts`, invoked via `npm run lint:intent-keywords`.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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

export interface KeywordConflict {
  keyword: string;
  intents: string[];
  profile: string;
  /** The intent from which the keyword should be removed (last in list). */
  removeFrom: string;
}

export interface LintReport {
  timestamp: string;
  profiles_scanned: string[];
  total_conflicts: number;
  conflicts: KeywordConflict[];
}

// ---------------------------------------------------------------------------
// Profile directory mapping
// ---------------------------------------------------------------------------

export const PROFILE_DIRS: Record<string, string> = {
  'data-pelangi': 'src/assistant/data',
  'data-makan': 'src/assistant/data-makan',
  'data-southern': 'src/assistant/data-southern',
};

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Find keywords that appear in more than one intent within a single profile.
 *
 * Returns a list of conflicts. For each conflict the `removeFrom` field
 * points to the *last* intent in the intents list that uses the keyword
 * (i.e., the lower-priority one, assuming earlier = higher priority).
 */
export function findIntraProfileConflicts(
  data: KeywordsFile,
  profileName: string,
): KeywordConflict[] {
  // keyword (normalized) -> ordered list of intents that use it
  const keywordToIntents = new Map<string, string[]>();

  if (!data.intents || !Array.isArray(data.intents)) {
    return [];
  }

  for (const entry of data.intents) {
    if (!entry.keywords || typeof entry.keywords !== 'object') continue;

    for (const [_lang, words] of Object.entries(entry.keywords)) {
      if (!Array.isArray(words)) continue;

      for (const kw of words) {
        const normalized = String(kw).toLowerCase().trim();
        if (!normalized) continue;

        if (!keywordToIntents.has(normalized)) {
          keywordToIntents.set(normalized, []);
        }

        const intentsList = keywordToIntents.get(normalized)!;
        // Avoid duplicating the same intent name (could happen if keyword
        // appears in multiple language arrays of the same intent)
        if (!intentsList.includes(entry.intent)) {
          intentsList.push(entry.intent);
        }
      }
    }
  }

  // Collect conflicts: keywords appearing in 2+ intents
  const conflicts: KeywordConflict[] = [];

  for (const [keyword, intents] of keywordToIntents) {
    if (intents.length < 2) continue;

    conflicts.push({
      keyword,
      intents: [...intents],
      profile: profileName,
      removeFrom: intents[intents.length - 1],
    });
  }

  // Sort alphabetically by keyword for deterministic output
  conflicts.sort((a, b) => a.keyword.localeCompare(b.keyword));

  return conflicts;
}

/**
 * Scan all profiles and return a combined lint report.
 */
export function lintAllProfiles(
  profileData: Map<string, KeywordsFile>,
): LintReport {
  const allConflicts: KeywordConflict[] = [];

  for (const [profileName, data] of profileData) {
    const conflicts = findIntraProfileConflicts(data, profileName);
    allConflicts.push(...conflicts);
  }

  return {
    timestamp: new Date().toISOString(),
    profiles_scanned: Array.from(profileData.keys()),
    total_conflicts: allConflicts.length,
    conflicts: allConflicts,
  };
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

/**
 * Format a single conflict in the required report format:
 *   CONFLICT: keyword "booking" appears in [booking_request, booking_inquiry]
 *   in profile data-pelangi (remove from booking_inquiry to disambiguate)
 */
export function formatConflictLine(c: KeywordConflict): string {
  return (
    `CONFLICT: keyword "${c.keyword}" appears in [${c.intents.join(', ')}]` +
    ` in profile ${c.profile}` +
    ` (remove from ${c.removeFrom} to disambiguate)`
  );
}

/**
 * Format a human-readable report.
 */
export function formatHumanReport(report: LintReport): string {
  const lines: string[] = [];

  lines.push('=== Intent Keyword Conflict Scanner ===');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Profiles scanned: ${report.profiles_scanned.join(', ')}`);
  lines.push(`Total conflicts: ${report.total_conflicts}`);
  lines.push('');

  if (report.total_conflicts === 0) {
    lines.push('No cross-intent keyword conflicts detected.');
  } else {
    for (const c of report.conflicts) {
      lines.push(formatConflictLine(c));
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

/**
 * Load all profile intent-keywords.json files from disk.
 */
export function loadAllProfiles(rootDir: string): Map<string, KeywordsFile> {
  const profileData = new Map<string, KeywordsFile>();

  for (const [name, dir] of Object.entries(PROFILE_DIRS)) {
    const filePath = join(rootDir, dir, 'intent-keywords.json');
    if (!existsSync(filePath)) {
      console.warn(`Warning: ${filePath} not found, skipping profile '${name}'`);
      continue;
    }
    const raw = readFileSync(filePath, 'utf-8');
    profileData.set(name, JSON.parse(raw) as KeywordsFile);
  }

  return profileData;
}
