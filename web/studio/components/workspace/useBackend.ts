"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getAuthState, startAuth, subscribeAuth, type AuthState } from "@/lib/backend/auth";
import { BackendError, poll } from "@/lib/backend/client";

const serverAuth: AuthState = { mode: "unconfigured", signedIn: false, ready: false, scope: "" };

export function useAuth(): AuthState {
  useEffect(() => { void startAuth(); }, []);
  return useSyncExternalStore(subscribeAuth, getAuthState, () => serverAuth);
}

export type Loaded<T> = { data: T | null; error: string | null; refresh: () => void };

/** Polls while `enabled`. Keeps the last good data on a failed poll so the screen does not blank. */
export function useBackend<T>(fetcher: () => Promise<T>, enabled: boolean, everyMs = 5000): Loaded<T> {
  const auth = useAuth();
  const scope = auth.signedIn ? auth.scope : "";
  const [loaded, setLoaded] = useState<{ scope: string; data: T | null; error: string | null }>({ scope: "", data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(fetcher);
  useEffect(() => { latest.current = fetcher; });
  useEffect(() => {
    if (!enabled || !scope) return;
    return poll(() => latest.current(), (next) => { setLoaded({ scope, data: next, error: null }); }, {
      everyMs,
      onError: (reason) => setLoaded(previous => ({ scope, data: previous.scope === scope && !(reason instanceof BackendError && [401, 403].includes(reason.status)) ? previous.data : null,
        error: reason instanceof BackendError && reason.status >= 500 ? "The workspace service is temporarily unavailable. We’ll keep trying." : reason.message })),
    });
  }, [enabled, everyMs, nonce, scope]);
  return { data: scope && loaded.scope === scope ? loaded.data : null, error: scope && loaded.scope === scope ? loaded.error : null, refresh: () => setNonce((n) => n + 1) };
}

export const when = (ms: number | null | undefined) => ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
export const money = (cents: unknown, currency: unknown) => typeof cents === "number"
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: typeof currency === "string" && currency.length === 3 ? currency : "USD" }).format(cents / 100) : null;
