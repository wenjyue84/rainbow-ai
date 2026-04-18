/**
 * tune-thresholds.test.ts
 *
 * Tests for US-606: Intent Confidence Threshold Tuning CLI
 * - Verify CLI loads data correctly
 * - Verify threshold computation with percentiles
 * - Verify --dry-run flag works
 * - Verify --percentile flag works
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, unlinkSync, readFileSync } from 'fs';

describe('Intent Confidence Threshold Tuning CLI (US-606)', () => {
  const testProfile = 'pelangi';
  const outputFile = `${testProfile}-intent-thresholds.json`;

  beforeAll(() => {
    // Clean up any existing output file
    if (existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
  });

  afterAll(() => {
    // Clean up after tests
    if (existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
  });

  it('should generate sample data in --dry-run mode', () => {
    const output = execSync(
      'npm run cli:tune-thresholds -- --profile pelangi --dry-run',
      { encoding: 'utf-8' }
    );

    const result = JSON.parse(output);
    expect(result.profile).toBe('pelangi');
    expect(result.intents).toBeDefined();
    expect(Array.isArray(result.intents)).toBe(true);
    expect(result.summary.totalIntents).toBeGreaterThan(0);
    expect(result.summary.totalSamples).toBeGreaterThan(0);
  });

  it('should output valid threshold structure', () => {
    const output = execSync(
      'npm run cli:tune-thresholds -- --profile pelangi --sample-size 100 --dry-run',
      { encoding: 'utf-8' }
    );

    const result = JSON.parse(output);

    // Check top-level fields
    expect(result.profile).toBe('pelangi');
    expect(result.generatedAt).toBeDefined();
    expect(result.sampleSize).toBe(100);
    expect(result.percentile).toBe(75); // default

    // Check each intent's threshold structure
    for (const intent of result.intents) {
      expect(intent.intent).toBeDefined();
      expect(intent.sampleCount).toBeGreaterThanOrEqual(0);
      expect(intent.minConfidence).toBeGreaterThanOrEqual(0);
      expect(intent.maxConfidence).toBeLessThanOrEqual(1);
      expect(intent.meanConfidence).toBeDefined();
      expect(intent.medianConfidence).toBeDefined();
      expect(intent.p75Confidence).toBeDefined();
      expect(intent.p90Confidence).toBeDefined();

      // Threshold bounds
      expect(intent.acceptThreshold).toBeLessThanOrEqual(1.0);
      expect(intent.acceptThreshold).toBeGreaterThanOrEqual(0);
      expect(intent.clarifyThreshold).toBeGreaterThanOrEqual(0);
      expect(intent.clarifyThreshold).toBeLessThanOrEqual(1.0);
      expect(intent.escalateThreshold).toBeGreaterThanOrEqual(0);
      expect(intent.escalateThreshold).toBeLessThanOrEqual(intent.clarifyThreshold);
    }
  });

  it('should respect --percentile flag', () => {
    const output75 = execSync(
      'npm run cli:tune-thresholds -- --profile pelangi --percentile 75 --dry-run',
      { encoding: 'utf-8' }
    );
    const result75 = JSON.parse(output75);

    const output90 = execSync(
      'npm run cli:tune-thresholds -- --profile pelangi --percentile 90 --dry-run',
      { encoding: 'utf-8' }
    );
    const result90 = JSON.parse(output90);

    // 90th percentile should produce higher thresholds than 75th
    const booking75 = result75.intents.find((i: any) => i.intent === 'booking');
    const booking90 = result90.intents.find((i: any) => i.intent === 'booking');

    if (booking75 && booking90) {
      expect(booking90.acceptThreshold).toBeGreaterThanOrEqual(booking75.acceptThreshold);
    }
  });

  it('should respect --sample-size flag', () => {
    const output = execSync(
      'npm run cli:tune-thresholds -- --profile pelangi --sample-size 500 --dry-run',
      { encoding: 'utf-8' }
    );

    const result = JSON.parse(output);
    expect(result.sampleSize).toBe(500);
  });

  it('should compute reasonable thresholds for sample data', () => {
    const output = execSync(
      'npm run cli:tune-thresholds -- --profile pelangi --sample-size 1000 --dry-run',
      { encoding: 'utf-8' }
    );

    const result = JSON.parse(output);

    // For sample data, fallback should have low acceptance threshold
    const fallback = result.intents.find((i: any) => i.intent === 'fallback');
    if (fallback) {
      expect(fallback.acceptThreshold).toBeLessThan(0.5);
    }

    // Non-fallback intents should have reasonable thresholds
    const booking = result.intents.find((i: any) => i.intent === 'booking');
    if (booking && booking.sampleCount > 0) {
      expect(booking.acceptThreshold).toBeGreaterThan(0.4);
      expect(booking.acceptThreshold).toBeLessThanOrEqual(1.0);
    }
  });

  it('should include summary statistics', () => {
    const output = execSync(
      'npm run cli:tune-thresholds -- --profile pelangi --dry-run',
      { encoding: 'utf-8' }
    );

    const result = JSON.parse(output);

    expect(result.summary).toBeDefined();
    expect(result.summary.totalIntents).toBeGreaterThan(0);
    expect(result.summary.totalSamples).toBeGreaterThan(0);
  });

  it('should handle empty intent lists gracefully', () => {
    const output = execSync(
      'npm run cli:tune-thresholds -- --profile pelangi --sample-size 10 --dry-run',
      { encoding: 'utf-8' }
    );

    const result = JSON.parse(output);
    expect(result.intents).toBeDefined();
    expect(Array.isArray(result.intents)).toBe(true);
  });

  it('should generate valid ISO timestamp', () => {
    const output = execSync(
      'npm run cli:tune-thresholds -- --profile pelangi --dry-run',
      { encoding: 'utf-8' }
    );

    const result = JSON.parse(output);
    const timestamp = new Date(result.generatedAt);
    expect(timestamp).toBeInstanceOf(Date);
    expect(timestamp.getTime()).toBeGreaterThan(0);
  });
});
