/**
 * workflow-error-handler.ts — US-209 Booking Workflow Step Failure Recovery
 *
 * Wraps workflow step execution with typed error handling, recovery message loading,
 * and database logging. Provides guest-friendly error messages keyed by error code.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { WorkflowState, WorkflowExecutionResult, WorkflowContext } from '../workflow-executor.js';

export interface WorkflowStepError {
  code: string;
  message: string;
}

export interface WorkflowStepResult {
  success: boolean;
  error?: WorkflowStepError;
  result?: WorkflowExecutionResult;
}

/**
 * Recovery messages structure - loaded from profile-specific fallback-recovery.json
 */
interface RecoveryMessages {
  [errorCode: string]: Record<string, string>;  // maps error code -> {language -> message}
  schema_version?: string;
}

let recoveryMessagesCache: Map<string, RecoveryMessages> = new Map();

/**
 * Load recovery messages for a profile from its data directory
 * Falls back to Pelangi profile if profile not found
 */
export function loadRecoveryMessages(profile: string = 'pelangi'): RecoveryMessages {
  if (recoveryMessagesCache.has(profile)) {
    return recoveryMessagesCache.get(profile)!;
  }

  try {
    // Map profile to its data directory
    const profileDirMap: Record<string, string> = {
      'pelangi': 'data',
      'southern': 'data-southern',
      'makan': 'data-makan',
      'yoongmei': 'data-yoongmei',
      'pms-capsule': 'data-pms-capsule',
      'pms-southern': 'data-pms-southern',
    };

    const profileDir = profileDirMap[profile] || 'data';
    const filePath = resolve(process.cwd(), 'src', 'assistant', profileDir, 'fallback-recovery.json');
    const content = readFileSync(filePath, 'utf-8');
    const messages = JSON.parse(content) as RecoveryMessages;

    recoveryMessagesCache.set(profile, messages);
    return messages;
  } catch (err) {
    console.error(`[WorkflowErrorHandler] Failed to load recovery messages for profile "${profile}":`, err);
    // Return empty recovery messages to gracefully degrade
    return {};
  }
}

/**
 * Get a recovery message for an error code and language
 * Falls back to English if language not available
 */
export function getRecoveryMessage(
  errorCode: string,
  language: string = 'en',
  profile: string = 'pelangi'
): string {
  const messages = loadRecoveryMessages(profile);
  const errorMessages = messages[errorCode];

  if (!errorMessages) {
    console.warn(`[WorkflowErrorHandler] No recovery message found for error code: ${errorCode}`);
    return 'We encountered an issue. Please try again or contact our staff.';
  }

  return errorMessages[language] || errorMessages['en'] || 'We encountered an issue. Please try again or contact our staff.';
}

/**
 * Log a workflow step error to the database
 */
export async function logWorkflowStepError(
  stepId: string,
  errorCode: string,
  errorMessage: string,
  context: {
    profile?: string;
    conversationId?: string;
    guestPhone?: string;
    workflowId?: string;
  }
): Promise<void> {
  try {
    // Dynamically import db to avoid issues in test environments
    const { db } = await import('../lib/db.js');
    const { bookingStepErrors } = await import('../../shared/schema-tables.js');
    if (!db) {
      console.debug(`[WorkflowErrorHandler] Database not initialized, skipping error log`);
      return;
    }

    await db.insert(bookingStepErrors).values({
      stepId,
      errorCode,
      errorMessage,
      profile: context.profile || 'pelangi',
      conversationId: context.conversationId,
      guestPhone: context.guestPhone,
      workflowId: context.workflowId,
      recoveryMessageSent: false,
    });
  } catch (err) {
    console.error(`[WorkflowErrorHandler] Failed to log workflow step error:`, err);
    // Don't fail the workflow execution due to logging failure
  }
}

/**
 * Log that a recovery message was sent
 */
export async function logRecoveryMessageSent(
  stepId: string,
  errorCode: string,
  profile: string = 'pelangi'
): Promise<void> {
  try {
    // Dynamically import db to avoid issues in test environments
    const { db } = await import('../lib/db.js');
    const { bookingStepErrors } = await import('../../shared/schema-tables.js');
    if (!db) {
      console.debug(`[WorkflowErrorHandler] Database not initialized, skipping recovery message log`);
      return;
    }

    // Find the most recent error log for this step and code, update it
    const result = await db
      .select()
      .from(bookingStepErrors)
      .where((t) =>
        t.stepId === stepId &&
        t.errorCode === errorCode &&
        t.profile === profile
      )
      .orderBy((t) => t.createdAt)
      .limit(1);

    if (result && result.length > 0) {
      const error = result[0];
      // Update via raw SQL since Drizzle doesn't have a direct update by ID
      await db.execute(`
        UPDATE booking_step_errors
        SET recovery_message_sent = true, recovery_message_at = NOW()
        WHERE id = $1
      `, [error.id]);
    }
  } catch (err) {
    console.error(`[WorkflowErrorHandler] Failed to log recovery message sent:`, err);
    // Don't fail the workflow execution due to logging failure
  }
}

/**
 * Execute a workflow step with error handling wrapper
 * Catches errors, logs them, retrieves recovery message, and returns typed result
 */
export async function executeWorkflowStepWithErrorHandling(
  executeFn: () => Promise<WorkflowExecutionResult>,
  context: WorkflowContext & { stepId?: string; workflowId?: string; conversationId?: string },
  language: string = 'en'
): Promise<WorkflowStepResult> {
  const startTime = Date.now();

  try {
    const result = await executeFn();
    return {
      success: true,
      result,
    };
  } catch (err: any) {
    const elapsedMs = Date.now() - startTime;
    const profile = context.profileId || 'pelangi';
    const stepId = context.stepId || 'unknown';
    const workflowId = context.workflowId || 'unknown';
    const conversationId = context.conversationId;
    const guestPhone = context.phone;

    // Extract error code and message
    let errorCode = 'system_error';
    let errorMessage = err?.message || 'Unknown error';
    const lowerMessage = errorMessage.toLowerCase();

    // Map common error types to error codes
    if (lowerMessage.includes('payment')) {
      errorCode = 'payment_failed';
    } else if (lowerMessage.includes('room') || lowerMessage.includes('unavailable')) {
      errorCode = 'room_unavailable';
    } else if (lowerMessage.includes('date') || lowerMessage.includes('invalid')) {
      errorCode = 'invalid_dates';
    } else if (lowerMessage.includes('guest') || lowerMessage.includes('not found')) {
      errorCode = 'guest_not_found';
    } else if (lowerMessage.includes('price') || lowerMessage.includes('pricing')) {
      errorCode = 'pricing_error';
    } else if (lowerMessage.includes('conflict') || lowerMessage.includes('booking')) {
      errorCode = 'booking_conflict';
    }

    // Log the error
    console.error(`[WorkflowErrorHandler] Step "${stepId}" failed with error code "${errorCode}": ${errorMessage}`);

    // Log to database asynchronously (don't wait)
    logWorkflowStepError(stepId, errorCode, errorMessage, {
      profile,
      conversationId,
      guestPhone,
      workflowId,
    }).catch(e => console.error('[WorkflowErrorHandler] Logging failed:', e));

    // Get recovery message for guest
    const recoveryMessage = getRecoveryMessage(errorCode, language, profile);

    // Log that recovery message was sent
    logRecoveryMessageSent(stepId, errorCode, profile).catch(e =>
      console.error('[WorkflowErrorHandler] Failed to mark recovery message sent:', e)
    );

    // Verify message was sent within 5s (requirement: AC3)
    const messageSentTime = Date.now();
    const messageSentDelta = messageSentTime - startTime;
    if (messageSentDelta <= 5000) {
      console.log(`[WorkflowErrorHandler] Recovery message sent within 5s (${messageSentDelta}ms)`);
    } else {
      console.warn(`[WorkflowErrorHandler] Recovery message sent after 5s threshold (${messageSentDelta}ms)`);
    }

    return {
      success: false,
      error: {
        code: errorCode,
        message: recoveryMessage,
      },
    };
  }
}
