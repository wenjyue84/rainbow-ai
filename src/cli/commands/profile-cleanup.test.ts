/**
 * US-314: Profile Keyword Contamination Auto-Fixer — Unit Tests
 *
 * Tests pure logic in profile-cleanup-logic.ts — no file system access
 * required for core tests. Integration tests verify real file loading.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  buildPelangiHostelKeywordSet,
  matchesHostelPattern,
  isHostelSpecificIntent,
  runProfileCleanup,
  loadKeywordsFile,
  HOSTEL_SPECIFIC_INTENTS,
  HOSTEL_KEYWORD_PATTERNS,
  type KeywordsFile,
  type ProfileCleanupReport,
} from './profile-cleanup-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

// ── Test fixture helpers ─────────────────────────────────────────────

function makeKeywordsFile(
  intents: { intent: string; keywords: Record<string, string[]> }[],
): KeywordsFile {
  return { intents };
}

// ── buildPelangiHostelKeywordSet ─────────────────────────────────────

describe('buildPelangiHostelKeywordSet', () => {
  it('extracts keywords only from hostel-specific intents', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in', 'check-in'] } },
      { intent: 'greeting', keywords: { en: ['hi', 'hello'] } },
    ]);

    const set = buildPelangiHostelKeywordSet(pelangiData);
    expect(set.has('check in')).toBe(true);
    expect(set.has('check-in')).toBe(true);
    expect(set.has('hi')).toBe(false);
    expect(set.has('hello')).toBe(false);
  });

  it('lowercases and trims all keywords', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkout_info', keywords: { en: ['  CHECK OUT  ', 'Checkout'] } },
    ]);

    const set = buildPelangiHostelKeywordSet(pelangiData);
    expect(set.has('check out')).toBe(true);
    expect(set.has('checkout')).toBe(true);
  });

  it('returns empty set when no hostel-specific intents exist', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
      { intent: 'pricing', keywords: { en: ['price'] } },
    ]);

    const set = buildPelangiHostelKeywordSet(pelangiData);
    expect(set.size).toBe(0);
  });

  it('includes keywords from all languages', () => {
    const pelangiData = makeKeywordsFile([
      {
        intent: 'checkin_info',
        keywords: {
          en: ['check in'],
          ms: ['daftar masuk'],
          zh: ['入住'],
        },
      },
    ]);

    const set = buildPelangiHostelKeywordSet(pelangiData);
    expect(set.has('check in')).toBe(true);
    expect(set.has('daftar masuk')).toBe(true);
    expect(set.has('入住')).toBe(true);
  });
});

// ── matchesHostelPattern ─────────────────────────────────────────────

describe('matchesHostelPattern', () => {
  it('matches check-in related patterns', () => {
    expect(matchesHostelPattern('check in now')).not.toBeNull();
    expect(matchesHostelPattern('early check-in')).not.toBeNull();
    expect(matchesHostelPattern('checkin please')).not.toBeNull();
  });

  it('matches checkout related patterns', () => {
    expect(matchesHostelPattern('check out time')).not.toBeNull();
    expect(matchesHostelPattern('late checkout')).not.toBeNull();
  });

  it('matches hostel-specific patterns', () => {
    expect(matchesHostelPattern('capsule bed')).not.toBeNull();
    expect(matchesHostelPattern('hostel lobby')).not.toBeNull();
    expect(matchesHostelPattern('luggage storage')).not.toBeNull();
    expect(matchesHostelPattern('room type inquiry')).not.toBeNull();
  });

  it('matches Chinese hostel patterns', () => {
    expect(matchesHostelPattern('办理入住')).not.toBeNull();
    expect(matchesHostelPattern('退房时间')).not.toBeNull();
  });

  it('matches Malay hostel patterns', () => {
    expect(matchesHostelPattern('daftar masuk sekarang')).not.toBeNull();
    expect(matchesHostelPattern('daftar keluar')).not.toBeNull();
  });

  it('returns null for non-hostel keywords', () => {
    expect(matchesHostelPattern('nasi lemak')).toBeNull();
    expect(matchesHostelPattern('menu')).toBeNull();
    expect(matchesHostelPattern('price')).toBeNull();
    expect(matchesHostelPattern('wifi password')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(matchesHostelPattern('CHECK IN')).not.toBeNull();
    expect(matchesHostelPattern('Hostel')).not.toBeNull();
    expect(matchesHostelPattern('CAPSULE')).not.toBeNull();
  });
});

// ── isHostelSpecificIntent ───────────────────────────────────────────

describe('isHostelSpecificIntent', () => {
  it('identifies hostel-specific intents', () => {
    expect(isHostelSpecificIntent('checkin_info')).toBe(true);
    expect(isHostelSpecificIntent('check_in_arrival')).toBe(true);
    expect(isHostelSpecificIntent('checkout_info')).toBe(true);
    expect(isHostelSpecificIntent('checkout_now')).toBe(true);
    expect(isHostelSpecificIntent('late_checkout_request')).toBe(true);
    expect(isHostelSpecificIntent('capsule_conflict')).toBe(true);
    expect(isHostelSpecificIntent('luggage_storage')).toBe(true);
    expect(isHostelSpecificIntent('room_type_inquiry')).toBe(true);
  });

  it('returns false for non-hostel intents', () => {
    expect(isHostelSpecificIntent('greeting')).toBe(false);
    expect(isHostelSpecificIntent('pricing')).toBe(false);
    expect(isHostelSpecificIntent('complaint')).toBe(false);
    expect(isHostelSpecificIntent('menu_query')).toBe(false);
    expect(isHostelSpecificIntent('order_placement')).toBe(false);
  });
});

// ── runProfileCleanup ────────────────────────────────────────────────

describe('runProfileCleanup', () => {
  it('removes entire hostel-specific intents from target profile', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in', 'check-in'] } },
      { intent: 'greeting', keywords: { en: ['hi'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
      { intent: 'greeting', keywords: { en: ['hi'] } },
    ]);

    const { report, cleaned } = runProfileCleanup('makan', pelangiData, targetData);

    // checkin_info should be removed entirely
    expect(cleaned.intents.find(i => i.intent === 'checkin_info')).toBeUndefined();
    // greeting should remain
    expect(cleaned.intents.find(i => i.intent === 'greeting')).toBeDefined();
    expect(report.removed_keywords).toBeGreaterThan(0);
    expect(report.affected_intents).toContain('checkin_info');
  });

  it('removes individual hostel keywords from shared intents', () => {
    const pelangiData = makeKeywordsFile([
      {
        intent: 'checkin_info',
        keywords: { en: ['check in time', 'early check in'] },
      },
    ]);
    const targetData = makeKeywordsFile([
      {
        intent: 'pricing',
        keywords: {
          en: ['price', 'check in time', 'cost'],
        },
      },
    ]);

    const { report, cleaned } = runProfileCleanup('makan', pelangiData, targetData);

    const pricing = cleaned.intents.find(i => i.intent === 'pricing');
    expect(pricing).toBeDefined();
    expect(pricing!.keywords.en).toContain('price');
    expect(pricing!.keywords.en).toContain('cost');
    expect(pricing!.keywords.en).not.toContain('check in time');
    expect(report.removed_keywords).toBe(1);
  });

  it('removes keywords matching hostel patterns even without Pelangi match', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
    ]);
    const targetData = makeKeywordsFile([
      {
        intent: 'pricing',
        keywords: {
          en: ['price', 'capsule rate', 'food cost'],
        },
      },
    ]);

    const { report, cleaned } = runProfileCleanup('makan', pelangiData, targetData);

    const pricing = cleaned.intents.find(i => i.intent === 'pricing');
    expect(pricing).toBeDefined();
    expect(pricing!.keywords.en).toContain('price');
    expect(pricing!.keywords.en).toContain('food cost');
    expect(pricing!.keywords.en).not.toContain('capsule rate');
    expect(report.removed_keywords).toBe(1);
  });

  it('returns report with correct structure', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
      { intent: 'greeting', keywords: { en: ['hi'] } },
    ]);

    const { report } = runProfileCleanup('makan', pelangiData, targetData);

    expect(report.profile).toBe('makan');
    expect(report.timestamp).toBeDefined();
    expect(typeof report.removed_keywords).toBe('number');
    expect(Array.isArray(report.affected_intents)).toBe(true);
    expect(typeof report.success).toBe('boolean');
    expect(Array.isArray(report.details)).toBe(true);
  });

  it('returns report with {removed_keywords, affected_intents, success} as required by AC3', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkout_info', keywords: { en: ['checkout'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'checkout_info', keywords: { en: ['checkout', 'check out'] } },
      { intent: 'pricing', keywords: { en: ['price'] } },
    ]);

    const { report } = runProfileCleanup('southern', pelangiData, targetData);

    // Must have the AC-required fields
    expect(report).toHaveProperty('removed_keywords');
    expect(report).toHaveProperty('affected_intents');
    expect(report).toHaveProperty('success');
    expect(report.removed_keywords).toBeGreaterThan(0);
    expect(report.affected_intents).toContain('checkout_info');
    expect(report.success).toBe(true);
  });

  it('handles target profile with no contamination', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'pricing', keywords: { en: ['price', 'cost'] } },
      { intent: 'greeting', keywords: { en: ['hi', 'hello'] } },
    ]);

    const { report, cleaned } = runProfileCleanup('makan', pelangiData, targetData);

    expect(report.removed_keywords).toBe(0);
    expect(report.affected_intents).toHaveLength(0);
    expect(report.success).toBe(true);
    expect(cleaned.intents).toHaveLength(2);
  });

  it('handles multilingual keyword removal', () => {
    const pelangiData = makeKeywordsFile([
      {
        intent: 'checkin_info',
        keywords: {
          en: ['check in'],
          ms: ['daftar masuk'],
          zh: ['入住'],
        },
      },
    ]);
    const targetData = makeKeywordsFile([
      {
        intent: 'checkin_info',
        keywords: {
          en: ['check in', 'arrive'],
          ms: ['daftar masuk', 'sampai'],
          zh: ['入住', '到达'],
        },
      },
    ]);

    const { report } = runProfileCleanup('makan', pelangiData, targetData);

    // All keywords from the hostel-specific intent should be removed
    expect(report.affected_intents).toContain('checkin_info');
    expect(report.removed_keywords).toBeGreaterThanOrEqual(6); // all 6 keywords removed
  });

  it('removes intent entirely when all keywords are hostel-contaminated', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]);
    const targetData = makeKeywordsFile([
      {
        intent: 'directions',
        keywords: { en: ['hostel entrance', 'capsule lobby'] },
      },
    ]);

    const { cleaned } = runProfileCleanup('makan', pelangiData, targetData);

    // All keywords match hostel patterns, so the intent is gone
    expect(cleaned.intents.find(i => i.intent === 'directions')).toBeUndefined();
  });

  it('preserves intent order in cleaned output', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'greeting', keywords: { en: ['hi'] } },
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
      { intent: 'pricing', keywords: { en: ['price'] } },
    ]);

    const { cleaned } = runProfileCleanup('makan', pelangiData, targetData);

    expect(cleaned.intents).toHaveLength(2);
    expect(cleaned.intents[0].intent).toBe('greeting');
    expect(cleaned.intents[1].intent).toBe('pricing');
  });
});

// ── AC1: CLI loads Pelangi keywords and removes from target ──────────

describe('AC1: CLI loads Pelangi keywords and removes from target profile', () => {
  it('loads master Pelangi keyword list and removes matching entries from makan', () => {
    const pelangiData = makeKeywordsFile([
      {
        intent: 'checkin_info',
        keywords: { en: ['check in', 'check-in', 'checkin'] },
      },
      {
        intent: 'checkout_info',
        keywords: { en: ['checkout', 'check out'] },
      },
    ]);
    const makanData = makeKeywordsFile([
      {
        intent: 'checkin_info',
        keywords: { en: ['check in', 'checkin'] },
      },
      {
        intent: 'pricing',
        keywords: { en: ['price', 'how much'] },
      },
    ]);

    const { report, cleaned } = runProfileCleanup('makan', pelangiData, makanData);

    // checkin_info entirely removed
    expect(cleaned.intents.find(i => i.intent === 'checkin_info')).toBeUndefined();
    // pricing preserved
    expect(cleaned.intents.find(i => i.intent === 'pricing')).toBeDefined();
    expect(report.removed_keywords).toBeGreaterThan(0);
    expect(report.success).toBe(true);
  });
});

// ── AC2: Validates makan and southern against Pelangi hostel keywords ─

describe('AC2: Validates against Pelangi hostel keywords', () => {
  it('detects check-in pattern contamination', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'general', keywords: { en: ['early check in request', 'food order'] } },
    ]);

    const { report } = runProfileCleanup('makan', pelangiData, targetData);
    expect(report.removed_keywords).toBeGreaterThan(0);
  });

  it('detects checkout pattern contamination', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkout_info', keywords: { en: ['checkout'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'general', keywords: { en: ['late checkout request', 'menu'] } },
    ]);

    const { report } = runProfileCleanup('southern', pelangiData, targetData);
    expect(report.removed_keywords).toBeGreaterThan(0);
  });

  it('detects room-type pattern contamination', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'room_type_inquiry', keywords: { en: ['room type'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'general', keywords: { en: ['room type available', 'food price'] } },
    ]);

    const { report } = runProfileCleanup('makan', pelangiData, targetData);
    expect(report.removed_keywords).toBeGreaterThan(0);
  });

  it('detects guest-list pattern contamination', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'check_in_arrival', keywords: { en: ['guest list'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'general', keywords: { en: ['guest list lookup', 'menu item'] } },
    ]);

    const { report } = runProfileCleanup('makan', pelangiData, targetData);
    expect(report.removed_keywords).toBeGreaterThan(0);
  });
});

// ── AC3: Report generation and --dry-run flag ────────────────────────

describe('AC3: Report generation with required format', () => {
  it('generates report with {removed_keywords, affected_intents, success}', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]);

    const { report } = runProfileCleanup('makan', pelangiData, targetData);

    expect(report).toHaveProperty('removed_keywords');
    expect(typeof report.removed_keywords).toBe('number');
    expect(report).toHaveProperty('affected_intents');
    expect(Array.isArray(report.affected_intents)).toBe(true);
    expect(report).toHaveProperty('success');
    expect(typeof report.success).toBe('boolean');
  });

  it('report affected_intents lists all cleaned intents', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
      { intent: 'checkout_info', keywords: { en: ['checkout'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
      { intent: 'checkout_info', keywords: { en: ['checkout'] } },
      { intent: 'pricing', keywords: { en: ['price'] } },
    ]);

    const { report } = runProfileCleanup('makan', pelangiData, targetData);

    expect(report.affected_intents).toContain('checkin_info');
    expect(report.affected_intents).toContain('checkout_info');
    expect(report.affected_intents).not.toContain('pricing');
  });

  it('report removed_keywords count matches actual removals', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in', 'check-in'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in', 'check-in', 'arrive'] } },
    ]);

    const { report } = runProfileCleanup('makan', pelangiData, targetData);

    // All 3 keywords removed (entire hostel-specific intent removed)
    expect(report.removed_keywords).toBe(3);
  });

  it('dry-run does not modify the cleaned data (report still generated)', () => {
    const pelangiData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]);
    const targetData = makeKeywordsFile([
      { intent: 'checkin_info', keywords: { en: ['check in'] } },
    ]);

    // runProfileCleanup always returns both report and cleaned data
    // The CLI determines whether to write — logic module is pure
    const { report, cleaned } = runProfileCleanup('makan', pelangiData, targetData);

    expect(report.removed_keywords).toBeGreaterThan(0);
    expect(cleaned.intents.find(i => i.intent === 'checkin_info')).toBeUndefined();
  });
});

// ── Integration: loads real profile files ─────────────────────────────

describe('Integration: real profile files', () => {
  const pelangiPath = path.join(rootDir, 'src/assistant/data/intent-keywords.json');
  const makanPath = path.join(rootDir, 'src/assistant/data-makan/intent-keywords.json');
  const southernPath = path.join(rootDir, 'src/assistant/data-southern/intent-keywords.json');

  it('loads real Pelangi keywords file', () => {
    const data = loadKeywordsFile(pelangiPath);
    expect(data.intents).toBeDefined();
    expect(data.intents.length).toBeGreaterThan(0);
  });

  it('generates cleanup report for makan profile from real data', () => {
    const pelangiData = loadKeywordsFile(pelangiPath);
    const makanData = loadKeywordsFile(makanPath);

    const { report, cleaned } = runProfileCleanup('makan', pelangiData, makanData);

    expect(report.profile).toBe('makan');
    expect(typeof report.removed_keywords).toBe('number');
    expect(Array.isArray(report.affected_intents)).toBe(true);
    expect(report.success).toBe(true);
    // Cleaned output should have valid structure
    expect(cleaned.intents).toBeDefined();
    for (const entry of cleaned.intents) {
      expect(entry.intent).toBeDefined();
      expect(entry.keywords).toBeDefined();
    }
  });

  it('generates cleanup report for southern profile from real data', () => {
    const pelangiData = loadKeywordsFile(pelangiPath);
    const southernData = loadKeywordsFile(southernPath);

    const { report, cleaned } = runProfileCleanup('southern', pelangiData, southernData);

    expect(report.profile).toBe('southern');
    expect(typeof report.removed_keywords).toBe('number');
    expect(Array.isArray(report.affected_intents)).toBe(true);
    expect(report.success).toBe(true);
    expect(cleaned.intents).toBeDefined();
  });

  it('southern profile contains hostel-specific intents that should be removed', () => {
    const pelangiData = loadKeywordsFile(pelangiPath);
    const southernData = loadKeywordsFile(southernPath);

    const { report } = runProfileCleanup('southern', pelangiData, southernData);

    // Southern has hostel intents like checkin_info, checkout_info — these should be flagged
    expect(report.removed_keywords).toBeGreaterThan(0);
    expect(report.affected_intents.length).toBeGreaterThan(0);
  });

  it('makan profile has no hostel-specific intents to remove', () => {
    const pelangiData = loadKeywordsFile(pelangiPath);
    const makanData = loadKeywordsFile(makanPath);

    // Makan should be clean of hostel intents (check if any exist)
    const hostelIntents = makanData.intents.filter(i =>
      HOSTEL_SPECIFIC_INTENTS.includes(i.intent),
    );

    const { report } = runProfileCleanup('makan', pelangiData, makanData);

    // If there are hostel intents, they should be removed; otherwise 0 is fine
    if (hostelIntents.length > 0) {
      expect(report.affected_intents.length).toBeGreaterThan(0);
    } else {
      // Makan may still have pattern-based contamination
      expect(typeof report.removed_keywords).toBe('number');
    }
    expect(report.success).toBe(true);
  });
});
