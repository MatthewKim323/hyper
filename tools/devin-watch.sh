#!/bin/sh
# Keep the overnight loop alive: the free tunnel drops now and then, and every Devin session in
# flight loses the API when it does. Checks once a minute and restarts tunnel plus workers when the
# API stops answering through it. Run it in its own terminal; stop with ctrl-c.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/backend/var/tunnel.log"
command -v caffeinate >/dev/null && caffeinate -dims -w $$ &
while true; do
  URL=$(grep -oE "https://[a-z0-9]+\.lhr\.life" "$LOG" 2>/dev/null | tail -1)
  CODE=$([ -n "$URL" ] && curl -s -m 15 -o /dev/null -w "%{http_code}" "$URL/health" || echo 000)
  if [ "$CODE" != "200" ]; then
    echo "$(date '+%H:%M:%S') tunnel answered $CODE, restarting"
    "$ROOT/tools/devin-up.sh" || echo "restart failed, trying again in a minute"
  fi
  sleep 60
done
