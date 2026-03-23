/**
 * US-318: Intent Classifier Input Normalization Validator — Unit Tests
 *
 * Verifies emoji/diacritic handling for Tamil characters and Malay text variants.
 *
 * Test cases:
 * 1. Emoji stripping — removes emojis, preserves surrounding text
 * 2. Tamil character preservation — vowel signs and combining marks retained
 * 3. Malay diacritics — Latin diacritics normalized (é→e, ü→u)
 * 4. Whitespace normalization — trims and collapses internal whitespace
 * 5. Mixed input — emojis + Tamil + Malay in one string
 * 6. Already-clean input — no-op passthrough
 * 7. Empty / whitespace-only input handling
 * 8. Lowercase conversion
 * 9. Debug logging fires when input changes, silent when unchanged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeInput, logNormalization } from '../src/assistant/pipeline/input-normalizer.js';

// ─── Emoji Stripping ─────────────────────────────────────────────────

describe('normalizeInput — emoji handling', () => {
  it('strips emojis from user text', () => {
    const result = normalizeInput('Hello 😊 how are you? 🏨');
    expect(result.normalized).toBe('hello how are you?');
    expect(result.changed).toBe(true);
    expect(result.transformations).toContain('emoji_stripped');
  });

  it('strips complex emoji sequences (flags, skin tones)', () => {
    const result = normalizeInput('Book room 🇲🇾👍🏽');
    expect(result.normalized).toBe('book room');
    expect(result.changed).toBe(true);
    expect(result.transformations).toContain('emoji_stripped');
  });

  it('strips weather/symbol emojis', () => {
    const result = normalizeInput('☀️ Good morning ☕');
    expect(result.normalized).toBe('good morning');
    expect(result.changed).toBe(true);
  });
});

// ─── Tamil Character Preservation ────────────────────────────────────

describe('normalizeInput — Tamil text handling', () => {
  it('preserves Tamil vowel signs and combining marks', () => {
    // "vanakkam" in Tamil — vowel signs are combining marks in the Tamil block
    const tamil = 'வணக்கம்';
    const result = normalizeInput(tamil);
    expect(result.normalized).toBe(tamil);
    // Tamil chars should remain unchanged (no diacritics_normalized)
    expect(result.transformations).not.toContain('diacritics_normalized');
  });

  it('preserves Tamil text with mixed Latin text', () => {
    const input = 'வணக்கம் booking please';
    const result = normalizeInput(input);
    expect(result.normalized).toBe('வணக்கம் booking please');
    expect(result.changed).toBe(false); // only lowercase would change, but Tamil + already-lowercase
  });

  it('preserves Tamil numerals and punctuation in context', () => {
    // Tamil "how much for room?" — நான் அறை எவ்வளவு?
    const input = 'நான் அறை எவ்வளவு?';
    const result = normalizeInput(input);
    expect(result.normalized).toBe('நான் அறை எவ்வளவு?');
  });

  it('handles Tamil with emojis — strips emojis, keeps Tamil', () => {
    const input = '😊 வணக்கம் 🙏';
    const result = normalizeInput(input);
    expect(result.normalized).toBe('வணக்கம்');
    expect(result.transformations).toContain('emoji_stripped');
    expect(result.transformations).not.toContain('diacritics_normalized');
  });
});

// ─── Malay Text / Diacritics ─────────────────────────────────────────

describe('normalizeInput — Malay text and diacritics', () => {
  it('normalizes Latin diacritics in Malay text (café → cafe)', () => {
    const result = normalizeInput('café');
    expect(result.normalized).toBe('cafe');
    expect(result.transformations).toContain('diacritics_normalized');
  });

  it('normalizes accented characters (résumé → resume)', () => {
    const result = normalizeInput('résumé');
    expect(result.normalized).toBe('resume');
  });

  it('preserves standard Malay text without diacritics', () => {
    const input = 'saya nak tempah bilik';
    const result = normalizeInput(input);
    expect(result.normalized).toBe('saya nak tempah bilik');
    expect(result.changed).toBe(false);
  });

  it('handles Malay text with mixed case', () => {
    const result = normalizeInput('Berapa Harga Bilik?');
    expect(result.normalized).toBe('berapa harga bilik?');
    expect(result.transformations).toContain('lowercased');
  });

  it('normalizes umlaut in borrowed words (e.g., über → uber)', () => {
    const result = normalizeInput('über cool');
    expect(result.normalized).toBe('uber cool');
  });
});

// ─── Whitespace Handling ─────────────────────────────────────────────

describe('normalizeInput — whitespace normalization', () => {
  it('trims leading and trailing whitespace', () => {
    const result = normalizeInput('  hello world  ');
    expect(result.normalized).toBe('hello world');
    expect(result.transformations).toContain('trimmed');
  });

  it('collapses internal whitespace runs', () => {
    const result = normalizeInput('book   a    room');
    expect(result.normalized).toBe('book a room');
    expect(result.transformations).toContain('whitespace_collapsed');
  });

  it('handles tabs and newlines as whitespace', () => {
    const result = normalizeInput("check\tin\nplease");
    expect(result.normalized).toBe('check in please');
  });

  it('handles empty string', () => {
    const result = normalizeInput('');
    expect(result.normalized).toBe('');
    expect(result.changed).toBe(false);
    expect(result.transformations).toEqual([]);
  });

  it('handles whitespace-only string', () => {
    const result = normalizeInput('   ');
    expect(result.normalized).toBe('');
    expect(result.changed).toBe(true);
    expect(result.transformations).toContain('trimmed');
  });
});

// ─── Mixed Input ─────────────────────────────────────────────────────

describe('normalizeInput — mixed input scenarios', () => {
  it('handles emojis + Tamil + Latin in one string', () => {
    const input = '😊 வணக்கம் Hello Café! 🏨';
    const result = normalizeInput(input);
    expect(result.normalized).toBe('வணக்கம் hello cafe!');
    expect(result.transformations).toContain('emoji_stripped');
    expect(result.transformations).toContain('diacritics_normalized');
    expect(result.transformations).toContain('lowercased');
  });

  it('handles Malay + emoji + excessive whitespace', () => {
    const input = '  Saya nak   tempah 😊  bilik  ';
    const result = normalizeInput(input);
    expect(result.normalized).toBe('saya nak tempah bilik');
  });
});

// ─── Passthrough ─────────────────────────────────────────────────────

describe('normalizeInput — clean input passthrough', () => {
  it('returns unchanged for already-normalized input', () => {
    const input = 'i want to book a room';
    const result = normalizeInput(input);
    expect(result.normalized).toBe(input);
    expect(result.changed).toBe(false);
    expect(result.transformations).toEqual([]);
  });

  it('preserves single spaces between words', () => {
    const input = 'check in tomorrow';
    const result = normalizeInput(input);
    expect(result.normalized).toBe(input);
    expect(result.changed).toBe(false);
  });
});

// ─── Debug Logging ───────────────────────────────────────────────────

describe('logNormalization — debug logging', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  it('logs when input was changed', () => {
    const result = normalizeInput('Hello 😊 World');
    logNormalization(result);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[InputNormalizer]')
    );
  });

  it('does not log when input is unchanged', () => {
    const result = normalizeInput('hello world');
    logNormalization(result);
    expect(debugSpy).not.toHaveBeenCalled();
  });
});
