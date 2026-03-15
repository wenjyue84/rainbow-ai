/**
 * Unit tests for PDPA 2024 PII masking before AI provider calls (US-915).
 *
 * Verifies that PII regex patterns (phone, email, IC number formats)
 * are stripped from all prompts before the provider call.
 */
import { describe, test, expect } from 'vitest';
import { redactPii, maskPiiForProvider } from '../pii-redactor.js';
import { resolveProcessingCountry, getTiaStatuses } from '../../lib/pdpa-compliance.js';

// ─── Malaysian Phone Number Patterns ────────────────────────────────

describe('PDPA: Malaysian phone number redaction', () => {
  test('redacts +60 format phone number', () => {
    const result = redactPii('Call me at +60123456789 for booking');
    expect(result.redacted).toContain('[PHONE_REDACTED]');
    expect(result.redacted).not.toContain('+60123456789');
    expect(result.hadPii).toBe(true);
    expect(result.types).toContain('PHONE');
  });

  test('redacts 60 format (without plus)', () => {
    const result = redactPii('WhatsApp: 60123456789');
    expect(result.redacted).toContain('[PHONE_REDACTED]');
    expect(result.redacted).not.toContain('60123456789');
    expect(result.types).toContain('PHONE');
  });

  test('redacts +60 with dashes', () => {
    const result = redactPii('Contact: +60-12-345-6789');
    expect(result.redacted).toContain('[PHONE_REDACTED]');
    expect(result.redacted).not.toContain('12-345-6789');
  });

  test('redacts +60 with spaces', () => {
    const result = redactPii('My number is +60 12 3456 7890');
    expect(result.redacted).toContain('[PHONE_REDACTED]');
    expect(result.redacted).not.toContain('3456 7890');
  });

  test('redacts local format 01X-XXXXXXX', () => {
    const result = redactPii('Call 012-3456789 for help');
    expect(result.redacted).toContain('[PHONE_REDACTED]');
    expect(result.redacted).not.toContain('012-3456789');
  });

  test('redacts local format 01XXXXXXXXX (no dashes)', () => {
    const result = redactPii('Number: 0123456789');
    expect(result.redacted).toContain('[PHONE_REDACTED]');
    expect(result.redacted).not.toContain('0123456789');
  });

  test('redacts 011 prefix (8-digit local)', () => {
    const result = redactPii('WhatsApp: 011-12345678');
    expect(result.redacted).toContain('[PHONE_REDACTED]');
    expect(result.redacted).not.toContain('011-12345678');
  });
});

// ─── maskPiiForProvider: Pre-API-call masking ───────────────────────

describe('PDPA: maskPiiForProvider', () => {
  test('masks phone numbers in user messages', () => {
    const messages = [
      { role: 'system', content: 'You are a hotel assistant.' },
      { role: 'user', content: 'My phone is +60123456789, please call me' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[1].content).toContain('[PHONE_REDACTED]');
    expect(masked[1].content).not.toContain('+60123456789');
    expect(categories).toContain('PHONE');
  });

  test('masks email addresses in messages', () => {
    const messages = [
      { role: 'user', content: 'Send receipt to guest@example.com' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).toContain('[EMAIL_REDACTED]');
    expect(masked[0].content).not.toContain('guest@example.com');
    expect(categories).toContain('EMAIL');
  });

  test('masks IC numbers in messages', () => {
    const messages = [
      { role: 'user', content: 'My IC is 900101-14-5678' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).toContain('[MY_IC_REDACTED]');
    expect(masked[0].content).not.toContain('900101-14-5678');
    expect(categories).toContain('MY_IC');
  });

  test('replaces guest name with "Guest" when provided', () => {
    const messages = [
      { role: 'system', content: 'The guest name is Ahmad.' },
      { role: 'user', content: 'Ahmad wants to check in.' },
    ];
    const { masked, categories } = maskPiiForProvider(messages, 'Ahmad');
    expect(masked[0].content).toContain('Guest');
    expect(masked[0].content).not.toContain('Ahmad');
    expect(masked[1].content).toContain('Guest');
    expect(masked[1].content).not.toContain('Ahmad');
    expect(categories).toContain('GUEST_NAME');
  });

  test('does not mutate original messages array', () => {
    const messages = [
      { role: 'user', content: 'Call +60123456789' },
    ];
    const originalContent = messages[0].content;
    maskPiiForProvider(messages);
    expect(messages[0].content).toBe(originalContent);
  });

  test('preserves non-string content (cache_control objects)', () => {
    const messages = [
      { role: 'system', content: [{ type: 'text', text: 'system prompt', cache_control: { type: 'ephemeral' } }] as any },
      { role: 'user', content: 'Call 0123456789' },
    ];
    const { masked } = maskPiiForProvider(messages);
    // System message with non-string content should pass through unchanged
    expect(masked[0].content).toEqual(messages[0].content);
    // User message should be masked
    expect(masked[1].content).toContain('[PHONE_REDACTED]');
  });

  test('masks multiple PII types in a single message', () => {
    const messages = [
      { role: 'user', content: 'IC: 850615-10-1234, email: test@gmail.com, phone: +60123456789' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).not.toContain('850615-10-1234');
    expect(masked[0].content).not.toContain('test@gmail.com');
    expect(masked[0].content).not.toContain('+60123456789');
    expect(categories.length).toBeGreaterThanOrEqual(2);
  });

  test('safe messages pass through unchanged', () => {
    const messages = [
      { role: 'user', content: 'What time is check-in?' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).toBe('What time is check-in?');
    expect(categories).toHaveLength(0);
  });

  test('short guest name (1 char) is not replaced', () => {
    const messages = [
      { role: 'user', content: 'A wants to book.' },
    ];
    const { masked, categories } = maskPiiForProvider(messages, 'A');
    expect(masked[0].content).toBe('A wants to book.');
    expect(categories).not.toContain('GUEST_NAME');
  });
});

// ─── Processing Country Resolution ──────────────────────────────────

describe('PDPA: resolveProcessingCountry', () => {
  test('resolves NVIDIA as US', () => {
    expect(resolveProcessingCountry('https://integrate.api.nvidia.com/v1', 'openai-compatible')).toBe('US');
  });

  test('resolves OpenRouter as US', () => {
    expect(resolveProcessingCountry('https://openrouter.ai/api/v1', 'openai-compatible')).toBe('US');
  });

  test('resolves Ollama as MY (local)', () => {
    expect(resolveProcessingCountry('http://localhost:11434', 'ollama')).toBe('MY');
  });

  test('resolves localhost as MY', () => {
    expect(resolveProcessingCountry('http://127.0.0.1:8080', 'openai-compatible')).toBe('MY');
  });

  test('resolves unknown URL as unknown', () => {
    expect(resolveProcessingCountry('https://some-random-api.com', 'openai-compatible')).toBe('unknown');
  });
});

// ─── Transfer Impact Assessment ─────────────────────────────────────

describe('PDPA: Transfer Impact Assessment statuses', () => {
  test('NVIDIA provider requires completed TIA', () => {
    const providers = [
      { id: 'kimi-k2.5', name: 'NVIDIA Kimi K2.5', base_url: 'https://integrate.api.nvidia.com/v1', type: 'openai-compatible' },
    ];
    const tia = getTiaStatuses(providers);
    expect(tia).toHaveLength(1);
    expect(tia[0].tiaStatus).toBe('completed');
    expect(tia[0].processingCountry).toBe('US');
  });

  test('OpenRouter provider requires completed TIA', () => {
    const providers = [
      { id: 'openrouter-1', name: 'OpenRouter Claude', base_url: 'https://openrouter.ai/api/v1', type: 'openai-compatible' },
    ];
    const tia = getTiaStatuses(providers);
    expect(tia[0].tiaStatus).toBe('completed');
    expect(tia[0].processingCountry).toBe('US');
  });

  test('Ollama provider does not require TIA', () => {
    const providers = [
      { id: 'ollama-local', name: 'Ollama Local', base_url: 'http://localhost:11434', type: 'ollama' },
    ];
    const tia = getTiaStatuses(providers);
    expect(tia[0].tiaStatus).toBe('not_required');
    expect(tia[0].processingCountry).toBe('MY');
  });

  test('unknown provider gets pending TIA', () => {
    const providers = [
      { id: 'custom-1', name: 'Custom AI', base_url: 'https://custom-ai.eu/v1', type: 'openai-compatible' },
    ];
    const tia = getTiaStatuses(providers);
    expect(tia[0].tiaStatus).toBe('pending');
  });

  test('multiple providers return correct TIA statuses', () => {
    const providers = [
      { id: 'kimi-k2.5', name: 'NVIDIA Kimi K2.5', base_url: 'https://integrate.api.nvidia.com/v1', type: 'openai-compatible' },
      { id: 'ollama-local', name: 'Ollama Local', base_url: 'http://localhost:11434', type: 'ollama' },
      { id: 'openrouter-1', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', type: 'openai-compatible' },
    ];
    const tia = getTiaStatuses(providers);
    expect(tia).toHaveLength(3);
    expect(tia.find(t => t.providerId === 'kimi-k2.5')?.tiaStatus).toBe('completed');
    expect(tia.find(t => t.providerId === 'ollama-local')?.tiaStatus).toBe('not_required');
    expect(tia.find(t => t.providerId === 'openrouter-1')?.tiaStatus).toBe('completed');
  });
});
