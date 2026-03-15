/**
 * WhatsApp 24-Hour Session Window Checker (US-815)
 *
 * Meta's messaging policy: free-form outbound messages can only be sent
 * within 24 hours of the last user-initiated message. Outside this window,
 * messages must use approved Message Templates.
 *
 * This module provides a pre-send guard and a batch status helper used by
 * the conversations list API.
 */

import { pool } from './db.js';

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if the 24-hour session window is active for a given phone number.
 * US-908: When tenantId is provided, filters by profile_id to enforce tenant isolation.
 * Returns true if the last user message was received within the past 24 hours.
 */
export async function sessionWindowActive(phone: string, tenantId?: string): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - SESSION_WINDOW_MS);
    // US-908: Add tenant_id filter when available
    const query = tenantId
      ? `SELECT MAX(timestamp) AS last_user_msg
         FROM rainbow_messages
         WHERE phone = $1
           AND role = 'user'
           AND profile_id = $2`
      : `SELECT MAX(timestamp) AS last_user_msg
         FROM rainbow_messages
         WHERE phone = $1
           AND role = 'user'`;
    const params = tenantId ? [phone, tenantId] : [phone];
    const result = await pool.query<{ last_user_msg: Date | null }>(query, params);
    const lastMsg = result.rows[0]?.last_user_msg;
    if (!lastMsg) return false;
    const lastMsgTime = lastMsg instanceof Date ? lastMsg : new Date(lastMsg);
    return lastMsgTime >= cutoff;
  } catch (err: any) {
    // Fail open — don't block messages if DB check fails
    console.warn('[SessionWindow] DB check failed, assuming active:', err.message);
    return true;
  }
}

/**
 * Batch-check session window status for multiple phone numbers.
 * Used by the conversations list API to annotate each conversation.
 * Returns a Map<phone, boolean> where true = session active.
 */
export async function batchSessionWindowStatus(phones: string[]): Promise<Map<string, boolean>> {
  if (phones.length === 0) return new Map();

  try {
    const cutoff = new Date(Date.now() - SESSION_WINDOW_MS);
    const result = await pool.query<{ phone: string; last_user_msg: Date | null }>(
      `SELECT phone, MAX(timestamp) AS last_user_msg
       FROM rainbow_messages
       WHERE phone = ANY($1)
         AND role = 'user'
       GROUP BY phone`,
      [phones]
    );

    const map = new Map<string, boolean>();

    // Default all phones to false (expired)
    for (const phone of phones) map.set(phone, false);

    // Set active for phones with recent user messages
    for (const row of result.rows) {
      const lastMsg = row.last_user_msg instanceof Date ? row.last_user_msg : new Date(row.last_user_msg!);
      map.set(row.phone, lastMsg >= cutoff);
    }

    return map;
  } catch (err: any) {
    console.warn('[SessionWindow] Batch check failed, defaulting all to active:', err.message);
    // Fail open
    const map = new Map<string, boolean>();
    for (const phone of phones) map.set(phone, true);
    return map;
  }
}

/**
 * Log a session-expired send attempt to the console.
 * Future: write to a dedicated blocked_messages table.
 */
export function logSessionExpired(phone: string, source: string, messagePreview: string): void {
  const preview = messagePreview.slice(0, 60) + (messagePreview.length > 60 ? '...' : '');
  console.warn(
    `[SessionWindow] BLOCKED outbound to ${phone} — reason=session_expired source=${source} msg="${preview}"`
  );
}
