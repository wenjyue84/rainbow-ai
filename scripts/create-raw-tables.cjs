const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS rainbow_configs (" +
    "key TEXT PRIMARY KEY, " +
    "data JSONB NOT NULL, " +
    "version INTEGER NOT NULL DEFAULT 1, " +
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), " +
    "updated_by TEXT)"
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS rainbow_kb_files (" +
    "filename TEXT PRIMARY KEY, " +
    "content TEXT NOT NULL, " +
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS rainbow_config_audit (" +
    "id SERIAL PRIMARY KEY, " +
    "config_key TEXT NOT NULL, " +
    "action TEXT NOT NULL, " +
    "changed_by TEXT, " +
    "server_role TEXT, " +
    "old_version INTEGER, " +
    "new_version INTEGER, " +
    "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
  );
  console.log("Raw pg tables created successfully");
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
