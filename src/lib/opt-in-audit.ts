/**
 * opt-in-audit.ts — WhatsApp Marketing Opt-In Audit Trail (US-979)
 *
 * Enforces Meta's Messaging Policy requirement for documented opt-in consent
 * before sending marketing template messages. Provides:
 *
 *  - checkOptInBeforeMarketingSend(phone, profileId) — guard: blocks sends
 *    for contacts with no recorded opt-in, returns {allowed, reason}
 *  - recordDoubleOptIn(phone, profileId) — upgrades opt_in_method to 'double_optin'
 *  - exportOptInAuditCsv(profileId) — CSV export for compliance review
 *
 * Opt-in methods enum: inbound | double_optin | web_form | ctwa_ad | qr_code | in_person
 */

import { pool } from './db.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('OptInAudit');

export type OptInMethod = 'inbound' | 'double_optin' | 'web_form' | 'ctwa_ad' | 'qr_code' | 'in_person';

export interface OptInGuardResult {
  allowed: boolean;
  reason?: string;
  optInMethod?: string;
  optInAt?: Date;
}

export interface OptInAuditRecord {
  jid: string;
  profileId: string | null;
  optInMethod: string | null;
  optInAt: Date | null;
  optInChannel: string | null;
}

/** US-979 AC4: Block template broadcasts for contacts with no confirmed opt-in */
export async function checkOptInBeforeMarketingSend(
  phone: string,
  profileId?: string
): Promise<OptInGuardResult> {
  if (!pool) return { allowed: true }; // Fail-open when DB not ready

  try {
    const { rows } = await pool.query<{
      opt_in_method: string | null;
      opt_in_at: Date | null;
    }>(
      `SELECT opt_in_method, opt_in_at
       FROM rainbow_conversations
       WHERE phone = $1
       ${profileId ? 'AND (profile_id = $2 OR profile_id IS NULL)' : ''}
       LIMIT 1`,
      profileId ? [phone, profileId] : [phone]
    );

    if (rows.length === 0) {
      const reason = `Contact ${phone} has no conversation record — opt-in not established`;
      logger.warn(reason, { phone, profileId, event: 'marketing_blocked' });
      return { allowed: false, reason };
    }

    const row = rows[0];
    if (!row.opt_in_at) {
      const reason = `Contact ${phone} has opt_in_at = NULL — no documented consent`;
      logger.warn(reason, { phone, profileId, event: 'marketing_blocked' });
      return { allowed: false, reason };
    }

    return {
      allowed: true,
      optInMethod: row.opt_in_method ?? undefined,
      optInAt: row.opt_in_at,
    };
  } catch (err: any) {
    logger.warn(`Opt-in check failed for ${phone}: ${err.message} — failing open`);
    return { allowed: true }; // Fail-open on DB error
  }
}

/** US-979 AC3: Update opt_in_method to 'double_optin' when confirmation keyword received */
export async function recordDoubleOptIn(
  phone: string,
  profileId?: string
): Promise<void> {
  if (!pool) return;

  const now = new Date();
  try {
    await pool.query(
      `UPDATE rainbow_conversations
       SET opt_in_method = 'double_optin',
           opt_in_at = $2,
           opt_in_channel = COALESCE(opt_in_channel, 'whatsapp'),
           updated_at = $2
       WHERE phone = $1`,
      [phone, now]
    );
    logger.info(`Double opt-in confirmed for ${phone}`, { phone, profileId, event: 'double_optin' });
  } catch (err: any) {
    logger.warn(`Failed to record double opt-in for ${phone}: ${err.message}`);
  }
}

/**
 * US-979 AC5: Export opt-in audit as CSV rows.
 * Returns an array of objects; caller formats as CSV response.
 */
export async function exportOptInAuditRecords(
  profileId?: string,
  limit = 10000
): Promise<OptInAuditRecord[]> {
  if (!pool) return [];

  try {
    const { rows } = await pool.query<{
      phone: string;
      profile_id: string | null;
      opt_in_method: string | null;
      opt_in_at: Date | null;
      opt_in_channel: string | null;
    }>(
      `SELECT phone, profile_id, opt_in_method, opt_in_at, opt_in_channel
       FROM rainbow_conversations
       ${profileId ? 'WHERE profile_id = $1' : ''}
       ORDER BY opt_in_at ASC NULLS LAST
       LIMIT ${profileId ? '$2' : '$1'}`,
      profileId ? [profileId, limit] : [limit]
    );

    return rows.map(r => ({
      jid: r.phone,
      profileId: r.profile_id,
      optInMethod: r.opt_in_method,
      optInAt: r.opt_in_at,
      optInChannel: r.opt_in_channel,
    }));
  } catch (err: any) {
    logger.warn(`Opt-in audit export failed: ${err.message}`);
    return [];
  }
}
