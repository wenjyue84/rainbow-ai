#!/usr/bin/env bash
set -euo pipefail

# Rainbow AI — Hetzner Deploy Script
# Usage: ./deploy.sh [--skip-build] [--skip-tests]

# ── Config ───────────────────────────────────────────────────────────
REMOTE_HOST="5.223.54.57"
REMOTE_USER="deploy"
REMOTE_PATH="/opt/rainbow-ai"
TARBALL="rainbow-ai-deploy.tar.gz"
PM2_APP="rainbow-ai"

# ── Parse flags ──────────────────────────────────────────────────────
SKIP_BUILD=false
SKIP_TESTS=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --skip-tests) SKIP_TESTS=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Regression Tests (quality gate) ─────────────────────────────────
if [ "$SKIP_TESTS" = false ]; then
  echo "==> Running intent classifier regression tests..."
  npm run test:regression
  echo "    Regression tests passed."
else
  echo "==> Skipping regression tests (--skip-tests)"
fi

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
  drizzle/ \
  ecosystem.config.cjs \
  package.json \
  package-lock.json \
  profiles.json \
  .rainbow-kb/ \
  .rainbow-kb-southern/ \
  .rainbow-kb-makan/

echo "    $(du -h "$TARBALL" | cut -f1) compressed"

# ── Upload ───────────────────────────────────────────────────────────
echo "==> Uploading to $REMOTE_HOST..."
scp "$TARBALL" "$REMOTE_USER@$REMOTE_HOST:/tmp/$TARBALL"

# ── Deploy on server ─────────────────────────────────────────────────
echo "==> Deploying on server..."
ssh "$REMOTE_USER@$REMOTE_HOST" bash -s <<'REMOTE'
set -euo pipefail
REMOTE_PATH="/opt/rainbow-ai"
TARBALL="rainbow-ai-deploy.tar.gz"

# Use nvm-managed Node if available, otherwise fall back to system node
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" && nvm use 20 2>/dev/null || true
echo "==> Node.js $(node -v)"

# Ensure target dir and data dir exist
sudo mkdir -p "$REMOTE_PATH/data"
sudo chown -R deploy:deploy "$REMOTE_PATH"

# Stop PM2 process (ignore if not running)
pm2 stop rainbow-ai 2>/dev/null || true

# Extract tarball
cd "$REMOTE_PATH"
tar -xzf "/tmp/$TARBALL"

# Install production deps only
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
echo "==> Deploy finished successfully — http://$REMOTE_HOST:8080"
