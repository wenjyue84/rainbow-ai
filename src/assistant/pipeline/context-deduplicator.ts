/**
 * Conversation Message Deduplication Filter (US-241)
 *
 * Filters out duplicate or near-duplicate messages from conversation context
 * before AI inference, reducing token usage and context noise for improved
 * response quality.
 *
 * Algorithm:
 * 1. Iterate messages in order, keeping a "seen" list
 * 2. For each message, compare against all previously seen messages of the same role
 * 3. Use bigram-based similarity (Dice coefficient) to detect near-duplicates
 * 4. If similarity > 85%, mark as duplicate and skip
 * 5. Keep first occurrence of each unique/near-unique message
 * 6. Log deduplication metrics (removed_count, estimated_tokens_saved)
 */

import type { ChatMessage } from '../types.js';

// ─── Similarity Computation ─────────────────────────────────────────

/**
 * Extract character bigrams from a normalized string.
 * Normalization: lowercase, collapse whitespace, trim.
 */
function getBigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const bigrams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    bigrams.add(normalized.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * Compute Dice coefficient between two strings using character bigrams.
 * Returns a value between 0 (completely different) and 1 (identical).
 *
 * Dice = 2 * |intersection| / (|A| + |B|)
 */
export function computeSimilarity(a: string, b: string): number {
  const normalizedA = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedB = b.toLowerCase().replace(/\s+/g, ' ').trim();

  // Exact match shortcut
  if (normalizedA === normalizedB) return 1.0;

  // Very short strings: use exact match only
  if (normalizedA.length < 2 || normalizedB.length < 2) {
    return normalizedA === normalizedB ? 1.0 : 0.0;
  }

  const bigramsA = getBigrams(normalizedA);
  const bigramsB = getBigrams(normalizedB);

  if (bigramsA.size === 0 && bigramsB.size === 0) return 1.0;
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0.0;

  let intersectionCount = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) {
      intersectionCount++;
    }
  }

  return (2 * intersectionCount) / (bigramsA.size + bigramsB.size);
}

// ─── Token Estimation ───────────────────────────────────────────────

/**
 * Rough token estimate: ~4 characters per token (standard heuristic for English).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Deduplication Result ───────────────────────────────────────────

export interface DeduplicationMetrics {
  /** Number of duplicate messages removed */
  removed_count: number;
  /** Estimated tokens saved by removing duplicates */
  estimated_tokens_saved: number;
  /** Original message count before dedup */
  original_count: number;
  /** Final message count after dedup */
  final_count: number;
}

// ─── Default Threshold ──────────────────────────────────────────────

const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

// ─── Main Deduplication Function ────────────────────────────────────

/**
 * Filter out duplicate or near-duplicate messages from conversation context.
 *
 * Uses bigram-based Dice coefficient similarity matching with a configurable
 * threshold (default 85%). Keeps the first occurrence of each unique message.
 * Only compares messages with the same role (user vs. assistant).
 *
 * Logs deduplication metrics (removed_count, estimated_tokens_saved) to
 * conversation trace for monitoring effectiveness.
 *
 * @param messages - Array of conversation messages to deduplicate
 * @param threshold - Similarity threshold (0-1). Messages above this are considered duplicates. Default: 0.85
 * @returns Deduplicated array of messages (first occurrence kept)
 */
export function deduplicateMessages(
  messages: ChatMessage[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): ChatMessage[] {
  if (!messages || messages.length <= 1) {
    return messages ?? [];
  }

  const kept: ChatMessage[] = [];
  // Track seen messages per role so user messages aren't compared with assistant messages
  const seenByRole: Map<string, string[]> = new Map();
  let removedCount = 0;
  let tokensSaved = 0;

  for (const message of messages) {
    const role = message.role;
    const seenContents = seenByRole.get(role) ?? [];

    let isDuplicate = false;
    for (const seenContent of seenContents) {
      const similarity = computeSimilarity(message.content, seenContent);
      if (similarity >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      removedCount++;
      tokensSaved += estimateTokens(message.content);
    } else {
      kept.push(message);
      seenContents.push(message.content);
      seenByRole.set(role, seenContents);
    }
  }

  // Log deduplication metrics to conversation trace
  if (removedCount > 0) {
    const metrics: DeduplicationMetrics = {
      removed_count: removedCount,
      estimated_tokens_saved: tokensSaved,
      original_count: messages.length,
      final_count: kept.length,
    };
    console.log(
      `[ContextDedup] Deduplicated conversation: removed_count=${metrics.removed_count}, ` +
      `estimated_tokens_saved=${metrics.estimated_tokens_saved}, ` +
      `${metrics.original_count} -> ${metrics.final_count} messages`
    );
  }

  return kept;
}

/**
 * Get deduplication metrics without modifying the input.
 * Useful for dry-run analysis or monitoring.
 */
export function getDeduplicationMetrics(
  messages: ChatMessage[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): DeduplicationMetrics {
  if (!messages || messages.length <= 1) {
    return {
      removed_count: 0,
      estimated_tokens_saved: 0,
      original_count: messages?.length ?? 0,
      final_count: messages?.length ?? 0,
    };
  }

  const seenByRole: Map<string, string[]> = new Map();
  let removedCount = 0;
  let tokensSaved = 0;

  for (const message of messages) {
    const role = message.role;
    const seenContents = seenByRole.get(role) ?? [];

    let isDuplicate = false;
    for (const seenContent of seenContents) {
      const similarity = computeSimilarity(message.content, seenContent);
      if (similarity >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      removedCount++;
      tokensSaved += estimateTokens(message.content);
    } else {
      seenContents.push(message.content);
      seenByRole.set(role, seenContents);
    }
  }

  return {
    removed_count: removedCount,
    estimated_tokens_saved: tokensSaved,
    original_count: messages.length,
    final_count: messages.length - removedCount,
  };
}
