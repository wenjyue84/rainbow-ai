/**
 * US-127: Booking Workflow Step Precondition Validator Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateBookingStepPreconditions } from './booking-preconditions.js';
import type { WorkflowState } from '../workflow-executor.js';

describe('US-127: Booking Precondition Validator', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('AC1: should allow step execution when payment_method_provided is satisfied', () => {
    const state: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: { payment_method: 'credit_card' },
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const violations = validateBookingStepPreconditions(
      'payment_charge',
      ['payment_method_provided'],
      state
    );

    expect(violations).toHaveLength(0);
  });

  it('AC1: should prevent execution when payment_method_provided is violated', () => {
    const state: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: {},
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const violations = validateBookingStepPreconditions(
      'payment_charge',
      ['payment_method_provided'],
      state
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].step_id).toBe('payment_charge');
    expect(violations[0].required_precondition).toBe('payment_method_provided');
  });

  it('AC1: should log violation reason with step_id and required_precondition', () => {
    const state: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: {},
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    validateBookingStepPreconditions(
      'payment_charge',
      ['payment_method_provided'],
      state
    );

    expect(consoleSpy).toHaveBeenCalled();
    const callArgs = consoleSpy.mock.calls[0][0];
    expect(callArgs).toContain('step_id=payment_charge');
    expect(callArgs).toContain('required_precondition=payment_method_provided');
  });

  it('should validate guest_verified precondition', () => {
    const stateWithGuest: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: { guest_name: 'John Doe' },
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const violations = validateBookingStepPreconditions(
      'confirm_booking',
      ['guest_verified'],
      stateWithGuest
    );

    expect(violations).toHaveLength(0);
  });

  it('should detect missing guest_verified', () => {
    const state: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: {},
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const violations = validateBookingStepPreconditions(
      'confirm_booking',
      ['guest_verified'],
      state
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].required_precondition).toBe('guest_verified');
  });

  it('should validate checkin_date_not_past precondition', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const state: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: {
        booking_dates: '15 Feb',
        booking_dates_normalized: JSON.stringify({
          checkIn: tomorrow.toISOString(),
          checkOut: new Date(tomorrow.getTime() + 86400000).toISOString(),
        }),
      },
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const violations = validateBookingStepPreconditions(
      'check_in',
      ['checkin_date_not_past'],
      state
    );

    expect(violations).toHaveLength(0);
  });

  it('should detect past check-in date violation', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const state: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: {
        booking_dates: '10 Feb',
        booking_dates_normalized: JSON.stringify({
          checkIn: yesterday.toISOString(),
          checkOut: new Date(yesterday.getTime() + 86400000).toISOString(),
        }),
      },
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const violations = validateBookingStepPreconditions(
      'check_in',
      ['checkin_date_not_past'],
      state
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain('past');
  });

  it('should validate room_available precondition', () => {
    const state: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: { unit_selected: 'room_101' },
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const violations = validateBookingStepPreconditions(
      'check_in',
      ['room_available'],
      state
    );

    expect(violations).toHaveLength(0);
  });

  it('should validate multiple preconditions and return all violations', () => {
    const state: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: {},
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const violations = validateBookingStepPreconditions(
      'payment_charge',
      ['payment_method_provided', 'guest_verified', 'checkin_date_not_past'],
      state
    );

    expect(violations).toHaveLength(3);
    expect(violations.map(v => v.required_precondition)).toEqual([
      'payment_method_provided',
      'guest_verified',
      'checkin_date_not_past',
    ]);
  });

  it('should return empty violations for empty preconditions array', () => {
    const state: WorkflowState = {
      workflowId: 'booking_test',
      currentStepIndex: 0,
      collectedData: {},
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
    };

    const violations = validateBookingStepPreconditions('test_step', [], state);
    expect(violations).toHaveLength(0);
  });
});
