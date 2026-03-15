/**
 * US-949: Real-time inventory sync between chatbot and POS
 *
 * Manages item availability state with:
 *   - In-memory availability cache for zero-latency reads
 *   - POS webhook receiver for real-time stock updates
 *   - Transition logging for demand forecasting analytics
 *   - Integration with menu-items-store for consistency
 */

import { pool } from '../lib/db.js';
import { dbReady } from '../lib/db.js';
import {
  getMenuItems,
  getMenuItem,
  updateMenuItem,
} from '../lib/menu-items-store.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface StockUpdate {
  itemCode: string;
  itemName?: string;
  quantity: number;
  profile?: string;
  source?: string;
}

export interface InventoryTransition {
  id?: string;
  item_id: string;
  item_name: string;
  profile: string;
  previous_available: boolean;
  new_available: boolean;
  quantity: number | null;
  source: string;
  changed_by: string;
  changed_at?: string;
}

export interface InventoryStatus {
  id: string;
  name: string;
  category: string;
  price: number;
  available: boolean;
  last_stock_update?: string;
}

// ─── Table Creation ─────────────────────────────────────────────────

export async function ensureInventoryTransitionsTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_transitions (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id       TEXT NOT NULL,
        item_name     TEXT NOT NULL,
        profile       TEXT NOT NULL DEFAULT 'makan-moments',
        previous_available BOOLEAN NOT NULL,
        new_available BOOLEAN NOT NULL,
        quantity       INTEGER,
        source        TEXT NOT NULL DEFAULT 'manual',
        changed_by    TEXT NOT NULL DEFAULT 'system',
        changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_transitions_item ON inventory_transitions(item_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_transitions_profile ON inventory_transitions(profile);
      CREATE INDEX IF NOT EXISTS idx_inventory_transitions_changed_at ON inventory_transitions(changed_at);
    `);
  } catch (err: any) {
    console.error('[InventorySync] Failed to ensure transitions table:', err.message);
  }
}

dbReady.then(ok => { if (ok) ensureInventoryTransitionsTable().catch(() => {}); });

// ─── Core Sync Logic ────────────────────────────────────────────────

/**
 * Process a stock update from POS webhook.
 * Updates menu item availability and logs transitions.
 * Returns the list of items that changed availability.
 */
export async function processStockUpdate(
  updates: StockUpdate[],
  source: string = 'pos_webhook',
  changedBy: string = 'system'
): Promise<{ updated: string[]; unchanged: string[]; notFound: string[] }> {
  const result = { updated: [] as string[], unchanged: [] as string[], notFound: [] as string[] };

  for (const update of updates) {
    const profile = update.profile || 'makan-moments';
    const newAvailable = update.quantity > 0;

    // Find the menu item by code or name
    const menuItem = findMenuItemByCodeOrName(profile, update.itemCode, update.itemName);

    if (!menuItem) {
      result.notFound.push(update.itemCode || update.itemName || 'unknown');
      continue;
    }

    // Check if availability actually changed
    if (menuItem.available === newAvailable) {
      result.unchanged.push(menuItem.name);
      continue;
    }

    // Update menu item availability
    try {
      await updateMenuItem(profile, menuItem.id, { available: newAvailable });

      // Log the transition
      await logInventoryTransition({
        item_id: menuItem.id,
        item_name: menuItem.name,
        profile,
        previous_available: menuItem.available,
        new_available: newAvailable,
        quantity: update.quantity,
        source,
        changed_by: changedBy,
      });

      result.updated.push(menuItem.name);
      console.log(`[InventorySync] ${menuItem.name}: ${menuItem.available ? 'available' : 'unavailable'} -> ${newAvailable ? 'available' : 'unavailable'} (qty: ${update.quantity}, source: ${source})`);
    } catch (err: any) {
      console.error(`[InventorySync] Failed to update ${menuItem.name}:`, err.message);
      result.notFound.push(menuItem.name);
    }
  }

  return result;
}

/**
 * Manually toggle item availability from admin dashboard.
 */
export async function toggleItemAvailability(
  profile: string,
  itemId: string,
  available: boolean,
  changedBy: string = 'admin'
): Promise<{ success: boolean; item?: InventoryStatus; error?: string }> {
  const menuItem = getMenuItem(profile, itemId);
  if (!menuItem) {
    return { success: false, error: `Menu item "${itemId}" not found for profile "${profile}"` };
  }

  if (menuItem.available === available) {
    return {
      success: true,
      item: {
        id: menuItem.id,
        name: menuItem.name,
        category: menuItem.category,
        price: menuItem.price,
        available: menuItem.available,
      },
    };
  }

  try {
    await updateMenuItem(profile, itemId, { available });

    await logInventoryTransition({
      item_id: menuItem.id,
      item_name: menuItem.name,
      profile,
      previous_available: menuItem.available,
      new_available: available,
      quantity: null,
      source: 'admin_dashboard',
      changed_by: changedBy,
    });

    return {
      success: true,
      item: {
        id: menuItem.id,
        name: menuItem.name,
        category: menuItem.category,
        price: menuItem.price,
        available,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Get live inventory status for all items in a profile.
 */
export function getInventoryStatus(profile: string): InventoryStatus[] {
  const items = getMenuItems(profile, true); // include unavailable
  return items.map(item => ({
    id: item.id,
    name: item.name,
    category: item.category,
    price: item.price,
    available: item.available,
  }));
}

/**
 * Check if a specific item is available (for cart integration).
 */
export function isItemAvailable(profile: string, itemCode?: string, itemName?: string): { available: boolean; itemName?: string; alternatives?: InventoryStatus[] } {
  if (!itemCode && !itemName) return { available: true };

  const menuItem = findMenuItemByCodeOrName(profile, itemCode, itemName);
  if (!menuItem) return { available: true }; // unknown items are assumed available

  if (menuItem.available) {
    return { available: true, itemName: menuItem.name };
  }

  // Find alternatives from same category
  const categoryItems = getMenuItems(profile, false)
    .filter(i => i.category === menuItem.category && i.id !== menuItem.id)
    .slice(0, 3)
    .map(i => ({
      id: i.id,
      name: i.name,
      category: i.category,
      price: i.price,
      available: i.available,
    }));

  return {
    available: false,
    itemName: menuItem.name,
    alternatives: categoryItems.length > 0 ? categoryItems : undefined,
  };
}

// ─── Transition Log ─────────────────────────────────────────────────

async function logInventoryTransition(transition: InventoryTransition): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO inventory_transitions (item_id, item_name, profile, previous_available, new_available, quantity, source, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        transition.item_id,
        transition.item_name,
        transition.profile,
        transition.previous_available,
        transition.new_available,
        transition.quantity,
        transition.source,
        transition.changed_by,
      ]
    );
  } catch (err: any) {
    console.error('[InventorySync] Failed to log transition:', err.message);
  }
}

/**
 * Get recent inventory transitions for analytics.
 */
export async function getInventoryTransitions(
  profile: string,
  limit: number = 50,
  since?: string
): Promise<InventoryTransition[]> {
  try {
    const params: any[] = [profile, limit];
    let query = `SELECT id, item_id, item_name, profile, previous_available, new_available,
                        quantity, source, changed_by, changed_at::text
                 FROM inventory_transitions
                 WHERE profile = $1`;

    if (since) {
      query += ` AND changed_at >= $3`;
      params.push(since);
    }

    query += ` ORDER BY changed_at DESC LIMIT $2`;

    const { rows } = await pool.query(query, params);
    return rows;
  } catch (err: any) {
    console.error('[InventorySync] Failed to fetch transitions:', err.message);
    return [];
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function findMenuItemByCodeOrName(
  profile: string,
  code?: string,
  name?: string
): import('../lib/menu-items-store.js').MenuItem | undefined {
  const allItems = getMenuItems(profile, true); // include unavailable

  // Try exact code match first
  if (code) {
    const byCode = allItems.find(i =>
      i.id === code ||
      i.name.toLowerCase().replace(/\s+/g, '-') === code.toLowerCase()
    );
    if (byCode) return byCode;
  }

  // Try name match
  if (name) {
    const normalizedName = name.toLowerCase().trim();
    const byName = allItems.find(i => i.name.toLowerCase().trim() === normalizedName);
    if (byName) return byName;

    // Partial match
    const partial = allItems.find(i => i.name.toLowerCase().includes(normalizedName));
    if (partial) return partial;
  }

  // Try code as name fallback
  if (code && !name) {
    const normalizedCode = code.toLowerCase().trim();
    const byCodeAsName = allItems.find(i => i.name.toLowerCase().trim() === normalizedCode);
    if (byCodeAsName) return byCodeAsName;
  }

  return undefined;
}
