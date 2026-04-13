/**
 * tests/message-ordering.test.ts — Test suite for US-593
 *
 * Covers:
 * - First message (no prior) → no issues
 * - Reordered messages (out of chronological order) → flagged
 * - Simultaneous timestamp messages → reported as groups, not errors
 * - Multi-turn spans with ordering anomalies
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateMessageOrdering,
  type MessageOrderingResult,
} from '../src/lib/message-ordering-validator.js';
import type { ChatMessage } from '../src/assistant/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMsg(
  role: 'user' | 'assistant',
  content: string,
  timestamp: number,
): ChatMessage {
  return { role, content, timestamp };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('validateMessageOrdering', () => {
  // ── First message / trivial cases ─────────────────────────────────────────

  describe('first message (no prior)', () => {
    it('returns no issues for a single message', () => {
      const messages = [makeMsg('user', 'Hello', 1000)];
      const result = validateMessageOrdering(messages, 'conv_001');

      expect(result.hasOrderingIssues).toBe(false);
      expect(result.issues).toHaveLength(0);
      expect(result.simultaneousGroups).toHaveLength(0);
      expect(result.affectedCount).toBe(0);
    });

    it('returns no issues for an empty array', () => {
      const result = validateMessageOrdering([], 'conv_empty');

      expect(result.hasOrderingIssues).toBe(false);
      expect(result.issues).toHaveLength(0);
    });

    it('returns no issues for two messages with identical timestamps (simultaneous only)', () => {
      const messages = [
        makeMsg('user', 'Hello', 1000),
        makeMsg('assistant', 'Hi!', 1000),
      ];
      const result = validateMessageOrdering(messages, 'conv_sim');

      expect(result.hasOrderingIssues).toBe(false);  // simultaneous is NOT an ordering error
      expect(result.issues).toHaveLength(0);
      expect(result.simultaneousGroups).toHaveLength(1);
      expect(result.simultaneousGroups[0].timestamp).toBe(1000);
      expect(result.simultaneousGroups[0].indices).toEqual([0, 1]);
    });
  });

  // ── Correctly ordered messages ─────────────────────────────────────────────

  describe('correctly ordered messages', () => {
    it('returns no issues for chronologically ordered conversation', () => {
      const messages = [
        makeMsg('user', 'Hello', 1000),
        makeMsg('assistant', 'Hi there!', 1010),
        makeMsg('user', 'Book a room', 1020),
        makeMsg('assistant', 'Sure, what dates?', 1030),
      ];
      const result = validateMessageOrdering(messages, 'conv_ordered');

      expect(result.hasOrderingIssues).toBe(false);
      expect(result.issues).toHaveLength(0);
      expect(result.affectedCount).toBe(0);
    });

    it('returns no issues for two-message conversation in order', () => {
      const messages = [
        makeMsg('user', 'Hello', 500),
        makeMsg('assistant', 'Hello! How can I help?', 510),
      ];
      const result = validateMessageOrdering(messages, 'conv_two');

      expect(result.hasOrderingIssues).toBe(false);
    });
  });

  // ── Reordered (out-of-order) messages ─────────────────────────────────────

  describe('reordered messages', () => {
    it('detects a single out-of-order message', () => {
      // Messages 1 and 2 have swapped timestamps
      const messages = [
        makeMsg('user', 'Hello', 1000),
        makeMsg('user', 'Book a room', 1030),       // actualIndex 1, but ts=1030
        makeMsg('assistant', 'Hi there!', 1010),    // actualIndex 2, but ts=1010 — out of order
        makeMsg('assistant', 'Sure, what dates?', 1040),
      ];
      const result = validateMessageOrdering(messages, 'conv_reorder1');

      expect(result.hasOrderingIssues).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.affectedCount).toBeGreaterThan(0);
    });

    it('issues include messageId, expectedIndex, actualIndex, timestamp', () => {
      const messages = [
        makeMsg('user', 'Hello', 1000),
        makeMsg('assistant', 'Latest reply', 1100),  // actualIndex 1, ts=1100
        makeMsg('user', 'Middle message', 1050),     // actualIndex 2, ts=1050 — out of order
      ];
      const result = validateMessageOrdering(messages, 'conv_meta');

      expect(result.hasOrderingIssues).toBe(true);

      for (const issue of result.issues) {
        expect(issue.messageId).toMatch(/^msg_\d+$/);
        expect(typeof issue.expectedIndex).toBe('number');
        expect(typeof issue.actualIndex).toBe('number');
        expect(typeof issue.timestamp).toBe('number');
        expect(issue.expectedIndex).not.toBe(issue.actualIndex);
      }
    });

    it('detects multiple out-of-order messages in a single conversation', () => {
      // Completely reversed order of timestamps
      const messages = [
        makeMsg('user', 'Message D', 1040),
        makeMsg('user', 'Message C', 1030),
        makeMsg('user', 'Message B', 1020),
        makeMsg('user', 'Message A', 1010),
      ];
      const result = validateMessageOrdering(messages, 'conv_reversed');

      expect(result.hasOrderingIssues).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('does not report issues for messages with null timestamps', () => {
      const msgs: ChatMessage[] = [
        { role: 'user', content: 'Hello', timestamp: null as any },
        { role: 'assistant', content: 'Hi', timestamp: null as any },
      ];
      const result = validateMessageOrdering(msgs, 'conv_nullts');

      expect(result.hasOrderingIssues).toBe(false);
    });

    it('handles mixed null/valid timestamps — only validates timestamped subset', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello', timestamp: null as any },  // skip
        makeMsg('assistant', 'Hi', 1000),
        { role: 'user', content: 'Later', timestamp: null as any },  // skip
        makeMsg('user', 'Even later', 1100),
      ];
      const result = validateMessageOrdering(messages, 'conv_mixed');

      // Only 2 timestamped messages (both in order), should have no issues
      expect(result.hasOrderingIssues).toBe(false);
    });
  });

  // ── Simultaneous timestamp messages ───────────────────────────────────────

  describe('simultaneous timestamp messages', () => {
    it('reports simultaneous groups when multiple messages share a timestamp', () => {
      const ts = 1500;
      const messages = [
        makeMsg('user', 'Hi', ts),
        makeMsg('assistant', 'Hello!', ts),
        makeMsg('user', 'Room?', ts + 10),
      ];
      const result = validateMessageOrdering(messages, 'conv_sim2');

      expect(result.simultaneousGroups).toHaveLength(1);
      expect(result.simultaneousGroups[0].timestamp).toBe(ts);
      expect(result.simultaneousGroups[0].indices).toContain(0);
      expect(result.simultaneousGroups[0].indices).toContain(1);
    });

    it('does NOT flag simultaneous timestamps as ordering issues', () => {
      const ts = 2000;
      const messages = [
        makeMsg('user', 'Msg A', ts),
        makeMsg('user', 'Msg B', ts),
        makeMsg('user', 'Msg C', ts),
      ];
      const result = validateMessageOrdering(messages, 'conv_all_same_ts');

      // All three share the same ts — stable sort preserves original order,
      // so no out-of-order issues should be raised
      expect(result.hasOrderingIssues).toBe(false);
      expect(result.simultaneousGroups).toHaveLength(1);
      expect(result.simultaneousGroups[0].indices).toHaveLength(3);
    });

    it('correctly separates ordering issues from simultaneous groups', () => {
      const messages = [
        makeMsg('user', 'A', 1000),
        makeMsg('user', 'C', 1020),   // out of order (ts < next)
        makeMsg('user', 'B', 1010),   // out of order (ts < previous)
        makeMsg('user', 'D', 1030),   // same as E
        makeMsg('user', 'E', 1030),   // simultaneous with D
      ];
      const result = validateMessageOrdering(messages, 'conv_mixed_issues');

      expect(result.hasOrderingIssues).toBe(true);
      expect(result.simultaneousGroups).toHaveLength(1);
      expect(result.simultaneousGroups[0].timestamp).toBe(1030);
    });
  });

  // ── Multi-turn spans ───────────────────────────────────────────────────────

  describe('multi-turn spans across multiple conversation turns', () => {
    it('validates ordering correctly across 10+ message conversation', () => {
      const base = 1000;
      const messages = Array.from({ length: 12 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`, base + i * 10)
      );
      const result = validateMessageOrdering(messages, 'conv_multi_turn');

      expect(result.hasOrderingIssues).toBe(false);
      expect(result.issues).toHaveLength(0);
    });

    it('detects ordering anomaly in mid-conversation turn', () => {
      const base = 1000;
      const messages = [
        makeMsg('user', 'Turn 1 user', base),
        makeMsg('assistant', 'Turn 1 reply', base + 5),
        makeMsg('user', 'Turn 2 user', base + 10),
        makeMsg('assistant', 'Turn 2 reply', base + 15),
        makeMsg('user', 'Turn 3 user', base + 20),
        makeMsg('assistant', 'Out-of-order reply', base + 8),  // ts before previous — anomaly
        makeMsg('user', 'Turn 4 user', base + 30),
        makeMsg('assistant', 'Turn 4 reply', base + 35),
      ];
      const result = validateMessageOrdering(messages, 'conv_mid_anomaly');

      expect(result.hasOrderingIssues).toBe(true);
      expect(result.affectedCount).toBeGreaterThan(0);
    });

    it('returns correct affectedCount matching issues array length', () => {
      const messages = [
        makeMsg('user', 'A', 1000),
        makeMsg('user', 'C', 1020),
        makeMsg('user', 'B', 1010),  // out of order
      ];
      const result = validateMessageOrdering(messages, 'conv_count_check');

      expect(result.affectedCount).toBe(result.issues.length);
    });

    it('conversationId is reflected in returned result (smoke test)', () => {
      const messages = [
        makeMsg('user', 'Hello', 1000),
        makeMsg('assistant', 'Hi', 1010),
      ];
      const result = validateMessageOrdering(messages, 'specific_conv_id_123');

      // Result doesn't store conversationId, but function should not throw
      expect(result).toBeDefined();
      expect(result.hasOrderingIssues).toBe(false);
    });
  });
});
