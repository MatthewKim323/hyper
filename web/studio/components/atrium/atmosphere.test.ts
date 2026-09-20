import { strict as assert } from "node:assert";
import { describe, test, type TestContext } from "node:test";
import { ACESFilmicToneMapping, BufferGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, NoToneMapping, PMREMGenerator, Points, Scene, ShaderMaterial, SpotLight, Texture, Vector3, WebGLRenderTarget, type WebGLRenderer } from "three";
import { createAtriumAtmosphere } from "./atmosphere";

function harness(t: TestContext) {
  const skyTarget = new WebGLRenderTarget(32, 32);
  const roomTarget = new WebGLRenderTarget(768, 1024);
  const initialTarget = new WebGLRenderTarget(8, 8);
  const fromScene = PMREMGenerator.prototype.fromScene;
  const fromCubemap = PMREMGenerator.prototype.fromCubemap;
  const reused: (WebGLRenderTarget | null | undefined)[] = [];
  PMREMGenerator.prototype.fromScene = () => skyTarget;
  PMREMGenerator.prototype.fromCubemap = (_texture, target) => { reused.push(target); return roomTarget; };
  t.after(() => { PMREMGenerator.prototype.fromScene = fromScene; PMREMGenerator.prototype.fromCubemap = fromCubemap; initialTarget.dispose(); });
  let activeTarget: WebGLRenderTarget | null = initialTarget;
  let face = 2, level = 1;
  const captures = new Set<WebGLRenderTarget>();
  const state = { frames: 0, inspect: () => {} };
  const renderer = {
    toneMapping: ACESFilmicToneMapping,
    xr: { enabled: true },
    shadowMap: { autoUpdate: true },
    compile() {},
    getRenderTarget: () => activeTarget,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => level,
    setRenderTarget(target: WebGLRenderTarget | null, nextFace = 0, nextLevel = 0) { activeTarget = target; face = nextFace; level = nextLevel; },
    render() { state.frames++; captures.add(activeTarget!); state.inspect(); },
  } as unknown as WebGLRenderer;
  const atmosphere = createAtriumAtmosphere(renderer, new Vector3(1, 2, -1).normalize());
  t.after(() => atmosphere.dispose());
  return { atmosphere, renderer, state, reused, captures, skyTarget, roomTarget, initialTarget };
}

function room() {
  const scene = new Scene();
  const wall = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
  wall.material.name = "Hyper | blush ivory honed limestone";
  const pearl = new Mesh(new BufferGeometry(), new MeshPhysicalMaterial());
  pearl.material.name = "Hero | graduated rose quartz and pearl";
  const crystal = new Mesh(new BufferGeometry(), new MeshPhysicalMaterial({ transmission: .9 }));
  crystal.material.name = "Portals | optically clear rose crystal";
  const water = new Group();
  const shaft = new Mesh(new BufferGeometry(), new ShaderMaterial({ transparent: true }));
  const particles = new Points(); particles.visible = false;
  const light = new SpotLight();
  scene.add(wall, pearl, crystal, water, shaft, particles, light);
  return { scene, wall, pearl, crystal, water, shaft, particles, light };
}

describe("atrium local room reflections", { concurrency: false }, () => {
  test("captures once per explicit refresh without recursion and assigns only optical materials", t => {
    const { atmosphere, renderer, state, reused, captures, skyTarget, roomTarget } = harness(t);
    const { scene, wall, pearl, crystal, water, shaft, particles, light } = room();
    atmosphere.decorate(scene);
    scene.environment = atmosphere.environment;
    state.inspect = () => {
      assert.equal(wall.visible, true);
      assert.equal(light.visible, true);
      for (const object of [pearl, crystal, water, shaft, particles]) assert.equal(object.visible, false);
      assert.equal(renderer.toneMapping, NoToneMapping);
      assert.equal(renderer.shadowMap.autoUpdate, false);
    };
    atmosphere.captureRoomReflections(scene, new Vector3(0, 3.16, -1.5), [water]);
    assert.equal(state.frames, 6);
    assert.equal(captures.size, 1);
    const capture = [...captures][0];
    assert.equal(capture.width, 256);
    assert.equal(capture.height, 256);
    assert.equal(pearl.material.envMap, roomTarget.texture);
    assert.equal(crystal.material.envMap, roomTarget.texture);
    assert.equal(wall.material.envMap, null);
    assert.equal(scene.environment, skyTarget.texture);
    assert.ok(crystal.material.envMapIntensity > wall.material.envMapIntensity);
    assert.equal(particles.visible, false);
    for (const object of [pearl, crystal, water, shaft]) assert.equal(object.visible, true);
    atmosphere.update(20);
    assert.equal(state.frames, 6);
    atmosphere.captureRoomReflections(scene, new Vector3(0, 3.16, -1.5), [water]);
    assert.equal(state.frames, 12);
    assert.deepEqual(reused, [null, roomTarget]);
    let disposals = 0;
    for (const target of [capture, roomTarget, skyTarget]) target.addEventListener("dispose", () => { disposals++; });
    atmosphere.dispose(); atmosphere.dispose();
    assert.equal(disposals, 3);
    atmosphere.captureRoomReflections(scene, new Vector3(), [water]);
    assert.equal(state.frames, 12);
  });

  test("restores hidden objects and all renderer capture state when a cube face fails", t => {
    const { atmosphere, renderer, state, initialTarget } = harness(t);
    const { scene, pearl, crystal, water, shaft, particles } = room();
    const priorEnvironment = new Texture();
    scene.environment = priorEnvironment;
    state.inspect = () => { throw new Error("Cube face failed"); };
    assert.throws(() => atmosphere.captureRoomReflections(scene, new Vector3(), [water]), /Cube face failed/);
    for (const object of [pearl, crystal, water, shaft]) assert.equal(object.visible, true);
    assert.equal(particles.visible, false);
    assert.equal(renderer.getRenderTarget(), initialTarget);
    assert.equal(renderer.getActiveCubeFace(), 2);
    assert.equal(renderer.getActiveMipmapLevel(), 1);
    assert.equal(renderer.toneMapping, ACESFilmicToneMapping);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.shadowMap.autoUpdate, true);
    assert.equal(scene.environment, priorEnvironment);
    assert.equal(crystal.material.envMap, null);
  });
});
