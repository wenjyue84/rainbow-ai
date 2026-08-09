/**
 * Admin API: Conversation Context Stats (US-308)
 *
 * GET /analytics/context-stats?profile={profile}&days=7
 *
 * Returns context sizing and relevance score distribution per profile,
 * computed from stored conversation messages. Helps tune the context
 * reranker thresholds.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { rainbowMessages } from '../../../shared/schema-tables.js';
import { sql, and, gte, eq, desc } from 'drizzle-orm';
import { scoreMessageRelevance } from '../../assistant/pipeline/context.js';

const router = Router();

// ─── Pure calculation functions (exported for testing) ──────────────

export interface ContextStatsResult {
  profile: string;
  days: number;
  conversationCount: number;
  avgContextSize: number;
  avgFilteredSize: number;
  relevanceDistribution: {
    /** Messages with score < 0.2 */
    low: number;
    /** Messages with score 0.2-0.5 */
    medium: number;
    /** Messages with score > 0.5 */
    high: number;
  };
}

/**
 * Bucket a relevance score into low/medium/high.
 */
export function bucketScore(score: number): 'low' | 'medium' | 'high' {
  if (score < 0.2) return 'low';
  if (score <= 0.5) return 'medium';
  return 'high';
}

/**
 * Compute context stats from grouped conversation messages.
 * Each group is a phone number's messages within the time window.
 */
export function computeContextStats(
  groups: Map<string, Array<{ role: string; content: string; timestamp: Date; intent: string | null }>>,
  profile: string,
  days: number,
  relevanceThreshold: number = 0.2,
): ContextStatsResult {
  let totalContextSize = 0;
  let totalFilteredSize = 0;
  const distribution = { low: 0, medium: 0, high: 0 };

  for (const [, messages] of groups) {
    totalContextSize += messages.length;

    // Score each message using the last message's intent (or 'booking' as fallback)
    const lastIntent = messages[messages.length - 1]?.intent || 'booking';
    let filteredCount = 0;

    for (const msg of messages) {
      const chatMsg = {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        timestamp: Math.floor(msg.timestamp.getTime() / 1000), // Convert Date to Unix seconds
      };
      const score = scoreMessageRelevance(chatMsg, lastIntent, profile);
      distribution[bucketScore(score)]++;

      if (score >= relevanceThreshold) {
        filteredCount++;
      }
    }

    totalFilteredSize += filteredCount;
  }

  const conversationCount = groups.size;

  return {
    profile,
    days,
    conversationCount,
    avgContextSize: conversationCount > 0 ? Math.round((totalContextSize / conversationCount) * 10) / 10 : 0,
    avgFilteredSize: conversationCount > 0 ? Math.round((totalFilteredSize / conversationCount) * 10) / 10 : 0,
    relevanceDistribution: distribution,
  };
}

// ─── Route ──────────────────────────────────────────────────────────

router.get('/analytics/context-stats', async (req: Request, res: Response) => {
  try {
    await dbReady;

    const profile = (req.query.profile as string) || 'pelangi';
    const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 7, 1), 90);
    const profileId = profile.startsWith('data-') ? profile : profile;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Query recent messages grouped by phone for the given profile
    const rows = await db
      .select({
        phone: rainbowMessages.phone,
        role: rainbowMessages.role,
        content: rainbowMessages.content,
        timestamp: rainbowMessages.timestamp,
        intent: rainbowMessages.intent,
      })
      .from(rainbowMessages)
      .where(
        and(
          eq(rainbowMessages.profileId, profileId),
          gte(rainbowMessages.timestamp, since),
        ),
      )
      .orderBy(rainbowMessages.phone, rainbowMessages.timestamp)
      .limit(10000);

    // Group messages by phone (conversation)
    const groups = new Map<string, Array<{ role: string; content: string; timestamp: Date; intent: string | null }>>();
    for (const row of rows) {
      const phone = row.phone;
      if (!groups.has(phone)) groups.set(phone, []);
      groups.get(phone)!.push({
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        intent: row.intent,
      });
    }

    const stats = computeContextStats(groups, profileId, days);

    res.json(stats);
  } catch (err) {
    console.error('[context-stats] Error computing context stats:', err);
    res.status(500).json({ error: 'Failed to compute context stats' });
  }
});

export default router;
