/**
 * Message Quality Metrics (US-431)
 *
 * Aggregates daily metrics: messages_sent, opt_out_events, block_events per profile.
 * Alerts admins when opt-out rate exceeds configurable threshold.
 */
import { db } from './db.js';
import { rainbowMessages, messageQualityMetrics, optOuts } from '../../shared/schema.js';
import { sql, eq, and, gte, lte, desc } from 'drizzle-orm';

// ─── In-memory block event counter (incremented from Baileys events) ──
const blockCounts = new Map<string, number>(); // key: profileId

export function trackBlockEvent(profileId: string = 'pelangi'): void {
  blockCounts.set(profileId, (blockCounts.get(profileId) || 0) + 1);
}

function consumeBlockCounts(): Map<string, number> {
  const snapshot = new Map(blockCounts);
  blockCounts.clear();
  return snapshot;
}

// ─── In-memory opt-out event counter ──────────────────────────────────
const optOutCounts = new Map<string, number>(); // key: profileId

export function trackOptOutEvent(profileId: string = 'pelangi'): void {
  optOutCounts.set(profileId, (optOutCounts.get(profileId) || 0) + 1);
}

function consumeOptOutCounts(): Map<string, number> {
  const snapshot = new Map(optOutCounts);
  optOutCounts.clear();
  return snapshot;
}

// ─── Daily Aggregation Job ────────────────────────────────────────────

/** Aggregate metrics for the previous 24h period and store in DB */
export async function aggregateDailyMetrics(): Promise<void> {
  const now = new Date();
  // Bucket = start of today (UTC)
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  try {
    // Count outbound messages per profile for the day
    const sentCounts = await db
      .select({
        profileId: rainbowMessages.profileId,
        count: sql<number>`count(*)::int`,
      })
      .from(rainbowMessages)
      .where(
        and(
          eq(rainbowMessages.role, 'assistant'),
          gte(rainbowMessages.timestamp, dayStart),
          lte(rainbowMessages.timestamp, dayEnd),
        )
      )
      .groupBy(rainbowMessages.profileId);

    // Consume in-memory counters
    const blocks = consumeBlockCounts();
    const optOuts = consumeOptOutCounts();

    // Collect all profile IDs from all sources
    const profileIds = new Set<string>();
    for (const row of sentCounts) profileIds.add(row.profileId ?? 'pelangi');
    for (const pid of blocks.keys()) profileIds.add(pid);
    for (const pid of optOuts.keys()) profileIds.add(pid);

    if (profileIds.size === 0) {
      console.log('[QualityMetrics] No activity to aggregate');
      return;
    }

    for (const profileId of profileIds) {
      const messagesSent = sentCounts.find(r => (r.profileId ?? 'pelangi') === profileId)?.count ?? 0;
      const optOutEvents = optOuts.get(profileId) ?? 0;
      const blockEvents = blocks.get(profileId) ?? 0;
      const optOutRate = messagesSent > 0 ? optOutEvents / messagesSent : 0;

      // Upsert metrics for this profile+date
      await db.insert(messageQualityMetrics)
        .values({
          profileId,
          date: dayStart,
          messagesSent,
          optOutEvents,
          blockEvents,
          optOutRate,
        })
        .onConflictDoUpdate({
          target: [messageQualityMetrics.profileId, messageQualityMetrics.date],
          set: {
            messagesSent,
            optOutEvents,
            blockEvents,
            optOutRate,
            updatedAt: new Date(),
          },
        });

      console.log(
        `[QualityMetrics] ${profileId}: sent=${messagesSent} optOuts=${optOutEvents} blocks=${blockEvents} rate=${(optOutRate * 100).toFixed(2)}%`
      );

      // Check threshold alert
      if (optOutRate > 0) {
        await checkOptOutAlert(profileId, optOutRate, messagesSent, optOutEvents);
      }
    }
  } catch (error) {
    console.error('[QualityMetrics] Aggregation failed:', error);
  }
}

// ─── Alert Check ──────────────────────────────────────────────────────

const DEFAULT_OPT_OUT_THRESHOLD = 0.02; // 2%

async function checkOptOutAlert(
  profileId: string,
  rate: number,
  sent: number,
  optOuts: number,
): Promise<void> {
  // Dynamically import settings to avoid circular deps
  let threshold = DEFAULT_OPT_OUT_THRESHOLD;
  try {
    const { configStore } = await import('../assistant/config-store.js');
    const settings = configStore.getSettings();
    if ((settings as any)?.qualityAlerts?.optOutRateThreshold) {
      threshold = (settings as any).qualityAlerts.optOutRateThreshold;
    }
  } catch {
    // Use default threshold
  }

  if (rate >= threshold) {
    const pct = (rate * 100).toFixed(2);
    const threshPct = (threshold * 100).toFixed(1);
    console.warn(
      `[QualityMetrics] ⚠️ ALERT: ${profileId} opt-out rate ${pct}% exceeds threshold ${threshPct}% ` +
      `(${optOuts} opt-outs / ${sent} messages)`
    );

    // Fire webhook if configured
    try {
      const { configStore } = await import('../assistant/config-store.js');
      const settings = configStore.getSettings();
      const webhookUrl = (settings as any)?.qualityAlerts?.webhookUrl;
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'quality_alert',
            profileId,
            optOutRate: rate,
            threshold,
            messagesSent: sent,
            optOutEvents: optOuts,
            timestamp: new Date().toISOString(),
          }),
        }).catch(err => console.error('[QualityMetrics] Webhook failed:', err.message));
      }
    } catch {
      // Webhook is optional
    }
  }
}

// ─── Query Functions (for Admin API) ──────────────────────────────────

export async function getQualityMetrics(
  profileId: string,
  days: number = 7,
): Promise<Array<{
  date: Date;
  messagesSent: number;
  optOutEvents: number;
  blockEvents: number;
  optOutRate: number | null;
}>> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      date: messageQualityMetrics.date,
      messagesSent: messageQualityMetrics.messagesSent,
      optOutEvents: messageQualityMetrics.optOutEvents,
      blockEvents: messageQualityMetrics.blockEvents,
      optOutRate: messageQualityMetrics.optOutRate,
    })
    .from(messageQualityMetrics)
    .where(
      and(
        eq(messageQualityMetrics.profileId, profileId),
        gte(messageQualityMetrics.date, since),
      )
    )
    .orderBy(desc(messageQualityMetrics.date));

  return rows;
}

// ─── Scheduler ────────────────────────────────────────────────────────

let metricsTimer: ReturnType<typeof setInterval> | null = null;
const AGGREGATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export function startQualityMetricsJob(): void {
  if (metricsTimer) return;

  // Run once on startup (delayed 30s to let other systems initialize)
  setTimeout(() => {
    aggregateDailyMetrics().catch(err =>
      console.error('[QualityMetrics] Initial aggregation failed:', err)
    );
  }, 30_000);

  // Then every 24h
  metricsTimer = setInterval(() => {
    aggregateDailyMetrics().catch(err =>
      console.error('[QualityMetrics] Scheduled aggregation failed:', err)
    );
  }, AGGREGATION_INTERVAL_MS);

  console.log('[QualityMetrics] Daily aggregation job started');
}

export function stopQualityMetricsJob(): void {
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
}
