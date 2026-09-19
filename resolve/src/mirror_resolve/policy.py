"""Configurable policy for the synthetic fixture company. Not accounting advice."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Policy:
    version: str = "demo-policy-v1"
    currency: str = "USD"
    # Net payable at or above this needs a controller approval bound to the exact proposal.
    approval_threshold_cents: int = 2_500_000
    # Any proposal that applies credits needs approval regardless of size.
    credits_require_approval: bool = True
    # Sources whose structured records count as trusted under the fixture's provenance rules.
    trusted_sources: frozenset[str] = frozenset(
        {"ERP", "PROCUREMENT_SYSTEM", "RECEIVING_SYSTEM", "SUPPLIER_PORTAL"}
    )
    # Follow-up behaviour, in simulated business hours.
    followup_after_hours: int = 24
    max_followups: int = 2
    max_agent_turns: int = 40
    inventory_clearing_account: str = "1410-INVENTORY-CLEARING"
    ap_account: str = "2000-ACCOUNTS-PAYABLE"
    extra: dict = field(default_factory=dict)

    def approval_required(self, net_cents: int, credit_count: int) -> bool:
        if net_cents >= self.approval_threshold_cents:
            return True
        return self.credits_require_approval and credit_count > 0


DEFAULT_POLICY = Policy()
