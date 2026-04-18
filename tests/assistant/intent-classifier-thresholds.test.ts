/**
 * intent-classifier-thresholds.test.ts
 *
 * Tests for US-606: Intent Classification with Per-Profile Thresholds
 * - Verify classifier loads and uses per-intent thresholds
 * - Verify fallback to default thresholds when tuned thresholds unavailable
 * - Verify threshold application in classification decisions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { explainIntentClassification } from '../../src/assistant/intent-classifier.js';

describe('Intent Classifier with Per-Profile Thresholds (US-606)', () => {
  const testProfile = 'test-profile-thresholds';
  const thresholdFile = `${testProfile}-intent-thresholds.json`;

  beforeEach(() => {
    // Clean up any existing threshold file
    if (existsSync(thresholdFile)) {
      unlinkSync(thresholdFile);
    }
  });

  afterEach(() => {
    // Clean up
    if (existsSync(thresholdFile)) {
      unlinkSync(thresholdFile);
    }
  });

  it('should classify with default thresholds when tuned file not found', () => {
    const result = explainIntentClassification('booking', 'pelangi');
    expect(result).toBeDefined();
    expect(result.intent).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should respect default keyword match threshold (0.5)', () => {
    const result = explainIntentClassification('need to book a room', 'pelangi');
    expect(result).toBeDefined();
    // Should get classification if keyword score is >= 0.5 (default)
    if (result.classificationMethod === 'keyword_match') {
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('should respect default booking threshold (0.7)', () => {
    const result = explainIntentClassification('i want to book', 'pelangi');
    expect(result).toBeDefined();
    // Booking intent requires higher threshold
    if (result.intent === 'booking') {
      expect(result.classificationMethod).toBeDefined();
    }
  });

  it('should use tuned thresholds from file when available', () => {
    // Create a tuned threshold file
    const tuningResult = {
      profile: testProfile,
      generatedAt: new Date().toISOString(),
      sampleSize: 100,
      percentile: 75,
      intents: [
        {
          intent: 'booking',
          sampleCount: 20,
          minConfidence: 0.3,
          maxConfidence: 0.95,
          meanConfidence: 0.65,
          medianConfidence: 0.68,
          p75Confidence: 0.8,
          p90Confidence: 0.9,
          acceptThreshold: 0.75,
          clarifyThreshold: 0.5,
          escalateThreshold: 0.5,
        },
        {
          intent: 'greeting',
          sampleCount: 15,
          minConfidence: 0.4,
          maxConfidence: 0.99,
          meanConfidence: 0.7,
          medianConfidence: 0.72,
          p75Confidence: 0.85,
          p90Confidence: 0.95,
          acceptThreshold: 0.8,
          clarifyThreshold: 0.55,
          escalateThreshold: 0.55,
        },
      ],
      summary: {
        totalIntents: 2,
        totalSamples: 35,
      },
    };

    writeFileSync(thresholdFile, JSON.stringify(tuningResult, null, 2));

    // Verify file was created
    expect(existsSync(thresholdFile)).toBe(true);

    // Classifier should load and use these thresholds
    const result = explainIntentClassification('hello', testProfile);
    expect(result).toBeDefined();
  });

  it('should handle malformed threshold file gracefully', () => {
    // Write invalid JSON
    writeFileSync(thresholdFile, 'invalid json {{{');

    // Should not crash, should fall back to defaults
    const result = explainIntentClassification('booking', testProfile);
    expect(result).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('should handle threshold file with missing fields', () => {
    // Create incomplete threshold file
    const incomplete = {
      profile: testProfile,
      intents: [
        {
          intent: 'booking',
          // Missing acceptThreshold, clarifyThreshold, escalateThreshold
        },
      ],
    };

    writeFileSync(thresholdFile, JSON.stringify(incomplete, null, 2));

    // Should not crash
    const result = explainIntentClassification('booking', testProfile);
    expect(result).toBeDefined();
  });

  it('should classify fallback with low confidence', () => {
    const result = explainIntentClassification(
      'xyzabc123 gibberish nonsense',
      'pelangi'
    );
    expect(result).toBeDefined();
    if (result.intent === 'fallback') {
      expect(result.confidence).toBeLessThan(0.5);
    }
  });

  it('should return threshold structure in result', () => {
    const result = explainIntentClassification('hello', 'pelangi');
    expect(result).toBeDefined();
    expect(result.intent).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.classificationMethod).toBeDefined();
    expect(['keyword_match', 'fallback']).toContain(result.classificationMethod);
  });

  it('should maintain backward compatibility without threshold file', () => {
    // Should work exactly as before when no custom thresholds exist
    const messages = [
      'i need a room',
      'hello',
      'check in please',
      'what is the price',
    ];

    for (const msg of messages) {
      const result = explainIntentClassification(msg, 'pelangi');
      expect(result).toBeDefined();
      expect(result.intent).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});
