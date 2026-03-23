/**
 * context.ts — Conversation context message decay scorer (US-262)
 *
 * Implements exponential decay function that assigns relevance scores
 * to historical messages in multi-turn conversations. Newer messages
 * receive higher relevance; older messages contribute less to AI context
 * when token limits are reached.
 *
 * Decay formula: score = exp(-lambda * age)
 *   where age = (totalMessages - 1 - messageIndex)
 *   and lambda = ln(2) / halfLife
 *
 * With default half-life of 3 messages:
 *   - Newest message (age 0): score = 1.0
 *   - 3 messages old (age 3): score = 0.5
 *   - >5 messages old (age > 5): score < 0.3
 */

import type { ChatMessage } from '../types.js';

/** Default half-life in message positions */
const DEFAULT_HALF_LIFE = 3;

/**
 * Score a message's relevance based on its position in conversation history
 * using exponential decay.
 *
 * @param _message  - The chat message (reserved for future content-aware scoring)
 * @param messageIndex - Zero-based position in history (0 = oldest)
 * @param totalMessages - Total number of messages in the conversation
 * @param halfLife - Number of message positions for score to halve (default: 3)
 * @returns Relevance score between 0 and 1 (1 = most relevant)
 */
export function scoreMessageRelevance(
  _message: ChatMessage,
  messageIndex: number,
  totalMessages: number,
  halfLife: number = DEFAULT_HALF_LIFE,
): number {
  // Edge cases
  if (totalMessages <= 0) return 0;
  if (totalMessages === 1) return 1;

  // Age: how many positions back from the newest message
  const age = (totalMessages - 1) - messageIndex;

  // Decay constant: lambda = ln(2) / halfLife
  const lambda = Math.LN2 / halfLife;

  // Exponential decay: newest (age=0) = 1.0, halves every halfLife messages
  const score = Math.exp(-lambda * age);

  // Clamp to [0, 1] (should already be in range, but be safe)
  return Math.max(0, Math.min(1, score));
}
