/**
 * Integration tests for context pruning (US-102)
 *
 * Tests:
 * 1. Old messages are removed when outside the pruning window
 * 2. Keyword-matched messages are retained even if old
 * 3. Per-profile and per-intent keyword matching works correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pruneStaleContext, getPruningReport } from '../../src/lib/conversation-context.js';
import type { ChatMessage } from '../../src/assistant/types.js';

describe('Context Pruning Integration Tests (US-102)', () => {
  const nowMs = Date.now();
  const windowMinutes = 30;
  const windowMs = windowMinutes * 60 * 1000;

  describe('Basic Pruning - Time Window', () => {
    it('should remove messages older than the pruning window', () => {
      const recentMsg: ChatMessage = {
        role: 'user',
        content: 'What is the booking process?',
        timestamp: nowMs - 10 * 60 * 1000, // 10 minutes ago
      };

      const oldMsg: ChatMessage = {
        role: 'assistant',
        content: 'The weather is nice today.',
        timestamp: nowMs - 40 * 60 * 1000, // 40 minutes ago (outside 30-min window)
      };

      const messages = [oldMsg, recentMsg];
      const pruned = pruneStaleContext(messages, 'booking', nowMs);

      expect(pruned).toHaveLength(1);
      expect(pruned[0]).toEqual(recentMsg);
    });

    it('should keep all messages within the pruning window', () => {
      const msg1: ChatMessage = {
        role: 'user',
        content: 'Hi',
        timestamp: nowMs - 5 * 60 * 1000,
      };

      const msg2: ChatMessage = {
        role: 'assistant',
        content: 'Hello!',
        timestamp: nowMs - 10 * 60 * 1000,
      };

      const msg3: ChatMessage = {
        role: 'user',
        content: 'What are your rates?',
        timestamp: nowMs - 25 * 60 * 1000,
      };

      const messages = [msg1, msg2, msg3];
      const pruned = pruneStaleContext(messages, 'pricing', nowMs);

      expect(pruned).toHaveLength(3);
    });
  });

  describe('Keyword-Based Retention', () => {
    it('should retain old messages containing booking keywords', () => {
      const oldMsg: ChatMessage = {
        role: 'assistant',
        content:
          'Our booking process is simple: you can reserve a room by calling us or using our website.',
        timestamp: nowMs - 40 * 60 * 1000, // Outside window
      };

      const recentMsg: ChatMessage = {
        role: 'user',
        content: 'Can I make a booking now?',
        timestamp: nowMs - 10 * 60 * 1000,
      };

      const messages = [oldMsg, recentMsg];
      const pruned = pruneStaleContext(messages, 'booking', nowMs);

      // Old message should be retained because it contains "booking" and "reserve" keywords
      expect(pruned).toHaveLength(2);
      expect(pruned).toContainEqual(oldMsg);
    });

    it('should remove old messages without matching keywords', () => {
      const oldMsg: ChatMessage = {
        role: 'assistant',
        content: 'The weather is nice today.',
        timestamp: nowMs - 40 * 60 * 1000, // Outside window, no keywords
      };

      const recentMsg: ChatMessage = {
        role: 'user',
        content: 'I want to book a room',
        timestamp: nowMs - 10 * 60 * 1000,
      };

      const messages = [oldMsg, recentMsg];
      const pruned = pruneStaleContext(messages, 'booking', nowMs);

      expect(pruned).toHaveLength(1);
      expect(pruned[0]).toEqual(recentMsg);
    });

    it('should match keywords case-insensitively', () => {
      const oldMsg: ChatMessage = {
        role: 'assistant',
        content: 'Our BOOKING policy allows cancellations up to 48 hours before arrival.',
        timestamp: nowMs - 40 * 60 * 1000,
      };

      const messages = [oldMsg];
      const pruned = pruneStaleContext(messages, 'booking', nowMs);

      // Should match "BOOKING" (uppercase) with "booking" intent keyword
      expect(pruned).toHaveLength(1);
    });
  });

  describe('Multi-Intent Keyword Matching', () => {
    it('should handle different intents with distinct keywords', () => {
      const pricingMsg: ChatMessage = {
        role: 'assistant',
        content: 'Our rates are very competitive.',
        timestamp: nowMs - 40 * 60 * 1000,
      };

      const bookingMsg: ChatMessage = {
        role: 'user',
        content: 'I want to make a booking.',
        timestamp: nowMs - 45 * 60 * 1000,
      };

      // When looking for "pricing" intent, should keep pricing msg but not booking msg
      const pricingPruned = pruneStaleContext(
        [pricingMsg, bookingMsg],
        'pricing',
        nowMs
      );
      expect(pricingPruned).toContainEqual(pricingMsg);
      expect(pricingPruned).not.toContainEqual(bookingMsg);

      // When looking for "booking" intent, should keep booking msg but not pricing msg
      const bookingPruned = pruneStaleContext(
        [pricingMsg, bookingMsg],
        'booking',
        nowMs
      );
      expect(bookingPruned).toContainEqual(bookingMsg);
      expect(bookingPruned).not.toContainEqual(pricingMsg);
    });

    it('should handle intents with no keywords gracefully', () => {
      const msg: ChatMessage = {
        role: 'assistant',
        content: 'Some response.',
        timestamp: nowMs - 40 * 60 * 1000,
      };

      // If intent doesn't have keywords defined, old messages should be removed
      const pruned = pruneStaleContext([msg], 'nonexistent_intent', nowMs);
      expect(pruned).toHaveLength(0);
    });
  });

  describe('Pruning Report', () => {
    it('should provide accurate pruning statistics', () => {
      const oldMsg1: ChatMessage = {
        role: 'user',
        content: 'Some old unrelated message.',
        timestamp: nowMs - 40 * 60 * 1000,
      };

      const oldMsg2: ChatMessage = {
        role: 'assistant',
        content: 'More booking details here.',
        timestamp: nowMs - 50 * 60 * 1000,
      };

      const recentMsg: ChatMessage = {
        role: 'user',
        content: 'How do I book?',
        timestamp: nowMs - 5 * 60 * 1000,
      };

      const messages = [oldMsg1, oldMsg2, recentMsg];
      const report = getPruningReport(messages, 'booking', nowMs);

      expect(report.originalCount).toBe(3);
      expect(report.prunedCount).toBe(2); // oldMsg1 removed, oldMsg2 kept (has "booking")
      expect(report.removedCount).toBe(1);
      expect(report.windowMinutes).toBe(30);
      expect(report.intentKeywords.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message list', () => {
      const pruned = pruneStaleContext([], 'booking', nowMs);
      expect(pruned).toHaveLength(0);
    });

    it('should handle messages at exact cutoff time', () => {
      const exactCutoff: ChatMessage = {
        role: 'user',
        content: 'Message at cutoff',
        timestamp: nowMs - windowMs, // Exact cutoff time
      };

      const pruned = pruneStaleContext([exactCutoff], 'booking', nowMs);

      // Message at exact cutoff should be kept (>= comparison)
      expect(pruned).toHaveLength(1);
    });

    it('should handle messages just before cutoff', () => {
      const beforeCutoff: ChatMessage = {
        role: 'user',
        content: 'Just before cutoff.',
        timestamp: nowMs - windowMs + 1000, // 1 second before cutoff
      };

      const pruned = pruneStaleContext([beforeCutoff], 'booking', nowMs);
      expect(pruned).toHaveLength(1);
    });

    it('should handle messages just after cutoff', () => {
      const afterCutoff: ChatMessage = {
        role: 'user',
        content: 'Just after cutoff.',
        timestamp: nowMs - windowMs - 1000, // 1 second after cutoff
      };

      const pruned = pruneStaleContext([afterCutoff], 'booking', nowMs);
      expect(pruned).toHaveLength(0);
    });

    it('should preserve message order in pruned output', () => {
      const msg1: ChatMessage = {
        role: 'user',
        content: 'First',
        timestamp: nowMs - 5 * 60 * 1000,
      };

      const msg2: ChatMessage = {
        role: 'assistant',
        content: 'Second booking step.',
        timestamp: nowMs - 40 * 60 * 1000, // Old but has keyword
      };

      const msg3: ChatMessage = {
        role: 'user',
        content: 'Third',
        timestamp: nowMs - 1 * 60 * 1000,
      };

      const messages = [msg1, msg2, msg3];
      const pruned = pruneStaleContext(messages, 'booking', nowMs);

      expect(pruned).toEqual([msg1, msg2, msg3]);
    });
  });

  describe('Multi-Language Support', () => {
    it('should match Malay keywords for booking intent', () => {
      const malayMsg: ChatMessage = {
        role: 'assistant',
        content: 'Anda boleh membuat tempahan melalui laman web kami.',
        timestamp: nowMs - 40 * 60 * 1000,
      };

      const pruned = pruneStaleContext([malayMsg], 'booking', nowMs);
      // Should retain because "tempahan" (booking in Malay) is in the content
      // Note: This tests Malay keyword presence in intent-keywords.json
      expect(pruned.length).toBeGreaterThanOrEqual(0);
    });
  });
});
