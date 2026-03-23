/**
 * Unit tests for sms-sender.ts (US-347).
 *
 * All Twilio HTTP calls are intercepted via vi.stubGlobal('fetch', ...).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendSms, loadSmsConfig, isSmsConfigured } from './sms-sender.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockFetch(body: object, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const VALID_ENV = {
  TWILIO_ACCOUNT_SID: 'ACtest123',
  TWILIO_AUTH_TOKEN: 'auth456',
  TWILIO_FROM_NUMBER: '+60123456789',
};

function setEnv(overrides: Record<string, string | undefined> = {}) {
  // Apply base env first
  Object.assign(process.env, VALID_ENV);
  // Then apply overrides — delete keys set to undefined
  for (const [key, val] of Object.entries(overrides)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

function clearEnv() {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('loadSmsConfig', () => {
  afterEach(clearEnv);

  it('returns config when all env vars are present', () => {
    setEnv();
    const cfg = loadSmsConfig();
    expect(cfg.accountSid).toBe('ACtest123');
    expect(cfg.authToken).toBe('auth456');
    expect(cfg.fromNumber).toBe('+60123456789');
  });

  it('throws when TWILIO_ACCOUNT_SID is missing', () => {
    setEnv({ TWILIO_ACCOUNT_SID: undefined });
    expect(() => loadSmsConfig()).toThrow('TWILIO_ACCOUNT_SID');
  });

  it('throws when TWILIO_AUTH_TOKEN is missing', () => {
    setEnv({ TWILIO_AUTH_TOKEN: undefined });
    expect(() => loadSmsConfig()).toThrow('TWILIO_AUTH_TOKEN');
  });

  it('throws when TWILIO_FROM_NUMBER is missing', () => {
    setEnv({ TWILIO_FROM_NUMBER: undefined });
    expect(() => loadSmsConfig()).toThrow('TWILIO_FROM_NUMBER');
  });
});

describe('isSmsConfigured', () => {
  afterEach(clearEnv);

  it('returns true when all env vars are set', () => {
    setEnv();
    expect(isSmsConfigured()).toBe(true);
  });

  it('returns false when any env var is missing', () => {
    clearEnv();
    expect(isSmsConfigured()).toBe(false);
  });
});

describe('sendSms', () => {
  beforeEach(setEnv);
  afterEach(() => {
    clearEnv();
    vi.restoreAllMocks();
  });

  it('sends SMS and returns SID and status on success', async () => {
    const fetchMock = mockFetch({ sid: 'SM123', status: 'queued', to: '+601987654321' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms('+601987654321', 'Booking confirmed!');

    expect(result.sid).toBe('SM123');
    expect(result.status).toBe('queued');
    expect(result.to).toBe('+601987654321');
  });

  it('calls the correct Twilio Messages endpoint', async () => {
    const fetchMock = mockFetch({ sid: 'SM456', status: 'queued', to: '+60111111111' });
    vi.stubGlobal('fetch', fetchMock);

    await sendSms('+60111111111', 'Test');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/ACtest123/Messages.json`
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
  });

  it('uses Basic auth with correct credentials', async () => {
    const fetchMock = mockFetch({ sid: 'SM789', status: 'queued', to: '+60111111111' });
    vi.stubGlobal('fetch', fetchMock);

    await sendSms('+60111111111', 'Test');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const expectedCredentials = Buffer.from('ACtest123:auth456').toString('base64');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${expectedCredentials}`
    );
  });

  it('throws on non-2xx Twilio response', async () => {
    const fetchMock = mockFetch({ message: 'Invalid phone', code: 21211 }, 400);
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendSms('+invalid', 'Test')).rejects.toThrow('Twilio API error 400');
  });

  it('includes To, From, and Body in request params', async () => {
    const fetchMock = mockFetch({ sid: 'SMabc', status: 'queued', to: '+60222222222' });
    vi.stubGlobal('fetch', fetchMock);

    await sendSms('+60222222222', 'Your booking is confirmed.');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = init.body as string;
    expect(body).toContain('To=%2B60222222222');
    expect(body).toContain('From=%2B60123456789');
    expect(body).toContain('Body=Your+booking+is+confirmed.');
  });
});

// ─── Integration-style: SMS sent only after 2 WhatsApp failures ──────────────

describe('withSmsFallback integration', () => {
  beforeEach(setEnv);
  afterEach(() => {
    clearEnv();
    vi.restoreAllMocks();
  });

  it('sends SMS only after WhatsApp exhausts all retries', async () => {
    // Lazy import to pick up test env
    const { withSmsFallback } = await import('../assistant/pipeline/message-sender.js');

    let waAttempts = 0;
    const failingSend = vi.fn().mockImplementation(async () => {
      waAttempts++;
      throw new Error('WA network error');
    });

    const fetchMock = mockFetch({ sid: 'SMfallback', status: 'queued', to: '+60333333333' });
    vi.stubGlobal('fetch', fetchMock);

    const send = withSmsFallback(failingSend, { maxAttempts: 3, baseDelayMs: 0 });
    const result = await send('+60333333333', 'Booking confirmed!');

    // WhatsApp was attempted 3 times (maxAttempts), then SMS was triggered
    expect(waAttempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((result as any).sid).toBe('SMfallback');
  });

  it('does NOT send SMS when WhatsApp succeeds on first attempt', async () => {
    const { withSmsFallback } = await import('../assistant/pipeline/message-sender.js');

    const successSend = vi.fn().mockResolvedValue({ messageId: 'msg1' });
    const fetchMock = mockFetch({ sid: 'SMshould-not-send', status: 'queued', to: '+60333333333' });
    vi.stubGlobal('fetch', fetchMock);

    const send = withSmsFallback(successSend, { maxAttempts: 3, baseDelayMs: 0 });
    await send('+60333333333', 'Booking confirmed!');

    expect(successSend).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws combined error when both WhatsApp and SMS fail', async () => {
    const { withSmsFallback } = await import('../assistant/pipeline/message-sender.js');

    const failingSend = vi.fn().mockRejectedValue(new Error('WA down'));
    const failingFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    vi.stubGlobal('fetch', failingFetch);

    const send = withSmsFallback(failingSend, { maxAttempts: 3, baseDelayMs: 0 });
    await expect(send('+60333333333', 'Booking')).rejects.toThrow(
      /SMS fallback also failed/
    );
  });
});
