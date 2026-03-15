/**
 * Persistent Conversation Logger — PostgreSQL Backend
 *
 * Stores real chat messages to Postgres for admin review.
 * Tables: rainbow_conversations + rainbow_messages
 *
 * Maintains the same public API as the old JSON-file version
 * so all callers (pipeline, routes, etc.) work unchanged.
 *
 * Refactored: helpers extracted to conversation-db.ts, conversation-contacts.ts,
 * conversation-context.ts, and conversation-logger-types.ts.
 */

import { eq, gt, sql, and, isNull } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { withFallback } from '../lib/with-fallback.js';
import { rainbowConversations, rainbowMessages } from '../../shared/schema-tables.js';
import {
  ensureDb,
  canonicalPhoneKey,
  conversationKey,
  rowToMessage,
  upsertConversation,
  invalidateListCache,
  getListCache,
  setListCache,
} from './conversation-db.js';
import { scheduleContextUpdate } from './conversation-context.js';

// ─── Re-export types (callers still import these from here) ─────────

export type {
  LoggedMessage,
  ContactDetails,
  ConversationLog,
  ConversationSummary,
  ConversationReferral,
} from './conversation-logger-types.js';

import type {
  ContactDetails,
  ConversationLog,
  ConversationSummary,
} from './conversation-logger-types.js';

// ─── Re-export contact management (callers import from here) ────────

export {
  getContactDetails,
  updateContactDetails,
  getAllContactTags,
  getAllContactUnits,
  getAllContactDates,
} from './conversation-contacts.js';

// ─── Re-export context update (used by logMessage internally + tests) ─

export { scheduleContextUpdate } from './conversation-context.js';

// ─── Public API ─────────────────────────────────────────────────────

/** Log a single message to a conversation */
export async function logMessage(
  phone: string,
  pushName: string,
  role: 'user' | 'assistant',
  content: string,
  meta?: {
    intent?: string;
    confidence?: number;
    action?: string;
    instanceId?: string;
    profileId?: string;
    manual?: boolean;
    source?: string;
    model?: string;
    responseTime?: number;
    kbFiles?: string[];
    messageType?: string;
    routedAction?: string;
    workflowId?: string;
    stepId?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    // Allow extra keys from copilot approval flow
    [key: string]: unknown;
  }
): Promise<void> {
  if (!(await ensureDb())) return;

  try {
    const bsuid = meta?.bsuid as string | undefined;
    const key = conversationKey(phone, bsuid);
    const now = new Date();

    // DB-level dedup: skip if identical message was logged in the last 10 seconds.
    // This prevents duplicates from multiple servers (local + Lightsail) writing
    // to the same Neon DB, or from Baileys double-fire events.
    const windowStart = new Date(now.getTime() - 10_000);
    const dupeCheck = await db.execute(sql`
      SELECT 1 FROM rainbow_messages
      WHERE phone = ${key}
        AND role = ${role}
        AND content = ${content}
        AND timestamp > ${windowStart}
      LIMIT 1
    `);
    if ((dupeCheck as any).rows?.length > 0) {
      console.log(`[ConvoLogger] Dedup: skipping duplicate ${role} message for ${key}`);
      return;
    }

    // US-910: Extract referral from meta if present
    const referral = meta?.referral as { sourceType: string; ctwaClid?: string; sourceId?: string; sourceUrl?: string; headline?: string; body?: string; mediaType?: string } | undefined;

    // Wrap upsert + insert + cap-delete in a single transaction (US-168)
    await db.transaction(async (tx) => {
      // Upsert conversation (with profileId, bsuid, and referral so it's correctly scoped)
      await upsertConversation(phone, pushName, meta?.instanceId, tx, meta?.profileId, bsuid, referral);

      // Insert message
      await tx.insert(rainbowMessages).values({
        phone: key,
        role,
        content,
        timestamp: now,
        profileId: meta?.profileId ?? null,
        intent: meta?.intent ?? null,
        confidence: meta?.confidence ?? null,
        action: meta?.action ?? null,
        manual: meta?.manual ?? null,
        source: meta?.source ?? null,
        model: meta?.model ?? null,
        responseTime: meta?.responseTime ?? null,
        kbFilesJson: meta?.kbFiles ? JSON.stringify(meta.kbFiles) : null,
        messageType: meta?.messageType ?? null,
        routedAction: meta?.routedAction ?? null,
        workflowId: meta?.workflowId ?? null,
        stepId: meta?.stepId ?? null,
        usageJson: (meta?.usage || meta?.staffName || meta?.complianceCategory)
          ? JSON.stringify({
              ...(meta?.usage || {}),
              ...(meta?.staffName ? { staffName: meta.staffName } : {}),
              ...(meta?.complianceCategory ? { complianceCategory: meta.complianceCategory } : {}),
            })
          : null,
        promptTokens: meta?.usage?.prompt_tokens ?? null,
        completionTokens: meta?.usage?.completion_tokens ?? null,
        totalTokens: meta?.usage?.total_tokens ?? null,
        transcribed: meta?.transcribed === true ? true : null,
        faithfulnessScore: meta?.faithfulnessScore ?? null,
        hallucinationAction: meta?.hallucinationAction ?? null,
        hallucinationSeverity: meta?.hallucinationSeverity ?? null,
      });

      // Cap at 500 messages per conversation
      const countResult = await tx
        .select({ count: sql<number>`count(*)` })
        .from(rainbowMessages)
        .where(eq(rainbowMessages.phone, key));

      const totalCount = Number(countResult[0]?.count ?? 0);
      if (totalCount > 500) {
        // Delete oldest messages beyond 500
        const excess = totalCount - 500;
        await tx.execute(sql`
          DELETE FROM rainbow_messages
          WHERE id IN (
            SELECT id FROM rainbow_messages
            WHERE phone = ${key}
            ORDER BY timestamp ASC
            LIMIT ${excess}
          )
        `);
      }
    });

    invalidateListCache();

    // Auto-update contact context file after assistant replies (debounced)
    if (role === 'assistant') {
      scheduleContextUpdate(key, pushName);
    }
  } catch (err: any) {
    console.error(`[ConvoLogger] Failed to log message for ${phone}:`, err.message);
  }
}

/** Log a user non-text message and the assistant reply in one write. */
export async function logNonTextExchange(
  phone: string,
  pushName: string,
  userPlaceholder: string,
  assistantReply: string,
  instanceId?: string,
  profileId?: string,
  bsuid?: string,
  messageType?: string,
  localMediaUrl?: string   // US-893: locally-saved media URL after auto-download
): Promise<void> {
  if (!(await ensureDb())) return;

  try {
    const key = conversationKey(phone, bsuid);
    const now = new Date();
    const nowPlus1 = new Date(now.getTime() + 1);

    // DB-level dedup: skip if this non-text exchange was already logged recently
    const windowStart = new Date(now.getTime() - 10_000);
    const dupeCheck = await db.execute(sql`
      SELECT 1 FROM rainbow_messages
      WHERE phone = ${key}
        AND role = 'user'
        AND content = ${userPlaceholder}
        AND timestamp > ${windowStart}
      LIMIT 1
    `);
    if ((dupeCheck as any).rows?.length > 0) {
      console.log(`[ConvoLogger] Dedup: skipping duplicate non-text exchange for ${key}`);
      return;
    }

    // Wrap upsert + insert in a single transaction (US-168)
    await db.transaction(async (tx) => {
      await upsertConversation(phone, pushName, instanceId, tx, profileId, bsuid);

      // Insert both messages (US-840: include messageType, US-893: include localMediaUrl)
      await tx.insert(rainbowMessages).values([
        { phone: key, role: 'user', content: userPlaceholder, timestamp: now, profileId: profileId ?? null, messageType: messageType ?? null, localMediaUrl: localMediaUrl ?? null },
        { phone: key, role: 'assistant', content: assistantReply, timestamp: nowPlus1, responseTime: 0, profileId: profileId ?? null },
      ]);
    });
  } catch (err: any) {
    console.error(`[ConvoLogger] Failed to log non-text exchange for ${phone}:`, err.message);
  }
}

/** List conversations with summaries, optionally scoped to a profile. */
export async function listConversations(profileId?: string): Promise<ConversationSummary[]> {
  const cached = getListCache(profileId);
  if (cached) return cached.data;

  if (!(await ensureDb())) return [];

  return withFallback(
    async () => {
      // Single query with LATERAL JOINs — eliminates N+1 problem
      // NOTE: db.execute(sql``) returns raw PG column names (snake_case), NOT Drizzle camelCase
      const profileFilter = profileId
        ? sql`AND c.profile_id = ${profileId}`
        : sql``;

      const result = await db.execute(sql`
        SELECT
          c.phone,
          c.push_name,
          c.instance_id,
          c.profile_id,
          c.pinned,
          c.favourite,
          c.created_at,
          c.last_read_at,
          c.referral_source_type,
          lm.content   AS last_msg_content,
          lm.role       AS last_msg_role,
          lm.timestamp  AS last_msg_at,
          COALESCE(mc.total, 0)::int  AS message_count,
          COALESCE(uc.unread, 0)::int AS unread_count,
          -- US-815: session window — true if last user msg within 24h
          COALESCE(sw.last_user_at > NOW() - INTERVAL '24 hours', false) AS session_active
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
            AND (
              c.last_read_at IS NULL
              OR timestamp > c.last_read_at
            )
        ) uc ON true
        LEFT JOIN LATERAL (
          SELECT MAX(timestamp) AS last_user_at
          FROM rainbow_messages
          WHERE phone = c.phone
            AND role = 'user'
        ) sw ON true
        WHERE lm.content IS NOT NULL
          AND c.phone NOT LIKE 'webchat-%'
          ${profileFilter}
        ORDER BY lm.timestamp DESC
      `);
      const rows: any[] = result.rows;

      const summaries: ConversationSummary[] = rows.map((r: any) => ({
        phone: r.phone,
        pushName: r.push_name,
        instanceId: r.instance_id ?? undefined,
        profileId: r.profile_id ?? undefined,
        lastMessage: (r.last_msg_content || '').slice(0, 100),
        lastMessageRole: r.last_msg_role as 'user' | 'assistant',
        lastMessageAt: r.last_msg_at instanceof Date
          ? r.last_msg_at.getTime()
          : new Date(r.last_msg_at).getTime(),
        messageCount: Number(r.message_count ?? 0),
        unreadCount: Number(r.unread_count ?? 0),
        pinned: r.pinned,
        favourite: r.favourite,
        createdAt: r.created_at instanceof Date
          ? r.created_at.getTime()
          : new Date(r.created_at).getTime(),
        sessionActive: r.session_active === true || r.session_active === 't', // US-815
        leadSource: r.referral_source_type || undefined, // US-910
      }));
      setListCache(summaries, profileId);
      return summaries;
    },
    async () => [],
    '[ConvoLogger] listConversations'
  );
}

/** Search conversations by message content (US-818) */
export async function searchConversations(
  query: string,
  profileId?: string,
  limit = 50,
): Promise<ConversationSummary[]> {
  if (!(await ensureDb())) return [];
  if (!query || query.trim().length === 0) return [];

  return withFallback(
    async () => {
      const searchTerm = `%${query.trim()}%`;
      const profileFilter = profileId
        ? sql`AND m.profile_id = ${profileId}`
        : sql``;

      const result = await db.execute(sql`
        SELECT DISTINCT ON (c.phone)
          c.phone,
          c.push_name,
          c.instance_id,
          c.profile_id,
          c.pinned,
          c.favourite,
          c.created_at,
          c.last_read_at,
          c.referral_source_type,
          lm.content   AS last_msg_content,
          lm.role       AS last_msg_role,
          lm.timestamp  AS last_msg_at,
          COALESCE(mc.total, 0)::int  AS message_count,
          COALESCE(uc.unread, 0)::int AS unread_count,
          COALESCE(sw.last_user_at > NOW() - INTERVAL '24 hours', false) AS session_active,
          match_ts.latest_match
        FROM rainbow_conversations c
        -- Find conversations that have at least one matching message
        INNER JOIN (
          SELECT phone, MAX(timestamp) AS latest_match
          FROM rainbow_messages
          WHERE content ILIKE ${searchTerm}
            AND deleted_at IS NULL
            ${profileFilter}
          GROUP BY phone
        ) match_ts ON match_ts.phone = c.phone
        -- Last message
        LEFT JOIN LATERAL (
          SELECT content, role, timestamp
          FROM rainbow_messages
          WHERE phone = c.phone AND deleted_at IS NULL
          ORDER BY timestamp DESC LIMIT 1
        ) lm ON true
        -- Message count
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS total
          FROM rainbow_messages
          WHERE phone = c.phone AND deleted_at IS NULL
        ) mc ON true
        -- Unread count
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS unread
          FROM rainbow_messages
          WHERE phone = c.phone
            AND role = 'user'
            AND deleted_at IS NULL
            AND (c.last_read_at IS NULL OR timestamp > c.last_read_at)
        ) uc ON true
        -- Session window
        LEFT JOIN LATERAL (
          SELECT MAX(timestamp) AS last_user_at
          FROM rainbow_messages
          WHERE phone = c.phone AND role = 'user' AND deleted_at IS NULL
        ) sw ON true
        WHERE c.deleted_at IS NULL
          AND c.phone NOT LIKE 'webchat-%'
        ORDER BY c.phone, match_ts.latest_match DESC
        LIMIT ${limit}
      `);

      // Re-sort by latest match descending (DISTINCT ON requires ORDER BY phone first)
      const rows: any[] = (result.rows as any[]).sort(
        (a: any, b: any) => new Date(b.latest_match).getTime() - new Date(a.latest_match).getTime()
      );

      return rows.map((r: any) => ({
        phone: r.phone,
        pushName: r.push_name,
        instanceId: r.instance_id ?? undefined,
        profileId: r.profile_id ?? undefined,
        lastMessage: (r.last_msg_content || '').slice(0, 100),
        lastMessageRole: r.last_msg_role as 'user' | 'assistant',
        lastMessageAt: r.last_msg_at instanceof Date
          ? r.last_msg_at.getTime()
          : new Date(r.last_msg_at).getTime(),
        messageCount: Number(r.message_count ?? 0),
        unreadCount: Number(r.unread_count ?? 0),
        pinned: r.pinned,
        favourite: r.favourite,
        createdAt: r.created_at instanceof Date
          ? r.created_at.getTime()
          : new Date(r.created_at).getTime(),
        sessionActive: r.session_active === true || r.session_active === 't',
        leadSource: r.referral_source_type || undefined, // US-910
      }));
    },
    async () => [],
    '[ConvoLogger] searchConversations'
  );
}

/** Get full conversation log for a phone number or BSUID */
export async function getConversation(phone: string): Promise<ConversationLog | null> {
  if (!(await ensureDb())) return null;

  return withFallback(
    async () => {
      const key = canonicalPhoneKey(phone);

      let convoRows = await db
        .select()
        .from(rainbowConversations)
        .where(eq(rainbowConversations.phone, key))
        .limit(1);

      // US-477: Fallback — try BSUID lookup if phone lookup found nothing
      if (convoRows.length === 0) {
        convoRows = await db
          .select()
          .from(rainbowConversations)
          .where(eq(rainbowConversations.bsuid, phone))
          .limit(1);
      }

      if (convoRows.length === 0) return null;
      const convo = convoRows[0];

      // Get all messages ordered by timestamp (exclude soft-deleted)
      const msgRows = await db
        .select()
        .from(rainbowMessages)
        .where(and(eq(rainbowMessages.phone, key), isNull(rainbowMessages.deletedAt)))
        .orderBy(rainbowMessages.timestamp);

      const messages = msgRows.map(rowToMessage);

      let contactDetails: ContactDetails | undefined;
      if (convo.contactDetailsJson) {
        try { contactDetails = JSON.parse(convo.contactDetailsJson); } catch { /* ignore */ }
      }

      // US-910: Build referral object from conversation columns
      let referral: import('./conversation-logger-types.js').ConversationReferral | undefined;
      if (convo.referralSourceType) {
        referral = {
          sourceType: convo.referralSourceType,
          ...(convo.referralCtwaClid ? { ctwaClid: convo.referralCtwaClid } : {}),
          ...(convo.referralSourceId ? { sourceId: convo.referralSourceId } : {}),
          ...(convo.referralHeadline ? { headline: convo.referralHeadline } : {}),
          ...(convo.referralBody ? { body: convo.referralBody } : {}),
          ...(convo.referralMediaType ? { mediaType: convo.referralMediaType } : {}),
          ...(convo.referralSourceUrl ? { sourceUrl: convo.referralSourceUrl } : {}),
        };
      }

      return {
        phone: convo.phone,
        pushName: convo.pushName,
        instanceId: convo.instanceId ?? undefined,
        messages,
        contactDetails,
        pinned: convo.pinned,
        favourite: convo.favourite,
        lastReadAt: convo.lastReadAt?.getTime(),
        responseMode: convo.responseMode ?? undefined,
        referral,
        createdAt: convo.createdAt.getTime(),
        updatedAt: convo.updatedAt.getTime(),
      };
    },
    async () => null,
    `[ConvoLogger] getConversation(${phone})`
  );
}

/** Mark conversation as read */
export async function markConversationAsRead(phone: string): Promise<void> {
  if (!(await ensureDb())) return;

  await withFallback(
    async () => {
      const key = canonicalPhoneKey(phone);
      await db
        .update(rainbowConversations)
        .set({ lastReadAt: new Date(), updatedAt: new Date() })
        .where(eq(rainbowConversations.phone, key));
      invalidateListCache();
    },
    async () => {},
    `[ConvoLogger] markConversationAsRead(${phone})`
  );
}

/** Delete a conversation log */
export async function deleteConversation(phone: string): Promise<boolean> {
  if (!(await ensureDb())) return false;

  return withFallback(
    async () => {
      const key = canonicalPhoneKey(phone);

      // Delete messages + conversation in a single transaction (US-168)
      await db.transaction(async (tx) => {
        await tx.delete(rainbowMessages).where(eq(rainbowMessages.phone, key));
        await tx.delete(rainbowConversations).where(eq(rainbowConversations.phone, key));
      });

      invalidateListCache();
      return true;
    },
    async () => false,
    `[ConvoLogger] deleteConversation(${phone})`
  );
}

export async function clearConversationMessages(phone: string): Promise<boolean> {
  if (!(await ensureDb())) return false;

  return withFallback(
    async () => {
      const key = canonicalPhoneKey(phone);
      await db.delete(rainbowMessages).where(eq(rainbowMessages.phone, key));
      invalidateListCache();
      return true;
    },
    async () => false,
    `[ConvoLogger] clearConversationMessages(${phone})`
  );
}

/** Toggle pin state for a conversation */
export async function togglePin(phone: string): Promise<boolean> {
  if (!(await ensureDb())) return false;

  return withFallback(
    async () => {
      const key = canonicalPhoneKey(phone);
      const rows = await db
        .select({ pinned: rainbowConversations.pinned })
        .from(rainbowConversations)
        .where(eq(rainbowConversations.phone, key))
        .limit(1);

      if (rows.length === 0) return false;
      const newPinned = !rows[0].pinned;

      await db
        .update(rainbowConversations)
        .set({ pinned: newPinned, updatedAt: new Date() })
        .where(eq(rainbowConversations.phone, key));

      invalidateListCache();
      return newPinned;
    },
    async () => false,
    `[ConvoLogger] togglePin(${phone})`
  );
}

/** Toggle favourite state for a conversation */
export async function toggleFavourite(phone: string): Promise<boolean> {
  if (!(await ensureDb())) return false;

  return withFallback(
    async () => {
      const key = canonicalPhoneKey(phone);
      const rows = await db
        .select({ favourite: rainbowConversations.favourite })
        .from(rainbowConversations)
        .where(eq(rainbowConversations.phone, key))
        .limit(1);

      if (rows.length === 0) return false;
      const newFav = !rows[0].favourite;

      await db
        .update(rainbowConversations)
        .set({ favourite: newFav, updatedAt: new Date() })
        .where(eq(rainbowConversations.phone, key));

      invalidateListCache();
      return newFav;
    },
    async () => false,
    `[ConvoLogger] toggleFavourite(${phone})`
  );
}

/** Update the response mode for a conversation (persists to DB). */
export async function updateConversationMode(phone: string, mode: string): Promise<void> {
  if (!(await ensureDb())) return;

  await withFallback(
    async () => {
      const key = canonicalPhoneKey(phone);
      await db
        .update(rainbowConversations)
        .set({ responseMode: mode, updatedAt: new Date() })
        .where(eq(rainbowConversations.phone, key));
    },
    async () => {},
    `[ConvoLogger] updateConversationMode(${phone})`
  );
}

/** Aggregate response time from all messages (for dashboard avg). */
export async function getResponseTimeStats(): Promise<{ count: number; sumMs: number; avgMs: number | null }> {
  if (!(await ensureDb())) return { count: 0, sumMs: 0, avgMs: null };

  return withFallback(
    async () => {
      const result = await db
        .select({
          count: sql<number>`count(*)`,
          sumMs: sql<number>`coalesce(sum(response_time_ms), 0)`,
        })
        .from(rainbowMessages)
        .where(
          and(
            eq(rainbowMessages.role, 'assistant'),
            gt(rainbowMessages.responseTime, 0)
          )
        );

      const count = Number(result[0]?.count ?? 0);
      const sumMs = Number(result[0]?.sumMs ?? 0);

      return {
        count,
        sumMs,
        avgMs: count > 0 ? Math.round(sumMs / count) : null,
      };
    },
    async () => ({ count: 0, sumMs: 0, avgMs: null }),
    '[ConvoLogger] getResponseTimeStats'
  );
}

// ─── One-time Dedup Cleanup (Baileys double-fire) ────────────────────

/**
 * Remove duplicate messages caused by Baileys firing messages.upsert twice.
 * Duplicates are identified as rows with the same phone + role + content
 * where timestamps are within 10 seconds of each other. Keeps the earlier row.
 * (10s window accounts for varying AI response times when pipeline runs twice)
 *
 * Safe to call on startup — runs once, idempotent.
 */
export async function deduplicateMessages(): Promise<number> {
  if (!(await ensureDb())) return 0;

  try {
    // Find and delete duplicate messages:
    // Same phone, role, content, timestamps within 10 seconds
    const result = await db.execute(sql`
      DELETE FROM rainbow_messages
      WHERE id IN (
        SELECT b.id
        FROM rainbow_messages a
        JOIN rainbow_messages b
          ON a.phone = b.phone
          AND a.role = b.role
          AND a.content = b.content
          AND a.id < b.id
          AND ABS(EXTRACT(EPOCH FROM (a.timestamp - b.timestamp))) < 10
      )
    `);

    const deleted = (result as any).rowCount ?? 0;
    if (deleted > 0) {
      console.log(`[ConvoLogger] Dedup cleanup: removed ${deleted} duplicate message(s)`);
      invalidateListCache();
    }
    return deleted;
  } catch (err: any) {
    console.error('[ConvoLogger] Dedup cleanup failed:', err.message);
    return 0;
  }
}
