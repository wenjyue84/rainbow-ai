/**
 * booking-failure-logger.ts — US-226
 *
 * Logs booking intent classification failures when confidence < 0.65.
 * Fire-and-forget: errors are caught and logged but never thrown.
 */
import { db } from '../lib/db.js';
import { bookingClassificationFailures } from '../../shared/schema.js';

/** Intent categories that are booking-related. */
export const BOOKING_INTENT_CATEGORIES = new Set([
  'booking', 'availability', 'pricing', 'payment_info', 'payment_made',
  'checkin_info', 'checkout_info', 'check_in_arrival', 'checkout_procedure',
  'late_checkout_request', 'billing_inquiry', 'billing_dispute',
  'lower_deck_preference', 'payment',
]);

/** Confidence below which a booking intent classification is logged as a failure. */
export const BOOKING_FAILURE_THRESHOLD = 0.65;

export interface Candidate {
  intent: string;
  confidence: number;
}

/**
 * Logs a booking classification failure to the database.
 * Called when the top classified intent is booking-related but confidence < 0.65.
 */
export async function logBookingClassificationFailure(opts: {
  rawInput: string;
  profileId: string;
  top3Candidates: Candidate[];
  messageId?: string;
}): Promise<void> {
  try {
    await db.insert(bookingClassificationFailures).values({
      rawInput: opts.rawInput,
      profileId: opts.profileId,
      top3Candidates: opts.top3Candidates,
      ...(opts.messageId ? { messageId: opts.messageId } : {}),
    });
  } catch (err: any) {
    console.error('[BookingFailureLogger] Insert failed:', err.message);
  }
}
