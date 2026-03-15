/**
 * prompt-injection-log.ts — Log prompt injection attempts to database (US-927)
 *
 * Fire-and-forget logging of detected prompt injection attempts for
 * analytics, auditing, and the admin Injection Attempts dashboard.
 */
import { db } from './db.js';
import { promptInjectionLog } from '../../shared/schema-tables.js';
import { desc, sql, gte } from 'drizzle-orm';

export interface PromptInjectionLogInput {
  jid: string;
  profileId: string;
  rawMessage: string;
  matchedPattern: string;
  action?: 'blocked' | 'sanitised' | 'escalated';
}

/**
 * Log a prompt injection attempt (fire-and-forget).
 * Errors are caught to avoid blocking the message response.
 */
export function logPromptInjection(input: PromptInjectionLogInput): void {
  db.insert(promptInjectionLog)
    .values({
      jid: input.jid,
      profileId: input.profileId,
      rawMessage: input.rawMessage.slice(0, 2000), // cap stored message length
      matchedPattern: input.matchedPattern,
      action: input.action ?? 'blocked',
    })
    .then(() => {
      console.log(`[PromptInjection] Logged: jid=${input.jid} pattern="${input.matchedPattern}" action=${input.action ?? 'blocked'}`);
    })
    .catch((err: any) => {
      console.error(`[PromptInjection] Failed to log:`, err.message);
    });
}

/**
 * Get injection attempt count and daily trend for the last N days.
 * Used by admin dashboard Injection Attempts panel.
 */
export async function getInjectionAttemptStats(days: number = 7): Promise<{
  totalCount: number;
  dailyTrend: Array<{ date: string; count: number }>;
  recentAttempts: Array<{
    id: number;
    jid: string;
    profileId: string;
    rawMessage: string;
    matchedPattern: string;
    action: string;
    createdAt: Date;
  }>;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get total count
  const countResult = await db.select({
    count: sql<number>`count(*)::int`,
  })
    .from(promptInjectionLog)
    .where(gte(promptInjectionLog.createdAt, since));

  const totalCount = countResult[0]?.count ?? 0;

  // Get daily trend
  const dailyTrend = await db.select({
    date: sql<string>`to_char(${promptInjectionLog.createdAt}, 'YYYY-MM-DD')`,
    count: sql<number>`count(*)::int`,
  })
    .from(promptInjectionLog)
    .where(gte(promptInjectionLog.createdAt, since))
    .groupBy(sql`to_char(${promptInjectionLog.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${promptInjectionLog.createdAt}, 'YYYY-MM-DD')`);

  // Get recent attempts (last 20)
  const recentAttempts = await db.select()
    .from(promptInjectionLog)
    .orderBy(desc(promptInjectionLog.createdAt))
    .limit(20);

  return { totalCount, dailyTrend, recentAttempts };
}
