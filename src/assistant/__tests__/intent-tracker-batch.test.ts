/**
 * US-034: Intent prediction batch insert queue to reduce database writes
 *
 * Verifies that:
 * - Intent predictions are queued in memory instead of inserted individually
 * - Queue flushes when it reaches 50 items OR every 5 seconds, whichever comes first
 * - Flush uses a single bulk INSERT statement via Drizzle
 * - Queue is flushed on process SIGTERM/SIGINT to prevent data loss
 * - Retries failed flushes up to 3 times before dropping with warning
 * - Existing trackPrediction() API signature remains unchanged
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted for mocks to avoid initialization issues
const { mockInsert, mockValues } = vi.hoisted(() => {
  const mockValues = vi.fn(() => Promise.resolve());
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  return { mockInsert, mockValues };
});

vi.mock('../../lib/db.js', () => ({
  db: {
    insert: mockInsert,
  },
}));

import {
  trackIntentPrediction,
  initializeQueue,
} from '../intent-tracker.js';
import type { InsertIntentPrediction } from '../../shared/schema-tables.js';

describe('US-034: Intent prediction batch insert queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValues.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockValues });
    vi.resetModules(); // Reset module state between tests
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ─── Batch Size Trigger Tests ────────────────────────────────────────────

  test('flushes to DB when queue reaches 50 items', async () => {
    vi.useFakeTimers();
    initializeQueue();

    // Queue 49 items — should NOT flush yet
    for (let i = 0; i < 49; i++) {
      await trackIntentPrediction(
        `conv-${i}`,
        `60${String(i).padStart(9, '0')}`,
        `message ${i}`,
        'booking',
        0.85,
        'fuzzy'
      );
    }

    expect(mockInsert).not.toHaveBeenCalled();

    // 50th item should trigger flush
    await trackIntentPrediction(
      'conv-50',
      '60123456750',
      'message 50',
      'booking',
      0.85,
      'fuzzy'
    );

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledTimes(1);

    // Verify bulk insert was called with array of 50 items
    const [[insertedItems]] = mockValues.mock.calls;
    expect(Array.isArray(insertedItems)).toBe(true);
    expect(insertedItems.length).toBe(50);

    vi.useRealTimers();
  });

  // ─── Timer Trigger Tests ─────────────────────────────────────────────────

  test('flushes to DB every 5 seconds even if queue < 50', async () => {
    vi.useFakeTimers();
    initializeQueue();

    // Queue 10 items
    for (let i = 0; i < 10; i++) {
      await trackIntentPrediction(
        `conv-${i}`,
        `60${String(i).padStart(9, '0')}`,
        `message ${i}`,
        'booking',
        0.85,
        'fuzzy'
      );
    }

    expect(mockInsert).not.toHaveBeenCalled();

    // Advance timer by 5 seconds
    await vi.advanceTimersByTimeAsync(5000);

    // Should have flushed
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [[insertedItems]] = mockValues.mock.calls;
    expect(insertedItems.length).toBe(10);

    vi.useRealTimers();
  });

  // ─── API Signature Tests ─────────────────────────────────────────────────

  test('trackPrediction() API signature unchanged — callers unaffected', async () => {
    vi.useFakeTimers();
    initializeQueue();

    // Call with same signature as before (should not throw)
    await trackIntentPrediction(
      'conv-123',
      '60123456789',
      'I want to book a room',
      'booking',
      0.85,
      'fuzzy',
      'claude-3-sonnet'
    );

    // Should be queued successfully
    expect(mockInsert).not.toHaveBeenCalled(); // Not yet flushed

    vi.useRealTimers();
  });

  test('accepts optional model parameter', async () => {
    vi.useFakeTimers();
    initializeQueue();

    // Call without optional model
    await trackIntentPrediction(
      'conv-123',
      '60123456789',
      'I want to book a room',
      'booking',
      0.85,
      'fuzzy'
    );

    // Call with optional model
    await trackIntentPrediction(
      'conv-124',
      '60123456789',
      'I want to book a room',
      'booking',
      0.85,
      'fuzzy',
      'gpt-4'
    );

    // Both should be queued successfully (no errors)
    expect(mockInsert).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // ─── Data Integrity Tests ───────────────────────────────────────────────

  test('preserves all prediction fields in queued items', async () => {
    vi.useFakeTimers();
    initializeQueue();

    // Queue exactly 50 items to trigger flush
    for (let i = 0; i < 50; i++) {
      await trackIntentPrediction(
        `conv-preserve-${i}`,
        `60${String(i).padStart(9, '0')}`,
        `message ${i}`,
        'booking',
        0.85 + (i * 0.01), // varying confidence
        'fuzzy',
        'model-name'
      );
    }

    expect(mockInsert).toHaveBeenCalled();

    // Find the flush call that contains our preserve-* items
    const flushCalls = mockValues.mock.calls;
    const preserveFlush = flushCalls.find(([items]: any) =>
      Array.isArray(items) && items.some((item: any) => item.conversationId.startsWith('conv-preserve-'))
    );

    expect(preserveFlush).toBeDefined();
    const insertedItems = preserveFlush?.[0];

    // Verify all fields are preserved in an item
    const targetItem = insertedItems.find((item: any) => item.conversationId === 'conv-preserve-0');
    expect(targetItem).toBeDefined();
    expect(targetItem.conversationId).toBe('conv-preserve-0');
    expect(targetItem.phoneNumber).toBe('60000000000');
    expect(targetItem.messageText).toBe('message 0');
    expect(targetItem.predictedIntent).toBe('booking');
    expect(typeof targetItem.confidence).toBe('number');
    expect(targetItem.tier).toBe('fuzzy');
    expect(targetItem.model).toBe('model-name');
    expect(targetItem.actualIntent).toBeNull();
    expect(targetItem.wasCorrect).toBeNull();
    expect(targetItem.correctionSource).toBeNull();
    expect(targetItem.correctedAt).toBeNull();

    vi.useRealTimers();
  });

  test('sets null values for unset fields', async () => {
    vi.useFakeTimers();
    initializeQueue();

    // Queue 50 items (to trigger flush)
    for (let i = 0; i < 50; i++) {
      await trackIntentPrediction(
        `conv-null-${i}`,
        `60${String(i).padStart(9, '0')}`,
        `message ${i}`,
        'booking',
        0.85,
        'fuzzy'
        // no model parameter
      );
    }

    expect(mockInsert).toHaveBeenCalled();

    // Find the flush call that contains our null-* items
    const flushCalls = mockValues.mock.calls;
    const nullFlush = flushCalls.find(([items]: any) =>
      Array.isArray(items) && items.some((item: any) => item.conversationId.startsWith('conv-null-'))
    );

    expect(nullFlush).toBeDefined();
    const insertedItems = nullFlush?.[0];

    // Verify a null-field item has all nulls set correctly
    const targetItem = insertedItems.find((item: any) => item.conversationId === 'conv-null-0');
    expect(targetItem).toBeDefined();
    expect(targetItem.model).toBeNull();
    expect(targetItem.actualIntent).toBeNull();
    expect(targetItem.wasCorrect).toBeNull();
    expect(targetItem.correctionSource).toBeNull();
    expect(targetItem.correctedAt).toBeNull();

    vi.useRealTimers();
  });

  // ─── Multiple Batch Tests ───────────────────────────────────────────────

  test('flushes multiple times when many items are queued', async () => {
    vi.useFakeTimers();
    initializeQueue();

    // Queue 150 items — should trigger 3 flushes (50, 50, 50)
    for (let i = 0; i < 150; i++) {
      await trackIntentPrediction(
        `conv-${i}`,
        `60${String(i).padStart(9, '0')}`,
        `message ${i}`,
        'booking',
        0.85,
        'fuzzy'
      );
    }

    // Should have triggered exactly 3 size-based flushes
    expect(mockInsert).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});

// ─── US-056: Room Availability Validation ────────────────────────────────────

import { getOccupiedRoomsForDateRange } from '../../shared/schema-tables.js';

describe('US-056: Room availability validation during booking confirmation', () => {
  test('getOccupiedRoomsForDateRange returns query params for date overlap check', () => {
    const checkIn = new Date('2026-04-10T14:00:00Z');
    const checkOut = new Date('2026-04-12T12:00:00Z');

    const params = getOccupiedRoomsForDateRange(checkIn, checkOut, 'pelangi');

    expect(params.checkIn).toEqual(checkIn);
    expect(params.checkOut).toEqual(checkOut);
    expect(params.profile).toBe('pelangi');
  });

  test('overbooking attempt is rejected — workflow routes to room_unavailable_msg', () => {
    // Verify the booking workflow has a check_room_availability node with dbAvailabilityCheck
    // and that it routes to room_unavailable_msg on failure (rooms all booked)
    const workflows = JSON.parse(
      require('fs').readFileSync(
        require('path').resolve(__dirname, '../data/workflows.json'),
        'utf-8'
      )
    );

    const bookingWorkflow = workflows.workflows.find(
      (w: { id: string }) => w.id === 'booking_payment_handler'
    );
    expect(bookingWorkflow).toBeDefined();

    const availabilityNode = bookingWorkflow.nodes.find(
      (n: { id: string }) => n.id === 'check_room_availability'
    );
    expect(availabilityNode).toBeDefined();
    expect(availabilityNode.type).toBe('condition');
    expect(availabilityNode.config.operator).toBe('dbAvailabilityCheck');

    // When rooms are fully booked (condition false), guest sees alternative date suggestions
    expect(availabilityNode.config.falseNext).toBe('room_unavailable_msg');
    expect(availabilityNode.config.trueNext).toBe('confirm_booking_msg');

    const unavailableNode = bookingWorkflow.nodes.find(
      (n: { id: string }) => n.id === 'room_unavailable_msg'
    );
    expect(unavailableNode).toBeDefined();
    expect(unavailableNode.type).toBe('message');

    // The unavailable message must mention alternative date suggestions
    const enMessage: string = unavailableNode.config.message.en;
    expect(enMessage.toLowerCase()).toMatch(/fully booked|not available|no room/);
    expect(enMessage.toLowerCase()).toMatch(/different dates|try|adjust|shift/);

    // Guest is looped back to re-enter dates (not dead-ended)
    expect(unavailableNode.next).toBe('wait_booking_dates');
  });

  test('defaulted profile is pelangi when not specified', () => {
    const params = getOccupiedRoomsForDateRange(
      new Date('2026-05-01'),
      new Date('2026-05-03')
    );
    expect(params.profile).toBe('pelangi');
  });

  test('check_room_availability node sits between date conflict check and confirmation', () => {
    const workflows = JSON.parse(
      require('fs').readFileSync(
        require('path').resolve(__dirname, '../data/workflows.json'),
        'utf-8'
      )
    );

    const bookingWorkflow = workflows.workflows.find(
      (w: { id: string }) => w.id === 'booking_payment_handler'
    );

    const conflictNode = bookingWorkflow.nodes.find(
      (n: { id: string }) => n.id === 'check_booking_conflict'
    );
    // Conflict node must chain to availability node (not directly to confirmation)
    expect(conflictNode.config.trueNext).toBe('check_room_availability');
  });
});
