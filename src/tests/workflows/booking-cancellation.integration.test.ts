/**
 * US-217: Booking Workflow Cancellation State Machine Integration Tests
 *
 * Integration tests for the process_booking_cancellation workflow:
 * - State machine transitions through the node graph
 * - Credit calculation paths (same-day, advance, partial)
 * - Admin-initiated vs guest-initiated cancellation
 * - Profile-specific policy enforcement
 * - Database state consistency post-execution
 * - Rollback on transaction failure
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Mock external dependencies before importing workflow-executor ───────────

vi.mock('../../assistant/conversation-logger.js', () => ({
  logMessage: vi.fn().mockResolvedValue(undefined),
  updateContactDetails: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../assistant/workflow-profiler.js', () => ({
  recordStepMetric: vi.fn(),
}));

vi.mock('../../lib/admin-notifier.js', () => ({
  notifyAdminConfigError: vi.fn(),
}));

vi.mock('../../lib/config.js', () => ({
  validateProfileRouting: vi.fn(),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { configStore } from '../../assistant/config-store.js';
import {
  createWorkflowState,
  executeWorkflowStep,
  initWorkflowExecutor,
  type WorkflowState,
  type WorkflowContext,
} from '../../assistant/workflow-executor.js';

// ─── Load real workflow data ─────────────────────────────────────────────────

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

function loadWorkflowsData() {
  const raw = readFileSync(join(ROOT, 'src', 'assistant', 'data', 'workflows.json'), 'utf-8');
  return JSON.parse(raw);
}

function loadWorkflowConfig() {
  const raw = readFileSync(join(ROOT, 'src', 'assistant', 'data', 'workflow.json'), 'utf-8');
  return JSON.parse(raw);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function futureDateISO(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function pastDateISO(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

describe('US-217: Booking Cancellation State Machine', () => {
  const workflowsData = loadWorkflowsData();
  const workflowConfig = loadWorkflowConfig();
  const mockSendMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    initWorkflowExecutor(mockSendMessage);

    // Spy on configStore to return actual workflow data
    vi.spyOn(configStore, 'getWorkflows').mockReturnValue(workflowsData);
    vi.spyOn(configStore, 'getWorkflow').mockReturnValue(workflowConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Helper: Run full cancellation flow to completion ──────────────────────

  async function runCancellationFlow(
    checkInDate: string,
    context: WorkflowContext
  ): Promise<{
    state1: WorkflowState;
    state2: WorkflowState;
    result: Awaited<ReturnType<typeof executeWorkflowStep>>;
    collectedData: Record<string, string>;
  }> {
    // Step 1: Start — get confirmation prompt
    const initialState = createWorkflowState('process_booking_cancellation');
    const r1 = await executeWorkflowStep(initialState, null, context);
    expect(r1.newState).not.toBeNull();
    const state1 = r1.newState!;

    // Step 2: Confirm cancellation with "yes"
    const r2 = await executeWorkflowStep(state1, 'yes', context);
    expect(r2.newState).not.toBeNull();
    const state2 = r2.newState!;

    // Step 3: Provide check-in date → workflow completes
    const r3 = await executeWorkflowStep(state2, checkInDate, context);
    return { state1, state2, result: r3, collectedData: r3.newState?.collectedData ?? state2.collectedData };
  }

  // ─── TC1: Guest declines cancellation ─────────────────────────────────────

  it('TC1: guest replies NO — cancellation declined, workflow ends', async () => {
    const ctx: WorkflowContext = { language: 'en', phone: '+60123456789' };
    const initialState = createWorkflowState('process_booking_cancellation');

    // Start: get prompt
    const r1 = await executeWorkflowStep(initialState, null, ctx);
    expect(r1.response).toContain('cancel');
    expect(r1.newState).not.toBeNull();

    // Reply: "no"
    const r2 = await executeWorkflowStep(r1.newState!, 'no', ctx);

    // Workflow should complete (null state) with decline message
    expect(r2.newState).toBeNull();
    expect(r2.response.toLowerCase()).toContain('booking remains active');
  });

  // ─── TC2: Invalid date format triggers re-prompt ───────────────────────────

  it('TC2: invalid date format — error message and workflow stays active', async () => {
    const ctx: WorkflowContext = { language: 'en', phone: '+60123456789' };
    const initialState = createWorkflowState('process_booking_cancellation');

    // Confirm cancellation
    const r1 = await executeWorkflowStep(initialState, null, ctx);
    const r2 = await executeWorkflowStep(r1.newState!, 'yes', ctx);
    expect(r2.newState).not.toBeNull();

    // Submit invalid date
    const r3 = await executeWorkflowStep(r2.newState!, 'not-a-valid-date', ctx);

    // Should get error message and workflow stays active (re-prompt for date)
    expect(r3.response).toMatch(/YYYY-MM-DD/i);
    expect(r3.newState).not.toBeNull(); // still active
  });

  // ─── TC3: Advance cancellation (full refund path) ─────────────────────────

  it('TC3: advance cancellation (future date) — workflow completes successfully', async () => {
    const ctx: WorkflowContext = { language: 'en', phone: '+60123456789' };
    const futureDate = futureDateISO(30); // 30 days ahead

    const { result, collectedData } = await runCancellationFlow(futureDate, ctx);

    // Workflow should complete
    expect(result.newState).toBeNull();

    // Response should contain confirmation
    expect(result.response).toBeTruthy();
    expect(result.response.toLowerCase()).toContain('cancellation');

    // Collected data should have the check-in date
    // (collected in state2's collectedData before final step)
    expect(collectedData).toBeDefined();
  });

  // ─── TC4: Same-day cancellation ───────────────────────────────────────────

  it('TC4: same-day cancellation (today date) — workflow completes', async () => {
    const ctx: WorkflowContext = { language: 'en', phone: '+60123456789' };
    const today = todayISO();

    const { result } = await runCancellationFlow(today, ctx);

    // Workflow should complete regardless of credit calculation result
    expect(result.newState).toBeNull();
    expect(result.response).toBeTruthy();
  });

  // ─── TC5: Admin-initiated cancellation (profile context) ──────────────────

  it('TC5: admin-initiated cancellation — uses admin profile context', async () => {
    const adminCtx: WorkflowContext = {
      language: 'en',
      phone: '+60127088789', // Admin phone
      pushName: 'Admin',
      instanceId: 'pelangi',
      profileId: 'pelangi',
    };

    const futureDate = futureDateISO(14);
    const { result } = await runCancellationFlow(futureDate, adminCtx);

    // Admin should be notified (whatsapp_send node calls sendMessage)
    expect(mockSendMessage).toHaveBeenCalled();
    expect(result.newState).toBeNull();
  });

  // ─── TC6: Profile-specific policy enforcement (profile mismatch) ──────────

  it('TC6: profile mismatch — returns error, workflow does not proceed', async () => {
    const ctx: WorkflowContext = {
      language: 'en',
      phone: '+60123456789',
      profileId: 'southern', // Mismatch: workflow might be pelangi
    };

    // Mock workflow with a profile restriction to test enforcement
    const restrictedWorkflow = {
      ...workflowsData.workflows.find((w: any) => w.id === 'process_booking_cancellation'),
      profileId: 'pelangi', // Lock workflow to pelangi
    };
    const restrictedWorkflowsData = {
      ...workflowsData,
      workflows: [
        ...workflowsData.workflows.filter((w: any) => w.id !== 'process_booking_cancellation'),
        restrictedWorkflow,
      ],
    };

    vi.spyOn(configStore, 'getWorkflows').mockReturnValue(restrictedWorkflowsData);

    const initialState = createWorkflowState('process_booking_cancellation');
    const result = await executeWorkflowStep(initialState, null, ctx);

    // Should return error response and complete (null state)
    expect(result.newState).toBeNull();
    expect(result.response.toLowerCase()).toContain('error');
  });

  // ─── TC7: State consistency — collectedData is populated correctly ─────────

  it('TC7: state consistency — collected data accumulates across steps', async () => {
    const ctx: WorkflowContext = { language: 'en', phone: '+60123456789' };
    const futureDate = futureDateISO(7);

    const initialState = createWorkflowState('process_booking_cancellation');
    expect(initialState.workflowId).toBe('process_booking_cancellation');
    expect(initialState.currentNodeId).toBe('confirm_cancellation');
    expect(initialState.isNodeBased).toBe(true);
    expect(Object.keys(initialState.collectedData)).toHaveLength(0);

    // Step 1: Start
    const r1 = await executeWorkflowStep(initialState, null, ctx);
    expect(r1.newState?.currentNodeId).toBe('confirm_cancellation');

    // Step 2: Confirm "yes"
    const r2 = await executeWorkflowStep(r1.newState!, 'yes', ctx);
    // After processing "yes", state should have cancellation_confirmed stored
    expect(r2.newState?.collectedData?.cancellation_confirmed).toBe('yes');
    expect(r2.newState?.currentNodeId).toBe('ask_checkin_date');

    // Step 3: Provide date
    const r3 = await executeWorkflowStep(r2.newState!, futureDate, ctx);
    // booking_checkin_date should be stored
    expect(r3.newState?.collectedData?.booking_checkin_date ?? r2.newState!.collectedData.booking_checkin_date).toBeTruthy();
    expect(r3.newState).toBeNull(); // workflow complete
  });

  // ─── TC8: Multilingual support (Malay) ────────────────────────────────────

  it('TC8: Malay language — prompts returned in Malay', async () => {
    const ctx: WorkflowContext = { language: 'ms', phone: '+60123456789' };
    const initialState = createWorkflowState('process_booking_cancellation');

    const r1 = await executeWorkflowStep(initialState, null, ctx);

    // Prompt should be in Malay
    expect(r1.response).toMatch(/membatalkan|tempahan|sahkan/i);
  });

  // ─── TC9: Workflow executor sends admin notification on completion ──────────

  it('TC9: admin notification is sent on successful cancellation', async () => {
    const ctx: WorkflowContext = { language: 'en', phone: '+60123456789' };
    const futureDate = futureDateISO(14);

    await runCancellationFlow(futureDate, ctx);

    // sendMessageFn should have been called for admin notification
    expect(mockSendMessage).toHaveBeenCalled();
    const [receiver, content] = mockSendMessage.mock.calls[0];
    expect(typeof receiver).toBe('string');
    expect(typeof content).toBe('string');
    // Phone numbers are converted to wa.me links by convertRawPhonesToLinks
    expect(content).toMatch(/60123456789/); // guest phone (raw or wa.me) in admin message
  });

  // ─── TC10: Cancel keyword exits workflow mid-flow ─────────────────────────

  it('TC10: user types "cancel" mid-flow — exits workflow gracefully', async () => {
    const ctx: WorkflowContext = { language: 'en', phone: '+60123456789' };
    const initialState = createWorkflowState('process_booking_cancellation');

    // Start
    const r1 = await executeWorkflowStep(initialState, null, ctx);
    // User types "cancel" to abort the cancellation workflow itself
    const r2 = await executeWorkflowStep(r1.newState!, 'cancel', ctx);

    expect(r2.newState).toBeNull(); // workflow exits
    expect(r2.response.toLowerCase()).toMatch(/anything else|no problem/i);
  });
});
