/**
 * Exponential Backoff with Jitter Tests (US-938)
 *
 * Verifies that transient provider errors (429, 503, timeout) trigger
 * retries with exponential backoff before failing over to the next provider,
 * while permanent errors (400, 401, 422) immediately fail over.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock settings — mutated per test to control provider list
const mockProviders: any[] = [];
const mockSettings = {
  ai: {
    nvidia_model: 'test',
    nvidia_base_url: 'http://test',
    groq_model: 'test',
    max_classify_tokens: 100,
    max_chat_tokens: 500,
    classify_temperature: 0.05,
    chat_temperature: 0.7,
    providers: mockProviders,
    slow_response_message: 'All systems slow. Please contact staff.',
  },
  system_prompt: 'test',
  rate_limits: { per_minute: 40, per_hour: 200 },
  staff: { phones: [], jay_phone: '', alston_phone: '' },
};

// Mock axios before importing the module under test
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// Mock groq-sdk
vi.mock('groq-sdk', () => ({
  default: class Groq {
    chat = { completions: { create: vi.fn() } };
    constructor() {}
  },
}));

// Mock config-store to return our test settings
vi.mock('../config-store.js', () => {
  const { EventEmitter } = require('events');
  const emitter = new EventEmitter();
  return {
    configStore: {
      getSettings: () => mockSettings,
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
    },
  };
});

vi.mock('../../lib/admin-notifier.js', () => ({
  notifyAdminRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import axios from 'axios';
import {
  chatWithFallback,
  isTransientError,
  isPermanentError,
  calculateBackoffDelay,
  retryProviderChat,
  backoffUtils,
  TimeoutError,
} from '../ai-provider-manager.js';
import type { AIProvider } from '../config-store.js';
import { circuitBreakerRegistry } from '../circuit-breaker.js';

const mockedAxios = vi.mocked(axios);

// Helper: create a provider config for testing
function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    type: 'ollama',
    api_key_env: '',
    base_url: 'http://localhost:11434/v1',
    model: 'test-model',
    enabled: true,
    priority: 0,
    timeout_ms: 5000,
    ...overrides,
  } as AIProvider;
}

// Valid OpenAI-format response
const validResponse = {
  choices: [{ message: { content: 'Hello from AI' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('Exponential Backoff with Jitter (US-938)', () => {
  let sleepSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    circuitBreakerRegistry.resetAll();
    mockProviders.length = 0;
    // Mock backoffUtils.sleep to resolve instantly (avoids real 1-4s delays)
    sleepSpy = vi.spyOn(backoffUtils, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── AC1: isTransientError / isPermanentError ─────────────────────

  describe('isTransientError', () => {
    it('returns true for HTTP 429 errors', () => {
      expect(isTransientError(new Error('Provider 429: rate limit exceeded'))).toBe(true);
    });

    it('returns true for HTTP 503 errors', () => {
      expect(isTransientError(new Error('Provider 503: service unavailable'))).toBe(true);
    });

    it('returns true for TimeoutError', () => {
      expect(isTransientError(new TimeoutError('Test', 5000, 5100))).toBe(true);
    });

    it('returns false for HTTP 401 errors', () => {
      expect(isTransientError(new Error('Provider 401: unauthorized'))).toBe(false);
    });

    it('returns false for HTTP 400 errors', () => {
      expect(isTransientError(new Error('Provider 400: bad request'))).toBe(false);
    });
  });

  describe('isPermanentError', () => {
    it('returns true for HTTP 400 errors', () => {
      expect(isPermanentError(new Error('Provider 400: bad request'))).toBe(true);
    });

    it('returns true for HTTP 401 errors', () => {
      expect(isPermanentError(new Error('Provider 401: unauthorized'))).toBe(true);
    });

    it('returns true for HTTP 422 errors', () => {
      expect(isPermanentError(new Error('Provider 422: unprocessable'))).toBe(true);
    });

    it('returns false for HTTP 429 errors', () => {
      expect(isPermanentError(new Error('Provider 429: rate limit'))).toBe(false);
    });

    it('returns false for HTTP 503 errors', () => {
      expect(isPermanentError(new Error('Provider 503: unavailable'))).toBe(false);
    });
  });

  // ─── AC2: Backoff delay with ±20% jitter ──────────────────────────

  describe('calculateBackoffDelay', () => {
    it('returns ~1000ms for attempt 0 (within ±20%)', () => {
      const delays = Array.from({ length: 100 }, () => calculateBackoffDelay(0));
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(800);
        expect(d).toBeLessThanOrEqual(1200);
      }
    });

    it('returns ~2000ms for attempt 1 (within ±20%)', () => {
      const delays = Array.from({ length: 100 }, () => calculateBackoffDelay(1));
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(1600);
        expect(d).toBeLessThanOrEqual(2400);
      }
    });

    it('returns ~4000ms for attempt 2 (within ±20%)', () => {
      const delays = Array.from({ length: 100 }, () => calculateBackoffDelay(2));
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(3200);
        expect(d).toBeLessThanOrEqual(4800);
      }
    });

    it('adds randomness (not all values identical)', () => {
      const delays = new Set(Array.from({ length: 20 }, () => calculateBackoffDelay(0)));
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  // ─── AC1 + AC3: 429 triggers retries then failover ────────────────

  describe('retryProviderChat', () => {
    it('retries on 429 and succeeds on retry', async () => {
      const provider = makeProvider({ timeout_ms: 5000 });
      let callCount = 0;

      mockedAxios.post.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return { status: 429, data: 'rate limited' };
        }
        return { status: 200, data: validResponse };
      });

      const { result, retryStats } = await retryProviderChat(
        provider,
        [{ role: 'user', content: 'hi' }],
        100, 0.7
      );

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello from AI');
      expect(retryStats.retryAttempts).toBe(2);
      expect(retryStats.totalLatencyMs).toBeGreaterThanOrEqual(0);
      expect(callCount).toBe(3);
      // Verify backoffSleep was called twice (for 2 retries)
      expect(sleepSpy).toHaveBeenCalledTimes(2);
    });

    it('exhausts retries on persistent 429 and throws', async () => {
      const provider = makeProvider({ timeout_ms: 5000 });

      mockedAxios.post.mockImplementation(async () => {
        return { status: 429, data: 'rate limited' };
      });

      await expect(
        retryProviderChat(provider, [{ role: 'user', content: 'hi' }], 100, 0.7)
      ).rejects.toThrow('429');

      // Should have been called 4 times (1 initial + 3 retries)
      expect(mockedAxios.post).toHaveBeenCalledTimes(4);
      // Verify 3 backoff sleeps (between attempts 0-1, 1-2, 2-3)
      expect(sleepSpy).toHaveBeenCalledTimes(3);
    });

    // ─── AC4: 401 immediately fails over (no retry) ──────────────────

    it('does NOT retry on 401 (permanent error) — immediate failover', async () => {
      const provider = makeProvider({ timeout_ms: 5000 });

      mockedAxios.post.mockImplementation(async () => {
        return { status: 401, data: 'unauthorized' };
      });

      await expect(
        retryProviderChat(provider, [{ role: 'user', content: 'hi' }], 100, 0.7)
      ).rejects.toThrow('401');

      // Should only be called once — no retries for permanent errors
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      // No backoff sleep for permanent errors
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it('does NOT retry on 400 (permanent error)', async () => {
      const provider = makeProvider({ timeout_ms: 5000 });

      mockedAxios.post.mockImplementation(async () => {
        return { status: 400, data: 'bad request' };
      });

      await expect(
        retryProviderChat(provider, [{ role: 'user', content: 'hi' }], 100, 0.7)
      ).rejects.toThrow('400');

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it('does NOT retry on 422 (permanent error)', async () => {
      const provider = makeProvider({ timeout_ms: 5000 });

      mockedAxios.post.mockImplementation(async () => {
        return { status: 422, data: 'unprocessable entity' };
      });

      await expect(
        retryProviderChat(provider, [{ role: 'user', content: 'hi' }], 100, 0.7)
      ).rejects.toThrow('422');

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it('retries on 503 (transient) then succeeds', async () => {
      const provider = makeProvider({ timeout_ms: 5000 });
      let callCount = 0;

      mockedAxios.post.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { status: 503, data: 'service unavailable' };
        }
        return { status: 200, data: validResponse };
      });

      const { result, retryStats } = await retryProviderChat(
        provider,
        [{ role: 'user', content: 'hi' }],
        100, 0.7
      );

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello from AI');
      expect(retryStats.retryAttempts).toBe(1);
      expect(sleepSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── AC5: Retry stats are logged ──────────────────────────────────

  describe('retry stats logging', () => {
    it('logs retry attempt count and total latency on success after retries', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const provider = makeProvider({ id: 'retry-log-test', name: 'RetryLogTest' });
      mockProviders.push(provider);

      let callCount = 0;
      mockedAxios.post.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { status: 429, data: 'rate limited' };
        }
        return { status: 200, data: validResponse };
      });

      await chatWithFallback([{ role: 'user', content: 'hi' }], 100, 0.7);

      // Find the retry stats log
      const retryLog = consoleSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('succeeded after') && call[0].includes('retry')
      );
      expect(retryLog).toBeDefined();
      expect(retryLog![0]).toContain('RetryLogTest');
    });

    it('logs retry stats on exhausted retries before failover', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const provider1 = makeProvider({ id: 'exhaust-p1', name: 'ExhaustP1', priority: 0 });
      const provider2 = makeProvider({ id: 'exhaust-p2', name: 'ExhaustP2', priority: 1 });
      mockProviders.push(provider1, provider2);

      let callCount = 0;
      mockedAxios.post.mockImplementation(async () => {
        callCount++;
        // First 4 calls: provider1 429 (1 initial + 3 retries)
        if (callCount <= 4) return { status: 429, data: 'rate limited' };
        // Provider2: succeed
        return { status: 200, data: validResponse };
      });

      const result = await chatWithFallback([{ role: 'user', content: 'hi' }], 100, 0.7);
      expect(result.content).toBe('Hello from AI');
      expect(result.provider!.id).toBe('exhaust-p2');

      // Verify retry stats were logged for failed provider
      const statsLog = warnSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('Retry stats') && call[0].includes('ExhaustP1')
      );
      expect(statsLog).toBeDefined();
    });
  });

  // ─── AC6: Integration — 429 retries 3 times; 401 immediate failover ─

  describe('chatWithFallback integration', () => {
    it('429 triggers 3 retries with backoff before failing over to next provider', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const provider1 = makeProvider({ id: 'rate-limited', name: 'RateLimited', priority: 0 });
      const provider2 = makeProvider({ id: 'backup', name: 'Backup', priority: 1 });
      mockProviders.push(provider1, provider2);

      let callCount = 0;
      mockedAxios.post.mockImplementation(async () => {
        callCount++;
        // First 4 calls: always 429 (provider1: initial + 3 retries)
        if (callCount <= 4) return { status: 429, data: 'rate limited' };
        // Provider2: succeed
        return { status: 200, data: validResponse };
      });

      const result = await chatWithFallback([{ role: 'user', content: 'hi' }], 100, 0.7);

      expect(result.content).toBe('Hello from AI');
      expect(result.provider!.id).toBe('backup');
      // 4 calls to provider1 (1 + 3 retries) + 1 call to provider2
      expect(callCount).toBe(5);
      // Verify backoff was used: 3 sleeps for provider1 retries
      expect(sleepSpy).toHaveBeenCalledTimes(3);
    });

    it('401 immediately fails over — no retries on permanent error', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const provider1 = makeProvider({ id: 'bad-key', name: 'BadKey', priority: 0 });
      const provider2 = makeProvider({ id: 'good', name: 'Good', priority: 1 });
      mockProviders.push(provider1, provider2);

      let callCount = 0;
      mockedAxios.post.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { status: 401, data: 'unauthorized' };
        return { status: 200, data: validResponse };
      });

      const result = await chatWithFallback([{ role: 'user', content: 'hi' }], 100, 0.7);

      expect(result.content).toBe('Hello from AI');
      expect(result.provider!.id).toBe('good');
      // Only 2 calls total: 1 to provider1 (no retry) + 1 to provider2
      expect(callCount).toBe(2);
      // No backoff sleep — permanent error skipped retries
      expect(sleepSpy).not.toHaveBeenCalled();
    });
  });
});
