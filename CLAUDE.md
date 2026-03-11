# CLAUDE.md — Rainbow AI (Standalone)

WhatsApp AI assistant for Pelangi Capsule Hostel & Southern Homestay. Extracted from digiman monorepo on 2026-03-11.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ (ESM, `"type": "module"`) |
| Language | TypeScript 5.3 |
| Build | esbuild (NOT tsc — tsc has pre-existing type errors) |
| Server | Express 4 |
| Database | PostgreSQL (Neon) — Drizzle ORM + raw pg |
| WhatsApp | Baileys (direct connection) |
| AI | NVIDIA Kimi K2.5 / Ollama / OpenRouter (multi-provider fallback) |
| Testing | Vitest (unit/integration/semantic) + Promptfoo (eval) |
| Deploy | AWS Lightsail + PM2 |

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
npm run db:push      # Push Drizzle schema to Neon
npm run build:css    # Rebuild Tailwind CSS
```

## Database

**Provider:** Neon (PostgreSQL), connection via `DATABASE_URL` env var.

**Drizzle-managed tables** (schema in `shared/schema-tables.ts`):
- `app_settings`, `rainbow_messages`, `rainbow_conversations`
- `intent_analytics`, `intent_configs`, `intent_keywords`
- `conversation_feedback`, `escalation_events`

**Raw pg tables** (excluded from Drizzle migrations via `drizzle.config.ts`):
- `rainbow_configs` — runtime config storage
- `rainbow_kb_files` — knowledge base file metadata
- `rainbow_config_audit` — config change audit log

Config uses dual-write: local JSON files + Postgres DB (DB is primary on startup).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_SERVER_PORT` | Yes | Server port (default: 3002) |
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `NODE_ENV` | Yes | `production` or `development` |
| `DIGIMAN_API_URL` | No | Admin panel URL |
| `DIGIMAN_API_TOKEN` | No | Admin panel auth token |
| `RAINBOW_ROLE` | No | `primary` or `standby` (failover) |
| `RAINBOW_PEER_URL` | No | Peer server URL for failover |
| `RAINBOW_FAILOVER_SECRET` | No | Shared secret for failover auth |

See `.env.example` for full list.

## Deployment

```bash
bash deploy.sh           # Build, package, upload, deploy to Lightsail
bash deploy.sh --skip-build  # Skip build step
```

**Target:** `ubuntu@18.142.14.142:/var/www/rainbow-ai`
**Process manager:** PM2 (config in `ecosystem.config.cjs`)
- Memory limit: 450MB (`--max-old-space-size=450`)
- Auto-restart on crash (max 10 restarts)
- Logs at `/var/www/rainbow-ai/logs/`

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
