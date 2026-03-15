/**
 * Tests for US-884: Pre-arrival automated WhatsApp message sequence
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock DB before imports
vi.mock('../../lib/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

vi.mock('../../lib/session-window.js', () => ({
  sessionWindowActive: vi.fn().mockResolvedValue(true),
  logSessionExpired: vi.fn(),
}));

vi.mock('../../assistant/opt-out.js', () => ({
  isOptedOut: vi.fn().mockReturnValue(false),
}));

vi.mock('../../lib/whatsapp-cost.js', () => ({
  recordWhatsappMessageCost: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/baileys-client.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../assistant/conversation-logger.js', () => ({
  logMessage: vi.fn().mockResolvedValue(undefined),
  getConversation: vi.fn().mockResolvedValue({ pushName: 'TestGuest' }),
}));

import { pool } from '../../lib/db.js';
import {
  scheduleBookingSequence,
  cancelBookingSequence,
  listBookings,
  startBookingSequenceProcessor,
  stopBookingSequenceProcessor,
  _interpolate,
  _getTemplateContent,
  _TEMPLATES,
} from '../../lib/booking-sequence.js';
import type { BookingInput } from '../../lib/booking-sequence.js';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('US-884: Booking Sequence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    stopBookingSequenceProcessor();
  });

  // ─── Template Tests ───────────────────────────────────────────────

  describe('Template interpolation', () => {
    it('replaces {{variables}} with values', () => {
      const result = _interpolate('Hello {{name}}, welcome to {{place}}!', {
        name: 'Alice',
        place: 'Pelangi',
      });
      expect(result).toBe('Hello Alice, welcome to Pelangi!');
    });

    it('replaces missing variables with empty string', () => {
      const result = _interpolate('Hello {{name}}, your code is {{code}}', { name: 'Bob' });
      expect(result).toBe('Hello Bob, your code is ');
    });

    it('handles no variables', () => {
      const result = _interpolate('No vars here', {});
      expect(result).toBe('No vars here');
    });
  });

  describe('Template content', () => {
    it('returns English booking_confirmation template with vars', () => {
      const content = _getTemplateContent('booking_confirmation', {
        guestName: 'Alice',
        arrivalDate: '2026-04-01',
        checkInTime: '14:00',
        roomType: 'Capsule',
        confirmationNumber: 'BK-001',
      });
      expect(content).toContain('Booking Confirmed');
      expect(content).toContain('Alice');
      expect(content).toContain('2026-04-01');
      expect(content).toContain('BK-001');
    });

    it('returns Malay template when lang=ms', () => {
      const content = _getTemplateContent('booking_confirmation', { guestName: 'Ali' }, 'ms');
      expect(content).toContain('Tempahan Disahkan');
      expect(content).toContain('Ali');
    });

    it('returns Chinese template when lang=zh', () => {
      const content = _getTemplateContent('booking_confirmation', { guestName: 'Wei' }, 'zh');
      expect(content).toContain('预订已确认');
    });

    it('falls back to English for unknown language', () => {
      const content = _getTemplateContent('booking_confirmation', { guestName: 'Test' }, 'fr');
      expect(content).toContain('Booking Confirmed');
    });

    it('returns error for unknown template key', () => {
      const content = _getTemplateContent('nonexistent_template', {});
      expect(content).toContain('not found');
    });

    it('has all 3 templates defined', () => {
      expect(_TEMPLATES).toHaveProperty('booking_confirmation');
      expect(_TEMPLATES).toHaveProperty('booking_directions');
      expect(_TEMPLATES).toHaveProperty('booking_ready');
    });

    it('booking_directions contains address and WiFi info', () => {
      const content = _getTemplateContent('booking_directions', { guestName: 'Guest', checkInTime: '14:00' });
      expect(content).toContain('26A Jalan Perang');
      expect(content).toContain('pelangi capsule');
      expect(content).toContain('1270#');
    });

    it('booking_ready contains door password', () => {
      const content = _getTemplateContent('booking_ready', { guestName: 'Guest', checkInTime: '14:00' });
      expect(content).toContain('1270#');
      expect(content).toContain('Ready');
    });
  });

  // ─── Schedule Tests ───────────────────────────────────────────────

  describe('scheduleBookingSequence', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days out
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const baseInput: BookingInput = {
      jid: '60123456789@s.whatsapp.net',
      guestName: 'Test Guest',
      arrivalDate: futureDateStr,
      checkInTime: '14:00',
      roomType: 'Capsule',
      confirmationNumber: 'TEST-001',
    };

    it('schedules 3 messages for far-future booking', async () => {
      const result = await scheduleBookingSequence(baseInput);

      expect(result.bookingId).toMatch(/^bk-/);
      expect(result.scheduled).toHaveLength(3);
      expect(result.scheduled.map(s => s.step)).toEqual(['confirmation', 'directions', 'ready']);
      expect(result.skipped).toHaveLength(0);

      // 3 INSERT queries
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('skips directions if arrival within 24h', async () => {
      const soonDate = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12h from now
      const soonDateStr = soonDate.toISOString().split('T')[0];
      const soonTime = `${soonDate.getHours().toString().padStart(2, '0')}:${soonDate.getMinutes().toString().padStart(2, '0')}`;

      const result = await scheduleBookingSequence({
        ...baseInput,
        arrivalDate: soonDateStr,
        checkInTime: soonTime,
      });

      expect(result.skipped).toContain('directions (arrival within 24h)');
      // Should have confirmation + ready = 2 messages
      expect(result.scheduled.length).toBeLessThanOrEqual(2);
    });

    it('skips ready if arrival within 1h', async () => {
      const veryNow = new Date(Date.now() + 30 * 60 * 1000); // 30min from now
      const nowDateStr = veryNow.toISOString().split('T')[0];
      const nowTime = `${veryNow.getHours().toString().padStart(2, '0')}:${veryNow.getMinutes().toString().padStart(2, '0')}`;

      const result = await scheduleBookingSequence({
        ...baseInput,
        arrivalDate: nowDateStr,
        checkInTime: nowTime,
      });

      expect(result.skipped).toContain('ready (arrival within 1h)');
    });

    it('uses default checkInTime if not provided', async () => {
      const result = await scheduleBookingSequence({
        jid: '60123456789@s.whatsapp.net',
        guestName: 'No Time Guest',
        arrivalDate: futureDateStr,
      });

      expect(result.bookingId).toBeTruthy();
      // Check that INSERT was called with variables containing checkInTime: '14:00'
      const insertCalls = mockQuery.mock.calls;
      const firstInsertVars = insertCalls[0][1][4]; // variables param
      const parsed = JSON.parse(firstInsertVars);
      expect(parsed.checkInTime).toBe('14:00');
    });

    it('generates unique booking IDs', async () => {
      const r1 = await scheduleBookingSequence(baseInput);
      const r2 = await scheduleBookingSequence(baseInput);
      expect(r1.bookingId).not.toBe(r2.bookingId);
    });
  });

  // ─── Cancel Tests ─────────────────────────────────────────────────

  describe('cancelBookingSequence', () => {
    it('cancels pending messages for a booking', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 2, rows: [] });
      const count = await cancelBookingSequence('bk-test-123');
      expect(count).toBe(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE scheduled_messages'),
        ['bk-test-123']
      );
    });

    it('returns 0 when no pending messages found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const count = await cancelBookingSequence('nonexistent');
      expect(count).toBe(0);
    });
  });

  // ─── List Tests ───────────────────────────────────────────────────

  describe('listBookings', () => {
    it('returns empty array when no bookings', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const bookings = await listBookings();
      expect(bookings).toEqual([]);
    });

    it('parses booking rows with variables', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          booking_id: 'bk-123',
          jid: '60123456789',
          profile_id: 'pelangi',
          variables: JSON.stringify({ guestName: 'Alice', arrivalDate: '2026-04-01' }),
          created_at: new Date(),
          steps: ['confirmation', 'directions', 'ready'],
          step_statuses: ['sent', 'pending', 'pending'],
          send_times: [new Date(), new Date(), new Date()],
        }],
        rowCount: 1,
      });

      const bookings = await listBookings();
      expect(bookings).toHaveLength(1);
      expect(bookings[0].bookingId).toBe('bk-123');
      expect(bookings[0].guestName).toBe('Alice');
      expect(bookings[0].steps).toHaveLength(3);
      expect(bookings[0].steps[0].step).toBe('confirmation');
    });
  });

  // ─── Processor Tests ──────────────────────────────────────────────

  describe('Processor lifecycle', () => {
    it('starts and stops without error', () => {
      startBookingSequenceProcessor();
      stopBookingSequenceProcessor();
    });

    it('calling stop when not started is safe', () => {
      expect(() => stopBookingSequenceProcessor()).not.toThrow();
    });
  });
});
