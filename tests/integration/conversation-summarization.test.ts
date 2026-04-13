/**
 * US-546: Conversation Message Summarization Engine Tests
 *
 * Tests for the conversation summarization feature that:
 * - Summarizes messages 1-15 when conversation exceeds 20 messages
 * - Keeps messages 16-20 verbatim
 * - Caches summary in DB with 24-hour TTL
 * - Reduces token usage by ~35% on long conversations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { summarizeConversation } from '../../src/lib/conversation-summarizer.js';
import type { ChatMessage } from '../../src/assistant/types.js';

// Mock AI provider
const mockAIProvider = {
  chat: vi.fn(async () => ({
    content: 'Guest John booked check-in on 2026-04-15 for 3 nights in Room 101. Requested late checkout. Paid deposit via bank transfer.',
  })),
};

// Mock DB operations
vi.mock('../../src/lib/db.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {}),
      })),
    })),
  },
}));

/**
 * Helper: Create mock conversation messages
 */
function createMockMessages(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 1; i <= count; i++) {
    messages.push({
      role: i % 2 === 1 ? 'user' : 'assistant',
      content: `Message ${i}: This is a test message number ${i} with some content about the guest's booking.`,
      timestamp: Math.floor(Date.now() / 1000) - (count - i) * 60, // Spaced 1 minute apart
    });
  }
  return messages;
}

describe('US-546: Conversation Message Summarization Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('summarizeConversation', () => {
    it('should not summarize conversations with <= 20 messages', async () => {
      const messages = createMockMessages(15);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      expect(result.wasSummarized).toBe(false);
      expect(result.messages).toEqual(messages);
      expect(result.summary).toBe('');
      expect(result.summaryTokens).toBe(0);
      expect(mockAIProvider.chat).not.toHaveBeenCalled();
    });

    it('should summarize conversations with > 20 messages', async () => {
      const messages = createMockMessages(25);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      expect(result.wasSummarized).toBe(true);
      expect(result.messages.length).toBeLessThan(messages.length);
      expect(result.summary).toBeTruthy();
      expect(result.summaryTokens).toBeGreaterThan(0);
      expect(mockAIProvider.chat).toHaveBeenCalled();
    });

    it('should summarize messages 1-15 and keep messages 16-20 verbatim', async () => {
      const messages = createMockMessages(22);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      // Result should have: 1 summary message + 7 recent messages (16-22)
      expect(result.messages.length).toBe(8); // 1 summary + 7 recent (indices 15-21 = messages 16-22)

      // First message should be the summary
      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].content).toContain('[Conversation Summary]');

      // Remaining messages should be the last 7 original messages (16-22)
      const recentFromResult = result.messages.slice(1);
      const expectedRecent = messages.slice(15); // 0-indexed, so messages 16-22 are at index 15-21

      expect(recentFromResult).toEqual(expectedRecent);
    });

    it('should estimate summary token count correctly', async () => {
      const messages = createMockMessages(25);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      expect(result.summaryTokens).toBeGreaterThan(0);
      // Should be roughly 100-150 tokens
      expect(result.summaryTokens).toBeGreaterThanOrEqual(25); // At least 100 chars / 4 chars per token
    });

    it('should fall back to keeping recent 5 messages on summarization failure', async () => {
      const failProvider = {
        chat: vi.fn(async () => {
          throw new Error('AI provider unavailable');
        }),
      };

      const messages = createMockMessages(25);
      const result = await summarizeConversation(messages, '+60123456789', failProvider);

      expect(result.wasSummarized).toBe(false);
      expect(result.messages.length).toBe(5); // Only recent 5 messages
      expect(result.summary).toBe('');
      expect(result.summaryTokens).toBe(0);
    });

    it('should pass correct context to AI provider for summarization', async () => {
      const messages = createMockMessages(25);
      await summarizeConversation(messages, '+60123456789', mockAIProvider);

      expect(mockAIProvider.chat).toHaveBeenCalled();
      const callArgs = mockAIProvider.chat.mock.calls[0][0];

      // Should have system + user messages
      expect(callArgs.length).toBe(2);
      expect(callArgs[0].role).toBe('system');
      expect(callArgs[1].role).toBe('user');

      // User prompt should reference the older messages
      expect(callArgs[1].content).toContain('Summarize');
      expect(callArgs[1].content).toContain('100-150 tokens');
    });

    it('should request 100-150 token summaries', async () => {
      const messages = createMockMessages(25);
      await summarizeConversation(messages, '+60123456789', mockAIProvider);

      const callArgs = mockAIProvider.chat.mock.calls[0][0];
      const userPrompt = callArgs[1].content;

      expect(userPrompt).toContain('100-150 tokens');
    });

    it('should preserve guest name and key booking info in summary request', async () => {
      const messages = createMockMessages(25);
      await summarizeConversation(messages, '+60123456789', mockAIProvider);

      const callArgs = mockAIProvider.chat.mock.calls[0][0];
      const userPrompt = callArgs[1].content;

      // Check that the prompt asks for important information to be preserved
      expect(userPrompt).toContain('Guest name');
      expect(userPrompt).toContain('booking');
      expect(userPrompt).toContain('dates');
    });

    it('should reduce token usage compared to full conversation', async () => {
      const messages = createMockMessages(30);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      // Original should have more tokens than summarized
      expect(result.truncatedTokens).toBeLessThan(result.originalTokens);

      // Should achieve roughly 35% reduction (or better) on long conversations
      const reduction = (1 - result.truncatedTokens / result.originalTokens) * 100;
      expect(reduction).toBeGreaterThan(20); // At least 20% reduction
    });

    it('should handle empty conversation gracefully', async () => {
      const result = await summarizeConversation([], '+60123456789', mockAIProvider);

      expect(result.wasSummarized).toBe(false);
      expect(result.messages).toEqual([]);
      expect(mockAIProvider.chat).not.toHaveBeenCalled();
    });

    it('should handle single message conversation', async () => {
      const messages = createMockMessages(1);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      expect(result.wasSummarized).toBe(false);
      expect(result.messages).toEqual(messages);
    });

    it('should handle exactly 20 messages (boundary)', async () => {
      const messages = createMockMessages(20);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      expect(result.wasSummarized).toBe(false);
      expect(result.messages).toEqual(messages);
      expect(mockAIProvider.chat).not.toHaveBeenCalled();
    });

    it('should handle exactly 21 messages (just above boundary)', async () => {
      const messages = createMockMessages(21);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      expect(result.wasSummarized).toBe(true);
      expect(mockAIProvider.chat).toHaveBeenCalled();
    });
  });

  describe('Token counting', () => {
    it('should estimate tokens for summarized output', async () => {
      const messages = createMockMessages(25);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      expect(result.summaryTokens).toBeGreaterThan(0);
      // Estimated as chars / 4
      const estimatedFromLength = Math.ceil(result.summary.length / 4);
      expect(result.summaryTokens).toBe(estimatedFromLength);
    });
  });

  describe('Context building with summarization', () => {
    it('should preserve chronological order of messages in result', async () => {
      const messages = createMockMessages(25);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      if (result.messages.length > 1) {
        // Check timestamps are roughly chronological (except for injected summary)
        for (let i = 1; i < result.messages.length - 1; i++) {
          expect(result.messages[i].timestamp).toBeLessThanOrEqual(
            result.messages[i + 1].timestamp + 1 // Allow 1 second tolerance
          );
        }
      }
    });

    it('should combine summary with recent messages correctly', async () => {
      const messages = createMockMessages(25);
      const result = await summarizeConversation(messages, '+60123456789', mockAIProvider);

      if (result.wasSummarized) {
        // First message is summary
        expect(result.messages[0].content).toContain('Summary');

        // Rest are recent messages
        const recentCount = messages.length - 15; // messages 16-25
        expect(result.messages.length).toBe(1 + recentCount);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle very long message content', async () => {
      const longMessages: ChatMessage[] = [];
      for (let i = 0; i < 25; i++) {
        longMessages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(5000), // 5000 character message
          timestamp: Math.floor(Date.now() / 1000) - (25 - i) * 60,
        });
      }

      const result = await summarizeConversation(longMessages, '+60123456789', mockAIProvider);

      expect(result.wasSummarized).toBe(true);
      expect(result.truncatedTokens).toBeLessThan(result.originalTokens);
    });

    it('should handle multilingual messages', async () => {
      const multilingualMessages: ChatMessage[] = [];
      const content = [
        'Hello, I need a booking',
        'Hola, necesito una reserva',
        'السلام عليكم ورحمة الله',
        '你好,我需要预订',
        'Bonjour, j\'ai besoin d\'une réservation',
      ];

      for (let i = 0; i < 25; i++) {
        multilingualMessages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: content[i % content.length],
          timestamp: Math.floor(Date.now() / 1000) - (25 - i) * 60,
        });
      }

      const result = await summarizeConversation(multilingualMessages, '+60123456789', mockAIProvider);

      expect(result.wasSummarized).toBe(true);
      expect(mockAIProvider.chat).toHaveBeenCalled();
    });

    it('should handle special characters and escape sequences', async () => {
      const specialMessages: ChatMessage[] = [];
      for (let i = 0; i < 25; i++) {
        specialMessages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}: "quoted text" \n newline \t tab \\ backslash \\n \\t special chars: <>&"'`,
          timestamp: Math.floor(Date.now() / 1000) - (25 - i) * 60,
        });
      }

      const result = await summarizeConversation(specialMessages, '+60123456789', mockAIProvider);

      expect(result.wasSummarized).toBe(true);
      expect(result.summary).toBeTruthy();
    });
  });
});
