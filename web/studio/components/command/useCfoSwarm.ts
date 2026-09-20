"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getAuthState, getBackendToken } from "@/lib/backend/auth";
import { useAuth } from "@/components/workspace/useBackend";
import {
  fetchSwarmMessages, fetchSwarmSnapshot, MAX_SWARM_EVENTS, mergeSwarmEvents, mergeSwarmSnapshot, streamSwarm,
  SwarmFeedError, type CfoConnection, type SwarmSnapshot,
} from "@/lib/command/cfo-feed";

const subscribeVisibility = (change: () => void) => { document.addEventListener("visibilitychange", change); return () => document.removeEventListener("visibilitychange", change); };
const visibleSnapshot = () => !document.hidden;
type FeedState = { scope: string; data: SwarmSnapshot | null; error: string | null; errorSource: "connection" | "page" | "auth" | null; connection: CfoConnection; loadingMore: boolean };
type Page = { kind: "older" } | { kind: "tasks" } | { kind: "messages"; taskId: string | null };
type Runtime = { load: (page: Page) => Promise<void> };
const message = (cause: unknown) => cause instanceof SwarmFeedError ? cause.message : "The activity connection was interrupted. Reconnecting...";

/** One authenticated stream per open panel. Closing or hiding the tab aborts all reads. */
export function useCfoSwarm(enabled: boolean) {
  const auth = useAuth();
  const scope = auth.ready && auth.signedIn ? auth.scope : "";
  const visible = useSyncExternalStore(subscribeVisibility, visibleSnapshot, () => false);
  const [state, setState] = useState<FeedState>({ scope: "", data: null, error: null, errorSource: null, connection: "idle", loadingMore: false });
  const current = useRef(state);
  const runtime = useRef<Runtime | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled || !scope || !visible) return;
    let disposed = false, failures = 0, busy = false, stoppedForAuth = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let requestController = new AbortController();
    const cursors = new Map<string | null, { session: string; cursor: string | null; hasMore: boolean }>();
    const valid = () => !disposed && !controller.signal.aborted && getAuthState().signedIn && getAuthState().scope === scope;
    const stateHere = (): FeedState => current.current.scope === scope ? current.current : { scope, data: null, error: null, errorSource: null, connection: "idle", loadingMore: false };
    const publish = (patch: Partial<FeedState>) => {
      if (!valid()) return;
      const next = { ...stateHere(), ...patch, scope };
      current.current = next; setState(next);
    };
    const applyCursors = (data: SwarmSnapshot): SwarmSnapshot => ({
      ...data,
      provider_logs: { ...data.provider_logs, sessions: data.provider_logs.sessions.map(session => {
        const manual = cursors.get(session.task_id);
        if (!manual || manual.session !== session.session_id) return session;
        return { ...session, next_cursor: manual.cursor, has_more: manual.hasMore };
      }) },
    });
    const recoveredConnection = () => {
      const source = stateHere().errorSource;
      // A working stream resolves transport errors, not an unrelated failed history request.
      return source === "page" ? {} : { error: null, errorSource: null };
    };
    const accept = (data: SwarmSnapshot) => {
      failures = 0;
      publish({ data: applyCursors(mergeSwarmSnapshot(stateHere().data, data)), ...recoveredConnection(), connection: "connected" });
    };
    const unauthorized = (cause: unknown) => {
      if (!(cause instanceof SwarmFeedError) || !cause.unauthorized) return false;
      if (cause.reason === "token_expired") {
        requestController.abort(); requestController = new AbortController(); busy = false;
        publish({ data: null, error: null, errorSource: null, connection: "reconnecting", loadingMore: false });
        return "expired";
      }
      stoppedForAuth = true;
      publish({ data: null, error: cause.message, errorSource: "auth", connection: "unauthorized", loadingMore: false });
      controller.abort();
      return "removed";
    };
    const requestOptions = () => ({ token: getBackendToken, signal: AbortSignal.any([controller.signal, requestController.signal, AbortSignal.timeout(20000)]) });
    const connect = async () => {
      if (!valid() || stoppedForAuth) return;
      publish({ connection: stateHere().data ? "reconnecting" : "connecting", loadingMore: busy });
      try {
        if (!stateHere().data) {
          const initial = await fetchSwarmSnapshot(requestOptions());
          if (!valid()) return;
          accept(initial);
        }
        await streamSwarm({ token: getBackendToken, signal: AbortSignal.any([controller.signal, requestController.signal]), after: stateHere().data?.cursor ?? null,
          onOpen: () => publish({ connection: "connected", ...recoveredConnection() }), onSnapshot: accept });
        if (valid()) throw new SwarmFeedError("The activity connection closed. Reconnecting...");
      } catch (cause) {
        if (!valid()) return;
        const authFailure = unauthorized(cause);
        if (authFailure === "removed") return;
        failures++;
        if (authFailure !== "expired") publish({ error: message(cause), errorSource: "connection", connection: "disconnected" });
      }
      if (valid() && !stoppedForAuth) retry = setTimeout(() => { void connect(); }, Math.min(500 * 2 ** Math.min(failures, 5), 15000));
    };
    const owner: Runtime = { load: async page => {
      if (!valid() || busy || stoppedForAuth) return;
      const data = stateHere().data;
      if (!data) return;
      if (page.kind === "older" && (!data.has_more || !data.older_cursor || data.events.length >= MAX_SWARM_EVENTS)) return;
      if (page.kind === "tasks" && (!data.tasks_has_more || data.tasks_next_offset === null)) return;
      const session = page.kind === "messages" ? data.provider_logs.sessions.find(item => item.task_id === page.taskId) : null;
      if (page.kind === "messages" && (!session || !session.has_more)) return;
      const requestScope = requestController;
      const validPage = () => valid() && requestScope === requestController;
      busy = true; publish({ loadingMore: true });
      try {
        if (page.kind === "messages" && session) {
          const messages = await fetchSwarmMessages(requestOptions(), page.taskId, session.next_cursor);
          if (!validPage()) return;
          cursors.set(page.taskId, { session: session.session_id, cursor: messages.next_cursor, hasMore: messages.has_more });
          const latest = stateHere().data;
          if (latest) {
            const events = mergeSwarmEvents(latest.events, messages.events);
            publish({ data: applyCursors({ ...latest, events, has_more: events.length >= MAX_SWARM_EVENTS ? false : latest.has_more }), error: null, errorSource: null });
          }
        } else {
          const next = await fetchSwarmSnapshot(requestOptions(), page.kind === "older" ? { before: data.older_cursor } : { taskOffset: data.tasks_next_offset ?? 0 });
          if (!validPage()) return;
          publish({ data: applyCursors(mergeSwarmSnapshot(stateHere().data, next, page.kind === "older" ? "older" : "tasks")), error: null, errorSource: null });
        }
      } catch (cause) {
        if (validPage() && !unauthorized(cause)) publish({ error: message(cause), errorSource: "page" });
      } finally { if (validPage()) { busy = false; publish({ loadingMore: false }); } }
    } };
    runtime.current = owner;
    void Promise.resolve().then(connect);
    return () => {
      disposed = true; controller.abort(); clearTimeout(retry);
      if (runtime.current === owner) runtime.current = null;
    };
  }, [enabled, scope, visible, revision]);

  const loadOlder = useCallback(() => runtime.current?.load({ kind: "older" }) ?? Promise.resolve(), []);
  const loadMoreTasks = useCallback(() => runtime.current?.load({ kind: "tasks" }) ?? Promise.resolve(), []);
  const loadMoreMessages = useCallback((taskId: string | null) => runtime.current?.load({ kind: "messages", taskId }) ?? Promise.resolve(), []);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const own = !!scope && state.scope === scope;
  const connection: CfoConnection = !enabled ? "idle" : !auth.ready ? "connecting" : !scope ? "unauthorized" : !visible ? "paused" : own ? state.connection : "connecting";
  return {
    data: own ? state.data : null,
    error: own ? state.error : auth.ready && !scope ? "Sign in to see your CFO activity." : null,
    connection, loadOlder, loadMoreTasks, loadMoreMessages,
    loadingMore: enabled && visible && own ? state.loadingMore : false, refresh,
  };
}
