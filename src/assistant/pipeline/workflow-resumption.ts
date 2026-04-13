/**
 * Workflow Resumption Hints — US-590
 *
 * When a conversation is resumed after a gap (>5 minutes),
 * detect if there's an incomplete booking workflow in progress
 * and send a resumption hint to reduce re-entry friction.
 *
 * Features:
 * - Checks if workflow state exists and is incomplete
 * - Validates time gap since last update (>5 min)
 * - Retrieves current step name from workflows.json
 * - Formats multilingual resumption hints
 */

import type { PipelineState } from './types.js';
import { configStore } from '../config-store.js';
import { detectLanguage } from '../formatter.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('WorkflowResumption');

const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the current step name from the workflow definition.
 * @param workflowId The workflow ID (e.g., 'booking')
 * @param stepIndex The current step index
 * @returns The step name or null if not found
 */
function getStepName(workflowId: string, stepIndex: number): string | null {
  try {
    const workflows = configStore.getWorkflows();
    const workflow = workflows?.find((w: any) => w.id === workflowId);

    if (!workflow) {
      logger.debug(`[US-590] Workflow not found: ${workflowId}`);
      return null;
    }

    const steps = workflow.steps;
    if (!steps || stepIndex < 0 || stepIndex >= steps.length) {
      logger.debug(`[US-590] Step index out of range: ${stepIndex} for workflow ${workflowId}`);
      return null;
    }

    const step = steps[stepIndex];
    return step.name || step.id;
  } catch (err: any) {
    logger.error(`[US-590] Error getting step name:`, err.message);
    return null;
  }
}

/**
 * Format a resumption hint message based on the workflow and step.
 * @param workflowId The workflow ID
 * @param stepName The current step name
 * @param checkInDate Optional check-in date from collected data
 * @param checkOutDate Optional check-out date from collected data
 * @param language Language code (en, ms, zh, ta)
 * @returns Formatted hint message
 */
function formatResumptionHint(
  workflowId: string,
  stepName: string,
  checkInDate?: string,
  checkOutDate?: string,
  language: string = 'en'
): string {
  // For booking workflows, create a more specific hint
  if (workflowId === 'booking') {
    const dates = checkInDate && checkOutDate ? ` for ${checkInDate}-${checkOutDate}` : '';

    const hints: Record<string, string> = {
      'en': `Let me help you complete your booking${dates}. We were on: ${stepName}`,
      'ms': `Biarkan saya membantu anda menyelesaikan tempahan${dates}. Kami berada pada: ${stepName}`,
      'zh': `让我帮你完成预订${dates}。我们在：${stepName}`,
      'ta': `உங்களின் முன்னேற்றம் முடிக்க நான் உதவ${dates}। நாம் இருந்தோம்: ${stepName}`
    };

    return hints[language] || hints['en'];
  }

  // For other workflows, use a generic hint
  const hints: Record<string, string> = {
    'en': `Let me help you continue. We were on: ${stepName}`,
    'ms': `Biarkan saya membantu anda melanjutkan. Kami berada pada: ${stepName}`,
    'zh': `让我帮你继续。我们在：${stepName}`,
    'ta': `நீங்கள் தொடர உதவ. நாம் இருந்தோம்: ${stepName}`
  };

  return hints[language] || hints['en'];
}

/**
 * Check if workflow resumption hint should be sent.
 * Returns the hint message if conditions are met, null otherwise.
 *
 * @param state Current pipeline state
 * @returns Resumption hint message or null
 */
export function getWorkflowResumptionHint(state: PipelineState): string | null {
  const { convo, text } = state;

  // Skip if no workflow state exists
  if (!convo.workflowState) {
    return null;
  }

  const { workflowId, currentStepIndex, startedAt, lastUpdateAt } = convo.workflowState;

  // Check if workflow is complete (booking workflows don't have an end marker in state,
  // so we just check if a workflow exists). If we reach here with a workflow state,
  // it's incomplete.

  // Check time gap since last update
  const now = Date.now();
  const timeSinceLastUpdate = now - lastUpdateAt;

  if (timeSinceLastUpdate < GAP_THRESHOLD_MS) {
    logger.debug(
      `[US-590] Workflow resumption skipped (active): ${workflowId} ` +
      `gap=${timeSinceLastUpdate}ms < threshold=${GAP_THRESHOLD_MS}ms`
    );
    return null;
  }

  // Get step name
  const stepName = getStepName(workflowId, currentStepIndex);
  if (!stepName) {
    logger.debug(`[US-590] Could not get step name for workflow ${workflowId} step ${currentStepIndex}`);
    return null;
  }

  // Determine language
  const language = detectLanguage(text) || 'en';

  // Extract collected data for context (e.g., dates for booking)
  const { collectedData } = convo.workflowState;
  const checkInDate = collectedData?.check_in_date;
  const checkOutDate = collectedData?.check_out_date;

  // Format and return hint
  const hint = formatResumptionHint(workflowId, stepName, checkInDate, checkOutDate, language);

  logger.info(
    `[US-590] Resumption hint generated: workflow=${workflowId} step=${stepName} ` +
    `gap=${(timeSinceLastUpdate / 1000).toFixed(0)}s language=${language}`
  );

  return hint;
}
