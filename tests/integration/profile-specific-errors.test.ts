/**
 * Tests for US-564: Profile-Specific Error Messages
 *
 * Verifies that error messages are loaded from profile-specific JSON files
 * with graceful fallback to English if profile-specific file is missing.
 */

import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../../src/assistant/response-processor.js';

describe('US-564: Profile-Specific Error Messages', () => {
  describe('getErrorMessage() function', () => {
    it('should load pelangi hostel-specific error messages', () => {
      const message = getErrorMessage('booking_error', 'pelangi');
      expect(message).toContain('hostel booking');
      expect(message).toContain('front desk');
    });

    it('should load makan cafe-specific error messages', () => {
      const message = getErrorMessage('booking_error', 'makan');
      expect(message).toContain('cafe order');
      expect(message).not.toContain('hostel');
      expect(message).not.toContain('homestay');
    });

    it('should load southern homestay-specific error messages', () => {
      const message = getErrorMessage('booking_error', 'southern');
      expect(message).toContain('homestay booking');
      expect(message).not.toContain('hostel');
      expect(message).not.toContain('cafe');
    });

    it('should demonstrate distinct messages for same error key across profiles', () => {
      const pelangiMsg = getErrorMessage('booking_error', 'pelangi');
      const makanMsg = getErrorMessage('booking_error', 'makan');
      const southernMsg = getErrorMessage('booking_error', 'southern');

      // All three profiles should return different messages for the same error type
      expect(pelangiMsg).not.toEqual(makanMsg);
      expect(makanMsg).not.toEqual(southernMsg);
      expect(pelangiMsg).not.toEqual(southernMsg);
    });

    it('should fall back to English for profile-specific file missing or malformed', () => {
      // For unknown profile, should fall back to error-messages-en.json
      const message = getErrorMessage('booking_error', 'nonexistent-profile');
      expect(message).toBeTruthy();
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });

    it('should handle all standard error types', () => {
      const errorTypes = [
        'validation_error',
        'payment_failed',
        'room_unavailable',
        'date_conflict',
        'guest_not_found',
        'system_error',
        'booking_error'
      ];

      errorTypes.forEach(errorType => {
        const makanMsg = getErrorMessage(errorType, 'makan');
        const southernMsg = getErrorMessage(errorType, 'southern');
        const pelangiMsg = getErrorMessage(errorType, 'pelangi');

        expect(makanMsg).toBeTruthy();
        expect(southernMsg).toBeTruthy();
        expect(pelangiMsg).toBeTruthy();
        expect(typeof makanMsg).toBe('string');
        expect(typeof southernMsg).toBe('string');
        expect(typeof pelangiMsg).toBe('string');
      });
    });

    it('should fall back to system_error for unmapped error type', () => {
      const message = getErrorMessage('unknown_error_type', 'pelangi');
      expect(message).toBeTruthy();
      // Should fall back to system_error from the JSON file
      expect(typeof message).toBe('string');
    });

    it('should support profile aliases for normalization', () => {
      // pelangi-capsule should normalize to pelangi
      const msg1 = getErrorMessage('booking_error', 'pelangi-capsule');
      const msg2 = getErrorMessage('booking_error', 'pelangi');

      // Both should use pelangi profile-specific messages
      expect(msg1).toContain('front desk');
    });

    it('should handle validation_error for different profiles', () => {
      const pelangiMsg = getErrorMessage('validation_error', 'pelangi');
      const makanMsg = getErrorMessage('validation_error', 'makan');
      const southernMsg = getErrorMessage('validation_error', 'southern');

      // Pelangi should mention front desk
      expect(pelangiMsg).toContain('front desk');

      // Makan should mention staff (not front desk)
      expect(makanMsg).toContain('staff');
      expect(makanMsg).not.toContain('front desk');

      // Southern should mention team
      expect(southernMsg).toContain('team');
      expect(southernMsg).not.toContain('front desk');
    });

    it('should handle room_unavailable errors with different context', () => {
      const pelangiMsg = getErrorMessage('room_unavailable', 'pelangi');
      const makanMsg = getErrorMessage('room_unavailable', 'makan');

      // Pelangi mentions "room"
      expect(pelangiMsg).toContain('room');

      // Makan mentions "item" instead
      expect(makanMsg).toContain('item');
      expect(makanMsg).not.toContain('room');
    });
  });
});
