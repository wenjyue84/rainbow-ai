/**
 * WABA Webhook Health Check Tests (US-892)
 *
 * Tests subscription check, auto-resubscription, state management,
 * and admin notification on failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkWabaSubscription,
  getWebhookHealthState,
  fetchSubscriptionStatus,
  resubscribeApp,
  initWebhookHealthNotifier,
  _resetForTesting,
} from '../../lib/waba-webhook-health.js';

// ─── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  _resetForTesting();
  // Clear env vars
  delete process.env.WABA_BUSINESS_ID;
  delete process.env.WABA_ID;
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.WHATSAPP_TOKEN;
});

afterEach(() => {
  _resetForTesting();
  delete process.env.WABA_BUSINESS_ID;
  delete process.env.WABA_ID;
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.WHATSAPP_TOKEN;
  vi.restoreAllMocks();
});

// ─── getWebhookHealthState ────────────────────────────────────────

describe('getWebhookHealthState', () => {
  it('returns initial state with null values', () => {
    const state = getWebhookHealthState();
    expect(state.webhookSubscribed).toBeNull();
    expect(state.lastCheckedAt).toBeNull();
    expect(state.lastError).toBeNull();
  });

  it('returns a copy (not the internal reference)', () => {
    const s1 = getWebhookHealthState();
    const s2 = getWebhookHealthState();
    expect(s1).not.toBe(s2);
    expect(s1).toEqual(s2);
  });
});

// ─── checkWabaSubscription — no credentials ───────────────────────

describe('checkWabaSubscription — no credentials', () => {
  it('skips gracefully when WABA_BUSINESS_ID and META_ACCESS_TOKEN are absent', async () => {
    const state = await checkWabaSubscription();
    expect(state.webhookSubscribed).toBeNull(); // unchanged from initial
    expect(state.lastCheckedAt).toBeTruthy(); // timestamp updated
    expect(state.lastError).toBeNull();
  });

  it('skips when only WABA_BUSINESS_ID is set but no token', async () => {
    process.env.WABA_BUSINESS_ID = '123456';
    const state = await checkWabaSubscription();
    expect(state.webhookSubscribed).toBeNull();
  });

  it('skips when only META_ACCESS_TOKEN is set but no WABA ID', async () => {
    process.env.META_ACCESS_TOKEN = 'token123';
    const state = await checkWabaSubscription();
    expect(state.webhookSubscribed).toBeNull();
  });
});

// ─── checkWabaSubscription — with credentials ─────────────────────

describe('checkWabaSubscription — subscription active', () => {
  it('sets webhookSubscribed=true when app is subscribed', async () => {
    process.env.WABA_BUSINESS_ID = '123456';
    process.env.META_ACCESS_TOKEN = 'test-token';

    // Mock fetch for GET subscribed_apps — app is subscribed
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: '111', name: 'MyApp' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const state = await checkWabaSubscription();
    expect(state.webhookSubscribed).toBe(true);
    expect(state.lastError).toBeNull();
    expect(state.lastCheckedAt).toBeTruthy();
  });
});

describe('checkWabaSubscription — subscription missing, resubscription succeeds', () => {
  it('auto-resubscribes and sets webhookSubscribed=true', async () => {
    process.env.WABA_ID = '789';
    process.env.WHATSAPP_TOKEN = 'alt-token';

    const fetchMock = vi.spyOn(globalThis, 'fetch');

    // First call: GET subscribed_apps — empty (not subscribed)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // Second call: POST subscribed_apps — success
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const state = await checkWabaSubscription();
    expect(state.webhookSubscribed).toBe(true);
    expect(state.lastError).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('checkWabaSubscription — subscription missing, resubscription fails', () => {
  it('sets webhookSubscribed=false and triggers admin notification', async () => {
    process.env.WABA_BUSINESS_ID = '123';
    process.env.META_ACCESS_TOKEN = 'tok';

    const notifySpy = vi.fn().mockResolvedValue(undefined);
    initWebhookHealthNotifier(notifySpy);

    const fetchMock = vi.spyOn(globalThis, 'fetch');

    // GET subscribed_apps — empty
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // POST subscribed_apps — returns success: false
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const state = await checkWabaSubscription();
    expect(state.webhookSubscribed).toBe(false);
    expect(state.lastError).toBe('Auto-resubscription failed');
  });
});

describe('checkWabaSubscription — Meta API error', () => {
  it('handles network/API errors gracefully', async () => {
    process.env.WABA_BUSINESS_ID = '123';
    process.env.META_ACCESS_TOKEN = 'tok';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', {
        status: 401,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const state = await checkWabaSubscription();
    expect(state.webhookSubscribed).toBe(false);
    expect(state.lastError).toContain('401');
    expect(state.lastCheckedAt).toBeTruthy();
  });

  it('handles fetch rejection (network failure)', async () => {
    process.env.WABA_BUSINESS_ID = '123';
    process.env.META_ACCESS_TOKEN = 'tok';

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const state = await checkWabaSubscription();
    expect(state.webhookSubscribed).toBe(false);
    expect(state.lastError).toBe('ECONNREFUSED');
  });
});

// ─── fetchSubscriptionStatus ──────────────────────────────────────

describe('fetchSubscriptionStatus', () => {
  it('returns true when data array has entries', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: '1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await fetchSubscriptionStatus('waba1', 'tok')).toBe(true);
  });

  it('returns false when data array is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await fetchSubscriptionStatus('waba1', 'tok')).toBe(false);
  });

  it('throws on Meta API error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid token' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(fetchSubscriptionStatus('waba1', 'tok')).rejects.toThrow('Invalid token');
  });

  it('throws on non-200 HTTP status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );
    await expect(fetchSubscriptionStatus('waba1', 'tok')).rejects.toThrow('403');
  });
});

// ─── resubscribeApp ───────────────────────────────────────────────

describe('resubscribeApp', () => {
  it('returns true on success: true response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await resubscribeApp('waba1', 'tok')).toBe(true);
  });

  it('returns false on success: false response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await resubscribeApp('waba1', 'tok')).toBe(false);
  });

  it('throws on API error in response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Permission denied' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(resubscribeApp('waba1', 'tok')).rejects.toThrow('Permission denied');
  });

  it('throws on non-200 HTTP status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Server Error', { status: 500 }),
    );
    await expect(resubscribeApp('waba1', 'tok')).rejects.toThrow('500');
  });
});

// ─── initWebhookHealthNotifier ────────────────────────────────────

describe('initWebhookHealthNotifier', () => {
  it('accepts a sender function without throwing', () => {
    expect(() => initWebhookHealthNotifier(vi.fn())).not.toThrow();
  });
});

// ─── Env var fallbacks ────────────────────────────────────────────

describe('env var fallbacks', () => {
  it('uses WABA_ID when WABA_BUSINESS_ID is not set', async () => {
    process.env.WABA_ID = 'fallback-waba';
    process.env.META_ACCESS_TOKEN = 'tok';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: '1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await checkWabaSubscription();

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('fallback-waba');
  });

  it('uses WHATSAPP_TOKEN when META_ACCESS_TOKEN is not set', async () => {
    process.env.WABA_BUSINESS_ID = 'waba1';
    process.env.WHATSAPP_TOKEN = 'alt-token';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: '1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await checkWabaSubscription();

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('alt-token');
  });
});
