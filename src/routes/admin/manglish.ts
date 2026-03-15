/**
 * Admin API: Manglish Token Map Management (US-1011)
 *
 * Allows operators to add, update, and delete Manglish normalisation tokens
 * without a code deployment. Changes take effect immediately (in-memory reload).
 *
 * Endpoints:
 *   GET  /manglish/tokens          — List all tokens
 *   PUT  /manglish/tokens          — Replace entire token map
 *   POST /manglish/tokens/:token   — Add or update a single token
 *   DELETE /manglish/tokens/:token — Remove a single token
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getManglishMap,
  saveManglishMap,
  upsertToken,
  deleteToken,
} from '../../assistant/manglish-normalizer.js';
import { ok, badRequest, notFound, serverError } from './http-utils.js';

const router = Router();

// ─── GET /manglish/tokens ────────────────────────────────────────────
router.get('/manglish/tokens', (_req: Request, res: Response) => {
  try {
    const map = getManglishMap();
    ok(res, { tokens: map.tokens, metadata: map._metadata });
  } catch (err: any) {
    serverError(res, err);
  }
});

// ─── PUT /manglish/tokens ────────────────────────────────────────────
const replaceMapSchema = z.object({
  tokens: z.record(z.string(), z.string()),
});

router.put('/manglish/tokens', (req: Request, res: Response) => {
  const result = replaceMapSchema.safeParse(req.body);
  if (!result.success) {
    badRequest(res, result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    return;
  }

  try {
    const current = getManglishMap();
    current.tokens = result.data.tokens;
    if (current._metadata) {
      current._metadata.tokenCount = Object.keys(result.data.tokens).length;
      current._metadata.lastUpdated = new Date().toISOString().slice(0, 10);
    }
    saveManglishMap(current);
    ok(res, { tokenCount: Object.keys(result.data.tokens).length });
  } catch (err: any) {
    serverError(res, err);
  }
});

// ─── POST /manglish/tokens/:token ───────────────────────────────────
const upsertTokenSchema = z.object({
  replacement: z.string(),
});

router.post('/manglish/tokens/:token', (req: Request, res: Response) => {
  const token = (req.params.token as string).toLowerCase().trim();
  if (!token) {
    badRequest(res, 'Token must not be empty');
    return;
  }

  const result = upsertTokenSchema.safeParse(req.body);
  if (!result.success) {
    badRequest(res, result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    return;
  }

  try {
    upsertToken(token, result.data.replacement);
    ok(res, { token, replacement: result.data.replacement });
  } catch (err: any) {
    serverError(res, err);
  }
});

// ─── DELETE /manglish/tokens/:token ─────────────────────────────────
router.delete('/manglish/tokens/:token', (req: Request, res: Response) => {
  const token = (req.params.token as string).toLowerCase().trim();
  if (!token) {
    badRequest(res, 'Token must not be empty');
    return;
  }

  try {
    const deleted = deleteToken(token);
    if (!deleted) {
      notFound(res, `Token "${token}"`);
      return;
    }
    ok(res, { deleted: token });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
