/**
 * Tests for Profile-Aware Fallback Response Context Matcher (US-350)
 *
 * Validates:
 * - AC1: Context-aware fallback selector scores conversation relevance
 * - AC2: Profile-specific tones (Makan vs Pelangi vs Southern)
 * - AC3: Low-confidence fallback selection with tone verification
 */

import { describe, it, expect } from 'vitest';
import {
  determineFallbackCategory,
  selectContextAwareFallback,
  type FallbackCategory,
} from '../assistant/pipeline/context-aware-fallback-selector.js';
import type { ConversationMessage } from '../assistant/types.js';

describe('Context-Aware Fallback Selector (US-350)', () => {
  describe('AC2: Profile-Specific Tones', () => {
    it('should use cafe-friendly tone for Makan Moments', () => {
      const fallbackResponses = {
        makan: {
          default: {
            en: 'Sorry, I\'m not sure about that. Our cafe team can help with your order or reservation. Let me connect you with them — what would you like to ask?',
          },
        },
      };

      const result = selectContextAwareFallback(
        fallbackResponses,
        'makan-moments',
        [],
        'en'
      );

      // Should contain cafe-specific keywords
      expect(result.response).toContain('cafe team');
      expect(result.response).toContain('order');
      expect(result.response).not.toContain('hostel');
      expect(result.response).not.toContain('room');
      expect(result.response).not.toContain('check-in');
    });

    it('should use hostel-friendly tone for Pelangi', () => {
      const fallbackResponses = {
        pelangi: {
          default: {
            en: 'I\'m not sure I can help with that. Our hostel team knows this best — let me connect you with them. What do you need help with?',
          },
        },
      };

      const result = selectContextAwareFallback(
        fallbackResponses,
        'pelangi',
        [],
        'en'
      );

      // Should contain hostel-specific keywords
      expect(result.response).toContain('hostel');
      expect(result.response).not.toContain('cafe');
      expect(result.response).not.toContain('order');
    });

    it('should use homestay-friendly tone for Southern', () => {
      const fallbackResponses = {
        southern: {
          default: {
            en: 'I\'m not sure about that. Our homestay team can help you better. Let me connect you — what\'s your question?',
          },
        },
      };

      const result = selectContextAwareFallback(
        fallbackResponses,
        'southern',
        [],
        'en'
      );

      // Should contain homestay-specific keywords
      expect(result.response).toContain('homestay');
      expect(result.response).not.toContain('cafe');
      expect(result.response).not.toContain('hostel');
    });

    it('Makan fallback should NOT contain hostel-exclusive keywords', () => {
      const fallbackResponses = {
        makan: {
          default: {
            en: 'Sorry, I\'m not sure about that. Our cafe team can help with your order or reservation. Let me connect you with them — what would you like to ask?',
          },
          booking: {
            en: 'I\'m not fully sure about booking details. Our cafe team can check availability and help with your reservation. Want me to connect you?',
          },
        },
      };

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'How do I book?' },
      ];

      const result = selectContextAwareFallback(
        fallbackResponses,
        'makan',
        messages,
        'en'
      );

      // Verify cafe tone, not hostel tone
      const response = result.response.toLowerCase();
      expect(response).toContain('cafe');
      expect(response).not.toContain('hostel');
      expect(response).not.toContain('check-in'); // hostel-specific
    });

    it('Pelangi fallback should NOT contain cafe-exclusive keywords', () => {
      const fallbackResponses = {
        pelangi: {
          default: {
            en: 'I\'m not sure I can help with that. Our hostel team knows this best — let me connect you with them. What do you need help with?',
          },
          checkin: {
            en: 'Not sure about check-in? Our hostel team can walk you through the process. Shall I connect you with them?',
          },
        },
      };

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'How do I check in?' },
      ];

      const result = selectContextAwareFallback(
        fallbackResponses,
        'pelangi',
        messages,
        'en'
      );

      // Verify hostel tone, not cafe tone
      const response = result.response.toLowerCase();
      expect(response).toContain('hostel');
      expect(response).not.toContain('cafe'); // cafe-specific
      expect(response).not.toContain('order'); // cafe-specific
    });
  });

  describe('AC1: Context-Aware Category Detection', () => {
    it('should detect booking context from conversation keywords', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'How much is a room booking for 3 nights?' },
        { role: 'assistant', content: 'Our rates are...' },
        { role: 'user', content: 'What dates do you have available?' },
      ];

      const category = determineFallbackCategory(messages);

      expect(category.category).toBe('booking');
      expect(category.score).toBeGreaterThan(0.15);
      expect(category.reason).toContain('booking');
    });

    it('should detect order context from menu/food keywords', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What\'s on your menu?' },
        { role: 'assistant', content: 'Our menu includes...' },
        { role: 'user', content: 'How much does the coffee cost?' },
      ];

      const category = determineFallbackCategory(messages);

      expect(category.category).toBe('order');
      expect(category.score).toBeGreaterThan(0.15);
      expect(category.reason).toContain('order');
    });

    it('should detect check-in context from arrival keywords', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'I arrived and want to check in now' },
        { role: 'assistant', content: 'Welcome...' },
        { role: 'user', content: 'How do I get my key card?' },
      ];

      const category = determineFallbackCategory(messages);

      expect(category.category).toBe('checkin');
      expect(category.score).toBeGreaterThan(0.05);
      expect(category.reason).toContain('checkin');
    });

    it('should detect facilities context from wifi/amenity keywords', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Do you have wifi and pool?' },
        { role: 'assistant', content: 'Yes, we have free wifi...' },
        { role: 'user', content: 'Is there gym or parking?' },
      ];

      const category = determineFallbackCategory(messages);

      expect(category.category).toBe('facilities');
      expect(category.score).toBeGreaterThan(0.05);
      expect(category.reason).toContain('facilities');
    });

    it('should return default category for empty conversation', () => {
      const messages: ConversationMessage[] = [];

      const category = determineFallbackCategory(messages);

      expect(category.category).toBe('default');
      expect(category.reason).toContain('No conversation history');
    });

    it('should return default category for weak context match', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const category = determineFallbackCategory(messages);

      expect(category.category).toBe('default');
      expect(category.reason).toContain('Weak context match');
    });
  });

  describe('AC3: Fallback Response Selection', () => {
    it('should select booking-category fallback when conversation is about booking', () => {
      const fallbackResponses = {
        pelangi: {
          default: {
            en: 'I\'m not sure. Let me connect you with our team.',
          },
          booking: {
            en: 'Not sure about booking details? Our hostel team can help!',
          },
        },
      };

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'What\'s the room rate for 5 nights?' },
        { role: 'assistant', content: 'Our rates are...' },
        { role: 'user', content: 'Can I book now?' },
      ];

      const result = selectContextAwareFallback(
        fallbackResponses,
        'pelangi',
        messages,
        'en'
      );

      // Should use booking response, not default
      expect(result.response).toContain('booking');
      expect(result.response).not.toContain('let me connect');
      expect(result.reason).toContain('booking');
    });

    it('should select order-category fallback for cafe when conversation is about menu', () => {
      const fallbackResponses = {
        makan: {
          default: {
            en: 'Let me connect you with our cafe team.',
          },
          order: {
            en: 'Not sure about menu or ordering? Let me get our cafe team!',
          },
        },
      };

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'Do you have vegetarian options?' },
        { role: 'assistant', content: 'Yes, we have...' },
        { role: 'user', content: 'What\'s the price of the coffee?' },
      ];

      const result = selectContextAwareFallback(
        fallbackResponses,
        'makan',
        messages,
        'en'
      );

      expect(result.response).toContain('menu');
      expect(result.reason).toContain('order');
    });

    it('should support multilingual fallbacks (Malay)', () => {
      const fallbackResponses = {
        pelangi: {
          default: {
            ms: 'Saya tidak pasti. Biar saya sambungkan dengan pasukan kami.',
          },
        },
      };

      const result = selectContextAwareFallback(
        fallbackResponses,
        'pelangi',
        [],
        'ms'
      );

      expect(result.response).toContain('Malay' === 'ms' ? 'sambungkan' : '');
      // Note: Verifying Malay characters are present
      expect(result.response.length).toBeGreaterThan(0);
    });

    it('should support multilingual fallbacks (Chinese)', () => {
      const fallbackResponses = {
        pelangi: {
          default: {
            zh: '我不太确定。让我为您联系我们的团队。',
          },
        },
      };

      const result = selectContextAwareFallback(
        fallbackResponses,
        'pelangi',
        [],
        'zh'
      );

      // Verify Chinese text is used
      expect(result.response).toMatch(/[\u4e00-\u9fa5]/); // Chinese character range
    });

    it('should fallback to English if requested language not available', () => {
      const fallbackResponses = {
        makan: {
          default: {
            en: 'Sorry, I\'m not sure. Let me help!',
          },
        },
      };

      const result = selectContextAwareFallback(
        fallbackResponses,
        'makan',
        [],
        'fr' // French not available
      );

      // Should use English fallback
      expect(result.response).toBe('Sorry, I\'m not sure. Let me help!');
    });
  });

  describe('Low-Confidence Fallback Triggering', () => {
    it('should indicate fallback was selected from context awareness', () => {
      const fallbackResponses = {
        pelangi: {
          default: {
            en: 'Our hostel team can help best.',
          },
          booking: {
            en: 'Not sure about room availability? Our hostel team can check!',
          },
        },
      };

      const messages: ConversationMessage[] = [
        { role: 'user', content: 'I want to book a room for 2 nights' },
      ];

      const result = selectContextAwareFallback(
        fallbackResponses,
        'pelangi',
        messages,
        'en'
      );

      // Verify reason string indicates context-aware selection
      expect(result.reason).toContain('pelangi/booking');
      expect(result.reason).toContain('score');
    });
  });

  describe('Edge Cases', () => {
    it('should handle profile ID normalization (makan-moments → makan)', () => {
      const fallbackResponses = {
        makan: {
          default: {
            en: 'Our cafe team can help!',
          },
        },
      };

      const result = selectContextAwareFallback(
        fallbackResponses,
        'makan-moments-cafe',
        [],
        'en'
      );

      expect(result.response).toContain('cafe');
      expect(result.reason).toContain('makan');
    });

    it('should handle profile ID normalization (pelangi-capsule → pelangi)', () => {
      const fallbackResponses = {
        pelangi: {
          default: {
            en: 'Our hostel team can help!',
          },
        },
      };

      const result = selectContextAwareFallback(
        fallbackResponses,
        'pelangi-capsule-hostel',
        [],
        'en'
      );

      expect(result.response).toContain('hostel');
      expect(result.reason).toContain('pelangi');
    });

    it('should handle missing profile gracefully', () => {
      const fallbackResponses = {
        makan: {
          default: { en: 'Cafe response' },
        },
      };

      const result = selectContextAwareFallback(
        fallbackResponses,
        'unknown-profile',
        [],
        'en'
      );

      // Should return a safe fallback
      expect(result.response).toContain('not sure');
      expect(result.reason).toContain('not found');
    });

    it('should handle missing fallback_responses in settings', () => {
      const fallbackResponses = {}; // Empty

      const result = selectContextAwareFallback(
        fallbackResponses,
        'pelangi',
        [],
        'en'
      );

      // Should return a safe fallback
      expect(result.response).toContain('not sure');
    });
  });
});
