/**
 * Hallucination Detector (US-913)
 *
 * Two-stage pipeline for detecting hallucinated responses:
 *
 * Stage 1: Fast binary classifier — determines if the query requires
 * factual verification based on intent and keyword patterns.
 * Non-factual queries (greetings, creative, opinion) bypass detection.
 *
 * Stage 2: NLI-style contradiction detector — compares entity-value
 * pairs extracted from the response against the KB content to find
 * CONTRADICTION / ENTAILMENT / NEUTRAL labels. Contradictions are
 * scored by severity (count of contradicted claims).
 *
 * Design: < 200ms P99 overhead (no LLM calls, pure string analysis).
 * Based on HaluGate architecture principles.
 */

// ─── Types ───────────────────────────────────────────────────────────

export type NLILabel = 'ENTAILMENT' | 'CONTRADICTION' | 'NEUTRAL';

export type HallucinationAction = 'header' | 'body' | 'block' | 'none';

export interface ContradictionClaim {
  /** The claim from the response */
  responseClaim: string;
  /** The conflicting value found in KB */
  kbValue: string;
  /** NLI label */
  label: NLILabel;
  /** Entity type: price, time, quantity, contact, url */
  claimType: string;
}

export interface HallucinationResult {
  /** Whether this query was classified as factual (Stage 1) */
  isFactualQuery: boolean;
  /** Whether detection was skipped (non-factual query) */
  skipped: boolean;
  /** Contradiction severity: count of CONTRADICTION labels */
  severity: number;
  /** All NLI-labeled claims */
  claims: ContradictionClaim[];
  /** Contradicted claims only */
  contradictions: ContradictionClaim[];
  /** Action to take based on severity and config */
  action: HallucinationAction;
  /** Processing time in ms */
  latencyMs: number;
  /** Category of the most severe contradiction (for reporting) */
  topCategory: string | null;
}

// ─── Stage 1: Factual Query Classifier ───────────────────────────────

/**
 * Non-factual intents that bypass hallucination detection.
 * These produce creative/social responses where factual accuracy
 * is not critical (72.2% efficiency gain per HaluGate).
 */
const NON_FACTUAL_INTENTS = new Set([
  'greeting', 'farewell', 'thanks', 'thank_you', 'goodbye',
  'small_talk', 'creative', 'opinion', 'joke', 'compliment',
  'apology', 'acknowledgement', 'confirm', 'cancel', 'deny',
  'help', 'unknown', 'off_topic', 'language_switch',
]);

/**
 * Factual keyword patterns that force detection even on ambiguous intents.
 * Matches queries about prices, availability, times, policies, etc.
 */
const FACTUAL_KEYWORD_PATTERN = /\b(price|cost|how\s*much|rate|fee|charge|tariff|harga|berapa|rm\s*\d|check[- ]?in|check[- ]?out|time|hour|open|close|tutup|buka|available|availability|capacity|room|bilik|capsule|bed|amenity|facility|wifi|parking|pool|breakfast|menu|halal|policy|rule|regulation|cancel|refund|deposit|payment|address|location|contact|phone|email|whatsapp|direction|distance|nearby|shuttle)\b/i;

/**
 * Stage 1: Classify whether a query requires factual verification.
 *
 * @param intent - Classified intent from the pipeline
 * @param userMessage - Original user message text
 * @returns true if the query needs factual verification
 */
export function isFactualQuery(intent: string | undefined, userMessage: string): boolean {
  // If intent is explicitly non-factual, skip (unless keywords override)
  if (intent && NON_FACTUAL_INTENTS.has(intent)) {
    // Even non-factual intents get checked if they contain factual keywords
    return FACTUAL_KEYWORD_PATTERN.test(userMessage);
  }
  // All other intents are treated as potentially factual
  return true;
}

// ─── Stage 2: Contradiction Detector ─────────────────────────────────

interface EntityValue {
  entity: string;   // normalized entity identifier
  value: string;    // the specific value
  raw: string;      // original text
  type: string;     // claim type category
}

/**
 * Extract entity-value pairs from text for NLI comparison.
 * Targets: prices with context, times with context, quantities with context.
 */
function extractEntityValues(text: string): EntityValue[] {
  const results: EntityValue[] = [];
  const seen = new Set<string>();

  const addResult = (entity: string, value: string, raw: string, type: string) => {
    const key = `${entity}|${value}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ entity: entity.toLowerCase(), value: value.toLowerCase(), raw, type });
    }
  };

  // Price patterns with context: "dorm RM50", "capsule costs RM80", "RM50 per night"
  const priceContextPatterns = [
    // "X costs/is/at RM50"
    /(\b\w+(?:\s+\w+)?)\s+(?:costs?|is|at|from|starting)\s+((?:RM|MYR|USD|\$)\s*\d+(?:\.\d{1,2})?)/gi,
    // "RM50 for/per X"
    /((?:RM|MYR|USD|\$)\s*\d+(?:\.\d{1,2})?)\s+(?:for|per|a)\s+(\w+(?:\s+\w+)?)/gi,
    // "X: RM50" or "X - RM50"
    /(\b\w+(?:\s+\w+)?)\s*[:\-–—]\s*((?:RM|MYR|USD|\$)\s*\d+(?:\.\d{1,2})?)/gi,
  ];

  for (const pattern of priceContextPatterns) {
    for (const m of text.matchAll(pattern)) {
      if (m[1].match(/^(RM|MYR|USD|\$)/i)) {
        // Pattern 2: price first, entity second
        addResult(m[2].trim(), m[1].trim(), m[0], 'price');
      } else {
        addResult(m[1].trim(), m[2].trim(), m[0], 'price');
      }
    }
  }

  // Time patterns with context: "check-in at 2pm", "checkout: 12pm", "opens at 8am"
  const timeContextPatterns = [
    /(\b(?:check[- ]?in|check[- ]?out|checkout|breakfast|lunch|dinner|opens?|closes?|start|end|arrival|departure))\s*(?:at|is|from|time[: ]*)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/gi,
    /(\b(?:check[- ]?in|check[- ]?out|checkout|breakfast|lunch|dinner|opens?|closes?|start|end))\s*[:\-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/gi,
  ];

  for (const pattern of timeContextPatterns) {
    for (const m of text.matchAll(pattern)) {
      addResult(m[1].trim(), m[2].trim(), m[0], 'time');
    }
  }

  // Quantity with context: "10 rooms", "24-hour reception", "6 beds"
  const quantityPatterns = [
    /(\d+)\s+(rooms?|beds?|capsules?|floors?|persons?|guests?|pax|units?)\b/gi,
    /(\b\w+(?:\s+\w+)?)\s*(?:has|have|with|fits?|holds?|sleeps?|accommodates?)\s+(\d+)\s+(persons?|guests?|pax|people|beds?)/gi,
  ];

  for (const m of text.matchAll(quantityPatterns[0])) {
    addResult(m[2].trim(), m[1].trim(), m[0], 'quantity');
  }
  for (const m of text.matchAll(quantityPatterns[1])) {
    addResult(m[1].trim(), `${m[2]} ${m[3]}`.trim(), m[0], 'quantity');
  }

  // Contact info: phone numbers, emails
  const phonePattern = /(?:phone|call|whatsapp|contact|tel)[:\s]*(\+?\d[\d\s-]{6,}\d)/gi;
  for (const m of text.matchAll(phonePattern)) {
    addResult('contact_phone', m[1].replace(/[\s-]/g, ''), m[0], 'contact');
  }

  const emailPattern = /(?:email|mail|contact)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  for (const m of text.matchAll(emailPattern)) {
    addResult('contact_email', m[1], m[0], 'contact');
  }

  return results;
}

/**
 * Normalize a value for comparison (lowercase, collapse spacing, strip currency symbols spacing).
 */
function normalizeValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[:\-–—]/g, '')
    .trim();
}

/**
 * Compare two values to determine NLI label.
 * For numeric values: exact match = ENTAILMENT, different = CONTRADICTION.
 * For strings: substring containment = ENTAILMENT, different = CONTRADICTION.
 */
function compareValues(responseValue: string, kbValue: string, type: string): NLILabel {
  const normResponse = normalizeValue(responseValue);
  const normKB = normalizeValue(kbValue);

  if (normResponse === normKB) return 'ENTAILMENT';

  // For prices: extract numeric amounts and compare
  if (type === 'price') {
    const responseAmount = normResponse.replace(/[^0-9.]/g, '');
    const kbAmount = normKB.replace(/[^0-9.]/g, '');
    if (responseAmount && kbAmount) {
      if (responseAmount === kbAmount) return 'ENTAILMENT';
      return 'CONTRADICTION';
    }
  }

  // For times: normalize to comparable format
  if (type === 'time') {
    const responseTime = normalizeTime(responseValue);
    const kbTime = normalizeTime(kbValue);
    if (responseTime && kbTime) {
      if (responseTime === kbTime) return 'ENTAILMENT';
      return 'CONTRADICTION';
    }
  }

  // For quantities: compare numbers
  if (type === 'quantity') {
    const responseNum = normResponse.replace(/[^0-9]/g, '');
    const kbNum = normKB.replace(/[^0-9]/g, '');
    if (responseNum && kbNum) {
      if (responseNum === kbNum) return 'ENTAILMENT';
      return 'CONTRADICTION';
    }
  }

  // For contacts: direct comparison
  if (type === 'contact') {
    if (normResponse === normKB) return 'ENTAILMENT';
    return 'CONTRADICTION';
  }

  // Default: if strings are substantially different, mark as contradiction
  if (normResponse !== normKB && normResponse.length > 0 && normKB.length > 0) {
    return 'CONTRADICTION';
  }

  return 'NEUTRAL';
}

/**
 * Normalize a time string to 24h format (HH:MM) for comparison.
 */
function normalizeTime(timeStr: string): string | null {
  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;

  let hour = parseInt(match[1]);
  const minutes = match[2] || '00';
  const ampm = match[3]?.toLowerCase();

  if (ampm === 'pm' && hour !== 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  return `${String(hour).padStart(2, '0')}:${minutes}`;
}

/**
 * Check if two entity names match with strict rules to prevent
 * false positive cross-matches (e.g., "Mixed Dorm" should NOT match
 * "Female Dorm" via shared word "Dorm").
 *
 * Matching rules:
 * 1. Exact match (after normalization)
 * 2. One is a qualified version of the other (e.g., "room" vs "private room")
 *    BUT both must share the same primary noun and the shorter must be
 *    at least 60% the length of the longer (avoids single-word false matches).
 */
function entitiesMatch(a: string, b: string): boolean {
  if (a === b) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  // Require shorter entity is a significant portion of the longer (prevents "dorm" matching "female dorm")
  if (shorter.length < longer.length * 0.6) return false;

  // Check if shorter is a substring of longer (e.g., "private room" contains "room")
  return longer.includes(shorter);
}

/**
 * Find matching entities between response and KB content.
 * An entity matches if the entity name appears in both texts
 * and the associated values are compared for contradiction.
 *
 * Uses strict entity matching to prevent false cross-matches
 * (e.g., "Mixed Dorm RM35" should not contradict "Female Dorm RM40").
 */
function findContradictions(
  responseEntities: EntityValue[],
  kbEntities: EntityValue[]
): ContradictionClaim[] {
  const claims: ContradictionClaim[] = [];

  for (const re of responseEntities) {
    // Find KB entities with matching entity names (strict match)
    const matchingKB = kbEntities.filter(ke =>
      ke.type === re.type && entitiesMatch(ke.entity, re.entity)
    );

    for (const ke of matchingKB) {
      const label = compareValues(re.value, ke.value, re.type);
      claims.push({
        responseClaim: re.raw,
        kbValue: ke.raw,
        label,
        claimType: re.type,
      });
    }
  }

  return claims;
}

// ─── Main Detection Function ─────────────────────────────────────────

/**
 * Default hallucination detection config.
 */
const DEFAULT_CONFIG = {
  /** Minimum severity to trigger action */
  severityThreshold: 3,
  /** Action on detection: 'block' replaces response, 'body' appends disclaimer, 'header' prepends, 'none' logs only */
  action: 'block' as HallucinationAction,
  /** Whether detection is enabled */
  enabled: true,
};

/**
 * Run the two-stage hallucination detection pipeline.
 *
 * @param response - The LLM-generated response text
 * @param kbContent - The KB content used as grounding context
 * @param intent - The classified intent
 * @param userMessage - The original user message
 * @param config - Optional config overrides
 * @returns HallucinationResult with severity, claims, and recommended action
 */
export function detectHallucinations(
  response: string,
  kbContent: string,
  intent: string | undefined,
  userMessage: string,
  config?: Partial<typeof DEFAULT_CONFIG>
): HallucinationResult {
  const start = performance.now();
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Stage 1: Factual query classification
  const factual = isFactualQuery(intent, userMessage);
  if (!factual || !cfg.enabled) {
    return {
      isFactualQuery: factual,
      skipped: true,
      severity: 0,
      claims: [],
      contradictions: [],
      action: 'none',
      latencyMs: Math.round(performance.now() - start),
      topCategory: null,
    };
  }

  // Skip very short responses or missing KB
  if (!response || response.length < 30 || !kbContent || kbContent.length < 50) {
    return {
      isFactualQuery: true,
      skipped: true,
      severity: 0,
      claims: [],
      contradictions: [],
      action: 'none',
      latencyMs: Math.round(performance.now() - start),
      topCategory: null,
    };
  }

  // Stage 2: Extract entity-value pairs and find contradictions
  const responseEntities = extractEntityValues(response);
  const kbEntities = extractEntityValues(kbContent);

  const allClaims = findContradictions(responseEntities, kbEntities);
  const contradictions = allClaims.filter(c => c.label === 'CONTRADICTION');
  const severity = contradictions.length;

  // Determine action based on severity
  let action: HallucinationAction = 'none';
  if (severity >= cfg.severityThreshold) {
    action = cfg.action;
  } else if (severity >= 1) {
    // 1-2 contradictions: log only (below threshold)
    action = 'none';
  }

  // Find top category for reporting
  const categoryCounts = new Map<string, number>();
  for (const c of contradictions) {
    categoryCounts.set(c.claimType, (categoryCounts.get(c.claimType) || 0) + 1);
  }
  let topCategory: string | null = null;
  let maxCount = 0;
  for (const [cat, count] of categoryCounts) {
    if (count > maxCount) {
      topCategory = cat;
      maxCount = count;
    }
  }

  return {
    isFactualQuery: true,
    skipped: false,
    severity,
    claims: allClaims,
    contradictions,
    action,
    latencyMs: Math.round(performance.now() - start),
    topCategory,
  };
}

// ─── Fallback Messages ───────────────────────────────────────────────

const HALLUCINATION_BLOCK_MESSAGES: Record<string, string> = {
  en: "I want to make sure I give you the right information. Let me check on that and get back to you, or I can connect you with our team.",
  ms: "Saya ingin memastikan saya memberikan maklumat yang tepat. Biar saya semak dan maklumkan anda, atau saya boleh hubungkan anda dengan pasukan kami.",
  zh: "我想确保给您提供正确的信息。让我核实一下再回复您，或者我可以为您联系我们的团队。",
  ta: "நான் சரியான தகவலை வழங்குகிறேன் என்பதை உறுதிப்படுத்த விரும்புகிறேன். நான் அதை சரிபார்த்து உங்களுக்குத் தெரிவிக்கிறேன்.",
};

const HALLUCINATION_DISCLAIMER_MESSAGES: Record<string, string> = {
  en: "\n\n_Please note: Some details in my response may need verification. Contact our team for the most accurate information._",
  ms: "\n\n_Sila ambil perhatian: Beberapa butiran dalam jawapan saya mungkin perlu pengesahan. Hubungi pasukan kami untuk maklumat yang paling tepat._",
  zh: "\n\n_请注意：我的回复中的某些细节可能需要核实。请联系我们的团队获取最准确的信息。_",
  ta: "\n\n_தயவுசெய்து கவனிக்கவும்: எனது பதிலில் சில விவரங்கள் சரிபார்ப்பு தேவைப்படலாம்._",
};

/**
 * Get the block fallback message for a language.
 */
export function getHallucinationBlockMessage(lang: 'en' | 'ms' | 'zh' | 'ta'): string {
  return HALLUCINATION_BLOCK_MESSAGES[lang] || HALLUCINATION_BLOCK_MESSAGES.en;
}

/**
 * Get the disclaimer message for a language.
 */
export function getHallucinationDisclaimer(lang: 'en' | 'ms' | 'zh' | 'ta'): string {
  return HALLUCINATION_DISCLAIMER_MESSAGES[lang] || HALLUCINATION_DISCLAIMER_MESSAGES.en;
}
