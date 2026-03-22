/**
 * US-072: Booking cancellation workflow tests
 *
 * Tests:
 * 1. Workflow 'process_booking_cancellation' exists
 * 2. Workflow has correct structure with required nodes
 * 3. Workflow includes confirmation, date input, and credit calculation steps
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadWorkflows() {
  const raw = readFileSync(join(process.cwd(), 'src/assistant/data/workflows.json'), 'utf-8');
  return JSON.parse(raw);
}

describe('US-072: process_booking_cancellation workflow', () => {
  const { workflows } = loadWorkflows();
  const workflow = workflows.find((w: any) => w.id === 'process_booking_cancellation');

  it('workflow exists', () => {
    expect(workflow).toBeDefined();
    expect(workflow.id).toBe('process_booking_cancellation');
  });

  it('has nodes format', () => {
    expect(workflow.format).toBe('nodes');
    expect(workflow.startNodeId).toBeDefined();
    expect(Array.isArray(workflow.nodes)).toBe(true);
  });

  it('has confirmation node', () => {
    const confirmNode = workflow.nodes.find(
      (n: any) => n.type === 'wait_reply' && n.config?.storeAs === 'cancellation_confirmed'
    );
    expect(confirmNode).toBeDefined();
    expect(confirmNode.config.prompt.en).toContain('cancel');
  });

  it('has check-in date input node', () => {
    const dateNode = workflow.nodes.find(
      (n: any) => n.type === 'wait_reply' && n.config?.storeAs === 'booking_checkin_date'
    );
    expect(dateNode).toBeDefined();
    expect(dateNode.config.prompt.en).toContain('check-in');
  });

  it('has credit calculation node', () => {
    const calcNode = workflow.nodes.find((n: any) => n.id === 'calculate_credit');
    expect(calcNode).toBeDefined();
    expect(calcNode.type).toBe('function');
    expect(calcNode.config.function).toBe('calculateCancellationCredit');
  });

  it('has date validation node', () => {
    const validateNode = workflow.nodes.find((n: any) => n.id === 'validate_checkin_date');
    expect(validateNode).toBeDefined();
    expect(validateNode.type).toBe('condition');
  });

  it('has admin notification node', () => {
    const notifyNode = workflow.nodes.find((n: any) => n.type === 'whatsapp_send');
    expect(notifyNode).toBeDefined();
    expect(notifyNode.config.receiver).toContain('admin_phone');
  });

  it('workflow nodes are properly connected', () => {
    const nodeIds = new Set(workflow.nodes.map((n: any) => n.id));

    // Check that all 'next' references point to valid nodes
    for (const node of workflow.nodes) {
      if (node.next) {
        expect(nodeIds.has(node.next)).toBe(true);
      }
      if (node.config?.trueNext) {
        expect(nodeIds.has(node.config.trueNext)).toBe(true);
      }
      if (node.config?.falseNext) {
        expect(nodeIds.has(node.config.falseNext)).toBe(true);
      }
    }
  });

  it('has i18n text in all prompts', () => {
    const waitNodes = workflow.nodes.filter((n: any) => n.type === 'wait_reply');

    for (const node of waitNodes) {
      const prompt = node.config.prompt;
      expect(prompt.en).toBeTruthy();
      expect(prompt.ms).toBeTruthy();
      expect(prompt.zh).toBeTruthy();
    }
  });
});
