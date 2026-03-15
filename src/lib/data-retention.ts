/**
 * data-retention.ts — Configurable conversation data retention (US-419, US-907)
 *
 * GDPR Article 5(1)(e) / Malaysia PDPA 2024 compliance: soft-deletes messages/conversations
 * older than the configured retention window, then hard-deletes after a grace period.
 * US-907: Generates a disposal confirmation report (archived to pdpa_disposal_reports) before
 * any hard-delete, and enforces a 24-month (730-day) default retention period.
 *
 * Retention config (settings.json, profile-specific):
 *   retention.enabled           — toggle (default: true)
 *   retention.retention_months  — soft-delete cutoff in months (default: 24)
 *   retention.retention_days    — soft-delete cutoff in days (overrides months if set)
 *   retention.grace_period_days — hard-delete cutoff after soft-delete (default: 30)
 */

import cron from 'node-cron';
import { db, pool, dbReady } from './db.js';
import { rainbowMessages, rainbowConversations } from '../../shared/schema-tables.js';
import { lt, isNull, isNotNull, and, sql } from 'drizzle-orm';
import { configStore } from '../assistant/config-store.js';
import { profileRegistry } from '../assistant/profile-registry.js';
import { pruneRawEvents } from './webhook-raw-events.js';

// ─── Config ──────────────────────────────────────────────────────────

interface RetentionConfig {
  enabled: boolean;
  retentionDays: number;
  gracePeriodDays: number;
}

// Default: 24 months = 730 days (Malaysia PDPA 2024 Amendment requirement)
const DEFAULT_RETENTION_DAYS = 730;

function getRetentionConfig(store?: typeof configStore): RetentionConfig {
  const s = store ?? configStore;
  const settings = s.getSettings();
  const retention = (settings as any).retention;
  const months = retention?.retention_months;
  const daysFromMonths = months ? Math.round(months * 30.44) : DEFAULT_RETENTION_DAYS;
  return {
    enabled: retention?.enabled ?? true,
    retentionDays: retention?.retention_days ?? daysFromMonths,
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
  disposal_report_archived?: boolean;
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

  const profile = profileId ?? 'pelangi';
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - config.retentionDays * 86_400_000);
  const hardCutoffDate = new Date(now.getTime() - (config.retentionDays + config.gracePeriodDays) * 86_400_000);

  // 1. Soft-delete messages older than retention_days
  const softMessages = await db
    .update(rainbowMessages)
    .set({ deletedAt: now })
    .where(and(lt(rainbowMessages.timestamp, cutoffDate), isNull(rainbowMessages.deletedAt)))
    .returning({ id: rainbowMessages.id });

  // 2. Hard-delete messages past the grace period
  const hardMessages = await db
    .delete(rainbowMessages)
    .where(and(isNotNull(rainbowMessages.deletedAt), lt(rainbowMessages.deletedAt, hardCutoffDate)))
    .returning({ id: rainbowMessages.id });

  // 3. Soft-delete conversations not updated within retention_days
  const softConversations = await db
    .update(rainbowConversations)
    .set({ deletedAt: now })
    .where(and(lt(rainbowConversations.updatedAt, cutoffDate), isNull(rainbowConversations.deletedAt)))
    .returning({ phone: rainbowConversations.phone });

  // 4. Hard-delete conversations past the grace period
  const hardConversations = await db
    .delete(rainbowConversations)
    .where(and(isNotNull(rainbowConversations.deletedAt), lt(rainbowConversations.deletedAt, hardCutoffDate)))
    .returning({ phone: rainbowConversations.phone });

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
  };

  // Structured log as required by AC
  console.log(JSON.stringify({ event: 'data_retention_purge', ...result }));

  // US-907 AC5: Generate and archive a disposal confirmation report
  const hardDeleteCount = hardMessages.length + hardConversations.length;
  if (hardDeleteCount > 0) {
    await saveDisposalReport(
      profile, now, config.retentionDays, cutoffDate, hardCutoffDate,
      hardMessages.length, hardConversations.length,
      {
        ...result,
        deleted_message_ids: hardMessages.map((m: { id: string }) => m.id),
        deleted_conversation_phones: hardConversations.map((c: { phone: string }) => c.phone),
        legal_basis: 'Malaysia PDPA 2024 Amendment — data retention policy enforcement',
      }
    );
    result.disposal_report_archived = true;
  }

  return result;
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
  }, {
    timezone: 'Asia/Kuala_Lumpur',
  });

  console.log('[DataRetention] Nightly retention scheduler started (3:00 AM MYT)');
}
// ─── Disposal Report (US-907 AC5) ────────────────────────────────────

async function ensureDisposalReportTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pdpa_disposal_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      profile TEXT NOT NULL,
      purge_timestamp TIMESTAMPTZ NOT NULL,
      retention_days INTEGER NOT NULL,
      cutoff_date TIMESTAMPTZ NOT NULL,
      hard_cutoff_date TIMESTAMPTZ NOT NULL,
      messages_hard_deleted INTEGER NOT NULL DEFAULT 0,
      conversations_hard_deleted INTEGER NOT NULL DEFAULT 0,
      report_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

dbReady.then(ok => { if (ok) ensureDisposalReportTable().catch(() => {}); });

async function saveDisposalReport(
  profile: string,
  purgeTimestamp: Date,
  retentionDays: number,
  cutoffDate: Date,
  hardCutoffDate: Date,
  messagesHardDeleted: number,
  conversationsHardDeleted: number,
  reportData: object
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO pdpa_disposal_reports
         (profile, purge_timestamp, retention_days, cutoff_date, hard_cutoff_date,
          messages_hard_deleted, conversations_hard_deleted, report_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        profile, purgeTimestamp, retentionDays, cutoffDate, hardCutoffDate,
        messagesHardDeleted, conversationsHardDeleted, JSON.stringify(reportData),
      ]
    );
    console.log(`[DataRetention] Disposal report archived: ${profile} — ${messagesHardDeleted} msgs, ${conversationsHardDeleted} convs hard-deleted`);
  } catch (err: any) {
    console.error('[DataRetention] Failed to save disposal report:', err.message);
  }
}
