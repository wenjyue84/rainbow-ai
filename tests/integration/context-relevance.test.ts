/**
 * Integration tests for Conversation Context Relevance Scoring (US-553)
 *
 * Tests:
 * 1. retrieveRelevantContext() filters low-relevance messages below 0.4 threshold
 * 2. Payment details from 8+ turns ago are excluded when intent switches to check_in
 * 3. Recent messages from ANY intent are always included (recency wins)
 * 4. scoreMessageRelevance() returns correct weighted scores
 * 5. Empty and single-message edge cases are handled
 */

import { describe, it, expect } from 'vitest';
import { scoreMessageRelevance } from '../../src/lib/relevance-scorer.js';
import { retrieveRelevantContext } from '../../src/assistant/pipeline/context-retrieval.js';
import type { ChatMessage } from '../../src/assistant/types.js';

// Fixed "now" for deterministic recency scoring
const NOW = 1_700_000_000_000; // arbitrary fixed ms timestamp

// Helpers
const minutesAgo = (n: number) => NOW - n * 60 * 1000;
const makeMsg = (
  role: 'user' | 'assistant',
  content: string,
  ageMinutes: number
): ChatMessage => ({ role, content, timestamp: minutesAgo(ageMinutes) });

// ─── Booking workflow messages (older turn) ───────────────────────────────────
const paymentMsg: ChatMessage = makeMsg(
  'assistant',
  'Your payment of RM150 for the booking has been confirmed. Booking reference: PEL-2024-001',
  120 // 2 hours ago — well beyond 30-min recency window
);
const depositMsg: ChatMessage = makeMsg(
  'user',
  'I have transferred the deposit for my room reservation. Please confirm receipt.',
  110
);
const bookingConfirmMsg: ChatMessage = makeMsg(
  'assistant',
  'We have received your payment. Your reservation is confirmed.',
  100
);

// ─── Check-in intent messages (recent turn) ───────────────────────────────────
const checkInMsg: ChatMessage = makeMsg(
  'user',
  'I am at the lobby, ready to check in. What do I need to bring?',
  5
);
const checkInReplyMsg: ChatMessage = makeMsg(
  'assistant',
  'Welcome! Please bring your IC or passport for check-in.',
  3
);

// Full 8+ turn conversation: booking turns first, then check-in
const fullConversation: ChatMessage[] = [
  paymentMsg,
  depositMsg,
  bookingConfirmMsg,
  makeMsg('user', 'Can you tell me the wifi password?', 90),
  makeMsg('assistant', 'The wifi password is PelangiGuest2024.', 88),
  makeMsg('user', 'Thank you. What time is check-in?', 60),
  makeMsg('assistant', 'Check-in is from 2 PM onwards.', 58),
  makeMsg('user', 'Got it. See you then.', 50),
  checkInMsg,
  checkInReplyMsg,
];

describe('scoreMessageRelevance (US-553)', () => {
  it('scores a recent message with matching keyword close to 1', () => {
    // 'check_in_arrival' is the actual intent name in intent-keywords.json
    const msg = makeMsg('user', 'I want to check in now', 2);
    const msgs = [msg];
    const score = scoreMessageRelevance(msg, 'check_in_arrival', msgs, NOW);
    // keyword match (0.4) + high recency ≈0.28 + turn distance 1.0 (0.3) ≈ 0.98
    expect(score).toBeGreaterThan(0.7);
  });

  it('scores an old message with no keyword match low', () => {
    const old = makeMsg('assistant', 'Your booking deposit has been received.', 120);
    const msgs = [old, makeMsg('user', 'check in please', 2)];
    // intent = check_in_arrival, old deposit message has no check-in keywords
    const score = scoreMessageRelevance(old, 'check_in_arrival', msgs, NOW);
    // recency ≈ 0 (120min > 30min window), turn distance low (idx 0 of 2 = 0.5)
    expect(score).toBeLessThan(0.4);
  });

  it('scores an old message with matching keyword higher than without', () => {
    // Both messages are single-element arrays (equal turn distance = 1.0).
    // The only variable is keyword overlap, so the keyword match must add value.
    const withKw = makeMsg('user', 'I want to check in to my room', 90);
    const withoutKw = makeMsg('user', 'The wifi password is 12345.', 90);

    const scoreWith = scoreMessageRelevance(withKw, 'check_in_arrival', [withKw], NOW);
    const scoreWithout = scoreMessageRelevance(withoutKw, 'check_in_arrival', [withoutKw], NOW);

    // withKw: kwScore=1, recency=0, turnDist=1.0 → 0.4+0+0.3=0.70
    // withoutKw: kwScore=0, recency=0, turnDist=1.0 → 0+0+0.3=0.30
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it('handles empty intent gracefully (returns only recency + turn score)', () => {
    const msg = makeMsg('user', 'hello', 5);
    const score = scoreMessageRelevance(msg, 'nonexistent_intent_xyz', [msg], NOW);
    // keyword = 0, recency high, turn = 1.0 → 0 + ≈0.28 + 0.3 ≈ 0.58
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns value in [0, 1] for any input', () => {
    const msgs = [makeMsg('user', 'random message', 500)];
    const score = scoreMessageRelevance(msgs[0], 'booking', msgs, NOW);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('retrieveRelevantContext — booking→check_in intent switch (US-553)', () => {
  it('excludes old payment/booking messages when intent is check_in', () => {
    const result = retrieveRelevantContext(fullConversation, 'check_in', NOW);

    // Payment messages from 100–120 min ago should be filtered out
    expect(result.messages).not.toContainEqual(paymentMsg);
    expect(result.messages).not.toContainEqual(depositMsg);
    expect(result.messages).not.toContainEqual(bookingConfirmMsg);
  });

  it('includes recent check-in messages', () => {
    const result = retrieveRelevantContext(fullConversation, 'check_in', NOW);
    expect(result.messages).toContainEqual(checkInMsg);
    expect(result.messages).toContainEqual(checkInReplyMsg);
  });

  it('reports accurate filteredCount', () => {
    const result = retrieveRelevantContext(fullConversation, 'check_in', NOW);
    expect(result.originalCount).toBe(fullConversation.length);
    expect(result.filteredCount).toBeGreaterThan(0);
    expect(result.filteredCount).toBeLessThan(fullConversation.length);
    expect(result.filteredCount).toBe(result.originalCount - result.messages.length);
  });

  it('preserves message order in filtered output', () => {
    const result = retrieveRelevantContext(fullConversation, 'check_in', NOW);
    // Verify timestamps are non-decreasing (oldest first preserved)
    for (let i = 1; i < result.messages.length; i++) {
      expect(result.messages[i].timestamp).toBeGreaterThanOrEqual(
        result.messages[i - 1].timestamp
      );
    }
  });
});

describe('retrieveRelevantContext — edge cases (US-553)', () => {
  it('returns empty result for empty message list', () => {
    const result = retrieveRelevantContext([], 'booking', NOW);
    expect(result.messages).toHaveLength(0);
    expect(result.originalCount).toBe(0);
    expect(result.filteredCount).toBe(0);
  });

  it('keeps a very recent message even if no keyword match', () => {
    // A message 1 minute ago should clear the 0.4 threshold via recency + turn score alone
    const recentMsg = makeMsg('user', 'something unrelated', 1);
    const result = retrieveRelevantContext([recentMsg], 'booking', NOW);
    expect(result.messages).toContainEqual(recentMsg);
    expect(result.filteredCount).toBe(0);
  });

  it('filters a very old unrelated single message', () => {
    const oldMsg = makeMsg('user', 'something completely unrelated', 200);
    const result = retrieveRelevantContext([oldMsg], 'check_in', NOW);
    // 200min >> 30min window, no check_in keywords, only turn score = 0.3 → below 0.4
    expect(result.messages).toHaveLength(0);
    expect(result.filteredCount).toBe(1);
  });

  it('passes all messages when all are recent and intent matches', () => {
    const msgs = [
      makeMsg('user', 'I want to check in', 1),
      makeMsg('assistant', 'Sure, please proceed to check in at the counter.', 0.5),
    ];
    const result = retrieveRelevantContext(msgs, 'check_in', NOW);
    expect(result.messages).toHaveLength(2);
    expect(result.filteredCount).toBe(0);
  });
});
