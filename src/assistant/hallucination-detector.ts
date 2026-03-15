/**
 * Hallucination Detector (US-913)
 *
 * Two-stage pipeline based on HaluGate architecture:
 *   Stage 1: Fast binary classifier — determines if the query requires
 *            factual verification (prices, availability, policies, menu).
 *            Creative/greeting queries bypass detection (~72% skip rate).
 *   Stage 2: Token-level NLI detector — extracts factual claims from the
 *            response and classifies each as ENTAILMENT / NEUTRAL / CONTRADICTION
 *            against the knowledge base content.
 *
 * Designed for < 200ms P99 overhead (no LLM call — pure string matching + heuristics).
 */

import { extractClaims } from './faithfulness-checker.js';
import { pool } from '../lib/db.js';

// ─── Types ──────────────────────────────────────────────────────────

export type NLILabel = 'ENTAILMENT' | 'NEUTRAL' | 'CONTRADICTION';

export type HallucinationAction = 'header' | 'body' | 'block' | 'none';

export interface ClaimVerdict {
  claim: string;
  label: NLILabel;
  /** 1-5 severity (5 = critical misinformation, e.g. wrong price) */
  severity: number;
  /** KB snippet that matched (for ENTAILMENT) or contradicted (for CONTRADICTION) */
  evidence?: string;
}

export interface HallucinationResult {
  /** Whether Stage 1 classified the query as factual */
  isFactualQuery: boolean;
  /** Individual claim verdicts from Stage 2 */
  verdicts: ClaimVerdict[];
  /** Number of CONTRADICTION verdicts */
  contradictions: number;
  /** Maximum severity among contradictions (0 if none) */
  maxSeverity: number;
  /** Whether the response should be flagged based on config threshold */
  flagged: boolean;
  /** Recommended action based on config */
  action: HallucinationAction;
  /** Processing time in milliseconds */
  latencyMs: number;
}

export interface HallucinationConfig {
  enabled: boolean;
  /** Minimum severity to trigger action (1-5, default 3) */
  severity_threshold: number;
  /** Action when contradiction detected: header | body | block | none */
  hallucination_action: HallucinationAction;
  /** Log events to DB for monitoring */
  log_events: boolean;
}

const DEFAULT_CONFIG: HallucinationConfig = {
  enabled: true,
  severity_threshold: 3,
  hallucination_action: 'block',
  log_events: true,
};

// ─── Stage 1: Factual Query Classifier ──────────────────────────────

/**
 * Fast binary classifier: does this query need factual verification?
 * Returns true for queries about prices, availability, policies, menu items,
 * times, contact info, facilities, rules — anything where a wrong answer
 * could mislead the guest.
 *
 * Accuracy target: 96%+ (12ms P50)
 */
const FACTUAL_PATTERNS: RegExp[] = [
  // Prices and costs
  /\b(?:price|harga|cost|rate|fee|charge|how\s*much|berapa|多少钱|价格|收费)\b/i,
  /\b(?:rm\s*\d|ringgit|sen|deposit|payment|bayar|pay)\b/i,

  // Availability and booking
  /\b(?:avail|available|vacancy|book|reserv|tempah|slot|room|bilik|capsule|bed|katil|空房|有没有|预订)\b/i,
  /\b(?:check.?in|check.?out|daftar\s*masuk|daftar\s*keluar|入住|退房)\b/i,

  // Time and hours
  /\b(?:what\s*time|when|hour|open|close|masa|pukul|jam|waktu|几点|营业时间)\b/i,
  /\b(?:breakfast|lunch|dinner|sarapan|makan|menu|dish|food|makanan|菜单|早餐|午餐|晚餐)\b/i,

  // Policies and rules
  /\b(?:policy|polisi|rule|peraturan|allow|permit|can\s*i|boleh|cancel|refund|规则|政策|可以)\b/i,
  /\b(?:pet|smoke|smoking|rokok|visitor|pelawat|curfew|quiet\s*hour|宠物|吸烟)\b/i,

  // Facilities and amenities
  /\b(?:wifi|parking|parkir|toilet|bathroom|shower|locker|towel|tuala|laundry|kitchen|dapur|设施|洗衣)\b/i,
  /\b(?:pool|gym|air.?con|fan|kipas|blanket|selimut|pillow|bantal)\b/i,

  // Location and transport
  /\b(?:address|alamat|location|lokasi|direction|how\s*to\s*get|grab|taxi|bus|地址|位置|怎么去)\b/i,
  /\b(?:airport|lapangan\s*terbang|station|stesen|nearby|dekat|distance|jarak)\b/i,

  // Contact info
  /\b(?:phone|number|nombor|email|contact|hubungi|whatsapp|电话|联系)\b/i,

  // Capacity and specifications
  /\b(?:capacity|kapasiti|how\s*many|berapa\s*(?:ramai|banyak)|maximum|minimum|limit|floor|tingkat|容量|多少人)\b/i,

  // Menu items and ingredients (FnB)
  /\b(?:ingredient|bahan|allerg|alergi|halal|vegetarian|vegan|spicy|pedas|portion|saiz|成分|过敏)\b/i,
];

/**
 * Patterns that indicate NON-factual queries (greetings, opinions, creative).
 * If matched AND no factual pattern matched, skip detection.
 */
const NON_FACTUAL_PATTERNS: RegExp[] = [
  /^(?:hi|hello|hey|assalamualaikum|salam|hai|yo|sup|hola|你好|哈喽)\b/i,
  /^(?:thanks|thank\s*you|terima\s*kasih|tq|thx|谢谢|感谢)/i,
  /^(?:ok|okay|sure|alright|baik|boleh|好的|好吧)/i,
  /^(?:bye|goodbye|selamat\s*tinggal|再见)/i,
  /\b(?:how\s*are\s*you|apa\s*khabar|你好吗)\b/i,
  /\b(?:recommend|suggest|cadang|opinion|think|prefer|推荐|建议)\b/i,
];

export function isFactualQuery(userMessage: string): boolean {
  if (!userMessage || userMessage.length < 3) return false;

  // Check for factual patterns first (higher priority)
  for (const pattern of FACTUAL_PATTERNS) {
    if (pattern.test(userMessage)) return true;
  }

  // If no factual pattern matched, check non-factual patterns
  for (const pattern of NON_FACTUAL_PATTERNS) {
    if (pattern.test(userMessage)) return false;
  }

  // Default: if message is a question (ends with ?) or contains question words, treat as factual
  if (/\?\s*$/.test(userMessage)) return true;
  if (/\b(?:what|where|when|who|how|which|apa|mana|bila|siapa|bagaimana|什么|哪里|怎么|谁)\b/i.test(userMessage)) return true;

  return false;
}

// ─── Stage 2: NLI Claim Detector ────────────────────────────────────

/**
 * Classify severity of a claim based on its type.
 * Higher severity = more dangerous if wrong.
 */
function classifyClaimSeverity(claim: string): number {
  // Price claims — critical (severity 5)
  if (/(?:RM|MYR|USD|\$)\s*\d/i.test(claim) || /\d+\s*(?:ringgit|sen|dollars?)/i.test(claim)) {
    return 5;
  }

  // Time claims — high (severity 4)
  if (/\d{1,2}(?::\d{2})?\s*(?:am|pm)/i.test(claim) || /^\d{1,2}:\d{2}$/.test(claim)) {
    return 4;
  }

  // Phone/email/URL — high (severity 4)
  if (/[@]/.test(claim) || /https?:\/\//.test(claim) || /^\+?\d{7,}$/.test(claim)) {
    return 4;
  }

  // Quantity claims — medium (severity 3)
  if (/\d+\s+(?:rooms?|beds?|capsules?|persons?|guests?|people|pax|floors?)/i.test(claim)) {
    return 3;
  }

  // Duration/time period — medium (severity 3)
  if (/\d+\s+(?:hours?|minutes?|days?|nights?)/i.test(claim)) {
    return 3;
  }

  // Percentage — low (severity 2)
  if (/\d+\s*(?:%|percent)/i.test(claim)) {
    return 2;
  }

  return 2; // default
}

/**
 * Normalize text for matching: lowercase, collapse whitespace, remove punctuation.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[:\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find the KB sentence that best matches or contradicts a claim.
 * Returns the evidence snippet and whether it's a match.
 */
function findEvidence(claim: string, kbSentences: string[]): { found: boolean; snippet?: string } {
  const normalizedClaim = normalize(claim);

  // Extract the numeric value from the claim for contradiction detection
  const claimNumber = claim.match(/(\d+(?:\.\d+)?)/)?.[1];

  for (const sentence of kbSentences) {
    const normalizedSentence = normalize(sentence);

    // Direct substring match — ENTAILMENT
    if (normalizedSentence.includes(normalizedClaim)) {
      return { found: true, snippet: sentence.slice(0, 120) };
    }

    // For price claims: check if same context but different number
    if (claimNumber) {
      const priceMatch = claim.match(/(?:RM|MYR|USD|\$)\s*(\d+(?:\.\d+)?)/i);
      if (priceMatch) {
        const currency = claim.match(/(?:RM|MYR|USD|\$)/i)?.[0]?.toLowerCase() || '';
        // KB has same currency but different amount in same sentence
        if (normalizedSentence.includes(currency) && !normalizedSentence.includes(normalizedClaim)) {
          // Check if the KB sentence contains a different price for same currency
          const kbPrices = normalizedSentence.match(new RegExp(`${currency}\\s*(\\d+(?:\\.\\d+)?)`, 'gi'));
          if (kbPrices && kbPrices.length > 0) {
            return { found: false, snippet: sentence.slice(0, 120) };
          }
        }
      }

      // For time claims with am/pm
      const timeMatch = claim.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
      if (timeMatch) {
        const hour = parseInt(timeMatch[1]);
        const minutes = timeMatch[2] || '00';
        const ampm = timeMatch[3].toLowerCase();

        // Try common format variations
        const variants = [
          `${hour}${ampm}`, `${hour} ${ampm}`,
          `${hour}:${minutes}${ampm}`, `${hour}:${minutes} ${ampm}`,
        ];
        let h24 = ampm === 'pm' && hour !== 12 ? hour + 12 : hour;
        if (ampm === 'am' && hour === 12) h24 = 0;
        variants.push(`${h24}:${minutes}`, `${String(h24).padStart(2, '0')}:${minutes}`);

        if (variants.some(v => normalizedSentence.includes(v.toLowerCase()))) {
          return { found: true, snippet: sentence.slice(0, 120) };
        }
      }
    }
  }

  return { found: false };
}

/**
 * Stage 2: Token-level NLI detector.
 * Extracts claims from the AI response and classifies each against KB content.
 */
export function classifyClaims(response: string, kbContent: string): ClaimVerdict[] {
  const claims = extractClaims(response);
  if (claims.length === 0) return [];

  // Split KB into sentences for evidence matching
  const kbSentences = kbContent
    .split(/[.\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  const verdicts: ClaimVerdict[] = [];

  for (const claim of claims) {
    const severity = classifyClaimSeverity(claim);
    const evidence = findEvidence(claim, kbSentences);

    if (evidence.found) {
      verdicts.push({
        claim,
        label: 'ENTAILMENT',
        severity: 0,
        evidence: evidence.snippet,
      });
    } else if (evidence.snippet) {
      // KB has related content but different value → CONTRADICTION
      verdicts.push({
        claim,
        label: 'CONTRADICTION',
        severity,
        evidence: evidence.snippet,
      });
    } else {
      // Claim not found in KB at all → NEUTRAL (could be correct but unverifiable)
      verdicts.push({
        claim,
        label: 'NEUTRAL',
        severity: Math.max(1, severity - 1), // reduce severity for unverifiable
      });
    }
  }

  return verdicts;
}

// ─── Main Detection Pipeline ────────────────────────────────────────

/**
 * Run the full two-stage hallucination detection pipeline.
 *
 * @param userMessage - The original user query (for Stage 1 classification)
 * @param response - The AI-generated response (for Stage 2 NLI detection)
 * @param kbContent - The KB content used as context
 * @param config - Hallucination detection configuration
 */
export function detectHallucinations(
  userMessage: string,
  response: string,
  kbContent: string,
  config?: Partial<HallucinationConfig>
): HallucinationResult {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Stage 1: Factual query classification (~12ms)
  const factual = isFactualQuery(userMessage);

  if (!factual || !cfg.enabled) {
    return {
      isFactualQuery: factual,
      verdicts: [],
      contradictions: 0,
      maxSeverity: 0,
      flagged: false,
      action: 'none',
      latencyMs: Date.now() - startTime,
    };
  }

  // Stage 2: NLI claim detection (~60ms)
  const verdicts = classifyClaims(response, kbContent);

  const contradictions = verdicts.filter(v => v.label === 'CONTRADICTION');
  const maxSeverity = contradictions.length > 0
    ? Math.max(...contradictions.map(v => v.severity))
    : 0;

  const flagged = maxSeverity >= cfg.severity_threshold;
  const action = flagged ? cfg.hallucination_action : 'none';

  return {
    isFactualQuery: true,
    verdicts,
    contradictions: contradictions.length,
    maxSeverity,
    flagged,
    action,
    latencyMs: Date.now() - startTime,
  };
}

// ─── Disclaimer Messages ────────────────────────────────────────────

const DISCLAIMER_MESSAGES: Record<string, string> = {
  en: "\n\n⚠️ _Some details in this response may not be fully accurate. Please confirm with our staff for the latest information._",
  ms: "\n\n⚠️ _Beberapa butiran mungkin tidak tepat sepenuhnya. Sila sahkan dengan staf kami untuk maklumat terkini._",
  zh: "\n\n⚠️ _此回复中的某些详情可能不完全准确。请与我们的工作人员确认最新信息。_",
  ta: "\n\n⚠️ _இந்த பதிலில் சில விவரங்கள் முழுமையாக துல்லியமாக இல்லாமல் இருக்கலாம். சமீபத்திய தகவலுக்கு எங்கள் ஊழியர்களிடம் உறுதிப்படுத்தவும்._",
};

const BLOCK_MESSAGES: Record<string, string> = {
  en: "Let me check on that for you to make sure I give you the right information. One moment please!",
  ms: "Biar saya semak untuk memastikan saya beri maklumat yang betul. Tunggu sebentar ya!",
  zh: "让我确认一下，确保给您正确的信息。请稍等！",
  ta: "சரியான தகவலை வழங்க, நான் சரிபார்க்கிறேன். ஒரு நிமிடம் காத்திருங்கள்!",
};

/**
 * Apply hallucination action to the response text.
 */
export function applyHallucinationAction(
  response: string,
  result: HallucinationResult,
  lang: string
): string {
  if (!result.flagged || result.action === 'none') return response;

  if (result.action === 'block') {
    return BLOCK_MESSAGES[lang] || BLOCK_MESSAGES.en;
  }

  const disclaimer = DISCLAIMER_MESSAGES[lang] || DISCLAIMER_MESSAGES.en;

  if (result.action === 'header') {
    return disclaimer.trim() + '\n\n' + response;
  }

  // 'body' — append disclaimer
  return response + disclaimer;
}

// ─── DB Logging ─────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureHallucinationTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hallucination_events (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        profile_id TEXT,
        user_message TEXT,
        ai_response TEXT,
        is_factual_query BOOLEAN NOT NULL DEFAULT false,
        verdicts JSONB,
        contradictions INTEGER NOT NULL DEFAULT 0,
        max_severity INTEGER NOT NULL DEFAULT 0,
        action_taken TEXT,
        flagged BOOLEAN NOT NULL DEFAULT false,
        latency_ms INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_hallucination_events_created ON hallucination_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_hallucination_events_flagged ON hallucination_events(flagged) WHERE flagged = true;
      CREATE INDEX IF NOT EXISTS idx_hallucination_events_profile ON hallucination_events(profile_id);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.warn('[HallucinationDetector] Table creation failed:', err.message);
  }
}

/**
 * Log a hallucination detection event to the database.
 */
export async function logHallucinationEvent(
  phone: string,
  profileId: string,
  userMessage: string,
  aiResponse: string,
  result: HallucinationResult
): Promise<void> {
  try {
    await ensureHallucinationTable();
    await pool.query(
      `INSERT INTO hallucination_events
        (phone, profile_id, user_message, ai_response, is_factual_query, verdicts, contradictions, max_severity, action_taken, flagged, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        phone,
        profileId,
        userMessage.slice(0, 500),
        aiResponse.slice(0, 1000),
        result.isFactualQuery,
        JSON.stringify(result.verdicts),
        result.contradictions,
        result.maxSeverity,
        result.action,
        result.flagged,
        result.latencyMs,
      ]
    );
  } catch (err: any) {
    console.warn('[HallucinationDetector] Failed to log event:', err.message);
  }
}

/**
 * Get hallucination detection stats for the admin report.
 */
export async function getHallucinationStats(
  profileId?: string,
  days: number = 7
): Promise<{
  totalChecked: number;
  factualQueries: number;
  totalFlagged: number;
  detectionRate: number;
  avgLatencyMs: number;
  topCategories: Array<{ claim_type: string; count: number }>;
  dailyBreakdown: Array<{ date: string; checked: number; flagged: number }>;
}> {
  await ensureHallucinationTable();

  const profileFilter = profileId ? 'AND profile_id = $2' : '';
  const params: any[] = [days];
  if (profileId) params.push(profileId);

  // Summary stats
  const summaryResult = await pool.query(
    `SELECT
       COUNT(*) AS total_checked,
       COUNT(*) FILTER (WHERE is_factual_query = true) AS factual_queries,
       COUNT(*) FILTER (WHERE flagged = true) AS total_flagged,
       COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
     FROM hallucination_events
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     ${profileFilter}`,
    params
  );

  const summary = summaryResult.rows[0] || {};
  const totalChecked = parseInt(summary.total_checked || '0');
  const factualQueries = parseInt(summary.factual_queries || '0');
  const totalFlagged = parseInt(summary.total_flagged || '0');

  // Top flagged claim categories (from CONTRADICTION verdicts)
  const categoriesResult = await pool.query(
    `SELECT
       v->>'claim' AS claim_type,
       COUNT(*) AS count
     FROM hallucination_events,
          jsonb_array_elements(verdicts) AS v
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
       AND flagged = true
       AND v->>'label' = 'CONTRADICTION'
       ${profileFilter}
     GROUP BY v->>'claim'
     ORDER BY count DESC
     LIMIT 10`,
    params
  );

  // Daily breakdown
  const dailyResult = await pool.query(
    `SELECT
       DATE(created_at) AS date,
       COUNT(*) AS checked,
       COUNT(*) FILTER (WHERE flagged = true) AS flagged
     FROM hallucination_events
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     ${profileFilter}
     GROUP BY DATE(created_at)
     ORDER BY date DESC`,
    params
  );

  return {
    totalChecked,
    factualQueries,
    totalFlagged,
    detectionRate: totalChecked > 0 ? parseFloat((totalFlagged / totalChecked * 100).toFixed(1)) : 0,
    avgLatencyMs: parseFloat(parseFloat(summary.avg_latency_ms || '0').toFixed(1)),
    topCategories: categoriesResult.rows.map(r => ({
      claim_type: r.claim_type,
      count: parseInt(r.count),
    })),
    dailyBreakdown: dailyResult.rows.map(r => ({
      date: r.date,
      checked: parseInt(r.checked),
      flagged: parseInt(r.flagged),
    })),
  };
}
