/**
 * Groundedness Score Gate (US-993)
 *
 * Computes a groundedness score for AI responses — the fraction of
 * meaningful sentences in the response that are supported by the
 * retrieved knowledge base context.
 *
 * Algorithm:
 *   1. Split response into sentences (>= 4 words)
 *   2. For each sentence, compute max word-overlap (Jaccard) against KB sentences
 *   3. Sentence is "grounded" if max overlap >= WORD_OVERLAP_FLOOR OR
 *      it contains no factual terms (greeting/filler sentences exempt)
 *   4. groundedness_score = grounded / total meaningful sentences
 *
 * Designed for < 50 ms overhead (pure string heuristics, no LLM call).
 */

import { pool } from '../lib/db.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface SentenceGrounding {
  sentence: string;
  maxOverlap: number;
  grounded: boolean;
  /** Whether sentence contains factual terms that require KB support */
  factual: boolean;
}

export interface GroundednessResult {
  /** 0.0 (ungrounded) to 1.0 (fully grounded) */
  score: number;
  /** Per-sentence grounding details */
  sentences: SentenceGrounding[];
  /** Sentences that passed the grounding check */
  groundedCount: number;
  /** Sentences evaluated (factual ones only) */
  evaluatedCount: number;
  /** Whether the response was blocked by the groundedness gate */
  blocked: boolean;
  /** Configured threshold that was applied */
  threshold: number;
  /** Processing time in milliseconds */
  latencyMs: number;
}

/** Default groundedness threshold; configurable via hallucination_detection.groundedness_threshold */
export const DEFAULT_GROUNDEDNESS_THRESHOLD = 0.6;

/** Minimum word overlap (Jaccard) for a sentence to be considered grounded */
const WORD_OVERLAP_FLOOR = 0.15;

/** Minimum words in a sentence to evaluate (skip short filler sentences) */
const MIN_SENTENCE_WORDS = 4;

// ─── Helpers ────────────────────────────────────────────────────────

/** Tokenise text to lowercase words, removing punctuation. */
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
  return new Set(tokens);
}

/** Jaccard similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Patterns indicating a sentence contains factual claims requiring KB support. */
const FACTUAL_SENTENCE_PATTERNS: RegExp[] = [
  /\b(?:RM|MYR|USD|\$)\s*\d/i,            // prices
  /\d{1,2}(?::\d{2})?\s*(?:am|pm)/i,      // times
  /\d+\s*(?:rooms?|beds?|capsules?|floors?|pax|guests?)/i, // capacity
  /\b(?:check.?in|check.?out|departure|arrival)\b/i,
  /\b(?:wifi|parking|breakfast|pool|gym|laundry)\b/i,      // amenities
  /\b(?:policy|refund|cancel|deposit|no smoking|no pets)\b/i,
  /\b(?:open|close|hour|from \d|until \d|available)\b/i,
  /\b(?:\+\d{7,}|\d{7,})\b/,              // phone numbers
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i, // emails
];

/** Returns true if the sentence contains factual terms requiring KB verification. */
function isFactualSentence(sentence: string): boolean {
  return FACTUAL_SENTENCE_PATTERNS.some(p => p.test(sentence));
}

/** Split text into sentences by common terminators. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, '. ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ─── Core Computation ────────────────────────────────────────────────

/**
 * Compute how well an AI response is grounded in the retrieved KB context.
 *
 * @param response - The AI-generated response text
 * @param kbContent - KB content retrieved and used as context for this response
 * @param threshold - Groundedness threshold (default 0.6); responses below are blocked
 */
export function computeGroundednessScore(
  response: string,
  kbContent: string,
  threshold: number = DEFAULT_GROUNDEDNESS_THRESHOLD
): GroundednessResult {
  const startTime = Date.now();

  const empty: GroundednessResult = {
    score: 1.0,
    sentences: [],
    groundedCount: 0,
    evaluatedCount: 0,
    blocked: false,
    threshold,
    latencyMs: 0,
  };

  if (!response || response.length < 20 || !kbContent || kbContent.length < 50) {
    return { ...empty, latencyMs: Date.now() - startTime };
  }

  // Pre-tokenise KB sentences once
  const kbSentences = kbContent
    .split(/[.\n]/)
    .map(s => s.trim())
    .filter(s => s.split(/\s+/).length >= 3);

  const kbTokenSets = kbSentences.map(tokenize);

  const responseSentences = splitSentences(response);
  const sentenceResults: SentenceGrounding[] = [];
  let groundedCount = 0;
  let evaluatedCount = 0;

  for (const sentence of responseSentences) {
    const words = sentence.split(/\s+/).filter(w => w.length > 0);
    if (words.length < MIN_SENTENCE_WORDS) continue;

    const factual = isFactualSentence(sentence);
    evaluatedCount++;

    // Compute max Jaccard overlap with any KB sentence
    const sentenceTokens = tokenize(sentence);
    let maxOverlap = 0;
    for (const kbTokens of kbTokenSets) {
      const overlap = jaccard(sentenceTokens, kbTokens);
      if (overlap > maxOverlap) maxOverlap = overlap;
    }

    // Grounded if:
    //   - Factual sentence: overlap must exceed floor
    //   - Non-factual (greeting/opinion): lower bar (>= 0.05) or no KB needed
    const grounded = factual
      ? maxOverlap >= WORD_OVERLAP_FLOOR
      : maxOverlap >= 0.05 || !factual;

    if (grounded) groundedCount++;

    sentenceResults.push({
      sentence: sentence.slice(0, 200),
      maxOverlap: parseFloat(maxOverlap.toFixed(3)),
      grounded,
      factual,
    });
  }

  // If no meaningful sentences found, treat as ungrounded (cautious)
  if (evaluatedCount === 0) {
    return { ...empty, latencyMs: Date.now() - startTime };
  }

  const score = parseFloat((groundedCount / evaluatedCount).toFixed(3));
  const blocked = score < threshold;

  return {
    score,
    sentences: sentenceResults,
    groundedCount,
    evaluatedCount,
    blocked,
    threshold,
    latencyMs: Date.now() - startTime,
  };
}

// ─── Fallback Messages ───────────────────────────────────────────────

const GROUNDEDNESS_FALLBACK: Record<string, string> = {
  en: "I want to make sure I give you the most accurate information. Let me connect you with our team who can help you directly.",
  ms: "Saya ingin memastikan saya memberikan maklumat yang paling tepat. Biar saya hubungkan anda dengan pasukan kami yang boleh membantu anda secara langsung.",
  zh: "我想确保给您提供最准确的信息。让我为您联系我们的团队，他们可以直接为您提供帮助。",
  ta: "நான் மிகவும் துல்லியமான தகவலை வழங்க விரும்புகிறேன். உங்களுக்கு நேரடியாக உதவக்கூடிய எங்கள் குழுவுடன் உங்களை இணைக்கிறேன்.",
};

export function getGroundednessFallback(lang: string): string {
  return GROUNDEDNESS_FALLBACK[lang] ?? GROUNDEDNESS_FALLBACK.en;
}

// ─── DB Logging ─────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureGroundednessTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS groundedness_events (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        profile_id TEXT,
        user_message TEXT,
        ai_response TEXT,
        groundedness_score REAL NOT NULL,
        grounded_count INTEGER NOT NULL DEFAULT 0,
        evaluated_count INTEGER NOT NULL DEFAULT 0,
        threshold REAL NOT NULL DEFAULT 0.6,
        blocked BOOLEAN NOT NULL DEFAULT false,
        sentence_scores JSONB,
        latency_ms INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_groundedness_events_created ON groundedness_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_groundedness_events_score ON groundedness_events(groundedness_score);
      CREATE INDEX IF NOT EXISTS idx_groundedness_events_profile ON groundedness_events(profile_id);
      CREATE INDEX IF NOT EXISTS idx_groundedness_events_blocked ON groundedness_events(blocked) WHERE blocked = true;
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.warn('[GroundednessChecker] Table creation failed:', err.message);
  }
}

/**
 * Log a groundedness check event to the database (fire-and-forget safe).
 */
export async function logGroundednessEvent(
  phone: string,
  profileId: string,
  userMessage: string,
  aiResponse: string,
  result: GroundednessResult
): Promise<void> {
  try {
    await ensureGroundednessTable();
    await pool.query(
      `INSERT INTO groundedness_events
        (phone, profile_id, user_message, ai_response, groundedness_score,
         grounded_count, evaluated_count, threshold, blocked, sentence_scores, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        phone,
        profileId,
        userMessage.slice(0, 500),
        aiResponse.slice(0, 1000),
        result.score,
        result.groundedCount,
        result.evaluatedCount,
        result.threshold,
        result.blocked,
        JSON.stringify(result.sentences),
        result.latencyMs,
      ]
    );
  } catch (err: any) {
    console.warn('[GroundednessChecker] Failed to log event:', err.message);
  }
}

// ─── Analytics ───────────────────────────────────────────────────────

export interface GroundednessHistogram {
  /** Histogram buckets: [0.0, 0.2, 0.4, 0.6, 0.8, 1.0] */
  buckets: Array<{ range: string; count: number; pct: number }>;
  totalChecked: number;
  totalBlocked: number;
  blockRate: number;
  avgScore: number;
  p50Score: number;
  p10Score: number;
  dailyBreakdown: Array<{ date: string; avgScore: number; checked: number; blocked: number }>;
}

/**
 * Get groundedness score histogram and stats for the admin dashboard.
 */
export async function getGroundednessHistogram(
  profileId?: string,
  days: number = 7
): Promise<GroundednessHistogram> {
  await ensureGroundednessTable();

  const profileFilter = profileId ? 'AND profile_id = $2' : '';
  const params: any[] = [days];
  if (profileId) params.push(profileId);

  // Histogram buckets: [0.0-0.2), [0.2-0.4), [0.4-0.6), [0.6-0.8), [0.8-1.0]
  const histResult = await pool.query(
    `SELECT
       CASE
         WHEN groundedness_score < 0.2 THEN '0.0–0.2'
         WHEN groundedness_score < 0.4 THEN '0.2–0.4'
         WHEN groundedness_score < 0.6 THEN '0.4–0.6'
         WHEN groundedness_score < 0.8 THEN '0.6–0.8'
         ELSE '0.8–1.0'
       END AS range,
       COUNT(*) AS count
     FROM groundedness_events
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     ${profileFilter}
     GROUP BY range
     ORDER BY range`,
    params
  );

  // Summary stats
  const summaryResult = await pool.query(
    `SELECT
       COUNT(*) AS total_checked,
       COUNT(*) FILTER (WHERE blocked = true) AS total_blocked,
       COALESCE(AVG(groundedness_score), 0) AS avg_score,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY groundedness_score) AS p50_score,
       PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY groundedness_score) AS p10_score
     FROM groundedness_events
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     ${profileFilter}`,
    params
  );
  const summary = summaryResult.rows[0] || {};
  const totalChecked = parseInt(summary.total_checked || '0');
  const totalBlocked = parseInt(summary.total_blocked || '0');

  // Daily breakdown
  const dailyResult = await pool.query(
    `SELECT
       DATE(created_at) AS date,
       ROUND(AVG(groundedness_score)::numeric, 3) AS avg_score,
       COUNT(*) AS checked,
       COUNT(*) FILTER (WHERE blocked = true) AS blocked
     FROM groundedness_events
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     ${profileFilter}
     GROUP BY DATE(created_at)
     ORDER BY date DESC`,
    params
  );

  const BUCKET_LABELS = ['0.0–0.2', '0.2–0.4', '0.4–0.6', '0.6–0.8', '0.8–1.0'];
  const bucketMap = new Map<string, number>(histResult.rows.map((r: any) => [r.range, parseInt(r.count)]));
  const buckets = BUCKET_LABELS.map(label => {
    const count = bucketMap.get(label) ?? 0;
    return {
      range: label,
      count,
      pct: totalChecked > 0 ? parseFloat((count / totalChecked * 100).toFixed(1)) : 0,
    };
  });

  return {
    buckets,
    totalChecked,
    totalBlocked,
    blockRate: totalChecked > 0 ? parseFloat((totalBlocked / totalChecked * 100).toFixed(1)) : 0,
    avgScore: parseFloat(parseFloat(summary.avg_score || '0').toFixed(3)),
    p50Score: parseFloat(parseFloat(summary.p50_score || '0').toFixed(3)),
    p10Score: parseFloat(parseFloat(summary.p10_score || '0').toFixed(3)),
    dailyBreakdown: dailyResult.rows.map((r: any) => ({
      date: r.date,
      avgScore: parseFloat(r.avg_score || '0'),
      checked: parseInt(r.checked),
      blocked: parseInt(r.blocked),
    })),
  };
}
