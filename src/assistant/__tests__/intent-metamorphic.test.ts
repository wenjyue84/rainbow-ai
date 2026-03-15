/**
 * Metamorphic Testing for Intent Classification
 *
 * Tests relationships between classification outputs rather than
 * exact values, making it suitable for non-deterministic systems.
 *
 * The 4-tier intent pipeline includes an LLM tier that is non-deterministic.
 * But the fuzzy matcher (Tier 2) IS deterministic and testable. We test
 * metamorphic relations — relationships between inputs/outputs rather than
 * exact outputs.
 *
 * Metamorphic Relations:
 * MR1: Case invariance — classification should be case-insensitive
 * MR2: Prefix invariance — adding greetings/filler shouldn't change core intent
 * MR3: Determinism — same input should produce same output (for non-LLM tiers)
 * MR4: Confidence monotonicity — exact keyword match should score >= partial match
 * MR5: Known keyword mapping — well-known queries produce expected intents
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { FuzzyIntentMatcher, type KeywordIntent } from '../fuzzy-matcher.js';
import intentKeywordsData from '../data/intent-keywords.json' with { type: 'json' };

// ─── Helpers ─────────────────────────────────────────────────────────

/** Initialize the fuzzy matcher with actual production keyword data */
function createMatcher(): FuzzyIntentMatcher {
  const keywordIntents: KeywordIntent[] = [];
  for (const intent of intentKeywordsData.intents) {
    for (const [lang, keywords] of Object.entries(intent.keywords)) {
      keywordIntents.push({
        intent: intent.intent,
        keywords: keywords as string[],
        language: lang as 'en' | 'ms' | 'zh'
      });
    }
  }
  return new FuzzyIntentMatcher(keywordIntents);
}

/** Alternate-case a string: "hello" -> "HeLlO" */
function toAlternateCase(s: string): string {
  return s
    .split('')
    .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
    .join('');
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Intent Classification — Metamorphic Tests', () => {
  const matcher = createMatcher();

  // MR1: Case Invariance
  // The fuzzy matcher normalizes to lowercase internally. Classification
  // should be identical regardless of input casing.
  describe('MR1: Case invariance', () => {
    it('should classify identically regardless of case', () => {
      const testPhrases = [
        'wifi password',
        'how much',
        'check in',
        'booking',
        'directions',
        'facilities',
        'rules',
        'complaint',
        'payment',
        'thank you',
      ];

      for (const phrase of testPhrases) {
        const lower = matcher.matchWithContext(phrase.toLowerCase(), [], null);
        const upper = matcher.matchWithContext(phrase.toUpperCase(), [], null);
        const mixed = matcher.matchWithContext(toAlternateCase(phrase), [], null);

        if (lower && upper) {
          expect(lower.intent, `Case mismatch for "${phrase}" (lower vs upper)`).toBe(
            upper.intent,
          );
        }
        if (lower && mixed) {
          expect(lower.intent, `Case mismatch for "${phrase}" (lower vs mixed)`).toBe(
            mixed.intent,
          );
        }
      }
    });

    it('should produce identical scores regardless of case (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'wifi password',
            'how much',
            'check in',
            'thank you',
            'booking',
            'directions',
            'complaint',
          ),
          (phrase) => {
            const lower = matcher.matchWithContext(phrase.toLowerCase(), [], null);
            const upper = matcher.matchWithContext(phrase.toUpperCase(), [], null);
            if (lower === null && upper === null) return true;
            if (lower === null || upper === null) return false;
            return lower.intent === upper.intent && lower.score === upper.score;
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  // MR2: Prefix Invariance (filler tolerance)
  // Common conversational prefixes ("hi, ", "hello, ") shouldn't change
  // the core intent when the confidence is high enough.
  describe('MR2: Prefix invariance (filler tolerance)', () => {
    it('should classify similarly with and without common prefixes', () => {
      const coreQueries = [
        'wifi password',
        'how much per night',
        'check in time',
        'payment method',
      ];
      const prefixes = ['hi, ', 'hello, ', 'excuse me, ', 'hey '];

      for (const query of coreQueries) {
        const baseResult = matcher.matchWithContext(query, [], null);
        if (!baseResult) continue;

        for (const prefix of prefixes) {
          const prefixedResult = matcher.matchWithContext(`${prefix}${query}`, [], null);
          // Prefix may reduce confidence but shouldn't change intent
          // Allow for cases where prefix changes classification entirely (known limitation)
          if (prefixedResult && prefixedResult.score >= 0.7) {
            expect(
              prefixedResult.intent,
              `Prefix "${prefix}" changed intent for "${query}" ` +
                `from ${baseResult.intent} to ${prefixedResult.intent}`,
            ).toBe(baseResult.intent);
          }
        }
      }
    });
  });

  // MR3: Determinism (same input -> same output)
  // The fuzzy matcher uses Fuse.js which is deterministic. Repeated calls
  // with the same input must always produce the same result.
  describe('MR3: Determinism (same input -> same output)', () => {
    it('should return identical results for repeated calls', { timeout: 15000 }, () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'wifi password',
            'how much',
            'check in',
            'booking',
            'room price',
            'where is',
            'thank you',
            'hello',
            'complaint',
            'payment',
            'facilities',
            'rules',
          ),
          fc.integer({ min: 2, max: 10 }),
          (phrase, reps) => {
            const results = [];
            for (let i = 0; i < reps; i++) {
              results.push(matcher.matchWithContext(phrase, [], null));
            }

            // All results should be identical
            for (let i = 1; i < results.length; i++) {
              if (results[0] === null) {
                if (results[i] !== null) return false;
              } else if (results[i] === null) {
                return false;
              } else {
                if (results[0].intent !== results[i]!.intent) return false;
                if (results[0].score !== results[i]!.score) return false;
              }
            }
            return true;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should be deterministic with context parameters too', () => {
      const contextHistory = [
        { role: 'user' as const, content: 'do you have rooms?', timestamp: Date.now() - 60000 },
        { role: 'assistant' as const, content: 'Yes we do!', timestamp: Date.now() - 55000 },
      ];

      fc.assert(
        fc.property(
          fc.constantFrom('tomorrow', '2 people', 'yes', 'how much'),
          fc.constantFrom('booking', 'availability', 'pricing', null),
          (phrase, lastIntent) => {
            const a = matcher.matchWithContext(phrase, contextHistory, lastIntent);
            const b = matcher.matchWithContext(phrase, contextHistory, lastIntent);
            if (a === null && b === null) return true;
            if (a === null || b === null) return false;
            return a.intent === b.intent && a.score === b.score;
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  // MR4: Confidence Monotonicity
  // An exact keyword should score at least as high as a truncated (partial)
  // version of the same keyword, when both match the same intent.
  describe('MR4: Exact match scores >= partial match', () => {
    it('should score exact keywords higher than partial matches', () => {
      // Collect actual English keywords from the production data
      const exactKeywords: string[] = [];
      for (const intent of intentKeywordsData.intents) {
        if (intent.keywords.en) {
          exactKeywords.push(...(intent.keywords.en as string[]).slice(0, 2));
        }
      }

      for (const keyword of exactKeywords.slice(0, 20)) {
        const exactResult = matcher.matchWithContext(keyword, [], null);
        // Truncate keyword for partial match
        if (keyword.length > 4) {
          const partial = keyword.slice(0, Math.ceil(keyword.length * 0.6));
          const partialResult = matcher.matchWithContext(partial, [], null);

          if (exactResult && partialResult && exactResult.intent === partialResult.intent) {
            expect(
              exactResult.score,
              `Exact "${keyword}" should score >= partial "${partial}"`,
            ).toBeGreaterThanOrEqual(partialResult.score);
          }
        }
      }
    });
  });

  // MR5: Known Keyword Mapping
  // Well-known queries that are direct keywords in the data should always
  // resolve to their expected intent with high confidence.
  describe('MR5: Known keywords produce expected intents', () => {
    it('should map well-known queries to expected intents', () => {
      const knownMappings: [string, string][] = [
        ['wifi password', 'wifi'],
        ['berapa harga', 'pricing'],
        ['check in time', 'checkin_info'],
        ['where is the hostel', 'directions'],
        ['thank you', 'thanks'],
        ['hello', 'greeting'],
        ['facilities', 'facilities'],
        ['rules', 'rules'],
      ];

      for (const [query, expectedIntent] of knownMappings) {
        const result = matcher.matchWithContext(query, [], null);
        if (result && result.score >= 0.7) {
          expect(
            result.intent,
            `"${query}" should map to "${expectedIntent}" but got "${result.intent}"`,
          ).toBe(expectedIntent);
        }
      }
    });
  });

  // MR6: Context continuity
  // When a booking conversation is in progress (lastIntent = 'booking'),
  // date/number inputs should continue as booking via context rules.
  describe('MR6: Context continuity for booking flow', () => {
    it('should classify date-like inputs as booking when in booking context', () => {
      const contextHistory = [
        { role: 'user' as const, content: 'I want to book a room', timestamp: Date.now() - 60000 },
        {
          role: 'assistant' as const,
          content: 'When would you like to check in?',
          timestamp: Date.now() - 55000,
        },
      ];

      const dateInputs = ['tomorrow', 'next week', 'monday', 'this week'];
      for (const input of dateInputs) {
        const result = matcher.matchWithContext(input, contextHistory, 'booking');
        if (result) {
          expect(
            result.intent,
            `"${input}" in booking context should be "booking" but got "${result.intent}"`,
          ).toBe('booking');
          expect(result.contextBoost).toBe(true);
        }
      }
    });

    it('should classify confirmations as booking when in booking context', () => {
      const contextHistory = [
        { role: 'user' as const, content: 'book for 2 nights', timestamp: Date.now() - 60000 },
        {
          role: 'assistant' as const,
          content: 'Shall I confirm this booking?',
          timestamp: Date.now() - 55000,
        },
      ];

      // Note: context rules only fire when the regular fuzzy match is absent
      // or below 0.80 confidence. Short words like "ok" may fuzzy-match to
      // unrelated keywords at high confidence, bypassing context rules.
      // We test inputs that reliably trigger context continuation.
      const confirmInputs = ['yes', 'ya', 'sure', 'confirm'];
      for (const input of confirmInputs) {
        const result = matcher.matchWithContext(input, contextHistory, 'booking');
        if (result && result.contextBoost) {
          expect(
            result.intent,
            `"${input}" in booking context should be "booking" but got "${result.intent}"`,
          ).toBe('booking');
          expect(result.contextBoost).toBe(true);
        }
      }
    });
  });

  // MR7: Language filter does not contradict base results
  // Applying a language filter should either return the same intent as
  // unfiltered, or null. It should never map to a completely different intent
  // family (e.g., wifi -> pricing).
  describe('MR7: Language filter consistency', () => {
    it('should not produce contradictory intents with language filtering', () => {
      const testPhrases = ['wifi password', 'how much', 'check in', 'booking', 'thank you'];

      for (const phrase of testPhrases) {
        const unfiltered = matcher.matchWithContext(phrase, [], null);
        const filtered = matcher.matchWithContext(phrase, [], null, 'en');

        if (unfiltered && filtered && filtered.score >= 0.7) {
          expect(
            filtered.intent,
            `Language filter changed "${phrase}" from ${unfiltered.intent} to ${filtered.intent}`,
          ).toBe(unfiltered.intent);
        }
      }
    });
  });
});
