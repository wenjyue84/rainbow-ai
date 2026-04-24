/**
 * US-826: Webchat session idle timeout with configurable re-engagement message.
 *
 * Lazy-check approach: runs when the client polls for messages or sends a new message.
 * - After timeout_minutes of inactivity → inserts a re-engagement message
 * - After reengagement_window_minutes with no response → marks session as timed_out
 * - Applies ONLY to webchat sessions (phone starts with 'webchat-')
 */

import { pool } from '../lib/db.js';

export interface WebchatIdleConfig {
  enabled: boolean;
  timeout_minutes: number;
  reengagement_message: string;
  reengagement_window_minutes: number;
}

const DEFAULT_CONFIG: WebchatIdleConfig = {
  enabled: true,
  timeout_minutes: 30,
  reengagement_message: "Are you still there? I'm here to help if you have any more questions!",
  reengagement_window_minutes: 10,
};

export interface IdleCheckResult {
  status: 'active' | 'reengagement_sent' | 'timed_out';
  reengagementMessage?: string;
}

/**
 * Lazy check for webchat session idle timeout.
 * Call from the polling endpoint to detect idle sessions and send re-engagement.
 */
export async function checkWebchatIdle(
  phone: string,
  config?: Partial<WebchatIdleConfig>,
  nowMs: number = Date.now()
): Promise<IdleCheckResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enabled || cfg.timeout_minutes < 5) {
    return { status: 'active' };
  }

  if (!phone.startsWith('webchat-')) {
    return { status: 'active' };
  }

  try {
    // Check current conversation status
    const convoResult = await pool.query(
      `SELECT status FROM rainbow_conversations WHERE phone = $1`,
      [phone]
    );

    if (convoResult.rows.length === 0) {
      return { status: 'active' };
    }

    const currentStatus = convoResult.rows[0].status;

    // Already timed out — no further action
    if (currentStatus === 'timed_out') {
      return { status: 'timed_out' };
    }

    // Get last user message timestamp and last re-engagement timestamp
    const result = await pool.query(`
      SELECT
        (SELECT MAX(timestamp) FROM rainbow_messages WHERE phone = $1 AND role = 'user') AS last_user_msg_at,
        (SELECT MAX(timestamp) FROM rainbow_messages WHERE phone = $1 AND source = 'webchat-reengagement') AS reengagement_sent_at
    `, [phone]);

    const row = result.rows[0];
    const lastUserMsgAt = row.last_user_msg_at ? new Date(row.last_user_msg_at).getTime() : null;
    const reengagementSentAt = row.reengagement_sent_at ? new Date(row.reengagement_sent_at).getTime() : null;

    if (!lastUserMsgAt) {
      return { status: 'active' };
    }

    const idleDuration = nowMs - lastUserMsgAt;
    const timeoutMs = cfg.timeout_minutes * 60 * 1000;
    const reengagementWindowMs = cfg.reengagement_window_minutes * 60 * 1000;

    // Not yet idle
    if (idleDuration < timeoutMs) {
      return { status: 'active' };
    }

    // Idle but no re-engagement sent yet (or sent before last user message)
    if (!reengagementSentAt || reengagementSentAt < lastUserMsgAt) {
      // Pass integer ms (nowMs) — keeps timestamp column as INTEGER, not ISO text
      await pool.query(
        `INSERT INTO rainbow_messages (phone, role, content, timestamp, source)
         VALUES ($1, 'assistant', $2, $3, 'webchat-reengagement')`,
        [phone, cfg.reengagement_message, nowMs]
      );

      await pool.query(
        `UPDATE rainbow_conversations SET status = 'reengagement_sent', updated_at = $1 WHERE phone = $2`,
        [nowMs, phone]
      );

      console.log(`[WebchatIdle] Re-engagement sent for ${phone} (idle ${Math.round(idleDuration / 60000)}m)`);
      return { status: 'reengagement_sent', reengagementMessage: cfg.reengagement_message };
    }

    // Re-engagement was sent — check if window has passed
    const timeSinceReengagement = nowMs - reengagementSentAt;
    if (timeSinceReengagement >= reengagementWindowMs) {
      await pool.query(
        `UPDATE rainbow_conversations SET status = 'timed_out', updated_at = $1 WHERE phone = $2`,
        [nowMs, phone]
      );

      console.log(`[WebchatIdle] Session timed out for ${phone} (no response after re-engagement)`);
      return { status: 'timed_out' };
    }

    // Still waiting for response after re-engagement
    return { status: 'reengagement_sent' };
  } catch (err: any) {
    console.error(`[WebchatIdle] Check failed for ${phone}:`, err.message);
    return { status: 'active' };
  }
}

/**
 * Reset a timed-out or re-engagement-pending webchat session to active.
 * Called when the user sends a new message after being idle.
 */
export async function resetWebchatSession(phone: string): Promise<void> {
  if (!phone.startsWith('webchat-')) return;

  try {
    await pool.query(
      `UPDATE rainbow_conversations
       SET status = 'active', updated_at = $1
       WHERE phone = $2 AND status IN ('timed_out', 'reengagement_sent')`,
      [Date.now(), phone]
    );
  } catch (err: any) {
    console.error(`[WebchatIdle] Reset failed for ${phone}:`, err.message);
  }
}
