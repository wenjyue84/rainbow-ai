/**
 * WhatsApp Consent Enforcement Module (US-155)
 *
 * Checks opt-in consent before sending messages.
 * Logs violations and prevents non-consensual message delivery.
 */

import { pool } from '../db.js';
import { createModuleLogger } from '../logger.js';

const logger = createModuleLogger('WhatsAppConsent');

export interface ConsentCheckResult {
  allowed: boolean;
  reason?: string;
  optedIn: boolean;
  optedInAt?: Date;
}

/**
 * Check if a phone number has opted in to WhatsApp messaging.
 * Returns consent status and reason for denial if applicable.
 */
export async function checkWhatsAppConsent(
  phone: string,
  profileId?: string
): Promise<ConsentCheckResult> {
  if (!pool) {
    // Database not ready, fail-open
    logger.warn('Database not available for consent check, failing open', { phone });
    return { allowed: true, optedIn: true };
  }

  try {
    // Extract phone from JID format if needed
    const cleanPhone = phone.replace(/[@a-z.]/g, '');

    const { rows } = await pool.query<{
      whatsapp_opted_in: boolean;
      whatsapp_opted_in_at: Date | null;
    }>(
      `SELECT whatsapp_opted_in, whatsapp_opted_in_at
       FROM rainbow_conversations
       WHERE phone = $1
       ${profileId ? 'AND (profile_id = $2 OR profile_id IS NULL)' : ''}
       LIMIT 1`,
      profileId ? [cleanPhone, profileId] : [cleanPhone]
    );

    if (rows.length === 0) {
      // No conversation record — treat as opted-out for safety
      const reason = `No conversation record for ${phone} — opt-in not established`;
      logger.warn(reason, { phone, profileId, event: 'consent_check_failed' });
      return { allowed: false, reason, optedIn: false };
    }

    const row = rows[0];
    if (!row.whatsapp_opted_in) {
      const reason = `Contact ${phone} has whatsapp_opted_in = false — blocked`;
      logger.warn(reason, { phone, profileId, event: 'consent_violation' });
      return {
        allowed: false,
        reason,
        optedIn: false,
        optedInAt: row.whatsapp_opted_in_at ?? undefined
      };
    }

    logger.debug('Consent check passed', { phone, profileId });
    return {
      allowed: true,
      optedIn: true,
      optedInAt: row.whatsapp_opted_in_at ?? undefined
    };
  } catch (err: any) {
    logger.warn(`Consent check failed for ${phone}: ${err.message} — failing open`);
    return { allowed: true, optedIn: true }; // Fail-open on DB error
  }
}

/**
 * Record a new opt-in event for a phone number.
 * Called when inbound message is received or consent is explicitly given.
 */
export async function recordWhatsAppOptIn(
  phone: string,
  profileId?: string
): Promise<void> {
  if (!pool) return;

  try {
    const cleanPhone = phone.replace(/[@a-z.]/g, '');
    const now = new Date();

    await pool.query(
      `UPDATE rainbow_conversations
       SET whatsapp_opted_in = true,
           whatsapp_opted_in_at = $2,
           opt_in_method = COALESCE(opt_in_method, 'inbound'),
           opt_in_at = COALESCE(opt_in_at, $2),
           opt_in_channel = COALESCE(opt_in_channel, 'whatsapp'),
           updated_at = $2
       WHERE phone = $1`,
      [cleanPhone, now]
    );

    logger.info(`WhatsApp opt-in recorded for ${cleanPhone}`, {
      phone: cleanPhone,
      profileId,
      event: 'whatsapp_optin'
    });
  } catch (err: any) {
    logger.warn(`Failed to record opt-in for ${phone}: ${err.message}`);
  }
}

/**
 * Opt-out a phone number from WhatsApp messaging.
 * Called when guest explicitly opts out or sends STOP command.
 */
export async function recordWhatsAppOptOut(
  phone: string,
  profileId?: string
): Promise<void> {
  if (!pool) return;

  try {
    const cleanPhone = phone.replace(/[@a-z.]/g, '');
    const now = new Date();

    await pool.query(
      `UPDATE rainbow_conversations
       SET whatsapp_opted_in = false,
           updated_at = $2
       WHERE phone = $1`,
      [cleanPhone, now]
    );

    logger.warn(`WhatsApp opt-out recorded for ${cleanPhone}`, {
      phone: cleanPhone,
      profileId,
      event: 'whatsapp_optout'
    });
  } catch (err: any) {
    logger.warn(`Failed to record opt-out for ${phone}: ${err.message}`);
  }
}
