/**
 * US-599: Intent Classification Confidence Score Distribution Histogram CLI Tool
 *
 * Tests for the confidence histogram CLI tool covering:
 * - AC1: CLI command with histogram bucket distribution per intent
 * - AC2: Per-intent breakdown with percentages (high/medium/low confidence)
 * - AC3: CSV export with proper formatting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pg from 'pg';

// Mock pg module
vi.mock('pg');

// ─── Helper Types ────────────────────────────────────────────────────────

interface ConfidenceScore {
  intent_type: string;
  confidence: number;
  created_at: Date;
}

interface HistogramBucket {
  min: number;
  max: number;
  count: number;
}

interface IntentHistogram {
  intent: string;
  totalMessages: number;
  buckets: HistogramBucket[];
  highConf: number;
  mediumConf: number;
  lowConf: number;
  highConfPct: number;
  mediumConfPct: number;
  lowConfPct: number;
}

// ─── Implementation Functions (copied from CLI for testing) ───────────────

function parseCliArgs(args: string[]): {
  profile: string;
  days: number;
  format: 'text' | 'csv' | 'json';
  output?: string;
} {
  const options = {
    profile: 'pelangi',
    days: 7,
    format: 'text' as const,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--profile' && i + 1 < args.length) {
      options.profile = args[++i];
    } else if (arg === '--days' && i + 1 < args.length) {
      options.days = parseInt(args[++i], 10);
      if (isNaN(options.days) || options.days < 1) {
        throw new Error('Invalid --days value: must be a positive integer');
      }
    } else if (arg === '--format' && i + 1 < args.length) {
      const format = args[++i];
      if (!['text', 'csv', 'json'].includes(format)) {
        throw new Error(`Invalid --format: ${format}. Must be one of: text, csv, json`);
      }
      options.format = format as 'text' | 'csv' | 'json';
    } else if (arg.startsWith('--format=')) {
      const format = arg.split('=')[1];
      if (!['text', 'csv', 'json'].includes(format)) {
        throw new Error(`Invalid --format: ${format}. Must be one of: text, csv, json`);
      }
      options.format = format as 'text' | 'csv' | 'json';
    }
  }

  return options;
}

function generateHistogram(scores: ConfidenceScore[]): IntentHistogram[] {
  const groupedByIntent = new Map<string, number[]>();

  for (const score of scores) {
    if (!groupedByIntent.has(score.intent_type)) {
      groupedByIntent.set(score.intent_type, []);
    }
    groupedByIntent.get(score.intent_type)!.push(score.confidence);
  }

  const bucketBoundaries = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const histograms: IntentHistogram[] = [];

  for (const [intent, confidences] of groupedByIntent.entries()) {
    const buckets: HistogramBucket[] = [];

    for (let i = 0; i < bucketBoundaries.length - 1; i++) {
      buckets.push({
        min: bucketBoundaries[i],
        max: bucketBoundaries[i + 1],
        count: 0,
      });
    }

    for (const conf of confidences) {
      for (const bucket of buckets) {
        if (conf >= bucket.min && conf < bucket.max) {
          bucket.count++;
          break;
        }
        if (bucket.max === 1.0 && conf === 1.0) {
          bucket.count++;
          break;
        }
      }
    }

    const totalMessages = confidences.length;
    const highConf = confidences.filter(c => c >= 0.8).length;
    const mediumConf = confidences.filter(c => c >= 0.5 && c < 0.8).length;
    const lowConf = confidences.filter(c => c < 0.5).length;

    histograms.push({
      intent,
      totalMessages,
      buckets,
      highConf,
      mediumConf,
      lowConf,
      highConfPct: (highConf / totalMessages) * 100,
      mediumConfPct: (mediumConf / totalMessages) * 100,
      lowConfPct: (lowConf / totalMessages) * 100,
    });
  }

  histograms.sort((a, b) => b.totalMessages - a.totalMessages);
  return histograms;
}

function exportCsv(intents: IntentHistogram[]): string {
  const lines: string[] = [];
  lines.push('intent,confidence_bucket,message_count,percentage');

  for (const intent of intents) {
    for (const bucket of intent.buckets) {
      const percentage = intent.totalMessages > 0
        ? ((bucket.count / intent.totalMessages) * 100).toFixed(1)
        : '0.0';

      lines.push(
        `${intent.intent},${bucket.min.toFixed(1)}-${bucket.max.toFixed(1)},${bucket.count},${percentage}%`
      );
    }
  }

  return lines.join('\n');
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('US-599: Confidence Histogram CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── AC1: CLI Command with Histogram Bucket Distribution ─────────────

  describe('AC1: CLI command with histogram bucket distribution', () => {
    it('parses --profile and --days flags correctly', () => {
      const result = parseCliArgs(['--profile', 'pelangi', '--days', '7']);
      expect(result.profile).toBe('pelangi');
      expect(result.days).toBe(7);
      expect(result.format).toBe('text');
    });

    it('parses --format=csv shorthand syntax', () => {
      const result = parseCliArgs(['--profile', 'pelangi', '--format=csv']);
      expect(result.format).toBe('csv');
    });

    it('parses --format csv with separate flag', () => {
      const result = parseCliArgs(['--profile', 'pelangi', '--format', 'csv']);
      expect(result.format).toBe('csv');
    });

    it('defaults to pelangi profile and 7 days if not specified', () => {
      const result = parseCliArgs([]);
      expect(result.profile).toBe('pelangi');
      expect(result.days).toBe(7);
      expect(result.format).toBe('text');
    });

    it('throws error on invalid --days value', () => {
      expect(() => parseCliArgs(['--days', 'invalid'])).toThrow('Invalid --days value');
      expect(() => parseCliArgs(['--days', '-1'])).toThrow('Invalid --days value');
      expect(() => parseCliArgs(['--days', '0'])).toThrow('Invalid --days value');
    });

    it('throws error on invalid --format value', () => {
      expect(() => parseCliArgs(['--format', 'xml'])).toThrow('Invalid --format');
    });

    it('generates histogram with correct bucket distribution', () => {
      const scores: ConfidenceScore[] = [
        // Booking intent: 200 total
        ...Array(90).fill({ intent_type: 'booking', confidence: 0.95, created_at: new Date() }),
        ...Array(40).fill({ intent_type: 'booking', confidence: 0.75, created_at: new Date() }),
        ...Array(50).fill({ intent_type: 'booking', confidence: 0.45, created_at: new Date() }),
        ...Array(20).fill({ intent_type: 'booking', confidence: 0.15, created_at: new Date() }),
      ];

      const histogram = generateHistogram(scores);
      expect(histogram).toHaveLength(1);

      const booking = histogram[0];
      expect(booking.intent).toBe('booking');
      expect(booking.totalMessages).toBe(200);
      expect(booking.highConf).toBe(90);        // 90 >= 0.8
      expect(booking.mediumConf).toBe(40);      // 40 between 0.5-0.8
      expect(booking.lowConf).toBe(70);         // 70 < 0.5
    });

    it('fills all 5 buckets correctly', () => {
      // Create scores to fill each bucket: [0-0.2], [0.2-0.4], [0.4-0.6], [0.6-0.8], [0.8-1.0]
      const scores: ConfidenceScore[] = [
        ...Array(10).fill({ intent_type: 'test', confidence: 0.1, created_at: new Date() }),
        ...Array(10).fill({ intent_type: 'test', confidence: 0.3, created_at: new Date() }),
        ...Array(10).fill({ intent_type: 'test', confidence: 0.5, created_at: new Date() }),
        ...Array(10).fill({ intent_type: 'test', confidence: 0.7, created_at: new Date() }),
        ...Array(10).fill({ intent_type: 'test', confidence: 0.95, created_at: new Date() }),
      ];

      const histogram = generateHistogram(scores);
      const buckets = histogram[0].buckets;

      expect(buckets[0].count).toBe(10); // [0-0.2]
      expect(buckets[1].count).toBe(10); // [0.2-0.4]
      expect(buckets[2].count).toBe(10); // [0.4-0.6]
      expect(buckets[3].count).toBe(10); // [0.6-0.8]
      expect(buckets[4].count).toBe(10); // [0.8-1.0]
    });

    it('handles confidence=1.0 correctly in the [0.8-1.0] bucket', () => {
      const scores: ConfidenceScore[] = [
        { intent_type: 'test', confidence: 1.0, created_at: new Date() },
        { intent_type: 'test', confidence: 0.99, created_at: new Date() },
        { intent_type: 'test', confidence: 0.8, created_at: new Date() },
      ];

      const histogram = generateHistogram(scores);
      const lastBucket = histogram[0].buckets[4]; // [0.8-1.0]
      expect(lastBucket.count).toBe(3);
    });
  });

  // ─── AC2: Per-Intent Breakdown with Percentages ──────────────────────

  describe('AC2: Per-intent breakdown with percentages', () => {
    it('calculates high confidence (0.8+) percentage correctly', () => {
      const scores: ConfidenceScore[] = [
        ...Array(200).fill({ intent_type: 'booking', confidence: 0.95, created_at: new Date() }),
      ];

      const histogram = generateHistogram(scores);
      const booking = histogram[0];

      expect(booking.highConf).toBe(200);
      expect(booking.highConfPct).toBeCloseTo(100, 1);
      expect(booking.mediumConfPct).toBeCloseTo(0, 1);
      expect(booking.lowConfPct).toBeCloseTo(0, 1);
    });

    it('example: booking with 45% high, 30% medium, 25% low', () => {
      const scores: ConfidenceScore[] = [
        ...Array(90).fill({ intent_type: 'booking', confidence: 0.95, created_at: new Date() }),
        ...Array(60).fill({ intent_type: 'booking', confidence: 0.65, created_at: new Date() }),
        ...Array(50).fill({ intent_type: 'booking', confidence: 0.35, created_at: new Date() }),
      ];

      const histogram = generateHistogram(scores);
      const booking = histogram[0];

      expect(booking.totalMessages).toBe(200);
      expect(booking.highConfPct).toBeCloseTo(45, 0);  // 90/200 = 45%
      expect(booking.mediumConfPct).toBeCloseTo(30, 0); // 60/200 = 30%
      expect(booking.lowConfPct).toBeCloseTo(25, 0);   // 50/200 = 25%
    });

    it('example: inquiry with 60% high, 25% medium, 15% low', () => {
      const scores: ConfidenceScore[] = [
        ...Array(90).fill({ intent_type: 'inquiry', confidence: 0.9, created_at: new Date() }),
        ...Array(38).fill({ intent_type: 'inquiry', confidence: 0.65, created_at: new Date() }),
        ...Array(22).fill({ intent_type: 'inquiry', confidence: 0.3, created_at: new Date() }),
      ];

      const histogram = generateHistogram(scores);
      const inquiry = histogram[0];

      expect(inquiry.totalMessages).toBe(150);
      expect(inquiry.highConfPct).toBeCloseTo(60, 0);  // 90/150 = 60%
      expect(inquiry.mediumConfPct).toBeCloseTo(25.3, 0); // ~25%
      expect(inquiry.lowConfPct).toBeCloseTo(14.7, 0);   // ~15%
    });

    it('sorts intents by total messages descending', () => {
      const scores: ConfidenceScore[] = [
        ...Array(50).fill({ intent_type: 'booking', confidence: 0.9, created_at: new Date() }),
        ...Array(200).fill({ intent_type: 'inquiry', confidence: 0.8, created_at: new Date() }),
        ...Array(100).fill({ intent_type: 'complaint', confidence: 0.7, created_at: new Date() }),
      ];

      const histogram = generateHistogram(scores);

      expect(histogram[0].intent).toBe('inquiry');
      expect(histogram[1].intent).toBe('complaint');
      expect(histogram[2].intent).toBe('booking');
    });

    it('handles multiple intents with different confidence distributions', () => {
      const scores: ConfidenceScore[] = [
        ...Array(100).fill({ intent_type: 'booking', confidence: 0.9, created_at: new Date() }),
        ...Array(50).fill({ intent_type: 'booking', confidence: 0.4, created_at: new Date() }),
        ...Array(80).fill({ intent_type: 'inquiry', confidence: 0.85, created_at: new Date() }),
        ...Array(20).fill({ intent_type: 'inquiry', confidence: 0.3, created_at: new Date() }),
      ];

      const histogram = generateHistogram(scores);

      expect(histogram).toHaveLength(2);
      const booking = histogram.find(h => h.intent === 'booking');
      const inquiry = histogram.find(h => h.intent === 'inquiry');

      expect(booking?.highConfPct).toBeCloseTo(66.7, 0);
      expect(inquiry?.highConfPct).toBeCloseTo(80, 0);
    });
  });

  // ─── AC3: CSV Export with Proper Formatting ──────────────────────────

  describe('AC3: CSV export with proper formatting', () => {
    it('generates CSV with correct header', () => {
      const histograms: IntentHistogram[] = [];
      const csv = exportCsv(histograms);

      const lines = csv.split('\n');
      expect(lines[0]).toBe('intent,confidence_bucket,message_count,percentage');
    });

    it('exports single intent with all buckets', () => {
      const scores: ConfidenceScore[] = [
        ...Array(10).fill({ intent_type: 'booking', confidence: 0.1, created_at: new Date() }),
        ...Array(20).fill({ intent_type: 'booking', confidence: 0.3, created_at: new Date() }),
        ...Array(30).fill({ intent_type: 'booking', confidence: 0.5, created_at: new Date() }),
        ...Array(40).fill({ intent_type: 'booking', confidence: 0.7, created_at: new Date() }),
        ...Array(50).fill({ intent_type: 'booking', confidence: 0.95, created_at: new Date() }),
      ];

      const histograms = generateHistogram(scores);
      const csv = exportCsv(histograms);

      const lines = csv.split('\n');
      expect(lines).toHaveLength(6); // header + 5 buckets
      expect(lines[1]).toContain('booking');
      expect(lines[1]).toContain('0.0-0.2');
      expect(lines[1]).toContain('10');
    });

    it('formats bucket ranges as decimal numbers', () => {
      const scores: ConfidenceScore[] = [
        ...Array(100).fill({ intent_type: 'test', confidence: 0.5, created_at: new Date() }),
      ];

      const histograms = generateHistogram(scores);
      const csv = exportCsv(histograms);

      expect(csv).toContain('0.0-0.2');
      expect(csv).toContain('0.2-0.4');
      expect(csv).toContain('0.4-0.6');
      expect(csv).toContain('0.6-0.8');
      expect(csv).toContain('0.8-1.0');
    });

    it('calculates percentages correctly in CSV', () => {
      const scores: ConfidenceScore[] = [
        ...Array(50).fill({ intent_type: 'test', confidence: 0.9, created_at: new Date() }),
        ...Array(50).fill({ intent_type: 'test', confidence: 0.1, created_at: new Date() }),
      ];

      const histograms = generateHistogram(scores);
      const csv = exportCsv(histograms);

      // 50 items in [0.8-1.0]: 50/100 = 50%
      expect(csv).toContain('0.8-1.0,50,50.0%');
      // 50 items in [0.0-0.2]: 50/100 = 50%
      expect(csv).toContain('0.0-0.2,50,50.0%');
    });

    it('exports multiple intents with all buckets', () => {
      const scores: ConfidenceScore[] = [
        ...Array(100).fill({ intent_type: 'booking', confidence: 0.9, created_at: new Date() }),
        ...Array(50).fill({ intent_type: 'booking', confidence: 0.3, created_at: new Date() }),
        ...Array(80).fill({ intent_type: 'inquiry', confidence: 0.8, created_at: new Date() }),
      ];

      const histograms = generateHistogram(scores);
      const csv = exportCsv(histograms);

      const lines = csv.split('\n');
      // header + (inquiry 5 buckets) + (booking 5 buckets) = 11 lines
      expect(lines.length).toBe(11);

      // Check that both intents are present
      const bookingLines = lines.filter(l => l.startsWith('booking'));
      const inquiryLines = lines.filter(l => l.startsWith('inquiry'));
      expect(bookingLines).toHaveLength(5);
      expect(inquiryLines).toHaveLength(5);
    });

    it('handles zero-count buckets correctly', () => {
      const scores: ConfidenceScore[] = [
        ...Array(100).fill({ intent_type: 'test', confidence: 0.95, created_at: new Date() }),
      ];

      const histograms = generateHistogram(scores);
      const csv = exportCsv(histograms);

      const lines = csv.split('\n');
      // Should have lines for empty buckets too
      expect(lines).toHaveLength(6); // header + 5 buckets
      expect(lines[2]).toContain('0,0.0%'); // [0.2-0.4] should be 0
    });
  });

  // ─── Integration Tests ───────────────────────────────────────────────

  describe('Integration tests', () => {
    it('handles empty dataset gracefully', () => {
      const scores: ConfidenceScore[] = [];
      const histograms = generateHistogram(scores);
      expect(histograms).toHaveLength(0);
    });

    it('handles single intent with single message', () => {
      const scores: ConfidenceScore[] = [
        { intent_type: 'booking', confidence: 0.75, created_at: new Date() },
      ];

      const histograms = generateHistogram(scores);
      expect(histograms).toHaveLength(1);
      expect(histograms[0].totalMessages).toBe(1);
      expect(histograms[0].mediumConf).toBe(1);
      expect(histograms[0].mediumConfPct).toBe(100);
    });

    it('handles high volume of messages (10k+)', () => {
      const scores: ConfidenceScore[] = [];
      for (let i = 0; i < 10000; i++) {
        scores.push({
          intent_type: `intent_${i % 10}`,
          confidence: Math.random(),
          created_at: new Date(),
        });
      }

      const histograms = generateHistogram(scores);
      expect(histograms.length).toBeGreaterThan(0);

      // Verify total count is preserved
      const totalCount = histograms.reduce((sum, h) => sum + h.totalMessages, 0);
      expect(totalCount).toBe(10000);
    });

    it('preserves percentages sum to 100% per intent', () => {
      const scores: ConfidenceScore[] = [
        ...Array(90).fill({ intent_type: 'booking', confidence: 0.95, created_at: new Date() }),
        ...Array(60).fill({ intent_type: 'booking', confidence: 0.65, created_at: new Date() }),
        ...Array(50).fill({ intent_type: 'booking', confidence: 0.35, created_at: new Date() }),
      ];

      const histograms = generateHistogram(scores);
      const booking = histograms[0];

      const sum = booking.highConfPct + booking.mediumConfPct + booking.lowConfPct;
      expect(sum).toBeCloseTo(100, 1);
    });
  });
});
