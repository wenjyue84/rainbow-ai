/**
 * order-modification-store.ts — Post-placement modification window (US-881)
 *
 * After an order is placed, customers have a configurable time window
 * (default 2 minutes) to request modifications before the kitchen accepts.
 *
 * Stores the order snapshot so items can be restored to the cart if the
 * customer says "change order" within the window.
 */

import type { CartItem, TableInfo } from './cart-store.js';

export interface OrderSnapshot {
  items: CartItem[];
  tableInfo?: TableInfo;
  orderId?: string;
  confirmedAt: number;
  windowMs: number;
  kitchenAccepted: boolean;
}

const modificationSessions = new Map<string, OrderSnapshot>();

/**
 * Tracks sessions currently in "modification mode" — i.e. items have been
 * restored to the cart and the next order_confirm_submit is a resubmission.
 */
const activeModifications = new Set<string>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const MAX_SNAPSHOT_AGE_MS = 30 * 60 * 1000; // 30 min hard cap

// Cleanup expired snapshots
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, snapshot] of modificationSessions) {
    if (now - snapshot.confirmedAt > MAX_SNAPSHOT_AGE_MS) {
      modificationSessions.delete(sessionId);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Save an order snapshot for the modification window.
 * Called right after order_confirm_submit places the order.
 */
export function saveModificationSnapshot(
  sessionId: string,
  items: CartItem[],
  windowMs: number,
  options?: { tableInfo?: TableInfo; orderId?: string },
): void {
  modificationSessions.set(sessionId, {
    items: items.map(i => ({ ...i })), // deep copy
    tableInfo: options?.tableInfo ? { ...options.tableInfo } : undefined,
    orderId: options?.orderId,
    confirmedAt: Date.now(),
    windowMs,
    kitchenAccepted: false,
  });
}

/**
 * Check whether modification is still allowed for this session.
 * Returns true if within the time window AND kitchen has not accepted.
 */
export function isModificationAllowed(sessionId: string): boolean {
  const snapshot = modificationSessions.get(sessionId);
  if (!snapshot) return false;
  if (snapshot.kitchenAccepted) return false;
  return (Date.now() - snapshot.confirmedAt) < snapshot.windowMs;
}

/**
 * Get the saved order snapshot for modification.
 * Returns undefined if no snapshot exists.
 */
export function getModificationSnapshot(sessionId: string): OrderSnapshot | undefined {
  return modificationSessions.get(sessionId);
}

/**
 * Mark the order as accepted by the kitchen (KDS/POS webhook callback).
 * Once accepted, modifications are no longer allowed.
 */
export function markKitchenAccepted(sessionId: string): boolean {
  const snapshot = modificationSessions.get(sessionId);
  if (!snapshot) return false;
  snapshot.kitchenAccepted = true;
  return true;
}

/**
 * Clear the modification window snapshot (e.g. after resubmission or expiry).
 */
export function clearModificationWindow(sessionId: string): void {
  modificationSessions.delete(sessionId);
}

/**
 * Mark a session as actively being modified (items restored to cart).
 * The next order_confirm_submit will treat it as a resubmission.
 */
export function setActiveModification(sessionId: string): void {
  activeModifications.add(sessionId);
}

/**
 * Check and consume the active modification flag.
 * Returns true once, then clears the flag.
 */
export function consumeActiveModification(sessionId: string): boolean {
  if (activeModifications.has(sessionId)) {
    activeModifications.delete(sessionId);
    return true;
  }
  return false;
}

/**
 * Get remaining seconds in the modification window.
 * Returns 0 if expired or not found.
 */
export function getModificationRemainingSeconds(sessionId: string): number {
  const snapshot = modificationSessions.get(sessionId);
  if (!snapshot) return 0;
  if (snapshot.kitchenAccepted) return 0;
  const elapsed = Date.now() - snapshot.confirmedAt;
  const remaining = snapshot.windowMs - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}
