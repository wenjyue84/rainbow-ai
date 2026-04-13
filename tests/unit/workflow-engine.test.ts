import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../../src/assistant/workflow-engine.js';
import type { WorkflowDefinition } from '../../src/assistant/schemas.js';

// Mock workflow with dependency chain
const mockWorkflow: WorkflowDefinition = {
  id: 'test_booking',
  name: 'Test Booking Flow',
  profileId: 'pelangi',
  steps: [
    {
      id: 'collect_name',
      message: { en: 'Name?', ms: 'Nama?', zh: '名字？' },
      waitForReply: true,
    },
    {
      id: 'address_confirmed',
      message: { en: 'Address?', ms: 'Alamat?', zh: '地址？' },
      waitForReply: true,
    },
    {
      id: 'payment_confirmation',
      message: { en: 'Pay now', ms: 'Bayar', zh: '付款' },
      waitForReply: true,
      dependencies: ['address_confirmed'],
    } as any,
    {
      id: 'booking_done',
      message: { en: 'Done', ms: 'Selesai', zh: '完成' },
      waitForReply: false,
      dependencies: ['address_confirmed', 'payment_confirmation'],
    } as any,
  ],
};

describe('WorkflowEngine dependency validation', () => {
  const engine = new WorkflowEngine();

  it('allows progression to step with no dependencies', () => {
    const result = engine.progressToStep(mockWorkflow, 'collect_name', new Set());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.step.id).toBe('collect_name');
    }
  });

  it('allows progression when all dependencies are met', () => {
    const completed = new Set(['address_confirmed']);
    const result = engine.progressToStep(mockWorkflow, 'payment_confirmation', completed);
    expect(result.success).toBe(true);
  });

  it('blocks progression to payment_confirmation without address_confirmed', () => {
    const result = engine.progressToStep(mockWorkflow, 'payment_confirmation', new Set());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.guidanceMessage).toContain('address_confirmed');
    }
  });

  it('returns error for non-existent step', () => {
    const result = engine.progressToStep(mockWorkflow, 'nonexistent', new Set());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not found');
    }
  });

  it('validates multiple missing dependencies', () => {
    const result = engine.validateDependencies(mockWorkflow, 'booking_done', new Set());
    expect(result.valid).toBe(false);
    expect(result.missingDependencies).toContain('address_confirmed');
    expect(result.missingDependencies).toContain('payment_confirmation');
  });

  it('validates when some dependencies are met and others are not', () => {
    const completed = new Set(['address_confirmed']);
    const result = engine.validateDependencies(mockWorkflow, 'booking_done', completed);
    expect(result.valid).toBe(false);
    expect(result.missingDependencies).toEqual(['payment_confirmation']);
  });

  it('validates all dependencies met returns valid', () => {
    const completed = new Set(['address_confirmed', 'payment_confirmation']);
    const result = engine.validateDependencies(mockWorkflow, 'booking_done', completed);
    expect(result.valid).toBe(true);
    expect(result.missingDependencies).toEqual([]);
  });

  it('step with no dependencies array validates as valid', () => {
    const result = engine.validateDependencies(mockWorkflow, 'collect_name', new Set());
    expect(result.valid).toBe(true);
  });

  it('guidance message includes human-readable step names when available', () => {
    const result = engine.validateDependencies(mockWorkflow, 'payment_confirmation', new Set());
    expect(result.valid).toBe(false);
    // The mock step has no "name" field, so it falls back to the step id
    expect(result.guidanceMessage).toContain('address_confirmed');
  });

  it('progressToStep returns step object on success', () => {
    const completed = new Set(['address_confirmed']);
    const result = engine.progressToStep(mockWorkflow, 'payment_confirmation', completed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.step).toBeDefined();
      expect(result.step.id).toBe('payment_confirmation');
      expect(result.step.waitForReply).toBe(true);
    }
  });
});
