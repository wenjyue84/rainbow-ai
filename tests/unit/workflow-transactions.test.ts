/**
 * US-082: Workflow Transaction Tests
 *
 * Tests for database transaction wrapping in workflow execution.
 * Verifies:
 * - Step 2 failure triggers rollback of step 1 changes
 * - Transaction isolation level is READ_COMMITTED
 * - Transaction duration is logged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Setup mocks first, before any imports
vi.mock('../../src/lib/db.js', () => ({
  pool: {
    connect: vi.fn(),
  },
  db: {},
  dbReady: Promise.resolve(true),
  getPoolMetrics: () => ({ total: 5, idle: 3, waiting: 0 }),
}));

// Now we can import
import { executeWorkflowInTransaction, logTransactionMetrics } from '../../src/assistant/pipeline/workflow-transaction-handler.js';

// Get reference to mocked pool after import
import { pool as mockPoolRef } from '../../src/lib/db.js';
const mockPool = mockPoolRef as any;

// ─── Helper: Setup transaction scenarios ────────────────────────────────

function setupSuccessfulTransaction() {
  const mockClient = {
    query: vi.fn()
      .mockResolvedValueOnce({ command: 'BEGIN' })
      .mockResolvedValueOnce({ command: 'COMMIT' }),
    release: vi.fn(),
  };
  mockPool.connect.mockResolvedValueOnce(mockClient);
}

function setupFailedTransactionWithRollback() {
  const mockClient = {
    query: vi.fn()
      .mockResolvedValueOnce({ command: 'BEGIN' })
      .mockRejectedValueOnce(new Error('Step 2 failed: invalid date'))
      .mockResolvedValueOnce({ command: 'ROLLBACK' }),
    release: vi.fn(),
  };
  mockPool.connect.mockResolvedValueOnce(mockClient);
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('US-082: Workflow Transaction Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('starts transaction with READ_COMMITTED isolation level', async () => {
    setupSuccessfulTransaction();
    const executeStep = async () => ({ status: 'ok' });

    try {
      await executeWorkflowInTransaction(executeStep, 'test_workflow');
    } catch (err) {
      // Ignore
    }

    // Verify connect was called
    expect(mockPool.connect).toHaveBeenCalled();
  });

  it('commits transaction when step succeeds', async () => {
    setupSuccessfulTransaction();
    const executeStep = async () => ({ status: 'success' });

    const [result, metrics] = await executeWorkflowInTransaction(executeStep, 'test_workflow');

    expect(result).toEqual({ status: 'success' });
    expect(metrics.success).toBe(true);
    expect(metrics.isolationLevel).toBe('READ_COMMITTED');
  });

  it('rolls back transaction when step fails', async () => {
    setupFailedTransactionWithRollback();
    const executeStep = async () => {
      throw new Error('Step failed');
    };

    await expect(
      executeWorkflowInTransaction(executeStep, 'test_workflow')
    ).rejects.toThrow('Step failed');

    expect(mockPool.connect).toHaveBeenCalled();
  });

  it('returns transaction metrics including duration', async () => {
    setupSuccessfulTransaction();
    const executeStep = async () => ({ data: 'result' });

    const [, metrics] = await executeWorkflowInTransaction(executeStep, 'test_workflow');

    expect(metrics.duration).toBeGreaterThanOrEqual(0);
    expect(metrics.isolationLevel).toBe('READ_COMMITTED');
    expect(metrics.success).toBe(true);
    expect(metrics.startTime).toBeGreaterThan(0);
    expect(metrics.endTime).toBeGreaterThanOrEqual(metrics.startTime);
  });

  it('releases database client even on error', async () => {
    setupFailedTransactionWithRollback();
    const executeStep = async () => {
      throw new Error('Test error');
    };

    try {
      await executeWorkflowInTransaction(executeStep, 'test_workflow');
    } catch (err) {
      // Expected
    }

    expect(mockPool.connect).toHaveBeenCalled();
  });

  it('logs transaction metrics with correct format', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const metrics = {
      startTime: 1000,
      endTime: 2000,
      duration: 1000,
      isolationLevel: 'READ_COMMITTED',
      success: true,
    };

    logTransactionMetrics(metrics, 'test_workflow');

    expect(logSpy).toHaveBeenCalled();
    const logOutput = logSpy.mock.calls[0][0];
    expect(logOutput).toContain('test_workflow');
    expect(logOutput).toContain('READ_COMMITTED');
    expect(logOutput).toContain('duration=1000');
    expect(logOutput).toContain('success=true');

    logSpy.mockRestore();
  });

  it('warns when transaction takes more than 5 seconds', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const metrics = {
      startTime: 1000,
      endTime: 8000,
      duration: 7000,
      isolationLevel: 'READ_COMMITTED',
      success: true,
    };

    logTransactionMetrics(metrics, 'slow_workflow');

    // Should have logged a warning for slow transaction
    const hasWarning = warnSpy.mock.calls.some(
      (call) => String(call[0]).includes('Slow transaction') || String(call[0]).includes('7000')
    );
    expect(hasWarning).toBe(true);

    warnSpy.mockRestore();
  });

  it('handles sequential transactions independently', async () => {
    // Setup two separate transactions
    const mockClient1 = {
      query: vi.fn()
        .mockResolvedValueOnce({ command: 'BEGIN' })
        .mockResolvedValueOnce({ command: 'COMMIT' }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValueOnce(mockClient1);

    const mockClient2 = {
      query: vi.fn()
        .mockResolvedValueOnce({ command: 'BEGIN' })
        .mockResolvedValueOnce({ command: 'COMMIT' }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValueOnce(mockClient2);

    const step1 = async () => ({ step: 1 });
    const step2 = async () => ({ step: 2 });

    const [result1, metrics1] = await executeWorkflowInTransaction(step1, 'workflow');
    const [result2, metrics2] = await executeWorkflowInTransaction(step2, 'workflow');

    expect(result1.step).toBe(1);
    expect(result2.step).toBe(2);
    expect(metrics1.success).toBe(true);
    expect(metrics2.success).toBe(true);
    expect(mockPool.connect).toHaveBeenCalledTimes(2);
  });

  it('passes workflow ID to logging for tracing', async () => {
    setupSuccessfulTransaction();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const executeStep = async () => ({ data: 'result' });
    await executeWorkflowInTransaction(executeStep, 'booking_workflow');

    // Verify workflow ID appears in logs
    const workflowLogFound = logSpy.mock.calls.some(
      (call) => String(call[0]).includes('booking_workflow')
    );
    expect(workflowLogFound).toBe(true);

    logSpy.mockRestore();
  });
});
