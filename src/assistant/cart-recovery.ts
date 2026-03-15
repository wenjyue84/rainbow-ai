/**
 * cart-recovery.ts — Abandoned cart recovery for WhatsApp sessions (US-882)
 *
 * Periodically scans the cart store for WhatsApp sessions (non-webchat) that
 * have been idle longer than a configurable threshold (default 30 minutes).
 * Sends a single proactive recovery message with cart summary and quick-reply
 * options: "Resume order" / "Clear cart".
 *
 * Constraints:
 * - Only ONE recovery message per cart session (no spam loops)
 * - Must respect WhatsApp 24-hour session window
 * - If ignored for 24h after recovery message, cart is auto-cleared
 */

import { getActiveCartSessions, cartGetItems, cartFormatSummary, cartClear } from './cart-store.js';
import { clearOrderStage } from './order-stage-store.js';
import { sessionWindowActive, logSessionExpired } from '../lib/session-window.js';
import { configStore } from './config-store.js';
import { pool } from '../lib/db.js';

// ─── Types ──────────────────────────────────────────────────────────

interface CartRecoveryState {
  recoveryMessageSent: boolean;
  sentAt?: number;
}

type SendMessageFn = (phone: string, text: string, instanceId?: string) => Promise<any>;

// ─── In-memory state ────────────────────────────────────────────────

const recoveryStates = new Map<string, CartRecoveryState>();

let sendMessage: SendMessageFn | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

const CHECK_INTERVAL_MS = 5 * 60 * 1000;    // scan every 5 minutes
const AUTO_CLEAR_MS = 24 * 60 * 60 * 1000;  // clear cart 24h after recovery message

// ─── US-917: DB persistence for abandoned cart tracking ─────────────

let _dbTableEnsured = false;

async function ensureAbandonedCartTable(): Promise<void> {
  if (_dbTableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS abandoned_carts (
        id SERIAL PRIMARY KEY,
        jid VARCHAR(255) NOT NULL,
        tenant_id VARCHAR(50) DEFAULT 'makan-moments',
        items JSONB NOT NULL DEFAULT '[]',
        abandoned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        recovery_sent_at TIMESTAMPTZ,
        recovered_at TIMESTAMPTZ,
        cleared_at TIMESTAMPTZ,
        status VARCHAR(20) DEFAULT 'abandoned'
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_abandoned_carts_jid ON abandoned_carts (jid, abandoned_at DESC)`);
    _dbTableEnsured = true;
  } catch { /* non-critical — in-memory fallback still works */ }
}

async function persistAbandonedCart(jid: string, items: any[]): Promise<void> {
  try {
    await ensureAbandonedCartTable();
    await pool.query(
      `INSERT INTO abandoned_carts (jid, items, status) VALUES ($1, $2, 'abandoned')
       ON CONFLICT DO NOTHING`,
      [jid, JSON.stringify(items)]
    );
  } catch { /* non-critical */ }
}

async function markRecoverySent(jid: string): Promise<void> {
  try {
    await ensureAbandonedCartTable();
    await pool.query(
      `UPDATE abandoned_carts SET recovery_sent_at = NOW(), status = 'recovery_sent'
       WHERE jid = $1 AND status = 'abandoned' AND recovered_at IS NULL`,
      [jid]
    );
  } catch { /* non-critical */ }
}

async function markRecovered(jid: string): Promise<void> {
  try {
    await ensureAbandonedCartTable();
    await pool.query(
      `UPDATE abandoned_carts SET recovered_at = NOW(), status = 'recovered'
       WHERE jid = $1 AND status = 'recovery_sent' AND recovered_at IS NULL`,
      [jid]
    );
  } catch { /* non-critical */ }
}

async function markCleared(jid: string): Promise<void> {
  try {
    await ensureAbandonedCartTable();
    await pool.query(
      `UPDATE abandoned_carts SET cleared_at = NOW(), status = 'cleared'
       WHERE jid = $1 AND status IN ('abandoned', 'recovery_sent') AND cleared_at IS NULL`,
      [jid]
    );
  } catch { /* non-critical */ }
}

/** US-917: Get recovery analytics for admin dashboard. */
export async function getCartRecoveryAnalytics(days = 7): Promise<{
  totalAbandoned: number;
  recoverySent: number;
  recovered: number;
  recoveryRate: number;
}> {
  try {
    await ensureAbandonedCartTable();
    const result = await pool.query(
      `SELECT
         COUNT(*)::int as total_abandoned,
         SUM(CASE WHEN recovery_sent_at IS NOT NULL THEN 1 ELSE 0 END)::int as recovery_sent,
         SUM(CASE WHEN recovered_at IS NOT NULL THEN 1 ELSE 0 END)::int as recovered
       FROM abandoned_carts
       WHERE abandoned_at >= NOW() - INTERVAL '1 day' * $1`,
      [days]
    );
    const row = result.rows[0] || { total_abandoned: 0, recovery_sent: 0, recovered: 0 };
    return {
      totalAbandoned: row.total_abandoned,
      recoverySent: row.recovery_sent,
      recovered: row.recovered,
      recoveryRate: row.recovery_sent > 0 ? Math.round((row.recovered / row.recovery_sent) * 100) : 0,
    };
  } catch {
    return { totalAbandoned: 0, recoverySent: 0, recovered: 0, recoveryRate: 0 };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Returns true if sessionId looks like a WhatsApp phone JID (not webchat). */
function isWhatsAppSession(sessionId: string): boolean {
  return !sessionId.startsWith('webchat-') && !sessionId.startsWith('bsuid:');
}

/** Get cart_recovery settings from config store. */
function getRecoverySettings(): { enabled: boolean; idleMinutes: number } {
  try {
    const settings = configStore.getSettings() as any;
    const cfg = settings?.cart_recovery;
    return {
      enabled: cfg?.enabled !== false,
      idleMinutes: cfg?.idle_minutes ?? 30,
    };
  } catch {
    return { enabled: true, idleMinutes: 30 };
  }
}

// ─── Core: periodic idle cart scanner ───────────────────────────────

async function scanIdleCarts(): Promise<void> {
  if (!sendMessage) return;

  const { enabled, idleMinutes } = getRecoverySettings();
  if (!enabled) return;

  const idleThresholdMs = idleMinutes * 60 * 1000;
  const now = Date.now();
  const activeSessions = getActiveCartSessions();

  for (const { sessionId, items, lastAccess } of activeSessions) {
    // Only WhatsApp sessions
    if (!isWhatsAppSession(sessionId)) continue;

    const idleDuration = now - lastAccess;

    // Get or create recovery state
    let state = recoveryStates.get(sessionId);

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

    // Not idle long enough yet
    if (idleDuration < idleThresholdMs) continue;

    // Check 24h session window compliance
    const windowActive = await sessionWindowActive(sessionId);
    if (!windowActive) {
      logSessionExpired(sessionId, 'cart_recovery', 'Abandoned cart recovery message');
      continue;
    }

    // US-917: Persist abandoned cart to DB (fire-and-forget)
    persistAbandonedCart(sessionId, items).catch(() => {});

    // Send recovery message
    const summary = cartFormatSummary(items);
    const message =
      `Hi! You have items in your cart:\n\n${summary}\n\n` +
      `Would you like to continue your order?\n\n` +
      `Reply *Resume order* to continue or *Clear cart* to start fresh.`;

    try {
      await sendMessage(sessionId, message);
      console.log(`[CartRecovery] Sent recovery message to ${sessionId} (${items.length} items, idle ${Math.round(idleDuration / 60000)}min)`);

      // Mark as sent (in-memory + DB)
      recoveryStates.set(sessionId, {
        recoveryMessageSent: true,
        sentAt: now,
      });
      markRecoverySent(sessionId).catch(() => {});
    } catch (err: any) {
      console.error(`[CartRecovery] Failed to send recovery to ${sessionId}:`, err.message);
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Initialize the cart recovery system.
 * Call during assistant init after sendMessage is available.
 */
export function initCartRecovery(send: SendMessageFn): void {
  sendMessage = send;

  // Start periodic scanner
  checkInterval = setInterval(() => {
    scanIdleCarts().catch(err => {
      console.error('[CartRecovery] Scan error:', err.message);
    });
  }, CHECK_INTERVAL_MS);

  console.log('[CartRecovery] US-882 abandoned cart recovery initialized');
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
 * Returns 'resume' | 'clear' | null.
 */
export function parseCartRecoveryReply(text: string): 'resume' | 'clear' | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === 'resume order') return 'resume';
  if (normalized === 'clear cart') return 'clear';
  return null;
}

/**
 * Handle a cart recovery reply from a WhatsApp user.
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
    // Cart items are still in the store — just reset the idle timer
    // by accessing the cart (cartGetItems updates lastAccess)
    const items = cartGetItems(phone);
    recoveryStates.delete(phone);

    // US-917: Track recovery in DB
    markRecovered(phone).catch(() => {});

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

    // US-917: Track cleared cart in DB
    markCleared(phone).catch(() => {});

    await send(phone, 'Cart cleared! Feel free to browse our menu anytime you\'d like to order.');
    console.log(`[CartRecovery] ${phone} cleared cart`);
    return true;
  }

  return false;
}

/**
 * Check if a session has a pending recovery message (for testing/admin).
 */
export function hasRecoveryPending(sessionId: string): boolean {
  return recoveryStates.get(sessionId)?.recoveryMessageSent ?? false;
}
