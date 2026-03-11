import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required — ensure the database is provisioned");
}

export default defineConfig({
  schema: "./shared/schema-tables.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Exclude tables managed outside Drizzle (raw pg config tables)
  tablesFilter: ["!rainbow_configs", "!rainbow_kb_files", "!rainbow_config_audit"],
});
