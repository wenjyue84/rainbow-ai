/**
 * disambiguator.test.ts — Tests for multi-intent disambiguation
 *
 * US-551: Generate Clarifying Questions for Ambiguous Multi-Intent Classifications
 */

import { describe, it, expect } from 'vitest';
import {
  detectAmbiguity,
  generateDisambiguationPrompt,
  parseIntentSelection,
  isStillAmbiguous,
  type IntentCandidate
} from '../../src/assistant/disambiguator.js';

// ─── Ambiguity Detection Tests ───────────────────────────────────────

describe('detectAmbiguity', () => {
  it('should detect ambiguity when top 2 intents within 5% confidence', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.65 },
      { intent: 'inquiry', confidence: 0.62 }
    ];
    expect(detectAmbiguity(intents)).toBe(true);
  });

  it('should detect ambiguity when difference is exactly 5%', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.65 },
      { intent: 'inquiry', confidence: 0.60 }
    ];
    expect(detectAmbiguity(intents)).toBe(true);
  });

  it('should not detect ambiguity when difference exceeds 5%', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.70 },
      { intent: 'inquiry', confidence: 0.64 }
    ];
    expect(detectAmbiguity(intents)).toBe(false);
  });

  it('should not detect ambiguity with single intent', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.75 }
    ];
    expect(detectAmbiguity(intents)).toBe(false);
  });

  it('should not detect ambiguity with empty list', () => {
    const intents: IntentCandidate[] = [];
    expect(detectAmbiguity(intents)).toBe(false);
  });

  it('should detect ambiguity with 3+ intents within 5%', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.67 },
      { intent: 'inquiry', confidence: 0.65 },
      { intent: 'general', confidence: 0.63 }
    ];
    expect(detectAmbiguity(intents)).toBe(true);
  });
});

// ─── Disambiguation Prompt Generation Tests ──────────────────────────

describe('generateDisambiguationPrompt', () => {
  it('should throw error with less than 2 intents', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.75 }
    ];
    expect(() => generateDisambiguationPrompt(intents)).toThrow();
  });

  it('should generate English prompt from template', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.65 },
      { intent: 'inquiry', confidence: 0.62 }
    ];
    const prompt = generateDisambiguationPrompt(intents, 'en');

    expect(prompt.question).toBeDefined();
    expect(prompt.question.length).toBeGreaterThan(0);
    expect(prompt.options).toHaveLength(2);
    expect(prompt.options[0].intent).toBe('booking');
    expect(prompt.options[1].intent).toBe('inquiry');
    expect(prompt.context_id).toBeDefined();
    expect(prompt.context_id).toMatch(/^disambig_\d+_/);
  });

  it('should generate Malay prompt for non-English language', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.65 },
      { intent: 'inquiry', confidence: 0.62 }
    ];
    const prompt = generateDisambiguationPrompt(intents, 'ms');

    expect(prompt.question).toBeDefined();
    expect(prompt.options).toHaveLength(2);
    // Should use Malay template if available
    expect(prompt.question).toBeTruthy();
  });

  it('should generate Chinese prompt', () => {
    const intents: IntentCandidate[] = [
      { intent: 'checkout_info', confidence: 0.63 },
      { intent: 'luggage_storage', confidence: 0.62 }
    ];
    const prompt = generateDisambiguationPrompt(intents, 'zh');

    expect(prompt.question).toBeDefined();
    expect(prompt.options).toHaveLength(2);
  });

  it('should generate Tamil prompt', () => {
    const intents: IntentCandidate[] = [
      { intent: 'availability', confidence: 0.65 },
      { intent: 'pricing', confidence: 0.63 }
    ];
    const prompt = generateDisambiguationPrompt(intents, 'ta');

    expect(prompt.question).toBeDefined();
    expect(prompt.options).toHaveLength(2);
  });

  it('should use fallback template for unknown intent pair', () => {
    const intents: IntentCandidate[] = [
      { intent: 'unknown_intent_x', confidence: 0.65 },
      { intent: 'unknown_intent_y', confidence: 0.62 }
    ];
    const prompt = generateDisambiguationPrompt(intents, 'en');

    expect(prompt.question).toContain('unknown_intent_x');
    expect(prompt.question).toContain('unknown_intent_y');
    expect(prompt.options).toHaveLength(2);
  });

  it('should generate unique context IDs for each prompt', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.65 },
      { intent: 'inquiry', confidence: 0.62 }
    ];
    const prompt1 = generateDisambiguationPrompt(intents, 'en');
    const prompt2 = generateDisambiguationPrompt(intents, 'en');

    expect(prompt1.context_id).not.toBe(prompt2.context_id);
  });

  it('should only use top 2 intents for options', () => {
    const intents: IntentCandidate[] = [
      { intent: 'booking', confidence: 0.65 },
      { intent: 'inquiry', confidence: 0.62 },
      { intent: 'general', confidence: 0.61 }
    ];
    const prompt = generateDisambiguationPrompt(intents, 'en');

    expect(prompt.options).toHaveLength(2);
    expect(prompt.options[0].intent).toBe('booking');
    expect(prompt.options[1].intent).toBe('inquiry');
  });
});

// ─── Intent Selection Parsing Tests ──────────────────────────────────

describe('parseIntentSelection', () => {
  const options = [
    { intent: 'booking', label: 'Making a new booking' },
    { intent: 'inquiry', label: 'Inquiring about a booking' }
  ];

  it('should parse selection by full label match', () => {
    const response = 'I want to make a new booking';
    const result = parseIntentSelection(response, options);
    expect(result).toBe('booking');
  });

  it('should parse selection by partial label match (case-insensitive)', () => {
    const response = 'new booking';
    const result = parseIntentSelection(response, options);
    expect(result).toBe('booking');
  });

  it('should parse selection by intent name', () => {
    const response = 'inquiry';
    const result = parseIntentSelection(response, options);
    expect(result).toBe('inquiry');
  });

  it('should parse numeric selection "1"', () => {
    const response = '1';
    const result = parseIntentSelection(response, options);
    expect(result).toBe('booking');
  });

  it('should parse numeric selection "2"', () => {
    const response = '2';
    const result = parseIntentSelection(response, options);
    expect(result).toBe('inquiry');
  });

  it('should parse text-based numeric selection "first"', () => {
    const response = 'first';
    const result = parseIntentSelection(response, options);
    expect(result).toBe('booking');
  });

  it('should parse text-based numeric selection "second" (case-insensitive)', () => {
    const response = 'SECOND';
    const result = parseIntentSelection(response, options);
    expect(result).toBe('inquiry');
  });

  it('should return null for unmatched selection', () => {
    const response = 'something else entirely';
    const result = parseIntentSelection(response, options);
    expect(result).toBeNull();
  });

  it('should handle whitespace in response', () => {
    const response = '  booking  ';
    const result = parseIntentSelection(response, options);
    expect(result).toBe('booking');
  });
});

// ─── Ambiguity Check Tests ──────────────────────────────────────────

describe('isStillAmbiguous', () => {
  it('should detect "both" as still ambiguous', () => {
    expect(isStillAmbiguous('both')).toBe(true);
  });

  it('should detect "either" as still ambiguous', () => {
    expect(isStillAmbiguous('either')).toBe(true);
  });

  it('should detect "don\'t know" as still ambiguous', () => {
    expect(isStillAmbiguous("don't know")).toBe(true);
  });

  it('should detect "dunno" as still ambiguous (case-insensitive)', () => {
    expect(isStillAmbiguous('DUNNO')).toBe(true);
  });

  it('should not detect clear selections as ambiguous', () => {
    expect(isStillAmbiguous('booking')).toBe(false);
  });

  it('should not detect numeric selections as ambiguous', () => {
    expect(isStillAmbiguous('1')).toBe(false);
  });

  it('should handle complex responses with ambiguous phrases', () => {
    expect(isStillAmbiguous('I think either one works')).toBe(true);
  });

  it('should handle complex responses without ambiguous phrases', () => {
    expect(isStillAmbiguous('I want to book a room please')).toBe(false);
  });
});
