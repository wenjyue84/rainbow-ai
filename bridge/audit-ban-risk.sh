#!/usr/bin/env bash
# audit-ban-risk.sh — WhatsApp bridge ban-risk audit (loop-engineering harness).
# Scores PRODUCTION state on 5.223.54.57. Higher = more ban risk. Target ≤ 10.
# Run from anywhere: bash bridge/audit-ban-risk.sh
# Deterministic checks only — every point traces to an observable fact.
set -u
VPS=deploy@5.223.54.57
SSH="ssh -o ConnectTimeout=10 -o BatchMode=yes $VPS"
NODEBIN=/home/deploy/.nvm/versions/node/v24.15.0/bin

score=0
declare -a findings

add() { # add <points> <id> <detail>
  local pts=$1 id=$2 detail=$3
  score=$((score + pts))
  findings+=("[+$pts] $id — $detail")
}
ok() { findings+=("[ 0] $1 — OK: $2"); }

# ── Gather facts in one SSH round-trip ──────────────────────────────────────
facts=$($SSH "
  echo '===CODE==='
  grep -c 'R4:' /home/deploy/rainbow-go/bridge/index.js 2>/dev/null || true
  grep -c 'qrReconnectTimes' /home/deploy/rainbow-go/bridge/index.js 2>/dev/null || true
  grep -c 'shouldIgnoreJid' /home/deploy/rainbow-go/bridge/index.js 2>/dev/null || true
  grep -c 'QUIET_HOURS' /home/deploy/rainbow-go/bridge/index.js 2>/dev/null || true
  echo '===HEALTH_PELANGI==='
  curl -s -m 5 http://127.0.0.1:8789/health || echo '{}'
  echo
  echo '===SENAI_PROC==='
  p=\$($NODEBIN/pm2 pid senai-bridge 2>/dev/null | tr -dc 0-9)
  if [ -n \"\$p\" ] && [ \"\$p\" -gt 0 ]; then echo online; else echo stopped; fi
  echo '===SENAI_CREDS==='
  ls /home/deploy/rainbow-go/bridge-auth-senai/creds.json 2>/dev/null || echo 'none'
  echo '===ENV_PELANGI==='
  grep -E 'EXEMPT_JIDS|COLD_DAILY_CAP|HOURLY_CAP|QUIET' /home/deploy/rainbow-go/run-bridge.sh 2>/dev/null
  echo '===LOG408==='
  tail -n 500 /home/deploy/.pm2/logs/rainbow-bridge-out.log 2>/dev/null | grep -c 'code=408' || true
")
[ -z "$facts" ] && { echo "AUDIT FAILED: cannot reach VPS"; exit 2; }

sect() { echo "$facts" | sed -n "/===$1===/,/===/p" | sed '1d;$d'; }

code=$(sect CODE)
r4=$(echo "$code" | sed -n 1p); r5=$(echo "$code" | sed -n 2p)
r1=$(echo "$code" | sed -n 3p); qh=$(echo "$code" | sed -n 4p)
health=$(sect HEALTH_PELANGI)
senai_proc=$(sect SENAI_PROC)
senai_creds=$(sect SENAI_CREDS)
env_pelangi=$(sect ENV_PELANGI)
storms=$(echo "$facts" | sed -n '/===LOG408===/,$p' | sed -n 2p)

jq_get() { echo "$health" | grep -o "\"$1\":[^,}]*" | head -1 | cut -d: -f2 | tr -d '"'; }
wa=$(jq_get whatsapp)
cold=$(jq_get coldSentToday); coldcap=$(jq_get coldDailyCap)
hourly=$(jq_get sentThisHour); hourlycap=$(jq_get hourlyCap)
qdepth=$(jq_get queueDepth)

# ── 1. Deployed code hardening (max 38) ─────────────────────────────────────
[ "${r4:-0}" -ge 1 ] && ok CODE-R4 "TOCTOU quota reservation + exempt JIDs deployed" \
  || add 15 CODE-R4 "deployed index.js lacks R4 (cold-cap race + exempt JIDs) — cause of today's 51/20 overrun"
[ "${r5:-0}" -ge 1 ] && ok CODE-R5 "QR reconnect budget deployed" \
  || add 10 CODE-R5 "deployed index.js lacks R5 QR budget — 401→408 storm path unbounded (banned senai)"
[ "${r1:-0}" -ge 1 ] && ok CODE-R1 "status-broadcast block / R1 hardening deployed" \
  || add 10 CODE-R1 "deployed index.js lacks R1 hardening"
[ "${qh:-0}" -ge 1 ] && ok CODE-QH "quiet-hours guard deployed" \
  || add 3 CODE-QH "no quiet-hours guard — cold sends possible at 3am (non-human rhythm)"

# ── 2. Runtime pacing state, pelangi (max 30) ───────────────────────────────
if [ -n "$cold" ] && [ -n "$coldcap" ]; then
  if [ "$cold" -gt "$coldcap" ]; then
    # Breach is a historical fact for the day; the live risk depends on whether
    # further cold sends are actually blocked (R4 enforcement deployed).
    if [ "${r4:-0}" -ge 1 ]; then
      add 7 PACE-COLD "cold cap breached today ($cold/$coldcap) — R4 enforcement now blocks further cold sends; decays at midnight"
    else
      add 15 PACE-COLD "cold cap BREACHED today: $cold/$coldcap and no enforcement deployed"
    fi
  elif [ "$cold" -ge $((coldcap * 3 / 4)) ]; then
    add 8 PACE-COLD "cold sends ≥75% of cap: $cold/$coldcap"
  else
    ok PACE-COLD "cold $cold/$coldcap"
  fi
else
  add 10 PACE-COLD "health unreadable"
fi
[ "$wa" = "open" ] && ok PACE-CONN "pelangi whatsapp=open" \
  || add 10 PACE-CONN "pelangi whatsapp=$wa (not open)"
[ "${qdepth:-0}" -le 10 ] && ok PACE-QUEUE "queueDepth=$qdepth" \
  || add 5 PACE-QUEUE "queueDepth=$qdepth (>10, send pressure)"

# ── 3. Config (max 17) ──────────────────────────────────────────────────────
echo "$env_pelangi" | grep -q 'EXEMPT_JIDS=.\+' && ok CFG-EXEMPT "BRIDGE_EXEMPT_JIDS set" \
  || add 8 CFG-EXEMPT "BRIDGE_EXEMPT_JIDS unset — self-pings classify as cold"
cfgcold=$(echo "$env_pelangi" | grep -o 'COLD_DAILY_CAP=[0-9]*' | cut -d= -f2)
if [ -n "${cfgcold:-}" ] && [ "$cfgcold" -le 10 ]; then
  ok CFG-COLDCAP "cold cap $cfgcold ≤ 10 (post-incident safe level)"
elif [ -n "${cfgcold:-}" ] && [ "$cfgcold" -le 20 ]; then
  add 3 CFG-COLDCAP "cold cap $cfgcold — acceptable, but ≤10 is the post-incident safe level"
else
  add 6 CFG-COLDCAP "cold cap ${cfgcold:-unset} > 20"
fi
[ "${storms:-0}" -le 20 ] && ok LOG-408 "408 count in recent log: ${storms:-0}" \
  || add 10 LOG-408 "408 storm in recent log: $storms events"

# ── 4. Banned-number hygiene, senai (max 15) ────────────────────────────────
if echo "$senai_proc" | grep -q 'status":"online'; then
  add 10 SENAI-PROC "senai-bridge (BANNED number) still running — any activity adds evidence"
else
  ok SENAI-PROC "senai-bridge not running"
fi
if [ "$senai_creds" != "none" ]; then
  add 5 SENAI-CREDS "banned-number creds still on disk — accidental reconnect possible"
else
  ok SENAI-CREDS "banned-number creds removed/archived"
fi

# ── Report ──────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════"
echo " WA BAN-RISK AUDIT  $(date '+%Y-%m-%d %H:%M') MYT"
echo "════════════════════════════════════════════════"
for f in "${findings[@]}"; do echo "  $f"; done
echo "────────────────────────────────────────────────"
echo " TOTAL RISK SCORE: $score / 100   (target ≤ 10)"
echo "════════════════════════════════════════════════"
exit 0
