/**
 * GDPR Right-to-Erasure endpoint (US-420)
 *
 * DELETE /api/rainbow/guests/:jid/data
 * Permanently removes all personal data for a given JID across all tables.
 * Logs the erasure request (with hashed JID) to a gdpr_audit_log table.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db, dbReady, pool } from '../../lib/db.js';
import {
  rainbowMessages,
  rainbowConversations,
  rainbowConversationState,
  rainbowFeedback,
  intentPredictions,
  optOuts,
} from '../../../shared/schema-tables.js';
import { canonicalPhoneKey } from '../../assistant/conversation-db.js';
import { badRequest, notFound, serverError } from './http-utils.js';

const router = Router();

// Ensure gdpr_audit_log table exists (idempotent)
async function ensureAuditTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gdpr_audit_log (
      request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      jid_hash TEXT NOT NULL,
      requested_by TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      messages_deleted INTEGER DEFAULT 0,
      conversations_deleted INTEGER DEFAULT 0,
      memory_deleted INTEGER DEFAULT 0
    )
  `);
}

// Run on module load — non-blocking
dbReady.then(ok => { if (ok) ensureAuditTable().catch(() => {}); });

/**
 * DELETE /guests/:jid/data
 * Permanently erases all guest data for the given JID.
 */
router.delete('/guests/:jid/data', async (req: Request, res: Response) => {
  const jidParam = decodeURIComponent(req.params.jid as string);
  if (!jidParam) return badRequest(res, 'JID parameter is required');

  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  const key = canonicalPhoneKey(jidParam);
  const jidHash = crypto.createHash('sha256').update(key).digest('hex');
  const requestedBy = (req.headers['x-admin-user'] as string) || 'admin';

  try {
    // Check if any records exist for this JID
    const existing = await db
      .select({ id: rainbowMessages.id })
      .from(rainbowMessages)
      .where(eq(rainbowMessages.phone, key))
      .limit(1);

    const existingConvo = await db
      .select({ phone: rainbowConversations.phone })
      .from(rainbowConversations)
      .where(eq(rainbowConversations.phone, key))
      .limit(1);

    const existingState = await db
      .select({ phone: rainbowConversationState.phone })
      .from(rainbowConversationState)
      .where(eq(rainbowConversationState.phone, key))
      .limit(1);

    const existingFeedback = await db
      .select({ id: rainbowFeedback.id })
      .from(rainbowFeedback)
      .where(eq(rainbowFeedback.phoneNumber, key))
      .limit(1);

    const existingPredictions = await db
      .select({ id: intentPredictions.id })
      .from(intentPredictions)
      .where(eq(intentPredictions.phoneNumber, key))
      .limit(1);

    const existingOptOut = await db
      .select({ phone: optOuts.phone })
      .from(optOuts)
      .where(eq(optOuts.phone, key))
      .limit(1);

    const hasAnyRecords =
      existing.length > 0 ||
      existingConvo.length > 0 ||
      existingState.length > 0 ||
      existingFeedback.length > 0 ||
      existingPredictions.length > 0 ||
      existingOptOut.length > 0;

    if (!hasAnyRecords) {
      return notFound(res, `Guest ${jidParam}`);
    }

    // Perform deletion in a single transaction
    let messagesDeleted = 0;
    let conversationsDeleted = 0;
    let memoryDeleted = 0; // state + feedback + predictions + optOuts

    await db.transaction(async (tx) => {
      // 1. Messages
      const msgResult = await tx
        .delete(rainbowMessages)
        .where(eq(rainbowMessages.phone, key))
        .returning({ id: rainbowMessages.id });
      messagesDeleted = msgResult.length;

      // 2. Conversations
      const convoResult = await tx
        .delete(rainbowConversations)
        .where(eq(rainbowConversations.phone, key))
        .returning({ phone: rainbowConversations.phone });
      conversationsDeleted = convoResult.length;

      // 3. Conversation state
      const stateResult = await tx
        .delete(rainbowConversationState)
        .where(eq(rainbowConversationState.phone, key))
        .returning({ phone: rainbowConversationState.phone });
      memoryDeleted += stateResult.length;

      // 4. Feedback
      const feedbackResult = await tx
        .delete(rainbowFeedback)
        .where(eq(rainbowFeedback.phoneNumber, key))
        .returning({ id: rainbowFeedback.id });
      memoryDeleted += feedbackResult.length;

      // 5. Intent predictions
      const predResult = await tx
        .delete(intentPredictions)
        .where(eq(intentPredictions.phoneNumber, key))
        .returning({ id: intentPredictions.id });
      memoryDeleted += predResult.length;

      // 6. Opt-outs
      const optOutResult = await tx
        .delete(optOuts)
        .where(eq(optOuts.phone, key))
        .returning({ phone: optOuts.phone });
      memoryDeleted += optOutResult.length;
    });

    // Log to audit table (outside transaction — deletion already committed)
    try {
      await pool.query(
        `INSERT INTO gdpr_audit_log (jid_hash, requested_by, completed_at, messages_deleted, conversations_deleted, memory_deleted)
         VALUES ($1, $2, NOW(), $3, $4, $5)`,
        [jidHash, requestedBy, messagesDeleted, conversationsDeleted, memoryDeleted]
      );
    } catch (auditErr) {
      console.error('[GDPR] Audit log write failed (erasure still completed):', auditErr);
    }

    console.log(`[GDPR] Erasure completed for JID hash ${jidHash.substring(0, 12)}...: ${messagesDeleted} msgs, ${conversationsDeleted} convos, ${memoryDeleted} memory`);

    res.json({
      jid: jidParam,
      messages_deleted: messagesDeleted,
      conversations_deleted: conversationsDeleted,
      memory_deleted: memoryDeleted,
    });
  } catch (error: any) {
    console.error('[GDPR] Erasure failed:', error.message);
    return serverError(res, error);
  }
});

export default router;
