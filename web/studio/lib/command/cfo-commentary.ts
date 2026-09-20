export type CommentaryMode = "demo" | "essential" | "muted";
export type Narration = { id: string; eventIds: string[]; text: string; textHash: string; templateVersion: number; priority: number; createdAt: number; expiresAt: number | null; supersessionKey: string };
export type WorkflowEvent = { id: string; sequence: number; kind: string; workflowId: string; entityRevision?: number; state: string; replay?: boolean; narration: Narration };
export type WorkflowPage = { events: WorkflowEvent[]; history?: WorkflowEvent[]; next_after: number; watermark: number; workspaceScope: string; gap: boolean; has_more?: boolean; historical?: boolean };
export type NarrationRecord = { event: WorkflowEvent; status: "history" | "queued" | "playing" | "completed" | "interrupted" | "caption-only" | "superseded" };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function readWorkflowPage(value: unknown): WorkflowPage {
  if (!object(value) || !Array.isArray(value.events) || value.events.length > 100 || !Number.isSafeInteger(value.next_after) || (value.next_after as number) < 0 || typeof value.workspaceScope !== "string") throw new Error("The CFO update stream has an invalid format.");
  for (const event of [...value.events, ...(Array.isArray(value.history) ? value.history : [])]) {
    if (!object(event) || typeof event.id !== "string" || !event.id || !Number.isSafeInteger(event.sequence) || typeof event.workflowId !== "string" || typeof event.kind !== "string" || !object(event.narration)) throw new Error("A CFO update could not be verified.");
    const narration = event.narration;
    if (typeof narration.id !== "string" || typeof narration.text !== "string" || !narration.text.trim() || narration.text.length > 1000 || typeof narration.textHash !== "string" || ![1, 2, 3].includes(narration.priority as number) || typeof narration.supersessionKey !== "string" || !Number.isFinite(narration.createdAt)) throw new Error("A CFO caption could not be verified.");
  }
  return value as WorkflowPage;
}
export function eligible(event: WorkflowEvent, mode: CommentaryMode, now: number): boolean {
  const narration = event.narration;
  return mode !== "muted" && (mode !== "essential" || narration.priority >= 2)
    && (event.replay || narration.expiresAt === null || narration.expiresAt === undefined || narration.expiresAt > now);
}
/** Autoplay and config waits retain the utterance until output can actually start. */
export function takeNarration(queue: WorkflowEvent[], decisions: WorkflowEvent[], state: { audioEnabled: boolean | null; playbackEnabled: boolean; decisionActive: boolean }) {
  if (state.audioEnabled === null) return null;
  // An outstanding decision prioritizes its cues, but must not mute unrelated live work.
  const urgent = queue.findIndex(event => event.narration.priority >= 3 || event.kind === "cfo.greeting");
  const index = urgent >= 0 ? urgent : 0;
  const event = decisions[0] ?? queue[index];
  if (!event) return null;
  const delivery = !state.audioEnabled ? "caption-only" : !state.playbackEnabled ? "needs-audio" : "play";
  if (delivery === "needs-audio") return { event, delivery, queue, decisions };
  return { event, delivery, queue: decisions.length ? queue : queue.filter((_, position) => position !== index), decisions: decisions.length ? decisions.slice(1) : decisions };
}
/** Supersession and speech-time bounds are deterministic, independent of network speed. */
export function queueNarrations(current: readonly WorkflowEvent[], incoming: readonly WorkflowEvent[], mode: CommentaryMode, now: number): WorkflowEvent[] {
  const byKey = new Map<string, WorkflowEvent>();
  for (const event of [...current, ...incoming]) {
    if (!eligible(event, mode, now)) continue;
    const key = event.narration.supersessionKey || event.id, previous = byKey.get(key);
    if (!previous || event.sequence >= previous.sequence) byKey.set(key, event);
  }
  const events = [...byKey.values()].sort((a, b) => b.narration.priority - a.narration.priority || a.sequence - b.sequence);
  let duration = 0;
  return events.filter(event => {
    const estimate = Math.max(2, event.narration.text.trim().split(/\s+/).length / 2.7);
    if (duration + estimate > 20) return false;
    duration += estimate; return true;
  }).slice(0, 4);
}
export function mergeNarrationHistory(current: readonly NarrationRecord[], events: readonly WorkflowEvent[], status: NarrationRecord["status"]): NarrationRecord[] {
  const map = new Map(current.map(item => [item.event.id, item]));
  for (const event of events) if (!map.has(event.id)) map.set(event.id, { event, status });
  return [...map.values()].sort((a, b) => a.event.sequence - b.event.sequence).slice(-120);
}
