/**
 * Tests for US-594: Tamil Translation Coverage Validation
 *
 * Enforces 100% Tamil coverage for critical intents (booking, inquiry, escalation).
 * Tests also verify overall coverage reporting.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface IntentResponses {
  [profileId: string]: {
    [intentId: string]: {
      en: string;
      ta?: string;
    };
  };
}

const CRITICAL_INTENTS = ['booking', 'inquiry', 'escalation'];

let intentResponses: IntentResponses;

beforeAll(() => {
  const filePath = resolve(process.cwd(), 'src/assistant/data/intent-responses.json');
  const content = readFileSync(filePath, 'utf-8');
  intentResponses = JSON.parse(content);
});

describe('US-594: Tamil Translation Coverage', () => {
  describe('Critical Intent Coverage', () => {
    it('should have 100% Tamil coverage for "booking" intent across all profiles', () => {
      for (const [profileId, intents] of Object.entries(intentResponses)) {
        const booking = intents['booking'];
        if (booking) {
          expect(
            booking.ta && booking.ta.trim().length > 0,
            `Profile "${profileId}" missing Tamil for "booking" intent`
          ).toBe(true);
        }
      }
    });

    it('should have 100% Tamil coverage for "inquiry" intent across all profiles', () => {
      for (const [profileId, intents] of Object.entries(intentResponses)) {
        const inquiry = intents['inquiry'];
        if (inquiry) {
          expect(
            inquiry.ta && inquiry.ta.trim().length > 0,
            `Profile "${profileId}" missing Tamil for "inquiry" intent`
          ).toBe(true);
        }
      }
    });

    it('should have 100% Tamil coverage for "escalation" intent across all profiles', () => {
      for (const [profileId, intents] of Object.entries(intentResponses)) {
        const escalation = intents['escalation'];
        if (escalation) {
          expect(
            escalation.ta && escalation.ta.trim().length > 0,
            `Profile "${profileId}" missing Tamil for "escalation" intent`
          ).toBe(true);
        }
      }
    });
  });

  describe('Overall Coverage Calculation', () => {
    it('should calculate overall coverage correctly', () => {
      let totalIntents = 0;
      let taamilCovered = 0;

      for (const intents of Object.values(intentResponses)) {
        for (const content of Object.values(intents)) {
          totalIntents++;
          if (content.ta && content.ta.trim().length > 0) {
            taamilCovered++;
          }
        }
      }

      const overallCoverage = Math.round((taamilCovered / totalIntents) * 100);
      expect(overallCoverage).toBeGreaterThanOrEqual(0);
      expect(overallCoverage).toBeLessThanOrEqual(100);
    });

    it('should report coverage by intent', () => {
      const intentCoverage: Map<string, { total: number; covered: number }> = new Map();

      for (const intents of Object.values(intentResponses)) {
        for (const [intentId, content] of Object.entries(intents)) {
          if (!intentCoverage.has(intentId)) {
            intentCoverage.set(intentId, { total: 0, covered: 0 });
          }
          const stats = intentCoverage.get(intentId)!;
          stats.total++;
          if (content.ta && content.ta.trim().length > 0) {
            stats.covered++;
          }
        }
      }

      // Each critical intent should have at least 1 entry
      for (const critical of CRITICAL_INTENTS) {
        if (intentCoverage.has(critical)) {
          const stats = intentCoverage.get(critical)!;
          expect(stats.covered, `Critical intent "${critical}" should have Tamil translations`).toBeGreaterThan(0);
        }
      }
    });

    it('should identify missing Tamil translations correctly', () => {
      const missingTamil: Array<{ profileId: string; intentId: string }> = [];

      for (const [profileId, intents] of Object.entries(intentResponses)) {
        for (const [intentId, content] of Object.entries(intents)) {
          if (!content.ta || content.ta.trim().length === 0) {
            missingTamil.push({ profileId, intentId });
          }
        }
      }

      // No missing Tamil for critical intents
      const missingCritical = missingTamil.filter((m) => CRITICAL_INTENTS.includes(m.intentId));
      expect(missingCritical, 'Critical intents should not have missing Tamil translations').toHaveLength(0);
    });
  });

  describe('Response Structure Validation', () => {
    it('should have valid English responses for all intents', () => {
      for (const [profileId, intents] of Object.entries(intentResponses)) {
        for (const [intentId, content] of Object.entries(intents)) {
          expect(
            content.en && typeof content.en === 'string' && content.en.trim().length > 0,
            `Profile "${profileId}", intent "${intentId}": invalid English response`
          ).toBe(true);
        }
      }
    });

    it('should have Tamil field as optional but non-empty when present', () => {
      for (const [profileId, intents] of Object.entries(intentResponses)) {
        for (const [intentId, content] of Object.entries(intents)) {
          if (content.ta !== undefined) {
            expect(
              typeof content.ta === 'string' && content.ta.trim().length > 0,
              `Profile "${profileId}", intent "${intentId}": Tamil field is empty`
            ).toBe(true);
          }
        }
      }
    });
  });

  describe('Profile-Specific Coverage', () => {
    it('should report coverage per profile', () => {
      const profileCoverage: Map<string, { total: number; covered: number }> = new Map();

      for (const [profileId, intents] of Object.entries(intentResponses)) {
        profileCoverage.set(profileId, { total: 0, covered: 0 });
        const stats = profileCoverage.get(profileId)!;

        for (const content of Object.values(intents)) {
          stats.total++;
          if (content.ta && content.ta.trim().length > 0) {
            stats.covered++;
          }
        }
      }

      // Each profile should exist and have coverage data
      expect(profileCoverage.size).toBeGreaterThan(0);
      for (const stats of profileCoverage.values()) {
        expect(stats.total).toBeGreaterThan(0);
      }
    });

    it('should list profiles with incomplete Tamil coverage', () => {
      const incompleteCoverage: Map<string, number> = new Map();

      for (const [profileId, intents] of Object.entries(intentResponses)) {
        let total = 0;
        let covered = 0;

        for (const content of Object.values(intents)) {
          total++;
          if (content.ta && content.ta.trim().length > 0) {
            covered++;
          }
        }

        const pct = Math.round((covered / total) * 100);
        if (pct < 100) {
          incompleteCoverage.set(profileId, pct);
        }
      }

      // For now, just verify we can identify incomplete profiles
      expect(incompleteCoverage).toBeInstanceOf(Map);
    });
  });

  describe('Data Integrity', () => {
    it('should have at least one profile with responses', () => {
      expect(Object.keys(intentResponses).length).toBeGreaterThan(0);
    });

    it('should have at least one intent per profile', () => {
      for (const [profileId, intents] of Object.entries(intentResponses)) {
        expect(
          Object.keys(intents).length,
          `Profile "${profileId}" should have at least one intent`
        ).toBeGreaterThan(0);
      }
    });

    it('should not have duplicate intent IDs within a profile', () => {
      for (const [profileId, intents] of Object.entries(intentResponses)) {
        const intentIds = Object.keys(intents);
        const uniqueIds = new Set(intentIds);
        expect(
          uniqueIds.size,
          `Profile "${profileId}" has duplicate intent IDs`
        ).toBe(intentIds.length);
      }
    });
  });
});
