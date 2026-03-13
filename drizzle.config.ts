import { defineConfig } from "drizzle-kit";
import { resolveMigrationUrl } from "./src/lib/db-url.js";

const { url, warnings } = resolveMigrationUrl({
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL,
});

for (const w of warnings) {
  console.warn(`[drizzle-kit] ⚠️  ${w}`);
}

export default defineConfig({
  schema: "./shared/schema-tables.ts",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
  // Exclude tables managed outside Drizzle (raw pg config tables)
  tablesFilter: ["!rainbow_configs", "!rainbow_kb_files", "!rainbow_config_audit"],
});
