/**
 * PDPA/GDPR Data Portability endpoint (US-832)
 *
 * GET /api/rainbow/guests/:jid/data-export
 * Returns all personal data for a given JID as structured JSON.
 * For datasets > 10,000 messages, returns 202 with a job ID placeholder.
 * Logs the export request to gdpr_audit_log table.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
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

const LARGE_DATASET_THRESHOLD = 10_000;

// Reuse the audit table from gdpr-erasure.ts (same table, idempotent creation)
async function ensureAuditTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gdpr_audit_log (
      request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      jid_hash TEXT NOT NULL,
      requested_by TEXT,
      action TEXT NOT NULL DEFAULT 'erasure',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      messages_deleted INTEGER DEFAULT 0,
      conversations_deleted INTEGER DEFAULT 0,
      memory_deleted INTEGER DEFAULT 0
    )
  `);
  // Add action column if it doesn't exist (schema migration for existing deployments)
  await pool.query(`
    ALTER TABLE gdpr_audit_log ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'erasure'
  `);
}

dbReady.then(ok => { if (ok) ensureAuditTable().catch(() => {}); });

/**
 * GET /guests/:jid/data-export
 * Returns all personal data for the given JID as a structured JSON download.
 */
router.get('/guests/:jid/data-export', async (req: Request, res: Response) => {
  const jidParam = decodeURIComponent(req.params.jid as string);
  if (!jidParam) return badRequest(res, 'JID parameter is required');

  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  const key = canonicalPhoneKey(jidParam);
  const jidHash = crypto.createHash('sha256').update(key).digest('hex');
  const requestedBy = (req.headers['x-admin-user'] as string) || 'admin';
  const generatedAt = new Date().toISOString();

  try {
    // Quick message count check for large-dataset handling
    const countResult = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM rainbow_messages WHERE phone = $1 AND deleted_at IS NULL',
      [key]
    );
    const messageCount = parseInt(countResult.rows[0]?.count ?? '0', 10);

    if (messageCount > LARGE_DATASET_THRESHOLD) {
      // Return 202 Accepted with a job ID placeholder
      const jobId = crypto.randomUUID();
      console.log(`[GDPR Export] Large dataset (${messageCount} msgs) for JID hash ${jidHash.substring(0, 12)}... — returning 202`);
      return res.status(202).json({
        status: 'accepted',
        job_id: jobId,
        message: `Dataset contains ${messageCount} messages. Export will be processed asynchronously.`,
        estimated_completion: 'Contact admin to retrieve export by job ID.',
        generated_at: generatedAt,
      });
    }

    // Fetch all personal data in parallel
    const [messages, conversations, conversationState, feedback, predictions, optOutRecord] = await Promise.all([
      db
        .select()
        .from(rainbowMessages)
        .where(and(eq(rainbowMessages.phone, key), isNull(rainbowMessages.deletedAt))),
      db
        .select()
        .from(rainbowConversations)
        .where(and(eq(rainbowConversations.phone, key), isNull(rainbowConversations.deletedAt))),
      db
        .select()
        .from(rainbowConversationState)
        .where(eq(rainbowConversationState.phone, key)),
      db
        .select()
        .from(rainbowFeedback)
        .where(eq(rainbowFeedback.phoneNumber, key)),
      db
        .select()
        .from(intentPredictions)
        .where(eq(intentPredictions.phoneNumber, key)),
      db
        .select()
        .from(optOuts)
        .where(eq(optOuts.phone, key)),
    ]);

    const hasAnyData =
      messages.length > 0 ||
      conversations.length > 0 ||
      conversationState.length > 0 ||
      feedback.length > 0 ||
      predictions.length > 0 ||
      optOutRecord.length > 0;

    if (!hasAnyData) {
      return notFound(res, `Guest ${jidParam}`);
    }

    // Log to audit table
    try {
      await pool.query(
        `INSERT INTO gdpr_audit_log (jid_hash, requested_by, action, completed_at)
         VALUES ($1, $2, 'data_export', NOW())`,
        [jidHash, requestedBy]
      );
    } catch (auditErr) {
      console.error('[GDPR Export] Audit log write failed (export still proceeding):', auditErr);
    }

    console.log(`[GDPR Export] Exporting data for JID hash ${jidHash.substring(0, 12)}...: ${messages.length} msgs, ${conversations.length} convos`);

    const exportPayload = {
      generated_at: generatedAt,
      jid: jidParam,
      retention_policy: {
        summary: 'Data is retained for up to 2 years from last activity unless an erasure request is submitted.',
        erasure_endpoint: 'DELETE /api/rainbow/guests/:jid/data',
      },
      data: {
        messages: messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          intent: m.intent,
          confidence: m.confidence,
          source: m.source,
          profile_id: m.profileId,
        })),
        conversations: conversations.map(c => ({
          phone: c.phone,
          push_name: c.pushName,
          instance_id: c.instanceId,
          profile_id: c.profileId,
          status: c.status,
          response_mode: c.responseMode,
          context_summary: c.contextSummary,
          created_at: c.createdAt,
          updated_at: c.updatedAt,
        })),
        conversation_state: conversationState.map(s => ({
          push_name: s.pushName,
          language: s.language,
          last_intent: s.lastIntent,
          last_intent_confidence: s.lastIntentConfidence,
          last_intent_timestamp: s.lastIntentTimestamp,
          profile_id: s.profileId,
          created_at: s.createdAt,
          last_active_at: s.lastActiveAt,
        })),
        feedback: feedback.map(f => ({
          id: f.id,
          rating: f.rating,
          intent: f.intent,
          feedback_text: f.feedbackText,
          created_at: f.createdAt,
        })),
        intent_predictions: predictions.map(p => ({
          id: p.id,
          predicted_intent: p.predictedIntent,
          actual_intent: p.actualIntent,
          tier: p.tier,
          was_correct: p.wasCorrect,
          created_at: p.createdAt,
        })),
        opt_out_status: optOutRecord.length > 0
          ? {
            opted_out_at: optOutRecord[0]!.optedOutAt,
            opted_in_at: optOutRecord[0]!.optedInAt,
            is_opted_out: optOutRecord[0]!.optedInAt === null,
          }
          : null,
      },
      summary: {
        total_messages: messages.length,
        total_conversations: conversations.length,
        total_feedback_records: feedback.length,
        total_intent_predictions: predictions.length,
        is_opted_out: optOutRecord.length > 0 && optOutRecord[0]!.optedInAt === null,
      },
    };

    const filename = `data-export-${jidHash.substring(0, 16)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportPayload);
  } catch (error: any) {
    console.error('[GDPR Export] Data export failed:', error.message);
    return serverError(res, error);
  }
});

export default router;
