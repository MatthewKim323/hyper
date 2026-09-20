#!/bin/sh
# Restart every process of the model-worker exception loop on the code that is on disk now.
# A worker runs the code it started with, so after any change to backend/app restart them all together:
# one left on old code fails quietly (the mirror once stopped copying cases for an hour this way).
# Opens no tunnel and does not touch the API, the adversary settings or the Devin dispatcher.
#   LOOP_PAIRS    treatment:control organizations   (default hyper-lab:hyper-lab-control)
#   LOOP_WORKERS  model workers                     (default 2)
#   LOOP_MODEL    model                             (default gpt-5.6-terra)
#   SPEND_CAP     dollars an hour across everything (default 5). SPEND_GUARD_ORGS is what it paces to get there:
#                 the lab only. The demo company's pace is set by tools/demo-mode.sh, because every case there adds
#                 simulated documents to evidence a person will search.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"; mkdir -p var
# The key in backend/.env pays for the loop. A key exported in the shell would win over it silently
# (dotenv never overrides), and has billed the wrong account before.
unset OPENAI_API_KEY AI_GATEWAY_API_KEY
PAIRS="${LOOP_PAIRS:-hyper-lab:hyper-lab-control}"; WORKERS="${LOOP_WORKERS:-2}"; MODEL="${LOOP_MODEL:-gpt-5.6-terra}"
for name in app.counterparty_worker "app.devin_exceptions\$" app.auto_agent app.spend_guard app.bench_timeline app.learning_log; do pkill -f "python -m $name" 2>/dev/null || true; done
sleep 1
COUNTERPARTY_TIMEOUT_MS="${COUNTERPARTY_TIMEOUT_MS:-600000}" nohup uv run python -m app.counterparty_worker > var/counterparty-worker.log 2>&1 &
DEVIN_EXCEPTION_TASKS=false DEVIN_CONTROL_PAIRS="$PAIRS" nohup uv run python -m app.devin_exceptions > var/devin-exceptions.log 2>&1 &
k=0; while [ $k -lt "$WORKERS" ]; do
  AUTO_AGENT_SHARD="$k/$WORKERS" AUTO_AGENT_MODEL="$MODEL" DEVIN_CONTROL_PAIRS="$PAIRS" nohup uv run python -m app.auto_agent > "var/auto-agent-$k.log" 2>&1 &
  k=$((k+1)); done
nohup uv run python -m app.spend_guard --cap "${SPEND_CAP:-5}" ${SPEND_GUARD_ORGS:-hyper-lab} > var/spend-guard.log 2>&1 &
nohup uv run python -m app.bench_timeline hyper-lab demo-meridian --every 300 > var/bench-timeline.log 2>&1 &
# Copies the worker's lessons and the with/without-memory score into backend/benchmarks/learning/ and commits
# and pushes that, and only that, when there is something new: the agent's learning shows up in git history.
nohup uv run python -m app.learning_log "${PAIRS%%:*}" --control "${PAIRS##*:}" --every "${LEARNING_LOG_EVERY:-1800}" > var/learning-log.log 2>&1 &
sleep 4
echo "sandbox, mirror, $WORKERS x $MODEL, spend guard, timeline and learning log restarted on $(git -C "$ROOT" rev-parse --short HEAD)"
