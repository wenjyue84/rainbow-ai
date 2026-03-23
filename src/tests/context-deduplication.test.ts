/**
 * US-317: Conversation Context Semantic Deduplication Filter
 *
 * Tests:
 * 1. Exact duplicates are removed (first occurrence preserved)
 * 2. Paraphrases are deduplicated when similarity exceeds threshold
 * 3. Single message input is preserved unchanged
 * 4. Empty context (no messages) is handled gracefully
 */
import { describe, test, expect } from 'vitest';

import {
  deduplicateContextMessages,
  levenshteinSimilarity,
  levenshteinDistance,
} from '../assistant/pipeline/context-manager.js';
import type { ChatMessage } from '../assistant/types.js';

/** Helper to create a ChatMessage. */
function msg(role: 'user' | 'assistant', content: string): ChatMessage {
  return { role, content, timestamp: Date.now() };
}

describe('US-317: Conversation Context Semantic Deduplication Filter', () => {
  // ─── AC-1 / AC-2: Core deduplication behaviour ───────────────────

  test('exact duplicates are removed, first occurrence preserved', () => {
    const messages: ChatMessage[] = [
      msg('user', 'I want to book a room'),
      msg('assistant', 'Sure! What dates would you like?'),
      msg('user', 'I want to book a room'),          // exact dup
      msg('assistant', 'Sure! What dates would you like?'), // exact dup
      msg('user', 'March 25 to March 27'),
    ];

    const result = deduplicateContextMessages(messages);

    expect(result).toHaveLength(3);
    expect(result[0].content).toBe('I want to book a room');
    expect(result[1].content).toBe('Sure! What dates would you like?');
    expect(result[2].content).toBe('March 25 to March 27');
  });

  test('paraphrases are deduplicated when similarity exceeds threshold', () => {
    const messages: ChatMessage[] = [
      msg('user', 'I want to book a room for 2 nights'),
      msg('assistant', 'Of course! What dates do you prefer?'),
      msg('user', 'I want to book a room for two nights'), // near-dup (2 vs two)
      msg('user', 'How much does a single bed cost?'),     // distinct message
    ];

    // The first and third user messages should have high Levenshtein
    // similarity ("2" vs "two" is a minor edit) and be deduplicated
    const sim = levenshteinSimilarity(
      'I want to book a room for 2 nights',
      'I want to book a room for two nights',
    );
    expect(sim).toBeGreaterThanOrEqual(0.85);

    const result = deduplicateContextMessages(messages, 0.85);

    // Should keep: first user msg, assistant msg, distinct user msg (3 total)
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe('I want to book a room for 2 nights');
    expect(result[1].content).toBe('Of course! What dates do you prefer?');
    expect(result[2].content).toBe('How much does a single bed cost?');
  });

  test('single message input is preserved unchanged', () => {
    const messages: ChatMessage[] = [
      msg('user', 'Hello'),
    ];

    const result = deduplicateContextMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hello');
  });

  test('empty context is handled gracefully', () => {
    const result = deduplicateContextMessages([]);
    expect(result).toEqual([]);

    // Also handles null-ish / undefined input defensively
    const resultNull = deduplicateContextMessages(
      null as unknown as ChatMessage[],
    );
    expect(resultNull).toEqual([]);
  });

  // ─── Additional coverage ─────────────────────────────────────────

  test('messages below similarity threshold are both kept', () => {
    const messages: ChatMessage[] = [
      msg('user', 'I want to book a room'),
      msg('user', 'What are the facilities available?'),
    ];

    const sim = levenshteinSimilarity(
      'I want to book a room',
      'What are the facilities available?',
    );
    expect(sim).toBeLessThan(0.85);

    const result = deduplicateContextMessages(messages, 0.85);
    expect(result).toHaveLength(2);
  });

  test('deduplication is role-scoped — identical user and assistant messages both kept', () => {
    const messages: ChatMessage[] = [
      msg('user', 'booking confirmed'),
      msg('assistant', 'booking confirmed'),
    ];

    const result = deduplicateContextMessages(messages);
    // Same content but different roles — both should be kept
    expect(result).toHaveLength(2);
  });
});

// ─── Levenshtein helpers unit tests ─────────────────────────────────

describe('levenshteinDistance', () => {
  test('identical strings return 0', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  test('empty vs non-empty returns length', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  test('single-character edit returns 1', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1); // substitution
    expect(levenshteinDistance('cat', 'cats')).toBe(1); // insertion
    expect(levenshteinDistance('cats', 'cat')).toBe(1); // deletion
  });
});

describe('levenshteinSimilarity', () => {
  test('identical strings return 1.0', () => {
    expect(levenshteinSimilarity('hello world', 'hello world')).toBe(1.0);
  });

  test('completely different strings return low score', () => {
    expect(levenshteinSimilarity('abcdef', 'zyxwvu')).toBeLessThan(0.3);
  });

  test('normalises whitespace and case before comparing', () => {
    expect(
      levenshteinSimilarity('  Hello  World  ', 'hello world'),
    ).toBe(1.0);
  });
});
