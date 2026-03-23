/**
 * US-218: Intent Classification Ground Truth Dataset Exporter
 *
 * Pure logic module for exporting conversation data with inferred intents,
 * confidence scores, and actual outcomes for building ground truth ML
 * training datasets. Enforces strict per-profile isolation to prevent
 * cross-profile contamination in training data.
 *
 * The CLI wrapper is in export-ground-truth-cli.ts.
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single ground truth record exported in JSONL format */
export interface GroundTruthRecord {
  message_text: string;
  inferred_intent: string;
  confidence_score: number;
  actual_outcome: string;
  conversation_id: string;
  timestamp: string;
  language: string;
  profile: string;
}

/** Raw message row from rainbow_messages table */
export interface RawMessageRow {
  content: string;
  intent: string | null;
  confidence: number | null;
  phone: string;
  timestamp: Date | string;
  profileId: string | null;
  action: string | null;
  routedAction: string | null;
}

/** Language info from conversation state */
export interface ConversationLanguage {
  phone: string;
  language: string;
}

/** Intent keyword entry from intent-keywords.json */
export interface IntentKeywordEntry {
  intent: string;
  keywords: Record<string, string[]>;
}

export interface KeywordsFile {
  intents: IntentKeywordEntry[];
}

/** Contamination match found during cross-profile validation */
export interface ContaminationViolation {
  keyword: string;
  foreign_profile: string;
  foreign_intent: string;
  record_intent: string;
}

/** Export options */
export interface ExportOptions {
  profile: string;
  days: number;
  minConfidence: number;
  format: 'jsonl';
}

/** Export result with metadata */
export interface ExportResult {
  records: GroundTruthRecord[];
  profile: string;
  totalRecords: number;
  filteredByConfidence: number;
  contamination: ContaminationViolation[];
  isClean: boolean;
}

// ---------------------------------------------------------------------------
// Profile configuration
// ---------------------------------------------------------------------------

export const PROFILE_CONFIG: Record<string, { dataDir: string }> = {
  pelangi: { dataDir: 'src/assistant/data' },
  makan: { dataDir: 'src/assistant/data-makan' },
  southern: { dataDir: 'src/assistant/data-southern' },
};

// ---------------------------------------------------------------------------
// Outcome inference
// ---------------------------------------------------------------------------

/**
 * Infer actual_outcome from a message's action/routedAction fields.
 * Maps routing actions to one of: 'resolved', 'escalated', 'clarified'.
 */
export function inferOutcome(action: string | null, routedAction: string | null): string {
  const effectiveAction = routedAction || action || '';
  const lower = effectiveAction.toLowerCase();

  // Escalation outcomes
  if (
    lower.includes('escalat') ||
    lower === 'human_handoff' ||
    lower === 'emergency'
  ) {
    return 'escalated';
  }

  // Clarification outcomes — when the bot asks for more info
  if (
    lower.includes('clarif') ||
    lower === 'ask_clarification' ||
    lower === 'fallback' ||
    lower === 'unknown'
  ) {
    return 'clarified';
  }

  // Resolved outcomes — bot handled the request
  if (
    lower === 'static_reply' ||
    lower === 'llm_reply' ||
    lower === 'workflow' ||
    lower === 'tool_use' ||
    lower === 'knowledge_base' ||
    lower !== '' // Any other non-empty action is considered resolved
  ) {
    return 'resolved';
  }

  return 'resolved';
}

// ---------------------------------------------------------------------------
// Record transformation
// ---------------------------------------------------------------------------

/**
 * Transform raw DB rows into GroundTruthRecord objects.
 * Filters by minimum confidence and applies profile isolation.
 */
export function transformRows(
  rows: RawMessageRow[],
  languageMap: Map<string, string>,
  options: ExportOptions
): { records: GroundTruthRecord[]; filteredByConfidence: number } {
  let filteredByConfidence = 0;
  const records: GroundTruthRecord[] = [];

  for (const row of rows) {
    // Skip rows without intent classification
    if (!row.intent || row.confidence === null || row.confidence === undefined) {
      continue;
    }

    // Filter by profile (strict isolation)
    if (row.profileId && row.profileId !== options.profile) {
      continue;
    }

    // Filter by minimum confidence
    if (row.confidence < options.minConfidence) {
      filteredByConfidence++;
      continue;
    }

    // Skip empty messages
    if (!row.content || row.content.trim() === '') {
      continue;
    }

    const language = languageMap.get(row.phone) || 'en';
    const ts = row.timestamp instanceof Date
      ? row.timestamp.toISOString()
      : String(row.timestamp);

    records.push({
      message_text: row.content,
      inferred_intent: row.intent,
      confidence_score: row.confidence,
      actual_outcome: inferOutcome(row.action, row.routedAction),
      conversation_id: row.phone,
      timestamp: ts,
      language,
      profile: options.profile,
    });
  }

  return { records, filteredByConfidence };
}

// ---------------------------------------------------------------------------
// Cross-profile contamination detection
// ---------------------------------------------------------------------------

/**
 * Load intent-keywords.json from a profile's data directory.
 */
export function loadKeywordsFile(rootDir: string, dataDir: string): KeywordsFile | null {
  const filePath = path.join(rootDir, dataDir, 'intent-keywords.json');
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
 * Build a set of all keywords for a given profile's intent-keywords.json.
 * Returns a map of keyword -> intent for lookup.
 */
export function buildKeywordIndex(keywordsFile: KeywordsFile): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of keywordsFile.intents) {
    for (const langKeywords of Object.values(entry.keywords)) {
      for (const kw of langKeywords) {
        index.set(kw.toLowerCase(), entry.intent);
      }
    }
  }
  return index;
}

/**
 * Validate exported records contain zero cross-profile contamination.
 * Scans each record's message_text against keywords from OTHER profiles.
 * Checks both single-word and multi-word (phrase) keywords.
 * Returns contamination violations if foreign keywords are detected.
 */
export function validateContamination(
  records: GroundTruthRecord[],
  exportProfile: string,
  rootDir: string
): ContaminationViolation[] {
  const violations: ContaminationViolation[] = [];

  // Load keyword indexes for all OTHER profiles
  const foreignIndexes: Array<{ profile: string; index: Map<string, string> }> = [];
  for (const [profileName, config] of Object.entries(PROFILE_CONFIG)) {
    if (profileName === exportProfile) continue;

    const keywordsFile = loadKeywordsFile(rootDir, config.dataDir);
    if (!keywordsFile) continue;

    const index = buildKeywordIndex(keywordsFile);
    foreignIndexes.push({ profile: profileName, index });
  }

  // Also build the export profile's own keyword index for comparison
  const ownConfig = PROFILE_CONFIG[exportProfile];
  const ownKeywordsFile = ownConfig ? loadKeywordsFile(rootDir, ownConfig.dataDir) : null;
  const ownIndex = ownKeywordsFile ? buildKeywordIndex(ownKeywordsFile) : new Map<string, string>();

  // Scan each record for foreign keywords (single-word and multi-word phrases)
  const seenViolations = new Set<string>();
  for (const record of records) {
    const msgLower = record.message_text.toLowerCase();
    const words = msgLower.split(/\s+/).filter((w) => w.length > 0);

    for (const { profile: foreignProfile, index: foreignIndex } of foreignIndexes) {
      // Check single words
      for (const word of words) {
        if (foreignIndex.has(word) && !ownIndex.has(word)) {
          const key = `${word}|${foreignProfile}|${foreignIndex.get(word)}`;
          if (!seenViolations.has(key)) {
            seenViolations.add(key);
            violations.push({
              keyword: word,
              foreign_profile: foreignProfile,
              foreign_intent: foreignIndex.get(word)!,
              record_intent: record.inferred_intent,
            });
          }
        }
      }

      // Check multi-word phrase keywords (those containing spaces)
      for (const [phrase, intent] of foreignIndex) {
        if (!phrase.includes(' ')) continue; // Already checked single words above
        if (ownIndex.has(phrase)) continue;  // Skip if phrase exists in own profile
        if (msgLower.includes(phrase)) {
          const key = `${phrase}|${foreignProfile}|${intent}`;
          if (!seenViolations.has(key)) {
            seenViolations.add(key);
            violations.push({
              keyword: phrase,
              foreign_profile: foreignProfile,
              foreign_intent: intent,
              record_intent: record.inferred_intent,
            });
          }
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// JSONL formatting
// ---------------------------------------------------------------------------

/**
 * Format records as JSONL (one JSON object per line).
 * Each record has exactly 8 fields as required by AC3.
 */
export function formatAsJSONL(records: GroundTruthRecord[]): string {
  return records.map((r) => JSON.stringify({
    message_text: r.message_text,
    inferred_intent: r.inferred_intent,
    confidence_score: r.confidence_score,
    actual_outcome: r.actual_outcome,
    conversation_id: r.conversation_id,
    timestamp: r.timestamp,
    language: r.language,
    profile: r.profile,
  })).join('\n');
}

/**
 * Count distinct values in a field across records (for diversity reporting).
 */
export function countDistinct(records: GroundTruthRecord[], field: keyof GroundTruthRecord): number {
  const unique = new Set(records.map((r) => r[field]));
  return unique.size;
}

/**
 * Get confidence score range from records.
 */
export function getConfidenceRange(records: GroundTruthRecord[]): { min: number; max: number } {
  if (records.length === 0) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const r of records) {
    if (r.confidence_score < min) min = r.confidence_score;
    if (r.confidence_score > max) max = r.confidence_score;
  }
  return { min, max };
}

/**
 * Count outcomes by type for diversity reporting.
 */
export function countOutcomes(records: GroundTruthRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    counts[r.actual_outcome] = (counts[r.actual_outcome] || 0) + 1;
  }
  return counts;
}
