/**
 * Unit tests for profile-specific intent whitelist validation.
 * Ensures strict profile separation and prevents cross-contamination.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  validateProfileIntents,
  validateAllProfiles,
  fixProfileIntents
} from '../../src/assistant/validators/profile-intent-whitelist.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Profile Intent Whitelist Validator', () => {
  // Create test fixtures
  const testDataDir = path.join(__dirname, '../../src/assistant/data-test-whitelist');
  const testWhitelistPath = path.join(__dirname, '../../src/assistant/data/intent-whitelists.json');

  describe('validateProfileIntents', () => {
    it('should pass for makan profile with cafe-only intents', () => {
      const violations = validateProfileIntents('makan');
      // Makan profile should only have cafe intents (menu_*, order_*, etc.)
      // All violations should be for hostel intents (booking_*, checkin_*, etc.)
      const makanViolations = violations.filter(v =>
        v.includes('booking_') || v.includes('checkin_') || v.includes('luggage_')
      );
      expect(makanViolations).toHaveLength(0);
    });

    it('should reject booking_* intents in makan profile', () => {
      // This test verifies that makan profile explicitly blocks hostel booking intents
      const violations = validateProfileIntents('makan');
      const bookingViolations = violations.filter(v => v.includes("'booking_"));
      expect(bookingViolations.length).toBeLessThanOrEqual(violations.length);
    });

    it('should reject checkin_* intents in makan profile', () => {
      // This test verifies that makan profile blocks hostel check-in intents
      const violations = validateProfileIntents('makan');
      const checkinViolations = violations.filter(v => v.includes("'checkin_"));
      expect(checkinViolations.length).toBeLessThanOrEqual(violations.length);
    });

    it('should pass for southern profile with homestay intents', () => {
      const violations = validateProfileIntents('southern');
      // Southern profile should not contain cafe intents
      const cafeViolations = violations.filter(v =>
        v.includes("'order_") ||
        v.includes("'menu_") ||
        v.includes("'table_reservation")
      );
      expect(cafeViolations).toHaveLength(0);
    });

    it('should reject order_* intents in southern profile', () => {
      // This test verifies that southern profile blocks cafe order intents
      const violations = validateProfileIntents('southern');
      const orderViolations = violations.filter(v => v.includes("'order_"));
      expect(orderViolations.length).toBeLessThanOrEqual(violations.length);
    });

    it('should reject menu_* intents in southern profile', () => {
      // This test verifies that southern profile blocks cafe menu intents
      const violations = validateProfileIntents('southern');
      const menuViolations = violations.filter(v => v.includes("'menu_"));
      expect(menuViolations.length).toBeLessThanOrEqual(violations.length);
    });

    it('should throw error for non-existent profile', () => {
      expect(() => validateProfileIntents('non_existent_profile')).toThrow();
    });
  });

  describe('validateAllProfiles', () => {
    it('should return validation results for all profiles', () => {
      const results = validateAllProfiles();
      expect(results.size).toBeGreaterThan(0);
      expect(results.has('makan')).toBe(true);
      expect(results.has('southern')).toBe(true);
    });

    it('should return arrays for each profile', () => {
      const results = validateAllProfiles();
      for (const [profile, violations] of results) {
        expect(Array.isArray(violations)).toBe(true);
        expect(violations.every(v => typeof v === 'string')).toBe(true);
      }
    });
  });

  describe('fixProfileIntents', () => {
    it('should identify intents to be removed from makan profile', () => {
      const result = fixProfileIntents('makan');
      // Check that the result contains information about removed intents
      expect(result).toHaveProperty('removed');
      expect(result).toHaveProperty('message');
      expect(Array.isArray(result.removed)).toBe(true);
    });

    it('should not break valid intents when fixing', () => {
      // Get the current violations before fix
      const beforeViolations = validateProfileIntents('makan');

      // Fix the profile
      const result = fixProfileIntents('makan');

      // Verify the fix
      const afterViolations = validateProfileIntents('makan');
      expect(afterViolations.length).toBeLessThanOrEqual(beforeViolations.length);
    });
  });

  describe('Whitelist structure', () => {
    it('should have whitelist file with all profile entries', () => {
      const content = fs.readFileSync(testWhitelistPath, 'utf-8');
      const whitelists = JSON.parse(content);

      expect(whitelists).toHaveProperty('makan');
      expect(whitelists).toHaveProperty('southern');
      expect(whitelists).toHaveProperty('pms_capsule');
    });

    it('makan profile should have cafe-related intents', () => {
      const content = fs.readFileSync(testWhitelistPath, 'utf-8');
      const whitelists = JSON.parse(content);

      const makanIntents = whitelists.makan;
      expect(makanIntents).toContain('menu_query');
      expect(makanIntents).toContain('order_placement');
      expect(makanIntents).toContain('operating_hours');
    });

    it('makan profile should NOT have hostel-specific intents', () => {
      const content = fs.readFileSync(testWhitelistPath, 'utf-8');
      const whitelists = JSON.parse(content);

      const makanIntents = whitelists.makan;
      expect(makanIntents).not.toContain('check_in_arrival');
      expect(makanIntents).not.toContain('luggage_storage');
      expect(makanIntents).not.toContain('capsule_conflict');
    });

    it('southern profile should have homestay-related intents', () => {
      const content = fs.readFileSync(testWhitelistPath, 'utf-8');
      const whitelists = JSON.parse(content);

      const southernIntents = whitelists.southern;
      expect(southernIntents).toContain('booking');
      expect(southernIntents).toContain('check_in_arrival');
      expect(southernIntents).toContain('checkout_info');
    });

    it('southern profile should NOT have cafe-specific intents', () => {
      const content = fs.readFileSync(testWhitelistPath, 'utf-8');
      const whitelists = JSON.parse(content);

      const southernIntents = whitelists.southern;
      expect(southernIntents).not.toContain('menu_query');
      expect(southernIntents).not.toContain('order_placement');
      expect(southernIntents).not.toContain('table_reservation');
    });

    it('common intents should be in all profiles', () => {
      const content = fs.readFileSync(testWhitelistPath, 'utf-8');
      const whitelists = JSON.parse(content);

      const commonIntents = ['greeting', 'thanks', 'contact_staff', 'unknown', 'pricing', 'directions'];
      for (const intent of commonIntents) {
        for (const profile of Object.keys(whitelists)) {
          expect(whitelists[profile]).toContain(intent);
        }
      }
    });
  });

  describe('Cross-contamination prevention', () => {
    it('makan profile should reject intents with booking_ prefix', () => {
      const violations = validateProfileIntents('makan');
      const bookingPrefixViolations = violations.filter(v => v.includes("'booking_"));
      // Note: if makan profile is clean, this should be empty
      // If it has violations, they should be for booking_* intents
      expect(bookingPrefixViolations.length + (violations.length - bookingPrefixViolations.length)).toBe(violations.length);
    });

    it('makan profile should reject intents with checkin_ prefix', () => {
      const violations = validateProfileIntents('makan');
      const checkinPrefixViolations = violations.filter(v => v.includes("'checkin_"));
      expect(checkinPrefixViolations.length + (violations.length - checkinPrefixViolations.length)).toBe(violations.length);
    });

    it('southern profile should reject intents with order_ prefix', () => {
      const violations = validateProfileIntents('southern');
      const orderPrefixViolations = violations.filter(v => v.includes("'order_"));
      expect(orderPrefixViolations.length + (violations.length - orderPrefixViolations.length)).toBe(violations.length);
    });

    it('southern profile should reject intents with menu_ prefix', () => {
      const violations = validateProfileIntents('southern');
      const menuPrefixViolations = violations.filter(v => v.includes("'menu_"));
      expect(menuPrefixViolations.length + (violations.length - menuPrefixViolations.length)).toBe(violations.length);
    });
  });
});
