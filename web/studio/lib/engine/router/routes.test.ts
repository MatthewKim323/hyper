import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { CONTEXTUAL_ROUTES, ONBOARDING_PATH, WORLD_PATH, bodyClassFor, matchContextualRoute, normalizePath, type ContextualRoute } from "./routes";

const APP = join(import.meta.dirname, "../../../app");
const ROUTES = ["/", "/contact", ONBOARDING_PATH, WORLD_PATH];

/** The table the Router builds in its constructor. */
function table() {
  const built: Record<string, ContextualRoute[]> = {};
  for (const [from, to, transition] of CONTEXTUAL_ROUTES) (built[from] ??= []).push({ toPattern: to, transition });
  return built;
}

describe("route table", () => {
  test("every ordered pair of real routes resolves to a scene transition", () => {
    // An unmatched pair silently falls back to the default transition, which does not drive
    // the WebGL scenes: navigation appears to work but leaves a blank canvas.
    const built = table();
    for (const from of ROUTES)
      for (const to of ROUTES) {
        if (from === to) continue;
        assert.ok(matchContextualRoute(built, from, to), `no transition for ${from} -> ${to}`);
      }
  });

  test("a route's own path never transitions to itself", () => {
    for (const path of ROUTES) assert.equal(matchContextualRoute(table(), path, path), null);
  });

  test("bodyClassFor agrees with the pre-paint script in app/layout.tsx", () => {
    // They are separate implementations; a mismatch flashes the wrong class on first paint.
    const layout = readFileSync(join(APP, "layout.tsx"), "utf8");
    const script = layout.slice(layout.indexOf("BODY_CLASS_SCRIPT"), layout.indexOf("document.documentElement.dataset.onboarding"));
    for (const path of ROUTES) {
      const expected = bodyClassFor(path);
      assert.ok(script.includes(`"${expected}"`), `layout.tsx is missing the body class for ${path}: ${expected}`);
      assert.ok(script.includes(`p==="${path}"`) || path === "/", `layout.tsx does not branch on ${path}`);
    }
    assert.equal(bodyClassFor("/nope"), "error404 dark");
  });

  test("each real route has a page whose slug has a renderer", () => {
    const renderers = new Set(readdirSync(join(import.meta.dirname, "renderers")).map(f => f.replace(/\.ts$/, "")));
    // The registry keys are camelCase views; map the file names we ship.
    const views = new Set(["homeContact", "projects", "notFound", "default"]);
    assert.ok(renderers.size >= 4);
    for (const path of ROUTES) {
      const file = join(APP, path === "/" ? "page.tsx" : `${path.slice(1)}/page.tsx`);
      assert.ok(existsSync(file), `no page for ${path}`);
      const slug = /data-router-view="([^"]+)"/.exec(readFileSync(file, "utf8"))?.[1];
      assert.ok(slug && views.has(slug), `${path} declares an unregistered view: ${slug}`);
    }
  });

  test("no source file still points at the removed /projects route", () => {
    const roots = ["app", "components", "lib"].map(d => join(import.meta.dirname, "../../..", d));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts")) continue;
        const text = readFileSync(full, "utf8");
        if (text.includes('"/projects"') || text.includes("href=\"/projects\"")) offenders.push(full);
      }
    };
    roots.forEach(walk);
    assert.deepEqual(offenders, []);
  });


  test("the route-level back link outranks every full-viewport overlay it shares a page with", () => {
    // .hyper-onboarding (80) and .ws-signin (90) are fixed, inset:0 and take pointer events,
    // so a lower .route-back renders underneath them and cannot be clicked.
    const css = (name: string) => readFileSync(join(import.meta.dirname, "../../../app/styles", name), "utf8");
    const zOf = (text: string, selector: string) => {
      const at = text.indexOf(selector);
      assert.ok(at >= 0, `missing ${selector}`);
      const block = text.slice(at, text.indexOf("}", at));
      return Number(/z-index:\s*(\d+)/.exec(block)?.[1]);
    };
    const back = zOf(css("workspace.css"), ".route-back {");
    assert.ok(back > zOf(css("onboarding.css"), ".hyper-onboarding {"), "back link is under the onboarding surface");
    assert.ok(back > zOf(css("workspace.css"), ".ws-signin {"), "back link is under the sign-in overlay");
    // ...and stays under the loading layer, which must cover everything.
    assert.ok(back < 12000, "back link would show through the loading screen");
  });


  test("the back link's opacity is GSAP's alone", () => {
    // A CSS transition or a rule that snaps opacity/visibility would fight the tween in
    // components/RouteBack.tsx and the link would cut rather than fade.
    const css = readFileSync(join(import.meta.dirname, "../../../app/styles/workspace.css"), "utf8");
    const block = css.slice(css.indexOf(".route-back {"), css.indexOf("}", css.indexOf(".route-back {")));
    const transition = /transition:([^;]*)/.exec(block)?.[1] ?? "";
    assert.ok(!transition.includes("opacity"), "CSS still transitions .route-back opacity");
    // Any later rule that sets opacity on .route-back would override the tween.
    const after = css.slice(css.indexOf(".route-back:hover"));
    for (const rule of after.split("}"))
      if (rule.includes(".route-back") && /\bopacity\s*:/.test(rule))
        assert.fail(`a later rule overrides the tween's opacity: ${rule.trim().slice(0, 80)}`);
    const component = readFileSync(join(import.meta.dirname, "../../../components/RouteBack.tsx"), "utf8");
    assert.ok(component.includes("autoAlpha"), "RouteBack no longer tweens autoAlpha");
    assert.ok(component.includes("hyper:navigate-out"), "RouteBack must fade on navigate-out, not on pathname");
  });

  test("normalizePath adds exactly one trailing slash", () => {
    assert.equal(normalizePath("/world"), "/world/");
    assert.equal(normalizePath("/world/"), "/world/");
    assert.equal(normalizePath("/"), "/");
  });
});
