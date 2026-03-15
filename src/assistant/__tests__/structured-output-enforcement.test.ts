/**
 * Tests for US-1015: Structured LLM output schema enforcement with Zod validation and retry.
 *
 * Covers:
 * - AC1: JSON schema passed to provider via response_format
 * - AC2: Automatic retry with corrective system message (max 2 retries)
 * - AC3: Safe fallback when all retries exhausted
 * - AC4: Schema validation errors logged as 'structured_output_failure'
 * - AC5: Valid schema pass, single failure with retry success, all retries exhausted fallback
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { zodSchemaToJsonSchema } from '../ai-response-generator.js';
import {
  safeParseLLMResponse,
  classifyResultSchema,
  aiResponseSchema,
  replyOnlyResultSchema,
  bookingExtractionSchema,
} from '../schemas.js';

// ─── zodSchemaToJsonSchema tests (AC1) ────────────────────────────────

describe('zodSchemaToJsonSchema', () => {
  test('converts classifyResultSchema to valid JSON schema', () => {
    const result = zodSchemaToJsonSchema(classifyResultSchema, 'classifyResult');
    expect(result).toBeDefined();
    expect(result!.name).toBe('classifyResult');
    expect(result!.schema).toBeDefined();
    expect(typeof result!.schema).toBe('object');
  });

  test('converts aiResponseSchema to valid JSON schema', () => {
    const result = zodSchemaToJsonSchema(aiResponseSchema, 'aiResponse');
    expect(result).toBeDefined();
    expect(result!.name).toBe('aiResponse');
    expect(result!.schema).toHaveProperty('type');
  });

  test('converts replyOnlyResultSchema to valid JSON schema', () => {
    const result = zodSchemaToJsonSchema(replyOnlyResultSchema, 'replyOnly');
    expect(result).toBeDefined();
    expect(result!.name).toBe('replyOnly');
  });

  test('converts bookingExtractionSchema to valid JSON schema', () => {
    const result = zodSchemaToJsonSchema(bookingExtractionSchema, 'bookingExtraction');
    expect(result).toBeDefined();
    expect(result!.name).toBe('bookingExtraction');
  });
});

// ─── generateWithValidation tests (AC2, AC3, AC5) ────────────────────

// Mock the chatWithFallback to control LLM responses
vi.mock('../ai-provider-manager.js', () => ({
  chatWithFallback: vi.fn(),
  isAIAvailable: vi.fn(() => true),
  getAISettings: vi.fn(() => ({
    max_classify_tokens: 200,
    max_chat_tokens: 500,
    classify_temperature: 0.1,
    chat_temperature: 0.7,
  })),
  getProviders: vi.fn(() => []),
  resolveApiKey: vi.fn(),
  getGroqInstance: vi.fn(),
  providerChat: vi.fn(),
}));

// Mock intent-tracker for failure logging (AC4)
vi.mock('../intent-tracker.js', () => ({
  trackIntentPrediction: vi.fn().mockResolvedValue(undefined),
}));

import { chatWithFallback } from '../ai-provider-manager.js';
import { trackIntentPrediction } from '../intent-tracker.js';
import { generateWithValidation } from '../ai-response-generator.js';

const mockChatWithFallback = vi.mocked(chatWithFallback);
const mockTrackIntentPrediction = vi.mocked(trackIntentPrediction);

const testSchema = z.object({
  category: z.string(),
  confidence: z.number().min(0).max(1),
});

const mockProvider = { id: 'test-provider', name: 'TestProvider', model: 'test-model' };

describe('generateWithValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC5: Valid schema pass — first attempt succeeds
  test('returns validated data on first attempt success', async () => {
    const validResponse = '{"category":"pricing","confidence":0.92}';
    mockChatWithFallback.mockResolvedValueOnce({
      content: validResponse,
      provider: mockProvider as any,
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });

    const result = await generateWithValidation(
      [{ role: 'system', content: 'test' }],
      testSchema,
      200,
      0.1,
      2,
      'test'
    );

    expect(result.data).toEqual({ category: 'pricing', confidence: 0.92 });
    expect(result.retried).toBe(false);
    expect(result.provider).toBe(mockProvider);
    // chatWithFallback should be called exactly once
    expect(mockChatWithFallback).toHaveBeenCalledTimes(1);
  });

  // AC5: Single schema failure with retry success
  test('retries on first validation failure and succeeds on second attempt', async () => {
    const invalidResponse = '{"category":123,"confidence":"high"}';
    const validResponse = '{"category":"pricing","confidence":0.88}';

    mockChatWithFallback
      .mockResolvedValueOnce({
        content: invalidResponse,
        provider: mockProvider as any,
        usage: { prompt_tokens: 100 },
      })
      .mockResolvedValueOnce({
        content: validResponse,
        provider: mockProvider as any,
        usage: { prompt_tokens: 120 },
      });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await generateWithValidation(
      [{ role: 'system', content: 'test' }],
      testSchema,
      200,
      0.1,
      2,
      'test'
    );

    expect(result.data).toEqual({ category: 'pricing', confidence: 0.88 });
    expect(result.retried).toBe(true);
    // First call + 1 retry
    expect(mockChatWithFallback).toHaveBeenCalledTimes(2);

    // Verify the retry call includes corrective message about schema
    const retryCallArgs = mockChatWithFallback.mock.calls[1];
    const retryMessages = retryCallArgs[0] as any[];
    const lastMsg = retryMessages[retryMessages.length - 1];
    expect(lastMsg.content).toContain('did not conform to the required JSON schema');

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  // AC5: All retries exhausted — safe fallback (returns null data)
  test('returns null data when all retries are exhausted', async () => {
    const invalidResponse = '{"category":123,"confidence":"bad"}';

    // All 3 attempts (1 initial + 2 retries) return invalid data
    mockChatWithFallback
      .mockResolvedValueOnce({ content: invalidResponse, provider: mockProvider as any })
      .mockResolvedValueOnce({ content: invalidResponse, provider: mockProvider as any })
      .mockResolvedValueOnce({ content: invalidResponse, provider: mockProvider as any });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await generateWithValidation(
      [{ role: 'system', content: 'test' }],
      testSchema,
      200,
      0.1,
      2,
      'test'
    );

    expect(result.data).toBeNull();
    expect(result.retried).toBe(true);
    expect(result.raw).toBe(invalidResponse);
    // 1 initial + 2 retries = 3 calls
    expect(mockChatWithFallback).toHaveBeenCalledTimes(3);

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  // AC4: Schema validation errors logged as structured_output_failure
  test('logs structured_output_failure event when all retries exhausted', async () => {
    const invalidResponse = '{"category":999}';

    mockChatWithFallback
      .mockResolvedValueOnce({ content: invalidResponse, provider: mockProvider as any })
      .mockResolvedValueOnce({ content: invalidResponse, provider: mockProvider as any })
      .mockResolvedValueOnce({ content: invalidResponse, provider: mockProvider as any });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await generateWithValidation(
      [{ role: 'system', content: 'test' }],
      testSchema,
      200,
      0.1,
      2,
      'testSchema'
    );

    // Wait for the async logging to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // AC4: Verify structured_output_failure was logged to intent_analytics
    expect(mockTrackIntentPrediction).toHaveBeenCalledWith(
      expect.stringContaining('schema_failure_'),
      'system',
      expect.stringContaining('Schema: testSchema'),
      'structured_output_failure',
      0,
      expect.stringContaining('schema_validation_fail'),
      expect.any(String)
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  // AC1: JSON schema passed to provider via response_format
  test('passes JSON schema to chatWithFallback for provider enforcement', async () => {
    const validResponse = '{"category":"booking","confidence":0.95}';
    mockChatWithFallback.mockResolvedValueOnce({
      content: validResponse,
      provider: mockProvider as any,
    });

    await generateWithValidation(
      [{ role: 'system', content: 'test' }],
      testSchema,
      200,
      0.1,
      2,
      'test'
    );

    // Verify chatWithFallback was called with jsonSchema argument (7th param)
    const callArgs = mockChatWithFallback.mock.calls[0];
    const jsonSchemaArg = callArgs[6]; // 7th argument (0-indexed position 6)
    expect(jsonSchemaArg).toBeDefined();
    expect(jsonSchemaArg).toHaveProperty('name', 'test');
    expect(jsonSchemaArg).toHaveProperty('schema');
  });

  // AC3: Returns null when no content from provider (not retried)
  test('returns null data when provider returns no content', async () => {
    mockChatWithFallback.mockResolvedValueOnce({
      content: null,
      provider: null,
    });

    const result = await generateWithValidation(
      [{ role: 'system', content: 'test' }],
      testSchema,
      200,
      0.1,
      2,
      'test'
    );

    expect(result.data).toBeNull();
    expect(result.raw).toBeNull();
    expect(result.retried).toBe(false);
    expect(mockChatWithFallback).toHaveBeenCalledTimes(1);
  });

  // AC2: Corrective retry includes schema description
  test('corrective retry message includes JSON schema description', async () => {
    const invalidResponse = '{"wrong":"format"}';
    const validResponse = '{"category":"greeting","confidence":0.99}';

    mockChatWithFallback
      .mockResolvedValueOnce({ content: invalidResponse, provider: mockProvider as any })
      .mockResolvedValueOnce({ content: validResponse, provider: mockProvider as any });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await generateWithValidation(
      [{ role: 'system', content: 'test' }],
      testSchema,
      200,
      0.1,
      2,
      'test'
    );

    // Verify retry message includes "schema" reference for corrective prompting
    const retryCallArgs = mockChatWithFallback.mock.calls[1];
    const retryMessages = retryCallArgs[0] as any[];
    const correctiveMsg = retryMessages.find(
      (m: any) => m.role === 'user' && m.content.includes('JSON schema')
    );
    expect(correctiveMsg).toBeDefined();
    expect(correctiveMsg.content).toContain('Validation errors:');

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  // Edge: maxRetries = 0 means no retries
  test('skips retries when maxRetries is 0', async () => {
    const invalidResponse = '{"category":false}';
    mockChatWithFallback.mockResolvedValueOnce({
      content: invalidResponse,
      provider: mockProvider as any,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await generateWithValidation(
      [{ role: 'system', content: 'test' }],
      testSchema,
      200,
      0.1,
      0,
      'test'
    );

    expect(result.data).toBeNull();
    expect(result.retried).toBe(false);
    expect(mockChatWithFallback).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  // Verify providerIds are passed through
  test('passes providerIds to chatWithFallback', async () => {
    const validResponse = '{"category":"wifi","confidence":0.9}';
    mockChatWithFallback.mockResolvedValueOnce({
      content: validResponse,
      provider: mockProvider as any,
    });

    await generateWithValidation(
      [{ role: 'system', content: 'test' }],
      testSchema,
      200,
      0.1,
      2,
      'test',
      ['provider-a', 'provider-b']
    );

    const callArgs = mockChatWithFallback.mock.calls[0];
    const providerIdsArg = callArgs[4]; // 5th argument (providerIds)
    expect(providerIdsArg).toEqual(['provider-a', 'provider-b']);
  });
});
