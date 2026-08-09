/**
 * parity-db.ts — Synchronous SQLite helpers for Periskope-parity tables.
 * Uses better-sqlite3 prepared statements (synchronous) for low-latency event persistence.
 * Call initParityDb(sqlite) once after initDb().
 */
import type Database from 'better-sqlite3';

let _sqlite: Database.Database | null = null;

export function initParityDb(sqlite: Database.Database): void {
  _sqlite = sqlite;
}

function db(): Database.Database {
  if (!_sqlite) throw new Error('[parity-db] Not initialized — call initParityDb() first');
  return _sqlite;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Chat persistence ─────────────────────────────────────────────────────

export function upsertChat(jid: string, name: string | null, isGroup: boolean, ts: number): void {
  db().prepare(`
    INSERT INTO chats (jid, name, is_group, last_message_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
      name = COALESCE(excluded.name, name),
      last_message_at = MAX(COALESCE(last_message_at, 0), excluded.last_message_at),
      updated_at = excluded.updated_at
  `).run(jid, name, isGroup ? 1 : 0, ts, nowSec());
}

export function patchChat(jid: string, opts: {
  assigned_to?: string | null;
  custom_properties?: Record<string, any> | null;
  mute_until?: number | null;
}): void {
  const sets: string[] = ['updated_at = ?'];
  const vals: any[] = [nowSec()];
  if ('assigned_to' in opts) { sets.push('assigned_to = ?'); vals.push(opts.assigned_to ?? null); }
  if ('custom_properties' in opts) { sets.push('custom_properties = ?'); vals.push(opts.custom_properties != null ? JSON.stringify(opts.custom_properties) : null); }
  if ('mute_until' in opts) { sets.push('mute_until = ?'); vals.push(opts.mute_until ?? null); }
  vals.push(jid);
  db().prepare(`UPDATE chats SET ${sets.join(', ')} WHERE jid = ?`).run(...vals);
}

// ── Message persistence ──────────────────────────────────────────────────

export interface PersistedMessage {
  id: string;
  jid: string;
  fromMe: boolean;
  sender: string | null;
  ts: number;
  type: string;
  body: string | null;
  quotedId: string | null;
  rawJson: string;
  mediaPath?: string | null;
  mediaMime?: string | null;
  mediaSize?: number | null;
  mediaSha256?: string | null;
  durationMs?: number | null;
  mentions?: string | null;
  isForwarded?: boolean;
  expiresAt?: number | null;
}

export function persistMessage(msg: PersistedMessage): void {
  db().prepare(`
    INSERT INTO messages
      (id, jid, from_me, sender, ts, type, body, quoted_id, raw_json,
       media_path, media_mime, media_size, media_sha256, duration_ms,
       mentions, is_forwarded, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(
    msg.id, msg.jid, msg.fromMe ? 1 : 0, msg.sender, msg.ts, msg.type,
    msg.body ?? null, msg.quotedId ?? null, msg.rawJson,
    msg.mediaPath ?? null, msg.mediaMime ?? null, msg.mediaSize ?? null,
    msg.mediaSha256 ?? null, msg.durationMs ?? null, msg.mentions ?? null,
    msg.isForwarded ? 1 : 0, msg.expiresAt ?? null,
  );
}

export function markMessageDeleted(id: string): void {
  db().prepare(`UPDATE messages SET is_deleted = 1 WHERE id = ?`).run(id);
}

export function updateMessageEdited(id: string, newBody: string): void {
  db().prepare(`UPDATE messages SET body = ?, is_edited = 1, edited_at = ? WHERE id = ?`).run(newBody, nowSec(), id);
}

export function updateMessageStatus(id: string, status: number): void {
  db().prepare(`UPDATE messages SET status = ? WHERE id = ?`).run(status, id);
}

export function updateMessageMedia(id: string, mediaPath: string, mediaMime: string, mediaSize: number, mediaSha256: string): void {
  db().prepare(`UPDATE messages SET media_path = ?, media_mime = ?, media_size = ?, media_sha256 = ? WHERE id = ?`).run(mediaPath, mediaMime, mediaSize, mediaSha256, id);
}

// ── Reaction persistence ─────────────────────────────────────────────────

export function applyReaction(messageId: string, reactorJid: string, emoji: string): void {
  if (!emoji) {
    db().prepare(`DELETE FROM reactions WHERE message_id = ? AND reactor_jid = ?`).run(messageId, reactorJid);
  } else {
    db().prepare(`
      INSERT INTO reactions (message_id, reactor_jid, emoji, reacted_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id, reactor_jid) DO UPDATE SET emoji = excluded.emoji, reacted_at = excluded.reacted_at
    `).run(messageId, reactorJid, emoji, nowSec());
  }
}

// ── Receipt persistence ──────────────────────────────────────────────────

export function upsertReceipt(messageId: string, recipientJid: string, type: 'delivered' | 'read' | 'played', ts: number): void {
  const col = type === 'delivered' ? 'delivered_at' : type === 'read' ? 'read_at' : 'played_at';
  db().prepare(`
    INSERT INTO message_receipts (message_id, recipient_jid, ${col})
    VALUES (?, ?, ?)
    ON CONFLICT(message_id, recipient_jid) DO UPDATE SET ${col} = excluded.${col}
  `).run(messageId, recipientJid, ts);
}

// ── Contact persistence ──────────────────────────────────────────────────

export function upsertContact(jid: string, name: string | null, pushName: string | null, phone: string | null): void {
  db().prepare(`
    INSERT INTO contacts (jid, name, push_name, phone, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
      name = COALESCE(excluded.name, name),
      push_name = COALESCE(excluded.push_name, push_name),
      phone = COALESCE(excluded.phone, phone),
      updated_at = excluded.updated_at
  `).run(jid, name, pushName, phone, nowSec());
}

export function renameContact(jid: string, name: string): void {
  db().prepare(`UPDATE contacts SET name = ?, updated_at = ? WHERE jid = ?`).run(name, nowSec(), jid);
}

// ── LID map ──────────────────────────────────────────────────────────────

export function upsertLidMap(lid: string, rawLid: string, phone: string | null, jid: string | null): void {
  db().prepare(`
    INSERT INTO lid_map (lid, raw_lid, phone, jid, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(lid) DO UPDATE SET
      phone = COALESCE(excluded.phone, phone),
      jid = COALESCE(excluded.jid, jid),
      updated_at = excluded.updated_at
  `).run(lid, rawLid, phone, jid, nowSec());
}

// ── Group participants ───────────────────────────────────────────────────

export function upsertGroupParticipant(groupJid: string, participantJid: string, role: string): void {
  db().prepare(`
    INSERT INTO group_participants (group_jid, participant_jid, role, joined_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(group_jid, participant_jid) DO UPDATE SET role = excluded.role
  `).run(groupJid, participantJid, role, nowSec());
}

export function removeGroupParticipant(groupJid: string, participantJid: string): void {
  db().prepare(`DELETE FROM group_participants WHERE group_jid = ? AND participant_jid = ?`).run(groupJid, participantJid);
}

// ── Label management ─────────────────────────────────────────────────────

export function createLabel(name: string, color?: string): { id: string } {
  const id = newId();
  db().prepare(`INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)`).run(id, name, color ?? null, nowSec());
  return { id };
}

export function deleteLabel(id: string): void {
  const d = db();
  d.transaction(() => {
    d.prepare(`DELETE FROM chat_labels WHERE label_id = ?`).run(id);
    d.prepare(`DELETE FROM contact_labels WHERE label_id = ?`).run(id);
    d.prepare(`DELETE FROM labels WHERE id = ?`).run(id);
  })();
}

export function setChatLabels(chatJid: string, labelIds: string[]): void {
  const d = db();
  d.transaction(() => {
    d.prepare(`DELETE FROM chat_labels WHERE chat_jid = ?`).run(chatJid);
    for (const lid of labelIds) {
      d.prepare(`INSERT OR IGNORE INTO chat_labels (chat_jid, label_id) VALUES (?, ?)`).run(chatJid, lid);
    }
  })();
}

export function setContactLabels(contactJid: string, labelIds: string[]): void {
  const d = db();
  d.transaction(() => {
    d.prepare(`DELETE FROM contact_labels WHERE contact_jid = ?`).run(contactJid);
    for (const lid of labelIds) {
      d.prepare(`INSERT OR IGNORE INTO contact_labels (contact_jid, label_id) VALUES (?, ?)`).run(contactJid, lid);
    }
  })();
}

// ── Ticket management ────────────────────────────────────────────────────

export function createTicket(chatJid: string, title: string, opts: {
  status?: string; priority?: string; assigned_to?: string;
} = {}): { id: string } {
  const id = newId();
  const ts = nowSec();
  db().prepare(`
    INSERT INTO tickets (id, chat_jid, title, status, priority, assigned_to, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, chatJid, title, opts.status ?? 'open', opts.priority ?? 'normal', opts.assigned_to ?? null, ts, ts);
  return { id };
}

export function patchTicket(id: string, opts: {
  status?: string; priority?: string; assigned_to?: string | null; title?: string;
}): void {
  const sets: string[] = ['updated_at = ?'];
  const vals: any[] = [nowSec()];
  if (opts.status !== undefined) { sets.push('status = ?'); vals.push(opts.status); }
  if (opts.priority !== undefined) { sets.push('priority = ?'); vals.push(opts.priority); }
  if ('assigned_to' in opts) { sets.push('assigned_to = ?'); vals.push(opts.assigned_to ?? null); }
  if (opts.title !== undefined) { sets.push('title = ?'); vals.push(opts.title); }
  vals.push(id);
  db().prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteTicket(id: string): void {
  db().prepare(`DELETE FROM tickets WHERE id = ?`).run(id);
}

// ── Webhook management ───────────────────────────────────────────────────

function normalizeIntegrationName(raw: string | string[]): string {
  return JSON.stringify(Array.isArray(raw) ? raw : [raw]);
}

export function createWebhook(hookUrl: string, integrationName: string | string[], name?: string): { id: string } {
  const id = newId();
  db().prepare(`
    INSERT INTO webhooks (id, hook_url, integration_name, is_subscribed, subscribed_at, name)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(id, hookUrl, normalizeIntegrationName(integrationName), nowSec(), name ?? null);
  return { id };
}

export function patchWebhook(id: string, opts: {
  hook_url?: string; integration_name?: string | string[]; name?: string; is_subscribed?: boolean;
}): void {
  const sets: string[] = [];
  const vals: any[] = [];
  if (opts.hook_url !== undefined) { sets.push('hook_url = ?'); vals.push(opts.hook_url); }
  if (opts.integration_name !== undefined) { sets.push('integration_name = ?'); vals.push(normalizeIntegrationName(opts.integration_name)); }
  if (opts.name !== undefined) { sets.push('name = ?'); vals.push(opts.name); }
  if (opts.is_subscribed !== undefined) { sets.push('is_subscribed = ?'); vals.push(opts.is_subscribed ? 1 : 0); }
  if (sets.length === 0) return;
  vals.push(id);
  db().prepare(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteWebhook(id: string): void {
  db().prepare(`DELETE FROM webhooks WHERE id = ?`).run(id);
}

export function listActiveWebhooks(): any[] {
  return db().prepare(`SELECT * FROM webhooks WHERE is_subscribed = 1`).all();
}

export function recordDeliveryAttempt(opts: {
  deliveryId: string;
  webhookId: string;
  eventType: string;
  payload: string;
  attempt: number;
  statusCode: number | null;
  error: string | null;
  success: boolean;
}): void {
  const ts = nowSec();
  if (opts.attempt === 1) {
    db().prepare(`
      INSERT INTO webhook_deliveries
        (id, webhook_id, event_type, payload, attempt, status_code, error, delivered_at, failed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      opts.deliveryId, opts.webhookId, opts.eventType, opts.payload,
      opts.attempt, opts.statusCode, opts.error,
      opts.success ? ts : null, opts.success ? null : ts, ts,
    );
  } else {
    db().prepare(`
      UPDATE webhook_deliveries SET
        attempt = ?, status_code = ?, error = ?,
        delivered_at = CASE WHEN ? = 1 THEN ? ELSE delivered_at END,
        failed_at   = CASE WHEN ? = 0 THEN ? ELSE failed_at END
      WHERE id = ?
    `).run(
      opts.attempt, opts.statusCode, opts.error,
      opts.success ? 1 : 0, ts,
      opts.success ? 0 : 1, ts,
      opts.deliveryId,
    );
  }
}

// ── Query helpers ─────────────────────────────────────────────────────────

export function listChats(opts: {
  offset?: number; limit?: number;
  sortBy?: string; sortOrder?: string;
  unreadOnly?: boolean;
} = {}): any[] {
  const { offset = 0, limit = 50, sortBy = 'last_message_at', sortOrder = 'desc', unreadOnly = false } = opts;
  const col = sortBy === 'name' ? 'name' : 'last_message_at';
  const dir = sortOrder === 'asc' ? 'ASC' : 'DESC';
  const where = unreadOnly ? 'WHERE unread_count > 0' : '';
  return db().prepare(`SELECT * FROM chats ${where} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`).all(Math.min(limit, 2000), offset);
}

export function searchChats(q: string): any[] {
  return db().prepare(`SELECT * FROM chats WHERE name LIKE ? ORDER BY last_message_at DESC LIMIT 50`).all(`%${q}%`);
}

export function getChat(jid: string): any {
  return db().prepare(`SELECT * FROM chats WHERE jid = ?`).get(jid);
}

export function listMessages(jid: string, opts: {
  offset?: number; limit?: number; startTime?: number; endTime?: number;
} = {}): any[] {
  const { offset = 0, limit = 50, startTime, endTime } = opts;
  const clauses: string[] = ['jid = ?'];
  const vals: any[] = [jid];
  if (startTime != null) { clauses.push('ts >= ?'); vals.push(startTime); }
  if (endTime != null) { clauses.push('ts <= ?'); vals.push(endTime); }
  vals.push(Math.min(limit, 200), offset);
  return db().prepare(`SELECT * FROM messages WHERE ${clauses.join(' AND ')} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...vals);
}

export function getMessage(id: string, includeRaw = false): any {
  const msg = db().prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as any;
  if (!msg) return null;
  if (!includeRaw) delete msg.raw_json;
  const reactions = db().prepare(`SELECT * FROM reactions WHERE message_id = ?`).all(id);
  const receipts = db().prepare(`SELECT * FROM message_receipts WHERE message_id = ?`).all(id);
  return { ...msg, reactions, receipts };
}

export function getRecentMessages(limit = 20): any[] {
  return db().prepare(`SELECT * FROM messages ORDER BY ts DESC LIMIT ?`).all(Math.min(limit, 200));
}

export function searchMessages(q: string, opts: {
  startTime?: number; endTime?: number; limit?: number;
} = {}): any[] {
  const { startTime, endTime, limit = 50 } = opts;
  // FTS5: wrap in double-quotes to handle hyphens and special chars
  const escaped = `"${q.replace(/"/g, '""')}"`;
  const clauses: string[] = ['messages_fts MATCH ?'];
  const vals: any[] = [escaped];
  if (startTime != null) { clauses.push('m.ts >= ?'); vals.push(startTime); }
  if (endTime != null) { clauses.push('m.ts <= ?'); vals.push(endTime); }
  vals.push(Math.min(limit, 200));
  return db().prepare(`
    SELECT m.* FROM messages m
    JOIN messages_fts ON m.rowid = messages_fts.rowid
    WHERE ${clauses.join(' AND ')}
    ORDER BY m.ts DESC LIMIT ?
  `).all(...vals);
}

export function listContacts(opts: { offset?: number; limit?: number } = {}): any[] {
  const { offset = 0, limit = 50 } = opts;
  return db().prepare(`SELECT * FROM contacts ORDER BY name LIMIT ? OFFSET ?`).all(Math.min(limit, 1000), offset);
}

export function searchContacts(q: string): any[] {
  const like = `%${q}%`;
  return db().prepare(`SELECT * FROM contacts WHERE name LIKE ? OR phone LIKE ? OR jid LIKE ? LIMIT 50`).all(like, like, like);
}

export function getContact(jid: string): any {
  return db().prepare(`SELECT * FROM contacts WHERE jid = ?`).get(jid);
}

export function listLabels(): any[] {
  return db().prepare(`SELECT * FROM labels ORDER BY name`).all();
}

export function listTickets(opts: { offset?: number; limit?: number } = {}): any[] {
  const { offset = 0, limit = 50 } = opts;
  return db().prepare(`SELECT * FROM tickets ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(Math.min(limit, 500), offset);
}

export function getTicket(id: string): any {
  return db().prepare(`SELECT * FROM tickets WHERE id = ?`).get(id);
}

export function listWebhooks(opts: { offset?: number; limit?: number } = {}): any[] {
  const { offset = 0, limit = 50 } = opts;
  return db().prepare(`SELECT * FROM webhooks ORDER BY subscribed_at DESC LIMIT ? OFFSET ?`).all(Math.min(limit, 200), offset);
}

export function getWebhook(id: string): any {
  return db().prepare(`SELECT * FROM webhooks WHERE id = ?`).get(id);
}
