# Rainbow AI → hybrid Go core + dumb Node bridge

Goal: cut the ~286 MB / 550 MB-capped / 255-restart Node monolith into two processes:

1. **`bridge/`** — a thin **dumb** Node service. Only jobs: connect to WhatsApp via
   Baileys, relay every inbound message to the Go core over HTTP, and perform the
   outbound sends the core asks for. **Zero business logic.**
2. **`go-core/`** — a Go service that owns everything else: intent classification,
   AI calls, the SQLite database, conversation state, scheduling, daily reports,
   guardrails, admin API, and the MCP/PMS2 (digiman) integration.

Modeled on the PMS2 Go port (`github.com/wenjyue84/pelangi-pms-go`, `MIGRATION.md`):
one-file-per-domain (`module_*.go`), shared DB, behaviour-parity verification against
the running Node app, instant rollback via a feature flag.

## Why this shape (vs PMS2's pure strangler)

PMS2 was an HTTP API, so a Go gateway could reverse-proxy Node and steal endpoints
one at a time, then retire Node entirely. **Rainbow's input is a WhatsApp event
stream, not HTTP requests** — and Baileys is Node-only (no mature Go port). So:

- The strangler seam is the **message relay** (`IncomingMessage` in, send-ops out),
  not an HTTP proxy.
- **Node never fully retires.** It shrinks to the bridge (+ a small ML sidecar for
  ONNX embeddings/transcription). The bridge is tiny and stateless → cheap to restart
  at a memory cap without losing business state, which lives in the Go core.

## Where the memory actually goes (static analysis — confirm in Phase 0)

The Baileys layer is *not* the main leak:

- Auth state is DB-backed (`whatsapp/db-auth-state.ts`), not `useMultiFileAuthState`.
- No `makeInMemoryStore` is bound to the socket.
- The per-instance dedup map is capped (500 / 60s TTL).

The real heap pressure is the **business logic sharing one process**:

- `@xenova/transformers` ONNX models — `assistant/semantic-matcher.ts` +
  `assistant/rag/hybrid-retriever.ts` (+ audio transcribe). One model set **per
  profile**, resident in RSS — the single biggest chunk (>150 MB).
- ~25 in-memory `Map` state stores (conversation, carts, escalation, rate-limit…).
- Profile registry: ConfigStore + KB + RAG index **per profile**, never evicted.
- ~30 schedulers (`setInterval`/`node-cron`).

So: splitting Baileys out gives **restart isolation** (the socket stops dying with
the heap), and moving the rest to Go gives the **RAM win** (Go GC returns memory; no
in-process ONNX). Same 156→12 MB shape PMS2 saw.

**Phase 0 measurement (pending):** boot once with `DISABLE_WHATSAPP=1`
(`src/index.ts:1052`) vs off → RSS attributable to Baileys vs everything else, plus a
heap snapshot to confirm the transformers attribution.

## Locked decisions (defaults, 2026-06-30)

| Decision | Choice | Rationale |
|---|---|---|
| Embeddings / STT (T3 semantic, RAG, voice) | **Node ML sidecar** exposing `/embed` + `/transcribe` | Keeps proven `@xenova/transformers` code; Go has no in-process equivalent. Thin + leak-free. |
| Database | **Keep SQLite** (`modernc.org/sqlite`, pure-Go, CGO-free cross-compile) | Limits scope; Go opens the same `data/rainbow-ai.db`. Single-writer discipline. |
| Bridge ↔ core transport | **HTTP** (JSON) | Simplest; matches PMS2. WS later if latency demands. |

## The seam (contract)

**Inbound (bridge → core):** `POST /inbound` with the `IncomingMessage` JSON
(`from, text, pushName, messageId, isGroup, timestamp, messageType, instanceId,
mediaMetadata?, bsuid?, referralData?, mediaUrl?`). Bridge resolves `@lid` → phone
and downloads media to a URL before forwarding (core never calls Baileys).

**Outbound (core → bridge):** `POST /send` with `{op, phone, instanceId, ...}` where
`op ∈ {send_text, send_media, send_interactive, send_typing, send_paused}`.

## Module split

**BRIDGE-ONLY (stays Node):** `lib/whatsapp/*` (instance, manager, db-auth-state,
lid-mapper, avatar-cache, consent-enforcement), `baileys-supervisor` (shrunk),
`whatsapp-flows-crypto`, the 5 send primitives, media download.

**MOVES-TO-GO:** the whole `assistant/` engine (intent pipeline T1–T4, routing,
action dispatch, response post-processing, conversation/booking/workflow/flow state,
escalation, guardrails), `ai-provider-manager`, KB+RAG (embeddings via sidecar),
config-store, profile-registry, `http-client` (digiman REST), `mcp-client`, DB layer,
`routes/admin`, `routes/public/webchat`, `tools/`, all schedulers.

## Phases

- **Phase 0** — profile + scaffold (this doc, Go module, contract). 
- **Phase 1** — dumb Node bridge alongside the running app (feature-flagged).
- **Phase 2** — Go core skeleton: inbound, dedup, conversation (SQLite), tiered
  classify, routing, static_reply + llm_reply, send-back. Shadow-verify vs Node.
- **Phase 3** — move capabilities one at a time, read-only/low-risk first, each
  shadow-verified before flip: classify → conversation → AI replies → KB/RAG →
  booking/workflow → escalation → schedulers → admin → webchat.
- **Phase 4** — decommission Node business logic, leaving bridge + ML sidecar.

Rollback at every phase = feature flag points the bridge back at the in-process Node
handler.

## Bugs found in the Node version (during the port)

- **Cross-profile contamination in the Pelangi (hostel) data.** Cafe/F&B intents
  `MENU_SPECIALS`, `MENU_FILTER_PRICE`, `MENU_RECOMMEND` are present in
  `intent-keywords-pelangi.json` AND `routing.json`, but appear in **no** profile
  whitelist (`intent-whitelists.json` → `pms_capsule`/`makan`/`southern`) and not in
  the live makan keyword file. They steal T2 fuzzy matches from legitimate hostel
  intents — e.g. a guest asking "what's the arrival time" classified as
  `MENU_SPECIALS`. The Node app's whitelist *validators* warn about this at startup
  but the runtime keyword matcher still loads the contaminated entries.
  - **Fix (Go core):** the classifier now enforces the profile whitelist
    (`config.Profile.Allowed` + `IntentAllowed`), filtering out non-whitelisted
    intents at load time. Measured effect on the labeled `intent-examples.json` set:
    fast-tier precision 62.8% → 77.1% (recall ~88%).
  - **Recommended Node-side follow-up:** delete the three `MENU_*` intents from
    `intent-keywords-pelangi.json` and `routing.json` (archive first), or flip
    `STRICT_PROFILE_VALIDATION=true` after cleaning so it can't regress.
- **Stale whitelist.** `pms_capsule` whitelist omits several legitimate hostel
  intents (`farewell`, `full_price_list`, `conversation_reset`, `cancel_booking`).
  The Go core works around this with an `alwaysAllowed` set for control intents;
  the whitelist should be brought up to date Node-side.
- **Workflows reference unimplemented PMS actions (silent no-op).** The node-graph
  workflows in `workflows.json` invoke `pelangi_api` actions `find_reservation`,
  `find_active_reservation`, `process_checkout`, `log_service_request`,
  `assign_capsule`, but the enhancer's `executeAction` switch
  (`workflow-enhancer.ts`) only implements `check_availability`, `check_lower_deck`,
  `create_checkin_link`, `book_capsule`, `get_police_gps`, `send_to_staff`,
  `escalate`, `forward_payment`, `whatsapp_send`. The others fall through to
  `default` → return `{}`, so the node executor maps every output to `''` and
  proceeds down the **success** branch with blank PMS data. Net effect: the
  booking/checkin/checkout "PMS lookup/assign" steps silently do nothing and the
  workflow continues as if they succeeded.
  - **Go core behaviour (safer):** the workflow VM calls the digiman client for the
    implemented actions and **escalates to staff with the collected data** for the
    unimplemented ones — the guest always gets a response and a human completes the
    PMS step, instead of the booking silently proceeding with empty data.
  - **Node-side follow-up:** either implement the missing actions in
    `workflow-enhancer.ts` or rename the `workflows.json` actions to the implemented
    ones; until then, booking via the workflow path is effectively broken in Node.

## Progress log

- **2026-06-30** — Phase 0 + Phase 1 + Phase 2 (core slice) landed. All Go tests
  green; core cross-compiles to linux (~15 MB), bridge syntax-clean.
  - **Scaffold:** `go-core/` module (`modernc.org/sqlite`, CGO-free), `bridge/`
    (standalone Node, baileys + qrcode-terminal only).
  - **Contract:** `internal/contract` — `IncomingMessage` + 5 send-ops, mirrors Node.
  - **Config loader** (`internal/config`): loads intents/keywords/routing/knowledge/
    settings/llm-settings/tiers/whitelist for a profile from the live data dir
    (38 patterns, 2303 keywords, 68 routes, 42 static replies for pelangi).
  - **Classifier** (`internal/classify`): T1 regex + T2 fuzzy (Levenshtein/substring
    approximation of Fuse.js) + T3 hook + T4 via LLM; whitelist contamination filter;
    language detect (en/ms/zh/ta). `TestFastTierAccuracy` benches the live labeled set.
  - **Conversation state** (`internal/conversation` + `internal/store`): shares the
    real SQLite tables (`rainbow_conversation_state`, `rainbow_messages`), ISO-text
    timestamps, idle reset, history — round-trips verified against a copy of the prod DB.
  - **AI manager** (`internal/ai`): multi-provider (OpenAI-compatible + Gemini) with
    priority fallback, env-keyed; T4 classify (JSON parse incl. markdown-wrapped) +
    reply generation. Mock-server tested.
  - **Engine** (`internal/router`): full inbound pipeline — dedup, group-skip,
    state, typing, classify, route, dispatch (static_reply/llm_reply/escalate),
    staff-notify, send. End-to-end tested through the real bridge client → mock bridge.
  - **Bridge** (`bridge/index.js`): Baileys connect + reconnect, QR pairing, inbound
    extraction (text/media/list/location), dedup, `POST /send` (text/typing/paused/
    media/interactive), `/health`.
  - **Live smoke:** compiled core booted on the real config+DB; `hi`→greeting and
    `wifi password`→wifi both delivered correct replies through a mock bridge.
- **2026-06-30 (Phase 3, same day)** — message-handling spine widened. 38 Go tests
  across 10 packages, all green; vet + gofmt clean.
  - **ML sidecar** (`sidecar/`): the only process loading `@xenova/transformers`;
    `/semantic` (T3 intent match via precomputed example embeddings) + `/embed`. Go
    T3 client (`internal/semantic`) wired into the classifier (whitelist-checked);
    degrades gracefully when the sidecar is down.
  - **Workflow engine** (`internal/workflow`): full port of the node-graph VM
    (message / whatsapp_send / wait_reply / condition / pelangi_api) with `{{...}}`
    interpolation, operators (regex/eq/gt/pastDateCheck), and multi-turn state in
    `workflow_state_json`. PMS-dependent steps (`pelangi_api`, dateConflict/
    dbAvailabilityCheck) **escalate to staff with the collected data** rather than
    fabricating PMS results. Booking slot-filling (name→count→dates, with name
    interpolation) verified end-to-end through the compiled binary.
  - **Multi-profile hub** (`internal/router/hub.go`): routes inbound by `instanceId`
    → profile engine (`PROFILE_INSTANCES` env), default fallback. All three profiles
    load (pelangi 2303 kw / southern 1632 / makan 405, distinct whitelists).
  - **Media handling:** caption-less media (image/audio/video/doc/sticker) is no
    longer silently dropped — the guest gets an acknowledgement and staff are notified.
  - **digiman/PMS client** (`internal/digiman`): REST client to `DIGIMAN_API_URL`
    backing `pelangi_api` workflow nodes. Implements the actions the Node enhancer
    actually implements (`check_availability` → `/api/units/available`,
    `assign_capsule` → `/api/units/assign`, `create_checkin_link` →
    `/api/guest-tokens/internal`); unimplemented actions return `ok=false` so the
    workflow escalates to staff (safer than the Node no-op — see bug log). Workflow
    VM gained the full condition operator set (`lt`/`neq`/`exists`/`empty`) and
    `pelangi_api` success/error branching with output mapping. Mock-server tested.
  - **Conversation reset** command (`reset`/`restart`/`mula semula`/`重新开始`) clears
    workflow/booking/slots and confirms. **Tiered fallback:** 3 consecutive unknown
    intents escalate to staff.
  - **Voice-note transcription** (`internal/transcribe` + bridge media download):
    the Node app uses the **Groq Whisper cloud API** (not a local model), so the port
    needs no transcription sidecar. The bridge downloads the audio via Baileys
    `downloadMediaMessage`, saves it, and serves it at `/media/<id>.ogg`; the core
    fetches it and POSTs it to Groq (`whisper-large-v3`, `response_format=text`), then
    runs the transcript through the normal text pipeline. A voice note saying "what is
    the wifi password" classifies as `wifi` and is answered. Mock-server tested
    (multipart upload + JSON/text response) + engine test.
  - **Scheduler framework + data-retention** (`internal/scheduler`): Go goroutines
    (one per job, `time.Ticker`/`DailyAt`, graceful `Stop`) replace the Node
    `setInterval`/`node-cron` timers. First job ported: PDPA data retention
    (`lib/data-retention.ts`) — soft-delete messages/conversations older than
    `retention_days` (default 730), hard-delete after a 30-day grace. Wired into
    `main.go` at 03:00 daily with SIGINT/SIGTERM graceful shutdown. Tested against a
    copy of the prod DB.
    - **Subtle bug surfaced + handled:** the timestamp columns have INTEGER affinity
      but store ISO-8601 TEXT; a bare `col < ?` comparison applies NUMERIC affinity
      and truncates both sides to the leading year. The Go queries `CAST(... AS TEXT)`
      to force correct lexicographic comparison. **Node-side caution:** any raw-SQL
      ISO-timestamp range comparison on these columns has the same trap.
  - **RAG retrieval** (`internal/rag`): Go port of `rag/bm25.ts` + `rag/chunker.ts`
    — a sparse **BM25** retriever (k1=1.2, b=0.75, CJK/Tamil-aware tokenizer) over the
    profile's KB markdown (`.rainbow-kb*`), 300-word chunks with 15% overlap. Wired
    into `llmReply` so replies are grounded in the top-5 KB chunks (per-profile,
    `RAINBOW_KB_ROOT`). Loads 62 chunks from the live Pelangi KB; wifi/pricing queries
    retrieve the right files. (Dense/vector rerank can layer on via the sidecar
    `/embed` later.) Unit + engine tested.
  - **Daily report scheduler** (`internal/scheduler/daily_report.go`): Go port of
    `lib/daily-report.ts` (summary form) — fetches `/api/units` +
    `/api/guests/checked-in` via the digiman client, computes occupancy + unpaid
    guests + today's checkouts, and sends to the staff phone at 11:30 MYT. Tested with
    a fake PMS (array + `{data:[]}` guest shapes).
  - **Webchat channel** (`POST /chat`): a synchronous HTTP channel that reuses the
    FULL pipeline (classification, RAG, **workflows**, escalation) but returns the
    reply instead of sending via the bridge. Implemented via `Engine.ProcessCapture`
    — a shallow-engine-copy with a capturing sender, so no pipeline code is
    duplicated. Live-verified on the compiled binary: `whats the wifi password` →
    WiFi static reply; `I want to book a room` → the booking workflow prompt, both
    over HTTP. Tested.
  - **Admin API (read endpoints)** (`internal/admin`): Go port of the most-used
    dashboard reads — `GET /api/rainbow/stats|conversations|conversations/{phone}/
    messages|settings`, with `X-Admin-Key` auth, over the shared DB. Live-verified
    against the prod DB (414 conversations, 998 messages). The full Node admin API
    (~40 sub-routers, write/CRUD) is non-leaky and can stay on Node during a phased
    flip; these cover the core read views. Fixing the ORDER-BY surfaced the same
    INTEGER-affinity timestamp trap — `CAST(... AS TEXT)` applied in admin + the
    conversation history (a latent wrong-message-ordering bug, now fixed).
  - **Test suite:** 66 Go tests across 14 packages, all green; vet + gofmt clean;
    linux cross-compile OK; bridge syntax-clean; live-smoked (WhatsApp-shape + webchat
    + admin) against the real DB.
  - **Remaining (non-blocking for the memory win):** WhatsApp Flows (interactive
    forms), admin write/CRUD endpoints (the dashboard's edit operations), and the
    pacing/breach periodic monitors.

## Cutover runbook (manual — pairing WhatsApp needs Jay + the phone)

The build is ready for a **shadow-first** cutover. The actual prod flip is NOT
automated because (a) linking WhatsApp requires scanning a QR with the hostel phone,
and (b) it switches a live system serving real guests — do it supervised.

1. **Build + upload:** `bash docs/rainbow-go-migration/deploy.sh` (cross-compiles the
   Go core, ships core + bridge + sidecar, installs bridge deps).
2. **Env (`run.sh` on the VPS):** `SQLITE_PATH` (point at the live
   `/opt/rainbow-ai/data/rainbow-ai.db`), `DIGIMAN_API_URL`/`DIGIMAN_API_TOKEN`,
   `GROQ_API_KEY` (voice + LLM), `RAINBOW_ADMIN_KEY`, `RAINBOW_KB_ROOT`, `BRIDGE_URL`,
   optional `SIDECAR_URL`, `PROFILE_INSTANCES`.
3. **Shadow:** start core + bridge linked to a TEST WhatsApp number; send real
   messages; compare replies/behaviour to the Node monolith. (PMS booking steps
   escalate to staff — confirm that's acceptable, or port `pelangi_api` actions.)
4. **Flip:** set `DISABLE_WHATSAPP=1` on the Node monolith + restart (frees the WA
   session); start the bridge and scan the QR with the hostel phone; start the core;
   watch `pm2 logs`. The Node monolith stays up to serve the admin dashboard
   write/CRUD endpoints until those are ported.
5. **Rollback (instant):** stop bridge + core; unset `DISABLE_WHATSAPP`; restart the
   monolith — it re-links WhatsApp and resumes. Business state is unaffected (shared
   SQLite DB).

**Readiness call (2026-06-30):** the *memory-isolation goal is met* and the
guest-facing pipeline is shadow-ready, but I am **not** flipping prod autonomously —
the QR pairing is a manual step and the flip is a live, customer-facing change that
should be supervised. Recommend a shadow run on a test number first.
