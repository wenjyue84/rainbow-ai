/**
 * order-history-store.ts — Persist completed webchat orders for returning-customer reorder (US-897)
 *
 * Stores completed order items to PostgreSQL so returning sessions can be
 * offered a "reorder your usual" quick-reply on next visit.
 */

import { pool } from '../lib/db.js';
import type { CartItem, TableInfo } from './cart-store.js';

// ─── DB Migration (startup) ──────────────────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS webchat_order_history (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(128) NOT NULL,
    phone VARCHAR(64) NOT NULL DEFAULT '',
    profile_id VARCHAR(64) NOT NULL DEFAULT 'makan-moments',
    items_json TEXT NOT NULL,
    table_info_json TEXT,
    order_id VARCHAR(64),
    total_amount REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).then(() =>
  pool.query(`CREATE INDEX IF NOT EXISTS idx_webchat_order_history_session ON webchat_order_history (session_id, created_at DESC)`)
).catch(() => {
  // Silently ignore if already exists or DB unavailable
});

export interface LastOrderResult {
  items: CartItem[];
  tableInfo?: TableInfo;
  orderId: string | null;
  totalAmount: number | null;
  placedAt: string; // ISO timestamp
}

/**
 * Save a completed order's items for future reorder lookups.
 * Fire-and-forget — does not block the order confirmation response.
 */
export async function saveOrderHistory(entry: {
  sessionId: string;
  phone: string;
  profileId?: string;
  items: CartItem[];
  tableInfo?: TableInfo;
  orderId?: string;
}): Promise<void> {
  try {
    const totalAmount = entry.items.reduce((sum, i) => sum + (i.price ?? 0) * i.qty, 0);
    await pool.query(
      `INSERT INTO webchat_order_history (session_id, phone, profile_id, items_json, table_info_json, order_id, total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.sessionId,
        entry.phone,
        entry.profileId ?? 'makan-moments',
        JSON.stringify(entry.items),
        entry.tableInfo ? JSON.stringify(entry.tableInfo) : null,
        entry.orderId ?? null,
        totalAmount || null,
      ],
    );
  } catch (err: any) {
    console.error('[OrderHistory] Failed to save:', err.message);
  }
}

/**
 * Look up the most recent completed order for a session.
 * Returns null if the session has no prior orders.
 */
export async function getLastOrder(sessionId: string, profileId = 'makan-moments'): Promise<LastOrderResult | null> {
  try {
    const result = await pool.query(
      `SELECT items_json, table_info_json, order_id, total_amount, created_at
       FROM webchat_order_history
       WHERE session_id = $1 AND profile_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId, profileId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const items: CartItem[] = typeof row.items_json === 'string'
      ? JSON.parse(row.items_json)
      : row.items_json;
    const tableInfo: TableInfo | undefined = row.table_info_json
      ? (typeof row.table_info_json === 'string' ? JSON.parse(row.table_info_json) : row.table_info_json)
      : undefined;

    return {
      items,
      tableInfo,
      orderId: row.order_id ?? null,
      totalAmount: row.total_amount ?? null,
      placedAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
  } catch (err: any) {
    console.error('[OrderHistory] Failed to get last order:', err.message);
    return null;
  }
}
