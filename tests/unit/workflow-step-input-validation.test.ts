/**
 * US-354: Workflow Step Input Schema Validator Tests
 * Tests validateStepInput function with booking workflow steps
 */

import { describe, it, expect } from 'vitest';
import { validateStepInput, type ValidationResult } from '../../src/assistant/pipeline/workflow-executor.js';
import type { WorkflowStep } from '../../src/assistant/schemas.js';

describe('WorkflowStepInputValidator', () => {
  describe('validateStepInput - basic validation', () => {
    it('should pass validation when input matches schema', () => {
      const step: WorkflowStep = {
        id: 'check-availability',
        message: { en: 'Check rooms', ms: 'Semak bilik', zh: '检查房间' },
        waitForReply: true,
        inputSchema: {
          roomType: 'string',
          checkIn: 'Date',
          checkOut: 'Date',
          guestCount: 'number'
        }
      };

      const input = {
        roomType: 'double',
        checkIn: '2026-03-25',
        checkOut: '2026-03-27',
        guestCount: 2
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should skip validation when inputSchema is not defined', () => {
      const step: WorkflowStep = {
        id: 'send-confirmation',
        message: { en: 'Confirmed', ms: 'Dikonfirmasi', zh: '已确认' },
        waitForReply: false
      };

      const input = { randomField: 'randomValue' };
      const result = validateStepInput(step, input);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should skip validation when inputSchema is empty', () => {
      const step: WorkflowStep = {
        id: 'send-confirmation',
        message: { en: 'Confirmed', ms: 'Dikonfirmasi', zh: '已确认' },
        waitForReply: false,
        inputSchema: {}
      };

      const input = { randomField: 'randomValue' };
      const result = validateStepInput(step, input);

      expect(result.success).toBe(true);
    });
  });

  describe('validateStepInput - type mismatches', () => {
    it('should fail when string field receives number', () => {
      const step: WorkflowStep = {
        id: 'collect-name',
        message: { en: 'Name?', ms: 'Nama?', zh: '名字?' },
        waitForReply: true,
        inputSchema: {
          guestName: 'string',
          email: 'string'
        }
      };

      const input = {
        guestName: 12345,  // Wrong type
        email: 'guest@example.com'
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(false);
      expect(result.error).toContain('guestName');
      expect(result.error).toContain('number');
      expect(result.error).toContain('string');
      expect(result.actualFields).toEqual({
        guestName: 'number',
        email: 'string'
      });
    });

    it('should fail when number field receives string', () => {
      const step: WorkflowStep = {
        id: 'collect-guest-count',
        message: { en: 'How many guests?', ms: 'Berapa tetamu?', zh: '多少位客人?' },
        waitForReply: true,
        inputSchema: {
          guestCount: 'number'
        }
      };

      const input = {
        guestCount: '5'  // String instead of number
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(false);
      expect(result.error).toContain('guestCount');
      expect(result.error).toContain('string');
      expect(result.error).toContain('number');
    });

    it('should fail when Date field receives wrong type', () => {
      const step: WorkflowStep = {
        id: 'collect-dates',
        message: { en: 'Dates?', ms: 'Tarikh?', zh: '日期?' },
        waitForReply: true,
        inputSchema: {
          checkIn: 'Date',
          checkOut: 'Date'
        }
      };

      const input = {
        checkIn: 12345,  // Number instead of Date
        checkOut: '2026-03-27'
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(false);
      expect(result.error).toContain('checkIn');
    });

    it('should accept ISO date string as Date type', () => {
      const step: WorkflowStep = {
        id: 'validate-dates',
        message: { en: 'Confirm dates', ms: 'Sahkan tarikh', zh: '确认日期' },
        waitForReply: false,
        inputSchema: {
          checkIn: 'Date',
          checkOut: 'Date'
        }
      };

      const input = {
        checkIn: '2026-03-25',
        checkOut: '2026-03-27'
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(true);
    });

    it('should accept Date object for Date type', () => {
      const step: WorkflowStep = {
        id: 'validate-dates',
        message: { en: 'Confirm dates', ms: 'Sahkan tarikh', zh: '确认日期' },
        waitForReply: false,
        inputSchema: {
          checkIn: 'Date',
          checkOut: 'Date'
        }
      };

      const input = {
        checkIn: new Date('2026-03-25'),
        checkOut: new Date('2026-03-27')
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(true);
    });
  });

  describe('validateStepInput - missing fields', () => {
    it('should fail when required field is missing', () => {
      const step: WorkflowStep = {
        id: 'check-availability',
        message: { en: 'Check?', ms: 'Semak?', zh: '检查?' },
        waitForReply: true,
        inputSchema: {
          roomType: 'string',
          checkIn: 'Date',
          checkOut: 'Date',
          guestCount: 'number'
        }
      };

      const input = {
        roomType: 'single',
        checkIn: '2026-03-25',
        checkOut: '2026-03-27'
        // guestCount is missing
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(false);
      expect(result.error).toContain('guestCount');
      expect(result.error).toContain('missing');
    });

    it('should fail with multiple missing fields', () => {
      const step: WorkflowStep = {
        id: 'process-booking',
        message: { en: 'Process', ms: 'Proses', zh: '处理' },
        waitForReply: false,
        inputSchema: {
          bookingId: 'string',
          status: 'string',
          totalPrice: 'number'
        }
      };

      const input = {
        bookingId: 'BK-001'
        // status and totalPrice missing
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(false);
      expect(result.error).toContain('status');
      expect(result.error).toContain('totalPrice');
    });

    it('should fail when all fields are missing', () => {
      const step: WorkflowStep = {
        id: 'validate-input',
        message: { en: 'Validate', ms: 'Sahkan', zh: '验证' },
        waitForReply: false,
        inputSchema: {
          field1: 'string',
          field2: 'number'
        }
      };

      const input = {};

      const result = validateStepInput(step, input);
      expect(result.success).toBe(false);
      expect(result.error).toContain('field1');
      expect(result.error).toContain('field2');
    });
  });

  describe('validateStepInput - invalid input types', () => {
    it('should fail when input is null', () => {
      const step: WorkflowStep = {
        id: 'process-data',
        message: { en: 'Process', ms: 'Proses', zh: '处理' },
        waitForReply: false,
        inputSchema: { field1: 'string' }
      };

      const result = validateStepInput(step, null);
      expect(result.success).toBe(false);
      expect(result.error).toContain('null');
    });

    it('should fail when input is an array', () => {
      const step: WorkflowStep = {
        id: 'process-data',
        message: { en: 'Process', ms: 'Proses', zh: '处理' },
        waitForReply: false,
        inputSchema: { field1: 'string' }
      };

      const result = validateStepInput(step, ['value1', 'value2']);
      expect(result.success).toBe(false);
      expect(result.error).toContain('array');
    });

    it('should fail when input is a primitive (string)', () => {
      const step: WorkflowStep = {
        id: 'process-data',
        message: { en: 'Process', ms: 'Proses', zh: '处理' },
        waitForReply: false,
        inputSchema: { field1: 'string' }
      };

      const result = validateStepInput(step, 'not-an-object');
      expect(result.success).toBe(false);
      expect(result.error).toContain('string');
    });

    it('should fail when input is a number', () => {
      const step: WorkflowStep = {
        id: 'process-data',
        message: { en: 'Process', ms: 'Proses', zh: '处理' },
        waitForReply: false,
        inputSchema: { field1: 'string' }
      };

      const result = validateStepInput(step, 42);
      expect(result.success).toBe(false);
      expect(result.error).toContain('number');
    });
  });

  describe('validateStepInput - booking workflow steps', () => {
    it('should validate check-availability step input', () => {
      const step: WorkflowStep = {
        id: 'check-availability',
        message: { en: 'Checking...', ms: 'Menyemak...', zh: '检查中...' },
        waitForReply: false,
        inputSchema: {
          roomType: 'string',
          checkIn: 'Date',
          checkOut: 'Date'
        }
      };

      const validInput = {
        roomType: 'double',
        checkIn: '2026-03-25',
        checkOut: '2026-03-27'
      };

      expect(validateStepInput(step, validInput).success).toBe(true);

      const invalidInput = {
        roomType: 'double',
        checkIn: 'invalid-date',
        checkOut: 123  // Wrong type
      };

      const result = validateStepInput(step, invalidInput);
      expect(result.success).toBe(false);
      expect(result.error).toContain('checkOut');
    });

    it('should validate collect-guest-details step input', () => {
      const step: WorkflowStep = {
        id: 'collect-guest-details',
        message: { en: 'Guest details?', ms: 'Detail tetamu?', zh: '客人详情?' },
        waitForReply: true,
        inputSchema: {
          guestName: 'string',
          email: 'string',
          phone: 'string'
        }
      };

      const validInput = {
        guestName: 'John Doe',
        email: 'john@example.com',
        phone: '+60123456789'
      };

      expect(validateStepInput(step, validInput).success).toBe(true);

      const invalidInput = {
        guestName: 'John Doe',
        email: 'john@example.com',
        phone: 60123456789  // Number instead of string
      };

      const result = validateStepInput(step, invalidInput);
      expect(result.success).toBe(false);
      expect(result.error).toContain('phone');
    });

    it('should validate process-payment step input', () => {
      const step: WorkflowStep = {
        id: 'process-payment',
        message: { en: 'Payment', ms: 'Pembayaran', zh: '支付' },
        waitForReply: false,
        inputSchema: {
          amount: 'number',
          currency: 'string',
          paymentMethod: 'string'
        }
      };

      const validInput = {
        amount: 299.99,
        currency: 'MYR',
        paymentMethod: 'card'
      };

      expect(validateStepInput(step, validInput).success).toBe(true);

      const invalidInput = {
        amount: '299.99',  // String instead of number
        currency: 'MYR',
        paymentMethod: 'card'
      };

      const result = validateStepInput(step, invalidInput);
      expect(result.success).toBe(false);
      expect(result.error).toContain('amount');
    });

    it('should validate confirm-booking step input', () => {
      const step: WorkflowStep = {
        id: 'confirm-booking',
        message: { en: 'Confirm?', ms: 'Sahkan?', zh: '确认?' },
        waitForReply: false,
        inputSchema: {
          bookingId: 'string',
          confirmed: 'boolean'
        }
      };

      const validInput = {
        bookingId: 'BK-20260325-001',
        confirmed: true
      };

      expect(validateStepInput(step, validInput).success).toBe(true);

      const invalidInput = {
        bookingId: 'BK-20260325-001',
        confirmed: 'yes'  // String instead of boolean
      };

      const result = validateStepInput(step, invalidInput);
      expect(result.success).toBe(false);
      expect(result.error).toContain('confirmed');
    });

    it('should validate send-confirmation-email step input', () => {
      const step: WorkflowStep = {
        id: 'send-confirmation-email',
        message: { en: 'Email sent', ms: 'Email dihantar', zh: '邮件已发送' },
        waitForReply: false,
        inputSchema: {
          recipientEmail: 'string',
          bookingReference: 'string',
          checkInDate: 'Date'
        }
      };

      const validInput = {
        recipientEmail: 'guest@example.com',
        bookingReference: 'BK-20260325-001',
        checkInDate: new Date('2026-03-25')
      };

      expect(validateStepInput(step, validInput).success).toBe(true);

      const invalidInput = {
        recipientEmail: 'guest@example.com',
        bookingReference: 'BK-20260325-001',
        checkInDate: 12345  // Number instead of Date
      };

      const result = validateStepInput(step, invalidInput);
      expect(result.success).toBe(false);
      expect(result.error).toContain('checkInDate');
    });
  });

  describe('validateStepInput - extra fields', () => {
    it('should warn about but not fail on extra fields', () => {
      const step: WorkflowStep = {
        id: 'process-booking',
        message: { en: 'Process', ms: 'Proses', zh: '处理' },
        waitForReply: false,
        inputSchema: {
          bookingId: 'string',
          amount: 'number'
        }
      };

      const input = {
        bookingId: 'BK-001',
        amount: 299.99,
        extraField1: 'unexpected',
        extraField2: 'also unexpected'
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(true);  // Still passes despite extra fields
    });
  });

  describe('validateStepInput - edge cases', () => {
    it('should handle boolean fields correctly', () => {
      const step: WorkflowStep = {
        id: 'check-confirmation',
        message: { en: 'Confirmed?', ms: 'Dikonfirmasi?', zh: '已确认?' },
        waitForReply: false,
        inputSchema: {
          isConfirmed: 'boolean'
        }
      };

      const validTrue = { isConfirmed: true };
      const validFalse = { isConfirmed: false };
      const invalid = { isConfirmed: 1 };  // Truthy but not boolean

      expect(validateStepInput(step, validTrue).success).toBe(true);
      expect(validateStepInput(step, validFalse).success).toBe(true);
      expect(validateStepInput(step, invalid).success).toBe(false);
    });

    it('should handle "any" type (permissive)', () => {
      const step: WorkflowStep = {
        id: 'flexible-step',
        message: { en: 'Flexible', ms: 'Fleksibel', zh: '灵活' },
        waitForReply: false,
        inputSchema: {
          flexibleField: 'any'
        }
      };

      expect(validateStepInput(step, { flexibleField: 'string' }).success).toBe(true);
      expect(validateStepInput(step, { flexibleField: 123 }).success).toBe(true);
      expect(validateStepInput(step, { flexibleField: true }).success).toBe(true);
      expect(validateStepInput(step, { flexibleField: { nested: 'object' } }).success).toBe(true);
    });

    it('should report expected and actual fields in error', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        message: { en: 'Test', ms: 'Ujian', zh: '测试' },
        waitForReply: false,
        inputSchema: {
          field1: 'string',
          field2: 'number',
          field3: 'boolean'
        }
      };

      const input = {
        field1: 123,  // Wrong type
        field2: 'text',  // Wrong type
        field3: true  // Correct
      };

      const result = validateStepInput(step, input);
      expect(result.success).toBe(false);
      expect(result.expectedFields).toEqual(step.inputSchema);
      expect(result.actualFields).toEqual({
        field1: 'number',
        field2: 'string',
        field3: 'boolean'
      });
    });
  });
});
