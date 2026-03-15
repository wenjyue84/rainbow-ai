/**
 * Manglish / Code-Mixed Malay-English Normalisation Pre-processor (US-1011)
 *
 * Normalises common Manglish tokens before intent classification so that
 * standard NLP tiers (T2 fuzzy match, LLM) receive cleaner, more consistent
 * Malaysian English/Malay text.
 *
 * Pipeline position: runs BEFORE T2 fuzzy-match and LLM intent classification.
 *
 * Design:
 * - Static token map loaded from manglish-map.json (editable via admin UI)
 * - Particle tokens (la, lah, lor…) mapped to '' and stripped
 * - Abbreviations expanded (brp→berapa, nk→nak, etc.)
 * - Case-insensitive, word-boundary-aware matching
 * - In-memory map refreshed on admin token updates
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const MAP_PATH = join(process.cwd(), 'src', 'assistant', 'data', 'manglish-map.json');

export interface ManglishMapFile {
  _comment?: string;
  _metadata?: {
    version?: string;
    lastUpdated?: string;
    tokenCount?: number;
    description?: string;
  };
  tokens: Record<string, string>;
}

// ─── In-memory token map ─────────────────────────────────────────────
// Multi-word tokens (keys with spaces) are handled before single-word tokens
// so that longer matches take priority (e.g. "brp harga" before "brp").

let tokenMap: Record<string, string> = {};
let sortedKeys: string[] = []; // sorted longest-first for greedy matching

function loadMap(): void {
  try {
    const raw = readFileSync(MAP_PATH, 'utf8');
    const parsed: ManglishMapFile = JSON.parse(raw);
    tokenMap = parsed.tokens || {};
    // Sort by descending key length so multi-word phrases match before subsets
    sortedKeys = Object.keys(tokenMap).sort((a, b) => b.length - a.length);
  } catch (err: any) {
    console.warn(`[ManglishNormalizer] Failed to load map from ${MAP_PATH}: ${err.message}`);
    tokenMap = {};
    sortedKeys = [];
  }
}

// Load on module init
loadMap();

/**
 * Reload the token map from disk (called after admin update).
 */
export function reloadManglishMap(): void {
  loadMap();
}

/**
 * Get the current token map (for admin read).
 */
export function getManglishMap(): ManglishMapFile {
  try {
    const raw = readFileSync(MAP_PATH, 'utf8');
    return JSON.parse(raw) as ManglishMapFile;
  } catch {
    return { tokens: {} };
  }
}

/**
 * Persist an updated token map to disk and reload in-memory map.
 */
export function saveManglishMap(data: ManglishMapFile): void {
  const serialised = JSON.stringify(data, null, 2);
  writeFileSync(MAP_PATH, serialised, 'utf8');
  reloadManglishMap();
}

/**
 * Add or update a single token in the map.
 */
export function upsertToken(token: string, replacement: string): void {
  const current = getManglishMap();
  current.tokens[token.toLowerCase()] = replacement;
  if (current._metadata) {
    current._metadata.tokenCount = Object.keys(current.tokens).length;
    current._metadata.lastUpdated = new Date().toISOString().slice(0, 10);
  }
  saveManglishMap(current);
}

/**
 * Delete a token from the map.
 */
export function deleteToken(token: string): boolean {
  const current = getManglishMap();
  const key = token.toLowerCase();
  if (!(key in current.tokens)) return false;
  delete current.tokens[key];
  if (current._metadata) {
    current._metadata.tokenCount = Object.keys(current.tokens).length;
    current._metadata.lastUpdated = new Date().toISOString().slice(0, 10);
  }
  saveManglishMap(current);
  return true;
}

/**
 * Normalise a Manglish message before intent classification.
 *
 * Algorithm:
 * 1. Lowercase the input for map lookup
 * 2. Attempt greedy longest-match substitution left-to-right
 * 3. Strip empty-string replacements (discourse particles)
 * 4. Collapse multiple spaces
 * 5. Return trimmed result (preserves original capitalisation where not matched)
 *
 * @param text - Raw user message text
 * @returns Normalised text for downstream classifiers
 */
export function normalizeManglish(text: string): string {
  if (!text || sortedKeys.length === 0) return text;

  const lower = text.toLowerCase();
  const inputLen = lower.length;

  // Build result by scanning left-to-right
  let result = '';
  let i = 0;

  while (i < inputLen) {
    let matched = false;

    // Skip leading whitespace at current position, carry it through
    if (lower[i] === ' ') {
      result += ' ';
      i++;
      continue;
    }

    // Try each key (longest first)
    for (const key of sortedKeys) {
      const keyLen = key.length;
      if (i + keyLen > inputLen) continue;

      const slice = lower.slice(i, i + keyLen);
      if (slice !== key) continue;

      // Ensure we are at a word boundary (previous char is space/start, next is space/end/punctuation)
      const prevOk = i === 0 || /[\s,!?.;]/.test(lower[i - 1]);
      const nextIdx = i + keyLen;
      const nextOk = nextIdx === inputLen || /[\s,!?.;]/.test(lower[nextIdx]);

      if (prevOk && nextOk) {
        const replacement = tokenMap[key];
        if (replacement !== '') {
          result += replacement;
        }
        // If replacement is '' (particle), we skip — effectively strips it
        i += keyLen;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // No match — copy original character from input text (preserves case)
      result += text[i];
      i++;
    }
  }

  // Collapse multiple spaces and trim
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Returns true if the map file exists on disk.
 */
export function isManglishMapAvailable(): boolean {
  return existsSync(MAP_PATH);
}
