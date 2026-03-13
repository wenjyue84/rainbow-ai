/**
 * Phone Number Quality State Manager Tests (US-458)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config-db before importing the module
vi.mock('../../lib/config-db.js', () => ({
  loadConfigFromDB: vi.fn().mockResolvedValue(null),
  saveConfigToDB: vi.fn().mockResolvedValue(undefined),
}));

// Dynamic import to get a fresh module for each test
let phoneQuality: typeof import('../../lib/phone-quality.js');

beforeEach(async () => {
  vi.resetModules();
  vi.mock('../../lib/config-db.js', () => ({
    loadConfigFromDB: vi.fn().mockResolvedValue(null),
    saveConfigToDB: vi.fn().mockResolvedValue(undefined),
  }));
  phoneQuality = await import('../../lib/phone-quality.js');
});

describe('Phone Quality State Manager', () => {
  it('returns UNKNOWN state for new profiles', () => {
    const state = phoneQuality.getQualityState('test-profile');
    expect(state.rating).toBe('UNKNOWN');
    expect(state.status).toBe('UNKNOWN');
  });

  it('does not block outbound for unknown profiles', () => {
    expect(phoneQuality.isOutboundBlocked('test-profile')).toBe(false);
  });

  it('blocks outbound when status is FLAGGED', async () => {
    await phoneQuality.updateQualityState('test-profile', {
      rating: 'YELLOW',
      status: 'FLAGGED',
      event: 'FLAGGED',
    });
    expect(phoneQuality.isOutboundBlocked('test-profile')).toBe(true);
  });

  it('blocks outbound when status is RESTRICTED', async () => {
    await phoneQuality.updateQualityState('test-profile', {
      rating: 'RED',
      status: 'RESTRICTED',
      event: 'FLAGGED',
    });
    expect(phoneQuality.isOutboundBlocked('test-profile')).toBe(true);
  });

  it('lifts block when status returns to CONNECTED with GREEN', async () => {
    await phoneQuality.updateQualityState('test-profile', {
      rating: 'YELLOW',
      status: 'FLAGGED',
      event: 'FLAGGED',
    });
    expect(phoneQuality.isOutboundBlocked('test-profile')).toBe(true);

    await phoneQuality.updateQualityState('test-profile', {
      rating: 'GREEN',
      status: 'CONNECTED',
      event: 'UNFLAGGED',
    });
    expect(phoneQuality.isOutboundBlocked('test-profile')).toBe(false);
  });

  it('lifts block when status returns to CONNECTED with YELLOW', async () => {
    await phoneQuality.updateQualityState('test-profile', {
      status: 'FLAGGED',
      event: 'FLAGGED',
    });
    expect(phoneQuality.isOutboundBlocked('test-profile')).toBe(true);

    await phoneQuality.updateQualityState('test-profile', {
      rating: 'YELLOW',
      status: 'CONNECTED',
      event: 'UNFLAGGED',
    });
    expect(phoneQuality.isOutboundBlocked('test-profile')).toBe(false);
  });

  it('updates quality rating on QUALITY_SCORE_CHANGE', async () => {
    await phoneQuality.updateQualityState('test-profile', {
      rating: 'GREEN',
      status: 'CONNECTED',
    });
    await phoneQuality.updateQualityState('test-profile', {
      rating: 'RED',
      event: 'QUALITY_SCORE_CHANGE',
    });
    const state = phoneQuality.getQualityState('test-profile');
    expect(state.rating).toBe('RED');
    expect(state.status).toBe('CONNECTED'); // Status preserved
  });

  it('getAllQualityStates returns all profiles', async () => {
    await phoneQuality.updateQualityState('pelangi', {
      rating: 'GREEN',
      status: 'CONNECTED',
    });
    await phoneQuality.updateQualityState('southern', {
      rating: 'YELLOW',
      status: 'FLAGGED',
    });
    const all = phoneQuality.getAllQualityStates();
    expect(Object.keys(all)).toContain('pelangi');
    expect(Object.keys(all)).toContain('southern');
    expect(all['pelangi'].rating).toBe('GREEN');
    expect(all['southern'].status).toBe('FLAGGED');
  });

  it('persists phoneNumber and messagingLimitTier', async () => {
    await phoneQuality.updateQualityState('test-profile', {
      rating: 'GREEN',
      status: 'CONNECTED',
      phoneNumber: '+60123456789',
      messagingLimitTier: '10000',
    });
    const state = phoneQuality.getQualityState('test-profile');
    expect(state.phoneNumber).toBe('+60123456789');
    expect(state.messagingLimitTier).toBe('10000');
  });
});
