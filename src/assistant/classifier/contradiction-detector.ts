/**
 * Keyword Contradiction Detector (US-573)
 *
 * Detects when a user message contains keywords from conflicting intent categories.
 * When multiple intents have scores within 15% of the top score, flags as ambiguous
 * and routes to clarification handler instead of misclassifying as a single intent.
 */

/**
 * Keyword entry from intent-keywords.json
 */
export interface Keyword {
  text: string;
  [key: string]: any; // Allow for language-specific weight fields
}

/**
 * Intent keywords mapping
 */
export interface IntentKeywords {
  intent: string;
  keywords: {
    [language: string]: string[];
  };
}

/**
 * Individual top match from fuzzy/semantic matching
 */
export interface TopScore {
  intent: string;
  score: number;
  matchedKeyword?: string;
  matchedExample?: string;
}

/**
 * Result of contradiction detection
 */
export interface ContradictionResult {
  hasContradiction: boolean;
  conflicting_intents: string[];
  top_scores: { intent: string; score: number }[];
}

/**
 * Detect keyword contradictions in user message
 *
 * Flags a contradiction when 2+ intents have scores within 15% of the top score.
 * This indicates an ambiguous message that should be routed to clarification instead
 * of being misclassified.
 *
 * @param message - User message text
 * @param allMatches - All fuzzy/semantic match results, sorted by score descending
 * @returns ContradictionResult with hasContradiction flag and conflicting intents
 *
 * @example
 *   const matches = [
 *     { intent: 'booking', score: 0.82 },
 *     { intent: 'cancel', score: 0.79 }, // Within 15% of 0.82
 *   ];
 *   detectKeywordContradictions('I want to book a room but cancel my reservation', matches);
 *   // => { hasContradiction: true, conflicting_intents: ['booking', 'cancel'], top_scores: [...] }
 */
export function detectKeywordContradictions(
  message: string,
  allMatches: TopScore[]
): ContradictionResult {
  // Return no contradiction if fewer than 2 matches
  if (!allMatches || allMatches.length < 2) {
    return {
      hasContradiction: false,
      conflicting_intents: [],
      top_scores: allMatches.slice(0, 3).map(m => ({ intent: m.intent, score: m.score })),
    };
  }

  // Sort by score descending (should already be sorted, but ensure it)
  const sorted = [...allMatches].sort((a, b) => b.score - a.score);
  const topScore = sorted[0].score;
  const contradictionThreshold = 0.15; // 15% range

  // Find all intents within 15% of the top score
  const conflictingMatches = sorted.filter(
    match => topScore - match.score <= contradictionThreshold * topScore
  );

  // Contradiction exists when 2+ intents are in the conflict range
  const hasContradiction = conflictingMatches.length >= 2;

  if (hasContradiction) {
    console.log(
      `[Contradiction-US573] Detected ambiguous message: ` +
      `${conflictingMatches.map(m => `${m.intent}(${(m.score * 100).toFixed(0)}%)`).join(', ')}`
    );
  }

  return {
    hasContradiction,
    conflicting_intents: hasContradiction ? conflictingMatches.map(m => m.intent) : [],
    top_scores: sorted.slice(0, 3).map(m => ({ intent: m.intent, score: m.score })),
  };
}
