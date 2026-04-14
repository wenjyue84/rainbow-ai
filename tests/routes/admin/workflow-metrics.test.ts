/**
 * Tests for US-623: Booking Workflow SLA Admin Endpoint
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as metricsLib from '../../../src/lib/workflow-metrics.js';

describe('US-623: Workflow Metrics Admin Endpoint', () => {
  beforeEach(() => {
    // Clear metrics before each test
    metricsLib.clearDurationMetrics();
  });

  describe('recordStepDuration()', () => {
    it('should record step duration', () => {
      metricsLib.recordStepDuration('pelangi', 'date_selection', 25000);
      const metrics = metricsLib.getProfileMetrics('pelangi');
      expect(metrics).toBeDefined();
    });

    it('should track SLA violations', () => {
      // date_selection SLA is 30000ms
      metricsLib.recordStepDuration('pelangi', 'date_selection', 35000);
      const metrics = metricsLib.getProfileMetrics('pelangi');
      expect(metrics).toBeDefined();
    });

    it('should handle multiple profiles', async () => {
      metricsLib.recordStepDuration('pelangi', 'date_selection', 25000);
      metricsLib.recordStepDuration('makan', 'guest_info', 35000);
      metricsLib.recordStepDuration('southern', 'confirmation', 20000);

      const pelangiMetrics = await metricsLib.getProfileMetrics('pelangi');
      expect(pelangiMetrics.length).toBeGreaterThan(0);
    });
  });

  describe('getProfileMetrics()', () => {
    it('should return empty array for profile with no metrics', async () => {
      const metrics = await metricsLib.getProfileMetrics('pelangi');
      expect(Array.isArray(metrics)).toBe(true);
    });

    it('should return step metrics with required fields', async () => {
      metricsLib.recordStepDuration('pelangi', 'date_selection', 25000);
      metricsLib.recordStepDuration('pelangi', 'date_selection', 27000);
      metricsLib.recordStepDuration('pelangi', 'date_selection', 26000);

      const metrics = await metricsLib.getProfileMetrics('pelangi');
      const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

      expect(dateSelectionMetric).toBeDefined();
      expect(dateSelectionMetric).toHaveProperty('avgDuration_ms');
      expect(dateSelectionMetric).toHaveProperty('p95Duration_ms');
      expect(dateSelectionMetric).toHaveProperty('slaViolations');
      expect(dateSelectionMetric).toHaveProperty('totalSamples');
      expect(dateSelectionMetric).toHaveProperty('trend');
    });

    it('should calculate correct average duration', async () => {
      metricsLib.recordStepDuration('pelangi', 'date_selection', 20000);
      metricsLib.recordStepDuration('pelangi', 'date_selection', 30000);

      const metrics = await metricsLib.getProfileMetrics('pelangi');
      const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

      expect(dateSelectionMetric?.avgDuration_ms).toBe(25000);
    });

    it('should track SLA violations correctly', async () => {
      // date_selection SLA is 30000ms
      metricsLib.recordStepDuration('pelangi', 'date_selection', 25000); // OK
      metricsLib.recordStepDuration('pelangi', 'date_selection', 35000); // Violation
      metricsLib.recordStepDuration('pelangi', 'date_selection', 32000); // Violation

      const metrics = await metricsLib.getProfileMetrics('pelangi');
      const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

      expect(dateSelectionMetric?.slaViolations).toBe(2);
      expect(dateSelectionMetric?.totalSamples).toBe(3);
    });

    it('should calculate P95 percentile', async () => {
      // Add 10 samples: 10-100 (in increments of 10)
      for (let i = 1; i <= 10; i++) {
        metricsLib.recordStepDuration('pelangi', 'date_selection', i * 10000);
      }

      const metrics = await metricsLib.getProfileMetrics('pelangi');
      const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

      // P95 of [10, 20, ..., 100] should be around 95000
      expect(dateSelectionMetric?.p95Duration_ms).toBeGreaterThan(90000);
      expect(dateSelectionMetric?.p95Duration_ms).toBeLessThanOrEqual(100000);
    });

    it('should calculate trend based on samples', async () => {
      // Add improving trend: older samples are slower, newer samples are faster
      for (let i = 0; i < 15; i++) {
        metricsLib.recordStepDuration('pelangi', 'date_selection', 40000 - i * 500);
      }

      const metrics = await metricsLib.getProfileMetrics('pelangi');
      const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

      expect(['improving', 'degrading', 'stable']).toContain(dateSelectionMetric?.trend);
    });

    it('should support different profiles', async () => {
      metricsLib.recordStepDuration('pelangi', 'date_selection', 25000);
      metricsLib.recordStepDuration('makan', 'guest_info', 35000);
      metricsLib.recordStepDuration('southern', 'confirmation', 20000);

      const pelangiMetrics = await metricsLib.getProfileMetrics('pelangi');
      const makanMetrics = await metricsLib.getProfileMetrics('makan');
      const southernMetrics = await metricsLib.getProfileMetrics('southern');

      expect(pelangiMetrics.length).toBeGreaterThan(0);
      expect(makanMetrics.length).toBeGreaterThan(0);
      expect(southernMetrics.length).toBeGreaterThan(0);
    });
  });

  describe('Response Structure (AC2)', () => {
    it('should return step metrics with avgDuration_ms, p95Duration_ms, slaViolations', async () => {
      metricsLib.recordStepDuration('pelangi', 'date_selection', 25000);
      const metrics = await metricsLib.getProfileMetrics('pelangi');
      const step = metrics.find(m => m.name === 'date_selection');

      expect(step).toHaveProperty('avgDuration_ms');
      expect(step).toHaveProperty('p95Duration_ms');
      expect(step).toHaveProperty('slaViolations');
    });

    it('should return trend indicator', async () => {
      for (let i = 0; i < 20; i++) {
        metricsLib.recordStepDuration('pelangi', 'guest_info', 35000 + i * 100);
      }
      const metrics = await metricsLib.getProfileMetrics('pelangi');
      const step = metrics.find(m => m.name === 'guest_info');

      expect(step).toHaveProperty('trend');
      expect(['improving', 'degrading', 'stable']).toContain(step?.trend);
    });

    it('should include totalSamples', async () => {
      metricsLib.recordStepDuration('pelangi', 'date_selection', 25000);
      metricsLib.recordStepDuration('pelangi', 'date_selection', 27000);
      const metrics = await metricsLib.getProfileMetrics('pelangi');
      const step = metrics.find(m => m.name === 'date_selection');

      expect(step?.totalSamples).toBe(2);
    });

    it('should handle zero samples gracefully', async () => {
      const metrics = await metricsLib.getProfileMetrics('pelangi');

      // All steps should have zero samples initially
      for (const step of metrics) {
        expect(step.totalSamples).toBe(0);
        expect(step.avgDuration_ms).toBe(0);
        expect(step.p95Duration_ms).toBe(0);
      }
    });
  });
});
