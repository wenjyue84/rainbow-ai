/**
 * allergen-pending-store.ts — Per-session pending cart-add awaiting allergen confirmation
 *
 * US-877: When an item with allergen data is selected, the bot shows the allergen
 * warning and asks for confirmation before adding to cart. This store tracks the
 * pending item across turns until the guest confirms or the TTL expires.
 */

import type { CartItem } from '../assistant/cart-store.js';

export interface PendingAllergenItem {
  item: CartItem;
  /** Pre-formatted allergen warning shown to guest */
  allergenWarning: string;
  /** Unix ms when this entry was created */
  createdAt: number;
}

const ALLERGEN_PENDING_TTL_MS = 10 * 60 * 1000; // 10-minute TTL

const store = new Map<string, PendingAllergenItem>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.createdAt > ALLERGEN_PENDING_TTL_MS) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

/** Store a pending cart-add awaiting allergen confirmation. */
export function setPendingAllergenItem(sessionId: string, item: CartItem, allergenWarning: string): void {
  store.set(sessionId, { item, allergenWarning, createdAt: Date.now() });
}

/** Retrieve the pending item for a session. Returns undefined if expired or absent. */
export function getPendingAllergenItem(sessionId: string): PendingAllergenItem | undefined {
  const entry = store.get(sessionId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > ALLERGEN_PENDING_TTL_MS) {
    store.delete(sessionId);
    return undefined;
  }
  return entry;
}

/** Remove the pending item (after confirm or cancel). */
export function clearPendingAllergenItem(sessionId: string): void {
  store.delete(sessionId);
}
