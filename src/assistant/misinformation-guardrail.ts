/**
 * OWASP LLM09 Misinformation Guardrail (US-955)
 *
 * Prevents the AI from hallucinating factual answers when no knowledge base
 * context was retrieved. For factual intents (pricing, availability, policy,
 * hours, contact), responses MUST be grounded in the KB. If RAG found no
 * relevant context and no topic files matched, the response is blocked and
 * replaced with a safe "I don't have that information" fallback.
 *
 * Works alongside:
 *   - hallucination-detector.ts (US-913): Catches contradictions in KB-grounded responses
 *   - groundedness-checker.ts (US-993): Sentence-level grounding gate
 *   - faithfulness-checker.ts (US-899): Claim-level KB verification
 *
 * This module covers the gap: factual queries with NO KB retrieval at all.
 */

import { isFactualQuery } from './hallucination-detector.js';
import { pool } from '../lib/db.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface MisinformationCheckResult {
  /** Whether the user query is about factual information */
  isFactualQuery: boolean;
  /** Whether KB retrieval found relevant context */
  retrievalUsed: boolean;
  /** Source documents used (topic files, excluding core files) */
  sourceDocuments: string[];
  /** Whether the response was blocked by the misinformation guardrail */
  blocked: boolean;
  /** Reason for blocking (or 'none' if not blocked) */
  blockReason: 'no_kb_retrieval' | 'no_topic_files' | 'none';
  /** Confidence that KB has adequate coverage for this query (0-1) */
  groundingConfidence: number;
}

export interface MisinformationConfig {
  /** Enable/disable the guardrail (default: true) */
  enabled: boolean;
  /** Block factual responses with no KB retrieval (default: true) */
  block_ungrounded_factual: boolean;
  /** Minimum topic files required for factual queries (default: 1) */
  min_topic_files: number;
}

const DEFAULT_CONFIG: MisinformationConfig = {
  enabled: true,
  block_ungrounded_factual: true,
  min_topic_files: 1,
};

// ─── Factual Intent Categories ──────────────────────────────────────

/**
 * Intent names that represent factual queries requiring KB grounding.
 * These intents MUST have KB source backing or the response is blocked.
 */
const FACTUAL_INTENTS = new Set([
  'pricing', 'price_inquiry', 'room_price',
  'availability', 'room_availability', 'booking_inquiry', 'booking',
  'checkin_info', 'checkout_info', 'check_in', 'check_out',
  'rules_policy', 'house_rules', 'policy', 'cancellation',
  'facilities_info', 'facilities', 'amenities',
  'wifi', 'wifi_info', 'wifi_password',
  'directions', 'location', 'address',
  'contact_info', 'phone_number',
  'hours', 'operating_hours', 'breakfast_time',
  'payment_info', 'payment_methods',
  'menu', 'menu_inquiry', 'food_menu',
  'parking', 'transport',
]);

/**
 * Check if an intent is a factual category that requires KB grounding.
 */
export function isFactualIntent(intent: string): boolean {
  if (!intent) return false;
  return FACTUAL_INTENTS.has(intent.toLowerCase());
}

// ─── Core Guardrail ─────────────────────────────────────────────────

/**
 * Check if a response passes the misinformation guardrail.
 *
 * For factual queries: blocks if no KB topic files were found (beyond core files).
 * For non-factual queries: always passes.
 *
 * @param userMessage - The original user message
 * @param intent - Classified intent
 * @param ragUsed - Whether RAG retrieval found relevant context
 * @param topicFiles - Topic files selected (excluding core files like AGENTS.md)
 * @param config - Optional config override
 */
export function checkMisinformationRisk(
  userMessage: string,
  intent: string,
  ragUsed: boolean,
  topicFiles: string[],
  config?: Partial<MisinformationConfig>
): MisinformationCheckResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const factualByIntent = isFactualIntent(intent);
  const factualByMessage = isFactualQuery(userMessage);
  const isFactual = factualByIntent || factualByMessage;

  const result: MisinformationCheckResult = {
    isFactualQuery: isFactual,
    retrievalUsed: ragUsed,
    sourceDocuments: topicFiles,
    blocked: false,
    blockReason: 'none',
    groundingConfidence: 1.0,
  };

  if (!cfg.enabled || !isFactual) {
    return result;
  }

  // Compute grounding confidence based on retrieval quality
  if (ragUsed && topicFiles.length >= cfg.min_topic_files) {
    // RAG found relevant context — high confidence
    result.groundingConfidence = 1.0;
  } else if (!ragUsed && topicFiles.length >= cfg.min_topic_files) {
    // Regex matched topic files but RAG wasn't used — medium confidence
    result.groundingConfidence = 0.6;
  } else if (topicFiles.length === 0) {
    // No topic files at all — very low confidence
    result.groundingConfidence = 0.0;
  } else {
    // Some topic files but fewer than minimum — low confidence
    result.groundingConfidence = 0.3;
  }

  // Block if no relevant topic files found for a factual query
  if (cfg.block_ungrounded_factual && topicFiles.length < cfg.min_topic_files) {
    result.blocked = true;
    result.blockReason = topicFiles.length === 0 ? 'no_topic_files' : 'no_kb_retrieval';
  }

  return result;
}

// ─── Fallback Messages ──────────────────────────────────────────────

const MISINFORMATION_FALLBACK: Record<string, string> = {
  en: "I don't have that specific information in my knowledge base right now. For the most accurate details, please contact us directly:\n\nPelangi Capsule Hostel: +60 11-1072 1703\nSouthern Homestay: +60 11-1072 1703\n\nOur team will be happy to help! 😊",
  ms: "Maaf, saya tiada maklumat khusus itu dalam pangkalan pengetahuan saya. Untuk butiran yang tepat, sila hubungi kami:\n\nPelangi Capsule Hostel: +60 11-1072 1703\nSouthern Homestay: +60 11-1072 1703\n\nPasukan kami sedia membantu! 😊",
  zh: "抱歉，我的知识库中暂时没有该具体信息。如需准确详情，请直接联系我们：\n\nPelangi Capsule Hostel: +60 11-1072 1703\nSouthern Homestay: +60 11-1072 1703\n\n我们的团队很乐意为您提供帮助！😊",
  ta: "மன்னிக்கவும், அந்த குறிப்பிட்ட தகவல் என் அறிவுத்தளத்தில் இல்லை. துல்லியமான விவரங்களுக்கு நேரடியாக எங்களைத் தொடர்பு கொள்ளவும்:\n\nPelangi Capsule Hostel: +60 11-1072 1703\nSouthern Homestay: +60 11-1072 1703\n\nஎங்கள் குழு உங்களுக்கு உதவ மகிழ்ச்சியாக இருக்கும்! 😊",
};

export function getMisinformationFallback(lang: string): string {
  return MISINFORMATION_FALLBACK[lang] ?? MISINFORMATION_FALLBACK.en;
}

// ─── DB Logging ─────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureMisinformationTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS misinformation_events (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        profile_id TEXT,
        user_message TEXT,
        intent TEXT,
        is_factual_query BOOLEAN NOT NULL DEFAULT false,
        retrieval_used BOOLEAN NOT NULL DEFAULT false,
        source_documents TEXT[],
        block_reason TEXT,
        grounding_confidence REAL NOT NULL DEFAULT 0,
        blocked BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_misinformation_events_created ON misinformation_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_misinformation_events_blocked ON misinformation_events(blocked) WHERE blocked = true;
      CREATE INDEX IF NOT EXISTS idx_misinformation_events_profile ON misinformation_events(profile_id);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.warn('[MisinformationGuardrail] Table creation failed:', err.message);
  }
}

/**
 * Log a misinformation guardrail event to the database (fire-and-forget safe).
 */
export async function logMisinformationEvent(
  phone: string,
  profileId: string,
  userMessage: string,
  intent: string,
  result: MisinformationCheckResult
): Promise<void> {
  try {
    await ensureMisinformationTable();
    await pool.query(
      `INSERT INTO misinformation_events
        (phone, profile_id, user_message, intent, is_factual_query,
         retrieval_used, source_documents, block_reason, grounding_confidence, blocked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        phone,
        profileId,
        userMessage.slice(0, 500),
        intent,
        result.isFactualQuery,
        result.retrievalUsed,
        result.sourceDocuments,
        result.blockReason,
        result.groundingConfidence,
        result.blocked,
      ]
    );
  } catch (err: any) {
    console.warn('[MisinformationGuardrail] Failed to log event:', err.message);
  }
}

// ─── Analytics ──────────────────────────────────────────────────────

export interface MisinformationStats {
  totalFactualQueries: number;
  totalBlocked: number;
  blockRate: number;
  avgGroundingConfidence: number;
  dailyBreakdown: Array<{
    date: string;
    factual_queries: number;
    blocked: number;
    avg_confidence: number;
  }>;
  topBlockedIntents: Array<{ intent: string; count: number }>;
}

/**
 * Get misinformation guardrail stats for the admin dashboard.
 */
export async function getMisinformationStats(
  profileId?: string,
  days: number = 7
): Promise<MisinformationStats> {
  await ensureMisinformationTable();

  const profileFilter = profileId ? 'AND profile_id = $2' : '';
  const params: any[] = [days];
  if (profileId) params.push(profileId);

  // Summary
  const summaryResult = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE is_factual_query = true) AS total_factual,
       COUNT(*) FILTER (WHERE blocked = true) AS total_blocked,
       COALESCE(AVG(grounding_confidence) FILTER (WHERE is_factual_query = true), 0) AS avg_confidence
     FROM misinformation_events
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     ${profileFilter}`,
    params
  );
  const summary = summaryResult.rows[0] || {};
  const totalFactual = parseInt(summary.total_factual || '0');
  const totalBlocked = parseInt(summary.total_blocked || '0');

  // Daily breakdown
  const dailyResult = await pool.query(
    `SELECT
       DATE(created_at) AS date,
       COUNT(*) FILTER (WHERE is_factual_query = true) AS factual_queries,
       COUNT(*) FILTER (WHERE blocked = true) AS blocked,
       ROUND(AVG(grounding_confidence)::numeric, 3) AS avg_confidence
     FROM misinformation_events
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     ${profileFilter}
     GROUP BY DATE(created_at)
     ORDER BY date DESC`,
    params
  );

  // Top blocked intents
  const intentsResult = await pool.query(
    `SELECT intent, COUNT(*) AS count
     FROM misinformation_events
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
       AND blocked = true
       ${profileFilter}
     GROUP BY intent
     ORDER BY count DESC
     LIMIT 10`,
    params
  );

  return {
    totalFactualQueries: totalFactual,
    totalBlocked,
    blockRate: totalFactual > 0 ? parseFloat((totalBlocked / totalFactual * 100).toFixed(1)) : 0,
    avgGroundingConfidence: parseFloat(parseFloat(summary.avg_confidence || '0').toFixed(3)),
    dailyBreakdown: dailyResult.rows.map((r: any) => ({
      date: r.date,
      factual_queries: parseInt(r.factual_queries),
      blocked: parseInt(r.blocked),
      avg_confidence: parseFloat(r.avg_confidence || '0'),
    })),
    topBlockedIntents: intentsResult.rows.map((r: any) => ({
      intent: r.intent,
      count: parseInt(r.count),
    })),
  };
}
