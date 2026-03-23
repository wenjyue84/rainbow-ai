/**
 * US-228: Tests for Booking Workflow Step Pre-Execution Validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateBookingPreconditions,
  extractBookingContext,
  type BookingContext,
  type ValidationResult,
} from '../assistant/booking-validator.js';
import type { WorkflowState } from '../assistant/workflow-executor.js';
import { pool } from '../lib/db.js';

// Mock the database pool
vi.mock('../lib/db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

describe('BookingValidator - validateBookingPreconditions', () => {
  let mockWorkflowState: WorkflowState;

  beforeEach(() => {
    mockWorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: {},
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  // Test Case 1: Valid booking passes validation
  it('should pass validation when all preconditions are met', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const context: BookingContext = {
      guestPhone: '+60123456789',
      guestName: 'John Doe',
      roomType: 'Deluxe',
      checkInDate: tomorrow,
      checkOutDate: dayAfter,
      profile: 'pelangi',
    };

    // Mock database calls - no conflicting reservations
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // availability check
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // overlap check

    const result = await validateBookingPreconditions(mockWorkflowState, context);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // Test Case 2: Guest ID missing returns error
  it('should return error when guest information is missing', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const context: BookingContext = {
      // Missing guestPhone and guestName
      roomType: 'Deluxe',
      checkInDate: tomorrow,
      checkOutDate: new Date(tomorrow.getTime() + 86400000),
      profile: 'pelangi',
    };

    const result = await validateBookingPreconditions(mockWorkflowState, context);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Guest information'))).toBe(true);
  });

  // Test Case 3: Past date caught
  it('should return error when check-in date is in the past', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const context: BookingContext = {
      guestPhone: '+60123456789',
      guestName: 'John Doe',
      roomType: 'Deluxe',
      checkInDate: yesterday,
      checkOutDate: new Date(),
      profile: 'pelangi',
    };

    const result = await validateBookingPreconditions(mockWorkflowState, context);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('past'))).toBe(true);
  });

  // Test Case 4: Room unavailable suggests alternative
  it('should suggest alternatives when room is unavailable', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const context: BookingContext = {
      guestPhone: '+60123456789',
      guestName: 'John Doe',
      roomType: 'Deluxe',
      checkInDate: tomorrow,
      checkOutDate: dayAfter,
      profile: 'pelangi',
    };

    // Mock database - room is booked
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ room_id: 'Deluxe-1' }, { room_id: 'Deluxe-2' }],
    }); // availability check shows Deluxe booked
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // overlap check

    const result = await validateBookingPreconditions(mockWorkflowState, context);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('not available'))).toBe(true);
    expect(result.errors.some(e => e.includes('alternatives') || e.includes('Available'))).toBe(true);
  });

  // Test Case 5: Overlapping booking detected
  it('should detect overlapping bookings for the guest', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const context: BookingContext = {
      guestPhone: '+60123456789',
      guestName: 'John Doe',
      roomType: 'Deluxe',
      checkInDate: tomorrow,
      checkOutDate: dayAfter,
      profile: 'pelangi',
    };

    // Mock database - no room conflict but guest has overlapping booking
    (pool.query as any).mockResolvedValueOnce({ rows: [] }); // availability check
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 'existing-booking-123' }],
    }); // overlap check shows conflict

    const result = await validateBookingPreconditions(mockWorkflowState, context);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('already have a booking'))).toBe(true);
  });
});

describe('BookingValidator - extractBookingContext', () => {
  it('should extract booking context from workflow state', () => {
    const workflowState: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 3,
      collectedData: {
        guest_name: 'Alice Smith',
        guest_phone: '+60198765432',
        check_in_date: '15 Feb 2026',
        check_out_date: '17 Feb 2026',
        capsule: 'Deluxe-1',
      },
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const context = extractBookingContext(workflowState, 'pelangi');

    expect(context.guestName).toBe('Alice Smith');
    expect(context.guestPhone).toBe('+60198765432');
    expect(context.checkInDate).toBe('15 Feb 2026');
    expect(context.checkOutDate).toBe('17 Feb 2026');
    expect(context.roomType).toBe('Deluxe-1');
  });

  it('should handle missing fields gracefully', () => {
    const workflowState: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 1,
      collectedData: {
        guest_name: 'Bob Johnson',
      },
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const context = extractBookingContext(workflowState, 'pelangi');

    expect(context.guestName).toBe('Bob Johnson');
    expect(context.guestPhone).toBeUndefined();
    expect(context.checkInDate).toBeUndefined();
    expect(context.checkOutDate).toBeUndefined();
  });
});
