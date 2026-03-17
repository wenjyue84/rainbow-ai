/**
 * post-stay-review.ts — Post-stay review request for WhatsApp guests (US-018)
 *
 * Schedules a review request message 2 hours after checkout_full workflow
 * completes. Uses a setTimeout-based scheduler (no Redis/BullMQ required)
 * with PostgreSQL persistence to prevent duplicate sends per stay.
 *
 * Constraints:
 * - Only ONE review request per guest per stay (DB flag prevents duplicates)
 * - Utility-only template language — no marketing phrases that would
 *   trigger per-message billing reclassification under July 2025 pricing
 * - Feature can be toggled on/off via settings.json post_stay_review.enabled
 * - Delay is configurable via settings.json post_stay_review.delay_hours (default 2)
 */

import { pool } from '../lib/db.js';
import { configStore } from './config-store.js';

// ─── Types ──────────────────────────────────────────────────────────

type SendMessageFn = (phone: string, text: string, instanceId?: string) => Promise<any>;

interface ScheduledReview {
  phone: string;
  guestName: string;
  instanceId?: string;
  timer: ReturnType<typeof setTimeout>;
  scheduledAt: number;
}

// ─── In-memory scheduled jobs ────────────────────────────────────────

const scheduledReviews = new Map<string, ScheduledReview>();
let sendMessage: SendMessageFn | null = null;

// ─── DB table management ─────────────────────────────────────────────

let _dbTableEnsured = false;

async function ensureReviewTable(): Promise<void> {
  if (_dbTableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS post_stay_review_sent (
        id SERIAL PRIMARY KEY,
        jid VARCHAR(255) NOT NULL,
        guest_name VARCHAR(255),
        instance_id VARCHAR(100),
        scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        status VARCHAR(20) DEFAULT 'scheduled',
        UNIQUE (jid, DATE(scheduled_at))
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_psr_jid ON post_stay_review_sent (jid, scheduled_at DESC)`
    );
    _dbTableEnsured = true;
  } catch { /* non-critical — in-memory scheduler still works */ }
}

/** Returns true if a review was already sent for this guest today (same checkout date). */
async function alreadySentToday(jid: string): Promise<boolean> {
  try {
    await ensureReviewTable();
    const result = await pool.query(
      `SELECT 1 FROM post_stay_review_sent
       WHERE jid = $1 AND sent_at IS NOT NULL AND DATE(scheduled_at) = CURRENT_DATE
       LIMIT 1`,
      [jid]
    );
    return result.rows.length > 0;
  } catch {
    return false; // safe default: allow send if DB check fails
  }
}

async function persistScheduled(jid: string, guestName: string, instanceId?: string): Promise<void> {
  try {
    await ensureReviewTable();
    await pool.query(
      `INSERT INTO post_stay_review_sent (jid, guest_name, instance_id, status)
       VALUES ($1, $2, $3, 'scheduled')
       ON CONFLICT (jid, DATE(scheduled_at)) DO NOTHING`,
      [jid, guestName, instanceId ?? null]
    );
  } catch { /* non-critical */ }
}

async function markSent(jid: string): Promise<void> {
  try {
    await ensureReviewTable();
    await pool.query(
      `UPDATE post_stay_review_sent
       SET sent_at = NOW(), status = 'sent'
       WHERE jid = $1 AND status = 'scheduled' AND DATE(scheduled_at) = CURRENT_DATE`,
      [jid]
    );
  } catch { /* non-critical */ }
}

async function markCancelled(jid: string): Promise<void> {
  try {
    await ensureReviewTable();
    await pool.query(
      `UPDATE post_stay_review_sent
       SET status = 'cancelled'
       WHERE jid = $1 AND status = 'scheduled' AND DATE(scheduled_at) = CURRENT_DATE`,
      [jid]
    );
  } catch { /* non-critical */ }
}

// ─── Settings helpers ─────────────────────────────────────────────────

function getReviewSettings(): { enabled: boolean; delayMs: number; reviewUrl: string } {
  try {
    const settings = configStore.getSettings() as any;
    const cfg = settings?.post_stay_review;
    return {
      enabled: cfg?.enabled !== false,
      delayMs: (cfg?.delay_hours ?? 2) * 60 * 60 * 1000,
      reviewUrl: cfg?.google_review_url ?? 'https://g.page/r/pelangi-capsule-hostel/review',
    };
  } catch {
    return {
      enabled: true,
      delayMs: 2 * 60 * 60 * 1000,
      reviewUrl: 'https://g.page/r/pelangi-capsule-hostel/review',
    };
  }
}

// ─── Review message builder ───────────────────────────────────────────

/**
 * Builds the review request message in utility-only language.
 * Deliberately avoids marketing phrases ("amazing", "love", "deal", etc.)
 * to prevent WhatsApp billing reclassification under July 2025 per-message pricing.
 */
function buildReviewMessage(guestName: string, reviewUrl: string): string {
  const name = guestName?.trim() || 'Guest';
  return (
    `Hi ${name}, thank you for your recent stay at Pelangi Capsule Hostel.\n\n` +
    `If you have a moment, a short review would be helpful for future travellers:\n` +
    `${reviewUrl}\n\n` +
    `Thank you.`
  );
}

// ─── Core scheduling ──────────────────────────────────────────────────

/**
 * Schedule a post-stay review request for the given guest phone number.
 * Called when checkout_full workflow completes.
 *
 * - Checks if feature is enabled before scheduling
 * - Checks DB for duplicate sends (same guest, same day)
 * - Schedules a setTimeout job for delay_hours (default 2h)
 */
export async function schedulePostStayReview(
  phone: string,
  guestName: string,
  instanceId?: string
): Promise<void> {
  if (!sendMessage) return;

  const { enabled, delayMs, reviewUrl } = getReviewSettings();
  if (!enabled) {
    console.log(`[PostStayReview] Feature disabled — skipping review request for ${phone}`);
    return;
  }

  // Cancel any existing scheduled review for this guest (handles re-checkout edge case)
  cancelPostStayReview(phone);

  // Check DB deduplication
  const duplicate = await alreadySentToday(phone);
  if (duplicate) {
    console.log(`[PostStayReview] Review already sent today for ${phone} — skipping`);
    return;
  }

  // Persist to DB so that if the process restarts, we don't re-schedule
  await persistScheduled(phone, guestName, instanceId);

  const timer = setTimeout(async () => {
    scheduledReviews.delete(phone);

    if (!sendMessage) return;

    // Re-check settings at send time (admin may have disabled the feature)
    const { enabled: stillEnabled, reviewUrl: url } = getReviewSettings();
    if (!stillEnabled) {
      console.log(`[PostStayReview] Feature disabled at send time — aborting for ${phone}`);
      markCancelled(phone).catch(() => {});
      return;
    }

    try {
      const message = buildReviewMessage(guestName, url);
      await sendMessage(phone, message, instanceId);
      console.log(`[PostStayReview] ✅ Sent review request to ${phone} (guest: ${guestName})`);
      markSent(phone).catch(() => {});
    } catch (err: any) {
      console.error(`[PostStayReview] ❌ Failed to send review request to ${phone}:`, err.message);
    }
  }, delayMs);

  scheduledReviews.set(phone, {
    phone,
    guestName,
    instanceId,
    timer,
    scheduledAt: Date.now(),
  });

  const delayHours = Math.round(delayMs / 3600000);
  console.log(
    `[PostStayReview] Scheduled review request for ${phone} (guest: ${guestName}) ` +
    `in ${delayHours}h (sendAt: ${new Date(Date.now() + delayMs).toISOString()})`
  );
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Initialize the post-stay review module.
 * Call during assistant init after sendMessage is available.
 */
export function initPostStayReview(send: SendMessageFn): void {
  sendMessage = send;
  console.log('[PostStayReview] US-018 post-stay review request initialized');
}

/**
 * Shut down the post-stay review module, clearing all pending timers.
 */
export function destroyPostStayReview(): void {
  for (const { timer, phone } of scheduledReviews.values()) {
    clearTimeout(timer);
    console.log(`[PostStayReview] Cancelled pending review for ${phone} (shutdown)`);
  }
  scheduledReviews.clear();
  sendMessage = null;
}

/**
 * Cancel a pending review request for a guest phone.
 * Called if the review should no longer be sent (e.g., admin override).
 */
export function cancelPostStayReview(phone: string): void {
  const pending = scheduledReviews.get(phone);
  if (pending) {
    clearTimeout(pending.timer);
    scheduledReviews.delete(phone);
    markCancelled(phone).catch(() => {});
    console.log(`[PostStayReview] Cancelled review for ${phone}`);
  }
}

/**
 * Returns whether there is a review request pending for the given phone.
 * Used in admin dashboard and tests.
 */
export function hasReviewPending(phone: string): boolean {
  return scheduledReviews.has(phone);
}

/**
 * Returns all currently scheduled review entries (for admin visibility).
 */
export function getScheduledReviews(): Array<{ phone: string; guestName: string; scheduledAt: number; sendAt: number }> {
  const { delayMs } = getReviewSettings();
  return Array.from(scheduledReviews.values()).map(({ phone, guestName, scheduledAt }) => ({
    phone,
    guestName,
    scheduledAt,
    sendAt: scheduledAt + delayMs,
  }));
}
