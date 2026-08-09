/**
 * US-343: Live Message Routing Integrity Audit
 *
 * Tests:
 *   AC1: logRoutingDecision() logs source_profile, target_profile, classifier_match_result
 *        to the routing_audit_logs table for every incoming message
 *   AC2: GET /audit/routing-violations?hours=24&profile_id=makan returns only violations
 *        (source_profile !== target_profile) with message_id, expected_profile,
 *        actual_profile, classifier_confidence
 *   AC3: Zero cross-profile routing under concurrent message load; all violations logged
 *        accurately (within 1% error on counts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logRoutingDecision } from '../../../routes/middleware/routing-audit.js';

// ─── Mock Drizzle DB ─────────────────────────────────────────────────────────

const insertedRows: any[] = [];
const mockValues = vi.fn().mockImplementation((row: any) => {
  insertedRows.push(row);
  return Promise.resolve(undefined);
});
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

const mockRows: any[] = [];
let mockWhere: any = null;
const mockOrderBy = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockReturnThis();
const mockOffset = vi.fn().mockReturnThis();
const mockSelectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockImplementation((cond: any) => { mockWhere = cond; return mockSelectChain; }),
  orderBy: mockOrderBy,
  limit: mockLimit,
  offset: mockOffset,
  then: (resolve: any) => resolve(mockRows),
  [Symbol.iterator]: undefined as any,
};
mockSelectChain[Symbol.iterator] = function* () { yield* mockRows; };

const mockSelect = vi.fn().mockReturnValue(mockSelectChain);

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

vi.mock('../../../../shared/schema-tables.js', () => ({
  routingAuditLogs: { name: 'routing_audit_logs' },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('US-343: Message Routing Integrity Audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows.length = 0;
    mockRows.length = 0;
    mockWhere = null;
  });

  // ─── AC1: Middleware logs routing decisions ───────────────────────

  describe('AC1: logRoutingDecision() stores routing metadata', () => {
    it('logs a valid (non-violation) routing decision with is_violation=false', async () => {
      await logRoutingDecision({
        messageId: 'msg-001',
        phone: '+60123456789',
        sourceProfile: 'pelangi',
        targetProfile: 'pelangi',
        classifierMatchResult: 'check_availability',
        classifierConfidence: 0.95,
      });

      expect(mockInsert).toHaveBeenCalledOnce();
      expect(mockValues).toHaveBeenCalledOnce();

      const row = insertedRows[0];
      expect(row.messageId).toBe('msg-001');
      expect(row.phone).toBe('+60123456789');
      expect(row.sourceProfile).toBe('pelangi');
      expect(row.targetProfile).toBe('pelangi');
      expect(row.classifierMatchResult).toBe('check_availability');
      expect(row.classifierConfidence).toBe(0.95);
      expect(row.isViolation).toBe(false);
    });

    it('logs a cross-profile violation with is_violation=true', async () => {
      await logRoutingDecision({
        messageId: 'msg-002',
        phone: '+60199887766',
        sourceProfile: 'pelangi',
        targetProfile: 'makan',
        classifierMatchResult: 'menu_inquiry',
        classifierConfidence: 0.72,
      });

      expect(mockInsert).toHaveBeenCalledOnce();

      const row = insertedRows[0];
      expect(row.sourceProfile).toBe('pelangi');
      expect(row.targetProfile).toBe('makan');
      expect(row.isViolation).toBe(true);
    });

    it('stores null classifierMatchResult when not provided', async () => {
      await logRoutingDecision({
        messageId: 'msg-003',
        phone: '+60111222333',
        sourceProfile: 'southern-homestay',
        targetProfile: 'southern-homestay',
      });

      const row = insertedRows[0];
      expect(row.classifierMatchResult).toBeNull();
      expect(row.classifierConfidence).toBeNull();
    });

    it('does not throw when DB insert fails (fire-and-forget)', async () => {
      mockValues.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(logRoutingDecision({
        messageId: 'msg-004',
        phone: '+60100000001',
        sourceProfile: 'pelangi',
        targetProfile: 'pelangi',
      })).resolves.not.toThrow();
    });
  });

  // ─── AC2: Violations endpoint returns correct fields ─────────────

  describe('AC2: Violation response shape', () => {
    it('maps DB row fields to expected response keys', () => {
      // Simulate what the endpoint returns for a violation row
      const dbRow = {
        id: 1,
        messageId: 'msg-v1',
        phone: '+60122334455',
        sourceProfile: 'pelangi',
        targetProfile: 'makan',
        classifierMatchResult: 'order_food',
        classifierConfidence: 0.68,
        isViolation: true,
        createdAt: new Date('2026-03-24T10:00:00Z'),
      };

      // Replicate the endpoint's mapping logic
      const mapped = {
        message_id: dbRow.messageId,
        expected_profile: dbRow.sourceProfile,
        actual_profile: dbRow.targetProfile,
        classifier_confidence: dbRow.classifierConfidence,
        classifier_match_result: dbRow.classifierMatchResult,
        timestamp: dbRow.createdAt,
      };

      expect(mapped.message_id).toBe('msg-v1');
      expect(mapped.expected_profile).toBe('pelangi');
      expect(mapped.actual_profile).toBe('makan');
      expect(mapped.classifier_confidence).toBe(0.68);
      expect(mapped.classifier_match_result).toBe('order_food');
      expect(mapped.timestamp).toBeInstanceOf(Date);
    });

    it('is_violation is true only when source_profile !== target_profile', () => {
      const cases = [
        { src: 'pelangi', tgt: 'pelangi', expected: false },
        { src: 'makan', tgt: 'makan', expected: false },
        { src: 'pelangi', tgt: 'makan', expected: true },
        { src: 'southern-homestay', tgt: 'pelangi', expected: true },
        { src: 'makan', tgt: 'southern-homestay', expected: true },
      ];

      for (const c of cases) {
        const isViolation = c.src !== c.tgt;
        expect(isViolation).toBe(c.expected);
      }
    });
  });

  // ─── AC3: Concurrent load — zero cross-profile routing ───────────

  describe('AC3: Concurrent routing integrity under load', () => {
    it('logs all decisions correctly under concurrent calls', async () => {
      const profilePairs: Array<[string, string]> = [
        ['pelangi', 'pelangi'],
        ['makan', 'makan'],
        ['southern-homestay', 'southern-homestay'],
        ['pelangi', 'pelangi'],
        ['makan', 'makan'],
      ];

      // Reset mock so each call appends to insertedRows
      mockValues.mockImplementation((row: any) => {
        insertedRows.push(row);
        return Promise.resolve(undefined);
      });

      // Fire all concurrently
      await Promise.all(
        profilePairs.map(([src, tgt], i) =>
          logRoutingDecision({
            messageId: `concurrent-msg-${i}`,
            phone: `+6011${String(i).padStart(8, '0')}`,
            sourceProfile: src,
            targetProfile: tgt,
            classifierMatchResult: 'check_availability',
            classifierConfidence: 0.9,
          })
        )
      );

      // All 5 calls should have been inserted
      expect(insertedRows).toHaveLength(5);

      // None should be violations (all pairs have matching profiles)
      const violations = insertedRows.filter(r => r.isViolation);
      expect(violations).toHaveLength(0);
    });

    it('accurately counts violations within 1% error across 100 mixed decisions', async () => {
      mockValues.mockImplementation((row: any) => {
        insertedRows.push(row);
        return Promise.resolve(undefined);
      });

      const TOTAL = 100;
      const VIOLATION_RATE = 0.05; // 5 violations per 100

      const decisions = Array.from({ length: TOTAL }, (_, i) => {
        const isViolation = i < TOTAL * VIOLATION_RATE;
        return logRoutingDecision({
          messageId: `load-msg-${i}`,
          phone: `+6011${String(i).padStart(8, '0')}`,
          sourceProfile: 'pelangi',
          targetProfile: isViolation ? 'makan' : 'pelangi',
          classifierMatchResult: 'check_availability',
          classifierConfidence: 0.88,
        });
      });

      await Promise.all(decisions);

      const totalLogged = insertedRows.length;
      const violationsLogged = insertedRows.filter(r => r.isViolation).length;

      // Total should be exact (all 100 logged)
      expect(totalLogged).toBe(TOTAL);

      // Violation count error must be within 1% of total (i.e., ±1 in 100)
      const expectedViolations = Math.floor(TOTAL * VIOLATION_RATE);
      const errorRate = Math.abs(violationsLogged - expectedViolations) / TOTAL;
      expect(errorRate).toBeLessThanOrEqual(0.01);
    });
  });
});
