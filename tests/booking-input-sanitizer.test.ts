/**
 * US-490: Booking Input Sanitizer Tests
 *
 * Tests for profile-specific booking validation and sanitization.
 * Covers all three profiles (makan, southern, pelangi) with 15+ assertions.
 */

import { describe, it, expect } from 'vitest';
import {
  createProfileSanitizer,
  validateBookingInput,
  sanitizeGuestInfo,
  buildProfileRules,
  type BookingInput,
  type ProfileSpecificRules,
} from '../src/lib/booking-input-sanitizer.js';

describe('US-490: Booking Input Sanitizer', () => {
  // ─── Test: Makan Profile (max 4 guests) ──────────────────────────────

  describe('Makan Profile Validation', () => {
    const makanRules = buildProfileRules('makan');
    const makanSanitizer = createProfileSanitizer('makan');

    it('should accept makan bookings with max 4 guests', () => {
      const input: BookingInput = {
        profile: 'makan',
        guestName: 'John Doe',
        guestPhone: '+60123456789',
        guestCount: 4,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
        unitType: 'private-room',
      };

      const result = makanSanitizer(input);
      expect(result.valid).toBe(true);
      expect(result.sanitized?.guestCount).toBe(4);
      expect(result.violations).toHaveLength(0);
    });

    it('should reject makan bookings with more than 4 guests', () => {
      const input: BookingInput = {
        profile: 'makan',
        guestCount: 5,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = makanSanitizer(input);
      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'guestCount',
            issue: expect.stringContaining('Maximum 4 guests'),
            severity: 'error',
          }),
        ])
      );
    });

    it('should reject invalid unit types for makan', () => {
      const input: BookingInput = {
        profile: 'makan',
        unitType: 'capsule',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = makanSanitizer(input);
      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'unitType',
            severity: 'error',
          }),
        ])
      );
    });

    it('should accept allowed unit types for makan (private-room, event-space)', () => {
      for (const unitType of ['private-room', 'event-space']) {
        const input: BookingInput = {
          profile: 'makan',
          unitType,
          checkInDate: '2026-04-20',
          checkOutDate: '2026-04-21',
        };

        const result = makanSanitizer(input);
        expect(result.violations.filter(v => v.field === 'unitType')).toHaveLength(0);
      }
    });
  });

  // ─── Test: Southern Profile (max 8 guests) ───────────────────────────

  describe('Southern Profile Validation', () => {
    const southernRules = buildProfileRules('southern');
    const southernSanitizer = createProfileSanitizer('southern');

    it('should accept southern bookings with up to 8 guests', () => {
      const input: BookingInput = {
        profile: 'southern',
        guestName: 'Alice Smith',
        guestCount: 8,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-22',
      };

      const result = southernSanitizer(input);
      expect(result.valid).toBe(true);
      expect(result.sanitized?.guestCount).toBe(8);
    });

    it('should reject southern bookings with more than 8 guests', () => {
      const input: BookingInput = {
        profile: 'southern',
        guestCount: 9,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-22',
      };

      const result = southernSanitizer(input);
      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issue: expect.stringContaining('Maximum 8 guests'),
          }),
        ])
      );
    });

    it('should accept allowed unit types for southern (room, suite, apartment)', () => {
      for (const unitType of ['room', 'suite', 'apartment']) {
        const input: BookingInput = {
          profile: 'southern',
          unitType,
          checkInDate: '2026-04-20',
          checkOutDate: '2026-04-22',
        };

        const result = southernSanitizer(input);
        const unitViolations = result.violations.filter(v => v.field === 'unitType');
        expect(unitViolations).toHaveLength(0);
      }
    });
  });

  // ─── Test: Pelangi Profile (unit-specific constraints) ────────────────

  describe('Pelangi Profile Validation', () => {
    const pelangiRules = buildProfileRules('pelangi');
    const pelangiSanitizer = createProfileSanitizer('pelangi');

    it('should accept pelangi bookings with max 4 guests', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestName: 'Bob Johnson',
        guestCount: 4,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
        unitType: 'capsule',
      };

      const result = pelangiSanitizer(input);
      expect(result.valid).toBe(true);
      expect(result.sanitized?.guestCount).toBe(4);
    });

    it('should reject pelangi bookings with more than 4 guests', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestCount: 5,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = pelangiSanitizer(input);
      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issue: expect.stringContaining('Maximum 4 guests'),
          }),
        ])
      );
    });

    it('should accept allowed unit types for pelangi (capsule, private-room, dorm)', () => {
      for (const unitType of ['capsule', 'private-room', 'dorm']) {
        const input: BookingInput = {
          profile: 'pelangi',
          unitType,
          checkInDate: '2026-04-20',
          checkOutDate: '2026-04-21',
        };

        const result = pelangiSanitizer(input);
        const unitViolations = result.violations.filter(v => v.field === 'unitType');
        expect(unitViolations).toHaveLength(0);
      }
    });
  });

  // ─── Test: Date Validation (all profiles) ────────────────────────────

  describe('Date Range Validation', () => {
    const sanitizer = createProfileSanitizer('pelangi');

    it('should accept valid ISO format dates', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-22',
      };

      const result = sanitizer(input);
      expect(result.violations.filter(v => v.field.includes('Date'))).toHaveLength(0);
    });

    it('should accept DD/MM/YYYY format dates', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        checkInDate: '20/04/2026',
        checkOutDate: '22/04/2026',
      };

      const result = sanitizer(input);
      expect(result.violations.filter(v => v.field.includes('Date'))).toHaveLength(0);
    });

    it('should reject when check-out is before or equal to check-in', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        checkInDate: '2026-04-22',
        checkOutDate: '2026-04-20',
      };

      const result = sanitizer(input);
      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issue: expect.stringContaining('must be after'),
          }),
        ])
      );
    });

    it('should validate minimum stay nights (pelangi: 1 night)', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-20', // 0 nights
      };

      const result = sanitizer(input);
      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issue: expect.stringContaining('must be after'),
          }),
        ])
      );
    });

    it('should validate maximum stay nights (pelangi: 90 nights)', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-07-19', // 90 nights exactly
      };

      const result = sanitizer(input);
      expect(result.valid).toBe(true);
    });

    it('should reject stay exceeding maximum nights (pelangi: > 90 nights)', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-07-20', // 91 nights
      };

      const result = sanitizer(input);
      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issue: expect.stringContaining('Maximum stay is 90 nights'),
          }),
        ])
      );
    });
  });

  // ─── Test: Guest Info Sanitization ─────────────────────────────────

  describe('Guest Info Sanitization', () => {
    it('should sanitize guest count from string', () => {
      const makanRules = buildProfileRules('makan');
      const result = sanitizeGuestInfo('3 people', makanRules);
      expect(result.sanitized).toBe(3);
      expect(result.violations).toHaveLength(0);
    });

    it('should reject non-numeric guest count', () => {
      const makanRules = buildProfileRules('makan');
      const result = sanitizeGuestInfo('abc', makanRules);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issue: expect.stringContaining('must be a number'),
          }),
        ])
      );
    });

    it('should enforce minimum guest count', () => {
      const makanRules = buildProfileRules('makan');
      const result = sanitizeGuestInfo(0, makanRules);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issue: expect.stringContaining('Minimum 1'),
          }),
        ])
      );
    });
  });

  // ─── Test: Contact Info Sanitization ──────────────────────────────

  describe('Contact Info Sanitization', () => {
    const sanitizer = createProfileSanitizer('pelangi');

    it('should accept valid phone numbers', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestPhone: '+60123456789',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = sanitizer(input);
      expect(result.violations.filter(v => v.field === 'guestPhone')).toHaveLength(0);
    });

    it('should clean phone number formatting', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestPhone: '+60 (123) 456-789',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = sanitizer(input);
      expect(result.sanitized?.guestPhone).toBe('+60123456789');
    });

    it('should accept valid email addresses', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestEmail: 'guest@example.com',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = sanitizer(input);
      expect(result.violations.filter(v => v.field === 'guestEmail')).toHaveLength(0);
    });

    it('should reject invalid email addresses', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestEmail: 'invalid-email',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = sanitizer(input);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'guestEmail',
            severity: 'warning',
          }),
        ])
      );
    });

    it('should lowercase email addresses', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestEmail: 'Guest@EXAMPLE.COM',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = sanitizer(input);
      expect(result.sanitized?.guestEmail).toBe('guest@example.com');
    });
  });

  // ─── Test: Text Sanitization ──────────────────────────────────────

  describe('Text Sanitization', () => {
    const sanitizer = createProfileSanitizer('pelangi');

    it('should trim guest name whitespace', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestName: '  John Doe  ',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = sanitizer(input);
      expect(result.sanitized?.guestName).toBe('John Doe');
    });

    it('should reject empty guest name', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestName: '   ',
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = sanitizer(input);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'guestName',
            issue: expect.stringContaining('cannot be empty'),
          }),
        ])
      );
    });

    it('should truncate long guest names with suggestion', () => {
      const longName = 'A'.repeat(101);
      const input: BookingInput = {
        profile: 'pelangi',
        guestName: longName,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = sanitizer(input);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'guestName',
            issue: expect.stringContaining('too long'),
            suggestion: expect.stringContaining('Truncate'),
          }),
        ])
      );
    });

    it('should truncate long special requests with suggestion', () => {
      const longRequest = 'A'.repeat(501);
      const input: BookingInput = {
        profile: 'pelangi',
        specialRequests: longRequest,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = sanitizer(input);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'specialRequests',
            severity: 'warning',
            suggestion: expect.stringContaining('Truncate'),
          }),
        ])
      );
    });
  });

  // ─── Test: Profile Switching and Defaults ────────────────────────────

  describe('Profile Switching', () => {
    it('should create sanitizer for any valid profile', () => {
      expect(() => createProfileSanitizer('pelangi')).not.toThrow();
      expect(() => createProfileSanitizer('southern')).not.toThrow();
      expect(() => createProfileSanitizer('makan')).not.toThrow();
    });

    it('should throw on invalid profile', () => {
      expect(() => createProfileSanitizer('invalid')).toThrow('Unknown profile');
    });

    it('should use correct constraints for each profile', () => {
      const makanSanitizer = createProfileSanitizer('makan');
      const southernSanitizer = createProfileSanitizer('southern');

      // Test same guest count on different profiles
      const input4: BookingInput = {
        profile: 'makan',
        guestCount: 4,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const input8: BookingInput = {
        profile: 'southern',
        guestCount: 8,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-22',
      };

      // Makan accepts 4 guests
      const result4 = makanSanitizer(input4);
      expect(result4.valid).toBe(true);

      // Southern accepts 8 guests
      const result8 = southernSanitizer(input8);
      expect(result8.valid).toBe(true);
    });
  });

  // ─── Test: buildProfileRules Override ────────────────────────────────

  describe('Custom Profile Rules', () => {
    it('should allow overriding default rules', () => {
      const customRules = buildProfileRules('pelangi', {
        maxGuests: 10, // Override default 4
      });

      expect(customRules.maxGuests).toBe(10);
      expect(customRules.minGuests).toBe(1); // Inherited default
    });

    it('should use overridden rules in validation', () => {
      const customRules = buildProfileRules('pelangi', { maxGuests: 6 });
      const input: BookingInput = {
        profile: 'pelangi',
        guestCount: 6,
        checkInDate: '2026-04-20',
        checkOutDate: '2026-04-21',
      };

      const result = validateBookingInput(input, customRules);
      expect(result.valid).toBe(true);
    });
  });

  // ─── Test: Error Accumulation ────────────────────────────────────────

  describe('Multiple Violations', () => {
    const sanitizer = createProfileSanitizer('pelangi');

    it('should accumulate multiple violations', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestName: 'A'.repeat(101), // Too long
        guestCount: 10, // Too many
        unitType: 'invalid-type',
        checkInDate: '2026-04-22',
        checkOutDate: '2026-04-20', // Check-out before check-in
      };

      const result = sanitizer(input);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(2);
    });

    it('should correctly identify error vs warning violations', () => {
      const input: BookingInput = {
        profile: 'pelangi',
        guestPhone: 'invalid', // Warning
        guestCount: 10, // Error
      };

      const result = sanitizer(input);
      expect(result.valid).toBe(false);

      const errors = result.violations.filter(v => v.severity === 'error');
      const warnings = result.violations.filter(v => v.severity === 'warning');

      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
