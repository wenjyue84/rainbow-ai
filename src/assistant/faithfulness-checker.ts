/**
 * Faithfulness Checker (US-899)
 *
 * Post-generation check that verifies LLM responses are grounded in
 * the knowledge base content. Uses a lightweight string-matching approach
 * to extract factual claims (numbers, times, prices, proper nouns) from
 * the response and confirm they appear in the KB chunks.
 *
 * Designed to add < 500ms overhead (no LLM call).
 */

export interface FaithfulnessResult {
  /** 0.0 (hallucinated) to 1.0 (fully grounded) */
  score: number;
  /** Total factual claims extracted from the response */
  totalClaims: number;
  /** Claims that matched KB content */
  matchedClaims: number;
  /** Claims that did NOT match KB content */
  unmatchedClaims: string[];
  /** Whether the response was flagged as unfaithful */
  flagged: boolean;
}

/** Minimum faithfulness score; below this the response is replaced with a fallback */
export const FAITHFULNESS_THRESHOLD = 0.7;

/** Minimum number of claims required before scoring (avoids false positives on greetings) */
const MIN_CLAIMS_FOR_CHECK = 2;

/**
 * Extract factual claims from a response text.
 * Targets: times (2pm, 14:00), prices (RM50, $10), numbers with units,
 * percentages, dates, and specific policy-like phrases.
 */
export function extractClaims(response: string): string[] {
  const claims: string[] = [];
  const seen = new Set<string>();

  const addClaim = (claim: string) => {
    const normalized = claim.trim().toLowerCase();
    if (normalized.length >= 2 && !seen.has(normalized)) {
      seen.add(normalized);
      claims.push(claim.trim());
    }
  };

  // Time expressions: "2pm", "2:00pm", "14:00", "2 pm", "check-in: 2pm"
  const timePatterns = response.matchAll(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\b/g);
  for (const m of timePatterns) addClaim(m[1]);

  // 24h time: "14:00", "08:30"
  const time24 = response.matchAll(/\b(\d{1,2}:\d{2})\b/g);
  for (const m of time24) {
    // Skip if already captured as 12h time
    if (!seen.has(m[1].toLowerCase())) addClaim(m[1]);
  }

  // Prices: "RM50", "RM 50", "$10", "USD 20", "50 ringgit"
  const pricePatterns = response.matchAll(/\b((?:RM|MYR|USD|\$)\s*\d+(?:\.\d{1,2})?)\b/gi);
  for (const m of pricePatterns) addClaim(m[1]);
  const priceWord = response.matchAll(/\b(\d+(?:\.\d{1,2})?\s*(?:ringgit|sen|dollars?))\b/gi);
  for (const m of priceWord) addClaim(m[1]);

  // Percentages: "10%", "50 percent"
  const pctPatterns = response.matchAll(/\b(\d+(?:\.\d+)?\s*(?:%|percent))\b/gi);
  for (const m of pctPatterns) addClaim(m[1]);

  // Capacity/quantity: "10 rooms", "6 beds", "24 hours"
  const quantityPatterns = response.matchAll(/\b(\d+\s+(?:rooms?|beds?|capsules?|persons?|guests?|people|pax|floors?|hours?|minutes?|days?|nights?|units?))\b/gi);
  for (const m of quantityPatterns) addClaim(m[1]);

  // Phone/WhatsApp numbers (7+ digits)
  const phonePatterns = response.matchAll(/(?:\+?\d[\d\s-]{6,}\d)/g);
  for (const m of phonePatterns) addClaim(m[0].replace(/[\s-]/g, ''));

  // Email addresses
  const emailPatterns = response.matchAll(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g);
  for (const m of emailPatterns) addClaim(m[1]);

  // URLs (excluding common markdown artifacts)
  const urlPatterns = response.matchAll(/\bhttps?:\/\/[^\s)]+/gi);
  for (const m of urlPatterns) addClaim(m[0]);

  return claims;
}

/**
 * Normalize a string for fuzzy matching: lowercase, collapse whitespace,
 * remove common punctuation.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[:\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a claim appears in the KB content.
 * Uses normalized substring matching with some fuzzy tolerance.
 */
function claimExistsInKB(claim: string, normalizedKB: string): boolean {
  const normalizedClaim = normalize(claim);

  // Direct substring match
  if (normalizedKB.includes(normalizedClaim)) return true;

  // For time claims, try common format variations
  // e.g., "2pm" should match "2:00 PM", "2 pm", "1400"
  const timeMatch = claim.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] || '00';
    const ampm = timeMatch[3].toLowerCase();

    // Try "2pm", "2 pm", "2:00pm", "2:00 pm"
    const variants = [
      `${hour}${ampm}`,
      `${hour} ${ampm}`,
      `${hour}:${minutes}${ampm}`,
      `${hour}:${minutes} ${ampm}`,
    ];

    // Also try 24h format
    let h24 = ampm === 'pm' && hour !== 12 ? hour + 12 : hour;
    if (ampm === 'am' && hour === 12) h24 = 0;
    variants.push(`${h24}:${minutes}`);
    variants.push(`${String(h24).padStart(2, '0')}:${minutes}`);

    return variants.some(v => normalizedKB.includes(v.toLowerCase()));
  }

  // For price claims, try without currency symbol spacing variations
  const priceMatch = claim.match(/^(RM|MYR|USD|\$)\s*(\d+(?:\.\d{1,2})?)$/i);
  if (priceMatch) {
    const currency = priceMatch[1].toLowerCase();
    const amount = priceMatch[2];
    const variants = [
      `${currency}${amount}`,
      `${currency} ${amount}`,
      amount, // just the number (context in KB may differ)
    ];
    return variants.some(v => normalizedKB.includes(v));
  }

  return false;
}

/**
 * Check the faithfulness of a response against KB content.
 *
 * @param response - The LLM-generated response text
 * @param kbContent - The concatenated KB content that was used as context
 * @returns FaithfulnessResult with score and details
 */
export function checkFaithfulness(response: string, kbContent: string): FaithfulnessResult {
  // Skip check for very short responses (greetings, acknowledgements)
  if (!response || response.length < 20 || !kbContent || kbContent.length < 50) {
    return { score: 1.0, totalClaims: 0, matchedClaims: 0, unmatchedClaims: [], flagged: false };
  }

  const claims = extractClaims(response);

  // Not enough factual claims to meaningfully check — assume faithful
  if (claims.length < MIN_CLAIMS_FOR_CHECK) {
    return { score: 1.0, totalClaims: claims.length, matchedClaims: claims.length, unmatchedClaims: [], flagged: false };
  }

  const normalizedKB = normalize(kbContent);
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const claim of claims) {
    if (claimExistsInKB(claim, normalizedKB)) {
      matched.push(claim);
    } else {
      unmatched.push(claim);
    }
  }

  const score = claims.length > 0 ? matched.length / claims.length : 1.0;
  const flagged = score < FAITHFULNESS_THRESHOLD;

  return {
    score: parseFloat(score.toFixed(3)),
    totalClaims: claims.length,
    matchedClaims: matched.length,
    unmatchedClaims: unmatched,
    flagged,
  };
}

/**
 * Get the conservative fallback message for different languages.
 */
export function getFaithfulnessFallback(lang: 'en' | 'ms' | 'zh' | 'ta'): string {
  const fallbacks: Record<string, string> = {
    en: "I'm not fully confident in my answer. Let me connect you with our team for accurate information.",
    ms: "Saya tidak pasti dengan jawapan saya. Biar saya hubungkan anda dengan pasukan kami untuk maklumat yang tepat.",
    zh: "我对我的回答不太确定。让我为您联系我们的团队以获取准确的信息。",
    ta: "எனது பதிலில் நான் முழு நம்பிக்கை இல்லை. துல்லியமான தகவலுக்கு எங்கள் குழுவுடன் இணைக்கிறேன்.",
  };
  return fallbacks[lang] || fallbacks.en;
}
