/**
 * Unit tests for US-441: WhatsApp marketing frequency cap (error 131049) handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FrequencyCapError,
  isFrequencyCapError,
  detectFrequencyCapInResponse,
  recordFrequencyCap,
  getFrequencyCapStats24h,
  FREQUENCY_CAP_ERROR_CODE,
  trackOutboundMarketing,
} from '../../lib/frequency-cap.js';

// ── Mock DB ──────────────────────────────────────────────────────────

vi.mock('../../lib/db.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../../../shared/schema-tables.js', () => ({
  rainbowMessages: {},
}));

// ── Tests ────────────────────────────────────────────────────────────

describe('FREQUENCY_CAP_ERROR_CODE', () => {
  it('is 131049', () => {
    expect(FREQUENCY_CAP_ERROR_CODE).toBe(131049);
  });
});

describe('FrequencyCapError', () => {
  it('is an Error with correct name and code', () => {
    const err = new FrequencyCapError('60123456789');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FrequencyCapError);
    expect(err.name).toBe('FrequencyCapError');
    expect(err.code).toBe(131049);
    expect(err.phone).toBe('60123456789');
    expect(err.message).toContain('131049');
  });

  it('stores instanceId', () => {
    const err = new FrequencyCapError('60111111111', 'southern');
    expect(err.instanceId).toBe('southern');
  });
});

describe('isFrequencyCapError', () => {
  it('returns true for FrequencyCapError', () => {
    expect(isFrequencyCapError(new FrequencyCapError('60111111111'))).toBe(true);
  });

  it('returns false for generic Error', () => {
    expect(isFrequencyCapError(new Error('network error'))).toBe(false);
  });

  it('returns false for non-Error', () => {
    expect(isFrequencyCapError('not an error')).toBe(false);
    expect(isFrequencyCapError(null)).toBe(false);
    expect(isFrequencyCapError({ code: 131049 })).toBe(false);
  });
});

describe('detectFrequencyCapInResponse', () => {
  it('detects 131049 in Cloud API nested errors array', () => {
    const body = {
      error: {
        message: 'Message failed to send',
        code: 100,
        errors: [{ code: 131049, title: 'Re-engagement message' }],
      },
    };
    expect(detectFrequencyCapInResponse(body)).toBe(true);
  });

  it('detects 131049 in top-level errors array', () => {
    const body = {
      errors: [{ code: 131049, title: 'Marketing frequency cap exceeded' }],
    };
    expect(detectFrequencyCapInResponse(body)).toBe(true);
  });

  it('detects 131049 in flat code field', () => {
    expect(detectFrequencyCapInResponse({ code: 131049 })).toBe(true);
  });

  it('detects 131049 in error.code field', () => {
    expect(detectFrequencyCapInResponse({ error: { code: 131049 } })).toBe(true);
  });

  it('returns false when code is different', () => {
    const body = {
      error: { errors: [{ code: 131051 }] },
    };
    expect(detectFrequencyCapInResponse(body)).toBe(false);
  });

  it('returns false for empty or non-object input', () => {
    expect(detectFrequencyCapInResponse(null)).toBe(false);
    expect(detectFrequencyCapInResponse('error string')).toBe(false);
    expect(detectFrequencyCapInResponse({})).toBe(false);
  });

  it('handles string codes by coercing to number', () => {
    expect(detectFrequencyCapInResponse({ code: '131049' })).toBe(true);
    expect(detectFrequencyCapInResponse({ errors: [{ code: '131049' }] })).toBe(true);
  });
});

describe('recordFrequencyCap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a row to rainbow_messages with source = frequency_capped', async () => {
    const { db } = await import('../../lib/db.js');
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    (db.insert as any).mockReturnValue({ values: valuesMock });

    await recordFrequencyCap('60123456789', 'Hello promo', 'pelangi');

    expect(db.insert).toHaveBeenCalled();
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '60123456789',
        role: 'assistant',
        source: 'frequency_capped',
      })
    );
  });

  it('calls notifyFn when threshold is exceeded', async () => {
    const { db } = await import('../../lib/db.js');
    (db.insert as any).mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

    const notifyFn = vi.fn().mockResolvedValue(undefined);

    // Simulate high rejection rate: call recordFrequencyCap 6 times
    // Each call increments outboundCount (when starting from 0) + cappedCount
    // Use a unique instance to avoid state from other tests
    const instanceId = `test-threshold-${Date.now()}`;
    for (let i = 0; i < 6; i++) {
      trackOutboundMarketing(instanceId);
    }
    // Now cappedCount / outboundCount should cross 10%
    for (let i = 0; i < 2; i++) {
      await recordFrequencyCap('60111111111', 'promo', instanceId, notifyFn);
    }

    // With outboundCount=6, cappedCount=2 → 33% > 10%
    expect(notifyFn).toHaveBeenCalled();
  });

  it('does NOT call notifyFn when below threshold', async () => {
    const { db } = await import('../../lib/db.js');
    (db.insert as any).mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

    const notifyFn = vi.fn().mockResolvedValue(undefined);
    const instanceId = `test-below-${Date.now()}`;

    // 1 capped out of 100 = 1% < 10%
    for (let i = 0; i < 100; i++) {
      trackOutboundMarketing(instanceId);
    }
    await recordFrequencyCap('60111111111', 'promo', instanceId, notifyFn);

    expect(notifyFn).not.toHaveBeenCalled();
  });
});

describe('getFrequencyCapStats24h', () => {
  it('returns total and byInstance from DB rows', async () => {
    const { db } = await import('../../lib/db.js');
    (db.execute as any).mockResolvedValue({
      rows: [
        { profile_id: 'pelangi', cnt: 3 },
        { profile_id: 'southern', cnt: 1 },
      ],
    });

    const stats = await getFrequencyCapStats24h();

    expect(stats.total).toBe(4);
    expect(stats.byInstance).toEqual({ pelangi: 3, southern: 1 });
  });

  it('returns zero total when no rows', async () => {
    const { db } = await import('../../lib/db.js');
    (db.execute as any).mockResolvedValue({ rows: [] });

    const stats = await getFrequencyCapStats24h();

    expect(stats.total).toBe(0);
    expect(stats.byInstance).toEqual({});
  });
});
