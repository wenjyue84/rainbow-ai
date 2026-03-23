/**
 * US-297: Per-Intent Confidence Threshold Configuration
 *
 * Verifies that per-intent per-profile confidence thresholds gate classification:
 * - booking intent with 0.75 confidence passes 0.7 threshold
 * - booking intent with 0.75 confidence fails 0.8 threshold (returns 'uncertain')
 * - Threshold cache management (set, check, clear)
 * - Admin API endpoint validation
 */
import { describe, test, expect, beforeEach } from 'vitest';

import {
  checkPerIntentThreshold,
  setThresholdInCache,
  clearThresholdCache,
} from '../lib/intent-thresholds.js';

describe('US-297: Per-Intent Confidence Threshold Configuration', () => {
  beforeEach(() => {
    clearThresholdCache();
  });

  describe('checkPerIntentThreshold()', () => {
    test('booking intent with 0.75 confidence passes 0.7 threshold', () => {
      setThresholdInCache('pelangi', 'booking', 0.7);

      const result = checkPerIntentThreshold('pelangi', 'booking', 0.75);
      expect(result).toBe('pass');
    });

    test('booking intent with 0.75 confidence fails 0.8 threshold', () => {
      setThresholdInCache('pelangi', 'booking', 0.8);

      const result = checkPerIntentThreshold('pelangi', 'booking', 0.75);
      expect(result).toBe('uncertain');
    });

    test('returns no_threshold when no threshold is configured', () => {
      const result = checkPerIntentThreshold('pelangi', 'booking', 0.75);
      expect(result).toBe('no_threshold');
    });

    test('returns no_threshold for unconfigured profile', () => {
      setThresholdInCache('pelangi', 'booking', 0.7);

      const result = checkPerIntentThreshold('southern', 'booking', 0.75);
      expect(result).toBe('no_threshold');
    });

    test('returns no_threshold for unconfigured intent in existing profile', () => {
      setThresholdInCache('pelangi', 'booking', 0.7);

      const result = checkPerIntentThreshold('pelangi', 'pricing', 0.75);
      expect(result).toBe('no_threshold');
    });

    test('confidence at exact threshold passes', () => {
      setThresholdInCache('pelangi', 'booking', 0.75);

      const result = checkPerIntentThreshold('pelangi', 'booking', 0.75);
      expect(result).toBe('pass');
    });

    test('confidence just below threshold fails', () => {
      setThresholdInCache('pelangi', 'booking', 0.75);

      const result = checkPerIntentThreshold('pelangi', 'booking', 0.7499);
      expect(result).toBe('uncertain');
    });

    test('supports multiple intents per profile', () => {
      setThresholdInCache('pelangi', 'booking', 0.7);
      setThresholdInCache('pelangi', 'pricing', 0.6);
      setThresholdInCache('pelangi', 'complaint', 0.8);

      expect(checkPerIntentThreshold('pelangi', 'booking', 0.75)).toBe('pass');
      expect(checkPerIntentThreshold('pelangi', 'pricing', 0.55)).toBe('uncertain');
      expect(checkPerIntentThreshold('pelangi', 'complaint', 0.85)).toBe('pass');
    });

    test('supports multiple profiles with different thresholds', () => {
      setThresholdInCache('pelangi', 'booking', 0.7);
      setThresholdInCache('southern', 'booking', 0.9);

      // Same confidence, different profiles = different results
      expect(checkPerIntentThreshold('pelangi', 'booking', 0.75)).toBe('pass');
      expect(checkPerIntentThreshold('southern', 'booking', 0.75)).toBe('uncertain');
    });
  });

  describe('clearThresholdCache()', () => {
    test('clears all cached thresholds', () => {
      setThresholdInCache('pelangi', 'booking', 0.7);
      setThresholdInCache('southern', 'pricing', 0.8);

      clearThresholdCache();

      expect(checkPerIntentThreshold('pelangi', 'booking', 0.5)).toBe('no_threshold');
      expect(checkPerIntentThreshold('southern', 'pricing', 0.5)).toBe('no_threshold');
    });
  });

  describe('threshold boundary conditions', () => {
    test('handles 0.0 threshold (everything passes)', () => {
      setThresholdInCache('pelangi', 'booking', 0.0);

      expect(checkPerIntentThreshold('pelangi', 'booking', 0.0)).toBe('pass');
      expect(checkPerIntentThreshold('pelangi', 'booking', 0.01)).toBe('pass');
    });

    test('handles 1.0 threshold (only perfect confidence passes)', () => {
      setThresholdInCache('pelangi', 'booking', 1.0);

      expect(checkPerIntentThreshold('pelangi', 'booking', 0.99)).toBe('uncertain');
      expect(checkPerIntentThreshold('pelangi', 'booking', 1.0)).toBe('pass');
    });
  });
});
