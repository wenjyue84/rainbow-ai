/**
 * menu-items-store.ts — In-memory + DB-backed menu item store
 *
 * Provides live price and availability updates without server restart.
 * Items are stored in Postgres (menu_items table) and kept in a per-profile
 * in-memory Map for zero-latency reads by the AI pipeline.
 *
 * US-879: Menu sync via admin API.
 */

import { pool } from './db.js';

export interface MenuItem {
  id: string;
  profile: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  allergens: string[];
  dietary_flags: string[];
  available: boolean;
  display_order: number;
  /** Localised name variants keyed by ISO 639-1 code (e.g. ms, zh) */
  translations: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export type MenuItemCreate = Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>;
export type MenuItemUpdate = Partial<Omit<MenuItem, 'id' | 'profile' | 'created_at' | 'updated_at'>>;

function hasDB(): boolean {
  return !!process.env.DATABASE_URL;
}

// ─── In-memory store ─────────────────────────────────────────────────────────
// profile -> id -> MenuItem
const store = new Map<string, Map<string, MenuItem>>();

function getProfileStore(profile: string): Map<string, MenuItem> {
  if (!store.has(profile)) store.set(profile, new Map());
  return store.get(profile)!;
}

// ─── Table creation ──────────────────────────────────────────────────────────

export async function ensureMenuItemsTable(): Promise<void> {
  if (!hasDB()) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        profile       TEXT NOT NULL,
        name          TEXT NOT NULL,
        description   TEXT,
        price         NUMERIC(10,2) NOT NULL DEFAULT 0,
        category      TEXT NOT NULL DEFAULT 'General',
        allergens     TEXT NOT NULL DEFAULT '[]',
        dietary_flags TEXT NOT NULL DEFAULT '[]',
        available     BOOLEAN NOT NULL DEFAULT TRUE,
        display_order INTEGER NOT NULL DEFAULT 0,
        translations  TEXT NOT NULL DEFAULT '{}',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_menu_items_profile ON menu_items(profile);
      CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(profile, category);
      CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(profile, available);
    `);
    // Add translations column if it doesn't exist (migration for existing tables)
    await pool.query(`
      ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS translations TEXT NOT NULL DEFAULT '{}';
    `).catch(() => { /* column may already exist */ });
  } catch (err: any) {
    console.error('[MenuItemsStore] Failed to ensure table:', err.message);
  }
}

// ─── Load from DB ────────────────────────────────────────────────────────────

export async function loadMenuItemsFromDB(): Promise<void> {
  if (!hasDB()) return;
  try {
    const { rows } = await pool.query<MenuItem & { allergens: string; dietary_flags: string; translations: string }>(
      `SELECT id, profile, name, description, price::float AS price, category,
              allergens, dietary_flags, available, display_order,
              translations, created_at::text, updated_at::text
       FROM menu_items ORDER BY profile, display_order, name`
    );
    // Clear and repopulate
    store.clear();
    for (const row of rows) {
      const item: MenuItem = {
        ...row,
        price: Number(row.price),
        allergens: parseJsonArray(row.allergens),
        dietary_flags: parseJsonArray(row.dietary_flags),
        translations: parseJsonObject(row.translations as any),
      };
      getProfileStore(item.profile).set(item.id, item);
    }
    const total = rows.length;
    if (total > 0) console.log(`[MenuItemsStore] Loaded ${total} menu items from DB`);
  } catch (err: any) {
    console.error('[MenuItemsStore] Failed to load from DB:', err.message);
  }
}

function parseJsonArray(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | Record<string, string>): Record<string, string> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw as string);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ─── CRUD operations ─────────────────────────────────────────────────────────

/** Get all menu items for a profile (available only by default). */
export function getMenuItems(profile: string, includeUnavailable = false): MenuItem[] {
  const items = Array.from(getProfileStore(profile).values());
  return includeUnavailable ? items : items.filter(i => i.available);
}

/** Get a single menu item by id. */
export function getMenuItem(profile: string, id: string): MenuItem | undefined {
  return getProfileStore(profile).get(id);
}

/** Get menu items by category for a profile. */
export function getMenuItemsByCategory(profile: string, category: string, includeUnavailable = false): MenuItem[] {
  return getMenuItems(profile, includeUnavailable).filter(
    i => i.category.toLowerCase() === category.toLowerCase()
  );
}

/** Get distinct categories for a profile. */
export function getMenuCategories(profile: string): string[] {
  const cats = new Set<string>();
  for (const item of getMenuItems(profile, true)) cats.add(item.category);
  return Array.from(cats).sort();
}

/** Create a new menu item. Writes to DB and updates in-memory store. */
export async function createMenuItem(data: MenuItemCreate): Promise<MenuItem> {
  let item: MenuItem;

  if (hasDB()) {
    const { rows } = await pool.query<any>(
      `INSERT INTO menu_items (profile, name, description, price, category, allergens, dietary_flags, available, display_order, translations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, profile, name, description, price::float, category,
                 allergens, dietary_flags, available, display_order,
                 translations, created_at::text, updated_at::text`,
      [
        data.profile,
        data.name,
        data.description ?? null,
        data.price,
        data.category,
        JSON.stringify(data.allergens ?? []),
        JSON.stringify(data.dietary_flags ?? []),
        data.available ?? true,
        data.display_order ?? 0,
        JSON.stringify(data.translations ?? {}),
      ]
    );
    const row = rows[0];
    item = {
      ...row,
      price: Number(row.price),
      allergens: parseJsonArray(row.allergens),
      dietary_flags: parseJsonArray(row.dietary_flags),
      translations: parseJsonObject(row.translations),
    };
  } else {
    // No DB — generate a local ID and store in memory only
    item = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      allergens: data.allergens ?? [],
      dietary_flags: data.dietary_flags ?? [],
      available: data.available ?? true,
      display_order: data.display_order ?? 0,
      translations: data.translations ?? {},
      description: data.description,
      ...data,
    };
  }

  getProfileStore(item.profile).set(item.id, item);
  return item;
}

/** Update a menu item. Writes to DB and updates in-memory store immediately. */
export async function updateMenuItem(
  profile: string,
  id: string,
  patch: MenuItemUpdate
): Promise<MenuItem | null> {
  const existing = getProfileStore(profile).get(id);
  if (!existing) return null;

  const updated: MenuItem = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  if (hasDB()) {
    // Build dynamic SET clause from provided fields only
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (patch.name !== undefined) { fields.push(`name = $${idx++}`); values.push(patch.name); }
    if (patch.description !== undefined) { fields.push(`description = $${idx++}`); values.push(patch.description); }
    if (patch.price !== undefined) { fields.push(`price = $${idx++}`); values.push(patch.price); }
    if (patch.category !== undefined) { fields.push(`category = $${idx++}`); values.push(patch.category); }
    if (patch.allergens !== undefined) { fields.push(`allergens = $${idx++}`); values.push(JSON.stringify(patch.allergens)); }
    if (patch.dietary_flags !== undefined) { fields.push(`dietary_flags = $${idx++}`); values.push(JSON.stringify(patch.dietary_flags)); }
    if (patch.available !== undefined) { fields.push(`available = $${idx++}`); values.push(patch.available); }
    if (patch.display_order !== undefined) { fields.push(`display_order = $${idx++}`); values.push(patch.display_order); }
    if (patch.translations !== undefined) { fields.push(`translations = $${idx++}`); values.push(JSON.stringify(patch.translations)); }

    if (fields.length === 0) return updated; // Nothing to update

    fields.push(`updated_at = NOW()`);
    values.push(id, profile);

    const { rows } = await pool.query<any>(
      `UPDATE menu_items SET ${fields.join(', ')}
       WHERE id = $${idx} AND profile = $${idx + 1}
       RETURNING id, profile, name, description, price::float, category,
                 allergens, dietary_flags, available, display_order,
                 translations, created_at::text, updated_at::text`,
      values
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    updated.allergens = parseJsonArray(row.allergens);
    updated.dietary_flags = parseJsonArray(row.dietary_flags);
    updated.translations = parseJsonObject(row.translations);
    updated.price = Number(row.price);
    updated.updated_at = row.updated_at;
  }

  // Immediate in-memory update (no restart needed)
  getProfileStore(profile).set(id, updated);
  return updated;
}

// ─── Stock Events (US-949) ────────────────────────────────────────────────────

export interface StockEvent {
  id: string;
  profile: string;
  item_id: string;
  item_name: string;
  previous_available: boolean;
  new_available: boolean;
  quantity: number | null;
  source: 'pos_webhook' | 'admin';
  changed_by: string | null;
  created_at: string;
}

/** Ensure menu_stock_events table exists. */
export async function ensureStockEventsTable(): Promise<void> {
  if (!hasDB()) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menu_stock_events (
        id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        profile           TEXT NOT NULL,
        item_id           TEXT NOT NULL,
        item_name         TEXT NOT NULL,
        previous_available BOOLEAN NOT NULL,
        new_available     BOOLEAN NOT NULL,
        quantity          INTEGER,
        source            TEXT NOT NULL DEFAULT 'admin',
        changed_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_menu_stock_events_profile ON menu_stock_events(profile);
      CREATE INDEX IF NOT EXISTS idx_menu_stock_events_item_id ON menu_stock_events(item_id);
      CREATE INDEX IF NOT EXISTS idx_menu_stock_events_created_at ON menu_stock_events(created_at DESC);
    `);
  } catch (err: any) {
    console.error('[MenuItemsStore] Failed to ensure stock_events table:', err.message);
  }
}

/** Log a stock availability transition. Fire-and-forget (non-critical). */
export function logStockTransition(
  event: Omit<StockEvent, 'id' | 'created_at'>
): void {
  if (!hasDB()) return;
  pool.query(
    `INSERT INTO menu_stock_events (profile, item_id, item_name, previous_available, new_available, quantity, source, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.profile,
      event.item_id,
      event.item_name,
      event.previous_available,
      event.new_available,
      event.quantity ?? null,
      event.source,
      event.changed_by ?? null,
    ]
  ).catch(err => console.error('[MenuItemsStore] logStockTransition failed:', err.message));
}

/** Fetch recent stock events for a profile (demand forecasting analytics). */
export async function getStockEvents(
  profile: string,
  limit = 100
): Promise<StockEvent[]> {
  if (!hasDB()) return [];
  try {
    const { rows } = await pool.query<StockEvent>(
      `SELECT id, profile, item_id, item_name, previous_available, new_available,
              quantity, source, changed_by, created_at::text
       FROM menu_stock_events
       WHERE profile = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [profile, limit]
    );
    return rows;
  } catch (err: any) {
    console.error('[MenuItemsStore] getStockEvents failed:', err.message);
    return [];
  }
}

/**
 * POS stock update: accepts an array of {name, sku?, quantity} and updates
 * the `available` flag for matching menu items. Items with quantity = 0 are
 * marked unavailable; quantity > 0 marks them available again.
 * Returns a summary of changes applied.
 */
export async function applyPosStockUpdate(
  profile: string,
  updates: Array<{ name?: string; sku?: string; quantity: number }>
): Promise<{ updated: string[]; not_found: string[] }> {
  const updated: string[] = [];
  const not_found: string[] = [];

  const allItems = Array.from(getProfileStore(profile).values());

  for (const u of updates) {
    // Match by name (case-insensitive) or sku/code
    const match = allItems.find(item => {
      if (u.name && item.name.toLowerCase() === u.name.toLowerCase()) return true;
      return false;
    });

    const identifier = u.name ?? u.sku ?? `(unknown)`;

    if (!match) {
      not_found.push(identifier);
      continue;
    }

    const newAvailable = u.quantity > 0;
    if (match.available === newAvailable) continue; // No change needed

    await updateMenuItem(profile, match.id, { available: newAvailable });
    logStockTransition({
      profile,
      item_id: match.id,
      item_name: match.name,
      previous_available: match.available,
      new_available: newAvailable,
      quantity: u.quantity,
      source: 'pos_webhook',
      changed_by: 'pos',
    });
    updated.push(`${match.name} -> ${newAvailable ? 'available' : 'out-of-stock'}`);
  }

  return { updated, not_found };
}
