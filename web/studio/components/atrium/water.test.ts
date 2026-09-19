import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { PerspectiveCamera, Scene, ShaderMaterial, Vector3, sRGBEncoding, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { createAtriumWater } from "./water";

function material(surface: Reflector) { return surface.material as ShaderMaterial; }

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
      assert.equal(target.width, 512);
      assert.equal(target.height, 288);
      target.addEventListener("dispose", () => { disposals++; });
      surface.geometry.addEventListener("dispose", () => { disposals++; });
      material(surface).addEventListener("dispose", () => { disposals++; });
      material(surface).uniforms.uRipples.value.addEventListener("dispose", () => { disposals++; });
    }
    water.resize(NaN, 0);
    assert.equal(surfaces[0].getRenderTarget().width, 512);
    water.dispose();
    water.dispose();
    assert.equal(disposals, 8);
    assert.equal(water.group.children.length, 0);
  });

  test("hides both water surfaces during reflection and restores renderer state after a failed pass", () => {
    const water = createAtriumWater();
    const [surface] = water.group.children as Reflector[];
    const scene = new Scene();
    scene.add(water.group);
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 5, 8);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    const originalTarget = { name: "parent render target" } as unknown as WebGLRenderTarget;
    let activeTarget: WebGLRenderTarget | null = originalTarget;
    const renderer = {
      outputEncoding: sRGBEncoding,
      xr: { enabled: true },
      shadowMap: { autoUpdate: true },
      state: { buffers: { depth: { setMask() {} } } },
      autoClear: true,
      getRenderTarget: () => activeTarget,
      setRenderTarget: (target: WebGLRenderTarget | null) => { activeTarget = target; },
      render: () => {
        assert.equal(water.group.visible, false);
        throw new Error("intentional reflection failure");
      },
    } as unknown as WebGLRenderer;
    assert.throws(() => surface.onBeforeRender(renderer, scene, camera, surface.geometry, material(surface), undefined as never), /intentional reflection failure/);
    assert.equal(water.group.visible, true);
    assert.equal(surface.visible, true);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.shadowMap.autoUpdate, true);
    assert.equal(activeTarget, originalTarget);
    water.dispose();
  });
});
