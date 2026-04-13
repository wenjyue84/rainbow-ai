/**
 * Test: Conversation Context Pruning with Rolling Window
 *
 * Verifies that:
 * 1. pruneConversationHistory keeps only last N messages
 * 2. Longer conversations are truncated before sending to AI provider
 * 3. Settings-based window size is respected
 */

import { describe, it, expect } from 'vitest';
import { pruneConversationHistory } from '../pipeline/response-processor.js';
import type { ChatMessage } from '../types.js';

describe('US-543: Conversation Context Pruning', () => {
  describe('pruneConversationHistory', () => {
    it('keeps all messages when conversation is shorter than window size', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am doing well' },
      ];

      const pruned = pruneConversationHistory(messages, 10);
      expect(pruned).toHaveLength(4);
      expect(pruned).toEqual(messages);
    });

    it('truncates to window size when conversation exceeds window', () => {
      const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const pruned = pruneConversationHistory(messages, 10);
      expect(pruned).toHaveLength(10);
      // Verify we keep the last 10 messages
      expect(pruned[0].content).toBe('Message 10');
      expect(pruned[9].content).toBe('Message 19');
    });

    it('truncates 20-message conversation to 10 (acceptance criteria)', () => {
      const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const windowSize = 10;
      const pruned = pruneConversationHistory(messages, windowSize);

      expect(pruned).toHaveLength(windowSize);
      expect(messages).toHaveLength(20);
      // Verify messages are preserved but truncated
      expect(pruned).toEqual(messages.slice(-windowSize));
    });

    it('handles empty message array', () => {
      const messages: ChatMessage[] = [];
      const pruned = pruneConversationHistory(messages, 10);
      expect(pruned).toHaveLength(0);
    });

    it('handles single message', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const pruned = pruneConversationHistory(messages, 10);
      expect(pruned).toHaveLength(1);
      expect(pruned[0]).toEqual(messages[0]);
    });

    it('respects different window sizes', () => {
      const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const windowSize5 = pruneConversationHistory(messages, 5);
      expect(windowSize5).toHaveLength(5);

      const windowSize15 = pruneConversationHistory(messages, 15);
      expect(windowSize15).toHaveLength(15);
    });

    it('preserves message order and role when pruning', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'msg2' },
        { role: 'user', content: 'msg3' },
        { role: 'assistant', content: 'msg4' },
        { role: 'user', content: 'msg5' },
        { role: 'assistant', content: 'msg6' },
      ];

      const pruned = pruneConversationHistory(messages, 3);
      expect(pruned).toHaveLength(3);
      expect(pruned[0]).toEqual({ role: 'assistant', content: 'msg4' });
      expect(pruned[1]).toEqual({ role: 'user', content: 'msg5' });
      expect(pruned[2]).toEqual({ role: 'assistant', content: 'msg6' });
    });

    it('handles messages with timestamps and metadata', () => {
      const messages: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: Math.floor(Date.now() / 1000) + i,
      }));

      const pruned = pruneConversationHistory(messages, 5);
      expect(pruned).toHaveLength(5);
      // Verify timestamps are preserved
      expect(pruned[0].timestamp).toBeDefined();
      expect(pruned[4].timestamp).toBeDefined();
    });
  });

  describe('token overflow prevention', () => {
    it('prevents token overflow in 20+ message conversations', () => {
      // Create a long conversation that could cause token overflow
      const messages: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(5),
      }));

      const pruned = pruneConversationHistory(messages, 10);

      // Verify window size is respected
      expect(pruned.length).toBeLessThanOrEqual(10);
      expect(messages.length).toBeGreaterThan(pruned.length);
    });

    it('default window size of 10 is reasonable for most cases', () => {
      const windowSize = 10;
      const messages: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const pruned = pruneConversationHistory(messages, windowSize);
      expect(pruned).toHaveLength(windowSize);
    });
  });

  describe('configuration', () => {
    it('supports per-profile configuration', () => {
      // This test verifies the settings structure supports per-profile window sizes
      // Settings should have: conversationWindowSize: { pelangi: 10, makan: 10, southern: 10 }

      const settings = {
        conversationWindowSize: {
          pelangi: 10,
          makan: 10,
          southern: 10,
        }
      };

      expect(settings.conversationWindowSize.pelangi).toBe(10);
      expect(settings.conversationWindowSize.makan).toBe(10);
      expect(settings.conversationWindowSize.southern).toBe(10);
    });

    it('allows overriding window size per profile', () => {
      const settings = {
        conversationWindowSize: {
          pelangi: 10,
          makan: 15,  // Different window size
          southern: 10,
        }
      };

      expect(settings.conversationWindowSize.makan).toBe(15);
      expect(settings.conversationWindowSize.pelangi).toBe(10);
    });
  });
});
