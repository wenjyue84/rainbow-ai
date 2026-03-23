/**
 * context-ttl-filter.ts — US-299: Conversation Context Message TTL Filter
 *
 * Filters stale messages from conversation context based on a configurable TTL
 * (time-to-live) to improve relevance and reduce context drift in multi-turn
 * booking dialogs. Messages older than the TTL threshold (relative to the newest
 * message timestamp) are removed.
 *
 * The newest message is always preserved regardless of TTL.
 */

import type { ChatMessage } from '../types.js';

/**
 * Filter stale messages from conversation context based on TTL.
 *
 * Removes messages whose timestamp is older than `ttlSec` seconds relative
 * to the newest message's timestamp. The latest message is always preserved.
 *
 * @param messages - Array of conversation messages (chronological order)
 * @param ttlSec - Time-to-live in seconds; messages older than this are removed
 * @returns Filtered array of messages within the TTL window
 */
export function filterStaleMessages(
  messages: ChatMessage[],
  ttlSec: number,
): ChatMessage[] {
  if (messages.length === 0) {
    return [];
  }

  // Find the latest (newest) message timestamp
  const latestTimestamp = Math.max(...messages.map(m => m.timestamp));

  // Calculate the cutoff: messages older than this are stale
  const cutoff = latestTimestamp - ttlSec;

  // Filter messages: keep those within the TTL window
  const filtered = messages.filter(m => m.timestamp >= cutoff);

  // Always preserve the latest message even if somehow excluded
  if (filtered.length === 0) {
    const latestMsg = messages.find(m => m.timestamp === latestTimestamp);
    return latestMsg ? [latestMsg] : [];
  }

  return filtered;
}
