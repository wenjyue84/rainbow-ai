#!/usr/bin/env bash
set -euo pipefail

# Rainbow AI — Lightsail Deploy Script
# Usage: ./deploy.sh [--skip-build]

# ── Config ───────────────────────────────────────────────────────────
REMOTE_HOST="18.142.14.142"
REMOTE_USER="ubuntu"
REMOTE_PATH="/var/www/rainbow-ai"
SSH_KEY="$HOME/.ssh/LightsailDefaultKeyPair.pem"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no"
TARBALL="rainbow-ai-deploy.tar.gz"
PM2_APP="rainbow-ai"

# ── Parse flags ──────────────────────────────────────────────────────
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Build ────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo "==> Building Rainbow AI (esbuild)..."
  npm run build
else
  echo "==> Skipping build (--skip-build)"
fi

# Verify dist exists
if [ ! -f dist/index.js ]; then
  echo "ERROR: dist/index.js not found. Run without --skip-build first."
  exit 1
fi

# ── Package ──────────────────────────────────────────────────────────
echo "==> Packaging tarball..."
tar -czf "$TARBALL" \
  dist/ \
  ecosystem.config.cjs \
  package.json \
  package-lock.json \
  profiles.json \
  deploy/certs/ \
  .rainbow-kb/ \
  .rainbow-kb-southern/ \
  .rainbow-kb-makan/

echo "    $(du -h "$TARBALL" | cut -f1) compressed"

# ── Upload ───────────────────────────────────────────────────────────
echo "==> Uploading to $REMOTE_HOST..."
scp $SSH_OPTS "$TARBALL" "$REMOTE_USER@$REMOTE_HOST:/tmp/$TARBALL"

# ── Deploy on server ─────────────────────────────────────────────────
echo "==> Deploying on server..."
ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" bash -s <<'REMOTE'
set -euo pipefail
REMOTE_PATH="/var/www/rainbow-ai"
TARBALL="rainbow-ai-deploy.tar.gz"

# Ensure target dir exists
sudo mkdir -p "$REMOTE_PATH"
sudo chown ubuntu:ubuntu "$REMOTE_PATH"

# Stop PM2 process (ignore if not running)
pm2 stop rainbow-ai 2>/dev/null || true

# Extract tarball
cd "$REMOTE_PATH"
tar -xzf "/tmp/$TARBALL"

# Install production deps only (--omit=dev to avoid OOM on nano)
npm install --omit=dev

# Ensure logs dir exists
mkdir -p logs

# Restart PM2
pm2 start ecosystem.config.cjs 2>/dev/null || pm2 restart rainbow-ai

# Cleanup
rm -f "/tmp/$TARBALL"

echo "==> Server deploy complete"
pm2 list | grep rainbow-ai || true
REMOTE

# ── Local cleanup ────────────────────────────────────────────────────
rm -f "$TARBALL"
echo "==> Deploy finished successfully"
