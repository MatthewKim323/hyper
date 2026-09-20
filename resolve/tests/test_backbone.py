"""M1 acceptance: the financial backbone holds without any model in the loop."""
import pytest
from sqlalchemy import select

from mirror_resolve import batch, casework, creditmemo, proposals, store
from mirror_resolve.fixtures import hero
from mirror_resolve.intake import receive_record

C = hero.COMPANY
HUMAN = "human:controller.demo"


def deliver(conn, built, **kw):
    rtype, data, src = built
    return receive_record(conn, C, rtype, data, **{**src, **kw})


def issues(conn, case_id):
    return {i["type"]: i for i in casework.list_issues(conn, case_id)}


def full_resolution(conn, case_id):
    deliver(conn, hero.cancellation_record())
    deliver(conn, hero.supplier_ack())
    deliver(conn, hero.price_credit())
    deliver(conn, hero.quantity_credit())
    creditmemo.inspect_credit_memo(conn, case_id, "CM-201", "agent:investigator")
    creditmemo.inspect_credit_memo(conn, case_id, "CM-202", "agent:investigator")


def prepare(conn, case_id):
    rev = casework.get_case(conn, case_id)["revision"]
    prop = proposals.propose_payable_update(conn, case_id, rev, actor="agent:investigator")
    review = proposals.record_review(conn, prop["proposal_id"], reviewer="agent:reviewer", verdict="PASS")
    return prop, review


def approve(conn, prop):
    apr = proposals.request_controller_approval(conn, prop["proposal_id"], actor="agent:investigator")
    proposals.decide_approval(conn, apr["approval_id"], decided_by=HUMAN, role="CONTROLLER",
                              decision="APPROVED", proposal_hash=prop["hash"])
    return apr


def test_original_documents_imply_two_issues_not_an_answer(conn):
    case = hero.seed_initial(conn)
    iss = issues(conn, case["case_id"])
    assert set(iss) == {"PRICE_VARIANCE", "QUANTITY_VARIANCE"}
    assert iss["PRICE_VARIANCE"]["status"] == "OPEN"
    assert iss["QUANTITY_VARIANCE"]["status"] == "UNKNOWN"
    assert iss["QUANTITY_VARIANCE"]["detail"]["unaccounted_qty"] == 200
    calc = proposals.calculate_supported_payable(conn, case["case_id"])
    assert calc["invoice_face_cents"] == 12_000_000
    assert calc["net_after_credits_cents"] == 12_000_000  # nothing is supported as a correction yet
    assert not calc["ties"]
    assert casework.get_case(conn, case["case_id"])["work_status"] == "INVESTIGATING"


def test_first_credit_resolves_price_only_and_cannot_release(conn):
    case = hero.seed_initial(conn)
    cid = case["case_id"]
    deliver(conn, hero.cancellation_record())
    deliver(conn, hero.price_credit())
    res = creditmemo.inspect_credit_memo(conn, cid, "CM-201", "agent:investigator")
    assert res["state"] == "VERIFIED"
    iss = issues(conn, cid)
    assert iss["PRICE_VARIANCE"]["status"] == "SATISFIED"
    assert iss["QUANTITY_VARIANCE"]["status"] not in casework.CLOSED
    assert casework.get_case(conn, cid)["work_status"] != "READY_FOR_REVIEW"

    prop, review = prepare(conn, cid)
    assert prop["payload"]["net_payable_cents"] == 10_000_000
    assert review["reviewer_verdict"] == "PASS" and review["verdict"] == "FAIL"  # model agreement is not enough
    with pytest.raises(proposals.ProposalError):
        proposals.request_controller_approval(conn, prop["proposal_id"], actor="agent:investigator")
    with pytest.raises(proposals.ProposalError):
        proposals.commit_proposal(conn, prop["proposal_id"], actor="worker", idempotency_key="k1")
    assert casework.get_case(conn, cid)["payment_status"] != "PAYMENT_READY"


@pytest.mark.parametrize("ack", [None, "DISPUTED"])
def test_missing_or_disputed_acceptance_keeps_quantity_open(conn, ack):
    cid = hero.seed_initial(conn)["case_id"]
    deliver(conn, hero.cancellation_record())
    if ack:
        deliver(conn, hero.supplier_ack(ack))
    deliver(conn, hero.price_credit())
    deliver(conn, hero.quantity_credit())
    creditmemo.inspect_credit_memo(conn, cid, "CM-201", "a")
    creditmemo.inspect_credit_memo(conn, cid, "CM-202", "a")
    q = issues(conn, cid)["QUANTITY_VARIANCE"]
    assert q["status"] not in casework.CLOSED
    unmet = [r["requirement"] for r in q["resolution_requirements"] if not r["met"]]
    assert any("acceptance" in r for r in unmet)


def test_two_valid_credits_produce_80k_and_need_exact_approval(conn):
    cid = hero.seed_initial(conn)["case_id"]
    full_resolution(conn, cid)
    assert casework.get_case(conn, cid)["work_status"] == "READY_FOR_REVIEW"
    prop, review = prepare(conn, cid)
    assert review["verdict"] == "PASS"
    assert prop["payload"]["net_payable_cents"] == 8_000_000
    assert prop["payload"]["approval_required"]
    with pytest.raises(proposals.ProposalError, match="approval"):
        proposals.commit_proposal(conn, prop["proposal_id"], actor="worker", idempotency_key="k1")
    approve(conn, prop)
    out = proposals.commit_proposal(conn, prop["proposal_id"], actor="worker", idempotency_key="k1")
    assert out["amount_cents"] == 8_000_000
    case = casework.get_case(conn, cid)
    assert (case["work_status"], case["payment_status"]) == ("RESOLVED", "PAYMENT_READY")


def test_no_cash_event_and_single_net_recognition(conn):
    cid = hero.seed_initial(conn)["case_id"]
    full_resolution(conn, cid)
    prop, _ = prepare(conn, cid)
    approve(conn, prop)
    proposals.commit_proposal(conn, prop["proposal_id"], actor="worker", idempotency_key="k1")
    rows = conn.execute(select(store.economic_events)).mappings().all()
    assert [r["type"] for r in rows] == ["AP_RECOGNITION"]
    assert rows[0]["amount_cents"] == 8_000_000  # net once, never gross plus credits again
    proj = batch.project_batch(conn, C)
    assert proj["cash_moved_cents"] == 0
    assert proj["ap_obligation_cents"] == proj["payment_ready_total_cents"] == 8_000_000
    line = proj["lines"][0]
    assert (line["invoice_face_cents"], line["verified_credits_cents"], line["planned_payment_cents"]) == (
        12_000_000, 4_000_000, 8_000_000)


def test_agent_and_preparer_cannot_approve(conn):
    cid = hero.seed_initial(conn)["case_id"]
    full_resolution(conn, cid)
    prop, _ = prepare(conn, cid)
    apr = proposals.request_controller_approval(conn, prop["proposal_id"], actor="agent:investigator")
    with pytest.raises(proposals.ProposalError):
        proposals.decide_approval(conn, apr["approval_id"], decided_by="agent:investigator",
                                  role="CONTROLLER", decision="APPROVED", proposal_hash=prop["hash"])
    with pytest.raises(proposals.ProposalError):
        proposals.record_review(conn, prop["proposal_id"], reviewer="agent:investigator", verdict="PASS")


def test_stale_approval_cannot_release_after_new_evidence(conn):
    cid = hero.seed_initial(conn)["case_id"]
    full_resolution(conn, cid)
    prop, _ = prepare(conn, cid)
    approve(conn, prop)
    # New receiving evidence lands during review: 100 more units actually arrived.
    receive_record(conn, C, "GOODS_RECEIPT", {"gr_id": "GR-790", "po_id": "PO-481", "received_on": "2026-09-14",
                                              "lines": [{"item_id": hero.ITEM, "qty": 100}]},
                   source_system="RECEIVING_SYSTEM")
    assert proposals.get_proposal(conn, prop["proposal_id"])["status"] == "INVALIDATED"
    case = casework.get_case(conn, cid)
    assert case["authorization_status"] == "NOT_REQUESTED" and case["payment_status"] == "NOT_PREPARED"
    with pytest.raises(proposals.ProposalError):
        proposals.commit_proposal(conn, prop["proposal_id"], actor="worker", idempotency_key="k1")
    assert issues(conn, cid)["QUANTITY_VARIANCE"]["status"] == "OPEN"  # reopened, not silently kept


def test_duplicate_deliveries_and_retries_have_one_effect(conn):
    cid = hero.seed_initial(conn)["case_id"]
    full_resolution(conn, cid)
    rev = casework.get_case(conn, cid)["revision"]
    again = deliver(conn, hero.price_credit(), source_msg_id=None)
    assert again["duplicate"] and casework.get_case(conn, cid)["revision"] == rev
    # Same memo number re-sent under a new id is tracked as a duplicate, never usable.
    rtype, data, src = hero.price_credit()
    receive_record(conn, C, rtype, {**data, "cm_id": "CM-201-B"}, **src)
    assert creditmemo.inspect_credit_memo(conn, cid, "CM-201-B", "a")["state"] == "DUPLICATE"
    prop, _ = prepare(conn, cid)
    assert prop["payload"]["net_payable_cents"] == 8_000_000
    approve(conn, prop)
    a = proposals.commit_proposal(conn, prop["proposal_id"], actor="worker", idempotency_key="k1")
    b = proposals.commit_proposal(conn, prop["proposal_id"], actor="worker", idempotency_key="k1")
    assert not a["replayed"] and b["replayed"] and a["econ_id"] == b["econ_id"]
    with pytest.raises(proposals.ProposalError):
        proposals.commit_proposal(conn, prop["proposal_id"], actor="worker", idempotency_key="k2")
    assert len(conn.execute(select(store.economic_events)).all()) == 1
    assert len(conn.execute(select(store.credit_allocations)).all()) == 2


def test_credit_cannot_be_consumed_twice(conn):
    cid = hero.seed_initial(conn)["case_id"]
    full_resolution(conn, cid)
    prop, _ = prepare(conn, cid)
    approve(conn, prop)
    # A competing worker already consumed CM-202 somewhere else.
    conn.execute(store.credits.update().where(store.credits.c.credit_id == "CM-202")
                 .values(remaining_cents=0, state="ALLOCATED"))
    with pytest.raises(proposals.ProposalError):
        proposals.commit_proposal(conn, prop["proposal_id"], actor="worker", idempotency_key="k1")


def test_valid_amendment_changes_the_answer(conn):
    cid = hero.seed_initial(conn)["case_id"]
    receive_record(conn, C, "AGREEMENT", {
        "agreement_id": "AGR-220-A1", "vendor_id": hero.VENDOR, "amends": "AGR-220", "amendment_no": 1,
        "effective_from": "2026-09-01", "currency": "USD",
        "prices": [{"item_id": hero.ITEM, "unit_price_cents": 12_000}]}, source_system="PROCUREMENT_SYSTEM")
    iss = issues(conn, cid)
    assert iss["PRICE_VARIANCE"]["status"] == "INVALIDATED"
    assert iss["QUANTITY_VARIANCE"]["detail"]["variance_cents"] == 2_400_000
    # The hero price credit is now unsupported: there is no price discrepancy to credit.
    deliver(conn, hero.price_credit())
    assert creditmemo.inspect_credit_memo(conn, cid, "CM-201", "a")["state"] == "REJECTED"


def test_backorder_is_not_cancellation(conn):
    cid = hero.seed_initial(conn)["case_id"]
    receive_record(conn, C, "BACKORDER_NOTICE", {
        "notice_id": "BO-9", "po_id": "PO-481", "vendor_id": hero.VENDOR,
        "lines": [{"item_id": hero.ITEM, "qty": 200}], "expected_on": "2026-10-01"},
        source_system="SUPPLIER_PORTAL", sender=hero.VENDOR)
    q = issues(conn, cid)["QUANTITY_VARIANCE"]
    assert q["detail"]["unaccounted_qty"] == 0 and q["detail"]["backordered_qty"] == 200
    assert q["status"] not in casework.CLOSED


def test_emailed_bank_change_and_untrusted_credit_do_not_count(conn):
    cid = hero.seed_initial(conn)["case_id"]
    vm = receive_record(conn, C, "VENDOR_MASTER", {
        "vendor_id": hero.VENDOR, "name": "Demo Vendor 001", "approved_contact": "ap@evil.example",
        "remit_account_ref": "REMIT-NEW-999"}, source_system="EMAIL", channel="EMAIL", sender="ap@evil.example")
    assert vm["trust"] == "UNVERIFIED" and vm["affected_cases"] == []
    rtype, data, _ = hero.price_credit()
    receive_record(conn, C, rtype, data, source_system="EMAIL", channel="EMAIL", sender="someone@example.com")
    assert creditmemo.inspect_credit_memo(conn, cid, "CM-201", "a")["state"] == "REJECTED"
    full = proposals.calculate_supported_payable(conn, cid)
    assert full["verified_credits_total_cents"] == 0


def test_engine_owned_states_cannot_be_set_by_agents(conn):
    cid = hero.seed_initial(conn)["case_id"]
    q = issues(conn, cid)["QUANTITY_VARIANCE"]
    with pytest.raises(casework.CaseError):
        casework.update_issue(conn, q["issue_id"], actor="agent:investigator", status="SATISFIED")
    with pytest.raises(casework.CaseError):
        casework.set_work_status(conn, cid, "RESOLVED", "trust me", "agent:investigator")
    casework.update_issue(conn, q["issue_id"], actor="agent:investigator", status="AWAITING_EVIDENCE",
                          next_action="procurement to confirm status of 200 units")
    assert issues(conn, cid)["QUANTITY_VARIANCE"]["status"] == "AWAITING_EVIDENCE"


def test_spoofed_memo_cannot_poison_the_real_one(conn):
    cid = hero.seed_initial(conn)["case_id"]
    rtype, data, src = hero.price_credit()
    receive_record(conn, C, rtype, {**data, "amount_cents": 1}, source_system="EMAIL", channel="EMAIL", sender="x@example.com")
    receive_record(conn, C, rtype, data, **src)
    assert creditmemo.inspect_credit_memo(conn, cid, "CM-201", "a")["state"] == "VERIFIED"

def test_stated_total_cannot_pass_deterministic_review(conn):
    from mirror_resolve.ingest import get_record
    cid=hero.seed_initial(conn)['case_id']
    full_resolution(conn,cid)
    invoice=get_record(conn,C,'INV-1042')['data']
    invoice['total_cents']+=1
    receive_record(conn,C,'INVOICE',invoice,source_system='ERP')
    # Reverify against the new record, so the remaining failure is the stated total.
    creditmemo.inspect_credit_memo(conn,cid,'CM-201','agent')
    creditmemo.inspect_credit_memo(conn,cid,'CM-202','agent')
    _,review=prepare(conn,cid)
    assert review['verdict']=='FAIL'
    assert any(c['check']=='invoice_total_ties' and not c['ok'] for c in review['checks'])


def test_cumulative_duplicate_credit_is_rejected(conn):
    cid=hero.seed_initial(conn)['case_id']
    deliver(conn,hero.price_credit())
    assert creditmemo.inspect_credit_memo(conn,cid,'CM-201','agent')['usable']
    typ,data,src=hero.price_credit();data['cm_id']='CM-extra';data['memo_number']='DV-extra'
    deliver(conn,(typ,data,src))
    result=creditmemo.inspect_credit_memo(conn,cid,'CM-extra','agent')
    assert not result['usable']
    assert any(c['check']=='cumulative_credit_within_discrepancy' and not c['ok'] for c in result['checks'])
