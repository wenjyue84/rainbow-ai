/**
 * One-shot script: convert shared/schema-tables.ts from pg-core → sqlite-core.
 * Run with: node scripts/convert-schema-to-sqlite.mjs
 * Idempotent: re-running on already-converted file is a no-op.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = resolve(__dirname, '../shared/schema-tables.ts');
let src = readFileSync(file, 'utf8');

// 1. Import swap
src = src.replace(
  /import \{ pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb, check \} from "drizzle-orm\/pg-core";/,
  'import { sqliteTable, text, integer, real, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";'
);

// 2. pgTable → sqliteTable
src = src.replaceAll('pgTable(', 'sqliteTable(');

// 3. serial("col").primaryKey() → integer("col").primaryKey({ autoIncrement: true })
src = src.replace(
  /serial\((".*?")\)\.primaryKey\(\)/g,
  'integer($1).primaryKey({ autoIncrement: true })'
);

// 4. varchar("col", { length: N }) → text("col")
src = src.replace(
  /varchar\((".*?"),\s*\{\s*length:\s*\d+\s*\}\)/g,
  'text($1)'
);

// 5. varchar("col") → text("col")
src = src.replace(/varchar\((".*?")\)/g, 'text($1)');

// 6. boolean("col") → integer("col", { mode: "boolean" })
src = src.replace(
  /boolean\((".*?")\)/g,
  'integer($1, { mode: "boolean" })'
);

// 7. jsonb("col") → text("col", { mode: "json" })
src = src.replace(
  /jsonb\((".*?")\)/g,
  'text($1, { mode: "json" })'
);

// 8. timestamp("col") → integer("col", { mode: "timestamp_ms" })
src = src.replace(
  /timestamp\((".*?")\)/g,
  'integer($1, { mode: "timestamp_ms" })'
);

// 9. .default(sql`gen_random_uuid()`) → .$defaultFn(() => crypto.randomUUID())
src = src.replace(
  /\.default\(sql`gen_random_uuid\(\)`\)/g,
  '.$defaultFn(() => crypto.randomUUID())'
);

// 10. .defaultNow() → .$defaultFn(() => new Date())
src = src.replaceAll('.defaultNow()', '.$defaultFn(() => new Date())');

// 11. Comment fixup in header
src = src.replace(
  / \* Contains Rainbow-owned pgTable definitions and table-derived types\./,
  ' * Contains Rainbow-owned sqliteTable definitions and table-derived types.'
);

writeFileSync(file, src, 'utf8');

// Verification counts
const remaining = {
  pgTable: (src.match(/\bpgTable\b/g) || []).length,
  varchar: (src.match(/\bvarchar\b/g) || []).length,
  timestamp: (src.match(/\btimestamp\(/g) || []).length,
  boolean: (src.match(/\bboolean\(/g) || []).length,
  jsonb: (src.match(/\bjsonb\(/g) || []).length,
  serial: (src.match(/\bserial\(/g) || []).length,
  gen_random_uuid: (src.match(/gen_random_uuid/g) || []).length,
  defaultNow: (src.match(/\.defaultNow\(\)/g) || []).length,
  sqliteTable: (src.match(/\bsqliteTable\(/g) || []).length,
};

console.log('Conversion counts (should all be 0 except sqliteTable):');
console.log(JSON.stringify(remaining, null, 2));
console.log(`\nsqliteTable count: ${remaining.sqliteTable} (expect ~50)`);
