/**
 * Tests for US-213: Intent Keyword Suggestion Engine
 *
 * Covers:
 * - TF-IDF extracts domain-specific terms from escalated messages
 * - Generic/stop-word terms are excluded (not generic terms)
 * - analyzeEscalations groups messages correctly and returns proper output
 * - Output structure matches the suggestion-output schema constraints
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  tokenize,
  computeTfIdf,
  analyzeEscalations,
  type EscalationRow,
} from '../../src/tools/suggest-keywords.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, '../../schemas/suggestion-output.schema.json');

// ─── Tokenizer ───────────────────────────────────────────────────────────────

describe('tokenize()', () => {
  it('filters out stop words', () => {
    const tokens = tokenize('hello hi yes please thank ok');
    expect(tokens).toHaveLength(0);
  });

  it('keeps domain-specific terms', () => {
    const tokens = tokenize('checkin early morning airport shuttle');
    expect(tokens).toContain('checkin');
    expect(tokens).toContain('early');
    expect(tokens).toContain('morning');
    expect(tokens).toContain('airport');
    expect(tokens).toContain('shuttle');
  });

  it('lowercases all tokens', () => {
    const tokens = tokenize('CheckIn EARLY Airport');
    expect(tokens.every(t => t === t.toLowerCase())).toBe(true);
  });

  it('filters out tokens shorter than 3 chars', () => {
    const tokens = tokenize('at do me by so');
    expect(tokens.every(t => t.length >= 3)).toBe(true);
  });

  it('excludes numbers', () => {
    const tokens = tokenize('room 101 available');
    expect(tokens.every(t => !/\d/.test(t))).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
});

// ─── TF-IDF ──────────────────────────────────────────────────────────────────

describe('computeTfIdf()', () => {
  it('returns a result for each intent that has suggestions', () => {
    const messages = new Map([
      ['booking_inquiry', ['room available tonight', 'book double room next week']],
      ['checkin_request', ['early checkin possible', 'can checkin before noon']],
    ]);
    const existing = new Map<string, Set<string>>();
    const results = computeTfIdf(messages, existing);
    const intentIds = results.map(r => r.intent_id);
    // Both intents should be represented
    expect(intentIds).toContain('booking_inquiry');
    expect(intentIds).toContain('checkin_request');
  });

  it('suggests keywords from actual guest message content, not generic terms', () => {
    const messages = new Map([
      ['booking_inquiry', [
        'room available tonight',
        'book double room next week',
        'room price for two nights',
        'double room booking',
      ]],
    ]);
    const existing = new Map<string, Set<string>>();
    const results = computeTfIdf(messages, existing);

    const result = results.find(r => r.intent_id === 'booking_inquiry');
    expect(result).toBeDefined();

    // Suggestions should be content words, not stop words
    const stopWords = new Set(['the', 'is', 'ok', 'yes', 'please', 'hello', 'hi', 'thanks', 'not', 'do']);
    for (const kw of result!.suggested_keywords) {
      expect(stopWords.has(kw)).toBe(false);
    }
  });

  it('returns at most 3 suggestions per intent by default', () => {
    const messages = new Map([
      ['booking_inquiry', [
        'room available tonight',
        'book double room next week',
        'room price overnight',
      ]],
    ]);
    const existing = new Map<string, Set<string>>();
    const results = computeTfIdf(messages, existing);
    const result = results.find(r => r.intent_id === 'booking_inquiry');
    if (result) {
      expect(result.suggested_keywords.length).toBeLessThanOrEqual(3);
    }
  });

  it('excludes already-registered keywords from suggestions', () => {
    const messages = new Map([
      ['booking_inquiry', [
        'room available tonight',
        'book double room next week',
        'room price for stay',
      ]],
    ]);
    // Pre-register "room" and "book" as existing keywords
    const existing = new Map<string, Set<string>>([
      ['booking_inquiry', new Set(['room', 'book'])],
    ]);
    const results = computeTfIdf(messages, existing);
    const result = results.find(r => r.intent_id === 'booking_inquiry');

    if (result) {
      expect(result.suggested_keywords).not.toContain('room');
      expect(result.suggested_keywords).not.toContain('book');
    }
  });

  it('handles empty message map', () => {
    const results = computeTfIdf(new Map(), new Map());
    expect(results).toEqual([]);
  });
});

// ─── analyzeEscalations ──────────────────────────────────────────────────────

describe('analyzeEscalations()', () => {
  it('groups messages by intent and returns suggestions', () => {
    const rows: EscalationRow[] = [
      { original_intent: 'booking_inquiry', message_preview: 'room available tonight', confidence_score: 0.3, profile: 'pelangi', timestamp: new Date() },
      { original_intent: 'booking_inquiry', message_preview: 'book double room weekend', confidence_score: 0.25, profile: 'pelangi', timestamp: new Date() },
      { original_intent: 'checkin_request', message_preview: 'early checkin tomorrow', confidence_score: 0.35, profile: 'pelangi', timestamp: new Date() },
    ];

    const existing = new Map<string, Set<string>>();
    const results = analyzeEscalations(rows, existing);

    expect(Array.isArray(results)).toBe(true);
    // Should have results for both intents
    const intentIds = results.map(r => r.intent_id);
    expect(intentIds).toContain('booking_inquiry');
    expect(intentIds).toContain('checkin_request');
  });

  it('skips rows with null message_preview', () => {
    const rows: EscalationRow[] = [
      { original_intent: 'booking_inquiry', message_preview: null, confidence_score: 0.3, profile: 'pelangi', timestamp: new Date() },
    ];
    const results = analyzeEscalations(rows, new Map());
    expect(results).toEqual([]);
  });

  it('returns empty array for empty rows', () => {
    expect(analyzeEscalations([], new Map())).toEqual([]);
  });
});

// ─── Output Schema compliance ────────────────────────────────────────────────

describe('Suggestion output schema', () => {
  it('schema file exists and is valid JSON with required fields', () => {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    expect(schema.$schema).toBeDefined();
    expect(schema.type).toBe('array');
    expect(schema.items.required).toContain('intent_id');
    expect(schema.items.required).toContain('current_keyword_count');
    expect(schema.items.required).toContain('suggested_keywords');
    expect(schema.items.required).toContain('estimated_accuracy_boost_percent');
  });

  it('analyzeEscalations output matches schema constraints', () => {
    const rows: EscalationRow[] = [
      { original_intent: 'booking_inquiry', message_preview: 'room available overnight double', confidence_score: 0.3, profile: 'makan', timestamp: new Date() },
      { original_intent: 'booking_inquiry', message_preview: 'book room next weekend stay', confidence_score: 0.28, profile: 'makan', timestamp: new Date() },
    ];
    const results = analyzeEscalations(rows, new Map());

    for (const item of results) {
      // intent_id: non-empty string
      expect(typeof item.intent_id).toBe('string');
      expect(item.intent_id.length).toBeGreaterThan(0);
      // current_keyword_count: non-negative integer
      expect(typeof item.current_keyword_count).toBe('number');
      expect(item.current_keyword_count).toBeGreaterThanOrEqual(0);
      // suggested_keywords: array of strings, max 3
      expect(Array.isArray(item.suggested_keywords)).toBe(true);
      expect(item.suggested_keywords.length).toBeLessThanOrEqual(3);
      expect(item.suggested_keywords.every(k => typeof k === 'string')).toBe(true);
      // estimated_accuracy_boost_percent: 0-100
      expect(item.estimated_accuracy_boost_percent).toBeGreaterThanOrEqual(0);
      expect(item.estimated_accuracy_boost_percent).toBeLessThanOrEqual(100);
    }
  });
});
