"""Keyless local backend for building the workspace UI.

Runs backend/app unchanged, with three stand-ins so no account or paid service is needed:
  - sign-in: one fixed bearer token is accepted in place of a Clerk JWT
  - storage: originals stay in memory, evidence search is a simple in-process keyword match
  - models: concern cards come from canned text instead of the evaluator

It then seeds a small Meridian workspace (sources, concerns in several states, agent cases and
tasks, a few simulated activity events) so every section has something real to render.
Everything is labelled DEV_FIXTURE. Nothing here proves an agent did any work.

Binds to 127.0.0.1 only. Never deploy it. Run from the repo root:

    uv run --directory backend python ../web/studio/tools/dev_backend.py

Then start Next with NEXT_PUBLIC_BACKEND_DEV_TOKEN=dev-local-only and
ONBOARDING_BACKEND_URL=http://127.0.0.1:8010 (see web/studio/lib/backend/README.md).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"
DEV_DIR = ROOT / "web" / "studio" / ".dev"
DEV_TOKEN = os.environ.get("DEV_BACKEND_TOKEN", "dev-local-only")
DEV_USER = "user_dev_fixture"
PORT = int(os.environ.get("DEV_BACKEND_PORT", "8010"))

DEV_DIR.mkdir(parents=True, exist_ok=True)
database = DEV_DIR / "dev.sqlite"
for stale in DEV_DIR.glob("dev.sqlite*"):
    stale.unlink()
os.environ["DATABASE_URL"] = ""
os.environ["DATABASE_PATH"] = str(database)
os.environ["ALLOWED_ORIGINS"] = ",".join(f"http://{h}:{p}" for h in ("localhost", "127.0.0.1") for p in (3888, 3889))
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import httpx  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from app import auth, data_api, main  # noqa: E402
from app.concerns import ConcernService, Finish, RaiseConcern, Respond  # noqa: E402
from app.data_service import DataService  # noqa: E402
from app.orchestrator import AgentService, CaseState, Delegate, PutCase  # noqa: E402
from app.simulator import CreateSimulation, SimulatorService, run_once as simulate_once  # noqa: E402


# --- stand-ins -------------------------------------------------------------------------------

def verify(token: str) -> auth.Identity:
    if token != DEV_TOKEN:
        raise HTTPException(401, "Invalid or expired login token")
    return auth.Identity(DEV_USER, int(time.time()) + 86400)


auth.verify = verify


class MemoryObjects:
    def __init__(self) -> None:
        self.data: dict[str, bytes] = {}

    def put(self, key, body, content_type):
        self.data[key] = body

    def read(self, key):
        return self.data[key]


class KeywordSearch:
    """Just enough of the search interface for the UI: term overlap over indexed chunks."""
    mode = "keyword"

    def __init__(self) -> None:
        self.docs: dict[str, dict] = {}

    def ensure_index(self):
        pass

    def refresh(self):
        pass

    def index_chunks(self, source, rows):
        for row in rows:
            self.docs[row["id"]] = dict(row)

    def search(self, oid, ids, query, limit):
        terms = {t for t in query.lower().split() if len(t) > 2}
        scored = []
        for row in self.docs.values():
            if row["organization_id"] != oid or row["source_id"] not in ids:
                continue
            score = sum(1 for t in terms if t in row["content"].lower())
            if score:
                scored.append((score, row))
        scored.sort(key=lambda pair: -pair[0])
        return [{"_source": {"chunk_id": row["id"]}, "_score": float(score)} for score, row in scored[:limit]]


OBJECTS, SEARCH = MemoryObjects(), KeywordSearch()


def data_for(oid: str) -> DataService:
    return DataService(main.store, oid, OBJECTS, SEARCH)


def service(identity=main.Depends(auth.current_user)):
    return data_for(main.store.workspace(identity.user_id)["id"])


main.app.dependency_overrides[data_api.service] = service

CARDS = {
    "hero-inv-1042": ("INV-1042 bills 1,000 units at $120. The agreement price is $100 and only 800 units were received. The status of the other 200 units is unknown.", [
        ("Ask both parties before deciding", "Ask procurement whether the 200 unreceived units were cancelled or are late, and ask the supplier through its approved contact to explain the $120 price.", "Slowest, but nothing is assumed.", False),
        ("Keep the invoice on hold", "Leave INV-1042 blocked and take no outside action until someone supplies the amendment or the receiving record.", "No progress on the payment batch this week.", False),
        ("Prepare payment for received units at the agreement price", "Draft an $80,000 payable for 800 units at $100 and route it to the controller.", "Pays without supplier credits on file, so the books would not tie to the invoice.", True),
    ]),
    "remit-change-dv014": ("A supplier email asks to move payments to a new bank account. The vendor master still shows the approved account.", [
        ("Verify through the approved contact", "Call back the contact on the vendor master, not the one in the email, and open a vendor-master change only if confirmed.", "Payment stays blocked until the call-back completes.", False),
        ("Ignore the request", "Keep paying the approved account and file the email as evidence.", "A legitimate change would be delayed.", False),
        ("Escalate to the controller now", "Send the email, the vendor master record and the payment history to the controller as a suspected redirection attempt.", "Uses controller time before the call-back result is known.", True),
    ]),
    "dup-credit-cm-310": ("Credit memo CM-310 arrived twice with the same memo number. Only one copy is allocated.", [
        ("Record the second copy as a duplicate", "Keep one allocation of CM-310, mark the second delivery as a duplicate and tell the supplier one copy was discarded.", "None expected.", False),
        ("Ask the supplier which copy is authoritative", "Hold both copies until the supplier confirms they are the same credit.", "Delays an invoice that is otherwise ready.", False),
        ("Apply both credits", "Treat the deliveries as two separate credits.", "Almost certainly understates the payable.", True),
    ]),
}


_real_client = httpx.Client

# DEV_BACKEND_REAL_EVALUATOR=1 lets chart composition reach the real evaluator service (needs its keys),
# so the point-and-speak layer can be exercised end to end without Clerk.
REAL_EVALUATOR = os.environ.get("DEV_BACKEND_REAL_EVALUATOR") == "1"


def evaluator(request: httpx.Request) -> httpx.Response:
    if REAL_EVALUATOR and request.url.path.endswith("/artifact-compose"):
        with _real_client(timeout=10) as client:
            upstream = client.post(str(request.url), headers={"Authorization": request.headers.get("Authorization", "")}, content=request.content)
        return httpx.Response(upstream.status_code, content=upstream.content, headers={"Content-Type": "application/json"})
    if not request.url.path.endswith("/concern-card"):
        return httpx.Response(503, json={"error": "no model behind the keyless dev backend"})
    body = json.loads(request.content)
    summary, options = CARDS[body["concern"]["request_key"]]
    return httpx.Response(200, json={
        "approved": True,
        "evaluation": {"model": "DEV_FIXTURE canned card, not Jev", "threshold": 0.85,
                       "answers": {k: {"probability": 0.0} for k in ("grounded", "distinct", "authority")}},
        "card": {"summary": summary, "options": [
            {"id": f"option_{i + 1}", "title": t, "action": a, "tradeoff": d, "requires_approval": r}
            for i, (t, a, d, r) in enumerate(options)]},
    })


httpx.Client = lambda **kw: _real_client(transport=httpx.MockTransport(evaluator), **{k: v for k, v in kw.items() if k != "transport"})


# --- seed --------------------------------------------------------------------------------------

def seed_accounting() -> None:
    """The hero invoice, worked through the real engine: records verified, both credits inspected, one
    payable proposal left waiting for an owner. Same steps as backend/tests/test_accounting.py."""
    from sqlalchemy import select
    from mirror_resolve import store as ledger
    from mirror_resolve.fixtures import hero
    from app.accounting import Accounting, PromoteRecord

    store = main.store
    oid = store.workspace(DEV_USER)["id"]
    data = data_for(oid)
    svc = Accounting(store, oid)

    def promote(kind: str, record: dict) -> None:
        source = data.ingest(f"{kind}-{next(iter(record.values()))}.json", json.dumps([record]).encode(), dataset="ap_" + kind.lower())
        svc.promote(PromoteRecord(source_id=source["id"], row_number=1, record_type=kind,
                                  attestation="I verified this structured record against its source"), "human:" + DEV_USER + ":DEV_FIXTURE")

    engine = ledger.make_engine("sqlite:///:memory:")
    with engine.begin() as db:
        hero.seed_initial(db)
        initial = [dict(r) for r in db.execute(select(ledger.records).order_by(ledger.records.c.id)).mappings()]
    engine.dispose()
    for row in initial:
        promote(row["record_type"], row["data"])
    case_id = svc.execute("open_payable_case", {"invoice_id": "INV-1042"})["case"]["case_id"]
    for built in (hero.cancellation_record(), hero.supplier_ack(), hero.price_credit(), hero.quantity_credit()):
        promote(built[0], built[1])
    for credit in ("CM-201", "CM-202"):
        svc.execute("inspect_payable_credit", {"case_id": case_id, "credit_id": credit})
    revision = svc.execute("analyze_payable", {"case_id": case_id})["case"]["revision"]
    svc.execute("prepare_payable_proposal", {"case_id": case_id, "based_on_revision": revision})
    print("seeded accounting: INV-1042 with a payable proposal awaiting owner approval")

def seed_skills() -> None:
    """One drafted skill with a passing agent-reported run, waiting for an owner's review, so the
    Training Arena has something real to open. Same shape as backend/tests/test_learned_skills.py."""
    from app.learned_skills import Draft, Run, Skills

    store = main.store
    oid = store.workspace(DEV_USER)["id"]
    data = data_for(oid)
    evidence = data.ingest("DEV_FIXTURE-accrual-run.txt", b"DEV_FIXTURE execution log: pytest tests/test_calc.py ... 2 passed. 40 units at 1000.00 = 40000.00, matches the contract schedule.")["id"]
    skills = Skills(store, oid, objects=OBJECTS, search=SEARCH)
    saved = skills.save(Draft(
        name="fixed-rate-service-accrual",
        description="Calculate month-end accruals for confirmed fixed-rate services",
        instructions="Read the contract rate and the confirmed delivery up to the cutoff. Run scripts/calculate.py, then tests/test_calc.py, before preparing an accrual. Escalate anything unconfirmed; never post a journal.",
        applicability="Confirmed whole-unit service delivery in USD with approved account mappings.",
        limitations="No FX, taxes, capitalization or unconfirmed service. No automatic ledger posting.",
        source_ids=[evidence],
        resources={"scripts/calculate.py": "def amount(qty, price_cents):\n    return qty * price_cents\n",
                   "tests/test_calc.py": "from calculate import amount\n\ndef test_forty_units():\n    assert amount(40, 100000) == 4000000\n"},
    ))
    skills.record(Run(skill_id=saved["id"], request_key="DEV_FIXTURE-run-1", package_hash=saved["package_hash"], outcome="passed",
                      summary="Executed the saved calculation against the contract schedule and an independent hand total.",
                      evidence_source_ids=[evidence], checks=["40 units at 1000.00 equals 40000.00", "Result matches the independent hand total"], duration_ms=1840))
    print("seeded skills: one draft with a passing reported run, awaiting owner review")

def seed() -> None:
    from app.ingestion_worker import run_once as index_once

    store = main.store
    oid = store.workspace(DEV_USER)["id"]
    data = data_for(oid)
    visible = ROOT / "data" / "generated" / "visible"

    def rows(name: str, count: int) -> bytes:
        with (visible / f"{name}.jsonl").open("rb") as handle:
            return b"".join(line for _, line in zip(range(count), handle))

    sources = {}
    for name, count in (("ap_invoices", 120), ("vendors", 60), ("purchase_orders", 120), ("ap_credits", 60)):
        sources[name] = data.ingest(f"{name}.jsonl", rows(name, count), source_key=f"demo/{name}.jsonl", dataset=name, currency="USD")["id"]
    for case in ("CASE-001", "CASE-009", "CASE-013"):
        sources[case] = data.ingest(f"{case}.json", (visible / "cases" / f"{case}.json").read_bytes(), source_key=f"demo/cases/{case}.json")["id"]
    while index_once(store, SEARCH):
        pass

    concerns = ConcernService(data)
    hero = concerns.raise_concern(RaiseConcern(request_key="hero-inv-1042", title="INV-1042 price and quantity do not match the order",
        description="Invoice unit price exceeds the agreement and billed quantity exceeds receipts.", severity="high", source_ids=[sources["CASE-001"], sources["ap_invoices"]]))
    remit = concerns.raise_concern(RaiseConcern(request_key="remit-change-dv014", title="Supplier asked to change its payment account by email",
        description="Requested destination differs from the approved vendor master.", severity="critical", source_ids=[sources["CASE-013"], sources["vendors"]]))
    dup = concerns.raise_concern(RaiseConcern(request_key="dup-credit-cm-310", title="Credit memo CM-310 was delivered twice",
        description="Same memo number on two deliveries.", severity="medium", source_ids=[sources["CASE-009"], sources["ap_credits"]]))
    concerns.respond(remit["id"], Respond(option_id="option_1"), DEV_USER)
    concerns.respond(dup["id"], Respond(option_id="option_1"), DEV_USER)
    claim = concerns.claim(dup["id"])
    concerns.finish(Finish(concern_id=dup["id"], claim_token=claim["claim_token"], outcome="resolved",
        summary="DEV_FIXTURE resolution text. One allocation of CM-310 kept, second delivery recorded as a duplicate.", source_ids=[sources["CASE-009"]]))

    agents = AgentService(store, oid)
    case = agents.put_case(PutCase(case_key="ap/INV-1042", title="INV-1042: price and quantity exception", expected_version=0, state=CaseState(
        findings=["Invoice bills 1,000 units at $120.00, agreement AGR-220 prices the item at $100.00", "Receiving record GR-771 shows 800 units"],
        unknowns=["Whether a price amendment exists", "Whether the other 200 units are late, unrecorded or cancelled"],
        next_actions=["Ask procurement for the status of the 200 units", "Ask the supplier, through the approved contact, about the unit price"],
        source_ids=[sources["CASE-001"], sources["ap_invoices"], sources["purchase_orders"]], concern_ids=[hero["id"]])))
    agents.put_case(PutCase(case_key="ap/remit-DV014", title="Payment account change requested by email", expected_version=0, state=CaseState(
        findings=["Requested account differs from the approved vendor master"], unknowns=["Whether the request is genuine"],
        next_actions=["Call back the approved contact"], source_ids=[sources["CASE-013"], sources["vendors"]], concern_ids=[remit["id"]])))
    agents.put_case(PutCase(case_key="ap/CM-310", title="Duplicate delivery of credit memo CM-310", expected_version=0, state=CaseState(
        findings=["Same memo number on both deliveries", "One allocation recorded"], unknowns=[], next_actions=[],
        source_ids=[sources["CASE-009"], sources["ap_credits"]], concern_ids=[dup["id"]])))
    agents.delegate(Delegate(request_key="task/INV-1042/receiving", case_id=case["id"], objective="Establish the status of the 200 unreceived units on PO-481 from receiving and procurement records."))

    sims = SimulatorService(data)
    run = sims.create(CreateSimulation(name="Meridian week (dev fixture)", mode="template", max_ticks=12, seed=7))["id"]
    for _ in range(8):
        sims.control(run, "tick")
        simulate_once(store, data_for)
    while index_once(store, SEARCH):
        pass
    print(f"seeded org {oid}: {len(sources)} sources, 3 concerns, 3 cases, 1 task, 8 simulated events", flush=True)


if __name__ == "__main__":
    import uvicorn

    seed()
    seed_accounting()
    seed_skills()
    print(f"dev backend on http://127.0.0.1:{PORT}  token: {DEV_TOKEN}", flush=True)
    uvicorn.run(main.app, host="127.0.0.1", port=PORT, log_level="warning")
