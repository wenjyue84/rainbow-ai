/**
 * Booking State Machine Transition Validator Tests (US-312)
 *
 * 20 assertions covering:
 *   - Valid paths (6): happy-path transitions through the state machine
 *   - Invalid transitions (8): skipping states, reverse transitions, terminal exits
 *   - Cancellation scenarios (4): cancel from each non-terminal state + terminal cancel
 *   - Profile-aware validation (2): profile passed through, multi-profile audit
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB ────────────────────────────────────────────────────────
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

vi.mock('../../../src/lib/db.js', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
  },
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import {
  validateBookingTransition,
  auditBookingTransition,
} from '../../../src/assistant/workflow/booking-state.js';
import { bookingStateAudit } from '../../../shared/schema-tables.js';

// ─── Tests ──────────────────────────────────────────────────────────

describe('US-312: Booking State Machine Transition Validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Valid Paths (6 assertions) ──────────────────────────────────

  describe('valid paths', () => {
    it('should allow pending -> confirmed', () => {
      const result = validateBookingTransition('pending', 'confirmed', 'pelangi');
      expect(result.valid).toBe(true);
      expect(result.reason).toContain('Valid transition');
    });

    it('should allow confirmed -> checked_in', () => {
      const result = validateBookingTransition('confirmed', 'checked_in', 'pelangi');
      expect(result.valid).toBe(true);
      expect(result.reason).toContain('Valid transition');
    });

    it('should allow checked_in -> checked_out', () => {
      const result = validateBookingTransition('checked_in', 'checked_out', 'pelangi');
      expect(result.valid).toBe(true);
      expect(result.reason).toContain('Valid transition');
    });

    it('should allow pending -> cancelled', () => {
      const result = validateBookingTransition('pending', 'cancelled', 'pelangi');
      expect(result.valid).toBe(true);
    });

    it('should allow confirmed -> cancelled', () => {
      const result = validateBookingTransition('confirmed', 'cancelled', 'pelangi');
      expect(result.valid).toBe(true);
    });

    it('should allow checked_in -> cancelled', () => {
      const result = validateBookingTransition('checked_in', 'cancelled', 'pelangi');
      expect(result.valid).toBe(true);
    });
  });

  // ─── Invalid Transitions (8 assertions) ──────────────────────────

  describe('invalid transitions', () => {
    it('should reject pending -> checked_in (skip confirmed)', () => {
      const result = validateBookingTransition('pending', 'checked_in', 'pelangi');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid transition');
    });

    it('should reject pending -> checked_out (skip two states)', () => {
      const result = validateBookingTransition('pending', 'checked_out', 'pelangi');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid transition');
    });

    it('should reject confirmed -> checked_out (skip checked_in)', () => {
      const result = validateBookingTransition('confirmed', 'checked_out', 'pelangi');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid transition');
    });

    it('should reject confirmed -> pending (reverse transition)', () => {
      const result = validateBookingTransition('confirmed', 'pending', 'pelangi');
      expect(result.valid).toBe(false);
    });

    it('should reject checked_out -> pending (reverse from terminal)', () => {
      const result = validateBookingTransition('checked_out', 'pending', 'pelangi');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('terminal state');
    });

    it('should reject checked_out -> confirmed (exit terminal state)', () => {
      const result = validateBookingTransition('checked_out', 'confirmed', 'pelangi');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('terminal state');
    });

    it('should reject unknown source state', () => {
      const result = validateBookingTransition('booked', 'confirmed', 'pelangi');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown source state');
    });

    it('should reject unknown target state', () => {
      const result = validateBookingTransition('pending', 'approved', 'pelangi');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown target state');
    });
  });

  // ─── Cancellation Scenarios (4 assertions) ───────────────────────

  describe('cancellation scenarios', () => {
    it('should allow cancelling a pending booking', () => {
      const result = validateBookingTransition('pending', 'cancelled', 'pelangi');
      expect(result.valid).toBe(true);
      expect(result.reason).toContain('Valid transition');
    });

    it('should allow cancelling a confirmed booking', () => {
      const result = validateBookingTransition('confirmed', 'cancelled', 'southern');
      expect(result.valid).toBe(true);
    });

    it('should allow cancelling a checked-in booking', () => {
      const result = validateBookingTransition('checked_in', 'cancelled', 'pelangi');
      expect(result.valid).toBe(true);
    });

    it('should reject cancelling an already cancelled booking (self-transition)', () => {
      const result = validateBookingTransition('cancelled', 'cancelled', 'pelangi');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Self-transition not allowed');
    });
  });

  // ─── Profile-aware Validation (2 assertions) ─────────────────────

  describe('profile-aware validation', () => {
    it('should return the same validation result regardless of profile', () => {
      const pelangiResult = validateBookingTransition('pending', 'confirmed', 'pelangi');
      const southernResult = validateBookingTransition('pending', 'confirmed', 'southern');
      expect(pelangiResult.valid).toBe(true);
      expect(southernResult.valid).toBe(true);
      expect(pelangiResult.valid).toEqual(southernResult.valid);
    });

    it('should pass profile through to audit record', async () => {
      await auditBookingTransition('BK-001', 'pending', 'confirmed', 'southern');

      expect(mockInsert).toHaveBeenCalledWith(bookingStateAudit);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'BK-001',
          fromState: 'pending',
          toState: 'confirmed',
          valid: true,
          profile: 'southern',
        }),
      );
    });
  });

  // ─── Audit Logging ───────────────────────────────────────────────

  describe('audit logging', () => {
    it('should insert audit record for valid transition', async () => {
      const result = await auditBookingTransition('BK-100', 'pending', 'confirmed', 'pelangi');

      expect(result.valid).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(bookingStateAudit);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'BK-100',
          fromState: 'pending',
          toState: 'confirmed',
          valid: true,
          reason: expect.stringContaining('Valid transition'),
          profile: 'pelangi',
        }),
      );
    });

    it('should insert audit record for invalid transition', async () => {
      const result = await auditBookingTransition('BK-101', 'pending', 'checked_out', 'pelangi');

      expect(result.valid).toBe(false);
      expect(mockInsert).toHaveBeenCalledWith(bookingStateAudit);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'BK-101',
          fromState: 'pending',
          toState: 'checked_out',
          valid: false,
          reason: expect.stringContaining('Invalid transition'),
        }),
      );
    });

    it('should still return result even if DB insert fails', async () => {
      mockInsertValues.mockRejectedValueOnce(new Error('DB connection error'));

      const result = await auditBookingTransition('BK-ERR', 'pending', 'confirmed', 'pelangi');

      expect(result.valid).toBe(true);
      expect(result.reason).toContain('Valid transition');
    });
  });
});
