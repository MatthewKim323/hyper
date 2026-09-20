import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createDialogue, dialogueTurns, reduceDialogueEvent } from "./dialogue";

test("accepted typed and spoken turns retain real IDs and speaker colors can follow their roles", () => {
  let state = createDialogue("Existing introduction");
  state = reduceDialogueEvent(state, { type: "session", session: { id: "session-1", transcript: [] } });
  assert.equal(state.entries[0].text, "Existing introduction");
  state = reduceDialogueEvent(state, { type: "transcript", id: "typed-1", role: "user", text: "Review my invoices", sequence: 1, generation: 1 });
  state = reduceDialogueEvent(state, { type: "transcript", id: "spoken-1", role: "assistant", text: "I'll inspect the evidence.", sequence: 2, generation: 1 });
  assert.deepEqual(state.entries.map(({ id, role }) => ({ id, role })), [{ id: "typed-1", role: "user" }, { id: "spoken-1", role: "assistant" }]);
  const replay = reduceDialogueEvent(state, { type: "reply", id: "spoken-1", role: "assistant", text: "I'll inspect the evidence." });
  assert.equal(replay, state);
});

test("partial updates replace their existing row until final, without duplicate user acknowledgements", () => {
  let state = createDialogue();
  state = reduceDialogueEvent(state, { type: "transcript", id: "speech-1", role: "user", text: "Look", final: false, sequence: 1 });
  state = reduceDialogueEvent(state, { type: "transcript", id: "speech-1", role: "user", text: "Look at payables", final: false, sequence: 1 });
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].text, "Look at payables");
  assert.equal(state.entries[0].final, false);
  state = reduceDialogueEvent(state, { type: "transcript", id: "speech-1", role: "user", text: "Look at payables.", final: true, sequence: 1 });
  const final = state;
  for (const event of [
    { id: "speech-1", role: "user", text: "Look", final: false },
    { id: "speech-1", role: "user", text: "Look at payables.", final: true },
    { id: "speech-1", role: "assistant", text: "Wrong speaker", final: true },
  ]) state = reduceDialogueEvent(state, { type: "transcript", ...event });
  assert.equal(state, final);
  assert.equal(state.entries.length, 1);
});

test("saved history restores captions without replaying rows and resets a reconnect's generation", () => {
  let state = createDialogue();
  state = reduceDialogueEvent(state, { type: "session", session: { id: "first", transcript: [{ id: "a", role: "assistant", text: "I'm your CFO.", sequence: 1 }] } });
  state = reduceDialogueEvent(state, { type: "transcript", id: "b", role: "user", text: "Show current work", sequence: 2, generation: 4 });
  state = reduceDialogueEvent(state, { type: "session", session: { id: "first", transcript: [{ id: "a", role: "assistant", text: "I'm your CFO.", sequence: 1 }, { id: "b", role: "user", text: "Show current work", sequence: 2 }] } });
  assert.equal(state.generation, 0);
  assert.deepEqual(state.entries.map(entry => entry.id), ["a", "b"]);
  state = reduceDialogueEvent(state, { type: "session", session: { id: "different", transcript: [] } });
  assert.deepEqual(state.entries, []);
});

test("stale generation packets, invalid roles, empty content and out-of-order live entries are ignored", () => {
  let state = reduceDialogueEvent(createDialogue(), { type: "interrupt", generation: 3 });
  state = reduceDialogueEvent(state, { type: "transcript", id: "current", role: "assistant", text: "Current answer", generation: 3, sequence: 10 });
  const current = state;
  for (const event of [
    { id: "old", role: "assistant", text: "Old answer", generation: 2 },
    { id: "wrong", role: "system", text: "Hidden message" },
    { id: "empty", role: "assistant", text: " " },
    { id: "invalid-generation", role: "assistant", text: "Bad packet", generation: -1 },
    { id: "late", role: "assistant", text: "Earlier response", sequence: 8 },
  ]) state = reduceDialogueEvent(state, { type: "transcript", ...event });
  assert.equal(state, current);
});

test("adjacent provider sentence segments share a caption turn but preserve the underlying transcript", () => {
  let state = createDialogue();
  for (const [index, role, text] of [[1, "assistant", "I'm your CFO."], [2, "assistant", "How can I help?"], [3, "user", "Show me the agents."], [4, "assistant", "Here is their current progress."]] as const) {
    state = reduceDialogueEvent(state, { type: "transcript", id: `segment-${index}`, role, text, sequence: index });
  }
  const turns = dialogueTurns(state.entries);
  assert.equal(state.entries.length, 4);
  assert.equal(turns.length, 3);
  assert.equal(turns[0].id, "segment-1");
  assert.equal(turns[0].text, "I'm your CFO. How can I help?");
  assert.equal(turns[1].role, "user");
});

test("long sessions keep a bounded recent caption window and reconnect history can fill older rows", () => {
  let state = createDialogue();
  for (let i = 1; i <= 80; i++) state = reduceDialogueEvent(state, { type: "transcript", id: `id-${i}`, role: i % 2 ? "assistant" : "user", text: `Turn ${i}`, sequence: i });
  assert.equal(state.entries.length, 60);
  assert.equal(state.entries[0].id, "id-21");
  state = reduceDialogueEvent(state, { type: "transcript.history", messages: [{ id: "id-1", role: "assistant", text: "Turn 1", sequence: 1 }] });
  assert.equal(state.entries.length, 60);
  assert.equal(state.entries[0].id, "id-21");
});
