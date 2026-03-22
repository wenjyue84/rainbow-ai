/**
 * Tests for profile-aware intent validation (US-057).
 *
 * Covers: detection of hostel intents in cafe profiles, clean profiles, hostel profiles.
 */

import { describe, it, expect } from 'vitest';
import { validateProfileIntents, HOSTEL_INTENT_CATEGORIES } from '../../src/lib/config.js';
import type { IntentsData } from '../../src/assistant/schemas.js';

describe('validateProfileIntents', () => {
  // ─── Helper functions ────────────────────────────────────────

  function createIntentsData(intentCategories: string[]): IntentsData {
    return {
      categories: intentCategories.map(category => ({
        intents: [
          {
            category,
            professional_term: 'Test Intent',
            patterns: ['^test'],
            flags: 'i',
            enabled: true,
            min_confidence: 0.7,
          },
        ],
      })),
    };
  }

  // ─── Hostel-specific intents in cafe profile (should throw) ────

  it('should throw when makan profile contains check-in intent', () => {
    const intentsData = createIntentsData(['greeting', 'check_in_arrival', 'thanks']);

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).toThrow(/check_in_arrival/);
  });

  it('should throw when makan profile contains checkout intent', () => {
    const intentsData = createIntentsData(['greeting', 'checkout_info', 'thanks']);

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).toThrow(/checkout_info/);
  });

  it('should throw when makan profile contains stay extension intent', () => {
    const intentsData = createIntentsData(['greeting', 'stay_extension', 'thanks']);

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).toThrow(/stay_extension/);
  });

  it('should throw when makan profile contains facility orientation intent', () => {
    const intentsData = createIntentsData(['greeting', 'facility_orientation', 'thanks']);

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).toThrow(/facility_orientation/);
  });

  it('should throw when makan profile contains WiFi intent', () => {
    const intentsData = createIntentsData(['greeting', 'wifi', 'thanks']);

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).toThrow(/wifi/);
  });

  it('should throw and list multiple contaminated intents', () => {
    const intentsData = createIntentsData([
      'greeting',
      'check_in_arrival',
      'checkout_info',
      'thanks',
    ]);

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).toThrow(/2 hostel-specific intent/);
    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).toThrow(/check_in_arrival/);
    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).toThrow(/checkout_info/);
  });

  // ─── Clean cafe profile (should not throw) ────────────────────

  it('should not throw for clean makan profile with cafe intents only', () => {
    const intentsData = createIntentsData([
      'greeting',
      'menu_query',
      'order_placement',
      'thanks',
    ]);

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).not.toThrow();
  });

  it('should not throw for clean makan profile with allergen and dietary intents', () => {
    const intentsData = createIntentsData([
      'greeting',
      'allergen_query',
      'vegetarian_query',
      'menu_filter_dietary',
      'thanks',
    ]);

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).not.toThrow();
  });

  // ─── Hostel profiles (should not throw, no validation) ────────

  it('should not throw for pelangi profile even with hostel intents', () => {
    const intentsData = createIntentsData([
      'greeting',
      'check_in_arrival',
      'checkout_info',
      'thanks',
    ]);

    expect(() => {
      validateProfileIntents('pelangi', intentsData);
    }).not.toThrow();
  });

  it('should not throw for southern profile even with hostel intents', () => {
    const intentsData = createIntentsData([
      'greeting',
      'facility_orientation',
      'wifi',
      'thanks',
    ]);

    expect(() => {
      validateProfileIntents('southern', intentsData);
    }).not.toThrow();
  });

  // ─── Unknown profiles (should not throw) ──────────────────────

  it('should not throw for unknown profile', () => {
    const intentsData = createIntentsData([
      'greeting',
      'check_in_arrival',
      'unknown_intent',
    ]);

    expect(() => {
      validateProfileIntents('unknown-profile', intentsData);
    }).not.toThrow();
  });

  // ─── Empty or missing data (should not throw) ────────────────

  it('should not throw when intents.categories is undefined', () => {
    const intentsData = {} as IntentsData;

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).not.toThrow();
  });

  it('should not throw when intents.categories is empty', () => {
    const intentsData: IntentsData = { categories: [] };

    expect(() => {
      validateProfileIntents('makan-moments', intentsData);
    }).not.toThrow();
  });

  // ─── Error message clarity ────────────────────────────────────

  it('should include profile name in error message', () => {
    const intentsData = createIntentsData(['check_in_arrival']);

    try {
      validateProfileIntents('makan-moments', intentsData);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('makan-moments');
    }
  });

  it('should indicate that found intents should not exist in cafe profile', () => {
    const intentsData = createIntentsData(['check_in_arrival']);

    try {
      validateProfileIntents('makan-moments', intentsData);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('should not exist in a cafe profile');
    }
  });

  it('should list all unique contaminated intents', () => {
    const intentsData = createIntentsData([
      'check_in_arrival',
      'checkout_info',
      'facility_orientation',
    ]);

    try {
      validateProfileIntents('makan-moments', intentsData);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('check_in_arrival');
      expect(err.message).toContain('checkout_info');
      expect(err.message).toContain('facility_orientation');
    }
  });

  // ─── Edge case: duplicate contaminants (should deduplicate) ────

  it('should deduplicate contaminants in error message', () => {
    // Create intents data with the same hostel intent appearing twice
    const intentsData: IntentsData = {
      categories: [
        {
          intents: [
            { category: 'check_in_arrival', professional_term: 'A', patterns: [], flags: 'i', enabled: true, min_confidence: 0.7 },
            { category: 'greeting', professional_term: 'B', patterns: [], flags: 'i', enabled: true, min_confidence: 0.7 },
            { category: 'check_in_arrival', professional_term: 'C', patterns: [], flags: 'i', enabled: true, min_confidence: 0.7 },
          ],
        },
      ],
    };

    try {
      validateProfileIntents('makan-moments', intentsData);
      expect.fail('Should have thrown');
    } catch (err: any) {
      // Should report only 1 unique contaminated intent, not 2
      expect(err.message).toContain('1 hostel-specific intent');
    }
  });
});
