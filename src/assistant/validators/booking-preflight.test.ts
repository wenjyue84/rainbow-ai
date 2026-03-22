/**
 * US-078: Booking workflow pre-flight validator tests
 *
 * Tests the validateBookingRequest function with various scenarios:
 * - Past-date check-in validation
 * - Room type validation
 * - Guest name validation
 * - Language-aware error messages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { validateBookingRequest, type BookingRequest } from './booking-preflight.js';
import type { ConfigStore } from '../config-store.js';

// Mock ConfigStore
function createMockConfigStore(rooms: string[] = ['2-bed', '4-bed', 'private']): ConfigStore {
  const mockConfig: any = {
    getSettings: () => ({
      rooms: rooms.map(name => ({ name }))
    }),
    getWorkflows: () => ({}),
    getRouting: () => ({}),
    getKnowledge: () => ({}),
    getIntents: () => ({}),
    getTemplates: () => ({}),
    getWorkflow: () => ({}),
    profileId: 'pelangi',
    init: async () => {},
    getCorruptedFiles: () => [],
    clearCorruptedFiles: () => {},
    setKnowledge: () => {},
    setIntents: () => {},
    setTemplates: () => {},
    setSettings: () => {},
    setWorkflow: () => {},
    setWorkflows: () => {},
    setRouting: () => {},
    on: () => mockConfig,
    once: () => mockConfig,
    off: () => mockConfig,
    getTimeSensitiveIntentSet: () => new Set()
  };

  return mockConfig as ConfigStore;
}

describe('US-078: Booking Preflight Validator', () => {
  let mockConfig: ConfigStore;

  beforeEach(() => {
    mockConfig = createMockConfigStore(['2-bed', '4-bed', 'private']);
  });

  describe('Guest Name Validation', () => {
    it('should reject booking with empty guest_name', () => {
      const payload: BookingRequest = {
        checkIn: '2026-03-25',
        room_type: '2-bed',
        guest_name: ''
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('Guest name'))).toBe(true);
    });

    it('should reject booking with null/undefined guest_name', () => {
      const payload: BookingRequest = {
        checkIn: '2026-03-25',
        room_type: '2-bed'
        // guest_name is undefined
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Guest name'))).toBe(true);
    });

    it('should reject booking with whitespace-only guest_name', () => {
      const payload: BookingRequest = {
        checkIn: '2026-03-25',
        room_type: '2-bed',
        guest_name: '   '
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Guest name'))).toBe(true);
    });

    it('should accept booking with valid guest_name', () => {
      const payload: BookingRequest = {
        checkIn: '2026-03-25',
        room_type: '2-bed',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig);

      // Should pass guest_name validation (may fail on other validations)
      expect(result.errors.some(e => e.includes('Guest name'))).toBe(false);
    });
  });

  describe('Check-in Date Validation', () => {
    it('should reject booking with missing checkIn', () => {
      const payload: BookingRequest = {
        room_type: '2-bed',
        guest_name: 'John Doe'
        // checkIn is undefined
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Check-in date'))).toBe(true);
    });

    it('should reject booking with past-date check-in (English)', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const pastDateStr = pastDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: pastDateStr,
        room_type: '2-bed',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig, 'en');

      expect(result.valid).toBe(false);
      const pastDateErrors = result.errors.filter(e => e.includes('past'));
      expect(pastDateErrors.length).toBeGreaterThan(0);
      expect(pastDateErrors[0]).toContain('Available dates:');
    });

    it('should include available dates in error message (English)', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const pastDateStr = pastDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: pastDateStr,
        room_type: '2-bed',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig, 'en');

      expect(result.valid).toBe(false);
      const dateError = result.errors.find(e => e.includes('past'));
      expect(dateError).toBeDefined();
      expect(dateError).toMatch(/Available dates: \[.+, .+, .+\]/);
    });

    it('should return past-date error with Malay translation', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const pastDateStr = pastDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: pastDateStr,
        room_type: '2-bed',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig, 'ms');

      expect(result.valid).toBe(false);
      const msError = result.errors.find(e => e.includes('masa lalu'));
      expect(msError).toBeDefined();
    });

    it('should return past-date error with Chinese translation', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const pastDateStr = pastDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: pastDateStr,
        room_type: '2-bed',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig, 'zh');

      expect(result.valid).toBe(false);
      const zhError = result.errors.find(e => e.includes('过去'));
      expect(zhError).toBeDefined();
    });

    it('should accept booking with future checkIn date', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: futureDateStr,
        room_type: '2-bed',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig);

      // Should not have date-related errors
      expect(result.errors.some(e => e.includes('past'))).toBe(false);
    });

    it('should accept booking with today as checkIn', () => {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      const payload: BookingRequest = {
        checkIn: todayStr,
        room_type: '2-bed',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig);

      // Should not have date-related errors for today
      const pastError = result.errors.find(e => e.includes('past'));
      expect(pastError).toBeUndefined();
    });

    it('should reject booking with invalid checkIn date format', () => {
      const payload: BookingRequest = {
        checkIn: 'invalid-date',
        room_type: '2-bed',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid') || e.includes('format'))).toBe(true);
    });
  });

  describe('Room Type Validation', () => {
    it('should reject booking with missing room_type', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: futureDateStr,
        guest_name: 'John Doe'
        // room_type is undefined
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Room type'))).toBe(true);
    });

    it('should reject booking with empty room_type', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: futureDateStr,
        room_type: '',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Room type'))).toBe(true);
    });

    it('should reject booking with invalid room_type', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: futureDateStr,
        room_type: 'luxury-suite',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(false);
      const roomError = result.errors.find(e => e.includes('not available'));
      expect(roomError).toBeDefined();
      expect(roomError).toContain('2-bed, 4-bed, private');
    });

    it('should accept booking with valid room_type', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: futureDateStr,
        room_type: '2-bed',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.errors.some(e => e.includes('not available'))).toBe(false);
    });

    it('should handle room_type case-insensitively', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: futureDateStr,
        room_type: '4-BED',
        guest_name: 'John Doe'
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.errors.some(e => e.includes('not available'))).toBe(false);
    });
  });

  describe('Full Validation - Valid Booking', () => {
    it('should accept complete valid booking', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: futureDateStr,
        room_type: '2-bed',
        guest_name: 'John Doe',
        guests: 2
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Full Validation - Multiple Errors', () => {
    it('should report all validation errors together', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const pastDateStr = pastDate.toISOString().split('T')[0];

      const payload: BookingRequest = {
        checkIn: pastDateStr,
        room_type: 'penthouse',
        guest_name: ''
      };

      const result = validateBookingRequest(payload, mockConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.errors.some(e => e.includes('Guest name'))).toBe(true);
      expect(result.errors.some(e => e.includes('past'))).toBe(true);
      expect(result.errors.some(e => e.includes('not available'))).toBe(true);
    });
  });
});
