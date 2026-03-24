/**
 * Pipeline Stage: Low-Confidence Auto-Escalation (US-373)
 *
 * Routes messages with classification confidence below configurable threshold
 * directly to escalation queue instead of attempting fallback responses.
 * Reduces wasted AI calls and improves customer satisfaction.
 */

import type { PipelineState } from './types.js';
import type { IPipelineContext } from './pipeline-context.js';
import type { EscalationContext } from '../types.js';
import type { ClassificationResult } from './stages/tier-classification.js';

// Extend PipelineState to include classificationResult
export interface PipelineStateWithResult extends PipelineState {
  classificationResult?: ClassificationResult;
}

/**
 * Check if a message should be auto-escalated based on low confidence.
 * Called after classification but before fallback selection.
 *
 * @param state - Pipeline state with classification result
 * @param context - Pipeline context with settings
 * @returns true if escalation should occur, false otherwise
 */
export function shouldAutoEscalate(state: PipelineStateWithResult, context: IPipelineContext): boolean {
  const settings = context.getSettings();
  const escalationConfig = (settings as any).escalation;

  // Check if auto-escalation is configured
  if (!escalationConfig || !escalationConfig.auto_escalate_below_threshold) {
    return false;
  }

  // Get the threshold and confidence from state
  const threshold = escalationConfig.low_confidence_threshold ?? 0.65;
  const confidence = state.classificationResult?.confidence ?? 1.0;

  // Escalate if confidence is below threshold
  return confidence < threshold;
}

/**
 * Build escalation context for low-confidence auto-escalation
 *
 * @param state - Pipeline state
 * @param context - Pipeline context
 * @returns EscalationContext for escalateToStaff function
 */
export function buildLowConfidenceEscalationContext(
  state: PipelineState,
  context: IPipelineContext
): EscalationContext {
  const { phone, msg, text, convo, diaryEvent, profileId } = state;

  // Build recent messages for context
  const recentMessages = convo.messages
    .slice(-5)
    .map((m) => `${m.role}: ${m.content}`);

  return {
    phone,
    pushName: msg.pushName,
    reason: 'low_confidence',
    recentMessages,
    originalMessage: text,
    instanceId: state.msg.instanceId,
    profileId: profileId || 'pelangi',
    triggerDetail: `Intent: ${state.classificationResult?.intent} (confidence: ${(state.classificationResult?.confidence ?? 0).toFixed(2)})`,
    metadata: {
      confidence: state.classificationResult?.confidence,
      intent: state.classificationResult?.intent,
    },
  };
}
