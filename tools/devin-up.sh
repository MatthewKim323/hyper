#!/bin/sh
# Start the paid half of the autonomous loop: a public tunnel to the local API and the Devin worker.
# Run tools/dev-up.sh first. Devin sessions call back into THIS machine through the tunnel, with a
# scoped per-session token; the tunnel URL changes on every start, so it is passed by environment
# and never written to .env.
#   DEVIN_MAX_SESSIONS_PER_ORG  lifetime session budget per organization (default here: 200)
#   DEVIN_SESSION_ACU_LIMIT     ACU cap per session (default 5)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
mkdir -p var
lsof -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1 || { echo "api is not on :8000, run tools/dev-up.sh first"; exit 1; }
pkill -f "app.devin_worker" 2>/dev/null || true
pkill -f "nokey@localhost.run" 2>/dev/null || true
: > var/tunnel.log
nohup ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
  -R 80:127.0.0.1:8000 nokey@localhost.run > var/tunnel.log 2>&1 &
printf "waiting for the tunnel"
i=0; URL=""
while [ -z "$URL" ]; do
  i=$((i+1)); [ $i -gt 30 ] && { echo " timed out, see backend/var/tunnel.log"; exit 1; }
  URL=$(grep -oE "https://[a-z0-9]+\.lhr\.life" var/tunnel.log | tail -1); printf "."; sleep 1
done
echo " $URL"
curl -s -m 10 -o /dev/null -w "api through the tunnel: %{http_code}\n" "$URL/health"
# Replies and Devin's spin-up take minutes, not seconds: give a case 45 minutes before it times out.
pkill -f "app.counterparty_worker" 2>/dev/null || true
COUNTERPARTY_TIMEOUT_MS="${COUNTERPARTY_TIMEOUT_MS:-2700000}" nohup uv run python -m app.counterparty_worker > var/counterparty-worker.log 2>&1 &
AGENT_PUBLIC_BASE_URL="$URL" DEVIN_MAX_SESSIONS_PER_ORG="${DEVIN_MAX_SESSIONS_PER_ORG:-200}" \
  nohup uv run python -m app.devin_worker > var/devin-worker.log 2>&1 &
pgrep -f "app.devin_exceptions" >/dev/null 2>&1 || nohup uv run python -m app.devin_exceptions > var/devin-exceptions.log 2>&1 &
echo "devin worker, exception bridge and counterparty worker started (logs in backend/var/)"
echo "turn the loop on:  uv run --directory backend python -m app.devin_exceptions_ctl on demo-meridian"
