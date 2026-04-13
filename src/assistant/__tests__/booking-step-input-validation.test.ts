/**
 * US-560: Booking Workflow Step Input Validation With Regex Patterns Tests
 *
 * Tests for validating user input against regex patterns before step progression
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { validateStepInputRegex } from '../workflow-executor.js';

describe('BookingWorkflow - Step Input Validation (US-560)', () => {
  describe('validateStepInputRegex', () => {
    it('should pass validation when no regex pattern is defined', () => {
      const result = validateStepInputRegex('any input', undefined, 'test_step');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should fail validation when input is empty and regex is defined', () => {
      const result = validateStepInputRegex('', '^\\d+$', 'test_step');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires input');
    });

    it('should fail validation when input is whitespace-only and regex is defined', () => {
      const result = validateStepInputRegex('   ', '^\\d+$', 'test_step');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires input');
    });

    it('should fail validation when input is undefined and regex is defined', () => {
      const result = validateStepInputRegex(undefined, '^\\d+$', 'test_step');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires input');
    });

    // Date validation tests
    describe('Date validation (YYYY-MM-DD format)', () => {
      const dateRegex = '^\\d{4}-\\d{2}-\\d{2}$|^\\d{1,2}/\\d{1,2}/\\d{4}$';

      it('should accept valid DD/MM/YYYY date format', () => {
        const result = validateStepInputRegex('25/12/2026', dateRegex, 'check_in_date');
        expect(result.valid).toBe(true);
      });

      it('should accept valid single-digit date', () => {
        const result = validateStepInputRegex('5/1/2026', dateRegex, 'check_in_date');
        expect(result.valid).toBe(true);
      });

      it('should accept valid ISO 8601 date format', () => {
        const result = validateStepInputRegex('2026-12-25', dateRegex, 'check_in_date');
        expect(result.valid).toBe(true);
      });

      it('should reject invalid date format (wrong separator)', () => {
        const result = validateStepInputRegex('25-12-2026', dateRegex, 'check_in_date');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('validation failed');
      });

      it('should reject malformed date (no separators)', () => {
        const result = validateStepInputRegex('25122026', dateRegex, 'check_in_date');
        expect(result.valid).toBe(false);
      });
    });

    // Numeric validation tests
    describe('Numeric validation (room numbers, guest counts)', () => {
      const numericRegex = '^\\d+$';

      it('should accept numeric input (single digit)', () => {
        const result = validateStepInputRegex('1', numericRegex, 'guest_count');
        expect(result.valid).toBe(true);
      });

      it('should accept numeric input (multi-digit)', () => {
        const result = validateStepInputRegex('42', numericRegex, 'guest_count');
        expect(result.valid).toBe(true);
      });

      it('should accept numeric input with large numbers', () => {
        const result = validateStepInputRegex('999', numericRegex, 'room_number');
        expect(result.valid).toBe(true);
      });

      it('should reject non-numeric input', () => {
        const result = validateStepInputRegex('abc', numericRegex, 'room_number');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('validation failed');
      });

      it('should reject mixed alphanumeric input', () => {
        const result = validateStepInputRegex('room123', numericRegex, 'room_number');
        expect(result.valid).toBe(false);
      });

      it('should reject input with leading/trailing spaces', () => {
        const result = validateStepInputRegex(' 42 ', numericRegex, 'guest_count');
        expect(result.valid).toBe(false);
      });
    });

    // Confirmation keyword tests
    describe('Confirmation keywords (yes/no)', () => {
      const confirmationRegex = '^(yes|no|confirm|deny|ya|tidak|是|否)$';

      it('should accept "yes" confirmation', () => {
        const result = validateStepInputRegex('yes', confirmationRegex, 'confirm_step');
        expect(result.valid).toBe(true);
      });

      it('should accept "confirm" keyword', () => {
        const result = validateStepInputRegex('confirm', confirmationRegex, 'confirm_step');
        expect(result.valid).toBe(true);
      });

      it('should accept "no" keyword', () => {
        const result = validateStepInputRegex('no', confirmationRegex, 'confirm_step');
        expect(result.valid).toBe(true);
      });

      it('should accept Malay "ya" keyword', () => {
        const result = validateStepInputRegex('ya', confirmationRegex, 'confirm_step');
        expect(result.valid).toBe(true);
      });

      it('should accept Chinese "是" keyword', () => {
        const result = validateStepInputRegex('是', confirmationRegex, 'confirm_step');
        expect(result.valid).toBe(true);
      });

      it('should reject unrecognized keyword', () => {
        const result = validateStepInputRegex('maybe', confirmationRegex, 'confirm_step');
        expect(result.valid).toBe(false);
      });

      it('should be case-insensitive', () => {
        const result = validateStepInputRegex('YES', confirmationRegex, 'confirm_step');
        expect(result.valid).toBe(true);
      });

      it('should be case-insensitive for confirm keyword', () => {
        const result = validateStepInputRegex('CONFIRM', confirmationRegex, 'confirm_step');
        expect(result.valid).toBe(true);
      });
    });

    // Booking workflow integration tests
    describe('Booking workflow steps', () => {
      const checkInDateRegex = '^(yes|confirm|ya|sahkan|是|确认|\\d{1,2}/\\d{1,2}/\\d{4})$';
      const guestCountRegex = '^(yes|confirm|ya|sahkan|是|确认|\\d+)$';

      it('should validate check-in date with date input', () => {
        const result = validateStepInputRegex('25/12/2026', checkInDateRegex, 'select_checkin_date');
        expect(result.valid).toBe(true);
      });

      it('should validate check-in date with confirmation keyword', () => {
        const result = validateStepInputRegex('confirm', checkInDateRegex, 'select_checkin_date');
        expect(result.valid).toBe(true);
      });

      it('should reject invalid check-in date format', () => {
        const result = validateStepInputRegex('2026-12-25', checkInDateRegex, 'select_checkin_date');
        expect(result.valid).toBe(false);
      });

      it('should validate guest count with numeric input', () => {
        const result = validateStepInputRegex('4', guestCountRegex, 'select_guest_count');
        expect(result.valid).toBe(true);
      });

      it('should validate guest count with confirmation keyword', () => {
        const result = validateStepInputRegex('yes', guestCountRegex, 'select_guest_count');
        expect(result.valid).toBe(true);
      });

      it('should reject non-numeric guest count', () => {
        const result = validateStepInputRegex('many guests', guestCountRegex, 'select_guest_count');
        expect(result.valid).toBe(false);
      });
    });

    // Edge cases and error handling
    describe('Error handling and edge cases', () => {
      it('should handle malformed regex gracefully (fail-open)', () => {
        const result = validateStepInputRegex('test input', '[invalid(regex', 'step');
        // Should fail-open and return valid: true to not block the workflow
        expect(result.valid).toBe(true);
      });

      it('should handle very long input strings', () => {
        const longInput = 'a'.repeat(1000);
        const result = validateStepInputRegex(longInput, '^a+$', 'long_step');
        expect(result.valid).toBe(true);
      });

      it('should include step ID in error message', () => {
        const result = validateStepInputRegex('invalid', '^\\d+$', 'my_special_step');
        expect(result.error).toContain('my_special_step');
      });

      it('should handle special regex characters in user input', () => {
        const regex = '^[a-zA-Z0-9!@#$%^&*()]+$';
        const result = validateStepInputRegex('test@123', regex, 'step');
        expect(result.valid).toBe(true);
      });
    });
  });
});
