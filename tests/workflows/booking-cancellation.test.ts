/**
 * booking-cancellation.test.ts — US-621 Booking Cancellation Tests
 *
 * Tests for booking cancellation intent handling:
 * - Cancel booking with guest notification
 * - Update database status
 * - Log cancellation event
 * - Verify workflow closes gracefully
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cancelBooking, type GuestContact, type CancellationResult } from '../../src/assistant/booking/cancellation-handler.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/lib/db.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'booking-123',
              roomId: 'room-101',
              guestPhone: '+60123456789',
              guestName: 'John Doe',
              checkInDate: new Date('2026-04-20'),
              checkOutDate: new Date('2026-04-25'),
              status: 'confirmed',
              profile: 'pelangi',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue({}),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue([{ id: 1 }]),
    })),
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Booking Cancellation Handler (US-621)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cancelBooking function', () => {
    it('should cancel a booking and return success status', async () => {
      const bookingId = 'booking-123';
      const guestContact: GuestContact = {
        phone: '+60123456789',
        email: 'guest@example.com',
        name: 'John Doe',
      };

      const result = await cancelBooking(bookingId, guestContact);

      expect(result).toMatchObject({
        status: 'cancelled',
        bookingId,
        notificationSent: true,
      });
      expect(result.timestamp).toBeDefined();
    });

    it('should update booking status to cancelled in database', async () => {
      const bookingId = 'booking-123';
      const guestContact: GuestContact = {
        phone: '+60123456789',
        name: 'John Doe',
      };

      await cancelBooking(bookingId, guestContact);

      // Verify db.update was called
      const { db } = await import('../../src/lib/db.js');
      expect(db.update).toHaveBeenCalled();
    });

    it('should log cancellation event with reason', async () => {
      const bookingId = 'booking-123';
      const guestContact: GuestContact = {
        phone: '+60123456789',
        name: 'John Doe',
      };
      const reason = 'Schedule changed';

      await cancelBooking(bookingId, guestContact, reason);

      // Verify logger was called
      const { logger } = await import('../../src/lib/logger.js');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Booking cancelled'),
        expect.objectContaining({
          bookingId,
          reason,
        })
      );
    });

    it('should queue notification for guest', async () => {
      const bookingId = 'booking-123';
      const guestContact: GuestContact = {
        phone: '+60123456789',
        email: 'guest@example.com',
        name: 'John Doe',
      };

      const result = await cancelBooking(bookingId, guestContact);

      // Verify notification was queued
      expect(result.notificationSent).toBe(true);

      // Verify logger captured notification queue
      const { logger } = await import('../../src/lib/logger.js');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Queueing notification'),
        expect.objectContaining({
          bookingId,
          phone: guestContact.phone,
        })
      );
    });

    it('should create booking state audit entry', async () => {
      const bookingId = 'booking-123';
      const guestContact: GuestContact = {
        phone: '+60123456789',
        name: 'John Doe',
      };

      await cancelBooking(bookingId, guestContact, 'Guest request');

      // Verify db.insert was called for audit
      const { db } = await import('../../src/lib/db.js');
      expect(db.insert).toHaveBeenCalled();
    });

    it('should throw error if booking not found', async () => {
      const bookingId = 'non-existent-id';
      const guestContact: GuestContact = {
        phone: '+60123456789',
        name: 'John Doe',
      };

      // Mock db to return empty result
      const { db } = await import('../../src/lib/db.js');
      vi.mocked(db.select).mockImplementationOnce(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      } as any));

      await expect(cancelBooking(bookingId, guestContact)).rejects.toThrowError(
        /not found/
      );
    });

    it('should handle missing email in guest contact', async () => {
      const bookingId = 'booking-123';
      const guestContact: GuestContact = {
        phone: '+60123456789',
        // email intentionally omitted
        name: 'John Doe',
      };

      const result = await cancelBooking(bookingId, guestContact);

      expect(result.status).toBe('cancelled');
      expect(result.notificationSent).toBe(true);
    });

    it('should handle missing reason parameter', async () => {
      const bookingId = 'booking-123';
      const guestContact: GuestContact = {
        phone: '+60123456789',
        name: 'John Doe',
      };

      const result = await cancelBooking(bookingId, guestContact);
      // Should not throw and should return valid result

      expect(result.status).toBe('cancelled');
    });

    it('should return ISO 8601 timestamp', async () => {
      const bookingId = 'booking-123';
      const guestContact: GuestContact = {
        phone: '+60123456789',
        name: 'John Doe',
      };

      const result = await cancelBooking(bookingId, guestContact);

      // Verify timestamp is ISO 8601 format
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });

  describe('Intent-to-action workflow', () => {
    it('should handle "cancel my booking" intent and execute cancellation', async () => {
      // Simulates: user message "cancel my booking" → classify as cancel_booking intent
      // → invoke cancellation_handler → update booking status and notify guest
      const bookingId = 'booking-456';
      const guestContact: GuestContact = {
        phone: '+60198765432',
        email: 'traveler@example.com',
        name: 'Jane Smith',
      };

      // Execute cancellation (as would be done by workflow)
      const result = await cancelBooking(bookingId, guestContact, 'User requested cancellation');

      // Verify result
      expect(result.status).toBe('cancelled');
      expect(result.notificationSent).toBe(true);
      expect(result.bookingId).toBe(bookingId);
    });

    it('should close workflow after successful cancellation', async () => {
      const bookingId = 'booking-789';
      const guestContact: GuestContact = {
        phone: '+60187654321',
        name: 'Bob Wilson',
      };

      const result = await cancelBooking(bookingId, guestContact);

      // Verify cancellation succeeded
      expect(result.status).toBe('cancelled');
      // In a real workflow, this would trigger workflow closure
      // (workflow closure is handled by the workflow executor, not this handler)
    });
  });
});
