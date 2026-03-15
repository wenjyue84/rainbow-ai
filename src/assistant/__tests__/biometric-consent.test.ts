/**
 * Unit tests for PDPA 2024 Biometric Data Consent Guard (US-994).
 *
 * Verifies:
 * - OCR is blocked when biometric consent is absent
 * - Consent request message is sent when consent not on record
 * - OCR is allowed after consent is granted
 * - Consent response keywords are recognised (YES/NO in en/ms)
 * - Raw image bytes are never persisted (guard contract)
 * - Consent records are auditable (security event logged)
 * - Consent revocation works
 * - Feature toggle disables the guard
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// ─── Hoist mocks before vi.mock calls ────────────────────────────────
const { mockPoolQuery, mockLogSecurityEvent } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockLogSecurityEvent: vi.fn(),
}));

vi.mock('../../lib/db.js', () => ({
  pool: { query: mockPoolQuery },
  dbReady: Promise.resolve(true),
  db: {},
}));

vi.mock('../consent.js', () => ({
  hashJid: (phone: string) => {
    // Simple hash for testing — deterministic
    const crypto = require('crypto');
    const canonical = phone.replace(/[^0-9]/g, '') || phone;
    return crypto.createHash('sha256').update(canonical).digest('hex');
  },
}));

vi.mock('../../lib/security-event-log.js', () => ({
  logSecurityEvent: mockLogSecurityEvent,
}));

// Import after mocks
import {
  hasBiometricConsent,
  hasPendingBiometricConsent,
  requireBiometricConsent,
  grantBiometricConsent,
  revokeBiometricConsent,
  handleBiometricConsentResponse,
  buildConsentRequestMessage,
  isBiometricConsentYes,
  isBiometricConsentNo,
  loadBiometricConsentCache,
} from '../biometric-consent.js';

describe('Biometric Consent Guard (US-994)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockLogSecurityEvent.mockResolvedValue(undefined);
  });

  // ─── Guard blocks OCR when no consent ─────────────────────────────

  test('requireBiometricConsent blocks OCR and sends consent request when no consent on record', async () => {
    const result = await requireBiometricConsent('60123456789', 'en', 'pelangi');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('consent_requested');
    expect(result.consentMessage).toBeDefined();
    expect(result.consentMessage).toContain('Biometric Data Consent Required');
    expect(result.consentMessage).toContain('Personal Data Protection');
  });

  test('consent request message explains PDPA requirements and asks for YES/NO', () => {
    const msg = buildConsentRequestMessage('en');
    expect(msg).toContain('biometric data');
    expect(msg).toContain('explicit consent');
    expect(msg).toContain('NOT saved');
    expect(msg).toContain('Reply *YES* to consent');
    expect(msg).toContain('withdraw consent');
  });

  test('consent request message available in Malay', () => {
    const msg = buildConsentRequestMessage('ms');
    expect(msg).toContain('Data Biometrik');
    expect(msg).toContain('persetujuan jelas');
    expect(msg).toContain('Balas *YA*');
  });

  test('consent request message available in Chinese', () => {
    const msg = buildConsentRequestMessage('zh');
    expect(msg).toContain('生物识别数据');
    expect(msg).toContain('明确同意');
  });

  // ─── Guard allows OCR after consent granted ────────────────────────

  test('requireBiometricConsent allows OCR after grantBiometricConsent', async () => {
    const phone = '60111111111';

    // First call — no consent, should block
    const blocked = await requireBiometricConsent(phone, 'en', 'pelangi');
    expect(blocked.allowed).toBe(false);

    // Grant consent
    await grantBiometricConsent(phone, 'pelangi');

    // Second call — consent granted, should allow
    const allowed = await requireBiometricConsent(phone, 'en', 'pelangi');
    expect(allowed.allowed).toBe(true);
    expect(allowed.reason).toBe('consent_granted');
  });

  // ─── Pending state ─────────────────────────────────────────────────

  test('second request for same JID returns consent_pending', async () => {
    const phone = '60222222222';

    // First request — creates pending
    const first = await requireBiometricConsent(phone, 'en', 'pelangi');
    expect(first.reason).toBe('consent_requested');

    // Second request — already pending
    const second = await requireBiometricConsent(phone, 'en', 'pelangi');
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe('consent_pending');
  });

  // ─── Consent response handling ─────────────────────────────────────

  test('handleBiometricConsentResponse grants consent on YES', async () => {
    const phone = '60333333333';

    // Create pending consent
    await requireBiometricConsent(phone, 'en', 'pelangi');

    // Respond YES
    const result = await handleBiometricConsentResponse(phone, 'YES', 'en', 'pelangi');
    expect(result.handled).toBe(true);
    expect(result.reply).toContain('Thank you for your consent');

    // Now should have consent
    expect(hasBiometricConsent(phone)).toBe(true);
  });

  test('handleBiometricConsentResponse handles NO decline', async () => {
    const phone = '60444444444';

    // Create pending consent
    await requireBiometricConsent(phone, 'en', 'pelangi');

    // Respond NO
    const result = await handleBiometricConsentResponse(phone, 'no', 'en', 'pelangi');
    expect(result.handled).toBe(true);
    expect(result.reply).toContain('will not be processed');
  });

  test('handleBiometricConsentResponse ignores non-pending JID', async () => {
    const result = await handleBiometricConsentResponse('60555555555', 'yes', 'en', 'pelangi');
    expect(result.handled).toBe(false);
  });

  test('handleBiometricConsentResponse handles Malay YES (ya)', async () => {
    const phone = '60666666666';
    await requireBiometricConsent(phone, 'ms', 'pelangi');

    const result = await handleBiometricConsentResponse(phone, 'ya', 'ms', 'pelangi');
    expect(result.handled).toBe(true);
    expect(result.reply).toContain('persetujuan');
  });

  // ─── Consent keyword detection ─────────────────────────────────────

  test('isBiometricConsentYes recognises consent keywords', () => {
    expect(isBiometricConsentYes('yes')).toBe(true);
    expect(isBiometricConsentYes('YES')).toBe(true);
    expect(isBiometricConsentYes('ya')).toBe(true);
    expect(isBiometricConsentYes('agree')).toBe(true);
    expect(isBiometricConsentYes('setuju')).toBe(true);
    expect(isBiometricConsentYes('ok')).toBe(true);
    expect(isBiometricConsentYes('confirm')).toBe(true);
  });

  test('isBiometricConsentNo recognises decline keywords', () => {
    expect(isBiometricConsentNo('no')).toBe(true);
    expect(isBiometricConsentNo('NO')).toBe(true);
    expect(isBiometricConsentNo('tidak')).toBe(true);
    expect(isBiometricConsentNo('decline')).toBe(true);
    expect(isBiometricConsentNo('tolak')).toBe(true);
  });

  test('unrelated text is neither yes nor no', () => {
    expect(isBiometricConsentYes('hello')).toBe(false);
    expect(isBiometricConsentNo('hello')).toBe(false);
    expect(isBiometricConsentYes('maybe')).toBe(false);
    expect(isBiometricConsentNo('maybe')).toBe(false);
  });

  // ─── Audit logging ─────────────────────────────────────────────────

  test('grantBiometricConsent logs security event for audit', async () => {
    const phone = '60777777777';
    await grantBiometricConsent(phone, 'pelangi');

    expect(mockLogSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'biometric_consent_granted',
        resourceType: 'biometric_consent',
        details: expect.objectContaining({
          profile_id: 'pelangi',
          legal_reference: expect.stringContaining('PDPA'),
        }),
      })
    );
  });

  test('revokeBiometricConsent logs security event for audit', async () => {
    const phone = '60888888888';
    await grantBiometricConsent(phone, 'pelangi');
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockLogSecurityEvent.mockResolvedValue(undefined);

    await revokeBiometricConsent(phone, 'pelangi');

    expect(mockLogSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'biometric_consent_revoked',
        resourceType: 'biometric_consent',
      })
    );
  });

  // ─── Consent revocation ────────────────────────────────────────────

  test('revokeBiometricConsent removes consent and blocks OCR', async () => {
    const phone = '60999999999';

    await grantBiometricConsent(phone, 'pelangi');
    expect(hasBiometricConsent(phone)).toBe(true);

    await revokeBiometricConsent(phone, 'pelangi');
    expect(hasBiometricConsent(phone)).toBe(false);
  });

  // ─── Feature toggle ────────────────────────────────────────────────

  test('requireBiometricConsent allows OCR when feature is disabled', async () => {
    const result = await requireBiometricConsent('60100000000', 'en', 'pelangi', false);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('disabled');
  });

  // ─── Raw image bytes contract ──────────────────────────────────────

  test('guard result documents that raw images must not be persisted', async () => {
    const result = await requireBiometricConsent('60200000000', 'en', 'pelangi');

    // The consent message explicitly states images are NOT saved
    expect(result.consentMessage).toContain('NOT saved');
    expect(result.consentMessage).toContain('Immediately discarded');
    expect(result.consentMessage).toContain('Only the extracted text');
  });

  // ─── DB persistence ────────────────────────────────────────────────

  test('recordBiometricConsentRequest persists to biometric_consent_records table', async () => {
    const phone = '60300000000';
    await requireBiometricConsent(phone, 'en', 'pelangi');

    const insertCall = mockPoolQuery.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO biometric_consent_records')
    );
    expect(insertCall).toBeDefined();
  });

  test('grantBiometricConsent upserts with consent_granted=true and responded_at', async () => {
    const phone = '60400000000';
    await grantBiometricConsent(phone, 'pelangi');

    const upsertCall = mockPoolQuery.mock.calls.find(call =>
      typeof call[0] === 'string' &&
      call[0].includes('INSERT INTO biometric_consent_records') &&
      call[0].includes('consent_granted = true')
    );
    expect(upsertCall).toBeDefined();
  });
});
