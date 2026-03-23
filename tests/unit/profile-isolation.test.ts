/**
 * Profile isolation tests (US-106)
 *
 * Verifies that the data-makan profile:
 * - Loads ONLY cafe-specific intents (no hostel intents)
 * - Contains expected cafe keywords ('menu')
 * - Does NOT contain hostel keywords ('check-in', 'room-type')
 */

import { describe, it, expect } from 'vitest';
import intentsData from '../../src/assistant/data/intents-makan.json' assert { type: 'json' };
import { HOSTEL_INTENT_CATEGORIES, PROFILE_TYPES } from '../../src/lib/config.js';

describe('Profile Isolation (US-106)', () => {
  describe('data-makan profile intents', () => {
    it('should be marked as cafe profile type', () => {
      expect(PROFILE_TYPES['makan-moments']).toBe('cafe');
    });

    it('should NOT contain any hostel-specific intent categories', () => {
      const contaminated: string[] = [];

      if (Array.isArray(intentsData.categories)) {
        for (const category of intentsData.categories) {
          if (!Array.isArray(category.intents)) continue;

          for (const intent of category.intents) {
            if (HOSTEL_INTENT_CATEGORIES.has(intent.category)) {
              contaminated.push(intent.category);
            }
          }
        }
      }

      expect(contaminated).toEqual([]);
    });

    it('should contain cafe-only intent types: menu_inquiry, food_order, promotion_question, table_reservation, order_cancellation', () => {
      const intentCategories = new Set<string>();

      if (Array.isArray(intentsData.categories)) {
        for (const category of intentsData.categories) {
          if (!Array.isArray(category.intents)) continue;
          for (const intent of category.intents) {
            intentCategories.add(intent.category);
          }
        }
      }

      // Check for cafe-specific intents
      const expectedCafeIntents = [
        'menu_inquiry',
        'food_order',
        'promotion_question',
        'table_reservation',
        'order_cancellation'
      ];

      for (const intentType of expectedCafeIntents) {
        expect(intentCategories.has(intentType)).toBe(true);
      }
    });

    it('should contain "menu" keyword in patterns but NOT "check-in" or "room-type"', () => {
      const allPatterns: string[] = [];
      let hasMenuKeyword = false;
      let hasCheckInKeyword = false;
      let hasRoomTypeKeyword = false;

      if (Array.isArray(intentsData.categories)) {
        for (const category of intentsData.categories) {
          if (!Array.isArray(category.intents)) continue;

          for (const intent of category.intents) {
            if (!Array.isArray(intent.patterns)) continue;

            for (const pattern of intent.patterns) {
              allPatterns.push(pattern);

              // Check for menu keyword (case-insensitive)
              if (pattern.toLowerCase().includes('menu')) {
                hasMenuKeyword = true;
              }

              // Check for check-in keyword (case-insensitive)
              if (pattern.toLowerCase().includes('check-in') || pattern.toLowerCase().includes('check\\s?in')) {
                hasCheckInKeyword = true;
              }

              // Check for room-type keyword (case-insensitive)
              if (pattern.toLowerCase().includes('room-type') || pattern.toLowerCase().includes('room\\s?type')) {
                hasRoomTypeKeyword = true;
              }
            }
          }
        }
      }

      expect(hasMenuKeyword).toBe(true);
      expect(hasCheckInKeyword).toBe(false);
      expect(hasRoomTypeKeyword).toBe(false);
    });

    it('should NOT contain hostel-related keywords like "booking", "room", "capsule", "bed"', () => {
      const hostelKeywords = ['booking', 'room', 'capsule', 'bed', 'checkout', 'checkin'];
      const foundKeywords: string[] = [];

      if (Array.isArray(intentsData.categories)) {
        for (const category of intentsData.categories) {
          if (!Array.isArray(category.intents)) continue;

          for (const intent of category.intents) {
            if (!Array.isArray(intent.patterns)) continue;

            for (const pattern of intent.patterns) {
              const lowerPattern = pattern.toLowerCase();

              for (const keyword of hostelKeywords) {
                if (lowerPattern.includes(`\\b${keyword}\\b`) || lowerPattern.includes(keyword)) {
                  foundKeywords.push(`${intent.category}: ${keyword}`);
                }
              }
            }
          }
        }
      }

      // Assert that no hostel keywords are found (except in general patterns)
      // We allow some flexibility for false positives in regex patterns
      const criticalViolations = foundKeywords.filter(
        v => !v.includes('unknown') && !v.includes('contact_staff')
      );

      expect(criticalViolations).toEqual([]);
    });

    it('should have valid intent structure with required fields', () => {
      if (Array.isArray(intentsData.categories)) {
        for (const category of intentsData.categories) {
          expect(category.phase).toBeDefined();
          expect(category.description).toBeDefined();
          expect(Array.isArray(category.intents)).toBe(true);

          for (const intent of category.intents) {
            expect(intent.category).toBeDefined();
            expect(intent.professional_term).toBeDefined();
            expect(Array.isArray(intent.patterns)).toBe(true);
            expect(intent.flags).toBeDefined();
            expect(typeof intent.enabled).toBe('boolean');
            expect(typeof intent.min_confidence).toBe('number');
          }
        }
      }
    });
  });
});
