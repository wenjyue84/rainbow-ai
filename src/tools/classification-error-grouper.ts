/**
 * classification-error-grouper.ts
 *
 * US-391: Intent Classification Error Pattern Grouper
 *
 * Parses misclassification records and groups them by error type:
 *   - false_positive:    System predicted intent X with confidence, but actual was Y
 *   - false_negative:    System predicted 'unknown'/'fallback' but actual intent exists
 *   - boundary_confusion: Predicted and actual share the same semantic group
 *
 * Usage (CLI):
 *   npx tsx src/tools/classification-error-grouper-cli.ts --profile data-pelangi --output errors.json
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MisclassificationRecord {
  messageText: string;
  predictedIntent: string;
  actualIntent: string;
  confidence: number; // 0–1
  timestamp?: string;
}

export type ErrorType = 'false_positive' | 'false_negative' | 'boundary_confusion';

export interface ConfidenceRange {
  min: number;
  max: number;
  mean: number;
}

export interface ErrorCluster {
  errorType: ErrorType;
  predictedIntent: string;
  actualIntent: string;
  frequency: number;
  confidenceRange: ConfidenceRange;
  examples: string[]; // up to 3 message texts
}

export interface ProblematicPair {
  intent1: string;
  intent2: string;
  confusionCount: number;
  suggestedKeywords: string[];
}

export interface ClassificationErrorReport {
  profile: string;
  totalMisclassifications: number;
  clusters: ErrorCluster[];
  problematicPairs: ProblematicPair[];
  keywordSuggestions: Record<string, string[]>; // intent → suggested keywords to add
}

// ── Intent Semantic Groups ─────────────────────────────────────────────────────
// Intents within the same group are "boundary" neighbours — confusing them is a
// boundary_confusion rather than an outright false_positive.

const INTENT_GROUPS: Record<string, string[]> = {
  booking: [
    'booking', 'availability', 'room_type_inquiry', 'stay_extension', 'extend_stay',
    'seasonal_promotion_inquiry', 'pricing', 'full_price_list',
  ],
  checkin: [
    'checkin_info', 'check_in_arrival', 'checkout_info', 'late_checkout_request',
    'checkout_now', 'checkout_procedure', 'luggage_storage',
  ],
  payment: [
    'payment', 'payment_made', 'payment_info', 'billing_inquiry', 'billing_dispute',
  ],
  complaint: [
    'complaint', 'post_checkout_complaint', 'general_complaint_in_stay',
    'climate_control_complaint', 'noise_complaint', 'cleanliness_complaint',
    'facility_malfunction', 'capsule_conflict',
  ],
  facilities: [
    'facilities', 'facilities_info', 'facility_orientation', 'extra_amenity_request',
    'EXTRA_TOWEL', 'EXTRA_PILLOW', 'ROOM_CLEANING', 'MAINTENANCE_ISSUE',
  ],
  info: [
    'greeting', 'farewell', 'contact_staff', 'directions', 'tourist_guide',
    'local_services', 'accessibility', 'rules', 'rules_policy', 'wifi', 'WIFI_PASSWORD',
  ],
  feedback: [
    'review_feedback', 'thanks',
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the group key for a given intent, or null if not in any group. */
function intentGroup(intent: string): string | null {
  for (const [group, members] of Object.entries(INTENT_GROUPS)) {
    if (members.includes(intent)) return group;
  }
  return null;
}

const FALLBACK_INTENTS = new Set(['unknown', 'fallback', 'none', '', 'out_of_scope']);

/** Classify a misclassification record into one of the three error types. */
export function classifyErrorType(record: MisclassificationRecord): ErrorType {
  const { predictedIntent, actualIntent } = record;

  // False negative: system could not identify the intent
  if (FALLBACK_INTENTS.has(predictedIntent.toLowerCase())) {
    return 'false_negative';
  }

  // Boundary confusion: both intents belong to the same semantic group
  const predGroup = intentGroup(predictedIntent);
  const actGroup = intentGroup(actualIntent);
  if (predGroup !== null && predGroup === actGroup) {
    return 'boundary_confusion';
  }

  // Default: genuine false positive
  return 'false_positive';
}

/** Build a stable cluster key from errorType + predicted + actual. */
function clusterKey(errorType: ErrorType, predicted: string, actual: string): string {
  return `${errorType}::${predicted}::${actual}`;
}

/** Round a number to 3 decimal places. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── Core: cluster misclassifications ─────────────────────────────────────────

/**
 * Groups an array of misclassification records into ErrorClusters.
 *
 * Each cluster is uniquely identified by (errorType, predictedIntent, actualIntent).
 * Clusters are returned sorted by frequency descending.
 */
export function groupMisclassifications(
  records: MisclassificationRecord[]
): ErrorCluster[] {
  const clusterMap = new Map<
    string,
    { errorType: ErrorType; predicted: string; actual: string; confidences: number[]; examples: string[] }
  >();

  for (const record of records) {
    const errorType = classifyErrorType(record);
    const key = clusterKey(errorType, record.predictedIntent, record.actualIntent);

    if (!clusterMap.has(key)) {
      clusterMap.set(key, {
        errorType,
        predicted: record.predictedIntent,
        actual: record.actualIntent,
        confidences: [],
        examples: [],
      });
    }

    const entry = clusterMap.get(key)!;
    entry.confidences.push(record.confidence);
    if (entry.examples.length < 3) {
      entry.examples.push(record.messageText);
    }
  }

  const clusters: ErrorCluster[] = [];

  for (const entry of clusterMap.values()) {
    const sorted = [...entry.confidences].sort((a, b) => a - b);
    const mean = round3(sorted.reduce((s, v) => s + v, 0) / sorted.length);
    clusters.push({
      errorType: entry.errorType,
      predictedIntent: entry.predicted,
      actualIntent: entry.actual,
      frequency: entry.confidences.length,
      confidenceRange: {
        min: round3(sorted[0]),
        max: round3(sorted[sorted.length - 1]),
        mean,
      },
      examples: entry.examples,
    });
  }

  // Deterministic sort: frequency DESC, then by key for ties
  clusters.sort((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    return clusterKey(a.errorType, a.predictedIntent, a.actualIntent).localeCompare(
      clusterKey(b.errorType, b.predictedIntent, b.actualIntent)
    );
  });

  return clusters;
}

// ── Core: identify problematic pairs ─────────────────────────────────────────

/**
 * From clusters, identify pairs of intents that are confused the most, and
 * generate suggested keywords to add to intent-keywords.json to resolve them.
 *
 * A "problematic pair" is any (predictedIntent, actualIntent) pair that
 * appears in boundary_confusion or false_positive clusters.
 */
export function identifyProblematicPairs(clusters: ErrorCluster[]): ProblematicPair[] {
  const pairMap = new Map<string, { intent1: string; intent2: string; count: number }>();

  for (const cluster of clusters) {
    if (cluster.errorType === 'false_negative') continue; // no keyword fix for these

    const [i1, i2] = [cluster.predictedIntent, cluster.actualIntent].sort();
    const key = `${i1}::${i2}`;

    if (!pairMap.has(key)) {
      pairMap.set(key, { intent1: i1, intent2: i2, count: 0 });
    }
    pairMap.get(key)!.count += cluster.frequency;
  }

  const pairs: ProblematicPair[] = [];

  for (const { intent1, intent2, count } of pairMap.values()) {
    pairs.push({
      intent1,
      intent2,
      confusionCount: count,
      suggestedKeywords: generateSuggestedKeywords(intent1, intent2),
    });
  }

  // Sort by confusionCount descending
  pairs.sort((a, b) => b.confusionCount - a.confusionCount);
  return pairs;
}

/** Generate discriminating keyword suggestions for a confused intent pair. */
function generateSuggestedKeywords(intent1: string, intent2: string): string[] {
  const suggestions: string[] = [];

  // Intent-specific distinguishing phrases
  const disambiguationMap: Record<string, string[]> = {
    booking: ['i want to book', 'make a reservation', 'book a room', 'reserve'],
    availability: ['is there a room', 'any availability', 'room available', 'check availability'],
    inquiry: ['just asking', 'i wanted to know', 'can you tell me', 'what is'],
    payment: ['i already paid', 'payment done', 'transfer confirmed', 'receipt'],
    billing_inquiry: ['how much is the total', 'what is the charge', 'billing question'],
    check_in_arrival: ['i have arrived', 'i am here', 'at the lobby', 'checking in now'],
    checkin_info: ['what time can i check in', 'earliest check in', 'check in time'],
    checkout_info: ['checkout time', 'when do i need to leave', 'late checkout fee'],
    complaint: ['i am unhappy', 'this is unacceptable', 'i want to complain'],
    general_complaint_in_stay: ['problem during my stay', 'issue in my room'],
  };

  for (const intent of [intent1, intent2]) {
    const keywords = disambiguationMap[intent];
    if (keywords) {
      suggestions.push(...keywords.slice(0, 2));
    }
  }

  return suggestions.slice(0, 4); // max 4 suggestions per pair
}

// ── Core: keyword suggestions ─────────────────────────────────────────────────

/**
 * Aggregate all keyword suggestions per intent from problematic pairs.
 * Returns a map of intent -> unique suggested keywords.
 */
export function aggregateKeywordSuggestions(
  pairs: ProblematicPair[],
  clusters: ErrorCluster[]
): Record<string, string[]> {
  const suggestions: Record<string, string[]> = {};

  // From pairs: add suggestions for the actual intent (the one we SHOULD have predicted)
  for (const cluster of clusters) {
    if (cluster.errorType === 'false_negative') continue;

    // The actual intent needs more distinctive keywords
    const intent = cluster.actualIntent;
    if (!suggestions[intent]) suggestions[intent] = [];

    const pair = pairs.find(
      (p) =>
        (p.intent1 === cluster.predictedIntent && p.intent2 === cluster.actualIntent) ||
        (p.intent2 === cluster.predictedIntent && p.intent1 === cluster.actualIntent)
    );

    if (pair) {
      for (const kw of pair.suggestedKeywords) {
        if (!suggestions[intent].includes(kw)) {
          suggestions[intent].push(kw);
        }
      }
    }
  }

  // Remove empty entries
  for (const intent of Object.keys(suggestions)) {
    if (suggestions[intent].length === 0) delete suggestions[intent];
  }

  return suggestions;
}

// ── Main export: build full report ────────────────────────────────────────────

/**
 * Build a complete ClassificationErrorReport from raw misclassification records.
 */
export function buildErrorReport(
  profile: string,
  records: MisclassificationRecord[]
): ClassificationErrorReport {
  const clusters = groupMisclassifications(records);
  const problematicPairs = identifyProblematicPairs(clusters);
  const keywordSuggestions = aggregateKeywordSuggestions(problematicPairs, clusters);

  return {
    profile,
    totalMisclassifications: records.length,
    clusters,
    problematicPairs,
    keywordSuggestions,
  };
}

// ── Inter-cluster separation metric ──────────────────────────────────────────

/**
 * Compute inter-cluster separation score (0–1).
 *
 * Defined as: proportion of records where (errorType, predictedIntent, actualIntent)
 * uniquely identifies its cluster (i.e. no record belongs to more than one cluster).
 *
 * Since our clustering is exact-match on those three fields, this is always 1.0.
 * The function is provided for test verification purposes.
 */
export function computeInterClusterSeparation(
  records: MisclassificationRecord[],
  clusters: ErrorCluster[]
): number {
  if (records.length === 0) return 1.0;

  // Verify each record maps to exactly one cluster
  let correctlyAssigned = 0;

  for (const record of records) {
    const errorType = classifyErrorType(record);
    const matchingCluster = clusters.find(
      (c) =>
        c.errorType === errorType &&
        c.predictedIntent === record.predictedIntent &&
        c.actualIntent === record.actualIntent
    );
    if (matchingCluster) correctlyAssigned++;
  }

  return correctlyAssigned / records.length;
}
