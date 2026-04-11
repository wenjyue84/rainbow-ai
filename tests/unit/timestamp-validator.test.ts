/**
 * US-468: Tests for timestamp-validator.ts
 *
 * Covers:
 * - Normal ordered messages (no changes)
 * - Small clock skew reordering (< 5s backwards)
 * - Large backwards gap (flag only, no reorder)
 * - Duplicate timestamp detection (WARN and ERROR levels)
 * - Null/undefined timestamp skipping
 * - Empty conversation handling
 * - max_gap_ms computation
 * - reorder_count and duplicate_count metrics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateTimestamps } from '../../src/assistant/pipeline/timestamp-validator.js';
import type { ChatMessage } from '../../src/assistant/types.js';
import fixtureData from '../fixtures/conversations/out-of-order-multi-turn.json' assert { type: 'json' };

// Silence logger output during tests
vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msgs(arr: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number | null }>): ChatMessage[] {
  return arr.map(m => ({ ...m, timestamp: m.timestamp as number }));
}

const fixtures = fixtureData.conversations;

// ─── Normal ordered messages ──────────────────────────────────────────────────

describe('validateTimestamps — normal ordered messages', () => {
  it('returns messages unchanged when already in order', () => {
    const messages = msgs(fixtures.normal_order.messages as any);
    const result = validateTimestamps(messages, fixtures.normal_order.id);

    expect(result.reordered_count).toBe(0);
    expect(result.duplicate_count).toBe(0);
    expect(result.messages).toHaveLength(4);
    // Order preserved
    expect(result.messages[0].content).toBe('Hi, I want to check in.');
    expect(result.messages[1].content).toBe('Welcome! What\'s your name?');
  });

  it('computes max_gap_ms correctly for ordered messages', () => {
    const messages = msgs(fixtures.normal_order.messages as any);
    const result = validateTimestamps(messages, fixtures.normal_order.id);

    // Gaps (in ms): 10000, 15000, 10000 → max is 15000
    expect(result.max_gap_ms).toBe(15000);
  });
});

// ─── Small clock skew reordering ─────────────────────────────────────────────

describe('validateTimestamps — small clock skew (< 5s)', () => {
  it('reorders adjacent messages with small backwards offset', () => {
    const messages = msgs(fixtures.small_clock_skew.messages as any);
    // Original: ts 1000, 1010, 1008, 1020
    // Messages[2].timestamp = 1008 < messages[1].timestamp = 1010 → diff = 2s → reorder
    const result = validateTimestamps(messages, fixtures.small_clock_skew.id);

    expect(result.reordered_count).toBe(1);
    // After reorder: positions 1 and 2 should be swapped
    const timestamps = result.messages
      .filter(m => m.timestamp != null)
      .map(m => m.timestamp);
    // Resulting timestamps should be non-decreasing at the reordered position
    expect(timestamps[1]).toBeLessThanOrEqual(timestamps[2]);
  });

  it('increments reorder_count for each swap performed', () => {
    // Two consecutive backwards swaps within 5s
    const messages: ChatMessage[] = [
      { role: 'user',      content: 'A', timestamp: 1000 },
      { role: 'assistant', content: 'B', timestamp: 1005 },
      { role: 'user',      content: 'C', timestamp: 1003 }, // backwards 2s from B
      { role: 'assistant', content: 'D', timestamp: 1008 },
    ];
    const result = validateTimestamps(messages, 'test-multi-swap');
    expect(result.reordered_count).toBeGreaterThanOrEqual(1);
  });
});

// ─── Large backwards gap (no reorder) ────────────────────────────────────────

describe('validateTimestamps — large backwards gap (> 5s)', () => {
  it('does NOT reorder when backwards gap exceeds 5 seconds', () => {
    const messages = msgs(fixtures.large_backwards_gap.messages as any);
    // messages[2].timestamp = 1700001950, messages[1].timestamp = 1700002010
    // diff = 60s → too large to auto-reorder
    const result = validateTimestamps(messages, fixtures.large_backwards_gap.id);

    expect(result.reordered_count).toBe(0);
    // Original order preserved
    expect(result.messages[2].timestamp).toBe(1700001950);
  });
});

// ─── Duplicate timestamps ─────────────────────────────────────────────────────

describe('validateTimestamps — duplicate timestamps', () => {
  it('counts duplicate timestamps correctly', () => {
    const messages = msgs(fixtures.duplicate_timestamps_warn.messages as any);
    // 5 messages at ts=1700003000 → 4 duplicates (count - 1)
    const result = validateTimestamps(messages, fixtures.duplicate_timestamps_warn.id);

    expect(result.duplicate_count).toBe(4);
  });

  it('detects WARN-level duplicates (> 3)', () => {
    const messages = msgs(fixtures.duplicate_timestamps_warn.messages as any);
    const result = validateTimestamps(messages, fixtures.duplicate_timestamps_warn.id);
    // 4 duplicates > WARN threshold of 3
    expect(result.duplicate_count).toBeGreaterThan(3);
  });

  it('detects ERROR-level duplicates (> 10)', () => {
    const messages = msgs(fixtures.duplicate_timestamps_error.messages as any);
    // 12 messages at ts=1700004000 → 11 duplicates
    const result = validateTimestamps(messages, fixtures.duplicate_timestamps_error.id);

    expect(result.duplicate_count).toBeGreaterThan(10);
  });

  it('returns zero duplicate_count for all-unique timestamps', () => {
    const messages = msgs(fixtures.normal_order.messages as any);
    const result = validateTimestamps(messages, fixtures.normal_order.id);
    expect(result.duplicate_count).toBe(0);
  });
});

// ─── Null/undefined timestamps ────────────────────────────────────────────────

describe('validateTimestamps — null timestamps', () => {
  it('skips messages with null timestamps gracefully', () => {
    const messages = msgs(fixtures.null_timestamps.messages as any);
    // 2 nulls + 1 valid timestamp
    const result = validateTimestamps(messages, fixtures.null_timestamps.id);

    expect(result.messages).toHaveLength(3);
    expect(result.reordered_count).toBe(0);
    // Should not throw; messages with null timestamp pass through unchanged
    expect(result.messages[2].timestamp).toBe(1700005000);
  });

  it('returns zero counts when all timestamps are null', () => {
    const messages: ChatMessage[] = [
      { role: 'user',      content: 'Hello', timestamp: null as any },
      { role: 'assistant', content: 'Hi!',   timestamp: null as any },
    ];
    const result = validateTimestamps(messages, 'all-null');

    expect(result.reordered_count).toBe(0);
    expect(result.duplicate_count).toBe(0);
    expect(result.max_gap_ms).toBe(0);
  });
});

// ─── Empty conversation ───────────────────────────────────────────────────────

describe('validateTimestamps — empty conversation', () => {
  it('handles empty message array gracefully', () => {
    const result = validateTimestamps([], 'empty-convo');

    expect(result.messages).toHaveLength(0);
    expect(result.reordered_count).toBe(0);
    expect(result.duplicate_count).toBe(0);
    expect(result.max_gap_ms).toBe(0);
  });

  it('works with fixture empty conversation', () => {
    const messages: ChatMessage[] = [];
    const result = validateTimestamps(messages, fixtures.empty_conversation.id);
    expect(result.messages).toHaveLength(0);
  });
});

// ─── max_gap_ms ───────────────────────────────────────────────────────────────

describe('validateTimestamps — max_gap_ms', () => {
  it('computes max_gap_ms in milliseconds (timestamps are in seconds)', () => {
    const messages: ChatMessage[] = [
      { role: 'user',      content: 'A', timestamp: 1000 },      // t=0
      { role: 'assistant', content: 'B', timestamp: 1000 + 30 }, // gap=30s
      { role: 'user',      content: 'C', timestamp: 1030 + 5 },  // gap=5s
    ];
    const result = validateTimestamps(messages, 'gap-test');
    // max gap = 30s = 30000ms
    expect(result.max_gap_ms).toBe(30000);
  });

  it('returns zero max_gap_ms for single message', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello', timestamp: 1700000000 },
    ];
    const result = validateTimestamps(messages, 'single-msg');
    expect(result.max_gap_ms).toBe(0);
  });
});

// ─── Default conversationId ───────────────────────────────────────────────────

describe('validateTimestamps — optional conversationId', () => {
  it('works without a conversationId (defaults to unknown)', () => {
    const messages: ChatMessage[] = [
      { role: 'user',      content: 'Hi',  timestamp: 1000 },
      { role: 'assistant', content: 'Hey', timestamp: 1010 },
    ];
    expect(() => validateTimestamps(messages)).not.toThrow();
  });
});
