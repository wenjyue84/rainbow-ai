/**
 * timestamp-validator.ts — Conversation Message Timestamp Ordering Validator (US-468)
 *
 * Detects out-of-order, duplicate, and skewed timestamps in multi-message conversations.
 * Automatically reorders messages when safe (diff < 5s) and logs anomalies for debugging.
 *
 * Features:
 * - Flag backwards timestamps (current_ts < previous_ts by > 1s)
 * - Reorder messages when time difference < 5 seconds (likely clock skew)
 * - Detect duplicate timestamps within a conversation
 * - Log WARN if > 3 duplicates, ERROR if > 10
 * - Skip gracefully if message.timestamp is null/undefined
 * - Track reorder_count and duplicate_count in result for analytics
 */

import type { ChatMessage } from '../types.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('TimestampValidator');

/** Threshold: backwards by more than this is flagged (seconds) */
const BACKWARDS_THRESHOLD_S = 1;

/** Threshold: reorder only if diff is within this range (seconds) */
const REORDER_MAX_DIFF_S = 5;

/** Duplicate count thresholds */
const WARN_DUPLICATE_THRESHOLD = 3;
const ERROR_DUPLICATE_THRESHOLD = 10;

export interface TimestampValidationResult {
  messages: ChatMessage[];
  reordered_count: number;
  duplicate_count: number;
  max_gap_ms: number;
}

/**
 * Validate and optionally reorder conversation messages based on timestamps.
 *
 * Skips messages with null/undefined timestamps. Reorders adjacent messages when
 * clock skew is small (< 5s). Logs anomalies at WARN/ERROR depending on severity.
 *
 * @param messages - Conversation messages to validate
 * @param conversationId - Used in log context for debugging
 * @returns Validated (and possibly reordered) messages with anomaly counts
 */
export function validateTimestamps(
  messages: ChatMessage[],
  conversationId: string = 'unknown'
): TimestampValidationResult {
  if (messages.length === 0) {
    return { messages: [], reordered_count: 0, duplicate_count: 0, max_gap_ms: 0 };
  }

  // ─── Separate timestamped from non-timestamped messages ──────────────
  // Messages without timestamps are passed through unchanged at their original positions.
  // We only validate and reorder the subset that has timestamps.

  const indexed = messages.map((msg, idx) => ({ msg, idx }));
  const withTs = indexed.filter(({ msg }) => msg.timestamp != null);

  if (withTs.length === 0) {
    return { messages, reordered_count: 0, duplicate_count: 0, max_gap_ms: 0 };
  }

  // ─── Pass 1: Detect duplicate timestamps ────────────────────────────
  const tsCounts = new Map<number, number>();
  for (const { msg } of withTs) {
    const ts = msg.timestamp;
    tsCounts.set(ts, (tsCounts.get(ts) ?? 0) + 1);
  }

  let duplicate_count = 0;
  for (const count of tsCounts.values()) {
    if (count > 1) {
      duplicate_count += count - 1;
    }
  }

  if (duplicate_count > ERROR_DUPLICATE_THRESHOLD) {
    logger.error('[US-468] Excessive duplicate timestamps detected', {
      conversation_id: conversationId,
      duplicate_count,
      affected_message_count: withTs.length,
    });
  } else if (duplicate_count > WARN_DUPLICATE_THRESHOLD) {
    logger.warn('[US-468] Duplicate timestamps detected', {
      conversation_id: conversationId,
      duplicate_count,
      affected_message_count: withTs.length,
    });
  }

  // ─── Pass 2: Detect and fix backwards timestamps (clock skew) ───────
  // Perform a single-pass insertion sort on timestamped messages.
  // Only reorder adjacent swaps where |diff| < REORDER_MAX_DIFF_S.

  const reorderable = withTs.map(({ msg }) => ({ ...msg }));
  let reordered_count = 0;

  for (let i = 1; i < reorderable.length; i++) {
    const prev = reorderable[i - 1];
    const curr = reorderable[i];

    const prevTs = prev.timestamp ?? 0;
    const currTs = curr.timestamp ?? 0;

    const diffS = prevTs - currTs; // positive = curr is behind prev (backwards)

    if (diffS > BACKWARDS_THRESHOLD_S) {
      if (diffS <= REORDER_MAX_DIFF_S) {
        // Safe to reorder (small clock skew)
        reorderable[i - 1] = curr;
        reorderable[i] = prev;
        reordered_count++;
        logger.debug('[US-468] Reordered adjacent messages due to clock skew', {
          conversation_id: conversationId,
          diff_s: diffS,
          prev_ts: prevTs,
          curr_ts: currTs,
        });
      } else {
        // Large backwards gap — flag only, don't reorder
        logger.warn('[US-468] Large backwards timestamp detected (not reordered)', {
          conversation_id: conversationId,
          diff_s: diffS,
          prev_ts: prevTs,
          curr_ts: currTs,
        });
      }
    }
  }

  // ─── Pass 3: Compute max_gap_ms across the (now reordered) sequence ──
  let max_gap_ms = 0;
  for (let i = 1; i < reorderable.length; i++) {
    const prevTs = (reorderable[i - 1].timestamp ?? 0) * 1000;
    const currTs = (reorderable[i].timestamp ?? 0) * 1000;
    const gap = Math.abs(currTs - prevTs);
    if (gap > max_gap_ms) {
      max_gap_ms = gap;
    }
  }

  // ─── Reconstruct full message array ──────────────────────────────────
  // Replace timestamped positions with the (re)ordered subset.
  // Messages without timestamps stay at their original positions.
  const result = [...messages];
  let reorderableIdx = 0;
  for (const { idx } of withTs) {
    result[idx] = reorderable[reorderableIdx++];
  }

  const validationResult: TimestampValidationResult = {
    messages: result,
    reordered_count,
    duplicate_count,
    max_gap_ms,
  };

  if (reordered_count > 0 || duplicate_count > 0) {
    logger.info('[US-468] Timestamp validation result', {
      conversation_id: conversationId,
      timestamp_validation_result: validationResult,
    });
  }

  return validationResult;
}
