/**
 * Tests for US-933: LLM output validation — schema-check structured AI responses
 *
 * AC1: Structured JSON responses parsed through Zod schema before use
 * AC2: Validation failures caught, logged, trigger retry/fallback
 * AC3: Order extraction validated against OrderSchema before cart mutation
 * AC4: Intent classification: known enum + 0-1 float confidence
 * AC5: Validation error rate tracked in analytics pipeline (target < 1%)
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  safeParseLLMResponse,
  classifyResultSchema,
  aiResponseSchema,
  orderItemExtractionSchema,
  validateKnownIntent,
} from '../schemas.js';
import {
  recordValidationEvent,
  getValidationMetrics,
  resetValidationMetrics,
} from '../llm-validation-metrics.js';

// Reset metrics before each test
beforeEach(() => {
  resetValidationMetrics();
});

// ─── AC1: Zod schema validation for all structured LLM responses ────

describe('AC1: Zod schema validation', () => {
  test('classifyResultSchema validates correct classification', () => {
    const raw = '{"category":"pricing","confidence":0.92,"entities":{"guest_count":2}}';
    const result = safeParseLLMResponse(raw, classifyResultSchema, 'test-ac1');
    expect(result.success).toBe(true);
  });

  test('aiResponseSchema validates correct response', () => {
    const raw = '{"intent":"greeting","action":"reply","response":"Hello!","confidence":0.95}';
    const result = safeParseLLMResponse(raw, aiResponseSchema, 'test-ac1');
    expect(result.success).toBe(true);
  });

  test('rejects malformed JSON gracefully', () => {
    const raw = 'not json at all';
    const result = safeParseLLMResponse(raw, classifyResultSchema, 'test-ac1');
    expect(result.success).toBe(false);
  });
});

// ─── AC2: Validation failures logged and trigger fallback ────────────

describe('AC2: Failure logging and fallback', () => {
  test('schema failure is recorded in validation metrics', () => {
    const raw = '{"category":123,"confidence":"high"}';
    safeParseLLMResponse(raw, classifyResultSchema, 'test-ac2');
    const metrics = getValidationMetrics();
    expect(metrics.overall.schemaFail).toBe(1);
    expect(metrics.overall.schemaPass).toBe(0);
  });

  test('schema success is recorded in validation metrics', () => {
    const raw = '{"category":"greeting","confidence":0.9}';
    safeParseLLMResponse(raw, classifyResultSchema, 'test-ac2');
    const metrics = getValidationMetrics();
    expect(metrics.overall.schemaPass).toBe(1);
    expect(metrics.overall.schemaFail).toBe(0);
  });

  test('recovered validations are tracked separately', () => {
    recordValidationEvent('classifyIntent', false, true, 'Partial recovery');
    const metrics = getValidationMetrics();
    expect(metrics.overall.recovered).toBe(1);
    expect(metrics.overall.schemaFail).toBe(1);
  });
});

// ─── AC3: Order extraction validated against schema ──────────────────

describe('AC3: Order extraction schema validation', () => {
  test('valid order item passes schema', () => {
    const result = orderItemExtractionSchema.safeParse({
      name: 'Nasi Lemak',
      qty: 2,
      code: 'NR01',
      price: 8.50,
      notes: 'extra sambal',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Nasi Lemak');
      expect(result.data.qty).toBe(2);
      expect(result.data.price).toBe(8.50);
    }
  });

  test('order item with only name uses default qty=1', () => {
    const result = orderItemExtractionSchema.safeParse({ name: 'Teh Tarik' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.qty).toBe(1);
    }
  });

  test('rejects empty item name', () => {
    const result = orderItemExtractionSchema.safeParse({ name: '', qty: 1 });
    expect(result.success).toBe(false);
  });

  test('rejects missing item name', () => {
    const result = orderItemExtractionSchema.safeParse({ qty: 2 });
    expect(result.success).toBe(false);
  });

  test('rejects negative quantity', () => {
    const result = orderItemExtractionSchema.safeParse({ name: 'Roti', qty: -1 });
    expect(result.success).toBe(false);
  });

  test('rejects zero quantity', () => {
    const result = orderItemExtractionSchema.safeParse({ name: 'Roti', qty: 0 });
    expect(result.success).toBe(false);
  });

  test('rejects non-integer quantity', () => {
    const result = orderItemExtractionSchema.safeParse({ name: 'Roti', qty: 1.5 });
    expect(result.success).toBe(false);
  });

  test('rejects negative price', () => {
    const result = orderItemExtractionSchema.safeParse({ name: 'Roti', qty: 1, price: -5 });
    expect(result.success).toBe(false);
  });
});

// ─── AC4: Intent classification — known enum + 0-1 confidence ────────

describe('AC4: Intent classification validation', () => {
  const KNOWN_CATEGORIES = [
    'greeting', 'thanks', 'pricing', 'availability', 'booking',
    'unknown', 'complaint', 'general',
  ];

  test('known category passes validation', () => {
    const result = validateKnownIntent('pricing', KNOWN_CATEGORIES);
    expect(result.valid).toBe(true);
    expect(result.corrected).toBe('pricing');
  });

  test('unknown category corrected to "unknown"', () => {
    const result = validateKnownIntent('nonexistent_intent', KNOWN_CATEGORIES);
    expect(result.valid).toBe(false);
    expect(result.corrected).toBe('unknown');
  });

  test('case-insensitive match recovers correct category', () => {
    const result = validateKnownIntent('PRICING', KNOWN_CATEGORIES);
    expect(result.valid).toBe(true);
    expect(result.corrected).toBe('pricing');
  });

  test('confidence must be 0-1 float via classifyResultSchema', () => {
    const tooHigh = classifyResultSchema.safeParse({ category: 'greeting', confidence: 1.5 });
    expect(tooHigh.success).toBe(false);

    const tooLow = classifyResultSchema.safeParse({ category: 'greeting', confidence: -0.1 });
    expect(tooLow.success).toBe(false);

    const valid = classifyResultSchema.safeParse({ category: 'greeting', confidence: 0.75 });
    expect(valid.success).toBe(true);

    const zero = classifyResultSchema.safeParse({ category: 'greeting', confidence: 0 });
    expect(zero.success).toBe(true);

    const one = classifyResultSchema.safeParse({ category: 'greeting', confidence: 1 });
    expect(one.success).toBe(true);
  });
});

// ─── AC5: Validation error rate tracking ─────────────────────────────

describe('AC5: Validation error rate metric', () => {
  test('error rate is 0 with all successes', () => {
    recordValidationEvent('classify', true);
    recordValidationEvent('classify', true);
    recordValidationEvent('classify', true);
    const metrics = getValidationMetrics();
    expect(metrics.overall.errorRate).toBe(0);
    expect(metrics.overall.totalCalls).toBe(3);
  });

  test('error rate calculated correctly', () => {
    // 1 failure out of 100 calls = 1%
    for (let i = 0; i < 99; i++) {
      recordValidationEvent('classify', true);
    }
    recordValidationEvent('classify', false, false, 'bad schema');
    const metrics = getValidationMetrics();
    expect(metrics.overall.errorRate).toBe(0.01);
    expect(metrics.overall.totalCalls).toBe(100);
  });

  test('target < 1% check works', () => {
    // All pass -> within target
    for (let i = 0; i < 100; i++) {
      recordValidationEvent('classify', true);
    }
    let metrics = getValidationMetrics();
    expect(metrics.overall.errorRate).toBeLessThanOrEqual(0.01);

    // Add 2 failures -> 2/102 = ~1.96% > 1%
    recordValidationEvent('classify', false);
    recordValidationEvent('classify', false);
    metrics = getValidationMetrics();
    expect(metrics.overall.errorRate).toBeGreaterThan(0.01);
  });

  test('per-context metrics are tracked independently', () => {
    recordValidationEvent('classifyIntent', true);
    recordValidationEvent('classifyIntent', true);
    recordValidationEvent('classifyIntent', false);
    recordValidationEvent('cart_add_item', true);

    const metrics = getValidationMetrics();
    expect(metrics.byContext['classifyIntent'].totalCalls).toBe(3);
    expect(metrics.byContext['classifyIntent'].schemaFail).toBe(1);
    expect(metrics.byContext['classifyIntent'].errorRate).toBeCloseTo(1 / 3);
    expect(metrics.byContext['cart_add_item'].totalCalls).toBe(1);
    expect(metrics.byContext['cart_add_item'].errorRate).toBe(0);
  });

  test('recent failures are capped and available', () => {
    for (let i = 0; i < 60; i++) {
      recordValidationEvent('test', false, false, `error-${i}`);
    }
    const metrics = getValidationMetrics();
    // recentFailures capped at 50
    expect(metrics.recentFailures.length).toBe(50);
  });

  test('reset clears all metrics', () => {
    recordValidationEvent('test', true);
    recordValidationEvent('test', false);
    resetValidationMetrics();
    const metrics = getValidationMetrics();
    expect(metrics.overall.totalCalls).toBe(0);
    expect(Object.keys(metrics.byContext).length).toBe(0);
  });

  test('safeParseLLMResponse automatically records metrics', () => {
    // Success
    safeParseLLMResponse('{"category":"greeting","confidence":0.9}', classifyResultSchema, 'auto-track');
    // Failure
    safeParseLLMResponse('{"category":123}', classifyResultSchema, 'auto-track');

    const metrics = getValidationMetrics();
    expect(metrics.byContext['auto-track'].totalCalls).toBe(2);
    expect(metrics.byContext['auto-track'].schemaPass).toBe(1);
    expect(metrics.byContext['auto-track'].schemaFail).toBe(1);
  });
});
