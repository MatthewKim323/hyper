"use client";

// Development only: the CFO decision card on its own, with a fixed concern, so its look can be checked
// without signing in or waiting for the worker to raise one.
import { notFound } from "next/navigation";
import { useState } from "react";
import CfoDecisionCard from "@/components/command/CfoDecisionCard";
import type { DecisionConcern } from "@/lib/command/cfo-decisions";

const CONCERN = {
  id: "concern_dev", status: "awaiting_response", card_revision: 1, card_hash: "dev", decision_revision: 0, decision: null, resolution: null,
  request: { title: "INV-0008: supplier disputes cancellation of 25 units, 120,000 cents unsupported", severity: "high", source_ids: [] },
  card: { summary: "", options: [
    { id: "option_1", title: "Verify invoice arithmetic", action: "Recompute line totals, applied credits and the stated residual from the records.", tradeoff: "Confirms the number, does not move the dispute.", requires_approval: false },
    { id: "option_2", title: "Check cancellation against the vendor's acknowledgment", action: "Compare the approved change order with the disputed acknowledgment and the goods receipt.", tradeoff: "Slower, but it is the actual disagreement.", requires_approval: false },
    { id: "option_3", title: "Inspect the credit memo's scope", action: "Confirm the memo is price only and check for any quantity credit.", tradeoff: "Narrow.", requires_approval: true },
  ] },
} as unknown as DecisionConcern;

export default function DecisionCardPreview() {
  const [chosen, setChosen] = useState<string | null>(null);
  if (process.env.NODE_ENV !== "development") notFound();
  const concern = chosen ? { ...CONCERN, status: "needs_input", decision: { option_id: chosen } } as unknown as DecisionConcern : CONCERN;
  return <div data-decision-dev style={{ position: "fixed", inset: 0, zIndex: 2147483600, background: "linear-gradient(160deg, #d9cbe0, #eadbd6 55%, #cfd6e6)" }}>
    <style>{`body:has([data-decision-dev]) :is(.js-loader, .naked-loader, .header, .footer, .menu, #gl, #p-cover, .finger-dock) { display: none !important; } body:has([data-decision-dev]), body:has([data-decision-dev]) * { cursor: auto; }`}</style>
    <p style={{ position: "absolute", left: "50%", bottom: 100, translate: "-50% 0", margin: 0, width: "min(760px, 90vw)", textAlign: "center", fontSize: 20, lineHeight: 1.4, color: "#292524" }}>A proposal for INV-0272 is ready for approval. No payment has been sent.</p>
    <div className="cmd" data-agent-open="true">
      <CfoDecisionCard concern={concern} job={chosen ? { status: "running", progress: "Reading INV-0008 and CO-0008" } : null} busy={false} onChoose={setChosen} onDismiss={() => setChosen(null)} />
      <div style={{ position: "absolute", left: "50%", bottom: 24, translate: "-50% 0", width: "min(480px, calc(100vw - 40px))", height: 56, borderRadius: 28, background: "rgb(255 255 255 / 45%)", border: "1px solid rgb(255 255 255 / 64%)" }} />
    </div>
  </div>;
}
