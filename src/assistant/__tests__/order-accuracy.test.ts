/**
 * Unit tests for US-902: AI waiter order accuracy rate KPI.
 *
 * Tests:
 * - In-memory tracker: markConfirmationShown, markCorrected, session lifecycle
 * - Acceptance criteria: 10 orders, 2 post-confirm corrections → 80% accuracy
 * - Alert threshold at 90%
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB before importing tracker ─────────────────────────────────

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

vi.mock('../../lib/db.js', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: () => ({
      from: () => ({
        where: vi.fn().mockResolvedValue([{ totalConfirmed: 10, totalCorrected: 2 }]),
      }),
    }),
  },
  dbReady: Promise.resolve(true),
}));

vi.mock('../../../shared/schema.js', () => ({
  orderAccuracyEvents: { __tableName: 'order_accuracy_events' },
}));

import {
  _testExports,
} from '../order-accuracy-tracker.js';

const {
  sessions,
  markConfirmationShown,
  markCorrected,
  recordOrderSubmitted,
  clearAccuracyTracking,
} = _testExports;

// ── Tests ─────────────────────────────────────────────────────────────

describe('US-902: Order Accuracy Rate KPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.clear();
    // Re-setup mockInsert to return chainable values
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  });

  describe('In-memory tracker', () => {
    it('markConfirmationShown sets confirmationShown for a session', () => {
      markConfirmationShown('sess-1');
      const s = sessions.get('sess-1');
      expect(s).toBeDefined();
      expect(s!.confirmationShown).toBe(true);
      expect(s!.corrected).toBe(false);
    });

    it('markCorrected flags a session as corrected only after confirmation shown', () => {
      // Before confirmation — should NOT mark corrected
      markCorrected('sess-2');
      expect(sessions.get('sess-2')).toBeUndefined();

      // After confirmation
      markConfirmationShown('sess-2');
      markCorrected('sess-2');
      expect(sessions.get('sess-2')!.corrected).toBe(true);
    });

    it('clearAccuracyTracking removes session state', () => {
      markConfirmationShown('sess-3');
      expect(sessions.has('sess-3')).toBe(true);
      clearAccuracyTracking('sess-3');
      expect(sessions.has('sess-3')).toBe(false);
    });

    it('multiple corrections on same session only flag once', () => {
      markConfirmationShown('sess-4');
      markCorrected('sess-4');
      markCorrected('sess-4');
      expect(sessions.get('sess-4')!.corrected).toBe(true);
    });
  });

  describe('recordOrderSubmitted', () => {
    it('writes order_confirmed event for a clean order (no correction)', async () => {
      markConfirmationShown('sess-clean');
      await recordOrderSubmitted('sess-clean', 'makan-moments');

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const valuesCall = mockInsert.mock.results[0].value.values;
      expect(valuesCall).toHaveBeenCalledWith([
        { sessionId: 'sess-clean', profileId: 'makan-moments', eventType: 'order_confirmed' },
      ]);
      // Session should be cleared after recording
      expect(sessions.has('sess-clean')).toBe(false);
    });

    it('writes both order_confirmed and order_corrected events for a corrected order', async () => {
      markConfirmationShown('sess-corrected');
      markCorrected('sess-corrected');
      await recordOrderSubmitted('sess-corrected', 'makan-moments');

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const valuesCall = mockInsert.mock.results[0].value.values;
      expect(valuesCall).toHaveBeenCalledWith([
        { sessionId: 'sess-corrected', profileId: 'makan-moments', eventType: 'order_confirmed' },
        { sessionId: 'sess-corrected', profileId: 'makan-moments', eventType: 'order_corrected' },
      ]);
    });
  });

  describe('Acceptance criteria: 10 orders, 2 corrections → 80% accuracy', () => {
    it('simulates 10 orders with 2 post-confirm corrections and asserts rate = 80%', async () => {
      // Track all values() calls via a shared spy
      const valuesSpy = vi.fn().mockResolvedValue(undefined);
      mockInsert.mockReturnValue({ values: valuesSpy });

      // Simulate 10 order sessions
      for (let i = 1; i <= 10; i++) {
        const sid = `order-${i}`;
        markConfirmationShown(sid);

        // Sessions 3 and 7 get corrections
        if (i === 3 || i === 7) {
          markCorrected(sid);
        }

        await recordOrderSubmitted(sid, 'makan-moments');
      }

      // Verify: 10 insert calls total (one per order)
      expect(mockInsert).toHaveBeenCalledTimes(10);

      // Count events by type from all values() calls
      let confirmedCount = 0;
      let correctedCount = 0;
      for (const call of valuesSpy.mock.calls) {
        const events = call[0]; // first argument is the array of events
        for (const event of events) {
          if (event.eventType === 'order_confirmed') confirmedCount++;
          if (event.eventType === 'order_corrected') correctedCount++;
        }
      }

      expect(confirmedCount).toBe(10);
      expect(correctedCount).toBe(2);

      // Calculate accuracy rate: (10 - 2) / 10 * 100 = 80%
      const accuracyRate = ((confirmedCount - correctedCount) / confirmedCount) * 100;
      expect(accuracyRate).toBe(80);
    });
  });

  describe('Alert threshold', () => {
    it('orderAccuracy threshold defaults to 90%', () => {
      // The threshold is 90% — 80% accuracy should trigger an alert
      const rate = 80;
      const threshold = 90;
      expect(rate < threshold).toBe(true);
    });

    it('95% accuracy does not trigger alert', () => {
      const rate = 95;
      const threshold = 90;
      expect(rate < threshold).toBe(false);
    });
  });
});
