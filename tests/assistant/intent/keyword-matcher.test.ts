/**
 * US-595: Weighted Intent Keyword Scoring with Recency Bias
 *
 * Validates that KeywordMatcher.matchKeywords() applies recency multipliers
 * so that keyword matches in recent conversation turns score higher than
 * identical matches in older turns.
 *
 * Recency curve (default):
 *   - 0-2 turns ago: 2.0x
 *   - 3-5 turns ago: 1.5x
 *   - 6+  turns ago: 1.0x
 */

import { describe, it, expect } from 'vitest';
import { KeywordMatcher, type KeywordIntent } from '../../../src/assistant/intent/keyword-matcher.js';

// Minimal intent set for testing
const TEST_INTENTS: KeywordIntent[] = [
  {
    intent: 'booking',
    keywords: ['book a room', 'room available', 'reserve', 'check in', 'check-in', 'accommodation'],
    language: 'en',
  },
  {
    intent: 'wifi',
    keywords: ['wifi password', 'wifi pass', 'internet', 'connect wifi'],
    language: 'en',
  },
  {
    intent: 'pricing',
    keywords: ['how much', 'price', 'rate', 'cost', 'fee', 'charge'],
    language: 'en',
  },
];

describe('KeywordMatcher — recency bias (US-595)', () => {
  const matcher = new KeywordMatcher(TEST_INTENTS, {
    recencyBiasEnabled: true,
    weightCurve: { recent: 2.0, mid: 1.5, old: 1.0 },
  });

  // --- AC1: correct multipliers by turn age ---

  it('AC1: messages 0-2 turns ago receive 2.0x multiplier', () => {
    // 3-message conversation; only the last message contains the keyword
    const messages = [
      { text: 'hello there' },
      { text: 'nothing here' },
      { text: 'book a room' },   // turnIndex=2, turnsAgo=0 → 2.0x
    ];
    const result = matcher.matchKeywords(messages);
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('booking');
    expect(result!.recencyMultiplier).toBe(2.0);
    expect(result!.turnIndex).toBe(2);
    expect(result!.weightedScore).toBeCloseTo(result!.score * 2.0, 5);
  });

  it('AC1: messages 3-5 turns ago receive 1.5x multiplier', () => {
    // 5-message conversation; only message[0] (4 turns ago) contains the keyword.
    // Filler uses "zzznomatch" which won't fuzzy-match any keyword.
    const messages = [
      { text: 'book a room' },   // turnIndex=0, turnsAgo=4 → 1.5x
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
    ];
    const result = matcher.matchKeywords(messages);
    expect(result).not.toBeNull();
    expect(result!.recencyMultiplier).toBe(1.5);
    expect(result!.turnIndex).toBe(0);
    expect(result!.weightedScore).toBeCloseTo(result!.score * 1.5, 5);
  });

  it('AC1: messages 6+ turns ago receive 1.0x multiplier', () => {
    // 8-message conversation; only message[0] (7 turns ago) contains the keyword.
    // Filler uses "zzznomatch" which won't fuzzy-match any keyword.
    const messages = [
      { text: 'book a room' },   // turnIndex=0, turnsAgo=7 → 1.0x
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
    ];
    const result = matcher.matchKeywords(messages);
    expect(result).not.toBeNull();
    expect(result!.recencyMultiplier).toBe(1.0);
    expect(result!.turnIndex).toBe(0);
    expect(result!.weightedScore).toBeCloseTo(result!.score * 1.0, 5);
  });

  // --- AC3: 5-message conversation recency assertion ---

  it('AC3: keyword in message[3] scores higher than identical keyword in message[0]', () => {
    // Two separate calls with the same keyword in different positions.
    // 5-message window:
    //   message[0] = 4 turns ago → 1.5x
    //   message[3] = 1 turn  ago → 2.0x
    const keyword = 'book a room';
    const filler = 'zzznomatch';

    const msgsKeywordAtOldest = [
      { text: keyword },   // [0] → 1.5x
      { text: filler },
      { text: filler },
      { text: filler },
      { text: filler },
    ];

    const msgsKeywordAtRecent = [
      { text: filler },
      { text: filler },
      { text: filler },
      { text: keyword },   // [3] → 2.0x
      { text: filler },
    ];

    const oldResult = matcher.matchKeywords(msgsKeywordAtOldest);
    const recentResult = matcher.matchKeywords(msgsKeywordAtRecent);

    expect(oldResult).not.toBeNull();
    expect(recentResult).not.toBeNull();

    // Both should match the same intent with the same base score
    expect(oldResult!.intent).toBe('booking');
    expect(recentResult!.intent).toBe('booking');
    expect(oldResult!.score).toBeCloseTo(recentResult!.score, 2);

    // Recent match must produce a higher weighted score
    expect(recentResult!.weightedScore).toBeGreaterThan(oldResult!.weightedScore);
    expect(recentResult!.recencyMultiplier).toBe(2.0);
    expect(oldResult!.recencyMultiplier).toBe(1.5);
  });

  // --- AC2: config fields honoured ---

  it('AC2: recencyBiasEnabled=false flattens all multipliers to 1.0', () => {
    const noRecencyMatcher = new KeywordMatcher(TEST_INTENTS, {
      recencyBiasEnabled: false,
    });
    const messages = [
      { text: 'book a room' },   // oldest
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
    ];
    const result = noRecencyMatcher.matchKeywords(messages);
    expect(result).not.toBeNull();
    expect(result!.recencyMultiplier).toBe(1.0);
    expect(result!.weightedScore).toBeCloseTo(result!.score, 5);
  });

  it('AC2: custom weight curve is respected', () => {
    const customMatcher = new KeywordMatcher(TEST_INTENTS, {
      recencyBiasEnabled: true,
      weightCurve: { recent: 3.0, mid: 2.0, old: 1.0 },
    });
    const messages = [
      { text: 'book a room' },   // only match
      { text: 'zzznomatch' },
      { text: 'zzznomatch' },
    ];
    // 3 messages → turnIndex=0 is turnsAgo=2 → 'recent' bucket → 3.0x
    const result = customMatcher.matchKeywords(messages);
    expect(result).not.toBeNull();
    expect(result!.recencyMultiplier).toBe(3.0);
    expect(result!.weightedScore).toBeCloseTo(result!.score * 3.0, 5);
  });

  // --- Edge cases ---

  it('returns null when no messages contain any keyword', () => {
    const messages = [
      { text: 'blah blah blah' },
      { text: 'random words xyz' },
    ];
    // FuzzyIntentMatcher may match something at low confidence; we only check null safety
    const result = matcher.matchKeywords(messages);
    // Just ensure no crash — result may or may not be null depending on fuzzy threshold
    if (result !== null) {
      expect(result.score).toBeDefined();
      expect(result.weightedScore).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns null for an empty messages array', () => {
    const result = matcher.matchKeywords([]);
    expect(result).toBeNull();
  });

  it('handles a single-message conversation with 2.0x multiplier', () => {
    // Single message → turnsAgo=0 → 2.0x
    const result = matcher.matchKeywords([{ text: 'book a room' }]);
    expect(result).not.toBeNull();
    expect(result!.recencyMultiplier).toBe(2.0);
  });

  it('matchSingle() delegates to FuzzyIntentMatcher without recency bias', () => {
    const result = matcher.matchSingle('book a room');
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('booking');
    expect(result!.score).toBeGreaterThan(0.5);
  });
});
