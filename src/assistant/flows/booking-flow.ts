/**
 * US-408: BookingFlow — Adapter wrapping existing booking logic as a Flow.
 *
 * Delegates to handleBookingStep/createBookingState from ../booking.ts.
 */
import type { Flow, FlowContext, FlowStepResult } from '../pipeline/types.js';
import type { BookingState } from '../types.js';
import { handleBookingStep, createBookingState } from '../booking.js';

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
    const result = await handleBookingStep(
      state,
      userMessage,
      context.language,
      context.messages
    );
    return {
      response: result.response,
      newState: result.newState,
    };
  },

  isComplete(state: BookingState): boolean {
    return ['done', 'cancelled'].includes(state.stage);
  },
};
