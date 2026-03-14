/**
 * menu-allergens.ts — Admin API for managing menu item allergen data
 *
 * US-877: Allergen and dietary warning display on item selection.
 * Allergen data is stored in src/assistant/data-makan/allergens.json
 * and kept in memory via allergen-store.ts.
 *
 * Routes:
 *   GET    /api/rainbow/menu-allergens         — list all allergen data
 *   GET    /api/rainbow/menu-allergens/:code   — get allergen data for a specific item
 *   PUT    /api/rainbow/menu-allergens/:code   — create or replace allergen data
 *   PATCH  /api/rainbow/menu-allergens/:code   — partial update (merge)
 *   DELETE /api/rainbow/menu-allergens/:code   — remove allergen data
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getAllAllergenData,
  getAllergenEntry,
  setAllergenEntry,
  mergeAllergenEntry,
  deleteAllergenEntry,
  type AllergenEntry,
} from '../../lib/allergen-store.js';

const router = Router();

/** GET /api/rainbow/menu-allergens — list all allergen entries */
router.get('/menu-allergens', (_req: Request, res: Response) => {
  const data = getAllAllergenData();
  res.json({ data });
});

/** GET /api/rainbow/menu-allergens/:code — get allergen entry for item code */
router.get('/menu-allergens/:code', (req: Request, res: Response) => {
  const code = req.params.code.toUpperCase();
  const entry = getAllergenEntry(code);
  if (!entry) {
    res.status(404).json({ error: `No allergen data found for item code "${code}"` });
    return;
  }
  res.json({ code, ...entry });
});

/** PUT /api/rainbow/menu-allergens/:code — create or replace allergen data */
router.put('/menu-allergens/:code', (req: Request, res: Response) => {
  const code = req.params.code.toUpperCase();
  const { allergens, dietary_flags } = req.body as Partial<AllergenEntry>;

  if (!Array.isArray(allergens) || !Array.isArray(dietary_flags)) {
    res.status(400).json({ error: 'allergens (array) and dietary_flags (array) are required' });
    return;
  }

  setAllergenEntry(code, { allergens, dietary_flags });
  res.json({ code, allergens, dietary_flags, updated: true });
});

/** PATCH /api/rainbow/menu-allergens/:code — partial update (merge) */
router.patch('/menu-allergens/:code', (req: Request, res: Response) => {
  const code = req.params.code.toUpperCase();
  const { allergens, dietary_flags } = req.body as Partial<AllergenEntry>;

  if (allergens !== undefined && !Array.isArray(allergens)) {
    res.status(400).json({ error: 'allergens must be an array' });
    return;
  }
  if (dietary_flags !== undefined && !Array.isArray(dietary_flags)) {
    res.status(400).json({ error: 'dietary_flags must be an array' });
    return;
  }

  const merged = mergeAllergenEntry(code, { allergens, dietary_flags });
  res.json({ code, ...merged, updated: true });
});

/** DELETE /api/rainbow/menu-allergens/:code — remove allergen data */
router.delete('/menu-allergens/:code', (req: Request, res: Response) => {
  const code = req.params.code.toUpperCase();
  const deleted = deleteAllergenEntry(code);
  if (!deleted) {
    res.status(404).json({ error: `No allergen data found for item code "${code}"` });
    return;
  }
  res.json({ code, deleted: true });
});

export default router;
