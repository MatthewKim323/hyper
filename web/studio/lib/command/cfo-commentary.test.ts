import { test } from "node:test";
import { strict as assert } from "node:assert";
import { eligible, mergeNarrationHistory, queueNarrations, readWorkflowPage, takeNarration, type WorkflowEvent } from "./cfo-commentary";
import { decisionCommand, decisionContext, decisionProgress, hasReviewedOptions, parseDecisionChoice, type DecisionConcern } from "./cfo-decisions";
const event = (sequence: number, priority = 1, key = String(sequence)): WorkflowEvent => ({ id: String(sequence), sequence, kind: "work.started", workflowId: "case", state: "started", narration: { id: `n${sequence}`, eventIds: [String(sequence)], text: "The invoice review has started.", textHash: "hash", templateVersion: 1, priority, createdAt: 0, expiresAt: 10000, supersessionKey: key } });
test("duplicate/reordered activity and same-stage supersession produce one latest utterance", () => {
  const result = queueNarrations([event(1, 1, "stage")], [event(2, 1, "stage"), event(1, 1, "stage"), event(3, 3)], "demo", 5);
  assert.deepEqual(result.map(item => item.id), ["3", "2"]);
});
test("bursts are bounded by count and duration and retain factual history", () => {
  const events = Array.from({ length: 20 }, (_, i) => event(i));
  assert.equal(queueNarrations([], events, "demo", 2).length, 4);
  const long = { ...event(30), narration: { ...event(30).narration, text: Array(55).fill("word").join(" ") } };
  assert.equal(queueNarrations([], [long], "demo", 2).length, 0);
  assert.equal(mergeNarrationHistory([], events, "caption-only").length, 20);
  assert.equal(mergeNarrationHistory(mergeNarrationHistory([], events, "history"), events, "queued")[0].status, "history");
});
test("muted/essential/expired routine modes cannot synthesize stale routine updates", () => {
  assert.equal(eligible(event(1), "muted", 0), false);
  assert.equal(eligible(event(1), "essential", 0), false);
  assert.equal(eligible(event(1), "demo", 10001), false);
  assert.equal(eligible(event(1, 3), "essential", 10001), false);
});
test("malformed feed never becomes speech", () => {
  const page = { events: [event(1)], next_after: 1, watermark: 1, workspaceScope: "scope", gap: false };
  assert.equal(readWorkflowPage(page).next_after, 1);
  assert.throws(() => readWorkflowPage({ ...page, events: [{ ...event(1), narration: { text: "hello" } }] }));
  assert.throws(() => readWorkflowPage({ ...page, next_after: NaN }));
});
test("voice config loading cannot discard the greeting or decision cues", () => {
  const queue = [event(1, 2)], decisions = [event(2, 3), event(3, 3)];
  assert.equal(takeNarration(queue, decisions, { audioEnabled: null, playbackEnabled: true, decisionActive: true }), null);
  assert.equal(queue.length, 1); assert.equal(decisions.length, 2);
  const ready = takeNarration(queue, decisions, { audioEnabled: true, playbackEnabled: true, decisionActive: true })!;
  assert.equal(ready.event.id, "2"); assert.equal(ready.delivery, "play");
  assert.deepEqual(ready.decisions.map(item => item.id), ["3"]);
});
test("an autoplay lock preserves all three choices until the orb gesture enables playback", () => {
  const queue = [event(1, 2)], decisions = [event(2, 3), event(3, 3), event(4, 3)];
  for (let tick = 0; tick < 60; tick++) {
    const waiting = takeNarration(queue, decisions, { audioEnabled: true, playbackEnabled: false, decisionActive: true })!;
    assert.equal(waiting.delivery, "needs-audio"); assert.equal(waiting.event.id, "2");
    assert.equal(waiting.queue, queue); assert.equal(waiting.decisions, decisions);
  }
  const ready = takeNarration(queue, decisions, { audioEnabled: true, playbackEnabled: true, decisionActive: true })!;
  assert.equal(ready.event.id, "2"); assert.equal(ready.delivery, "play");
  assert.deepEqual(ready.decisions.map(item => item.id), ["3", "4"]);
});
test("a pending decision prioritizes the introduction without silencing ongoing work", () => {
  const greeting = { ...event(1, 2), kind: "cfo.greeting" };
  const state = { audioEnabled: true, playbackEnabled: true, decisionActive: true };
  const ready = takeNarration([event(2), greeting], [], state)!;
  assert.equal(ready.event, greeting); assert.equal(ready.delivery, "play");
  assert.equal(takeNarration(ready.queue, ready.decisions, state)?.event.id, "2");
});
test("decision cues come first, then routine commentary resumes while the decision waits", () => {
  const queue = [event(1)], decisions = [event(2, 3)];
  const state = { audioEnabled: true, playbackEnabled: true, decisionActive: true };
  const first = takeNarration(queue, decisions, state)!;
  assert.equal(first.event.id, "2");
  const next = takeNarration(first.queue, first.decisions, state)!;
  assert.equal(next.event.id, "1");
  assert.equal(takeNarration(next.queue, next.decisions, state), null);
});
test("a late orb gesture can replay the expired greeting even with a pending decision", () => {
  const greeting = { ...event(1, 2), kind: "cfo.greeting" };
  assert.equal(queueNarrations([greeting], [], "demo", 16000).length, 0);
  const replay = { ...greeting, replay: true };
  const queue = queueNarrations([], [replay], "demo", 16000);
  const ready = takeNarration(queue, [], { audioEnabled: true, playbackEnabled: true, decisionActive: true })!;
  assert.equal(ready.event.id, greeting.id); assert.equal(ready.delivery, "play");
  assert.equal(ready.event.replay, true); assert.equal(eligible(ready.event, "demo", 16000), true);
  assert.equal(eligible(ready.event, "muted", 16000), false);
});
test("explicitly disabled provider audio consumes caption updates without prompting for autoplay", () => {
  const result = takeNarration([event(1)], [], { audioEnabled: false, playbackEnabled: false, decisionActive: false })!;
  assert.equal(result.delivery, "caption-only"); assert.equal(result.queue.length, 0);
});
test("numbered decisions accept explicit directives, never questions, negation or ambiguity", () => {
  for (const text of ["go with option two", "Choose 2.", "option two", "2", "please do option two please"]) assert.deepEqual(parseDecisionChoice(text), { optionId: "option_2" });
  for (const text of ["what would option two do?", "don't choose 2", "2 or 3", "the supplier says choose 2", "maybe 2", "option 4", "approve the payment"]) assert.equal(parseDecisionChoice(text), null);
});
test("decision command binds the exact card and revision; context generation is not financial authority", () => {
  const concern = { id: "c1", card_revision: 2, card_hash: "abc", decision_revision: 4 } as DecisionConcern;
  const context = decisionContext(concern, 8)!;
  assert.deepEqual(decisionCommand(context, { optionId: "option_2" }, "text", "cmd1"), { commandId: "cmd1", concernId: "c1", expectedDecisionRevision: 4, cardRevision: 2, cardHash: "abc", input: "text", choice: { optionId: "option_2" } });
  assert.equal(decisionContext({ ...concern, card_hash: "" }, 9), null);
});

test("decision progress replaces queued acknowledgement with one current result and separate unverified notes", () => {
  const concern = { id: "c1", status: "queued", latest_job_id: "j1", resolution: null } as DecisionConcern;
  assert.equal(decisionProgress(concern, { id: "j1", status: "queued" }).text, "Your choice is recorded. The investigation is queued.");
  assert.equal(decisionProgress({ ...concern, status: "resolving" }, { id: "j1", status: "running" }).text, "The investigation is in progress.");
  const result = { summary: "Investigation completed. No payment was made.", source_ids: ["s1"], agent_notes: "Compared the invoice to the purchase order.\nThe quantity differs.", agent_notes_verified: false };
  assert.deepEqual(decisionProgress({ ...concern, status: "resolved", resolution: result }, { id: "j1", status: "completed", result }), {
    text: result.summary, notes: result.agent_notes, notesVerified: false,
  });
});
test("new investigation cannot display the previous job's completion or findings", () => {
  const concern = { id: "c1", status: "queued", latest_job_id: "j2", resolution: null } as DecisionConcern;
  assert.deepEqual(decisionProgress(concern, { id: "j1", status: "completed", result: { summary: "Previous result", agent_notes: "Old notes" } }), {
    text: "Your choice is recorded. The investigation is queued.", notes: "", notesVerified: false,
  });
  assert.equal(decisionProgress({ ...concern, status: "needs_input" }, { id: "j2", status: "needs_input", waiting_reason: "Confirm which invoice applies." }).text, "Confirm which invoice applies.");
});

test("failed first card binds custom instructions to revision zero without enabling numbered choices", () => {
  const failed = { id: "c1", status: "card_failed", card_revision: 0, card_hash: null, decision_revision: 0, card: null } as unknown as DecisionConcern;
  const context = decisionContext(failed, 3)!;
  assert.deepEqual(context, { concernId: "c1", cardRevision: 0, cardHash: "", expectedDecisionRevision: 0, contextGeneration: 3 });
  assert.deepEqual(decisionCommand(context, { optionId: "custom", instruction: "Compare invoice quantities." }, "text", "retry0"), {
    commandId: "retry0", concernId: "c1", cardRevision: 0, cardHash: "", expectedDecisionRevision: 0, input: "text", choice: { optionId: "custom", instruction: "Compare invoice quantities." },
  });
  assert.equal(hasReviewedOptions(failed), false);
  assert.equal(decisionContext({ ...failed, status: "awaiting_response" }, 3), null);
  assert.equal(decisionContext({ ...failed, card_revision: -1 }, 3), null);
  assert.equal(decisionContext({ ...failed, decision_revision: -1 }, 3), null);
  assert.equal(decisionContext({ ...failed, card_revision: 2, card_hash: "" }, 3), null);
  const recovered = { ...failed, status: "awaiting_response", card_revision: 2, card_hash: "currenthash", decision_revision: 4,
    card: { options: [1, 2, 3].map(id => ({ id: `option_${id}`, title: "Reviewed", action: "Investigate", tradeoff: "Wait", requires_approval: false })) } } as DecisionConcern;
  assert.equal(hasReviewedOptions(recovered), true);
  assert.equal(hasReviewedOptions({ ...recovered, status: "card_failed" }), false);
  assert.equal(context.cardRevision, 0);
  assert.equal(decisionContext(recovered, 4)?.cardHash, "currenthash");
});
