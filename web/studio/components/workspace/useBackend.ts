"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getAuthState, startAuth, subscribeAuth, type AuthState } from "@/lib/backend/auth";
import { BackendError, poll } from "@/lib/backend/client";

const serverAuth: AuthState = { mode: "unconfigured", signedIn: false, ready: false };

export function useAuth(): AuthState {
  useEffect(() => { void startAuth(); }, []);
  return useSyncExternalStore(subscribeAuth, getAuthState, () => serverAuth);
}

export type Loaded<T> = { data: T | null; error: string | null; refresh: () => void };

/** Polls while `enabled`. Keeps the last good data on a failed poll so the screen does not blank. */
export function useBackend<T>(fetcher: () => Promise<T>, enabled: boolean, everyMs = 5000): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(fetcher);
  useEffect(() => { latest.current = fetcher; });
  useEffect(() => {
    if (!enabled) return;
    return poll(() => latest.current(), (next) => { setData(next); setError(null); }, {
      everyMs,
      onError: (reason) => setError(reason instanceof BackendError && reason.status >= 500
        ? "The backend is not reachable. Start it, then this refreshes on its own."
        : reason.message),
    });
  }, [enabled, everyMs, nonce]);
  return { data, error, refresh: () => setNonce((n) => n + 1) };
}

export const when = (ms: number | null | undefined) => ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
export const money = (cents: unknown, currency: unknown) => typeof cents === "number"
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: typeof currency === "string" && currency.length === 3 ? currency : "USD" }).format(cents / 100) : null;
