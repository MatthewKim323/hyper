"""Evaluator-owned counterparty simulator.

The fixtures stage future supplier and internal responses in the private tree. The agent
never sees them up front. It asks through sandbox.counterparty.request(trigger) and gets
whatever the fixture staged for that trigger, or nothing (silence is a fixture outcome).

Trigger names are one global vocabulary shared by every case, so publishing them says
nothing about any single case.
"""
from __future__ import annotations

import copy

TRIGGERS = (
    "request_price_correction",
    "redeliver_price_correction",
    "request_quantity_status",
    "request_cancellation_acceptance_and_credit",
    "supplier_unsolicited_reply",
    "review_started",
)


class CounterpartySim:
    def __init__(self, events: tuple[dict, ...]):
        self._events = events
        self.requests: list[str] = []       # evaluator-side log, not shown to the agent

    def request(self, trigger: str) -> list[dict]:
        if trigger not in TRIGGERS:
            raise ValueError(f"unknown trigger {trigger!r}, expected one of {TRIGGERS}")
        self.requests.append(trigger)
        return [copy.deepcopy(e["document"]) for e in self._events
                if e.get("trigger") == trigger and e.get("document")]
