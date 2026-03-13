/**
 * webchat.ts — Admin API for webchat conversations
 *
 * Endpoints for viewing webchat conversations, reading messages, and sending staff replies.
 * Webchat conversations use phone = 'webchat-{sessionId}' in rainbow_messages/rainbow_conversations.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../../lib/db.js';
import { ok, badRequest, notFound, serverError } from './http-utils.js';

const router = Router();

/**
 * GET /webchat/conversations
 * List all webchat conversations (source = 'webchat' in rainbow_conversations).
 * If x-profile-id header is provided, filter by that profile.
 */
router.get('/webchat/conversations', async (_req: Request, res: Response) => {
  try {
    const profileId = (res.locals as any)?.profileId as string | undefined;
    const profileFilter = profileId ? 'AND c.profile_id = $1' : '';
    const params: any[] = profileId ? [profileId] : [];

    const result = await pool.query(`
      SELECT
        c.phone,
        c.push_name,
        c.pinned,
        c.last_read_at,
        c.created_at,
        lm.content   AS last_msg_content,
        lm.role       AS last_msg_role,
        lm.timestamp  AS last_msg_at,
        COALESCE(mc.total, 0)::int  AS message_count,
        COALESCE(uc.unread, 0)::int AS unread_count
      FROM rainbow_conversations c
      LEFT JOIN LATERAL (
        SELECT content, role, timestamp
        FROM rainbow_messages
        WHERE phone = c.phone
        ORDER BY timestamp DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS total
        FROM rainbow_messages
        WHERE phone = c.phone
      ) mc ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS unread
        FROM rainbow_messages
        WHERE phone = c.phone
          AND role = 'user'
          AND (c.last_read_at IS NULL OR timestamp > c.last_read_at)
      ) uc ON true
      WHERE c.phone LIKE 'webchat-%'
        AND lm.content IS NOT NULL
        ${profileFilter}
      ORDER BY lm.timestamp DESC
    `, params);

    const conversations = result.rows.map((r: any) => ({
      sessionId: r.phone.replace('webchat-', ''),
      phone: r.phone,
      pushName: r.push_name,
      lastMessage: (r.last_msg_content || '').slice(0, 100),
      lastMessageRole: r.last_msg_role,
      lastMessageAt: r.last_msg_at instanceof Date
        ? r.last_msg_at.getTime()
        : new Date(r.last_msg_at).getTime(),
      messageCount: Number(r.message_count ?? 0),
      unreadCount: Number(r.unread_count ?? 0),
      pinned: r.pinned,
      createdAt: r.created_at instanceof Date
        ? r.created_at.getTime()
        : new Date(r.created_at).getTime(),
    }));

    res.json(conversations);
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * GET /webchat/conversations/:sessionId
 * Get all messages for a webchat session.
 */
router.get('/webchat/conversations/:sessionId', async (req: Request, res: Response) => {
  try {
    const phone = 'webchat-' + req.params.sessionId;

    const msgResult = await pool.query(
      `SELECT id, role, content, timestamp, staff_name, source
       FROM rainbow_messages
       WHERE phone = $1
       ORDER BY timestamp ASC`,
      [phone]
    );

    if (msgResult.rows.length === 0) {
      notFound(res, 'Webchat session');
      return;
    }

    // Get conversation metadata
    const convoResult = await pool.query(
      `SELECT push_name, last_read_at, created_at
       FROM rainbow_conversations WHERE phone = $1`,
      [phone]
    );

    const convo = convoResult.rows[0] || {};

    const messages = msgResult.rows.map((r: any) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      timestamp: r.timestamp instanceof Date ? r.timestamp.getTime() : new Date(r.timestamp).getTime(),
      staffName: r.staff_name || null,
      source: r.source || null,
    }));

    res.json({
      sessionId: req.params.sessionId,
      phone,
      pushName: convo.push_name || 'Web Visitor',
      profileId: 'webchat',
      messages,
      lastReadAt: convo.last_read_at ? new Date(convo.last_read_at).getTime() : null,
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * PATCH /webchat/conversations/:sessionId/read
 * Mark a webchat conversation as read.
 */
router.patch('/webchat/conversations/:sessionId/read', async (req: Request, res: Response) => {
  try {
    const phone = 'webchat-' + req.params.sessionId;
    const now = new Date();

    await pool.query(
      `UPDATE rainbow_conversations SET last_read_at = $1, updated_at = $1 WHERE phone = $2`,
      [now, phone]
    );

    ok(res);
  } catch (err: any) {
    serverError(res, err);
  }
});

/**
 * POST /webchat/conversations/:sessionId/reply
 * Staff sends a reply to a webchat session. Stored in DB for client polling.
 */
router.post('/webchat/conversations/:sessionId/reply', async (req: Request, res: Response) => {
  try {
    const phone = 'webchat-' + req.params.sessionId;
    const { message, staffName } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      badRequest(res, 'message (string) required');
      return;
    }

    const now = new Date();

    // Insert staff reply as role='staff'
    await pool.query(
      `INSERT INTO rainbow_messages (phone, role, content, timestamp, staff_name, source)
       VALUES ($1, 'staff', $2, $3, $4, 'webchat-admin')`,
      [phone, message.trim(), now, staffName || 'Staff']
    );

    // Update conversation timestamp
    await pool.query(
      `UPDATE rainbow_conversations SET updated_at = $1 WHERE phone = $2`,
      [now, phone]
    );

    ok(res, { timestamp: now.getTime() });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
