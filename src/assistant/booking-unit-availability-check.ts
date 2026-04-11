/**
 * US-470: Booking Unit Availability Check
 *
 * Pre-flight validation that booking units exist in profile-specific data
 * and are available for requested dates before workflow execution.
 *
 * Called by workflow-executor.ts before step 1 of booking workflows
 * to prevent invalid bookings and ensure profile isolation.
 */

import { preFlightUnitCheck, type BookingUnitPreflightResult } from './booking-unit-preflight.js';
import type { WorkflowState } from './workflow-executor.js';

export interface BookingUnitAvailabilityResult {
  available: boolean;
  escalation_reason?: string;
  errors: string[];
}

/**
 * Check booking unit availability before workflow execution.
 *
 * Extracts unit_id, profile, check_in_date, and check_out_date from the
 * workflow state's collected data and validates against profile-specific units.
 *
 * @param state - Current workflow state with collectedData
 * @param profileId - The profile ID (pelangi, southern, etc.)
 * @returns Availability result with escalation_reason='unit_unavailable' if invalid
 */
export async function checkBookingUnitAvailability(
  state: WorkflowState,
  profileId?: string
): Promise<BookingUnitAvailabilityResult> {
  const collected = state.collectedData || {};

  const unitId = collected.unit_id || collected.roomId || collected.room_id;
  const profile = profileId || collected.profile || 'pelangi';
  const checkInDate = collected.check_in_date || collected.checkIn || collected.checkInDate;
  const checkOutDate = collected.check_out_date || collected.checkOut || collected.checkOutDate;

  // If no unit_id is collected yet, skip validation (unit will be assigned later)
  if (!unitId) {
    return { available: true, errors: [] };
  }

  const preflight: BookingUnitPreflightResult = await preFlightUnitCheck(
    unitId,
    profile,
    checkInDate,
    checkOutDate
  );

  return {
    available: preflight.valid,
    escalation_reason: preflight.escalationReason,
    errors: preflight.errors,
  };
}
