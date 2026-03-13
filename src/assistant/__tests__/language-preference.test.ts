/**
 * Tests for US-462: Per-contact language preference persistence
 *
 * Covers: preference read/write/override flow, resolveEffectiveLanguage logic.
 * DB interactions are mocked via vi.mock.
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

// ─── Hoist mocks so vi.mock factory can reference them ───────────────

const { mockGetContactDetails, mockUpdateContactDetails } = vi.hoisted(() => ({
  mockGetContactDetails: vi.fn(),
  mockUpdateContactDetails: vi.fn(),
}));

// ─── Mock conversation-contacts ──────────────────────────────────────

vi.mock('../conversation-contacts.js', () => ({
  getContactDetails: mockGetContactDetails,
  updateContactDetails: mockUpdateContactDetails,
}));

// ─── Import after mocks ──────────────────────────────────────────────

import {
  getPreferredLanguage,
  isLanguageLocked,
  setPreferredLanguage,
  resolveEffectiveLanguage,
  clearPreferenceCache,
  PREF_WRITE_THRESHOLD,
  PREF_OVERRIDE_THRESHOLD,
} from '../language-preference.js';

// ─── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  clearPreferenceCache();
});

// ─── getPreferredLanguage ────────────────────────────────────────────

describe('getPreferredLanguage', () => {
  test('returns null when no language stored', async () => {
    mockGetContactDetails.mockResolvedValue({});
    const lang = await getPreferredLanguage('+60123456789');
    expect(lang).toBeNull();
  });

  test('returns stored language', async () => {
    mockGetContactDetails.mockResolvedValue({ language: 'ms' });
    const lang = await getPreferredLanguage('+60123456789');
    expect(lang).toBe('ms');
  });

  test('reads from cache on second call (no second DB hit)', async () => {
    mockGetContactDetails.mockResolvedValue({ language: 'zh' });
    await getPreferredLanguage('+60123456789');
    await getPreferredLanguage('+60123456789');
    expect(mockGetContactDetails).toHaveBeenCalledTimes(1);
  });

  test('returns null on DB error', async () => {
    mockGetContactDetails.mockRejectedValue(new Error('DB down'));
    const lang = await getPreferredLanguage('+60111111111');
    expect(lang).toBeNull();
  });
});

// ─── isLanguageLocked ────────────────────────────────────────────────

describe('isLanguageLocked', () => {
  test('returns false when not locked', async () => {
    mockGetContactDetails.mockResolvedValue({ language: 'ms', languageLocked: false });
    const locked = await isLanguageLocked('+60123456789');
    expect(locked).toBe(false);
  });

  test('returns true when admin has locked the language', async () => {
    mockGetContactDetails.mockResolvedValue({ language: 'zh', languageLocked: true });
    const locked = await isLanguageLocked('+60123456789');
    expect(locked).toBe(true);
  });

  test('returns false when languageLocked is absent', async () => {
    mockGetContactDetails.mockResolvedValue({ language: 'en' });
    const locked = await isLanguageLocked('+60123456789');
    expect(locked).toBe(false);
  });
});

// ─── setPreferredLanguage ────────────────────────────────────────────

describe('setPreferredLanguage', () => {
  test('calls updateContactDetails with correct language', async () => {
    mockUpdateContactDetails.mockResolvedValue({ language: 'ms' });
    await setPreferredLanguage('+60123456789', 'ms');
    expect(mockUpdateContactDetails).toHaveBeenCalledWith('+60123456789', { language: 'ms' });
  });

  test('subsequent getPreferredLanguage returns updated value from cache', async () => {
    mockUpdateContactDetails.mockResolvedValue({ language: 'zh' });
    await setPreferredLanguage('+60123456789', 'zh');
    // Should hit cache, not DB
    const lang = await getPreferredLanguage('+60123456789');
    expect(lang).toBe('zh');
    expect(mockGetContactDetails).not.toHaveBeenCalled();
  });
});

// ─── resolveEffectiveLanguage ────────────────────────────────────────

describe('resolveEffectiveLanguage', () => {
  const phone = '+60123456789';

  beforeEach(() => {
    mockUpdateContactDetails.mockResolvedValue({});
  });

  test('uses detected language when confidence >= PREF_WRITE_THRESHOLD and no stored pref', () => {
    const result = resolveEffectiveLanguage(phone, 'ms', PREF_WRITE_THRESHOLD, null, false);
    expect(result).toBe('ms');
  });

  test('writes to DB when first-time preference (storedLang is null, confidence >= 0.7)', async () => {
    resolveEffectiveLanguage(phone, 'ms', PREF_WRITE_THRESHOLD, null, false);
    // Give the fire-and-forget a tick to execute
    await new Promise(r => setTimeout(r, 0));
    expect(mockUpdateContactDetails).toHaveBeenCalledWith(phone, { language: 'ms' });
  });

  test('uses stored preference when detection confidence < PREF_WRITE_THRESHOLD', () => {
    const result = resolveEffectiveLanguage(phone, 'en', 0.5, 'ms', false);
    expect(result).toBe('ms');
  });

  test('does NOT override stored pref when confidence is 0.7-0.84 and lang is different', async () => {
    // 0.75 confidence, different language → should NOT override (below 0.85 threshold)
    resolveEffectiveLanguage(phone, 'en', 0.75, 'ms', false);
    await new Promise(r => setTimeout(r, 0));
    // updateContactDetails should NOT be called (stored pref ms, detected en at 0.75)
    expect(mockUpdateContactDetails).not.toHaveBeenCalled();
  });

  test('overrides stored pref when confidence >= PREF_OVERRIDE_THRESHOLD and different lang', async () => {
    resolveEffectiveLanguage(phone, 'en', PREF_OVERRIDE_THRESHOLD, 'ms', false);
    await new Promise(r => setTimeout(r, 0));
    expect(mockUpdateContactDetails).toHaveBeenCalledWith(phone, { language: 'en' });
  });

  test('does NOT write when language is locked', async () => {
    resolveEffectiveLanguage(phone, 'en', 0.9, 'ms', true /* locked */);
    await new Promise(r => setTimeout(r, 0));
    expect(mockUpdateContactDetails).not.toHaveBeenCalled();
  });

  test('returns detected lang even when locked (locked suppresses write, not read)', () => {
    // When locked, we still use the detected language for this message
    // (locked only prevents auto-update of stored preference)
    const result = resolveEffectiveLanguage(phone, 'en', 0.9, 'ms', true);
    expect(result).toBe('en');
  });

  test('falls back to detected lang when no stored pref and low confidence', () => {
    const result = resolveEffectiveLanguage(phone, 'en', 0.3, null, false);
    expect(result).toBe('en');
  });

  test('does not write when detected language is unknown', async () => {
    resolveEffectiveLanguage(phone, 'unknown' as any, 0.8, null, false);
    await new Promise(r => setTimeout(r, 0));
    expect(mockUpdateContactDetails).not.toHaveBeenCalled();
  });

  test('does not write when stored pref matches detected lang', async () => {
    // Same language — no update needed
    resolveEffectiveLanguage(phone, 'ms', 0.9, 'ms', false);
    await new Promise(r => setTimeout(r, 0));
    expect(mockUpdateContactDetails).not.toHaveBeenCalled();
  });
});
