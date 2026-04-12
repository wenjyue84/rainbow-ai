/**
 * US-529: Intent Classification Integration Test Suite
 *
 * Validates T2 fuzzy-keyword classification accuracy per profile with real conversation samples.
 * Accuracy thresholds: >= 85% for booking/inquiry, >= 75% for escalation.
 *
 * Tests the FuzzyIntentMatcher directly (no LLM/DB required — fast, deterministic).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FuzzyIntentMatcher, type KeywordIntent } from '../../src/assistant/fuzzy-matcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

interface IntentSample {
  profile: string;
  intent_type: 'booking' | 'inquiry' | 'escalation';
  message: string;
  expected_intent_t1: string | null;
  expected_intent_t2: string;
}

interface AccuracyResult {
  accuracy: number;
  correct: number;
  total: number;
  failures: string[];
}

/** Build a FuzzyIntentMatcher from a profile-specific intent-keywords JSON file */
function buildMatcher(profileId: string): FuzzyIntentMatcher {
  const keywordPath = join(ROOT, 'src', 'assistant', 'data', `intent-keywords-${profileId}.json`);
  const keywordData = JSON.parse(readFileSync(keywordPath, 'utf-8'));

  const keywordIntents: KeywordIntent[] = [];
  for (const intent of keywordData.intents) {
    for (const [lang, keywords] of Object.entries<string[]>(intent.keywords)) {
      keywordIntents.push({
        intent: intent.intent,
        keywords,
        language: lang as 'en' | 'ms' | 'zh' | 'ta',
      });
    }
    if (intent.regional_variants) {
      for (const [lang, variants] of Object.entries<string[]>(intent.regional_variants)) {
        keywordIntents.push({
          intent: intent.intent,
          keywords: variants,
          language: lang as 'en' | 'ms' | 'zh' | 'ta',
        });
      }
    }
  }

  return new FuzzyIntentMatcher(keywordIntents);
}

/** Load fixture samples from tests/fixtures/ */
function loadSamples(filename: string): IntentSample[] {
  const fixturePath = join(ROOT, 'tests', 'fixtures', filename);
  return JSON.parse(readFileSync(fixturePath, 'utf-8')) as IntentSample[];
}

/** Run accuracy measurement for a subset of samples filtered by intent_type */
function measureAccuracy(
  samples: IntentSample[],
  intentType: string,
  matcher: FuzzyIntentMatcher
): AccuracyResult {
  const filtered = samples.filter((s) => s.intent_type === intentType);
  let correct = 0;
  const failures: string[] = [];

  for (const sample of filtered) {
    const result = matcher.match(sample.message);
    if (result && result.intent === sample.expected_intent_t2) {
      correct++;
    } else {
      const got = result ? `${result.intent} (${(result.score * 100).toFixed(0)}%)` : 'null';
      failures.push(`"${sample.message}" → ${got} (expected: ${sample.expected_intent_t2})`);
    }
  }

  return {
    accuracy: filtered.length > 0 ? correct / filtered.length : 0,
    correct,
    total: filtered.length,
    failures,
  };
}

// ─── Pelangi Profile ────────────────────────────────────────────────────────

describe('US-529: Intent Classification — Pelangi Profile', () => {
  let matcher: FuzzyIntentMatcher;
  let samples: IntentSample[];

  beforeAll(() => {
    matcher = buildMatcher('pelangi');
    samples = loadSamples('intent-samples.json');
  });

  it('has 15+ samples per intent type', () => {
    const booking = samples.filter((s) => s.intent_type === 'booking');
    const inquiry = samples.filter((s) => s.intent_type === 'inquiry');
    const escalation = samples.filter((s) => s.intent_type === 'escalation');
    expect(booking.length).toBeGreaterThanOrEqual(15);
    expect(inquiry.length).toBeGreaterThanOrEqual(15);
    expect(escalation.length).toBeGreaterThanOrEqual(15);
  });

  it('achieves >= 85% accuracy for booking intent', () => {
    const result = measureAccuracy(samples, 'booking', matcher);
    if (result.failures.length > 0) {
      console.log('[Pelangi booking failures]', result.failures);
    }
    expect(result.accuracy, `${result.correct}/${result.total} correct`).toBeGreaterThanOrEqual(0.85);
  });

  it('achieves >= 85% accuracy for inquiry intents', () => {
    const result = measureAccuracy(samples, 'inquiry', matcher);
    if (result.failures.length > 0) {
      console.log('[Pelangi inquiry failures]', result.failures);
    }
    expect(result.accuracy, `${result.correct}/${result.total} correct`).toBeGreaterThanOrEqual(0.85);
  });

  it('achieves >= 75% accuracy for escalation intents', () => {
    const result = measureAccuracy(samples, 'escalation', matcher);
    if (result.failures.length > 0) {
      console.log('[Pelangi escalation failures]', result.failures);
    }
    expect(result.accuracy, `${result.correct}/${result.total} correct`).toBeGreaterThanOrEqual(0.75);
  });
});

// ─── Southern Profile ────────────────────────────────────────────────────────

describe('US-529: Intent Classification — Southern Profile', () => {
  let matcher: FuzzyIntentMatcher;
  let samples: IntentSample[];

  beforeAll(() => {
    matcher = buildMatcher('southern');
    samples = loadSamples('intent-samples-southern.json');
  });

  it('has 15+ samples per intent type', () => {
    const booking = samples.filter((s) => s.intent_type === 'booking');
    const inquiry = samples.filter((s) => s.intent_type === 'inquiry');
    const escalation = samples.filter((s) => s.intent_type === 'escalation');
    expect(booking.length).toBeGreaterThanOrEqual(15);
    expect(inquiry.length).toBeGreaterThanOrEqual(15);
    expect(escalation.length).toBeGreaterThanOrEqual(15);
  });

  it('achieves >= 85% accuracy for booking intent', () => {
    const result = measureAccuracy(samples, 'booking', matcher);
    if (result.failures.length > 0) {
      console.log('[Southern booking failures]', result.failures);
    }
    expect(result.accuracy, `${result.correct}/${result.total} correct`).toBeGreaterThanOrEqual(0.85);
  });

  it('achieves >= 85% accuracy for inquiry intents', () => {
    const result = measureAccuracy(samples, 'inquiry', matcher);
    if (result.failures.length > 0) {
      console.log('[Southern inquiry failures]', result.failures);
    }
    expect(result.accuracy, `${result.correct}/${result.total} correct`).toBeGreaterThanOrEqual(0.85);
  });

  it('achieves >= 75% accuracy for escalation intents', () => {
    const result = measureAccuracy(samples, 'escalation', matcher);
    if (result.failures.length > 0) {
      console.log('[Southern escalation failures]', result.failures);
    }
    expect(result.accuracy, `${result.correct}/${result.total} correct`).toBeGreaterThanOrEqual(0.75);
  });
});

// ─── Makan Profile ────────────────────────────────────────────────────────────

describe('US-529: Intent Classification — Makan Profile', () => {
  let matcher: FuzzyIntentMatcher;
  let samples: IntentSample[];

  beforeAll(() => {
    matcher = buildMatcher('makan');
    samples = loadSamples('intent-samples-makan.json');
  });

  it('has 15+ samples per intent type', () => {
    const booking = samples.filter((s) => s.intent_type === 'booking');
    const inquiry = samples.filter((s) => s.intent_type === 'inquiry');
    const escalation = samples.filter((s) => s.intent_type === 'escalation');
    expect(booking.length).toBeGreaterThanOrEqual(15);
    expect(inquiry.length).toBeGreaterThanOrEqual(15);
    expect(escalation.length).toBeGreaterThanOrEqual(15);
  });

  it('achieves >= 85% accuracy for order placement (booking) intent', () => {
    const result = measureAccuracy(samples, 'booking', matcher);
    if (result.failures.length > 0) {
      console.log('[Makan booking/order failures]', result.failures);
    }
    expect(result.accuracy, `${result.correct}/${result.total} correct`).toBeGreaterThanOrEqual(0.85);
  });

  it('achieves >= 85% accuracy for menu/pricing inquiry intents', () => {
    const result = measureAccuracy(samples, 'inquiry', matcher);
    if (result.failures.length > 0) {
      console.log('[Makan inquiry failures]', result.failures);
    }
    expect(result.accuracy, `${result.correct}/${result.total} correct`).toBeGreaterThanOrEqual(0.85);
  });

  it('achieves >= 75% accuracy for escalation intents', () => {
    const result = measureAccuracy(samples, 'escalation', matcher);
    if (result.failures.length > 0) {
      console.log('[Makan escalation failures]', result.failures);
    }
    expect(result.accuracy, `${result.correct}/${result.total} correct`).toBeGreaterThanOrEqual(0.75);
  });
});
