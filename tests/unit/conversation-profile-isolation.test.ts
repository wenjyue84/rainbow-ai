/**
 * Tests for conversation message profile isolation (US-061).
 *
 * Covers: matching profile_id passes, mismatched profile_id throws, null profile_id is tolerated.
 */

import { describe, it, expect } from 'vitest';
import { ProfileMismatchError, validateMessageProfiles } from '../../src/lib/conversation.js';

// Minimal message stub — only profileId is used by validateMessageProfiles
type MsgStub = { profileId: string | null };

function msgs(...profileIds: Array<string | null>): MsgStub[] {
  return profileIds.map((profileId) => ({ profileId }));
}

describe('ProfileMismatchError', () => {
  it('has correct name, phone, expectedProfileId, foundProfileId', () => {
    const err = new ProfileMismatchError('6012345678', 'pelangi', 'makan-moments');
    expect(err.name).toBe('ProfileMismatchError');
    expect(err.phone).toBe('6012345678');
    expect(err.expectedProfileId).toBe('pelangi');
    expect(err.foundProfileId).toBe('makan-moments');
    expect(err.message).toMatch(/pelangi/);
    expect(err.message).toMatch(/makan-moments/);
  });

  it('is an instance of Error', () => {
    const err = new ProfileMismatchError('phone', 'pelangi', 'southern');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ProfileMismatchError).toBe(true);
  });
});

describe('validateMessageProfiles', () => {
  // ─── Passing cases ───────────────────────────────────────────

  it('does not throw when all messages match expected profile', () => {
    expect(() =>
      validateMessageProfiles(msgs('pelangi', 'pelangi', 'pelangi'), 'pelangi', 'phone1')
    ).not.toThrow();
  });

  it('does not throw on empty message array', () => {
    expect(() => validateMessageProfiles([], 'pelangi', 'phone1')).not.toThrow();
  });

  it('does not throw when profile_id is null (legacy rows without profile context)', () => {
    expect(() =>
      validateMessageProfiles(msgs(null, null), 'pelangi', 'phone1')
    ).not.toThrow();
  });

  it('does not throw when null and matching profile_ids are mixed', () => {
    expect(() =>
      validateMessageProfiles(msgs('pelangi', null, 'pelangi'), 'pelangi', 'phone1')
    ).not.toThrow();
  });

  // ─── Rejection cases ─────────────────────────────────────────

  it('throws ProfileMismatchError when a message has a different profile_id', () => {
    expect(() =>
      validateMessageProfiles(msgs('pelangi', 'makan-moments'), 'pelangi', 'phone1')
    ).toThrow(ProfileMismatchError);
  });

  it('throws on first mismatch, not silently continues', () => {
    expect(() =>
      validateMessageProfiles(msgs('makan-moments', 'pelangi'), 'pelangi', 'phone1')
    ).toThrow(ProfileMismatchError);
  });

  it('includes the mismatched profile_id in the error', () => {
    let caught: unknown;
    try {
      validateMessageProfiles(msgs('southern'), 'pelangi', 'phone99');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProfileMismatchError);
    const err = caught as ProfileMismatchError;
    expect(err.foundProfileId).toBe('southern');
    expect(err.expectedProfileId).toBe('pelangi');
    expect(err.phone).toBe('phone99');
  });

  it('throws for makan-moments messages in a pelangi conversation', () => {
    expect(() =>
      validateMessageProfiles(
        msgs('pelangi', 'pelangi', 'makan-moments', 'pelangi'),
        'pelangi',
        '60123456789'
      )
    ).toThrow(/makan-moments/);
  });

  it('throws for pelangi messages in a southern conversation', () => {
    expect(() =>
      validateMessageProfiles(msgs('southern', 'pelangi'), 'southern', 'phone2')
    ).toThrow(ProfileMismatchError);
  });
});
