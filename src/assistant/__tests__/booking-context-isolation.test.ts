/**
 * US-256: Booking Workflow Step Context Isolation Test Suite
 *
 * Verifies that conversation context from one guest's booking attempt
 * doesn't leak into another guest's concurrent booking workflow.
 * Ensures conversation state is properly isolated per guest in
 * multi-turn booking dialogues.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock DB and persistence to avoid real database calls
vi.mock('../../lib/db.js', () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) },
  pool: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
}));

vi.mock('../state-persistence.js', () => ({
  initStatePersistence: vi.fn().mockResolvedValue(undefined),
  loadActiveStates: vi.fn().mockResolvedValue([]),
  schedulePersist: vi.fn(),
  deletePersistedState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../intent-config.js', () => ({
  getIntentConfig: vi.fn().mockReturnValue({
    conversationState: { maxHistoryMessages: 20, contextTTL: 30 },
  }),
}));

vi.mock('../../lib/invariant.js', () => ({
  softInvariant: vi.fn(),
}));

import {
  getOrCreate,
  addMessage,
  updateBookingState,
  clearConversation,
  getMessages,
  updateWorkflowState,
  updateActiveFlow,
} from '../conversation.js';
import type { BookingState, ConversationState } from '../types.js';

// ─── Test Guests ─────────────────────────────────────────────────────

const GUEST_A_PHONE = '60123456001';
const GUEST_A_NAME = 'Alice Tan';
const GUEST_B_PHONE = '60123456002';
const GUEST_B_NAME = 'Bob Lee';
const GUEST_C_PHONE = '60123456003';
const GUEST_C_NAME = 'Charlie Wong';

const PROFILE_PELANGI = 'pelangi';
const PROFILE_SOUTHERN = 'southern';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeBookingState(overrides: Partial<BookingState> = {}): BookingState {
  return {
    stage: 'inquiry',
    ...overrides,
  };
}

function getConvoState(phone: string, profileId?: string): ConversationState {
  return getOrCreate(phone, 'Test', profileId);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('US-256: Booking Context Isolation', () => {
  beforeEach(() => {
    // Clear all conversation state between tests
    clearConversation(GUEST_A_PHONE, PROFILE_PELANGI);
    clearConversation(GUEST_B_PHONE, PROFILE_PELANGI);
    clearConversation(GUEST_C_PHONE, PROFILE_PELANGI);
    clearConversation(GUEST_A_PHONE, PROFILE_SOUTHERN);
    clearConversation(GUEST_B_PHONE, PROFILE_SOUTHERN);
    // Also clear default profile keys (no profileId / pelangi defaults to phone only)
    clearConversation(GUEST_A_PHONE);
    clearConversation(GUEST_B_PHONE);
    clearConversation(GUEST_C_PHONE);
  });

  // ─── Core Isolation: Two Concurrent Guests ─────────────────────────

  describe('concurrent booking state isolation', () => {
    it('Guest A booking state does not appear in Guest B state', () => {
      // Guest A starts a booking
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'dates',
        checkIn: '2026-04-01',
        checkOut: '2026-04-03',
        guestName: GUEST_A_NAME,
      }));

      // Guest B starts a separate booking
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);
      updateBookingState(GUEST_B_PHONE, makeBookingState({
        stage: 'guests',
        checkIn: '2026-05-10',
        checkOut: '2026-05-12',
        guestName: GUEST_B_NAME,
      }));

      // Verify isolation
      const stateA = getConvoState(GUEST_A_PHONE);
      const stateB = getConvoState(GUEST_B_PHONE);

      expect(stateA.bookingState?.stage).toBe('dates');
      expect(stateA.bookingState?.checkIn).toBe('2026-04-01');
      expect(stateA.bookingState?.guestName).toBe(GUEST_A_NAME);

      expect(stateB.bookingState?.stage).toBe('guests');
      expect(stateB.bookingState?.checkIn).toBe('2026-05-10');
      expect(stateB.bookingState?.guestName).toBe(GUEST_B_NAME);

      // Cross-contamination checks
      expect(stateA.bookingState?.checkIn).not.toBe(stateB.bookingState?.checkIn);
      expect(stateA.bookingState?.guestName).not.toBe(stateB.bookingState?.guestName);
    });

    it('three concurrent guests maintain independent booking stages', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);
      getOrCreate(GUEST_C_PHONE, GUEST_C_NAME);

      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'inquiry' }));
      updateBookingState(GUEST_B_PHONE, makeBookingState({ stage: 'dates' }));
      updateBookingState(GUEST_C_PHONE, makeBookingState({ stage: 'confirm' }));

      expect(getConvoState(GUEST_A_PHONE).bookingState?.stage).toBe('inquiry');
      expect(getConvoState(GUEST_B_PHONE).bookingState?.stage).toBe('dates');
      expect(getConvoState(GUEST_C_PHONE).bookingState?.stage).toBe('confirm');
    });
  });

  // ─── Booking State Mutation Isolation ──────────────────────────────

  describe('booking state mutation isolation', () => {
    it('updating Guest A check-in date does not mutate Guest B', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'dates', checkIn: '2026-04-01' }));
      updateBookingState(GUEST_B_PHONE, makeBookingState({ stage: 'dates', checkIn: '2026-06-15' }));

      // Mutate Guest A's check-in
      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'dates', checkIn: '2026-04-05' }));

      // Guest B should be unchanged
      expect(getConvoState(GUEST_B_PHONE).bookingState?.checkIn).toBe('2026-06-15');
      expect(getConvoState(GUEST_A_PHONE).bookingState?.checkIn).toBe('2026-04-05');
    });

    it('updating Guest A guest count does not affect Guest B', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'guests', guests: 2 }));
      updateBookingState(GUEST_B_PHONE, makeBookingState({ stage: 'guests', guests: 4 }));

      // Update Guest A
      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'guests', guests: 3 }));

      expect(getConvoState(GUEST_A_PHONE).bookingState?.guests).toBe(3);
      expect(getConvoState(GUEST_B_PHONE).bookingState?.guests).toBe(4);
    });

    it('Guest A stage transition to confirm does not change Guest B stage', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'dates' }));
      updateBookingState(GUEST_B_PHONE, makeBookingState({ stage: 'inquiry' }));

      // Guest A advances to confirm
      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'confirm',
        checkIn: '2026-04-01',
        checkOut: '2026-04-03',
        guests: 2,
        guestName: GUEST_A_NAME,
      }));

      // Guest B stays at inquiry
      expect(getConvoState(GUEST_B_PHONE).bookingState?.stage).toBe('inquiry');
      expect(getConvoState(GUEST_B_PHONE).bookingState?.checkIn).toBeUndefined();
    });

    it('Guest A cancellation does not cancel Guest B booking', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'confirm',
        checkIn: '2026-04-01',
        guestName: GUEST_A_NAME,
      }));
      updateBookingState(GUEST_B_PHONE, makeBookingState({
        stage: 'confirm',
        checkIn: '2026-05-10',
        guestName: GUEST_B_NAME,
      }));

      // Guest A cancels
      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'cancelled',
        cancelReason: 'changed plans',
      }));

      // Guest B still confirmed
      expect(getConvoState(GUEST_A_PHONE).bookingState?.stage).toBe('cancelled');
      expect(getConvoState(GUEST_B_PHONE).bookingState?.stage).toBe('confirm');
      expect(getConvoState(GUEST_B_PHONE).bookingState?.guestName).toBe(GUEST_B_NAME);
    });
  });

  // ─── Message History Isolation ─────────────────────────────────────

  describe('message history isolation', () => {
    it('Guest A messages are not visible in Guest B conversation', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      addMessage(GUEST_A_PHONE, 'user', 'I want to book a room for 2 nights');
      addMessage(GUEST_A_PHONE, 'assistant', 'Sure! What dates would you like?');
      addMessage(GUEST_B_PHONE, 'user', 'Is there availability for next weekend?');
      addMessage(GUEST_B_PHONE, 'assistant', 'Let me check for you!');

      const messagesA = getMessages(GUEST_A_PHONE);
      const messagesB = getMessages(GUEST_B_PHONE);

      expect(messagesA).toHaveLength(2);
      expect(messagesB).toHaveLength(2);

      expect(messagesA[0].content).toContain('2 nights');
      expect(messagesB[0].content).toContain('next weekend');

      // Ensure no cross-contamination
      const allContentA = messagesA.map(m => m.content).join(' ');
      const allContentB = messagesB.map(m => m.content).join(' ');
      expect(allContentA).not.toContain('next weekend');
      expect(allContentB).not.toContain('2 nights');
    });
  });

  // ─── Clear State Isolation ─────────────────────────────────────────

  describe('clear state isolation', () => {
    it('clearing Guest A state does not affect Guest B', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'confirm',
        checkIn: '2026-04-01',
        guestName: GUEST_A_NAME,
      }));
      updateBookingState(GUEST_B_PHONE, makeBookingState({
        stage: 'dates',
        checkIn: '2026-05-10',
        guestName: GUEST_B_NAME,
      }));

      addMessage(GUEST_A_PHONE, 'user', 'cancel my booking');
      addMessage(GUEST_B_PHONE, 'user', 'my dates are May 10-12');

      // Clear Guest A's entire conversation
      clearConversation(GUEST_A_PHONE);

      // Guest B state intact
      const stateB = getConvoState(GUEST_B_PHONE);
      expect(stateB.bookingState?.stage).toBe('dates');
      expect(stateB.bookingState?.checkIn).toBe('2026-05-10');
      expect(stateB.bookingState?.guestName).toBe(GUEST_B_NAME);
      expect(getMessages(GUEST_B_PHONE)).toHaveLength(1);

      // Guest A is gone (getOrCreate will create fresh)
      const freshA = getConvoState(GUEST_A_PHONE);
      expect(freshA.bookingState).toBeNull();
      expect(freshA.messages).toHaveLength(0);
    });

    it('setting Guest A booking to null does not null Guest B', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'done' }));
      updateBookingState(GUEST_B_PHONE, makeBookingState({ stage: 'confirm' }));

      // Complete Guest A's booking (set to null)
      updateBookingState(GUEST_A_PHONE, null);

      expect(getConvoState(GUEST_A_PHONE).bookingState).toBeNull();
      expect(getConvoState(GUEST_B_PHONE).bookingState?.stage).toBe('confirm');
    });
  });

  // ─── Profile-Scoped Isolation ──────────────────────────────────────

  describe('profile-scoped isolation', () => {
    it('same phone number on different profiles has isolated booking state', () => {
      // Same guest contacts both Pelangi and Southern properties
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME, PROFILE_PELANGI);
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME, PROFILE_SOUTHERN);

      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'dates',
        checkIn: '2026-04-01',
        guestName: 'Alice (Pelangi)',
      }), PROFILE_PELANGI);

      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'guests',
        checkIn: '2026-06-20',
        guestName: 'Alice (Southern)',
      }), PROFILE_SOUTHERN);

      const pelangiState = getConvoState(GUEST_A_PHONE, PROFILE_PELANGI);
      const southernState = getConvoState(GUEST_A_PHONE, PROFILE_SOUTHERN);

      expect(pelangiState.bookingState?.stage).toBe('dates');
      expect(pelangiState.bookingState?.checkIn).toBe('2026-04-01');
      expect(pelangiState.bookingState?.guestName).toBe('Alice (Pelangi)');

      expect(southernState.bookingState?.stage).toBe('guests');
      expect(southernState.bookingState?.checkIn).toBe('2026-06-20');
      expect(southernState.bookingState?.guestName).toBe('Alice (Southern)');
    });

    it('messages on different profiles do not mix', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME, PROFILE_PELANGI);
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME, PROFILE_SOUTHERN);

      addMessage(GUEST_A_PHONE, 'user', 'Book capsule room', PROFILE_PELANGI);
      addMessage(GUEST_A_PHONE, 'user', 'Book homestay room', PROFILE_SOUTHERN);

      const pelangiMsgs = getMessages(GUEST_A_PHONE, PROFILE_PELANGI);
      const southernMsgs = getMessages(GUEST_A_PHONE, PROFILE_SOUTHERN);

      expect(pelangiMsgs).toHaveLength(1);
      expect(pelangiMsgs[0].content).toContain('capsule');

      expect(southernMsgs).toHaveLength(1);
      expect(southernMsgs[0].content).toContain('homestay');
    });

    it('clearing one profile does not affect the other', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME, PROFILE_PELANGI);
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME, PROFILE_SOUTHERN);

      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'confirm' }), PROFILE_PELANGI);
      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'dates' }), PROFILE_SOUTHERN);

      clearConversation(GUEST_A_PHONE, PROFILE_SOUTHERN);

      // Pelangi still intact
      expect(getConvoState(GUEST_A_PHONE, PROFILE_PELANGI).bookingState?.stage).toBe('confirm');
      // Southern cleared
      expect(getConvoState(GUEST_A_PHONE, PROFILE_SOUTHERN).bookingState).toBeNull();
    });
  });

  // ─── Full Booking Flow Isolation (Multi-Step) ──────────────────────

  describe('full booking flow isolation (multi-step)', () => {
    it('two guests progress through booking stages independently', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      // Step 1: Both start inquiry
      updateBookingState(GUEST_A_PHONE, makeBookingState({ stage: 'inquiry' }));
      updateBookingState(GUEST_B_PHONE, makeBookingState({ stage: 'inquiry' }));

      // Step 2: Guest A provides dates
      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'dates',
        checkIn: '2026-04-01',
        checkOut: '2026-04-03',
      }));
      addMessage(GUEST_A_PHONE, 'user', 'April 1 to April 3');

      // Guest B still at inquiry
      expect(getConvoState(GUEST_B_PHONE).bookingState?.stage).toBe('inquiry');
      expect(getConvoState(GUEST_B_PHONE).bookingState?.checkIn).toBeUndefined();

      // Step 3: Guest B provides dates (different from A)
      updateBookingState(GUEST_B_PHONE, makeBookingState({
        stage: 'dates',
        checkIn: '2026-05-10',
        checkOut: '2026-05-15',
      }));
      addMessage(GUEST_B_PHONE, 'user', 'May 10 to May 15');

      // Step 4: Guest A provides guest count
      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'guests',
        checkIn: '2026-04-01',
        checkOut: '2026-04-03',
        guests: 1,
        guestName: GUEST_A_NAME,
      }));
      addMessage(GUEST_A_PHONE, 'user', 'Just me, Alice Tan');

      // Step 5: Guest A confirms, Guest B provides guest count
      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'confirm',
        checkIn: '2026-04-01',
        checkOut: '2026-04-03',
        guests: 1,
        guestName: GUEST_A_NAME,
      }));
      updateBookingState(GUEST_B_PHONE, makeBookingState({
        stage: 'guests',
        checkIn: '2026-05-10',
        checkOut: '2026-05-15',
        guests: 3,
        guestName: GUEST_B_NAME,
      }));

      // Final verification: complete isolation
      const finalA = getConvoState(GUEST_A_PHONE);
      const finalB = getConvoState(GUEST_B_PHONE);

      // Guest A: confirmed with her own details
      expect(finalA.bookingState?.stage).toBe('confirm');
      expect(finalA.bookingState?.checkIn).toBe('2026-04-01');
      expect(finalA.bookingState?.guests).toBe(1);
      expect(finalA.bookingState?.guestName).toBe(GUEST_A_NAME);

      // Guest B: at guests stage with his own details
      expect(finalB.bookingState?.stage).toBe('guests');
      expect(finalB.bookingState?.checkIn).toBe('2026-05-10');
      expect(finalB.bookingState?.guests).toBe(3);
      expect(finalB.bookingState?.guestName).toBe(GUEST_B_NAME);

      // Message histories are separate
      const msgsA = getMessages(GUEST_A_PHONE);
      const msgsB = getMessages(GUEST_B_PHONE);
      expect(msgsA.length).toBeGreaterThan(0);
      expect(msgsB.length).toBeGreaterThan(0);
      expect(msgsA.some(m => m.content.includes('Alice'))).toBe(true);
      expect(msgsB.some(m => m.content.includes('May 10'))).toBe(true);
      expect(msgsA.some(m => m.content.includes('May 10'))).toBe(false);
      expect(msgsB.some(m => m.content.includes('Alice'))).toBe(false);
    });

    it('Guest A completing booking (done) does not affect Guest B in-progress', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      // Guest A completes entire flow
      updateBookingState(GUEST_A_PHONE, makeBookingState({
        stage: 'done',
        checkIn: '2026-04-01',
        checkOut: '2026-04-03',
        guests: 1,
        guestName: GUEST_A_NAME,
      }));

      // Guest B is mid-flow
      updateBookingState(GUEST_B_PHONE, makeBookingState({
        stage: 'dates',
        checkIn: '2026-05-10',
      }));

      expect(getConvoState(GUEST_A_PHONE).bookingState?.stage).toBe('done');
      expect(getConvoState(GUEST_B_PHONE).bookingState?.stage).toBe('dates');
      expect(getConvoState(GUEST_B_PHONE).bookingState?.guestName).toBeUndefined();
    });
  });

  // ─── Workflow + Booking State Isolation ─────────────────────────────

  describe('workflow vs booking state isolation', () => {
    it('Guest A on workflow does not interfere with Guest B on booking', () => {
      getOrCreate(GUEST_A_PHONE, GUEST_A_NAME);
      getOrCreate(GUEST_B_PHONE, GUEST_B_NAME);

      // Guest A in a workflow (e.g., checkin)
      updateWorkflowState(GUEST_A_PHONE, {
        workflowId: 'checkin_full',
        currentNodeId: 'ask_name',
        data: { name: GUEST_A_NAME },
        startedAt: Date.now(),
      });

      // Guest B in a booking flow
      updateBookingState(GUEST_B_PHONE, makeBookingState({
        stage: 'confirm',
        checkIn: '2026-05-10',
        guestName: GUEST_B_NAME,
      }));

      const stateA = getConvoState(GUEST_A_PHONE);
      const stateB = getConvoState(GUEST_B_PHONE);

      // Guest A has workflow, no booking
      expect(stateA.workflowState).not.toBeNull();
      expect(stateA.workflowState?.workflowId).toBe('checkin_full');
      expect(stateA.bookingState).toBeNull();

      // Guest B has booking, no workflow
      expect(stateB.bookingState?.stage).toBe('confirm');
      expect(stateB.bookingState?.guestName).toBe(GUEST_B_NAME);
      expect(stateB.workflowState).toBeNull();
    });
  });
});
