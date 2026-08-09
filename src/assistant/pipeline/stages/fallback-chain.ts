/**
 * Pipeline Stage: Intent Classifier Fallback Chain (US-279)
 *
 * When a primary classification result has confidence below the first chain
 * entry's min_confidence, iterates through the configured fallback_chain,
 * trying each secondary provider in order until one exceeds its threshold.
 * If all providers fail, returns intent='unknown' (escalation path).
 *
 * Config shape (in settings.json):
 * {
 *   "fallback_chain": {
 *     "enabled": true,
 *     "chain": [
 *       { "provider_name": "groq-llama",         "min_confidence": 0.6, "timeout_ms": 6000, "retry_count": 1 },
 *       { "provider_name": "google-gemini-flash", "min_confidence": 0.6, "timeout_ms": 6000, "retry_count": 1 }
 *     ]
 *   }
 * }
 */

import type { ClassificationResult } from './tier-classification.js';
import type { IPipelineContext } from '../pipeline-context.js';
import type { ChatMessage } from '../../types.js';

export interface FallbackChainEntry {
  provider_name: string;
  min_confidence: number;
  timeout_ms?: number;
  retry_count?: number;
}

export interface FallbackChainConfig {
  enabled: boolean;
  chain: FallbackChainEntry[];
}

/**
 * Apply the fallback chain to a classification result.
 *
 * Returns the original result unchanged if:
 * - fallback_chain is not configured, disabled, or empty
 * - primary confidence already meets the first chain entry's threshold
 *
 * Otherwise iterates through chain providers. Returns the first result that
 * meets its min_confidence threshold. If all fail, returns intent='unknown'.
 */
export async function applyFallbackChain(
  primary: ClassificationResult,
  contextMessages: ChatMessage[],
  text: string,
  ctx: IPipelineContext
): Promise<ClassificationResult> {
  const settings = ctx.getSettings();
  const config: FallbackChainConfig | undefined = settings?.fallback_chain;

  // No-op: not configured, disabled, or empty chain
  if (!config || !config.enabled || !Array.isArray(config.chain) || config.chain.length === 0) {
    return primary;
  }

  // No-op: primary confidence already meets the first threshold
  const firstThreshold = config.chain[0].min_confidence;
  if (primary.confidence >= firstThreshold) {
    return primary;
  }

  // Iterate through fallback providers
  for (const entry of config.chain) {
    try {
      const result = await ctx.classifyOnly(text, contextMessages, entry.provider_name);
      if (result.confidence >= entry.min_confidence) {
        return {
          intent: result.intent,
          action: primary.action,
          response: primary.response,
          confidence: result.confidence,
          model: result.model,
          responseTime: result.responseTime,
        };
      }
    } catch (err: any) {
      // Provider failed (timeout, API error) — skip and try next
      console.warn(`[FallbackChain] Provider "${entry.provider_name}" failed: ${err?.message ?? err}`);
    }
  }

  // All chain providers exhausted without meeting threshold → escalation path
  return {
    intent: 'unknown',
    action: 'llm_reply',
    response: '',
    confidence: 0,
    model: 'fallback-chain-exhausted',
  };
}
