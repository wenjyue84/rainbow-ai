/**
 * US-285: Fallback Response Template A/B Test Analysis CLI
 *
 * Compares two fallback response templates for the same intent,
 * measuring booking conversion rate and escalation rate to validate
 * which response template drives better outcomes.
 */

import pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComparisonMetrics {
  template: string;
  total_conversations: number;
  booking_conversions: number;
  escalations: number;
  booking_rate: number;
  escalation_rate: number;
}

export interface ComparisonResult {
  timestamp: string;
  intent: string;
  profile: string;
  days_analyzed: number;
  template_a: ComparisonMetrics;
  template_b: ComparisonMetrics;
  statistical_significance: number; // p-value or confidence score
  winner: string; // template name with better booking rate
  details: {
    template_a_booking_advantage: number;
    template_a_escalation_disadvantage: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEMPLATE_IDENTIFIERS: Record<string, string> = {
  'first_fallback': 'first_fallback',
  'repeated_fallback': 'repeated_fallback',
  'escalation_offer': 'escalation_offer',
};

// ---------------------------------------------------------------------------
// Database queries
// ---------------------------------------------------------------------------

/**
 * Fetch conversation data for a specific intent and template variant
 * from the last N days.
 *
 * For now, we filter by intent and extract template info from action field.
 * In a real implementation, template_variant would be a stored column.
 */
export async function fetchTemplateConversations(
  pool: pg.Pool,
  intent: string,
  templateVariant: string,
  profile: string,
  days: number,
): Promise<any[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const result = await pool.query(
    `SELECT DISTINCT
       m.phone,
       m.intent,
       m.action,
       m.timestamp,
       -- Extract template variant from action field (format: "fallback:template_name")
       CASE
         WHEN m.action LIKE 'fallback:%' THEN SUBSTRING(m.action, 10)
         ELSE NULL
       END as template_used
     FROM rainbow_messages m
     WHERE m.intent = $1
       AND m.profile_id = $2
       AND m.timestamp >= $3
       AND m.action LIKE 'fallback:%'
     ORDER BY m.phone, m.timestamp`,
    [intent, profile, cutoff.toISOString()],
  );

  return result.rows;
}

/**
 * Count conversations with booking success (messages with booking workflow action)
 * for a given phone list and time window.
 */
export async function countBookingConversions(
  pool: pg.Pool,
  phones: string[],
  profile: string,
  days: number,
): Promise<number> {
  if (phones.length === 0) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Count distinct phones that have a booking workflow action
  const result = await pool.query(
    `SELECT COUNT(DISTINCT phone) as count
     FROM rainbow_messages
     WHERE phone = ANY($1)
       AND profile_id = $2
       AND timestamp >= $3
       AND (action = 'booking' OR workflow_id LIKE '%booking%')`,
    [phones, profile, cutoff.toISOString()],
  );

  return result.rows[0]?.count || 0;
}

/**
 * Count escalation events (conversations escalated to staff) for a template variant.
 */
export async function countEscalations(
  pool: pg.Pool,
  phones: string[],
  profile: string,
  days: number,
): Promise<number> {
  if (phones.length === 0) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Escalation detection: check for staff messages or escalate action
  const result = await pool.query(
    `SELECT COUNT(DISTINCT m.phone) as count
     FROM rainbow_messages m
     WHERE m.phone = ANY($1)
       AND m.profile_id = $2
       AND m.timestamp >= $3
       AND (m.action = 'escalate' OR m.role = 'staff')`,
    [phones, profile, cutoff.toISOString()],
  );

  return result.rows[0]?.count || 0;
}

// ---------------------------------------------------------------------------
// Statistical significance (Chi-squared test)
// ---------------------------------------------------------------------------

/**
 * Simple approximation of the standard normal cumulative distribution function.
 * Used to calculate p-values from z-scores.
 */
function normalCDF(z: number): number {
  // Handle extreme values
  if (z > 8) return 1.0; // CDF approaches 1 for large z
  if (z < -8) return 0.0; // CDF approaches 0 for large negative z

  // Hart approximation for the error function
  // Accurate to ~0.00012 absolute error
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const absZ = Math.abs(z);
  const t = 1.0 / (1.0 + p * absZ);
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;

  const expVal = Math.exp(-absZ * absZ);
  if (!isFinite(expVal)) return sign > 0 ? 1.0 : 0.0;

  const erf = 1.0 - (a1 * t + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5) * expVal;
  const result = 0.5 * (1.0 + sign * erf);

  // Guard against NaN
  if (!isFinite(result)) return sign > 0 ? 1.0 : 0.0;
  return Math.max(0, Math.min(1, result));
}

/**
 * Compute Chi-squared p-value for two proportions.
 * Returns a value between 0 and 1 (lower = more significant difference).
 */
export function computeChiSquaredPValue(
  successes1: number,
  total1: number,
  successes2: number,
  total2: number,
): number {
  if (total1 === 0 || total2 === 0) return 1; // No data

  const proportion1 = successes1 / total1;
  const proportion2 = successes2 / total2;
  const pooledProportion = (successes1 + successes2) / (total1 + total2);

  // Guard against edge cases where proportion is 0 or 1
  if (pooledProportion === 0 || pooledProportion === 1) {
    return proportion1 === proportion2 ? 1 : 0.001; // Return low p-value if different
  }

  const standardError = Math.sqrt(
    pooledProportion * (1 - pooledProportion) * (1 / total1 + 1 / total2),
  );

  if (standardError === 0 || !isFinite(standardError)) return 1;

  const zScore = (proportion1 - proportion2) / standardError;
  if (!isFinite(zScore)) return 1;

  // Two-tailed test: p-value = 2 * P(Z > |z|)
  const cdf = normalCDF(Math.abs(zScore));
  const pValue = 2 * (1 - cdf);

  return Math.max(0, Math.min(1, isFinite(pValue) ? pValue : 1));
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

export async function compareTemplates(
  pool: pg.Pool,
  intent: string,
  templateA: string,
  templateB: string,
  profile: string,
  days: number,
): Promise<ComparisonResult> {
  // Fetch conversations for each template
  const convsA = await fetchTemplateConversations(pool, intent, templateA, profile, days);
  const convsB = await fetchTemplateConversations(pool, intent, templateB, profile, days);

  // Filter by actual template variant
  const phonesA = convsA
    .filter(row => row.template_used === templateA)
    .map(row => row.phone);
  const phonesB = convsB
    .filter(row => row.template_used === templateB)
    .map(row => row.phone);

  // Get unique phones for each variant
  const uniquePhonesA = Array.from(new Set(phonesA));
  const uniquePhonesB = Array.from(new Set(phonesB));

  // Count bookings and escalations
  const bookingsA = await countBookingConversions(pool, uniquePhonesA, profile, days);
  const bookingsB = await countBookingConversions(pool, uniquePhonesB, profile, days);
  const escalationsA = await countEscalations(pool, uniquePhonesA, profile, days);
  const escalationsB = await countEscalations(pool, uniquePhonesB, profile, days);

  // Calculate rates
  const bookingRateA = uniquePhonesA.length > 0 ? bookingsA / uniquePhonesA.length : 0;
  const bookingRateB = uniquePhonesB.length > 0 ? bookingsB / uniquePhonesB.length : 0;
  const escalationRateA = uniquePhonesA.length > 0 ? escalationsA / uniquePhonesA.length : 0;
  const escalationRateB = uniquePhonesB.length > 0 ? escalationsB / uniquePhonesB.length : 0;

  // Determine winner (higher booking rate wins)
  const winner = bookingRateA >= bookingRateB ? templateA : templateB;

  // Statistical significance
  const pValue = computeChiSquaredPValue(
    bookingsA,
    uniquePhonesA.length,
    bookingsB,
    uniquePhonesB.length,
  );

  return {
    timestamp: new Date().toISOString(),
    intent,
    profile,
    days_analyzed: days,
    template_a: {
      template: templateA,
      total_conversations: uniquePhonesA.length,
      booking_conversions: bookingsA,
      escalations: escalationsA,
      booking_rate: bookingRateA,
      escalation_rate: escalationRateA,
    },
    template_b: {
      template: templateB,
      total_conversations: uniquePhonesB.length,
      booking_conversions: bookingsB,
      escalations: escalationsB,
      booking_rate: bookingRateB,
      escalation_rate: escalationRateB,
    },
    statistical_significance: pValue,
    winner,
    details: {
      template_a_booking_advantage: bookingRateA - bookingRateB,
      template_a_escalation_disadvantage: escalationRateA - escalationRateB,
    },
  };
}
