import { expect, test, beforeEach } from "bun:test";
import { listen, navigationState, normalize, resetNavigationForTests } from "./navigation";

// The module listens on whatever target it is handed, so these run without a DOM.
type Handler = (event: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const target = { addEventListener: (type: string, handler: Handler) => { (handlers[type] ??= []).push(handler); } };
const fire = (type: string, detail: unknown) => (handlers[type] ?? []).forEach(h => h({ detail }));
const out = (from: string, to: string) => fire("hyper:navigate-out", { from, to });
const end = (to: string) => fire("hyper:navigate-end", { to });

listen(target as unknown as Window);
beforeEach(() => resetNavigationForTests("/world"));

test("normalize strips trailing slashes but keeps root", () => {
  expect(normalize("/world/")).toBe("/world");
  expect(normalize("/world")).toBe("/world");
  expect(normalize("/")).toBe("/");
  expect(normalize("")).toBe("/");
});

test("the route stays put for the whole transition, unlike usePathname", () => {
  // The bug this exists to prevent: Next commits the new path when the navigation starts,
  // so a component reading it tears down the outgoing scene mid-blend.
  out("/world", "/");
  expect(navigationState().route).toBe("/world");
  expect(navigationState().target).toBe("/");
  expect(navigationState().phase).toBe("leaving");
});

test("the route flips only when the transition finishes", () => {
  out("/world", "/");
  end("/");
  expect(navigationState().route).toBe("/");
  expect(navigationState().phase).toBe("settled");
});

test("trailing slashes from the engine's route table are normalized", () => {
  out("/world/", "/onboarding/");
  expect(navigationState().route).toBe("/world");
  expect(navigationState().target).toBe("/onboarding");
});

test("a navigation to the same route is not a transition", () => {
  out("/world", "/world");
  expect(navigationState().phase).toBe("settled");
});

test("a transition that never ends still settles, so the app cannot strand", async () => {
  // GSAP is rAF-driven and rAF does not tick in a background tab, so navigate-end can
  // genuinely never arrive. Every flag released only by that event used to stick.
  out("/world", "/");
  expect(navigationState().phase).toBe("leaving");
  await new Promise(resolve => setTimeout(resolve, 6200));
  expect(navigationState().route).toBe("/");
  expect(navigationState().phase).toBe("settled");
}, 9000);

test("scene components read the settled route, not usePathname", () => {
  // usePathname() commits when a navigation STARTS, which is ~3 s before the engine's out
  // transition finishes. Components that gated scenes on it tore their scene down mid-blend,
  // and each was patched with its own hand-rolled hold flag. One clock replaces all of them.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const root = join(import.meta.dirname, "../../..");
  const sceneGated = [
    "components/onboarding/OnboardingWorkspace.tsx",
    "components/workspace/WorkspaceSections.tsx",
    "components/command/CommandLayer.tsx",
    "components/benchmarks/BenchmarksWorkspace.tsx",
    "components/timeline/TimelineWorkspace.tsx",
    "components/RouteBack.tsx",
  ];
  for (const file of sceneGated) {
    const text = readFileSync(join(root, file), "utf8");
    expect(text).not.toContain('from "next/navigation"');
    expect(text).toMatch(/useNavigation|useOwnsScreen/);
  }
});
