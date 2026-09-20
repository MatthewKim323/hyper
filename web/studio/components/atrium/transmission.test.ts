import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HalfFloatType, LinearMipmapLinearFilter, MathUtils, NoToneMapping, REVISION, UnsignedByteType, Vector2, WebGLRenderTarget, type WebGLRenderer } from "three";
import { configureAtriumTransmission } from "./transmission";

const packageRoot = new URL("../../node_modules/three/", import.meta.url);
const SOURCES = ["src/renderers/WebGLRenderer.js", "build/three.module.js", "build/three.cjs"];

// Execute the actual installed pass from every shipped entry point with only
// its GL-bound dependencies replaced. This catches a missing package patch or
// divergence between the source, browser ESM bundle, and Node CJS bundle.
function harness(path: string, width = 2240, height = 1260, webgl2 = true, supported = ["EXT_color_buffer_float"]) {
  const source = readFileSync(new URL(path, packageRoot), "utf8");
  const start = source.indexOf("\tfunction renderTransmissionPass(");
  const end = source.indexOf("\n\tfunction renderObjects(", start);
  assert.ok(start > 0 && end > start, `Three r143 pass boundary changed in ${path}`);
  assert.match(source, /this\.transmissionResolutionLimit = Infinity;/);
  const factory = new Function("dependencies", `
    const { capabilities, extensions, WebGLRenderTarget, HalfFloatType,
      UnsignedByteType, LinearMipmapLinearFilter, NoToneMapping, Vector2,
      floorPowerOfTwo, _this, renderObjects, textures } = dependencies;
    const _antialias = false;
    const _vector2 = new Vector2();
    let _transmissionRenderTarget = null;
    ${source.slice(start, end)}
    return renderTransmissionPass;
  `) as (dependencies: Record<string, unknown>) => (opaque: object[], scene: object, camera: object) => void;
  let current: WebGLRenderTarget | null = null;
  const draws: { target: WebGLRenderTarget; width: number; height: number }[] = [];
  const drawingBufferSize = new Vector2(width, height);
  const renderer = {
    transmissionResolutionLimit: Infinity,
    toneMapping: 4,
    getDrawingBufferSize(target: Vector2) { return target.copy(drawingBufferSize); },
    getRenderTarget() { return current; },
    setRenderTarget(target: WebGLRenderTarget | null) { current = target; },
    clear() {},
  };
  const render = factory({
    capabilities: { isWebGL2: webgl2 },
    extensions: { has: (extension: string) => supported.includes(extension) },
    WebGLRenderTarget, HalfFloatType, UnsignedByteType, LinearMipmapLinearFilter,
    NoToneMapping, Vector2, floorPowerOfTwo: MathUtils.floorPowerOfTwo,
    _this: renderer,
    renderObjects() {
      assert.ok(current);
      assert.equal(renderer.toneMapping, NoToneMapping);
      draws.push({ target: current, width: current.width, height: current.height });
    },
    textures: { updateMultisampleRenderTarget() {}, updateRenderTargetMipmap() {} },
  });
  return { renderer, draws, drawingBufferSize, render: () => render([], {}, {}) };
}

test("the checked Bun patch remains pinned to Three 0.143.0", () => {
  assert.equal(REVISION, "143");
  const installed = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
  const project = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(installed.version, "0.143.0");
  assert.equal(project.dependencies.three, "0.143.0");
  assert.equal(project.patchedDependencies["three@0.143.0"], "patches/three@0.143.0.patch");
});

for (const path of SOURCES) {
  test(`${path}: all camera passes share one capped aspect-preserving target without resizing the canvas`, () => {
    const h = harness(path);
    const originalQuery = h.renderer.getDrawingBufferSize;
    const restore = configureAtriumTransmission(h.renderer as unknown as WebGLRenderer);
    const reflection = new WebGLRenderTarget(512, 288);
    const beauty = new WebGLRenderTarget(2240, 1260);
    h.renderer.setRenderTarget(reflection);
    h.render();
    const transmission = h.draws[0].target;
    let reallocations = 0;
    transmission.addEventListener("dispose", () => { reallocations++; });
    h.renderer.setRenderTarget(beauty);
    h.render();
    h.renderer.setRenderTarget(null);
    h.render();
    assert.equal(h.renderer.getRenderTarget(), null);
    assert.ok(h.draws.every(draw => draw.target === transmission && draw.width === 1024 && draw.height === 576));
    assert.equal(reallocations, 0);
    assert.equal(h.renderer.getDrawingBufferSize, originalQuery);
    assert.deepEqual(h.renderer.getDrawingBufferSize(new Vector2()), new Vector2(2240, 1260));
    assert.deepEqual([reflection.width, reflection.height, beauty.width, beauty.height], [512, 288, 2240, 1260]);
    assert.equal(h.renderer.toneMapping, 4);
    restore();
    restore();
    assert.equal(h.renderer.transmissionResolutionLimit, Infinity);
    transmission.dispose(); reflection.dispose(); beauty.dispose();
  });

  test(`${path}: portrait and small canvases obey the mobile limit without upscaling`, () => {
    for (const [width, height, expectedWidth, expectedHeight] of [[1260, 2240, 288, 512], [320, 180, 320, 180], [1, 2240, 1, 512]]) {
      const h = harness(path, width, height);
      const restore = configureAtriumTransmission(h.renderer as unknown as WebGLRenderer, 512);
      h.render();
      assert.deepEqual([h.draws[0].width, h.draws[0].height], [expectedWidth, expectedHeight]);
      restore();
      h.draws[0].target.dispose();
    }
  });

  test(`${path}: native defaults and WebGL1 power-of-two compatibility remain intact`, () => {
    const native = harness(path);
    native.render();
    assert.deepEqual([native.draws[0].width, native.draws[0].height], [2240, 1260]);
    const legacy = harness(path, 2240, 1260, false);
    configureAtriumTransmission(legacy.renderer as unknown as WebGLRenderer, 512);
    legacy.render();
    assert.deepEqual([legacy.draws[0].width, legacy.draws[0].height], [512, 256]);
    native.draws[0].target.dispose(); legacy.draws[0].target.dispose();
  });

  test(`${path}: HDR recognizes the WebGL2 extension without assuming WebGL1 float support`, () => {
    for (const [webgl2, extensions, expected] of [
      [true, ["EXT_color_buffer_float"], HalfFloatType],
      [true, ["EXT_color_buffer_half_float"], HalfFloatType],
      [false, ["EXT_color_buffer_half_float"], HalfFloatType],
      [false, ["EXT_color_buffer_float"], UnsignedByteType],
      [true, [], UnsignedByteType],
    ] as const) {
      const h = harness(path, 640, 360, webgl2, [...extensions]);
      h.render();
      assert.equal(h.draws[0].target.texture.type, expected);
      h.draws[0].target.dispose();
    }
  });
}

test("configuration fails clearly when dependencies were installed without the patch", () => {
  assert.throws(() => configureAtriumTransmission({} as WebGLRenderer), /Run bun install/);
});
