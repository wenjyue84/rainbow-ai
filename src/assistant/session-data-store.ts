/**
 * session-data-store.ts — WCAG 2.2 SC 3.3.7 Redundant Entry prevention
 *
 * Persists user-provided session data (name, table, address) across order cycles.
 * Unlike cart-store (cleared on checkout), this store survives cart clears
 * so the AI can pre-fill previously entered information instead of re-asking.
 *
 * US-921
 */

export interface SessionData {
  /** Customer name provided during conversation */
  customerName?: string;
  /** Table number (persists across orders) */
  tableNumber?: string;
  /** Order type: dine-in or takeaway (persists across orders) */
  orderType?: 'dine-in' | 'takeaway';
  /** Delivery address if provided */
  deliveryAddress?: string;
}

interface SessionDataEntry {
  data: SessionData;
  lastAccess: number;
}

const SESSION_DATA_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours (outlives cart's 1-hour TTL)

const sessionDataStore = new Map<string, SessionDataEntry>();

// Cleanup stale sessions every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessionDataStore) {
    if (now - entry.lastAccess > SESSION_DATA_TTL_MS) {
      sessionDataStore.delete(key);
    }
  }
}, 30 * 60 * 1000);

/** Get session data for a session. Returns empty object if nothing stored. */
export function getSessionData(sessionId: string): SessionData {
  const entry = sessionDataStore.get(sessionId);
  if (entry) {
    entry.lastAccess = Date.now();
    return { ...entry.data };
  }
  return {};
}

/** Save or merge session data fields. Only updates provided fields. */
export function saveSessionData(sessionId: string, update: Partial<SessionData>): SessionData {
  let entry = sessionDataStore.get(sessionId);
  if (!entry) {
    entry = { data: {}, lastAccess: Date.now() };
    sessionDataStore.set(sessionId, entry);
  }
  entry.lastAccess = Date.now();

  // Merge only provided (non-undefined) fields
  if (update.customerName !== undefined) entry.data.customerName = update.customerName;
  if (update.tableNumber !== undefined) entry.data.tableNumber = update.tableNumber;
  if (update.orderType !== undefined) entry.data.orderType = update.orderType;
  if (update.deliveryAddress !== undefined) entry.data.deliveryAddress = update.deliveryAddress;

  return { ...entry.data };
}

/** Clear all session data for a session. */
export function clearSessionData(sessionId: string): void {
  sessionDataStore.delete(sessionId);
}

/**
 * Format session data as a system prompt section for the AI.
 * Returns empty string if no data is stored.
 */
export function formatSessionDataPrompt(data: SessionData): string {
  const lines: string[] = [];

  if (data.customerName) {
    lines.push(`Customer Name: ${data.customerName} (already provided — do NOT ask again)`);
  }
  if (data.tableNumber) {
    lines.push(`Table Number: ${data.tableNumber} (already provided — do NOT ask again)`);
  }
  if (data.orderType) {
    lines.push(`Order Type: ${data.orderType} (already provided — do NOT ask again)`);
  }
  if (data.deliveryAddress) {
    lines.push(`Delivery Address: ${data.deliveryAddress} (already provided — offer as default, allow edit)`);
  }

  if (lines.length === 0) return '';

  return [
    '',
    '## Previously Provided Customer Info (WCAG 2.2 SC 3.3.7 — do NOT re-ask)',
    ...lines,
    'If the guest starts a new order in the same session, use this info automatically.',
    'If they want to change any of these, accept the update and call session_save_info.',
  ].join('\n');
}
