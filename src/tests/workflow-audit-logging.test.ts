/**
 * US-313: Booking Workflow Execution Audit Trail Recorder
 *
 * Tests:
 *  1. logWorkflowExecution inserts an audit record with correct data
 *  2. logWorkflowExecution uses provided bookingId when given
 *  3. logWorkflowExecution falls back to input.bookingId when bookingId param is omitted
 *  4. logWorkflowExecution generates a fallback bookingId when none available
 *  5. logWorkflowExecution returns the output unchanged (transparent wrapper)
 *  6. logWorkflowExecution does not throw when DB insert fails (non-blocking)
 *  7. Three booking workflow executions are logged and queryable by bookingId
 *  8. Audit records contain correct status values
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (hoisted) ───────────────────────────────────────────────────────

const { poolQueryMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
}));

vi.mock('../lib/db.js', () => ({
  pool: { query: poolQueryMock },
  dbReady: Promise.resolve(true),
}));

vi.mock('../assistant/config-store.js', () => ({
  configStore: {
    getWorkflows: vi.fn().mockReturnValue({ workflows: [] }),
    getWorkflow: vi.fn().mockReturnValue({ payment: {} }),
    getSettings: vi.fn().mockReturnValue({}),
  },
}));

vi.mock('../assistant/workflow-enhancer.js', () => ({
  enhanceWorkflowStep: vi.fn(),
}));

vi.mock('../lib/http-client.js', () => ({
  callAPI: vi.fn(),
}));

vi.mock('../lib/admin-notifier.js', () => ({
  notifyAdminConfigError: vi.fn(),
}));

vi.mock('../assistant/pipeline/workflow-transaction-handler.js', () => ({
  executeWorkflowInTransaction: vi.fn(),
  logTransactionMetrics: vi.fn(),
}));

vi.mock('../assistant/workflow-timeout-handler.js', () => ({
  executeWithTimeout: vi.fn(),
  WorkflowTimeoutError: class extends Error {},
  logTimeoutFailure: vi.fn(),
}));

vi.mock('../assistant/conversation-logger.js', () => ({
  logMessage: vi.fn(),
}));

vi.mock('../assistant/workflow-profiler.js', () => ({
  recordStepMetric: vi.fn(),
}));

vi.mock('../assistant/workflow-nodes.js', () => ({
  isNodeBasedWorkflow: vi.fn().mockReturnValue(false),
  getNodeById: vi.fn(),
  getNextNodeId: vi.fn(),
  resolveTemplateVars: vi.fn(),
  resolveVariableRef: vi.fn(),
  convertRawPhonesToLinks: vi.fn(),
}));

// ─── Import module under test ──────────────────────────────────────────────

import { logWorkflowExecution } from '../assistant/workflow-executor.js';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('US-313: Booking Workflow Execution Audit Trail', () => {
  beforeEach(() => {
    poolQueryMock.mockReset();
    poolQueryMock.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('should insert an audit record with correct columns', async () => {
    const input = { guestName: 'Alice', roomType: 'capsule' };
    const output = { confirmationId: 'C-001', message: 'Booking confirmed' };

    await logWorkflowExecution('collect_guest_info', input, output, 'success', 'BK-100');

    expect(poolQueryMock).toHaveBeenCalledTimes(1);
    const [query, params] = poolQueryMock.mock.calls[0];
    expect(query).toContain('INSERT INTO booking_execution_audit');
    expect(query).toContain('booking_id');
    expect(query).toContain('step_name');
    expect(query).toContain('input');
    expect(query).toContain('output');
    expect(query).toContain('status');
    expect(query).toContain('executed_at');
    expect(params[0]).toBe('BK-100');           // bookingId
    expect(params[1]).toBe('collect_guest_info'); // stepName
    expect(params[2]).toBe(JSON.stringify(input));
    expect(params[3]).toBe(JSON.stringify(output));
    expect(params[4]).toBe('success');
  });

  it('should use provided bookingId when given', async () => {
    await logWorkflowExecution('step1', {}, {}, 'success', 'EXPLICIT-ID');

    const [, params] = poolQueryMock.mock.calls[0];
    expect(params[0]).toBe('EXPLICIT-ID');
  });

  it('should fall back to input.bookingId when bookingId param is omitted', async () => {
    await logWorkflowExecution(
      'step2',
      { bookingId: 'FROM-INPUT' },
      {},
      'success'
    );

    const [, params] = poolQueryMock.mock.calls[0];
    expect(params[0]).toBe('FROM-INPUT');
  });

  it('should generate a fallback bookingId when none available', async () => {
    await logWorkflowExecution('step3', {}, {}, 'error');

    const [, params] = poolQueryMock.mock.calls[0];
    expect(params[0]).toMatch(/^booking-\d+$/);
  });

  it('should return the output unchanged (transparent wrapper)', async () => {
    const output = { result: 'ok', data: [1, 2, 3] };
    const result = await logWorkflowExecution('step4', {}, output, 'success', 'BK-200');

    expect(result).toBe(output); // Same reference
  });

  it('should not throw when DB insert fails (non-blocking)', async () => {
    poolQueryMock.mockRejectedValueOnce(new Error('connection refused'));

    // Should not throw
    const result = await logWorkflowExecution(
      'step5',
      { foo: 'bar' },
      { result: 'ok' },
      'error',
      'BK-300'
    );

    expect(result).toEqual({ result: 'ok' });
  });

  it('should log 3+ booking workflow executions queryable by bookingId', async () => {
    const bookingId = 'BK-MULTI-001';

    // Simulate 3 sequential workflow steps for the same booking
    await logWorkflowExecution(
      'collect_dates',
      { checkIn: '2026-04-01', checkOut: '2026-04-03' },
      { datesValid: true },
      'success',
      bookingId
    );

    await logWorkflowExecution(
      'collect_guest_info',
      { guestName: 'Bob', email: 'bob@example.com' },
      { guestRecorded: true },
      'success',
      bookingId
    );

    await logWorkflowExecution(
      'confirm_booking',
      { paymentMethod: 'cash' },
      { confirmationId: 'C-999', status: 'confirmed' },
      'success',
      bookingId
    );

    // Verify all 3 calls were made with the same bookingId
    expect(poolQueryMock).toHaveBeenCalledTimes(3);

    const allBookingIds = poolQueryMock.mock.calls.map(
      (call: [string, unknown[]]) => call[1][0]
    );
    expect(allBookingIds).toEqual([bookingId, bookingId, bookingId]);

    // Verify step names are distinct and correct
    const allStepNames = poolQueryMock.mock.calls.map(
      (call: [string, unknown[]]) => call[1][1]
    );
    expect(allStepNames).toEqual([
      'collect_dates',
      'collect_guest_info',
      'confirm_booking',
    ]);

    // Verify each call has correct input/output JSON
    const call1Params = poolQueryMock.mock.calls[0][1];
    expect(JSON.parse(call1Params[2] as string)).toEqual({
      checkIn: '2026-04-01',
      checkOut: '2026-04-03',
    });
    expect(JSON.parse(call1Params[3] as string)).toEqual({ datesValid: true });

    const call3Params = poolQueryMock.mock.calls[2][1];
    expect(JSON.parse(call3Params[2] as string)).toEqual({ paymentMethod: 'cash' });
    expect(JSON.parse(call3Params[3] as string)).toEqual({
      confirmationId: 'C-999',
      status: 'confirmed',
    });
  });

  it('should record correct status values for different outcomes', async () => {
    await logWorkflowExecution('step_ok', {}, {}, 'success', 'BK-S1');
    await logWorkflowExecution('step_fail', {}, {}, 'error', 'BK-S2');
    await logWorkflowExecution('step_timeout', {}, {}, 'timeout', 'BK-S3');
    await logWorkflowExecution('step_skip', {}, {}, 'skipped', 'BK-S4');

    const statuses = poolQueryMock.mock.calls.map(
      (call: [string, unknown[]]) => call[1][4]
    );
    expect(statuses).toEqual(['success', 'error', 'timeout', 'skipped']);
  });
});
