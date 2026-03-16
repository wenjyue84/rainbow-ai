/**
 * US-1026: Off-Scope Guard — WhatsApp Business compliance mode.
 *
 * Meta bans general-purpose AI assistants on the WhatsApp Business Platform.
 * The off-scope guard blocks non-business queries and redirects them to
 * allowed business topics (bookings, check-in/out, F&B orders, hostel info, etc.).
 *
 * Tests cover:
 * - AC1: Allowed intents pass through (bookings, check-in, F&B, hostel info, cafe menu)
 * - AC2: Off-scope requests blocked with redirect (creative writing, academic, coding, etc.)
 * - AC3: Off-scope category tagging for compliance audit
 * - AC5: Off-scope query returns redirect message, not a general AI answer
 * - Business allowlist prevents false positives
 */

import { describe, it, expect } from 'vitest';
import { detectOffScope, OFF_SCOPE_REDIRECT } from '../pipeline/off-scope-guard.js';

describe('US-1026: Off-Scope Guard', () => {
  // ─── AC1: Allowed business intents pass through ─────────────────

  describe('Business-scoped queries (should NOT be blocked)', () => {
    const allowedQueries = [
      'I want to book a room for 2 nights',
      'What time is check in?',
      'How much is a capsule bed?',
      'Do you have availability tonight?',
      'Can I order nasi lemak?',
      'What is on the menu?',
      'Where is the hostel located?',
      'Is there wifi in the hostel?',
      'Hello!',
      'Thank you for the help',
      'I have a complaint about the room',
      'Any promotions this week?',
      'What are your operating hours?',
      'Can I check out late?',
      'How do I pay?',
      'Is breakfast included?',
      'Berapa harga bilik?',
      'Ada bilik kosong?',
      'Saya nak tempah bilik',
      'Do you have parking?',
      'What facilities are available?',
      'I need a towel please',
      'Boleh order teh tarik?',
    ];

    for (const query of allowedQueries) {
      it(`allows: "${query}"`, () => {
        const result = detectOffScope(query);
        expect(result.blocked).toBe(false);
      });
    }
  });

  // ─── AC2: Off-scope requests blocked ────────────────────────────

  describe('Off-scope queries (should be blocked)', () => {
    it('blocks creative writing: "write me a poem about love"', () => {
      const result = detectOffScope('write me a poem about love');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('creative_writing');
    });

    it('blocks academic: "explain quantum physics"', () => {
      const result = detectOffScope('explain quantum physics');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('academic');
    });

    it('blocks coding: "write code to sort an array"', () => {
      const result = detectOffScope('write code to sort an array');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('coding');
    });

    it('blocks personal advice: "give me life advice"', () => {
      const result = detectOffScope('give me life advice');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('personal_advice');
    });

    it('blocks entertainment: "tell me a joke"', () => {
      const result = detectOffScope('tell me a joke');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('entertainment');
    });

    it('blocks general knowledge: "what is the weather in Tokyo"', () => {
      const result = detectOffScope('what is the weather in Tokyo');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('general_knowledge');
    });

    it('blocks homework: "help me with homework"', () => {
      const result = detectOffScope('help me with homework');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('academic');
    });

    it('blocks general assistant: "who is the president of USA"', () => {
      const result = detectOffScope('who is the president of USA');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('general_knowledge');
    });
  });

  // ─── AC3: Category tagging for audit ────────────────────────────

  describe('Off-scope category classification', () => {
    it('categorizes "write a story" as creative_writing', () => {
      const result = detectOffScope('write a story about a dragon');
      expect(result.category).toBe('creative_writing');
    });

    it('categorizes "solve this equation" as academic', () => {
      const result = detectOffScope('solve this equation x^2 + 3x = 0');
      expect(result.category).toBe('academic');
    });

    it('categorizes "write python script" as coding', () => {
      const result = detectOffScope('write python script to download files');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('coding');
    });

    it('categorizes "tell me my horoscope" as personal_advice', () => {
      const result = detectOffScope('tell me my horoscope');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('personal_advice');
    });

    it('categorizes "play a game with me" as entertainment', () => {
      const result = detectOffScope('play a game with me');
      expect(result.blocked).toBe(true);
      expect(result.category).toBe('entertainment');
    });

    it('returns null category for allowed queries', () => {
      const result = detectOffScope('I want to book a room');
      expect(result.category).toBeNull();
    });
  });

  // ─── Business allowlist overrides off-scope patterns ────────────

  describe('Business allowlist priority', () => {
    it('allows "write me a booking confirmation" (contains "write me a" but also "booking")', () => {
      const result = detectOffScope('write me a booking confirmation');
      expect(result.blocked).toBe(false);
    });

    it('allows "help me with check in" (contains "help me with" but also "check in")', () => {
      const result = detectOffScope('help me with check in');
      expect(result.blocked).toBe(false);
    });

    it('allows "what is the price of a room" (contains "what is the" but also "price")', () => {
      const result = detectOffScope('what is the price of a room');
      expect(result.blocked).toBe(false);
    });

    it('allows "how do I order food" (business context)', () => {
      const result = detectOffScope('how do I order food');
      expect(result.blocked).toBe(false);
    });
  });

  // ─── AC5: Redirect messages exist for all supported languages ───

  describe('Redirect messages', () => {
    it('has redirect message for English', () => {
      expect(OFF_SCOPE_REDIRECT.en).toBeDefined();
      expect(OFF_SCOPE_REDIRECT.en).toContain('Pelangi');
    });

    it('has redirect message for Malay', () => {
      expect(OFF_SCOPE_REDIRECT.ms).toBeDefined();
      expect(OFF_SCOPE_REDIRECT.ms).toContain('Pelangi');
    });

    it('has redirect message for Chinese', () => {
      expect(OFF_SCOPE_REDIRECT.zh).toBeDefined();
      expect(OFF_SCOPE_REDIRECT.zh).toContain('Pelangi');
    });

    it('has redirect message for Tamil', () => {
      expect(OFF_SCOPE_REDIRECT.ta).toBeDefined();
      expect(OFF_SCOPE_REDIRECT.ta).toContain('Pelangi');
    });
  });

  // ─── Case insensitivity ─────────────────────────────────────────

  describe('Case insensitivity', () => {
    it('blocks "WRITE ME A POEM" (uppercase)', () => {
      const result = detectOffScope('WRITE ME A POEM');
      expect(result.blocked).toBe(true);
    });

    it('blocks "Tell Me A Joke" (title case)', () => {
      const result = detectOffScope('Tell Me A Joke');
      expect(result.blocked).toBe(true);
    });

    it('allows "BOOK A ROOM" (uppercase business query)', () => {
      const result = detectOffScope('BOOK A ROOM');
      expect(result.blocked).toBe(false);
    });
  });

  // ─── Custom patterns and allowlist ──────────────────────────────

  describe('Custom patterns and allowlist', () => {
    it('uses custom patterns when provided', () => {
      const customPatterns = [
        { pattern: 'custom blocked phrase', category: 'academic' as const },
      ];
      const result = detectOffScope('this contains custom blocked phrase here', customPatterns);
      expect(result.blocked).toBe(true);
    });

    it('extends allowlist with custom keywords', () => {
      const result = detectOffScope('tell me a joke about ninso milktea', undefined, ['ninso']);
      expect(result.blocked).toBe(false);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('allows empty string', () => {
      const result = detectOffScope('');
      expect(result.blocked).toBe(false);
    });

    it('allows very short input "hi"', () => {
      const result = detectOffScope('hi');
      expect(result.blocked).toBe(false);
    });

    it('returns matchedPattern on block', () => {
      const result = detectOffScope('write me a poem');
      expect(result.matchedPattern).toBe('write me a');
    });

    it('returns null matchedPattern on allow', () => {
      const result = detectOffScope('I want to check in');
      expect(result.matchedPattern).toBeNull();
    });
  });
});
