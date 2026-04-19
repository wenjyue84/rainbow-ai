/**
 * ai-response-generator.ts — Response generation + parsing
 * (Single Responsibility: generate AI responses for classified intents)
 */
import axios from 'axios';
import type { ChatMessage } from './types.js';
import type { MCPTool, MCPToolResult, ToolHandler } from '../types/mcp.js';
import { configStore, ConfigStore } from './config-store.js';
import { getContextWindows } from './context-windows.js';
import {
  isAIAvailable, getAISettings, getProviders, resolveApiKey,
  getGroqInstance, providerChat, chatWithFallback
} from './ai-provider-manager.js';
import type { SupportedLanguage } from './language-router.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { aiResponseSchema, aiResponseActionSchema, replyOnlyResultSchema, safeParseLLMResponse } from './schemas.js';
import type { AIAction, AIResponse as ZodAIResponse } from './schemas.js';

// ─── Types ──────────────────────────────────────────────────────────

// Re-export from schemas for backward compatibility
export type { AIAction } from './schemas.js';

export interface AIResponse extends ZodAIResponse {
  model?: string;
  responseTime?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

const VALID_ACTIONS = aiResponseActionSchema.options;

// ─── Static fallback messages (trilingual) ────────────────────────
// Used when ALL LLMs fail or for unknown/gibberish input
// Reads from settings.json (unknownFallback) if configured, otherwise uses defaults

const DEFAULT_FALLBACK_MESSAGES = {
  en: "I'm sorry, I didn't quite understand that. Could you rephrase your question? I can help with bookings, check-in/out, amenities, and general hostel information.",
  ms: "Maaf, saya tidak faham mesej anda. Boleh anda tulis semula soalan anda? Saya boleh bantu dengan tempahan, daftar masuk/keluar, kemudahan, dan maklumat am hostel.",
  zh: "抱歉，我没有理解您的意思。您能重新表述一下您的问题吗？我可以帮助您处理预订、入住/退房、设施和旅舍的一般信息。",
  ta: "மன்னிக்கவும், உங்கள் செய்தியை நான் புரிந்துகொள்ளவில்லை. உங்கள் கேள்வியை மீண்டும் எழுதுங்கள். முன்பதிவு, செக்-இன்/செக்-அவுட், வசதிகள் மற்றும் பொது தகவல்கள் குறித்து நான் உதவ முடியும்."
} as const;

export function getUnknownFallbackMessages(store?: ConfigStore): Record<string, string> {
  const settings = (store || configStore).getSettings();
  const custom = (settings as any)?.unknownFallback;
  if (custom && (custom.en || custom.ms || custom.zh || custom.ta)) {
    return {
      en: custom.en || DEFAULT_FALLBACK_MESSAGES.en,
      ms: custom.ms || DEFAULT_FALLBACK_MESSAGES.ms,
      zh: custom.zh || DEFAULT_FALLBACK_MESSAGES.zh,
      ta: custom.ta || DEFAULT_FALLBACK_MESSAGES.ta,
    };
  }
  return { ...DEFAULT_FALLBACK_MESSAGES };
}

export const UNKNOWN_FALLBACK_MESSAGES = DEFAULT_FALLBACK_MESSAGES;

// ─── Context-aware fallback response selection ──────────────────────
// Loads fallback templates from fallback-responses.json and selects based on confidence/history

let cachedFallbackResponses: Record<string, Record<string, string>> | null = null;

/**
 * Load fallback responses from JSON file (cached)
 */
function loadFallbackResponses(): Record<string, Record<string, string>> {
  if (cachedFallbackResponses) {
    return cachedFallbackResponses;
  }

  try {
    // Dynamically import the fallback-responses JSON
    const responses = require('./data/fallback-responses.json');
    cachedFallbackResponses = responses;
    return responses;
  } catch (error) {
    console.warn('[Fallback] Failed to load fallback-responses.json:', error);
    // Fallback to default messages structure
    return {
      first_fallback: { ...DEFAULT_FALLBACK_MESSAGES },
      repeated_fallback: { ...DEFAULT_FALLBACK_MESSAGES },
      escalation_offer: { ...DEFAULT_FALLBACK_MESSAGES }
    };
  }
}

/**
 * Select context-aware fallback response based on confidence score and conversation history.
 *
 * Selection logic:
 * - if confidence < 0.5 and conversationLength < 3: use first_fallback
 * - else if fallbackCount > 1: use escalation_offer
 * - else: use repeated_fallback
 *
 * @param confidence Intent classification confidence score (0-1)
 * @param conversationLength Number of message pairs in the conversation
 * @param fallbackCount Number of fallback responses already given
 * @param language Preferred language ('en', 'ms', 'zh', 'ta')
 * @returns {template, escalationFlag} Selected template and escalation indicator
 */
export function getFallbackResponse(
  confidence: number,
  conversationLength: number,
  fallbackCount: number,
  language: string = 'en'
): { template: string; escalation_flag: boolean } {
  const responses = loadFallbackResponses();
  let selectedContext = 'repeated_fallback';
  let escalationFlag = false;

  // Selection logic based on confidence and conversation state
  if (confidence < 0.5 && conversationLength < 3) {
    // Early in conversation with low confidence: gentle first prompt
    selectedContext = 'first_fallback';
  } else if (fallbackCount > 1) {
    // Multiple fallbacks: offer escalation to staff
    selectedContext = 'escalation_offer';
    escalationFlag = true;
  } else {
    // Normal repeated fallback
    selectedContext = 'repeated_fallback';
  }

  // Get the template for the selected context and language
  const contextTemplates = responses[selectedContext] || responses['repeated_fallback'];
  const template = contextTemplates[language] || contextTemplates['en'] || DEFAULT_FALLBACK_MESSAGES[language] || DEFAULT_FALLBACK_MESSAGES.en;

  return { template, escalation_flag: escalationFlag };
}

// ─── Language-aware system prompt injection ─────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ms: 'Malay (Bahasa Melayu)',
  zh: 'Chinese (Simplified Mandarin)',
  ta: 'Tamil',
};

/**
 * Append a language instruction to the system prompt so the LLM responds
 * in the detected/preferred language. No-op for English or unknown.
 */
function injectLanguageInstruction(systemPrompt: string, lang?: SupportedLanguage): string {
  if (!lang || lang === 'unknown' || lang === 'en') return systemPrompt;
  const name = LANGUAGE_NAMES[lang] || lang;
  return `${systemPrompt}\n\nIMPORTANT: The user is writing in ${name}. You MUST respond entirely in ${name}. Do not switch to English unless the user switches first.`;
}

// ─── Chat (simple prompt → response) ────────────────────────────────

export async function chat(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  if (!isAIAvailable()) {
    throw new Error('AI not available');
  }

  const cw = getContextWindows();
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt }
  ];

  const recentHistory = history.slice(-cw.combined);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  const chatCfg = getAISettings();
  const { content } = await chatWithFallback(messages, chatCfg.max_chat_tokens, chatCfg.chat_temperature);

  if (content) return content;
  throw new Error('AI temporarily unavailable');
}

// ─── Chat with Tools Loop (US-701) ───────────────────────────────────

/**
 * Send a chat message with tools to the LLM, handle tool_calls in response,
 * execute handlers, and loop until a final text response (max 3 loops).
 */
export async function chatWithToolsLoop(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  tools: MCPTool[],
  toolHandlers: Map<string, ToolHandler>,
  profileConfigStore?: ConfigStore,
  detectedLanguage?: SupportedLanguage
): Promise<string> {
  if (!isAIAvailable()) {
    throw new Error('AI not available');
  }

  const cw = getContextWindows();
  const langPrompt = injectLanguageInstruction(systemPrompt, detectedLanguage);
  const messages: any[] = [
    { role: 'system', content: langPrompt }
  ];

  const recentHistory = history.slice(-cw.combined);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  // Convert MCPTool[] to OpenAI function-calling format
  const openAiTools = tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema
    }
  }));

  const chatCfg = getAISettings();
  const MAX_LOOPS = 3;
  let totalToolCalls = 0;
  let errorToolCalls = 0;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const { content, toolCalls } = await chatWithFallback(
      messages as any,
      chatCfg.max_chat_tokens,
      chatCfg.chat_temperature,
      false,
      undefined,
      openAiTools
    );

    // No tool calls — return the text response
    if (!toolCalls || toolCalls.length === 0) {
      if (content && looksLikeJson(content)) {
        try {
          const j = JSON.parse(content);
          const extracted = j.response || j.text || j.message || null;
          if (extracted && typeof extracted === 'string' && !looksLikeJson(extracted)) return extracted;
        } catch {}
        return getUnknownFallbackMessages(profileConfigStore).en;
      }
      return content || getUnknownFallbackMessages(profileConfigStore).en;
    }

    // Append assistant message with tool_calls
    messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

    // Execute each tool call and append results
    for (const call of toolCalls) {
      const fnName = call.function?.name;
      const fnArgs = call.function?.arguments;
      let parsedArgs: any = {};
      try {
        parsedArgs = typeof fnArgs === 'string' ? JSON.parse(fnArgs) : fnArgs || {};
      } catch {
        parsedArgs = {};
      }

      const handler = toolHandlers.get(fnName);
      let result: MCPToolResult;
      if (handler) {
        try {
          result = await handler(parsedArgs);
        } catch (err: any) {
          result = { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
      } else {
        result = { content: [{ type: 'text', text: `Unknown tool: ${fnName}` }], isError: true };
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result.content)
      });

      totalToolCalls++;
      if (result.isError) errorToolCalls++;
      console.log(`[AI] Tool call: ${fnName} → ${result.isError ? 'ERROR' : 'OK'} (loop ${loop + 1}/${MAX_LOOPS})`);
    }
  }

  // All tool calls failed — try one final toolless LLM call before giving up
  if (totalToolCalls > 0 && errorToolCalls === totalToolCalls) {
    console.warn('[AI] chatWithToolsLoop: all tool calls failed, attempting toolless fallback');
    try {
      const nonToolMessages = messages.filter((m: any) =>
        m.role !== 'tool' && !(m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0)
      );
      const { content: finalContent } = await chatWithFallback(
        nonToolMessages,
        chatCfg.max_chat_tokens,
        chatCfg.chat_temperature,
        false,
        undefined,
        undefined
      );
      if (finalContent && looksLikeJson(finalContent)) {
        try {
          const j = JSON.parse(finalContent);
          const extracted = j.response || j.text || j.message || null;
          if (extracted && typeof extracted === 'string' && !looksLikeJson(extracted)) return extracted;
        } catch {}
      } else if (finalContent) {
        return finalContent;
      }
    } catch (err: any) {
      console.warn('[AI] chatWithToolsLoop: toolless fallback also failed:', err.message);
    }
  }

  // Max loops exhausted — try to extract text from last assistant message before giving up
  console.warn('[AI] chatWithToolsLoop: max loops exhausted');
  const lastMsg = messages.slice().reverse().find((m: any) => m.role === 'assistant' && m.content);
  if (lastMsg?.content && looksLikeJson(lastMsg.content)) {
    try {
      const j = JSON.parse(lastMsg.content);
      const extracted = j.response || j.text || j.message || null;
      if (extracted && typeof extracted === 'string' && !looksLikeJson(extracted)) return extracted;
    } catch {}
  } else if (lastMsg?.content && typeof lastMsg.content === 'string') {
    return lastMsg.content;
  }
  return getUnknownFallbackMessages(profileConfigStore).en;
}

// ─── Structured Output Enforcement (US-471, US-1015) ─────────────────

const LLM_STRUCTURED_RETRY_TIMEOUT_MS = parseInt(
  process.env.LLM_STRUCTURED_RETRY_TIMEOUT_MS || '5000',
  10
);

/**
 * Convert a Zod schema to a JSON Schema object for provider response_format.
 * Returns undefined if conversion fails (graceful degradation to json_object mode).
 */
export function zodSchemaToJsonSchema(
  schema: z.ZodType<any>,
  name: string
): { name: string; schema: Record<string, unknown> } | undefined {
  try {
    const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3' });
    return { name, schema: jsonSchema as Record<string, unknown> };
  } catch (err: any) {
    console.warn(`[AI] Failed to convert Zod schema '${name}' to JSON schema: ${err.message}`);
    return undefined;
  }
}

/**
 * Log a structured_output_failure event for analytics (US-1015 AC4).
 * Uses the intent prediction tracker to record schema validation failures.
 */
async function logStructuredOutputFailure(
  provider: any,
  schemaName: string,
  attempt: number,
  error: string
): Promise<void> {
  try {
    const { trackIntentPrediction } = await import('./intent-tracker.js');
    await trackIntentPrediction(
      `schema_failure_${Date.now()}`,
      'system',
      `Schema: ${schemaName}, Attempt: ${attempt}, Error: ${error.slice(0, 200)}`,
      'structured_output_failure',
      0,
      `schema_validation_fail_attempt_${attempt}`,
      provider?.name || provider?.model || 'unknown'
    );
  } catch {
    // Non-fatal — don't crash the response pipeline
  }
}

/**
 * Generate an LLM response with Zod validation, JSON schema enforcement,
 * and self-healing retry (max 2 retries).
 *
 * US-1015: Passes JSON schema to provider via response_format when supported,
 * validates with Zod, retries with corrective prompt on failure, and falls
 * back to safe defaults when all retries are exhausted.
 */
export async function generateWithValidation<T>(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  schema: z.ZodType<T>,
  maxTokens: number,
  temperature: number,
  maxRetries: number = 2,
  schemaName: string = 'response',
  providerIds?: string[]
): Promise<{ data: T | null; raw: string | null; provider: any; usage?: any; retried: boolean }> {
  // Convert Zod schema to JSON schema for provider-level enforcement (US-1015 AC1)
  const jsonSchema = zodSchemaToJsonSchema(schema, schemaName);

  const { content, provider, usage } = await chatWithFallback(
    messages, maxTokens, temperature, true, providerIds, undefined, jsonSchema
  );

  if (!content) {
    return { data: null, raw: null, provider, usage, retried: false };
  }

  // First attempt: validate with Zod
  const firstResult = safeParseLLMResponse(content, schema, `generateWithValidation:${schemaName}:attempt1`);
  if (firstResult.success) {
    return { data: firstResult.data, raw: content, provider, usage, retried: false };
  }

  // Validation failed — retry with error context if retries remain
  if (maxRetries < 1) {
    // Log failure event (US-1015 AC4)
    logStructuredOutputFailure(provider, schemaName, 1, (firstResult as any).error || 'validation_failed').catch(() => {});
    return { data: null, raw: content, provider, usage, retried: false };
  }

  // Build the JSON schema description for corrective prompt
  const schemaDesc = jsonSchema
    ? JSON.stringify(jsonSchema.schema).slice(0, 500)
    : 'See the system prompt for required JSON format';

  // Retry loop (US-1015 AC2: max 2 retries with corrective system message)
  let lastRaw = content;
  let lastProvider = provider;
  let lastUsage = usage;
  let retryMessages = [...messages];
  let lastError = (firstResult as any).error || 'validation_failed';

  for (let attempt = 2; attempt <= maxRetries + 1; attempt++) {
    // Extract field errors for the retry prompt
    let fieldErrors: string;
    try {
      const parsed = JSON.parse(lastRaw.match(/\{[\s\S]*\}/)?.[0] || lastRaw);
      const parseResult = schema.safeParse(parsed);
      fieldErrors = parseResult.success
        ? 'Unknown validation error'
        : JSON.stringify((parseResult as any).error.flatten().fieldErrors);
    } catch {
      fieldErrors = lastError || 'Invalid JSON';
    }

    console.log(`[AI] Structured retry ${attempt - 1}/${maxRetries}: validation failed, retrying. Errors: ${fieldErrors}`);

    // Append corrective message with schema reference (US-1015 AC2)
    retryMessages = [
      ...retryMessages,
      {
        role: 'user' as const,
        content: `Your previous response did not conform to the required JSON schema. Here is the schema: ${schemaDesc}. Validation errors: ${fieldErrors}. Please respond again with ONLY valid JSON matching the schema.`
      }
    ];

    const retryStart = Date.now();
    try {
      const retryPromise = chatWithFallback(
        retryMessages, maxTokens, temperature, true, providerIds, undefined, jsonSchema
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Structured retry timeout')), LLM_STRUCTURED_RETRY_TIMEOUT_MS)
      );

      const { content: retryContent, provider: retryProvider, usage: retryUsage } =
        await Promise.race([retryPromise, timeoutPromise]);

      const retryTime = Date.now() - retryStart;

      if (!retryContent) {
        console.warn(`[AI] Structured retry ${attempt - 1}: no content returned (${retryTime}ms)`);
        continue;
      }

      const retryResult = safeParseLLMResponse(retryContent, schema, `generateWithValidation:${schemaName}:attempt${attempt}`);
      if (retryResult.success) {
        console.log(`[AI] Structured retry succeeded on attempt ${attempt} (${retryTime}ms)`);
        return { data: retryResult.data, raw: retryContent, provider: retryProvider, usage: retryUsage, retried: true };
      }

      console.warn(`[AI] Structured retry ${attempt - 1}: attempt ${attempt} also failed validation (${retryTime}ms)`);
      lastRaw = retryContent;
      lastProvider = retryProvider;
      lastUsage = retryUsage;
      lastError = (retryResult as any).error || 'validation_failed';
    } catch (err: any) {
      const retryTime = Date.now() - retryStart;
      console.warn(`[AI] Structured retry ${attempt - 1} failed: ${err.message} (${retryTime}ms)`);
      lastError = err.message;
    }
  }

  // All retries exhausted — log structured_output_failure event (US-1015 AC4)
  console.warn(`[AI] generateWithValidation: all ${maxRetries} retries exhausted for schema '${schemaName}'`);
  logStructuredOutputFailure(lastProvider, schemaName, maxRetries + 1, lastError).catch(() => {});

  return { data: null, raw: lastRaw, provider: lastProvider, usage: lastUsage, retried: true };
}

// ─── Classify + Respond (unified LLM call) ──────────────────────────

export async function classifyAndRespond(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  detectedLanguage?: SupportedLanguage
): Promise<AIResponse> {
  try {
    if (!isAIAvailable()) {
      return { intent: 'unknown', action: 'reply', response: '', confidence: 0, model: 'none' };
    }

    const cw = getContextWindows();
    const langPrompt = injectLanguageInstruction(systemPrompt, detectedLanguage);
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: langPrompt }
    ];

    const recentHistory = history.slice(-cw.combined);
    for (const msg of recentHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: 'user', content: userMessage });

    const aiCfg = getAISettings();
    const startTime = Date.now();

    // Use generateWithValidation for self-healing retry on Zod failure (US-471, US-1015)
    const { data, raw, provider, usage, retried } = await generateWithValidation(
      messages, aiResponseSchema, aiCfg.max_chat_tokens, aiCfg.chat_temperature, 2, 'aiResponse'
    );
    const responseTime = Date.now() - startTime;

    if (data) {
      // Validated response — apply intent routing check
      const routing = configStore.getRouting();
      const definedIntents = Object.keys(routing);
      const intent = definedIntents.includes(data.intent) ? data.intent : 'general';
      const response = sanitizeResponse(data.response);
      const result: AIResponse = { ...data, intent, response };
      result.model = provider?.name || provider?.model || 'unknown';
      result.responseTime = responseTime;
      result.usage = usage;
      return result;
    }

    // Validation failed even after retry — fall back to parseAIResponse partial recovery
    if (raw) {
      const result = parseAIResponse(raw);
      result.model = provider?.name || provider?.model || 'unknown';
      result.responseTime = responseTime;
      result.usage = usage;
      return result;
    }

    console.warn('[AI] classifyAndRespond: all LLMs failed, using static fallback (all_llm_failed)');
    return { intent: 'unknown', action: 'reply', response: UNKNOWN_FALLBACK_MESSAGES.en, confidence: 0, model: 'all_llm_failed', responseTime };
  } catch (err: any) {
    console.error('[AI] classifyAndRespond error:', err);
    return {
      intent: 'unknown',
      action: 'reply',
      response: UNKNOWN_FALLBACK_MESSAGES.en,
      confidence: 0,
      model: 'error',
      responseTime: 0
    };
  }
}

// ─── Smart Fallback (Layer 2) ───────────────────────────────────────

/**
 * Fallback handler for low-confidence responses (Layer 2).
 * Uses smartest available models + increased context for full re-classification.
 */
export async function classifyAndRespondWithSmartFallback(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  detectedLanguage?: SupportedLanguage
): Promise<AIResponse> {
  const startTime = Date.now();

  const allProviders = getProviders();
  const smartProviders = allProviders.filter(p =>
    p.id === 'deepseek-r1-distill-70b' ||
    p.id === 'kimi-k2.5' ||
    p.id === 'gpt-oss-120b' ||
    p.priority <= 1
  );

  if (smartProviders.length === 0) {
    console.warn('[AI] No smart providers available for fallback, using all enabled');
    return classifyAndRespond(systemPrompt, history, userMessage, detectedLanguage);
  }

  const cw = getContextWindows();
  const expandedHistory = history.slice(-cw.combined);

  console.log(
    `[AI] Smart fallback: ${smartProviders.length} providers, ` +
    `${expandedHistory.length} context messages`
  );

  const langPrompt = injectLanguageInstruction(systemPrompt, detectedLanguage);
  const messages = [
    { role: 'system' as const, content: langPrompt },
    ...expandedHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: userMessage }
  ];

  const ai = getAISettings();
  let lastError: Error | null = null;

  for (const provider of smartProviders) {
    try {
      const apiKey = resolveApiKey(provider);
      if (!apiKey && provider.type !== 'ollama') continue;

      let content: string | null = null;

      if (provider.type === 'groq') {
        const groq = getGroqInstance(provider.id);
        if (!groq) continue;

        const completion = await groq.chat.completions.create({
          model: provider.model,
          messages,
          max_tokens: Math.floor(ai.max_chat_tokens * 1.5),
          temperature: ai.chat_temperature,
          response_format: { type: 'json_object' }
        });

        content = completion.choices[0]?.message?.content?.trim() || null;
      } else {
        const body: any = {
          model: provider.model,
          messages,
          max_tokens: Math.floor(ai.max_chat_tokens * 1.5),
          temperature: ai.chat_temperature,
          response_format: { type: 'json_object' }
        };

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey && provider.type !== 'ollama') {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const res = await axios.post(`${provider.base_url}/chat/completions`, body, {
          headers,
          timeout: 15000,
          validateStatus: () => true
        });

        if (res.status === 200) {
          content = res.data.choices?.[0]?.message?.content?.trim() || null;
        } else {
          throw new Error(`${provider.name} ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
        }
      }

      if (!content) continue;

      const validated = safeParseLLMResponse(content, aiResponseSchema, `smartFallback:${provider.name}`);
      const responseTime = Date.now() - startTime;

      if (validated.success) {
        console.log(
          `[AI] Smart fallback success: ${provider.name} (${responseTime}ms) ` +
          `confidence: ${validated.data.confidence}`
        );
        return {
          ...validated.data,
          model: provider.name,
          responseTime
        };
      }

      // Zod validation failed — try partial recovery
      const parsed = JSON.parse(content);
      console.log(
        `[AI] Smart fallback partial recovery: ${provider.name} (${responseTime}ms) ` +
        `confidence: ${parsed.confidence}`
      );

      return {
        intent: parsed.intent || 'unknown',
        action: VALID_ACTIONS.includes(parsed.action) ? parsed.action : 'reply',
        response: parsed.response || '',
        confidence: parseFloat(parsed.confidence || 0),
        model: provider.name,
        responseTime
      };
    } catch (error: any) {
      lastError = error;
      console.warn(`[AI] Smart provider ${provider.name} failed: ${error.message}`);
      continue;
    }
  }

  console.error('[AI] Smart fallback exhausted all providers (all_llm_failed)');
  return {
    intent: 'unknown',
    action: 'reply',
    response: UNKNOWN_FALLBACK_MESSAGES.en,
    confidence: 0,
    model: 'all_llm_failed',
    responseTime: Date.now() - startTime
  };
}

// ─── Generate Reply Only (skip classification) ──────────────────────

/**
 * Generate a reply for a known intent without re-classifying.
 * Used by T4 Smart-Fast and T5 Tiered-Hybrid when classification is already done.
 */
export async function generateReplyOnly(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  intent: string,
  detectedLanguage?: SupportedLanguage
): Promise<{ response: string; confidence?: number; model?: string; responseTime?: number }> {
  if (!isAIAvailable()) {
    return { response: '', confidence: 0, model: 'none' };
  }

  const langName = detectedLanguage && detectedLanguage !== 'unknown' && detectedLanguage !== 'en'
    ? (LANGUAGE_NAMES[detectedLanguage] || detectedLanguage)
    : null;
  const langInstruction = langName
    ? `Reply entirely in ${langName}.`
    : 'Reply in the same language as the user.';

  const replyPrompt = systemPrompt + `\n\nThe user's intent has been classified as "${intent}". Generate a helpful response. ${langInstruction}

IMPORTANT: Include a confidence score for your response:
- Set confidence < 0.5 if: answer is partial, information is incomplete, or you're not sure
- Set confidence < 0.7 if: answer requires interpretation or combines multiple KB sections
- Set confidence >= 0.7 if: answer is directly stated in KB and complete
- Set confidence >= 0.9 if: answer is exact quote from KB with no ambiguity

Respond with ONLY valid JSON: {"response":"<your reply>", "confidence": 0.0-1.0}`;

  const cw = getContextWindows();
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: replyPrompt }
  ];

  const recentHistory = history.slice(-cw.reply);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  const aiCfg = getAISettings();
  const startTime = Date.now();

  // US-1015: Use generateWithValidation with 2 retries and JSON schema enforcement
  const { data, raw, provider, usage, retried } = await generateWithValidation(
    messages, replyOnlyResultSchema, aiCfg.max_chat_tokens, aiCfg.chat_temperature, 2, 'replyOnly'
  );
  const responseTime = Date.now() - startTime;

  if (data) {
    return {
      response: data.response.trim(),
      confidence: data.confidence ?? 0.7,
      model: provider?.name || provider?.model || 'unknown',
      responseTime
    };
  }

  // Validation failed after retries — try partial recovery from raw (US-1015 AC3: safe fallback)
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const confidence = typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.7;
      const responseText = typeof parsed.response === 'string' ? parsed.response.trim() : '';
      return {
        response: responseText,
        confidence,
        model: provider?.name || provider?.model || 'unknown',
        responseTime
      };
    } catch {
      if (looksLikeJson(raw)) {
        console.warn('[AI] generateReplyOnly: LLM returned JSON-like content, using empty response');
        return { response: '', confidence: 0.5, model: provider?.name || 'unknown', responseTime };
      }
      return {
        response: stripConfidenceSuffix(raw),
        confidence: 0.5,
        model: provider?.name || 'unknown',
        responseTime
      };
    }
  }

  console.warn('[AI] generateReplyOnly: all LLMs failed, using static fallback');
  return { response: UNKNOWN_FALLBACK_MESSAGES.en, confidence: 0, model: 'all_llm_failed', responseTime };
}

// ─── Response Parsing ───────────────────────────────────────────────

const FALLBACK_RESPONSE: AIResponse = { intent: 'general', action: 'reply', response: '', confidence: 0.5 };

/**
 * Attempt partial recovery from a raw parsed object.
 * Extracts whatever valid fields exist and fills the rest with safe defaults.
 */
function recoverPartial(obj: Record<string, unknown>): AIResponse {
  const routing = configStore.getRouting();
  const definedIntents = Object.keys(routing);

  const rawIntent = typeof obj.intent === 'string' ? obj.intent : '';
  const intent = rawIntent && definedIntents.includes(rawIntent) ? rawIntent : 'general';

  const rawAction = typeof obj.action === 'string' ? obj.action : '';
  const action: AIAction = (VALID_ACTIONS as readonly string[]).includes(rawAction)
    ? (rawAction as AIAction)
    : 'reply';

  const rawResponse = typeof obj.response === 'string' ? obj.response : '';
  const response = sanitizeResponse(rawResponse);

  const rawConfidence = typeof obj.confidence === 'number' ? obj.confidence : NaN;
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0.5;

  return { intent, action, response, confidence };
}

export function parseAIResponse(raw: string): AIResponse {
  // Step 1: Try JSON.parse
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSON.parse failed — try to extract JSON from mixed text
    const lastBrace = raw.lastIndexOf('}');
    if (lastBrace >= 0) {
      for (let start = raw.lastIndexOf('{'); start >= 0; start = raw.lastIndexOf('{', start - 1)) {
        if (start > lastBrace) continue;
        try {
          const candidate = raw.slice(start, lastBrace + 1);
          parsed = JSON.parse(candidate);
          // Found valid JSON — validate it below
          break;
        } catch {
          continue;
        }
      }
    }
    // If we still don't have parsed JSON, try plain text extraction
    if (!parsed!) {
      if (lastBrace >= 0) {
        const jsonStart = raw.lastIndexOf('\n\n{');
        if (jsonStart > 0) {
          const stripped = raw.slice(0, jsonStart).trim();
          if (stripped && !looksLikeJson(stripped)) {
            return { intent: 'general', action: 'reply', response: stripped, confidence: 0.5 };
          }
        }
      }
      console.warn('[AI] parseAIResponse: could not parse JSON, using fallback');
      return { ...FALLBACK_RESPONSE };
    }
  }

  // Step 2: Validate with Zod schema
  const result = aiResponseSchema.safeParse(parsed!);
  if (result.success) {
    // Full validation passed — still validate intent against routing
    const routing = configStore.getRouting();
    const definedIntents = Object.keys(routing);
    const intent = definedIntents.includes(result.data.intent) ? result.data.intent : 'general';
    const response = sanitizeResponse(result.data.response);
    return { ...result.data, intent, response };
  }

  // Step 3: Validation failed — attempt partial recovery
  console.warn('[AI] parseAIResponse: Zod validation failed, attempting partial recovery:', result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
  return recoverPartial(parsed!);
}

/** True if the string looks like raw JSON to avoid leaking to guests. */
export function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith('{') && t.includes('"'))
      || (t.startsWith('[{') && t.includes('"'))
      || /^```(?:json)?\s*\{/i.test(t);  // catch markdown-fenced JSON
}

/**
 * Sanitizes the `response` field from an LLM-generated JSON object.
 * Handles cases where the LLM wraps its reply in a markdown code fence
 * or nests another JSON object inside the response field.
 *
 * - Strips markdown fences (```json ... ```)
 * - If the result is JSON, attempts to extract the nested `response` field
 * - Returns empty string if content cannot be recovered as plain text
 */
/**
 * Strips trailing LLM-generated confidence annotations from plain-text fallback responses.
 * e.g. '...— Rainbow " Confidence: 0.9' → '...— Rainbow'
 */
function stripConfidenceSuffix(text: string): string {
  return text.replace(/"?\s*[Cc]onfidence:\s*[\d.]+\s*$/, '').trim();
}

function sanitizeResponse(s: string): string {
  if (!s) return '';
  const t = s.trim();
  // Strip markdown fence if present
  const core = t.startsWith('```')
    ? t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/m, '').trim()
    : t;
  // If it looks like JSON, try to extract the nested response field
  if (core.startsWith('{') && core.includes('"')) {
    try {
      const parsed = JSON.parse(core);
      const text = parsed?.response ?? parsed?.message ?? parsed?.text ?? parsed?.reply;
      if (typeof text === 'string') {
        const inner = text.trim();
        // One level of recursion to handle double-nesting; bail if still JSON
        return inner.startsWith('{') || inner.startsWith('```') ? '' : inner;
      }
    } catch { /* fall through */ }
    return '';
  }
  return core; // Return fence-stripped clean text
}
