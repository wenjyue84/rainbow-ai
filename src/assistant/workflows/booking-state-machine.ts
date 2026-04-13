/**
 * US-545: Booking Workflow State Machine
 *
 * Defines valid state transitions for booking workflows.
 * Enforces that workflows follow a logical sequence (e.g., collect_dates -> confirm_details)
 * instead of skipping steps or allowing arbitrary transitions.
 */

/**
 * Defines allowed next steps for each booking workflow step.
 * Key: current step ID
 * Value: array of allowed next step IDs
 *
 * Example: collect_dates can only transition to confirm_details,
 * not to payment_info or booking_confirmed (skipping steps).
 */
export const BOOKING_TRANSITIONS: Record<string, string[]> = {
  // Initial step: only transition to next step
  'collect_dates': ['confirm_details'],

  // Confirmation step: can go to payment or back to collect dates
  'confirm_details': ['payment_info', 'collect_dates'],

  // Payment step: only to booking confirmation
  'payment_info': ['booking_confirmed'],

  // Booking confirmed: final step, no further transitions
  'booking_confirmed': [],

  // Verification code workflow
  'generate_code': ['verify_code', 'verification_failed'],
  'verify_code': ['booking_confirmed'],
  'verification_failed': ['collect_dates'],

  // Escalation workflow - no transitions
  'notify': [],

  // Check availability step
  'check_availability': ['collect_dates', 'confirm_details'],

  // Final step
  'final_confirmation': [],
};

/**
 * Validates whether a transition from currentStep to nextStep is allowed.
 *
 * @param currentStep - The ID of the current workflow step (e.g., 'collect_dates')
 * @param nextStep - The ID of the next step (e.g., 'confirm_details')
 * @returns true if the transition is allowed, false otherwise
 *
 * Edge cases:
 * - null/undefined currentStep: treated as invalid (no transitions allowed)
 * - null/undefined nextStep: treated as invalid
 * - unknown step IDs: treated as invalid (fail-safe)
 */
export function isValidTransition(currentStep: string | null | undefined, nextStep: string | null | undefined): boolean {
  // Edge case: missing current step
  if (!currentStep || typeof currentStep !== 'string') {
    return false;
  }

  // Edge case: missing next step
  if (!nextStep || typeof nextStep !== 'string') {
    return false;
  }

  // Check if current step exists in state machine
  const allowedNextSteps = BOOKING_TRANSITIONS[currentStep];
  if (!allowedNextSteps) {
    // Unknown step — fail-safe (reject)
    return false;
  }

  // Check if next step is in the allowed list
  return allowedNextSteps.includes(nextStep);
}

/**
 * Helper: Get allowed next steps for a given current step.
 * Returns empty array if step is unknown or has no further transitions.
 *
 * @param currentStep - The current step ID
 * @returns Array of allowed next step IDs, or empty array if none
 */
export function getAllowedNextSteps(currentStep: string): string[] {
  if (!currentStep || !BOOKING_TRANSITIONS[currentStep]) {
    return [];
  }
  return BOOKING_TRANSITIONS[currentStep];
}

/**
 * Helper: Check if a step is a terminal step (no further transitions).
 *
 * @param stepId - The step ID to check
 * @returns true if this is the final step of the workflow
 */
export function isTerminalStep(stepId: string): boolean {
  const allowedNext = getAllowedNextSteps(stepId);
  return allowedNext.length === 0;
}
