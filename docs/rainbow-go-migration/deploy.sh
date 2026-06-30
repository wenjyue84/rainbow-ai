#!/usr/bin/env bash
# Build + ship the hybrid Go core + dumb Node bridge (+ optional ML sidecar) to
# the Hetzner VPS. Run from the rainbow-ai repo root. This script BUILDS and
# UPLOADS only — it does NOT flip production traffic (see the cutover runbook in
# MIGRATION.md). Pairing WhatsApp (QR scan) is a manual step only Jay can do.
set -euo pipefail

HOST="${HOST:-deploy@5.223.54.57}"
GO_DIR="${GO_DIR:-/home/deploy/rainbow-go}"

echo "==> Cross-compiling go-core for linux/amd64"
( cd go-core && GOOS=linux GOARCH=amd64 go build -o rainbow-core-linux ./cmd/rainbow-core )
echo "    built go-core/rainbow-core-linux ($(du -h go-core/rainbow-core-linux | cut -f1))"

echo "==> Uploading core binary + bridge + sidecar"
ssh "$HOST" "mkdir -p $GO_DIR/bridge $GO_DIR/sidecar"
scp go-core/rainbow-core-linux "$HOST:$GO_DIR/rainbow-core"
scp bridge/index.js bridge/package.json "$HOST:$GO_DIR/bridge/"
scp sidecar/index.js sidecar/package.json "$HOST:$GO_DIR/sidecar/"

echo "==> Installing bridge deps on the VPS"
ssh "$HOST" "cd $GO_DIR/bridge && npm install --omit=dev"

cat <<'NEXT'

==> Uploaded. Next (manual — see MIGRATION.md "Cutover runbook"):
  1. Copy the live DB beside the core:    cp /opt/rainbow-ai/data/rainbow-ai.db $GO_DIR/data/
  2. Set env in a run.sh (DIGIMAN_API_URL, GROQ_API_KEY, RAINBOW_ADMIN_KEY, BRIDGE_URL, etc.)
  3. SHADOW first: start core + bridge on a TEST WhatsApp number, verify, THEN flip.
  4. Cutover: set DISABLE_WHATSAPP=1 on the Node monolith (frees the WA session),
     start the bridge (scan QR with the hostel phone), start the core, watch logs.
  5. Rollback: stop bridge+core, unset DISABLE_WHATSAPP, restart the monolith.
NEXT
