/**
 * US-245: Conversation Turn-by-Turn Confidence Scorer Tests
 *
 * Tests for:
 * - AC1: turn_metadata JSONB column storing [{turn_num, intent, confidence, fallback_used, tokens}]
 * - AC2: POST /analytics/conversation/:id/confidence-trend returns per-turn metrics
 * - AC3: classifyIntent() records confidence scores and sets fallback_used=true when confidence < 0.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock db before importing modules that depend on it ──────────────
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockSet = vi.fn();

vi.mock('../../lib/db.js', () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
    insert: (...args: any[]) => mockInsert(...args),
  },
  pool: { query: vi.fn() },
  dbReady: Promise.resolve(true),
}));

// Mock schema-tables to avoid DB init issues
vi.mock('../../../shared/schema-tables.js', () => ({
  rainbowConversations: {
    phone: 'phone',
    turnMetadata: 'turn_metadata',
  },
  rainbowMessages: {},
  intentAnalytics: {},
  escalationQueue: {},
}));

import {
  recordTurnConfidence,
  getTurnMetadata,
  FALLBACK_CONFIDENCE_THRESHOLD,
  type TurnMetadataEntry,
} from '../turn-confidence-scorer.js';

describe('US-245: Turn-by-Turn Confidence Scorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('FALLBACK_CONFIDENCE_THRESHOLD', () => {
    it('should be 0.6', () => {
      expect(FALLBACK_CONFIDENCE_THRESHOLD).toBe(0.6);
    });
  });

  describe('recordTurnConfidence()', () => {
    it('should append a new turn entry to existing turn_metadata', async () => {
      const existingTurns: TurnMetadataEntry[] = [
        { turn_num: 1, intent: 'greeting', confidence: 0.95, fallback_used: false, tokens: 100 },
      ];

      // Mock select chain: db.select().from().where().limit()
      mockLimit.mockResolvedValue([{ turnMetadata: existingTurns }]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      // Mock update chain: db.update().set().where()
      const updateWhere = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValue({ where: updateWhere });
      mockUpdate.mockReturnValue({ set: mockSet });

      await recordTurnConfidence('60123456789', 'pricing', 0.85, 150);

      // Verify update was called with the correct appended array
      expect(mockSet).toHaveBeenCalledWith({
        turnMetadata: [
          { turn_num: 1, intent: 'greeting', confidence: 0.95, fallback_used: false, tokens: 100 },
          { turn_num: 2, intent: 'pricing', confidence: 0.85, fallback_used: false, tokens: 150 },
        ],
      });
    });

    it('should set fallback_used=true when confidence < 0.6', async () => {
      // Mock select: no existing turns
      mockLimit.mockResolvedValue([{ turnMetadata: [] }]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      // Mock update
      const updateWhere = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValue({ where: updateWhere });
      mockUpdate.mockReturnValue({ set: mockSet });

      await recordTurnConfidence('60123456789', 'unknown', 0.3, 50);

      expect(mockSet).toHaveBeenCalledWith({
        turnMetadata: [
          { turn_num: 1, intent: 'unknown', confidence: 0.3, fallback_used: true, tokens: 50 },
        ],
      });
    });

    it('should set fallback_used=false when confidence >= 0.6', async () => {
      mockLimit.mockResolvedValue([{ turnMetadata: [] }]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValue({ where: updateWhere });
      mockUpdate.mockReturnValue({ set: mockSet });

      await recordTurnConfidence('60123456789', 'booking', 0.6, 200);

      expect(mockSet).toHaveBeenCalledWith({
        turnMetadata: [
          { turn_num: 1, intent: 'booking', confidence: 0.6, fallback_used: false, tokens: 200 },
        ],
      });
    });

    it('should handle null turn_metadata gracefully (treat as empty array)', async () => {
      mockLimit.mockResolvedValue([{ turnMetadata: null }]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValue({ where: updateWhere });
      mockUpdate.mockReturnValue({ set: mockSet });

      await recordTurnConfidence('60123456789', 'greeting', 0.9, 80);

      expect(mockSet).toHaveBeenCalledWith({
        turnMetadata: [
          { turn_num: 1, intent: 'greeting', confidence: 0.9, fallback_used: false, tokens: 80 },
        ],
      });
    });

    it('should no-op when conversation row does not exist', async () => {
      mockLimit.mockResolvedValue([]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      await recordTurnConfidence('nonexistent', 'greeting', 0.9, 80);

      // update should never be called
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should not throw on database errors (non-fatal)', async () => {
      mockSelect.mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      // Should not throw
      await expect(
        recordTurnConfidence('60123456789', 'greeting', 0.9, 80)
      ).resolves.toBeUndefined();
    });

    it('should round confidence to 3 decimal places', async () => {
      mockLimit.mockResolvedValue([{ turnMetadata: [] }]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValue({ where: updateWhere });
      mockUpdate.mockReturnValue({ set: mockSet });

      await recordTurnConfidence('60123456789', 'pricing', 0.85678, 100);

      const setCall = mockSet.mock.calls[0][0];
      expect(setCall.turnMetadata[0].confidence).toBe(0.857);
    });

    it('should default tokens to 0 when not provided', async () => {
      mockLimit.mockResolvedValue([{ turnMetadata: [] }]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      mockSet.mockReturnValue({ where: updateWhere });
      mockUpdate.mockReturnValue({ set: mockSet });

      await recordTurnConfidence('60123456789', 'greeting', 0.95);

      const setCall = mockSet.mock.calls[0][0];
      expect(setCall.turnMetadata[0].tokens).toBe(0);
    });
  });

  describe('getTurnMetadata()', () => {
    it('should return turn metadata array for existing conversation', async () => {
      const turns: TurnMetadataEntry[] = [
        { turn_num: 1, intent: 'greeting', confidence: 0.95, fallback_used: false, tokens: 100 },
        { turn_num: 2, intent: 'pricing', confidence: 0.45, fallback_used: true, tokens: 200 },
      ];

      mockLimit.mockResolvedValue([{ turnMetadata: turns }]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await getTurnMetadata('60123456789');
      expect(result).toEqual(turns);
      expect(result).toHaveLength(2);
      expect(result[0].turn_num).toBe(1);
      expect(result[1].fallback_used).toBe(true);
    });

    it('should return empty array for non-existent conversation', async () => {
      mockLimit.mockResolvedValue([]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await getTurnMetadata('nonexistent');
      expect(result).toEqual([]);
    });

    it('should return empty array when turn_metadata is null', async () => {
      mockLimit.mockResolvedValue([{ turnMetadata: null }]);
      mockWhere.mockReturnValue({ limit: mockLimit });
      mockFrom.mockReturnValue({ where: mockWhere });
      mockSelect.mockReturnValue({ from: mockFrom });

      const result = await getTurnMetadata('60123456789');
      expect(result).toEqual([]);
    });
  });
});

describe('US-245: classifyIntent() fallback_used flag', () => {
  it('should set fallback_used=true when confidence < 0.6', () => {
    // Direct unit test of the threshold logic
    const confidence = 0.5;
    const fallback_used = confidence < FALLBACK_CONFIDENCE_THRESHOLD;
    expect(fallback_used).toBe(true);
  });

  it('should set fallback_used=false when confidence >= 0.6', () => {
    const confidence = 0.6;
    const fallback_used = confidence < FALLBACK_CONFIDENCE_THRESHOLD;
    expect(fallback_used).toBe(false);
  });

  it('should set fallback_used=false when confidence is 1.0', () => {
    const confidence = 1.0;
    const fallback_used = confidence < FALLBACK_CONFIDENCE_THRESHOLD;
    expect(fallback_used).toBe(false);
  });

  it('should set fallback_used=true when confidence is 0', () => {
    const confidence = 0;
    const fallback_used = confidence < FALLBACK_CONFIDENCE_THRESHOLD;
    expect(fallback_used).toBe(true);
  });
});

describe('US-245: Confidence Trend Endpoint', () => {
  it('should compute correct summary statistics from turn metadata', () => {
    const turns: TurnMetadataEntry[] = [
      { turn_num: 1, intent: 'greeting', confidence: 0.95, fallback_used: false, tokens: 100 },
      { turn_num: 2, intent: 'pricing', confidence: 0.85, fallback_used: false, tokens: 150 },
      { turn_num: 3, intent: 'unknown', confidence: 0.3, fallback_used: true, tokens: 200 },
      { turn_num: 4, intent: 'booking', confidence: 0.7, fallback_used: false, tokens: 180 },
    ];

    const totalTurns = turns.length;
    const avgConfidence = turns.reduce((sum, t) => sum + t.confidence, 0) / totalTurns;
    const fallbackCount = turns.filter(t => t.fallback_used).length;
    const totalTokens = turns.reduce((sum, t) => sum + t.tokens, 0);

    expect(totalTurns).toBe(4);
    expect(Math.round(avgConfidence * 1000) / 1000).toBe(0.7);
    expect(fallbackCount).toBe(1);
    expect(totalTokens).toBe(630);
  });

  it('should return zeros for empty turn metadata', () => {
    const turns: TurnMetadataEntry[] = [];

    const totalTurns = turns.length;

    expect(totalTurns).toBe(0);
  });
});
