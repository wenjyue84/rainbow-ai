/**
 * US-237: Multi-Turn Booking Clarification Dialog Manager
 *
 * Tests:
 * 1. State machine transitions through all 4 states
 * 2. Low-confidence booking intent triggers clarification flow
 * 3. Full dialog flow: "book" → ask dates → respond → ask room → respond → ask count → confirm
 * 4. serialise/deserialise round-trip for DB storage
 */

import { describe, it, expect } from 'vitest';
import {
  createClarificationSession,
  processClarificationStep,
  getClarificationPrompt,
  serialiseClarification,
  deserialiseClarification,
  type ClarificationSession,
} from '../dialogs/booking-clarification-dialog.js';

describe('US-237: BookingClarificationDialog — state machine', () => {

  it('starts in need_dates state', () => {
    const session = createClarificationSession();
    expect(session.state).toBe('need_dates');
    expect(session.data).toEqual({});
  });

  it('stays in need_dates when no date is provided', () => {
    const session = createClarificationSession();
    const result = processClarificationStep(session, 'I want to book a room', 'en');
    expect(result.session.state).toBe('need_dates');
    expect(result.complete).toBe(false);
  });

  it('advances to need_room_type when dates are provided', () => {
    const session = createClarificationSession();
    const result = processClarificationStep(session, '15 Apr – 18 Apr', 'en');
    expect(result.session.state).toBe('need_room_type');
    expect(result.session.data.checkIn).toBeTruthy();
    expect(result.session.data.checkOut).toBeTruthy();
    expect(result.complete).toBe(false);
  });

  it('advances to need_room_type with ISO date range', () => {
    const session = createClarificationSession();
    const result = processClarificationStep(session, '2025-04-15 to 2025-04-18', 'en');
    expect(result.session.state).toBe('need_room_type');
    expect(result.session.data.checkIn).toBe('2025-04-15');
    expect(result.session.data.checkOut).toBe('2025-04-18');
  });

  it('advances to need_guest_count when room type provided', () => {
    let session = createClarificationSession();
    session = processClarificationStep(session, '15 Apr – 18 Apr', 'en').session;
    const result = processClarificationStep(session, 'dorm bed please', 'en');
    expect(result.session.state).toBe('need_guest_count');
    expect(result.session.data.roomType).toBe('dorm');
    expect(result.complete).toBe(false);
  });

  it('advances to ready_confirm when guest count provided', () => {
    let session = createClarificationSession();
    session = processClarificationStep(session, '15 Apr – 18 Apr', 'en').session;
    session = processClarificationStep(session, 'private room', 'en').session;
    const result = processClarificationStep(session, '2 guests', 'en');
    expect(result.session.state).toBe('ready_confirm');
    expect(result.session.data.guestCount).toBe(2);
    expect(result.complete).toBe(true);
  });

  it('stays in need_guest_count on invalid count', () => {
    let session = createClarificationSession();
    session = processClarificationStep(session, '15 Apr – 18 Apr', 'en').session;
    session = processClarificationStep(session, 'twin', 'en').session;
    const result = processClarificationStep(session, 'just us', 'en'); // no digit
    expect(result.session.state).toBe('need_guest_count');
    expect(result.complete).toBe(false);
  });

  it('returns ready_confirm prompt when already complete', () => {
    let session = createClarificationSession();
    session = processClarificationStep(session, '15 Apr – 18 Apr', 'en').session;
    session = processClarificationStep(session, 'private room', 'en').session;
    session = processClarificationStep(session, '3', 'en').session;
    expect(session.state).toBe('ready_confirm');
    // Additional message should still return confirm prompt
    const result = processClarificationStep(session, 'sure go ahead', 'en');
    expect(result.complete).toBe(true);
  });
});

describe('US-237: BookingClarificationDialog — full dialog flow', () => {

  it('completes full flow: book → ask dates → respond → ask room → ask count → confirm', () => {
    // Step 0: Guest sends ambiguous "book" — AI triggers clarification
    const session = createClarificationSession();
    expect(session.state).toBe('need_dates');

    // The initial prompt asks for dates
    const initialPrompt = getClarificationPrompt('need_dates', 'en');
    expect(initialPrompt).toMatch(/check.in|date/i);

    // Step 1: Guest provides dates
    const step1 = processClarificationStep(session, '20 May – 23 May', 'en');
    expect(step1.session.state).toBe('need_room_type');
    expect(step1.response).toMatch(/room|type|dorm|private|twin/i);

    // Step 2: Guest provides room type
    const step2 = processClarificationStep(step1.session, 'dorm', 'en');
    expect(step2.session.state).toBe('need_guest_count');
    expect(step2.response).toMatch(/guest|how many/i);

    // Step 3: Guest provides count
    const step3 = processClarificationStep(step2.session, '1 person', 'en');
    expect(step3.session.state).toBe('ready_confirm');
    expect(step3.complete).toBe(true);
    expect(step3.response).toMatch(/confirm|booking/i);

    // Verify all data collected
    expect(step3.session.data.checkIn).toBeTruthy();
    expect(step3.session.data.checkOut).toBeTruthy();
    expect(step3.session.data.roomType).toBe('dorm');
    expect(step3.session.data.guestCount).toBe(1);
  });

  it('multilingual — prompts in Malay', () => {
    const session = createClarificationSession();
    const result = processClarificationStep(session, 'nak book bilik', 'ms');
    expect(result.response).toMatch(/tarikh|daftar/i);
  });

  it('multilingual — prompts in Chinese', () => {
    const session = createClarificationSession();
    const result = processClarificationStep(session, '我想订房', 'zh');
    expect(result.response).toMatch(/入住|退房|日期/);
  });
});

describe('US-237: BookingClarificationDialog — DB serialisation', () => {

  it('serialises and deserialises session correctly', () => {
    let session = createClarificationSession();
    session = processClarificationStep(session, '2025-06-01 to 2025-06-04', 'en').session;
    session = processClarificationStep(session, 'private', 'en').session;

    const { clarificationState, clarificationData } = serialiseClarification(session);
    expect(clarificationState).toBe('need_guest_count');

    const parsed = JSON.parse(clarificationData);
    expect(parsed.checkIn).toBe('2025-06-01');
    expect(parsed.roomType).toBe('private');
  });

  it('deserialises valid state from DB columns', () => {
    const restored = deserialiseClarification(
      'need_guest_count',
      JSON.stringify({ checkIn: '2025-06-01', checkOut: '2025-06-04', roomType: 'dorm' })
    );
    expect(restored).not.toBeNull();
    expect(restored!.state).toBe('need_guest_count');
    expect(restored!.data.roomType).toBe('dorm');
  });

  it('returns null for unknown state from DB', () => {
    const restored = deserialiseClarification('unknown_state', '{}');
    expect(restored).toBeNull();
  });

  it('returns null when state column is null/empty', () => {
    expect(deserialiseClarification(null, null)).toBeNull();
    expect(deserialiseClarification('', null)).toBeNull();
  });

  it('handles malformed clarification_data JSON gracefully', () => {
    const restored = deserialiseClarification('need_dates', 'not-valid-json');
    expect(restored).not.toBeNull();
    expect(restored!.data).toEqual({});
  });
});
