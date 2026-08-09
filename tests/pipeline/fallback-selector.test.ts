/**
 * Tests for Confidence-Tiered Fallback Response Selector (US-412)
 *
 * Validates:
 * 1. Tier boundaries (0.3, 0.6 thresholds)
 * 2. Profile isolation — makan responses contain zero Pelangi Hostel keywords
 * 3. Language fallback to English when requested language is unavailable
 */

import { describe, it, expect } from 'vitest';
import {
  getConfidenceTier,
  selectFallbackResponse,
  type ConfidenceTier
} from '../../src/assistant/pipeline/fallback-selector.js';

// Pelangi Hostel domain keywords that must NOT appear in makan responses
const PELANGI_HOSTEL_KEYWORDS = ['hostel', 'check-in', 'room rate', 'front desk', 'dorm', 'bunk'];

// Helper: gather all string values from an object recursively
function collectStrings(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (Array.isArray(obj)) return obj.flatMap(collectStrings);
  if (obj && typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Tier boundary tests
// ---------------------------------------------------------------------------
describe('getConfidenceTier', () => {
  it('returns tier0 for confidence < 0.3', () => {
    expect(getConfidenceTier(0)).toBe('tier0');
    expect(getConfidenceTier(0.1)).toBe('tier0');
    expect(getConfidenceTier(0.29)).toBe('tier0');
  });

  it('returns tier0 for exactly 0', () => {
    expect(getConfidenceTier(0)).toBe('tier0');
  });

  it('returns tier1 for 0.3 (boundary)', () => {
    expect(getConfidenceTier(0.3)).toBe('tier1');
  });

  it('returns tier1 for 0.3–0.59', () => {
    expect(getConfidenceTier(0.3)).toBe('tier1');
    expect(getConfidenceTier(0.45)).toBe('tier1');
    expect(getConfidenceTier(0.599)).toBe('tier1');
  });

  it('returns tier2 for 0.6 (boundary)', () => {
    expect(getConfidenceTier(0.6)).toBe('tier2');
  });

  it('returns tier2 for 0.6–1.0', () => {
    expect(getConfidenceTier(0.6)).toBe('tier2');
    expect(getConfidenceTier(0.8)).toBe('tier2');
    expect(getConfidenceTier(1.0)).toBe('tier2');
  });
});

// ---------------------------------------------------------------------------
// Profile isolation
// ---------------------------------------------------------------------------
describe('selectFallbackResponse — profile isolation', () => {
  it('returns a response for pelangi profile (tier0)', () => {
    const result = selectFallbackResponse(0.1, 'pelangi');
    expect(result.tier).toBe('tier0');
    expect(result.profileId).toBe('pelangi');
    expect(result.response).toBeTruthy();
  });

  it('returns a response for makan profile (tier0)', () => {
    const result = selectFallbackResponse(0.1, 'makan-moments');
    expect(result.tier).toBe('tier0');
    expect(result.profileId).toBe('makan-moments');
    expect(result.response).toBeTruthy();
  });

  it('returns different responses for makan vs pelangi (tier0)', () => {
    const makan = selectFallbackResponse(0.1, 'makan-moments');
    const pelangi = selectFallbackResponse(0.1, 'pelangi');
    expect(makan.response).not.toBe(pelangi.response);
  });

  it('returns different responses for makan vs pelangi (tier1)', () => {
    const makan = selectFallbackResponse(0.45, 'makan-moments');
    const pelangi = selectFallbackResponse(0.45, 'pelangi');
    expect(makan.response).not.toBe(pelangi.response);
  });
});

// ---------------------------------------------------------------------------
// Cross-profile contamination: makan must contain zero Pelangi keywords
// ---------------------------------------------------------------------------
describe('zero cross-profile contamination', () => {
  it('makan tier0 response contains no Pelangi Hostel keywords', () => {
    const result = selectFallbackResponse(0.1, 'makan-moments', 'en');
    const lower = result.response.toLowerCase();
    for (const kw of PELANGI_HOSTEL_KEYWORDS) {
      expect(lower, `makan tier0 response contains pelangi keyword: "${kw}"`).not.toContain(kw);
    }
  });

  it('makan tier1 response contains no Pelangi Hostel keywords', () => {
    const result = selectFallbackResponse(0.45, 'makan-moments', 'en');
    const lower = result.response.toLowerCase();
    for (const kw of PELANGI_HOSTEL_KEYWORDS) {
      expect(lower, `makan tier1 response contains pelangi keyword: "${kw}"`).not.toContain(kw);
    }
  });

  it('makan tier2 response contains no Pelangi Hostel keywords', () => {
    const result = selectFallbackResponse(0.8, 'makan-moments', 'en');
    const lower = result.response.toLowerCase();
    for (const kw of PELANGI_HOSTEL_KEYWORDS) {
      expect(lower, `makan tier2 response contains pelangi keyword: "${kw}"`).not.toContain(kw);
    }
  });

  it('all makan tier responses (all languages) are free of Pelangi keywords', async () => {
    // Load fallback-responses.json directly to scan all makan strings
    const data = (await import('../../src/assistant/data/fallback-responses.json', {
      with: { type: 'json' }
    })).default as Record<string, unknown>;

    const makanData = data['makan-moments'];
    expect(makanData).toBeTruthy();

    const allStrings = collectStrings(makanData);
    expect(allStrings.length).toBeGreaterThan(0);

    for (const str of allStrings) {
      const lower = str.toLowerCase();
      for (const kw of PELANGI_HOSTEL_KEYWORDS) {
        expect(lower, `makan data contains pelangi keyword "${kw}" in: "${str}"`).not.toContain(kw);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Language fallback
// ---------------------------------------------------------------------------
describe('selectFallbackResponse — language handling', () => {
  it('returns English by default', () => {
    const result = selectFallbackResponse(0.1, 'pelangi');
    expect(result.language).toBe('en');
    expect(result.response).toBeTruthy();
  });

  it('returns Malay response when language is ms', () => {
    const en = selectFallbackResponse(0.1, 'pelangi', 'en');
    const ms = selectFallbackResponse(0.1, 'pelangi', 'ms');
    expect(ms.response).not.toBe(en.response);
  });

  it('falls back to English for unknown language code', () => {
    const en = selectFallbackResponse(0.1, 'pelangi', 'en');
    const unknown = selectFallbackResponse(0.1, 'pelangi', 'xx');
    // Should not throw and should return the English fallback
    expect(unknown.response).toBe(en.response);
  });
});

// ---------------------------------------------------------------------------
// Unknown profile
// ---------------------------------------------------------------------------
describe('selectFallbackResponse — unknown profile', () => {
  it('returns a safe generic response for unknown profile', () => {
    const result = selectFallbackResponse(0.1, 'unknown-profile');
    expect(result.response).toBeTruthy();
    expect(result.tier).toBe('tier0');
  });
});
