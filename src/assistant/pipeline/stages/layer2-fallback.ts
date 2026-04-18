/**
 * Pipeline Stage 4: Layer 2 Fallback
 *
 * When classification confidence falls below threshold, retries with
 * a smarter/larger model and expanded context (smart fallback).
 * Only replaces the original result if the fallback improves confidence.
 */

import type { IPipelineContext } from '../pipeline-context.js';
import type { DevMetadata } from '../types.js';
import type { ChatMessage } from '../../types.js';
import type { ClassificationResult } from './tier-classification.js';
import { getLLMSettings } from '../../llm-settings-loader.js';
import { getUnknownFallbackMessages } from '../../ai-response-generator.js';

/**
 * Stage 4: Layer 2 Fallback
 *
 * Checks if classification confidence is below the configured threshold.
 * If so, retries with classifyAndRespondWithSmartFallback (larger model, more context).
 * Returns the better result (original or fallback).
 *
 * @param result - Original classification result from tier classification
 * @param systemPrompt - System prompt for the retry
 * @param contextMessages - Conversation context
 * @param processText - Processed user message
 * @param devMetadata - Dev metadata to update source/model/responseTime
 * @param context - Pipeline context with AI dependencies
 * @returns Updated classification result (may be original or improved)
 */
export async function applyLayer2Fallback(
  result: ClassificationResult,
  systemPrompt: string,
  contextMessages: ChatMessage[],
  processText: string,
  devMetadata: DevMetadata,
  context: IPipelineContext,
  detectedLanguage?: string
): Promise<ClassificationResult> {
  const llmSettings = getLLMSettings();
  const layer2Threshold = llmSettings.thresholds?.layer2 ?? 0.80;

  // AI must be available to retry
  if (!context.isAIAvailable()) {
    return result;
  }

  // Detect "rescue-worthy" responses that should trigger Layer 2 even at high confidence:
  //   - Empty / whitespace-only response (primary LLM returned nothing — "all_llm_failed" case)
  //   - Response exactly matches the default unknown-fallback template in any language
  const responseText = (result.response || '').trim();
  const isEmptyResponse = !responseText;
  const fallbackMessages = getUnknownFallbackMessages();
  const isDefaultFallback =
    !isEmptyResponse && (
      responseText === fallbackMessages.en.trim() ||
      responseText === fallbackMessages.ms.trim() ||
      responseText === fallbackMessages.zh.trim() ||
      responseText === fallbackMessages.ta.trim()
    );
  const needsRescue = isEmptyResponse || isDefaultFallback;

  // Skip if confidence is already above threshold AND the response is substantive
  if (result.confidence >= layer2Threshold && !needsRescue) {
    return result;
  }

  const reason = needsRescue
    ? (isEmptyResponse ? 'empty response' : 'default fallback emitted')
    : `confidence ${result.confidence.toFixed(2)} < ${layer2Threshold.toFixed(2)}`;
  console.log(`[Layer2] ${reason} → retrying with smart fallback`);

  const fallbackResult = await context.classifyAndRespondWithSmartFallback(
    systemPrompt, contextMessages, processText, detectedLanguage
  );

  // Accept fallback if it improved confidence, OR if we were rescuing an
  // empty/default-fallback and the rescue produced a non-empty, non-default reply.
  const fallbackText = (fallbackResult.response || '').trim();
  const fallbackIsEmpty = !fallbackText;
  const fallbackIsDefault =
    !fallbackIsEmpty && (
      fallbackText === fallbackMessages.en.trim() ||
      fallbackText === fallbackMessages.ms.trim() ||
      fallbackText === fallbackMessages.zh.trim() ||
      fallbackText === fallbackMessages.ta.trim()
    );
  const rescueSucceeded = needsRescue && !fallbackIsEmpty && !fallbackIsDefault;

  if (fallbackResult.confidence > result.confidence || rescueSucceeded) {
    console.log(
      `[Layer2] ${rescueSucceeded ? 'Rescued' : 'Improved'} confidence: ${result.confidence.toFixed(2)} → ${fallbackResult.confidence.toFixed(2)} (${fallbackResult.model})`
    );

    devMetadata.source = (devMetadata.source || 'llm') + '+layer2';
    devMetadata.model = fallbackResult.model;
    devMetadata.responseTime = (result.responseTime || 0) + (fallbackResult.responseTime || 0);
    devMetadata.usage = fallbackResult.usage;

    return {
      intent: fallbackResult.intent,
      action: fallbackResult.action,
      response: fallbackResult.response,
      confidence: fallbackResult.confidence,
      model: fallbackResult.model,
      responseTime: (result.responseTime || 0) + (fallbackResult.responseTime || 0),
      detectedLanguage: result.detectedLanguage,
      usage: fallbackResult.usage,
    };
  }

  console.log(`[Layer2] Fallback did not improve confidence (${fallbackResult.confidence.toFixed(2)})`);
  return result;
}
