#!/usr/bin/env bash
# check-numbers.sh — health of EVERY WhatsApp number behind Rainbow AI. No LLM.
#
# Runs on the Hetzner box (/home/deploy/rainbow-go/check-numbers.sh). Reads the
# instance registry from run-core-prod.sh, then for each number checks:
#   - pm2 process online
#   - bridge /health reachable, WhatsApp state "open", a paired number present
#   - inbound relay failures (bridge → core 401/timeout) in the last 24 h
#   - policy kill switch
#   - INBOUND_API_KEY in the bridge's run script == the core's key (2026-09-08:
#     senai-bridge had none → every tenant message to Ramli dropped with 401)
# plus the core itself (pm2 + /api/rainbow/status) and that the core's instance
# registry lists every bridge.
#
# usage: check-numbers.sh [--probe] [--notify] [--quiet]
#   --probe   real delivery test: each number sends one short text to the next
#             number in the ring and we wait for the target's inbound counter to
#             move. Costs one COLD send per number per run — never run this from
#             cron (daily cold caps are 10–20).
#   --notify  on a NEW problem (differs from last run) send Jay a WhatsApp via
#             notify.py (business "alert" → Jayson). Recovery is also announced.
#   --quiet   print only problems (cron)
# exit 0 = all good, 1 = problems, 2 = script/env error
# Output: human lines on stdout; machine JSON at /home/deploy/rainbow-go/last-check.json
set -u
export PATH=/home/deploy/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/usr/bin:/bin
ROOT=/home/deploy/rainbow-go
CORE=http://127.0.0.1:3003
ENVF=/opt/rainbow-ai/.env
OUT=$ROOT/last-check.json
PROBE=0; NOTIFY=0; QUIET=0
for a in "$@"; do case "$a" in --probe) PROBE=1;; --notify) NOTIFY=1;; --quiet) QUIET=1;; esac; done

[ -f "$ROOT/run-core-prod.sh" ] || { echo "missing $ROOT/run-core-prod.sh"; exit 2; }
URLS=$(grep '^export BRIDGE_INSTANCE_URLS=' "$ROOT/run-core-prod.sh" | cut -d= -f2- | tr -d "\"'")
PROFS=$(grep '^export PROFILE_INSTANCES=' "$ROOT/run-core-prod.sh" | cut -d= -f2- | tr -d "\"'")
CORE_KEY=$(grep '^INBOUND_API_KEY=' "$ENVF" 2>/dev/null | cut -d= -f2- | tr -d "\"'")
ADMIN_KEY=$(grep -E '^(RAINBOW_ADMIN_KEY|ADMIN_KEY)=' "$ENVF" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"'")
[ -n "$URLS" ] || { echo "no BRIDGE_INSTANCE_URLS in run-core-prod.sh"; exit 2; }

problems=()
rows=()
json_get() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const v=$1;console.log(v===undefined||v===null?'':(typeof v==='object'?JSON.stringify(v):v))}catch(e){console.log('')}})"; }
json_str() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.stringify(d)))"; }
pm2_status() { pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const p=JSON.parse(d).find(x=>x.name==='$1');console.log(p?p.pm2_env.status:'missing')}catch(e){console.log('unknown')}})"; }
profile_of() { echo ",$PROFS," | grep -o ",$1=[^,]*" | head -1 | cut -d= -f2; }
run_script_of() { if [ "$1" = pelangi ]; then echo "$ROOT/run-bridge.sh"; else echo "$ROOT/run-bridge-$1.sh"; fi; }
pm2_name_of() { if [ "$1" = pelangi ]; then echo rainbow-bridge; else echo "$1-bridge"; fi; }

# ── core ──
core_pm2=$(pm2_status rainbow-core-go)
core_http=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H "x-admin-key: $ADMIN_KEY" "$CORE/api/rainbow/status" || echo 000)
core_inst=$(curl -s -m 5 -H "x-admin-key: $ADMIN_KEY" "$CORE/api/rainbow/whatsapp/instances" 2>/dev/null | json_get "j.instances.map(i=>i.id).join(',')")
[ "$core_pm2" = online ] || problems+=("core: pm2 status $core_pm2")
[ "$core_http" = 200 ] || problems+=("core: /api/rainbow/status HTTP $core_http")

# ── each number ──
declare -a INSTS PORTS USERS
IFS=',' read -ra pairs <<< "$URLS"
for pair in "${pairs[@]}"; do
  inst=${pair%%=*}; url=${pair#*=}; port=${url##*:}
  prof=$(profile_of "$inst"); [ -n "$prof" ] || prof=$([ "$inst" = pelangi ] && echo pelangi || echo "?")
  pm2n=$(pm2_name_of "$inst"); pm2s=$(pm2_status "$pm2n")
  h=$(curl -s -m 5 "$url/health" 2>/dev/null)
  state=$(echo "$h" | json_get "j.whatsapp"); user=$(echo "$h" | json_get "j.user")
  iok=$(echo "$h" | json_get "j.inbound&&j.inbound.ok"); ifail=$(echo "$h" | json_get "j.inbound&&j.inbound.failed")
  ierr=$(echo "$h" | json_get "j.inbound&&j.inbound.lastError"); iat=$(echo "$h" | json_get "j.inbound&&j.inbound.lastErrorAt")
  kill=$(echo "$h" | json_get "j.killSwitch")
  rs=$(run_script_of "$inst"); bkey=$(grep '^export INBOUND_API_KEY=' "$rs" 2>/dev/null | cut -d= -f2- | tr -d "\"'")
  keyok=no; [ -n "$bkey" ] && [ "$bkey" = "$CORE_KEY" ] && keyok=yes
  [ -n "$state" ] || { state=unreachable; problems+=("$inst (:$port): bridge /health unreachable"); }
  [ "$pm2s" = online ] || problems+=("$inst: pm2 $pm2n status $pm2s")
  [ "$state" = open ] || [ "$state" = unreachable ] || problems+=("$inst (:$port): WhatsApp state '$state' (needs re-pair via Dashboard → QR)")
  [ "$state" != open ] || [ -n "$user" ] || problems+=("$inst: connected but no paired number")
  [ "$keyok" = yes ] || problems+=("$inst: INBOUND_API_KEY missing/mismatched in $(basename "$rs") → core will 401 every inbound")
  [ "$kill" != true ] || problems+=("$inst: policy kill switch ON — all sends blocked")
  if [ -n "$iat" ] && [ "${ifail:-0}" != 0 ]; then
    age=$(( $(date -u +%s) - $(date -u -d "$iat" +%s 2>/dev/null || echo 0) ))
    [ "$age" -gt 86400 ] || problems+=("$inst: $ifail inbound relay failure(s), last ${age}s ago: $ierr")
  fi
  echo ",$core_inst," | grep -q ",$inst," || problems+=("$inst: not in the core's instance registry (core restart needed?)")
  INSTS+=("$inst"); PORTS+=("$port"); USERS+=("$user")
  rows+=("{\"instance\":\"$inst\",\"profile\":\"$prof\",\"port\":$port,\"pm2\":\"$pm2s\",\"state\":\"$state\",\"user\":\"$user\",\"inboundOk\":${iok:-0},\"inboundFailed\":${ifail:-0},\"lastError\":$(printf '%s' "$ierr" | json_str),\"killSwitch\":${kill:-false},\"keyOk\":\"$keyok\"}")
  [ "$QUIET" = 1 ] || printf '%-8s %-18s :%s  pm2=%-7s wa=%-11s user=%-12s inbound ok=%s fail=%s key=%s%s\n' \
    "$inst" "$prof" "$port" "$pm2s" "$state" "${user:--}" "${iok:-0}" "${ifail:-0}" "$keyok" "$([ "$kill" = true ] && echo ' KILL-SWITCH')"
done

# ── optional real delivery probe (ring: i → i+1) ──
probe_json="null"
if [ "$PROBE" = 1 ]; then
  n=${#INSTS[@]}; pr=()
  . /home/deploy/.credentials/bridge-send.env 2>/dev/null || true
  for ((i=0;i<n;i++)); do
    j=$(( (i+1) % n )); to=${USERS[$j]}; [ -n "$to" ] || { pr+=("\"${INSTS[$i]}->${INSTS[$j]}\":\"skip-no-number\""); continue; }
    before=$(curl -s -m 5 "http://127.0.0.1:${PORTS[$j]}/health" | json_get "j.inbound&&j.inbound.ok")
    hdr=(); [ "${INSTS[$i]}" = senai ] && [ -n "${BRIDGE_SEND_TOKEN:-}" ] && hdr=(-H "x-bridge-token: $BRIDGE_SEND_TOKEN")
    resp=$(curl -s -m 10 -X POST "http://127.0.0.1:${PORTS[$i]}/send" -H 'content-type: application/json' "${hdr[@]}" \
      -d "{\"op\":\"send_text\",\"phone\":\"$to\",\"text\":\"[probe $(date -u +%H:%M:%S)] ${INSTS[$i]} -> ${INSTS[$j]} (auto health check, ignore)\"}")
    ok=$(echo "$resp" | json_get "j.ok"); eta=$(echo "$resp" | json_get "j.etaMs")
    if [ "$ok" != true ]; then pr+=("\"${INSTS[$i]}->${INSTS[$j]}\":\"send-refused: $(echo "$resp" | tr -d '"' | cut -c1-80)\""); problems+=("probe ${INSTS[$i]}->${INSTS[$j]}: send refused"); continue; fi
    deadline=$(( $(date +%s) + (${eta:-0}/1000) + 60 )); got=no
    while [ "$(date +%s)" -lt "$deadline" ]; do
      after=$(curl -s -m 5 "http://127.0.0.1:${PORTS[$j]}/health" | json_get "j.inbound&&j.inbound.ok")
      [ "${after:-0}" -gt "${before:-0}" ] && { got=yes; break; }; sleep 5
    done
    pr+=("\"${INSTS[$i]}->${INSTS[$j]}\":\"$([ $got = yes ] && echo delivered || echo NOT-delivered)\"")
    [ $got = yes ] || problems+=("probe ${INSTS[$i]}->${INSTS[$j]}: sent but target never relayed it to the core")
    [ "$QUIET" = 1 ] || echo "probe ${INSTS[$i]} -> ${INSTS[$j]} ($to): $([ $got = yes ] && echo delivered || echo NOT delivered)"
  done
  probe_json="{$(IFS=,; echo "${pr[*]}")}"
fi

# ── result ──
ok=true; [ ${#problems[@]} -eq 0 ] || ok=false
prev_sig=$( [ -f "$OUT" ] && node -e "try{console.log((JSON.parse(require('fs').readFileSync('$OUT','utf8')).problems||[]).join('|'))}catch(e){console.log('')}" )
sig=$(IFS='|'; echo "${problems[*]:-}")
{
  printf '{"ts":"%s","ok":%s,"core":{"pm2":"%s","http":%s,"instances":"%s"},"numbers":[%s],"probe":%s,"problems":[' \
    "$(date -u +%FT%TZ)" "$ok" "$core_pm2" "$core_http" "$core_inst" "$(IFS=,; echo "${rows[*]}")" "$probe_json"
  first=1; for p in "${problems[@]:-}"; do [ -n "$p" ] || continue; [ $first = 1 ] || printf ','; first=0; printf '%s' "$p" | json_str; done
  printf ']}\n'
} > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"

if [ "$ok" = true ]; then
  [ "$QUIET" = 1 ] || echo "ALL OK — ${#INSTS[@]} numbers connected, core online"
  if [ "$NOTIFY" = 1 ] && [ -n "$prev_sig" ]; then
    python3 /home/deploy/notify/notify.py --business alert --text "✅ Rainbow AI numbers recovered: all ${#INSTS[@]} connected, core online ($(date +%H:%M))" >/dev/null 2>&1 || true
  fi
  exit 0
fi
echo "PROBLEMS (${#problems[@]}):"; for p in "${problems[@]}"; do echo "  ✗ $p"; done
if [ "$NOTIFY" = 1 ] && [ "$sig" != "$prev_sig" ]; then
  msg="⚠️ Rainbow AI number check ($(date +%H:%M)):"; for p in "${problems[@]}"; do msg="$msg
• $p"; done
  python3 /home/deploy/notify/notify.py --business alert --text "$msg" >/dev/null 2>&1 || true
fi
exit 1
