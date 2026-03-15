/**
 * campaign-pacing.ts — Portfolio Pacing Batch Tracker (US-962)
 *
 * When Meta's portfolio pacing pauses a batch send (error 131049), messages
 * are silently not delivered. This module:
 *  1. Distinguishes pacing holds (131049) from hard delivery failures
 *  2. Records held messages per batch for operator review
 *  3. Alerts operators when >5% of a batch is held
 *  4. Exposes pacing health metrics (held vs delivered per campaign)
 *
 * Error code reference:
 *   131049 = frequency-cap saturation / portfolio pacing pause
 *   130429 = throughput/speed limit (rate limit)
 *   131057 = account-level throughput limit
 */

import { db } from './db.js';
import { campaignPacingEvents } from '../../shared/schema-tables.js';
import { eq, and, gte, count, sql } from 'drizzle-orm';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('CampaignPacing');

// ─── Constants ─────────────────────────────────────────────────────

/** Error code for Meta portfolio pacing pause (frequency-cap saturation) */
export const PACING_PAUSE_ERROR_CODE = 131049;

/** Hard delivery failures are distinct from pacing holds */
const HARD_FAILURE_CODES = new Set([
  130472, // User opted out
  131000, // Something went wrong
  131005, // Access denied
  131008, // Required parameter missing
  131016, // Service unavailable
  131021, // Recipient phone number is not a valid WhatsApp account
  131026, // Message undeliverable
]);

/** Alert threshold: alert when >5% of a batch is held */
const HELD_ALERT_THRESHOLD_PCT = 5;

/** Pluggable notification sender (set via initPacingNotifier) */
let _sendNotification: ((phone: string, text: string) => Promise<any>) | null = null;

/** Admin phone for pacing alerts (loaded lazily) */
let _adminPhone: string | null = null;

// ─── Public API ────────────────────────────────────────────────────

/** Initialize the notification sender (called once at startup) */
export function initCampaignPacingNotifier(
  sendMessage: (phone: string, text: string) => Promise<any>,
  adminPhone: string
): void {
  _sendNotification = sendMessage;
  _adminPhone = adminPhone;
  logger.info('Initialized');
}

/**
 * Determine if a failed-status event is a pacing hold (not a hard failure).
 * Returns true for error 131049; false for all hard delivery failures.
 */
export function isPacingHold(errorCode: number): boolean {
  return errorCode === PACING_PAUSE_ERROR_CODE;
}

/**
 * Record a pacing-held message.
 * Called when a webhook delivers `message_status: failed` with error 131049.
 *
 * @param batchId        Campaign batch identifier (from webhook or caller)
 * @param phone          Recipient phone number
 * @param templateName   Template name used (if known)
 * @param messageContent Message content (stored for operator re-send)
 * @param instanceId     WhatsApp instance ID
 * @param notifyIfThreshold  Whether to trigger alert check (default true)
 */
export async function recordPacingHeld(opts: {
  batchId: string;
  phone: string;
  profileId?: string;
  templateName?: string;
  messageContent?: string;
  instanceId?: string;
  notifyIfThreshold?: boolean;
}): Promise<void> {
  const {
    batchId,
    phone,
    profileId = 'pelangi',
    templateName,
    messageContent,
    instanceId = 'default',
    notifyIfThreshold = true,
  } = opts;

  try {
    await db.insert(campaignPacingEvents).values({
      batchId,
      profileId,
      phone,
      templateName: templateName ?? null,
      messageContent: messageContent ?? null,
      errorCode: PACING_PAUSE_ERROR_CODE,
      failureType: 'held',
      reviewStatus: 'pending',
      heldAt: new Date(),
      instanceId,
    });

    logger.info('Recorded pacing hold', { batchId, phone, instanceId });
  } catch (err: any) {
    logger.error('Failed to record pacing hold', { error: err.message, batchId, phone });
    return; // Non-fatal — don't block the caller
  }

  if (notifyIfThreshold) {
    await checkAndAlertBatchThreshold(batchId, profileId).catch(err => {
      logger.error('Failed to check batch threshold', { error: err.message, batchId });
    });
  }
}

/**
 * Get pacing statistics for a specific batch.
 */
export async function getBatchPacingStats(batchId: string): Promise<{
  batchId: string;
  heldCount: number;
  pendingReviewCount: number;
  resentCount: number;
  cancelledCount: number;
}> {
  const rows = await db
    .select({
      reviewStatus: campaignPacingEvents.reviewStatus,
      cnt: count(),
    })
    .from(campaignPacingEvents)
    .where(eq(campaignPacingEvents.batchId, batchId))
    .groupBy(campaignPacingEvents.reviewStatus);

  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[row.reviewStatus] = Number(row.cnt);
  }

  return {
    batchId,
    heldCount: (stats['pending'] ?? 0) + (stats['resent'] ?? 0) + (stats['cancelled'] ?? 0),
    pendingReviewCount: stats['pending'] ?? 0,
    resentCount: stats['resent'] ?? 0,
    cancelledCount: stats['cancelled'] ?? 0,
  };
}

/**
 * Get pacing health across all batches in the last N hours.
 * Used by the analytics dashboard.
 */
export async function getPacingHealthSummary(hours = 24): Promise<{
  totalHeld: number;
  pendingReview: number;
  byBatch: Array<{
    batchId: string;
    heldCount: number;
    pendingCount: number;
    resentCount: number;
    cancelledCount: number;
    firstHeldAt: string;
  }>;
}> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const rows = await db
    .select({
      batchId: campaignPacingEvents.batchId,
      reviewStatus: campaignPacingEvents.reviewStatus,
      cnt: count(),
      firstHeldAt: sql<string>`MIN(held_at)::text`,
    })
    .from(campaignPacingEvents)
    .where(gte(campaignPacingEvents.heldAt, since))
    .groupBy(campaignPacingEvents.batchId, campaignPacingEvents.reviewStatus);

  // Aggregate by batch
  const batches = new Map<string, {
    batchId: string;
    heldCount: number;
    pendingCount: number;
    resentCount: number;
    cancelledCount: number;
    firstHeldAt: string;
  }>();

  for (const row of rows) {
    const batchId = row.batchId;
    if (!batches.has(batchId)) {
      batches.set(batchId, {
        batchId,
        heldCount: 0,
        pendingCount: 0,
        resentCount: 0,
        cancelledCount: 0,
        firstHeldAt: row.firstHeldAt,
      });
    }
    const entry = batches.get(batchId)!;
    const cnt = Number(row.cnt);
    entry.heldCount += cnt;
    if (row.reviewStatus === 'pending') entry.pendingCount += cnt;
    else if (row.reviewStatus === 'resent') entry.resentCount += cnt;
    else if (row.reviewStatus === 'cancelled') entry.cancelledCount += cnt;
    // Track earliest held time
    if (row.firstHeldAt < entry.firstHeldAt) entry.firstHeldAt = row.firstHeldAt;
  }

  const byBatch = Array.from(batches.values()).sort(
    (a, b) => b.firstHeldAt.localeCompare(a.firstHeldAt)
  );

  const totalHeld = byBatch.reduce((sum, b) => sum + b.heldCount, 0);
  const pendingReview = byBatch.reduce((sum, b) => sum + b.pendingCount, 0);

  return { totalHeld, pendingReview, byBatch };
}

/**
 * Mark held messages as resent or cancelled.
 * Used by operator review actions.
 */
export async function updateHeldMessageStatus(
  id: string,
  status: 'resent' | 'cancelled',
  reviewedBy: string
): Promise<boolean> {
  const result = await db
    .update(campaignPacingEvents)
    .set({
      reviewStatus: status,
      reviewedAt: new Date(),
      reviewedBy,
    })
    .where(
      and(
        eq(campaignPacingEvents.id, id),
        eq(campaignPacingEvents.reviewStatus, 'pending')
      )
    )
    .returning({ id: campaignPacingEvents.id });

  return result.length > 0;
}

// ─── Internal: threshold alert ─────────────────────────────────────

/**
 * Check if this batch has exceeded the 5% held threshold and alert admin.
 * Uses a simple in-memory cooldown to avoid repeated alerts for the same batch.
 */
const _alertedBatches = new Set<string>();

async function checkAndAlertBatchThreshold(
  batchId: string,
  profileId: string
): Promise<void> {
  if (_alertedBatches.has(batchId)) return; // Already alerted for this batch

  const stats = await getBatchPacingStats(batchId);

  // We don't have delivered count from webhook alone; compute ratio against batch size
  // If no delivered count is available, we can only report absolute numbers.
  // We alert if ANY holds appear (since we can track relative to sent via separate DB query).
  const heldCount = stats.heldCount;
  if (heldCount < 1) return;

  // Try to get total sent count for this batch from rainbow_messages
  let sentCount = 0;
  try {
    const sentRows = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM rainbow_messages
      WHERE source = 'bulk_send'
        AND profile_id = ${profileId}
        AND content LIKE ${'%batch:' + batchId + '%'}
    `);
    sentCount = Number((sentRows as any).rows?.[0]?.cnt ?? 0);
  } catch {
    // Table query failed — use held count as a minimum alert signal
  }

  // Alert if: held >= 5% of sent, OR if we have no sent count but held > 5
  const heldPct = sentCount > 0 ? (heldCount / sentCount) * 100 : null;
  const shouldAlert = (heldPct !== null && heldPct >= HELD_ALERT_THRESHOLD_PCT) ||
    (heldPct === null && heldCount >= 5);

  if (!shouldAlert) return;

  _alertedBatches.add(batchId);

  logger.warn('Pacing threshold exceeded — alerting admin', {
    batchId,
    heldCount,
    sentCount,
    heldPct: heldPct?.toFixed(1),
  });

  await sendPacingAlert(batchId, heldCount, sentCount, heldPct);
}

async function sendPacingAlert(
  batchId: string,
  heldCount: number,
  sentCount: number,
  heldPct: number | null
): Promise<void> {
  if (!_sendNotification || !_adminPhone) {
    logger.warn('No notification sender configured — cannot alert admin');
    return;
  }

  const pctText = heldPct != null ? `${heldPct.toFixed(1)}% of messages held` : `${heldCount} messages held`;
  const batchText = sentCount > 0
    ? `${heldCount} of ${sentCount} messages`
    : `${heldCount} messages`;

  const message =
    `⚠️ *Campaign Pacing Pause Detected*\n\n` +
    `Meta has paused delivery for part of a campaign batch.\n\n` +
    `*Batch ID:* \`${batchId}\`\n` +
    `*Held Messages:* ${batchText}\n` +
    `*Held Rate:* ${pctText}\n` +
    `*Time:* ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `These messages are *not permanently failed* — they are queued for operator review.\n\n` +
    `*Actions Required:*\n` +
    `• Review held messages: GET /api/rainbow/analytics/pacing/held-messages?batchId=${batchId}\n` +
    `• Re-send or cancel held messages via the admin dashboard\n` +
    `• Check Meta Business Manager for quality signals\n\n` +
    `_Error 131049: Portfolio pacing pause (frequency-cap saturation)_`;

  try {
    await _sendNotification(_adminPhone, message);
    logger.info('Sent pacing pause alert', { batchId, heldCount });
  } catch (err: any) {
    logger.error('Failed to send pacing alert', { error: err.message });
  }
}

// ─── Test helpers ───────────────────────────────────────────────────

/** Reset internal state (for testing only) */
export function _resetCampaignPacingForTesting(): void {
  _alertedBatches.clear();
  _sendNotification = null;
  _adminPhone = null;
}
