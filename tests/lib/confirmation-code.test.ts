/**
 * tests/lib/confirmation-code.test.ts — Confirmation code generation and validation tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateConfirmationCode,
  validateConfirmationCode,
  verifyConfirmationCodeForProfile
} from '../../src/lib/confirmation-code.js';

describe('ConfirmationCode', () => {
  describe('generateConfirmationCode', () => {
    it('should generate a valid confirmation code for pelangi profile', () => {
      const code = generateConfirmationCode('pelangi');
      expect(code).toBeTruthy();
      expect(code).toMatch(/^PEL-\d{6}-[A-Z0-9]{6}$/);
    });

    it('should generate a valid confirmation code for southern profile', () => {
      const code = generateConfirmationCode('southern');
      expect(code).toBeTruthy();
      expect(code).toMatch(/^SOU-\d{6}-[A-Z0-9]{6}$/);
    });

    it('should generate a valid confirmation code for makan-moments profile', () => {
      const code = generateConfirmationCode('makan-moments');
      expect(code).toBeTruthy();
      expect(code).toMatch(/^MAK-\d{6}-[A-Z0-9]{6}$/);
    });

    it('should generate unique codes on successive calls', () => {
      const code1 = generateConfirmationCode('pelangi');
      const code2 = generateConfirmationCode('pelangi');
      // Same day, so prefix and timestamp will be the same
      // But random suffix should differ (with very high probability)
      expect(code1).not.toEqual(code2);
    });

    it('should return null for unknown profile', () => {
      const code = generateConfirmationCode('unknown-profile');
      expect(code).toBeNull();
    });

    it('should include current date in DDMMYY format', () => {
      const code = generateConfirmationCode('pelangi');
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = String(now.getFullYear()).slice(-2);
      const expectedTimestamp = `${day}${month}${year}`;

      const parts = code!.split('-');
      expect(parts[1]).toEqual(expectedTimestamp);
    });
  });

  describe('validateConfirmationCode', () => {
    it('should validate a correctly formatted pelangi code', () => {
      const result = validateConfirmationCode('PEL-260414-K9X2M5');
      expect(result.valid).toBe(true);
      expect(result.profileId).toBe('pelangi');
      expect(result.prefix).toBe('PEL');
    });

    it('should validate a correctly formatted southern code', () => {
      const result = validateConfirmationCode('SOU-260414-ABC123');
      expect(result.valid).toBe(true);
      expect(result.profileId).toBe('southern');
      expect(result.prefix).toBe('SOU');
    });

    it('should validate a correctly formatted makan-moments code', () => {
      const result = validateConfirmationCode('MAK-260414-XYZ789');
      expect(result.valid).toBe(true);
      expect(result.profileId).toBe('makan-moments');
      expect(result.prefix).toBe('MAK');
    });

    it('should be case-insensitive for prefix', () => {
      const result = validateConfirmationCode('pel-260414-K9X2M5');
      expect(result.valid).toBe(true);
      expect(result.profileId).toBe('pelangi');
    });

    it('should reject code with invalid format (missing dashes)', () => {
      const result = validateConfirmationCode('PEL260414K9X2M5');
      expect(result.valid).toBe(false);
    });

    it('should reject code with too many dashes', () => {
      const result = validateConfirmationCode('PEL-26-04-14-K9X2M5');
      expect(result.valid).toBe(false);
    });

    it('should reject code with unknown prefix', () => {
      const result = validateConfirmationCode('XXX-260414-K9X2M5');
      expect(result.valid).toBe(false);
    });

    it('should reject code with invalid timestamp hash (not 6 digits)', () => {
      const result = validateConfirmationCode('PEL-2604-K9X2M5');
      expect(result.valid).toBe(false);
    });

    it('should reject code with invalid random suffix (non-alphanumeric)', () => {
      const result = validateConfirmationCode('PEL-260414-K9X@M5');
      expect(result.valid).toBe(false);
    });

    it('should reject code with invalid random suffix (too short)', () => {
      const result = validateConfirmationCode('PEL-260414-K9X2M');
      expect(result.valid).toBe(false);
    });

    it('should accept code with lowercase random suffix (normalized)', () => {
      const result = validateConfirmationCode('PEL-260414-k9x2m5');
      expect(result.valid).toBe(true);
      expect(result.profileId).toBe('pelangi');
    });
  });

  describe('verifyConfirmationCodeForProfile', () => {
    it('should verify code belongs to correct profile', () => {
      const result = verifyConfirmationCodeForProfile('PEL-260414-K9X2M5', 'pelangi');
      expect(result).toBe(true);
    });

    it('should reject code for wrong profile', () => {
      const result = verifyConfirmationCodeForProfile('PEL-260414-K9X2M5', 'southern');
      expect(result).toBe(false);
    });

    it('should reject invalid code format', () => {
      const result = verifyConfirmationCodeForProfile('INVALID', 'pelangi');
      expect(result).toBe(false);
    });

    it('should verify southern code correctly', () => {
      const result = verifyConfirmationCodeForProfile('SOU-260414-ABC123', 'southern');
      expect(result).toBe(true);
    });

    it('should verify makan-moments code correctly', () => {
      const result = verifyConfirmationCodeForProfile('MAK-260414-XYZ789', 'makan-moments');
      expect(result).toBe(true);
    });

    it('should reject makan code with pelangi profile', () => {
      const result = verifyConfirmationCodeForProfile('MAK-260414-XYZ789', 'pelangi');
      expect(result).toBe(false);
    });
  });

  describe('integration: generate -> validate -> verify', () => {
    it('should generate valid code that passes validation', () => {
      const code = generateConfirmationCode('pelangi');
      const validation = validateConfirmationCode(code!);
      expect(validation.valid).toBe(true);
      expect(validation.profileId).toBe('pelangi');
    });

    it('should generate code verifiable for correct profile', () => {
      const code = generateConfirmationCode('southern');
      const verified = verifyConfirmationCodeForProfile(code!, 'southern');
      expect(verified).toBe(true);
    });

    it('should generate code not verifiable for wrong profile', () => {
      const code = generateConfirmationCode('pelangi');
      const verified = verifyConfirmationCodeForProfile(code!, 'southern');
      expect(verified).toBe(false);
    });

    it('should generate different codes with different prefixes', () => {
      const pelangiCode = generateConfirmationCode('pelangi')!;
      const southernCode = generateConfirmationCode('southern')!;

      const pelangiPrefix = pelangiCode.split('-')[0];
      const southernPrefix = southernCode.split('-')[0];

      expect(pelangiPrefix).toBe('PEL');
      expect(southernPrefix).toBe('SOU');
    });
  });

  describe('edge cases', () => {
    it('should handle all profile IDs', () => {
      const profiles = [
        'pelangi',
        'southern',
        'makan-moments',
        'pms-capsule',
        'pms-southern',
        'yoongmei'
      ];

      for (const profile of profiles) {
        const code = generateConfirmationCode(profile);
        expect(code).toBeTruthy();
        const validation = validateConfirmationCode(code!);
        expect(validation.valid).toBe(true);
        expect(validation.profileId).toBe(profile);
      }
    });

    it('should handle empty profile string', () => {
      const code = generateConfirmationCode('');
      expect(code).toBeNull();
    });

    it('should handle null-like profile strings', () => {
      // These won't actually be null, but testing similar edge cases
      const code1 = generateConfirmationCode('null');
      const code2 = generateConfirmationCode('undefined');
      expect(code1).toBeNull();
      expect(code2).toBeNull();
    });
  });
});
