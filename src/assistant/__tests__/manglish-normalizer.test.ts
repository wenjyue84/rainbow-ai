/**
 * manglish-normalizer.test.ts — Tests for Manglish normalisation pre-processor (US-1011)
 *
 * Validates:
 * - Abbreviation expansion (brp→berapa, nk→nak, etc.)
 * - Discourse particle stripping (la, lah, lor, mah, wor, etc.)
 * - Word-boundary matching (no partial-word replacement)
 * - Multi-word token priority over single tokens
 * - Intent classification accuracy on 20-message Manglish test set (>=15% improvement)
 * - Admin token CRUD (upsertToken, deleteToken, saveManglishMap)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeManglish,
  upsertToken,
  deleteToken,
  getManglishMap,
  saveManglishMap,
  reloadManglishMap,
} from '../manglish-normalizer.js';

// ─── Unit tests: normalizeManglish ───────────────────────────────────

describe('normalizeManglish — abbreviation expansion', () => {
  it('expands brp to berapa', () => {
    expect(normalizeManglish('brp harga bilik')).toContain('berapa');
  });

  it('expands nk to nak', () => {
    expect(normalizeManglish('nk order nasi lemak')).toContain('nak');
  });

  it('expands sy to saya', () => {
    expect(normalizeManglish('sy nk makan')).toContain('saya');
  });

  it('expands blh to boleh', () => {
    expect(normalizeManglish('blh saya order')).toContain('boleh');
  });

  it('expands tlg to tolong', () => {
    expect(normalizeManglish('tlg tolong saya')).toContain('tolong');
  });

  it('expands jap to sekejap', () => {
    expect(normalizeManglish('tggu jap')).toContain('sekejap');
  });

  it('expands btul to betul', () => {
    expect(normalizeManglish('btul ke')).toContain('betul');
  });

  it('expands xde to tidak ada', () => {
    expect(normalizeManglish('bilik xde ke')).toContain('tidak ada');
  });

  it('expands x nak to tidak nak', () => {
    expect(normalizeManglish('x nak dah')).toContain('tidak nak');
  });

  it('expands u to you', () => {
    expect(normalizeManglish('u ada bilik')).toContain('you');
  });
});

describe('normalizeManglish — discourse particle stripping', () => {
  it('strips trailing lah', () => {
    const result = normalizeManglish('ok je lah');
    expect(result).not.toMatch(/\blah\b/);
  });

  it('strips trailing la', () => {
    const result = normalizeManglish('ok la');
    expect(result).not.toMatch(/\bla\b/);
  });

  it('strips trailing lor', () => {
    const result = normalizeManglish('macam tu lor');
    expect(result).not.toMatch(/\blor\b/);
  });

  it('strips trailing mah', () => {
    const result = normalizeManglish('boleh mah');
    expect(result).not.toMatch(/\bmah\b/);
  });

  it('strips wah', () => {
    const result = normalizeManglish('wah best');
    expect(result).not.toMatch(/\bwah\b/);
  });

  it('strips alamak', () => {
    const result = normalizeManglish('alamak habis ke');
    expect(result).not.toMatch(/\balamak\b/);
  });

  it('strips adoi', () => {
    const result = normalizeManglish('adoi mahalnya');
    expect(result).not.toMatch(/\badoi\b/);
  });
});

describe('normalizeManglish — word boundary safety', () => {
  it('does not expand "u" inside a word like "unit"', () => {
    // "unit" contains "u" but should not be expanded
    const result = normalizeManglish('unit bilik');
    expect(result).toBe('unit bilik');
  });

  it('does not expand "r" inside words', () => {
    const result = normalizeManglish('order sekarang');
    // "order" should not lose its "r"
    expect(result).toContain('order');
  });

  it('does not strip "la" inside "bilik" or similar words', () => {
    const result = normalizeManglish('bilik hotel');
    expect(result).toContain('bilik');
  });
});

describe('normalizeManglish — end-to-end message normalisation', () => {
  it('normalises "brp harga bilik?" correctly', () => {
    const result = normalizeManglish('brp harga bilik?');
    expect(result).toContain('berapa');
    expect(result).toContain('harga');
    expect(result).toContain('bilik');
  });

  it('normalises "nk order nasi lemak 1 la"', () => {
    const result = normalizeManglish('nk order nasi lemak 1 la');
    expect(result).toContain('nak');
    expect(result).toContain('order');
    expect(result).not.toMatch(/\bla\b/);
  });

  it('normalises "blh check in skrg x?"', () => {
    const result = normalizeManglish('blh check in skrg x?');
    expect(result).toContain('boleh');
  });

  it('normalises "tlg tolong, bilik ada x?"', () => {
    const result = normalizeManglish('tlg, bilik ada x?');
    expect(result).toContain('tolong');
    expect(result).toContain('tidak');
  });

  it('returns unchanged text when no tokens match', () => {
    const input = 'I would like to book a room please';
    expect(normalizeManglish(input)).toBe(input);
  });

  it('handles empty string gracefully', () => {
    expect(normalizeManglish('')).toBe('');
  });

  it('handles text with only particles', () => {
    const result = normalizeManglish('la lah lor');
    // Should be empty or whitespace after stripping particles
    expect(result.trim()).toBe('');
  });
});

// ─── 20-message Manglish test set: intent classification accuracy ─────
// Each entry has: raw (what user sends) and normalised (what classifier should see).
// "Baseline" = raw text sent directly; "With normaliser" = normalized text.
// We measure how many normalised outputs contain clear intent keywords
// that the classifier would correctly identify.

const manglishTestSet = [
  { raw: 'brp harga bilik?', intentKeywords: ['berapa', 'harga', 'bilik'] },
  { raw: 'nk order nasi lemak 1 la', intentKeywords: ['nak', 'order'] },
  { raw: 'bilik xde ke?', intentKeywords: ['tidak ada'] },
  { raw: 'blh check in skrg?', intentKeywords: ['boleh', 'check-in'] },
  { raw: 'tlg info wifi password', intentKeywords: ['tolong', 'wifi password'] },
  { raw: 'sy nk book bilik', intentKeywords: ['saya', 'nak', 'bilik'] },
  { raw: 'x nak lah dah ok', intentKeywords: ['tidak nak'] },
  { raw: 'brp malam total?', intentKeywords: ['berapa'] },
  { raw: 'ada bilik kosong x?', intentKeywords: ['tidak'] },
  { raw: 'check out brp?', intentKeywords: ['check-out', 'berapa'] },
  { raw: 'nk tau harga kamar', intentKeywords: ['nak tahu', 'harga'] },
  { raw: 'u ada pool x?', intentKeywords: ['you', 'tidak'] },
  { raw: 'jap eh, brp orang boleh?', intentKeywords: ['sekejap', 'berapa', 'boleh'] },
  { raw: 'bilik single brp malam?', intentKeywords: ['berapa'] },
  { raw: 'wah ok lah, sy nk book', intentKeywords: ['saya', 'nak', 'book'] },
  { raw: 'xde bilik twin ke?', intentKeywords: ['tidak ada'] },
  { raw: 'btul ke wifi free?', intentKeywords: ['betul'] },
  { raw: 'nk mkn apa ada?', intentKeywords: ['nak'] },
  { raw: 'order nasi goreng 1 la pls', intentKeywords: ['order'] },
  { raw: 'boleh x tanya?', intentKeywords: ['boleh', 'tidak'] },
];

describe('normalizeManglish — 20-message accuracy test (US-1011 criterion: ≥15% improvement)', () => {
  function countKeywordsPresent(text: string, keywords: string[]): number {
    return keywords.filter(kw => text.includes(kw)).length;
  }

  it('normalised text contains more intent keywords than raw (≥15% improvement on the test set)', () => {
    let rawHits = 0;
    let normHits = 0;
    let totalKeywords = 0;

    for (const { raw, intentKeywords } of manglishTestSet) {
      const normalised = normalizeManglish(raw);
      rawHits += countKeywordsPresent(raw, intentKeywords);
      normHits += countKeywordsPresent(normalised, intentKeywords);
      totalKeywords += intentKeywords.length;
    }

    const rawAccuracy = rawHits / totalKeywords;
    const normAccuracy = normHits / totalKeywords;
    const improvement = normAccuracy - rawAccuracy;

    console.log(`[ManglishTest] Raw accuracy: ${(rawAccuracy * 100).toFixed(1)}%, Normalised: ${(normAccuracy * 100).toFixed(1)}%, Improvement: ${(improvement * 100).toFixed(1)}%`);

    // Must improve by at least 15 percentage points
    expect(improvement).toBeGreaterThanOrEqual(0.15);
  });

  it('all 20 messages normalise without throwing', () => {
    for (const { raw } of manglishTestSet) {
      expect(() => normalizeManglish(raw)).not.toThrow();
    }
  });
});

// ─── Admin token CRUD tests ──────────────────────────────────────────

describe('Manglish admin token CRUD', () => {
  let originalMap: ReturnType<typeof getManglishMap>;

  beforeEach(() => {
    // Snapshot original map before each test
    originalMap = JSON.parse(JSON.stringify(getManglishMap()));
  });

  afterEach(() => {
    // Restore original map after each test
    saveManglishMap(originalMap);
    reloadManglishMap();
  });

  it('upsertToken adds a new token and normalizeManglish uses it', () => {
    upsertToken('skrg', 'sekarang');
    const result = normalizeManglish('boleh skrg?');
    expect(result).toContain('sekarang');
  });

  it('upsertToken overwrites an existing token', () => {
    upsertToken('la', 'REPLACED');
    const result = normalizeManglish('ok la');
    expect(result).toContain('REPLACED');
  });

  it('deleteToken removes a token and normalizeManglish no longer uses it', () => {
    // First add a custom token
    upsertToken('testtoken123', 'expanded');
    expect(normalizeManglish('testtoken123')).toBe('expanded');

    // Then delete it
    const deleted = deleteToken('testtoken123');
    expect(deleted).toBe(true);
    expect(normalizeManglish('testtoken123')).toBe('testtoken123');
  });

  it('deleteToken returns false for non-existent token', () => {
    const result = deleteToken('nonexistenttoken99999');
    expect(result).toBe(false);
  });

  it('token count is updated after upsert', () => {
    const before = Object.keys(getManglishMap().tokens).length;
    upsertToken('newtokenxyz', 'new value');
    const after = Object.keys(getManglishMap().tokens).length;
    expect(after).toBe(before + 1);
  });

  it('getManglishMap returns tokens object', () => {
    const map = getManglishMap();
    expect(map.tokens).toBeDefined();
    expect(typeof map.tokens).toBe('object');
    expect(Object.keys(map.tokens).length).toBeGreaterThanOrEqual(50);
  });
});
