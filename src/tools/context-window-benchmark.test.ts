/**
 * context-window-benchmark.test.ts
 *
 * Unit tests for context-window-benchmark.ts
 * Tests the core logic for benchmarking intent classification accuracy
 * with varying conversation context window sizes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

// ─── Mock Fixture Data ────────────────────────────────────────────────

const mockValidationConversation = {
  profileId: 'pelangi',
  conversationId: 'test-001',
  turns: [
    { role: 'user' as const, content: 'Hi, can you help me?', expectedIntent: 'greeting' },
    { role: 'assistant' as const, content: 'Of course! How can I help?' },
    { role: 'user' as const, content: 'Do you have rooms available?', expectedIntent: 'availability' },
    { role: 'assistant' as const, content: 'Yes, we have availability. When would you like to check in?' },
    { role: 'user' as const, content: 'Tomorrow afternoon', expectedIntent: 'booking' }
  ],
  expectedCategory: 'booking',
  label: 'availability_to_booking_flow',
  difficulty: 'medium'
};

const mockJSONLContent = `${JSON.stringify(mockValidationConversation)}
${JSON.stringify({ ...mockValidationConversation, profileId: 'southern', conversationId: 'test-002' })}
`;

// ─── Helper Functions ────────────────────────────────────────────────

/**
 * Build conversation context (extracted from benchmark.ts for testing)
 */
function buildContextHistory(
  turns: Array<{ role: string; content: string; expectedIntent?: string }>,
  upToIndex: number,
  contextWindowSize: number
): Array<{ role: string; content: string; timestamp: number }> {
  const history: Array<{ role: string; content: string; timestamp: number }> = [];
  let turnCount = 0;

  for (let i = 0; i < upToIndex; i++) {
    if (turns[i] && turns[i].role === 'user') {
      if (turnCount < contextWindowSize) {
        history.push({
          role: 'user',
          content: turns[i].content,
          timestamp: Date.now() - (upToIndex - i) * 1000
        });

        if (i + 1 < upToIndex && turns[i + 1] && turns[i + 1].role === 'assistant') {
          history.push({
            role: 'assistant',
            content: turns[i + 1].content,
            timestamp: Date.now() - (upToIndex - i - 1) * 1000
          });
          i++;
        }

        turnCount++;
      }
    }
  }

  return history;
}

/**
 * Intent matching logic (extracted from benchmark.ts)
 */
function intentMatches(classified: string, expected: string): boolean {
  if (classified === expected) return true;
  if (classified.includes(expected) || expected.includes(classified)) return true;

  const families = [
    ['booking', 'availability', 'pricing'],
    ['check_in_arrival', 'checkin_info', 'checkin'],
    ['checkout_procedure', 'checkout_info', 'checkout', 'late_checkout_request'],
    ['complaint', 'facility_malfunction', 'noise_complaint', 'cleanliness_complaint'],
    ['rules_policy', 'rules'],
    ['payment_info', 'payment_made', 'billing_inquiry', 'payment']
  ];

  for (const family of families) {
    if (family.includes(classified) && family.includes(expected)) {
      return true;
    }
  }

  return false;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Context Window Benchmark', () => {
  describe('buildContextHistory', () => {
    it('should return empty list when windowSize is 0', () => {
      const result = buildContextHistory(mockValidationConversation.turns, 5, 0);
      expect(result).toEqual([]);
    });

    it('should return fewer messages when upToIndex is smaller', () => {
      const result3 = buildContextHistory(mockValidationConversation.turns, 3, 10);
      const result5 = buildContextHistory(mockValidationConversation.turns, 5, 10);

      expect(result3.length).toBeLessThan(result5.length);
    });

    it('should limit context to windowSize', () => {
      const result = buildContextHistory(mockValidationConversation.turns, 5, 2);
      // Max 2 user messages (4 total including assistant responses) but we stop at upToIndex=5
      const userMessages = result.filter(m => m.role === 'user');
      expect(userMessages.length).toBeLessThanOrEqual(2);
    });

    it('should include both user and assistant messages in history', () => {
      const result = buildContextHistory(mockValidationConversation.turns, 4, 10);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(m => m.role === 'user')).toBe(true);
      expect(result.some(m => m.role === 'assistant')).toBe(true);
    });

    it('should preserve message order (chronological)', () => {
      const result = buildContextHistory(mockValidationConversation.turns, 5, 10);

      for (let i = 1; i < result.length; i++) {
        expect(result[i].timestamp).toBeLessThanOrEqual(result[i - 1].timestamp);
      }
    });
  });

  describe('intentMatches', () => {
    it('should match exact intent names', () => {
      expect(intentMatches('booking', 'booking')).toBe(true);
    });

    it('should match intents with substring overlap', () => {
      expect(intentMatches('booking', 'booking_request')).toBe(true);
      expect(intentMatches('booking_request', 'booking')).toBe(true);
    });

    it('should match intents in same family', () => {
      expect(intentMatches('booking', 'availability')).toBe(true);
      expect(intentMatches('pricing', 'booking')).toBe(true);
      expect(intentMatches('checkin_info', 'checkin')).toBe(true);
      expect(intentMatches('complaint', 'noise_complaint')).toBe(true);
    });

    it('should not match intents from different families', () => {
      expect(intentMatches('booking', 'complaint')).toBe(false);
      expect(intentMatches('checkin', 'checkout')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(intentMatches('Booking', 'booking')).toBe(false);
    });
  });

  describe('Fixture Data', () => {
    it('should have valid validation conversation structure', () => {
      expect(mockValidationConversation.profileId).toBeDefined();
      expect(mockValidationConversation.turns).toBeInstanceOf(Array);
      expect(mockValidationConversation.expectedCategory).toBeDefined();
      expect(mockValidationConversation.label).toBeDefined();
      expect(mockValidationConversation.difficulty).toBeDefined();
    });

    it('should have turns with user and assistant roles', () => {
      const roles = new Set(mockValidationConversation.turns.map(t => t.role));
      expect(roles.has('user')).toBe(true);
      expect(roles.has('assistant')).toBe(true);
    });

    it('should have expectedIntent for user messages', () => {
      const userTurns = mockValidationConversation.turns.filter(t => t.role === 'user');
      expect(userTurns.length).toBeGreaterThan(0);

      for (const turn of userTurns) {
        expect(turn.expectedIntent).toBeDefined();
      }
    });

    it('should not have expectedIntent for assistant messages', () => {
      const assistantTurns = mockValidationConversation.turns.filter(t => t.role === 'assistant');

      for (const turn of assistantTurns) {
        expect(turn.expectedIntent).toBeUndefined();
      }
    });
  });

  describe('Multi-turn conversation flow', () => {
    it('should extract context at each message', () => {
      const turns = mockValidationConversation.turns;
      const userMessageIndices = turns
        .map((t, i) => t.role === 'user' ? i : -1)
        .filter(i => i >= 0);

      expect(userMessageIndices.length).toBeGreaterThan(1);

      // Each user message should have different context
      const contexts = userMessageIndices.map(idx => buildContextHistory(turns, idx, 10));

      for (let i = 0; i < contexts.length - 1; i++) {
        expect(contexts[i].length).toBeLessThanOrEqual(contexts[i + 1].length);
      }
    });
  });

  describe('Window size comparisons', () => {
    it('should show increasing context size with larger windows', () => {
      const turns = mockValidationConversation.turns;
      const messageIndex = 4;

      const window3 = buildContextHistory(turns, messageIndex, 3);
      const window5 = buildContextHistory(turns, messageIndex, 5);
      const window10 = buildContextHistory(turns, messageIndex, 10);

      expect(window3.length).toBeLessThanOrEqual(window5.length);
      expect(window5.length).toBeLessThanOrEqual(window10.length);
    });

    it('should cap at actual conversation length', () => {
      const turns = mockValidationConversation.turns;
      const messageIndex = 5;

      // Requesting 100 messages but only 5 exist
      const result = buildContextHistory(turns, messageIndex, 100);

      // Should return at most all messages up to messageIndex
      expect(result.length).toBeLessThanOrEqual(messageIndex);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty turns array', () => {
      expect(() => buildContextHistory([], 0, 5)).not.toThrow();
      expect(buildContextHistory([], 0, 5)).toEqual([]);
    });

    it('should handle upToIndex = 0', () => {
      expect(buildContextHistory(mockValidationConversation.turns, 0, 10)).toEqual([]);
    });

    it('should handle large context windows', () => {
      const result = buildContextHistory(mockValidationConversation.turns, 5, 1000);
      expect(result).toBeInstanceOf(Array);
    });

    it('should handle negative context window gracefully', () => {
      const result = buildContextHistory(mockValidationConversation.turns, 5, -1);
      expect(result).toEqual([]);
    });
  });
});
