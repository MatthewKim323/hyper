import { strict as assert } from "node:assert";
import { test } from "node:test";
import { atriumResolution } from "./resolution";

test("Retina desktop quality never collapses into an upscaled subpixel canvas", () => {
  const sharp = atriumResolution(1440, 810, 2, false, 1);
  const loaded = atriumResolution(1440, 810, 2, false, .1);
  assert.ok(sharp.pixelRatio >= loaded.pixelRatio);
  assert.equal(loaded.pixelRatio, 1.25);
  assert.ok(loaded.minimumQuality > .8);
});

test("a 1x screen stays at its native CSS resolution under load", () => {
  assert.equal(atriumResolution(1280, 720, 1, false, .6).pixelRatio, 1);
  assert.equal(atriumResolution(1280, 720, 1, false, 1).pixelRatio, 1);
});

test("large screens stay within the pixel budget and touch screens keep their lower ceiling", () => {
  for (const quality of [.1, .6, 1, 2]) {
    const wide = atriumResolution(3840, 2160, 2, false, quality);
    assert.ok(3840 * 2160 * wide.pixelRatio ** 2 <= 2_600_001);
    const mobile = atriumResolution(720, 405, 3, true, quality);
    assert.ok(mobile.pixelRatio >= 1 && mobile.pixelRatio <= 1.25);
  }
});
