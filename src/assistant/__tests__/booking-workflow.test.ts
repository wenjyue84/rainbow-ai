/**
 * US-006: Improve booking workflow check-in steps in workflows.json
 *
 * Tests:
 * 1. Booking workflow has distinct steps for name, dates, guest count, confirm
 * 2. Each step has clear prompt text in EN/MS/ZH
 * 3. Invalid date inputs route to re-prompt node
 * 4. Valid date inputs proceed to confirmation step
 * 5. Workflow structure follows existing nodes schema
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadWorkflows() {
  const raw = readFileSync(join(process.cwd(), 'src/assistant/data/workflows.json'), 'utf-8');
  return JSON.parse(raw);
}

function getNode(nodes: any[], id: string) {
  return nodes.find((n: any) => n.id === id);
}

describe('US-006: booking_payment_handler workflow', () => {
  const { workflows } = loadWorkflows();
  const workflow = workflows.find((w: any) => w.id === 'booking_payment_handler');

  it('workflow exists and uses nodes format', () => {
    expect(workflow).toBeDefined();
    expect(workflow.format).toBe('nodes');
    expect(workflow.startNodeId).toBeDefined();
    expect(Array.isArray(workflow.nodes)).toBe(true);
  });

  it('has a step to collect guest name', () => {
    const nameNode = workflow.nodes.find(
      (n: any) => n.type === 'wait_reply' && n.config?.storeAs === 'guest_name'
    );
    expect(nameNode).toBeDefined();
    expect(nameNode.config.prompt.en).toContain('name');
    expect(nameNode.config.prompt.ms).toBeTruthy();
    expect(nameNode.config.prompt.zh).toBeTruthy();
  });

  it('has a step to collect guest count', () => {
    const countNode = workflow.nodes.find(
      (n: any) => n.type === 'wait_reply' && n.config?.storeAs === 'guest_count'
    );
    expect(countNode).toBeDefined();
    expect(countNode.config.prompt.en).toBeTruthy();
    expect(countNode.config.prompt.ms).toBeTruthy();
    expect(countNode.config.prompt.zh).toBeTruthy();
  });

  it('has a step to collect booking dates', () => {
    const datesNode = workflow.nodes.find(
      (n: any) => n.type === 'wait_reply' && n.config?.storeAs === 'booking_dates'
    );
    expect(datesNode).toBeDefined();
    expect(datesNode.config.prompt.en).toContain('date');
    expect(datesNode.config.prompt.ms).toBeTruthy();
    expect(datesNode.config.prompt.zh).toBeTruthy();
  });

  it('has a confirmation step that shows collected details', () => {
    const confirmNode = workflow.nodes.find(
      (n: any) => n.type === 'message' && n.config?.message?.en?.includes('{{workflow.data.guest_name}}')
    );
    expect(confirmNode).toBeDefined();
    expect(confirmNode.config.message.en).toContain('{{workflow.data.guest_count}}');
    expect(confirmNode.config.message.en).toContain('{{workflow.data.booking_dates}}');
  });

  it('has a date validation condition node with regex operator', () => {
    const validateNode = workflow.nodes.find(
      (n: any) => n.type === 'condition' && n.config?.operator === 'regex'
    );
    expect(validateNode).toBeDefined();
    expect(validateNode.config.field).toContain('booking_dates');
    expect(validateNode.config.value).toBeTruthy();
    expect(validateNode.config.trueNext).toBeDefined();
    expect(validateNode.config.falseNext).toBeDefined();
  });

  it('invalid date route leads to a re-prompt node with helpful error message', () => {
    const validateNode = workflow.nodes.find(
      (n: any) => n.type === 'condition' && n.config?.operator === 'regex'
    );
    const errorNode = getNode(workflow.nodes, validateNode.config.falseNext);
    expect(errorNode).toBeDefined();
    expect(errorNode.type).toBe('wait_reply');
    expect(errorNode.config.prompt.en).toBeTruthy();
    // Error message should guide the user with date format examples
    const promptText = errorNode.config.prompt.en.toLowerCase();
    expect(promptText).toMatch(/date|format|feb|example/i);
  });

  it('valid date route leads to confirmation (not error) node', () => {
    const validateNode = workflow.nodes.find(
      (n: any) => n.type === 'condition' && n.config?.operator === 'regex'
    );
    const confirmNode = getNode(workflow.nodes, validateNode.config.trueNext);
    expect(confirmNode).toBeDefined();
    // Should not be an error node
    expect(confirmNode.id).not.toContain('error');
  });

  it('regex pattern matches common Malaysian date formats', () => {
    const validateNode = workflow.nodes.find(
      (n: any) => n.type === 'condition' && n.config?.operator === 'regex'
    );
    const pattern = new RegExp(validateNode.config.value, 'i');

    // Valid date inputs
    expect(pattern.test('15 Feb')).toBe(true);
    expect(pattern.test('Check-in: 15 Feb, Check-out: 17 Feb')).toBe(true);
    expect(pattern.test('15/2/2026')).toBe(true);
    expect(pattern.test('Jan 20 to Jan 25')).toBe(true);
    expect(pattern.test('20-Mar-2026')).toBe(true);
  });

  it('regex pattern rejects inputs without date information', () => {
    const validateNode = workflow.nodes.find(
      (n: any) => n.type === 'condition' && n.config?.operator === 'regex'
    );
    const pattern = new RegExp(validateNode.config.value, 'i');

    // Invalid / ambiguous inputs
    expect(pattern.test('yes')).toBe(false);
    expect(pattern.test('ok')).toBe(false);
    expect(pattern.test('hello')).toBe(false);
    expect(pattern.test('3 nights')).toBe(false);
  });

  it('workflow flow: name -> count -> dates -> validate -> confirm -> notify -> done', () => {
    // Verify the node chain is connected correctly
    const nameNode = workflow.nodes.find((n: any) => n.id === workflow.startNodeId);
    expect(nameNode.config.storeAs).toBe('guest_name');

    const countNode = getNode(workflow.nodes, nameNode.next);
    expect(countNode.config.storeAs).toBe('guest_count');

    const datesNode = getNode(workflow.nodes, countNode.next);
    expect(datesNode.config.storeAs).toBe('booking_dates');

    const validateNode = getNode(workflow.nodes, datesNode.next);
    expect(validateNode.type).toBe('condition');

    const confirmNode = getNode(workflow.nodes, validateNode.config.trueNext);
    expect(confirmNode.type).toBe('message');

    const notifyNode = getNode(workflow.nodes, confirmNode.next);
    expect(notifyNode.type).toBe('whatsapp_send');

    const doneNode = getNode(workflow.nodes, notifyNode.next);
    expect(doneNode.type).toBe('message');
  });

  it('all trilingual prompts are non-empty', () => {
    const waitReplyNodes = workflow.nodes.filter((n: any) => n.type === 'wait_reply');
    for (const node of waitReplyNodes) {
      expect(node.config.prompt.en, `${node.id}: en prompt missing`).toBeTruthy();
      expect(node.config.prompt.ms, `${node.id}: ms prompt missing`).toBeTruthy();
      expect(node.config.prompt.zh, `${node.id}: zh prompt missing`).toBeTruthy();
    }

    const messageNodes = workflow.nodes.filter((n: any) => n.type === 'message');
    for (const node of messageNodes) {
      expect(node.config.message.en, `${node.id}: en message missing`).toBeTruthy();
      expect(node.config.message.ms, `${node.id}: ms message missing`).toBeTruthy();
      expect(node.config.message.zh, `${node.id}: zh message missing`).toBeTruthy();
    }
  });
});
