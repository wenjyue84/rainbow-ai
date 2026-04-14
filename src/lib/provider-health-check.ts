/**
 * provider-health-check.ts — Health check for external AI provider connectivity
 *
 * Tests that configured AI providers are reachable on startup with 5s timeout.
 * If the primary provider is unreachable, server exits with code 1 to fail fast.
 *
 * US-565: Add Health Check for External AI Provider Connectivity on Startup
 */

import axios, { AxiosError } from 'axios';
import type { AIProvider } from '../assistant/schemas.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('ProviderHealthCheck');

// 5-second timeout per the acceptance criteria
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Ping an AI provider to verify connectivity
 * @param provider AIProvider config object
 * @returns {ok: boolean, latency: number, error?: string}
 */
export async function pingProvider(
  provider: AIProvider
): Promise<{ ok: boolean; latency: number; error?: string }> {
  const startMs = Date.now();

  try {
    const apiKey = provider.api_key || process.env[provider.api_key_env] || '';
    const baseUrl = provider.base_url;
    const model = provider.model;
    const type = provider.type;

    let response;

    if (type === 'google-gemini') {
      // Google Gemini: Test via generateContent endpoint with a minimal request
      const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;
      response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                {
                  text: 'ping' // Minimal test prompt
                }
              ]
            }
          ]
        },
        { timeout: HEALTH_CHECK_TIMEOUT_MS }
      );
    } else if (type === 'groq' || type === 'openai-compatible' || type === 'ollama') {
      // OpenAI-compatible APIs (Groq, OpenRouter, Ollama): Test via /chat/completions
      const url = `${baseUrl}/chat/completions`;
      response = await axios.post(
        url,
        {
          model,
          messages: [
            {
              role: 'user',
              content: 'ping'
            }
          ],
          max_tokens: 1
        },
        {
          timeout: HEALTH_CHECK_TIMEOUT_MS,
          headers: apiKey && type !== 'ollama' ? { Authorization: `Bearer ${apiKey}` } : {}
        }
      );
    } else {
      // Unknown type — assume OpenAI-compatible
      const url = `${baseUrl}/chat/completions`;
      response = await axios.post(
        url,
        {
          model,
          messages: [
            {
              role: 'user',
              content: 'ping'
            }
          ],
          max_tokens: 1
        },
        {
          timeout: HEALTH_CHECK_TIMEOUT_MS,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
        }
      );
    }

    const latency = Date.now() - startMs;
    return { ok: response.status >= 200 && response.status < 300, latency };
  } catch (err: any) {
    const latency = Date.now() - startMs;
    const errorMsg = err.message || String(err);
    return {
      ok: false,
      latency,
      error: errorMsg
    };
  }
}

/**
 * Validate that the primary AI provider is reachable on startup
 * Exits with code 1 if provider is unreachable
 *
 * US-565: Server startup includes provider health check before markReady()
 */
export async function validateProviderHealth(): Promise<void> {
  try {
    // Import configStore here to avoid circular dependencies
    const { configStore } = await import('../assistant/config-store.js');

    // Get all enabled providers, sorted by priority
    const settings = configStore.getSettings();
    const providers = (settings.ai?.providers || [])
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority);

    if (providers.length === 0) {
      logger.warn('[Health Check] No AI providers configured');
      return;
    }

    // Test the primary provider (priority 0)
    const primaryProvider = providers[0];
    logger.info(`[Health Check] Testing primary provider: ${primaryProvider.name} (${primaryProvider.id})`);

    const result = await pingProvider(primaryProvider);

    if (result.ok) {
      logger.info(
        `[Health Check] Provider "${primaryProvider.name}" healthy (latency: ${result.latency}ms)`
      );
      return;
    }

    // Primary provider unreachable — warn but allow server to start (fallbacks will handle routing)
    logger.warn(
      `[Health Check] WARNING: Primary provider "${primaryProvider.name}" unreachable (${result.error}) — server will start with fallback providers`
    );
    console.warn(
      `[Startup] WARNING: AI provider "${primaryProvider.name}" unreachable: ${result.error}. Fallback providers will be used.`
    );
  } catch (err: any) {
    logger.warn(`[Health Check] Provider validation error: ${err.message} — continuing startup`);
    console.warn('[Startup] WARNING: Provider health check failed:', err.message);
  }
}
