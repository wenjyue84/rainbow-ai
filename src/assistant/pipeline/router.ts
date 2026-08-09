/**
 * Low-Confidence Intent Auto-Escalation Router (US-373)
 *
 * Routes messages with classification confidence below a configurable threshold
 * directly to the escalation queue instead of attempting fallback responses.
 * This reduces wasted AI calls and improves customer satisfaction.
 *
 * Usage:
 *   const shouldEscalate = await checkLowConfidenceEscalation(
 *     state, result, context
 *   );
 *   if (shouldEscalate) return; // escalation already queued, stop processing
 */

import type { IPipelineContext } from './pipeline-context.js';
import type { PipelineState } from './types.js';
import type { ClassificationResult } from './stages/tier-classification.js';
import { db } from '../../lib/db.js';
import { escalationQueue } from '../../../shared/schema-tables.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('LowConfidenceRouter');

export interface EscalationConfig {
  low_confidence_threshold: number;
  auto_escalate_below_threshold: boolean;
}

/**
 * Check if a message should be auto-escalated due to low confidence.
 * If conditions are met, pushes to escalation queue with reason 'low_confidence'.
 *
 * @param state - Pipeline state
 * @param result - Classification result with confidence score
 * @param context - Pipeline context with settings
 * @returns true if escalated (caller should stop processing), false otherwise
 */
export async function checkLowConfidenceEscalation(
  state: PipelineState,
  result: ClassificationResult,
  context: IPipelineContext
): Promise<boolean> {
  const settings = context.getSettings();
  const escalationCfg = settings.escalation as EscalationConfig | undefined;

  if (!escalationCfg?.auto_escalate_below_threshold) {
    return false; // feature disabled
  }

  const threshold = escalationCfg.low_confidence_threshold ?? 0.65;

  if (result.confidence >= threshold) {
    return false; // confidence above threshold, continue normal routing
  }

  // ─── Escalate to queue ────────────────────────────────────────────────
  const { phone, processText, profileId } = state;
  const preview = processText.slice(0, 200);
  const keywords = [...new Set(
    processText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
  )].slice(0, 20);

  try {
    await db.insert(escalationQueue).values({
      conversationId: phone,
      originalIntent: result.intent,
      confidenceScore: result.confidence,
      messagePreview: preview,
      recommendedKeywords: JSON.stringify(keywords),
      profile: profileId,
      // Escalation reason 'low_confidence' is tracked in diary event
    });

    logger.info(
      `[US-373] Auto-escalated message (confidence=${result.confidence.toFixed(2)} < ${threshold}): ${result.intent}`,
      { phone, confidence: result.confidence, threshold, intent: result.intent }
    );
  } catch (error) {
    logger.error(
      '[US-373] Failed to escalate low-confidence message',
      { phone, confidence: result.confidence, error }
    );
    // Don't throw — allow graceful degradation
  }

  return true; // escalation processed, caller should stop normal routing
}
