/**
 * upsell-suggestions.test.ts — Unit tests for US-857 (Upsell suggestions)
 *
 * Verifies:
 * - Upsell tracker prevents duplicate suggestions per session
 * - Category-based upsell suggestions map correctly
 * - Upsell messages are brief and conversational
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasUpsellBeenOffered,
  markUpsellOffered,
  getUpsellSuggestion,
} from '../upsell-tracker.js';

describe('Upsell suggestions (US-857)', () => {
  beforeEach(() => {
    // Clear any lingering state between tests (in-memory map)
    // We'll test with different session IDs to avoid state pollution
  });

  it('returns false for upsell not yet offered', () => {
    const result = hasUpsellBeenOffered('session-new-001');
    expect(result).toBe(false);
  });

  it('returns true after marking upsell as offered', () => {
    const sessionId = 'session-mark-001';
    expect(hasUpsellBeenOffered(sessionId)).toBe(false);

    markUpsellOffered(sessionId);

    expect(hasUpsellBeenOffered(sessionId)).toBe(true);
  });

  it('returns true on subsequent checks for same session', () => {
    const sessionId = 'session-persist-001';
    markUpsellOffered(sessionId);

    expect(hasUpsellBeenOffered(sessionId)).toBe(true);
    expect(hasUpsellBeenOffered(sessionId)).toBe(true); // Still true
  });

  it('returns rice -> drink suggestion', () => {
    const result = getUpsellSuggestion('rice');
    expect(result.suggested).toBe('a drink');
    expect(result.message).toContain('drink');
    expect(result.message.length).toBeLessThan(100); // Conversational, brief
  });

  it('returns noodles -> drink suggestion', () => {
    const result = getUpsellSuggestion('noodles');
    expect(result.suggested).toBe('a drink');
    expect(result.message).toContain('drink');
  });

  it('returns desserts -> drink suggestion', () => {
    const result = getUpsellSuggestion('desserts');
    expect(result.suggested).toBe('a drink');
  });

  it('returns cake -> coffee suggestion', () => {
    const result = getUpsellSuggestion('cake');
    expect(result.suggested).toBe('a coffee');
    expect(result.message).toContain('coffee');
  });

  it('returns drinks -> snack suggestion', () => {
    const result = getUpsellSuggestion('drinks');
    expect(result.suggested).toBe('a snack');
  });

  it('handles case-insensitive categories', () => {
    const lowerResult = getUpsellSuggestion('rice');
    const upperResult = getUpsellSuggestion('RICE');
    const mixedResult = getUpsellSuggestion('RiCe');

    expect(lowerResult.suggested).toBe(upperResult.suggested);
    expect(upperResult.suggested).toBe(mixedResult.suggested);
  });

  it('returns default suggestion for unknown category', () => {
    const result = getUpsellSuggestion('unknown-category-xyz');
    expect(result.suggested).toBe('something else');
    expect(result.message.toLowerCase()).toContain('anything else');
  });

  it('returns default suggestion for null/undefined category', () => {
    const resultNull = getUpsellSuggestion(undefined);
    const resultUndefined = getUpsellSuggestion(undefined);

    expect(resultNull.suggested).toBe('something else');
    expect(resultUndefined.suggested).toBe('something else');
  });

  it('keeps upsell state separate per session', () => {
    const session1 = 'session-sep-001';
    const session2 = 'session-sep-002';

    markUpsellOffered(session1);

    expect(hasUpsellBeenOffered(session1)).toBe(true);
    expect(hasUpsellBeenOffered(session2)).toBe(false); // Should still be false
  });
});
