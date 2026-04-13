/**
 * step-error-handler.ts — US-352 Booking Workflow Step Failure Recovery
 *
 * Handles booking workflow step execution failures with:
 * - Structured error capture (step name, input values, error type)
 * - Profile-aware recovery message generation
 * - Automatic escalation event creation for staff review
 */

import { db } from '../../lib/db.js';
import { escalationEvents } from '../../../shared/schema-tables.js';
import { getErrorMessage } from '../response-processor.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StepErrorContext {
  stepId: string;
  stepName: string;
  inputValues: Record<string, unknown>;
  error: Error | string | unknown;
  errorType: string;
  jid: string;
  profileId: string;
  conversationId?: string;
  guestName?: string;
}

// ─── Profile Normalization ────────────────────────────────────────────────────

const PROFILE_ALIASES: Record<string, string> = {
  pelangi: 'pelangi',
  'pelangi-capsule': 'pelangi',
  southern: 'southern',
  'southern-homestay': 'southern',
  makan: 'makan',
  'makan-moments': 'makan',
};

/**
 * Normalize a profile ID to its canonical short form.
 * Handles partial matches (data-makan → makan, southern-data → southern).
 * Defaults to 'pelangi' for unknown profiles.
 */
export function normalizeProfileId(profileId: string): string {
  const lower = profileId.toLowerCase();

  // Exact alias match first
  if (PROFILE_ALIASES[lower]) return PROFILE_ALIASES[lower];

  // Partial substring match
  if (lower.includes('pelangi')) return 'pelangi';
  if (lower.includes('makan')) return 'makan';
  if (lower.includes('southern')) return 'southern';

  return 'pelangi';
}

// ─── Recovery Messages ────────────────────────────────────────────────────────

/**
 * Profile × error-type specific recovery messages.
 * Each profile has tailored messaging that reflects their business context.
 */
/**
 * Return a profile-specific recovery message for the given error type.
 * Profile ID is normalized before lookup (e.g., "pelangi-capsule" → "pelangi").
 * Loads messages from profile-specific JSON files with fallback to English.
 */
export function getRecoveryMessage(errorType: string, profileId: string): string {
  const profile = normalizeProfileId(profileId);
  // Use the centralized error message loader from response-processor
  const message = getErrorMessage(errorType, profile);
  return message ?? 'We encountered a technical issue. Please contact our staff for assistance.';
}

// ─── Escalation Creation ──────────────────────────────────────────────────────

/**
 * Create an escalation event for a booking workflow step failure.
 * Captures structured error details and queues for staff review.
 */
export async function createStepFailureEscalation(options: {
  jid: string;
  profileId: string;
  stepId: string;
  workflowId: string;
  inputValues: Record<string, unknown>;
  error: Error | unknown;
  guestPhone: string;
  language?: string;
}): Promise<void> {
  try {
    const errorType = categorizeError(options.error);
    const errorMessage = options.error instanceof Error ? options.error.message : String(options.error);
    const recoveryMsg = getRecoveryMessage(errorType, options.profileId);

    const metadata = {
      error_type: errorType,
      error_message: errorMessage,
      step_id: options.stepId,
      workflow_id: options.workflowId,
      input_values: options.inputValues,
      guest_recovery_msg: recoveryMsg,
      staff_notes: `Booking step "${options.stepId}" failed in workflow "${options.workflowId}"`,
      captured_at: new Date().toISOString(),
      profile_id: options.profileId,
    };

    await db.insert(escalationEvents).values({
      jid: options.guestPhone,
      profileId: options.profileId,
      trigger: 'booking_step_failure',
      metadata: JSON.stringify(metadata),
      intentId: options.stepId,
      staffResolution: null,
      createdAt: new Date(),
    });

    console.log(
      `[StepErrorHandler] Created escalation for step "${options.stepId}" (profile: ${options.profileId}, error: ${errorType})`
    );
  } catch (err) {
    console.error('[StepErrorHandler] Failed to create escalation event:', err);
  }
}

// ─── Step Execution Wrapper ───────────────────────────────────────────────────

/**
 * Wraps workflow step execution with error recovery.
 * Returns structured result with recovery message and escalation logging.
 */
export async function executeWorkflowStepWithErrorRecovery(
  stepId: string,
  workflowId: string,
  profileId: string,
  phoneNumber: string,
  language: string,
  inputValues: Record<string, unknown>,
  executeFn: () => Promise<any>
): Promise<{ success: boolean; response: string; error?: string }> {
  try {
    const result = await executeFn();
    return {
      success: true,
      response: result?.response || 'Step completed successfully',
    };
  } catch (error) {
    await createStepFailureEscalation({
      jid: phoneNumber,
      profileId,
      stepId,
      workflowId,
      inputValues,
      error,
      guestPhone: phoneNumber,
      language,
    });

    const errorType = categorizeError(error);
    const recoveryMsg = getRecoveryMessage(errorType, profileId);

    console.error(
      `[StepErrorHandler] Step "${stepId}" failed:`,
      error instanceof Error ? error.message : error
    );

    return {
      success: false,
      response: recoveryMsg,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function categorizeError(error: Error | unknown): string {
  if (!error) return 'system_error';

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('timeout')) return 'system_error';
  if (lower.includes('payment')) return 'payment_failed';
  if (lower.includes('room') || lower.includes('unavailable')) return 'room_unavailable';
  if (lower.includes('date') || lower.includes('conflict')) return 'date_conflict';
  if (lower.includes('guest') || lower.includes('not found')) return 'guest_not_found';
  if (lower.includes('valid')) return 'validation_error';

  return 'system_error';
}
