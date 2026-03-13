/**
 * Prompt Caching Tests (US-440)
 *
 * Verifies that cache_control breakpoints are injected for Anthropic providers
 * (via OpenRouter or direct) and that Groq/Ollama receive messages unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supportsPromptCaching, injectCacheControl } from '../ai-provider-manager.js';
import type { AIProvider } from '../schemas.js';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    type: 'openai-compatible',
    api_key_env: 'TEST_API_KEY',
    base_url: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3-haiku',
    enabled: true,
    priority: 0,
    ...overrides,
  };
}

describe('supportsPromptCaching', () => {
  it('returns true for Anthropic model via OpenRouter (anthropic/ prefix)', () => {
    const p = makeProvider({ base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3-haiku' });
    expect(supportsPromptCaching(p)).toBe(true);
  });

  it('returns true for claude- model via OpenRouter', () => {
    const p = makeProvider({ base_url: 'https://openrouter.ai/api/v1', model: 'claude-3-5-sonnet-20241022' });
    expect(supportsPromptCaching(p)).toBe(true);
  });

  it('returns true for direct Anthropic API', () => {
    const p = makeProvider({ base_url: 'https://api.anthropic.com/v1', model: 'claude-3-haiku-20240307' });
    expect(supportsPromptCaching(p)).toBe(true);
  });

  it('returns false for non-Anthropic model via OpenRouter', () => {
    const p = makeProvider({ base_url: 'https://openrouter.ai/api/v1', model: 'mistralai/mistral-7b-instruct' });
    expect(supportsPromptCaching(p)).toBe(false);
  });

  it('returns false for Groq provider', () => {
    const p = makeProvider({ type: 'groq', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' });
    expect(supportsPromptCaching(p)).toBe(false);
  });

  it('returns false for Ollama provider', () => {
    const p = makeProvider({ type: 'ollama', base_url: 'http://localhost:11434/v1', model: 'llama3.1:8b' });
    expect(supportsPromptCaching(p)).toBe(false);
  });
});

describe('injectCacheControl', () => {
  const messages = [
    { role: 'system', content: 'You are a helpful hostel assistant.' },
    { role: 'user', content: 'What time is check-in?' },
    { role: 'assistant', content: 'Check-in is at 2 PM.' },
    { role: 'user', content: 'Thanks!' },
  ];

  it('wraps system message content in array with cache_control', () => {
    const result = injectCacheControl(messages);
    const sys = result[0];
    expect(Array.isArray(sys.content)).toBe(true);
    const block = (sys.content as any[])[0];
    expect(block.type).toBe('text');
    expect(block.text).toBe('You are a helpful hostel assistant.');
    expect(block.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('leaves non-system messages content unchanged (string)', () => {
    const result = injectCacheControl(messages);
    expect(result[1].content).toBe('What time is check-in?');
    expect(result[2].content).toBe('Check-in is at 2 PM.');
    expect(result[3].content).toBe('Thanks!');
  });

  it('does not mutate the original messages array', () => {
    const original = messages.map(m => ({ ...m }));
    injectCacheControl(messages);
    expect(messages[0].content).toBe(original[0].content);
  });

  it('handles empty messages array', () => {
    expect(injectCacheControl([])).toEqual([]);
  });

  it('handles messages with no system role', () => {
    const noSystem = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = injectCacheControl(noSystem);
    expect(result[0].content).toBe('Hello');
    expect(result[1].content).toBe('Hi there');
  });
});
