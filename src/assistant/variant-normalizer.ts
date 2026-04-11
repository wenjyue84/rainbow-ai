/**
 * Language Variant Detector for Typo and Dialect Handling (US-495)
 *
 * Normalises language variants (typos, abbreviations, regional dialects) before
 * intent classification so that standard NLP tiers receive cleaner, more
 * consistent text.
 *
 * Pipeline position: runs AFTER input normalization, BEFORE tier classification.
 *
 * Design:
 * - Static variant map loaded from language_variants.json
 * - Variants mapped to canonical forms with confidence scores
 * - Case-insensitive, word-boundary-aware matching
 * - Logs matched variants with scores for debugging
 * - In-memory map refreshed on admin updates
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const VARIANTS_PATH = join(process.cwd(), 'src', 'assistant', 'data', 'language_variants.json');

export interface VariantEntry {
  variant: string;
  canonical: string;
  confidence: number;
  type: 'typo' | 'abbreviation' | 'dialect';
  languages: string[];
}

export interface LanguageVariantsFile {
  _comment?: string;
  _metadata?: {
    version?: string;
    lastUpdated?: string;
    variantCount?: number;
    description?: string;
  };
  variants: VariantEntry[];
}

export interface MatchedVariant {
  original: string;
  canonical: string;
  confidence: number;
  type: string;
  position: number;
}

export interface NormalizeVariantsResult {
  /** The normalized text with variants replaced */
  normalized: string;
  /** The original text before normalization */
  original: string;
  /** Whether normalization changed the input */
  changed: boolean;
  /** List of matched variants with their metadata */
  matchedVariants: MatchedVariant[];
}

// ─── In-memory variant map ──────────────────────────────────────────
// Variants are stored in a map for fast lookup.
// Multi-word variants are sorted longest-first for greedy matching.

let variantMap: Map<string, VariantEntry> = new Map();
let sortedKeys: string[] = [];

function loadVariants(): void {
  try {
    const raw = readFileSync(VARIANTS_PATH, 'utf8');
    const parsed: LanguageVariantsFile = JSON.parse(raw);
    variantMap = new Map();
    (parsed.variants || []).forEach(entry => {
      variantMap.set(entry.variant.toLowerCase(), entry);
    });
    // Sort by descending key length so multi-word phrases match before subsets
    sortedKeys = Array.from(variantMap.keys()).sort((a, b) => b.length - a.length);
  } catch (err: any) {
    console.warn(`[VariantNormalizer] Failed to load variants from ${VARIANTS_PATH}: ${err.message}`);
    variantMap = new Map();
    sortedKeys = [];
  }
}

// Load on module init
loadVariants();

/**
 * Reload the variant map from disk (called after admin update).
 */
export function reloadVariantMap(): void {
  loadVariants();
}

/**
 * Get the current variant map (for admin read).
 */
export function getVariantMap(): LanguageVariantsFile {
  try {
    const raw = readFileSync(VARIANTS_PATH, 'utf8');
    return JSON.parse(raw) as LanguageVariantsFile;
  } catch {
    return { variants: [] };
  }
}

/**
 * Persist an updated variant map to disk and reload in-memory map.
 */
export function saveVariantMap(data: LanguageVariantsFile): void {
  const variantCount = data.variants.length;
  if (data._metadata) {
    data._metadata.variantCount = variantCount;
    data._metadata.lastUpdated = new Date().toISOString().slice(0, 10);
  }
  const serialized = JSON.stringify(data, null, 2);
  writeFileSync(VARIANTS_PATH, serialized, 'utf8');
  reloadVariantMap();
}

/**
 * Add or update a single variant in the map.
 */
export function upsertVariant(variant: string, canonical: string, confidence: number, type: string, languages: string[]): void {
  const current = getVariantMap();
  const entry: VariantEntry = {
    variant: variant.toLowerCase(),
    canonical,
    confidence,
    type: type as 'typo' | 'abbreviation' | 'dialect',
    languages,
  };
  // Remove existing entry if present
  current.variants = current.variants.filter(v => v.variant.toLowerCase() !== variant.toLowerCase());
  // Add new entry
  current.variants.push(entry);
  saveVariantMap(current);
}

/**
 * Delete a variant from the map.
 */
export function deleteVariant(variant: string): boolean {
  const current = getVariantMap();
  const originalLength = current.variants.length;
  current.variants = current.variants.filter(v => v.variant.toLowerCase() !== variant.toLowerCase());
  if (current.variants.length === originalLength) {
    return false; // No variant was deleted
  }
  saveVariantMap(current);
  return true;
}

/**
 * Normalise language variants in a message before intent classification.
 *
 * Algorithm:
 * 1. Lowercase the input for map lookup
 * 2. Attempt greedy longest-match substitution left-to-right
 * 3. Replace matched variants with their canonical forms
 * 4. Collapse multiple spaces
 * 5. Return normalized text with metadata about matched variants
 *
 * @param text - Raw user message text
 * @returns NormalizeVariantsResult with normalized text and matched variants
 */
export function normalizeVariants(text: string): NormalizeVariantsResult {
  const original = text;
  const matchedVariants: MatchedVariant[] = [];

  if (!text || sortedKeys.length === 0) {
    return {
      normalized: text,
      original,
      changed: false,
      matchedVariants: [],
    };
  }

  const lower = text.toLowerCase();
  const inputLen = lower.length;

  // Build result by scanning left-to-right
  let result = '';
  let i = 0;
  let charPosition = 0;

  while (i < inputLen) {
    let matched = false;

    // Skip leading whitespace at current position, carry it through
    if (lower[i] === ' ') {
      result += ' ';
      i++;
      charPosition++;
      continue;
    }

    // Try each key (longest first)
    for (const key of sortedKeys) {
      const keyLen = key.length;
      if (i + keyLen > inputLen) continue;

      const slice = lower.slice(i, i + keyLen);
      if (slice !== key) continue;

      // Ensure we are at a word boundary
      // (previous char is space/start, next is space/end/punctuation)
      const prevOk = i === 0 || /[\s,!?.;:\-]/.test(lower[i - 1]);
      const nextIdx = i + keyLen;
      const nextOk = nextIdx === inputLen || /[\s,!?.;:\-]/.test(lower[nextIdx]);

      if (prevOk && nextOk) {
        const entry = variantMap.get(key);
        if (entry) {
          const originalWord = text.slice(i, i + keyLen);
          matchedVariants.push({
            original: originalWord,
            canonical: entry.canonical,
            confidence: entry.confidence,
            type: entry.type,
            position: charPosition,
          });
          result += entry.canonical;
        }
        i += keyLen;
        charPosition += keyLen;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // No match — copy original character from input text
      result += text[i];
      i++;
      charPosition++;
    }
  }

  // Collapse multiple spaces and trim
  const normalized = result.replace(/\s{2,}/g, ' ').trim();
  const changed = normalized !== original;

  return {
    normalized,
    original,
    changed,
    matchedVariants,
  };
}

/**
 * Returns true if the variants file exists on disk.
 */
export function isVariantMapAvailable(): boolean {
  return existsSync(VARIANTS_PATH);
}
