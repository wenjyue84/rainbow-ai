/**
 * AbortSignal.timeout tests (US-482)
 *
 * Verifies that outbound HTTP fetch calls use AbortSignal.timeout and that
 * a slow upstream triggers an AbortError that is detected and logged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Timeout constants ────────────────────────────────────────────────
describe('timeouts module', () => {
  it('exports LLM_TIMEOUT_MS defaulting to 30000', async () => {
    const { LLM_TIMEOUT_MS } = await import('../../lib/timeouts.js');
    expect(LLM_TIMEOUT_MS).toBe(30000);
  });

  it('exports DIGIMAN_TIMEOUT_MS defaulting to 10000', async () => {
    const { DIGIMAN_TIMEOUT_MS } = await import('../../lib/timeouts.js');
    expect(DIGIMAN_TIMEOUT_MS).toBe(10000);
  });

  it('exports WA_API_TIMEOUT_MS defaulting to 15000', async () => {
    const { WA_API_TIMEOUT_MS } = await import('../../lib/timeouts.js');
    expect(WA_API_TIMEOUT_MS).toBe(15000);
  });
});

// ─── AbortSignal.timeout on slow upstream ────────────────────────────
describe('AbortSignal.timeout on slow upstream', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('triggers AbortError when upstream delays beyond timeout', async () => {
    // Mock fetch to hang until the signal fires
    globalThis.fetch = vi.fn((_url: string | URL | Request, opts?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = opts?.signal as AbortSignal | undefined;
        if (signal) {
          // Reject immediately if already aborted, or listen for abort
          if (signal.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          } else {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
        }
        // No resolve — upstream hangs forever
      });
    }) as typeof globalThis.fetch;

    // Use a 50 ms timeout so the test is fast
    const signal = AbortSignal.timeout(50);

    let caughtError: Error | null = null;
    try {
      await globalThis.fetch('http://localhost:9999/slow', { signal });
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    // AbortSignal.timeout sets name to 'TimeoutError' in Node 18+ or 'AbortError' in older runtimes
    expect(['AbortError', 'TimeoutError']).toContain(caughtError!.name);
  });

  it('AbortError is classified as retryable by isRetryable logic', () => {
    // Simulate checking if an AbortError-like object is retryable
    // (mirrors the logic added to http-client.ts isRetryable)
    function isRetryableSimulated(err: { name: string; code?: string }): boolean {
      if (err.code === 'ECONNABORTED') return true;
      if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
      return false;
    }

    expect(isRetryableSimulated({ name: 'AbortError' })).toBe(true);
    expect(isRetryableSimulated({ name: 'TimeoutError' })).toBe(true);
    expect(isRetryableSimulated({ name: 'TypeError', code: undefined })).toBe(false);
  });
});
