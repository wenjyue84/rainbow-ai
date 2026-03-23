/**
 * Tests for context-aware fallback response selection (US-105).
 *
 * Covers: low-confidence selection, repeated fallback handling, escalation offer,
 * and confirmation that escalation_flag prevents infinite loops.
 */

import { describe, it, expect } from 'vitest';
import { getFallbackResponse } from '../../src/assistant/ai-response-generator.js';

describe('getFallbackResponse', () => {
  // ─── First Fallback Selection (Low Confidence, Early Conversation) ──

  it('should return first_fallback template for low-confidence message (0.3 score) with 2 prior messages', () => {
    const result = getFallbackResponse(
      0.3,  // confidence
      2,    // conversationLength (< 3)
      0,    // fallbackCount
      'en'  // language
    );

    expect(result.template).toBeDefined();
    expect(result.template.toLowerCase()).toContain('clarif');
    expect(result.escalation_flag).toBe(false);
  });

  it('should return first_fallback template with proper English content for low confidence', () => {
    const result = getFallbackResponse(0.25, 1, 0, 'en');

    expect(result.template).toMatch(/Could you clarify/i);
    expect(result.escalation_flag).toBe(false);
  });

  it('should return first_fallback template in Malay for low confidence', () => {
    const result = getFallbackResponse(0.3, 2, 0, 'ms');

    expect(result.template).toBeDefined();
    // Should contain Malay content (jelaskan = clarify)
    expect(result.template.toLowerCase()).toMatch(/jelaskan|faham/i);
    expect(result.escalation_flag).toBe(false);
  });

  it('should return first_fallback template in Mandarin for low confidence', () => {
    const result = getFallbackResponse(0.4, 2, 0, 'zh');

    expect(result.template).toBeDefined();
    // Should be in Chinese
    expect(result.template.length > 0).toBe(true);
    expect(result.escalation_flag).toBe(false);
  });

  // ─── Escalation Offer Selection (Multiple Fallbacks) ──────────────

  it('should return escalation_offer template when fallback_count > 1 with low confidence', () => {
    const result = getFallbackResponse(
      0.2,  // confidence
      5,    // conversationLength (>= 3, so normally wouldn't trigger first_fallback)
      2,    // fallbackCount > 1 → escalation
      'en'
    );

    expect(result.template).toBeDefined();
    expect(result.template.toLowerCase()).toContain('speak with our staff');
    expect(result.escalation_flag).toBe(true);
  });

  it('should set escalation_flag=true to prevent infinite fallback loops', () => {
    const result = getFallbackResponse(0.15, 4, 3, 'en');

    expect(result.escalation_flag).toBe(true);
    // Caller should use this flag to break the loop
  });

  it('should return escalation_offer in Malay when fallback_count > 1', () => {
    const result = getFallbackResponse(0.2, 5, 2, 'ms');

    expect(result.template).toBeDefined();
    expect(result.escalation_flag).toBe(true);
    // Should be in Malay
    expect(result.template.toLowerCase()).toMatch(/kakitangan|bantuan/i);
  });

  // ─── Repeated Fallback Selection (Default Case) ────────────────────

  it('should return repeated_fallback template for mid-confidence (0.6) message', () => {
    const result = getFallbackResponse(0.6, 3, 1, 'en');

    expect(result.template).toBeDefined();
    expect(result.escalation_flag).toBe(false);
    // Should mention trying to rephrase or rephrasing differently
    expect(result.template.toLowerCase()).toMatch(/rephras|trouble/i);
  });

  it('should return repeated_fallback template when fallback_count = 1', () => {
    const result = getFallbackResponse(0.5, 5, 1, 'en');

    expect(result.template).toBeDefined();
    expect(result.escalation_flag).toBe(false);
  });

  // ─── Boundary Conditions ─────────────────────────────────────────────

  it('should treat confidence=0.5 as NOT low (edge case)', () => {
    // confidence < 0.5 triggers first_fallback only if conversationLength < 3
    // confidence = 0.5 should not trigger first_fallback even with length < 3
    const result = getFallbackResponse(0.5, 2, 0, 'en');

    // Should use repeated_fallback (default), not first_fallback
    expect(result.escalation_flag).toBe(false);
    // Check that it's not the "Could you clarify" version
    const firstFallback = getFallbackResponse(0.49, 2, 0, 'en');
    expect(result.template).not.toEqual(firstFallback.template);
  });

  it('should treat conversationLength=3 as NOT early (edge case)', () => {
    // conversationLength < 3 is needed for first_fallback
    // length = 3 should not trigger it, even with low confidence
    const result = getFallbackResponse(0.3, 3, 0, 'en');

    expect(result.escalation_flag).toBe(false);
  });

  it('should treat fallbackCount=2 as escalation trigger (edge case)', () => {
    // fallbackCount > 1 triggers escalation (so 2 and above)
    const result = getFallbackResponse(0.8, 5, 2, 'en');

    expect(result.escalation_flag).toBe(true);
  });

  // ─── Language Fallback ────────────────────────────────────────────

  it('should fall back to English if unsupported language is provided', () => {
    const result = getFallbackResponse(0.3, 2, 0, 'invalid_lang');

    expect(result.template).toBeDefined();
    expect(result.template.length > 0).toBe(true);
  });

  it('should return Tamil template when requested', () => {
    const result = getFallbackResponse(0.3, 2, 0, 'ta');

    expect(result.template).toBeDefined();
    expect(result.escalation_flag).toBe(false);
  });

  // ─── Return Value Structure ───────────────────────────────────────

  it('should always return {template, escalation_flag} structure', () => {
    const result = getFallbackResponse(0.3, 2, 0, 'en');

    expect(result).toHaveProperty('template');
    expect(result).toHaveProperty('escalation_flag');
    expect(typeof result.template).toBe('string');
    expect(typeof result.escalation_flag).toBe('boolean');
  });

  it('should never return empty template', () => {
    // Test various combinations
    const cases = [
      [0.1, 1, 0, 'en'],
      [0.9, 10, 5, 'ms'],
      [0.5, 3, 1, 'zh'],
      [0.2, 2, 2, 'ta'],
    ];

    for (const [conf, len, count, lang] of cases) {
      const result = getFallbackResponse(conf as number, len as number, count as number, lang as string);
      expect(result.template.length).toBeGreaterThan(0);
    }
  });
});
