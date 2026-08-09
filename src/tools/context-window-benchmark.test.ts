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
  profile_id: 'pelangi',
  conversation_id: 'test-001',
  messages: [
    { role: 'user' as const, content: 'Hi, can you help me?', ground_truth_intent: 'greeting' },
    { role: 'assistant' as const, content: 'Of course! How can I help?' },
    { role: 'user' as const, content: 'Do you have rooms available?', ground_truth_intent: 'availability' },
    { role: 'assistant' as const, content: 'Yes, we have availability. When would you like to check in?' },
    { role: 'user' as const, content: 'Tomorrow afternoon', ground_truth_intent: 'booking' }
  ]
};

const mockJSONLContent = `${JSON.stringify(mockValidationConversation)}
${JSON.stringify({ ...mockValidationConversation, profileId: 'southern', conversationId: 'test-002' })}
`;

// ─── Helper Functions ────────────────────────────────────────────────

/**
 * Build conversation context (extracted from benchmark.ts for testing)
 */
function buildContextHistory(
  messages: Array<{ role: string; content: string; ground_truth_intent?: string }>,
  upToIndex: number,
  contextWindowSize: number
): Array<{ role: string; content: string; timestamp: number }> {
  if (contextWindowSize <= 0 || upToIndex <= 0) return [];

  const messagesBefore = messages.slice(0, upToIndex);
  const startIdx = Math.max(0, messagesBefore.length - contextWindowSize);
  const slicedMessages = messagesBefore.slice(startIdx);

  return slicedMessages.map((msg, idx) => ({
    role: msg.role,
    content: msg.content,
    timestamp: Date.now() - (slicedMessages.length - idx) * 1000
  }));
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
      const result = buildContextHistory(mockValidationConversation.messages, 5, 0);
      expect(result).toEqual([]);
    });

    it('should return fewer messages when upToIndex is smaller', () => {
      const result3 = buildContextHistory(mockValidationConversation.messages, 3, 10);
      const result5 = buildContextHistory(mockValidationConversation.messages, 5, 10);

      expect(result3.length).toBeLessThan(result5.length);
    });

    it('should limit context to windowSize', () => {
      const result = buildContextHistory(mockValidationConversation.messages, 5, 2);
      // Max 2 messages when windowSize=2
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should include both user and assistant messages in history', () => {
      const result = buildContextHistory(mockValidationConversation.messages, 4, 10);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(m => m.role === 'user')).toBe(true);
      expect(result.some(m => m.role === 'assistant')).toBe(true);
    });

    it('should preserve message order (chronological)', () => {
      const result = buildContextHistory(mockValidationConversation.messages, 5, 10);

      // Messages should be in chronological order (older first, newer last)
      for (let i = 1; i < result.length; i++) {
        expect(result[i].timestamp).toBeGreaterThanOrEqual(result[i - 1].timestamp);
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
      expect(mockValidationConversation.profile_id).toBeDefined();
      expect(mockValidationConversation.messages).toBeInstanceOf(Array);
      expect(mockValidationConversation.conversation_id).toBeDefined();
    });

    it('should have messages with user and assistant roles', () => {
      const roles = new Set(mockValidationConversation.messages.map(m => m.role));
      expect(roles.has('user')).toBe(true);
      expect(roles.has('assistant')).toBe(true);
    });

    it('should have ground_truth_intent for user messages', () => {
      const userMessages = mockValidationConversation.messages.filter(m => m.role === 'user');
      expect(userMessages.length).toBeGreaterThan(0);

      for (const msg of userMessages) {
        expect(msg.ground_truth_intent).toBeDefined();
      }
    });

    it('should not have ground_truth_intent for assistant messages', () => {
      const assistantMessages = mockValidationConversation.messages.filter(m => m.role === 'assistant');

      for (const msg of assistantMessages) {
        expect(msg.ground_truth_intent).toBeUndefined();
      }
    });
  });

  describe('Multi-turn conversation flow', () => {
    it('should extract context at each message', () => {
      const messages = mockValidationConversation.messages;
      const userMessageIndices = messages
        .map((m, i) => m.role === 'user' ? i : -1)
        .filter(i => i >= 0);

      expect(userMessageIndices.length).toBeGreaterThan(1);

      // Each user message should have different context
      const contexts = userMessageIndices.map(idx => buildContextHistory(messages, idx, 10));

      for (let i = 0; i < contexts.length - 1; i++) {
        expect(contexts[i].length).toBeLessThanOrEqual(contexts[i + 1].length);
      }
    });
  });

  describe('Window size comparisons', () => {
    it('should show increasing context size with larger windows', () => {
      const messages = mockValidationConversation.messages;
      const messageIndex = 4;

      const window3 = buildContextHistory(messages, messageIndex, 3);
      const window5 = buildContextHistory(messages, messageIndex, 5);
      const window10 = buildContextHistory(messages, messageIndex, 10);

      expect(window3.length).toBeLessThanOrEqual(window5.length);
      expect(window5.length).toBeLessThanOrEqual(window10.length);
    });

    it('should cap at actual conversation length', () => {
      const messages = mockValidationConversation.messages;
      const messageIndex = 5;

      // Requesting 100 messages but only 5 exist
      const result = buildContextHistory(messages, messageIndex, 100);

      // Should return at most all messages up to messageIndex
      expect(result.length).toBeLessThanOrEqual(messageIndex);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty messages array', () => {
      expect(() => buildContextHistory([], 0, 5)).not.toThrow();
      expect(buildContextHistory([], 0, 5)).toEqual([]);
    });

    it('should handle upToIndex = 0', () => {
      expect(buildContextHistory(mockValidationConversation.messages, 0, 10)).toEqual([]);
    });

    it('should handle large context windows', () => {
      const result = buildContextHistory(mockValidationConversation.messages, 5, 1000);
      expect(result).toBeInstanceOf(Array);
    });

    it('should handle negative context window gracefully', () => {
      const result = buildContextHistory(mockValidationConversation.messages, 5, -1);
      expect(result).toEqual([]);
    });
  });
});
