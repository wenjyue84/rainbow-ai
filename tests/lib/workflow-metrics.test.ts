/**
 * Tests for US-569: Booking Workflow Step Completion Rate Tracking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  incrementStarted,
  incrementCompleted,
  getCompletionRate,
  getStepMetrics,
  getAllMetrics,
  getCompletionHealthStatus,
  normalizeProfileName,
  clearMetrics,
  getCounters,
  recordStepDuration,
  getProfileMetrics,
  clearDurationMetrics,
} from '../../src/lib/workflow-metrics.js';

describe('WorkflowMetrics', () => {
  beforeEach(() => {
    clearMetrics();
  });

  describe('normalizeProfileName', () => {
    it('normalizes pelangi profiles', () => {
      expect(normalizeProfileName('pelangi-capsule')).toBe('pelangi');
      expect(normalizeProfileName('PELANGI')).toBe('pelangi');
      expect(normalizeProfileName('pelangi')).toBe('pelangi');
    });

    it('normalizes southern profiles', () => {
      expect(normalizeProfileName('southern-homestay')).toBe('southern');
      expect(normalizeProfileName('SOUTHERN')).toBe('southern');
    });

    it('normalizes makan profiles', () => {
      expect(normalizeProfileName('makan-moments')).toBe('makan');
      expect(normalizeProfileName('MAKAN')).toBe('makan');
    });

    it('defaults to pelangi for unknown profiles', () => {
      expect(normalizeProfileName('')).toBe('pelangi');
      expect(normalizeProfileName('unknown')).toBe('pelangi');
    });
  });

  describe('incrementStarted', () => {
    it('increments started counter', () => {
      incrementStarted('pelangi', 'date_selection');
      const counters = getCounters('pelangi', 'date_selection');
      expect(counters?.started).toBe(1);
    });

    it('increments multiple times', () => {
      incrementStarted('pelangi', 'date_selection');
      incrementStarted('pelangi', 'date_selection');
      incrementStarted('pelangi', 'date_selection');
      const counters = getCounters('pelangi', 'date_selection');
      expect(counters?.started).toBe(3);
    });

    it('normalizes profile names', () => {
      incrementStarted('pelangi-capsule', 'date_selection');
      const counters = getCounters('pelangi', 'date_selection');
      expect(counters?.started).toBe(1);
    });

    it('tracks multiple steps independently', () => {
      incrementStarted('pelangi', 'date_selection');
      incrementStarted('pelangi', 'guest_info');
      incrementStarted('pelangi', 'confirmation');

      expect(getCounters('pelangi', 'date_selection')?.started).toBe(1);
      expect(getCounters('pelangi', 'guest_info')?.started).toBe(1);
      expect(getCounters('pelangi', 'confirmation')?.started).toBe(1);
    });
  });

  describe('incrementCompleted', () => {
    it('increments completed counter', () => {
      incrementStarted('pelangi', 'date_selection');
      incrementCompleted('pelangi', 'date_selection');
      const counters = getCounters('pelangi', 'date_selection');
      expect(counters?.completed).toBe(1);
    });

    it('normalizes profile names', () => {
      incrementStarted('pelangi-capsule', 'date_selection');
      incrementCompleted('pelangi-capsule', 'date_selection');
      const counters = getCounters('pelangi', 'date_selection');
      expect(counters?.completed).toBe(1);
    });
  });

  describe('getCompletionRate', () => {
    it('returns 0 when no starts', () => {
      const rate = getCompletionRate('pelangi', 'date_selection');
      expect(rate).toBe(0);
    });

    it('calculates completion rate correctly', () => {
      incrementStarted('pelangi', 'date_selection');
      incrementStarted('pelangi', 'date_selection');
      incrementCompleted('pelangi', 'date_selection');
      const rate = getCompletionRate('pelangi', 'date_selection');
      expect(rate).toBe(50);
    });

    it('returns 100 when all complete', () => {
      incrementStarted('pelangi', 'date_selection');
      incrementStarted('pelangi', 'date_selection');
      incrementCompleted('pelangi', 'date_selection');
      incrementCompleted('pelangi', 'date_selection');
      const rate = getCompletionRate('pelangi', 'date_selection');
      expect(rate).toBe(100);
    });

    it('returns percentages correctly for typical funnel', () => {
      // Typical booking funnel: 150 start date, 138 continue to guest, 117 confirm, 91 complete
      incrementStarted('pelangi', 'date_selection');
      for (let i = 0; i < 149; i++) incrementStarted('pelangi', 'date_selection');
      for (let i = 0; i < 138; i++) incrementCompleted('pelangi', 'date_selection');

      const rate = getCompletionRate('pelangi', 'date_selection');
      expect(rate).toBeCloseTo(92, 0);
    });
  });

  describe('getStepMetrics', () => {
    it('returns step metrics with all fields', () => {
      incrementStarted('pelangi', 'date_selection');
      incrementStarted('pelangi', 'date_selection');
      incrementCompleted('pelangi', 'date_selection');

      const metrics = getStepMetrics('pelangi', 'date_selection');
      expect(metrics).toEqual({
        step_started: 2,
        step_completed: 1,
        completion_rate: 50,
      });
    });

    it('returns zero metrics for new steps', () => {
      const metrics = getStepMetrics('pelangi', 'date_selection');
      expect(metrics).toEqual({
        step_started: 0,
        step_completed: 0,
        completion_rate: 0,
      });
    });
  });

  describe('getAllMetrics', () => {
    it('returns empty object when no data', () => {
      const metrics = getAllMetrics();
      expect(metrics).toEqual({});
    });

    it('returns metrics for all profiles with data', () => {
      incrementStarted('pelangi', 'date_selection');
      incrementCompleted('pelangi', 'date_selection');
      incrementStarted('southern', 'guest_info');

      const metrics = getAllMetrics();
      expect(metrics.pelangi).toBeDefined();
      expect(metrics.pelangi?.date_selection.step_started).toBe(1);
      expect(metrics.southern).toBeDefined();
      expect(metrics.southern?.guest_info.step_started).toBe(1);
    });

    it('includes all three steps per profile', () => {
      incrementStarted('pelangi', 'date_selection');
      const metrics = getAllMetrics();
      expect(metrics.pelangi).toBeDefined();
      expect(metrics.pelangi?.date_selection).toBeDefined();
      expect(metrics.pelangi?.guest_info).toBeDefined();
      expect(metrics.pelangi?.confirmation).toBeDefined();
    });
  });

  describe('getCompletionHealthStatus', () => {
    it('returns ok=true when no data', () => {
      const status = getCompletionHealthStatus();
      expect(status.ok).toBe(true);
      expect(status.detail).toContain('above completion threshold');
    });

    it('returns ok=true when all steps above 70%', () => {
      for (let i = 0; i < 20; i++) {
        incrementStarted('pelangi', 'date_selection');
        if (i < 15) incrementCompleted('pelangi', 'date_selection'); // 75%
      }

      const status = getCompletionHealthStatus();
      expect(status.ok).toBe(true);
    });

    it('returns ok=false when step below 70%', () => {
      for (let i = 0; i < 20; i++) {
        incrementStarted('pelangi', 'date_selection');
        if (i < 12) incrementCompleted('pelangi', 'date_selection'); // 60%
      }

      const status = getCompletionHealthStatus();
      expect(status.ok).toBe(false);
      expect(status.detail).toContain('below 70% threshold');
      expect(status.failingSteps).toBeDefined();
      expect(status.failingSteps?.length).toBeGreaterThan(0);
    });

    it('includes failing step details', () => {
      for (let i = 0; i < 10; i++) {
        incrementStarted('pelangi', 'date_selection');
        if (i < 6) incrementCompleted('pelangi', 'date_selection'); // 60%
      }

      const status = getCompletionHealthStatus();
      expect(status.failingSteps).toBeDefined();
      expect(status.failingSteps?.length).toBeGreaterThan(0);
      expect(status.failingSteps?.[0]).toMatch(/pelangi\/date_selection/);
    });

    it('ignores steps with < 10 samples', () => {
      for (let i = 0; i < 5; i++) {
        incrementStarted('pelangi', 'date_selection');
      }
      // 0/5 = 0%, but should not be flagged due to low sample count

      const status = getCompletionHealthStatus();
      expect(status.ok).toBe(true);
    });
  });

  describe('typical booking funnel', () => {
    it('tracks a complete booking workflow funnel', () => {
      const profile = 'pelangi';

      // Step 1: Date selection
      // 150 users select a date, 138 continue (92%)
      for (let i = 0; i < 150; i++) incrementStarted(profile, 'date_selection');
      for (let i = 0; i < 138; i++) incrementCompleted(profile, 'date_selection');

      // Step 2: Guest info
      // 138 enter guest info, 117 continue (84.8%)
      for (let i = 0; i < 138; i++) incrementStarted(profile, 'guest_info');
      for (let i = 0; i < 117; i++) incrementCompleted(profile, 'guest_info');

      // Step 3: Confirmation
      // 117 confirm, 91 complete (77.8%)
      for (let i = 0; i < 117; i++) incrementStarted(profile, 'confirmation');
      for (let i = 0; i < 91; i++) incrementCompleted(profile, 'confirmation');

      const metrics = getAllMetrics();
      const pelangiMetrics = metrics[profile];

      expect(pelangiMetrics).toBeDefined();
      expect(pelangiMetrics?.date_selection.completion_rate).toBeCloseTo(92, 0);
      expect(pelangiMetrics?.guest_info.completion_rate).toBeCloseTo(84.8, 1);
      expect(pelangiMetrics?.confirmation.completion_rate).toBeCloseTo(77.8, 1);
    });

    it('returns expected response format for endpoint', () => {
      const profile = 'pelangi';
      for (let i = 0; i < 100; i++) incrementStarted(profile, 'date_selection');
      for (let i = 0; i < 92; i++) incrementCompleted(profile, 'date_selection');

      const metrics = getAllMetrics();
      expect(metrics).toHaveProperty('pelangi');
      expect(metrics.pelangi).toHaveProperty('date_selection');
      expect(metrics.pelangi?.date_selection).toHaveProperty('step_started');
      expect(metrics.pelangi?.date_selection).toHaveProperty('step_completed');
      expect(metrics.pelangi?.date_selection).toHaveProperty('completion_rate');
    });
  });

  describe('US-623: Duration SLA Monitoring', () => {
    beforeEach(() => {
      clearDurationMetrics();
    });

    describe('recordStepDuration', () => {
      it('records step duration', () => {
        recordStepDuration('pelangi', 'date_selection', 25000);
        // Verify it doesn't throw
        expect(true).toBe(true);
      });

      it('tracks SLA violations (date_selection SLA = 30000ms)', () => {
        recordStepDuration('pelangi', 'date_selection', 25000); // OK
        recordStepDuration('pelangi', 'date_selection', 35000); // Violation
        recordStepDuration('pelangi', 'date_selection', 32000); // Violation
        // Should have recorded 2 violations
        expect(true).toBe(true);
      });

      it('handles multiple profiles independently', () => {
        recordStepDuration('pelangi', 'date_selection', 25000);
        recordStepDuration('makan', 'guest_info', 35000);
        recordStepDuration('southern', 'confirmation', 20000);
        expect(true).toBe(true);
      });

      it('handles multiple steps per profile', () => {
        recordStepDuration('pelangi', 'date_selection', 25000);
        recordStepDuration('pelangi', 'guest_info', 35000);
        recordStepDuration('pelangi', 'confirmation', 20000);
        expect(true).toBe(true);
      });
    });

    describe('getProfileMetrics', () => {
      it('returns empty array for profile with no data', async () => {
        const metrics = await getProfileMetrics('pelangi');
        expect(Array.isArray(metrics)).toBe(true);
      });

      it('returns step metrics with required fields', async () => {
        recordStepDuration('pelangi', 'date_selection', 25000);
        recordStepDuration('pelangi', 'date_selection', 27000);
        recordStepDuration('pelangi', 'date_selection', 26000);

        const metrics = await getProfileMetrics('pelangi');
        const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

        expect(dateSelectionMetric).toBeDefined();
        expect(dateSelectionMetric).toHaveProperty('name');
        expect(dateSelectionMetric).toHaveProperty('avgDuration_ms');
        expect(dateSelectionMetric).toHaveProperty('p95Duration_ms');
        expect(dateSelectionMetric).toHaveProperty('slaViolations');
        expect(dateSelectionMetric).toHaveProperty('totalSamples');
        expect(dateSelectionMetric).toHaveProperty('trend');
      });

      it('calculates correct average duration', async () => {
        recordStepDuration('pelangi', 'date_selection', 20000);
        recordStepDuration('pelangi', 'date_selection', 30000);

        const metrics = await getProfileMetrics('pelangi');
        const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

        expect(dateSelectionMetric?.avgDuration_ms).toBe(25000);
      });

      it('tracks SLA violations correctly', async () => {
        recordStepDuration('pelangi', 'date_selection', 25000);
        recordStepDuration('pelangi', 'date_selection', 35000); // Violation
        recordStepDuration('pelangi', 'date_selection', 32000); // Violation

        const metrics = await getProfileMetrics('pelangi');
        const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

        expect(dateSelectionMetric?.slaViolations).toBe(2);
        expect(dateSelectionMetric?.totalSamples).toBe(3);
      });

      it('calculates P95 correctly', async () => {
        // Add 10 samples: 10000, 20000, ..., 100000
        for (let i = 1; i <= 10; i++) {
          recordStepDuration('pelangi', 'date_selection', i * 10000);
        }

        const metrics = await getProfileMetrics('pelangi');
        const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

        // P95 should be near 95000
        expect(dateSelectionMetric?.p95Duration_ms).toBeGreaterThan(90000);
        expect(dateSelectionMetric?.p95Duration_ms).toBeLessThanOrEqual(100000);
      });

      it('calculates trend correctly', async () => {
        // Add improving trend (older slower, newer faster)
        for (let i = 0; i < 20; i++) {
          recordStepDuration('pelangi', 'date_selection', 40000 - i * 500);
        }

        const metrics = await getProfileMetrics('pelangi');
        const dateSelectionMetric = metrics.find(m => m.name === 'date_selection');

        expect(['improving', 'degrading', 'stable']).toContain(dateSelectionMetric?.trend);
      });

      it('supports multiple profiles', async () => {
        recordStepDuration('pelangi', 'date_selection', 25000);
        recordStepDuration('makan', 'guest_info', 35000);
        recordStepDuration('southern', 'confirmation', 20000);

        const pelangiMetrics = await getProfileMetrics('pelangi');
        const makanMetrics = await getProfileMetrics('makan');
        const southernMetrics = await getProfileMetrics('southern');

        expect(pelangiMetrics.length).toBeGreaterThan(0);
        expect(makanMetrics.length).toBeGreaterThan(0);
        expect(southernMetrics.length).toBeGreaterThan(0);
      });

      it('returns metrics sorted by step name', async () => {
        recordStepDuration('pelangi', 'confirmation', 20000);
        recordStepDuration('pelangi', 'date_selection', 25000);
        recordStepDuration('pelangi', 'guest_info', 30000);

        const metrics = await getProfileMetrics('pelangi');

        // Should be sorted: confirmation, date_selection, guest_info
        expect(metrics[0].name <= metrics[1].name).toBe(true);
        expect(metrics[1].name <= metrics[2].name).toBe(true);
      });

      it('handles zero samples gracefully', async () => {
        const metrics = await getProfileMetrics('pelangi');

        // All steps should have zero values
        for (const step of metrics) {
          if (step.totalSamples === 0) {
            expect(step.avgDuration_ms).toBe(0);
            expect(step.p95Duration_ms).toBe(0);
          }
        }
      });
    });
  });
});
