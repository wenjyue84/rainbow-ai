/**
 * Unit tests for OWASP LLM09 Misinformation Guardrail (US-955)
 */
import { describe, it, expect } from 'vitest';
import {
  checkMisinformationRisk,
  isFactualIntent,
  getMisinformationFallback,
} from '../misinformation-guardrail.js';

// ─── isFactualIntent ─────────────────────────────────────────────────

describe('isFactualIntent', () => {
  it('returns true for pricing intents', () => {
    expect(isFactualIntent('pricing')).toBe(true);
    expect(isFactualIntent('price_inquiry')).toBe(true);
    expect(isFactualIntent('room_price')).toBe(true);
  });

  it('returns true for availability intents', () => {
    expect(isFactualIntent('availability')).toBe(true);
    expect(isFactualIntent('room_availability')).toBe(true);
    expect(isFactualIntent('booking_inquiry')).toBe(true);
  });

  it('returns true for policy/rules intents', () => {
    expect(isFactualIntent('rules_policy')).toBe(true);
    expect(isFactualIntent('house_rules')).toBe(true);
    expect(isFactualIntent('cancellation')).toBe(true);
  });

  it('returns true for facilities intents', () => {
    expect(isFactualIntent('facilities_info')).toBe(true);
    expect(isFactualIntent('wifi')).toBe(true);
    expect(isFactualIntent('parking')).toBe(true);
  });

  it('returns true for check-in/out intents', () => {
    expect(isFactualIntent('checkin_info')).toBe(true);
    expect(isFactualIntent('checkout_info')).toBe(true);
  });

  it('returns true for contact/location intents', () => {
    expect(isFactualIntent('contact_info')).toBe(true);
    expect(isFactualIntent('directions')).toBe(true);
    expect(isFactualIntent('location')).toBe(true);
  });

  it('returns false for non-factual intents', () => {
    expect(isFactualIntent('greeting')).toBe(false);
    expect(isFactualIntent('thanks')).toBe(false);
    expect(isFactualIntent('feedback')).toBe(false);
    expect(isFactualIntent('complaint')).toBe(false);
    expect(isFactualIntent('')).toBe(false);
  });
});

// ─── checkMisinformationRisk ─────────────────────────────────────────

describe('checkMisinformationRisk', () => {
  it('passes non-factual queries regardless of KB status', () => {
    const result = checkMisinformationRisk(
      'Hello, how are you?',
      'greeting',
      false,
      []
    );
    expect(result.isFactualQuery).toBe(false);
    expect(result.blocked).toBe(false);
  });

  it('passes factual queries with RAG + topic files', () => {
    const result = checkMisinformationRisk(
      'How much is a room?',
      'pricing',
      true,
      ['pricing.md']
    );
    expect(result.isFactualQuery).toBe(true);
    expect(result.retrievalUsed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.groundingConfidence).toBe(1.0);
  });

  it('passes factual queries with regex topic files (no RAG)', () => {
    const result = checkMisinformationRisk(
      'What time is checkout?',
      'checkout_info',
      false,
      ['checkin-times.md']
    );
    expect(result.isFactualQuery).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.groundingConfidence).toBe(0.6);
  });

  it('blocks factual queries with NO topic files', () => {
    const result = checkMisinformationRisk(
      'What is the WiFi password?',
      'wifi',
      false,
      []
    );
    expect(result.isFactualQuery).toBe(true);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe('no_topic_files');
    expect(result.groundingConfidence).toBe(0.0);
  });

  it('blocks when factual message detected even with non-factual intent', () => {
    const result = checkMisinformationRisk(
      'How much does a room cost per night?',
      'unknown',
      false,
      []
    );
    expect(result.isFactualQuery).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it('does not block when disabled via config', () => {
    const result = checkMisinformationRisk(
      'What is the price?',
      'pricing',
      false,
      [],
      { enabled: false }
    );
    expect(result.blocked).toBe(false);
  });

  it('does not block factual when block_ungrounded_factual is false', () => {
    const result = checkMisinformationRisk(
      'What is the price?',
      'pricing',
      false,
      [],
      { block_ungrounded_factual: false }
    );
    expect(result.blocked).toBe(false);
    expect(result.groundingConfidence).toBe(0.0);
  });

  it('returns source documents in result', () => {
    const result = checkMisinformationRisk(
      'What are the house rules?',
      'rules_policy',
      true,
      ['houserules.md', 'rules-quiet-smoking.md']
    );
    expect(result.sourceDocuments).toEqual(['houserules.md', 'rules-quiet-smoking.md']);
  });

  it('detects factual queries via message patterns (multilingual)', () => {
    // Malay: "berapa harga" = "how much"
    const malay = checkMisinformationRisk(
      'berapa harga satu malam?',
      'unknown',
      false,
      []
    );
    expect(malay.isFactualQuery).toBe(true);
    expect(malay.blocked).toBe(true);

    // Chinese query ending with ? (ASCII) triggers factual detection
    const chinese = checkMisinformationRisk(
      'room price how much?',
      'unknown',
      false,
      []
    );
    expect(chinese.isFactualQuery).toBe(true);
    expect(chinese.blocked).toBe(true);
  });
});

// ─── getMisinformationFallback ────────────────────────────────────────

describe('getMisinformationFallback', () => {
  it('returns English fallback by default', () => {
    const fallback = getMisinformationFallback('en');
    expect(fallback).toContain("don't have that specific information");
    expect(fallback).toContain('+60');
  });

  it('returns Malay fallback', () => {
    const fallback = getMisinformationFallback('ms');
    expect(fallback).toContain('tiada maklumat');
  });

  it('returns Chinese fallback', () => {
    const fallback = getMisinformationFallback('zh');
    expect(fallback).toContain('知识库');
  });

  it('falls back to English for unknown language', () => {
    const fallback = getMisinformationFallback('xx');
    expect(fallback).toContain("don't have that specific information");
  });
});
