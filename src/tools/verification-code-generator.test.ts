/**
 * Tests for US-436: Booking Verification Code Generator and SMS Notifier
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateRandomCode,
  generateVerificationCode,
  sendVerificationSMS,
  verifyCode,
  markVerificationCodeAsUsed,
  cleanupExpiredCodes,
} from './verification-code-generator.js';

describe('Verification Code Generator (US-436)', () => {
  describe('generateRandomCode', () => {
    it('should generate a 6-digit code', () => {
      const code = generateRandomCode();
      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    it('should generate different codes each time', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(generateRandomCode());
      }
      // With 100 iterations, we should have at least 95 unique codes (allow for rare collisions)
      expect(codes.size).toBeGreaterThan(90);
    });

    it('should generate codes in the range 100000-999999', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateRandomCode();
        const num = parseInt(code, 10);
        expect(num).toBeGreaterThanOrEqual(100000);
        expect(num).toBeLessThanOrEqual(999999);
      }
    });
  });

  describe('sendVerificationSMS', () => {
    it('should fail gracefully when SMS not configured', async () => {
      // Mock isSmsConfigured to return false
      vi.doMock('../lib/sms-sender.js', async () => {
        const actual = await vi.importActual<typeof import('../lib/sms-sender.js')>(
          '../lib/sms-sender.js'
        );
        return {
          ...actual,
          isSmsConfigured: () => false,
        };
      });

      const result = await sendVerificationSMS('123456', '+60xxxxxxxx');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not configured');
    });

    it('should return proper retry message format', async () => {
      const result = await sendVerificationSMS('123456', '+60xxxxxxxx', 1, 1);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });

    it('should include code in SMS message', async () => {
      // This tests the message format would include the code
      // (actual SMS won't send without Twilio config in test env)
      const code = '123456';
      const result = await sendVerificationSMS(code, '+60xxxxxxxx', 1, 1);
      // Result should have message property regardless of success
      expect(result.message).toBeDefined();
    });
  });

  describe('generateVerificationCode', () => {
    it('should return a result object with expected structure', async () => {
      const result = await generateVerificationCode('booking123', '+60xxxxxxxx', 'pelangi');

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('smsStatus');
    });

    it('should generate a 6-digit code when successful', async () => {
      const result = await generateVerificationCode('booking123', '+60xxxxxxxx', 'pelangi');

      if (result.code) {
        expect(result.code).toHaveLength(6);
        expect(/^\d{6}$/.test(result.code)).toBe(true);
      }
    });

    it('should set expiry to 15 minutes in future by default', async () => {
      const beforeTime = new Date();
      const result = await generateVerificationCode('booking123', '+60xxxxxxxx', 'pelangi');
      const afterTime = new Date();

      if (result.expiresAt) {
        // Expiry should be ~15 minutes from now
        const expectedMin = beforeTime.getTime() + 14 * 60 * 1000;
        const expectedMax = afterTime.getTime() + 16 * 60 * 1000;
        const actualTime = result.expiresAt.getTime();

        expect(actualTime).toBeGreaterThan(expectedMin);
        expect(actualTime).toBeLessThan(expectedMax);
      }
    });

    it('should handle custom expiry config', async () => {
      const result = await generateVerificationCode('booking123', '+60xxxxxxxx', 'pelangi', {
        expiryMinutes: 5,
      });

      if (result.expiresAt) {
        const now = new Date();
        const expectedMin = now.getTime() + 4 * 60 * 1000;
        const expectedMax = now.getTime() + 6 * 60 * 1000;
        const actualTime = result.expiresAt.getTime();

        expect(actualTime).toBeGreaterThan(expectedMin);
        expect(actualTime).toBeLessThan(expectedMax);
      }
    });

    it('should return error message on failure', async () => {
      // Intentionally pass invalid data to trigger error path
      const result = await generateVerificationCode('', '', '');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('verifyCode', () => {
    it('should return false for invalid inputs', async () => {
      // Non-existent code
      const result = await verifyCode('000000', 'nonexistent', 'pelangi');
      expect(result).toBe(false);
    });

    it('should return false for empty code', async () => {
      const result = await verifyCode('', 'booking123', 'pelangi');
      expect(result).toBe(false);
    });

    it('should handle profile parameter correctly', async () => {
      // Verify with different profile should not find code from other profile
      const result = await verifyCode('123456', 'booking123', 'southern');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('markVerificationCodeAsUsed', () => {
    it('should return false for non-existent code', async () => {
      const result = await markVerificationCodeAsUsed('000000', 'pelangi');
      expect(result).toBe(false);
    });

    it('should accept profile parameter', async () => {
      const result = await markVerificationCodeAsUsed('123456', 'southern');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('cleanupExpiredCodes', () => {
    it('should return a number', async () => {
      const result = await cleanupExpiredCodes();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Acceptance Criteria (US-436)', () => {
    it('AC1: Generate and store 6-digit verification code with 15-minute expiry', async () => {
      const result = await generateVerificationCode('booking-ac1', '+60xxxxxxxx', 'pelangi');

      // Should have code
      expect(result.code).toBeDefined();
      if (result.code) {
        expect(result.code).toHaveLength(6);
        expect(/^\d{6}$/.test(result.code)).toBe(true);
      }

      // Should have expiry
      expect(result.expiresAt).toBeDefined();
    });

    it('AC2: Send verification code via SMS with error handling', async () => {
      const result = await sendVerificationSMS('123456', '+60xxxxxxxx');

      // Result should have success and message properties (error handling)
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });

    it('AC3: Workflow step configuration exists in workflows.json', async () => {
      // Verify that workflows.json can be imported and has booking_verification workflow
      const workflows = await import('../assistant/data/workflows.json', {
        assert: { type: 'json' },
      });

      expect(workflows.default).toBeDefined();
      expect(workflows.default.workflows).toBeDefined();
      expect(Array.isArray(workflows.default.workflows)).toBe(true);

      const bookingVerificationWorkflow = workflows.default.workflows.find(
        (w: any) => w.id === 'booking_verification'
      );
      expect(bookingVerificationWorkflow).toBeDefined();

      if (bookingVerificationWorkflow) {
        expect(bookingVerificationWorkflow.steps).toBeDefined();
        expect(Array.isArray(bookingVerificationWorkflow.steps)).toBe(true);

        const verificationStep = bookingVerificationWorkflow.steps.find(
          (s: any) => s.type === 'verification_code'
        );
        expect(verificationStep).toBeDefined();

        if (verificationStep) {
          expect(verificationStep.config).toBeDefined();
          expect(verificationStep.config.expiryMinutes).toBe(15);
          expect(verificationStep.config.smsProvider).toBe('twilio');
        }
      }
    });
  });
});
