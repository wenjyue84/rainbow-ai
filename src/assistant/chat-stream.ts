/**
 * chat-stream.ts — SSE streaming for progressive webchat responses (US-820)
 *
 * Streams LLM tokens to the client via Server-Sent Events,
 * reducing perceived latency from 3-10s to near-instant first token.
 */
import type { Response } from 'express';
import type { MCPTool, MCPToolResult, ToolHandler } from '../types/mcp.js';
import type { ChatMessage } from './types.js';
import axios from 'axios';
import {
  getProviders, resolveApiKey, getAISettings, getGroqInstance,
  supportsPromptCaching, injectCacheControl, DEFAULT_TIMEOUT_MS,
  providerChat, chatWithFallback
} from './ai-provider-manager.js';
import { circuitBreakerRegistry } from './circuit-breaker.js';
import { rateLimitManager } from './rate-limit-manager.js';
import { isProviderOverBudget } from './llm-cost-budget.js';
import { getContextWindows } from './context-windows.js';

const STREAM_FALLBACK = "I'm sorry, I'm having trouble responding right now. Please try again in a moment.";

// ─── SSE Helpers ──────────────────────────────────────────────────────

/** Set SSE response headers */
export function setupSSEHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx proxy compatibility
  res.flushHeaders();
}

/** Write a single SSE data event */
export function sseEvent(res: Response, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** Send a complete text as a single SSE token + done (for static/workflow responses) */
export function sendStaticSSE(res: Response, text: string, responseTime: number, sessionId: string): void {
  setupSSEHeaders(res);
  sseEvent(res, { token: text });
  sseEvent(res, { done: true, responseTime, sessionId });
  res.end();
}

// ─── Message Building ─────────────────────────────────────────────────

function buildMessages(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): Array<{ role: string; content: string }> {
  const cw = getContextWindows();
  const msgs: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt }
  ];
  for (const m of history.slice(-cw.combined)) {
    msgs.push({ role: m.role, content: m.content });
  }
  msgs.push({ role: 'user', content: userMessage });
  return msgs;
}

// ─── Provider Streaming ───────────────────────────────────────────────

/** Stream tokens from a single provider. Returns accumulated text. */
async function streamFromProvider(
  res: Response,
  provider: any,
  messages: any[],
  maxTokens: number,
  temperature: number
): Promise<string> {
  const apiKey = resolveApiKey(provider);
  let fullText = '';

  if (provider.type === 'groq') {
    const groq = getGroqInstance(provider.id);
    if (!groq) throw new Error('No Groq instance');

    const stream = await groq.chat.completions.create({
      model: provider.model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = (chunk as any).choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        sseEvent(res, { token: delta });
      }
    }

  } else if (provider.type === 'google-gemini') {
    // Gemini streaming API differs; fall back to non-streaming single chunk
    const result = await providerChat(provider, messages, maxTokens, temperature);
    if (result?.content) {
      fullText = result.content;
      sseEvent(res, { token: result.content });
    }

  } else {
    // OpenAI-compatible / Ollama
    const effectiveMessages = supportsPromptCaching(provider)
      ? injectCacheControl(messages) : messages;

    const body: any = {
      model: provider.model,
      messages: effectiveMessages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey && provider.type !== 'ollama') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    if (provider.base_url?.includes('openrouter.ai')) {
      headers['Referer'] = process.env.OPENROUTER_REFERER || 'https://pelangi-unit.local';
      headers['X-Title'] = process.env.OPENROUTER_APP_TITLE || 'Rainbow AI digiman';
    }

    const axiosRes = await axios.post(`${provider.base_url}/chat/completions`, body, {
      headers,
      responseType: 'stream',
      timeout: (provider.timeout_ms ?? DEFAULT_TIMEOUT_MS) + 30000,
    });

    if (axiosRes.status !== 200) {
      throw new Error(`${provider.name} ${axiosRes.status}`);
    }

    let buffer = '';
    for await (const rawChunk of axiosRes.data) {
      buffer += rawChunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const d = trimmed.slice(6);
        if (d === '[DONE]') continue;
        try {
          const delta = JSON.parse(d).choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            sseEvent(res, { token: delta });
          }
        } catch { /* skip malformed chunks */ }
      }
    }
  }

  if (!fullText) throw new Error('Empty streaming response');
  return fullText;
}

/** Try streaming from providers in priority order. Returns accumulated text. */
async function streamFromProviders(
  res: Response,
  messages: any[],
  maxTokens: number,
  temperature: number
): Promise<string> {
  const providers = getProviders();

  for (const provider of providers) {
    const breaker = circuitBreakerRegistry.getOrCreate(provider.id);
    if (breaker.isOpen() || rateLimitManager.isInCooldown(provider.id) || isProviderOverBudget(provider.id)) continue;

    const apiKey = resolveApiKey(provider);
    if (!apiKey && provider.type !== 'ollama') continue;

    try {
      const text = await streamFromProvider(res, provider, messages, maxTokens, temperature);
      if (text) {
        breaker.recordSuccess();
        rateLimitManager.recordSuccess(provider.id);
        console.log(`[AI Stream] ✅ ${provider.name} streamed ${text.length} chars`);
        return text;
      }
    } catch (err: any) {
      breaker.recordFailure();
      console.warn(`[AI Stream] ${provider.name} failed:`, err.message);
    }
  }

  // All providers failed
  sseEvent(res, { token: STREAM_FALLBACK });
  return STREAM_FALLBACK;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Stream an LLM chat response (no tools) via SSE.
 * Returns the full accumulated response text.
 */
export async function streamChatResponse(
  res: Response,
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const messages = buildMessages(systemPrompt, history, userMessage);
  const chatCfg = getAISettings();
  return streamFromProviders(res, messages, chatCfg.max_chat_tokens, chatCfg.chat_temperature);
}

/**
 * Stream a chat response with tool support via SSE.
 * Tools execute server-side (non-streaming), then the final text response is streamed.
 * Returns the full accumulated response text.
 */
export async function streamChatWithTools(
  res: Response,
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  tools: MCPTool[],
  toolHandlers: Map<string, ToolHandler>
): Promise<string> {
  const cw = getContextWindows();
  const messages: any[] = [{ role: 'system', content: systemPrompt }];
  for (const m of history.slice(-cw.combined)) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: 'user', content: userMessage });

  const openAiTools = tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }));

  const chatCfg = getAISettings();
  const MAX_LOOPS = 3;
  let toolsWereCalled = false;

  // Tool loop: execute tools non-streaming
  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const { content, toolCalls } = await chatWithFallback(
      messages, chatCfg.max_chat_tokens, chatCfg.chat_temperature,
      false, undefined, openAiTools
    );

    if (!toolCalls || toolCalls.length === 0) {
      if (!toolsWereCalled) {
        // No tools called at all — stream a fresh LLM response (plain text, no tools)
        return streamFromProviders(res, messages, chatCfg.max_chat_tokens, chatCfg.chat_temperature);
      }
      // Tools were called previously; break to stream final response
      break;
    }

    toolsWereCalled = true;
    messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

    // Execute each tool
    for (const call of toolCalls) {
      const fnName = call.function?.name;
      let args: any = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* use empty */ }

      const handler = toolHandlers.get(fnName);
      let result: MCPToolResult;
      if (handler) {
        try { result = await handler(args); }
        catch (e: any) { result = { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }; }
      } else {
        result = { content: [{ type: 'text', text: `Unknown tool: ${fnName}` }], isError: true };
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result.content) });
      console.log(`[AI Stream] Tool: ${fnName} → ${result.isError ? 'ERROR' : 'OK'} (loop ${loop + 1})`);
    }
  }

  // Stream final response after tool execution (no tools parameter — just text generation)
  return streamFromProviders(res, messages, chatCfg.max_chat_tokens, chatCfg.chat_temperature);
}
