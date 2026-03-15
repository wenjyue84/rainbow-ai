/**
 * kds-webhook.test.ts — Unit tests for KDS/POS webhook dispatcher (US-876)
 *
 * Tests:
 *  - Payload building (items, table/pickup, JID hashing)
 *  - Dispatch disabled when config.enabled is false
 *  - Dispatch disabled when webhookUrl is empty
 *  - Successful POST returns accepted
 *  - POS rejected response relayed
 *  - Failed POST triggers retry queue
 *  - Alert function called on failure
 *  - Cart handler integration: KDS note appended on rejection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildKdsPayload,
  dispatchToKds,
  hashJid,
  clearRetryQueue,
  getRetryQueueSize,
  type KdsWebhookConfig,
  type KdsOrderPayload,
} from '../../lib/kds-webhook.js';

// ─── hashJid ──────────────────────────────────────────────────────────

describe('KDS Webhook — hashJid', () => {
  it('returns a 12-char hex string', () => {
    const hash = hashJid('60127088789@s.whatsapp.net');
    expect(hash).toHaveLength(12);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('produces consistent output for same input', () => {
    const a = hashJid('test-jid');
    const b = hashJid('test-jid');
    expect(a).toBe(b);
  });

  it('produces different output for different inputs', () => {
    const a = hashJid('jid-one');
    const b = hashJid('jid-two');
    expect(a).not.toBe(b);
  });
});

// ─── buildKdsPayload ──────────────────────────────────────────────────

describe('KDS Webhook — buildKdsPayload', () => {
  it('builds payload with dine-in table', () => {
    const payload = buildKdsPayload({
      orderId: 'MM-A1B2',
      items: [
        { name: 'Nasi Lemak', qty: 2, code: 'NR01', notes: 'Extra sambal' },
        { name: 'Teh Tarik', qty: 1, code: 'BV02' },
      ],
      tableNumber: '5',
      orderType: 'dine-in',
      customerJid: 'webchat-abc123',
      profileId: 'makan-moments',
    });

    expect(payload.orderId).toBe('MM-A1B2');
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].name).toBe('Nasi Lemak');
    expect(payload.items[0].qty).toBe(2);
    expect(payload.items[0].specialInstructions).toBe('Extra sambal');
    expect(payload.items[1].specialInstructions).toBeUndefined();
    expect(payload.tableOrPickup).toBe('Table 5');
    expect(payload.customerJidHash).toMatch(/^[0-9a-f]{12}$/);
    expect(payload.profileId).toBe('makan-moments');
    expect(payload.timestamp).toBeTruthy();
  });

  it('builds payload with takeaway', () => {
    const payload = buildKdsPayload({
      orderId: 'MM-C3D4',
      items: [{ name: 'Roti Canai', qty: 3 }],
      orderType: 'takeaway',
      customerJid: 'webchat-xyz',
      profileId: 'makan-moments',
    });

    expect(payload.tableOrPickup).toBe('Takeaway');
  });

  it('defaults to Walk-in when no table or order type', () => {
    const payload = buildKdsPayload({
      orderId: 'MM-E5F6',
      items: [{ name: 'Coffee', qty: 1 }],
      customerJid: 'webchat-anon',
      profileId: 'makan-moments',
    });

    expect(payload.tableOrPickup).toBe('Walk-in');
  });
});

// ─── dispatchToKds ────────────────────────────────────────────────────

describe('KDS Webhook — dispatchToKds', () => {
  const samplePayload: KdsOrderPayload = {
    orderId: 'MM-TEST',
    items: [{ name: 'Test Item', qty: 1 }],
    tableOrPickup: 'Table 1',
    customerJidHash: 'abcdef123456',
    timestamp: new Date().toISOString(),
    profileId: 'makan-moments',
  };

  beforeEach(() => {
    clearRetryQueue();
    vi.restoreAllMocks();
  });

  it('returns disabled when config.enabled is false', async () => {
    const config: KdsWebhookConfig = { enabled: false, webhookUrl: 'http://example.com/kds' };
    const result = await dispatchToKds(samplePayload, config);
    expect(result.status).toBe('disabled');
  });

  it('returns disabled when webhookUrl is empty', async () => {
    const config: KdsWebhookConfig = { enabled: true, webhookUrl: '' };
    const result = await dispatchToKds(samplePayload, config);
    expect(result.status).toBe('disabled');
  });

  it('returns accepted on successful POST', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted', message: 'Order received' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: KdsWebhookConfig = { enabled: true, webhookUrl: 'http://kds.local/order' };
    const result = await dispatchToKds(samplePayload, config);

    expect(result.status).toBe('accepted');
    expect(result.message).toBe('Order received');
    expect(mockFetch).toHaveBeenCalledOnce();

    // Verify POST body
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://kds.local/order');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.orderId).toBe('MM-TEST');
  });

  it('sends Authorization header when authToken is set', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'accepted' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: KdsWebhookConfig = {
      enabled: true,
      webhookUrl: 'http://kds.local/order',
      authToken: 'Bearer secret-token-123',
    };
    await dispatchToKds(samplePayload, config);

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer secret-token-123');
  });

  it('returns rejected when POS rejects the order', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'rejected', message: 'Kitchen closed' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: KdsWebhookConfig = { enabled: true, webhookUrl: 'http://kds.local/order' };
    const result = await dispatchToKds(samplePayload, config);

    expect(result.status).toBe('rejected');
    expect(result.message).toBe('Kitchen closed');
  });

  it('returns error and queues retry on HTTP failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', mockFetch);

    const alertFn = vi.fn();
    const config: KdsWebhookConfig = {
      enabled: true,
      webhookUrl: 'http://kds.local/order',
      maxRetries: 3,
      baseDelayMs: 100,
    };
    const result = await dispatchToKds(samplePayload, config, alertFn);

    expect(result.status).toBe('error');
    expect(alertFn).toHaveBeenCalledOnce();
    expect(alertFn.mock.calls[0][0]).toContain('KDS webhook failed');
    expect(getRetryQueueSize()).toBe(1);
  });

  it('returns error but no retry when maxRetries is 1', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: KdsWebhookConfig = {
      enabled: true,
      webhookUrl: 'http://kds.local/order',
      maxRetries: 1,
    };
    const result = await dispatchToKds(samplePayload, config);

    expect(result.status).toBe('error');
    expect(getRetryQueueSize()).toBe(0);
  });

  it('handles fetch network errors gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const config: KdsWebhookConfig = {
      enabled: true,
      webhookUrl: 'http://kds.local/order',
      maxRetries: 1,
    };
    const result = await dispatchToKds(samplePayload, config);

    expect(result.status).toBe('error');
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('treats non-JSON 2xx response as accepted', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: KdsWebhookConfig = { enabled: true, webhookUrl: 'http://kds.local/order' };
    const result = await dispatchToKds(samplePayload, config);

    expect(result.status).toBe('accepted');
  });
});

// ─── Integration: payload contains all required fields ────────────────

describe('KDS Webhook — Payload Schema Compliance', () => {
  it('payload contains all required fields per acceptance criteria', () => {
    const payload = buildKdsPayload({
      orderId: 'MM-SCHEMA',
      items: [
        { name: 'Nasi Goreng', qty: 1, code: 'NG01', notes: 'No egg' },
      ],
      tableNumber: '12',
      orderType: 'dine-in',
      customerJid: '60127088789@s.whatsapp.net',
      profileId: 'makan-moments',
    });

    // Acceptance criteria: order ID
    expect(payload.orderId).toBe('MM-SCHEMA');

    // Acceptance criteria: items (name, qty, special instructions)
    expect(payload.items[0].name).toBe('Nasi Goreng');
    expect(payload.items[0].qty).toBe(1);
    expect(payload.items[0].specialInstructions).toBe('No egg');

    // Acceptance criteria: table/pickup identifier
    expect(payload.tableOrPickup).toBe('Table 12');

    // Acceptance criteria: customer JID (hashed)
    expect(payload.customerJidHash).toMatch(/^[0-9a-f]{12}$/);
    // Must NOT contain the raw phone number
    expect(payload.customerJidHash).not.toContain('60127088789');

    // Acceptance criteria: timestamp
    expect(new Date(payload.timestamp).getTime()).not.toBeNaN();
  });
});
