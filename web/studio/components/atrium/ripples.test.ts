import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { createWaterRipples, type WaterRipples } from "./ripples";

function height(ripples: WaterRipples, x: number, y: number) {
  const { data, width } = ripples.texture.image;
  const offset = (y * width + x) * 4;
  return ((data[offset] * 256 + data[offset + 1]) / 65535 - 0.5) * 2;
}

function energy(ripples: WaterRipples) {
  const { data } = ripples.texture.image;
  let sum = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = ((data[offset] * 256 + data[offset + 1]) / 65535 - 0.5) * 2;
    sum += value * value;
  }
  return sum;
}

describe("atrium cursor water ripples", () => {
  test("propagates a local disturbance into neighboring water while preserving the boundaries", () => {
    const ripples = createWaterRipples();
    const { width, height: rows } = ripples.texture.image;
    ripples.splash(64 / (width - 1), 36 / (rows - 1));
    ripples.step(1 / 60);
    assert.ok(height(ripples, 64, 36) > 0.1);
    assert.ok(Math.abs(height(ripples, 76, 36)) < 0.00002);
    for (let frame = 0; frame < 20; frame++) ripples.step(1 / 60);
    assert.ok(Math.abs(height(ripples, 76, 36)) > 0.001, "wave should travel beyond the Gaussian injection");
    for (let x = 0; x < width; x++) {
      assert.ok(Math.abs(height(ripples, x, 0)) < 0.00002);
      assert.ok(Math.abs(height(ripples, x, rows - 1)) < 0.00002);
    }
    ripples.dispose();
  });

  test("decays to rest after interaction stops", () => {
    const ripples = createWaterRipples();
    ripples.splash(0.5, 0.5, 0.2);
    ripples.step(1 / 60);
    const initialEnergy = energy(ripples);
    for (let frame = 0; frame < 900; frame++) ripples.step(1 / 60);
    assert.ok(energy(ripples) < initialEnergy * 0.001);
    ripples.dispose();
  });

  test("caps long elapsed times at eight stable steps and ignores invalid input", () => {
    const longFrame = createWaterRipples();
    const fixedFrames = createWaterRipples();
    for (const ripples of [longFrame, fixedFrames]) ripples.splash(0.45, 0.6, 0.15);
    longFrame.step(60 * 60);
    for (let frame = 0; frame < 8; frame++) fixedFrames.step(1 / 60);
    assert.deepEqual(longFrame.texture.image.data, fixedFrames.texture.image.data);
    const version = longFrame.texture.version;
    longFrame.step(NaN);
    longFrame.step(Infinity);
    longFrame.step(-1);
    longFrame.splash(NaN, 0.5);
    longFrame.splash(0.5, Infinity);
    longFrame.splash(0.5, 0.5, NaN);
    assert.equal(longFrame.texture.version, version);
    longFrame.splash(-20, 40, 1e300);
    longFrame.step(1 / 60);
    assert.ok(Number.isFinite(energy(longFrame)));
    longFrame.dispose();
    fixedFrames.dispose();
  });

  test("uses fixed steps without uploading partial frames, resets every wave, and releases the texture once", () => {
    const ripples = createWaterRipples();
    const initialVersion = ripples.texture.version;
    ripples.splash(0.4, 0.6);
    ripples.step(1 / 120);
    assert.equal(ripples.texture.version, initialVersion);
    ripples.step(1 / 120);
    assert.equal(ripples.texture.version, initialVersion + 1);
    assert.ok(energy(ripples) > 0.01);
    ripples.reset();
    assert.ok(energy(ripples) < 0.00001);
    const resetVersion = ripples.texture.version;
    ripples.step(1);
    assert.equal(ripples.texture.version, resetVersion);
    let disposals = 0;
    ripples.texture.addEventListener("dispose", () => { disposals++; });
    ripples.dispose();
    ripples.dispose();
    ripples.splash(0.5, 0.5);
    ripples.step(1);
    ripples.reset();
    assert.equal(disposals, 1);
    assert.equal(ripples.texture.version, resetVersion);
  });
});
