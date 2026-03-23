/**
 * US-127: Booking workflow step precondition validator
 *
 * Validates preconditions before executing booking workflow steps.
 * Prevents invalid state transitions like payment without payment method,
 * or check-in for past dates.
 */

import type { WorkflowState } from '../workflow-executor.js';

export interface PreconditionViolation {
  step_id: string;
  required_precondition: string;
  reason: string;
}

/**
 * Evaluates a single precondition
 * @param precondition Precondition key to check
 * @param state Workflow state with collected data
 * @returns true if precondition is satisfied, false otherwise
 */
function evaluatePrecondition(
  precondition: string,
  state: WorkflowState
): boolean {
  const { collectedData, nodeOutputs } = state;

  switch (precondition) {
    case 'payment_method_provided':
      // Check if payment method is present in workflow data
      return !!(
        collectedData.payment_method ||
        collectedData.card_number ||
        collectedData.payment_details
      );

    case 'guest_verified':
      // Check if guest name exists (basic identification)
      return !!collectedData.guest_name;

    case 'checkin_date_not_past':
      // Check if check-in date is not in the past
      if (!collectedData.booking_dates_normalized) {
        return false;
      }
      try {
        const normalized = JSON.parse(collectedData.booking_dates_normalized);
        const checkInDate = new Date(normalized.checkIn);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return checkInDate >= today;
      } catch {
        return false;
      }

    case 'room_available':
      // Check if room has been selected or availability verified
      return !!(collectedData.unit_selected || nodeOutputs?.room_available === true || collectedData.room_confirmed === true);

    case 'booking_dates_collected':
      // Check if booking dates have been provided
      return !!(collectedData.booking_dates || collectedData.booking_dates_normalized);

    case 'guest_count_provided':
      // Check if guest count is provided
      return !!(collectedData.guest_count && parseInt(collectedData.guest_count) > 0);

    default:
      // Unknown precondition - treat as satisfied (fail-open approach)
      console.warn(`[PreconditionValidator] Unknown precondition: ${precondition}`);
      return true;
  }
}

/**
 * Validates booking workflow step preconditions
 *
 * @param step_id Step identifier from workflow node
 * @param preconditions Array of precondition keys to check
 * @param state Workflow execution state with collected data
 * @returns Array of precondition violations (empty if all preconditions met)
 */
export function validateBookingStepPreconditions(
  step_id: string,
  preconditions: string[],
  state: WorkflowState
): PreconditionViolation[] {
  const violations: PreconditionViolation[] = [];

  if (!preconditions || preconditions.length === 0) {
    return violations;
  }

  for (const precondition of preconditions) {
    const isSatisfied = evaluatePrecondition(precondition, state);

    if (!isSatisfied) {
      const violation: PreconditionViolation = {
        step_id,
        required_precondition: precondition,
        reason: `Precondition '${precondition}' not satisfied for step '${step_id}'`,
      };

      violations.push(violation);

      // Log violation with detailed context
      console.log(
        `[PreconditionValidator] Violation: step_id=${step_id} required_precondition=${precondition}`
      );
    }
  }

  return violations;
}

/**
 * Helper function to check if preconditions are met (boolean)
 * @returns true if all preconditions are satisfied, false otherwise
 */
export function arePreconditionsMet(
  step_id: string,
  preconditions: string[],
  state: WorkflowState
): boolean {
  const violations = validateBookingStepPreconditions(step_id, preconditions, state);
  return violations.length === 0;
}
