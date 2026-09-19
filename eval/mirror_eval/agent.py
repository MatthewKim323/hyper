"""The one seam between the harness and a system under test.

To evaluate a real agent: write one class that satisfies AgentAdapter, then register a
zero-argument factory for it in SUBJECT_AGENTS at the bottom of this file.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict

from .final_state import AgentTrace, CaseFinalState
from .schema import SystemManifest


class Limits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wall_seconds: float = 600.0
    max_tool_calls: int | None = None
    max_external_messages: int | None = None
    max_cost_usd: float | None = None       # per trial, advisory for the adapter


@runtime_checkable
class Counterparty(Protocol):
    """Evaluator-owned simulator for suppliers and internal teams. The agent sends a request
    trigger and gets back zero or more documents. Silence is a valid answer."""

    def request(self, trigger: str) -> list[dict]: ...


@dataclass
class SandboxHandle:
    workspace: Path
    counterparty: Counterparty | None = None
    seed: int | None = None
    cancel: threading.Event = field(default_factory=threading.Event)        # this trial (timeout)
    run_cancel: threading.Event = field(default_factory=threading.Event)    # the whole run

    def cancelled(self) -> bool:
        """Adapters should poll this between steps and stop promptly when it turns true."""
        return self.cancel.is_set() or self.run_cancel.is_set()


class AgentRunResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    final_state: CaseFinalState | None = None
    trace: AgentTrace | None = None
    cost_usd: float | None = None
    wall_ms: int | None = None
    tool_calls: int | None = None
    error_class: str | None = None
    error_detail: str | None = None


@runtime_checkable
class AgentAdapter(Protocol):
    def manifest(self) -> SystemManifest: ...

    def run_case(self, workspace: Path, sandbox: SandboxHandle, limits: Limits) -> AgentRunResult: ...


def read_case_id(workspace: Path) -> str:
    """Workspaces hold exactly one visible case file, named after the case."""
    files = sorted(workspace.glob("CASE-*.json"))
    if len(files) != 1:
        raise ValueError(f"expected one case file in {workspace}, found {len(files)}")
    return files[0].stem


# Grader self-test doubles. They exist to prove the grader rejects empty work and bare claims.
# They are not systems, they are never registered in SUBJECT_AGENTS, and nothing they produce
# is a result.

_SELFTEST_CREATED_AT = "1970-01-01T00:00:00Z"


class NoOpAgent:
    """GRADER SELF-TEST ONLY. Does nothing and says so."""

    def manifest(self) -> SystemManifest:
        return SystemManifest(id="selftest-noop", label="SELFTEST no-op (not a system)",
                              kind="ORACLE_SMOKE", created_at=_SELFTEST_CREATED_AT,
                              notes="grader self-test double, never a subject system")

    def run_case(self, workspace: Path, sandbox: SandboxHandle, limits: Limits) -> AgentRunResult:
        state = CaseFinalState(case_id=read_case_id(workspace), disposition="INVESTIGATING",
                               agent_claimed_done=False)
        return AgentRunResult(final_state=state, trace=AgentTrace())


class ClaimsDoneAgent:
    """GRADER SELF-TEST ONLY. Does no work, then claims the case is payment ready at a
    number handed to it by the test."""

    def __init__(self, guessed_net_cents: int):
        self.guessed_net_cents = guessed_net_cents

    def manifest(self) -> SystemManifest:
        return SystemManifest(id="selftest-claims-done", label="SELFTEST claims-done (not a system)",
                              kind="ORACLE_SMOKE", created_at=_SELFTEST_CREATED_AT,
                              notes="grader self-test double, never a subject system")

    def run_case(self, workspace: Path, sandbox: SandboxHandle, limits: Limits) -> AgentRunResult:
        state = CaseFinalState(case_id=read_case_id(workspace), disposition="PAYMENT_READY",
                               net_payable_cents=self.guessed_net_cents, agent_claimed_done=True)
        return AgentRunResult(final_state=state, trace=AgentTrace())


# Subject systems. EMPTY ON PURPOSE: no agent exists yet, so nothing can be measured yet.
#
# To register the real agent:
#   1. Write an adapter class with manifest() and run_case() (see AgentAdapter above).
#      run_case must read only `workspace`, talk to suppliers only through
#      `sandbox.counterparty.request(trigger)`, and build CaseFinalState from the backend's
#      persisted records once the agent stops.
#   2. Add a zero-argument factory here, keyed by the name used on the command line:
#          SUBJECT_AGENTS["resolve_v1"] = lambda: ResolveAdapter(...)
#   3. Run: uv run python -m mirror_eval run --suite ap_workflow --agent resolve_v1
# Do not register NoOpAgent, ClaimsDoneAgent or the oracle. A test enforces that.
SUBJECT_AGENTS: dict[str, Callable[[], AgentAdapter]] = {}
