/**
 * context-relevance.test.ts — Tests for Conversation Context Message Relevance Scorer (US-369)
 *
 * Tests embedding-based cosine similarity scoring and context filtering.
 */

import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '../assistant/types.js';
import {
  scoreMessageRelevance,
  filterContextByRelevance,
} from '../assistant/context.js';

describe('scoreMessageRelevance', () => {
  describe('old_messages_scored_low', () => {
    it('should score generic old messages low for specific intent', () => {
      const oldMessage: ChatMessage = {
        role: 'user',
        content: 'Hello there',
        timestamp: Math.floor(Date.now() / 1000) - 3600,
      };

      const score = scoreMessageRelevance(oldMessage, 'booking');
      expect(score).toBeLessThan(0.3);
    });

    it('should score irrelevant messages low regardless of freshness', () => {
      const message: ChatMessage = {
        role: 'user',
        content: 'What is the weather today',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(message, 'booking');
      expect(score).toBeLessThan(0.3);
    });

    it('should handle empty messages', () => {
      const emptyMessage: ChatMessage = {
        role: 'user',
        content: '',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(emptyMessage, 'booking');
      expect(score).toBe(0);
    });

    it('should handle whitespace-only messages', () => {
      const whitespaceMessage: ChatMessage = {
        role: 'user',
        content: '   \n\t  ',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(whitespaceMessage, 'booking');
      expect(score).toBe(0);
    });
  });

  describe('current_intent_messages_scored_high', () => {
    it('should score intent-matching messages high', () => {
      const bookingMessage: ChatMessage = {
        role: 'user',
        content: 'I want to book a room',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(bookingMessage, 'booking');
      expect(score).toBeGreaterThan(0.35);
    });

    it('should score messages with exact intent keyword very high', () => {
      const message: ChatMessage = {
        role: 'user',
        content: 'booking booking booking',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(message, 'booking');
      expect(score).toBeGreaterThan(0.7);
    });

    it('should score wifi-related messages high for wifi intent', () => {
      const wifiMessage: ChatMessage = {
        role: 'user',
        content: 'Can I get the wifi password please',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(wifiMessage, 'wifi');
      expect(score).toBeGreaterThan(0.4);
    });

    it('should score checkin-related messages high for checkin intent', () => {
      const checkinMessage: ChatMessage = {
        role: 'user',
        content: 'How do I check in',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(checkinMessage, 'checkin');
      expect(score).toBeGreaterThan(0.3);
    });

    it('should score pricing-related messages high for pricing intent', () => {
      const pricingMessage: ChatMessage = {
        role: 'user',
        content: 'What is the price per night',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(pricingMessage, 'pricing');
      expect(score).toBeGreaterThan(0.15);
    });
  });

  describe('off_topic_messages_removed', () => {
    it('should score completely off-topic messages low', () => {
      const offTopicMessage: ChatMessage = {
        role: 'user',
        content: 'What is the capital of France',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(offTopicMessage, 'booking');
      expect(score).toBeLessThan(0.3);
    });

    it('should distinguish booking intent from facilities intent', () => {
      const message: ChatMessage = {
        role: 'user',
        content: 'Can I book a room with a kitchen',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const bookingScore = scoreMessageRelevance(message, 'booking');
      const facilitiesScore = scoreMessageRelevance(message, 'facilities');

      expect(bookingScore).toBeGreaterThan(facilitiesScore);
    });

    it('should score unrelated message low even if fresh', () => {
      const message: ChatMessage = {
        role: 'user',
        content: 'Tell me a joke',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(message, 'booking');
      expect(score).toBeLessThan(0.2);
    });
  });

  describe('cosine similarity edge cases', () => {
    it('should handle messages with numbers and punctuation', () => {
      const message: ChatMessage = {
        role: 'user',
        content: 'I want to book 2 rooms for 3 nights @ $100/night!',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const score = scoreMessageRelevance(message, 'booking');
      expect(score).toBeGreaterThan(0.15);
    });

    it('should normalize case for matching', () => {
      const upperMessage: ChatMessage = {
        role: 'user',
        content: 'BOOKING PLEASE',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const lowerMessage: ChatMessage = {
        role: 'user',
        content: 'booking please',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const upperScore = scoreMessageRelevance(upperMessage, 'booking');
      const lowerScore = scoreMessageRelevance(lowerMessage, 'booking');

      expect(upperScore).toBe(lowerScore);
    });

    it('should return 0-1 range always', () => {
      const messages = [
        'booking',
        'completely unrelated text about astronomy',
        'wifi password please',
        '',
      ];

      for (const content of messages) {
        const message: ChatMessage = {
          role: 'user',
          content,
          timestamp: Math.floor(Date.now() / 1000),
        };

        const score = scoreMessageRelevance(message, 'booking');
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe('filterContextByRelevance', () => {
  it('should remove low-relevance messages below threshold', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Hello there',
        timestamp: Math.floor(Date.now() / 1000) - 1000,
      },
      {
        role: 'user',
        content: 'I want to book a room',
        timestamp: Math.floor(Date.now() / 1000) - 500,
      },
      {
        role: 'user',
        content: 'What is the weather',
        timestamp: Math.floor(Date.now() / 1000),
      },
    ];

    const filtered = filterContextByRelevance(messages, 'booking', 10, 0.3);

    // Should keep the high-relevance booking message and the most recent message
    expect(filtered.length).toBeLessThanOrEqual(messages.length);
    expect(filtered.some(m => m.content.includes('book'))).toBe(true);
  });

  it('should always keep the most recent message', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'booking booking booking',
        timestamp: Math.floor(Date.now() / 1000) - 1000,
      },
      {
        role: 'user',
        content: 'What is the capital of France',
        timestamp: Math.floor(Date.now() / 1000),
      },
    ];

    const filtered = filterContextByRelevance(messages, 'booking', 5, 0.3);

    // Most recent message should be included even if off-topic
    const lastMessage = filtered[filtered.length - 1];
    expect(lastMessage.content).toBe('What is the capital of France');
  });

  it('should maintain chronological order', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'booking one',
        timestamp: Math.floor(Date.now() / 1000) - 2000,
      },
      {
        role: 'user',
        content: 'booking two',
        timestamp: Math.floor(Date.now() / 1000) - 1000,
      },
      {
        role: 'user',
        content: 'booking three',
        timestamp: Math.floor(Date.now() / 1000),
      },
    ];

    const filtered = filterContextByRelevance(messages, 'booking', 5, 0.1);

    // Should maintain order
    for (let i = 1; i < filtered.length; i++) {
      expect(filtered[i].timestamp).toBeGreaterThanOrEqual(filtered[i - 1].timestamp);
    }
  });

  it('should return all messages if count <= topN', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'message one',
        timestamp: Math.floor(Date.now() / 1000) - 1000,
      },
      {
        role: 'user',
        content: 'message two',
        timestamp: Math.floor(Date.now() / 1000),
      },
    ];

    const filtered = filterContextByRelevance(messages, 'booking', 5, 0.3);

    expect(filtered.length).toBe(messages.length);
  });

  it('should respect topN limit', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'booking one',
        timestamp: Math.floor(Date.now() / 1000) - 3000,
      },
      {
        role: 'user',
        content: 'booking two',
        timestamp: Math.floor(Date.now() / 1000) - 2000,
      },
      {
        role: 'user',
        content: 'booking three',
        timestamp: Math.floor(Date.now() / 1000) - 1000,
      },
      {
        role: 'user',
        content: 'booking four',
        timestamp: Math.floor(Date.now() / 1000),
      },
    ];

    const filtered = filterContextByRelevance(messages, 'booking', 2, 0.1);

    // Should keep at most 2 messages (plus the most recent if not already included)
    expect(filtered.length).toBeLessThanOrEqual(3);
  });

  it('should handle empty message list', () => {
    const messages: ChatMessage[] = [];

    const filtered = filterContextByRelevance(messages, 'booking', 5, 0.3);

    expect(filtered.length).toBe(0);
  });

  it('should use custom threshold if provided', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'slightly relevant message',
        timestamp: Math.floor(Date.now() / 1000) - 1000,
      },
      {
        role: 'user',
        content: 'booking',
        timestamp: Math.floor(Date.now() / 1000),
      },
    ];

    const filtered1 = filterContextByRelevance(messages, 'booking', 5, 0.1);
    const filtered2 = filterContextByRelevance(messages, 'booking', 5, 0.8);

    // Higher threshold should result in fewer messages
    expect(filtered1.length).toBeGreaterThanOrEqual(filtered2.length);
  });

  describe('real-world conversation scenarios', () => {
    it('should filter a booking conversation properly', () => {
      const conversation: ChatMessage[] = [
        {
          role: 'user',
          content: 'Hi there',
          timestamp: Math.floor(Date.now() / 1000) - 5000,
        },
        {
          role: 'assistant',
          content: 'Welcome to our hostel',
          timestamp: Math.floor(Date.now() / 1000) - 4900,
        },
        {
          role: 'user',
          content: 'I want to book a room for 2 nights starting tomorrow',
          timestamp: Math.floor(Date.now() / 1000) - 4000,
        },
        {
          role: 'assistant',
          content: 'Great! What type of room',
          timestamp: Math.floor(Date.now() / 1000) - 3900,
        },
        {
          role: 'user',
          content: 'By the way, whats your wifi password',
          timestamp: Math.floor(Date.now() / 1000) - 2000,
        },
        {
          role: 'user',
          content: 'How much is it for 2 nights',
          timestamp: Math.floor(Date.now() / 1000) - 1000,
        },
      ];

      const filtered = filterContextByRelevance(
        conversation,
        'booking',
        5,
        0.15,
      );

      // Should keep booking-related messages and most recent
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.some(m => m.content.includes('book'))).toBe(true);
    });

    it('should preserve high-confidence conversation flow', () => {
      const conversation: ChatMessage[] = [
        {
          role: 'user',
          content: 'I need to book a room',
          timestamp: Math.floor(Date.now() / 1000) - 3000,
        },
        {
          role: 'user',
          content: 'For how many people',
          timestamp: Math.floor(Date.now() / 1000) - 2000,
        },
        {
          role: 'user',
          content: 'We are 4 guests',
          timestamp: Math.floor(Date.now() / 1000) - 1000,
        },
        {
          role: 'user',
          content: 'What is the total price',
          timestamp: Math.floor(Date.now() / 1000),
        },
      ];

      const filtered = filterContextByRelevance(
        conversation,
        'booking',
        10,
        0.2,
      );

      // Should keep most relevant messages for context continuation
      expect(filtered.length).toBeGreaterThan(2);
    });
  });
});
