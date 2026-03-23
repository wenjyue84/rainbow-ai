/**
 * US-284: Booking Workflow Step Output Schema Validator — Unit Tests
 *
 * Tests validateWorkflowStepOutput() with 8 test cases covering:
 * - Valid outputs for different step types
 * - Missing required fields
 * - Type mismatches
 * - Null values
 * - Empty strings
 * - Unknown step IDs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateWorkflowStepOutput,
  deriveStepSchema,
  findNodeInWorkflows,
  type WorkflowNodeDef,
} from '../booking-executor.js';

// Mock the db module so tests don't need a real database
vi.mock('../../../lib/db.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ─── Test Fixtures ──────────────────────────────────────────────────

/** Minimal workflows.json structure for testing */
const testWorkflowsData = {
  workflows: [
    {
      id: 'booking_payment_handler',
      nodes: [
        {
          id: 'wait_guest_name',
          type: 'wait_reply',
          config: { storeAs: 'guest_name', prompt: { en: 'What is your name?' } },
          next: 'wait_guest_count',
        },
        {
          id: 'wait_guest_count',
          type: 'wait_reply',
          config: { storeAs: 'guest_count', prompt: { en: 'How many guests?' } },
          next: 'wait_booking_dates',
        },
        {
          id: 'validate_dates',
          type: 'condition',
          config: {
            field: '{{workflow.data.booking_dates}}',
            operator: 'regex',
            value: '\\d+',
            trueNext: 'confirm_booking_msg',
            falseNext: 'date_error_reprompt',
          },
        },
        {
          id: 'confirm_booking_msg',
          type: 'message',
          config: {
            message: { en: 'Booking confirmed!', ms: 'Tempahan disahkan!' },
          },
          next: 'booking_notify_admin',
        },
        {
          id: 'booking_notify_admin',
          type: 'whatsapp_send',
          config: {
            receiver: '{{system.admin_phone}}',
            content: { en: 'New booking from {{guest.name}}' },
          },
        },
      ] as WorkflowNodeDef[],
    },
    {
      id: 'checkin_full',
      steps: [
        {
          id: 'checkin_api_call',
          type: 'pelangi_api',
          config: { endpoint: '/api/checkin' },
        },
        {
          id: 'process_result',
          type: 'function',
          config: { handler: 'processCheckin' },
        },
      ] as WorkflowNodeDef[],
    },
  ],
};

// ─── deriveStepSchema tests ─────────────────────────────────────────

describe('deriveStepSchema', () => {
  it('derives schema for wait_reply nodes with storeAs field', () => {
    const node: WorkflowNodeDef = {
      id: 'wait_guest_name',
      type: 'wait_reply',
      config: { storeAs: 'guest_name' },
    };
    const schema = deriveStepSchema(node);
    expect(schema).toEqual([
      { name: 'guest_name', type: 'string', required: true },
    ]);
  });

  it('derives schema for condition nodes', () => {
    const node: WorkflowNodeDef = {
      id: 'validate_dates',
      type: 'condition',
      config: { field: '{{workflow.data.booking_dates}}' },
    };
    const schema = deriveStepSchema(node);
    expect(schema).toEqual([
      { name: 'conditionResult', type: 'boolean', required: true },
      { name: 'evaluatedField', type: 'string', required: true },
    ]);
  });

  it('derives schema for message nodes', () => {
    const node: WorkflowNodeDef = {
      id: 'confirm_msg',
      type: 'message',
      config: { message: { en: 'Done!' } },
    };
    const schema = deriveStepSchema(node);
    expect(schema).toEqual([
      { name: 'message', type: 'string', required: true },
    ]);
  });
});

// ─── findNodeInWorkflows tests ──────────────────────────────────────

describe('findNodeInWorkflows', () => {
  it('finds node in nodes array', () => {
    const node = findNodeInWorkflows('wait_guest_name', testWorkflowsData);
    expect(node).not.toBeNull();
    expect(node!.type).toBe('wait_reply');
  });

  it('finds node in steps array', () => {
    const node = findNodeInWorkflows('checkin_api_call', testWorkflowsData);
    expect(node).not.toBeNull();
    expect(node!.type).toBe('pelangi_api');
  });

  it('returns null for unknown step', () => {
    const node = findNodeInWorkflows('nonexistent_step', testWorkflowsData);
    expect(node).toBeNull();
  });
});

// ─── validateWorkflowStepOutput tests ───────────────────────────────

describe('validateWorkflowStepOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Valid wait_reply output
  it('passes for valid wait_reply output with correct string value', async () => {
    const result = await validateWorkflowStepOutput(
      'wait_guest_name',
      { guest_name: 'John Doe' },
      'pelangi',
      testWorkflowsData
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.stepId).toBe('wait_guest_name');
    expect(result.profile).toBe('pelangi');
  });

  // Test 2: Valid condition output
  it('passes for valid condition output with boolean result', async () => {
    const result = await validateWorkflowStepOutput(
      'validate_dates',
      { conditionResult: true, evaluatedField: '15 Feb to 17 Feb' },
      'pelangi',
      testWorkflowsData
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // Test 3: Missing required field
  it('fails when required field is missing from output', async () => {
    const result = await validateWorkflowStepOutput(
      'wait_guest_name',
      {},  // missing guest_name
      'pelangi',
      testWorkflowsData
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing required field');
    expect(result.errors[0]).toContain('guest_name');
  });

  // Test 4: Type mismatch — number where string expected
  it('fails when field has wrong type (number instead of string)', async () => {
    const result = await validateWorkflowStepOutput(
      'wait_guest_name',
      { guest_name: 12345 },  // number instead of string
      'pelangi',
      testWorkflowsData
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('type mismatch');
    expect(result.errors[0]).toContain('expected string');
    expect(result.errors[0]).toContain('got number');
  });

  // Test 5: Null value for required field
  it('fails when required field is null', async () => {
    const result = await validateWorkflowStepOutput(
      'wait_guest_count',
      { guest_count: null },
      'pelangi',
      testWorkflowsData
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('is null');
    expect(result.errors[0]).toContain('guest_count');
  });

  // Test 6: Empty string for required field
  it('fails when required string field is empty', async () => {
    const result = await validateWorkflowStepOutput(
      'wait_guest_name',
      { guest_name: '   ' },  // whitespace-only
      'pelangi',
      testWorkflowsData
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('empty string');
  });

  // Test 7: Unknown step ID
  it('fails when step ID is not found in workflows.json', async () => {
    const result = await validateWorkflowStepOutput(
      'nonexistent_step_xyz',
      { foo: 'bar' },
      'pelangi',
      testWorkflowsData
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('not found in any workflow definition');
  });

  // Test 8: Multiple validation errors
  it('reports multiple errors when condition output has wrong types for both fields', async () => {
    const result = await validateWorkflowStepOutput(
      'validate_dates',
      { conditionResult: 'yes', evaluatedField: 42 },  // string instead of boolean, number instead of string
      'southern',
      testWorkflowsData
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some(e => e.includes('conditionResult'))).toBe(true);
    expect(result.errors.some(e => e.includes('evaluatedField'))).toBe(true);
    expect(result.profile).toBe('southern');
  });

  // Test 9: Valid whatsapp_send output
  it('passes for valid whatsapp_send output', async () => {
    const result = await validateWorkflowStepOutput(
      'booking_notify_admin',
      { receiver: '+60123456789', content: 'New booking from John' },
      'pelangi',
      testWorkflowsData
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // Test 10: Valid pelangi_api output
  it('passes for valid pelangi_api output with object response', async () => {
    const result = await validateWorkflowStepOutput(
      'checkin_api_call',
      { apiResponse: { status: 'ok', guestId: 123 } },
      'pelangi',
      testWorkflowsData
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
