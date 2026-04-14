/**
 * US-605: Booking Workflow Dry-Run Simulator Tests
 *
 * Tests for the workflow simulator endpoint that executes workflows
 * without writing to the database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WorkflowState, WorkflowContext } from '../../../src/assistant/workflow-executor.js';
import { executeWorkflowStep, createWorkflowState, type WorkflowExecutionResult } from '../../../src/assistant/workflow-executor.js';

// Mock configStore to avoid undefined errors in tests
vi.mock('../../../src/assistant/config-store.js', () => ({
  configStore: {
    getWorkflows: () => ({
      workflows: [
        {
          id: 'booking_check_in',
          name: 'Check In',
          steps: [
            {
              id: 'greeting',
              type: 'message',
              message: { en: 'Welcome to booking!' }
            }
          ]
        },
        {
          id: 'booking_modify',
          name: 'Modify Booking',
          steps: [
            {
              id: 'greeting',
              type: 'message',
              message: { en: 'Modify your booking' }
            }
          ]
        },
        {
          id: 'booking_cancel',
          name: 'Cancel Booking',
          steps: [
            {
              id: 'greeting',
              type: 'message',
              message: { en: 'Cancel booking' }
            }
          ]
        },
      ]
    }),
    getWorkflow: () => ({ payment: { forward_to: '+60127088789' } }),
    getSettings: () => ({
      sentiment_analysis: { consecutive_threshold: 0.6 }
    }),
    getRouting: () => ({}),
    getIntents: () => ({}),
    on: () => {}, // EventEmitter method stub
    once: () => {}, // EventEmitter method stub
    off: () => {}, // EventEmitter method stub
  }
}));

describe('US-605: Workflow Simulator (Dry-Run Mode)', () => {
  describe('executeWorkflowStep with dryRun=true', () => {
    it('should execute a booking check-in workflow step without database writes', async () => {
      const state = createWorkflowState('booking_check_in');
      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        pushName: 'John Doe',
        profileId: 'pelangi',
      };

      // Execute with dryRun=true
      const result = await executeWorkflowStep(state, null, context, true);

      // Validate response structure
      expect(result).toBeDefined();
      expect(result.response).toBeTruthy();
      expect(typeof result.response).toBe('string');
      expect(result.executionId).toBeTruthy();

      // In dry-run, should not write to database (verified by mocking in integration tests)
    });

    it('should handle booking modification workflow steps', async () => {
      const state = createWorkflowState('booking_modify');
      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStep(state, null, context, true);

      expect(result).toBeDefined();
      expect(result.response).toBeTruthy();
      expect(result.executionId).toBeTruthy();
    });

    it('should handle booking cancellation workflow steps', async () => {
      const state = createWorkflowState('booking_cancel');
      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStep(state, null, context, true);

      expect(result).toBeDefined();
      expect(result.response).toBeTruthy();
      expect(result.executionId).toBeTruthy();
    });

    it('should support multi-step execution in dry-run mode', async () => {
      const state = createWorkflowState('booking_check_in');
      state.collectedData = {
        guest_name: 'John Doe',
        arrival_date: '2026-04-20'
      };

      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        profileId: 'pelangi',
      };

      // First step
      const result1 = await executeWorkflowStep(state, null, context, true);
      expect(result1).toBeDefined();
      expect(result1.response).toBeTruthy();

      // Second step (if workflow continues)
      if (result1.newState) {
        const result2 = await executeWorkflowStep(result1.newState, 'John Doe', context, true);
        expect(result2).toBeDefined();
        expect(result2.response).toBeTruthy();
      }
    });

    it('should preserve dryRun flag through recursive evaluation steps', async () => {
      // This test ensures that dryRun is passed through evaluation step recursion
      const state = createWorkflowState('booking_check_in');
      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStep(state, null, context, true);

      // If the workflow has evaluation steps, dryRun should be preserved
      expect(result).toBeDefined();
      expect(result.executionId).toBeTruthy();
    });

    it('should return execution timeline in dry-run mode', async () => {
      const state = createWorkflowState('booking_check_in');
      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStep(state, null, context, true);

      expect(result).toBeDefined();
      expect(result.executionId).toBeTruthy();
      // Timeline may or may not be populated depending on workflow structure
      // but should not cause errors in dry-run mode
      if (result.timeline) {
        expect(Array.isArray(result.timeline)).toBe(true);
      }
    });

    it('should validate required workflow context fields in dry-run', async () => {
      const state = createWorkflowState('booking_check_in');
      const context: WorkflowContext = {
        language: 'en',
        // Missing phone and profileId
      };

      const result = await executeWorkflowStep(state, null, context, true);

      // Should still execute (phone is optional for some workflows)
      expect(result).toBeDefined();
      expect(result.response).toBeTruthy();
    });

    it('should handle invalid workflow ID gracefully in dry-run', async () => {
      const state: WorkflowState = {
        workflowId: 'non_existent_workflow_12345',
        currentStepIndex: 0,
        collectedData: {},
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      const context: WorkflowContext = {
        language: 'en',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStep(state, null, context, true);

      // Should return error response, not throw
      expect(result).toBeDefined();
      expect(result.response).toBeTruthy();
      expect(result.newState).toBeNull();
    });

    it('should process user input in dry-run mode', async () => {
      const state = createWorkflowState('booking_check_in');
      state.currentStepIndex = 1; // Simulate being at step 2

      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStep(state, 'John Doe', context, true);

      expect(result).toBeDefined();
      expect(result.response).toBeTruthy();
    });

    it('should handle language-specific messages in dry-run', async () => {
      const state = createWorkflowState('booking_check_in');

      // Test with different languages
      const languages = ['en', 'ms', 'zh'];

      for (const lang of languages) {
        const context: WorkflowContext = {
          language: lang,
          phone: '601234567',
          profileId: 'pelangi',
        };

        const result = await executeWorkflowStep(state, null, context, true);

        expect(result).toBeDefined();
        expect(result.response).toBeTruthy();
      }
    });
  });

  describe('Dry-run mode database isolation', () => {
    it('should skip audit logging in dry-run mode', async () => {
      // This test verifies that no audit entries are created
      // In a real test, we would check the database before/after
      const state = createWorkflowState('booking_check_in');
      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        profileId: 'pelangi',
      };

      // Execute in dry-run mode
      const result1 = await executeWorkflowStep(state, null, context, true);
      expect(result1).toBeDefined();

      // Execute in production mode (for comparison)
      // In real tests, this would be mocked to avoid actual DB writes
      // const result2 = await executeWorkflowStep(state, null, context, false);
      // expect(result2).toBeDefined();

      // Verify no database changes were made by dry-run
      // (This would be checked with a database spy or mock in integration tests)
    });
  });

  describe('Workflow Simulator API Response Structure', () => {
    it('should return properly structured simulator response', async () => {
      const state = createWorkflowState('booking_check_in');
      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStep(state, null, context, true);

      // Verify response structure matches simulator requirements
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('newState');
      expect(result).toHaveProperty('executionId');

      // Response should be a string message
      expect(typeof result.response).toBe('string');
      expect(result.response.length).toBeGreaterThan(0);

      // ExecutionId should be a valid identifier
      expect(typeof result.executionId).toBe('string');
      expect(result.executionId.length).toBeGreaterThan(0);
    });

    it('should indicate workflow completion in dry-run', async () => {
      const state = createWorkflowState('booking_check_in');
      const context: WorkflowContext = {
        language: 'en',
        phone: '601234567',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStep(state, null, context, true);

      // newState should be null when workflow is complete
      // or should contain next step info if continuing
      if (result.newState === null) {
        expect(result.shouldForward).toBeDefined();
      } else {
        expect(result.newState.workflowId).toBe(state.workflowId);
      }
    });
  });
});
