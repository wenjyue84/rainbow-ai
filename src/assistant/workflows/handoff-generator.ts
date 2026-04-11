/**
 * handoff-generator.ts — US-489
 *
 * Generates handoff templates for booking workflow escalation when a step fails
 * 3+ consecutive times. Provides human agents with full context: user info,
 * conversation history, extracted booking fields, error logs, and suggested
 * remediation actions.
 */

import type { ChatMessage } from '../types.js';

export interface HandoffTemplate {
  user_id: string;
  conversation_summary: {
    last_5_messages: ChatMessage[];
    extracted_booking_fields: Record<string, string | number | boolean>;
    previous_step_outcomes: StepOutcome[];
  };
  failed_step_name: string;
  error_stack: string;
  suggested_actions: string[];
  escalation_timestamp: string;
}

export interface StepOutcome {
  step_name: string;
  outcome: 'success' | 'failure' | 'pending';
  timestamp: string;
  error?: string;
}

/**
 * Generates a handoff template for human escalation when a workflow step
 * fails 3+ consecutive times.
 */
export function generateHandoffTemplate(
  conversationId: string,
  workflowId: string,
  failedStepName: string,
  conversationHistory: ChatMessage[] = [],
  extractedBookingData: Record<string, string | number | boolean> = {},
  errorStack: string = ''
): HandoffTemplate {
  // Validate user_id format (conversationId should match pattern)
  const userId = conversationId;
  if (!userId.match(/^[a-zA-Z0-9_]+$/)) {
    throw new Error(
      `Invalid user_id format: ${userId}. Must match /^[a-zA-Z0-9_]+$/`
    );
  }

  // Extract last 5 user messages for context
  const userMessages = conversationHistory
    .filter(m => m.role === 'user')
    .slice(-5);

  // Build conversation summary
  const conversationSummary = {
    last_5_messages: userMessages,
    extracted_booking_fields: extractedBookingData,
    previous_step_outcomes: buildStepOutcomesFromHistory(
      conversationHistory,
      workflowId,
      failedStepName
    ),
  };

  // Generate contextually relevant suggested actions
  const suggestedActions = generateSuggestedActions(
    failedStepName,
    extractedBookingData,
    errorStack
  );

  return {
    user_id: userId,
    conversation_summary: conversationSummary,
    failed_step_name: failedStepName,
    error_stack: errorStack,
    suggested_actions: suggestedActions,
    escalation_timestamp: new Date().toISOString(),
  };
}

/**
 * Build step outcomes from conversation metadata.
 * In a production system, this would read from workflow execution logs.
 */
function buildStepOutcomesFromHistory(
  history: ChatMessage[],
  workflowId: string,
  failedStepName: string
): StepOutcome[] {
  // For now, return a minimal structure with the failed step
  // Production would integrate with workflow execution logs
  return [
    {
      step_name: failedStepName,
      outcome: 'failure',
      timestamp: new Date().toISOString(),
    },
  ];
}

/**
 * Generate contextually relevant suggested actions based on the failed step.
 */
export function generateSuggestedActions(
  failedStepName: string,
  bookingData: Record<string, string | number | boolean>,
  errorStack: string
): string[] {
  const actions: string[] = [];

  // Parse failed step to identify category
  const stepLower = failedStepName.toLowerCase();

  if (stepLower.includes('payment')) {
    actions.push('Verify guest payment method (card, bank transfer, e-wallet)');
    actions.push('Check payment gateway service status');
    if (bookingData.guest_count) {
      actions.push(
        `Recalculate total cost for ${bookingData.guest_count} guest(s)`
      );
    }
    actions.push('Offer alternative payment methods');
  }

  if (stepLower.includes('date') || stepLower.includes('availability')) {
    actions.push('Confirm check-in and check-out dates with guest');
    if (bookingData.check_in_date) {
      actions.push(`Current check-in: ${bookingData.check_in_date}`);
    }
    if (bookingData.check_out_date) {
      actions.push(`Current check-out: ${bookingData.check_out_date}`);
    }
    actions.push('Check real-time unit availability');
  }

  if (stepLower.includes('guest') || stepLower.includes('name')) {
    actions.push('Request guest full name and contact information');
    actions.push('Verify guest identity for security');
  }

  if (stepLower.includes('unit') || stepLower.includes('room')) {
    actions.push('Display available unit types and amenities');
    if (bookingData.unit_type) {
      actions.push(`Current unit type: ${bookingData.unit_type}`);
    }
    actions.push('Suggest alternatives if preferred unit unavailable');
  }

  // Generic actions applicable to any step failure
  if (actions.length === 0) {
    actions.push('Review guest requirements and preferences');
    actions.push('Check for system errors in logs');
    actions.push('Contact guest directly via WhatsApp');
  }

  actions.push('Document reason for handoff and next steps');

  // Ensure we have at least one action
  if (actions.length === 0) {
    actions.push('Investigate step failure and retry');
  }

  return actions;
}

/**
 * Extract key booking fields from conversation history.
 * Looks for common patterns and fields mentioned in messages.
 */
export function extractBookingFieldsFromHistory(
  history: ChatMessage[]
): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {};

  // Join all messages to search for patterns
  const fullText = history.map(m => m.content).join(' ');

  // Extract dates (ISO format or common date patterns)
  const datePattern = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/g;
  const dates = fullText.match(datePattern);
  if (dates && dates.length >= 2) {
    fields.check_in_date = dates[0];
    fields.check_out_date = dates[1];
  }

  // Extract guest count
  const guestPattern = /(\d+)\s*(?:guest|person|people|orang)/i;
  const guestMatch = fullText.match(guestPattern);
  if (guestMatch) {
    fields.guest_count = parseInt(guestMatch[1], 10);
  }

  // Extract unit type keywords
  if (/dorm|dormitory/i.test(fullText)) fields.unit_type = 'dorm';
  if (/private|room|suite/i.test(fullText)) fields.unit_type = 'private';
  if (/twin|double|single/i.test(fullText)) {
    fields.room_variant = fullText.match(/twin|double|single/i)?.[0];
  }

  return fields;
}
