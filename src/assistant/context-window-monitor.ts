/**
 * US-978: Context Window Monitor
 *
 * Logs total token count for each LLM call and fires an alert
 * when a single call approaches 80% of the model's context window.
 *
 * Model context windows are looked up from a static registry.
 * The alert threshold is configurable via conversation_management.context_window_alert_threshold.
 */

import { configStore } from './config-store.js';

/**
 * Known model context window sizes (tokens).
 * Covers models used by Rainbow AI providers.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Groq models
  'llama-3.3-70b-versatile': 128_000,
  'llama-3.1-70b-versatile': 128_000,
  'llama-3.1-8b-instant': 128_000,
  'llama-3-70b-8192': 8_192,
  'llama-3-8b-8192': 8_192,
  'mixtral-8x7b-32768': 32_768,
  'gemma2-9b-it': 8_192,
  // Google Gemini
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.0-flash-lite': 1_048_576,
  'gemini-1.5-flash': 1_048_576,
  'gemini-1.5-pro': 2_097_152,
  // NVIDIA / OpenRouter
  'kimi-k2.5': 131_072,
  'deepseek-r1-distill-llama-70b': 128_000,
  'deepseek-r1': 128_000,
  'deepseek-v3': 128_000,
  'gpt-oss-120b': 128_000,
  // Ollama local
  'llama3.1:8b': 128_000,
  'qwen2.5:7b': 32_768,
  'deepseek-r1:8b': 128_000,
};

/**
 * Default context window to assume when model is not in the registry.
 */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Get the context window alert threshold from config (default: 0.8 = 80%).
 */
function getAlertThreshold(): number {
  try {
    const settings = configStore.getSettings();
    const config = settings.conversation_management;
    const threshold = (config as any)?.context_window_alert_threshold;
    if (typeof threshold === 'number' && threshold > 0 && threshold <= 1) {
      return threshold;
    }
  } catch {}
  return 0.8;
}

/**
 * Look up model context window size. Tries exact match first,
 * then partial match (model name contained in key or vice versa).
 */
function getModelContextWindow(model: string): number {
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];

  // Partial match for model variants (e.g., "llama-3.3-70b-versatile:latest")
  const lowerModel = model.toLowerCase();
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lowerModel.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerModel)) {
      return value;
    }
  }

  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * US-978: Check LLM call token usage and alert if approaching context window limit.
 *
 * Called after each successful LLM call. Logs total tokens used and fires
 * a warning when prompt tokens exceed the configurable threshold (default 80%)
 * of the model's context window.
 *
 * @param providerId - Provider identifier
 * @param model - Model name for context window lookup
 * @param usage - Token usage from the LLM response
 */
export function checkContextWindowUsage(
  providerId: string,
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
): void {
  if (!usage) return;

  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? (promptTokens + completionTokens);

  if (totalTokens === 0) return;

  // Log total token count for every LLM call (US-978 AC5)
  console.log(
    `[ContextMonitor] LLM call tokens: prompt=${promptTokens}, completion=${completionTokens}, total=${totalTokens} (${providerId}/${model})`
  );

  // Check if approaching context window limit
  const contextWindow = getModelContextWindow(model);
  const threshold = getAlertThreshold();
  const thresholdTokens = Math.floor(contextWindow * threshold);

  if (promptTokens > thresholdTokens) {
    const usagePct = Math.round((promptTokens / contextWindow) * 100);
    console.warn(
      `[ContextMonitor] ⚠️  CONTEXT WINDOW ALERT: ${providerId}/${model} — ` +
      `prompt tokens (${promptTokens}) at ${usagePct}% of context window (${contextWindow}). ` +
      `Threshold: ${Math.round(threshold * 100)}% (${thresholdTokens} tokens). ` +
      `Consider reducing conversation context or enabling summarization.`
    );
  }
}
