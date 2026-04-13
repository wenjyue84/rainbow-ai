/**
 * US-408: BookingFlow — Adapter wrapping existing booking logic as a Flow.
 * US-569: Booking Workflow Step Completion Rate Tracking
 *
 * Delegates to handleBookingStep/createBookingState from ../booking.ts.
 * Tracks step metrics via WorkflowMetrics functions.
 */
import type { Flow, FlowContext, FlowStepResult } from '../pipeline/types.js';
import type { BookingState } from '../types.js';
import { handleBookingStep, createBookingState } from '../booking.js';
import { incrementStarted, incrementCompleted, normalizeProfileName } from '../../lib/workflow-metrics.js';

export const bookingFlow: Flow = {
  type: 'booking',

  async start(context: FlowContext, initialInput?: string | null): Promise<FlowStepResult> {
    const state = createBookingState();
    const result = await handleBookingStep(
      state,
      initialInput || '',
      context.language,
      context.messages
    );
    return {
      response: result.response,
      newState: result.newState,
    };
  },

  async executeStep(state: BookingState, userMessage: string, context: FlowContext): Promise<FlowStepResult> {
    // US-569: Track workflow step metrics
    const profileId = normalizeProfileName(context.profileId || 'unknown');

    // Map BookingState.stage to workflow step names
    let workflowStep: string;
    switch (state.stage) {
      case 'dates':
        workflowStep = 'date_selection';
        break;
      case 'guests':
        workflowStep = 'guest_info';
        break;
      case 'confirm':
        workflowStep = 'confirmation';
        break;
      default:
        // For inquiry, save_sale, done, cancelled — don't track metrics
        workflowStep = '';
    }

    // Only track metrics for main workflow steps
    if (workflowStep) {
      incrementStarted(profileId, workflowStep);
    }

    const result = await handleBookingStep(
      state,
      userMessage,
      context.language,
      context.messages
    );

    // Increment step_completed counter if execution was successful
    if (workflowStep) {
      incrementCompleted(profileId, workflowStep);
    }

    return {
      response: result.response,
      newState: result.newState,
    };
  },

  isComplete(state: BookingState): boolean {
    return ['done', 'cancelled'].includes(state.stage);
  },
};
