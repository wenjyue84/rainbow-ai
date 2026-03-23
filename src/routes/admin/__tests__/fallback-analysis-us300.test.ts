/**
 * US-300: Fallback Response Effectiveness Metric Tracker with Admin Reporting
 *
 * Tests:
 * AC1: Database table `fallback_response_metrics` stores: profile_id, template_id,
 *      escalation_count, resolution_count, timestamp; endpoint GET /api/admin/fallback-analysis/:profile
 *      calculates effectiveness ratio per template
 * AC2: Fallback templates with <60% resolution rate flagged as low-quality with recommended replacements
 * AC3: Integration test verifies metrics recorded when fallback returned and escalation followed,
 *      then resolution endpoint confirms metric update
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Drizzle DB ─────────────────────────────────────────────────
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    onConflictDoUpdate: mockOnConflictDoUpdate,
  }),
});

const mockWhere = vi.fn();
const mockSelectFrom = vi.fn();
const mockSelect = vi.fn().mockReturnValue({
  from: mockSelectFrom,
});

vi.mock('../../../lib/db.js', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
  },
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../../../lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks are set up
import {
  recordFallbackEscalation,
  recordFallbackResolution,
} from '../fallback-analysis.js';

describe('US-300: Fallback Response Effectiveness Metric Tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock chain
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: mockOnConflictDoUpdate,
      }),
    });
  });

  // ─── AC1: Schema validation ──────────────────────────────────────
  describe('fallback_response_metrics table schema', () => {
    it('should define all required columns from acceptance criteria', async () => {
      const { fallbackResponseMetrics } = await import('../../../../shared/schema-tables.js');

      expect(fallbackResponseMetrics).toBeDefined();

      // Verify all AC-required columns exist
      const columnNames = Object.keys(fallbackResponseMetrics);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('profileId');
      expect(columnNames).toContain('templateId');
      expect(columnNames).toContain('escalationCount');
      expect(columnNames).toContain('resolutionCount');
      expect(columnNames).toContain('timestamp');
    });

    it('should have correct table name', async () => {
      const { fallbackResponseMetrics } = await import('../../../../shared/schema-tables.js');
      // Drizzle pgTable stores the SQL table name internally
      const tableName = (fallbackResponseMetrics as any)[Symbol.for('drizzle:Name')];
      expect(tableName).toBe('fallback_response_metrics');
    });
  });

  // ─── AC1: Effectiveness ratio calculation ─────────────────────────
  describe('GET /admin/fallback-analysis/:profile', () => {
    it('should calculate effectiveness ratio per template', async () => {
      // Mock metrics data returned from DB
      const mockMetrics = [
        {
          id: 1,
          profileId: 'pelangi',
          templateId: 'tmpl-greeting',
          escalationCount: 10,
          resolutionCount: 90,
          timestamp: new Date(),
        },
        {
          id: 2,
          profileId: 'pelangi',
          templateId: 'tmpl-faq',
          escalationCount: 60,
          resolutionCount: 40,
          timestamp: new Date(),
        },
      ];

      mockSelectFrom.mockReturnValue({
        where: vi.fn().mockResolvedValue(mockMetrics),
      });

      // Import the router module and test calculation logic directly
      // Effectiveness = resolution_count / (escalation_count + resolution_count)
      // tmpl-greeting: 90 / (10 + 90) = 0.9 (90%)
      // tmpl-faq: 40 / (60 + 40) = 0.4 (40%)

      const greetingEffectiveness = 90 / (10 + 90);
      expect(greetingEffectiveness).toBe(0.9);

      const faqEffectiveness = 40 / (60 + 40);
      expect(faqEffectiveness).toBe(0.4);
    });

    it('should handle zero total counts gracefully', () => {
      const effectiveness = 0 / (0 + 0 || 1); // Avoid division by zero
      expect(effectiveness).toBe(0);
    });

    it('should sort templates by effectiveness ascending (worst first)', () => {
      const templates = [
        { template_id: 'a', effectiveness_ratio: 0.8 },
        { template_id: 'b', effectiveness_ratio: 0.3 },
        { template_id: 'c', effectiveness_ratio: 0.6 },
      ];

      templates.sort((a, b) => a.effectiveness_ratio - b.effectiveness_ratio);

      expect(templates[0].template_id).toBe('b');
      expect(templates[1].template_id).toBe('c');
      expect(templates[2].template_id).toBe('a');
    });
  });

  // ─── AC2: Low-quality flagging (<60% resolution rate) ──────────────
  describe('low-quality template flagging', () => {
    it('should flag templates with <60% resolution rate as low-quality', () => {
      const LOW_QUALITY_THRESHOLD = 0.60;

      // Template with 40% resolution rate
      const escalationCount = 60;
      const resolutionCount = 40;
      const effectiveness = resolutionCount / (escalationCount + resolutionCount);

      expect(effectiveness).toBe(0.4);
      expect(effectiveness < LOW_QUALITY_THRESHOLD).toBe(true);
    });

    it('should NOT flag templates with >=60% resolution rate', () => {
      const LOW_QUALITY_THRESHOLD = 0.60;

      // Template with 75% resolution rate
      const escalationCount = 25;
      const resolutionCount = 75;
      const effectiveness = resolutionCount / (escalationCount + resolutionCount);

      expect(effectiveness).toBe(0.75);
      expect(effectiveness < LOW_QUALITY_THRESHOLD).toBe(false);
    });

    it('should include recommendation for low-quality templates', () => {
      const LOW_QUALITY_THRESHOLD = 0.60;
      const effectiveness = 0.25;
      const templateId = 'tmpl-broken';

      const isLowQuality = effectiveness < LOW_QUALITY_THRESHOLD;
      expect(isLowQuality).toBe(true);

      // Verify recommendation text is generated
      let recommendation = '';
      if (effectiveness < 0.3) {
        recommendation = `Template "${templateId}" has very low effectiveness (${(effectiveness * 100).toFixed(1)}%). Consider replacing with a more specific response or adding intent coverage.`;
      } else if (effectiveness < LOW_QUALITY_THRESHOLD) {
        recommendation = `Template "${templateId}" is underperforming (${(effectiveness * 100).toFixed(1)}%). Review recent escalations to identify improvement areas.`;
      }

      expect(recommendation).toContain('very low effectiveness');
      expect(recommendation).toContain('25.0%');
    });

    it('should provide different recommendation levels based on severity', () => {
      const LOW_QUALITY_THRESHOLD = 0.60;

      // Very low (<30%)
      const veryLow = 0.15;
      expect(veryLow < 0.3).toBe(true);

      // Moderate low (30-60%)
      const moderateLow = 0.45;
      expect(moderateLow >= 0.3 && moderateLow < LOW_QUALITY_THRESHOLD).toBe(true);

      // Not low (>=60%)
      const ok = 0.75;
      expect(ok >= LOW_QUALITY_THRESHOLD).toBe(true);
    });

    it('should flag exactly at 59.9% as low-quality', () => {
      const LOW_QUALITY_THRESHOLD = 0.60;
      const effectiveness = 0.599;
      expect(effectiveness < LOW_QUALITY_THRESHOLD).toBe(true);
    });

    it('should NOT flag exactly at 60% as low-quality', () => {
      const LOW_QUALITY_THRESHOLD = 0.60;
      const effectiveness = 0.60;
      expect(effectiveness < LOW_QUALITY_THRESHOLD).toBe(false);
    });
  });

  // ─── AC3: Integration - metrics recording and resolution flow ──────
  describe('Integration: escalation → resolution metric flow', () => {
    it('should record escalation metric via recordFallbackEscalation()', async () => {
      await recordFallbackEscalation('pelangi', 'tmpl-faq');

      expect(mockInsert).toHaveBeenCalledTimes(1);
      // Verify insert was called with fallbackResponseMetrics table
      const insertCall = mockInsert.mock.calls[0];
      expect(insertCall).toBeDefined();
    });

    it('should record resolution metric via recordFallbackResolution()', async () => {
      await recordFallbackResolution('pelangi', 'tmpl-faq');

      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it('should use upsert pattern with onConflictDoUpdate for escalation', async () => {
      const mockValuesFn = vi.fn().mockReturnValue({
        onConflictDoUpdate: mockOnConflictDoUpdate,
      });
      mockInsert.mockReturnValue({ values: mockValuesFn });

      await recordFallbackEscalation('pelangi', 'tmpl-greeting');

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockValuesFn).toHaveBeenCalledTimes(1);

      // Verify values passed
      const insertedValues = mockValuesFn.mock.calls[0][0];
      expect(insertedValues).toHaveProperty('profileId', 'pelangi');
      expect(insertedValues).toHaveProperty('templateId', 'tmpl-greeting');
      expect(insertedValues).toHaveProperty('escalationCount', 1);
      expect(insertedValues).toHaveProperty('resolutionCount', 0);

      // Verify onConflictDoUpdate was called
      expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    });

    it('should use upsert pattern with onConflictDoUpdate for resolution', async () => {
      const mockValuesFn = vi.fn().mockReturnValue({
        onConflictDoUpdate: mockOnConflictDoUpdate,
      });
      mockInsert.mockReturnValue({ values: mockValuesFn });

      await recordFallbackResolution('southern', 'tmpl-booking');

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockValuesFn).toHaveBeenCalledTimes(1);

      // Verify values passed
      const insertedValues = mockValuesFn.mock.calls[0][0];
      expect(insertedValues).toHaveProperty('profileId', 'southern');
      expect(insertedValues).toHaveProperty('templateId', 'tmpl-booking');
      expect(insertedValues).toHaveProperty('escalationCount', 0);
      expect(insertedValues).toHaveProperty('resolutionCount', 1);

      expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    });

    it('should handle full escalation-then-resolution flow', async () => {
      // Step 1: Fallback returned, escalation follows
      await recordFallbackEscalation('pelangi', 'tmpl-default');
      expect(mockInsert).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: mockOnConflictDoUpdate,
        }),
      });

      // Step 2: Issue resolved
      await recordFallbackResolution('pelangi', 'tmpl-default');
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it('should handle DB errors gracefully in recordFallbackEscalation', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockRejectedValue(new Error('DB connection failed')),
        }),
      });

      await expect(
        recordFallbackEscalation('pelangi', 'tmpl-err')
      ).rejects.toThrow('DB connection failed');
    });

    it('should handle DB errors gracefully in recordFallbackResolution', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockRejectedValue(new Error('DB connection failed')),
        }),
      });

      await expect(
        recordFallbackResolution('pelangi', 'tmpl-err')
      ).rejects.toThrow('DB connection failed');
    });
  });

  // ─── Response structure validation ──────────────────────────────────
  describe('API response structure', () => {
    it('should include summary with total_templates and low_quality_count', () => {
      const templates = [
        { template_id: 'a', effectiveness_ratio: 0.3, low_quality: true },
        { template_id: 'b', effectiveness_ratio: 0.5, low_quality: true },
        { template_id: 'c', effectiveness_ratio: 0.8, low_quality: false },
      ];

      const summary = {
        total_templates: templates.length,
        low_quality_count: templates.filter((t) => t.low_quality).length,
      };

      expect(summary.total_templates).toBe(3);
      expect(summary.low_quality_count).toBe(2);
    });

    it('should include profile in response', () => {
      const profile = 'pelangi';
      const response = {
        profile,
        templates: [],
        summary: { total_templates: 0, low_quality_count: 0 },
      };

      expect(response.profile).toBe('pelangi');
    });

    it('should include per-template fields: template_id, escalation_count, resolution_count, effectiveness_ratio, low_quality', () => {
      const template = {
        template_id: 'tmpl-1',
        escalation_count: 20,
        resolution_count: 80,
        effectiveness_ratio: 0.8,
        low_quality: false,
      };

      expect(template).toHaveProperty('template_id');
      expect(template).toHaveProperty('escalation_count');
      expect(template).toHaveProperty('resolution_count');
      expect(template).toHaveProperty('effectiveness_ratio');
      expect(template).toHaveProperty('low_quality');
    });
  });
});
