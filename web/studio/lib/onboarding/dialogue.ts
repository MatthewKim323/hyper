export type DialogueRole = "user" | "assistant";

export interface DialogueEntry {
  id: string;
  role: DialogueRole;
  text: string;
  final: boolean;
  sequence: number | null;
  placeholder?: boolean;
}

export interface DialogueState {
  entries: DialogueEntry[];
  generation: number;
  sessionId: string | null;
}

const LIMIT = 60;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const generation = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** The optional introduction is existing onboarding copy, replaced by the first real transcript. */
export function createDialogue(introduction?: string): DialogueState {
  return {
    entries: introduction ? [{ id: "onboarding-welcome", role: "assistant", text: introduction, final: true, sequence: null, placeholder: true }] : [],
    generation: 0,
    sessionId: null,
  };
}

function upsert(entries: DialogueEntry[], event: Record<string, unknown>, history = false): DialogueEntry[] {
  if (typeof event.id !== "string" || !event.id || event.id.length > 256
    || (event.role !== "assistant" && event.role !== "user")
    || typeof event.text !== "string" || !event.text.trim()) return entries;
  const text = event.text.trim().slice(0, 16000);
  const final = event.final !== false;
  const sequence = Number.isSafeInteger(event.sequence) && (event.sequence as number) > 0 ? event.sequence as number : null;
  const index = entries.findIndex(entry => entry.id === event.id && !entry.placeholder);
  const previous = entries[index];
  if (previous) {
    // A replay cannot turn a committed caption back into a partial or rewrite its speaker.
    if (previous.role !== event.role || previous.final) return entries;
    if (previous.text === text && previous.final === final && (sequence === null || sequence === previous.sequence)) return entries;
    const next = entries.slice();
    next[index] = { ...previous, text, final, sequence: sequence ?? previous.sequence };
    return next;
  }
  if (!history && sequence !== null && entries.some(entry => entry.sequence !== null && entry.sequence >= sequence)) return entries;
  const next = entries.filter(entry => !entry.placeholder);
  next.push({ id: event.id, role: event.role, text, final, sequence });
  if (history) next.sort((a, b) => a.sequence !== null && b.sequence !== null ? a.sequence - b.sequence : 0);
  return next.slice(-LIMIT);
}

/** Uses server IDs for live speech, accepted typed messages, and reconnect history. */
export function reduceDialogueEvent(previous: DialogueState, event: Record<string, unknown>): DialogueState {
  if (event.type === "reply") return previous;
  if (event.type === "session" || event.type === "transcript.history") {
    const session = event.type === "session" && record(event.session) ? event.session : null;
    const messages = session?.transcript ?? event.messages;
    if (!Array.isArray(messages)) return previous;
    const id = typeof session?.id === "string" ? session.id : previous.sessionId;
    let entries = previous.sessionId && id !== previous.sessionId ? [] : previous.entries;
    for (const message of messages) if (record(message)) entries = upsert(entries, { ...message, final: true }, true);
    return { entries, sessionId: id, generation: event.type === "session" ? 0 : previous.generation };
  }
  if (event.generation !== undefined && !generation(event.generation)) return previous;
  if (generation(event.generation) && event.generation < previous.generation) return previous;
  const nextGeneration = generation(event.generation) ? event.generation : previous.generation;
  const entries = event.type === "transcript" ? upsert(previous.entries, event) : previous.entries;
  if (entries === previous.entries && nextGeneration === previous.generation) return previous;
  return { ...previous, entries, generation: nextGeneration };
}

/** Several provider sentence segments from one speaker read as one caption turn. */
export function dialogueTurns(entries: DialogueEntry[]): DialogueEntry[] {
  const turns: DialogueEntry[] = [];
  for (const entry of entries) {
    const latest = turns.at(-1);
    if (latest && latest.role === entry.role && !entry.placeholder && !latest.placeholder) {
      turns[turns.length - 1] = { ...latest, text: `${latest.text} ${entry.text}`, final: entry.final, sequence: entry.sequence };
    } else turns.push({ ...entry });
  }
  return turns;
}
