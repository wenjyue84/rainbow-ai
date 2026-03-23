/**
 * US-316: Fallback Response Coverage Gap Analysis — Pure Logic Module
 *
 * Scans intents.json against knowledge.json for a given profile to identify
 * booking and inquiry intents missing fallback responses. Classifies gaps by
 * type and suggests template structures.
 *
 * Pure logic module — no file I/O in core functions (except load helpers).
 * All core functions accept data as parameters for easy testing.
 */

import fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single intent entry from intents.json categories[].intents[] */
export interface IntentEntry {
  category: string;
  professional_term: string;
  patterns: string[];
  flags: string;
  enabled: boolean;
  min_confidence: number;
  time_sensitive?: boolean;
  severity?: string;
  _comment?: string;
}

/** A phase/category group from intents.json */
export interface IntentCategory {
  phase: string;
  description: string;
  intents: IntentEntry[];
}

/** The full intents.json structure */
export interface IntentsFile {
  schema_version: string;
  categories: IntentCategory[];
}

/** A single static knowledge entry from knowledge.json */
export interface KnowledgeEntry {
  intent: string;
  response: Record<string, string>;
  id: string;
  profile_id: string;
}

/** The full knowledge.json structure */
export interface KnowledgeFile {
  schema_version: string;
  static: KnowledgeEntry[];
  dynamic?: Record<string, string>;
}

/** Gap type classification */
export type GapType = 'no_template' | 'incomplete_coverage' | 'low_confidence_gap';

/** A single coverage gap entry in the report */
export interface CoverageGap {
  intent: string;
  gapType: GapType;
  suggestion: string;
  affectedProfiles: string[];
}

/** The full coverage analysis report */
export interface FallbackCoverageReport {
  timestamp: string;
  profile: string;
  totalIntents: number;
  totalKnowledgeEntries: number;
  totalGaps: number;
  gaps: CoverageGap[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Languages expected in a complete knowledge template */
export const EXPECTED_LANGUAGES = ['en', 'ms', 'zh'];

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/** Load and parse an intents.json file from disk. */
export function loadIntentsFile(filePath: string): IntentsFile {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as IntentsFile;
}

/** Load and parse a knowledge.json file from disk. */
export function loadKnowledgeFile(filePath: string): KnowledgeFile {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as KnowledgeFile;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Extract all intent category names from an IntentsFile, along with their
 * phase and metadata.
 */
export function extractIntentCategories(
  intentsData: IntentsFile,
): Array<{ category: string; phase: string; minConfidence: number; enabled: boolean }> {
  const result: Array<{ category: string; phase: string; minConfidence: number; enabled: boolean }> = [];

  for (const group of intentsData.categories) {
    for (const intent of group.intents) {
      result.push({
        category: intent.category,
        phase: group.phase,
        minConfidence: intent.min_confidence,
        enabled: intent.enabled,
      });
    }
  }

  return result;
}

/**
 * Build a map of intent -> KnowledgeEntry[] from the knowledge file,
 * optionally filtered by profile_id.
 */
export function buildKnowledgeMap(
  knowledgeData: KnowledgeFile,
  profileId?: string,
): Map<string, KnowledgeEntry[]> {
  const map = new Map<string, KnowledgeEntry[]>();

  for (const entry of knowledgeData.static) {
    if (profileId && entry.profile_id !== profileId) continue;

    const existing = map.get(entry.intent) ?? [];
    existing.push(entry);
    map.set(entry.intent, existing);
  }

  return map;
}

/**
 * Check if a knowledge entry has incomplete language coverage.
 * Returns the list of missing languages.
 */
export function findMissingLanguages(entry: KnowledgeEntry): string[] {
  const missing: string[] = [];
  for (const lang of EXPECTED_LANGUAGES) {
    if (!entry.response[lang] || entry.response[lang].trim() === '') {
      missing.push(lang);
    }
  }
  return missing;
}

/**
 * Generate a template suggestion for a missing intent based on its
 * professional term and phase.
 */
export function generateTemplateSuggestion(
  category: string,
  phase: string,
  gapType: GapType,
): string {
  if (gapType === 'incomplete_coverage') {
    return `Add missing language translations to the existing "${category}" knowledge entry. Ensure en, ms, and zh responses are present.`;
  }

  if (gapType === 'low_confidence_gap') {
    return `Intent "${category}" has low min_confidence. Add a dedicated fallback template with helpful guidance when confidence is low: { intent: "${category}", response: { en: "...", ms: "...", zh: "..." } }`;
  }

  // no_template
  const phaseHints: Record<string, string> = {
    GENERAL_SUPPORT: 'Provide a helpful general response with options to redirect the guest.',
    PRE_ARRIVAL: 'Include booking-relevant info, contact details, and next steps.',
    ARRIVAL_CHECKIN: 'Provide check-in guidance, door codes, or staff contact for immediate help.',
    DURING_STAY: 'Acknowledge the issue, provide estimated resolution time, and staff contact.',
    CHECKOUT_DEPARTURE: 'Include checkout procedure details and staff contact for assistance.',
    POST_CHECKOUT: 'Acknowledge feedback/issue and provide follow-up contact information.',
  };

  const hint = phaseHints[phase] ?? 'Provide a helpful response template with multilingual support.';

  return `Create knowledge entry: { intent: "${category}", response: { en: "...", ms: "...", zh: "..." }, id: "<profile>_${category}_<n>", profile_id: "<profile>" }. ${hint}`;
}

/**
 * Run the fallback coverage analysis.
 *
 * Compares intents from intentsData against knowledge entries and identifies:
 * 1. no_template — intent has no knowledge entry at all
 * 2. incomplete_coverage — knowledge entry exists but missing language(s)
 * 3. low_confidence_gap — intent has min_confidence <= 0.5 and no template
 *
 * Returns the analysis report.
 */
export function runFallbackCoverageAnalysis(
  profileName: string,
  intentsData: IntentsFile,
  knowledgeData: KnowledgeFile,
): FallbackCoverageReport {
  const intentCategories = extractIntentCategories(intentsData);
  const knowledgeMap = buildKnowledgeMap(knowledgeData, profileName);
  const gaps: CoverageGap[] = [];

  for (const { category, phase, minConfidence, enabled } of intentCategories) {
    if (!enabled) continue;

    const entries = knowledgeMap.get(category);

    if (!entries || entries.length === 0) {
      // Determine if this is a low-confidence gap or a plain no_template
      const gapType: GapType = minConfidence <= 0.5 ? 'low_confidence_gap' : 'no_template';

      gaps.push({
        intent: category,
        gapType,
        suggestion: generateTemplateSuggestion(category, phase, gapType),
        affectedProfiles: [profileName],
      });
      continue;
    }

    // Check for incomplete language coverage
    for (const entry of entries) {
      const missingLangs = findMissingLanguages(entry);
      if (missingLangs.length > 0) {
        gaps.push({
          intent: category,
          gapType: 'incomplete_coverage',
          suggestion: `Knowledge entry "${entry.id}" is missing translations for: ${missingLangs.join(', ')}. ${generateTemplateSuggestion(category, phase, 'incomplete_coverage')}`,
          affectedProfiles: [profileName],
        });
      }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    profile: profileName,
    totalIntents: intentCategories.filter(i => i.enabled).length,
    totalKnowledgeEntries: knowledgeData.static.filter(e => e.profile_id === profileName).length,
    totalGaps: gaps.length,
    gaps,
  };
}
