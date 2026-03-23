/**
 * build-context.ts — AI context builder with decay-based truncation (US-262)
 *
 * Uses decay scores from scoreMessageRelevance to rank and truncate
 * conversation messages when they exceed the token budget (default 8000).
 * Messages are ranked by relevance score; lowest-scoring messages are
 * dropped first until the context fits within the budget.
 */

import type { ChatMessage } from '../types.js';
import { scoreMessageRelevance } from '../lib/context.js';
import { estimateTokens } from '../../lib/token-counter.js';

/** Default maximum tokens for AI context */
const DEFAULT_MAX_CONTEXT_TOKENS = 8000;

/** Overhead tokens per message (role markers, separators) */
const MESSAGE_OVERHEAD_TOKENS = 4;

export interface ContextBuildResult {
  /** Messages to include in AI context, in original chronological order */
  messages: ChatMessage[];
  /** Whether any messages were dropped */
  wasTruncated: boolean;
  /** Total tokens in the original conversation */
  originalTokens: number;
  /** Total tokens after truncation */
  truncatedTokens: number;
  /** Number of messages dropped */
  droppedCount: number;
}

/**
 * Estimate total tokens for a set of messages.
 */
function estimateMessagesTokenCount(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content) + MESSAGE_OVERHEAD_TOKENS;
  }
  return total;
}

/**
 * Build AI context from conversation messages, truncating by decay score
 * when the token limit is exceeded.
 *
 * Strategy:
 * 1. Score each message using exponential decay
 * 2. If total tokens <= maxTokens, return all messages
 * 3. Otherwise, sort by score ascending, drop lowest-scored messages
 *    one at a time until within budget
 * 4. Return surviving messages in original chronological order
 *
 * The newest message is always preserved (score = 1.0).
 *
 * @param messages - Full conversation history (chronological order)
 * @param maxTokens - Maximum token budget (default 8000)
 * @returns Context build result with truncated messages
 */
export function buildContext(
  messages: ChatMessage[],
  maxTokens: number = DEFAULT_MAX_CONTEXT_TOKENS,
): ContextBuildResult {
  if (messages.length === 0) {
    return {
      messages: [],
      wasTruncated: false,
      originalTokens: 0,
      truncatedTokens: 0,
      droppedCount: 0,
    };
  }

  const originalTokens = estimateMessagesTokenCount(messages);

  // If within budget, no truncation needed
  if (originalTokens <= maxTokens) {
    return {
      messages: [...messages],
      wasTruncated: false,
      originalTokens,
      truncatedTokens: originalTokens,
      droppedCount: 0,
    };
  }

  // Score each message and track original index
  const scored = messages.map((msg, idx) => ({
    message: msg,
    score: scoreMessageRelevance(msg, idx, messages.length),
    originalIndex: idx,
  }));

  // Sort by score ascending so we can drop lowest-scored first
  const sortedByScore = [...scored].sort((a, b) => a.score - b.score);

  // Track which messages to keep (all start as kept)
  const kept = new Set<number>(scored.map((_, i) => i));

  // Always keep the newest message (highest score)
  const newestIndex = messages.length - 1;

  // Drop messages one at a time until within budget
  let currentTokens = originalTokens;
  for (const item of sortedByScore) {
    if (currentTokens <= maxTokens) break;
    // Never drop the newest message
    if (item.originalIndex === newestIndex) continue;

    kept.delete(item.originalIndex);
    currentTokens -= estimateTokens(item.message.content) + MESSAGE_OVERHEAD_TOKENS;
  }

  // Build result in original chronological order
  const result = scored
    .filter(item => kept.has(item.originalIndex))
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(item => item.message);

  const truncatedTokens = estimateMessagesTokenCount(result);

  return {
    messages: result,
    wasTruncated: true,
    originalTokens,
    truncatedTokens,
    droppedCount: messages.length - result.length,
  };
}
