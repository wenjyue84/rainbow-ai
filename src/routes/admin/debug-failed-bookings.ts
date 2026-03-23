/**
 * Admin API: Booking Classification Failure Logger (US-226)
 *
 * GET /admin/debug/failed-bookings
 *   Returns paginated booking classification failures from the last 24 hours
 *   with most common failed keywords grouped by profile.
 *
 * Query params:
 *   - profile: filter by profile_id (optional)
 *   - hours: lookback window in hours (default: 24)
 *   - page: page number (default: 1)
 *   - limit: page size (default: 50, max: 200)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { bookingClassificationFailures } from '../../../shared/schema.js';
import { desc, gte, eq, and, sql } from 'drizzle-orm';

const router = Router();

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'i', 'you', 'he', 'she',
  'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'and',
  'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'what', 'how', 'when', 'where', 'who', 'which', 'if', 'so', 'not',
  'no', 'yes', 'ok', 'hi', 'hello', 'lah', 'ah', 'la', 'ke', 'nak',
]);

/** Extract significant keywords from a raw input message. */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// GET /admin/debug/failed-bookings
router.get('/debug/failed-bookings', async (req: Request, res: Response) => {
  try {
    const hours = Math.min(parseInt(String(req.query.hours || '24'), 10) || 24, 168);
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const profileFilter = typeof req.query.profile === 'string' ? req.query.profile : undefined;

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const conditions = profileFilter
      ? and(gte(bookingClassificationFailures.timestamp, since), eq(bookingClassificationFailures.profileId, profileFilter))
      : gte(bookingClassificationFailures.timestamp, since);

    // Fetch paginated rows
    const rows = await db
      .select()
      .from(bookingClassificationFailures)
      .where(conditions)
      .orderBy(desc(bookingClassificationFailures.timestamp))
      .limit(limit)
      .offset((page - 1) * limit);

    // Total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(bookingClassificationFailures)
      .where(conditions);
    const total = Number(countResult[0]?.count ?? 0);

    // Keyword frequency grouped by profile
    const allRows = await db
      .select({ rawInput: bookingClassificationFailures.rawInput, profileId: bookingClassificationFailures.profileId })
      .from(bookingClassificationFailures)
      .where(conditions);

    const profileKeywords: Record<string, Record<string, number>> = {};
    for (const row of allRows) {
      const pid = row.profileId;
      if (!profileKeywords[pid]) profileKeywords[pid] = {};
      const words = extractKeywords(row.rawInput);
      for (const w of words) {
        profileKeywords[pid][w] = (profileKeywords[pid][w] ?? 0) + 1;
      }
    }

    // Top 10 keywords per profile
    const topKeywordsByProfile: Record<string, Array<{ keyword: string; count: number }>> = {};
    for (const [pid, freq] of Object.entries(profileKeywords)) {
      topKeywordsByProfile[pid] = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([keyword, count]) => ({ keyword, count }));
    }

    res.json({
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hours,
        since: since.toISOString(),
        profile: profileFilter ?? 'all',
      },
      failures: rows.map((r) => ({
        id: r.id,
        message_id: r.messageId,
        raw_input: r.rawInput,
        profile_id: r.profileId,
        top_3_candidates: r.top3Candidates,
        timestamp: r.timestamp,
      })),
      top_keywords_by_profile: topKeywordsByProfile,
    });
  } catch (err: any) {
    console.error('[DebugFailedBookings] Query failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch booking classification failures' });
  }
});

export default router;
