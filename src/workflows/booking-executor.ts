/**
 * Booking Workflow Step Executor with Circuit Breaker
 *
 * Wraps booking workflow step execution with circuit breaker protection
 * for external service calls (payment processing, availability checks).
 * When circuit is OPEN, escalates to manual processing with graceful message.
 */

import { bookingWorkflowCircuitBreakerRegistry, CircuitState } from './circuit-breaker.js';
import { createStepFailureEscalation } from '../assistant/booking/step-error-handler.js';

export interface WorkflowStepExecutionContext {
  stepId: string;
  stepName: string;
  workflowId: string;
  profileId: string;
  jid: string;
  guestPhone: string;
  language: string;
  inputValues: Record<string, unknown>;
  isExternalServiceCall?: boolean; // Whether this step calls an external service
}

export interface WorkflowStepExecutionResult {
  success: boolean;
  response: string;
  circuitState?: CircuitState;
  escalated?: boolean;
  error?: string;
}

/**
 * Execute a booking workflow step with circuit breaker protection.
 * If the step makes external service calls and the circuit is OPEN,
 * escalates to manual processing instead of failing.
 */
export async function executeBookingWorkflowStep(
  context: WorkflowStepExecutionContext,
  executeFn: () => Promise<any>
): Promise<WorkflowStepExecutionResult> {
  const { stepId, stepName, workflowId, profileId, jid, guestPhone, language, inputValues, isExternalServiceCall = true } = context;

  // Only use circuit breaker for external service calls
  if (!isExternalServiceCall) {
    try {
      const result = await executeFn();
      return {
        success: true,
        response: result?.response || `${stepName} completed successfully`,
      };
    } catch (error) {
      await createStepFailureEscalation({
        jid: guestPhone,
        profileId,
        stepId,
        workflowId,
        inputValues,
        error,
        guestPhone,
        language,
      });

      return {
        success: false,
        response: 'We encountered a technical issue. Please contact our staff for assistance.',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Circuit breaker logic for external service calls
  const breaker = bookingWorkflowCircuitBreakerRegistry.getOrCreate(stepId);
  const circuitState = breaker.getCurrentState();

  // If circuit is open, escalate to manual processing
  if (breaker.isOpen()) {
    const status = breaker.getStatus();
    console.log(
      `[BookingExecutor] Circuit OPEN for step "${stepId}", escalating to manual (cooldown: ${status.cooldownRemaining}ms)`
    );

    // Create escalation for manual processing
    await createStepFailureEscalation({
      jid: guestPhone,
      profileId,
      stepId,
      workflowId,
      inputValues,
      error: new Error(`Circuit breaker OPEN - escalating to manual processing (failure count: ${status.failureCount})`),
      guestPhone,
      language,
    });

    return {
      success: false,
      response: 'Please wait while we check availability manually. A staff member will contact you shortly.',
      circuitState: CircuitState.OPEN,
      escalated: true,
    };
  }

  // Execute the step with circuit breaker tracking
  try {
    const result = await executeFn();
    breaker.recordSuccess();

    return {
      success: true,
      response: result?.response || `${stepName} completed successfully`,
      circuitState: breaker.getCurrentState(),
    };
  } catch (error) {
    breaker.recordFailure();
    const status = breaker.getStatus();

    console.error(
      `[BookingExecutor] Step "${stepId}" failed (${status.failureCount}/${breaker['config']?.failureThreshold ?? 3} failures):`,
      error instanceof Error ? error.message : error
    );

    // Create escalation for the failure
    await createStepFailureEscalation({
      jid: guestPhone,
      profileId,
      stepId,
      workflowId,
      inputValues,
      error,
      guestPhone,
      language,
    });

    // If circuit just opened, inform user about manual escalation
    if (status.state === CircuitState.OPEN) {
      return {
        success: false,
        response: 'Please wait while we check availability manually. A staff member will contact you shortly.',
        circuitState: CircuitState.OPEN,
        escalated: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      success: false,
      response: 'We encountered a technical issue. Please contact our staff for assistance.',
      circuitState: status.state,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Reset circuit breaker for a specific booking step (admin operation)
 */
export function resetBookingStepCircuitBreaker(stepId: string): void {
  bookingWorkflowCircuitBreakerRegistry.reset(stepId);
  console.log(`[BookingExecutor] Circuit breaker reset for step "${stepId}"`);
}

/**
 * Get status of all booking workflow circuit breakers
 */
export function getAllBookingCircuitBreakerStatuses(): Record<string, any> {
  return bookingWorkflowCircuitBreakerRegistry.getAllStatuses();
}
