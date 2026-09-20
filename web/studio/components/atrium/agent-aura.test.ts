import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  BufferGeometry, Group, Material, Mesh, MeshBasicMaterial, MeshDepthMaterial,
  MeshDistanceMaterial, MeshPhysicalMaterial, Points, ShaderLib, ShaderMaterial,
  SphereGeometry, Texture, UniformsUtils, Vector2, Vector3, Vector4,
  type Shader, type WebGLRenderer,
} from "three";
import { createAgentAura, type AgentAuraSignal } from "./agent-aura";

const idle: AgentAuraSignal = { state: "idle", level: 0 };
const deformUniforms = ["uAuraTime", "uAuraFlow", "uAuraRadius", "uAuraCenter", "uAuraMotion", "uAuraInteraction"];

function compile(material: Material, name: "physical" | "depth" | "distanceRGBA" = "physical") {
  const source = ShaderLib[name];
  const shader: Shader = {
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
    uniforms: UniformsUtils.clone(source.uniforms),
  };
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
}

function fixture() {
  const geometry = new SphereGeometry(2, 24, 16).translate(.3, -.25, .6);
  const original = new MeshPhysicalMaterial({ clearcoat: .1, clearcoatRoughness: .3 });
  const pearl = new Mesh(geometry, original);
  const aura = createAgentAura(pearl);
  const shader = compile(pearl.material);
  return {
    pearl, aura, shader, original, geometry,
    dispose() { aura.dispose(); original.dispose(); geometry.dispose(); },
  };
}

function geometryState(shader: Shader) {
  return Object.fromEntries(deformUniforms.map(name => {
    const value = shader.uniforms[name].value;
    return [name, value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4 ? value.toArray() : value];
  }));
}

function assertFiniteUniforms(shader: Shader) {
  for (const [name, uniform] of Object.entries(shader.uniforms)) {
    if (!name.startsWith("uAura")) continue;
    const value = uniform.value;
    const values = value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4 ? value.toArray() : [value];
    assert.ok(values.every(Number.isFinite), `${name} must stay finite`);
  }
  for (const value of (shader.uniforms.uAuraMotion.value as Vector4).toArray()) {
    assert.ok(value >= 0 && value <= 1, `voice motion must stay normalized: ${value}`);
  }
}

test("beauty and both shadow passes preserve prior decorators and share liquid displacement", () => {
  const original = new MeshPhysicalMaterial();
  const depth = new MeshDepthMaterial();
  const distance = new MeshDistanceMaterial();
  const sources = [original, depth, distance];
  const calls: Material[] = [];
  sources.forEach((material, index) => {
    material.customProgramCacheKey = () => `existing-${index}`;
    material.onBeforeCompile = function (shader) {
      calls.push(this);
      shader.uniforms.existingDecoration = { value: index };
      shader.vertexShader = `// original vertex ${index}\n${shader.vertexShader}`;
      shader.fragmentShader = `// original fragment ${index}\n${shader.fragmentShader}`;
    };
  });
  const geometry = new SphereGeometry(1, 12, 8);
  const pearl = new Mesh(geometry, original);
  pearl.customDepthMaterial = depth;
  pearl.customDistanceMaterial = distance;
  const aura = createAgentAura(pearl);
  const materials = [pearl.material, pearl.customDepthMaterial, pearl.customDistanceMaterial];
  const shaders = materials.map((material, index) => compile(material!, (["physical", "depth", "distanceRGBA"] as const)[index]));
  for (let index = 0; index < materials.length; index++) {
    assert.notEqual(materials[index], sources[index]);
    assert.equal(calls[index], materials[index], "decorators execute against the owned clone");
    assert.equal(shaders[index].uniforms.existingDecoration.value, index);
    assert.ok(shaders[index].vertexShader.includes(`// original vertex ${index}`));
    assert.ok(shaders[index].fragmentShader.includes(`// original fragment ${index}`));
    assert.ok(materials[index]!.customProgramCacheKey().startsWith(`existing-${index}|`));
    assert.match(shaders[index].vertexShader, /vec4 auraField\(vec3 n\)/);
    for (const name of deformUniforms) assert.equal(shaders[index].uniforms[name], shaders[0].uniforms[name]);
  }
  assert.match(shaders[0].vertexShader, /objectNormal=normalize\(auraDirection-auraTangent/);
  assert.match(shaders[0].vertexShader, /transformed\+=auraDirection\*\(uAuraRadius\*auraSurface\.w\)/);
  for (const shadow of shaders.slice(1)) {
    assert.match(shadow.vertexShader, /transformed\+=auraDirection\*\(uAuraRadius\*auraField\(auraDirection\)\.w\)/);
  }
  aura.update(2, .1, { state: "speaking", level: .8 });
  assert.ok(shaders.every(shader => shader.uniforms.uAuraMotion.value.w > 0));
  aura.dispose();
  assert.equal(pearl.material, original);
  assert.equal(pearl.customDepthMaterial, depth);
  assert.equal(pearl.customDistanceMaterial, distance);
  sources.forEach(material => material.dispose());
  geometry.dispose();
});

test("aura follows the transformed geometric center without changing source geometry or transforms", () => {
  const f = fixture();
  const positions = Array.from(f.geometry.getAttribute("position").array);
  const parent = new Group();
  parent.position.set(4, -2, 7);
  parent.rotation.set(.3, -.5, .1);
  parent.scale.setScalar(1.8);
  parent.add(f.pearl);
  f.pearl.position.set(1, 2, -3);
  f.pearl.rotation.set(.2, .4, -.1);
  f.pearl.scale.set(1.2, .8, 1.1);
  const sourceTransform = [f.pearl.position.toArray(), f.pearl.quaternion.toArray(), f.pearl.scale.toArray()];
  f.aura.update(1, 1 / 60, idle);
  const center = f.geometry.boundingSphere!.center.clone().applyMatrix4(f.pearl.matrixWorld);
  assert.ok(f.aura.group.position.distanceTo(center) < 1e-9);
  const scale = f.pearl.getWorldScale(new Vector3()).multiplyScalar(f.geometry.boundingSphere!.radius);
  assert.ok(f.aura.group.scale.distanceTo(scale) < 1e-9);
  assert.deepEqual([f.pearl.position.toArray(), f.pearl.quaternion.toArray(), f.pearl.scale.toArray()], sourceTransform);
  assert.deepEqual(Array.from(f.geometry.getAttribute("position").array), positions);
  assert.equal(f.pearl.geometry, f.geometry);
  f.dispose();
});

test("only finite measured speech drives audio motion and long frames cannot jump the envelope", () => {
  const f = fixture();
  const comparison = fixture();
  f.aura.update(1, 99, { state: "speaking", level: 9 });
  comparison.aura.update(1, .1, { state: "speaking", level: 1 });
  assert.deepEqual(geometryState(f.shader), geometryState(comparison.shader));
  assertFiniteUniforms(f.shader);
  for (const level of [NaN, Infinity, -Infinity, -5]) {
    for (let frame = 0; frame < 30; frame++) f.aura.update(2 + frame / 10, .1, { state: "speaking", level });
    assertFiniteUniforms(f.shader);
    assert.ok(f.shader.uniforms.uAuraMotion.value.w < .0001);
  }
  for (const state of ["idle", "listening", "thinking", "connecting", "error"] as const) {
    for (let frame = 0; frame < 30; frame++) f.aura.update(5 + frame / 10, .1, { state, level: 1 });
    assertFiniteUniforms(f.shader);
    assert.ok(f.shader.uniforms.uAuraMotion.value.w < .0001, `${state} must not invent agent audio`);
  }
  const before = geometryState(f.shader);
  for (const delta of [NaN, Infinity, -Infinity, -1]) f.aura.update(NaN, delta, { state: "speaking", level: 1 });
  assert.deepEqual(geometryState(f.shader), before);
  f.dispose(); comparison.dispose();
});

test("hover and press settle smoothly, reverse immediately, and release without changing the pearl scale", () => {
  const f = fixture();
  const interaction = f.shader.uniforms.uAuraInteraction.value as Vector2;
  const scale = f.pearl.scale.clone();
  f.aura.setInteraction({ hovered: true, pressed: true });
  assert.deepEqual(interaction.toArray(), [0, 0], "input changes the target, not the rendered frame");
  f.aura.update(1 / 60, 1 / 60, idle);
  assert.ok(interaction.x > 0 && interaction.x < 1);
  assert.ok(interaction.y > 0 && interaction.y < 1);
  const entering = interaction.clone();
  f.aura.setInteraction({ hovered: false, pressed: false });
  f.aura.update(2 / 60, 1 / 60, idle);
  assert.ok(interaction.x < entering.x && interaction.y < entering.y, "pointer leave interrupts entry on the next frame");
  f.aura.setInteraction({ hovered: true, pressed: true });
  for (let frame = 0; frame < 120; frame++) f.aura.update(frame / 60, 1 / 60, idle);
  assert.ok(interaction.x > .999 && interaction.y > .999);
  f.aura.setInteraction({ hovered: true });
  for (let frame = 0; frame < 120; frame++) f.aura.update(2 + frame / 60, 1 / 60, idle);
  assert.ok(interaction.x > .999 && interaction.y < .001, "omitting pressed releases the compression");
  f.aura.setInteraction({ hovered: false });
  for (let frame = 0; frame < 120; frame++) f.aura.update(4 + frame / 60, 1 / 60, idle);
  assert.ok(interaction.x < .001 && interaction.y < .001);
  assert.deepEqual(f.pearl.scale, scale);
  f.dispose();
});

test("paused motion freezes every geometry uniform while retaining static state feedback", () => {
  const f = fixture();
  f.aura.update(1, .1, { state: "speaking", level: .7 });
  f.aura.setInteraction({ hovered: true, pressed: true });
  f.aura.update(2, .1, { state: "listening", level: 0 });
  const before = geometryState(f.shader);
  f.aura.setInteraction({ hovered: false });
  f.aura.update(100, 5, { state: "error", level: 0 }, true);
  assert.deepEqual(geometryState(f.shader), before);
  const errorGlow = f.shader.uniforms.uAuraGlow.value;
  f.aura.update(200, 10, { state: "speaking", level: 1 }, true);
  assert.deepEqual(geometryState(f.shader), before);
  assert.ok(f.shader.uniforms.uAuraLightLevel.value > 0);
  f.aura.update(300, 10, { state: "listening", level: 1 }, true);
  assert.deepEqual(geometryState(f.shader), before);
  assert.ok(f.shader.uniforms.uAuraGlow.value > errorGlow);
  assertFiniteUniforms(f.shader);
  f.aura.update(301, 1 / 60, idle);
  assert.notDeepEqual(geometryState(f.shader), before);
  assert.ok(f.shader.uniforms.uAuraInteraction.value.x < (before.uAuraInteraction as number[])[0]);
  f.dispose();
});

test("water layers share the animated uniforms and dispose shared resources exactly once", () => {
  const f = fixture();
  const host = new Group();
  host.add(f.aura.group);
  const counts = new Map<Material | BufferGeometry, number>();
  const observe = (resource: Material | BufferGeometry) => {
    if (counts.has(resource)) return;
    counts.set(resource, 0);
    resource.addEventListener("dispose", () => counts.set(resource, counts.get(resource)! + 1));
  };
  observe(f.pearl.material);
  observe(f.pearl.customDepthMaterial!);
  observe(f.pearl.customDistanceMaterial!);
  let meshes = 0, points = 0;
  f.aura.group.traverse(object => {
    if (!(object instanceof Mesh || object instanceof Points)) return;
    if (object instanceof Points) points++;
    else meshes++;
    observe(object.geometry);
    assert.ok(object.material instanceof ShaderMaterial);
    observe(object.material);
    for (const name of deformUniforms) assert.equal(object.material.uniforms[name], f.shader.uniforms[name]);
    assert.equal(object.material.depthWrite, false, "translucent water must not occlude later scene surfaces");
  });
  assert.ok(meshes > 0 && points > 0);
  let sourceDisposals = 0;
  f.original.addEventListener("dispose", () => sourceDisposals++);
  f.geometry.addEventListener("dispose", () => sourceDisposals++);
  f.aura.dispose(); f.aura.dispose();
  for (const count of counts.values()) assert.equal(count, 1);
  assert.equal(sourceDisposals, 0);
  assert.equal(f.pearl.material, f.original);
  assert.equal(f.pearl.customDepthMaterial, undefined);
  assert.equal(f.pearl.customDistanceMaterial, undefined);
  assert.equal(f.aura.group.children.length, 0);
  assert.equal(f.aura.group.parent, null);
  const disposedState = geometryState(f.shader);
  f.aura.setInteraction({ hovered: true });
  f.aura.update(100, 1, { state: "speaking", level: 1 });
  assert.deepEqual(geometryState(f.shader), disposedState);
  f.dispose();
});

test("material arrays preserve shared source textures, unsupported materials, and newer replacements", () => {
  const geometry = new SphereGeometry(1, 12, 8);
  const texture = new Texture();
  const physical = new MeshPhysicalMaterial({ map: texture });
  const basic = new MeshBasicMaterial();
  const source = [physical, physical, basic];
  const pearl = new Mesh(geometry, source);
  const aura = createAgentAura(pearl);
  assert.ok(Array.isArray(pearl.material));
  assert.notEqual(pearl.material, source);
  assert.equal(pearl.material[0], pearl.material[1], "one clone per shared source material");
  assert.notEqual(pearl.material[0], physical);
  assert.equal((pearl.material[0] as MeshPhysicalMaterial).map, texture);
  assert.equal(pearl.material[2], basic);
  let sourceDisposals = 0, cloneDisposals = 0;
  for (const material of [physical, basic, texture]) material.addEventListener("dispose", () => sourceDisposals++);
  pearl.material[0].addEventListener("dispose", () => cloneDisposals++);
  const replacement = new MeshPhysicalMaterial();
  const replacementDepth = new MeshDepthMaterial();
  const replacementDistance = new MeshDistanceMaterial();
  pearl.material = [replacement];
  pearl.customDepthMaterial = replacementDepth;
  pearl.customDistanceMaterial = replacementDistance;
  aura.dispose(); aura.dispose();
  assert.equal(cloneDisposals, 1);
  assert.equal(sourceDisposals, 0);
  assert.deepEqual(pearl.material, [replacement]);
  assert.equal(pearl.customDepthMaterial, replacementDepth);
  assert.equal(pearl.customDistanceMaterial, replacementDistance);
  for (const material of [physical, basic, texture, replacement, replacementDepth, replacementDistance]) material.dispose();
  geometry.dispose();
});
