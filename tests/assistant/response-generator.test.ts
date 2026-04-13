/**
 * US-531: Booking Confirmation Template Rendering Tests
 *
 * Validates template rendering with guest context data and placeholder replacement.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { renderBookingConfirmation, type GuestContext } from '../../src/assistant/pipeline/response-generator.js';

describe('renderBookingConfirmation', () => {
  describe('booking confirmation template rendering', () => {
    it('should render booking confirmation with all guest details interpolated', () => {
      const guestContext: GuestContext = {
        guestName: 'John Doe',
        unit: 'C5',
        checkIn: '2026-04-15',
        checkOut: '2026-04-18',
        price: 'RM 135',
      };

      const result = renderBookingConfirmation(guestContext, 'default', 'en');

      expect(result).toContain('John Doe');
      expect(result).toContain('C5');
      expect(result).toContain('2026-04-15');
      expect(result).toContain('2026-04-18');
      expect(result).toContain('RM 135');
      expect(result).not.toContain('{{');
      expect(result).not.toContain('}}');
    });

    it('should render booking confirmation with special characters in guest name', () => {
      const guestContext: GuestContext = {
        guestName: "Ahmad O'Brien",
        unit: 'C12',
        checkIn: '2026-05-01',
        checkOut: '2026-05-05',
        price: 'RM 225',
      };

      const result = renderBookingConfirmation(guestContext, 'default', 'en');

      expect(result).toContain("Ahmad O'Brien");
      expect(result).toContain('C12');
      expect(result).toContain('RM 225');
    });

    it('should render booking confirmation in Malay language', () => {
      const guestContext: GuestContext = {
        guestName: 'Ali Hassan',
        unit: 'C8',
        checkIn: '2026-04-20',
        checkOut: '2026-04-22',
        price: 'RM 90',
      };

      const result = renderBookingConfirmation(guestContext, 'default', 'ms');

      expect(result).toContain('Ali Hassan');
      expect(result).toContain('C8');
      expect(result).toContain('2026-04-20');
      expect(result).toContain('2026-04-22');
      expect(result).toContain('RM 90');
      expect(result).toContain('Pengesahan Tempahan');
      expect(result).not.toContain('{{');
    });

    it('should render booking confirmation in Chinese language', () => {
      const guestContext: GuestContext = {
        guestName: '李明',
        unit: 'C3',
        checkIn: '2026-04-10',
        checkOut: '2026-04-12',
        price: 'RM 90',
      };

      const result = renderBookingConfirmation(guestContext, 'default', 'zh');

      expect(result).toContain('李明');
      expect(result).toContain('C3');
      expect(result).toContain('2026-04-10');
      expect(result).toContain('2026-04-12');
      expect(result).toContain('RM 90');
      expect(result).toContain('预订确认');
      expect(result).not.toContain('{{');
    });

    it('should render booking confirmation for southern profile', () => {
      const guestContext: GuestContext = {
        guestName: 'Maria Garcia',
        unit: 'Studio A',
        checkIn: '2026-05-10',
        checkOut: '2026-05-15',
        price: 'RM 250',
      };

      const result = renderBookingConfirmation(guestContext, 'southern', 'en');

      expect(result).toContain('Maria Garcia');
      expect(result).toContain('Studio A');
      expect(result).toContain('2026-05-10');
      expect(result).toContain('2026-05-15');
      expect(result).toContain('RM 250');
      expect(result).not.toContain('{{');
    });

    it('should render booking confirmation for makan profile', () => {
      const guestContext: GuestContext = {
        guestName: 'Fatimah Zahra',
        unit: 'Table 5',
        checkIn: '2026-04-18',
        checkOut: '2026-04-18',
        price: 'RM 50',
      };

      const result = renderBookingConfirmation(guestContext, 'makan', 'en');

      expect(result).toContain('Fatimah Zahra');
      expect(result).toContain('Table 5');
      expect(result).toContain('2026-04-18');
      expect(result).toContain('RM 50');
      expect(result).not.toContain('{{');
    });

    it('should handle price formatting with currency and decimals', () => {
      const guestContext: GuestContext = {
        guestName: 'David Wong',
        unit: 'C1',
        checkIn: '2026-06-01',
        checkOut: '2026-06-07',
        price: 'RM 315.50',
      };

      const result = renderBookingConfirmation(guestContext, 'default', 'en');

      expect(result).toContain('RM 315.50');
      expect(result).toContain('David Wong');
    });

    it('should handle long unit numbers/names', () => {
      const guestContext: GuestContext = {
        guestName: 'Elizabeth Montgomery',
        unit: 'Bungalow 3B - Master Suite',
        checkIn: '2026-07-01',
        checkOut: '2026-07-08',
        price: 'RM 980',
      };

      const result = renderBookingConfirmation(guestContext, 'default', 'en');

      expect(result).toContain('Bungalow 3B - Master Suite');
      expect(result).toContain('Elizabeth Montgomery');
    });

    it('should fallback to English if language not found', () => {
      const guestContext: GuestContext = {
        guestName: 'Johan Setiawan',
        unit: 'C4',
        checkIn: '2026-04-25',
        checkOut: '2026-04-27',
        price: 'RM 90',
      };

      // ta (Tamil) might not be in all profiles, should fallback to en
      const result = renderBookingConfirmation(guestContext, 'default', 'ta');

      // Should still contain the interpolated values
      expect(result).toContain('Johan Setiawan');
      expect(result).toContain('C4');
      expect(result).toContain('RM 90');
      expect(result).not.toContain('{{');
    });
  });

  describe('error handling', () => {
    it('should throw error for missing guest context', () => {
      expect(() => {
        renderBookingConfirmation(null as any, 'default', 'en');
      }).toThrow('Invalid guestContext: must be an object');
    });

    it('should throw error for missing guestName', () => {
      const guestContext = {
        guestName: '',
        unit: 'C5',
        checkIn: '2026-04-15',
        checkOut: '2026-04-18',
        price: 'RM 135',
      };

      expect(() => {
        renderBookingConfirmation(guestContext, 'default', 'en');
      }).toThrow('Invalid guestContext: missing required fields');
    });

    it('should throw error for missing unit', () => {
      const guestContext = {
        guestName: 'John Doe',
        unit: '',
        checkIn: '2026-04-15',
        checkOut: '2026-04-18',
        price: 'RM 135',
      };

      expect(() => {
        renderBookingConfirmation(guestContext, 'default', 'en');
      }).toThrow('Invalid guestContext: missing required fields');
    });

    it('should throw error for missing checkIn', () => {
      const guestContext = {
        guestName: 'John Doe',
        unit: 'C5',
        checkIn: '',
        checkOut: '2026-04-18',
        price: 'RM 135',
      };

      expect(() => {
        renderBookingConfirmation(guestContext, 'default', 'en');
      }).toThrow('Invalid guestContext: missing required fields');
    });

    it('should throw error for missing checkOut', () => {
      const guestContext = {
        guestName: 'John Doe',
        unit: 'C5',
        checkIn: '2026-04-15',
        checkOut: '',
        price: 'RM 135',
      };

      expect(() => {
        renderBookingConfirmation(guestContext, 'default', 'en');
      }).toThrow('Invalid guestContext: missing required fields');
    });

    it('should throw error for missing price', () => {
      const guestContext = {
        guestName: 'John Doe',
        unit: 'C5',
        checkIn: '2026-04-15',
        checkOut: '2026-04-18',
        price: '',
      };

      expect(() => {
        renderBookingConfirmation(guestContext, 'default', 'en');
      }).toThrow('Invalid guestContext: missing required fields');
    });

    it('should throw error for undefined field in context', () => {
      const guestContext = {
        guestName: 'John Doe',
        unit: 'C5',
        checkIn: '2026-04-15',
        checkOut: '2026-04-18',
        // price is missing/undefined
      } as GuestContext;

      expect(() => {
        renderBookingConfirmation(guestContext, 'default', 'en');
      }).toThrow('Invalid guestContext: missing required fields');
    });
  });

  describe('placeholder replacement accuracy', () => {
    it('should handle numeric values in guest name', () => {
      const guestContext: GuestContext = {
        guestName: 'Guest123',
        unit: 'C5',
        checkIn: '2026-04-15',
        checkOut: '2026-04-18',
        price: 'RM 135',
      };

      const result = renderBookingConfirmation(guestContext, 'default', 'en');

      // Should contain the guest name as provided
      expect(result).toContain('Guest123');
      expect(result).toContain('RM 135');
    });

    it('should handle multiple occurrences of same placeholder', () => {
      const guestContext: GuestContext = {
        guestName: 'John Doe',
        unit: 'C5',
        checkIn: '2026-04-15',
        checkOut: '2026-04-18',
        price: 'RM 135',
      };

      const result = renderBookingConfirmation(guestContext, 'default', 'en');

      // Count occurrences of guestName in result
      const guestNameCount = (result.match(/John Doe/g) || []).length;
      expect(guestNameCount).toBeGreaterThan(0);

      // No unreplaced placeholders
      expect(result).not.toContain('{{guestName}}');
      expect(result).not.toContain('{{unit}}');
      expect(result).not.toContain('{{checkIn}}');
      expect(result).not.toContain('{{checkOut}}');
      expect(result).not.toContain('{{price}}');
    });
  });

  describe('profile-specific templates', () => {
    it('should load template from default profile data directory', () => {
      const guestContext: GuestContext = {
        guestName: 'Test User',
        unit: 'C1',
        checkIn: '2026-04-15',
        checkOut: '2026-04-16',
        price: 'RM 45',
      };

      const result = renderBookingConfirmation(guestContext, 'default', 'en');

      expect(result).toContain('Test User');
      expect(result).toContain('Booking Confirmation');
    });

    it('should load template from southern profile data directory', () => {
      const guestContext: GuestContext = {
        guestName: 'Test User',
        unit: 'Room 101',
        checkIn: '2026-04-15',
        checkOut: '2026-04-16',
        price: 'RM 150',
      };

      const result = renderBookingConfirmation(guestContext, 'southern', 'en');

      expect(result).toContain('Test User');
      expect(result).toContain('Booking Confirmation');
    });
  });
});
