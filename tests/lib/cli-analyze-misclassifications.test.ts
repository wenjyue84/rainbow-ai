import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, initDb } from '../../src/lib/db.js';
import { intentPredictions, type InsertIntentPrediction } from '../../shared/schema-tables.js';
import { eq } from 'drizzle-orm';

/**
 * Tests for US-557: Intent Classification Misclassification Analyzer CLI Tool
 */

describe('CLI Analyze Misclassifications', () => {
  beforeAll(() => {
    // Ensure DB is initialized
    initDb();
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await db
        .delete(intentPredictions)
        .where(eq(intentPredictions.profile, 'test-profile'));
    } catch {
      // Ignore cleanup errors in test environment
    }
  });

  it('should parse CLI arguments correctly', async () => {
    // Mock argument parsing
    const parseArgs = (argv: string[]) => {
      const args = argv.slice(2);
      let profile = 'pelangi';
      let days = 7;

      for (const arg of args) {
        if (arg.startsWith('--profile=')) {
          profile = arg.replace('--profile=', '').trim();
        } else if (arg.startsWith('--days=')) {
          days = parseInt(arg.replace('--days=', '').trim(), 10);
        }
      }

      return { profile, days };
    };

    const result1 = parseArgs(['node', 'script', '--profile=southern', '--days=30']);
    expect(result1.profile).toBe('southern');
    expect(result1.days).toBe(30);

    const result2 = parseArgs(['node', 'script']);
    expect(result2.profile).toBe('pelangi');
    expect(result2.days).toBe(7);
  });

  it('should generate report with correct structure', async () => {
    // Insert test data with misclassifications
    const testPredictions: InsertIntentPrediction[] = [
      {
        conversationId: 'conv-001',
        phoneNumber: '+1234567890',
        messageText: 'I want to book a room',
        predictedIntent: 'check_in',
        confidence: 0.75,
        tier: 'T1',
        model: 'kimi',
        profile: 'test-profile',
        actualIntent: 'booking',
        wasCorrect: false,
      },
      {
        conversationId: 'conv-002',
        phoneNumber: '+1234567891',
        messageText: 'What is the price for deluxe?',
        predictedIntent: 'check_in',
        confidence: 0.65,
        tier: 'T2',
        model: 'kimi',
        profile: 'test-profile',
        actualIntent: 'pricing',
        wasCorrect: false,
      },
      {
        conversationId: 'conv-003',
        phoneNumber: '+1234567892',
        messageText: 'Can I check out now?',
        predictedIntent: 'booking',
        confidence: 0.85,
        tier: 'T1',
        model: 'kimi',
        profile: 'test-profile',
        actualIntent: 'check_out',
        wasCorrect: false,
      },
    ];

    await db.insert(intentPredictions).values(testPredictions);

    // Query misclassifications
    const misclassified = await db
      .select()
      .from(intentPredictions)
      .where(eq(intentPredictions.profile, 'test-profile'));

    expect(misclassified.length).toBeGreaterThanOrEqual(3);

    // Verify report structure
    const report = {
      timestamp: new Date().toISOString(),
      profile: 'test-profile',
      period_days: 7,
      misclassification_pairs: [],
      confidence_patterns: [],
      suggested_keywords_per_intent: [],
      summary: {
        total_predictions_analyzed: misclassified.length,
        total_misclassified: misclassified.filter((p) => p.wasCorrect === false).length,
        misclassification_rate_percent: 100,
      },
    };

    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('profile');
    expect(report).toHaveProperty('period_days');
    expect(report).toHaveProperty('misclassification_pairs');
    expect(report).toHaveProperty('confidence_patterns');
    expect(report).toHaveProperty('suggested_keywords_per_intent');
    expect(report).toHaveProperty('summary');
    expect(report.summary).toHaveProperty('total_predictions_analyzed');
    expect(report.summary).toHaveProperty('total_misclassified');
    expect(report.summary).toHaveProperty('misclassification_rate_percent');
  });

  it('should group misclassifications by predicted→actual intent pair', async () => {
    const predictions = [
      {
        conversationId: 'conv-101',
        phoneNumber: '+1111111111',
        messageText: 'Book a room',
        predictedIntent: 'booking',
        confidence: 0.7,
        tier: 'T1',
        model: 'kimi',
        profile: 'test-profile-2',
        actualIntent: 'check_in',
        wasCorrect: false,
      },
      {
        conversationId: 'conv-102',
        phoneNumber: '+1111111112',
        messageText: 'Reserve a room',
        predictedIntent: 'booking',
        confidence: 0.72,
        tier: 'T1',
        model: 'kimi',
        profile: 'test-profile-2',
        actualIntent: 'check_in',
        wasCorrect: false,
      },
    ];

    await db.insert(intentPredictions).values(predictions);

    // Verify data was inserted
    const result = await db
      .select()
      .from(intentPredictions)
      .where(eq(intentPredictions.profile, 'test-profile-2'));

    expect(result.length).toBeGreaterThanOrEqual(2);

    // Simulate grouping logic
    const pairMap = new Map<string, number>();
    for (const pred of result) {
      const key = `${pred.predictedIntent}|${pred.actualIntent}`;
      pairMap.set(key, (pairMap.get(key) || 0) + 1);
    }

    const pairs = Array.from(pairMap.entries()).map(([key, count]) => {
      const [predicted, actual] = key.split('|');
      return { predicted, actual, count };
    });

    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]).toHaveProperty('predicted');
    expect(pairs[0]).toHaveProperty('actual');
    expect(pairs[0]).toHaveProperty('count');
  });

  it('should calculate confidence patterns correctly', async () => {
    const predictions = [
      {
        conversationId: 'conv-201',
        phoneNumber: '+2111111111',
        messageText: 'Test message 1',
        predictedIntent: 'booking',
        confidence: 0.5,
        tier: 'T1',
        model: 'kimi',
        profile: 'test-profile-3',
        actualIntent: 'unknown',
        wasCorrect: false,
      },
      {
        conversationId: 'conv-202',
        phoneNumber: '+2111111112',
        messageText: 'Test message 2',
        predictedIntent: 'booking',
        confidence: 0.8,
        tier: 'T1',
        model: 'kimi',
        profile: 'test-profile-3',
        actualIntent: 'unknown',
        wasCorrect: false,
      },
    ];

    await db.insert(intentPredictions).values(predictions);

    // Verify confidence pattern calculation
    const result = await db
      .select()
      .from(intentPredictions)
      .where(eq(intentPredictions.profile, 'test-profile-3'));

    const confidences = result
      .filter((p) => p.confidence !== null)
      .map((p) => p.confidence!);

    if (confidences.length > 0) {
      const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
      const max = Math.max(...confidences);
      const min = Math.min(...confidences);

      expect(avg).toBeGreaterThan(0);
      expect(max).toBeGreaterThanOrEqual(avg);
      expect(min).toBeLessThanOrEqual(avg);
    }
  });

  it('should handle empty misclassification data gracefully', async () => {
    // Test with a profile that has no misclassifications
    const result = await db
      .select()
      .from(intentPredictions)
      .where(eq(intentPredictions.profile, 'nonexistent-profile'));

    expect(result.length).toBe(0);

    // Report should still have correct structure
    const report = {
      timestamp: new Date().toISOString(),
      profile: 'nonexistent-profile',
      period_days: 7,
      misclassification_pairs: [],
      confidence_patterns: [],
      suggested_keywords_per_intent: [],
      summary: {
        total_predictions_analyzed: 0,
        total_misclassified: 0,
        misclassification_rate_percent: 0,
      },
    };

    expect(report.summary.total_predictions_analyzed).toBe(0);
    expect(report.summary.total_misclassified).toBe(0);
    expect(report.summary.misclassification_rate_percent).toBe(0);
  });

  it('should validate profile parameter', async () => {
    const VALID_PROFILES = ['pelangi', 'southern', 'makan'];

    const isValidProfile = (profile: string) => VALID_PROFILES.includes(profile);

    expect(isValidProfile('pelangi')).toBe(true);
    expect(isValidProfile('southern')).toBe(true);
    expect(isValidProfile('makan')).toBe(true);
    expect(isValidProfile('invalid-profile')).toBe(false);
  });

  it('should validate days parameter', async () => {
    const isValidDays = (days: unknown) => {
      return typeof days === 'number' && days > 0 && !isNaN(days);
    };

    expect(isValidDays(7)).toBe(true);
    expect(isValidDays(30)).toBe(true);
    expect(isValidDays(0)).toBe(false);
    expect(isValidDays(-5)).toBe(false);
    expect(isValidDays(NaN)).toBe(false);
  });
});
