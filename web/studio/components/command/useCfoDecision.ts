"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { cfoJson, CfoApiError } from "@/lib/command/cfo-api";
import { decisionCommand, decisionContext, hasReviewedOptions, type DecisionChoice, type DecisionConcern, type DecisionContext, type DecisionJob } from "@/lib/command/cfo-decisions";

type State = { concern: DecisionConcern | null; busy: boolean; error: string; message: string; job: DecisionJob | null };
export function useCfoDecision(enabled: boolean, microphoneActive: boolean) {
  const [state, setState] = useState<State>({ concern: null, busy: false, error: "", message: "", job: null });
  const current = useRef(state); current.current = state;
  const mic = useRef(microphoneActive); mic.current = microphoneActive;
  const context = useRef<DecisionContext | null>(null), contextGeneration = useRef(0);
  const revision = useRef(0), pending = useRef(false), skipped = useRef(new Set<string>());
  const retry = useRef<{ signature: string; command: ReturnType<typeof decisionCommand> } | null>(null);
  const runtimeAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController(); runtimeAbort.current = abort;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const pollRevision = revision.current;
      try {
        if (!document.hidden) {
          const page = await cfoJson<{ concerns: DecisionConcern[] }>("/concerns?limit=50", { signal: abort.signal });
          if (abort.signal.aborted || pollRevision !== revision.current) return;
          const previous = current.current.concern;
          const selected = previous ? page.concerns.find(item => item.id === previous.id) ?? null
            : page.concerns.find(item => ["awaiting_response", "needs_input", "card_failed"].includes(item.status) && !skipped.current.has(`${item.id}:${item.card_revision}`)) ?? null;
          // Do not silently retarget a numbered voice response during its microphone turn.
          if (!mic.current && !pending.current) {
            const nextContext = selected && ["awaiting_response", "needs_input", "card_failed"].includes(selected.status) ? decisionContext(selected, contextGeneration.current) : null;
            const signature = (value: DecisionContext | null) => JSON.stringify(value && [value.concernId, value.cardRevision, value.cardHash, value.expectedDecisionRevision]);
            if (signature(nextContext) !== signature(context.current)) { contextGeneration.current++; context.current = nextContext ? { ...nextContext, contextGeneration: contextGeneration.current } : null; }
            setState(value => ({ ...value, concern: selected, message: "", error: selected?.status === "awaiting_response" && value.concern?.status !== "awaiting_response" ? "" : value.error, job: value.job?.id === selected?.latest_job_id ? value.job : null }));
          }
          if (selected?.latest_job_id) {
            const job = await cfoJson<DecisionJob>(`/concerns/${encodeURIComponent(selected.id)}/jobs/${encodeURIComponent(selected.latest_job_id)}`, { signal: abort.signal });
            if (!abort.signal.aborted && pollRevision === revision.current) setState(value => value.concern?.id === selected.id && value.concern.latest_job_id === selected.latest_job_id ? { ...value, job, message: pending.current ? value.message : "" } : value);
          }
        }
      } catch (error) {
        if (!abort.signal.aborted && pollRevision === revision.current) {
          if (error instanceof CfoApiError && [401, 403].includes(error.status)) {
            revision.current++; context.current = null; setState({ concern: null, busy: false, error: error.message, message: "", job: null });
          } else setState(value => ({ ...value, error: error instanceof CfoApiError ? error.message : "Decisions are temporarily unavailable." }));
        }
      } finally { if (!abort.signal.aborted) timer = setTimeout(tick, 2500); }
    };
    void tick();
    return () => { abort.abort(); clearTimeout(timer); runtimeAbort.current = null; context.current = null; pending.current = false; };
  }, [enabled]);

  const submit = useCallback(async (choice: DecisionChoice, input: "click" | "text" = "click"): Promise<boolean> => {
    const card = context.current, concern = current.current.concern, abort = runtimeAbort.current;
    if (!card || !concern || pending.current || !abort || abort.signal.aborted) return false;
    if (choice.optionId !== "custom" && !hasReviewedOptions(concern)) {
      setState(value => ({ ...value, error: "Reviewed suggestions are unavailable. Retry suggestions or give a custom instruction." }));
      return false;
    }
    if (choice.optionId === "custom" && (!choice.instruction.trim() || choice.instruction.length > 4000)) return false;
    const signature = JSON.stringify([card, choice, input]);
    const command = retry.current?.signature === signature ? retry.current.command : decisionCommand(card, choice, input, crypto.randomUUID());
    retry.current = { signature, command }; pending.current = true; revision.current++;
    setState(value => ({ ...value, busy: true, error: "", message: "Saving your instruction..." }));
    try {
      const result = await cfoJson<{ concern: DecisionConcern; job_id: string; status: string }>(`/concerns/${encodeURIComponent(concern.id)}/decisions`, { method: "POST", body: JSON.stringify(command), signal: abort.signal });
      if (abort.signal.aborted) return false;
      context.current = null; retry.current = null;
      setState(value => ({ ...value, concern: result.concern, job: { id: result.job_id, status: result.status }, message: "", error: "" }));
      revision.current++;
      return true;
    } catch (error) {
      if (!abort.signal.aborted) {
        const stale = error instanceof CfoApiError && error.status === 409;
        if (stale) { context.current = null; retry.current = null; }
        setState(value => ({ ...value, message: "", error: stale ? "This decision changed. Refreshing the available choices. Your instruction is kept." : error instanceof Error ? error.message : "Your choice could not be confirmed. Try again with the same instruction." }));
      }
      return false;
    } finally {
      if (runtimeAbort.current === abort) { pending.current = false; revision.current++; if (!abort.signal.aborted) setState(value => ({ ...value, busy: false })); }
    }
  }, []);
  const retrySuggestions = useCallback(async (): Promise<void> => {
    const concern = current.current.concern, runtime = runtimeAbort.current;
    if (concern?.status !== "card_failed" || pending.current || mic.current || !runtime || runtime.signal.aborted) return;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    runtime.signal.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    let onAbort: () => void = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new DOMException("Suggestion request cancelled", "AbortError"));
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 100_000);
    const actionRevision = ++revision.current;
    pending.current = true; context.current = null; retry.current = null;
    setState(value => ({ ...value, busy: true, error: "", message: "Preparing reviewed suggestions..." }));
    try {
      const refreshed = await Promise.race([cfoJson<DecisionConcern>(`/concerns/${encodeURIComponent(concern.id)}/card`, { method: "POST", signal: abort.signal }), interrupted]);
      if (abort.signal.aborted || refreshed.id !== concern.id || current.current.concern?.id !== concern.id || revision.current !== actionRevision) return;
      contextGeneration.current++;
      context.current = !mic.current && ["awaiting_response", "needs_input", "card_failed"].includes(refreshed.status) ? decisionContext(refreshed, contextGeneration.current) : null;
      setState(value => value.concern?.id === concern.id ? { ...value, concern: refreshed, message: "", error: refreshed.status === "card_failed" ? "Reviewed suggestions are still unavailable. You can retry or give a custom instruction." : "" } : value);
    } catch (error) {
      if (!runtime.signal.aborted && revision.current === actionRevision) setState(value => value.concern?.id === concern.id ? { ...value, message: "", error: timedOut ? "The request timed out. Suggestions may still be preparing; this card will refresh." : error instanceof Error ? error.message : "Suggestions could not be refreshed. Try again." } : value);
    } finally {
      clearTimeout(timeout); runtime.signal.removeEventListener("abort", cancel); abort.signal.removeEventListener("abort", onAbort);
      if (runtimeAbort.current === runtime) {
        pending.current = false; revision.current++;
        if (!runtime.signal.aborted) setState(value => ({ ...value, busy: false, message: "" }));
      }
    }
  }, []);
  const acceptEvent = useCallback((event: Record<string, unknown>) => {
    if (event.type !== "concern.decision") return;
    if (event.concern && typeof event.concern === "object" && "id" in event.concern) {
      const concern = event.concern as DecisionConcern;
      if (current.current.concern?.id !== concern.id) return;
      revision.current++; context.current = null; retry.current = null;
      setState(value => ({ ...value, concern, busy: false, error: "", job: { id: concern.latest_job_id ?? undefined, status: String(event.status ?? "queued") }, message: "" }));
    } else if (typeof event.message === "string") setState(value => ({ ...value, error: event.message as string, message: "" }));
  }, []);
  const dismiss = useCallback(() => {
    if (pending.current || mic.current) return;
    const concern = current.current.concern;
    if (concern) skipped.current.add(`${concern.id}:${concern.card_revision}`);
    revision.current++; context.current = null; setState({ concern: null, busy: false, error: "", message: "", job: null });
  }, []);
  return { ...state, context: context.current, submit, dismiss, retrySuggestions, acceptEvent, refresh: () => { revision.current++; } };
}
