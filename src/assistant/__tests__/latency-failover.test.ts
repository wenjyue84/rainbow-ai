/**
 * Latency Failover Tests (US-423)
 *
 * Verifies that LLM provider calls that exceed the configured timeout_ms
 * trigger failover to the next provider instead of hanging.
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
  providerChat,
  chatWithFallback,
  DEFAULT_TIMEOUT_MS,
  TimeoutError,
  backoffUtils,
} from '../ai-provider-manager.js';
import type { AIProvider } from '../schemas.js';
import { circuitBreakerRegistry } from '../circuit-breaker.js';

const mockedAxios = vi.mocked(axios);

// Helper: create a provider config for testing
function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'test-ollama',
    name: 'Test Ollama',
    type: 'ollama',
    api_key_env: '',
    base_url: 'http://localhost:11434/v1',
    model: 'test-model',
    enabled: true,
    priority: 0,
    timeout_ms: 6000,
    ...overrides,
  };
}

// Helper: create a delayed promise (simulates slow provider)
function delayedResponse(delayMs: number, data: any): Promise<any> {
  return new Promise((resolve) =>
    setTimeout(() => resolve({ status: 200, data }), delayMs)
  );
}

// Helper: valid OpenAI-format response
const validResponse = {
  choices: [{ message: { content: 'Hello from AI' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('Latency Failover (US-423)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    circuitBreakerRegistry.resetAll();
    // Reset providers array
    mockProviders.length = 0;
    // US-938: Mock backoff sleep so timeout retries don't add real delays
    vi.spyOn(backoffUtils, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('TimeoutError', () => {
    it('carries provider, timeoutMs, and elapsedMs metadata', () => {
      const err = new TimeoutError('TestProvider', 6000, 6100);
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err.name).toBe('TimeoutError');
      expect(err.timeoutMs).toBe(6000);
      expect(err.elapsedMs).toBe(6100);
      expect(err.message).toContain('TestProvider');
      expect(err.message).toContain('6000ms');
    });
  });

  describe('DEFAULT_TIMEOUT_MS', () => {
    it('defaults to 6000ms', () => {
      expect(DEFAULT_TIMEOUT_MS).toBe(6000);
    });
  });

  describe('providerChat — timeout enforcement', () => {
    it('rejects with TimeoutError when provider exceeds timeout_ms', async () => {
      const slowProvider = makeProvider({ timeout_ms: 200 }); // 200ms timeout

      // Mock axios to delay 10 seconds (simulating a slow provider)
      mockedAxios.post.mockImplementation(() => delayedResponse(10000, validResponse));

      const start = Date.now();
      await expect(
        providerChat(slowProvider, [{ role: 'user', content: 'hi' }], 100, 0.7)
      ).rejects.toThrow(TimeoutError);
      const elapsed = Date.now() - start;

      // Should fail fast — well under the 10s delay
      expect(elapsed).toBeLessThan(1000);
    });

    it('succeeds when provider responds within timeout_ms', async () => {
      const fastProvider = makeProvider({ timeout_ms: 5000 });

      // Mock axios to respond in 50ms
      mockedAxios.post.mockImplementation(() => delayedResponse(50, validResponse));

      const result = await providerChat(
        fastProvider,
        [{ role: 'user', content: 'hi' }],
        100,
        0.7
      );

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello from AI');
    });

    it('uses DEFAULT_TIMEOUT_MS when provider has no timeout_ms', async () => {
      const noTimeoutProvider = makeProvider();
      delete (noTimeoutProvider as any).timeout_ms;

      // Mock axios to respond quickly
      mockedAxios.post.mockImplementation(() => delayedResponse(50, validResponse));

      const result = await providerChat(
        noTimeoutProvider,
        [{ role: 'user', content: 'hi' }],
        100,
        0.7
      );

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello from AI');
    });
  });

  describe('chatWithFallback — timeout triggers failover', () => {
    it('fails over to the next provider when the first one times out (after retries)', async () => {
      const slowProvider = makeProvider({
        id: 'slow-provider',
        name: 'Slow Provider',
        priority: 0,
        timeout_ms: 500, // 500ms timeout for fast test
      });
      const fastProvider = makeProvider({
        id: 'fast-provider',
        name: 'Fast Provider',
        priority: 1,
        timeout_ms: 5000,
      });

      // Set providers in mock settings
      mockProviders.push(slowProvider, fastProvider);

      let callCount = 0;
      mockedAxios.post.mockImplementation(() => {
        callCount++;
        // US-938: First 4 calls are slow provider (1 initial + 3 retries), all timeout
        if (callCount <= 4) {
          return delayedResponse(10000, validResponse);
        }
        // Second provider: respond immediately
        return delayedResponse(20, validResponse);
      });

      const result = await chatWithFallback(
        [{ role: 'user', content: 'hi' }],
        100,
        0.7
      );

      expect(result.content).toBe('Hello from AI');
      expect(result.provider).not.toBeNull();
      expect(result.provider!.id).toBe('fast-provider');
      // US-938: 4 calls to slow provider + 1 to fast provider
      expect(callCount).toBe(5);
    });

    it('returns slow-response apology when ALL providers time out (after retries)', async () => {
      const providers = [
        makeProvider({ id: 'p1', name: 'Provider 1', priority: 0, timeout_ms: 200 }),
        makeProvider({ id: 'p2', name: 'Provider 2', priority: 1, timeout_ms: 200 }),
      ];

      mockProviders.push(...providers);

      // All providers delay 10s (will timeout at 200ms), even after retries
      mockedAxios.post.mockImplementation(() => delayedResponse(10000, validResponse));

      const result = await chatWithFallback(
        [{ role: 'user', content: 'hi' }],
        100,
        0.7
      );

      // Should return the configurable apology message
      expect(result.content).toBe('All systems slow. Please contact staff.');
      expect(result.provider).toBeNull();
    });

    it('logs timeout failover with provider, timeout_ms, elapsed_ms, action', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const slowProvider = makeProvider({
        id: 'slow-log-test',
        name: 'Slow Log Test',
        priority: 0,
        timeout_ms: 100,
      });
      const fastProvider = makeProvider({
        id: 'fast-log-test',
        name: 'Fast Log Test',
        priority: 1,
        timeout_ms: 5000,
      });

      mockProviders.push(slowProvider, fastProvider);

      let callCount = 0;
      mockedAxios.post.mockImplementation(() => {
        callCount++;
        // US-938: First 4 calls are slow provider (retried), all timeout
        if (callCount <= 4) return delayedResponse(10000, validResponse);
        return delayedResponse(10, validResponse);
      });

      await chatWithFallback([{ role: 'user', content: 'hi' }], 100, 0.7);

      // Check the warn log contains the expected structure (after retries exhausted)
      const timeoutLog = consoleSpy.mock.calls.find(
        (call) => typeof call[1] === 'string' && call[1].includes('"timeout_ms"') && call[1].includes('"action":"failover"')
      );
      expect(timeoutLog).toBeDefined();
      const logData = JSON.parse(timeoutLog![1] as string);
      expect(logData.provider).toBe('slow-log-test');
      expect(logData.timeout_ms).toBe(100);
      expect(logData.action).toBe('failover');
      expect(typeof logData.elapsed_ms).toBe('number');

      consoleSpy.mockRestore();
    });
  });
});
