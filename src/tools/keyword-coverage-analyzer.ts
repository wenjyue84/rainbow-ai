/**
 * US-244: Booking Intent Keyword Coverage Gap Analyzer
 *
 * Analyzes intent-keywords.json across all three profiles (pelangi, makan, southern)
 * to identify booking-related keywords with uneven coverage. Generates a coverage
 * report showing which booking/inquiry keywords appear in only one or two profiles
 * versus all three, helping identify gaps that could cause classification failures.
 */

import fs from 'fs';
import path from 'path';

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

export interface ProfileIntentInfo {
  intent: string;
  languages: string[];
  keywordCounts: Record<string, number>;
  totalKeywords: number;
}

export interface IntentCoverageEntry {
  intent: string;
  presentInProfiles: string[];
  missingFromProfiles: string[];
  perProfileCounts: Record<string, number>;
  belowThreshold: boolean; // true if any profile has < 5 keywords
  profilesBelowThreshold: string[];
}

export interface CoverageSuggestion {
  targetProfile: string;
  intent: string;
  reason: string;
  sourceProfile: string;
}

export interface CoverageReport {
  timestamp: string;
  profiles: string[];
  bookingIntentPattern: string;
  totalBookingIntents: number;
  coverageEntries: IntentCoverageEntry[];
  perProfileSummary: Record<string, { intentCount: number; totalKeywords: number; intentsBelow5: string[] }>;
  suggestions: CoverageSuggestion[];
  zeroKeywordIntents: { profile: string; intent: string }[];
  hasZeroKeywordFailure: boolean;
  summary: {
    fullyConvered: number;
    partialCoverage: number;
    belowThresholdCount: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex to match booking/inquiry related intent names */
export const BOOKING_INTENT_PATTERN = /book|avail|inquir|pric|reserv|order|billing/i;

export const PROFILE_PATHS: Record<string, string> = {
  pelangi: 'src/assistant/data',
  makan: 'src/assistant/data-makan',
  southern: 'src/assistant/data-southern',
};

/** Minimum keyword count threshold per profile */
export const MIN_KEYWORD_THRESHOLD = 5;

/** Business similarity map — which profiles are similar for suggestion purposes */
export const BUSINESS_SIMILARITY: Record<string, string[]> = {
  pelangi: ['southern'],  // both are hostel/accommodation
  southern: ['pelangi'],  // both are hostel/accommodation
  makan: [],              // cafe — different business type
};

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Load and parse an intent-keywords.json file.
 */
export function loadKeywordsFile(filePath: string): KeywordsFile | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as KeywordsFile;
  } catch {
    return null;
  }
}

/**
 * Extract booking/inquiry related intents from a keywords file.
 */
export function extractBookingIntents(
  data: KeywordsFile,
  pattern: RegExp = BOOKING_INTENT_PATTERN
): ProfileIntentInfo[] {
  return data.intents
    .filter(entry => pattern.test(entry.intent))
    .map(entry => {
      const keywordCounts: Record<string, number> = {};
      let totalKeywords = 0;
      for (const [lang, keywords] of Object.entries(entry.keywords)) {
        keywordCounts[lang] = keywords.length;
        totalKeywords += keywords.length;
      }
      return {
        intent: entry.intent,
        languages: Object.keys(entry.keywords),
        keywordCounts,
        totalKeywords,
      };
    });
}

/**
 * Build coverage entries showing which profiles have which booking intents.
 */
export function buildCoverageEntries(
  profileData: Record<string, ProfileIntentInfo[]>,
  allProfiles: string[]
): IntentCoverageEntry[] {
  // Collect all unique booking intent names
  const allIntents = new Set<string>();
  for (const intents of Object.values(profileData)) {
    for (const info of intents) {
      allIntents.add(info.intent);
    }
  }

  const entries: IntentCoverageEntry[] = [];

  for (const intent of allIntents) {
    const presentIn: string[] = [];
    const missingFrom: string[] = [];
    const perProfileCounts: Record<string, number> = {};
    const belowThreshold: string[] = [];

    for (const profile of allProfiles) {
      const match = profileData[profile]?.find(i => i.intent === intent);
      if (match) {
        presentIn.push(profile);
        perProfileCounts[profile] = match.totalKeywords;
        if (match.totalKeywords < MIN_KEYWORD_THRESHOLD) {
          belowThreshold.push(profile);
        }
      } else {
        missingFrom.push(profile);
        perProfileCounts[profile] = 0;
      }
    }

    entries.push({
      intent,
      presentInProfiles: presentIn,
      missingFromProfiles: missingFrom,
      perProfileCounts,
      belowThreshold: belowThreshold.length > 0,
      profilesBelowThreshold: belowThreshold,
    });
  }

  // Sort: partial coverage first, then by intent name
  entries.sort((a, b) => {
    const aCoverage = a.presentInProfiles.length;
    const bCoverage = b.presentInProfiles.length;
    if (aCoverage !== bCoverage) return aCoverage - bCoverage;
    return a.intent.localeCompare(b.intent);
  });

  return entries;
}

/**
 * Generate suggestions for which profiles should adopt missing keywords.
 */
export function generateSuggestions(
  entries: IntentCoverageEntry[],
  allProfiles: string[]
): CoverageSuggestion[] {
  const suggestions: CoverageSuggestion[] = [];

  for (const entry of entries) {
    if (entry.missingFromProfiles.length > 0 && entry.presentInProfiles.length > 0) {
      for (const missingProfile of entry.missingFromProfiles) {
        // Find best source profile based on business similarity
        const similar = BUSINESS_SIMILARITY[missingProfile] || [];
        const sourceProfile = entry.presentInProfiles.find(p => similar.includes(p))
          || entry.presentInProfiles[0];

        suggestions.push({
          targetProfile: missingProfile,
          intent: entry.intent,
          reason: similar.includes(sourceProfile)
            ? `${missingProfile} and ${sourceProfile} are similar business types (accommodation)`
            : `${sourceProfile} has this intent with ${entry.perProfileCounts[sourceProfile]} keywords`,
          sourceProfile,
        });
      }
    }

    // Also suggest for profiles below threshold
    for (const belowProfile of entry.profilesBelowThreshold) {
      const bestSource = entry.presentInProfiles
        .filter(p => p !== belowProfile)
        .sort((a, b) => (entry.perProfileCounts[b] || 0) - (entry.perProfileCounts[a] || 0))[0];

      if (bestSource) {
        suggestions.push({
          targetProfile: belowProfile,
          intent: entry.intent,
          reason: `${belowProfile} has only ${entry.perProfileCounts[belowProfile]} keywords (below threshold of ${MIN_KEYWORD_THRESHOLD}); ${bestSource} has ${entry.perProfileCounts[bestSource]}`,
          sourceProfile: bestSource,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Find booking/inquiry intents with zero keywords in any profile where the intent exists.
 */
export function findZeroKeywordIntents(
  profileData: Record<string, ProfileIntentInfo[]>
): { profile: string; intent: string }[] {
  const results: { profile: string; intent: string }[] = [];

  for (const [profile, intents] of Object.entries(profileData)) {
    for (const info of intents) {
      if (info.totalKeywords === 0) {
        results.push({ profile, intent: info.intent });
      }
    }
  }

  return results;
}

/**
 * Build the full coverage report.
 */
export function buildCoverageReport(
  rootDir: string,
  profilePaths: Record<string, string> = PROFILE_PATHS
): CoverageReport {
  const allProfiles = Object.keys(profilePaths);
  const profileData: Record<string, ProfileIntentInfo[]> = {};

  // Load and extract booking intents from each profile
  for (const [profileName, relPath] of Object.entries(profilePaths)) {
    const filePath = path.join(rootDir, relPath, 'intent-keywords.json');
    const data = loadKeywordsFile(filePath);
    if (data) {
      profileData[profileName] = extractBookingIntents(data);
    } else {
      profileData[profileName] = [];
    }
  }

  const coverageEntries = buildCoverageEntries(profileData, allProfiles);
  const suggestions = generateSuggestions(coverageEntries, allProfiles);
  const zeroKeywordIntents = findZeroKeywordIntents(profileData);

  // Per-profile summary
  const perProfileSummary: Record<string, { intentCount: number; totalKeywords: number; intentsBelow5: string[] }> = {};
  for (const profile of allProfiles) {
    const intents = profileData[profile] || [];
    const intentsBelow5 = intents
      .filter(i => i.totalKeywords < MIN_KEYWORD_THRESHOLD && i.totalKeywords > 0)
      .map(i => i.intent);
    perProfileSummary[profile] = {
      intentCount: intents.length,
      totalKeywords: intents.reduce((sum, i) => sum + i.totalKeywords, 0),
      intentsBelow5,
    };
  }

  const fullyConvered = coverageEntries.filter(e => e.missingFromProfiles.length === 0).length;
  const partialCoverage = coverageEntries.filter(e => e.missingFromProfiles.length > 0).length;
  const belowThresholdCount = coverageEntries.filter(e => e.belowThreshold).length;

  return {
    timestamp: new Date().toISOString(),
    profiles: allProfiles,
    bookingIntentPattern: BOOKING_INTENT_PATTERN.source,
    totalBookingIntents: coverageEntries.length,
    coverageEntries,
    perProfileSummary,
    suggestions,
    zeroKeywordIntents,
    hasZeroKeywordFailure: zeroKeywordIntents.length > 0,
    summary: {
      fullyConvered,
      partialCoverage,
      belowThresholdCount,
    },
  };
}
