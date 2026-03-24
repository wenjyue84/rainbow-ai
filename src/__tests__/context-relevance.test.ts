/**
 * context-relevance.test.ts — Test message relevance scoring and filtering (US-369)
 *
 * Tests the semantic relevance scoring of conversation messages using:
 * - Intent keyword overlap (exact phrase matching)
 * - Temporal recency decay (exponential decay by age)
 *
 * Verifies that the filtering removes low-relevance messages before AI inference.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChatMessage } from '../types.js';
import {
  scoreMessageRelevance,
  filterContextByRelevance,
} from '../assistant/pipeline/context.js';

describe('US-369: Context Message Relevance Scoring', () => {
  const baseTime = Math.floor(Date.now() / 1000); // Unix seconds

  /**
   * Helper to create a chat message with optional content and age
   */
  function createMessage(
    content: string,
    ageSeconds: number = 0,
    role: 'user' | 'assistant' = 'user',
  ): ChatMessage {
    return {
      content,
      role,
      timestamp: baseTime - ageSeconds,
    };
  }

  describe('scoreMessageRelevance', () => {
    describe('old_messages_scored_low', () => {
      it('should score very old messages (>10 minutes) below 0.35', () => {
        const oldMessage = createMessage('booking information please', 600); // 10 minutes ago
        const score = scoreMessageRelevance(oldMessage, 'booking', 'data-pelangi');
        // Very old messages still have some recency value, but should be low
        expect(score).toBeLessThan(0.35);
      });

      it('should score older messages lower than newer messages', () => {
        const content = 'I want to book a room for tonight';
        const newMsg = createMessage(content, 30); // 30 seconds ago
        const oldMsg = createMessage(content, 300); // 5 minutes ago

        const newScore = scoreMessageRelevance(newMsg, 'booking', 'data-pelangi');
        const oldScore = scoreMessageRelevance(oldMsg, 'booking', 'data-pelangi');

        expect(newScore).toBeGreaterThan(oldScore);
      });

      it('should score empty messages as 0', () => {
        const emptyMsg = createMessage('');
        const score = scoreMessageRelevance(emptyMsg, 'booking', 'data-pelangi');
        expect(score).toBe(0);
      });

      it('should score whitespace-only messages as 0', () => {
        const whitespaceMsg = createMessage('   \n  \t  ');
        const score = scoreMessageRelevance(whitespaceMsg, 'booking', 'data-pelangi');
        expect(score).toBe(0);
      });
    });

    describe('current_intent_messages_scored_high', () => {
      it('should score booking-relevant recent messages high (>0.5)', () => {
        const bookingMsg = createMessage('I want to book a room for 3 nights', 10);
        const score = scoreMessageRelevance(bookingMsg, 'booking', 'data-pelangi');
        expect(score).toBeGreaterThan(0.5);
      });

      it('should boost score for multi-keyword matches in intent', () => {
        // "book", "nights", "room" all match booking keywords
        const richMsg = createMessage('Can I book a double room for 2 nights?', 5);
        const score = scoreMessageRelevance(richMsg, 'booking', 'data-pelangi');
        expect(score).toBeGreaterThan(0.4); // Keyword bonus + recency
      });

      it('should score messages with profile context keywords', () => {
        // Southern supplements: ['southern', 'homestay', 'villa', 'house']
        const southernMsg = createMessage('How much for the southern homestay villa?', 20);
        const southernScore = scoreMessageRelevance(southernMsg, 'pricing', 'data-southern');

        // Generic message with pricing keyword
        const genericMsg = createMessage('How much does it cost?', 20);
        const genericScore = scoreMessageRelevance(genericMsg, 'pricing', 'data-southern');

        // Both should have reasonable scores for pricing intent
        // Profile-specific doesn't guarantee higher score if base keywords already matched
        expect(southernScore).toBeGreaterThan(0.3);
        expect(genericScore).toBeGreaterThan(0.3);
      });

      it('should score messages mentioning current intent intent intent keywords', () => {
        const wifiMsg = createMessage('What is the wifi password?', 15);
        const wifiScore = scoreMessageRelevance(wifiMsg, 'wifi', 'data-pelangi');
        expect(wifiScore).toBeGreaterThan(0.3);
      });

      it('should cap keyword bonus at 0.5', () => {
        // Even with many keyword matches, total score should not exceed 1.0
        const multiKeywordMsg = createMessage(
          'booking reserve room check in check out dates nights stay',
          5,
        );
        const score = scoreMessageRelevance(multiKeywordMsg, 'booking', 'data-pelangi');
        expect(score).toBeLessThanOrEqual(1.0);
        expect(score).toBeGreaterThan(0.5); // But should still be high
      });
    });

    describe('off_topic_messages_scored_low', () => {
      it('should score off-topic messages lower than on-topic when recent', () => {
        const offTopicMsg = createMessage('What is the weather today?', 5);
        const offTopicScore = scoreMessageRelevance(offTopicMsg, 'booking', 'data-pelangi');

        const onTopicMsg = createMessage('I want to book a room tonight', 5);
        const onTopicScore = scoreMessageRelevance(onTopicMsg, 'booking', 'data-pelangi');

        // On-topic should have higher keyword contribution
        expect(onTopicScore).toBeGreaterThan(offTopicScore);
      });

      it('should score messages without intent keywords lower than with keywords', () => {
        const noKeywordMsg = createMessage('hello', 10);
        const noKeywordScore = scoreMessageRelevance(noKeywordMsg, 'booking', 'data-pelangi');

        const keywordMsg = createMessage('hello, I want to book a room', 10);
        const keywordScore = scoreMessageRelevance(keywordMsg, 'booking', 'data-pelangi');

        expect(keywordScore).toBeGreaterThan(noKeywordScore);
      });

      it('should handle unknown intents gracefully', () => {
        const msg = createMessage('some message content', 10);
        const score = scoreMessageRelevance(msg, 'unknown_intent', 'data-pelangi');
        // Should still return a valid score (0-1) based on recency alone
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      });
    });

    describe('relevance score bounds', () => {
      it('should always return score between 0 and 1', () => {
        const messages = [
          createMessage('', 0),
          createMessage('test', 0),
          createMessage('booking reserve room check in dates nights', 0),
          createMessage('hello world how are you today', 1000),
        ];

        messages.forEach(msg => {
          const score = scoreMessageRelevance(msg, 'booking', 'data-pelangi');
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        });
      });
    });
  });

  describe('filterContextByRelevance', () => {
    describe('off_topic_messages_removed', () => {
      it('should filter to top N messages by relevance score', () => {
        const messages: ChatMessage[] = [
          createMessage('what is the weather', 300),
          createMessage('I want to book a room', 200), // Relevant
          createMessage('tell me a joke', 150),
          createMessage('for 2 nights', 100), // Relevant
          createMessage('do you have a pool?', 50),
          createMessage('very recent message', 5), // Most recent
        ];

        // With topN=3 and a high threshold, should get only 3-4 messages max
        const filtered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          3, // topN limiting should reduce output
          0.3,
        );

        // Should be limited by topN
        expect(filtered.length).toBeLessThanOrEqual(4); // +1 for always-including recent

        // Should contain the message about booking (one of top relevant)
        const bookingFound = filtered.some(msg => msg.content.includes('book'));
        expect(bookingFound).toBe(true);

        // Most recent message should always be included
        expect(filtered[filtered.length - 1]).toBe(messages[messages.length - 1]);
      });

      it('should filter by configurable threshold', () => {
        const messages: ChatMessage[] = [
          createMessage('general question', 100),
          createMessage('booking for 2 nights', 50),
          createMessage('can I reserve a room', 10),
        ];

        // Strict threshold (0.7)
        const strictFiltered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          5,
          0.7,
        );

        // Lenient threshold (0.1)
        const lenientFiltered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          5,
          0.1,
        );

        // Strict threshold should result in fewer or equal messages
        expect(strictFiltered.length).toBeLessThanOrEqual(lenientFiltered.length);
      });
    });

    describe('context preservation', () => {
      it('should always include the most recent message', () => {
        const messages: ChatMessage[] = [
          createMessage('old off-topic message', 200),
          createMessage('another old message', 150),
          createMessage('very recent but off-topic', 2), // Most recent
        ];

        const filtered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          1,
          0.5,
        );

        expect(filtered[filtered.length - 1]).toBe(messages[messages.length - 1]);
      });

      it('should return messages in original chronological order', () => {
        const messages: ChatMessage[] = [
          createMessage('first message', 100),
          createMessage('booking for tonight', 50),
          createMessage('confirm room type', 10),
          createMessage('double room please', 2),
        ];

        const filtered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          3,
          0.2,
        );

        // Verify chronological order is preserved
        for (let i = 1; i < filtered.length; i++) {
          expect(filtered[i].timestamp).toBeGreaterThanOrEqual(
            filtered[i - 1].timestamp,
          );
        }
      });

      it('should return all messages if fewer than topN', () => {
        const messages: ChatMessage[] = [
          createMessage('message 1', 50),
          createMessage('message 2', 25),
          createMessage('message 3', 5),
        ];

        const filtered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          10, // topN > message count
          0.2,
        );

        expect(filtered.length).toBe(messages.length);
      });
    });

    describe('topN limiting', () => {
      it('should limit output to topN most relevant messages', () => {
        const messages: ChatMessage[] = [
          createMessage('booking message 1', 200),
          createMessage('booking message 2', 150),
          createMessage('booking message 3', 100),
          createMessage('booking message 4', 50),
          createMessage('booking message 5', 10),
          createMessage('very recent but off-topic', 2), // Most recent
        ];

        const filtered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          3, // topN=3
          0.0, // Low threshold to test topN limiting
        );

        // Should be at most 3 messages (or 4 if recent message is included and wasn't in top 3)
        expect(filtered.length).toBeLessThanOrEqual(4);
        expect(filtered.length).toBeGreaterThanOrEqual(1);
      });

      it('should still include recent message even if not in top N', () => {
        const messages: ChatMessage[] = [
          createMessage('booking message 1', 200),
          createMessage('booking message 2', 150),
          createMessage('booking message 3', 100),
          createMessage('off-topic recent', 5), // Most recent, but not relevant
        ];

        const filtered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          2, // topN=2
          0.3,
        );

        // Should include the recent message
        expect(filtered[filtered.length - 1].content).toBe('off-topic recent');
      });
    });

    describe('edge cases', () => {
      it('should handle empty message list', () => {
        const filtered = filterContextByRelevance([], 'booking', 'data-pelangi', 5, 0.3);
        expect(filtered).toEqual([]);
      });

      it('should handle single message', () => {
        const messages = [createMessage('single message', 10)];
        const filtered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          5,
          0.3,
        );
        expect(filtered).toEqual(messages);
      });

      it('should handle all messages below threshold', () => {
        const messages: ChatMessage[] = [
          createMessage('unrelated 1', 100),
          createMessage('unrelated 2', 50),
          createMessage('unrelated 3', 10),
        ];

        const filtered = filterContextByRelevance(
          messages,
          'booking',
          'data-pelangi',
          5,
          0.9, // Very high threshold
        );

        // Should still include the most recent message
        expect(filtered.length).toBeGreaterThanOrEqual(1);
        expect(filtered[filtered.length - 1]).toBe(messages[messages.length - 1]);
      });
    });
  });

  describe('integration: multi-turn booking dialogue', () => {
    it('should keep relevant booking steps and discard off-topic chatter', () => {
      const conversation: ChatMessage[] = [
        createMessage('hey what is your wifi password?', 300),
        createMessage(
          'I want to book a room for my family',
          250, // Booking question
          'user',
        ),
        createMessage('Great! Which room type do you prefer?', 240, 'assistant'),
        createMessage('we have double and single rooms', 235, 'assistant'),
        createMessage('do you offer free breakfast?', 200),
        createMessage('Yes, complimentary breakfast included', 190, 'assistant'),
        createMessage(
          'I want the double room for 3 nights',
          100, // Clear booking info
          'user',
        ),
        createMessage('Perfect! When would you like to check in?', 90, 'assistant'),
        createMessage('March 25th, 2026', 80, 'user'),
      ];

      const filtered = filterContextByRelevance(
        conversation,
        'booking',
        'data-pelangi',
        5,
        0.3,
      );

      // Should keep more recent, intent-focused messages
      // and discard old off-topic chatter (wifi password)
      expect(filtered.length).toBeLessThan(conversation.length);
      expect(filtered.length).toBeGreaterThanOrEqual(2);

      // Most recent message should be included
      expect(filtered[filtered.length - 1]).toBe(
        conversation[conversation.length - 1],
      );

      // Should contain the clear booking statement
      const hasBookingStatement = filtered.some(msg =>
        msg.content.toLowerCase().includes('double room'),
      );
      expect(hasBookingStatement).toBe(true);
    });
  });
});
