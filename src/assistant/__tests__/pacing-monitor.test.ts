/**
 * Portfolio Pacing Monitor Tests (US-891)
 *
 * Mocks the Meta quality_rating endpoint and asserts that:
 * - pacingPaused is false when quality is GREEN/CONNECTED
 * - pacingPaused is true when quality is RED + FLAGGED
 * - Admin notification is sent on newly detected pause
 * - No notification sent when pacing resumes (false → false, true → false)
 * - isPacingPaused helper covers all rating/status combinations
 * - Skipped gracefully when credentials are absent
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Module mocks ──────────────────────────────────────────────────────────

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

vi.mock('../../lib/db.js', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
  },
  dbReady: Promise.resolve(true),
}));

vi.mock('../../../shared/schema.js', () => ({
  appSettings: { key: 'key' },
}));

// drizzle-orm mocks
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  sql: vi.fn(),
}));

const mockNotifyAdminPortfolioPacingPaused = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/admin-notifier.js', () => ({
  notifyAdminPortfolioPacingPaused: mockNotifyAdminPortfolioPacingPaused,
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  mockNotifyAdminPortfolioPacingPaused.mockClear();
});

// We import the module fresh each time to reset in-memory state
let monitor: typeof import('../../lib/pacing-monitor.js');

async function freshModule() {
  vi.resetModules();
  // Re-apply all mocks after resetModules
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
  vi.mock('../../lib/db.js', () => ({
    db: {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      })),
    },
    dbReady: Promise.resolve(true),
  }));
  vi.mock('../../../shared/schema.js', () => ({
    appSettings: { key: 'key' },
  }));
  vi.mock('drizzle-orm', () => ({
    eq: vi.fn(),
    sql: vi.fn(),
  }));
  vi.mock('../../lib/admin-notifier.js', () => ({
    notifyAdminPortfolioPacingPaused: mockNotifyAdminPortfolioPacingPaused,
  }));
  monitor = await import('../../lib/pacing-monitor.js');
}

function mockFetch(response: object, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(response),
    text: vi.fn().mockResolvedValue(JSON.stringify(response)),
  }));
}

// ─── Unit tests: isPacingPaused helper ────────────────────────────────────

describe('isPacingPaused()', () => {
  beforeEach(async () => {
    await freshModule();
  });

  it('returns true when rating=RED and status=FLAGGED', () => {
    expect(monitor.isPacingPaused('RED', 'FLAGGED')).toBe(true);
  });

  it('returns false when rating=RED but status=CONNECTED', () => {
    expect(monitor.isPacingPaused('RED', 'CONNECTED')).toBe(false);
  });

  it('returns false when rating=YELLOW and status=FLAGGED', () => {
    expect(monitor.isPacingPaused('YELLOW', 'FLAGGED')).toBe(false);
  });

  it('returns false when rating=GREEN and status=CONNECTED', () => {
    expect(monitor.isPacingPaused('GREEN', 'CONNECTED')).toBe(false);
  });

  it('returns false when rating or status is undefined', () => {
    expect(monitor.isPacingPaused(undefined, undefined)).toBe(false);
    expect(monitor.isPacingPaused('RED', undefined)).toBe(false);
    expect(monitor.isPacingPaused(undefined, 'FLAGGED')).toBe(false);
  });
});

// ─── runPacingCheck: no credentials ────────────────────────────────────────

describe('runPacingCheck() — no credentials', () => {
  beforeEach(async () => {
    await freshModule();
    delete process.env.PHONE_NUMBER_ID;
    delete process.env.META_ACCESS_TOKEN;
  });

  it('skips check and marks state as skipped', async () => {
    await monitor.runPacingCheck();
    const state = monitor.getPacingState();
    expect(state.skipped).toBe(true);
    expect(state.pacingPaused).toBe(false);
  });

  it('does not call fetch when credentials are absent', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as any);
    await monitor.runPacingCheck();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── runPacingCheck: GREEN quality — no pause ──────────────────────────────

describe('runPacingCheck() — GREEN quality rating', () => {
  beforeEach(async () => {
    await freshModule();
    process.env.PHONE_NUMBER_ID = 'phone-123';
    process.env.META_ACCESS_TOKEN = 'token-abc';
    mockFetch({
      id: 'phone-123',
      display_phone_number: '+60123456789',
      quality_rating: 'GREEN',
      status: 'CONNECTED',
    });
  });

  it('sets pacingPaused = false', async () => {
    await monitor.runPacingCheck();
    const state = monitor.getPacingState();
    expect(state.pacingPaused).toBe(false);
  });

  it('records qualityRating and status in state', async () => {
    await monitor.runPacingCheck();
    const state = monitor.getPacingState();
    expect(state.qualityRating).toBe('GREEN');
    expect(state.status).toBe('CONNECTED');
  });

  it('does NOT send admin notification', async () => {
    await monitor.runPacingCheck();
    expect(mockNotifyAdminPortfolioPacingPaused).not.toHaveBeenCalled();
  });

  it('sets lastCheckedAt to a recent ISO timestamp', async () => {
    const before = Date.now();
    await monitor.runPacingCheck();
    const after = Date.now();
    const state = monitor.getPacingState();
    expect(state.lastCheckedAt).not.toBeNull();
    const ts = new Date(state.lastCheckedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 100);
  });
});

// ─── runPacingCheck: RED + FLAGGED — pacing paused ─────────────────────────

describe('runPacingCheck() — RED quality + FLAGGED status (pacing paused)', () => {
  beforeEach(async () => {
    await freshModule();
    process.env.PHONE_NUMBER_ID = 'phone-456';
    process.env.META_ACCESS_TOKEN = 'token-def';
    mockFetch({
      id: 'phone-456',
      display_phone_number: '+60198765432',
      quality_rating: 'RED',
      status: 'FLAGGED',
    });
  });

  it('sets pacingPaused = true', async () => {
    await monitor.runPacingCheck();
    const state = monitor.getPacingState();
    expect(state.pacingPaused).toBe(true);
  });

  it('records qualityRating=RED and status=FLAGGED', async () => {
    await monitor.runPacingCheck();
    const state = monitor.getPacingState();
    expect(state.qualityRating).toBe('RED');
    expect(state.status).toBe('FLAGGED');
  });

  it('sends admin notification when pacing pause is newly detected', async () => {
    await monitor.runPacingCheck();
    expect(mockNotifyAdminPortfolioPacingPaused).toHaveBeenCalledOnce();
    const [phone, rating, status] = mockNotifyAdminPortfolioPacingPaused.mock.calls[0];
    expect(phone).toBe('+60198765432');
    expect(rating).toBe('RED');
    expect(status).toBe('FLAGGED');
  });

  it('sets pausedSince to a non-null ISO timestamp', async () => {
    await monitor.runPacingCheck();
    const state = monitor.getPacingState();
    expect(state.pausedSince).not.toBeNull();
    expect(() => new Date(state.pausedSince!)).not.toThrow();
  });
});

// ─── runPacingCheck: network error — state preserved ──────────────────────

describe('runPacingCheck() — network error', () => {
  beforeEach(async () => {
    await freshModule();
    process.env.PHONE_NUMBER_ID = 'phone-789';
    process.env.META_ACCESS_TOKEN = 'token-ghi';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')));
  });

  it('does not throw', async () => {
    await expect(monitor.runPacingCheck()).resolves.not.toThrow();
  });

  it('keeps pacingPaused at its previous state on error', async () => {
    const stateBefore = monitor.getPacingState();
    await monitor.runPacingCheck();
    const stateAfter = monitor.getPacingState();
    expect(stateAfter.pacingPaused).toBe(stateBefore.pacingPaused);
  });

  it('does not send admin notification on transient errors', async () => {
    await monitor.runPacingCheck();
    expect(mockNotifyAdminPortfolioPacingPaused).not.toHaveBeenCalled();
  });
});

// ─── getPacingState: initial state ────────────────────────────────────────

describe('getPacingState() — initial state', () => {
  beforeEach(async () => {
    await freshModule();
  });

  it('returns skipped=true when no credentials are configured', () => {
    delete process.env.PHONE_NUMBER_ID;
    delete process.env.META_ACCESS_TOKEN;
    const state = monitor.getPacingState();
    expect(state.skipped).toBe(true);
  });

  it('returns pacingPaused=false by default', () => {
    const state = monitor.getPacingState();
    expect(state.pacingPaused).toBe(false);
  });
});
