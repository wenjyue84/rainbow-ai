/**
 * token-counter.ts — Lightweight token estimation utility
 *
 * Uses a characters/4 heuristic (standard approximation for English text).
 * Sufficient for budget enforcement without requiring tiktoken dependency.
 */

/**
 * Estimate token count for a string using chars/4 heuristic.
 * This approximation is within ~10-20% of actual tokenizer output
 * for English/Malay text and slightly overestimates for CJK (safer).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens for an array of chat messages,
 * including role overhead (~4 tokens per message for role/separators).
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>
): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content) + 4; // ~4 tokens per message overhead
  }
  return total;
}
