/**
 * ai-provider-manager.ts — Provider lifecycle + execution infrastructure
 * (Single Responsibility: manage AI provider connections and execute requests)
 */
import Groq from 'groq-sdk';
import axios from 'axios';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type { AIProvider } from './config-store.js';
import { configStore } from './config-store.js';
import { circuitBreakerRegistry } from './circuit-breaker.js';
import { rateLimitManager } from './rate-limit-manager.js';
import { notifyAdminRateLimit } from '../lib/admin-notifier.js';
import { isProviderOverBudget, recordLLMUsage } from './llm-cost-budget.js';
import { logDataFlow } from '../lib/ai-data-flow-log.js';
import { checkContextWindowUsage } from './context-window-monitor.js';
import { latencySLOTracker } from './latency-slo-tracker.js';

// ─── OpenTelemetry GenAI Tracing ────────────────────────────────────
const tracer = trace.getTracer('rainbow-ai.gen_ai', '1.0.0');

/** Whether to capture prompt/completion content in spans (opt-in for privacy) */
function shouldCaptureContent(): boolean {
  return process.env.OTEL_GENAI_CAPTURE_CONTENT === 'true';
}

// ─── Provider Configuration ──────────────────────────────────────────

export function getAISettings() {
  return configStore.getSettings().ai;
}

/** Get enabled providers sorted by priority (lowest first = highest priority).
 *  US-996: Demoted providers (P95 > SLO threshold) are pushed below all healthy providers. */
export function getProviders(): AIProvider[] {
  const ai = getAISettings();
  const providers = ai.providers || [];
  const enabled = providers.filter(p => p.enabled).sort((a, b) => a.priority - b.priority);

  // Separate healthy vs demoted providers
  const healthy: AIProvider[] = [];
  const demoted: AIProvider[] = [];
  for (const p of enabled) {
    if (latencySLOTracker.isDemoted(p.id)) {
      demoted.push(p);
    } else {
      healthy.push(p);
    }
  }

  // Healthy providers first (in their configured priority), then demoted
  return [...healthy, ...demoted];
}

/** Resolve API key for a provider: direct value > env var > null. Trims whitespace to avoid 401s. */
export function resolveApiKey(provider: AIProvider): string | null {
  let key: string | undefined;
  if (provider.api_key) key = provider.api_key;
  else if (provider.api_key_env) key = process.env[provider.api_key_env];
  else if (provider.type === 'ollama') return 'ollama'; // Ollama doesn't need a key
  else return null;
  const trimmed = typeof key === 'string' ? key.trim() : '';
  return trimmed || null;
}

// ─── Groq SDK Instance Cache ─────────────────────────────────────────

let groqInstances = new Map<string, Groq>();

export function getGroqInstance(providerId: string): Groq | undefined {
  return groqInstances.get(providerId);
}

export function initAIClient(): void {
  const providers = getProviders();
  if (providers.length === 0) {
    console.warn('[AI] No AI providers configured');
    return;
  }

  for (const p of providers) {
    const key = resolveApiKey(p);
    if (p.type === 'groq' && key) {
      groqInstances.set(p.id, new Groq({ apiKey: key }));
    }
    const status = key ? 'ready' : 'no key';
    console.log(`[AI] Provider "${p.name}" (priority ${p.priority}) — ${status}`);
  }

  configStore.on('reload', (domain: string) => {
    if (domain === 'settings' || domain === 'all') {
      groqInstances.clear();
      for (const p of getProviders()) {
        const key = resolveApiKey(p);
        if (p.type === 'groq' && key) {
          groqInstances.set(p.id, new Groq({ apiKey: key }));
        }
      }
      console.log('[AI] Settings reloaded — providers refreshed');
    }
  });
}

export function isAIAvailable(): boolean {
  return getProviders().some(p => resolveApiKey(p) !== null);
}

// ─── Prompt Caching ──────────────────────────────────────────────────

/**
 * Returns true if the provider supports Anthropic-style prompt caching.
 * Caching is supported by: Anthropic models via OpenRouter, direct Anthropic API.
 * Groq and Ollama do NOT support caching.
 */
export function supportsPromptCaching(provider: AIProvider): boolean {
  const url = provider.base_url ?? '';
  if (url.includes('openrouter.ai') &&
      (provider.model.startsWith('anthropic/') || provider.model.startsWith('claude-'))) {
    return true;
  }
  if (url.includes('api.anthropic.com')) {
    return true;
  }
  return false;
}

/**
 * Inject cache_control breakpoints into system messages for Anthropic prompt caching.
 * System prompts are long, static, and prepended to every request — ideal cache candidates.
 * Returns a new messages array; non-system messages are unchanged.
 */
export function injectCacheControl(
  messages: Array<{ role: string; content: string }>
): Array<{ role: string; content: string | Array<{ type: string; text: string; cache_control?: { type: string } }> }> {
  return messages.map(msg => {
    if (msg.role === 'system' && typeof msg.content === 'string') {
      return {
        ...msg,
        content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
      };
    }
    return msg;
  });
}

// ─── Response Validation ─────────────────────────────────────────────

/** Log Anthropic cache usage and compute effective token cost */
function logCacheMetrics(usage: any, providerName: string): void {
  const writes = usage?.cache_creation_input_tokens ?? 0;
  const reads = usage?.cache_read_input_tokens ?? 0;
  if (writes > 0 || reads > 0) {
    const normalInput = usage?.prompt_tokens ?? 0;
    // Cached reads are priced at 10% of normal input cost
    const effectiveCost = (normalInput - reads) + reads * 0.1;
    console.log(
      `[AI] Cache metrics [${providerName}] — write: ${writes} tokens, read: ${reads} tokens` +
      ` (effective input cost: ~${effectiveCost.toFixed(0)} token-equivalents)`
    );
  }
}

/** Validate OpenAI-compatible response structure; throws descriptive errors to trigger fallback */
function validateProviderResponse(data: any, providerName: string, startTime: number): { content: string; usage?: any; toolCalls?: any[] } {
  if (!data) {
    throw new Error(`${providerName}: empty response body`);
  }
  if (!Array.isArray(data.choices)) {
    throw new Error(`${providerName}: response missing choices array`);
  }
  if (data.choices.length === 0) {
    throw new Error(`${providerName}: choices array is empty`);
  }
  const message = data.choices[0]?.message;
  if (!message || typeof message !== 'object') {
    throw new Error(`${providerName}: choices[0] missing message object`);
  }
  // Tool calls: content may be null when LLM wants to call tools
  if (message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const elapsed = Date.now() - startTime;
    console.log(`[AI] ✓ ${providerName} responded with ${message.tool_calls.length} tool call(s) (${elapsed}ms)`);
    if (data.usage) logCacheMetrics(data.usage, providerName);
    return { content: message.content || '', usage: data.usage, toolCalls: message.tool_calls };
  }
  if (typeof message.content !== 'string') {
    throw new Error(`${providerName}: message.content is not a string (got ${typeof message.content})`);
  }
  const trimmed = message.content.trim();
  if (!trimmed) {
    throw new Error(`${providerName}: message.content is empty after trim`);
  }
  const elapsed = Date.now() - startTime;
  console.log(`[AI] ✓ ${providerName} responded (${elapsed}ms, ${trimmed.length} chars)`);
  if (data.usage) logCacheMetrics(data.usage, providerName);
  return { content: trimmed, usage: data.usage };
}

/** Validate Google Gemini response structure; throws descriptive errors to trigger fallback */
function validateGeminiResponse(data: any, providerName: string, startTime: number): { content: string; usage?: any } {
  if (!data) {
    throw new Error(`${providerName}: empty response body`);
  }
  if (!Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new Error(`${providerName}: response missing candidates array`);
  }
  const parts = data.candidates[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error(`${providerName}: candidates[0] missing content.parts`);
  }
  const text = parts[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`${providerName}: parts[0].text is not a string (got ${typeof text})`);
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`${providerName}: parts[0].text is empty after trim`);
  }
  const elapsed = Date.now() - startTime;
  console.log(`[AI] ✓ ${providerName} responded (${elapsed}ms, ${trimmed.length} chars)`);

  // Extract Gemini usage metadata (different format from OpenAI)
  const usage = data.usageMetadata ? {
    prompt_tokens: data.usageMetadata.promptTokenCount,
    completion_tokens: data.usageMetadata.candidatesTokenCount,
    total_tokens: data.usageMetadata.totalTokenCount
  } : undefined;

  return { content: trimmed, usage };
}

// ─── Timeout Constants ───────────────────────────────────────────────

export const DEFAULT_TIMEOUT_MS = 6000;

// ─── Timeout Wrapper ─────────────────────────────────────────────────

export class TimeoutError extends Error {
  readonly elapsedMs: number;
  readonly timeoutMs: number;
  constructor(provider: string, timeoutMs: number, elapsedMs: number) {
    super(`${provider} request timeout after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.elapsedMs = elapsedMs;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, providerName: string, startTime: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new TimeoutError(providerName, timeoutMs, Date.now() - startTime)), timeoutMs)
    )
  ]);
}

// ─── Generic Provider Chat Call ──────────────────────────────────────

export async function providerChat(
  provider: AIProvider,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  jsonMode: boolean = false,
  tools?: any[],
  jsonSchema?: { name: string; schema: Record<string, unknown> }
): Promise<{ content: string; usage?: any; toolCalls?: any[] } | null> {
  // Resolve provider type name for OTel attributes
  const providerTypeName = provider.type === 'google-gemini' ? 'google'
    : provider.type === 'groq' ? 'groq'
    : provider.type === 'ollama' ? 'ollama'
    : 'openai';

  const spanName = `chat ${provider.model}`;

  return tracer.startActiveSpan(spanName, { kind: SpanKind.CLIENT }, async (span) => {
    const startTime = Date.now();
    const timeoutMs = provider.timeout_ms ?? DEFAULT_TIMEOUT_MS;

    // Set GenAI semantic convention attributes on span
    span.setAttribute('gen_ai.operation.name', 'chat');
    span.setAttribute('gen_ai.system', providerTypeName);
    span.setAttribute('gen_ai.request.model', provider.model);
    span.setAttribute('gen_ai.request.max_tokens', maxTokens);
    span.setAttribute('gen_ai.request.temperature', temperature);

    // Opt-in content capture
    if (shouldCaptureContent()) {
      const systemMsg = messages.find(m => m.role === 'system');
      if (systemMsg) {
        span.setAttribute('gen_ai.prompt.0.role', 'system');
        span.setAttribute('gen_ai.prompt.0.content', systemMsg.content.slice(0, 4096));
      }
    }

    try {
      const apiKey = resolveApiKey(provider);
      if (!apiKey && provider.type !== 'ollama') {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'No API key' });
        span.end();
        return null;
      }

      let result: { content: string; usage?: any; toolCalls?: any[] } | null = null;

      if (provider.type === 'groq') {
        const groq = groqInstances.get(provider.id);
        if (!groq) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'No Groq instance' });
          span.end();
          return null;
        }
        const body: any = {
          model: provider.model,
          messages,
          max_tokens: maxTokens,
          temperature
        };
        if (jsonSchema) {
          body.response_format = { type: 'json_schema', json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema } };
        } else if (jsonMode) {
          body.response_format = { type: 'json_object' };
        }
        if (tools && tools.length > 0) { body.tools = tools; body.tool_choice = 'auto'; }

        const response = await withTimeout(
          groq.chat.completions.create(body),
          timeoutMs,
          provider.name,
          startTime
        );
        result = validateProviderResponse(response, provider.name, startTime);

      } else if (provider.type === 'google-gemini') {
        // Convert OpenAI-style messages to Gemini format, separating system instruction
        const systemMsg = messages.find(m => m.role === 'system');
        const nonSystemMessages = messages.filter(m => m.role !== 'system');
        const contents = nonSystemMessages.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }));

        const generationConfig: Record<string, unknown> = {
          maxOutputTokens: maxTokens,
          temperature
        };

        // Add JSON response format if requested
        if (jsonMode || jsonSchema) {
          generationConfig.responseMimeType = 'application/json';
          // Disable thinking mode for JSON calls — Gemini 2.5 Flash thinking tokens
          // interfere with JSON output enforcement (produces plain text instead of JSON)
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
        }

        const body: Record<string, unknown> = { contents, generationConfig };
        if (systemMsg) {
          body.systemInstruction = { parts: [{ text: systemMsg.content }] };
        }

        const url = `${provider.base_url}/models/${provider.model}:generateContent?key=${apiKey}`;
        const axiosPromise = axios.post(url, body, {
          headers: { 'Content-Type': 'application/json' },
          timeout: timeoutMs + 1000,
          validateStatus: () => true
        });
        const res = await withTimeout(axiosPromise, timeoutMs, provider.name, startTime);

        if (res.status !== 200) {
          const errText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          if (res.status === 429) {
            console.error(`[AI] ⚠️  RATE LIMIT HIT - ${provider.name}`);
          }
          throw new Error(`${provider.name} ${res.status}: ${errText.slice(0, 200)}`);
        }

        result = validateGeminiResponse(res.data, provider.name, startTime);

      } else {
        // openai-compatible & ollama both use axios
        const effectiveMessages = supportsPromptCaching(provider) ? injectCacheControl(messages) : messages;
        const body: any = {
          model: provider.model,
          messages: effectiveMessages,
          max_tokens: maxTokens,
          temperature
        };
        if (jsonSchema) {
          body.response_format = { type: 'json_schema', json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema } };
        } else if (jsonMode) {
          body.response_format = { type: 'json_object' };
        }
        if (tools && tools.length > 0) { body.tools = tools; body.tool_choice = 'auto'; }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey && provider.type !== 'ollama') {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        if (provider.base_url?.includes('openrouter.ai')) {
          headers['Referer'] = process.env.OPENROUTER_REFERER || 'https://pelangi-unit.local';
          headers['X-Title'] = process.env.OPENROUTER_APP_TITLE || 'Rainbow AI digiman';
        }

        const axiosPromise = axios.post(`${provider.base_url}/chat/completions`, body, {
          headers,
          timeout: timeoutMs + 1000,
          validateStatus: () => true
        });
        const res = await withTimeout(axiosPromise, timeoutMs, provider.name, startTime);

        if (res.status !== 200) {
          const errText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

          if (res.status === 401 && provider.base_url?.includes('openrouter.ai')) {
            const hint = 'Get a valid key at https://openrouter.ai/keys and set OPENROUTER_API_KEY in .env, then restart.';
            throw new Error(`${provider.name} 401 (invalid API key). ${hint}`);
          }

          if (res.status === 429) {
            console.error(`[AI] ⚠️  RATE LIMIT HIT - ${provider.name}`);
            console.error(`[AI] Provider: ${provider.id} (${provider.type})`);
            console.error(`[AI] Status: ${res.status} - Rate limit exceeded`);
            console.error(`[AI] Details: ${errText.slice(0, 500)}`);
            console.error(`[AI] 💡 Tip: Disable this provider or wait for limit reset (usually 24h)`);
          }

          throw new Error(`${provider.name} ${res.status}: ${errText.slice(0, 200)}`);
        }

        result = validateProviderResponse(res.data, provider.name, startTime);
      }

      // Record GenAI response attributes on span
      if (result) {
        span.setAttribute('gen_ai.response.model', provider.model);
        if (result.usage) {
          if (result.usage.prompt_tokens != null) {
            span.setAttribute('gen_ai.usage.input_tokens', result.usage.prompt_tokens);
          }
          if (result.usage.completion_tokens != null) {
            span.setAttribute('gen_ai.usage.output_tokens', result.usage.completion_tokens);
          }
        }
        span.setAttribute('gen_ai.response.finish_reasons', ['stop']);

        if (shouldCaptureContent() && result.content) {
          span.setAttribute('gen_ai.completion.0.role', 'assistant');
          span.setAttribute('gen_ai.completion.0.content', result.content.slice(0, 4096));
        }

        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
      return result;

    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.recordException(err);
      span.end();
      throw err;
    }
  });
}

// ─── Fallback Chain ──────────────────────────────────────────────────

/** Try all providers in priority order, return first success */
export async function chatWithFallback(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  jsonMode: boolean = false,
  providerIds?: string[],
  tools?: any[],
  jsonSchema?: { name: string; schema: Record<string, unknown> }
): Promise<{ content: string | null; provider: AIProvider | null; usage?: any; toolCalls?: any[] }> {
  // Parent span links the full fallback chain as a single trace
  return tracer.startActiveSpan('gen_ai.chat_with_fallback', { kind: SpanKind.INTERNAL }, async (parentSpan) => {
  let providers = getProviders();

  if (providerIds && providerIds.length > 0) {
    const idOrder = new Map(providerIds.map((id, i) => [id, i]));
    providers = providers
      .filter(p => idOrder.has(p.id))
      .sort((a, b) => (idOrder.get(a.id)!) - (idOrder.get(b.id)!));
  }

  parentSpan.setAttribute('gen_ai.fallback.provider_count', providers.length);
  let timeoutCount = 0;

  for (const provider of providers) {
    const breaker = circuitBreakerRegistry.getOrCreate(provider.id);
    if (breaker.isOpen()) {
      const status = breaker.getStatus();
      const cooldownSec = Math.ceil(status.cooldownRemaining / 1000);
      console.log(`[AI] ⚡ Circuit breaker OPEN for ${provider.name}, skipping (cooldown: ${cooldownSec}s)`);
      continue;
    }

    // Check rate limit cooldown
    if (rateLimitManager.isInCooldown(provider.id)) {
      const cooldownMs = rateLimitManager.getCooldownRemaining(provider.id);
      const cooldownSec = (cooldownMs / 1000).toFixed(1);
      console.log(`[AI] ⏱️  Rate limit cooldown active for ${provider.name}, skipping (${cooldownSec}s remaining)`);
      continue;
    }

    // Check daily cost budget (US-433)
    if (isProviderOverBudget(provider.id)) {
      console.log(`[AI] 💰 Budget cap reached for ${provider.name}, skipping to next provider`);
      continue;
    }

    const callStartTime = Date.now();
    try {
      const result = await providerChat(provider, messages, maxTokens, temperature, jsonMode, tools, jsonSchema);
      if (result && (result.content || result.toolCalls?.length)) {
        breaker.recordSuccess();
        rateLimitManager.recordSuccess(provider.id);
        // US-996: Record latency for SLO tracking & automatic demotion
        latencySLOTracker.recordLatency(provider.id, Date.now() - callStartTime);
        // Record token usage for cost tracking (US-433)
        recordLLMUsage(provider.id, provider.model, result.usage);
        // US-978: Log total token count and alert when approaching 80% of context window
        checkContextWindowUsage(provider.id, provider.model, result.usage);
        // Log cross-border data flow for PDPA compliance (US-915)
        logDataFlow({
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.type,
          model: provider.model,
          baseUrl: provider.base_url ?? '',
          messages,
          usage: result.usage,
        }).catch(() => {});
        console.log(`[AI] ✅ Success using: ${provider.name} (${provider.id})`);
        parentSpan.setAttribute('gen_ai.fallback.result', 'success');
        parentSpan.setAttribute('gen_ai.fallback.winning_provider', provider.id);
        parentSpan.setStatus({ code: SpanStatusCode.OK });
        parentSpan.end();
        return { content: result.content, provider, usage: result.usage, toolCalls: result.toolCalls };
      }
    } catch (err: any) {
      breaker.recordFailure();

      // Handle latency threshold timeout
      if (err instanceof TimeoutError) {
        timeoutCount++;
        console.warn(`[AI] ⏱️  Latency failover:`, JSON.stringify({
          provider: provider.id,
          timeout_ms: err.timeoutMs,
          elapsed_ms: err.elapsedMs,
          action: 'failover'
        }));
        continue;
      }

      const isRateLimit = err.message?.includes('429') || err.message?.toLowerCase().includes('rate limit');
      if (isRateLimit) {
        rateLimitManager.recordRateLimit(provider.id);
        console.warn(`[AI] ⚠️  ${provider.name} RATE LIMITED — falling back to next provider`);

        // Check if we should notify admin
        if (rateLimitManager.shouldNotifyAdmin(provider.id)) {
          const state = rateLimitManager.getState(provider.id);
          if (state) {
            notifyAdminRateLimit(provider.id, provider.name, state.errorCount, state.totalErrors).catch(notifyErr => {
              console.warn(`[AI] Failed to send rate limit notification:`, notifyErr.message);
            });
          }
        }
      } else {
        console.warn(`[AI] ${provider.name} failed, trying next:`, err.message);
      }
    }
  }

  // If all providers timed out, return the configurable slow-response apology
  if (timeoutCount > 0 && timeoutCount === providers.length) {
    const ai = getAISettings();
    const apology = ai.slow_response_message
      || "I'm sorry, all my AI systems are running slowly right now. Please try again in a moment, or contact our staff for immediate help.";
    console.error(`[AI] ❌ All ${timeoutCount} providers timed out — returning slow-response apology`);
    parentSpan.setAttribute('gen_ai.fallback.result', 'all_timed_out');
    parentSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'All providers timed out' });
    parentSpan.end();
    return { content: apology, provider: null };
  }

  console.error(`[AI] ❌ All providers failed - no response generated`);
  parentSpan.setAttribute('gen_ai.fallback.result', 'all_failed');
  parentSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'All providers failed' });
  parentSpan.end();
  return { content: null, provider: null };
  }); // end tracer.startActiveSpan
}
