/**
 * US-309: Booking Workflow Step Execution Trace Logger — Unit Tests
 *
 * Asserts trace records are created for workflow steps with correct
 * input/output capture, error handling, and non-blocking DB writes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────
const insertValues = vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue({}) });
const insertMock = vi.fn().mockReturnValue({ values: insertValues });

vi.mock('../../../src/lib/db.js', () => ({
  db: { insert: (...args: any[]) => insertMock(...args) },
  dbReady: Promise.resolve(true),
}));

vi.mock('../../../../shared/schema-tables.js', () => ({
  bookingWorkflowTraces: Symbol('bookingWorkflowTraces'),
}));

import { executeWorkflowStepWithTrace } from '../../../src/assistant/workflow/executor.js';
import { bookingWorkflowTraces } from '../../../shared/schema-tables.js';

// ─── Helpers ──────────────────────────────────────────────────────────
function flushPromises() {
  return new Promise((r) => setTimeout(r, 10));
}

// ─── Tests ────────────────────────────────────────────────────────────
describe('executeWorkflowStepWithTrace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues.mockReturnValue({ execute: vi.fn().mockResolvedValue({}) });
    insertMock.mockReturnValue({ values: insertValues });
  });

  it('creates a trace record for a successful step', async () => {
    const result = await executeWorkflowStepWithTrace(
      'collect_dates',
      { bookingId: 'B-001' },
      async () => ({ checkIn: '2026-04-01' }),
    );
    await flushPromises();

    expect(result).toEqual({ checkIn: '2026-04-01' });
    expect(insertMock).toHaveBeenCalledWith(bookingWorkflowTraces);
    const vals = insertValues.mock.calls[0][0];
    expect(vals.bookingId).toBe('B-001');
    expect(vals.stepName).toBe('collect_dates');
    expect(vals.errorMsg).toBeUndefined();
    expect(vals.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures input context as inputJson', async () => {
    await executeWorkflowStepWithTrace(
      'select_room',
      { bookingId: 'B-002', guests: 2 },
      async () => 'room-A',
    );
    await flushPromises();

    const vals = insertValues.mock.calls[0][0];
    expect(vals.inputJson).toMatchObject({ bookingId: 'B-002', guests: 2 });
  });

  it('captures output as outputJson', async () => {
    await executeWorkflowStepWithTrace(
      'calc_price',
      { bookingId: 'B-003' },
      async () => ({ total: 150, currency: 'MYR' }),
    );
    await flushPromises();

    const vals = insertValues.mock.calls[0][0];
    expect(vals.outputJson).toMatchObject({ total: 150, currency: 'MYR' });
  });

  it('captures error message and re-throws on step failure', async () => {
    await expect(
      executeWorkflowStepWithTrace(
        'payment',
        { bookingId: 'B-004' },
        async () => { throw new Error('Card declined'); },
      ),
    ).rejects.toThrow('Card declined');
    await flushPromises();

    const vals = insertValues.mock.calls[0][0];
    expect(vals.errorMsg).toBe('Card declined');
    expect(vals.stepName).toBe('payment');
  });

  it('uses "unknown" when bookingId is missing from context', async () => {
    await executeWorkflowStepWithTrace('init', {}, async () => 'ok');
    await flushPromises();

    const vals = insertValues.mock.calls[0][0];
    expect(vals.bookingId).toBe('unknown');
  });

  it('traces all 5 steps of a multi-step workflow', async () => {
    const steps = ['collect_dates', 'select_room', 'calc_price', 'confirm', 'notify'];
    for (const step of steps) {
      await executeWorkflowStepWithTrace(step, { bookingId: 'B-005' }, async () => `done-${step}`);
    }
    await flushPromises();

    expect(insertMock).toHaveBeenCalledTimes(5);
    const stepNames = insertValues.mock.calls.map((c: any) => c[0].stepName);
    expect(stepNames).toEqual(steps);
  });
});
