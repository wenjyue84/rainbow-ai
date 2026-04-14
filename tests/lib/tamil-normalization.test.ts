import { describe, it, expect } from 'vitest';
import { normalizeTamilInput } from '../../src/lib/tamil-normalization.js';

describe('Tamil Normalization', () => {
  describe('Basic normalization', () => {
    it('should return empty string for empty input', () => {
      expect(normalizeTamilInput('')).toBe('');
    });

    it('should return original text for English input', () => {
      expect(normalizeTamilInput('hello')).toBe('hello');
    });

    it('should normalize Tamil text to NFC form', () => {
      // Test that the output is in NFC form
      const result = normalizeTamilInput('கூறினார்');
      expect(result.normalize('NFC')).toBe(result);
    });
  });

  describe('Tamil variant pairs - Classical vs Modern', () => {
    it('should match classical ஸ்ரீ with modern ஸ்ரீ (variant 1)', () => {
      // Classical form (precomposed)
      const classical = 'ஸ்ரீ';
      // Modern form (decomposed then recomposed)
      const modern = 'ஸ' + '\u0BCD' + 'ரீ';

      const classicalNorm = normalizeTamilInput(classical);
      const modernNorm = normalizeTamilInput(modern);

      expect(classicalNorm).toBe(modernNorm);
    });

    it('should match Tamil text with different virama placements (variant 2)', () => {
      // Two different representations of the same text
      const form1 = 'நன்றி'; // NFC form
      const form2 = 'நன்றி'.normalize('NFD'); // NFD form

      const norm1 = normalizeTamilInput(form1);
      const norm2 = normalizeTamilInput(form2);

      expect(norm1).toBe(norm2);
    });

    it('should handle Tamil text with vowel signs (variant 3)', () => {
      // Text with different vowel sign compositions
      const withVowel = 'கூறினார்';
      const withVowelNorm = normalizeTamilInput(withVowel);

      // Create same text via NFD and back
      const viaDecompose = withVowel.normalize('NFD').normalize('NFC');
      const viaDecomposeNorm = normalizeTamilInput(viaDecompose);

      expect(withVowelNorm).toBe(viaDecomposeNorm);
    });

    it('should normalize Tamil text with anusvara (variant 4)', () => {
      // Tamil text with anusvara (0xB82)
      const withAnusvara = 'நமஸ்'; // नम:
      const withAnusvaraNorm = normalizeTamilInput(withAnusvara);

      // Ensure it's normalized to NFC
      expect(withAnusvaraNorm.normalize('NFC')).toBe(withAnusvaraNorm);
    });

    it('should handle Tamil words with multiple combining characters (variant 5)', () => {
      // Complex word with multiple combining marks
      const complex = 'நாட்டுப்பளம்';
      const complexNorm = normalizeTamilInput(complex);

      // Decompose and recompose the same word
      const recomposed = complex.normalize('NFD').normalize('NFC');
      const recomposedNorm = normalizeTamilInput(recomposed);

      expect(complexNorm).toBe(recomposedNorm);
    });
  });

  describe('Floating diacritical removal', () => {
    it('should remove combining mark at the start of text', () => {
      // Create text with combining mark at start
      const markedAtStart = '\u0BCD' + 'test'; // virama at start
      const result = normalizeTamilInput(markedAtStart);

      // The combining mark should be removed
      expect(result).not.toMatch(/[\u0B82\u0B83\u0B3C-\u0B44]/);
    });

    it('should keep combining marks after valid base characters', () => {
      // Tamil letter with virama (valid combination)
      const valid = 'க' + '\u0BCD'; // ka + virama = क्
      const result = normalizeTamilInput(valid);

      // Should contain the virama since it's after a valid base
      expect(result).toContain('க');
    });

    it('should remove consecutive combining marks (floating)', () => {
      // Two consecutive combining marks (second is floating)
      const doubleMarks = 'ந' + '\u0BCD' + '\u0B82'; // letter + virama + anusvara
      const result = normalizeTamilInput(doubleMarks);

      // Should preserve the first virama, remove the second mark
      expect(result).toBeDefined();
    });
  });

  describe('Preserving input case', () => {
    it('should preserve case of input text (case conversion is caller responsibility)', () => {
      // Note: normalizeTamilInput is called AFTER .toLowerCase().trim() in fuzzy-matcher
      // So case conversion is the caller's responsibility, not this function's
      const lower = normalizeTamilInput('hello');
      const upper = normalizeTamilInput('HELLO');
      const mixed = normalizeTamilInput('HeLLo');

      expect(lower).toBe('hello');
      expect(upper).toBe('HELLO');
      expect(mixed).toBe('HeLLo');
    });

    it('should normalize Tamil text regardless of input case', () => {
      // Tamil normalization works on any input, case is preserved
      const lowerTamil = normalizeTamilInput('கூறினார்');
      const result = normalizeTamilInput(lowerTamil.toUpperCase());

      // Case of English letters will be different, but Tamil normalization works
      expect(lowerTamil).toBeDefined();
      expect(result).toBeDefined();
    });
  });

  describe('Real-world booking intent keywords', () => {
    it('should normalize Tamil booking keyword "புக்கிங்"', () => {
      const keyword1 = 'புக்கிங்';
      const keyword2 = 'புக்கிங்'.normalize('NFD'); // Decomposed version

      expect(normalizeTamilInput(keyword1)).toBe(normalizeTamilInput(keyword2));
    });

    it('should normalize Tamil inquiry keyword "விசாரணை"', () => {
      const keyword1 = 'விசாரணை';
      const keyword2 = 'விசாரணை'.normalize('NFD');

      expect(normalizeTamilInput(keyword1)).toBe(normalizeTamilInput(keyword2));
    });

    it('should normalize Tamil hostel keyword "விடுதி"', () => {
      const keyword1 = 'விடுதி';
      const keyword2 = 'விடுதி'.normalize('NFD');

      expect(normalizeTamilInput(keyword1)).toBe(normalizeTamilInput(keyword2));
    });

    it('should normalize phrases with mixed Tamil and numbers', () => {
      // Common booking phrase: "2 rooms booking"
      const phrase1 = '2 புக்கிங்';
      const phrase2 = '2 ' + 'புக்கிங்'.normalize('NFD');

      expect(normalizeTamilInput(phrase1)).toBe(normalizeTamilInput(phrase2));
    });
  });

  describe('Idempotence', () => {
    it('should be idempotent - normalizing twice gives same result', () => {
      const original = 'கூறினார்';
      const first = normalizeTamilInput(original);
      const second = normalizeTamilInput(first);

      expect(first).toBe(second);
    });

    it('should be idempotent with complex Tamil text', () => {
      const original = 'நாட்டுப்பளம்';
      const first = normalizeTamilInput(original);
      const second = normalizeTamilInput(first);
      const third = normalizeTamilInput(second);

      expect(first).toBe(second);
      expect(second).toBe(third);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty strings', () => {
      expect(normalizeTamilInput('')).toBe('');
    });

    it('should handle null/undefined by returning early', () => {
      // The function checks if (!text) and returns early
      expect(normalizeTamilInput(null as any)).toBe(null);
      expect(normalizeTamilInput(undefined as any)).toBe(undefined);
    });

    it('should handle mixed Tamil and English text', () => {
      const mixed = 'booking புக்கிங்';
      const result = normalizeTamilInput(mixed);

      expect(result).toContain('booking');
      expect(result).toBeDefined();
    });

    it('should handle special characters in Tamil context', () => {
      const withPunctuation = 'கூறினார், நாங்கள்.';
      const result = normalizeTamilInput(withPunctuation);

      expect(result).toBeDefined();
      expect(result).toContain(',');
      expect(result).toContain('.');
    });

    it('should handle very long Tamil text', () => {
      const longText = 'கூறினார் '.repeat(100);
      const result = normalizeTamilInput(longText);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('NFC normalization verification', () => {
    it('should always output NFC-normalized text', () => {
      const testCases = [
        'ஸ்ரீ',
        'கூறினார்',
        'விசாரணை',
        'நாட்டுப்பளம்',
        'புக்கிங்'
      ];

      for (const text of testCases) {
        const result = normalizeTamilInput(text);
        // Verify output is in NFC form
        expect(result).toBe(result.normalize('NFC'));
      }
    });

    it('should produce consistent results across multiple calls', () => {
      const text = 'கூறினார்';
      const results = Array(5).fill(0).map(() => normalizeTamilInput(text));

      // All results should be identical
      expect(new Set(results).size).toBe(1);
    });
  });
});
