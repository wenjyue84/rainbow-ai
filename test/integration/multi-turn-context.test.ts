/**
 * Integration test: Conversation Context Relevance Reranker (US-308)
 *
 * Demonstrates that a 10-message multi-turn booking conversation is filtered
 * down to 5 high-relevance messages before the booking confirmation step.
 */

import { describe, it, expect } from 'vitest';
import { scoreMessageRelevance, filterContextByRelevance } from '../../src/assistant/pipeline/context.js';
import type { ChatMessage } from '../../src/assistant/types.js';

// Current time in Unix seconds (matching ChatMessage.timestamp contract)
const nowSec = Math.floor(Date.now() / 1000);

/**
 * Build a ChatMessage with a relative timestamp in seconds.
 */
function msg(role: 'user' | 'assistant', content: string, secondsAgo: number): ChatMessage {
  return { role, content, timestamp: nowSec - secondsAgo };
}

describe('US-308: Multi-turn context relevance reranker', () => {
  // ── 10-message booking dialog ──────────────────────────────────────
  //
  // Messages [0-4] are old (300-600s ago) and mostly off-topic or generic.
  // Messages [5-9] are recent (10-240s ago) and contain booking keywords.
  //
  // Expected: filterContextByRelevance keeps the 5 high-relevance messages.

  const history: ChatMessage[] = [
    msg('user', 'Hello there!', 600),                                        // 0: old greeting
    msg('assistant', 'Hi! Welcome to Pelangi Capsule. How can I help?', 570), // 1: old greeting
    msg('user', 'ok thanks', 540),                                            // 2: old generic
    msg('assistant', 'Sure, let me know if you need anything.', 510),         // 3: old generic
    msg('user', 'Actually, yes', 480),                                        // 4: old vague
    msg('user', 'I want to book a room for 2 nights', 240),                   // 5: booking keyword
    msg('assistant', 'Great! What dates would you like to stay?', 210),       // 6: booking keyword
    msg('user', 'Check in on 25 March, check out on 27 March', 150),          // 7: booking dates
    msg('assistant', 'How many guests will be staying?', 90),                 // 8: booking context
    msg('user', 'Just 2 guests. Please confirm the booking.', 10),            // 9: booking + recent
  ];

  const profile = 'data-pelangi';
  const intent = 'booking';

  it('scores recent booking messages higher than old generic ones', () => {
    const oldGeneric = scoreMessageRelevance(history[2], intent, profile);   // "ok thanks", 540s ago
    const recentBooking = scoreMessageRelevance(history[9], intent, profile); // "confirm the booking", 10s ago

    expect(recentBooking).toBeGreaterThan(oldGeneric);
  });

  it('assigns positive score to messages with booking keywords', () => {
    const score = scoreMessageRelevance(history[5], intent, profile); // "book a room for 2 nights"
    expect(score).toBeGreaterThan(0.1);
  });

  it('assigns low score to old generic messages', () => {
    const score = scoreMessageRelevance(history[2], intent, profile); // "ok thanks", 540s ago
    expect(score).toBeLessThan(0.2);
  });

  it('returns 0 for an empty message', () => {
    const emptyMsg: ChatMessage = { role: 'user', content: '', timestamp: nowSec };
    expect(scoreMessageRelevance(emptyMsg, intent, profile)).toBe(0);
  });

  it('filters 10-message conversation to 5 high-relevance messages for booking confirmation', () => {
    const filtered = filterContextByRelevance(history, intent, profile, 5);

    // Should return exactly 5 messages
    expect(filtered).toHaveLength(5);

    // Must include the most recent message (index 9)
    expect(filtered).toContainEqual(history[9]);

    // All returned messages should be in original chronological order
    const indices = filtered.map(m => history.indexOf(m));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('keeps the high-scoring booking messages (indices 5-9) in filtered output', () => {
    const filtered = filterContextByRelevance(history, intent, profile, 5);

    // The 5 most recent booking-related messages should dominate
    const recentBookingMsgs = history.slice(5); // indices 5-9
    const overlapCount = filtered.filter(m => recentBookingMsgs.includes(m)).length;

    // Expect most of the 5 filtered messages to be from the booking portion
    expect(overlapCount).toBeGreaterThanOrEqual(4);
  });

  it('returns all messages unchanged when count is already <= topN', () => {
    const short = history.slice(7); // 3 messages
    const filtered = filterContextByRelevance(short, intent, profile, 5);
    expect(filtered).toEqual(short);
  });

  it('scores are clamped to [0, 1]', () => {
    for (const message of history) {
      const score = scoreMessageRelevance(message, intent, profile);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
