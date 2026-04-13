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
} from '../src/lib/workflow-metrics.js';

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
      expect(status.failingSteps).toContain(expect.stringContaining('pelangi/date_selection'));
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
});
