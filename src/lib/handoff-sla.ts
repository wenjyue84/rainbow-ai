/**
 * handoff-sla.ts — Human handoff SLA timer with breach alerts (US-836)
 *
 * When a conversation is escalated to human handoff, a cron job monitors
 * whether a human responds within the configurable SLA window.
 * If no outbound message is detected within that window, an admin alert fires.
 *
 * SLA state is persisted in escalation_events DB, so it survives restarts.
 * Cron runs every 2 minutes (not setTimeout) for crash-recovery safety.
 */
import { pool } from './db.js';
import { sendWhatsAppMessage, getWhatsAppStatus } from './baileys-client.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('handoff-sla');

const DEFAULT_SLA_MINUTES = 15;
const CRON_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const ADMIN_PHONE = process.env.SLA_ALERT_PHONE || '60127088789';

let cronIntervalId: ReturnType<typeof setInterval> | null = null;

// ─── Human response detection ─────────────────────────────────────────

/**
 * Mark a guest as having received a human reply.
 * Called from escalation.ts when staff sends an outbound message to a guest.
 * Updates human_responded_at on the most recent open escalation for that JID.
 */
export async function markHumanResponded(guestJid: string): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE escalation_events
       SET human_responded_at = NOW()
       WHERE jid = $1
         AND human_responded_at IS NULL
         AND sla_breached_at IS NULL
       RETURNING id`,
      [guestJid]
    );
    if (result.rowCount && result.rowCount > 0) {
      logger.info(`Human response recorded — SLA timer cancelled`, { jid: guestJid, updatedRows: result.rowCount });
    }
  } catch (err: any) {
    logger.warn(`Failed to mark human responded`, { jid: guestJid, error: err.message });
  }
}

// ─── SLA breach detection ─────────────────────────────────────────────

interface OpenEscalation {
  id: number;
  jid: string;
  profileId: string;
  createdAt: Date;
  metadata: string | null;
  slaDurationMinutes: number;
  minutesWaiting: number;
  lastUserMessage: string | null;
}

async function getOpenEscalations(slaDurationMinutes: number): Promise<OpenEscalation[]> {
  const result = await pool.query<{
    id: number;
    jid: string;
    profile_id: string;
    created_at: Date;
    metadata: string | null;
    minutes_waiting: number;
    last_user_message: string | null;
  }>(
    `SELECT
       e.id,
       e.jid,
       e.profile_id,
       e.created_at,
       e.metadata,
       (julianday('now') - julianday(e.created_at)) * 1440.0 AS minutes_waiting,
       (
         SELECT content
         FROM rainbow_messages
         WHERE phone = e.jid
           AND role = 'user'
           AND timestamp >= e.created_at
         ORDER BY timestamp DESC
         LIMIT 1
       ) AS last_user_message
     FROM escalation_events e
     WHERE e.sla_breached_at IS NULL
       AND e.human_responded_at IS NULL
       AND e.created_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || $1 || ' minutes')
       AND NOT EXISTS (
         SELECT 1 FROM rainbow_messages m
         WHERE m.phone = e.jid
           AND m.manual = true
           AND m.timestamp > e.created_at
       )
     ORDER BY e.created_at ASC`,
    [slaDurationMinutes]
  );

  return result.rows.map(row => ({
    id: row.id,
    jid: row.jid,
    profileId: row.profile_id,
    // SQLite (via the pg shim) returns TEXT timestamps — coerce to Date.
    createdAt: new Date(row.created_at),
    metadata: row.metadata,
    slaDurationMinutes,
    minutesWaiting: Math.round(row.minutes_waiting),
    lastUserMessage: row.last_user_message,
  }));
}

async function markSlaBreached(eventId: number): Promise<void> {
  await pool.query(
    `UPDATE escalation_events SET sla_breached_at = NOW() WHERE id = $1`,
    [eventId]
  );
}

async function sendSlaBreachAlert(esc: OpenEscalation): Promise<void> {
  const status = getWhatsAppStatus();
  if (status !== 'connected') {
    logger.warn('WhatsApp not connected — cannot send SLA breach alert', { status });
    return;
  }

  const escalatedAt = esc.createdAt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
  const lastMsg = esc.lastUserMessage
    ? `\n*Last message:* ${esc.lastUserMessage.slice(0, 200)}`
    : '';

  const alert = [
    `⚠️ *SLA BREACH — Human Handoff*`,
    ``,
    `*Guest:* +${esc.jid}`,
    `*Waiting:* ${esc.minutesWaiting} minutes`,
    `*Escalated at:* ${escalatedAt}`,
    `*SLA window:* ${esc.slaDurationMinutes} minutes`,
    lastMsg,
    ``,
    `_No human has responded to this guest since escalation._`,
    `_Reply !resolve ${esc.jid} to resume AI if resolved._`,
  ].filter(Boolean).join('\n');

  try {
    await sendWhatsAppMessage(ADMIN_PHONE, alert);
    logger.info('SLA breach alert sent', { eventId: esc.id, jid: esc.jid, minutesWaiting: esc.minutesWaiting });
  } catch (err: any) {
    logger.error('Failed to send SLA breach alert', { error: err.message });
  }
}

// ─── Cron runner ──────────────────────────────────────────────────────

async function runSlaCronCheck(): Promise<void> {
  try {
    const slaDurationMinutes = await getSlaConfiguredMinutes();
    const breached = await getOpenEscalations(slaDurationMinutes);

    if (breached.length === 0) return;

    logger.info(`SLA cron: found ${breached.length} breached handoff(s)`);

    for (const esc of breached) {
      try {
        await markSlaBreached(esc.id);
        await sendSlaBreachAlert(esc);
      } catch (err: any) {
        logger.error('Failed to process SLA breach', { eventId: esc.id, error: err.message });
      }
    }
  } catch (err: any) {
    logger.error('SLA cron check failed', { error: err.message });
  }
}

async function getSlaConfiguredMinutes(): Promise<number> {
  try {
    const { configStore } = await import('../assistant/config-store.js');
    const settings = configStore.getSettings() as any;
    return settings?.handoff?.slaDurationMinutes ?? DEFAULT_SLA_MINUTES;
  } catch {
    return DEFAULT_SLA_MINUTES;
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────

export function startHandoffSlaCron(): void {
  if (cronIntervalId) return;
  logger.info(`SLA cron started (check every 2 min, default SLA: ${DEFAULT_SLA_MINUTES} min)`);
  cronIntervalId = setInterval(() => {
    runSlaCronCheck().catch(err =>
      logger.error('SLA cron interval error', { error: err.message })
    );
  }, CRON_INTERVAL_MS);
  // unref so it doesn't keep the process alive in tests
  cronIntervalId.unref();
}

export function stopHandoffSlaCron(): void {
  if (cronIntervalId) {
    clearInterval(cronIntervalId);
    cronIntervalId = null;
    logger.info('SLA cron stopped');
  }
}

// ─── Admin dashboard query ────────────────────────────────────────────

export interface OpenHandoff {
  id: number;
  jid: string;
  profileId: string;
  escalatedAt: string;       // ISO string
  minutesWaiting: number;
  slaDurationMinutes: number;
  slaStatus: 'green' | 'amber' | 'red';
  lastUserMessage: string | null;
  slaBreachedAt: string | null;
  humanRespondedAt: string | null;
}

/**
 * Returns all active handoffs with SLA status for the admin dashboard.
 * Green: < 50% of SLA elapsed. Amber: 50-100%. Red: SLA breached.
 */
export async function getOpenHandoffs(slaDurationMinutes?: number): Promise<OpenHandoff[]> {
  const slaMin = slaDurationMinutes ?? await getSlaConfiguredMinutes();

  const result = await pool.query<{
    id: number;
    jid: string;
    profile_id: string;
    created_at: Date;
    minutes_waiting: number;
    last_user_message: string | null;
    sla_breached_at: Date | null;
    human_responded_at: Date | null;
  }>(
    `SELECT
       e.id,
       e.jid,
       e.profile_id,
       e.created_at,
       (julianday('now') - julianday(e.created_at)) * 1440.0 AS minutes_waiting,
       (
         SELECT content
         FROM rainbow_messages
         WHERE phone = e.jid
           AND role = 'user'
           AND timestamp >= e.created_at
         ORDER BY timestamp DESC
         LIMIT 1
       ) AS last_user_message,
       e.sla_breached_at,
       e.human_responded_at
     FROM escalation_events e
     WHERE e.human_responded_at IS NULL
       AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')
     ORDER BY e.created_at DESC`,
    []
  );

  return result.rows.map(row => {
    const minutes = Math.round(row.minutes_waiting);
    const pct = minutes / slaMin;
    const slaStatus: OpenHandoff['slaStatus'] = row.sla_breached_at
      ? 'red'
      : pct >= 1
        ? 'red'
        : pct >= 0.5
          ? 'amber'
          : 'green';

    return {
      id: row.id,
      jid: row.jid,
      profileId: row.profile_id,
      // SQLite (via the pg shim) returns TEXT timestamps — coerce to Date.
      escalatedAt: new Date(row.created_at).toISOString(),
      minutesWaiting: minutes,
      slaDurationMinutes: slaMin,
      slaStatus,
      lastUserMessage: row.last_user_message,
      slaBreachedAt: row.sla_breached_at ? new Date(row.sla_breached_at).toISOString() : null,
      humanRespondedAt: row.human_responded_at ? new Date(row.human_responded_at).toISOString() : null,
    };
  });
}
