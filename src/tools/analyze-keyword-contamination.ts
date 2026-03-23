/**
 * US-222: Intent Keyword Contamination Scanner
 *
 * Analyzes intent-keywords.json across all profiles (pelangi, southern, makan)
 * to detect copy-pasted keywords indicating data contamination. Compares keywords
 * across profiles using Levenshtein distance to identify exact and fuzzy duplicates.
 *
 * Pure logic module — no file I/O or CLI concerns. The CLI wrapper is in
 * analyze-keyword-contamination-cli.ts.
 */

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

export interface ContaminationMatch {
  keyword: string;
  profile_a: string;
  intent_a: string;
  profile_b: string;
  intent_b: string;
  similarity_score: number; // 0-100
  status: 'CONTAMINATED' | 'REVIEW';
}

export interface ContaminationReport {
  timestamp: string;
  profiles_analyzed: string[];
  total_keywords_scanned: number;
  contaminated_count: number;
  review_count: number;
  matches: ContaminationMatch[];
  recommendations: ContaminationRecommendation[];
}

export interface ContaminationRecommendation {
  keyword: string;
  found_in_profile: string;
  intent: string;
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Similarity threshold (0-100) above which a cross-profile keyword pair is flagged */
export const SIMILARITY_THRESHOLD = 70;

/** Profiles that should NOT contain hostel-specific keywords */
const NON_HOSTEL_PROFILES = ['makan', 'southern'];

/** The primary hostel profile */
const HOSTEL_PROFILE = 'pelangi';

/**
 * Known hostel-specific intent patterns that should only exist in pelangi.
 * If these appear in makan or southern, they are contamination.
 */
const HOSTEL_SPECIFIC_INTENTS = [
  'checkin_info',
  'check_in_arrival',
  'checkout_info',
  'late_checkout',
  'late_checkout_request',
  'capsule_conflict',
  'lower_deck_preference',
  'facility_orientation',
  'theft_report',
  'card_locked',
  'luggage_storage',
  'checkout_now',
  'checkout_procedure',
  'stay_extension',
  'extend_stay',
  'room_type_inquiry',
];

// ---------------------------------------------------------------------------
// Levenshtein distance
// ---------------------------------------------------------------------------

/**
 * Compute Levenshtein edit distance between two strings.
 * Returns the number of single-character edits (insertions, deletions,
 * substitutions) needed to transform `a` into `b`.
 */
export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Use a single flat array for the DP matrix row
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  let curr = new Array<number>(lb + 1);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

/**
 * Compute similarity score (0-100) between two strings based on Levenshtein distance.
 * 100 = identical, 0 = completely different.
 */
export function similarityScore(a: string, b: string): number {
  if (a === b) return 100;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
  return Math.round((1 - dist / maxLen) * 100);
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * Extract all keywords from a KeywordsFile, flattened to an array of
 * { intent, language, keyword } tuples.
 */
export function flattenKeywords(
  data: KeywordsFile,
): Array<{ intent: string; language: string; keyword: string }> {
  const result: Array<{ intent: string; language: string; keyword: string }> = [];
  for (const entry of data.intents) {
    for (const [lang, words] of Object.entries(entry.keywords)) {
      for (const kw of words) {
        result.push({ intent: entry.intent, language: lang, keyword: kw.toLowerCase().trim() });
      }
    }
  }
  return result;
}

/**
 * Compare keywords across profiles and find contamination (exact matches and
 * fuzzy matches above the similarity threshold).
 *
 * Only flags cross-profile pairs where the intent name AND keyword overlap,
 * indicating copy-paste contamination rather than legitimately shared vocabulary
 * (e.g., "hi" / "hello" in greetings is expected).
 */
export function findContamination(
  profileData: Map<string, KeywordsFile>,
  threshold: number = SIMILARITY_THRESHOLD,
): ContaminationMatch[] {
  const matches: ContaminationMatch[] = [];
  const profiles = Array.from(profileData.keys());

  // Build per-profile flat keyword lists
  const profileKeywords = new Map<string, Array<{ intent: string; language: string; keyword: string }>>();
  for (const [name, data] of profileData) {
    profileKeywords.set(name, flattenKeywords(data));
  }

  // Build per-profile keyword-to-intent map for fast lookup
  const profileKeywordMaps = new Map<string, Map<string, Set<string>>>();
  for (const [name, kws] of profileKeywords) {
    const m = new Map<string, Set<string>>();
    for (const { intent, keyword } of kws) {
      if (!m.has(keyword)) m.set(keyword, new Set());
      m.get(keyword)!.add(intent);
    }
    profileKeywordMaps.set(name, m);
  }

  // Deduplicate: track seen pairs to avoid duplicates
  const seen = new Set<string>();

  // Compare each pair of profiles
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const profA = profiles[i];
      const profB = profiles[j];
      const kwsA = profileKeywords.get(profA)!;
      const mapB = profileKeywordMaps.get(profB)!;

      // Check exact matches first
      for (const { intent: intentA, keyword: kwA } of kwsA) {
        if (mapB.has(kwA)) {
          const intentsB = mapB.get(kwA)!;
          for (const intentB of intentsB) {
            const key = [kwA, profA, intentA, profB, intentB].sort().join('|');
            if (seen.has(key)) continue;
            seen.add(key);

            const score = 100;
            const status = isContaminated(kwA, profA, intentA, profB, intentB, score, threshold);
            matches.push({
              keyword: kwA,
              profile_a: profA,
              intent_a: intentA,
              profile_b: profB,
              intent_b: intentB,
              similarity_score: score,
              status,
            });
          }
        }
      }

      // Fuzzy matching: compare unique keywords across profiles.
      // To keep runtime manageable on large keyword sets, only fuzzy-compare
      // keywords that are at least 4 characters long (short keywords produce
      // too many false positives and dominate runtime).
      const uniqueA = new Set<string>();
      for (const { keyword } of kwsA) uniqueA.add(keyword);
      const uniqueKwsA = Array.from(uniqueA).filter(k => k.length >= 4);
      const kwsBArr = Array.from(mapB.keys()).filter(k => k.length >= 4);

      for (const kwA of uniqueKwsA) {
        for (const kwB of kwsBArr) {
          if (kwA === kwB) continue; // already handled as exact

          // Quick length-based pre-filter: if lengths differ by more than
          // the allowed distance, the similarity will be below threshold
          const maxLen = Math.max(kwA.length, kwB.length);
          const minLen = Math.min(kwA.length, kwB.length);
          const maxAllowedDist = Math.floor(maxLen * (1 - threshold / 100));
          if (maxLen - minLen > maxAllowedDist) continue;

          const score = similarityScore(kwA, kwB);
          if (score >= threshold) {
            // Find all intent pairs for this keyword pair
            const intentsA = profileKeywordMaps.get(profA)!.get(kwA);
            const intentsB = mapB.get(kwB)!;
            if (!intentsA) continue;
            for (const intentA of intentsA) {
              for (const intentB of intentsB) {
                const key = [kwA, kwB, profA, intentA, profB, intentB].sort().join('|');
                if (seen.has(key)) continue;
                seen.add(key);

                const status = isContaminated(kwA, profA, intentA, profB, intentB, score, threshold);
                matches.push({
                  keyword: `${kwA} ~ ${kwB}`,
                  profile_a: profA,
                  intent_a: intentA,
                  profile_b: profB,
                  intent_b: intentB,
                  similarity_score: score,
                  status,
                });
              }
            }
          }
        }
      }
    }
  }

  // Sort by similarity_score descending, then keyword
  matches.sort((a, b) => b.similarity_score - a.similarity_score || a.keyword.localeCompare(b.keyword));
  return matches;
}

/**
 * Determine if a keyword match represents actual contamination or just needs review.
 *
 * CONTAMINATED: keyword with >threshold similarity appears in data-makan or data-southern
 * and the intent is hostel-specific (should only be in pelangi).
 *
 * For generic intents (greeting, thanks, farewell, etc.), sharing keywords is expected
 * and gets marked as REVIEW rather than CONTAMINATED, unless the similarity exceeds threshold
 * and the intent names also match (suggesting copy-paste of entire intent blocks).
 */
function isContaminated(
  _keyword: string,
  profileA: string,
  intentA: string,
  profileB: string,
  intentB: string,
  score: number,
  threshold: number,
): 'CONTAMINATED' | 'REVIEW' {
  if (score < threshold) return 'REVIEW';

  // If the intent is hostel-specific and appears outside pelangi, it's contamination
  const profiles = [profileA, profileB];
  const intents = [intentA, intentB];

  for (let k = 0; k < 2; k++) {
    const prof = profiles[k];
    const intent = intents[k];
    if (prof !== HOSTEL_PROFILE && HOSTEL_SPECIFIC_INTENTS.includes(intent)) {
      return 'CONTAMINATED';
    }
  }

  // If same intent name appears in both profiles with high similarity keywords,
  // and it's not a generic shared intent, flag as contaminated
  if (intentA === intentB && score > threshold) {
    return 'CONTAMINATED';
  }

  return score > threshold ? 'CONTAMINATED' : 'REVIEW';
}

/**
 * Generate cleanup recommendations for contaminated matches.
 */
export function generateRecommendations(
  matches: ContaminationMatch[],
): ContaminationRecommendation[] {
  const recommendations: ContaminationRecommendation[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    if (match.status !== 'CONTAMINATED') continue;

    // Recommend removal from the non-matching profile
    const profiles = [
      { profile: match.profile_a, intent: match.intent_a },
      { profile: match.profile_b, intent: match.intent_b },
    ];

    for (const { profile, intent } of profiles) {
      // If a hostel-specific intent exists outside pelangi, recommend removal
      if (profile !== HOSTEL_PROFILE && HOSTEL_SPECIFIC_INTENTS.includes(intent)) {
        const key = `${match.keyword}|${profile}|${intent}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const kw = match.keyword.includes(' ~ ') ? match.keyword.split(' ~ ')[0] : match.keyword;
        recommendations.push({
          keyword: kw,
          found_in_profile: profile,
          intent,
          recommendation: `Remove '${intent}' intent and its keywords from ${profile} profile — it is hostel-specific and belongs only in pelangi`,
        });
      }
    }

    // For same-intent cross-profile contamination, recommend review
    if (match.intent_a === match.intent_b) {
      const kw = match.keyword.includes(' ~ ') ? match.keyword.split(' ~ ')[0] : match.keyword;
      const key = `${kw}|${match.profile_a}|${match.profile_b}|${match.intent_a}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Determine which profile likely has the copied data
      const suspectProfile = match.profile_a === HOSTEL_PROFILE ? match.profile_b : match.profile_a;
      recommendations.push({
        keyword: kw,
        found_in_profile: suspectProfile,
        intent: match.intent_a,
        recommendation: `Review keyword '${kw}' in '${match.intent_a}' intent of ${suspectProfile} profile — appears to be copy-pasted from ${match.profile_a === suspectProfile ? match.profile_b : match.profile_a}`,
      });
    }
  }

  return recommendations;
}

/**
 * Build a full contamination report from profile data loaded from disk (or injected for testing).
 */
export function buildContaminationReport(
  profileData: Map<string, KeywordsFile>,
  threshold: number = SIMILARITY_THRESHOLD,
): ContaminationReport {
  // Count total keywords across all profiles
  let totalKeywords = 0;
  for (const [, data] of profileData) {
    for (const entry of data.intents) {
      for (const words of Object.values(entry.keywords)) {
        totalKeywords += words.length;
      }
    }
  }

  const matches = findContamination(profileData, threshold);
  const recommendations = generateRecommendations(matches);

  return {
    timestamp: new Date().toISOString(),
    profiles_analyzed: Array.from(profileData.keys()),
    total_keywords_scanned: totalKeywords,
    contaminated_count: matches.filter(m => m.status === 'CONTAMINATED').length,
    review_count: matches.filter(m => m.status === 'REVIEW').length,
    matches,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// CSV formatter
// ---------------------------------------------------------------------------

/**
 * Format contamination matches as CSV with columns:
 * keyword, profile_a, profile_b, similarity_score
 */
export function formatCSV(matches: ContaminationMatch[]): string {
  const lines = ['keyword,profile_a,profile_b,similarity_score,intent_a,intent_b,status'];
  for (const m of matches) {
    // Escape commas in keywords
    const kw = m.keyword.includes(',') ? `"${m.keyword}"` : m.keyword;
    lines.push(`${kw},${m.profile_a},${m.profile_b},${m.similarity_score},${m.intent_a},${m.intent_b},${m.status}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// File loading helper (for CLI and integration tests)
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';

/**
 * Profile directory mapping relative to the project root.
 */
export const PROFILE_DIRS: Record<string, string> = {
  pelangi: 'src/assistant/data',
  makan: 'src/assistant/data-makan',
  southern: 'src/assistant/data-southern',
};

/**
 * Load all profile intent-keywords.json files from disk.
 */
export function loadAllProfiles(rootDir: string): Map<string, KeywordsFile> {
  const profileData = new Map<string, KeywordsFile>();
  for (const [name, dir] of Object.entries(PROFILE_DIRS)) {
    const filePath = path.join(rootDir, dir, 'intent-keywords.json');
    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: ${filePath} not found, skipping profile '${name}'`);
      continue;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    profileData.set(name, JSON.parse(raw) as KeywordsFile);
  }
  return profileData;
}
