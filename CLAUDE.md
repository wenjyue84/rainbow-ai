# CLAUDE.md — Rainbow AI (Standalone)

WhatsApp AI assistant for Pelangi Capsule Hostel & Southern Homestay. Extracted from digiman monorepo on 2026-03-11.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ (ESM, `"type": "module"`) |
| Language | TypeScript 5.3 |
| Build | esbuild (NOT tsc — tsc has pre-existing type errors) |
| Server | Express 4 |
| Database | SQLite (better-sqlite3) — Drizzle ORM + PG-compat shim |
| WhatsApp | Baileys (direct WebSocket — **unofficial, ToS risk**, see [architecture doc](docs/architecture/whatsapp-transport-layer.md)) |
| AI | NVIDIA Kimi K2.5 / Ollama / OpenRouter (multi-provider fallback) |
| Testing | Vitest (unit/integration/semantic) + Promptfoo (eval) |
| Deploy | Hetzner VPS (5.223.54.57) + PM2 |

## Key Directories

| Path | Purpose |
|------|---------|
| `src/index.ts` | Entry point (Express server) |
| `src/assistant/` | Rainbow AI engine — intent classification, conversation, AI providers |
| `src/assistant/data/` | Config JSON files (routing, workflows, knowledge, settings) |
| `src/assistant/pipeline/` | Message processing pipeline |
| `src/routes/admin/` | Admin API (~20 sub-routers) |
| `src/lib/` | DB, config, Baileys client, logger, failover |
| `src/tools/` | MCP tool implementations (guests, units, analytics, etc.) |
| `shared/` | Drizzle schema (`schema.ts`, `schema-tables.ts`, `schema-validation.ts`) |
| `.rainbow-kb/` | Knowledge base markdown files (Pelangi) |
| `.rainbow-kb-southern/` | Knowledge base markdown files (Southern) |
| `whatsapp-auth/` | Baileys auth state (Pelangi) |
| `whatsapp-auth-southern/` | Baileys auth state (Southern) |

## Quick Commands

```bash
npm run dev          # Dev server with tsx watch
npm run build        # esbuild bundle + copy data/public to dist/
npm run start        # Run production bundle (dist/index.js)
npm run check        # TypeScript type-check only (tsc --noEmit)
npm run test         # Vitest interactive
npm run test:run     # Vitest single run
npm run db:push      # Push Drizzle schema (SQLite — auto-runs on startup)
npm run build:css    # Rebuild Tailwind CSS
```

## ACI — agent test harness (fast path for agents)

Agents: start with `node scripts/aci/rainbow-aci.mjs describe` — machine-readable catalog.
Suites: `test --suite=config|data|health|chat|go|all` (spawns ephemeral server on :3199 with
`DISABLE_WHATSAPP=true` + `SQLITE_PATH=:memory:` — never touches live WhatsApp or the real DB).
`gates` wraps the deploy gate (`npm run test:regression`) + `go test ./...`. Agents:
`.claude/agents/rainbow-aci-deterministic.md` (regression) and `rainbow-aci-evaluator.md` (UX/flow).

## Database

**Provider:** SQLite via `better-sqlite3`. Path set via `SQLITE_PATH` env var (default: `./data/rainbow-ai.db`).

**Drizzle-managed tables** (schema in `shared/schema-tables.ts`):
- `app_settings`, `rainbow_messages`, `rainbow_conversations`
- `intent_analytics`, `intent_configs`, `intent_keywords`
- `conversation_feedback`, `escalation_events`

**Raw SQL tables** (via PG-compat shim in `src/lib/db.ts`):
- `rainbow_configs` — runtime config storage
- `rainbow_kb_files` — knowledge base file metadata
- `rainbow_config_audit` — config change audit log

DB file persists across deploys at `/opt/rainbow-ai/data/rainbow-ai.db` on the server.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_SERVER_PORT` | Yes | Server port (default: 8080) |
| `SQLITE_PATH` | No | SQLite DB file path (default: `./data/rainbow-ai.db`) |
| `NODE_ENV` | Yes | `production` or `development` |
| `DIGIMAN_API_URL` | No | Admin panel URL |
| `DIGIMAN_API_TOKEN` | No | Admin panel auth token |

See `.env.example` for full list.

## Deployment

```bash
bash deploy.sh                        # Build + test + upload + restart PM2
bash deploy.sh --skip-build           # Skip build step
bash deploy.sh --skip-build --skip-tests  # Fastest: upload + restart only
```

**Target:** `deploy@5.223.54.57:/opt/rainbow-ai`
**Process manager:** PM2 (config in `ecosystem.config.cjs`)
- Port: 8080
- Memory limit: 450MB (`--max-old-space-size=450`)
- Auto-restart on crash (max 10 restarts)
- Logs at `/opt/rainbow-ai/logs/`
- Live URL: `http://5.223.54.57:8080`

## Key Data Files

| File | Purpose |
|------|---------|
| `src/assistant/data/routing.json` | Intent -> action mapping |
| `src/assistant/data/workflows.json` | Workflow step definitions |
| `src/assistant/data/knowledge.json` | Static reply templates |
| `src/assistant/data/intent-keywords.json` | T2 fuzzy match keywords |
| `src/assistant/data/settings.json` | Provider and feature settings |

## Conventions

- **ESM only** — all files use ES module syntax, imports use `.js` extensions
- **Zod schemas** in `src/assistant/schemas.ts` are source of truth for config types
- **Import paths** use `.js` extensions (NodeNext module resolution)
- Build copies `src/assistant/data/` and `src/public/` to `dist/` (static assets)

## Senai Room Rental Integration (rental-ad / Ramli)

rainbow-ai runs the **Ramli** bot for the Senai worker housing business, acting as MCP client to the senai room rental app.

| Component | Details |
|-----------|---------|
| Profile ID | `senai-app` (also called "rental-ad") |
| Bot persona | Ramli — tenant communication, payment chasing |
| WhatsApp bridge | port 8790 (instanceId: `senai`), number +60103341058 |
| MCP server | `POST https://senai.wenjyue.com/api/mcp` (JSON-RPC 2.0) |
| MCP auth | `x-api-key: <MCP_API_KEY>` |
| Senai app repo | `C:\Users\Jyue\Documents\1-projects\Software Projects\senai-room-management-system` |
| Senai app live | https://senai.wenjyue.com |

**MCP Tools available (senai rental app exposes):**
`senai_ping`, `senai_get_daily_briefing`, `senai_list_tenants`, `senai_get_tenant`,
`senai_list_rooms`, `senai_list_houses`, `senai_list_maintenance`, `senai_list_recent_payments`

**Sidebar link:** The senai rental app has a "Ramli AI Bot" link in its left nav pointing to https://rainbow.wenjyue.com.

**Ramli agent:** `~/.claude/agents/ramli.md` — Juno-side agent that orchestrates WA sends via the bridge.

## Architecture Documentation

| Doc | Purpose |
|-----|---------|
| `docs/architecture/whatsapp-transport-layer.md` | Baileys vs Cloud API analysis, ToS risk, migration plan |
