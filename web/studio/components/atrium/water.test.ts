import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { BoxGeometry, DirectionalLight, DoubleSide, HalfFloatType, LinearEncoding, Matrix4, Mesh, MeshDepthMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, Scene, ShaderMaterial, Texture, Vector3, Vector4, WebGLRenderTarget, type Camera, type WebGLRenderer } from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { createAtriumWater } from "./water";

function material(surface: Reflector) { return surface.material as ShaderMaterial; }

function captureHarness(onRender: (scene: Scene, camera: Camera, target: WebGLRenderTarget | null) => void) {
  const originalTarget = new WebGLRenderTarget(100, 100);
  originalTarget.scissorTest = true;
  const originalViewport = new Vector4(7, 9, 88, 76);
  const viewport = originalViewport.clone();
  let activeTarget: WebGLRenderTarget | null = originalTarget;
  let activeFace = 3;
  let activeMip = 2;
  let scissorTest = true;
  let effectiveScissorTest = true;
  const renderer = {
    outputEncoding: LinearEncoding,
    xr: { enabled: true },
    shadowMap: { autoUpdate: true, needsUpdate: true, render: () => { throw new Error("r143 cannot render shadows outside renderer.render"); } },
    state: {
      buffers: { depth: { setMask() {} } },
      viewport: (value: Vector4) => { viewport.copy(value); },
      setScissorTest: (value: boolean) => { effectiveScissorTest = value; },
    },
    autoClear: false,
    getRenderTarget: () => activeTarget,
    getActiveCubeFace: () => activeFace,
    getActiveMipmapLevel: () => activeMip,
    getCurrentViewport: (result: Vector4) => result.copy(viewport),
    getScissorTest: () => scissorTest,
    setScissorTest: (value: boolean) => { scissorTest = effectiveScissorTest = value; },
    setRenderTarget: (target: WebGLRenderTarget | null, face = 0, mip = 0) => {
      activeTarget = target;
      activeFace = face;
      activeMip = mip;
      viewport.copy(target?.viewport ?? originalViewport);
      effectiveScissorTest = target?.scissorTest ?? scissorTest;
    },
    render: (scene: Scene, camera: Camera) => onRender(scene, camera, activeTarget),
  } as unknown as WebGLRenderer;
  return {
    renderer,
    assertRestored() {
      assert.equal(activeTarget, originalTarget);
      assert.equal(activeFace, 3);
      assert.equal(activeMip, 2);
      assert.deepEqual(viewport, originalViewport);
      assert.equal(scissorTest, true);
      assert.equal(effectiveScissorTest, true);
      assert.equal(renderer.autoClear, false);
      assert.equal(renderer.xr.enabled, true);
      assert.equal(renderer.shadowMap.autoUpdate, true);
      assert.equal(renderer.shadowMap.needsUpdate, true);
    },
    dispose() { originalTarget.dispose(); },
  };
}

function captureScene(water: ReturnType<typeof createAtriumWater>) {
  const scene = new Scene();
  const geometry = new BoxGeometry();
  const physical = new MeshPhysicalMaterial({ transmission: 1 });
  const opaque = new MeshStandardMaterial();
  const glass = new Mesh(geometry, physical);
  glass.castShadow = true;
  const multiMaterial = new Mesh(geometry, [opaque, physical]);
  const hiddenGlass = new Mesh(geometry, physical);
  hiddenGlass.visible = false;
  const pedestal = new Mesh(geometry, opaque);
  const sun = new DirectionalLight();
  sun.castShadow = true;
  const hiddenSun = new DirectionalLight();
  hiddenSun.castShadow = true;
  hiddenSun.visible = false;
  scene.add(water.group, glass, multiMaterial, hiddenGlass, pedestal, sun, hiddenSun);
  const camera = new PerspectiveCamera(50, 1, 0.7, 173);
  camera.position.set(0, 5, 8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return {
    scene, camera, glass, multiMaterial, hiddenGlass, pedestal, sun, physical, opaque,
    dispose() { geometry.dispose(); physical.dispose(); opaque.dispose(); },
  };
}

describe("live atrium water", () => {
  test("shares the scene's sun direction without mutating caller state or accepting a nonfinite normal", () => {
    const direction = new Vector3(-9, 11, -3);
    const original = direction.clone();
    const water = createAtriumWater({ sunDirection: direction });
    for (const surface of water.group.children as Reflector[]) {
      const normal = material(surface).uniforms.uSunDirection.value as Vector3;
      assert.ok(Math.abs(normal.length() - 1) < 1e-8);
      assert.ok(normal.dot(original.clone().normalize()) > 0.999999);
    }
    assert.deepEqual(direction, original);
    water.dispose();
    const fallback = createAtriumWater({ sunDirection: new Vector3(NaN, 0, 0) });
    const normal = material(fallback.group.children[0] as Reflector).uniforms.uSunDirection.value as Vector3;
    assert.ok(Number.isFinite(normal.length()));
    assert.ok(normal.y > 0);
    fallback.dispose();
  });

  test("routes interaction to the raised basin or surrounding water and freezes cleanly", () => {
    const water = createAtriumWater();
    const [floor, basin] = water.group.children as Reflector[];
    assert.equal(floor.position.y, 0.015);
    assert.equal(basin.position.y, 0.61);
    const floorRipple = material(floor).uniforms.uRipples.value;
    const basinRipple = material(basin).uniforms.uRipples.value;
    const initialFloor = floorRipple.version;
    const initialBasin = basinRipple.version;
    water.splash(0, 0);
    water.update(1, 1 / 60);
    assert.equal(floorRipple.version, initialFloor);
    assert.ok(basinRipple.version > initialBasin);
    water.splash(9, 2);
    water.update(2, 1 / 60);
    assert.ok(floorRipple.version > initialFloor);
    water.setPaused(true);
    const pausedVersion = floorRipple.version;
    water.splash(10, 2);
    water.update(100, 100);
    assert.equal(floorRipple.version, pausedVersion);
    assert.equal(material(floor).uniforms.uTime.value, 2);
    water.setPaused(false);
    water.update(3, 1 / 60);
    assert.equal(material(floor).uniforms.uTime.value, 3);
    water.dispose();
  });

  test("caps reflection resolution, handles invalid sizes, and disposes GPU resources once", () => {
    const water = createAtriumWater({ reflectionSize: 4096 });
    const surfaces = water.group.children as Reflector[];
    water.resize(3840, 2160);
    let disposals = 0;
    for (const surface of surfaces) {
      const target = surface.getRenderTarget();
      assert.equal(target.width, 1024);
      assert.equal(target.height, 576);
      target.addEventListener("dispose", () => { disposals++; });
      surface.geometry.addEventListener("dispose", () => { disposals++; });
      material(surface).addEventListener("dispose", () => { disposals++; });
      material(surface).uniforms.uRipples.value.addEventListener("dispose", () => { disposals++; });
    }
    water.resize(NaN, 0);
    assert.equal(surfaces[0].getRenderTarget().width, 1024);
    water.dispose();
    water.dispose();
    assert.equal(disposals, 8);
    assert.equal(water.group.children.length, 0);
  });

  test("honors a smaller mobile reflection budget in either orientation without upscaling", () => {
    const water = createAtriumWater({ reflectionSize: 512 });
    const surfaces = water.group.children as Reflector[];
    for (const [width, height, expectedWidth, expectedHeight] of [[1920, 1080, 512, 288], [1080, 1920, 288, 512], [240, 160, 240, 160]]) {
      water.resize(width, height);
      for (const surface of surfaces) {
        const target = surface.getRenderTarget();
        assert.equal(target.width, expectedWidth);
        assert.equal(target.height, expectedHeight);
        assert.equal(material(surface).uniforms.uReflectionTexel.value.x, 1 / expectedWidth);
        assert.equal(material(surface).uniforms.uReflectionTexel.value.y, 1 / expectedHeight);
        assert.equal(material(surface).uniforms.tRefraction.value.image.width, expectedWidth);
        assert.equal(material(surface).uniforms.tRefraction.value.image.height, expectedHeight);
        assert.equal(material(surface).uniforms.uRefractionTexel.value.x, 1 / expectedWidth);
        assert.equal(material(surface).uniforms.uRefractionTexel.value.y, 1 / expectedHeight);
      }
    }
    water.dispose();
  });

  test("keeps default and malformed reflection requests inside the resource limits", () => {
    for (const [requested, expected] of [[undefined, 1024], [NaN, 1024], [Infinity, 1024], [-100, 64], [0, 64], [512.2, 512]] as const) {
      const water = createAtriumWater({ reflectionSize: requested });
      water.resize(4096, 4096);
      for (const surface of water.group.children as Reflector[]) {
        const target = surface.getRenderTarget();
        assert.equal(target.width, expected);
        assert.equal(target.height, expected);
      }
      water.dispose();
    }
  });

  test("prepares shared HDR refraction and two cached reflections even on a paused first frame", () => {
    const water = createAtriumWater();
    const surfaces = water.group.children as Reflector[];
    const fixture = captureScene(water);
    let calls = 0;
    let refraction: WebGLRenderTarget | null = null;
    let replacement: MeshPhysicalMaterial | null = null;
    let replacementArray: typeof fixture.multiMaterial.material | null = null;
    const originalArray = fixture.multiMaterial.material;
    const harness = captureHarness((_scene, camera, target) => {
      calls++;
      assert.equal(water.group.visible, false);
      assert.equal(fixture.hiddenGlass.visible, false);
      assert.equal(fixture.pedestal.visible, true);
      assert.equal(fixture.glass.visible, true);
      assert.equal(fixture.glass.castShadow, true);
      assert.equal(fixture.multiMaterial.visible, true);
      if (calls % 3 === 1) {
        refraction = target;
        assert.equal(camera, fixture.camera);
        assert.equal(harness.renderer.shadowMap.autoUpdate, true);
        assert.equal(harness.renderer.shadowMap.needsUpdate, true);
        if (replacement) assert.equal(fixture.glass.material, replacement);
        if (replacementArray) assert.equal(fixture.multiMaterial.material, replacementArray);
        replacement = fixture.glass.material;
        replacementArray = fixture.multiMaterial.material;
        assert.notEqual(replacement, fixture.physical);
        assert.equal(replacement.transmission, 0);
        assert.equal(replacement.colorWrite, false);
        assert.equal(replacement.depthWrite, false);
        assert.equal(replacement.visible, true);
        assert.equal(replacementArray[0], fixture.opaque);
        assert.equal(replacementArray[1], replacement);
        assert.equal(fixture.hiddenGlass.material, fixture.physical);
        assert.equal(fixture.physical.transmission, 1);
        assert.equal(target?.texture.type, HalfFloatType);
        assert.ok(target?.depthTexture);
        assert.equal(target?.width, 1024);
        assert.equal(target?.height, 576);
      } else {
        assert.notEqual(camera, fixture.camera);
        assert.equal(fixture.glass.material, fixture.physical);
        assert.equal(fixture.multiMaterial.material, originalArray);
        assert.equal(harness.renderer.shadowMap.autoUpdate, false);
        assert.equal(harness.renderer.shadowMap.needsUpdate, false);
      }
      // A nested scene render cannot start another water preparation.
      water.prepareFrame(harness.renderer, fixture.scene, fixture.camera);
    });
    water.setPaused(true);
    water.resize(1920, 1080);
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera);
    assert.equal(calls, 3);
    harness.assertRestored();
    for (const surface of surfaces) {
      const shader = material(surface);
      assert.equal(shader.transparent, false);
      assert.equal(shader.depthWrite, true);
      assert.equal(shader.uniforms.tRefraction.value, refraction!.texture);
      assert.equal(shader.uniforms.tRefractionDepth.value, refraction!.depthTexture);
      const expected = new Matrix4().multiplyMatrices(fixture.camera.projectionMatrix, fixture.camera.matrixWorldInverse);
      assert.deepEqual(shader.uniforms.uRefractionMatrix.value, expected);
      assert.deepEqual(shader.uniforms.uInverseRefractionMatrix.value, expected.clone().invert());
      // Simulate both Three's transmission and beauty callbacks. Neither may
      // trigger recursive captures or allocate another render target.
      for (let pass = 0; pass < 2; pass++) surface.onBeforeRender(harness.renderer, fixture.scene, fixture.camera, surface.geometry, shader, undefined as never);
    }
    assert.equal(calls, 3);
    fixture.camera.near = 1.3;
    fixture.camera.far = 211;
    fixture.camera.position.x = 2;
    fixture.camera.updateProjectionMatrix();
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera);
    assert.equal(calls, 6);
    assert.deepEqual(material(surfaces[0]).uniforms.uRefractionMatrix.value, new Matrix4().multiplyMatrices(fixture.camera.projectionMatrix, fixture.camera.matrixWorldInverse));
    assert.equal(water.group.visible, true);
    let disposals = 0;
    refraction!.addEventListener("dispose", () => { disposals++; });
    water.dispose();
    water.dispose();
    assert.equal(disposals, 1);
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera);
    assert.equal(calls, 6);
    fixture.dispose();
    harness.dispose();
  });

  test("preserves shadow maps and custom depth materials, and disposes only cached material clones", () => {
    const water = createAtriumWater();
    const fixture = captureScene(water);
    const alphaMap = new Texture();
    const displacementMap = new Texture();
    const customDepth = new MeshDepthMaterial();
    fixture.physical.alphaMap = alphaMap;
    fixture.physical.alphaTest = 0.35;
    fixture.physical.displacementMap = displacementMap;
    fixture.physical.displacementScale = 0.17;
    fixture.physical.shadowSide = DoubleSide;
    fixture.glass.customDepthMaterial = customDepth;
    let cloneDisposals = 0;
    let originalDisposals = 0;
    let textureDisposals = 0;
    fixture.physical.addEventListener("dispose", () => { originalDisposals++; });
    alphaMap.addEventListener("dispose", () => { textureDisposals++; });
    displacementMap.addEventListener("dispose", () => { textureDisposals++; });
    let replacement: MeshPhysicalMaterial | null = null;
    const harness = captureHarness((_scene, camera) => {
      if (camera !== fixture.camera) return;
      replacement = fixture.glass.material;
      assert.equal(replacement.alphaMap, alphaMap);
      assert.equal(replacement.alphaTest, 0.35);
      assert.equal(replacement.displacementMap, displacementMap);
      assert.equal(replacement.displacementScale, 0.17);
      assert.equal(replacement.shadowSide, DoubleSide);
      assert.equal(fixture.glass.customDepthMaterial, customDepth);
    });
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera);
    replacement!.addEventListener("dispose", () => { cloneDisposals++; });
    water.dispose();
    water.dispose();
    assert.equal(cloneDisposals, 1);
    assert.equal(originalDisposals, 0);
    assert.equal(textureDisposals, 0);
    assert.equal(fixture.glass.material, fixture.physical);
    fixture.dispose();
    customDepth.dispose();
    alphaMap.dispose();
    displacementMap.dispose();
    harness.dispose();
  });

  test("restores materials, visibility, and render state after failure at any capture stage", () => {
    for (const failAt of [1, 2, 3]) {
      const water = createAtriumWater({ reflectionSize: 512 });
      const fixture = captureScene(water);
      const [floor, basin] = water.group.children as Reflector[];
      floor.visible = false;
      const originalArray = fixture.multiMaterial.material;
      let calls = 0;
      let shouldFail = true;
      const harness = captureHarness(() => {
        assert.equal(water.group.visible, false);
        if (++calls === failAt && shouldFail) throw new Error("intentional capture failure");
      });
      assert.throws(() => water.prepareFrame(harness.renderer, fixture.scene, fixture.camera), /intentional capture failure/);
      harness.assertRestored();
      assert.equal(water.group.visible, true);
      assert.equal(floor.visible, false);
      assert.equal(basin.visible, true);
      assert.equal(fixture.glass.visible, true);
      assert.equal(fixture.multiMaterial.visible, true);
      assert.equal(fixture.hiddenGlass.visible, false);
      assert.equal(fixture.glass.material, fixture.physical);
      assert.equal(fixture.multiMaterial.material, originalArray);
      shouldFail = false;
      const previousCalls = calls;
      water.prepareFrame(harness.renderer, fixture.scene, fixture.camera);
      assert.equal(calls, previousCalls + 3);
      harness.assertRestored();
      water.dispose();
      fixture.dispose();
      harness.dispose();
    }
  });

  test("evicts capture clones when their source is disposed and never disposes shared textures", () => {
    const water = createAtriumWater();
    const fixture = captureScene(water);
    const sharedTexture = new Texture();
    fixture.physical.alphaMap = sharedTexture;
    let textureDisposals = 0;
    let firstDisposals = 0;
    let secondDisposals = 0;
    let replacement: MeshPhysicalMaterial | null = null;
    sharedTexture.addEventListener("dispose", () => { textureDisposals++; });
    const harness = captureHarness((_scene, camera) => {
      if (camera === fixture.camera) replacement = fixture.glass.material;
    });
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera);
    const first = replacement!;
    first.addEventListener("dispose", () => { firstDisposals++; });
    fixture.physical.dispose();
    fixture.physical.dispose();
    assert.equal(firstDisposals, 1);
    assert.equal(textureDisposals, 0);

    // Three permits reusing a disposed material. Its capture must be rebuilt
    // instead of returning the released clone retained in an old cache entry.
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera);
    assert.notEqual(replacement, first);
    assert.equal(replacement!.alphaMap, sharedTexture);
    replacement!.addEventListener("dispose", () => { secondDisposals++; });
    water.dispose();
    water.dispose();
    fixture.physical.dispose();
    assert.equal(firstDisposals, 1);
    assert.equal(secondDisposals, 1);
    assert.equal(textureDisposals, 0);
    fixture.dispose();
    sharedTexture.dispose();
    harness.dispose();
  });

  test("alternates cached reflections while refraction stays current, with full refresh after invalidation", () => {
    const water = createAtriumWater();
    const fixture = captureScene(water);
    const [floor, basin] = water.group.children as Reflector[];
    const captures: string[] = [];
    const harness = captureHarness((_scene, camera, target) => {
      captures.push(camera === fixture.camera ? "refraction" : target === floor.getRenderTarget() ? "floor" : target === basin.getRenderTarget() ? "basin" : "unexpected");
    });
    const expectFrame = (expected: string[], force = false) => {
      captures.length = 0;
      water.prepareFrame(harness.renderer, fixture.scene, fixture.camera, force);
      assert.deepEqual(captures, expected);
      harness.assertRestored();
    };
    expectFrame(["refraction", "floor", "basin"]);
    expectFrame(["refraction", "floor"]);
    expectFrame(["refraction", "basin"]);

    // Small parallax does not invalidate both mirrors, but both still receive
    // the current camera's refraction matrices for their water shading.
    fixture.camera.position.x += 0.01;
    expectFrame(["refraction", "floor"]);
    const current = new Matrix4().multiplyMatrices(fixture.camera.projectionMatrix, fixture.camera.matrixWorldInverse);
    for (const surface of [floor, basin]) assert.deepEqual(material(surface).uniforms.uRefractionMatrix.value, current);

    expectFrame(["refraction", "floor", "basin"], true);
    expectFrame(["refraction", "floor"]);
    water.resize(960, 540);
    expectFrame(["refraction", "floor", "basin"]);
    expectFrame(["refraction", "floor"]);
    fixture.camera.fov += 2;
    fixture.camera.updateProjectionMatrix();
    expectFrame(["refraction", "floor", "basin"]);
    expectFrame(["refraction", "floor"]);

    captures.length = 0;
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera);
    assert.deepEqual(captures, ["refraction", "floor", "basin"], "omitted force flag preserves full-capture compatibility");
    water.dispose(); fixture.dispose(); harness.dispose();
  });

  test("a failed partial reflection invalidates both cached surfaces before recovery", () => {
    const water = createAtriumWater();
    const fixture = captureScene(water);
    const [floor, basin] = water.group.children as Reflector[];
    let failTarget: WebGLRenderTarget | null = null;
    const captures: string[] = [];
    const harness = captureHarness((_scene, camera, target) => {
      captures.push(camera === fixture.camera ? "refraction" : target === floor.getRenderTarget() ? "floor" : "basin");
      if (target === failTarget) throw new Error("partial capture failed");
    });
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera, false);
    failTarget = floor.getRenderTarget();
    assert.throws(() => water.prepareFrame(harness.renderer, fixture.scene, fixture.camera, false), /partial capture failed/);
    harness.assertRestored();
    failTarget = null;
    captures.length = 0;
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera, false);
    assert.deepEqual(captures, ["refraction", "floor", "basin"]);
    captures.length = 0;
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera, false);
    assert.deepEqual(captures, ["refraction", "floor"]);
    failTarget = basin.getRenderTarget();
    assert.throws(() => water.prepareFrame(harness.renderer, fixture.scene, fixture.camera, false), /partial capture failed/);
    harness.assertRestored();
    failTarget = null;
    captures.length = 0;
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera, false);
    assert.deepEqual(captures, ["refraction", "floor", "basin"]);
    water.dispose();
    captures.length = 0;
    water.prepareFrame(harness.renderer, fixture.scene, fixture.camera, false);
    assert.equal(captures.length, 0);
    fixture.dispose(); harness.dispose();
  });
});
