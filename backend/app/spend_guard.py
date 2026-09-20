"""Keeps the exception loop under a dollar-per-hour cap by pacing the adversary, not by trusting an estimate.

Reads the worker's metered token usage (var/auto-agent-usage.jsonl), prices the last ten minutes at
list rates, and stretches or tightens the interval between new exceptions so the measured rate
settles at the cap. Far over the cap, it pauses new exceptions until the rate comes back down.

    uv run --directory backend python -m app.spend_guard --cap 5 ORG [ORG ...]
"""
import argparse
import json
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

from .counterparty import Counterparties  # noqa: E402
from .data_service import DataService  # noqa: E402
from .store import Store  # noqa: E402

# Dollars per million tokens: input, cached input, output. An unknown model is priced as the dearest.
PRICES = {'gpt-5.6-luna': (0.20, 0.02, 1.20), 'gpt-5.6-terra': (2, 0.2, 12), 'gpt-5.6-sol': (4, 0.4, 20), 'gpt-6-astra': (10, 1, 50), 'gpt-5-mini': (0.25, 0.025, 2)}
USAGE = Path(__file__).resolve().parents[1] / 'var' / 'auto-agent-usage.jsonl'
WINDOW_MS = 600_000
MIN_INTERVAL, MAX_INTERVAL = 5, 3600


def hourly(lines, now_ms, window_ms=WINDOW_MS):
    """Dollars per hour over the window, from metered usage lines."""
    spent = 0.0
    for line in lines:
        try: row = json.loads(line)
        except ValueError: continue
        if row.get('at', 0) < now_ms - window_ms: continue
        fresh, cached, out = PRICES.get(row.get('model'), max(PRICES.values()))
        spent += ((row['input'] - row['cached']) * fresh + row['cached'] * cached + row['output'] * out) / 1e6
    return spent * 3_600_000 / window_ms


def next_interval(current, rate, cap):
    """Spend scales with how often exceptions arrive, so scale the interval by how far off the cap we are. Damped, so it settles instead of swinging."""
    if rate <= 0: return current
    target = current * rate / cap
    return int(min(MAX_INTERVAL, max(MIN_INTERVAL, current + (target - current) * 0.6)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('organizations', nargs='+')
    parser.add_argument('--cap', type=float, required=True, help='dollars per hour across every worker')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    store, paused = Store(), set()  # only what this guard paused is ever resumed by it
    started = int(time.time() * 1000)
    while True:
        # Spend from before this guard started was someone else's pace: judging by it would stall a fresh start.
        now_ms = int(time.time() * 1000)
        window = max(60_000, min(WINDOW_MS, now_ms - started))
        rate = hourly(USAGE.read_text().splitlines() if USAGE.exists() else [], now_ms, window) if now_ms - started >= 60_000 else 0
        for oid in args.organizations:
            svc = Counterparties(DataService(store, oid))
            control = svc.control()
            if not control.get('enabled') and oid not in paused: continue
            if rate > args.cap * 3:
                paused.add(oid); svc.control({'enabled': False}); print(f'{time.strftime("%H:%M:%S")} {oid}: ${rate:.2f}/h is over three times the cap, new exceptions paused', flush=True)
            else:
                interval = next_interval(control['interval_seconds'], rate, args.cap)
                paused.discard(oid); svc.control({'enabled': True, 'interval_seconds': interval})
                print(f'{time.strftime("%H:%M:%S")} {oid}: ${rate:.2f}/h against ${args.cap:.2f}, one exception every {interval}s', flush=True)
        if args.once: break
        time.sleep(120)
