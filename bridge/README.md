# bridge/ — FROZEN, see `wenjyue84/rainbow-bridge`

The WhatsApp (Baileys) bridge now lives in its own repo:
**https://github.com/wenjyue84/rainbow-bridge** (private). Local clone:
`Documents/2-areas/Software Projects/rainbow-bridge/`.

The `index.js` here is an older snapshot (2026-08) kept for reference only. It lacks
`GET /status/:id`, `INBOUND_API_KEY`, `BRIDGE_JID_RATE_LIMIT_OVERRIDES`, `group_accept_invite`
and the R8 multi-subscriber fan-out (`BRIDGE_SUBSCRIBERS`, `participant`, `source`).
Do not edit or deploy from this directory. `audit-ban-risk.sh` is still valid and may be moved
to the new repo later.

Go core ↔ bridge contract: `go-core/internal/contract/contract.go`.

## WhatsApp numbers from the dashboard (2026-09-08)

The bridge (R9) exposes `POST /logout` (header `X-Bridge-Token`) and `GET /qr.json/<token>`; the Go core
proxies them as `/api/rainbow/whatsapp/instances/{id}/logout|qr` (`go-core/internal/admin/wa_instances.go`),
so **Logout** / **QR** on the Dashboard and on the Meet-the-Assistants cards work without SSH. The instance
registry comes from `run-core-prod.sh`: `PROFILE_INSTANCES` (instance→profile), `BRIDGE_INSTANCE_URLS`
(instance→bridge URL) and `BRIDGE_QR_TOKEN_<INSTANCE>`. Adding / removing a number is still a server task —
`new-bridge.sh <instance> <port> [profile]` (`rainbow-bridge/deploy/new-bridge.sh`); the dashboard's
`+ Add Number` / `Remove` return 501 with those instructions.

## Phone-typed messages + Jayson intro-once (2026-09-08)

The live bridge relays messages Jay types on the linked phone / WhatsApp Web as `fromMe: true`
(`from` = the peer). The core stores them as a `staff` row (source `phone-manual`) so Live Chat shows
them on the right; it never replies to them. Bridge `/send` echoes are suppressed (ack store).

Per-profile `settings-<profile>.json` keys: `reply_mode: "intro-once"` + `intro_message` — a new
contact receives the intro once, every later message is left for a human (core log
`intro-once: awaiting manual reply`). Set on `jayson-pa` while the profile is blank; **remove
`reply_mode` when Jayson is configured** to get normal AI replies back.

## Number health check (2026-09-08)

`scripts/ops/check-numbers.sh` (server: `/home/deploy/rainbow-go/check-numbers.sh`) checks every bridge with no LLM:
pm2, `/health` (state, paired user, `inbound{ok,failed,lastError}`, kill switch), `INBOUND_API_KEY` vs the core's
`.env`, and the core's instance registry. `--probe` sends one text around the ring (cold send per number — manual
only). `--notify` pushes new problems/recovery to Jay through `notify.py --business alert` (Jayson). Scheduled: cron
every 10 min, after `restart-core-cron.sh`, and the repo's `.claude/settings.json` SessionStart hook.
