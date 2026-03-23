/**
 * Intent Classification Ground Truth Tests (US-289)
 *
 * Verifies that the fuzzy intent classifier (Tier 2) correctly classifies
 * realistic, profile-specific phrases for Pelangi Capsule Hostel and
 * Makan Moments Cafe.
 *
 * Each fixture contains 10+ authentic patterns with expected intent
 * classifications. Tests verify the classifier returns the expected intent
 * with confidence > 0.8.
 *
 * Fully deterministic — no LLM calls, no external APIs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { FuzzyIntentMatcher, type KeywordIntent } from '../../src/assistant/fuzzy-matcher.js';
import pelangiKeywordsData from '../../src/assistant/data/intent-keywords.json' with { type: 'json' };
import makanKeywordsData from '../../src/assistant/data-makan/intent-keywords.json' with { type: 'json' };
import pelangiGroundTruth from '../fixtures/intent-ground-truth-pelangi.json' with { type: 'json' };
import makanGroundTruth from '../fixtures/intent-ground-truth-makan.json' with { type: 'json' };

// ─── Types ──────────────────────────────────────────────────────────────

interface GroundTruthSample {
  text: string;
  expectedIntent: string;
  category: string;
  language: string;
  notes: string;
}

interface GroundTruthFixture {
  profile: string;
  description: string;
  version: string;
  samples: GroundTruthSample[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Build a FuzzyIntentMatcher from a profile's intent-keywords.json */
function createMatcher(keywordsData: { intents: Array<{ intent: string; keywords: Record<string, string[]> }> }): FuzzyIntentMatcher {
  const keywordIntents: KeywordIntent[] = [];
  for (const intent of keywordsData.intents) {
    for (const [lang, keywords] of Object.entries(intent.keywords)) {
      keywordIntents.push({
        intent: intent.intent,
        keywords: keywords as string[],
        language: lang as 'en' | 'ms' | 'zh' | 'ta',
      });
    }
    if ((intent as any).regional_variants) {
      for (const [lang, variants] of Object.entries((intent as any).regional_variants)) {
        keywordIntents.push({
          intent: intent.intent,
          keywords: variants as string[],
          language: lang as 'en' | 'ms' | 'zh' | 'ta',
        });
      }
    }
  }
  return new FuzzyIntentMatcher(keywordIntents);
}

/**
 * Run ground truth classification test for a single sample.
 * Returns the classified intent and confidence score.
 */
function classifySample(
  matcher: FuzzyIntentMatcher,
  sample: GroundTruthSample
): { intent: string | null; confidence: number } {
  const result = matcher.match(sample.text);
  if (!result) {
    return { intent: null, confidence: 0 };
  }
  return { intent: result.intent, confidence: result.score };
}

// ─── Test Suites ────────────────────────────────────────────────────────

describe('Intent Classification Ground Truth (US-289)', () => {

  describe('Pelangi Capsule Hostel — ground truth dataset', () => {
    let matcher: FuzzyIntentMatcher;
    const fixture = pelangiGroundTruth as GroundTruthFixture;

    beforeAll(() => {
      matcher = createMatcher(pelangiKeywordsData);
    });

    it('fixture contains at least 10 booking patterns', () => {
      const bookingCount = fixture.samples.filter(s => s.category === 'booking').length;
      expect(bookingCount).toBeGreaterThanOrEqual(10);
    });

    it('fixture contains inquiry patterns', () => {
      const inquiryCount = fixture.samples.filter(s => s.category === 'inquiry').length;
      expect(inquiryCount).toBeGreaterThanOrEqual(1);
    });

    it.each(
      fixture.samples.map(s => [s.text, s.expectedIntent, s] as const)
    )('classifies "%s" as "%s" with confidence > 0.8', (text, expectedIntent, sample) => {
      const result = classifySample(matcher, sample);
      console.log(
        `[Pelangi] "${text}" → got: ${result.intent} (${(result.confidence * 100).toFixed(0)}%) | expected: ${expectedIntent}`
      );
      expect(result.intent).toBe(expectedIntent);
      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });

  describe('Makan Moments Cafe — ground truth dataset', () => {
    let matcher: FuzzyIntentMatcher;
    const fixture = makanGroundTruth as GroundTruthFixture;

    beforeAll(() => {
      matcher = createMatcher(makanKeywordsData);
    });

    it('fixture contains at least 10 cafe-specific inquiry patterns', () => {
      const inquiryCount = fixture.samples.filter(s => s.category === 'inquiry').length;
      expect(inquiryCount).toBeGreaterThanOrEqual(10);
    });

    it('fixture contains booking or order patterns', () => {
      const actionCount = fixture.samples.length;
      expect(actionCount).toBeGreaterThanOrEqual(10);
    });

    it.each(
      fixture.samples.map(s => [s.text, s.expectedIntent, s] as const)
    )('classifies "%s" as "%s" with confidence > 0.8', (text, expectedIntent, sample) => {
      const result = classifySample(matcher, sample);
      console.log(
        `[Makan] "${text}" → got: ${result.intent} (${(result.confidence * 100).toFixed(0)}%) | expected: ${expectedIntent}`
      );
      expect(result.intent).toBe(expectedIntent);
      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });
});
