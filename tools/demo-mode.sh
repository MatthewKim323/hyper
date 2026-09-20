#!/bin/sh
# Demo pace for the company the UI shows. `on`: a new exception about every 45 seconds in demo-meridian, so the
# CFO has something to narrate, and the lab slows down to leave the budget and the machine to it.
# `off`: back to one every five minutes, lab back to full pace. Every case adds ~6 simulated documents to
# demo-meridian's evidence, so leave it `off` when nobody is watching.
set -e
cd "$(cd "$(dirname "$0")/.." && pwd)/backend"
case "${1:-on}" in
  on)  uv run python -m app.devin_exceptions_ctl on demo-meridian --every 45 --open 3 | head -1
       uv run python -m app.devin_exceptions_ctl on hyper-lab --every 120 --open 3 | head -1 ;;
  off) uv run python -m app.devin_exceptions_ctl on demo-meridian --every 300 --open 2 | head -1
       uv run python -m app.devin_exceptions_ctl on hyper-lab --every 30 --open 6 | head -1 ;;
  *) echo "usage: tools/demo-mode.sh on|off"; exit 1 ;;
esac
