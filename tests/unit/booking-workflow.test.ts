/**
 * US-555: Booking Workflow Step Auto-Progression with User Confirmation
 *
 * Integration test verifying the booking flow progresses through
 * steps 1→2→3 using confirmation messages.
 */

import { describe, it, expect } from 'vitest';
import {
  advanceBookingStep,
  isAutoProgressStep,
  BOOKING_STEPS,
  CONFIRMATION_REGEX,
} from '../../src/assistant/pipeline/booking-processor.js';
import type { BookingState } from '../../src/assistant/types.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const stateAtDates: BookingState = { stage: 'dates', checkIn: '2026-12-25', checkOut: '2026-12-28' };
const stateAtGuests: BookingState = { stage: 'guests', checkIn: '2026-12-25', checkOut: '2026-12-28', guests: 2 };
const stateAtConfirm: BookingState = { stage: 'confirm', checkIn: '2026-12-25', checkOut: '2026-12-28', guests: 2 };

// ─── CONFIRMATION_REGEX tests ──────────────────────────────────────────────

describe('CONFIRMATION_REGEX', () => {
  it('matches "yes"', () => expect(CONFIRMATION_REGEX.test('yes')).toBe(true));
  it('matches "Yes" (case-insensitive)', () => expect(CONFIRMATION_REGEX.test('Yes')).toBe(true));
  it('matches "confirm"', () => expect(CONFIRMATION_REGEX.test('confirm')).toBe(true));
  it('matches "CONFIRM"', () => expect(CONFIRMATION_REGEX.test('CONFIRM')).toBe(true));
  it('matches "proceed"', () => expect(CONFIRMATION_REGEX.test('proceed')).toBe(true));
  it('matches message containing "yes"', () => expect(CONFIRMATION_REGEX.test('yes please')).toBe(true));
  it('does not match "no"', () => expect(CONFIRMATION_REGEX.test('no')).toBe(false));
  it('does not match "cancel"', () => expect(CONFIRMATION_REGEX.test('cancel')).toBe(false));
  it('does not match empty string', () => expect(CONFIRMATION_REGEX.test('')).toBe(false));
});

// ─── BOOKING_STEPS config ──────────────────────────────────────────────────

describe('BOOKING_STEPS', () => {
  it('has 3 steps', () => expect(BOOKING_STEPS).toHaveLength(3));

  it('step 1 is select_checkin_date with autoProgress=true', () => {
    expect(BOOKING_STEPS[0].id).toBe('select_checkin_date');
    expect(BOOKING_STEPS[0].stage).toBe('dates');
    expect(BOOKING_STEPS[0].nextStage).toBe('guests');
    expect(BOOKING_STEPS[0].autoProgress).toBe(true);
  });

  it('step 2 is select_guest_count with autoProgress=true', () => {
    expect(BOOKING_STEPS[1].id).toBe('select_guest_count');
    expect(BOOKING_STEPS[1].stage).toBe('guests');
    expect(BOOKING_STEPS[1].nextStage).toBe('confirm');
    expect(BOOKING_STEPS[1].autoProgress).toBe(true);
  });

  it('step 3 is booking_confirmation with autoProgress=true', () => {
    expect(BOOKING_STEPS[2].id).toBe('booking_confirmation');
    expect(BOOKING_STEPS[2].stage).toBe('confirm');
    expect(BOOKING_STEPS[2].nextStage).toBe('done');
    expect(BOOKING_STEPS[2].autoProgress).toBe(true);
  });
});

// ─── isAutoProgressStep ────────────────────────────────────────────────────

describe('isAutoProgressStep', () => {
  it('returns true for select_checkin_date', () => {
    expect(isAutoProgressStep('select_checkin_date')).toBe(true);
  });
  it('returns true for select_guest_count', () => {
    expect(isAutoProgressStep('select_guest_count')).toBe(true);
  });
  it('returns true for booking_confirmation', () => {
    expect(isAutoProgressStep('booking_confirmation')).toBe(true);
  });
  it('returns false for unknown step', () => {
    expect(isAutoProgressStep('unknown_step')).toBe(false);
  });
});

// ─── advanceBookingStep ────────────────────────────────────────────────────

describe('advanceBookingStep', () => {
  describe('non-confirmation messages', () => {
    it('does not advance when message is "no"', () => {
      const result = advanceBookingStep('no', stateAtDates);
      expect(result.advanced).toBe(false);
      expect(result.newState.stage).toBe('dates');
    });

    it('does not advance when message is empty', () => {
      const result = advanceBookingStep('', stateAtDates);
      expect(result.advanced).toBe(false);
    });

    it('does not advance when message is arbitrary text', () => {
      const result = advanceBookingStep('what is the price?', stateAtDates);
      expect(result.advanced).toBe(false);
    });
  });

  describe('confirmation: step 1 dates -> guests', () => {
    it('advances with "yes"', () => {
      const result = advanceBookingStep('yes', stateAtDates);
      expect(result.advanced).toBe(true);
      expect(result.newState.stage).toBe('guests');
    });

    it('advances with "confirm"', () => {
      const result = advanceBookingStep('confirm', stateAtDates);
      expect(result.advanced).toBe(true);
      expect(result.newState.stage).toBe('guests');
    });

    it('advances with "proceed"', () => {
      const result = advanceBookingStep('proceed', stateAtDates);
      expect(result.advanced).toBe(true);
      expect(result.newState.stage).toBe('guests');
    });

    it('preserves existing state fields when advancing', () => {
      const result = advanceBookingStep('yes', stateAtDates);
      expect(result.newState.checkIn).toBe('2026-12-25');
      expect(result.newState.checkOut).toBe('2026-12-28');
    });

    it('returns nextStep pointing to select_guest_count', () => {
      const result = advanceBookingStep('yes', stateAtDates);
      expect(result.nextStep?.id).toBe('select_guest_count');
    });
  });

  describe('confirmation: step 2 guests -> confirm', () => {
    it('advances with "yes"', () => {
      const result = advanceBookingStep('yes', stateAtGuests);
      expect(result.advanced).toBe(true);
      expect(result.newState.stage).toBe('confirm');
    });

    it('advances with "confirm"', () => {
      const result = advanceBookingStep('confirm', stateAtGuests);
      expect(result.advanced).toBe(true);
      expect(result.newState.stage).toBe('confirm');
    });

    it('returns nextStep pointing to booking_confirmation', () => {
      const result = advanceBookingStep('yes', stateAtGuests);
      expect(result.nextStep?.id).toBe('booking_confirmation');
    });
  });

  describe('confirmation: step 3 confirm -> done', () => {
    it('advances with "yes"', () => {
      const result = advanceBookingStep('yes', stateAtConfirm);
      expect(result.advanced).toBe(true);
      expect(result.newState.stage).toBe('done');
    });

    it('advances with "proceed"', () => {
      const result = advanceBookingStep('proceed', stateAtConfirm);
      expect(result.advanced).toBe(true);
      expect(result.newState.stage).toBe('done');
    });

    it('returns null nextStep (no more steps)', () => {
      const result = advanceBookingStep('confirm', stateAtConfirm);
      expect(result.nextStep).toBeNull();
    });
  });

  describe('no progression from terminal/non-booking stages', () => {
    it('does not advance from done stage', () => {
      const doneState: BookingState = { stage: 'done' };
      const result = advanceBookingStep('yes', doneState);
      expect(result.advanced).toBe(false);
    });

    it('does not advance from cancelled stage', () => {
      const cancelledState: BookingState = { stage: 'cancelled' };
      const result = advanceBookingStep('confirm', cancelledState);
      expect(result.advanced).toBe(false);
    });

    it('does not advance from inquiry stage (no autoProgress step at inquiry)', () => {
      const inquiryState: BookingState = { stage: 'inquiry' };
      const result = advanceBookingStep('yes', inquiryState);
      expect(result.advanced).toBe(false);
    });
  });
});

// ─── Integration: 3-step sequential flow ──────────────────────────────────

describe('Integration: booking flow progresses step 1→2→3 with confirmations', () => {
  it('progresses through all 3 steps using 3 sequential confirmation messages', () => {
    // Initial state: collecting dates
    let state: BookingState = { stage: 'dates', checkIn: '2026-12-25', checkOut: '2026-12-28' };

    // Message 1: confirm check-in date -> advance to guests
    const step1 = advanceBookingStep('yes', state);
    expect(step1.advanced).toBe(true);
    expect(step1.newState.stage).toBe('guests');
    state = { ...step1.newState, guests: 2 };

    // Message 2: confirm guest count -> advance to confirm
    const step2 = advanceBookingStep('confirm', state);
    expect(step2.advanced).toBe(true);
    expect(step2.newState.stage).toBe('confirm');
    state = step2.newState;

    // Message 3: confirm booking -> advance to done
    const step3 = advanceBookingStep('proceed', state);
    expect(step3.advanced).toBe(true);
    expect(step3.newState.stage).toBe('done');

    // Verify final state preserves all collected data
    expect(step3.newState.checkIn).toBe('2026-12-25');
    expect(step3.newState.checkOut).toBe('2026-12-28');
    expect(step3.newState.guests).toBe(2);
    expect(step3.nextStep).toBeNull();
  });
});
