/**
 * Booking FSM Model Checking
 *
 * Models the 7-state booking state machine as a directed graph
 * and verifies reachability, completeness, and invariants.
 */
import { describe, it, expect } from 'vitest';

// Booking stages from types.ts
type BookingStage = 'inquiry' | 'dates' | 'guests' | 'confirm' | 'done' | 'cancelled' | 'save_sale';

// Model the FSM as an adjacency list (state -> possible next states)
// Derived from reading booking.ts handleBookingStep
const BOOKING_FSM: Record<BookingStage, BookingStage[]> = {
  // inquiry -> dates (no dates), guests (dates but no guests), confirm (dates + guests from AI)
  inquiry: ['dates', 'guests', 'confirm', 'save_sale'],
  // dates -> dates (retry), guests (dates ok), confirm (dates + guests from AI), save_sale (cancel)
  dates: ['dates', 'guests', 'confirm', 'save_sale'],
  // guests -> guests (invalid input), confirm (valid count), save_sale (cancel)
  guests: ['guests', 'confirm', 'save_sale'],
  // confirm -> done (confirmed), cancelled (API error), confirm (not confirmed, retry), save_sale (cancel)
  confirm: ['done', 'cancelled', 'confirm', 'save_sale'],
  // save_sale -> dates (guest wants to resume), cancelled (guest confirms cancel)
  save_sale: ['dates', 'cancelled'],
  // Terminal states reset to inquiry
  done: ['inquiry'],
  cancelled: ['inquiry'],
};

const ALL_STAGES: BookingStage[] = ['inquiry', 'dates', 'guests', 'confirm', 'done', 'cancelled', 'save_sale'];
const TERMINAL_STAGES: BookingStage[] = ['done', 'cancelled'];
const ACTIVE_STAGES: BookingStage[] = ['inquiry', 'dates', 'guests', 'confirm', 'save_sale'];

describe('Booking FSM — Model Checking', () => {

  // 2A.1: No dead states — every state has at least one outgoing transition
  it('should have no dead states (every state has outgoing transitions)', () => {
    for (const stage of ALL_STAGES) {
      expect(
        BOOKING_FSM[stage].length,
        `Stage "${stage}" has no outgoing transitions (dead state)`
      ).toBeGreaterThan(0);
    }
  });

  // 2A.2: All states are reachable from 'inquiry'
  it('should have all states reachable from inquiry', () => {
    const reachable = new Set<BookingStage>();
    const queue: BookingStage[] = ['inquiry'];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const next of BOOKING_FSM[current]) {
        if (!reachable.has(next)) queue.push(next);
      }
    }

    for (const stage of ALL_STAGES) {
      expect(
        reachable.has(stage),
        `Stage "${stage}" is not reachable from inquiry`
      ).toBe(true);
    }
  });

  // 2A.3: Terminal states should reset (cycle back to inquiry)
  it('should cycle terminal states back to inquiry', () => {
    for (const terminal of TERMINAL_STAGES) {
      expect(
        BOOKING_FSM[terminal],
        `Terminal state "${terminal}" should transition to inquiry`
      ).toContain('inquiry');
    }
  });

  // 2A.4: Cancel (save_sale) reachable from all active stages
  it('should allow cancel from all active non-save_sale stages', () => {
    const cancelableStages = ACTIVE_STAGES.filter(s => s !== 'save_sale');
    for (const stage of cancelableStages) {
      expect(
        BOOKING_FSM[stage],
        `Stage "${stage}" should allow transition to save_sale (cancel)`
      ).toContain('save_sale');
    }
  });

  // 2A.5: No forward stage skipping in the normal flow
  it('should not allow inquiry to jump directly to done or cancelled', () => {
    expect(BOOKING_FSM.inquiry).not.toContain('done');
    expect(BOOKING_FSM.inquiry).not.toContain('cancelled');
  });

  // 2A.6: confirm is only reachable after dates and guests data available
  it('confirm should only be reachable from states that can provide dates+guests', () => {
    // confirm can come from: inquiry (AI extracts all), dates (AI extracts guests too), guests (manual)
    const statesThatReachConfirm = ALL_STAGES.filter(s => BOOKING_FSM[s].includes('confirm'));
    // All of these are valid paths where dates + guests could be available
    for (const state of statesThatReachConfirm) {
      expect(['inquiry', 'dates', 'guests', 'confirm']).toContain(state);
    }
  });

  // 2A.7: Graph completeness — all next states are valid stages
  it('should have all transition targets be valid stages', () => {
    for (const [stage, targets] of Object.entries(BOOKING_FSM)) {
      for (const target of targets) {
        expect(
          ALL_STAGES,
          `Stage "${stage}" transitions to unknown stage "${target}"`
        ).toContain(target);
      }
    }
  });

  // 2A.8: Shortest path to done (optimistic booking)
  it('should reach done in at most 4 steps (inquiry -> confirm -> done)', () => {
    // BFS for shortest path from inquiry to done
    const distances = new Map<BookingStage, number>();
    distances.set('inquiry', 0);
    const queue: BookingStage[] = ['inquiry'];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dist = distances.get(current)!;
      for (const next of BOOKING_FSM[current]) {
        if (!distances.has(next)) {
          distances.set(next, dist + 1);
          queue.push(next);
        }
      }
    }

    expect(distances.get('done')).toBeLessThanOrEqual(4);
  });
});
