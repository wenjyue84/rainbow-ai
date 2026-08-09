#!/usr/bin/env bash
# audit-profile-isolation.sh — measures cross-profile data pollution in the
# rainbow-ai admin API (loop-engineering harness).
#
# For every config-backed admin endpoint × every non-default profile:
#   payload(profile) == payload(default)  →  POLLUTED (silent fallback served
#   another business's data). Score = polluted pairs. Target: 0.
#
# Read-only (GETs). Runs against prod via SSH. Usage: bash tools/audit-profile-isolation.sh
set -u
VPS=deploy@5.223.54.57
BASE=http://127.0.0.1:3003

ENDPOINTS=(
  "/api/rainbow/intents"
  "/api/rainbow/knowledge"
  "/api/rainbow/templates"
  "/api/rainbow/workflows"
  "/api/rainbow/workflow"
  "/api/rainbow/routing"
  "/api/rainbow/settings"
  "/api/rainbow/intent-manager/keywords"
  "/api/rainbow/intent-manager/examples"
  "/api/rainbow/intent-manager/tiers"
  "/api/rainbow/intent-manager/llm-settings"
  # system-prompt is POST-only (write path); its read path is llm-settings.
  # GET returns the same 405 for every profile — not a pollution signal.
  "/api/rainbow/intent-manager/regex"
  # DB-backed sections (live chat / staff review / webchat): identical lists
  # across profiles mean the profile filter is not applied.
  "/api/rainbow/conversations"
  "/api/rainbow/conversations/unified"
  "/api/rainbow/webchat/conversations"
)
PROFILES=(senai-app southern makan-moments yoongmei pms-capsule pms-southern)

# One SSH session: emit "endpoint|profile|md5" lines (default profile = key 'DEFAULT')
script='KEY=$(grep -E "^RAINBOW_ADMIN_KEY" /opt/rainbow-ai/.env | cut -d= -f2)
for ep in '"${ENDPOINTS[*]}"'; do
  d=$(curl -s -m 8 "'"$BASE"'$ep" -H "x-admin-key: $KEY" | md5sum | cut -d" " -f1)
  echo "$ep|DEFAULT|$d"
  for p in '"${PROFILES[*]}"'; do
    h=$(curl -s -m 8 "'"$BASE"'$ep" -H "x-admin-key: $KEY" -H "x-profile-id: $p" | md5sum | cut -d" " -f1)
    echo "$ep|$p|$h"
  done
done'

out=$(ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS" "$script")
[ -z "$out" ] && { echo "AUDIT FAILED: no output from VPS"; exit 2; }

polluted=0; clean=0
echo "════════════════════════════════════════════════════════════"
echo " PROFILE-ISOLATION AUDIT  $(date '+%Y-%m-%d %H:%M') MYT"
echo "════════════════════════════════════════════════════════════"
for ep in "${ENDPOINTS[@]}"; do
  def=$(echo "$out" | grep -F "$ep|DEFAULT|" | cut -d'|' -f3)
  bad=""
  for p in "${PROFILES[@]}"; do
    h=$(echo "$out" | grep -F "$ep|$p|" | cut -d'|' -f3)
    if [ -n "$h" ] && [ "$h" = "$def" ]; then
      bad="$bad $p"; polluted=$((polluted+1))
    else
      clean=$((clean+1))
    fi
  done
  if [ -n "$bad" ]; then
    echo "  ✗ $ep"
    echo "      identical-to-default (POLLUTED):$bad"
  else
    echo "  ✓ $ep — all profiles isolated"
  fi
done
echo "────────────────────────────────────────────────────────────"
total=$((polluted + clean))
echo " POLLUTED PAIRS: $polluted / $total   (target 0)"
echo "════════════════════════════════════════════════════════════"
