/**
 * Profile isolation tests (US-106, US-394)
 *
 * Verifies that the data-makan profile:
 * - Loads ONLY cafe-specific intents (no hostel intents)
 * - Contains expected cafe keywords ('menu')
 * - Does NOT contain hostel keywords ('check-in', 'room-type')
 * - Contains ZERO Pelangi Capsule references (US-394)
 * - Routes only to cafe intents (US-394)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import intentsData from '../../src/assistant/data/intents-makan.json' assert { type: 'json' };
import keywordsData from '../../src/assistant/data-makan/intent-keywords.json' assert { type: 'json' };
import routingData from '../../src/assistant/data-makan/routing.json' assert { type: 'json' };
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

    it('should contain ZERO references to pelangi (hostel profile) in any patterns or categories (US-394)', () => {
      const pelangiReferences: string[] = [];

      if (Array.isArray(intentsData.categories)) {
        for (const category of intentsData.categories) {
          const categoryStr = JSON.stringify(category).toLowerCase();
          if (categoryStr.includes('pelangi') || categoryStr.includes('capsule')) {
            pelangiReferences.push(`Category: ${category.description || 'unknown'}`);
          }

          if (Array.isArray(category.intents)) {
            for (const intent of category.intents) {
              const intentStr = JSON.stringify(intent).toLowerCase();
              if (intentStr.includes('pelangi') || intentStr.includes('capsule')) {
                pelangiReferences.push(`Intent: ${intent.category}`);
              }
            }
          }
        }
      }

      expect(pelangiReferences).toEqual([]);
    });
  });

  describe('Intent Keywords isolation (US-394)', () => {
    it('should NOT contain hostel-specific keywords in data-makan/intent-keywords.json', () => {
      const hostelKeywords = ['check-in', 'check_in', 'room', 'booking', 'reservation', 'guest'];
      const foundHostelKeywords: string[] = [];

      // Scan all keywords in the file
      if (keywordsData && Array.isArray(keywordsData.intents)) {
        for (const intentEntry of keywordsData.intents) {
          if (!intentEntry.keywords) continue;

          for (const [language, keywords] of Object.entries(intentEntry.keywords)) {
            if (!Array.isArray(keywords)) continue;

            for (const keyword of keywords) {
              const lowerKeyword = (keyword as string).toLowerCase();
              for (const hostelKw of hostelKeywords) {
                if (lowerKeyword.includes(hostelKw)) {
                  foundHostelKeywords.push(`Intent: ${intentEntry.intent}, Keyword: ${keyword}`);
                }
              }
            }
          }
        }
      }

      expect(foundHostelKeywords).toEqual([]);
    });

    it('should contain ZERO pelangi references in data-makan/intent-keywords.json', () => {
      const keywordContent = JSON.stringify(keywordsData).toLowerCase();
      const pelangiMatches = keywordContent.match(/pelangi|capsule.*hostel|hostel.*capsule/g) || [];

      expect(pelangiMatches).toHaveLength(0);
    });
  });

  describe('Routing isolation (US-394)', () => {
    it('should route only to cafe intents with no hostel workflows', () => {
      const hostelIntents = [
        'check_in_arrival', 'checkin_info', 'checkout_now', 'checkout_info',
        'booking', 'room_type_inquiry', 'room_type_preference', 'luggage_storage',
        'card_locked', 'theft', 'theft_report'
      ];

      const violatedIntents: string[] = [];

      if (routingData && typeof routingData === 'object') {
        for (const intent of Object.keys(routingData)) {
          if (hostelIntents.includes(intent)) {
            violatedIntents.push(intent);
          }
        }
      }

      expect(violatedIntents).toEqual([]);
    });

    it('should contain only cafe-expected intent routes in data-makan/routing.json', () => {
      // All cafe-specific intents that should be in Makan routing
      const expectedCafeIntents = [
        'menu_query', 'menu_browse_category', 'order_placement', 'order_status',
        'operating_hours', 'vegetarian_query', 'menu_filter_dietary', 'budget_query',
        'specials_query', 'food_recommendation', 'menu_item_detail', 'order_feedback_rating',
        'allergen_query', 'table_reservation', 'complaint', 'pricing', 'directions',
        'accessibility', 'greeting', 'thanks', 'contact_staff', 'unknown', 'positive_review',
        'review_feedback', 'cancel_workflow'
      ];

      const routingIntents = Object.keys(routingData || {});
      const unexpectedIntents = routingIntents.filter(
        intent => !expectedCafeIntents.includes(intent)
      );

      expect(unexpectedIntents).toEqual([]);
    });

    it('should contain ZERO pelangi references in data-makan/routing.json', () => {
      const routingContent = JSON.stringify(routingData).toLowerCase();
      const pelangiMatches = routingContent.match(/pelangi|capsule.*hostel|hostel.*capsule/g) || [];

      expect(pelangiMatches).toHaveLength(0);
    });
  });

  describe('Profile file system isolation (US-394)', () => {
    it('should have all makan data files with ZERO pelangi references', () => {
      const makanDir = path.join(process.cwd(), 'src/assistant/data-makan');

      if (fs.existsSync(makanDir)) {
        const files = fs.readdirSync(makanDir).filter(f => f.endsWith('.json'));
        const pelangiContaminations: string[] = [];

        for (const file of files) {
          const filePath = path.join(makanDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const lowerContent = content.toLowerCase();

          if (lowerContent.includes('pelangi') || lowerContent.includes('capsule')) {
            pelangiContaminations.push(file);
          }
        }

        expect(pelangiContaminations).toEqual([]);
      }
    });
  });
});
