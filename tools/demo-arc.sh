#!/bin/sh
# The mistake-and-lesson moment, on demand, for a recording. Real runs, nothing scripted: the worker's memory is
# set aside (not deleted), it meets a trap for the first time, the grader catches it, it writes itself a lesson,
# and it meets the same kind of trap again. You choose when each beat happens.
#
#   tools/demo-arc.sh start          quiet the room (no other cases arriving) and set the worker's memory aside
#   tools/demo-arc.sh trap [family]  deal one trap now (default goods_returned: every check passes, the goods are going back)
#   tools/demo-arc.sh watch          what happened to the traps you dealt, live
#   tools/demo-arc.sh end            bring the memory back (plus what it just learned) and return to demo pace
#
# On camera: start, trap, (it pays: the CFO reads the audit finding, then "wrote itself a lesson"), trap again,
# (it holds, the CFO says why, a decision card may rise). Without memory this trap was missed 9 times of 9.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT/backend"
ORG="${DEMO_ORG:-demo-meridian}"; ctl() { uv run python -m app.devin_exceptions_ctl "$@" 2>/dev/null; }
case "${1:-}" in
  start) ctl off "$ORG" | head -1; ctl forget "$ORG" ;;
  trap)  ctl deal "$ORG" "${2:-goods_returned}" ;;
  watch) uv run python - "$ORG" <<'PY' 2>/dev/null
import os, sys, time
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"]); org = sys.argv[1]
words = {"pass": "paid, correctly", "correct_hold": "HELD, correctly", "fail": "WRONG RELEASE", "timeout": "ran out of time", None: "working"}
while True:
    with e.connect() as db:
        rows = db.execute(text("select s.invoice_id, s.family, s.outcome, s.state->'agent'->>'status' st, s.created_at, (select count(*) from agent_lessons l where l.scenario_id=s.id) learned from counterparty_scenarios s where s.organization_id=:o and s.created_by='owner' order by s.created_at desc limit 4"), {"o": org}).all()
    print("\033[2J\033[H" + time.strftime("%H:%M:%S"))
    for r in reversed(rows): print(f"  {r.invoice_id}  {r.family:<18} {words[r.outcome]:<18} worker: {r.st or '-':<9} {'lesson written' if r.learned else ''}  ({int(time.time() - r.created_at / 1000)}s ago)")
    time.sleep(2)
PY
  ;;
  end)   ctl remember "$ORG"; "$ROOT/tools/demo-mode.sh" on ;;
  *) sed -n 2,12p "$0"; exit 1 ;;
esac
