/**
 * data-retention.ts — Configurable conversation data retention (US-419)
 *
 * GDPR Article 5(1)(e) compliance: soft-deletes messages/conversations older
 * than the configured retention window, then hard-deletes after a grace period.
 *
 * Retention config (settings.json, profile-specific):
 *   retention.enabled         — toggle (default: true)
 *   retention.retention_days  — soft-delete cutoff (default: 90)
 *   retention.grace_period_days — hard-delete cutoff after soft-delete (default: 30)
 */

import cron from 'node-cron';
import { db, pool, dbReady, deleteExpiredConversations } from './db.js';
import { rainbowMessages, rainbowConversations, promptInjectionEvents, dpaRegistry } from '../../shared/schema-tables.js';
import { lt, lte, gt, eq, isNull, isNotNull, and, sql } from 'drizzle-orm';
import { configStore } from '../assistant/config-store.js';
import { profileRegistry } from '../assistant/profile-registry.js';
import { pruneRawEvents } from './webhook-raw-events.js';
import { notifyAdminDpaExpiry } from './admin-notifier.js';

// ─── Config ──────────────────────────────────────────────────────────

interface RetentionConfig {
  enabled: boolean;
  retentionDays: number;
  gracePeriodDays: number;
}

function getRetentionConfig(store?: typeof configStore): RetentionConfig {
  const s = store ?? configStore;
  const settings = s.getSettings();
  const retention = (settings as any).retention;
  return {
    enabled: retention?.enabled ?? true,
    retentionDays: retention?.retention_days ?? 730, // US-907: PDPA 2024 default 24 months
    gracePeriodDays: retention?.grace_period_days ?? 30,
  };
}

// ─── Stats ───────────────────────────────────────────────────────────

export interface RetentionStats {
  retention_days: number;
  grace_period_days: number;
  cutoff_date: string;
  hard_cutoff_date: string;
  messages: {
    eligible_soft_delete: number;
    eligible_hard_delete: number;
  };
  conversations: {
    eligible_soft_delete: number;
    eligible_hard_delete: number;
  };
}

export async function getRetentionStats(profileId?: string): Promise<RetentionStats> {
  const store = profileId
    ? profileRegistry.isInitialized()
      ? profileRegistry.getProfile(profileId)?.configStore
      : undefined
    : undefined;
  const config = getRetentionConfig(store);

  const now = Date.now();
  const cutoffDate = new Date(now - config.retentionDays * 86_400_000);
  const hardCutoffDate = new Date(now - (config.retentionDays + config.gracePeriodDays) * 86_400_000);

  const [msgSoft] = await db
    .select({ count: sql<number>`count(*)` })
    .from(rainbowMessages)
    .where(and(lt(rainbowMessages.timestamp, cutoffDate), isNull(rainbowMessages.deletedAt)));

  const [msgHard] = await db
    .select({ count: sql<number>`count(*)` })
    .from(rainbowMessages)
    .where(and(isNotNull(rainbowMessages.deletedAt), lt(rainbowMessages.deletedAt, hardCutoffDate)));

  const [convSoft] = await db
    .select({ count: sql<number>`count(*)` })
    .from(rainbowConversations)
    .where(and(lt(rainbowConversations.updatedAt, cutoffDate), isNull(rainbowConversations.deletedAt)));

  const [convHard] = await db
    .select({ count: sql<number>`count(*)` })
    .from(rainbowConversations)
    .where(and(isNotNull(rainbowConversations.deletedAt), lt(rainbowConversations.deletedAt, hardCutoffDate)));

  return {
    retention_days: config.retentionDays,
    grace_period_days: config.gracePeriodDays,
    cutoff_date: cutoffDate.toISOString(),
    hard_cutoff_date: hardCutoffDate.toISOString(),
    messages: {
      eligible_soft_delete: Number(msgSoft?.count ?? 0),
      eligible_hard_delete: Number(msgHard?.count ?? 0),
    },
    conversations: {
      eligible_soft_delete: Number(convSoft?.count ?? 0),
      eligible_hard_delete: Number(convHard?.count ?? 0),
    },
  };
}

// ─── Disposal Confirmation Report (US-907) ──────────────────────────

async function ensureDisposalReportTable(): Promise<void> {
  const ready = await dbReady;
  if (!ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pdpa_disposal_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      profile TEXT NOT NULL DEFAULT 'pelangi',
      messages_disposed INTEGER NOT NULL DEFAULT 0,
      conversations_disposed INTEGER NOT NULL DEFAULT 0,
      cutoff_date TIMESTAMPTZ NOT NULL,
      retention_days INTEGER NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      generated_by TEXT NOT NULL DEFAULT 'system:retention-scheduler'
    )
  `);
}

// Initialize table on module load
dbReady.then(ok => { if (ok) ensureDisposalReportTable().catch(() => {}); });

/**
 * Generate and archive a disposal confirmation report before hard-deleting records.
 * Required by PDPA 2024 Amendment for audit compliance.
 */
async function archiveDisposalReport(
  profile: string,
  messagesCount: number,
  conversationsCount: number,
  cutoffDate: Date,
  retentionDays: number,
  generatedBy: string = 'system:retention-scheduler'
): Promise<string | null> {
  if (messagesCount === 0 && conversationsCount === 0) return null;

  try {
    const result = await pool.query(
      `INSERT INTO pdpa_disposal_reports
         (profile, messages_disposed, conversations_disposed, cutoff_date, retention_days, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [profile, messagesCount, conversationsCount, cutoffDate, retentionDays, generatedBy]
    );
    const reportId = result.rows[0]?.id;
    console.log(`[PDPA] Disposal report archived: ${reportId} — ${messagesCount} msgs, ${conversationsCount} convs`);
    return reportId;
  } catch (err: any) {
    console.error('[PDPA] Failed to archive disposal report:', err.message);
    return null;
  }
}

// ─── Purge ───────────────────────────────────────────────────────────

export interface PurgeResult {
  profile: string;
  records_deleted: {
    messages_soft: number;
    messages_hard: number;
    conversations_soft: number;
    conversations_hard: number;
  };
  cutoff_date: string;
  hard_cutoff_date: string;
  timestamp: string;
  disposal_report_id?: string | null;
}

export async function runRetentionPurge(profileId?: string): Promise<PurgeResult> {
  const store = profileId
    ? profileRegistry.isInitialized()
      ? profileRegistry.getProfile(profileId)?.configStore
      : undefined
    : undefined;
  const config = getRetentionConfig(store);

  if (!config.enabled) {
    const profile = profileId ?? 'pelangi';
    const result: PurgeResult = {
      profile,
      records_deleted: { messages_soft: 0, messages_hard: 0, conversations_soft: 0, conversations_hard: 0 },
      cutoff_date: new Date().toISOString(),
      hard_cutoff_date: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify({ event: 'data_retention_purge_skipped', ...result }));
    return result;
  }

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - config.retentionDays * 86_400_000);
  const hardCutoffDate = new Date(now.getTime() - (config.retentionDays + config.gracePeriodDays) * 86_400_000);

  // 1. Soft-delete messages older than retention_days
  const softMessages = await db
    .update(rainbowMessages)
    .set({ deletedAt: now })
    .where(and(lt(rainbowMessages.timestamp, cutoffDate), isNull(rainbowMessages.deletedAt)))
    .returning({ id: rainbowMessages.id });

  // 2. Count records eligible for hard-delete (for disposal report)
  const [hardMsgCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(rainbowMessages)
    .where(and(isNotNull(rainbowMessages.deletedAt), lt(rainbowMessages.deletedAt, hardCutoffDate)));
  const [hardConvCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(rainbowConversations)
    .where(and(isNotNull(rainbowConversations.deletedAt), lt(rainbowConversations.deletedAt, hardCutoffDate)));

  const pendingHardMsgs = Number(hardMsgCount?.count ?? 0);
  const pendingHardConvs = Number(hardConvCount?.count ?? 0);

  // US-907: Generate disposal confirmation report BEFORE hard-deleting
  const profile = profileId ?? 'pelangi';
  const disposalReportId = await archiveDisposalReport(
    profile,
    pendingHardMsgs,
    pendingHardConvs,
    hardCutoffDate,
    config.retentionDays,
  );

  // 3. Hard-delete messages past the grace period
  const hardMessages = await db
    .delete(rainbowMessages)
    .where(and(isNotNull(rainbowMessages.deletedAt), lt(rainbowMessages.deletedAt, hardCutoffDate)))
    .returning({ id: rainbowMessages.id });

  // 4. Soft-delete conversations not updated within retention_days
  const softConversations = await db
    .update(rainbowConversations)
    .set({ deletedAt: now })
    .where(and(lt(rainbowConversations.updatedAt, cutoffDate), isNull(rainbowConversations.deletedAt)))
    .returning({ phone: rainbowConversations.phone });

  // 5. Hard-delete conversations past the grace period
  const hardConversations = await db
    .delete(rainbowConversations)
    .where(and(isNotNull(rainbowConversations.deletedAt), lt(rainbowConversations.deletedAt, hardCutoffDate)))
    .returning({ phone: rainbowConversations.phone });

  // 6. US-998: Purge prompt injection events older than retention_days
  let injectionEventsPurged = 0;
  try {
    const purgedInjections = await db
      .delete(promptInjectionEvents)
      .where(lt(promptInjectionEvents.createdAt, cutoffDate))
      .returning({ id: promptInjectionEvents.id });
    injectionEventsPurged = purgedInjections.length;
    if (injectionEventsPurged > 0) {
      console.log(`[DataRetention] Purged ${injectionEventsPurged} prompt injection events older than ${cutoffDate.toISOString()}`);
    }
  } catch (err: any) {
    console.error('[DataRetention] Failed to purge injection events:', err.message);
  }

  const result: PurgeResult = {
    profile,
    records_deleted: {
      messages_soft: softMessages.length,
      messages_hard: hardMessages.length,
      conversations_soft: softConversations.length,
      conversations_hard: hardConversations.length,
    },
    cutoff_date: cutoffDate.toISOString(),
    hard_cutoff_date: hardCutoffDate.toISOString(),
    timestamp: now.toISOString(),
    disposal_report_id: disposalReportId,
  };

  // Structured log as required by AC
  console.log(JSON.stringify({ event: 'data_retention_purge', ...result }));

  return result;
}

// ─── DPA Expiry Check (US-958) ───────────────────────────────────────

async function checkDpaExpiry(): Promise<void> {
  const ready = await dbReady;
  if (!ready) return;

  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const expiring = await db.select()
    .from(dpaRegistry)
    .where(and(
      eq(dpaRegistry.dpaStatus, 'signed'),
      lte(dpaRegistry.dpaExpiryDate, thirtyDaysFromNow),
      gt(dpaRegistry.dpaExpiryDate, now)
    ));

  for (const entry of expiring) {
    if (!entry.dpaExpiryDate) continue;
    const daysRemaining = Math.ceil((entry.dpaExpiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    console.log(`[DataRetention] DPA expiring soon: ${entry.vendorName} (${daysRemaining} days remaining)`);
    await notifyAdminDpaExpiry(entry.vendorName, entry.dpaExpiryDate, daysRemaining);
  }

  if (expiring.length > 0) {
    console.log(`[DataRetention] ${expiring.length} vendor DPA(s) expiring within 30 days`);
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────

export function startRetentionScheduler(): void {
  // Run nightly at 3:00 AM MYT
  cron.schedule('0 3 * * *', async () => {
    console.log('[DataRetention] Running nightly retention purge...');
    try {
      const result = await runRetentionPurge();
      console.log(`[DataRetention] Purge complete — messages: ${result.records_deleted.messages_soft} soft / ${result.records_deleted.messages_hard} hard deleted`);
    } catch (err: any) {
      console.error('[DataRetention] Purge failed:', err.message);
    }
    // US-895: Prune processed raw webhook events older than 30 days
    try {
      const pruned = await pruneRawEvents(30);
      if (pruned > 0) {
        console.log(`[DataRetention] Pruned ${pruned} processed raw webhook events`);
      }
    } catch (err: any) {
      console.error('[DataRetention] Raw event prune failed:', err.message);
    }
    // US-958: Check for DPA expiry within 30 days and alert admin
    try {
      await checkDpaExpiry();
    } catch (err: any) {
      console.error('[DataRetention] DPA expiry check failed:', err.message);
    }
  }, {
    timezone: 'Asia/Kuala_Lumpur',
  });

  console.log('[DataRetention] Nightly retention scheduler started (3:00 AM MYT)');

  // US-157: Legal hold archival deletion (7 years) — runs daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    const ready = await dbReady;
    if (!ready) {
      console.warn('[DataRetention] Skipping archival purge — database not ready');
      return;
    }

    console.log('[DataRetention] Running archival purge (7-year legal hold)...');
    try {
      const store = configStore;
      const settings = (store.getSettings() as any).retention;
      const archivalDays = settings?.archival_retention_days ?? 2555; // Default 7 years
      const result = await deleteExpiredConversations(archivalDays);
      console.log(JSON.stringify({ event: 'archival_purge', ...result }));
    } catch (err: any) {
      console.error('[DataRetention] Archival purge failed:', err.message);
    }
  }, {
    timezone: 'Asia/Kuala_Lumpur',
  });

  console.log('[DataRetention] Archival purge scheduler started (2:00 AM MYT, 7-year legal hold)');
}
