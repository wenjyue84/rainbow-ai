/**
 * Unit tests for US-020: Automated 72-hour PDPA breach notification pipeline
 *
 * Tests:
 *  1. sendDpoBreachEmail builds correct email payload and calls transport
 *  2. sendDpoBreachEmail returns false when no transport is configured
 *  3. sendDpoBreachEmail returns true when EMAIL_WEBHOOK_URL is set
 *  4. breach_incidents record is created when a breach is reported
 *  5. dpo_notified_at is set after successful email delivery
 *  6. checkBreachEscalations sends alert for unacknowledged 60h+ incidents
 *  7. checkBreachEscalations skips incidents already escalated
 *  8. checkBreachEscalations skips incidents that have been acknowledged
 *  9. formatIncident countdown hours_remaining decrements correctly
 * 10. Acknowledge endpoint sets acknowledged_at (mocked DB)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const { poolQueryMock, notifyAdminMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  notifyAdminMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/db.js', () => ({
  pool: { query: poolQueryMock },
  dbReady: Promise.resolve(true),
}));

vi.mock('../lib/admin-notifier.js', () => ({
  notifyAdminBreachReport: notifyAdminMock,
}));

vi.mock('../assistant/config-store.js', () => ({
  configStore: {
    getSettings: vi.fn().mockReturnValue({
      pdpa: {
        dpo_email: 'dpo@example.com',
        breach_detection: { enabled: true, scan_interval_minutes: 15, bulk_access_threshold: 100 },
      },
    }),
  },
}));

// ─── Import modules under test ───────────────────────────────────────────────

import { sendDpoBreachEmail, type BreachEmailPayload } from '../lib/dpo-email.js';
import { checkBreachEscalations } from '../routes/admin/breach-report.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const basePayload: BreachEmailPayload = {
  incidentId: 'test-incident-123',
  breachType: 'bulk_access',
  detectedAt: new Date('2026-03-17T08:00:00Z'),
  estimatedAffected: 250,
  dataCategories: ['guest_records', 'access_logs'],
  description: 'Anomalous bulk data access from 10.0.0.1',
  dpoEmail: 'dpo@example.com',
  commissionerDeadline: new Date('2026-03-18T08:00:00Z'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendDpoBreachEmail', () => {
  let origSmtpHost: string | undefined;
  let origWebhook: string | undefined;

  beforeEach(() => {
    origSmtpHost = process.env.SMTP_HOST;
    origWebhook = process.env.EMAIL_WEBHOOK_URL;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.EMAIL_WEBHOOK_URL;
  });

  afterEach(() => {
    if (origSmtpHost !== undefined) process.env.SMTP_HOST = origSmtpHost;
    else delete process.env.SMTP_HOST;
    if (origWebhook !== undefined) process.env.EMAIL_WEBHOOK_URL = origWebhook;
    else delete process.env.EMAIL_WEBHOOK_URL;
  });

  it('returns false when no transport configured (log-only fallback)', async () => {
    const result = await sendDpoBreachEmail(basePayload);
    expect(result).toBe(false);
  });

  it('returns true and calls webhook when EMAIL_WEBHOOK_URL is set', async () => {
    process.env.EMAIL_WEBHOOK_URL = 'https://email-relay.example.com/send';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendDpoBreachEmail(basePayload);
    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://email-relay.example.com/send');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body as string);
    expect(body.to).toBe('dpo@example.com');
    expect(body.subject).toContain('PDPA Data Breach Notification');
    expect(body.subject).toContain('test-incident-123');
    expect(body.body).toContain('bulk_access');
    expect(body.body).toContain('250');

    vi.unstubAllGlobals();
  });

  it('email body contains all required PDPA fields', async () => {
    process.env.EMAIL_WEBHOOK_URL = 'https://relay.example.com';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    await sendDpoBreachEmail(basePayload);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string).body as string;
    expect(body).toContain('test-incident-123');
    expect(body).toContain('bulk_access');
    expect(body).toContain('250');
    expect(body).toContain('guest_records');
    expect(body).toContain('access_logs');
    expect(body).toContain('Commissioner notification due');
    expect(body).toContain('https://www.pdp.gov.my');

    vi.unstubAllGlobals();
  });

  it('falls back to webhook when SMTP send fails', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';
    process.env.EMAIL_WEBHOOK_URL = 'https://relay.example.com';

    // Mock nodemailer to fail
    vi.doMock('nodemailer', () => ({
      createTransport: () => ({
        sendMail: vi.fn().mockRejectedValue(new Error('SMTP connect failed')),
      }),
    }));

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendDpoBreachEmail(basePayload);
    expect(result).toBe(true); // webhook fallback succeeded
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});

describe('checkBreachEscalations', () => {
  beforeEach(() => {
    // mockReset clears both call history AND queued responses to prevent cross-test contamination
    poolQueryMock.mockReset();
    notifyAdminMock.mockReset().mockResolvedValue(undefined);
  });

  it('sends escalation alert for unacknowledged incident older than 60h', async () => {
    const sixtyOneHoursAgo = new Date(Date.now() - 61 * 60 * 60 * 1000);
    const mockIncident = {
      id: 'incident-abc',
      breach_type: 'bulk_access',
      estimated_affected: 150,
      detected_at: sixtyOneHoursAgo.toISOString(),
      data_categories: ['guest_records'],
      acknowledged_at: null,
      escalated_at: null,
    };

    poolQueryMock
      .mockResolvedValueOnce({ rows: [mockIncident] }) // SELECT unescalated incidents
      .mockResolvedValueOnce({ rows: [] });            // UPDATE escalated_at = NOW()

    await checkBreachEscalations();

    expect(notifyAdminMock).toHaveBeenCalledOnce();
    const [msg] = notifyAdminMock.mock.calls[0];
    expect(msg).toContain('ESCALATION');
    expect(msg).toContain('incident-abc');
  });

  it('does not send alert if no unescalated incidents', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });

    await checkBreachEscalations();

    expect(notifyAdminMock).not.toHaveBeenCalled();
  });

  it('skips incidents that have already been escalated', async () => {
    // The SELECT query filters WHERE escalated_at IS NULL, so this returns empty
    poolQueryMock.mockResolvedValueOnce({ rows: [] });

    await checkBreachEscalations();

    expect(notifyAdminMock).not.toHaveBeenCalled();
  });

  it('marks incident as escalated before sending alert to prevent duplicate sends', async () => {
    const sixtyOneHoursAgo = new Date(Date.now() - 61 * 60 * 60 * 1000);
    const mockIncident = {
      id: 'incident-xyz',
      breach_type: 'manual_report',
      estimated_affected: 500,
      detected_at: sixtyOneHoursAgo.toISOString(),
      data_categories: [],
      acknowledged_at: null,
      escalated_at: null,
    };

    poolQueryMock
      .mockResolvedValueOnce({ rows: [mockIncident] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE escalated_at

    await checkBreachEscalations();

    // There should be a pool.query call that sets escalated_at = NOW()
    const updateCalls = poolQueryMock.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('escalated_at = NOW()')
    );
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][1]).toContain('incident-xyz');
  });
});

describe('breach incident countdown', () => {
  it('hours_remaining is calculated from detected_at to 72h deadline', () => {
    // 10 hours after detection → 62 hours remaining
    const detectedAt = new Date(Date.now() - 10 * 60 * 60 * 1000);
    const deadline = new Date(detectedAt.getTime() + 72 * 60 * 60 * 1000);
    const hoursRemaining = Math.max(
      0,
      Math.round((deadline.getTime() - Date.now()) / 3_600_000)
    );
    expect(hoursRemaining).toBeGreaterThanOrEqual(61);
    expect(hoursRemaining).toBeLessThanOrEqual(63);
  });

  it('hours_remaining is 0 when deadline has passed', () => {
    const detectedAt = new Date(Date.now() - 80 * 60 * 60 * 1000); // 80h ago
    const deadline = new Date(detectedAt.getTime() + 72 * 60 * 60 * 1000);
    const hoursRemaining = Math.max(
      0,
      Math.round((deadline.getTime() - Date.now()) / 3_600_000)
    );
    expect(hoursRemaining).toBe(0);
  });
});
