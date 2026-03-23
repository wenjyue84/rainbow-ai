/**
 * US-299: Conversation Context Message TTL Filter for Multi-Turn Dialogs
 *
 * Tests:
 * 1. filterStaleMessages removes messages older than TTL; preserves recent ones
 * 2. 10-message conversation with 5 messages >2h old filters to 5 recent messages
 * 3. Latest message timestamp is always preserved
 * 4. Filtered context improves booking accuracy by removing old context drift
 */
import { describe, test, expect } from 'vitest';

import { filterStaleMessages } from '../assistant/pipeline/context-ttl-filter.js';
import type { ChatMessage } from '../assistant/types.js';

/**
 * Helper to create a ChatMessage with a given timestamp offset (in seconds)
 * relative to a base time.
 */
function makeMessage(
  role: 'user' | 'assistant',
  content: string,
  timestampSec: number,
): ChatMessage {
  return { role, content, timestamp: timestampSec };
}

describe('US-299: Conversation Context Message TTL Filter', () => {
  const NOW_SEC = 1700000000; // Arbitrary reference timestamp (Unix seconds)
  const TWO_HOURS_SEC = 2 * 60 * 60; // 7200 seconds
  const ONE_HOUR_SEC = 60 * 60;      // 3600 seconds (default TTL)

  describe('filterStaleMessages(messages, ttlSec)', () => {
    test('removes messages older than TTL and preserves recent messages', () => {
      const messages: ChatMessage[] = [
        makeMessage('user', 'Hi, I want to book a room', NOW_SEC - 5000),
        makeMessage('assistant', 'Sure! What dates?', NOW_SEC - 4800),
        makeMessage('user', 'Tomorrow', NOW_SEC - 100),
        makeMessage('assistant', 'Great, how many guests?', NOW_SEC - 50),
        makeMessage('user', '2 guests', NOW_SEC),
      ];

      // TTL of 200 seconds should keep only the last 3 messages
      const filtered = filterStaleMessages(messages, 200);

      expect(filtered).toHaveLength(3);
      expect(filtered[0].content).toBe('Tomorrow');
      expect(filtered[1].content).toBe('Great, how many guests?');
      expect(filtered[2].content).toBe('2 guests');
    });

    test('10-message conversation with 5 messages >2h old filters to 5 recent messages', () => {
      // 5 old messages (>2 hours ago relative to newest)
      const oldMessages: ChatMessage[] = [
        makeMessage('user', 'Hello, is wifi available?', NOW_SEC - TWO_HOURS_SEC - 500),
        makeMessage('assistant', 'Yes, wifi password is pelangi123', NOW_SEC - TWO_HOURS_SEC - 400),
        makeMessage('user', 'What time is checkout?', NOW_SEC - TWO_HOURS_SEC - 300),
        makeMessage('assistant', 'Checkout is at 12pm', NOW_SEC - TWO_HOURS_SEC - 200),
        makeMessage('user', 'Thanks', NOW_SEC - TWO_HOURS_SEC - 100),
      ];

      // 5 recent messages (within last hour)
      const recentMessages: ChatMessage[] = [
        makeMessage('user', 'I want to book a room', NOW_SEC - 600),
        makeMessage('assistant', 'Sure! What dates would you like?', NOW_SEC - 500),
        makeMessage('user', 'March 25 to March 27', NOW_SEC - 400),
        makeMessage('assistant', 'For how many guests?', NOW_SEC - 200),
        makeMessage('user', '2 guests please', NOW_SEC),
      ];

      const allMessages = [...oldMessages, ...recentMessages];
      expect(allMessages).toHaveLength(10);

      // Default TTL of 3600 seconds (1 hour)
      const filtered = filterStaleMessages(allMessages, ONE_HOUR_SEC);

      expect(filtered).toHaveLength(5);
      // Verify the remaining messages are exactly the recent ones
      expect(filtered.map(m => m.content)).toEqual(
        recentMessages.map(m => m.content),
      );
    });

    test('latest message timestamp is always preserved', () => {
      const messages: ChatMessage[] = [
        makeMessage('user', 'old message 1', NOW_SEC - 10000),
        makeMessage('user', 'old message 2', NOW_SEC - 9000),
        makeMessage('user', 'newest message', NOW_SEC),
      ];

      // Even with very short TTL, the latest message survives
      const filtered = filterStaleMessages(messages, 1);

      expect(filtered.length).toBeGreaterThanOrEqual(1);
      const latestMsg = filtered[filtered.length - 1];
      expect(latestMsg.content).toBe('newest message');
      expect(latestMsg.timestamp).toBe(NOW_SEC);
    });

    test('returns empty array for empty input', () => {
      const filtered = filterStaleMessages([], 3600);
      expect(filtered).toEqual([]);
    });

    test('preserves all messages when none are stale', () => {
      const messages: ChatMessage[] = [
        makeMessage('user', 'Hello', NOW_SEC - 100),
        makeMessage('assistant', 'Hi there!', NOW_SEC - 50),
        makeMessage('user', 'How are you?', NOW_SEC),
      ];

      const filtered = filterStaleMessages(messages, 3600);
      expect(filtered).toHaveLength(3);
    });

    test('single message is always preserved', () => {
      const messages: ChatMessage[] = [
        makeMessage('user', 'Only message', NOW_SEC),
      ];

      const filtered = filterStaleMessages(messages, 1);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].content).toBe('Only message');
    });
  });

  describe('booking accuracy with TTL-filtered context', () => {
    test('booking intent classification improves when stale wifi/checkout context is removed', () => {
      // Simulate a conversation that started with wifi/checkout questions
      // then shifted to booking — stale context would confuse the classifier
      const staleContextMessages: ChatMessage[] = [
        makeMessage('user', 'What is the wifi password?', NOW_SEC - TWO_HOURS_SEC - 500),
        makeMessage('assistant', 'The wifi password is pelangi2024.', NOW_SEC - TWO_HOURS_SEC - 400),
        makeMessage('user', 'What time is checkout?', NOW_SEC - TWO_HOURS_SEC - 300),
        makeMessage('assistant', 'Checkout is at 12:00 PM noon.', NOW_SEC - TWO_HOURS_SEC - 200),
        makeMessage('user', 'Ok thanks', NOW_SEC - TWO_HOURS_SEC - 100),
      ];

      const bookingMessages: ChatMessage[] = [
        makeMessage('user', 'I want to book a bed for 2 nights', NOW_SEC - 300),
        makeMessage('assistant', 'What dates would you like to check in?', NOW_SEC - 200),
        makeMessage('user', 'March 25 check in', NOW_SEC - 100),
        makeMessage('assistant', 'And how many guests?', NOW_SEC - 50),
        makeMessage('user', '2 guests', NOW_SEC),
      ];

      const allMessages = [...staleContextMessages, ...bookingMessages];

      // Without TTL filter: all 10 messages present (contains wifi/checkout noise)
      const unfilteredBookingKeywords = countBookingKeywords(allMessages);
      const unfilteredNonBookingKeywords = countNonBookingKeywords(allMessages);

      // With TTL filter: only booking-related messages remain
      const filtered = filterStaleMessages(allMessages, ONE_HOUR_SEC);
      const filteredBookingKeywords = countBookingKeywords(filtered);
      const filteredNonBookingKeywords = countNonBookingKeywords(filtered);

      // The filtered context has a better signal-to-noise ratio for booking
      const unfilteredRatio = unfilteredBookingKeywords / (unfilteredBookingKeywords + unfilteredNonBookingKeywords);
      const filteredRatio = filteredBookingKeywords / (filteredBookingKeywords + filteredNonBookingKeywords);

      expect(filteredRatio).toBeGreaterThan(unfilteredRatio);
      // The stale wifi/checkout context should be removed
      expect(filtered.every(m => !m.content.toLowerCase().includes('wifi'))).toBe(true);
      expect(filtered.every(m => !m.content.toLowerCase().includes('checkout'))).toBe(true);
    });
  });
});

// ─── Helpers for booking accuracy test ─────────────────────────────

function countBookingKeywords(messages: ChatMessage[]): number {
  const bookingTerms = ['book', 'booking', 'nights', 'check in', 'guests', 'dates', 'bed'];
  let count = 0;
  for (const msg of messages) {
    const lower = msg.content.toLowerCase();
    for (const term of bookingTerms) {
      if (lower.includes(term)) count++;
    }
  }
  return count;
}

function countNonBookingKeywords(messages: ChatMessage[]): number {
  const nonBookingTerms = ['wifi', 'password', 'checkout', 'thanks', 'ok'];
  let count = 0;
  for (const msg of messages) {
    const lower = msg.content.toLowerCase();
    for (const term of nonBookingTerms) {
      if (lower.includes(term)) count++;
    }
  }
  return count;
}
