import test from "node:test";
import assert from "node:assert/strict";
import { detectDevice } from "../src/device.js";

function environment({
  width = 1440,
  ua = "Chrome Macintosh",
  platform = "MacIntel",
  touch = 0,
  reduced = false,
} = {}) {
  const classes = new Set(),
    listeners = {};
  let reloads = 0;
  Object.assign(globalThis, {
    innerWidth: width,
    devicePixelRatio: 1,
    document: {
      documentElement: {
        dataset: {},
        classList: {
          add: (...names) => names.forEach((n) => classes.add(n)),
          toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        },
      },
    },
    window: { addEventListener: (name, fn) => (listeners[name] = fn) },
    location: { reload: () => reloads++ },
    matchMedia: (query) => ({ matches: query.includes("reduced") && reduced }),
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: ua, platform, maxTouchPoints: touch },
  });
  return { classes, listeners, reloads: () => reloads };
}

test("desktop classification and platform casing", () => {
  const env = environment();
  const result = detectDevice();
  assert.equal(result.device.desktop, true);
  assert.equal(result.os.mac, true);
  assert.equal(result.browser, "chrome");
  assert.ok(env.classes.has("is-not-any"));
});
test("narrow desktop window uses the responsive implementation", () => {
  environment({ width: 390 });
  assert.equal(detectDevice().device.mobile, true);
});
test("iPad desktop user agent remains a touch tablet", () => {
  const env = environment({
    width: 1366,
    ua: "Mozilla Macintosh Safari",
    touch: 5,
  });
  const result = detectDevice();
  assert.equal(result.device.tablet, true);
  assert.equal(result.device.ipadpro, true);
  assert.ok(env.classes.has("is-large-tablet"));
});
test("crossing desktop/touch boundary reloads the scene implementation", () => {
  const env = environment();
  detectDevice();
  globalThis.innerWidth = 834;
  env.listeners.resize();
  assert.equal(env.reloads(), 1);
});
test("phone to tablet updates classes without reloading", () => {
  const env = environment({ width: 390 });
  const result = detectDevice();
  globalThis.innerWidth = 834;
  env.listeners.resize();
  assert.equal(result.device.tablet, true);
  assert.equal(env.reloads(), 0);
  assert.ok(env.classes.has("is-tablet"));
  assert.ok(!env.classes.has("is-mobile"));
});
test("respects reduced-motion preference", () => {
  environment({ reduced: true });
  assert.equal(detectDevice().reduced, true);
});
