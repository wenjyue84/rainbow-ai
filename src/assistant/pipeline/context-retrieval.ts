/**
 * context-retrieval.ts — Relevance-Filtered Context Retrieval (US-553)
 *
 * Wraps the raw message history from the conversation state and applies
 * relevance scoring to exclude low-relevance messages before they are
 * forwarded to AI providers.
 *
 * Filtering threshold: messages with relevance_score < 0.4 are excluded.
 * The filtered count is logged at debug level for observability.
 */

import type { ChatMessage } from '../types.js';
import { scoreMessageRelevance } from '../../lib/relevance-scorer.js';

const RELEVANCE_THRESHOLD = 0.4;

export interface ContextRetrievalResult {
  messages: ChatMessage[];
  /** Total messages before filtering */
  originalCount: number;
  /** Number of messages excluded by the relevance filter */
  filteredCount: number;
}

/**
 * Filter a message history to only include messages relevant to the current intent.
 *
 * Messages are scored using scoreMessageRelevance() and those below
 * RELEVANCE_THRESHOLD (0.4) are dropped to reduce token bloat.
 *
 * @param messages - Full ordered conversation history (oldest → newest)
 * @param intent   - Currently detected user intent
 * @param nowMs    - Current timestamp in ms (injectable for testing)
 * @returns Filtered message array plus count metadata
 */
export function retrieveRelevantContext(
  messages: ChatMessage[],
  intent: string,
  nowMs: number = Date.now()
): ContextRetrievalResult {
  if (messages.length === 0) {
    return { messages: [], originalCount: 0, filteredCount: 0 };
  }

  const scored = messages.map((msg) => ({
    msg,
    score: scoreMessageRelevance(msg, intent, messages, nowMs),
  }));

  const relevant = scored.filter(({ score }) => score >= RELEVANCE_THRESHOLD);
  const filteredCount = messages.length - relevant.length;

  if (filteredCount > 0) {
    // debug-level log (avoids importing logger to keep this module lean)
    if (process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV !== 'production') {
      console.debug(
        `[context-retrieval] intent="${intent}" filtered ${filteredCount}/${messages.length} low-relevance messages`
      );
    }
  }

  return {
    messages: relevant.map(({ msg }) => msg),
    originalCount: messages.length,
    filteredCount,
  };
}
