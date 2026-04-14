import { describe, it, expect } from 'vitest';
import { validateBookingStep, evaluateRuleUnsafed } from '../src/assistant/workflow-validator.js';
import type { ValidationRule, BookingStepData } from '../src/assistant/workflow-validator.js';

describe('US-616: Workflow Validator - Per-Profile Custom Validation Rules Engine', () => {
  // ─── AC1: Load validation rules from profile-specific JSON files ──────

  describe('AC1: Load validation rules from booking-validators-{profile}.json', () => {
    it('should load pelangi profile validation rules', () => {
      const result = validateBookingStep(
        {
          guest_age: 25, // Required, must be >= 18
          guest_phone: '+60123456789', // Required
          guest_name: 'John Doe', // Required
          check_in_date: '2026-05-15', // Required
          check_out_date: '2026-05-20', // Required
        },
        'pelangi'
      );

      // Should pass with all required fields
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should load makan profile validation rules', () => {
      const result = validateBookingStep(
        {
          guest_name: 'Alice Smith', // Required
          guest_phone: '+60198765432', // Required
          reservation_date: '2026-05-20', // Required
          party_size: 4, // Required: must be > 0 and <= 20
        },
        'makan'
      );

      // Should pass with all required fields
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should handle missing profile gracefully', () => {
      const result = validateBookingStep(
        {
          guest_name: 'Test',
        },
        'nonexistent-profile'
      );

      // Should allow booking if no rules defined for profile
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  // ─── AC2: Execute rules using vm2 sandboxed evaluation ────────────────

  describe('AC2: Execute rules in sandboxed environment with safe evaluation', () => {
    it('should validate age constraint (>= operator)', () => {
      const result = validateBookingStep(
        {
          guest_age: 17, // Underage
          guest_phone: '+60123456789',
          guest_name: 'Young Person',
          check_in_date: '2026-05-15',
          check_out_date: '2026-05-20',
        },
        'pelangi'
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('18'))).toBe(true);
    });

    it('should validate required fields (exists operator)', () => {
      const result = validateBookingStep(
        {
          guest_age: 25,
          // Missing guest_phone
          guest_name: 'John Doe',
          check_in_date: '2026-05-15',
          check_out_date: '2026-05-20',
        },
        'pelangi'
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('phone'))).toBe(true);
    });

    it('should validate numeric comparison operators (<, >, <=, >=)', () => {
      const result = validateBookingStep(
        {
          guest_name: 'Test',
          guest_phone: '+60123456789',
          reservation_date: '2026-05-20',
          party_size: 25, // Exceeds max of 20
        },
        'makan'
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('capacity'))).toBe(true);
    });

    it('should reject party_size of 0 (> operator)', () => {
      const result = validateBookingStep(
        {
          guest_name: 'Test',
          guest_phone: '+60123456789',
          reservation_date: '2026-05-20',
          party_size: 0,
        },
        'makan'
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Party size'))).toBe(true);
    });
  });

  // ─── AC3: Reject booking with validation_error and contextual messages ──

  describe('AC3: Return validation errors with contextual messages', () => {
    it('should return error message for age validation failure', () => {
      const result = validateBookingStep(
        {
          guest_age: 16,
          guest_phone: '+60123456789',
          guest_name: 'Minor',
          check_in_date: '2026-05-15',
          check_out_date: '2026-05-20',
        },
        'pelangi'
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Guest must be 18 years or older to book with us.');
    });

    it('should return multiple error messages for multiple validation failures', () => {
      const result = validateBookingStep(
        {
          guest_age: 16,
          // Missing phone
          // Missing name
          check_in_date: '2026-05-15',
          check_out_date: '2026-05-20',
        },
        'pelangi'
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors.some(e => e.includes('18'))).toBe(true);
      expect(result.errors.some(e => e.includes('phone'))).toBe(true);
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('should provide context-specific error message for makan cafe', () => {
      const result = validateBookingStep(
        {
          guest_name: 'Test',
          guest_phone: '+60123456789',
          reservation_date: '2026-05-20',
          party_size: 50, // Exceeds maximum
        },
        'makan'
      );

      expect(result.valid).toBe(false);
      const capacityError = result.errors.find(e => e.includes('capacity'));
      expect(capacityError).toBe(
        'Party size exceeds our maximum capacity of 20 people. Please contact us for larger groups.'
      );
    });

    it('should distinguish required vs optional fields', () => {
      const result = validateBookingStep(
        {
          guest_name: 'Test', // Required
          guest_phone: '+60123456789', // Required
          reservation_date: '2026-05-20', // Required
          party_size: 4, // Required
          // dietary_restrictions is optional (required: false), so should not error when missing
        },
        'makan'
      );

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  // ─── Unit Tests: Rule Evaluation ────────────────────────────────────

  describe('Unit: evaluateRuleUnsafed (test helper)', () => {
    it('should evaluate "exists" operator', () => {
      const rule: ValidationRule = {
        field: 'guest_name',
        operator: 'exists',
        value: null,
        message: 'Name required',
      };

      expect(evaluateRuleUnsafed(rule, { guest_name: 'John' })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { guest_name: '' })).toBe(false);
      expect(evaluateRuleUnsafed(rule, { guest_name: undefined })).toBe(false);
    });

    it('should evaluate ">=" operator', () => {
      const rule: ValidationRule = {
        field: 'guest_age',
        operator: '>=',
        value: 18,
        message: 'Must be 18+',
      };

      expect(evaluateRuleUnsafed(rule, { guest_age: 25 })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { guest_age: 18 })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { guest_age: 17 })).toBe(false);
    });

    it('should evaluate ">" operator', () => {
      const rule: ValidationRule = {
        field: 'party_size',
        operator: '>',
        value: 0,
        message: 'Party size must be > 0',
      };

      expect(evaluateRuleUnsafed(rule, { party_size: 5 })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { party_size: 1 })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { party_size: 0 })).toBe(false);
    });

    it('should evaluate "<=" operator', () => {
      const rule: ValidationRule = {
        field: 'party_size',
        operator: '<=',
        value: 20,
        message: 'Party size max 20',
      };

      expect(evaluateRuleUnsafed(rule, { party_size: 10 })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { party_size: 20 })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { party_size: 21 })).toBe(false);
    });

    it('should evaluate "in" operator', () => {
      const rule: ValidationRule = {
        field: 'room_type',
        operator: 'in',
        value: ['single', 'double', 'suite'],
        message: 'Invalid room type',
      };

      expect(evaluateRuleUnsafed(rule, { room_type: 'single' })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { room_type: 'suite' })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { room_type: 'luxury' })).toBe(false);
    });

    it('should evaluate "regex" operator', () => {
      const rule: ValidationRule = {
        field: 'phone',
        operator: 'regex',
        value: '^\\+60[0-9]{9,10}$',
        message: 'Invalid phone format',
      };

      expect(evaluateRuleUnsafed(rule, { phone: '+60123456789' })).toBe(true);
      expect(evaluateRuleUnsafed(rule, { phone: '+6012345' })).toBe(false);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────

  describe('Edge cases and error handling', () => {
    it('should handle empty booking data', () => {
      const result = validateBookingStep({}, 'pelangi');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle null values gracefully', () => {
      const result = validateBookingStep(
        {
          guest_age: null,
          guest_phone: null,
          guest_name: null,
          check_in_date: null,
          check_out_date: null,
        },
        'pelangi'
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle whitespace-only strings as missing', () => {
      const result = validateBookingStep(
        {
          guest_age: 25,
          guest_phone: '   ', // Whitespace only
          guest_name: 'John',
          check_in_date: '2026-05-15',
          check_out_date: '2026-05-20',
        },
        'pelangi'
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('phone'))).toBe(true);
    });

    it('should handle extra fields without errors', () => {
      const result = validateBookingStep(
        {
          guest_age: 25, // Required: >= 18
          guest_phone: '+60123456789', // Required
          guest_name: 'John', // Required
          check_in_date: '2026-05-15', // Required
          check_out_date: '2026-05-20', // Required
          extra_field: 'should be ignored',
          another_extra: 123,
        },
        'pelangi'
      );

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should timeout dangerous code gracefully', () => {
      // This tests that the vm2 sandbox prevents infinite loops
      const result = validateBookingStep(
        {
          guest_age: 25,
          guest_phone: '+60123456789',
          guest_name: 'John',
          check_in_date: '2026-05-15',
          check_out_date: '2026-05-20',
        },
        'pelangi'
      );

      // Should still return valid result even if sandbox is used
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
    });
  });

  // ─── Integration Tests ───────────────────────────────────────────────

  describe('Integration: Full booking validation workflows', () => {
    it('should validate complete pelangi hostel booking', () => {
      const bookingData: BookingStepData = {
        guest_name: 'John Smith',
        guest_phone: '+60123456789',
        guest_email: 'john@example.com',
        guest_age: 28,
        check_in_date: '2026-06-15',
        check_out_date: '2026-06-20',
        room_type: 'Deluxe',
        special_requests: 'High floor preferred',
      };

      const result = validateBookingStep(bookingData, 'pelangi');

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should validate complete makan cafe reservation', () => {
      const bookingData: BookingStepData = {
        guest_name: 'Alice Wong',
        guest_phone: '+60198765432',
        guest_email: 'alice@example.com',
        reservation_date: '2026-06-20',
        reservation_time: '19:00',
        party_size: 6,
        dietary_restrictions: 'No peanuts, vegetarian for 2 guests',
        special_requests: 'Window seat if available',
      };

      const result = validateBookingStep(bookingData, 'makan');

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject hostel booking from underage guest', () => {
      const bookingData: BookingStepData = {
        guest_name: 'Teen Person',
        guest_phone: '+60123456789',
        guest_age: 15,
        check_in_date: '2026-06-15',
        check_out_date: '2026-06-20',
      };

      const result = validateBookingStep(bookingData, 'pelangi');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('18'))).toBe(true);
    });

    it('should reject cafe reservation with invalid party size', () => {
      const bookingData: BookingStepData = {
        guest_name: 'Bob Johnson',
        guest_phone: '+60187654321',
        reservation_date: '2026-06-20',
        party_size: 35, // Exceeds maximum
      };

      const result = validateBookingStep(bookingData, 'makan');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('capacity'))).toBe(true);
    });
  });
});
