/**
 * tests/unit/provider-failover.test.ts
 *
 * Unit tests for failover manager with exponential backoff
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FailoverManager } from '../../src/lib/ai-providers/failover-manager.js';

describe('FailoverManager', () => {
  let failover: FailoverManager;

  beforeEach(() => {
    failover = new FailoverManager();
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue({ content: 'success' });
      const result = await failover.retryWithBackoff(fn, 'test-provider', 100, 1);
      expect(result).toEqual({ content: 'success' });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on timeout error and succeed on second attempt', async () => {
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('timeout');
          err.name = 'TimeoutError';
          throw err;
        }
        return { content: 'success' };
      });

      const result = await failover.retryWithBackoff(fn, 'test-provider', 50, 1);
      expect(result).toEqual({ content: 'success' });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should retry on 5xx error', async () => {
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Service returned 503');
        }
        return { content: 'success' };
      });

      const result = await failover.retryWithBackoff(fn, 'test-provider', 50, 1);
      expect(result).toEqual({ content: 'success' });
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should NOT retry on 4xx error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Invalid API key (401)'));

      await expect(
        failover.retryWithBackoff(fn, 'test-provider', 50, 1)
      ).rejects.toThrow('Invalid API key');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should fail after max retries exhausted', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Connection timeout'));

      await expect(
        failover.retryWithBackoff(fn, 'test-provider', 50, 1)
      ).rejects.toThrow('Connection timeout');
      expect(fn).toHaveBeenCalledTimes(2); // initial + 1 retry
    });

    it('should apply exponential backoff delays', async () => {
      let callCount = 0;
      const timestamps: number[] = [];

      const fn = vi.fn(async () => {
        timestamps.push(Date.now());
        callCount++;
        if (callCount === 1) {
          const err = new Error('timeout');
          err.name = 'TimeoutError';
          throw err;
        }
        return { content: 'success' };
      });

      const start = Date.now();
      await failover.retryWithBackoff(fn, 'test-provider', 50, 1);
      const elapsed = Date.now() - start;

      // Should have roughly 50ms delay between attempts
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some variance
    });
  });

  describe('escalateToNextProvider', () => {
    it('should return next provider in list', () => {
      const providers = [
        { id: 'openrouter', name: 'OpenRouter', type: 'openai-compatible' },
        { id: 'ollama', name: 'Ollama', type: 'ollama' },
        { id: 'groq', name: 'Groq', type: 'groq' },
      ];

      const next = failover.escalateToNextProvider('openrouter', providers);
      expect(next).toEqual(providers[1]);
    });

    it('should return null if current provider not found', () => {
      const providers = [
        { id: 'openrouter', name: 'OpenRouter', type: 'openai-compatible' },
      ];

      const next = failover.escalateToNextProvider('unknown', providers);
      expect(next).toBeNull();
    });

    it('should return null if no provider after current', () => {
      const providers = [
        { id: 'openrouter', name: 'OpenRouter', type: 'openai-compatible' },
      ];

      const next = failover.escalateToNextProvider('openrouter', providers);
      expect(next).toBeNull();
    });
  });

  describe('failure chain tracking', () => {
    it('should track all attempt details', async () => {
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Timeout');
        }
        return { content: 'success' };
      });

      await failover.retryWithBackoff(fn, 'test-provider', 50, 1);
      const chain = failover.getFailureChain();

      expect(chain.attempts).toHaveLength(2);
      expect(chain.attempts[0]).toMatchObject({
        provider: 'test-provider',
        attempt: 1,
        error: 'Timeout',
      });
      expect(chain.attempts[1]).toMatchObject({
        provider: 'test-provider',
        attempt: 2,
      });
      expect(chain.attempts[1].error).toBeUndefined();
      expect(chain.successProvider).toBe('test-provider');
    });

    it('should format failure chain for logging', async () => {
      const fn = vi.fn().mockResolvedValue({ content: 'ok' });
      await failover.retryWithBackoff(fn, 'provider-1', 50, 0);

      const formatted = failover.formatForLogging();
      expect(formatted).toContain('Failover chain:');
      expect(formatted).toContain('provider-1');
      expect(formatted).toContain('OK');
    });
  });
});
