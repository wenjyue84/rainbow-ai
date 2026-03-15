/**
 * order-accuracy-tracker.ts — US-902: Track AI waiter order accuracy
 *
 * Records whether customers correct their order after the AI shows a
 * confirmation summary. The KPI = (orders with no correction) / total × 100.
 *
 * Flow:
 *   1. AI calls order_request_confirmation → markConfirmationShown(sessionId)
 *   2. Guest modifies cart while CONFIRMING  → markCorrected(sessionId)
 *   3. Guest confirms → recordOrderSubmitted(sessionId, profileId) writes events to DB
 */

import { db, dbReady } from '../lib/db.js';
import { orderAccuracyEvents } from '../../shared/schema.js';

interface AccuracySession {
  confirmationShown: boolean;
  corrected: boolean;
  lastAccess: number;
}

const sessions = new Map<string, AccuracySession>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// Cleanup idle sessions every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 15 * 60 * 1000);

/** Call when AI shows the order confirmation summary (CONFIRMING stage). */
export function markConfirmationShown(sessionId: string): void {
  const existing = sessions.get(sessionId);
  sessions.set(sessionId, {
    confirmationShown: true,
    corrected: existing?.corrected ?? false,
    lastAccess: Date.now(),
  });
}

/** Call when the cart is modified while in CONFIRMING stage. */
export function markCorrected(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s && s.confirmationShown) {
    s.corrected = true;
    s.lastAccess = Date.now();
  }
}

/**
 * Call when order_confirm_submit succeeds.
 * Writes order_confirmed event (always) and order_corrected event (if applicable) to DB.
 * Clears session tracking state afterward.
 */
export async function recordOrderSubmitted(sessionId: string, profileId: string): Promise<void> {
  const s = sessions.get(sessionId);
  const hadCorrection = s?.corrected ?? false;

  // Fire-and-forget DB writes
  const isConnected = await dbReady;
  if (isConnected) {
    try {
      const inserts: Array<{ sessionId: string; profileId: string; eventType: string }> = [
        { sessionId, profileId, eventType: 'order_confirmed' },
      ];
      if (hadCorrection) {
        inserts.push({ sessionId, profileId, eventType: 'order_corrected' });
      }
      await db.insert(orderAccuracyEvents).values(inserts);
    } catch (err: any) {
      console.error('[OrderAccuracy] Failed to record events:', err.message);
    }
  }

  // Clear tracking state
  sessions.delete(sessionId);
}

/**
 * US-1014: Record 'sent_to_kitchen' event when KDS push succeeds.
 * Fire-and-forget — errors are logged but don't block order flow.
 */
export async function recordKdsSent(sessionId: string, profileId: string, orderId: string): Promise<void> {
  const isConnected = await dbReady;
  if (!isConnected) return;
  try {
    await db.insert(orderAccuracyEvents).values({
      sessionId,
      profileId,
      eventType: 'sent_to_kitchen',
    });
  } catch (err: any) {
    console.error('[OrderAccuracy] Failed to record sent_to_kitchen:', err.message);
  }
}

/** Reset tracking state for a session (e.g., on cart cancel). */
export function clearAccuracyTracking(sessionId: string): void {
  sessions.delete(sessionId);
}

// ── Test helpers ──────────────────────────────────────────────────────
export const _testExports = {
  sessions,
  markConfirmationShown,
  markCorrected,
  recordOrderSubmitted,
  clearAccuracyTracking,
};
