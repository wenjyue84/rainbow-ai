/**
 * Admin API: Top Consumers by Token Usage (US-945 AC5)
 *
 * GET /analytics/top-consumers?profileId=pelangi&days=7&limit=10
 *   — Returns top senders ranked by total LLM token consumption.
 *     Useful for identifying abusive or high-volume users.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { rainbowMessages } from '../../../shared/schema.js';
import { sql, and, gte, eq, desc } from 'drizzle-orm';

const router = Router();

router.get('/analytics/top-consumers', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        ok: true,
        topConsumers: [],
        warning: 'Database connection unavailable.',
      });
    }

    const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || undefined;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));

    const since = new Date();
    since.setDate(since.getDate() - days);

    const conditions = [
      gte(rainbowMessages.timestamp, since),
      eq(rainbowMessages.role, 'assistant'), // Only count assistant messages (they carry token usage)
    ];
    if (profileId) {
      conditions.push(eq(rainbowMessages.profileId, profileId));
    }

    const results = await db
      .select({
        phone: rainbowMessages.phone,
        totalTokens: sql<number>`coalesce(sum(${rainbowMessages.totalTokens}), 0)::int`,
        promptTokens: sql<number>`coalesce(sum(${rainbowMessages.promptTokens}), 0)::int`,
        completionTokens: sql<number>`coalesce(sum(${rainbowMessages.completionTokens}), 0)::int`,
        messageCount: sql<number>`count(*)::int`,
        avgResponseTime: sql<number>`round(avg(${rainbowMessages.responseTime}))::int`,
        lastActive: sql<string>`max(${rainbowMessages.timestamp})`,
      })
      .from(rainbowMessages)
      .where(and(...conditions))
      .groupBy(rainbowMessages.phone)
      .orderBy(desc(sql`sum(${rainbowMessages.totalTokens})`))
      .limit(limit);

    res.json({
      ok: true,
      topConsumers: results.map(r => ({
        phone: r.phone,
        totalTokens: r.totalTokens,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        messageCount: r.messageCount,
        avgResponseTimeMs: r.avgResponseTime,
        lastActive: r.lastActive,
      })),
      period: {
        days,
        since: since.toISOString(),
        until: new Date().toISOString(),
      },
      ...(profileId ? { profileId } : {}),
    });
  } catch (err: any) {
    console.error('[analytics-top-consumers] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
