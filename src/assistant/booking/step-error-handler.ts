/**
 * step-error-handler.ts — US-352 Booking Workflow Step Failure Recovery
 *
 * Handles booking workflow step execution failures with:
 * - Structured error capture (step name, input values, error type)
 * - Profile-aware recovery message generation
 * - Automatic escalation event creation for staff review
 */

import { db } from '../../lib/db.js';
import { escalationEvents } from '../../shared/schema-tables.js';

/**
 * Profile-specific recovery messages for booking step failures
 * Each profile has a tailored message that reflects their business context
 */
const PROFILE_RECOVERY_MESSAGES: Record<string, Record<string, string>> = {
  pelangi: {
    en: "I couldn't confirm your booking. Our front desk will call you shortly to complete the reservation.",
    ms: "Saya tidak dapat mengesahkan tempahan anda. Meja hadapan kami akan menghubungi anda tidak lama lagi untuk menyelesaikan tempahan.",
    zh: "我无法确认您的预订。我们的前台将很快给您打电话完成预订。",
  },
  southern: {
    en: "I couldn't confirm your booking. Our team will reach out to you shortly to complete the reservation.",
    ms: "Saya tidak dapat mengesahkan tempahan anda. Pasukan kami akan menghubungi anda tidak lama lagi untuk menyelesaikan tempahan.",
    zh: "我无法确认您的预订。我们的团队将很快与您联系完成预订。",
  },
  makan: {
    en: "Unable to process your order. Our staff will follow up with you shortly to confirm.",
    ms: "Tidak dapat memproses pesanan anda. Kakitangan kami akan menghubungi anda tidak lama lagi untuk mengesahkan.",
    zh: "无法处理您的订单。我们的工作人员将很快与您联系确认。",
  },
};

/**
 * Maps error types to human-readable error codes for structured logging
 */
function categorizeError(error: Error | unknown): string {
  if (!error) return 'unknown_error';

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('timeout')) return 'step_timeout';
  if (lower.includes('payment')) return 'payment_failed';
  if (lower.includes('room') || lower.includes('unavailable')) return 'room_unavailable';
  if (lower.includes('date') || lower.includes('invalid')) return 'invalid_dates';
  if (lower.includes('guest') || lower.includes('not found')) return 'guest_not_found';
  if (lower.includes('price')) return 'pricing_error';
  if (lower.includes('conflict') || lower.includes('booking')) return 'booking_conflict';
  if (lower.includes('network')) return 'network_error';
  if (lower.includes('database')) return 'database_error';

  return 'system_error';
}

/**
 * Get profile-specific recovery message for a booking step failure
 */
export function getProfileRecoveryMessage(
  profileId: string,
  language: string = 'en'
): string {
  const messages = PROFILE_RECOVERY_MESSAGES[profileId] || PROFILE_RECOVERY_MESSAGES.pelangi;
  return messages[language as keyof typeof messages] || messages.en;
}

/**
 * Create an escalation event for a booking workflow step failure
 * Captures structured error details and queues for staff review
 */
export async function createStepFailureEscalation(options: {
  jid: string;  // Guest phone number (JID format)
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
    const recoveryMsg = getProfileRecoveryMessage(options.profileId, options.language);

    // Structured metadata for staff review
    const metadata = {
      error_type: errorType,
      error_message: errorMessage,
      step_id: options.stepId,
      workflow_id: options.workflowId,
      input_values: options.inputValues,
      captured_at: new Date().toISOString(),
      profile_id: options.profileId,
    };

    // Log to escalation_events table
    await db.insert(escalationEvents).values({
      jid: options.guestPhone,
      profileId: options.profileId,
      trigger: 'booking_step_failure',
      metadata: JSON.stringify(metadata),
      intentId: options.stepId,
      staffResolution: null, // Staff will fill this in when they resolve
      createdAt: new Date(),
    });

    console.log(
      `[StepErrorHandler] Created escalation for step "${options.stepId}" (profile: ${options.profileId}, error: ${errorType})`
    );
  } catch (err) {
    console.error('[StepErrorHandler] Failed to create escalation event:', err);
    // Don't fail the workflow due to logging failure
  }
}

/**
 * Wraps workflow step execution with error recovery
 * Returns structured result with recovery message and escalation logging
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
    // Capture error and create escalation
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

    // Generate profile-aware recovery message for guest
    const recoveryMsg = getProfileRecoveryMessage(profileId, language);

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
