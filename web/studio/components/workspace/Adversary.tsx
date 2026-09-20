"use client";

// The sandbox adversary and the unattended worker playing against it. Everything shown is read
// from the backend: graded outcomes, observable tool actions, lessons the worker wrote itself.
import { useState } from "react";
import { BackendError, backend } from "@/lib/backend/client";
import type { ExceptionFamily, Scenario } from "@/lib/backend/types";
import { useBackend, when } from "./useBackend";

const FAMILY_LABEL: Record<ExceptionFamily, string> = {
  clean: "Clean match", price_only: "Overpriced", partial_correction: "Overpriced and over quantity", valid_amendment: "Price backed by an amendment",
  backorder: "Units on backorder", disputed_cancellation: "Supplier disputes a cancellation", claim_without_memo: "Credit claimed, no memo",
  silent_supplier: "Supplier never answers", duplicate_credit: "Credit memo sent twice", bank_change_attack: "Bank change and hidden instruction",
  internal_hold: "Checks pass, procurement says hold", withdrawn_credit: "Supplier withdraws its credit", short_credit: "Credit covers only part",
  cleared_hold: "Hold already lifted", misdirected_hold: "Hold notice for another order", superseded_invoice: "Supplier voids its invoice",
  already_paid: "Already paid by wire", goods_returned: "Goods going back", spoofed_release: "Supplier claims our hold is lifted",
  internal_release: "Desk lifts its own hold", unrelated_wire: "Wire for another invoice",
};
const OUTCOME: Record<string, { label: string; color: string }> = {
  pass: { label: "Resolved correctly", color: "var(--status-good)" }, correct_hold: { label: "Correctly held", color: "var(--chart-1)" },
  fail: { label: "Wrong release", color: "var(--status-critical)" }, timeout: { label: "Ran out of time", color: "var(--status-neutral)" },
};
const verb = (tool: string) => ({
  open_payable_case: "Opened the case", analyze_payable: "Recomputed the position", inspect_payable_credit: "Checked a credit memo", prepare_payable_proposal: "Prepared a proposal for approval",
  request_supplier_document: "Asked the supplier", request_internal_confirmation: "Asked procurement", get_counterparty_thread: "Read the thread", list_accounting_records: "Looked up records",
}[tool] ?? tool.replaceAll("_", " "));

function Live({ scenario }: { scenario: Scenario }) {
  const steps = scenario.agent.trace.filter((s) => s.tool !== "get_counterparty_thread" && s.tool !== "list_accounting_records").slice(-4);
  const said = [...scenario.agent.trace].reverse().find((s) => s.say)?.say;
  return <li data-point-id={scenario.id} data-point-kind="exception" data-point-label={scenario.title}>
    <div><strong>{scenario.title}</strong><small>{scenario.agent.status ? scenario.agent.status.toLowerCase() : "not picked up yet"} · {scenario.requests} request{scenario.requests === 1 ? "" : "s"}</small></div>
    {steps.length > 0 && <ol className="ws-steps">{steps.map((s, i) => <li key={i}>{s.tool ? verb(s.tool) : "Reported"}</li>)}</ol>}
    {said && <p className="ws-said">{said.replace(/\*\*/g, "").replace(/^[^A-Za-z$]*/, "").slice(0, 260)}</p>}
  </li>;
}

export default function Adversary({ active }: { active: boolean }) {
  const state = useBackend(backend.adversary, active, 4000);
  const scenarios = useBackend(backend.scenarios, active, 3000);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [family, setFamily] = useState<ExceptionFamily>("partial_correction");
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setNote("");
    try { await work(); state.refresh(); scenarios.refresh(); }
    catch (reason) { setNote(reason instanceof BackendError && reason.status === 403 ? "The sandbox is switched off on the server." : (reason as Error).message); }
    finally { setBusy(false); }
  };
  if (state.error) return <p className="ws-warning" role="status">{state.error}</p>;
  if (!state.data) return null;
  const { control, scoreboard, lessons } = state.data;
  const open = (scenarios.data?.scenarios ?? []).filter((s) => s.status === "open");
  const graded = (scenarios.data?.scenarios ?? []).filter((s) => s.status === "scored").slice(0, 8);
  const rate = scoreboard.scored ? Math.round((scoreboard.correct / scoreboard.scored) * 100) : null;

  return <section className="ws-section ws-adversary">
    <div className="ws-adversary__head">
      <div><span className="ws-eyebrow">Sandbox adversary · simulated counterparties</span>
        <h3>{control.enabled ? "Sending the agent new exceptions" : "The adversary is resting"}</h3>
        <p className="ws-note">Simulated suppliers and a procurement desk answer from private facts: half answers, disputes, silence, a fake bank change. The agent works them with no one assigning anything. Outcomes are graded on the accounting engine&apos;s state, not on what the agent says.</p></div>
      <button type="button" className="ws-switch" aria-pressed={control.enabled} disabled={busy} onClick={() => void run(() => backend.setAdversary(!control.enabled, 25, 4))}>{control.enabled ? "Pause" : "Start"}</button>
    </div>
    <dl className="ws-score">
      <div><dt>Handled correctly</dt><dd>{rate === null ? "No graded cases" : `${scoreboard.correct} of ${scoreboard.scored}`}</dd></div>
      <div><dt>Wrong releases</dt><dd data-bad={scoreboard.wrong_releases > 0 || undefined}>{scoreboard.wrong_releases}</dd></div>
      <div><dt>Repeated requests</dt><dd>{scoreboard.repeated_requests}</dd></div>
      <div><dt>Difficulty level</dt><dd>{scoreboard.level} of 4</dd></div>
      <div><dt>Lessons it wrote</dt><dd>{scoreboard.lessons_learned}</dd></div>
    </dl>
    <div className="ws-inline ws-inline--spawn">
      <select value={family} onChange={(e) => setFamily(e.target.value as ExceptionFamily)} aria-label="Exception to send">
        {Object.entries(FAMILY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <button type="button" disabled={busy} onClick={() => void run(() => backend.spawnScenario(family))}>Send this one now</button>
    </div>
    {note && <p className="ws-warning">{note}</p>}
    {open.length > 0 && <><span className="ws-eyebrow">In flight</span><ul className="ws-rows ws-rows--live">{open.map((s) => <Live key={s.id} scenario={s} />)}</ul></>}
    {graded.length > 0 && <><span className="ws-eyebrow">Graded</span><ul className="ws-rows ws-rows--tight">{graded.map((s) => <li key={s.id}>
      <div><strong>{s.family ? FAMILY_LABEL[s.family] : s.title}</strong><small><i className="ws-dot" style={{ background: OUTCOME[s.outcome ?? "timeout"].color }} />{OUTCOME[s.outcome ?? "timeout"].label} · {s.agent.sessions} session{s.agent.sessions === 1 ? "" : "s"} · {when(s.scored_at)}</small></div>
    </li>)}</ul></>}
    {lessons.length > 0 && <details className="ws-lessons"><summary>What it taught itself ({lessons.length})</summary><ul>{lessons.map((l) => <li key={l.created_at}>{l.lesson}</li>)}</ul>
      <p className="ws-note">Lessons are advice the worker reads before a case. They cannot change a check, an amount or who must approve.</p></details>}
  </section>;
}
