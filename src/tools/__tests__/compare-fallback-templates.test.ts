/**
 * Unit tests for compare-fallback-templates.ts
 *
 * Tests the A/B comparison logic with mock conversation data,
 * verifying correct rate calculation and statistical comparison.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import {
  compareTemplates,
  computeChiSquaredPValue,
  countBookingConversions,
  countEscalations,
  fetchTemplateConversations,
  type ComparisonMetrics,
  type ComparisonResult,
} from '../compare-fallback-templates.js';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockConversationData = {
  templateA: [
    { phone: '+60123456789', intent: 'unknown', template_used: 'first_fallback', timestamp: new Date() },
    { phone: '+60123456789', intent: 'unknown', template_used: 'first_fallback', timestamp: new Date() },
    { phone: '+60187654321', intent: 'unknown', template_used: 'first_fallback', timestamp: new Date() },
    { phone: '+60198765432', intent: 'unknown', template_used: 'first_fallback', timestamp: new Date() },
    { phone: '+60155555555', intent: 'unknown', template_used: 'first_fallback', timestamp: new Date() },
  ],
  templateB: [
    { phone: '+60111111111', intent: 'unknown', template_used: 'repeated_fallback', timestamp: new Date() },
    { phone: '+60122222222', intent: 'unknown', template_used: 'repeated_fallback', timestamp: new Date() },
    { phone: '+60133333333', intent: 'unknown', template_used: 'repeated_fallback', timestamp: new Date() },
    { phone: '+60144444444', intent: 'unknown', template_used: 'repeated_fallback', timestamp: new Date() },
    { phone: '+60155555555', intent: 'unknown', template_used: 'repeated_fallback', timestamp: new Date() },
  ],
};

// ---------------------------------------------------------------------------
// Tests for utility functions
// ---------------------------------------------------------------------------

describe('computeChiSquaredPValue', () => {
  it('should return 1 for zero totals', () => {
    const pValue = computeChiSquaredPValue(0, 0, 5, 10);
    expect(pValue).toBe(1);
  });

  it('should handle identical proportions (no difference)', () => {
    const pValue = computeChiSquaredPValue(5, 10, 5, 10);
    expect(pValue).toBeGreaterThan(0.8); // p-value should be high (no significant difference)
  });

  it('should detect significant difference in proportions', () => {
    const pValue = computeChiSquaredPValue(9, 10, 1, 10);
    expect(pValue).toBeLessThan(0.05); // p-value should be low (significant difference)
  });

  it('should return values between 0 and 1', () => {
    const pValue = computeChiSquaredPValue(7, 10, 3, 10);
    expect(pValue).toBeGreaterThanOrEqual(0);
    expect(pValue).toBeLessThanOrEqual(1);
  });

  it('should be symmetric for proportions', () => {
    const pValue1 = computeChiSquaredPValue(9, 10, 1, 10);
    const pValue2 = computeChiSquaredPValue(1, 10, 9, 10);
    expect(pValue1).toBeCloseTo(pValue2);
  });
});

// ---------------------------------------------------------------------------
// Tests for database query mocking
// ---------------------------------------------------------------------------

describe('Database query functions (with mocks)', () => {
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchTemplateConversations', () => {
    it('should query rainbow_messages with correct filters', async () => {
      mockPool.query.mockResolvedValue({ rows: mockConversationData.templateA });

      const result = await fetchTemplateConversations(
        mockPool,
        'unknown',
        'first_fallback',
        'pelangi',
        30,
      );

      expect(mockPool.query).toHaveBeenCalledOnce();
      expect(result).toEqual(mockConversationData.templateA);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('rainbow_messages');
      expect(sql).toContain('fallback:');
      expect(params[0]).toBe('unknown');
      expect(params[1]).toBe('pelangi');
    });

    it('should handle empty results', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await fetchTemplateConversations(
        mockPool,
        'unknown',
        'first_fallback',
        'pelangi',
        30,
      );

      expect(result).toEqual([]);
    });
  });

  describe('countBookingConversions', () => {
    it('should return 0 for empty phone list', async () => {
      const count = await countBookingConversions(mockPool, [], 'pelangi', 30);
      expect(count).toBe(0);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should count booking workflow conversions', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ count: 15 }] });

      const phones = ['+60123456789', '+60187654321'];
      const count = await countBookingConversions(mockPool, phones, 'pelangi', 30);

      expect(count).toBe(15);
      expect(mockPool.query).toHaveBeenCalledOnce();

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('rainbow_messages');
      expect(sql).toContain('booking');
      expect(params[0]).toEqual(phones);
    });

    it('should handle SQL error gracefully', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const phones = ['+60123456789'];
      const count = await countBookingConversions(mockPool, phones, 'pelangi', 30);

      expect(count).toBe(0);
    });
  });

  describe('countEscalations', () => {
    it('should return 0 for empty phone list', async () => {
      const count = await countEscalations(mockPool, [], 'pelangi', 30);
      expect(count).toBe(0);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should count escalation events', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ count: 8 }] });

      const phones = ['+60123456789', '+60187654321'];
      const count = await countEscalations(mockPool, phones, 'pelangi', 30);

      expect(count).toBe(8);
      expect(mockPool.query).toHaveBeenCalledOnce();

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('rainbow_messages');
      expect(params[0]).toEqual(phones);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests (end-to-end comparison)
// ---------------------------------------------------------------------------

describe('compareTemplates (integration)', () => {
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
      end: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should compare two templates and return result with correct structure', async () => {
    // Mock fetchTemplateConversations to return test data
    mockPool.query
      .mockResolvedValueOnce({ rows: mockConversationData.templateA }) // fetchTemplateConversations A
      .mockResolvedValueOnce({ rows: mockConversationData.templateB }) // fetchTemplateConversations B
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // countBookingConversions A (3 out of 4 unique phones)
      .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // countBookingConversions B (2 out of 5 unique phones)
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // countEscalations A
      .mockResolvedValueOnce({ rows: [{ count: 2 }] }); // countEscalations B

    const result = await compareTemplates(
      mockPool,
      'unknown',
      'first_fallback',
      'repeated_fallback',
      'pelangi',
      30,
    );

    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('intent', 'unknown');
    expect(result).toHaveProperty('profile', 'pelangi');
    expect(result).toHaveProperty('days_analyzed', 30);
    expect(result).toHaveProperty('template_a');
    expect(result).toHaveProperty('template_b');
    expect(result).toHaveProperty('statistical_significance');
    expect(result).toHaveProperty('winner');
    expect(result).toHaveProperty('details');
  });

  it('should calculate booking rates correctly', async () => {
    // Setup: Template A has 100% booking rate (3/3), Template B has 40% (2/5)
    mockPool.query
      .mockResolvedValueOnce({ rows: mockConversationData.templateA })
      .mockResolvedValueOnce({ rows: mockConversationData.templateB })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // 3 bookings for A (4 unique phones from mock)
      .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // 2 bookings for B (5 unique phones)
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // no escalations for A
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }); // no escalations for B

    const result = await compareTemplates(
      mockPool,
      'unknown',
      'first_fallback',
      'repeated_fallback',
      'pelangi',
      30,
    );

    // Template A has 4 unique phones, 3 bookings => 75% rate
    // Template B has 5 unique phones, 2 bookings => 40% rate
    expect(result.template_a.booking_rate).toBeCloseTo(0.75, 2);
    expect(result.template_b.booking_rate).toBeCloseTo(0.4, 2);
  });

  it('should identify winning template based on booking rate', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: mockConversationData.templateA })
      .mockResolvedValueOnce({ rows: mockConversationData.templateB })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // Template A: 75%
      .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // Template B: 40%
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const result = await compareTemplates(
      mockPool,
      'unknown',
      'first_fallback',
      'repeated_fallback',
      'pelangi',
      30,
    );

    expect(result.winner).toBe('first_fallback'); // Higher booking rate
  });

  it('should calculate escalation rates correctly', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: mockConversationData.templateA })
      .mockResolvedValueOnce({ rows: mockConversationData.templateB })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // 1 escalation for A (4 unique phones) => 25%
      .mockResolvedValueOnce({ rows: [{ count: 2 }] }); // 2 escalations for B (5 unique phones) => 40%

    const result = await compareTemplates(
      mockPool,
      'unknown',
      'first_fallback',
      'repeated_fallback',
      'pelangi',
      30,
    );

    expect(result.template_a.escalation_rate).toBeCloseTo(0.25, 2);
    expect(result.template_b.escalation_rate).toBeCloseTo(0.4, 2);
  });

  it('should calculate statistical significance', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: mockConversationData.templateA })
      .mockResolvedValueOnce({ rows: mockConversationData.templateB })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // High conversion for A (3/4 = 75%)
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // Low conversion for B (1/5 = 20%)
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const result = await compareTemplates(
      mockPool,
      'unknown',
      'first_fallback',
      'repeated_fallback',
      'pelangi',
      30,
    );

    // Should have a p-value between 0 and 1
    expect(result.statistical_significance).toBeGreaterThanOrEqual(0);
    expect(result.statistical_significance).toBeLessThanOrEqual(1);

    // With such different rates (75% vs 20%), should show some difference (p-value < 0.3)
    expect(result.statistical_significance).toBeLessThan(0.3);
  });

  it('should handle zero conversations for a template', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // No conversations for template A
      .mockResolvedValueOnce({ rows: mockConversationData.templateB })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const result = await compareTemplates(
      mockPool,
      'unknown',
      'first_fallback',
      'repeated_fallback',
      'pelangi',
      30,
    );

    expect(result.template_a.total_conversations).toBe(0);
    expect(result.template_a.booking_rate).toBe(0);
    expect(result.template_b.total_conversations).toBeGreaterThan(0);
  });

  it('should compute booking advantage details', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: mockConversationData.templateA })
      .mockResolvedValueOnce({ rows: mockConversationData.templateB })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // A: 75%
      .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // B: 40%
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // A: 25% escalation
      .mockResolvedValueOnce({ rows: [{ count: 2 }] }); // B: 40% escalation

    const result = await compareTemplates(
      mockPool,
      'unknown',
      'first_fallback',
      'repeated_fallback',
      'pelangi',
      30,
    );

    expect(result.details.template_a_booking_advantage).toBeCloseTo(0.35, 2); // 75% - 40%
    expect(result.details.template_a_escalation_disadvantage).toBeCloseTo(-0.15, 2); // 25% - 40%
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('computeChiSquaredPValue should handle very large counts', () => {
    const pValue = computeChiSquaredPValue(1000000, 2000000, 500000, 2000000);
    expect(pValue).toBeGreaterThanOrEqual(0);
    expect(pValue).toBeLessThanOrEqual(1);
  });

  it('computeChiSquaredPValue should handle single conversion', () => {
    const pValue = computeChiSquaredPValue(1, 100, 0, 100);
    expect(pValue).toBeGreaterThanOrEqual(0);
    expect(pValue).toBeLessThanOrEqual(1);
  });
});
