#!/usr/bin/env bash
# Watchdog: periodic restart of rainbow-core-go (server copy: /home/deploy/rainbow-go/restart-core-cron.sh).
# Reason: LLM tier degrades in long-running process (works fresh after restart,
# dead after ~15-30h; keys verified healthy while process failing — 2026-07-08 diagnosis).
# Installed by Juno (Jay's assistant) 2026-07-08.
# 2026-07-18 Loop Charter upgrade (Juno): verify process online after restart.
# 2026-09-08: alerts go through the notify router (Jayson number) — Periskope /
# Jay's main number is read-only since the 2026-09-07 bans. After every restart
# check-numbers.sh verifies all WhatsApp numbers (no LLM) and pushes NEW problems to Jay.
export PATH=/home/deploy/.nvm/versions/node/v24.15.0/bin:$PATH
LOG=/home/deploy/rainbow-go/restart-cron.log
pm2 restart rainbow-core-go --update-env >> "$LOG" 2>&1
sleep 10
STATUS=$(pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d);const p=a.find(x=>x.name==='rainbow-core-go');console.log(p?p.pm2_env.status:'missing')}catch(e){console.log('unknown')}})" 2>/dev/null || echo unknown)
echo "$(date -u +%FT%TZ) restarted rainbow-core-go status=$STATUS" >> "$LOG"
if [ "$STATUS" != "online" ]; then
  if python3 /home/deploy/notify/notify.py --business alert --text "🔴 rainbow-core-go NOT online after cron restart (status=$STATUS) $(date -u +%FT%TZ)" >> "$LOG" 2>&1; then
    echo "$(date -u +%FT%TZ) ALERT SENT via notify.py (status=$STATUS)" >> "$LOG"
  else
    echo "$(date -u +%FT%TZ) ALERT FAILED: notify.py error" >> "$LOG"
  fi
fi
# Every WhatsApp number, after the restart settled.
sleep 20
/home/deploy/rainbow-go/check-numbers.sh --quiet --notify >> "$LOG" 2>&1 || true
