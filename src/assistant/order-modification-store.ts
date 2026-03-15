/**
 * order-modification-store.ts — Post-placement order modification window (US-881)
 *
 * After an order is placed (PLACED stage), the customer has a configurable
 * time window (default 2 minutes) to request modifications before the kitchen
 * accepts or the timer expires.
 *
 * Stores a snapshot of the placed order so items can be repopulated into the
 * cart if the customer says "change order" within the window.
 */

import type { CartItem, TableInfo } from './cart-store.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface OrderSnapshot {
  orderId: string;
  items: CartItem[];
  tableInfo?: TableInfo;
  confirmedAt: number;          // Date.now() when order was placed
  windowMs: number;             // modification window duration
  kitchenAccepted: boolean;     // set true on POS webhook callback
  expired: boolean;             // set true when timer fires
  timer?: ReturnType<typeof setTimeout>;
}

// ─── In-memory store ────────────────────────────────────────────────

const modificationWindows = new Map<string, OrderSnapshot>();

// Also index by orderId so the kitchen webhook can look up by order ID
const orderIdToSession = new Map<string, string>();

const STORE_TTL_MS = 30 * 60 * 1000; // 30 min cleanup

// Cleanup expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, snapshot] of modificationWindows) {
    if (now - snapshot.confirmedAt > STORE_TTL_MS) {
      cleanupSnapshot(sessionId);
    }
  }
}, 10 * 60 * 1000);

function cleanupSnapshot(sessionId: string) {
  const snapshot = modificationWindows.get(sessionId);
  if (snapshot) {
    if (snapshot.timer) clearTimeout(snapshot.timer);
    orderIdToSession.delete(snapshot.orderId);
    modificationWindows.delete(sessionId);
  }
}

// ─── Core API ───────────────────────────────────────────────────────

/**
 * Start a modification window after order placement.
 * Stores a snapshot of the order items so they can be re-populated on modification.
 */
export function startModificationWindow(
  sessionId: string,
  orderId: string,
  items: CartItem[],
  tableInfo: TableInfo | undefined,
  windowMs: number
): void {
  // Clean up any previous window for this session
  cleanupSnapshot(sessionId);

  const snapshot: OrderSnapshot = {
    orderId,
    items: items.map(i => ({ ...i })), // deep-ish copy
    tableInfo: tableInfo ? { ...tableInfo } : undefined,
    confirmedAt: Date.now(),
    windowMs,
    kitchenAccepted: false,
    expired: false,
  };

  // Set expiration timer
  snapshot.timer = setTimeout(() => {
    snapshot.expired = true;
    snapshot.timer = undefined;
  }, windowMs);

  modificationWindows.set(sessionId, snapshot);
  orderIdToSession.set(orderId, sessionId);
}

/**
 * Check if modification is still allowed for a session.
 * Returns { allowed, reason } where reason explains why not if disallowed.
 */
export function isModificationAllowed(sessionId: string): { allowed: boolean; reason?: string } {
  const snapshot = modificationWindows.get(sessionId);
  if (!snapshot) {
    return { allowed: false, reason: 'no_order' };
  }
  if (snapshot.kitchenAccepted) {
    return { allowed: false, reason: 'kitchen_accepted' };
  }
  if (snapshot.expired) {
    return { allowed: false, reason: 'window_expired' };
  }
  // Double-check against wall clock
  const elapsed = Date.now() - snapshot.confirmedAt;
  if (elapsed >= snapshot.windowMs) {
    snapshot.expired = true;
    return { allowed: false, reason: 'window_expired' };
  }
  return { allowed: true };
}

/**
 * Get the order snapshot for modification (items to re-populate cart).
 * Returns null if no snapshot exists.
 */
export function getModificationSnapshot(sessionId: string): OrderSnapshot | null {
  return modificationWindows.get(sessionId) ?? null;
}

/**
 * Consume the modification window — called when the customer re-opens the cart.
 * Clears the timer and returns the snapshot data. The window is closed.
 */
export function consumeModificationWindow(sessionId: string): OrderSnapshot | null {
  const snapshot = modificationWindows.get(sessionId);
  if (!snapshot) return null;

  // Clear timer since customer is modifying
  if (snapshot.timer) clearTimeout(snapshot.timer);

  // Remove from store — the cart will take over
  modificationWindows.delete(sessionId);
  orderIdToSession.delete(snapshot.orderId);

  return snapshot;
}

/**
 * Mark an order as accepted by the kitchen (via POS webhook).
 * Closes the modification window.
 */
export function markKitchenAccepted(orderId: string): boolean {
  const sessionId = orderIdToSession.get(orderId);
  if (!sessionId) return false;

  const snapshot = modificationWindows.get(sessionId);
  if (!snapshot) return false;

  snapshot.kitchenAccepted = true;
  if (snapshot.timer) {
    clearTimeout(snapshot.timer);
    snapshot.timer = undefined;
  }
  return true;
}

/**
 * Close the modification window explicitly (e.g. on session reset).
 */
export function closeModificationWindow(sessionId: string): void {
  cleanupSnapshot(sessionId);
}

/**
 * Get remaining seconds in the modification window.
 * Returns 0 if window is closed/expired.
 */
export function getModificationTimeRemaining(sessionId: string): number {
  const snapshot = modificationWindows.get(sessionId);
  if (!snapshot || snapshot.expired || snapshot.kitchenAccepted) return 0;

  const remaining = snapshot.windowMs - (Date.now() - snapshot.confirmedAt);
  return Math.max(0, Math.ceil(remaining / 1000));
}
