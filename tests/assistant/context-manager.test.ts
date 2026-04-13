/**
 * US-532: Conversation Context Window Pruning Tests
 *
 * Validates that conversation context pruning keeps only the last N messages
 * and properly drops oldest messages first.
 */

import { describe, it, expect } from 'vitest';
import { pruneConversationContext } from '../../src/assistant/pipeline/context-manager.js';
import type { ChatMessage } from '../../src/assistant/types.js';

describe('pruneConversationContext', () => {
  describe('window size limiting', () => {
    it('should keep all messages when conversation is within window size', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      const result = pruneConversationContext(messages, 10);

      expect(result).toHaveLength(3);
      expect(result).toEqual(messages);
    });

    it('should drop oldest messages and keep recent ones with 5-message window', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Response 3' },
        { role: 'user', content: 'Message 4' },
      ];

      const result = pruneConversationContext(messages, 5);

      expect(result).toHaveLength(5);
      // Should keep the last 5 messages
      expect(result[0]).toEqual({ role: 'assistant', content: 'Response 2' });
      expect(result[4]).toEqual({ role: 'user', content: 'Message 4' });
    });

    it('should drop old messages and preserve recent ones with default window size', () => {
      const messages: ChatMessage[] = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`,
      }));

      const result = pruneConversationContext(messages, 20);

      expect(result).toHaveLength(20);
      // Should keep messages 6-25 (drop first 5)
      expect(result[0].content).toBe('Message 6');
      expect(result[19].content).toBe('Message 25');
    });

    it('should handle single message gracefully', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Only message' },
      ];

      const result = pruneConversationContext(messages, 10);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'user', content: 'Only message' });
    });

    it('should keep exactly window size messages when exceeding limit', () => {
      const messages: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Msg ${i + 1}`,
      }));

      const result = pruneConversationContext(messages, 10);

      expect(result).toHaveLength(10);
      expect(result[0].content).toBe('Msg 21');
      expect(result[9].content).toBe('Msg 30');
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty messages', () => {
      const result = pruneConversationContext([], 10);
      expect(result).toEqual([]);
    });

    it('should return empty array for null messages', () => {
      const result = pruneConversationContext(null as any, 10);
      expect(result).toEqual([]);
    });

    it('should preserve message order after pruning', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Second' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Third' },
      ];

      const result = pruneConversationContext(messages, 3);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ role: 'assistant', content: 'Response 2' });
      expect(result[1]).toEqual({ role: 'user', content: 'Third' });
      expect(result[2]).toEqual(messages[4]); // Last message is preserved
    });

    it('should handle window size of 1', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
      ];

      const result = pruneConversationContext(messages, 1);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'user', content: 'Message 2' });
    });

    it('should handle zero window size', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
      ];

      const result = pruneConversationContext(messages, 0);

      // slice(-0) returns empty array
      expect(result).toHaveLength(0);
    });
  });

  describe('message content preservation', () => {
    it('should preserve message content exactly during pruning', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Can you help me with booking?' },
        { role: 'assistant', content: 'Of course! What dates are you looking for?' },
        { role: 'user', content: 'April 15-18, I need 2 rooms' },
        { role: 'assistant', content: 'Let me check availability...' },
        { role: 'user', content: 'Great, I am interested in the double room' },
      ];

      const result = pruneConversationContext(messages, 3);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(messages[2]);
      expect(result[1]).toEqual(messages[3]);
      expect(result[2]).toEqual(messages[4]);
    });

    it('should handle messages with special characters', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hi! 你好 🌟' },
        { role: 'assistant', content: 'Hello! مرحبا' },
        { role: 'user', content: 'Thank you! ありがとう!' },
      ];

      const result = pruneConversationContext(messages, 2);

      expect(result).toHaveLength(2);
      expect(result[1]).toEqual(messages[2]);
    });
  });
});
