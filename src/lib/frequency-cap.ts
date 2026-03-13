/**
 * Frequency Cap Handler (US-441)
 *
 * Detects Meta WhatsApp marketing frequency cap error (code 131049),
 * prevents retry, records rejections in rainbow_messages, and alerts
 * admin when hourly rejection rate exceeds 10% of outbound marketing sends.
 */

import { createModuleLogger } from './logger.js';
import { db } from './db.js';
import { rainbowMessages } from '../../shared/schema-tables.js';
import { sql } from 'drizzle-orm';

const logger = createModuleLogger('FrequencyCap');

export const FREQUENCY_CAP_ERROR_CODE = 131049;

/**
 * Thrown when Meta rejects a message with error 131049
 * (marketing frequency cap exceeded — max 2 marketing templates/24h per user).
 * Callers MUST NOT retry when this error is caught.
 */
export class FrequencyCapError extends Error {
  readonly code = FREQUENCY_CAP_ERROR_CODE;
  readonly phone: string;
  readonly instanceId: string;

  constructor(phone: string, instanceId = 'default') {
    super(`WhatsApp marketing frequency cap exceeded for ${phone} (error 131049 — do not retry)`);
    this.name = 'FrequencyCapError';
    this.phone = phone;
    this.instanceId = instanceId;
  }
}

/** Returns true if the error is a FrequencyCapError. */
export function isFrequencyCapError(err: unknown): err is FrequencyCapError {
  return err instanceof FrequencyCapError;
}

/**
 * Inspect a raw API error response body and detect error code 131049.
 * Handles both Cloud API direct format and Evolution API proxy format.
 */
export function detectFrequencyCapInResponse(responseData: unknown): boolean {
  if (!responseData || typeof responseData !== 'object') return false;
  const data = responseData as Record<string, any>;

  // Cloud API: { error: { errors: [{ code: 131049 }] } }
  const errorsViaError: any[] = data?.error?.errors ?? [];
  if (Array.isArray(errorsViaError) && errorsViaError.some(e => Number(e?.code) === FREQUENCY_CAP_ERROR_CODE)) {
    return true;
  }

  // Evolution API proxy: { errors: [{ code: 131049 }] }
  const errorsTopLevel: any[] = data?.errors ?? [];
  if (Array.isArray(errorsTopLevel) && errorsTopLevel.some(e => Number(e?.code) === FREQUENCY_CAP_ERROR_CODE)) {
    return true;
  }

  // Flat: { code: 131049 }
  if (Number(data?.code) === FREQUENCY_CAP_ERROR_CODE) return true;

  // Nested: { error: { code: 131049 } }
  if (Number(data?.error?.code) === FREQUENCY_CAP_ERROR_CODE) return true;

  return false;
}

// ── In-memory hourly counters for threshold alerting ─────────────────

interface HourlyBucket {
  windowStart: number; // epoch ms — start of current 1-hour window
  cappedCount: number;
  outboundCount: number;
}

const hourlyBuckets = new Map<string, HourlyBucket>();

function getOrCreateBucket(instanceId: string): HourlyBucket {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const windowStart = now - (now % hourMs); // round down to hour boundary

  let bucket = hourlyBuckets.get(instanceId);
  if (!bucket || bucket.windowStart !== windowStart) {
    bucket = { windowStart, cappedCount: 0, outboundCount: 0 };
    hourlyBuckets.set(instanceId, bucket);
  }
  return bucket;
}

/**
 * Call this when any outbound marketing message is attempted (sent or capped).
 * Used to compute the denominator for the 10% threshold.
 */
export function trackOutboundMarketing(instanceId = 'default'): void {
  const bucket = getOrCreateBucket(instanceId);
  bucket.outboundCount += 1;
}

/**
 * Record a frequency-capped rejection:
 *  1. Insert row in rainbow_messages (source = 'frequency_capped')
 *  2. Increment hourly counters
 *  3. If >10% of hourly outbound messages are capped, invoke notifyFn
 *
 * @param phone       Destination phone number
 * @param content     Message content that was rejected
 * @param instanceId  WhatsApp instance ID (used for per-instance analytics)
 * @param notifyFn    Optional async alert callback (avoids circular import with admin-notifier)
 */
export async function recordFrequencyCap(
  phone: string,
  content: string,
  instanceId = 'default',
  notifyFn?: (instanceId: string, cappedCount: number, outboundCount: number) => Promise<void>
): Promise<void> {
  // 1. Log to rainbow_messages with source = 'frequency_capped'
  try {
    await db.insert(rainbowMessages).values({
      phone,
      role: 'assistant',
      content,
      timestamp: new Date(),
      source: 'frequency_capped',
      profileId: instanceId !== 'default' ? instanceId : 'pelangi',
      manual: false,
    });
    logger.info('Recorded frequency-capped rejection', { phone, instanceId });
  } catch (err: any) {
    logger.error('Failed to record frequency-capped rejection to DB', { error: err.message });
    // Non-fatal — continue to update counters and potentially alert
  }

  // 2. Update hourly bucket (counts this as both capped and an outbound attempt)
  const bucket = getOrCreateBucket(instanceId);
  bucket.cappedCount += 1;
  if (bucket.outboundCount === 0) {
    // Avoid counting twice if trackOutboundMarketing was already called
    bucket.outboundCount += 1;
  }

  // 3. Check 10% threshold (minimum 5 sends to avoid noise)
  if (bucket.outboundCount >= 5 && bucket.cappedCount / bucket.outboundCount > 0.10) {
    logger.warn('Frequency cap threshold exceeded', {
      instanceId,
      cappedCount: bucket.cappedCount,
      outboundCount: bucket.outboundCount,
      rate: `${(bucket.cappedCount / bucket.outboundCount * 100).toFixed(1)}%`,
    });
    if (notifyFn) {
      notifyFn(instanceId, bucket.cappedCount, bucket.outboundCount).catch((err: any) => {
        logger.error('Failed to send frequency cap threshold alert', { error: err.message });
      });
    }
  }
}

/**
 * Returns frequency-capped rejection counts for the past 24 hours.
 * Used by the analytics endpoint.
 */
export async function getFrequencyCapStats24h(): Promise<{
  total: number;
  byInstance: Record<string, number>;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT profile_id, COUNT(*)::int AS cnt
    FROM rainbow_messages
    WHERE source = 'frequency_capped'
      AND timestamp >= ${since}
    GROUP BY profile_id
  `);

  const rows: Array<{ profile_id: string | null; cnt: number }> =
    (result as any).rows ?? [];

  const byInstance: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const id = row.profile_id ?? 'unknown';
    const cnt = Number(row.cnt ?? 0);
    byInstance[id] = cnt;
    total += cnt;
  }

  return { total, byInstance };
}
