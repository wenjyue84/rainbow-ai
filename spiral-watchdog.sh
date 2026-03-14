#!/bin/bash
# spiral-watchdog.sh — Keeps SPIRAL running for 4 hours
# Uses log-modification-time detection (Windows/MSYS2 compatible — no pgrep)

PROJECT="/c/Users/Jyue/Documents/1-projects/Software Projects/rainbow-ai"
SPIRAL_HOME="/c/Users/Jyue/.ai/Skills/spiral"
LOG="$PROJECT/.spiral/_last_run.log"
WATCHDOG_LOG="$PROJECT/.spiral/watchdog.log"
END_TIME=$(( $(date +%s) + 14400 ))   # 4 hours from now
STALE_SECS=300                        # 5 min without log update = SPIRAL dead

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$WATCHDOG_LOG"; }

cd "$PROJECT" || exit 1
log "=== Watchdog started — running until $(date -d @$END_TIME '+%H:%M:%S') ==="

spiral_is_running() {
  [ -f "$LOG" ] || return 1
  local last_mod
  last_mod=$(date -r "$LOG" +%s 2>/dev/null) || return 1
  local age=$(( $(date +%s) - last_mod ))
  [ "$age" -lt "$STALE_SECS" ]
}

launch_spiral() {
  local pending
  pending=$(node -e "try{const p=JSON.parse(require('fs').readFileSync('prd.json','utf8')); console.log(p.userStories.filter(s=>!s.passes).length)}catch(e){console.log(0)}" 2>/dev/null)

  local remaining=$(( END_TIME - $(date +%s) ))
  local iters=$(( remaining / 480 ))
  [ "$iters" -lt 3 ] && iters=3
  [ "$iters" -gt 25 ] && iters=25

  if [ "${pending:-0}" -gt 0 ]; then
    log "Launching SPIRAL — $pending pending stories, $iters iters, skip-research"
    bash "$SPIRAL_HOME/spiral.sh" "$iters" \
      --gate proceed --skip-research --ralph-iters 120 \
      > /dev/null 2>&1 &
  else
    log "Queue empty — launching WITH research to generate new stories, $iters iters"
    bash "$SPIRAL_HOME/spiral.sh" "$iters" \
      --gate proceed --ralph-iters 120 \
      > /dev/null 2>&1 &
  fi
  log "SPIRAL launched (PID: $!)"
  sleep 45   # give it time to write first log entry
}

# Main loop
while [ "$(date +%s)" -lt "$END_TIME" ]; do
  if spiral_is_running; then
    log "SPIRAL alive (log updated <${STALE_SECS}s ago) — sleeping 90s"
    sleep 90
  else
    log "SPIRAL not detected — checking before restart..."
    sleep 10
    if spiral_is_running; then
      log "False alarm — SPIRAL just wrote to log. Sleeping."
      sleep 90
    else
      launch_spiral
    fi
  fi
done

log "=== Watchdog finished at $(date '+%H:%M:%S') ==="
