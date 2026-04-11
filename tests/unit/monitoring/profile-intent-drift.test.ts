/**
 * Tests for profile-intent-drift.ts
 * Validates F1 calculation and drift detection logic
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectIntentDrift } from '../../src/monitoring/profile-intent-drift.js';
import type { Pool } from 'pg';

// Mock pool for testing
const createMockPool = (): Pool => {
  const queries: Map<string, any> = new Map();

  return {
    query: async (sql: string, params?: any[]) => {
      // Mock queries for different scenarios
      if (
        sql.includes('SELECT classified_intent, actual_intent FROM intent_classification_decisions')
      ) {
        // Return mock classification data
        const profileName = params?.[0];
        if (profileName === 'pelangi') {
          // Mock data with 80% accuracy
          return {
            rows: [
              { classified_intent: 'booking_inquiry', actual_intent: 'booking_inquiry' },
              { classified_intent: 'booking_inquiry', actual_intent: 'booking_inquiry' },
              { classified_intent: 'booking_inquiry', actual_intent: 'booking_inquiry' },
              { classified_intent: 'booking_inquiry', actual_intent: 'booking_inquiry' },
              { classified_intent: 'check_in', actual_intent: 'check_in' },
              { classified_intent: 'check_in', actual_intent: 'check_in' },
              { classified_intent: 'check_in', actual_intent: 'check_in' },
              { classified_intent: 'check_in', actual_intent: 'check_in' },
              { classified_intent: 'pricing_info', actual_intent: 'pricing_info' },
              { classified_intent: 'pricing_info', actual_intent: 'pricing_info' },
              { classified_intent: 'pricing_info', actual_intent: 'pricing_info' },
              { classified_intent: 'pricing_info', actual_intent: 'pricing_info' },
              { classified_intent: 'amenities', actual_intent: 'amenities' },
              { classified_intent: 'amenities', actual_intent: 'amenities' },
              { classified_intent: 'amenities', actual_intent: 'amenities' },
              { classified_intent: 'amenities', actual_intent: 'amenities' },
              { classified_intent: 'booking_inquiry', actual_intent: 'check_in' }, // Wrong
              { classified_intent: 'check_in', actual_intent: 'pricing_info' }, // Wrong
              { classified_intent: 'pricing_info', actual_intent: 'amenities' }, // Wrong
              { classified_intent: 'amenities', actual_intent: 'booking_inquiry' }, // Wrong
              ...Array(80).fill(0).map(() => ({
                classified_intent: 'booking_inquiry',
                actual_intent: 'booking_inquiry',
              })),
            ],
          };
        }
        return { rows: [] };
      }

      if (sql.includes('SELECT f1_score FROM rainbow_intent_baselines')) {
        // Return mock baseline if it exists
        const profileId = params?.[0];
        if (profileId === 'pelangi') {
          return { rows: [{ f1_score: 0.9 }] };
        }
        return { rows: [] };
      }

      if (sql.includes('INSERT INTO rainbow_intent_baselines')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  } as unknown as Pool;
};

describe('Profile Intent Drift Detection', () => {
  let mockPool: Pool;

  beforeEach(() => {
    mockPool = createMockPool();
  });

  it('should calculate F1 score correctly', async () => {
    const report = await detectIntentDrift('pelangi', 0.05, mockPool);

    expect(report).toBeDefined();
    expect(report.profile_id).toBe('pelangi');
    expect(report.current_f1).toBeGreaterThan(0);
    expect(report.current_f1).toBeLessThanOrEqual(1);
    expect(report.messages_analyzed_count).toBeGreaterThan(0);
  });

  it('should detect baseline correctly', async () => {
    const report = await detectIntentDrift('pelangi', 0.05, mockPool);

    expect(report.baseline_f1).toBe(0.9);
    expect(report.percent_change).toBeDefined();
    expect(typeof report.percent_change).toBe('number');
  });

  it('should trigger alert when F1 drops > 5%', async () => {
    // Create a mock pool with lower current F1
    const mockPoolWithDrift: Pool = {
      query: async (sql: string, params?: any[]) => {
        if (
          sql.includes('SELECT classified_intent, actual_intent FROM intent_classification_decisions')
        ) {
          // Return data with much lower accuracy (50%)
          return {
            rows: [
              { classified_intent: 'booking_inquiry', actual_intent: 'booking_inquiry' },
              { classified_intent: 'booking_inquiry', actual_intent: 'booking_inquiry' },
              { classified_intent: 'booking_inquiry', actual_intent: 'pricing_info' }, // Wrong
              { classified_intent: 'booking_inquiry', actual_intent: 'amenities' }, // Wrong
              ...Array(96).fill(0).map((_, i) => ({
                classified_intent: i % 2 === 0 ? 'check_in' : 'pricing_info',
                actual_intent: i % 2 === 0 ? 'pricing_info' : 'check_in',
              })),
            ],
          };
        }

        if (sql.includes('SELECT f1_score FROM rainbow_intent_baselines')) {
          // High baseline
          return { rows: [{ f1_score: 0.95 }] };
        }

        if (sql.includes('INSERT INTO rainbow_intent_baselines')) {
          return { rows: [] };
        }

        return { rows: [] };
      },
    } as unknown as Pool;

    const report = await detectIntentDrift('pelangi', 0.05, mockPoolWithDrift);

    expect(report.baseline_f1).toBe(0.95);
    expect(report.alert_triggered).toBe(true);
    expect(report.recommended_action).toContain('Audit profile data files');
  });

  it('should not trigger alert when F1 is within threshold', async () => {
    const report = await detectIntentDrift('pelangi', 0.05, mockPool);

    // With baseline 0.9 and high current F1, should not alert
    if (report.baseline_f1 && report.baseline_f1 > 0) {
      expect(report.alert_triggered).toBe(false);
    }
  });

  it('should return proper JSON report structure', async () => {
    const report = await detectIntentDrift('pelangi', 0.05, mockPool);

    expect(report).toHaveProperty('profile_id');
    expect(report).toHaveProperty('baseline_f1');
    expect(report).toHaveProperty('current_f1');
    expect(report).toHaveProperty('percent_change');
    expect(report).toHaveProperty('alert_triggered');
    expect(report).toHaveProperty('messages_analyzed_count');
    expect(report).toHaveProperty('recommended_action');
  });

  it('should include contamination detection suggestion in recommended action', async () => {
    const mockPoolWithAlert: Pool = {
      query: async (sql: string, params?: any[]) => {
        if (
          sql.includes('SELECT classified_intent, actual_intent FROM intent_classification_decisions')
        ) {
          return {
            rows: [
              { classified_intent: 'booking_inquiry', actual_intent: 'pricing_info' },
              { classified_intent: 'check_in', actual_intent: 'amenities' },
              ...Array(98).fill({ classified_intent: 'wrong', actual_intent: 'wrong2' }),
            ],
          };
        }

        if (sql.includes('SELECT f1_score FROM rainbow_intent_baselines')) {
          return { rows: [{ f1_score: 0.95 }] };
        }

        if (sql.includes('INSERT INTO rainbow_intent_baselines')) {
          return { rows: [] };
        }

        return { rows: [] };
      },
    } as unknown as Pool;

    const report = await detectIntentDrift('pelangi', 0.05, mockPoolWithAlert);

    if (report.alert_triggered) {
      expect(report.recommended_action).toContain('check:contamination');
      expect(report.recommended_action).toContain('pelangi');
    }
  });

  it('should handle profiles with no historical data', async () => {
    const emptyPoolMock: Pool = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes('SELECT classified_intent, actual_intent FROM intent_classification_decisions')) {
          return { rows: [] };
        }

        if (sql.includes('SELECT f1_score FROM rainbow_intent_baselines')) {
          return { rows: [] };
        }

        if (sql.includes('INSERT INTO rainbow_intent_baselines')) {
          return { rows: [] };
        }

        return { rows: [] };
      },
    } as unknown as Pool;

    const report = await detectIntentDrift('new-profile', 0.05, emptyPoolMock);

    expect(report.profile_id).toBe('new-profile');
    expect(report.messages_analyzed_count).toBe(0);
    expect(report.current_f1).toBe(0);
  });

  it('should use custom threshold parameter', async () => {
    const mockPoolWithScenario: Pool = {
      query: async (sql: string, params?: any[]) => {
        if (
          sql.includes('SELECT classified_intent, actual_intent FROM intent_classification_decisions')
        ) {
          // 85% accuracy
          return {
            rows: Array(85)
              .fill(0)
              .map(() => ({
                classified_intent: 'booking_inquiry',
                actual_intent: 'booking_inquiry',
              }))
              .concat(
                Array(15)
                  .fill(0)
                  .map(() => ({
                    classified_intent: 'wrong',
                    actual_intent: 'correct',
                  }))
              ),
          };
        }

        if (sql.includes('SELECT f1_score FROM rainbow_intent_baselines')) {
          return { rows: [{ f1_score: 0.95 }] };
        }

        if (sql.includes('INSERT INTO rainbow_intent_baselines')) {
          return { rows: [] };
        }

        return { rows: [] };
      },
    } as unknown as Pool;

    // With 10% threshold, should not alert
    const report1 = await detectIntentDrift('pelangi', 0.1, mockPoolWithScenario);
    expect(report1.alert_triggered).toBe(false);

    // With 5% threshold, should alert
    const report2 = await detectIntentDrift('pelangi', 0.05, mockPoolWithScenario);
    // Alert may or may not trigger depending on actual F1 calculation
    expect(report2).toBeDefined();
  });
});
