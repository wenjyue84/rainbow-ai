# SQLite Migration Audit

Generated for the Neon → SQLite migration. Read this before editing code.

## TL;DR of scope

- **Drizzle schema:** `shared/schema-tables.ts` — 1010 lines, 41+ tables. 18 `varchar().default(sql\`gen_random_uuid()\`)` primary keys. 115 PG-specific type usages.
- **Raw pool.query callers:** 26 files, 118+ call sites.
- **Self-initializing raw-SQL tables** (NOT in Drizzle schema): 13+ tables created via `CREATE TABLE IF NOT EXISTS` in their own modules.
- **PG-only SQL features found:** `gen_random_uuid()`, `= ANY($1)`, `ILIKE`, `::text`/`::jsonb` casts, `EXCLUDED.`, `NOW()`.

## Files that use `pool.query` / `pool.connect`

Hot list (non-test):

| File | Notes |
|---|---|
| `src/lib/whatsapp/db-auth-state.ts` | `baileys_auth_state` lazy DDL, `= ANY($3)`, upsert |
| `src/lib/session-window.ts` | `= ANY($1)` |
| `src/lib/config-db.ts` | `rainbow_configs`, `rainbow_kb_files`, `rainbow_config_audit` DDL (the 3 tables excluded from Drizzle) |
| `src/lib/menu-items-store.ts` | 2x lazy DDL with `gen_random_uuid()::text` |
| `src/lib/data-retention.ts` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| `src/lib/marketing-optin.ts` | lazy DDL |
| `src/lib/sticker-manager.ts` | lazy DDL |
| `src/lib/booking-sequence.ts` | insert uses `gen_random_uuid()` |
| `src/lib/template-rejection-monitor.ts` | insert uses `gen_random_uuid()` |
| `src/lib/campaign-pacing.ts` | |
| `src/lib/escalation-events.ts` | |
| `src/lib/einvoice-queue.ts` | |
| `src/lib/service-requests.ts` | |
| `src/lib/webhook-raw-events.ts` | |
| `src/assistant/consent.ts` | `consent_records` lazy DDL |
| `src/assistant/cart-recovery.ts` | `abandoned_carts` lazy DDL |
| `src/tools/service-requests.ts` | |
| `src/routes/webhooks/handlers.ts` | |
| `src/routes/admin/auth.ts` | |
| `src/routes/admin/feedback.ts` | |
| `src/routes/admin/dpa-registry.ts` | |
| `src/routes/admin/gdpr-erasure.ts` | lazy DDL |
| `src/routes/admin/gdpr-data-export.ts` | lazy DDL |
| `src/routes/admin/pdpa-portability.ts` | lazy DDL |
| `src/routes/admin/breach-report.ts` | 2x lazy DDL |
| `src/assistant/conversation-logger.ts` | uses `ILIKE` |

## Self-initializing tables (not in Drizzle)

Each of these CREATE TABLE statements needs to be ported to SQLite-compatible DDL:

1. `baileys_auth_state` — `SERIAL PRIMARY KEY`, `TIMESTAMPTZ DEFAULT NOW()`
2. `consent_records` (from consent.ts)
3. `abandoned_carts` (from cart-recovery.ts)
4. `rainbow_configs`, `rainbow_kb_files`, `rainbow_config_audit` (from config-db.ts) — UUID PKs, JSONB, TIMESTAMPTZ
5. `menu_items` + menu sub-tables (from menu-items-store.ts)
6. `data_retention_audit` (from data-retention.ts)
7. `marketing_optin` (from marketing-optin.ts)
8. `festive_stickers_audit` (from sticker-manager.ts)
9. GDPR request tables (gdpr-erasure, gdpr-data-export, pdpa-portability, breach-report)
10. Plus others in admin routes

Equivalent SQLite DDL rules:
- `SERIAL PRIMARY KEY` → `INTEGER PRIMARY KEY AUTOINCREMENT`
- `UUID PRIMARY KEY DEFAULT gen_random_uuid()` → `TEXT PRIMARY KEY` (generate UUID in app before INSERT)
- `VARCHAR(n)` → `TEXT`
- `TIMESTAMPTZ DEFAULT NOW()` → `INTEGER DEFAULT (unixepoch() * 1000)`
- `JSONB` → `TEXT` (store JSON as string)
- `BOOLEAN` → `INTEGER` (0/1)
- `ON CONFLICT (cols) DO UPDATE SET x = EXCLUDED.x` → **works in SQLite** unchanged

## Driver result shape differences

**pg (current):** `const result = await pool.query(sql, params); result.rows[0].column`
**better-sqlite3 via Drizzle:** `const rows = db.all(sql, params); rows[0].column`
**better-sqlite3 native:** `const stmt = sqlite.prepare(sql); const rows = stmt.all(...params);` — synchronous (no `await`)

Plan: keep `await` semantics by wrapping in `Promise.resolve(...)` where needed, or make callers synchronous.

## SQL patterns requiring rewrite

### `= ANY($n)` → `IN (?,?,?)`
Files: `src/lib/whatsapp/db-auth-state.ts:52`, `src/lib/session-window.ts:61`.
Pattern:
```ts
// Before
await pool.query(`... WHERE key_id = ANY($3)`, [a, b, keyIds]);
// After (expand array into placeholders)
const placeholders = keyIds.map(() => '?').join(',');
db.all(`... WHERE key_id IN (${placeholders})`, [a, b, ...keyIds]);
```

### `ILIKE` → `LIKE` + `COLLATE NOCASE`
File: `src/assistant/conversation-logger.ts:366`.

### `$1, $2, ...` → `?, ?, ...`
better-sqlite3 uses `?` placeholders, not numbered `$n`. Every lazy-DDL caller needs this.

### `result.rows` → direct array
pg wraps results in `{ rows: [] }`. better-sqlite3 returns arrays directly.

## `shared/schema-tables.ts` type rewrites

Current imports from `drizzle-orm/pg-core`. Usage patterns:

- 18x `varchar("id").primaryKey().default(sql\`gen_random_uuid()\`)` → `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`
- `timestamp(...)` / `timestamptz(...)` → `integer(..., { mode: "timestamp_ms" })`
- `boolean(...)` → `integer(..., { mode: "boolean" })`
- `jsonb(...)` / `json(...)` → `text(..., { mode: "json" }).$type<T>()`
- `.array()` on text → `text({ mode: "json" }).$type<string[]>()`
- `serial(...)` → `integer().primaryKey({ autoIncrement: true })`
- `pgEnum(...)` → `text(...)` + TS union type + runtime validation

## db.ts API surface (must preserve)

Exports that other files import:
- `pool` — used by 26 files via `pool.query()` (swap to throwing Proxy during migration so missed callers fail loud)
- `db` — Drizzle instance
- `dbReady` — Promise<boolean> for startup health
- `initDb()` — idempotent init (for AWS Secrets Manager delayed load)
- `getPoolMetrics()` — sync totals

SQLite rewrite plan: keep same export names, make `getPoolMetrics()` return `{ total: 1, idle: 1, waiting: 0 }` constant, make `dbReady` immediately resolve true, keep `initDb()` idempotent.

## Test mocks

Tests in `src/assistant/__tests__/` and `src/tests/` mock `pool.query` directly. These will need to mock `db.run`/`db.all` instead, or use a real in-memory SQLite for tests (`:memory:`).

## Completion criteria for audit (Step 0)

- [x] All `pool.query` call sites enumerated
- [x] All self-initializing tables identified
- [x] PG-only SQL features catalogued
- [x] db.ts export surface documented
- [x] Tests using DB identified

Next: Step 1 — branch + install.
