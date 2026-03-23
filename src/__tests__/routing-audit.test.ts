/**
 * routing-audit.test.ts — Tests for Routing Integrity Audit (US-343)
 *
 * Tests verify:
 * 1. Zero cross-profile violations when source === target
 * 2. Violations correctly detected when source !== target
 * 3. Concurrent message load produces accurate metrics within 1% error
 * 4. logRoutingDecision fire-and-forget never throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing the module under test
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
vi.mock('../lib/db.js', () => ({
  db: { insert: (...args: any[]) => mockInsert(...args) },
}));

vi.mock('../lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { logRoutingDecision, type RoutingDecision } from '../routes/middleware/routing-audit.js';

describe('US-343: Live Message Routing Integrity Audit', () => {
  let capturedValues: any[] = [];

  beforeEach(() => {
    capturedValues = [];
    mockInsert.mockImplementation(() => ({
      values: vi.fn().mockImplementation((val: any) => {
        capturedValues.push(val);
        return Promise.resolve();
      }),
    }));
  });

  // ─── AC3: Zero cross-profile routing under normal conditions ──────────────

  it('marks is_violation=false when source_profile === target_profile', async () => {
    const decision: RoutingDecision = {
      messageId: 'msg-001',
      phone: '+60123456789',
      sourceProfile: 'pelangi',
      targetProfile: 'pelangi',
      classifierMatchResult: 'booking.inquiry',
      classifierConfidence: 0.95,
    };

    await logRoutingDecision(decision);

    expect(capturedValues).toHaveLength(1);
    expect(capturedValues[0].isViolation).toBe(false);
    expect(capturedValues[0].sourceProfile).toBe('pelangi');
    expect(capturedValues[0].targetProfile).toBe('pelangi');
  });

  // ─── AC3: Violations correctly logged with profile_id match verification ──

  it('marks is_violation=true when source_profile !== target_profile', async () => {
    const decision: RoutingDecision = {
      messageId: 'msg-002',
      phone: '+60198765432',
      sourceProfile: 'pelangi',
      targetProfile: 'makan',
      classifierMatchResult: 'menu.inquiry',
      classifierConfidence: 0.72,
    };

    await logRoutingDecision(decision);

    expect(capturedValues).toHaveLength(1);
    expect(capturedValues[0].isViolation).toBe(true);
    expect(capturedValues[0].sourceProfile).toBe('pelangi');
    expect(capturedValues[0].targetProfile).toBe('makan');
    expect(capturedValues[0].classifierMatchResult).toBe('menu.inquiry');
    expect(capturedValues[0].classifierConfidence).toBe(0.72);
  });

  // ─── AC3: Concurrent message load with accurate metrics ───────────────────

  it('handles concurrent messages and metrics are accurate within 1% error', async () => {
    const totalMessages = 200;
    const expectedViolationCount = 20; // 10% violation rate
    const decisions: RoutingDecision[] = [];

    for (let i = 0; i < totalMessages; i++) {
      const isViolation = i < expectedViolationCount;
      decisions.push({
        messageId: `msg-concurrent-${i}`,
        phone: `+6012345${String(i).padStart(4, '0')}`,
        sourceProfile: 'pelangi',
        targetProfile: isViolation ? 'makan' : 'pelangi',
        classifierMatchResult: isViolation ? 'menu.inquiry' : 'booking.inquiry',
        classifierConfidence: isViolation ? 0.45 : 0.92,
      });
    }

    // Fire all concurrently
    await Promise.all(decisions.map(d => logRoutingDecision(d)));

    expect(capturedValues).toHaveLength(totalMessages);

    const violationCount = capturedValues.filter((v: any) => v.isViolation === true).length;
    const nonViolationCount = capturedValues.filter((v: any) => v.isViolation === false).length;
    const actualRate = violationCount / totalMessages;
    const expectedRate = expectedViolationCount / totalMessages;

    // Metrics accurate within 1% error
    expect(Math.abs(actualRate - expectedRate)).toBeLessThanOrEqual(0.01);
    expect(violationCount).toBe(expectedViolationCount);
    expect(nonViolationCount).toBe(totalMessages - expectedViolationCount);
  });

  // ─── Fire-and-forget: DB errors never throw ───────────────────────────────

  it('swallows db errors silently (fire-and-forget)', async () => {
    mockInsert.mockImplementation(() => ({
      values: vi.fn().mockRejectedValue(new Error('connection lost')),
    }));

    const decision: RoutingDecision = {
      messageId: 'msg-err',
      phone: '+60100000000',
      sourceProfile: 'pelangi',
      targetProfile: 'southern',
    };

    // Should not throw
    await expect(logRoutingDecision(decision)).resolves.toBeUndefined();
  });

  // ─── Null handling for optional fields ─────────────────────────────────────

  it('stores null for missing classifier fields', async () => {
    const decision: RoutingDecision = {
      messageId: 'msg-null',
      phone: '+60111111111',
      sourceProfile: 'pelangi',
      targetProfile: 'pelangi',
    };

    await logRoutingDecision(decision);

    expect(capturedValues).toHaveLength(1);
    expect(capturedValues[0].classifierMatchResult).toBeNull();
    expect(capturedValues[0].classifierConfidence).toBeNull();
    expect(capturedValues[0].isViolation).toBe(false);
  });
});
