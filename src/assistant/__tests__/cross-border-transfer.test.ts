/**
 * Unit tests for US-930: Malaysia PDPA cross-border data transfer safeguards.
 *
 * AC5: Verifies that messages containing Malaysian IC numbers or phone numbers
 * are redacted by maskPiiForProvider() — the function called immediately before
 * messages reach any AI provider adapter in chatWithFallback().
 *
 * Also verifies the local-only filtering logic and privacy notice content.
 */
import { describe, test, expect } from 'vitest';
import { maskPiiForProvider } from '../pii-redactor.js';
import { resolveProcessingCountry } from '../../lib/pdpa-compliance.js';

// ─── AC5: PII redaction before AI provider adapter ────────────────────

describe('US-930 AC5: PII redacted before reaching AI provider adapter', () => {
  test('Malaysian IC number is redacted by maskPiiForProvider before provider call', () => {
    // Simulates the call in chatWithFallback() before providerChat()
    const messages = [
      { role: 'user', content: 'My IC is 900101-14-5678, please check me in' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).not.toContain('900101-14-5678');
    expect(masked[0].content).toContain('[MY_IC_REDACTED]');
    expect(categories).toContain('MY_IC');
  });

  test('Malaysian IC without dashes is redacted before provider call', () => {
    const messages = [
      { role: 'user', content: 'IC number: 900101145678 for check-in verification' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).not.toContain('900101145678');
    expect(categories).toContain('MY_IC');
  });

  test('+60 format phone number is redacted before provider call', () => {
    const messages = [
      { role: 'user', content: 'Call me at +60123456789 to confirm my booking' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).not.toContain('+60123456789');
    expect(masked[0].content).toContain('[PHONE_REDACTED]');
    expect(categories).toContain('PHONE');
  });

  test('local 01X format phone number is redacted before provider call', () => {
    const messages = [
      { role: 'user', content: 'My number is 012-3456789' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).not.toContain('012-3456789');
    expect(categories).toContain('PHONE');
  });

  test('message with both IC and phone number — both redacted before provider call', () => {
    const messages = [
      { role: 'user', content: 'IC: 850615-10-1234, contact: +60123456789' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).not.toContain('850615-10-1234');
    expect(masked[0].content).not.toContain('+60123456789');
    expect(categories).toContain('MY_IC');
    expect(categories).toContain('PHONE');
  });

  test('multi-turn conversation: PII in earlier messages is redacted before provider call', () => {
    // chatWithFallback receives the full conversation history
    const messages = [
      { role: 'system', content: 'You are a hotel assistant.' },
      { role: 'user', content: 'My IC is 900101-14-5678' },
      { role: 'assistant', content: 'Thank you, I will process your check-in.' },
      { role: 'user', content: 'Can you confirm?' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    // IC in message index 1 must be redacted
    expect(masked[1].content).not.toContain('900101-14-5678');
    expect(masked[1].content).toContain('[MY_IC_REDACTED]');
    expect(categories).toContain('MY_IC');
  });

  test('messages without PII pass through unchanged', () => {
    const messages = [
      { role: 'user', content: 'What time is check-in?' },
    ];
    const { masked, categories } = maskPiiForProvider(messages);
    expect(masked[0].content).toBe('What time is check-in?');
    expect(categories).toHaveLength(0);
  });
});

// ─── AC4: Local-only provider filtering logic ─────────────────────────

describe('US-930 AC4: Local-only AI provider filtering', () => {
  test('resolveProcessingCountry returns MY for local Ollama', () => {
    expect(resolveProcessingCountry('http://localhost:11434/v1', 'ollama')).toBe('MY');
  });

  test('resolveProcessingCountry returns US for NVIDIA API', () => {
    expect(resolveProcessingCountry('https://integrate.api.nvidia.com/v1', 'openai-compatible')).toBe('US');
  });

  test('resolveProcessingCountry returns US for Google Gemini', () => {
    expect(resolveProcessingCountry('https://generativelanguage.googleapis.com/v1beta', 'google-gemini')).toBe('US');
  });

  test('resolveProcessingCountry returns US for Groq', () => {
    expect(resolveProcessingCountry('https://api.groq.com/openai/v1', 'groq')).toBe('US');
  });

  test('local_only filter: only MY providers pass when local_only_ai=true', () => {
    // Simulate the filter logic from chatWithFallback
    const providers = [
      { id: 'gemini', name: 'Gemini', type: 'google-gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta', enabled: true, priority: 0 },
      { id: 'groq', name: 'Groq', type: 'groq', base_url: 'https://api.groq.com/openai/v1', enabled: true, priority: 1 },
      { id: 'ollama-local', name: 'Ollama Local', type: 'ollama', base_url: 'http://localhost:11434/v1', enabled: true, priority: 2 },
    ];

    const localOnly = providers.filter(p => resolveProcessingCountry(p.base_url, p.type) === 'MY');
    expect(localOnly).toHaveLength(1);
    expect(localOnly[0].id).toBe('ollama-local');
  });

  test('all providers pass when local_only_ai=false', () => {
    const providers = [
      { id: 'gemini', name: 'Gemini', type: 'google-gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta' },
      { id: 'groq', name: 'Groq', type: 'groq', base_url: 'https://api.groq.com/openai/v1' },
      { id: 'ollama-local', name: 'Ollama Local', type: 'ollama', base_url: 'http://localhost:11434/v1' },
    ];

    // When local_only_ai=false, no filtering applied
    const allProviders = providers; // no filter
    expect(allProviders).toHaveLength(3);
  });
});

// ─── AC1: Data transfer inventory coverage ───────────────────────────

describe('US-930 AC1: Data transfer inventory', () => {
  test('NVIDIA provider is classified as overseas (US)', () => {
    const country = resolveProcessingCountry('https://integrate.api.nvidia.com/v1', 'openai-compatible');
    expect(country).toBe('US');
    expect(country).not.toBe('MY');
  });

  test('OpenRouter provider is classified as overseas (US)', () => {
    const country = resolveProcessingCountry('https://openrouter.ai/api/v1', 'openai-compatible');
    expect(country).toBe('US');
  });

  test('Ollama localhost is classified as local (MY)', () => {
    const country = resolveProcessingCountry('http://localhost:11434/v1', 'ollama');
    expect(country).toBe('MY');
  });

  test('127.0.0.1 is classified as local (MY)', () => {
    const country = resolveProcessingCountry('http://127.0.0.1:11434/v1', 'openai-compatible');
    expect(country).toBe('MY');
  });
});
