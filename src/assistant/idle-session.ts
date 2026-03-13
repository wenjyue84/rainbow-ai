/**
 * US-444: Context-aware idle session timeout with state cleanup.
 *
 * Checks if the last message in a conversation is older than the configured
 * idle timeout. If so, marks the conversation as 'ended' and signals that
 * a new session should start.
 *
 * Runs inline in the conversation-context loading path (input-validator),
 * NOT as a cron job.
 */

import { sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { rainbowConversations } from '../../shared/schema-tables.js';
import { ensureDb, conversationKey } from './conversation-db.js';

const DEFAULT_IDLE_TIMEOUT_HOURS = 8;

export interface IdleSessionResult {
  isIdle: boolean;
  pushName: string | null;
}

/**
 * Check if a conversation is idle (last message older than timeout).
 * If idle, marks the conversation row as status='ended' and resets
 * createdAt so the next upsert creates a fresh session.
 *
 * @param phone - The sender's phone number (raw, not yet canonicalized by caller)
 * @param idleTimeoutHours - Hours of inactivity before session expires
 * @param bsuid - Optional BSUID for key resolution
 * @param nowMs - Current time in ms (injectable for testing)
 * @returns Whether the session was idle and needs a fresh start
 */
export async function checkIdleSession(
  phone: string,
  idleTimeoutHours: number = DEFAULT_IDLE_TIMEOUT_HOURS,
  bsuid?: string,
  nowMs: number = Date.now()
): Promise<IdleSessionResult> {
  if (!(await ensureDb())) return { isIdle: false, pushName: null };
  if (idleTimeoutHours <= 0) return { isIdle: false, pushName: null };

  try {
    const key = conversationKey(phone, bsuid);
    const timeoutMs = idleTimeoutHours * 60 * 60 * 1000;
    const cutoff = new Date(nowMs - timeoutMs);

    // Single query: get last message timestamp and conversation push_name
    const result = await db.execute(sql`
      SELECT
        c.push_name,
        c.status,
        (SELECT MAX(m.timestamp) FROM rainbow_messages m WHERE m.phone = c.phone) AS last_msg_at
      FROM rainbow_conversations c
      WHERE c.phone = ${key}
      LIMIT 1
    `);

    const rows: any[] = (result as any).rows;
    if (rows.length === 0) {
      // No existing conversation — not idle (new guest)
      return { isIdle: false, pushName: null };
    }

    const row = rows[0];
    const lastMsgAt = row.last_msg_at ? new Date(row.last_msg_at) : null;

    if (!lastMsgAt) {
      // No messages yet — not idle
      return { isIdle: false, pushName: row.push_name || null };
    }

    if (lastMsgAt >= cutoff) {
      // Last message is within the timeout window — not idle
      return { isIdle: false, pushName: row.push_name || null };
    }

    // Session is idle — mark as 'ended' and reset createdAt for the new session
    const now = new Date(nowMs);
    await db.execute(sql`
      UPDATE rainbow_conversations
      SET status = 'ended', updated_at = ${now}
      WHERE phone = ${key}
    `);

    // Reset createdAt so the next upsert represents a new session
    await db.execute(sql`
      UPDATE rainbow_conversations
      SET created_at = ${now}, status = 'active'
      WHERE phone = ${key}
    `);

    console.log(`[IdleSession] Session expired for ${key} (last msg: ${lastMsgAt.toISOString()}, timeout: ${idleTimeoutHours}h) — new session started`);

    return { isIdle: true, pushName: row.push_name || null };
  } catch (err: any) {
    console.error(`[IdleSession] Check failed for ${phone}:`, err.message);
    return { isIdle: false, pushName: null };
  }
}
