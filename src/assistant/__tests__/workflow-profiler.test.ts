/**
 * US-121: Workflow Profiler Tests
 *
 * Tests for step-level profiling metrics collection and aggregation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordStepMetric,
  getAggregatedMetrics,
  getWorkflowMetrics,
  generateOptimizationReport,
  getRecentMetrics,
  clearMetrics,
  type StepMetric,
  type AggregatedMetrics,
} from '../workflow-profiler.js';

describe('WorkflowProfiler', () => {
  beforeEach(() => {
    // Clear metrics before each test
    clearMetrics();
  });

  afterEach(() => {
    // Clean up after tests
    clearMetrics();
  });

  describe('recordStepMetric', () => {
    it('should record a single step metric', () => {
      const metric: StepMetric = {
        stepId: 'wait_guest_name',
        stepType: 'wait_reply',
        durationMs: 150,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: { test: true },
        timestamp: Date.now(),
        workflowId: 'booking_payment_handler',
        conversationId: '+60123456789',
      };

      recordStepMetric(metric);
      const metrics = getAggregatedMetrics();

      expect(metrics).toHaveLength(1);
      expect(metrics[0].stepId).toBe('wait_guest_name');
      expect(metrics[0].count).toBe(1);
      expect(metrics[0].avgDurationMs).toBe(150);
    });

    it('should aggregate metrics for the same step', () => {
      const baseMetric: StepMetric = {
        stepId: 'wait_guest_name',
        stepType: 'wait_reply',
        durationMs: 100,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_payment_handler',
      };

      // Record multiple metrics for the same step
      recordStepMetric(baseMetric);
      recordStepMetric({ ...baseMetric, durationMs: 150 });
      recordStepMetric({ ...baseMetric, durationMs: 200 });

      const metrics = getAggregatedMetrics();
      expect(metrics[0].count).toBe(3);
      expect(metrics[0].avgDurationMs).toBeCloseTo(150, 0);
      expect(metrics[0].minDurationMs).toBe(100);
      expect(metrics[0].maxDurationMs).toBe(200);
    });

    it('should calculate p95 and p99 percentiles correctly', () => {
      const metric: StepMetric = {
        stepId: 'api_step',
        stepType: 'pelangi_api:fetch_rooms',
        durationMs: 0,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_payment_handler',
      };

      // Record 100 metrics with varying durations
      for (let i = 1; i <= 100; i++) {
        recordStepMetric({ ...metric, durationMs: i * 10 });
      }

      const metrics = getAggregatedMetrics();
      const apiStep = metrics.find(m => m.stepId === 'api_step');

      expect(apiStep).toBeDefined();
      expect(apiStep!.p95DurationMs).toBeGreaterThan(900); // ~950
      expect(apiStep!.p99DurationMs).toBeGreaterThan(980); // ~990
    });

    it('should flag slow executions (>2000ms)', () => {
      const metric: StepMetric = {
        stepId: 'slow_step',
        stepType: 'pelangi_api:slow_endpoint',
        durationMs: 0,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_payment_handler',
      };

      // Record 10 executions, 3 of them slow
      const durations = [1000, 1500, 2100, 2500, 1800, 2200, 1000, 1200, 1500, 1800];
      durations.forEach(d => recordStepMetric({ ...metric, durationMs: d }));

      const metrics = getAggregatedMetrics();
      const slowStep = metrics.find(m => m.stepId === 'slow_step');

      expect(slowStep!.totalSlowExecutions).toBe(3); // 3 executions > 2000ms
      expect(slowStep!.avgDurationMs).toBeGreaterThan(1500);
    });
  });

  describe('getWorkflowMetrics', () => {
    it('should filter metrics by workflow ID', () => {
      const metric1: StepMetric = {
        stepId: 'step1',
        stepType: 'wait_reply',
        durationMs: 100,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_workflow',
      };

      const metric2: StepMetric = {
        stepId: 'step2',
        stepType: 'wait_reply',
        durationMs: 150,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'checkin_workflow',
      };

      recordStepMetric(metric1);
      recordStepMetric(metric2);

      const bookingMetrics = getWorkflowMetrics('booking_workflow');
      expect(bookingMetrics).toHaveLength(1);
      expect(bookingMetrics[0].stepId).toBe('step1');

      const checkinMetrics = getWorkflowMetrics('checkin_workflow');
      expect(checkinMetrics).toHaveLength(1);
      expect(checkinMetrics[0].stepId).toBe('step2');
    });
  });

  describe('generateOptimizationReport', () => {
    it('should identify bottleneck steps', () => {
      const baseMetric: StepMetric = {
        stepId: '',
        stepType: 'pelangi_api',
        durationMs: 0,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_payment_handler',
      };

      // Bottleneck: high average duration
      for (let i = 0; i < 10; i++) {
        recordStepMetric({
          ...baseMetric,
          stepId: 'bottleneck_step',
          durationMs: 2500,
        });
      }

      // Normal step
      for (let i = 0; i < 10; i++) {
        recordStepMetric({
          ...baseMetric,
          stepId: 'normal_step',
          durationMs: 200,
        });
      }

      const report = generateOptimizationReport();

      expect(report.heatmap).toBeDefined();
      expect(report.suggestions).toBeDefined();

      // Bottleneck step should be ranked #1
      expect(report.heatmap[0].stepId).toBe('bottleneck_step');

      // Should have suggestion for slow step
      const bottleneckSuggestion = report.suggestions.find(
        s => s.stepId === 'bottleneck_step'
      );
      expect(bottleneckSuggestion).toBeDefined();
      expect(bottleneckSuggestion!.reason).toContain('exceeds 2000ms');
    });

    it('should generate optimization gain estimates', () => {
      const metric: StepMetric = {
        stepId: 'slow_api',
        stepType: 'pelangi_api:database_query',
        durationMs: 3000,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_payment_handler',
      };

      for (let i = 0; i < 5; i++) {
        recordStepMetric(metric);
      }

      const report = generateOptimizationReport();
      const suggestion = report.suggestions.find(s => s.stepId === 'slow_api');

      expect(suggestion).toBeDefined();
      expect(suggestion!.estimatedGain).toMatch(/ms/);
    });
  });

  describe('getRecentMetrics', () => {
    it('should filter metrics by time window', () => {
      const now = Date.now();

      // Record metric from 2 minutes ago
      const oldMetric: StepMetric = {
        stepId: 'old_step',
        stepType: 'wait_reply',
        durationMs: 100,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: now - 2 * 60 * 1000, // 2 minutes ago
        workflowId: 'booking_workflow',
      };

      // Record metric from just now
      const newMetric: StepMetric = {
        stepId: 'new_step',
        stepType: 'wait_reply',
        durationMs: 150,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: now,
        workflowId: 'booking_workflow',
      };

      recordStepMetric(oldMetric);
      recordStepMetric(newMetric);

      // Get metrics from last 1 minute
      const recentMetrics = getRecentMetrics(1);

      expect(recentMetrics).toHaveLength(1);
      expect(recentMetrics[0].stepId).toBe('new_step');
    });
  });

  describe('Data aggregation edge cases', () => {
    it('should handle empty metrics gracefully', () => {
      clearMetrics();
      const metrics = getAggregatedMetrics();
      expect(metrics).toEqual([]);

      const report = generateOptimizationReport();
      expect(report.heatmap).toEqual([]);
      expect(report.suggestions).toEqual([]);
    });

    it('should calculate averages correctly with single metric', () => {
      const metric: StepMetric = {
        stepId: 'single_step',
        stepType: 'message',
        durationMs: 500,
        inputSize: 100,
        outputSize: 200,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'test_workflow',
      };

      recordStepMetric(metric);
      const metrics = getAggregatedMetrics();

      expect(metrics[0].avgDurationMs).toBe(500);
      expect(metrics[0].minDurationMs).toBe(500);
      expect(metrics[0].maxDurationMs).toBe(500);
      expect(metrics[0].p95DurationMs).toBe(500);
      expect(metrics[0].p99DurationMs).toBe(500);
    });

    it('should sort steps by average duration (bottlenecks first)', () => {
      const metric: StepMetric = {
        stepId: '',
        stepType: 'api',
        durationMs: 0,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'test_workflow',
      };

      // Record metrics in non-sorted order
      recordStepMetric({ ...metric, stepId: 'step1', durationMs: 100 });
      recordStepMetric({ ...metric, stepId: 'step2', durationMs: 500 });
      recordStepMetric({ ...metric, stepId: 'step3', durationMs: 200 });

      const metrics = getAggregatedMetrics();

      expect(metrics[0].stepId).toBe('step2'); // Highest duration first
      expect(metrics[1].stepId).toBe('step3');
      expect(metrics[2].stepId).toBe('step1');
    });
  });

  describe('Step type tracking', () => {
    it('should preserve step type information', () => {
      const metric: StepMetric = {
        stepId: 'api_call',
        stepType: 'pelangi_api:create_booking',
        durationMs: 300,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_workflow',
      };

      recordStepMetric(metric);
      const metrics = getAggregatedMetrics();

      expect(metrics[0].stepType).toBe('pelangi_api:create_booking');
    });
  });

  describe('Acceptance criteria compliance', () => {
    it('should profile each step with execution duration', () => {
      const metric: StepMetric = {
        stepId: 'test_step',
        stepType: 'wait_reply',
        durationMs: 250,
        inputSize: 300,
        outputSize: 600,
        stateSnapshot: { step: 'test' },
        timestamp: Date.now(),
        workflowId: 'booking_workflow',
      };

      recordStepMetric(metric);
      const metrics = getAggregatedMetrics();

      // AC1: Should have execution duration
      expect(metrics[0].avgDurationMs).toBe(250);
      expect(metrics[0].p95DurationMs).toBe(250);
      expect(metrics[0].p99DurationMs).toBe(250);
    });

    it('should aggregate metrics showing per-step latencies', () => {
      const metric: StepMetric = {
        stepId: 'api_step',
        stepType: 'pelangi_api:fetch_availability',
        durationMs: 0,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_workflow',
      };

      // Record 10 executions with varying latency
      [100, 150, 200, 250, 300, 350, 400, 450, 500, 550].forEach(d => {
        recordStepMetric({ ...metric, durationMs: d });
      });

      const metrics = getAggregatedMetrics();
      const apiStep = metrics.find(m => m.stepId === 'api_step');

      // AC2: Should show per-step average, p95, p99
      expect(apiStep!.count).toBe(10);
      expect(apiStep!.avgDurationMs).toBeGreaterThan(200);
      expect(apiStep!.p95DurationMs).toBeGreaterThan(400);
      expect(apiStep!.p99DurationMs).toBeGreaterThan(500);
    });

    it('should flag steps exceeding 2000ms threshold', () => {
      const metric: StepMetric = {
        stepId: 'slow_step',
        stepType: 'pelangi_api:slow_endpoint',
        durationMs: 2500,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_workflow',
      };

      recordStepMetric(metric);
      const metrics = getAggregatedMetrics();

      // AC2: Should flag slow steps
      expect(metrics[0].totalSlowExecutions).toBe(1);
      expect(metrics[0].avgDurationMs).toBeGreaterThan(2000);
    });

    it('should include optimization suggestions based on impact', () => {
      const metric: StepMetric = {
        stepId: 'bottleneck',
        stepType: 'pelangi_api:database_query',
        durationMs: 3000,
        inputSize: 200,
        outputSize: 500,
        stateSnapshot: {},
        timestamp: Date.now(),
        workflowId: 'booking_workflow',
      };

      for (let i = 0; i < 5; i++) {
        recordStepMetric(metric);
      }

      const report = generateOptimizationReport();

      // AC3: Should include suggestions with optimization targets
      expect(report.suggestions.length).toBeGreaterThan(0);
      expect(report.suggestions[0].stepId).toBe('bottleneck');
      expect(report.suggestions[0].estimatedGain).toBeDefined();
    });
  });
});
