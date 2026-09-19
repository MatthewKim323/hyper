"""Invoice Sandbox: documented stub, no runner yet.

This is an ingestion diagnostic (can the system read invoices into structured fields). It
cannot prove payment-ready AP work and must never be reported as if it did.
"""
from __future__ import annotations

RESULT_LABEL = "Invoice Sandbox ingestion diagnostic"

# Setup commands as documented by the publisher. Empty until verified against the source.
SETUP_COMMANDS: tuple[str, ...] = ()
SETUP_COMMANDS_STATUS = "pending source verification"


def visibility_contract() -> dict[str, list[str]]:
    return {
        "agent_may_see": ["invoice documents or images as shipped by the sandbox"],
        "must_stay_private": [
            "labeled field values and any expected extraction output",
            "scoring scripts' reference files",
            "results of earlier trials on the same document",
        ],
    }


def run(*_args, **_kwargs):
    raise NotImplementedError(
        "Invoice Sandbox runner is pending: (1) verify the source, revision, license and access, and record "
        "them in eval/registry/suites.json, (2) record the documented setup commands in SETUP_COMMANDS, "
        "(3) write the document loader and the extraction bridge, (4) wire the native field-level scorer. "
        "None of these exist yet, so no Invoice Sandbox number exists.")
