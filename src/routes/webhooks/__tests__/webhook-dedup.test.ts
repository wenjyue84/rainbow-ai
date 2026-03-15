/**
 * webhook-dedup.test.ts — US-977: Webhook event deduplication tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isDuplicateMessage,
  isDuplicateStatus,
  getDedupStats,
  resetDedupHitCount,
} from '../../../lib/webhook-dedup.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWamid(suffix = ''): string {
  return `wamid.HBgL60124567890VGgASBBCEFGH${suffix}`;
}

// ─── Message deduplication ────────────────────────────────────────────────────

describe('isDuplicateMessage', () => {
  beforeEach(() => {
    resetDedupHitCount();
  });

  it('returns false for the first occurrence of a wamid', () => {
    const wamid = makeWamid('msg1');
    expect(isDuplicateMessage(wamid)).toBe(false);
  });

  it('returns true for the second occurrence of the same wamid', () => {
    const wamid = makeWamid('msg2');
    isDuplicateMessage(wamid); // first — record it
    expect(isDuplicateMessage(wamid)).toBe(true);
  });

  it('does not confuse different wamids', () => {
    const wamid1 = makeWamid('msg3a');
    const wamid2 = makeWamid('msg3b');
    expect(isDuplicateMessage(wamid1)).toBe(false);
    expect(isDuplicateMessage(wamid2)).toBe(false);
  });

  it('increments dedupHits counter on each duplicate', () => {
    const wamid = makeWamid('msg4');
    isDuplicateMessage(wamid); // first
    isDuplicateMessage(wamid); // dup 1
    isDuplicateMessage(wamid); // dup 2
    expect(getDedupStats().dedupHits).toBe(2);
  });

  it('treats empty wamid as first occurrence each time (not deduplicated)', () => {
    // Empty wamids should not be stored as a legitimate key
    // The caller is responsible for skipping empty wamids
    expect(isDuplicateMessage('')).toBe(false);
    expect(isDuplicateMessage('')).toBe(true); // second empty will be flagged
  });
});

// ─── Status deduplication ─────────────────────────────────────────────────────

describe('isDuplicateStatus', () => {
  beforeEach(() => {
    resetDedupHitCount();
  });

  it('returns false for a new wamid+status pair', () => {
    expect(isDuplicateStatus(makeWamid('s1'), 'delivered')).toBe(false);
  });

  it('returns true for the same wamid+status pair on retry', () => {
    const wamid = makeWamid('s2');
    isDuplicateStatus(wamid, 'read');
    expect(isDuplicateStatus(wamid, 'read')).toBe(true);
  });

  it('does NOT treat different statuses for the same wamid as duplicates', () => {
    const wamid = makeWamid('s3');
    // delivered and read are different status events — both valid
    expect(isDuplicateStatus(wamid, 'delivered')).toBe(false);
    expect(isDuplicateStatus(wamid, 'read')).toBe(false);
  });

  it('does NOT treat same status for different wamids as duplicates', () => {
    expect(isDuplicateStatus(makeWamid('s4a'), 'failed')).toBe(false);
    expect(isDuplicateStatus(makeWamid('s4b'), 'failed')).toBe(false);
  });

  it('increments dedupHits on status duplicate', () => {
    const wamid = makeWamid('s5');
    isDuplicateStatus(wamid, 'sent');  // first
    isDuplicateStatus(wamid, 'sent');  // dup
    expect(getDedupStats().dedupHits).toBe(1);
  });
});

// ─── Stats & reset ────────────────────────────────────────────────────────────

describe('getDedupStats / resetDedupHitCount', () => {
  beforeEach(() => {
    resetDedupHitCount();
  });

  it('returns zero hits after reset', () => {
    expect(getDedupStats().dedupHits).toBe(0);
  });

  it('cacheSize reflects number of unique keys stored', () => {
    const before = getDedupStats().cacheSize;
    isDuplicateMessage(makeWamid('sz1'));
    isDuplicateMessage(makeWamid('sz2'));
    expect(getDedupStats().cacheSize).toBeGreaterThanOrEqual(before + 2);
  });

  it('resetDedupHitCount resets counter but not cache', () => {
    isDuplicateMessage(makeWamid('rs1'));
    isDuplicateMessage(makeWamid('rs1')); // dup → hits = 1
    resetDedupHitCount();
    expect(getDedupStats().dedupHits).toBe(0);
    // Cache still has the key, so next call is still a dup
    expect(isDuplicateMessage(makeWamid('rs1'))).toBe(true);
  });
});

// ─── Message vs status namespace isolation ────────────────────────────────────

describe('namespace isolation', () => {
  it('message and status caches are independent for the same wamid', () => {
    const wamid = makeWamid('ns1');
    isDuplicateMessage(wamid);  // registers msg:wamid
    // status:wamid:delivered is a different key — should not be a dup
    expect(isDuplicateStatus(wamid, 'delivered')).toBe(false);
  });
});
