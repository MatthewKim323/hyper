import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test } from "node:test";
import {
  isOnboardingComplete,
  isOnboardingPresentation,
  ONBOARDING_EVENTS,
  ONBOARDING_STORAGE_KEY,
  ORB_STATES,
  presentOnboarding,
  setOnboardingComplete,
  subscribeOnboardingCompletion,
} from "./interface";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let browser: EventTarget;
let values: Map<string, string>;
let failReads: boolean;
let failWrites: boolean;

function storageEvent(key: string | null) {
  const event = new Event("storage");
  Object.defineProperty(event, "key", { value: key });
  browser.dispatchEvent(event);
}

beforeEach(() => {
  browser = new EventTarget();
  values = new Map();
  failReads = false;
  failWrites = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        if (failReads) throw new Error("Storage access blocked");
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (failWrites) throw new Error("Storage write blocked");
        values.set(key, value);
      },
      removeItem(key: string) {
        if (failWrites) throw new Error("Storage write blocked");
        values.delete(key);
      },
    },
  });
  setOnboardingComplete(false);
});

afterEach(() => {
  failReads = false;
  failWrites = false;
  setOnboardingComplete(false);
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("completion persists, resets, and notifies subscribers in the current tab", () => {
  const observed: boolean[] = [];
  const unsubscribe = subscribeOnboardingCompletion(() => observed.push(isOnboardingComplete()));
  assert.equal(isOnboardingComplete(), false);
  setOnboardingComplete(true);
  assert.equal(values.get(ONBOARDING_STORAGE_KEY), "complete");
  assert.equal(isOnboardingComplete(), true);
  setOnboardingComplete(false);
  assert.equal(values.has(ONBOARDING_STORAGE_KEY), false);
  assert.equal(isOnboardingComplete(), false);
  assert.deepEqual(observed, [true, false]);
  unsubscribe();
  setOnboardingComplete(true);
  assert.deepEqual(observed, [true, false]);
});

test("completion and reset remain usable when all storage access is blocked", () => {
  failReads = failWrites = true;
  setOnboardingComplete(true);
  assert.equal(isOnboardingComplete(), true);
  setOnboardingComplete(false);
  assert.equal(isOnboardingComplete(), false);
});

test("a failed completion write uses the session value even when storage reads succeed", () => {
  failWrites = true;
  setOnboardingComplete(true);
  assert.equal(values.has(ONBOARDING_STORAGE_KEY), false);
  assert.equal(isOnboardingComplete(), true);
});

test("a failed reset overrides the old stored completion for the current session", () => {
  setOnboardingComplete(true);
  failWrites = true;
  setOnboardingComplete(false);
  assert.equal(values.get(ONBOARDING_STORAGE_KEY), "complete");
  assert.equal(isOnboardingComplete(), false);
});

test("cross-tab changes and clear notify subscribers, unrelated keys and cleanup do not", () => {
  const observed: boolean[] = [];
  const unsubscribe = subscribeOnboardingCompletion(() => observed.push(isOnboardingComplete()));
  values.set(ONBOARDING_STORAGE_KEY, "complete");
  storageEvent("unrelated-key");
  assert.deepEqual(observed, []);
  storageEvent(ONBOARDING_STORAGE_KEY);
  assert.deepEqual(observed, [true]);
  values.clear();
  storageEvent(null);
  assert.deepEqual(observed, [true, false]);
  unsubscribe();
  storageEvent(ONBOARDING_STORAGE_KEY);
  assert.deepEqual(observed, [true, false]);
});

test("a later cross-tab change replaces a temporary completion fallback", () => {
  failWrites = true;
  setOnboardingComplete(true);
  assert.equal(isOnboardingComplete(), true);
  let observed: boolean | undefined;
  const unsubscribe = subscribeOnboardingCompletion(() => { observed = isOnboardingComplete(); });
  storageEvent(ONBOARDING_STORAGE_KEY);
  assert.equal(observed, false);
  assert.equal(isOnboardingComplete(), false);
  unsubscribe();
});

test("server reads have a stable incomplete snapshot without browser globals", () => {
  setOnboardingComplete(true);
  Reflect.deleteProperty(globalThis, "window");
  assert.equal(isOnboardingComplete(), false);
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
});

test("presentation accepts the nine orb states and rejects malformed or oversized updates", () => {
  for (const orbState of ORB_STATES) assert.equal(isOnboardingPresentation({ orbState }), true);
  assert.equal(isOnboardingPresentation({ status: "a".repeat(500), transcript: "b".repeat(8000), processing: true }), true);
  for (const invalid of [
    null, [], "listening", { orbState: "talking" }, { processing: "true" },
    { status: 42 }, { transcript: false }, { status: "a".repeat(501) }, { transcript: "b".repeat(8001) },
  ]) assert.equal(isOnboardingPresentation(invalid), false);
});

test("presentation dispatch preserves the real adapter payload", () => {
  const payload = { orbState: "composing" as const, transcript: "A real adapter message", processing: true };
  let detail: unknown;
  const onPresentation = (event: Event) => { detail = (event as CustomEvent).detail; };
  browser.addEventListener(ONBOARDING_EVENTS.presentation, onPresentation);
  presentOnboarding(payload);
  assert.equal(detail, payload);
  browser.removeEventListener(ONBOARDING_EVENTS.presentation, onPresentation);
});
