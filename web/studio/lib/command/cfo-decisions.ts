import type { Concern } from "../backend/types";

export type DecisionResult = { summary?: string; agent_notes?: string; agent_notes_verified?: boolean };
export type DecisionJob = { id?: string; status: string; error?: string | null; result?: DecisionResult | null; waiting_reason?: string; progress?: string };
export type DecisionConcern = Concern & {
  resolution: (NonNullable<Concern["resolution"]> & DecisionResult) | null;
  decision_cues?: { event_id: string; text: string; textHash: string }[];
  card_revision: number; card_hash: string; decision_revision: number; latest_job_id?: string | null;
};
export type DecisionChoice = { optionId: "option_1" | "option_2" | "option_3" } | { optionId: "custom"; instruction: string };
export type DecisionContext = { concernId: string; cardRevision: number; cardHash: string; expectedDecisionRevision: number; contextGeneration: number };
export type DecisionCommand = {
  commandId: string; concernId: string; expectedDecisionRevision: number; cardRevision: number; cardHash: string;
  input: "click" | "text" | "voice"; choice: DecisionChoice; userTurnId?: string;
};
export function decisionContext(concern: DecisionConcern, contextGeneration: number): DecisionContext | null {
  const failedFirstReview = concern.status === "card_failed" && concern.card_revision === 0 && (concern.card_hash == null || concern.card_hash === "");
  const reviewedRevision = concern.card_revision > 0 && typeof concern.card_hash === "string" && !!concern.card_hash;
  return Number.isSafeInteger(concern.card_revision) && (failedFirstReview || reviewedRevision) && Number.isSafeInteger(concern.decision_revision) && concern.decision_revision >= 0
    ? { concernId: concern.id, cardRevision: concern.card_revision, cardHash: concern.card_hash ?? "", expectedDecisionRevision: concern.decision_revision, contextGeneration } : null;
}
export function decisionCommand(context: DecisionContext, choice: DecisionChoice, input: DecisionCommand["input"], commandId: string): DecisionCommand {
  return { commandId, concernId: context.concernId, expectedDecisionRevision: context.expectedDecisionRevision, cardRevision: context.cardRevision, cardHash: context.cardHash, choice, input };
}
/** Only an explicit selection is interpreted here. Questions and custom instructions stay conversational. */
export function parseDecisionChoice(text: string): DecisionChoice | null {
  const value = text.trim().toLowerCase().replace(/[.!]+$/, "").trim();
  const match = value.match(/^(?:please\s+)?(?:(?:go with|choose|select|do|use|take|pick|run|proceed with)\s+)?(?:option\s+)?(one|two|three|1|2|3)(?:\s+please)?$/);
  if (!match) return null;
  const option = ({ one: 1, two: 2, three: 3 } as Record<string, number>)[match[1]] ?? Number(match[1]);
  return { optionId: `option_${option}` as "option_1" | "option_2" | "option_3" };
}
export function hasReviewedOptions(concern: DecisionConcern): boolean {
  return concern.status !== "card_failed" && !!decisionContext(concern, 0) && concern.card?.options?.length === 3
    && [...concern.card.options].sort((a, b) => a.id.localeCompare(b.id)).every((option, index) => option.id === `option_${index + 1}` && !!option.title && !!option.action);
}

/** A job and its concern carry the same outcome. Present it once, from the current job only. */
export function decisionProgress(concern: DecisionConcern, job: DecisionJob | null): { text: string; notes: string; notesVerified: boolean } {
  const currentJob = job && job.id === concern.latest_job_id ? job : null;
  const status = concern.status === "resolved" ? "completed" : currentJob?.status ?? concern.status;
  const final = ["completed", "needs_input", "failed"].includes(status);
  const result = final ? concern.resolution ?? currentJob?.result : null;
  const fallback: Record<string, string> = {
    queued: "Your choice is recorded. The investigation is queued.",
    running: "The investigation is in progress.",
    resolving: "The investigation is in progress.",
    completed: "The investigation is complete.",
    needs_input: "The investigation needs your input before it can proceed.",
    failed: "The investigation did not complete.",
  };
  return {
    text: result?.summary || currentJob?.waiting_reason || currentJob?.progress || fallback[status] || "",
    notes: result?.agent_notes?.trim() || "",
    notesVerified: result?.agent_notes_verified === true,
  };
}
