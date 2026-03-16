/**
 * Admin API: Security — Prompt Injection Events (US-998)
 *
 * GET /security/injection-events         — Paginated list with date/profile filtering
 * GET /security/injection-events/stats   — Summary counts
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { promptInjectionEvents } from '../../../shared/schema-tables.js';
import { desc, eq, and, gte, lte, sql } from 'drizzle-orm';

const router = Router();

// GET /security/injection-events — Paginated list (AC2)
router.get('/security/injection-events', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
  const profileId = req.query.profile as string | undefined;
  const since = req.query.since as string | undefined;
  const until = req.query.until as string | undefined;

  const conditions = [];
  if (profileId) conditions.push(eq(promptInjectionEvents.profileId, profileId));
  if (since) conditions.push(gte(promptInjectionEvents.createdAt, new Date(since)));
  if (until) conditions.push(lte(promptInjectionEvents.createdAt, new Date(until)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [countResult]] = await Promise.all([
    db.select()
      .from(promptInjectionEvents)
      .where(where)
      .orderBy(desc(promptInjectionEvents.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(promptInjectionEvents)
      .where(where),
  ]);

  res.json({
    events: rows,
    total: Number(countResult?.count ?? 0),
    limit,
    offset,
  });
});

// GET /security/injection-events/stats — Summary (AC2)
router.get('/security/injection-events/stats', async (req: Request, res: Response) => {
  const profileId = req.query.profile as string | undefined;
  const conditions = [];
  if (profileId) conditions.push(eq(promptInjectionEvents.profileId, profileId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const dayConditions = [...conditions, gte(promptInjectionEvents.createdAt, last24h)];
  const weekConditions = [...conditions, gte(promptInjectionEvents.createdAt, last7d)];

  const [totalResult, dayResult, weekResult, topJidsResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(promptInjectionEvents)
      .where(where),
    db.select({ count: sql<number>`count(*)` })
      .from(promptInjectionEvents)
      .where(and(...dayConditions)),
    db.select({ count: sql<number>`count(*)` })
      .from(promptInjectionEvents)
      .where(and(...weekConditions)),
    db.select({
      jid: promptInjectionEvents.jid,
      count: sql<number>`count(*)`,
    })
      .from(promptInjectionEvents)
      .where(where)
      .groupBy(promptInjectionEvents.jid)
      .orderBy(sql`count(*) DESC`)
      .limit(10),
  ]);

  res.json({
    total: Number(totalResult[0]?.count ?? 0),
    last_24h: Number(dayResult[0]?.count ?? 0),
    last_7d: Number(weekResult[0]?.count ?? 0),
    top_jids: topJidsResult.map(r => ({ jid: r.jid, count: Number(r.count) })),
  });
});

export default router;
