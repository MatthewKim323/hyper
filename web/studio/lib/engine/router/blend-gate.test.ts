import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// gl.ts returns before composer.render() while body[data-atrium-active] is set. The toHome
// blend draws into that composer, so it must clear the flag once it has its still.
const toHome = readFileSync("lib/engine/router/transitions/to-home.ts", "utf8");
const gl = readFileSync("lib/engine/core/gl.ts", "utf8");

test("gl still skips rendering while the atrium owns the screen", () => {
  expect(gl).toContain('dataset.atriumActive === "true"');
});

test("the world blend clears that flag, after capturing its still", () => {
  const branch = toHome.slice(toHome.indexOf('if (view === "projects")'), toHome.indexOf("store.HomeContact.enable()"));
  const still = branch.indexOf("captureWorldStill()");
  const clear = branch.indexOf("delete document.body.dataset.atriumActive");
  expect(still).toBeGreaterThan(-1);
  expect(clear).toBeGreaterThan(-1);
  // Order matters: the still is the only thing that needs the flag.
  expect(clear).toBeGreaterThan(still);
});

test("the blend re-enables the gallery pass the atrium disabled", () => {
  expect(toHome).toContain("store.ProjectMenu.renderPass.enabled = true");
});
