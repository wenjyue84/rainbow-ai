/**
 * migrate-neon-to-sqlite.mjs — One-shot data migration from Neon PG → SQLite.
 *
 * For each public table in the source PG:
 *  1. Read column definitions (name + data_type)
 *  2. Ensure the table exists in SQLite (auto-create with PG→SQLite type map
 *     if missing — handles the lazy-DDL tables not in Drizzle schema)
 *  3. Copy all rows, coercing JSONB/array/boolean/timestamp into SQLite-safe
 *     values (TEXT for JSON, 0/1 for bool, ISO string for timestamps)
 *
 * Usage:
 *   NEON_URL='postgresql://...' \
 *   SQLITE_PATH=./data/rainbow-ai.db \
 *   node scripts/migrate-neon-to-sqlite.mjs
 */
import pg from 'pg';
import Database from 'better-sqlite3';

const NEON_URL = process.env.NEON_URL;
const SQLITE_PATH = process.env.SQLITE_PATH ?? './data/rainbow-ai.db';

if (!NEON_URL) {
  console.error('NEON_URL env var required');
  process.exit(1);
}

const { Client } = pg;

// ─── PG → SQLite type mapping for auto-CREATE of missing tables ──────
function pgTypeToSqlite(pgType) {
  const t = pgType.toLowerCase();
  if (t.includes('int') || t.includes('serial')) return 'INTEGER';
  if (t.includes('bool')) return 'INTEGER';
  if (t.includes('json') || t === 'jsonb') return 'TEXT';
  if (t.includes('real') || t.includes('double') || t.includes('numeric') || t.includes('decimal')) return 'REAL';
  if (t.includes('bytea')) return 'BLOB';
  // uuid, text, varchar, timestamptz, timestamp, date, time, etc. → TEXT
  return 'TEXT';
}

// ─── Value coercion for SQLite bindings ──────────────────────────────
function coerce(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v;
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
  return v;
}

// ─── Main ────────────────────────────────────────────────────────────
const pgClient = new Client({ connectionString: NEON_URL });
await pgClient.connect();
console.log('[Neon] Connected');

const sqlite = new Database(SQLITE_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = OFF');
sqlite.pragma('foreign_keys = OFF'); // Defer FK checks during bulk load
console.log(`[SQLite] Opened ${SQLITE_PATH} (FK disabled during load)`);

// Tables in Neon
const { rows: neonTables } = await pgClient.query(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
);

const summary = [];
let totalRowsCopied = 0;

for (const { tablename } of neonTables) {
  process.stdout.write(`[${tablename}] `);

  // Column schema
  const { rows: cols } = await pgClient.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [tablename],
  );
  const colNames = cols.map((c) => c.column_name);

  // Ensure SQLite table exists
  const sqliteHasTable = sqlite
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tablename);
  if (!sqliteHasTable) {
    const ddl = `CREATE TABLE IF NOT EXISTS ${tablename} (${cols
      .map((c) => `"${c.column_name}" ${pgTypeToSqlite(c.data_type)}`)
      .join(', ')})`;
    sqlite.exec(ddl);
    process.stdout.write('[created] ');
  } else {
    // Add any Neon columns missing from SQLite (non-destructive)
    const existingCols = new Set(
      sqlite.prepare(`PRAGMA table_info(${tablename})`).all().map((r) => r.name),
    );
    const missing = cols.filter((c) => !existingCols.has(c.column_name));
    for (const c of missing) {
      try {
        sqlite.exec(
          `ALTER TABLE ${tablename} ADD COLUMN "${c.column_name}" ${pgTypeToSqlite(c.data_type)}`,
        );
        process.stdout.write(`[+${c.column_name}] `);
      } catch (err) {
        console.error(`\n  [${tablename}] could not add column ${c.column_name}: ${err.message}`);
      }
    }
  }

  // Row count in Neon
  const { rows: neonCountRows } = await pgClient.query(
    `SELECT COUNT(*)::bigint AS c FROM ${pgClient.escapeIdentifier(tablename)}`,
  );
  const neonCount = Number(neonCountRows[0].c);

  if (neonCount === 0) {
    console.log(`0 rows (skip)`);
    summary.push({ table: tablename, neon: 0, sqlite: 0, status: 'skip' });
    continue;
  }

  // Clear existing SQLite rows for idempotency
  sqlite.prepare(`DELETE FROM ${tablename}`).run();

  // Fetch all rows (streaming would be nicer but dataset is small)
  const { rows: data } = await pgClient.query(
    `SELECT * FROM ${pgClient.escapeIdentifier(tablename)}`,
  );

  // Insert with transaction
  const placeholders = colNames.map(() => '?').join(',');
  const cols_quoted = colNames.map((c) => `"${c}"`).join(',');
  const insert = sqlite.prepare(
    `INSERT INTO ${tablename} (${cols_quoted}) VALUES (${placeholders})`,
  );
  const insertMany = sqlite.transaction((rows) => {
    for (const row of rows) {
      try {
        insert.run(colNames.map((c) => coerce(row[c])));
      } catch (err) {
        // Log and skip bad rows
        console.error(`\n  [${tablename}] skip row: ${err.message}`);
      }
    }
  });
  insertMany(data);

  const sqliteCount = sqlite
    .prepare(`SELECT COUNT(*) AS c FROM ${tablename}`)
    .get().c;
  const status = sqliteCount === neonCount ? '✓' : '✗ MISMATCH';
  console.log(`${neonCount} → ${sqliteCount} ${status}`);
  summary.push({ table: tablename, neon: neonCount, sqlite: sqliteCount, status });
  totalRowsCopied += sqliteCount;
}

// Re-enable FK
sqlite.pragma('foreign_keys = ON');

console.log('\n─── Summary ──────────────────────────');
const mismatches = summary.filter((s) => s.status.includes('✗'));
console.log(`Tables processed: ${summary.length}`);
console.log(`Total rows copied: ${totalRowsCopied}`);
console.log(`Mismatches: ${mismatches.length}`);
if (mismatches.length > 0) {
  for (const m of mismatches) {
    console.log(`  ${m.table}: neon=${m.neon} sqlite=${m.sqlite}`);
  }
}

await pgClient.end();
sqlite.close();
process.exit(mismatches.length > 0 ? 1 : 0);
