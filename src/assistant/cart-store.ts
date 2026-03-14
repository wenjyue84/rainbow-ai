/**
 * cart-store.ts — In-memory conversational cart state
 *
 * Stores per-session cart items for the AI waiter (makan-moments profile).
 * Cart state persists for the webchat session lifecycle and is cleared
 * on checkout or idle timeout.
 */

export interface CartItem {
  name: string;
  code?: string;
  qty: number;
  price?: number; // unit price in MYR
  notes?: string;
}

interface CartSession {
  items: CartItem[];
  lastAccess: number;
}

const CART_TTL_MS = 60 * 60 * 1000; // 1 hour idle timeout

const cartSessions = new Map<string, CartSession>();

// Cleanup idle carts every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of cartSessions) {
    if (now - session.lastAccess > CART_TTL_MS) {
      cartSessions.delete(sessionId);
    }
  }
}, 15 * 60 * 1000);

function getOrCreate(sessionId: string): CartSession {
  let session = cartSessions.get(sessionId);
  if (!session) {
    session = { items: [], lastAccess: Date.now() };
    cartSessions.set(sessionId, session);
  } else {
    session.lastAccess = Date.now();
  }
  return session;
}

/** Add or update an item in the cart. Merges qty if item name already exists. */
export function cartAddItem(sessionId: string, item: CartItem): CartItem[] {
  const session = getOrCreate(sessionId);
  const normalizedName = item.name.trim().toLowerCase();

  const existing = session.items.find(i => i.name.toLowerCase() === normalizedName);
  if (existing) {
    existing.qty += item.qty;
    if (item.price !== undefined) existing.price = item.price;
    if (item.code !== undefined) existing.code = item.code;
    if (item.notes !== undefined) existing.notes = item.notes;
  } else {
    session.items.push({ ...item, name: item.name.trim() });
  }
  return [...session.items];
}

/** Remove an item from the cart by name (case-insensitive). Returns removed item or null. */
export function cartRemoveItem(sessionId: string, name: string): { removed: CartItem | null; items: CartItem[] } {
  const session = getOrCreate(sessionId);
  const normalizedName = name.trim().toLowerCase();
  const idx = session.items.findIndex(i => i.name.toLowerCase() === normalizedName);

  if (idx === -1) {
    return { removed: null, items: [...session.items] };
  }
  const [removed] = session.items.splice(idx, 1);
  return { removed, items: [...session.items] };
}

/** Get current cart items for a session. */
export function cartGetItems(sessionId: string): CartItem[] {
  const session = cartSessions.get(sessionId);
  if (session) session.lastAccess = Date.now();
  return session ? [...session.items] : [];
}

/**
 * Set the quantity of a named cart item (case-insensitive match).
 * - qty <= 0  → removes the item (treated as removal)
 * - item not found → returns found: false, items unchanged
 */
export function cartUpdateItemQty(
  sessionId: string,
  name: string,
  qty: number
): { found: boolean; removed: boolean; items: CartItem[] } {
  const session = getOrCreate(sessionId);
  const normalizedName = name.trim().toLowerCase();
  const idx = session.items.findIndex(i => i.name.toLowerCase() === normalizedName);

  if (idx === -1) {
    return { found: false, removed: false, items: [...session.items] };
  }

  if (qty <= 0) {
    session.items.splice(idx, 1);
    return { found: true, removed: true, items: [...session.items] };
  }

  session.items[idx].qty = Math.floor(qty);
  return { found: true, removed: false, items: [...session.items] };
}

/**
 * Set or update special instructions (notes) on a named cart item.
 * Returns found: false if the item is not in the cart.
 */
export function cartSetItemNotes(
  sessionId: string,
  name: string,
  notes: string
): { found: boolean; items: CartItem[] } {
  const session = getOrCreate(sessionId);
  const normalizedName = name.trim().toLowerCase();
  const item = session.items.find(i => i.name.toLowerCase() === normalizedName);

  if (!item) {
    return { found: false, items: [...session.items] };
  }

  // Append to existing notes if present, otherwise set
  item.notes = item.notes ? `${item.notes}, ${notes}` : notes;
  return { found: true, items: [...session.items] };
}

/** Clear all items from the cart (e.g. after checkout or timeout). */
export function cartClear(sessionId: string): void {
  cartSessions.delete(sessionId);
}

/** Format cart as a human-readable WhatsApp-friendly summary. */
export function cartFormatSummary(items: CartItem[]): string {
  if (items.length === 0) return 'Your cart is empty.';

  let total = 0;
  const lines = items.map(item => {
    const subtotal = item.price !== undefined ? item.price * item.qty : null;
    if (subtotal !== null) total += subtotal;
    const priceStr = item.price !== undefined ? ` (RM ${item.price.toFixed(2)} each)` : '';
    const subtotalStr = subtotal !== null ? ` = RM ${subtotal.toFixed(2)}` : '';
    const notesStr = item.notes ? ` [${item.notes}]` : '';
    return `• ${item.qty}x ${item.name}${priceStr}${subtotalStr}${notesStr}`;
  });

  const summary = lines.join('\n');
  const totalStr = total > 0 ? `\n\nTotal: RM ${total.toFixed(2)}` : '';
  return summary + totalStr;
}
