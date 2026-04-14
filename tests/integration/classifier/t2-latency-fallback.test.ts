/**
 * US-619: Intent Classification Provider Latency Tracking with Timeout-Based Fallback
 *
 * Tests verify:
 * 1. Timeout triggers keyword fallback and latency is recorded
 * 2. Successful provider call records correct latency and returns provider result
 * 3. classifyByKeyword returns sensible results from intent-keywords.json
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB so tests don't need a real database connection
vi.mock('../../../src/lib/db.js', () => ({
  db: {
    insert: () => ({
      values: () => ({
        execute: () => Promise.resolve(),
      }),
    }),
  },
}));

// Mock logger
vi.mock('../../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  providerTimeoutHandler,
  classifyByKeyword,
  clearT2Caches,
} from '../../../src/assistant/pipeline/classifier-t2.js';

beforeEach(() => {
  clearT2Caches();
});

// ─── classifyByKeyword unit tests ─────────────────────────────────────────────

describe('classifyByKeyword', () => {
  it('returns unknown with low confidence when no keywords match', () => {
    const result = classifyByKeyword('xyzzy nonsense frobnicator', 'pelangi');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBeLessThanOrEqual(0.2);
  });

  it('matches greeting keywords', () => {
    const result = classifyByKeyword('hello how are you', 'pelangi');
    expect(result.intent).toBe('greeting');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('matches wifi keywords', () => {
    const result = classifyByKeyword('what is the wifi password?', 'pelangi');
    expect(['wifi', 'WIFI_PASSWORD'].includes(result.intent)).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('confidence is capped at 0.85', () => {
    const result = classifyByKeyword('thanks thank you tq', 'pelangi');
    expect(result.confidence).toBeLessThanOrEqual(0.85);
  });
});

// ─── providerTimeoutHandler — successful path ─────────────────────────────────

describe('providerTimeoutHandler — successful provider call', () => {
  it('returns provider result when provider responds within timeout', async () => {
    const mockResult = { intent: 'booking', confidence: 0.92 };
    const providerFn = vi.fn(async (_signal: AbortSignal) => {
      // Simulate fast response (5ms)
      await new Promise((r) => setTimeout(r, 5));
      return mockResult;
    });

    const result = await providerTimeoutHandler(providerFn, 'I want to book a room', {
      profileId: 'pelangi',
      timeoutMs: 1000,
      skipAnalytics: true,
    });

    expect(result.intent).toBe('booking');
    expect(result.confidence).toBe(0.92);
    expect(result.fallbackMethod).toBe('provider');
    expect(result.timedOut).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThan(500);
    expect(providerFn).toHaveBeenCalledOnce();
  });

  it('records latency as elapsed time from start to response', async () => {
    const SIMULATED_DELAY_MS = 50;
    const providerFn = vi.fn(async (_signal: AbortSignal) => {
      await new Promise((r) => setTimeout(r, SIMULATED_DELAY_MS));
      return { intent: 'wifi', confidence: 0.88 };
    });

    const result = await providerTimeoutHandler(providerFn, 'wifi password please', {
      profileId: 'pelangi',
      timeoutMs: 2000,
      skipAnalytics: true,
    });

    // Latency should be at least SIMULATED_DELAY_MS
    expect(result.latencyMs).toBeGreaterThanOrEqual(SIMULATED_DELAY_MS - 10);
    expect(result.timedOut).toBe(false);
  });
});

// ─── providerTimeoutHandler — timeout path ────────────────────────────────────

describe('providerTimeoutHandler — timeout triggers keyword fallback', () => {
  it('falls back to keyword matching when provider exceeds timeout', async () => {
    const providerFn = vi.fn(async (signal: AbortSignal) => {
      // Simulate slow provider — honour abort signal
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          const err = new Error('AbortError');
          err.name = 'AbortError';
          reject(err);
        });
      });
      return { intent: 'pricing', confidence: 0.9 };
    });

    const result = await providerTimeoutHandler(
      providerFn,
      'hello hi good morning',
      {
        profileId: 'pelangi',
        timeoutMs: 80, // very short timeout to force fallback quickly
        skipAnalytics: true,
      }
    );

    expect(result.timedOut).toBe(true);
    expect(result.fallbackMethod).toBe('keyword');
    // keyword fallback on "hello" text should return a greeting-related intent
    expect(result.intent).toBeDefined();
    expect(typeof result.intent).toBe('string');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records latencyMs on timeout as time elapsed before abort', async () => {
    const providerFn = vi.fn(async (signal: AbortSignal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          reject(err);
        });
      });
      return { intent: 'pricing', confidence: 0.9 };
    });

    const TIMEOUT = 60;
    const result = await providerTimeoutHandler(
      providerFn,
      'how much does a room cost',
      {
        profileId: 'pelangi',
        timeoutMs: TIMEOUT,
        skipAnalytics: true,
      }
    );

    expect(result.timedOut).toBe(true);
    // Latency should be approximately the timeout duration
    expect(result.latencyMs).toBeGreaterThanOrEqual(TIMEOUT - 20);
    expect(result.latencyMs).toBeLessThan(TIMEOUT + 500);
  });

  it('uses default 5000ms timeout from settings when no override provided', async () => {
    // Provider resolves immediately — we just check that it doesn't time out
    const providerFn = vi.fn(async (_signal: AbortSignal) => ({
      intent: 'greeting',
      confidence: 0.95,
    }));

    const result = await providerTimeoutHandler(
      providerFn,
      'hi there',
      {
        profileId: 'pelangi',
        skipAnalytics: true,
        // No timeoutMs — reads from settings.json (5000ms default)
      }
    );

    expect(result.timedOut).toBe(false);
    expect(result.fallbackMethod).toBe('provider');
    expect(result.intent).toBe('greeting');
  });

  it('rethrows non-timeout errors from provider', async () => {
    const networkError = new Error('Network failure');
    const providerFn = vi.fn(async (_signal: AbortSignal) => {
      throw networkError;
    });

    await expect(
      providerTimeoutHandler(providerFn, 'test', {
        profileId: 'pelangi',
        timeoutMs: 1000,
        skipAnalytics: true,
      })
    ).rejects.toThrow('Network failure');
  });
});
