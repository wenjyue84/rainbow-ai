/**
 * Admin API: Intent Coverage Gap Analysis (US-824)
 *
 * GET /analytics/intent-gaps?profileId=pelangi&days=30
 *
 * Surfaces high-frequency unmatched message patterns by doing keyword
 * frequency analysis over rainbow_messages where intent = 'unknown'.
 * Returns top 10 keyword clusters for admin review + Create Intent shortcut.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { rainbowMessages } from '../../../shared/schema.js';
import { and, gte, eq, sql } from 'drizzle-orm';

const router = Router();

// ─── Stopwords ────────────────────────────────────────────────────────
// Common English + Malay short words to exclude from keyword clustering
const STOPWORDS = new Set([
  // English
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'the', 'a', 'an', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall',
  'to', 'of', 'in', 'at', 'on', 'for', 'from', 'with', 'by', 'or', 'and', 'but',
  'so', 'if', 'than', 'this', 'that', 'these', 'those', 'my', 'your', 'our',
  'their', 'his', 'her', 'its', 'what', 'when', 'where', 'how', 'which', 'who',
  'any', 'some', 'no', 'not', 'more', 'much', 'many', 'all', 'also', 'just',
  'please', 'hello', 'hi', 'ok', 'okay', 'thanks', 'thank', 'yes', 'nope',
  'want', 'need', 'like', 'get', 'got', 'go', 'going', 'come', 'know', 'think',
  'see', 'look', 'make', 'take', 'tell', 'ask', 'give', 'say', 'said', 'about',
  'there', 'here', 'then', 'now', 'up', 'out', 'only', 'into', 'over', 'after',
  'because', 'use', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'hey', 'dear', 'sir', 'madam', 'good', 'nice', 'great', 'sure', 'right',
  // Malay
  'saya', 'anda', 'dia', 'kita', 'mereka', 'yang', 'dan', 'atau', 'untuk',
  'dengan', 'dari', 'ke', 'di', 'ada', 'tidak', 'boleh', 'akan', 'sudah',
  'perlu', 'ini', 'itu', 'juga', 'lagi', 'lebih', 'sangat', 'tapi', 'bila',
  'macam', 'mcm', 'nak', 'dah', 'tak', 'ok', 'tau', 'kat',
]);

const MIN_WORD_LENGTH = 3;
const TOP_N = 10;

/**
 * Tokenise a message into lowercase words, filtering stopwords and short tokens.
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter(w => w.length >= MIN_WORD_LENGTH && !STOPWORDS.has(w) && /^[a-z0-9\u4e00-\u9fff]+$/.test(w));
}

// ─── GET /analytics/intent-gaps ──────────────────────────────────────
router.get('/analytics/intent-gaps', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        profileId: 'unknown',
        days: 30,
        totalUnmatched: 0,
        gaps: [],
        warning: 'Database connection unavailable.',
      });
    }

    const profileId = (req.query.profileId as string) || (res.locals.profileId as string) || undefined;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Fetch unmatched user messages from the period
    const rows = await db
      .select({
        content: rainbowMessages.content,
        timestamp: rainbowMessages.timestamp,
      })
      .from(rainbowMessages)
      .where(
        and(
          eq(rainbowMessages.role, 'user'),
          eq(rainbowMessages.intent, 'unknown'),
          gte(rainbowMessages.timestamp, since),
          profileId ? eq(rainbowMessages.profileId, profileId) : sql`true`,
        )
      )
      .orderBy(rainbowMessages.timestamp)
      .limit(2000); // Safety cap — enough for clustering

    const totalUnmatched = rows.length;

    if (totalUnmatched === 0) {
      return res.json({
        success: true,
        profileId: profileId || 'all',
        days,
        totalUnmatched: 0,
        gaps: [],
      });
    }

    // ─── Keyword Frequency Clustering ──────────────────────────────
    // Map: keyword → { count, exampleMessage, exampleTimestamp }
    const keywordMap = new Map<string, { count: number; exampleMessage: string; exampleTimestamp: Date }>();

    for (const row of rows) {
      const words = tokenise(row.content);
      const seen = new Set<string>(); // count each word once per message
      for (const word of words) {
        if (seen.has(word)) continue;
        seen.add(word);
        const existing = keywordMap.get(word);
        if (!existing) {
          keywordMap.set(word, { count: 1, exampleMessage: row.content, exampleTimestamp: row.timestamp });
        } else {
          existing.count += 1;
          // Keep the most recent example
          if (row.timestamp > existing.exampleTimestamp) {
            existing.exampleMessage = row.content;
            existing.exampleTimestamp = row.timestamp;
          }
        }
      }
    }

    // Sort by frequency, take top N
    const sorted = Array.from(keywordMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, TOP_N);

    const gaps = sorted.map(([keyword, data]) => ({
      keyword,
      messageCount: data.count,
      exampleMessage: data.exampleMessage,
      // sampleUtterance is used by the frontend to pre-fill the Create Intent dialog
      sampleUtterance: data.exampleMessage,
    }));

    res.json({
      success: true,
      profileId: profileId || 'all',
      days,
      totalUnmatched,
      gaps,
    });
  } catch (error) {
    console.error('[IntentGaps] ❌ Error computing gap analysis:', error);
    res.status(500).json({ error: 'Failed to compute intent gap analysis' });
  }
});

export default router;
