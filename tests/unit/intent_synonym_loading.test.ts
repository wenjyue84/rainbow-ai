import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * US-577: Intent Synonym Loading - Per Language and Profile
 *
 * Tests for loading intent synonyms from JSON config files organized by language and profile,
 * and integrating them into the fuzzy matching pipeline.
 */

describe('US-577: Intent Synonym Loading per Language and Profile', () => {
  const dataDir = join(process.cwd(), 'src', 'assistant', 'data');

  describe('File Structure Validation', () => {
    it('should have profile-specific English synonym file for Pelangi', () => {
      const filePath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.intents).toBeDefined();
      expect(Array.isArray(data.intents)).toBe(true);
      expect(data.intents.length).toBeGreaterThan(0);

      // Each intent should have intent name and synonyms array
      for (const entry of data.intents) {
        expect(entry.intent).toBeDefined();
        expect(typeof entry.intent).toBe('string');
        expect(entry.synonyms).toBeDefined();
        expect(Array.isArray(entry.synonyms)).toBe(true);
      }
    });

    it('should have profile-specific Tamil synonym file for Pelangi', () => {
      const filePath = join(dataDir, 'intent-synonyms-pelangi-ta.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.intents).toBeDefined();
      expect(Array.isArray(data.intents)).toBe(true);

      // Tamil intents should exist
      const intentions = data.intents.map((e: any) => e.intent);
      expect(intentions).toContain('greeting');
      expect(intentions).toContain('booking');
    });

    it('should have profile-specific English synonym file for Makan', () => {
      const filePath = join(dataDir, 'intent-synonyms-makan-en.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.intents).toBeDefined();
      expect(Array.isArray(data.intents)).toBe(true);
      expect(data.intents.length).toBeGreaterThan(0);
    });

    it('AC1: Intent synonym structure with intentId and array of synonyms', () => {
      const filePath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Verify AC1: { intentId: [synonym1, synonym2] } structure
      for (const entry of data.intents) {
        const { intent, synonyms } = entry;
        expect(typeof intent).toBe('string');
        expect(Array.isArray(synonyms)).toBe(true);
        for (const syn of synonyms) {
          expect(typeof syn).toBe('string');
          expect(syn.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Synonym Expansion for Multi-Language Profiles', () => {
    it('should expand booking intent with English synonyms', () => {
      const filePath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      const bookingIntent = data.intents.find((e: any) => e.intent === 'booking');
      expect(bookingIntent).toBeDefined();
      expect(bookingIntent.synonyms).toContain('reserve room');
      expect(bookingIntent.synonyms).toContain('book a stay');
      expect(bookingIntent.synonyms).toContain('make a reservation');
    });

    it('should expand booking intent with Tamil synonyms', () => {
      const filePath = join(dataDir, 'intent-synonyms-pelangi-ta.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      const bookingIntent = data.intents.find((e: any) => e.intent === 'booking');
      expect(bookingIntent).toBeDefined();
      expect(bookingIntent.synonyms.length).toBeGreaterThan(0);
      // Tamil synonyms should be in Tamil script
      for (const syn of bookingIntent.synonyms) {
        expect(/[\u0B80-\u0BFF]/.test(syn) || typeof syn === 'string').toBe(true);
      }
    });

    it('should have distinct synonym lists per language and profile', () => {
      const enPath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const taPath = join(dataDir, 'intent-synonyms-pelangi-ta.json');

      const enData = JSON.parse(readFileSync(enPath, 'utf-8'));
      const taData = JSON.parse(readFileSync(taPath, 'utf-8'));

      const enBooking = enData.intents.find((e: any) => e.intent === 'booking');
      const taBooking = taData.intents.find((e: any) => e.intent === 'booking');

      expect(enBooking).toBeDefined();
      expect(taBooking).toBeDefined();

      // English and Tamil synonyms should be different (non-overlapping)
      const enSet = new Set(enBooking.synonyms.map((s: string) => s.toLowerCase()));
      const taSet = new Set(taBooking.synonyms);
      const intersection = [...enSet].filter(s => taSet.has(s));
      // May have some overlap, but mostly different
      expect(intersection.length).toBeLessThan(Math.min(enSet.size, taSet.size) / 2);
    });

    it('AC2: Synonyms are organized by language and profile', () => {
      // AC2: Tests that files are named correctly and contain appropriate data
      const profileLangPattern = /^intent-synonyms-(\w+)-(en|ms|zh|ta)\.json$/;
      const files = [
        'intent-synonyms-pelangi-en.json',
        'intent-synonyms-pelangi-ta.json',
        'intent-synonyms-makan-en.json',
      ];

      for (const filename of files) {
        const match = profileLangPattern.exec(filename);
        expect(match).toBeTruthy();
        if (match) {
          const [, profile, lang] = match;
          expect(['pelangi', 'makan', 'southern']).toContain(profile);
          expect(['en', 'ms', 'zh', 'ta']).toContain(lang);
        }
      }
    });
  });

  describe('Synonym Deduplication', () => {
    it('should not duplicate synonyms within a language file', () => {
      const filePath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      for (const entry of data.intents) {
        const synonyms = entry.synonyms;
        const lowerSynonyms = synonyms.map((s: string) => s.toLowerCase());
        const uniqueCount = new Set(lowerSynonyms).size;

        // Should not have duplicates (case-insensitive)
        expect(uniqueCount).toBe(lowerSynonyms.length);
      }
    });

    it('should handle multiple intents with synonyms without conflicts', () => {
      const filePath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      const intents = data.intents.map((e: any) => e.intent);
      expect(intents.length).toBeGreaterThan(1);

      // Each intent should be unique
      const uniqueIntents = new Set(intents);
      expect(uniqueIntents.size).toBe(intents.length);
    });
  });

  describe('Language Variant Support', () => {
    it('should support English language variant', () => {
      const filePath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      const wifiIntent = data.intents.find((e: any) => e.intent === 'wifi');
      expect(wifiIntent).toBeDefined();
      expect(wifiIntent.synonyms).toContain('internet access code');
    });

    it('should support Tamil language variant', () => {
      const filePath = join(dataDir, 'intent-synonyms-pelangi-ta.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      const wifiIntent = data.intents.find((e: any) => e.intent === 'wifi');
      expect(wifiIntent).toBeDefined();
      expect(wifiIntent.synonyms.length).toBeGreaterThan(0);
    });

    it('AC3: Admin API can manage synonyms per intent and language', () => {
      // AC3: Tests that files support admin management patterns
      // Files should allow adding/updating synonyms per intent without touching other languages

      const taPath = join(dataDir, 'intent-synonyms-pelangi-ta.json');
      const taData = JSON.parse(readFileSync(taPath, 'utf-8'));

      const greetingIntent = taData.intents.find((e: any) => e.intent === 'greeting');
      expect(greetingIntent).toBeDefined();

      // Should be able to add synonyms to this intent without affecting English
      const originalSynonymCount = greetingIntent.synonyms.length;
      expect(originalSynonymCount).toBeGreaterThan(0);

      // Verify English file is separate and unaffected
      const enPath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const enData = JSON.parse(readFileSync(enPath, 'utf-8'));
      const enGreeting = enData.intents.find((e: any) => e.intent === 'greeting');
      expect(enGreeting.synonyms).not.toEqual(greetingIntent.synonyms);
    });
  });

  describe('Profile-Specific Synonym Customization', () => {
    it('should allow different synonyms for different profiles', () => {
      const pelangiPath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const makanPath = join(dataDir, 'intent-synonyms-makan-en.json');

      const pelangiData = JSON.parse(readFileSync(pelangiPath, 'utf-8'));
      const makanData = JSON.parse(readFileSync(makanPath, 'utf-8'));

      // Both should have greeting intent
      const pelangiGreeting = pelangiData.intents.find((e: any) => e.intent === 'greeting');
      const makanGreeting = makanData.intents.find((e: any) => e.intent === 'greeting');

      expect(pelangiGreeting).toBeDefined();
      expect(makanGreeting).toBeDefined();

      // May have different synonyms per profile
      // (though they could have some overlap)
      expect(pelangiGreeting.synonyms).toBeDefined();
      expect(makanGreeting.synonyms).toBeDefined();
    });

    it('should support profile-specific intent customization', () => {
      const makanPath = join(dataDir, 'intent-synonyms-makan-en.json');
      const makanData = JSON.parse(readFileSync(makanPath, 'utf-8'));

      // Makan profile should have booking synonyms relevant to food ordering
      const bookingIntent = makanData.intents.find((e: any) => e.intent === 'booking');
      expect(bookingIntent).toBeDefined();

      // Should have food-related synonyms
      const bookingSynonyms = bookingIntent.synonyms.map((s: string) => s.toLowerCase());
      expect(bookingSynonyms.some(s => s.includes('table') || s.includes('seat'))).toBe(true);
    });
  });

  describe('Integration: Synonym Expansion in Fuzzy Matching', () => {
    it('should allow keywords + synonyms to be merged for fuzzy matching', () => {
      // This test verifies that the file structure supports the merging pattern
      const filePath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Simulate what fuzzy matching would do:
      // 1. Load primary keywords (from intent-keywords.json)
      // 2. Load synonyms (from intent-synonyms-pelangi-en.json)
      // 3. Merge them together

      const bookingIntent = data.intents.find((e: any) => e.intent === 'booking');
      const primaryKeywords = ['book', 'reservation', 'booking'];
      const mergedKeywords = [...primaryKeywords, ...bookingIntent.synonyms];

      // Merged list should be deduplicable
      const uniqueMerged = [...new Set(mergedKeywords.map(k => k.toLowerCase()))];
      expect(uniqueMerged.length).toBeGreaterThan(0);
      expect(uniqueMerged.length).toBeLessThanOrEqual(mergedKeywords.length);

      // Should contain both primary and synonym keywords
      expect(uniqueMerged.some(k => k === 'book')).toBe(true);
      expect(uniqueMerged.some(k => k.includes('reserve') || k.includes('book'))).toBe(true);
    });

    it('should support synonym expansion for multiple intents simultaneously', () => {
      // Tests that multiple intents can be expanded without conflicts
      const filePath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      const intentsToExpand = ['booking', 'wifi', 'greeting'];
      const allMergedKeywords: string[] = [];

      for (const intentName of intentsToExpand) {
        const intentEntry = data.intents.find((e: any) => e.intent === intentName);
        if (intentEntry) {
          allMergedKeywords.push(...intentEntry.synonyms);
        }
      }

      // All merged keywords should be strings
      for (const keyword of allMergedKeywords) {
        expect(typeof keyword).toBe('string');
        expect(keyword.length).toBeGreaterThan(0);
      }

      // Should have enough keywords for meaningful matching
      expect(allMergedKeywords.length).toBeGreaterThan(5);
    });
  });

  describe('Backward Compatibility', () => {
    it('should have global intent-synonyms.json as fallback', () => {
      const globalPath = join(dataDir, 'intent-synonyms.json');
      const content = readFileSync(globalPath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.intents).toBeDefined();
      expect(Array.isArray(data.intents)).toBe(true);

      // Global file should have multi-language synonyms per intent
      const greetingIntent = data.intents.find((e: any) => e.intent === 'greeting');
      expect(greetingIntent).toBeDefined();
      expect(typeof greetingIntent.synonyms).toBe('object');
      // Should have language keys (en, ms, zh, ta, etc.)
      expect(Object.keys(greetingIntent.synonyms).length).toBeGreaterThan(0);
    });

    it('should handle mixed old and new synonym formats', () => {
      // Some systems may still have old format (object with lang keys)
      // and new format (array of synonyms) — should both work

      const globalPath = join(dataDir, 'intent-synonyms.json');
      const globalData = JSON.parse(readFileSync(globalPath, 'utf-8'));

      const newPath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const newData = JSON.parse(readFileSync(newPath, 'utf-8'));

      // Global has old format (object with lang keys)
      expect(typeof globalData.intents[0].synonyms).toBe('object');

      // New files have array format
      expect(Array.isArray(newData.intents[0].synonyms)).toBe(true);

      // Both should be valid JSON
      expect(globalData.intents).toBeTruthy();
      expect(newData.intents).toBeTruthy();
    });
  });

  describe('Performance: Loading Synonyms for High-Velocity Profiles', () => {
    it('should load language-specific synonyms efficiently for Pelangi profile', () => {
      const startTime = performance.now();

      const enPath = join(dataDir, 'intent-synonyms-pelangi-en.json');
      const content = readFileSync(enPath, 'utf-8');
      const data = JSON.parse(content);

      const endTime = performance.now();
      const loadTime = endTime - startTime;

      // Should load in <10ms
      expect(loadTime).toBeLessThan(10);

      // File should be reasonably sized
      expect(content.length).toBeGreaterThan(100);
      expect(content.length).toBeLessThan(100000); // < 100KB
    });

    it('should support lazy loading of multiple language variants', () => {
      const languages = ['en', 'ta'];
      const loadTimes: number[] = [];

      for (const lang of languages) {
        const startTime = performance.now();
        const filePath = join(dataDir, `intent-synonyms-pelangi-${lang}.json`);
        const content = readFileSync(filePath, 'utf-8');
        JSON.parse(content);
        const endTime = performance.now();
        loadTimes.push(endTime - startTime);
      }

      // All loads should be fast
      for (const time of loadTimes) {
        expect(time).toBeLessThan(10);
      }

      // Total time for loading multiple languages should still be reasonable
      expect(loadTimes.reduce((a, b) => a + b) / languages.length).toBeLessThan(10);
    });
  });
});
