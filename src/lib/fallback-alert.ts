/**
 * Fallback Rate Alert (US-814)
 *
 * Daily scheduled check: if unknownFallback intent fires for >20% of messages
 * in the last 24h for any profile, sends a WhatsApp alert to the configured
 * recipient and logs the event to fallback_alert_logs.
 *
 * Settings per profile (in settings.json under "fallbackAlert"):
 *   enabled    boolean  — master on/off (default: true)
 *   threshold  number   — decimal fraction, e.g. 0.20 = 20% (default: 0.20)
 *   recipient  string   — phone number to notify (default: system admin phone)
 */
import { pool, db, dbReady } from './db.js';
import { rainbowMessages } from '../../shared/schema.js';
import { sql, and, gte, eq } from 'drizzle-orm';
import { sendWhatsAppMessage, getWhatsAppStatus } from './baileys-client.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('fallback-alert');

const DEFAULT_THRESHOLD = 0.20; // 20%
const DEFAULT_RECIPIENT = '60127088789';
const MIN_MESSAGES_TO_ALERT = 5; // don't alert on tiny volumes

// ─── Alert History Table ──────────────────────────────────────────────

export async function ensureFallbackAlertTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fallback_alert_logs (
        id SERIAL PRIMARY KEY,
        profile_id TEXT NOT NULL,
        fallback_rate NUMERIC(6,2) NOT NULL,
        unknown_messages INT NOT NULL,
        total_messages INT NOT NULL,
        threshold NUMERIC(6,2) NOT NULL,
        alerted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    logger.info('fallback_alert_logs table ready');
  } catch (err: any) {
    logger.warn('Table ensure failed (non-fatal)', { error: err.message });
  }
}

// ─── Settings ─────────────────────────────────────────────────────────

interface FallbackAlertSettings {
  enabled: boolean;
  threshold: number;
  recipient: string;
}

async function loadFallbackAlertSettings(profileId: string): Promise<FallbackAlertSettings> {
  try {
    const { profileRegistry } = await import('../assistant/profile-registry.js');
    let settings: any;
    if (profileRegistry.isInitialized()) {
      const profile = profileRegistry.getProfile(profileId);
      settings = profile ? profile.configStore.getSettings() : null;
    }
    if (!settings) {
      const { configStore } = await import('../assistant/config-store.js');
      settings = configStore.getSettings();
    }
    const cfg = (settings as any)?.fallbackAlert;
    return {
      enabled: cfg?.enabled !== false,
      threshold: typeof cfg?.threshold === 'number' ? cfg.threshold : DEFAULT_THRESHOLD,
      recipient: cfg?.recipient || DEFAULT_RECIPIENT,
    };
  } catch {
    return { enabled: true, threshold: DEFAULT_THRESHOLD, recipient: DEFAULT_RECIPIENT };
  }
}

// ─── Core Check ───────────────────────────────────────────────────────

export interface FallbackCheckResult {
  profileId: string;
  fallbackRate: number;
  unknownMessages: number;
  totalMessages: number;
  threshold: number;
  alerted: boolean;
}

export async function checkFallbackRateForProfile(profileId: string): Promise<FallbackCheckResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [row] = await db
    .select({
      totalUserMessages: sql<number>`count(*) filter (where ${rainbowMessages.role} = 'user')::int`,
      unknownMessages: sql<number>`count(*) filter (where ${rainbowMessages.role} = 'user' and (${rainbowMessages.intent} = 'unknown' or ${rainbowMessages.intent} = 'unknown_intent'))::int`,
    })
    .from(rainbowMessages)
    .where(and(
      gte(rainbowMessages.timestamp, since),
      eq(rainbowMessages.profileId, profileId),
    ));

  const total = row?.totalUserMessages ?? 0;
  const unknown = row?.unknownMessages ?? 0;
  const rate = total > 0 ? unknown / total : 0;

  const settings = await loadFallbackAlertSettings(profileId);
  const threshold = settings.threshold;
  const exceeded = total >= MIN_MESSAGES_TO_ALERT && rate > threshold;

  // Log to fallback_alert_logs
  try {
    await pool.query(
      `INSERT INTO fallback_alert_logs (profile_id, fallback_rate, unknown_messages, total_messages, threshold, alerted)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [profileId, parseFloat((rate * 100).toFixed(2)), unknown, total, parseFloat((threshold * 100).toFixed(2)), exceeded]
    );
  } catch (err: any) {
    logger.warn('Failed to log alert history', { error: err.message });
  }

  let alerted = false;
  if (settings.enabled && exceeded) {
    const pct = (rate * 100).toFixed(1);
    const threshPct = (threshold * 100).toFixed(0);
    const message =
      `⚠️ *Fallback Rate Alert — ${profileId}*\n\n` +
      `AI misunderstanding rate is *${pct}%* (threshold: ${threshPct}%)\n\n` +
      `📊 Stats (last 24h):\n` +
      `  • Unmatched messages: ${unknown}\n` +
      `  • Total user messages: ${total}\n` +
      `  • Fallback rate: *${pct}%*\n\n` +
      `💡 Review intent coverage gaps:\n` +
      `Admin → Intent Manager → Gaps\n\n` +
      `🕐 ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

    try {
      const status = getWhatsAppStatus();
      if (status.state === 'open') {
        await sendWhatsAppMessage(settings.recipient, message);
        alerted = true;
        logger.info('Sent fallback rate alert', { profileId, pct, unknown, total });
      } else {
        logger.warn('WhatsApp not connected — fallback alert not sent', { profileId });
      }
    } catch (err: any) {
      logger.error('Failed to send fallback alert', { error: err.message });
    }
  } else if (!exceeded) {
    logger.info('Fallback rate within threshold', {
      profileId,
      rate: `${(rate * 100).toFixed(1)}%`,
      threshold: `${(threshold * 100).toFixed(0)}%`,
    });
  } else {
    logger.info('Fallback alert disabled for profile', { profileId });
  }

  return {
    profileId,
    fallbackRate: parseFloat((rate * 100).toFixed(2)),
    unknownMessages: unknown,
    totalMessages: total,
    threshold: parseFloat((threshold * 100).toFixed(0)),
    alerted,
  };
}

export async function runDailyFallbackCheck(): Promise<FallbackCheckResult[]> {
  const isConnected = await dbReady;
  if (!isConnected) {
    logger.warn('Database not available — skipping fallback rate check');
    return [];
  }

  try {
    const { profileRegistry } = await import('../assistant/profile-registry.js');
    let profileIds: string[];
    if (profileRegistry.isInitialized()) {
      profileIds = profileRegistry.listProfiles().map(p => p.id);
    } else {
      profileIds = ['pelangi'];
    }
    if (profileIds.length === 0) profileIds = ['pelangi'];

    const results: FallbackCheckResult[] = [];
    for (const profileId of profileIds) {
      const result = await checkFallbackRateForProfile(profileId);
      results.push(result);
    }
    return results;
  } catch (err: any) {
    logger.error('Daily fallback check failed', { error: err.message });
    return [];
  }
}

// ─── Alert History Query ──────────────────────────────────────────────

export async function getFallbackAlertHistory(
  profileId?: string,
  limit: number = 30,
): Promise<Array<{
  id: number;
  profileId: string;
  fallbackRate: number;
  unknownMessages: number;
  totalMessages: number;
  threshold: number;
  alerted: boolean;
  createdAt: Date;
}>> {
  try {
    const query = profileId
      ? `SELECT id, profile_id, fallback_rate, unknown_messages, total_messages, threshold, alerted, created_at
         FROM fallback_alert_logs WHERE profile_id = $1 ORDER BY created_at DESC LIMIT $2`
      : `SELECT id, profile_id, fallback_rate, unknown_messages, total_messages, threshold, alerted, created_at
         FROM fallback_alert_logs ORDER BY created_at DESC LIMIT $1`;
    const params = profileId ? [profileId, limit] : [limit];
    const { rows } = await pool.query(query, params);
    return rows.map((r: any) => ({
      id: r.id,
      profileId: r.profile_id,
      fallbackRate: parseFloat(r.fallback_rate),
      unknownMessages: r.unknown_messages,
      totalMessages: r.total_messages,
      threshold: parseFloat(r.threshold),
      alerted: r.alerted,
      createdAt: r.created_at,
    }));
  } catch (err: any) {
    logger.warn('Failed to query alert history', { error: err.message });
    return [];
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────

let alertTimeoutId: ReturnType<typeof setTimeout> | null = null;
let alertIntervalId: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function msUntilNext8AM(): number {
  const now = new Date();
  const next = new Date();
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startFallbackAlertScheduler(): void {
  if (alertTimeoutId || alertIntervalId) return;

  // Ensure table exists (fire and forget)
  ensureFallbackAlertTable().catch(() => {});

  const delay = msUntilNext8AM();
  logger.info(`Fallback alert scheduler: first run in ${Math.round(delay / 60000)} minutes (at 8AM)`);

  alertTimeoutId = setTimeout(() => {
    alertTimeoutId = null;
    runDailyFallbackCheck().catch(err =>
      logger.error('Scheduled fallback check failed', { error: err.message })
    );
    // Repeat every 24h
    alertIntervalId = setInterval(() => {
      runDailyFallbackCheck().catch(err =>
        logger.error('Scheduled fallback check failed', { error: err.message })
      );
    }, INTERVAL_MS);
  }, delay);
}

export function stopFallbackAlertScheduler(): void {
  if (alertTimeoutId) { clearTimeout(alertTimeoutId); alertTimeoutId = null; }
  if (alertIntervalId) { clearInterval(alertIntervalId); alertIntervalId = null; }
}
