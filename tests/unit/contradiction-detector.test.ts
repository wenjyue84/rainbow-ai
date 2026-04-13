/**
 * Unit tests for keyword contradiction detection (US-573)
 *
 * Verifies that detectKeywordContradictions correctly identifies ambiguous messages
 * where multiple intents have conflicting keyword matches within 15% of the top score.
 */

import { describe, it, expect } from 'vitest';
import { detectKeywordContradictions, type TopScore } from '../../src/assistant/classifier/contradiction-detector.js';

describe('detectKeywordContradictions (US-573)', () => {
  it('detects contradiction when booking and cancel intents are both strong (within 15%)', () => {
    const message = 'I want to book a room but cancel my reservation';
    const matches: TopScore[] = [
      { intent: 'booking', score: 0.82, matchedKeyword: 'book' },
      { intent: 'cancel', score: 0.79, matchedKeyword: 'cancel' },
      { intent: 'greeting', score: 0.45, matchedExample: 'hello' },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.hasContradiction).toBe(true);
    expect(result.conflicting_intents).toContain('booking');
    expect(result.conflicting_intents).toContain('cancel');
    expect(result.conflicting_intents.length).toBe(2);
  });

  it('does not flag contradiction when single intent is dominant (not within 15%)', () => {
    const message = 'I want to book a room for next week';
    const matches: TopScore[] = [
      { intent: 'booking', score: 0.95, matchedKeyword: 'book' },
      { intent: 'cancel', score: 0.65, matchedKeyword: 'cancel' },
      { intent: 'greeting', score: 0.30 },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.hasContradiction).toBe(false);
    expect(result.conflicting_intents.length).toBe(0);
  });

  it('returns no contradiction when only 1 match exists', () => {
    const message = 'hello';
    const matches: TopScore[] = [
      { intent: 'greeting', score: 0.95, matchedKeyword: 'hello' },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.hasContradiction).toBe(false);
    expect(result.conflicting_intents.length).toBe(0);
  });

  it('returns no contradiction when matches array is empty', () => {
    const message = 'test message';
    const matches: TopScore[] = [];

    const result = detectKeywordContradictions(message, matches);

    expect(result.hasContradiction).toBe(false);
    expect(result.conflicting_intents.length).toBe(0);
  });

  it('detects contradiction when 3+ intents are within 15% of top score', () => {
    const message = 'book, cancel, or modify my reservation';
    const matches: TopScore[] = [
      { intent: 'booking', score: 0.80, matchedKeyword: 'book' },
      { intent: 'cancel', score: 0.78, matchedKeyword: 'cancel' },
      { intent: 'modification', score: 0.76, matchedKeyword: 'modify' },
      { intent: 'inquiry', score: 0.50 },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.hasContradiction).toBe(true);
    expect(result.conflicting_intents).toContain('booking');
    expect(result.conflicting_intents).toContain('cancel');
    expect(result.conflicting_intents).toContain('modification');
    expect(result.conflicting_intents.length).toBe(3);
  });

  it('correctly calculates 15% threshold from top score', () => {
    // Top score: 0.80
    // 15% of 0.80 = 0.12
    // So range is 0.80 - 0.12 = 0.68 to 0.80
    const message = 'test';
    const matches: TopScore[] = [
      { intent: 'intent_a', score: 0.80 }, // top
      { intent: 'intent_b', score: 0.69 }, // within range (0.80 - 0.69 = 0.11 < 0.12)
      { intent: 'intent_c', score: 0.67 }, // outside range (0.80 - 0.67 = 0.13 > 0.12)
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.hasContradiction).toBe(true);
    expect(result.conflicting_intents).toContain('intent_a');
    expect(result.conflicting_intents).toContain('intent_b');
    expect(result.conflicting_intents).not.toContain('intent_c'); // intent_c should NOT be in the list
    expect(result.conflicting_intents.length).toBe(2);
  });

  it('includes top 3 scores in result regardless of contradiction status', () => {
    const message = 'test';
    const matches: TopScore[] = [
      { intent: 'intent_a', score: 0.95 },
      { intent: 'intent_b', score: 0.85 },
      { intent: 'intent_c', score: 0.75 },
      { intent: 'intent_d', score: 0.45 },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.top_scores.length).toBe(3);
    expect(result.top_scores[0]).toEqual({ intent: 'intent_a', score: 0.95 });
    expect(result.top_scores[1]).toEqual({ intent: 'intent_b', score: 0.85 });
    expect(result.top_scores[2]).toEqual({ intent: 'intent_c', score: 0.75 });
  });

  it('handles unsorted matches by sorting internally', () => {
    const message = 'test';
    // Deliberately unsorted
    const matches: TopScore[] = [
      { intent: 'intent_c', score: 0.70 },
      { intent: 'intent_a', score: 0.85 },
      { intent: 'intent_b', score: 0.80 },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.top_scores[0].intent).toBe('intent_a');
    expect(result.top_scores[0].score).toBe(0.85);
  });

  it('returns empty conflicting_intents when no contradiction exists', () => {
    const message = 'clear single intent';
    const matches: TopScore[] = [
      { intent: 'greeting', score: 0.98 },
      { intent: 'help', score: 0.40 },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.hasContradiction).toBe(false);
    expect(result.conflicting_intents).toEqual([]);
  });

  it('returns top_scores as {intent, score} tuples without extra metadata', () => {
    const message = 'test';
    const matches: TopScore[] = [
      { intent: 'booking', score: 0.90, matchedKeyword: 'book', matchedExample: 'book a room' },
      { intent: 'cancel', score: 0.85, matchedKeyword: 'cancel' },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.top_scores).toEqual([
      { intent: 'booking', score: 0.90 },
      { intent: 'cancel', score: 0.85 },
    ]);
    expect(result.top_scores[0]).not.toHaveProperty('matchedKeyword');
  });

  it('handles case where all matches are near top score', () => {
    const message = 'test';
    const matches: TopScore[] = [
      { intent: 'intent_a', score: 0.80 },
      { intent: 'intent_b', score: 0.79 },
      { intent: 'intent_c', score: 0.78 },
      { intent: 'intent_d', score: 0.77 },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.hasContradiction).toBe(true);
    expect(result.conflicting_intents.length).toBeGreaterThanOrEqual(2);
  });

  it('sets hasContradiction to false for single match', () => {
    const message = 'hello world';
    const matches: TopScore[] = [
      { intent: 'greeting', score: 0.95 },
    ];

    const result = detectKeywordContradictions(message, matches);

    expect(result.hasContradiction).toBe(false);
    expect(result.conflicting_intents).toEqual([]);
  });
});
