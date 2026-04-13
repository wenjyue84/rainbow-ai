/**
 * KeywordMatcher — Weighted intent keyword scoring with recency bias
 *
 * Wraps FuzzyIntentMatcher and applies recency multipliers so that keywords
 * found in recent conversation turns contribute more to the final score than
 * keywords found in older turns.
 *
 * Recency curve (default, configurable via settings.json):
 *   - 0-2 turns ago: 2.0x multiplier
 *   - 3-5 turns ago: 1.5x multiplier
 *   - 6+  turns ago: 1.0x multiplier
 */

import { FuzzyIntentMatcher, type KeywordIntent, type FuzzyMatchResult } from '../fuzzy-matcher.js';

export type { KeywordIntent };

export interface RecencyWeightCurve {
  /** Multiplier for messages 0-2 turns ago (most recent) */
  recent: number;
  /** Multiplier for messages 3-5 turns ago */
  mid: number;
  /** Multiplier for messages 6+ turns ago (oldest) */
  old: number;
}

export interface KeywordMatchWithRecency {
  intent: string;
  /** Base confidence score from fuzzy matching (0-1) */
  score: number;
  /** Score after recency multiplier applied */
  weightedScore: number;
  matchedKeyword?: string;
  /** Index of the message that produced the best match */
  turnIndex: number;
  /** The recency multiplier that was applied */
  recencyMultiplier: number;
}

export interface KeywordMatcherOptions {
  recencyBiasEnabled?: boolean;
  weightCurve?: Partial<RecencyWeightCurve>;
}

const DEFAULT_CURVE: RecencyWeightCurve = {
  recent: 2.0,
  mid: 1.5,
  old: 1.0,
};

export class KeywordMatcher {
  private readonly fuzzy: FuzzyIntentMatcher;
  private readonly recencyBiasEnabled: boolean;
  private readonly curve: RecencyWeightCurve;

  constructor(intents: KeywordIntent[], options: KeywordMatcherOptions = {}) {
    this.fuzzy = new FuzzyIntentMatcher(intents);
    this.recencyBiasEnabled = options.recencyBiasEnabled ?? true;
    this.curve = { ...DEFAULT_CURVE, ...options.weightCurve };
  }

  /**
   * Return the recency multiplier for a message at `turnIndex` in a conversation
   * of `totalTurns` messages.
   *
   * turnIndex 0 = oldest message, totalTurns-1 = most recent.
   */
  private getRecencyMultiplier(turnIndex: number, totalTurns: number): number {
    if (!this.recencyBiasEnabled) return 1.0;
    const turnsAgo = totalTurns - 1 - turnIndex;
    if (turnsAgo <= 2) return this.curve.recent;
    if (turnsAgo <= 5) return this.curve.mid;
    return this.curve.old;
  }

  /**
   * Match keywords across all messages in a conversation, weighting recent
   * messages higher than older ones.
   *
   * @param messages  Ordered conversation turns (index 0 = oldest, last = newest)
   * @param languageFilter  Optional language filter forwarded to FuzzyIntentMatcher
   * @returns Best keyword match across the conversation after recency weighting,
   *          or null if no turn matched any keyword.
   */
  matchKeywords(
    messages: Array<{ text: string; role?: string }>,
    languageFilter?: 'en' | 'ms' | 'zh' | 'ta'
  ): KeywordMatchWithRecency | null {
    let best: KeywordMatchWithRecency | null = null;

    for (let i = 0; i < messages.length; i++) {
      const baseMatch: FuzzyMatchResult | null = this.fuzzy.match(messages[i].text, languageFilter);
      if (!baseMatch) continue;

      const multiplier = this.getRecencyMultiplier(i, messages.length);
      const weightedScore = baseMatch.score * multiplier;

      if (!best || weightedScore > best.weightedScore) {
        best = {
          intent: baseMatch.intent,
          score: baseMatch.score,
          weightedScore,
          matchedKeyword: baseMatch.matchedKeyword,
          turnIndex: i,
          recencyMultiplier: multiplier,
        };
      }
    }

    return best;
  }

  /**
   * Convenience: match a single message (no recency bias applied).
   * Delegates directly to the underlying FuzzyIntentMatcher.
   */
  matchSingle(
    text: string,
    languageFilter?: 'en' | 'ms' | 'zh' | 'ta'
  ): FuzzyMatchResult | null {
    return this.fuzzy.match(text, languageFilter);
  }
}
