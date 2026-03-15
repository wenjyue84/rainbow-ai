/**
 * inventory.ts — Admin API for live inventory status and stock event log
 *
 * US-949: Real-time out-of-stock sync between chatbot and POS inventory
 *
 * Routes:
 *   GET  /api/rainbow/inventory/status         — live item availability panel
 *   GET  /api/rainbow/inventory/events         — stock transition log (demand forecasting)
 *   POST /api/rainbow/inventory/toggle/:id     — manual admin availability toggle (fast-path)
 *
 * Query params for /status:
 *   ?profile=makan-moments   (required)
 *   ?category=Mains          (optional filter)
 *
 * Query params for /events:
 *   ?profile=makan-moments   (required)
 *   ?limit=100               (default 100)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getMenuItems,
  getMenuCategories,
  getMenuItem,
  updateMenuItem,
  getStockEvents,
  logStockTransition,
} from '../../lib/menu-items-store.js';

const router = Router();

// ─── GET /api/rainbow/inventory/status ─────────────────────────────────────

router.get('/inventory/status', (req: Request, res: Response) => {
  const profile = (req.query.profile as string) || 'makan-moments';
  const category = req.query.category as string | undefined;

  // Always include unavailable items so the panel can display the full picture
  let items = getMenuItems(profile, true);

  if (category) {
    items = items.filter(i => i.category.toLowerCase() === category.toLowerCase());
  }

  const categories = getMenuCategories(profile);
  const totalItems = items.length;
  const availableCount = items.filter(i => i.available).length;
  const unavailableCount = totalItems - availableCount;

  res.json({
    profile,
    summary: {
      total: totalItems,
      available: availableCount,
      unavailable: unavailableCount,
    },
    categories,
    items: items.map(i => ({
      id: i.id,
      name: i.name,
      category: i.category,
      price: i.price,
      available: i.available,
      updated_at: i.updated_at,
    })),
  });
});

// ─── GET /api/rainbow/inventory/events ─────────────────────────────────────

router.get('/inventory/events', async (req: Request, res: Response) => {
  const profile = (req.query.profile as string) || 'makan-moments';
  const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 500);

  const events = await getStockEvents(profile, limit);

  res.json({
    profile,
    total: events.length,
    events,
  });
});

// ─── POST /api/rainbow/inventory/toggle/:id ────────────────────────────────
//
// Allows admin to flip availability for a single item directly from the
// inventory status panel without a full menu redeploy.

router.post('/inventory/toggle/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const profile = (req.body.profile as string) || (req.query.profile as string) || 'makan-moments';
  const changedBy = req.body.changed_by as string | undefined;

  const existing = getMenuItem(profile, id);
  if (!existing) {
    res.status(404).json({ error: `Item ${id} not found in profile ${profile}` });
    return;
  }

  const newAvailable = !existing.available;
  const updated = await updateMenuItem(profile, id, { available: newAvailable });

  if (!updated) {
    res.status(500).json({ error: 'Failed to update item' });
    return;
  }

  // Log the manual toggle
  logStockTransition({
    profile,
    item_id: existing.id,
    item_name: existing.name,
    previous_available: existing.available,
    new_available: newAvailable,
    quantity: null,
    source: 'admin',
    changed_by: changedBy ?? null,
  });

  res.json({
    ok: true,
    item: {
      id: updated.id,
      name: updated.name,
      available: updated.available,
      updated_at: updated.updated_at,
    },
  });
});

export default router;
