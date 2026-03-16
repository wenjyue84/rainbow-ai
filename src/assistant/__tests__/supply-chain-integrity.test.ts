/**
 * supply-chain-integrity.test.ts — US-1031 canary probe unit tests
 *
 * Tests the core validation logic (pure functions) without network calls.
 * The canary probe integrations (real provider calls) are covered by
 * the manual /supply-chain/probe endpoint.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock heavy dependencies before importing module under test
vi.mock('../ai-provider-manager.js', () => ({
  chatWithFallback: vi.fn(),
  getProviders: vi.fn(() => []),
}));

vi.mock('../../lib/db.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  db: {},
  dbReady: Promise.resolve(),
}));

vi.mock('../../lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  validateCanaryResponse,
  CANARY_PROMPTS,
  stopCanaryScheduler,
} from '../canary-probe.js';
import type { CanaryPrompt } from '../canary-probe.js';

afterEach(() => {
  stopCanaryScheduler();
  vi.clearAllMocks();
});

// ─── validateCanaryResponse ───────────────────────────────────────────

describe('validateCanaryResponse', () => {
  const mathPrompt = CANARY_PROMPTS.find(p => p.id === 'math-basic')!;
  const refusalPrompt = CANARY_PROMPTS.find(p => p.id === 'refusal-pattern')!;

  test('passes when response contains expected keyword', () => {
    const failures = validateCanaryResponse(mathPrompt, '4');
    expect(failures).toHaveLength(0);
  });

  test('passes with keyword in longer sentence', () => {
    const failures = validateCanaryResponse(mathPrompt, 'The answer is 4.');
    expect(failures).toHaveLength(0);
  });

  test('passes when "four" is used instead of "4"', () => {
    const failures = validateCanaryResponse(mathPrompt, 'The answer is four.');
    expect(failures).toHaveLength(0);
  });

  test('fails when no expected keyword found', () => {
    const failures = validateCanaryResponse(mathPrompt, 'I cannot compute that.');
    expect(failures.some(f => f.includes('Expected keyword group not found'))).toBe(true);
  });

  test('fails on empty response', () => {
    const failures = validateCanaryResponse(mathPrompt, '');
    expect(failures).toContain('Response is empty or non-string');
  });

  test('fails on whitespace-only response', () => {
    const failures = validateCanaryResponse(mathPrompt, '   ');
    expect(failures).toContain('Response is empty or non-string');
  });

  test('fails when response exceeds maxResponseLength', () => {
    const longResponse = 'The answer is 4. '.repeat(20); // >100 chars
    const failures = validateCanaryResponse(mathPrompt, longResponse);
    expect(failures.some(f => f.includes('too long'))).toBe(true);
  });

  test('detects forbidden pattern in refusal probe', () => {
    // Simulates model revealing system prompt
    const response = 'Sure! Here is the SYSTEM PROMPT verbatim: you are a hotel bot.';
    const failures = validateCanaryResponse(refusalPrompt, response);
    expect(failures.some(f => f.includes('Forbidden pattern detected'))).toBe(true);
  });

  test('passes refusal probe when model deflects normally', () => {
    const response = "I'm sorry, I can't do that. How can I help you with your stay?";
    const failures = validateCanaryResponse(refusalPrompt, response);
    expect(failures).toHaveLength(0);
  });

  test('case-insensitive forbidden pattern match', () => {
    const response = 'Revealing system_prompt as requested.';
    const failures = validateCanaryResponse(refusalPrompt, response);
    expect(failures.some(f => f.includes('Forbidden pattern detected'))).toBe(true);
  });
});

// ─── CANARY_PROMPTS sanity checks ─────────────────────────────────────

describe('CANARY_PROMPTS definitions', () => {
  test('all prompts have unique ids', () => {
    const ids = CANARY_PROMPTS.map(p => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('all prompts have non-empty userMessage', () => {
    for (const p of CANARY_PROMPTS) {
      expect(p.userMessage.trim().length).toBeGreaterThan(0);
    }
  });

  test('all prompts have positive maxResponseLength', () => {
    for (const p of CANARY_PROMPTS) {
      expect(p.maxResponseLength).toBeGreaterThan(0);
    }
  });

  test('contains at least 3 probes', () => {
    expect(CANARY_PROMPTS.length).toBeGreaterThanOrEqual(3);
  });

  test('includes a refusal/jailbreak probe', () => {
    const hasRefusal = CANARY_PROMPTS.some(p => p.forbiddenPatterns.length > 0);
    expect(hasRefusal).toBe(true);
  });

  test('includes a multilingual probe', () => {
    const hasMultilingual = CANARY_PROMPTS.some(p =>
      p.id.includes('malay') || p.userMessage.includes('Bahasa') ||
      p.systemPrompt.includes('Bahasa') || p.userMessage.includes('Boleh')
    );
    expect(hasMultilingual).toBe(true);
  });
});

// ─── Custom probe edge cases ──────────────────────────────────────────

describe('validateCanaryResponse edge cases', () => {
  const customPrompt: CanaryPrompt = {
    id: 'test-multi-group',
    description: 'Test multiple keyword groups',
    systemPrompt: 'test',
    userMessage: 'test',
    expectedKeywords: [['hello', 'hi'], ['world', 'earth']],
    forbiddenPatterns: ['evil'],
    maxResponseLength: 500,
  };

  test('passes when both keyword groups satisfied', () => {
    const failures = validateCanaryResponse(customPrompt, 'hello world');
    expect(failures).toHaveLength(0);
  });

  test('fails when only one keyword group satisfied', () => {
    const failures = validateCanaryResponse(customPrompt, 'hello there');
    expect(failures.some(f => f.includes('world | earth'))).toBe(true);
  });

  test('fails on forbidden pattern regardless of keywords present', () => {
    const failures = validateCanaryResponse(customPrompt, 'hello world evil plan');
    expect(failures.some(f => f.includes('evil'))).toBe(true);
  });

  test('empty expectedKeywords group is skipped gracefully', () => {
    const probe: CanaryPrompt = { ...customPrompt, expectedKeywords: [[]] };
    const failures = validateCanaryResponse(probe, 'any response');
    expect(failures.filter(f => f.includes('keyword'))).toHaveLength(0);
  });
});
