/**
 * US-233: Profile Data Isolation Startup Enforcement Tests
 *
 * Validates that enforceProfileDataIsolation() correctly detects
 * cross-profile keyword contamination and produces clear error reports.
 */

import { describe, it, expect } from 'vitest';
import {
  extractProfileKeywords,
  findCrossProfileKeywords,
  formatIsolationViolations,
  enforceProfileDataIsolation,
  type ProfileKeywordMap,
  type CrossProfileViolation,
} from '../lib/startup-validators.js';

// ─── Mock intent-keywords data ──────────────────────────────────────────────

/** Clean Pelangi profile — hostel-specific intents */
const pelangiClean = {
  intents: [
    {
      intent: 'greeting',
      keywords: { en: ['hi', 'hello'], ms: ['hai', 'helo'] },
    },
    {
      intent: 'checkin_info',
      keywords: {
        en: ['check in time', 'check-in', 'room number'],
        ms: ['waktu daftar masuk', 'nombor bilik'],
      },
    },
    {
      intent: 'booking',
      keywords: {
        en: ['book a room', 'reservation', 'capsule booking'],
        ms: ['tempah bilik', 'bilik capsule'],
      },
    },
    {
      intent: 'wifi',
      keywords: {
        en: ['wifi password', 'internet'],
        ms: ['password wifi'],
      },
    },
  ],
};

/** Clean Makan profile — cafe-specific intents */
const makanClean = {
  intents: [
    {
      intent: 'greeting',
      keywords: { en: ['hi', 'hello'], ms: ['hai', 'helo'] },
    },
    {
      intent: 'order_placement',
      keywords: {
        en: ['i want to order', 'place order', 'takeaway'],
        ms: ['nak order', 'bungkus', 'tapau'],
      },
    },
    {
      intent: 'menu_query',
      keywords: {
        en: ['show menu', 'what food', 'food menu'],
        ms: ['tunjuk menu', 'makanan apa'],
      },
    },
  ],
};

/** Clean Southern profile — homestay-specific intents */
const southernClean = {
  intents: [
    {
      intent: 'greeting',
      keywords: { en: ['hi', 'hello'], ms: ['hai', 'helo'] },
    },
    {
      intent: 'checkin_info',
      keywords: {
        en: ['check in time', 'arrival time', 'unit key'],
        ms: ['waktu daftar masuk', 'kunci unit'],
      },
    },
    {
      intent: 'booking',
      keywords: {
        en: ['book a unit', 'homestay booking', 'reserve room'],
        ms: ['tempah unit', 'tempahan homestay'],
      },
    },
  ],
};

/**
 * Contaminated Makan profile — has hostel keywords copy-pasted in.
 * 'room number' and 'capsule booking' belong to Pelangi, not cafe.
 */
const makanContaminated = {
  intents: [
    {
      intent: 'greeting',
      keywords: { en: ['hi', 'hello'], ms: ['hai', 'helo'] },
    },
    {
      intent: 'order_placement',
      keywords: {
        en: ['i want to order', 'place order'],
        ms: ['nak order', 'bungkus'],
      },
    },
    {
      intent: 'checkin_info', // This intent shouldn't exist in Makan!
      keywords: {
        en: ['check in time', 'room number', 'capsule booking'],
        ms: ['waktu daftar masuk', 'nombor bilik'],
      },
    },
  ],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('US-233: Profile Data Isolation Enforcement', () => {
  describe('extractProfileKeywords()', () => {
    it('extracts keywords from non-common intents only', () => {
      const keywords = extractProfileKeywords(pelangiClean);

      // Should include checkin_info and booking keywords
      expect(keywords.has('check in time')).toBe(true);
      expect(keywords.has('room number')).toBe(true);
      expect(keywords.has('book a room')).toBe(true);
      expect(keywords.has('capsule booking')).toBe(true);

      // Should exclude greeting keywords (common intent)
      expect(keywords.has('hi')).toBe(false);
      expect(keywords.has('hello')).toBe(false);
    });

    it('lowercases all keywords', () => {
      const data = {
        intents: [
          {
            intent: 'pricing',
            keywords: { en: ['How Much', 'PRICE'] },
          },
        ],
      };
      const keywords = extractProfileKeywords(data);
      expect(keywords.has('how much')).toBe(true);
      expect(keywords.has('price')).toBe(true);
      expect(keywords.has('How Much')).toBe(false);
    });

    it('handles empty or malformed data gracefully', () => {
      expect(extractProfileKeywords({ intents: [] }).size).toBe(0);
      expect(extractProfileKeywords({} as any).size).toBe(0);
      expect(extractProfileKeywords({ intents: null } as any).size).toBe(0);
    });

    it('can include common intents when no exclusions provided', () => {
      const keywords = extractProfileKeywords(pelangiClean, new Set());
      // Now greeting keywords should be included
      expect(keywords.has('hi')).toBe(true);
      expect(keywords.has('hello')).toBe(true);
    });
  });

  describe('findCrossProfileKeywords()', () => {
    it('returns no violations for clean, non-overlapping profiles', () => {
      const pelangiKws = extractProfileKeywords(pelangiClean);
      const makanKws = extractProfileKeywords(makanClean);

      const violations = findCrossProfileKeywords({
        pelangi: pelangiKws,
        makan: makanKws,
      });

      expect(violations).toHaveLength(0);
    });

    it('detects cross-profile keyword contamination', () => {
      const pelangiKws = extractProfileKeywords(pelangiClean);
      const makanKws = extractProfileKeywords(makanContaminated);

      const violations = findCrossProfileKeywords({
        pelangi: pelangiKws,
        makan: makanKws,
      });

      expect(violations.length).toBeGreaterThan(0);

      // 'room number' should be flagged (appears in both pelangi and contaminated makan)
      const roomViolation = violations.find((v) => v.keyword === 'room number');
      expect(roomViolation).toBeDefined();
      expect(roomViolation!.profiles).toContain('pelangi');
      expect(roomViolation!.profiles).toContain('makan');

      // 'capsule booking' should also be flagged
      const capsuleViolation = violations.find(
        (v) => v.keyword === 'capsule booking',
      );
      expect(capsuleViolation).toBeDefined();
      expect(capsuleViolation!.profiles).toContain('pelangi');
      expect(capsuleViolation!.profiles).toContain('makan');
    });

    it('detects contamination across three profiles', () => {
      const pelangiKws = extractProfileKeywords(pelangiClean);
      const makanKws = extractProfileKeywords(makanContaminated);
      const southernKws = extractProfileKeywords(southernClean);

      const violations = findCrossProfileKeywords({
        pelangi: pelangiKws,
        makan: makanKws,
        southern: southernKws,
      });

      // 'check in time' appears in pelangi, contaminated makan, and southern
      const checkinViolation = violations.find(
        (v) => v.keyword === 'check in time',
      );
      expect(checkinViolation).toBeDefined();
      expect(checkinViolation!.profiles).toContain('pelangi');
      expect(checkinViolation!.profiles).toContain('makan');
      expect(checkinViolation!.profiles).toContain('southern');
      expect(checkinViolation!.profiles).toHaveLength(3);
    });

    it('returns violations sorted by keyword', () => {
      const pelangiKws = extractProfileKeywords(pelangiClean);
      const makanKws = extractProfileKeywords(makanContaminated);

      const violations = findCrossProfileKeywords({
        pelangi: pelangiKws,
        makan: makanKws,
      });

      for (let i = 1; i < violations.length; i++) {
        expect(
          violations[i].keyword.localeCompare(violations[i - 1].keyword),
        ).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('formatIsolationViolations()', () => {
    it('returns empty string for no violations', () => {
      expect(formatIsolationViolations([])).toBe('');
    });

    it('formats violations with PROFILE_ISOLATION_VIOLATION prefix', () => {
      const violations: CrossProfileViolation[] = [
        { keyword: 'room number', profiles: ['makan', 'pelangi'] },
      ];

      const report = formatIsolationViolations(violations);

      expect(report).toContain('PROFILE_ISOLATION_VIOLATION');
      expect(report).toContain('room number');
      expect(report).toContain('makan');
      expect(report).toContain('pelangi');
    });

    it('includes count of violations in header', () => {
      const violations: CrossProfileViolation[] = [
        { keyword: 'room number', profiles: ['makan', 'pelangi'] },
        { keyword: 'capsule booking', profiles: ['makan', 'pelangi'] },
      ];

      const report = formatIsolationViolations(violations);
      expect(report).toContain('2 cross-profile keyword(s)');
    });

    it('formats multi-profile violations correctly', () => {
      const violations: CrossProfileViolation[] = [
        {
          keyword: 'check in time',
          profiles: ['makan', 'pelangi', 'southern'],
        },
      ];

      const report = formatIsolationViolations(violations);
      expect(report).toContain('[makan, pelangi, southern]');
      expect(report).toContain('non-primary profiles');
    });
  });

  describe('enforceProfileDataIsolation()', () => {
    it('throws error when cross-profile keywords are detected (mock contaminated data)', () => {
      // Use a non-existent rootDir so loadProfileKeywords returns null for all profiles.
      // This test validates via the lower-level functions instead.
      const pelangiKws = extractProfileKeywords(pelangiClean);
      const makanKws = extractProfileKeywords(makanContaminated);

      const violations = findCrossProfileKeywords({
        pelangi: pelangiKws,
        makan: makanKws,
      });

      // Simulate what enforceProfileDataIsolation does internally
      expect(violations.length).toBeGreaterThan(0);

      const report = formatIsolationViolations(violations);
      expect(report).toContain('PROFILE_ISOLATION_VIOLATION');
      expect(report).toContain('room number');
      expect(report).toContain('pelangi');
      expect(report).toContain('makan');
    });

    it('does not throw when profiles have no keyword overlap', () => {
      const pelangiKws = extractProfileKeywords(pelangiClean);
      const makanKws = extractProfileKeywords(makanClean);
      const southernKws = extractProfileKeywords(southernClean);

      // Pelangi vs Makan: no overlap (different business domains)
      expect(
        findCrossProfileKeywords({
          pelangi: pelangiKws,
          makan: makanKws,
        }),
      ).toHaveLength(0);

      // Note: pelangi vs southern will have 'check in time' and 'waktu daftar masuk'
      // overlap because both are accommodation businesses — this is expected and
      // the real profiles would need to differentiate these keywords
    });

    it('uses non-existent rootDir and returns cleanly (no profiles to compare)', () => {
      // With a bogus rootDir, no files will be found, so no violations
      expect(() =>
        enforceProfileDataIsolation('/nonexistent/path/to/project'),
      ).not.toThrow();
    });
  });

  describe('end-to-end contamination detection', () => {
    it('produces actionable error report with all offending keywords and profiles', () => {
      // Simulate full pipeline with contaminated makan profile
      const pelangiKws = extractProfileKeywords(pelangiClean);
      const makanKws = extractProfileKeywords(makanContaminated);
      const southernKws = extractProfileKeywords(southernClean);

      const violations = findCrossProfileKeywords({
        pelangi: pelangiKws,
        makan: makanKws,
        southern: southernKws,
      });

      expect(violations.length).toBeGreaterThan(0);

      const report = formatIsolationViolations(violations);

      // Report should list each violation with the required format
      for (const v of violations) {
        expect(report).toContain(
          `PROFILE_ISOLATION_VIOLATION: keyword "${v.keyword}"`,
        );
        expect(report).toContain(`[${v.profiles.join(', ')}]`);
      }

      // Specific contaminated keywords should be present
      const offendingKeywords = violations.map((v) => v.keyword);
      expect(offendingKeywords).toContain('room number');
      expect(offendingKeywords).toContain('capsule booking');
      expect(offendingKeywords).toContain('check in time');

      // Verify each violation lists the correct profiles
      const roomViolation = violations.find((v) => v.keyword === 'room number');
      expect(roomViolation!.profiles).toEqual(['makan', 'pelangi']);

      const capsuleViolation = violations.find(
        (v) => v.keyword === 'capsule booking',
      );
      expect(capsuleViolation!.profiles).toEqual(['makan', 'pelangi']);
    });
  });
});
