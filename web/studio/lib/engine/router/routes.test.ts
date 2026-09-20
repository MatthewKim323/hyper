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
    // This guard used to skip .test.ts files and match only two literal spellings, so it
    // passed while voice-client.test.ts still hardcoded the old path. Scan styles too.
    const roots = ["app", "components", "lib"].map(d => join(import.meta.dirname, "../../..", d));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue; }
        if (!/\.(tsx?|css)$/.test(entry.name)) continue;
        if (entry.name === "routes.test.ts") continue;
        // Any /projects URL path, however it is spelled: quoted, in a template literal, or
        // inside a longer string. Module specifiers and data files legitimately keep the
        // name (./renderers/projects, lib/data/projects.json), so require a path boundary
        // that is not a further path segment or extension.
        // Strip module specifiers and asset paths first: ./renderers/projects and
        // lib/data/projects.json legitimately keep the name.
        const text = readFileSync(full, "utf8")
          .replace(/from\s+["'][^"']*["']/g, "")
          .replace(/[\w./@-]*projects\.json/g, "");
        if (/\/projects(?![A-Za-z0-9_-])/.test(text)) offenders.push(full);
      }
    };
    roots.forEach(walk);
    assert.deepEqual(offenders, []);
  });

  test("normalizePath adds exactly one trailing slash", () => {
    assert.equal(normalizePath("/world"), "/world/");
    assert.equal(normalizePath("/world/"), "/world/");
    assert.equal(normalizePath("/"), "/");
  });
});
