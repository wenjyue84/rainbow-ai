/**
 * US-447: Conversation Summary Store
 *
 * Handles persisting and loading LLM-generated context summaries
 * from the rainbow_conversations table. Summaries reduce context
 * window usage on subsequent turns by replacing older messages
 * with a compact paragraph.
 */

import { eq } from 'drizzle-orm';
import { db, dbReady } from '../lib/db.js';
import { rainbowConversations } from '../../shared/schema-tables.js';
import { estimateTokens } from '../lib/token-counter.js';
import { canonicalPhoneKey } from './conversation-db.js';

let _dbReady = false;
async function ensureDb(): Promise<boolean> {
  if (_dbReady) return true;
  try { _dbReady = !!(await dbReady); } catch { _dbReady = false; }
  return _dbReady;
}

/**
 * Save a context summary to the DB (fire-and-forget safe).
 */
export async function saveContextSummary(phone: string, summary: string): Promise<void> {
  if (!(await ensureDb())) return;
  const key = canonicalPhoneKey(phone);
  const now = new Date();
  try {
    await db
      .update(rainbowConversations)
      .set({ contextSummary: summary, contextSummaryAt: now })
      .where(eq(rainbowConversations.phone, key));
  } catch (err: any) {
    console.error(`[SummaryStore] Failed to save summary for ${phone}: ${err.message}`);
  }
}

/**
 * Load a stored context summary from the DB.
 * Returns null if no summary exists or DB is unavailable.
 */
export async function loadContextSummary(phone: string): Promise<{ summary: string; at: Date } | null> {
  if (!(await ensureDb())) return null;
  const key = canonicalPhoneKey(phone);
  try {
    const rows = await db
      .select({
        contextSummary: rainbowConversations.contextSummary,
        contextSummaryAt: rainbowConversations.contextSummaryAt,
      })
      .from(rainbowConversations)
      .where(eq(rainbowConversations.phone, key))
      .limit(1);

    const row = rows[0];
    if (!row?.contextSummary) return null;
    return { summary: row.contextSummary, at: row.contextSummaryAt ?? new Date() };
  } catch (err: any) {
    console.error(`[SummaryStore] Failed to load summary for ${phone}: ${err.message}`);
    return null;
  }
}

/**
 * Log token counts before/after summarization and check >= 40% reduction.
 */
export function logSummarizationTokens(
  phone: string,
  originalMessages: Array<{ content: string }>,
  summaryText: string,
): { originalTokens: number; summaryTokens: number; reductionPct: number; meetsThreshold: boolean } {
  let originalTokens = 0;
  for (const m of originalMessages) {
    originalTokens += estimateTokens(m.content) + 4;
  }
  const summaryTokens = estimateTokens(summaryText) + 4;
  const reductionPct = originalTokens > 0
    ? Math.round((1 - summaryTokens / originalTokens) * 100)
    : 0;
  const meetsThreshold = reductionPct >= 40;

  console.log(
    `[SummaryStore] ${phone}: ${originalTokens} -> ${summaryTokens} tokens ` +
    `(${reductionPct}% reduction, threshold met: ${meetsThreshold})`
  );

  return { originalTokens, summaryTokens, reductionPct, meetsThreshold };
}
