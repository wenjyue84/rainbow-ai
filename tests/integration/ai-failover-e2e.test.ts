/**
 * tests/integration/ai-failover-e2e.test.ts
 *
 * Integration tests for executeWithFailover with mocked providers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FailoverManager, type FailoverAttempt } from '../../src/lib/ai-providers/failover-manager.js';
import { TemplateResponder, createTemplateResponder } from '../../src/lib/template-responder.js';

describe('Failover E2E', () => {
  describe('exponential backoff retry', () => {
    it('should retry OpenRouter on timeout with 100ms backoff', async () => {
      const failover = new FailoverManager();
      let attempts = 0;
      const timestamps: number[] = [];

      const fn = async () => {
        timestamps.push(Date.now());
        attempts++;
        if (attempts === 1) {
          const err = new Error('OpenRouter request timeout after 5000ms');
          err.name = 'TimeoutError';
          throw err;
        }
        return { content: 'success from retry' };
      };

      const result = await failover.retryWithBackoff(fn, 'openrouter', 100, 1);

      expect(result.content).toBe('success from retry');
      expect(attempts).toBe(2);

      // Verify backoff delay occurred
      if (timestamps.length === 2) {
        const delay = timestamps[1] - timestamps[0];
        expect(delay).toBeGreaterThanOrEqual(90); // Allow some variance
      }
    });

    it('should log provider failure chain: timeout -> successful retry', async () => {
      const failover = new FailoverManager();
      let callCount = 0;

      const fn = async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('timeout after 5000ms');
          err.name = 'TimeoutError';
          throw err;
        }
        return { content: 'recovered' };
      };

      await failover.retryWithBackoff(fn, 'openrouter', 100, 1);
      const chain = failover.getFailureChain();

      expect(chain.attempts).toHaveLength(2);
      expect(chain.attempts[0].error).toContain('timeout');
      expect(chain.attempts[1].error).toBeUndefined();
      expect(chain.successProvider).toBe('openrouter');

      const logMsg = failover.formatForLogging();
      expect(logMsg).toContain('openrouter');
    });
  });

  describe('escalation to Ollama', () => {
    it('should escalate to Ollama when primary provider fails', async () => {
      const failover = new FailoverManager();

      const primaryFn = async () => {
        throw new Error('OpenRouter 502 Bad Gateway');
      };

      const ollamaFn = async () => {
        return { content: 'Ollama fallback response' };
      };

      // Simulate primary failure
      try {
        await failover.retryWithBackoff(primaryFn, 'openrouter', 100, 0);
      } catch {
        // Expected
      }

      // Simulate Ollama escalation
      const result = await failover.retryWithBackoff(ollamaFn, 'ollama', 50, 0);
      expect(result.content).toBe('Ollama fallback response');

      const chain = failover.getFailureChain();
      expect(chain.attempts).toHaveLength(2);
      expect(chain.attempts[0].provider).toBe('openrouter');
      expect(chain.attempts[1].provider).toBe('ollama');
    });

    it('should use tight 50ms timeout for Ollama', async () => {
      const failover = new FailoverManager();
      const start = Date.now();

      // Simulate Ollama with quick response
      const fn = async () => {
        return { content: 'Quick ollama response' };
      };

      const result = await failover.retryWithBackoff(fn, 'ollama', 50, 0);
      const elapsed = Date.now() - start;

      expect(result.content).toBe('Quick ollama response');
      expect(elapsed).toBeLessThan(200); // Should be fast
    });
  });

  describe('template responder fallback', () => {
    it('should return graceful message when all providers fail', () => {
      const templates = [
        {
          intent: 'wifi',
          response: {
            en: 'WiFi info',
            ms: 'Info WiFi',
            zh: '网络信息',
          },
        },
      ];

      const responder = new TemplateResponder(templates);
      const fallback = responder.getGracefulFallback('en');

      expect(fallback).toBe("I'm temporarily having trouble understanding. Please try again in a moment.");
    });

    it('should return localized graceful fallback', () => {
      const responder = new TemplateResponder([]);

      expect(responder.getGracefulFallback('en')).toContain('temporarily');
      expect(responder.getGracefulFallback('ms')).toContain('sedang');
      expect(responder.getGracefulFallback('zh')).toContain('暂时');
    });

    it('should match intent from user message', () => {
      const templates = [
        {
          intent: 'wifi',
          response: {
            en: 'Network: pelangi capsule, Password: ilovestaycapsule',
            ms: 'Rangkaian: pelangi capsule, Kata laluan: ilovestaycapsule',
          },
        },
        {
          intent: 'pricing',
          response: {
            en: 'Rates start at RM45/night',
            ms: 'Harga mulai RM45/malam',
          },
        },
      ];

      const responder = createTemplateResponder({ static: templates });

      const wifiReply = responder.respondToMessage('what is the wifi password', 'en');
      expect(wifiReply).toContain('pelangi capsule');

      const priceReply = responder.respondToMessage('what is the price', 'en');
      expect(priceReply).toContain('RM45');

      const unknownReply = responder.respondToMessage('random question', 'en');
      expect(unknownReply).toContain('trouble understanding');
    });

    it('should respond with correct language', () => {
      const templates = [
        {
          intent: 'checkin',
          response: {
            en: 'Check-in at 2 PM',
            ms: 'Daftar masuk jam 2 petang',
            zh: '下午2点入住',
          },
        },
      ];

      const responder = createTemplateResponder({ static: templates });

      const en = responder.findTemplate('checkin', 'en');
      const ms = responder.findTemplate('checkin', 'ms');
      const zh = responder.findTemplate('checkin', 'zh');

      expect(en).toContain('2 PM');
      expect(ms).toContain('petang');
      expect(zh).toContain('下午');
    });
  });

  describe('failure chain logging', () => {
    it('should track attempt count and error details', async () => {
      const failover = new FailoverManager();
      let callCount = 0;

      const fn = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Connection refused');
        }
        return { content: 'success' };
      };

      try {
        await failover.retryWithBackoff(fn, 'provider-1', 100, 1);
      } catch {
        // Expected on final failure scenario
      }

      const chain = failover.getFailureChain();
      expect(chain.attempts.length).toBeGreaterThan(0);
      expect(chain.attempts[0]).toHaveProperty('attempt', 1);
      expect(chain.attempts[0]).toHaveProperty('provider', 'provider-1');
      expect(chain.attempts[0]).toHaveProperty('error');
    });

    it('should measure elapsed time for each attempt', async () => {
      const failover = new FailoverManager();

      const fn = async () => {
        return { content: 'done' };
      };

      await failover.retryWithBackoff(fn, 'test-provider', 50, 0);
      const chain = failover.getFailureChain();

      expect(chain.attempts[0]).toHaveProperty('elapsedMs');
      expect(chain.attempts[0].elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should identify which provider succeeded', async () => {
      const failover = new FailoverManager();

      const fn1 = async () => {
        throw new Error('Failed');
      };

      const fn2 = async () => {
        return { content: 'Success with provider 2' };
      };

      try {
        await failover.retryWithBackoff(fn1, 'openrouter', 50, 0);
      } catch {
        // Expected
      }

      await failover.retryWithBackoff(fn2, 'ollama', 50, 0);
      const chain = failover.getFailureChain();

      expect(chain.successProvider).toBe('ollama');
      expect(chain.attempts).toHaveLength(2);
    });
  });
});
