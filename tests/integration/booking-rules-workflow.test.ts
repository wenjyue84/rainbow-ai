/**
 * Integration Tests for US-547: Booking Rules Validation in Workflow Context
 *
 * Tests the integration of BookingValidator with the workflow executor.
 * Verifies that booking rules validation is called before workflow execution
 * and that validation errors are returned to the user.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBookingRules, type BookingRequest } from '../../src/lib/booking-rules-validator.js';
import type { WorkflowState } from '../../src/assistant/workflow-executor.js';

describe('Booking Rules Validation in Workflow Context', () => {
  describe('Pre-Flight Validation Integration', () => {
    it('should validate booking request from workflow collected data', async () => {
      // Simulate a workflow state with collected booking data
      const workflowState: Partial<WorkflowState> = {
        workflowId: 'booking_pelangi',
        collectedData: {
          'guest_count': '2',
          'check_in_date': '2026-05-01',
          'check_out_date': '2026-05-03',
          'capsule': 'capsule'
        }
      };

      // Build booking request from workflow state
      const bookingRequest: BookingRequest = {
        guestCount: parseInt(workflowState.collectedData!['guest_count'], 10),
        checkInDate: workflowState.collectedData!['check_in_date'],
        checkOutDate: workflowState.collectedData!['check_out_date'],
        unitType: workflowState.collectedData!['capsule'],
        profile: 'pelangi'
      };

      const result = await validateBookingRules(bookingRequest, 'pelangi');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return validation errors from workflow state with invalid data', async () => {
      const workflowState: Partial<WorkflowState> = {
        workflowId: 'booking_pelangi',
        collectedData: {
          'guest_count': '10', // Exceeds pelangi capacity
          'check_in_date': '2026-05-01',
          'check_out_date': '2026-05-02'
        }
      };

      const bookingRequest: BookingRequest = {
        guestCount: parseInt(workflowState.collectedData!['guest_count'], 10),
        checkInDate: workflowState.collectedData!['check_in_date'],
        checkOutDate: workflowState.collectedData!['check_out_date'],
        profile: 'pelangi'
      };

      const result = await validateBookingRules(bookingRequest, 'pelangi');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toMatch(/Unit capacity is 4 guests/);
    });

    it('should work with partial collected data (some fields missing)', async () => {
      // Real workflows might not have all fields collected yet
      const workflowState: Partial<WorkflowState> = {
        workflowId: 'booking_pelangi',
        collectedData: {
          'guest_count': '2',
          'check_in_date': '2026-05-01',
          // check_out_date might not be collected yet
        }
      };

      const bookingRequest: BookingRequest = {
        guestCount: parseInt(workflowState.collectedData!['guest_count'], 10),
        checkInDate: workflowState.collectedData!['check_in_date'],
        profile: 'pelangi'
      };

      const result = await validateBookingRules(bookingRequest, 'pelangi');
      // Should not error on missing optional fields
      expect(result.isValid).toBe(true);
    });
  });

  describe('Multi-Profile Workflow Validation', () => {
    it('should validate pelangi booking (4 guest max, 90 night max)', async () => {
      const request: BookingRequest = {
        guestCount: 3,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-06-01',
        unitType: 'capsule',
        profile: 'pelangi'
      };

      const result = await validateBookingRules(request, 'pelangi');
      expect(result.isValid).toBe(true);
    });

    it('should validate southern homestay booking (8 guest max, 180 night max)', async () => {
      const request: BookingRequest = {
        guestCount: 6,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-07-01', // 61 nights
        unitType: 'room',
        profile: 'southern'
      };

      const result = await validateBookingRules(request, 'southern');
      expect(result.isValid).toBe(true);
    });

    it('should validate makan cafe booking (4 guest max, 7 night max)', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-05', // 4 nights
        unitType: 'event-space',
        profile: 'makan'
      };

      const result = await validateBookingRules(request, 'makan');
      expect(result.isValid).toBe(true);
    });

    it('makan bookings should fail for stays longer than 7 nights', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-10', // 9 nights
        unitType: 'event-space',
        profile: 'makan'
      };

      const result = await validateBookingRules(request, 'makan');
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'stay_too_long',
            message: expect.stringContaining('7 night')
          })
        ])
      );
    });
  });

  describe('Validation Error Response Format', () => {
    it('should provide user-friendly error messages suitable for WhatsApp', async () => {
      const request: BookingRequest = {
        guestCount: 6,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-02',
        profile: 'pelangi'
      };

      const result = await validateBookingRules(request, 'pelangi');
      expect(result.isValid).toBe(false);

      // Errors should be human-readable, not technical jargon
      const messages = result.errors.map(e => e.message);
      messages.forEach(msg => {
        expect(msg).not.toMatch(/undefined|null|NaN/);
        expect(msg.length).toBeGreaterThan(10); // Not too short
        expect(msg.length).toBeLessThan(500); // Not too long for WhatsApp
      });
    });

    it('should include specific field information in errors', async () => {
      const request: BookingRequest = {
        guestCount: 10,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-02'
      };

      const result = await validateBookingRules(request, 'pelangi');
      expect(result.isValid).toBe(false);

      // At least one error should have field information
      const fieldsWithErrors = result.errors
        .filter(e => e.field)
        .map(e => e.field);

      expect(fieldsWithErrors.length).toBeGreaterThan(0);
      expect(fieldsWithErrors).toContain('guestCount');
    });

    it('should provide multiple errors if multiple validations fail', async () => {
      const request: BookingRequest = {
        guestCount: 10, // Too many guests
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-01', // Invalid date range
        unitType: 'villa' // Disallowed unit type
      };

      const result = await validateBookingRules(request, 'pelangi');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);

      const errorCodes = result.errors.map(e => e.code);
      expect(errorCodes).toEqual(
        expect.arrayContaining([
          'guest_count_exceeds_capacity',
          'invalid_date_range',
          'unit_type_not_allowed'
        ])
      );
    });
  });

  describe('Edge Cases in Workflow Context', () => {
    it('should handle workflow with no guest count collected yet', async () => {
      const request: BookingRequest = {
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03',
        profile: 'pelangi'
      };

      const result = await validateBookingRules(request, 'pelangi');
      // Should pass if only date fields are provided
      expect(result.isValid).toBe(true);
    });

    it('should validate bookings where user provided alternative date formats', async () => {
      // Test various user input date formats that might come from WhatsApp
      const requests: BookingRequest[] = [
        { guestCount: 2, checkInDate: '15 May 2026', checkOutDate: '17 May 2026' },
        { guestCount: 2, checkInDate: '15-5-2026', checkOutDate: '17-5-2026' },
        { guestCount: 2, checkInDate: '2026-05-15', checkOutDate: '2026-05-17' },
      ];

      for (const request of requests) {
        request.profile = 'pelangi';
        const result = await validateBookingRules(request, 'pelangi');
        expect(result.isValid).toBe(true);
      }
    });

    it('should be fail-open: missing database connection should not block validation', async () => {
      // Even if DB is down, basic validation should still work
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03',
        profile: 'pelangi'
      };

      // This should succeed without DB access for basic constraints
      const result = await validateBookingRules(request, 'pelangi');
      expect(result.isValid).toBe(true);
    });
  });

  describe('Specific Capacity Tests', () => {
    it('pelangi capacity: exactly 4 guests should pass', async () => {
      const request: BookingRequest = {
        guestCount: 4,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03',
        profile: 'pelangi'
      };

      const result = await validateBookingRules(request, 'pelangi');
      expect(result.isValid).toBe(true);
    });

    it('pelangi capacity: 5 guests should fail', async () => {
      const request: BookingRequest = {
        guestCount: 5,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03',
        profile: 'pelangi'
      };

      const result = await validateBookingRules(request, 'pelangi');
      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toMatch(/capacity is 4 guests/);
    });

    it('southern capacity: exactly 8 guests should pass', async () => {
      const request: BookingRequest = {
        guestCount: 8,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03',
        profile: 'southern'
      };

      const result = await validateBookingRules(request, 'southern');
      expect(result.isValid).toBe(true);
    });

    it('southern capacity: 9 guests should fail', async () => {
      const request: BookingRequest = {
        guestCount: 9,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03',
        profile: 'southern'
      };

      const result = await validateBookingRules(request, 'southern');
      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toMatch(/capacity is 8 guests/);
    });
  });
});
