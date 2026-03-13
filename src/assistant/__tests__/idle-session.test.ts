/**
 * Unit tests for US-444: Context-aware idle session timeout.
 *
 * Verifies:
 * - A message arriving 9 hours after the previous one (with default 8h timeout)
 *   triggers idle detection and resets the conversation
 * - A message within the timeout window does NOT trigger idle detection
 * - No existing conversation returns isIdle: false
 * - No messages in conversation returns isIdle: false
 * - Zero timeout disables idle detection
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoist mocks ──────────────────────────────────────────────────────
const { mockDbExecute, mockEnsureDb } = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockEnsureDb: vi.fn(),
}));

vi.mock('../../lib/db.js', () => ({
  db: { execute: mockDbExecute },
  dbReady: Promise.resolve(true),
}));

vi.mock('../conversation-db.js', () => ({
  ensureDb: mockEnsureDb,
  conversationKey: (phone: string, _bsuid?: string) => phone.replace(/\D/g, '') || phone,
}));

// Import after mocks
import { checkIdleSession } from '../idle-session.js';

const PHONE = '60123456789';
const PUSH_NAME = 'Ali';

describe('Idle session timeout (US-444)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureDb.mockResolvedValue(true);
  });

  it('detects idle session when last message is 9h old (default 8h timeout)', async () => {
    const now = Date.now();
    const nineHoursAgo = new Date(now - 9 * 60 * 60 * 1000);

    // First call: SELECT query returns conversation with old last message
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ push_name: PUSH_NAME, status: 'active', last_msg_at: nineHoursAgo }],
    });
    // Second call: UPDATE status='ended'
    mockDbExecute.mockResolvedValueOnce({ rowCount: 1 });
    // Third call: UPDATE created_at, status='active'
    mockDbExecute.mockResolvedValueOnce({ rowCount: 1 });

    const result = await checkIdleSession(PHONE, 8, undefined, now);

    expect(result.isIdle).toBe(true);
    expect(result.pushName).toBe(PUSH_NAME);

    // Verify DB was called: SELECT + 2x UPDATE
    expect(mockDbExecute).toHaveBeenCalledTimes(3);
  });

  it('does NOT detect idle when last message is within timeout window', async () => {
    const now = Date.now();
    const fiveHoursAgo = new Date(now - 5 * 60 * 60 * 1000);

    mockDbExecute.mockResolvedValueOnce({
      rows: [{ push_name: PUSH_NAME, status: 'active', last_msg_at: fiveHoursAgo }],
    });

    const result = await checkIdleSession(PHONE, 8, undefined, now);

    expect(result.isIdle).toBe(false);
    // Only the SELECT query should have run — no UPDATEs
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });

  it('returns isIdle=false when no conversation exists', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkIdleSession(PHONE, 8);

    expect(result.isIdle).toBe(false);
    expect(result.pushName).toBeNull();
  });

  it('returns isIdle=false when conversation has no messages', async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ push_name: PUSH_NAME, status: 'active', last_msg_at: null }],
    });

    const result = await checkIdleSession(PHONE, 8);

    expect(result.isIdle).toBe(false);
    expect(result.pushName).toBe(PUSH_NAME);
  });

  it('disables idle detection when timeout is 0', async () => {
    const result = await checkIdleSession(PHONE, 0);

    expect(result.isIdle).toBe(false);
    // No DB call should be made
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('returns isIdle=false when DB is unavailable', async () => {
    mockEnsureDb.mockResolvedValue(false);

    const result = await checkIdleSession(PHONE, 8);

    expect(result.isIdle).toBe(false);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('handles DB errors gracefully', async () => {
    mockDbExecute.mockRejectedValueOnce(new Error('connection refused'));

    const result = await checkIdleSession(PHONE, 8);

    expect(result.isIdle).toBe(false);
    expect(result.pushName).toBeNull();
  });

  it('detects idle at exactly the boundary (8h + 1ms)', async () => {
    const now = Date.now();
    const justOverEightHours = new Date(now - 8 * 60 * 60 * 1000 - 1);

    mockDbExecute.mockResolvedValueOnce({
      rows: [{ push_name: PUSH_NAME, status: 'active', last_msg_at: justOverEightHours }],
    });
    mockDbExecute.mockResolvedValueOnce({ rowCount: 1 });
    mockDbExecute.mockResolvedValueOnce({ rowCount: 1 });

    const result = await checkIdleSession(PHONE, 8, undefined, now);

    expect(result.isIdle).toBe(true);
  });

  it('does NOT detect idle at exactly the boundary (8h - 1ms)', async () => {
    const now = Date.now();
    const justUnderEightHours = new Date(now - 8 * 60 * 60 * 1000 + 1);

    mockDbExecute.mockResolvedValueOnce({
      rows: [{ push_name: PUSH_NAME, status: 'active', last_msg_at: justUnderEightHours }],
    });

    const result = await checkIdleSession(PHONE, 8, undefined, now);

    expect(result.isIdle).toBe(false);
  });
});
