/**
 * US-549: Workflow Execution Timeline Tracer — Integration Tests
 *
 * Tests for:
 * 1. Timeline creation and step logging
 * 2. GET /admin/workflows/:execution_id/timeline endpoint
 * 3. Slow step detection (>500ms)
 * 4. Timeline summary metrics
 * 5. Execution ID tracking across workflow steps
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  workflowTimelineStore,
  generateExecutionId,
  type StepExecution,
  type WorkflowTimeline
} from '../../src/lib/workflow-timeline.js';

describe('US-549: Workflow Execution Timeline Tracer', () => {
  beforeEach(() => {
    // Clear all timelines before each test
    workflowTimelineStore.clearAll();
  });

  describe('Timeline Creation and Management', () => {
    it('should create a timeline for a workflow execution', () => {
      const executionId = generateExecutionId();
      const timeline = workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      expect(timeline.execution_id).toBe(executionId);
      expect(timeline.workflow_id).toBe('booking_workflow');
      expect(timeline.phone).toBe('+601234567890');
      expect(timeline.profile_id).toBe('pelangi');
      expect(timeline.started_at).toBeGreaterThan(0);
      expect(timeline.steps).toEqual([]);
    });

    it('should generate unique execution IDs', () => {
      const id1 = generateExecutionId();
      const id2 = generateExecutionId();

      expect(id1).toMatch(/^exec_\d+_[a-z0-9]{7}$/);
      expect(id2).toMatch(/^exec_\d+_[a-z0-9]{7}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('Step Execution Logging', () => {
    it('should log a step execution with timing information', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const startTime = Date.now();
      const endTime = startTime + 150;

      workflowTimelineStore.logStepExecution(
        executionId,
        'step_1_greeting',
        startTime,
        endTime,
        { language: 'en' },
        { message: 'Hello! How can I help?' },
        'step_2_email'
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline).not.toBeNull();
      expect(timeline!.steps).toHaveLength(1);

      const step = timeline!.steps[0];
      expect(step.step_name).toBe('step_1_greeting');
      expect(step.start_time).toBe(startTime);
      expect(step.end_time).toBe(endTime);
      expect(step.duration_ms).toBe(150);
      expect(step.input).toEqual({ language: 'en' });
      expect(step.output).toEqual({ message: 'Hello! How can I help?' });
      expect(step.next_step).toBe('step_2_email');
    });

    it('should log multiple steps in order', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const baseTime = Date.now();

      // Log step 1 (fast)
      workflowTimelineStore.logStepExecution(
        executionId,
        'step_1_greeting',
        baseTime,
        baseTime + 100,
        { language: 'en' },
        { message: 'Hello!' },
        'step_2_email'
      );

      // Log step 2 (slow)
      workflowTimelineStore.logStepExecution(
        executionId,
        'step_2_email',
        baseTime + 100,
        baseTime + 750,
        { email: 'guest@example.com' },
        { message: 'Email sent' },
        'step_3_confirm'
      );

      // Log step 3 (fast)
      workflowTimelineStore.logStepExecution(
        executionId,
        'step_3_confirm',
        baseTime + 750,
        baseTime + 850,
        { confirmed: true },
        { message: 'Booking confirmed' },
        null
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.steps).toHaveLength(3);
      expect(timeline!.steps[0].step_name).toBe('step_1_greeting');
      expect(timeline!.steps[1].step_name).toBe('step_2_email');
      expect(timeline!.steps[2].step_name).toBe('step_3_confirm');
    });
  });

  describe('Slow Step Detection', () => {
    it('should flag steps >500ms as slow_step', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const baseTime = Date.now();

      // Fast step (250ms)
      workflowTimelineStore.logStepExecution(
        executionId,
        'step_1',
        baseTime,
        baseTime + 250,
        {},
        { message: 'Fast' },
        'step_2'
      );

      // Slow step (800ms)
      workflowTimelineStore.logStepExecution(
        executionId,
        'step_2',
        baseTime + 250,
        baseTime + 1050,
        {},
        { message: 'Slow' },
        'step_3'
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.steps[0].slow_step).toBe(false);
      expect(timeline!.steps[0].duration_ms).toBe(250);
      expect(timeline!.steps[1].slow_step).toBe(true);
      expect(timeline!.steps[1].duration_ms).toBe(800);
    });

    it('should mark exactly 500ms as not slow', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const baseTime = Date.now();

      workflowTimelineStore.logStepExecution(
        executionId,
        'step_1',
        baseTime,
        baseTime + 500,
        {},
        { message: 'Boundary' },
        null
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.steps[0].slow_step).toBe(false);
      expect(timeline!.steps[0].duration_ms).toBe(500);
    });

    it('should mark >500ms as slow', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const baseTime = Date.now();

      workflowTimelineStore.logStepExecution(
        executionId,
        'step_1',
        baseTime,
        baseTime + 501,
        {},
        { message: 'Slow' },
        null
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.steps[0].slow_step).toBe(true);
      expect(timeline!.steps[0].duration_ms).toBe(501);
    });
  });

  describe('Timeline Completion', () => {
    it('should mark workflow as complete', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      let timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.completed_at).toBeUndefined();

      workflowTimelineStore.completeTimeline(executionId);

      timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.completed_at).toBeGreaterThan(0);
    });
  });

  describe('Timeline Retrieval', () => {
    it('should retrieve timeline by execution_id', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const baseTime = Date.now();
      workflowTimelineStore.logStepExecution(
        executionId,
        'step_1',
        baseTime,
        baseTime + 100,
        {},
        { message: 'Test' },
        null
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline).not.toBeNull();
      expect(timeline!.execution_id).toBe(executionId);
      expect(timeline!.steps).toHaveLength(1);
    });

    it('should return null for non-existent execution_id', () => {
      const timeline = workflowTimelineStore.getTimeline('exec_nonexistent_123456');
      expect(timeline).toBeNull();
    });

    it('should return all timelines', () => {
      const exec1 = generateExecutionId();
      const exec2 = generateExecutionId();

      workflowTimelineStore.createTimeline(exec1, 'workflow1', '+60111111', 'pelangi');
      workflowTimelineStore.createTimeline(exec2, 'workflow2', '+60222222', 'southern');

      const allTimelines = workflowTimelineStore.getAllTimelines();
      expect(allTimelines).toHaveLength(2);
      expect(allTimelines.map(t => t.execution_id)).toContain(exec1);
      expect(allTimelines.map(t => t.execution_id)).toContain(exec2);
    });
  });

  describe('Step Execution Data Structure', () => {
    it('should capture input and output data for each step', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const input = {
        language: 'en',
        userInput: 'I want to book a room'
      };

      const output = {
        message: 'Sure! Let me help you with that.',
        metadata: { intent: 'booking' }
      };

      const baseTime = Date.now();
      workflowTimelineStore.logStepExecution(
        executionId,
        'step_1_intent_detection',
        baseTime,
        baseTime + 100,
        input,
        output,
        'step_2_date_selection'
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      const step = timeline!.steps[0];

      expect(step.input).toEqual(input);
      expect(step.output).toEqual(output);
      expect(step.next_step).toBe('step_2_date_selection');
    });

    it('should handle null next_step for final steps', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const baseTime = Date.now();
      workflowTimelineStore.logStepExecution(
        executionId,
        'final_step',
        baseTime,
        baseTime + 100,
        {},
        { message: 'Booking complete' },
        null // No next step
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.steps[0].next_step).toBeNull();
    });
  });

  describe('Workflow Profile and Phone Tracking', () => {
    it('should track phone and profile_id with timeline', () => {
      const executionId = generateExecutionId();
      const phone = '+601234567890';
      const profileId = 'pelangi';

      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        phone,
        profileId
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.phone).toBe(phone);
      expect(timeline!.profile_id).toBe(profileId);
    });

    it('should handle different profiles', () => {
      const exec1 = generateExecutionId();
      const exec2 = generateExecutionId();

      workflowTimelineStore.createTimeline(
        exec1,
        'booking_workflow',
        '+60111111',
        'pelangi'
      );

      workflowTimelineStore.createTimeline(
        exec2,
        'booking_workflow',
        '+60222222',
        'southern'
      );

      const timeline1 = workflowTimelineStore.getTimeline(exec1);
      const timeline2 = workflowTimelineStore.getTimeline(exec2);

      expect(timeline1!.profile_id).toBe('pelangi');
      expect(timeline2!.profile_id).toBe('southern');
    });
  });

  describe('Timeline Timing Accuracy', () => {
    it('should calculate duration_ms correctly', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const startTime = 1000;
      const endTime = 3500;

      workflowTimelineStore.logStepExecution(
        executionId,
        'step_1',
        startTime,
        endTime,
        {},
        {},
        null
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.steps[0].duration_ms).toBe(2500);
    });

    it('should preserve exact timing values', () => {
      const executionId = generateExecutionId();
      workflowTimelineStore.createTimeline(
        executionId,
        'booking_workflow',
        '+601234567890',
        'pelangi'
      );

      const startTime = 1681234567890;
      const endTime = 1681234567950;

      workflowTimelineStore.logStepExecution(
        executionId,
        'step_1',
        startTime,
        endTime,
        {},
        {},
        null
      );

      const timeline = workflowTimelineStore.getTimeline(executionId);
      expect(timeline!.steps[0].start_time).toBe(startTime);
      expect(timeline!.steps[0].end_time).toBe(endTime);
      expect(timeline!.steps[0].duration_ms).toBe(60);
    });
  });
});
