/**
 * Database helpers for the Conversation Logger subsystem.
 *
 * Extracted from conversation-logger.ts — DB availability guard,
 * canonical phone key, row mapping, upsert, and list cache.
 */

import { eq, sql } from 'drizzle-orm';
import { db, dbReady, pool } from '../lib/db.js';
import { rainbowConversations, rainbowMessages } from '../../shared/schema-tables.js';
import type { LoggedMessage, ConversationSummary } from './conversation-logger-types.js';
import type { ReferralData } from './types.js';

// ─── DB availability guard ──────────────────────────────────────────

let dbAvailable = false;

export async function ensureDb(): Promise<boolean> {
  if (dbAvailable) return true;
  try {
    const ready = await dbReady;
    dbAvailable = !!ready;
    if (dbAvailable) ensureOptInColumns();
  } catch {
    dbAvailable = false;
  }
  return dbAvailable;
}

// ─── US-979: Opt-in audit columns migration ─────────────────────────

let _optInMigrationDone = false;
export function ensureOptInColumns(): void {
  if (_optInMigrationDone || !pool) return;
  _optInMigrationDone = true;
  pool.query(`
    ALTER TABLE rainbow_conversations
    ADD COLUMN IF NOT EXISTS opt_in_method TEXT,
    ADD COLUMN IF NOT EXISTS opt_in_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS opt_in_channel TEXT
  `).catch((err: Error) => {
    console.warn('[ConvoDB] US-979 migration warn:', err.message);
  });
}

// ─── US-477: BSUID helpers ──────────────────────────────────────────

/** BSUID format: two-letter country code + dot + alphanumeric (up to 128 chars) */
const BSUID_PATTERN = /^[A-Z]{2}\.[A-Za-z0-9]{1,125}$/;

/** Check if a string looks like a BSUID rather than an E.164 phone number. */
export function isBsuidIdentifier(value: string): boolean {
  return BSUID_PATTERN.test(value);
}

/** Prefix used for BSUID-only conversation keys (no phone available). */
const BSUID_KEY_PREFIX = 'bsuid:';

// ─── Canonical phone key ────────────────────────────────────────────

export function canonicalPhoneKey(phone: string): string {
  // US-477: Preserve BSUID-prefixed keys as-is
  if (phone.startsWith(BSUID_KEY_PREFIX)) return phone;
  const digits = phone.replace(/\D/g, '');
  return digits || phone.replace(/[^a-zA-Z0-9@._-]/g, '_');
}

/**
 * US-477: Build the canonical conversation key, BSUID-aware.
 * - If `from` is a real phone (>=7 digits), returns digit-only key.
 * - If `from` is a BSUID or non-phone, returns "bsuid:{value}" key.
 */
export function conversationKey(from: string, bsuid?: string): string {
  const stripped = from.replace(/@.*$/, ''); // strip JID suffix
  const digits = stripped.replace(/\D/g, '');

  // Real phone number: 7+ digits
  if (digits.length >= 7) return digits;

  // BSUID provided explicitly
  if (bsuid) return `${BSUID_KEY_PREFIX}${bsuid}`;

  // from itself looks like a BSUID
  if (isBsuidIdentifier(stripped)) return `${BSUID_KEY_PREFIX}${stripped}`;

  // Fallback to existing canonicalPhoneKey behavior
  return canonicalPhoneKey(from);
}

// ─── DB row → LoggedMessage ─────────────────────────────────────────

export function rowToMessage(row: typeof rainbowMessages.$inferSelect): LoggedMessage {
  const msg: LoggedMessage = {
    role: row.role as 'user' | 'assistant',
    content: row.content,
    timestamp: row.timestamp.getTime(),
  };
  if (row.intent) msg.intent = row.intent;
  if (row.confidence != null) msg.confidence = row.confidence;
  if (row.action) msg.action = row.action;
  if (row.manual) msg.manual = row.manual;
  if (row.source) msg.source = row.source;
  if (row.model) msg.model = row.model;
  if (row.responseTime != null) msg.responseTime = row.responseTime;
  if (row.kbFilesJson) {
    try { msg.kbFiles = JSON.parse(row.kbFilesJson); } catch { /* ignore */ }
  }
  if (row.messageType) msg.messageType = row.messageType;
  if (row.routedAction) msg.routedAction = row.routedAction;
  if (row.workflowId) msg.workflowId = row.workflowId;
  if (row.stepId) msg.stepId = row.stepId;
  if (row.usageJson) {
    try { msg.usage = JSON.parse(row.usageJson); } catch { /* ignore */ }
  }
  return msg;
}

// ─── Upsert conversation row ───────────────────────────────────────

export async function upsertConversation(
  phone: string,
  pushName: string,
  instanceId?: string,
  txOrDb: Pick<typeof db, 'insert' | 'select' | 'update' | 'delete'> = db,
  profileId?: string,
  bsuid?: string,
  referralData?: ReferralData
): Promise<void> {
  const key = conversationKey(phone, bsuid);
  const now = new Date();

  // US-910: Build referral columns — only set on insert (first message), not on conflict update
  // because referral is only present on the first inbound message of a CTWA session.
  const referralInsertFields = referralData ? {
    referralCtwaClid: referralData.ctwaClid ?? null,
    referralSourceId: referralData.sourceId ?? null,
    referralSourceType: referralData.sourceType ?? null,
    referralHeadline: referralData.headline ?? null,
    referralBody: referralData.body ?? null,
    referralJson: JSON.stringify(referralData),
  } : {};

  await txOrDb
    .insert(rainbowConversations)
    .values({
      phone: key,
      bsuid: bsuid ?? null,
      pushName,
      instanceId: instanceId ?? null,
      profileId: profileId ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      // US-979: Record inbound opt-in on first contact (only set on INSERT, not on conflict)
      optInMethod: 'inbound',
      optInAt: now,
      optInChannel: 'whatsapp',
      ...referralInsertFields,
    })
    .onConflictDoUpdate({
      target: rainbowConversations.phone,
      set: {
        pushName,
        status: 'active',  // US-444: ensure re-activated after idle timeout
        ...(bsuid ? { bsuid } : {}),
        ...(instanceId ? { instanceId } : {}),
        ...(profileId ? { profileId } : {}),
        // US-910: Only write referral fields on conflict if not already set (preserve first-message referral)
        ...(referralData?.ctwaClid ? { referralCtwaClid: referralData.ctwaClid } : {}),
        ...(referralData?.sourceId ? { referralSourceId: referralData.sourceId } : {}),
        ...(referralData?.sourceType ? { referralSourceType: referralData.sourceType } : {}),
        ...(referralData?.headline ? { referralHeadline: referralData.headline } : {}),
        ...(referralData?.body ? { referralBody: referralData.body } : {}),
        ...(referralData ? { referralJson: JSON.stringify(referralData) } : {}),
        // US-979: Do NOT overwrite opt_in_method/opt_in_at on conflict — preserve original consent record
        updatedAt: now,
      },
    });

  // US-477: Merge BSUID-only record into phone-keyed record when both identifiers present
  if (bsuid && !key.startsWith(BSUID_KEY_PREFIX)) {
    const bsuidKey = `${BSUID_KEY_PREFIX}${bsuid}`;
    await mergeBsuidConversation(key, bsuidKey, txOrDb);
  }
}

/**
 * US-477: Look up a conversation by BSUID when phone number is absent.
 * Returns the phone key of the matching conversation, or null.
 */
export async function lookupPhoneByBsuid(bsuid: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ phone: rainbowConversations.phone })
      .from(rainbowConversations)
      .where(eq(rainbowConversations.bsuid, bsuid))
      .limit(1);
    return rows.length > 0 ? rows[0].phone : null;
  } catch {
    return null;
  }
}

/**
 * US-477: Merge a BSUID-only conversation into a phone-keyed conversation.
 * Moves all messages from the old BSUID key to the phone key, then deletes
 * the old conversation record.
 */
async function mergeBsuidConversation(
  phoneKey: string,
  bsuidKey: string,
  txOrDb: Pick<typeof db, 'select' | 'update' | 'delete'> = db
): Promise<void> {
  try {
    // Check if a BSUID-only record exists
    const oldConvo = await txOrDb
      .select({ phone: rainbowConversations.phone })
      .from(rainbowConversations)
      .where(eq(rainbowConversations.phone, bsuidKey))
      .limit(1);

    if (oldConvo.length === 0) return; // No stale BSUID-only record

    // Move messages from old BSUID key to phone key
    await txOrDb
      .update(rainbowMessages)
      .set({ phone: phoneKey })
      .where(eq(rainbowMessages.phone, bsuidKey));

    // Delete the old BSUID-only conversation record
    await txOrDb
      .delete(rainbowConversations)
      .where(eq(rainbowConversations.phone, bsuidKey));

    console.log(`[ConvoDB] Merged BSUID conversation: ${bsuidKey} → ${phoneKey}`);
  } catch (err: any) {
    console.warn(`[ConvoDB] BSUID merge failed (${bsuidKey} → ${phoneKey}): ${err.message}`);
  }
}

// ─── List cache (per-profile) ────────────────────────────────────────

const _listCacheMap = new Map<string, { data: ConversationSummary[]; ts: number }>();
const LIST_CACHE_TTL = 10_000;
const LIST_CACHE_ALL_KEY = '__all__';

export function invalidateListCache(): void {
  _listCacheMap.clear();
}

export function getListCache(profileId?: string): { data: ConversationSummary[]; ts: number } | null {
  const key = profileId ?? LIST_CACHE_ALL_KEY;
  const entry = _listCacheMap.get(key);
  if (entry && Date.now() - entry.ts < LIST_CACHE_TTL) return entry;
  return null;
}

export function setListCache(data: ConversationSummary[], profileId?: string): void {
  const key = profileId ?? LIST_CACHE_ALL_KEY;
  _listCacheMap.set(key, { data, ts: Date.now() });
}
