/**
 * Integration tests for Conversation Message Timestamp Integrity Validator (US-644)
 *
 * Tests:
 * 1. validateMessageOrdering generator yields correct warnings for reversed-timestamp messages
 * 2. Reports specific message pair IDs (before/after) in each warning
 * 3. Health check (checkConversationTimestampIntegrity) detects ordering issues via mocked pool
 * 4. Health check reports 100% healthy when all messages are in order
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateMessageOrdering,
  checkConversationTimestampIntegrity,
} from '../../src/lib/conversation-timestamp-validator.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMessage(id: number, timestampMs: number, phone = '60100000001') {
  return { id, timestamp: new Date(timestampMs), phone };
}

// ─── Unit: validateMessageOrdering generator ──────────────────────────────────

describe('validateMessageOrdering', () => {
  it('yields no warnings when messages are in ascending timestamp order', () => {
    const messages = [
      makeMessage(101, 1_000_000),
      makeMessage(102, 2_000_000),
      makeMessage(103, 3_000_000),
      makeMessage(104, 4_000_000),
      makeMessage(105, 5_000_000),
    ];

    const warnings = [...validateMessageOrdering(messages)];
    expect(warnings).toHaveLength(0);
  });

  it('yields warnings for each out-of-order consecutive pair in reversed sequence', () => {
    // 5 messages with timestamps in reverse order — 4 violations (each pair)
    const now = Date.now();
    const messages = [
      makeMessage(101, now + 5000),
      makeMessage(102, now + 4000),
      makeMessage(103, now + 3000),
      makeMessage(104, now + 2000),
      makeMessage(105, now + 1000),
    ];

    const warnings = [...validateMessageOrdering(messages)];

    // 4 consecutive out-of-order pairs: (101,102), (102,103), (103,104), (104,105)
    expect(warnings).toHaveLength(4);
  });

  it('reports correct message pair IDs for each violation', () => {
    const base = new Date('2026-04-14T09:00:00Z').getTime();
    // Message 456 has timestamp BEFORE message 123 — simulates the AC example
    const messages = [
      makeMessage(123, base + 60 * 60 * 1000), // 10:00Z
      makeMessage(456, base),                   // 09:00Z — out of order!
    ];

    const warnings = [...validateMessageOrdering(messages)];

    expect(warnings).toHaveLength(1);
    expect(warnings[0].prevMessageId).toBe(123);
    expect(warnings[0].messageId).toBe(456);
    expect(warnings[0].prevMessageTimestamp).toBe(new Date(base + 60 * 60 * 1000).toISOString());
    expect(warnings[0].messageTimestamp).toBe(new Date(base).toISOString());
  });

  it('yields no warnings for a single message', () => {
    const messages = [makeMessage(1, Date.now())];
    const warnings = [...validateMessageOrdering(messages)];
    expect(warnings).toHaveLength(0);
  });

  it('yields no warnings for an empty array', () => {
    const warnings = [...validateMessageOrdering([])];
    expect(warnings).toHaveLength(0);
  });

  it('does not flag equal timestamps as violations', () => {
    const ts = Date.now();
    const messages = [
      makeMessage(1, ts),
      makeMessage(2, ts), // equal — not a violation
      makeMessage(3, ts + 1000),
    ];
    const warnings = [...validateMessageOrdering(messages)];
    expect(warnings).toHaveLength(0);
  });

  it('detects single out-of-order message in an otherwise ordered sequence', () => {
    const base = Date.now();
    const messages = [
      makeMessage(10, base),
      makeMessage(11, base + 1000),
      makeMessage(12, base + 500), // out-of-order: ts before message 11
      makeMessage(13, base + 3000),
    ];

    const warnings = [...validateMessageOrdering(messages)];
    expect(warnings).toHaveLength(1);
    expect(warnings[0].messageId).toBe(12);
    expect(warnings[0].prevMessageId).toBe(11);
  });
});

// ─── Integration: checkConversationTimestampIntegrity ─────────────────────────

describe('checkConversationTimestampIntegrity (startup health check)', () => {
  let mockPool: any;

  beforeEach(async () => {
    // Mock the db module's pool
    mockPool = {
      query: vi.fn(),
    };
    vi.doMock('../../src/lib/db.js', () => ({
      pool: mockPool,
      db: {},
      dbReady: Promise.resolve(true),
      healthCheck: vi.fn().mockResolvedValue(true),
      initDb: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns 100% healthy when all conversations have ascending timestamps', async () => {
    const base = new Date('2026-04-14T08:00:00Z').getTime();

    mockPool.query
      // Distinct profiles query
      .mockResolvedValueOnce({ rows: [{ profile_id: 'pelangi' }] })
      // Sample conversations for 'pelangi'
      .mockResolvedValueOnce({ rows: [{ phone: '60100000001' }] })
      // Messages for '60100000001' — in order
      .mockResolvedValueOnce({
        rows: [
          { id: 1, timestamp: new Date(base), phone: '60100000001' },
          { id: 2, timestamp: new Date(base + 1000), phone: '60100000001' },
          { id: 3, timestamp: new Date(base + 2000), phone: '60100000001' },
        ],
      });

    const { checkConversationTimestampIntegrity: check } = await import(
      '../../src/lib/conversation-timestamp-validator.js'
    );
    const report = await check();

    expect(report.total).toBe(1);
    expect(report.healthy).toBe(1);
    expect(report.unhealthy).toBe(0);
    expect(report.healthPercent).toBe(100);
    expect(report.hasIssues).toBe(false);
  });

  it('detects ordering issues and reports unhealthy conversation in startup health check', async () => {
    const base = new Date('2026-04-14T09:00:00Z').getTime();

    mockPool.query
      // Distinct profiles
      .mockResolvedValueOnce({ rows: [{ profile_id: 'pelangi' }] })
      // Sample conversations
      .mockResolvedValueOnce({ rows: [{ phone: '60100000002' }] })
      // Messages with reversed timestamps — 5 messages in reverse order
      .mockResolvedValueOnce({
        rows: [
          { id: 201, timestamp: new Date(base + 5000), phone: '60100000002' },
          { id: 202, timestamp: new Date(base + 4000), phone: '60100000002' },
          { id: 203, timestamp: new Date(base + 3000), phone: '60100000002' },
          { id: 204, timestamp: new Date(base + 2000), phone: '60100000002' },
          { id: 205, timestamp: new Date(base + 1000), phone: '60100000002' },
        ],
      });

    const { checkConversationTimestampIntegrity: check } = await import(
      '../../src/lib/conversation-timestamp-validator.js'
    );
    const report = await check();

    expect(report.total).toBe(1);
    expect(report.unhealthy).toBe(1);
    expect(report.healthy).toBe(0);
    expect(report.healthPercent).toBe(0);
    expect(report.hasIssues).toBe(true);
  });

  it('returns empty report with 100% health when no conversations exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // no profiles

    const { checkConversationTimestampIntegrity: check } = await import(
      '../../src/lib/conversation-timestamp-validator.js'
    );
    const report = await check();

    expect(report.total).toBe(0);
    expect(report.healthy).toBe(0);
    expect(report.healthPercent).toBe(100);
    expect(report.hasIssues).toBe(false);
  });
});
