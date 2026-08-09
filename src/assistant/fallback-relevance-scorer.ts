/**
 * fallback-relevance-scorer.ts — Semantic relevance scoring for fallback responses
 *
 * Scores each fallback response in knowledge.json for semantic relevance to user intents
 * using embedding similarity. Flags responses scoring below 0.60 cosine similarity as
 * low-relevance and generates actionable rewrite/deletion recommendations.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Type Definitions ────────────────────────────────────────────────

export interface FallbackEntry {
  intent: string;
  response: Record<string, string>;
  semantic_category?: string;
}

export interface ScoringResult {
  fallback_id: string;
  fallback_intent: string;
  fallback_text: string;
  max_relevance_score: number;
  matched_intent: string;
  recommendation: 'KEEP' | 'REWRITE' | 'DELETE';
  suggested_replacement?: string;
  deletion_justification?: string;
}

export interface ScoringReport {
  total_fallbacks: number;
  low_relevance_count: number;
  threshold: number;
  scores: ScoringResult[];
  lowest_scoring: ScoringResult[];
  recommendations_summary: {
    keep: number;
    rewrite: number;
    delete: number;
  };
}

// ─── Common User Intent Definitions (50+ intents) ─────────────────────

const COMMON_USER_INTENTS = [
  // Accommodations
  'booking', 'check_in', 'check_out', 'pricing', 'availability',
  'room_type', 'facilities', 'amenities', 'wifi', 'parking',
  // Guest Services
  'cleaning', 'laundry', 'breakfast', 'dinner', 'restaurant',
  'reception', 'front_desk', 'concierge', 'security', 'lost_and_found',
  // Policies
  'house_rules', 'cancellation_policy', 'refund', 'deposit', 'payment_method',
  'check_in_time', 'check_out_time', 'late_checkout', 'early_checkin',
  // Location & Travel
  'directions', 'location', 'nearby_attractions', 'public_transport',
  'airport_transfer', 'taxi', 'restaurant_nearby', 'shopping_mall', 'tourist_info',
  // Issues & Support
  'complaint', 'damage', 'issue', 'help', 'support', 'technical_problem',
  'maintenance', 'emergency', 'lost', 'theft', 'noise_complaint',
  // Information
  'opening_hours', 'phone_number', 'email', 'contact', 'information',
  'faq', 'guest_guide', 'weather', 'language_support',
];

// ─── Simple Embedding Function (TF-IDF based) ──────────────────────

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2);
}

/**
 * Compute simple embedding vector using term frequency
 * Returns a map of term -> frequency
 */
function computeEmbedding(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const embedding = new Map<string, number>();

  for (const token of tokens) {
    embedding.set(token, (embedding.get(token) || 0) + 1);
  }

  return embedding;
}

/**
 * Compute cosine similarity between two embedding vectors
 */
function cosineSimilarity(
  vec1: Map<string, number>,
  vec2: Map<string, number>
): number {
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  // Get all unique keys
  const allKeys = new Set([...vec1.keys(), ...vec2.keys()]);

  // Compute dot product and magnitudes
  for (const key of allKeys) {
    const val1 = vec1.get(key) || 0;
    const val2 = vec2.get(key) || 0;

    dotProduct += val1 * val2;
    magnitude1 += val1 * val1;
    magnitude2 += val2 * val2;
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) return 0;
  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Find max similarity score between fallback text and intent keywords
 */
function scoreRelevance(
  fallbackText: string,
  intentKeywords: string[]
): { score: number; matchedIntent: string } {
  const fallbackEmbedding = computeEmbedding(fallbackText);
  let maxScore = 0;
  let matchedIntent = 'unknown';

  for (const intent of intentKeywords) {
    const intentEmbedding = computeEmbedding(intent);
    const similarity = cosineSimilarity(fallbackEmbedding, intentEmbedding);

    if (similarity > maxScore) {
      maxScore = similarity;
      matchedIntent = intent;
    }
  }

  return { score: maxScore, matchedIntent };
}

/**
 * Generate recommendation based on relevance score
 */
function generateRecommendation(score: number): {
  recommendation: 'KEEP' | 'REWRITE' | 'DELETE';
  suggested_replacement?: string;
  deletion_justification?: string;
} {
  if (score >= 0.60) {
    return { recommendation: 'KEEP' };
  }

  if (score >= 0.40) {
    return {
      recommendation: 'REWRITE',
      suggested_replacement:
        'Rewrite to better align with the intended user inquiry. Include keywords related to the matched intent.',
    };
  }

  return {
    recommendation: 'DELETE',
    deletion_justification:
      'Relevance score is critically low (<0.40). This fallback is unlikely to be useful for any common user intent. Consider removing it entirely.',
  };
}

/**
 * Load fallback entries from knowledge.json
 */
function loadFallbacks(): FallbackEntry[] {
  const knowledgePath = path.join(
    __dirname,
    'data',
    'knowledge.json'
  );
  const content = fs.readFileSync(knowledgePath, 'utf-8');
  const knowledge = JSON.parse(content);

  return knowledge.static || [];
}

/**
 * Score all fallback entries
 */
export function scoreFallbacks(
  threshold: number = 0.60
): ScoringReport {
  const fallbacks = loadFallbacks();
  const scores: ScoringResult[] = [];

  for (const fallback of fallbacks) {
    // Use English response for scoring (primary language)
    const fallbackText = fallback.response.en || Object.values(fallback.response)[0] || '';

    const { score, matchedIntent } = scoreRelevance(
      fallbackText,
      COMMON_USER_INTENTS
    );

    const { recommendation, suggested_replacement, deletion_justification } =
      generateRecommendation(score);

    const result: ScoringResult = {
      fallback_id: `fallback_${fallback.intent}`,
      fallback_intent: fallback.intent,
      fallback_text: fallbackText.substring(0, 100) + (fallbackText.length > 100 ? '...' : ''),
      max_relevance_score: parseFloat(score.toFixed(4)),
      matched_intent: matchedIntent,
      recommendation,
      ...(suggested_replacement && { suggested_replacement }),
      ...(deletion_justification && { deletion_justification }),
    };

    scores.push(result);
  }

  // Sort by relevance score (ascending)
  scores.sort((a, b) => a.max_relevance_score - b.max_relevance_score);

  // Get 10 lowest-scoring fallbacks
  const lowest_scoring = scores.slice(0, 10);

  // Count recommendations
  const recommendations_summary = {
    keep: scores.filter(s => s.recommendation === 'KEEP').length,
    rewrite: scores.filter(s => s.recommendation === 'REWRITE').length,
    delete: scores.filter(s => s.recommendation === 'DELETE').length,
  };

  // Count low-relevance entries
  const low_relevance_count = scores.filter(
    s => s.max_relevance_score < threshold
  ).length;

  return {
    total_fallbacks: fallbacks.length,
    low_relevance_count,
    threshold,
    scores,
    lowest_scoring,
    recommendations_summary,
  };
}

/**
 * Format and print CLI report
 */
export function printReport(report: ScoringReport): void {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Fallback Response Semantic Relevance Scorer               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`📊 Summary`);
  console.log(`  Total fallbacks: ${report.total_fallbacks}`);
  console.log(
    `  Low relevance (<${report.threshold}): ${report.low_relevance_count}`
  );
  console.log(`  Threshold: ${report.threshold}\n`);

  console.log(`📋 Recommendations`);
  console.log(`  ✅ KEEP: ${report.recommendations_summary.keep}`);
  console.log(`  ✏️  REWRITE: ${report.recommendations_summary.rewrite}`);
  console.log(`  ❌ DELETE: ${report.recommendations_summary.delete}\n`);

  console.log(`⚠️  10 Lowest-Scoring Fallbacks\n`);

  for (let i = 0; i < report.lowest_scoring.length; i++) {
    const result = report.lowest_scoring[i];
    console.log(`${i + 1}. [${result.fallback_intent}]`);
    console.log(
      `   Score: ${result.max_relevance_score.toFixed(3)} | Matched: ${result.matched_intent}`
    );
    console.log(`   Text: "${result.fallback_text}"`);
    console.log(`   Action: ${result.recommendation}`);
    if (result.suggested_replacement) {
      console.log(`   Suggestion: ${result.suggested_replacement}`);
    }
    if (result.deletion_justification) {
      console.log(`   Reason: ${result.deletion_justification}`);
    }
    console.log();
  }

  // Summary statistics
  const avgScore =
    report.scores.reduce((sum, s) => sum + s.max_relevance_score, 0) /
    report.scores.length;
  const minScore = report.scores[0]?.max_relevance_score || 0;
  const maxScore = report.scores[report.scores.length - 1]?.max_relevance_score || 0;

  console.log(`📈 Score Statistics`);
  console.log(`  Average: ${avgScore.toFixed(3)}`);
  console.log(`  Min: ${minScore.toFixed(3)}`);
  console.log(`  Max: ${maxScore.toFixed(3)}\n`);
}

/**
 * Export report as JSON
 */
export function exportReportJSON(report: ScoringReport): string {
  return JSON.stringify(report, null, 2);
}
