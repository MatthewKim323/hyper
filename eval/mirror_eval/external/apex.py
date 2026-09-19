"""APEX public development tasks: documented stub, no runner yet.

Any result produced through this path must be labeled
"APEX public development tasks / Harbor / local evaluation" and must never be presented as a
private leaderboard score.
"""
from __future__ import annotations

RESULT_LABEL = "APEX public development tasks / Harbor / local evaluation"

# Setup commands as documented by the publisher. Empty until someone verifies them against the
# source: no command or flag is written here from memory.
SETUP_COMMANDS: tuple[str, ...] = ()
SETUP_COMMANDS_STATUS = "pending source verification"


def visibility_contract() -> dict[str, list[str]]:
    return {
        "agent_may_see": ["task prompt and input files as shipped in the public development set"],
        "must_stay_private": [
            "reference answers and rubrics",
            "grader prompts and grader model outputs",
            "any held-out or private leaderboard tasks (we do not have them and must not imply we do)",
            "results of earlier trials on the same task",
        ],
    }


def run(*_args, **_kwargs):
    raise NotImplementedError(
        "APEX runner is pending: (1) verify the source, revision, license and access, and record them in "
        "eval/registry/suites.json, (2) record the publisher's documented Harbor setup commands in "
        "SETUP_COMMANDS, (3) write the task loader and the AgentAdapter bridge, (4) wire the native scorer. "
        "None of these exist yet, so no APEX number exists.")
