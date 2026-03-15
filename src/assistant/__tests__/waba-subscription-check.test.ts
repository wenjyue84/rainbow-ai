/**
 * WABA Webhook Subscription Health Check Tests (US-892)
 *
 * Mocks the Meta Graph API and asserts resubscription is attempted
 * when the subscription is absent, and the correct in-memory state is set.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Module mocks (must be before dynamic import) ───────────────────────────

vi.mock('../../lib/logger.js', () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../lib/timeouts.js', () => ({
  WA_API_TIMEOUT_MS: 5000,
}));

vi.mock('../../lib/admin-notifier.js', () => ({
  notifyAdminWabaSubscriptionFailed: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

let wabaCheck: typeof import('../../lib/waba-subscription-check.js');

async function freshModule() {
  vi.resetModules();
  vi.mock('../../lib/logger.js', () => ({
    createModuleLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }));
  vi.mock('../../lib/timeouts.js', () => ({
    WA_API_TIMEOUT_MS: 5000,
  }));
  vi.mock('../../lib/admin-notifier.js', () => ({
    notifyAdminWabaSubscriptionFailed: vi.fn().mockResolvedValue(undefined),
  }));
  wabaCheck = await import('../../lib/waba-subscription-check.js');
}

// Save and restore original env
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getWebhookSubscriptionState', () => {
  it('reports skipped=true when env vars are absent', async () => {
    await freshModule();
    delete process.env.WABA_ID;
    delete process.env.META_ACCESS_TOKEN;

    const state = wabaCheck.getWebhookSubscriptionState();
    expect(state.skipped).toBe(true);
    expect(state.webhookSubscribed).toBeNull();
  });

  it('reports skipped=false when env vars are present', async () => {
    await freshModule();
    process.env.WABA_ID = '123456789';
    process.env.META_ACCESS_TOKEN = 'test-token';

    const state = wabaCheck.getWebhookSubscriptionState();
    expect(state.skipped).toBe(false);
  });
});

describe('runSubscriptionCheck', () => {
  it('skips silently when WABA credentials are absent', async () => {
    await freshModule();
    delete process.env.WABA_ID;
    delete process.env.META_ACCESS_TOKEN;

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await wabaCheck.runSubscriptionCheck();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('marks webhookSubscribed=true when subscription exists', async () => {
    await freshModule();
    process.env.WABA_ID = '123456789';
    process.env.META_ACCESS_TOKEN = 'valid-token';

    // Mock Graph API: subscription exists
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ whatsapp_business_api_data: { id: 'app-id' } }] }),
    } as any);

    await wabaCheck.runSubscriptionCheck();

    const state = wabaCheck.getWebhookSubscriptionState();
    expect(state.webhookSubscribed).toBe(true);
    expect(state.lastCheckedAt).not.toBeNull();
  });

  it('attempts resubscription when subscription is absent', async () => {
    await freshModule();
    process.env.WABA_ID = '123456789';
    process.env.META_ACCESS_TOKEN = 'valid-token';

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      // First call: GET subscribed_apps → empty (not subscribed)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as any)
      // Second call: POST subscribed_apps → success
      .mockResolvedValueOnce({
        ok: true,
      } as any);

    await wabaCheck.runSubscriptionCheck();

    // Should have called GET then POST
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [getCall, postCall] = fetchMock.mock.calls;
    expect((getCall[0] as string)).toContain('/123456789/subscribed_apps');
    expect((postCall[1] as RequestInit).method).toBe('POST');

    const state = wabaCheck.getWebhookSubscriptionState();
    expect(state.webhookSubscribed).toBe(true);
  });

  it('marks webhookSubscribed=false and sends admin notification when resubscription fails', async () => {
    await freshModule();
    process.env.WABA_ID = '123456789';
    process.env.META_ACCESS_TOKEN = 'valid-token';

    vi.spyOn(globalThis, 'fetch')
      // GET → not subscribed
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as any)
      // POST → fails
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Insufficient permissions',
      } as any);

    await wabaCheck.runSubscriptionCheck();

    const state = wabaCheck.getWebhookSubscriptionState();
    expect(state.webhookSubscribed).toBe(false);

    // Admin notification should have been called
    const { notifyAdminWabaSubscriptionFailed } = await import('../../lib/admin-notifier.js');
    expect(notifyAdminWabaSubscriptionFailed).toHaveBeenCalledWith(
      '123456789',
      expect.stringContaining('403')
    );
  });

  it('preserves last known state on network error during check', async () => {
    await freshModule();
    process.env.WABA_ID = '123456789';
    process.env.META_ACCESS_TOKEN = 'valid-token';

    // First call succeeds → marks subscribed=true
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'app' }] }),
      } as any)
      // Second call throws network error
      .mockRejectedValueOnce(new Error('Network timeout'));

    await wabaCheck.runSubscriptionCheck();
    expect(wabaCheck.getWebhookSubscriptionState().webhookSubscribed).toBe(true);

    await wabaCheck.runSubscriptionCheck();
    // State should remain true (not flipped to false on network error)
    expect(wabaCheck.getWebhookSubscriptionState().webhookSubscribed).toBe(true);
  });
});
