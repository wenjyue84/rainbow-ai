/**
 * menu-items.ts — Admin API for live menu item management
 *
 * US-879: Menu sync via admin API — live price and availability updates
 * without server restart or file edit.
 *
 * Routes:
 *   GET    /api/rainbow/menu-items              — list all items for a profile
 *   GET    /api/rainbow/menu-items/:id          — get single item
 *   POST   /api/rainbow/menu-items              — create new item
 *   PATCH  /api/rainbow/menu-items/:id          — update item fields (incl. available)
 *
 * Query params:
 *   ?profile=makan-moments   (required for GET list)
 *   ?include_unavailable=1   (include unavailable items in list)
 *   ?category=Mains          (filter by category)
 *
 * All changes are logged to rainbow_config_audit.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getMenuItems,
  getMenuItem,
  getMenuCategories,
  createMenuItem,
  updateMenuItem,
  type MenuItemCreate,
  type MenuItemUpdate,
} from '../../lib/menu-items-store.js';
import { pool } from '../../lib/db.js';

const router = Router();

// ─── Audit logging helper ──────────────────────────────────────────────────

async function logMenuAudit(
  action: 'create' | 'update',
  itemId: string,
  changedBy: string | undefined,
  before: object | null,
  after: object
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await pool.query(
      `INSERT INTO rainbow_config_audit (config_key, action, changed_by, server_role, old_version, new_version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        `menu_item:${itemId}`,
        action,
        changedBy ?? null,
        process.env.RAINBOW_ROLE || 'unknown',
        before ? JSON.stringify(before) : null,
        JSON.stringify(after),
      ]
    );
  } catch {
    // Non-critical — audit failure must never break the main operation
  }
}

// ─── GET /api/rainbow/menu-items ──────────────────────────────────────────

router.get('/menu-items', (req: Request, res: Response) => {
  const profile = (req.query.profile as string) || 'makan-moments';
  const includeUnavailable = req.query.include_unavailable === '1' || req.query.include_unavailable === 'true';
  const category = req.query.category as string | undefined;

  let items = getMenuItems(profile, includeUnavailable);

  if (category) {
    items = items.filter(i => i.category.toLowerCase() === category.toLowerCase());
  }

  const categories = getMenuCategories(profile);

  res.json({
    profile,
    total: items.length,
    categories,
    items,
  });
});

// ─── GET /api/rainbow/menu-items/:id ──────────────────────────────────────

router.get('/menu-items/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const profile = (req.query.profile as string) || 'makan-moments';

  const item = getMenuItem(profile, id);
  if (!item) {
    res.status(404).json({ error: `Menu item "${id}" not found for profile "${profile}"` });
    return;
  }
  res.json(item);
});

// ─── POST /api/rainbow/menu-items ─────────────────────────────────────────

router.post('/menu-items', async (req: Request, res: Response) => {
  const body = req.body as Partial<MenuItemCreate>;

  // Validate required fields
  if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
    res.status(400).json({ error: 'name (string) is required' });
    return;
  }
  if (body.price === undefined || typeof body.price !== 'number' || body.price < 0) {
    res.status(400).json({ error: 'price (non-negative number) is required' });
    return;
  }

  const data: MenuItemCreate = {
    profile: (body.profile as string) || 'makan-moments',
    name: body.name.trim(),
    description: body.description,
    price: body.price,
    category: (body.category?.trim()) || 'General',
    allergens: Array.isArray(body.allergens) ? body.allergens : [],
    dietary_flags: Array.isArray(body.dietary_flags) ? body.dietary_flags : [],
    available: body.available !== false,
    display_order: typeof body.display_order === 'number' ? body.display_order : 0,
  };

  try {
    const item = await createMenuItem(data);
    const changedBy = (req.headers['x-admin-user'] as string) ?? undefined;
    await logMenuAudit('create', item.id, changedBy, null, item);
    res.status(201).json(item);
  } catch (err: any) {
    console.error('[menu-items] POST failed:', err.message);
    res.status(500).json({ error: 'Failed to create menu item', detail: err.message });
  }
});

// ─── PATCH /api/rainbow/menu-items/:id ────────────────────────────────────

router.patch('/menu-items/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const profile = (req.query.profile as string) || (req.body.profile as string) || 'makan-moments';

  const before = getMenuItem(profile, id);
  if (!before) {
    res.status(404).json({ error: `Menu item "${id}" not found for profile "${profile}"` });
    return;
  }

  const patch = req.body as MenuItemUpdate;

  // Validate optional fields when provided
  if (patch.name !== undefined && (typeof patch.name !== 'string' || patch.name.trim() === '')) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }
  if (patch.price !== undefined && (typeof patch.price !== 'number' || patch.price < 0)) {
    res.status(400).json({ error: 'price must be a non-negative number' });
    return;
  }
  if (patch.allergens !== undefined && !Array.isArray(patch.allergens)) {
    res.status(400).json({ error: 'allergens must be an array' });
    return;
  }
  if (patch.dietary_flags !== undefined && !Array.isArray(patch.dietary_flags)) {
    res.status(400).json({ error: 'dietary_flags must be an array' });
    return;
  }

  try {
    const updated = await updateMenuItem(profile, id, patch);
    if (!updated) {
      res.status(404).json({ error: `Menu item "${id}" not found` });
      return;
    }

    const changedBy = (req.headers['x-admin-user'] as string) ?? undefined;
    await logMenuAudit('update', id, changedBy, before, updated);

    // Indicate whether item was toggled to unavailable (for AI pipeline awareness)
    const availabilityChanged = patch.available !== undefined && patch.available !== before.available;

    res.json({
      ...updated,
      _meta: {
        availabilityChanged,
        wasAvailable: before.available,
        isNowAvailable: updated.available,
      },
    });
  } catch (err: any) {
    console.error('[menu-items] PATCH failed:', err.message);
    res.status(500).json({ error: 'Failed to update menu item', detail: err.message });
  }
});

export default router;
