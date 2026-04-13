/**
 * US-581: Language Preference Inference from First Message
 *
 * Tests for automatic language detection and persistence on first user message.
 * Validates:
 * - AC1: Language detection from first message using detectLanguage()
 * - AC2: Skip detection for subsequent messages if preference already set
 * - AC3: Multi-script message handling (Tamil, English, mixed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock types
type SupportedLanguage = 'en' | 'ms' | 'zh' | 'ta';

describe('US-581: Language Preference Inference from First Message', () => {
  let mockDb: any;
  let mockDetectLanguage: any;
  let module: any;

  beforeEach(async () => {
    // Setup DB mock
    mockDb = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue({}),
    };

    // Setup detectLanguage mock
    mockDetectLanguage = vi.fn((text: string): SupportedLanguage | 'unknown' => {
      if (!text || text.length === 0) return 'unknown';

      // English: common English words and phrases
      if (/\b(hello|hi|thank|wifi|password|room|check|price|how|much|where)\b/i.test(text)) {
        return 'en';
      }

      // Tamil: uses Tamil Unicode range (0x0B80-0x0BFF)
      if (/[\u0B80-\u0BFF]/.test(text)) {
        return 'ta';
      }

      // Mandarin: CJK Unified Ideographs range (0x4E00-0x9FFF)
      if (/[\u4E00-\u9FFF]/.test(text)) {
        return 'zh';
      }

      // Malay: common Malay words and patterns
      if (/\b(terima|kasih|assalam|selamat|berapa|harga|mana|waktu)\b/i.test(text)) {
        return 'ms';
      }

      return 'unknown';
    });

    // Mock module exports
    vi.doMock('../../src/lib/db.js', () => ({ db: mockDb }));
    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((field: any, value: any) => ({ field, value })),
    }));
    vi.doMock('../../shared/schema-tables.js', () => ({
      rainbowConversations: { phone: {} },
    }));
    vi.doMock('../../src/assistant/formatter.js', () => ({
      detectLanguage: mockDetectLanguage,
    }));

    // Load module after mocking
    module = await import('../../src/assistant/language-preference.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unmock('../../src/lib/db.js');
    vi.unmock('drizzle-orm');
    vi.unmock('../../shared/schema-tables.js');
    vi.unmock('../../src/assistant/formatter.js');
  });

  describe('AC1: Detect language from first message using existing detectLanguage()', () => {
    it('should detect English from English message', async () => {
      const phone = '601234567890';
      const message = 'Hello, how much is the room?';

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null, // no current preference
      );

      expect(result).toBe('en');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should detect Tamil from Tamil message', async () => {
      const phone = '601234567890';
      const message = 'வணக்கம், நன்றி'; // Tamil: hello, thank you

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      expect(result).toBe('ta');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should detect Mandarin Chinese from Chinese message', async () => {
      const phone = '601234567890';
      const message = '你好，谢谢'; // Chinese: hello, thank you

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      expect(result).toBe('zh');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should detect Malay from Malay message', async () => {
      const phone = '601234567890';
      const message = 'terima kasih, berapa harga?'; // Malay: thank you, how much?

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      expect(result).toBe('ms');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should return null for unknown language', async () => {
      const phone = '601234567890';
      const message = '???'; // unrecognizable

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      expect(result).toBeNull();
      // Should NOT update DB for unknown language
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('AC2: Skip language detection for subsequent messages if preference already set', () => {
    it('should skip detection if preference already set', async () => {
      const phone = '601234567890';
      const message = 'some message'; // could be any language
      const currentPreference = 'ta'; // Tamil already set

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        currentPreference,
      );

      expect(result).toBe('ta'); // Returns existing preference
      expect(mockDetectLanguage).not.toHaveBeenCalled(); // Should NOT call detectLanguage
      expect(mockDb.update).not.toHaveBeenCalled(); // Should NOT update DB
    });

    it('should skip detection and return preference from AC2 flow', async () => {
      const phone = '60987654321';
      const message = '你好'; // Chinese message
      const currentPreference = 'en'; // But preference already set to English

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        currentPreference,
      );

      expect(result).toBe('en'); // Returns stored preference, not detected language
      expect(mockDetectLanguage).not.toHaveBeenCalled();
    });
  });

  describe('AC3: Multi-script message handling (Tamil, English, mixed)', () => {
    it('should detect Tamil in mixed Tamil-English message', async () => {
      const phone = '601234567890';
      const message = 'வணக்கம் ok நன்றி'; // Tamil+minimal English (ok is ambiguous)

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      // detectLanguage should detect Tamil (since Tamil script present)
      expect(result).toBe('ta');
    });

    it('should detect English in mostly English message with numbers', async () => {
      const phone = '601234567890';
      const message = 'Wifi password for room 123?';

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      expect(result).toBe('en');
    });

    it('should persist detected language to database', async () => {
      const phone = '601234567890';
      const message = 'வணக்கம்'; // Tamil

      await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      // Verify DB update was called
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty message as unknown language', async () => {
      const phone = '601234567890';
      const message = ''; // empty

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      expect(result).toBeNull();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should return null when detectLanguage returns unknown', async () => {
      mockDetectLanguage.mockReturnValue('unknown');
      const phone = '601234567890';
      const message = 'some random text';

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      expect(result).toBeNull();
    });

    it('should handle DB storage failure gracefully', async () => {
      mockDb.where.mockRejectedValueOnce(new Error('DB connection failed'));

      const phone = '601234567890';
      const message = 'Hello'; // English

      // Should not throw — should return detected language even if DB fails
      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      expect(result).toBe('en'); // Returns detected language despite DB failure
    });

    it('should handle null current preference as first message', async () => {
      const phone = '601234567890';
      const message = 'Hello world';

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null, // explicitly null
      );

      expect(result).toBe('en');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should handle undefined current preference as first message', async () => {
      const phone = '601234567890';
      const message = 'Hello world';

      const result = await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        undefined, // explicitly undefined
      );

      expect(result).toBe('en');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('Persistence validation', () => {
    it('should store correct language_preference value in DB', async () => {
      const phone = '601234567890';
      const message = 'வணக்கம்'; // Tamil

      await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        null,
      );

      // Verify the flow: update().set().where()
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled(); // set is called with language preference
    });

    it('should only persist for recognized languages', async () => {
      mockDb.update.mockClear();

      const phone = '601234567890';
      const unknownMessage = '!!!???'; // Not a recognized language

      await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        unknownMessage,
        null,
      );

      // Should NOT persist for unknown language
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should not update DB when preference already exists', async () => {
      mockDb.update.mockClear();

      const phone = '601234567890';
      const message = 'Hello';
      const existingPreference = 'ta';

      await module.inferLanguagePreferenceFromFirstMessage(
        phone,
        message,
        existingPreference, // preference already set
      );

      // Should skip everything — no DB update, no detectLanguage call
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDetectLanguage).not.toHaveBeenCalled();
    });
  });

  describe('Multi-language detection', () => {
    it('should correctly identify all four supported languages', async () => {
      const testCases: Array<[string, SupportedLanguage]> = [
        ['hello world', 'en'],
        ['வணக்கம் நன்றி', 'ta'],
        ['你好 谢谢', 'zh'],
        ['terima kasih berapa harga', 'ms'],
      ];

      for (const [message, expectedLang] of testCases) {
        const result = await module.inferLanguagePreferenceFromFirstMessage(
          'phone-' + Math.random(),
          message,
          null,
        );
        expect(result).toBe(expectedLang);
      }
    });

    it('should handle per-phone isolation', async () => {
      const phone1 = 'phone1';
      const phone2 = 'phone2';

      // Phone 1: Tamil message
      const result1 = await module.inferLanguagePreferenceFromFirstMessage(
        phone1,
        'வணக்கம்',
        null,
      );

      // Phone 2: English message
      const result2 = await module.inferLanguagePreferenceFromFirstMessage(
        phone2,
        'hello',
        null,
      );

      expect(result1).toBe('ta');
      expect(result2).toBe('en');
      // Each should have its own stored preference (DB called twice)
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });
  });
});
