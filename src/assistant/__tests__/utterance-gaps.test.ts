/**
 * Tests for utterance gap recording utilities (US-432)
 */
import { describe, it, expect } from 'vitest';
import { normalizeUtterance, isIntentGap } from '../pipeline/utterance-gap-recorder.js';

describe('normalizeUtterance', () => {
  it('lowercases text', () => {
    expect(normalizeUtterance('Hello World')).toBe('hello world');
  });

  it('strips punctuation', () => {
    expect(normalizeUtterance('Hello, World!')).toBe('hello world');
    expect(normalizeUtterance('what?!?')).toBe('what');
  });

  it('collapses whitespace', () => {
    expect(normalizeUtterance('hello   world   test')).toBe('hello world test');
  });

  it('truncates to 120 characters', () => {
    const long = 'a'.repeat(200);
    expect(normalizeUtterance(long).length).toBe(120);
  });

  it('preserves unicode letters and numbers', () => {
    expect(normalizeUtterance('café 123')).toBe('café 123');
    expect(normalizeUtterance('你好世界')).toBe('你好世界');
  });

  it('handles empty and whitespace-only input', () => {
    expect(normalizeUtterance('')).toBe('');
    expect(normalizeUtterance('   ')).toBe('');
    expect(normalizeUtterance('!!!')).toBe('');
  });
});

describe('isIntentGap', () => {
  it('returns true for T4 LLM fallback sources', () => {
    expect(isIntentGap('tiered-llm-fallback', 0.8)).toBe(true);
    expect(isIntentGap('llm', 0.9)).toBe(true);
    expect(isIntentGap('split-model', 0.7)).toBe(true);
  });

  it('returns true for layer2 fallback', () => {
    expect(isIntentGap('tiered-llm-fallback+layer2', 0.85)).toBe(true);
    expect(isIntentGap('llm+layer2', 0.9)).toBe(true);
  });

  it('returns true for low confidence from any source', () => {
    expect(isIntentGap('fuzzy', 0.3)).toBe(true);
    expect(isIntentGap('semantic', 0.49)).toBe(true);
  });

  it('returns false for high-confidence fast tier matches', () => {
    expect(isIntentGap('fuzzy', 0.95)).toBe(false);
    expect(isIntentGap('regex', 1.0)).toBe(false);
    expect(isIntentGap('semantic', 0.8)).toBe(false);
    expect(isIntentGap('fuzzy+llm-reply', 0.85)).toBe(false);
  });

  it('returns false for undefined source', () => {
    expect(isIntentGap(undefined, 0.5)).toBe(false);
  });
});
