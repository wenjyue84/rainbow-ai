/**
 * Unit Tests for US-547: Profile-Specific Booking Rules Validator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BookingValidator, validateBookingRules, type BookingRequest } from '../../src/lib/booking-rules-validator.js';

describe('BookingValidator', () => {
  let validator: BookingValidator;

  beforeEach(() => {
    validator = new BookingValidator('pelangi');
  });

  describe('Guest Count Validation', () => {
    it('should pass with valid guest count (within limits)', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(true);
      expect(result.errors.filter(e => e.code === 'guest_count_exceeds_capacity')).toHaveLength(0);
    });

    it('should fail when guest count exceeds unit capacity (pelangi max 4)', async () => {
      const request: BookingRequest = {
        guestCount: 5,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'guest_count_exceeds_capacity',
            message: expect.stringContaining('Unit capacity is 4 guests')
          })
        ])
      );
    });

    it('should fail when guest count is below minimum (pelangi min 1)', async () => {
      const request: BookingRequest = {
        guestCount: 0,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'guest_count_too_low'
          })
        ])
      );
    });

    it('should include actionable error message with capacity details', async () => {
      const request: BookingRequest = {
        guestCount: 6,
      };

      const result = await validator.validate(request);
      expect(result.errors[0].message).toMatch(/Unit capacity is 4 guests/);
      expect(result.errors[0].message).toMatch(/you requested 6/);
    });
  });

  describe('Date Range Validation', () => {
    it('should pass with valid date range (check-out > check-in)', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(true);
      expect(result.errors.filter(e => e.code === 'invalid_date_range')).toHaveLength(0);
    });

    it('should fail when check-out date equals check-in date', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-01'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_date_range'
          })
        ])
      );
    });

    it('should fail when check-out date is before check-in date', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-05',
        checkOutDate: '2026-05-01'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_date_range'
          })
        ])
      );
    });

    it('should fail when check-in date is in the past', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: pastDate,
        checkOutDate: new Date(pastDate.getTime() + 2 * 24 * 60 * 60 * 1000)
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'checkin_date_in_past'
          })
        ])
      );
    });
  });

  describe('Stay Duration Validation', () => {
    it('should pass with minimum stay nights (pelangi min 1)', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-02' // 1 night
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(true);
      expect(result.errors.filter(e => e.code === 'stay_too_short')).toHaveLength(0);
    });

    it('should fail when stay is shorter than minimum (pelangi min 1)', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-01T12:00:00' // 0 nights
      };

      const result = await validator.validate(request);
      // This will be caught by invalid_date_range first
      expect(result.isValid).toBe(false);
    });

    it('should fail when stay exceeds maximum (pelangi max 90)', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-09-01' // 123 nights
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'stay_too_long',
            message: expect.stringContaining('123 night')
          })
        ])
      );
    });

    it('should pass with maximum stay nights (pelangi max 90)', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-07-30' // 90 nights
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(true);
      expect(result.errors.filter(e => e.code === 'stay_too_long')).toHaveLength(0);
    });
  });

  describe('Unit Type Validation', () => {
    it('should pass with allowed unit type (pelangi allows capsule, private-room, dorm)', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        unitType: 'capsule',
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(true);
      expect(result.errors.filter(e => e.code === 'unit_type_not_allowed')).toHaveLength(0);
    });

    it('should fail with disallowed unit type', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        unitType: 'villa',
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unit_type_not_allowed',
            message: expect.stringContaining('villa')
          })
        ])
      );
    });

    it('should include list of allowed unit types in error message', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        unitType: 'penthouse',
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validator.validate(request);
      expect(result.errors[0].message).toMatch(/capsule/);
      expect(result.errors[0].message).toMatch(/private-room/);
      expect(result.errors[0].message).toMatch(/dorm/);
    });
  });

  describe('Multiple Profile Support', () => {
    it('should validate against southern homestay constraints (max 8 guests)', async () => {
      const southernValidator = new BookingValidator('southern');

      const request: BookingRequest = {
        guestCount: 9,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await southernValidator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('Unit capacity is 8 guests')
          })
        ])
      );
    });

    it('should validate against southern homestay max stay (180 nights)', async () => {
      const southernValidator = new BookingValidator('southern');

      const request: BookingRequest = {
        guestCount: 4,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-12-31' // 244 nights
      };

      const result = await southernValidator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'stay_too_long',
            message: expect.stringContaining('180 night')
          })
        ])
      );
    });

    it('should validate southern homestay allowed unit types (room, suite, apartment)', async () => {
      const southernValidator = new BookingValidator('southern');

      const request: BookingRequest = {
        guestCount: 4,
        unitType: 'capsule',
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await southernValidator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('room')
          })
        ])
      );
    });
  });

  describe('Validation Result Structure', () => {
    it('should return isValid=true and empty errors array on successful validation', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return isValid=false with errors when validation fails', async () => {
      const request: BookingRequest = {
        guestCount: 10,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-02'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('each error should have code, message, and optional field', async () => {
      const request: BookingRequest = {
        guestCount: 10,
      };

      const result = await validator.validate(request);
      result.errors.forEach(err => {
        expect(err).toHaveProperty('code');
        expect(err).toHaveProperty('message');
        expect(typeof err.code).toBe('string');
        expect(typeof err.message).toBe('string');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined guest count gracefully', async () => {
      const request: BookingRequest = {
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(true);
    });

    it('should handle Date objects as well as string dates', async () => {
      const checkIn = new Date('2026-05-01');
      const checkOut = new Date('2026-05-03');

      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: checkIn,
        checkOutDate: checkOut
      };

      const result = await validator.validate(request);
      expect(result.isValid).toBe(true);
    });

    it('should handle various date formats (15 Feb, 15/2/2026, 2026-02-15)', async () => {
      // These should all parse correctly and validate
      const requests = [
        { guestCount: 2, checkInDate: '15 May', checkOutDate: '17 May' },
        { guestCount: 2, checkInDate: '15/5/2026', checkOutDate: '17/5/2026' },
        { guestCount: 2, checkInDate: '2026-05-15', checkOutDate: '2026-05-17' }
      ];

      for (const req of requests) {
        const result = await validator.validate(req);
        expect(result.isValid).toBe(true);
      }
    });

    it('should handle missing profile gracefully', async () => {
      const invalidValidator = new BookingValidator('nonexistent-profile');
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await invalidValidator.validate(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'profile_not_found'
          })
        ])
      );
    });
  });

  describe('validateBookingRules function', () => {
    it('should create validator and validate request in one call', async () => {
      const request: BookingRequest = {
        guestCount: 2,
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03'
      };

      const result = await validateBookingRules(request, 'pelangi');
      expect(result.isValid).toBe(true);
    });

    it('should default to pelangi profile if not specified', async () => {
      const request: BookingRequest = {
        guestCount: 5,
      };

      const result = await validateBookingRules(request);
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('Unit capacity is 4')
          })
        ])
      );
    });
  });
});
