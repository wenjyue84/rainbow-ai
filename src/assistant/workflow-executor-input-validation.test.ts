/**
 * US-560: Booking Workflow Step Input Validation with Regex Patterns Tests
 */

import { describe, it, expect } from 'vitest';
import { validateStepInputRegex } from './workflow-executor.js';

describe('validateStepInputRegex (US-560)', () => {
  describe('No regex pattern (validation disabled)', () => {
    it('should pass validation when regex pattern is undefined', () => {
      const result = validateStepInputRegex('any input', undefined, 'test_step');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should pass validation when regex pattern is empty string', () => {
      const result = validateStepInputRegex('anything', '', 'test_step');
      expect(result.valid).toBe(true);
    });

    it('should pass validation with empty user input if no regex', () => {
      const result = validateStepInputRegex('', undefined, 'test_step');
      expect(result.valid).toBe(true);
    });
  });

  describe('Empty user input with regex defined', () => {
    it('should fail validation when user input is empty and regex is defined', () => {
      const result = validateStepInputRegex('', '^\\d+$', 'test_step');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires input');
    });

    it('should fail validation when user input is whitespace-only', () => {
      const result = validateStepInputRegex('   ', '^\\d+$', 'room_number');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires input');
    });

    it('should fail validation when user input is undefined', () => {
      const result = validateStepInputRegex(undefined, '^[a-z]+$', 'name_step');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires input');
    });
  });

  describe('Numeric validation (room numbers)', () => {
    const roomRegex = '^[0-9]+$';

    it('should accept valid numeric input', () => {
      const result = validateStepInputRegex('123', roomRegex, 'select_room');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept single digit room numbers', () => {
      const result = validateStepInputRegex('5', roomRegex, 'select_room');
      expect(result.valid).toBe(true);
    });

    it('should reject non-numeric input (letters)', () => {
      const result = validateStepInputRegex('room123', roomRegex, 'select_room');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Input validation failed');
    });

    it('should reject non-numeric input (special chars)', () => {
      const result = validateStepInputRegex('12!', roomRegex, 'select_room');
      expect(result.valid).toBe(false);
    });

    it('should reject negative numbers (if pattern excludes minus)', () => {
      const result = validateStepInputRegex('-5', roomRegex, 'select_room');
      expect(result.valid).toBe(false);
    });
  });

  describe('Date format validation (DD/MM/YYYY)', () => {
    const dateRegex = '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/\\d{4}$';

    it('should accept valid date format', () => {
      const result = validateStepInputRegex('25/12/2026', dateRegex, 'select_checkin_date');
      expect(result.valid).toBe(true);
    });

    it('should accept dates with leading zeros', () => {
      const result = validateStepInputRegex('01/01/2026', dateRegex, 'select_checkin_date');
      expect(result.valid).toBe(true);
    });

    it('should reject dates without leading zeros (strict format)', () => {
      const result = validateStepInputRegex('5/3/2026', dateRegex, 'select_checkin_date');
      expect(result.valid).toBe(false);
    });

    it('should reject invalid day (32)', () => {
      const result = validateStepInputRegex('32/12/2026', dateRegex, 'select_checkin_date');
      expect(result.valid).toBe(false);
    });

    it('should reject invalid month (13)', () => {
      const result = validateStepInputRegex('25/13/2026', dateRegex, 'select_checkin_date');
      expect(result.valid).toBe(false);
    });

    it('should reject YYYY-MM-DD format when expecting DD/MM/YYYY', () => {
      const result = validateStepInputRegex('2026-12-25', dateRegex, 'select_checkin_date');
      expect(result.valid).toBe(false);
    });
  });

  describe('Case-insensitive confirmation (yes/confirm)', () => {
    const confirmRegex = '^(yes|confirm|ya|sahkan|是|确认)$';

    it('should accept "yes" (lowercase)', () => {
      const result = validateStepInputRegex('yes', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(true);
    });

    it('should accept "YES" (uppercase) due to case-insensitive flag', () => {
      const result = validateStepInputRegex('YES', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(true);
    });

    it('should accept "Yes" (mixed case)', () => {
      const result = validateStepInputRegex('Yes', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(true);
    });

    it('should accept "confirm"', () => {
      const result = validateStepInputRegex('confirm', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(true);
    });

    it('should accept Malay "ya"', () => {
      const result = validateStepInputRegex('ya', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(true);
    });

    it('should accept Malay "sahkan"', () => {
      const result = validateStepInputRegex('sahkan', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(true);
    });

    it('should accept Chinese "是"', () => {
      const result = validateStepInputRegex('是', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(true);
    });

    it('should accept Chinese "确认"', () => {
      const result = validateStepInputRegex('确认', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid confirmation', () => {
      const result = validateStepInputRegex('maybe', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(false);
    });

    it('should reject partial matches', () => {
      const result = validateStepInputRegex('yess', confirmRegex, 'confirm_step');
      expect(result.valid).toBe(false);
    });
  });

  describe('Malformed regex pattern handling', () => {
    it('should fail gracefully with malformed regex and return valid=true (fail-open)', () => {
      const malformedRegex = '^(?P<invalid>[a-z)+'; // Unclosed group
      const result = validateStepInputRegex('test', malformedRegex, 'step_id');

      // Should not throw, should fail-open
      expect(result.valid).toBe(true); // Fail-open behavior
    });

    it('should fail gracefully with unescaped special chars', () => {
      const result = validateStepInputRegex('test', '[unclosed', 'step_id');
      expect(result.valid).toBe(true); // Fail-open
    });
  });

  describe('Combined regex patterns (date OR confirmation)', () => {
    // Pattern that allows either a date OR a confirmation keyword
    const dateOrConfirmRegex = '^(\\d{1,2}/\\d{1,2}/\\d{4}|yes|confirm|ya|sahkan|是|确认)$';

    it('should accept valid date', () => {
      const result = validateStepInputRegex('25/12/2026', dateOrConfirmRegex, 'mixed_step');
      expect(result.valid).toBe(true);
    });

    it('should accept confirmation keyword', () => {
      const result = validateStepInputRegex('yes', dateOrConfirmRegex, 'mixed_step');
      expect(result.valid).toBe(true);
    });

    it('should reject neither date nor confirmation', () => {
      const result = validateStepInputRegex('invalid', dateOrConfirmRegex, 'mixed_step');
      expect(result.valid).toBe(false);
    });
  });

  describe('Guest count validation (numeric range)', () => {
    // Pattern that accepts numbers 1-10
    const guestCountRegex = '^([1-9]|10)$';

    it('should accept valid guest counts 1-9', () => {
      expect(validateStepInputRegex('1', guestCountRegex, 'guest_count').valid).toBe(true);
      expect(validateStepInputRegex('5', guestCountRegex, 'guest_count').valid).toBe(true);
      expect(validateStepInputRegex('9', guestCountRegex, 'guest_count').valid).toBe(true);
    });

    it('should accept guest count 10', () => {
      const result = validateStepInputRegex('10', guestCountRegex, 'guest_count');
      expect(result.valid).toBe(true);
    });

    it('should reject 0 (no guests)', () => {
      const result = validateStepInputRegex('0', guestCountRegex, 'guest_count');
      expect(result.valid).toBe(false);
    });

    it('should reject 11 (exceeds max)', () => {
      const result = validateStepInputRegex('11', guestCountRegex, 'guest_count');
      expect(result.valid).toBe(false);
    });

    it('should reject non-numeric input', () => {
      const result = validateStepInputRegex('five', guestCountRegex, 'guest_count');
      expect(result.valid).toBe(false);
    });
  });

  describe('Error message format', () => {
    it('should include step ID in error message', () => {
      const result = validateStepInputRegex('invalid', '^\\d+$', 'my_step_id');
      expect(result.error).toContain('my_step_id');
    });

    it('should provide user-friendly error message', () => {
      const result = validateStepInputRegex('abc', '^\\d+$', 'room_number');
      expect(result.error).toContain('validation failed');
      expect(result.error?.toLowerCase()).toContain('format');
    });
  });
});
