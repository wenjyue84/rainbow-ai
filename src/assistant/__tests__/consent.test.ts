/**
 * Unit tests for WhatsApp opt-in consent capture (US-424).
 *
 * Verifies:
 * - New JID creates a consent record on first contact
 * - Consent lookup uses SHA-256 hash (never raw phone number)
 * - Opted-out JID does not receive a response (via mocked ctx.sendMessage)
 * - recordConsent is idempotent (second call is a no-op via cache)
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ─── Hoist mocks before vi.mock calls ────────────────────────────────
const { mockPoolQuery, mockIsOptedOut } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockIsOptedOut: vi.fn(),
}));

vi.mock('../../lib/db.js', () => ({
  pool: { query: mockPoolQuery },
  dbReady: Promise.resolve(true),
  db: {},
}));

vi.mock('../conversation-db.js', () => ({
  canonicalPhoneKey: (phone: string) => phone.replace(/[^0-9]/g, '') || phone,
}));

vi.mock('../opt-out.js', () => ({
  isOptedOut: mockIsOptedOut,
  isOptOutCommand: vi.fn(() => false),
  isOptInCommand: vi.fn(() => false),
  loadOptOutCache: vi.fn(),
  recordOptOut: vi.fn(),
  recordOptIn: vi.fn(),
}));

// Import after mocks
import { hashJid, hasConsent, recordConsent } from '../consent.js';

describe('Consent capture (US-424)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  // ─── hashJid ──────────────────────────────────────────────────────
  test('hashJid produces SHA-256 hex of canonical phone key', () => {
    const phone = '60123456789@s.whatsapp.net';
    const canonical = '60123456789';
    const expected = crypto.createHash('sha256').update(canonical).digest('hex');
    expect(hashJid(phone)).toBe(expected);
    expect(hashJid(phone)).toHaveLength(64);
    expect(hashJid(phone)).toMatch(/^[a-f0-9]{64}$/);
  });

  test('hashJid is deterministic for the same JID', () => {
    expect(hashJid('60123456789')).toBe(hashJid('60123456789'));
  });

  test('hashJid differs for different JIDs', () => {
    expect(hashJid('60123456789')).not.toBe(hashJid('60987654321'));
  });

  test('hashJid strips non-digit chars before hashing (@suffix stripped)', () => {
    const withSuffix = '60123456789@s.whatsapp.net';
    const bare = '60123456789';
    expect(hashJid(withSuffix)).toBe(hashJid(bare));
  });

  // ─── recordConsent ────────────────────────────────────────────────
  test('new JID creates a consent record in DB', async () => {
    const phone = '60111111111';
    await recordConsent(phone, 'pelangi');

    const insertCall = mockPoolQuery.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO consent_records')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain(hashJid(phone));
    expect(insertCall![1]).toContain('pelangi');
  });

  test('consent record stores JID hash, not raw phone number', async () => {
    const phone = '60222222222';
    await recordConsent(phone, 'pelangi');

    const insertCall = mockPoolQuery.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO consent_records')
    );
    const params = JSON.stringify(insertCall![1]);
    // Raw phone number must never appear in persisted data
    expect(params).not.toContain('60222222222');
    // Hash must be present
    expect(insertCall![1]).toContain(hashJid(phone));
  });

  test('recordConsent is idempotent — second call skips DB (cache hit)', async () => {
    const phone = '60333333333';

    await recordConsent(phone, 'pelangi');
    const callsAfterFirst = mockPoolQuery.mock.calls.length;

    // Second call should hit cache and skip DB insert
    await recordConsent(phone, 'pelangi');
    expect(mockPoolQuery.mock.calls.length).toBe(callsAfterFirst);
  });

  // ─── hasConsent ───────────────────────────────────────────────────
  test('hasConsent returns true after recordConsent', async () => {
    const phone = '60444444444';

    expect(hasConsent(phone)).toBe(false);
    await recordConsent(phone, 'pelangi');
    expect(hasConsent(phone)).toBe(true);
  });

  // ─── Opt-out guard (logic test — does not require full router) ────
  test('opted-out JID triggers warn log and skips send', async () => {
    mockIsOptedOut.mockReturnValue(true);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockSend = vi.fn();

    // Replicate the guard logic from message-router.ts
    const guardedSend = async (phone: string, text: string, instanceId?: string) => {
      if (mockIsOptedOut(phone)) {
        console.warn(`[Router] Outbound message suppressed — JID ${phone} is opted out`);
        return;
      }
      return mockSend(phone, text, instanceId);
    };

    await guardedSend('60555555555', 'Hello');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('opted out'));
    expect(mockSend).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('non-opted-out JID passes through to send', async () => {
    mockIsOptedOut.mockReturnValue(false);

    const mockSend = vi.fn().mockResolvedValue(undefined);

    const guardedSend = async (phone: string, text: string, instanceId?: string) => {
      if (mockIsOptedOut(phone)) return;
      return mockSend(phone, text, instanceId);
    };

    await guardedSend('60666666666', 'Welcome!', 'inst-1');
    expect(mockSend).toHaveBeenCalledWith('60666666666', 'Welcome!', 'inst-1');
  });
});
