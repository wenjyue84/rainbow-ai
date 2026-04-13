/**
 * message-ordering-validator.ts — Detect and Log Message Timestamp Ordering Issues (US-593)
 *
 * Validates that conversation messages are in chronological order before
 * context inclusion. Flags out-of-order timestamps and emits warnings with
 * conversation metadata for debugging timing/network issues.
 */

import type { ChatMessage } from '../assistant/types.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('MessageOrderingValidator');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MessageOrderingIssue {
  /** Derived message identifier: "msg_<actualIndex>" */
  messageId: string;
  /** Position in timestamp-sorted order (where message should be) */
  expectedIndex: number;
  /** Position in actual array (where message is) */
  actualIndex: number;
  /** Unix seconds timestamp of the out-of-order message */
  timestamp: number;
}

export interface SimultaneousGroup {
  /** Shared timestamp (Unix seconds) */
  timestamp: number;
  /** Actual indices of messages sharing this timestamp */
  indices: number[];
}

export interface MessageOrderingResult {
  /** True if any out-of-order messages were detected */
  hasOrderingIssues: boolean;
  /** List of individual out-of-order message details */
  issues: MessageOrderingIssue[];
  /** Groups of messages sharing the same timestamp */
  simultaneousGroups: SimultaneousGroup[];
  /** Summary: count of affected messages */
  affectedCount: number;
}

// ─── Core Validator ──────────────────────────────────────────────────────────

/**
 * Validate timestamp ordering of conversation messages.
 *
 * Compares the actual message array order to timestamp-sorted order.
 * Any message whose position differs between the two orderings is flagged.
 * Messages with equal timestamps are reported as simultaneous groups (not errors).
 *
 * Emits logger.warn for each out-of-order message with:
 *   conversationId, messageId, expectedIndex, actualIndex
 *
 * Messages with null/undefined timestamps are skipped gracefully.
 *
 * @param messages        Array of conversation messages in arrival order
 * @param conversationId  Conversation identifier (phone number or session ID)
 * @returns               Validation result with issues and simultaneous groups
 */
export function validateMessageOrdering(
  messages: ChatMessage[],
  conversationId: string = 'unknown',
): MessageOrderingResult {
  if (messages.length <= 1) {
    return {
      hasOrderingIssues: false,
      issues: [],
      simultaneousGroups: [],
      affectedCount: 0,
    };
  }

  // ── Build sorted order (stable sort by timestamp) ──────────────────────
  const withIndex = messages.map((msg, idx) => ({ msg, idx }));

  // Only sort messages that have valid timestamps
  const timestamped = withIndex.filter(({ msg }) => msg.timestamp != null && isFinite(msg.timestamp));
  const untimestamped = withIndex.filter(({ msg }) => msg.timestamp == null || !isFinite(msg.timestamp));

  if (timestamped.length <= 1) {
    // No ordering can be inferred with <2 timestamped messages
    return {
      hasOrderingIssues: false,
      issues: [],
      simultaneousGroups: [],
      affectedCount: 0,
    };
  }

  // Stable sort timestamped subset by timestamp ascending
  const sorted = [...timestamped].sort((a, b) => {
    const diff = a.msg.timestamp - b.msg.timestamp;
    if (diff !== 0) return diff;
    // Equal timestamps: preserve original order (stable)
    return a.idx - b.idx;
  });

  // ── Detect out-of-order messages ──────────────────────────────────────
  // Compare each message's position in the sorted subset vs its original
  // position in the timestamped subset (not the full array index).
  // This correctly handles null-timestamp messages interspersed in the array.
  const issues: MessageOrderingIssue[] = [];

  for (let expectedIdx = 0; expectedIdx < sorted.length; expectedIdx++) {
    const sortedEntry = sorted[expectedIdx];
    // Find where this message was in the ORIGINAL timestamped order
    const actualIdx = timestamped.findIndex(t => t.idx === sortedEntry.idx);
    if (actualIdx !== expectedIdx) {
      const messageId = `msg_${sortedEntry.idx}`;
      issues.push({
        messageId,
        expectedIndex: expectedIdx,
        actualIndex: actualIdx,
        timestamp: sortedEntry.msg.timestamp,
      });

      logger.warn('[US-593] Out-of-order message detected', {
        conversationId,
        messageId,
        expectedIndex: expectedIdx,
        actualIndex: actualIdx,
        timestamp: sortedEntry.msg.timestamp,
        role: sortedEntry.msg.role,
      });
    }
  }

  // ── Detect simultaneous timestamp groups ──────────────────────────────
  const tsGroups = new Map<number, number[]>();
  for (const { msg, idx } of timestamped) {
    const ts = msg.timestamp;
    if (!tsGroups.has(ts)) tsGroups.set(ts, []);
    tsGroups.get(ts)!.push(idx);
  }

  const simultaneousGroups: SimultaneousGroup[] = [];
  for (const [ts, indices] of tsGroups.entries()) {
    if (indices.length > 1) {
      simultaneousGroups.push({ timestamp: ts, indices });
    }
  }

  const hasOrderingIssues = issues.length > 0;

  if (hasOrderingIssues) {
    logger.warn('[US-593] Conversation has timestamp ordering anomalies', {
      conversationId,
      affectedCount: issues.length,
      totalMessages: messages.length,
      simultaneousGroupCount: simultaneousGroups.length,
      untimestampedCount: untimestamped.length,
    });
  }

  return {
    hasOrderingIssues,
    issues,
    simultaneousGroups,
    affectedCount: issues.length,
  };
}
