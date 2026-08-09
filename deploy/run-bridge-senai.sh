#!/usr/bin/env bash
# Senai WhatsApp bridge startup script — deploy to /home/deploy/rainbow-go/run-bridge-senai.sh
#
# ⚠️  SECURITY: BRIDGE_QR_TOKEN gates the /qr/ endpoint.
#     Change the token after every QR rescan.
#
# BRIDGE_EXEMPT_JIDS: comma-separated phone numbers (digits only, no +) that are
# classified as "reply" instead of "cold", bypassing the cold-send cap and
# pairing warm-up. Use for self-pings and staff numbers that never reply to the
# bot. They still count toward daily/hourly/per-JID flood limits.
# Example: "60127088789,60103341058"

export PATH=/home/deploy/.nvm/versions/node/v24.15.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CORE_URL=http://127.0.0.1:3003
export BRIDGE_PORT=8790
export BRIDGE_QR_TOKEN='senai2026secure'
export BRIDGE_AUTH_DIR=/home/deploy/rainbow-go/bridge-auth-senai
export BRIDGE_MEDIA_DIR=/home/deploy/rainbow-go/bridge-media-senai
export BRIDGE_MEDIA_BASE=http://127.0.0.1:8790
export BRIDGE_INSTANCE_ID=senai
export BRIDGE_DAILY_CAP=300
export BRIDGE_COLD_DAILY_CAP=20
export BRIDGE_HOURLY_CAP=20
# R4: self-pings to Jay's number are not cold outreach — exempt from cold cap.
# Set to Jay's number + any staff numbers used for operator self-pings.
export BRIDGE_EXEMPT_JIDS='60127088789'
cd /home/deploy/rainbow-go/bridge
exec node index.js
