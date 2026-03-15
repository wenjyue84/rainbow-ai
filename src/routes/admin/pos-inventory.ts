/**
 * US-949: POS inventory sync endpoints
 *
 * Routes:
 *   POST /api/rainbow/pos/stock-update     — POS webhook: batch stock level updates
 *   GET  /api/rainbow/inventory/status      — Live inventory status panel
 *   PATCH /api/rainbow/inventory/:itemId    — Admin toggle availability
 *   GET  /api/rainbow/inventory/transitions — Transition log for analytics
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { badRequest, serverError } from './http-utils.js';
import {
  processStockUpdate,
  toggleItemAvailability,
  getInventoryStatus,
  getInventoryTransitions,
  type StockUpdate,
} from '../../assistant/inventory-sync.js';

const router = Router();

// ─── POST /pos/stock-update — POS webhook receiver ──────────────────

router.post('/pos/stock-update', async (req: Request, res: Response) => {
  const { items } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return badRequest(res, 'items array is required with at least one stock update');
  }

  // Validate each item has required fields
  const updates: StockUpdate[] = [];
  for (const item of items) {
    if (!item.itemCode && !item.itemName) {
      return badRequest(res, 'Each item must have itemCode or itemName');
    }
    if (typeof item.quantity !== 'number' || item.quantity < 0) {
      return badRequest(res, `Invalid quantity for ${item.itemCode || item.itemName}: must be a non-negative number`);
    }
    updates.push({
      itemCode: item.itemCode || '',
      itemName: item.itemName,
      quantity: item.quantity,
      profile: item.profile || 'makan-moments',
      source: item.source,
    });
  }

  const source = (req.headers['x-pos-system'] as string) || 'pos_webhook';
  const changedBy = (req.headers['x-admin-user'] as string) || 'pos_system';

  try {
    const result = await processStockUpdate(updates, source, changedBy);

    console.log(`[POS] Stock update: ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.notFound.length} not found (source: ${source})`);

    res.json({
      ok: true,
      updated: result.updated,
      unchanged: result.unchanged,
      notFound: result.notFound,
      summary: {
        total: updates.length,
        updated: result.updated.length,
        unchanged: result.unchanged.length,
        notFound: result.notFound.length,
      },
    });
  } catch (err: any) {
    console.error('[POS] Stock update failed:', err.message);
    return serverError(res, err);
  }
});

// ─── GET /inventory/status — Live inventory status panel ────────────

router.get('/inventory/status', (req: Request, res: Response) => {
  const profile = (req.query.profile as string) || 'makan-moments';
  const category = req.query.category as string | undefined;
  const availableOnly = req.query.available_only === '1' || req.query.available_only === 'true';

  let items = getInventoryStatus(profile);

  if (category) {
    items = items.filter(i => i.category.toLowerCase() === category.toLowerCase());
  }
  if (availableOnly) {
    items = items.filter(i => i.available);
  }

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
    items,
  });
});

// ─── PATCH /inventory/:itemId — Admin toggle availability ───────────

router.patch('/inventory/:itemId', async (req: Request, res: Response) => {
  const { itemId } = req.params;
  const { available } = req.body || {};
  const profile = (req.query.profile as string) || (req.body.profile as string) || 'makan-moments';
  const changedBy = (req.headers['x-admin-user'] as string) || 'admin';

  if (typeof available !== 'boolean') {
    return badRequest(res, 'available (boolean) is required');
  }

  try {
    const result = await toggleItemAvailability(profile, itemId, available, changedBy);

    if (!result.success) {
      res.status(404).json({ error: result.error });
      return;
    }

    res.json({
      ok: true,
      item: result.item,
      message: `${result.item!.name} is now ${available ? 'available' : 'unavailable'}`,
    });
  } catch (err: any) {
    console.error('[Inventory] Toggle failed:', err.message);
    return serverError(res, err);
  }
});

// ─── GET /inventory/transitions — Transition log for analytics ──────

router.get('/inventory/transitions', async (req: Request, res: Response) => {
  const profile = (req.query.profile as string) || 'makan-moments';
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const since = req.query.since as string | undefined;

  try {
    const transitions = await getInventoryTransitions(profile, limit, since);
    res.json({
      profile,
      total: transitions.length,
      transitions,
    });
  } catch (err: any) {
    console.error('[Inventory] Transitions fetch failed:', err.message);
    return serverError(res, err);
  }
});

export default router;
