/**
 * US-555: Booking Workflow Step Auto-Progression with User Confirmation
 *
 * Provides advanceBookingStep() which checks whether a user message is a
 * confirmation phrase and, if so, automatically transitions the booking state
 * to the next step in the flow.
 *
 * Supported confirmation phrases: /confirm|yes|proceed/i
 * Step order: dates -> guests -> confirm -> done
 */

import type { BookingState, BookingStage } from '../types.js';
import { incrementStarted, incrementCompleted } from '../../lib/workflow-metrics.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Regex matching user confirmation messages for auto-progression */
export const CONFIRMATION_REGEX = /confirm|yes|proceed/i;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BookingStep {
  /** Workflow step ID (matches workflows.json) */
  id: string;
  /** BookingState.stage when this step is active */
  stage: BookingStage;
  /** Next stage to transition to on confirmation */
  nextStage: BookingStage | null;
  /** Whether this step supports auto-progression */
  autoProgress: boolean;
}

export interface AdvanceResult {
  /** Whether the step was advanced */
  advanced: boolean;
  /** Updated booking state (unchanged if advanced=false) */
  newState: BookingState;
  /** The next step definition, or null if no further steps */
  nextStep: BookingStep | null;
}

// ─── Step Definitions ──────────────────────────────────────────────────────

/**
 * Ordered booking step definitions with auto-progression flags.
 * Matches the "booking" workflow in workflows.json.
 */
export const BOOKING_STEPS: BookingStep[] = [
  {
    id: 'select_checkin_date',
    stage: 'dates',
    nextStage: 'guests',
    autoProgress: true,
  },
  {
    id: 'select_guest_count',
    stage: 'guests',
    nextStage: 'confirm',
    autoProgress: true,
  },
  {
    id: 'booking_confirmation',
    stage: 'confirm',
    nextStage: 'done',
    autoProgress: true,
  },
];

// ─── Core Function ─────────────────────────────────────────────────────────

/**
 * Map BookingState.stage to workflow step name for metrics
 */
function stageToStepName(stage: BookingStage): string {
  switch (stage) {
    case 'dates':
      return 'date_selection';
    case 'guests':
      return 'guest_info';
    case 'confirm':
      return 'confirmation';
    default:
      return 'unknown';
  }
}

/**
 * Attempts to advance the booking workflow to the next step.
 *
 * Checks the user message against CONFIRMATION_REGEX. If it matches and the
 * current stage has autoProgress=true, transitions the state to the next stage.
 *
 * @param message - The raw user message text
 * @param currentState - Current booking state
 * @param profileId - Profile ID for metrics tracking (optional)
 * @returns AdvanceResult with advanced flag, new state, and next step info
 */
export function advanceBookingStep(
  message: string,
  currentState: BookingState,
  profileId?: string
): AdvanceResult {
  const noAdvance: AdvanceResult = {
    advanced: false,
    newState: currentState,
    nextStep: null,
  };

  // Check if message is a confirmation phrase
  if (!CONFIRMATION_REGEX.test(message)) {
    return noAdvance;
  }

  // Find the current step definition
  const currentStep = BOOKING_STEPS.find(step => step.stage === currentState.stage);
  if (!currentStep || !currentStep.autoProgress || currentStep.nextStage === null) {
    return noAdvance;
  }

  // Track step completion (US-569)
  const currentStepName = stageToStepName(currentState.stage);
  const profile = profileId || 'pelangi';
  incrementCompleted(profile, currentStepName);

  // Transition to next stage
  const newState: BookingState = { ...currentState, stage: currentStep.nextStage };
  const nextStep = BOOKING_STEPS.find(step => step.stage === currentStep.nextStage) ?? null;

  // Track next step start (US-569)
  const nextStepName = stageToStepName(currentStep.nextStage);
  incrementStarted(profile, nextStepName);

  return {
    advanced: true,
    newState,
    nextStep,
  };
}

/**
 * Returns whether a workflow step has auto-progression enabled by looking up
 * its step ID in the BOOKING_STEPS list.
 */
export function isAutoProgressStep(stepId: string): boolean {
  return BOOKING_STEPS.some(step => step.id === stepId && step.autoProgress);
}
