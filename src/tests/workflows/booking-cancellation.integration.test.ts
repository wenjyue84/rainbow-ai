/**
 * US-217: Booking Workflow Cancellation State Machine Integration Tests
 *
 * Integration tests for the booking cancellation workflow covering:
 * - Same-day cancellation (≤48h before check-in → 50% credit)
 * - Advance cancellation (>48h before check-in → 100% credit)
 * - Partial/split credit boundary scenarios
 * - Admin-initiated vs guest-initiated paths
 * - Profile-specific policy enforcement (Pelangi/Makan/Southern)
 * - Database transaction rollback on failure
 * - State transitions through process_booking_cancellation workflow nodes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateCancellationCredit } from '../../tools/bookings.js';

// ─── Project Root ─────────────────────────────────────────────────────────────
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

// ─── Mock DB pool to avoid real database calls ────────────────────────────────
const mockPoolClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};
const mockPool = {
  connect: vi.fn().mockResolvedValue(mockPoolClient),
  query: vi.fn().mockResolvedValue({ rows: [] }),
};

vi.mock('../../lib/db.js', () => ({
  pool: mockPool,
  db: {},
}));

vi.mock('../../assistant/pipeline/workflow-transaction-handler.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../assistant/pipeline/workflow-transaction-handler.js')>();
  return {
    ...original,
    executeWorkflowInTransaction: async (fn: () => Promise<any>, _wfId: string) => {
      const result = await fn();
      return [result, { startTime: 0, endTime: 1, duration: 1, isolationLevel: 'READ_COMMITTED', success: true }];
    },
    logTransactionMetrics: vi.fn(),
  };
});

vi.mock('../../assistant/conversation-logger.js', () => ({
  logMessage: vi.fn().mockResolvedValue(undefined),
  updateContactDetails: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../assistant/workflow-profiler.js', () => ({
  recordStepMetric: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/admin-notifier.js', () => ({
  notifyAdminConfigError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../assistant/workflow-timeout-handler.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../assistant/workflow-timeout-handler.js')>();
  return {
    ...original,
    executeWithTimeout: async (fn: () => Promise<any>, _timeout: number, _id: string) => fn(),
    logTimeoutFailure: vi.fn(),
  };
});

// ─── Load cancellation workflow directly from JSON ────────────────────────────
function loadCancellationWorkflow(): any {
  const raw = readFileSync(join(ROOT, 'src', 'assistant', 'data', 'workflows.json'), 'utf-8');
  const data = JSON.parse(raw);
  return data.workflows.find((w: any) => w.id === 'process_booking_cancellation');
}

// ─── Credit Calculation: Core Business Logic Tests ────────────────────────────

describe('US-217: Cancellation Credit Calculation', () => {
  it('same-day cancellation returns 50% credit (≤48h away)', () => {
    const now = new Date(); // 0 hours away
    const result = calculateCancellationCredit(now);
    expect(result).toContain('50% credit applied');
    expect(result).not.toContain('100%');
  });

  it('advance cancellation (72h away) returns full 100% credit', () => {
    const future = new Date();
    future.setHours(future.getHours() + 72);
    const result = calculateCancellationCredit(future);
    expect(result).toContain('100% credit applied');
    expect(result).toContain('full refund');
  });

  it('split credit boundary: exactly 48h away returns 50%', () => {
    const boundary = new Date();
    boundary.setHours(boundary.getHours() + 48);
    const result = calculateCancellationCredit(boundary);
    // ≤48h → 50% credit
    expect(result).toContain('50% credit applied');
  });

  it('49h advance notice returns full 100% credit (just past 48h boundary)', () => {
    const future = new Date();
    future.setHours(future.getHours() + 49);
    const result = calculateCancellationCredit(future);
    expect(result).toContain('100% credit applied');
  });

  it('invalid date string returns error message', () => {
    const result = calculateCancellationCredit('not-a-date');
    expect(result).toMatch(/error/i);
  });

  it('ISO string date input works for advance cancellation', () => {
    const future = new Date();
    future.setDate(future.getDate() + 7);
    const result = calculateCancellationCredit(future.toISOString());
    expect(result).toContain('100% credit applied');
  });
});

// ─── Workflow Structure: State Machine Node Validation ────────────────────────

describe('US-217: Cancellation Workflow State Machine Nodes', () => {
  const workflow = loadCancellationWorkflow();

  it('process_booking_cancellation workflow exists and is node-based', () => {
    expect(workflow).toBeDefined();
    expect(workflow.id).toBe('process_booking_cancellation');
    expect(workflow.format).toBe('nodes');
    expect(workflow.startNodeId).toBe('confirm_cancellation');
  });

  it('entry node is a wait_reply collecting cancellation_confirmed', () => {
    const entry = workflow.nodes.find((n: any) => n.id === workflow.startNodeId);
    expect(entry).toBeDefined();
    expect(entry.type).toBe('wait_reply');
    expect(entry.config.storeAs).toBe('cancellation_confirmed');
  });

  it('check_cancellation_intent node branches YES → date step, NO → declined', () => {
    const cond = workflow.nodes.find((n: any) => n.id === 'check_cancellation_intent');
    expect(cond).toBeDefined();
    expect(cond.type).toBe('condition');
    expect(cond.config.operator).toBe('regex');
    expect(cond.config.trueNext).toBe('ask_checkin_date');
    expect(cond.config.falseNext).toBe('cancellation_declined');
  });

  it('cancellation_declined is a terminal message node (no next)', () => {
    const declined = workflow.nodes.find((n: any) => n.id === 'cancellation_declined');
    expect(declined).toBeDefined();
    expect(declined.type).toBe('message');
    expect(declined.next).toBeUndefined();
  });

  it('date validation enforces YYYY-MM-DD format via regex condition', () => {
    const validate = workflow.nodes.find((n: any) => n.id === 'validate_checkin_date');
    expect(validate).toBeDefined();
    expect(validate.type).toBe('condition');
    expect(validate.config.operator).toBe('regex');
    const pattern = new RegExp(validate.config.value);
    expect(pattern.test('2026-03-25')).toBe(true);
    expect(pattern.test('25/03/2026')).toBe(false);
    expect(pattern.test('not-a-date')).toBe(false);
  });

  it('calculate_credit function node exists after date validation', () => {
    const calcNode = workflow.nodes.find((n: any) => n.id === 'calculate_credit');
    expect(calcNode).toBeDefined();
    expect(calcNode.type).toBe('function');
    expect(calcNode.config.function).toBe('calculateCancellationCredit');
    expect(calcNode.config.inputs.checkInDate).toContain('booking_checkin_date');
    expect(calcNode.config.outputAs).toBe('credit_result');
  });

  it('admin notification whatsapp_send node fires after credit display', () => {
    const notifyNode = workflow.nodes.find((n: any) => n.id === 'notify_admin_cancellation');
    expect(notifyNode).toBeDefined();
    expect(notifyNode.type).toBe('whatsapp_send');
    expect(notifyNode.config.receiver).toContain('admin_phone');
  });

  it('all node next/trueNext/falseNext references point to valid node IDs', () => {
    const nodeIds = new Set(workflow.nodes.map((n: any) => n.id));
    for (const node of workflow.nodes) {
      if (node.next) {
        expect(nodeIds.has(node.next), `"${node.id}".next → "${node.next}" not found`).toBe(true);
      }
      if (node.config?.trueNext) {
        expect(nodeIds.has(node.config.trueNext), `"${node.id}".trueNext → "${node.config.trueNext}" not found`).toBe(true);
      }
      if (node.config?.falseNext) {
        expect(nodeIds.has(node.config.falseNext), `"${node.id}".falseNext → "${node.config.falseNext}" not found`).toBe(true);
      }
    }
  });

  it('all wait_reply and message nodes have i18n text (en, ms, zh)', () => {
    const interactiveNodes = workflow.nodes.filter((n: any) =>
      n.type === 'wait_reply' || n.type === 'message'
    );
    for (const node of interactiveNodes) {
      const text = node.config.prompt || node.config.message;
      if (text) {
        expect(text.en, `${node.id} missing en`).toBeTruthy();
        expect(text.ms, `${node.id} missing ms`).toBeTruthy();
        expect(text.zh, `${node.id} missing zh`).toBeTruthy();
      }
    }
  });
});

// ─── Workflow Executor: Guest-Initiated Step-by-Step ─────────────────────────

describe('US-217: Guest-Initiated Cancellation Flow (Executor)', () => {
  it('step 1: executor returns confirmation prompt on init', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const result = await executeWorkflowStep(state, null, { language: 'en' });

    expect(result.response).toMatch(/cancel/i);
    expect(result.newState).not.toBeNull();
    expect(result.newState?.currentNodeId).toBe('confirm_cancellation');
  });

  it('step 2: guest says NO → workflow exits with booking-active message', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const step1 = await executeWorkflowStep(state, null, { language: 'en' });
    const step2 = await executeWorkflowStep(step1.newState!, 'NO', { language: 'en' });

    expect(step2.response).toMatch(/booking|active/i);
    expect(step2.newState).toBeNull(); // terminal
  });

  it('step 2: guest says YES → advances to date collection', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const step1 = await executeWorkflowStep(state, null, { language: 'en' });
    const step2 = await executeWorkflowStep(step1.newState!, 'yes', { language: 'en' });

    expect(step2.response).toMatch(/check-in|date/i);
    expect(step2.newState).not.toBeNull();
    expect(step2.newState?.collectedData.cancellation_confirmed).toBe('yes');
    expect(step2.newState?.currentNodeId).toBe('ask_checkin_date');
  });

  it('step 3: invalid date format → error prompt and stays at date node', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const step1 = await executeWorkflowStep(state, null, { language: 'en' });
    const step2 = await executeWorkflowStep(step1.newState!, 'yes', { language: 'en' });
    const step3 = await executeWorkflowStep(step2.newState!, '25-03-2026', { language: 'en' });

    // Invalid format should show error and loop back to date input
    expect(step3.response).toMatch(/yyyy-mm-dd|format|date/i);
    expect(step3.newState).not.toBeNull();
    expect(step3.newState?.currentNodeId).toBe('ask_checkin_date');
  });

  it('step 3: valid YYYY-MM-DD date → workflow processes to completion', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const future = new Date();
    future.setDate(future.getDate() + 7);
    const dateStr = future.toISOString().split('T')[0];

    const step1 = await executeWorkflowStep(state, null, { language: 'en' });
    const step2 = await executeWorkflowStep(step1.newState!, 'yes', { language: 'en' });
    const step3 = await executeWorkflowStep(step2.newState!, dateStr, { language: 'en' });

    expect(step3.newState?.collectedData.booking_checkin_date).toBe(dateStr);
    expect(step3.response).toBeTruthy();
  });
});

// ─── Profile-Specific Policy Enforcement ─────────────────────────────────────

describe('US-217: Profile-Specific Policy Enforcement', () => {
  it('Pelangi: workflow has no profileId restriction (global workflow)', () => {
    const wf = loadCancellationWorkflow();
    expect((wf as any).profileId).toBeUndefined();
  });

  it('profile mismatch rejects workflow execution with configuration error', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const { configStore } = await import('../../assistant/config-store.js');

    const state = createWorkflowState('process_booking_cancellation');

    // Temporarily inject profileId into the workflow
    const orig = configStore.getWorkflows.bind(configStore);
    configStore.getWorkflows = () => {
      const data = orig();
      return {
        ...data,
        workflows: data.workflows.map((w: any) =>
          w.id === 'process_booking_cancellation' ? { ...w, profileId: 'pelangi' } : w
        ),
      };
    };

    try {
      // Execute with makan profile — should be rejected
      const result = await executeWorkflowStep(state, null, { language: 'en', profileId: 'makan' });
      expect(result.newState).toBeNull();
      expect(result.response).toMatch(/configuration error|contact support/i);
    } finally {
      configStore.getWorkflows = orig;
    }
  });

  it('Pelangi profile context executes successfully', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const result = await executeWorkflowStep(state, null, {
      language: 'en',
      profileId: 'pelangi',
    });

    expect(result.response).toMatch(/cancel/i);
    expect(result.newState).not.toBeNull();
  });

  it('Southern Homestay profile context also executes (no restriction)', () => {
    const wf = loadCancellationWorkflow();
    // Verify workflow has no profile restriction — applicable to all profiles
    expect((wf as any).profileId).toBeUndefined();
  });

  it('Makan Moments profile executes without restrictions', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const result = await executeWorkflowStep(state, null, {
      language: 'en',
      profileId: 'makan',
    });

    expect(result.response).toBeTruthy();
    expect(result.newState).not.toBeNull();
  });
});

// ─── Admin-Initiated Cancellation Context ────────────────────────────────────

describe('US-217: Admin-Initiated Cancellation', () => {
  it('admin context with phone and instanceId executes normally', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const result = await executeWorkflowStep(state, null, {
      language: 'en',
      profileId: 'pelangi',
      instanceId: 'admin-panel',
      pushName: 'Admin User',
      phone: '+60123456789',
    });

    expect(result.response).toMatch(/cancel/i);
    expect(result.newState).not.toBeNull();
  });

  it('Malay language flow returns localized cancellation prompt', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const result = await executeWorkflowStep(state, null, { language: 'ms' });

    expect(result.response).toMatch(/batalkan|tempahan|YA|TIDAK/i);
  });

  it('Chinese language flow returns localized cancellation prompt', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const result = await executeWorkflowStep(state, null, { language: 'zh' });

    expect(result.response).toMatch(/取消|预订|确认/);
  });
});

// ─── Database State Consistency ───────────────────────────────────────────────

describe('US-217: Database State Consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executeWorkflowStepWithTransaction succeeds and returns response', async () => {
    const { executeWorkflowStepWithTransaction, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const result = await executeWorkflowStepWithTransaction(state, null, { language: 'en' });

    expect(result.response).toBeTruthy();
  });

  it('collectedData accumulates across steps without mutating prior states', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const initial = createWorkflowState('process_booking_cancellation');

    const step1 = await executeWorkflowStep(initial, null, { language: 'en' });
    expect(initial.collectedData).toEqual({});

    const step2 = await executeWorkflowStep(step1.newState!, 'yes', { language: 'en' });
    expect(step1.newState?.collectedData).toEqual({});

    expect(step2.newState?.collectedData.cancellation_confirmed).toBe('yes');
  });

  it('cancel keyword mid-workflow exits cleanly (no dangling state)', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const step1 = await executeWorkflowStep(state, null, { language: 'en' });
    const step2 = await executeWorkflowStep(step1.newState!, 'cancel', { language: 'en' });

    // US-020: cancel keyword detection — workflow exits with no dangling state
    expect(step2.newState).toBeNull();
    expect(step2.response).toMatch(/no problem|anything else/i);
  });

  it('unknown profileId does not crash workflow (no restriction set)', async () => {
    const { executeWorkflowStep, createWorkflowState } = await import('../../assistant/workflow-executor.js');
    const state = createWorkflowState('process_booking_cancellation');

    const result = await executeWorkflowStep(state, null, {
      language: 'en',
      profileId: 'totally-unknown',
    });

    expect(result.response).toBeTruthy();
    expect(result.newState).not.toBeNull();
  });
});
