/**
 * US-391: Intent Classification Error Pattern Grouper
 *
 * Pure logic module — groups intent misclassifications by error type
 * (false positives, false negatives, boundary confusions) with keywords
 * and confidence ranges for actionable remediation.
 *
 * CLI wrapper: group-classification-errors-cli.ts
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HIGH_CONFIDENCE_THRESHOLD = 0.70;
export const BOUNDARY_LOW_THRESHOLD = 0.45;

export const PROFILE_ALIASES: Record<string, string> = {
  'data-pelangi': 'pelangi',
  'pelangi': 'pelangi',
  'data-southern': 'southern',
  'southern': 'southern',
  'data-makan': 'makan',
  'makan': 'makan',
  'data-pms-capsule': 'pms-capsule',
  'pms-capsule': 'pms-capsule',
};

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they',
  'the', 'a', 'an', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'can', 'may', 'might', 'shall', 'want', 'know', 'need', 'like', 'get',
  'to', 'of', 'in', 'for', 'on', 'with', 'at',
  'by', 'from', 'as', 'into', 'about', 'but', 'or', 'and', 'not', 'no', 'so',
  'if', 'then', 'that', 'this', 'what', 'which', 'who', 'how', 'when', 'where',
  'there', 'here', 'all', 'each', 'some', 'any', 'up', 'out', 'just', 'very',
  'too', 'also', 'than', 'more', 'much', 'most', 'own', 'other',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorType = 'false_positive' | 'boundary_confusion' | 'false_negative';

export interface MisclassificationRow {
  messageText: string;
  predictedIntent: string;
  actualIntent: string;
  confidence: number;
  profile: string;
  timestamp?: string;
}

export interface ErrorCluster {
  errorType: ErrorType;
  predictedIntent: string;
  actualIntent: string;
  count: number;
  confidenceRange: { min: number; max: number; mean: number };
  examples: string[];
}

export interface ProblematicPair {
  intentA: string;
  intentB: string;
  confusionCount: number;
  direction: string;
  suggestedKeywords: string[];
}

export interface GrouperReport {
  profile: string;
  generatedAt: string;
  totalMisclassifications: number;
  errorTypeSummary: Record<ErrorType, number>;
  clusters: ErrorCluster[];
  problematicPairs: ProblematicPair[];
  interClusterSeparation: number;
  outputPath?: string;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Classify a misclassification by confidence into non-overlapping error types.
 * - false_positive: high confidence but wrong (>= 0.70)
 * - boundary_confusion: medium confidence, near decision boundary (0.45 – 0.70)
 * - false_negative: low confidence, missed the correct intent (< 0.45)
 */
export function classifyErrorType(confidence: number): ErrorType {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'false_positive';
  if (confidence >= BOUNDARY_LOW_THRESHOLD) return 'boundary_confusion';
  return 'false_negative';
}

/**
 * Group misclassification rows into clusters by (errorType, predictedIntent, actualIntent).
 * Sorted by count descending.
 */
export function groupIntoClusters(rows: MisclassificationRow[]): ErrorCluster[] {
  const clusterMap = new Map<string, {
    errorType: ErrorType;
    predictedIntent: string;
    actualIntent: string;
    confidences: number[];
    messages: string[];
  }>();

  for (const row of rows) {
    const errorType = classifyErrorType(row.confidence);
    const key = `${errorType}|${row.predictedIntent}|${row.actualIntent}`;

    let cluster = clusterMap.get(key);
    if (!cluster) {
      cluster = {
        errorType,
        predictedIntent: row.predictedIntent,
        actualIntent: row.actualIntent,
        confidences: [],
        messages: [],
      };
      clusterMap.set(key, cluster);
    }

    cluster.confidences.push(row.confidence);
    cluster.messages.push(row.messageText);
  }

  return Array.from(clusterMap.values())
    .map((c) => {
      const sorted = [...c.confidences].sort((a, b) => a - b);
      const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
      return {
        errorType: c.errorType,
        predictedIntent: c.predictedIntent,
        actualIntent: c.actualIntent,
        count: c.confidences.length,
        confidenceRange: {
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mean: Math.round(mean * 1000) / 1000,
        },
        examples: c.messages.slice(0, 3),
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Compute inter-cluster separation as a percentage.
 * With non-overlapping confidence bands, separation should be 100%.
 * For each pair of clusters with different errorTypes, checks that their
 * confidence ranges do not overlap.
 */
export function computeInterClusterSeparation(rows: MisclassificationRow[]): number {
  const clusters = groupIntoClusters(rows);
  if (clusters.length <= 1) return 1.0;

  // Group clusters by error type
  const byType = new Map<ErrorType, { min: number; max: number }[]>();
  for (const c of clusters) {
    const arr = byType.get(c.errorType) ?? [];
    arr.push(c.confidenceRange);
    byType.set(c.errorType, arr);
  }

  const types = Array.from(byType.keys());
  if (types.length <= 1) return 1.0;

  let totalPairs = 0;
  let separatedPairs = 0;

  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const rangesA = byType.get(types[i])!;
      const rangesB = byType.get(types[j])!;

      for (const ra of rangesA) {
        for (const rb of rangesB) {
          totalPairs++;
          // No overlap if one range is entirely above the other
          if (ra.max <= rb.min || rb.max <= ra.min) {
            separatedPairs++;
          }
        }
      }
    }
  }

  return totalPairs === 0 ? 1.0 : separatedPairs / totalPairs;
}

/**
 * Extract keyword suggestions from message texts.
 * Tokenizes, removes stop words, filters existing keywords, returns top tokens by frequency.
 */
export function extractKeywordSuggestions(
  messages: string[],
  existingKeywords: string[],
  maxSuggestions = 5,
): string[] {
  const existingSet = new Set(existingKeywords.map((k) => k.toLowerCase()));
  const freq = new Map<string, number>();

  for (const msg of messages) {
    const tokens = msg
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t) && !existingSet.has(t));

    const seen = new Set<string>();
    for (const token of tokens) {
      if (!seen.has(token)) {
        seen.add(token);
        freq.set(token, (freq.get(token) ?? 0) + 1);
      }
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSuggestions)
    .map(([word]) => word);
}

/**
 * Identify the most problematic intent pairs (most frequently confused).
 * Returns pairs sorted by confusion count, with keyword suggestions.
 */
export function identifyProblematicPairs(
  rows: MisclassificationRow[],
  existingKeywords: Record<string, string[]>,
  maxPairs = 10,
): ProblematicPair[] {
  const pairMap = new Map<string, {
    intentA: string;
    intentB: string;
    count: number;
    messages: string[];
  }>();

  for (const row of rows) {
    // Canonical key: sorted alphabetically so A→B and B→A map together
    const [a, b] = [row.predictedIntent, row.actualIntent].sort();
    const key = `${a}|${b}`;

    let pair = pairMap.get(key);
    if (!pair) {
      pair = { intentA: a, intentB: b, count: 0, messages: [] };
      pairMap.set(key, pair);
    }
    pair.count++;
    pair.messages.push(row.messageText);
  }

  return Array.from(pairMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, maxPairs)
    .map((p) => {
      const existing = [
        ...(existingKeywords[p.intentA] ?? []),
        ...(existingKeywords[p.intentB] ?? []),
      ];
      return {
        intentA: p.intentA,
        intentB: p.intentB,
        confusionCount: p.count,
        direction: `${p.intentA} <-> ${p.intentB}`,
        suggestedKeywords: extractKeywordSuggestions(p.messages, existing),
      };
    });
}

/**
 * Build the full grouper report.
 */
export function buildReport(
  profile: string,
  rows: MisclassificationRow[],
  existingKeywords: Record<string, string[]>,
  outputPath?: string,
): GrouperReport {
  const clusters = groupIntoClusters(rows);
  const separation = computeInterClusterSeparation(rows);
  const problematicPairs = identifyProblematicPairs(rows, existingKeywords);

  const errorTypeSummary: Record<ErrorType, number> = {
    false_positive: 0,
    boundary_confusion: 0,
    false_negative: 0,
  };

  for (const row of rows) {
    errorTypeSummary[classifyErrorType(row.confidence)]++;
  }

  return {
    profile,
    generatedAt: new Date().toISOString(),
    totalMisclassifications: rows.length,
    errorTypeSummary,
    clusters,
    problematicPairs,
    interClusterSeparation: Math.round(separation * 100) / 100,
    outputPath,
  };
}
