/**
 * order-history-store.ts — Persistent order history for returning-customer feature (US-897)
 *
 * Saves completed order snapshots to PostgreSQL so returning webchat sessions
 * can be offered their last order on session start.
 *
 * Table: webchat_order_history (auto-created on first use)
 */

import { pool } from '../lib/db.js';
import type { CartItem } from './cart-store.js';

export interface OrderHistoryEntry {
  phone: string;
  orderId: string;
  items: CartItem[];
  placedAt: Date;
}

// ─── Table Migration (deferred until pool is available) ────────────────────────
let _orderHistoryMigrationDone = false;
let migrationPromise: Promise<void> | undefined;
function ensureOrderHistoryTable(): Promise<void> {
  if (_orderHistoryMigrationDone || !pool) return Promise.resolve();
  _orderHistoryMigrationDone = true;
  migrationPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS webchat_order_history (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(100) NOT NULL,
      order_id VARCHAR(100),
      items JSONB NOT NULL DEFAULT '[]',
      placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() =>
    pool.query(`
      CREATE INDEX IF NOT EXISTS idx_webchat_order_history_phone
      ON webchat_order_history (phone, placed_at DESC)
    `)
  ).then(() => {}).catch(err => {
    console.error('[OrderHistory] Migration error:', err.message);
  });
  return migrationPromise;
}

/**
 * Save a completed order snapshot for a webchat session.
 * Called after successful order_confirm_submit.
 */
export async function saveOrderHistory(
  phone: string,
  orderId: string,
  items: CartItem[]
): Promise<void> {
  await ensureOrderHistoryTable();
  try {
    await pool.query(
      `INSERT INTO webchat_order_history (phone, order_id, items, placed_at)
       VALUES ($1, $2, $3, NOW())`,
      [phone, orderId, JSON.stringify(items)]
    );
  } catch (err: any) {
    console.error('[OrderHistory] Save error:', err.message);
  }
}

/**
 * Get the most recent completed order for a phone identifier within the last 30 days.
 * Returns null if no prior orders exist or if the last order is older than 30 days.
 * US-856: Only offer to repeat orders from the last 30 days to avoid stale suggestions.
 */
export async function getLastOrder(phone: string): Promise<OrderHistoryEntry | null> {
  await ensureOrderHistoryTable();
  try {
    // Calculate the cutoff date: 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await pool.query(
      `SELECT phone, order_id, items, placed_at
       FROM webchat_order_history
       WHERE phone = $1 AND placed_at > $2
       ORDER BY placed_at DESC
       LIMIT 1`,
      [phone, thirtyDaysAgo]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      phone: row.phone,
      orderId: row.order_id,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
      placedAt: new Date(row.placed_at),
    };
  } catch (err: any) {
    console.error('[OrderHistory] Lookup error:', err.message);
    return null;
  }
}
