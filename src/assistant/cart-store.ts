/**
 * cart-store.ts — In-memory conversational cart state
 *
 * Stores per-session cart items for the AI waiter (makan-moments profile).
 * Cart state persists for the webchat session lifecycle and is cleared
 * on checkout or idle timeout.
 */

export interface SetMealComponent {
  /** Choice group name, e.g. "Drink", "Side" */
  choiceName: string;
  /** Selected option, e.g. "Teh Tarik" */
  selectedItem: string;
}

export interface CartItem {
  name: string;
  code?: string;
  qty: number;
  price?: number; // unit price in MYR
  notes?: string;
  /** Chosen components for set meals / combos */
  components?: SetMealComponent[];
}

export interface TableInfo {
  tableNumber?: string;  // e.g. "5", "T5"
  orderType?: 'dine-in' | 'takeaway';
}

export interface CartSession {
  items: CartItem[];
  lastAccess: number;
  tableInfo?: TableInfo;
  /** US-882: Whether an abandoned-cart recovery message has been sent for this session */
  recoveryMessageSent?: boolean;
  /** US-882: Timestamp when recovery message was sent (for 24h auto-clear) */
  recoveryMessageSentAt?: number;
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
  // US-882: Reset recovery flag on new cart activity
  session.recoveryMessageSent = false;
  session.recoveryMessageSentAt = undefined;
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

/** Set table number and/or order type for a session. */
export function cartSetTableInfo(sessionId: string, info: TableInfo): TableInfo {
  const session = getOrCreate(sessionId);
  session.tableInfo = { ...session.tableInfo, ...info };
  return { ...session.tableInfo };
}

/** Get table info for a session. Returns undefined if not set. */
export function cartGetTableInfo(sessionId: string): TableInfo | undefined {
  const session = cartSessions.get(sessionId);
  if (session) session.lastAccess = Date.now();
  return session?.tableInfo ? { ...session.tableInfo } : undefined;
}

/** Mark that a recovery message has been sent for this session. */
export function cartMarkRecoverySent(sessionId: string): void {
  const session = cartSessions.get(sessionId);
  if (session) {
    session.recoveryMessageSent = true;
    session.recoveryMessageSentAt = Date.now();
  }
}

/** Check if a recovery message has already been sent for this session. */
export function cartIsRecoverySent(sessionId: string): boolean {
  return cartSessions.get(sessionId)?.recoveryMessageSent === true;
}

/** Reset the recovery flag (e.g. when user resumes or adds more items). */
export function cartResetRecovery(sessionId: string): void {
  const session = cartSessions.get(sessionId);
  if (session) {
    session.recoveryMessageSent = false;
    session.recoveryMessageSentAt = undefined;
  }
}

/**
 * Get all active cart sessions with non-empty items.
 * Used by the idle recovery checker.
 */
export function cartGetActiveSessions(): Array<{ sessionId: string; session: CartSession }> {
  const results: Array<{ sessionId: string; session: CartSession }> = [];
  for (const [sessionId, session] of cartSessions) {
    if (session.items.length > 0) {
      results.push({ sessionId, session: { ...session, items: [...session.items] } });
    }
  }
  return results;
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
    let line = `• ${item.qty}x ${item.name}${priceStr}${subtotalStr}${notesStr}`;
    // Show chosen components for set meals
    if (item.components && item.components.length > 0) {
      const compLines = item.components.map(c => `  └ ${c.choiceName}: ${c.selectedItem}`);
      line += '\n' + compLines.join('\n');
    }
    return line;
  });

  const summary = lines.join('\n');
  const totalStr = total > 0 ? `\n\nTotal: RM ${total.toFixed(2)}` : '';
  return summary + totalStr;
}
