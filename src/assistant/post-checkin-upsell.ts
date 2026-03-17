/**
 * post-checkin-upsell.ts — Post-check-in add-on suggestion for in-stay guests (US-028)
 *
 * Schedules a utility-template upsell message 30 minutes after the checkin_full
 * workflow completes. Uses a setTimeout-based scheduler (no Redis/BullMQ required)
 * with in-memory deduplication to prevent duplicate sends per check-in.
 *
 * Constraints:
 * - Only ONE upsell message per guest per check-in (in-memory flag prevents duplicates)
 * - Utility-only template language — no marketing phrases that would trigger
 *   per-message billing reclassification under July 2025 pricing
 * - Feature is DISABLED by default — enable via settings.json upsell.post_checkin_message.enabled
 * - Delay is configurable via settings.json upsell.post_checkin_message.delay_minutes (default 30)
 * - Only activates for guests who have completed the checkin_full workflow
 */

import { configStore } from './config-store.js';

// ─── Types ──────────────────────────────────────────────────────────

type SendMessageFn = (phone: string, text: string, instanceId?: string) => Promise<any>;

interface ScheduledUpsell {
  phone: string;
  guestName: string;
  instanceId?: string;
  timer: ReturnType<typeof setTimeout>;
  scheduledAt: number;
}

// ─── In-memory scheduled jobs ────────────────────────────────────────

const scheduledUpsells = new Map<string, ScheduledUpsell>();
let sendMessage: SendMessageFn | null = null;

// ─── Settings helpers ─────────────────────────────────────────────────

function getUpsellSettings(): { enabled: boolean; delayMs: number } {
  try {
    const settings = configStore.getSettings() as any;
    const cfg = settings?.upsell?.post_checkin_message;
    return {
      enabled: cfg?.enabled === true, // disabled by default
      delayMs: (cfg?.delay_minutes ?? 30) * 60 * 1000,
    };
  } catch {
    return { enabled: false, delayMs: 30 * 60 * 1000 };
  }
}

// ─── Message builder ──────────────────────────────────────────────────

/**
 * Builds the upsell message in utility-only language.
 * Deliberately avoids marketing phrases ("amazing", "best", "deal", etc.)
 * to prevent WhatsApp billing reclassification under July 2025 per-message pricing.
 */
function buildUpsellMessage(guestName: string): string {
  const name = guestName?.trim() || 'Guest';
  return (
    `Hi ${name}, hope you are settling in well.\n\n` +
    `Here's what's available during your stay:\n\n` +
    `*Cafe Menu* — In-house cafe (Makan Moments) is nearby. Reply *"food menu"* to browse options.\n\n` +
    `*Laundry* — Self-service laundry at RM5 per load. Detergent provided.\n\n` +
    `*Local Guide* — Need restaurant, transport, or activity suggestions in JB? Reply *"tourist guide"*.\n\n` +
    `Let us know if you need anything. — Rainbow`
  );
}

// ─── Core scheduling ──────────────────────────────────────────────────

/**
 * Schedule a post-check-in upsell message for the given guest.
 * Called when checkin_full workflow completes.
 *
 * - Checks if feature is enabled before scheduling (disabled by default)
 * - Prevents duplicate sends via in-memory deduplication
 * - Schedules a setTimeout job for delay_minutes (default 30min)
 */
export async function schedulePostCheckinUpsell(
  phone: string,
  guestName: string,
  instanceId?: string
): Promise<void> {
  if (!sendMessage) return;

  const { enabled, delayMs } = getUpsellSettings();
  if (!enabled) {
    console.log(`[PostCheckinUpsell] Feature disabled — skipping upsell for ${phone}`);
    return;
  }

  // Cancel any existing scheduled upsell for this guest (handles re-checkin edge case)
  cancelPostCheckinUpsell(phone);

  const timer = setTimeout(async () => {
    scheduledUpsells.delete(phone);

    if (!sendMessage) return;

    // Re-check settings at send time (admin may have disabled the feature)
    const { enabled: stillEnabled } = getUpsellSettings();
    if (!stillEnabled) {
      console.log(`[PostCheckinUpsell] Feature disabled at send time — aborting for ${phone}`);
      return;
    }

    try {
      const message = buildUpsellMessage(guestName);
      await sendMessage(phone, message, instanceId);
      console.log(`[PostCheckinUpsell] Sent upsell message to ${phone} (guest: ${guestName})`);
    } catch (err: any) {
      console.error(`[PostCheckinUpsell] Failed to send upsell to ${phone}:`, err.message);
    }
  }, delayMs);

  scheduledUpsells.set(phone, {
    phone,
    guestName,
    instanceId,
    timer,
    scheduledAt: Date.now(),
  });

  const delayMin = Math.round(delayMs / 60000);
  console.log(
    `[PostCheckinUpsell] Scheduled upsell for ${phone} (guest: ${guestName}) ` +
    `in ${delayMin}min (sendAt: ${new Date(Date.now() + delayMs).toISOString()})`
  );
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Initialize the post-checkin upsell module.
 * Call during assistant init after sendMessage is available.
 */
export function initPostCheckinUpsell(send: SendMessageFn): void {
  sendMessage = send;
  console.log('[PostCheckinUpsell] US-028 post-checkin upsell initialized (disabled by default)');
}

/**
 * Shut down the post-checkin upsell module, clearing all pending timers.
 */
export function destroyPostCheckinUpsell(): void {
  for (const { timer, phone } of scheduledUpsells.values()) {
    clearTimeout(timer);
    console.log(`[PostCheckinUpsell] Cancelled pending upsell for ${phone} (shutdown)`);
  }
  scheduledUpsells.clear();
  sendMessage = null;
}

/**
 * Cancel a pending upsell for a guest phone.
 */
export function cancelPostCheckinUpsell(phone: string): void {
  const pending = scheduledUpsells.get(phone);
  if (pending) {
    clearTimeout(pending.timer);
    scheduledUpsells.delete(phone);
    console.log(`[PostCheckinUpsell] Cancelled upsell for ${phone}`);
  }
}

/**
 * Returns whether there is an upsell pending for the given phone.
 * Used in tests and admin visibility.
 */
export function hasUpsellPending(phone: string): boolean {
  return scheduledUpsells.has(phone);
}

/**
 * Returns all currently scheduled upsell entries (for admin visibility).
 */
export function getScheduledUpsells(): Array<{ phone: string; guestName: string; scheduledAt: number; sendAt: number }> {
  const { delayMs } = getUpsellSettings();
  return Array.from(scheduledUpsells.values()).map(({ phone, guestName, scheduledAt }) => ({
    phone,
    guestName,
    scheduledAt,
    sendAt: scheduledAt + delayMs,
  }));
}
