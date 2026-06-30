# Rainbow AI — hybrid Go core + dumb Node bridge

Two processes replace the leaky Node monolith:

```
WhatsApp ──Baileys──► bridge/ (Node, dumb)  ──HTTP /inbound──►  go-core/ (Go, all logic)
                         ▲                                          │
                         └───────────── HTTP /send ◄───────────────┘
                                   (text/media/typing/presence)
```

- **`go-core/`** — Go business core. Intent classification (T1 regex → T2 fuzzy →
  T3 semantic[sidecar] → T4 LLM), routing, AI provider manager, conversation state
  (shared SQLite), escalation. Owns the business state, so the bridge can be
  restarted at a memory cap without losing anything.
- **`bridge/`** — thin Node Baileys relay. Connect, forward inbound, perform sends.
  Zero business logic → small, stable RSS.

See `MIGRATION.md` for the strategy, findings, and phase plan.

## Run locally

**1. Go core** (reads the same data + DB the Node app uses):

```bash
cd go-core
go build -o rainbow-core ./cmd/rainbow-core
RAINBOW_DATA_DIR=../src/assistant/data \
SQLITE_PATH=../data/rainbow-ai.db \
RAINBOW_PROFILE=pelangi \
BRIDGE_URL=http://127.0.0.1:8788 \
CORE_PORT=8090 \
GEMINI_API_KEY=... GROQ_API_KEY=... \
./rainbow-core
```

**2. Bridge** (links WhatsApp, relays to the core):

```bash
cd bridge
npm install
CORE_URL=http://127.0.0.1:8090 BRIDGE_PORT=8788 BRIDGE_AUTH_DIR=./bridge-auth npm start
# scan the QR printed in the terminal to link a WhatsApp number
```

Send a WhatsApp message to the linked number → bridge POSTs `/inbound` → core
classifies + replies → core POSTs `/send` → bridge delivers.

## Environment

### go-core
| Var | Default | Purpose |
|---|---|---|
| `RAINBOW_DATA_DIR` | `src/assistant/data` | profile JSON config dir |
| `SQLITE_PATH` | `data/rainbow-ai.db` | shared DB (same file as Node app) |
| `RAINBOW_PROFILE` | `pelangi` | profile id |
| `BRIDGE_URL` | `http://127.0.0.1:8788` | bridge base URL for sends |
| `CORE_PORT` | `8090` | core HTTP port |
| `TYPING_INDICATOR` | `true` | send composing/paused presence |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / … | — | provider keys (env name from settings.json `api_key_env`) |

### bridge
| Var | Default | Purpose |
|---|---|---|
| `CORE_URL` | `http://127.0.0.1:8090` | Go core base URL |
| `BRIDGE_PORT` | `8788` | bridge HTTP port (serves `/send`, `/health`) |
| `BRIDGE_AUTH_DIR` | `./bridge-auth` | Baileys auth state dir |
| `BRIDGE_INSTANCE_ID` | `default` | instance id echoed on inbound |

## Tests

```bash
cd go-core && go test ./...
```

Notable suites: `internal/classify` (T1/T2 + `TestFastTierAccuracy` vs the labeled
`intent-examples.json`), `internal/conversation` + `internal/store` (against a copy
of the real DB), `internal/ai` (mock OpenAI/Gemini), `internal/router`
(end-to-end through a mock bridge), `internal/bridge` (the send contract).

## Deploy (shadow, then flip)

Cross-compile and ship the core; run the bridge with `BRIDGE_AUTH_DIR` pointed at a
fresh auth dir so it links its own device session. To shadow without disrupting
prod, run the monolith with `DISABLE_WHATSAPP=1` while the bridge owns the socket.

```bash
cd go-core && GOOS=linux GOARCH=amd64 go build -o rainbow-core-linux ./cmd/rainbow-core
scp rainbow-core-linux deploy@5.223.54.57:/opt/rainbow-go/rainbow-core
# bridge: rsync bridge/ to the box, npm install --omit=dev, run under PM2
```

## Status

Working, tested vertical slice (Phase 2): inbound → dedup → conversation state →
tiered classify (T1/T2 + T4 LLM; T3 semantic pending the ML sidecar) → routing →
static_reply / llm_reply / escalate (+ staff notify) → send. Not yet ported:
booking/workflow FSMs, WhatsApp Flows, RAG/T3, media+audio inbound, admin API,
webchat, the ~30 schedulers. See `MIGRATION.md` Phase 3.
