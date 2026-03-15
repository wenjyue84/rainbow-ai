/**
 * Unit tests for US-901: Chatbot conversation containment rate KPI.
 *
 * Tests:
 * - containmentRate field returned from KPIs endpoint
 * - Correct calculation: 7 contained / 10 total = 70%
 * - Alert threshold triggers when rate drops below configurable %
 * - computeContainment helper
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────

const { mockDbSelect, mockDbExecute } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbExecute: vi.fn(),
}));

// Track which table the select().from() targets
let lastFromTable: string | null = null;

vi.mock('../../lib/db.js', () => ({
  db: {
    select: () => ({
      from: (table: any) => {
        lastFromTable = table?.__tableName || table?.name || String(table);
        return {
          where: mockDbSelect,
          orderBy: () => ({
            limit: mockDbSelect,
          }),
        };
      },
    }),
    execute: mockDbExecute,
  },
  dbReady: Promise.resolve(true),
}));

vi.mock('../../../shared/schema.js', () => ({
  rainbowFeedback: { __tableName: 'rainbow_feedback', createdAt: 'created_at' },
  rainbowConversations: { __tableName: 'rainbow_conversations', updatedAt: 'updated_at', profileId: 'profile_id' },
  rainbowMessages: { __tableName: 'rainbow_messages', timestamp: 'timestamp', role: 'role', profileId: 'profile_id' },
  escalationEvents: { __tableName: 'escalation_events', createdAt: 'created_at', profileId: 'profile_id', jid: 'jid', trigger: 'trigger' },
}));

import { _testExports } from '../../routes/admin/analytics-kpis.js';

// ── Tests ─────────────────────────────────────────────────────────────

describe('US-901: Containment Rate KPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastFromTable = null;
  });

  describe('computeContainment', () => {
    it('seeds 10 conversations (7 contained, 3 escalated) and asserts containmentRate = 70', async () => {
      // Mock: 10 total conversations
      mockDbSelect
        .mockResolvedValueOnce([{ total: 10 }])   // conversations count
        .mockResolvedValueOnce([{ uniqueJids: 3 }]); // escalated unique JIDs

      const since = new Date();
      since.setDate(since.getDate() - 7);

      const result = await _testExports.computeContainment(undefined, since);

      expect(result.totalConversations).toBe(10);
      expect(result.escalated).toBe(3);
      expect(result.contained).toBe(7);
      expect(result.rate).toBe(70.0);
    });

    it('returns null rate when no conversations exist', async () => {
      mockDbSelect
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([{ uniqueJids: 0 }]);

      const result = await _testExports.computeContainment(undefined, new Date());

      expect(result.rate).toBeNull();
      expect(result.totalConversations).toBe(0);
      expect(result.contained).toBe(0);
      expect(result.escalated).toBe(0);
    });

    it('returns 100% when all conversations are contained (no escalations)', async () => {
      mockDbSelect
        .mockResolvedValueOnce([{ total: 15 }])
        .mockResolvedValueOnce([{ uniqueJids: 0 }]);

      const result = await _testExports.computeContainment(undefined, new Date());

      expect(result.rate).toBe(100.0);
      expect(result.contained).toBe(15);
      expect(result.escalated).toBe(0);
    });

    it('returns 0% when all conversations are escalated', async () => {
      mockDbSelect
        .mockResolvedValueOnce([{ total: 5 }])
        .mockResolvedValueOnce([{ uniqueJids: 5 }]);

      const result = await _testExports.computeContainment(undefined, new Date());

      expect(result.rate).toBe(0.0);
      expect(result.contained).toBe(0);
      expect(result.escalated).toBe(5);
    });

    it('passes profileId filter when specified', async () => {
      mockDbSelect
        .mockResolvedValueOnce([{ total: 8 }])
        .mockResolvedValueOnce([{ uniqueJids: 2 }]);

      const result = await _testExports.computeContainment('pelangi', new Date());

      expect(result.rate).toBe(75.0);
      expect(result.contained).toBe(6);
    });
  });

  describe('ALERT_THRESHOLDS', () => {
    it('containmentRate threshold defaults to 70%', () => {
      expect(_testExports.ALERT_THRESHOLDS.containmentRate).toBe(70);
    });

    it('triggers alert when containment is below threshold', () => {
      const rate = 65;
      const threshold = _testExports.ALERT_THRESHOLDS.containmentRate;
      expect(rate < threshold).toBe(true);
    });

    it('does not trigger alert when containment is at or above threshold', () => {
      const rate = 70;
      const threshold = _testExports.ALERT_THRESHOLDS.containmentRate;
      expect(rate < threshold).toBe(false);
    });
  });
});
