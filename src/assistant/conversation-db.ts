/**
 * Database helpers for the Conversation Logger subsystem.
 *
 * Extracted from conversation-logger.ts — DB availability guard,
 * canonical phone key, row mapping, upsert, and list cache.
 */

import { db, dbReady } from '../lib/db.js';
import { rainbowConversations, rainbowMessages } from '../../shared/schema-tables.js';
import type { LoggedMessage, ConversationSummary } from './conversation-logger-types.js';

// ─── DB availability guard ──────────────────────────────────────────

let dbAvailable = false;

export async function ensureDb(): Promise<boolean> {
  if (dbAvailable) return true;
  try {
    const ready = await dbReady;
    dbAvailable = !!ready;
  } catch {
    dbAvailable = false;
  }
  return dbAvailable;
}

// ─── Canonical phone key (same as before) ───────────────────────────

export function canonicalPhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits || phone.replace(/[^a-zA-Z0-9@._-]/g, '_');
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
  txOrDb: Pick<typeof db, 'insert'> = db,
  profileId?: string
): Promise<void> {
  const key = canonicalPhoneKey(phone);
  const now = new Date();

  await txOrDb
    .insert(rainbowConversations)
    .values({
      phone: key,
      pushName,
      instanceId: instanceId ?? null,
      profileId: profileId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: rainbowConversations.phone,
      set: {
        pushName,
        ...(instanceId ? { instanceId } : {}),
        ...(profileId ? { profileId } : {}),
        updatedAt: now,
      },
    });
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
