/**
 * Tests for Zod-based LLM response validation (US-459)
 */
import { describe, test, expect, vi } from 'vitest';
import {
  safeParseLLMResponse,
  classifyResultSchema,
  replyOnlyResultSchema,
  bookingExtractionSchema,
  aiResponseSchema,
} from '../schemas.js';

describe('safeParseLLMResponse', () => {
  test('parses valid JSON through classifyResultSchema', () => {
    const raw = '{"category":"pricing","confidence":0.92,"entities":{"guest_count":2}}';
    const result = safeParseLLMResponse(raw, classifyResultSchema, 'test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('pricing');
      expect(result.data.confidence).toBe(0.92);
      expect(result.data.entities).toEqual({ guest_count: 2 });
    }
  });

  test('extracts JSON from markdown-wrapped LLM response', () => {
    const raw = '```json\n{"category":"greeting","confidence":0.99}\n```';
    const result = safeParseLLMResponse(raw, classifyResultSchema, 'test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('greeting');
    }
  });

  test('returns failure with structured error for invalid schema', () => {
    const raw = '{"category":123,"confidence":"high"}';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = safeParseLLMResponse(raw, classifyResultSchema, 'test');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Validation failed');
    }
    // Verify structured error was logged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[LLMValidation:test]'),
      expect.stringContaining('path')
    );
    warnSpy.mockRestore();
  });

  test('returns failure for completely invalid JSON', () => {
    const raw = 'This is not JSON at all';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = safeParseLLMResponse(raw, classifyResultSchema, 'test');
    expect(result.success).toBe(false);
    warnSpy.mockRestore();
  });

  test('applies default for optional entities field in classify result', () => {
    const raw = '{"category":"wifi","confidence":0.85}';
    const result = safeParseLLMResponse(raw, classifyResultSchema, 'test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entities).toEqual({});
    }
  });
});

describe('replyOnlyResultSchema validation', () => {
  test('parses valid reply-only response', () => {
    const raw = '{"response":"Check-in is at 2pm","confidence":0.88}';
    const result = safeParseLLMResponse(raw, replyOnlyResultSchema, 'test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.response).toBe('Check-in is at 2pm');
      expect(result.data.confidence).toBe(0.88);
    }
  });

  test('allows missing confidence (optional)', () => {
    const raw = '{"response":"Hello!"}';
    const result = safeParseLLMResponse(raw, replyOnlyResultSchema, 'test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confidence).toBeUndefined();
    }
  });

  test('rejects missing response field', () => {
    const raw = '{"confidence":0.5}';
    const result = safeParseLLMResponse(raw, replyOnlyResultSchema, 'test');
    expect(result.success).toBe(false);
  });
});

describe('bookingExtractionSchema validation', () => {
  test('parses valid booking extraction', () => {
    const raw = '{"checkIn":"2026-04-01","checkOut":"2026-04-03","guests":2,"understood":true}';
    const result = safeParseLLMResponse(raw, bookingExtractionSchema, 'test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.checkIn).toBe('2026-04-01');
      expect(result.data.guests).toBe(2);
      expect(result.data.understood).toBe(true);
    }
  });

  test('parses understood=false response (no dates)', () => {
    const raw = '{"understood":false}';
    const result = safeParseLLMResponse(raw, bookingExtractionSchema, 'test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.understood).toBe(false);
    }
  });

  test('rejects missing understood field', () => {
    const raw = '{"checkIn":"2026-04-01"}';
    const result = safeParseLLMResponse(raw, bookingExtractionSchema, 'test');
    expect(result.success).toBe(false);
  });
});

describe('aiResponseSchema validation', () => {
  test('parses valid AI response with all fields', () => {
    const raw = '{"intent":"pricing","action":"reply","response":"Room is RM35/night","confidence":0.9}';
    const result = safeParseLLMResponse(raw, aiResponseSchema, 'test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe('pricing');
      expect(result.data.action).toBe('reply');
      expect(result.data.confidence).toBe(0.9);
    }
  });

  test('rejects invalid action value', () => {
    const raw = '{"intent":"pricing","action":"invalid_action","response":"text","confidence":0.9}';
    const result = safeParseLLMResponse(raw, aiResponseSchema, 'test');
    expect(result.success).toBe(false);
  });

  test('rejects confidence > 1', () => {
    const raw = '{"intent":"pricing","action":"reply","response":"text","confidence":1.5}';
    const result = safeParseLLMResponse(raw, aiResponseSchema, 'test');
    expect(result.success).toBe(false);
  });
});
