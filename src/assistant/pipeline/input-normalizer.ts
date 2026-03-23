/**
 * US-318: Intent Classifier Input Normalization Validator with Regional Format Support
 *
 * Validates and normalizes user input before intent classification:
 * - Lowercase conversion
 * - Trim leading/trailing whitespace
 * - Collapse internal whitespace runs (preserve single spaces)
 * - Strip emojis (Unicode emoji ranges)
 * - Handle diacritics for Malaysian/Tamil text (normalize Unicode combining marks)
 * - Log original vs. normalized when format differs
 */

// ─── Emoji Regex ─────────────────────────────────────────────────────
// Matches most common emoji ranges including:
// - Emoticons, Dingbats, Symbols
// - Supplemental Symbols, Pictographs
// - Transport/Map, Enclosed, Misc Symbols
// - Regional Indicator Symbols, Variation Selectors, ZWJ
// - Skin tone modifiers

const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{FE0E}\u{FE0F}]/gu;

// ─── Diacritics / Combining Marks ────────────────────────────────────
// Unicode Combining Diacritical Marks block (U+0300–U+036F).
// Tamil vowel signs, virama, etc. live in the Tamil block (U+0B80–U+0BFF)
// and should NOT be stripped — they are integral to the script.
// We only normalize Latin-script diacritics (e.g., accented Malay text).

const LATIN_COMBINING_MARKS_REGEX = /[\u0300-\u036F]/g;

// ─── Types ───────────────────────────────────────────────────────────

export interface NormalizeResult {
  /** The normalized text */
  normalized: string;
  /** The original text before normalization */
  original: string;
  /** Whether normalization changed the input */
  changed: boolean;
  /** List of transformations applied */
  transformations: string[];
}

// ─── Core Normalizer ─────────────────────────────────────────────────

/**
 * Normalize user input for intent classification.
 *
 * Steps (in order):
 * 1. Trim leading/trailing whitespace
 * 2. Strip emojis
 * 3. Normalize Unicode (NFD) then strip Latin combining marks (diacritics)
 * 4. Re-compose to NFC for consistent downstream matching
 * 5. Lowercase
 * 6. Collapse internal whitespace runs to single spaces
 * 7. Final trim (in case emoji/diacritic removal left leading/trailing spaces)
 *
 * Tamil script characters (U+0B80–U+0BFF) are preserved — their vowel signs
 * and combining marks are integral to the writing system.
 * Malay text with Latin diacritics (e.g., café → cafe) is normalized.
 */
export function normalizeInput(input: string): NormalizeResult {
  const original = input;
  const transformations: string[] = [];

  let text = input;

  // Step 1: Trim
  const trimmed = text.trim();
  if (trimmed !== text) {
    transformations.push('trimmed');
    text = trimmed;
  }

  // Step 2: Strip emojis
  const noEmoji = text.replace(EMOJI_REGEX, '');
  if (noEmoji !== text) {
    transformations.push('emoji_stripped');
    text = noEmoji;
  }

  // Step 3-4: Normalize diacritics (Latin script only)
  // NFD decomposes characters like é → e + combining accent
  // Then we strip Latin combining marks (U+0300–U+036F)
  // Tamil combining marks (U+0B80–U+0BFF range) are unaffected
  const decomposed = text.normalize('NFD');
  const noDiacritics = decomposed.replace(LATIN_COMBINING_MARKS_REGEX, '');
  const recomposed = noDiacritics.normalize('NFC');
  if (recomposed !== text) {
    transformations.push('diacritics_normalized');
    text = recomposed;
  }

  // Step 5: Lowercase
  const lowered = text.toLowerCase();
  if (lowered !== text) {
    transformations.push('lowercased');
    text = lowered;
  }

  // Step 6: Collapse internal whitespace
  const collapsed = text.replace(/\s+/g, ' ');
  if (collapsed !== text) {
    transformations.push('whitespace_collapsed');
    text = collapsed;
  }

  // Step 7: Final trim (emoji/diacritic removal may leave edge spaces)
  const finalTrimmed = text.trim();
  if (finalTrimmed !== text) {
    text = finalTrimmed;
    // Don't double-count 'trimmed' if already logged
    if (!transformations.includes('trimmed')) {
      transformations.push('trimmed');
    }
  }

  const changed = text !== original;

  return { normalized: text, original, changed, transformations };
}

// ─── Debug Logger ────────────────────────────────────────────────────

/**
 * Log the normalization result to debug console when the input was changed.
 * Called by the classifier pipeline to track formatting patterns that may
 * cause misclassification.
 */
export function logNormalization(result: NormalizeResult): void {
  if (!result.changed) return;

  console.debug(
    `[InputNormalizer] original="${result.original.slice(0, 120)}" → normalized="${result.normalized.slice(0, 120)}" [${result.transformations.join(', ')}]`
  );
}
