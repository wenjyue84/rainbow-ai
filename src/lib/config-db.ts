/**
 * config-db.ts — Postgres abstraction for shared Rainbow AI config
 *
 * Stores JSON configs and KB files in Postgres so both primary and standby
 * servers share the same state. Every function returns null / swallows errors
 * when DATABASE_URL is not set (backward compat with JSON-only mode).
 *
 * Tables:
 *   rainbow_configs      — key/JSONB store for all JSON config files
 *   rainbow_kb_files     — text store for .rainbow-kb/ markdown files
 *   rainbow_config_audit — append-only log of every config change
 */

import { pool } from './db.js';

// ─── Guard: skip all DB ops when no DATABASE_URL ────────────────────

function hasDB(): boolean {
  const url = process.env.DATABASE_URL ?? '';
  // Only enable Postgres config-sync for actual Postgres connections.
  // SQLite paths (./data/...) or unset DATABASE_URL → JSON-only mode.
  return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

// ─── Table Creation (idempotent) ────────────────────────────────────

export async function ensureConfigTables(): Promise<void> {
  if (!hasDB()) {
    console.log('[ConfigDB] No DATABASE_URL — running in JSON-only mode');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rainbow_configs (
        key         TEXT PRIMARY KEY,
        data        JSONB NOT NULL,
        version     INTEGER NOT NULL DEFAULT 1,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by  TEXT
      );

      CREATE TABLE IF NOT EXISTS rainbow_kb_files (
        filename    TEXT PRIMARY KEY,
        content     TEXT NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- US-409: Add staleness metadata to KB files
      ALTER TABLE rainbow_kb_files
        ADD COLUMN IF NOT EXISTS last_modified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS stale_threshold_days INTEGER NOT NULL DEFAULT 30;

      -- US-965: Add integrity columns for OWASP LLM04 KB integrity validation
      ALTER TABLE rainbow_kb_files
        ADD COLUMN IF NOT EXISTS sha256_hash TEXT,
        ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'local',
        ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS last_ingested_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ingested_by TEXT;

      CREATE TABLE IF NOT EXISTS rainbow_config_audit (
        id          SERIAL PRIMARY KEY,
        config_key  TEXT NOT NULL,
        action      TEXT NOT NULL,
        changed_by  TEXT,
        server_role TEXT,
        old_version INTEGER,
        new_version INTEGER,
        endpoint    TEXT,
        before_json JSONB,
        after_json  JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- US-847: Add missing columns to audit table (idempotent)
      ALTER TABLE rainbow_config_audit
        ADD COLUMN IF NOT EXISTS endpoint TEXT,
        ADD COLUMN IF NOT EXISTS before_json JSONB,
        ADD COLUMN IF NOT EXISTS after_json JSONB;

      -- US-847: Add indexes for audit log queries
      CREATE INDEX IF NOT EXISTS idx_rainbow_config_audit_endpoint ON rainbow_config_audit(endpoint);
      CREATE INDEX IF NOT EXISTS idx_rainbow_config_audit_changed_by ON rainbow_config_audit(changed_by);
      CREATE INDEX IF NOT EXISTS idx_rainbow_config_audit_created_at ON rainbow_config_audit(created_at);
      CREATE INDEX IF NOT EXISTS idx_rainbow_config_audit_changed_date ON rainbow_config_audit(changed_by, created_at);

      -- US-257: Admin audit log for config file change tracking with diffs
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id              SERIAL PRIMARY KEY,
        config_file     TEXT NOT NULL,
        changed_by      TEXT,
        previous_hash   TEXT,
        new_hash        TEXT NOT NULL,
        diff_summary    TEXT NOT NULL,
        timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_config_file ON admin_audit_log(config_file);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_changed_by ON admin_audit_log(changed_by);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_timestamp ON admin_audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_log_file_timestamp ON admin_audit_log(config_file, timestamp);

      -- US-831: Template quality events for Meta message_template_status_update webhook
      CREATE TABLE IF NOT EXISTS template_quality_events (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        template_name   TEXT NOT NULL,
        old_status      TEXT,
        new_status       TEXT NOT NULL,
        reason          TEXT,
        profile_id      TEXT DEFAULT 'pelangi',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_template_quality_events_name ON template_quality_events(template_name);
      CREATE INDEX IF NOT EXISTS idx_template_quality_events_created ON template_quality_events(created_at);

      -- US-879: Menu items table for live price/availability updates via admin API
      CREATE TABLE IF NOT EXISTS menu_items (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        profile       TEXT NOT NULL,
        name          TEXT NOT NULL,
        description   TEXT,
        price         NUMERIC(10,2) NOT NULL DEFAULT 0,
        category      TEXT NOT NULL DEFAULT 'General',
        allergens     TEXT NOT NULL DEFAULT '[]',
        dietary_flags TEXT NOT NULL DEFAULT '[]',
        available     BOOLEAN NOT NULL DEFAULT TRUE,
        display_order INTEGER NOT NULL DEFAULT 0,
        translations  TEXT NOT NULL DEFAULT '{}',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_menu_items_profile ON menu_items(profile);
      CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(profile, category);
      CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(profile, available);
      -- Idempotent migration for DBs that pre-date the translations column
      ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS translations TEXT NOT NULL DEFAULT '{}';

      -- US-962: Campaign pacing batch events (portfolio pacing pause tracking)
      CREATE TABLE IF NOT EXISTS campaign_pacing_events (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        batch_id        TEXT NOT NULL,
        profile_id      TEXT NOT NULL DEFAULT 'pelangi',
        phone           VARCHAR(32) NOT NULL,
        template_name   TEXT,
        message_content TEXT,
        error_code      INTEGER NOT NULL DEFAULT 131049,
        failure_type    VARCHAR(16) NOT NULL DEFAULT 'held',
        review_status   VARCHAR(16) NOT NULL DEFAULT 'pending',
        held_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at     TIMESTAMPTZ,
        reviewed_by     TEXT,
        instance_id     TEXT NOT NULL DEFAULT 'default'
      );
      CREATE INDEX IF NOT EXISTS idx_cpe_batch_id ON campaign_pacing_events(batch_id);
      CREATE INDEX IF NOT EXISTS idx_cpe_profile_held_at ON campaign_pacing_events(profile_id, held_at);
      CREATE INDEX IF NOT EXISTS idx_cpe_review_status ON campaign_pacing_events(review_status);
      CREATE INDEX IF NOT EXISTS idx_cpe_phone ON campaign_pacing_events(phone);
    `);
    console.log('[ConfigDB] Tables ensured (rainbow_configs, rainbow_kb_files, rainbow_config_audit, admin_audit_log, template_quality_events, menu_items, campaign_pacing_events)');
  } catch (err: any) {
    console.error('[ConfigDB] Failed to create tables:', err.message);
  }
}

// ─── Config CRUD ────────────────────────────────────────────────────

export async function loadConfigFromDB(key: string): Promise<any | null> {
  if (!hasDB()) return null;
  try {
    const { rows } = await pool.query(
      'SELECT data FROM rainbow_configs WHERE key = $1',
      [key]
    );
    return rows.length > 0 ? rows[0].data : null;
  } catch (err: any) {
    console.error(`[ConfigDB] loadConfigFromDB(${key}) failed:`, err.message);
    return null;
  }
}

export async function saveConfigToDB(
  key: string,
  data: unknown,
  changedBy?: string
): Promise<void> {
  if (!hasDB()) return;
  try {
    const serverRole = process.env.RAINBOW_ROLE || 'unknown';
    // UPSERT with version increment + audit in a single transaction
    await pool.query('BEGIN');

    // Get current version (if exists)
    const { rows: existing } = await pool.query(
      'SELECT version FROM rainbow_configs WHERE key = $1',
      [key]
    );
    const oldVersion = existing.length > 0 ? existing[0].version : null;
    const newVersion = oldVersion !== null ? oldVersion + 1 : 1;

    await pool.query(
      `INSERT INTO rainbow_configs (key, data, version, updated_at, updated_by)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (key)
       DO UPDATE SET data = $2, version = $3, updated_at = NOW(), updated_by = $4`,
      [key, JSON.stringify(data), newVersion, changedBy || null]
    );

    // Audit log
    await pool.query(
      `INSERT INTO rainbow_config_audit (config_key, action, changed_by, server_role, old_version, new_version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [key, oldVersion === null ? 'create' : 'update', changedBy || null, serverRole, oldVersion, newVersion]
    );

    await pool.query('COMMIT');
  } catch (err: any) {
    await pool.query('ROLLBACK').catch(() => {});
    throw err; // Let caller handle retry logic
  }
}

// ─── KB File CRUD ───────────────────────────────────────────────────

export async function loadAllKBFromDB(): Promise<Map<string, string> | null> {
  if (!hasDB()) return null;
  try {
    const { rows } = await pool.query('SELECT filename, content FROM rainbow_kb_files');
    if (rows.length === 0) return null;
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.filename, row.content);
    }
    return map;
  } catch (err: any) {
    console.error('[ConfigDB] loadAllKBFromDB() failed:', err.message);
    return null;
  }
}

export async function saveKBFileToDB(filename: string, content: string, lastModifiedAt?: Date): Promise<void> {
  if (!hasDB()) return;
  try {
    await pool.query(
      `INSERT INTO rainbow_kb_files (filename, content, updated_at, last_modified_at)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (filename)
       DO UPDATE SET content = $2, updated_at = NOW(), last_modified_at = COALESCE($3, rainbow_kb_files.last_modified_at)`,
      [filename, content, lastModifiedAt || null]
    );
  } catch (err: any) {
    console.error(`[ConfigDB] saveKBFileToDB(${filename}) failed:`, err.message);
  }
}

// ─── KB Staleness Queries ───────────────────────────────────────────

export interface KBFileHealth {
  filename: string;
  last_indexed_at: string;
  last_modified_at: string | null;
  stale_threshold_days: number;
  stale: boolean;
}

export async function getKBFilesHealth(): Promise<KBFileHealth[]> {
  if (!hasDB()) return [];
  try {
    const { rows } = await pool.query(`
      SELECT filename, updated_at AS last_indexed_at, last_modified_at, stale_threshold_days,
        CASE
          WHEN last_modified_at IS NULL THEN false
          WHEN last_modified_at < NOW() - (stale_threshold_days || ' days')::INTERVAL THEN true
          ELSE false
        END AS stale
      FROM rainbow_kb_files
      ORDER BY filename
    `);
    return rows;
  } catch (err: any) {
    console.error('[ConfigDB] getKBFilesHealth() failed:', err.message);
    return [];
  }
}

// ─── Audit Operations ───────────────────────────────────────────────

/**
 * US-847: Record a config change with before/after diff
 * Called by all config mutation routes to maintain audit trail
 */
export async function auditConfigChange(
  adminUser: string | null,
  endpoint: string,
  before: unknown | null,
  after: unknown
): Promise<void> {
  if (!hasDB()) return;
  try {
    const serverRole = process.env.RAINBOW_ROLE || 'unknown';
    await pool.query(
      `INSERT INTO rainbow_config_audit (changed_by, endpoint, before_json, after_json, server_role, action, created_at)
       VALUES ($1, $2, $3, $4, $5, 'config_update', NOW())`,
      [adminUser, endpoint, before ? JSON.stringify(before) : null, JSON.stringify(after), serverRole]
    );
  } catch (err: any) {
    console.error('[ConfigDB] auditConfigChange() failed:', err.message);
  }
}

/**
 * US-847: Query audit log with optional filtering by date range and admin user
 * @param limit Maximum number of records to return (default 100, per acceptance criteria)
 * @param adminUserFilter Optional filter by admin user
 * @param dateStart Optional start date (ISO 8601)
 * @param dateEnd Optional end date (ISO 8601)
 * @returns Array of audit log entries with before/after JSON
 */
export interface AuditLogEntry {
  id: number;
  changed_by: string | null;
  endpoint: string | null;
  before_json: any;
  after_json: any;
  server_role: string | null;
  action: string;
  created_at: Date;
}

export async function getConfigAuditLog(
  limit: number = 100,
  adminUserFilter?: string,
  dateStart?: string,
  dateEnd?: string
): Promise<AuditLogEntry[]> {
  if (!hasDB()) return [];
  try {
    let query = `SELECT id, changed_by, endpoint, before_json, after_json, server_role, action, created_at
                 FROM rainbow_config_audit WHERE 1=1`;
    const params: any[] = [];

    if (adminUserFilter) {
      query += ` AND changed_by = $${params.length + 1}`;
      params.push(adminUserFilter);
    }

    if (dateStart) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(new Date(dateStart));
    }

    if (dateEnd) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(new Date(dateEnd));
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(query, params);
    return rows;
  } catch (err: any) {
    console.error('[ConfigDB] getConfigAuditLog() failed:', err.message);
    return [];
  }
}

// ─── US-965: KB Integrity Functions ──────────────────────────────────

/**
 * Save a KB file with SHA-256 hash verification.
 * Rejects re-ingestion if content hash changed without explicit approval.
 */
export async function saveKBFileWithHash(
  filename: string,
  content: string,
  hash: string,
  source: string,
  lastModifiedAt?: Date,
  operator: string = 'system'
): Promise<{ accepted: boolean; reason?: string }> {
  if (!hasDB()) return { accepted: true };
  try {
    // Check existing file hash
    const { rows } = await pool.query(
      'SELECT sha256_hash, approved FROM rainbow_kb_files WHERE filename = $1',
      [filename]
    );

    if (rows.length > 0 && rows[0].sha256_hash && rows[0].sha256_hash !== hash) {
      // Hash changed — mark as unapproved, require operator approval
      await pool.query(
        `UPDATE rainbow_kb_files SET sha256_hash = $2, approved = FALSE, source = $3,
         last_ingested_at = NOW(), ingested_by = $4, last_modified_at = COALESCE($5, last_modified_at)
         WHERE filename = $1`,
        [filename, hash, source, operator, lastModifiedAt || null]
      );
      await auditKBEvent('hash_changed', filename, hash, operator,
        `Hash changed from ${rows[0].sha256_hash} to ${hash} — requires approval`);
      return { accepted: false, reason: 'Content hash changed — operator approval required' };
    }

    // New file or same hash — accept and store
    await pool.query(
      `INSERT INTO rainbow_kb_files (filename, content, sha256_hash, source, approved, last_ingested_at, ingested_by, updated_at, last_modified_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), $5, NOW(), $6)
       ON CONFLICT (filename)
       DO UPDATE SET content = $2, sha256_hash = $3, source = $4, approved = TRUE,
         last_ingested_at = NOW(), ingested_by = $5, updated_at = NOW(),
         last_modified_at = COALESCE($6, rainbow_kb_files.last_modified_at)`,
      [filename, content, hash, source, operator, lastModifiedAt || null]
    );

    const action = rows.length > 0 ? 'update' : 'add';
    await auditKBEvent(action, filename, hash, operator);
    return { accepted: true };
  } catch (err: any) {
    console.error(`[ConfigDB] saveKBFileWithHash(${filename}) failed:`, err.message);
    return { accepted: true }; // fail-open
  }
}

/**
 * Approve a KB file whose hash changed, allowing re-ingestion.
 */
export async function approveKBFile(
  filename: string,
  content: string,
  hash: string,
  operator: string
): Promise<boolean> {
  if (!hasDB()) return true;
  try {
    await pool.query(
      `UPDATE rainbow_kb_files SET content = $2, sha256_hash = $3, approved = TRUE,
       last_ingested_at = NOW(), ingested_by = $4, updated_at = NOW()
       WHERE filename = $1`,
      [filename, content, hash, operator]
    );
    await auditKBEvent('approved', filename, hash, operator);
    return true;
  } catch (err: any) {
    console.error(`[ConfigDB] approveKBFile(${filename}) failed:`, err.message);
    return false;
  }
}

/**
 * Log a KB ingest event to the audit table.
 */
export async function auditKBEvent(
  action: string,
  filename: string,
  hash: string,
  operator: string,
  reason?: string
): Promise<void> {
  if (!hasDB()) return;
  try {
    const serverRole = process.env.RAINBOW_ROLE || 'unknown';
    await pool.query(
      `INSERT INTO rainbow_config_audit (config_key, action, changed_by, server_role, endpoint, after_json, created_at)
       VALUES ($1, $2, $3, $4, 'kb_ingest', $5, NOW())`,
      [
        `kb:${filename}`,
        action,
        operator,
        serverRole,
        JSON.stringify({ hash, reason: reason || null }),
      ]
    );
  } catch (err: any) {
    console.error(`[ConfigDB] auditKBEvent(${action}, ${filename}) failed:`, err.message);
  }
}

/**
 * Get all KB files pending operator approval (hash changed).
 */
export async function getUnapprovedKBFiles(): Promise<Array<{
  filename: string;
  sha256_hash: string;
  source: string;
  last_ingested_at: Date;
  ingested_by: string;
}>> {
  if (!hasDB()) return [];
  try {
    const { rows } = await pool.query(
      `SELECT filename, sha256_hash, source, last_ingested_at, ingested_by
       FROM rainbow_kb_files WHERE approved = FALSE ORDER BY last_ingested_at DESC`
    );
    return rows;
  } catch (err: any) {
    console.error('[ConfigDB] getUnapprovedKBFiles() failed:', err.message);
    return [];
  }
}
