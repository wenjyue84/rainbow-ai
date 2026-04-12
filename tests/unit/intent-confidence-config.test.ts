/**
 * Unit tests for US-534: Per-Intent Confidence Score Thresholds
 *
 * Tests that per-intent confidence thresholds are loaded from config
 * and checked correctly during intent classification.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getIntentThreshold,
  isBelowIntentThreshold,
  reloadThresholdsConfig,
  getThresholdsConfig,
} from '../../src/lib/intent-confidence-config.js';

describe('Intent Confidence Thresholds (US-534)', () => {
  beforeEach(() => {
    // Reload config before each test to ensure fresh state
    reloadThresholdsConfig();
  });

  describe('loadThresholdsConfig', () => {
    it('should load the intent-confidence-thresholds.json config file', () => {
      const config = getThresholdsConfig();

      expect(config).toBeDefined();
      expect(config.version).toBeDefined();
      expect(config.thresholds).toBeDefined();
      expect(Object.keys(config.thresholds).length).toBeGreaterThan(0);
    });

    it('should cache the config in memory after first load', () => {
      const config1 = getThresholdsConfig();
      const config2 = getThresholdsConfig();

      // Same object reference if cached
      expect(config1).toBe(config2);
    });
  });

  describe('getIntentThreshold', () => {
    it('should return configured threshold for booking intent (0.75)', () => {
      const threshold = getIntentThreshold('booking');
      expect(threshold).toBe(0.75);
    });

    it('should return configured threshold for greeting intent (0.95)', () => {
      const threshold = getIntentThreshold('greeting');
      expect(threshold).toBe(0.95);
    });

    it('should return configured threshold for wifi intent (0.95)', () => {
      const threshold = getIntentThreshold('wifi');
      expect(threshold).toBe(0.95);
    });

    it('should return configured threshold for availability intent (0.7)', () => {
      const threshold = getIntentThreshold('availability');
      expect(threshold).toBe(0.7);
    });

    it('should return default threshold (0.65) for unknown intents', () => {
      const threshold = getIntentThreshold('some_unknown_intent_xyz');
      expect(threshold).toBe(0.65);
    });

    it('should return 0.0 for unknown system intent', () => {
      const threshold = getIntentThreshold('unknown');
      expect(threshold).toBe(0.0);
    });
  });

  describe('isBelowIntentThreshold', () => {
    it('should return true when confidence is below booking threshold (0.75)', () => {
      const isBelowThreshold = isBelowIntentThreshold('booking', 0.74);
      expect(isBelowThreshold).toBe(true);
    });

    it('should return false when confidence is at booking threshold (0.75)', () => {
      const isBelowThreshold = isBelowIntentThreshold('booking', 0.75);
      expect(isBelowThreshold).toBe(false);
    });

    it('should return false when confidence is above booking threshold (0.75)', () => {
      const isBelowThreshold = isBelowIntentThreshold('booking', 0.76);
      expect(isBelowThreshold).toBe(false);
    });

    it('should return true when confidence is below greeting threshold (0.95)', () => {
      const isBelowThreshold = isBelowIntentThreshold('greeting', 0.94);
      expect(isBelowThreshold).toBe(true);
    });

    it('should return true when confidence is below wifi threshold (0.95)', () => {
      const isBelowThreshold = isBelowIntentThreshold('wifi', 0.80);
      expect(isBelowThreshold).toBe(true);
    });

    it('should return false when confidence equals wifi threshold (0.95)', () => {
      const isBelowThreshold = isBelowIntentThreshold('wifi', 0.95);
      expect(isBelowThreshold).toBe(false);
    });

    it('should use default threshold for unconfigured intents', () => {
      // Unknown intent should use default 0.65
      const isBelowThreshold = isBelowIntentThreshold('unknown_intent_abc', 0.64);
      expect(isBelowThreshold).toBe(true);
    });

    it('should return false for unknown intent with any confidence >= 0.0', () => {
      // 'unknown' intent has threshold 0.0, so nothing should be below it
      const isBelowThreshold = isBelowIntentThreshold('unknown', 0.5);
      expect(isBelowThreshold).toBe(false);
    });
  });

  describe('Per-Intent Threshold Categories', () => {
    it('should have high confidence thresholds (0.85+) for critical actions', () => {
      // Only intents with threshold >= 0.85
      const highConfidenceIntents = [
        'greeting', 'thanks', 'wifi',   // 0.95 and 0.9
        'pricing', 'directions',         // 0.85
        'luggage_storage', 'late_checkout_request', 'lower_deck_preference',  // 0.85
      ];

      highConfidenceIntents.forEach(intent => {
        const threshold = getIntentThreshold(intent);
        expect(threshold).toBeGreaterThanOrEqual(0.85);
      });
    });

    it('should have medium confidence thresholds (0.65-0.85) for standard actions', () => {
      const mediumConfidenceIntents = [
        'availability', 'booking', 'contact_staff', 'facilities_info',
        'payment_made', 'check_in_arrival', 'billing_dispute',
        'cleanliness_complaint', 'climate_control_complaint',
        'facility_malfunction', 'facility_orientation', 'noise_complaint',
        'extra_amenity_request', 'tourist_guide', 'forgot_item_post_checkout',
      ];

      mediumConfidenceIntents.forEach(intent => {
        const threshold = getIntentThreshold(intent);
        expect(threshold).toBeGreaterThanOrEqual(0.6);
        expect(threshold).toBeLessThan(0.85);
      });
    });

    it('should have low confidence thresholds (0.3-0.65) for low-confidence intents', () => {
      const lowConfidenceIntents = [
        'general_complaint_in_stay',
        'post_checkout_complaint',
      ];

      lowConfidenceIntents.forEach(intent => {
        const threshold = getIntentThreshold(intent);
        expect(threshold).toBeGreaterThanOrEqual(0.3);
        expect(threshold).toBeLessThan(0.65);
      });
    });

    it('should have emergency thresholds (0.3) for sensitive intents', () => {
      const emergencyIntents = ['card_locked', 'theft_report'];

      emergencyIntents.forEach(intent => {
        const threshold = getIntentThreshold(intent);
        expect(threshold).toBe(0.3);
      });
    });
  });

  describe('Integration Scenario: Booking Classification', () => {
    it('should correctly identify booking intent as below threshold when confidence=0.70', () => {
      const intent = 'booking';
      const confidence = 0.70;
      const threshold = getIntentThreshold(intent); // 0.75

      expect(threshold).toBe(0.75);
      expect(isBelowIntentThreshold(intent, confidence)).toBe(true);
    });

    it('should correctly identify booking intent as at threshold when confidence=0.75', () => {
      const intent = 'booking';
      const confidence = 0.75;
      const threshold = getIntentThreshold(intent);

      expect(threshold).toBe(0.75);
      expect(isBelowIntentThreshold(intent, confidence)).toBe(false);
    });

    it('should handle unknown intents with minimal threshold', () => {
      const intent = 'unknown';
      const confidence = 0.9;
      const threshold = getIntentThreshold(intent); // 0.0

      expect(threshold).toBe(0.0);
      expect(isBelowIntentThreshold(intent, confidence)).toBe(false);
    });
  });
});
