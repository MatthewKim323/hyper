"""The evaluation contract. Everything the Benchmarks page renders comes from a
BenchmarksDocument produced by export_demo(); nothing in the UI computes a score.

Rules baked into the types:
- a missing measurement is Unavailable with a reason, never 0 and never a sample value
- execution, provenance and outcome are separate dimensions
- every run names the exact system manifest it measured
"""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1

Mode = Literal["LIVE", "RECORDED_REPLAY", "DEV_FIXTURE"]
Execution = Literal["planned", "running", "completed", "failed", "cancelled"]
Provenance = Literal["custom", "local_public_dev", "adapted_external", "publisher_scored",
                     "independently_validated", "authorized_private"]
Outcome = Literal["pass", "fail", "partial", "correct_escalation", "waiting", "unsupported",
                  "not_tested", "error"]
Layer = Literal["external", "workflow", "crypto", "reliability"]
Access = Literal["available", "gated", "pending", "blocked"]
CapabilityStatus = Literal["supported", "partial", "unsupported", "untested", "access_blocked"]
SystemKind = Literal["FULL_SYSTEM", "WEIGHTS_ONLY", "ABLATION", "RULES_BASELINE", "ORACLE_SMOKE"]
ClaimStatus = Literal["supported", "unsupported", "untested"]


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Measured(_M):
    status: Literal["measured"] = "measured"
    value: float
    unit: str
    n: int | None = None            # denominator behind the value
    ci_low: float | None = None
    ci_high: float | None = None
    ci_method: str | None = None    # e.g. "family-level bootstrap, 95%"


class Unavailable(_M):
    status: Literal["unavailable"] = "unavailable"
    reason: str


Metric = Annotated[Union[Measured, Unavailable], Field(discriminator="status")]


class SystemManifest(_M):
    """What was actually evaluated. A checkpoint label must resolve to one of these."""
    id: str
    label: str
    kind: SystemKind
    created_at: str
    git_commit: str | None = None
    models: dict[str, str] = {}     # role -> exact model id (investigator, reviewer, jev, grader...)
    adapter_hash: str | None = None  # trained weights, when they exist
    prompts_version: str | None = None
    tools_version: str | None = None
    policy_version: str | None = None
    memory_enabled: bool | None = None
    jev_enabled: bool | None = None
    reviewer_enabled: bool | None = None
    fallback_models: list[str] = []
    decoding: dict[str, float | int | str] = {}
    notes: str = ""


class Family(_M):
    id: str
    name: str
    task_count: int


class Suite(_M):
    id: str
    name: str
    layer: Layer
    owner: str
    provenance: Provenance
    protocol: Literal["native", "adapted", "custom"]
    access: Access
    access_note: str = ""
    source_urls: list[str] = []
    revision: str | None = None
    revision_checked_at: str | None = None
    license: str | None = None
    split: str | None = None
    task_count: int | None = None
    native_metric: str
    native_metric_note: str = ""
    families: list[Family] = []
    restrictions: list[str] = []    # what a result on this suite must NOT be called


class Capability(_M):
    id: str
    area: str
    name: str
    status: CapabilityStatus
    entry_point: str | None = None
    human_authority: str | None = None
    test_families: list[str] = []
    task_count: int = 0
    passed: int | None = None
    failed: int | None = None
    evidence_refs: list[str] = []
    note: str = ""


class OutcomeCounts(_M):
    # "pass" is a Python keyword, so the counters carry an n_ prefix in every language.
    n_pass: int = 0
    n_fail: int = 0
    n_partial: int = 0
    n_correct_escalation: int = 0
    n_waiting: int = 0
    n_unsupported: int = 0
    n_not_tested: int = 0
    n_error: int = 0


class Run(_M):
    id: str
    suite_id: str
    system_id: str
    mode: Mode
    execution: Execution
    provenance: Provenance
    started_at: str | None = None
    finished_at: str | None = None
    n_tasks: int
    trials_per_task: int
    native_score: Metric
    whole_task_success: Metric
    unassisted_completion: Metric   # on predeclared eligible resolvable tasks only
    correct_escalation_rate: Metric  # on insufficient-evidence tasks only
    pass_at_1: Metric
    pass_any_of_k: Metric
    pass_all_of_k: Metric           # computed per task, never by exponentiating the aggregate
    outcomes: OutcomeCounts
    required_approvals: Metric
    investigative_assists: Metric
    invalid_actions_attempted: Metric
    invalid_actions_blocked: Metric
    invalid_actions_accepted: Metric
    cost_usd: Metric
    wall_ms: Metric
    tool_calls: Metric
    external_messages: Metric
    incidents: list[str] = []       # timeouts and infra failures are kept, not dropped
    artifact_ref: str | None = None
    reproduce: str | None = None


class Trial(_M):
    id: str
    run_id: str
    task_id: str
    family_id: str | None = None
    trial_index: int
    execution: Execution
    outcome: Outcome
    native_score: Metric
    evidence_checks_passed: int | None = None
    evidence_checks_total: int | None = None
    control_failures: list[str] = []
    assistance: list[str] = []
    error_class: str | None = None
    wall_ms: int | None = None
    artifact_ref: str | None = None


class TaskDelta(_M):
    task_id: str
    family_id: str | None = None
    baseline: Outcome
    candidate: Outcome
    bucket: Literal["both_pass", "gained", "regressed", "both_fail", "unavailable"]


class Comparison(_M):
    id: str
    kind: Literal["WEIGHTS_ONLY", "FULL_SYSTEM", "ABLATION", "DATA_ENGINE", "RL"]
    baseline_run_id: str
    candidate_run_id: str
    comparable: bool
    reasons: list[str] = []         # why it is or is not a matched comparison
    changed: list[str] = []         # the one thing that differs, when it is an ablation
    tasks: list[TaskDelta] = []


class Claim(_M):
    id: str
    claim: str
    status: ClaimStatus
    evidence_refs: list[str] = []
    demo_allowed: bool              # unsupported claims must not appear in the demo


class BenchmarksDocument(_M):
    schema_version: Literal[1] = SCHEMA_VERSION
    generated_at: str
    generator_commit: str | None = None
    display_mode: Mode              # DEV_FIXTURE documents are layout samples, never results
    systems: list[SystemManifest] = []
    suites: list[Suite] = []
    capabilities: list[Capability] = []
    runs: list[Run] = []
    trials: list[Trial] = []
    comparisons: list[Comparison] = []
    claims: list[Claim] = []
