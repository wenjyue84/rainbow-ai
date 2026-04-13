/**
 * Tests for provider-health-check.ts
 * US-565: Health check for external AI provider connectivity on startup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pingProvider } from '../../src/lib/provider-health-check.js';
import type { AIProvider } from '../../src/assistant/schemas.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');
const mockedAxios = axios as any;

describe('pingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully ping a Google Gemini provider', async () => {
    const provider: AIProvider = {
      id: 'google-gemini-flash',
      name: 'Google Gemini 2.5 Flash',
      description: 'Test',
      type: 'google-gemini',
      api_key_env: 'GEMINI_API_KEY_PELANGI',
      api_key: 'test-key',
      base_url: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      enabled: true,
      priority: 0,
      available: true
    };

    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

    const result = await pingProvider(provider);

    expect(result.ok).toBe(true);
    expect(result.latency).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/models/gemini-2.5-flash:generateContent'),
      expect.any(Object),
      expect.objectContaining({ timeout: 5000 })
    );
  });

  it('should successfully ping a Groq provider', async () => {
    const provider: AIProvider = {
      id: 'groq-llama',
      name: 'Groq Llama 3.3 70B',
      description: 'Test',
      type: 'groq',
      api_key_env: 'GROQ_API_KEY_PELANGI',
      api_key: 'test-key',
      base_url: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      enabled: true,
      priority: 0,
      available: true
    };

    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

    const result = await pingProvider(provider);

    expect(result.ok).toBe(true);
    expect(result.latency).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({
        model: 'llama-3.3-70b-versatile',
        messages: expect.any(Array),
        max_tokens: 1
      }),
      expect.objectContaining({ timeout: 5000 })
    );
  });

  it('should successfully ping an Ollama provider', async () => {
    const provider: AIProvider = {
      id: 'ollama-gemini-flash',
      name: 'Ollama Gemini 3 Flash',
      description: 'Test',
      type: 'ollama',
      api_key_env: '',
      base_url: 'http://localhost:11434/v1',
      model: 'gemini-3-flash-preview:cloud',
      enabled: true,
      priority: 1,
      available: true
    };

    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

    const result = await pingProvider(provider);

    expect(result.ok).toBe(true);
    expect(result.latency).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.any(Object),
      expect.objectContaining({ timeout: 5000 })
    );
  });

  it('should return error when provider is unreachable (timeout)', async () => {
    const provider: AIProvider = {
      id: 'groq-llama',
      name: 'Groq Llama 3.3 70B',
      description: 'Test',
      type: 'groq',
      api_key_env: 'GROQ_API_KEY_PELANGI',
      api_key: 'test-key',
      base_url: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      enabled: true,
      priority: 0,
      available: true
    };

    const timeoutError = new Error('Request timed out');
    mockedAxios.post.mockRejectedValueOnce(timeoutError);

    const result = await pingProvider(provider);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Request timed out');
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  it('should return error when provider returns 401 (auth error)', async () => {
    const provider: AIProvider = {
      id: 'groq-llama',
      name: 'Groq Llama 3.3 70B',
      description: 'Test',
      type: 'groq',
      api_key_env: 'GROQ_API_KEY_PELANGI',
      api_key: 'invalid-key',
      base_url: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      enabled: true,
      priority: 0,
      available: true
    };

    const authError = new Error('Unauthorized');
    mockedAxios.post.mockRejectedValueOnce(authError);

    const result = await pingProvider(provider);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unauthorized');
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  it('should respect 5-second timeout', async () => {
    const provider: AIProvider = {
      id: 'groq-llama',
      name: 'Groq Llama 3.3 70B',
      description: 'Test',
      type: 'groq',
      api_key_env: 'GROQ_API_KEY_PELANGI',
      api_key: 'test-key',
      base_url: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      enabled: true,
      priority: 0,
      available: true
    };

    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

    await pingProvider(provider);

    // Verify that the timeout was set to 5000ms
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ timeout: 5000 })
    );
  });

  it('should handle OpenAI-compatible providers', async () => {
    const provider: AIProvider = {
      id: 'openrouter-qwen',
      name: 'Qwen 2.5 32B (Free)',
      description: 'Test',
      type: 'openai-compatible',
      api_key_env: 'OPENROUTER_API_KEY',
      api_key: 'test-key',
      base_url: 'https://openrouter.ai/api/v1',
      model: 'qwen/qwen-2.5-32b-instruct',
      enabled: false,
      priority: 11,
      available: true
    };

    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

    const result = await pingProvider(provider);

    expect(result.ok).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.any(Object),
      expect.any(Object)
    );
  });
});
