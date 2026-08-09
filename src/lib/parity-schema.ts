/**
 * parity-schema.ts — CREATE TABLE IF NOT EXISTS for Periskope-parity tables.
 * Called once at startup after initDb(). Idempotent — safe to run on existing DB.
 * These tables live in the same SQLite file as the Drizzle/rainbow tables but
 * have completely separate names (no "rainbow_" prefix conflict).
 */
import type Database from 'better-sqlite3';

const TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    name TEXT,
    is_group INTEGER DEFAULT 0,
    last_message_at INTEGER,
    unread_count INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    pinned INTEGER DEFAULT 0,
    assigned_to TEXT,
    custom_properties TEXT,
    mute_until INTEGER,
    description TEXT,
    updated_at INTEGER
  )`,

  `CREATE INDEX IF NOT EXISTS idx_chats_last_message ON chats(last_message_at DESC)`,

  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    jid TEXT NOT NULL,
    from_me INTEGER DEFAULT 0,
    sender TEXT,
    ts INTEGER NOT NULL,
    type TEXT DEFAULT 'text',
    body TEXT,
    quoted_id TEXT,
    media_path TEXT,
    raw_json TEXT,
    status INTEGER DEFAULT 0,
    is_edited INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    edited_at INTEGER,
    media_mime TEXT,
    media_size INTEGER,
    media_sha256 TEXT,
    duration_ms INTEGER,
    mentions TEXT,
    is_forwarded INTEGER DEFAULT 0,
    expires_at INTEGER
  )`,

  `CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages(jid)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts DESC)`,

  // FTS5 full-text search on message body
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(body, content=messages, content_rowid=rowid)`,

  `CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
     INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
   END`,

  `CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
     INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
   END`,

  `CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
     INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
     INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
   END`,

  `CREATE TABLE IF NOT EXISTS contacts (
    jid TEXT PRIMARY KEY,
    name TEXT,
    push_name TEXT,
    phone TEXT,
    updated_at INTEGER
  )`,

  `CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone)`,

  `CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    created_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS chat_labels (
    chat_jid TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (chat_jid, label_id)
  )`,

  `CREATE TABLE IF NOT EXISTS contact_labels (
    contact_jid TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (contact_jid, label_id)
  )`,

  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    chat_jid TEXT NOT NULL,
    title TEXT,
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'normal',
    assigned_to TEXT,
    custom_properties TEXT,
    due_date INTEGER,
    created_at INTEGER,
    updated_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS group_participants (
    group_jid TEXT NOT NULL,
    participant_jid TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at INTEGER,
    PRIMARY KEY (group_jid, participant_jid)
  )`,

  `CREATE TABLE IF NOT EXISTS message_receipts (
    message_id TEXT NOT NULL,
    recipient_jid TEXT NOT NULL,
    delivered_at INTEGER,
    read_at INTEGER,
    played_at INTEGER,
    PRIMARY KEY (message_id, recipient_jid)
  )`,

  `CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL,
    reactor_jid TEXT NOT NULL,
    emoji TEXT,
    reacted_at INTEGER,
    PRIMARY KEY (message_id, reactor_jid)
  )`,

  `CREATE TABLE IF NOT EXISTS lid_map (
    lid TEXT PRIMARY KEY,
    raw_lid TEXT,
    phone TEXT,
    jid TEXT,
    updated_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    hook_url TEXT NOT NULL,
    integration_name TEXT NOT NULL,
    is_subscribed INTEGER DEFAULT 1,
    subscribed_at INTEGER,
    name TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    event_type TEXT,
    payload TEXT,
    attempt INTEGER DEFAULT 0,
    status_code INTEGER,
    error TEXT,
    delivered_at INTEGER,
    failed_at INTEGER,
    created_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at INTEGER
  )`,
];

export function initParitySchema(sqlite: Database.Database): void {
  for (const sql of TABLES) {
    try {
      sqlite.exec(sql);
    } catch (err: any) {
      // Tolerate "already exists" — this is idempotent by design
      if (!/already exists/i.test(err.message)) {
        console.warn('[ParitySchema] Warning:', err.message.slice(0, 120));
      }
    }
  }

  // Record migration versions
  const stamp = Math.floor(Date.now() / 1000);
  try {
    sqlite.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run('001-parity', stamp);
    sqlite.prepare(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`).run('002-webhooks', stamp);
  } catch { /* non-fatal */ }

  console.log('[ParitySchema] ✅ Parity tables ready');
}
