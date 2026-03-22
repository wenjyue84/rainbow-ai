/**
 * US-073: Intent classifier uncertainty analyzer tests.
 *
 * Tests:
 * 1. Low-confidence 'booking' intent with word 'room' identifies booking_keywords
 *    and inquiry_keywords as competing signals with near-equal weights
 * 2. High-confidence predictions still return contributions (no threshold enforced)
 * 3. context_signal is weighted when message contains question mark
 * 4. Unknown intents fall back gracefully
 */

import { describe, it, expect } from 'vitest';
import { analyzeClassificationUncertainty } from '../../assistant/schemas.js';

describe('US-073: analyzeClassificationUncertainty', () => {
  it('identifies booking_keywords and inquiry_keywords as competing signals for ambiguous room message', () => {
    const result = analyzeClassificationUncertainty({
      message: 'do you have a room available?',
      predictedIntent: 'booking',
      confidence: 0.52,
    });

    // Both booking and inquiry signals should be present
    expect(result).toHaveProperty('booking_keywords');
    expect(result).toHaveProperty('inquiry_keywords');

    // They should be near-equal (within 0.25 of each other)
    const diff = Math.abs(result['booking_keywords'] - result['inquiry_keywords']);
    expect(diff).toBeLessThanOrEqual(0.25);
  });

  it('contributions sum to approximately 1.0', () => {
    const result = analyzeClassificationUncertainty({
      message: 'book a room please',
      predictedIntent: 'booking',
      confidence: 0.48,
    });

    const total = Object.values(result).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });

  it('context_signal is present when message contains a question mark', () => {
    const result = analyzeClassificationUncertainty({
      message: 'what rooms are available?',
      predictedIntent: 'booking',
      confidence: 0.55,
    });

    expect(result).toHaveProperty('context_signal');
    expect(result['context_signal']).toBeGreaterThan(0);
  });

  it('cancellation_keywords present for cancellation message', () => {
    const result = analyzeClassificationUncertainty({
      message: 'i want to cancel my booking',
      predictedIntent: 'cancellation',
      confidence: 0.50,
    });

    expect(result).toHaveProperty('cancellation_keywords');
    expect(result['cancellation_keywords']).toBeGreaterThan(0);
  });

  it('booking_keywords dominant for clear booking message', () => {
    const result = analyzeClassificationUncertainty({
      message: 'i want to reserve a room for 2 nights',
      predictedIntent: 'booking',
      confidence: 0.60,
    });

    expect(result).toHaveProperty('booking_keywords');
    // booking_keywords should be one of the top contributors
    const maxContrib = Math.max(...Object.values(result));
    expect(result['booking_keywords']).toBeGreaterThanOrEqual(maxContrib * 0.5);
  });

  it('falls back gracefully for empty message', () => {
    const result = analyzeClassificationUncertainty({
      message: '',
      predictedIntent: 'booking',
      confidence: 0.30,
    });

    // Should return fallback contributions summing to 1.0
    const total = Object.values(result).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });

  it('accepts custom keyword overrides', () => {
    const result = analyzeClassificationUncertainty({
      message: 'banana split please',
      predictedIntent: 'fnb_order',
      confidence: 0.40,
      keywords: {
        fnb_keywords: ['banana', 'split', 'food', 'order', 'menu'],
      },
    });

    expect(result).toHaveProperty('fnb_keywords');
    expect(result['fnb_keywords']).toBeGreaterThan(0);
  });

  it('word "room" specifically triggers both booking_keywords and inquiry_keywords', () => {
    const result = analyzeClassificationUncertainty({
      message: 'room',
      predictedIntent: 'booking',
      confidence: 0.51,
    });

    // "room" appears in both booking_keywords and inquiry_keywords built-in lists
    expect(result['booking_keywords']).toBeGreaterThan(0);
    expect(result['inquiry_keywords']).toBeGreaterThan(0);
  });
});
