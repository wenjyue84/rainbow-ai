/**
 * US-391: Integration tests for Intent Classification Error Pattern Grouper
 *
 * Tests core pure logic: classifyErrorType, groupIntoClusters,
 * computeInterClusterSeparation, extractKeywordSuggestions,
 * identifyProblematicPairs, and buildReport.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyErrorType,
  groupIntoClusters,
  computeInterClusterSeparation,
  extractKeywordSuggestions,
  identifyProblematicPairs,
  buildReport,
  HIGH_CONFIDENCE_THRESHOLD,
  BOUNDARY_LOW_THRESHOLD,
  type MisclassificationRow,
  type ErrorType,
} from '../group-classification-errors.js';

// ---------------------------------------------------------------------------
// Sample data — deterministic misclassification log
// ---------------------------------------------------------------------------

const SAMPLE_ROWS: MisclassificationRow[] = [
  // False positives (high confidence, wrong intent)
  { messageText: 'I want to book a room for tonight', predictedIntent: 'booking_new', actualIntent: 'inquiry_general', confidence: 0.92, profile: 'pelangi' },
  { messageText: 'Can I reserve a bed?', predictedIntent: 'booking_new', actualIntent: 'inquiry_general', confidence: 0.88, profile: 'pelangi' },
  { messageText: 'Book me in', predictedIntent: 'booking_new', actualIntent: 'inquiry_general', confidence: 0.75, profile: 'pelangi' },
  { messageText: 'Is there a room available?', predictedIntent: 'booking_new', actualIntent: 'inquiry_general', confidence: 0.81, profile: 'pelangi' },
  // Boundary confusions (medium confidence)
  { messageText: 'What time is check in?', predictedIntent: 'check_in', actualIntent: 'inquiry_general', confidence: 0.55, profile: 'pelangi' },
  { messageText: 'When can I check in?', predictedIntent: 'check_in', actualIntent: 'inquiry_general', confidence: 0.62, profile: 'pelangi' },
  { messageText: 'Check in time please', predictedIntent: 'check_in', actualIntent: 'inquiry_general', confidence: 0.48, profile: 'pelangi' },
  { messageText: 'How much is a room?', predictedIntent: 'pricing', actualIntent: 'inquiry_general', confidence: 0.58, profile: 'pelangi' },
  // False negatives (low confidence, missed intent)
  { messageText: 'cancel my reservation', predictedIntent: 'inquiry_general', actualIntent: 'booking_cancel', confidence: 0.30, profile: 'pelangi' },
  { messageText: 'need to cancel booking', predictedIntent: 'inquiry_general', actualIntent: 'booking_cancel', confidence: 0.22, profile: 'pelangi' },
  { messageText: 'please cancel', predictedIntent: 'greeting', actualIntent: 'booking_cancel', confidence: 0.15, profile: 'pelangi' },
  { messageText: 'how to change dates', predictedIntent: 'inquiry_general', actualIntent: 'booking_modify', confidence: 0.35, profile: 'pelangi' },
];

const SAMPLE_KEYWORDS: Record<string, string[]> = {
  booking_new: ['book', 'reserve', 'reservation', 'room'],
  inquiry_general: ['ask', 'question', 'info', 'information'],
  check_in: ['check in', 'checkin', 'arrive'],
  pricing: ['price', 'cost', 'rate', 'how much'],
  booking_cancel: ['cancel', 'cancellation'],
};

// ---------------------------------------------------------------------------
// classifyErrorType
// ---------------------------------------------------------------------------

describe('classifyErrorType', () => {
  it('classifies high confidence as false_positive', () => {
    expect(classifyErrorType(0.92)).toBe('false_positive');
    expect(classifyErrorType(0.75)).toBe('false_positive');
    expect(classifyErrorType(0.70)).toBe('false_positive');
  });

  it('classifies medium confidence as boundary_confusion', () => {
    expect(classifyErrorType(0.55)).toBe('boundary_confusion');
    expect(classifyErrorType(0.62)).toBe('boundary_confusion');
    expect(classifyErrorType(0.45)).toBe('boundary_confusion');
    expect(classifyErrorType(0.69)).toBe('boundary_confusion');
  });

  it('classifies low confidence as false_negative', () => {
    expect(classifyErrorType(0.30)).toBe('false_negative');
    expect(classifyErrorType(0.15)).toBe('false_negative');
    expect(classifyErrorType(0.44)).toBe('false_negative');
    expect(classifyErrorType(0.0)).toBe('false_negative');
  });

  it('exact boundary at HIGH_CONFIDENCE_THRESHOLD', () => {
    expect(classifyErrorType(HIGH_CONFIDENCE_THRESHOLD)).toBe('false_positive');
    expect(classifyErrorType(HIGH_CONFIDENCE_THRESHOLD - 0.001)).toBe('boundary_confusion');
  });

  it('exact boundary at BOUNDARY_LOW_THRESHOLD', () => {
    expect(classifyErrorType(BOUNDARY_LOW_THRESHOLD)).toBe('boundary_confusion');
    expect(classifyErrorType(BOUNDARY_LOW_THRESHOLD - 0.001)).toBe('false_negative');
  });

  it('thresholds are correct values', () => {
    expect(HIGH_CONFIDENCE_THRESHOLD).toBe(0.70);
    expect(BOUNDARY_LOW_THRESHOLD).toBe(0.45);
  });
});

// ---------------------------------------------------------------------------
// groupIntoClusters
// ---------------------------------------------------------------------------

describe('groupIntoClusters', () => {
  it('groups by errorType + predictedIntent + actualIntent', () => {
    const clusters = groupIntoClusters(SAMPLE_ROWS);
    // Each unique (errorType, predicted, actual) combo becomes a cluster
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      expect(c.count).toBeGreaterThan(0);
      expect(c.examples.length).toBeLessThanOrEqual(3);
      expect(c.confidenceRange.min).toBeLessThanOrEqual(c.confidenceRange.max);
    }
  });

  it('limits examples to 3 per cluster', () => {
    const clusters = groupIntoClusters(SAMPLE_ROWS);
    // booking_new -> inquiry_general has 4 false positives
    const fpCluster = clusters.find(
      (c) => c.errorType === 'false_positive' && c.predictedIntent === 'booking_new',
    );
    expect(fpCluster).toBeDefined();
    expect(fpCluster!.count).toBe(4);
    expect(fpCluster!.examples.length).toBe(3);
  });

  it('sorts clusters by count descending', () => {
    const clusters = groupIntoClusters(SAMPLE_ROWS);
    for (let i = 1; i < clusters.length; i++) {
      expect(clusters[i - 1].count).toBeGreaterThanOrEqual(clusters[i].count);
    }
  });

  it('returns empty array for empty input', () => {
    expect(groupIntoClusters([])).toEqual([]);
  });

  it('computes correct mean confidence', () => {
    const rows: MisclassificationRow[] = [
      { messageText: 'a', predictedIntent: 'x', actualIntent: 'y', confidence: 0.80, profile: 'p' },
      { messageText: 'b', predictedIntent: 'x', actualIntent: 'y', confidence: 0.90, profile: 'p' },
    ];
    const clusters = groupIntoClusters(rows);
    expect(clusters[0].confidenceRange.mean).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// computeInterClusterSeparation
// ---------------------------------------------------------------------------

describe('computeInterClusterSeparation', () => {
  it('achieves >80% separation on sample data', () => {
    const separation = computeInterClusterSeparation(SAMPLE_ROWS);
    expect(separation).toBeGreaterThan(0.80);
  });

  it('achieves 100% separation with non-overlapping confidence bands', () => {
    // By design the bands are [0, 0.45), [0.45, 0.70), [0.70, 1.0]
    // Separation should be 1.0 (100%)
    const separation = computeInterClusterSeparation(SAMPLE_ROWS);
    expect(separation).toBe(1.0);
  });

  it('returns 1.0 for empty input', () => {
    expect(computeInterClusterSeparation([])).toBe(1.0);
  });

  it('returns 1.0 for single row', () => {
    expect(computeInterClusterSeparation([SAMPLE_ROWS[0]])).toBe(1.0);
  });

  it('returns 1.0 when all rows have same error type', () => {
    const rows = SAMPLE_ROWS.filter((r) => classifyErrorType(r.confidence) === 'false_positive');
    expect(computeInterClusterSeparation(rows)).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// extractKeywordSuggestions
// ---------------------------------------------------------------------------

describe('extractKeywordSuggestions', () => {
  it('extracts frequent tokens from messages', () => {
    const messages = [
      'I want to book a room for tonight',
      'Can I reserve a room for two nights',
      'Looking for a room near the city',
    ];
    const suggestions = extractKeywordSuggestions(messages, []);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions).toContain('room');
  });

  it('excludes existing keywords', () => {
    const messages = ['I want to book a room for tonight', 'Book a room please'];
    const suggestions = extractKeywordSuggestions(messages, ['room', 'book']);
    expect(suggestions).not.toContain('room');
    expect(suggestions).not.toContain('book');
  });

  it('excludes stop words', () => {
    const messages = ['I want to know if the room is available for me'];
    const suggestions = extractKeywordSuggestions(messages, []);
    expect(suggestions).not.toContain('the');
    expect(suggestions).not.toContain('want');
  });

  it('respects maxSuggestions limit', () => {
    const messages = ['alpha bravo charlie delta echo foxtrot golf hotel india juliet'];
    const suggestions = extractKeywordSuggestions(messages, [], 3);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it('returns empty for empty messages', () => {
    expect(extractKeywordSuggestions([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// identifyProblematicPairs
// ---------------------------------------------------------------------------

describe('identifyProblematicPairs', () => {
  it('identifies confused intent pairs sorted by frequency', () => {
    const pairs = identifyProblematicPairs(SAMPLE_ROWS, SAMPLE_KEYWORDS);
    expect(pairs.length).toBeGreaterThan(0);
    // Most frequent pair should be first
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].confusionCount).toBeGreaterThanOrEqual(pairs[i].confusionCount);
    }
  });

  it('merges bidirectional confusions (A->B and B->A)', () => {
    const rows: MisclassificationRow[] = [
      { messageText: 'test1', predictedIntent: 'booking_new', actualIntent: 'inquiry_general', confidence: 0.8, profile: 'p' },
      { messageText: 'test2', predictedIntent: 'inquiry_general', actualIntent: 'booking_new', confidence: 0.6, profile: 'p' },
    ];
    const pairs = identifyProblematicPairs(rows, {});
    expect(pairs.length).toBe(1);
    expect(pairs[0].confusionCount).toBe(2);
  });

  it('includes keyword suggestions', () => {
    const pairs = identifyProblematicPairs(SAMPLE_ROWS, SAMPLE_KEYWORDS);
    // booking_new <-> inquiry_general pair should have suggestions
    const bookingPair = pairs.find(
      (p) =>
        (p.intentA === 'booking_new' && p.intentB === 'inquiry_general') ||
        (p.intentA === 'inquiry_general' && p.intentB === 'booking_new'),
    );
    expect(bookingPair).toBeDefined();
    expect(bookingPair!.suggestedKeywords).toBeDefined();
  });

  it('returns empty for empty input', () => {
    expect(identifyProblematicPairs([], {})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildReport — full pipeline integration
// ---------------------------------------------------------------------------

describe('buildReport', () => {
  it('produces complete report structure', () => {
    const report = buildReport('pelangi', SAMPLE_ROWS, SAMPLE_KEYWORDS);
    expect(report.profile).toBe('pelangi');
    expect(report.totalMisclassifications).toBe(SAMPLE_ROWS.length);
    expect(report.clusters.length).toBeGreaterThan(0);
    expect(report.problematicPairs.length).toBeGreaterThan(0);
    expect(report.interClusterSeparation).toBeGreaterThanOrEqual(0);
    expect(report.interClusterSeparation).toBeLessThanOrEqual(1);
    expect(report.generatedAt).toBeTruthy();
  });

  it('error type summary counts match total', () => {
    const report = buildReport('pelangi', SAMPLE_ROWS, SAMPLE_KEYWORDS);
    const sum =
      report.errorTypeSummary.false_positive +
      report.errorTypeSummary.boundary_confusion +
      report.errorTypeSummary.false_negative;
    expect(sum).toBe(report.totalMisclassifications);
  });

  it('inter-cluster separation exceeds 80% threshold', () => {
    const report = buildReport('pelangi', SAMPLE_ROWS, SAMPLE_KEYWORDS);
    expect(report.interClusterSeparation).toBeGreaterThan(0.80);
  });

  it('handles empty rows gracefully', () => {
    const report = buildReport('pelangi', [], {});
    expect(report.totalMisclassifications).toBe(0);
    expect(report.clusters).toEqual([]);
    expect(report.problematicPairs).toEqual([]);
  });

  it('sample log produces deterministic clustering', () => {
    // Run buildReport twice with same input -> same clusters
    const r1 = buildReport('pelangi', SAMPLE_ROWS, SAMPLE_KEYWORDS);
    const r2 = buildReport('pelangi', SAMPLE_ROWS, SAMPLE_KEYWORDS);

    expect(r1.clusters.length).toBe(r2.clusters.length);
    expect(r1.errorTypeSummary).toEqual(r2.errorTypeSummary);
    expect(r1.interClusterSeparation).toBe(r2.interClusterSeparation);

    for (let i = 0; i < r1.clusters.length; i++) {
      expect(r1.clusters[i].errorType).toBe(r2.clusters[i].errorType);
      expect(r1.clusters[i].count).toBe(r2.clusters[i].count);
      expect(r1.clusters[i].predictedIntent).toBe(r2.clusters[i].predictedIntent);
      expect(r1.clusters[i].actualIntent).toBe(r2.clusters[i].actualIntent);
    }
  });

  it('report identifies booking vs inquiry as problematic pair', () => {
    const report = buildReport('pelangi', SAMPLE_ROWS, SAMPLE_KEYWORDS);
    const hasPair = report.problematicPairs.some(
      (p) =>
        (p.intentA.includes('booking') && p.intentB.includes('inquiry')) ||
        (p.intentA.includes('inquiry') && p.intentB.includes('booking')),
    );
    expect(hasPair).toBe(true);
  });

  it('clusters contain confidence ranges and examples', () => {
    const report = buildReport('pelangi', SAMPLE_ROWS, SAMPLE_KEYWORDS);
    for (const cluster of report.clusters) {
      expect(cluster.confidenceRange).toBeDefined();
      expect(typeof cluster.confidenceRange.min).toBe('number');
      expect(typeof cluster.confidenceRange.max).toBe('number');
      expect(typeof cluster.confidenceRange.mean).toBe('number');
      expect(cluster.examples.length).toBeGreaterThan(0);
      expect(cluster.examples.length).toBeLessThanOrEqual(3);
    }
  });
});
