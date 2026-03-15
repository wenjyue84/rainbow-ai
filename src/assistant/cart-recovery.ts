/**
 * cart-recovery.ts — Abandoned cart recovery for WhatsApp sessions (US-882 + US-917)
 *
 * Periodically scans the cart store for WhatsApp sessions (non-webchat) that
 * have been idle longer than a configurable threshold (default 30 minutes).
 * Sends a single proactive recovery message with cart summary and quick-reply
 * buttons: "Resume Order" / "Clear Cart".
 *
 * US-917 enhancements:
 * - Cart state persisted to database (abandoned_carts table) with timestamps
 * - 15-minute scan interval with 30–120 minute recovery window
 * - Interactive quick-reply buttons (Baileys buttonsMessage)
 * - Recovery rate analytics tracking
 *
 * Constraints:
 * - Only ONE recovery message per cart session (no spam loops)
 * - Must respect WhatsApp 24-hour session window
 * - If ignored for 24h after recovery message, cart is auto-cleared
 */

import { getActiveCartSessions, cartGetItems, cartAddItem, cartFormatSummary, cartClear } from './cart-store.js';
import { clearOrderStage } from './order-stage-store.js';
import { sessionWindowActive, logSessionExpired } from '../lib/session-window.js';
import { configStore } from './config-store.js';
import { buildButtonMessage } from './formatter.js';
import { db } from '../lib/db.js';
import { abandonedCarts } from '../../shared/schema-tables.js';
import { eq, and, isNull, gte, lte } from 'drizzle-orm';
import type { CartItem } from './cart-store.js';

// ─── Types ──────────────────────────────────────────────────────────

interface CartRecoveryState {
  recoveryMessageSent: boolean;
  sentAt?: number;
  dbId?: number;  // US-917: abandoned_carts row id
}

type SendMessageFn = (phone: string, text: string, instanceId?: string) => Promise<any>;
type SendInteractiveFn = (phone: string, content: Record<string, any>, instanceId?: string) => Promise<any>;

// ─── Button IDs for quick-reply ─────────────────────────────────────

export const RECOVERY_BUTTON_RESUME = 'cart_recovery_resume';
export const RECOVERY_BUTTON_CLEAR = 'cart_recovery_clear';

// ─── In-memory state ────────────────────────────────────────────────

const recoveryStates = new Map<string, CartRecoveryState>();

let sendMessage: SendMessageFn | null = null;
let sendInteractive: SendInteractiveFn | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

const CHECK_INTERVAL_MS = 15 * 60 * 1000;    // US-917: scan every 15 minutes
const MAX_RECOVERY_AGE_MS = 120 * 60 * 1000;  // US-917: max 120 minutes before cart too old
const AUTO_CLEAR_MS = 24 * 60 * 60 * 1000;    // clear cart 24h after recovery message

// ─── Helpers ────────────────────────────────────────────────────────

/** Returns true if sessionId looks like a WhatsApp phone JID (not webchat). */
function isWhatsAppSession(sessionId: string): boolean {
  return !sessionId.startsWith('webchat-') && !sessionId.startsWith('bsuid:');
}

/** Get cart_recovery settings from config store. */
function getRecoverySettings(): { enabled: boolean; idleMinutes: number; maxAgeMinutes: number } {
  try {
    const settings = configStore.getSettings() as any;
    const cfg = settings?.cart_recovery;
    return {
      enabled: cfg?.enabled !== false,
      idleMinutes: cfg?.idle_minutes ?? 30,
      maxAgeMinutes: cfg?.max_age_minutes ?? 120,
    };
  } catch {
    return { enabled: true, idleMinutes: 30, maxAgeMinutes: 120 };
  }
}

// ─── US-917: DB persistence helpers ─────────────────────────────────

/** Persist abandoned cart state to database. */
async function persistAbandonedCart(jid: string, items: CartItem[], cartCreatedAt: Date): Promise<number | null> {
  try {
    const rows = await db
      .insert(abandonedCarts)
      .values({
        jid,
        tenantId: 'makan-moments',
        itemsJson: JSON.stringify(items),
        cartCreatedAt,
        abandonedAt: new Date(),
      })
      .returning({ id: abandonedCarts.id });
    return rows[0]?.id ?? null;
  } catch (err: any) {
    console.error(`[CartRecovery] DB persist failed for ${jid}:`, err.message);
    return null;
  }
}

/** Mark recovery message as sent in the database. */
async function markRecoverySent(dbId: number): Promise<void> {
  try {
    await db.update(abandonedCarts)
      .set({ recoverySentAt: new Date() })
      .where(eq(abandonedCarts.id, dbId));
  } catch (err: any) {
    console.error(`[CartRecovery] DB mark recovery sent failed (id=${dbId}):`, err.message);
  }
}

/** Mark cart as recovered (user tapped Resume Order). */
async function markRecovered(jid: string): Promise<void> {
  try {
    // Find the most recent unrecovered cart for this JID
    const rows = await db
      .select({ id: abandonedCarts.id })
      .from(abandonedCarts)
      .where(and(
        eq(abandonedCarts.jid, jid),
        isNull(abandonedCarts.recoveredAt),
        isNull(abandonedCarts.clearedAt),
      ))
      .limit(1);
    if (rows.length > 0) {
      await db.update(abandonedCarts)
        .set({ recoveredAt: new Date() })
        .where(eq(abandonedCarts.id, rows[0].id));
    }
  } catch (err: any) {
    console.error(`[CartRecovery] DB mark recovered failed for ${jid}:`, err.message);
  }
}

/** Mark cart as cleared (user tapped Clear Cart). */
async function markCleared(jid: string): Promise<void> {
  try {
    const rows = await db
      .select({ id: abandonedCarts.id })
      .from(abandonedCarts)
      .where(and(
        eq(abandonedCarts.jid, jid),
        isNull(abandonedCarts.recoveredAt),
        isNull(abandonedCarts.clearedAt),
      ))
      .limit(1);
    if (rows.length > 0) {
      await db.update(abandonedCarts)
        .set({ clearedAt: new Date() })
        .where(eq(abandonedCarts.id, rows[0].id));
    }
  } catch (err: any) {
    console.error(`[CartRecovery] DB mark cleared failed for ${jid}:`, err.message);
  }
}

/** Mark an abandoned cart as completed (converted to a real order). */
export async function markCartCompleted(jid: string): Promise<void> {
  try {
    const rows = await db
      .select({ id: abandonedCarts.id })
      .from(abandonedCarts)
      .where(and(
        eq(abandonedCarts.jid, jid),
        isNull(abandonedCarts.completedAt),
        isNull(abandonedCarts.clearedAt),
      ))
      .limit(1);
    if (rows.length > 0) {
      await db.update(abandonedCarts)
        .set({ completedAt: new Date() })
        .where(eq(abandonedCarts.id, rows[0].id));
      console.log(`[CartRecovery] Cart completed (converted) for ${jid}`);
    }
  } catch (err: any) {
    console.error(`[CartRecovery] DB mark completed failed for ${jid}:`, err.message);
  }
}

/** US-917 AC6: Get recovery analytics for admin dashboard. */
export async function getRecoveryAnalytics(days = 30): Promise<{
  totalAbandoned: number;
  recoverySent: number;
  recovered: number;
  completed: number;
  cleared: number;
  recoveryRate: number;
  conversionRate: number;
}> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(abandonedCarts)
      .where(gte(abandonedCarts.abandonedAt, since));

    const totalAbandoned = rows.length;
    const recoverySent = rows.filter(r => r.recoverySentAt).length;
    const recovered = rows.filter(r => r.recoveredAt).length;
    const completed = rows.filter(r => r.completedAt).length;
    const cleared = rows.filter(r => r.clearedAt).length;

    return {
      totalAbandoned,
      recoverySent,
      recovered,
      completed,
      cleared,
      recoveryRate: recoverySent > 0 ? recovered / recoverySent : 0,
      conversionRate: recovered > 0 ? completed / recovered : 0,
    };
  } catch (err: any) {
    console.error(`[CartRecovery] Analytics query failed:`, err.message);
    return {
      totalAbandoned: 0, recoverySent: 0, recovered: 0,
      completed: 0, cleared: 0, recoveryRate: 0, conversionRate: 0,
    };
  }
}

// ─── Core: periodic idle cart scanner ───────────────────────────────

async function scanIdleCarts(): Promise<void> {
  if (!sendMessage) return;

  const { enabled, idleMinutes, maxAgeMinutes } = getRecoverySettings();
  if (!enabled) return;

  const idleThresholdMs = idleMinutes * 60 * 1000;
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  const now = Date.now();
  const activeSessions = getActiveCartSessions();

  for (const { sessionId, items, lastAccess } of activeSessions) {
    // Only WhatsApp sessions
    if (!isWhatsAppSession(sessionId)) continue;

    const idleDuration = now - lastAccess;

    // Get or create recovery state
    const state = recoveryStates.get(sessionId);

    // If recovery message was already sent, check for 24h auto-clear
    if (state?.recoveryMessageSent && state.sentAt) {
      if (now - state.sentAt > AUTO_CLEAR_MS) {
        console.log(`[CartRecovery] 24h auto-clear for ${sessionId} — no response after recovery message`);
        cartClear(sessionId);
        clearOrderStage(sessionId);
        recoveryStates.delete(sessionId);
      }
      continue; // skip — already sent recovery for this session
    }

    // Not idle long enough yet (AC2a: cart must be 30+ min old)
    if (idleDuration < idleThresholdMs) continue;

    // US-917 AC2: Too old — past the recovery window (120 min max)
    if (idleDuration > maxAgeMs) {
      console.log(`[CartRecovery] Cart too old for ${sessionId} (${Math.round(idleDuration / 60000)}min > ${maxAgeMinutes}min) — skipping`);
      continue;
    }

    // AC2b: Check 24h session window compliance
    const windowActive = await sessionWindowActive(sessionId);
    if (!windowActive) {
      logSessionExpired(sessionId, 'cart_recovery', 'Abandoned cart recovery message');
      continue;
    }

    // US-917 AC1: Persist abandoned cart to database
    const cartCreatedAt = new Date(lastAccess - (idleDuration > idleThresholdMs ? idleDuration : 0));
    const dbId = await persistAbandonedCart(sessionId, items, cartCreatedAt);

    // US-917 AC3: Send recovery message with quick-reply buttons
    const summary = cartFormatSummary(items);
    const bodyText =
      `Hi! You have items in your cart:\n\n${summary}\n\n` +
      `Would you like to continue your order?`;

    try {
      if (sendInteractive) {
        // Send interactive buttons message
        const buttonPayload = buildButtonMessage(
          bodyText,
          [
            { id: RECOVERY_BUTTON_RESUME, text: 'Resume Order' },
            { id: RECOVERY_BUTTON_CLEAR, text: 'Clear Cart' },
          ],
          'Makan Moments Cafe'
        );
        await sendInteractive(sessionId, buttonPayload);
      } else {
        // Fallback: plain text
        await sendMessage(sessionId, bodyText + '\n\nReply *Resume order* to continue or *Clear cart* to start fresh.');
      }

      console.log(`[CartRecovery] Sent recovery message to ${sessionId} (${items.length} items, idle ${Math.round(idleDuration / 60000)}min)`);

      // Mark as sent (in-memory)
      recoveryStates.set(sessionId, {
        recoveryMessageSent: true,
        sentAt: now,
        dbId: dbId ?? undefined,
      });

      // Mark as sent (database)
      if (dbId) await markRecoverySent(dbId);
    } catch (err: any) {
      console.error(`[CartRecovery] Failed to send recovery to ${sessionId}:`, err.message);
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Initialize the cart recovery system.
 * Call during assistant init after sendMessage is available.
 * US-917: Accepts optional sendInteractive for button messages.
 */
export function initCartRecovery(
  send: SendMessageFn,
  interactive?: SendInteractiveFn
): void {
  sendMessage = send;
  sendInteractive = interactive ?? null;

  // Start periodic scanner (US-917: 15-minute interval)
  checkInterval = setInterval(() => {
    scanIdleCarts().catch(err => {
      console.error('[CartRecovery] Scan error:', err.message);
    });
  }, CHECK_INTERVAL_MS);

  console.log('[CartRecovery] US-917 abandoned cart recovery initialized (15-min scan, 30-120min window)');
}

/**
 * Shut down the cart recovery system.
 */
export function destroyCartRecovery(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  recoveryStates.clear();
  sendMessage = null;
  sendInteractive = null;
}

/**
 * Reset recovery state for a session — called when the user interacts
 * with their cart (add/remove/update). This prevents the recovery message
 * from being sent while the customer is actively ordering.
 */
export function resetCartRecovery(sessionId: string): void {
  recoveryStates.delete(sessionId);
}

/**
 * Clear recovery state for a session — called on cart clear or order submit.
 */
export function clearCartRecovery(sessionId: string): void {
  recoveryStates.delete(sessionId);
}

/**
 * Check if an incoming message is a cart recovery reply.
 * US-917: Also checks button IDs from interactive quick-reply buttons.
 * Returns 'resume' | 'clear' | null.
 */
export function parseCartRecoveryReply(text: string): 'resume' | 'clear' | null {
  const normalized = text.trim().toLowerCase();
  // Text-based matching
  if (normalized === 'resume order') return 'resume';
  if (normalized === 'clear cart') return 'clear';
  // Button ID matching (from buttonsResponseMessage)
  if (normalized === RECOVERY_BUTTON_RESUME) return 'resume';
  if (normalized === RECOVERY_BUTTON_CLEAR) return 'clear';
  return null;
}

/**
 * Handle a cart recovery reply from a WhatsApp user.
 * US-917: Restores cart from DB if in-memory cart was cleared, tracks analytics.
 * Returns true if the message was handled (caller should skip further processing).
 */
export async function handleCartRecoveryReply(
  phone: string,
  action: 'resume' | 'clear',
  send: SendMessageFn
): Promise<boolean> {
  const state = recoveryStates.get(phone);
  if (!state?.recoveryMessageSent) return false;

  if (action === 'resume') {
    // Cart items may still be in the store — access to update lastAccess
    let items = cartGetItems(phone);

    // US-917: If in-memory cart was cleared (TTL), try restoring from DB
    if (items.length === 0 && state.dbId) {
      items = await restoreCartFromDb(phone, state.dbId);
    }

    recoveryStates.delete(phone);

    // US-917 AC6: Track recovery in DB
    await markRecovered(phone);

    if (items.length === 0) {
      await send(phone, 'Your cart appears to be empty. Would you like to start a new order?');
    } else {
      const summary = cartFormatSummary(items);
      await send(phone, `Welcome back! Here's your cart:\n\n${summary}\n\nWould you like to confirm this order or make any changes?`);
    }
    console.log(`[CartRecovery] ${phone} resumed order (${items.length} items)`);
    return true;
  }

  if (action === 'clear') {
    cartClear(phone);
    clearOrderStage(phone);
    recoveryStates.delete(phone);

    // US-917 AC6: Track clear in DB
    await markCleared(phone);

    await send(phone, 'Cart cleared! Feel free to browse our menu anytime you\'d like to order.');
    console.log(`[CartRecovery] ${phone} cleared cart`);
    return true;
  }

  return false;
}

/**
 * US-917: Restore cart items from the abandoned_carts DB table.
 * Used when user taps "Resume Order" after in-memory cart expired.
 */
async function restoreCartFromDb(jid: string, dbId: number): Promise<CartItem[]> {
  try {
    const rows = await db
      .select({ itemsJson: abandonedCarts.itemsJson })
      .from(abandonedCarts)
      .where(eq(abandonedCarts.id, dbId))
      .limit(1);

    if (rows.length === 0) return [];

    const items: CartItem[] = JSON.parse(rows[0].itemsJson);
    // Re-populate in-memory cart
    for (const item of items) {
      cartAddItem(jid, item);
    }
    console.log(`[CartRecovery] Restored ${items.length} items from DB for ${jid}`);
    return items;
  } catch (err: any) {
    console.error(`[CartRecovery] DB restore failed for ${jid}:`, err.message);
    return [];
  }
}

/**
 * Check if a session has a pending recovery message (for testing/admin).
 */
export function hasRecoveryPending(sessionId: string): boolean {
  return recoveryStates.get(sessionId)?.recoveryMessageSent ?? false;
}
