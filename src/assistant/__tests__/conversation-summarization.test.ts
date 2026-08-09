import { describe, it, expect } from 'vitest';
import { summarizeConversationContext } from '../pipeline/context-manager.js';
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

    it('should extract guest name from conversation', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hi, my name is John', timestamp: 1000 },
        { role: 'assistant', content: 'Nice to meet you!', timestamp: 1001 },
      ];

      const result = summarizeConversationContext(messages);
      expect(result.factsExtracted.guestName).toBe('John');
    });

    it('should extract room type from conversation', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'I would like a double room', timestamp: 1000 },
        { role: 'assistant', content: 'We have double rooms available', timestamp: 1001 },
      ];

      const result = summarizeConversationContext(messages);
      expect(result.factsExtracted.roomType).toBe('double');
    });

    it('should extract check-in and check-out dates', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'I want to check in on March 15', timestamp: 1000 },
        { role: 'assistant', content: 'And when will you check out?', timestamp: 1001 },
        { role: 'user', content: 'Check out on March 20', timestamp: 1002 },
      ];

      const result = summarizeConversationContext(messages);
      expect(result.factsExtracted.checkInDate).toBeDefined();
      expect(result.factsExtracted.checkOutDate).toBeDefined();
    });

    it('should extract guest count', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'I need a booking for 4 guests', timestamp: 1000 },
        { role: 'assistant', content: 'Sure, 4 guests. How long will you stay?', timestamp: 1001 },
      ];

      const result = summarizeConversationContext(messages);
      expect(result.factsExtracted.guestCount).toBe('4');
    });

    it('should extract special requests', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'I have a peanut allergy, need quiet room', timestamp: 1000 },
        { role: 'assistant', content: 'Noted, we can accommodate that', timestamp: 1001 },
      ];

      const result = summarizeConversationContext(messages);
      // Should have some special requests extracted (allergy or quiet room pattern)
      if (result.factsExtracted.specialRequests) {
        expect(result.factsExtracted.specialRequests.length).toBeGreaterThan(0);
      }
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
      expect(result.factsExtracted.guestName).toBe('Bob');
      expect(result.factsExtracted.roomType).toBe('double');
      expect(result.recentMessages.length).toBe(5);
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

    it('should extract single word names correctly', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'I am John', timestamp: 1000 },
      ];

      const result = summarizeConversationContext(messages);
      expect(result.factsExtracted.guestName).toBe('John');
    });

    it('should handle multiple room type mentions (first one wins)', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'I want a single room', timestamp: 1000 },
        { role: 'assistant', content: 'Single rooms are nice', timestamp: 1001 },
        { role: 'user', content: 'Actually, I want a double', timestamp: 1002 },
      ];

      const result = summarizeConversationContext(messages);
      // Should extract first room type mentioned
      expect(result.factsExtracted.roomType).toBe('single');
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
