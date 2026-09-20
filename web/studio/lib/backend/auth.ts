// Where the backend bearer token comes from. The backend accepts Clerk session JWTs only.
//   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set  -> Clerk (the real path)
//   NEXT_PUBLIC_BACKEND_DEV_TOKEN set      -> fixed token for tools/dev_backend.py, local only
//   neither                                -> signed out; sections explain what is missing
import { setBackendTokenProvider } from "./client";

export type AuthState = { mode: "clerk" | "dev" | "unconfigured"; signedIn: boolean; ready: boolean };
type Listener = (state: AuthState) => void;

const CLERK_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const DEV_TOKEN = process.env.NODE_ENV !== "production" ? process.env.NEXT_PUBLIC_BACKEND_DEV_TOKEN : undefined;

let state: AuthState = { mode: CLERK_KEY ? "clerk" : DEV_TOKEN ? "dev" : "unconfigured", signedIn: !CLERK_KEY && !!DEV_TOKEN, ready: !CLERK_KEY };
const listeners = new Set<Listener>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clerk: any = null;
let starting: Promise<void> | null = null;

const publish = (next: Partial<AuthState>) => { state = { ...state, ...next }; listeners.forEach((listener) => listener(state)); };

export function getAuthState() { return state; }
export function subscribeAuth(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Current bearer token, or null when signed out. Clerk tokens are short lived, so always ask again rather than caching. */
export async function getBackendToken(): Promise<string | null> {
  if (state.mode === "dev") return DEV_TOKEN ?? null;
  if (state.mode !== "clerk") return null;
  await startAuth();
  return (await clerk?.session?.getToken()) ?? null;
}

export function startAuth(): Promise<void> {
  if (state.mode !== "clerk" || typeof window === "undefined") return Promise.resolve();
  starting ??= (async () => {
    // clerk-js 6 ships without its sign-in components; they come from @clerk/ui and are passed to load().
    const [{ Clerk }, { ui }] = await Promise.all([import("@clerk/clerk-js"), import("@clerk/ui")]);
    clerk = new Clerk(CLERK_KEY!);
    await clerk.load({ ui });
    clerk.addListener(() => publish({ signedIn: !!clerk.session }));
    publish({ ready: true, signedIn: !!clerk.session });
  })().catch(() => { starting = null; publish({ ready: true, signedIn: false }); });
  return starting;
}

export async function openSignIn() { await startAuth(); clerk?.openSignIn({}); }
export async function signOut() { await clerk?.signOut(); }

setBackendTokenProvider(getBackendToken);
