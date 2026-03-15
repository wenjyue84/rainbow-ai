/**
 * US-882: Proactive abandoned-cart recovery message
 *
 * Periodically scans active cart sessions for idle carts and sends a
 * recovery message via the webchat message DB (for webchat polling) or
 * WhatsApp (for WhatsApp sessions).
 *
 * Rules:
 * - Only one recovery message per cart session (no spam loops)
 * - Recovery message includes cart summary + quick-reply options
 * - If recovery is ignored for 24 hours, the cart is auto-cleared
 * - Idle period is configurable via settings.json
 * - WhatsApp sessions must comply with 24-hour session window
 */

import { pool } from '../lib/db.js';
import {
  cartGetActiveSessions, cartFormatSummary, cartClear,
  cartMarkRecoverySent, cartIsRecoverySent,
  type CartSession,
} from './cart-store.js';
import { clearOrderStage } from './order-stage-store.js';

const DEFAULT_IDLE_MINUTES = 30;
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // check every 2 minutes
const RECOVERY_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const WHATSAPP_24H_WINDOW_MS = 24 * 60 * 60 * 1000; // WhatsApp session window

let checkTimer: ReturnType<typeof setInterval> | null = null;
let configuredIdleMinutes: number = DEFAULT_IDLE_MINUTES;

/** Stored WhatsApp send function — set during init to avoid circular deps */
let whatsappSendFn: ((phone: string, text: string) => Promise<any>) | null = null;

/**
 * Detect whether a sessionId represents a WhatsApp session (phone number)
 * vs a webchat session (UUID).
 * WhatsApp session IDs are numeric phone strings (e.g. "60127088789").
 */
export function isWhatsAppSession(sessionId: string): boolean {
  return /^\d{8,15}$/.test(sessionId);
}

/**
 * Build the recovery message text from cart contents.
 */
export function buildRecoveryMessage(items: CartSession['items']): string {
  const summary = cartFormatSummary(items);
  return [
    "Hey! Looks like you left some items in your cart 🛒",
    '',
    summary,
    '',
    'Would you like to:',
    '👉 *Resume order* — continue where you left off',
    '👉 *Clear cart* — start fresh',
    '',
    "Just reply with 'Resume order' or 'Clear cart'!",
  ].join('\n');
}

/**
 * Check whether a message text is a cart recovery reply.
 * Returns 'resume' | 'clear' | null.
 */
export function parseRecoveryReply(text: string): 'resume' | 'clear' | null {
  const lower = text.trim().toLowerCase();
  if (/^resume\s*order$/i.test(lower) || lower === 'resume') return 'resume';
  if (/^clear\s*cart$/i.test(lower) || lower === 'clear') return 'clear';
  return null;
}

/**
 * Insert a recovery message into the webchat polling DB.
 * This makes it appear in the webchat widget on next poll.
 */
async function insertWebchatRecoveryMessage(phone: string, message: string): Promise<void> {
  const now = new Date();
  await pool.query(
    `INSERT INTO rainbow_messages (phone, role, content, timestamp, source)
     VALUES ($1, 'assistant', $2, $3, 'cart-recovery')`,
    [phone, message, now]
  );
}

/**
 * Scan all active cart sessions and send recovery messages for idle ones.
 * Supports both webchat (DB insert) and WhatsApp (outbound message) sessions.
 */
export async function checkIdleCarts(): Promise<number> {
  const activeSessions = cartGetActiveSessions();
  const now = Date.now();
  const idleThresholdMs = configuredIdleMinutes * 60 * 1000;
  let sentCount = 0;

  for (const { sessionId, session } of activeSessions) {
    // Skip if recovery already sent
    if (cartIsRecoverySent(sessionId)) {
      // Check if 24h expired since recovery message — auto-clear cart
      if (session.recoveryMessageSentAt &&
          now - session.recoveryMessageSentAt >= RECOVERY_EXPIRY_MS) {
        cartClear(sessionId);
        clearOrderStage(sessionId);
        console.log(`[CartRecovery] Auto-cleared cart for session ${sessionId} (24h recovery expiry)`);
      }
      continue;
    }

    // Check if session is idle beyond threshold
    const idleDuration = now - session.lastAccess;
    if (idleDuration < idleThresholdMs) continue;

    // Build and send recovery message
    const message = buildRecoveryMessage(session.items);
    const isWA = isWhatsAppSession(sessionId);

    try {
      if (isWA) {
        // WhatsApp: comply with 24-hour session window
        if (idleDuration >= WHATSAPP_24H_WINDOW_MS) {
          console.log(`[CartRecovery] Skipping WhatsApp session ${sessionId} — outside 24h window`);
          continue;
        }
        if (!whatsappSendFn) {
          console.warn(`[CartRecovery] No WhatsApp send function configured — skipping ${sessionId}`);
          continue;
        }
        await whatsappSendFn(sessionId, message);
      } else {
        // Webchat: insert into polling DB
        const phone = 'webchat-' + sessionId;
        await insertWebchatRecoveryMessage(phone, message);
      }

      cartMarkRecoverySent(sessionId);
      sentCount++;
      console.log(`[CartRecovery] Sent ${isWA ? 'WhatsApp' : 'webchat'} recovery for session ${sessionId} (idle ${Math.round(idleDuration / 60000)}m, ${session.items.length} items)`);
    } catch (err: any) {
      console.error(`[CartRecovery] Failed to send recovery for ${sessionId}:`, err.message);
    }
  }

  return sentCount;
}

/**
 * Handle a user's reply to the recovery message.
 * Returns a response message or null if the text is not a recovery reply.
 */
export function handleRecoveryReply(sessionId: string, text: string): string | null {
  const action = parseRecoveryReply(text);
  if (!action) return null;

  if (action === 'clear') {
    cartClear(sessionId);
    clearOrderStage(sessionId);
    return "Your cart has been cleared. Feel free to browse the menu and start a new order anytime! 🍽️";
  }

  // 'resume' — cart is still there, just reset recovery flag so they can continue
  // The cart items remain intact, the AI will see them in the next message context
  return "Welcome back! Your cart is ready. Just let me know when you'd like to confirm your order or make any changes! 😊";
}

/**
 * Initialize the cart idle recovery checker.
 * @param idleMinutes — idle threshold before sending recovery (default: 30)
 * @param sendWhatsApp — optional WhatsApp send function for WhatsApp sessions
 */
export function initCartIdleRecovery(
  idleMinutes?: number,
  sendWhatsApp?: (phone: string, text: string) => Promise<any>,
): void {
  if (checkTimer) {
    clearInterval(checkTimer);
  }

  configuredIdleMinutes = idleMinutes ?? DEFAULT_IDLE_MINUTES;
  whatsappSendFn = sendWhatsApp ?? null;

  // Initial check
  checkIdleCarts().catch(err => {
    console.error('[CartRecovery] Initial check failed:', err.message);
  });

  // Periodic check
  checkTimer = setInterval(() => {
    checkIdleCarts().catch(err => {
      console.error('[CartRecovery] Check failed:', err.message);
    });
  }, CHECK_INTERVAL_MS);

  // Don't block process exit
  if (checkTimer && typeof checkTimer === 'object' && 'unref' in checkTimer) {
    checkTimer.unref();
  }

  console.log(`[CartRecovery] Initialized — checking every ${CHECK_INTERVAL_MS / 1000}s, idle threshold: ${configuredIdleMinutes}m, WhatsApp: ${sendWhatsApp ? 'enabled' : 'disabled'}`);
}

/**
 * Stop the cart idle recovery checker.
 */
export function stopCartIdleRecovery(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
    console.log('[CartRecovery] Stopped');
  }
}
