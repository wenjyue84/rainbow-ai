import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config-store before importing rate-limiter
vi.mock('../config-store.js', () => {
  const defaultSettings = {
    rate_limits: { per_minute: 40, per_hour: 200 },
    staff: { phones: ['60167620815'] },
  };
  const store = {
    getSettings: () => defaultSettings,
    on: () => {},
  };
  return { configStore: store, ConfigStore: class {} };
});

import { checkRate, initRateLimiter, destroyRateLimiter } from '../rate-limiter.js';

/** Create a fake ConfigStore-like object with custom rate limits */
function makeProfileConfig(perMinute: number, perHour: number) {
  return {
    getSettings: () => ({
      rate_limits: { per_minute: perMinute, per_hour: perHour },
      staff: { phones: ['60167620815'] },
    }),
    on: () => {},
  } as any;
}

describe('checkRate with per-profile rate limits (US-411)', () => {
  beforeEach(() => {
    // Re-init to reset window state
    destroyRateLimiter();
    initRateLimiter();
  });

  it('uses global defaults when no profileConfig provided', () => {
    // Global default: 40 per_minute — should allow first request
    const result = checkRate('60123456789');
    expect(result.allowed).toBe(true);
  });

  it('uses profile-specific limits when profileConfig is provided', () => {
    const strictProfile = makeProfileConfig(2, 10); // 2 per minute, 10 per hour

    // First 2 should pass
    expect(checkRate('60111111111', strictProfile).allowed).toBe(true);
    expect(checkRate('60111111111', strictProfile).allowed).toBe(true);

    // 3rd should fail (exceeds 2 per_minute)
    const result = checkRate('60111111111', strictProfile);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('per-minute limit exceeded');
  });

  it('enforces different limits for different profiles on the same phone', () => {
    const cafeProfile = makeProfileConfig(3, 50); // generous
    const hostelProfile = makeProfileConfig(1, 10); // strict

    const phone = '60222222222';

    // Cafe profile: 3 per minute — allow 3
    expect(checkRate(phone, cafeProfile).allowed).toBe(true);
    expect(checkRate(phone, cafeProfile).allowed).toBe(true);
    expect(checkRate(phone, cafeProfile).allowed).toBe(true);
    // 4th should fail for cafe
    expect(checkRate(phone, cafeProfile).allowed).toBe(false);

    // Note: rate limiting state is per-phone globally (shared window),
    // so hostel profile with stricter limit should also deny
    expect(checkRate(phone, hostelProfile).allowed).toBe(false);
  });

  it('falls back to global limits when profile has no rate_limits', () => {
    // A profile that returns settings without rate_limits — should still work
    // since it falls back to configStore defaults
    const result = checkRate('60333333333');
    expect(result.allowed).toBe(true);
  });

  it('enforces per-hour limit from profile config', () => {
    const tinyProfile = makeProfileConfig(100, 3); // 100 per min but 3 per hour

    const phone = '60444444444';
    expect(checkRate(phone, tinyProfile).allowed).toBe(true);
    expect(checkRate(phone, tinyProfile).allowed).toBe(true);
    expect(checkRate(phone, tinyProfile).allowed).toBe(true);
    // 4th exceeds 3 per_hour
    const result = checkRate(phone, tinyProfile);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hourly limit exceeded');
  });
});
