import { describe, it, expect } from 'vitest';
import { scoreMessageRelevance, filterByRelevance } from '../pipeline/context-manager.js';
import type { ChatMessage } from '../types.js';

describe('Message Relevance Scoring (US-208)', () => {
  describe('scoreMessageRelevance', () => {
    it('should score messages with intent-matching keywords higher', () => {
      const message: ChatMessage = {
        role: 'user',
        content: 'I want to book a room for 3 nights',
        timestamp: Date.now()
      };

      const bookingScore = scoreMessageRelevance(message, 'booking', 5, 10);
      const wifiScore = scoreMessageRelevance(message, 'wifi', 5, 10);

      expect(bookingScore).toBeGreaterThan(wifiScore);
    });

    it('should score recent messages higher than old ones', () => {
      const message: ChatMessage = {
        role: 'user',
        content: 'book room',
        timestamp: Date.now()
      };

      const oldScore = scoreMessageRelevance(message, 'booking', 0, 10);
      const newScore = scoreMessageRelevance(message, 'booking', 9, 10);

      expect(newScore).toBeGreaterThan(oldScore);
    });

    it('should return 0 for empty messages', () => {
      const emptyMessage: ChatMessage = {
        role: 'user',
        content: '',
        timestamp: Date.now()
      };

      const score = scoreMessageRelevance(emptyMessage, 'booking', 5, 10);
      expect(score).toBe(0);
    });

    it('should clamp scores to [0, 1]', () => {
      const message: ChatMessage = {
        role: 'user',
        content: 'book room for booking on booking night booking guests booking',
        timestamp: Date.now()
      };

      const score = scoreMessageRelevance(message, 'booking', 9, 10);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('filterByRelevance', () => {
    it('should keep all messages if below threshold count', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'hello', timestamp: 1000 },
        { role: 'assistant', content: 'hi', timestamp: 1100 },
        { role: 'user', content: 'book room', timestamp: 1200 },
      ];

      const filtered = filterByRelevance(messages, 'booking', 0.3, 8);
      expect(filtered).toEqual(messages);
    });

    it('should filter out irrelevant old messages', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'old unrelated question', timestamp: 1000 },
        { role: 'assistant', content: 'old unrelated answer', timestamp: 1100 },
        { role: 'user', content: 'another old thing', timestamp: 1200 },
        { role: 'assistant', content: 'another old reply', timestamp: 1300 },
        { role: 'user', content: 'booking', timestamp: 1400 },
        { role: 'assistant', content: 'booking reply', timestamp: 1500 },
        { role: 'user', content: 'how much for booking', timestamp: 1600 },
        { role: 'assistant', content: 'pricing for booking', timestamp: 1700 },
        { role: 'user', content: 'book now', timestamp: 1800 },
        { role: 'assistant', content: 'great booking', timestamp: 1900 },
      ];

      const filtered = filterByRelevance(messages, 'booking', 0.3, 8);
      expect(filtered.length).toBeLessThanOrEqual(messages.length);
      expect(filtered).toContain(messages[8]);
      expect(filtered).toContain(messages[9]);
    });
  });

  describe('Stale Context Prevention (US-208)', () => {
    it('should exclude old extend_stay request when classifying new room_type question', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'I want to extend my stay by 2 more nights', timestamp: 1000 },
        { role: 'assistant', content: 'Sure! You can extend your stay. Additional charges apply.', timestamp: 1100 },
        { role: 'user', content: 'What dates work?', timestamp: 1200 },
        { role: 'assistant', content: 'Any dates work, prices are posted on the website', timestamp: 1300 },
        { role: 'user', content: 'Can I get WiFi?', timestamp: 1400 },
        { role: 'assistant', content: 'Yes, WiFi password is on the board', timestamp: 1500 },
        { role: 'user', content: 'Thanks!', timestamp: 1600 },
        { role: 'assistant', content: 'You welcome!', timestamp: 1700 },
        { role: 'user', content: 'One more question', timestamp: 1800 },
        { role: 'assistant', content: 'Sure, go ahead', timestamp: 1900 },
        { role: 'user', content: 'What room types are available?', timestamp: 2000 },
      ];

      const filtered = filterByRelevance(messages, 'room_type', 0.3, 8);
      const oldExtendStayMsg = messages[0];
      const shouldBeFiltered = !filtered.includes(oldExtendStayMsg);
      expect(shouldBeFiltered).toBe(true);

      const recentMsg = messages[messages.length - 1];
      expect(filtered).toContain(recentMsg);
    });

    it('should preserve booking context when filtering for booking intent', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'I want to book a room', timestamp: 1000 },
        { role: 'assistant', content: 'Great! When would you like to check in?', timestamp: 1100 },
        { role: 'user', content: 'Next Monday', timestamp: 1200 },
        { role: 'assistant', content: 'Perfect. How many nights?', timestamp: 1300 },
        { role: 'user', content: 'What is WiFi password?', timestamp: 1400 },
        { role: 'assistant', content: 'WiFi password is on the sign', timestamp: 1500 },
        { role: 'user', content: 'Is breakfast included?', timestamp: 1600 },
        { role: 'assistant', content: 'Breakfast is not included but snacks are available', timestamp: 1700 },
        { role: 'user', content: 'How many beds in a room?', timestamp: 1800 },
        { role: 'assistant', content: 'Options: single, double, or dorm with 4 beds', timestamp: 1900 },
        { role: 'user', content: 'How much for 2 nights?', timestamp: 2000 },
      ];

      const filtered = filterByRelevance(messages, 'booking', 0.3, 8);

      // Key test: messages with high-relevance booking keywords should be preserved
      // The filtered list should contain messages with booking-related content
      const bookingMessages = filtered.filter(m =>
        m.content.toLowerCase().includes('book') ||
        m.content.toLowerCase().includes('night') ||
        m.content.toLowerCase().includes('check in') ||
        m.content.toLowerCase().includes('check out')
      );
      expect(bookingMessages.length).toBeGreaterThanOrEqual(3);

      // Recent messages should always be preserved
      expect(filtered).toContain(messages[10]); // "How much for 2 nights?"
    });
  });
});
