# log.md — rainbow-ai

Append-only chronological record. Newest first. Heading format: `## [YYYY-MM-DD] <type> | <title>` where type ∈ build · fix · audit · decision · brief · dispatch · security · structure · event · note.

## [2026-09-23] event | Simple UI + setup wizard DEPLOYED; red tests cleared

Deployed 12:20 MYT to Hetzner: `/home/deploy/rainbow-go/rainbow-core` (md5 `4b86dd1e…`, backup `rainbow-core.bak-20260923-wizard`), UI files into `rainbow-go/public` (backup `public.bak-20260923-wizard.tgz`), `config/data/intents.json` (backup `.bak-20260923-wizard`). Verified: `/health` 200, `GET /api/rainbow/setup/status?profile=pelangi` 200, `/setup` SPA 200, pm2 online. Red tests: local `intents.json`/`intent-keywords-pelangi.json`/`intent-tiers.json`/`intent-whitelists.json` were STALE vs the server (RSI sync 2026-09-20) — synced server→repo; `parking` override moved after `multi_question` (R3 test); `TestGuestMaintenanceHitsPMS` rewritten to assert the current `facility_malfunction → ac_fault_escalate` staff page (FIX 5 design; PMS ticket path unreachable from guest text); go ACI `/conversations` check now accepts the raw array + guards `/setup/status`. `go test ./...` all green.

## [2026-09-23] build | Simple UI + New-business setup wizard (no SSH, no restart)

go-core: `router.Hub` now mutex-guarded with `AddEngine`/`MapInstance`/`AddBotNumber`; `POST /profiles/blank|clone` hot-loads the profile via `SetProfileActivator`; `POST /api/rainbow/whatsapp/instances {profile}` creates a number through WA Hub `POST /api/numbers`, hot-routes it and persists to `<dataDir>/instances.json` (merged after env at boot); `GET /api/rainbow/setup/status?profile=` drives the wizard checklist; `PUT /settings/reply-mode` accepts `botName`. Fixed `POST /admin-users` (missing `created_at`/`updated_at` → NOT NULL error). SPA: Simple mode (Home · Chats · Knowledge · Test · Settings) default with a topbar Advanced toggle (`localStorage rainbow-ui-mode`); `#setup` full-page 6-step wizard replaces the old modal; `.nav-item.hidden` CSS fix (Master button was never actually hidden). Verified locally end-to-end against a mock WA Hub (scratchpad `mock-hub.mjs`); not deployed.

## [2026-09-11] build | hub scaffolded by hub_lint.py (HUB-001)

Created missing hub files from `_tools/hub-lint/templates/`.
