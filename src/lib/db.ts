/**
 * db.ts — SQLite-backed database layer (migrated from Neon PostgreSQL)
 *
 * Exports:
 *   - db        Drizzle SQLite instance (use for new code)
 *   - pool      PG-compatible shim backed by better-sqlite3 (for legacy raw-SQL callers)
 *   - dbReady   Promise<boolean> resolved after open
 *   - initDb()  Idempotent init (kept for AWS Secrets Manager compatibility)
 *   - getPoolMetrics()  Sync metrics stub
 *   - deleteExpiredConversations(retentionDays) PDPA retention helper
 *
 * Concurrency:
 *   - WAL mode for readers during writes
 *   - busy_timeout retries on lock contention
 *   - PM2 runs in fork mode (single process) so SQLite single-writer is fine
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { lt } from 'drizzle-orm';
import dotenv from 'dotenv';
import { join } from 'path';
import * as schema from '../../shared/schema.js';

// Declare the monkey-patched .execute() method on BetterSQLite3Database so
// TypeScript knows about it without changing runtime behaviour.
declare module 'drizzle-orm/better-sqlite3' {
  interface BetterSQLite3Database<
    TSchema extends Record<string, unknown> = Record<string, never>
  > {
    execute(query: import('drizzle-orm').SQL): Promise<{ rows: any[]; rowCount: number }>;
  }
}

dotenv.config();

// ─── Config ─────────────────────────────────────────────────────────────
const DEFAULT_DB_PATH = './data/rainbow-ai.db';

// ─── State (deferred init preserved for AWS Secrets Manager pattern) ────
let sqlite: Database.Database = undefined as unknown as Database.Database;
let _db: ReturnType<typeof drizzle> = undefined as unknown as ReturnType<typeof drizzle>;
let _dbReady: Promise<boolean> = Promise.resolve(false);
let _initialized = false;

// ─── PG → SQLite SQL translator ────────────────────────────────────────
/**
 * Translate PostgreSQL SQL to SQLite-compatible SQL.
 * Handles the common patterns found in this codebase's raw-SQL callers.
 * Idempotent — safe to call on already-translated SQL.
 */
function translatePgToSqlite(sql: string): string {
  let out = sql;

  // Placeholder style: $1, $2, ... → ?  (SQLite uses unnamed positional)
  // Duplicate $N references (same N used multiple times) are rebound by the
  // query() wrapper BEFORE calling this translator, so each surviving $N is
  // unique-in-order by the time we substitute.
  out = out.replace(/\$(\d+)/g, '?');

  // PostgreSQL type casts (::text, ::jsonb, ::uuid, ::text[]) — drop them
  out = out.replace(/::[a-zA-Z_][a-zA-Z0-9_]*(\s*\[\s*\])?/g, '');

  // Case-insensitive LIKE
  out = out.replace(/\bILIKE\b/gi, 'LIKE');

  // gen_random_uuid() → SQLite UUID v4 expression
  out = out.replace(
    /\bgen_random_uuid\s*\(\s*\)/gi,
    "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random())%4+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))",
  );

  // Column types (only meaningful inside CREATE TABLE / ALTER TABLE)
  out = out.replace(/\bBIGSERIAL\b/gi, 'INTEGER');
  out = out.replace(/\bSERIAL\b/gi, 'INTEGER');
  out = out.replace(/\bTIMESTAMPTZ\b/gi, 'TEXT');
  out = out.replace(/\bTIMESTAMP\s+WITH\s+TIME\s+ZONE\b/gi, 'TEXT');
  out = out.replace(/\bJSONB\b/gi, 'TEXT');
  out = out.replace(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');
  out = out.replace(/\bVARCHAR\b/gi, 'TEXT');
  out = out.replace(/\bUUID\b/gi, 'TEXT');
  out = out.replace(/\bBOOLEAN\b/gi, 'INTEGER');

  // NOW() → ISO-8601 UTC string with ms. Matches Postgres output format closely enough for app code.
  out = out.replace(/\bNOW\s*\(\s*\)/gi, "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))");

  // ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... → strip the IF NOT EXISTS
  // (SQLite has no such syntax. Duplicate-column errors are caught at exec time.)
  out = out.replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi, 'ADD COLUMN');

  // SQLite allows only ONE ADD COLUMN per ALTER TABLE. Postgres allows
  // comma-separated multiple clauses. Split "ALTER TABLE x ADD COLUMN a,
  // ADD COLUMN b, ADD COLUMN c;" into three separate ALTER statements.
  out = out.replace(
    /\bALTER\s+TABLE\s+(\w+)\s+((?:ADD\s+COLUMN\s+[^;]+?)(?:\s*,\s*ADD\s+COLUMN\s+[^;]+?)+)\s*(;|$)/gi,
    (_m, table, clauses, term) => {
      const parts = clauses.split(/\s*,\s*(?=ADD\s+COLUMN\b)/i);
      return parts.map((p: string) => `ALTER TABLE ${table} ${p.trim()}`).join(';\n') + term;
    },
  );

  // CREATE INDEX CONCURRENTLY → plain CREATE INDEX (SQLite has no concurrent build)
  out = out.replace(/\bCREATE\s+INDEX\s+CONCURRENTLY\b/gi, 'CREATE INDEX');
  out = out.replace(/\bCREATE\s+UNIQUE\s+INDEX\s+CONCURRENTLY\b/gi, 'CREATE UNIQUE INDEX');

  // DROP CONSTRAINT / DROP NOT NULL — SQLite doesn't support these ALTERs.
  // Strip common idempotent constraint drops so they're silently skipped.
  // (If a caller actually relies on dropping, they'll need a manual migration.)
  out = out.replace(/\bALTER\s+TABLE\s+\S+\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+\S+\s*;?/gi, '-- (dropped)');

  // EXTRACT(EPOCH FROM (A - B)) → ((julianday(A) - julianday(B)) * 86400)
  // SQLite has no EXTRACT; julianday returns days since Julian epoch, so seconds = days*86400.
  // Handles the common Postgres pattern of timestamp-difference-as-seconds.
  out = out.replace(
    /\bEXTRACT\s*\(\s*EPOCH\s+FROM\s*\(\s*([^()]+?)\s*-\s*([^()]+?)\s*\)\s*\)/gi,
    '((julianday($1) - julianday($2)) * 86400)',
  );
  // EXTRACT(EPOCH FROM X) → strftime('%s', X) (absolute epoch seconds)
  out = out.replace(
    /\bEXTRACT\s*\(\s*EPOCH\s+FROM\s+([^()]+?)\s*\)/gi,
    "CAST(strftime('%s', $1) AS INTEGER)",
  );

  // = ANY($n) is not translatable without knowing the array length at query-build time.
  // Callers must rewrite these to IN (?,?,?) with array spread. Fail loudly.
  if (/=\s*ANY\s*\(/i.test(out)) {
    throw new Error(
      '[pg-shim] `= ANY(...)` is not supported. Rewrite caller to use `IN (?,?,?)` with spread array. SQL: ' +
        sql.slice(0, 200),
    );
  }

  return out;
}

export interface PgLikeResult<T = any> {
  rows: T[];
  rowCount: number;
}

/**
 * PG Pool-compatible shim. Supports .query(sql, params) and event listeners (no-op).
 * Returns a Promise to match the pg Pool API, even though better-sqlite3 is synchronous.
 */
class PgShim {
  private ensureReady() {
    if (!sqlite) throw new Error('[db] initDb() not called — SQLite not opened');
  }

  async query<T = any>(
    textOrConfig: string | { text: string; values?: any[] },
    params?: any[],
  ): Promise<PgLikeResult<T>> {
    this.ensureReady();
    const origSql = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    const origValues =
      params ?? (typeof textOrConfig === 'object' ? textOrConfig.values : undefined) ?? [];

    // Expand duplicated $N references into unique positional bindings.
    // PostgreSQL allows the same $N to appear multiple times with a single
    // entry in the values array; SQLite's `?` (anonymous) placeholders do
    // not. Walk $N occurrences in order and build a parallel values array
    // so the translator's $N → ? substitution produces a matching param count.
    const expandedValues: any[] = [];
    const rawSql = origSql.replace(/\$(\d+)/g, (match, num) => {
      const idx = Number(num) - 1;
      expandedValues.push(origValues[idx]);
      // Use a temporary sentinel so the dollar-number regex in the translator
      // no longer matches — it'll be replaced with `?` by the translator.
      return `$${expandedValues.length}`;
    });
    const rawValues = expandedValues.length > 0 || origValues.length === 0 ? expandedValues : origValues;

    // Expand = ANY($n) where the bound param is an array.
    // Baileys auth-state queries use `= ANY($3)` with an array of key IDs.
    // Convert to `IN (?,?,?)` and splice the array items into the values list.
    // The new `?` placeholders sit in the correct positional slot; remaining
    // `$N` are left intact for translatePgToSqlite to convert to `?` normally.
    let anySql = rawSql;
    let anyValues = rawValues.slice() as any[];
    const anyPattern = /=\s*ANY\s*\(\s*\$(\d+)\s*\)/gi;
    const anyHits: Array<{ index: number; length: number; paramIdx: number }> = [];
    let anyHit: RegExpExecArray | null;
    while ((anyHit = anyPattern.exec(anySql)) !== null) {
      anyHits.push({ index: anyHit.index, length: anyHit[0].length, paramIdx: Number(anyHit[1]) - 1 });
    }
    // Process right-to-left so earlier string offsets stay valid
    for (let i = anyHits.length - 1; i >= 0; i--) {
      const { index, length, paramIdx } = anyHits[i];
      const arrVal = anyValues[paramIdx];
      const arr: any[] = Array.isArray(arrVal) ? arrVal : (arrVal != null ? [arrVal] : []);
      const placeholders = arr.length > 0 ? arr.map(() => '?').join(', ') : 'NULL';
      anySql = anySql.slice(0, index) + `IN (${placeholders})` + anySql.slice(index + length);
      anyValues.splice(paramIdx, 1, ...arr);
    }

    // SQLite bindings accept only number/string/bigint/Buffer/null.
    // Postgres JSONB params come through as plain objects/arrays — stringify them.
    // Booleans → 0/1. Dates → ISO string. Undefined → null.
    const values = anyValues.map((v: any) => {
      if (v === undefined) return null;
      if (v === null) return null;
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (v instanceof Date) return v.toISOString();
      if (Buffer.isBuffer(v)) return v;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    const sql = translatePgToSqlite(anySql);
    const trimmed = sql.trim();
    const lower = trimmed.toLowerCase();

    // Multi-statement DDL (CREATE TABLE ...; CREATE INDEX ...;) — no params.
    // Split on `;` and exec each statement individually so we can tolerate
    // idempotent-ALTER failures (duplicate column, table exists, etc).
    const bodyWithoutTrailingSemi = trimmed.replace(/;\s*$/, '');
    const hasInternalSemicolons = /;\s*\S/.test(bodyWithoutTrailingSemi);
    if (values.length === 0 && hasInternalSemicolons) {
      // Naive split — our DDL never contains semicolons inside string literals
      // or nested statements, so this is safe for the callers in this codebase.
      const statements = sql
        .split(/;\s*(?=\S|$)/)
        // Strip leading single-line comments from each chunk (they come
        // along with the statement they precede after the split).
        .map(s => s.replace(/^\s*(?:--[^\n]*\n\s*)+/g, '').trim())
        .filter(s => s.length > 0);
      for (const stmt of statements) {
        try {
          sqlite!.exec(stmt);
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          // Idempotent-DDL patterns we expect: duplicate column from ALTER ADD COLUMN
          // (which lacks IF NOT EXISTS in SQLite). Treat as success.
          if (/duplicate column name/i.test(msg)) continue;
          // Also tolerate "already exists" for tables/indexes without IF NOT EXISTS.
          if (/already exists/i.test(msg) && /IF\s+NOT\s+EXISTS/i.test(stmt) === false) continue;
          throw new Error(
            `[pg-shim] ${msg}\n---failing statement---\n${stmt}\n---full original SQL---\n${rawSql}`,
          );
        }
      }
      return { rows: [], rowCount: 0 };
    }

    try {
      const stmt = sqlite!.prepare(sql);
      // SELECT, CTE, or INSERT/UPDATE/DELETE ... RETURNING → rows
      if (
        lower.startsWith('select') ||
        lower.startsWith('with') ||
        /\breturning\b/i.test(sql)
      ) {
        const rows = stmt.all(...values) as T[];
        return { rows, rowCount: rows.length };
      }
      // Write with no RETURNING
      const info = stmt.run(...values);
      return { rows: [], rowCount: Number(info.changes) };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      throw new Error(
        `[pg-shim] ${msg}\n---translated SQL---\n${sql}\n---original SQL---\n${origSql}`,
      );
    }
  }

  // pg.Pool.connect() returns a client with .query and .release. Minimal compat:
  async connect() {
    this.ensureReady();
    return {
      query: (text: string | { text: string; values?: any[] }, params?: any[]) =>
        this.query(text, params),
      release: () => {
        /* no-op for SQLite */
      },
    };
  }

  // pg.Pool event listeners — no-op for SQLite
  on(_event: string, _handler: (...args: any[]) => void): this {
    return this;
  }

  // Metric fields pg.Pool exposes — keep stable
  get totalCount() {
    return sqlite ? 1 : 0;
  }
  get idleCount() {
    return sqlite ? 1 : 0;
  }
  get waitingCount() {
    return 0;
  }

  async end() {
    if (sqlite) sqlite.close();
  }
}

const _pool = new PgShim();

/**
 * Initialize SQLite + Drizzle. Idempotent.
 * Called automatically at module load if DATABASE_URL is set.
 * May be called explicitly after AWS Secrets Manager injects DATABASE_URL.
 */
export function initDb(): void {
  if (_initialized) return;
  _initialized = true;

  // Prefer SQLITE_PATH; ignore a Postgres-style DATABASE_URL (leftover from Neon era)
  const envPath = process.env.SQLITE_PATH
    ?? (process.env.DATABASE_URL && !/^postgres/i.test(process.env.DATABASE_URL)
        ? process.env.DATABASE_URL
        : undefined);
  const dbPath = envPath ?? DEFAULT_DB_PATH;
  console.log('[DB] Opening SQLite at:', dbPath);

  sqlite = new Database(dbPath);
  // WAL: concurrent reads during writes (essential for a WhatsApp bot)
  sqlite.pragma('journal_mode = WAL');
  // NORMAL is safe + fast (FULL is overkill for our durability needs)
  sqlite.pragma('synchronous = NORMAL');
  // Enforce FK constraints
  sqlite.pragma('foreign_keys = ON');
  // Retry on lock contention
  sqlite.pragma('busy_timeout = 5000');

  _db = drizzle(sqlite, { schema });

  // Auto-apply SQLite migrations (idempotent — tracks in __drizzle_migrations table)
  try {
    const migrationsFolder = join(process.cwd(), 'drizzle');
    migrate(_db, { migrationsFolder });
    console.log('[DB] ✅ Migrations applied');
  } catch (err: any) {
    console.warn('[DB] ⚠️ Migration warning (non-fatal):', err.message);
  }

  // Neon-compat: db.execute(sql``) returns `{ rows: [...], rowCount }`.
  // Drizzle's better-sqlite3 adapter has no `.execute()`, so we patch the
  // prototype. The shim compiles the Drizzle SQL template to SQL+params,
  // runs it through translatePgToSqlite (so callers can keep Postgres
  // syntax like EXTRACT EPOCH, ::text casts, NOW()), and dispatches to
  // `.all()` for SELECT / CTE / RETURNING queries, `.run()` otherwise.
  const sqliteDbProto = Object.getPrototypeOf(_db);
  if (!sqliteDbProto.execute) {
    sqliteDbProto.execute = function (query: any) {
      const compiled = this.dialect.sqlToQuery(query);
      const translated = translatePgToSqlite(compiled.sql);
      const lower = translated.trim().toLowerCase();
      // Coerce unsupported bind types (bool→0/1, Date→ISO, object→JSON) the
      // same way PgShim.query does — drizzle sql templates may contain these.
      const params = (compiled.params as any[]).map((v: any) => {
        if (v === undefined || v === null) return null;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (v instanceof Date) return v.toISOString();
        if (Buffer.isBuffer(v)) return v;
        if (typeof v === 'object') return JSON.stringify(v);
        return v;
      });
      const stmt = sqlite.prepare(translated);
      if (lower.startsWith('select') || lower.startsWith('with') || /\breturning\b/i.test(translated)) {
        const rows = stmt.all(...params) as any[];
        return { rows, rowCount: rows.length };
      }
      const info = stmt.run(...params);
      return { rows: [], rowCount: Number(info.changes) };
    };
  }

  _dbReady = Promise.resolve(true);

  console.log('[DB] ✅ SQLite opened (WAL, FK=on, busy_timeout=5000ms)');
}

/** Returns synchronous pool metrics without issuing any DB query. */
export function getPoolMetrics() {
  return {
    total: _pool.totalCount,
    idle: _pool.idleCount,
    waiting: _pool.waitingCount,
  };
}

/**
 * Deletes conversations older than specified days (US-157: PDPA 7-year retention).
 * Hard-deletes related messages and audit records.
 * @param retentionDays Number of days to retain (default: 2555 for 7 years)
 * @returns Object with count of deleted records
 */
export async function deleteExpiredConversations(retentionDays: number = 2555) {
  try {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    // Delete conversations older than cutoff
    const deletedConversations = await _db
      .delete(schema.rainbowConversations)
      .where(lt(schema.rainbowConversations.createdAt, cutoffDate))
      .returning({ phone: schema.rainbowConversations.phone });

    const phoneNumbers = deletedConversations.map((conv) => conv.phone);

    let deletedMessages = 0;
    let deletedAuditRecords = 0;

    if (phoneNumbers.length > 0) {
      // SQLite: IN (?,?,?) with array spread (was `= ANY($1)` on Postgres)
      const placeholders = phoneNumbers.map(() => '?').join(',');
      const msgResult = await _pool.query(
        `DELETE FROM rainbow_messages WHERE phone IN (${placeholders})`,
        phoneNumbers,
      );
      deletedMessages = msgResult.rowCount ?? 0;

      const auditResult = await _pool.query(
        `DELETE FROM conversation_audit WHERE phone IN (${placeholders})`,
        phoneNumbers,
      );
      deletedAuditRecords = auditResult.rowCount ?? 0;
    }

    const result = {
      retention_days: retentionDays,
      cutoff_date: cutoffDate.toISOString(),
      timestamp: now.toISOString(),
      records_deleted: {
        conversations: deletedConversations.length,
        messages: deletedMessages,
        audit_records: deletedAuditRecords,
      },
    };

    console.log(
      `[DataRetention] Expired data purge: ${deletedConversations.length} conversations, ${deletedMessages} messages, ${deletedAuditRecords} audit records deleted (cutoff: ${cutoffDate.toISOString()})`,
    );

    return result;
  } catch (error: any) {
    console.error('[DataRetention] deleteExpiredConversations failed:', error.message);
    throw error;
  }
}

// ─── Live-binding exports (preserves original db.ts API surface) ────────
export { _db as db, _pool as pool, _dbReady as dbReady };

/** Returns the raw better-sqlite3 Database instance for modules that need sync prepared statements. */
export function getSqlite(): Database.Database {
  if (!sqlite) throw new Error('[db] getSqlite() called before initDb()');
  return sqlite;
}

// Backward-compat: auto-init if not waiting on AWS Secrets Manager.
// If USE_SECRETS_MANAGER=true, initDb() must be called explicitly from index.ts
// after DATABASE_URL is injected.
if (!process.env.USE_SECRETS_MANAGER) {
  initDb();
}
