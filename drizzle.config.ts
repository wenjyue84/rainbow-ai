import { defineConfig } from "drizzle-kit";

// SQLite migration: DATABASE_URL is a filesystem path, not a Postgres connection string.
// Default is ./data/rainbow-ai.db (relative to repo root for dev, absolute on VPS).
const url = process.env.DATABASE_URL ?? "./data/rainbow-ai.db";

export default defineConfig({
  schema: "./shared/schema-tables.ts",
  dialect: "sqlite",
  dbCredentials: { url },
  // Exclude tables managed outside Drizzle (raw SQL DDL in config-db.ts)
  tablesFilter: ["!rainbow_configs", "!rainbow_kb_files", "!rainbow_config_audit"],
});
