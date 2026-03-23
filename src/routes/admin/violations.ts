/**
 * Admin API: Profile Isolation Violations (US-310)
 *
 * GET /violations  — Recent violations with filtering by profile and time window
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { profileIsolationViolations } from '../../../shared/schema-tables.js';
import { desc, eq, and, gte, sql } from 'drizzle-orm';

const router = Router();

// GET /violations?profile={profile}&hours=24
router.get('/violations', async (req: Request, res: Response) => {
  try {
    const profileFilter = req.query.profile as string | undefined;
    const hours = Math.min(Math.max(parseInt(req.query.hours as string) || 24, 1), 720); // 1h to 30d
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const conditions = [gte(profileIsolationViolations.createdAt, since)];
    if (profileFilter) {
      conditions.push(eq(profileIsolationViolations.actualProfile, profileFilter));
    }

    const where = and(...conditions);

    const [rows, [countResult]] = await Promise.all([
      db.select()
        .from(profileIsolationViolations)
        .where(where)
        .orderBy(desc(profileIsolationViolations.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(profileIsolationViolations)
        .where(where),
    ]);

    res.json({
      violations: rows.map(r => ({
        id: r.id,
        attemptedProfile: r.attemptedProfile,
        actualProfile: r.actualProfile,
        queryText: r.queryText,
        routePath: r.routePath,
        method: r.method,
        ipAddress: r.ipAddress,
        timestamp: r.createdAt,
      })),
      total: Number(countResult?.count ?? 0),
      hours,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('[Violations] GET /violations failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch violations' });
  }
});

export default router;
