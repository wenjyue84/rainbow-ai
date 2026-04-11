/**
 * tests/workflows/handoff-generator.test.ts — US-489
 *
 * Tests for booking workflow handoff template generator.
 * Validates: JSON structure, action suggestions, user_id format, error context.
 */

import { describe, it, expect } from 'vitest';
import {
  generateHandoffTemplate,
  generateSuggestedActions,
  extractBookingFieldsFromHistory,
  type HandoffTemplate,
  type ChatMessage,
} from '../../../src/assistant/workflows/handoff-generator.js';

describe('US-489: Booking Workflow Human Handoff Template Generator', () => {
  // ─── Fixtures ───────────────────────────────────────────────────

  const mockConversationId = 'conv_12345_abc';
  const mockWorkflowId = 'booking_payment_handler';
  const mockFailedStepName = 'payment_confirmation';

  const mockChatHistory: ChatMessage[] = [
    {
      role: 'user',
      content: 'Hi, I want to book a room for 2 guests',
      timestamp: Date.now() - 600000,
    },
    {
      role: 'assistant',
      content: 'Great! When would you like to check in?',
      timestamp: Date.now() - 540000,
    },
    {
      role: 'user',
      content: 'Check in: 2026-05-15, check out: 2026-05-17',
      timestamp: Date.now() - 480000,
    },
    {
      role: 'assistant',
      content:
        'Perfect! That is a 2-night stay for 2 guests. Total cost: RM 400.',
      timestamp: Date.now() - 420000,
    },
    {
      role: 'user',
      content: 'I prefer a private room with twin beds',
      timestamp: Date.now() - 300000,
    },
    {
      role: 'assistant',
      content: 'We have a private twin room available. Ready to proceed?',
      timestamp: Date.now() - 240000,
    },
    {
      role: 'user',
      content: 'Yes, let me know how to pay',
      timestamp: Date.now() - 120000,
    },
  ];

  const mockBookingData = {
    guest_count: 2,
    check_in_date: '2026-05-15',
    check_out_date: '2026-05-17',
    unit_type: 'private',
    room_variant: 'twin',
    total_cost: 400,
  };

  const mockErrorStack =
    'PaymentGatewayTimeout: Request timed out after 30s\n---\nPaymentGatewayError: Invalid gateway response';

  // ─── Test: Handoff Template Structure ────────────────────────────

  it('should generate handoff template with all required keys', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      mockBookingData,
      mockErrorStack
    );

    expect(handoff).toBeDefined();
    expect(handoff).toHaveProperty('user_id');
    expect(handoff).toHaveProperty('conversation_summary');
    expect(handoff).toHaveProperty('failed_step_name');
    expect(handoff).toHaveProperty('error_stack');
    expect(handoff).toHaveProperty('suggested_actions');
    expect(handoff).toHaveProperty('escalation_timestamp');
  });

  it('should validate user_id format matches /^[a-zA-Z0-9_]+$/', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      mockBookingData
    );

    expect(handoff.user_id).toMatch(/^[a-zA-Z0-9_]+$/);
  });

  it('should reject invalid user_id format', () => {
    const invalidId = 'conv-123@invalid';

    expect(() => {
      generateHandoffTemplate(
        invalidId,
        mockWorkflowId,
        mockFailedStepName,
        mockChatHistory,
        mockBookingData
      );
    }).toThrow(/Invalid user_id format/);
  });

  // ─── Test: Conversation Summary ──────────────────────────────────

  it('should include last 5 user messages in conversation summary', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      mockBookingData
    );

    const { last_5_messages } = handoff.conversation_summary;
    expect(last_5_messages).toBeDefined();
    expect(Array.isArray(last_5_messages)).toBe(true);
    expect(last_5_messages.length).toBeGreaterThan(0);
    expect(last_5_messages.every(m => m.role === 'user')).toBe(true);
  });

  it('should include extracted booking fields in conversation summary', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      mockBookingData
    );

    const { extracted_booking_fields } = handoff.conversation_summary;
    expect(extracted_booking_fields).toBeDefined();
    expect(extracted_booking_fields.guest_count).toBe(2);
    expect(extracted_booking_fields.check_in_date).toBe('2026-05-15');
    expect(extracted_booking_fields.check_out_date).toBe('2026-05-17');
  });

  it('should include previous step outcomes in conversation summary', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      mockBookingData
    );

    const { previous_step_outcomes } = handoff.conversation_summary;
    expect(Array.isArray(previous_step_outcomes)).toBe(true);
    expect(previous_step_outcomes.length).toBeGreaterThan(0);
    if (previous_step_outcomes.length > 0) {
      expect(previous_step_outcomes[0]).toHaveProperty('step_name');
      expect(previous_step_outcomes[0]).toHaveProperty('outcome');
      expect(previous_step_outcomes[0]).toHaveProperty('timestamp');
    }
  });

  // ─── Test: Failed Step and Error Context ─────────────────────────

  it('should set failed_step_name correctly', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      mockBookingData
    );

    expect(handoff.failed_step_name).toBe(mockFailedStepName);
  });

  it('should include error_stack and it should be defined', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      mockBookingData,
      mockErrorStack
    );

    expect(handoff.error_stack).toBeDefined();
    expect(handoff.error_stack).toBe(mockErrorStack);
    expect(handoff.error_stack).toContain('PaymentGateway');
  });

  // ─── Test: Suggested Actions ─────────────────────────────────────

  it('should include suggested_actions array with length > 0', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      mockBookingData
    );

    expect(Array.isArray(handoff.suggested_actions)).toBe(true);
    expect(handoff.suggested_actions.length).toBeGreaterThan(0);
    expect(handoff.suggested_actions.every(a => typeof a === 'string')).toBe(
      true
    );
  });

  it('should generate payment-related actions for payment_confirmation step', () => {
    const actions = generateSuggestedActions(
      'payment_confirmation',
      mockBookingData,
      ''
    );

    expect(actions.length).toBeGreaterThan(0);
    const actionText = actions.join(' ').toLowerCase();
    expect(actionText).toMatch(/payment|gateway|method/i);
  });

  it('should generate date-related actions for date_validation step', () => {
    const actions = generateSuggestedActions(
      'date_validation',
      mockBookingData,
      ''
    );

    expect(actions.length).toBeGreaterThan(0);
    const actionText = actions.join(' ').toLowerCase();
    expect(actionText).toMatch(/date|availability|check-in|check-out/i);
  });

  it('should generate unit-related actions for unit_selection step', () => {
    const actions = generateSuggestedActions(
      'unit_selection',
      mockBookingData,
      ''
    );

    expect(actions.length).toBeGreaterThan(0);
    const actionText = actions.join(' ').toLowerCase();
    expect(actionText).toMatch(/unit|room|available|type/i);
  });

  it('should include booking context in actions when data is provided', () => {
    const actions = generateSuggestedActions(
      'payment_confirmation',
      { guest_count: 3, total_cost: 600 },
      ''
    );

    const actionText = actions.join('\n');
    expect(actionText).toContain('3');
    expect(actionText).toContain('guest');
  });

  it('should generate fallback actions when step name is unrecognized', () => {
    const actions = generateSuggestedActions(
      'unknown_step_xyz',
      mockBookingData,
      ''
    );

    expect(actions.length).toBeGreaterThan(0);
    // Should have generic actions
    const actionText = actions.join(' ').toLowerCase();
    expect(actionText).toMatch(/guest|requirement|check|log/i);
  });

  // ─── Test: Escalation Timestamp ──────────────────────────────────

  it('should set escalation_timestamp to current ISO datetime', () => {
    const beforeTime = new Date();
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      mockBookingData
    );
    const afterTime = new Date();

    expect(handoff.escalation_timestamp).toBeDefined();
    const timestamp = new Date(handoff.escalation_timestamp);
    expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
  });

  // ─── Test: Empty/Edge Cases ─────────────────────────────────────

  it('should handle empty conversation history gracefully', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      [],
      mockBookingData
    );

    expect(handoff).toBeDefined();
    expect(handoff.conversation_summary.last_5_messages).toEqual([]);
    expect(handoff.suggested_actions.length).toBeGreaterThan(0);
  });

  it('should handle empty booking data gracefully', () => {
    const handoff = generateHandoffTemplate(
      mockConversationId,
      mockWorkflowId,
      mockFailedStepName,
      mockChatHistory,
      {}
    );

    expect(handoff).toBeDefined();
    expect(handoff.conversation_summary.extracted_booking_fields).toEqual({});
    expect(handoff.suggested_actions.length).toBeGreaterThan(0);
  });

  // ─── Test: Booking Field Extraction ──────────────────────────────

  it('should extract dates from conversation history', () => {
    const fields = extractBookingFieldsFromHistory(mockChatHistory);

    expect(fields.check_in_date).toBeDefined();
    expect(fields.check_out_date).toBeDefined();
  });

  it('should extract guest count from conversation history', () => {
    const fields = extractBookingFieldsFromHistory(mockChatHistory);

    expect(fields.guest_count).toBe(2);
  });

  it('should extract unit type from conversation history', () => {
    const fields = extractBookingFieldsFromHistory(mockChatHistory);

    expect(fields.unit_type).toBe('private');
    expect(fields.room_variant).toBe('twin');
  });

  it('should handle conversations without booking data', () => {
    const simpleHistory: ChatMessage[] = [
      {
        role: 'user',
        content: 'Hello, how are you?',
        timestamp: Date.now(),
      },
    ];

    const fields = extractBookingFieldsFromHistory(simpleHistory);

    expect(typeof fields).toBe('object');
    expect(Object.keys(fields).length).toBeLessThanOrEqual(5);
  });

  // ─── Integration Test ───────────────────────────────────────────

  it('should generate complete, valid handoff JSON for real scenario', () => {
    const handoff = generateHandoffTemplate(
      'user_alice_123',
      'booking_payment_handler',
      'payment_confirmation',
      mockChatHistory,
      mockBookingData,
      mockErrorStack
    );

    // Verify all fields are present
    expect(handoff.user_id).toBe('user_alice_123');
    expect(handoff.failed_step_name).toBe('payment_confirmation');
    expect(handoff.error_stack).toBeTruthy();
    expect(handoff.suggested_actions.length).toBeGreaterThan(0);

    // Verify structure is serializable to JSON
    const jsonStr = JSON.stringify(handoff);
    expect(jsonStr).toBeTruthy();

    // Verify we can parse it back
    const parsed = JSON.parse(jsonStr) as HandoffTemplate;
    expect(parsed.user_id).toBe('user_alice_123');
  });
});
