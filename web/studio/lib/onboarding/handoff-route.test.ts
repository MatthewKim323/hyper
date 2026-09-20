import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { WORLD_PATH } from "../engine/router/routes";

test("onboarding handoff updates Next pathname as well as the address bar", () => {
  const studio = join(import.meta.dirname, "../..");
  const router = readFileSync(join(studio, "node_modules/next/dist/client/components/app-router.js"), "utf8");
  const wrapper = router.match(/window\.history\.replaceState = (function replaceState\([\s\S]*?\n        });/);
  assert.ok(wrapper, "Review the installed Next history integration after a framework update.");
  const workspace = readFileSync(join(studio, "components/onboarding/OnboardingWorkspace.tsx"), "utf8");
  const handoff = workspace.match(/window\.history\.replaceState\([^;]+\);/);
  assert.ok(handoff, "The world handoff must update browser history.");

  let pathname = "/onboarding", browserUrl = pathname, replaces = 0;
  const privateTree = { route: "onboarding" };
  const history = { state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: privateTree }, replaceState: (() => {}) as History["replaceState"] };
  // Exercise Next's installed wrapper, including its __NA internal-update bypass.
  history.replaceState = new Function("originalReplaceState", "copyNextJsInternalHistoryState", "applyUrlFromHistoryPushReplace", `return ${wrapper[1]}`)(
    (data: typeof history.state, _title: string, url: string) => { history.state = data; browserUrl = url; replaces++; },
    (data: object | null) => ({ ...history.state, ...data }),
    (url: string) => { pathname = url; },
  );
  history.replaceState(history.state, "", WORLD_PATH);
  assert.equal(browserUrl, WORLD_PATH);
  assert.equal(pathname, "/onboarding", "Forwarding __NA reproduces the visible-world, missing-CFO failure.");
  browserUrl = "/onboarding"; replaces = 0;
  new Function("window", "WORLD_PATH", handoff[0])({ history }, WORLD_PATH);

  assert.equal(browserUrl, WORLD_PATH);
  assert.equal(pathname, WORLD_PATH, "CommandLayer must receive /world through usePathname after Skip.");
  assert.equal(replaces, 1, "The handoff replaces its entry instead of adding another onboarding step.");
  assert.equal(history.state.__PRIVATE_NEXTJS_INTERNALS_TREE, privateTree, "Next still preserves its own history state.");
});
