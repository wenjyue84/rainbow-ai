/**
 * Tests for structured LLM output retry with error context re-prompting (US-471)
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// Mock dependencies before importing module under test
vi.mock('../ai-provider-manager.js', () => ({
  isAIAvailable: vi.fn(() => true),
  getAISettings: vi.fn(() => ({ max_chat_tokens: 500, chat_temperature: 0.3 })),
  getProviders: vi.fn(() => []),
  resolveApiKey: vi.fn(() => 'test-key'),
  getGroqInstance: vi.fn(() => null),
  providerChat: vi.fn(),
  chatWithFallback: vi.fn(),
}));

vi.mock('../config-store.js', () => ({
  configStore: {
    getSettings: vi.fn(() => ({})),
    getRouting: vi.fn(() => ({ pricing: {}, booking: {}, general: {} })),
  },
}));

vi.mock('../context-windows.js', () => ({
  getContextWindows: vi.fn(() => ({ combined: 10, reply: 5, classification: 5 })),
}));

import { generateWithValidation } from '../ai-response-generator.js';
import { chatWithFallback } from '../ai-provider-manager.js';

const mockedChatWithFallback = vi.mocked(chatWithFallback);

const testSchema = z.object({
  intent: z.string(),
  action: z.enum(['reply', 'escalate']),
  response: z.string(),
  confidence: z.number().min(0).max(1),
});

describe('generateWithValidation (US-471)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('first attempt succeeds validation → response used directly', async () => {
    const validJson = JSON.stringify({
      intent: 'pricing',
      action: 'reply',
      response: 'Room is RM35/night',
      confidence: 0.9,
    });

    mockedChatWithFallback.mockResolvedValueOnce({
      content: validJson,
      provider: { name: 'test-provider', model: 'test-model' },
      usage: { total_tokens: 100 },
    });

    const result = await generateWithValidation(
      [{ role: 'user', content: 'How much?' }],
      testSchema,
      500,
      0.3,
      1
    );

    expect(result.data).toEqual({
      intent: 'pricing',
      action: 'reply',
      response: 'Room is RM35/night',
      confidence: 0.9,
    });
    expect(result.retried).toBe(false);
    // Should only call chatWithFallback once
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(1);
  });

  test('first attempt fails validation → retry succeeds → retry response used', async () => {
    // First call: invalid (confidence > 1)
    const invalidJson = JSON.stringify({
      intent: 'pricing',
      action: 'reply',
      response: 'Room is RM35',
      confidence: 1.5,
    });
    // Second call: valid
    const validJson = JSON.stringify({
      intent: 'pricing',
      action: 'reply',
      response: 'Room is RM35/night',
      confidence: 0.85,
    });

    mockedChatWithFallback
      .mockResolvedValueOnce({
        content: invalidJson,
        provider: { name: 'provider-1' },
      })
      .mockResolvedValueOnce({
        content: validJson,
        provider: { name: 'provider-2' },
        usage: { total_tokens: 120 },
      });

    const result = await generateWithValidation(
      [{ role: 'user', content: 'How much?' }],
      testSchema,
      500,
      0.3,
      1
    );

    expect(result.data).toEqual({
      intent: 'pricing',
      action: 'reply',
      response: 'Room is RM35/night',
      confidence: 0.85,
    });
    expect(result.retried).toBe(true);
    // Should call chatWithFallback twice
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(2);

    // Verify retry message includes validation error
    const retryCall = mockedChatWithFallback.mock.calls[1];
    const retryMessages = retryCall[0] as Array<{ role: string; content: string }>;
    const lastMsg = retryMessages[retryMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('Your previous response did not conform to the required JSON schema');
  });

  test('both attempts fail validation → returns null data with raw content', async () => {
    const invalidJson1 = JSON.stringify({
      intent: 'pricing',
      action: 'invalid_action',
      response: 'text',
      confidence: 0.9,
    });
    const invalidJson2 = JSON.stringify({
      intent: 'pricing',
      action: 'also_invalid',
      response: 'text',
      confidence: 0.9,
    });

    mockedChatWithFallback
      .mockResolvedValueOnce({
        content: invalidJson1,
        provider: { name: 'provider-1' },
      })
      .mockResolvedValueOnce({
        content: invalidJson2,
        provider: { name: 'provider-2' },
      });

    const result = await generateWithValidation(
      [{ role: 'user', content: 'test' }],
      testSchema,
      500,
      0.3,
      1
    );

    expect(result.data).toBeNull();
    expect(result.raw).toBe(invalidJson2); // raw from last attempt
    expect(result.retried).toBe(true);
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(2);
  });

  test('no content returned from LLM → returns null without retry', async () => {
    mockedChatWithFallback.mockResolvedValueOnce({
      content: null,
      provider: null,
    });

    const result = await generateWithValidation(
      [{ role: 'user', content: 'test' }],
      testSchema,
      500,
      0.3,
      1
    );

    expect(result.data).toBeNull();
    expect(result.raw).toBeNull();
    expect(result.retried).toBe(false);
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(1);
  });

  test('maxRetries=0 skips retry even on validation failure', async () => {
    const invalidJson = JSON.stringify({
      intent: 'pricing',
      action: 'invalid_action',
      response: 'text',
      confidence: 0.9,
    });

    mockedChatWithFallback.mockResolvedValueOnce({
      content: invalidJson,
      provider: { name: 'provider-1' },
    });

    const result = await generateWithValidation(
      [{ role: 'user', content: 'test' }],
      testSchema,
      500,
      0.3,
      0 // no retries
    );

    expect(result.data).toBeNull();
    expect(result.raw).toBe(invalidJson);
    expect(result.retried).toBe(false);
    expect(mockedChatWithFallback).toHaveBeenCalledTimes(1);
  });
});
