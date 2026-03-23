/**
 * US-275: Profile Intent Keyword Scope Validator
 *
 * Detects keywords that could potentially match intents across profiles,
 * preventing cross-contamination false positives and enforcing strict
 * profile separation.
 *
 * Pure logic module — no CLI concerns. The CLI entry point is invoked
 * via `npm run validate:keyword-scope`.
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

export interface KeywordScopeOverlap {
  profile_a: string;
  profile_b: string;
  keyword: string;
  overlap_count: number;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface KeywordScopeReport {
  timestamp: string;
  profiles_analyzed: string[];
  total_overlaps: number;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  overlaps: KeywordScopeOverlap[];
}

// ---------------------------------------------------------------------------
// Profile directory mapping
// ---------------------------------------------------------------------------

export const PROFILE_DIRS: Record<string, string> = {
  pelangi: 'src/assistant/data',
  makan: 'src/assistant/data-makan',
  southern: 'src/assistant/data-southern',
};

// ---------------------------------------------------------------------------
// Intents that are legitimately shared across profiles (greetings, etc.)
// These get LOW risk instead of being filtered out entirely so operators
// can still audit them.
// ---------------------------------------------------------------------------

const SHARED_INTENTS = new Set([
  'greeting',
  'thanks',
  'farewell',
  'cancel_workflow',
]);

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Extract a map of keyword -> set of intent names from a KeywordsFile.
 * All keywords are lowercased and trimmed.
 */
export function extractKeywordIntentMap(
  data: KeywordsFile,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  if (!data.intents || !Array.isArray(data.intents)) {
    return result;
  }

  for (const entry of data.intents) {
    if (!entry.keywords || typeof entry.keywords !== 'object') continue;
    for (const [_lang, words] of Object.entries(entry.keywords)) {
      if (!Array.isArray(words)) continue;
      for (const kw of words) {
        const normalized = String(kw).toLowerCase().trim();
        if (!result.has(normalized)) {
          result.set(normalized, new Set());
        }
        result.get(normalized)!.add(entry.intent);
      }
    }
  }

  return result;
}

/**
 * Determine risk level for a keyword overlap between two profiles.
 *
 * HIGH  — keyword is tied to a domain-specific intent in at least one profile
 *         (e.g., "booking" in pelangi's booking intent is hostel-specific)
 * MEDIUM — keyword exists in non-shared intents but not obviously domain-bound
 * LOW   — keyword only appears in universally-shared intents (greeting, etc.)
 */
export function classifyRisk(
  _keyword: string,
  intentsA: Set<string>,
  intentsB: Set<string>,
): 'HIGH' | 'MEDIUM' | 'LOW' {
  const allIntents = new Set([...intentsA, ...intentsB]);

  // If ALL intents that use this keyword are in the shared set, LOW risk
  let allShared = true;
  for (const intent of allIntents) {
    if (!SHARED_INTENTS.has(intent)) {
      allShared = false;
      break;
    }
  }
  if (allShared) return 'LOW';

  // If any intent from one profile does NOT appear in the shared set, it's
  // at least MEDIUM. Promote to HIGH when both profiles have non-shared intents
  // using the same keyword (strong signal of cross-contamination).
  let aHasNonShared = false;
  for (const i of intentsA) {
    if (!SHARED_INTENTS.has(i)) { aHasNonShared = true; break; }
  }
  let bHasNonShared = false;
  for (const i of intentsB) {
    if (!SHARED_INTENTS.has(i)) { bHasNonShared = true; break; }
  }

  if (aHasNonShared && bHasNonShared) return 'HIGH';
  return 'MEDIUM';
}

/**
 * Compare keyword scopes across all profiles and return overlapping entries.
 */
export function findKeywordScopeOverlaps(
  profileData: Map<string, KeywordsFile>,
): KeywordScopeOverlap[] {
  const overlaps: KeywordScopeOverlap[] = [];
  const profiles = Array.from(profileData.keys());

  // Build per-profile keyword -> intents maps
  const profileMaps = new Map<string, Map<string, Set<string>>>();
  for (const [name, data] of profileData) {
    profileMaps.set(name, extractKeywordIntentMap(data));
  }

  // Compare each pair of profiles
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const profA = profiles[i];
      const profB = profiles[j];
      const mapA = profileMaps.get(profA)!;
      const mapB = profileMaps.get(profB)!;

      // Find keywords present in both profiles
      for (const [keyword, intentsA] of mapA) {
        if (!mapB.has(keyword)) continue;
        const intentsB = mapB.get(keyword)!;

        // overlap_count = total number of intent appearances across both profiles
        const overlapCount = intentsA.size + intentsB.size;
        const riskLevel = classifyRisk(keyword, intentsA, intentsB);

        overlaps.push({
          profile_a: profA,
          profile_b: profB,
          keyword,
          overlap_count: overlapCount,
          risk_level: riskLevel,
        });
      }
    }
  }

  // Sort: HIGH first, then MEDIUM, then LOW; within same risk by keyword
  const riskOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  overlaps.sort((a, b) => {
    const riskDiff = riskOrder[a.risk_level] - riskOrder[b.risk_level];
    if (riskDiff !== 0) return riskDiff;
    return a.keyword.localeCompare(b.keyword);
  });

  return overlaps;
}

/**
 * Build a full scope validation report.
 */
export function buildScopeReport(
  profileData: Map<string, KeywordsFile>,
): KeywordScopeReport {
  const overlaps = findKeywordScopeOverlaps(profileData);

  return {
    timestamp: new Date().toISOString(),
    profiles_analyzed: Array.from(profileData.keys()),
    total_overlaps: overlaps.length,
    high_risk_count: overlaps.filter(o => o.risk_level === 'HIGH').length,
    medium_risk_count: overlaps.filter(o => o.risk_level === 'MEDIUM').length,
    low_risk_count: overlaps.filter(o => o.risk_level === 'LOW').length,
    overlaps,
  };
}

// ---------------------------------------------------------------------------
// CSV formatter
// ---------------------------------------------------------------------------

/**
 * Format overlaps as CSV with columns:
 * profile_a,profile_b,keyword,overlap_count,risk_level
 */
export function formatScopeCSV(overlaps: KeywordScopeOverlap[]): string {
  const lines = ['profile_a,profile_b,keyword,overlap_count,risk_level'];
  for (const o of overlaps) {
    // Escape commas in keywords
    const kw = o.keyword.includes(',') ? `"${o.keyword}"` : o.keyword;
    lines.push(`${o.profile_a},${o.profile_b},${kw},${o.overlap_count},${o.risk_level}`);
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

// ---------------------------------------------------------------------------
// Startup validation hook
// ---------------------------------------------------------------------------

/**
 * Validate keyword scope isolation at startup. Logs warnings for HIGH-risk
 * overlaps but does not throw — this is an advisory check.
 *
 * @param rootDir - Project root directory
 * @returns The scope report (for testing/inspection)
 */
export function validateKeywordScopeOnStartup(
  rootDir: string = process.cwd(),
): KeywordScopeReport {
  const profileData = loadAllProfiles(rootDir);

  if (profileData.size < 2) {
    return {
      timestamp: new Date().toISOString(),
      profiles_analyzed: Array.from(profileData.keys()),
      total_overlaps: 0,
      high_risk_count: 0,
      medium_risk_count: 0,
      low_risk_count: 0,
      overlaps: [],
    };
  }

  const report = buildScopeReport(profileData);

  if (report.high_risk_count > 0) {
    console.warn(
      `[STARTUP] Keyword scope validation: ${report.high_risk_count} HIGH-risk cross-profile keyword overlap(s) detected. ` +
        `Run 'npm run validate:keyword-scope' for details.`,
    );
  }

  return report;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function formatHumanReport(report: KeywordScopeReport): string {
  const lines: string[] = [];

  lines.push('=== Profile Intent Keyword Scope Validation ===');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Profiles analyzed: ${report.profiles_analyzed.join(', ')}`);
  lines.push(`Total overlapping keywords: ${report.total_overlaps}`);
  lines.push(`  HIGH risk:   ${report.high_risk_count}`);
  lines.push(`  MEDIUM risk: ${report.medium_risk_count}`);
  lines.push(`  LOW risk:    ${report.low_risk_count}`);
  lines.push('');

  // Show HIGH risk overlaps
  const high = report.overlaps.filter(o => o.risk_level === 'HIGH');
  if (high.length > 0) {
    lines.push('--- HIGH Risk Overlaps ---');
    for (const o of high) {
      lines.push(
        `  "${o.keyword}" — ${o.profile_a} <-> ${o.profile_b} (${o.overlap_count} intent refs)`,
      );
    }
    lines.push('');
  }

  // Show MEDIUM risk overlaps
  const medium = report.overlaps.filter(o => o.risk_level === 'MEDIUM');
  if (medium.length > 0) {
    const shown = medium.slice(0, 30);
    lines.push(`--- MEDIUM Risk Overlaps (showing ${shown.length}/${medium.length}) ---`);
    for (const o of shown) {
      lines.push(
        `  "${o.keyword}" — ${o.profile_a} <-> ${o.profile_b} (${o.overlap_count} intent refs)`,
      );
    }
    lines.push('');
  }

  // Show LOW risk count only
  const low = report.overlaps.filter(o => o.risk_level === 'LOW');
  if (low.length > 0) {
    lines.push(`--- LOW Risk Overlaps: ${low.length} keyword(s) (shared intents like greeting/thanks) ---`);
    lines.push('');
  }

  // Summary
  if (report.high_risk_count > 0) {
    lines.push(`RESULT: ${report.high_risk_count} HIGH-risk keyword scope overlap(s) — review needed`);
  } else {
    lines.push('RESULT: No high-risk keyword scope overlaps detected');
  }

  return lines.join('\n');
}

/**
 * CLI main — invoked by `npm run validate:keyword-scope`.
 */
export function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const csvMode = args.includes('--csv');

  const rootDir = join(
    new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    '..',
    '..',
  );

  const profileData = loadAllProfiles(rootDir);

  if (profileData.size === 0) {
    console.error('ERROR: No profile intent-keywords.json files found');
    process.exit(1);
  }

  const report = buildScopeReport(profileData);

  if (csvMode) {
    console.log(formatScopeCSV(report.overlaps));
  } else if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHumanReport(report));
  }

  process.exit(report.high_risk_count > 0 ? 1 : 0);
}

// Run CLI if this is the entry module
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('keyword-scope-validator') ||
   process.argv[1].endsWith('tsx'));

if (isDirectRun && process.argv[1]?.includes('keyword-scope-validator')) {
  main();
}
