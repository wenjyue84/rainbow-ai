/**
 * booking-state.ts — Booking State Machine Transition Validator (US-312)
 *
 * Validates booking state transitions against a defined state machine.
 * Audits every transition attempt to catch workflow bugs and malformed
 * step sequences before they cause booking failures.
 *
 * Valid paths:
 *   pending -> confirmed -> checked_in -> checked_out
 *   Any state -> cancelled (cancellation branch)
 */

import { db } from '../../lib/db.js';
import { bookingStateAudit } from '../../../shared/schema-tables.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('booking-state');

// ─── Types ───────────────────────────────────────────────────────────

export type BookingTransitionState =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled';

export interface TransitionResult {
  valid: boolean;
  reason: string;
}

// ─── State Machine Definition ────────────────────────────────────────

/**
 * Maps each state to its set of valid next states.
 * The happy path is: pending -> confirmed -> checked_in -> checked_out
 * Cancellation is allowed from any non-terminal state.
 */
const VALID_TRANSITIONS: Record<BookingTransitionState, Set<BookingTransitionState>> = {
  pending:     new Set(['confirmed', 'cancelled']),
  confirmed:   new Set(['checked_in', 'cancelled']),
  checked_in:  new Set(['checked_out', 'cancelled']),
  checked_out: new Set([]),   // terminal state — no further transitions
  cancelled:   new Set([]),   // terminal state — no further transitions
};

const ALL_STATES = new Set<string>(Object.keys(VALID_TRANSITIONS));

// ─── Validator ───────────────────────────────────────────────────────

/**
 * Validates whether a booking state transition is allowed by the state machine.
 *
 * @param fromState - Current booking state
 * @param toState   - Desired next state
 * @param profile   - Property profile (e.g. 'pelangi', 'southern')
 * @returns TransitionResult indicating validity and reason
 */
export function validateBookingTransition(
  fromState: string,
  toState: string,
  profile: string,
): TransitionResult {
  // Validate fromState is a known state
  if (!ALL_STATES.has(fromState)) {
    return {
      valid: false,
      reason: `Unknown source state: '${fromState}'`,
    };
  }

  // Validate toState is a known state
  if (!ALL_STATES.has(toState)) {
    return {
      valid: false,
      reason: `Unknown target state: '${toState}'`,
    };
  }

  // Self-transitions are not valid
  if (fromState === toState) {
    return {
      valid: false,
      reason: `Self-transition not allowed: '${fromState}' -> '${toState}'`,
    };
  }

  const typedFrom = fromState as BookingTransitionState;
  const typedTo = toState as BookingTransitionState;
  const allowed = VALID_TRANSITIONS[typedFrom];

  if (allowed.has(typedTo)) {
    return {
      valid: true,
      reason: `Valid transition: '${fromState}' -> '${toState}'`,
    };
  }

  // Terminal state check for clearer messaging
  if (allowed.size === 0) {
    return {
      valid: false,
      reason: `Cannot transition from terminal state '${fromState}'`,
    };
  }

  return {
    valid: false,
    reason: `Invalid transition: '${fromState}' -> '${toState}'. Allowed from '${fromState}': ${[...allowed].join(', ')}`,
  };
}

// ─── Audit Logger ────────────────────────────────────────────────────

/**
 * Logs a booking state transition attempt to the booking_state_audit table.
 * Validates the transition and records the result.
 *
 * @param bookingId - Unique booking identifier
 * @param fromState - Current booking state
 * @param toState   - Desired next state
 * @param profile   - Property profile
 * @returns TransitionResult from the validation
 */
export async function auditBookingTransition(
  bookingId: string,
  fromState: string,
  toState: string,
  profile: string,
): Promise<TransitionResult> {
  const result = validateBookingTransition(fromState, toState, profile);

  try {
    await db.insert(bookingStateAudit).values({
      bookingId,
      fromState,
      toState,
      valid: result.valid,
      reason: result.reason,
      profile,
    });

    logger.info(
      `[BookingState] ${result.valid ? 'VALID' : 'INVALID'} transition: ` +
      `${fromState} -> ${toState} (booking=${bookingId}, profile=${profile})`,
    );
  } catch (error: any) {
    logger.error(
      `[BookingState] Failed to audit transition: ${error.message}`,
      { bookingId, fromState, toState, profile },
    );
  }

  return result;
}
