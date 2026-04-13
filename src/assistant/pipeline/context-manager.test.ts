import { describe, it, expect } from 'vitest';
import { summarizeConversationContext, pruneConversationContext } from './context-manager.js';
import type { ChatMessage } from '../types.js';

describe('US-328: Conversation Summarization', () => {
  describe('summarizeConversationContext', () => {
    it('should return empty summary for empty messages', () => {
      const result = summarizeConversationContext([]);
      expect(result.summary).toBe('');
      expect(result.recentMessages).toEqual([]);
      expect(result.messageReductionRatio).toBe(0);
      expect(result.factsExtracted).toEqual({});
    });

    it('should not summarize conversations within maxHistoryMessages limit', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hi', timestamp: 1000 },
        { role: 'assistant', content: 'Hello!', timestamp: 1001 },
        { role: 'user', content: 'I want to book', timestamp: 1002 },
        { role: 'assistant', content: 'Sure!', timestamp: 1003 },
      ];

      const result = summarizeConversationContext(messages, 10);
      expect(result.summary).toBe('');
      expect(result.recentMessages).toEqual(messages);
      expect(result.messageReductionRatio).toBe(0);
    });

    it('should condense 15-message conversation to 1 summary + 10 recent messages', () => {
      const messages: ChatMessage[] = [];

      // Build a realistic 15-message conversation
      for (let i = 0; i < 15; i++) {
        const isUser = i % 2 === 0;
        messages.push({
          role: isUser ? 'user' : 'assistant',
          content: isUser
            ? `User message ${i}: booking related`
            : `Assistant response ${i}`,
          timestamp: 1000 + i,
        });
      }

      const result = summarizeConversationContext(messages, 10);

      // Should preserve only 10 most recent messages
      expect(result.recentMessages.length).toBe(10);
      expect(result.messageReductionRatio).toBeGreaterThan(0);
      expect(result.messageReductionRatio).toBeLessThanOrEqual(1);
    });

    it('should handle realistic booking conversation', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hi, my name is John', timestamp: 1000 },
        { role: 'assistant', content: 'Nice to meet you!', timestamp: 1001 },
        { role: 'user', content: 'I would like a double room', timestamp: 1002 },
        { role: 'user', content: 'For 4 guests please', timestamp: 1003 },
      ];

      const result = summarizeConversationContext(messages);
      // Should not summarize small conversations (within maxHistoryMessages)
      expect(result.recentMessages.length).toBe(4);
      expect(result.summary).toBe('');
      // Facts may or may not be extracted depending on pattern matching
      expect(result.factsExtracted).toBeDefined();
    });

    it('should preserve all booking-critical details in 15-message scenario', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello! My name is Alice Johnson', timestamp: 1000 },
        { role: 'assistant', content: 'Welcome! What can I help you with?', timestamp: 1001 },
        { role: 'user', content: 'I want to book a double room for 2 guests', timestamp: 1002 },
        { role: 'assistant', content: 'Great! What dates?', timestamp: 1003 },
        { role: 'user', content: 'Check in March 25 and check out March 28', timestamp: 1004 },
        { role: 'assistant', content: 'Perfect! Any special requests?', timestamp: 1005 },
        { role: 'user', content: 'I need a high floor room, quiet area', timestamp: 1006 },
        { role: 'assistant', content: 'Understood, high floor quiet room', timestamp: 1007 },
        { role: 'user', content: 'What about breakfast?', timestamp: 1008 },
        { role: 'assistant', content: 'Breakfast is included', timestamp: 1009 },
        { role: 'user', content: 'Can we add airport transfer?', timestamp: 1010 },
        { role: 'assistant', content: 'Yes, airport transfer available', timestamp: 1011 },
        { role: 'user', content: 'How much would that be?', timestamp: 1012 },
        { role: 'assistant', content: 'Let me calculate for you', timestamp: 1013 },
        { role: 'user', content: 'Let me know the total price', timestamp: 1014 },
      ];

      const result = summarizeConversationContext(messages, 10);

      // Should preserve all critical booking facts
      expect(result.factsExtracted.guestName).toBe('Alice Johnson');
      expect(result.factsExtracted.roomType).toBe('double');
      expect(result.factsExtracted.checkInDate).toBeDefined();
      expect(result.factsExtracted.checkOutDate).toBeDefined();
      expect(result.factsExtracted.guestCount).toBe('2');

      // Should have recent messages
      expect(result.recentMessages.length).toBe(10);

      // Should have summary text with key facts
      expect(result.summary).toContain('Alice Johnson');
      expect(result.summary).toContain('double');
      expect(result.summary).toContain('2');

      // Reduction ratio should be valid
      expect(result.messageReductionRatio).toBeCloseTo(0.333, 2); // 5 messages out of 15
    });

    it('should handle messages with varied timestamps', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Start', timestamp: 1000 },
        { role: 'assistant', content: 'Welcome', timestamp: 1100 },
        { role: 'user', content: 'My name is Bob', timestamp: 1200 },
        { role: 'assistant', content: 'Hi Bob', timestamp: 1300 },
        { role: 'user', content: 'I want a double room', timestamp: 1400 },
      ];

      const result = summarizeConversationContext(messages);
      // Should not summarize small conversations
      expect(result.recentMessages.length).toBe(5);
      expect(result.summary).toBe('');
    });

    it('should calculate message reduction ratio correctly', () => {
      const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: 1000 + i,
      }));

      const result = summarizeConversationContext(messages, 5);

      // 20 messages, keep 5, so reduction = 15/20 = 0.75
      expect(result.messageReductionRatio).toBeCloseTo(0.75, 2);
      expect(result.recentMessages.length).toBe(5);
    });

    it('should include summary in returned summary field when condensing', () => {
      const messages: ChatMessage[] = Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: i === 0 ? 'My name is Eve' : `Message ${i}`,
        timestamp: 1000 + i,
      }));

      const result = summarizeConversationContext(messages, 10);
      expect(result.summary).toBeTruthy();
      expect(result.summary).toContain('Eve');
    });

    it('should handle edge case with exactly maxHistoryMessages + 1 messages', () => {
      const messages: ChatMessage[] = Array.from({ length: 11 }, (_, i) =>
        i === 0
          ? { role: 'user' as const, content: 'My name is Alice', timestamp: 1000 + i }
          : { role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}`, timestamp: 1000 + i }
      );

      const result = summarizeConversationContext(messages, 10);
      expect(result.recentMessages.length).toBe(10);
      expect(result.messageReductionRatio).toBeCloseTo(0.0909, 3);
      // With 1 fact extracted, summary should be generated
      expect(result.summary).toContain('Alice');
    });

    it('should calculate correct message reduction ratio', () => {
      const messages: ChatMessage[] = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: 1000 + i,
      }));

      const result = summarizeConversationContext(messages, 10);
      // 25 messages, keep 10, so reduction = 15/25 = 0.6
      expect(result.messageReductionRatio).toBeCloseTo(0.6, 2);
      expect(result.recentMessages.length).toBe(10);
    });

    it('should generate summary when condensing large conversations', () => {
      const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) =>
        i === 0
          ? { role: 'user' as const, content: 'My name is David', timestamp: 1000 + i }
          : { role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}`, timestamp: 1000 + i }
      );

      const result = summarizeConversationContext(messages, 10);
      // Should generate summary with extracted facts
      expect(result.summary).toBeTruthy();
      if (result.factsExtracted.guestName) {
        expect(result.summary).toContain(result.factsExtracted.guestName);
      }
    });

    it('should preserve recent messages in original order', () => {
      const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: 1000 + i,
      }));

      const result = summarizeConversationContext(messages, 5);
      expect(result.recentMessages.length).toBe(5);
      expect(result.recentMessages[0].content).toBe('Message 10');
      expect(result.recentMessages[4].content).toBe('Message 14');
    });
  });
});

describe('US-532: Conversation Context Window Pruning', () => {
  describe('pruneConversationContext', () => {
    it('should return empty array for empty messages', () => {
      const result = pruneConversationContext([], 20);
      expect(result).toEqual([]);
    });

    it('should return messages as-is when within window size', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hi', timestamp: 1000 },
        { role: 'assistant', content: 'Hello!', timestamp: 1001 },
        { role: 'user', content: 'How are you?', timestamp: 1002 },
      ];

      const result = pruneConversationContext(messages, 20);
      expect(result).toEqual(messages);
      expect(result.length).toBe(3);
    });

    it('should prune messages to window size when exceeding', () => {
      const messages: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: 1000 + i,
      }));

      const result = pruneConversationContext(messages, 5);
      expect(result.length).toBe(5);
      // Should keep last 5 messages (indices 5-9)
      expect(result[0].content).toBe('Message 5');
      expect(result[4].content).toBe('Message 9');
    });

    it('should drop oldest messages and preserve recent ones with 5-message window', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Message 1 (oldest)', timestamp: 1000 },
        { role: 'assistant', content: 'Message 2', timestamp: 1001 },
        { role: 'user', content: 'Message 3', timestamp: 1002 },
        { role: 'assistant', content: 'Message 4', timestamp: 1003 },
        { role: 'user', content: 'Message 5', timestamp: 1004 },
        { role: 'assistant', content: 'Message 6', timestamp: 1005 },
        { role: 'user', content: 'Message 7', timestamp: 1006 },
        { role: 'assistant', content: 'Message 8', timestamp: 1007 },
        { role: 'user', content: 'Message 9', timestamp: 1008 },
        { role: 'assistant', content: 'Message 10 (newest)', timestamp: 1009 },
      ];

      const result = pruneConversationContext(messages, 5);

      // Should only keep the last 5 messages
      expect(result.length).toBe(5);

      // Verify oldest messages are dropped
      expect(result.map(m => m.content)).not.toContain('Message 1 (oldest)');
      expect(result.map(m => m.content)).not.toContain('Message 2');
      expect(result.map(m => m.content)).not.toContain('Message 3');
      expect(result.map(m => m.content)).not.toContain('Message 4');
      expect(result.map(m => m.content)).not.toContain('Message 5');

      // Verify recent messages are preserved
      expect(result.map(m => m.content)).toContain('Message 6');
      expect(result.map(m => m.content)).toContain('Message 7');
      expect(result.map(m => m.content)).toContain('Message 8');
      expect(result.map(m => m.content)).toContain('Message 9');
      expect(result.map(m => m.content)).toContain('Message 10 (newest)');

      // Verify order is preserved
      expect(result[0].content).toBe('Message 6');
      expect(result[4].content).toBe('Message 10 (newest)');
    });

    it('should handle window size equal to message count', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'A', timestamp: 1000 },
        { role: 'assistant', content: 'B', timestamp: 1001 },
        { role: 'user', content: 'C', timestamp: 1002 },
      ];

      const result = pruneConversationContext(messages, 3);
      expect(result).toEqual(messages);
      expect(result.length).toBe(3);
    });

    it('should handle window size larger than message count', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'A', timestamp: 1000 },
        { role: 'assistant', content: 'B', timestamp: 1001 },
      ];

      const result = pruneConversationContext(messages, 10);
      expect(result).toEqual(messages);
      expect(result.length).toBe(2);
    });

    it('should handle null/undefined messages gracefully', () => {
      const result = pruneConversationContext(null as any, 20);
      expect(result).toEqual([]);
    });

    it('should preserve message timestamps and roles', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Msg 1', timestamp: 1000 },
        { role: 'assistant', content: 'Msg 2', timestamp: 2000 },
        { role: 'user', content: 'Msg 3', timestamp: 3000 },
        { role: 'assistant', content: 'Msg 4', timestamp: 4000 },
        { role: 'user', content: 'Msg 5', timestamp: 5000 },
      ];

      const result = pruneConversationContext(messages, 2);
      expect(result.length).toBe(2);
      expect(result[0]).toEqual(messages[3]); // Msg 4
      expect(result[1]).toEqual(messages[4]); // Msg 5
      expect(result[0].timestamp).toBe(4000);
      expect(result[1].timestamp).toBe(5000);
      expect(result[0].role).toBe('assistant');
      expect(result[1].role).toBe('user');
    });

    it('should handle large conversation (100 messages) with small window (10)', () => {
      const messages: ChatMessage[] = Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: 1000 + i,
      }));

      const result = pruneConversationContext(messages, 10);
      expect(result.length).toBe(10);
      // Should keep last 10 messages (indices 90-99)
      expect(result[0].content).toBe('Message 90');
      expect(result[9].content).toBe('Message 99');
    });

    it('should not modify original messages array', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'A', timestamp: 1000 },
        { role: 'assistant', content: 'B', timestamp: 1001 },
        { role: 'user', content: 'C', timestamp: 1002 },
        { role: 'assistant', content: 'D', timestamp: 1003 },
      ];
      const originalLength = messages.length;

      pruneConversationContext(messages, 2);
      expect(messages.length).toBe(originalLength);
    });
  });
});
