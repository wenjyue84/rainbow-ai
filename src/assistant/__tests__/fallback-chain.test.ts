/**
 * Intent Classifier Fallback Chain Tests (US-279)
 *
 * Validates that the fallback chain:
 * - Triggers when primary confidence < first chain entry's min_confidence
 * - Uses the secondary provider when primary confidence is below threshold
 * - Falls through to knowledge.json/escalation (intent='unknown') when all
 *   chain providers are also below their min_confidence thresholds
 * - Is a no-op when disabled or not configured
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyFallbackChain } from '../pipeline/stages/fallback-chain.js';
import type { ClassificationResult } from '../pipeline/stages/tier-classification.js';
import type { IPipelineContext } from '../pipeline/pipeline-context.js';

// ─── Helpers ────────────────────────────────────────────────────────

function makeResult(intent: string, confidence: number): ClassificationResult {
  return {
    intent,
    action: 'llm_reply',
    response: '',
    confidence,
    model: 'primary-model',
    responseTime: 100,
  };
}

function makeContext(
  settings: Record<string, any>,
  classifyOnlyImpl?: (text: string, ctx: any[], provider?: string) => Promise<any>
): IPipelineContext {
  return {
    getSettings: () => settings,
    classifyOnly: classifyOnlyImpl ?? vi.fn().mockResolvedValue({
      intent: 'unknown',
      confidence: 0,
      model: 'none',
      responseTime: 50,
    }),
  } as unknown as IPipelineContext;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('applyFallbackChain (US-279)', () => {
  // ─── No-op cases ────────────────────────────────────────────────

  it('returns original result when fallback_chain is not configured', async () => {
    const result = makeResult('booking', 0.4);
    const ctx = makeContext({});
    const out = await applyFallbackChain(result, [], 'book a room', ctx);
    expect(out).toBe(result);
  });

  it('returns original result when fallback_chain.enabled is false', async () => {
    const result = makeResult('booking', 0.4);
    const ctx = makeContext({
      fallback_chain: { enabled: false, chain: [{ provider_name: 'groq-llama', min_confidence: 0.6 }] },
    });
    const out = await applyFallbackChain(result, [], 'book a room', ctx);
    expect(out).toBe(result);
  });

  it('returns original result when chain array is empty', async () => {
    const result = makeResult('booking', 0.4);
    const ctx = makeContext({
      fallback_chain: { enabled: true, chain: [] },
    });
    const out = await applyFallbackChain(result, [], 'book a room', ctx);
    expect(out).toBe(result);
  });

  it('returns original result when confidence already meets first threshold', async () => {
    const result = makeResult('booking', 0.75);
    const ctx = makeContext({
      fallback_chain: { enabled: true, chain: [{ provider_name: 'groq-llama', min_confidence: 0.6 }] },
    });
    const out = await applyFallbackChain(result, [], 'book a room', ctx);
    expect(out).toBe(result);
  });

  // ─── Acceptance Criteria (AC3) ────────────────────────────────────
  // Primary confidence=0.4, threshold=0.6 → tries secondary provider

  it('AC3: primary confidence=0.4 with threshold=0.6 → tries secondary provider', async () => {
    const primaryResult = makeResult('unknown', 0.4);
    const classifyOnly = vi.fn().mockResolvedValueOnce({
      intent: 'booking',
      confidence: 0.8,
      model: 'groq-llama',
      responseTime: 80,
    });
    const ctx = makeContext(
      {
        fallback_chain: {
          enabled: true,
          chain: [{ provider_name: 'groq-llama', min_confidence: 0.6, timeout_ms: 6000, retry_count: 1 }],
        },
      },
      classifyOnly
    );

    const out = await applyFallbackChain(primaryResult, [], 'I want to book a room', ctx);

    expect(classifyOnly).toHaveBeenCalledWith('I want to book a room', [], 'groq-llama');
    expect(out.intent).toBe('booking');
    expect(out.confidence).toBe(0.8);
    expect(out.model).toBe('groq-llama');
  });

  // ─── Both chain providers fail → intent='unknown' (escalation path)

  it('AC3: secondary also <0.6 → falls through to unknown/escalation', async () => {
    const primaryResult = makeResult('unknown', 0.4);
    const classifyOnly = vi
      .fn()
      .mockResolvedValueOnce({ intent: 'pricing', confidence: 0.5, model: 'groq-llama', responseTime: 80 })
      .mockResolvedValueOnce({ intent: 'pricing', confidence: 0.45, model: 'gemini-flash', responseTime: 90 });

    const ctx = makeContext(
      {
        fallback_chain: {
          enabled: true,
          chain: [
            { provider_name: 'groq-llama', min_confidence: 0.6 },
            { provider_name: 'google-gemini-flash', min_confidence: 0.6 },
          ],
        },
      },
      classifyOnly
    );

    const out = await applyFallbackChain(primaryResult, [], 'how much', ctx);

    expect(classifyOnly).toHaveBeenCalledTimes(2);
    expect(out.intent).toBe('unknown');
    expect(out.action).toBe('llm_reply');
  });

  // ─── Second provider in chain succeeds ───────────────────────────

  it('uses second provider result when first is below threshold but second succeeds', async () => {
    const primaryResult = makeResult('unknown', 0.3);
    const classifyOnly = vi
      .fn()
      .mockResolvedValueOnce({ intent: 'pricing', confidence: 0.5, model: 'groq-llama', responseTime: 80 })
      .mockResolvedValueOnce({ intent: 'pricing', confidence: 0.72, model: 'gemini-flash', responseTime: 90 });

    const ctx = makeContext(
      {
        fallback_chain: {
          enabled: true,
          chain: [
            { provider_name: 'groq-llama', min_confidence: 0.6 },
            { provider_name: 'google-gemini-flash', min_confidence: 0.6 },
          ],
        },
      },
      classifyOnly
    );

    const out = await applyFallbackChain(primaryResult, [], 'price', ctx);

    expect(classifyOnly).toHaveBeenCalledTimes(2);
    expect(out.intent).toBe('pricing');
    expect(out.confidence).toBe(0.72);
    expect(out.model).toBe('gemini-flash');
  });

  // ─── Provider error handling ──────────────────────────────────────

  it('skips failed provider and continues to next in chain', async () => {
    const primaryResult = makeResult('unknown', 0.3);
    const classifyOnly = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ intent: 'wifi', confidence: 0.9, model: 'gemini-flash', responseTime: 90 });

    const ctx = makeContext(
      {
        fallback_chain: {
          enabled: true,
          chain: [
            { provider_name: 'groq-llama', min_confidence: 0.6 },
            { provider_name: 'google-gemini-flash', min_confidence: 0.6 },
          ],
        },
      },
      classifyOnly
    );

    const out = await applyFallbackChain(primaryResult, [], 'wifi password', ctx);

    expect(classifyOnly).toHaveBeenCalledTimes(2);
    expect(out.intent).toBe('wifi');
    expect(out.confidence).toBe(0.9);
  });
});
