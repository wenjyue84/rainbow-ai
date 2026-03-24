/**
 * US-379: Booking Workflow Step Retry Configuration with Exponential Backoff
 *
 * Tests:
 * 1. Step with retry config retries exactly max_attempts times on persistent failure
 * 2. Step without retry config executes once and throws on failure
 * 3. Step with retry config succeeds on second attempt (partial failure)
 */

import { describe, it, expect, vi } from 'vitest';
import { executeWithRetry } from '../../src/assistant/workflow-executor.js';

describe('US-379: executeWithRetry', () => {
  // ── Test 1: Retries max_attempts times on persistent failure ────────
  it('calls fn exactly max_attempts times when all attempts fail', async () => {
    const error = new Error('transient failure');
    const fn = vi.fn().mockRejectedValue(error);

    const retry = { max_attempts: 2, base_delay_ms: 0, backoff_multiplier: 2 };

    await expect(executeWithRetry(fn, retry)).rejects.toThrow('transient failure');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ── Test 2: No retry config — executes once and throws ──────────────
  it('executes fn exactly once and throws when retry is undefined', async () => {
    const error = new Error('no retry');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(executeWithRetry(fn, undefined)).rejects.toThrow('no retry');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── Test 3: Succeeds on second attempt ──────────────────────────────
  it('resolves on second attempt when first fails', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce('success');

    const retry = { max_attempts: 2, base_delay_ms: 0, backoff_multiplier: 2 };

    const result = await executeWithRetry(fn, retry);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ── Test 4: max_attempts=1 never retries ────────────────────────────
  it('does not retry when max_attempts=1', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('one shot'));

    const retry = { max_attempts: 1, base_delay_ms: 0, backoff_multiplier: 2 };

    await expect(executeWithRetry(fn, retry)).rejects.toThrow('one shot');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
