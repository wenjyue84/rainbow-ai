/**
 * Language-specific keyword weight multipliers for intent matching (US-572)
 *
 * Boosts Tamil (ta) and Malayalam (ml) intent scores to improve classification
 * accuracy for non-English messages. Weights > 1.0 lower the effective threshold
 * by increasing the score before comparison.
 */

export interface KeywordWeights {
  en_weight?: number;
  ta_weight?: number;
  ml_weight?: number;
  ms_weight?: number;
  zh_weight?: number;
}

/** A keyword entry that may carry per-language weight fields */
export interface Keyword extends KeywordWeights {
  text: string;
}

/**
 * Apply language-specific weight multiplier to a base fuzzy match score.
 *
 * @param baseScore  Raw fuzzy match score (0-1)
 * @param language   Detected/preferred language code (e.g. 'ta', 'en', 'ml')
 * @param keyword    Keyword or weight object containing per-language weight fields
 * @returns          baseScore * multiplier (may exceed 1.0 — caller may clamp)
 *
 * @example
 *   applyLanguageWeight(0.8, 'ta', { text: 'book', en_weight: 1.0, ta_weight: 1.3 })
 *   // => 0.8 * 1.3 = 1.04
 */
export function applyLanguageWeight(
  baseScore: number,
  language: string,
  keyword: Keyword | KeywordWeights
): number {
  const weightKey = `${language}_weight` as keyof KeywordWeights;
  const multiplier = (keyword as any)[weightKey] ?? 1.0;
  return baseScore * multiplier;
}

/**
 * Build a map of intent name → keyword_weights from loaded intent-keywords data.
 * Used at initialisation time so weight lookups are O(1) during classification.
 */
export function buildIntentWeightsMap(
  keywordData: { intents: Array<{ intent: string; keyword_weights?: KeywordWeights }> }
): Map<string, KeywordWeights> {
  const map = new Map<string, KeywordWeights>();
  for (const entry of keywordData.intents) {
    if (entry.keyword_weights) {
      map.set(entry.intent, entry.keyword_weights);
    }
  }
  return map;
}
