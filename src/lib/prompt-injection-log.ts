/**
 * US-928: Prompt Injection Security Logging
 *
 * Fire-and-forget DB logging for prompt injection attempts.
 * Logs the offending message (with PII redacted), matched pattern,
 * detection layer, and action taken.
 */
import { db } from './db.js';
import { promptInjectionLog } from '../../shared/schema-tables.js';
import { desc, sql, count } from 'drizzle-orm';

/**
 * Log a prompt injection attempt to the database.
 * Fire-and-forget — errors are caught and logged to console.
 */
export function logPromptInjection(params: {
  jid: string;
  profileId: string;
  rawMessage: string;
  matchedPattern: string;
  layer: string;
  action: 'blocked' | 'logged';
}): void {
  // Truncate raw message to 500 chars for storage (PII should already be redacted by caller)
  const truncated = params.rawMessage.length > 500
    ? params.rawMessage.slice(0, 500) + '...'
    : params.rawMessage;

  db.insert(promptInjectionLog).values({
    jid: params.jid,
    profileId: params.profileId,
    rawMessage: truncated,
    matchedPattern: params.matchedPattern,
    layer: params.layer,
    action: params.action,
  }).catch((err: any) => {
    console.error('[PromptInjectionLog] Failed to log injection attempt:', err.message);
  });
}

/**
 * Get injection attempt statistics for the admin dashboard.
 */
export async function getInjectionAttemptStats(profileId?: string): Promise<{
  total: number;
  last24h: number;
  topPatterns: Array<{ pattern: string; count: number }>;
}> {
  try {
    const conditions = profileId
      ? sql`WHERE ${promptInjectionLog.profileId} = ${profileId}`
      : sql``;

    const totalResult = await db.select({ value: count() })
      .from(promptInjectionLog)
      .where(profileId ? sql`${promptInjectionLog.profileId} = ${profileId}` : undefined);

    const last24hResult = await db.select({ value: count() })
      .from(promptInjectionLog)
      .where(
        profileId
          ? sql`${promptInjectionLog.profileId} = ${profileId} AND ${promptInjectionLog.createdAt} > NOW() - INTERVAL '24 hours'`
          : sql`${promptInjectionLog.createdAt} > NOW() - INTERVAL '24 hours'`
      );

    const topPatternsResult = await db.select({
      pattern: promptInjectionLog.matchedPattern,
      count: count(),
    })
      .from(promptInjectionLog)
      .where(profileId ? sql`${promptInjectionLog.profileId} = ${profileId}` : undefined)
      .groupBy(promptInjectionLog.matchedPattern)
      .orderBy(desc(count()))
      .limit(10);

    return {
      total: Number(totalResult[0]?.value ?? 0),
      last24h: Number(last24hResult[0]?.value ?? 0),
      topPatterns: topPatternsResult.map(r => ({
        pattern: r.pattern,
        count: Number(r.count),
      })),
    };
  } catch (err: any) {
    console.error('[PromptInjectionLog] Stats query failed:', err.message);
    return { total: 0, last24h: 0, topPatterns: [] };
  }
}
