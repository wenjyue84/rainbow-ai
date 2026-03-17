/**
 * PDPA Phase 3 Data Portability Endpoint (US-019)
 *
 * Malaysia PDPA Amendment Act 2024 — Phase 3 (June 2025):
 * Data portability right is enforceable. Data subjects may request their personal
 * data in a machine-readable format. Fulfilment deadline: 7 days.
 *
 * GET /pdpa/data-export/:phone — Structured JSON export of all guest data
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
  intentPredictions,
  optOuts,
} from '../../../shared/schema-tables.js';
import { canonicalPhoneKey } from '../../assistant/conversation-db.js';
import { badRequest, notFound, serverError } from './http-utils.js';

const router = Router();

/** Days the data controller has to fulfil a portability request (PDPA Phase 3). */
const PDPA_FULFILMENT_DAYS = 7;

// ─── Audit table bootstrap ───────────────────────────────────────────────────

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
  await pool.query(
    `ALTER TABLE gdpr_audit_log ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'erasure'`
  );
}

dbReady.then(ok => { if (ok) ensureAuditTable().catch(() => {}); });

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * GET /pdpa/data-export/:phone
 *
 * Returns all personal data held for the given phone number as structured JSON.
 * Includes: messages, conversations, conversation state (guest profile),
 * intent analytics (intentPredictions), and opt-out status.
 * Requires admin authentication (enforced by index.ts middleware).
 *
 * Response includes a PDPA-mandated due_date (request date + 7 days) so
 * the admin knows the fulfilment deadline.
 */
router.get('/pdpa/data-export/:phone', async (req: Request, res: Response) => {
  const phoneParam = decodeURIComponent(req.params.phone as string);
  if (!phoneParam) return badRequest(res, 'phone parameter is required');

  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  const key = canonicalPhoneKey(phoneParam);
  const jidHash = crypto.createHash('sha256').update(key).digest('hex');
  const requestedBy = (req.headers['x-admin-user'] as string) || 'admin';
  const requestedAt = new Date();
  const dueDate = new Date(requestedAt);
  dueDate.setDate(dueDate.getDate() + PDPA_FULFILMENT_DAYS);

  try {
    const [messages, conversations, conversationState, analytics, optOutRecord] = await Promise.all([
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
      analytics.length > 0 ||
      optOutRecord.length > 0;

    if (!hasAnyData) {
      return notFound(res, `Guest ${phoneParam}`);
    }

    // Log to audit table (action='portability')
    try {
      await pool.query(
        `INSERT INTO gdpr_audit_log (jid_hash, requested_by, action, completed_at)
         VALUES ($1, $2, 'portability', NOW())`,
        [jidHash, requestedBy]
      );
    } catch (auditErr) {
      console.error('[PDPA Export] Audit log write failed (export still proceeding):', auditErr);
    }

    console.log(
      `[PDPA Export] US-019: Exporting data for JID hash ${jidHash.substring(0, 12)}...: ` +
      `${messages.length} msgs, ${analytics.length} analytics, requested_by=${requestedBy}`
    );

    const exportPayload = {
      schema_version: '1.0',
      generated_at: requestedAt.toISOString(),
      pdpa_fulfilment_due: dueDate.toISOString(),
      phone: phoneParam,
      retention_policy: {
        summary: 'Data retained up to 2 years from last activity unless an erasure request is submitted.',
        erasure_endpoint: 'DELETE /api/rainbow/guests/:jid/data',
        portability_endpoint: 'GET /api/rainbow/pdpa/data-export/:phone',
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
          context_summary: c.contextSummary,
          created_at: c.createdAt,
          updated_at: c.updatedAt,
        })),
        guest_profile: conversationState.length > 0
          ? {
              push_name: conversationState[0]!.pushName,
              language: conversationState[0]!.language,
              last_intent: conversationState[0]!.lastIntent,
              last_intent_confidence: conversationState[0]!.lastIntentConfidence,
              last_intent_timestamp: conversationState[0]!.lastIntentTimestamp,
              profile_id: conversationState[0]!.profileId,
              created_at: conversationState[0]!.createdAt,
              last_active_at: conversationState[0]!.lastActiveAt,
            }
          : null,
        intent_analytics: analytics.map(p => ({
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
        total_intent_analytics: analytics.length,
        has_guest_profile: conversationState.length > 0,
        is_opted_out: optOutRecord.length > 0 && optOutRecord[0]!.optedInAt === null,
      },
    };

    const filename = `pdpa-export-${jidHash.substring(0, 16)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportPayload);
  } catch (error: any) {
    console.error('[PDPA Export] Data export failed:', error.message);
    return serverError(res, error);
  }
});

export default router;
