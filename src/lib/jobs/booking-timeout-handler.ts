/**
 * US-558: Booking Workflow Timeout Handler
 *
 * BullMQ job handler for booking workflow timeouts.
 * When a job executes (after 60 minutes delay), it resets the booking workflow
 * to initial state and logs the reset event.
 */

import type { Job } from 'bullmq';
import { resetWorkflowState } from '../../assistant/workflows/booking-workflow.js';

export interface BookingTimeoutJobData {
  bookingId: string;
  profile?: string;
}

/**
 * Handler for booking timeout job.
 * Called by BullMQ worker when a job is ready to process.
 * Resets the workflow and logs the reset event.
 *
 * @param job - BullMQ job with booking timeout data
 */
export async function handleBookingTimeout(job: Job<BookingTimeoutJobData>): Promise<void> {
  const { bookingId, profile = 'pelangi' } = job.data;

  try {
    console.log(
      `[BookingTimeoutHandler] Processing timeout for booking "${bookingId}"`
    );

    // Reset the workflow state to initial step (0)
    await resetWorkflowState(bookingId, 'timeout', profile);

    console.log(
      `[BookingTimeoutHandler] Successfully reset workflow for booking "${bookingId}"`
    );
  } catch (error) {
    console.error(
      `[BookingTimeoutHandler] Failed to process timeout for booking "${bookingId}":`,
      error
    );
    // Re-throw to mark job as failed
    throw new Error(
      `Failed to reset workflow for booking "${bookingId}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
