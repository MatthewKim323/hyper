#!/bin/sh
# Start the whole local backend: data stack, API, evaluator and workers. Logs go to backend/var/.
# Safe to run again: anything already listening is left alone. Stop with tools/dev-down.sh.
# The Devin worker is NOT started here. It launches paid cloud sessions and needs
# AGENT_PUBLIC_BASE_URL to be a tunnel to THIS machine. Start it on purpose:
#   uv run --directory backend python -m app.devin_worker
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
mkdir -p var
docker info >/dev/null 2>&1 || { command -v orbctl >/dev/null && orbctl start >/dev/null 2>&1; }
docker compose -f compose.yaml up -d
printf "waiting for postgres and elasticsearch"
i=0; until pg_isready -h 127.0.0.1 -p 15432 >/dev/null 2>&1 && curl -s -m 2 http://127.0.0.1:19200 >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 90 ] && { echo " timed out"; exit 1; }; printf "."; sleep 2; done; echo " ok"
uv sync -q
[ -d evaluator/node_modules ] || npm ci --silent --prefix evaluator
start() { # name, port-or-empty, command...
  name=$1; port=$2; shift 2
  if [ -n "$port" ] && lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "$name: already on :$port"; return; fi
  for last; do :; done  # the module name is the last argument
  if [ -z "$port" ] && pgrep -f "$last" >/dev/null 2>&1; then echo "$name: already running"; return; fi
  nohup "$@" > "var/$name.log" 2>&1 &
  echo "$name: started (backend/var/$name.log)"
}
start evaluator 8001 node --env-file=.env evaluator/server.mjs
start api 8000 uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
start ingestion-worker "" uv run python -m app.ingestion_worker
start artifact-worker "" uv run python -m app.artifact_worker
start simulator-worker "" uv run python -m app.simulator_worker
start connector-worker "" uv run python -m app.connectors.worker
start counterparty-worker "" uv run python -m app.counterparty_worker
# The unattended AP worker. It spends model tokens whenever the sandbox has open exceptions.
start auto-agent "" uv run python -m app.auto_agent
echo "frontend: cd web/studio && bun run dev   (http://localhost:3888)"
