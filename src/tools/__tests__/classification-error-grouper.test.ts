import { describe, it, expect } from 'vitest';
import {
  classifyErrorType,
  groupMisclassifications,
  identifyProblematicPairs,
  aggregateKeywordSuggestions,
  buildErrorReport,
  computeInterClusterSeparation,
  type MisclassificationRecord,
  type ErrorCluster,
} from '../classification-error-grouper.js';

// ── Fixture data ──────────────────────────────────────────────────────────────

const sampleRecords: MisclassificationRecord[] = [
  // boundary_confusion: booking group
  { messageText: 'Do you have rooms for this weekend?', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.71 },
  { messageText: 'Any rooms free on Friday?', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.68 },
  { messageText: 'Can I book a capsule for 2 nights?', predictedIntent: 'availability', actualIntent: 'booking', confidence: 0.65 },
  // boundary_confusion: checkin group
  { messageText: 'What time is check in?', predictedIntent: 'check_in_arrival', actualIntent: 'checkin_info', confidence: 0.77 },
  { messageText: 'What is the earliest I can check in?', predictedIntent: 'check_in_arrival', actualIntent: 'checkin_info', confidence: 0.74 },
  // false_positive: booking misclassified as payment context
  { messageText: 'I sent the payment already', predictedIntent: 'booking', actualIntent: 'payment_made', confidence: 0.81 },
  { messageText: 'Transfer done, please confirm', predictedIntent: 'booking', actualIntent: 'payment_made', confidence: 0.78 },
  { messageText: 'I paid RM 120 via transfer', predictedIntent: 'booking', actualIntent: 'payment', confidence: 0.83 },
  // false_negative: unknown predicted
  { messageText: 'Bilik ada tak?', predictedIntent: 'unknown', actualIntent: 'availability', confidence: 0.21 },
  { messageText: 'Nak duduk 3 hari boleh?', predictedIntent: 'unknown', actualIntent: 'booking', confidence: 0.18 },
  { messageText: 'Aircond rosak la', predictedIntent: 'unknown', actualIntent: 'climate_control_complaint', confidence: 0.24 },
];

// ── classifyErrorType ─────────────────────────────────────────────────────────

describe('classifyErrorType', () => {
  it('classifies "unknown" predicted as false_negative', () => {
    const record: MisclassificationRecord = {
      messageText: 'Bilik ada tak?',
      predictedIntent: 'unknown',
      actualIntent: 'availability',
      confidence: 0.21,
    };
    expect(classifyErrorType(record)).toBe('false_negative');
  });

  it('classifies "fallback" predicted as false_negative', () => {
    const record: MisclassificationRecord = {
      messageText: 'Something weird',
      predictedIntent: 'fallback',
      actualIntent: 'greeting',
      confidence: 0.1,
    };
    expect(classifyErrorType(record)).toBe('false_negative');
  });

  it('classifies booking vs availability as boundary_confusion', () => {
    const record: MisclassificationRecord = {
      messageText: 'Do you have rooms?',
      predictedIntent: 'booking',
      actualIntent: 'availability',
      confidence: 0.7,
    };
    expect(classifyErrorType(record)).toBe('boundary_confusion');
  });

  it('classifies checkin_info vs check_in_arrival as boundary_confusion', () => {
    const record: MisclassificationRecord = {
      messageText: 'What time can I check in?',
      predictedIntent: 'check_in_arrival',
      actualIntent: 'checkin_info',
      confidence: 0.75,
    };
    expect(classifyErrorType(record)).toBe('boundary_confusion');
  });

  it('classifies booking vs payment_made as false_positive', () => {
    const record: MisclassificationRecord = {
      messageText: 'I sent the payment',
      predictedIntent: 'booking',
      actualIntent: 'payment_made',
      confidence: 0.81,
    };
    expect(classifyErrorType(record)).toBe('false_positive');
  });

  it('classifies complaint vs greeting as false_positive', () => {
    const record: MisclassificationRecord = {
      messageText: 'Hi there',
      predictedIntent: 'complaint',
      actualIntent: 'greeting',
      confidence: 0.6,
    };
    expect(classifyErrorType(record)).toBe('false_positive');
  });
});

// ── groupMisclassifications ────────────────────────────────────────────────────

describe('groupMisclassifications', () => {
  it('returns correct number of unique clusters', () => {
    const clusters = groupMisclassifications(sampleRecords);
    // unique (errorType, predicted, actual) combos:
    // boundary: booking→availability, availability→booking, check_in_arrival→checkin_info
    // false_positive: booking→payment_made, booking→payment
    // false_negative: unknown→availability, unknown→booking, unknown→climate_control_complaint
    expect(clusters.length).toBe(8);
  });

  it('sorts clusters by frequency descending', () => {
    const clusters = groupMisclassifications(sampleRecords);
    for (let i = 0; i < clusters.length - 1; i++) {
      expect(clusters[i].frequency).toBeGreaterThanOrEqual(clusters[i + 1].frequency);
    }
  });

  it('limits examples to 3 per cluster', () => {
    const repeated: MisclassificationRecord[] = Array.from({ length: 10 }, (_, i) => ({
      messageText: `Message number ${i}`,
      predictedIntent: 'booking',
      actualIntent: 'availability',
      confidence: 0.7,
    }));
    const clusters = groupMisclassifications(repeated);
    expect(clusters[0].examples).toHaveLength(3);
  });

  it('calculates confidence range correctly', () => {
    const records: MisclassificationRecord[] = [
      { messageText: 'a', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.60 },
      { messageText: 'b', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.80 },
      { messageText: 'c', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.70 },
    ];
    const clusters = groupMisclassifications(records);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].confidenceRange.min).toBe(0.6);
    expect(clusters[0].confidenceRange.max).toBe(0.8);
    expect(clusters[0].confidenceRange.mean).toBeCloseTo(0.7, 2);
  });

  it('returns empty array for empty input', () => {
    expect(groupMisclassifications([])).toEqual([]);
  });

  it('assigns correct errorType to each cluster', () => {
    const clusters = groupMisclassifications(sampleRecords);
    const types = new Set(clusters.map((c) => c.errorType));
    expect(types.has('false_positive')).toBe(true);
    expect(types.has('false_negative')).toBe(true);
    expect(types.has('boundary_confusion')).toBe(true);
  });

  it('produces deterministic output (same input → same output)', () => {
    const clusters1 = groupMisclassifications(sampleRecords);
    const clusters2 = groupMisclassifications(sampleRecords);
    expect(JSON.stringify(clusters1)).toBe(JSON.stringify(clusters2));
  });
});

// ── identifyProblematicPairs ───────────────────────────────────────────────────

describe('identifyProblematicPairs', () => {
  it('identifies booking↔availability as a top problematic pair', () => {
    const clusters = groupMisclassifications(sampleRecords);
    const pairs = identifyProblematicPairs(clusters);
    const bookingAvail = pairs.find(
      (p) =>
        (p.intent1 === 'booking' && p.intent2 === 'availability') ||
        (p.intent1 === 'availability' && p.intent2 === 'booking')
    );
    expect(bookingAvail).toBeDefined();
    expect(bookingAvail!.confusionCount).toBeGreaterThan(0);
  });

  it('includes suggested keywords for problematic pairs', () => {
    const clusters = groupMisclassifications(sampleRecords);
    const pairs = identifyProblematicPairs(clusters);
    const pairsWithKeywords = pairs.filter((p) => p.suggestedKeywords.length > 0);
    expect(pairsWithKeywords.length).toBeGreaterThan(0);
  });

  it('sorts pairs by confusionCount descending', () => {
    const clusters = groupMisclassifications(sampleRecords);
    const pairs = identifyProblematicPairs(clusters);
    for (let i = 0; i < pairs.length - 1; i++) {
      expect(pairs[i].confusionCount).toBeGreaterThanOrEqual(pairs[i + 1].confusionCount);
    }
  });

  it('skips false_negative clusters (no keyword fix)', () => {
    const fnClusters: ErrorCluster[] = [
      {
        errorType: 'false_negative',
        predictedIntent: 'unknown',
        actualIntent: 'booking',
        frequency: 10,
        confidenceRange: { min: 0.1, max: 0.3, mean: 0.2 },
        examples: ['Nak book'],
      },
    ];
    const pairs = identifyProblematicPairs(fnClusters);
    expect(pairs).toHaveLength(0);
  });
});

// ── buildErrorReport ──────────────────────────────────────────────────────────

describe('buildErrorReport', () => {
  it('returns report with correct profile', () => {
    const report = buildErrorReport('pelangi', sampleRecords);
    expect(report.profile).toBe('pelangi');
  });

  it('returns correct totalMisclassifications', () => {
    const report = buildErrorReport('pelangi', sampleRecords);
    expect(report.totalMisclassifications).toBe(sampleRecords.length);
  });

  it('report has clusters, problematicPairs, and keywordSuggestions', () => {
    const report = buildErrorReport('pelangi', sampleRecords);
    expect(Array.isArray(report.clusters)).toBe(true);
    expect(Array.isArray(report.problematicPairs)).toBe(true);
    expect(typeof report.keywordSuggestions).toBe('object');
  });

  it('each cluster has required fields', () => {
    const report = buildErrorReport('pelangi', sampleRecords);
    for (const cluster of report.clusters) {
      expect(cluster).toHaveProperty('errorType');
      expect(cluster).toHaveProperty('predictedIntent');
      expect(cluster).toHaveProperty('actualIntent');
      expect(cluster).toHaveProperty('frequency');
      expect(cluster).toHaveProperty('confidenceRange');
      expect(cluster).toHaveProperty('examples');
      expect(cluster.examples.length).toBeGreaterThan(0);
      expect(cluster.examples.length).toBeLessThanOrEqual(3);
    }
  });
});

// ── computeInterClusterSeparation ─────────────────────────────────────────────

describe('computeInterClusterSeparation', () => {
  it('returns >0.80 separation score for sample records', () => {
    const clusters = groupMisclassifications(sampleRecords);
    const separation = computeInterClusterSeparation(sampleRecords, clusters);
    expect(separation).toBeGreaterThan(0.8);
  });

  it('returns 1.0 for perfectly separated clusters', () => {
    const records: MisclassificationRecord[] = [
      { messageText: 'a', predictedIntent: 'booking', actualIntent: 'availability', confidence: 0.7 },
      { messageText: 'b', predictedIntent: 'unknown', actualIntent: 'booking', confidence: 0.2 },
    ];
    const clusters = groupMisclassifications(records);
    const separation = computeInterClusterSeparation(records, clusters);
    expect(separation).toBe(1.0);
  });

  it('returns 1.0 for empty records', () => {
    const separation = computeInterClusterSeparation([], []);
    expect(separation).toBe(1.0);
  });
});

// ── Integration: full workflow ────────────────────────────────────────────────

describe('Integration: sample misclassification log', () => {
  it('produces deterministic clustering with >80% inter-cluster separation', () => {
    // Run twice to verify determinism
    const report1 = buildErrorReport('pelangi', sampleRecords);
    const report2 = buildErrorReport('pelangi', sampleRecords);
    expect(JSON.stringify(report1)).toBe(JSON.stringify(report2));

    // Verify separation
    const clusters = groupMisclassifications(sampleRecords);
    const separation = computeInterClusterSeparation(sampleRecords, clusters);
    expect(separation).toBeGreaterThan(0.8);
  });

  it('identifies booking/availability as a top-2 problematic pair', () => {
    const report = buildErrorReport('pelangi', sampleRecords);
    const topPairs = report.problematicPairs.slice(0, 2);
    const found = topPairs.some(
      (p) =>
        (p.intent1 === 'booking' && p.intent2 === 'availability') ||
        (p.intent1 === 'availability' && p.intent2 === 'booking')
    );
    expect(found).toBe(true);
  });

  it('suggests keywords for intents appearing in false_positive clusters', () => {
    const report = buildErrorReport('pelangi', sampleRecords);
    const suggestedIntents = Object.keys(report.keywordSuggestions);
    expect(suggestedIntents.length).toBeGreaterThan(0);
  });

  it('all clusters have at least one example message', () => {
    const report = buildErrorReport('pelangi', sampleRecords);
    for (const cluster of report.clusters) {
      expect(cluster.examples.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('covers all three error types in sample data', () => {
    const report = buildErrorReport('pelangi', sampleRecords);
    const types = new Set(report.clusters.map((c) => c.errorType));
    expect(types.has('false_positive')).toBe(true);
    expect(types.has('false_negative')).toBe(true);
    expect(types.has('boundary_confusion')).toBe(true);
  });
});
