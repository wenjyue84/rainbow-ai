/**
 * US-296: Booking Workflow Email Confirmation Delivery Test Suite
 *
 * Tests:
 *  1. Email generation outputs correct recipient, subject, and body for booking workflow
 *  2. Language-specific templates (en, ms, ta) are selected based on guest language preference
 *  3. No duplicate emails sent when booking workflow retry logic executes the email step multiple times
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  generateBookingEmail,
  sendBookingConfirmationEmail,
  resetDedupCache,
  type BookingEmailData,
  type SupportedLanguage,
} from '../lib/booking-email.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeBooking(overrides: Partial<BookingEmailData> = {}): BookingEmailData {
  return {
    guestName: 'Ali bin Ahmad',
    guestEmail: 'ali@example.com',
    confirmationId: 'BK-20260324-001',
    checkIn: '2026-04-01',
    checkOut: '2026-04-03',
    guestCount: 2,
    roomType: 'capsule',
    totalAmount: 80.0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('US-296: Booking Workflow Email Confirmation Delivery', () => {
  beforeEach(() => {
    resetDedupCache();
  });

  // ─── AC-1: Email generation outputs correct recipient, subject, body ──

  describe('AC-1: Email generation step outputs correct recipient, subject, and body', () => {
    it('generates email with correct recipient from booking data', () => {
      const booking = makeBooking();
      const email = generateBookingEmail(booking);

      expect(email.recipient).toBe('ali@example.com');
    });

    it('generates email with subject containing confirmation ID', () => {
      const booking = makeBooking();
      const email = generateBookingEmail(booking);

      expect(email.subject).toContain('BK-20260324-001');
      expect(email.subject).toContain('Booking Confirmation');
    });

    it('generates email body with all booking details', () => {
      const booking = makeBooking();
      const email = generateBookingEmail(booking);

      expect(email.body).toContain('Ali bin Ahmad');
      expect(email.body).toContain('BK-20260324-001');
      expect(email.body).toContain('2026-04-01');
      expect(email.body).toContain('2026-04-03');
      expect(email.body).toContain('2');
      expect(email.body).toContain('capsule');
      expect(email.body).toContain('RM80.00');
    });

    it('generates email body without optional fields when omitted', () => {
      const booking = makeBooking({ roomType: undefined, totalAmount: undefined });
      const email = generateBookingEmail(booking);

      expect(email.body).not.toContain('Room Type');
      expect(email.body).not.toContain('Total');
      expect(email.body).toContain('Ali bin Ahmad');
      expect(email.body).toContain('BK-20260324-001');
    });

    it('returns confirmationId and language in the output', () => {
      const booking = makeBooking();
      const email = generateBookingEmail(booking, 'en');

      expect(email.confirmationId).toBe('BK-20260324-001');
      expect(email.language).toBe('en');
    });
  });

  // ─── AC-2: Language-specific templates ────────────────────────────────

  describe('AC-2: Language-specific templates based on guest language preference', () => {
    it('selects English template when language is "en"', () => {
      const booking = makeBooking();
      const email = generateBookingEmail(booking, 'en');

      expect(email.subject).toMatch(/^Booking Confirmation/);
      expect(email.body).toContain('Dear Ali bin Ahmad');
      expect(email.body).toContain('Your booking has been confirmed');
      expect(email.body).toContain('Pelangi Capsule Hostel');
      expect(email.language).toBe('en');
    });

    it('selects Malay template when language is "ms"', () => {
      const booking = makeBooking();
      const email = generateBookingEmail(booking, 'ms');

      expect(email.subject).toMatch(/^Pengesahan Tempahan/);
      expect(email.body).toContain('yang dihormati');
      expect(email.body).toContain('Tempahan anda telah disahkan');
      expect(email.body).toContain('Daftar Masuk');
      expect(email.body).toContain('Pelangi Capsule Hostel');
      expect(email.language).toBe('ms');
    });

    it('selects Tamil template when language is "ta"', () => {
      const booking = makeBooking();
      const email = generateBookingEmail(booking, 'ta');

      expect(email.subject).toMatch(/^முன்பதிவு உறுதிப்படுத்தல்/);
      expect(email.body).toContain('அன்புள்ள Ali bin Ahmad');
      expect(email.body).toContain('உறுதிப்படுத்தப்பட்டது');
      expect(email.body).toContain('செக்-இன்');
      expect(email.body).toContain('Pelangi Capsule Hostel');
      expect(email.language).toBe('ta');
    });

    it('falls back to English template for unknown language', () => {
      const booking = makeBooking();
      const email = generateBookingEmail(booking, 'xx' as SupportedLanguage);

      expect(email.subject).toMatch(/^Booking Confirmation/);
      expect(email.body).toContain('Dear');
      expect(email.language).toBe('xx');
    });

    it('defaults to English when no language specified', () => {
      const booking = makeBooking();
      const email = generateBookingEmail(booking);

      expect(email.subject).toMatch(/^Booking Confirmation/);
      expect(email.language).toBe('en');
    });

    it('all three language templates include the confirmation ID in subject', () => {
      const booking = makeBooking();
      const languages: SupportedLanguage[] = ['en', 'ms', 'ta'];

      for (const lang of languages) {
        const email = generateBookingEmail(booking, lang);
        expect(email.subject).toContain('BK-20260324-001');
      }
    });
  });

  // ─── AC-3: Deduplication on retry ─────────────────────────────────────

  describe('AC-3: No duplicate emails on workflow retry', () => {
    it('sends email on first call', () => {
      const booking = makeBooking();
      const result = sendBookingConfirmationEmail(booking, 'en');

      expect(result).not.toBeNull();
      expect(result!.recipient).toBe('ali@example.com');
      expect(result!.subject).toContain('BK-20260324-001');
    });

    it('suppresses duplicate email on second call with same confirmationId', () => {
      const booking = makeBooking();

      const first = sendBookingConfirmationEmail(booking, 'en');
      expect(first).not.toBeNull();

      const second = sendBookingConfirmationEmail(booking, 'en');
      expect(second).toBeNull();
    });

    it('suppresses duplicate even when retry uses different language', () => {
      const booking = makeBooking();

      const first = sendBookingConfirmationEmail(booking, 'en');
      expect(first).not.toBeNull();

      // Retry with different language should still be suppressed (same booking)
      const retry = sendBookingConfirmationEmail(booking, 'ms');
      expect(retry).toBeNull();
    });

    it('allows emails for different confirmation IDs', () => {
      const booking1 = makeBooking({ confirmationId: 'BK-001' });
      const booking2 = makeBooking({ confirmationId: 'BK-002' });

      const result1 = sendBookingConfirmationEmail(booking1, 'en');
      const result2 = sendBookingConfirmationEmail(booking2, 'en');

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1!.confirmationId).toBe('BK-001');
      expect(result2!.confirmationId).toBe('BK-002');
    });

    it('suppresses on multiple retries (3+ calls)', () => {
      const booking = makeBooking();

      const first = sendBookingConfirmationEmail(booking, 'en');
      expect(first).not.toBeNull();

      // Simulate 2 more retries
      expect(sendBookingConfirmationEmail(booking, 'en')).toBeNull();
      expect(sendBookingConfirmationEmail(booking, 'en')).toBeNull();
    });

    it('resets deduplication after cache clear', () => {
      const booking = makeBooking();

      const first = sendBookingConfirmationEmail(booking, 'en');
      expect(first).not.toBeNull();

      resetDedupCache();

      const afterReset = sendBookingConfirmationEmail(booking, 'en');
      expect(afterReset).not.toBeNull();
    });
  });
});
