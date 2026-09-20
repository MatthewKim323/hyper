#!/bin/sh
# Brings the exception loop back if any of its processes is gone. Several sessions share this machine and a
# broad pkill has taken the whole loop down before, silently, for most of an hour. Checks once a minute.
# Opens no tunnel. Stop it with: pkill -f loop-keepalive
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
while true; do
  missing=""
  for name in app.counterparty_worker app.auto_agent "app.devin_exceptions\$" app.spend_guard app.bench_timeline app.learning_log; do
    pgrep -f "python -m $name" >/dev/null 2>&1 || missing="$missing $name"
  done
  if [ -n "$missing" ]; then
    echo "$(date '+%H:%M:%S') missing:$missing, restarting the loop"
    "$ROOT/tools/loop-restart.sh" 2>&1 | tail -1
  fi
  sleep 60
done
